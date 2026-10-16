import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import type { CounsellorRegion } from "../src/routing/markets";
import { MARKETS } from "../src/routing/markets";
import { citedSources, formatContext } from "../src/retrieval/format";
import { allMarketGuides, compactLinks, MARKET_GUIDE_EXCERPT_MAX, marketGuide, marketGuideExcerpts, parseMarketGuide, trimExcerpt } from "../src/skills/market-guides";
import { CountryScriptedModel, RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

const nepalCounsellor: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };

describe("market guides: the shipped files", () => {
  test("all seven load from data/markets with sections 4–6 and per-destination blocks", () => {
    const guides = allMarketGuides();
    expect(guides.map((g) => g.market)).toEqual([...MARKETS]);
    for (const g of guides) {
      for (const n of [4, 5, 6]) expect(g.sections.find((s) => s.number === n)?.body.length ?? 0).toBeGreaterThan(500);
      for (const d of ["australia", "united_kingdom", "canada", "united_states", "new_zealand"] as const) expect(g.destinations[d]?.length ?? 0).toBeGreaterThan(50);
      expect(g.updated).toBe("2026-10-08");
    }
  });

  test("the runtime copies match docs/markets (copy docs/markets/<slug>.md to data/markets/ after editing)", async () => {
    for (const m of MARKETS) expect(await Bun.file(`${import.meta.dir}/../data/markets/${m}.md`).text()).toBe(await Bun.file(`${import.meta.dir}/../docs/markets/${m}.md`).text());
  });

  test("section 6 splits whichever way a guide writes it: table rows, bold leads, ### headings", () => {
    // Nepal: a table row and a "**Australia:**" block; "Japan / Korea" names no destination.
    const nepal = marketGuide("nepal").destinations;
    expect(nepal.australia).toStartWith("Australia — Nepal-specific position (as of Oct 2026): **Evidence Level 3 since 8 Jan 2026**");
    expect(nepal.australia).toContain("**Australia:**\n- Applicants need full Genuine Student evidence");
    expect(nepal.australia).not.toContain("UK");
    // "**Germany / Ireland:**" goes to both.
    expect(nepal.germany).toBe(nepal.ireland!);
    // Bangladesh: "**Australia notes**" lead lines; "**Alternatives.**" ends the USA/Germany blocks.
    expect(marketGuide("bangladesh").destinations.germany).not.toContain("Alternatives");
    // Thailand: "### Regional: Malaysia and others" is Malaysia's block.
    expect(marketGuide("thailand").destinations.malaysia).toContain("Malaysia");
    expect(marketGuide("philippines").destinations.australia).not.toContain("### ");
  });

  test("parseMarketGuide reads a dated header and numbered sections", () => {
    const g = parseMarketGuide("india", "# X\n\n*Researched 3 November 2026.*\n\n## 4. Money\n\nCash.\n\n## 6. Destination-by-destination guidance\n\n### Canada\nCold.\n\n## Sources\n\n- a");
    expect(g.updated).toBe("2026-11-03");
    expect(g.sections.map((s) => [s.number, s.title, s.anchor])).toEqual([
      [4, "Money", "4-money"],
      [6, "Destination-by-destination guidance", "6-destination-by-destination-guidance"],
    ]);
    expect(g.destinations).toEqual({ canada: "Cold." });
  });
});

describe("market guides: excerpts", () => {
  test("compactLinks keeps the label and host, URLs with parentheses included", () => {
    expect(compactLinks("see ([PIE News](https://thepienews.com/a-b)) and [Wiki](https://en.wikipedia.org/wiki/X_(Nepal)); [noc.moest.gov.np](https://noc.moest.gov.np/)")).toBe("see (PIE News, thepienews.com) and Wiki, en.wikipedia.org; noc.moest.gov.np");
  });

  test("trimExcerpt drops nested detail from the end, then label-only bullets, then cuts", () => {
    const text = ["- **A.** one", "  - a1", "  - a2", "- **B.**", "  - b1", "- **C.** three"].join("\n");
    expect(trimExcerpt(text, 1_000)).toBe(text);
    expect(trimExcerpt(text, 45)).toBe("- **A.** one\n  - a1\n- **C.** three");
    const long = trimExcerpt(`- ${"word ".repeat(100)}`, 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith(" …")).toBe(true);
  });

  test("Nepal + Australia, visa topic: origin-side steps, the Australia block, then money", () => {
    const ex = marketGuideExcerpts({ market: "nepal", topic: "visa_process", countries: ["australia"] });
    expect(ex.map((e) => e.title)).toEqual(["Expert market guide — Nepal: Origin-side steps & documents", "Expert market guide — Nepal: Australia guidance", "Expert market guide — Nepal: Money"]);
    const [steps, au, money] = ex;
    for (const s of ["NOC", "noc.moest.gov.np", "Police clearance", "Attestation"]) expect(steps!.content).toContain(s);
    expect(au!.content).toContain("Evidence Level 3");
    expect(money!.content).toContain("Nepal Rastra Bank");
    for (const e of ex) {
      expect(e.content.length).toBeLessThanOrEqual(MARKET_GUIDE_EXCERPT_MAX);
      expect(e.content).not.toContain("](http");
      expect(e).toMatchObject({ source: "market-guide:nepal", sourceKind: "upload", docType: "market_guide", updatedAt: "2026-10-08T00:00:00.000Z", matchedBy: ["market_guide"] });
    }
    expect(steps).toMatchObject({ url: "market-guide://nepal#5-origin-side-steps--documents", country: null, section: "5. Origin-side steps & documents" });
    expect(au).toMatchObject({ url: "market-guide://nepal#destinations-australia", country: "australia", section: "6. Destination-by-destination guidance › Australia" });
  });

  test("finance topics lead with Money; at most two destinations; at most three excerpts", () => {
    const ex = marketGuideExcerpts({ market: "india", topic: "financial_viability", countries: ["canada", "united_kingdom", "australia"] });
    expect(ex.map((e) => e.section)).toEqual(["4. Money", "6. Destination-by-destination guidance › Canada", "6. Destination-by-destination guidance › United Kingdom"]);
    const visa = marketGuideExcerpts({ market: "india", topic: "visa_process", countries: ["canada", "united_kingdom"] });
    expect(visa.map((e) => e.section)).toEqual(["5. Origin-side steps & documents", "6. Destination-by-destination guidance › Canada", "6. Destination-by-destination guidance › United Kingdom"]);
  });

  test("other guide topics get only destination blocks; a destination without one adds nothing", () => {
    expect(marketGuideExcerpts({ market: "vietnam", topic: "migration_pathway", countries: ["australia"] }).map((e) => e.country)).toEqual(["australia"]);
    expect(marketGuideExcerpts({ market: "vietnam", topic: "eligibility_check", countries: ["uae"] })).toEqual([]);
    expect(marketGuideExcerpts({ market: "vietnam", topic: "onshore_support", countries: [] })).toEqual([]);
  });

  test("no market, or a topic outside the guide topics: nothing", () => {
    expect(marketGuideExcerpts({ market: null, topic: "visa_process", countries: ["australia"] })).toEqual([]);
    for (const topic of ["greeting", "caseload_management", "company_services", "general_inquiry"] as const) expect(marketGuideExcerpts({ market: "nepal", topic, countries: ["australia"] })).toEqual([]);
  });
});

describe("market guides in the research turn", () => {
  const visaAu = intentOf({ primary_intent: "visa_process", destinations: ["australia"], user_question: "What documents does the student need for an Australian subclass 500 visa?", task: "lookup", needs_research: true });

  async function turn(opts: { input: string; intent?: ReturnType<typeof intentOf>; marketPacks?: boolean; counsellorRegion?: CounsellorRegion | null; maxEvidence?: number }) {
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const knowledge = new RecordingKnowledgeStore(() => [sampleChunk(1), sampleChunk(2)]);
    const { graph } = fakeGraph({ intent: opts.intent ?? visaAu, researchModel: model, knowledge, skillPacks: true, marketPacks: opts.marketPacks, answer: "Nepal-side: NOC first [1]. Evidence level [2].", research: opts.maxEvidence ? { maxEvidence: opts.maxEvidence } : undefined });
    const state = await graph.invoke({ input: opts.input, history: [], sessionId: "s1", profile: null, counsellorRegion: opts.counsellorRegion ?? null });
    return { state, research: String(model.seen[0]![0]!.content), answer: String(state.meta.systemPromptText) };
  }
  const guideItems = (state: Awaited<ReturnType<typeof turn>>["state"]) => state.evidence.filter((e) => e.source.startsWith("market-guide:"));

  test("a Nepal counsellor's subclass 500 documents question: Nepal-side steps and the AU block are numbered, cited evidence", async () => {
    const { state, research, answer } = await turn({ input: "What documents does the student need for an Australian subclass 500 visa?", counsellorRegion: nepalCounsellor });
    expect(state.route).toMatchObject({ countries: ["australia"], origin: "nepal", originSource: "counsellor" });
    expect(state.evidence.map((e) => [e.n, e.source])).toEqual([
      [1, "market-guide:nepal"],
      [2, "market-guide:nepal"],
      [3, "market-guide:nepal"],
      [4, "experteducation.com"],
      [5, "experteducation.com"],
    ]);
    expect(state.evidence[0]!.content).toContain("Police clearance");
    expect(state.evidence[1]!.title).toBe("Expert market guide — Nepal: Australia guidance");
    expect(state.meta.round0MarketGuides).toEqual(["market-guide:nepal#5-origin-side-steps--documents", "market-guide:nepal#destinations-australia", "market-guide:nepal#4-money"]);
    expect(answer).toContain('<excerpt id="1" title="Expert market guide — Nepal: Origin-side steps & documents" section="5. Origin-side steps & documents" url="market-guide://nepal#5-origin-side-steps--documents" source="market-guide:nepal" updated="2026-10-08">');
    expect(answer).toContain('country="australia" updated="2026-10-08">');
    expect(answer).toContain('source="market-guide:<market>"');
    // The research planner sees them in its round-0 summary.
    expect(research).toContain("[1] Expert market guide — Nepal: Origin-side steps & documents");
    // Citations resolve to the guide with a readable title.
    const cited = citedSources("NOC first [1]. Evidence level [2].", formatContext(state.evidence).sources);
    expect(cited.map((s) => [s.title, s.source, s.sourceKind, s.kind])).toEqual([
      ["Expert market guide — Nepal: Origin-side steps & documents", "market-guide:nepal", "upload", "kb"],
      ["Expert market guide — Nepal: Australia guidance", "market-guide:nepal", "upload", "kb"],
    ]);
    expect(state.sources.map((s) => s.title)).toEqual(cited.map((s) => s.title));
  });

  test("a finance question leads with the Money section", async () => {
    const intent = intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "How much must the family show?", needs_research: true });
    const { state } = await turn({ input: "Nepali student: how much must the family show for Australia?", intent });
    expect(guideItems(state).map((e) => e.section)).toEqual(["4. Money", "6. Destination-by-destination guidance › Australia"]);
  });

  test("they count against maxEvidence", async () => {
    const { state } = await turn({ input: "Nepali student, AU 500 visa documents?", maxEvidence: 2 });
    expect(state.evidence.map((e) => e.source)).toEqual(["market-guide:nepal", "market-guide:nepal"]);
  });

  test("none without a market, with market packs off, or for a topic outside the guide topics", async () => {
    expect(guideItems((await turn({ input: "What documents for an Australian subclass 500 visa?" })).state)).toEqual([]);
    expect(guideItems((await turn({ input: "Nepali student, AU 500 visa documents?", marketPacks: false })).state)).toEqual([]);
    const services = intentOf({ primary_intent: "company_services", destinations: ["australia"], user_question: "Which of our offices handles AU visas?", needs_research: true });
    expect(guideItems((await turn({ input: "Nepali student: which of our offices handles AU visas?", intent: services })).state)).toEqual([]);
  });

  test("comparison fan-out: each branch gets its own destination's block; the shared section is merged once", async () => {
    const model = new CountryScriptedModel({ Australia: [new AIMessage({ content: "sufficient" })], Canada: [new AIMessage({ content: "sufficient" })] });
    const intent = intentOf({ primary_intent: "visa_process", task: "compare", destinations: ["australia", "canada"], user_question: "AU vs CA visa", needs_research: true });
    const { graph } = fakeGraph({ intent, researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), skillPacks: true, research: { compareFanout: true } });
    const state = await graph.invoke({ input: "Filipina nurse: student visa Australia vs Canada?", history: [], sessionId: "s1", profile: null });
    const au = String(model.seen.Australia![0]![0]!.content);
    const ca = String(model.seen.Canada![0]![0]!.content);
    expect(au).toContain("Expert market guide — Philippines: Australia guidance");
    expect(au).not.toContain("Philippines: Canada guidance");
    expect(ca).toContain("Expert market guide — Philippines: Canada guidance");
    expect(ca).not.toContain("Philippines: Australia guidance");
    const titles = state.evidence.filter((e) => e.source === "market-guide:philippines").map((e) => e.title);
    expect(titles.filter((t) => t.endsWith("Origin-side steps & documents"))).toHaveLength(1);
    expect(titles).toContain("Expert market guide — Philippines: Australia guidance");
    expect(titles).toContain("Expert market guide — Philippines: Canada guidance");
    expect(state.evidence.map((e) => e.n)).toEqual(state.evidence.map((_, i) => i + 1));
  });
});
