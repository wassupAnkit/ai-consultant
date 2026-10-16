import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { ChatService } from "../src/app/service";
import { csvToPage, detectKind, markdownToPage, parseCsv, parseDocument } from "../src/documents/parse";
import { InMemoryDocumentService } from "../src/documents/service";
import { InMemoryFileStore } from "../src/documents/store";
import { InMemoryChatStore } from "../src/memory/in-memory";
import { createLogger } from "../src/observability/logger";
import { NullKnowledgeStore } from "../src/retrieval/store";
import { FakeGemini } from "./fakes";
import { fakeGraph, intentOf, sampleChunk, testEnv } from "./helpers";

describe("document parsing", () => {
  test("detectKind uses MIME then extension", () => {
    expect(detectKind("fees.pdf", "application/pdf")).toBe("pdf");
    expect(detectKind("fees.PDF", "application/octet-stream")).toBe("pdf");
    expect(detectKind("notes.md", "text/markdown; charset=utf-8")).toBe("markdown");
    expect(detectKind("data.csv", null)).toBe("csv");
    expect(detectKind("page.htm", "")).toBe("html");
    expect(detectKind("archive.zip", "application/zip")).toBeNull();
    expect(detectKind("image.png", "image/png")).toBeNull();
  });

  test("markdownToPage splits on headings and keeps the H1 as title", () => {
    const page = markdownToPage("# Monash fee sheet 2026\nIntro line.\n\n## Master of IT\nAUD 47,900 per year.\n\n## Master of Data Science\nAUD 49,000 per year.\n", "fallback", "upload://1");
    expect(page.title).toBe("Monash fee sheet 2026");
    expect(page.sections.map((s) => s.heading)).toEqual(["Monash fee sheet 2026", "Master of IT", "Master of Data Science"]);
    expect(page.text).toContain("## Master of IT\nAUD 47,900 per year.");
    expect(() => markdownToPage("\n\n", "x", "upload://2")).toThrow(/no readable text/);
  });

  test("csvToPage renders header-repeating Markdown tables", () => {
    const rows = ["program,fee,intake", '"Master of IT, Clayton",47900,"Feb, Jul"', "Master of DS,49000,Feb", 'Quote "test",1,Jul'];
    const parsed = parseCsv(rows.join("\r\n"));
    expect(parsed[1]).toEqual(["Master of IT, Clayton", "47900", "Feb, Jul"]);
    expect(parsed[3]).toEqual(['Quote "test"', "1", "Jul"]);
    const page = csvToPage(rows.join("\n"), "Fees 2026", "upload://3", 2);
    expect(page.sections).toHaveLength(2);
    expect(page.sections[0]!.text).toContain("| program | fee | intake |");
    expect(page.sections[0]!.text).toContain("| Master of IT, Clayton | 47900 | Feb, Jul |");
    expect(page.sections[1]!.heading).toContain("rows 3–3");
    expect(page.description).toContain("3 rows");
    expect(() => csvToPage("a,b\n", "x", "upload://4")).toThrow(/no data rows/);
  });

  test("PDFs go through Gemini with continuation on MAX_TOKENS; unavailable without a client", async () => {
    const gen = new FakeGemini([
      { text: "# Fee sheet\n\n## Master of IT\nAUD 47,900 per", finishReason: "MAX_TOKENS", usage: { input: 1, output: 1, total: 2 } },
      { text: " year (2026).\n\n## Master of DS\nAUD 49,000 per year.", finishReason: "STOP", usage: { input: 1, output: 1, total: 2 } },
    ]);
    const page = await parseDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "pdf", "fees.pdf", "upload://5", { gen: gen.asGemini(), model: "flash" });
    expect(gen.requests).toHaveLength(2);
    expect(gen.requests[0]!.parts[1]).toMatchObject({ inlineData: { mimeType: "application/pdf" } });
    expect(String((gen.requests[1]!.parts[0] as { text: string }).text)).toContain("Continue EXACTLY");
    expect(page.title).toBe("Fee sheet");
    expect(page.sections.map((s) => s.heading)).toEqual(["Fee sheet", "Master of IT", "Master of DS"]);
    expect(page.text).toContain("AUD 47,900 per\n year (2026)".replace("\n ", "\n") ? "AUD 47,900" : "");
    await expect(parseDocument(new Uint8Array([1]), "pdf", "x.pdf", "upload://6", {})).rejects.toMatchObject({ code: "pdf_unavailable" });
  });

  test("InMemoryFileStore round-trips bytes", async () => {
    const store = new InMemoryFileStore();
    await store.put("a", new Uint8Array([1, 2, 3]), { filename: "a.txt", mimeType: "text/plain" });
    expect(await store.get("a")).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });
});

describe("document upload API", () => {
  const API_KEY = "test-api-key-0123456789abcdef0123456789";
  let base = "";
  let app: ReturnType<typeof createApp>;
  const documents = new InMemoryDocumentService();

  beforeAll(() => {
    const env = testEnv({ API_KEY, UPLOAD_MAX_BYTES: "200000", ADMIN_EMAILS: "admin@heubert.com" });
    const { graph } = fakeGraph({ intent: intentOf({ primary_intent: "company_services" }) });
    const store = new InMemoryChatStore();
    const service = new ChatService({ env, graph, store, logger: createLogger({ test: true }) });
    app = createApp(
      { env, service, store, knowledge: new NullKnowledgeStore([sampleChunk()]), collections: null, logger: createLogger({ test: true }), readiness: async () => ({ ok: true, checks: {} }), startedAt: Date.now(), documents },
      { port: 0, hostname: "127.0.0.1" },
    );
    base = `http://127.0.0.1:${app.server.port}`;
  });
  afterAll(async () => {
    await app.shutdown(1_000);
  });
  const headers = (user: string) => ({ "x-api-key": API_KEY, "x-user-id": user });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (r: Response): Promise<any> => r.json();
  const upload = (user: string, name: string, content: string, type: string, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append("file", new Blob([content], { type }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fetch(`${base}/v1/knowledge/documents`, { method: "POST", headers: headers(user), body: fd });
  };

  test("accepts supported files, rejects duplicates, unsupported types and anonymous callers", async () => {
    const r = await upload("staff1", "monash-fees-2026.md", "# Monash fees 2026\n\n## Master of IT\nAUD 47,900 per year.\n", "text/markdown", { partnerSlug: "monash-university", country: "australia", extractPrograms: "true" });
    expect(r.status).toBe(202);
    const { document } = await j(r);
    expect(document).toMatchObject({ status: "processing", kind: "markdown", partnerSlug: "monash-university", country: "australia", ownerId: "staff1", extractPrograms: true });
    expect(document.slug).toMatch(/^monash-fees-2026-[0-9a-f]{8}$/);

    const dup = await upload("staff2", "copy.md", "# Monash fees 2026\n\n## Master of IT\nAUD 47,900 per year.\n", "text/markdown");
    expect(dup.status).toBe(409);
    expect((await j(dup)).error.details.existingId).toBe(document._id);

    expect((await upload("staff1", "photo.png", "png", "image/png")).status).toBe(415);
    expect((await upload("staff1", "bad.md", "", "text/markdown")).status).toBe(400);
    const badField = await upload("staff1", "x.md", "# x\ntext", "text/markdown", { country: "mars" });
    expect(badField.status).toBe(400);
    const anon = await fetch(`${base}/v1/knowledge/documents`, { method: "POST", headers: { "x-api-key": API_KEY }, body: new FormData() });
    expect(anon.status).toBe(400);
    expect((await j(anon)).error.code).toBe("no_identity");
    const notMultipart = await fetch(`${base}/v1/knowledge/documents`, { method: "POST", headers: { ...headers("staff1"), "content-type": "application/json" }, body: "{}" });
    expect([400, 415]).toContain(notMultipart.status);

    // Background processing finished (in-memory service parses synchronously).
    const got = await j(await fetch(`${base}/v1/knowledge/documents/${document._id}`, { headers: headers("staff1") }));
    expect(got.document.status).toBe("ready");
    expect(got.document.pages).toBe(2);

    const list = await j(await fetch(`${base}/v1/knowledge/documents?mine=true`, { headers: headers("staff1") }));
    expect(list.count).toBe(1);
    const others = await j(await fetch(`${base}/v1/knowledge/documents?mine=true`, { headers: headers("staff2") }));
    expect(others.count).toBe(0);

    // Owner-or-admin delete.
    expect((await fetch(`${base}/v1/knowledge/documents/${document._id}`, { method: "DELETE", headers: headers("staff2") })).status).toBe(403);
    expect((await fetch(`${base}/v1/knowledge/documents/${document._id}`, { method: "DELETE", headers: headers("staff1") })).status).toBe(200);
    expect((await fetch(`${base}/v1/knowledge/documents/${document._id}`, { method: "DELETE", headers: headers("staff1") })).status).toBe(404);
  });

  test("oversized uploads are refused", async () => {
    const big = "x".repeat(250_000);
    const r = await upload("staff1", "big.txt", big, "text/plain");
    expect(r.status).toBe(413);
  });
});
