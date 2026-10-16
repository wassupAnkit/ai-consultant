import type { GuideState, GuideSuggestion } from "../journey/guide";

export interface StoredMessage {
  role: "human" | "ai";
  content: string;
  intent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface Session {
  id: string;
  ownerId: string;
  title: string | null;
  /** True once the owner named the session themselves; the automatic title then leaves it alone. */
  titleSetByUser?: boolean;
  /** Owner pinned this conversation. Absent on sessions stored before pinning existed. */
  pinned?: boolean;
  messageCount: number;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  /** Free-form session metadata (e.g. `mode` of the first turn). */
  metadata?: Record<string, unknown>;
  /** Present on guided sessions: the CRM student it is about and the journey progress (never student facts). */
  guide?: GuideState;
}

/** What the owner may change about a session. Absent fields are left as they are. */
export interface SessionPatch {
  title?: string;
  pinned?: boolean;
}

/**
 * Conversation persistence. Sessions are owner-scoped: a caller can only read
 * sessions created under the same ownerId (API user id or "anonymous").
 * Owner mismatch behaves like "not found" so ids cannot be enumerated.
 */
export interface ChatStore {
  getOrCreateSession(id: string | undefined, ownerId: string): Promise<Session>;
  getSession(id: string, ownerId: string): Promise<Session | null>;
  /** Most recently active, unexpired session for an owner (used when the client sends no sessionId). */
  getLatestSession(ownerId: string): Promise<Session | null>;
  /** Unexpired sessions for an owner, most recently active first. */
  listSessions(ownerId: string, limit: number): Promise<Session[]>;
  /** Newest `limit` messages, returned oldest → newest. */
  getMessages(sessionId: string, limit: number): Promise<StoredMessage[]>;
  /** `title` is applied only when the session has none yet and the owner has not named it; `mode` is recorded in session metadata. */
  append(sessionId: string, messages: StoredMessage[], opts?: { title?: string; mode?: string }): Promise<void>;
  /** Rename / pin. Owner-scoped like the rest: someone else's session reads as absent (null). */
  updateSession(id: string, ownerId: string, patch: SessionPatch): Promise<Session | null>;
  /**
   * The model-written title. Unlike `updateSession` it does not mark the title as the owner's,
   * and it steps aside when the owner has already named the session. Returns whether it wrote.
   */
  setAutoTitle(id: string, ownerId: string, title: string): Promise<boolean>;
  /** Merge fields into the metadata of the assistant turn recorded under `requestId` (e.g. follow-ups produced after the answer). */
  setTurnMetadata(sessionId: string, requestId: string, patch: Record<string, unknown>): Promise<boolean>;
  /**
   * Drop the newest turn so it can be answered again: the last assistant message and the
   * human message before it (or just a trailing human message). Returns how many were removed.
   */
  removeLastTurn(sessionId: string, ownerId: string): Promise<number>;
  deleteSession(id: string, ownerId: string): Promise<boolean>;
  /**
   * Make a session guided: attach `guide` and keep the session and its messages until the owner
   * deletes them. One-way; a session that is already guided is left as it is. `title` is applied
   * unless the owner named the session. Returns the session as stored, or null when absent.
   */
  startGuide(id: string, ownerId: string, guide: GuideState, opts?: { title?: string }): Promise<Session | null>;
  /** Replace the journey state of a guided session. Null when absent or not guided. */
  setGuide(id: string, ownerId: string, guide: GuideState): Promise<Session | null>;
  /**
   * Edge's suggestion after an answer given at `atStep`. Written only if the session is still on
   * that step, so a suggestion can never land after the consultant has already moved on.
   * Null when absent, not guided, or no longer on that step.
   */
  setGuideSuggestion(id: string, ownerId: string, atStep: string, suggestion: GuideSuggestion | null): Promise<Session | null>;
  ping(): Promise<boolean>;
}
