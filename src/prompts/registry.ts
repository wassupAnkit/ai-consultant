import type { LangfuseClient, TextPromptClient } from "@langfuse/client";
import type { Env } from "../config/env";
import { sha256 } from "../activity/identity";
import { logger } from "../observability/logger";
import { PRIMARY_INTENTS, type PrimaryIntent } from "../schemas/intent.schema";
import { CLASSIFIER_PROMPT, INTENT_PLAYBOOKS } from "./intents";
import { CONSULTANT_SYSTEM_PROMPT, INJECTION_REFUSAL, RESEARCH_SYSTEM_PROMPT } from "./consultant";
import { GUIDED_SESSION_PROMPT } from "./journey";
import { COUNTRY_PROMPTS } from "./countries";
import { MARKET_PROMPTS } from "./markets";
import { MARKETS, type Market } from "../routing/markets";
import { PACK_COUNTRIES, type PackCountry } from "../skills/types";

/**
 * Prompt names as they appear in Langfuse. The in-code text is the fallback
 * and the seed pushed by `bun run prompts:push`; Langfuse (label per
 * environment) can override any of them without a deploy.
 */
export const PROMPT_NAMES = {
  system: "edge-consultant-system",
  research: "edge-consultant-research",
  classifier: "edge-consultant-classifier",
  refusal: "edge-consultant-refusal",
  /** The guided-session block, filled into the system prompt only for guided sessions. */
  guided: "edge-consultant-guided",
  playbook: (intent: PrimaryIntent) => `edge-consultant-playbook-${intent.replace(/_/g, "-")}`,
  /** Per-destination guidance of a country skill pack (src/skills), filled into the answer prompt. */
  country: (country: PackCountry) => `edge-consultant-country-${country.replace(/_/g, "-")}`,
  /** Per-source-market guidance of a market pack (src/skills/markets), filled into the answer prompt. */
  market: (market: Market) => `edge-consultant-market-${market.replace(/_/g, "-")}`,
} as const;

export function localPrompts(): Record<string, string> {
  const out: Record<string, string> = {
    [PROMPT_NAMES.system]: CONSULTANT_SYSTEM_PROMPT,
    [PROMPT_NAMES.research]: RESEARCH_SYSTEM_PROMPT,
    [PROMPT_NAMES.classifier]: CLASSIFIER_PROMPT,
    [PROMPT_NAMES.refusal]: INJECTION_REFUSAL,
    [PROMPT_NAMES.guided]: GUIDED_SESSION_PROMPT,
  };
  for (const intent of PRIMARY_INTENTS) out[PROMPT_NAMES.playbook(intent)] = INTENT_PLAYBOOKS[intent];
  for (const country of PACK_COUNTRIES) out[PROMPT_NAMES.country(country)] = COUNTRY_PROMPTS[country];
  for (const market of MARKETS) out[PROMPT_NAMES.market(market)] = MARKET_PROMPTS[market];
  return out;
}

export interface ResolvedPrompt {
  name: string;
  text: string;
  source: "langfuse" | "local";
  version?: number;
  /** sha256 of `text`: identifies the exact template a turn was generated with. */
  hash: string;
  /** Present when served from Langfuse; attach as `metadata.langfusePrompt` to link generations. */
  client?: TextPromptClient;
}

export class PromptRegistry {
  private readonly local = localPrompts();
  private readonly warned = new Set<string>();
  /** Names recently missing in Langfuse → serve local text without a network call for a while. */
  private readonly missingUntil = new Map<string, number>();
  private static readonly MISSING_TTL_MS = 10 * 60_000;

  constructor(
    private readonly langfuse: LangfuseClient | null,
    private readonly opts: { label: string; cacheTtlSeconds: number },
  ) {}

  async get(name: string): Promise<ResolvedPrompt> {
    const fallback = this.local[name];
    if (fallback === undefined) throw new Error(`unknown prompt: ${name}`);
    if (!this.langfuse) return { name, text: fallback, source: "local", hash: sha256(fallback) };
    const missing = this.missingUntil.get(name);
    if (missing && missing > Date.now()) return { name, text: fallback, source: "local", hash: sha256(fallback) };
    try {
      const client = await this.langfuse.prompt.get(name, {
        label: this.opts.label,
        cacheTtlSeconds: this.opts.cacheTtlSeconds,
        fallback,
        type: "text",
        maxRetries: 1,
      });
      if (client.isFallback) {
        this.missingUntil.set(name, Date.now() + PromptRegistry.MISSING_TTL_MS);
        if (!this.warned.has(name)) {
          this.warned.add(name);
          logger.warn("prompt not found in Langfuse; using local version", { name, label: this.opts.label });
        }
        return { name, text: fallback, source: "local", hash: sha256(fallback) };
      }
      return { name, text: client.prompt, source: "langfuse", version: client.version, hash: sha256(client.prompt), client };
    } catch (err) {
      this.missingUntil.set(name, Date.now() + PromptRegistry.MISSING_TTL_MS);
      logger.warn("Langfuse prompt fetch failed; using local version", { name, err: (err as Error).message });
      return { name, text: fallback, source: "local", hash: sha256(fallback) };
    }
  }

  /** Pre-fetch everything at boot so the first request is not slowed down. */
  async warm(): Promise<void> {
    await Promise.all(Object.keys(this.local).map((n) => this.get(n).catch(() => undefined)));
  }
}

export function createPromptRegistry(env: Env, langfuse: LangfuseClient | null) {
  return new PromptRegistry(langfuse, { label: env.LANGFUSE_PROMPT_LABEL, cacheTtlSeconds: env.LANGFUSE_PROMPT_CACHE_TTL });
}
