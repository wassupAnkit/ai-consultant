import type { CaseStage } from "../classify/jev";
import { PROMPT_NAMES, type PromptRegistry } from "../prompts/registry";
import { isMarket, marketInText, MARKETS, type Market } from "../routing/markets";
import type { PrimaryIntent } from "../schemas/intent.schema";
import { CHECKLISTS, MARKET_CHECKLISTS } from "./checklists.generated";
import { MARKET_PACK_DEFINITIONS, marketDomainsAll } from "./markets";
import { officialDomainsAll, PACK_DEFINITIONS } from "./packs";
import { PACK_COUNTRIES, type ChecklistItem, type CountryPack, type MarketPack, type PackCountry, type ResolvedMarket, type ResolvedPack, type ResolvedPacks } from "./types";

/**
 * Country skill packs: one research loop loads per-destination packs instead of
 * separate per-country agents. A pack is official sources + query vocabulary +
 * per-topic coverage checklists (generated from the data-model catalog) + a short
 * prose prompt in Langfuse. Packs carry no facts: they say what a complete answer
 * covers and where to look; every figure comes from cited evidence.
 *
 * A second, orthogonal layer covers the student's SOURCE market (Nepal, India…):
 * one market pack per turn, with the home-side sources, vocabulary and checklist
 * (approvals, loans, foreign exchange, grading, document chains) that apply
 * whatever the destination, and a prose prompt on how to tailor the answer.
 *
 * Everything here is pure and byte-stable (countries sorted by slug, the market
 * after them): the rendered strings sit in the cached prompt prefix.
 */
/** Union of every pack's official domains, for the live-fetch allowlist. */
export { marketDomainsAll, officialDomainsAll, PACK_COUNTRIES };
export type { ChecklistItem, CountryPack, MarketPack, PackCountry, ResolvedMarket, ResolvedPack, ResolvedPacks } from "./types";

export const MAX_CHECKLIST_ITEMS = 12;
const MAX_VOCABULARY = 12;
/** A market sits beside up to four destinations in the prompts, so its lists are kept shorter. */
export const MAX_MARKET_CHECKLIST_ITEMS = 8;
const MAX_MARKET_VOCABULARY = 8;
/** Market terms added to the round-0 knowledge-base query after the destination terms. */
export const MARKET_QUERY_TERMS = 2;

const PACKS: Record<PackCountry, CountryPack> = Object.fromEntries(
  PACK_COUNTRIES.map((c) => [c, { ...PACK_DEFINITIONS[c], checklists: CHECKLISTS[c] }]),
) as Record<PackCountry, CountryPack>;

/** Topics that never load a pack: nothing destination-specific to research. */
const NO_PACK_TOPICS = new Set<PrimaryIntent>(["greeting", "human_handoff", "caseload_management", "lead_engagement", "company_services"]);

/**
 * Topics that load the student's market pack but no destination pack: in the final coverage eval
 * (Oct 2026) destination checklists lowered coverage here (comparisons 75 vs 88 without packs,
 * university_selection 31 vs 43, program_selection 48 vs 56, test_preparation 70 vs 83), while
 * they raised it for visa, documents, offers, eligibility, onshore, family and migration.
 */
const NO_DESTINATION_PACK_TOPICS = new Set<PrimaryIntent>(["comparative_decision", "university_selection", "program_selection", "test_preparation"]);

/** Topics where the answer must rest on an immigration or government source. */
const VISA_TOPICS = new Set<PrimaryIntent>(["visa_process", "visa_risk_analysis", "document_preparation", "migration_pathway", "policy_change", "family_planning", "work_survival"]);

function isPackCountry(c: string): c is PackCountry {
  return (PACK_COUNTRIES as readonly string[]).includes(c);
}

export function getPack(country: string): CountryPack | null {
  return isPackCountry(country) ? PACKS[country] : null;
}

export interface ResolveInput {
  /** Destination slugs from the classifier; non-pack destinations are ignored. */
  countries: readonly string[];
  topic: PrimaryIntent;
  secondaryTopics?: readonly PrimaryIntent[];
  stage?: CaseStage | null;
  /** The route compares two or more countries: no destination pack loads (see NO_DESTINATION_PACK_TOPICS). */
  comparison?: boolean;
}

export function resolvePacks(input: ResolveInput): ResolvedPacks {
  if (NO_PACK_TOPICS.has(input.topic) || NO_DESTINATION_PACK_TOPICS.has(input.topic) || input.comparison) return { packs: [], versions: [] };
  const topics = [...new Set([input.topic, ...(input.secondaryTopics ?? [])])];
  const countries = [...new Set(input.countries)].filter(isPackCountry).sort();
  const packs = countries.map((c) => resolveOne(PACKS[c], topics, input.stage ?? null));
  return { packs, versions: packs.map((p) => `${p.country}@${p.version}`) };
}

/** Checklist items of every topic, first topic first, each id once; narrowed to the stage when that leaves at least three. */
function mergeChecklists(checklists: Partial<Record<PrimaryIntent, ChecklistItem[]>>, topics: PrimaryIntent[], stage: CaseStage | null): ChecklistItem[] {
  const seen = new Set<string>();
  const merged: ChecklistItem[] = [];
  for (const t of topics) {
    for (const item of checklists[t] ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  if (stage && stage !== "unspecified") {
    const atStage = merged.filter((i) => !i.stages || i.stages.includes(stage));
    if (atStage.length >= 3) return atStage;
  }
  return merged;
}

function resolveOne(pack: CountryPack, topics: PrimaryIntent[], stage: CaseStage | null): ResolvedPack {
  const checklist = mergeChecklists(pack.checklists, topics, stage);

  const sources = pack.officialSources.filter((s) => s.topics === "all" || topics.some((t) => (s.topics as PrimaryIntent[]).includes(t)));
  if (topics.some((t) => VISA_TOPICS.has(t)) && !sources.some((s) => s.authority === "immigration" || s.authority === "government")) {
    const fallback = pack.officialSources.find((s) => s.authority === "immigration") ?? pack.officialSources.find((s) => s.authority === "government");
    if (fallback) sources.unshift(fallback);
  }

  const vocabulary = [...new Set(topics.flatMap((t) => pack.vocabulary[t] ?? []))].slice(0, MAX_VOCABULARY);
  return {
    country: pack.country,
    label: pack.label,
    version: pack.version,
    checklist: checklist.slice(0, MAX_CHECKLIST_ITEMS),
    officialDomains: [...new Set(sources.map((s) => s.domain))],
    vocabulary,
  };
}

function itemLabel(i: ChecklistItem): string {
  return i.freshness === "policy" ? `${i.label}*` : i.label;
}

function listLabels(labels: string[]): string {
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** Compact block for the RESEARCH prompt (sent every round); "" when no pack applies. */
export function renderCountryBrief(resolved: ResolvedPacks): string {
  if (!resolved.packs.length) return "";
  const lines = [
    "# Country brief",
    "Destination packs say what to look for and where; they hold no figures. Get every figure from evidence you can cite, preferring the official sources below; items marked * are policy-sensitive, so look for a current official page.",
  ];
  for (const p of resolved.packs) {
    lines.push("", `## ${p.label}`);
    lines.push(`Official sources to prefer: ${p.officialDomains.join(", ")}`);
    if (p.vocabulary.length) lines.push(`Query vocabulary: ${p.vocabulary.join("; ")}`);
    if (p.checklist.length) lines.push(`Evidence should cover: ${p.checklist.map(itemLabel).join("; ")}`);
  }
  return lines.join("\n");
}

/** Block for the ANSWER prompt: per-country prose, then the coverage checklist; "" when no pack applies. */
export function renderCountryGuidance(resolved: ResolvedPacks, prose: Partial<Record<string, string>>): string {
  if (!resolved.packs.length) return "";
  const lines = ["# Country guidance"];
  for (const p of resolved.packs) {
    const text = prose[p.country]?.trim();
    if (text) lines.push("", `## ${p.label}`, text);
  }
  const withItems = resolved.packs.filter((p) => p.checklist.length);
  if (withItems.length) {
    lines.push(
      "",
      "## Coverage checklist",
      'For each item below, either state it with a citation [n] from the evidence or write "Not in the knowledge base: <item>". Never fill a figure, date or threshold from memory; items marked * are policy-sensitive and need a current official source.',
    );
    for (const p of withItems) {
      lines.push("", `### ${p.label}`);
      for (const i of p.checklist) lines.push(`- ${itemLabel(i)}`);
    }
  }
  if (resolved.packs.length >= 2) {
    lines.push(
      "",
      `This is a comparison of ${listLabels(resolved.packs.map((p) => p.label))}: present an aligned table with one column per country and the same rows for each country (the union of the checklist items above), citing each cell or marking it "Not in the knowledge base".`,
    );
  }
  return lines.join("\n");
}

/**
 * Up to `max` vocabulary terms for the round-0 knowledge-base query, taken from each pack in turn
 * (first term of every country, then the second, …) so a comparison expands every country, then
 * up to MARKET_QUERY_TERMS terms of the market pack; case-insensitive duplicates are dropped.
 * Deterministic for a given resolution.
 */
export function queryVocabulary(resolved: ResolvedPacks, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...resolved.packs.map((p) => p.vocabulary.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const p of resolved.packs) {
      const term = p.vocabulary[i];
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      out.push(term);
      if (out.length >= max) break;
    }
  }
  let added = 0;
  for (const term of resolved.market?.vocabulary ?? []) {
    if (added >= MARKET_QUERY_TERMS) break;
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    added++;
  }
  return out;
}

/** Prose prompt per slug, through the prompt registry (which caches Langfuse lookups). */
export async function loadPackProse(registry: Pick<PromptRegistry, "get">, slugs: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(slugs)].filter(isPackCountry).sort();
  const texts = await Promise.all(wanted.map((s) => registry.get(PROMPT_NAMES.country(s)).then((p) => p.text)));
  return Object.fromEntries(wanted.map((s, i) => [s, texts[i]!]));
}

// --- Market (origin) packs ----------------------------------------------------

const MARKET_PACKS: Record<Market, MarketPack> = Object.fromEntries(
  MARKETS.map((m) => [m, { ...MARKET_PACK_DEFINITIONS[m], checklists: MARKET_CHECKLISTS[m] }]),
) as Record<Market, MarketPack>;

export function getMarketPack(market: string): MarketPack | null {
  return isMarket(market) ? MARKET_PACKS[market] : null;
}

export interface ResolveMarketInput {
  /** The route's origin; null or an unknown slug resolves to nothing. */
  market: string | null | undefined;
  topic: PrimaryIntent;
  secondaryTopics?: readonly PrimaryIntent[];
  stage?: CaseStage | null;
}

/**
 * The student's market pack narrowed to this turn: checklist items of every topic (stage-narrowed
 * like destination packs), the sources whose topics match plus the market-wide ones, and the
 * topics' vocabulary. Null without a market or for a topic that never loads a pack.
 */
export function resolveMarket(input: ResolveMarketInput): ResolvedMarket | null {
  const pack = input.market ? getMarketPack(input.market) : null;
  if (!pack || NO_PACK_TOPICS.has(input.topic)) return null;
  const topics = [...new Set([input.topic, ...(input.secondaryTopics ?? [])])];
  const sources = pack.officialSources.filter((s) => s.topics === "all" || topics.some((t) => (s.topics as PrimaryIntent[]).includes(t)));
  return {
    market: pack.market,
    label: pack.label,
    version: pack.version,
    draftLanguage: pack.languages.draft,
    checklist: mergeChecklists(pack.checklists, topics, input.stage ?? null).slice(0, MAX_MARKET_CHECKLIST_ITEMS),
    officialDomains: [...new Set(sources.map((s) => s.domain))],
    vocabulary: [...new Set(topics.flatMap((t) => pack.vocabulary[t] ?? []))].slice(0, MAX_MARKET_VOCABULARY),
  };
}

/** Block for the RESEARCH prompt (sent every round): the market's home-side sources and checklist; "" without a market. */
export function renderMarketBrief(market: ResolvedMarket | null | undefined): string {
  if (!market) return "";
  const lines = [
    "# Student market",
    `The student is from ${marketInText(market.market)}. Home-side steps (approvals, loans, foreign exchange, police and civil documents, grading) follow the home country's own rules; when the question touches them, get them from evidence you can cite, preferring the official sources below. Items marked * are policy-sensitive.`,
    `Official sources to prefer: ${market.officialDomains.join(", ")}`,
  ];
  if (market.vocabulary.length) lines.push(`Query vocabulary: ${market.vocabulary.join("; ")}`);
  if (market.checklist.length) lines.push(`Evidence should cover: ${market.checklist.map(itemLabel).join("; ")}`);
  return lines.join("\n");
}

/** Block for the ANSWER prompt: the market prose, the origin-side checklist and how to tailor the answer; "" without a market. */
export function renderMarketGuidance(market: ResolvedMarket | null | undefined, prose: string | null | undefined): string {
  if (!market) return "";
  const lines = [`# Market guidance (student from ${marketInText(market.market)})`];
  const text = prose?.trim();
  if (text) lines.push(text);
  if (market.checklist.length) {
    lines.push(
      "",
      "## Origin-side checklist",
      'Where the question touches these items, state each with a citation [n] from the evidence or write "Not in the knowledge base: <item>". Never fill a figure, date or limit from memory; items marked * are policy-sensitive and need a current official source.',
    );
    for (const i of market.checklist) lines.push(`- ${itemLabel(i)}`);
  }
  lines.push(
    "",
    `Tailor the answer to a student from ${marketInText(market.market)}: their usual goals, the home-side steps above and how the destination advice shifts for this market. When the consultant asks for a draft or translation for the student's parents or family, write it in ${market.draftLanguage}.`,
  );
  return lines.join("\n");
}

/** The research prompt's `{{country_brief}}`: destination briefs, then the market brief ("" when neither applies). */
export function renderSkillsBrief(resolved: ResolvedPacks): string {
  return [renderCountryBrief(resolved), renderMarketBrief(resolved.market)].filter(Boolean).join("\n\n");
}

/** The answer prompt's `{{country_pack}}`: destination guidance, then the market guidance ("" when neither applies). */
export function renderSkillsGuidance(resolved: ResolvedPacks, prose: Partial<Record<string, string>>, marketProse: string | null | undefined): string {
  return [renderCountryGuidance(resolved, prose), renderMarketGuidance(resolved.market, marketProse)].filter(Boolean).join("\n\n");
}

/** The market's prose prompt through the prompt registry; null without a market. */
export async function loadMarketProse(registry: Pick<PromptRegistry, "get">, market: Market | null | undefined): Promise<string | null> {
  return market ? (await registry.get(PROMPT_NAMES.market(market))).text : null;
}
