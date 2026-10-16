import { NEVER_EXPIRES, type GuideState, type GuideSuggestion } from "../journey/guide";
import type { ChatStore, Session, SessionPatch, StoredMessage } from "./store";

type Entry = Session & { messages: StoredMessage[] };

/** Map-backed store for tests and local development. */
export class InMemoryChatStore implements ChatStore {
  private sessions = new Map<string, Entry>();
  constructor(private readonly ttlMs = 72 * 3600 * 1000) {}

  async getOrCreateSession(id: string | undefined, ownerId: string): Promise<Session> {
    const now = new Date();
    if (id) {
      const s = this.sessions.get(id);
      if (s && s.ownerId === ownerId && s.expiresAt > now) return strip(s);
    }
    const s: Entry = {
      id: id ?? crypto.randomUUID(),
      ownerId,
      title: null,
      titleSetByUser: false,
      pinned: false,
      messageCount: 0,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      metadata: {},
      messages: [],
    };
    this.sessions.set(s.id, s);
    return strip(s);
  }

  async listSessions(ownerId: string, limit: number): Promise<Session[]> {
    const now = new Date();
    return [...this.sessions.values()]
      .filter((s) => s.ownerId === ownerId && s.expiresAt > now)
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
      .slice(0, limit)
      .map(strip);
  }

  async getSession(id: string, ownerId: string) {
    const s = this.sessions.get(id);
    return s && s.ownerId === ownerId && s.expiresAt > new Date() ? strip(s) : null;
  }

  async getLatestSession(ownerId: string) {
    const now = new Date();
    let best: Entry | undefined;
    for (const s of this.sessions.values()) {
      if (s.ownerId !== ownerId || s.expiresAt <= now) continue;
      if (!best || s.lastActiveAt > best.lastActiveAt) best = s;
    }
    return best ? strip(best) : null;
  }

  async getMessages(sessionId: string, limit: number) {
    const s = this.sessions.get(sessionId);
    return s ? s.messages.slice(-limit) : [];
  }

  async append(sessionId: string, messages: StoredMessage[], opts?: { title?: string; mode?: string }) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.messages.push(...messages);
    s.messageCount = s.messages.length;
    s.lastActiveAt = new Date();
    s.expiresAt = s.guide ? NEVER_EXPIRES : new Date(Date.now() + this.ttlMs);
    // A title the owner chose always wins over the automatic one.
    if (opts?.title && !s.title && !s.titleSetByUser) s.title = opts.title;
    if (opts?.mode) s.metadata = { ...s.metadata, mode: opts.mode };
  }

  async updateSession(id: string, ownerId: string, patch: SessionPatch) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId || s.expiresAt <= new Date()) return null;
    if (patch.title !== undefined) {
      s.title = patch.title;
      s.titleSetByUser = true;
    }
    if (patch.pinned !== undefined) s.pinned = patch.pinned;
    return strip(s);
  }

  async setAutoTitle(id: string, ownerId: string, title: string) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId || s.titleSetByUser) return false;
    s.title = title;
    return true;
  }

  async setTurnMetadata(sessionId: string, requestId: string, patch: Record<string, unknown>) {
    const s = this.sessions.get(sessionId);
    const m = s?.messages.find((x) => x.role === "ai" && x.metadata?.requestId === requestId);
    if (!m) return false;
    m.metadata = { ...m.metadata, ...patch };
    return true;
  }

  async removeLastTurn(sessionId: string, ownerId: string) {
    const s = this.sessions.get(sessionId);
    if (!s || s.ownerId !== ownerId) return 0;
    let removed = 0;
    if (s.messages.at(-1)?.role === "ai") {
      s.messages.pop();
      removed++;
    }
    if (s.messages.at(-1)?.role === "human") {
      s.messages.pop();
      removed++;
    }
    s.messageCount = s.messages.length;
    return removed;
  }

  async deleteSession(id: string, ownerId: string) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId) return false;
    this.sessions.delete(id);
    return true;
  }

  async startGuide(id: string, ownerId: string, guide: GuideState, opts?: { title?: string }) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId || s.expiresAt <= new Date()) return null;
    if (!s.guide) {
      s.guide = guide;
      s.expiresAt = NEVER_EXPIRES;
      if (opts?.title && !s.titleSetByUser) s.title = opts.title;
    }
    return strip(s);
  }

  async setGuide(id: string, ownerId: string, guide: GuideState) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId || !s.guide || s.expiresAt <= new Date()) return null;
    s.guide = guide;
    return strip(s);
  }

  async setGuideSuggestion(id: string, ownerId: string, atStep: string, suggestion: GuideSuggestion | null) {
    const s = this.sessions.get(id);
    if (!s || s.ownerId !== ownerId || !s.guide || s.guide.currentStep !== atStep || s.expiresAt <= new Date()) return null;
    s.guide = { ...s.guide, suggestion };
    return strip(s);
  }

  async ping() {
    return true;
  }
}

function strip(s: Entry): Session {
  const { messages: _m, ...rest } = s;
  return rest;
}
