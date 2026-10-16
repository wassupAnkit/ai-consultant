/**
 * Creating new Google Docs and Sheets over the Docs (v1) and Sheets (v4) REST APIs.
 *
 * Create-only by design: the consultant granted `drive.file`, which reaches only files Edge itself
 * creates, never their existing Docs and Sheets. Google's Docs and Sheets MCP servers can read and
 * edit but cannot create, and need full `documents`/`spreadsheets` access, so this is REST-only.
 *
 * Every file is created private to the consultant; nothing here calls the permissions API.
 * Sheet values are written with valueInputOption=RAW, so a cell such as `=IMPORTXML(...)` copied
 * from an email is stored as text and never evaluated as a formula (which could fetch a URL).
 */
import type { McpToolDescriptor, McpToolResult } from "../mcp/types";
import { http, obj, RestRefused, s, str, type Obj, type RestCallOptions } from "./rest-shared";

const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

export const MAX_DOC_CHARS = 50_000;
export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLS = 26;

export const DOCS_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: "create_doc",
    description:
      "Propose a new Google Doc in the consultant's Drive, created only when they approve the card and private to them. `content` is plain text: a line starting `# ` is a heading, `## ` a subheading, `- ` a bullet. Use it when the consultant asks for a document (an outline, a checklist, a summary to keep).",
    inputSchema: obj({ title: s("string", "Document title"), content: s("string", "Plain-text content with # headings and - bullets") }, ["title", "content"]),
    annotations: { readOnlyHint: false },
  },
  {
    name: "create_sheet",
    description:
      "Propose a new Google Sheet in the consultant's Drive, created only when they approve the card and private to them. `rows` is a table: the first row is the header. Use it when the consultant asks for a comparison or list as a spreadsheet.",
    inputSchema: obj(
      {
        title: s("string", "Spreadsheet title"),
        rows: { type: "array", description: "Rows of cells; the first row is the header", items: { type: "array", items: { type: "string" } } } as never,
        sheetTitle: s("string", "Name of the sheet tab; default Sheet1"),
      },
      ["title", "rows"],
    ),
    annotations: { readOnlyHint: false },
  },
];

type Line = { text: string; kind: "h1" | "h2" | "bullet" | "plain" };

/** Split doc content into styled lines. Exported for the approval preview and tests. */
export function docLines(content: string): Line[] {
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw): Line => {
      if (/^##\s+/.test(raw)) return { text: raw.replace(/^##\s+/, ""), kind: "h2" };
      if (/^#\s+/.test(raw)) return { text: raw.replace(/^#\s+/, ""), kind: "h1" };
      if (/^\s*[-*•]\s+/.test(raw)) return { text: raw.replace(/^\s*[-*•]\s+/, ""), kind: "bullet" };
      return { text: raw, kind: "plain" };
    });
}

/** Docs batchUpdate requests that insert the text and style its headings and bullets. Exported for tests. */
export function docRequests(content: string): object[] {
  const lines = docLines(content.length > MAX_DOC_CHARS ? content.slice(0, MAX_DOC_CHARS) : content);
  const text = lines.map((l) => l.text).join("\n");
  const requests: object[] = [{ insertText: { location: { index: 1 }, text } }];
  // Docs indexes count UTF-16 code units from 1, as JS string lengths do.
  let index = 1;
  for (const l of lines) {
    const range = { startIndex: index, endIndex: index + l.text.length + 1 };
    if (l.kind === "h1" || l.kind === "h2") requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: l.kind === "h1" ? "HEADING_1" : "HEADING_2" }, fields: "namedStyleType" } });
    if (l.kind === "bullet") requests.push({ createParagraphBullets: { range, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
    index = range.endIndex;
  }
  return requests;
}

/** Normalise the model's rows to a bounded grid of strings. Throws when there is nothing to write. Exported for the preview. */
export function sheetRows(raw: unknown): string[][] {
  if (!Array.isArray(raw)) throw new RestRefused("rows must be a list of rows");
  const rows = raw
    .slice(0, MAX_SHEET_ROWS)
    .map((r) => (Array.isArray(r) ? r : [r]).slice(0, MAX_SHEET_COLS).map((c) => (c === null || c === undefined ? "" : typeof c === "object" ? JSON.stringify(c) : String(c))));
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) throw new RestRefused("rows must contain at least one non-empty row");
  return rows;
}

async function createDoc(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const title = str(args.title);
  if (!title) throw new RestRefused("title is required");
  const content = typeof args.content === "string" ? args.content : "";
  if (!content.trim()) throw new RestRefused("content is required");
  const doc = (await http("docs", DOCS, o, { method: "POST", body: { title } })) as { documentId: string };
  await http("docs", `${DOCS}/${encodeURIComponent(doc.documentId)}:batchUpdate`, o, { method: "POST", body: { requests: docRequests(content) } });
  const webViewLink = `https://docs.google.com/document/d/${doc.documentId}/edit`;
  return { text: `Google Doc "${title}" created (private to you): ${webViewLink}`, structured: { id: doc.documentId, title, webViewLink }, isError: false };
}

async function createSheet(args: Obj, o: RestCallOptions): Promise<McpToolResult> {
  const title = str(args.title);
  if (!title) throw new RestRefused("title is required");
  const rows = sheetRows(args.rows);
  const tab = (str(args.sheetTitle) ?? "Sheet1").replace(/['!]/g, "").slice(0, 100) || "Sheet1";
  const created = (await http("docs", SHEETS, o, {
    method: "POST",
    body: { properties: { title }, sheets: [{ properties: { title: tab, gridProperties: { frozenRowCount: 1 } } }] },
  })) as { spreadsheetId: string; spreadsheetUrl?: string; sheets?: { properties?: { sheetId?: number } }[] };
  const id = created.spreadsheetId;
  await http("docs", `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`'${tab}'!A1`)}?valueInputOption=RAW`, o, { method: "PUT", body: { values: rows } });
  const sheetId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  const width = Math.max(...rows.map((r) => r.length));
  await http("docs", `${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, o, {
    method: "POST",
    body: {
      requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: width } } },
      ],
    },
  });
  const webViewLink = created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`;
  return { text: `Google Sheet "${title}" created with ${rows.length} rows (private to you): ${webViewLink}`, structured: { id, title, webViewLink }, isError: false };
}

export const DOCS_HANDLERS: Record<string, (args: Obj, o: RestCallOptions) => Promise<McpToolResult>> = {
  create_doc: createDoc,
  create_sheet: createSheet,
};
