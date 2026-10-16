import { describe, expect, test } from "bun:test";
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { promptDate } from "../src/prompts/compile";
import { NO_RESEARCH_NOTE } from "../src/prompts/consultant";
import { NullKnowledgeStore, type KnowledgeStore, type RetrievedChunk, type SearchQuery } from "../src/retrieval/store";
import type { CrmCallOptions, CrmProvider, CrmToolDescriptor, CrmToolResult, CrmToolset } from "../src/crm/client";
import { CrmWriteService } from "../src/crm/approvals/service";
import { InMemoryCrmWriteProposalStore } from "../src/crm/approvals/store";
import type { CrmWriteProposalView } from "../src/crm/approvals/types";
import { ChatService } from "../src/app/service";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import type { PageFetcher, WebSearcher } from "../src/tools";
import { LiveFetchError, type LivePage } from "../src/live/fetch";
import { CRM_READ_TOOL, fakeToolset, FakeProgramSearch, sampleProgram, ScriptedToolModel, toolCall, toolCalls } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const lookup = intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Monash Master of IT fees?", task: "lookup", needs_research: true });
const run = (graph: ReturnType<typeof fakeGraph>["graph"], input: string) => graph.invoke({ input, history: [], sessionId: "s1", profile: null });

const monashPage: LivePage = {
  url: "https://www.monash.edu/study/mit",
  finalUrl: "https://www.monash.edu/study/mit",
  title: "Master of IT — Monash",
  text: "International tuition 2026: AUD 47,900 per year. Intakes February and July.",
  sections: [
    { heading: "Fees", level: 2, text: "International tuition 2026: AUD 47,900 per year. Fees are reviewed annually and indexed." },
    { heading: "Intakes", level: 2, text: "Intakes in February and July. Applications close six weeks before semester." },
  ],
  fetchedAt: "2026-09-04T00:00:00.000Z",
  fromCache: false,
  truncated: false,
};

const fetcher = (fail?: LiveFetchError): PageFetcher & { calls: { url: string; explicit?: boolean }[] } => ({
  calls: [],
  async fetch(url, opts) {
    this.calls.push({ url, explicit: opts.explicit });
    if (fail) throw fail;
    if (!/monash\.edu/.test(url)) throw new LiveFetchError("policy_denied", `Fetching ${url} is not allowed (not_allowed)`);
    return { ...monashPage, url, finalUrl: url };
  },
});

const web: WebSearcher = {
  async search(query) {
    return {
      query,
      summary: "Monash MIT is AUD 47,900/yr.",
      queries: [query],
      fromCache: false,
      results: [{ url: "https://www.monash.edu/study/mit", title: "monash.edu", snippet: "International tuition 2026: AUD 47,900 per year.", allowed: true }],
    };
  },
};

/** Knowledge store that records every query and answers from a lookup keyed on the sourceKinds filter. */
class RecordingKnowledgeStore implements KnowledgeStore {
  queries: SearchQuery[] = [];
  constructor(private readonly answer: (q: SearchQuery) => RetrievedChunk[]) {}
  async search(q: SearchQuery) {
    this.queries.push(q);
    return this.answer(q);
  }
  async ping() {
    return true;
  }
  async count() {
    return 1;
  }
}

const fakeCrmProvider = (names: string[]): CrmProvider => {
  const toolset: CrmToolset = {
    actor: "jane@heubert.com",
    descriptors: names.map((name) => ({ name, description: `${name} (fake)`, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } })),
    call: async () => ({ text: "no records", isError: false }),
    refresh: async () => {},
  } as CrmToolset;
  return { forActor: async () => toolset };
};

describe("intent scoping in the research node", () => {
  test("caseload work offers only CRM tools plus the knowledge base and skips the round-0 search", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "caseload_management", user_question: "What do I need to do today?", task: "lookup", needs_research: true }),
      answer: "Two tasks are overdue [1].",
      researchModel: model,
      knowledge,
      tools: { web, fetcher: fetcher(), programs: new FakeProgramSearch([sampleProgram()]) },
      crmProvider: fakeCrmProvider(["crm_list_my_tasks", "crm_search_contacts"]),
    });
    const state = await run(graph, "What do I need to do today?");
    expect(knowledge.queries).toHaveLength(0);
    expect(state.meta.round0Knowledge).toBe("skipped");
    expect(state.meta.toolsOffered).toEqual(["search_knowledge_base", "crm_list_my_tasks", "crm_search_contacts"]);
    expect(state.meta.scopeReason).toContain("CRM only");
  });

  test("a policy question is not offered CRM tools, and a program-shaped one gets program records in round 0", async () => {
    const programs = new FakeProgramSearch([sampleProgram()]);
    const policy = fakeGraph({
      intent: intentOf({ primary_intent: "policy_change", user_question: "What changed for 500 visas?", needs_research: true }),
      researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]),
      tools: { web, fetcher: fetcher(), programs },
      crmProvider: fakeCrmProvider(["crm_list_my_tasks"]),
    });
    const p = await run(policy.graph, "what changed?");
    expect(p.meta.toolsOffered).toEqual(["search_knowledge_base", "web_search", "fetch_page"]);
    expect(p.meta.round0Programs).toBeUndefined();

    const eligibility = fakeGraph({
      intent: intentOf({ primary_intent: "eligibility_check", destinations: ["australia"], study_level: "master", study_area: "IT", user_question: "Does she meet Monash MIT?", needs_research: true }),
      research: { maxRounds: 0 },
      tools: { programs },
    });
    const e = await run(eligibility.graph, "GPA 3.4, IELTS 7 — Monash MIT?");
    expect(e.meta.round0Programs).toBe(1);
    expect(e.evidence.some((i) => i.kind === "programs")).toBe(true);
  });

  test("a round-0 filter that finds nothing falls back to the unfiltered search", async () => {
    const knowledge = new RecordingKnowledgeStore((q) => (q.sourceKinds?.length ? [] : [sampleChunk(1), sampleChunk(2)]));
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "company_services", user_question: "Where is our Pokhara office?", needs_research: true }),
      research: { maxRounds: 0 },
      knowledge,
      answer: "Pokhara office [1].",
    });
    const state = await run(graph, "where's our Pokhara office?");
    expect(knowledge.queries.map((q) => q.sourceKinds)).toEqual([["site", "upload"], undefined]);
    expect(state.meta.round0FilterFallback).toBe(true);
    expect(state.chunks).toHaveLength(2);
  });

  test("scoping can be switched off, restoring every tool and a plain round 0", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "caseload_management", user_question: "my tasks", needs_research: true }),
      researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]),
      knowledge,
      tools: { web, fetcher: fetcher(), programs: new FakeProgramSearch([]) },
      crmProvider: fakeCrmProvider(["crm_list_my_tasks"]),
      research: { intentScoping: false },
    });
    const state = await run(graph, "my tasks");
    expect(knowledge.queries).toHaveLength(1);
    expect(state.meta.toolsOffered).toEqual(["search_knowledge_base", "search_programs", "web_search", "fetch_page", "crm_list_my_tasks"]);
    expect(state.meta.scopeReason).toBe("scoping disabled");
  });
});

describe("layered country routing in the graph", () => {
  test("classify records the route in state and meta; round 0 filters on vocabulary-implied countries", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "visa_process", needs_research: true, destinations: [] }), research: { maxRounds: 0 }, knowledge });
    const state = await run(graph, "CAS letter delayed, what now?");
    expect(state.route).toEqual({ countries: ["united_kingdom"], countrySource: ["keywords"], topic: "visa_process", stage: "unspecified", mode: "single", origin: null, originSource: null, onshore: null, counsellorRegion: null });
    expect(state.meta.route).toEqual(state.route);
    expect(knowledge.queries[0]!.countries).toEqual(["united_kingdom"]);
  });

  test("a comparison searches programs across every routed country, and the planner sees them all", async () => {
    const programs = new FakeProgramSearch([sampleProgram()]);
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "comparative_decision", task: "compare", destinations: ["canada"], user_question: "Nursing in Canada vs Australia", needs_research: true }),
      researchModel: model,
      tools: { programs },
    });
    const state = await run(graph, "Nursing in Canada vs Australia?");
    expect(state.route?.mode).toBe("comparison");
    expect(programs.calls[0]).toMatchObject({ country: "canada", countries: ["canada", "australia"] });
    expect(String(model.seen[0]![0]!.content)).toContain("Destinations: Canada, Australia");
  });

  test("a short follow-up carries the previous turn's stored countries over", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", needs_research: true }), research: { maxRounds: 0 }, knowledge });
    const state = await graph.invoke({ input: "what about fees?", history: [new HumanMessage("Student visa rules?"), new AIMessage("Here they are [1].")], sessionId: "s1", profile: null, priorDestinations: ["australia"] });
    expect(state.route?.countrySource).toEqual(["history"]);
    expect(knowledge.queries[0]!.countries).toEqual(["australia"]);
  });

  test("the chat service stores each turn's route and hands it to the next turn's follow-up", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    // Turn 1 names Canada; turn 2 ("and the fees?") names nothing, and turn 3 inherits from turn 2's stored route.
    const intents = [intentOf({ primary_intent: "visa_process", destinations: ["canada"], needs_research: true }), intentOf({ primary_intent: "financial_viability", needs_research: true }), intentOf({ primary_intent: "financial_viability", needs_research: true })];
    let i = 0;
    const { graph } = fakeGraph({ intent: intents[0]!, classifier: RunnableLambda.from(async () => intents[i++]!), research: { maxRounds: 0 }, knowledge, answer: "ok [1]" });
    const store = new InMemoryChatStore();
    const chat = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const first = await chat.chat({ message: "Study permit steps for Canada?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat" });
    await chat.chat({ message: "and the fees?", ownerId: "jane@heubert.com", requestId: "r2", route: "/v1/chat", sessionId: first.sessionId });
    await chat.chat({ message: "same for PhD", ownerId: "jane@heubert.com", requestId: "r3", route: "/v1/chat", sessionId: first.sessionId });
    expect(knowledge.queries.map((q) => q.countries)).toEqual([["canada"], ["canada"], ["canada"]]);
    const stored = await store.getMessages(first.sessionId, 10);
    expect(stored[3]!.metadata?.route).toEqual({ countries: ["canada"], mode: "single" });
  });
});

describe("prompt layout for prefix caching", () => {
  test("the answer and research prompts get today's date and compile with no country pack or brief", async () => {
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model });
    const state = await run(graph, "Monash MIT fees?");
    const today = promptDate();
    const system = String(state.meta.systemPromptText);
    expect(system).toContain(`\nToday: ${today}\n`);
    expect(system).not.toContain("{{");
    const research = String(model.seen[0]![0]!.content);
    expect(research).toContain(`# Request\nToday: ${today}\n`);
    expect(research).not.toContain("{{");
    expect(research.indexOf("# How to work")).toBeLessThan(research.indexOf("# Tools"));
  });

  test("program evidence carries its record date into the prompt", async () => {
    const programs = new FakeProgramSearch([{ ...sampleProgram(1), updatedAt: "2026-09-20T10:00:00.000Z" }]);
    const { graph } = fakeGraph({ intent: lookup, research: { maxRounds: 0 }, tools: { programs } });
    const state = await run(graph, "Monash MIT fees?");
    expect(String(state.meta.systemPromptText)).toMatch(/<excerpt id="3"[^>]*source="kb_programs"[^>]*updated="2026-09-20"/);
  });
});

describe("research loop", () => {
  test("tool calls add numbered live evidence that the answer can cite", async () => {
    const model = new ScriptedToolModel([
      toolCalls([
        { name: "search_knowledge_base", args: { query: "Monash Master of IT international fees", countries: ["australia"] } },
        { name: "fetch_page", args: { url: "https://www.monash.edu/study/mit", focus: "international tuition fees" } },
      ]),
      new AIMessage({ content: "sufficient" }),
    ]);
    const f = fetcher();
    // A course topic: a rule-shaped one (financial_viability) would also run the round-0 official search (freshness.test.ts).
    const { graph } = fakeGraph({ intent: { ...lookup, primary_intent: "program_selection" }, answer: "Monash's Master of IT costs AUD 47,900 per year [3].", researchModel: model, tools: { fetcher: f, web } });
    const state = await run(graph, "What does the Monash Master of IT cost for internationals?");

    expect(state.refused).toBe(false);
    expect(state.researchTrace?.rounds).toBe(2);
    expect(state.researchTrace?.toolCalls.map((t) => t.tool)).toEqual(["search_knowledge_base", "fetch_page"]);
    expect(state.researchTrace?.liveUrls).toEqual(["https://www.monash.edu/study/mit"]);
    expect(state.researchTrace?.notes).toBe("sufficient");
    expect(state.evidence.map((e) => e.n)).toEqual([1, 2, 3]); // 2 KB chunks (round 0) + 1 live chunk (focused on fees)
    expect(state.evidence[2]).toMatchObject({ live: true, kind: "page", source: "live:monash.edu" });
    expect(state.chunks).toHaveLength(2); // KB subset for the activity log
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]).toMatchObject({ n: 3, live: true, kind: "page", url: "https://www.monash.edu/study/mit" });
    expect(String(state.meta.systemPromptText)).toContain('live="true"');
    expect(String(state.meta.systemPromptText)).toContain("Research notes (what the lookup phase could or could not find): sufficient");
    expect(f.calls[0]).toEqual({ url: "https://www.monash.edu/study/mit", explicit: false });
    // Round 2 saw the tool results.
    const round2 = model.seen[1]!;
    expect(round2.filter((m) => m instanceof ToolMessage)).toHaveLength(2);
    expect(String(round2.at(-1)!.content)).toContain("[3] Master of IT — Monash");
  });

  test("URLs the consultant pasted are fetched as explicit", async () => {
    const model = new ScriptedToolModel([toolCall("fetch_page", { url: "https://www.monash.edu/study/mit" }), new AIMessage({ content: "sufficient" })]);
    const f = fetcher();
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, tools: { fetcher: f } });
    await run(graph, "Check fees on https://www.monash.edu/study/mit please");
    expect(f.calls[0]?.explicit).toBe(true);
  });

  test("stops at maxRounds and reports it without exceeding the budget", async () => {
    const model = new ScriptedToolModel([
      toolCall("search_knowledge_base", { query: "q1" }),
      toolCall("search_knowledge_base", { query: "q2" }),
      toolCall("search_knowledge_base", { query: "q3" }),
      toolCall("search_knowledge_base", { query: "q4" }),
    ]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { maxRounds: 2 } });
    const state = await run(graph, "fees?");
    expect(state.researchTrace?.rounds).toBe(2);
    expect(state.researchTrace?.budgetExceeded).toBe(false);
    expect(state.researchTrace?.toolCalls).toHaveLength(2);
    expect(model.seen).toHaveLength(2);
  });

  test("an exhausted time budget still answers from the round-0 knowledge base", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q1" })]);
    const { graph } = fakeGraph({ intent: lookup, answer: "From the KB [1].", researchModel: model, research: { budgetMs: 1_000 } });
    const state = await run(graph, "fees?");
    expect(state.researchTrace?.budgetExceeded).toBe(true);
    expect(state.researchTrace?.rounds).toBe(0);
    expect(model.seen).toHaveLength(0);
    expect(state.evidence).toHaveLength(2);
    expect(state.answer).toContain("From the KB");
  });

  test("a denied fetch and a throwing tool are reported to the model, not fatal", async () => {
    const model = new ScriptedToolModel([
      toolCalls([
        { name: "fetch_page", args: { url: "https://evil.example.com/x" } },
        { name: "search_programs", args: { university: "Monash" } },
      ]),
      new AIMessage({ content: "Not found: fees" }),
    ]);
    const programs = new FakeProgramSearch([], new Error("programs db down"));
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, tools: { fetcher: fetcher(), programs } });
    const state = await run(graph, "fees?");
    expect(state.refused).toBe(false);
    expect(state.researchTrace?.rounds).toBe(2);
    const [fetchRec, progRec] = state.researchTrace!.toolCalls;
    expect(fetchRec).toMatchObject({ tool: "fetch_page", ok: false, added: 0 });
    expect(fetchRec!.error).toContain("policy_denied");
    expect(progRec).toMatchObject({ tool: "search_programs", ok: false });
    expect(progRec!.error).toContain("programs db down");
    const round2 = model.seen[1]!;
    const toolMsgs = round2.filter((m) => m instanceof ToolMessage).map((m) => String(m.content));
    expect(toolMsgs[0]).toContain("policy_denied");
    expect(toolMsgs[1]).toContain("error: programs db down");
    expect(state.researchTrace?.notes).toBe("Not found: fees");
    expect(String(state.meta.systemPromptText)).toContain("Not found: fees");
  });

  test("program records become structured evidence", async () => {
    const model = new ScriptedToolModel([toolCall("search_programs", { university: "Monash", level: "master" }), new AIMessage({ content: "sufficient" })]);
    const programs = new FakeProgramSearch([sampleProgram(1)]);
    const { graph } = fakeGraph({ intent: lookup, answer: "AUD 47,900 per year [3].", researchModel: model, tools: { programs } });
    const state = await run(graph, "Monash MIT fees?");
    // financial_viability is program-shaped, so round 0 already ran an intent-driven program search…
    expect(programs.calls[0]).toMatchObject({ country: "australia", limit: 6 });
    // …and the model's own call still goes through with its arguments.
    expect(programs.calls[1]).toMatchObject({ university: "Monash", level: "master", limit: 8 });
    expect(state.evidence[2]).toMatchObject({ kind: "programs", live: false, source: "kb_programs", docType: "program" });
    expect(state.sources[0]).toMatchObject({ n: 3, kind: "programs", live: false });
  });

  test("web search snippets become live evidence and list fetchable pages", async () => {
    const model = new ScriptedToolModel([toolCall("web_search", { query: "monash MIT fees 2026" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model, tools: { web } });
    const state = await run(graph, "fees?");
    expect(state.evidence[2]).toMatchObject({ kind: "web", live: true, source: "web:monash.edu" });
    expect(String(model.seen[1]!.at(-1)!.content)).toContain("(fetchable with fetch_page)");
  });

  test("a model without bindTools (or maxRounds 0) means knowledge-base only", async () => {
    // RunnableLambda has no bindTools → the loop is skipped entirely.
    const plain = RunnableLambda.from(async () => new AIMessage({ content: "irrelevant" }));
    const { graph } = fakeGraph({ intent: lookup, answer: "KB [1].", researchModel: plain as never });
    const state = await run(graph, "fees?");
    expect(state.researchTrace?.rounds).toBe(0);
    expect(state.evidence).toHaveLength(2);

    // FakeListChatModel does bind tools but never emits tool_calls → one round, then stop.
    const chatty = new FakeListChatModel({ responses: ["sufficient"] });
    const { graph: g1 } = fakeGraph({ intent: lookup, answer: "KB [1].", researchModel: chatty as never });
    const s1 = await run(g1, "fees?");
    expect(s1.researchTrace?.rounds).toBe(1);
    expect(s1.researchTrace?.toolCalls).toHaveLength(0);
    expect(s1.researchTrace?.notes).toBe("sufficient");

    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q" })]);
    const { graph: g2 } = fakeGraph({ intent: lookup, researchModel: model, research: { maxRounds: 0 } });
    const s2 = await run(g2, "fees?");
    expect(s2.researchTrace?.rounds).toBe(0);
    expect(model.seen).toHaveLength(0);
  });

  test("needs_research=false skips the research node entirely", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q" })]);
    const draft = intentOf({ primary_intent: "application_process", task: "draft", needs_research: false, user_question: "draft an email" });
    const { graph } = fakeGraph({ intent: draft, answer: "Subject: SOP reminder\n\nHi [Student]…", researchModel: model });
    const state = await run(graph, "Draft a reminder email about the SOP deadline");
    expect(state.researchTrace).toBeNull();
    expect(state.evidence).toHaveLength(0);
    expect(model.seen).toHaveLength(0);
    expect(String(state.meta.systemPromptText)).toContain(NO_RESEARCH_NOTE.slice(0, 40));
    expect(state.sources).toEqual([]); // drafts cite nothing when the model cited nothing
  });

  test("a knowledge-base outage during round 0 does not stop research", async () => {
    const broken = new (class extends NullKnowledgeStore {
      override async search(): Promise<never> {
        throw new Error("atlas down");
      }
    })();
    const model = new ScriptedToolModel([toolCall("fetch_page", { url: "https://www.monash.edu/study/mit", focus: "fees" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, answer: "AUD 47,900 [1].", researchModel: model, tools: { fetcher: fetcher() }, knowledge: broken });
    const state = await run(graph, "fees?");
    expect(state.meta.retrievalError).toBe(true);
    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]).toMatchObject({ n: 1, live: true });
    expect(state.sources[0]?.n).toBe(1);
  });

  test("streamEvents exposes tool start/end events for the UI", async () => {
    const model = new ScriptedToolModel([toolCall("search_knowledge_base", { query: "fees" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: lookup, researchModel: model });
    const seen: { event: string; name: string }[] = [];
    for await (const ev of graph.streamEvents({ input: "fees?", history: [], sessionId: "s", profile: null }, { version: "v2", runName: "chat" })) {
      if (ev.event === "on_tool_start" || ev.event === "on_tool_end" || (ev.event === "on_chain_start" && ["classify", "research", "generate"].includes(ev.name))) {
        seen.push({ event: ev.event, name: ev.name });
      }
    }
    expect(seen).toEqual([
      { event: "on_chain_start", name: "classify" },
      { event: "on_chain_start", name: "research" },
      { event: "on_tool_start", name: "search_knowledge_base" },
      { event: "on_tool_end", name: "search_knowledge_base" },
      { event: "on_chain_start", name: "generate" },
    ]);
    expect(sampleChunk(1).matchedBy).toEqual(["vector"]);
  });

  describe("research reasoning", () => {
    // DeepSeek via OpenRouter: each round's reasoning rides in additional_kwargs.reasoning_content.
    const thinking = (msg: AIMessage, text: string) => {
      msg.additional_kwargs.reasoning_content = text;
      return msg;
    };
    const script = () => [
      thinking(toolCall("search_knowledge_base", { query: "Monash MIT fees" }), "Check our KB for the fee first."),
      thinking(new AIMessage({ content: "sufficient" }), "The KB has it; no web search needed."),
    ];

    for (const streamReasoning of [false, true]) {
      test(`each round's thought lands before that round's lookups (${streamReasoning ? "streamed" : "invoked"})`, async () => {
        const { graph } = fakeGraph({ intent: lookup, researchModel: new ScriptedToolModel(script()), research: { streamReasoning } });
        const seen: string[] = [];
        let final: { researchTrace?: { thoughts?: unknown } } | undefined;
        for await (const ev of graph.streamEvents({ input: "fees?", history: [], sessionId: "s", profile: null }, { version: "v2", runName: "chat" })) {
          if (ev.event === "on_custom_event" && ev.name === "edge:thinking") seen.push(`think:${(ev.data as { chunk: string }).chunk}`);
          if (ev.event === "on_tool_start") seen.push(`tool:${ev.name}`);
          if (ev.event === "on_chain_end" && ev.name === "chat") final = ev.data?.output as typeof final;
        }
        expect(seen).toEqual(["think:Check our KB for the fee first.", "tool:search_knowledge_base", "think:The KB has it; no web search needed."]);
        expect(final?.researchTrace?.thoughts).toEqual([
          { at: 0, text: "Check our KB for the fee first." },
          { at: 1, text: "The KB has it; no web search needed." },
        ]);
      });
    }

    test("a streamed OpenRouter round keeps tool calls that arrive in chunks (an AIMessageChunk is also an AIMessage)", async () => {
      // How DeepSeek on OpenRouter streams a tool call: reasoning first, the call's name and its
      // arguments in pieces, then an empty finishing chunk. In @langchain/core 1.x an
      // AIMessageChunk passes `instanceof AIMessage`, so treating it as a whole message kept only
      // the last, empty chunk and lost every tool call (seen live in prod: CRM "not connected").
      let round = 0;
      const chunked = {
        bindTools() {
          return this;
        },
        async stream() {
          round++;
          const first = round === 1;
          return (async function* () {
            yield new AIMessageChunk({ content: "", additional_kwargs: { reasoning_content: first ? "Look up the fee." : "Enough." } });
            if (first) {
              yield new AIMessageChunk({ content: "", tool_call_chunks: [{ name: "search_knowledge_base", args: '{"query":', id: "call-1", index: 0, type: "tool_call_chunk" }] });
              yield new AIMessageChunk({ content: "", tool_call_chunks: [{ args: '"Monash MIT fees"}', index: 0, type: "tool_call_chunk" }] });
            } else {
              yield new AIMessageChunk({ content: "sufficient" });
            }
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: first ? "tool_calls" : "stop" } });
          })();
        },
      };
      const { graph } = fakeGraph({ intent: lookup, researchModel: chunked as never, research: { streamReasoning: true } });

      const state = await graph.invoke({ input: "fees?", history: [], sessionId: "s", profile: null });

      expect(state.researchTrace?.toolCalls.map((c) => [c.tool, c.args])).toEqual([["search_knowledge_base", { query: "Monash MIT fees" }]]);
      expect(state.researchTrace?.notes).toBe("sufficient");
    });

    test("a model that gives no reasoning leaves no thoughts", async () => {
      const { graph } = fakeGraph({ intent: lookup, researchModel: new ScriptedToolModel([toolCall("search_knowledge_base", { query: "q" })]) });
      const state = await run(graph, "fees?");
      expect(state.researchTrace?.thoughts).toBeUndefined();
    });

    test("streamed rounds still run the tools the model chose", async () => {
      const model = new ScriptedToolModel(script());
      const { graph } = fakeGraph({ intent: lookup, researchModel: model, research: { streamReasoning: true } });
      const state = await run(graph, "fees?");
      expect(state.researchTrace?.toolCalls.map((c) => c.tool)).toEqual(["search_knowledge_base"]);
      expect(state.researchTrace?.rounds).toBe(2);
    });
  });
});

describe("CRM write tools in the research loop", () => {
  const caseload = intentOf({ primary_intent: "caseload_management", user_question: "Update Jane's phone to 0411 111 111", task: "lookup", needs_research: true });
  const WRITE_TOOL: CrmToolDescriptor = {
    name: "crm_update_contact",
    description: "Change a contact's details.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, phone: { type: "string" } } } as never,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
  const preview = (id: string) => ({
    tool: "crm_update_contact",
    target: { entity: "contact", id, label: `Contact ${id}` },
    changes: [{ field: "phone", label: "Phone", before: "0400 000 000", after: "0411 111 111" }],
    version: "2026-09-01T00:00:00.000Z",
  });

  /** A CRM that answers dry runs with a preview; records every call, with its meta. */
  const writableCrm = () => {
    const calls: { name: string; args: Record<string, unknown>; opts?: CrmCallOptions }[] = [];
    const answer = (_n: string, args: Record<string, unknown>, o?: CrmCallOptions): CrmToolResult =>
      o?.meta?.["heubert/dryRun"] ? { text: "preview", isError: false, structured: { preview: preview(String(args.id)) } } : { text: "Contact updated.", isError: false };
    const toolset = fakeToolset(answer, (name, args, opts) => calls.push({ name, args, ...(opts ? { opts } : {}) }), [CRM_READ_TOOL, WRITE_TOOL]);
    const provider: CrmProvider = { forActor: async () => toolset };
    return { calls, provider };
  };
  const writes = () => {
    const store = new InMemoryCrmWriteProposalStore();
    return { store, service: new CrmWriteService({ store, crm: { forActor: async () => undefined }, logger: createLogger({ test: true }) }) };
  };
  const invoke = (graph: ReturnType<typeof fakeGraph>["graph"]) =>
    graph.invoke({ input: "Update Jane's phone", history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com" }, { metadata: { requestId: "req-7", sessionId: "sess-7" } });

  test("a write call is dry-run and stored as a proposal, never executed", async () => {
    const crm = writableCrm();
    const w = writes();
    const model = new ScriptedToolModel([toolCall("crm_update_contact", { id: "c1", phone: "0411 111 111" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, crmProvider: crm.provider, crmWrites: w.service });

    const state = await invoke(graph);

    expect(crm.calls).toEqual([{ name: "crm_update_contact", args: { id: "c1", phone: "0411 111 111" }, opts: { meta: { "heubert/dryRun": true } } }]);
    expect(crm.calls.filter((c) => !c.opts?.meta)).toHaveLength(0);
    // The ids come from the run metadata the tool call inherits from the graph's config.
    const stored = await w.store.listForSession("sess-7");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ requestId: "req-7", sessionId: "sess-7", status: "pending", actorEmail: "jane@heubert.com" });
    const toolMsg = model.seen[1]!.find((m) => m instanceof ToolMessage)!;
    expect(String(toolMsg.content)).toStartWith("PROPOSED, NOT APPLIED");
    expect(String(toolMsg.content)).toContain(stored[0]!.id);
    // A proposal is not evidence.
    expect(state.evidence.filter((e) => e.kind === "crm")).toHaveLength(0);
  });

  test("the answer model is told which CRM changes were proposed and not applied", async () => {
    const crm = writableCrm();
    const w = writes();
    const model = new ScriptedToolModel([toolCall("crm_update_contact", { id: "c1", phone: "0411 111 111" }), new AIMessage({ content: "sufficient" })]);
    const answerModel = new ScriptedToolModel([new AIMessage({ content: "I've proposed the change." })]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, answerModel: answerModel as never, crmProvider: crm.provider, crmWrites: w.service });

    const state = await invoke(graph);

    expect(state.researchTrace?.proposals).toEqual(["crm_update_contact on Contact c1: Phone 0400 000 000 → 0411 111 111"]);
    const system = String(answerModel.seen[0]![0]!.content);
    expect(system).toContain("crm_update_contact on Contact c1: Phone 0400 000 000 → 0411 111 111");
    expect(system).not.toContain("{{crm_write_proposals}}");
  });

  test("with no proposal the answer model is told none were made", async () => {
    const answerModel = new ScriptedToolModel([new AIMessage({ content: "Here you go [1]." })]);
    const { graph } = fakeGraph({ intent: caseload, answerModel: answerModel as never });

    await graph.invoke({ input: "What's overdue?", history: [], sessionId: "s1", profile: null, actorEmail: null });

    expect(String(answerModel.seen[0]![0]!.content)).toMatch(/CRM changes proposed this turn[^\n]*: none/);
  });

  test("two write calls in one round make two proposals", async () => {
    const crm = writableCrm();
    const w = writes();
    const model = new ScriptedToolModel([
      toolCalls([
        { name: "crm_update_contact", args: { id: "c1", phone: "0411 111 111" } },
        { name: "crm_update_contact", args: { id: "c2", phone: "0411 111 111" } },
      ]),
      new AIMessage({ content: "sufficient" }),
    ]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, crmProvider: crm.provider, crmWrites: w.service });

    await invoke(graph);

    expect((await w.store.listForSession("sess-7")).map((p) => p.preview.target.id).sort()).toEqual(["c1", "c2"]);
    expect(crm.calls.every((c) => c.opts?.meta?.["heubert/dryRun"] === true)).toBe(true);
  });

  test("a refused dry run reaches the model as an error and stores nothing", async () => {
    const w = writes();
    const toolset = fakeToolset({ text: "crm_update_contact failed: not visible", isError: true }, undefined, [CRM_READ_TOOL, WRITE_TOOL]);
    const model = new ScriptedToolModel([toolCall("crm_update_contact", { id: "c9" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, crmProvider: { forActor: async () => toolset }, crmWrites: w.service });

    const state = await invoke(graph);

    expect(String(model.seen[1]!.find((m) => m instanceof ToolMessage)!.content)).toStartWith("error: crm_update_contact failed: not visible");
    expect(state.researchTrace?.toolCalls[0]).toMatchObject({ tool: "crm_update_contact", ok: false });
    expect(await w.store.listForSession("sess-7")).toEqual([]);
  });

  test("without crmWrites a write tool is never offered, and reads still are", async () => {
    const crm = writableCrm();
    const model = new ScriptedToolModel([toolCall("crm_update_contact", { id: "c1" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, crmProvider: crm.provider });

    const state = await invoke(graph);

    expect(state.meta.toolsOffered).toEqual(["search_knowledge_base", "crm_search_contacts"]);
    expect(crm.calls).toHaveLength(0);
    expect(String(model.seen[1]!.find((m) => m instanceof ToolMessage)!.content)).toContain("unknown tool crm_update_contact");
  });

  test("a streamed turn hands each proposal to onCrmWriteProposal", async () => {
    const crm = writableCrm();
    const w = writes();
    const model = new ScriptedToolModel([toolCall("crm_update_contact", { id: "c1", phone: "0411 111 111" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: caseload, researchModel: model, crmProvider: crm.provider, crmWrites: w.service, answer: "I proposed the phone change below." });
    const chat = new ChatService({ env: testEnv(), graph, store: new InMemoryChatStore(), logger: createLogger({ test: true }), crmWrites: w.service });
    const seen: CrmWriteProposalView[] = [];

    const result = await chat.chat({ message: "Update Jane's phone", ownerId: "jane@heubert.com", requestId: "req-9", route: "/v1/chat/stream", onCrmWriteProposal: (v) => seen.push(v) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ requestId: "req-9", tool: "crm_update_contact", status: "pending", target: { id: "c1" } });
    expect((await w.store.get(seen[0]!.proposalId))!.sessionId).toBe(result.sessionId);
  });
});

describe("Gmail and Drive in the research loop", () => {
  const read = { readOnlyHint: true } as const;
  const gmail: CrmToolset = {
    actor: "jane@heubert.com",
    descriptors: [
      { name: "gmail_search_threads", title: "Gmail search", description: "Search your Gmail", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: read },
      { name: "gmail_create_draft", title: "Gmail draft", description: "Create a draft", inputSchema: { type: "object", properties: { to: { type: "string" }, body: { type: "string" } } }, annotations: { readOnlyHint: false } },
    ],
    call: async () => ({ text: "Thread 18c2f: Monash — CoE issued for Priya, 12 Sept.", structured: { threadId: "18c2f00aa1b2c3d4" }, isError: false }),
    refresh: async () => {},
  };
  const drive: CrmToolset = {
    actor: "jane@heubert.com",
    descriptors: [{ name: "drive_search_files", title: "Drive search", description: "Search your Drive", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: read }],
    call: async () => ({ text: "Offer letter.pdf", isError: false }),
    refresh: async () => {},
  };
  const asJane = (graph: ReturnType<typeof fakeGraph>["graph"], input: string) => graph.invoke({ input, history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com" });
  const connected = { forActor: async () => ({ gmail, drive, status: { gmail: "connected", drive: "connected", calendar: "not_connected", docs: "not_connected" } as const }), forget: () => {} };

  test("a connected consultant is offered their Gmail and Drive reads, cited as gmail evidence", async () => {
    const model = new ScriptedToolModel([toolCall("gmail_search_threads", { query: "from:monash CoE" }), new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "offer_enrolment", user_question: "Did Monash email about Priya's CoE?", needs_research: true }),
      researchModel: model,
      workspaceProvider: connected,
    });
    const state = await asJane(graph, "Did Monash email about Priya's CoE?");
    expect(state.meta.toolsOffered).toEqual(expect.arrayContaining(["gmail_search_threads", "drive_search_files"]));
    // Without a draft approval service the write is never offered.
    expect(state.meta.toolsOffered).not.toContain("gmail_create_draft");
    const mail = state.evidence.find((e) => e.kind === "gmail");
    expect(mail?.source).toBe("gmail");
    expect(mail?.webUrl).toContain("mail.google.com");
    expect(state.researchTrace?.workspace).toEqual({ gmail: "connected", drive: "connected", calendar: "not_connected", docs: "not_connected" });
  });

  test("an unconnected consultant gets no Google tools and the answer prompt says so", async () => {
    const provider = { forActor: async () => ({ status: { gmail: "not_connected", drive: "reauth_required", calendar: "not_connected", docs: "not_connected" } as const }), forget: () => {} };
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "offer_enrolment", user_question: "Did Monash email?", needs_research: true }),
      researchModel: new ScriptedToolModel([new AIMessage({ content: "sufficient" })]),
      workspaceProvider: provider,
    });
    const state = await asJane(graph, "Did Monash email?");
    expect((state.meta.toolsOffered as string[]).some((t) => t.startsWith("gmail_") || t.startsWith("drive_"))).toBe(false);
    expect(state.researchTrace?.workspace).toEqual({ gmail: "not_connected", drive: "reauth_required", calendar: "not_connected", docs: "not_connected" });
  });

  test("a mailbox request the classifier would answer without research still reaches the research loop", async () => {
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({
      intent: intentOf({ primary_intent: "general_inquiry", task: "draft", user_question: "Draft a reply to her email", needs_research: false }),
      researchModel: model,
      workspaceProvider: connected,
    });
    const state = await asJane(graph, "Draft a reply to her email");
    expect(state.researchTrace).toBeTruthy();
    expect(state.meta.toolsOffered).toContain("gmail_search_threads");
  });
});
