import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { createShutdown } from "../src/app/shutdown";
import { shutdownDrainMs, shutdownDrainWarning } from "../src/config/env";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

const API_KEY = "test-api-key-0123456789abcdef0123456789";
const headers = { "content-type": "application/json", "x-api-key": API_KEY };

describe("SHUTDOWN_DRAIN_MS", () => {
  test("defaults to the request deadline plus 5 s, so the slowest turn can finish", () => {
    expect(shutdownDrainMs(testEnv())).toBe(125_000);
    expect(shutdownDrainMs(testEnv({ REQUEST_TIMEOUT_MS: "60000" }))).toBe(65_000);
  });

  test("an explicit value wins", () => {
    expect(shutdownDrainMs(testEnv({ SHUTDOWN_DRAIN_MS: "30000" }))).toBe(30_000);
  });

  test("warns at boot only when the drain is shorter than the request deadline", () => {
    expect(shutdownDrainWarning(testEnv())).toBeNull();
    expect(shutdownDrainWarning(testEnv({ SHUTDOWN_DRAIN_MS: "120000" }))).toBeNull();
    const w = shutdownDrainWarning(testEnv({ SHUTDOWN_DRAIN_MS: "30000" }));
    expect(w).toContain("SHUTDOWN_DRAIN_MS (30000 ms)");
    expect(w).toContain("REQUEST_TIMEOUT_MS (120000 ms)");
  });
});

/** A promise plus its resolver, to hold a stream open until the test lets it end. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

function startApp(followUps: () => Promise<string[]>) {
  const env = testEnv({ API_KEY });
  const { graph } = fakeGraph({
    intent: intentOf({ primary_intent: "financial_viability", destinations: ["australia"], user_question: "Cost?" }),
    answer: "Tuition is AUD 20k–45k [1].",
  });
  const store = new InMemoryChatStore();
  const logger = createLogger({ test: true });
  const service = new ChatService({ env, graph, store, logger, extras: { title: async () => "Title", followUps } });
  const app = createApp(
    {
      env,
      service,
      store,
      knowledge: new NullKnowledgeStore([sampleChunk()]),
      collections: null,
      logger,
      readiness: async () => ({ ok: true, checks: { mongodb: "ok" } }),
      startedAt: Date.now(),
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  return { app, base: `http://127.0.0.1:${app.server.port}` };
}

/** Read NDJSON events until `stop` matches one (or the stream ends); returns what was read. */
async function readUntil(reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> }, stop: (event: string) => boolean) {
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { events, ended: true };
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const event = (JSON.parse(line) as { event: string }).event;
      events.push(event);
      if (stop(event)) return { events, ended: false };
    }
  }
}

describe("draining on SIGTERM", () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  test("an in-flight stream finishes during the drain; new work and readiness get 503, liveness stays up", async () => {
    const held = gate();
    const { app, base } = startApp(async () => {
      await held.p;
      return ["Which intake is next?"];
    });
    cleanup = () => app.shutdown(0);

    const r = await fetch(base + "/v1/chat/stream?format=ndjson", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", newSession: true }) });
    const reader = r.body!.getReader();
    // The answer is out; the stream stays open for the post-answer follow-ups, which are held.
    await readUntil(reader, (e) => e === "done");

    let drained = false;
    const draining = app.shutdown(10_000).then(() => (drained = true));
    await Bun.sleep(150);
    expect(app.draining).toBe(true);
    expect(app.inFlight).toBe(1);
    expect(drained).toBe(false);

    const chat = await fetch(base + "/v1/chat", { method: "POST", headers, body: JSON.stringify({ message: "Cost?" }) });
    expect(chat.status).toBe(503);
    expect(((await chat.json()) as { error: { code: string } }).error.code).toBe("shutting_down");
    expect(chat.headers.get("connection")).toBe("close");
    const ready = await fetch(base + "/readyz");
    expect(ready.status).toBe(503);
    expect(((await ready.json()) as { status: string }).status).toBe("shutting_down");
    expect((await fetch(base + "/healthz")).status).toBe(200);

    held.open();
    const rest = await readUntil(reader, () => false);
    expect(rest.ended).toBe(true);
    expect(rest.events).toContain("suggestions");
    await draining;
    expect(drained).toBe(true);
    expect(app.inFlight).toBe(0);
  });

  test("the drain budget bounds a stream that never ends", async () => {
    const never = gate();
    const { app, base } = startApp(async () => {
      await never.p;
      return [];
    });
    cleanup = async () => never.open();

    const r = await fetch(base + "/v1/chat/stream?format=ndjson", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", newSession: true }) });
    await readUntil(r.body!.getReader(), (e) => e === "done");

    const started = Date.now();
    await app.shutdown(300);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(2_000);
  });

  test("a client that disconnects mid-stream is no longer in flight", async () => {
    const never = gate();
    const { app, base } = startApp(async () => {
      await never.p;
      return [];
    });
    cleanup = async () => {
      never.open();
      await app.shutdown(0);
    };

    const ctl = new AbortController();
    const r = await fetch(base + "/v1/chat/stream?format=ndjson", { method: "POST", headers, body: JSON.stringify({ message: "Cost?", newSession: true }), signal: ctl.signal });
    await readUntil(r.body!.getReader(), (e) => e === "done");
    expect(app.inFlight).toBe(1);
    ctl.abort();
    for (let i = 0; i < 50 && app.inFlight > 0; i++) await Bun.sleep(20);
    expect(app.inFlight).toBe(0);
  });
});

describe("createShutdown", () => {
  const quiet = createLogger({ test: true });

  function harness(over: { drain?: (ms: number) => Promise<void>; flush?: () => Promise<void> } = {}) {
    const calls: string[] = [];
    const exits: number[] = [];
    const shutdown = createShutdown({
      drainMs: 100,
      flushMs: 100,
      logger: quiet,
      drain: over.drain ?? (async (ms) => void calls.push(`drain:${ms}`)),
      flush: over.flush ?? (async () => void calls.push("flush")),
      exit: (code) => void exits.push(code),
    });
    return { shutdown, calls, exits };
  }

  test("drains with the configured budget, then flushes, then exits 0", async () => {
    const h = harness();
    await h.shutdown("SIGTERM");
    expect(h.calls).toEqual(["drain:100", "flush"]);
    expect(h.exits).toEqual([0]);
    // The hard-exit timer was cleared: nothing else fires later.
    await Bun.sleep(250);
    expect(h.exits).toEqual([0]);
  });

  test("a second signal is ignored", async () => {
    const h = harness();
    await Promise.all([h.shutdown("SIGTERM"), h.shutdown("SIGINT")]);
    expect(h.calls).toEqual(["drain:100", "flush"]);
    expect(h.exits).toEqual([0]);
  });

  test("hard-exits with 1 at drain + flush budget when the drain hangs", async () => {
    const h = harness({ drain: () => new Promise(() => {}) });
    const started = Date.now();
    void h.shutdown("SIGTERM");
    await Bun.sleep(150);
    expect(h.exits).toEqual([]);
    for (let i = 0; i < 50 && !h.exits.length; i++) await Bun.sleep(10);
    expect(h.exits).toEqual([1]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  test("hard-exits when the flush hangs", async () => {
    const h = harness({ flush: () => new Promise(() => {}) });
    void h.shutdown("SIGTERM");
    for (let i = 0; i < 50 && !h.exits.length; i++) await Bun.sleep(10);
    expect(h.exits).toEqual([1]);
  });

  test("a drain error still exits non-zero", async () => {
    const h = harness({ drain: async () => Promise.reject(new Error("boom")) });
    await h.shutdown("SIGTERM");
    expect(h.exits).toEqual([1]);
  });
});
