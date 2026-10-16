import type { WithId } from "mongodb";
import type { ChatMessageDoc, ChatSessionDoc, Collections } from "../db/mongo";
import { NEVER_EXPIRES, type GuideState, type GuideSuggestion } from "../journey/guide";
import type { ChatStore, Session, SessionPatch, StoredMessage } from "./store";

/** MongoDB-backed conversation store. TTL indexes expire sessions and messages (guided ones carry `NEVER_EXPIRES`). */
export class MongoChatStore implements ChatStore {
  constructor(
    private readonly c: Collections,
    private readonly ttlMs: number,
  ) {}

  async getOrCreateSession(id: string | undefined, ownerId: string): Promise<Session> {
    const now = new Date();
    if (id) {
      const existing = await this.c.chatSessions.findOne({ _id: id, ownerId, expiresAt: { $gt: now } });
      if (existing) return toSession(existing);
    }
    const doc: ChatSessionDoc = {
      _id: id ?? crypto.randomUUID(),
      ownerId,
      title: null,
      metadata: {},
      messageCount: 0,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
    };
    await this.c.chatSessions.insertOne(doc);
    return toSession(doc);
  }

  async getSession(id: string, ownerId: string) {
    const doc = await this.c.chatSessions.findOne({ _id: id, ownerId, expiresAt: { $gt: new Date() } });
    return doc ? toSession(doc) : null;
  }

  async getLatestSession(ownerId: string) {
    const doc = await this.c.chatSessions.findOne({ ownerId, expiresAt: { $gt: new Date() } }, { sort: { lastActiveAt: -1 } });
    return doc ? toSession(doc) : null;
  }

  async listSessions(ownerId: string, limit: number): Promise<Session[]> {
    // Served by the existing { ownerId: 1, lastActiveAt: -1 } index.
    const docs = await this.c.chatSessions
      .find({ ownerId, expiresAt: { $gt: new Date() } }, { sort: { lastActiveAt: -1 }, limit })
      .toArray();
    return docs.map(toSession);
  }

  async getMessages(sessionId: string, limit: number): Promise<StoredMessage[]> {
    const docs = await this.c.chatMessages
      .find({ sessionId, role: { $in: ["human", "ai"] } })
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
    return docs.reverse().map((d) => ({
      role: d.role as "human" | "ai",
      content: d.content,
      intent: d.intent,
      metadata: d.metadata,
      createdAt: d.createdAt,
    }));
  }

  async append(sessionId: string, messages: StoredMessage[], opts?: { title?: string; mode?: string }) {
    if (!messages.length) return;
    const now = new Date();
    // A guided session is kept until its owner deletes it, and so is every message in it.
    const guided = Boolean((await this.c.chatSessions.findOne({ _id: sessionId }, { projection: { guide: 1 } }))?.guide);
    const expiresAt = guided ? NEVER_EXPIRES : new Date(now.getTime() + this.ttlMs);
    await this.c.chatMessages.insertMany(
      messages.map((m) => ({
        sessionId,
        role: m.role,
        content: m.content,
        intent: m.intent ?? null,
        metadata: m.metadata ?? {},
        createdAt: m.createdAt ?? now,
        expiresAt,
      })),
      { ordered: true },
    );
    const set: Record<string, unknown> = { lastActiveAt: now, expiresAt };
    if (opts?.mode) set["metadata.mode"] = opts.mode;
    await this.c.chatSessions.updateOne({ _id: sessionId }, { $inc: { messageCount: messages.length }, $set: set });
    if (opts?.title) {
      // The automatic title never overwrites one the owner chose, even in the narrow window
      // where a rename lands between a turn starting and this write.
      await this.c.chatSessions.updateOne({ _id: sessionId, title: null, titleSetByUser: { $ne: true } }, { $set: { title: opts.title } });
    }
  }

  async updateSession(id: string, ownerId: string, patch: SessionPatch): Promise<Session | null> {
    const set: Partial<ChatSessionDoc> = {};
    if (patch.title !== undefined) {
      set.title = patch.title;
      set.titleSetByUser = true;
    }
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    // Nothing to change: still owner-scoped, so an unknown or foreign session reads as absent.
    if (!Object.keys(set).length) return this.getSession(id, ownerId);
    const doc = await this.c.chatSessions.findOneAndUpdate(
      { _id: id, ownerId, expiresAt: { $gt: new Date() } },
      { $set: set },
      { returnDocument: "after" },
    );
    return doc ? toSession(doc) : null;
  }

  async setAutoTitle(id: string, ownerId: string, title: string) {
    // Same guard as the first-message title in `append`, minus `title: null`: the model's
    // title replaces the provisional one but never one the owner typed.
    const res = await this.c.chatSessions.updateOne({ _id: id, ownerId, titleSetByUser: { $ne: true }, expiresAt: { $gt: new Date() } }, { $set: { title } });
    return res.matchedCount > 0;
  }

  async setTurnMetadata(sessionId: string, requestId: string, patch: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) set[`metadata.${k}`] = v;
    if (!Object.keys(set).length) return false;
    const res = await this.c.chatMessages.updateOne({ sessionId, role: "ai", "metadata.requestId": requestId }, { $set: set });
    return res.matchedCount > 0;
  }

  async removeLastTurn(sessionId: string, ownerId: string) {
    const session = await this.c.chatSessions.findOne({ _id: sessionId, ownerId }, { projection: { _id: 1 } });
    if (!session) return 0;
    const last = await this.c.chatMessages.find({ sessionId, role: { $in: ["human", "ai"] } }).sort({ _id: -1 }).limit(2).toArray();
    const ids: WithId<ChatMessageDoc>["_id"][] = [];
    if (last[0]?.role === "ai") {
      ids.push(last[0]._id);
      if (last[1]?.role === "human") ids.push(last[1]._id);
    } else if (last[0]?.role === "human") ids.push(last[0]._id);
    if (!ids.length) return 0;
    const res = await this.c.chatMessages.deleteMany({ _id: { $in: ids } });
    if (res.deletedCount) await this.c.chatSessions.updateOne({ _id: sessionId }, { $inc: { messageCount: -res.deletedCount } });
    return res.deletedCount;
  }

  async deleteSession(id: string, ownerId: string) {
    const res = await this.c.chatSessions.deleteOne({ _id: id, ownerId });
    if (res.deletedCount === 0) return false;
    await this.c.chatMessages.deleteMany({ sessionId: id });
    return true;
  }

  async startGuide(id: string, ownerId: string, guide: GuideState, opts?: { title?: string }) {
    const live = { _id: id, ownerId, expiresAt: { $gt: new Date() } };
    const res = await this.c.chatSessions.updateOne({ ...live, guide: { $exists: false } }, { $set: { guide, expiresAt: NEVER_EXPIRES } });
    if (res.modifiedCount) {
      await this.c.chatMessages.updateMany({ sessionId: id }, { $set: { expiresAt: NEVER_EXPIRES } });
      if (opts?.title) await this.c.chatSessions.updateOne({ _id: id, titleSetByUser: { $ne: true } }, { $set: { title: opts.title } });
    }
    return this.getSession(id, ownerId);
  }

  async setGuide(id: string, ownerId: string, guide: GuideState) {
    const doc = await this.c.chatSessions.findOneAndUpdate(
      { _id: id, ownerId, guide: { $exists: true }, expiresAt: { $gt: new Date() } },
      { $set: { guide } },
      { returnDocument: "after" },
    );
    return doc ? toSession(doc) : null;
  }

  async setGuideSuggestion(id: string, ownerId: string, atStep: string, suggestion: GuideSuggestion | null) {
    const doc = await this.c.chatSessions.findOneAndUpdate(
      { _id: id, ownerId, "guide.currentStep": atStep, expiresAt: { $gt: new Date() } },
      { $set: { "guide.suggestion": suggestion } },
      { returnDocument: "after" },
    );
    return doc ? toSession(doc) : null;
  }

  async ping() {
    try {
      await this.c.chatSessions.findOne({}, { projection: { _id: 1 } });
      return true;
    } catch {
      return false;
    }
  }
}

function toSession(d: ChatSessionDoc): Session {
  return {
    id: d._id,
    ownerId: d.ownerId,
    title: d.title,
    titleSetByUser: Boolean(d.titleSetByUser),
    pinned: Boolean(d.pinned),
    messageCount: d.messageCount,
    createdAt: d.createdAt,
    lastActiveAt: d.lastActiveAt,
    expiresAt: d.expiresAt,
    metadata: d.metadata ?? {},
    ...(d.guide ? { guide: d.guide } : {}),
  };
}
