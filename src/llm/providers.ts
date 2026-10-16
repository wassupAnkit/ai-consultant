import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessageChunk } from "@langchain/core/messages";
import { ChatBedrockConverse } from "@langchain/aws";
import { ChatOpenAICompletions } from "@langchain/openai";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Env } from "../config/env";
import { createChatModel, modelSettings, type ModelKind, type ModelOverrides } from "./gemini";
import { parseModelSpec, type ModelSpec } from "./spec";

/**
 * Chat models by spec: `gemini:<id>` through the Gemini factory, `openrouter:<vendor/model>`
 * through OpenRouter's OpenAI-compatible API, `bedrock:<model id>` through Amazon Bedrock's
 * Converse API. ANSWER_MODEL and RESEARCH_MODEL select them; unset keeps today's Gemini models,
 * so switching back is a configuration change.
 */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Extra `max_tokens` for OpenRouter models. Most of them reason before answering and OpenRouter
 * counts reasoning against `max_tokens`, so the Gemini limits (1,024 for research) would cut the
 * visible output short or leave it empty. The tokens are billed and recorded like any other.
 */
export const REASONING_HEADROOM_TOKENS = 4_096;

/** Extra `max_tokens` for a DeepThink answer: at `effort: "high"` DeepSeek spent 3,000 tokens reasoning on a one-line question and wrote nothing. */
export const DEEP_THINK_HEADROOM_TOKENS = 16_384;

/**
 * OpenRouter's chat-completions model, keeping the model's reasoning.
 *
 * OpenRouter returns reasoning as `reasoning` on the message and on each streamed delta
 * (measured 2026-09-28: DeepSeek V4.1 Flash on DeepInfra, 6.5k chars of reasoning per turn),
 * but LangChain only reads DeepSeek's native name `reasoning_content`, so the text was
 * dropped. Copied into `additional_kwargs.reasoning_content`, where LangChain would have put
 * it; LangChain never sends that field back, so later requests are unchanged.
 */
export class OpenRouterChatModel extends ChatOpenAICompletions {
  override _convertCompletionsDeltaToBaseMessageChunk(delta: Record<string, any>, rawResponse: any, defaultRole?: any): BaseMessageChunk {
    const chunk = super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
    return withReasoning(chunk, delta);
  }

  override _convertCompletionsMessageToBaseMessage(message: any, rawResponse: any) {
    return withReasoning(super._convertCompletionsMessageToBaseMessage(message, rawResponse), message);
  }
}

function withReasoning<T extends { additional_kwargs: Record<string, unknown> }>(msg: T, raw: { reasoning?: unknown; reasoning_content?: unknown } | undefined): T {
  if (typeof raw?.reasoning === "string" && raw.reasoning && raw.reasoning_content === undefined) msg.additional_kwargs.reasoning_content = raw.reasoning;
  return msg;
}

export interface OpenRouterOptions {
  /** Provider routing (https://openrouter.ai/docs/features/provider-routing), e.g. { only: ["DeepInfra"] }. */
  provider?: Record<string, unknown>;
  /** OpenRouter `reasoning` parameter, e.g. { effort: "low" }. */
  reasoning?: Record<string, unknown>;
  /** Reasoning headroom added to the role's max_tokens; default REASONING_HEADROOM_TOKENS. */
  headroomTokens?: number;
}

const GEMINI_MODEL_VAR: Record<ModelKind, "GEMINI_MODEL" | "GEMINI_CLASSIFIER_MODEL" | "GEMINI_RESEARCH_MODEL" | "GEMINI_FALLBACK_MODEL"> = {
  answer: "GEMINI_MODEL",
  classifier: "GEMINI_CLASSIFIER_MODEL",
  research: "GEMINI_RESEARCH_MODEL",
  fallback: "GEMINI_FALLBACK_MODEL",
};

/** A LangChain chat model for `spec` in the given role, with that role's sampling settings. */
export function createModelFromSpec(env: Env, spec: ModelSpec | string, kind: ModelKind, overrides: ModelOverrides = {}, openrouter: OpenRouterOptions = {}): BaseChatModel {
  const s = typeof spec === "string" ? parseModelSpec(spec) : spec;
  if (s.provider === "gemini") return createChatModel({ ...env, [GEMINI_MODEL_VAR[kind]]: s.model }, kind, overrides);
  if (s.provider === "bedrock") return createBedrockModel(env, s, kind, overrides, openrouter.headroomTokens, openrouter.reasoning?.effort !== undefined);
  if (!env.OPENROUTER_API_KEY) throw new Error(`OPENROUTER_API_KEY is not set (needed for ${s.id})`);
  const { temperature, maxOutputTokens } = modelSettings(env, kind, overrides);
  return new OpenRouterChatModel({
    model: s.model,
    apiKey: env.OPENROUTER_API_KEY,
    temperature,
    maxTokens: maxOutputTokens + (openrouter.headroomTokens ?? REASONING_HEADROOM_TOKENS),
    maxRetries: 2,
    configuration: { baseURL: OPENROUTER_BASE_URL, defaultHeaders: { "X-Title": "Edge" } },
    // `usage.include` asks OpenRouter for usage accounting: the response's usage carries `cost`
    // (USD) next to cached and reasoning tokens, which LlmUsageRecorder stores per call. OpenRouter
    // now sends it by default; asking explicitly keeps it if that default changes.
    modelKwargs: {
      ...(openrouter.provider ? { provider: openrouter.provider } : {}),
      ...(openrouter.reasoning ? { reasoning: openrouter.reasoning } : {}),
      usage: { include: true },
    },
  });
}

/**
 * A Bedrock Converse model. Credentials come from the AWS SDK's default chain (the pod's IRSA
 * role in the cluster), so there is no key to check here; a missing grant fails the first call
 * and the answer node falls back to Gemini. OpenRouter's provider routing is not sent. GLM 4.7
 * Flash on Bedrock answers without reasoning unless asked, and reasons only at
 * `reasoning_effort: "high"` (low and medium give none, measured 2026-10-12), so `think` (a
 * DeepThink turn) sends "high" whatever DEEP_THINK_EFFORT says; the reasoning streams as
 * `{ type: "reasoning" }` parts, which the thinking timeline reads. The same headroom as
 * OpenRouter keeps the reasoning from using up `maxTokens` before the answer.
 *
 * HTTP/1.1, not the SDK's default HTTP/2 handler: under Bun every Converse call through the
 * default failed with "http2 request did not get a response" (client-bedrock-runtime 3.1149,
 * Bun 1.4.2), and the answer silently fell back to Gemini.
 */
function createBedrockModel(env: Env, spec: ModelSpec, kind: ModelKind, overrides: ModelOverrides, headroomTokens?: number, think = false): BaseChatModel {
  const { temperature, maxOutputTokens } = modelSettings(env, kind, overrides);
  return new ChatBedrockConverse({
    model: spec.model,
    region: env.BEDROCK_REGION,
    temperature,
    maxTokens: maxOutputTokens + (headroomTokens ?? REASONING_HEADROOM_TOKENS),
    maxRetries: 2,
    clientOptions: { requestHandler: new NodeHttpHandler() },
    ...(think ? { additionalModelRequestFields: { reasoning_effort: "high" } } : {}),
  });
}

const routing = (env: Env): OpenRouterOptions => (env.OPENROUTER_PROVIDER ? { provider: env.OPENROUTER_PROVIDER } : {});
/** `reasoning.enabled: false` when a role's *_REASONING setting is "off" (see env.ts). */
const reasoningOff = (setting: "default" | "off"): OpenRouterOptions => (setting === "off" ? { reasoning: { enabled: false } } : {});

/**
 * The answer path's models. The primary is ANSWER_MODEL (default: Gemini GEMINI_MODEL); the
 * fallback is always Gemini GEMINI_FALLBACK_MODEL, so an OpenRouter outage before the first token
 * still produces an answer (the answer node streams the primary and falls back itself).
 *
 * `deep` is the same model for DeepThink turns: OpenRouter `reasoning.effort` at
 * DEEP_THINK_EFFORT with DEEP_THINK_HEADROOM_TOKENS, Bedrock at `reasoning_effort: "high"` with
 * DEEP_THINK_HEADROOM_TOKENS, or Gemini at thinking level HIGH.
 */
export function createAnswerModels(env: Env): { primary: BaseChatModel; deep: BaseChatModel; fallback: BaseChatModel } {
  const spec = env.ANSWER_MODEL ? parseModelSpec(env.ANSWER_MODEL) : null;
  return {
    primary: spec ? createModelFromSpec(env, spec, "answer", {}, { ...routing(env), ...reasoningOff(env.ANSWER_REASONING) }) : createChatModel(env, "answer"),
    deep:
      spec?.provider === "openrouter"
        ? createModelFromSpec(env, spec, "answer", {}, { ...routing(env), reasoning: { effort: env.DEEP_THINK_EFFORT }, headroomTokens: DEEP_THINK_HEADROOM_TOKENS })
        : spec?.provider === "bedrock"
          ? createModelFromSpec(env, spec, "answer", {}, { reasoning: { effort: "high" }, headroomTokens: DEEP_THINK_HEADROOM_TOKENS })
          : createChatModel({ ...env, ...(spec ? { GEMINI_MODEL: spec.model } : {}), GEMINI_THINKING_ENABLED: true, GEMINI_THINKING_LEVEL: "HIGH" }, "answer"),
    fallback: createChatModel(env, "fallback"),
  };
}

/** Research tool-calling model: RESEARCH_MODEL, default Gemini (GEMINI_RESEARCH_MODEL, else GEMINI_MODEL). */
export function createResearchModel(env: Env): BaseChatModel {
  return env.RESEARCH_MODEL
    ? createModelFromSpec(env, env.RESEARCH_MODEL, "research", {}, { ...routing(env), ...reasoningOff(env.RESEARCH_REASONING) })
    : createChatModel(env, "research");
}

export { parseModelSpec, type ModelSpec };
