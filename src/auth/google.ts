/**
 * Google Identity Services ID-token verification (no external dependencies).
 *
 * Verifies the RS256 signature against Google's JWKS, issuer, audience, expiry
 * and `email_verified`. `allowedDomains` is optional: sign-in to Edge itself no
 * longer restricts by domain, but this same verifier is reused by Workspace
 * Gmail/Drive connect (src/google/integrations.ts), which does pass a domain
 * list (exact match on the part after "@", plus the `hd` claim when present).
 */
import { AuthError, b64urlDecode } from "./supabase";

export interface GoogleIdentity {
  sub: string;
  email: string;
  domain: string;
  name: string | null;
  picture: string | null;
}

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

let jwksCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

export function __resetGoogleJwksCache() {
  jwksCache = null;
}

async function getGoogleKeys(fetchImpl: typeof fetch, force = false): Promise<Map<string, CryptoKey>> {
  if (jwksCache && !force && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AuthError("jwks_unavailable", `Google JWKS HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Array<{ kid: string; kty: string }> };
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA") continue;
    map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk as never, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys: map, expiresAt: Date.now() + Math.min(Math.max(maxAge, 60), 6 * 3600) * 1000 };
  return map;
}

export interface GoogleVerifyOptions {
  clientId: string;
  allowedDomains?: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function verifyGoogleIdToken(token: string, opts: GoogleVerifyOptions): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("invalid_token", "Malformed Google ID token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    throw new AuthError("invalid_token", "Malformed Google ID token");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AuthError("invalid_token", "Unsupported token algorithm");

  const fetchImpl = opts.fetchImpl ?? fetch;
  let key = (await getGoogleKeys(fetchImpl)).get(header.kid);
  if (!key) key = (await getGoogleKeys(fetchImpl, true)).get(header.kid); // key rotation
  if (!key) throw new AuthError("invalid_token", "Unknown Google signing key");
  const ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AuthError("invalid_token", "Invalid Google token signature");

  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (!GOOGLE_ISSUERS.has(String(payload.iss))) throw new AuthError("invalid_token", "Unexpected issuer");
  if (payload.aud !== opts.clientId) throw new AuthError("invalid_token", "Token was not issued for this application");
  if (typeof payload.exp !== "number" || payload.exp < now - 30) throw new AuthError("token_expired", "Google sign-in expired, please try again");
  if (payload.email_verified !== true) throw new AuthError("email_not_verified", "Google account email is not verified");

  const email = String(payload.email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!email || !domain) throw new AuthError("invalid_token", "Token has no email");
  if (opts.allowedDomains?.length) {
    const allowed = opts.allowedDomains.map((d) => d.toLowerCase());
    if (!allowed.includes(domain)) {
      throw new AuthError("domain_not_allowed", `Only ${allowed.map((d) => "@" + d).join(" and ")} accounts can access this assistant`);
    }
    if (typeof payload.hd === "string" && payload.hd.toLowerCase() !== domain) {
      throw new AuthError("domain_not_allowed", "Account domain mismatch");
    }
  }

  return {
    sub: String(payload.sub),
    email,
    domain,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
