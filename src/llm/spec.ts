/**
 * Model specs: `gemini:<id>` (Google's API), `openrouter:<vendor/model>` (OpenRouter's
 * OpenAI-compatible API) or `bedrock:<model id>` (Amazon Bedrock's Converse API, e.g.
 * `bedrock:zai.glm-4.7-flash`). Kept free of SDK imports so env validation can use it.
 */
export type Provider = "gemini" | "openrouter" | "bedrock";

export interface ModelSpec {
  provider: Provider;
  model: string;
  /** The spec as written, e.g. "openrouter:deepseek/deepseek-v4.1-flash". */
  id: string;
}

export function parseModelSpec(spec: string): ModelSpec {
  const s = spec.trim();
  const i = s.indexOf(":");
  if (i <= 0 || i === s.length - 1) throw new Error(`invalid model spec "${spec}": expected gemini:<id>, openrouter:<vendor/model> or bedrock:<model id>`);
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  if (provider !== "gemini" && provider !== "openrouter" && provider !== "bedrock") throw new Error(`unknown provider "${provider}" in "${spec}": use gemini, openrouter or bedrock`);
  if (provider === "openrouter" && !model.includes("/")) throw new Error(`OpenRouter slugs are vendor/model, got "${model}"`);
  return { provider, model, id: s };
}
