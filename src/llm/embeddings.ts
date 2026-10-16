import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";

export interface GeminiEmbeddingsParams extends EmbeddingsParams {
  apiKey: string;
  model: string;
  /** Matryoshka output size (128–3072). 768 is the recommended balance. */
  dimensions: number;
  /** Batch size for batchEmbedContents (API max is 100). */
  batchSize?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Gemini embeddings via the REST API. Written directly because the LangChain
 * integration does not expose `outputDimensionality`, which we need so the
 * pgvector column can stay at 768 dims (HNSW-indexable, 4x cheaper than 3072).
 * Vectors are L2-normalised: Gemini only guarantees unit norm at 3072 dims.
 */
export class GeminiEmbeddings extends Embeddings {
  private readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(params: GeminiEmbeddingsParams) {
    super(params);
    this.apiKey = params.apiKey;
    this.model = params.model.startsWith("models/") ? params.model : `models/${params.model}`;
    this.dimensions = params.dimensions;
    this.batchSize = Math.min(params.batchSize ?? 64, 100);
    this.fetchImpl = params.fetchImpl ?? fetch;
    this.baseUrl = params.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...(await this.request(batch, "RETRIEVAL_DOCUMENT")));
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.request([text], "RETRIEVAL_QUERY");
    if (!v) throw new Error("Gemini returned no embedding for query");
    return v;
  }

  private async request(texts: string[], taskType: TaskType): Promise<number[][]> {
    const body = {
      requests: texts.map((text) => ({
        model: this.model,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: this.dimensions,
      })),
    };
    return this.caller.call(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/${this.model}:batchEmbedContents`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const err = new Error(`Gemini embeddings HTTP ${res.status}: ${detail.slice(0, 300)}`) as Error & {
          status?: number;
        };
        err.status = res.status;
        // AsyncCaller retries everything except errors it recognises as final.
        if (res.status < 500 && res.status !== 429) err.name = "NonRetryableError";
        throw err;
      }
      const json = (await res.json()) as { embeddings?: { values: number[] }[] };
      const vectors = json.embeddings?.map((e) => normalise(e.values)) ?? [];
      if (vectors.length !== texts.length) {
        throw new Error(`Gemini embeddings count mismatch: expected ${texts.length}, got ${vectors.length}`);
      }
      return vectors;
    });
  }
}

export function normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) return v;
  return v.map((x) => x / norm);
}
