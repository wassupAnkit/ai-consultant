import { sha256 } from "../activity/identity";
import type { RetrievedChunk } from "../retrieval/store";
import type { EvidenceItem, EvidenceKind } from "./types";

/**
 * Accumulates evidence across research rounds with stable citation numbers,
 * de-duplication (same URL + same content) and a hard cap so the prompt stays
 * within budget no matter how many tool calls the model makes.
 */
export class EvidenceCollector {
  readonly items: EvidenceItem[] = [];
  private readonly keys = new Set<string>();

  /** The last citation number handed out: a resumed collector continues after its highest, gaps and all. */
  private lastN = 0;

  constructor(readonly max = 24) {}

  /**
   * A collector that continues from evidence gathered earlier, keeping each item's number, so
   * numbers already shown to a model stay valid and new items are numbered after the highest.
   */
  static resume(items: readonly EvidenceItem[], max = 24): EvidenceCollector {
    const collector = new EvidenceCollector(max);
    for (const item of items) {
      collector.keys.add(`${item.url}#${sha256(item.content.trim())}`);
      collector.items.push(item);
      collector.lastN = Math.max(collector.lastN, item.n);
    }
    return collector;
  }

  get full() {
    return this.items.length >= this.max;
  }

  /** Add chunks as evidence; returns only the items that were actually new. */
  add(chunks: (RetrievedChunk & Partial<Pick<EvidenceItem, "fetchedAt" | "crmSearch">>)[], kind: EvidenceKind, live: boolean): EvidenceItem[] {
    const added: EvidenceItem[] = [];
    for (const c of chunks) {
      if (this.items.length >= this.max) break;
      const key = `${c.url}#${sha256(c.content.trim())}`;
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      const item: EvidenceItem = { ...c, n: ++this.lastN, kind, live, ...(c.fetchedAt ? { fetchedAt: c.fetchedAt } : {}) };
      this.items.push(item);
      added.push(item);
    }
    return added;
  }

  /** Compact rendering of new items for the research model (it sees the full text only in the final prompt). */
  static summaryForModel(items: EvidenceItem[], maxChars = 500): string {
    if (!items.length) return "No new evidence (everything returned was already collected, or nothing matched).";
    return items
      .map((i) => {
        const head = `[${i.n}] ${i.title}${i.section ? ` — ${i.section}` : ""} (${i.url})${i.live ? " [live]" : ""}`;
        const body = i.content.length > maxChars ? i.content.slice(0, maxChars).replace(/\s+\S*$/, "") + " …" : i.content;
        return `${head}\n${body}`;
      })
      .join("\n\n");
  }

  liveUrls(): string[] {
    return [...new Set(this.items.filter((i) => i.live).map((i) => i.url))];
  }
}
