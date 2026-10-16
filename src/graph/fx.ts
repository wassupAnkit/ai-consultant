import type { RetrievedChunk } from "../retrieval/store";
import type { Market } from "../routing/markets";
import type { Destination } from "../schemas/intent.schema";
import type { WebSearcher } from "../tools";
import type { ToolCallRecord } from "../tools/types";
import { runOfficialSearch } from "./freshness";

/**
 * Home-currency totals (counsellor audit N21): a counsellor asks for a fee or funds total "in
 * NPR" or "in lakh", and the answer converted at a rate it remembered. When a message asks for
 * one, round 0 searches the source market's central bank for today's indicative rate (one
 * site-restricted web search) and keeps only results from that bank's own site as live, dated
 * evidence. Nothing official found → no FX evidence, and the answer prompt (rule 6b) has the
 * answer say the rate isn't available instead of guessing.
 */

export interface FxSource {
  currency: string;
  bank: string;
  /** The bank's own domain: the search is restricted to it and results from elsewhere are dropped. */
  site: string;
  /** Message wording that names this currency. */
  named: RegExp;
}

export const FX_SOURCES: Readonly<Record<Market, FxSource>> = {
  nepal: { currency: "NPR", bank: "Nepal Rastra Bank", site: "nrb.org.np", named: /\bNPR\b|\bnep(?:al|ali|alese) rupees?\b|\bNRs\b/i },
  // RBI publishes the reference rate (FBIL computes it); rbi.org.in carries it.
  india: { currency: "INR", bank: "Reserve Bank of India", site: "rbi.org.in", named: /\bINR\b|\bindian rupees?\b|₹/i },
  bangladesh: { currency: "BDT", bank: "Bangladesh Bank", site: "bb.org.bd", named: /\bBDT\b|\btaka\b|৳/i },
  vietnam: { currency: "VND", bank: "State Bank of Vietnam", site: "sbv.gov.vn", named: /\bVND\b|\bvietnamese dong\b|\d\s*(?:million |billion )?dong\b|\bin dong\b|₫/i },
  philippines: { currency: "PHP", bank: "Bangko Sentral ng Pilipinas", site: "bsp.gov.ph", named: /\bPHP\b|\b(?:[Pp]hilippine )?[Pp]esos?\b|₱/ },
  thailand: { currency: "THB", bank: "Bank of Thailand", site: "bot.or.th", named: /\bTHB\b|\bbaht\b|฿/i },
  sri_lanka: { currency: "LKR", bank: "Central Bank of Sri Lanka", site: "cbsl.gov.lk", named: /\bLKR\b|\bsri lankan rupees?\b/i },
};

/** Wording that asks for the student's own currency without naming it: the routed origin decides. */
const HOME_CURRENCY = /\b(?:our|their|his|her|the student'?s|home|local|own) (?:own )?currency\b|\blakhs?\b|\bcrores?\b|\brupees?\b/i;

/** Destination currencies (the rate's base); a destination not listed converts from USD. */
const DESTINATION_CURRENCY: Partial<Record<Destination, string>> = {
  australia: "AUD",
  canada: "CAD",
  united_kingdom: "GBP",
  united_states: "USD",
  new_zealand: "NZD",
  germany: "EUR",
  ireland: "EUR",
  netherlands: "EUR",
  malaysia: "MYR",
  uae: "AED",
  thailand: "THB",
};

export interface FxPlan extends FxSource {
  market: Market;
  /** The destination currency converted from. */
  base: string;
  query: string;
}

/**
 * The round-0 rate search for this message, or null: the market whose currency the message
 * names (code, name or symbol), else the routed origin when it asks for "our currency", lakh,
 * crore or rupees. Null when the destination already uses that currency.
 */
export function fxPlan(text: string, origin: Market | null | undefined, countries: readonly string[]): FxPlan | null {
  const named = (Object.entries(FX_SOURCES) as [Market, FxSource][]).find(([, s]) => s.named.test(text));
  const market = named?.[0] ?? (origin && HOME_CURRENCY.test(text) ? origin : null);
  if (!market) return null;
  const source = FX_SOURCES[market];
  const base = countries.map((c) => DESTINATION_CURRENCY[c as Destination]).find(Boolean) ?? "USD";
  if (base === source.currency) return null;
  return { market, base, ...source, query: `${base} to ${source.currency} exchange rate today ${source.bank}` };
}

const onSite = (url: string, site: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === site || host.endsWith(`.${site}`);
  } catch {
    return false;
  }
};

/** The section every central-bank rate excerpt carries, so the answer node can tell one is in the evidence. */
export const FX_SECTION = "exchange rate (central bank)";

export const isFxExcerpt = (item: { section?: string | null }) => item.section === FX_SECTION;

/**
 * Run the planned search (never throws; see `runOfficialSearch`) and keep only results from the
 * bank's own site, titled "<bank> — <base>/<currency> exchange rate".
 */
export async function runFxSearch(
  web: WebSearcher,
  plan: FxPlan,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ chunks: (RetrievedChunk & { fetchedAt: string })[]; record: ToolCallRecord }> {
  const out = await runOfficialSearch(web, { site: plan.site, query: plan.query }, opts);
  const chunks = out.chunks
    .filter((c) => onSite(c.url, plan.site))
    .map((c) => ({ ...c, title: `${plan.bank} — ${plan.base}/${plan.currency} exchange rate`, section: FX_SECTION }));
  return { chunks, record: out.record };
}

/**
 * Rewrites, translations and drafts (counsellor audit N23): "make it shorter for the father, in
 * Nepali" after a UK cost answer in GBP came back with "रु. २०–६५ लाख" conversions no central-bank
 * excerpt supported. These turns get one of two per-turn rules, decided by whether this turn's
 * evidence holds a central-bank rate (`isFxExcerpt`).
 */
export const KEEP_SOURCE_CURRENCY_INSTRUCTION = `# Currencies in this text
No central-bank exchange rate is in this turn's excerpts. Keep every amount in the currency it has in the previous answer, the excerpts or the consultant's message (GBP stays GBP, AUD stays AUD). Do not convert any amount and do not add a home-currency equivalent (NPR, INR, BDT, VND, PHP, THB, LKR, rupees, lakh, crore), not even in a translation or a version for a parent. If the consultant asked for the home currency, keep the source-currency figures and say in one line that today's official exchange rate isn't available, so the figures are not converted.`;

export const CITE_FX_INSTRUCTION = `# Currencies in this text
This turn's excerpts include a central-bank exchange rate. Keep every amount in its source currency; a home-currency figure goes alongside it only because the consultant asked for one, converted at that excerpt's rate only, with the rate, the bank and the excerpt's date stated once (e.g. "at GBP 1 = NPR 180.20, Nepal Rastra Bank, 9 Oct 2026") and each converted figure marked as approximate. Never use any other rate.`;

/** The currency rule for a rewrite, translation or draft: cite the rate when one is in evidence, otherwise convert nothing. */
export function currencyInstruction(evidence: readonly { section?: string | null }[]): string {
  return evidence.some(isFxExcerpt) ? CITE_FX_INSTRUCTION : KEEP_SOURCE_CURRENCY_INSTRUCTION;
}
