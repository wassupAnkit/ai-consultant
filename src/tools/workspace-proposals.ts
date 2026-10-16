import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface, ToolRunnableConfig } from "@langchain/core/tools";
import type { CrmWriteService } from "../crm/approvals/service";
import { CRM_WRITE_PROPOSAL_EVENT, type CrmWriteProposalView } from "../crm/approvals/types";
import { CALENDAR_LABELS, FILE_LABELS } from "../crm/approvals/workspace-previews";
import { isReadOnlyTool, type McpToolset } from "../mcp/types";

/**
 * Google Calendar events and new Google Docs/Sheets as proposals, never calls — the same pattern
 * as Gmail drafts (src/tools/gmail-draft.ts). The model's arguments become a pending proposal
 * (`provider: "calendar" | "docs"`) streamed as the `crm_write_proposal` card; Google is called
 * only when the consultant approves it, once. A calendar event's attendees are emailed an invite
 * by Google at that moment, so the card names them first.
 */

export type ProposalService = "calendar" | "docs";

const change = (view: CrmWriteProposalView, label: string) => view.changes.find((c) => c.label === label)?.after;

/** One line naming the proposal, for the answer prompt and the session history. */
export function workspaceProposalSummary(view: CrmWriteProposalView): string {
  if (view.target.entity === "calendarEvent") {
    const invites = change(view, CALENDAR_LABELS.invites);
    return `Calendar event "${view.target.label}" ${change(view, CALENDAR_LABELS.starts)} to ${change(view, CALENDAR_LABELS.ends)}${invites ? `, invites to ${invites} on Approve` : ", no invites"}`;
  }
  const kind = view.target.entity === "googleSheet" ? "Google Sheet" : "Google Doc";
  const rows = change(view, FILE_LABELS.rows);
  return `${kind} "${view.target.label}"${rows ? ` (${rows})` : ""}, private to the consultant`;
}

const proposedText = (service: ProposalService, view: CrmWriteProposalView) => {
  const head = `PROPOSED, NOT DONE (proposal ${view.proposalId}): ${workspaceProposalSummary(view)}.`;
  if (service === "calendar") {
    const invites = change(view, CALENDAR_LABELS.invites);
    return `${head} The consultant sees this event as a card below your answer and must approve it before it is added to their calendar.${invites ? ` On Approve, Google emails an invite to ${invites}.` : ""} Say you prepared the event for their approval; do not say it was booked or that anyone was invited. Do not propose the same event again this turn.`;
  }
  return `${head} The consultant sees this file as a card below your answer and must approve it before it is created in their Drive; it stays private to them until they share it. Say you prepared it for their approval; do not say it was created. Do not propose the same file again this turn.`;
};

const DESCRIPTION_SUFFIX: Record<ProposalService, string> = {
  calendar: " In Edge this only proposes the event: the consultant reviews and approves it on a card first.",
  docs: " In Edge this only proposes the file: the consultant reviews and approves it on a card first.",
};

/**
 * The service's write tools as proposal tools, when the approval service can reach that service on
 * approve. Read tools are built elsewhere (src/tools/workspace.ts).
 */
export function makeWorkspaceProposalTools(toolset: McpToolset, service: ProposalService, ctx: { writes?: CrmWriteService; signal?: AbortSignal; proposals?: string[] }): StructuredToolInterface[] {
  const writes = ctx.writes;
  if (!writes?.workspaceWritesEnabled) return [];
  return toolset.descriptors
    .filter((d) => !isReadOnlyTool(d) && d.name.startsWith(`${service}_`))
    .map((descriptor) =>
      tool(
        async (input: unknown, config: ToolRunnableConfig) => {
          const args = (input ?? {}) as Record<string, unknown>;
          const { requestId, sessionId } = (config?.metadata ?? {}) as { requestId?: unknown; sessionId?: unknown };
          if (typeof requestId !== "string" || typeof sessionId !== "string" || !requestId || !sessionId) {
            return "error: this cannot be proposed outside a chat turn";
          }
          const r = await writes.proposeWorkspace({ service, sessionId, requestId, toolset, tool: descriptor.name, args, ...(ctx.signal ? { signal: ctx.signal } : {}) });
          if (!r.ok) return `error: ${r.error}`;
          await dispatchCustomEvent(CRM_WRITE_PROPOSAL_EVENT, r.view, config);
          ctx.proposals?.push(workspaceProposalSummary(r.view));
          return proposedText(service, r.view);
        },
        { name: descriptor.name, description: `${descriptor.description}${DESCRIPTION_SUFFIX[service]}`, schema: descriptor.inputSchema },
      ),
    );
}
