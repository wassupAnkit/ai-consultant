import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { ChatService } from "../src/app/service";
import { KEEP_SOURCE_CURRENCY_INSTRUCTION } from "../src/graph/fx";
import { isRewriteOfPrevious, PRIOR_ANSWER_MAX_CHARS, REWRITE_INSTRUCTION } from "../src/graph/rewrite";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { fakeGraph, intentOf, testEnv } from "./helpers";

// South Asia audit (Oct 2026): "make it shorter for the parent" invented figures (NPR 35 lakh
// against 61–75 lakh in the previous answer) and a false IELTS rule; a Bangla rewrite
// contradicted the previous turn. A rewrite of the previous answer may use only its facts.
describe("isRewriteOfPrevious", () => {
  const draft = intentOf({ task: "draft", primary_intent: "financial_viability" });
  const lookup = intentOf({ task: "lookup", primary_intent: "financial_viability" });

  test("rewrite, shorten, simplify, translate and audience phrasings", () => {
    for (const input of [
      "make it shorter for the parent",
      "Shorten this",
      "simplify it please",
      "translate to Nepali",
      "same in Bangla",
      "now in Hindi",
      "write that for the parents",
      "rephrase it more politely",
      "turn that into a WhatsApp message",
    ]) {
      expect([input, isRewriteOfPrevious({ intent: draft, extras: null, input, hasPriorAnswer: true })]).toEqual([input, true]);
    }
  });

  test("a translate/summarize/draft task that refers back counts without a cue phrase", () => {
    expect(isRewriteOfPrevious({ intent: intentOf({ task: "translate" }), extras: { references_prior_turn: true }, input: "Bangla please", hasPriorAnswer: true })).toBe(true);
    expect(isRewriteOfPrevious({ intent: intentOf({ task: "summarize" }), extras: { references_prior_turn: true }, input: "CRM note", hasPriorAnswer: true })).toBe(true);
  });

  test("not a rewrite: no previous answer, or a new question", () => {
    expect(isRewriteOfPrevious({ intent: draft, extras: null, input: "make it shorter", hasPriorAnswer: false })).toBe(false);
    expect(isRewriteOfPrevious({ intent: lookup, extras: null, input: "What is the AU student visa fee?", hasPriorAnswer: true })).toBe(false);
    expect(isRewriteOfPrevious({ intent: lookup, extras: { references_prior_turn: true }, input: "and for Canada?", hasPriorAnswer: true })).toBe(false);
  });
});

describe("a rewrite turn's answer prompt", () => {
  const previous = `Total cost for two years: NPR 61–75 lakh [1]. ${"Living costs vary by city and lifestyle. ".repeat(120)}IELTS: 6.5 overall, no band below 6.0 [2].`;
  const record = () => {
    const seen: BaseMessage[][] = [];
    const model = RunnableLambda.from(async (messages: BaseMessage[]) => {
      seen.push(messages);
      return new AIMessage("Short version.");
    });
    return { seen, model };
  };
  const truncated = previous.slice(0, 3_000) + " …";

  test("carries the rule at the end of the system prompt and the full previous answer", async () => {
    const { seen, model } = record();
    const { graph } = fakeGraph({ intent: intentOf({ task: "draft", primary_intent: "financial_viability", needs_research: false }), answerModel: model });
    await graph.invoke({ input: "make it shorter for the parent", history: [new HumanMessage("Costs for a Nepali student in Sydney?"), new AIMessage(truncated)], priorAnswer: previous, sessionId: "s1", profile: null });
    const [system, , ai] = seen[0]!;
    // After the per-turn request and evidence: the rewrite rule, then the currency rule (src/graph/fx.ts).
    expect(String(system!.content).trimEnd().endsWith(`${REWRITE_INSTRUCTION}\n\n${KEEP_SOURCE_CURRENCY_INSTRUCTION}`)).toBe(true);
    expect(String(ai!.content)).toBe(previous);
    expect(String(ai!.content)).toContain("no band below 6.0");
  });

  test("an ordinary turn has neither", async () => {
    const { seen, model } = record();
    const { graph } = fakeGraph({ intent: intentOf({ task: "lookup", primary_intent: "financial_viability", needs_research: false }), answerModel: model });
    // Self-contained: a message that refers back ("What about Melbourne?") sees earlier answers uncut (src/memory/recall.ts).
    await graph.invoke({ input: "Living costs for a master's student in Melbourne", history: [new HumanMessage("Costs?"), new AIMessage(truncated)], priorAnswer: previous, sessionId: "s1", profile: null });
    const [system, , ai] = seen[0]!;
    expect(String(system!.content)).not.toContain(REWRITE_INSTRUCTION);
    expect(String(ai!.content)).toBe(truncated);
  });

  test("the chat service hands the graph the stored previous answer, capped", async () => {
    const { seen, model } = record();
    const store = new InMemoryChatStore();
    const { graph } = fakeGraph({ intent: intentOf({ task: "draft", primary_intent: "financial_viability", needs_research: false }), answerModel: model });
    const svc = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const huge = previous + "x".repeat(PRIOR_ANSWER_MAX_CHARS);
    const session = await store.getOrCreateSession(undefined, "o1");
    await store.append(session.id, [
      { role: "human", content: "Costs?", createdAt: new Date(1) },
      { role: "ai", content: huge, createdAt: new Date(2) },
    ]);
    await svc.chat({ message: "make it shorter for the parent", sessionId: session.id, ownerId: "o1", requestId: "r1", route: "/v1/chat" });
    const ai = seen[0]!.find((m) => m.getType() === "ai");
    expect(String(ai!.content)).toBe(huge.slice(0, PRIOR_ANSWER_MAX_CHARS));
  });
});
