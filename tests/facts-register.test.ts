import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { CONSULTANT_SYSTEM_PROMPT } from "../src/prompts/consultant";
import { citedSources, formatContext } from "../src/retrieval/format";
import { FACTS_REGISTER_EXCERPT_MAX, FACTS_SLUGS, factsRegister, factsRegisterExcerpts, factsSectionExcerpt, hasFactsRegister, NAMED_ROW_HEADING, namedEvidenceRow, namedRowInstruction, parseFactsRegister } from "../src/skills/facts-register";
import { RecordingKnowledgeStore, ScriptedToolModel } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const CLOSED = "Closed or replaced programmes and rules";
const ONSHORE_Q = "Can a student on a visitor visa (subclass 600) apply for a 500 student visa onshore now?";
const FEE_485_Q = "What is the visa application fee for a 485 Post-Higher Education Work visa now?";

describe("facts registers: the shipped files", () => {
  test("every docs/facts register is shipped in data/facts and registered (add its import in src/skills/facts-register.ts)", async () => {
    const names = [...new Bun.Glob("*.md").scanSync({ cwd: `${import.meta.dir}/../docs/facts` })].map((n) => n.replace(/\.md$/, "")).sort();
    expect([...FACTS_SLUGS].sort()).toEqual(names);
    for (const slug of names) expect(await Bun.file(`${import.meta.dir}/../data/facts/${slug}.md`).text()).toBe(await Bun.file(`${import.meta.dir}/../docs/facts/${slug}.md`).text());
  });

  test("Australia parses into dated table sections with six-column rows and the secondary label flagged", () => {
    const au = factsRegister("australia");
    expect(au.label).toBe("Australia");
    expect(au.checked).toBe("2026-10-09");
    expect(au.sections[0]!.title).toBe(CLOSED);
    expect(au.sections.map((s) => s.title)).toContain("Visa application charges");
    expect(au.sections.map((s) => s.title)).toContain("Next review dates");
    for (const s of au.sections) {
      expect(s.header).toEqual(["Fact", "Value", "Effective from", "Applies to", "Official source", "Checked"]);
      expect(s.rows.length).toBeGreaterThan(0);
    }
    const rows = au.sections.flatMap((s) => s.rows);
    const marked = rows.filter((r) => r.line.includes("secondary — verify"));
    expect(marked.length).toBeGreaterThan(5);
    expect(rows.filter((r) => r.unverified)).toEqual(marked);
    const gte = au.sections[0]!.rows[0]!;
    expect([gte.fact, gte.effectiveFrom, gte.checked]).toEqual(["Genuine Temporary Entrant (GTE) replaced by Genuine Student (GS) requirement", "2024-03-23", "2026-10-09"]);
    expect(au.sections[0]!.notes[0]).toStartWith("- Applications lodged **before 2 October 2026**");
  });

  test("parseFactsRegister: anchors, checked date and notes from a small register", () => {
    const r = parseFactsRegister("canada", "# Canada: Facts Register\n\n*Checked 3 November 2026.*\n\n## Work rights (off campus)\n\n| Fact | Value | Effective from | Applies to | Official source | Checked |\n|---|---|---|---|---|---|\n| Off-campus hours | 24 a week | 2024-11-08 (secondary — verify) | Study permit holders | [IRCC](https://www.canada.ca/x) | 2026-11-03 |\n\nNotes\n- Breaks are unlimited.\n");
    expect(r.checked).toBe("2026-11-03");
    expect(r.sections.map((s) => [s.title, s.anchor, s.rows.length, s.notes])).toEqual([["Work rights (off campus)", "work-rights-off-campus", 1, ["- Breaks are unlimited."]]]);
    expect(r.sections[0]!.rows[0]!.unverified).toBe(true);
  });

  test("which destinations have a register (the scholarships register is not a destination's)", () => {
    for (const d of ["australia", "new_zealand", "united_kingdom", "canada", "united_states"]) expect(hasFactsRegister(d)).toBe(true);
    expect(hasFactsRegister("germany")).toBe(false);
    expect(hasFactsRegister("scholarships")).toBe(false);
  });

  test("all six registers parse with an ISO or written checked date and table sections", () => {
    for (const slug of FACTS_SLUGS) {
      const r = factsRegister(slug);
      expect(r.checked).toBe("2026-10-09");
      expect(r.sections.length).toBeGreaterThan(5);
      expect(r.sections.some((s) => /^Closed or replaced/.test(s.title))).toBe(true);
    }
  });

  test("every '… — verify' label counts as unverified: secondary, prior knowledge, not verified, blocked", () => {
    const rows = FACTS_SLUGS.flatMap((slug) => factsRegister(slug).sections.flatMap((s) => s.rows));
    for (const label of ["(secondary — verify)", "(prior knowledge — verify)", "(not verified — verify)", "(blocked — verify)"]) {
      const marked = rows.filter((r) => r.line.includes(label));
      expect(marked.length).toBeGreaterThan(0);
      expect(marked.every((r) => r.unverified)).toBe(true);
    }
  });
});

describe("facts registers: round-0 excerpt selection", () => {
  const sections = (topic: Parameters<typeof factsRegisterExcerpts>[0]["topic"], text: string, countries: string[] = ["australia"]) => factsRegisterExcerpts({ topic, text, countries }).map((c) => c.section);

  test("AU visitor 600 → student 500 onshore: the Closed or replaced section first (with the barred-holders row), then onshore switching", () => {
    const out = factsRegisterExcerpts({ topic: "onshore_support", text: ONSHORE_Q, countries: ["australia"] });
    expect(out.map((c) => c.section)).toEqual([CLOSED, "Onshore switching restrictions (from 2 October 2026)"]);
    expect(out[0]!.content).toContain("Visitor and 485 holders barred from applying for a Student visa onshore");
    expect(out[0]!.content).toContain("Most onshore Student visa applications closed");
    expect(out[0]).toMatchObject({
      id: "facts-register:australia#closed-or-replaced-programmes-and-rules",
      url: "facts-register://australia#closed-or-replaced-programmes-and-rules",
      title: `Expert facts register — Australia: ${CLOSED}`,
      docType: "facts_register",
      country: "australia",
      source: "facts-register:australia",
      sourceKind: "upload",
      matchedBy: ["facts_register"],
      updatedAt: "2026-10-09T00:00:00.000Z",
    });
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(FACTS_REGISTER_EXCERPT_MAX);
      expect(c.content).toStartWith("| Fact | Value | Effective from | Applies to | Official source | Checked |\n|---|");
    }
  });

  test("AU 485 fee: the visa charges table with the 485 rows; Closed first only for a visa-shaped topic", () => {
    const visa = factsRegisterExcerpts({ topic: "visa_process", text: FEE_485_Q, countries: ["australia"] });
    expect(visa.map((c) => c.section)).toEqual([CLOSED, "Visa application charges"]);
    const money = factsRegisterExcerpts({ topic: "financial_viability", text: FEE_485_Q, countries: ["australia"] });
    expect(money[0]!.section).toBe("Visa application charges");
    expect(money[0]!.content).toContain("| Subclass 485 Post-Higher Education Work, primary | AUD5,750.00 |");
    expect(money[0]!.content).toContain("| Subclass 485 STAC |");
    expect(money[0]!.content.length).toBeLessThanOrEqual(FACTS_REGISTER_EXCERPT_MAX);
    // Links are compacted to "label, host" so more rows fit; the official host stays visible.
    expect(money[0]!.content).toContain("Home Affairs: Current visa pricing table, immi.homeaffairs.gov.au");
    expect(money[0]!.content).not.toContain("https://");
  });

  test("rows marked (secondary — verify) keep the label; omitted rows are counted", () => {
    const [fees] = factsRegisterExcerpts({ topic: "financial_viability", text: "What is the subclass 500 student visa base application charge?", countries: ["australia"] });
    expect(fees!.section).toBe("Visa application charges");
    expect(fees!.content).toContain("| AUD2,500.00 | 2026-07-01 (previously AUD2,000, secondary — verify) |");
    expect(fees!.content).toMatch(/\n\(\d+ more rows? in this section not shown\)/);
  });

  test("funds, work and English questions land on their tables (New Zealand too)", () => {
    expect(sections("financial_viability", "How much living cost funds does she need to show for 12 months?")[0]).toBe("Financial capacity");
    expect(sections("work_survival", "How many hours a fortnight can he work during the semester?")[0]).toBe("Work rights");
    expect(sections("visa_process", "Which IELTS score is needed for the student visa?").slice(0, 2)).toEqual([CLOSED, "English language requirements"]);
    expect(sections("work_survival", "How many hours a week can a student work in New Zealand?", ["new_zealand"])[0]).toBe("Work rights");
  });

  test("a question naming a register row gets that row's section, even with no topic cue or behind a fee table", () => {
    // Golden facts 2026-10-12: 11 of 219 questions never had their row in the evidence.
    const has = (topic: Parameters<typeof factsRegisterExcerpts>[0]["topic"], text: string, country: string, row: string) =>
      factsRegisterExcerpts({ topic, text, countries: [country] }).some((c) => c.content.includes(`| ${row} |`));
    expect(has("visa_process", "What does an Access to Information Act request cost to get GCMS notes after a refusal?", "canada", "Access to Information Act request")).toBe(true);
    expect(has("visa_process", "Can a care worker already in the UK do the in-country transition to a new sponsor?", "united_kingdom", "In-country transition")).toBe(true);
    expect(has("visa_process", "What is the ELICOS VAC and priority for a standalone English course?", "australia", "ELICOS VAC and priority")).toBe(true);
    expect(has("work_survival", "What is the off-campus limit during academic sessions in Canada?", "canada", "Off-campus limit during academic sessions")).toBe(true);
  });

  test("the row a question names is kept when its section is longer than the excerpt budget", () => {
    const [psw] = factsRegisterExcerpts({ topic: "migration_pathway", text: "What are the eligible qualifications for the NZ post-study work visa?", countries: ["new_zealand"] })
      .filter((c) => c.section === "Post-study work visa");
    expect(psw!.content).toContain("| Eligible qualifications |");
    expect(psw!.content.length).toBeLessThanOrEqual(FACTS_REGISTER_EXCERPT_MAX);
  });

  test("a closed-rule cue brings the Closed section first whatever the topic", () => {
    expect(sections("financial_viability", "Is GTE still required or was it replaced?")[0]).toBe(CLOSED);
  });

  test("UK, Canada and US registers: fees, funds and work questions; prior-knowledge labels stay visible; bare URLs compacted", () => {
    const uk = factsRegisterExcerpts({ topic: "financial_viability", text: "What maintenance funds does she need to show for London?", countries: ["united_kingdom"] });
    expect(uk[0]!.section).toBe("Maintenance (financial requirement)");
    expect(sections("visa_process", "What is the student visa application fee?", ["united_kingdom"])).toEqual(["Closed or replaced programmes and rules", "Visa application fees"]);
    expect(sections("work_survival", "How many hours can he work off campus?", ["canada"])[0]).toBe("Work while studying");
    expect(sections("financial_viability", "How much GIC and proof of funds?", ["canada"]).slice(0, 2).sort()).toEqual(["GIC (Guaranteed Investment Certificate)", "Proof of funds"]);
    const opt = factsRegisterExcerpts({ topic: "work_survival", text: "Can an F-1 student work on OPT after graduating, and what about CPT?", countries: ["united_states"] });
    expect(opt[0]!.section).toBe("Work: on-campus, CPT, OPT, STEM OPT");
    const all = FACTS_SLUGS.filter((s) => s !== "scholarships").flatMap((slug) => factsRegister(slug).sections.map((sec) => factsSectionExcerpt(sec, new Set())));
    expect(all.some((c) => c.includes("(prior knowledge — verify)"))).toBe(true);
    for (const c of all) expect(c).not.toContain("https://");
  });

  test("scholarship questions use the scholarships register (not a destination), by programme and destination", () => {
    const chev = factsRegisterExcerpts({ topic: "scholarship_funding", text: "Is Chevening open for Nepali students this year?", countries: ["united_kingdom"] });
    expect(chev[0]).toMatchObject({ source: "facts-register:scholarships", docType: "facts_register", country: null, section: "Chevening (UK, FCDO)" });
    expect(factsRegisterExcerpts({ topic: "scholarship_funding", text: "Which government scholarships can she get?", countries: ["australia"] })[0]!.section).toBe("Australia Awards Scholarships (Australia, DFAT)");
    expect(factsRegisterExcerpts({ topic: "scholarship_funding", text: "Is Vanier still running or was it replaced?", countries: ["canada"] })[0]!.section).toBe("Closed or replaced programmes and rules");
    expect(factsRegisterExcerpts({ topic: "scholarship_funding", text: "any scholarships?", countries: [] })[0]!.section).toBe("Eligibility matrix (quick reference)");
  });

  test("none without a register for the routed destination, or for a topic the trigger excludes", () => {
    expect(factsRegisterExcerpts({ topic: "visa_process", text: ONSHORE_Q, countries: ["germany"] })).toEqual([]);
    expect(factsRegisterExcerpts({ topic: "visa_process", text: ONSHORE_Q, countries: [] })).toEqual([]);
    expect(factsRegisterExcerpts({ topic: "program_selection", text: "Which nursing courses at Monash?", countries: ["australia"] })).toEqual([]);
    expect(factsRegisterExcerpts({ topic: "greeting", text: "hi", countries: ["australia"] })).toEqual([]);
  });

  test("the first routed destination with a register is used", () => {
    expect(factsRegisterExcerpts({ topic: "visa_process", text: ONSHORE_Q, countries: ["germany", "australia"] })[0]!.source).toBe("facts-register:australia");
  });
});

describe("facts registers in the research turn", () => {
  const ask = intentOf({ primary_intent: "onshore_support", destinations: ["australia"], user_question: ONSHORE_Q, needs_research: true });
  async function turn(research: { factsRegister?: boolean } = { factsRegister: true }) {
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: ask, researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), research, answer: "No [1]." });
    const state = await graph.invoke({ input: ONSHORE_Q, history: [], sessionId: "s1", profile: null });
    return { state, answer: String(state.meta.systemPromptText) };
  }

  test("numbered, dated evidence ahead of the knowledge base, cited as staff-document provenance", async () => {
    const { state, answer } = await turn();
    const facts = state.evidence.filter((e) => e.source === "facts-register:australia");
    expect(facts.map((e) => [e.n, e.section])).toEqual([
      [1, CLOSED],
      [2, "Onshore switching restrictions (from 2 October 2026)"],
    ]);
    expect(state.meta.round0FactsRegister).toEqual(facts.map((e) => e.id));
    expect(answer).toContain(`url="facts-register://australia#closed-or-replaced-programmes-and-rules" source="facts-register:australia" country="australia" updated="2026-10-09"`);
    const cited = citedSources("No [1].", formatContext(state.evidence).sources);
    expect(cited.map((s) => [s.source, s.sourceKind, s.kind, s.docType])).toEqual([["facts-register:australia", "upload", "kb", "facts_register"]]);
  });

  test("a question naming a register row in the evidence gets a per-turn instruction quoting that row", async () => {
    // Golden facts 2026-10-12: GLM 4.7 Flash ignored the general rule (4e) and still gave a row's
    // first figure only; a per-turn block naming the row and its excerpt number is what it follows.
    const q = "Are visitor and 485 holders barred from applying for a Student visa onshore now?";
    const model = new ScriptedToolModel([new AIMessage({ content: "sufficient" })]);
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "onshore_support", destinations: ["australia"], user_question: q, needs_research: true }), researchModel: model, knowledge: new RecordingKnowledgeStore(() => [sampleChunk(1)]), research: { factsRegister: true }, answer: "Yes [1]." });
    const state = await graph.invoke({ input: q, history: [], sessionId: "s1", profile: null });
    const prompt = String(state.meta.systemPromptText);
    const block = prompt.slice(prompt.indexOf(NAMED_ROW_HEADING));
    expect(prompt).toContain(NAMED_ROW_HEADING);
    expect(block).toContain("excerpt [1]");
    expect(block).toContain("| Visitor and 485 holders barred from applying for a Student visa onshore |");
    expect(block).toContain("every figure");
    // After the evidence, like the other per-turn blocks.
    expect(prompt.indexOf(NAMED_ROW_HEADING)).toBeGreaterThan(prompt.indexOf("<knowledge_base>"));
  });

  test("no row instruction when the question names no register row", async () => {
    const { answer } = await turn();
    expect(answer).not.toContain(NAMED_ROW_HEADING);
  });

  test("namedEvidenceRow: the evidence row the question names, with its excerpt number; none for a vague question", () => {
    const evidence = factsRegisterExcerpts({ topic: "visa_process", text: "What is the Access to Information Act request fee?", countries: ["canada"] }).map((c, i) => ({ ...c, n: i + 4 }));
    const hit = namedEvidenceRow("What is the Access to Information Act request fee?", evidence)!;
    expect(hit.row.fact).toBe("Access to Information Act request");
    expect(hit.n).toBe(evidence.find((e) => e.section === hit.section)!.n);
    expect(namedEvidenceRow("What should she do next?", evidence)).toBeNull();
  });

  test("namedEvidenceRow: a label the question quotes word for word wins a tie", () => {
    // "Partner visitor visa" and "Child visitor visa" both match two words of this question.
    const q = "New Zealand, partner and children's rights: how long can a child on a \"Child visitor visa\" attend school?";
    const evidence = factsRegisterExcerpts({ topic: "family_planning", text: q, countries: ["new_zealand"] }).map((c, i) => ({ ...c, n: i + 1 }));
    expect(namedEvidenceRow(q, evidence)!.row.fact).toBe("Child visitor visa");
  });

  test("the row instruction lists the row's figures as a checklist", () => {
    const row = factsRegister("new_zealand").sections.flatMap((s) => s.rows).find((r) => r.fact === "English for work rights (English language study)")!;
    const text = namedRowInstruction({ n: 3, section: "English requirements", row });
    expect(text).toContain("excerpt [3]");
    expect(text).toMatch(/Its figures: .*2 years.*25-hour/);
  });

  test("on by default in production config (FACTS_REGISTER_ENABLED unset)", () => {
    expect(testEnv({ FACTS_REGISTER_ENABLED: undefined }).FACTS_REGISTER_ENABLED).toBe(true);
    expect(testEnv({ FACTS_REGISTER_ENABLED: "off" }).FACTS_REGISTER_ENABLED).toBe(false);
  });

  test("off with research.factsRegister=false", async () => {
    const { state } = await turn({ factsRegister: false });
    expect(state.evidence.some((e) => e.source.startsWith("facts-register:"))).toBe(false);
  });

  test("the answer prompt ranks the register above Expert and partner pages and asks for the effective date", () => {
    const rule = CONSULTANT_SYSTEM_PROMPT.match(/^4c\. .+$/m)?.[0] ?? "";
    expect(rule).toContain('source="facts-register:<slug>"');
    expect(rule).toContain("effective date");
  });

  test("the answer prompt asks for every figure of a register row, not only the first", () => {
    // Golden facts 2026-10-12: GLM 4.7 Flash gave a row's headline value and dropped the rest
    // (the under-18 charge, the apply-within window, the announced uplift) in 12 of 219 cases.
    const rule = CONSULTANT_SYSTEM_PROMPT.match(/^4e\. .+$/m)?.[0] ?? "";
    expect(rule).toContain("every figure");
    expect(rule).toContain("announced change");
    expect(rule).toContain("the measure asked");
  });
});
