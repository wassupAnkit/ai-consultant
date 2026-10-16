import type { PartnerSeed } from "../ingest/sources";
import type { PartnerRegistry } from "../partners/registry";
import { normalizeHost } from "./policy";

/**
 * Partner-university hostnames for the live-fetch domain policy. Prefers the
 * registry (kb_partners); falls back to data/partners.json when the registry
 * is empty or unreachable so live lookups keep working on a fresh environment.
 */
export function partnerDomainProvider(registry: PartnerRegistry | null, seedsPath = new URL("../../data/partners.json", import.meta.url)) {
  return async (): Promise<Set<string>> => {
    if (registry) {
      try {
        const fromRegistry = await registry.domains();
        if (fromRegistry.size) return fromRegistry;
      } catch {
        /* fall back to seeds */
      }
    }
    return loadPartnerDomainsFromSeeds(seedsPath);
  };
}

export async function loadPartnerDomainsFromSeeds(path = new URL("../../data/partners.json", import.meta.url)): Promise<Set<string>> {
  const seeds = (await Bun.file(path).json()) as PartnerSeed[];
  return partnerDomainsOf(seeds);
}

export function partnerDomainsOf(seeds: Pick<PartnerSeed, "website" | "enabled">[]): Set<string> {
  const out = new Set<string>();
  for (const s of seeds) {
    if (!s.website || s.enabled === false) continue;
    try {
      const host = normalizeHost(new URL(s.website).hostname);
      if (host) out.add(host);
      // Also allow the registrable parent when the site lives on a subdomain (study.csu.edu.au → csu.edu.au).
      const parts = host.split(".");
      if (parts.length > 2 && !/^(edu|ac|co|com|org|gov|net)$/.test(parts[parts.length - 2]!)) out.add(parts.slice(1).join("."));
      else if (parts.length > 3) out.add(parts.slice(1).join("."));
    } catch {
      /* skip malformed seeds */
    }
  }
  return out;
}
