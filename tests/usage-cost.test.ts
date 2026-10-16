import { describe, expect, test } from "bun:test";
import { RunnableLambda } from "@langchain/core/runnables";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { InMemoryActivityStore } from "../src/activity/in-memory";
import { ActivityLog } from "../src/activity/log";
import { ChatService } from "../src/app/service";
import type { LlmCall } from "../src/db/mongo";
import { buildGraph } from "../src/graph";
import { ANSWER_TAG, RESEARCH_TAG } from "../src/graph/state";
import { OpenRouterChatModel } from "../src/llm/providers";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { estimateCostUsd, priceFor } from "../src/observability/pricing";
import { LlmUsageRecorder, summarizeLlm } from "../src/observability/usage";
import { PromptRegistry } from "../src/prompts/registry";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { intentOf, testEnv } from "./helpers";

const MODEL = "deepseek/deepseek-v4.1-flash";

/** OpenRouter's usage block as measured on DeepSeek V4.1 Flash via DeepInfra: cached and reasoning tokens are parts of prompt/completion. */
const USAGE = {
  prompt_tokens: 10_000,
  completion_tokens: 1_500,
  total_tokens: 11_500,
  cost: 0.000_9,
  is_byok: false,
  prompt_tokens_details: { cached_tokens: 8_000 },
  completion_tokens_details: { reasoning_tokens: 1_000 },
};

/**
 * A fake OpenRouter endpoint: JSON for `invoke`, SSE for streams. `usageOnDelta` sends the usage on
 * a chunk that also carries a choice (some providers do), which LangChain copies into the message's
 * response_metadata twice when it concatenates the stream.
 */
function openRouter(opts: { usage?: Record<string, unknown> | null; usageOnDelta?: boolean } = {}) {
  const usage = opts.usage === undefined ? USAGE : opts.usage;
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    if (!body.stream) {
      return Response.json({ id: "gen-1", model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], ...(usage ? { usage } : {}) });
    }
    const chunks: Record<string, unknown>[] = [
      { id: "gen-1", model: MODEL, choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] },
      { id: "gen-1", model: MODEL, choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] },
    ];
    if (usage) chunks.push({ id: "gen-1", model: MODEL, choices: opts.usageOnDelta ? [{ index: 0, delta: { content: "" }, finish_reason: null }] : [], usage });
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  const model = new OpenRouterChatModel({ model: MODEL, apiKey: "k", maxRetries: 0, configuration: { baseURL: "https://openrouter.invalid/api/v1", fetch: fetch as never } });
  return { model, bodies };
}

describe("LlmUsageRecorder: cache, reasoning and cost", () => {
  test("an invoked call records cached input, reasoning and OpenRouter's own cost", async () => {
    const { model } = openRouter();
    const rec = new LlmUsageRecorder();
    await model.invoke("q", { callbacks: [rec], tags: [RESEARCH_TAG] });
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toMatchObject({
      role: "research",
      model: MODEL,
      ok: true,
      inputTokens: 10_000,
      cachedInputTokens: 8_000,
      outputTokens: 1_500,
      reasoningTokens: 1_000,
      costUsd: 0.000_9,
      costSource: "provider",
    });
  });

  test("a streamed call records the same, from the usage chunk at the end of the stream", async () => {
    const { model, bodies } = openRouter();
    const rec = new LlmUsageRecorder();
    for await (const _ of await model.stream("q", { callbacks: [rec], tags: [ANSWER_TAG] })) {
      /* drain */
    }
    expect(bodies[0]!.stream_options).toEqual({ include_usage: true });
    expect(rec.calls[0]).toMatchObject({ role: "answer", ok: true, inputTokens: 10_000, cachedInputTokens: 8_000, reasoningTokens: 1_000, outputTokens: 1_500, costUsd: 0.000_9, costSource: "provider" });
  });

  test("an invoke inside streamEvents (the research rounds) is streamed and still recorded", async () => {
    const { model, bodies } = openRouter();
    const rec = new LlmUsageRecorder();
    for await (const _ of model.streamEvents("q", { version: "v2", callbacks: [rec], tags: [RESEARCH_TAG] })) {
      /* drain */
    }
    expect(bodies[0]!.stream).toBe(true);
    expect(rec.calls[0]).toMatchObject({ cachedInputTokens: 8_000, reasoningTokens: 1_000, costUsd: 0.000_9, costSource: "provider" });
  });

  test("usage on a delta chunk is not double-counted: LangChain sums the duplicated raw usage, the cost is scaled back", async () => {
    const { model } = openRouter({ usageOnDelta: true });
    const rec = new LlmUsageRecorder();
    for await (const _ of await model.stream("q", { callbacks: [rec], tags: [ANSWER_TAG] })) {
      /* drain */
    }
    expect(rec.calls[0]!.inputTokens).toBe(10_000);
    expect(rec.calls[0]!.costUsd).toBeCloseTo(0.000_9, 12);
  });

  test("without a provider cost the cost is estimated from the price table, cached input at the cache-read price", async () => {
    const { cost: _cost, ...noCost } = USAGE;
    const { model } = openRouter({ usage: noCost });
    const rec = new LlmUsageRecorder();
    await model.invoke("q", { callbacks: [rec], tags: [ANSWER_TAG] });
    // 2,000 uncached × $0.14/M + 8,000 cached × $0.0042/M + 1,500 output (reasoning included) × $0.42/M
    const expected = (2_000 * 0.14 + 8_000 * 0.0042 + 1_500 * 0.42) / 1e6;
    expect(rec.calls[0]!.costSource).toBe("estimate");
    expect(rec.calls[0]!.costUsd).toBeCloseTo(expected, 12);
  });

  test("no usage at all leaves the new fields absent", async () => {
    const { model } = openRouter({ usage: null });
    const rec = new LlmUsageRecorder();
    await model.invoke("q", { callbacks: [rec] });
    expect(rec.calls[0]!.ok).toBe(true);
    expect(rec.calls[0]!.cachedInputTokens).toBeUndefined();
    expect(rec.calls[0]!.reasoningTokens).toBeUndefined();
    expect(rec.calls[0]!.costUsd).toBeUndefined();
  });
});

describe("pricing", () => {
  test("DeepSeek V4.1 Flash on DeepInfra; unknown models have no price", () => {
    expect(priceFor(MODEL)).toEqual({ inputPerM: 0.14, cacheReadPerM: 0.0042, outputPerM: 0.42 });
    expect(priceFor(`openrouter:${MODEL}`)).toEqual(priceFor(MODEL));
    expect(priceFor("gemini-3.6-flash")).toBeNull();
    expect(estimateCostUsd("gemini-3.6-flash", { inputTokens: 100, outputTokens: 10 })).toBeNull();
    expect(estimateCostUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.14, 10);
    expect(estimateCostUsd(MODEL, { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.0042 + 0.42, 10);
    expect(estimateCostUsd(MODEL, {})).toBeNull();
  });

  test("GLM 4.7 Flash on Bedrock (Sydney on-demand), with or without the spec prefix", () => {
    expect(priceFor("zai.glm-4.7-flash")).toEqual({ inputPerM: 0.07, cacheReadPerM: 0.07, outputPerM: 0.41 });
    expect(priceFor("bedrock:zai.glm-4.7-flash")).toEqual(priceFor("zai.glm-4.7-flash"));
    expect(estimateCostUsd("zai.glm-4.7-flash", { inputTokens: 23_000, outputTokens: 630 })).toBeCloseTo(0.00161 + 0.0002583, 10);
  });
});

describe("summarizeLlm totals", () => {
  const calls: LlmCall[] = [
    { runId: "1", role: "research", model: MODEL, provider: "openai", ok: true, ms: 900, inputTokens: 5_000, cachedInputTokens: 4_000, outputTokens: 300, reasoningTokens: 200, totalTokens: 5_300, costUsd: 0.000_2, costSource: "provider" },
    { runId: "2", role: "answer", model: MODEL, provider: "openai", ok: true, ms: 2_000, inputTokens: 9_000, cachedInputTokens: 6_000, outputTokens: 800, reasoningTokens: 500, totalTokens: 9_800, costUsd: 0.000_5, costSource: "estimate" },
  ];

  test("sums cached, reasoning and cost per turn, adding the Jev classifier's cost", () => {
    const s = summarizeLlm(calls, { jevCostUsd: 0.000_05 });
    expect(s.inputTokens).toBe(14_000);
    expect(s.cachedInputTokens).toBe(10_000);
    expect(s.reasoningTokens).toBe(700);
    expect(s.jevCostUsd).toBe(0.000_05);
    expect(s.costUsd).toBeCloseTo(0.000_75, 12);
    expect(s.uncostedCalls).toBe(0);
  });

  test("a recorded turn carries the Jev classifier's cost in its llm block", async () => {
    const env = testEnv();
    const graph = buildGraph({
      env,
      classifier: RunnableLambda.from(async () => ({ ...intentOf({ primary_intent: "greeting", user_question: "hi", task: "general", needs_research: false }), extras: { classifier: "jev", cost: 0.000_02 } })),
      answerModel: new FakeListChatModel({ responses: ["Hello!"] }),
      knowledge: new NullKnowledgeStore([]),
      prompts: new PromptRegistry(null, { label: "production", cacheTtlSeconds: 0 }),
    });
    const store = new InMemoryActivityStore();
    const activity = new ActivityLog(store, createLogger({ test: true }), { flushMs: 10 });
    const service = new ChatService({ env, graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }), activity });
    await service.chat({ message: "hi", ownerId: "u1@heubert.com", requestId: "req-jev-cost", route: "/v1/chat" });
    await activity.flush();
    const llm = store.turns.find((t) => t.requestId === "req-jev-cost")!.llm;
    expect(llm.jevCostUsd).toBe(0.000_02);
    expect(llm.costUsd).toBe(0.000_02); // the fake answer model reports no usage, so it is uncosted
    expect(llm.uncostedCalls).toBe(1);
    await activity.close();
  });

  test("calls without a cost are counted, not guessed; no costs at all leaves the total null", () => {
    const s = summarizeLlm([...calls, { runId: "3", role: "answer", model: "gemini-3.5-flash-lite", provider: null, ok: true, ms: 10, inputTokens: 10, outputTokens: 5, totalTokens: 15 }]);
    expect(s.costUsd).toBeCloseTo(0.000_7, 12);
    expect(s.uncostedCalls).toBe(1);
    expect(s.jevCostUsd).toBeNull();
    const none = summarizeLlm([{ runId: "4", role: "answer", model: "gemini-3.6-flash", provider: null, ok: true, ms: 10, inputTokens: 10, outputTokens: 5, totalTokens: 15 }]);
    expect(none.costUsd).toBeNull();
    expect(none.cachedInputTokens).toBe(0);
    expect(summarizeLlm([]).costUsd).toBeNull();
  });
});
