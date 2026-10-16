import { logger } from "../observability/logger";
import { absolutize, extractPage, type ExtractedPage } from "./extract";
import { collectSitemapUrls } from "./sitemap";
import type { CrawlSource } from "./sources";

export interface FetchedPage {
  page: ExtractedPage;
  status: number;
  depth: number;
  fetchedAt: Date;
  /** Sitemap lastmod, when the URL came from a sitemap. */
  lastmod?: Date;
}

export interface CrawlStats {
  queued: number;
  fetched: number;
  skippedUnchanged: number;
  blockedByRobots: number;
  httpErrors: number;
  nonHtml: number;
  fetchErrors: number;
  sitemapUrls: number;
  /** The crawl ended with URLs still queued (page limit or deadline). */
  truncated: boolean;
}

export const emptyCrawlStats = (): CrawlStats => ({ queued: 0, fetched: 0, skippedUnchanged: 0, blockedByRobots: 0, httpErrors: 0, nonHtml: 0, fetchErrors: 0, sitemapUrls: 0, truncated: false });

export interface CrawlOptions {
  userAgent: string;
  concurrency: number;
  delayMs: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Stop after this many pages regardless of the source limit (CLI --max). */
  hardLimit?: number;
  /** Seed the queue from sitemaps (robots.txt `Sitemap:`, conventional paths, `source.sitemaps`). */
  useSitemaps?: boolean;
  /** Queue priority (higher first); default FIFO. */
  prioritize?: (url: string) => number;
  /** Epoch ms: stop dequeuing after this instant (the current fetches finish). */
  deadline?: number;
  /** Return true to skip fetching a URL whose sitemap lastmod is not newer than what we have. */
  skipUnchanged?: (url: string, lastmod: Date | undefined) => Promise<boolean> | boolean;
  /** Mutated in place with counters. */
  stats?: CrawlStats;
}

interface QueueItem {
  url: string;
  depth: number;
  priority: number;
  lastmod?: Date;
}

/**
 * Polite crawler: allow/deny lists, robots.txt (User-agent: * and our own UA),
 * per-host delay, bounded depth, page count and wall-clock. Breadth-first by
 * default; with `prioritize`, course-looking URLs are fetched first so a
 * partner's page budget goes to its catalog. Sitemaps (when enabled) pre-seed
 * the queue with every in-scope URL and its lastmod.
 */
export async function* crawl(source: CrawlSource, opts: CrawlOptions): AsyncGenerator<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const stats = opts.stats ?? emptyCrawlStats();
  const seen = new Set<string>();
  const queue: QueueItem[] = [];
  const robots = new Map<string, RobotsRules & { text: string | null }>();
  const lastHit = new Map<string, number>();
  let fetched = 0;
  const limit = Math.min(source.maxPages, opts.hardLimit ?? Infinity);

  const enqueue = (url: string, depth: number, lastmod?: Date) => {
    const norm = normalizeUrl(url);
    if (!norm || seen.has(norm)) return;
    if (!source.allow.some((re) => re.test(norm))) return;
    if (source.deny?.some((re) => re.test(norm))) return;
    seen.add(norm);
    const item: QueueItem = { url: norm, depth, priority: opts.prioritize ? opts.prioritize(norm) : 0, lastmod };
    if (opts.prioritize) {
      // Binary insertion keeps the queue sorted by priority (desc), FIFO within equal priority.
      let lo = 0,
        hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (queue[mid]!.priority >= item.priority) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, item);
    } else queue.push(item);
    stats.queued++;
  };

  const getRobots = async (origin: string) => {
    const cached = robots.get(origin);
    if (cached) return cached;
    let rules: RobotsRules & { text: string | null } = { disallow: [], crawlDelayMs: 0, text: null };
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, { headers: { "user-agent": opts.userAgent }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const text = await res.text();
        rules = { ...parseRobots(text, opts.userAgent), text };
      }
    } catch {
      /* no robots.txt → allow */
    }
    robots.set(origin, rules);
    return rules;
  };

  for (const s of source.seeds) enqueue(s, 0);

  if (opts.useSitemaps) {
    const origins = new Set<string>();
    for (const s of source.seeds) {
      try {
        origins.add(new URL(s).origin);
      } catch {
        /* skip */
      }
    }
    for (const origin of origins) {
      const rules = await getRobots(origin);
      try {
        const { entries, filesRead } = await collectSitemapUrls(origin, {
          fetchImpl,
          userAgent: opts.userAgent,
          allow: source.allow,
          deny: source.deny,
          robotsText: rules.text,
          extra: source.sitemaps?.filter((u) => u.startsWith(origin)),
        });
        for (const e of entries) enqueue(e.loc, 1, e.lastmod);
        stats.sitemapUrls += entries.length;
        if (filesRead) logger.info("sitemap urls queued", { source: source.name, origin, files: filesRead, urls: entries.length });
      } catch (err) {
        logger.debug("sitemap discovery failed", { origin, err: (err as Error).message });
      }
    }
  }

  const pastDeadline = () => opts.deadline !== undefined && Date.now() > opts.deadline;

  const worker = async function* (): AsyncGenerator<FetchedPage> {
    while (queue.length && fetched < limit && !pastDeadline()) {
      const item = queue.shift()!;
      const u = new URL(item.url);
      const rules = await getRobots(u.origin);
      if (rules.disallow.some((p) => u.pathname.startsWith(p))) {
        stats.blockedByRobots++;
        continue;
      }
      if (opts.skipUnchanged && item.lastmod && (await opts.skipUnchanged(item.url, item.lastmod))) {
        stats.skippedUnchanged++;
        continue;
      }

      const wait = Math.max(opts.delayMs, rules.crawlDelayMs) - (Date.now() - (lastHit.get(u.host) ?? 0));
      if (wait > 0) await Bun.sleep(wait);
      lastHit.set(u.host, Date.now());

      let res: Response;
      try {
        res = await fetchImpl(item.url, {
          headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml" },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        stats.fetchErrors++;
        logger.warn("fetch failed", { url: item.url, err: (err as Error).message });
        continue;
      }
      fetched++;
      stats.fetched++;
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("html")) {
        if (!res.ok) stats.httpErrors++;
        else stats.nonHtml++;
        logger.debug("skipped non-HTML or error response", { url: item.url, status: res.status, type });
        continue;
      }
      const finalUrl = normalizeUrl(res.url || item.url) ?? item.url;
      if (finalUrl !== item.url) {
        if (seen.has(finalUrl)) continue;
        seen.add(finalUrl);
        if (!source.allow.some((re) => re.test(finalUrl))) continue;
      }
      const html = await res.text();
      const page = await extractPage(html, finalUrl);
      if (item.depth < source.maxDepth) {
        for (const link of page.links) enqueue(link, item.depth + 1);
      }
      yield { page, status: res.status, depth: item.depth, fetchedAt: new Date(), ...(item.lastmod ? { lastmod: item.lastmod } : {}) };
    }
  };

  // Simple concurrency: run N workers and merge their output.
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () => worker());
  const pending = new Map<AsyncGenerator<FetchedPage>, Promise<{ w: AsyncGenerator<FetchedPage>; r: IteratorResult<FetchedPage> }>>();
  for (const w of workers) pending.set(w, w.next().then((r) => ({ w, r })));
  while (pending.size) {
    const { w, r } = await Promise.race(pending.values());
    if (r.done) {
      pending.delete(w);
      continue;
    }
    pending.set(w, w.next().then((res) => ({ w, r: res })));
    yield r.value;
  }
  if (queue.length && (fetched >= limit || pastDeadline())) stats.truncated = true;
}

export function normalizeUrl(url: string): string | null {
  const abs = absolutize(url, url);
  if (!abs) return null;
  const u = new URL(abs);
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase();
  if (!/\.[a-z0-9]{1,5}$/i.test(u.pathname) && !u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

export interface RobotsRules {
  disallow: string[];
  crawlDelayMs: number;
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.split("/")[0]!.toLowerCase();
  const groups: { agents: string[]; disallow: string[]; delay: number }[] = [];
  let cur: (typeof groups)[number] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    const key = k!.trim().toLowerCase();
    if (key === "user-agent") {
      if (!cur || cur.disallow.length || cur.delay) {
        cur = { agents: [], disallow: [], delay: 0 };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
    } else if (cur && key === "disallow" && v) cur.disallow.push(v);
    else if (cur && key === "crawl-delay") cur.delay = Number(v) * 1000 || 0;
  }
  const match = groups.find((g) => g.agents.some((a) => a !== "*" && ua.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  return { disallow: match?.disallow ?? [], crawlDelayMs: match?.delay ?? 0 };
}
