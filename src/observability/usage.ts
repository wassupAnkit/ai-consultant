import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import type { LlmCall, LlmSummary } from "../db/mongo";
import { ANSWER_TAG, RESEARCH_TAG } from "../graph/state";
import { estimateCostUsd } from "./pricing";

type Meta = Record<string, unknown> | undefined;

/**
 * Per-turn LangChain callback that records which model answered, token usage
 * and finish reasons for every chat-model call in the graph. Because it hangs
 * off the run config it sees both `invoke` and `streamEvents`, and both the
 * primary answer model and the cheaper one the answer node falls back to (both
 * carry ANSWER_TAG, so a fallback turn records two `answer` calls — which is what
 * `summarizeLlm` reads to set `usedFallback`).
 *
 * Per call it also keeps the prompt-cache hits and reasoning tokens from usage_metadata (LangChain
 * maps OpenRouter's `prompt_tokens_details.cached_tokens` and `completion_tokens_details.
 * reasoning_tokens` there for invoked and streamed calls alike) and the cost: OpenRouter's own
 * `usage.cost`, which LangChain leaves in response_metadata.usage, else an estimate from the
 * price table.
 */
export class LlmUsageRecorder extends BaseCallbackHandler {
  override name = "edge_usage_recorder";
  override awaitHandlers = true;
  readonly calls: LlmCall[] = [];
  private readonly started = new Map<string, number>();

  private start(runId: string, extraParams: Meta, tags: string[] | undefined, metadata: Meta) {
    const inv = (extraParams?.invocation_params ?? {}) as Record<string, unknown>;
    const model = (metadata?.ls_model_name ?? inv.model ?? inv.model_name ?? null) as string | null;
    this.started.set(runId, performance.now());
    this.calls.push({
      runId,
      role: tags?.includes(ANSWER_TAG) ? "answer" : tags?.includes(RESEARCH_TAG) ? "research" : "classifier",
      model: model ? String(model) : null,
      provider: metadata?.ls_provider ? String(metadata.ls_provider) : null,
      ok: null,
      ms: null,
    });
  }

  override handleChatModelStart(_llm: unknown, _messages: unknown, runId: string, _parent?: string, extraParams?: Meta, tags?: string[], metadata?: Meta) {
    this.start(runId, extraParams, tags, metadata);
  }

  override handleLLMStart(_llm: unknown, _prompts: string[], runId: string, _parent?: string, extraParams?: Meta, tags?: string[], metadata?: Meta) {
    this.start(runId, extraParams, tags, metadata);
  }

  override handleLLMEnd(output: LLMResult, runId: string) {
    const call = this.calls.find((c) => c.runId === runId);
    if (!call) return;
    call.ok = true;
    call.ms = this.elapsed(runId);
    const gen = output.generations?.[0]?.[0] as { message?: { usage_metadata?: Record<string, unknown>; response_metadata?: Record<string, unknown> }; generationInfo?: Record<string, unknown> } | undefined;
    const usage = (gen?.message?.usage_metadata ?? output.llmOutput?.tokenUsage ?? output.llmOutput?.usage) as Record<string, unknown> | undefined;
    if (usage) {
      call.inputTokens = num(usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens);
      call.outputTokens = num(usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens);
      call.totalTokens = num(usage.total_tokens ?? usage.totalTokens) ?? sum(call.inputTokens, call.outputTokens);
      const cached = num((usage.input_token_details as Meta)?.cache_read);
      const reasoning = num((usage.output_token_details as Meta)?.reasoning);
      if (cached !== undefined) call.cachedInputTokens = cached;
      if (reasoning !== undefined) call.reasoningTokens = reasoning;
    }
    const providerCost = reportedCost(gen?.message?.response_metadata?.usage as Meta, call.totalTokens);
    const cost = providerCost ?? estimateCostUsd(call.model, call);
    if (cost !== null) {
      call.costUsd = cost;
      call.costSource = providerCost !== null ? "provider" : "estimate";
    }
    const finish = gen?.generationInfo?.finishReason ?? gen?.generationInfo?.finish_reason ?? gen?.message?.response_metadata?.finishReason;
    if (finish) call.finishReason = String(finish);
    const responseModel = gen?.message?.response_metadata?.model ?? gen?.message?.response_metadata?.modelVersion;
    if (!call.model && responseModel) call.model = String(responseModel);
  }

  override handleLLMError(err: unknown, runId: string) {
    const call = this.calls.find((c) => c.runId === runId);
    if (!call) return;
    call.ok = false;
    call.ms = this.elapsed(runId);
    call.error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : String(err).slice(0, 500);
  }

  private elapsed(runId: string) {
    const t = this.started.get(runId);
    this.started.delete(runId);
    return t === undefined ? null : Math.round(performance.now() - t);
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function sum(a?: number, b?: number): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

/**
 * OpenRouter's `usage.cost` as LangChain hands it over: the raw usage block copied into
 * response_metadata. When a stream sends its usage on a chunk that also carries a choice, LangChain
 * copies the block from that chunk and again from its own usage chunk, and concatenating the stream
 * adds the copies together (usage_metadata stays right). The raw total over the true total is then
 * the number of copies, and the cost is divided by it.
 */
function reportedCost(raw: Meta, totalTokens: number | undefined): number | null {
  const cost = num(raw?.cost);
  if (cost === undefined) return null;
  const rawTotal = num(raw?.total_tokens);
  const copies = rawTotal && totalTokens ? rawTotal / totalTokens : 1;
  return Number.isInteger(copies) && copies > 1 ? cost / copies : cost;
}

/**
 * Collapse recorded calls into the per-turn `llm` block. `jevCostUsd` is the Jev classifier's cost
 * (state.meta.jevCost): Jev calls its own API outside LangChain, so it is added to the turn's cost
 * here rather than appearing among the calls.
 */
export function summarizeLlm(calls: LlmCall[], extra: { jevCostUsd?: number | null } = {}): LlmSummary {
  const answers = calls.filter((c) => c.role === "answer");
  const classifiers = calls.filter((c) => c.role === "classifier");
  const research = calls.filter((c) => c.role === "research");
  const lastOkAnswer = [...answers].reverse().find((c) => c.ok);
  const lastOkClassifier = [...classifiers].reverse().find((c) => c.ok);
  const lastOkResearch = [...research].reverse().find((c) => c.ok);
  const tot = (k: "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "reasoningTokens") => calls.reduce((n, c) => n + (c[k] ?? 0), 0);
  const jevCostUsd = num(extra.jevCostUsd) ?? null;
  const costs = calls.map((c) => c.costUsd).filter((c): c is number => c !== undefined);
  if (jevCostUsd !== null) costs.push(jevCostUsd);
  return {
    answerModel: lastOkAnswer?.model ?? answers.at(-1)?.model ?? null,
    classifierModel: lastOkClassifier?.model ?? classifiers.at(-1)?.model ?? null,
    researchModel: lastOkResearch?.model ?? research.at(-1)?.model ?? null,
    researchCalls: research.length,
    usedFallback: answers.length > 1 && answers.some((c) => c.ok === false),
    inputTokens: tot("inputTokens"),
    outputTokens: tot("outputTokens"),
    totalTokens: tot("totalTokens"),
    cachedInputTokens: tot("cachedInputTokens"),
    reasoningTokens: tot("reasoningTokens"),
    costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    jevCostUsd,
    uncostedCalls: calls.filter((c) => c.ok && c.costUsd === undefined).length,
    calls,
  };
}
