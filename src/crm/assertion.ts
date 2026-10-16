/**
 * Short-lived assertions Edge presents to crm-api's token exchange (POST /v1/mcp/token).
 *
 * Signed with CRM_EXCHANGE_SECRET, which is deliberately NOT the Edge session secret: the
 * two live in different trust domains, rotate independently, and neither side should be
 * able to mint the other's tokens. The `aud` claim is what stops an Edge browser session
 * from being replayed against the CRM.
 */
import { b64urlEncode } from "../auth/supabase";

export interface CrmAssertionClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface CrmAssertionOptions {
  secret: string;
  issuer?: string;
  audience?: string;
  /** Seconds. Kept small on purpose: this bounds the replay window. */
  ttlSeconds?: number;
}

export async function signCrmAssertion(
  user: { sub: string; email: string },
  options: CrmAssertionOptions,
  now = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const claims: CrmAssertionClaims = {
    iss: options.issuer ?? "edge",
    aud: options.audience ?? "crm-api",
    sub: user.sub,
    email: user.email,
    iat,
    exp: iat + (options.ttlSeconds ?? 60),
  };

  const enc = new TextEncoder();
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("raw", enc.encode(options.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`));

  return `${header}.${payload}.${b64urlEncode(new Uint8Array(signature))}`;
}
