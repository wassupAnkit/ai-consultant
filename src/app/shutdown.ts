import type { Logger } from "../observability/logger";

export interface ShutdownDeps {
  /** Refuse new work and wait for in-flight requests, up to `ms` (the app's `shutdown`). */
  drain(ms: number): Promise<void>;
  /** Flush buffered activity, traces and close MongoDB, once the requests are done. */
  flush(): Promise<void>;
  /** SHUTDOWN_DRAIN_MS (or its derived default). */
  drainMs: number;
  /** Extra time the flush may take before the hard exit. */
  flushMs?: number;
  logger: Pick<Logger, "info" | "error">;
  exit(code: number): void;
}

/** Time allowed for the post-drain flush (activity, Langfuse, OTel, MongoDB). */
export const SHUTDOWN_FLUSH_MS = 15_000;

/**
 * The SIGTERM/SIGINT handler. Kubernetes runs the preStop sleep first (the ALB deregisters the
 * target meanwhile), then signals: drain in-flight requests for up to `drainMs`, flush, exit.
 * A hard exit at drain + flush keeps a hung flush from outliving terminationGracePeriodSeconds.
 * Only the first signal counts.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const flushMs = deps.flushMs ?? SHUTDOWN_FLUSH_MS;
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    deps.logger.info(`${signal} received; draining in-flight requests`, { drainMs: deps.drainMs, flushMs });
    const hardExit = setTimeout(() => {
      deps.logger.error("shutdown timed out; forcing exit", { drainMs: deps.drainMs, flushMs });
      deps.exit(1);
    }, deps.drainMs + flushMs);
    try {
      await deps.drain(deps.drainMs);
      await deps.flush();
      clearTimeout(hardExit);
      deps.logger.info("shutdown complete");
      deps.exit(0);
    } catch (err) {
      clearTimeout(hardExit);
      deps.logger.error("shutdown error", { err });
      deps.exit(1);
    }
  };
}
