import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, type AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CrmCallOptions, CrmToolDescriptor, CrmToolResult, CrmToolset } from "../src/crm/client";
import type { GenerateRequest, GenerateResult, GeminiGenerate } from "../src/llm/generate";
import type { ProgramFilters, ProgramRecordLike, ProgramSearch } from "../src/tools/programs";
import type { KnowledgeStore, RetrievedChunk, SearchQuery } from "../src/retrieval/store";

/**
 * Chat model that replays a script of AIMessages (with or without tool_calls),
 * so the research loop can be exercised without a provider. `bindTools` returns
 * the model itself; every message list it was invoked with is recorded.
 */
export class ScriptedToolModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  private i = 0;

  constructor(
    private readonly script: AIMessage[],
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType() {
    return "scripted-tool-model";
  }

  override bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const msg = this.script[this.i] ?? new AIMessage({ content: "sufficient" });
    this.i++;
    return { generations: [{ text: typeof msg.content === "string" ? msg.content : "", message: msg }] };
  }
}

/**
 * A ScriptedToolModel whose calls take time: call i waits `delaysMs[i]` (the last delay repeats)
 * before replying, and rejects as soon as its abort signal fires, like a provider call cut by a
 * timeout. `Infinity` is a hung call that only a signal ends.
 */
export class SlowToolModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  private i = 0;

  constructor(
    private readonly delaysMs: number[],
    private readonly script: AIMessage[] = [],
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType() {
    return "slow-tool-model";
  }

  override bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    this.seen.push(messages);
    const delay = this.delaysMs[Math.min(this.i, this.delaysMs.length - 1)] ?? 0;
    const msg = this.script[this.i] ?? new AIMessage({ content: "sufficient" });
    this.i++;
    await new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      const fail = () => reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }));
      if (signal?.aborted) return fail();
      const timer = Number.isFinite(delay) ? setTimeout(resolve, delay) : undefined;
      signal?.addEventListener("abort", () => (clearTimeout(timer), fail()), { once: true });
    });
    return { generations: [{ text: typeof msg.content === "string" ? msg.content : "", message: msg }] };
  }
}

/**
 * Chat model that streams `chunks` and then throws, for the answer node's fallback rule:
 * an empty `chunks` list is a provider error before the first token (fallback allowed), a
 * non-empty one is a failure with tokens already on the consultant's screen (fallback refused).
 * `streams` counts the stream attempts, so a test can assert whether this model ran at all.
 */
export class StreamThenFailChatModel extends BaseChatModel {
  streams = 0;

  constructor(
    private readonly chunks: AIMessageChunk[] = [],
    private readonly error: Error = new Error("503 the model is overloaded"),
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType() {
    return "stream-then-fail-model";
  }

  async _generate(): Promise<ChatResult> {
    throw this.error;
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.streams++;
    for (const message of this.chunks) {
      // The token callback is what the tracer turns into `on_chat_model_stream`, so a fake
      // that only yields would stream nothing to ChatService — mirror the real models here.
      const chunk = new ChatGenerationChunk({ message, text: typeof message.content === "string" ? message.content : "" });
      yield chunk;
      await runManager?.handleLLMNewToken(chunk.text, undefined, undefined, undefined, undefined, { chunk });
    }
    throw this.error;
  }
}

/**
 * Chat model that streams `chunks` and then stalls until its call is aborted (the answer node's
 * deadline), for a generation the time limit cuts after tokens reached the consultant.
 */
export class StreamThenHangChatModel extends BaseChatModel {
  constructor(
    private readonly chunks: AIMessageChunk[] = [],
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType() {
    return "stream-then-hang-model";
  }

  async _generate(): Promise<ChatResult> {
    throw new Error("stream only");
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    for (const message of this.chunks) {
      const chunk = new ChatGenerationChunk({ message, text: typeof message.content === "string" ? message.content : "" });
      yield chunk;
      await runManager?.handleLLMNewToken(chunk.text, undefined, undefined, undefined, undefined, { chunk });
    }
    await new Promise<void>((_, reject) => {
      const signal = options.signal;
      if (signal?.aborted) return reject(new Error("The operation timed out."));
      signal?.addEventListener("abort", () => reject(new Error("The operation timed out.")), { once: true });
    });
  }
}

export const toolCall = (name: string, args: Record<string, unknown>, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }] });

export const toolCalls = (calls: { name: string; args: Record<string, unknown> }[]) =>
  new AIMessage({ content: "", tool_calls: calls.map((c, i) => ({ id: `${c.name}-${i}`, name: c.name, args: c.args, type: "tool_call" as const })) });

export class FakeProgramSearch implements ProgramSearch {
  readonly calls: ProgramFilters[] = [];
  constructor(private readonly records: ProgramRecordLike[] = [], private readonly fail?: Error) {}
  async search(filters: ProgramFilters): Promise<ProgramRecordLike[]> {
    this.calls.push(filters);
    if (this.fail) throw this.fail;
    return this.records;
  }
}

export const sampleProgram = (n = 1): ProgramRecordLike => ({
  id: `p${n}`,
  url: `https://www.monash.edu/study/courses/find-a-course/information-technology-c6001#${n}`,
  university: "Monash University",
  programName: "Master of Information Technology",
  level: "master",
  country: "australia",
  summary: `Duration: 2 years full time. International tuition (2026): AUD 47,900 per year. Intakes: February, July. English: IELTS 6.5 overall (no band below 6.0). (${n})`,
});

/** fetch replacement: map of URL → Response (or a factory). Unknown URLs get a 404. */
export function fakeFetch(routes: Record<string, Response | ((req: { url: string; init?: RequestInit }) => Response | Promise<Response>)>): typeof fetch {
  const calls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    calls.push(url);
    const hit = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (!hit) return new Response("not found", { status: 404 });
    if (typeof hit === "function") return hit({ url, init });
    // clone() drops the instance-level `url` override used to simulate redirects; copy it over.
    const res = hit.clone();
    if (hit.url) Object.defineProperty(res, "url", { value: hit.url });
    return res;
  }) as unknown as typeof fetch & { calls: string[] };
  (impl as { calls: string[] }).calls = calls;
  return impl;
}

export function htmlResponse(html: string, url?: string, status = 200): Response {
  const res = new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (url) Object.defineProperty(res, "url", { value: url });
  return res;
}

export const SAMPLE_HTML = `<!doctype html><html><head><title>Master of IT — Monash University</title></head><body>
<nav>Home | Courses</nav>
<main>
<h1>Master of Information Technology</h1>
<h2>Entry requirements</h2><p>An Australian bachelor degree (or equivalent) with at least a 60% average. English: IELTS 6.5 overall with no band below 6.0.</p>
<h2>Fees</h2><p>International students: AUD 47,900 per year (2026 indicative). Fees are reviewed annually.</p>
<h2>Intakes</h2><p>February and July. Applications close six weeks before the semester starts.</p>
</main><footer>© Monash</footer></body></html>`;

/** GeminiGenerate stand-in returning canned results. */
export class FakeGemini {
  readonly requests: GenerateRequest[] = [];
  constructor(private readonly results: GenerateResult[] | ((req: GenerateRequest) => GenerateResult)) {}
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(req);
    if (typeof this.results === "function") return this.results(req);
    return this.results[Math.min(this.requests.length - 1, this.results.length - 1)]!;
  }
  asGemini(): GeminiGenerate {
    return this as unknown as GeminiGenerate;
  }
}

export const groundedResult = (over: Partial<GenerateResult> = {}): GenerateResult => ({
  text: "Monash's Master of IT costs AUD 47,900 per year for international students (monash.edu).",
  finishReason: "STOP",
  usage: { input: 100, output: 40, total: 140 },
  grounding: {
    chunks: [
      { uri: "https://www.monash.edu/study/courses/find-a-course/information-technology-c6001", title: "monash.edu" },
      { uri: "https://www.example-aggregator.com/monash-fees", title: "example-aggregator.com" },
    ],
    queries: ["monash master of IT international fees 2026"],
    supports: [
      { text: "Monash's Master of IT costs AUD 47,900 per year for international students", chunkIndexes: [0] },
      { text: "(monash.edu).", chunkIndexes: [0, 1] },
    ],
  },
  ...over,
});

/** One read-only CRM tool, as crm-api publishes it. */
export const CRM_READ_TOOL: CrmToolDescriptor = {
  name: "crm_search_contacts",
  title: "Search contacts",
  description: "Find contacts by name, email or phone.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } as never,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

/**
 * CrmToolset that answers every call from `result`: a fixed result, an Error to throw, or a
 * function of the call (so a dry run and an execute can answer differently).
 */
export const fakeToolset = (
  result: CrmToolResult | Error | ((name: string, args: Record<string, unknown>, opts?: CrmCallOptions) => CrmToolResult | Promise<CrmToolResult>),
  onCall?: (name: string, args: any, opts?: CrmCallOptions) => void,
  descriptors: CrmToolDescriptor[] = [CRM_READ_TOOL],
  actor = "jane@heubert.com",
): CrmToolset => ({
  actor,
  descriptors,
  call: async (name, args, _signal, opts) => {
    onCall?.(name, args, opts);
    if (result instanceof Error) throw result;
    return typeof result === "function" ? result(name, args, opts) : result;
  },
  refresh: async () => {},
});

/** Knowledge store that records every query and answers from a function of it. */
export class RecordingKnowledgeStore implements KnowledgeStore {
  queries: SearchQuery[] = [];
  constructor(private readonly answer: (q: SearchQuery) => RetrievedChunk[] = () => []) {}
  async search(q: SearchQuery) {
    this.queries.push(q);
    return this.answer(q);
  }
  async ping() {
    return true;
  }
  async count() {
    return 1;
  }
}

/**
 * Tool-calling model for comparison fan-out: each branch's research prompt names its one
 * country on the "Destinations:" line, and the model replays that country's script (an Error
 * entry throws). `seen` records each branch's message lists; `maxInFlight` how many calls
 * overlapped, and `overlapMs` makes each call wait so concurrent branches do overlap.
 */
export class CountryScriptedModel extends BaseChatModel {
  readonly seen: Record<string, BaseMessage[][]> = {};
  maxInFlight = 0;
  private inFlight = 0;
  private readonly next: Record<string, number> = {};

  constructor(
    private readonly scripts: Record<string, (AIMessage | Error)[]>,
    private readonly overlapMs = 0,
    fields: BaseChatModelParams = {},
  ) {
    super(fields);
  }

  _llmType() {
    return "country-scripted-model";
  }

  override bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const system = String(messages[0]?.content ?? "");
    const key = Object.keys(this.scripts).find((label) => system.includes(`Destinations: ${label}`)) ?? "?";
    (this.seen[key] ??= []).push(messages);
    const i = this.next[key] ?? 0;
    this.next[key] = i + 1;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.overlapMs) await new Promise((r) => setTimeout(r, this.overlapMs));
      const msg = this.scripts[key]?.[i] ?? new AIMessage({ content: "sufficient" });
      if (msg instanceof Error) throw msg;
      return { generations: [{ text: typeof msg.content === "string" ? msg.content : "", message: msg }] };
    } finally {
      this.inFlight--;
    }
  }
}
