import type { RetrievedChunk } from "../retrieval/store";
import { EvidenceCollector } from "../tools/evidence";
import type { EvidenceItem, ResearchTrace, ThoughtSegment, ToolCallRecord } from "../tools/types";

/** What one comparison branch gathered: its own collector and trace, for one country. */
export interface BranchOutcome {
  country: string;
  collector: EvidenceCollector;
  trace: ResearchTrace;
}

/**
 * Merge per-country evidence into one numbered list for the answer prompt. A guided session's
 * CRM record stays [1]; then the branches are interleaved round-robin in route order (first item
 * of each country, then the second, …), so every country gets a fair share of `max` and a
 * country that runs out leaves its share to the others. Duplicates (the collector's own key:
 * URL + content hash) are dropped wherever they recur, and citations are renumbered 1..k.
 */
export function mergeEvidence(branches: readonly { country: string; items: readonly EvidenceItem[] }[], opts: { max: number; guideRecord?: RetrievedChunk | null }): EvidenceCollector {
  const merged = new EvidenceCollector(opts.max);
  if (opts.guideRecord) merged.add([opts.guideRecord], "crm", false);
  const queues = branches.map((b) => [...b.items]);
  while (!merged.full && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (merged.full) break;
      // A duplicate does not use up the country's turn: take its next item instead.
      while (q.length) {
        const item = q.shift()!;
        if (merged.add([item], item.kind, item.live).length) break;
      }
    }
  }
  return merged;
}

/** One branch's line in the combined research notes. */
function branchNote(trace: ResearchTrace): string {
  if (trace.notes) return trace.notes;
  if (trace.error) return `research stopped early (${trace.error})`;
  if (trace.budgetExceeded) return "ran out of time";
  return "no closing note";
}

/**
 * Combine comparison branches into the single collector and trace the rest of the turn reads:
 * evidence as `mergeEvidence`; rounds = the most any branch ran; tool calls concatenated in
 * branch order, each tagged with its country; thoughts kept in place on that combined timeline;
 * live URLs unioned; notes and errors per country ("australia: …; canada: …").
 */
export function mergeBranches(branches: readonly BranchOutcome[], opts: { maxEvidence: number; guideRecord?: RetrievedChunk | null }): { collector: EvidenceCollector; trace: ResearchTrace } {
  const collector = mergeEvidence(
    branches.map((b) => ({ country: b.country, items: b.collector.items })),
    { max: opts.maxEvidence, guideRecord: opts.guideRecord ?? null },
  );
  const toolCalls: ToolCallRecord[] = [];
  const thoughts: ThoughtSegment[] = [];
  for (const b of branches) {
    const offset = toolCalls.length;
    for (const t of b.trace.thoughts ?? []) thoughts.push({ at: t.at + offset, text: t.text });
    for (const call of b.trace.toolCalls) toolCalls.push({ ...call, country: b.country });
  }
  const errors = branches.filter((b) => b.trace.error).map((b) => `${b.country}: ${b.trace.error}`);
  const trace: ResearchTrace = {
    rounds: Math.max(0, ...branches.map((b) => b.trace.rounds)),
    budgetExceeded: branches.some((b) => b.trace.budgetExceeded),
    toolCalls,
    liveUrls: [...new Set(branches.flatMap((b) => b.trace.liveUrls))],
    notes: branches.length ? branches.map((b) => `${b.country}: ${branchNote(b.trace)}`).join("; ") : null,
    error: errors.length ? errors.join("; ") : null,
  };
  if (thoughts.length) trace.thoughts = thoughts;
  return { collector, trace };
}
