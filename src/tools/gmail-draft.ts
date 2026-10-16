import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface, ToolRunnableConfig } from "@langchain/core/tools";
import type { CrmWriteService } from "../crm/approvals/service";
import { CRM_WRITE_PROPOSAL_EVENT, type CrmWriteProposalView } from "../crm/approvals/types";
import { isReadOnlyTool, type McpToolDescriptor, type McpToolset } from "../mcp/types";

/**
 * Gmail `create_draft` as a proposal, never a call. The research model's arguments become a
 * pending proposal (src/crm/approvals, `provider: "gmail"`) streamed to the chat as the same
 * `crm_write_proposal` card CRM writes use; Gmail is called only when the consultant approves it
 * over POST /v1/crm/writes/:id/decision, and then only to save a draft. Nothing is ever sent.
 */

export const GMAIL_CREATE_DRAFT = "gmail_create_draft";

const MAX_BODY_IN_SUMMARY = 160;

const change = (view: CrmWriteProposalView, label: string) => view.changes.find((c) => c.label === label)?.after;

/** One line naming the draft, for the answer prompt. Short: the card shows the full body. */
export const draftSummary = (view: CrmWriteProposalView): string => {
  const to = change(view, "To") ?? view.target.parentLabel;
  const thread = change(view, "In reply to thread");
  const body = String(change(view, "Body") ?? change(view, "Body (HTML)") ?? "").replace(/\s+/g, " ").trim();
  const excerpt = body.length > MAX_BODY_IN_SUMMARY ? `${body.slice(0, MAX_BODY_IN_SUMMARY)}…` : body;
  return `Gmail draft "${view.target.label}"${to ? ` to ${to}` : ""}${thread ? ` (reply in thread ${thread})` : ""}: ${excerpt}`;
};

const proposedText = (view: CrmWriteProposalView) =>
  `PROPOSED, NOT SAVED (proposal ${view.proposalId}): ${draftSummary(view)}. The consultant sees this draft as a card below your answer and must approve it before it is saved to their Gmail Drafts. Nothing is sent: Edge never sends email, the consultant sends it from Gmail. Say you prepared a draft for their approval; do not say it was saved or sent. Do not propose the same draft again this turn.`;

const DESCRIPTION_SUFFIX = " In Edge this only proposes the draft: the consultant reviews and approves it before it is saved to their Gmail Drafts. It is never sent.";

/** The create_draft descriptor as a tool that only ever proposes: build the preview, store, stream the card. */
export function makeGmailDraftTool(gmail: McpToolset, descriptor: McpToolDescriptor, writes: CrmWriteService, ctx: { signal?: AbortSignal; proposals?: string[] } = {}): StructuredToolInterface {
  return tool(
    async (input: unknown, config: ToolRunnableConfig) => {
      const args = (input ?? {}) as Record<string, unknown>;
      // The graph's run config carries these; the tool run inherits them as child metadata.
      const { requestId, sessionId } = (config?.metadata ?? {}) as { requestId?: unknown; sessionId?: unknown };
      if (typeof requestId !== "string" || typeof sessionId !== "string" || !requestId || !sessionId) {
        return "error: a Gmail draft cannot be proposed outside a chat turn";
      }
      const r = await writes.proposeGmailDraft({ sessionId, requestId, toolset: gmail, tool: descriptor.name, args, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (!r.ok) return `error: ${r.error}`;
      await dispatchCustomEvent(CRM_WRITE_PROPOSAL_EVENT, r.view, config);
      ctx.proposals?.push(draftSummary(r.view));
      // No evidence: a proposed draft is not a fact about the mailbox.
      return proposedText(r.view);
    },
    { name: descriptor.name, description: `${descriptor.description}${DESCRIPTION_SUFFIX}`, schema: descriptor.inputSchema },
  );
}

/**
 * The draft tool when it can go through approval: Gmail published a write `gmail_create_draft`,
 * and the approval service can reach Gmail on approve. Otherwise nothing is offered.
 */
export function makeGmailDraftTools(gmail: McpToolset, ctx: { writes?: CrmWriteService; signal?: AbortSignal; proposals?: string[] }): StructuredToolInterface[] {
  const descriptor = gmail.descriptors.find((d) => d.name === GMAIL_CREATE_DRAFT && !isReadOnlyTool(d));
  if (!descriptor || !ctx.writes?.gmailDraftsEnabled) return [];
  return [makeGmailDraftTool(gmail, descriptor, ctx.writes, ctx)];
}
