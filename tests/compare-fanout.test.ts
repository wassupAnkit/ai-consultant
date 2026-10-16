import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { RunnableLambda } from "@langchain/core/runnables";
import { ChatService, type ToolEvent } from "../src/app/service";
import { mergeBranches, mergeEvidence } from "../src/graph/merge-evidence";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import type { RetrievedChunk } from "../src/retrieval/store";
import type { CrmProvider, CrmToolset } from "../src/crm/client";
import { EvidenceCollector } from "../src/tools/evidence";
import type { ResearchTrace } from "../src/tools/types";
import { CountryScriptedModel, FakeProgramSearch, RecordingKnowledgeStore, sampleProgram, ScriptedToolModel, toolCall } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const kbChunk = (country: string, n: number): RetrievedChunk => ({
  ...sampleChunk(n, country),
  id: `${country}-${n}`,
  url: `https://experteducation.com/${country}/#${n}`,
  title: `Study in ${country}`,
  content: `${country} fact ${n}`,
});

/** Answers each search with `n` chunks per filtered country (one shared "global" page when unfiltered). */
const perCountryKb = (n = 2) => new RecordingKnowledgeStore((q) => (q.countries ?? ["global"]).flatMap((c) => Array.from({ length: n }, (_, i) => kbChunk(c, i + 1))));

const compare = (destinations: ("australia" | "canada" | "united_kingdom" | "new_zealand" | "united_states")[], over: Parameters<typeof intentOf>[0] = {}) =>
  intentOf({ primary_intent: "comparative_decision", task: "compare", destinations, user_question: `Nursing in ${destinations.join(" vs ")}`, needs_research: true, ...over });

const crmProvider = (): CrmProvider => {
  const toolset = {
    actor: "jane@heubert.com",
    descriptors: [{ name: "crm_search_contacts", description: "Find contacts (fake)", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }],
    call: async () => ({ text: "no records", isError: false }),
    refresh: async () => {},
  } as unknown as CrmToolset;
  return { forActor: async () => toolset };
};

const invoke = (graph: ReturnType<typeof fakeGraph>["graph"], input: string, extra: Record<string, unknown> = {}, callbacks?: BaseCallbackHandler[]) =>
  graph.invoke({ input, history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com", ...extra }, callbacks ? { callbacks } : undefined);

const emptyTrace = (over: Partial<ResearchTrace> = {}): ResearchTrace => ({ rounds: 0, budgetExceeded: false, toolCalls: [], liveUrls: [], notes: null, error: null, ...over });

const collectorOf = (items: RetrievedChunk[], kind: "kb" | "web" = "kb", max = 24) => {
  const c = new EvidenceCollector(max);
  c.add(items, kind, kind === "web");
  return c;
};

describe("merging comparison branches", () => {
  test("interleaves countries in route order, dedupes, renumbers, and keeps the guided record first", () => {
    const shared = { ...kbChunk("global", 1), url: "https://experteducation.com/shared" };
    const guide: RetrievedChunk = { ...sampleChunk(9, null), id: "crm-1", url: "https://crm.example/contacts/1", title: "Sita Sharma", content: "Student record" };
    const merged = mergeEvidence(
      [
        { country: "australia", items: collectorOf([kbChunk("australia", 1), shared, kbChunk("australia", 2)]).items },
        { country: "canada", items: collectorOf([shared, kbChunk("canada", 1)]).items },
      ],
      { max: 24, guideRecord: guide },
    );
    expect(merged.items.map((i) => [i.n, i.id])).toEqual([
      [1, "crm-1"],
      [2, "australia-1"],
      [3, "global-1"],
      [4, "australia-2"],
      [5, "canada-1"],
    ]);
    expect(merged.items[0]!.kind).toBe("crm");
  });

  test("caps at maxEvidence with a fair share per country, and an unused share flows to the others", () => {
    const au = collectorOf([1, 2, 3, 4].map((n) => kbChunk("australia", n))).items;
    const ca = collectorOf([1, 2, 3, 4].map((n) => kbChunk("canada", n))).items;
    const even = mergeEvidence([{ country: "australia", items: au }, { country: "canada", items: ca }], { max: 5 });
    expect(even.items.map((i) => i.id)).toEqual(["australia-1", "canada-1", "australia-2", "canada-2", "australia-3"]);

    const thin = mergeEvidence([{ country: "australia", items: au.slice(0, 1) }, { country: "canada", items: ca }], { max: 5 });
    expect(thin.items.map((i) => i.id)).toEqual(["australia-1", "canada-1", "canada-2", "canada-3", "canada-4"]);
  });

  test("combines the traces: max rounds, tool calls tagged by country, live URL union, notes per country", () => {
    const au = { country: "australia", collector: collectorOf([kbChunk("australia", 1)]), trace: emptyTrace({ rounds: 2, toolCalls: [{ tool: "web_search", args: { query: "a" }, ms: 1, ok: true, added: 1 }], liveUrls: ["https://a.example"], notes: "sufficient", thoughts: [{ at: 0, text: "au plan" }, { at: 1, text: "au done" }] }) };
    const ca = { country: "canada", collector: collectorOf([kbChunk("canada", 1)]), trace: emptyTrace({ rounds: 1, budgetExceeded: true, toolCalls: [{ tool: "fetch_page", args: { url: "u" }, ms: 1, ok: true, added: 1 }], liveUrls: ["https://a.example", "https://c.example"], thoughts: [{ at: 0, text: "ca plan" }] }) };
    const { collector, trace } = mergeBranches([au, ca], { maxEvidence: 24 });
    expect(collector.items.map((i) => i.n)).toEqual([1, 2]);
    expect(trace.rounds).toBe(2);
    expect(trace.budgetExceeded).toBe(true);
    expect(trace.toolCalls.map((t) => [t.tool, t.country])).toEqual([
      ["web_search", "australia"],
      ["fetch_page", "canada"],
    ]);
    expect(trace.liveUrls).toEqual(["https://a.example", "https://c.example"]);
    expect(trace.notes).toBe("australia: sufficient; canada: ran out of time");
    // Thoughts keep their place in the combined tool-call timeline.
    expect(trace.thoughts).toEqual([
      { at: 0, text: "au plan" },
      { at: 1, text: "au done" },
      { at: 1, text: "ca plan" },
    ]);
  });
});

describe("comparison fan-out in the research node", () => {
  test("runs one branch per country concurrently, pinned to its country, with no CRM tools", async () => {
    const knowledge = perCountryKb();
    const programs = new FakeProgramSearch([sampleProgram()]);
    const model = new CountryScriptedModel(
      {
        Australia: [toolCall("search_knowledge_base", { query: "nursing registration", countries: ["canada"] }), new AIMessage({ content: "sufficient" })],
        Canada: [toolCall("search_programs", { query: "nursing", country: "australia" }), new AIMessage({ content: "Not found: Canadian fees" })],
      },
      30,
    );
    const runs: { runName?: string; country?: unknown }[] = [];
    const handler = BaseCallbackHandler.fromMethods({
      handleChatModelStart(_llm, _messages, _runId, _parent, _extra, _tags, metadata, runName) {
        runs.push({ runName, country: metadata?.researchCountry });
      },
    });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge, tools: { programs }, crmProvider: crmProvider(), research: { compareFanout: true } });
    const state = await invoke(graph, "Nursing in Australia vs Canada?", {}, [handler]);

    expect(model.maxInFlight).toBe(2);
    // Round 0 is per country; the model's own lookups are pinned to the branch country whatever it asked for.
    expect(knowledge.queries.map((q) => q.countries)).toEqual(expect.arrayContaining([["australia"], ["canada"]]));
    expect(knowledge.queries.every((q) => q.countries?.length === 1)).toBe(true);
    const modelKb = knowledge.queries.find((q) => q.text === "nursing registration");
    expect(modelKb?.countries).toEqual(["australia"]);
    expect(programs.calls.filter((c) => c.query === "nursing")).toEqual([expect.objectContaining({ country: "canada" })]);
    expect(programs.calls.filter((c) => c.limit === 6).map((c) => c.countries)).toEqual(expect.arrayContaining([["australia"], ["canada"]]));

    // Each branch's planner sees only its country and no CRM tools.
    const auPrompt = String(model.seen.Australia![0]![0]!.content);
    expect(auPrompt).toContain("Destinations: Australia");
    expect(auPrompt).not.toContain("crm_search_contacts:");
    expect(String(model.seen.Canada![0]![0]!.content)).toContain("Destinations: Canada");
    expect((state.meta.toolsOffered as string[]).some((t) => t.startsWith("crm_"))).toBe(false);

    // Langfuse can tell the branches apart.
    const research = runs.filter((r) => r.runName?.startsWith("research_round_"));
    expect(research.map((r) => r.runName).sort()).toEqual(["research_round_1:australia", "research_round_1:canada", "research_round_2:australia", "research_round_2:canada"]);
    expect(research.every((r) => r.runName!.endsWith(`:${r.country}`))).toBe(true);

    expect(state.meta.fanout).toMatchObject({ countries: ["australia", "canada"] });
    expect(state.researchTrace!.toolCalls.map((t) => [t.tool, t.country])).toEqual([
      ["search_knowledge_base", "australia"],
      ["search_programs", "canada"],
    ]);
    expect(state.researchTrace!.toolCalls[0]!.args).toEqual({ query: "nursing registration", countries: ["australia"] });
    expect(state.researchTrace!.notes).toBe("australia: sufficient; canada: Not found: Canadian fees");
    // Evidence alternates countries, renumbered from 1.
    expect(state.evidence.map((i) => i.n)).toEqual(state.evidence.map((_, k) => k + 1));
    expect(state.evidence.slice(0, 2).map((i) => i.country)).toEqual(["australia", "canada"]);
  });

  test("branches get no destination brief: packs lowered comparison coverage", async () => {
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new AIMessage({ content: "sufficient" })] });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"], { primary_intent: "visa_process" }), researchModel: model, knowledge: perCountryKb(), skillPacks: true, marketPacks: false, research: { compareFanout: true } });
    const state = await invoke(graph, "Student visa: Australia vs Canada?");
    expect(state.skills).toBeNull();
    for (const country of ["Australia", "Canada"]) {
      const prompt = String(model.seen[country]![0]![0]!.content);
      expect(prompt).not.toContain("# Country brief");
      expect(prompt).toContain(`Destinations: ${country} (one branch of a comparison`);
    }
  });

  test("a guided session's CRM record stays [1] ahead of the interleaved branches", async () => {
    const record: RetrievedChunk = { ...sampleChunk(9, null), id: "crm-1", url: "https://crm.example/contacts/1", title: "Sita Sharma", content: "Student record" };
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), knowledge: perCountryKb(), research: { compareFanout: true, maxRounds: 0 } });
    const state = await invoke(graph, "Nursing in Australia vs Canada?", { guide: { step: "destination", stepsDone: [], contactId: "C1", snapshot: null, record } });
    expect(state.meta.fanout).toBeDefined();
    expect(state.evidence.map((i) => i.id)).toEqual(["crm-1", "australia-1", "canada-1", "australia-2", "canada-2"]);
    expect(state.evidence.map((i) => i.n)).toEqual([1, 2, 3, 4, 5]);
  });

  test("compares at most COMPARE_MAX_COUNTRIES countries and says which were dropped", async () => {
    const knowledge = perCountryKb(1);
    const { graph } = fakeGraph({
      intent: compare(["australia", "canada", "united_kingdom", "new_zealand"]),
      knowledge,
      researchModel: new CountryScriptedModel({ Australia: [], Canada: [], "United Kingdom": [], "New Zealand": [] }),
      research: { compareFanout: true },
    });
    const state = await invoke(graph, "Nursing in Australia, Canada, UK or NZ?");
    expect(state.route?.countries).toHaveLength(4);
    expect(knowledge.queries.map((q) => q.countries![0]).sort()).toEqual(["australia", "canada", "united_kingdom"]);
    expect(state.meta.fanout).toMatchObject({ countries: ["australia", "canada", "united_kingdom"], dropped: ["new_zealand"] });
    expect(state.researchTrace!.notes).toStartWith("Compared the first 3 countries only; not researched: new_zealand.");
  });

  test("COMPARE_MAX_COUNTRIES and COMPARE_BRANCH_ROUNDS come from the environment", async () => {
    const env = testEnv({ COMPARE_FANOUT_ENABLED: "true", COMPARE_MAX_COUNTRIES: "2", COMPARE_BRANCH_ROUNDS: "1" });
    expect([env.COMPARE_FANOUT_ENABLED, env.COMPARE_MAX_COUNTRIES, env.COMPARE_BRANCH_ROUNDS]).toEqual([true, 2, 1]);
    const defaults = testEnv();
    expect([defaults.COMPARE_FANOUT_ENABLED, defaults.COMPARE_MAX_COUNTRIES, defaults.COMPARE_BRANCH_ROUNDS]).toEqual([false, 3, 2]);
  });

  test("a branch that fails does not sink the others, and its note says so", async () => {
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new Error("503 overloaded")] });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge: perCountryKb(), research: { compareFanout: true } });
    const state = await invoke(graph, "Nursing in Australia vs Canada?");
    expect(state.researchTrace!.notes).toBe("australia: sufficient; canada: research stopped early (503 overloaded)");
    expect(state.researchTrace!.error).toBe("canada: 503 overloaded");
    // Round-0 evidence from both branches survives.
    expect(new Set(state.evidence.map((i) => i.country))).toEqual(new Set(["australia", "canada"]));
    expect(state.answer).toBeTruthy();
  });

  test("a branch whose knowledge base fails still runs, and the other branch's evidence is kept", async () => {
    const knowledge = new RecordingKnowledgeStore((q) => {
      if (q.countries?.[0] === "canada") throw new Error("kb down");
      return [kbChunk(q.countries?.[0] ?? "global", 1)];
    });
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new AIMessage({ content: "sufficient" })] });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge, research: { compareFanout: true } });
    const state = await invoke(graph, "Nursing in Australia vs Canada?");
    expect(state.evidence.map((i) => i.id)).toEqual(["australia-1"]);
    expect(state.researchTrace!.notes).toContain("australia: sufficient");
  });

  test("a branch that runs out of time stops while the other branch's evidence is kept", async () => {
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new AIMessage({ content: "sufficient" })] });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge: perCountryKb(), research: { compareFanout: true, budgetMs: 1_000 } });
    const state = await invoke(graph, "Nursing in Australia vs Canada?");
    expect(state.researchTrace!.budgetExceeded).toBe(true);
    expect(state.researchTrace!.notes).toBe("australia: ran out of time; canada: ran out of time");
    expect(state.evidence).toHaveLength(4);
  });

  test("falls back to the single loop for a named student with a CRM, and for caseload work", async () => {
    const named = intentOf({ ...compare(["australia", "canada"]) });
    const classifier = RunnableLambda.from(async () => ({ ...named, extras: { classifier: "jev", signals: ["student_named"] } }));
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const a = fakeGraph({ intent: named, classifier, researchModel: model, knowledge: perCountryKb(), crmProvider: crmProvider(), research: { compareFanout: true } });
    const s1 = await invoke(a.graph, "Should Priya pick Australia or Canada for nursing?");
    expect(s1.meta.fanout).toBeUndefined();
    expect((s1.meta.route as { fanoutSkipped?: string }).fanoutSkipped).toBe("named student needs a CRM lookup");
    expect((s1.meta.route as { countries?: string[] }).countries).toEqual(["australia", "canada"]);
    expect(s1.meta.toolsOffered).toContain("crm_search_contacts");
    expect(model.seen).toHaveLength(1);

    const caseload = intentOf({ ...compare(["australia", "canada"]), primary_intent: "caseload_management" });
    const b = fakeGraph({ intent: caseload, knowledge: perCountryKb(), research: { compareFanout: true, maxRounds: 0 } });
    const s2 = await invoke(b.graph, "Compare my Australia and Canada pipelines");
    expect(s2.meta.fanout).toBeUndefined();
    expect((s2.meta.route as { fanoutSkipped?: string }).fanoutSkipped).toBe("caseload");
  });

  test("off by default: a comparison runs the single loop", async () => {
    const knowledge = perCountryKb();
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge });
    const state = await invoke(graph, "Nursing in Australia vs Canada?");
    expect(state.route?.mode).toBe("comparison");
    expect(state.meta.fanout).toBeUndefined();
    expect((state.meta.route as { fanoutSkipped?: string }).fanoutSkipped).toBeUndefined();
    expect(knowledge.queries.map((q) => q.countries)).toEqual([["australia", "canada"]]);
    expect(model.seen).toHaveLength(1);
  });

  test("generate gets the merged evidence, without destination guidance", async () => {
    const { graph } = fakeGraph({
      intent: compare(["australia", "canada"], { primary_intent: "visa_process" }),
      knowledge: perCountryKb(),
      skillPacks: true,
      research: { compareFanout: true, maxRounds: 0 },
      answer: "| | Australia | Canada |",
    });
    const state = await invoke(graph, "Student visa: Australia vs Canada?");
    const system = String(state.meta.systemPromptText);
    expect(system).not.toContain("# Country guidance");
    expect(system).toMatch(/<excerpt id="1"[^>]*>[\s\S]*australia fact 1/);
    expect(system).toMatch(/<excerpt id="2"[^>]*>[\s\S]*canada fact 1/);
  });

  test("tool events carry the branch country to the client", async () => {
    const model = new CountryScriptedModel({
      Australia: [toolCall("search_knowledge_base", { query: "au nursing" }), new AIMessage({ content: "sufficient" })],
      Canada: [toolCall("search_knowledge_base", { query: "ca nursing" }), new AIMessage({ content: "sufficient" })],
    });
    const { graph } = fakeGraph({ intent: compare(["australia", "canada"]), researchModel: model, knowledge: perCountryKb(), research: { compareFanout: true } });
    const chat = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }) });
    const events: ToolEvent[] = [];
    await chat.chat({ message: "Nursing in Australia vs Canada?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat", onTool: (e) => events.push(e) });
    expect(events.map((e) => [e.tool, e.status, e.country]).sort()).toEqual([
      ["search_knowledge_base", "end", "australia"],
      ["search_knowledge_base", "end", "canada"],
      ["search_knowledge_base", "start", "australia"],
      ["search_knowledge_base", "start", "canada"],
    ]);
  });
});
