import type { ServiceStatus, WorkspaceService } from "../google/types";
import type { RetrievedChunk } from "../retrieval/store";

/**
 * Evidence is everything the research loop gathers to answer a request:
 * knowledge-base chunks, structured program records, web-search hits, live
 * page excerpts and CRM records. Every item gets a stable `[n]` the answer can cite.
 */
export type EvidenceKind = "kb" | "programs" | "web" | "page" | "crm" | "gmail" | "drive" | "calendar" | "docs" | "document";

export interface EvidenceItem extends RetrievedChunk {
  /** Citation number; stable for the whole turn. */
  n: number;
  kind: EvidenceKind;
  /** Fetched from the live web during this turn (not from the indexed knowledge base). */
  live: boolean;
  fetchedAt?: string;
  /** A crm_search_contacts result: what was searched and the contacts it matched (for the ambiguity check). */
  crmSearch?: CrmContactSearch;
}

/** One contact a CRM search matched, as the answer would name it to tell them apart. */
export interface CrmContactMatch {
  id: string;
  name: string | null;
  branch: string | null;
  status: string | null;
}

export interface CrmContactSearch {
  query: string;
  contacts: CrmContactMatch[];
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  /** Evidence items this call added. */
  added: number;
  error?: string;
  urls?: string[];
  /** Comparison fan-out: the country whose branch made this call (absent for the single loop). */
  country?: string;
}

export interface ResearchTrace {
  rounds: number;
  budgetExceeded: boolean;
  toolCalls: ToolCallRecord[];
  /** Live URLs consulted (web results / fetched pages). */
  liveUrls: string[];
  /** The research model's closing note about what it could / could not find. */
  notes: string | null;
  /** Why the loop stopped early (model/provider error), if it did. */
  error?: string | null;
  /** The research model's reasoning, one segment per round that produced any. */
  thoughts?: ThoughtSegment[];
  /** CRM changes proposed this turn, one summary line each. Nothing was written; each waits on an approval card. */
  proposals?: string[];
  /** Whether this consultant's Gmail and Drive were usable this turn (absent when the integration is off). */
  workspace?: Record<WorkspaceService, ServiceStatus>;
  /** Set only on the copy written to `chat_turns`: Gmail/Drive-derived parts were removed (src/google/redact.ts). */
  workspaceRedacted?: true;
}

/**
 * One stretch of the model's reasoning, placed in the turn's timeline: `at` is how many
 * research tool calls came before it, so a client can interleave thoughts with the lookups
 * (think, search, think, read, answer) the way they happened.
 */
export interface ThoughtSegment {
  at: number;
  text: string;
}

export const EMPTY_RESEARCH: ResearchTrace = { rounds: 0, budgetExceeded: false, toolCalls: [], liveUrls: [], notes: null, error: null };
