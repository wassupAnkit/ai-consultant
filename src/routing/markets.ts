import { DESTINATIONS } from "../schemas/intent.schema";
import { precededByOriginCue, type RoutedDestination } from "./countries";

/**
 * Source markets: where Expert Education's students come from. The second routing axis next to
 * the destination: the same Australian visa question is counselled differently for a Nepali and
 * a Thai student (goals, family finance, home-country approvals, grading, document chains).
 */
export const MARKETS = ["nepal", "india", "bangladesh", "vietnam", "philippines", "thailand", "sri_lanka"] as const;
export type Market = (typeof MARKETS)[number];

export const MARKET_LABELS: Readonly<Record<Market, string>> = {
  nepal: "Nepal",
  india: "India",
  bangladesh: "Bangladesh",
  vietnam: "Vietnam",
  philippines: "Philippines",
  thailand: "Thailand",
  sri_lanka: "Sri Lanka",
};

/** The market's name inside a sentence ("a student from the Philippines"). */
export function marketInText(market: Market): string {
  return market === "philippines" ? `the ${MARKET_LABELS.philippines}` : MARKET_LABELS[market];
}

export function isMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

/**
 * One market's origin vocabulary. Terms follow `CountryEntry`'s rules (src/routing/countries.ts):
 * whole tokens only, any case, and a space also matches a hyphen or no space ("Viet Nam" ≡
 * "Vietnam", "Sri Lanka" ≡ "SriLanka").
 */
export interface MarketEntry {
  label: string;
  /** The country's names and demonyms: any mention makes this the student's origin. */
  aliases: readonly string[];
  /**
   * Cities and states: also the student's origin, but a weaker signal than a name or demonym
   * (a branch, a review course or a college can be in a city the student is not from).
   */
  cities?: readonly string[];
  /**
   * Places that are also study destinations (Thailand, Bangkok): an origin only after an origin
   * cue ("from Bangkok", "citizen of Thailand"), so "study in Thailand" stays a destination.
   */
  places?: readonly string[];
  /** ISO 3166 alpha-2 and alpha-3 codes, accepted only as a whole field (`marketFromName`). */
  codes: readonly string[];
}

export const MARKET_REGISTRY: Readonly<Record<Market, MarketEntry>> = {
  nepal: {
    label: MARKET_LABELS.nepal,
    aliases: ["nepal", "nepali", "nepalese"],
    cities: ["kathmandu", "pokhara", "lalitpur", "bhaktapur", "biratnagar", "butwal", "chitwan", "dharan", "birgunj", "nepalgunj", "itahari", "hetauda"],
    codes: ["np", "npl"],
  },
  india: {
    label: MARKET_LABELS.india,
    aliases: ["india", "indian", "punjabi", "gujarati"],
    cities: ["punjab", "delhi", "new delhi", "hyderabad", "mumbai", "bangalore", "bengaluru", "chennai", "kolkata", "gujarat", "ahmedabad", "kerala", "pune", "chandigarh", "jalandhar", "ludhiana", "amritsar"],
    codes: ["in", "ind"],
  },
  bangladesh: {
    label: MARKET_LABELS.bangladesh,
    aliases: ["bangladesh", "bangladeshi"],
    cities: ["dhaka", "chittagong", "chattogram", "sylhet", "khulna", "rajshahi"],
    codes: ["bd", "bgd"],
  },
  vietnam: {
    label: MARKET_LABELS.vietnam,
    aliases: ["viet nam", "vietnamese"],
    cities: ["hanoi", "ho chi minh city", "ho chi minh", "hcmc", "saigon", "da nang", "hai phong", "can tho"],
    codes: ["vn", "vnm"],
  },
  philippines: {
    label: MARKET_LABELS.philippines,
    aliases: ["philippines", "filipino", "filipina", "filipinos", "pinoy", "pinay"],
    cities: ["manila", "metro manila", "cebu", "davao", "quezon city", "makati", "iloilo"],
    codes: ["ph", "phl"],
  },
  thailand: {
    label: MARKET_LABELS.thailand,
    // Thailand is also a destination: the country and its cities need an origin cue, and the
    // demonym does not count when it names Thailand's own institutions ("Thai universities").
    aliases: ["thai"],
    places: ["thailand", "bangkok", "chiang mai", "phuket"],
    codes: ["th", "tha"],
  },
  sri_lanka: {
    label: MARKET_LABELS.sri_lanka,
    aliases: ["sri lanka", "sri lankan", "lankan"],
    cities: ["colombo", "kandy", "galle", "jaffna", "negombo"],
    codes: ["lk", "lka"],
  },
};

/** Markets that are also destinations, whose demonym can name the destination's own things. */
const DESTINATION_MARKETS = new Set<Market>(MARKETS.filter((m) => (DESTINATIONS as readonly string[]).includes(m)));

/** The market's own country as a study destination (Thailand → "thailand"), else null. */
export function marketDestination(market: Market): RoutedDestination | null {
  return DESTINATION_MARKETS.has(market) ? (market as RoutedDestination) : null;
}
/** After a destination market's demonym: it names that country's institutions or visa, not the student ("Thai universities", "Thai student visa"). */
const DESTINATION_NOUN = /^[\s-]+(?:student\s+)?(?:visas?|universit(?:y|ies)|colleges?|campus(?:es)?|institutions?|immigration|government|programmes?|programs?|courses?|schools?|degrees?)\b/i;

interface TermTarget {
  market: Market;
  /** Needs an origin cue (or a name-only field) to count. */
  place: boolean;
  /** A city or state (`MarketEntry.cities`): a weaker origin signal than a name or demonym. */
  city: boolean;
}

const unseparated = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERMS = new Map<string, TermTarget>();
const CODES = new Map<string, Market>();
for (const [market, e] of Object.entries(MARKET_REGISTRY) as [Market, MarketEntry][]) {
  for (const a of e.aliases) TERMS.set(unseparated(a), { market, place: false, city: false });
  for (const c of e.cities ?? []) TERMS.set(unseparated(c), { market, place: false, city: true });
  for (const p of e.places ?? []) TERMS.set(unseparated(p), { market, place: true, city: false });
  for (const c of e.codes) CODES.set(c, market);
}
/** Longest first, so "ho chi minh city" and "sri lankan" win over "ho chi minh" and "sri lanka". */
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${(Object.values(MARKET_REGISTRY) as MarketEntry[])
    .flatMap((e) => [...e.aliases, ...(e.cities ?? []), ...(e.places ?? [])])
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/[ -]/g, "[\\s-]*"))
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/**
 * The student's source market as the message states or implies it, else null: the explicit
 * mention first (`extractExplicitOrigin`), then the language it is written in
 * (`extractLanguageOrigin`). Routing consults the two at different levels — a counsellor's region
 * outranks a language cue but not a stated nationality — so `decideRoute` calls them apart.
 * Pure and synchronous: safe on every turn.
 */
export function extractOrigin(text: string): Market | null {
  return extractExplicitOrigin(text) ?? extractLanguageOrigin(text);
}

/**
 * The market the message states most explicitly ("Indian national", "from Kathmandu", "Nepali",
 * "HCMC"), else null. Thailand and its cities count only after an origin cue ("from Bangkok") —
 * "study in Thailand" is a destination, matching `extractDestinations`.
 *
 * Mentions are ranked (`originStrength`), strongest first, then earliest: a nationality, passport
 * or "from <place>" beats a bare name or demonym, which beats a bare city, which beats a place
 * after a location cue ("our Makati branch", "currently in Manila", "Dhaka office"). A walk-in at
 * "our Makati branch is an Indian national … from Kerala … currently in Manila" is Indian; before
 * this the first match (Makati) won (counsellor audit, Oct 2026).
 */
export function extractExplicitOrigin(text: string): Market | null {
  let best: { market: Market; strength: number } | null = null;
  for (const m of text.matchAll(PATTERN)) {
    const t = TERMS.get(unseparated(m[0]));
    if (!t || !countsAsOrigin(text, m.index!, m[0], t)) continue;
    const strength = originStrength(text, m.index!, m[0], t);
    if (!best || strength > best.strength) best = { market: t.market, strength };
  }
  return best?.market ?? null;
}

/** Just before a place: the student is from there ("from", "citizen of", "passport from", "born in"). */
const STRONG_ORIGIN_BEFORE = /(?:\bfrom|\bnationals?\s+of|\bcitizens?\s+of|\bcitizenship\s+of|\bpassport\s+(?:holders?\s+)?(?:of|from)|\bborn\s+(?:and\s+raised\s+)?in|\bnatives?\s+of|\bhails?\s+from)\s+(?:the\s+)?$/i;
/** Just after a name or demonym: nationality ("Indian national", "Filipino passport", "Kathmandu-born"). */
const STRONG_ORIGIN_AFTER = /^[\s-]*(?:nationals?|citizens?|citizenship|passports?|born)\b/i;
/** Just before a place: where someone is or works now, not where they are from ("currently in", "our … branch"). */
const LOCATION_BEFORE = /(?:\bin|\bat|\bnear|\bliving\s+in|\blives\s+in|\bbased\s+in|\bresiding\s+in|\bresidents?\s+of|\bstaying\s+in|\bstudying\s+in|\bworking\s+in|\bworks\s+in)\s+(?:the\s+)?$/i;
/** Just after a place: an office or branch there ("Makati branch", "Dhaka office"). */
const LOCATION_AFTER = /^[\s-]*(?:branch(?:es)?|office|campus|centre|center|hub)\b/i;

/** Origin rules every mention must pass: a place needs an origin cue; a destination market's demonym before an institution noun names the destination. */
function countsAsOrigin(text: string, index: number, term: string, t: TermTarget): boolean {
  if (t.place && !precededByOriginCue(text, index)) return false;
  if (!t.place && DESTINATION_MARKETS.has(t.market) && DESTINATION_NOUN.test(text.slice(index + term.length))) return false;
  return true;
}

/** 3 nationality / passport / "from X"; 2 a name or demonym; 1 a city; 0 a place after a location cue. */
function originStrength(text: string, index: number, term: string, t: TermTarget): number {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + term.length, index + term.length + 30);
  if (STRONG_ORIGIN_BEFORE.test(before) || STRONG_ORIGIN_AFTER.test(after)) return 3;
  if (LOCATION_BEFORE.test(before) || LOCATION_AFTER.test(after)) return 0;
  return t.city || t.place ? 1 : 2;
}

/**
 * The market the message's language implies, else null. In order:
 *  1. the script: Devanagari → Nepal (India when Hindi words outnumber Nepali ones), Bengali →
 *     Bangladesh, Thai → Thailand, Sinhala or Tamil → Sri Lanka, Vietnamese tone letters → Vietnam;
 *  2. Romanized Nepali, Hinglish or Taglish: at least two distinct cue words, and more than the
 *     other two languages have.
 * A weaker signal than an explicit mention: a counsellor in Kathmandu may type Romanized Nepali
 * about an Indian student.
 */
export function extractLanguageOrigin(text: string): Market | null {
  return scriptOrigin(text) ?? romanizedOrigin(text);
}

/**
 * Whether the message names `market`'s own country as a place to study: one of its places without
 * an origin cue ("study in Bangkok"), or its demonym before an institution or visa noun ("Thai
 * universities"). The mirror image of `scan`'s origin rules; the country's name itself is a
 * destination keyword (`extractDestinations`) and is checked by the caller.
 */
export function namesMarketAsDestination(text: string, market: Market): boolean {
  if (!DESTINATION_MARKETS.has(market)) return false;
  for (const m of text.matchAll(PATTERN)) {
    const t = TERMS.get(unseparated(m[0]));
    if (!t || t.market !== market) continue;
    if (t.place ? !precededByOriginCue(text, m.index!) : DESTINATION_NOUN.test(text.slice(m.index! + m[0].length))) return true;
  }
  return false;
}

/** First market term in a field that only holds a place (CRM nationality, office), so places need no cue. */
function scanName(text: string): Market | null {
  for (const m of text.matchAll(PATTERN)) {
    const t = TERMS.get(unseparated(m[0]));
    if (t) return t.market;
  }
  return null;
}

const SCRIPTS: { market: Market | "devanagari"; re: RegExp }[] = [
  { market: "devanagari", re: /[ऀ-ॿ]/g },
  { market: "bangladesh", re: /[ঀ-৿]/g },
  { market: "thailand", re: /[฀-๿]/g },
  { market: "sri_lanka", re: /[඀-෿]/g }, // Sinhala
  { market: "sri_lanka", re: /[஀-௿]/g }, // Tamil
  // Letters only Vietnamese uses (ă đ ơ ư and the stacked tone vowels); â ê ô are shared with French.
  { market: "vietnam", re: /[ăđơưĂĐƠƯẠ-ỹ]/g },
];
/** Fewer characters of a script than this is a stray name or symbol, not the message's language. */
const MIN_SCRIPT_CHARS = 2;

/** Hindi words that Nepali does not use (Nepali has छ/हो, कसरी, चाहिन्छ, गर्नु…). */
const HINDI_WORDS = new Set(["है", "हैं", "क्या", "नहीं", "मुझे", "हूँ", "हूं", "था", "थी", "करना", "करने", "चाहिए", "कैसे", "कितना", "कितने", "और", "लिए", "यह", "वह", "सकता", "सकते", "मेरा", "मेरी", "आप"]);
/** Nepali words that Hindi does not use, plus Nepali-only suffixes (-लाई, -हरू, -्छ verb endings). */
const NEPALI_WORDS = new Set(["छ", "छन्", "छु", "छैन", "हुन्छ", "गर्न", "गर्ने", "गर्नु", "भएको", "मलाई", "कसरी", "कति", "पनि", "हजुर", "चाहिन्छ", "सक्छ"]);
const isNepaliWord = (w: string) => NEPALI_WORDS.has(w) || /(?:लाई|हरू|हरु|्छ|्छन्|्छु)$/.test(w);

function scriptOrigin(text: string): Market | null {
  let best: { market: Market | "devanagari"; n: number } | null = null;
  for (const s of SCRIPTS) {
    const n = text.match(s.re)?.length ?? 0;
    if (n >= MIN_SCRIPT_CHARS && (!best || n > best.n)) best = { market: s.market, n };
  }
  if (!best) return null;
  if (best.market !== "devanagari") return best.market;
  const words = text.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const hindi = words.filter((w) => HINDI_WORDS.has(w)).length;
  const nepali = words.filter(isNepaliWord).length;
  return hindi > nepali ? "india" : "nepal";
}

/** Romanized cue words per language; each counts once however often it appears. */
const ROMANIZED: { market: Market; cues: Set<string> }[] = [
  {
    market: "nepal",
    cues: new Set(["cha", "chha", "xa", "chaina", "chhaina", "garne", "garna", "garnu", "garera", "gareko", "milcha", "milchha", "milxa", "bhayeko", "bhaeko", "ko", "lai", "malai", "hunchha", "huncha", "hunxa", "parcha", "parchha", "parxa", "sakcha", "sakchha", "kasari", "kati", "kina", "hola", "thiyo", "bhanne", "pani", "lagi", "chahincha", "chahinchha", "hajur", "ramro"]),
  },
  {
    market: "india",
    cues: new Set(["hai", "hain", "kya", "nahi", "nahin", "karna", "karne", "karni", "mujhe", "chahiye", "kaise", "kitna", "kitne", "kitni", "aur", "bhi", "hoga", "hogi", "raha", "rahi", "rahe", "tha", "thi", "liye", "sakte", "sakta", "wala", "wali", "yaar", "kuch", "batao", "bataiye"]),
  },
  {
    market: "philippines",
    cues: new Set(["mga", "naman", "kasi", "yung", "paano", "magkano", "salamat", "po", "opo", "gusto", "ako", "pwede", "sana", "ba"]),
  },
];
const MIN_ROMANIZED_CUES = 2;

function romanizedOrigin(text: string): Market | null {
  const words = new Set(text.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  const counts = ROMANIZED.map(({ market, cues }) => ({ market, n: [...cues].filter((c) => words.has(c)).length })).sort((a, b) => b.n - a.n);
  const [first, second] = counts;
  return first && first.n >= MIN_ROMANIZED_CUES && first.n > (second?.n ?? 0) ? first.market : null;
}

/**
 * A free-text field that names a country or place (CRM nationality "Nepal", passport "IND",
 * office "Kathmandu", classifier origin "Nepal") → market, else null. A whole field is compared
 * against every name, place and code; a longer text is scanned with places counted without an
 * origin cue (the field itself says it is the origin), then by script.
 */
export function marketFromName(name: string | null | undefined): Market | null {
  const k = name?.trim();
  if (!k) return null;
  const key = unseparated(k);
  const exact = TERMS.get(key)?.market ?? CODES.get(key);
  return exact ?? scanName(k) ?? scriptOrigin(k);
}

/** Profile keys that say where the consultant works, and so where their students usually come from. */
const PROFILE_KEYS = ["market", "office"] as const;

/**
 * The market of the consultant's staff profile (`profile.market`, else `profile.office`), mapped
 * with `marketFromName`; a nested value ({ name: "Colombo" }) is read through its strings.
 */
export function marketFromProfile(profile: Record<string, unknown> | null | undefined): Market | null {
  if (!profile) return null;
  for (const key of PROFILE_KEYS) {
    const found = marketFromName(stringsOf(profile[key]).join(" "));
    if (found) return found;
  }
  return null;
}

function stringsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(stringsOf);
  if (v && typeof v === "object") return Object.values(v).flatMap(stringsOf);
  return [];
}

// --- Counsellor region --------------------------------------------------------

/** Onshore destinations Expert Education has offices in: their students come from many markets. */
export type Onshore = "australia" | "united_kingdom";

export const ONSHORE_LABELS: Readonly<Record<Onshore, string>> = { australia: "Australia", united_kingdom: "UK" };

/**
 * Where the consultant counsels, and so the market a turn assumes when nothing names the
 * student's: an offshore market (a Kathmandu branch → Nepal), or an onshore office (Sydney,
 * London) whose students are already in that country and come from anywhere — then `market` is
 * null and `onshore` says which. `source` is where it was read: the CRM user's primary branch,
 * the CRM user record, the browser's timezone, or the consultant's own Edge profile.
 */
export interface CounsellorRegion {
  market: Market | null;
  onshore: Onshore | null;
  /** The CRM branch's name, when the region came from one. */
  branch: string | null;
  source: "crm_branch" | "crm_user" | "timezone" | "profile";
}

/** IANA zones (current and legacy names) of each market's country; each market has exactly one. */
const MARKET_ZONES: Readonly<Record<string, Market>> = {
  "asia/kathmandu": "nepal",
  "asia/katmandu": "nepal",
  "asia/kolkata": "india",
  "asia/calcutta": "india",
  "asia/dhaka": "bangladesh",
  "asia/dacca": "bangladesh",
  "asia/ho_chi_minh": "vietnam",
  "asia/saigon": "vietnam",
  "asia/manila": "philippines",
  "asia/bangkok": "thailand",
  "asia/colombo": "sri_lanka",
};
const UK_ZONES = new Set(["europe/london", "europe/belfast", "gb", "gb-eire"]);

/**
 * An IANA timezone ("Asia/Kathmandu") → the office region it implies, else null. Asia/Bangkok
 * also covers Vietnam's north and Cambodia; it is read as Thailand, the market it names.
 */
export function marketFromTimezone(tz: string | null | undefined): Pick<CounsellorRegion, "market" | "onshore"> | null {
  const k = tz?.trim().toLowerCase();
  if (!k) return null;
  const market = MARKET_ZONES[k];
  if (market) return { market, onshore: null };
  if (k.startsWith("australia/")) return { market: null, onshore: "australia" };
  if (UK_ZONES.has(k)) return { market: null, onshore: "united_kingdom" };
  return null;
}

/** Australian and British cities a branch is named after ("Sydney (CBD)", "London Bridge"). */
const ONSHORE_PLACES: readonly [Onshore, RegExp][] = [
  ["australia", /\b(?:australia|aus|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|gold coast|parramatta|geelong|wollongong|newcastle nsw)\b/i],
  ["united_kingdom", /\b(?:united kingdom|great britain|uk|gb|gbr|england|scotland|wales|london|manchester|birmingham|leeds|glasgow|edinburgh|cardiff|liverpool|bristol|nottingham|leicester|sheffield)\b/i],
];

/** A branch country, city or name that places the office onshore in Australia or the UK, else null. */
export function onshoreFromName(name: string | null | undefined): Onshore | null {
  const k = name?.trim();
  if (!k) return null;
  if (/^(?:au|aus)$/i.test(k)) return "australia";
  for (const [onshore, re] of ONSHORE_PLACES) if (re.test(k)) return onshore;
  return null;
}
