import { describe, expect, test } from "bun:test";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { createClassifier, createJevClassifier, splitMessages } from "../src/classify";
import { JevClient } from "../src/classify/jev";
import { fakeGraph, intentOf, testEnv } from "./helpers";

const jevResponse = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: "typesafe/jev-1.13-x",
      answers: {
        intent: { type: "choice", choice: "policy_change", confidence: 0.93, probabilities: { policy_change: 0.93, migration_pathway: 0.05 } },
        task: { type: "choice", choice: "lookup", confidence: 0.9, probabilities: { lookup: 0.9 } },
        audience: { type: "choice", choice: "consultant", confidence: 0.9, probabilities: {} },
        channel: { type: "choice", choice: "chat_answer", confidence: 0.9, probabilities: {} },
        stage: { type: "choice", choice: "visa_lodged", confidence: 0.8, probabilities: {} },
        language: { type: "choice", choice: "en", confidence: 0.99, probabilities: {} },
        study_level: { type: "choice", choice: "unspecified", confidence: 0.9, probabilities: {} },
        d_australia: { type: "noul", noul: 0.95 },
        policy_recency: { type: "noul", noul: 0.9 },
        student_named: { type: "noul", noul: 0.8 },
        references_prior_turn: { type: "noul", noul: 0.9 },
        r_needs_facts: { type: "noul", noul: 0.9 },
        ...over,
      },
      usage: { cost: 0.00003 },
    }),
    { status: 200 },
  );

const messages = [
  new SystemMessage("classifier prompt"),
  new HumanMessage("Catch me up on Priya Karki"),
  new AIMessage("Priya is at offer stage."),
  new HumanMessage("And does the 1 July financial change hit her? Her passport is N1234567."),
];

describe("splitMessages", () => {
  test("separates the current message from role-tagged history", () => {
    expect(splitMessages(messages)).toEqual({
      input: "And does the 1 July financial change hit her? Her passport is N1234567.",
      history: ["consultant: Catch me up on Priya Karki", "edge: Priya is at offer stage."],
    });
  });
});

describe("jev classifier runnable", () => {
  test("redacts PII before calling Jev and returns a schema-valid intent with extras", async () => {
    let sent: any = null;
    const jev = new JevClient({ apiKey: "k", fetch: (async (_u: string, init: RequestInit) => ((sent = JSON.parse(init.body as string)), jevResponse())) as unknown as typeof fetch });
    const fallback = RunnableLambda.from(async () => {
      throw new Error("fallback must not run");
    });
    const raw = (await createJevClassifier(jev, fallback, { timeoutMs: 2_000 }).invoke(messages)) as any;
    expect(sent.state.consultant_message).toContain("[id]");
    expect(sent.state.consultant_message).not.toContain("N1234567");
    expect(sent.state.recent_conversation).toHaveLength(2);
    expect(raw.primary_intent).toBe("policy_change");
    expect(raw.destinations).toEqual(["australia"]);
    expect(raw.contextual_flags).toContain("policy_recency");
    // follow-up: the retrieval query carries the earlier consultant turn, unredacted for our own retrieval
    expect(raw.user_question).toBe("Catch me up on Priya Karki — And does the 1 July financial change hit her? Her passport is N1234567.");
    expect(raw.extras).toMatchObject({ classifier: "jev", stage: "visa_lodged", signals: ["student_named", "pii_sensitive"], intent_confidence: 0.93, references_prior_turn: true });
  });

  test("a Jev error or timeout hands the turn to the Gemini classifier and says so", async () => {
    const jev = new JevClient({ apiKey: "k", fetch: (async () => new Response("down", { status: 529 })) as unknown as typeof fetch });
    const fallback = RunnableLambda.from(async () => intentOf({ primary_intent: "financial_viability", user_question: "fallback" }));
    const raw = (await createJevClassifier(jev, fallback, { timeoutMs: 2_000 }).invoke(messages)) as any;
    expect(raw.primary_intent).toBe("financial_viability");
    expect(raw.extras.classifier).toBe("gemini-fallback");
    expect(raw.extras.fallbackReason).toContain("529");
    expect(raw.extras.signals).toEqual(["pii_sensitive"]);

    const slow = new JevClient({ apiKey: "k", fetch: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch });
    const t = (await createJevClassifier(slow, fallback, { timeoutMs: 50 }).invoke(messages)) as any;
    expect(t.extras.fallbackReason).toContain("timed out");
  });

  test("createClassifier honours CLASSIFIER_PROVIDER and degrades to gemini without a key", () => {
    expect(createClassifier(testEnv()).provider).toBe("gemini");
    expect(createClassifier(testEnv({ CLASSIFIER_PROVIDER: "jev" })).provider).toBe("gemini");
    expect(createClassifier(testEnv({ CLASSIFIER_PROVIDER: "jev", OPENROUTER_API_KEY: "k" })).provider).toBe("jev");
  });
});

describe("extras through the graph", () => {
  test("classify lifts extras onto state and metadata; generate and research see them", async () => {
    const intent = intentOf({ primary_intent: "policy_change", destinations: ["australia"], user_question: "what changed for 500?", needs_research: false });
    const extras = { classifier: "jev", audience: "parent_or_family", channel: "call_script", stage: "visa_lodged", signals: ["student_named", "compound_request"], intent_confidence: 0.93, probabilities: {}, model: "typesafe/jev-1.13-x", latencyMs: 380, cost: 0.00003, fallbackReason: null, references_prior_turn: false };
    const { graph } = fakeGraph({
      intent,
      classifier: RunnableLambda.from(async () => ({ ...intent, extras })),
      answer: "From 1 July… [1]",
    });
    const state = await graph.invoke({ input: "what changed?", history: [], sessionId: "s", profile: null });
    expect(state.intentExtras).toMatchObject({ classifier: "jev", audience: "parent_or_family", stage: "visa_lodged" });
    expect(state.meta).toMatchObject({ classifier: "jev", jevConfidence: 0.93, audience: "parent_or_family", channel: "call_script", stage: "visa_lodged", signals: ["student_named", "compound_request"] });
    expect(state.meta.systemPromptText as string).toContain("Audience for any text produced: parent_or_family | Channel: call_script | Case stage: visa_lodged | Signals: student_named, compound_request");
  });

  test("a Gemini classification leaves extras null and the prompt at its defaults", async () => {
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", needs_research: false }), answer: "ok" });
    const state = await graph.invoke({ input: "cost?", history: [], sessionId: "s", profile: null });
    expect(state.intentExtras).toBeNull();
    expect(state.meta.classifier).toBe("gemini");
    expect(state.meta.systemPromptText as string).toContain("Audience for any text produced: consultant | Channel: chat_answer | Case stage: unspecified | Signals: none");
  });
});
