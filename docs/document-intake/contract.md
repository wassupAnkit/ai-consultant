# Document intake, Phase 1: contract

Counsellors attach a student's passport or citizenship/national ID in Edge chat. Edge reads it,
shows what it found, and proposes CRM updates as approval cards (editable before approval).
Nothing reaches the CRM without the counsellor's approval. StudyLink is out of scope: the CRM
team owns it (CRM-858, DIS-56); Edge fills the CRM and attaches files to the contact, which is
what the CRM's own StudyLink send picks up later.

Three repos build to this contract in parallel:

| Repo | Branch | Worktree |
|---|---|---|
| crm-api | `CRM-1220-document-intake` (from `CRM-1220-mcp-server`) | `/var/www/projects/heubert/crm-api-docintake` |
| Edge backend | `feat/document-intake` (from `master`) | `/var/www/projects/heubert/expert-ai-consultant-docintake` |
| Edge frontend | `feat/document-intake` (from `main`) | `/var/www/projects/heubert/expert-chatbot-frontend-docintake` |

## Rules that hold everywhere

- **History is kept, never auto-deleted.** Every uploaded file, every extraction run, every
  proposal, edit and decision is stored with who and when. Files are encrypted at rest in Edge
  (AES-256-GCM, key `STUDENT_DOC_ENC_KEY`), readable only by the uploader (and admins).
- **Never into the shared knowledge base.** Student files are not indexed in `kb_chunks`.
- **No file bytes in tool arguments.** The CRM MCP audit log stores tool arguments forever, so
  Edge passes a short-lived signed URL plus a sha256; crm-api fetches and verifies.
- **Dates are `YYYY-MM-DD`.** Countries are English names as the CRM stores them ("Nepal").
- **Aadhaar (India):** never store or send the full number; keep only the last 4 digits
  (`XXXX-XXXX-1234`).
- **Synthetic data only** in tests and fixtures. Never a real student's document.

## 1. Edge upload API (backend builds, frontend calls)

All routes require the usual auth (session JWT / Supabase / API key + `x-user-id`); the owner is
the authenticated user's email. Another owner's attachment → `404`.

### `POST /v1/chat/attachments`
Multipart form: `file` (required), `sessionId` (optional uuid).
Accepts `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`;
max 10 MB (`STUDENT_DOC_MAX_BYTES`, default 10485760, the CRM's own limit).
→ `201 { "attachment": AttachmentView }` · `413` too large · `415` type · `401` anonymous.

```ts
interface AttachmentView {
  id: string;            // uuid
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;        // hex
  createdAt: string;     // ISO
}
```

### Direct upload through S3 (production path)
The ALB's WAF blocks binary request bodies (8 KB size rule, XSS/LFI patterns in image bytes), so in
production the file goes from the browser straight to S3 (`STUDENT_DOC_S3_BUCKET`):

1. `POST /v1/chat/attachments/uploads` JSON `{ fileName, mimeType, sizeBytes, sessionId? }` →
   `201 { uploadId, url, fields, ticket, expiresAt }` · `415` type · `413` size ·
   `503 direct_upload_disabled` when no bucket is configured (use multipart instead).
2. The browser POSTs multipart to `url`: every entry of `fields` first, then `file` last. S3 accepts
   only the declared `Content-Type` and 1 byte to `STUDENT_DOC_MAX_BYTES`, for 10 minutes.
3. `POST /v1/chat/attachments/uploads/complete` JSON `{ ticket }` → `201 { attachment: AttachmentView }`
   (same as multipart; the type is sniffed from the bytes again) · `409 not_uploaded` ·
   `410 ticket_expired` · `400 invalid_ticket | size_mismatch` · `415`.
   Edge deletes the S3 object either way; the bucket also expires `incoming/` after a day.

### `GET /v1/chat/attachments/:id` → `AttachmentView & { extractions: DocumentExtractionView[] }`
### `GET /v1/chat/attachments/:id/content` → the decrypted bytes (owner only), `Content-Type` as stored, `Content-Disposition: inline`.
### `GET /v1/files/:id?exp=<unix>&sig=<hex>` → the decrypted bytes, **no auth**; valid only when
`sig = HMAC-SHA256(DOCUMENT_URL_SECRET, "<id>.<exp>")` and `exp` is in the future and at most
10 minutes ahead. Used only by crm-api to fetch a file it was asked to attach.

## 2. Chat request (backend accepts, frontend sends)

`POST /v1/chat` and `POST /v1/chat/stream` accept `attachments?: string[]` (attachment ids, max 5,
all owned by the caller, else `400`). The message stays required; the frontend sends
"Read the attached documents." when the counsellor typed nothing.

The student is the chat's guided-session contact (the `@` student chip already turns a chat into
a guided session with `contactId`). Without one, Edge still extracts and shows the documents, and
asks the counsellor to `@`-mention the student before proposing CRM changes.

## 3. Stream events (backend emits, frontend renders)

Existing events are unchanged. New event, one per attachment, after extraction and **before**
any `crm_write_proposal` event:

```json
{ "event": "document_extraction", "data": DocumentExtractionView }
```

```ts
interface DocumentExtractionView {
  attachmentId: string;
  fileName: string;
  documentType: "passport" | "national_id" | "other";
  /** The CRM checklist name the file is filed under: "Passport", "Citizenship/National ID", or null for other. */
  crmDocumentType: string | null;
  /** Issuing country, English name. */
  country: string | null;
  holderName: string | null;
  fields: { key: string; label: string; value: string; confidence: "high" | "medium" | "low"; source: "mrz" | "visual" }[];
  warnings: { code: string; message: string }[];
  // codes: "mrz_checksum_failed", "expired", "expires_within_12_months", "name_mismatch_crm",
  //        "dob_mismatch_crm", "unreadable", "not_identity_document", "no_student_selected",
  //        "aadhaar_masked"
}
```

Session history (`GET /v1/sessions/:id`):
- human messages gain `attachments: AttachmentView[]`;
- AI messages gain `documents: DocumentExtractionView[]` (same objects as streamed).

## 4. CRM proposals

Edge builds the proposals itself (not the research model) through the existing approval pipeline
(`CrmWriteService.propose` with `_meta["heubert/dryRun"]`), so each arrives as the existing
`crm_write_proposal` event and card:

| What | Tool | Notes |
|---|---|---|
| Profile fields that differ from the CRM | `crm_update_contact` (exists) | passport: firstName, lastName, dateOfBirth, gender, nationality, passportNo, countryOfPassport, passportExpiryDate; national ID: dateOfBirth (only when empty), addressLineOne, city, state, country, countryOfBirth (new arg) |
| National ID number, issue date/place, father's and mother's names, place of birth | `crm_create_note` (exists) | one note per document, `source` = contact, description in a fixed "Identity document (from <file>, read <date>)" layout |
| The file itself | `crm_attach_contact_document` (**new**) | one per file |

### New crm-api MCP tool `crm_attach_contact_document`
Input:
```ts
{
  contactId: string;      // uuid
  documentType: string;   // a checklist name, e.g. "Passport", "Citizenship/National ID" (validated against `checklists`)
  category: string;       // the checklist's type, e.g. "Personal"
  fileName: string;       // ≤ 200 chars, with extension
  mimeType: string;
  sizeBytes: number;      // ≤ 10485760
  sha256: string;         // 64 hex
  fileUrl: string;        // https; host must be in MCP_DOCUMENT_FETCH_HOSTS (comma list)
}
```
Preview (`dryRun`): `target { entity: "document", id: <contactId>, label: <contact name>, parentLabel: documentType }`,
`changes: [{ field: "document", label: documentType, before: <names of existing contact documents of that type joined by ", "> | null, after: fileName }]`.
Handler: fetch `fileUrl` (30 s timeout, ≤ 10 MB, sha256 must match, else error `FILE_MISMATCH`),
then the existing upload-media command with `subjectType: "contact"`, `subjectId: contactId`,
`path: contact__<internalId>/Contact-Documents`, `documentType`, `documentTypeCategory: category`,
`name: fileName without extension`. Result: `{ mediaId }`. Permission: same as `crm_update_contact`.
The audit log therefore stores the URL and hash, never bytes.

Also in crm-api:
- `crm_update_contact` gains `countryOfBirth` (≤ 80) and `relationshipStatus` (the entity's enum).
- Date arguments of MCP write tools reject anything that is not `YYYY-MM-DD` (today
  `@NormalizeDate` turns a bad date into `null`, which clears the field).

## 5. Editable approval (backend + frontend)

`POST /v1/crm/writes/:id/decision` body becomes:
```ts
{ decision: "approve" | "reject"; edits?: Record<string, string | number | boolean | null> }
```
- `edits` only with `approve`, only keys that are `changes[].field` of that proposal, only for
  tools whose change fields map 1:1 to tool arguments (`crm_update_contact`); otherwise `400`.
- Edge re-runs the dry-run preview with the edited arguments before applying (the CRM validates
  again), stores the original and edited values, and returns the view with
  `edited?: { field: string; from: CrmWriteValue; to: CrmWriteValue }[]` and updated `changes`.
- The frontend card shows an **Edit** button on pending `crm_update_contact` cards: each change
  row's "after" value becomes an input; **Approve** sends the edits.

## 6. Checklist (backend, shown in the answer)

After extraction, the answer lists, for the student: documents read this turn, warnings
(expired / expiring within 12 months / name or DOB mismatch with the CRM), and when the student
has an application, the CRM checklist's missing required documents
(`crm_get_application_checklist`).
