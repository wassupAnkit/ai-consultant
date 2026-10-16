/**
 * Encryption at rest for Google refresh tokens: AES-256-GCM through WebCrypto.
 *
 * The key (GOOGLE_TOKEN_ENC_KEY) is 32 bytes, base64 or base64url. Each blob carries a fresh
 * 12-byte IV and the key id (`kid`). The kid and the owning consultant are bound as additional
 * authenticated data, so a blob relabelled with another kid, copied onto another consultant's row,
 * a flipped bit, or the wrong key all fail closed with a `TokenCipherError` rather than returning
 * garbage (or another consultant's grant).
 *
 * Rotation: encrypt always uses the current key; decrypt picks the key named by the blob's kid,
 * the current one or one of `previous`. A blob under a previous key stays readable until the
 * consultant reconnects (which re-encrypts with the current key).
 */
import { b64urlDecode, b64urlEncode } from "../auth/supabase";
import type { EncryptedBlob } from "./types";

export class TokenCipherError extends Error {
  constructor(
    public readonly code: "invalid_key" | "unsupported_version" | "unknown_kid" | "decrypt_failed",
    message: string,
  ) {
    super(message);
    this.name = "TokenCipherError";
  }
}

export interface TokenCipher {
  readonly kid: string;
  /** `actor` is the owning consultant's email; decrypting under any other actor fails. */
  encrypt(plain: string, actor: string): Promise<EncryptedBlob>;
  /** Throws `TokenCipherError` on a tampered blob, an unknown kid, the wrong key or another actor. */
  decrypt(blob: EncryptedBlob, actor: string): Promise<string>;
}

export interface TokenKey {
  key: string;
  kid: string;
}

const IV_BYTES = 12;

/**
 * Decode a base64 or base64url AES-256 key; throws `invalid_key` unless it is exactly 32 bytes.
 * `name` is the setting the key came from, for the error message (student documents reuse this).
 */
export function decodeTokenKey(key: string, name = "GOOGLE_TOKEN_ENC_KEY"): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = b64urlDecode(key.trim().replace(/=+$/, ""));
  } catch {
    throw new TokenCipherError("invalid_key", `${name} is not valid base64`);
  }
  if (bytes.length !== 32) throw new TokenCipherError("invalid_key", `${name} must decode to 32 bytes (got ${bytes.length})`);
  return bytes;
}

const checkKid = (kid: string) => {
  if (!/^[\w.-]{1,32}$/.test(kid)) throw new TokenCipherError("invalid_key", "Key id must be 1-32 word characters");
  return kid;
};

export function createTokenCipher(opts: { key: string; kid?: string; previous?: readonly TokenKey[] }): TokenCipher {
  const kid = checkKid(opts.kid ?? "k1");
  const raws = new Map<string, Uint8Array<ArrayBuffer>>([[kid, decodeTokenKey(opts.key)]]);
  for (const p of opts.previous ?? []) {
    if (raws.has(checkKid(p.kid))) throw new TokenCipherError("invalid_key", `Key id "${p.kid}" is configured twice`);
    raws.set(p.kid, decodeTokenKey(p.key));
  }
  const imported = new Map<string, Promise<CryptoKey>>();
  const keyFor = (k: string) => {
    let p = imported.get(k);
    if (!p) {
      p = crypto.subtle.importKey("raw", raws.get(k)!, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      imported.set(k, p);
    }
    return p;
  };
  const aad = (k: string, actor: string) => new TextEncoder().encode(`edge-google-token:v1:${k}:${actor.trim().toLowerCase()}`);

  return {
    kid,
    async encrypt(plain, actor) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(kid, actor) }, await keyFor(kid), new TextEncoder().encode(plain));
      return { v: 1, kid, iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ct)) };
    },
    async decrypt(blob, actor) {
      if (!blob || blob.v !== 1) throw new TokenCipherError("unsupported_version", "Unsupported token blob version");
      if (typeof blob.kid !== "string" || !raws.has(blob.kid)) {
        throw new TokenCipherError("unknown_kid", `Token was encrypted with key "${String(blob.kid).slice(0, 32)}", which is not configured`);
      }
      try {
        const iv = b64urlDecode(blob.iv);
        if (iv.length !== IV_BYTES) throw new Error("bad iv");
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(blob.kid, actor) }, await keyFor(blob.kid), b64urlDecode(blob.ct));
        return new TextDecoder().decode(pt);
      } catch {
        throw new TokenCipherError("decrypt_failed", "Stored Google token could not be decrypted");
      }
    },
  };
}
