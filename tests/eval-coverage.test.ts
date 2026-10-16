import { describe, expect, test } from "bun:test";
import { csvRecords } from "../scripts/skills-build";
import { CHECKLISTS, MARKET_CHECKLISTS } from "../src/skills/checklists.generated";
import { PACK_DEFINITIONS } from "../src/skills/packs";
import {
  aggregate,
  buildJudgePrompt,
  cellKey,
  citationsIn,
  compareSummaries,
  evalCounsellorRegion,
  formatOriginSources,
  originSourceCounts,
  formatCompare,
  formatSummary,
  normalizeVerdicts,
  officialCited,
  onDomains,
  outsideChecklist,
  parseDataset,
  percentile,
  plannedCells,
  resolveCountry,
  routeMatches,
  scoreRow,
  summarize,
  validateDataset,
  type CoverageRow,
  type DatasetContext,
  type ItemVerdict,
  type RowResult,
} from "../src/eval/coverage";

const DATASET_URL = new URL("../data/eval/coverage.jsonl", import.meta.url);
const CSV_URL = new URL("../docs/data-model/catalog.csv", import.meta.url);

async function context(): Promise<DatasetContext> {
  const catalogIds = new Set(csvRecords(await Bun.file(CSV_URL).text()).map((r) => r.id));
  const packDomains = Object.fromEntries(Object.entries(PACK_DEFINITIONS).map(([c, p]) => [c, p.officialSources.map((s) => s.domain)]));
  return { catalogIds, checklists: CHECKLISTS, marketChecklists: MARKET_CHECKLISTS, packDomains };
}

describe("coverage dataset", () => {
  test("every row is valid: country, intent, stage, task, catalog ids, notes, official domains", async () => {
    const rows = parseDataset(await Bun.file(DATASET_URL).text());
    expect(validateDataset(rows, await context())).toEqual([]);
  });

  test("at least one row per planned country × intent cell, and ten comparisons", async () => {
    const rows = parseDataset(await Bun.file(DATASET_URL).text());
    const cells = new Set(rows.map(cellKey));
    expect(plannedCells().filter((c) => !cells.has(c))).toEqual([]);
    expect(rows.filter((r) => cellKey(r) === "comparison").length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeGreaterThanOrEqual(65);
  });

  test("validation catches bad rows", async () => {
    const ctx = await context();
    const bad: CoverageRow = { id: "x", text: "q", countries: ["atlantis"], intent: "visa_process" as never, stage: "someday", mustCover: ["E.001", "Z.999", "E.001"], officialDomains: ["example.com"] };
    const errors = validateDataset([bad, { ...bad }], ctx);
    expect(errors.some((e) => e.includes("unknown country atlantis"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown stage someday"))).toBe(true);
    expect(errors.some((e) => e.includes("Z.999 is not in the catalog"))).toBe(true);
    expect(errors.some((e) => e.includes("mustCover needs 4-6"))).toBe(true);
    expect(errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(errors.some((e) => e.includes("official domain example.com"))).toBe(true);
  });

  test("outsideChecklist reads the generated checklist of any of the row's countries", () => {
    const row = { countries: ["australia"], intent: "visa_process" as const, mustCover: ["E.001", "E.075"] };
    expect(outsideChecklist(row, CHECKLISTS)).toEqual(["E.075"]);
  });

  test("origin is optional, validated against the markets, and its checklist counts as in-checklist", async () => {
    const ctx = await context();
    const base: CoverageRow = { id: "o1", text: "Nepali student, loan for the 500 visa?", countries: ["australia"], intent: "financial_viability", mustCover: ["E.038", "E.057", "D.008", "L.001"] };
    expect(validateDataset([base], ctx)).toEqual([]);
    expect(validateDataset([{ ...base, origin: "nepal" }], ctx)).toEqual([]);
    expect(validateDataset([{ ...base, origin: "atlantis" }], ctx).some((e) => e.includes("unknown origin atlantis"))).toBe(true);
    // L.063 (loan lender type) is only in Nepal's market checklist, not Australia's.
    const loan = { countries: ["australia"], intent: "financial_viability" as const, mustCover: ["E.038", "L.063"] };
    expect(outsideChecklist(loan, CHECKLISTS)).toEqual(["L.063"]);
    expect(outsideChecklist({ ...loan, origin: "nepal" }, CHECKLISTS, MARKET_CHECKLISTS)).toEqual([]);
  });

  test("parseDataset skips blanks and comments and reports the bad line", () => {
    expect(parseDataset('# c\n\n{"id":"a"}\n').map((r) => r.id)).toEqual(["a"]);
    expect(() => parseDataset('{"id":"a"}\n{oops')).toThrow(/line 2/);
  });

  test("country aliases", () => {
    expect(["au", "UK", "gb", "ca", "us", "nz", "canada"].map(resolveCountry)).toEqual(["australia", "united_kingdom", "united_kingdom", "canada", "united_states", "new_zealand", "canada"]);
  });
});

describe("judge helpers", () => {
  const items = [
    { id: "E.001", label: "Student Visa Type", inChecklist: true },
    { id: "E.025", label: "Student visa application fee", inChecklist: true },
    { id: "E.075", label: "Study-gap scrutiny", inChecklist: false },
  ];

  test("prompt numbers evidence and truncates excerpts", () => {
    const p = buildJudgePrompt("Q?", "A [1]", [{ n: 1, title: "Visa page", url: "https://immi.homeaffairs.gov.au/x", live: true, content: "x".repeat(1000) }], items);
    expect(p).toContain("[1] Visa page — https://immi.homeaffairs.gov.au/x (live)");
    expect(p).toContain("- E.075: Study-gap scrutiny");
    expect(p).not.toContain("x".repeat(301));
  });

  test("normalizeVerdicts fills gaps and keeps verdicts consistent", () => {
    const v = normalizeVerdicts(
      { items: [{ id: "E.001", covered: true, cited: true, honestGap: true }, { id: "E.025", covered: false, cited: true, honestGap: true }] },
      items,
    );
    expect(v.map((x) => [x.id, x.covered, x.cited, x.honestGap])).toEqual([
      ["E.001", true, true, false],
      ["E.025", false, false, true],
      ["E.075", false, false, false],
    ]);
    expect(normalizeVerdicts(null, items).every((x) => !x.covered)).toBe(true);
  });

  test("citations, domains and official citation", () => {
    expect(citationsIn("a [2] b [1][2] c [10]")).toEqual([2, 1, 10]);
    expect(onDomains("https://www.immi.homeaffairs.gov.au/visas", ["homeaffairs.gov.au"])).toBe(true);
    expect(onDomains("https://nothomeaffairs.gov.au/", ["homeaffairs.gov.au"])).toBe(false);
    expect(onDomains("not a url", ["gov.uk"])).toBe(false);
    const ev = [
      { n: 1, url: "https://experteducation.com/au" },
      { n: 2, url: "https://www.gov.uk/student-visa" },
    ];
    expect(officialCited("Fee is £524 [2].", ev, ["gov.uk"])).toBe(true);
    expect(officialCited("Fee is £524 [1].", ev, ["gov.uk"])).toBe(false);
  });
});

describe("scoring and aggregation", () => {
  const v = (id: string, covered: boolean, cited: boolean, honestGap: boolean, inChecklist = true): ItemVerdict => ({ id, label: id, inChecklist, covered, cited, honestGap });

  test("scoreRow", () => {
    const s = scoreRow([v("a", true, true, false), v("b", true, false, false), v("c", false, false, true, false), v("d", false, false, false, false)], true);
    expect(s).toEqual({ coverage: 0.5, citedCoverage: 0.25, honesty: 0.75, inChecklistCoverage: 1, offChecklistCoverage: 0, official: 1 });
    expect(scoreRow([v("a", true, true, false)], null).official).toBeNull();
    expect(scoreRow([v("a", true, true, false)], null).offChecklistCoverage).toBeNull();
  });

  test("percentile (nearest rank)", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 95)).toBe(10);
  });

  const llm = (input: number, cached: number, cost: number | null) => ({ inputTokens: input, outputTokens: 100, cachedInputTokens: cached, reasoningTokens: 0, costUsd: cost, calls: 3, researchCalls: 1, answerModel: "m", researchModel: "m", classifierModel: "m", usedFallback: false });
  const row = (id: string, country: string, intent: string, coverage: number, latencyMs: number, extra: Partial<RowResult> = {}): RowResult => ({
    id,
    countries: [country],
    intent,
    cell: `${country}×${intent}`,
    comparison: false,
    ok: true,
    latencyMs,
    llm: llm(1000, 250, 0.01),
    evidence: [],
    routeMatch: true,
    scores: { coverage, citedCoverage: coverage / 2, honesty: 1, inChecklistCoverage: coverage, offChecklistCoverage: null, official: 1 },
    ...extra,
  });

  test("aggregate leaves errors out of the means and computes cost, cache share and latency", () => {
    const a = aggregate("x", [row("1", "australia", "visa_process", 1, 1000), row("2", "australia", "visa_process", 0.5, 3000), { ...row("3", "australia", "visa_process", 0, 9000), ok: false, scores: undefined, llm: undefined }]);
    expect(a.rows).toBe(3);
    expect(a.errors).toBe(1);
    expect(a.coverage).toBe(0.75);
    expect(a.citedCoverage).toBe(0.375);
    expect(a.cachedShare).toBe(0.25);
    expect(a.avgCostUsd).toBeCloseTo(0.01);
    expect(a.avgTokens).toBe(1100);
    expect(a.p50Ms).toBe(1000);
    expect(a.p95Ms).toBe(3000);
    expect(a.offChecklistCoverage).toBeNull();
  });

  test("avg cost is n/a when any turn is uncosted", () => {
    expect(aggregate("x", [row("1", "australia", "visa_process", 1, 1000, { llm: llm(10, 0, null) })]).avgCostUsd).toBeNull();
  });

  test("summarize splits comparisons and groups single rows", () => {
    const rows = [
      row("1", "australia", "visa_process", 1, 1000),
      row("2", "canada", "visa_process", 0, 1000),
      { ...row("3", "australia", "comparative_decision", 0.5, 2000), countries: ["australia", "canada"], comparison: true, cell: "comparison" },
    ];
    const s = summarize(rows);
    expect(s.overall.rows).toBe(3);
    expect(s.comparisons.rows).toBe(1);
    expect(s.byCountry.map((x) => x.key)).toEqual(["australia", "canada"]);
    expect(s.byIntent.map((x) => [x.key, x.coverage])).toEqual([["visa_process", 0.5]]);
    expect(s.byCell.map((x) => x.key)).toEqual(["australia×visa_process", "canada×visa_process"]);
    expect(formatSummary(s)).toContain("australia×visa_process");
  });

  test("routeMatches checks the origin only when the row has one, and reports it separately", () => {
    expect(routeMatches({ countries: ["australia"] }, { countries: ["australia"], origin: "nepal" })).toEqual({ routeMatch: true });
    expect(routeMatches({ countries: ["australia"], origin: "nepal" }, { countries: ["australia"], origin: "nepal" })).toEqual({ routeMatch: true, originMatch: true });
    expect(routeMatches({ countries: ["australia"], origin: "nepal" }, { countries: ["australia"], origin: null })).toEqual({ routeMatch: false, originMatch: false });
    expect(routeMatches({ countries: ["australia"], origin: "nepal" }, { countries: ["canada"], origin: "nepal" })).toEqual({ routeMatch: false, originMatch: true });
    expect(routeMatches({ countries: ["australia"], origin: "nepal" }, null)).toEqual({ routeMatch: false, originMatch: false });
  });

  test("summarize adds by-origin and origin × destination tables; rows without origin stay out of them", () => {
    const rows = [
      row("1", "australia", "visa_process", 1, 1000, { origin: "nepal", originMatch: true }),
      row("2", "canada", "visa_process", 0, 1000, { origin: "nepal", originMatch: false }),
      row("3", "australia", "visa_process", 0.5, 1000, { origin: "india", originMatch: true }),
      row("4", "australia", "visa_process", 0.5, 1000),
      { ...row("5", "australia", "comparative_decision", 0.5, 2000, { origin: "india", originMatch: true }), countries: ["australia", "canada"], comparison: true, cell: "comparison" },
    ];
    const s = summarize(rows);
    expect(s.byOrigin.map((x) => [x.key, x.rows, x.originMatch])).toEqual([
      ["origin:india", 2, 1],
      ["origin:nepal", 2, 0.5],
    ]);
    expect(s.byOriginDestination.map((x) => x.key)).toEqual(["india×australia", "india×comparison", "nepal×australia", "nepal×canada"]);
    expect(s.overall.originMatch).toBe(0.75);
    expect(summarize([row("1", "australia", "visa_process", 1, 1000)]).overall.originMatch).toBeNull();
    const text = formatSummary(s);
    expect(text).toContain("By origin");
    expect(text).toContain("Origin × destination");
    expect(text).toContain("nepal×canada");
    expect(formatSummary(summarize([row("1", "australia", "visa_process", 1, 1000)]))).not.toContain("By origin");
  });

  test("compareSummaries pairs origin keys too, and reads run files written before origins", () => {
    const a = summarize([row("1", "australia", "visa_process", 0.5, 1000, { origin: "nepal" })]);
    const b = summarize([row("1", "australia", "visa_process", 1, 1000, { origin: "nepal" })]);
    expect(compareSummaries(a, b).find((x) => x.key === "nepal×australia")!.coverage).toEqual([0.5, 1]);
    const old = { ...a } as Partial<typeof a>;
    delete old.byOrigin;
    delete old.byOriginDestination;
    expect(compareSummaries(old as typeof a, b).find((x) => x.key === "origin:nepal")!.coverage).toEqual([null, 1]);
  });

  test("compareSummaries pairs every key and formats deltas", () => {
    const a = summarize([row("1", "australia", "visa_process", 0.5, 1000)]);
    const b = summarize([row("1", "australia", "visa_process", 1, 2000), row("2", "canada", "policy_change", 1, 1000)]);
    const d = compareSummaries(a, b);
    expect(d[0]!.key).toBe("overall");
    const cell = d.find((x) => x.key === "australia×visa_process")!;
    expect(cell.coverage).toEqual([0.5, 1]);
    expect(cell.p50Ms).toEqual([1000, 2000]);
    expect(d.find((x) => x.key === "canada×policy_change")!.coverage).toEqual([null, 1]);
    const text = formatCompare("baseline", "packs", d);
    expect(text).toContain("50→100 +50");
    expect(text).toContain("+100%");
  });
});

describe("--counsellor-region", () => {
  test("origin: a counsellor in the row's own market; none, or a row without origin: no region", () => {
    expect(evalCounsellorRegion({ origin: "nepal" }, "origin")).toEqual({ market: "nepal", onshore: null, branch: null, source: "crm_branch" });
    expect(evalCounsellorRegion({}, "origin")).toBeNull();
    expect(evalCounsellorRegion({ origin: "nepal" }, "none")).toBeNull();
    expect(evalCounsellorRegion({ origin: "atlantis" }, "origin")).toBeNull();
  });

  test("rows are counted by the layer that supplied their origin", () => {
    const route = (originSource: string | null) => ({ route: { countries: ["australia"], mode: "single", origin: originSource ? "nepal" : null, originSource } });
    const counts = originSourceCounts([route("counsellor"), route("keywords"), route("counsellor"), route(null), { route: null }]);
    expect(counts).toEqual({ counsellor: 2, keywords: 1, none: 1 });
    expect(formatOriginSources(counts)).toBe("origin from: counsellor 2 · keywords 1 · none 1");
    expect(formatOriginSources({})).toBe("");
  });
});
