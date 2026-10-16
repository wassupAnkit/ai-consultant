import { describe, expect, test } from "bun:test";
import { createWorkspaceProvider, REST_STICKY_MS } from "../src/google/provider";
import { buildDraftMime, callRest, driveQuery } from "../src/google/rest";
import type { AccessTokenSource } from "../src/google/types";
import { McpError } from "../src/mcp/client";
import { EvidenceCollector } from "../src/tools/evidence";
import { makeWorkspaceTools, workspaceWebUrl } from "../src/tools/workspace";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Req {
  url: URL;
  method: string;
  body: any;
  auth: string;
}

/** The Gmail and Drive REST APIs (and, for the provider tests, the two MCP servers) behind one fetch. */
function google(routes: (r: Req) => Response | undefined) {
  const sent: Req[] = [];
  const fetchImpl = (async (url: string, init: any = {}) => {
    const r: Req = { url: new URL(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization ?? "" };
    sent.push(r);
    return routes(r) ?? new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const opts = (fetchImpl: typeof fetch) => ({ token: "at-1", timeoutMs: 5_000, fetchImpl });

const message = (id: string, threadId: string, headers: Record<string, string>, payload: object = {}) => ({
  id,
  threadId,
  labelIds: ["INBOX"],
  snippet: `snippet of ${id}`,
  internalDate: String(Date.UTC(2026, 9, 1, 9, 30)),
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })), ...payload },
});

describe("Gmail over REST", () => {
  test("search_threads passes the Gmail query and returns the latest message of each thread", async () => {
    const { sent, fetchImpl } = google((r) => {
      if (r.url.pathname.endsWith("/threads")) return json({ threads: [{ id: "18fthreadA1" }] });
      if (r.url.pathname.endsWith("/threads/18fthreadA1"))
        return json({ messages: [message("m1", "18fthreadA1", { Subject: "CoE", From: "a@x.test" }), message("m2", "18fthreadA1", { Subject: "Re: CoE", From: "agent@uni.test", To: "jane@heubert.com" })] });
    });
    const out = await callRest("gmail", "search_threads", { query: "in:inbox", pageSize: 99 }, opts(fetchImpl));

    expect(sent[0]!.url.searchParams.get("q")).toBe("in:inbox");
    expect(sent[0]!.url.searchParams.get("maxResults")).toBe("25");
    expect(sent[0]!.auth).toBe("Bearer at-1");
    expect(sent[1]!.url.searchParams.get("format")).toBe("metadata");
    expect(out.isError).toBe(false);
    expect(out.text).toContain("From: agent@uni.test — Subject: Re: CoE (2 messages)");
    expect(out.structured).toMatchObject({ threads: [{ id: "18fthreadA1", subject: "Re: CoE", sender: "agent@uni.test", messageCount: 2 }] });
    // The thread id where workspace.ts looks for it, so the citation opens the thread.
    expect(workspaceWebUrl("gmail", "search_threads", {}, out, "jane@heubert.com")).toBe("https://mail.google.com/mail/u/?authuser=jane%40heubert.com#all/18fthreadA1");
  });

  test("get_thread reads plain-text bodies, falls back to HTML as text, and lists attachments", async () => {
    const { fetchImpl } = google((r) => {
      if (r.url.pathname.endsWith("/threads/18fthreadB2"))
        return json({
          id: "18fthreadB2",
          messages: [
            message("m1", "18fthreadB2", { From: "a@x.test", Subject: "Offer" }, { mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: b64("Priya's offer is attached.") } }, { mimeType: "application/pdf", filename: "offer.pdf", body: { attachmentId: "att1" } }] }),
            message("m2", "18fthreadB2", { From: "b@x.test", Subject: "Re: Offer" }, { mimeType: "text/html", body: { data: b64("<p>Thanks &amp; noted.</p><script>x()</script>") } }),
          ],
        });
    });
    const out = await callRest("gmail", "get_thread", { threadId: "18fthreadB2" }, opts(fetchImpl));
    expect(out.text).toContain("Priya's offer is attached.");
    expect(out.text).toContain("Attachments: offer.pdf");
    expect(out.text).toContain("Thanks & noted.");
    expect(out.text).not.toContain("x()");
    expect(out.structured).toMatchObject({ threadId: "18fthreadB2" });
  });

  test("a refused request is an isError result; a rejected token throws an auth McpError", async () => {
    const notFound = await callRest("gmail", "get_message", { messageId: "nope123" }, opts(google(() => json({ error: { message: "Requested entity was not found." } }, 404)).fetchImpl));
    expect(notFound).toEqual({ text: "Gmail API HTTP 404: Requested entity was not found.", isError: true });

    const err = await callRest("gmail", "get_message", { messageId: "m1" }, opts(google(() => json({}, 401)).fetchImpl)).catch((e) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).kind).toBe("auth");
  });

  test("create_draft saves a draft (never sends), threaded as a reply when asked", async () => {
    const { sent, fetchImpl } = google((r) => {
      if (r.url.pathname.endsWith("/messages/orig1")) return json(message("orig1", "18fthreadC3", { Subject: "Passport scan", "Message-ID": "<abc@mail.test>" }));
      if (r.method === "POST" && r.url.pathname.endsWith("/drafts")) return json({ id: "r-123", message: { id: "m9", threadId: "18fthreadC3" } });
    });
    const out = await callRest("gmail", "create_draft", { to: ["priya@x.test"], body: "Could you send your passport scan?", replyToMessageId: "orig1" }, opts(fetchImpl));

    const post = sent.find((r) => r.method === "POST")!;
    expect(post.url.pathname).toBe("/gmail/v1/users/me/drafts");
    expect(sent.some((r) => /\/send$/.test(r.url.pathname))).toBe(false);
    expect(post.body.message.threadId).toBe("18fthreadC3");
    const mime = Buffer.from(post.body.message.raw, "base64url").toString("utf8");
    expect(mime).toContain("To: priya@x.test");
    expect(mime).toContain("Subject: Re: Passport scan");
    expect(mime).toContain("In-Reply-To: <abc@mail.test>");
    expect(out).toMatchObject({ isError: false, structured: { id: "r-123", threadId: "18fthreadC3" } });
  });

  test("create_draft refuses attachments", async () => {
    const out = await callRest("gmail", "create_draft", { to: ["a@x.test"], attachments: [{ content: "eA==" }] }, opts(google(() => undefined).fetchImpl));
    expect(out.isError).toBe(true);
  });

  test("draft MIME: a line break in model-written header text cannot add a header; non-ASCII subjects are encoded", () => {
    const mime = buildDraftMime({ to: ["a@x.test\r\nBcc: evil@x.test"], cc: [], bcc: [], subject: "Visa — next steps\nX-Evil: 1", body: "Hi" });
    expect(mime).not.toMatch(/\r\nBcc: evil/);
    expect(mime).not.toMatch(/\r\nX-Evil/);
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
  });
});

describe("Drive over REST", () => {
  test("plain words become a full-text search; Drive syntax is passed through", () => {
    expect(driveQuery("Monash offer letter")).toBe("fullText contains 'Monash offer letter' and trashed = false");
    expect(driveQuery("Priya's CoE")).toBe("fullText contains 'Priya\\'s CoE' and trashed = false");
    expect(driveQuery("name contains 'CoE'")).toBe("(name contains 'CoE') and trashed = false");
    expect(driveQuery(undefined)).toBe("trashed = false");
  });

  test("search_files returns files with their links, across shared drives", async () => {
    const { sent, fetchImpl } = google((r) => {
      if (r.url.pathname === "/drive/v3/files") return json({ files: [{ id: "1AbCdEfGhIj", name: "Monash offer.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIj/view" }] });
    });
    const out = await callRest("drive", "search_files", { query: "Monash offer" }, opts(fetchImpl));
    expect(sent[0]!.url.searchParams.get("corpora")).toBe("allDrives");
    expect(out.text).toContain("Monash offer.pdf");
    expect(workspaceWebUrl("drive", "search_files", {}, out, "jane@heubert.com")).toBe("https://drive.google.com/file/d/1AbCdEfGhIj/view");
  });

  test("read_file_content exports a Google Doc as text, and gives a PDF's details only", async () => {
    const { fetchImpl } = google((r) => {
      if (r.url.pathname === "/drive/v3/files/doc1") return json({ id: "doc1", name: "SOP", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/doc1/edit" });
      if (r.url.pathname === "/drive/v3/files/doc1/export") return new Response("Step 1: check the CoE.");
      if (r.url.pathname === "/drive/v3/files/pdf1") return json({ id: "pdf1", name: "Offer.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/pdf1/view" });
    });
    const doc = await callRest("drive", "read_file_content", { fileId: "doc1" }, opts(fetchImpl));
    expect(doc.text).toContain("Step 1: check the CoE.");
    expect(doc.structured).toMatchObject({ title: "SOP", webViewLink: "https://docs.google.com/document/d/doc1/edit" });

    const pdf = await callRest("drive", "read_file_content", { fileId: "pdf1" }, opts(fetchImpl));
    expect(pdf.text).toContain("cannot be read here");
  });
});

describe("provider transport", () => {
  const GMAIL_MCP = "https://gmailmcp.example.test/mcp/v1";
  const DRIVE_MCP = "https://drivemcp.example.test/mcp/v1";
  const PREVIEW = "Access to this tool requires that your Google Cloud project (1) is enrolled in the Google Workspace Developer Preview Program.";
  const tokens: AccessTokenSource = { accessToken: async () => ({ ok: true, token: "at-1", services: ["gmail", "drive"] }), invalidate: () => {} };

  /** MCP servers that list tools but refuse every call (the preview gate), plus the REST API. */
  function previewGated() {
    return google((r) => {
      if (r.url.toString() === GMAIL_MCP || r.url.toString() === DRIVE_MCP) {
        if (r.body.id === undefined) return new Response(null, { status: 202 });
        const tools = [{ name: "search_threads", description: "search", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } }];
        const result = r.body.method === "tools/list" ? { tools } : r.body.method === "tools/call" ? { content: [{ type: "text", text: PREVIEW }], isError: true } : {};
        return json({ jsonrpc: "2.0", id: r.body.id, result });
      }
      if (r.url.pathname.endsWith("/threads")) return json({ threads: [] });
    });
  }

  const make = (fetchImpl: typeof fetch, transport?: "auto" | "mcp" | "rest") =>
    createWorkspaceProvider({ tokens, gmailUrl: GMAIL_MCP, driveUrl: DRIVE_MCP, timeoutMs: 5_000, allowDrafts: false, fetchImpl, ...(transport ? { transport } : {}) });

  test("auto: a preview refusal is answered from REST, and later calls go straight to REST", async () => {
    const { sent, fetchImpl } = previewGated();
    const gmail = (await make(fetchImpl).forActor("jane@heubert.com")).gmail!;

    const first = await gmail.call("gmail_search_threads", { query: "in:inbox" });
    expect(first).toMatchObject({ isError: false, text: "No Gmail threads matched that search." });
    const mcpCalls = () => sent.filter((r) => r.body?.method === "tools/call").length;
    expect(mcpCalls()).toBe(1);

    await gmail.call("gmail_search_threads", { query: "in:inbox" });
    expect(mcpCalls()).toBe(1);
    expect(sent.filter((r) => r.url.pathname.endsWith("/threads")).length).toBe(2);
    expect(REST_STICKY_MS).toBeGreaterThan(0);
  });

  test("the research tool sees the REST answer, not the refusal", async () => {
    const { fetchImpl } = previewGated();
    const gmail = (await make(fetchImpl).forActor("jane@heubert.com")).gmail!;
    const [search] = makeWorkspaceTools(gmail, "gmail", { collector: new EvidenceCollector(), actor: "jane@heubert.com" });
    expect(String(await search!.invoke({ query: "in:inbox" }))).not.toMatch(/^error/);
  });

  test("mcp: no fallback, the refusal comes back as it is", async () => {
    const { fetchImpl } = previewGated();
    const gmail = (await make(fetchImpl, "mcp").forActor("jane@heubert.com")).gmail!;
    expect(await gmail.call("gmail_search_threads", {})).toMatchObject({ isError: true, text: PREVIEW });
  });

  test("rest: the MCP servers are never contacted", async () => {
    const { sent, fetchImpl } = previewGated();
    const out = await make(fetchImpl, "rest").forActor("jane@heubert.com");
    expect(out.gmail!.descriptors.map((d) => d.name)).toEqual(["gmail_search_threads", "gmail_get_thread", "gmail_get_message", "gmail_list_drafts"]);
    expect(out.drive!.descriptors.map((d) => d.name)).toEqual(["drive_search_files", "drive_read_file_content", "drive_get_file_metadata", "drive_list_recent_files"]);
    await out.gmail!.call("gmail_search_threads", {});
    expect(sent.some((r) => r.url.toString() === GMAIL_MCP || r.url.toString() === DRIVE_MCP)).toBe(false);
  });
});
