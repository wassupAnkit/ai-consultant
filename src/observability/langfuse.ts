import { LangfuseClient } from "@langfuse/client";
import { CallbackHandler } from "@langfuse/langchain";
import { getActiveTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import type { Env } from "../config/env";
import { logger } from "./logger";

let client: LangfuseClient | null = null;

/** Langfuse client for prompts, scores and datasets. Null when not configured. */
export function getLangfuse(env: Env): LangfuseClient | null {
  if (!env.LANGFUSE_ENABLED) return null;
  client ??= new LangfuseClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
  });
  return client;
}

export interface TraceContext {
  sessionId: string;
  userId?: string;
  requestId: string;
  route: string;
  metadata?: Record<string, unknown>;
}

/** Per-request LangChain callback handler (cheap to construct in v5). */
export function createTraceHandler(env: Env, ctx: TraceContext): CallbackHandler | null {
  if (!env.LANGFUSE_ENABLED) return null;
  return new CallbackHandler({
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    tags: ["edge", ctx.route],
  });
}

/**
 * Run `fn` inside a root Langfuse observation so every LangChain span of the
 * turn shares one trace, and return that trace id for feedback correlation.
 * Without Langfuse configured this is a plain call with a null trace id.
 */
export async function runTraced<T>(
  env: Env,
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<{ result: T; traceId: string | null }> {
  if (!env.LANGFUSE_ENABLED) return { result: await fn(), traceId: null };
  return propagateAttributes(
    {
      traceName: "chat",
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      tags: ["edge", ctx.route],
      metadata: { requestId: ctx.requestId, ...stringify(ctx.metadata) },
    },
    async () =>
      startActiveObservation(
        "chat",
        async (span) => {
          const traceId = getActiveTraceId() ?? span.traceId ?? null;
          const result = await fn();
          return { result, traceId };
        },
        { asType: "agent" },
      ),
  );
}

function stringify(meta?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta ?? {})) out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

/** Record end-user feedback as a Langfuse score on the given trace. */
export async function recordFeedback(
  env: Env,
  input: { traceId: string; value: number; comment?: string; name?: string },
): Promise<boolean> {
  const lf = getLangfuse(env);
  if (!lf) return false;
  try {
    lf.score.create({
      traceId: input.traceId,
      name: input.name ?? "user_feedback",
      value: input.value,
      comment: input.comment,
      dataType: "NUMERIC",
    });
    await lf.flush();
    return true;
  } catch (err) {
    logger.warn("failed to record Langfuse score", { err: (err as Error).message });
    return false;
  }
}

export async function shutdownLangfuse() {
  try {
    await client?.shutdown();
  } finally {
    client = null;
  }
}
