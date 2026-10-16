import type { Embeddings } from "@langchain/core/embeddings";
import type { Collections, KbChunkDoc, KbPageDoc } from "../db/mongo";
import { logger } from "../observability/logger";
import { sourceKindOf } from "../retrieval/store";
import { chunkPage } from "./chunk";
import { detectCoursePage, crawlPriority } from "./course-detect";
import { crawl, emptyCrawlStats, type CrawlOptions, type CrawlStats, type FetchedPage } from "./crawler";
import type { ExtractedPage } from "./extract";
import { inferCountry, inferDocType, inferMarket, type CrawlSource } from "./sources";

export interface IngestStats {
  source: string;
  pagesSeen: number;
  pagesIndexed: number;
  pagesUnchanged: number;
  pagesSkipped: number;
  chunksWritten: number;
  chunksDeleted: number;
  embeddingCalls: number;
  /** Pages detected as course/program pages this run. */
  coursePages: number;
  crawl: CrawlStats;
}

export interface IngestDeps {
  collections: Collections;
  embeddings: Embeddings;
  crawlOptions: CrawlOptions;
  force?: boolean;
  dryRun?: boolean;
  minChars?: number;
  /** Ingest run id stamped on every page seen (orphan sweep compares against it). */
  runId?: string;
  /** Called after each page is indexed (e.g. structured program extraction). */
  onPageIndexed?: (page: ExtractedPage, ctx: { source: CrawlSource; contentHash: string; isCourse: boolean }) => Promise<void>;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Crawl one source and upsert its chunks. Idempotent: unchanged pages are skipped. */
export async function ingestSource(source: CrawlSource, deps: IngestDeps): Promise<IngestStats> {
  const crawlStats = emptyCrawlStats();
  const stats: IngestStats = {
    source: source.name + (source.market ? `/${source.market}` : ""),
    pagesSeen: 0,
    pagesIndexed: 0,
    pagesUnchanged: 0,
    pagesSkipped: 0,
    chunksWritten: 0,
    chunksDeleted: 0,
    embeddingCalls: 0,
    coursePages: 0,
    crawl: crawlStats,
  };
  const options: CrawlOptions = {
    ...deps.crawlOptions,
    stats: crawlStats,
    prioritize: deps.crawlOptions.prioritize ?? (source.partnerSlug ? crawlPriority : undefined),
    skipUnchanged:
      deps.crawlOptions.skipUnchanged ??
      (deps.force || deps.dryRun
        ? undefined
        : async (url, lastmod) => {
            if (!lastmod) return false;
            const existing = await deps.collections.kbPages.findOne({ _id: url }, { projection: { lastCrawled: 1 } });
            if (!existing || existing.lastCrawled < lastmod) return false;
            await deps.collections.kbPages.updateOne({ _id: url }, { $set: { runId: deps.runId ?? null, lastmod } });
            return true;
          }),
  };
  for await (const fetched of crawl(source, options)) {
    stats.pagesSeen++;
    const r = await indexPage(fetched, source, deps);
    stats[r.outcome === "indexed" ? "pagesIndexed" : r.outcome === "unchanged" ? "pagesUnchanged" : "pagesSkipped"]++;
    stats.chunksWritten += r.chunksWritten;
    stats.chunksDeleted += r.chunksDeleted;
    stats.embeddingCalls += r.embeddingCalls;
    if (r.isCourse) stats.coursePages++;
  }
  stats.pagesSeen += crawlStats.skippedUnchanged; // sitemap-skipped pages still count as seen (their runId was stamped)
  stats.pagesUnchanged += crawlStats.skippedUnchanged;
  logger.info("ingest source complete", { ...stats, crawl: crawlStats } as unknown as Record<string, unknown>);
  return stats;
}

export async function indexPage(
  fetched: FetchedPage,
  source: CrawlSource,
  deps: IngestDeps,
): Promise<{
  outcome: "indexed" | "unchanged" | "skipped";
  chunksWritten: number;
  chunksDeleted: number;
  embeddingCalls: number;
  isCourse: boolean;
  /** An already-indexed page whose text changed this time (never set on a first index). */
  changed?: boolean;
}> {
  const { page } = fetched;
  const none = { chunksWritten: 0, chunksDeleted: 0, embeddingCalls: 0 };
  const minChars = deps.minChars ?? 200;
  const detection = detectCoursePage(page);
  if (page.text.length < minChars) return { outcome: "skipped", ...none, isCourse: false };

  const contentHash = await sha256(page.title + "\n" + page.text);
  const existing = await deps.collections.kbPages.findOne({ _id: page.url });
  if (existing && existing.contentHash === contentHash && !deps.force) {
    await deps.collections.kbPages.updateOne(
      { _id: page.url },
      { $set: { lastCrawled: fetched.fetchedAt, httpStatus: fetched.status, runId: deps.runId ?? null, pageKind: detection.isCourse ? "course" : "page", ...(fetched.lastmod ? { lastmod: fetched.lastmod } : {}) } },
    );
    // Program records derived from this page are still current: keep them out of the orphan sweep.
    if (deps.runId) await deps.collections.kbPages.updateMany({ parentUrl: page.url }, { $set: { runId: deps.runId } });
    // Unchanged text but no program records yet (e.g. extraction enabled later) → still offer the hook.
    if (detection.isCourse && deps.onPageIndexed && existing.programsHash !== contentHash) {
      await deps.onPageIndexed(page, { source, contentHash, isCourse: true }).catch((err) => logger.warn("post-index hook failed", { url: page.url, err: (err as Error).message }));
    }
    return { outcome: "unchanged", ...none, isCourse: detection.isCourse };
  }

  const chunks = await chunkPage(page);
  if (!chunks.length) return { outcome: "skipped", ...none, isCourse: detection.isCourse };
  if (deps.dryRun) {
    logger.info("dry-run: would index", { url: page.url, title: page.title, chunks: chunks.length, course: detection.isCourse, signals: detection.signals });
    return { outcome: "indexed", chunksWritten: chunks.length, chunksDeleted: 0, embeddingCalls: 0, isCourse: detection.isCourse };
  }

  const changed = !!existing && existing.contentHash !== contentHash;
  const docType = source.docType ?? inferDocType(page.url);
  // Official pages carry their country from the curated list (a gov.uk path can name another country).
  const country = source.name.startsWith("official:") ? (source.country ?? "global") : inferCountry(page.url, source.country);
  const vectors = await deps.embeddings.embedDocuments(chunks.map((c) => c.content));
  const docs = await Promise.all(
    chunks.map(async (c, i): Promise<KbChunkDoc> => ({
      _id: await sha256(`${page.url}#${c.index}`),
      source: source.name,
      sourceKind: sourceKindOf(source.name, docType),
      url: page.url,
      title: page.title,
      section: c.section,
      docType,
      country,
      chunkIndex: c.index,
      content: c.content,
      contentHash: await sha256(c.content),
      metadata: {
        market: source.market ?? inferMarket(page.url),
        lang: page.lang,
        description: page.description,
        depth: fetched.depth,
        ...(source.partnerSlug ? { partnerSlug: source.partnerSlug } : {}),
        ...(detection.isCourse ? { pageKind: "course" } : {}),
      },
      embedding: vectors[i]!,
      updatedAt: fetched.fetchedAt,
    })),
  );

  const keepIds = new Set(docs.map((d) => d._id));
  const del = await deps.collections.kbChunks.deleteMany({ url: page.url, _id: { $nin: [...keepIds] } });
  await deps.collections.kbChunks.bulkWrite(
    docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
    { ordered: false },
  );
  const pageDoc: Omit<KbPageDoc, "_id"> = {
    source: source.name,
    sourceKind: sourceKindOf(source.name, docType),
    partnerSlug: source.partnerSlug ?? null,
    country,
    title: page.title,
    contentHash,
    chunkCount: docs.length,
    httpStatus: fetched.status,
    lastCrawled: fetched.fetchedAt,
    lastChanged: fetched.fetchedAt,
    contentChangedAt: changed ? fetched.fetchedAt : (existing?.contentChangedAt ?? null),
    lastmod: fetched.lastmod ?? null,
    runId: deps.runId ?? null,
    pageKind: detection.isCourse ? "course" : "page",
    programsHash: existing?.programsHash ?? null,
  };
  await deps.collections.kbPages.replaceOne({ _id: page.url }, pageDoc, { upsert: true });
  logger.info("indexed page", { url: page.url, title: page.title, chunks: docs.length, course: detection.isCourse });
  if (detection.isCourse && deps.onPageIndexed) {
    await deps.onPageIndexed(page, { source, contentHash, isCourse: true }).catch((err) => logger.warn("post-index hook failed", { url: page.url, err: (err as Error).message }));
  }
  return { outcome: "indexed", chunksWritten: docs.length, chunksDeleted: del.deletedCount, embeddingCalls: Math.ceil(chunks.length / 64), isCourse: detection.isCourse, changed };
}

/** Index a synthetic document (e.g. the partner university list, a program record, an uploaded file) without crawling. */
export async function indexSyntheticPage(
  page: ExtractedPage,
  source: Pick<CrawlSource, "name" | "country" | "docType" | "market" | "partnerSlug"> & { parentUrl?: string | null },
  deps: IngestDeps,
) {
  const fetched: FetchedPage = { page, status: 200, depth: 0, fetchedAt: new Date() };
  const src: CrawlSource = { name: source.name, seeds: [], allow: [], maxPages: 0, maxDepth: 0, country: source.country, docType: source.docType, market: source.market, partnerSlug: source.partnerSlug };
  const result = await indexPage(fetched, src, { ...deps, onPageIndexed: undefined });
  if (source.parentUrl && !deps.dryRun) await deps.collections.kbPages.updateOne({ _id: page.url }, { $set: { parentUrl: source.parentUrl } });
  return result;
}

/**
 * Decide whether it is safe to delete pages a completed crawl did not see.
 * Never sweep after a truncated crawl, and never when this run saw far fewer
 * pages than the last complete one (a WAF block or outage must not wipe a
 * partner's knowledge).
 */
export function shouldSweep(seenThisRun: number, baseline: number | null, truncated: boolean, minRatio = 0.5): { ok: boolean; reason: string } {
  if (truncated) return { ok: false, reason: "crawl truncated (page limit or deadline)" };
  if (seenThisRun === 0) return { ok: false, reason: "no pages seen" };
  if (baseline !== null && baseline > 0 && seenThisRun < baseline * minRatio) return { ok: false, reason: `saw ${seenThisRun} pages vs ${baseline} last time` };
  return { ok: true, reason: "complete crawl" };
}

/** Remove pages (and their chunks) of `source` that the current run did not see. Call only after `shouldSweep`. */
export async function sweepOrphans(sourceName: string, runId: string, c: Pick<Collections, "kbPages" | "kbChunks">): Promise<{ pages: number; chunks: number }> {
  const orphans = await c.kbPages.find({ source: sourceName, runId: { $ne: runId } }, { projection: { _id: 1 } }).toArray();
  if (!orphans.length) return { pages: 0, chunks: 0 };
  const urls = orphans.map((o) => o._id);
  let chunks = 0;
  for (let i = 0; i < urls.length; i += 500) {
    const batch = urls.slice(i, i + 500);
    const r = await c.kbChunks.deleteMany({ url: { $in: batch } });
    chunks += r.deletedCount;
    await c.kbPages.deleteMany({ _id: { $in: batch } });
  }
  logger.info("swept orphan pages", { source: sourceName, pages: urls.length, chunks });
  return { pages: urls.length, chunks };
}
