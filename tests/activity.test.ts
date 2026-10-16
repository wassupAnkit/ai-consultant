import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RunnableLambda } from "@langchain/core/runnables";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { buildDpoPairs, DEFAULT_FILTERS, toGeminiRecord, toSftRecord, turnPasses } from "../src/activity/export";
import { capJson, eventTypeFor, normaliseRoute } from "../src/activity/events";
import { hashUser, sha256 } from "../src/activity/identity";
import { InMemoryActivityStore } from "../src/activity/in-memory";
import { ActivityLog, type ChatTurnInput } from "../src/activity/log";
import type { ActivityStore } from "../src/activity/store";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import type { ActivityEventDoc, ChatTurnDoc } from "../src/db/mongo";
import { buildGraph } from "../src/graph";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { LlmUsageRecorder, summarizeLlm } from "../src/observability/usage";
import { PromptRegistry } from "../src/prompts/registry";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const logger = createLogger({ test: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function turnInput(over: Partial<ChatTurnInput> = {}): ChatTurnInput {
  return {
    requestId: "req-" + crypto.randomUUID(),
    traceId: null,
    sessionId: "11111111-1111-4111-8111-111111111111",
    turnIndex: 0,
    ownerId: "u1@example.com",
    auth: "api_key",
    route: "/v1/chat",
    streamed: false,
    mode: "consultant",
    clientMetadata: null,
    profile: null,
    history: [],
    userMessage: "How much is tuition in Australia?",
    inputTruncated: false,
    intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"] }),
    intentFallback: false,
    chunks: [],
    contextChunkCount: 0,
    research: null,
    sources: [],
    answer: "Tuition is AUD 20k-45k [1].",
    refused: false,
    disclaimer: null,
    answerIsFallback: false,
    outcome: "ok",
    error: null,
    stream: null,
    llm: summarizeLlm([]),
    prompt: {
      systemPromptText: "You are Edge.",
      systemPromptHash: sha256("You are Edge."),
      systemPromptChars: 13,
      system: { name: "edge-system", source: "local", version: null, templateHash: "h" },
      playbook: { name: null, source: null, version: null, templateHash: null },
      classifier: { name: "edge-classifier", source: "local", version: null, templateHash: "c" },
    },
    timings: { classifyMs: 1, retrieveMs: 2, generateMs: 3, totalMs: 6 },
    meta: {},
    ...over,
  };
}

describe("identity", () => {
  test("hashUser is stable, 64 hex chars, and keyed by the secret", () => {
    const a = hashUser("testuser@heubert.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUser("testuser@heubert.com")).toBe(a);
    expect(hashUser("testuser@heubert.com", "secret-0123456789abcdef")).not.toBe(a);
    expect(hashUser("testuser@heubert.com", "secret-0123456789abcdef")).toBe(hashUser("testuser@heubert.com", "secret-0123456789abcdef"));
    expect(a).toBe(sha256("testuser@heubert.com"));
  });
});

describe("event taxonomy", () => {
  test("normaliseRoute replaces the id segment", () => {
    expect(normaliseRoute("/v1/sessions/abc-123", "abc-123")).toBe("/v1/sessions/:id");
    expect(normaliseRoute("/v1/chat")).toBe("/v1/chat");
  });

  test("eventTypeFor maps status and route", () => {
    const cases: [string, string, number, string][] = [
      ["POST", "/v1/chat", 200, "chat.request"],
      ["POST", "/chat", 200, "chat.request"],
      ["POST", "/v1/chat/stream", 200, "chat.stream_request"],
      ["POST", "/auth/google", 200, "auth.login"],
      ["POST", "/auth/google", 401, "auth.login_rejected"],
      ["GET", "/auth/me", 200, "auth.me"],
      ["POST", "/v1/chat", 401, "auth.rejected"],
      ["GET", "/v1/profile", 403, "auth.rejected"],
      ["GET", "/v1/profile", 200, "profile.read"],
      ["PATCH", "/v1/profile", 200, "profile.update"],
      ["GET", "/v1/sessions", 200, "session.list"],
      ["GET", "/v1/sessions/:id", 200, "session.read"],
      ["PATCH", "/v1/sessions/:id", 200, "session.update"],
      ["DELETE", "/v1/sessions/:id", 200, "session.delete"],
      ["POST", "/v1/feedback", 202, "feedback.submitted"],
      ["POST", "/v1/events", 202, "client.events_ingested"],
      ["POST", "/v1/chat", 429, "http.rate_limited"],
      ["POST", "/v1/chat", 500, "http.error"],
      ["POST", "/v1/chat", 400, "http.request"],
      ["GET", "/v1/sessions/:id", 404, "http.request"],
    ];
    for (const [m, r, s, want] of cases) expect(String(eventTypeFor(m, r, s))).toBe(want);
  });

  test("capJson bounds payload size", () => {
    expect(capJson({ a: 1 }, 100)).toEqual({ a: 1 });
    const big = capJson({ s: "x".repeat(10_000) }, 100);
    expect(big._truncated).toBe(true);
    expect(String(big.preview).length).toBe(100);
    expect(capJson(undefined, 10)).toEqual({});
  });
});

describe("ActivityLog", () => {
  test("buffers and flushes on batch size, timer and close", async () => {
    const store = new InMemoryActivityStore();
    const log = new ActivityLog(store, logger, { flushMs: 20, turnBatch: 2, eventBatch: 100 });
    log.turn(turnInput());
    expect(store.turns).toHaveLength(0);
    log.turn(turnInput());
    await wait(5);
    expect(store.turns).toHaveLength(2); // batch size reached
    log.event({ type: "http.request" });
    await wait(60);
    expect(store.events).toHaveLength(1); // timer
    log.event({ type: "auth.me", ownerId: "x@y.z" });
    await log.close();
    expect(store.events).toHaveLength(2);
    expect(store.events[1]!.userHash).toBe(sha256("x@y.z"));
    expect(store.events[1]!.at).toBeInstanceOf(Date);
    expect(log.stats().flushedTurns).toBe(2);
    expect(log.stats().flushedEvents).toBe(2);
  });

  test("stamps userHash and release on turns", async () => {
    const store = new InMemoryActivityStore();
    const log = new ActivityLog(store, logger, { flushMs: 10_000, hashSecret: "0123456789abcdefXYZ", release: "abc123" });
    log.turn(turnInput({ ownerId: "who@heubert.com" }));
    await log.flush();
    expect(store.turns[0]!.userHash).toBe(hashUser("who@heubert.com", "0123456789abcdefXYZ"));
    expect(store.turns[0]!.release).toBe("abc123");
    expect(store.turns[0]!.feedback).toEqual([]);
    expect(store.turns[0]!.feedbackScore).toBeNull();
    await log.close();
  });

  test("drops the oldest entries beyond the queue bound and counts them", async () => {
    const store = new InMemoryActivityStore();
    const log = new ActivityLog(store, logger, { flushMs: 10_000, eventBatch: 1_000, maxQueuedEvents: 3 });
    for (let i = 0; i < 5; i++) log.event({ type: "http.request", details: { i } });
    expect(log.stats().queuedEvents).toBe(3);
    expect(log.stats().dropped).toBe(2);
    await log.close();
    expect(store.events.map((e) => e.details.i)).toEqual([2, 3, 4]);
  });

  test("a failing store never throws; the batch is retried once then dropped", async () => {
    let fail = true;
    let attempts = 0;
    const store: ActivityStore = {
      async insertTurns() {
        attempts++;
        if (fail) throw new Error("mongo down");
      },
      async insertEvents() {},
      async attachFeedback() {
        return 0;
      },
    };
    const log = new ActivityLog(store, logger, { flushMs: 10_000 });
    log.turn(turnInput());
    await log.flush();
    expect(log.stats().failedBatches).toBe(1);
    expect(log.stats().queuedTurns).toBe(1); // re-queued for one retry
    fail = false;
    await log.flush();
    expect(log.stats().flushedTurns).toBe(1);
    expect(attempts).toBe(2);

    // Second failure of the same doc drops it.
    fail = true;
    log.turn(turnInput());
    await log.flush();
    await log.flush();
    expect(log.stats().failedBatches).toBe(3);
    expect(log.stats().queuedTurns).toBe(0);
    expect(log.stats().dropped).toBe(1);
    await log.close();
  });

  test("feedback lands on a buffered turn, or in the store after it was written", async () => {
    const store = new InMemoryActivityStore();
    const log = new ActivityLog(store, logger, { flushMs: 10_000 });
    const t = turnInput();
    log.turn(t);
    log.feedback(t.requestId, { score: 1, comment: "great", traceId: null, at: new Date() });
    await log.flush();
    expect(store.turns[0]!.feedbackScore).toBe(1);
    expect(store.turns[0]!.feedback[0]!.comment).toBe("great");

    log.feedback(t.requestId, { score: -1, comment: null, traceId: null, at: new Date() });
    await wait(5);
    expect(store.turns[0]!.feedbackScore).toBe(-1);
    expect(store.turns[0]!.feedback).toHaveLength(2);
    await log.close();
  });
});

describe("LlmUsageRecorder", () => {
  test("records the tagged answer call for invoke and streamEvents", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "greeting", user_question: "hi", task: "general", needs_research: false }), answer: "Hello!" });
    const rec = new LlmUsageRecorder();
    const state = await graph.invoke({ input: "hi", history: [], sessionId: "s", profile: null }, { callbacks: [rec] });
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.role).toBe("answer");
    expect(rec.calls[0]!.ok).toBe(true);
    expect(typeof rec.calls[0]!.ms).toBe("number");
    expect(state.meta.systemPromptText).toContain("Edge");
    expect(state.meta.systemPromptHash).toBe(sha256(String(state.meta.systemPromptText)));
    expect(state.meta.systemTemplateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.meta.classifierTemplateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.meta.contextChunkCount).toBe(0);

    const rec2 = new LlmUsageRecorder();
    for await (const _ of graph.streamEvents({ input: "hi", history: [], sessionId: "s", profile: null }, { version: "v2", runName: "chat", callbacks: [rec2] })) {
      /* drain */
    }
    expect(rec2.calls).toHaveLength(1);
    expect(rec2.calls[0]!.ok).toBe(true);
    const summary = summarizeLlm(rec2.calls);
    expect(summary.usedFallback).toBe(false);
    expect(summary.calls).toHaveLength(1);
  });

  test("summarizeLlm detects fallback use", () => {
    const s = summarizeLlm([
      { runId: "1", role: "answer", model: "gemini-3.6-flash", provider: null, ok: false, ms: 10, error: "503" },
      { runId: "2", role: "answer", model: "gemini-3.5-flash-lite", provider: null, ok: true, ms: 20, inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { runId: "3", role: "classifier", model: "gemini-3.5-flash-lite", provider: null, ok: true, ms: 5, inputTokens: 30, outputTokens: 10, totalTokens: 40 },
    ]);
    expect(s.usedFallback).toBe(true);
    expect(s.answerModel).toBe("gemini-3.5-flash-lite");
    expect(s.classifierModel).toBe("gemini-3.5-flash-lite");
    expect(s.totalTokens).toBe(190);
  });
});

describe("HTTP pipeline writes the activity log", () => {
  const API_KEY = "test-api-key-0123456789abcdef0123456789";
  const headers = { "content-type": "application/json", "x-api-key": API_KEY, "x-user-id": "u1@heubert.com" };
  const store = new InMemoryActivityStore();
  const activity = new ActivityLog(store, logger, { flushMs: 10 });
  let base = "";
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    const env = testEnv({ API_KEY });
    const graph = buildGraph({
      env,
      classifier: RunnableLambda.from(async () => intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" })),
      // Slow token stream so a client can abort mid-answer.
      answerModel: new FakeListChatModel({ responses: ["Tuition is AUD 20k to 45k a year in Australia [1]."], sleep: 15 }),
      knowledge: new NullKnowledgeStore([sampleChunk(1), sampleChunk(2)]),
      prompts: new PromptRegistry(null, { label: "production", cacheTtlSeconds: 0 }),
    });
    const chatStore = new InMemoryChatStore();
    const service = new ChatService({ env, graph, store: chatStore, logger, activity });
    app = createApp(
      { env, service, store: chatStore, knowledge: new NullKnowledgeStore([]), collections: null, logger, readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now(), activity },
      { port: 0, hostname: "127.0.0.1" },
    );
    base = `http://127.0.0.1:${app.server.port}`;
  });

  afterAll(async () => {
    await app.shutdown(1_000);
    await activity.close();
  });

  const flushed = async () => {
    await activity.flush();
    await wait(5);
    await activity.flush();
  };
  const turnFor = (requestId: string): ChatTurnDoc | undefined => store.turns.find((t) => t.requestId === requestId);
  const eventsOf = (type: string): ActivityEventDoc[] => store.events.filter((e) => e.type === type);

  test("a chat turn is recorded with prompt, chunks, intent, llm and identity", async () => {
    const r = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: { ...headers, "x-request-id": "req-turn-000001", "user-agent": "bun-test" },
      body: JSON.stringify({ message: "How much does it cost to study in Australia?", metadata: { tz: "Australia/Sydney" } }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { sessionId: string };
    await flushed();

    const turn = turnFor("req-turn-000001");
    expect(turn).toBeDefined();
    expect(turn!.ownerId).toBe("u1@heubert.com");
    expect(turn!.userHash).toBe(sha256("u1@heubert.com"));
    expect(turn!.auth).toBe("api_key");
    expect(turn!.sessionId).toBe(body.sessionId);
    expect(turn!.turnIndex).toBe(0);
    expect(turn!.outcome).toBe("ok");
    expect(turn!.streamed).toBe(false);
    expect(turn!.userMessage).toContain("Australia");
    expect(turn!.answer).toContain("AUD 20k");
    expect(turn!.intent?.primary_intent).toBe("financial_viability");
    expect(turn!.chunks).toHaveLength(2);
    expect(turn!.chunks[0]!.content).toContain("Bachelor tuition");
    expect(turn!.contextChunkCount).toBe(2);
    expect(turn!.sources.map((s) => s.n)).toEqual([1]);
    expect(turn!.prompt.systemPromptText).toContain("<excerpt");
    expect(turn!.prompt.systemPromptHash).toBe(sha256(turn!.prompt.systemPromptText!));
    expect(turn!.prompt.system.name).toBe("edge-consultant-system");
    expect(turn!.prompt.playbook.name).toBe("edge-consultant-playbook-financial-viability");
    expect(turn!.prompt.classifier.source).toBe("local");
    expect(turn!.llm.calls).toHaveLength(1);
    expect(turn!.llm.calls[0]!.role).toBe("answer");
    expect(turn!.clientMetadata).toEqual({ tz: "Australia/Sydney" });
    expect(turn!.history).toEqual([]);
    expect(turn!.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(turn!.meta.systemPromptText).toBeUndefined();
    // The browser's Australian timezone places the counsellor onshore: no market, an onshore note.
    expect(turn!.meta.route).toEqual({
      countries: ["australia"],
      countrySource: ["classifier"],
      topic: "financial_viability",
      stage: "unspecified",
      mode: "single",
      origin: null,
      originSource: null,
      onshore: "australia",
      counsellorRegion: { market: null, onshore: "australia", branch: null, source: "timezone" },
    });
    expect(turn!.createdAt).toBeInstanceOf(Date);

    const ev = eventsOf("chat.request");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.requestId).toBe("req-turn-000001");
    expect(ev[0]!.sessionId).toBe(body.sessionId);
    expect(ev[0]!.status).toBe(200);
    expect(ev[0]!.userAgent).toBe("bun-test");
    expect(ev[0]!.details.intent).toBe("financial_viability");

    // Follow-up in the same session carries the prior two messages as history.
    const r2 = await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...headers, "x-request-id": "req-turn-000002" }, body: JSON.stringify({ message: "And living costs?", sessionId: body.sessionId }) });
    expect(r2.status).toBe(200);
    await flushed();
    const turn2 = turnFor("req-turn-000002")!;
    expect(turn2.turnIndex).toBe(1);
    expect(turn2.history.map((h) => h.role)).toEqual(["user", "assistant"]);
  });

  test("feedback attaches to the turn and is logged as an event", async () => {
    const r = await fetch(`${base}/v1/feedback`, { method: "POST", headers, body: JSON.stringify({ requestId: "req-turn-000001", score: 1, comment: "helpful" }) });
    expect(r.status).toBe(202);
    await flushed();
    const turn = turnFor("req-turn-000001")!;
    expect(turn.feedbackScore).toBe(1);
    expect(turn.feedback[0]!.comment).toBe("helpful");
    const ev = eventsOf("feedback.submitted");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details.targetRequestId).toBe("req-turn-000001");
  });

  test("auth failures and probes", async () => {
    const r = await fetch(`${base}/v1/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
    expect(r.status).toBe(401);
    for (const p of ["/healthz", "/readyz", "/health"]) await fetch(base + p);
    await flushed();
    const rejected = eventsOf("auth.rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.errorCode).toBe("unauthorized");
    expect(rejected[0]!.ownerId).toBe("anonymous");
    expect(store.events.some((e) => e.path?.startsWith("/health") || e.path === "/readyz")).toBe(false);
  });

  test("validation errors are http.request events with the error code", async () => {
    const r = await fetch(`${base}/v1/chat`, { method: "POST", headers, body: JSON.stringify({}) });
    expect(r.status).toBe(400);
    await flushed();
    const ev = eventsOf("http.request").filter((e) => e.status === 400);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.errorCode).toBe("validation_error");
  });

  test("client events are accepted and stored as ui.* with clamped timestamps", async () => {
    const r = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        events: [
          { type: "page_view", at: "2020-01-01T00:00:00Z", props: { path: "/user/dashboard" } },
          { type: "copy_answer", requestId: "req-turn-000001", sessionId: "11111111-1111-4111-8111-111111111111", props: { chars: 120 } },
        ],
      }),
    });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ accepted: 2 });
    await flushed();
    const pv = eventsOf("ui.page_view");
    expect(pv).toHaveLength(1);
    expect(pv[0]!.source).toBe("client");
    expect(pv[0]!.ownerId).toBe("u1@heubert.com");
    expect(pv[0]!.details.path).toBe("/user/dashboard");
    // 2020 is outside the 7-day window → clamped to roughly now.
    expect(Date.now() - pv[0]!.at.getTime()).toBeLessThan(8 * 86_400_000);
    const copy = eventsOf("ui.copy_answer")[0]!;
    expect(copy.requestId).toBe("req-turn-000001");
    expect(eventsOf("client.events_ingested")[0]!.details.accepted).toBe(2);

    const bad = await fetch(`${base}/v1/events`, { method: "POST", headers, body: JSON.stringify({ events: [{ type: "Bad Type!" }] }) });
    expect(bad.status).toBe(400);
  });

  test("an aborted stream is recorded with its partial answer", async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/v1/chat/stream?format=ndjson`, {
      method: "POST",
      headers: { ...headers, "x-request-id": "req-stream-abort-1" },
      body: JSON.stringify({ message: "Tell me about costs", newSession: true }),
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"event":"token"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    ac.abort();

    let turn: ChatTurnDoc | undefined;
    for (let i = 0; i < 100 && !turn; i++) {
      await flushed();
      turn = turnFor("req-stream-abort-1");
      if (!turn) await wait(20);
    }
    expect(turn).toBeDefined();
    expect(turn!.streamed).toBe(true);
    expect(turn!.outcome).toBe("aborted");
    expect(turn!.stream?.clientAborted).toBe(true);
    expect(turn!.stream?.tokens).toBeGreaterThan(0);
    expect(turn!.stream?.partialAnswer).toBeTruthy();
    expect(turn!.stream?.partialAnswer!.length).toBeLessThan("Tuition is AUD 20k to 45k a year in Australia [1].".length);
    expect(eventsOf("chat.stream_request")).toHaveLength(1);
  });
});

describe("dataset export helpers", () => {
  const base = (over: Partial<ChatTurnDoc> = {}): ChatTurnDoc => ({
    ...turnInput(),
    research: null,
    userHash: "h",
    release: null,
    feedback: [],
    feedbackScore: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  });

  test("turnPasses applies the default exclusions", () => {
    expect(turnPasses(base(), DEFAULT_FILTERS).ok).toBe(true);
    expect(turnPasses(base({ refused: true, outcome: "refused" }), DEFAULT_FILTERS)).toEqual({ ok: false, reason: "refused" });
    expect(turnPasses(base({ outcome: "aborted" }), DEFAULT_FILTERS)).toEqual({ ok: false, reason: "aborted" });
    expect(turnPasses(base({ answerIsFallback: true }), DEFAULT_FILTERS)).toEqual({ ok: false, reason: "fallback_answer" });
    expect(turnPasses(base({ intent: intentOf({ contextual_flags: ["prompt_injection_attempt"] }) }), DEFAULT_FILTERS)).toEqual({ ok: false, reason: "injection" });
    expect(turnPasses(base(), { ...DEFAULT_FILTERS, feedback: "positive" })).toEqual({ ok: false, reason: "feedback_not_positive" });
    expect(turnPasses(base({ feedbackScore: 1 }), { ...DEFAULT_FILTERS, feedback: "positive" }).ok).toBe(true);
    expect(turnPasses(base({ feedbackScore: -1 }), { ...DEFAULT_FILTERS, feedback: "nonnegative" })).toEqual({ ok: false, reason: "feedback_negative" });
    expect(turnPasses(base(), { ...DEFAULT_FILTERS, intents: ["greeting"] })).toEqual({ ok: false, reason: "intent" });
    expect(turnPasses(base(), { ...DEFAULT_FILTERS, since: new Date("2026-09-02T00:00:00Z") })).toEqual({ ok: false, reason: "before_since" });
  });

  test("SFT rows carry system, history, user, assistant and only hashed identity", () => {
    const t = base({
      history: [
        { role: "user", content: "hello from testuser@heubert.com" },
        { role: "assistant", content: "Hi!" },
      ],
      userMessage: "call me on +61 412 345 678",
    });
    const row = toSftRecord(t, { system: true, redact: true, history: 12 });
    expect(row.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
    expect(row.messages[0]!.content).toBe("You are Edge.");
    expect(row.messages[1]!.content).toContain("[email]");
    expect(row.messages[3]!.content).toContain("[phone]");
    expect(row.messages[4]!.content).toBe(t.answer);
    expect(JSON.stringify(row)).not.toContain("u1@example.com");
    expect(row.metadata.userHash).toBe("h");
    expect(row.metadata.intent).toBe("financial_viability");

    const noSys = toSftRecord(t, { system: false, redact: false, history: 0 });
    expect(noSys.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(noSys.messages[0]!.content).toContain("+61 412");
  });

  test("Gemini rows use systemInstruction + user/model contents", () => {
    const g = toGeminiRecord(base({ history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }), { system: true, redact: false, history: 12 });
    expect(g.systemInstruction?.parts[0]!.text).toBe("You are Edge.");
    expect(g.contents.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    expect(g.contents.at(-1)!.parts[0]!.text).toContain("AUD 20k");
  });

  test("DPO pairs come from regenerated, differently rated answers to the same prompt", () => {
    const good = base({ requestId: "good", answer: "Good answer", feedbackScore: 1 });
    const bad = base({ requestId: "bad", answer: "Bad answer", feedbackScore: -1 });
    const unrelated = base({ requestId: "other", userMessage: "different question", feedbackScore: -1 });
    const pairs = buildDpoPairs([good, bad, unrelated], { system: false, redact: false, history: 12 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.chosen[0]!.content).toBe("Good answer");
    expect(pairs[0]!.rejected[0]!.content).toBe("Bad answer");
    expect(pairs[0]!.prompt.at(-1)!.role).toBe("user");
    expect(pairs[0]!.metadata.rejectedRequestId).toBe("bad");
    expect(buildDpoPairs([good], { system: false, redact: false, history: 12 })).toHaveLength(0);
  });
});
