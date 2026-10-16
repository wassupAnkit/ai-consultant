/**
 * Wire types for write approval: CRM writes and Gmail drafts share one proposal model, one
 * `crm_write_proposal` stream event and one decision route. crm-api defines the CRM preview shape
 * in crm-api/src/mcp/tools/write-preview.ts; a Gmail draft preview is built here from the model's
 * arguments (src/crm/approvals/service.ts `gmailDraftPreview`). The frontend mirrors
 * CrmWriteProposalView in lib/edge/types.ts and branches on `provider`. Change all three together.
 */
export const CRM_WRITE_META = { dryRun: "heubert/dryRun", expectedVersion: "heubert/expectedVersion" } as const;
export const CRM_WRITE_PROPOSAL_EVENT = "crm_write_proposal";
export const STALE_RECORD = "STALE_RECORD";

/** Which system an approved proposal executes against. Rows stored before providers existed are "crm". */
export type CrmWriteProvider = "crm" | "gmail" | "calendar" | "docs";

export type CrmWriteValue = string | number | boolean | null;
export interface CrmWriteChange { field: string; label: string; before: CrmWriteValue; after: CrmWriteValue }
export interface CrmWritePreview {
  tool: string;
  target: { entity: "contact" | "enquiry" | "officeVisit" | "note" | "document" | "gmailDraft" | "calendarEvent" | "googleDoc" | "googleSheet"; id: string | null; label: string; parent?: { entity: string; id: string; label: string }; parentLabel?: string };
  changes: CrmWriteChange[];
  version: string | null;
}

export type CrmWriteStatus = "pending" | "applying" | "applied" | "rejected" | "expired" | "stale" | "failed";

/** A value the counsellor changed on the card before approving (contract §5). */
export interface CrmWriteEdit { field: string; from: CrmWriteValue; to: CrmWriteValue }

/** Where a proposal came from when Edge built it itself rather than the research model (document intake). */
export interface CrmWriteOrigin { kind: "document"; attachmentId: string }

/** What an applied proposal produced, for the card: a Gmail draft's link ("Open draft in Gmail") and id. */
export interface CrmWriteResult { link?: string; id?: string }

/** What is stored. `args` are the model's exact tool arguments, replayed verbatim on approve. */
export interface CrmWriteProposal {
  id: string;
  provider: CrmWriteProvider;
  sessionId: string;
  requestId: string;
  actorEmail: string;
  tool: string;
  args: Record<string, unknown>;
  preview: CrmWritePreview;
  status: CrmWriteStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
  error?: string;
  current?: CrmWriteChange[];
  result?: CrmWriteResult;
  origin?: CrmWriteOrigin;
  /** The args as first proposed, when the counsellor edited them (`args` then holds the edited ones). */
  originalArgs?: Record<string, unknown>;
  edited?: CrmWriteEdit[];
}

/** What the chat receives: the stream event payload, the decision response, and history. */
export interface CrmWriteProposalView {
  proposalId: string;
  requestId: string;
  provider: CrmWriteProvider;
  tool: string;
  target: { entity: CrmWritePreview["target"]["entity"]; id: string | null; label: string; parentLabel?: string };
  changes: CrmWriteChange[];
  status: CrmWriteStatus;
  expiresAt: string;
  decidedAt?: string;
  error?: string;
  current?: CrmWriteChange[];
  result?: CrmWriteResult;
  edited?: CrmWriteEdit[];
}

/** A stored row with its provider filled in; rows written before providers existed have none. */
export const withProvider = <P extends Omit<CrmWriteProposal, "provider"> & { provider?: CrmWriteProvider }>(p: P): P & { provider: CrmWriteProvider } => ({ ...p, provider: p.provider ?? "crm" });

export const toView = (p: CrmWriteProposal): CrmWriteProposalView => ({
  proposalId: p.id,
  requestId: p.requestId,
  provider: p.provider ?? "crm",
  tool: p.tool,
  target: {
    entity: p.preview.target.entity,
    id: p.preview.target.id,
    label: p.preview.target.label,
    // crm-api's document preview names its parent as a bare `parentLabel` (the checklist name).
    ...(p.preview.target.parent ? { parentLabel: p.preview.target.parent.label } : p.preview.target.parentLabel ? { parentLabel: p.preview.target.parentLabel } : {}),
  },
  changes: p.preview.changes,
  status: p.status,
  expiresAt: p.expiresAt.toISOString(),
  ...(p.decidedAt ? { decidedAt: p.decidedAt.toISOString() } : {}),
  ...(p.error ? { error: p.error } : {}),
  ...(p.current ? { current: p.current } : {}),
  ...(p.result ? { result: p.result } : {}),
  ...(p.edited?.length ? { edited: p.edited } : {}),
});
