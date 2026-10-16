import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { ChatService } from "../src/app/service";
import type { StudentSnapshot } from "../src/crm/student";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { CountryScriptedModel, RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const visaAu = intentOf({ primary_intent: "visa_process", destinations: ["australia"], user_question: "What does a subclass 500 application need?", task: "lookup", needs_research: true });

/** One turn; returns the research prompt, the answer prompt, the round-0 queries and the final state. */
async function turn(opts: { input: string; intent?: ReturnType<typeof intentOf>; skillPacks?: boolean; marketPacks?: boolean; extra?: Record<string, unknown> }) {
  const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
  const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1), sampleChunk(2)]);
  const { graph } = fakeGraph({ intent: opts.intent ?? visaAu, researchModel: model, knowledge, skillPacks: opts.skillPacks, marketPacks: opts.marketPacks });
  const state = await graph.invoke({ input: opts.input, history: [], sessionId: "s1", profile: null, ...opts.extra });
  return { state, research: String(model.seen[0]![0]!.content), answer: String(state.meta.systemPromptText), queries: knowledge.queries };
}

type MetaRoute = { origin?: string | null; originSource?: string | null; marketPack?: string; packs?: string[] };

describe("market packs in the turn", () => {
  test("on: an AU visa question from a Nepali student gets country AND Nepal market guidance", async () => {
    const { state, research, answer, queries } = await turn({ input: "Nepali student, bachelor done, what does she need for the AU 500 visa?", skillPacks: true });
    expect(state.route).toMatchObject({ countries: ["australia"], origin: "nepal", originSource: "keywords" });
    expect(answer).toContain("# Country guidance");
    expect(answer).toContain("# Market guidance (student from Nepal)");
    // The request line names the routed market when the classifier gave no origin.
    expect(answer).toContain("Student's country/location: Nepal |");
    expect(answer).toContain("No Objection Certificate");
    expect(answer.indexOf("# Country guidance")).toBeLessThan(answer.indexOf("# Market guidance"));
    expect(answer.indexOf("# Market guidance")).toBeLessThan(answer.indexOf("\n# Task playbook\n"));
    expect(research).toContain("# Country brief");
    expect(research).toContain("# Student market");
    expect(research).toContain("moest.gov.np");
    expect(research.indexOf("# Country brief")).toBeLessThan(research.indexOf("# Student market"));
    expect(research.indexOf("# Student market")).toBeLessThan(research.indexOf("\n# Tools\n"));
    const route = state.meta.route as MetaRoute;
    expect(route).toMatchObject({ origin: "nepal", originSource: "keywords", marketPack: "nepal@2026-10-08b", packs: [expect.stringMatching(/^australia@/)] });
    // Round 0: six destination terms, then at most two market terms.
    const market = state.skills!.market!;
    expect(queries[0]!.text.endsWith(market.vocabulary.slice(0, 2).join("; "))).toBe(true);
  });

  test("on: a Thai student gets Thailand market guidance; Thailand is not a destination", async () => {
    const { state, answer } = await turn({ input: "A Thai student wants to study in Australia: visa steps?", skillPacks: true });
    expect(state.route?.countries).toEqual(["australia"]);
    expect(state.route?.origin).toBe("thailand");
    expect(answer).toContain("# Market guidance (student from Thailand)");
    expect(answer).toContain("write it in Thai.");
  });

  test("on: no origin → no market section, no market pack on the route", async () => {
    const { state, research, answer } = await turn({ input: "Student visa checklist for Australia?", skillPacks: true });
    expect(state.route).toMatchObject({ origin: null, originSource: null });
    expect(state.skills?.market).toBeUndefined();
    expect(answer).toContain("# Country guidance");
    expect(answer).not.toContain("# Market guidance");
    expect(research).not.toContain("# Student market");
    expect((state.meta.route as MetaRoute).marketPack).toBeUndefined();
  });

  test("off: the origin is still routed but nothing is loaded", async () => {
    const { state, answer, research } = await turn({ input: "Nepali student, AU 500 visa steps?" });
    expect(state.route?.origin).toBe("nepal");
    expect(state.skills).toBeNull();
    expect(answer).not.toContain("# Market guidance");
    expect(research).not.toContain("# Student market");
    expect(state.meta.route).toEqual(state.route);
  });

  test("MARKET_PACKS_ENABLED: unset or empty follows SKILL_PACKS_ENABLED, otherwise a boolean", () => {
    expect(testEnv().MARKET_PACKS_ENABLED).toBeUndefined();
    expect(testEnv({ MARKET_PACKS_ENABLED: "" }).MARKET_PACKS_ENABLED).toBeUndefined();
    expect(testEnv({ MARKET_PACKS_ENABLED: "true" }).MARKET_PACKS_ENABLED).toBe(true);
    expect(testEnv({ MARKET_PACKS_ENABLED: "off" }).MARKET_PACKS_ENABLED).toBe(false);
  });

  test("MARKET_PACKS_ENABLED can be turned off on its own", async () => {
    const { answer } = await turn({ input: "Nepali student, AU 500 visa steps?", skillPacks: true, marketPacks: false });
    expect(answer).toContain("# Country guidance");
    expect(answer).not.toContain("# Market guidance");
  });

  test("a market loads without any destination pack (no country, or one without a pack)", async () => {
    const intent = intentOf({ primary_intent: "financial_viability", user_question: "Education loan options?", needs_research: true });
    const { state, answer, research } = await turn({ input: "Education loan options for an Indian student?", intent, skillPacks: true });
    expect(state.skills).toMatchObject({ packs: [], versions: [] });
    expect(state.skills?.market?.market).toBe("india");
    expect(answer).not.toContain("# Country guidance");
    expect(answer).toContain("# Market guidance (student from India)");
    expect(research).toContain("# Student market");
    expect(research).not.toContain("# Country brief");
    const route = state.meta.route as MetaRoute;
    expect(route.marketPack).toBe("india@2026-10-08b");
    expect(route.packs).toBeUndefined();
  });

  test("a guided student's CRM nationality is the origin, and the classifier's origin is the fallback", async () => {
    const snapshot: StudentSnapshot = {
      contactId: "C1",
      name: "Sita Sharma",
      status: "Lead",
      nationality: "Nepal",
      country: "Nepal",
      city: "Kathmandu",
      countryOfPassport: "Nepal",
      visaType: null,
      branch: null,
      assignee: null,
      deals: [],
      education: [],
      testScores: [],
      preferredIntake: null,
      financial: null,
      applications: [],
      available: { contact: true, deals: true, education: true, tests: true, financial: true, intake: true, applications: false },
      via: "composed",
      fetchedAt: "2026-10-08T00:00:00.000Z",
      webUrl: null,
    };
    const guided = await turn({ input: "Bangladeshi friend asked too, but what does Sita need for the AU visa?", skillPacks: true, extra: { guide: { step: "visa", stepsDone: [], contactId: "C1", snapshot, record: null } } });
    expect(guided.state.route).toMatchObject({ origin: "nepal", originSource: "crm" });
    const classified = await turn({ input: "AU 500 visa steps?", intent: { ...visaAu, origin: "Sri Lanka" }, skillPacks: true });
    expect(classified.state.route).toMatchObject({ origin: "sri_lanka", originSource: "classifier" });
    expect(classified.answer).toContain("# Market guidance (student from Sri Lanka)");
  });

  test("the staff profile's office is the last fallback", async () => {
    const { state, answer } = await turn({ input: "AU 500 visa steps?", skillPacks: true, extra: { profile: { office: "Hanoi" } } });
    expect(state.route).toMatchObject({ origin: "vietnam", originSource: "profile" });
    expect(answer).toContain("# Market guidance (student from Vietnam)");
  });

  test("the same input compiles byte-identical prompts on every run", async () => {
    const a = await turn({ input: "Nepali student, AU 500 visa steps?", skillPacks: true });
    const b = await turn({ input: "Nepali student, AU 500 visa steps?", skillPacks: true });
    expect(a.research).toBe(b.research);
    expect(a.answer).toBe(b.answer);
  });

  test("comparison fan-out: every branch gets the same market brief", async () => {
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new AIMessage({ content: "sufficient" })] });
    const intent = intentOf({ primary_intent: "visa_process", task: "compare", destinations: ["australia", "canada"], user_question: "AU vs CA visa", needs_research: true });
    const { graph } = fakeGraph({ intent, researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), skillPacks: true, research: { compareFanout: true } });
    await graph.invoke({ input: "Filipina nurse: student visa Australia vs Canada?", history: [], sessionId: "s1", profile: null });
    const au = String(model.seen.Australia![0]![0]!.content);
    const ca = String(model.seen.Canada![0]![0]!.content);
    const brief = (p: string) => p.slice(p.indexOf("# Student market"), p.indexOf("\n# Tools\n"));
    expect(au).toContain("# Student market");
    expect(brief(au)).toContain("The student is from the Philippines.");
    expect(brief(au)).toContain("dfa.gov.ph");
    expect(brief(au)).toBe(brief(ca));
  });

  test("the chat service stores the origin and a follow-up inherits it", async () => {
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const intents = [intentOf({ primary_intent: "visa_process", destinations: ["australia"], needs_research: true }), intentOf({ primary_intent: "financial_viability", needs_research: true })];
    let i = 0;
    const { graph } = fakeGraph({ intent: intents[0]!, classifier: RunnableLambda.from(async () => intents[i++]!), research: { maxRounds: 0 }, knowledge, answer: "ok [1]", skillPacks: true });
    const store = new InMemoryChatStore();
    const chat = new ChatService({ env: testEnv(), graph, store, logger: createLogger({ test: true }) });
    const first = await chat.chat({ message: "Bangladeshi student, AU visa steps?", ownerId: "jane@heubert.com", requestId: "r1", route: "/v1/chat" });
    await chat.chat({ message: "and the fees?", ownerId: "jane@heubert.com", requestId: "r2", route: "/v1/chat", sessionId: first.sessionId });
    const stored = await store.getMessages(first.sessionId, 10);
    expect(stored[1]!.metadata?.route).toEqual({ countries: ["australia"], mode: "single", origin: "bangladesh" });
    expect(stored[3]!.metadata?.route).toEqual({ countries: ["australia"], mode: "single", origin: "bangladesh" });
  });
});
