/**
 * Mongo-backed CRM write proposals, in `crm_write_proposals`. Fetched with `db.collection(...)`
 * here rather than registered in src/db/mongo.ts, so this feature stays in its own files.
 */
import type { Collection, Db } from "mongodb";
import type { CrmWriteProposalPatch, CrmWriteProposalStore } from "./store";
import { withProvider, type CrmWriteProposal, type CrmWriteStatus } from "./types";

export const CRM_WRITE_PROPOSALS_COLLECTION = "crm_write_proposals";

/** Rows written before Gmail drafts existed have no `provider`; they are CRM writes. */
export type CrmWriteProposalDoc = CrmWriteProposal & { _id: string };

const fromDoc = (doc: CrmWriteProposalDoc | null): CrmWriteProposal | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return withProvider({ ...rest, id: _id });
};

export class MongoCrmWriteProposalStore implements CrmWriteProposalStore {
  constructor(private readonly collection: Collection<CrmWriteProposalDoc>) {}

  async create(p: CrmWriteProposal): Promise<void> {
    await this.collection.insertOne({ ...p, _id: p.id });
  }

  async get(id: string): Promise<CrmWriteProposal | null> {
    return fromDoc(await this.collection.findOne({ _id: id }));
  }

  // mongodb@6: without includeResultMetadata, findOneAndUpdate resolves to the document or null.
  async transition(id: string, from: CrmWriteStatus, patch: CrmWriteProposalPatch): Promise<CrmWriteProposal | null> {
    return fromDoc(await this.collection.findOneAndUpdate({ _id: id, status: from }, { $set: patch }, { returnDocument: "after" }));
  }

  async expireSession(sessionId: string, now: Date): Promise<number> {
    const res = await this.collection.updateMany({ sessionId, status: "pending" }, { $set: { status: "expired", decidedAt: now } });
    return res.modifiedCount;
  }

  async listForSession(sessionId: string): Promise<CrmWriteProposal[]> {
    const docs = await this.collection.find({ sessionId }).sort({ createdAt: 1 }).toArray();
    return docs.map((d) => fromDoc(d)!);
  }
}

/** `{ sessionId }` for history and expiry; TTL removes a proposal a week after it expired. */
export async function ensureCrmWriteProposalIndexes(db: Db): Promise<void> {
  await db.collection<CrmWriteProposalDoc>(CRM_WRITE_PROPOSALS_COLLECTION).createIndexes([
    { key: { sessionId: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 7 * 24 * 3600 },
  ]);
}
