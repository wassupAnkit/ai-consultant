import type { Collection, Document, Filter } from "mongodb";
import { z } from "zod";
import { sha256 } from "../activity/identity";
import type { Collections } from "../db/mongo";
import type { GeminiGenerate } from "../llm/generate";
import { zodToGeminiSchema } from "../llm/generate";
import { logger } from "../observability/logger";
import { slugify } from "../partners/registry";
import { withUpdatedAt } from "../retrieval/store";
import { STUDY_LEVELS, type Destination } from "../schemas/intent.schema";
import type { ProgramFilters, ProgramRecordLike, ProgramSearch } from "../tools/programs";
import type { ExtractedPage } from "./extract";
import { indexSyntheticPage, type IngestDeps } from "./pipeline";
import type { CrawlSource } from "./sources";

/**
 * Structured program records extracted from partner-university course pages
 * with Gemini structured output. Stored in `kb_programs` for field-level search
 * (fees, intakes, English cut-offs…) and additionally rendered to a Markdown
 * chunk in `kb_chunks` (docType "program") so hybrid search finds them too.
 */
export const PROGRAM_LEVELS = [...STUDY_LEVELS.filter((l) => l !== "unspecified"), "other"] as const;

const Score = z.object({ overall: z.number().nullable(), minBand: z.number().nullable() });

/** What the model fills in (no ids / provenance). Nullable everywhere: "absent on the page" must be representable. */
export const ProgramLLMSchema = z.object({
  programName: z.string().min(2).max(200).describe("Official program/course title as written on the page."),
  level: z.enum(PROGRAM_LEVELS).nullable().describe("Study level; 'diploma_vocational' for diplomas/certificates/foundation, 'other' if unclear."),
  discipline: z.string().max(120).nullable().describe("Main field of study, e.g. 'Information Technology', 'Nursing'."),
  disciplineTags: z.array(z.string().max(40)).max(8).default([]).describe("Lower-case keywords: e.g. ['it', 'data science', 'computing']."),
  campuses: z.array(z.string().max(120)).max(10).default([]),
  deliveryModes: z.array(z.enum(["on_campus", "online", "blended"])).max(3).default([]),
  duration: z
    .object({ value: z.number().nullable(), unit: z.enum(["years", "months", "weeks", "semesters", "trimesters"]).nullable(), text: z.string().max(200).nullable() })
    .nullable(),
  tuition: z
    .array(
      z.object({
        amount: z.number().nullable().describe("Numeric amount only, no thousands separators."),
        currency: z.string().max(3).nullable().describe("ISO 4217 code, e.g. AUD, CAD, GBP."),
        period: z.enum(["per_year", "total", "per_semester", "per_trimester", "per_unit", "unknown"]),
        audience: z.enum(["international", "domestic", "unknown"]),
        year: z.number().int().nullable().describe("Fee year, e.g. 2026."),
        text: z.string().max(300).describe("The fee statement verbatim."),
      }),
    )
    .max(8)
    .default([]),
  intakes: z.array(z.string().max(60)).max(12).default([]).describe("e.g. ['February', 'July'] or ['Trimester 1', 'Trimester 2']."),
  applicationDeadlines: z.array(z.object({ intake: z.string().max(60).nullable(), date: z.string().max(60).nullable(), text: z.string().max(200) })).max(8).default([]),
  entryRequirements: z.object({ academic: z.array(z.string().max(300)).max(10).default([]), text: z.string().max(1_500).nullable() }),
  englishRequirements: z.object({
    ielts: Score.nullable(),
    pte: Score.nullable(),
    toefl: Score.nullable(),
    duolingo: z.number().nullable(),
    other: z.array(z.string().max(200)).max(6).default([]),
  }),
  scholarships: z.array(z.object({ name: z.string().max(200), amount: z.string().max(100).nullable(), text: z.string().max(300) })).max(8).default([]),
  codes: z.object({ cricos: z.string().max(40).nullable(), courseCode: z.string().max(40).nullable(), ucas: z.string().max(40).nullable(), other: z.array(z.string().max(60)).max(6).default([]) }),
  evidence: z.array(z.string().max(300)).max(6).default([]).describe("Short verbatim quotes supporting fees and requirements."),
  confidence: z.number().min(0).max(1).describe("How confident you are this is a real program described on the page."),
});

export const ProgramExtractionSchema = z.object({
  /** false when the page is a listing/landing page, not a specific program. */
  pageDescribesPrograms: z.boolean(),
  programs: z.array(ProgramLLMSchema).max(10),
});

export type ProgramLLM = z.infer<typeof ProgramLLMSchema>;

export type ProgramRecord = ProgramLLM & {
  _id: string;
  university: string;
  universitySlug: string | null;
  country: Destination | "global" | null;
  sourceUrl: string;
  /** Chunk source id the record belongs to (e.g. partner:<slug>, upload:<slug>). */
  source: string;
  contentHash: string;
  model: string;
  extractedAt: Date;
  updatedAt: Date;
};

const SYSTEM = `You extract structured facts about university programs (courses/degrees) from one web page for an international-education consultancy.
Rules:
- Use ONLY facts stated on the page. Anything absent → null / empty array. Never guess fees, dates, scores or codes.
- One entry per distinct program described in full. Listing pages that only link to programs → pageDescribesPrograms=false, programs=[].
- Amounts as plain numbers (47900, not "47,900"); currency as ISO code; note whether a fee is per_year/total and for international/domestic students.
- IELTS/PTE/TOEFL: overall score and the minimum band/section score if given.
- Quote up to 6 short verbatim snippets as evidence for fees and entry requirements.
- Respond with JSON matching the schema exactly.`;

export interface ExtractDeps {
  gen: GeminiGenerate;
  model: string;
  /** Tried when the first response fails schema validation. */
  fallbackModel?: string;
  signal?: AbortSignal;
}

export async function extractPrograms(
  page: ExtractedPage,
  ctx: { source: Pick<CrawlSource, "name" | "country" | "partnerSlug">; contentHash: string; university: string },
  deps: ExtractDeps,
): Promise<ProgramRecord[]> {
  const jsonLdHint = page.jsonLd?.length ? `\n\nStructured data found on the page (schema.org):\n${JSON.stringify(page.jsonLd).slice(0, 6_000)}` : "";
  const text = `URL: ${page.url}\nTitle: ${page.title}\nInstitution: ${ctx.university}\n\n${page.text.slice(0, 40_000)}${jsonLdHint}`;
  const schema = zodToGeminiSchema(ProgramExtractionSchema);
  const attempt = async (model: string) => {
    const res = await deps.gen.generate({ model, system: SYSTEM, parts: [{ text }], responseSchema: schema, temperature: 0, maxOutputTokens: 8_192, signal: deps.signal, timeoutMs: 60_000 });
    return { model, parsed: ProgramExtractionSchema.safeParse(res.json) };
  };
  let { model, parsed } = await attempt(deps.model);
  if (!parsed.success && deps.fallbackModel && deps.fallbackModel !== deps.model) {
    logger.debug("program extraction failed schema validation; retrying with fallback model", { url: page.url, err: parsed.error.message.slice(0, 200) });
    ({ model, parsed } = await attempt(deps.fallbackModel));
  }
  if (!parsed.success) {
    logger.warn("program extraction returned invalid JSON", { url: page.url, err: parsed.error.message.slice(0, 300) });
    return [];
  }
  if (!parsed.data.pageDescribesPrograms) return [];
  const now = new Date();
  return parsed.data.programs
    .filter((p) => p.confidence >= 0.4)
    .map((p) => ({
      ...p,
      _id: sha256(`${page.url}#${p.programName.toLowerCase()}#${p.level ?? ""}#${p.campuses.map((c) => c.toLowerCase()).sort().join(",")}`),
      university: ctx.university,
      universitySlug: ctx.source.partnerSlug ?? null,
      country: ctx.source.country ?? null,
      sourceUrl: page.url,
      source: ctx.source.name,
      contentHash: ctx.contentHash,
      model,
      extractedAt: now,
      updatedAt: now,
    }));
}

const fmtScore = (label: string, s: { overall: number | null; minBand: number | null } | null) =>
  s && (s.overall !== null || s.minBand !== null) ? `${label} ${s.overall ?? "?"}${s.minBand !== null ? ` (min band ${s.minBand})` : ""}` : null;

/** Compact, deterministic text rendering used as the evidence body and the kb_chunks document. */
export function renderProgramText(p: ProgramRecord): string {
  const lines: string[] = [];
  lines.push(`${p.university} — ${p.programName}${p.level ? ` (${p.level.replace(/_/g, " ")})` : ""}`);
  if (p.discipline) lines.push(`Discipline: ${p.discipline}${p.disciplineTags.length ? ` [${p.disciplineTags.join(", ")}]` : ""}`);
  if (p.campuses.length) lines.push(`Campus: ${p.campuses.join("; ")}${p.deliveryModes.length ? ` (${p.deliveryModes.join(", ")})` : ""}`);
  if (p.duration) lines.push(`Duration: ${p.duration.text ?? (p.duration.value !== null ? `${p.duration.value} ${p.duration.unit ?? ""}`.trim() : "not stated")}`);
  if (p.intakes.length) lines.push(`Intakes: ${p.intakes.join(", ")}`);
  for (const t of p.tuition) lines.push(`Tuition (${t.audience}, ${t.period.replace(/_/g, " ")}${t.year ? `, ${t.year}` : ""}): ${t.amount !== null ? `${t.currency ?? ""} ${t.amount.toLocaleString("en-AU")}`.trim() : t.text}`);
  for (const d of p.applicationDeadlines) lines.push(`Application deadline${d.intake ? ` (${d.intake})` : ""}: ${d.date ?? d.text}`);
  if (p.entryRequirements.academic.length) lines.push(`Academic entry: ${p.entryRequirements.academic.join("; ")}`);
  else if (p.entryRequirements.text) lines.push(`Academic entry: ${p.entryRequirements.text}`);
  const english = [fmtScore("IELTS", p.englishRequirements.ielts), fmtScore("PTE", p.englishRequirements.pte), fmtScore("TOEFL", p.englishRequirements.toefl), p.englishRequirements.duolingo !== null ? `Duolingo ${p.englishRequirements.duolingo}` : null, ...p.englishRequirements.other].filter(Boolean);
  if (english.length) lines.push(`English: ${english.join("; ")}`);
  for (const s of p.scholarships) lines.push(`Scholarship: ${s.name}${s.amount ? ` — ${s.amount}` : ""}${s.text ? ` (${s.text})` : ""}`);
  const codes = [p.codes.cricos ? `CRICOS ${p.codes.cricos}` : null, p.codes.courseCode ? `Course code ${p.codes.courseCode}` : null, p.codes.ucas ? `UCAS ${p.codes.ucas}` : null, ...p.codes.other].filter(Boolean);
  if (codes.length) lines.push(`Codes: ${codes.join("; ")}`);
  lines.push(`Source: ${p.sourceUrl}`);
  return lines.join("\n");
}

export function programUrl(p: Pick<ProgramRecord, "sourceUrl" | "programName">): string {
  return `${p.sourceUrl}#program:${slugify(p.programName)}`;
}

/** Synthetic page for the kb_chunks copy of a record. */
export function renderProgramPage(p: ProgramRecord): ExtractedPage {
  const text = renderProgramText(p);
  return {
    url: programUrl(p),
    title: `${p.university} — ${p.programName}`,
    description: p.discipline ?? "",
    lang: "en",
    canonical: p.sourceUrl,
    sections: [{ heading: `${p.programName}`, level: 2, text }],
    links: [],
    text: `## ${p.programName}\n${text}`,
  };
}

/**
 * Replace the records for one source page and index their text copies.
 * Deleting stale records first keeps re-extraction idempotent when a page changes.
 */
export async function storePrograms(
  records: ProgramRecord[],
  ctx: { sourceUrl: string; contentHash: string; source: CrawlSource },
  deps: { collections: Pick<Collections, "kbPrograms" | "kbPages" | "kbChunks">; ingest: IngestDeps },
): Promise<{ stored: number; removed: number }> {
  const keep = new Set(records.map((r) => r._id));
  const stale = await deps.collections.kbPrograms.find({ sourceUrl: ctx.sourceUrl, _id: { $nin: [...keep] } }, { projection: { _id: 1, programName: 1 } }).toArray();
  if (stale.length) {
    await deps.collections.kbPrograms.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    const urls = stale.map((s) => programUrl({ sourceUrl: ctx.sourceUrl, programName: s.programName }));
    await deps.collections.kbChunks.deleteMany({ url: { $in: urls } });
    await deps.collections.kbPages.deleteMany({ _id: { $in: urls } });
  }
  if (records.length) {
    await deps.collections.kbPrograms.bulkWrite(
      records.map((r) => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })),
      { ordered: false },
    );
    for (const r of records) {
      await indexSyntheticPage(renderProgramPage(r), { name: ctx.source.name, country: ctx.source.country, docType: "program", partnerSlug: ctx.source.partnerSlug, parentUrl: ctx.sourceUrl }, deps.ingest);
    }
  }
  await deps.collections.kbPages.updateOne({ _id: ctx.sourceUrl }, { $set: { programsHash: ctx.contentHash } });
  return { stored: records.length, removed: stale.length };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
export interface ProgramSearchFilters {
  q?: string;
  countries?: Destination[];
  universitySlugs?: string[];
  /** Case-insensitive substring on the university name. */
  university?: string;
  levels?: string[];
  /** Matches disciplineTags or discipline (case-insensitive). */
  disciplines?: string[];
  intake?: string;
  /** Upper bound on any listed international per-year tuition. */
  maxTuition?: number;
  currency?: string;
  /** Records whose IELTS overall requirement is ≤ this (i.e. the student's score). */
  maxIeltsOverall?: number;
  hasScholarships?: boolean;
  limit?: number;
  offset?: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pure Mongo filter builder (unit-tested). */
export function buildProgramFilter(f: ProgramSearchFilters): Filter<ProgramRecord> {
  const and: Document[] = [];
  if (f.q?.trim()) and.push({ $text: { $search: f.q.trim() } });
  if (f.countries?.length) and.push({ country: { $in: f.countries } });
  if (f.universitySlugs?.length) and.push({ universitySlug: { $in: f.universitySlugs } });
  if (f.university?.trim()) and.push({ university: { $regex: escapeRe(f.university.trim()), $options: "i" } });
  if (f.levels?.length) and.push({ level: { $in: f.levels } });
  if (f.disciplines?.length) {
    const res = f.disciplines.map((d) => new RegExp(escapeRe(d.trim()), "i"));
    and.push({ $or: [{ disciplineTags: { $in: res } }, { discipline: { $in: res } }] });
  }
  if (f.intake?.trim()) and.push({ intakes: { $elemMatch: { $regex: escapeRe(f.intake.trim()), $options: "i" } } });
  if (f.maxTuition !== undefined) {
    and.push({
      tuition: { $elemMatch: { amount: { $lte: f.maxTuition, $ne: null }, audience: { $in: ["international", "unknown"] }, period: { $in: ["per_year", "unknown"] }, ...(f.currency ? { currency: f.currency.toUpperCase() } : {}) } },
    });
  } else if (f.currency) and.push({ "tuition.currency": f.currency.toUpperCase() });
  if (f.maxIeltsOverall !== undefined) and.push({ "englishRequirements.ielts.overall": { $lte: f.maxIeltsOverall, $ne: null } });
  if (f.hasScholarships) and.push({ "scholarships.0": { $exists: true } });
  return (and.length ? { $and: and } : {}) as Filter<ProgramRecord>;
}

export function toProgramRecordLike(p: ProgramRecord): ProgramRecordLike {
  return { id: p._id, url: p.sourceUrl, university: p.university, programName: p.programName, level: p.level, country: p.country, summary: renderProgramText(p), ...withUpdatedAt(p.updatedAt ?? p.extractedAt) };
}

/** `kb_programs` search: implements the research tool contract and the API. */
export class MongoProgramSearch implements ProgramSearch {
  constructor(private readonly col: Collection<ProgramRecord>) {}

  async query(f: ProgramSearchFilters, opts?: { signal?: AbortSignal }): Promise<{ items: ProgramRecord[]; total: number }> {
    const filter = buildProgramFilter(f);
    const limit = Math.min(Math.max(f.limit ?? 20, 1), 50);
    const cursor = this.col.find(filter, { signal: opts?.signal, ...(f.q ? { projection: { score: { $meta: "textScore" } } } : {}) });
    if (f.q) cursor.sort({ score: { $meta: "textScore" } });
    else cursor.sort({ university: 1, programName: 1 });
    const [items, total] = await Promise.all([cursor.skip(f.offset ?? 0).limit(limit).toArray(), this.col.countDocuments(filter)]);
    return { items: items.map(({ score: _s, ...rest }: ProgramRecord & { score?: number }) => rest as ProgramRecord), total };
  }

  async search(filters: ProgramFilters, opts?: { signal?: AbortSignal }): Promise<ProgramRecordLike[]> {
    const { items } = await this.query(
      {
        q: filters.query,
        countries: filters.countries?.length ? filters.countries : filters.country ? [filters.country] : undefined,
        university: filters.university,
        levels: filters.level ? [filters.level] : undefined,
        disciplines: filters.discipline ? [filters.discipline] : undefined,
        intake: filters.intake,
        maxTuition: filters.maxTuition,
        limit: filters.limit ?? 8,
      },
      opts,
    );
    return items.map(toProgramRecordLike);
  }

  async count() {
    return this.col.estimatedDocumentCount();
  }
}
