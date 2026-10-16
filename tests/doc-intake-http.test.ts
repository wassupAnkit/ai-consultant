import { DirectUploads, type UploadObjectStore } from "../src/documents/student/direct-upload";
import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { CrmWriteService } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import type { CrmCallOptions, CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { CrmStudentReader } from "../src/crm/student";
import { InMemoryFileStore } from "../src/documents/store";
import { createFileCipher } from "../src/documents/student/crypto";
import type { DocumentRead } from "../src/documents/student/extract";
import { StudentDocumentService } from "../src/documents/student/service";
import { InMemoryStudentDocumentStore } from "../src/documents/student/store";
import { newGuide } from "../src/journey/guide";
import type { GenerateRequest } from "../src/llm/generate";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { FakeGemini, fakeToolset } from "./fakes";
import { blankRead, passportRead } from "./fixtures/documents/reads";
import { CITIZENSHIP } from "./fixtures/documents/specimens";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const API_KEY = "test-api-key-0123456789abcdef0123456789";
const JANE = "jane@heubert.com";
const BOB = "bob@heubert.com";
const CONTACT = "0b6f3d1e-1111-4222-8333-444455556666";
const APP_ID = "app-1";
const SECRET = "url-secret-0123456789abcdef0123456789";

const png = (marker: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker, marker, marker]);
const PASSPORT_PNG = png(1);
const CITIZENSHIP_PNG = png(2);
const OTHER_PNG = png(3);

const citizenshipRead: DocumentRead = {
  ...blankRead,
  documentType: "national_id",
  idKind: "nepal_citizenship",
  issuingCountry: "Nepal",
  fullName: CITIZENSHIP.fullName,
  sex: "M",
  dateOfBirth: CITIZENSHIP.dobBs,
  dateCalendar: "bikram_sambat",
  nationalIdNumber: CITIZENSHIP.number,
  issueDate: CITIZENSHIP.issueBs,
  fatherName: CITIZENSHIP.father,
  motherName: CITIZENSHIP.mother,
  address: { line: CITIZENSHIP.ward, city: CITIZENSHIP.municipality, district: CITIZENSHIP.district, state: null, postalCode: null, country: null },
};
const READS = new Map<string, DocumentRead>([
  [Buffer.from(PASSPORT_PNG).toString("base64"), passportRead()],
  [Buffer.from(CITIZENSHIP_PNG).toString("base64"), citizenshipRead],
  [Buffer.from(OTHER_PNG).toString("base64"), { ...blankRead, documentType: "other", idKind: "not_identity_document" }],
]);

const read = (name: string): CrmToolDescriptor => ({ name, description: name, inputSchema: { type: "object", properties: {} } as never, annotations: { readOnlyHint: true } });
const write = (name: string): CrmToolDescriptor => ({ name, description: name, inputSchema: { type: "object", properties: {} } as never, annotations: { readOnlyHint: false } });

const apps: { shutdown: (ms?: number) => Promise<void> }[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.shutdown(0);
});

function setup(opts: { attachTool?: boolean; crmContact?: Record<string, unknown>; activity?: unknown; directUpload?: boolean } = {}) {
  const env = testEnv({ API_KEY, ADMIN_EMAILS: "admin@heubert.com" });
  const calls: { name: string; args: Record<string, unknown>; opts?: CrmCallOptions }[] = [];
  const contact = { id: CONTACT, name: "Sita Kumari Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal", countryOfPassport: null, country: "Nepal", city: null, ...opts.crmContact };
  const answer = (name: string, args: Record<string, unknown>, o?: CrmCallOptions): CrmToolResult => {
    if (name === "crm_get_contact") return { text: "contact", isError: false, structured: { contact } };
    if (name === "crm_get_student_overview") return { text: "overview", isError: false, structured: { contact, deals: [], applications: [{ id: APP_ID, status: "active", institution: { name: "Example University" }, course: { name: "BIT" } }] } };
    if (name === "crm_get_application_checklist") return { text: "checklist", isError: false, structured: { applicationId: APP_ID, stage: { id: "s", name: "Offer" }, items: [{ name: "Passport", required: true, uploaded: false }, { name: "Transcript", required: true, uploaded: true }], missingRequired: 1 } };
    if (o?.meta?.["heubert/dryRun"]) {
      if (name === "crm_attach_contact_document") return { text: "p", isError: false, structured: { preview: { tool: name, target: { entity: "document", id: CONTACT, label: "Sita Shrestha", parentLabel: args.documentType }, changes: [{ field: "document", label: args.documentType, before: null, after: args.fileName }], version: null } } };
      if (name === "crm_create_note") return { text: "p", isError: false, structured: { preview: { tool: name, target: { entity: "note", id: null, label: "New note", parent: { entity: "contact", id: CONTACT, label: "Sita Shrestha" } }, changes: [{ field: "description", label: "Note", before: null, after: args.description }], version: null } } };
      const { id: _id, ...fields } = args;
      return { text: "p", isError: false, structured: { preview: { tool: name, target: { entity: "contact", id: CONTACT, label: "Sita Shrestha" }, changes: Object.entries(fields).map(([field, after]) => ({ field, label: field, before: null, after })), version: "v1" } } };
    }
    return { text: "done", isError: false, structured: { mediaId: "m1" } };
  };
  const descriptors = [read("crm_get_contact"), read("crm_get_student_overview"), read("crm_get_application_checklist"), write("crm_update_contact"), write("crm_create_note"), ...(opts.attachTool === false ? [] : [write("crm_attach_contact_document")])];
  const toolset = fakeToolset(answer, (name, args, o) => calls.push({ name, args, ...(o ? { opts: o } : {}) }), descriptors, JANE);
  const provider: CrmProvider = { forActor: async (email) => (email?.toLowerCase() === JANE ? toolset : undefined) };

  const docStore = new InMemoryStudentDocumentStore();
  const files = new InMemoryFileStore();
  const clock = { t: new Date("2026-10-12T08:00:00Z") };
  const studentDocs = new StudentDocumentService({ store: docStore, files, cipher: createFileCipher({ key: Buffer.alloc(32, 3).toString("base64") }), urlSecret: SECRET, publicBaseUrl: "https://edge.example.com", maxBytes: 64, now: () => clock.t });
  const gemini = new FakeGemini((req: GenerateRequest) => {
    const data = (req.parts[0] as { inlineData: { data: string } }).inlineData.data;
    const json = READS.get(data) ?? { nope: true };
    return { text: JSON.stringify(json), json, finishReason: "STOP", usage: { input: 1, output: 1, total: 2 } };
  });
  const proposals = new InMemoryCrmWriteProposalStore();
  const crmWrites = new CrmWriteService({
    store: proposals,
    crm: provider,
    logger: createLogger({ test: true }),
    now: () => clock.t,
    prepareArgs: (p) => (p.tool === "crm_attach_contact_document" && p.origin ? { ...p.args, fileUrl: studentDocs.signedUrl(p.origin.attachmentId) } : p.args),
    onStatus: (p) => {
      if (p.origin) void studentDocs.recordCrmActions(p.origin.attachmentId, [{ proposalId: p.id, tool: p.tool, status: p.status, at: clock.t, ...(p.edited ? { edited: p.edited } : {}) }]);
    },
  });
  const { graph } = fakeGraph({
    intent: intentOf({ primary_intent: "caseload_management", user_question: "Read the attached documents.", task: "lookup", needs_research: false }),
    answer: "The CRM record [1], the passport [2] and the checklist [3].",
    crmProvider: provider,
    crmWrites,
    documents: { documents: studentDocs, gen: gemini, model: "gemini-doc", now: () => clock.t },
  });
  const store = new InMemoryChatStore();
  const students = new CrmStudentReader({ provider });
  const service = new ChatService({ env, graph, store, logger: createLogger({ test: true }), crmWrites, students, ...(opts.activity ? { activity: opts.activity as ConstructorParameters<typeof ChatService>[0]["activity"] } : {}) });
  // A fake bucket: the test plays the browser by putting bytes at the presigned key.
  const objects = new Map<string, Uint8Array>();
  const s3: UploadObjectStore = {
    presignPost: async (key, o) => ({ url: "https://bucket.s3.example.com/", fields: { key, "Content-Type": o.mimeType, policy: "p", "x-amz-signature": "s" } }),
    get: async (key) => objects.get(key) ?? null,
    delete: async (key) => void objects.delete(key),
  };
  const directUploads = opts.directUpload === false ? undefined : new DirectUploads({ store: s3, secret: SECRET, maxBytes: 64, now: () => clock.t });
  const app = createApp(
    { env, service, store, knowledge: new NullKnowledgeStore([sampleChunk()]), collections: null, logger: createLogger({ test: true }), readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now(), crmWrites, students, studentDocs, directUploads },
    { port: 0, hostname: "127.0.0.1" },
  );
  apps.push(app);
  const base = `http://127.0.0.1:${app.server.port}`;
  const auth = (user = JANE) => ({ "x-api-key": API_KEY, "x-user-id": user });
  const upload = async (bytes: Uint8Array, name = "passport.png", user = JANE, type = "image/png") => {
    const form = new FormData();
    form.append("file", new File([bytes], name, { type }));
    const r = await fetch(`${base}/v1/chat/attachments`, { method: "POST", headers: auth(user), body: form });
    return { status: r.status, body: (await r.json()) as any };
  };
  const stream = async (body: Record<string, unknown>, user = JANE) => {
    const r = await fetch(`${base}/v1/chat/stream?format=ndjson`, { method: "POST", headers: { ...auth(user), "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status !== 200) return { status: r.status, lines: [] as { event: string; data: any }[], body: (await r.json()) as any };
    return { status: r.status, lines: (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; data: any }), body: null };
  };
  const guidedSession = async () => {
    const s = await store.getOrCreateSession(undefined, JANE);
    await store.startGuide(s.id, JANE, newGuide(CONTACT));
    return s.id;
  };
  const post = async (path: string, body: unknown, user = JANE) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { ...auth(user), "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { base, auth, upload, stream, guidedSession, studentDocs, docStore, files, gemini, calls, clock, proposals, store, objects, post };
}

describe("direct upload (browser → S3 → Edge)", () => {
  test("slot → file in the bucket → complete: stored like a multipart upload, S3 copy deleted", async () => {
    const s = setup();
    const start = await s.post("/v1/chat/attachments/uploads", { fileName: "passport.png", mimeType: "image/png", sizeBytes: PASSPORT_PNG.length });
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ url: "https://bucket.s3.example.com/", fields: { "Content-Type": "image/png" } });
    const key = start.body.fields.key as string;
    expect(key).toBe(`incoming/${start.body.uploadId}`);

    // Before the browser has posted the file.
    expect((await s.post("/v1/chat/attachments/uploads/complete", { ticket: start.body.ticket })).status).toBe(409);

    s.objects.set(key, PASSPORT_PNG);
    const done = await s.post("/v1/chat/attachments/uploads/complete", { ticket: start.body.ticket });
    expect(done.status).toBe(201);
    expect(done.body.attachment).toMatchObject({ fileName: "passport.png", mimeType: "image/png", sizeBytes: PASSPORT_PNG.length });
    expect(s.objects.has(key)).toBe(false);
    // The same bytes through multipart dedupe onto the same record.
    expect((await s.upload(PASSPORT_PNG)).body.attachment.id).toBe(done.body.attachment.id);
  });

  test("type, size, owner, expiry and a swapped file are all refused", async () => {
    const s = setup();
    expect((await s.post("/v1/chat/attachments/uploads", { fileName: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 10 })).status).toBe(415);
    expect((await s.post("/v1/chat/attachments/uploads", { fileName: "big.png", mimeType: "image/png", sizeBytes: 65 })).status).toBe(413);

    const start = await s.post("/v1/chat/attachments/uploads", { fileName: "p.png", mimeType: "image/png", sizeBytes: PASSPORT_PNG.length });
    s.objects.set(start.body.fields.key, PASSPORT_PNG);
    // Another counsellor cannot complete it, and a tampered ticket fails the signature.
    expect((await s.post("/v1/chat/attachments/uploads/complete", { ticket: start.body.ticket }, BOB)).body.error.code).toBe("invalid_ticket");
    expect((await s.post("/v1/chat/attachments/uploads/complete", { ticket: `${start.body.ticket}x` })).body.error.code).toBe("invalid_ticket");

    // A different file than announced is refused and removed.
    const swapped = await s.post("/v1/chat/attachments/uploads", { fileName: "q.png", mimeType: "image/png", sizeBytes: 5 });
    s.objects.set(swapped.body.fields.key, PASSPORT_PNG);
    expect((await s.post("/v1/chat/attachments/uploads/complete", { ticket: swapped.body.ticket })).body.error.code).toBe("size_mismatch");
    expect(s.objects.has(swapped.body.fields.key)).toBe(false);

    // A declared image that is not one: the byte sniff still applies.
    const fake = await s.post("/v1/chat/attachments/uploads", { fileName: "f.png", mimeType: "image/png", sizeBytes: 4 });
    s.objects.set(fake.body.fields.key, new Uint8Array([1, 2, 3, 4]));
    const r = await s.post("/v1/chat/attachments/uploads/complete", { ticket: fake.body.ticket });
    expect(r.status).toBe(415);
    expect(s.objects.has(fake.body.fields.key)).toBe(false);

    s.clock.t = new Date(s.clock.t.getTime() + 11 * 60_000);
    expect((await s.post("/v1/chat/attachments/uploads/complete", { ticket: start.body.ticket })).status).toBe(410);
  });

  test("without a bucket the routes say so and multipart still works", async () => {
    const s = setup({ directUpload: false });
    const r = await s.post("/v1/chat/attachments/uploads", { fileName: "p.png", mimeType: "image/png", sizeBytes: 11 });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("direct_upload_disabled");
    expect((await s.upload(PASSPORT_PNG)).status).toBe(201);
  });
});

describe("POST /v1/chat/attachments", () => {
  test("201 with the attachment view; the stored bytes are ciphertext", async () => {
    const s = setup();
    const r = await s.upload(PASSPORT_PNG);
    expect(r.status).toBe(201);
    expect(r.body.attachment).toMatchObject({ fileName: "passport.png", mimeType: "image/png", sizeBytes: PASSPORT_PNG.length, sha256: new Bun.CryptoHasher("sha256").update(PASSPORT_PNG).digest("hex") });
    expect(r.body.attachment.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await s.files.get(r.body.attachment.id);
    expect(Buffer.from(stored!).includes(Buffer.from(PASSPORT_PNG))).toBe(false);
  });

  test("401 anonymous, 415 wrong type, 413 too large, 400 no file", async () => {
    const s = setup();
    const anon = new FormData();
    anon.append("file", new File([PASSPORT_PNG], "p.png"));
    expect((await fetch(`${s.base}/v1/chat/attachments`, { method: "POST", headers: { "x-api-key": API_KEY }, body: anon })).status).toBe(401);
    expect((await s.upload(new TextEncoder().encode("<html>hi</html>"), "x.png")).status).toBe(415);
    expect((await s.upload(new Uint8Array(100).fill(0x89), "big.png")).status).toBe(413);
    const empty = new FormData();
    empty.append("sessionId", "not-a-uuid");
    expect((await fetch(`${s.base}/v1/chat/attachments`, { method: "POST", headers: s.auth(), body: empty })).status).toBe(400);
  });
});

describe("GET attachment and content", () => {
  test("owner reads metadata and bytes; another counsellor gets 404; a listed admin may read", async () => {
    const s = setup();
    const id = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const meta = await fetch(`${s.base}/v1/chat/attachments/${id}`, { headers: s.auth() });
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ id, fileName: "passport.png", extractions: [] });
    const content = await fetch(`${s.base}/v1/chat/attachments/${id}/content`, { headers: s.auth() });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("content-disposition")).toStartWith("inline;");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PASSPORT_PNG);
    expect((await fetch(`${s.base}/v1/chat/attachments/${id}`, { headers: s.auth(BOB) })).status).toBe(404);
    expect((await fetch(`${s.base}/v1/chat/attachments/${id}/content`, { headers: s.auth(BOB) })).status).toBe(404);
    expect((await fetch(`${s.base}/v1/chat/attachments/${id}`, { headers: s.auth("admin@heubert.com") })).status).toBe(200);
  });
});

describe("GET /v1/files/:id (signed)", () => {
  test("valid link serves the bytes without auth; tampered, expired and unknown links do not", async () => {
    const s = setup();
    const id = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const url = new URL(s.studentDocs.signedUrl(id));
    const path = `${s.base}${url.pathname}${url.search}`;
    expect(url.href.length).toBeLessThan(200);
    const ok = await fetch(path);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PASSPORT_PNG);
    expect((await fetch(path.replace(/sig=./, (m) => (m.endsWith("a") ? "sig=b" : "sig=a")))).status).toBe(403);
    expect((await fetch(`${s.base}/v1/files/${id}`)).status).toBe(403);
    const other = s.studentDocs.signedUrl("00000000-0000-4000-8000-000000000000");
    expect((await fetch(`${s.base}${new URL(other).pathname}${new URL(other).search}`)).status).toBe(404);
    s.clock.t = new Date(s.clock.t.getTime() + 11 * 60_000);
    const expired = await fetch(path);
    expect(expired.status).toBe(403);
    expect(((await expired.json()) as any).error.code).toBe("link_expired");
  });
});

describe("chat input validation", () => {
  test("someone else's, unknown, or too many attachments are a 400 before any stream", async () => {
    const s = setup();
    const bobs = (await s.upload(PASSPORT_PNG, "p.png", BOB)).body.attachment.id;
    const mine = (await s.upload(CITIZENSHIP_PNG)).body.attachment.id;
    expect((await s.stream({ message: "Read the attached documents.", attachments: [bobs] })).status).toBe(400);
    expect((await s.stream({ message: "Read the attached documents.", attachments: [mine, "00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    expect((await s.stream({ message: "x", attachments: Array.from({ length: 6 }, () => mine) })).status).toBe(400);
    expect((await s.stream({ message: "x", attachments: ["nope"] })).status).toBe(400);
    expect(s.gemini.requests).toHaveLength(0);
  });
});

describe("a turn with attachments", () => {
  test("guided: one document_extraction per file before the proposal cards, built in code from the CRM diff", async () => {
    const s = setup();
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG, "passport.png")).body.attachment.id;
    const citizenship = (await s.upload(CITIZENSHIP_PNG, "citizenship.png")).body.attachment.id;
    const { status, lines } = await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport, citizenship] });
    expect(status).toBe(200);
    const events = lines.map((l) => l.event);
    expect(lines.find((l) => l.event === "status")?.data).toEqual({ stage: "reading_documents" });
    const docs = lines.filter((l) => l.event === "document_extraction");
    expect(docs.map((d) => d.data.attachmentId)).toEqual([passport, citizenship]);
    const cards = lines.filter((l) => l.event === "crm_write_proposal");
    expect(Math.max(...docs.map((d) => lines.indexOf(d)))).toBeLessThan(lines.indexOf(cards[0]!));
    expect(lines.indexOf(cards.at(-1)!)).toBeLessThan(events.indexOf("done"));
    expect(docs[0]!.data).toMatchObject({ documentType: "passport", crmDocumentType: "Passport", country: "Nepal", holderName: "Sita Kumari Shrestha", warnings: [] });
    expect(cards.map((c) => c.data.tool)).toEqual(["crm_update_contact", "crm_create_note", "crm_attach_contact_document", "crm_update_contact", "crm_create_note", "crm_attach_contact_document"]);
    // Name, date of birth, gender and nationality already match the CRM: only the passport fields are proposed.
    const dryRuns = s.calls.filter((c) => c.opts?.meta?.["heubert/dryRun"]);
    expect(dryRuns[0]!.args).toEqual({ id: CONTACT, passportNo: "PX0012345", countryOfPassport: "Nepal", passportExpiryDate: "2032-04-15" });
    const attach = dryRuns.find((c) => c.name === "crm_attach_contact_document")!.args;
    expect(attach).toMatchObject({ contactId: CONTACT, documentType: "Passport", category: "Personal", fileName: "passport.png", mimeType: "image/png", sizeBytes: PASSPORT_PNG.length });
    expect(String(attach.fileUrl)).toStartWith(`https://edge.example.com/v1/files/${passport}?exp=`);
    // The citizenship holder is someone else: the counsellor is told.
    expect(docs[1]!.data.warnings.map((w: { code: string }) => w.code)).toEqual(["name_mismatch_crm"]);
    // Nothing was written.
    expect(s.calls.filter((c) => !c.opts?.meta?.["heubert/dryRun"] && !c.name.startsWith("crm_get"))).toEqual([]);
    // History on the stored documents.
    const rec = (await s.docStore.get(passport))!;
    expect(rec.contactId).toBe(CONTACT);
    expect(rec.extractions).toHaveLength(1);
    expect(rec.crmActions.map((a) => `${a.tool}:${a.status}`)).toEqual(["crm_update_contact:pending", "crm_create_note:pending", "crm_attach_contact_document:pending"]);
  });

  test("approving the attach card mints a fresh signed link and records the outcome on the document", async () => {
    const s = setup();
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const { lines } = await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport] });
    const card = lines.find((l) => l.event === "crm_write_proposal" && l.data.tool === "crm_attach_contact_document")!.data;
    const proposedUrl = String(s.calls.find((c) => c.name === "crm_attach_contact_document")!.args.fileUrl);
    s.clock.t = new Date(s.clock.t.getTime() + 20 * 60_000);
    const r = await fetch(`${s.base}/v1/crm/writes/${card.proposalId}/decision`, { method: "POST", headers: { ...s.auth(), "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
    expect(r.status).toBe(200);
    const executed = s.calls.filter((c) => c.name === "crm_attach_contact_document" && !c.opts?.meta?.["heubert/dryRun"]);
    expect(executed).toHaveLength(1);
    const fresh = new URL(String(executed[0]!.args.fileUrl));
    expect(fresh.href).not.toBe(proposedUrl);
    expect((await fetch(`${s.base}${fresh.pathname}${fresh.search}`)).status).toBe(200);
    await Bun.sleep(5);
    expect((await s.docStore.get(passport))!.crmActions.map((a) => a.status)).toEqual(["pending", "pending", "pending", "applied"]);
  });

  test("no student selected: extraction still streams, no proposals, and a no_student_selected warning", async () => {
    const s = setup();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const other = (await s.upload(OTHER_PNG, "transcript.png")).body.attachment.id;
    const { lines } = await s.stream({ message: "Read the attached documents.", newSession: true, attachments: [passport, other] });
    const docs = lines.filter((l) => l.event === "document_extraction").map((l) => l.data);
    expect(docs[0].warnings.map((w: { code: string }) => w.code)).toEqual(["no_student_selected"]);
    expect(docs[1]).toMatchObject({ documentType: "other", crmDocumentType: null, warnings: [{ code: "not_identity_document" }] });
    expect(lines.some((l) => l.event === "crm_write_proposal")).toBe(false);
    expect(s.calls.filter((c) => c.opts?.meta?.["heubert/dryRun"])).toEqual([]);
  });

  test("a CRM without crm_attach_contact_document still gets the other proposals", async () => {
    const s = setup({ attachTool: false });
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const { lines } = await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport] });
    expect(lines.filter((l) => l.event === "crm_write_proposal").map((l) => l.data.tool)).toEqual(["crm_update_contact", "crm_create_note"]);
  });

  test("history: human messages carry attachments, assistant messages the documents as streamed", async () => {
    const s = setup();
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const { lines } = await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport] });
    const streamed = lines.find((l) => l.event === "document_extraction")!.data;
    await Bun.sleep(5);
    const body = (await (await fetch(`${s.base}/v1/sessions/${sessionId}`, { headers: s.auth() })).json()) as { messages: any[] };
    const [human, ai] = body.messages;
    expect(human.attachments).toEqual([expect.objectContaining({ id: passport, fileName: "passport.png", mimeType: "image/png" })]);
    expect(ai.documents).toEqual([streamed]);
    // The attachment's own view lists the extraction run.
    const meta = (await (await fetch(`${s.base}/v1/chat/attachments/${passport}`, { headers: s.auth() })).json()) as any;
    expect(meta.extractions).toHaveLength(1);
    expect(meta.extractions[0]).toMatchObject({ attachmentId: passport, documentType: "passport", holderName: "Sita Kumari Shrestha" });
  });

  test("the answer prompt carries the documents as evidence and the checklist gap", async () => {
    const s = setup();
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    const { lines } = await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport] });
    const done = lines.find((l) => l.event === "done")!.data;
    const titles = done.sources.map((x: { title: string }) => x.title);
    expect(titles).toContain("Passport — passport.png");
    expect(titles).toContain("CRM application checklist");
    const checklist = done.sources.find((x: { title: string }) => x.title === "CRM application checklist");
    expect(checklist.excerpt).toContain("missing required documents: Passport");
    expect(done.sources.find((x: { kind: string }) => x.kind === "document").url).toBe(`attachment://${passport}`);
  });
});

describe("activity log", () => {
  test("a document turn records neither the document text nor the compiled prompt", async () => {
    const turns: Record<string, unknown>[] = [];
    const s = setup({ activity: { turn: (t: Record<string, unknown>) => turns.push(t), event: () => {} } });
    const sessionId = await s.guidedSession();
    const passport = (await s.upload(PASSPORT_PNG)).body.attachment.id;
    await s.stream({ message: "Read the attached documents.", sessionId, attachments: [passport] });
    expect(turns).toHaveLength(1);
    const logged = JSON.stringify(turns[0]);
    expect(logged).not.toContain("PX0012345");
    expect(logged).not.toContain("2032-04-15");
    expect(logged).not.toContain("Kathmandu");
    expect((turns[0]!.prompt as { systemPromptText: unknown }).systemPromptText).toBeNull();
    expect((turns[0]!.meta as { documents: unknown }).documents).toMatchObject({ files: 1, types: ["passport"] });
  });
});
