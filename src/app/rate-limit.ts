/**
 * In-process token bucket keyed by API caller (user id, API key hash or IP).
 * Good for a single replica or as a per-pod ceiling behind the ALB/WAF rate
 * rules; swap for a shared store if strict global limits are required.
 */
export interface RateLimiter {
  take(key: string): { ok: boolean; retryAfterSeconds: number; remaining: number };
}

export function createTokenBucketLimiter(opts: { perMinute: number; burst?: number; now?: () => number }): RateLimiter {
  const capacity = opts.burst ?? opts.perMinute;
  const refillPerMs = opts.perMinute / 60_000;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; updated: number }>();

  // Periodically drop idle buckets so the map cannot grow without bound.
  const sweeper = setInterval(() => {
    const cutoff = now() - 10 * 60_000;
    for (const [k, b] of buckets) if (b.updated < cutoff) buckets.delete(k);
  }, 60_000);
  if (typeof sweeper === "object" && "unref" in sweeper) (sweeper as { unref(): void }).unref();

  return {
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? { tokens: capacity, updated: t };
      b.tokens = Math.min(capacity, b.tokens + (t - b.updated) * refillPerMs);
      b.updated = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        buckets.set(key, b);
        return { ok: true, retryAfterSeconds: 0, remaining: Math.floor(b.tokens) };
      }
      buckets.set(key, b);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000)), remaining: 0 };
    },
  };
}
