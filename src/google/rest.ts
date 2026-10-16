/**
 * The same Gmail and Drive tools as Google's MCP servers, served from the plain Gmail and Drive
 * REST APIs with the consultant's own access token.
 *
 * Why it exists: the MCP servers are a developer preview and refuse every call from a Cloud
 * project not enrolled in Google's Workspace Developer Preview Program (and the program's terms
 * let Google use data that passes through pre-GA APIs). The REST APIs are generally available,
 * need no enrolment, and take the scopes the consultant already granted (gmail.readonly,
 * gmail.compose, drive.readonly). `src/google/provider.ts` decides when this path is used.
 *
 * The contract mirrors the MCP tools on purpose: the same server tool names, the same argument
 * names (threadId, messageId, fileId, query, pageSize, to/cc/bcc as arrays), and results whose
 * `structured` payload carries the ids and links `src/tools/workspace.ts` turns into
 * "Open in Gmail/Drive". So nothing above the provider knows which path answered.
 *
 * Never sends mail: the only write is `drafts.create`.
 */
import { McpError } from "../mcp/client";
import type { McpToolDescriptor, McpToolResult } from "../mcp/types";
import { CALENDAR_DESCRIPTORS, CALENDAR_HANDLERS } from "./rest-calendar";
import { DOCS_DESCRIPTORS, DOCS_HANDLERS } from "./rest-docs";
import { http, list, obj, pageSize, qs, RestRefused, s, str, strings, type Obj, type RestCallOptions } from "./rest-shared";
import { SERVICE_LABELS, type WorkspaceService } from "./types";

export type { RestCallOptions } from "./rest-shared";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3";

/** Per-message body cap before the evidence layer's own cap; a thread of long emails stays readable. */
const MAX_BODY = 4_000;
/** Text read from one Drive file before the evidence layer caps it again. */
const MAX_FILE_TEXT = 50_000;
const read = { readOnlyHint: true } as const;

/** Server-named descriptors (unprefixed), used when the MCP server cannot list its tools. */
export const REST_DESCRIPTORS: Record<WorkspaceService, McpToolDescriptor[]> = {
  gmail: [
    {
      name: "search_threads",
      description:
        "Search the consultant's Gmail threads, newest first. `query` uses Gmail search syntax (from:, to:, subject:, newer_than:7d, after:YYYY/MM/DD, has:attachment, is:unread, in:inbox); omit it to list the latest threads. Returns each thread's id, subject, sender, date and snippet.",
      inputSchema: obj({ query: s("string", "Gmail search query, e.g. `in:inbox newer_than:7d` or `from:agent@uni.edu`"), pageSize: s("integer", "Threads to return, at most 25 (default 10)"), pageToken: s("string", "Next-page token from a previous call"), includeTrash: s("boolean", "Also search Trash and Spam") }),
      annotations: read,
    },
    {
      name: "get_thread",
      description: "Read one Gmail thread: every message's sender, recipients, date, subject and plain-text body.",
      inputSchema: obj({ threadId: s("string", "Thread id from search_threads") }, ["threadId"]),
      annotations: read,
    },
    {
      name: "get_message",
      description: "Read one Gmail message: sender, recipients, date, subject, plain-text body and attachment names.",
      inputSchema: obj({ messageId: s("string", "Message id") }, ["messageId"]),
      annotations: read,
    },
    {
      name: "list_drafts",
      description: "List the consultant's Gmail drafts (id, recipients, subject, date). `query` uses Gmail search syntax.",
      inputSchema: obj({ query: s("string", "Gmail search query"), pageSize: s("integer", "Drafts to return, at most 25 (default 10)") }),
      annotations: read,
    },
    {
      name: "create_draft",
      description: "Create a Gmail draft in the consultant's Drafts folder. Never sends. Pass replyToMessageId to draft a reply in that conversation.",
      inputSchema: obj({
        to: list("Recipient email addresses"),
        cc: list("Cc email addresses"),
        bcc: list("Bcc email addresses"),
        subject: s("string", "Subject line"),
        body: s("string", "Plain-text body (no Markdown)"),
        htmlBody: s("string", "Optional HTML body"),
        replyToMessageId: s("string", "Id of the message this draft replies to"),
      }),
      annotations: { readOnlyHint: false },
    },
  ],
  drive: [
    {
      name: "search_files",
      description: "Search the consultant's Google Drive (including shared drives) by words in file names and contents. Returns each file's id, name, type, modified time and link.",
      inputSchema: obj({ query: s("string", "Words to look for, e.g. `Monash offer letter`; Drive query syntax such as `name contains 'CoE'` also works"), pageSize: s("integer", "Files to return, at most 25 (default 10)"), pageToken: s("string", "Next-page token from a previous call") }),
      annotations: read,
    },
    {
      name: "list_recent_files",
      description: "List the consultant's most recently modified Drive files.",
      inputSchema: obj({ pageSize: s("integer", "Files to return, at most 25 (default 10)"), orderBy: s("string", "`modifiedTime desc` (default) or `viewedByMeTime desc`") }),
      annotations: read,
    },
    {
      name: "get_file_metadata",
      description: "Details of one Drive file: name, type, owner, modified time, description and link.",
      inputSchema: obj({ fileId: s("string", "File id from search_files") }, ["fileId"]),
      annotations: read,
    },
    {
      name: "read_file_content",
      description: "Read the text of one Drive file. Google Docs, Sheets (as CSV), Slides and plain-text files are supported; PDFs and images return their details only.",
      inputSchema: obj({ fileId: s("string", "File id from search_files") }, ["fileId"]),
      annotations: read,
    },
  ],
  calendar: CALENDAR_DESCRIPTORS,
  docs: DOCS_DESCRIPTORS,
};

// ---------------------------------------------------------------- Gmail

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

/** Plain text of an HTML body: enough for evidence, not a renderer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The message's own words: the first text/plain part, else its HTML as text. */
function bodyText(part: GmailPart | undefined): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename) return; // an attachment, not the body
    if (p.body?.data && p.mimeType === "text/plain") plain.push(decode(p.body.data));
    else if (p.body?.data && p.mimeType === "text/html") html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(part);
  const text = plain.length ? plain.join("\n") : htmlToText(html.join("\n"));
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text;
}

const attachments = (part: GmailPart | undefined): { filename: string; mimeType?: string }[] => {
  const out: { filename: string; mimeType?: string }[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename) out.push({ filename: p.filename, ...(p.mimeType ? { mimeType: p.mimeType } : {}) });
    p.parts?.forEach(walk);
  };
  if (part) walk(part);
  return out;
};

const isoDate = (m: GmailMessage) => (m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, "Date"));

function messageView(m: GmailMessage, withBody: boolean) {
  return {
    id: m.id,
    threadId: m.threadId,
    subject: header(m, "Subject"),
    sender: header(m, "From"),
    toRecipients: header(m, "To"),
    ...(header(m, "Cc") ? { ccRecipients: header(m, "Cc") } : {}),
    date: isoDate(m),
    labelIds: m.labelIds ?? [],
    snippet: m.snippet ?? "",
    ...(withBody ? { plaintextBody: bodyText(m.payload), attachments: attachments(m.payload) } : {}),
  };
}

const messageText = (v: ReturnType<typeof messageView>) =>
  [
    `From: ${v.sender}`,
    `To: ${v.toRecipients}`,
    ...(v.ccRecipients ? [`Cc: ${v.ccRecipients}`] : []),
    `Date: ${v.date}`,
    `Subject: ${v.subject}`,
    ...(v.attachments?.length ? [`Attachments: ${v.attachments.map((a) => a.filename).join(", ")}`] : []),
    "",
    v.plaintextBody ?? v.snippet,
  ].join("\n");

const METADATA = ["Subject", "From", "To", "Cc", "Date"];

async function searchThreads(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const found = (await http("gmail", `${GMAIL}/threads?${qs({ q: str(args.query), maxResults: pageSize(args.pageSize), pageToken: str(args.pageToken), includeSpamTrash: args.includeTrash === true ? true : undefined })}`, o)) as {
    threads?: { id: string }[];
    nextPageToken?: string;
  };
  const threads = await Promise.all(
    (found.threads ?? []).map(async ({ id }) => {
      const t = (await http("gmail", `${GMAIL}/threads/${encodeURIComponent(id)}?${qs({ format: "metadata", metadataHeaders: METADATA })}`, o)) as { messages?: GmailMessage[] };
      const msgs = t.messages ?? [];
      const latest = msgs[msgs.length - 1];
      return latest ? { ...messageView(latest, false), id, messageCount: msgs.length } : { id, messageCount: 0 };
    }),
  );
  const text = threads.length
    ? threads.map((t, i) => ("sender" in t ? `${i + 1}. [thread ${t.id}] ${t.date} — From: ${t.sender} — Subject: ${t.subject} (${t.messageCount} message${t.messageCount === 1 ? "" : "s"})\n   ${t.snippet}` : `${i + 1}. [thread ${t.id}]`)).join("\n")
    : "No Gmail threads matched that search.";
  return { text, structured: { threads, ...(found.nextPageToken ? { nextPageToken: found.nextPageToken } : {}) }, isError: false };
}

async function getThread(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const id = str(args.threadId);
  if (!id) throw new RestRefused("threadId is required");
  const t = (await http("gmail", `${GMAIL}/threads/${encodeURIComponent(id)}?format=full`, o)) as { id: string; messages?: GmailMessage[] };
  const messages = (t.messages ?? []).map((m) => messageView(m, true));
  return { text: messages.map(messageText).join("\n\n---\n\n") || "This thread has no messages.", structured: { id: t.id, threadId: t.id, messages }, isError: false };
}

async function getMessage(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const id = str(args.messageId);
  if (!id) throw new RestRefused("messageId is required");
  const m = messageView((await http("gmail", `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, o)) as GmailMessage, true);
  return { text: messageText(m), structured: m, isError: false };
}

async function listDrafts(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const found = (await http("gmail", `${GMAIL}/drafts?${qs({ q: str(args.query), maxResults: pageSize(args.pageSize) })}`, o)) as { drafts?: { id: string }[] };
  const drafts = await Promise.all(
    (found.drafts ?? []).map(async ({ id }) => {
      const d = (await http("gmail", `${GMAIL}/drafts/${encodeURIComponent(id)}?${qs({ format: "metadata", metadataHeaders: METADATA })}`, o)) as { id: string; message: GmailMessage };
      const v = messageView(d.message, false);
      return { id: d.id, messageId: v.id, threadId: v.threadId, subject: v.subject, toRecipients: v.toRecipients, date: v.date, snippet: v.snippet };
    }),
  );
  const text = drafts.length ? drafts.map((d, i) => `${i + 1}. [draft ${d.id}] To: ${d.toRecipients || "(none)"} — Subject: ${d.subject || "(no subject)"} — ${d.date}`).join("\n") : "No Gmail drafts matched.";
  return { text, structured: { drafts }, isError: false };
}

/** RFC 2047 encoded-word, so a non-ASCII subject survives. */
const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
/** Header values never carry a line break: a CR/LF in model-written text must not start a new header. */
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

/** The MIME message for a draft. Exported for tests. */
export function buildDraftMime(d: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; htmlBody?: string; inReplyTo?: string; references?: string }): string {
  const headers = [
    "MIME-Version: 1.0",
    ...(d.to.length ? [`To: ${oneLine(d.to.join(", "))}`] : []),
    ...(d.cc.length ? [`Cc: ${oneLine(d.cc.join(", "))}`] : []),
    ...(d.bcc.length ? [`Bcc: ${oneLine(d.bcc.join(", "))}`] : []),
    `Subject: ${encodeHeader(oneLine(d.subject))}`,
    ...(d.inReplyTo ? [`In-Reply-To: ${oneLine(d.inReplyTo)}`, `References: ${oneLine(d.references ?? d.inReplyTo)}`] : []),
  ];
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  if (!d.htmlBody) return [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(d.body)].join("\r\n");
  const boundary = `edge-${crypto.randomUUID()}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(d.body || htmlToText(d.htmlBody)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(d.htmlBody),
    `--${boundary}--`,
  ].join("\r\n");
}

async function createDraft(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  if (args.attachments !== undefined) throw new RestRefused("attachments are not supported in drafts");
  let subject = str(args.subject) ?? "";
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  const replyTo = str(args.replyToMessageId);
  if (replyTo) {
    // Thread the reply the way Gmail does: same threadId, In-Reply-To/References to the original's Message-ID.
    const m = (await http("gmail", `${GMAIL}/messages/${encodeURIComponent(replyTo)}?${qs({ format: "metadata", metadataHeaders: ["Subject", "Message-ID", "References"] })}`, o)) as GmailMessage;
    threadId = m.threadId;
    inReplyTo = header(m, "Message-ID") || undefined;
    references = [header(m, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
    if (!subject) subject = /^re:/i.test(header(m, "Subject")) ? header(m, "Subject") : `Re: ${header(m, "Subject")}`;
  }
  const mime = buildDraftMime({
    to: strings(args.to),
    cc: strings(args.cc),
    bcc: strings(args.bcc),
    subject,
    body: typeof args.body === "string" ? args.body : "",
    ...(str(args.htmlBody) ? { htmlBody: args.htmlBody as string } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  });
  const draft = (await http("gmail", `${GMAIL}/drafts`, o, { method: "POST", body: { message: { raw: Buffer.from(mime, "utf8").toString("base64url"), ...(threadId ? { threadId } : {}) } } })) as {
    id: string;
    message?: { id?: string; threadId?: string };
  };
  const structured = { id: draft.id, messageId: draft.message?.id, threadId: draft.message?.threadId };
  return { text: `Draft ${draft.id} saved in Gmail Drafts (not sent).`, structured, isError: false };
}

// ---------------------------------------------------------------- Drive

const FILE_FIELDS = "id,name,mimeType,modifiedTime,createdTime,webViewLink,size,description,owners(displayName,emailAddress)";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
  size?: string;
  description?: string;
}

const fileView = (f: DriveFile) => ({
  id: f.id,
  title: f.name,
  mimeType: f.mimeType,
  ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
  ...(f.webViewLink ? { webViewLink: f.webViewLink } : {}),
  ...(f.owners?.[0] ? { owner: f.owners[0].displayName ?? f.owners[0].emailAddress } : {}),
  ...(f.description ? { description: f.description } : {}),
});

const fileLine = (f: ReturnType<typeof fileView>, i: number) => `${i + 1}. [file ${f.id}] ${f.title} (${f.mimeType}) — modified ${f.modifiedTime ?? "?"}${f.owner ? ` — owner ${f.owner}` : ""}${f.webViewLink ? `\n   ${f.webViewLink}` : ""}`;

/** Drive's own query language, passed through; plain words become a full-text search. */
const DRIVE_SYNTAX = /\b(contains|mimeType|modifiedTime|createdTime|trashed|starred|parents|fullText|sharedWithMe|owners)\b|\bname\s*=|[<>]=?/;
export function driveQuery(query: string | undefined): string {
  if (!query) return "trashed = false";
  if (DRIVE_SYNTAX.test(query)) return /\btrashed\b/.test(query) ? query : `(${query}) and trashed = false`;
  return `fullText contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
}

async function listFiles(o: RestCallOptions, params: { q: string; pageSize: number; pageToken?: string; orderBy?: string }, empty: string): Promise<McpToolResult> {
  const found = (await http(
    "drive",
    `${DRIVE}/files?${qs({ q: params.q, pageSize: params.pageSize, pageToken: params.pageToken, orderBy: params.orderBy, fields: `nextPageToken,files(${FILE_FIELDS})`, corpora: "allDrives", includeItemsFromAllDrives: true, supportsAllDrives: true })}`,
    o,
  )) as { files?: DriveFile[]; nextPageToken?: string };
  const files = (found.files ?? []).map(fileView);
  return { text: files.length ? files.map(fileLine).join("\n") : empty, structured: { files, ...(found.nextPageToken ? { nextPageToken: found.nextPageToken } : {}) }, isError: false };
}

const getFile = async (fileId: string, o: RestCallOptions) =>
  (await http("drive", `${DRIVE}/files/${encodeURIComponent(fileId)}?${qs({ fields: FILE_FIELDS, supportsAllDrives: true })}`, o)) as DriveFile;

/** Google-native types export as text; these MIME types are downloaded as they are. */
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TEXTUAL = /^(text\/|application\/(json|xml|csv|x-yaml|yaml|javascript|markdown))/;

async function readFileContent(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const fileId = str(args.fileId);
  if (!fileId) throw new RestRefused("fileId is required");
  const f = await getFile(fileId, o);
  const view = fileView(f);
  const head = `Title: ${f.name}\nType: ${f.mimeType}${f.modifiedTime ? `\nModified: ${f.modifiedTime}` : ""}`;
  let content: string | undefined;
  if (EXPORT_AS[f.mimeType]) {
    content = (await http("drive", `${DRIVE}/files/${encodeURIComponent(fileId)}/export?${qs({ mimeType: EXPORT_AS[f.mimeType] })}`, o, { raw: true })) as string;
  } else if (TEXTUAL.test(f.mimeType)) {
    content = (await http("drive", `${DRIVE}/files/${encodeURIComponent(fileId)}?${qs({ alt: "media", supportsAllDrives: true })}`, o, { raw: true })) as string;
  }
  if (content === undefined) {
    return { text: `${head}\n\nThis is a ${f.mimeType} file; its text cannot be read here. Open it in Drive: ${f.webViewLink ?? ""}`.trim(), structured: view, isError: false };
  }
  const text = content.length > MAX_FILE_TEXT ? `${content.slice(0, MAX_FILE_TEXT)}…` : content;
  return { text: `${head}\n\n${text}`, structured: view, isError: false };
}

const RECENT_ORDER = new Set(["modifiedTime desc", "viewedByMeTime desc", "modifiedByMeTime desc"]);

const HANDLERS: Record<WorkspaceService, Record<string, (args: Obj, o: RestCallOptions) => Promise<McpToolResult>>> = {
  gmail: { search_threads: searchThreads, get_thread: getThread, get_message: getMessage, list_drafts: listDrafts, create_draft: createDraft },
  drive: {
    search_files: (a, o) => listFiles(o, { q: driveQuery(str(a.query)), pageSize: pageSize(a.pageSize), ...(str(a.pageToken) ? { pageToken: str(a.pageToken)! } : {}) }, "No Drive files matched that search."),
    list_recent_files: (a, o) => listFiles(o, { q: "trashed = false", pageSize: pageSize(a.pageSize), orderBy: RECENT_ORDER.has(String(a.orderBy)) ? String(a.orderBy) : "modifiedTime desc" }, "No Drive files found."),
    get_file_metadata: async (a, o) => {
      const fileId = str(a.fileId);
      if (!fileId) throw new RestRefused("fileId is required");
      const view = fileView(await getFile(fileId, o));
      return { text: fileLine(view, 0).replace(/^1\. /, ""), structured: view, isError: false };
    },
    read_file_content: readFileContent,
  },
  calendar: CALENDAR_HANDLERS,
  docs: DOCS_HANDLERS,
};

/**
 * Run one server-named tool against the REST API. A refused request (404, 403 on one file, bad
 * input) is an `isError` result like the MCP server's; a rejected token (401) or an unreachable
 * API throws `McpError`, so the provider's token retry and degrade paths apply unchanged.
 */
export async function callRest(service: WorkspaceService, tool: string, args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const handler = HANDLERS[service][tool];
  if (!handler) throw new McpError(`${SERVICE_LABELS[service]} tool not available over REST: ${tool}`, "protocol");
  try {
    return await handler(args, o);
  } catch (err) {
    if (err instanceof RestRefused) return { text: err.message, isError: true };
    throw err;
  }
}
