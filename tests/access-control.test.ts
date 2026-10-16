import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { signSession } from "../src/auth/session";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

/**
 * Access-control contract: any verified Google account may use the chatbot
 * when user auth is on (no email-domain restriction). Sessions are only ever
 * minted by the backend after Google verification; tampered, foreign-secret,
 * or expired sessions must still be rejected.
 */
const SECRET = "test-session-secret-0123456789abcdef0123456789";
const API_KEY = "test-api-key-0123456789abcdef0123456789";
let base = "";
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const env = testEnv({ API_KEY, GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com", SESSION_SECRET: SECRET });
  const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "general_inquiry" }), answer: "Hello from Edge." });
  const store = new InMemoryChatStore();
  app = createApp(
    {
      env,
      service: new ChatService({ env, graph, store, logger: createLogger({ test: true }) }),
      store,
      knowledge: new NullKnowledgeStore([sampleChunk()]),
      collections: null,
      logger: createLogger({ test: true }),
      readiness: async () => ({ ok: true, checks: {} }),
      startedAt: Date.now(),
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  base = `http://127.0.0.1:${app.server.port}`;
});
afterAll(async () => app.shutdown(1_000));

const chat = (headers: Record<string, string>) =>
  fetch(base + "/v1/chat", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ message: "hi" }) });

async function sessionFor(email: string) {
  return (await signSession({ sub: "u-" + email, email, name: null, picture: null }, SECRET, 3600)).token;
}

describe("sign-in and session auth", () => {
  test("no credentials → 401", async () => {
    expect((await chat({})).status).toBe(401);
  });
  test("@heubert.com session → 200", async () => {
    const r = await chat({ authorization: `Bearer ${await sessionFor("testuser@heubert.com")}` });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { answer: string }).answer).toContain("Hello from Edge");
  });
  test("@experteducation.com.au session → 200", async () => {
    expect((await chat({ authorization: `Bearer ${await sessionFor("staff@experteducation.com.au")}` })).status).toBe(200);
  });
  test("any other Google account session → 200 (no domain restriction)", async () => {
    for (const email of ["someone@gmail.com", "x@outlook.com", "x@heubert.com.evil.com", "x@random-personal-domain.io"]) {
      const r = await chat({ authorization: `Bearer ${await sessionFor(email)}` });
      expect(r.status).toBe(200);
    }
  });
  test("tampered or foreign-secret session → 401", async () => {
    const good = await sessionFor("testuser@heubert.com");
    const tampered = good.slice(0, -4) + "AAAA";
    expect((await chat({ authorization: `Bearer ${tampered}` })).status).toBe(401);
    const foreign = (await signSession({ sub: "u", email: "testuser@heubert.com", name: null, picture: null }, "another-secret-another-secret-another-secret", 3600)).token;
    expect((await chat({ authorization: `Bearer ${foreign}` })).status).toBe(401);
  });
  test("expired session → 401", async () => {
    const expired = (await signSession({ sub: "u", email: "testuser@heubert.com", name: null, picture: null }, SECRET, 60, Date.now() - 3_600_000)).token;
    expect((await chat({ authorization: `Bearer ${expired}` })).status).toBe(401);
  });
  test("server API key still works for the trusted proxy", async () => {
    expect((await chat({ "x-api-key": API_KEY })).status).toBe(200);
    expect((await chat({ "x-api-key": "wrong" })).status).toBe(401);
  });
  test("a signed-in user cannot act as another owner via `userId`", async () => {
    const victim = { authorization: `Bearer ${await sessionFor("victim@heubert.com")}` };
    const attacker = { authorization: `Bearer ${await sessionFor("attacker@heubert.com")}` };
    const post = (h: Record<string, string>, body: Record<string, unknown>) =>
      fetch(base + "/v1/chat", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const v = (await (await post(victim, { message: "my private question", newSession: true })).json()) as { sessionId: string };
    // Attacker names the victim as `userId`: the request must stay scoped to the attacker.
    const a = (await (await post(attacker, { message: "hi", userId: "victim@heubert.com" })).json()) as { sessionId: string };
    expect(a.sessionId).not.toBe(v.sessionId);
    const peek = await fetch(`${base}/v1/sessions/${v.sessionId}`, { headers: attacker });
    expect(peek.status).toBe(404);
    const list = (await (await fetch(base + "/v1/sessions", { headers: attacker })).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((s) => s.id)).not.toContain(v.sessionId);
  });
  test("/auth/google rejects garbage credentials without leaking", async () => {
    const r = await fetch(base + "/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: "not-a-real-google-token-at-all" }) });
    expect(r.status).toBe(401);
  });
});
