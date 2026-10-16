import { PACK_COUNTRIES, type PackCountry, type PackDefinition } from "../types";
import { AUSTRALIA } from "./australia";
import { CANADA } from "./canada";
import { NEW_ZEALAND } from "./new_zealand";
import { UNITED_KINGDOM } from "./united_kingdom";
import { UNITED_STATES } from "./united_states";

/** The hand-written half of each pack. Kept dependency-free so src/live/policy.ts can import it. */
export const PACK_DEFINITIONS: Record<PackCountry, PackDefinition> = {
  australia: AUSTRALIA,
  canada: CANADA,
  new_zealand: NEW_ZEALAND,
  united_kingdom: UNITED_KINGDOM,
  united_states: UNITED_STATES,
};

/** Union of every pack's official domains, for the live-fetch allowlist. */
export function officialDomainsAll(): string[] {
  return [...new Set(PACK_COUNTRIES.flatMap((c) => PACK_DEFINITIONS[c].officialSources.map((s) => s.domain)))].sort();
}
