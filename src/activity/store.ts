import type { ActivityEventDoc, ChatTurnDoc, TurnFeedback } from "../db/mongo";

/**
 * Durable activity persistence. Implementations must be safe to call
 * concurrently and should never throw for a single bad document.
 */
export interface ActivityStore {
  insertTurns(docs: ChatTurnDoc[]): Promise<void>;
  insertEvents(docs: ActivityEventDoc[]): Promise<void>;
  /** Attach end-user feedback to the turn(s) with this requestId. Returns matched count. */
  attachFeedback(requestId: string, fb: TurnFeedback): Promise<number>;
}
