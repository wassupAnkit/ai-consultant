import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AIMessageChunk } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { ANSWER_CUT_OFF_ERROR_NOTE } from "../src/graph/nodes";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore, type KnowledgeStore, type RetrievedChunk, type SearchQuery } from "../src/retrieval/store";
import { StreamThenFailChatModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const API_KEY = "test-api-key-0123456789abcdef0123456789";
let base = "";
let app: ReturnType<typeof createApp>;
let store: InMemoryChatStore;

/** Records what the routes ask the knowledge base for. */
class RecordingKnowledgeStore implements KnowledgeStore {
  readonly queries: SearchQuery[] = [];
  private readonly inner: NullKnowledgeStore;
  constructor(results: RetrievedChunk[]) {
    this.inner = new NullKnowledgeStore(results);
  }
  async search(query: SearchQuery) {
    this.queries.push(query);
    return this.inner.search();
  }
  ping() {
    return this.inner.ping();
  }
  count() {
    return this.inner.count();
  }
}
const kb = new RecordingKnowledgeStore([sampleChunk()]);

beforeAll(() => {
  const env = testEnv({ API_KEY, CORS_ORIGINS: "https://app.example.com" });
  const { graph } = fakeGraph({
    intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost in Australia?" }),
    answer: "Tuition is AUD 20k–45k [1].",
  });
  store = new InMemoryChatStore();
  const service = new ChatService({
    env,
    graph,
    store,
    logger: createLogger({ test: true }),
    // Deterministic stand-in for the post-answer model calls (title + follow-up chips).
    extras: {
      title: async ({ message }) => `Auto: ${message.slice(0, 20)}`,
      followUps: async ({ message }) => [`More on ${message.slice(0, 12)}?`, "Which intake is next?"],
    },
  });
  app = createApp(
    {
      env,
      service,
      store,
      knowledge: kb,
      collections: null,
      logger: createLogger({ test: true }),
      readiness: async () => ({ ok: true, checks: { mongodb: "ok" } }),
      startedAt: Date.now(),
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  base = `http://127.0.0.1:${app.server.port}`;
});

afterAll(async () => {
  await app.shutdown(1_000);
});

const headers = { "content-type": "application/json", "x-api-key": API_KEY };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();

describe("HTTP API", () => {
  test("health endpoints are open", async () => {
    for (const p of ["/health", "/healthz", "/readyz"]) {
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
    }
    const body = await j(await fetch(base + "/health"));
    expect(body.assistant).toBe("Edge");
  });

  test("protected routes require the API key", async () => {
    const r = await fetch(base + "/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
    expect(r.status).toBe(401);
    const bad = await fetch(base + "/v1/chat", { method: "POST", headers: { ...headers, "x-api-key": "nope" }, body: JSON.stringify({ message: "hi" }) });
    expect(bad.status).toBe(401);
  });

  test("validates the body", async () => {
    const r = await fetch(base + "/v1/chat", { method: "POST", headers, body: JSON.stringify({}) });
    expect(r.status).toBe(400);
    const body = await j(r);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.requestId).toBeString();
  });

  test("chat answers with intent, sources and session continuity", async () => {
    const r1 = await fetch(base + "/v1/chat", { method: "POST", headers: { ...headers, "x-user-id": "u1" }, body: JSON.stringify({ message: "Cost in Australia?" }) });
    expect(r1.status).toBe(200);
    const b1 = await j(r1);
    expect(b1.answer).toContain("AUD 20k");
    expect(b1.result).toBe(b1.answer);
    expect(b1.intent.primary).toBe("financial_viability");
    expect(b1.sources[0].url).toContain("experteducation.com");
    expect(r1.headers.get("x-request-id")).toBeString();

    // Same user, no sessionId → continues the latest session.
    const r2 = await fetch(base + "/v1/chat", { method: "POST", headers: { ...headers, "x-user-id": "u1" }, body: JSON.stringify({ message: "and Canada?" }) });
    const b2 = await j(r2);
    expect(b2.sessionId).toBe(b1.sessionId);

    // Session history is owner-scoped.
    const mine = await fetch(`${base}/v1/sessions/${b1.sessionId}`, { headers: { ...headers, "x-user-id": "u1" } });
    expect(mine.status).toBe(200);
    expect((await j(mine)).messages.length).toBeGreaterThanOrEqual(2);
    const theirs = await fetch(`${base}/v1/sessions/${b1.sessionId}`, { headers: { ...headers, "x-user-id": "u2" } });
    expect(theirs.status).toBe(404);
  });

  test("legacy /chat with `input` still works", async () => {
    const r = await fetch(base + "/chat", { method: "POST", headers, body: JSON.stringify({ input: "Cost?" }) });
    expect(r.status).toBe(200);
    expect((await j(r)).result).toContain("AUD");
  });

  test("streams NDJSON events compatible with the frontend", async () => {
    const r = await fetch(base + "/v1/chat/stream?format=ndjson", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", newSession: true }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const events = lines.map((l) => l.event);
    expect(events[0]).toBe("meta");
    expect(events).toContain("intent");
    expect(events).toContain("token");
    // Stage progress is additive and arrives before the first token.
    const stages = lines.filter((l) => l.event === "status").map((l) => l.data.stage);
    expect(stages).toEqual(["classifying", "researching", "answering"]);
    expect(events.indexOf("status")).toBeLessThan(events.indexOf("token"));
    const done = lines.find((l) => l.event === "done")!.data;
    expect(done.mode).toBe("consultant");
    expect(done.research).toMatchObject({ rounds: 0, toolCalls: 0, liveUrls: [] });
    expect(done.followUps).toEqual([]);
    const tokens = lines.filter((l) => l.event === "token").map((l) => l.data.chunk).join("");
    expect(tokens).toContain("AUD 20k");
    // The answer is complete at `done`; the title and the chips follow it, in either order.
    const after = events.slice(events.indexOf("done") + 1).sort();
    expect(after).toEqual(["session", "suggestions"]);
    expect(lines.find((l) => l.event === "session")!.data).toEqual({ sessionId: done.sessionId, title: "Auto: Cost?" });
    expect(lines.find((l) => l.event === "suggestions")!.data).toEqual({ requestId: done.requestId, items: ["More on Cost??", "Which intake is next?"] });
  });

  test("only the first turn of a conversation is titled; every answer gets follow-ups", async () => {
    const h = { ...headers, "x-user-id": "titler" };
    const read = async (body: unknown) => {
      const r = await fetch(base + "/v1/chat/stream?format=ndjson", { method: "POST", headers: h, body: JSON.stringify(body) });
      return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    };
    const first = await read({ message: "Cost?", newSession: true });
    const sessionId = first.find((l) => l.event === "done")!.data.sessionId;
    expect(first.map((l) => l.event)).toContain("session");
    const second = await read({ message: "And living costs?", sessionId });
    const events = second.map((l) => l.event);
    expect(events).not.toContain("session");
    expect(events.at(-1)).toBe("suggestions");
    // Stored, so the reopened thread offers the same chips; the title is the model's, not the first message.
    const hist = await j(await fetch(`${base}/v1/sessions/${sessionId}`, { headers: h }));
    expect(hist.session.title).toBe("Auto: Cost?");
    expect(hist.messages[3].followUps).toEqual(["More on And living c?", "Which intake is next?"]);
    expect(hist.messages[3].stopped).toBe(false);
    expect(hist.messages[3].intentDetail).toMatchObject({ primary: "financial_viability", task: expect.any(String), confidence: "high" });
    expect(hist.messages[2].followUps).toBeUndefined();
  });

  test("regenerate answers the newest question again in place of the stored answer", async () => {
    const h = { ...headers, "x-user-id": "regenerator" };
    const first = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "Cost?", newSession: true }) }));
    await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "Living costs?", sessionId: first.sessionId }) });
    const before = await j(await fetch(`${base}/v1/sessions/${first.sessionId}`, { headers: h }));
    expect(before.count).toBe(4);
    const again = await j(
      await fetch(base + "/v1/chat", { method: "POST", headers: { ...h, "x-request-id": "regen-0123456789" }, body: JSON.stringify({ message: "Living costs?", sessionId: first.sessionId, regenerate: true }) }),
    );
    expect(again.sessionId).toBe(first.sessionId);
    const after = await j(await fetch(`${base}/v1/sessions/${first.sessionId}`, { headers: h }));
    // Still two turns: the replaced pair is gone and the new answer sits where it was.
    expect(after.count).toBe(4);
    expect(after.messages.map((m: { role: string }) => m.role)).toEqual(["human", "ai", "human", "ai"]);
    expect(after.messages[3].requestId).toBe(again.requestId);
    expect(after.messages[3].requestId).not.toBe(before.messages[3].requestId);
    expect(after.session.messageCount).toBe(4);
    // Without a sessionId there is nothing to replace; the flag is ignored rather than rejected.
    const fresh = await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "Cost?", newSession: true, regenerate: true }) });
    expect(fresh.status).toBe(200);
  });

  test("streams SSE by default", async () => {
    const r = await fetch(base + "/v1/chat/stream", { method: "POST", headers, body: JSON.stringify({ message: "Cost?" }) });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const text = await r.text();
    expect(text).toContain("event: token");
    expect(text).toContain("event: done");
  });

  test("CORS allowlist and preflight", async () => {
    const pre = await fetch(base + "/v1/chat", { method: "OPTIONS", headers: { origin: "https://app.example.com" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    const denied = await fetch(base + "/health", { headers: { origin: "https://evil.example.com" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("unknown routes return a JSON 404", async () => {
    const r = await fetch(base + "/nope");
    expect(r.status).toBe(404);
    expect((await j(r)).error.code).toBe("not_found");
  });

  test("feedback is accepted", async () => {
    const r = await fetch(base + "/v1/feedback", { method: "POST", headers, body: JSON.stringify({ requestId: "req-12345678", score: 1 }) });
    expect(r.status).toBe(202);
  });

  test("chat returns the consultant persona and cited excerpts; a legacy `mode` field is accepted and ignored", async () => {
    const r = await fetch(base + "/v1/chat", { method: "POST", headers: { ...headers, "x-user-id": "staff1" }, body: JSON.stringify({ message: "Cost?", mode: "counsellor", newSession: true }) });
    expect(r.status).toBe(200);
    const b = await j(r);
    expect(b.mode).toBe("consultant");
    expect(b.sources[0].excerpt).toContain("Bachelor tuition");
    const ignored = await fetch(base + "/v1/chat", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", mode: "wizard" }) });
    expect(ignored.status).toBe(200);
    expect((await j(ignored)).mode).toBe("consultant");
  });

  test("lists the caller's sessions, newest first, owner-scoped", async () => {
    const h = { ...headers, "x-user-id": "lister" };
    const a = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "first", newSession: true }) }));
    await Bun.sleep(5);
    const b = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "second", newSession: true }) }));
    const r = await fetch(base + "/v1/sessions", { headers: h });
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(body.count).toBe(2);
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual([b.sessionId, a.sessionId]);
    expect(body.sessions[0].title).toBe("Auto: second");
    expect(b.title).toBe("Auto: second");
    expect(b.followUps).toEqual(["More on second?", "Which intake is next?"]);
    expect(body.sessions[0].mode).toBe("consultant");
    const limited = await j(await fetch(base + "/v1/sessions?limit=1", { headers: h }));
    expect(limited.sessions).toHaveLength(1);
    const other = await j(await fetch(base + "/v1/sessions", { headers: { ...headers, "x-user-id": "someone-else" } }));
    expect(other.count).toBe(0);
    const anon = await fetch(base + "/v1/sessions", { headers });
    expect(anon.status).toBe(400);
    expect((await j(anon)).error.code).toBe("no_identity");
  });

  test("session history includes citations for assistant turns", async () => {
    const h = { ...headers, "x-user-id": "historian" };
    const turn = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "Cost?", newSession: true }) }));
    const hist = await j(await fetch(`${base}/v1/sessions/${turn.sessionId}`, { headers: h }));
    expect(hist.messages[0].role).toBe("human");
    expect(hist.messages[0].sources).toEqual([]);
    expect(hist.messages[1].role).toBe("ai");
    expect(hist.messages[1].sources[0].url).toContain("experteducation.com");
    expect(hist.messages[1].sources[0].excerpt).toBeString();
    expect(hist.messages[1].refused).toBe(false);
    // The reasoning trace and turn time ride along, so a reopened thread renders like the live one.
    expect(hist.messages[1].reasoning).toEqual([]);
    expect(hist.messages[1].latencyMs).toBeNumber();
    expect(hist.messages[0].reasoning).toBeUndefined();
    expect(hist.messages[0].followUps).toBeUndefined();
    expect(hist.messages[0].intentDetail).toBeUndefined();
  });

  test("the automatic title steps aside for one the owner typed, even when it lands later", async () => {
    const h = { ...headers, "x-user-id": "quick-renamer" };
    const turn = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "Cost?", newSession: true }) }));
    expect((await j(await fetch(base + "/v1/sessions", { headers: h }))).sessions[0].title).toBe("Auto: Cost?");
    await fetch(`${base}/v1/sessions/${turn.sessionId}`, { method: "PATCH", headers: h, body: JSON.stringify({ title: "Nikhil — costs" }) });
    // Direct store call stands in for a slow model whose title arrives after the rename.
    expect(await store.setAutoTitle(turn.sessionId, "quick-renamer", "Auto: late")).toBe(false);
    expect((await j(await fetch(base + "/v1/sessions", { headers: h }))).sessions[0].title).toBe("Nikhil — costs");
  });

  test("renames and pins a session, without the automatic title taking it back", async () => {
    const h = { ...headers, "x-user-id": "renamer" };
    const turn = await j(await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "first message", newSession: true }) }));

    const patch = async (body: unknown, hh = h) =>
      fetch(`${base}/v1/sessions/${turn.sessionId}`, { method: "PATCH", headers: hh, body: JSON.stringify(body) });

    const renamed = await patch({ title: "  Nikhil — visa options  ", pinned: true });
    expect(renamed.status).toBe(200);
    expect((await j(renamed)).session).toMatchObject({ title: "Nikhil — visa options", pinned: true });

    const listed = await j(await fetch(base + "/v1/sessions", { headers: h }));
    expect(listed.sessions[0]).toMatchObject({ title: "Nikhil — visa options", pinned: true });

    // A later turn in the same session must not restore the first-message title.
    await fetch(base + "/v1/chat", { method: "POST", headers: h, body: JSON.stringify({ message: "and next?", sessionId: turn.sessionId }) });
    expect((await j(await fetch(base + "/v1/sessions", { headers: h }))).sessions[0].title).toBe("Nikhil — visa options");

    expect((await patch({ pinned: false })).status).toBe(200);
    expect((await j(await fetch(base + "/v1/sessions", { headers: h }))).sessions[0].pinned).toBe(false);

    // Someone else's session is absent, not forbidden, so ids stay unguessable.
    expect((await patch({ title: "mine now" }, { ...headers, "x-user-id": "intruder" })).status).toBe(404);
    expect((await patch({ title: "   " })).status).toBe(400);
    expect((await patch({ title: "x".repeat(121) })).status).toBe(400);
    expect((await patch({ pinned: "yes" })).status).toBe(400);
  });

  test("knowledge search returns ranked excerpts without a model call", async () => {
    const r = await fetch(base + "/v1/knowledge/search", { method: "POST", headers, body: JSON.stringify({ query: "tuition in australia", k: 5 }) });
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(body.count).toBe(1);
    expect(body.results[0].url).toContain("experteducation.com");
    expect(body.results[0].excerpt).toContain("Bachelor tuition");
    expect(body.results[0].score).toBeNumber();
    const short = await fetch(base + "/v1/knowledge/search", { method: "POST", headers, body: JSON.stringify({ query: "a" }) });
    expect(short.status).toBe(400);
    const badCountry = await fetch(base + "/v1/knowledge/search", { method: "POST", headers, body: JSON.stringify({ query: "fees", countries: ["mars"] }) });
    expect(badCountry.status).toBe(400);
    const noAuth = await fetch(base + "/v1/knowledge/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "fees" }) });
    expect(noAuth.status).toBe(401);
  });

  test("a destination picked in knowledge search is a strict filter: that country's pages only, not global ones", async () => {
    const search = (body: Record<string, unknown>) => fetch(base + "/v1/knowledge/search", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await search({ query: "scholarships", countries: ["canada"] })).status).toBe(200);
    expect(kb.queries.at(-1)).toMatchObject({ countries: ["canada"], includeGlobal: false });
    expect((await search({ query: "scholarships" })).status).toBe(200);
    expect(kb.queries.at(-1)?.countries).toBeUndefined();
  });

  test("api-key callers may act for a userId (trusted proxy)", async () => {
    const r = await j(await fetch(base + "/v1/chat", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", userId: "proxied-user", newSession: true }) }));
    const list = await j(await fetch(base + "/v1/sessions", { headers: { ...headers, "x-user-id": "proxied-user" } }));
    expect(list.sessions.map((s: { id: string }) => s.id)).toContain(r.sessionId);
  });
});

describe("streamed thoughts", () => {
  // The provider interleaves thought parts with answer parts inside one streamed chunk,
  // so the fake emits exactly that rather than a canned string.
  const thinkingModel = () =>
    new FakeStreamingChatModel({
      chunks: [
        new AIMessageChunk({ content: [{ type: "thinking", thinking: "Fees first, " }] }),
        new AIMessageChunk({ content: [{ type: "thinking", thinking: "then intakes." }, { type: "text", text: "Tuition is " }] }),
        new AIMessageChunk({ content: [{ type: "text", text: "AUD 20k–45k [1]." }] }),
      ],
    });

  /** Graph wired like production: a primary answer model plus the cheaper model it degrades to. */
  const service = (models: Partial<Pick<Parameters<typeof fakeGraph>[0], "answerModel" | "answerFallbackModel" | "answerDeepModel">> = {}) => {
    const env = testEnv();
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" }),
      answerModel: thinkingModel(),
      ...models,
    });
    return new ChatService({ env, graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }) });
  };

  const turn = async (
    extra: Partial<Parameters<ChatService["chat"]>[0]> = {},
    models: Partial<Pick<Parameters<typeof fakeGraph>[0], "answerModel" | "answerFallbackModel" | "answerDeepModel">> = {},
  ) => {
    const thoughts: string[] = [];
    const tokens: string[] = [];
    const result = await service(models).chat({
      message: "Cost?",
      ownerId: "anonymous",
      requestId: "r1",
      route: "/v1/chat/stream",
      onToken: (t) => tokens.push(t),
      onThinking: (c) => thoughts.push(c),
      ...extra,
    });
    return { thoughts, tokens, result };
  };

  test("thoughts stream separately from the answer and never reach it", async () => {
    const { thoughts, tokens, result } = await turn();
    expect(thoughts.join("")).toBe("Fees first, then intakes.");
    expect(tokens.join("")).toBe("Tuition is AUD 20k–45k [1].");
    expect(result.answer).toBe("Tuition is AUD 20k–45k [1].");
    expect(result.answer).not.toContain("Fees first");
  });

  test("onThinking alone is enough to stream", async () => {
    const thoughts: string[] = [];
    await service().chat({ message: "Cost?", ownerId: "anonymous", requestId: "r2", route: "/v1/chat/stream", onThinking: (c) => thoughts.push(c) });
    expect(thoughts.join("")).toContain("Fees first");
  });

  // The regression this guards: with the fallback attached as a `withFallbacks` wrapper the
  // chunks were re-emitted as plain strings and every thought was lost. The node streams the
  // primary itself now, so a graph wired exactly like production still delivers them.
  test("thoughts survive the model's fallback wiring, and the spare model stays idle", async () => {
    const spare = new StreamThenFailChatModel([], new Error("the fallback model must not run"));
    const { thoughts, tokens, result } = await turn({}, { answerFallbackModel: spare });
    expect(spare.streams).toBe(0);
    expect(thoughts.join("")).toBe("Fees first, then intakes.");
    // Exactly one copy of the answer: the node accumulates the same chunks ChatService sees,
    // and returns them as state rather than re-emitting them.
    expect(tokens.join("")).toBe("Tuition is AUD 20k–45k [1].");
    expect(result.answer).toBe("Tuition is AUD 20k–45k [1].");
  });

  test("the cheaper model takes over when the primary fails before any token", async () => {
    const primary = new StreamThenFailChatModel([], new Error("503 the model is overloaded"));
    const { thoughts, tokens, result } = await turn({}, { answerModel: primary, answerFallbackModel: thinkingModel() });
    expect(primary.streams).toBe(1);
    expect(thoughts.join("")).toBe("Fees first, then intakes.");
    expect(tokens.join("")).toBe("Tuition is AUD 20k–45k [1].");
    expect(result.answer).toBe("Tuition is AUD 20k–45k [1].");
  });

  // DeepSeek through OpenRouter: raw reasoning beside the content, not as content parts.
  const openRouterModel = (reasoning: string, text: string) =>
    new FakeStreamingChatModel({
      chunks: [
        new AIMessageChunk({ content: "", additional_kwargs: { reasoning_content: reasoning } }),
        new AIMessageChunk({ content: text }),
      ],
    });

  test("OpenRouter reasoning streams as thoughts and never reaches the answer", async () => {
    const { thoughts, tokens, result } = await turn({}, { answerModel: openRouterModel("Writing band 5.5 is the constraint.", "Australia is the easier fit [1].") });
    expect(thoughts.join("")).toBe("Writing band 5.5 is the constraint.");
    expect(tokens.join("")).toBe("Australia is the easier fit [1].");
    expect(result.answer).not.toContain("constraint");
  });

  test("DeepThink answers on the deep model; ordinary turns never touch it", async () => {
    const models = () => ({ answerModel: openRouterModel("quick", "Normal answer."), answerDeepModel: openRouterModel("slow and careful", "Deep answer.") });
    const deep = await turn({ deepThink: true }, models());
    expect(deep.result.answer).toBe("Deep answer.");
    expect(deep.thoughts.join("")).toBe("slow and careful");
    expect(deep.result.meta.deepThink).toBe(true);
    const normal = await turn({}, models());
    expect(normal.result.answer).toBe("Normal answer.");
    expect(normal.result.meta.deepThink).toBe(false);
  });

  test("the turn's thoughts are stored with the answer, in timeline order", async () => {
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" }),
      answerModel: openRouterModel("Fees first, then intakes.", "Tuition is AUD 20k–45k [1]."),
    });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const result = await svc.chat({ message: "Cost?", ownerId: "anonymous", requestId: "r9", route: "/v1/chat/stream", deepThink: true, onToken: () => {} });
    await new Promise((r) => setTimeout(r, 10)); // persistence runs after the response
    const ai = (await store.getMessages(result.sessionId, 10)).find((m) => m.role === "ai");
    expect(ai?.metadata?.thoughts).toEqual([{ at: 0, text: "Fees first, then intakes." }]);
    expect(ai?.metadata?.deepThink).toBe(true);
  });

  test("a turn stopped mid-answer is stored with the partial text the consultant saw", async () => {
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" }),
      answerModel: thinkingModel(),
    });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const controller = new AbortController();
    const seen: string[] = [];
    let error: unknown = null;
    try {
      await svc.chat({
        message: "Cost?",
        ownerId: "stopper",
        requestId: "stop-1",
        route: "/v1/chat/stream",
        signal: controller.signal,
        onToken: (t) => {
          seen.push(t);
          controller.abort(); // the consultant presses Stop after the first token
        },
      });
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    await Bun.sleep(10); // persistence is fire-and-forget
    const [session] = await store.listSessions("stopper", 1);
    expect(session).toBeDefined();
    const messages = await store.getMessages(session!.id, 10);
    expect(messages.map((m) => m.role)).toEqual(["human", "ai"]);
    expect(messages[1]!.content).toBe(seen.join("").trim());
    expect(messages[1]!.metadata).toMatchObject({ stopped: true, requestId: "stop-1", sources: [] });
    expect(session!.title).toBe("Cost?");
  });

  test("a failure after the first token keeps the partial answer instead of splicing the spare model onto it", async () => {
    const primary = new StreamThenFailChatModel(
      [new AIMessageChunk({ content: [{ type: "text", text: "Tuition is " }] })],
      new Error("stream closed unexpectedly"),
    );
    const spare = new StreamThenFailChatModel([], new Error("the fallback model must not run"));
    const { tokens, result } = await turn({}, { answerModel: primary, answerFallbackModel: spare });
    expect(spare.streams).toBe(0);
    expect(tokens.join("")).toBe(`Tuition is ${ANSWER_CUT_OFF_ERROR_NOTE}`);
    expect(result.answer).toBe(`Tuition is${ANSWER_CUT_OFF_ERROR_NOTE}`);
    expect(result.meta.generateError).toContain("stream closed");
  });
});
