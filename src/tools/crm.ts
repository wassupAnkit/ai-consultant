import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface, ToolRunnableConfig } from "@langchain/core/tools";
import { sha256 } from "../activity/identity";
import type { CrmWriteService } from "../crm/approvals/service";
import { CRM_WRITE_PROPOSAL_EVENT, type CrmWriteProposalView } from "../crm/approvals/types";
import { isReadOnlyTool, type CrmToolDescriptor, type CrmToolset } from "../crm/client";
import { crmDeepLink } from "../crm/deep-link";
import type { CrmRead } from "../crm/student";
import type { RetrievedChunk } from "../retrieval/store";
import { EvidenceCollector } from "./evidence";
import type { CrmContactMatch, CrmContactSearch } from "./types";

/**
 * Exposes the CRM's MCP tools to the research loop.
 *
 * Tools are built from the descriptors the CRM published, so this file does not name or
 * describe any individual tool — crm-api owns both, and adding one there needs no change
 * here. Their JSON Schema is handed to `tool()` unchanged, which LangChain accepts
 * alongside zod.
 *
 * Each successful call becomes exactly one evidence item rather than one per record: the
 * CRM tools already return a compact, permission-filtered summary, and splitting it would
 * spend the collector's cap (24 items) on a single lookup.
 *
 * PRIVACY: CRM results carry real student data — names, emails, phone numbers, dates of
 * birth. Everything that becomes evidence is written to the activity log (`chat_turns`,
 * which the README frames as the fine-tuning corpus) and reaches Langfuse traces. The
 * logger's redaction regex covers credentials, not personal data. Decide the retention and
 * redaction policy before this is switched on for real consultants.
 *
 * WRITES ARE PROPOSALS: a tool without `readOnlyHint: true` never executes here. With
 * `ctx.crmWrites` set, its call becomes a dry run stored as a proposal (src/crm/approvals),
 * streamed to the chat as a `crm_write_proposal` card, and executed only when the counsellor
 * approves it over HTTP. Without `ctx.crmWrites` the write tool is not built at all.
 */

const MAX_ARG_SUMMARY = 120;

const summariseArgs = (args: Record<string, unknown>): string => {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`);
  const text = parts.join(", ");
  return text.length > MAX_ARG_SUMMARY ? `${text.slice(0, MAX_ARG_SUMMARY)}…` : text;
};

const formatValue = (v: CrmWriteProposalView["changes"][number]["before"]) => (v === null || v === "" ? "(empty)" : String(v));

/** One line naming the change, for the research model's tool result and the answer prompt. */
export const proposalSummary = (view: CrmWriteProposalView): string => {
  const target = view.target.parentLabel ? `${view.target.label} (${view.target.parentLabel})` : view.target.label;
  const changes = view.changes.map((c) => `${c.label} ${formatValue(c.before)} → ${formatValue(c.after)}`).join("; ");
  return `${view.tool} on ${target}: ${changes || "no field changes"}`;
};

const proposedText = (view: CrmWriteProposalView) =>
  `PROPOSED, NOT APPLIED (proposal ${view.proposalId}): ${proposalSummary(view)}. The counsellor sees a card with this exact change below your answer and will approve or reject it. Say what you proposed; do not say it was done. Do not propose the same change again this turn.`;

/** A write descriptor as a tool that only ever proposes: dry run, store, stream the card. */
function makeCrmProposalTool(crm: CrmToolset, descriptor: CrmToolDescriptor, crmWrites: CrmWriteService, signal?: AbortSignal, proposals?: string[]): StructuredToolInterface {
  return tool(
    async (input: unknown, config: ToolRunnableConfig) => {
      const args = (input ?? {}) as Record<string, unknown>;
      // The graph's run config carries these; the tool run inherits them as child metadata.
      const { requestId, sessionId } = (config?.metadata ?? {}) as { requestId?: unknown; sessionId?: unknown };
      if (typeof requestId !== "string" || typeof sessionId !== "string" || !requestId || !sessionId) {
        return "error: this CRM change cannot be proposed outside a chat turn";
      }
      const r = await crmWrites.propose({ sessionId, requestId, toolset: crm, tool: descriptor.name, args, ...(signal ? { signal } : {}) });
      if (!r.ok) return `error: ${r.error}`;
      await dispatchCustomEvent(CRM_WRITE_PROPOSAL_EVENT, r.view, config);
      proposals?.push(proposalSummary(r.view));
      // No evidence: a proposal is not a fact about the CRM.
      return proposedText(r.view);
    },
    { name: descriptor.name, description: descriptor.description, schema: descriptor.inputSchema },
  );
}

/** `ctx.crmReads` collects each successful read with its structured result, so the turn can tell which student it was about. */
export function makeCrmTools(crm: CrmToolset, ctx: { collector: EvidenceCollector; signal?: AbortSignal; crmWebUrl?: string; crmWrites?: CrmWriteService; proposals?: string[]; crmReads?: CrmRead[] }): StructuredToolInterface[] {
  const writes = ctx.crmWrites;
  // A write is offered only as a proposal; with no approval service it is not offered at all.
  return crm.descriptors.filter((d) => isReadOnlyTool(d) || writes).map((descriptor) =>
    !isReadOnlyTool(descriptor) ? makeCrmProposalTool(crm, descriptor, writes!, ctx.signal, ctx.proposals) : tool(
      async (input: unknown) => {
        const args = (input ?? {}) as Record<string, unknown>;

        let result;
        try {
          result = await crm.call(descriptor.name, args, ctx.signal);
        } catch (err) {
          // Soft failure: the research loop matches /^error\b/i to mark the call failed and
          // carries on with whatever else it gathered, rather than losing the turn.
          return `error: ${(err as Error).message}`;
        }

        if (result.isError) {
          return `error: ${result.text || "the CRM refused this request"}`;
        }
        ctx.crmReads?.push({ tool: descriptor.name, args, structured: result.structured });
        if (!result.text) {
          return "The CRM returned no content for that request.";
        }

        // A stable synthetic URI keyed on (tool, arguments) so the collector's
        // url#sha256(content) dedupe suppresses an identical repeat call. It stays `crm://`
        // — honest about being a lookup, and the dedupe key must not change with a config
        // value — while `webUrl` carries the clickable CRM page alongside it.
        const search = descriptor.name === "crm_search_contacts" ? contactSearch(args, result.structured) : null;
        const chunk: RetrievedChunk & { crmSearch?: CrmContactSearch } = {
          id: `crm:${descriptor.name}:${sha256(JSON.stringify(args)).slice(0, 12)}`,
          url: `crm://${descriptor.name}/${sha256(JSON.stringify(args)).slice(0, 12)}`,
          webUrl: crmDeepLink(ctx.crmWebUrl, descriptor.name, args),
          title: descriptor.title ?? descriptor.name,
          section: summariseArgs(args),
          docType: "crm_record",
          country: null,
          source: "crm",
          content: result.text,
          // Not a ranked retrieval — it is a direct, permission-scoped lookup.
          score: 1,
          matchedBy: ["crm"],
          // The matches, so the answer can be checked for picking one of several silently.
          ...(search ? { crmSearch: search } : {}),
        };

        const added = ctx.collector.add([chunk], "crm", true);
        return EvidenceCollector.summaryForModel(added);
      },
      {
        name: descriptor.name,
        description: descriptor.description,
        schema: descriptor.inputSchema,
      },
    ),
  );
}

/** A display value out of a string or a `{ name }` object (a CRM branch is either). */
const label = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : null;
  return s?.trim() || null;
};

/** The query and the distinct contacts a crm_search_contacts result matched; null without a contact list. */
export function contactSearch(args: Record<string, unknown>, structured: Record<string, unknown> | undefined): CrmContactSearch | null {
  const rows = Array.isArray(structured?.contacts) ? (structured.contacts as unknown[]) : null;
  if (!rows) return null;
  const contacts: CrmContactMatch[] = [];
  for (const row of rows) {
    const c = row as Record<string, unknown> | null;
    if (!c || typeof c.id !== "string" || contacts.some((x) => x.id === c.id)) continue;
    contacts.push({ id: c.id, name: label(c.name), branch: label(c.branch), status: label(c.status) });
  }
  return { query: typeof args.query === "string" ? args.query.trim() : "", contacts };
}
