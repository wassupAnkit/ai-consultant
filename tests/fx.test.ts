import { describe, expect, test } from "bun:test";
import { CONSULTANT_SYSTEM_PROMPT, NO_RESEARCH_NOTE } from "../src/prompts/consultant";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { CITE_FX_INSTRUCTION, currencyInstruction, FX_SECTION, fxPlan, KEEP_SOURCE_CURRENCY_INSTRUCTION, runFxSearch } from "../src/graph/fx";
import type { CounsellorRegion } from "../src/routing/markets";
import type { WebSearcher } from "../src/tools";
import { fakeGraph, intentOf, sampleChunk } from "./helpers";

/** Web searcher that records calls and answers with one page on the requested site plus one elsewhere. */
const fakeWeb = (opts: { fail?: boolean; hosts?: string[] } = {}) => {
  const calls: { query: string; site?: string }[] = [];
  const searcher: WebSearcher = {
    async search(query, o) {
      calls.push({ query, site: o.site });
      if (opts.fail) throw new Error("search backend down");
      const hosts = opts.hosts ?? [o.site ?? "example.com", "xe.com"];
      return {
        query,
        summary: "",
        queries: [query],
        fromCache: false,
        results: hosts.map((h) => ({ url: `https://www.${h}/forex`, title: `${h} rates`, snippet: "Indian Rupee 100 = NPR 160.15; U.S. Dollar 1 = NPR 136.42 (buying), 137.02 (selling), 9 October 2026", allowed: true })),
      };
    },
  };
  return { searcher, calls };
};

describe("fxPlan: when a home-currency total is asked", () => {
  test("a currency code or name asks for that market's central bank, against the destination's currency", () => {
    expect(fxPlan("What is the total in NPR?", "nepal", ["australia"])).toMatchObject({ market: "nepal", currency: "NPR", base: "AUD", site: "nrb.org.np", bank: "Nepal Rastra Bank" });
    expect(fxPlan("How much is that in Indian rupees?", null, ["united_kingdom"])).toMatchObject({ currency: "INR", base: "GBP", site: "rbi.org.in" });
    expect(fxPlan("convert to BDT please", null, ["canada"])).toMatchObject({ currency: "BDT", base: "CAD", site: "bb.org.bd" });
    expect(fxPlan("in VND?", null, ["new_zealand"])).toMatchObject({ currency: "VND", base: "NZD", site: "sbv.gov.vn" });
    expect(fxPlan("in pesos", null, ["united_states"])).toMatchObject({ currency: "PHP", base: "USD", site: "bsp.gov.ph" });
    expect(fxPlan("how many baht is that", null, ["australia"])).toMatchObject({ currency: "THB", site: "bot.or.th" });
    expect(fxPlan("total in LKR", null, ["australia"])).toMatchObject({ currency: "LKR", site: "cbsl.gov.lk" });
    expect(fxPlan("What is the total in NPR?", "nepal", ["australia"])!.query).toBe("AUD to NPR exchange rate today Nepal Rastra Bank");
  });

  test("lakh, crore or 'our currency' use the routed origin market, and need one", () => {
    expect(fxPlan("Give the total funds in lakh", "india", ["australia"])).toMatchObject({ currency: "INR", site: "rbi.org.in" });
    expect(fxPlan("how many crore is that?", "nepal", ["united_kingdom"])).toMatchObject({ currency: "NPR", base: "GBP" });
    expect(fxPlan("Show it in our currency too", "sri_lanka", ["australia"])).toMatchObject({ currency: "LKR" });
    expect(fxPlan("Show it in our currency too", null, ["australia"])).toBeNull();
    expect(fxPlan("Give the total funds in lakh", null, ["australia"])).toBeNull();
  });

  test("no currency asked, or the destination already uses it → no plan; no destination → USD", () => {
    expect(fxPlan("What is the total cost for the first year?", "nepal", ["australia"])).toBeNull();
    expect(fxPlan("Draft a note to Dong Nguyen about his CoE", "vietnam", ["australia"])).toBeNull();
    expect(fxPlan("is 500 million dong enough?", null, ["australia"])).toMatchObject({ currency: "VND" });
    expect(fxPlan("How much in baht?", "thailand", ["thailand"])).toBeNull();
    expect(fxPlan("in NPR please", "nepal", [])).toMatchObject({ base: "USD", currency: "NPR" });
  });
});

describe("runFxSearch", () => {
  const plan = fxPlan("What is the total in NPR?", "nepal", ["australia"])!;

  test("keeps only results from the central bank's own site, as live dated evidence", async () => {
    const { searcher, calls } = fakeWeb();
    const out = await runFxSearch(searcher, plan, { timeoutMs: 1_000 });
    expect(calls).toEqual([{ query: plan.query, site: "nrb.org.np" }]);
    expect(out.chunks.map((c) => c.url)).toEqual(["https://www.nrb.org.np/forex"]);
    expect(out.chunks[0]).toMatchObject({ title: "Nepal Rastra Bank — AUD/NPR exchange rate", section: "exchange rate (central bank)" });
    expect(out.chunks[0]!.fetchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(out.record).toMatchObject({ tool: "web_search", ok: true, args: { query: plan.query, site: "nrb.org.np" } });
  });

  test("no official result or a failed search → no evidence (the answer then says the rate is unavailable)", async () => {
    expect((await runFxSearch(fakeWeb({ hosts: ["xe.com"] }).searcher, plan, { timeoutMs: 1_000 })).chunks).toEqual([]);
    const failed = await runFxSearch(fakeWeb({ fail: true }).searcher, plan, { timeoutMs: 1_000 });
    expect(failed.chunks).toEqual([]);
    expect(failed.record.ok).toBe(false);
  });
});

describe("FX in the research turn", () => {
  const nepalCounsellor: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };
  const Q = "Total first-year funds for a Bachelor in Sydney, in NPR please";
  const ask = intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: Q, task: "calculate", needs_research: true });
  const run = async (web: WebSearcher, research: { maxRounds: number; fxRates?: boolean } = { maxRounds: 0 }) => {
    const { graph } = fakeGraph({ intent: ask, research, chunks: [sampleChunk(1)], tools: { web } });
    return graph.invoke({ input: Q, history: [], sessionId: "s1", profile: null, counsellorRegion: nepalCounsellor });
  };

  test("the central bank's rate is added as live evidence beside the official search", async () => {
    const { searcher, calls } = fakeWeb();
    const state = await run(searcher);
    expect(calls.map((c) => c.site)).toContain("nrb.org.np");
    const fx = state.evidence.filter((e) => e.url.startsWith("https://www.nrb.org.np/"));
    expect(fx.map((e) => [e.kind, e.live])).toEqual([["web", true]]);
    expect(state.meta.round0Fx).toEqual({ site: "nrb.org.np", currency: "NPR", base: "AUD", added: 1 });
  });

  test("nothing official found → no FX evidence, recorded as added 0; off with research.fxRates=false", async () => {
    const state = await run(fakeWeb({ hosts: ["xe.com"] }).searcher);
    expect(state.evidence.some((e) => e.url.includes("xe.com") && e.title.includes("exchange rate"))).toBe(false);
    expect(state.meta.round0Fx).toEqual({ site: "nrb.org.np", currency: "NPR", base: "AUD", added: 0 });
    const { searcher, calls } = fakeWeb();
    await run(searcher, { maxRounds: 0, fxRates: false });
    expect(calls.map((c) => c.site)).not.toContain("nrb.org.np");
  });

  test("the answer prompt forbids guessing a rate", () => {
    const rule = CONSULTANT_SYSTEM_PROMPT.match(/^6b\. .+$/m)?.[0] ?? "";
    expect(rule).toContain("central-bank");
    expect(rule).toContain("rate isn't available");
  });
});

// Counsellor audit N23: "Make it shorter for the father, in Nepali" after a UK cost answer in GBP
// came back with "रु. २०–६५ लाख" conversions and no central-bank rate in evidence.
describe("currencies on a rewrite, translation or draft turn", () => {
  const nepalCounsellor: CounsellorRegion = { market: "nepal", onshore: null, branch: "Kathmandu (Putalisadak)", source: "crm_branch" };
  const previous = "UK costs for one year: tuition GBP 15,000–22,000 [1]; living GBP 12,006 outside London [2]. Total about GBP 27,000–34,000.";
  const history = [new HumanMessage("Total first-year cost for a master's in Manchester?"), new AIMessage(previous)];
  const rewriteIntent = (input: string) => intentOf({ primary_intent: "financial_viability", destinations: ["united_kingdom"], user_question: input, task: "translate", needs_research: false });
  const run = async (input: string, web: WebSearcher, research: { maxRounds: number; fxRates?: boolean } = { maxRounds: 0 }) => {
    const { graph } = fakeGraph({ intent: rewriteIntent(input), research, chunks: [sampleChunk(1)], tools: { web } });
    const state = await graph.invoke({ input, history, priorAnswer: previous, sessionId: "s1", profile: null, counsellorRegion: nepalCounsellor });
    return { state, prompt: String(state.meta.systemPromptText) };
  };

  test("currencyInstruction: cite the rate when a central-bank excerpt is in evidence, else convert nothing", () => {
    expect(currencyInstruction([])).toBe(KEEP_SOURCE_CURRENCY_INSTRUCTION);
    expect(currencyInstruction([{ section: "Tuition & Costs" }, { section: FX_SECTION }])).toBe(CITE_FX_INSTRUCTION);
    expect(KEEP_SOURCE_CURRENCY_INSTRUCTION).toContain("Do not convert any amount");
    expect(KEEP_SOURCE_CURRENCY_INSTRUCTION).toContain("exchange rate isn't available");
    expect(CITE_FX_INSTRUCTION).toContain("date");
  });

  test("a rewrite that asks for no currency: no rate search, and the prompt forbids converting", async () => {
    const { searcher, calls } = fakeWeb();
    const { state, prompt } = await run("Make it shorter for the father, in Nepali", searcher);
    expect(calls).toEqual([]);
    expect(state.meta.rewriteOfPrevious).toBe(true);
    expect(prompt).toContain(KEEP_SOURCE_CURRENCY_INSTRUCTION);
    expect(prompt).not.toContain(CITE_FX_INSTRUCTION);
  });

  test("a rewrite that asks for lakh fetches the central bank's rate and must cite it with its date", async () => {
    const { searcher, calls } = fakeWeb();
    const { state, prompt } = await run("Make it shorter for the father, in Nepali, with the amounts in lakh", searcher);
    expect(calls).toEqual([{ query: "GBP to NPR exchange rate today Nepal Rastra Bank", site: "nrb.org.np" }]);
    expect(state.meta.round0Fx).toEqual({ site: "nrb.org.np", currency: "NPR", base: "GBP", added: 1 });
    expect(state.evidence.map((e) => [e.section, e.live])).toEqual([[FX_SECTION, true]]);
    expect(prompt).toContain(CITE_FX_INSTRUCTION);
    expect(prompt).not.toContain(KEEP_SOURCE_CURRENCY_INSTRUCTION);
    expect(prompt).toContain("nrb.org.np");
  });

  test("in rupees / in NPR trigger it too; nothing official found → no evidence and no 'not in the knowledge base' note", async () => {
    for (const input of ["Same in Nepali for the parents, in rupees", "Rewrite it for the father in NPR"]) {
      const { calls, searcher } = fakeWeb({ hosts: ["xe.com"] });
      const { state, prompt } = await run(input, searcher);
      expect([input, calls.map((c) => c.site)]).toEqual([input, ["nrb.org.np"]]);
      expect(state.evidence).toEqual([]);
      expect(state.meta.round0Fx).toMatchObject({ added: 0 });
      expect(prompt).toContain(KEEP_SOURCE_CURRENCY_INSTRUCTION);
      expect(prompt).toContain(NO_RESEARCH_NOTE);
    }
  });

  test("off with research.fxRates=false; a new question in rupees is not a rewrite", async () => {
    const off = fakeWeb();
    await run("Make it shorter for the father, in lakh", off.searcher, { maxRounds: 0, fxRates: false });
    expect(off.calls).toEqual([]);
    const fresh = fakeWeb();
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "financial_viability", task: "lookup", needs_research: false }), tools: { web: fresh.searcher } });
    const state = await graph.invoke({ input: "Is 30 lakh rupees enough for Australia?", history, priorAnswer: previous, sessionId: "s1", profile: null, counsellorRegion: nepalCounsellor });
    expect(fresh.calls).toEqual([]);
    expect(String(state.meta.systemPromptText)).not.toContain("# Currencies in this text");
  });
});
