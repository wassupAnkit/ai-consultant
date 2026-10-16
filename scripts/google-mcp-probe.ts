/**
 * Phase 0 spike: what Google's Gmail and Drive MCP servers (developer preview) really do.
 * Manual only, never run in tests. Uses raw fetch, not McpHttpClient, so it shows the wire.
 *
 * Runs a loopback OAuth for one account (PKCE S256, offline, consent), then on each server:
 * initialize → notifications/initialized → tools/list → one search call. It prints the
 * response content type (JSON or SSE), whether an Mcp-Session-Id is issued, every tool's name,
 * annotations and inputSchema, the scopes Google granted, and the SHAPE of one search result and
 * one follow-up read (key paths, types and lengths; ids, links and MIME types kept verbatim,
 * text replaced by `<string, N chars>`) — which fix the allowlists and the deep-link parsing in
 * src/google/provider.ts and src/tools/workspace.ts. `--raw` prints real content instead; it is
 * the consultant's mail, so keep it out of chat transcripts.
 *
 *   GOOGLE_WORKSPACE_CLIENT_ID=… GOOGLE_WORKSPACE_CLIENT_SECRET=… bun run scripts/google-mcp-probe.ts
 *   bun run scripts/google-mcp-probe.ts --refresh-token <t>          # skip the consent step
 *   bun run scripts/google-mcp-probe.ts --print-refresh-token        # show it, to reuse above
 *   bun run scripts/google-mcp-probe.ts --port 8765 --login-hint jane@heubert.com
 *   bun run scripts/google-mcp-probe.ts --client-json ~/Downloads/client_secret_….json  # the console download
 *   bun run scripts/google-mcp-probe.ts --raw                         # real content, first 1500 chars
 *
 * The OAuth client must allow the redirect `http://127.0.0.1:<port>/callback` (a Desktop
 * client allows any loopback port; a Web client needs it listed).
 */
import { parseArgs } from "node:util";
import { IDENTITY_SCOPES, SERVICE_SCOPES } from "../src/google/types";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "8765" },
    "refresh-token": { type: "string" },
    "print-refresh-token": { type: "boolean", default: false },
    "login-hint": { type: "string" },
    raw: { type: "boolean", default: false },
    "client-json": { type: "string" },
    "gmail-url": { type: "string", default: "https://gmailmcp.googleapis.com/mcp/v1" },
    "drive-url": { type: "string", default: "https://drivemcp.googleapis.com/mcp/v1" },
  },
});

/** The console's "Download JSON" file ({ web: { client_id, client_secret } }), so the secret is never copied by hand. */
const clientFile = values["client-json"]
  ? ((await Bun.file(values["client-json"].replace(/^~(?=\/)/, process.env.HOME ?? "~")).json()) as { web?: { client_id?: string; client_secret?: string } }).web
  : undefined;
const clientId = clientFile?.client_id ?? process.env.GOOGLE_WORKSPACE_CLIENT_ID;
const clientSecret = clientFile?.client_secret ?? process.env.GOOGLE_WORKSPACE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Pass --client-json <downloaded client file>, or set GOOGLE_WORKSPACE_CLIENT_ID and GOOGLE_WORKSPACE_CLIENT_SECRET.");
  process.exit(1);
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const port = Number(values.port);
const redirectUri = `http://127.0.0.1:${port}/callback`;
const scopes = [...IDENTITY_SCOPES, ...SERVICE_SCOPES.gmail, ...SERVICE_SCOPES.drive];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function tokenRequest(params: Record<string, string>): Promise<Json> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) throw new Error(`token endpoint HTTP ${res.status}: ${body.error ?? ""} ${body.error_description ?? ""}`);
  return body;
}

/** Loopback consent: print the URL, wait for Google to redirect back with ?code. */
async function consent(): Promise<Json> {
  const verifier = randomToken();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomToken();
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...(values["login-hint"] ? { login_hint: values["login-hint"] } : {}),
  }).toString();

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
      if (url.searchParams.get("state") !== state) {
        reject(new Error("state mismatch"));
        return new Response("State mismatch.", { status: 400 });
      }
      const error = url.searchParams.get("error");
      if (error) {
        reject(new Error(`consent refused: ${error}`));
        return new Response(`Consent refused: ${error}`, { status: 400 });
      }
      resolve(url.searchParams.get("code") ?? "");
      return new Response("Done. You can close this tab and return to the terminal.");
    },
  });

  console.log(`\nOpen this URL and consent (listening on ${redirectUri}):\n\n${auth}\n`);
  try {
    const code = await promise;
    return await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  } finally {
    server.stop(true);
  }
}

/** Every JSON-RPC message on an SSE body (the probe reads it to the end; it wants to see all of them). */
function parseSse(text: string): Json[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter(Boolean)
    .flatMap((data) => {
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [{ unparsed: data.slice(0, 200) }];
      }
    });
}

type Call = { name: string; args: Json };

async function probe(label: string, url: string, accessToken: string, search: (tools: Json[]) => Call | null, read?: (tools: Json[], searched: Json) => Call | null, fallback?: (tools: Json[]) => Call | null) {
  console.log(`\n=== ${label}: ${url}`);
  let sessionId: string | undefined;
  let id = 1;

  const post = async (method: string, params?: Json, notification = false) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${accessToken}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: id++ }), method, ...(params ? { params } : {}) }),
    });
    const contentType = res.headers.get("content-type") ?? "(none)";
    const text = await res.text();
    const messages = contentType.includes("text/event-stream") ? parseSse(text) : text ? [JSON.parse(text)] : [];
    console.log(`- ${method}: HTTP ${res.status}, content-type ${contentType}, ${messages.length} message(s)${res.headers.get("mcp-session-id") ? ", Mcp-Session-Id issued" : ""}`);
    if (!res.ok) console.log(`  body: ${text.slice(0, 500)}`);
    return { res, messages, message: messages.find((m) => "result" in m || "error" in m) as Json | undefined };
  };

  const init = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "edge-probe", version: "0.0.1" } });
  sessionId = init.res.headers.get("mcp-session-id") ?? undefined;
  console.log(`  Mcp-Session-Id: ${sessionId ? "present" : "absent"}`);
  if (init.message?.result) console.log(`  server: ${JSON.stringify(init.message.result.serverInfo)} protocol ${init.message.result.protocolVersion} capabilities ${JSON.stringify(init.message.result.capabilities)}`);
  if (!init.res.ok) return;

  await post("notifications/initialized", undefined, true);

  const list = await post("tools/list");
  const tools = (list.message?.result?.tools ?? []) as Json[];
  if (list.message?.error) console.log(`  error: ${JSON.stringify(list.message.error)}`);
  console.log(`  ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  for (const t of tools) {
    console.log(`\n  • ${t.name}${t.title ? ` (${t.title})` : ""}`);
    console.log(`    annotations: ${t.annotations ? JSON.stringify(t.annotations) : "(none — readOnlyHint absent)"}`);
    console.log(`    inputSchema: ${JSON.stringify(t.inputSchema)}`);
    if (t.outputSchema) console.log(`    outputSchema: ${JSON.stringify(t.outputSchema).slice(0, 800)}`);
  }

  const call = search(tools);
  if (!call) {
    console.log("\n  (no search tool listed; skipping the call)");
    return;
  }
  const callAndShow = async (c: { name: string; args: Json }) => {
    const out = await post("tools/call", { name: c.name, arguments: c.args });
    const result = out.message?.result as Json | undefined;
    console.log(`\n  ${c.name}(${JSON.stringify(c.args)}):`);
    if (out.message?.error) console.log(`  error: ${JSON.stringify(out.message.error)}`);
    if (result) {
      console.log(`  isError: ${result.isError === true}; content types: ${(result.content ?? []).map((x: Json) => x.type).join(", ") || "(none)"}`);
      console.log(`  structuredContent keys: ${result.structuredContent ? Object.keys(result.structuredContent).join(", ") : "(none)"}`);
      // An error is the server's message, not the consultant's mail: always shown in full.
      if (result.isError) console.log(`  error text: ${(result.content ?? []).map((x: Json) => x.text ?? "").join(" | ")}`);
      else if (values.raw) console.log(`  raw (first 1500 chars):\n${JSON.stringify(result, null, 2).slice(0, 1500)}`);
      else console.log(`  shape:\n${JSON.stringify(shapeOf(withParsedText(result)), null, 2).slice(0, 4000)}`);
    }
    return result;
  };

  let searched = await callAndShow(call);
  // A refused search says nothing about where ids live; try the fallback before giving up.
  const fallbackCall = searched?.isError ? fallback?.(tools) : null;
  if (fallbackCall) searched = await callAndShow(fallbackCall);
  // One follow-up read on the first id the search returned, to see where links and thread ids live.
  const followUp = searched && read?.(tools, withParsedText(searched));
  if (followUp) await callAndShow(followUp);
}

/** Tool results often carry JSON inside `content[].text`; parse it so its shape shows too. */
function withParsedText(result: Json): Json {
  return {
    ...result,
    content: (result.content ?? []).map((c: Json) => {
      if (c.type !== "text" || typeof c.text !== "string") return c;
      try {
        return { ...c, text: JSON.parse(c.text) };
      } catch {
        return c;
      }
    }),
  };
}

/** Keys whose values are identifiers, links or types rather than someone's words: shown verbatim. */
const KEEP_KEY = /(^|_)(id|ids)$|Id$|Ids$|link|Link|url|Url|uri|Uri|mime|Mime|kind|^type$|^labelIds$/;

/** The structure of a value with every free-text string replaced by its length. */
function shapeOf(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.length ? [`<${value.length} item(s), first:>`, shapeOf(value[0], key)] : [];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, k)]));
  if (typeof value === "string") return KEEP_KEY.test(key) || /^https?:\/\//.test(value) ? value : `<string, ${value.length} chars>`;
  return value;
}

/** First value under a key named like `idKey` anywhere in the result. */
function findFirst(value: unknown, idKey: RegExp): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findFirst(v, idKey);
      if (hit) return hit;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (idKey.test(k) && typeof v === "string" && v) return v;
    for (const v of Object.values(value)) {
      const hit = findFirst(v, idKey);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** A follow-up read: `toolName` with its id argument filled from the first matching id in the search result. */
function readCall(toolName: string, resultIdKey: RegExp) {
  return (tools: Json[], searched: Json) => {
    const t = tools.find((x) => x.name === toolName);
    const id = findFirst(searched, resultIdKey);
    if (!t || !id) return null;
    const props = Object.keys(t.inputSchema?.properties ?? {});
    const argKey = props.find((p) => /id$/i.test(p)) ?? props[0] ?? "id";
    return { name: toolName, args: { [argKey]: id } };
  };
}

/** Fill the search call's arguments from whatever the server's schema names them. */
function searchCall(toolName: string, query: string) {
  return (tools: Json[]) => {
    const t = tools.find((x) => x.name === toolName);
    if (!t) return null;
    const props = Object.keys(t.inputSchema?.properties ?? {});
    const queryKey = props.find((p) => /^(query|q)$/i.test(p)) ?? props.find((p) => /query/i.test(p)) ?? "query";
    const sizeKey = props.find((p) => /^page_?size$/i.test(p));
    return { name: toolName, args: { [queryKey]: query, ...(sizeKey ? { [sizeKey]: 3 } : {}) } };
  };
}

const tokens = values["refresh-token"] ? await tokenRequest({ grant_type: "refresh_token", refresh_token: values["refresh-token"] }) : await consent();
const accessToken = tokens.access_token as string | undefined;
if (!accessToken) {
  console.error("No access token came back.");
  process.exit(1);
}

const granted = String(tokens.scope ?? "").split(" ").filter(Boolean);
console.log(`\nGranted scopes (${granted.length}):\n${granted.map((s) => `  ${s}`).join("\n")}`);
const notGranted = scopes.filter((s) => !granted.includes(s) && !(s === "email" && granted.includes("https://www.googleapis.com/auth/userinfo.email")));
if (notGranted.length) console.log(`Requested but not granted: ${notGranted.join(", ")}`);
if (tokens.id_token) {
  const claims = JSON.parse(Buffer.from(String(tokens.id_token).split(".")[1]!, "base64url").toString()) as Json;
  console.log(`id_token: email ${claims.email}, hd ${claims.hd ?? "(none)"}, aud matches client: ${claims.aud === clientId}`);
}
if (tokens.refresh_token) {
  console.log(values["print-refresh-token"] ? `refresh_token: ${tokens.refresh_token}` : "refresh_token: issued (pass --print-refresh-token to show it)");
}
console.log(`access token expires in ${tokens.expires_in}s`);

/** A call with fixed arguments, when the server lists the tool. */
const plainCall = (toolName: string, args: Json) => (tools: Json[]) => (tools.some((t) => t.name === toolName) ? { name: toolName, args } : null);

await probe("Gmail", values["gmail-url"]!, accessToken, searchCall("search_threads", "newer_than:7d"), readCall("get_thread", /^(thread_?id|id)$/i), plainCall("search_threads", { pageSize: 3 }));
await probe("Drive", values["drive-url"]!, accessToken, searchCall("search_files", "offer letter"), readCall("get_file_metadata", /^(file_?id|id)$/i), plainCall("list_recent_files", { pageSize: 3, excludeContentSnippets: true }));
