import type { StructuredToolInterface } from "@langchain/core/tools";
import type { CrmWriteService } from "../crm/approvals/service";
import type { CrmToolset } from "../crm/client";
import type { CrmRead } from "../crm/student";
import type { McpToolset } from "../mcp/types";
import type { KnowledgeStore } from "../retrieval/store";
import type { Market } from "../routing/markets";
import { makeSearchComplianceGuidesTool } from "./compliance";
import { makeCrmTools } from "./crm";
import type { EvidenceCollector } from "./evidence";
import { makeFetchPageTool, type PageFetcher } from "./fetch-page";
import { makeGmailDraftTools } from "./gmail-draft";
import { makeWorkspaceTools } from "./workspace";
import { makeWorkspaceProposalTools } from "./workspace-proposals";
import { makeSearchKnowledgeBaseTool } from "./knowledge";
import { makeSearchProgramsTool, type ProgramSearch } from "./programs";
import { makeWebSearchTool, type WebSearcher } from "./web-search";

/** Everything the research loop can call. Optional members are simply not offered to the model. */
export interface ResearchTools {
  knowledge: KnowledgeStore;
  programs?: ProgramSearch;
  web?: WebSearcher;
  fetcher?: PageFetcher;
  /** Offer `search_compliance_guides` (the guides ship in the image; on with the skill or market packs). */
  complianceGuides?: boolean;
  /**
   * Read-only CRM access over MCP, already resolved for the consultant asking this turn.
   * Absent when unconfigured, unreachable, or the consultant has no CRM account.
   */
  crm?: CrmToolset;
  /** This consultant's own Gmail and Drive over Google's MCP servers; absent when not connected. */
  gmail?: McpToolset;
  drive?: McpToolset;
  /** This consultant's Google Calendar (read, and events behind an approval card). */
  calendar?: McpToolset;
  /** New Google Docs and Sheets behind an approval card; no reads. */
  docs?: McpToolset;
}

export interface ToolContext {
  collector: EvidenceCollector;
  /** URLs the consultant pasted in this message; may be fetched even off-allowlist (SSRF-checked). */
  explicitUrls: Set<string>;
  topK: number;
  signal?: AbortSignal;
  /** CRM front end origin (CRM_WEB_URL). When set, CRM evidence carries a link to the record. */
  crmWebUrl?: string;
  /** CRM write approval. Set → write tools become proposals; unset → write tools are not offered. */
  crmWrites?: CrmWriteService;
  /** Collects one summary line per CRM change proposed this turn, for the answer prompt. */
  proposals?: string[];
  /** Collects every successful CRM read with its structured result (see `crmStudentFromReads`). */
  crmReads?: CrmRead[];
  /**
   * Google write approval (Gmail drafts, Calendar events, new Docs/Sheets). Kept apart from `crmWrites`
   * although it is the same service: each is set only when its own switch is on, so enabling Google
   * writes can never start offering CRM writes. Which Google writes exist is decided by the provider.
   */
  gmailDrafts?: CrmWriteService;
  /** The consultant this turn acts as (lower-cased email): Gmail links open in their mailbox. */
  actor?: string;
  /** The student's source market (the route's origin): knowledge-base searches rank its pages first. */
  market?: Market;
}

/** Build the per-turn tool set bound to this turn's evidence collector. */
export function buildResearchTools(tools: ResearchTools, ctx: ToolContext): StructuredToolInterface[] {
  const out: StructuredToolInterface[] = [makeSearchKnowledgeBaseTool(tools.knowledge, ctx)];
  if (tools.programs) out.push(makeSearchProgramsTool(tools.programs, ctx));
  if (tools.web) out.push(makeWebSearchTool(tools.web, ctx));
  if (tools.fetcher) out.push(makeFetchPageTool(tools.fetcher, ctx));
  if (tools.complianceGuides) out.push(makeSearchComplianceGuidesTool(ctx));
  // One tool per descriptor the CRM published, so its surface is owned by crm-api.
  if (tools.crm) out.push(...makeCrmTools(tools.crm, ctx));
  // Gmail and Drive reads as this consultant; a Gmail draft is only ever a proposal.
  if (tools.gmail && ctx.actor) out.push(...makeWorkspaceTools(tools.gmail, "gmail", { collector: ctx.collector, actor: ctx.actor, ...(ctx.signal ? { signal: ctx.signal } : {}) }));
  if (tools.drive && ctx.actor) out.push(...makeWorkspaceTools(tools.drive, "drive", { collector: ctx.collector, actor: ctx.actor, ...(ctx.signal ? { signal: ctx.signal } : {}) }));
  if (tools.calendar && ctx.actor) out.push(...makeWorkspaceTools(tools.calendar, "calendar", { collector: ctx.collector, actor: ctx.actor, ...(ctx.signal ? { signal: ctx.signal } : {}) }));
  const writeCtx = { writes: ctx.gmailDrafts, proposals: ctx.proposals, ...(ctx.signal ? { signal: ctx.signal } : {}) };
  if (tools.gmail) out.push(...makeGmailDraftTools(tools.gmail, writeCtx));
  // A calendar event or a new Doc/Sheet is only ever a proposal, like a Gmail draft.
  if (tools.calendar) out.push(...makeWorkspaceProposalTools(tools.calendar, "calendar", writeCtx));
  if (tools.docs) out.push(...makeWorkspaceProposalTools(tools.docs, "docs", writeCtx));
  return out;
}

export type { CrmProvider, CrmToolset } from "../crm/client";
export type { PageFetcher, ProgramSearch, WebSearcher };
export { EvidenceCollector } from "./evidence";
export type { EvidenceItem, EvidenceKind, ResearchTrace, ToolCallRecord } from "./types";
