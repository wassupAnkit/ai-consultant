import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import type { CrmProvider, CrmToolDescriptor, CrmToolResult } from "../src/crm/client";
import { createDemoCrmProvider } from "../src/crm/demo";
import { crmStudentFromReads, pendingStudentOverview, type CrmRead } from "../src/crm/student";
import type { CounsellorRegion } from "../src/routing/markets";
import { rerouteEvidence } from "../src/graph/reroute-evidence";
import { decideRoute, withCrmStudent, type CrmStudentRef } from "../src/routing/route";
import { marketGuideExcerpts } from "../src/skills/market-guides";
import { EvidenceCollector } from "../src/tools/evidence";
import { CRM_READ_TOOL, fakeToolset, RecordingKnowledgeStore, ScriptedToolModel, toolCall, toolCalls } from "./fakes";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

const tool = (name: string): CrmToolDescriptor => ({ ...CRM_READ_TOOL, name, title: name, description: `${name} (test CRM)`, inputSchema: { type: "object", properties: { id: { type: "string" }, query: { type: "string" } } } as never });
const DESCRIPTORS = [tool("crm_search_contacts"), tool("crm_get_contact"), tool("crm_get_student_overview"), tool("crm_get_deal")];

const rahim = { id: "C9", name: "Rahim Uddin", status: "Lead", nationality: "Bangladesh", country: "Bangladesh", city: "Dhaka", countryOfPassport: "Bangladesh", branch: { name: "Kathmandu (Putalisadak)" } };
const anjali = { id: "C7", name: "Anjali Thapa", status: "Lead", nationality: "Nepal", country: "Nepal" };
const rahimDeal = { id: "D1", name: "Rahim — Canada", status: "in-progress", interestedService: "Admission", countries: ["Canada"], services: ["Visa"], contact: { id: "C9", name: "Rahim Uddin" } };

/** The test CRM: Rahim's overview lists deal D1 (Canada); Anjali is another contact. */
function crmAnswer(name: string, args: Record<string, unknown>): CrmToolResult {
  const ok = (structured: Record<string, unknown>): CrmToolResult => ({ text: `${name} ${JSON.stringify(args)}`, structured, isError: false });
  if (name === "crm_search_contacts") return ok({ contacts: [{ id: "C9", name: "Rahim Uddin" }] });
  if (name === "crm_get_student_overview" && args.id === "C9") return ok({ contact: rahim, deals: [{ id: "D1", name: "Rahim — Canada", status: "in-progress" }], applications: [] });
  if (name === "crm_get_contact") return ok({ contact: args.id === "C7" ? anjali : rahim });
  if (name === "crm_get_deal" && args.id === "D1") return ok({ deal: rahimDeal });
  return { text: "not visible", isError: true };
}
const provider: CrmProvider = { forActor: async (email) => (email ? fakeToolset((name, args) => crmAnswer(name, args), undefined, DESCRIPTORS, email) : undefined) };

const read = (tool: string, args: Record<string, unknown>): CrmRead => ({ tool, args, structured: crmAnswer(tool, args).structured });
const nepalCounsellor: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };

describe("crmStudentFromReads", () => {
  test("the overview's student: nationality → market, their deals' countries → destinations", () => {
    expect(crmStudentFromReads([read("crm_search_contacts", { query: "Rahim" }), read("crm_get_student_overview", { id: "C9" }), read("crm_get_deal", { id: "D1" })])).toEqual({ contactId: "C9", name: "Rahim Uddin", origin: "bangladesh", destinations: ["canada"] });
  });

  test("the last overview wins when several contacts were read", () => {
    expect(crmStudentFromReads([read("crm_get_contact", { id: "C7" }), read("crm_get_student_overview", { id: "C9" })])?.contactId).toBe("C9");
  });

  test("several contacts without an overview: no student", () => {
    expect(crmStudentFromReads([read("crm_get_contact", { id: "C7" }), read("crm_get_contact", { id: "C9" })])).toBeNull();
  });

  test("a single contact read is enough; a deal that is not theirs does not count", () => {
    const other = { tool: "crm_get_deal", args: { id: "D2" }, structured: { deal: { ...rahimDeal, id: "D2", countries: ["Australia"], contact: { id: "C7" } } } };
    expect(crmStudentFromReads([read("crm_get_contact", { id: "C9" }), other])).toEqual({ contactId: "C9", name: "Rahim Uddin", origin: "bangladesh", destinations: [] });
  });

  test("passport, then country of residence, when nationality is blank; lost deals are ignored", () => {
    const overview = { tool: "crm_get_student_overview", args: { id: "C5" }, structured: { contact: { id: "C5", nationality: null, countryOfPassport: "LKA", country: "Australia" }, deals: [{ id: "D5", status: "lost", countries: ["UK"] }] } };
    expect(crmStudentFromReads([overview])).toEqual({ contactId: "C5", origin: "sri_lanka", destinations: [] });
  });

  test("the overview's own deal countries count without a crm_get_deal read (crm-api's overview shape)", () => {
    const overview = { tool: "crm_get_student_overview", args: { id: "C4" }, structured: { contact: { id: "C4", nationality: "Nepal" }, deals: [{ id: "D4", name: "Study abroad", status: "in-progress", countries: ["Australia", "united kingdom"] }] } };
    expect(crmStudentFromReads([overview])).toEqual({ contactId: "C4", origin: "nepal", destinations: ["australia", "united_kingdom"] });
  });

  test("the demo CRM's overview names Sita's deal countries, like crm-api's", async () => {
    const crm = (await createDemoCrmProvider().forActor("demo@heubert.com"))!;
    const id = "0e7c1a52-3f41-4c1e-9a55-1b2f3c4d5e61";
    const res = await crm.call("crm_get_student_overview", { id });
    expect(res.text).toContain("Deals (1): Sita — Study abroad [in-progress] (5a0f2b33-7c44-4d2e-8f10-2a3b4c5d6e71) → Australia, Canada");
    expect(res.structured?.deals).toEqual([{ id: "5a0f2b33-7c44-4d2e-8f10-2a3b4c5d6e71", name: "Sita — Study abroad", status: "in-progress", countries: ["Australia", "Canada"] }]);
    expect(crmStudentFromReads([{ tool: "crm_get_student_overview", args: { id }, structured: res.structured }])).toMatchObject({ contactId: id, origin: "nepal", destinations: ["australia", "canada"] });
  });

  test("pendingStudentOverview: one found-but-unopened contact; none after an overview or with several matches", () => {
    expect(pendingStudentOverview([read("crm_search_contacts", { query: "Rahim" })])).toBe("C9");
    expect(pendingStudentOverview([read("crm_get_contact", { id: "C7" })])).toBe("C7");
    expect(pendingStudentOverview([read("crm_search_contacts", { query: "Rahim" }), read("crm_get_student_overview", { id: "C9" })])).toBeNull();
    expect(pendingStudentOverview([read("crm_get_contact", { id: "C7" }), read("crm_get_contact", { id: "C9" })])).toBeNull();
    expect(pendingStudentOverview([{ tool: "crm_search_contacts", args: { query: "a" }, structured: { contacts: [{ id: "C1" }, { id: "C2" }] } }])).toBeNull();
    expect(pendingStudentOverview([])).toBeNull();
  });

  test("application countries count; a contact with nothing to route on is still the turn's student; no contact is null", () => {
    const overview = { tool: "crm_get_student_overview", args: { id: "C6" }, structured: { contact: { id: "C6" }, deals: [], applications: [{ id: "A1", institution: { name: "Monash", country: "Australia" } }] } };
    expect(crmStudentFromReads([overview])).toEqual({ contactId: "C6", origin: null, destinations: ["australia"] });
    expect(crmStudentFromReads([{ tool: "crm_get_student_overview", args: { id: "C8" }, structured: { contact: { id: "C8" } } }])).toEqual({ contactId: "C8", origin: null, destinations: [] });
    expect(crmStudentFromReads([])).toBeNull();
  });
});

describe("withCrmStudent", () => {
  const visa = intentOf({ primary_intent: "visa_process" });
  const student: CrmStudentRef = { contactId: "C9", origin: "bangladesh", destinations: ["canada"] };

  test("the student's market replaces the counsellor default; their destinations fill an empty route", () => {
    const route = decideRoute({ intent: visa, extras: null, input: "What does Rahim need for his visa?", history: [], counsellorRegion: nepalCounsellor });
    expect(withCrmStudent(route, student, visa)).toMatchObject({ countries: ["canada"], countrySource: ["crm"], mode: "single", origin: "bangladesh", originSource: "crm", crmStudent: student });
  });

  test("an explicitly named nationality stays; the message's countries come first", () => {
    const route = decideRoute({ intent: intentOf({ primary_intent: "visa_process", destinations: ["australia"] }), extras: null, input: "Thai student Rahim, Australia visa?", history: [] });
    expect(withCrmStudent(route, student, visa)).toMatchObject({ countries: ["australia", "canada"], countrySource: ["classifier", "crm"], origin: "thailand", originSource: "keywords" });
  });

  test("a comparison request over the union is a comparison", () => {
    const compare = intentOf({ primary_intent: "visa_process", task: "compare", destinations: ["australia"] });
    const route = decideRoute({ intent: compare, extras: null, input: "Australia or what is on his file?", history: [] });
    expect(withCrmStudent(route, student, compare).mode).toBe("comparison");
  });
});

describe("a named CRM student in the turn", () => {
  const visa = intentOf({ primary_intent: "visa_process", destinations: [], user_question: "What does Rahim need for his student visa?", task: "lookup", needs_research: true });

  async function turn(input: string, script: AIMessage[]) {
    const model = new ScriptedToolModel(script);
    const { graph } = fakeGraph({ intent: visa, researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), crmProvider: provider, skillPacks: true });
    const state = await graph.invoke({ input, history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com", counsellorRegion: nepalCounsellor });
    return { state, answer: String(state.meta.systemPromptText) };
  }
  const lookups = () => [toolCall("crm_search_contacts", { query: "Rahim" }), toolCalls([{ name: "crm_get_student_overview", args: { id: "C9" } }, { name: "crm_get_deal", args: { id: "D1" } }]), new AIMessage({ content: "sufficient" })];

  test("the student's record (Bangladesh, a Canada deal) decides the packs, not the Nepal counsellor", async () => {
    const { state, answer } = await turn("What does Rahim Uddin need for his student visa?", lookups());
    expect(state.crmStudent).toEqual({ contactId: "C9", name: "Rahim Uddin", origin: "bangladesh", destinations: ["canada"] });
    expect(state.route).toMatchObject({ countries: ["canada"], origin: "bangladesh", originSource: "crm" });
    expect(answer).toContain("# Country guidance");
    expect(answer).toContain("## Canada");
    expect(answer).toContain("# Market guidance (student from Bangladesh)");
    expect(answer).not.toContain("# Market guidance (student from Nepal)");
    expect(answer).toContain("Student's country/location: Bangladesh |");
    expect(answer).toContain("Destinations mentioned: Canada |");
    const route = state.meta.route as Record<string, unknown>;
    expect(route).toMatchObject({ origin: "bangladesh", originSource: "crm", countries: ["canada"], crmStudent: { contactId: "C9", origin: "bangladesh", destinations: ["canada"] }, marketPack: expect.stringMatching(/^bangladesh@/), packs: [expect.stringMatching(/^canada@/)] });
  });

  test("an explicit nationality in the message still wins for the origin", async () => {
    const { state, answer } = await turn("Thai student Rahim Uddin: what does he need for his student visa?", lookups());
    expect(state.route).toMatchObject({ countries: ["canada"], origin: "thailand", originSource: "keywords" });
    expect(answer).toContain("# Market guidance (student from Thailand)");
  });

  test("a student the model found but never opened gets their overview read once, and still re-routes the answer", async () => {
    const { state, answer } = await turn("What does Rahim Uddin need for his student visa?", [toolCall("crm_search_contacts", { query: "Rahim" }), new AIMessage({ content: "sufficient" })]);
    expect(state.researchTrace?.toolCalls.map((c) => c.tool)).toEqual(["crm_search_contacts", "crm_get_student_overview"]);
    expect(state.researchTrace?.toolCalls.at(-1)).toMatchObject({ args: { id: "C9" }, ok: true });
    expect(state.meta.studentOverviewFollowUp).toBe(true);
    expect(state.crmStudent).toMatchObject({ contactId: "C9", origin: "bangladesh" });
    expect(answer).toContain("# Market guidance (student from Bangladesh)");
  });

  test("without a student read the counsellor's default stands", async () => {
    const { state, answer } = await turn("What does a student need for a Canada study permit?", [new AIMessage({ content: "sufficient" })]);
    expect(state.crmStudent).toBeNull();
    expect(state.route).toMatchObject({ origin: "nepal", originSource: "counsellor" });
    expect(answer).toContain("# Market guidance (student from Nepal)");
  });

  test("the same turn compiles the same prompt every time", async () => {
    const a = await turn("What does Rahim Uddin need for his student visa?", lookups());
    const b = await turn("What does Rahim Uddin need for his student visa?", lookups());
    expect(a.answer).toBe(b.answer);
  });
});

// Counsellor audit M9: round 0 chose the market-guide, compliance and facts excerpts for the route
// classify decided (the Nepal counsellor's default); the student's record moved the route.
describe("guide excerpts follow a CRM-student re-route", () => {
  const visa = intentOf({ primary_intent: "visa_process", destinations: [], user_question: "What does Rahim need for his student visa?", task: "lookup", needs_research: true });
  const lookups = () => [toolCall("crm_search_contacts", { query: "Rahim" }), toolCalls([{ name: "crm_get_student_overview", args: { id: "C9" } }, { name: "crm_get_deal", args: { id: "D1" } }]), new AIMessage({ content: "sufficient" })];

  async function turn(input: string, script: AIMessage[], research: { maxRounds?: number; maxEvidence?: number } = {}) {
    const { graph } = fakeGraph({
      intent: visa,
      researchModel: new ScriptedToolModel(script),
      knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]),
      crmProvider: provider,
      skillPacks: true,
      research: { maxRounds: 3, factsRegister: true, ...research },
    });
    const state = await graph.invoke({ input, history: [], sessionId: "s1", profile: null, actorEmail: "jane@heubert.com", counsellorRegion: nepalCounsellor });
    return { state, prompt: String(state.meta.systemPromptText) };
  }

  test("Nepal counsellor, Bangladeshi student with a Canada deal: Bangladesh guide and Canada facts in, Nepal excerpts out", async () => {
    const { state, prompt } = await turn("What does Rahim Uddin need for his student visa?", lookups());
    // Round 0 picked the Nepal guide for the counsellor's default route.
    expect((state.meta.round0MarketGuides as string[]).every((id) => id.startsWith("market-guide:nepal#"))).toBe(true);
    const sources = state.evidence.map((e) => e.source);
    expect(sources).toContain("market-guide:bangladesh");
    expect(state.evidence.some((e) => e.url === "market-guide://bangladesh#destinations-canada")).toBe(true);
    expect(sources).toContain("facts-register:canada");
    expect(sources).not.toContain("market-guide:nepal");
    expect(prompt).toContain('source="market-guide:bangladesh"');
    expect(prompt).toContain('source="facts-register:canada"');
    expect(prompt).not.toContain('source="market-guide:nepal"');
    expect(prompt).toContain("# Evidence after reading the student's record");
    expect(prompt).toContain("Excerpts and guidance tagged for Nepal do not apply to this student");
    // Numbers stay stable: the CRM reads keep theirs, the new excerpts come after the highest.
    const ns = state.evidence.map((e) => e.n);
    expect(new Set(ns).size).toBe(ns.length);
    const re = state.meta.rerouteEvidence as { added: string[]; removed: number[] };
    expect(re.removed.length).toBeGreaterThan(0);
    expect(re.added.some((id) => id.startsWith("market-guide:bangladesh#"))).toBe(true);
    expect(Math.min(...state.evidence.filter((e) => re.added.includes(e.id)).map((e) => e.n))).toBeGreaterThan(Math.max(...re.removed));
  });

  test("no re-route, no change", async () => {
    const { state, prompt } = await turn("What does a student need for a Canada study permit?", [new AIMessage({ content: "sufficient" })]);
    expect(state.meta.rerouteEvidence).toBeUndefined();
    expect(prompt).not.toContain("# Evidence after reading the student's record");
  });

  test("the evidence cap holds", async () => {
    const { state } = await turn("What does Rahim Uddin need for his student visa?", lookups(), { maxEvidence: 4 });
    expect(state.evidence.length).toBeLessThanOrEqual(4);
  });
});

describe("rerouteEvidence", () => {
  const visa = intentOf({ primary_intent: "visa_process", user_question: "What does Rahim need for his student visa?" });
  const before = decideRoute({ intent: visa, extras: null, input: "What does Rahim need for his visa?", history: [], counsellorRegion: nepalCounsellor });
  const seeded = () => {
    const c = new EvidenceCollector(24);
    c.add([sampleChunk(1)], "kb", false);
    c.add(marketGuideExcerpts({ market: "nepal", topic: "visa_process", countries: [] }), "kb", false);
    c.add([sampleChunk(2)], "kb", false);
    return c.items;
  };
  const args = { intent: visa, input: "What does Rahim need for his student visa?", maxEvidence: 24, factsRegister: true, complianceGuides: false };

  test("unchanged route → null", () => {
    expect(rerouteEvidence({ ...args, evidence: seeded(), before, after: before, market: "nepal" })).toBeNull();
  });

  test("a new market drops the old market's excerpts and numbers the new ones after the highest", () => {
    const evidence = seeded();
    const after = withCrmStudent(before, { contactId: "C9", origin: "bangladesh", destinations: ["canada"] }, visa);
    const out = rerouteEvidence({ ...args, evidence, before, after, market: "bangladesh" })!;
    const last = Math.max(...evidence.map((e) => e.n));
    expect(out.removed).toEqual(evidence.filter((e) => e.source === "market-guide:nepal").map((e) => e.n));
    expect(out.evidence.filter((e) => out.added.includes(e.id)).every((e) => e.n > last)).toBe(true);
    expect(out.evidence.find((e) => e.id === "chunk-2")!.n).toBe(evidence.find((e) => e.id === "chunk-2")!.n);
    expect(out.note).toContain("tagged for Nepal do not apply");
  });

  test("destinations only: the new country's guide block and facts, nothing removed, no market note", () => {
    const sameMarket = withCrmStudent(before, { contactId: "C7", origin: "nepal", destinations: ["canada"] }, visa);
    const out = rerouteEvidence({ ...args, evidence: seeded(), before, after: sameMarket, market: "nepal" })!;
    expect(out.removed).toEqual([]);
    expect(out.added).toContain("market-guide:nepal#destinations-canada");
    expect(out.added.some((id) => id.startsWith("facts-register:canada#"))).toBe(true);
    expect(out.note).not.toContain("do not apply");
  });

  test("a full collector adds nothing beyond maxEvidence", () => {
    const evidence = seeded();
    const after = withCrmStudent(before, { contactId: "C7", origin: "nepal", destinations: ["canada"] }, visa);
    const out = rerouteEvidence({ ...args, evidence, before, after, market: "nepal", maxEvidence: evidence.length })!;
    expect(out.evidence).toHaveLength(evidence.length);
    expect(out.added).toEqual([]);
  });
});
