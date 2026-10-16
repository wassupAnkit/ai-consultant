/**
 * `chat_turns` is the fine-tuning corpus, so a consultant's Gmail and Drive content must not be
 * copied into it. For Gmail/Drive evidence we keep the id, title and url (so the turn is still
 * auditable) plus a sha256 of the body, and blank the body itself. The consultant's own session
 * history keeps the excerpts: that is their data, shown back to them.
 */
import type { WorkspaceService } from "./types";

const WORKSPACE = new Set<string>(["gmail", "drive", "calendar", "docs"] satisfies WorkspaceService[]);

/** The fields redaction looks at; everything else passes through untouched. */
export interface RedactableEvidence {
  kind?: string | null;
  source?: string | null;
  matchedBy?: readonly string[] | null;
  content?: string;
  excerpt?: string;
}

/**
 * True for evidence whose body stays out of `chat_turns`: a consultant's Gmail, Drive, Calendar or
 * Docs, and student identity documents attached in chat (kind/source "document").
 */
export function isWorkspaceEvidence(item: RedactableEvidence): boolean {
  if (item.kind === "document" || item.source === "document") return true;
  if (item.kind && WORKSPACE.has(item.kind)) return true;
  const source = (item.source ?? "").toLowerCase();
  if (WORKSPACE.has(source) || /^(gmail|drive|calendar|docs):/.test(source)) return true;
  return Boolean(item.matchedBy?.some((m) => WORKSPACE.has(m)));
}

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/**
 * Copy of `items` with Gmail/Drive bodies (`content`, `excerpt`) replaced by "" and a
 * `contentSha256` of the original body (content when present, else excerpt) added.
 * Other items are returned as the same objects.
 */
export function redactWorkspaceEvidence<T extends RedactableEvidence>(items: readonly T[]): (T & { contentSha256?: string })[] {
  return items.map((item) => {
    if (!isWorkspaceEvidence(item)) return item;
    const body = typeof item.content === "string" && item.content ? item.content : (item.excerpt ?? "");
    return {
      ...item,
      ...("content" in item ? { content: "" } : {}),
      ...("excerpt" in item ? { excerpt: "" } : {}),
      contentSha256: sha256(body),
    };
  });
}

const isWorkspaceTool = (name: string) => /^(gmail|drive|calendar|docs)_/.test(name);
/** Proposal summaries that quote a consultant's mail, calendar or file content. */
const WORKSPACE_PROPOSAL = /^(Gmail draft|Calendar event|Google Doc|Google Sheet)/;

/**
 * The research trace of a turn that read Gmail or Drive, fit for `chat_turns`. The planner's
 * thoughts and closing notes paraphrase what it read, draft proposals quote the body, and the
 * Gmail/Drive call arguments name people and threads, so all of those are dropped. The trace is
 * marked `workspaceRedacted` so a corpus export can skip the turn: its answer can still quote mail.
 * A trace that touched neither service is returned unchanged.
 */
export function redactWorkspaceTrace<T extends { toolCalls: { tool: string; args: Record<string, unknown> }[]; thoughts?: unknown[]; notes: string | null; proposals?: string[] }>(
  trace: T | null,
): (T & { workspaceRedacted?: true }) | null {
  if (!trace || !trace.toolCalls.some((c) => isWorkspaceTool(c.tool))) return trace;
  return {
    ...trace,
    toolCalls: trace.toolCalls.map((c) => (isWorkspaceTool(c.tool) ? { ...c, args: {} } : c)),
    ...(trace.thoughts ? { thoughts: [] } : {}),
    notes: trace.notes === null ? null : "[redacted: this turn used Gmail, Drive, Calendar or Docs]",
    ...(trace.proposals ? { proposals: trace.proposals.map((p) => (WORKSPACE_PROPOSAL.test(p) ? `${WORKSPACE_PROPOSAL.exec(p)![1]} [redacted]` : p)) } : {}),
    workspaceRedacted: true,
  };
}
