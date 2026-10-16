import type { PartnerRecord } from "../partners/registry";
import type { Destination } from "../schemas/intent.schema";
import type { ExtractedPage } from "./extract";
import { indexSyntheticPage, type IngestDeps } from "./pipeline";

/** This scraper is Expert Education specific ingest tooling, independent of the generic persona config. */
export const PARTNERS_URL = "https://experteducation.com/nepal/our-education-partners/";
const ORG_NAME = "Expert Education";

/**
 * The partner page renders university logos as <img alt="University name">
 * (Australia server-side; other countries client-side), so a plain crawl only
 * sees the copy. This builds one synthetic document per country from the
 * partner registry (plus any names found on the page that the registry lacks)
 * so the assistant can answer "which universities do we work with in Canada?".
 */
export async function fetchPartnerNamesFromSite(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(PARTNERS_URL, { headers: { "user-agent": "ExpertEducationEdgeBot/1.0" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const names = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+alt="([^"]{3,90})"/g)) {
    const alt = m[1]!.trim();
    if (/expert education|students|graduates|logo|icon|banner|hero/i.test(alt)) continue;
    if (/universit|college|institute|school|tafe|polytechnic|academy/i.test(alt)) names.add(alt);
  }
  return [...names];
}

export function buildPartnerDocuments(records: PartnerRecord[], siteNames: string[]): ExtractedPage[] {
  const byCountry = new Map<string, Set<string>>();
  for (const r of records) {
    const set = byCountry.get(r.country) ?? new Set<string>();
    set.add(r.website ? `${r.name} (${r.website})` : r.name);
    byCountry.set(r.country, set);
  }
  // Names found on the site but not in the registry are listed under "unlisted" so nothing is lost.
  const known = new Set(records.flatMap((r) => [r.name.toLowerCase(), ...r.aliases.map((a) => a.toLowerCase())]));
  const unknown = siteNames.filter((n) => !known.has(n.toLowerCase()));
  if (unknown.length) byCountry.set("unlisted", new Set(unknown));

  const pages: ExtractedPage[] = [];
  const label = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  for (const [country, names] of byCountry) {
    const list = [...names].sort();
    const heading = country === "unlisted" ? "Other partner institutions" : `Partner universities in ${label(country)}`;
    const text =
      `${ORG_NAME} represents ${list.length} partner universities and institutions in ${label(country)}. ` +
      `Students can apply to these institutions through ${ORG_NAME} counsellors. Partner institutions in ${label(country)}: ` +
      list.join("; ") +
      `. Full list: ${PARTNERS_URL}`;
    pages.push({
      url: `${PARTNERS_URL}#${country}`,
      title: `Expert Education partner universities — ${label(country)}`,
      description: heading,
      lang: "en",
      canonical: PARTNERS_URL,
      sections: [{ heading, level: 2, text }],
      links: [],
      text: `## ${heading}\n${text}`,
    });
  }
  return pages;
}

export async function indexPartnerList(deps: IngestDeps, records: PartnerRecord[], fetchImpl: typeof fetch = fetch) {
  const siteNames = await fetchPartnerNamesFromSite(fetchImpl).catch(() => []);
  const pages = buildPartnerDocuments(records, siteNames);
  let indexed = 0;
  for (const page of pages) {
    const country = page.url.split("#")[1];
    const r = await indexSyntheticPage(
      page,
      { name: "experteducation.com", docType: "partners", market: "global", country: country && country !== "unlisted" ? (country as Destination) : "global" },
      deps,
    );
    if (r.outcome === "indexed") indexed++;
  }
  return { documents: pages.length, indexed, partnersFromSite: siteNames.length, partnersInRegistry: records.length };
}
