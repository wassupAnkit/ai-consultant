import { describe, expect, test } from "bun:test";
import { buildChecklists, buildMarketChecklists, csvRecords, MARKET_CAP_PER_TOPIC, renderChecklistsModule, type CsvRow } from "../scripts/skills-build";
import { fetchAllowlist } from "../src/live/policy";
import { MARKET_PROMPTS } from "../src/prompts/markets";
import { localPrompts, PROMPT_NAMES } from "../src/prompts/registry";
import { MARKETS } from "../src/routing/markets";
import { MARKET_CHECKLISTS } from "../src/skills/checklists.generated";
import { findFacts, findNumbers } from "../src/skills/facts";
import {
  getMarketPack,
  loadMarketProse,
  marketDomainsAll,
  queryVocabulary,
  renderMarketBrief,
  renderMarketGuidance,
  renderSkillsBrief,
  renderSkillsGuidance,
  resolveMarket,
  resolvePacks,
} from "../src/skills/index";

const CSV_URL = new URL("../docs/data-model/catalog.csv", import.meta.url);
const GENERATED_URL = new URL("../src/skills/checklists.generated.ts", import.meta.url);

function csvRow(over: Partial<CsvRow> = {}): CsvRow {
  return {
    id: "L.063",
    attribute: "a",
    full_name: "Loan lender type",
    entity: "SourceCountry",
    variant_axes: "-",
    data_type: "enum",
    possible_values: "-",
    definition: "d",
    data_source: "Bank",
    collection_method: "admin_entry",
    refresh_cadence: "annual",
    owner_role: "finance",
    tier: "1",
    quotable: "yes",
    today_field_path: "missing",
    countries: "origin:NP;origin:IN",
    stages: "S8",
    seed: "-",
    notes: "-",
    ...over,
  };
}

const words = (s: string) => s.trim().split(/\s+/).length;

describe("market checklists (skills-build)", () => {
  test("origin rows go to their markets only; nationality rows to every market; origin rows first; cap 8", () => {
    const rows = [
      csvRow({ id: "L.063", full_name: "Loan lender type" }),
      csvRow({ id: "L.084", full_name: "Origin remittance limit", countries: "origin:NP" }),
      csvRow({ id: "E.057", full_name: "Accepted fund types", countries: "all", variant_axes: "nationality", entity: "VisaType" }),
      csvRow({ id: "E.038", full_name: "Funds without nationality axis", countries: "all", variant_axes: "level", entity: "VisaType" }),
      csvRow({ id: "E.045", full_name: "AU-only nationality row", countries: "AU;CA", variant_axes: "nationality", entity: "VisaType" }),
      csvRow({ id: "L.064", full_name: "Tier three", tier: "3" }),
      csvRow({ id: "L.065", full_name: "A url", data_type: "url" }),
      ...Array.from({ length: 12 }, (_, i) => csvRow({ id: `E.${String(57 + i + 1).padStart(3, "0")}`, full_name: `Filler`, countries: "all", variant_axes: "nationality" })),
    ];
    const out = buildMarketChecklists(rows);
    const np = out.nepal.financial_viability!.map((i) => i.id);
    expect(np.slice(0, 2)).toEqual(["L.063", "L.084"]);
    expect(np).toContain("E.057");
    expect(np).toHaveLength(MARKET_CAP_PER_TOPIC);
    expect(np.some((id) => ["E.038", "E.045", "L.064", "L.065"].includes(id))).toBe(false);
    expect(out.india.financial_viability!.map((i) => i.id).slice(0, 2)).toEqual(["L.063", "E.057"]);
    expect(out.vietnam.financial_viability!.map((i) => i.id)[0]).toBe("E.057");
  });

  test("source-country grading rows are mapped by section (documents → document_preparation)", () => {
    const out = buildMarketChecklists([csvRow({ id: "U.068", full_name: "Apostille Available", countries: "origin:PH", stages: "S7;S10" }), csvRow({ id: "U.058", full_name: "Transcript Issuer", countries: "origin:PH", stages: "S7" }), csvRow({ id: "U.001", full_name: "Grading Scheme ID", countries: "origin:PH", stages: "S5" })]);
    expect(out.philippines.document_preparation!.map((i) => i.id)).toEqual(["U.058", "U.068"]);
    expect(out.philippines.visa_process!.map((i) => i.id)).toEqual(["U.068"]);
    expect(out.philippines.eligibility_check!.map((i) => i.id)).toEqual(["U.001"]);
    expect(out.nepal.document_preparation).toBeUndefined();
  });

  test("the U section mapping leaves destination checklists unchanged (only origin rows use it)", () => {
    const out = buildChecklists([csvRow({ id: "U.083", full_name: "Destination equivalence", countries: "all", stages: "S5" })]);
    expect(out.australia.eligibility_check!.map((i) => i.id)).toEqual(["U.083"]);
  });

  test("checklists.generated.ts (MARKET_CHECKLISTS included) is in sync with catalog.csv", async () => {
    const rows = csvRecords(await Bun.file(CSV_URL).text());
    expect(await Bun.file(GENERATED_URL).text()).toBe(renderChecklistsModule(buildChecklists(rows), buildMarketChecklists(rows)));
    for (const m of MARKETS) {
      expect(Object.keys(MARKET_CHECKLISTS[m]).length).toBeGreaterThan(5);
      for (const items of Object.values(MARKET_CHECKLISTS[m])) expect(items!.length).toBeLessThanOrEqual(MARKET_CAP_PER_TOPIC);
    }
    expect(MARKET_CHECKLISTS.nepal.financial_viability!.map((i) => i.id)).toContain("L.063");
    expect(Object.values(MARKET_CHECKLISTS.nepal).flat().some((i) => i!.id === "U.082")).toBe(true);
    expect(Object.values(MARKET_CHECKLISTS.thailand).flat().some((i) => i!.id === "U.082")).toBe(false);
  });
});

describe("market packs", () => {
  test("one pack per market, versioned, with draft language and real-looking official domains", () => {
    for (const m of MARKETS) {
      const p = getMarketPack(m)!;
      expect(p.market).toBe(m);
      expect(p.version).toBe("2026-10-08b");
      expect(p.languages.draft.length).toBeGreaterThan(3);
      expect(p.officialSources.length).toBeGreaterThanOrEqual(3);
      expect(p.officialSources.some((s) => s.authority === "central_bank")).toBe(true);
      for (const s of p.officialSources) expect(s.domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      for (const terms of Object.values(p.vocabulary)) expect((terms ?? []).length).toBeLessThanOrEqual(8);
      expect(p.vocabulary.financial_viability?.length).toBeGreaterThan(2);
    }
    expect(getMarketPack("malaysia")).toBeNull();
  });

  test("the domains named in the brief", () => {
    const all = marketDomainsAll();
    expect(all).toEqual([...new Set(all)].sort());
    for (const d of ["moest.gov.np", "nrb.org.np", "rbi.org.in", "bb.org.bd", "sbv.gov.vn", "ched.gov.ph", "cfo.gov.ph", "bot.or.th", "cbsl.gov.lk", "ugc.ac.lk"]) expect(all).toContain(d);
    const allow = fetchAllowlist();
    for (const d of all) expect(allow).toContain(d);
  });

  test("sources and prose follow the cited research in docs/markets", () => {
    const all = marketDomainsAll();
    // Service hosts the research names.
    for (const d of ["noc.moest.gov.np", "esanad.nic.in", "incometax.gov.in", "mygov.bd", "mps.gov.vn", "dichvucong.gov.vn", "apostille.gov.ph", "consular.go.th", "sbpolice.go.th", "rgd.gov.lk"]) expect(all).toContain(d);
    // Replaced or unsupported by the research.
    for (const d of ["royalthaipolice.go.th", "incometaxindia.gov.in", "aiu.ac.in"]) expect(all).not.toContain(d);
    // CFO seminars are for emigrants and exchange visitors, not ordinary degree students.
    expect(MARKET_PROMPTS.philippines).not.toMatch(/guidance and counsel/i);
    expect(getMarketPack("philippines")!.officialSources.find((s) => s.domain === "cfo.gov.ph")!.topics).not.toBe("all");
    expect(MARKET_PROMPTS.philippines).toContain("not ordinary degree students");
    // Sri Lanka's attestation status is a check, not an assertion.
    expect(MARKET_PROMPTS.sri_lanka).toContain("check whether the foreign ministry's attestation service is operating");
  });

  test("no-facts guard: prose, labels, vocabulary and draft language carry no number", () => {
    for (const m of MARKETS) {
      expect({ m, hits: findNumbers(MARKET_PROMPTS[m]) }).toEqual({ m, hits: [] });
      const p = getMarketPack(m)!;
      expect(findNumbers(p.label + " " + p.languages.draft)).toEqual([]);
      for (const terms of Object.values(p.vocabulary)) for (const t of terms ?? []) expect({ m, t, hits: findNumbers(t) }).toEqual({ m, t, hits: [] });
      for (const items of Object.values(p.checklists)) for (const it of items ?? []) expect({ id: it.id, hits: findFacts(it.label) }).toEqual({ id: it.id, hits: [] });
    }
  });

  test("prose is 300-450 words and registered as edge-consultant-market-<slug>", () => {
    const local = localPrompts();
    for (const m of MARKETS) {
      const n = words(MARKET_PROMPTS[m]);
      expect({ m, ok: n >= 300 && n <= 450, n }).toEqual({ m, ok: true, n });
      expect(PROMPT_NAMES.market(m)).toBe(`edge-consultant-market-${m.replace(/_/g, "-")}`);
      expect(local[PROMPT_NAMES.market(m)]).toBe(MARKET_PROMPTS[m]);
    }
  });
});

describe("resolveMarket and rendering", () => {
  test("null for no market, an unknown market, or a topic that never loads a pack", () => {
    expect(resolveMarket({ market: null, topic: "visa_process" })).toBeNull();
    expect(resolveMarket({ market: "atlantis", topic: "visa_process" })).toBeNull();
    expect(resolveMarket({ market: "nepal", topic: "greeting" })).toBeNull();
  });

  test("merges topics, filters sources by topic, caps checklist and vocabulary", () => {
    const fin = resolveMarket({ market: "nepal", topic: "financial_viability" })!;
    expect(fin.label).toBe("Nepal");
    expect(fin.officialDomains).toContain("nrb.org.np");
    expect(fin.checklist.length).toBeGreaterThan(0);
    expect(fin.checklist.length).toBeLessThanOrEqual(8);
    expect(fin.vocabulary.length).toBeLessThanOrEqual(8);
    const merged = resolveMarket({ market: "nepal", topic: "financial_viability", secondaryTopics: ["document_preparation"] })!;
    expect(merged.vocabulary.length).toBeGreaterThanOrEqual(fin.vocabulary.length);
    expect(new Set(merged.checklist.map((i) => i.id)).size).toBe(merged.checklist.length);
    // A topic no source lists still gets the market's general sources.
    expect(resolveMarket({ market: "thailand", topic: "lifestyle_adaptation" })!.officialDomains.length).toBeGreaterThan(0);
  });

  test("brief and guidance: headings, sources, checklist, language instruction; empty without a market", () => {
    expect(renderMarketBrief(null)).toBe("");
    expect(renderMarketGuidance(null, "x")).toBe("");
    const r = resolveMarket({ market: "nepal", topic: "visa_process", stage: "visa_lodged" })!;
    const brief = renderMarketBrief(r);
    expect(brief.startsWith("# Student market\n")).toBe(true);
    expect(brief).toContain("moest.gov.np");
    const g = renderMarketGuidance(r, "Nepal prose.");
    expect(g.startsWith("# Market guidance (student from Nepal)\nNepal prose.")).toBe(true);
    expect(g).toContain("## Origin-side checklist");
    expect(g).toContain("Nepali (Devanagari) or Romanized Nepali");
    expect(renderMarketGuidance(r, "")).not.toContain("\n\n\n");
  });

  test("byte-deterministic, and combined with destination packs in a fixed order", () => {
    const a = resolveMarket({ market: "india", topic: "financial_viability", secondaryTopics: ["visa_process"] })!;
    const b = resolveMarket({ market: "india", topic: "financial_viability", secondaryTopics: ["visa_process", "financial_viability"] })!;
    expect(renderMarketBrief(a)).toBe(renderMarketBrief(b));
    const dest = resolvePacks({ countries: ["australia"], topic: "financial_viability" });
    const both = { ...dest, market: a };
    const brief = renderSkillsBrief(both);
    expect(brief.indexOf("# Country brief")).toBeLessThan(brief.indexOf("# Student market"));
    const g = renderSkillsGuidance(both, { australia: "AU prose" }, "IN prose");
    expect(g.indexOf("# Country guidance")).toBeLessThan(g.indexOf("# Market guidance (student from India)"));
    // Market only, and neither.
    expect(renderSkillsBrief({ packs: [], versions: [], market: a })).toBe(renderMarketBrief(a));
    expect(renderSkillsBrief({ packs: [], versions: [] })).toBe("");
    expect(renderSkillsGuidance({ packs: [], versions: [] }, {}, null)).toBe("");
  });

  test("round-0 vocabulary adds at most two market terms after the destination terms", () => {
    const dest = resolvePacks({ countries: ["australia"], topic: "financial_viability" });
    const market = resolveMarket({ market: "nepal", topic: "financial_viability" })!;
    const plain = queryVocabulary(dest, 6);
    const withMarket = queryVocabulary({ ...dest, market }, 6);
    expect(withMarket.slice(0, plain.length)).toEqual(plain);
    expect(withMarket.slice(plain.length)).toEqual(market.vocabulary.slice(0, 2));
    expect(queryVocabulary({ packs: [], versions: [], market }, 6)).toEqual(market.vocabulary.slice(0, 2));
  });

  test("loadMarketProse reads the market prompt through the registry", async () => {
    const asked: string[] = [];
    const registry = { get: async (name: string) => (asked.push(name), { name, text: `text:${name}`, source: "local" as const, hash: "h" }) };
    expect(await loadMarketProse(registry, "sri_lanka")).toBe("text:edge-consultant-market-sri-lanka");
    expect(await loadMarketProse(registry, null)).toBeNull();
    expect(asked).toEqual(["edge-consultant-market-sri-lanka"]);
  });
});
