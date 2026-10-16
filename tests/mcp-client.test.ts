import { describe, expect, test } from "bun:test";
import { McpError, McpHttpClient } from "../src/mcp/client";

interface Sent {
  method?: string;
  id?: number;
  body: any;
  headers: Record<string, string>;
}

type Reply = (body: any, sent: Sent[]) => Response | Promise<Response>;

/** A fetch stand-in that records every POST and answers from `reply`. */
function scriptServer(reply: Reply) {
  const sent: Sent[] = [];
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const entry = { method: body.method, id: body.id, body, headers: init.headers };
    sent.push(entry);
    return reply(body, sent);
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const sse = (events: unknown[], headers: Record<string, string> = {}) =>
  new Response(events.map((e) => `event: message\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });

const TOOLS = { tools: [{ name: "search_threads", description: "Search mail.", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] };

const client = (fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof McpHttpClient>[0]> = {}) =>
  new McpHttpClient({ url: "https://mcp.example.test/mcp/v1", headers: () => ({ authorization: "Bearer t1" }), timeoutMs: 5_000, label: "Gmail", fetchImpl, ...over });

describe("McpHttpClient", () => {
  test("reads a plain JSON body and sends the streamable-HTTP accept header", async () => {
    const { sent, fetchImpl } = scriptServer((b) => (b.id === undefined ? new Response(null, { status: 202 }) : json({ jsonrpc: "2.0", id: b.id, result: b.method === "tools/list" ? TOOLS : {} })));
    const c = client(fetchImpl);
    await c.initialize();
    const tools = await c.listTools();

    expect(tools.map((t) => t.name)).toEqual(["search_threads"]);
    expect(sent[0]!.headers.accept).toBe("application/json, text/event-stream");
    expect(sent[0]!.headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(sent[0]!.headers.authorization).toBe("Bearer t1");
    expect(sent[0]!.body.params.protocolVersion).toBe("2025-06-18");
  });

  test("picks the JSON-RPC message whose id matches out of an SSE body", async () => {
    const { fetchImpl } = scriptServer((b) =>
      b.id === undefined
        ? new Response(null, { status: 204 })
        : sse([
            { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } },
            { jsonrpc: "2.0", id: 999, result: { wrong: true } },
            { jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: "3 threads" }], structuredContent: { threads: [{ id: "t1" }] } } },
          ]),
    );
    const result = await client(fetchImpl).callTool("search_threads", { query: "x" });
    expect(result).toEqual({ text: "3 threads", structured: { threads: [{ id: "t1" }] }, isError: false });
  });

  test("joins multi-line SSE data fields", async () => {
    const { fetchImpl } = scriptServer(
      (b) => new Response(`data: {"jsonrpc":"2.0",\ndata: "id":${b.id},"result":{"content":[{"type":"text","text":"ok"}]}}\n\n`, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
    );
    expect((await client(fetchImpl).callTool("x", {})).text).toBe("ok");
  });

  test("an SSE stream that ends without our response is a protocol error", async () => {
    const { fetchImpl } = scriptServer(() => sse([{ jsonrpc: "2.0", id: 12345, result: {} }]));
    const err = await client(fetchImpl).callTool("x", {}).catch((e) => e);
    expect(err).toBeInstanceOf(McpError);
    expect(err.kind).toBe("protocol");
    expect(err.message).toContain("Gmail");
  });

  test("captures Mcp-Session-Id from initialize, echoes it, and sends notifications/initialized", async () => {
    const { sent, fetchImpl } = scriptServer((b) => {
      if (b.method === "initialize") return json({ jsonrpc: "2.0", id: b.id, result: {} }, { "mcp-session-id": "sess-1" });
      if (b.id === undefined) return new Response(null, { status: 202 });
      return json({ jsonrpc: "2.0", id: b.id, result: TOOLS });
    });
    const c = client(fetchImpl);
    await c.initialize();
    await c.listTools();

    expect(sent.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(sent[0]!.headers["mcp-session-id"]).toBeUndefined();
    expect(sent[1]!.headers["mcp-session-id"]).toBe("sess-1");
    expect(sent[1]!.body.id).toBeUndefined();
    expect(sent[2]!.headers["mcp-session-id"]).toBe("sess-1");
  });

  test("can skip the initialized notification for a server that never needed it", async () => {
    const { sent, fetchImpl } = scriptServer((b) => json({ jsonrpc: "2.0", id: b.id, result: {} }));
    await client(fetchImpl, { sendInitialized: false }).initialize();
    expect(sent.map((s) => s.method)).toEqual(["initialize"]);
  });

  test("re-initialises once on a 404 for an expired session, then retries", async () => {
    let session = 0;
    const { sent, fetchImpl } = scriptServer((b, all) => {
      if (b.method === "initialize") return json({ jsonrpc: "2.0", id: b.id, result: {} }, { "mcp-session-id": `sess-${++session}` });
      if (b.id === undefined) return new Response(null, { status: 202 });
      // The first session has expired server-side.
      if (all.at(-1)!.headers["mcp-session-id"] === "sess-1") return new Response("gone", { status: 404 });
      return json({ jsonrpc: "2.0", id: b.id, result: TOOLS });
    });
    const c = client(fetchImpl);
    await c.initialize();
    const tools = await c.listTools();

    expect(tools).toHaveLength(1);
    expect(sent.filter((s) => s.method === "initialize")).toHaveLength(2);
    expect(sent.at(-1)!.headers["mcp-session-id"]).toBe("sess-2");
  });

  test("gives up after one re-initialise", async () => {
    const { sent, fetchImpl } = scriptServer((b) => {
      if (b.method === "initialize") return json({ jsonrpc: "2.0", id: b.id, result: {} }, { "mcp-session-id": "s" });
      if (b.id === undefined) return new Response(null, { status: 202 });
      return new Response("gone", { status: 404 });
    });
    const c = client(fetchImpl);
    await c.initialize();
    const err = await c.listTools().catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 404 });
    expect(sent.filter((s) => s.method === "initialize")).toHaveLength(2);
  });

  test("a 404 without a session is a plain HTTP error, not a re-initialise", async () => {
    const { sent, fetchImpl } = scriptServer(() => new Response("nope", { status: 404 }));
    const err = await client(fetchImpl).listTools().catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 404, message: "Gmail returned HTTP 404" });
    expect(sent).toHaveLength(1);
  });

  test("401 and 403 are auth McpErrors naming the server", async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = scriptServer(() => new Response("{}", { status }));
      const err = await client(fetchImpl, { label: "Drive" }).callTool("x", {}).catch((e) => e);
      expect(err).toBeInstanceOf(McpError);
      expect(err).toMatchObject({ kind: "auth", status });
      expect(err.message).toBe(`Drive rejected our credentials (HTTP ${status}).`);
    }
  });

  test("appends an auth hint when configured", async () => {
    const { fetchImpl } = scriptServer(() => new Response("{}", { status: 401 }));
    const err = await client(fetchImpl, { label: "CRM", authHint: "Rotate the token." }).callTool("x", {}).catch((e) => e);
    expect(err.message).toBe("CRM rejected our credentials (HTTP 401). Rotate the token.");
  });

  test("unreachable, non JSON-RPC and JSON-RPC errors each have their own kind", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await client(down).callTool("x", {}).catch((e) => e)).toMatchObject({ kind: "unreachable", message: "Gmail unreachable: connect ECONNREFUSED" });

    const html = scriptServer(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await client(html.fetchImpl).callTool("x", {}).catch((e) => e)).toMatchObject({ kind: "protocol", message: "Gmail returned a non JSON-RPC response" });

    const rpc = scriptServer((b) => json({ jsonrpc: "2.0", id: b.id, error: { code: -32602, message: "Invalid params" } }));
    expect(await client(rpc.fetchImpl).callTool("x", {}).catch((e) => e)).toMatchObject({ kind: "rpc", message: "Gmail error -32602: Invalid params" });
  });

  test("asks for headers on every request, so a refreshed token is picked up", async () => {
    let n = 0;
    const { sent, fetchImpl } = scriptServer((b) => json({ jsonrpc: "2.0", id: b.id, result: {} }));
    const c = client(fetchImpl, { headers: async () => ({ authorization: `Bearer t${++n}` }), sendInitialized: false });
    await c.initialize();
    await c.callTool("x", {});
    expect(sent.map((s) => s.headers.authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  test("a failing headers callback propagates unchanged", async () => {
    const { sent, fetchImpl } = scriptServer((b) => json({ jsonrpc: "2.0", id: b.id, result: {} }));
    const boom = new McpError("Gmail: no access token", "auth");
    const err = await client(fetchImpl, { headers: () => Promise.reject(boom) }).callTool("x", {}).catch((e) => e);
    expect(err).toBe(boom);
    expect(sent).toHaveLength(0);
  });

  test("tolerates an initialized notification the server rejects with a non-auth status", async () => {
    const { fetchImpl } = scriptServer((b) => (b.id === undefined ? new Response("bad", { status: 400 }) : json({ jsonrpc: "2.0", id: b.id, result: {} })));
    await client(fetchImpl).initialize();
  });
});

describe("McpHttpClient session expiry under concurrency", () => {
  test("two calls that both hit an expired session share one re-initialize", async () => {
    const { McpHttpClient } = await import("../src/mcp/client");
    let sessions = 0;
    let live = "";
    const inits: number[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const sid = (init.headers as Record<string, string>)["mcp-session-id"];
      if (body.method === "initialize") {
        inits.push(++sessions);
        live = `s${sessions}`;
        await Bun.sleep(5);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { headers: { "content-type": "application/json", "mcp-session-id": live } });
      }
      if (!body.id) return new Response(null, { status: 202 });
      if (sid !== live) return new Response("gone", { status: 404 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const client = new McpHttpClient({ url: "https://mcp.test/v1", headers: () => ({}), timeoutMs: 2_000, label: "Gmail", fetchImpl });
    await client.initialize();
    live = "expired-by-server";
    await Promise.all([client.listTools(), client.listTools()]);
    expect(inits).toEqual([1, 2]);
  });
});
