import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { __resetGoogleJwksCache, verifyGoogleIdToken } from "../src/auth/google";
import { b64urlEncode } from "../src/auth/supabase";
import { InMemoryGoogleConnectionStore, MongoGoogleConnectionStore, type GoogleConnectionDoc } from "../src/google/connections";
import { createTokenCipher, TokenCipherError } from "../src/google/crypto";
import { createIntegrationsService, DEFAULT_RETURN_TO, IntegrationError, INTEGRATION_EVENT, sanitizeReturnTo } from "../src/google/integrations";
import { codeChallenge, createGoogleOAuth, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, newCodeVerifier, OAuthError } from "../src/google/oauth";
import { redactWorkspaceEvidence } from "../src/google/redact";
import { hashState, InMemoryOAuthStateStore, OAUTH_STATE_TTL_MS } from "../src/google/state-store";
import { CONNECTION_TTL_MS, createGoogleTokenSource } from "../src/google/token-cache";
import type { Collection } from "mongodb";
import { SERVICE_SCOPES, type GoogleConnection } from "../src/google/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CLIENT_ID = "workspace-client.apps.googleusercontent.com";
const REDIRECT = "https://edge.heubert.com/api/integrations/google/callback";
const DOMAINS = ["heubert.com", "experteducation.com.au"];
const JANE = "jane@heubert.com";
const KEY = b64urlEncode(new Uint8Array(32).fill(7));
const GMAIL = [...SERVICE_SCOPES.gmail];
const DRIVE = [...SERVICE_SCOPES.drive];
const IDENTITY = ["openid", "https://www.googleapis.com/auth/userinfo.email"];
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let rsa: CryptoKeyPair;
let jwk: Record<string, unknown> & { kid: string };
beforeAll(async () => {
  rsa = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...((await crypto.subtle.exportKey("jwk", rsa.publicKey)) as Record<string, unknown>), kid: "g1" };
});
beforeEach(() => __resetGoogleJwksCache());

/** A Google-signed-looking RS256 id_token. */
async function idToken(claims: Record<string, unknown> = {}) {
  const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const payload = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-jane",
    email: JANE,
    email_verified: true,
    hd: "heubert.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  const input = `${enc({ alg: "RS256", kid: "g1", typ: "JWT" })}.${enc(payload)}`;
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, rsa.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`;
}

type Call = { url: string; form: URLSearchParams };
type Reply = { status?: number; body: Record<string, unknown> };

/** Fake Google: the token endpoint answers from `replies` in order, revoke `revokeStatus` (200), JWKS from our key. */
function fakeGoogle(replies: Reply[] = [], revokeStatus = 200) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) return Response.json({ keys: [jwk] });
    const form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, form });
    if (url === GOOGLE_REVOKE_URL) return new Response("", { status: revokeStatus });
    if (url === GOOGLE_TOKEN_URL) {
      const r = queue.shift() ?? { status: 500, body: { error: "no_reply_scripted" } };
      await Bun.sleep(5);
      return Response.json(r.body, { status: r.status ?? 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, tokenCalls: () => calls.filter((c) => c.url === GOOGLE_TOKEN_URL), revokes: () => calls.filter((c) => c.url === GOOGLE_REVOKE_URL) };
}

const grant = async (o: { scope?: string[]; refresh?: string | null; claims?: Record<string, unknown> } = {}): Promise<Reply> => ({
  body: {
    access_token: "ya29.access-1",
    expires_in: 3599,
    token_type: "Bearer",
    scope: (o.scope ?? [...IDENTITY, ...GMAIL, ...DRIVE]).join(" "),
    id_token: await idToken(o.claims),
    ...(o.refresh === null ? {} : { refresh_token: o.refresh ?? "1//refresh-1" }),
  },
});

function setup(replies: Reply[] = [], opts: { now?: () => number; revokeStatus?: number } = {}) {
  const google = fakeGoogle(replies, opts.revokeStatus);
  const now = opts.now ?? Date.now;
  const oauth = createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "shh", redirectUri: REDIRECT, fetchImpl: google.fetchImpl });
  const states = new InMemoryOAuthStateStore(now);
  const connections = new InMemoryGoogleConnectionStore(now);
  const cipher = createTokenCipher({ key: KEY });
  const tokens = createGoogleTokenSource({ connections, oauth, cipher, now });
  const events: { type: string; ownerId?: string | null; details?: Record<string, unknown> }[] = [];
  const changed: string[] = [];
  const invalidated: string[] = [];
  const errors: { msg: string; fields?: Record<string, unknown> }[] = [];
  const service = createIntegrationsService({
    oauth,
    states,
    connections,
    cipher,
    tokens: { invalidate: (a) => (invalidated.push(a), tokens.invalidate(a)) },
    allowedDomains: DOMAINS,
    clientId: CLIENT_ID,
    onChange: (a) => changed.push(a),
    verifyIdToken: (t, o) => verifyGoogleIdToken(t, { ...o, fetchImpl: google.fetchImpl }),
    recordEvent: (e) => events.push(e),
    logger: { info: () => {}, warn: () => {}, error: (msg, fields) => errors.push({ msg, ...(fields ? { fields } : {}) }) },
  });
  /** Start a connect and return the raw state Google would hand back. */
  const start = async (services: ("gmail" | "drive")[] = ["gmail", "drive"], returnTo?: string, actor = JANE) => {
    const { url } = await service.connect(actor, services, returnTo);
    return { url: new URL(url), state: new URL(url).searchParams.get("state")! };
  };
  return { google, oauth, states, connections, cipher, tokens, service, events, changed, invalidated, errors, start };
}

const expectFailure = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(IntegrationError);
  expect((err as IntegrationError).code).toBe(code as never);
};

// ---------------------------------------------------------------------------
// PKCE + consent URL
// ---------------------------------------------------------------------------
describe("PKCE", () => {
  test("RFC 7636 appendix B test vector", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("verifier is 43 base64url chars and random", () => {
    const a = newCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCodeVerifier()).not.toBe(a);
  });
});

describe("consent URL", () => {
  test("carries offline access, consent, PKCE S256, login_hint and hd", async () => {
    const { start, states } = setup();
    const { url, state } = await start(["gmail"], "/chat/abc");
    const p = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")!.split(" ")).toEqual(["openid", "email", ...GMAIL]);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("include_granted_scopes")).toBe("true");
    expect(p.get("login_hint")).toBe(JANE);
    expect(p.get("hd")).toBe("heubert.com");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the hash of the state is stored; the challenge matches the stored verifier.
    expect(states.keys()).toEqual([hashState(state)]);
    const rec = await states.consume(state);
    expect(await codeChallenge(rec!.codeVerifier)).toBe(p.get("code_challenge")!);
    expect(rec).toMatchObject({ actor: JANE, services: ["gmail"], returnTo: "/chat/abc" });
  });

  test("both services request every scope once", async () => {
    const { start } = setup();
    const { url } = await start(["drive", "gmail"]);
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(["openid", "email", ...GMAIL, ...DRIVE]);
  });

  test("an actor on another domain cannot start a connect", async () => {
    const { service } = setup();
    await expectFailure(service.connect("bob@gmail.com", ["gmail"]), "domain_not_allowed");
  });
});

describe("returnTo", () => {
  test.each([
    ["/chat/123?x=1#y", "/chat/123?x=1#y"],
    ["/settings", "/settings"],
    ["//evil.com/x", DEFAULT_RETURN_TO],
    ["/\\evil.com", DEFAULT_RETURN_TO],
    ["https://evil.com/", DEFAULT_RETURN_TO],
    ["javascript:alert(1)", DEFAULT_RETURN_TO],
    ["chat", DEFAULT_RETURN_TO],
    ["/a\nb", DEFAULT_RETURN_TO],
    ["", DEFAULT_RETURN_TO],
    // Each of these normalises to "//evil.com…", another host to a browser.
    ["/.//evil.com", DEFAULT_RETURN_TO],
    ["/..//evil.com", DEFAULT_RETURN_TO],
    ["/a/..//evil.com/x", DEFAULT_RETURN_TO],
    ["/%2e//evil.com", DEFAULT_RETURN_TO],
    ["/%2E%2E//evil.com", DEFAULT_RETURN_TO],
    ["/./\\evil.com", DEFAULT_RETURN_TO],
    ["/\tevil", DEFAULT_RETURN_TO],
    ["/chat/./a/../b", "/chat/b"],
  ])("%p → %p", (input, out) => {
    expect(sanitizeReturnTo(input)).toBe(out);
  });

  test("undefined → /chat, and it is sanitised before being stored", async () => {
    expect(sanitizeReturnTo(undefined)).toBe("/chat");
    const { start, states } = setup();
    const { state } = await start(["gmail"], "//evil.com");
    expect((await states.consume(state))!.returnTo).toBe("/chat");
  });
});

// ---------------------------------------------------------------------------
// State store
// ---------------------------------------------------------------------------
describe("OAuth state", () => {
  test("single use", async () => {
    const s = new InMemoryOAuthStateStore();
    const state = await s.create({ actor: "Jane@Heubert.com", services: ["gmail"], codeVerifier: "v", returnTo: "/chat" });
    expect((await s.consume(state))!.actor).toBe(JANE);
    expect(await s.consume(state)).toBeNull();
  });

  test("expires after 10 minutes", async () => {
    let t = 1_000_000;
    const s = new InMemoryOAuthStateStore(() => t);
    const state = await s.create({ actor: JANE, services: ["gmail"], codeVerifier: "v", returnTo: "/chat" });
    t += OAUTH_STATE_TTL_MS + 1;
    expect(await s.consume(state)).toBeNull();
    expect(s.size).toBe(0);
  });

  test("garbage state never reaches the store", async () => {
    const s = new InMemoryOAuthStateStore();
    expect(await s.consume("short")).toBeNull();
    expect(await s.consume("x".repeat(300))).toBeNull();
  });

  test("a state issued to another consultant is refused and burned", async () => {
    const { start, service } = setup([await grant()]);
    const { state } = await start(["gmail"]);
    await expectFailure(service.callback("bob@heubert.com", "code-1", state), "state_invalid");
    await expectFailure(service.callback(JANE, "code-1", state), "state_invalid");
  });

  test("an expired state fails the callback before any exchange", async () => {
    let t = Date.now();
    const x = setup([await grant()], { now: () => t });
    const { state } = await x.start();
    t += OAUTH_STATE_TTL_MS + 1_000;
    await expectFailure(x.service.callback(JANE, "code-1", state), "state_invalid");
    expect(x.google.tokenCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Token cipher
// ---------------------------------------------------------------------------
describe("token cipher", () => {
  test("round trip with a fresh IV each time", async () => {
    const c = createTokenCipher({ key: KEY, kid: "k1" });
    const a = await c.encrypt("1//refresh", JANE);
    const b = await c.encrypt("1//refresh", JANE);
    expect(a.v).toBe(1);
    expect(a.kid).toBe("k1");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toContain("refresh");
    expect(await c.decrypt(a, JANE)).toBe("1//refresh");
  });

  test("accepts standard base64 keys too", async () => {
    const std = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    const blob = await createTokenCipher({ key: KEY }).encrypt("x", JANE);
    expect(await createTokenCipher({ key: std }).decrypt(blob, JANE)).toBe("x");
  });

  test("key must be exactly 32 bytes", () => {
    expect(() => createTokenCipher({ key: b64urlEncode(new Uint8Array(16)) })).toThrow(TokenCipherError);
    expect(() => createTokenCipher({ key: "not base64!!" })).toThrow(TokenCipherError);
  });

  test("tampered ciphertext, wrong key, other kid and relabelled kid all fail closed", async () => {
    const c = createTokenCipher({ key: KEY, kid: "k1" });
    const blob = await c.encrypt("1//refresh", JANE);
    const flipped = blob.ct[0] === "A" ? "B" + blob.ct.slice(1) : "A" + blob.ct.slice(1);
    const code = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as TokenCipherError).code;
    expect(await code(c.decrypt({ ...blob, ct: flipped }, JANE))).toBe("decrypt_failed");
    expect(await code(createTokenCipher({ key: b64urlEncode(new Uint8Array(32).fill(8)), kid: "k1" }).decrypt(blob, JANE))).toBe("decrypt_failed");
    expect(await code(createTokenCipher({ key: KEY, kid: "k2" }).decrypt(blob, JANE))).toBe("unknown_kid");
    // Same key, blob relabelled to k2: the kid is authenticated data, so GCM rejects it.
    expect(await code(createTokenCipher({ key: KEY, kid: "k2" }).decrypt({ ...blob, kid: "k2" }, JANE))).toBe("decrypt_failed");
    expect(await code(c.decrypt({ ...blob, v: 2 as never }, JANE))).toBe("unsupported_version");
  });

  test("a blob moved onto another consultant's row fails closed", async () => {
    const c = createTokenCipher({ key: KEY });
    const blob = await c.encrypt("1//refresh", JANE);
    expect(await c.decrypt(blob, "JANE@heubert.com")).toBe("1//refresh");
    const err = (await c.decrypt(blob, "bob@heubert.com").catch((e) => e)) as TokenCipherError;
    expect(err).toBeInstanceOf(TokenCipherError);
    expect(err.code).toBe("decrypt_failed");
  });

  test("previous keys decrypt their blobs; encryption always uses the current key", async () => {
    const OLD = KEY;
    const NEW = b64urlEncode(new Uint8Array(32).fill(3));
    const old = createTokenCipher({ key: OLD, kid: "k1" });
    const oldBlob = await old.encrypt("1//old", JANE);
    const rotated = createTokenCipher({ key: NEW, kid: "k2", previous: [{ key: OLD, kid: "k1" }] });
    expect(rotated.kid).toBe("k2");
    expect(await rotated.decrypt(oldBlob, JANE)).toBe("1//old");
    const newBlob = await rotated.encrypt("1//new", JANE);
    expect(newBlob.kid).toBe("k2");
    expect(await rotated.decrypt(newBlob, JANE)).toBe("1//new");
    const code = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as TokenCipherError).code;
    // The actor binding holds for previous keys too, and a retired key is simply unknown.
    expect(await code(rotated.decrypt(oldBlob, "bob@heubert.com"))).toBe("decrypt_failed");
    expect(await code(old.decrypt(newBlob, JANE))).toBe("unknown_kid");
    expect(await code(createTokenCipher({ key: NEW, kid: "k2" }).decrypt(oldBlob, JANE))).toBe("unknown_kid");
  });

  test("a key ring naming one kid twice, or a bad previous key, is refused", () => {
    expect(() => createTokenCipher({ key: KEY, kid: "k1", previous: [{ key: KEY, kid: "k1" }] })).toThrow(TokenCipherError);
    expect(() => createTokenCipher({ key: KEY, kid: "k2", previous: [{ key: b64urlEncode(new Uint8Array(16)), kid: "k1" }] })).toThrow(TokenCipherError);
    expect(() => createTokenCipher({ key: KEY, kid: "k2", previous: [{ key: KEY, kid: "bad kid!" }] })).toThrow(TokenCipherError);
  });
});

// ---------------------------------------------------------------------------
// OAuth client
// ---------------------------------------------------------------------------
describe("OAuth client", () => {
  test("exchangeCode posts the code, verifier and client credentials", async () => {
    const g = fakeGoogle([await grant()]);
    const oauth = createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "shh", redirectUri: REDIRECT, fetchImpl: g.fetchImpl });
    const r = await oauth.exchangeCode("code-1", "verifier-1");
    expect(r).toMatchObject({ accessToken: "ya29.access-1", refreshToken: "1//refresh-1", expiresIn: 3599 });
    expect(r.scope).toContain(GMAIL[0]!);
    const f = g.tokenCalls()[0]!.form;
    expect(Object.fromEntries(f)).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      code_verifier: "verifier-1",
      client_id: CLIENT_ID,
      client_secret: "shh",
      redirect_uri: REDIRECT,
    });
  });

  test("invalid_grant is distinguishable and never echoes Google's description", async () => {
    const g = fakeGoogle([{ status: 400, body: { error: "invalid_grant", error_description: "Token 1//secret has been expired or revoked." } }]);
    const oauth = createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "shh", redirectUri: REDIRECT, fetchImpl: g.fetchImpl });
    const err = (await oauth.refresh("1//secret").catch((e) => e)) as OAuthError;
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(err.message).not.toContain("secret");
  });

  test("other token errors are http_error", async () => {
    const g = fakeGoogle([{ status: 401, body: { error: "invalid_client" } }]);
    const oauth = createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "shh", redirectUri: REDIRECT, fetchImpl: g.fetchImpl });
    const err = (await oauth.refresh("r").catch((e) => e)) as OAuthError;
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(401);
  });

  test("revoke is best effort", async () => {
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const oauth = createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "shh", redirectUri: REDIRECT, fetchImpl: boom });
    expect(await oauth.revoke("t")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------
describe("callback", () => {
  test("stores an encrypted grant and reports the connected services", async () => {
    const x = setup([await grant()]);
    const { state } = await x.start(["gmail", "drive"], "/chat/s1");
    const r = await x.service.callback(JANE, "code-1", state);
    expect(r).toEqual({ services: ["gmail", "drive"], returnTo: "/chat/s1" });
    const conn = (await x.connections.get(JANE))!;
    expect(conn).toMatchObject({ actor: JANE, googleSub: "google-sub-jane", googleEmail: JANE, status: "connected" });
    expect(JSON.stringify(conn)).not.toContain("1//refresh-1");
    expect(await x.cipher.decrypt(conn.refreshTokenEnc, JANE)).toBe("1//refresh-1");
    expect(x.changed).toEqual([JANE]);
    expect(x.invalidated).toEqual([JANE]);
    expect(x.events).toEqual([{ type: INTEGRATION_EVENT.connected, source: "server", ownerId: JANE, details: { requested: ["gmail", "drive"], services: ["gmail", "drive"], reconnect: false } }] as never);
    expect(await x.service.list(JANE)).toEqual([
      { service: "gmail", status: "connected", googleEmail: JANE, connectedAt: conn.connectedAt.toISOString() },
      { service: "drive", status: "connected", googleEmail: JANE, connectedAt: conn.connectedAt.toISOString() },
      { service: "calendar", status: "not_connected", googleEmail: null, connectedAt: null },
      { service: "docs", status: "not_connected", googleEmail: null, connectedAt: null },
    ]);
  });

  test("a Google account other than the consultant's is refused and its grant revoked", async () => {
    const x = setup([await grant({ claims: { email: "bob@heubert.com", sub: "bob" } })]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "account_mismatch");
    expect(await x.connections.get(JANE)).toBeNull();
    expect(x.google.revokes().map((c) => c.form.get("token"))).toEqual(["1//refresh-1"]);
  });

  test("a personal or other-domain account is refused", async () => {
    const x = setup([await grant({ claims: { email: "jane@gmail.com", hd: undefined } })]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "account_mismatch");
    expect(await x.connections.get(JANE)).toBeNull();
  });

  test("a consumer Google account on the company address (no hd claim) is refused and revoked", async () => {
    const x = setup([await grant({ claims: { hd: undefined } })]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "account_mismatch");
    expect(await x.connections.get(JANE)).toBeNull();
    expect(x.google.revokes()).toHaveLength(1);
  });

  test("an id_token for another client fails as exchange_failed", async () => {
    const x = setup([await grant({ claims: { aud: "someone-else" } })]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "exchange_failed");
  });

  test("Google refusing the code is exchange_failed", async () => {
    const x = setup([{ status: 400, body: { error: "invalid_grant" } }]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "exchange_failed");
  });

  test("partial grant: only the fully granted service connects", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, ...GMAIL, "https://www.googleapis.com/auth/drive.metadata"] })]);
    const { state } = await x.start(["gmail", "drive"]);
    expect((await x.service.callback(JANE, "code-1", state)).services).toEqual(["gmail"]);
    expect((await x.service.list(JANE)).map((v) => v.status)).toEqual(["connected", "not_connected", "not_connected", "not_connected"]);
  });

  test("gmail with one of its two scopes unticked is not connected → scope_denied", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, GMAIL[0]!] })]);
    const { state } = await x.start(["gmail"]);
    await expectFailure(x.service.callback(JANE, "code-1", state), "scope_denied");
    expect(await x.connections.get(JANE)).toBeNull();
    expect(x.google.revokes()).toHaveLength(1);
  });

  test("first grant without a refresh token → no_refresh_token", async () => {
    const x = setup([await grant({ refresh: null })]);
    const { state } = await x.start();
    await expectFailure(x.service.callback(JANE, "code-1", state), "no_refresh_token");
    expect(await x.connections.get(JANE)).toBeNull();
  });

  test("re-connect without a refresh token keeps the stored one and merges scopes", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, ...GMAIL] }), await grant({ scope: [...IDENTITY, ...GMAIL, ...DRIVE], refresh: null })]);
    await x.service.callback(JANE, "c1", (await x.start(["gmail"])).state);
    const r = await x.service.callback(JANE, "c2", (await x.start(["drive"])).state);
    expect(r.services).toEqual(["gmail", "drive"]);
    const conn = (await x.connections.get(JANE))!;
    expect(await x.cipher.decrypt(conn.refreshTokenEnc, JANE)).toBe("1//refresh-1");
    expect(conn.grantedScopes).toEqual(expect.arrayContaining([...GMAIL, ...DRIVE]));
    expect(x.events.at(-1)!.details).toMatchObject({ reconnect: true });
  });

  test.each([
    ["with a new refresh token", "1//refresh-2"],
    ["without a refresh token", null],
  ] as const)("a disconnected service does not come back when another is reconnected (%s)", async (_label, refresh) => {
    // include_granted_scopes: Google echoes drive on the gmail-only reconnect, the grant never narrowed.
    const x = setup([await grant(), await grant({ refresh })]);
    await x.service.callback(JANE, "c1", (await x.start(["gmail", "drive"])).state);
    await x.service.disconnect(JANE, "drive");
    const r = await x.service.callback(JANE, "c2", (await x.start(["gmail"])).state);
    expect(r.services).toEqual(["gmail"]);
    expect((await x.service.list(JANE)).map((v) => [v.service, v.status])).toEqual([
      ["gmail", "connected"],
      ["drive", "not_connected"],
      ["calendar", "not_connected"],
      ["docs", "not_connected"],
    ]);
    const conn = (await x.connections.get(JANE))!;
    expect(conn.grantedScopes).not.toContain(DRIVE[0]!);
    expect(conn.grantedScopes).toEqual(expect.arrayContaining(GMAIL));
    // …and a scope nobody asked for is never stored.
    expect(conn.grantedScopes.every((s) => [...IDENTITY, "email", ...GMAIL].includes(s))).toBe(true);
  });

  test("scopes Google adds that nobody requested are not stored", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, ...GMAIL, ...DRIVE, "https://www.googleapis.com/auth/calendar"] })]);
    const r = await x.service.callback(JANE, "c1", (await x.start(["gmail"])).state);
    expect(r.services).toEqual(["gmail"]);
    expect((await x.connections.get(JANE))!.grantedScopes.sort()).toEqual([...IDENTITY, ...GMAIL].sort());
  });

  test("re-connect without a refresh token after reauth_required is refused", async () => {
    const x = setup([await grant(), await grant({ refresh: null })]);
    await x.service.callback(JANE, "c1", (await x.start()).state);
    await x.connections.markReauth(JANE, (await x.connections.get(JANE))!.refreshTokenEnc.ct);
    await expectFailure(x.service.callback(JANE, "c2", (await x.start()).state), "no_refresh_token");
  });

  test("re-connect with a new refresh token replaces the old one and clears reauth", async () => {
    const x = setup([await grant(), await grant({ refresh: "1//refresh-2" })]);
    await x.service.callback(JANE, "c1", (await x.start()).state);
    await x.connections.markReauth(JANE, (await x.connections.get(JANE))!.refreshTokenEnc.ct);
    expect((await x.service.list(JANE))[0]!.status).toBe("reauth_required");
    await x.service.callback(JANE, "c2", (await x.start()).state);
    const conn = (await x.connections.get(JANE))!;
    expect(conn.status).toBe("connected");
    expect(await x.cipher.decrypt(conn.refreshTokenEnc, JANE)).toBe("1//refresh-2");
  });
});

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------
async function seeded(scopes = [...IDENTITY, ...GMAIL, ...DRIVE], status: GoogleConnection["status"] = "connected") {
  const connections = new InMemoryGoogleConnectionStore();
  const cipher = createTokenCipher({ key: KEY });
  await connections.upsert({ actor: JANE, googleSub: "s", googleEmail: JANE, grantedScopes: scopes, refreshTokenEnc: await cipher.encrypt("1//refresh-1", JANE) });
  if (status === "reauth_required") await connections.markReauth(JANE, (await connections.get(JANE))!.refreshTokenEnc.ct);
  return { connections, cipher };
}
const minted = (token = "ya29.a", scope = [...IDENTITY, ...GMAIL, ...DRIVE], expires = 3600): Reply => ({
  body: { access_token: token, expires_in: expires, scope: scope.join(" "), token_type: "Bearer" },
});

describe("access token source", () => {
  test("not connected, and not an email", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle();
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken("bob@heubert.com")).toEqual({ ok: false, status: "not_connected" });
    expect(await src.accessToken("anonymous")).toEqual({ ok: false, status: "not_connected" });
    expect(g.tokenCalls()).toHaveLength(0);
  });

  test("a stored reauth_required never calls Google", async () => {
    const { connections, cipher } = await seeded(undefined, "reauth_required");
    const g = fakeGoogle();
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect((await src.accessToken(JANE)).ok).toBe(false);
    expect(await src.accessToken(JANE)).toMatchObject({ status: "reauth_required" });
    expect(g.tokenCalls()).toHaveLength(0);
  });

  test("refreshes once, caches until 60 s before expiry, and posts the decrypted refresh token", async () => {
    let t = 1_000_000;
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([minted("ya29.a", undefined, 3600), minted("ya29.b")]);
    const src = createGoogleTokenSource({ connections, cipher, now: () => t, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toEqual({ ok: true, token: "ya29.a", services: ["gmail", "drive"] });
    expect(g.tokenCalls()[0]!.form.get("refresh_token")).toBe("1//refresh-1");
    expect(g.tokenCalls()[0]!.form.get("grant_type")).toBe("refresh_token");
    t += 3_500_000;
    expect((await src.accessToken("JANE@heubert.com")) as { token: string }).toMatchObject({ token: "ya29.a" });
    expect(g.tokenCalls()).toHaveLength(1);
    t += 50_000; // now inside the 60 s margin
    expect(await src.accessToken(JANE)).toMatchObject({ token: "ya29.b" });
    expect(g.tokenCalls()).toHaveLength(2);
    expect((await connections.get(JANE))!.lastUsedAt).toBeInstanceOf(Date);
  });

  test("single flight: concurrent callers share one refresh", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([minted("ya29.a"), minted("ya29.b")]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    const [a, b, c] = await Promise.all([src.accessToken(JANE), src.accessToken(JANE), src.accessToken(JANE)]);
    expect(g.tokenCalls()).toHaveLength(1);
    expect([a, b, c].map((r) => (r as { token: string }).token)).toEqual(["ya29.a", "ya29.a", "ya29.a"]);
  });

  test("invalidate forces a new refresh", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([minted("ya29.a"), minted("ya29.b")]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    await src.accessToken(JANE);
    src.invalidate(JANE);
    expect(await src.accessToken(JANE)).toMatchObject({ token: "ya29.b" });
  });

  test("invalid_grant persists reauth_required", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([{ status: 400, body: { error: "invalid_grant" } }]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ ok: false, status: "reauth_required" });
    expect((await connections.get(JANE))!.status).toBe("reauth_required");
    expect(await src.accessToken(JANE)).toMatchObject({ status: "reauth_required" });
    expect(g.tokenCalls()).toHaveLength(1);
  });

  test("other failures are status error and leave the grant alone", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([{ status: 503, body: {} }]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ ok: false, status: "error" });
    expect((await connections.get(JANE))!.status).toBe("connected");
  });

  test("a stored token no key can read (another environment's, or tampered) asks the consultant to reconnect", async () => {
    const { connections } = await seeded();
    const g = fakeGoogle([minted()]);
    const other = createTokenCipher({ key: b64urlEncode(new Uint8Array(32).fill(9)) });
    const src = createGoogleTokenSource({ connections, cipher: other, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ ok: false, status: "reauth_required" });
    // Persisted, so the account menu offers Reconnect instead of showing Connected.
    expect((await connections.get(JANE))!.status).toBe("reauth_required");
    expect(g.tokenCalls()).toHaveLength(0);
  });

  test("a token sealed under a key id this deployment does not know is a config error, not a reconnect", async () => {
    const { connections } = await seeded();
    const g = fakeGoogle([minted()]);
    const rotated = createTokenCipher({ key: b64urlEncode(new Uint8Array(32).fill(9)), kid: "k9" });
    const src = createGoogleTokenSource({ connections, cipher: rotated, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ ok: false, status: "error" });
    expect((await connections.get(JANE))!.status).toBe("connected");
  });

  test("services are the stored grant ∩ the minted token's scopes", async () => {
    const { connections, cipher } = await seeded([...IDENTITY, ...GMAIL]);
    const g = fakeGoogle([minted("ya29.a", [...IDENTITY, ...GMAIL, ...DRIVE])]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ services: ["gmail"] });
  });

  test("another replica's disconnect or reauth reaches a cached token within 30 s", async () => {
    let t = 1_000_000;
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([minted("ya29.a"), minted("ya29.b")]);
    // This replica only reads the store; the writes below stand in for another replica.
    const src = createGoogleTokenSource({ connections, cipher, now: () => t, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    expect(await src.accessToken(JANE)).toMatchObject({ token: "ya29.a", services: ["gmail", "drive"] });

    await connections.setScopes(JANE, [...IDENTITY, ...GMAIL]);
    t += CONNECTION_TTL_MS + 1;
    expect(await src.accessToken(JANE)).toEqual({ ok: true, token: "ya29.a", services: ["gmail"] });
    expect(g.tokenCalls()).toHaveLength(1); // the access token itself stays cached

    await connections.markReauth(JANE, (await connections.get(JANE))!.refreshTokenEnc.ct);
    t += CONNECTION_TTL_MS + 1;
    expect(await src.accessToken(JANE)).toMatchObject({ ok: false, status: "reauth_required" });

    // A reconnect elsewhere stores a new refresh token: the old access token is not reused.
    await connections.upsert({ actor: JANE, googleSub: "s", googleEmail: JANE, grantedScopes: [...IDENTITY, ...GMAIL], refreshTokenEnc: await cipher.encrypt("1//refresh-2", JANE) });
    t += CONNECTION_TTL_MS + 1;
    expect(await src.accessToken(JANE)).toMatchObject({ ok: true, token: "ya29.b", services: ["gmail"] });
    expect(g.tokenCalls().at(-1)!.form.get("refresh_token")).toBe("1//refresh-2");

    await connections.delete(JANE);
    t += CONNECTION_TTL_MS + 1;
    expect(await src.accessToken(JANE)).toEqual({ ok: false, status: "not_connected" });
    expect(g.tokenCalls()).toHaveLength(2);
  });

  test("the stored connection is re-read at most every 30 s", async () => {
    let t = 1_000_000;
    const { connections, cipher } = await seeded();
    let reads = 0;
    const get = connections.get.bind(connections);
    connections.get = (a) => (reads++, get(a));
    const g = fakeGoogle([minted("ya29.a")]);
    const src = createGoogleTokenSource({ connections, cipher, now: () => t, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    await src.accessToken(JANE);
    t += 10_000;
    await src.accessToken(JANE);
    t += 10_000;
    await src.accessToken(JANE);
    expect(reads).toBe(1);
    t += CONNECTION_TTL_MS;
    await src.accessToken(JANE);
    expect(reads).toBe(2);
  });

  test("a stale refresh failing after a reconnect does not mark the new grant reauth_required", async () => {
    const { connections, cipher } = await seeded();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inRefresh = new Promise<void>((r) => (started = r));
    const refreshed: string[] = [];
    const oauth = {
      async refresh(rt: string) {
        refreshed.push(rt);
        if (refreshed.length > 1) return { accessToken: "ya29.new", expiresIn: 3600, scope: [] };
        started();
        await gate;
        throw new OAuthError("invalid_grant", "Google refused the grant (invalid_grant)", 400);
      },
    };
    const src = createGoogleTokenSource({ connections, cipher, oauth });
    const stale = src.accessToken(JANE);
    await inRefresh;
    // The consultant reconnects (on any replica) while the old refresh is still in flight.
    await connections.upsert({ actor: JANE, googleSub: "s", googleEmail: JANE, grantedScopes: [...IDENTITY, ...GMAIL, ...DRIVE], refreshTokenEnc: await cipher.encrypt("1//refresh-2", JANE) });
    release();
    expect(await stale).toMatchObject({ ok: false, status: "error" });
    expect((await connections.get(JANE))!.status).toBe("connected");
    expect(await src.accessToken(JANE)).toMatchObject({ ok: true, token: "ya29.new" });
    expect(refreshed).toEqual(["1//refresh-1", "1//refresh-2"]);
  });

  test("markReauth only applies to the refresh token it names", async () => {
    const { connections } = await seeded();
    const ct = (await connections.get(JANE))!.refreshTokenEnc.ct;
    expect(await connections.markReauth(JANE, "some-other-ct")).toBe(false);
    expect((await connections.get(JANE))!.status).toBe("connected");
    expect(await connections.markReauth("bob@heubert.com", ct)).toBe(false);
    expect(await connections.markReauth(JANE, ct)).toBe(true);
    expect((await connections.get(JANE))!.status).toBe("reauth_required");
  });

  test("an aborted caller stops waiting without cancelling the shared refresh", async () => {
    const { connections, cipher } = await seeded();
    const g = fakeGoogle([minted("ya29.a")]);
    const src = createGoogleTokenSource({ connections, cipher, oauth: createGoogleOAuth({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, fetchImpl: g.fetchImpl }) });
    const ac = new AbortController();
    const first = src.accessToken(JANE, ac.signal);
    const second = src.accessToken(JANE);
    ac.abort();
    expect(await first).toMatchObject({ ok: false, status: "error", reason: "aborted" });
    expect(await second).toMatchObject({ ok: true, token: "ya29.a" });
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------
describe("disconnect", () => {
  test("one of two services: narrows locally, no revoke, keeps the grant", async () => {
    const x = setup([await grant(), minted("ya29.a")]);
    await x.service.callback(JANE, "c1", (await x.start()).state);
    const views = await x.service.disconnect(JANE, "drive");
    expect(views.map((v) => [v.service, v.status])).toEqual([
      ["gmail", "connected"],
      ["drive", "not_connected"],
      ["calendar", "not_connected"],
      ["docs", "not_connected"],
    ]);
    expect(x.google.revokes()).toHaveLength(0);
    const conn = (await x.connections.get(JANE))!;
    expect(conn.grantedScopes).not.toContain(DRIVE[0]!);
    expect(await x.cipher.decrypt(conn.refreshTokenEnc, JANE)).toBe("1//refresh-1");
    // Google still mints drive in the token; Edge no longer offers it.
    expect(await x.tokens.accessToken(JANE)).toMatchObject({ services: ["gmail"] });
    expect(x.events.at(-1)).toMatchObject({ type: INTEGRATION_EVENT.disconnected, details: { service: "drive", remaining: ["gmail"], revoked: false } });
    expect(x.changed).toEqual([JANE, JANE]);
  });

  test("the last service: revokes at Google and deletes", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, ...GMAIL] })]);
    await x.service.callback(JANE, "c1", (await x.start(["gmail"])).state);
    const views = await x.service.disconnect(JANE, "gmail");
    expect(views.every((v) => v.status === "not_connected")).toBe(true);
    expect(x.google.revokes().map((c) => c.form.get("token"))).toEqual(["1//refresh-1"]);
    expect(await x.connections.get(JANE)).toBeNull();
    expect(x.events.at(-1)).toMatchObject({ type: INTEGRATION_EVENT.disconnected, details: { service: "gmail", remaining: [], revoked: true } });
    expect(x.invalidated.at(-1)).toBe(JANE);
  });

  test("both, one after the other, ends with a revoke and nothing stored", async () => {
    const x = setup([await grant()]);
    await x.service.callback(JANE, "c1", (await x.start()).state);
    await x.service.disconnect(JANE, "gmail");
    await x.service.disconnect(JANE, "drive");
    expect(x.google.revokes()).toHaveLength(1);
    expect(await x.connections.get(JANE)).toBeNull();
  });

  test("the last service when Google's revoke fails: deleted here, logged at error, revoked:false returned", async () => {
    const x = setup([await grant({ scope: [...IDENTITY, ...GMAIL] })], { revokeStatus: 503 });
    await x.service.callback(JANE, "c1", (await x.start(["gmail"])).state);
    const r = await x.service.disconnectDetailed(JANE, "gmail");
    expect(r.revoked).toBe(false);
    expect(r.integrations.every((v) => v.status === "not_connected")).toBe(true);
    expect(await x.connections.get(JANE)).toBeNull();
    expect(x.errors).toHaveLength(1);
    expect(x.errors[0]!.fields).toMatchObject({ revoked: false, service: "gmail" });
    expect(JSON.stringify(x.errors)).not.toContain("1//refresh-1");
    expect(x.events.at(-1)).toMatchObject({ type: INTEGRATION_EVENT.disconnected, details: { revoked: false } });
  });

  test("disconnectDetailed says revoked:true on a confirmed full disconnect and nothing on a partial one", async () => {
    const x = setup([await grant()]);
    await x.service.callback(JANE, "c1", (await x.start()).state);
    const partial = await x.service.disconnectDetailed(JANE, "drive");
    expect(partial).not.toHaveProperty("revoked");
    expect(partial.integrations.map((v) => v.status)).toEqual(["connected", "not_connected", "not_connected", "not_connected"]);
    expect(await x.service.disconnectDetailed(JANE, "gmail")).toMatchObject({ revoked: true });
    expect(x.errors).toHaveLength(0);
  });

  test("nothing connected is a no-op", async () => {
    const x = setup();
    expect((await x.service.disconnect(JANE, "gmail")).every((v) => v.status === "not_connected")).toBe(true);
    expect(x.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Mongo connection store (the queries it sends)
// ---------------------------------------------------------------------------
describe("MongoGoogleConnectionStore", () => {
  const fakeCollection = () => {
    const ops: { op: string; filter: Record<string, unknown>; update?: Record<string, unknown> }[] = [];
    const collection = {
      async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
        ops.push({ op: "findOneAndUpdate", filter, update });
        return null;
      },
      async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
        ops.push({ op: "updateOne", filter, update });
        return { matchedCount: 0 };
      },
    } as unknown as Collection<GoogleConnectionDoc>;
    return { ops, store: new MongoGoogleConnectionStore(collection) };
  };

  test("an upsert without a refresh token sets the computed scopes (no $addToSet)", async () => {
    const { ops, store } = fakeCollection();
    await store.upsert({ actor: JANE, googleSub: "s", googleEmail: JANE, grantedScopes: [...IDENTITY, ...GMAIL, ...GMAIL] });
    expect(ops[0]!.filter).toEqual({ _id: JANE, status: "connected", googleSub: "s" });
    expect(ops[0]!.update).not.toHaveProperty("$addToSet");
    expect((ops[0]!.update as { $set: { grantedScopes: string[] } }).$set.grantedScopes).toEqual([...IDENTITY, ...GMAIL]);
  });

  test("markReauth is conditional on the refresh token it names", async () => {
    const { ops, store } = fakeCollection();
    expect(await store.markReauth("Jane@Heubert.com", "ct-1")).toBe(false);
    expect(ops[0]!.filter).toEqual({ _id: JANE, "refreshTokenEnc.ct": "ct-1" });
  });
});

// ---------------------------------------------------------------------------
// chat_turns redaction
// ---------------------------------------------------------------------------
describe("redactWorkspaceEvidence", () => {
  test("blanks Gmail/Drive bodies, adds a sha256, leaves the rest alone", () => {
    const kb = { id: "k", title: "KB", url: "https://x", source: "experteducation.com", content: "public text", kind: "kb" };
    const mail = { id: "m", title: "Re: CoE", url: "https://mail.google.com/mail/u/0/#all/1", source: "gmail", content: "Priya's passport number is X", kind: "gmail" };
    const src = { n: 2, title: "Offer.pdf", url: "https://drive.google.com/file/d/1", source: "drive", excerpt: "Offer for Priya", live: true, kind: "drive" };
    const legacy = { id: "l", title: "t", url: "u", source: "gmail:jane@heubert.com", content: "body", matchedBy: ["gmail"] };
    const [a, b, c, d] = redactWorkspaceEvidence<Record<string, unknown>>([kb, mail, src, legacy]);
    expect(a).toBe(kb);
    expect(b).toMatchObject({ id: "m", title: "Re: CoE", url: mail.url, content: "", contentSha256: new Bun.CryptoHasher("sha256").update(mail.content).digest("hex") });
    expect(c).toMatchObject({ n: 2, excerpt: "", contentSha256: new Bun.CryptoHasher("sha256").update("Offer for Priya").digest("hex") });
    expect(c).not.toHaveProperty("content");
    expect(d).toMatchObject({ content: "" });
    expect(JSON.stringify([b, c, d])).not.toContain("Priya");
    expect(mail.content).toContain("Priya"); // input untouched
  });
});
