import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { WebSearcher } from "../src/tools";
import { ScriptedToolModel, SlowToolModel, toolCall } from "./fakes";
import { fakeGraph, intentOf, testEnv } from "./helpers";

/**
 * Latency controls on the research loop (backlog N9, Oct 2026). Each has an env switch that
 * restores the earlier behaviour; these tests pin both sides.
 */

const lookup = intentOf({ primary_intent: "program_selection", destinations: ["australia"], user_question: "Monash Master of IT fees?", task: "lookup", needs_research: true });
const run = (graph: ReturnType<typeof fakeGraph>["graph"], input = "What are the full Monash Master of IT fees and intakes, with every requirement listed in detail?") =>
  graph.invoke({ input, history: [], sessionId: "s1", profile: null });

describe("research round timeout and minimum round budget", () => {
  test("a hung research call ends at the round timeout, not the budget, and the turn answers from round 0", async () => {
    const model = new SlowToolModel([Infinity]);
    const { graph } = fakeGraph({ intent: lookup, answer: "From the KB [1].", researchModel: model, research: { budgetMs: 10_000, roundTimeoutMs: 300, minRoundMs: 100 } });
    const started = performance.now();
    const state = await run(graph);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(model.seen).toHaveLength(1);
    expect(state.meta.researchStop).toBe("round_timeout");
    expect(state.researchTrace?.budgetExceeded).toBe(false);
    expect(state.researchTrace?.rounds).toBe(0);
    expect(state.evidence).toHaveLength(2);
    expect(state.answer).toContain("From the KB");
  });

  test("without a round timeout (0) a hung call holds research until the budget runs out, as before", async () => {
    const model = new SlowToolModel([Infinity]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { budgetMs: 700, roundTimeoutMs: 0, minRoundMs: 100 } });
    const started = performance.now();
    const state = await run(graph);
    expect(performance.now() - started).toBeGreaterThanOrEqual(550);
    expect(state.meta.researchStop).toBe("budget");
    expect(state.researchTrace?.budgetExceeded).toBe(true);
  });

  test("a round is not started with less than the minimum round budget left", async () => {
    const model = new SlowToolModel([400, 400], [toolCall("search_knowledge_base", { query: "q1" }), toolCall("search_knowledge_base", { query: "q2" })]);
    // Round 1 takes ~400 ms of a 1,000 ms budget; ~600 ms is left, under the 800 ms a round needs.
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { budgetMs: 1_000, minRoundMs: 800, roundTimeoutMs: 0 } });
    const state = await run(graph);
    expect(model.seen).toHaveLength(1);
    expect(state.researchTrace?.rounds).toBe(1);
    expect(state.researchTrace?.budgetExceeded).toBe(true);
    expect(state.meta.researchStop).toBe("budget");
  });

  test("with the old 1.5 s floor the same budget starts the second round", async () => {
    const model = new SlowToolModel([10, 10], [toolCall("search_knowledge_base", { query: "q1" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { budgetMs: 3_000, minRoundMs: 1_500, roundTimeoutMs: 0 } });
    const state = await run(graph);
    expect(model.seen).toHaveLength(2);
    expect(state.meta.researchStop).toBe("model_done");
  });

  test("the stop reason says whether the model finished or hit the round cap", async () => {
    const done = await run(fakeGraph({ intent: lookup, researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]) }).graph);
    expect(done.meta.researchStop).toBe("model_done");
    const capped = await run(
      fakeGraph({ intent: lookup, researchModel: new ScriptedToolModel([toolCall("search_knowledge_base", { query: "a" }), toolCall("search_knowledge_base", { query: "b" })]), research: { maxRounds: 2 } }).graph,
    );
    expect(capped.meta.researchStop).toBe("max_rounds");
  });

  test("the env defaults: a 16 s round timeout and a 5 s minimum round budget", async () => {
    const { env } = fakeGraph({ intent: lookup });
    expect(env.RESEARCH_ROUND_TIMEOUT_MS).toBe(16_000);
    expect(env.RESEARCH_MIN_ROUND_MS).toBe(5_000);
  });
});

describe("urgent turns skip the model research rounds", () => {
  const helplineWeb: WebSearcher = {
    async search(query) {
      return { query, summary: "", queries: [query], fromCache: false, results: [{ url: "https://dghs.gov.bd/mental-health-helpline", title: "National mental health helpline", snippet: "Call the national helpline, open 24 hours.", allowed: true }] };
    },
  };
  const distressInput = "Bangladeshi student messaged: ami r parchi na… kono kaj er na. What are the Monash Master of IT fees?";

  test("a distress turn answers from round 0 and the helpline search, with no research model call", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q1" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, tools: { web: helplineWeb }, research: { urgentMaxRounds: 0 } });
    const state = await run(graph, distressInput);
    expect(state.meta.distress).toBeDefined();
    expect(model.seen).toHaveLength(0);
    expect(state.researchTrace?.rounds).toBe(0);
    expect(state.meta.researchRoundCap).toEqual({ reason: "urgent", maxRounds: 0 });
    const urls = state.evidence.map((e: { url: string }) => e.url);
    expect(urls).toContain("https://dghs.gov.bd/mental-health-helpline");
    // Round 0's knowledge base still runs.
    expect(state.evidence.filter((e: { kind: string }) => e.kind === "kb")).toHaveLength(2);
  });

  test("the classifier's crisis_safeguarding signal is urgent too", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q1" })]);
    const classifier = RunnableLambda.from(async () => ({ ...lookup, extras: { classifier: "jev", signals: ["crisis_safeguarding"] } }));
    const { graph } = fakeGraph({ intent: lookup, classifier, researchModel: model, research: { urgentMaxRounds: 0 } });
    const state = await run(graph);
    expect(model.seen).toHaveLength(0);
    expect(state.meta.researchRoundCap).toEqual({ reason: "urgent", maxRounds: 0 });
  });

  test("RESEARCH_URGENT_MAX_ROUNDS at or above RESEARCH_MAX_ROUNDS restores the full loop", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q1" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, tools: { web: helplineWeb }, env: testEnv({ RESEARCH_URGENT_MAX_ROUNDS: "3", RESEARCH_SHORT_MAX_ROUNDS: "3" }) });
    const state = await run(graph, distressInput);
    expect(model.seen).toHaveLength(2);
    expect(state.meta.researchRoundCap).toBeUndefined();
  });

  test("an ordinary turn is not capped, and the default urgent cap is 0", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q1" }), new AIMessage({ content: "sufficient" })]);
    const { graph, env } = fakeGraph({ intent: lookup, researchModel: model });
    const state = await run(graph);
    expect(model.seen).toHaveLength(2);
    expect(state.meta.researchRoundCap).toBeUndefined();
    expect(env.RESEARCH_URGENT_MAX_ROUNDS).toBe(0);
  });
});

describe("short-first questions research at most RESEARCH_SHORT_MAX_ROUNDS rounds", () => {
  const threeRounds = () =>
    new ScriptedToolModel([
      toolCall("search_knowledge_base", { query: "q1" }),
      toolCall("search_knowledge_base", { query: "q2" }),
      toolCall("search_knowledge_base", { query: "q3" }),
      new AIMessage({ content: "sufficient" }),
    ]);

  test("a short lookup stops after two rounds", async () => {
    const model = threeRounds();
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { shortMaxRounds: 2 } });
    const state = await run(graph, "Monash MIT fees?");
    expect(model.seen).toHaveLength(2);
    expect(state.researchTrace?.rounds).toBe(2);
    expect(state.meta.researchRoundCap).toEqual({ reason: "short_question", maxRounds: 2 });
    expect(state.meta.shortFirst).toBe(true);
  });

  test("a question asking for detail keeps every round", async () => {
    const model = threeRounds();
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { shortMaxRounds: 2 } });
    const state = await run(graph, "Give me the full breakdown of Monash MIT fees?");
    expect(model.seen).toHaveLength(3);
    expect(state.meta.researchRoundCap).toBeUndefined();
  });

  test("a short question about a named student, the caseload or the consultant's mail keeps every round", async () => {
    const named = RunnableLambda.from(async () => ({ ...lookup, extras: { classifier: "jev", signals: ["student_named"] } }));
    for (const opts of [
      { classifier: named, input: "Is Priya's offer in?" },
      { intent: intentOf({ ...lookup, primary_intent: "caseload_management" }), input: "Who is waiting today?" },
      { input: "Did Monash reply to my email?" },
    ]) {
      const model = threeRounds();
      const { graph } = fakeGraph({ intent: opts.intent ?? lookup, ...(opts.classifier ? { classifier: opts.classifier } : {}), researchModel: model, research: { shortMaxRounds: 2 } });
      const state = await run(graph, opts.input);
      expect([opts.input, model.seen.length]).toEqual([opts.input, 3]);
      expect(state.meta.researchRoundCap).toBeUndefined();
    }
  });

  test("a short draft request is not a short-first answer and keeps every round", async () => {
    const model = threeRounds();
    const { graph } = fakeGraph({ intent: { ...lookup, task: "draft" }, researchModel: model, research: { shortMaxRounds: 2 } });
    await run(graph, "Draft a reply about MIT fees");
    expect(model.seen).toHaveLength(3);
  });

  test("the default is 2, and at or above RESEARCH_MAX_ROUNDS it restores the full loop", async () => {
    const capped = threeRounds();
    const d = fakeGraph({ intent: lookup, researchModel: capped });
    expect(d.env.RESEARCH_SHORT_MAX_ROUNDS).toBe(2);
    await run(d.graph, "Monash MIT fees?");
    expect(capped.seen).toHaveLength(2);

    const full = threeRounds();
    await run(fakeGraph({ intent: lookup, researchModel: full, env: testEnv({ RESEARCH_SHORT_MAX_ROUNDS: "3" }) }).graph, "Monash MIT fees?");
    expect(full.seen).toHaveLength(3);
  });
});
