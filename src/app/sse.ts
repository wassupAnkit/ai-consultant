/**
 * Streaming response helper for Bun.serve.
 *
 * Two wire formats share one event model ({event, data}):
 *  - "sse":    `event: token\ndata: {...}\n\n` (text/event-stream), with heartbeats
 *  - "ndjson": `{"event":"token","data":{...}}\n` per line (application/x-ndjson),
 *              which is what the existing Next.js frontend already parses.
 */
export type StreamFormat = "sse" | "ndjson";

export interface EventStream {
  response: Response;
  send(event: string, data: unknown): void;
  close(): void;
  readonly closed: boolean;
  readonly format: StreamFormat;
}

export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatNdjson(event: string, data: unknown): string {
  return JSON.stringify({ event, data }) + "\n";
}

/** `?format=ndjson`, `Accept: application/x-ndjson`, or default SSE. */
export function pickStreamFormat(req: Request): StreamFormat {
  const q = new URL(req.url).searchParams.get("format");
  if (q === "ndjson" || q === "sse") return q;
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/x-ndjson") || accept.includes("application/jsonl")) return "ndjson";
  return "sse";
}

export function createEventStream(opts: { requestId: string; format?: StreamFormat; heartbeatMs?: number; signal?: AbortSignal }): EventStream {
  const format: StreamFormat = opts.format ?? "sse";
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (format === "sse") {
        c.enqueue(encoder.encode(`: connected ${opts.requestId}\n\n`));
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            c.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            close();
          }
        }, opts.heartbeatMs ?? 15_000);
      }
    },
    cancel() {
      close();
    },
  });

  function close() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      controller?.close();
    } catch {
      /* already closed */
    }
  }

  opts.signal?.addEventListener("abort", close, { once: true });

  const headers: Record<string, string> = {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": opts.requestId,
    "content-type": format === "sse" ? "text/event-stream; charset=utf-8" : "application/x-ndjson; charset=utf-8",
  };

  return {
    format,
    response: new Response(stream, { headers }),
    send(event, data) {
      if (closed) return;
      try {
        controller?.enqueue(encoder.encode(format === "sse" ? formatSse(event, data) : formatNdjson(event, data)));
      } catch {
        close();
      }
    },
    close,
    get closed() {
      return closed;
    },
  };
}

/** Backwards-compatible alias. */
export const createSseStream = (opts: { requestId: string; heartbeatMs?: number; signal?: AbortSignal }) =>
  createEventStream({ ...opts, format: "sse" });
