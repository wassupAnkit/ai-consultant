/**
 * Minimal MCP client over streamable HTTP, shared by every MCP server Edge talks to: crm-api
 * (through `CrmMcpClient`) and Google's Gmail and Drive servers (through `src/google/provider.ts`).
 *
 * Hand-rolled rather than `@langchain/mcp-adapters` for the reason given in `src/crm/client.ts`:
 * results must pass through the EvidenceCollector, so this repo owns the call path. It is three
 * JSON-RPC methods over fetch, plus what streamable HTTP adds on top of plain JSON:
 * - the server may answer with an SSE stream instead of a JSON body; the response is the
 *   message on it whose `id` matches the request
 * - a stateful server issues an `Mcp-Session-Id` on `initialize`, which every later request
 *   echoes; a 404 while holding one means the session expired, so it re-initialises once
 * - `notifications/initialized` follows `initialize` (crm-api is stateless and never needed it)
 *
 * Credentials come from a `headers()` callback called on every request, so a caller whose
 * token refreshes (Google's access tokens last an hour) never has to rebuild the client.
 */
import type { JsonSchema7Type } from "@langchain/core/utils/json_schema";
import type { McpCallOptions, McpToolDescriptor, McpToolResult } from "./types";

export const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "edge-consultant", version: "1.0.0" };

export interface McpHttpConfig {
  /** Full URL of the MCP endpoint. */
  url: string;
  /** Per-request headers (auth, tenant). Called for every request; may refresh a token. May throw to abort the request. */
  headers: (signal?: AbortSignal) => Promise<Record<string, string>> | Record<string, string>;
  timeoutMs: number;
  /** Names the server in error messages: "CRM", "Gmail", "Drive". */
  label: string;
  /** Appended to the auth-failure message, e.g. what the operator should rotate. */
  authHint?: string;
  /** Send `notifications/initialized` after `initialize`. Default true. */
  sendInitialized?: boolean;
  /** Defaults to the global fetch, looked up at call time. */
  fetchImpl?: typeof fetch;
}

/**
 * - auth: 401/403; retrying with the same credential cannot help
 * - http: any other non-2xx status
 * - unreachable: the request never got an HTTP answer (DNS, refused, timeout, abort)
 * - protocol: an answer that is not a JSON-RPC response to our request
 * - rpc: a JSON-RPC error object
 */
export type McpErrorKind = "auth" | "http" | "unreachable" | "protocol" | "rpc";

export class McpError extends Error {
  constructor(
    message: string,
    readonly kind: McpErrorKind,
    readonly status?: number,
    /** The JSON-RPC error code, for kind "rpc". */
    readonly code?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const isRpcMessage = (v: unknown): v is JsonRpcResponse => Boolean(v) && typeof v === "object" && (v as JsonRpcResponse).jsonrpc === "2.0";

/**
 * Read an SSE body until the JSON-RPC message answering `id` arrives, then stop reading: a
 * server may keep the stream open after it. Server-initiated requests and notifications on
 * the same stream are skipped.
 */
async function readSseResponse(res: Response, id: number): Promise<JsonRpcResponse | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeEvent = (raw: string): JsonRpcResponse | null => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    return messages.find((m): m is JsonRpcResponse => isRpcMessage(m) && m.id === id && ("result" in m || "error" in m)) ?? null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // Events end at a blank line; the last piece may be incomplete, so keep it for later.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : events.pop()!;
      for (const e of events) {
        const hit = takeEvent(e);
        if (hit) return hit;
      }
      if (done) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export class McpHttpClient {
  private nextId = 1;
  private sessionId: string | undefined;
  /** One handshake at a time: concurrent turns that all see an expired session share one re-initialize. */
  private handshake: Promise<void> | undefined;

  constructor(private readonly config: McpHttpConfig) {}

  private error(kind: McpErrorKind, message: string, status?: number, code?: number) {
    return new McpError(`${this.config.label} ${message}`, kind, status, code);
  }

  private async post(body: string, signal?: AbortSignal, session = this.sessionId): Promise<Response> {
    // Outside the try below: a headers() failure (no token) is the caller's own error, not "unreachable".
    const extra = await this.config.headers(signal);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...(session ? { "mcp-session-id": session } : {}),
      // Last, so a server with narrower needs (crm-api's accept) can override.
      ...extra,
    };
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const fetchImpl = this.config.fetchImpl ?? fetch;
    try {
      return await fetchImpl(this.config.url, { method: "POST", headers, body, signal: composed });
    } catch (err) {
      throw this.error("unreachable", `unreachable: ${(err as Error).message}`);
    }
  }

  private checkStatus(res: Response) {
    // 401/403 mean the token is wrong or expired — worth distinguishing, because retrying
    // the same call cannot help and the credential has to change.
    if (res.status === 401 || res.status === 403) {
      const hint = this.config.authHint ? ` ${this.config.authHint}` : "";
      throw this.error("auth", `rejected our credentials (HTTP ${res.status}).${hint}`, res.status);
    }
    if (!res.ok) throw this.error("http", `returned HTTP ${res.status}`, res.status);
  }

  private async rpc(method: string, params?: Record<string, unknown>, signal?: AbortSignal, retried = false): Promise<{ result: Record<string, unknown>; res: Response }> {
    const id = this.nextId++;
    // initialize never carries the old session; everything else carries the one held when it was sent.
    const heldSession = method === "initialize" ? undefined : this.sessionId;
    const res = await this.post(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }), signal, heldSession);

    // The spec's signal that a session expired: start a new one (unless a concurrent call already
    // did) and try once more.
    if (res.status === 404 && heldSession && !retried) {
      await res.body?.cancel().catch(() => {});
      if (this.sessionId === heldSession) await this.initialize(signal);
      return this.rpc(method, params, signal, true);
    }
    this.checkStatus(res);

    const contentType = res.headers.get("content-type") ?? "";
    const payload = contentType.includes("text/event-stream")
      ? await readSseResponse(res, id).catch(() => null)
      : ((await res.json().catch(() => null)) as JsonRpcResponse | JsonRpcResponse[] | null);
    const message = Array.isArray(payload) ? payload.find((m) => isRpcMessage(m) && m.id === id) : payload;
    if (!message || !isRpcMessage(message)) {
      throw this.error("protocol", "returned a non JSON-RPC response");
    }
    if (message.error) {
      throw this.error("rpc", `error ${message.error.code}: ${message.error.message}`, undefined, message.error.code);
    }
    return { result: message.result ?? {}, res };
  }

  /** A notification has no id and no response; 202/204 with an empty body is the normal answer. */
  private async notify(method: string, signal?: AbortSignal): Promise<void> {
    const res = await this.post(JSON.stringify({ jsonrpc: "2.0", method }), signal);
    await res.body?.cancel().catch(() => {});
    // Only a credential problem matters here; the next real request would hit it anyway.
    if (res.status === 401 || res.status === 403) this.checkStatus(res);
  }

  /** Handshake. Keeps any session id the server issues for later requests. */
  async initialize(signal?: AbortSignal): Promise<void> {
    this.handshake ??= (async () => {
      try {
        const { res } = await this.rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, signal);
        this.sessionId = res.headers.get("mcp-session-id") ?? undefined;
        if (this.config.sendInitialized !== false) await this.notify("notifications/initialized", signal);
      } finally {
        this.handshake = undefined;
      }
    })();
    return this.handshake;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const { result } = await this.rpc("tools/list", undefined, signal);
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return tools
      .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
      .map((t) => ({
        name: String(t.name),
        ...(typeof t.title === "string" ? { title: t.title } : {}),
        description: String(t.description ?? ""),
        inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as JsonSchema7Type,
        ...(t.annotations && typeof t.annotations === "object" ? { annotations: t.annotations as McpToolDescriptor["annotations"] } : {}),
      }))
      .filter((t) => t.name);
  }

  /** `opts.meta` becomes MCP's `params._meta`, untouched. */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, opts?: McpCallOptions): Promise<McpToolResult> {
    const { result } = await this.rpc("tools/call", { name, arguments: args, ...(opts?.meta ? { _meta: opts.meta } : {}) }, signal);
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((c): c is { type: string; text?: string } => Boolean(c) && typeof c === "object")
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n")
      .trim();

    return {
      text,
      ...(result.structuredContent && typeof result.structuredContent === "object"
        ? { structured: result.structuredContent as Record<string, unknown> }
        : {}),
      isError: result.isError === true,
    };
  }
}
