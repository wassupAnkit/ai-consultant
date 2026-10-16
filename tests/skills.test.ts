import { describe, expect, test } from "bun:test";
import { buildChecklists, buildMarketChecklists, csvRecords, freshnessOf, parseCsv, renderChecklistsModule, stagesFor, type CsvRow } from "../scripts/skills-build";
import { fetchAllowlist } from "../src/live/policy";
import { COUNTRY_PROMPTS } from "../src/prompts/countries";
import { localPrompts, PROMPT_NAMES } from "../src/prompts/registry";
import { findFacts, findNumbers } from "../src/skills/facts";
import {
  getPack,
  loadPackProse,
  officialDomainsAll,
  PACK_COUNTRIES,
  renderCountryBrief,
  renderCountryGuidance,
  resolvePacks,
} from "../src/skills/index";

const CSV_URL = new URL("../docs/data-model/catalog.csv", import.meta.url);
const GENERATED_URL = new URL("../src/skills/checklists.generated.ts", import.meta.url);

function csvRow(over: Partial<CsvRow> = {}): CsvRow {
  return {
    id: "E.001",
    attribute: "a",
    full_name: "Visa rule",
    entity: "VisaType",
    variant_axes: "-",
    data_type: "text",
    possible_values: "-",
    definition: "d",
    data_source: "Government / Immigration",
    collection_method: "llm_extraction",
    refresh_cadence: "on_policy_change",
    owner_role: "compliance",
    tier: "1",
    quotable: "disclaimer",
    today_field_path: "missing",
    countries: "all",
    stages: "S10",
    seed: "-",
    notes: "-",
    ...over,
  };
}

describe("no-facts guard", () => {
  test("rejects amounts, percentages, durations and years", () => {
    for (const bad of ["AUD 2,000", "costs $500", "£1,200 a month", "€ 3000", "about 20%", "50 percent", "takes 6 weeks", "up to 48 hours", "valid for 2 years", "from 2025", "a 12-month window", "IELTS 6.5"]) {
      expect(findFacts(bad).length).toBeGreaterThan(0);
    }
  });
  test("allows visa subclasses, form names and status identifiers", () => {
    for (const ok of ["subclass 500", "Subclass 485", "IMM 1294", "DS-160", "Form I-20", "F-1 visa", "Form 956", "H-1B", "condition 8105", "PIC 4020", "section 214(b)"]) {
      expect(findFacts(ok)).toEqual([]);
      expect(findNumbers(ok)).toEqual([]);
    }
    expect(findNumbers("about three intakes")).toEqual([]);
    expect(findNumbers("Grade 10 certificate")).not.toEqual([]);
  });
  test("no prose, checklist label or vocabulary term carries a fact", () => {
    for (const slug of PACK_COUNTRIES) {
      const prose = COUNTRY_PROMPTS[slug];
      expect({ slug, hits: findNumbers(prose) }).toEqual({ slug, hits: [] });
      const pack = getPack(slug)!;
      for (const items of Object.values(pack.checklists)) for (const it of items ?? []) expect({ id: it.id, hits: findFacts(it.label) }).toEqual({ id: it.id, hits: [] });
      for (const terms of Object.values(pack.vocabulary)) for (const t of terms ?? []) expect({ slug, t, hits: findNumbers(t) }).toEqual({ slug, t, hits: [] });
    }
  });
});

describe("skills-build", () => {
  test("parseCsv handles quotes, escaped quotes, commas and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\nplain,\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["plain", ""],
    ]);
  });
  test("stage and freshness mapping", () => {
    expect(stagesFor("S10")).toEqual(["coe_cas_i20", "visa_lodged", "visa_granted"]);
    expect(stagesFor("S10;S19")).toBeUndefined(); // S19 applies at any stage
    expect(freshnessOf("on_policy_change")).toBe("policy");
    expect(freshnessOf("semi_annual")).toBe("annual");
    expect(freshnessOf("per_intake")).toBe("stable");
  });
  test("round-robin across sections, tier then id inside one; origin-only, tier 3 and other countries skipped; cap 12", () => {
    const rows = [
      csvRow({ id: "E.001", full_name: "Generic tier one", tier: "1" }),
      csvRow({ id: "E.002", full_name: "AU tier two", tier: "2", countries: "AU;CA" }),
      csvRow({ id: "E.003", full_name: "Tier three", tier: "3", countries: "AU" }),
      csvRow({ id: "E.004", full_name: "Origin only", countries: "origin:NP" }),
      csvRow({ id: "E.005", full_name: "UK only", countries: "GB" }),
      csvRow({ id: "E.006", full_name: "Generic tier two", tier: "2" }),
      ...Array.from({ length: 20 }, (_, i) => csvRow({ id: `E.${String(100 + i)}`, full_name: `Filler`, tier: "2" })),
    ];
    const out = buildChecklists(rows);
    const au = out.australia.visa_process!;
    // Sections for visa_process: visa type (E.001–024, most central), onshore switching (E.107–112), documents (E.113–122).
    expect(au.map((i) => i.id).slice(0, 6)).toEqual(["E.001", "E.107", "E.113", "E.002", "E.108", "E.114"]);
    expect(au).toHaveLength(12);
    expect(au.some((i) => ["E.003", "E.004", "E.005"].includes(i.id))).toBe(false);
    expect(au.some((i) => i.id === "E.100")).toBe(false); // refusal section feeds visa_risk_analysis, not visa_process
    expect(out.united_kingdom.visa_process!.map((i) => i.id).slice(0, 2)).toEqual(["E.001", "E.107"]);
    expect(au.find((i) => i.id === "E.002")).toEqual({ id: "E.002", label: "AU tier two", stages: ["coe_cas_i20", "visa_lodged", "visa_granted"], freshness: "policy" });
  });
  test("labels carrying a fact are dropped", () => {
    const out = buildChecklists([csvRow({ full_name: "ISCED 2011 level" }), csvRow({ id: "E.002", full_name: "Clean label" })]);
    expect(out.australia.visa_process!.map((i) => i.id)).toEqual(["E.002"]);
  });
  test("checklists.generated.ts is in sync with catalog.csv", async () => {
    const committed = await Bun.file(GENERATED_URL).text();
    const rows = csvRecords(await Bun.file(CSV_URL).text());
    expect(committed).toBe(renderChecklistsModule(buildChecklists(rows), buildMarketChecklists(rows)));
    expect(committed.startsWith("// generated by scripts/skills-build.ts — do not edit")).toBe(true);
  });
});

describe("packs", () => {
  test("five v1 packs, sorted, versioned, with real-looking official domains", () => {
    expect([...PACK_COUNTRIES]).toEqual(["australia", "canada", "new_zealand", "united_kingdom", "united_states"]);
    for (const slug of PACK_COUNTRIES) {
      const p = getPack(slug)!;
      expect(p.version).toBe("2026-10-08");
      expect(p.officialSources.some((s) => s.authority === "immigration" && s.topics === "all")).toBe(true);
      for (const s of p.officialSources) expect(s.domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      for (const terms of Object.values(p.vocabulary)) expect((terms ?? []).length).toBeLessThanOrEqual(8);
      expect(p.checklists.visa_process?.length).toBeGreaterThan(3);
    }
    expect(getPack("germany")).toBeNull();
    expect(getPack("nowhere")).toBeNull();
  });
  test("officialDomainsAll is the deduped union", () => {
    const all = officialDomainsAll();
    expect(all).toEqual([...new Set(all)].sort());
    for (const d of ["immi.homeaffairs.gov.au", "gov.uk", "canada.ca", "studyinthestates.dhs.gov", "immigration.govt.nz"]) expect(all).toContain(d);
  });
  test("the fetch allowlist includes every pack domain plus env extras", () => {
    const allow = fetchAllowlist(["daad.de"]);
    for (const d of officialDomainsAll()) expect(allow).toContain(d);
    expect(allow).toContain("daad.de");
    expect(allow).toContain("experteducation.com");
  });
});

describe("resolvePacks", () => {
  test("ignores non-pack countries, sorts by slug, reports versions", () => {
    const r = resolvePacks({ countries: ["united_states", "germany", "australia"], topic: "visa_process" });
    expect(r.packs.map((p) => p.country)).toEqual(["australia", "united_states"]);
    expect(r.versions).toEqual(["australia@2026-10-08", "united_states@2026-10-08"]);
    expect(resolvePacks({ countries: ["germany"], topic: "visa_process" }).packs).toEqual([]);
  });
  test("operational topics load no packs", () => {
    expect(resolvePacks({ countries: ["australia"], topic: "greeting" }).packs).toEqual([]);
  });
  test("comparison and selection topics load no destination pack; a comparison route loads none either", () => {
    for (const topic of ["comparative_decision", "university_selection", "program_selection", "test_preparation"] as const) {
      expect(resolvePacks({ countries: ["australia"], topic })).toEqual({ packs: [], versions: [] });
    }
    expect(resolvePacks({ countries: ["australia", "canada"], topic: "visa_process", comparison: true }).packs).toEqual([]);
    // Packs still help rule-shaped topics, and a secondary comparison topic alone does not drop them.
    for (const topic of ["visa_process", "document_preparation", "offer_enrolment", "eligibility_check", "onshore_support", "family_planning", "migration_pathway"] as const) {
      expect(resolvePacks({ countries: ["australia"], topic, secondaryTopics: ["program_selection"] }).packs).toHaveLength(1);
    }
  });
  test("checklist is filtered by topic, merged with secondary topics, deduped and capped", () => {
    const base = resolvePacks({ countries: ["australia"], topic: "visa_process" }).packs[0]!;
    expect(base.checklist.map((i) => i.id)).toEqual(getPack("australia")!.checklists.visa_process!.map((i) => i.id));
    const merged = resolvePacks({ countries: ["australia"], topic: "visa_process", secondaryTopics: ["financial_viability", "visa_process"] }).packs[0]!;
    const ids = merged.checklist.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(12);
    const fin = resolvePacks({ countries: ["australia"], topic: "financial_viability" }).packs[0]!;
    const small = resolvePacks({ countries: ["australia"], topic: "financial_viability", secondaryTopics: ["family_planning"] }).packs[0]!;
    expect(small.checklist.slice(0, fin.checklist.length)).toEqual(fin.checklist.slice(0, 12));
  });
  test("stage filter keeps stage-matching and stageless items, falls back below three", () => {
    const all = resolvePacks({ countries: ["australia"], topic: "visa_process" }).packs[0]!.checklist;
    const lodged = resolvePacks({ countries: ["australia"], topic: "visa_process", stage: "visa_lodged" }).packs[0]!.checklist;
    for (const i of lodged) expect(!i.stages || i.stages.includes("visa_lodged")).toBe(true);
    const enquiry = resolvePacks({ countries: ["australia"], topic: "visa_process", stage: "enquiry" }).packs[0]!.checklist;
    const enquiryMatches = all.filter((i) => !i.stages || i.stages.includes("enquiry"));
    expect(enquiry).toEqual(enquiryMatches.length >= 3 ? enquiryMatches : all);
    expect(resolvePacks({ countries: ["australia"], topic: "visa_process", stage: "unspecified" }).packs[0]!.checklist).toEqual(all);
  });
  test("official domains follow the topic and always include an immigration source for visa topics", () => {
    const visa = resolvePacks({ countries: ["united_states"], topic: "visa_process" }).packs[0]!;
    expect(visa.officialDomains).toContain("travel.state.gov");
    expect(visa.officialDomains).not.toContain("collegeboard.org");
    const tests = resolvePacks({ countries: ["united_states"], topic: "eligibility_check" }).packs[0]!;
    expect(tests.officialDomains).toContain("ets.org");
    for (const slug of PACK_COUNTRIES) {
      for (const topic of ["visa_process", "visa_risk_analysis", "document_preparation", "migration_pathway", "policy_change"] as const) {
        const p = resolvePacks({ countries: [slug], topic }).packs[0]!;
        const imm = getPack(slug)!.officialSources.filter((s) => s.authority === "immigration" || s.authority === "government").map((s) => s.domain);
        expect(p.officialDomains.some((d) => imm.includes(d))).toBe(true);
      }
    }
    expect(visa.vocabulary).toContain("DS-160");
  });
});

describe("render", () => {
  const prose = Object.fromEntries(PACK_COUNTRIES.map((s) => [s, COUNTRY_PROMPTS[s]]));
  test("empty resolution renders nothing", () => {
    const none = resolvePacks({ countries: [], topic: "visa_process" });
    expect(renderCountryBrief(none)).toBe("");
    expect(renderCountryGuidance(none, prose)).toBe("");
  });
  test("research brief lists sources, vocabulary and coverage, byte-stable", () => {
    const r = resolvePacks({ countries: ["australia"], topic: "visa_process", stage: "visa_lodged" });
    const brief = renderCountryBrief(r);
    expect(brief.startsWith("# Country brief")).toBe(true);
    expect(brief).toContain("immi.homeaffairs.gov.au");
    expect(brief).toContain("Evidence should cover:");
    expect(brief).toContain(r.packs[0]!.checklist[0]!.label);
    expect(renderCountryBrief(resolvePacks({ countries: ["australia"], topic: "visa_process", stage: "visa_lodged" }))).toBe(brief);
    expect(brief.length).toBeLessThan(2500);
  });
  test("country order does not change the output", () => {
    const a = resolvePacks({ countries: ["canada", "australia"], topic: "migration_pathway" });
    const b = resolvePacks({ countries: ["australia", "canada", "australia"], topic: "migration_pathway" });
    expect(renderCountryBrief(a)).toBe(renderCountryBrief(b));
    expect(renderCountryGuidance(a, prose)).toBe(renderCountryGuidance(b, prose));
  });
  test("answer guidance carries prose, checklist and the not-in-KB instruction", () => {
    const g = renderCountryGuidance(resolvePacks({ countries: ["united_kingdom"], topic: "visa_process" }), prose);
    expect(g.startsWith("# Country guidance")).toBe(true);
    expect(g).toContain(COUNTRY_PROMPTS.united_kingdom.trim());
    expect(g).toContain("Coverage checklist");
    expect(g).toContain("Not in the knowledge base:");
    expect(g).not.toContain("aligned table");
  });
  test("comparison asks for an aligned table", () => {
    const g = renderCountryGuidance(resolvePacks({ countries: ["australia", "canada"], topic: "migration_pathway" }), prose);
    expect(g).toContain("aligned table");
    expect(g).toContain("## Australia");
    expect(g).toContain("## Canada");
  });
});

describe("prompt registry", () => {
  test("registers a country prompt per pack", () => {
    const local = localPrompts();
    for (const slug of PACK_COUNTRIES) {
      expect(PROMPT_NAMES.country(slug)).toBe(`edge-consultant-country-${slug.replace(/_/g, "-")}`);
      expect(local[PROMPT_NAMES.country(slug)]).toBe(COUNTRY_PROMPTS[slug]);
      const words = COUNTRY_PROMPTS[slug].split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(150);
      expect(words).toBeLessThanOrEqual(320);
    }
  });
  test("loadPackProse reads each slug through the registry", async () => {
    const asked: string[] = [];
    const registry = { get: async (name: string) => (asked.push(name), { name, text: `text for ${name}`, source: "local" as const, hash: "h" }) };
    const out = await loadPackProse(registry, ["united_kingdom", "australia"]);
    expect(Object.keys(out)).toEqual(["australia", "united_kingdom"]);
    expect(out.australia).toBe("text for edge-consultant-country-australia");
    expect(asked.sort()).toEqual(["edge-consultant-country-australia", "edge-consultant-country-united-kingdom"]);
  });
});
