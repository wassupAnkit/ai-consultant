import type { Collection } from "mongodb";
import { sha256 } from "../activity/identity";
import type { Collections } from "../db/mongo";
import { indexSyntheticPage, type IngestDeps } from "../ingest/pipeline";
import { extractPrograms, storePrograms, type ExtractDeps } from "../ingest/programs";
import type { CrawlSource } from "../ingest/sources";
import type { Logger } from "../observability/logger";
import { slugify } from "../partners/registry";
import type { Destination } from "../schemas/intent.schema";
import { detectKind, ParseError, parseDocument, type DocumentKind, type ParseDeps } from "./parse";
import type { FileStore } from "./store";

/**
 * Staff document uploads (partner fee sheets, brochures, agent-portal exports…):
 * stored in GridFS, parsed, chunked, embedded and indexed as
 * `source: upload:<slug>` so the assistant can cite them. Processing is
 * asynchronous with a status the UI can poll.
 */
export interface KbDocumentDoc {
  _id: string;
  slug: string;
  filename: string;
  mimeType: string;
  kind: DocumentKind;
  bytes: number;
  sha256: string;
  ownerId: string;
  title: string;
  partnerSlug: string | null;
  country: Destination | null;
  docType: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  pages: number | null;
  chunks: number | null;
  programs: number | null;
  extractPrograms: boolean;
  attempts: number;
  fileId: string;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export interface CreateDocumentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string | null;
  ownerId: string;
  title?: string;
  partnerSlug?: string;
  country?: Destination;
  docType?: string;
  extractPrograms?: boolean;
}

export type RemoveResult = "deleted" | "not_found" | "forbidden";

export interface DocumentService {
  create(input: CreateDocumentInput): Promise<KbDocumentDoc>;
  list(filter?: { ownerId?: string; status?: KbDocumentDoc["status"]; partnerSlug?: string; limit?: number }): Promise<KbDocumentDoc[]>;
  get(id: string): Promise<KbDocumentDoc | null>;
  remove(id: string, by: { ownerId: string; admin: boolean }): Promise<RemoveResult>;
  /** Re-queue uploads left `processing` by a crashed process; returns how many were re-queued. */
  resumeInterrupted(): Promise<number>;
}

export class DocumentError extends Error {
  constructor(
    public readonly code: "duplicate" | "unsupported_type" | "too_large" | "empty",
    message: string,
    public readonly existingId?: string,
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

export const uploadUrl = (id: string) => `upload://${id}`;

export interface MongoDocumentServiceDeps {
  collections: Pick<Collections, "kbDocuments" | "kbChunks" | "kbPages" | "kbPrograms">;
  files: FileStore;
  /** Embeddings + collections for indexing (crawlOptions unused). */
  ingest: IngestDeps;
  parse: ParseDeps;
  /** When set, `extractPrograms` uploads (fee sheets, prospectuses) also produce program records. */
  programs?: ExtractDeps;
  logger: Logger;
  maxBytes?: number;
  concurrency?: number;
}

export class MongoDocumentService implements DocumentService {
  private active = 0;
  private readonly queue: string[] = [];

  constructor(private readonly d: MongoDocumentServiceDeps) {}

  private get col(): Collection<KbDocumentDoc> {
    return this.d.collections.kbDocuments;
  }

  async create(input: CreateDocumentInput): Promise<KbDocumentDoc> {
    const kind = detectKind(input.filename, input.mimeType);
    if (!kind) throw new DocumentError("unsupported_type", `Unsupported file type (${input.mimeType || "unknown"}). Upload PDF, TXT, MD, CSV or HTML.`);
    if (kind === "pdf" && !this.d.parse.gen) throw new DocumentError("unsupported_type", "PDF uploads are not enabled on this server");
    if (!input.bytes.length) throw new DocumentError("empty", "The file is empty");
    const max = this.d.maxBytes ?? 20 * 1024 * 1024;
    if (input.bytes.length > max) throw new DocumentError("too_large", `File exceeds ${Math.round(max / 1024 / 1024)} MB`);
    const hash = sha256(Buffer.from(input.bytes).toString("latin1"));
    const dup = await this.col.findOne({ sha256: hash });
    if (dup) throw new DocumentError("duplicate", `This file was already uploaded (${dup.filename})`, dup._id);

    const id = crypto.randomUUID();
    const title = input.title?.trim() || input.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || input.filename;
    const now = new Date();
    const doc: KbDocumentDoc = {
      _id: id,
      slug: `${slugify(title).slice(0, 48)}-${id.slice(0, 8)}`,
      filename: input.filename.slice(0, 200),
      mimeType: (input.mimeType ?? "").split(";")[0]!.trim() || `application/${kind}`,
      kind,
      bytes: input.bytes.length,
      sha256: hash,
      ownerId: input.ownerId,
      title: title.slice(0, 200),
      partnerSlug: input.partnerSlug ?? null,
      country: input.country ?? null,
      docType: input.docType?.trim() || "upload",
      status: "processing",
      error: null,
      pages: null,
      chunks: null,
      programs: null,
      extractPrograms: Boolean(input.extractPrograms && this.d.programs),
      attempts: 0,
      fileId: id,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
    };
    await this.d.files.put(id, input.bytes, { filename: doc.filename, mimeType: doc.mimeType });
    await this.col.insertOne(doc);
    this.schedule(id);
    return doc;
  }

  private schedule(id: string) {
    this.queue.push(id);
    void this.pump();
  }

  private async pump() {
    const limit = this.d.concurrency ?? 2;
    while (this.active < limit && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      this.process(id)
        .catch((err) => this.d.logger.error("document processing crashed", { id, err: (err as Error).message }))
        .finally(() => {
          this.active--;
          void this.pump();
        });
    }
  }

  /** Parse → index → (optionally) extract programs; records the outcome on the document. */
  async process(id: string): Promise<void> {
    const doc = await this.col.findOne({ _id: id });
    if (!doc) return;
    await this.col.updateOne({ _id: id }, { $set: { status: "processing", updatedAt: new Date() }, $inc: { attempts: 1 } });
    try {
      const bytes = await this.d.files.get(doc.fileId);
      if (!bytes) throw new Error("stored file is missing");
      const url = uploadUrl(id);
      const page = await parseDocument(bytes, doc.kind, doc.filename, url, this.d.parse);
      page.title = doc.title || page.title;
      const source: CrawlSource = { name: `upload:${doc.slug}`, seeds: [], allow: [], maxPages: 0, maxDepth: 0, country: doc.country ?? "global", docType: doc.docType, partnerSlug: doc.partnerSlug ?? undefined };
      const ingest: IngestDeps = { ...this.d.ingest, minChars: 20, force: true, onPageIndexed: undefined };
      const indexed = await indexSyntheticPage(page, { name: source.name, country: source.country, docType: source.docType, partnerSlug: source.partnerSlug }, ingest);
      await this.d.collections.kbPages.updateOne({ _id: url }, { $set: { title: page.title } });
      let programs = 0;
      if (doc.extractPrograms && this.d.programs) {
        const contentHash = sha256(page.title + "\n" + page.text);
        const records = await extractPrograms(page, { source, contentHash, university: doc.partnerSlug ?? doc.title }, this.d.programs);
        const stored = await storePrograms(records, { sourceUrl: url, contentHash, source }, { collections: this.d.collections, ingest });
        programs = stored.stored;
      }
      await this.col.updateOne(
        { _id: id },
        { $set: { status: "ready", error: null, pages: page.sections.length, chunks: indexed.chunksWritten, programs, processedAt: new Date(), updatedAt: new Date() } },
      );
      this.d.logger.info("document indexed", { id, slug: doc.slug, chunks: indexed.chunksWritten, programs });
    } catch (err) {
      const message = err instanceof ParseError ? `${err.code}: ${err.message}` : (err as Error).message;
      await this.col.updateOne({ _id: id }, { $set: { status: "failed", error: message.slice(0, 500), updatedAt: new Date() } });
      this.d.logger.warn("document processing failed", { id, err: message });
    }
  }

  async list(filter: { ownerId?: string; status?: KbDocumentDoc["status"]; partnerSlug?: string; limit?: number } = {}) {
    const q: Record<string, unknown> = {};
    if (filter.ownerId) q.ownerId = filter.ownerId;
    if (filter.status) q.status = filter.status;
    if (filter.partnerSlug) q.partnerSlug = filter.partnerSlug;
    return this.col.find(q).sort({ createdAt: -1 }).limit(Math.min(filter.limit ?? 100, 500)).toArray();
  }

  async get(id: string) {
    return this.col.findOne({ _id: id });
  }

  async remove(id: string, by: { ownerId: string; admin: boolean }): Promise<RemoveResult> {
    const doc = await this.col.findOne({ _id: id });
    if (!doc) return "not_found";
    if (!by.admin && doc.ownerId !== by.ownerId) return "forbidden";
    const url = uploadUrl(id);
    const prefix = new RegExp(`^${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(#|$)`);
    await Promise.all([
      this.d.collections.kbChunks.deleteMany({ url: { $regex: prefix } }),
      this.d.collections.kbPages.deleteMany({ $or: [{ _id: { $regex: prefix } }, { parentUrl: url }] }),
      this.d.collections.kbPrograms.deleteMany({ sourceUrl: url }),
      this.d.files.delete(doc.fileId),
    ]);
    await this.col.deleteOne({ _id: id });
    return "deleted";
  }

  async resumeInterrupted(): Promise<number> {
    const stale = new Date(Date.now() - 30 * 60_000);
    const docs = await this.col.find({ status: "processing", updatedAt: { $lt: stale } }).toArray();
    let requeued = 0;
    for (const d of docs) {
      if (d.attempts >= 2) {
        await this.col.updateOne({ _id: d._id }, { $set: { status: "failed", error: "processing interrupted twice", updatedAt: new Date() } });
        continue;
      }
      this.schedule(d._id);
      requeued++;
    }
    return requeued;
  }
}

/** Test double: parses synchronously, no indexing, keeps documents in memory. */
export class InMemoryDocumentService implements DocumentService {
  readonly docs = new Map<string, KbDocumentDoc>();
  constructor(
    private readonly parse: ParseDeps = {},
    private readonly maxBytes = 20 * 1024 * 1024,
  ) {}

  async create(input: CreateDocumentInput): Promise<KbDocumentDoc> {
    const kind = detectKind(input.filename, input.mimeType);
    if (!kind) throw new DocumentError("unsupported_type", `Unsupported file type (${input.mimeType || "unknown"})`);
    if (!input.bytes.length) throw new DocumentError("empty", "The file is empty");
    if (input.bytes.length > this.maxBytes) throw new DocumentError("too_large", "File too large");
    const hash = sha256(Buffer.from(input.bytes).toString("latin1"));
    const dup = [...this.docs.values()].find((d) => d.sha256 === hash);
    if (dup) throw new DocumentError("duplicate", "already uploaded", dup._id);
    const id = crypto.randomUUID();
    const title = input.title?.trim() || input.filename.replace(/\.[a-z0-9]+$/i, "");
    const now = new Date();
    const doc: KbDocumentDoc = {
      _id: id,
      slug: `${slugify(title)}-${id.slice(0, 8)}`,
      filename: input.filename,
      mimeType: input.mimeType ?? "",
      kind,
      bytes: input.bytes.length,
      sha256: hash,
      ownerId: input.ownerId,
      title,
      partnerSlug: input.partnerSlug ?? null,
      country: input.country ?? null,
      docType: input.docType ?? "upload",
      status: "processing",
      error: null,
      pages: null,
      chunks: null,
      programs: null,
      extractPrograms: Boolean(input.extractPrograms),
      attempts: 1,
      fileId: id,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
    };
    this.docs.set(id, doc);
    try {
      const page = await parseDocument(input.bytes, kind, input.filename, uploadUrl(id), this.parse);
      Object.assign(doc, { status: "ready", pages: page.sections.length, chunks: page.sections.length, programs: 0, processedAt: new Date() });
    } catch (err) {
      Object.assign(doc, { status: "failed", error: (err as Error).message });
    }
    return { ...doc, status: "processing", pages: null, chunks: null, programs: null, processedAt: null };
  }
  async list(filter: { ownerId?: string; status?: KbDocumentDoc["status"]; partnerSlug?: string; limit?: number } = {}) {
    return [...this.docs.values()].filter((d) => (!filter.ownerId || d.ownerId === filter.ownerId) && (!filter.status || d.status === filter.status) && (!filter.partnerSlug || d.partnerSlug === filter.partnerSlug)).slice(0, filter.limit ?? 100);
  }
  async get(id: string) {
    return this.docs.get(id) ?? null;
  }
  async remove(id: string, by: { ownerId: string; admin: boolean }): Promise<RemoveResult> {
    const doc = this.docs.get(id);
    if (!doc) return "not_found";
    if (!by.admin && doc.ownerId !== by.ownerId) return "forbidden";
    this.docs.delete(id);
    return "deleted";
  }
  async resumeInterrupted() {
    return 0;
  }
}
