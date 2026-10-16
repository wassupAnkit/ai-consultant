/**
 * Student documents a counsellor attaches in chat (passports, national IDs). Separate from the
 * staff knowledge uploads in src/documents/service.ts on purpose: these are never parsed into
 * `kb_chunks`, never deduped across owners, never deleted, and their bytes are stored encrypted.
 *
 * PRIVACY: nothing in this service logs a file's bytes or the text read from it.
 */
import type { FileStore } from "../store";
import type { FileCipher } from "./crypto";
import { signFileUrl, verifyFileSignature } from "./signing";
import type { StudentDocumentStore } from "./store";
import { toAttachmentView, type AttachmentView, type DocumentCrmAction, type ExtractionRun, type StudentDocMimeType, type StudentDocumentRecord } from "./types";

export class StudentDocError extends Error {
  constructor(
    public readonly code: "unsupported_type" | "too_large" | "empty",
    message: string,
  ) {
    super(message);
    this.name = "StudentDocError";
  }
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** The file's real type from its first bytes; null for anything not on the allow-list. */
export function sniffMimeType(bytes: Uint8Array): StudentDocMimeType | null {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}

const EXTENSIONS: Record<StudentDocMimeType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** The base name only, without control characters, at most 200 characters, with an extension. */
export function cleanFileName(name: string, mime: StudentDocMimeType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .trim()
    .replace(/^\.+/, "");
  const ext = EXTENSIONS[mime];
  const withExt = /\.[a-z0-9]{1,10}$/i.test(base) ? base : `${base || "document"}.${ext}`;
  if (withExt.length <= 200) return withExt;
  const dot = withExt.lastIndexOf(".");
  const suffix = withExt.slice(dot);
  return withExt.slice(0, 200 - suffix.length) + suffix;
}

export interface StudentDocumentServiceDeps {
  store: StudentDocumentStore;
  /** Holds ciphertext only (GridFS bucket `student_files` in production). */
  files: FileStore;
  cipher: FileCipher;
  /** DOCUMENT_URL_SECRET: signs the short-lived links crm-api fetches files through. */
  urlSecret: string;
  /** PUBLIC_BASE_URL: Edge's public origin, as crm-api reaches it. */
  publicBaseUrl: string;
  /** STUDENT_DOC_MAX_BYTES. */
  maxBytes: number;
  now?: () => Date;
  newId?: () => string;
}

export class StudentDocumentService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: StudentDocumentServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? (() => crypto.randomUUID());
  }

  get maxBytes() {
    return this.d.maxBytes;
  }

  /** Store an upload encrypted. The same bytes from the same owner return their existing record. */
  async upload(input: { ownerId: string; sessionId: string | null; fileName: string; bytes: Uint8Array }): Promise<{ record: StudentDocumentRecord; created: boolean }> {
    if (!input.bytes.length) throw new StudentDocError("empty", "The file is empty");
    if (input.bytes.length > this.d.maxBytes) throw new StudentDocError("too_large", `File exceeds ${Math.round(this.d.maxBytes / 1024 / 1024)} MB`);
    const mimeType = sniffMimeType(input.bytes);
    if (!mimeType) throw new StudentDocError("unsupported_type", "Only PDF, JPEG, PNG, WebP and HEIC/HEIF files are accepted");
    const ownerId = input.ownerId.trim().toLowerCase();
    const sha256 = new Bun.CryptoHasher("sha256").update(input.bytes).digest("hex");
    const existing = await this.d.store.findByOwnerSha(ownerId, sha256);
    if (existing) {
      // A copy stored under the same key id but undecryptable here was written by another
      // environment sharing the database (or under a key since lost). The same bytes are here
      // again, so encrypt them under the current key into the same record: its id, extractions
      // and CRM history stay.
      if (existing.enc.kid === this.d.cipher.kid && !(await this.readable(existing))) {
        const blob = await this.d.cipher.encrypt(input.bytes, { id: existing._id, ownerId });
        await this.d.files.put(existing._id, blob, { filename: existing._id, mimeType: "application/octet-stream" });
      }
      return { record: existing, created: false };
    }

    const id = this.newId();
    const blob = await this.d.cipher.encrypt(input.bytes, { id, ownerId });
    // Bytes first: a record never points at a file that is not there.
    await this.d.files.put(id, blob, { filename: id, mimeType: "application/octet-stream" });
    const record: StudentDocumentRecord = {
      _id: id,
      ownerId,
      sessionId: input.sessionId,
      contactId: null,
      fileName: cleanFileName(input.fileName, mimeType),
      mimeType,
      sizeBytes: input.bytes.length,
      sha256,
      enc: { v: 1, alg: "AES-256-GCM", kid: this.d.cipher.kid },
      createdAt: this.now(),
      extractions: [],
      crmActions: [],
    };
    const stored = await this.d.store.create(record);
    if (stored._id !== id) await this.d.files.delete(id).catch(() => undefined); // lost a concurrent duplicate
    return { record: stored, created: stored._id === id };
  }

  /** The caller's own record (or any, for an admin); null otherwise, so ids cannot be probed. */
  async getOwned(id: string, ownerId: string, opts: { admin?: boolean } = {}): Promise<StudentDocumentRecord | null> {
    const r = await this.d.store.get(id);
    if (!r) return null;
    return opts.admin || r.ownerId === ownerId.trim().toLowerCase() ? r : null;
  }

  /** The caller's records among `ids`, in the order asked; others' and unknown ids are left out. */
  async ownedMany(ids: readonly string[], ownerId: string): Promise<StudentDocumentRecord[]> {
    const owner = ownerId.trim().toLowerCase();
    const rows = await this.d.store.listByIds([...new Set(ids)]);
    const byId = new Map(rows.filter((r) => r.ownerId === owner).map((r) => [r._id, r]));
    return [...new Set(ids)].map((id) => byId.get(id)).filter((r): r is StudentDocumentRecord => Boolean(r));
  }

  /** Attachment views for history, keyed by id (owner-scoped). */
  async views(ids: readonly string[], ownerId: string): Promise<Map<string, AttachmentView>> {
    return new Map((await this.ownedMany(ids, ownerId)).map((r) => [r._id, toAttachmentView(r)]));
  }

  private async readable(record: StudentDocumentRecord): Promise<boolean> {
    return this.read(record).then(
      () => true,
      () => false,
    );
  }

  /** The decrypted bytes of a record. */
  async read(record: StudentDocumentRecord): Promise<Uint8Array> {
    const blob = await this.d.files.get(record._id);
    if (!blob) throw new Error(`stored file ${record._id} is missing`);
    return this.d.cipher.decrypt(blob, { id: record._id, ownerId: record.ownerId, kid: record.enc.kid });
  }

  /** A link crm-api can fetch the file through for the next 10 minutes. */
  signedUrl(id: string): string {
    return signFileUrl({ baseUrl: this.d.publicBaseUrl, id, secret: this.d.urlSecret, now: this.now() });
  }

  /** The file behind a signed link: checked before the record is even looked up. */
  async readSigned(id: string, exp: string | null, sig: string | null): Promise<{ kind: "ok"; record: StudentDocumentRecord; bytes: Uint8Array } | { kind: "invalid" | "expired" | "not_found" }> {
    const v = verifyFileSignature({ id, exp, sig, secret: this.d.urlSecret, now: this.now() });
    if (v !== "ok") return { kind: v };
    const record = await this.d.store.get(id);
    if (!record) return { kind: "not_found" };
    return { kind: "ok", record, bytes: await this.read(record) };
  }

  recordExtraction(id: string, run: ExtractionRun, contactId?: string | null): Promise<void> {
    return this.d.store.addExtraction(id, run, contactId);
  }

  recordCrmActions(id: string, actions: readonly DocumentCrmAction[]): Promise<void> {
    return this.d.store.addCrmActions(id, actions);
  }
}
