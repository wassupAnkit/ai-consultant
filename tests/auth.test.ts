import { describe, expect, test } from "bun:test";
import { __resetSupabaseJwksCache, b64urlEncode, verifySupabaseToken } from "../src/auth/supabase";

const SUPABASE_URL = "https://proj.supabase.co";
const enc = new TextEncoder();
const b64 = (o: unknown) => b64urlEncode(enc.encode(JSON.stringify(o)));

async function makeKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function signES256(payload: Record<string, unknown>, priv: CryptoKey, kid = "k1") {
  const h = b64({ alg: "ES256", typ: "JWT", kid });
  const p = b64(payload);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function signHS256(payload: Record<string, unknown>, secret: string) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64(payload);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
}

const now = Math.floor(Date.now() / 1000);
const basePayload = (email: string, extra: Record<string, unknown> = {}) => ({
  iss: `${SUPABASE_URL}/auth/v1`,
  aud: "authenticated",
  sub: "user-1",
  exp: now + 3600,
  iat: now,
  email,
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: { email_verified: true, full_name: "Test User", avatar_url: "https://x/y.png" },
  ...extra,
});

describe("Supabase token verification", () => {
  test("accepts a Google account (ES256 via JWKS)", async () => {
    __resetSupabaseJwksCache();
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "ES256" };
    const fetchImpl = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "cache-control": "max-age=600" } })) as unknown as typeof fetch;
    const token = await signES256(basePayload("Alice@Heubert.com"), privateKey);
    const user = await verifySupabaseToken(token, { supabaseUrl: SUPABASE_URL, requireGoogleProvider: true, fetchImpl });
    expect(user.email).toBe("alice@heubert.com");
    expect(user.domain).toBe("heubert.com");
    expect(user.name).toBe("Test User");
  });

  test("no longer gates by domain, but still rejects non-Google providers, expired and tampered tokens", async () => {
    const secret = "supabase-legacy-jwt-secret-0123456789";
    const opts = { supabaseUrl: SUPABASE_URL, jwtSecret: secret, requireGoogleProvider: true };

    const bob = await verifySupabaseToken(await signHS256(basePayload("bob@gmail.com"), secret), opts);
    expect(bob.email).toBe("bob@gmail.com");
    await expect(
      verifySupabaseToken(await signHS256(basePayload("bob@heubert.com", { app_metadata: { provider: "email", providers: ["email"] } }), secret), opts),
    ).rejects.toMatchObject({ code: "provider_not_allowed" });
    await expect(verifySupabaseToken(await signHS256(basePayload("bob@heubert.com", { exp: now - 100 }), secret), opts)).rejects.toMatchObject({ code: "token_expired" });
    await expect(verifySupabaseToken(await signHS256(basePayload("bob@heubert.com"), "wrong-secret-wrong-secret-wrong"), opts)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verifySupabaseToken(await signHS256(basePayload("bob@heubert.com", { iss: "https://evil/auth/v1" }), secret), opts)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verifySupabaseToken("not.a.jwt.at.all", opts)).rejects.toMatchObject({ code: "invalid_token" });
  });

  test("accepts experteducation.com.au and allows email provider when not required", async () => {
    const secret = "supabase-legacy-jwt-secret-0123456789";
    const user = await verifySupabaseToken(
      await signHS256(basePayload("staff@experteducation.com.au", { app_metadata: { provider: "email", providers: ["email"] } }), secret),
      { supabaseUrl: SUPABASE_URL, jwtSecret: secret, requireGoogleProvider: false },
    );
    expect(user.domain).toBe("experteducation.com.au");
  });
});
