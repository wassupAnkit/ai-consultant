import { logger } from "../observability/logger";
import { MARKETS, type Market } from "../routing/markets";
import { DESTINATIONS, PRIMARY_INTENTS, type Destination } from "../schemas/intent.schema";
import { factsRegisterMarkdown } from "../skills/facts-register";
import { marketDomainsAll } from "../skills/markets";
import { officialDomainsAll } from "../skills/packs";
import { emptyCrawlStats, parseRobots, type FetchedPage, type RobotsRules } from "./crawler";
import { extractPage } from "./extract";
import { indexPage, type IngestDeps, type IngestStats } from "./pipeline";
import type { CrawlSource } from "./sources";

/**
 * Official pages: the government, regulator and test-body pages counsellors rely on for rules,
 * fees and paperwork, re-crawled every night into the knowledge base (`sourceKind: "official"`,
 * source `official:<host>`). The list is exact URLs, never a site crawl:
 *
 * - every official URL a facts register cites (docs/facts/*.md, via data/facts), so a register
 *   row and the page it quotes are both evidence; third-party sources a register cites (law
 *   firms, news, insurers) are left out;
 * - the curated pages in data/official-pages.json (destinations without a register, source-market
 *   paperwork, test bodies, legislation slices).
 *
 * Fetching is polite and honest: robots.txt is obeyed, one request at a time per host with a gap,
 * and the user agent names us (OFFICIAL_USER_AGENT). A page that refuses automated clients (most
 * US federal hosts) is reported as failed, never worked around; its last indexed copy is kept,
 * and the live official search still covers it at answer time.
 *
 * A page whose text changed since the last run is reported (`changed`, `kb_pages.contentChangedAt`)
 * so the facts-register rows citing it get re-checked (`bun run official:changes`).
 */

export const OFFICIAL_AUTHORITIES = [
  "immigration",
  "education_regulator",
  "student_portal",
  "test_body",
  "government",
  "education_ministry",
  "foreign_ministry",
  "central_bank",
  "police",
  "credential_body",
  "legislation",
] as const;
export type OfficialAuthority = (typeof OFFICIAL_AUTHORITIES)[number];

export interface OfficialPage {
  /** What is fetched (may carry a query, e.g. the eCFR renderer API). */
  url: string;
  /** Short title a counsellor recognises; used as the page title when the HTML has none or is sliced. */
  label: string;
  /** Destination the page is about, or "global" (test bodies, cross-destination). Absent for market pages. */
  country?: Destination | "global";
  /** Source market the page serves (home-country paperwork). Absent for destination pages. */
  market?: Market;
  authority: OfficialAuthority;
  topics: string[];
  /** Keep only the HTML from the element with id=`from` up to (not including) the element with id=`to`. */
  slice?: { from: string; to?: string };
  /** The human page to cite when `url` is an API (stored as the chunk URL). */
  citeUrl?: string;
  /** Where the entry came from. */
  origin: "curated" | "facts";
}

export interface OfficialPagesFile {
  version: string;
  note?: string;
  pages: unknown[];
  blocked?: unknown[];
}

const GOVERNMENT_HOST = /(?:^|\.)(?:gov|govt|gouv|gob|go|gc|mil)\.[a-z]{2,3}$|\.gov$|(?:^|\.)gov\.uk$|(?:^|\.)canada\.ca$|(?:^|\.)europa\.eu$/;

/** Registrable-ish host of a URL: lower-cased, `www.` stripped. */
export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** Whether a host is an official source: a government TLD, or a pack / market official domain (suffix match). */
export function isOfficialHost(host: string, extra: Iterable<string> = []): boolean {
  if (GOVERNMENT_HOST.test(host)) return true;
  for (const d of [...officialDomainsAll(), ...marketDomainsAll(), ...extra]) {
    const dom = d.toLowerCase().replace(/^www\./, "");
    if (host === dom || host.endsWith(`.${dom}`)) return true;
  }
  return false;
}

/** The identity of a page in the knowledge base: the cited URL, without a trailing slash on a bare path. */
export function officialKey(p: Pick<OfficialPage, "url" | "citeUrl">): string {
  const u = new URL(p.citeUrl ?? p.url);
  u.hostname = u.hostname.toLowerCase();
  if (!u.search && !u.hash && u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

const DESTINATION_SET = new Set<string>([...DESTINATIONS, "global"]);
const MARKET_SET = new Set<string>(MARKETS);
const AUTHORITY_SET = new Set<string>(OFFICIAL_AUTHORITIES);
const TOPIC_SET = new Set<string>(PRIMARY_INTENTS);

/** Validate data/official-pages.json. Bad entries are dropped and reported; good ones are returned. */
export function validateOfficialPages(file: OfficialPagesFile): { pages: OfficialPage[]; errors: string[] } {
  const pages: OfficialPage[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  (file.pages ?? []).forEach((raw, i) => {
    const at = `pages[${i}]`;
    const r = raw as Record<string, unknown>;
    const err = (m: string) => errors.push(`${at}: ${m}`);
    if (typeof r?.url !== "string" || !/^https:\/\//.test(r.url)) return err("url must be https");
    try {
      new URL(r.url);
      if (typeof r.citeUrl === "string") new URL(r.citeUrl);
    } catch {
      return err(`invalid url ${String(r.url)}`);
    }
    if (typeof r.label !== "string" || r.label.trim().length < 3) return err("label missing");
    const hasCountry = r.country !== undefined;
    const hasMarket = r.market !== undefined;
    if (hasCountry === hasMarket) return err("needs exactly one of country or market");
    if (hasCountry && !DESTINATION_SET.has(String(r.country))) return err(`unknown country ${String(r.country)}`);
    if (hasMarket && !MARKET_SET.has(String(r.market))) return err(`unknown market ${String(r.market)}`);
    if (!AUTHORITY_SET.has(String(r.authority))) return err(`unknown authority ${String(r.authority)}`);
    const topics = Array.isArray(r.topics) ? r.topics.map(String) : [];
    const badTopics = topics.filter((t) => !TOPIC_SET.has(t));
    if (badTopics.length) err(`unknown topics ${badTopics.join(", ")} (dropped)`);
    const slice = r.slice as { from?: unknown; to?: unknown } | undefined;
    if (slice !== undefined && (typeof slice?.from !== "string" || (slice.to !== undefined && typeof slice.to !== "string"))) return err("slice needs a string from (and optional to)");
    const page: OfficialPage = {
      url: r.url,
      label: r.label.trim(),
      ...(hasCountry ? { country: r.country as Destination | "global" } : { market: r.market as Market }),
      authority: r.authority as OfficialAuthority,
      topics: topics.filter((t) => TOPIC_SET.has(t)),
      ...(slice ? { slice: { from: slice.from as string, ...(typeof slice.to === "string" ? { to: slice.to } : {}) } } : {}),
      ...(typeof r.citeUrl === "string" ? { citeUrl: r.citeUrl } : {}),
      origin: "curated",
    };
    const key = officialKey(page);
    if (seen.has(key)) return err(`duplicate ${key}`);
    seen.add(key);
    pages.push(page);
  });
  return { pages, errors };
}

const LINK = /\[([^\]]{2,200})\]\((https:\/\/[^)\s]+)\)/g;
const NON_HTML = /\.(?:json|pdf|xml|csv|docx?|xlsx?|zip)$/i;
const BARE = /(?<!\]\()https:\/\/[^\s|)<>\]]+/g;

/** Every cited URL on one register line with its label: a markdown link's text, else the table row's first cell. */
function lineLinks(line: string): { url: string; label: string }[] {
  const out = [...line.matchAll(LINK)].map((m) => ({ url: m[2]!, label: m[1]!.trim() }));
  const rowLabel = line.trim().startsWith("|") ? (line.trim().slice(1).split("|")[0] ?? "").trim() : "";
  for (const m of line.matchAll(BARE)) {
    const url = m[0];
    if (!out.some((o) => o.url === url)) out.push({ url, label: rowLabel || url });
  }
  return out;
}

/**
 * The official pages a facts register cites: every link (markdown or bare URL) on an official
 * host, labelled with its link text or row (the first one wins), tagged with the register's
 * destination ("global" for the scholarships register). API links (with a query) and document
 * files (PDF, JSON…) are left out: the curated list owns those.
 */
export function factsRegisterPages(markdown: Readonly<Record<string, string>>, isOfficial: (host: string) => boolean = (h) => isOfficialHost(h)): OfficialPage[] {
  const out = new Map<string, OfficialPage>();
  for (const [slug, md] of Object.entries(markdown)) {
    const country = (DESTINATION_SET.has(slug) ? slug : "global") as Destination | "global";
    for (const line of md.split("\n")) {
      for (const link of lineLinks(line)) {
        const url = link.url.replace(/[.,;:]+$/, "");
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          continue;
        }
        if (parsed.search || NON_HTML.test(parsed.pathname) || !isOfficial(hostOf(url))) continue;
        parsed.hash = "";
        const page: OfficialPage = { url: parsed.toString(), label: link.label.slice(0, 160), country, authority: "government", topics: [], origin: "facts" };
        const key = officialKey(page);
        if (!out.has(key)) out.set(key, page);
      }
    }
  }
  return [...out.values()];
}

/** Curated entries win over the facts-register entry for the same page (they carry authority and topics). */
export function mergeOfficialPages(curated: OfficialPage[], facts: OfficialPage[]): OfficialPage[] {
  const byKey = new Map<string, OfficialPage>();
  for (const p of facts) byKey.set(officialKey(p), p);
  for (const p of curated) byKey.set(officialKey(p), p);
  return [...byKey.values()].sort((a, b) => officialKey(a).localeCompare(officialKey(b)));
}

export const OFFICIAL_PAGES_PATH = new URL("../../data/official-pages.json", import.meta.url).pathname;

/** The full list: data/official-pages.json plus every facts register's official sources. */
export async function loadOfficialPages(path = OFFICIAL_PAGES_PATH): Promise<{ pages: OfficialPage[]; errors: string[] }> {
  const file = Bun.file(path);
  const json: OfficialPagesFile = (await file.exists()) ? await file.json() : { version: "none", pages: [] };
  const { pages: curated, errors } = validateOfficialPages(json);
  const extraHosts = curated.map((p) => hostOf(p.url));
  const facts = factsRegisterPages(factsRegisterMarkdown(), (h) => isOfficialHost(h, extraHosts));
  return { pages: mergeOfficialPages(curated, facts), errors };
}

/** Document type stored on an official page's chunks: market pages carry their market so retrieval can keep them to it. */
export function officialDocType(p: Pick<OfficialPage, "market">): string {
  return p.market ? `official_market:${p.market}` : "official";
}


export function officialSource(p: OfficialPage): CrawlSource {
  return {
    name: `official:${hostOf(p.url)}`,
    seeds: [],
    allow: [],
    maxPages: 1,
    maxDepth: 0,
    country: p.country ?? "global",
    market: p.market ?? "global",
    docType: officialDocType(p),
  };
}

/**
 * The HTML from the element carrying id=`from` up to the element carrying id=`to` (or the end).
 * Null when `from` is missing: the page's structure changed and the slice must be re-checked.
 */
export function sliceHtml(html: string, slice: { from: string; to?: string }): string | null {
  const at = html.indexOf(`id="${slice.from}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<", at);
  let end = html.length;
  if (slice.to) {
    const toAt = html.indexOf(`id="${slice.to}"`, at);
    if (toAt >= 0) end = html.lastIndexOf("<", toAt);
  }
  return `<html><body>${html.slice(start, end)}</body></html>`;
}

export interface FetchOfficialOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** robots.txt rules per origin, shared across pages of a run. */
  robots?: Map<string, RobotsRules>;
}

export type OfficialFetch = { ok: true; fetched: FetchedPage; crawlDelayMs: number } | { ok: false; status: number | null; error: string; crawlDelayMs: number };

async function robotsFor(origin: string, opts: FetchOfficialOptions): Promise<RobotsRules> {
  const cached = opts.robots?.get(origin);
  if (cached) return cached;
  let rules: RobotsRules = { disallow: [], crawlDelayMs: 0 };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${origin}/robots.txt`, { headers: { "user-agent": opts.userAgent }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) rules = parseRobots(await res.text(), opts.userAgent);
  } catch {
    /* no robots.txt → allow */
  }
  opts.robots?.set(origin, rules);
  return rules;
}

/**
 * Where to fetch a page whose site asks automated clients to use its API instead: the Federal
 * Register answers page requests with a "Request Access" challenge and points to its developer
 * API, whose documents link this full-text HTML. The page itself stays the cited URL. Null for
 * every other page. (eCFR asks the same, but its robots.txt disallows the renderer API, so eCFR
 * pages are reported as refused.)
 */
export function apiAlternative(url: string): { url: string } | null {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (host === "federalregister.gov") {
    const m = u.pathname.match(/^\/documents\/(\d{4})\/(\d{2})\/(\d{2})\/([\w-]+)(?:\/|$)/);
    if (m) return { url: `https://www.federalregister.gov/documents/full_text/html/${m[1]}/${m[2]}/${m[3]}/${m[4]}.html` };
  }
  return null;
}

/** A bot-challenge or access-denied interstitial served with a 200. */
const CHALLENGE = /^(?:#\s*)?(?:request access|access denied|just a moment|attention required|are you a robot|verify you are human)\b|flagged as potentially automated|complete the captcha/im;

/** Official pages shorter than this after extraction are JavaScript shells or stubs, reported rather than indexed. */
export const OFFICIAL_MIN_CHARS = 1_500;
/** Longest text kept from one official page (whole rules and statutes run to hundreds of pages). */
export const OFFICIAL_MAX_CHARS = 80_000;

/**
 * The page content some government CMSs ship as JSON instead of HTML: immi.homeaffairs.gov.au
 * (SharePoint) renders every visa page from the `PageSchemaHiddenField` JSON, leaving the HTML
 * body nearly empty. Titles become headings and HTML fragments are kept, in document order.
 * Null when the page has no such field.
 */
export function embeddedPageContent(html: string): string | null {
  const m = html.match(/id="[^"]*PageSchemaHiddenField_Input"[^>]*\bvalue="([^"]*)"/) ?? html.match(/\bvalue="([^"]*)"[^>]*id="[^"]*PageSchemaHiddenField_Input"/);
  if (!m) return null;
  let schema: unknown;
  try {
    schema = JSON.parse(decodeEntities(m[1]!));
  } catch {
    return null;
  }
  const out: string[] = [];
  const isHtml = (v: string) => /<(?:p|li|ul|ol|a|br|strong|table|h\d|div)\b/i.test(v);
  const walk = (node: unknown, depth: number) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth));
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const title = typeof obj.title === "string" && !isHtml(obj.title) ? obj.title.trim() : "";
    if (title) out.push(`<h${Math.min(depth, 4)}>${escapeHtml(title)}</h${Math.min(depth, 4)}>`);
    for (const [key, value] of Object.entries(obj)) {
      if (key === "title") continue;
      if (typeof value === "string") {
        if (isHtml(value)) out.push(value);
        else if (value.trim().length >= 40 && /^(?:description|subTitle|text|body|content|notes|block)$/.test(key)) out.push(`<p>${escapeHtml(value.trim())}</p>`);
      } else walk(value, title ? depth + 1 : depth);
    }
  };
  walk(schema, 2);
  return out.length ? out.join("\n") : null;
}

/** Keep the leading sections (what the chunker reads) and text within `max` characters. */
function capPage(page: { text: string; sections: { text: string }[] }, max: number) {
  let used = 0;
  const kept: typeof page.sections = [];
  for (const section of page.sections) {
    if (used >= max) break;
    kept.push(used + section.text.length > max ? { ...section, text: section.text.slice(0, max - used) } : section);
    used += section.text.length;
  }
  page.sections = kept;
  page.text = page.text.slice(0, max);
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:quot|amp|lt|gt|#39|apos|#x([0-9a-f]+)|#(\d+));/gi, (e, hex: string | undefined, dec: string | undefined) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number(dec));
    return { "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&apos;": "'" }[e.toLowerCase()] ?? e;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fetch one official page (robots.txt first) and extract it under its cited URL: through the
 * site's API when it asks for that (`apiAlternative`), sliced when asked, from embedded page JSON
 * when the CMS ships content that way. Challenge pages and near-empty JavaScript shells fail.
 */
export async function fetchOfficialPage(p: OfficialPage, opts: FetchOfficialOptions): Promise<OfficialFetch> {
  const alt = p.citeUrl ? null : apiAlternative(p.url);
  const fetchUrl = alt?.url ?? p.url;
  const slice = p.slice;
  const cited: OfficialPage = alt ? { ...p, url: fetchUrl, citeUrl: p.url } : p;
  const u = new URL(fetchUrl);
  const rules = await robotsFor(u.origin, opts);
  const crawlDelayMs = rules.crawlDelayMs;
  if (rules.disallow.some((d) => u.pathname.startsWith(d))) return { ok: false, status: null, error: "disallowed by robots.txt", crawlDelayMs };
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(fetchUrl, {
      headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message.slice(0, 200), crawlDelayMs };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, error: res.status === 403 ? "refused automated access (403)" : `HTTP ${res.status}`, crawlDelayMs };
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status, error: `not HTML (${type || "no content type"})`, crawlDelayMs };
  }
  let html = await res.text();
  if (slice) {
    const sliced = sliceHtml(html, slice);
    if (sliced === null) return { ok: false, status: res.status, error: `slice anchor id="${slice.from}" not found`, crawlDelayMs };
    html = sliced;
  }
  const key = officialKey(cited);
  let page = await extractPage(html, key);
  // Some CMSs ship the content as page JSON with a near-empty body: keep whichever says more.
  const embedded = embeddedPageContent(html);
  if (embedded) {
    const fromJson = await extractPage(`<html><head><title>${html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? ""}</title></head><body><main>${embedded}</main></body></html>`, key);
    if (fromJson.text.length > page.text.length) page = fromJson;
  }
  if (CHALLENGE.test(`${page.title}\n${page.text.slice(0, 1_500)}`)) return { ok: false, status: res.status, error: "refused automated access (challenge page)", crawlDelayMs };
  if (page.text.length < OFFICIAL_MIN_CHARS) return { ok: false, status: res.status, error: `too little text (${page.text.length} chars; likely rendered by JavaScript)`, crawlDelayMs };
  if (page.text.length > OFFICIAL_MAX_CHARS) capPage(page, OFFICIAL_MAX_CHARS);
  page.url = key;
  if (slice || alt || !page.title.trim()) page.title = p.label;
  page.links = [];
  return { ok: true, fetched: { page, status: res.status, depth: 0, fetchedAt: new Date() }, crawlDelayMs };
}

export interface OfficialIngestOptions {
  userAgent: string;
  /** Minimum gap between two requests to one host (robots.txt Crawl-delay wins when longer). */
  delayMs: number;
  /** Hosts fetched at once (pages of one host are always sequential). */
  hostParallelism?: number;
  /** Epoch ms: no new page is started after it. */
  deadline?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Remove official pages that are no longer on the list (skipped when the list had errors or shrank by half). */
  sweep?: boolean;
}

export interface OfficialIngestResult {
  stats: IngestStats;
  changed: { url: string; label: string }[];
  failed: { url: string; status: number | null; error: string }[];
  /** Pages left for the next run because the deadline passed. */
  deferred: number;
  swept: { pages: number; chunks: number } | null;
}

/** Fetch and index every official page; unchanged pages cost a fetch and a hash, never an embedding. */
export async function ingestOfficialPages(pages: OfficialPage[], deps: IngestDeps, opts: OfficialIngestOptions): Promise<OfficialIngestResult> {
  const crawl = emptyCrawlStats();
  const stats: IngestStats = { source: "official", pagesSeen: 0, pagesIndexed: 0, pagesUnchanged: 0, pagesSkipped: 0, chunksWritten: 0, chunksDeleted: 0, embeddingCalls: 0, coursePages: 0, crawl };
  const changed: OfficialIngestResult["changed"] = [];
  const failed: OfficialIngestResult["failed"] = [];
  const robots = new Map<string, RobotsRules>();
  let deferred = 0;

  const byHost = new Map<string, OfficialPage[]>();
  for (const p of pages) byHost.set(hostOf(p.url), [...(byHost.get(hostOf(p.url)) ?? []), p]);
  const hosts = [...byHost.keys()];
  crawl.queued = pages.length;

  const runHost = async (host: string) => {
    let last = 0;
    for (const p of byHost.get(host)!) {
      if (opts.deadline !== undefined && Date.now() > opts.deadline) {
        deferred++;
        crawl.truncated = true;
        continue;
      }
      const r = await fetchOfficialPage(p, { userAgent: opts.userAgent, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs, robots });
      const wait = Math.max(opts.delayMs, r.crawlDelayMs) - (Date.now() - last);
      last = Date.now();
      if (!r.ok) {
        if (r.error === "disallowed by robots.txt") crawl.blockedByRobots++;
        else if (r.status === null) crawl.fetchErrors++;
        else if (r.status >= 400) crawl.httpErrors++;
        else crawl.nonHtml++;
        failed.push({ url: p.url, status: r.status, error: r.error });
        logger.warn("official page not fetched; keeping the last indexed copy", { url: p.url, status: r.status, err: r.error });
      } else {
        crawl.fetched++;
        stats.pagesSeen++;
        try {
          const out = await indexPage(r.fetched, officialSource(p), deps);
          stats[out.outcome === "indexed" ? "pagesIndexed" : out.outcome === "unchanged" ? "pagesUnchanged" : "pagesSkipped"]++;
          stats.chunksWritten += out.chunksWritten;
          stats.chunksDeleted += out.chunksDeleted;
          stats.embeddingCalls += out.embeddingCalls;
          if (out.changed) {
            changed.push({ url: r.fetched.page.url, label: p.label });
            logger.warn("official page changed since the last run", { url: r.fetched.page.url, label: p.label });
          }
        } catch (err) {
          failed.push({ url: p.url, status: r.fetched.status, error: `index failed: ${(err as Error).message.slice(0, 200)}` });
          logger.error("official page index failed", { url: p.url, err: (err as Error).message });
        }
      }
      if (wait > 0) await Bun.sleep(wait);
    }
  };

  const queue = [...hosts];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(opts.hostParallelism ?? 4, hosts.length)) }, async () => {
      while (queue.length) await runHost(queue.shift()!);
    }),
  );

  let swept: OfficialIngestResult["swept"] = null;
  if (opts.sweep && !deps.dryRun) swept = await sweepOfficialPages(pages, deps.collections);
  logger.info("official pages ingested", { ...stats, changed: changed.length, failed: failed.length, deferred } as unknown as Record<string, unknown>);
  return { stats, changed, failed, deferred, swept };
}

/**
 * Delete official pages (and their chunks) that are no longer on the list. A page that merely
 * failed to fetch stays: it is still on the list. Skipped when the list is less than half the
 * pages indexed now (a broken or truncated list must never wipe the official knowledge).
 */
export async function sweepOfficialPages(pages: OfficialPage[], c: Pick<IngestDeps["collections"], "kbPages" | "kbChunks">): Promise<{ pages: number; chunks: number } | null> {
  const keep = new Set(pages.map(officialKey));
  const indexed = await c.kbPages.find({ source: { $regex: "^official:" } }, { projection: { _id: 1 } }).toArray();
  if (indexed.length && keep.size < indexed.length * 0.5) {
    logger.warn("official sweep skipped: the list is less than half of the indexed official pages", { listed: keep.size, indexed: indexed.length });
    return null;
  }
  const gone = indexed.map((d) => d._id).filter((id) => !keep.has(id));
  if (!gone.length) return { pages: 0, chunks: 0 };
  const chunks = await c.kbChunks.deleteMany({ url: { $in: gone } });
  await c.kbPages.deleteMany({ _id: { $in: gone } });
  logger.info("swept official pages no longer listed", { pages: gone.length, chunks: chunks.deletedCount });
  return { pages: gone.length, chunks: chunks.deletedCount };
}
