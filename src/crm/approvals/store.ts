/**
 * Persistence for CRM write proposals. A proposal outlives the turn that made it (the counsellor
 * decides after the answer has streamed, possibly after a reload), so it cannot live in memory
 * of the request. Status changes go through `transition`, a compare-and-set, so two approve
 * clicks can never both reach the CRM (or create two Gmail drafts). Every read fills in
 * `provider`, which rows stored before Gmail drafts existed do not have.
 */
import { withProvider, type CrmWriteProposal, type CrmWriteStatus } from "./types";

export type CrmWriteProposalPatch = Partial<Pick<CrmWriteProposal, "status" | "decidedAt" | "error" | "current" | "result" | "args" | "originalArgs" | "preview" | "edited">>;

export interface CrmWriteProposalStore {
  create(p: CrmWriteProposal): Promise<void>;
  get(id: string): Promise<CrmWriteProposal | null>;
  /** Atomic compare-and-set: moves the proposal from `from` to `patch.status` only if it is still `from`. Returns the updated proposal, or null when it was not in `from`. */
  transition(id: string, from: CrmWriteStatus, patch: CrmWriteProposalPatch): Promise<CrmWriteProposal | null>;
  /** Every `pending` proposal of the session becomes `expired`; returns how many. */
  expireSession(sessionId: string, now: Date): Promise<number>;
  listForSession(sessionId: string): Promise<CrmWriteProposal[]>;
}

/** Map-backed store for tests and Mongo-less runs. Copies in and out, like a real database. */
export class InMemoryCrmWriteProposalStore implements CrmWriteProposalStore {
  private readonly rows = new Map<string, CrmWriteProposal>();

  async create(p: CrmWriteProposal): Promise<void> {
    if (this.rows.has(p.id)) throw new Error(`proposal ${p.id} already exists`);
    this.rows.set(p.id, structuredClone(p));
  }

  async get(id: string): Promise<CrmWriteProposal | null> {
    const row = this.rows.get(id);
    return row ? withProvider(structuredClone(row)) : null;
  }

  // Synchronous between the check and the set, so it is atomic on the single JS thread.
  async transition(id: string, from: CrmWriteStatus, patch: CrmWriteProposalPatch): Promise<CrmWriteProposal | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== from) return null;
    const next = { ...row, ...structuredClone(patch) };
    this.rows.set(id, next);
    return withProvider(structuredClone(next));
  }

  async expireSession(sessionId: string, now: Date): Promise<number> {
    let n = 0;
    for (const [id, row] of this.rows) {
      if (row.sessionId !== sessionId || row.status !== "pending") continue;
      this.rows.set(id, { ...row, status: "expired", decidedAt: new Date(now) });
      n++;
    }
    return n;
  }

  async listForSession(sessionId: string): Promise<CrmWriteProposal[]> {
    return [...this.rows.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => withProvider(structuredClone(r)));
  }
}
