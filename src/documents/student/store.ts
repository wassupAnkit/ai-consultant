/**
 * Records of student documents (`student_documents`). Never deleted and never given a TTL: the
 * contract keeps every upload, extraction run and CRM proposal made from it. Dedupe is per owner
 * (a unique `{ ownerId, sha256 }` index), never global, so one counsellor's upload never reveals
 * that another uploaded the same file.
 */
import type { Collection, IndexDescription } from "mongodb";
import type { DocumentCrmAction, ExtractionRun, StudentDocumentRecord } from "./types";

export const STUDENT_DOCUMENTS_COLLECTION = "student_documents";
export const STUDENT_FILES_BUCKET = "student_files";

export interface StudentDocumentStore {
  /** Inserts; on a concurrent duplicate (same owner and sha256) returns the record that won. */
  create(rec: StudentDocumentRecord): Promise<StudentDocumentRecord>;
  get(id: string): Promise<StudentDocumentRecord | null>;
  findByOwnerSha(ownerId: string, sha256: string): Promise<StudentDocumentRecord | null>;
  listByIds(ids: readonly string[]): Promise<StudentDocumentRecord[]>;
  addExtraction(id: string, run: ExtractionRun, contactId?: string | null): Promise<void>;
  addCrmActions(id: string, actions: readonly DocumentCrmAction[]): Promise<void>;
}

export class InMemoryStudentDocumentStore implements StudentDocumentStore {
  readonly rows = new Map<string, StudentDocumentRecord>();

  async create(rec: StudentDocumentRecord) {
    const existing = await this.findByOwnerSha(rec.ownerId, rec.sha256);
    if (existing) return existing;
    this.rows.set(rec._id, structuredClone(rec));
    return structuredClone(rec);
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async findByOwnerSha(ownerId: string, sha256: string) {
    for (const r of this.rows.values()) if (r.ownerId === ownerId && r.sha256 === sha256) return structuredClone(r);
    return null;
  }

  async listByIds(ids: readonly string[]) {
    return ids.map((id) => this.rows.get(id)).filter((r): r is StudentDocumentRecord => Boolean(r)).map((r) => structuredClone(r));
  }

  async addExtraction(id: string, run: ExtractionRun, contactId?: string | null) {
    const r = this.rows.get(id);
    if (!r) return;
    r.extractions.push(structuredClone(run));
    if (contactId) r.contactId = contactId;
  }

  async addCrmActions(id: string, actions: readonly DocumentCrmAction[]) {
    const r = this.rows.get(id);
    if (r) r.crmActions.push(...structuredClone([...actions]));
  }
}

export class MongoStudentDocumentStore implements StudentDocumentStore {
  constructor(private readonly collection: Collection<StudentDocumentRecord>) {}

  async create(rec: StudentDocumentRecord) {
    try {
      await this.collection.insertOne(rec);
      return rec;
    } catch (err) {
      // 11000: a concurrent upload of the same file by the same owner won the race.
      if ((err as { code?: number }).code !== 11000) throw err;
      const existing = await this.findByOwnerSha(rec.ownerId, rec.sha256);
      if (!existing) throw err;
      return existing;
    }
  }

  get(id: string) {
    return this.collection.findOne({ _id: id });
  }

  findByOwnerSha(ownerId: string, sha256: string) {
    return this.collection.findOne({ ownerId, sha256 });
  }

  listByIds(ids: readonly string[]) {
    return ids.length ? this.collection.find({ _id: { $in: [...ids] } }).toArray() : Promise.resolve([]);
  }

  async addExtraction(id: string, run: ExtractionRun, contactId?: string | null) {
    await this.collection.updateOne({ _id: id }, { $push: { extractions: run }, ...(contactId ? { $set: { contactId } } : {}) });
  }

  async addCrmActions(id: string, actions: readonly DocumentCrmAction[]) {
    if (!actions.length) return;
    await this.collection.updateOne({ _id: id }, { $push: { crmActions: { $each: [...actions] } } });
  }
}

/** Per-owner dedupe (unique), the owner's recent uploads, and lookups by session and student. No TTL. */
export const STUDENT_DOCUMENT_INDEXES: IndexDescription[] = [
  { key: { ownerId: 1, sha256: 1 }, unique: true, name: "owner_sha256_unique" },
  { key: { ownerId: 1, createdAt: -1 } },
  { key: { sessionId: 1 } },
  { key: { contactId: 1 } },
];
