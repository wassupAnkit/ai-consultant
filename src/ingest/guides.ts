import type { Embeddings } from "@langchain/core/embeddings";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Collections, KbChunkDoc, KbPageDoc } from "../db/mongo";
import { logger } from "../observability/logger";
import { sourceKindOf } from "../retrieval/store";
import { isMarket, type Market } from "../routing/markets";
import { DESTINATIONS } from "../schemas/intent.schema";
import { COMPLIANCE_GUIDES_UPDATED } from "../skills/compliance-guides";
import { anchorOf, MARKET_GUIDES_UPDATED, researchedOn } from "../skills/market-guides";
import { emptyCrawlStats } from "./crawler";
import { sha256, type IngestStats } from "./pipeline";

/**
 * Expert's own curated guides in the knowledge base (`kb_chunks`), so research can find them by
 * search like any staff upload: the source-market guides (data/markets), the agent-compliance
 * guides (data/compliance), the destination facts registers (data/facts) and the counsellor job
 * map (data/counsellor). The runtime copies under data/ ship in the image (docs/ does not); tests
 * keep each one identical to its docs/ original.
 *
 * Each guide is chunked by `##`/`###`/`####` section with the doc title and heading path at the
 * top of every chunk, tables kept whole where they fit and otherwise split by row groups with the
 * header repeated. Chunks go through the same embedding model and `kb_chunks`/`kb_pages` shapes as
 * the crawl and upload pipeline (src/ingest/pipeline.ts), under `source: guide:<kind>/<slug>`,
 * with `sourceKind: upload` so retrieval quotas treat them as internal documents. Idempotent:
 * an unchanged chunk (same contentHash) is not re-embedded, a chunk whose text is unchanged but
 * whose metadata moved (a new checked date) is updated in place, a removed section's chunks are
 * deleted, and a guide no longer shipped loses its chunks and page. Only `guide:` sources are
 * ever touched.
 */

export type GuideKind = "market" | "compliance" | "facts" | "counsellor";
export const GUIDE_KINDS: readonly GuideKind[] = ["market", "compliance", "facts", "counsellor"];
/** Directory under data/ each kind ships in. */
export const GUIDE_DIRS: Readonly<Record<GuideKind, string>> = { market: "markets", compliance: "compliance", facts: "facts", counsellor: "counsellor" };
export const GUIDE_DOC_TYPES: Readonly<Record<GuideKind, string>> = { market: "market_guide", compliance: "compliance_guide", facts: "facts_register", counsellor: "counsellor_guide" };
/** Every guide's `source` starts with this; cleanup never touches anything else. */
export const GUIDE_SOURCE_PREFIX = "guide:";
/** Longest chunk, header included (characters), as the crawl chunker. */
export const GUIDE_CHUNK_MAX = 1_800;
/** Section bodies shorter than this are skipped (a heading with nothing under it). */
const MIN_BODY = 20;
/** Sections left out of the knowledge base: link lists, not knowledge. */
const SKIPPED_SECTIONS = /^(?:sources|references)$/i;
const INTRO_SECTION = "About this document";
const INTRO_ANCHOR = "about";

export interface GuideFile {
  kind: GuideKind;
  /** File name without `.md` (a destination, a market, "source-markets", "job-map"…). */
  slug: string;
  markdown: string;
}

export interface GuideInfo {
  kind: GuideKind;
  slug: string;
  /** `guide:<kind>/<slug>` */
  source: string;
  /** `guide://<kind>/<slug>`: the guide's kb_pages id; chunks add `#<anchor>`. */
  pageUrl: string;
  /** The `# ` heading (else the slug). */
  title: string;
  docType: string;
  /** Destination slug for a destination's facts register or compliance guide, else "global". */
  country: string;
  /** The origin market a market guide is about; null for every other guide. */
  market: Market | null;
  /** YYYY-MM-DD the guide was researched or checked (from its header), null when it gives none. */
  updated: string | null;
}

const UPDATED_FALLBACK: Readonly<Record<GuideKind, string>> = { market: MARKET_GUIDES_UPDATED, compliance: COMPLIANCE_GUIDES_UPDATED, facts: "", counsellor: "" };
const DESTINATION_SLUGS = new Set<string>(DESTINATIONS.filter((d) => d !== "other"));

export function guideInfo(file: GuideFile): GuideInfo {
  const title = file.markdown.match(/^# (.+)$/m)?.[1]?.trim() || file.slug;
  const destinationGuide = file.kind === "facts" || file.kind === "compliance";
  return {
    kind: file.kind,
    slug: file.slug,
    source: `${GUIDE_SOURCE_PREFIX}${file.kind}/${file.slug}`,
    pageUrl: `guide://${file.kind}/${file.slug}`,
    title,
    docType: GUIDE_DOC_TYPES[file.kind],
    country: destinationGuide && DESTINATION_SLUGS.has(file.slug) ? file.slug : "global",
    market: file.kind === "market" && isMarket(file.slug) ? file.slug : null,
    // Month-only headers ("Researched October 2026") fall back to the date the round-0 excerpts use.
    updated: researchedOn(file.markdown, UPDATED_FALLBACK[file.kind]) || null,
  };
}

/** Every `*.md` guide under `root` (data/ by default), README files excepted, in kind then name order. */
export async function loadGuideFiles(root = `${import.meta.dir}/../../data`): Promise<GuideFile[]> {
  const out: GuideFile[] = [];
  for (const kind of GUIDE_KINDS) {
    const dir = `${root}/${GUIDE_DIRS[kind]}`;
    const names = [...new Bun.Glob("*.md").scanSync({ cwd: dir, onlyFiles: true })].filter((n) => !/^readme\.md$/i.test(n)).sort();
    for (const name of names) out.push({ kind, slug: name.replace(/\.md$/, ""), markdown: await Bun.file(`${dir}/${name}`).text() });
  }
  return out;
}

// --- Sections and chunks ---------------------------------------------------------------------

interface Section {
  path: string[];
  anchor: string;
  body: string;
}

/** The guide's sections in file order: the intro before the first `##`, then every `##`–`####` heading's own body. */
function sections(markdown: string): Section[] {
  const out: Section[] = [];
  const seen = new Map<string, number>();
  const uniqueAnchor = (a: string) => {
    const n = seen.get(a) ?? 0;
    seen.set(a, n + 1);
    return n ? `${a}-${n}` : a;
  };
  let current: Section = { path: [INTRO_SECTION], anchor: uniqueAnchor(INTRO_ANCHOR), body: "" };
  let lines: string[] = [];
  let stack: { level: number; title: string }[] = [];
  let skipBelow: number | null = null;
  const flush = () => {
    current.body = cleanBody(lines.join("\n"));
    if (current.body.length >= MIN_BODY) out.push(current);
    lines = [];
  };
  for (const line of markdown.split("\n")) {
    const h = line.match(/^(#{1,4}) (.+?)\s*#*\s*$/);
    if (!h) {
      if (skipBelow === null) lines.push(line);
      continue;
    }
    const level = h[1]!.length;
    if (level === 1) continue; // the doc title: carried in every chunk's header instead
    if (skipBelow !== null && level > skipBelow) continue;
    if (skipBelow === null) flush();
    else lines = [];
    skipBelow = null;
    const title = h[2]!.replace(/\*\*/g, "").trim();
    stack = [...stack.filter((s) => s.level < level), { level, title }];
    if (SKIPPED_SECTIONS.test(title)) {
      skipBelow = level;
      continue;
    }
    current = { path: stack.map((s) => s.title), anchor: uniqueAnchor(anchorOf(title)), body: "" };
  }
  if (skipBelow === null) flush();
  return out;
}

/** HTML comments (compliance keyword lines) and horizontal rules out, blank runs collapsed. */
function cleanBody(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((l) => !/^\s*(?:-{3,}|\*{3,})\s*$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Body → blocks: a run of table lines is one block, other text splits at blank lines. */
function blocks(body: string): { table: boolean; text: string }[] {
  const out: { table: boolean; lines: string[] }[] = [];
  for (const line of body.split("\n")) {
    const table = line.trimStart().startsWith("|");
    const last = out[out.length - 1];
    if (!line.trim()) {
      if (last && last.lines.length) out.push({ table: false, lines: [] });
      continue;
    }
    if (last && last.table === table && last.lines.length) last.lines.push(line);
    else if (last && !last.lines.length) {
      last.table = table;
      last.lines.push(line);
    } else out.push({ table, lines: [line] });
  }
  return out.filter((b) => b.lines.length).map((b) => ({ table: b.table, text: b.lines.join("\n") }));
}

/** A table too long for one chunk → row groups, each with the header (and separator) repeated. */
function splitTable(text: string, budget: number): string[] {
  const lines = text.split("\n");
  const hasHeader = lines.length > 2 && /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[1]!);
  const header = hasHeader ? lines.slice(0, 2) : [];
  const rows = hasHeader ? lines.slice(2) : lines;
  const head = header.join("\n");
  const groups: string[] = [];
  let group: string[] = [];
  const size = () => (head ? head.length + 1 : 0) + group.reduce((n, r) => n + r.length + 1, 0) - 1;
  for (const row of rows) {
    group.push(row);
    if (group.length > 1 && size() > budget) {
      group.pop();
      groups.push([head, ...group].filter(Boolean).join("\n"));
      group = [row];
    }
  }
  if (group.length) groups.push([head, ...group].filter(Boolean).join("\n"));
  // A single row longer than the budget is cut like prose (rare: the shipped rows are well under).
  return groups.flatMap((g) => (g.length > budget ? splitText(g, budget) : [g]));
}

/** Prose too long for one chunk → lines, then sentences, then words, packed greedily. */
function splitText(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const lines = text.split("\n");
  if (lines.length > 1) return pack(lines.flatMap((l) => splitText(l, budget)), budget, "\n");
  const sentences = text.split(/(?<=[.!?;])\s+/);
  if (sentences.length > 1) return pack(sentences.flatMap((s) => splitText(s, budget)), budget, " ");
  const words = text.split(/\s+/);
  if (words.length > 1) return pack(words.flatMap((w) => splitText(w, budget)), budget, " ");
  return Array.from({ length: Math.ceil(text.length / budget) }, (_, i) => text.slice(i * budget, (i + 1) * budget));
}

function pack(pieces: string[], budget: number, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + sep.length + p.length > budget) {
      out.push(cur);
      cur = p;
    } else cur = cur ? cur + sep + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

export interface GuideChunk {
  /** Stable within the guide: `<anchor>:<part>` (the chunk id hashes it with the page URL). */
  key: string;
  anchor: string;
  /** Heading path, " › "-joined ("5. Origin-side steps & documents › NOC"). */
  section: string;
  /** `guide://<kind>/<slug>#<anchor>` */
  url: string;
  index: number;
  /** "<doc title> — <section>\n\n<body part>", at most `max` characters. */
  content: string;
}

/** Split a guide into section chunks of at most `max` characters, each headed by doc title and section path. */
export function chunkGuide(file: GuideFile, max = GUIDE_CHUNK_MAX): GuideChunk[] {
  const info = guideInfo(file);
  const out: GuideChunk[] = [];
  for (const s of sections(file.markdown)) {
    const section = s.path.join(" › ");
    const header = `${info.title} — ${section}\n\n`;
    const budget = Math.max(200, max - header.length);
    const parts: string[] = [];
    let cur = "";
    for (const b of blocks(s.body)) {
      const pieces = b.text.length <= budget ? [b.text] : b.table ? splitTable(b.text, budget) : splitText(b.text, budget);
      for (const p of pieces) {
        if (cur && cur.length + 2 + p.length > budget) {
          parts.push(cur);
          cur = p;
        } else cur = cur ? `${cur}\n\n${p}` : p;
      }
    }
    if (cur) parts.push(cur);
    parts.forEach((body, part) => out.push({ key: `${s.anchor}:${part}`, anchor: s.anchor, section, url: `${info.pageUrl}#${s.anchor}`, index: out.length, content: header + body }));
  }
  return out;
}

export type GuideChunkDoc = Omit<KbChunkDoc, "embedding">;

/** The guide's chunks as `kb_chunks` documents (no embedding yet). */
export async function guideChunkDocs(file: GuideFile): Promise<GuideChunkDoc[]> {
  const info = guideInfo(file);
  const updatedAt = info.updated ? new Date(`${info.updated}T00:00:00.000Z`) : new Date(0);
  return Promise.all(
    chunkGuide(file).map(
      async (c): Promise<GuideChunkDoc> => ({
        _id: await sha256(`${info.pageUrl}#${c.key}`),
        source: info.source,
        sourceKind: sourceKindOf(info.source, info.docType),
        url: c.url,
        title: info.title,
        section: c.section,
        docType: info.docType,
        country: info.country,
        chunkIndex: c.index,
        content: c.content,
        contentHash: await sha256(c.content),
        metadata: {
          kind: info.kind,
          slug: info.slug,
          anchor: c.anchor,
          ...(info.market ? { market: info.market } : {}),
          ...(info.updated ? { updated: info.updated } : {}),
        },
        // The guide's research/checked date, so an excerpt's `updated="…"` is the as-of date of its facts.
        updatedAt,
      }),
    ),
  );
}

// --- Plan ------------------------------------------------------------------------------------

export interface GuidePlanEntry {
  info: GuideInfo;
  docs: GuideChunkDoc[];
  /** New or changed text: embed and upsert. */
  embed: GuideChunkDoc[];
  /** Same text, different metadata (date, section path…): update without re-embedding. */
  retag: GuideChunkDoc[];
  unchanged: number;
  /** Chunk ids of this guide no longer produced (a removed or re-split section). */
  remove: string[];
}

export interface GuidePlan {
  guides: GuidePlanEntry[];
  /** `guide:` sources in the store with no shipped file any more. */
  orphanSources: string[];
}

/** Fields that, when they differ with the same text, only need an in-place update. */
const signature = (d: GuideChunkDoc) =>
  JSON.stringify([d.source, d.sourceKind, d.url, d.title, d.section, d.docType, d.country, d.chunkIndex, d.metadata, new Date(d.updatedAt).toISOString()]);

/** What an ingest would do, given the desired chunks and the stored `guide:` chunks (no embeddings needed). */
export function planGuideIngest(desired: { file: GuideFile; docs: GuideChunkDoc[] }[], existing: GuideChunkDoc[], opts: { force?: boolean } = {}): GuidePlan {
  const stored = new Map(existing.map((d) => [d._id, d]));
  const guides = desired.map(({ file, docs }): GuidePlanEntry => {
    const info = guideInfo(file);
    const entry: GuidePlanEntry = { info, docs, embed: [], retag: [], unchanged: 0, remove: [] };
    for (const d of docs) {
      const old = stored.get(d._id);
      if (!old || old.contentHash !== d.contentHash || opts.force) entry.embed.push(d);
      else if (signature(old) !== signature(d)) entry.retag.push(d);
      else entry.unchanged++;
    }
    const keep = new Set(docs.map((d) => d._id));
    entry.remove = existing.filter((d) => d.source === info.source && !keep.has(d._id)).map((d) => d._id);
    return entry;
  });
  const shipped = new Set(guides.map((g) => g.info.source));
  const orphanSources = [...new Set(existing.map((d) => d.source))].filter((s) => s.startsWith(GUIDE_SOURCE_PREFIX) && !shipped.has(s)).sort();
  return { guides, orphanSources };
}

// --- Ingest ----------------------------------------------------------------------------------

export interface GuideIngestDeps {
  collections: Pick<Collections, "kbChunks" | "kbPages">;
  embeddings: Embeddings;
  dryRun?: boolean;
  /** Re-embed every chunk, changed or not. */
  force?: boolean;
  /** Ingest run id stamped on each guide's page. */
  runId?: string;
  /** Texts per embedding request (default 64, as the crawl pipeline). */
  batchSize?: number;
}

export interface GuideIngestResult {
  guides: number;
  /** Chunks embedded and written (dry run: that would be). */
  chunksWritten: number;
  chunksRetagged: number;
  chunksUnchanged: number;
  /** Chunks of shipped guides removed (vanished sections). */
  chunksDeleted: number;
  embeddingCalls: number;
  /** Guides no longer shipped: pages and chunks removed. */
  orphansDeleted: { pages: number; chunks: number };
  plan: GuidePlan;
}

const GUIDE_FILTER = { source: { $regex: `^${GUIDE_SOURCE_PREFIX}` } };

/**
 * Index the given guide files into `kb_chunks`/`kb_pages`. Throws when `files` is empty, so a
 * wrong data path can never sweep every guide out of the knowledge base.
 */
export async function ingestGuides(files: GuideFile[], deps: GuideIngestDeps): Promise<GuideIngestResult> {
  if (!files.length) throw new Error("no guide files loaded; refusing to sync (check the data/ path)");
  const desired = await Promise.all(files.map(async (file) => ({ file, docs: await guideChunkDocs(file) })));
  const existing = (await deps.collections.kbChunks.find(GUIDE_FILTER as never, { projection: { embedding: 0 } }).toArray()) as GuideChunkDoc[];
  const plan = planGuideIngest(desired, existing, { force: deps.force });
  const result: GuideIngestResult = {
    guides: plan.guides.length,
    chunksWritten: plan.guides.reduce((n, g) => n + g.embed.length, 0),
    chunksRetagged: plan.guides.reduce((n, g) => n + g.retag.length, 0),
    chunksUnchanged: plan.guides.reduce((n, g) => n + g.unchanged, 0),
    chunksDeleted: plan.guides.reduce((n, g) => n + g.remove.length, 0),
    embeddingCalls: 0,
    orphansDeleted: { pages: 0, chunks: 0 },
    plan,
  };
  if (deps.dryRun) {
    for (const g of plan.guides) logger.info("dry-run: guide", { source: g.info.source, chunks: g.docs.length, embed: g.embed.length, retag: g.retag.length, unchanged: g.unchanged, remove: g.remove.length });
    if (plan.orphanSources.length) logger.info("dry-run: would delete guides no longer shipped", { sources: plan.orphanSources });
    return result;
  }

  const pages = new Map(((await deps.collections.kbPages.find(GUIDE_FILTER as never).toArray()) as KbPageDoc[]).map((p) => [p._id, p]));
  const batch = deps.batchSize ?? 64;
  const now = new Date();
  for (const g of plan.guides) {
    const ops: AnyBulkWriteOperation<KbChunkDoc>[] = [];
    for (let i = 0; i < g.embed.length; i += batch) {
      const slice = g.embed.slice(i, i + batch);
      const vectors = await deps.embeddings.embedDocuments(slice.map((d) => d.content));
      result.embeddingCalls++;
      slice.forEach((d, j) => ops.push({ replaceOne: { filter: { _id: d._id }, replacement: { ...d, embedding: vectors[j]! }, upsert: true } }));
    }
    for (const d of g.retag) {
      const { _id, ...fields } = d;
      ops.push({ updateOne: { filter: { _id }, update: { $set: fields } } });
    }
    if (ops.length) await deps.collections.kbChunks.bulkWrite(ops, { ordered: false });
    if (g.remove.length) await deps.collections.kbChunks.deleteMany({ _id: { $in: g.remove } });

    const changed = g.embed.length + g.retag.length + g.remove.length > 0;
    const previous = pages.get(g.info.pageUrl);
    const page: Omit<KbPageDoc, "_id"> = {
      source: g.info.source,
      sourceKind: sourceKindOf(g.info.source, g.info.docType),
      partnerSlug: null,
      country: g.info.country,
      title: g.info.title,
      contentHash: await sha256(g.docs.map((d) => d.contentHash).join("")),
      chunkCount: g.docs.length,
      httpStatus: null,
      lastCrawled: now,
      lastChanged: changed || !previous ? now : previous.lastChanged,
      lastmod: g.info.updated ? new Date(`${g.info.updated}T00:00:00.000Z`) : null,
      runId: deps.runId ?? null,
      pageKind: "page",
    };
    await deps.collections.kbPages.replaceOne({ _id: g.info.pageUrl }, page, { upsert: true });
    if (changed) logger.info("guide indexed", { source: g.info.source, embedded: g.embed.length, retagged: g.retag.length, removed: g.remove.length });
  }

  if (plan.orphanSources.length) {
    const chunks = await deps.collections.kbChunks.deleteMany({ source: { $in: plan.orphanSources } });
    const removedPages = await deps.collections.kbPages.deleteMany({ source: { $in: plan.orphanSources } });
    result.orphansDeleted = { pages: removedPages.deletedCount, chunks: chunks.deletedCount };
    logger.info("removed guides no longer shipped", { sources: plan.orphanSources, ...result.orphansDeleted });
  }
  return result;
}

/** One line per guide plus totals: what `--dry-run` prints and what a real run logs at the end. */
export function formatGuidePlan(r: GuideIngestResult): string {
  const rows = r.plan.guides.map((g) => `${g.info.source.padEnd(34)} ${String(g.docs.length).padStart(4)} chunks  embed ${String(g.embed.length).padStart(3)}  retag ${String(g.retag.length).padStart(3)}  unchanged ${String(g.unchanged).padStart(3)}  delete ${String(g.remove.length).padStart(3)}  ${g.info.docType} country=${g.info.country}${g.info.market ? ` market=${g.info.market}` : ""} updated=${g.info.updated ?? "?"}`);
  if (r.plan.orphanSources.length) rows.push(`no longer shipped (delete all chunks): ${r.plan.orphanSources.join(", ")}`);
  rows.push(`total: ${r.guides} guides, ${r.chunksWritten} to embed, ${r.chunksRetagged} to retag, ${r.chunksUnchanged} unchanged, ${r.chunksDeleted} to delete`);
  return rows.join("\n");
}

/** The result in the shape the ingest run log records per source (one "page" per guide). */
export function guideIngestStats(r: GuideIngestResult): IngestStats {
  const changed = r.plan.guides.filter((g) => g.embed.length + g.retag.length + g.remove.length > 0).length;
  return {
    source: "guides",
    pagesSeen: r.guides,
    pagesIndexed: changed,
    pagesUnchanged: r.guides - changed,
    pagesSkipped: 0,
    chunksWritten: r.chunksWritten,
    // Orphaned guides' chunks are reported as the source's sweep (`IngestRunSource.sweepDeleted`), not here.
    chunksDeleted: r.chunksDeleted,
    embeddingCalls: r.embeddingCalls,
    coursePages: 0,
    crawl: emptyCrawlStats(),
  };
}
