/**
 * Encryption at rest for student documents: AES-256-GCM through WebCrypto, the same scheme as
 * Google refresh tokens (src/google/crypto.ts). The key is STUDENT_DOC_ENC_KEY (32 bytes, base64).
 *
 * The stored blob is `iv (12 bytes) || ciphertext+tag`. The key id, the document id and the
 * owner are bound as additional authenticated data, so a blob copied onto another record or
 * another owner, a flipped bit or the wrong key fails closed instead of returning bytes.
 */
import { decodeTokenKey, TokenCipherError, type TokenKey } from "../../google/crypto";

export interface FileCipher {
  readonly kid: string;
  encrypt(plain: Uint8Array, ctx: { id: string; ownerId: string }): Promise<Uint8Array>;
  /** `kid` is the key the record says it was encrypted with (default: the current one). */
  decrypt(blob: Uint8Array, ctx: { id: string; ownerId: string; kid?: string }): Promise<Uint8Array>;
}

const IV_BYTES = 12;
const KEY_NAME = "STUDENT_DOC_ENC_KEY";

export function createFileCipher(opts: { key: string; kid?: string; previous?: readonly TokenKey[] }): FileCipher {
  const kid = opts.kid ?? "k1";
  const raws = new Map<string, Uint8Array<ArrayBuffer>>([[kid, decodeTokenKey(opts.key, KEY_NAME)]]);
  for (const p of opts.previous ?? []) raws.set(p.kid, decodeTokenKey(p.key, KEY_NAME));
  const imported = new Map<string, Promise<CryptoKey>>();
  const keyFor = (k: string) => {
    const raw = raws.get(k);
    if (!raw) throw new TokenCipherError("unknown_kid", `Document was encrypted with key "${k.slice(0, 32)}", which is not configured`);
    let p = imported.get(k);
    if (!p) {
      p = crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      imported.set(k, p);
    }
    return p;
  };
  const aad = (k: string, id: string, ownerId: string) => new TextEncoder().encode(`edge-student-doc:v1:${k}:${id}:${ownerId.trim().toLowerCase()}`);

  return {
    kid,
    async encrypt(plain, ctx) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(kid, ctx.id, ctx.ownerId) }, await keyFor(kid), plain as Uint8Array<ArrayBuffer>));
      const out = new Uint8Array(IV_BYTES + ct.length);
      out.set(iv, 0);
      out.set(ct, IV_BYTES);
      return out;
    },
    async decrypt(blob, ctx) {
      const k = ctx.kid ?? kid;
      const key = await keyFor(k);
      if (blob.length <= IV_BYTES) throw new TokenCipherError("decrypt_failed", "Stored document is truncated");
      try {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, IV_BYTES), additionalData: aad(k, ctx.id, ctx.ownerId) }, key, blob.slice(IV_BYTES));
        return new Uint8Array(pt);
      } catch {
        throw new TokenCipherError("decrypt_failed", "Stored document could not be decrypted");
      }
    },
  };
}
