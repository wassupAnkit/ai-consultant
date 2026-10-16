import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { Env } from "../config/env";
import { logger } from "./logger";

let sdk: NodeSDK | null = null;
let processor: LangfuseSpanProcessor | null = null;

/**
 * Start OpenTelemetry with the Langfuse span processor. Safe to call when
 * Langfuse is not configured (no-op). Must run before the graph handles traffic.
 */
export function startTelemetry(env: Env) {
  if (sdk || !env.LANGFUSE_ENABLED) return;
  processor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? env.NODE_ENV,
    release: env.APP_RELEASE,
  });
  sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  logger.info("telemetry started", { exporter: "langfuse", baseUrl: env.LANGFUSE_BASE_URL });
}

export async function flushTelemetry() {
  await processor?.forceFlush();
}

export async function shutdownTelemetry() {
  try {
    await processor?.forceFlush();
    await sdk?.shutdown();
  } catch (err) {
    logger.warn("telemetry shutdown failed", { err });
  } finally {
    sdk = null;
    processor = null;
  }
}
