import type { RetrievedChunk } from "../retrieval/store";
import type { Destination, Intent, PrimaryIntent } from "../schemas/intent.schema";
import { getPack } from "../skills";
import type { WebSearcher } from "../tools";
import type { ToolCallRecord } from "../tools/types";
import { webResultsToChunks } from "../tools/web-search";
import { combineSignals, withTimeout } from "../util/signals";

/**
 * Freshness guards for rules, fees and policy (counsellor audit, Oct 2026): Edge repeated a
 * superseded rule from a stale indexed page (visitor → student visa onshore, banned since
 * 1 July 2024), quoted out-of-date visa fees, and when the counsellor disputed it, answered
 * without looking anything up. Two deterministic fixes live here:
 *
 * - a dispute ("are you sure", "isn't it banned", "still true?") or a policy_recency /
 *   fact_verification flag always routes the turn to research, whatever the classifier said;
 * - research round 0 runs one web search restricted to the destination's official immigration
 *   site for rule-shaped topics, so official evidence sits beside the knowledge base before the
 *   planner or the answer model sees anything.
 */

const DISPUTE_PATTERNS: readonly RegExp[] = [
  /\bare you (?:sure|certain)\b/,
  /\b(?:that'?s|that is|this is|it'?s|it is) (?:not (?:right|correct|true|accurate|current)|wrong|incorrect|outdated|out of date|old information)\b/,
  /\b(?:isn'?t|wasn'?t|aren'?t|is not|was not)\b[^.?!]{0,40}\b(?:banned|abolished|removed|scrapped|replaced|closed|gone|changed|ended|no longer|not allowed|discontinued)\b/,
  /\bi (?:thought|heard|read)\b/,
  /\bstill (?:true|valid|current|correct|accurate|the case|apply|applies|allowed|possible|in (?:force|effect))\b/,
  /\b(?:double|fact)[- ]?check\b/,
  /\bverify (?:that|this|it)\b/,
  /\b(?:is|was) (?:that|this|it) (?:right|correct|true|accurate|current|up to date)\b/,
  /\byou (?:said|told|mentioned|wrote|stated)\b/,
  /\bearlier you\b/,
  /\bcontradict/,
];

/** The consultant challenges a fact, typically one from an earlier answer. */
export function disputesFact(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  return DISPUTE_PATTERNS.some((p) => p.test(t));
}

export type ForcedResearchReason = "dispute" | "policy_recency" | "fact_verification";

/** Why this turn must research even if the classifier said no lookup; null when nothing forces it. */
export function forcedResearchReason(intent: Pick<Intent, "contextual_flags">, input: string): ForcedResearchReason | null {
  if (disputesFact(input)) return "dispute";
  if (intent.contextual_flags.includes("policy_recency")) return "policy_recency";
  if (intent.contextual_flags.includes("fact_verification")) return "fact_verification";
  return null;
}

/** Topics whose answers rest on immigration rules, government fees, work limits or funds thresholds. */
const OFFICIAL_TOPICS: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>([
  "visa_process",
  "visa_risk_analysis",
  "onshore_support",
  "policy_change",
  "financial_viability",
  "migration_pathway",
  "family_planning",
  "work_survival",
  "document_preparation",
]);

/** Topics where the immigration site cannot help (courses, tests, our own work), whatever the wording. */
const NEVER_OFFICIAL: ReadonlySet<PrimaryIntent> = new Set<PrimaryIntent>([
  "program_selection",
  "university_selection",
  "test_preparation",
  "scholarship_funding",
  "caseload_management",
  "company_services",
  "greeting",
  "human_handoff",
  "lead_engagement",
]);

/** Wording that makes any other topic hinge on a current rule or figure. */
const FRESHNESS_CUE = /\b(?:fees?|costs?|charges?|hours|rules?|still|current|currently|latest|202[5-9])\b/i;

const OFFICIAL_QUERY_MAX = 250;

/** The destination's top official immigration domain (pack `officialSources`), or null without a pack. */
export function officialSite(country: string): string | null {
  const sources = getPack(country)?.officialSources ?? [];
  return (sources.find((s) => s.authority === "immigration" && s.topics === "all") ?? sources.find((s) => s.authority === "immigration"))?.domain ?? null;
}

/**
 * Whether this turn's answer hinges on a current rule or official figure (fees, funds, work
 * limits, post-study rights, policy): a rule-shaped topic, or a turn whose wording, flags or
 * dispute make it one; never for course, test or our-own-work topics. Gates the round-0 official
 * search and the facts-register excerpts (src/skills/facts-register.ts).
 */
export function wantsOfficialEvidence(intent: Pick<Intent, "primary_intent" | "contextual_flags" | "user_question">, input: string): boolean {
  const topic = intent.primary_intent;
  if (NEVER_OFFICIAL.has(topic)) return false;
  return OFFICIAL_TOPICS.has(topic) || forcedResearchReason(intent, input) !== null || FRESHNESS_CUE.test(`${intent.user_question}\n${input}`);
}

export interface OfficialSearchPlan {
  country: Destination;
  site: string;
  query: string;
}

/**
 * The round-0 official search for this turn, or null. One search, on the first routed country
 * with a pack, for a rule-shaped topic or a turn whose wording, flags or dispute hinge on a
 * current rule or figure. Independent of whether packs are loaded for the prompts.
 */
export function officialSearchPlan(
  intent: Pick<Intent, "primary_intent" | "contextual_flags" | "user_question">,
  input: string,
  countries: readonly Destination[],
): OfficialSearchPlan | null {
  if (!wantsOfficialEvidence(intent, input)) return null;
  for (const country of countries) {
    const site = officialSite(country);
    if (!site) continue;
    const query = (intent.user_question?.trim() || input.trim()).slice(0, OFFICIAL_QUERY_MAX);
    return query ? { country, site, query } : null;
  }
  return null;
}

/**
 * Official chunks from the indexed official pages (src/ingest/official.ts) for `country`: the
 * nightly copy of the very pages the live official search would find.
 */
export function indexedOfficialHits(chunks: readonly Pick<RetrievedChunk, "source" | "sourceKind" | "country">[], country: string): number {
  return chunks.filter((c) => (c.sourceKind === "official" || c.source.startsWith("official:")) && c.country === country).length;
}

/**
 * Run the planned search within `timeoutMs`. Never throws: a failure or timeout comes back as a
 * failed `web_search` record with no evidence, so the knowledge base still answers. `cancel`
 * stops it early when the indexed official pages already answered (`cancelled`, no evidence).
 */
export async function runOfficialSearch(
  web: WebSearcher,
  plan: Pick<OfficialSearchPlan, "site" | "query">,
  opts: { timeoutMs: number; signal?: AbortSignal; cancel?: AbortSignal },
): Promise<{ chunks: (RetrievedChunk & { fetchedAt: string })[]; record: ToolCallRecord; cancelled?: boolean }> {
  const started = performance.now();
  const record: ToolCallRecord = { tool: "web_search", args: { query: plan.query, site: plan.site }, ms: 0, ok: true, added: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCancel: (() => void) | undefined;
  try {
    const result = await Promise.race([
      web.search(plan.query, { site: plan.site, k: 5, signal: withTimeout(combineSignals(opts.signal, opts.cancel), opts.timeoutMs) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`web_search timed out after ${opts.timeoutMs} ms`)), opts.timeoutMs);
      }),
      new Promise<never>((_, reject) => {
        onCancel = () => reject(new Error("cancelled: indexed official pages answered"));
        if (opts.cancel?.aborted) onCancel();
        else opts.cancel?.addEventListener("abort", onCancel, { once: true });
      }),
    ]);
    return { chunks: webResultsToChunks(result), record };
  } catch (err) {
    if (opts.cancel?.aborted) return { chunks: [], record, cancelled: true };
    record.ok = false;
    record.error = (err as Error).message.slice(0, 300);
    return { chunks: [], record };
  } finally {
    clearTimeout(timer);
    if (onCancel) opts.cancel?.removeEventListener("abort", onCancel);
    record.ms = Math.round(performance.now() - started);
  }
}
