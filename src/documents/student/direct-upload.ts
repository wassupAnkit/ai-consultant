/**
 * Direct-to-S3 upload for student documents.
 *
 * Passport and ID scans are binary bodies of up to 10 MB, which the shared ALB's WAF body rules
 * block (8 KB size limit, XSS/LFI patterns found in image bytes). So the file never crosses the
 * ALB: the browser asks Edge for an upload slot (small JSON), posts the file straight to S3 with a
 * presigned POST that S3 itself limits to the declared type and size, then asks Edge to complete.
 * Edge reads the object, stores it exactly like a multipart upload (type sniffed from the bytes,
 * encrypted, kept), and deletes the plaintext copy from S3. The bucket also expires anything left
 * under the prefix after a day.
 *
 * The slot is a signed ticket (HMAC with DOCUMENT_URL_SECRET), not a database row: it binds the
 * object key to the caller, file name, type, size and session, and expires with the presigned POST.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { STUDENT_DOC_MIME_TYPES, type StudentDocMimeType } from "./types";

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

/** The object store behind direct uploads (S3 in production, a fake in tests). */
export interface UploadObjectStore {
  presignPost(key: string, opts: { mimeType: string; maxBytes: number; expiresSeconds: number }): Promise<PresignedPost>;
  /** The object's bytes, or null when it does not exist. Throws when it is larger than maxBytes. */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class DirectUploadError extends Error {
  constructor(
    readonly code: "unsupported_type" | "too_large" | "invalid_ticket" | "ticket_expired" | "not_uploaded" | "size_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "DirectUploadError";
  }
}

export interface UploadSlot {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
  /** Hand back to `complete`. Opaque to the client. */
  ticket: string;
  expiresAt: string;
}

interface Ticket {
  /** upload id (also the object key's last segment) */
  u: string;
  /** owner */
  o: string;
  /** file name as the counsellor's device named it */
  f: string;
  /** declared MIME type */
  m: string;
  /** declared size in bytes */
  s: number;
  /** chat session, if any */
  c: string | null;
  /** expiry, unix seconds */
  e: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export class DirectUploads {
  private readonly ttlSeconds: number;
  private readonly prefix: string;

  constructor(
    private readonly d: {
      store: UploadObjectStore;
      secret: string;
      maxBytes: number;
      /** Key prefix in the bucket; the bucket's lifecycle rule expires it. Default "incoming/". */
      prefix?: string;
      /** How long the slot (presigned POST and ticket) is valid. Default 10 minutes. */
      ttlSeconds?: number;
      now?: () => Date;
    },
  ) {
    this.ttlSeconds = d.ttlSeconds ?? 600;
    this.prefix = (d.prefix ?? "incoming/").replace(/^\/+/, "");
  }

  private now() {
    return this.d.now?.() ?? new Date();
  }

  private key(uploadId: string) {
    return `${this.prefix}${uploadId}`;
  }

  private sign(payload: string) {
    return createHmac("sha256", this.d.secret).update(`direct-upload.${payload}`).digest("base64url");
  }

  async start(ownerId: string, input: { fileName: string; mimeType: string; sizeBytes: number; sessionId?: string | null }): Promise<UploadSlot> {
    const mimeType = input.mimeType.toLowerCase();
    if (!(STUDENT_DOC_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new DirectUploadError("unsupported_type", "Attach a PDF or an image (JPEG, PNG, WebP or HEIC).");
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new DirectUploadError("too_large", "The file is empty.");
    if (input.sizeBytes > this.d.maxBytes) throw new DirectUploadError("too_large", `File exceeds ${Math.round(this.d.maxBytes / 1024 / 1024)} MB`);

    const uploadId = randomUUID();
    const exp = Math.floor(this.now().getTime() / 1000) + this.ttlSeconds;
    const ticket: Ticket = { u: uploadId, o: ownerId, f: input.fileName.slice(0, 200), m: mimeType, s: input.sizeBytes, c: input.sessionId ?? null, e: exp };
    const payload = b64(JSON.stringify(ticket));
    const post = await this.d.store.presignPost(this.key(uploadId), { mimeType, maxBytes: this.d.maxBytes, expiresSeconds: this.ttlSeconds });
    return { uploadId, url: post.url, fields: post.fields, ticket: `${payload}.${this.sign(payload)}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Verify the ticket, read the uploaded object, and hand back what to store. Call `discard` after storing. */
  async complete(ownerId: string, rawTicket: string): Promise<{ uploadId: string; key: string; fileName: string; declaredMimeType: StudentDocMimeType; sessionId: string | null; bytes: Uint8Array }> {
    const t = this.verify(rawTicket, ownerId);
    const key = this.key(t.u);
    const bytes = await this.d.store.get(key, this.d.maxBytes);
    if (!bytes) throw new DirectUploadError("not_uploaded", "The file has not reached storage yet. Try attaching it again.");
    // S3's content-length-range already capped it; the declared size must also match what arrived.
    if (bytes.length !== t.s) {
      await this.discard(key);
      throw new DirectUploadError("size_mismatch", "The uploaded file is not the one that was announced. Try attaching it again.");
    }
    return { uploadId: t.u, key, fileName: t.f, declaredMimeType: t.m as StudentDocMimeType, sessionId: t.c, bytes };
  }

  /** Delete the plaintext copy; failure is left to the bucket's lifecycle rule. */
  async discard(key: string): Promise<void> {
    await this.d.store.delete(key).catch(() => {});
  }

  private verify(raw: string, ownerId: string): Ticket {
    const [payload, sig] = String(raw).split(".");
    if (!payload || !sig) throw new DirectUploadError("invalid_ticket", "This upload is not valid.");
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new DirectUploadError("invalid_ticket", "This upload is not valid.");
    let t: Ticket;
    try {
      t = JSON.parse(unb64(payload)) as Ticket;
    } catch {
      throw new DirectUploadError("invalid_ticket", "This upload is not valid.");
    }
    // Another user's ticket is indistinguishable from a forged one.
    if (t.o !== ownerId || typeof t.u !== "string" || !/^[0-9a-f-]{36}$/.test(t.u)) throw new DirectUploadError("invalid_ticket", "This upload is not valid.");
    if (t.e * 1000 < this.now().getTime()) throw new DirectUploadError("ticket_expired", "This upload expired. Attach the file again.");
    return t;
  }
}
