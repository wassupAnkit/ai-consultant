import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { CONSULTANT_SYSTEM_PROMPT } from "../src/prompts/consultant";
import { citedSources, formatContext } from "../src/retrieval/format";
import { MARKETS, type CounsellorRegion } from "../src/routing/markets";
import {
  bestComplianceSection,
  COMPLIANCE_SLUGS,
  complianceDestination,
  complianceGuide,
  complianceGuideExcerpts,
  isComplianceQuestion,
  guidesNamedIn,
  parseComplianceGuide,
  searchComplianceGuides,
  sourceMarketSection,
} from "../src/skills/compliance-guides";
import { MARKET_GUIDE_EXCERPT_MAX } from "../src/skills/market-guides";
import { EvidenceCollector } from "../src/tools/evidence";
import { makeSearchComplianceGuidesTool } from "../src/tools/compliance";
import { RecordingKnowledgeStore, ScriptedToolModel, toolCalls } from "./fakes";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

const COMMISSION_Q = "A university is refusing to pay us commission for an onshore student who transferred to them after 5 months with another provider. How do I push back?";
const UK_MIGRATION_Q = "Our London office: can a counsellor tell a student which UK visa to switch to and whether her dependants qualify?";

describe("compliance guides: the shipped files", () => {
  test("all six load from data/compliance with numbered, keyworded sections and the research date", () => {
    for (const slug of COMPLIANCE_SLUGS) {
      const g = complianceGuide(slug);
      expect(g.updated).toBe("2026-10-09");
      expect(g.sections.length).toBeGreaterThanOrEqual(6);
      expect(g.sections.map((s) => s.number)).toEqual(g.sections.map((_, i) => i + 1));
      for (const s of g.sections) {
        expect(s.keywords.length).toBeGreaterThanOrEqual(5);
        expect(s.body).not.toContain("<!--");
        expect(s.body).not.toContain("\n### ");
        expect(s.body.length).toBeGreaterThan(300);
      }
    }
  });

  test("source-markets has one section per market, titled with its name", () => {
    for (const m of MARKETS) expect(sourceMarketSection(m)?.body.length ?? 0).toBeGreaterThan(300);
  });

  test("the runtime copies match docs/compliance (copy docs/compliance/<slug>.md to data/compliance/ after editing)", async () => {
    for (const slug of COMPLIANCE_SLUGS) expect(await Bun.file(`${import.meta.dir}/../data/compliance/${slug}.md`).text()).toBe(await Bun.file(`${import.meta.dir}/../docs/compliance/${slug}.md`).text());
  });

  test("parseComplianceGuide lifts the keywords line out of the body", () => {
    const g = parseComplianceGuide("australia", "# X\n\n*Researched 3 November 2026.*\n\n## 1. Bottom line\n<!-- keywords: Ethics, Push back , agent code -->\n**Never.**\n\n## 2. Money\n\nCash.\n\n## Sources\n\n- a");
    expect(g.updated).toBe("2026-11-03");
    expect(g.sections.map((s) => [s.number, s.anchor, s.keywords, s.body])).toEqual([
      [1, "1-bottom-line", ["ethics", "push back", "agent code"], "**Never.**"],
      [2, "2-money", [], "Cash."],
    ]);
  });
});

describe("compliance guides: when a question is a compliance one", () => {
  test("the compliance_ethics topic, compliance terms in the message, or an onshore provider change", () => {
    expect(isComplianceQuestion({ topic: "compliance_ethics", text: "Can I say this?" })).toBe(true);
    for (const text of [COMMISSION_Q, "She wants a release letter", "Is this migration advice?", "Check his MARN", "OISC level 1?", "Student complaint about our branch", "Is it ethical to charge both?", "What are an agent's obligations here?"]) {
      expect(isComplianceQuestion({ topic: "general_inquiry", text })).toBe(true);
    }
    expect(isComplianceQuestion({ topic: "onshore_support", text: "He wants to change to another college in Sydney" })).toBe(true);
  });

  test("money, credit and bank transfers, or a commission that is a government body, are not", () => {
    for (const text of ["How long does a money transfer from Nepal take?", "Can she get credit transfer for her diploma?", "Bank transfer of tuition", "Does CHED (Commission on Higher Education) need to verify?", "University Grants Commission attestation"]) {
      expect(isComplianceQuestion({ topic: "document_preparation", text })).toBe(false);
    }
    expect(isComplianceQuestion({ topic: "onshore_support", text: "How many hours can he work?" })).toBe(false);
  });

  test("destination: the first routed one with a guide, else the one a regulator term names", () => {
    expect(complianceDestination(["germany", "canada"], "")).toBe("canada");
    expect(complianceDestination([], "Is our counsellor's MARN current?")).toBe("australia");
    expect(complianceDestination([], "Does she need OISC level 1?")).toBe("united_kingdom");
    expect(complianceDestination([], "commission question")).toBeNull();
  });

  test("no keyword match falls back to section 1 (the bottom line)", () => {
    expect(bestComplianceSection(complianceGuide("canada"), "xyzzy")?.number).toBe(1);
  });
});

describe("compliance guides: excerpts", () => {
  test("the onshore-transfer commission question (Australia) gets the commission-ban section", () => {
    const [au, ...rest] = complianceGuideExcerpts({ topic: "onshore_support", text: COMMISSION_Q, countries: ["australia"], origin: null });
    expect(rest).toEqual([]);
    expect(au!.title.toLowerCase()).toContain("commission");
    for (const s of ["started a course with another registered provider", "1 April 2026", "Do not push back"]) expect(au!.content).toContain(s);
    expect(au!.content.length).toBeLessThanOrEqual(MARKET_GUIDE_EXCERPT_MAX);
    expect(au!.content).not.toContain("](http");
    expect(au).toMatchObject({ source: "compliance-guide:australia", sourceKind: "upload", docType: "compliance_guide", country: "australia", updatedAt: "2026-10-09T00:00:00.000Z", matchedBy: ["compliance_guide"] });
    expect(au!.url).toStartWith("compliance-guide://australia#4-");
  });

  test("a migration-advice question (UK) gets the section on what an unregulated adviser may say", () => {
    const [uk] = complianceGuideExcerpts({ topic: "compliance_ethics", text: UK_MIGRATION_Q, countries: ["united_kingdom"], origin: null });
    expect(uk).toMatchObject({ source: "compliance-guide:united_kingdom", country: "united_kingdom" });
    expect(uk!.url).toStartWith("compliance-guide://united_kingdom#3-");
  });

  test("a Nepal counsellor's question adds the Nepal section of the source-markets guide", () => {
    const ex = complianceGuideExcerpts({ topic: "onshore_support", text: COMMISSION_Q, countries: ["australia"], origin: "nepal" });
    expect(ex.map((e) => e.source)).toEqual(["compliance-guide:australia", "compliance-guide:source-markets"]);
    expect(ex[1]).toMatchObject({ url: "compliance-guide://source-markets#1-nepal", section: "1. Nepal", title: "Expert compliance guide — Source markets: Nepal", country: null });
    expect(ex[1]!.content).toContain("2026");
  });

  test("nothing for a question that is not a compliance one", () => {
    expect(complianceGuideExcerpts({ topic: "visa_process", text: "What documents for a subclass 500?", countries: ["australia"], origin: "nepal" })).toEqual([]);
  });
});

describe("compliance guides in the research turn", () => {
  const nepalCounsellor: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };
  const commission = intentOf({ primary_intent: "onshore_support", destinations: ["australia"], user_question: COMMISSION_Q, task: "lookup", needs_research: true });

  async function turn(opts: { skillPacks?: boolean; marketPacks?: boolean; research?: { complianceGuides?: boolean } }) {
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1)]);
    const { graph } = fakeGraph({ intent: commission, researchModel: model, knowledge, skillPacks: opts.skillPacks, marketPacks: opts.marketPacks, research: opts.research, answer: "Do not push back [1]." });
    const state = await graph.invoke({ input: COMMISSION_Q, history: [], sessionId: "s1", profile: null, counsellorRegion: nepalCounsellor });
    return { state, research: String(model.seen[0]![0]!.content), answer: String(state.meta.systemPromptText) };
  }
  const ruleItems = (state: Awaited<ReturnType<typeof turn>>["state"]) => state.evidence.filter((e) => e.source.startsWith("compliance-guide:"));

  test("a Nepal branch manager's commission question: the AU ban and Nepal's agency rules are numbered, cited evidence", async () => {
    const { state, research, answer } = await turn({ skillPacks: true });
    const rules = ruleItems(state);
    expect(rules.map((e) => e.source)).toEqual(["compliance-guide:australia", "compliance-guide:source-markets"]);
    expect(state.meta.round0ComplianceGuides).toEqual(rules.map((e) => e.id));
    expect(answer).toContain(`url="${rules[0]!.url}" source="compliance-guide:australia"`);
    expect(research).toContain(`[${rules[0]!.n}] ${rules[0]!.title}`);
    const cited = citedSources(`Do not push back [${rules[0]!.n}].`, formatContext(state.evidence).sources);
    expect(cited.map((s) => [s.source, s.sourceKind, s.kind])).toEqual([["compliance-guide:australia", "upload", "kb"]]);
  });

  test("either flag turns them on; both off (or the research override off) adds none", async () => {
    expect(ruleItems((await turn({ skillPacks: false, marketPacks: true })).state)).toHaveLength(2);
    expect(ruleItems((await turn({ skillPacks: true, marketPacks: false })).state)).toHaveLength(2);
    expect(ruleItems((await turn({ skillPacks: false, marketPacks: false })).state)).toEqual([]);
    expect(ruleItems((await turn({ skillPacks: true, research: { complianceGuides: false } })).state)).toEqual([]);
  });
});

describe("compliance guides: the research tool", () => {
  const top = (q: string, guides?: Parameters<typeof searchComplianceGuides>[1]) =>
    searchComplianceGuides(q, guides)
      .slice(0, 1)
      .map((r) => `${r.guide.slug}#${r.section.number}`)[0];

  test("ranked search finds the rule a question needs", () => {
    expect(top("university refuses commission for onshore transfer")).toBe("australia#4");
    expect(top("release letter after 5 months")).toBe("australia#3");
    expect(top("can I coach F-1 interview answers")).toBe("united_states#4");
    expect(top("Nepal consultancy licence renewal deposit")).toBe("source-markets#1");
    expect(top("complaint", ["new_zealand"])).toBe("new_zealand#6");
    expect(searchComplianceGuides("xyzzy")).toEqual([]);
  });

  test("a query naming a destination or its regulator searches that guide and source-markets only", () => {
    expect(guidesNamedIn("who can give immigration advice in the UK")).toEqual(["united_kingdom", "source-markets"]);
    expect(guidesNamedIn("check the MARN")).toEqual(["australia", "source-markets"]);
    expect(guidesNamedIn("can we take commission?")).toEqual([...COMPLIANCE_SLUGS]);
    expect(top("who can give immigration advice in the UK")).toBe("united_kingdom#2");
  });

  test("search_compliance_guides adds sections as numbered evidence, reads a named section, and reports repeats", async () => {
    const collector = new EvidenceCollector(10);
    const t = makeSearchComplianceGuidesTool({ collector });
    const first = String(await t.invoke({ query: "university refuses commission for onshore transfer", guides: ["australia"] }));
    expect(first).toContain("[1] Expert compliance guide — Australia: The 2026 ban on commission for onshore student transfers");
    expect(collector.items.map((i) => [i.n, i.source, i.kind])).toEqual([
      [1, "compliance-guide:australia", "kb"],
      [2, "compliance-guide:australia", "kb"],
    ]);
    const read = String(await t.invoke({ query: "complaints", guides: ["australia"], section: 8 }));
    expect(read).toContain("[3] Expert compliance guide — Australia: Complaints and escalation");
    expect(String(await t.invoke({ query: "commission", guides: ["australia"], section: 4 }))).toBe("[1] Expert compliance guide — Australia: The 2026 ban on commission for onshore student transfers (already collected)");
    expect(String(await t.invoke({ query: "section 19", guides: ["canada"], section: 19 }))).toStartWith("No section 19 in the canada compliance guide.");
    expect(String(await t.invoke({ query: "xyzzy" }))).toStartWith("No compliance-guide section matched.");
    // The description carries every guide's table of contents, so the planner can name a section.
    expect(t.description).toContain("australia: 1 Bottom line for counsellors;");
    expect(t.description).toContain("source-markets: 1 Nepal; 2 India;");
  });

  test("offered to the research model with the packs on, not with them off; a call adds cited evidence", async () => {
    const ask = intentOf({ primary_intent: "compliance_ethics", destinations: ["united_kingdom"], user_question: "Can our London staff advise on switching visas?", needs_research: true });
    const run = async (skillPacks: boolean) => {
      const model = new ScriptedToolModel([toolCalls([{ name: "search_compliance_guides", args: { query: "complaint route for a student", guides: ["united_kingdom"] } }]), new AIMessage({ content: "sufficient" })]);
      const { graph } = fakeGraph({ intent: ask, researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), skillPacks });
      const state = await graph.invoke({ input: "Can our London staff advise on switching visas?", history: [], sessionId: "s1", profile: null });
      return { state, prompt: String(model.seen[0]![0]!.content) };
    };
    const on = await run(true);
    expect(on.prompt).toContain("- search_compliance_guides: Search Expert's cited compliance guides");
    expect(on.state.researchTrace?.toolCalls.map((t) => t.tool)).toEqual(["search_compliance_guides"]);
    expect(on.state.evidence.filter((e) => e.source === "compliance-guide:united_kingdom").map((e) => e.section)).toContain("7. Complaints and escalation");
    const off = await run(false);
    expect(off.prompt).not.toContain("search_compliance_guides:");
    expect(off.state.evidence.some((e) => e.source.startsWith("compliance-guide:"))).toBe(false);
  });
});

describe("compliance rule in the answer prompt", () => {
  test("never coach a breach, cite the guide, refer migration advice to a registered or licensed adviser", () => {
    expect(CONSULTANT_SYSTEM_PROMPT).toContain('source="compliance-guide:<slug>"');
    const rule = CONSULTANT_SYSTEM_PROMPT.match(/^10a\. .+$/m)?.[0] ?? "";
    for (const s of ["Never coach a counsellor or manager toward an action that breaches an agent code or the law", "commission on an onshore student transfer", "immigration advice or assistance without registration", "misleading a student", "cite the compliance-guide excerpt", "registered migration agent (Australia)", "licensed immigration adviser (New Zealand)"]) {
      expect(rule).toContain(s);
    }
  });
});
