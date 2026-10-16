# Counsellor CRM reads + Edge write confirmation — Implementation Plan

**Intent:** docs/counsellor-crm-reads-write-confirmation/intent.md
**Goal:** Counsellors get cited answers about applications, checklists, documents, activity, visits, notifications, counts, assignees and CRM courses, and no CRM write runs through Edge until the counsellor approves an exact before→after card.
**Approach:** crm-api gains nine read-only MCP tools (and `applications` on the student overview) plus a *preview/expected-version* protocol on its existing six write tools, carried in MCP's `params._meta`: a dry run returns the exact before→after without writing, and an execute carrying the previewed version refuses when the record changed. Edge never executes a write inside the research loop: a write tool call becomes a stored *proposal*, is streamed to the chat as a `crm_write_proposal` event, and executes only when the counsellor POSTs a decision. The frontend renders one card per proposal. All new Edge logic lives in new files under `src/crm/approvals/`, and shared files get small, exact hunks, because a parallel session (guided journey) is editing the same Edge files.
**Test layers:** Unit and integration. Unit: every crm-api tool and the dispatcher `_meta` handling (jest, QueryBus/CommandBus faked, `npx jest src/mcp`); Edge's proposal store, write-tool wrapper, decision service and history annotation (`bun test`); the frontend's pure proposal reducer (`bun test`). The criteria that cross a boundary force integration: 13–18 cross HTTP (the stream event, the decision route, persistence, and the history reload), which is covered by Edge route tests on the real Hono app with `InMemoryChatStore` and a scripted CRM (`tests/crm-writes.test.ts`, `bun test`); the MCP `_meta` wire contract is covered by crm-api's transport e2e (`npm run test:e2e -- mcp`). Criteria 1–12 are satisfied inside one tool each, against faked buses. The layer the repos lack: **the frontend has no component or browser test setup** (bun:test over pure modules only), and none of the three repos can reach a real CRM database locally. So the card's rendering and clicks (13–18 in the browser) and criterion 20 (all six writes applied on the real PR-680 tenant) are **Manual: no browser/e2e setup in expert-chatbot-frontend, no local CRM database**. They run as the Task 19 smoke list against PR-680.
**Constraints:**
- crm-api `CLAUDE.md`: "`npm run lint`. `.husky/pre-commit` greps the output for `✖` and aborts the commit if it finds one — so a single warning blocks the commit, not just errors." (The untracked `src/metrics/` currently fails lint tree-wide. Lint the touched files with `npx eslint <files>` and commit with `--no-verify`, as 1092c6eb did.)
- crm-api `CLAUDE.md`: "`npx jest`. Neither the pre-commit hook nor any of the three buildspecs runs tests — local jest is the only safety net that exists."
- crm-api `CLAUDE.md`: "Never `npm run format`."
- crm-api `CLAUDE.md`: "`tsconfig.json` sets `baseUrl: ./src`, so import `core/context`, not `../../core/context`."
- crm-api commit format (git log): `CRM-1220 chore(add) …` / `CRM-1220 chore(fix) …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Edge `CLAUDE.md`: "Default to using Bun instead of Node.js." / "Use `bun test` to run tests." / "Bun automatically loads .env, so don't use dotenv."
- Edge: commit style `feat(crm): …`; `bun run typecheck` (`bunx tsc --noEmit -p tsconfig.json`) must pass.
- Edge worktree `/var/www/projects/heubert/expert-ai-consultant-counsellor-crm` (branch `feat/counsellor-crm-reads-write-confirm`). Never touch `/var/www/projects/heubert/expert-ai-consultant`, which belongs to the guided-journey session. Before editing `src/app/{routes,service,http}.ts`, `src/app.ts`, `src/server.ts` or `src/tools/crm.ts`, send the hunk to session `edge-guided-journey-sessions`. Rebase onto its `feat/guided-journey` (3b10389 or later) before opening the PR.
- Frontend worktree `/var/www/projects/heubert/expert-chatbot-frontend-crm-approvals` (branch `feat/crm-write-approvals`, from origin/main a5aa1f1); checks are `bun test`, `npm run lint`, `npm run build`.
- crm-api work is committed on `CRM-1220-mcp-server` locally and is **not pushed until Task 19**, because every push redeploys PR-680, which prod Edge uses.
- Personal data: no tool returns a signed file URL, a file path, a bucket name or document contents (intent: documents are metadata only; Edge's activity log keeps tool output forever).

## Shared contracts (defined once, by the task named)

| Contract | Defined in (task) | Used by |
| --- | --- | --- |
| `WritePreview`, `WriteChange`, `WRITE_META` keys, `STALE_RECORD` code (crm-api) | `crm-api/src/mcp/tools/write-preview.ts` (Task 1) | Tasks 1, 2 |
| `McpTool.preview` (optional) | `crm-api/src/mcp/tools/tool.interface.ts` (Task 1) | Task 2 |
| `ApplicationRow`, `projectApplication`, `stageNeighbours` | `crm-api/src/mcp/tools/application/application-view.ts` (Task 3) | Tasks 3, 4 |
| `loadVisibleApplication(id, ctx)` | `crm-api/src/mcp/tools/application/application-access.ts` (Task 3) | Tasks 3, 4 |
| Edge wire types `CrmWritePreview`, `CrmWriteChange`, `CrmWriteStatus`, `CrmWriteProposal`, `CrmWriteProposalView`, `CRM_WRITE_META`, `CRM_WRITE_PROPOSAL_EVENT` | `expert-ai-consultant/src/crm/approvals/types.ts` (Task 12) | Tasks 12–16 |
| `CrmWriteProposalStore` + `InMemoryCrmWriteProposalStore` + `MongoCrmWriteProposalStore` | `src/crm/approvals/store.ts`, `src/crm/approvals/mongo-store.ts` (Task 13) | Tasks 14–16 |
| `CrmWriteService` (`propose`, `decide`, `expireSession`, `viewsForSession`) and `decisionNote` | `src/crm/approvals/service.ts`, `src/crm/approvals/history.ts` (Task 14) | Tasks 14–16 |
| Frontend `CrmWriteProposalView`, `CrmWriteStatus` (a mirror of the Edge wire type, since it is a separate repo) | `expert-chatbot-frontend/lib/edge/types.ts` (Task 17) | Tasks 17, 18 |

**Wire contract, crm-api ↔ Edge (MCP `tools/call`):**
- Dry run: `params._meta = { "heubert/dryRun": true }`. The tool is resolved and gated exactly as for a real call (write flag, permission, visibility, input validation). Its `preview(input, ctx)` runs, nothing is written, nothing is audited, and the result is `{ content: [{type:"text", text}], structuredContent: { preview: WritePreview } }`.
- Execute with a version: `params._meta = { "heubert/expectedVersion": "<ISO>" }`. Before the handler, the dispatcher re-runs `preview`. If `preview.version !== expectedVersion`, the result is `isError: true` with `structuredContent: { error: { code: "STALE_RECORD", status: 409, detail }, preview: <current WritePreview> }`, and nothing is written or audited. Otherwise the handler runs as today.
- `WritePreview = { tool: string; target: { entity: "contact"|"enquiry"|"officeVisit"|"note"; id: string|null; label: string; parent?: { entity: "contact"|"deal"|"enquiry"|"officeVisit"; id: string; label: string } }; changes: Array<{ field: string; label: string; before: string|number|boolean|null; after: string|number|boolean|null }>; version: string|null }`. `version` is the target's `updatedAt` as ISO for updates, and `null` for creates, which have no stale check.

**Wire contract, Edge ↔ frontend:**
- NDJSON/SSE event `crm_write_proposal`, whose payload is a `CrmWriteProposalView`. It is emitted during the turn, before `done`, one event per proposal.
- `CrmWriteProposalView = { proposalId: string; requestId: string; tool: string; target: { entity; id: string|null; label: string; parentLabel?: string }; changes: CrmWriteChange[]; status: "pending"|"applying"|"applied"|"rejected"|"expired"|"stale"|"failed"; expiresAt: string; decidedAt?: string; error?: string; current?: CrmWriteChange[] }`.
- `POST /v1/crm/writes/:proposalId/decision` with body `{ "decision": "approve"|"reject" }`. It returns 200 with the updated `CrmWriteProposalView` (this is the `crm_write_result` named to the peer session), 404 when the proposal does not exist or belongs to another actor, and 409 with the current view when the proposal is no longer `pending`.
- `GET /v1/sessions/:id` messages gain `crmWrites?: CrmWriteProposalView[]` on assistant messages, matched by `requestId`.

## Files
| Path | Create or modify | Responsibility |
| --- | --- | --- |
| crm-api `src/mcp/tools/write-preview.ts` | create | Preview/stale contract types, meta keys, `buildChanges` diff helper |
| crm-api `src/mcp/tools/tool.interface.ts` | modify | optional `preview` on `McpTool`; `dryRun`/`expectedVersion` on `McpToolContext` |
| crm-api `src/mcp/protocol/mcp.dispatcher.ts` | modify | read `params._meta`, route dry runs to `preview`, stale check before execute, skip audit on dry run |
| crm-api `src/mcp/protocol/mcp.dispatcher.spec.ts` | modify | dry-run, stale and not-stale cases |
| crm-api `test/e2e/mcp/mcp-transport.e2e-spec.ts` | modify | `_meta` survives the HTTP transport untouched |
| crm-api `src/mcp/tools/{contact,enquiry,note,office-visit}/*.tool.ts` (the six write tools) | modify | a `preview` per write tool |
| crm-api `src/mcp/tools/write-previews.spec.ts` | create | previews for all six write tools |
| crm-api `src/mcp/tools/application/application-access.ts` | create | `loadVisibleApplication`: the application must hang off a visible contact |
| crm-api `src/mcp/tools/application/application-view.ts` | create | projection plus next/previous stage |
| crm-api `src/mcp/tools/application/list-applications.tool.ts`, `get-application.tool.ts`, `get-application-checklist.tool.ts` | create | application reads |
| crm-api `src/mcp/tools/contact/get-student-overview.tool.ts` | modify | `applications` in the overview |
| crm-api `src/mcp/tools/document/list-documents.tool.ts` | create | document metadata for a visible contact |
| crm-api `src/mcp/tools/activity/get-activity-timeline.tool.ts` | create | contact, enquiry and office-visit activity |
| crm-api `src/mcp/tools/office-visit/list-office-visits.tool.ts` | create | today's queue under the branch/assignee rule |
| crm-api `src/mcp/tools/notification/list-notifications.tool.ts`, `src/mcp/tools/me/get-my-counts.tool.ts` | create | the counsellor's own notifications and counts |
| crm-api `src/mcp/tools/reference/list-assignees.tool.ts` | create | assignable users for a visible contact |
| crm-api `src/mcp/tools/course/search-courses.tool.ts`, `compare-courses.tool.ts` | create | CRM course search and compare |
| crm-api `src/mcp/tools/requests/*.request.ts` | create (one per new tool with input) | class-validator DTOs |
| crm-api `src/mcp/tools/index.ts`, `src/mcp/tools/mcp-tools.spec.ts` | modify | register the tools; the spec pins the read list |
| Edge `src/crm/client.ts`, `src/config/env.ts`, `src/server.ts`, `.env.example`, `tests/crm.test.ts` | modify (via merge) | `feat/intent-tool-scoping`: annotations kept, write filter, `CRM_WRITE_TOOLS_ENABLED` |
| Edge `src/crm/client.ts` | modify | `call(..., opts?: { meta })`, `structured` passthrough, `actor` on the toolset |
| Edge `src/crm/approvals/types.ts` | create | the wire types above |
| Edge `src/crm/approvals/store.ts`, `src/crm/approvals/mongo-store.ts` | create | proposal persistence |
| Edge `src/crm/approvals/service.ts` | create | propose / decide / expire / views / history annotation |
| Edge `src/tools/crm.ts` | modify | write descriptors become proposal tools |
| Edge `src/app/service.ts`, `src/app/routes.ts`, `src/app/http.ts`, `src/app.ts`, `src/server.ts`, `README.md` | modify (small hunks) | forward the event, the decision route, expiry on the next message, `crmWrites` in history, wiring, docs |
| Edge `tests/crm-approvals.test.ts`, `tests/crm-writes.test.ts` | create | unit and route tests |
| Frontend `lib/edge/types.ts`, `lib/edge/stream.ts`, `lib/edge/api.ts`, `lib/edge/crm-writes.ts`, `lib/edge/crm-writes.test.ts` | modify/create | event parsing, reducer, decision client |
| Frontend `hooks/use-chat.tsx` | modify | hold proposals on the message; restore them from history |
| Frontend `app/api/crm-writes/[id]/decision/route.ts` | create | proxy to Edge |
| Frontend `components/chat/crm-write-card.tsx`, `components/chat/assistant-message.tsx` | create/modify | the approval card |

---

# Part 1: crm-api (`/var/www/projects/heubert/crm-api`, branch `CRM-1220-mcp-server`)

Run everything from the crm-api root. Per-task check: `npx jest src/mcp` and `npx eslint <touched files>`. Commit with `git commit --no-verify` only after `npx eslint` on the touched files prints nothing (the hook fails on the untracked `src/metrics/`, which is not ours). Never push in Part 1.

## Task 1: preview and stale-record protocol in the dispatcher
**Delivers:** the crm-api side of criteria 13 and 18 (exact before/after; refuse on a changed record), and 19 (dry runs obey the write flag).
**Files:** create `src/mcp/tools/write-preview.ts`; modify `src/mcp/tools/tool.interface.ts`, `src/mcp/protocol/mcp.dispatcher.ts`, `src/mcp/protocol/mcp.dispatcher.spec.ts`, `test/e2e/mcp/mcp-transport.e2e-spec.ts`.
**Kind:** judgement

- [ ] Step 1: create `src/mcp/tools/write-preview.ts` with exactly this content:

```ts
// The preview/stale protocol the Edge approval card is built on. A client asks for a dry run
// with params._meta["heubert/dryRun"] and gets the exact before -> after without anything being
// written; it then executes with params._meta["heubert/expectedVersion"] set to the preview's
// version, and the dispatcher refuses if the record changed in between.
export const WRITE_META = {
  dryRun: 'heubert/dryRun',
  expectedVersion: 'heubert/expectedVersion',
} as const;

export const STALE_RECORD = 'STALE_RECORD';

export type WriteEntity = 'contact' | 'enquiry' | 'officeVisit' | 'note';
export type WriteValue = string | number | boolean | null;

export interface WriteChange {
  field: string;
  label: string;
  before: WriteValue;
  after: WriteValue;
}

export interface WritePreview {
  tool: string;
  target: {
    entity: WriteEntity;
    // null for a create: the record does not exist yet.
    id: string | null;
    label: string;
    parent?: { entity: 'contact' | 'deal' | 'enquiry' | 'officeVisit'; id: string; label: string };
  };
  changes: WriteChange[];
  // The target's updatedAt as ISO for an update; null for a create, which has nothing to go stale.
  version: string | null;
}

const toWriteValue = (value: unknown): WriteValue => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
};

// One change per requested field, in the order given, skipping fields whose value would not change.
// `labels` maps a field to the wording the counsellor sees on the card.
export function buildChanges(
  current: Record<string, unknown> | null,
  requested: Record<string, unknown>,
  labels: Record<string, string>,
): WriteChange[] {
  return Object.entries(requested)
    .filter(([, after]) => after !== undefined)
    .map(([field, after]) => ({
      field,
      label: labels[field] ?? field,
      before: current ? toWriteValue(current[field]) : null,
      after: toWriteValue(after),
    }))
    .filter(change => change.before !== change.after);
}

export const versionOf = (record: { updatedAt?: Date | string | null } | null | undefined): string | null => {
  if (!record?.updatedAt) return null;
  return new Date(record.updatedAt).toISOString();
};
```

- [ ] Step 2: in `src/mcp/tools/tool.interface.ts`, add to `McpTool` (the interface at lines 65-75) the optional member `preview?: (input: unknown, ctx: McpToolContext) => Promise<WritePreview>;`, importing `WritePreview` from `./write-preview`. Do **not** change `McpToolContext`: the dispatcher passes the `_meta` values as arguments to its own private methods, not through the context.
- [ ] Step 3: write the failing dispatcher specs in `src/mcp/protocol/mcp.dispatcher.spec.ts`, inside `describe('McpDispatcher write tools')`. Use the existing `buildTool`, `buildDispatcher(tools, writeToolsEnabled)`, `request(method, params, id)`, `audit` and `WRITE` helpers of that file (lines 226-236). The `preview` mock resolves `PREVIEW = { tool: 'crm_update_contact', target: { entity: 'contact', id: 'c-1', label: 'Jane Doe' }, changes: [{ field: 'phone', label: 'Phone', before: '1', after: '2' }], version: '2026-09-29T00:00:00.000Z' }`. Assertions:
  - `dry run returns the preview and neither writes nor audits`: call with `{ name, arguments: { id: 'c-1', phone: '2' }, _meta: { 'heubert/dryRun': true } }`. Expect `result.structuredContent` to equal `{ preview: PREVIEW }`, `result.isError` to be undefined, `handler` not called, `audit.record` not called, and `preview` called once with the arguments object.
  - `dry run is refused when writes are switched off`: use `buildDispatcher([write], false)`. Expect `isError` true, text containing `switched off`, and `preview` not called.
  - `dry run on a write tool without preview is a tool error`: expect `isError` true and text containing `does not support a preview`.
  - `a dry run on a read tool is a tool error, not a read`: build a read tool and pass `_meta` dryRun. Expect `isError` true, text containing `only write tools`, and the handler not called.
  - `execute with a matching expectedVersion runs the handler and audits once`: `_meta: { 'heubert/expectedVersion': PREVIEW.version }`. Expect the handler called once and `audit.record` called once with `outcome: 'ok'`.
  - `execute with a stale expectedVersion is refused with the current preview`: `_meta: { 'heubert/expectedVersion': '2026-01-01T00:00:00.000Z' }`. Expect `isError` true, `structuredContent.error.code` `'STALE_RECORD'`, `structuredContent.error.status` 409, `structuredContent.preview` equal to `PREVIEW`, the handler not called, and `audit.record` not called.
  - `execute without _meta behaves exactly as before`: the existing audit test must still pass unchanged.
  - `permission is asserted before preview`: use a tool whose `requiredPermission` the user lacks. The dry run returns the same tool error as a normal call would, and `preview` is not called.
- [ ] Step 4: run `npx jest src/mcp/protocol/mcp.dispatcher.spec.ts`. Expected: the new cases FAIL (`structuredContent` undefined / handler called).
- [ ] Step 5: implement in `McpDispatcher.callTool` (`src/mcp/protocol/mcp.dispatcher.ts:164-244`):
  - Read `const meta = (params?._meta ?? {}) as Record<string, unknown>;`, `dryRun = meta[WRITE_META.dryRun] === true`, and `expectedVersion = typeof meta[WRITE_META.expectedVersion] === 'string' ? … : undefined`.
  - Keep the existing order: write-disabled refusal, then unknown tool, then build ctx.
  - Then, if `dryRun`:
    - if the tool is not a write tool, return a tool error with the text `Dry runs apply only to write tools; ${tool.name} is a read.`;
    - if `!tool.preview`, return the text `${tool.name} does not support a preview.`;
    - otherwise, inside try/catch, `assertToolPermission(tool, ctx.user)`, then `const preview = await tool.preview(params?.arguments, ctx)`, and return `{ content: [{ type: 'text', text: renderPreviewText(preview) }], structuredContent: { preview } }`;
    - the catch uses `toToolError`;
    - no audit.
  - In the write branch (after `assertToolPermission`, before `tool.handler`), when `expectedVersion !== undefined && tool.preview`: `const current = await tool.preview(params?.arguments, ctx)`. If `current.version !== expectedVersion`, return (without auditing) `{ isError: true, content: [{ type: 'text', text: 'The record changed since the change was proposed. Nothing was written; the current values are attached.' }], structuredContent: { error: { code: STALE_RECORD, status: 409, detail: 'record changed since preview' }, preview: current } }`.
  - `renderPreviewText` is a local function. It prints `target.label`, then one line per change: `label: before → after` (use `(empty)` for null).
  - The stale check must come after `assertToolPermission`, so a user without permission learns nothing about the record.
- [ ] Step 6: run `npx jest src/mcp/protocol/mcp.dispatcher.spec.ts`. Expected: PASS, including the four pre-existing write-tool cases.
- [ ] Step 7: in `test/e2e/mcp/mcp-transport.e2e-spec.ts`, add a second tool to the providers' `MCP_TOOLS_TOKEN` list: a write tool (`annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`) whose `preview` returns a fixed preview. Flip that describe's `MCP_WRITE_TOOLS_ENABLED_TOKEN` to `true`; the existing tests use only the read `echoTool`, so the flip does not affect them. Add the test `passes params._meta through the HTTP transport`: POST `tools/call` with `_meta: { 'heubert/dryRun': true }`, and expect `body.result.structuredContent.preview` to equal the fixed preview.
- [ ] Step 8: run `npm run test:e2e -- mcp`. Expected: PASS, 8 tests.
- [ ] Step 9: run `npx eslint src/mcp/tools/write-preview.ts src/mcp/tools/tool.interface.ts src/mcp/protocol/mcp.dispatcher.ts src/mcp/protocol/mcp.dispatcher.spec.ts test/e2e/mcp/mcp-transport.e2e-spec.ts` (no output), then `git commit --no-verify -m "CRM-1220 chore(add) MCP write previews and stale-record check via _meta"` with the co-author line.

## Task 2: a `preview` on each of the six write tools
**Delivers:** the crm-api side of criteria 13 (each changing field, before → after, named target), 18 (a version to compare) and 20 (all six tools previewable).
**Files:** modify `src/mcp/tools/contact/update-contact.tool.ts`, `src/mcp/tools/enquiry/update-enquiry.tool.ts`, `src/mcp/tools/enquiry/create-enquiry.tool.ts`, `src/mcp/tools/office-visit/update-office-visit.tool.ts`, `src/mcp/tools/note/create-note.tool.ts`, `src/mcp/tools/note/update-note.tool.ts`; create `src/mcp/tools/write-previews.spec.ts`; modify `src/mcp/tools/mcp-tools.spec.ts`.
**Kind:** judgement

Every preview follows the same four rules:
- **Validate first.** Call `validateToolInput(<same DTO as the handler>, input)` and throw the same `McpToolInputInvalidException` the handler throws for "nothing to update".
- **Check visibility with the handler's own probe, then load the current record.** Throw `McpRecordNotVisibleException` when it isn't visible, exactly as the handler does. A preview must refuse whatever the handler would refuse.
- **Build `changes` with `buildChanges(current, requested, LABELS)`** from `write-preview.ts`. Each tool declares a `LABELS` constant for the card wording (e.g. `{ firstName: 'First name', phone: 'Phone', dateOfBirth: 'Date of birth', passportNo: 'Passport number' }`), and every field in the tool's `inputSchema.properties` has a label.
- **`version: versionOf(current)`** for updates, and `null` for creates. All four targets have `@UpdateDateColumn() updatedAt`:
  - `contact/entities/contacts.entity.ts:257`
  - `contact-form/entities/contact-enquiry.entity.ts:144`
  - `office-visit/entities/office-visit.entity.ts:75`
  - `note/entities/note.entity.ts:52`

Per tool (probe → current record → target):
- **`crm_update_contact`**: `GetContactViewPermissionById(id, ctx.user)` (as at `update-contact.tool.ts:66`) → `GetContactDetailsById(id)` (as in `get-contact.tool.ts:71`) → `target { entity: 'contact', id, label: '<firstName> <lastName>' }`. `requested` = the validated fields minus `id`.
- **`crm_update_enquiry`**: `GetEnquiryViewPermissionById(id, ctx.user)` (`update-enquiry.tool.ts:54`) → `FindContactInquiryById(id)` (`contact-form/queries/find-contact-query-by-id.query.ts`; the class is `FindContactInquiryById`, and its handler is in `contact-form/queries/handlers/`) → `target { entity: 'enquiry', id, label: personalInformation.firstName + lastName }`.
  - `person.*` and `address.*` are nested JSON on the entity (`personalInformation`, `addressInformation`, entity lines 79-83). Flatten them for the diff with the field names `person.firstName`, `address.city`, and so on, reading `before` from `current.personalInformation[k]` / `current.addressInformation[k]`.
  - `interestedServiceIds`, `addFollowerIds` and `removeFollowerIds` compare as sorted, comma-joined strings.
- **`crm_create_enquiry`**: no record yet.
  - The handler's rules decide the parent: when `contactId` is given, probe `GetContactViewPermissionById` and set `parent { entity: 'contact', id, label }`.
  - `target { entity: 'enquiry', id: null, label: '<person.firstName> <person.lastName>' }`, `current = null`, so every given field is `before: null`, and `version: null`.
- **`crm_update_office_visit`**: `loadVisibleOfficeVisit(id, ctx)` (`office-visit/office-visit-access.ts:11-22`; it throws when not visible) → `target { entity: 'officeVisit', id, label: 'Office visit — <contact name or visitor name>' }`. The fields are `status`, `assigneeId`, `sessionNotes`, `visitPurposeId`, `serviceId`, `startDate` (`requests/update-office-visit.request.ts`). For `assigneeId`, show the current assignee's name as `before` when the relation is loaded, and otherwise the id.
- **`crm_create_note`**: `assertNoteParentVisible(source, recordId, ctx)` (`note/create-note.tool.ts:16-36`) → `target { entity: 'note', id: null, label: 'New note', parent: { entity: source, id: recordId, label } }`. `changes` = description and type, with `before: null`. Reuse whatever label the probe path can load; when none is cheap, use `'<source> <recordId>'`.
- **`crm_update_note`**: `FindNoteById(id)` plus the parent check the handler performs (`update-note.tool.ts:57-60`) → `target { entity: 'note', id, label: 'Note on <source>' }`, and `version` from `note.updatedAt`.

The PII rule for previews: previews are returned to Edge and shown to the counsellor, which is their purpose. They are **not** audited (Task 1 skips the audit on a dry run), so `mcp_audit_logs` redaction is unaffected.

- [ ] Step 1: write the failing `src/mcp/tools/write-previews.spec.ts`. Copy the `buildCtx` style of `note/create-note.tool.spec.ts:10-30`, where `queryBus.execute` dispatches on `instanceof`. For each of the six tools, assert:
  - `preview` exists.
  - For a visible record with current `{ phone: '1', updatedAt: new Date('2026-09-29T00:00:00Z') }` and input `{ id, phone: '2' }`, the preview is `{ tool: <name>, target: { entity, id, label }, changes: [{ field: 'phone', label: 'Phone', before: '1', after: '2' }], version: '2026-09-29T00:00:00.000Z' }`. Use each tool's own fields: `status` for the office visit, `description` for the note, `person.firstName` for the enquiry.
  - A field whose value doesn't change is left out of `changes`.
  - When the probe returns false, the preview rejects with `McpRecordNotVisibleException`, and `commandBus.execute` is never called.
  - `commandBus.execute` is never called by any preview.
  - Both create tools return `version: null`, `target.id: null`, and `before: null` on every change.
  - In `mcp-tools.spec.ts`, beside `WRITE_TOOLS`, add: `it('every write tool offers a preview', …)` asserting `typeof tool.preview === 'function'` for each write tool.
- [ ] Step 2: run `npx jest src/mcp/tools/write-previews.spec.ts src/mcp/tools/mcp-tools.spec.ts`. Expected: FAIL, `preview is not a function`.
- [ ] Step 3: implement `preview` on each of the six tool objects, next to `handler`, following the rules above. Where the handler already performs the same visibility check, extract a local `loadTarget(args, ctx)` function in that tool file, used by both `preview` and `handler`, so the two cannot drift apart.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS for all suites, including the existing `update-contact.tool.spec.ts`, `update-office-visit.tool.spec.ts` and `create-note.tool.spec.ts`.
- [ ] Step 5: run `npx eslint src/mcp/tools` (no output), then `git commit --no-verify -m "CRM-1220 chore(add) previews for the six MCP write tools"` with the co-author line.

## Task 3: application reads (`crm_list_applications`, `crm_get_application`, overview `applications`)
**Delivers:** criteria 1, 4 (applications part) and 5.
**Files:** create `src/mcp/tools/application/application-access.ts`, `src/mcp/tools/application/application-view.ts`, `src/mcp/tools/application/list-applications.tool.ts`, `src/mcp/tools/application/get-application.tool.ts`, `src/mcp/tools/requests/list-applications.request.ts`, `src/mcp/tools/application/application-tools.spec.ts`; modify `src/mcp/tools/contact/get-student-overview.tool.ts`, `src/mcp/tools/index.ts`.
**Kind:** judgement

**Interface (the guided-journey session already codes against this shape; do not rename):**

```ts
// application-view.ts
export interface StageRef { id: string; name: string }
export interface ApplicationRow {
  id: string;
  status: string | null;
  intake: string | null;          // "<intakeMonth> <intakeYear>", or whichever part exists, or null
  institution: { id: string; name: string } | null;
  course: { id: string; name: string } | null;   // application.product (Product.name, product/entities/product.entity.ts:57)
  currentStage: StageRef | null;  // application.activeStage (.stage is the stage's name)
  nextStage: StageRef | null;
  previousStage: StageRef | null;
  assignees: Array<{ id: string; name: string }>; // projectUser (mcp/tools/project.ts:31)
}
export function stageNeighbours(stages: Array<{ id: string; stage: string; level: number }>, active: { level: number } | null): { next: StageRef | null; previous: StageRef | null };
export function projectApplication(app: Application): ApplicationRow;

// application-access.ts
export async function loadVisibleApplication(id: string, ctx: McpToolContext): Promise<Application>; // throws McpRecordNotVisibleException('application', id)
export async function loadApplicationsForContact(contactId: string, ctx: McpToolContext, limit: number): Promise<{ rows: ApplicationRow[]; total: number }>; // caller has already checked the contact is visible
```

Verified facts:
- `FindApplicationById(id)` joins `institution`, `product`, `workflow.workflowApplicationStages` (ordered by `level` ASC), `activeStage` and `assignees`. It returns null for a missing id, and it is unscoped. See `application/queries/handlers/find-application-by-id.handler.ts:17-35`.
- The REST controller computes the neighbours inline, as next = the stage with `level - 1 === activeStage.level` and previous = the stage with `level + 1 === activeStage.level` (`application/http/controllers/application.controller.ts:265-266`). `stageNeighbours` must reproduce exactly that.
- `FindApplicationByContactId(contactId)` returns `Application[]` with no relations and no scoping (`application/queries/handlers/find-application-by-contact-id.handler.ts:12-19`). `loadApplicationsForContact` therefore calls it, takes the first `limit` rows, and runs `FindApplicationById` on each in `Promise.all`. `total` is the full array length.
- No application visibility query exists (`mcp/tools/note/note-source.ts:25-27`). The rule the intent agreed is that an application is visible iff `GetContactViewPermissionById(app.contactId, ctx.user)` is true. So `loadVisibleApplication` = `FindApplicationById` → null, or a false contact probe, throws `McpRecordNotVisibleException('application', id)`. Both cases give the same error, so no existence leaks.

Tools:
- `crm_list_applications`:
  - input `{ contactId: uuid (required), limit?: 1..10 }`, DTO `ListApplicationsRequest` (copy `requests/list-notes.request.ts:14-18` for `limit`; the default is 5, clamped with `clampLimit`);
  - probe the contact, then `loadApplicationsForContact`;
  - the text is one line per application, `Institution — Course (intake): stage <current> → next <next>; assignees …`, with ids in parentheses as `get-student-overview.tool.ts:76-80` does;
  - `structuredContent { contactId, applications: ApplicationRow[], total }`.
- `crm_get_application`:
  - input `RecordIdRequest` `{ id }` (`requests/record-id.request.ts`);
  - calls `loadVisibleApplication`;
  - `structuredContent { application: ApplicationRow & { contactId, dealId, remarks: truncate(remarks) } }`. The fields are listed at `application.entity.ts:43-125`.
- Both use `annotations: READ_ONLY_ANNOTATIONS` and `requiredPermission { entity: PermissionObjects.CONTACT, anyOf: ['view', 'all', 'assigned', 'followed', 'createdBy', 'unassigned'] }`, copied from `update-contact.tool.ts:52-55`, the contact read verbs. Descriptions are longer than 40 characters and say when to use the tool ("where a student's applications stand, which stage is next").
- Overview: in `get-student-overview.tool.ts:34-89`, add `loadApplicationsForContact(id, ctx, 5).catch(() => null)` to the existing `Promise.all`, **after** the contact probe (lines 34-40). Add an `Applications` section to the text, and put `applications: ApplicationRow[] | null` into `structuredContent` beside `deals`, `enquiries` and `notes`.
- Register both tools in `MCP_TOOLS` (`src/mcp/tools/index.ts:24-47`), in the reads block.

- [ ] Step 1: write the failing `application-tools.spec.ts`, using the fake-bus style of `note/create-note.tool.spec.ts`:
  - `stageNeighbours` with stages at levels 1, 2 and 3 and active level 2 returns next = level 3 and previous = level 1; active level 3 gives next null; a null active stage gives both null.
  - `crm_get_application` for a visible contact returns `structuredContent.application` with `currentStage.name` equal to `activeStage.stage` and `course.name` equal to `product.name`.
  - A false contact probe rejects with `McpRecordNotVisibleException`, and the text never contains the institution name.
  - `FindApplicationById` → null rejects with the same exception.
  - `crm_list_applications` calls `FindApplicationById` for at most `limit` applications and reports `total` as the full count.
  - `crm_get_student_overview` includes `applications` when the contact is visible. When the application lookup throws, `applications` is null and the rest of the overview is still returned.
- [ ] Step 2: run `npx jest src/mcp/tools/application`. Expected: FAIL, `Cannot find module './application-view'`.
- [ ] Step 3: implement the two helpers, the two tools, the overview change and the registration.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS. `mcp-tools.spec.ts` confirms registration, the `crm_` prefix, the annotations and the description length.
- [ ] Step 5: run `npx eslint src/mcp/tools` (no output), then `git commit --no-verify -m "CRM-1220 chore(add) MCP application reads and applications in the student overview"` with the co-author line.

## Common rules for Tasks 4–9 (each new read tool)
- The file lives in `src/mcp/tools/<area>/<name>.tool.ts` and the DTO in `src/mcp/tools/requests/<name>.request.ts`, both following `list-notes.request.ts`. The tool is registered in `MCP_TOOLS`, with `annotations: READ_ONLY_ANNOTATIONS` and a `crm_` name. Its description is longer than 40 characters and states when to use it. The schema uses only `type/description/enum/items/minimum/maximum`: `mcp-tools.spec.ts:60-70` rejects `anyOf`, `oneOf`, `$ref` and `exclusiveMinimum`, and conditional rules go in the DTO.
- Every related record goes through `projectUser`/`projectDate`/`truncate`/`renderList`/`toolResult` from `src/mcp/tools/project.ts` (lines 8-109). Never return an entity as-is (`project.ts:31` comment: ClassSerializer does not run on tool results).
- Never return `path`, `bucketFileName`, a URL to a file, or file contents (`media/entities/media.entity.ts:22-26`).
- A record that isn't visible throws `McpRecordNotVisibleException(entity, id)` (404). A missing record and a hidden one give the same error.
- Each spec uses the fake-bus style of `note/create-note.tool.spec.ts`, and its test names state the rule proved.
- Per task: run `npx jest src/mcp` (PASS), then `npx eslint src/mcp/tools` (no output), then `git commit --no-verify` with the task's message and the co-author line.

## Task 4: `crm_get_application_checklist` and `crm_list_documents`
**Delivers:** criteria 2 and 4 (checklist and document part).
**Files:** create `src/mcp/tools/application/get-application-checklist.tool.ts`, `src/mcp/tools/document/list-documents.tool.ts`, `src/mcp/tools/requests/get-application-checklist.request.ts`, `src/mcp/tools/document/document-tools.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- The checklist link runs `application.activeStageId` → `WorkflowApplicationStageChecklist.workflowApplicationStageId` → `checklist {id, name, type}` with `isRequired` (`workflow-application-stage-checklist/entities/workflow-application-stage-checklist.entity.ts:20,26`; `checklist/entities/checklist.entity.ts:8-14`).
- `FindAllApplicationStageDocuments(workflowStageIds: string[])` returns `{workflowApplicationStageId, name, type, stage, checkListId, isRequired}[]` (`workflow-application-stage-checklist/queries/find-all-application-stage-documents.query.ts:2-11`).
- A document satisfies an item when `Media.mediaType === checklist.name` for the contact. That is the rule in `application/pipes/validate-document-on-application-stages.pipe.ts:9-29`.
- `GetMediasBySubjectIdAndMediaType({ subjectId, mediaType: string[], isContact: true })` returns the contact's non-deleted media, plus documents attached to the contact's applications. **Import it from `media/queries/get-medias-by-subject-id-and-media-type.query.ts`.** A same-named class in `media/queries/get-application-media-.ts` has no handler.
- `GetMediaBySubjectId(subjectId)` returns all non-deleted media for a subject (`media/queries/handlers/get-media-by-subject-id.handler.ts:16-21`).
- The media fields available are `mediaType`, `mediaTypeCategory`, `mimetype`, `extension`, `size`, `stageId`, `createdAt` and `addedBy` (`media/entities/media.entity.ts:19-69`).

Tools:
- `crm_get_application_checklist`:
  - input `{ applicationId: uuid, stageId?: uuid }`;
  - `loadVisibleApplication(applicationId, ctx)` (Task 3). The stage is `stageId ?? application.activeStageId`, and when a `stageId` is given it must belong to `application.workflow.workflowApplicationStages`, or the tool throws `McpToolInputInvalidException(['stageId is not a stage of this application'])`;
  - then `FindAllApplicationStageDocuments([stage])`, then `GetMediasBySubjectIdAndMediaType({ subjectId: application.contactId, mediaType: names, isContact: true })`;
  - `structuredContent { applicationId, stage: StageRef, items: Array<{ name, type, required: boolean, uploaded: boolean, uploadedAt: string|null }>, missingRequired: number }`, where `uploadedAt` is the newest matching media's `createdAt`;
  - the text lists missing required items first.
- `crm_list_documents`:
  - input `{ contactId: uuid, limit?: 1..50 }`;
  - the contact probe, then `GetMediaBySubjectId(contactId)`;
  - rows `{ id, name: mediaType, category: mediaTypeCategory, extension, sizeKb, stageId, uploadedAt }`, newest first;
  - `structuredContent { contactId, documents, total }`.
- Both use `requiredPermission` with the contact read verbs, as in Task 3.

- [ ] Step 1: write the failing `document-tools.spec.ts`:
  - Required items `Passport` and `IELTS`, with media only for `Passport`, give `items` where Passport is `uploaded: true` with its `uploadedAt` and IELTS is `uploaded: false`, and `missingRequired: 1`.
  - A `stageId` from another workflow rejects with `McpToolInputInvalidException`.
  - A hidden contact rejects both tools with `McpRecordNotVisibleException`, and no media query is executed.
  - `JSON.stringify(result)` never contains `path`, `bucketFileName` or `http` for media rows seeded with those fields.
- [ ] Step 2: run `npx jest src/mcp/tools/document`. Expected: FAIL, module not found.
- [ ] Step 3: implement both tools and register them.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP application checklist and document metadata reads`.

## Task 5: `crm_get_activity_timeline`
**Delivers:** criteria 3 and 4 (activity part).
**Files:** create `src/mcp/tools/activity/get-activity-timeline.tool.ts`, `src/mcp/tools/requests/get-activity-timeline.request.ts`, `src/mcp/tools/activity/get-activity-timeline.tool.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- `GetPaginatedContactActivities(paginatedQuery)` dereferences `paginatedQuery.filter.actionType` without a guard, so **always pass a `filter` object** (`contact/queries/handlers/get-paginated-contact-activities.handler.ts:21`). It filters on `contactId`. The entity fields are `activitiesType`, `activitiesAction`, `data` (json) and `createdAt`, and the relations `user`, `assignedUser`, `previousAssignedUser` and `follower` are full users (`contact/entities/contact-activities.entity.ts:70-95`).
- `GetPaginatedEnquiryActivities(paginatedQuery)` filters on `contactId` and `enquiryId`, with relation `user`. The entity has `activitiesAction`, `data` and `noteId` (`contact-form/queries/handlers/get-paginated-enquiry-activities.handler.ts:20-32`; `contact-form/entities/enquiry-activity.entity.ts:41-60`).
- `GetPaginatedOfficeVisitActivities(visitId, paginatedQuery)` returns `actionType`, `activity` and `createdAt`, plus the user's id and name (`office-visit/queries/handlers/get-paginated-office-visit-activities.handler.ts:13-29`).
- Filter values use the nestjs-paginate string form, as the overview builds them with `page({ contactId: id })` (`get-student-overview.tool.ts:55`). Follow that exactly.

Tool:
- Input `{ contactId?: uuid, enquiryId?: uuid, officeVisitId?: uuid, limit?: 1..30 (default 15) }`. The DTO requires exactly one of the three ids: a class-level validator, or a check in the handler that throws `McpToolInputInvalidException(['give exactly one of contactId, enquiryId, officeVisitId'])`.
- Visibility:
  - contact: `GetContactViewPermissionById`;
  - enquiry: `GetEnquiryViewPermissionById`;
  - office visit: `loadVisibleOfficeVisit`.
- For `contactId`, merge three sources:
  - contact activities (`filter: { contactId }`);
  - enquiry activities (`filter: { contactId }`);
  - the activities of the contact's most recent three office visits. Get those via `GetPaginatedOfficeVisit({ page:1, limit:3, path:'', filter:{ contactId } })`, where the filter is required, and **keep only visits that pass `canAccessOfficeVisit`** (`office-visit/office-visit-access.ts`).
- Sort the merged list newest first and cut to `limit`.
- Entry: `{ at: ISO, source: 'contact'|'enquiry'|'officeVisit', action: string, by: {id,name}|null, detail: truncate(<data rendered as "k: v; k: v">, 200) }`.
- `structuredContent { entries, subject: { entity, id } }`.
- When there are no entries, the text says `No recorded activity.`
- `requiredPermission`: the contact read verbs.

- [ ] Step 1: write the failing spec:
  - Entries from the three sources come back merged newest first and capped at `limit`.
  - Both `{}` and `{ contactId, enquiryId }` are rejected.
  - A hidden contact or enquiry rejects, and no activity query runs.
  - An office visit that fails `canAccessOfficeVisit` contributes no entries.
  - `by` is `{id,name}` only, with no email.
- [ ] Step 2: run `npx jest src/mcp/tools/activity`. Expected: FAIL.
- [ ] Step 3: implement and register the tool.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP activity timeline read`.

## Task 6: `crm_list_office_visits`
**Delivers:** criterion 6.
**Files:** create `src/mcp/tools/office-visit/list-office-visits.tool.ts`, `src/mcp/tools/requests/list-office-visits.request.ts`, `src/mcp/tools/office-visit/list-office-visits.tool.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- `GetPaginatedOfficeVisit(query, type?)` sets `type` as a `status =` where clause, and reads `query.filter.assigneeId` without a guard, so **always pass `filter`**.
- It can filter on `branchId` EQ, `assigneeId` EQ/IN/NULL/NOT, `status` EQ, `contactId`, and `createdAt` with `$btw`. The default sort is `createdAt` DESC and the default limit is 10 (`office-visit/queries/handlers/get-paginated-office-visit.handler.ts:25-49`).
- The select includes `branchId` and `assignee.id`, but not `createdById` (lines 61-88).
- Branch helpers are in `src/mcp/tools/office-visit/branch-access.ts` (`userBranchIds` :6, `canAccessAllBranches` :15). The status values come from `VisitStatusEnum` (`office-visit/entities/office-visit.entity.ts:37-43`).

Tool:
- Input `{ date?: 'YYYY-MM-DD', timezone?: IANA string (default 'UTC'), status?: VisitStatusEnum value, assignedToMe?: boolean, limit?: 1..50 (default 20) }`. The window is `[date 00:00, date+1 00:00)` in `timezone`, converted to UTC for `createdAt $btw:<from>,<to>`. The default date is today in `timezone`.
- It runs two queries and merges them by id:
  - one with `filter { createdAt, branchId: '$in:<userBranchIds>' }`, which is skipped when `assignedToMe` is true, and uses no branch filter when `canAccessAllBranches`;
  - one with `filter { createdAt, assigneeId: '$eq:<ctx.user.id>' }`.
- Visits the counsellor created but that sit in another branch and aren't assigned to them are **not** listed, because `createdById` is not selected by this query. Put that in a comment in the tool, and put it in the task's commit message.
- Row: `{ id, status, visitor: <contact full name or visitor name>, contactId|null, assignee: {id,name}|null, branchId, checkedInAt: projectDate(createdAt), sessionStart, sessionEnd }`.
- `structuredContent { date, timezone, visits, total }`.
- `requiredPermission`: none. Office visits have no permission entity of their own (see `update-office-visit.tool.ts`), and the branch/assignee rule is the gate.

- [ ] Step 1: write the failing spec:
  - A user in branch B1 gets the B1 visits, plus a B2 visit assigned to them, but not an unassigned B2 visit.
  - `assignedToMe: true` runs only the assignee query.
  - `date: '2026-09-29'` with `timezone: 'Australia/Sydney'` produces a `createdAt` filter of `$btw:2026-09-28T14:00:00.000Z,2026-09-29T14:00:00.000Z`.
  - Every query passed to the bus carries a `filter` object.
- [ ] Step 2: run `npx jest src/mcp/tools/office-visit`. Expected: FAIL.
- [ ] Step 3: implement and register the tool.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP office-visit queue read (creator-only visits in other branches not listed)`.

## Task 7: `crm_list_notifications` and `crm_get_my_counts`
**Delivers:** criteria 7 and 8.
**Files:** create `src/mcp/tools/notification/list-notifications.tool.ts`, `src/mcp/tools/me/get-my-counts.tool.ts`, `src/mcp/tools/requests/list-notifications.request.ts`, `src/mcp/tools/me/me-tools.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- The REST controller scopes notifications as `{ ...paginate, filter: { ...paginate.filter, receiverId: user.id } }` (`notification/http/controllers/notification.controller.ts:19-24`).
- The only filterable column is `receiverId` EQ, so there is no `isRead` filter (`notification/queries/handlers/get-paginated-notifications.handler.ts:20-22`).
- The selected fields are `id`, `isRead`, `category`, `message` (HTML, e.g. `notification/sockets/application-notification.ts:87`), `url` and `createdAt`.
- `GetUnReadNotificationCount(userId)` returns a number.
- `GetTaskCount(body, userId)`, where `body = { filter: 'all'|'assigned_to_me'|'created_by_me' }` (`note/http/requests/get-task-count.request.ts`), returns the raw row `{ overdue_count, today_count, this_week_count, upcoming_count, completed_count }`, and those values may be strings (`note/queries/handlers/get-task-count.handler.ts:62-90`). Convert them with `Number()`.
- The CRM's enquiry count (`GetCountOfExistingAndNewInquiries`) is **tenant-wide and takes no user**: `new` counts pending enquiries with `contact_id IS NULL`, and `existing` counts pending ones with `contact_id IS NOT NULL` (`contact-form/queries/handlers/get-count-of-existing-and-new-inquiries.handler.ts:10-17`). Returning it would show a counsellor other people's enquiries. The tool therefore computes the same two numbers over the enquiries **visible to the counsellor**, using `GetPaginatedContactInquiry(paginatedQuery, ctx.user)` with `filter { 'status.secondary': 'pending' }` (a custom filter handled at `get-paginated-contact-inquiry.handler.ts:213-223`). It pages through at limit 100, up to 10 pages, and splits the rows by `contactId` null vs set. When it hits the 10-page cap, it reports `capped: true`.

Tools:
- `crm_list_notifications`:
  - input `{ unreadOnly?: boolean (default true), limit?: 1..20 (default 10) }`;
  - `receiverId` is **always** `ctx.user.id`, and the input has no user field;
  - fetch `limit * 3` rows sorted newest first, then keep the unread ones when `unreadOnly`, cut to `limit`;
  - strip HTML tags from `message` (`replace(/<[^>]+>/g, ' ')`, collapse whitespace) and truncate to 200 characters;
  - also return `unreadCount` from `GetUnReadNotificationCount(ctx.user.id)`;
  - `structuredContent { unreadCount, notifications: Array<{ id, category, message, read, at }> }`. Leave `url` out, since it is a CRM front-end path.
- `crm_get_my_counts`:
  - no input;
  - `structuredContent { tasks: { all, assignedToMe, createdByMe }, enquiries: { newPending, existingPending, capped } }`, where each task entry is `{ overdue, today, thisWeek, upcoming, completed }` as numbers.
  - The description says the enquiry counts cover the enquiries this counsellor can see.
- Neither tool has a `requiredPermission`: both are always about the caller themselves.

- [ ] Step 1: write the failing `me-tools.spec.ts`:
  - The notifications query's filter has `receiverId === ctx.user.id` even when the input carries `receiverId: 'someone-else'`. The DTO whitelist strips that key, so assert the key is ignored.
  - HTML is stripped.
  - `unreadOnly` drops read rows.
  - `GetTaskCount` runs three times with the three filters and the string counts come back as numbers.
  - The enquiry split counts `contactId: null` rows as `newPending`.
  - `GetCountOfExistingAndNewInquiries` is never executed.
- [ ] Step 2: run `npx jest src/mcp/tools/me src/mcp/tools/notification`. Expected: FAIL.
- [ ] Step 3: implement and register the tools.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP notifications and my-counts reads, scoped to the caller`.

## Task 8: `crm_list_assignees`
**Delivers:** criterion 9.
**Files:** create `src/mcp/tools/reference/list-assignees.tool.ts`, `src/mcp/tools/requests/list-assignees.request.ts`, `src/mcp/tools/reference/list-assignees.tool.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- `GET users/assignees` derives the branches from `FindContactById(contactId, { secondaryBranches: true })` as `contact.secondaryBranches.map(b => b.id).concat(contact.branch.id).filter(Boolean)`. It then runs `FindUsersByAssociatedBranches(query, type, branchIds)` (`user/http/controllers/user.controller.ts:95-109`).
- The pre-selected path of that handler returns full `User` entities (`user/queries/handlers/find-users-by-associated-branches.handler.ts:61-67`), so every row must go through `projectUser`.

Tool:
- Input `{ contactId: uuid, search?: string (max 100), limit?: 1..30 (default 20) }`.
- It runs the contact probe first, then does exactly what the controller does, with `query = { page: 1, limit, path: '', search }`.
- Row: `{ id, name, role: <role name when loaded, else null> }`.
- `structuredContent { contactId, assignees }`.
- `requiredPermission`: the contact read verbs.

- [ ] Step 1: write the failing spec:
  - A hidden contact rejects before any user query runs.
  - The branch ids passed are the secondary branches plus the primary branch.
  - The rows carry only `id`, `name` and `role`: no email, no phone and no password hash, even when the fake returns full users.
- [ ] Step 2: run `npx jest src/mcp/tools/reference`. Expected: FAIL.
- [ ] Step 3: implement and register the tool.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP assignable-users read for a contact`.

## Task 9: `crm_search_courses` and `crm_compare_courses`
**Delivers:** criteria 10, 11 and 12 (12 via the tool descriptions).
**Files:** create `src/mcp/tools/course/search-courses.tool.ts`, `src/mcp/tools/course/compare-courses.tool.ts`, `src/mcp/tools/requests/search-courses.request.ts`, `src/mcp/tools/requests/compare-courses.request.ts`, `src/mcp/tools/course/course-tools.spec.ts`; modify `src/mcp/tools/index.ts`.
**Kind:** judgement

Verified facts:
- `GetPaginatedProducts(paginatedQuery)` reads `product_view`:
  - `search` does similarity matching or an exact product-code match;
  - the filters are `productType`, `productSubType`, `institutionId`, `serviceId`, `country`, `discipline` and `subjectArea` (`product/queries/handlers/get-paginated-products.handler.ts:57-65`);
  - the row fields are `productName`, `productId`, `institutionName`, `fees` (string), `currency`, `intakes[]`, duration year/month/week, `country`, `programLink` and `description` (`product/entities/product-view.entity.ts:8-69`).
- `CompareMergedProducts(ids)` returns `{ items, meta?: { missingIds } }`, and REST accepts 1–10 UUIDs (`product-v2/http/requests/compare-merged-products.request.ts`). The items are typed `Record<string, unknown>` (`product-v2/types/merged-product.type.ts:15-22`), so pick fields defensively with typeof checks.
- None of the product queries are user-scoped. They are the tenant's catalogue.

Tools:
- `crm_search_courses`:
  - input `{ query?: string, institutionId?: uuid, country?: string, discipline?: string, limit?: 1..10 (default 5) }`, where at least one of `query`, `institutionId`, `country`, `discipline` is required;
  - rows `{ productId, name, institution, country, fees, currency, intakes, duration: "<y>y <m>m <w>w" trimmed, programLink }`;
  - `structuredContent { courses, total }`.
- `crm_compare_courses`:
  - input `{ productIds: uuid[] (2..5) }`;
  - `structuredContent { courses: Array<{ productId, name, institution, fees, intakes, duration, level, requirements: truncate(…, 300) }>, missingIds }`.
- Both descriptions contain this sentence, which is what delivers criterion 12: `These are the offers as set up in Expert's CRM. When a value here differs from knowledge-base or web evidence, show both values, each cited to its own source; do not pick one.` A test asserts it.
- `requiredPermission`: none. The catalogue is readable by every signed-in user, as with `list-interested-services.tool.ts`.

- [ ] Step 1: write the failing spec:
  - `search` and the filters reach the paginated query.
  - `{}` is rejected.
  - Compare with one id is rejected, and with six ids is rejected.
  - A missing id is reported in `missingIds`.
  - Both descriptions contain `show both values, each cited`.
- [ ] Step 2: run `npx jest src/mcp/tools/course`. Expected: FAIL.
- [ ] Step 3: implement and register the tools.
- [ ] Step 4: run `npx jest src/mcp`. Expected: PASS.
- [ ] Step 5: commit `CRM-1220 chore(add) MCP course search and compare over the CRM catalogue`.

## Task 10: pin the new read tools in the registry spec
**Delivers:** a guard behind criteria 1–12 and 19: the read list is pinned and a new read can't turn into a write by accident.
**Files:** modify `src/mcp/tools/mcp-tools.spec.ts`.
**Kind:** transcription

- [ ] Step 1: next to `WRITE_TOOLS` in `src/mcp/tools/mcp-tools.spec.ts`, add:

```ts
const NEW_READ_TOOLS = [
  'crm_list_applications',
  'crm_get_application',
  'crm_get_application_checklist',
  'crm_list_documents',
  'crm_get_activity_timeline',
  'crm_list_office_visits',
  'crm_list_notifications',
  'crm_get_my_counts',
  'crm_list_assignees',
  'crm_search_courses',
  'crm_compare_courses',
];

it('registers every counsellor read tool as read-only', () => {
  for (const name of NEW_READ_TOOLS) {
    const tool = MCP_TOOLS.find(candidate => candidate.name === name);
    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual(READ_ONLY_ANNOTATIONS);
    expect(tool!.preview).toBeUndefined();
  }
});
```

  (Import `READ_ONLY_ANNOTATIONS` from `./tool.interface` if the spec doesn't already.)
- [ ] Step 2: run `npx jest src/mcp/tools/mcp-tools.spec.ts`. Expected: PASS, since Tasks 3–9 registered everything. A FAIL names the missing tool.
- [ ] Step 3: run `npx jest` (the whole suite). Expected: every suite passes except `get-paginated-contact-inquiry.handler.spec.ts`, which already fails on HEAD independently of this work. Say so in the handover if it is still the only failure.
- [ ] Step 4: `npx eslint src/mcp`, then `npm run build`. Expected: no output from eslint, and the build succeeds.
- [ ] Step 5: commit `CRM-1220 chore(test) pin the counsellor read tools in the MCP registry spec`.

---

# Part 2: Edge backend (worktree `/var/www/projects/heubert/expert-ai-consultant-counsellor-crm`, branch `feat/counsellor-crm-reads-write-confirm`)

Run everything from the worktree root. Per-task check: `bun test <file>`, then `bun run typecheck`. Commit style: `feat(crm): …` with the co-author line. Before a task edits `src/app/{service,routes,http}.ts`, `src/app.ts`, `src/server.ts` or `src/tools/crm.ts`, send the exact hunk to session `edge-guided-journey-sessions` (SendMessage) and re-read the file right before editing. Edits are exact-match and in place; never rewrite a whole shared file.

## Task 11: bring in the read-only tool filter (`feat/intent-tool-scoping`)
**Delivers:** criterion 19: with `CRM_WRITE_TOOLS_ENABLED` off, a tool without `readOnlyHint: true` never reaches the model.
**Files:** merge: `src/crm/client.ts`, `src/config/env.ts`, `src/server.ts`, `.env.example`, `tests/crm.test.ts`, `helm/expert-ai-consultant/templates/cronjob-ingest.yaml` (the branch's two commits `5f3a50f` and `0ab5ed1`).
**Kind:** transcription

- [ ] Step 1: `git merge --no-ff feat/intent-tool-scoping -m "Merge feat/intent-tool-scoping: read-only CRM tools by default"`. A read-only `git merge-tree --write-tree master feat/intent-tool-scoping` already exited 0 with no conflicts.
- [ ] Step 2: `bun test tests/crm.test.ts`. Expected: PASS, including the filter test with `TOOLS_WITH_WRITES` and `crm_mystery`.
- [ ] Step 3: `bun test && bun run typecheck`. Expected: PASS.
- [ ] Step 4: no extra commit. The merge commit is the commit.

## Task 12: the CRM client carries `_meta` and structured results; wire types
**Delivers:** the transport for criteria 13, 14 and 18.
**Files:** create `src/crm/approvals/types.ts`; modify `src/crm/client.ts`, `tests/crm.test.ts`.
**Kind:** judgement

- [ ] Step 1: create `src/crm/approvals/types.ts` with exactly this content:

```ts
/**
 * Wire types for CRM write approval. crm-api defines the same preview shape in
 * crm-api/src/mcp/tools/write-preview.ts; the frontend mirrors CrmWriteProposalView in
 * lib/edge/types.ts. Change all three together.
 */
export const CRM_WRITE_META = { dryRun: "heubert/dryRun", expectedVersion: "heubert/expectedVersion" } as const;
export const CRM_WRITE_PROPOSAL_EVENT = "crm_write_proposal";
export const STALE_RECORD = "STALE_RECORD";

export type CrmWriteValue = string | number | boolean | null;
export interface CrmWriteChange { field: string; label: string; before: CrmWriteValue; after: CrmWriteValue }
export interface CrmWritePreview {
  tool: string;
  target: { entity: "contact" | "enquiry" | "officeVisit" | "note"; id: string | null; label: string; parent?: { entity: string; id: string; label: string } };
  changes: CrmWriteChange[];
  version: string | null;
}

export type CrmWriteStatus = "pending" | "applying" | "applied" | "rejected" | "expired" | "stale" | "failed";

/** What is stored. `args` are the model's exact tool arguments, replayed verbatim on approve. */
export interface CrmWriteProposal {
  id: string;
  sessionId: string;
  requestId: string;
  actorEmail: string;
  tool: string;
  args: Record<string, unknown>;
  preview: CrmWritePreview;
  status: CrmWriteStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
  error?: string;
  current?: CrmWriteChange[];
}

/** What the chat receives: the stream event payload, the decision response, and history. */
export interface CrmWriteProposalView {
  proposalId: string;
  requestId: string;
  tool: string;
  target: { entity: CrmWritePreview["target"]["entity"]; id: string | null; label: string; parentLabel?: string };
  changes: CrmWriteChange[];
  status: CrmWriteStatus;
  expiresAt: string;
  decidedAt?: string;
  error?: string;
  current?: CrmWriteChange[];
}

export const toView = (p: CrmWriteProposal): CrmWriteProposalView => ({
  proposalId: p.id,
  requestId: p.requestId,
  tool: p.tool,
  target: { entity: p.preview.target.entity, id: p.preview.target.id, label: p.preview.target.label, ...(p.preview.target.parent ? { parentLabel: p.preview.target.parent.label } : {}) },
  changes: p.preview.changes,
  status: p.status,
  expiresAt: p.expiresAt.toISOString(),
  ...(p.decidedAt ? { decidedAt: p.decidedAt.toISOString() } : {}),
  ...(p.error ? { error: p.error } : {}),
  ...(p.current ? { current: p.current } : {}),
});
```

- [ ] Step 2: write the failing tests in `tests/crm.test.ts`, using its `scriptFetch`/`withFetch` helpers:
  - `callTool` with `{ meta: { "heubert/dryRun": true } }` sends `params._meta` equal to that object.
  - `callTool` without opts sends no `_meta` key.
  - `structuredContent` from the RPC result is returned as `structured` (check whether master already does this; keep the test either way).
  - `forActor(...)` returns a toolset whose `actor` equals the lower-cased email.
- [ ] Step 3: `bun test tests/crm.test.ts`. Expected: FAIL (`_meta` missing).
- [ ] Step 4: implement in `src/crm/client.ts`:
  - `callTool(name, args, signal?, opts?: { meta?: Record<string, unknown> })` sends `{ name, arguments: args, ...(opts?.meta ? { _meta: opts.meta } : {}) }` (today it sends `{ name, arguments: args }` at line 128).
  - `CrmToolset.call` gains the same optional 4th parameter and passes it through (line 150 and line 275).
  - `CrmToolset` gains `readonly actor: string`, set in `forActor`.
  - `CrmToolResult.structured` is typed `Record<string, unknown> | undefined`.
- [ ] Step 5: `bun test tests/crm.test.ts && bun run typecheck`. Expected: PASS.
- [ ] Step 6: commit `feat(crm): pass MCP _meta and structured results through the CRM client`.

## Task 13: proposal store (in-memory and Mongo)
**Delivers:** the persistence behind criteria 13–18 (a proposal outlives the turn and the page reload).
**Files:** create `src/crm/approvals/store.ts`, `src/crm/approvals/mongo-store.ts`, `tests/crm-approvals.test.ts`.
**Kind:** judgement

Interface (`store.ts`):

```ts
export interface CrmWriteProposalStore {
  create(p: CrmWriteProposal): Promise<void>;
  get(id: string): Promise<CrmWriteProposal | null>;
  /** Atomic compare-and-set: moves the proposal from `from` to `patch.status` only if it is still `from`. Returns the updated proposal, or null when it was not in `from`. */
  transition(id: string, from: CrmWriteStatus, patch: Partial<Pick<CrmWriteProposal, "status" | "decidedAt" | "error" | "current">>): Promise<CrmWriteProposal | null>;
  /** Every `pending` proposal of the session becomes `expired`; returns how many. */
  expireSession(sessionId: string, now: Date): Promise<number>;
  listForSession(sessionId: string): Promise<CrmWriteProposal[]>;
}
export class InMemoryCrmWriteProposalStore implements CrmWriteProposalStore { /* Map-backed */ }
```

- `MongoCrmWriteProposalStore(collection: Collection<CrmWriteProposalDoc>)` in `mongo-store.ts`, where the doc is `CrmWriteProposal` with `_id: id`:
  - `transition` = `findOneAndUpdate({ _id: id, status: from }, { $set: patch }, { returnDocument: "after" })`. The driver is `mongodb@^6`, so `findOneAndUpdate` returns the document or null directly, with no `.value`. Verify this against `node_modules/mongodb/mongodb.d.ts` before writing it.
  - `expireSession` = `updateMany({ sessionId, status: "pending" }, { $set: { status: "expired", decidedAt: now } })`.
  - Export `ensureCrmWriteProposalIndexes(db)`, which creates `{ sessionId: 1 }` and a TTL index on `expiresAt` with `expireAfterSeconds: 7 * 24 * 3600`, so old proposals are cleaned up a week after they expire.
  - The collection name is `crm_write_proposals`, fetched with `db.collection(...)`. This file does **not** edit `src/db/mongo.ts`, which the guided-journey session is editing.
- [ ] Step 1: write the failing `tests/crm-approvals.test.ts` (store section, against `InMemoryCrmWriteProposalStore`):
  - `create` then `get` round-trips the proposal.
  - Two concurrent `transition(id, "pending", { status: "applying" })` calls let exactly one win; the other gets null.
  - `expireSession` expires only that session's `pending` proposals and leaves `applied` ones alone.
  - `listForSession` returns proposals in creation order.
- [ ] Step 2: `bun test tests/crm-approvals.test.ts`. Expected: FAIL (module not found).
- [ ] Step 3: implement both stores.
- [ ] Step 4: `bun test tests/crm-approvals.test.ts && bun run typecheck`. Expected: PASS.
- [ ] Step 5: commit `feat(crm): store CRM write proposals`.

## Task 14: the approval service (propose, decide, expire, views, history note)
**Delivers:** criteria 14, 15, 16, 17 and 18 at the service level, and the "decided" note the model sees on the next turn (15).
**Files:** create `src/crm/approvals/service.ts`, `src/crm/approvals/history.ts`; extend `tests/crm-approvals.test.ts`.
**Kind:** judgement

Interface:

```ts
export interface CrmWriteServiceDeps {
  store: CrmWriteProposalStore;
  crm: CrmProvider;               // src/crm/client.ts; forActor(email, signal) → CrmToolset | undefined
  logger: Logger;
  ttlMs?: number;                 // default 30 * 60 * 1000 (intent: 30 minutes)
  now?: () => Date;               // tests
  newId?: () => string;           // default crypto.randomUUID()
}
export class CrmWriteService {
  propose(input: { sessionId: string; requestId: string; toolset: CrmToolset; tool: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<{ ok: true; view: CrmWriteProposalView } | { ok: false; error: string }>;
  decide(input: { proposalId: string; actorEmail: string; decision: "approve" | "reject"; signal?: AbortSignal }): Promise<{ kind: "not_found" } | { kind: "conflict"; view: CrmWriteProposalView } | { kind: "ok"; view: CrmWriteProposalView }>;
  expireSession(sessionId: string): Promise<number>;
  viewsForSession(sessionId: string): Promise<Map<string, CrmWriteProposalView[]>>; // keyed by requestId
}
// history.ts
export function decisionNote(views: CrmWriteProposalView[]): string | null; // text appended to the stored AI message the model sees next turn
```

Behaviour, each line pinned by a test:
- **`propose`:**
  - calls `toolset.call(tool, args, signal, { meta: { [CRM_WRITE_META.dryRun]: true } })`;
  - `isError` → `{ ok:false, error: result.text }`, and nothing is stored;
  - `structured.preview` missing → `{ ok:false, error: "the CRM returned no preview" }`;
  - otherwise it stores `{ status: "pending", actorEmail: toolset.actor, expiresAt: now + ttl }` and returns the view.
- **`decide`:**
  1. `get`. A missing proposal, or `actorEmail !== input.actorEmail` (compared lower-cased), gives `not_found`. Another user's proposal is indistinguishable from a missing one.
  2. If `status === "pending"` and `now >= expiresAt`, `transition` it to `expired` and return `conflict` with the expired view.
  3. On `reject`, `transition(pending → rejected, decidedAt)`. A null result gives `conflict` with the current view.
  4. On `approve`, `transition(pending → applying)`. A null result gives `conflict`.
  5. Then `crm.forActor(actorEmail, signal)`. An undefined toolset, or `tool` missing from `toolset.descriptors` (the write flag was switched off meanwhile), gives `transition(applying → failed, error: "CRM writes are switched off")`.
  6. Otherwise `toolset.call(tool, args, signal, { meta: preview.version ? { [CRM_WRITE_META.expectedVersion]: preview.version } : undefined })`.
     - `structured.error.code === STALE_RECORD` gives `transition(applying → stale, current: structured.preview.changes)`.
     - Any other `isError` gives `failed` with `error: result.text`.
     - Success gives `applied`.
     - A thrown error gives `failed` with the message.
  7. Always return `kind: "ok"` with the final view after an approve that reached step 5.
- **`expireSession`:** delegates to `store.expireSession(sessionId, now())`.
- **`decisionNote`:**
  - pending/applying → `null` (not decided yet);
  - `applied` → `The counsellor approved and the CRM applied: <tool> on <label>.`;
  - `rejected` → `The counsellor rejected: <tool> on <label>. It was not applied.`;
  - `expired` → `… expired without a decision and was not applied.`;
  - `stale` → `… was not applied because the record had changed.`;
  - `failed` → `… failed in the CRM: <error>.`
  - The lines are joined with a newline and prefixed with `[CRM write decisions]`.

- [ ] Step 1: extend `tests/crm-approvals.test.ts` with a service section. Use `fakeToolset` from `tests/crm.test.ts:204` (move it to `tests/fakes.ts` if it isn't exported, and import it from there). Tests:
  - `propose` sends the dryRun meta and stores a pending proposal expiring 30 minutes later.
  - A dry run that returns an error stores nothing.
  - Approve sends `expectedVersion` equal to the preview's version, and the view ends `applied`.
  - A stale response gives `stale` with `current` taken from the CRM's preview.
  - Reject never calls the toolset.
  - A second approve on an applied proposal is a `conflict` and makes no second CRM call.
  - An approve after `expiresAt` gives `expired` and makes no CRM call.
  - Another actor's approve gives `not_found`.
  - Two concurrent approves produce exactly one CRM call.
  - A write tool missing from the descriptors at decision time gives `failed` with "switched off".
  - `decisionNote` for rejected and applied views produces the two sentences, and is null for pending.
- [ ] Step 2: `bun test tests/crm-approvals.test.ts`. Expected: FAIL.
- [ ] Step 3: implement `service.ts` and `history.ts`.
- [ ] Step 4: `bun test tests/crm-approvals.test.ts && bun run typecheck`. Expected: PASS.
- [ ] Step 5: commit `feat(crm): approve, reject and expire CRM write proposals`.

## Task 15: write tools become proposals inside the research loop
**Delivers:** criteria 13 (no write happens during the turn; a card event is streamed), 16 (one proposal per call) and 19 (no proposal without the flag).
**Files:** modify `src/tools/crm.ts`, `src/tools/index.ts` (ToolContext gains `crmWrites?`), `src/graph/research.ts` (**only** the `buildResearchTools(` call at line 138, passing `crmWrites: deps.crmWrites`), `src/graph/index.ts` (pass `crmWrites` into the research deps next to `crmProvider`, lines 23-24), `src/app/service.ts`; extend `tests/research.test.ts`.
**Kind:** judgement

Verified facts:
- `makeCrmTools(crm, ctx)` builds one LangChain `tool()` per descriptor (`src/tools/crm.ts:38-89`).
- After Task 11, `isReadOnlyTool(d)` (from `src/crm/client.ts`, added by 5f3a50f) is `d.annotations?.readOnlyHint === true`.
- `tool(fn, fields)` calls `fn(input, config)`, where `config` is the run's `ToolRunnableConfig` (`node_modules/@langchain/core/dist/tools/index.d.ts:52-59`).
- The research loop invokes tools with `t.invoke(tc.args, { ...config, signal })` (`src/graph/research.ts:241`).
- The graph's run config carries `metadata: { requestId, sessionId }` (`src/app/service.ts:322`), and LangChain child runs inherit parent metadata. **Check this in the test by asserting the ids the fake store received. If it doesn't hold, fall back to passing `requestId`/`sessionId` through `ToolContext`.**
- Custom events use `dispatchCustomEvent(name, payload, config)` from `@langchain/core/callbacks/dispatch` (already used at `src/graph/research.ts:2,188`). They surface in `streamEvents` v2 as `ev.event === "on_custom_event" && ev.name === name` (`src/app/service.ts:348`).

Changes:
- **`src/tools/crm.ts`:** when `ctx.crmWrites` is set and `!isReadOnlyTool(descriptor)`, the tool body becomes:
  1. `const { requestId, sessionId } = config.metadata`.
  2. `const r = await ctx.crmWrites.propose({ sessionId, requestId, toolset: crm, tool: descriptor.name, args, signal: ctx.signal })`.
  3. `!r.ok` returns `error: <r.error>`. The loop already treats `^error` as a failed call.
  4. Otherwise `await dispatchCustomEvent(CRM_WRITE_PROPOSAL_EVENT, r.view, config)`, then return the fixed text: `PROPOSED, NOT APPLIED (proposal <id>). The counsellor sees a card with this exact change below your answer and will approve or reject it. Say what you proposed; do not say it was done. Do not propose the same change again this turn.`
  5. No evidence chunk is added: a proposal is not evidence.
  - When `ctx.crmWrites` is **unset** and the descriptor is a write, the tool is **not built at all**. That covers two cases: the write flag is off, or the wiring is missing. Either way no path executes a write inside the loop.
  - Update the file's header comment to say write tools are proposals.
- **`src/app/service.ts`** (three hunks; send them to the peer first):
  1. `ChatInput` gains `onCrmWriteProposal?: (view: CrmWriteProposalView) => void;` next to `onTool` (line 95).
  2. In `runGraph`'s event loop, next to the THINKING_EVENT branch (line 348), add `else if (ev.event === "on_custom_event" && ev.name === CRM_WRITE_PROPOSAL_EVENT) args.input.onCrmWriteProposal?.(ev.data as CrmWriteProposalView);`, and add `!args.input.onCrmWriteProposal` to the "no callbacks → invoke" guard at line 327.
  3. `ChatServiceDeps` gains `crmWrites?: CrmWriteService`.

- [ ] Step 1: write the failing tests in `tests/research.test.ts`. Use its `fakeCrmProvider` (line 68), giving it one read tool and one write tool (no `readOnlyHint`), and `ScriptedToolModel` from `tests/fakes.ts:13` scripted to call the write tool. Tests:
  - With `crmWrites` set to a real `CrmWriteService` over `InMemoryCrmWriteProposalStore` and a fake toolset, the fake toolset receives exactly one call, carrying the dryRun meta. It never receives a call without meta. The store holds one pending proposal whose `requestId`/`sessionId` match the run metadata. The ToolMessage the model sees starts with `PROPOSED, NOT APPLIED`.
  - Two write calls in one round produce two proposals (criterion 16).
  - With `crmWrites` unset, the write tool is absent from the tools bound to the model, and the read tool is still present.
  - A streamed run (`service.chat` with `onCrmWriteProposal` set, via `fakeGraph` in `tests/helpers.ts`) calls `onCrmWriteProposal` once with a view whose `status` is `pending`.
- [ ] Step 2: `bun test tests/research.test.ts`. Expected: FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: `bun test && bun run typecheck`. Expected: PASS.
- [ ] Step 5: commit `feat(crm): turn CRM write tool calls into proposals, never writes`.

## Task 16: stream event, decision route, expiry on the next message, history, wiring
**Delivers:** criteria 13 (event on the wire), 14, 15, 17 (expiry on the next message) and 18 over HTTP, and the history reload behind all the cards.
**Files:** modify `src/app/routes.ts`, `src/app/http.ts`, `src/app.ts`, `src/app/service.ts`, `src/server.ts`, `README.md`; create `tests/crm-writes.test.ts`.
**Kind:** judgement

Changes (send each hunk to the peer first):
- **`routes.ts` chatStream:** add `onCrmWriteProposal: (view) => sse.send("crm_write_proposal", view),` beside `onTool` (line 232).
- **`routes.ts`:**
  - `RouteDeps` gains `crmWrites?: CrmWriteService`.
  - New handler `crmWriteDecision(req, ctx, proposalId)`:
    - 503 `crm_writes_disabled` when `crmWrites` is unset;
    - body parsed with `CrmWriteDecisionSchema`;
    - `actorEmail = ctx.ownerId`, which must contain `@`, otherwise 404, the same rule as `service.ts:316`;
    - `not_found` → `ApiError(404, "proposal_not_found", …)`;
    - `conflict` → `json(view, 409)`;
    - `ok` → `json(view)`;
    - `Object.assign(ctx.details, { proposalId, decision, status })`.
- **`routes.ts` getSession:** before `messages.map` (line 313), `const writes = d.crmWrites ? await d.crmWrites.viewsForSession(sessionId) : new Map()`. On AI messages, add `...(writes.get(String(m.metadata?.requestId)) ? { crmWrites: writes.get(String(m.metadata?.requestId)) } : {})`. The peer adds `guideStep` in the same map, so re-read first.
- **`http.ts`:** `export const CrmWriteDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();` next to the other request schemas.
- **`app.ts`:** a route `"/v1/crm/writes/:id/decision": { POST: guard((req, ctx, id) => routes.crmWriteDecision(req, ctx, id!)) }` beside `/v1/feedback` (line 221). Copy the guard options of `/v1/feedback`.
- **`service.ts` `chat()`:**
  - right after `getOrCreateSession` (line 173), `await this.d.crmWrites?.expireSession(session.id).catch((err) => this.d.logger.warn("expiring CRM write proposals failed", { err }))`. That delivers criterion 17's "sends another chat message". The 30-minute half is enforced in `decide`.
  - Then, after `getMessages` (line 187): when `crmWrites` is set, fetch `viewsForSession(session.id)`. For each stored AI message whose `metadata.requestId` has views, append `"\n\n" + decisionNote(views)` to the content **of the copy passed to `toWindowedMessages`** only, never to the stored message. That delivers criterion 15, "Edge tells the model the write was declined".
- **`server.ts`:**
  - after `createCrmProvider` (lines 122-133), when `env.CRM_ENABLED && env.CRM_WRITE_TOOLS_ENABLED`:
    - `const crmWrites = new CrmWriteService({ store: new MongoCrmWriteProposalStore(db.collection("crm_write_proposals")), crm: crmProvider, logger })`;
    - then `await ensureCrmWriteProposalIndexes(db).catch(warn)`;
  - otherwise `crmWrites = undefined`;
  - pass it to `buildGraph` (research deps), `new ChatService({... crmWrites })` and `createApp({... crmWrites })`.
- **`README.md`:** in the events section (lines 94-122), document `crm_write_proposal` and `POST /v1/crm/writes/:id/decision`, with the payload and status codes from the wire contract above.

- [ ] Step 1: write the failing `tests/crm-writes.test.ts`. Build the app as `tests/app.test.ts:39-60` does (`fakeGraph`, `InMemoryChatStore`, `createApp`), with a `CrmWriteService` over `InMemoryCrmWriteProposalStore` and a scripted toolset:
  - A streamed turn whose model calls a write tool emits one `crm_write_proposal` NDJSON line before `done`, with `status: "pending"` and the preview's changes.
  - `POST /v1/crm/writes/:id/decision {decision:"approve"}` → 200 `status: "applied"`; the toolset saw `expectedVersion`.
  - The same POST again → 409.
  - Reject → 200 `rejected`, and the toolset saw no execute call.
  - Another user (a different `x-user-id` with the api key, as the auth tests do) → 404.
  - A new chat message in the same session expires a pending proposal: approving it afterwards → 409 `expired`.
  - Past `expiresAt` (inject `now`) → 409 `expired`.
  - A stale scripted response → 200 `stale`, with `current`.
  - `GET /v1/sessions/:id` carries `crmWrites` on the assistant message with the final status.
  - After a reject, the next turn's model input (`ScriptedToolModel.seen`) contains `The counsellor rejected:`.
  - With `crmWrites` unset, the decision route → 503.
- [ ] Step 2: `bun test tests/crm-writes.test.ts`. Expected: FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: `bun test && bun run typecheck`. Expected: PASS across the whole suite.
- [ ] Step 5: commit `feat(crm): stream write proposals and decide them over HTTP`.

---

# Part 3: chat frontend (worktree `/var/www/projects/heubert/expert-chatbot-frontend-crm-approvals`, branch `feat/crm-write-approvals`)

Run everything from the worktree root; `node_modules` is a symlink to the `-ux` checkout's. Per-task checks are `bun test`, `npm run lint` and `npm run build`. Commit style: `feat(chat): …` with the co-author line.

## Task 17: types, stream event, reducer, history
**Delivers:** the client state for criteria 13–18: cards appear during the stream, survive reload, and update on decision.
**Files:** modify `lib/edge/types.ts`, `lib/edge/stream.ts`, `lib/edge/api.ts`, `hooks/use-chat.tsx`; create `lib/edge/crm-writes.ts`, `lib/edge/crm-writes.test.ts`.
**Kind:** judgement

- [ ] Step 1: in `lib/edge/types.ts`, add the mirror of Edge's `src/crm/approvals/types.ts`: `CrmWriteValue`, `CrmWriteChange`, `CrmWriteStatus` and `CrmWriteProposalView`, spelled exactly as in the wire contract, with a comment naming the backend file. Then add:
  - `crmWrites?: CrmWriteProposalView[]` to `HistoryMessage` (line 137);
  - `crmWrites?: CrmWriteProposalView[]` to `ChatMessage` (line 201).
- [ ] Step 2: write the failing `lib/edge/crm-writes.test.ts` (bun:test, like `lib/edge/reasoning.test.ts`) for this module:

```ts
// lib/edge/crm-writes.ts
export function upsertProposal(list: CrmWriteProposalView[] | undefined, view: CrmWriteProposalView): CrmWriteProposalView[]; // replace by proposalId, else append; never reorders
export function isDecidable(view: CrmWriteProposalView, now: Date): boolean;              // status === "pending" && now < expiresAt
export function expireAll(list: CrmWriteProposalView[] | undefined, now: Date): CrmWriteProposalView[] | undefined; // pending → expired (client-side echo of the server's next-message rule)
export function statusLabel(view: CrmWriteProposalView): string; // "Waiting for your approval" | "Applying…" | "Applied" | "Rejected" | "Expired, not applied" | "Not applied: the record changed" | "Failed: <error>"
export function formatValue(v: CrmWriteValue): string;           // null → "(empty)", boolean → "Yes"/"No"
```

  Assertions:
  - `upsertProposal` appends two different ids in order, and replaces an existing id in place.
  - `isDecidable` is false at `expiresAt` itself and false for `applied`.
  - `expireAll` leaves `applied` alone and turns `pending` into `expired`.
  - `statusLabel` returns exactly `Expired, not applied` and `Not applied: the record changed`.
- [ ] Step 3: `bun test lib/edge/crm-writes.test.ts`. Expected: FAIL (module not found).
- [ ] Step 4: implement `lib/edge/crm-writes.ts`. Then:
  - `lib/edge/stream.ts`: add `onCrmWriteProposal?: (view: CrmWriteProposalView) => void` to `StreamChatOptions` (lines 11-41) and `case "crm_write_proposal": options.onCrmWriteProposal?.(parsed.data as CrmWriteProposalView); break;` to the switch (lines 190-229).
  - `lib/edge/api.ts`: `decideCrmWrite(proposalId: string, decision: "approve" | "reject"): Promise<CrmWriteProposalView>`. It POSTs to `/api/crm-writes/${proposalId}/decision` with the `request<T>()` helper (line 15). A 409 resolves with the returned view instead of throwing: read `EdgeApiError`'s body, or do a plain `fetch` and accept both 200 and 409.
  - `hooks/use-chat.tsx`:
    - in `send()` (lines 158-265), pass `onCrmWriteProposal: (view) => patch(assistantId, (m) => ({ crmWrites: upsertProposal(m.crmWrites, view) }))`;
    - at the start of `send()`, before the new user message is added, `setMessages(ms => ms.map(m => m.crmWrites ? { ...m, crmWrites: expireAll(m.crmWrites, new Date()) } : m))`, which mirrors criterion 17;
    - in `fromHistory` (lines 48-73), `crmWrites: m.crmWrites ?? []`;
    - export a `decideCrmWrite(messageId, proposalId, decision)` from the hook. It first patches that card to `status: "applying"` (optimistic), then calls `api.decideCrmWrite`, then `upsertProposal` with the response. On a network error it restores `pending` and shows a `toast.error`.
- [ ] Step 5: `bun test && npm run lint`. Expected: PASS, no lint errors.
- [ ] Step 6: commit `feat(chat): receive, hold and restore CRM write proposals`.

## Task 18: the approval card and its proxy route
**Delivers:** criteria 13–18 as the counsellor sees them.
**Files:** create `app/api/crm-writes/[id]/decision/route.ts`, `components/chat/crm-write-card.tsx`; modify `components/chat/assistant-message.tsx`.
**Kind:** judgement

- **Proxy route:** copy `app/api/sessions/[id]/route.ts:1-25`, including `type Params = { params: Promise<{ id: string }> }`, the `isUuid` check and `proxyJson`. Add `POST(req, { params })`:
  - it validates the body `{ decision: "approve" | "reject" }` and returns 400 otherwise;
  - then `proxyJson(req, \`/v1/crm/writes/${id}/decision\`, { method: "POST", body: { decision } })`;
  - `proxyJson` relays the 409 status and body unchanged (`lib/edge/server.ts:25-55`).
- **`CrmWriteCard({ view, onDecide })`**, following `components/chat/feedback-buttons.tsx:24-121` for busy state, `toast` and `track()`:
  - **Header:** a teal CRM chip style (`border-teal/40 bg-teal-tint text-teal-foreground`, `citation-chip.tsx:44`), the tool's human title (`crm_update_contact` → "Update contact"; use a small map, and for anything unknown strip `crm_` and replace `_` with spaces), then `view.target.label`, plus `· <parentLabel>` when present.
  - **Body:** a two-column table of `changes`, `label | before → after`, using `formatValue`. For a create (`target.id === null`), render the header "New record" and show only `after`.
  - **When `stale`:** a second table, "Current values in the CRM", built from `view.current`.
  - **Footer:** when `isDecidable(view, now)`, an `Approve` button (`Button variant="teal" size="sm"`) and a `Reject` button (`variant="outline" size="sm"`), both disabled while `status === "applying"`. Otherwise, `statusLabel(view)`, with `success` tokens for applied, `warning` for expired and stale, and `destructive` for failed.
  - `now` re-evaluates every 30 s via `setInterval`, so a card crosses its `expiresAt` without a reload.
  - `aria-live="polite"` on the status line.
- **`assistant-message.tsx`:** render `message.crmWrites?.map(v => <CrmWriteCard key={v.proposalId} view={v} onDecide={(d) => decideCrmWrite(message.id, v.proposalId, d)} />)` between the Markdown body (line 132) and the error box (line 142). The cards show on every assistant message, not only the newest, so a reopened thread shows its decided cards.
- [ ] Step 1: `bun test && npm run lint && npm run build`. Expected: all PASS. `next build` also type-checks.
- [ ] Step 2: manual check against a local Edge (`bun --hot src/index.ts` or the worktree's dev script) with `CRM_WRITE_TOOLS_ENABLED=true` and a fake or PR-680 CRM. Follow the dev-serve and cookie approach in memory `edge-chat-ux-redesign`.
  1. Ask for a note to be logged: exactly one card appears, and nothing is written yet.
  2. Approve: the card shows "Applied".
  3. Ask again, then send another message instead of deciding: the card shows "Expired, not applied".
  4. Reload: the cards keep their statuses.
- [ ] Step 3: commit `feat(chat): approval card for CRM write proposals`.

---

# Part 4: ship to PR-680

## Task 19: switch writes on for PR-680, migrate, deploy, smoke
**Delivers:** criterion 20, and the live check of criteria 1–19.
**Files:** crm-api Helm values for the PR-680 environment (find which values file the PR environment renders; `helm/crm-api/values-dev.yaml:66` holds `mcp.writeToolsEnabled: false` today), and Edge `helm/expert-ai-consultant/values-prod.yaml` (`CRM_WRITE_TOOLS_ENABLED: "true"` beside the CRM block at lines 75-95), synced into `gitops-prod` as the deploy memory describes.
**Kind:** judgement. Each outward step needs the developer's explicit go at the time: pushing crm-api, pushing and merging Edge, bumping gitops, and the ArgoCD sync, which the developer runs.

- [ ] Step 1: rebase the Edge branch onto the guided-journey branch (`feat/guided-journey`, at 3b10389 or wherever it has moved) if that branch has merged to master by then; otherwise rebase onto master. Then `bun test && bun run typecheck`. Resolve any overlap in `routes.ts`/`service.ts` by keeping both sides' hunks.
- [ ] Step 2: crm-api, run `npx jest` and `npm run test:e2e -- mcp` once more. Then, **on the developer's go**, `git push origin CRM-1220-mcp-server`. Watch the rollout: `kubectl --context arn:aws:eks:ap-southeast-1:<AWS_ACCOUNT_ID>:cluster/hb-staging-apse1 -n pr-680-cluster get pods -o 'custom-columns=N:.metadata.name,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount,IMG:.spec.containers[0].image'`. Quote the columns argument: zsh globs `[0]` otherwise. Pass when both `crm-api` and `worker-api` run the new tag, are ready and show 0 restarts, and the logs contain `Nest application successfully started`.
- [ ] Step 3: run the tenant migration `1790580000000-CreateMcpAuditLogs` on the PR-680 tenant (`npm run migrate -- -d <pr-680 tenant domain>`, run in the crm-api pod with `kubectl exec`, or however PR environments run migrations; ask the developer if unclear). Pass when `npm run migrate -- -s` lists it as run.
- [ ] Step 4: set `MCP_WRITE_TOOLS_ENABLED=true` for PR-680 only, then push or redeploy it. Pass when `tools/list` from Edge includes the six write tools. Check that by looking at an Edge answer's reasoning trace, or at the tool list Edge logs.
- [ ] Step 5: Edge: on the developer's go, merge to master, then CodeBuild, then bump the tag in `gitops-prod` with `CRM_WRITE_TOOLS_ENABLED: "true"`. The developer runs the ArgoCD sync. Frontend: merge `feat/crm-write-approvals` to main and deploy it the way the frontend deploys (the `gitops-prod` branch in that repo).
- [ ] Step 6: smoke list on https://edge.heubertapp.com, signed in as one of the three seeded accounts. Tick each item:
  1. "What's next for <seeded student>?": the answer includes application stage, next stage and missing documents, each cited (criteria 1, 2).
  2. "What happened recently with <student>?": activity entries, newest first (3).
  3. Ask about a student outside the account's caseload: "cannot find or access" (4).
  4. "What's on my plate today?": visits, notifications and counts (6, 7, 8). Compare the task counts with the CRM's task screen.
  5. "Who can I assign <student> to?" (9).
  6. "Find <subject> courses at <institution> and compare two of them" (10, 11), then ask about a course the KB also covers (12).
  7. For each of the six writes, ask Edge to do it and check the card shows the exact change. Approve it, check it shows Applied, and confirm in the CRM that the record changed and that an `mcp_audit_logs` row exists (13, 14, 20).
  8. Reject one: nothing changes, and the next answer knows it was rejected (15).
  9. Two writes in one ask give two cards, decided separately (16).
  10. Leave a card and send another message: "Expired, not applied" (17).
  11. Edit the record in the CRM between the card and the approve: "Not applied: the record changed", with the current values (18).
  12. Set `CRM_WRITE_TOOLS_ENABLED=false` for one pod or locally: no write is proposed (19).

---

## Criteria coverage
| Criterion | Task | Test that proves it |
| --- | --- | --- |
| 1 application stage, next, assignees | 3 | `application-tools.spec.ts`: `crm_get_application` currentStage/next; smoke 1 |
| 2 required docs uploaded/missing | 4 | `document-tools.spec.ts`: Passport uploaded / IELTS missing; smoke 1 |
| 3 recent activity newest first | 5 | `get-activity-timeline.tool.spec.ts`: merged newest first; smoke 2 |
| 4 hidden contact reveals nothing | 3, 4, 5 | the not-visible cases in the three specs; smoke 3 |
| 5 overview includes applications | 3 | `application-tools.spec.ts`: overview `applications` |
| 6 today's visits under the branch/assignee rule | 6 | `list-office-visits.tool.spec.ts`: B1 visits plus assigned B2 visit, not unassigned B2; smoke 4 |
| 7 own unread notifications only | 7 | `me-tools.spec.ts`: `receiverId === ctx.user.id`; smoke 4 |
| 8 task and enquiry counts | 7 | `me-tools.spec.ts`: three task filters, enquiry split; smoke 4 (compare with the CRM task screen) |
| 9 assignable users | 8 | `list-assignees.tool.spec.ts`; smoke 5 |
| 10 course search with fees and intakes | 9 | `course-tools.spec.ts`: search and filters; smoke 6 |
| 11 course compare | 9 | `course-tools.spec.ts`: compare 2–5, missingIds; smoke 6 |
| 12 KB vs CRM disagreement shows both | 9 | `course-tools.spec.ts`: descriptions contain "show both values, each cited"; smoke 6. Not automatable end to end: it depends on what the model does |
| 13 card instead of a write, exact changes | 1, 2, 15, 16, 18 | `mcp.dispatcher.spec.ts` dry run; `write-previews.spec.ts`; `research.test.ts` dryRun-only calls; `crm-writes.test.ts` proposal event; card rendering is Manual (no browser test setup), smoke 7 |
| 14 approve applies and audits | 1, 14, 16 | `mcp.dispatcher.spec.ts` matching version audits once; `crm-approvals.test.ts` approve → applied; `crm-writes.test.ts` approve → 200 applied; smoke 7 |
| 15 reject: nothing written, model told | 14, 16 | `crm-approvals.test.ts` reject never calls the toolset; `crm-writes.test.ts` next turn's input contains "The counsellor rejected:"; smoke 8 |
| 16 one card per write | 15, 17 | `research.test.ts` two calls → two proposals; `crm-writes.test.ts`; `crm-writes.test.ts` (frontend) `upsertProposal` appends; smoke 9 |
| 17 expiry on next message or 30 min | 14, 16, 17 | `crm-writes.test.ts` new message → 409 expired, past `expiresAt` → expired; frontend `expireAll`; smoke 10 |
| 18 stale record not applied, current shown | 1, 14, 16 | `mcp.dispatcher.spec.ts` stale → STALE_RECORD with preview; `crm-approvals.test.ts` stale → `current`; `crm-writes.test.ts` stale → 200 stale; smoke 11 |
| 19 no writes when either flag is off | 1, 11, 15 | `mcp.dispatcher.spec.ts` dry run refused when switched off; `crm.test.ts` filter with the flag off; `research.test.ts` no crmWrites → write tool absent; smoke 12 |
| 20 all six apply on PR-680 with audit rows | 2, 19 | `write-previews.spec.ts` (all six preview); applying on the real tenant is Manual: no local CRM database, smoke 7 |
