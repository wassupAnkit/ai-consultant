import type { ActivityEventDoc, ChatTurnDoc, TurnFeedback } from "../db/mongo";
import type { ActivityStore } from "./store";

/** Test double: keeps everything in arrays. */
export class InMemoryActivityStore implements ActivityStore {
  readonly turns: ChatTurnDoc[] = [];
  readonly events: ActivityEventDoc[] = [];

  async insertTurns(docs: ChatTurnDoc[]) {
    this.turns.push(...docs);
  }
  async insertEvents(docs: ActivityEventDoc[]) {
    this.events.push(...docs);
  }
  async attachFeedback(requestId: string, fb: TurnFeedback) {
    let n = 0;
    for (const t of this.turns) {
      if (t.requestId !== requestId) continue;
      t.feedback.push(fb);
      t.feedbackScore = fb.score;
      n++;
    }
    return n;
  }
  turnsFor(requestId: string) {
    return this.turns.filter((t) => t.requestId === requestId);
  }
  eventsOf(type: string) {
    return this.events.filter((e) => e.type === type);
  }
}
