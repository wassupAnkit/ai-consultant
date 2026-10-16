import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { RunnableLambda, type Runnable } from "@langchain/core/runnables";
import type { Env } from "../config/env";
import { createChatModel } from "../llm/gemini";
import { logger } from "../observability/logger";
import { redactPII } from "../safety/sanitize";
import { IntentSchema, type ClassifierExtras } from "../schemas/intent.schema";
import { composeIntent, createJevClient, type JevClient } from "./jev";

/**
 * The classifier the chat graph runs: `messages → Intent-shaped object`, optionally with an
 * `extras` member (`ClassifierExtras`) that the classify node lifts onto state.
 *
 * `gemini`: the structured-output Gemini classifier (the original path).
 * `jev`: Jev decides everything in one call; on an error or timeout the Gemini classifier
 * decides that turn instead, so a Jev outage degrades latency, never availability.
 */
export type IntentClassifier = Runnable<BaseMessage[], unknown>;

export function createGeminiClassifier(env: Env): IntentClassifier {
  return createChatModel(env, "classifier").withStructuredOutput(IntentSchema, { name: "classify_intent" });
}

/** Split the classify node's message list into the current message and "role: text" history. */
export function splitMessages(messages: BaseMessage[]): { input: string; history: string[] } {
  const humans = messages.filter((m) => m instanceof HumanMessage || m.getType() === "human");
  const last = humans.at(-1);
  const input = typeof last?.content === "string" ? last.content : "";
  const history: string[] = [];
  for (const m of messages) {
    if (m === last) break;
    const text = typeof m.content === "string" ? m.content : "";
    if (!text) continue;
    if (m instanceof HumanMessage || m.getType() === "human") history.push(`consultant: ${text}`);
    else if (m instanceof AIMessage || m.getType() === "ai") history.push(`edge: ${text}`);
  }
  return { input, history };
}

export function createJevClassifier(jev: JevClient, fallback: IntentClassifier, opts: { timeoutMs: number }): IntentClassifier {
  return RunnableLambda.from(async (messages: BaseMessage[], config) => {
    const { input, history } = splitMessages(messages);
    // Identifiers never leave the building: Jev sees the redacted text, and the redactor's
    // verdict becomes the pii_sensitive signal.
    const redactedInput = redactPII(input);
    const piiDetected = redactedInput !== input;
    const redactedHistory = history.map(redactPII);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`jev timed out after ${opts.timeoutMs} ms`)), opts.timeoutMs);
    config?.signal?.addEventListener("abort", () => controller.abort(config.signal?.reason), { once: true });
    try {
      const c = await jev.classify(redactedInput, redactedHistory, controller.signal);
      // The classify node parses the object as an Intent and lifts `extras` off it.
      const { intent, extras } = composeIntent(c, { input, history, piiDetected });
      return { ...intent, extras };
    } catch (err) {
      const reason = (err as Error).message.slice(0, 200);
      logger.warn("jev classification failed; falling back to the Gemini classifier for this turn", { err: reason });
      const raw = await fallback.invoke(messages, config);
      const extras: ClassifierExtras = {
        classifier: "gemini-fallback",
        audience: "consultant",
        channel: "chat_answer",
        stage: "unspecified",
        signals: piiDetected ? ["pii_sensitive"] : [],
        intent_confidence: null,
        probabilities: {},
        model: null,
        latencyMs: null,
        cost: null,
        fallbackReason: reason,
        references_prior_turn: false,
      };
      return typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>), extras } : raw;
    } finally {
      clearTimeout(timer);
    }
  }).withConfig({ runName: "classify_jev" });
}

/** Build the classifier `CLASSIFIER_PROVIDER` asks for, degrading to Gemini when Jev is not configured. */
export function createClassifier(env: Env): { classifier: IntentClassifier; provider: "gemini" | "jev" } {
  const gemini = createGeminiClassifier(env);
  if (env.CLASSIFIER_PROVIDER !== "jev") return { classifier: gemini, provider: "gemini" };
  const jev = createJevClient(env);
  if (!jev) {
    logger.error("CLASSIFIER_PROVIDER=jev but OPENROUTER_API_KEY is not set; using the Gemini classifier");
    return { classifier: gemini, provider: "gemini" };
  }
  return { classifier: createJevClassifier(jev, gemini, { timeoutMs: env.JEV_TIMEOUT_MS }), provider: "jev" };
}
