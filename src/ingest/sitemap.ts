/**
 * Sitemap discovery for partner-university sites. Link-following alone misses
 * deep course catalogs (often behind search UIs); sitemaps list every course
 * page with a lastmod we can use to skip unchanged pages.
 */
export interface SitemapEntry {
  loc: string;
  lastmod?: Date;
}

export interface ParsedSitemap {
  urls: SitemapEntry[];
  /** Nested sitemaps (from a sitemap index). */
  sitemaps: string[];
}

/** Candidate sitemap URLs for an origin: robots.txt `Sitemap:` lines plus conventional locations. */
export function sitemapCandidates(origin: string, robotsText?: string | null): string[] {
  const out = new Set<string>();
  for (const line of (robotsText ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m) {
      try {
        out.add(new URL(m[1]!, origin).toString());
      } catch {
        /* ignore malformed */
      }
    }
  }
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml"]) out.add(origin + p);
  return [...out];
}

/** Parse a urlset or sitemapindex document (regex-based; tolerant of namespaces and CDATA). */
export function parseSitemap(xml: string): ParsedSitemap {
  const urls: SitemapEntry[] = [];
  const sitemaps: string[] = [];
  const clean = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  for (const block of xml.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const body = block[2]!;
    const loc = body.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1];
    if (!loc) continue;
    const location = clean(loc);
    if (block[1]!.toLowerCase() === "sitemap" || (isIndex && !urls.length && /sitemap/i.test(location) && /\.xml(\.gz)?$/i.test(location))) {
      sitemaps.push(location);
      continue;
    }
    const lastmodRaw = body.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1];
    const lastmod = lastmodRaw ? new Date(clean(lastmodRaw)) : undefined;
    urls.push({ loc: location, ...(lastmod && !Number.isNaN(lastmod.getTime()) ? { lastmod } : {}) });
  }
  return { urls, sitemaps };
}

export interface CollectSitemapOptions {
  fetchImpl?: typeof fetch;
  userAgent: string;
  allow?: RegExp[];
  deny?: RegExp[];
  /** Sitemap files to read at most (indexes can fan out). */
  maxFiles?: number;
  maxUrls?: number;
  timeoutMs?: number;
  robotsText?: string | null;
  /** Explicit sitemap URLs (registry) tried first. */
  extra?: string[];
}

/** Fetch sitemaps for an origin (following one level of index nesting) and return in-scope URLs with lastmod. */
export async function collectSitemapUrls(origin: string, opts: CollectSitemapOptions): Promise<{ entries: SitemapEntry[]; filesRead: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxFiles = opts.maxFiles ?? 50;
  const maxUrls = opts.maxUrls ?? 20_000;
  const queue = [...(opts.extra ?? []), ...sitemapCandidates(origin, opts.robotsText)];
  const seen = new Set<string>();
  const entries = new Map<string, SitemapEntry>();
  let filesRead = 0;
  while (queue.length && filesRead < maxFiles && entries.size < maxUrls) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let xml: string;
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": opts.userAgent, accept: "application/xml,text/xml,*/*" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await res.arrayBuffer());
      xml = url.endsWith(".gz") || type.includes("gzip") ? new TextDecoder().decode(Bun.gunzipSync(buf)) : new TextDecoder().decode(buf);
    } catch {
      continue;
    }
    if (!/<(urlset|sitemapindex)\b/i.test(xml)) continue;
    filesRead++;
    const parsed = parseSitemap(xml);
    for (const s of parsed.sitemaps) if (!seen.has(s)) queue.push(s);
    for (const e of parsed.urls) {
      if (opts.allow && !opts.allow.some((re) => re.test(e.loc))) continue;
      if (opts.deny?.some((re) => re.test(e.loc))) continue;
      if (!entries.has(e.loc)) entries.set(e.loc, e);
      if (entries.size >= maxUrls) break;
    }
  }
  return { entries: [...entries.values()], filesRead };
}
