/**
 * Edge session tokens: compact HS256 JWTs issued after a successful Google
 * sign-in. Stateless, so they work across replicas; the frontend keeps the
 * token in an HttpOnly cookie and forwards it as `Authorization: Bearer`.
 */
import { b64urlDecode, b64urlEncode } from "./supabase";

export interface SessionClaims {
  iss: "edge";
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signSession(
  user: { sub: string; email: string; name: string | null; picture: string | null },
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): Promise<{ token: string; claims: SessionClaims }> {
  const iat = Math.floor(now / 1000);
  const claims: SessionClaims = { iss: "edge", sub: user.sub, email: user.email, name: user.name, picture: user.picture, iat, exp: iat + ttlSeconds };
  const enc = new TextEncoder();
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(`${header}.${body}`));
  return { token: `${header}.${body}.${b64urlEncode(new Uint8Array(sig))}`, claims };
}

/** Returns the claims for a valid, unexpired Edge session token, else null. */
export async function verifySession(token: string | null | undefined, secret: string, now = Date.now()): Promise<SessionClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { alg?: string };
    if (header.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(b))) as SessionClaims;
    if (claims.iss !== "edge" || typeof claims.email !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Cheap check to route a bearer token to the right verifier without a network call. */
export function looksLikeEdgeSession(token: string): boolean {
  const body = token.split(".")[1];
  if (!body) return false;
  try {
    return (JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as { iss?: string }).iss === "edge";
  } catch {
    return false;
  }
}
