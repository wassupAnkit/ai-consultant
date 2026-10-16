import { DESTINATION_LABELS, type Destination } from "../schemas/intent.schema";

/** Every destination Edge routes on: all of `DESTINATIONS` except the "other" catch-all. */
export type RoutedDestination = Exclude<Destination, "other">;

/**
 * One destination's routing vocabulary.
 *
 * Case rule, shared by `aliases` and `triggers`: a term written all in lowercase matches in any
 * case; a term written with a capital letter matches only exactly as written. That is how short
 * codes stay safe — "US" and "AU" are countries, "us" is a pronoun and "au" is French — and how
 * acronyms that are ordinary words in lowercase ("CAS", "PAL", "OPT", "GIC") only count as the
 * acronym. Every term matches as a whole token (no letter or digit either side), and a space in a
 * term also matches a hyphen or no space ("subclass 500", "subclass-500", "subclass500").
 */
export interface CountryEntry {
  /** Human-readable name for prompts and metadata (same as `DESTINATION_LABELS`). */
  label: string;
  /** Names, demonyms and codes for the country itself. */
  aliases: readonly string[];
  /**
   * Vocabulary that only one destination uses (visa subclasses, immigration systems, enrolment
   * documents), so a message naming it is about that country even when the country is unnamed.
   * Ambiguous words ("PR", "GS", "visa", "points") are deliberately absent.
   */
  triggers: readonly string[];
}

/** The single country registry for routing. Other scattered country lists (partners, ingest) are not derived from it. */
export const COUNTRIES: Readonly<Record<RoutedDestination, CountryEntry>> = {
  australia: {
    label: DESTINATION_LABELS.australia,
    aliases: ["australia", "australian", "aussie", "AU", "new south wales"],
    triggers: ["subclass 500", "subclass 485", "subclass 590", "500 visa", "485 visa", "500 file", "CoE", "COE", "immiaccount", "oshc", "genuine student", "GTE", "cricos", "PRISMS", "vevo"],
  },
  canada: {
    label: DESTINATION_LABELS.canada,
    aliases: ["canada", "canadian"],
    triggers: ["PAL", "SDS", "ircc", "pgwp", "DLI", "GIC", "CAQ"],
  },
  united_kingdom: {
    label: DESTINATION_LABELS.united_kingdom,
    // "northern ireland" is listed here so the longer name wins over Ireland's "ireland".
    aliases: ["united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "UK", "uk"],
    triggers: ["CAS", "ukvi", "brp", "graduate route", "IHS", "ATAS"],
  },
  united_states: {
    label: DESTINATION_LABELS.united_states,
    aliases: ["united states of america", "united states", "america", "US", "USA", "usa"],
    triggers: ["i-20", "sevis", "f-1 visa", "F-1", "OPT", "stem opt", "ds-160"],
  },
  new_zealand: {
    label: DESTINATION_LABELS.new_zealand,
    aliases: ["new zealand", "NZ", "nz"],
    triggers: ["INZ", "nzqa"],
  },
  germany: { label: DESTINATION_LABELS.germany, aliases: ["germany", "german", "deutschland"], triggers: [] },
  ireland: { label: DESTINATION_LABELS.ireland, aliases: ["ireland", "irish"], triggers: [] },
  netherlands: { label: DESTINATION_LABELS.netherlands, aliases: ["netherlands", "holland", "dutch"], triggers: [] },
  malaysia: { label: DESTINATION_LABELS.malaysia, aliases: ["malaysia"], triggers: [] },
  // "Dubai" only capitalised: in Romanized Nepali "dubai" (दुवै) means "both" — "tuition ra living
  // dubai dekhaunu parcha?" is about showing both, not the UAE.
  uae: { label: DESTINATION_LABELS.uae, aliases: ["united arab emirates", "emirates", "Dubai", "abu dhabi", "sharjah", "UAE", "uae"], triggers: [] },
  thailand: { label: DESTINATION_LABELS.thailand, aliases: ["thailand"], triggers: [] },
};

/** Country labels by slug, for modules that only need the name. */
export const COUNTRY_LABELS: Readonly<Record<RoutedDestination, string>> = Object.fromEntries(
  (Object.entries(COUNTRIES) as [RoutedDestination, CountryEntry][]).map(([slug, c]) => [slug, c.label]),
) as Record<RoutedDestination, string>;

/** Most destinations a route carries (the intent schema's own cap). */
export const MAX_ROUTED_COUNTRIES = 4;

/**
 * Region names that contain a country's name but mean something else; they match and route
 * nowhere, so "Latin America" does not count as America.
 */
const MASKED_TERMS = ["latin america", "south america", "central america", "north america"];

/**
 * Bank (and similar) names that contain a country's name: a "Dutch-Bangla Bank" statement is a
 * Bangladeshi bank, not the Netherlands. They route nowhere, and the classifier's copy of the
 * country they contain is dropped when the message names it no other way.
 */
const MASKED_NAMES: Readonly<Record<string, RoutedDestination>> = {
  "dutch bangla bank": "netherlands",
  "dutch bangla": "netherlands",
  "bank of america": "united_states",
  "american express": "united_states",
  "commonwealth bank of australia": "australia",
  "national australia bank": "australia",
  "bank of australia": "australia",
  "royal bank of canada": "canada",
  "bank of canada": "canada",
  "bank of new zealand": "new_zealand",
  "bank of england": "united_kingdom",
  "bank of scotland": "united_kingdom",
  "bank of ireland": "ireland",
  "emirates nbd": "uae",
  "emirates airline": "uae",
};

interface TermTarget {
  destination: RoutedDestination | null;
  /** Any case matches (the term was written in lowercase). */
  anyCase: boolean;
  /** Exact spellings (separators removed) accepted when `anyCase` is false. */
  exact: Set<string>;
}

/** Spaces and hyphens are optional separators: "I-20" ≡ "I20", "subclass 500" ≡ "subclass-500". */
const unseparated = (s: string) => s.replace(/[\s-]+/g, "");
const TERMS = new Map<string, TermTarget>();
const PATTERN_TERMS = new Set<string>();
function register(term: string, destination: RoutedDestination | null) {
  const key = unseparated(term.toLowerCase());
  const t = TERMS.get(key) ?? { destination, anyCase: false, exact: new Set<string>() };
  if (term === term.toLowerCase()) t.anyCase = true;
  else t.exact.add(unseparated(term));
  TERMS.set(key, t);
  PATTERN_TERMS.add(term.toLowerCase());
}
for (const [slug, c] of Object.entries(COUNTRIES) as [RoutedDestination, CountryEntry][]) for (const term of [...c.aliases, ...c.triggers]) register(term, slug);
for (const term of [...MASKED_TERMS, ...Object.keys(MASKED_NAMES)]) register(term, null);
const MASKED_DESTINATION = new Map(Object.entries(MASKED_NAMES).map(([term, d]) => [unseparated(term), d]));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Longest first, so "new south wales" and "northern ireland" win over "wales" and "ireland" at the same spot. */
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...PATTERN_TERMS]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/[ -]/g, "[\\s-]*"))
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/**
 * Destinations a message names or implies, in order of first mention, each once, at most four.
 * Names and lowercase-written terms are case-insensitive; codes and acronyms must appear exactly
 * as registered (see `CountryEntry`). A country named only as the student's origin ("from
 * Thailand"), inside a bank's name ("Dutch-Bangla Bank") or as a relative's or sponsor's location
 * ("uncle in Dubai") is not a destination; a past refusal ("refused for Canada") still is — the
 * route drops it only beside other options (`refusalOnlyDestinations`). Pure and synchronous.
 */
export function extractDestinations(text: string): RoutedDestination[] {
  const out: RoutedDestination[] = [];
  for (const { destination, role } of mentions(text)) {
    if ((role !== "destination" && role !== "refusal") || out.includes(destination)) continue;
    out.push(destination);
    if (out.length >= MAX_ROUTED_COUNTRIES) break;
  }
  return out;
}

/**
 * Words that make the next country the student's origin, not a destination: "a student from
 * Thailand", "citizen of Malaysia". Thailand and Malaysia are both source markets and
 * destinations, so their demonyms ("Thai student") are not registered as aliases at all.
 */
const ORIGIN_CUE = /(?:\bfrom|\bnationals?\s+of|\bcitizens?\s+of|\bpassport\s+(?:holders?\s+)?(?:of|from)|\bborn\s+in|\bresidents?\s+of|\bliving\s+in|\bbased\s+in)\s+(?:the\s+)?$/i;

/**
 * Whether the words just before `index` mark what follows as the student's origin ("from",
 * "citizen of", "based in"…). Shared with origin detection (src/routing/markets.ts), so a place
 * that is both a destination and a source market reads the same way in both layers.
 */
export function precededByOriginCue(text: string, index: number): boolean {
  return ORIGIN_CUE.test(text.slice(Math.max(0, index - 30), index));
}

/** Why the message names a country: a place to study, or something else that only mentions it. */
type MentionRole = "destination" | "origin" | "masked" | "relative" | "refusal";

/**
 * Just before a country: a relative's or sponsor's location ("uncle in Dubai", "brother works in
 * the UK", "sponsor is in Canada") — where someone else is, not where the student will study.
 */
const RELATIVE_CUE = /\b(?:uncles?|aunts?|aunty|auntie|brothers?|sisters?|fathers?|mothers?|dad|mum|mom|cousins?|sponsors?|relatives?)(?:'s)?,?\s+(?:(?:who\s+)?(?:is|are|was|were|lives?|living|works?|working|stays?|staying|based|settled)\s+)?(?:in|at)\s+(?:the\s+)?$/i;
/** The student is going where the relative is after all ("wants to study there too"). */
const STUDY_THERE = /\b(?:study|studying|apply|applying|go|going|move|moving|join|joining)\b[^.?!;]{0,30}\bthere\b/i;
/** Just before a country: a past refusal ("refused for Canada", "rejected by the UK"). */
const REFUSAL_BEFORE = /\b(?:refused|rejected|refusal|rejection|denied|denial)\s+(?:(?:for|from|by|of|in|to)\s+)?(?:an?\s+|the\s+|his\s+|her\s+|their\s+)?$/i;
/** Just after a country: a past refusal ("Canada refusal", "UK visa was refused"). */
const REFUSAL_AFTER = /^[\s-]*(?:student\s+)?(?:visa\s+|study\s+permit\s+)?(?:application\s+)?(?:was\s+|got\s+|has\s+been\s+|had\s+been\s+)?(?:refused|rejected|refusal|rejection|denied|denial)\b/i;

function* mentions(text: string): Generator<{ destination: RoutedDestination; role: MentionRole }> {
  const studyThere = STUDY_THERE.test(text);
  for (const m of text.matchAll(PATTERN)) {
    const raw = unseparated(m[0]);
    const t = TERMS.get(raw.toLowerCase());
    if (!t || (!t.anyCase && !t.exact.has(raw))) continue;
    if (!t.destination) {
      const masked = MASKED_DESTINATION.get(raw.toLowerCase());
      if (masked) yield { destination: masked, role: "masked" };
      continue;
    }
    const before = text.slice(Math.max(0, m.index! - 50), m.index!);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 50);
    const role: MentionRole = precededByOriginCue(text, m.index!)
      ? "origin"
      : RELATIVE_CUE.test(before) && !studyThere
        ? "relative"
        : REFUSAL_BEFORE.test(before) || REFUSAL_AFTER.test(after)
          ? "refusal"
          : "destination";
    yield { destination: t.destination, role };
  }
}

/** Each destination the message mentions, with every role it is mentioned in. */
function mentionRoles(text: string): Map<RoutedDestination, Set<MentionRole>> {
  const roles = new Map<RoutedDestination, Set<MentionRole>>();
  for (const m of mentions(text)) roles.set(m.destination, (roles.get(m.destination) ?? new Set()).add(m.role));
  return roles;
}

/**
 * Countries the message names only as the student's origin ("from Thailand") and never as a
 * place to study. The route drops these from the classifier's destinations too, which
 * otherwise sometimes lists the home country of a Thai or Malaysian student.
 */
export function originOnlyDestinations(text: string): RoutedDestination[] {
  return [...mentionRoles(text)].filter(([, r]) => r.has("origin") && !r.has("destination") && !r.has("refusal")).map(([d]) => d);
}

/**
 * Countries the message names only as something other than a place to study or a past refusal:
 * the student's origin, inside a bank's name, or a relative's or sponsor's location. The route
 * drops these from the classifier's destinations ("Dutch-Bangla Bank" is not the Netherlands).
 */
export function nonDestinationMentions(text: string): RoutedDestination[] {
  return [...mentionRoles(text)].filter(([, r]) => !r.has("destination") && !r.has("refusal")).map(([d]) => d);
}

/**
 * Countries the message names only as a past refusal ("refused for Canada last year"): the
 * route keeps one when it is the only country, and drops it beside other options unless the
 * message also names it as one.
 */
export function refusalOnlyDestinations(text: string): RoutedDestination[] {
  return [...mentionRoles(text)].filter(([, r]) => r.has("refusal") && !r.has("destination")).map(([d]) => d);
}

/**
 * Free-text country names (CRM deal countries such as "Australia", "UK", "us") → destination
 * slugs, each once. A whole name is compared case-insensitively against the registry's names
 * and codes — safe here, because a field holding only "us" is a country, not a pronoun; a longer
 * name falls back to `extractDestinations` ("Australia (Sydney)").
 */
export function destinationsFromNames(names: readonly string[]): RoutedDestination[] {
  const out = new Set<RoutedDestination>();
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (!k) continue;
    const exact = (Object.entries(COUNTRIES) as [RoutedDestination, CountryEntry][]).find(([, c]) => c.aliases.some((a) => a.toLowerCase() === k));
    const found = exact ? [exact[0]] : extractDestinations(n);
    for (const d of found) out.add(d);
  }
  return [...out];
}
