import type { ActivityEventDoc, ChatTurnDoc, Collections, TurnFeedback } from "../db/mongo";
import type { ActivityStore } from "./store";

export class MongoActivityStore implements ActivityStore {
  constructor(private readonly c: Pick<Collections, "chatTurns" | "activityEvents">) {}

  async insertTurns(docs: ChatTurnDoc[]) {
    if (docs.length) await this.c.chatTurns.insertMany(docs, { ordered: false });
  }

  async insertEvents(docs: ActivityEventDoc[]) {
    if (docs.length) await this.c.activityEvents.insertMany(docs, { ordered: false });
  }

  /** requestId can be client-supplied (x-request-id), so it is not assumed unique. */
  async attachFeedback(requestId: string, fb: TurnFeedback) {
    const res = await this.c.chatTurns.updateMany({ requestId }, { $push: { feedback: fb }, $set: { feedbackScore: fb.score } });
    return res.matchedCount;
  }
}
