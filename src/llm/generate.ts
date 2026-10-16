import { AsyncCaller } from "@langchain/core/utils/async_caller";
import { z } from "zod";

/**
 * Direct Gemini `generateContent` REST client, used wherever LangChain's
 * `@langchain/google-genai` doesn't expose what we need: Google Search
 * grounding (`tools: [{ google_search: {} }]`, Gemini 2.x/3.x only — the
 * bundled `@google/generative-ai` SDK only types the legacy Gemini-1.5
 * `googleSearchRetrieval`), inline PDF understanding, and JSON-schema
 * structured output via `responseJsonSchema`. Follows the same hand-rolled
 * REST pattern as `GeminiEmbeddings` for the same reason.
 */
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GenerateRequest {
  model: string;
  system?: string;
  parts: Part[];
  /** JSON Schema (e.g. from `zodToGeminiSchema`) for structured output. */
  responseSchema?: Record<string, unknown>;
  /** Google Search grounding: `[{ google_search: {} }]`. Cannot be combined with `responseSchema` on most models. */
  tools?: { google_search: Record<string, never> }[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ignored when `signal` is given. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GroundingChunk {
  uri: string;
  title: string | null;
}

export interface GenerateResult {
  text: string;
  json?: unknown;
  finishReason: string | null;
  grounding?: {
    chunks: GroundingChunk[];
    queries: string[];
    supports: { text: string; chunkIndexes: number[] }[];
  };
  usage: { input: number; output: number; total: number };
}

export interface GeminiGenerateParams {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maxRetries?: number;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    webSearchQueries?: string[];
    groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export class GeminiGenerate {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly caller: AsyncCaller;

  constructor(params: GeminiGenerateParams) {
    this.apiKey = params.apiKey;
    this.fetchImpl = params.fetchImpl ?? fetch;
    this.baseUrl = params.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.caller = new AsyncCaller({ maxRetries: params.maxRetries ?? 2 });
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = req.model.startsWith("models/") ? req.model : `models/${req.model}`;
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens;
    if (req.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = req.responseSchema;
    }
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: req.parts }],
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(req.tools?.length ? { tools: req.tools } : {}),
    };

    return this.caller.call(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(req.timeoutMs ?? 30_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`Gemini generateContent HTTP ${res.status}: ${detail.slice(0, 300)}`) as Error & { status?: number };
        err.status = res.status;
        if (res.status < 500 && res.status !== 429) err.name = "NonRetryableError";
        throw err;
      }
      const json = (await res.json()) as GeminiGenerateContentResponse;
      return parseGenerateResponse(json);
    });
  }
}

export function parseGenerateResponse(json: GeminiGenerateContentResponse): GenerateResult {
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const usage = {
    input: json.usageMetadata?.promptTokenCount ?? 0,
    output: json.usageMetadata?.candidatesTokenCount ?? 0,
    total: json.usageMetadata?.totalTokenCount ?? 0,
  };
  const result: GenerateResult = { text, finishReason: candidate?.finishReason ?? json.promptFeedback?.blockReason ?? null, usage };
  if (text) {
    try {
      result.json = JSON.parse(text);
    } catch {
      // Not JSON (or malformed); callers that requested responseSchema should treat this as a failure.
    }
  }
  const gm = candidate?.groundingMetadata;
  if (gm) {
    result.grounding = {
      chunks: (gm.groundingChunks ?? []).map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? null })).filter((c) => c.uri),
      queries: gm.webSearchQueries ?? [],
      supports: (gm.groundingSupports ?? []).map((s) => ({ text: s.segment?.text ?? "", chunkIndexes: s.groundingChunkIndices ?? [] })),
    };
  }
  return result;
}

/**
 * Convert a Zod schema to the JSON Schema shape Gemini's `responseJsonSchema`
 * accepts: no `$schema`/`default`/`additionalProperties` keys, `$defs`/`$ref`
 * inlined (no references), and `type: ["x", "null"]` expressed as
 * `{ type: "x", nullable: true }`. Our schemas are finite and non-recursive.
 */
export function zodToGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  const defs = (raw.$defs ?? {}) as Record<string, unknown>;
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const ref = obj.$ref;
      if (typeof ref === "string" && ref.startsWith("#/$defs/")) {
        const name = ref.slice("#/$defs/".length);
        return defs[name] ? inline(defs[name]) : obj;
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "$schema" || k === "$defs" || k === "default" || k === "additionalProperties") continue;
        // Gemini rejects array size bounds in responseJsonSchema with a bare
        // 400 INVALID_ARGUMENT (every program extraction failed until
        // 2026-10-09); zod still enforces them when the response is parsed.
        if (k === "maxItems" || k === "minItems") continue;
        // z.number().int() emits ±MAX_SAFE_INTEGER bounds: noise, not a constraint.
        if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) === Number.MAX_SAFE_INTEGER) continue;
        out[k] = inline(v);
      }
      if (Array.isArray(out.type) && out.type.includes("null")) {
        const rest = (out.type as string[]).filter((t) => t !== "null");
        out.type = rest.length === 1 ? rest[0] : rest;
        out.nullable = true;
      }
      // anyOf [X, {type:null}] (zod's other nullable encoding) → X + nullable.
      if (Array.isArray(out.anyOf) && out.anyOf.length === 2) {
        const nonNull = (out.anyOf as Record<string, unknown>[]).filter((a) => a.type !== "null");
        if (nonNull.length === 1) {
          Object.assign(out, nonNull[0], { nullable: true });
          delete out.anyOf;
        }
      }
      return out;
    }
    return node;
  };
  return inline(raw) as Record<string, unknown>;
}
