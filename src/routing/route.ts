import type { StoredMessage } from "../memory/store";
import { DESTINATIONS, type ClassifierExtras, type Destination, type Intent, type PrimaryIntent } from "../schemas/intent.schema";
import { extractDestinations, MAX_ROUTED_COUNTRIES, nonDestinationMentions, refusalOnlyDestinations, type RoutedDestination } from "./countries";
import { extractExplicitOrigin, extractLanguageOrigin, isMarket, marketDestination, marketFromName, marketFromProfile, namesMarketAsDestination, type CounsellorRegion, type Market, type Onshore } from "./markets";

/** Where the case stands (Jev's X.030 stages); "unspecified" when unknown or Gemini classified. */
export type CaseStage = ClassifierExtras["stage"];

/**
 * Which layer contributed countries to a route, in the order they were consulted; "onshore" is the
 * onshore counsellor's own country, the default when nothing else named one.
 */
export type CountrySource = "classifier" | "keywords" | "history" | "guide" | "onshore" | "crm";

/**
 * Which layer supplied the student's source market (see `decideOrigin`): "profile" is the
 * consultant's own Edge profile market, "counsellor" the region of their CRM branch (or browser
 * timezone), "language" the script or Romanized language the message is written in.
 */
export type OriginSource = "crm" | "keywords" | "classifier" | "history" | "profile" | "counsellor" | "language";

/** The counsellor's region as `meta.route` records it: what the turn could default to, and from where. */
export type CounsellorRegionSummary = Pick<CounsellorRegion, "market" | "onshore" | "branch" | "source">;

/**
 * How one turn is routed, decided once right after classification and read by research (round-0
 * filters, program search) and the prompts. Persisted on the chat turn as `meta.route`.
 */
export interface RouteDecision {
  /** Destinations this turn is about: at most four, never "other". */
  countries: RoutedDestination[];
  /** The layers that supplied `countries` (empty when none did). */
  countrySource: CountrySource[];
  /** The classifier's primary topic. */
  topic: PrimaryIntent;
  stage: CaseStage;
  /**
   * "comparison": two or more countries and the request is a comparison (task compare, or
   * comparative_decision as primary or secondary topic). "single": at least one country
   * otherwise — including two or more countries with no comparison signal (e.g. "a UK graduate
   * applying to Canada"), where every country is kept but the answer is not laid out as a
   * side-by-side. "none": no country at all.
   */
  mode: "single" | "comparison" | "none";
  /** The student's source market (where they come from), orthogonal to `countries`; null when unknown. */
  origin: Market | null;
  /** The layer that supplied `origin`; null when none did. */
  originSource: OriginSource | null;
  /**
   * The counsellor works at an onshore office (Australia, UK) and nothing named the student's
   * market: the student is likely already in that country. Null whenever `origin` is set.
   */
  onshore: Onshore | null;
  /** The counsellor's region this turn could default to (null when unknown), whether or not it was used. */
  counsellorRegion: CounsellorRegionSummary | null;
  /** The CRM student research read this turn, when the route was re-decided with them (`withCrmStudent`). */
  crmStudent?: CrmStudentRef;
}

/**
 * The one CRM student a research turn read (the contact whose overview it fetched): their market
 * (nationality, else passport country, else country of residence) and the destination countries
 * of their deals and applications. Facts from the record, so they outrank anything assumed.
 */
export interface CrmStudentRef {
  contactId: string;
  /** The contact's name on the record, when it has one: lets the next turn recognise the same student by name. */
  name?: string;
  origin: Market | null;
  destinations: RoutedDestination[];
}

export interface RouteInput {
  /** `origin` is the classifier's free text ("Nepal"); absent or null when it gave none. */
  intent: Pick<Intent, "destinations" | "task" | "primary_intent" | "secondary_intents"> & Partial<Pick<Intent, "origin">>;
  /** Jev's extra decisions; null under the Gemini classifier (no stage, no references_prior_turn). */
  extras: Pick<ClassifierExtras, "stage" | "references_prior_turn"> | null;
  /** This turn's message. */
  input: string;
  /** Text of the windowed history, oldest → newest, excluding this turn. */
  history: readonly string[];
  /** Countries the most recent prior turn was routed to, when stored (see `priorDestinationsOf`). */
  priorDestinations?: readonly Destination[];
  /** Destinations of a guided session's CRM student (already mapped to slugs). */
  guideCountries?: readonly Destination[];
  /** Market of a guided session's CRM student (nationality, else passport country; already mapped). */
  guideOrigin?: Market | null;
  /** Market the most recent prior turn was routed with, when stored (see `priorOriginOf`). */
  priorOrigin?: Market | null;
  /** The consultant's staff profile (request or saved); its `market` / `office` outranks the CRM region. */
  profile?: Record<string, unknown> | null;
  /** Where the counsellor counsels (CRM branch, else browser timezone): the default origin. */
  counsellorRegion?: CounsellorRegion | null;
}

/** Words that open a message continuing the previous one ("what about fees?", "and for PhD?"). */
const FOLLOW_UP_CUE = /^(?:and|also|but|so|then|ok(?:ay)?|what about|how about|what if|same|for (?:that|this|her|him|them)|is (?:that|it|this)|does (?:that|it|this))\b/i;
/** At most this many words and no country of its own: too short to be a request in its own right. */
const FOLLOW_UP_MAX_WORDS = 5;

/**
 * A message that only makes sense with the previous turn: it opens with a follow-up cue, or it
 * is very short (≤ 5 words). Deliberately simple — it only decides whether the previous turn's
 * countries carry over when this message names none, and a wrong "yes" merely keeps a country
 * filter that also admits global pages.
 */
export function isFollowUp(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  return FOLLOW_UP_CUE.test(text) || text.split(/\s+/).length <= FOLLOW_UP_MAX_WORDS;
}

const routable = (ds: readonly (Destination | string)[]): RoutedDestination[] =>
  ds.filter((d): d is RoutedDestination => d !== "other" && (DESTINATIONS as readonly string[]).includes(d));

/**
 * Layered country routing, a pure function of what the classifier and the conversation say:
 *  1. the classifier's destinations, then countries `extractDestinations` finds in the message
 *     (names, codes, country-only vocabulary such as "CAS" or "subclass 500"), minus any the
 *     message names only as the student's origin ("a student from Thailand");
 *  2. if neither found any and the turn refers back (Jev's `references_prior_turn`, or
 *     `isFollowUp`), the previous turn's countries: its stored route/intent when available,
 *     otherwise whatever `extractDestinations` finds in the last two history messages;
 *  3. a guided session's CRM destinations, only when nothing else named a country;
 *  4. an onshore counsellor's own country (Sydney → Australia), when still nothing did.
 *
 * The student's source market is decided alongside, first hit wins (`decideOrigin`). When that
 * market is also a destination (Thailand), the classifier's copy of it is dropped unless the
 * message names it as a place to study ("study in Thailand", "Thai universities"): Jev lists a
 * Thai student's home country among the destinations.
 */
export function decideRoute(args: RouteInput): RouteDecision {
  const followUp = args.history.length > 0 && Boolean(args.extras?.references_prior_turn || isFollowUp(args.input));
  let routed = routeCountries(args, followUp, null);
  const origin = decideOrigin(args, routed.countries, followUp);
  const home = origin.origin ? marketDestination(origin.origin) : null;
  if (home && routed.countries.includes(home) && !extractDestinations(args.input).includes(home) && !namesMarketAsDestination(args.input, origin.origin!)) {
    routed = routeCountries(args, followUp, home);
  }
  const { countries, countrySource } = routed;
  if (!countries.length && origin.onshore) {
    countries.push(origin.onshore);
    countrySource.push("onshore");
  }

  const comparing = isComparing(args.intent);
  return {
    countries,
    countrySource,
    topic: args.intent.primary_intent,
    stage: args.extras?.stage ?? "unspecified",
    mode: countries.length >= 2 && comparing ? "comparison" : countries.length ? "single" : "none",
    ...origin,
  };
}

/** Layers 1–3 of `decideRoute`; `dropFromClassifier` is a destination the classifier's list loses. */
function routeCountries(args: RouteInput, followUp: boolean, dropFromClassifier: RoutedDestination | null): Pick<RouteDecision, "countries" | "countrySource"> {
  const countries: RoutedDestination[] = [];
  const countrySource: CountrySource[] = [];
  const add = (ds: readonly RoutedDestination[], source: CountrySource) => {
    let added = false;
    for (const d of ds) {
      if (countries.length >= MAX_ROUTED_COUNTRIES) break;
      if (!countries.includes(d)) {
        countries.push(d);
        added = true;
      }
    }
    if (added) countrySource.push(source);
  };

  // Named only as the origin, inside a bank's name or as a relative's location: never a destination.
  const notDestinations = nonDestinationMentions(args.input);
  add(routable(args.intent.destinations).filter((d) => !notDestinations.includes(d) && d !== dropFromClassifier), "classifier");
  add(extractDestinations(args.input), "keywords");
  // A past refusal ("refused for Canada last year") is not one of the options beside others.
  const refused = refusalOnlyDestinations(args.input);
  if (refused.length && countries.some((d) => !refused.includes(d))) {
    for (const d of refused) {
      const i = countries.indexOf(d);
      if (i >= 0) countries.splice(i, 1);
    }
  }
  if (!countries.length && followUp) {
    const prior = routable(args.priorDestinations ?? []);
    add(prior.length ? prior : extractDestinations(args.history.slice(-2).join("\n")), "history");
  }
  if (!countries.length) add(routable(args.guideCountries ?? []), "guide");
  return { countries, countrySource };
}

/** The request asks for a side-by-side: task compare, or comparative_decision as primary or secondary topic. */
function isComparing(intent: Pick<Intent, "task" | "primary_intent" | "secondary_intents">): boolean {
  return intent.task === "compare" || intent.primary_intent === "comparative_decision" || intent.secondary_intents.includes("comparative_decision");
}

/**
 * The student's source market, first hit wins:
 *  1. the CRM student (a guided session's, nationality else passport country) — the record is the truth;
 *  2. an explicit mention in the message (`extractExplicitOrigin`: "Nepali student", "from Bangkok");
 *  3. the classifier's free-text `origin` ("Nepal"), mapped by name — unless it names one of this
 *     turn's destinations, which the classifier sometimes copies across (a Thailand question);
 *  4. on a follow-up, the previous turn's market (stored route, else the last two history messages);
 *  5. the default: where the consultant counsels — their Edge profile's `market` / `office`
 *     ("profile", an explicit choice), else their CRM branch or browser timezone ("counsellor");
 *  6. the message's language (`extractLanguageOrigin`: Devanagari, Romanized Nepali…) — below the
 *     counsellor's region, since a Kathmandu counsellor's Nepali says nothing about an Indian student.
 * With no market at all, an onshore counsellor's office (Australia, UK) is reported as `onshore`.
 */
function decideOrigin(args: RouteInput, countries: readonly RoutedDestination[], followUp: boolean): Pick<RouteDecision, "origin" | "originSource" | "onshore" | "counsellorRegion"> {
  const found = (origin: Market | null | undefined, originSource: OriginSource) => (origin ? { origin, originSource } : null);
  const classified = marketFromName(args.intent.origin);
  const region = args.counsellorRegion ?? null;
  const counsellorRegion: CounsellorRegionSummary | null = region ? { market: region.market, onshore: region.onshore, branch: region.branch, source: region.source } : null;
  const hit =
    found(args.guideOrigin, "crm") ??
    found(extractExplicitOrigin(args.input), "keywords") ??
    found(classified && !(countries as readonly string[]).includes(classified) ? classified : null, "classifier") ??
    (followUp ? found(args.priorOrigin ?? extractExplicitOrigin(args.history.slice(-2).join("\n")), "history") : null) ??
    found(marketFromProfile(args.profile), "profile") ??
    found(region?.market, region?.source === "profile" ? "profile" : "counsellor") ??
    found(extractLanguageOrigin(args.input), "language");
  return hit ? { ...hit, onshore: null, counsellorRegion } : { origin: null, originSource: null, onshore: region?.market ? null : (region?.onshore ?? null), counsellorRegion };
}

/**
 * The route re-decided once research has read a named CRM student, so the answer's packs fit the
 * actual student rather than the counsellor's default:
 *  - origin: the student's market (source "crm"), unless the message explicitly named one
 *    ("keywords") or a guided session's record already supplied it;
 *  - countries: the route's plus the student's deal and application countries — the message's
 *    own first when it named any, else the CRM's first — capped at MAX_ROUTED_COUNTRIES;
 *  - mode recomputed for the new country list.
 * Pure: the same route, student and intent always give the same decision.
 */
export function withCrmStudent(route: RouteDecision, student: CrmStudentRef, intent: Pick<Intent, "task" | "primary_intent" | "secondary_intents">): RouteDecision {
  const keepOrigin = route.originSource === "keywords" || route.originSource === "crm" || !student.origin;
  const named = route.countrySource.includes("classifier") || route.countrySource.includes("keywords");
  const extra = student.destinations.filter((d) => !route.countries.includes(d));
  const countries = (named ? [...route.countries, ...extra] : [...extra, ...route.countries]).slice(0, MAX_ROUTED_COUNTRIES);
  const added = extra.some((d) => countries.includes(d));
  const countrySource: CountrySource[] = added ? (named ? [...route.countrySource, "crm"] : ["crm", ...route.countrySource]) : route.countrySource;
  return {
    ...route,
    countries,
    countrySource,
    mode: countries.length >= 2 && isComparing(intent) ? "comparison" : countries.length ? "single" : "none",
    ...(keepOrigin ? {} : { origin: student.origin, originSource: "crm" as const, onshore: null }),
    crmStudent: student,
  };
}

/**
 * Countries of the most recent stored assistant turn: the route it was answered with, or, for
 * turns stored before routing existed, its classified destinations. Read from the stored
 * messages the chat service already loads, so the carry-over costs no extra query.
 */
export function priorDestinationsOf(messages: readonly StoredMessage[]): RoutedDestination[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "ai") continue;
    const meta = m.metadata ?? {};
    const route = (meta.route as { countries?: unknown } | undefined)?.countries;
    if (Array.isArray(route) && route.length) return routable(route.filter((d): d is string => typeof d === "string"));
    const intent = (meta.intent as { destinations?: unknown } | undefined)?.destinations;
    return Array.isArray(intent) ? routable(intent.filter((d): d is string => typeof d === "string")) : [];
  }
  return [];
}

/** Market of the most recent stored assistant turn's route, or null (none stored, or stored before origins). */
export function priorOriginOf(messages: readonly StoredMessage[]): Market | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "ai") continue;
    const origin = (m.metadata?.route as { origin?: unknown } | undefined)?.origin;
    return isMarket(origin) ? origin : null;
  }
  return null;
}

/**
 * The CRM student the most recent stored assistant turn read (`metadata.route.crmStudent`),
 * looking back through the stored window so a turn in between that read nobody does not lose
 * them. Null when no turn in the window read one (or it was stored before this existed).
 */
export function priorCrmStudentOf(messages: readonly StoredMessage[]): CrmStudentRef | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "ai") continue;
    const s = (m.metadata?.route as { crmStudent?: unknown } | undefined)?.crmStudent as Record<string, unknown> | undefined;
    if (!s || typeof s.contactId !== "string" || !s.contactId) continue;
    return {
      contactId: s.contactId,
      ...(typeof s.name === "string" && s.name.trim() ? { name: s.name.trim() } : {}),
      origin: isMarket(s.origin) ? s.origin : null,
      destinations: Array.isArray(s.destinations) ? routable(s.destinations.filter((d): d is string => typeof d === "string")) : [],
    };
  }
  return null;
}
