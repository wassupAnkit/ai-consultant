import { MARKETS, type Market } from "../../routing/markets";
import type { MarketPackDefinition } from "../types";
import { BANGLADESH } from "./bangladesh";
import { INDIA } from "./india";
import { NEPAL } from "./nepal";
import { PHILIPPINES } from "./philippines";
import { SRI_LANKA } from "./sri_lanka";
import { THAILAND } from "./thailand";
import { VIETNAM } from "./vietnam";

/** The hand-written half of each market pack. Kept dependency-free so src/live/policy.ts can import it. */
export const MARKET_PACK_DEFINITIONS: Record<Market, MarketPackDefinition> = {
  nepal: NEPAL,
  india: INDIA,
  bangladesh: BANGLADESH,
  vietnam: VIETNAM,
  philippines: PHILIPPINES,
  thailand: THAILAND,
  sri_lanka: SRI_LANKA,
};

/** Union of every market pack's official domains, for the live-fetch allowlist. */
export function marketDomainsAll(): string[] {
  return [...new Set(MARKETS.flatMap((m) => MARKET_PACK_DEFINITIONS[m].officialSources.map((s) => s.domain)))].sort();
}
