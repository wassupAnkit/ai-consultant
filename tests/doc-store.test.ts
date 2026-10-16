import { describe, expect, test } from "bun:test";
import { InMemoryFileStore } from "../src/documents/store";
import { createFileCipher } from "../src/documents/student/crypto";
import { signFileUrl, verifyFileSignature } from "../src/documents/student/signing";
import { InMemoryStudentDocumentStore } from "../src/documents/student/store";
import { sniffMimeType, StudentDocError, StudentDocumentService } from "../src/documents/student/service";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const SECRET = "url-secret-0123456789abcdef0123456789";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n");
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const WEBP = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")]);
const HEIC = new Uint8Array([0, 0, 0, 24, ...ascii("ftypheic"), 0, 0, 0, 0]);
const HEIF = new Uint8Array([0, 0, 0, 24, ...ascii("ftypmif1"), 0, 0, 0, 0]);

function service(over: Partial<ConstructorParameters<typeof StudentDocumentService>[0]> = {}) {
  const store = new InMemoryStudentDocumentStore();
  const files = new InMemoryFileStore();
  const clock = { t: new Date("2026-10-12T08:00:00Z") };
  let n = 0;
  const svc = new StudentDocumentService({
    store,
    files,
    cipher: createFileCipher({ key: KEY }),
    urlSecret: SECRET,
    publicBaseUrl: "https://edge.example.com/",
    maxBytes: 1024,
    now: () => clock.t,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    ...over,
  });
  return { svc, store, files, clock };
}

describe("sniffMimeType", () => {
  test("reads the type from the bytes, not the name", () => {
    expect(sniffMimeType(PNG)).toBe("image/png");
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
    expect(sniffMimeType(PDF)).toBe("application/pdf");
    expect(sniffMimeType(WEBP)).toBe("image/webp");
    expect(sniffMimeType(HEIC)).toBe("image/heic");
    expect(sniffMimeType(HEIF)).toBe("image/heif");
    expect(sniffMimeType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("file cipher", () => {
  test("round-trips, and fails closed on tampering, another id, another owner or another key", async () => {
    const cipher = createFileCipher({ key: KEY });
    const blob = await cipher.encrypt(PNG, { id: "a", ownerId: "jane@heubert.com" });
    expect(Buffer.from(blob).includes(Buffer.from(PNG))).toBe(false);
    expect(await cipher.decrypt(blob, { id: "a", ownerId: "JANE@heubert.com" })).toEqual(PNG);
    const flipped = new Uint8Array(blob);
    flipped[20] = flipped[20]! ^ 1;
    await expect(cipher.decrypt(flipped, { id: "a", ownerId: "jane@heubert.com" })).rejects.toThrow();
    await expect(cipher.decrypt(blob, { id: "b", ownerId: "jane@heubert.com" })).rejects.toThrow();
    await expect(cipher.decrypt(blob, { id: "a", ownerId: "bob@heubert.com" })).rejects.toThrow();
    await expect(createFileCipher({ key: OTHER_KEY }).decrypt(blob, { id: "a", ownerId: "jane@heubert.com" })).rejects.toThrow();
  });

  test("a previous key still decrypts after rotation", async () => {
    const old = createFileCipher({ key: OTHER_KEY, kid: "k0" });
    const blob = await old.encrypt(PDF, { id: "x", ownerId: "o" });
    const rotated = createFileCipher({ key: KEY, kid: "k1", previous: [{ kid: "k0", key: OTHER_KEY }] });
    expect(await rotated.decrypt(blob, { id: "x", ownerId: "o", kid: "k0" })).toEqual(PDF);
  });

  test("rejects a key that is not 32 bytes", () => {
    expect(() => createFileCipher({ key: Buffer.alloc(16).toString("base64") })).toThrow(/STUDENT_DOC_ENC_KEY/);
  });
});

describe("StudentDocumentService.upload", () => {
  test("stores ciphertext only, with the plaintext's sha256", async () => {
    const { svc, files } = service();
    const { record, created } = await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "C:\\scans\\passport.png", bytes: PNG });
    expect(created).toBe(true);
    expect(record).toMatchObject({ ownerId: "jane@heubert.com", fileName: "passport.png", mimeType: "image/png", sizeBytes: PNG.length, enc: { v: 1, alg: "AES-256-GCM", kid: "k1" }, extractions: [], crmActions: [] });
    expect(record.sha256).toBe(new Bun.CryptoHasher("sha256").update(PNG).digest("hex"));
    const stored = await files.get(record._id);
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!).equals(Buffer.from(PNG))).toBe(false);
    expect(await svc.read(record)).toEqual(PNG);
  });

  test("dedupes per owner only: the same file twice for one owner is one record, another owner gets their own", async () => {
    const { svc } = service();
    const a = await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "p.png", bytes: PNG });
    const again = await svc.upload({ ownerId: "Jane@heubert.com", sessionId: null, fileName: "copy.png", bytes: PNG });
    const bob = await svc.upload({ ownerId: "bob@heubert.com", sessionId: null, fileName: "p.png", bytes: PNG });
    expect(again.created).toBe(false);
    expect(again.record._id).toBe(a.record._id);
    expect(bob.created).toBe(true);
    expect(bob.record._id).not.toBe(a.record._id);
  });

  test("a duplicate whose stored copy no longer decrypts (key lost) is re-encrypted in place, keeping its record and history", async () => {
    // Stored by a deployment with a key that is gone (a local test against the same database).
    const old = service({ cipher: createFileCipher({ key: OTHER_KEY }) });
    const first = await old.svc.upload({ ownerId: "jane@x.com", sessionId: null, fileName: "p.png", bytes: PNG });
    await old.store.addExtraction(first.record._id, { at: new Date(), model: "m", ms: 1, documentType: "passport", country: null, holderName: null, fields: [], warnings: [] } as never);

    const now = service({ store: old.store, files: old.files });
    await expect(now.svc.read(first.record)).rejects.toThrow();
    const again = await now.svc.upload({ ownerId: "jane@x.com", sessionId: null, fileName: "p.png", bytes: PNG });
    expect(again).toMatchObject({ created: false, record: { _id: first.record._id } });
    expect(await now.svc.read(again.record)).toEqual(PNG);
    expect((await old.store.get(first.record._id))!.extractions).toHaveLength(1);
    // A readable duplicate is left untouched.
    const blob = await old.files.get(first.record._id);
    await now.svc.upload({ ownerId: "jane@x.com", sessionId: null, fileName: "p.png", bytes: PNG });
    expect(await old.files.get(first.record._id)).toEqual(blob);
  });

  test("refuses unsupported types, oversize and empty files", async () => {
    const { svc } = service();
    const err = async (bytes: Uint8Array) => {
      try {
        await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "x", bytes });
      } catch (e) {
        return (e as StudentDocError).code;
      }
      return null;
    };
    expect(await err(new TextEncoder().encode("<html></html>"))).toBe("unsupported_type");
    expect(await err(new Uint8Array(2048).fill(0xff))).toBe("too_large");
    expect(await err(new Uint8Array())).toBe("empty");
  });

  test("a name without an extension gets one from the type", async () => {
    const { svc } = service();
    const { record } = await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "scan", bytes: PDF });
    expect(record.fileName).toBe("scan.pdf");
  });
});

describe("ownership", () => {
  test("getOwned and ownedMany only return the caller's records", async () => {
    const { svc } = service();
    const a = (await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "a.png", bytes: PNG })).record;
    const b = (await svc.upload({ ownerId: "bob@heubert.com", sessionId: null, fileName: "b.pdf", bytes: PDF })).record;
    expect(await svc.getOwned(a._id, "jane@heubert.com")).not.toBeNull();
    expect(await svc.getOwned(b._id, "jane@heubert.com")).toBeNull();
    expect((await svc.ownedMany([a._id, b._id], "jane@heubert.com")).map((r) => r._id)).toEqual([a._id]);
  });

  test("records extraction runs and CRM actions, append-only", async () => {
    const { svc, store } = service();
    const a = (await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "a.png", bytes: PNG })).record;
    const run = { at: new Date(), requestId: "r1", sessionId: "s1", model: "m", documentType: "passport" as const, idKind: "passport", country: "Nepal", holderName: "Sita", fields: [], warnings: [], ms: 5 };
    await svc.recordExtraction(a._id, run, "c1");
    await svc.recordCrmActions(a._id, [{ proposalId: "p1", tool: "crm_update_contact", status: "pending", at: new Date() }]);
    await svc.recordCrmActions(a._id, [{ proposalId: "p1", tool: "crm_update_contact", status: "applied", at: new Date() }]);
    const got = (await store.get(a._id))!;
    expect(got.contactId).toBe("c1");
    expect(got.extractions).toHaveLength(1);
    expect(got.crmActions.map((x) => x.status)).toEqual(["pending", "applied"]);
  });
});

describe("signed file URLs", () => {
  const now = new Date("2026-10-12T08:00:00Z");
  const exp = Math.floor(now.getTime() / 1000) + 600;

  test("sign → verify ok; tampered id, sig or exp fail; expired and too-far-ahead fail", () => {
    const url = new URL(signFileUrl({ baseUrl: "https://edge.example.com", id: "doc-1", secret: SECRET, now }));
    expect(url.origin + url.pathname).toBe("https://edge.example.com/v1/files/doc-1");
    const sig = url.searchParams.get("sig")!;
    expect(Number(url.searchParams.get("exp"))).toBe(exp);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyFileSignature({ id: "doc-1", exp: String(exp), sig, secret: SECRET, now })).toBe("ok");
    expect(verifyFileSignature({ id: "doc-2", exp: String(exp), sig, secret: SECRET, now })).toBe("invalid");
    expect(verifyFileSignature({ id: "doc-1", exp: String(exp + 1), sig, secret: SECRET, now })).toBe("invalid");
    expect(verifyFileSignature({ id: "doc-1", exp: String(exp), sig: sig.replace(/^./, sig[0] === "a" ? "b" : "a"), secret: SECRET, now })).toBe("invalid");
    expect(verifyFileSignature({ id: "doc-1", exp: String(exp), sig: "zz", secret: SECRET, now })).toBe("invalid");
    expect(verifyFileSignature({ id: "doc-1", exp: String(exp), sig, secret: SECRET, now: new Date(now.getTime() + 601_000) })).toBe("expired");
    // A link minted with a longer life than 10 minutes is refused even with a valid signature.
    const far = new URL(signFileUrl({ baseUrl: "https://edge.example.com", id: "doc-1", secret: SECRET, now, ttlSeconds: 3600 }));
    expect(verifyFileSignature({ id: "doc-1", exp: far.searchParams.get("exp")!, sig: far.searchParams.get("sig")!, secret: SECRET, now })).toBe("invalid");
    expect(verifyFileSignature({ id: "doc-1", exp: "abc", sig, secret: SECRET, now })).toBe("invalid");
  });

  test("the service signs with its base URL and reads back through the signature", async () => {
    const { svc, clock } = service();
    const a = (await svc.upload({ ownerId: "jane@heubert.com", sessionId: null, fileName: "a.png", bytes: PNG })).record;
    const url = new URL(svc.signedUrl(a._id));
    expect(url.href.startsWith("https://edge.example.com/v1/files/")).toBe(true);
    const ok = await svc.readSigned(a._id, url.searchParams.get("exp"), url.searchParams.get("sig"));
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.bytes).toEqual(PNG);
    clock.t = new Date(clock.t.getTime() + 11 * 60_000);
    expect((await svc.readSigned(a._id, url.searchParams.get("exp"), url.searchParams.get("sig"))).kind).toBe("expired");
  });
});
