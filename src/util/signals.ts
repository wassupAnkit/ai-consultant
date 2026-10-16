/** AbortSignal helpers shared by the graph nodes and live lookups. */

export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** The given signal (if any) combined with a timeout. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return combineSignals(signal, AbortSignal.timeout(Math.max(1, Math.round(ms))))!;
}
