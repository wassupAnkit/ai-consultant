import type { ActivityEventDoc, ChatTurnDoc, TurnFeedback } from "../db/mongo";
import type { Logger } from "../observability/logger";
import { hashUser } from "./identity";
import type { ActivityStore } from "./store";

export type ActivityEventInput = Partial<Omit<ActivityEventDoc, "type" | "createdAt" | "userHash">> & { type: string };
export type ChatTurnInput = Omit<ChatTurnDoc, "userHash" | "createdAt" | "feedback" | "feedbackScore" | "release" | "research"> &
  Partial<Pick<ChatTurnDoc, "feedback" | "feedbackScore" | "createdAt" | "release" | "research">>;

export interface ActivityLogOptions {
  /** Flush interval. */
  flushMs?: number;
  turnBatch?: number;
  eventBatch?: number;
  /** Bounded queues: beyond this the oldest entries are dropped (and counted). */
  maxQueuedTurns?: number;
  maxQueuedEvents?: number;
  /** HMAC key for userHash; plain sha256 when unset. */
  hashSecret?: string;
  /** APP_RELEASE stamped on every document. */
  release?: string;
}

export interface ActivityLogStats {
  queuedTurns: number;
  queuedEvents: number;
  flushedTurns: number;
  flushedEvents: number;
  dropped: number;
  failedBatches: number;
}

/**
 * Buffered, fire-and-forget writer for the activity log. `event()`, `turn()`
 * and `feedback()` are synchronous pushes and never throw; batches are written
 * on a timer, when a queue reaches its batch size, and on `close()`. A failed
 * batch is retried once (so a short MongoDB blip loses nothing), then dropped.
 */
export class ActivityLog {
  private turns: ChatTurnDoc[] = [];
  private events: ActivityEventDoc[] = [];
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private lastDropWarn = 0;
  private readonly retried = new WeakSet<object>();
  private readonly stat: ActivityLogStats = { queuedTurns: 0, queuedEvents: 0, flushedTurns: 0, flushedEvents: 0, dropped: 0, failedBatches: 0 };
  private readonly o: Required<Omit<ActivityLogOptions, "hashSecret" | "release">> & Pick<ActivityLogOptions, "hashSecret" | "release">;

  constructor(
    private readonly store: ActivityStore,
    private readonly logger: Logger,
    opts: ActivityLogOptions = {},
  ) {
    this.o = {
      flushMs: opts.flushMs ?? 2_000,
      turnBatch: opts.turnBatch ?? 50,
      eventBatch: opts.eventBatch ?? 200,
      maxQueuedTurns: opts.maxQueuedTurns ?? 500,
      maxQueuedEvents: opts.maxQueuedEvents ?? 5_000,
      hashSecret: opts.hashSecret,
      release: opts.release,
    };
    this.timer = setInterval(() => void this.flush(), this.o.flushMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  hash(ownerId: string): string {
    return hashUser(ownerId, this.o.hashSecret);
  }

  event(e: ActivityEventInput): void {
    if (this.closed) return;
    const now = new Date();
    const doc: ActivityEventDoc = {
      type: e.type,
      source: e.source ?? "server",
      at: e.at ?? now,
      createdAt: now,
      requestId: e.requestId ?? null,
      sessionId: e.sessionId ?? null,
      ownerId: e.ownerId ?? null,
      userHash: e.ownerId ? this.hash(e.ownerId) : null,
      auth: e.auth ?? null,
      method: e.method ?? null,
      route: e.route ?? null,
      path: e.path ?? null,
      status: e.status ?? null,
      ms: e.ms ?? null,
      errorCode: e.errorCode ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      release: e.release ?? this.o.release ?? null,
      details: e.details ?? {},
    };
    this.push(this.events, doc, this.o.maxQueuedEvents);
    if (this.events.length >= this.o.eventBatch) void this.flush();
  }

  turn(t: ChatTurnInput): void {
    if (this.closed) return;
    const doc: ChatTurnDoc = {
      ...t,
      research: t.research ?? null,
      userHash: this.hash(t.ownerId),
      release: t.release ?? this.o.release ?? null,
      feedback: t.feedback ?? [],
      feedbackScore: t.feedbackScore ?? null,
      createdAt: t.createdAt ?? new Date(),
    };
    this.push(this.turns, doc, this.o.maxQueuedTurns);
    if (this.turns.length >= this.o.turnBatch) void this.flush();
  }

  /** Attach feedback to a turn: in place while still buffered, else in the store once any in-flight write has landed. */
  feedback(requestId: string, fb: TurnFeedback): void {
    const buffered = this.turns.filter((t) => t.requestId === requestId);
    if (buffered.length) {
      for (const t of buffered) {
        t.feedback.push(fb);
        t.feedbackScore = fb.score;
      }
      return;
    }
    (this.inflight ?? Promise.resolve())
      .then(() => this.store.attachFeedback(requestId, fb))
      .then((n) => {
        if (n === 0) this.logger.debug("feedback did not match a recorded turn", { requestId });
      })
      .catch((err) => this.logger.warn("failed to attach feedback to turn", { requestId, err }));
  }

  /** Write everything queued so far. Concurrent calls share one write. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.turns.length && !this.events.length) return Promise.resolve();
    const turns = this.turns;
    const events = this.events;
    this.turns = [];
    this.events = [];
    this.inflight = this.write(turns, events).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Stop the timer and drain. Call before closing the database client. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Up to two rounds: whatever is queued now, plus anything re-queued by a failed first attempt.
    for (let i = 0; i < 2 && (this.turns.length || this.events.length || this.inflight); i++) {
      await this.flush();
      if (this.inflight) await this.inflight;
    }
  }

  stats(): ActivityLogStats {
    return { ...this.stat, queuedTurns: this.turns.length, queuedEvents: this.events.length };
  }

  private push<T extends object>(queue: T[], doc: T, max: number) {
    queue.push(doc);
    if (queue.length > max) {
      queue.splice(0, queue.length - max);
      this.stat.dropped++;
      const now = Date.now();
      if (now - this.lastDropWarn > 60_000) {
        this.lastDropWarn = now;
        this.logger.warn("activity log queue full; dropping oldest entries", { dropped: this.stat.dropped });
      }
    }
  }

  private async write(turns: ChatTurnDoc[], events: ActivityEventDoc[]) {
    const [t, e] = await Promise.allSettled([
      turns.length ? this.store.insertTurns(turns) : Promise.resolve(),
      events.length ? this.store.insertEvents(events) : Promise.resolve(),
    ]);
    if (t.status === "fulfilled") this.stat.flushedTurns += turns.length;
    else this.requeue(this.turns, turns, this.o.maxQueuedTurns, "turns", t.reason);
    if (e.status === "fulfilled") this.stat.flushedEvents += events.length;
    else this.requeue(this.events, events, this.o.maxQueuedEvents, "events", e.reason);
  }

  private requeue<T extends object>(queue: T[], failed: T[], max: number, kind: string, err: unknown) {
    this.stat.failedBatches++;
    const retry = failed.filter((d) => !this.retried.has(d));
    for (const d of retry) this.retried.add(d);
    const dropped = failed.length - retry.length;
    if (dropped) this.stat.dropped += dropped;
    if (this.closed) {
      this.stat.dropped += retry.length;
      this.logger.error(`activity log: failed to write ${kind} during shutdown`, { count: failed.length, err });
      return;
    }
    queue.unshift(...retry);
    if (queue.length > max) {
      this.stat.dropped += queue.length - max;
      queue.splice(max);
    }
    this.logger.error(`activity log: failed to write ${kind}; will retry once`, { count: failed.length, retrying: retry.length, err });
  }
}
