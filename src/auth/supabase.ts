/**
 * Supabase access-token verification. Legacy path: the current frontend uses
 * Google sign-in with Edge sessions directly (src/auth/session.ts), not this.
 * Kept for a frontend that still signs in via Supabase + "Continue with Google";
 * Supabase issues a JWT which the frontend forwards as `Authorization: Bearer`.
 * We verify it here (JWKS for ES256/RS256 projects, or the legacy HS256 secret),
 * then enforce: `aud` = authenticated, `iss` = <SUPABASE_URL>/auth/v1, not
 * expired, and (optionally) that the identity came from the Google provider
 * and/or is on an allowed domain, matching Edge's own sign-in policy.
 */
export interface VerifiedUser {
  id: string;
  email: string;
  domain: string;
  name: string | null;
  picture: string | null;
  provider: string | null;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "invalid_token" | "token_expired" | "domain_not_allowed" | "provider_not_allowed" | "email_not_verified" | "jwks_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SupabaseAuthOptions {
  supabaseUrl: string;
  jwtSecret?: string;
  allowedDomains?: string[];
  requireGoogleProvider: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  crv?: string;
  [k: string]: unknown;
}

const jwksCache = new Map<string, { keys: Map<string, { key: CryptoKey; alg: string }>; expiresAt: number }>();

export function __resetSupabaseJwksCache() {
  jwksCache.clear();
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type ImportParams = Parameters<SubtleCrypto["importKey"]>[2];
type VerifyParams = Parameters<SubtleCrypto["verify"]>[0];

function algoFor(alg: string): { importParams: ImportParams; verifyParams: VerifyParams } {
  switch (alg) {
    case "RS256":
      return { importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } };
    case "ES256":
      return { importParams: { name: "ECDSA", namedCurve: "P-256" }, verifyParams: { name: "ECDSA", hash: "SHA-256" } };
    case "HS256":
      return { importParams: { name: "HMAC", hash: "SHA-256" }, verifyParams: { name: "HMAC" } };
    default:
      throw new AuthError("invalid_token", `Unsupported token algorithm ${alg}`);
  }
}

async function getJwks(opts: SupabaseAuthOptions, force = false): Promise<Map<string, { key: CryptoKey; alg: string }>> {
  const url = `${opts.supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  const cached = jwksCache.get(url);
  if (cached && !force && cached.expiresAt > Date.now()) return cached.keys;
  const res = await (opts.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AuthError("jwks_unavailable", `Supabase JWKS HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, { key: CryptoKey; alg: string }>();
  for (const jwk of keys ?? []) {
    const alg = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : jwk.kty === "RSA" ? "RS256" : "");
    if (!alg || alg === "HS256") continue;
    try {
      const key = await crypto.subtle.importKey("jwk", jwk as never, algoFor(alg).importParams, false, ["verify"]);
      map.set(jwk.kid ?? alg, { key, alg });
    } catch {
      /* skip unusable key */
    }
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 600);
  jwksCache.set(url, { keys: map, expiresAt: Date.now() + Math.min(Math.max(maxAge, 60), 6 * 3600) * 1000 });
  return map;
}

export async function verifySupabaseToken(token: string, opts: SupabaseAuthOptions): Promise<VerifiedUser> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("invalid_token", "Malformed access token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    throw new AuthError("invalid_token", "Malformed access token");
  }
  const alg = header.alg ?? "";
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = b64urlDecode(s);

  let ok = false;
  if (alg === "HS256") {
    if (!opts.jwtSecret) throw new AuthError("invalid_token", "HS256 token but SUPABASE_JWT_SECRET is not configured");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(opts.jwtSecret), algoFor(alg).importParams, false, ["verify"]);
    ok = await crypto.subtle.verify(algoFor(alg).verifyParams, key, sig, data);
  } else {
    let entry = (await getJwks(opts)).get(header.kid ?? alg);
    if (!entry) entry = (await getJwks(opts, true)).get(header.kid ?? alg); // key rotation
    if (!entry) throw new AuthError("invalid_token", "Unknown signing key");
    ok = await crypto.subtle.verify(algoFor(entry.alg).verifyParams, entry.key, sig, data);
  }
  if (!ok) throw new AuthError("invalid_token", "Invalid token signature");

  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  const expectedIss = `${opts.supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  if (payload.iss !== expectedIss) throw new AuthError("invalid_token", "Unexpected token issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes("authenticated")) throw new AuthError("invalid_token", "Token audience is not 'authenticated'");
  if (typeof payload.exp !== "number" || payload.exp < now - 30) throw new AuthError("token_expired", "Session expired, please sign in again");

  const email = String(payload.email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!email || !domain) throw new AuthError("invalid_token", "Token has no email");
  if (opts.allowedDomains?.length && !opts.allowedDomains.includes(domain)) {
    throw new AuthError("domain_not_allowed", `Only ${opts.allowedDomains.map((d) => "@" + d).join(" and ")} accounts can use this assistant`);
  }

  const appMeta = (payload.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  const userMeta = (payload.user_metadata ?? {}) as { email_verified?: boolean; name?: string; full_name?: string; avatar_url?: string; picture?: string; hd?: string };
  const providers = [appMeta.provider, ...(appMeta.providers ?? [])].filter(Boolean) as string[];
  if (opts.requireGoogleProvider && !providers.includes("google")) {
    throw new AuthError("provider_not_allowed", "Please sign in with your Google work account");
  }
  if (providers.includes("google") && userMeta.email_verified === false) {
    throw new AuthError("email_not_verified", "Google account email is not verified");
  }
  if (typeof userMeta.hd === "string" && userMeta.hd.toLowerCase() !== domain) {
    throw new AuthError("domain_not_allowed", "Account domain mismatch");
  }

  return {
    id: String(payload.sub),
    email,
    domain,
    name: userMeta.full_name ?? userMeta.name ?? null,
    picture: userMeta.avatar_url ?? userMeta.picture ?? null,
    provider: appMeta.provider ?? providers[0] ?? null,
  };
}
