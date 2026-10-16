/**
 * The note the model sees on the next turn about CRM writes and Gmail drafts it proposed earlier.
 * It is appended to the copy of the stored assistant message passed to the model, never to the
 * stored message, so the model neither claims a rejected change was made nor proposes an applied one again.
 */
import type { CrmWriteProposalView } from "./types";

/** Gmail drafts are saved, never sent, so the note says so rather than "the CRM applied". */
function gmailLine(v: CrmWriteProposalView): string | null {
  const what = `Gmail draft "${v.target.label}"${v.target.parentLabel ? ` to ${v.target.parentLabel}` : ""}`;
  switch (v.status) {
    case "pending":
    case "applying":
      return null;
    case "applied":
      return `The consultant approved and the ${what} was saved to their Drafts. It was not sent.`;
    case "rejected":
      return `The consultant rejected the ${what}. It was not saved.`;
    case "expired":
    case "stale":
      return `The ${what} expired without a decision and was not saved.`;
    case "failed":
      return `The ${what} could not be saved: ${v.error ?? "unknown error"}.`;
  }
}

/** Calendar events and new Docs/Sheets: what happened, in the counsellor's terms. */
function workspaceLine(v: CrmWriteProposalView): string | null {
  const what = v.provider === "calendar" ? `calendar event "${v.target.label}"` : `${v.target.entity === "googleSheet" ? "Google Sheet" : "Google Doc"} "${v.target.label}"`;
  const done = v.provider === "calendar" ? "was added to their calendar (any attendees were emailed an invite by Google)" : "was created in their Drive, private to them";
  switch (v.status) {
    case "pending":
    case "applying":
      return null;
    case "applied":
      return `The consultant approved and the ${what} ${done}.`;
    case "rejected":
      return `The consultant rejected the ${what}. Nothing was created.`;
    case "expired":
    case "stale":
      return `The ${what} expired without a decision. Nothing was created.`;
    case "failed":
      return `The ${what} could not be created: ${v.error ?? "unknown error"}.`;
  }
}

function line(v: CrmWriteProposalView): string | null {
  if (v.provider === "gmail") return gmailLine(v);
  if (v.provider === "calendar" || v.provider === "docs") return workspaceLine(v);
  const what = `${v.tool} on ${v.target.label}`;
  switch (v.status) {
    case "pending":
    case "applying":
      return null;
    case "applied":
      return `The counsellor approved and the CRM applied: ${what}.`;
    case "rejected":
      return `The counsellor rejected: ${what}. It was not applied.`;
    case "expired":
      return `${what} expired without a decision and was not applied.`;
    case "stale":
      return `${what} was not applied because the record had changed.`;
    case "failed":
      return `${what} failed in the CRM: ${v.error ?? "unknown error"}.`;
  }
}

export function decisionNote(views: CrmWriteProposalView[]): string | null {
  const lines = views.map(line).filter((l): l is string => l !== null);
  return lines.length ? `[CRM write decisions]\n${lines.join("\n")}` : null;
}

/**
 * Copies of the stored messages with each assistant turn's decision note appended, for the model's
 * history window only. The answer is shortened first when needed so the note survives the
 * window's per-message cap (`toWindowedMessages`' `maxCharsPerMessage`, 3,000 by default).
 */
export function withDecisionNotes<M extends { role: string; content: string; metadata?: Record<string, unknown> }>(
  messages: M[],
  viewsByRequest: Map<string, CrmWriteProposalView[]>,
  maxCharsPerMessage = 3_000,
): M[] {
  if (!viewsByRequest.size) return messages;
  return messages.map((m) => {
    const views = m.role === "ai" ? viewsByRequest.get(String(m.metadata?.requestId)) : undefined;
    const note = views ? decisionNote(views) : null;
    if (!note) return m;
    const suffix = `\n\n${note}`;
    const room = Math.max(0, maxCharsPerMessage - suffix.length - 2);
    const content = m.content.length > room ? `${m.content.slice(0, room)} …` : m.content;
    return { ...m, content: content + suffix };
  });
}
