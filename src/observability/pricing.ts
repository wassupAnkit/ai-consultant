/**
 * List prices for estimating a call's cost when the provider does not report one (OpenRouter
 * normally does: `usage.cost`, recorded with costSource "provider"). USD per 1M tokens.
 *
 * Keyed by the model id LangChain reports (`ls_model_name`), without the `openrouter:` / `bedrock:` spec prefix.
 * The prices are for the host we pin with OPENROUTER_PROVIDER, not OpenRouter's cheapest listing.
 */
export interface ModelPrice {
  inputPerM: number;
  /** Prompt tokens served from the provider's prompt cache. */
  cacheReadPerM: number;
  /** Completion tokens, reasoning included (reasoning is billed as output). */
  outputPerM: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepInfra via OpenRouter (provider pinned {"only":["DeepInfra"]}); DeepInfra caches prompts automatically.
  "deepseek/deepseek-v4.1-flash": { inputPerM: 0.14, cacheReadPerM: 0.0042, outputPerM: 0.42 },
  // Amazon Bedrock on-demand (standard tier), ap-southeast-2, AWS Price List 2026-10-12. Bedrock
  // reports no cost, so every Bedrock call is an estimate from here. No cache price is listed.
  "zai.glm-4.7-flash": { inputPerM: 0.07, cacheReadPerM: 0.07, outputPerM: 0.41 },
};

export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  return MODEL_PRICES[model.replace(/^(openrouter|bedrock):/, "")] ?? null;
}

/**
 * Estimated USD cost of one call. Token counts follow OpenAI-compatible usage (and LangChain's
 * usage_metadata): `inputTokens` INCLUDES the cached tokens and `outputTokens` INCLUDES the
 * reasoning tokens, so cached tokens are moved from the input price to the cache-read price and
 * reasoning is not added again. Null when the model has no price or there are no token counts.
 */
export function estimateCostUsd(model: string | null | undefined, usage: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }): number | null {
  const price = priceFor(model);
  if (!price || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return null;
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  return ((input - cached) * price.inputPerM + cached * price.cacheReadPerM + (usage.outputTokens ?? 0) * price.outputPerM) / 1e6;
}
