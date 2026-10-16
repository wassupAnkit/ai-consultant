import type { CaseStage } from "../classify/jev";
import type { Market } from "../routing/markets";
import type { PrimaryIntent } from "../schemas/intent.schema";

/** Destinations with a v1 skill pack, sorted by slug (prompt text depends on this order). */
export const PACK_COUNTRIES = ["australia", "canada", "new_zealand", "united_kingdom", "united_states"] as const;
export type PackCountry = (typeof PACK_COUNTRIES)[number];

/** How quickly the fact behind a checklist item goes stale (from the catalog's refresh_cadence). */
export type Freshness = "policy" | "annual" | "stable";

/** One thing a complete answer must cover. A label only: the figure always comes from cited evidence. */
export interface ChecklistItem {
  /** Catalog id, e.g. `E.067` (docs/data-model/catalog.csv). */
  id: string;
  label: string;
  /** Case stages the item matters at; absent = every stage. */
  stages?: Exclude<CaseStage, "unspecified">[];
  freshness: Freshness;
}

export type SourceAuthority = "immigration" | "education_regulator" | "student_portal" | "test_body" | "government";

export interface OfficialSource {
  /** Registrable host, matched suffix-wise by the live-fetch policy. */
  domain: string;
  authority: SourceAuthority;
  topics: PrimaryIntent[] | "all";
}

/** The hand-written half of a pack (src/skills/packs/*.ts). */
export interface PackDefinition {
  country: PackCountry;
  label: string;
  /** Bumped whenever sources or vocabulary change; recorded per turn as `slug@version`. */
  version: string;
  officialSources: OfficialSource[];
  /** Search / query-expansion terms per topic, at most 8 each. No figures. */
  vocabulary: Partial<Record<PrimaryIntent, string[]>>;
}

export interface CountryPack extends PackDefinition {
  /** Coverage checklists per topic, generated from the data-model catalog. */
  checklists: Partial<Record<PrimaryIntent, ChecklistItem[]>>;
}

export interface ResolvedPack {
  country: PackCountry;
  label: string;
  version: string;
  checklist: ChecklistItem[];
  officialDomains: string[];
  vocabulary: string[];
}

export interface ResolvedPacks {
  packs: ResolvedPack[];
  /** `slug@version` per loaded destination pack, for tracing. */
  versions: string[];
  /** The student's source-market pack, when the route has an origin and market packs are on. */
  market?: ResolvedMarket | null;
}

// --- Market (origin) packs ---------------------------------------------------

export type MarketSourceAuthority = "education_ministry" | "central_bank" | "police" | "foreign_ministry" | "credential_body" | "government" | "regulator";

export interface MarketSource {
  /** Registrable host, matched suffix-wise by the live-fetch policy. */
  domain: string;
  authority: MarketSourceAuthority;
  topics: PrimaryIntent[] | "all";
}

/**
 * The hand-written half of a market pack (src/skills/markets/*.ts): what a student FROM this
 * market needs on the home side (approvals, loans, foreign exchange, police and civil documents,
 * grading), whatever the destination. Like destination packs it carries no facts.
 */
export interface MarketPackDefinition {
  market: Market;
  label: string;
  /** Bumped whenever sources or vocabulary change; recorded per turn as `slug@version`. */
  version: string;
  languages: {
    /** The language drafts for the student's family are written in when the consultant asks for one. */
    draft: string;
  };
  officialSources: MarketSource[];
  /** Search / query-expansion terms per topic, at most 8 each. No figures. */
  vocabulary: Partial<Record<PrimaryIntent, string[]>>;
}

export interface MarketPack extends MarketPackDefinition {
  /** Origin-side checklists per topic, generated from the data-model catalog (`MARKET_CHECKLISTS`). */
  checklists: Partial<Record<PrimaryIntent, ChecklistItem[]>>;
}

export interface ResolvedMarket {
  market: Market;
  label: string;
  version: string;
  draftLanguage: string;
  checklist: ChecklistItem[];
  officialDomains: string[];
  vocabulary: string[];
}
