import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RetrievedChunk } from "../retrieval/store";
import { DESTINATIONS, STUDY_LEVELS, type Destination } from "../schemas/intent.schema";
import { EvidenceCollector } from "./evidence";

/**
 * Structured program search contract. Implemented over the `kb_programs`
 * collection (records extracted from partner-university course pages); kept as
 * an interface so the research loop and its tests don't depend on MongoDB.
 */
export interface ProgramFilters {
  query?: string;
  /** One country (the research tool's argument). Ignored when `countries` is given. */
  country?: Destination;
  /** Several countries, any of which matches (round 0 of a multi-country route). */
  countries?: Destination[];
  university?: string;
  level?: string;
  discipline?: string;
  intake?: string;
  maxTuition?: number;
  limit?: number;
}

export interface ProgramRecordLike {
  id: string;
  /** Page the record was extracted from. */
  url: string;
  university: string;
  programName: string;
  level: string | null;
  country: string | null;
  /** Compact text rendering (fees, duration, intakes, requirements…) used as the evidence body. */
  summary: string;
  /** When the record was last extracted or updated (ISO 8601); shown as the excerpt's `updated` date. */
  updatedAt?: string;
}

export interface ProgramSearch {
  search(filters: ProgramFilters, opts?: { signal?: AbortSignal }): Promise<ProgramRecordLike[]>;
}

export function programToChunk(p: ProgramRecordLike): RetrievedChunk {
  return {
    id: `program:${p.id}`,
    url: p.url,
    title: `${p.university} — ${p.programName}`,
    section: p.level ?? "",
    docType: "program",
    country: p.country,
    source: "kb_programs",
    content: p.summary,
    score: 1,
    matchedBy: ["programs"],
    ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
  };
}

export function makeSearchProgramsTool(programs: ProgramSearch, ctx: { collector: EvidenceCollector; signal?: AbortSignal }) {
  return tool(
    async (input) => {
      const records = await programs.search(
        {
          query: input.query,
          country: input.country,
          university: input.university,
          level: input.level,
          discipline: input.discipline,
          intake: input.intake,
          maxTuition: input.maxTuition,
          limit: 8,
        },
        { signal: ctx.signal },
      );
      if (!records.length) return "No program records matched. Try a broader query, drop a filter, or use search_knowledge_base / fetch_page on the university's course page.";
      const added = ctx.collector.add(records.map(programToChunk), "programs", false);
      return EvidenceCollector.summaryForModel(added, 700);
    },
    {
      name: "search_programs",
      description:
        "Search structured records of partner-university programs (course name, level, campus, duration, tuition, intakes, application deadlines, academic and English entry requirements, scholarships) extracted from the universities' own pages. Best for exact fees, intakes, IELTS/PTE cut-offs and duration of a specific course.",
      schema: z.object({
        query: z.string().max(200).optional().describe("Free-text match on program name / discipline, e.g. 'master of data science'."),
        country: z.enum(DESTINATIONS).optional(),
        university: z.string().max(120).optional().describe("University name or part of it, e.g. 'Monash'."),
        level: z.enum(STUDY_LEVELS).optional(),
        discipline: z.string().max(80).optional().describe("Field of study, e.g. 'nursing', 'IT', 'business'."),
        intake: z.string().max(40).optional().describe("Intake month/term, e.g. 'February', 'Trimester 1'."),
        // Gemini function declarations reject `exclusiveMinimum` (zod `.positive()`); use `minimum` instead.
        maxTuition: z.number().min(0).optional().describe("Upper bound on annual tuition in the program's currency (a positive number)."),
      }),
    },
  );
}
