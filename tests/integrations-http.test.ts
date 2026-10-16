/**
 * The integration routes over HTTP. Most cases run on a tiny Bun.serve that reproduces the guard's
 * identity rule (x-api-key plus optional x-user-id → ctx.ownerId, else "anonymous") and its error
 * envelope; the last suite checks the real createApp mounts them behind the real guard.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createIntegrationRoutes, disabledIntegrationRoutes, type IntegrationRoutes } from "../src/app/integrations";
import { ApiError, errorResponse } from "../src/app/http";
import type { RequestContext } from "../src/app/routes";
import { AuthError, b64urlEncode } from "../src/auth/supabase";
import { InMemoryGoogleConnectionStore } from "../src/google/connections";
import { createTokenCipher } from "../src/google/crypto";
import { createIntegrationsService } from "../src/google/integrations";
import { createGoogleOAuth, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from "../src/google/oauth";
import { InMemoryOAuthStateStore } from "../src/google/state-store";
import { createGoogleTokenSource } from "../src/google/token-cache";
import { SERVICE_SCOPES } from "../src/google/types";

const API_KEY = "test-api-key-0123456789abcdef0123456789";
const JANE = "jane@heubert.com";
const SCOPES = ["openid", "email", ...SERVICE_SCOPES.gmail, ...SERVICE_SCOPES.drive];

/**
 * A JWT-shaped stand-in for Google's id_token: the fake verifier below accepts it, and the service
 * reads `hd` from its payload. The code rides in the signature segment so the verifier can see it.
 */
const fakeIdToken = (code: string | null) => {
  const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: "RS256" })}.${enc(code?.includes("nohd") ? {} : { hd: "heubert.com" })}.id-for-${code}`;
};

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

function mount(routes: IntegrationRoutes) {
  const handle =
    (h: (req: Request, ctx: RequestContext, param?: string) => Promise<Response>) =>
    async (req: Request & { params?: Record<string, string> }) => {
      const requestId = crypto.randomUUID();
      try {
        const key = req.headers.get("x-api-key");
        if (key !== API_KEY) return errorResponse(new ApiError(401, "unauthorized", "Invalid x-api-key"), requestId);
        const user = (req.headers.get("x-user-id") ?? "").trim();
        const ctx: RequestContext = { requestId, ownerId: user || "anonymous", auth: "api_key", user: null, signal: req.signal, details: {} };
        return await h(req, ctx, req.params ? Object.values(req.params)[0] : undefined);
      } catch (err) {
        return errorResponse(err, requestId);
      }
    };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/v1/integrations": { GET: handle(routes.listIntegrations) },
      "/v1/integrations/google/connect": { POST: handle(routes.connectGoogle) },
      "/v1/integrations/google/callback": { POST: handle(routes.googleCallback) },
      "/v1/integrations/google/:service": { DELETE: handle((req, ctx, s) => routes.disconnectGoogle(req, ctx, s!)) },
    },
    fetch: () => new Response("not found", { status: 404 }),
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (method: string, path: string, body?: unknown, user: string | null = JANE) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": API_KEY };
    if (user !== null) headers["x-user-id"] = user;
    const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { call, base };
}

function setup() {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, form });
    if (url === GOOGLE_REVOKE_URL) return new Response("", { status: 200 });
    if (url === GOOGLE_TOKEN_URL) {
      if (form.get("code") === "bad-code") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "ya29.a", refresh_token: "1//r", expires_in: 3600, scope: SCOPES.join(" "), id_token: fakeIdToken(form.get("code")) });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const oauth = createGoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://edge.test/api/integrations/google/callback", fetchImpl });
  const connections = new InMemoryGoogleConnectionStore();
  const cipher = createTokenCipher({ key: b64urlEncode(new Uint8Array(32).fill(1)) });
  const tokens = createGoogleTokenSource({ connections, oauth, cipher });
  const integrations = createIntegrationsService({
    oauth,
    states: new InMemoryOAuthStateStore(),
    connections,
    cipher,
    tokens,
    allowedDomains: ["heubert.com"],
    clientId: "cid",
    // The id_token's signature path is covered in google-oauth.test.ts; here "id-for-<code>" names the account.
    verifyIdToken: async (t, o) => {
      expect(o).toEqual({ clientId: "cid", allowedDomains: ["heubert.com"] });
      const email = t.includes("other") ? "bob@heubert.com" : JANE;
      if (t.includes("gmailcom")) throw new AuthError("domain_not_allowed", "nope");
      return { sub: "sub-1", email, domain: "heubert.com", name: null, picture: null };
    },
  });
  return { ...mount(createIntegrationRoutes({ integrations, logger: { info: () => {}, warn: () => {} } })), calls, connections };
}

const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

describe("integration routes", () => {
  test("list → connect → callback → list → disconnect", async () => {
    const { call, calls } = setup();
    let r = await call("GET", "/v1/integrations");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      enabled: true,
      integrations: [
        { service: "gmail", status: "not_connected", googleEmail: null, connectedAt: null },
        { service: "drive", status: "not_connected", googleEmail: null, connectedAt: null },
        { service: "calendar", status: "not_connected", googleEmail: null, connectedAt: null },
        { service: "docs", status: "not_connected", googleEmail: null, connectedAt: null },
      ],
    });

    r = await call("POST", "/v1/integrations/google/connect", { services: ["gmail", "drive"], returnTo: "/chat/s1" });
    expect(r.status).toBe(200);
    expect(r.body.url).toStartWith("https://accounts.google.com/o/oauth2/v2/auth?");

    r = await call("POST", "/v1/integrations/google/callback", { code: "good-code", state: stateOf(r.body.url) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ services: ["gmail", "drive"], returnTo: "/chat/s1" });

    r = await call("GET", "/v1/integrations");
    expect(r.body.integrations.map((v: any) => v.status)).toEqual(["connected", "connected", "not_connected", "not_connected"]);
    expect(r.body.integrations[0].googleEmail).toBe(JANE);

    r = await call("DELETE", "/v1/integrations/google/drive");
    expect(r.status).toBe(200);
    expect(r.body.integrations.map((v: any) => v.status)).toEqual(["connected", "not_connected", "not_connected", "not_connected"]);
    r = await call("DELETE", "/v1/integrations/google/gmail");
    expect(r.body.integrations.map((v: any) => v.status)).toEqual(["not_connected", "not_connected", "not_connected", "not_connected"]);
    expect(calls.filter((c) => c.url === GOOGLE_REVOKE_URL)).toHaveLength(1);
  });

  test("the server key acting for nobody is refused on every route", async () => {
    const { call } = setup();
    for (const [m, p, b] of [
      ["GET", "/v1/integrations"],
      ["POST", "/v1/integrations/google/connect", { services: ["gmail"] }],
      ["POST", "/v1/integrations/google/callback", { code: "c", state: "s".repeat(43) }],
      ["DELETE", "/v1/integrations/google/gmail"],
    ] as const) {
      const r = await call(m, p, b, null);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("unauthorized");
    }
  });

  test("an x-user-id that is not an email is forbidden", async () => {
    const { call } = setup();
    const r = await call("GET", "/v1/integrations", undefined, "service-account-7");
    expect(r.status).toBe(403);
  });

  test("bodies are strict", async () => {
    const { call } = setup();
    for (const body of [
      { services: [] },
      { services: ["gmail", "gmail"] },
      { services: ["photos"] },
      { services: ["gmail"], extra: 1 },
    ]) {
      const r = await call("POST", "/v1/integrations/google/connect", body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("validation_error");
    }
    const r = await call("POST", "/v1/integrations/google/callback", { code: "c", state: "s".repeat(43), scope: "x" });
    expect(r.status).toBe(400);
  });

  test("callback failures are 400 with the reason as the code", async () => {
    const { call } = setup();
    let r = await call("POST", "/v1/integrations/google/callback", { code: "good-code", state: "s".repeat(43) });
    expect([r.status, r.body.error.code]).toEqual([400, "state_invalid"]);

    const start = async () => stateOf((await call("POST", "/v1/integrations/google/connect", { services: ["gmail"] })).body.url);
    r = await call("POST", "/v1/integrations/google/callback", { code: "bad-code", state: await start() });
    expect([r.status, r.body.error.code]).toEqual([400, "exchange_failed"]);
    r = await call("POST", "/v1/integrations/google/callback", { code: "other-account", state: await start() });
    expect([r.status, r.body.error.code]).toEqual([400, "account_mismatch"]);
    r = await call("POST", "/v1/integrations/google/callback", { code: "gmailcom", state: await start() });
    expect([r.status, r.body.error.code]).toEqual([400, "account_mismatch"]);
    // A consumer Google account on the company address has no hd claim.
    r = await call("POST", "/v1/integrations/google/callback", { code: "nohd-account", state: await start() });
    expect([r.status, r.body.error.code]).toEqual([400, "account_mismatch"]);

    // The state is bound to Jane: Bob cannot finish her consent.
    const s = await start();
    r = await call("POST", "/v1/integrations/google/callback", { code: "good-code", state: s }, "bob@heubert.com");
    expect([r.status, r.body.error.code]).toEqual([400, "state_invalid"]);
  });

  test("connect from a non-Workspace identity is refused", async () => {
    const { call } = setup();
    const r = await call("POST", "/v1/integrations/google/connect", { services: ["gmail"] }, "someone@gmail.com");
    expect([r.status, r.body.error.code]).toEqual([400, "domain_not_allowed"]);
  });

  test("an unknown service is 404", async () => {
    const { call } = setup();
    const r = await call("DELETE", "/v1/integrations/google/photos");
    expect([r.status, r.body.error.code]).toEqual([404, "unknown_service"]);
  });
});

describe("disabled integration routes", () => {
  test("list says disabled; the rest are 503", async () => {
    const { call } = mount(disabledIntegrationRoutes);
    const r = await call("GET", "/v1/integrations");
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(false);
    expect(r.body.integrations.map((v: any) => v.status)).toEqual(["not_connected", "not_connected", "not_connected", "not_connected"]);
    for (const [m, p, b] of [
      ["POST", "/v1/integrations/google/connect", { services: ["gmail"] }],
      ["POST", "/v1/integrations/google/callback", { code: "c", state: "s".repeat(43) }],
      ["DELETE", "/v1/integrations/google/gmail"],
    ] as const) {
      const x = await call(m, p, b);
      expect([x.status, x.body.error.code]).toEqual([503, "integrations_disabled"]);
    }
  });
});

describe("integration routes inside createApp", () => {
  const { createApp } = require("../src/app") as typeof import("../src/app");
  const { ChatService } = require("../src/app/service") as typeof import("../src/app/service");
  const { InMemoryChatStore } = require("../src/memory/in-memory") as typeof import("../src/memory/in-memory");
  const { createLogger } = require("../src/observability/logger") as typeof import("../src/observability/logger");
  const { NullKnowledgeStore } = require("../src/retrieval/store") as typeof import("../src/retrieval/store");
  const { fakeGraph, intentOf, testEnv } = require("./helpers") as typeof import("./helpers");
  const apps: { shutdown: (ms?: number) => Promise<void> }[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.shutdown(0);
  });

  const start = (integrations?: IntegrationRoutes) => {
    const env = testEnv({ API_KEY });
    const logger = createLogger({ test: true });
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({ intent: intentOf({}) });
    const app = createApp(
      { env, service: new ChatService({ env, graph, store, logger }), store, knowledge: new NullKnowledgeStore(), collections: null, logger, readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now(), ...(integrations ? { integrations } : {}) },
      { port: 0, hostname: "127.0.0.1" },
    );
    apps.push(app);
    return async (method: string, path: string, user: string | null = JANE, body?: unknown) => {
      const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": API_KEY, ...(user ? { "x-user-id": user } : {}) };
      const r = await fetch(`http://127.0.0.1:${app.server.port}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: (await r.json()) as any };
    };
  };

  test("without the integration configured the routes say disabled", async () => {
    const call = start();
    const list = await call("GET", "/v1/integrations");
    expect(list.status).toBe(200);
    expect(list.body.enabled).toBe(false);
    expect((await call("POST", "/v1/integrations/google/connect", JANE, { services: ["gmail"] })).status).toBe(503);
  });

  test("configured routes are mounted behind the real guard", async () => {
    const oauth = createGoogleOAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://edge.test/cb" });
    const connections = new InMemoryGoogleConnectionStore();
    const cipher = createTokenCipher({ key: b64urlEncode(new Uint8Array(32).fill(2)) });
    const tokens = createGoogleTokenSource({ connections, oauth, cipher });
    const integrations = createIntegrationsService({ oauth, states: new InMemoryOAuthStateStore(), connections, cipher, tokens, allowedDomains: ["heubert.com"], clientId: "cid" });
    const call = start(createIntegrationRoutes({ integrations, logger: { info: () => {}, warn: () => {} } }));
    const list = await call("GET", "/v1/integrations");
    expect(list.body).toEqual({ enabled: true, integrations: ["gmail", "drive", "calendar", "docs"].map((service) => expect.objectContaining({ service, status: "not_connected" })) });
    const connect = await call("POST", "/v1/integrations/google/connect", JANE, { services: ["gmail", "drive"], returnTo: "/chat/abc" });
    expect(connect.status).toBe(200);
    expect(new URL(connect.body.url).searchParams.get("login_hint")).toBe(JANE);
    // The server key acting for nobody never reaches a consultant's Google account.
    expect((await call("GET", "/v1/integrations", null)).status).toBe(401);
    expect((await call("DELETE", "/v1/integrations/google/gmail")).status).toBe(200);
  });
});
