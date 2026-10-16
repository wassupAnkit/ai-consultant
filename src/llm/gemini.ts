import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { Env } from "../config/env";

export type ModelKind = "answer" | "classifier" | "fallback" | "research";

export type ModelOverrides = Partial<{ temperature: number; maxOutputTokens: number }>;

/** Sampling settings per role, shared with the OpenRouter models in ./providers.ts. */
export function modelSettings(env: Pick<Env, "LLM_MAX_OUTPUT_TOKENS">, kind: ModelKind, overrides: ModelOverrides = {}) {
  return {
    temperature: overrides.temperature ?? (kind === "classifier" || kind === "research" ? 0 : 0.3),
    maxOutputTokens: overrides.maxOutputTokens ?? (kind === "classifier" ? 1024 : kind === "research" ? 1024 : env.LLM_MAX_OUTPUT_TOKENS),
  };
}

/**
 * Gemini 3.x thinks before answering even when no thinking config is sent, and those thought
 * tokens count against `maxOutputTokens`. A long system prompt (country packs, a coverage
 * checklist) makes it think longer, which ran 2,048-token answers out of budget mid-sentence
 * (coverage eval, 8 Oct 2026). The free-text roles get the same headroom as the OpenRouter
 * models' reasoning (providers.ts REASONING_HEADROOM_TOKENS); the classifier's structured
 * output keeps its plain cap.
 */
export const GEMINI_THINKING_HEADROOM_TOKENS = 4_096;

/**
 * Chat model factory. All Gemini model IDs are env-driven so an upgrade
 * (e.g. to a newer Flash generation) is a config change, gated by the intent
 * evaluation script.
 */
export function createChatModel(
  env: Env,
  kind: ModelKind,
  overrides: ModelOverrides = {},
) {
  const model =
    kind === "answer"
      ? env.GEMINI_MODEL
      : kind === "classifier"
        ? env.GEMINI_CLASSIFIER_MODEL
        : kind === "research"
          ? env.GEMINI_RESEARCH_MODEL ?? env.GEMINI_MODEL
          : env.GEMINI_FALLBACK_MODEL;
  const { temperature, maxOutputTokens } = modelSettings(env, kind, overrides);
  // Thought summaries only on the paths that produce the consultant-facing answer (`answer`
  // and the `fallback` it degrades to). Thinking tokens are billed and push back the first
  // visible token, hence the flag; the classifier and research models are high-frequency
  // calls whose output is structured, so thinking would cost on every turn and show nothing.
  const thinks = (kind === "answer" || kind === "fallback") && env.GEMINI_THINKING_ENABLED;
  return new ChatGoogleGenerativeAI({
    model,
    apiKey: env.GOOGLE_API_KEY,
    temperature,
    maxOutputTokens: kind === "classifier" ? maxOutputTokens : maxOutputTokens + GEMINI_THINKING_HEADROOM_TOKENS,
    maxRetries: 2,
    ...(thinks
      ? { thinkingConfig: { includeThoughts: true, ...(env.GEMINI_THINKING_LEVEL ? { thinkingLevel: env.GEMINI_THINKING_LEVEL } : {}) } }
      : {}),
    // Never set responseMimeType=application/json for free-text answers.
  });
}

/** The answer path's two models: the primary, and the cheaper one it degrades to. */
export interface AnswerModels {
  primary: ChatGoogleGenerativeAI;
  fallback: ChatGoogleGenerativeAI;
}

/**
 * Primary answer model and its cheaper stand-in, returned *unwrapped*.
 *
 * Deliberately not `primary.withFallbacks([fallback])`: RunnableWithFallbacks re-emits the
 * model's streamed chunks with their content normalised to a plain string, which throws away
 * the `{ type: "thinking" }` parts — measured end to end, the wrapper turned 1.5k chars of
 * thought summaries into zero, and it surfaces a single model run, so there is no inner run to
 * read them from either. The answer node therefore streams the primary itself and falls back
 * explicitly; see `generate` in ../graph/nodes.ts.
 */
export function createAnswerModel(env: Env, temperature?: number): AnswerModels {
  return {
    primary: createChatModel(env, "answer", { temperature }),
    fallback: createChatModel(env, "fallback", { temperature }),
  };
}
