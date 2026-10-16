/**
 * Short-lived signed links to one stored file, for crm-api to fetch a file it was asked to attach
 * (`GET /v1/files/:id?exp&sig`, no other auth). `sig = HMAC-SHA256(DOCUMENT_URL_SECRET, "<id>.<exp>")`
 * in hex; a link is valid only while `exp` is in the future and at most 10 minutes ahead, so a
 * leaked link (the CRM's MCP audit log keeps tool arguments forever) is useless within minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const FILE_URL_MAX_TTL_SECONDS = 600;

const sign = (secret: string, id: string, exp: number) => createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");

export function signFileUrl(opts: { baseUrl: string; id: string; secret: string; now?: Date; ttlSeconds?: number }): string {
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + (opts.ttlSeconds ?? FILE_URL_MAX_TTL_SECONDS);
  const base = opts.baseUrl.replace(/\/+$/, "");
  return `${base}/v1/files/${encodeURIComponent(opts.id)}?exp=${exp}&sig=${sign(opts.secret, opts.id, exp)}`;
}

/** Signature first (constant time), then the clock; a link more than 10 minutes ahead is invalid. */
export function verifyFileSignature(opts: { id: string; exp: string | null; sig: string | null; secret: string; now?: Date }): "ok" | "expired" | "invalid" {
  if (!opts.exp || !/^\d{1,12}$/.test(opts.exp) || !opts.sig || !/^[0-9a-f]{64}$/i.test(opts.sig)) return "invalid";
  const exp = Number(opts.exp);
  const expected = Buffer.from(sign(opts.secret, opts.id, exp), "hex");
  const given = Buffer.from(opts.sig.toLowerCase(), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (exp <= now) return "expired";
  if (exp > now + FILE_URL_MAX_TTL_SECONDS) return "invalid";
  return "ok";
}

/** The attachment id a signed file URL points at, or null when it is not one of ours. */
export function fileIdFromUrl(url: string): string | null {
  try {
    const m = /\/v1\/files\/([^/?#]+)$/.exec(new URL(url).pathname);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}
