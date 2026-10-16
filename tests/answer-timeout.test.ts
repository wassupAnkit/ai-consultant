import { describe, expect, test } from "bun:test";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda, type RunnableConfig } from "@langchain/core/runnables";
import { CLASSIFY_TIMEOUT_MS, timeoutBudgetWarning } from "../src/config/env";
import { SAFE_FALLBACK_ANSWER } from "../src/prompts/consultant";
import { fakeGraph, intentOf, testEnv } from "./helpers";

/** An answer model that replies after `ms`, or fails as soon as the node's deadline aborts it. */
const slowAnswer = (ms: number, text = "A late but complete answer.") =>
  RunnableLambda.from(
    (_m: BaseMessage[], config?: RunnableConfig) =>
      new Promise<AIMessage>((resolve, reject) => {
        if (config?.signal?.aborted) return reject(new Error("answer aborted: timed out"));
        const t = setTimeout(() => resolve(new AIMessage(text)), ms);
        config?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("answer aborted: timed out"));
        });
      }),
  );

describe("ANSWER_TIMEOUT_MS", () => {
  test("defaults to 45 s and is configurable", () => {
    expect(testEnv().ANSWER_TIMEOUT_MS).toBe(45_000);
    expect(testEnv({ ANSWER_TIMEOUT_MS: "70000" }).ANSWER_TIMEOUT_MS).toBe(70_000);
    expect(() => testEnv({ ANSWER_TIMEOUT_MS: "500" })).toThrow();
  });

  test("the answer node's deadline is ANSWER_TIMEOUT_MS", async () => {
    const intent = intentOf({ primary_intent: "general_inquiry", needs_research: false });
    const short = fakeGraph({ intent, answerModel: slowAnswer(300), env: { ...testEnv(), ANSWER_TIMEOUT_MS: 50 } });
    const cut = await short.graph.invoke({ input: "hi", history: [], sessionId: "s1", profile: null });
    expect(cut.answer).toBe(SAFE_FALLBACK_ANSWER);
    expect(String(cut.meta.generateError)).toMatch(/timed out|aborted/);

    const long = fakeGraph({ intent, answerModel: slowAnswer(300), env: { ...testEnv(), ANSWER_TIMEOUT_MS: 5_000 } });
    const done = await long.graph.invoke({ input: "hi", history: [], sessionId: "s1", profile: null });
    expect(done.answer).toBe("A late but complete answer.");
    expect(done.meta.generateError).toBeNull();
  });
});

// Counsellor audit (Oct 2026): DeepThink failed 6/6. The primary hit the answer deadline before
// its first token and the fallback started on the same, already-expired signal, "timing out"
// 2-3 ms later. The fallback now gets its own budget, still capped by the request.
describe("answer fallback budget", () => {
  const intent = intentOf({ primary_intent: "general_inquiry", needs_research: false });
  const input = { input: "hi", history: [], sessionId: "s1", profile: null };

  test("FALLBACK_TIMEOUT_MS defaults to 25 s and is configurable", () => {
    expect(testEnv().FALLBACK_TIMEOUT_MS).toBe(25_000);
    expect(testEnv({ FALLBACK_TIMEOUT_MS: "30000" }).FALLBACK_TIMEOUT_MS).toBe(30_000);
  });

  test("a primary that times out before any token leaves the fallback a fresh budget, and it answers", async () => {
    const { graph } = fakeGraph({
      intent,
      answerModel: slowAnswer(10_000),
      answerFallbackModel: slowAnswer(100, "The fallback's answer."),
      env: { ...testEnv(), ANSWER_TIMEOUT_MS: 50, FALLBACK_TIMEOUT_MS: 5_000 },
    });
    const out = await graph.invoke(input);
    expect(out.answer).toBe("The fallback's answer.");
    expect(out.meta.generateError).toBeNull();
  });

  test("the same holds on a DeepThink turn", async () => {
    const { graph } = fakeGraph({
      intent,
      answerDeepModel: slowAnswer(10_000),
      answerFallbackModel: slowAnswer(100, "The fallback's answer."),
      env: { ...testEnv(), DEEP_THINK_TIMEOUT_MS: 50, FALLBACK_TIMEOUT_MS: 5_000 },
    });
    const out = await graph.invoke({ ...input, deepThink: true });
    expect(out.answer).toBe("The fallback's answer.");
    expect(out.meta.deepThink).toBe(true);
  });

  test("the fallback is cut by its own budget", async () => {
    const { graph } = fakeGraph({
      intent,
      answerModel: slowAnswer(10_000),
      answerFallbackModel: slowAnswer(2_000),
      env: { ...testEnv(), ANSWER_TIMEOUT_MS: 50, FALLBACK_TIMEOUT_MS: 50 },
    });
    const out = await graph.invoke(input);
    expect(out.answer).toBe(SAFE_FALLBACK_ANSWER);
    expect(String(out.meta.generateError)).toContain("fallback:");
  });

  test("the fallback never outlives the request", async () => {
    const { graph } = fakeGraph({
      intent,
      answerModel: slowAnswer(10_000),
      answerFallbackModel: slowAnswer(2_000),
      env: { ...testEnv(), ANSWER_TIMEOUT_MS: 50, FALLBACK_TIMEOUT_MS: 10_000 },
    });
    const started = performance.now();
    await graph.invoke(input, { signal: AbortSignal.timeout(200) }).catch(() => null);
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

describe("DeepThink defaults", () => {
  test("medium effort and a 75 s answer budget inside a 120 s request", () => {
    const env = testEnv();
    expect(env.DEEP_THINK_EFFORT).toBe("medium");
    expect(env.DEEP_THINK_TIMEOUT_MS).toBe(75_000);
    expect(env.REQUEST_TIMEOUT_MS).toBe(120_000);
    expect(testEnv({ DEEP_THINK_EFFORT: "high" }).DEEP_THINK_EFFORT).toBe("high");
  });

  test("the DeepThink answer deadline is DEEP_THINK_TIMEOUT_MS, not ANSWER_TIMEOUT_MS", async () => {
    const intent = intentOf({ primary_intent: "general_inquiry", needs_research: false });
    const { graph } = fakeGraph({
      intent,
      answerDeepModel: slowAnswer(300, "A deep answer."),
      env: { ...testEnv(), ANSWER_TIMEOUT_MS: 50, DEEP_THINK_TIMEOUT_MS: 5_000 },
    });
    const out = await graph.invoke({ input: "hi", history: [], sessionId: "s1", profile: null, deepThink: true });
    expect(out.answer).toBe("A deep answer.");
  });
});

describe("timeoutBudgetWarning", () => {
  test("the defaults fit: classify + research + answer (and DeepThink) stay under REQUEST_TIMEOUT_MS", () => {
    const env = testEnv();
    expect(CLASSIFY_TIMEOUT_MS + env.RESEARCH_BUDGET_MS + env.ANSWER_TIMEOUT_MS).toBeLessThan(env.REQUEST_TIMEOUT_MS);
    expect(CLASSIFY_TIMEOUT_MS + env.RESEARCH_BUDGET_MS + env.DEEP_THINK_TIMEOUT_MS).toBeLessThan(env.REQUEST_TIMEOUT_MS);
    expect(timeoutBudgetWarning(env)).toBeNull();
  });

  test("the DeepThink path is checked too", () => {
    const warning = timeoutBudgetWarning(testEnv({ DEEP_THINK_TIMEOUT_MS: "90000" }));
    expect(warning).toContain("DEEP_THINK_TIMEOUT_MS");
    expect(warning).toContain("15000 + 25000 + 90000 = 130000 ms");
    expect(timeoutBudgetWarning(testEnv({ DEEP_THINK_TIMEOUT_MS: "90000", REQUEST_TIMEOUT_MS: "140000" }))).toBeNull();
  });

  test("a longer answer timeout without a longer request timeout is reported, with the numbers", () => {
    const warning = timeoutBudgetWarning(testEnv({ ANSWER_TIMEOUT_MS: "70000", REQUEST_TIMEOUT_MS: "100000" }));
    expect(warning).toContain("REQUEST_TIMEOUT_MS (100000 ms)");
    expect(warning).toContain("15000 + 25000 + 70000 = 110000 ms");
    expect(timeoutBudgetWarning(testEnv({ ANSWER_TIMEOUT_MS: "70000", REQUEST_TIMEOUT_MS: "120000" }))).toBeNull();
  });

  test("a longer research budget counts too", () => {
    expect(timeoutBudgetWarning(testEnv({ RESEARCH_BUDGET_MS: "60000" }))).toContain("RESEARCH_BUDGET_MS");
  });
});
