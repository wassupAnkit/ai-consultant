import type { Collection } from "mongodb";
import type { IngestStats } from "./pipeline";

/**
 * Ingestion run log (`kb_ingest_runs`): what ran, when, how it ended, per
 * source. Powers `GET /v1/knowledge/status` ("partners last crawled …") and
 * the orphan-sweep guard (a partial run must never delete a partner's pages).
 */
export interface IngestRunSource {
  name: string;
  partnerSlug: string | null;
  stats: IngestStats | null;
  /** Pages/chunks removed by the orphan sweep. */
  sweepDeleted: { pages: number; chunks: number } | null;
  /** Crawl ended early (hard limit / deadline). */
  truncated: boolean;
  error: string | null;
  ms: number;
  /** Official pages only: already-indexed pages whose text changed this run (a rule or figure may have moved). */
  changed?: { url: string; label: string }[];
  /** Official pages only: pages that could not be fetched this run (their last indexed copy is kept). */
  failed?: { url: string; status: number | null; error: string }[];
}

export interface KbIngestRunDoc {
  _id: string;
  kind: "site" | "partners" | "all" | "requests" | "documents" | "guides" | "official";
  trigger: "cron" | "manual" | "api";
  args: Record<string, unknown>;
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  status: "running" | "ok" | "partial" | "failed";
  release: string | null;
  sources: IngestRunSource[];
  totals: { pagesSeen: number; pagesIndexed: number; pagesUnchanged: number; chunksWritten: number; chunksDeleted: number };
  error: string | null;
}

/** Reindex request queued by `POST /v1/knowledge/reindex`, drained by the `requests` CronJob. */
export interface KbIngestRequestDoc {
  _id: string;
  /** "all" | "site" | "partners" | "guides" | "official" | "partner:<slug>" | "upload:<id>" */
  scope: string;
  force: boolean;
  requestedBy: string;
  status: "queued" | "running" | "done" | "failed";
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  runId: string | null;
  error: string | null;
}

export class IngestRunLog {
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly col: Collection<KbIngestRunDoc>,
    readonly doc: KbIngestRunDoc,
  ) {}

  static async start(col: Collection<KbIngestRunDoc>, init: Pick<KbIngestRunDoc, "kind" | "trigger" | "args"> & { release?: string | null }): Promise<IngestRunLog> {
    const now = new Date();
    const doc: KbIngestRunDoc = {
      _id: crypto.randomUUID(),
      kind: init.kind,
      trigger: init.trigger,
      args: init.args,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      status: "running",
      release: init.release ?? null,
      sources: [],
      totals: { pagesSeen: 0, pagesIndexed: 0, pagesUnchanged: 0, chunksWritten: 0, chunksDeleted: 0 },
      error: null,
    };
    await col.insertOne(doc).catch(() => undefined);
    const run = new IngestRunLog(col, doc);
    run.heartbeat = setInterval(() => void run.touch(), 60_000);
    return run;
  }

  get id() {
    return this.doc._id;
  }

  private async touch() {
    this.doc.updatedAt = new Date();
    await this.col.updateOne({ _id: this.doc._id }, { $set: { updatedAt: this.doc.updatedAt, sources: this.doc.sources, totals: this.doc.totals } }).catch(() => undefined);
  }

  async finishSource(s: IngestRunSource) {
    this.doc.sources.push(s);
    if (s.stats) {
      this.doc.totals.pagesSeen += s.stats.pagesSeen;
      this.doc.totals.pagesIndexed += s.stats.pagesIndexed;
      this.doc.totals.pagesUnchanged += s.stats.pagesUnchanged;
      this.doc.totals.chunksWritten += s.stats.chunksWritten;
      this.doc.totals.chunksDeleted += s.stats.chunksDeleted + (s.sweepDeleted?.chunks ?? 0);
    }
    await this.touch();
  }

  async finish(error?: unknown) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    const failed = this.doc.sources.filter((s) => s.error).length;
    this.doc.finishedAt = new Date();
    this.doc.updatedAt = this.doc.finishedAt;
    this.doc.error = error ? String((error as Error).message ?? error).slice(0, 1_000) : null;
    this.doc.status = error ? "failed" : failed || this.doc.sources.some((s) => s.truncated) ? "partial" : "ok";
    await this.col.replaceOne({ _id: this.doc._id }, this.doc, { upsert: true }).catch(() => undefined);
    return this.doc;
  }
}

/** The last completed run that covered `sourceName` and was not truncated — its pagesSeen is the sweep baseline. */
export async function previousCompleteRun(col: Collection<KbIngestRunDoc>, sourceName: string): Promise<IngestRunSource | null> {
  const doc = await col
    .find({ status: { $in: ["ok", "partial"] }, sources: { $elemMatch: { name: sourceName, error: null, truncated: false } } })
    .sort({ startedAt: -1 })
    .limit(1)
    .next();
  return doc?.sources.find((s) => s.name === sourceName && !s.error && !s.truncated) ?? null;
}
