import { inferMarket, MARKETS as SITE_MARKETS } from "../ingest/sources";
import type { Market } from "../routing/markets";
import { sourceKindOf, type RetrievedChunk, type SearchQuery } from "./store";

const SITE_HOST = "experteducation.com";

/**
 * The experteducation.com market section written for a student's source market (`/vietnam/` for
 * vietnam), or null when the site has none (Sri Lanka): then every market section is another
 * market's, and only market-neutral pages are preferred.
 */
export function siteMarketOf(market: Market): string | null {
  return (SITE_MARKETS as readonly string[]).includes(market) ? market : null;
}

/**
 * The Expert Education market section a chunk was written for, or null for a market-neutral one
 * (shared tools, study areas) and for anything that is not an experteducation.com page (partner,
 * upload and program chunks are never ranked by market). Read off the URL: that is exactly the
 * `metadata.market` ingest stores (`source.market ?? inferMarket(url)`), since each market source
 * only crawls its own section, and it needs no extra projection (the in-app cache drops metadata).
 */
export function chunkSiteMarket(c: Pick<RetrievedChunk, "url" | "source" | "docType" | "sourceKind">): string | null {
  if ((c.sourceKind ?? sourceKindOf(c.source, c.docType)) !== "site") return null;
  try {
    const host = new URL(c.url).hostname.replace(/^www\./, "");
    return host === SITE_HOST ? inferMarket(c.url) : null;
  } catch {
    return null;
  }
}

/**
 * The source market an official page serves (`docType` "official_market:<market>", stored by
 * src/ingest/official.ts for home-country paperwork pages), or null for any other chunk.
 */
export function officialChunkMarket(c: Pick<RetrievedChunk, "source" | "docType" | "sourceKind">): string | null {
  if ((c.sourceKind ?? sourceKindOf(c.source, c.docType)) !== "official") return null;
  return c.docType?.startsWith("official_market:") ? c.docType.slice("official_market:".length) : null;
}

/** How many results a store fetches before `rankByMarket` cuts back to `k`: double with a market, else `k`. */
export function marketOverFetch(q: Pick<SearchQuery, "k" | "market">): number {
  return q.market ? q.k * 2 : q.k;
}

/**
 * Re-rank retrieved chunks for the student's source market (counsellor audit N11: 76% of answers
 * for South-East Asian students cited another market's pages, with other finance rules and stale
 * figures). Among experteducation.com chunks, the student's own market section comes first, then
 * market-neutral pages, then other markets' sections; relevance order is kept inside each tier.
 * The site chunks are re-ordered within the slots they already held, so partner, upload and
 * program chunks keep their positions. Other markets' pages are then dropped while enough other
 * results remain to fill `k`, and otherwise fill the tail. Official home-country pages (a Nepal
 * NOC page) are treated the same way: another market's go last, the student's own stay put.
 * No market → the first `k`, unchanged.
 */
export function rankByMarket(chunks: readonly RetrievedChunk[], market: Market | undefined, k: number): RetrievedChunk[] {
  if (!market) return chunks.slice(0, k);
  const own = siteMarketOf(market);
  // 0 own market, 1 market-neutral site page, 2 another market's page; null = not a site chunk.
  const tier = (c: RetrievedChunk): 0 | 1 | 2 | null => {
    const officialMarket = officialChunkMarket(c);
    if (officialMarket !== null) return officialMarket === market ? null : 2;
    if ((c.sourceKind ?? sourceKindOf(c.source, c.docType)) !== "site") return null;
    const m = chunkSiteMarket(c);
    return m === null ? 1 : m === own ? 0 : 2;
  };
  const tiers = chunks.map(tier);
  const slots = tiers.flatMap((t, i) => (t === null ? [] : [i]));
  const ordered = slots.map((i) => ({ c: chunks[i]!, t: tiers[i]! })).sort((a, b) => a.t - b.t);
  const placed = chunks.map((c, i) => ({ c, t: tiers[i] }));
  slots.forEach((slot, j) => (placed[slot] = ordered[j]!));
  const kept = placed.filter((p) => p.t !== 2).map((p) => p.c);
  const others = placed.filter((p) => p.t === 2).map((p) => p.c);
  return [...kept, ...others].slice(0, k);
}
