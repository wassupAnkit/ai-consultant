import { extractPage, type ExtractedPage, type ExtractedSection } from "../ingest/extract";
import type { GeminiGenerate } from "../llm/generate";

/**
 * Turn an uploaded file into the same `ExtractedPage` shape the crawler
 * produces, so it flows through the normal chunk → embed → index pipeline.
 * PDFs go through Gemini's native document understanding (inline PDF →
 * Markdown), which handles tables and scanned pages without an npm dependency.
 */
export type DocumentKind = "pdf" | "text" | "markdown" | "csv" | "html";

const MIME_TO_KIND: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/html": "html",
  "application/xhtml+xml": "html",
};

const EXT_TO_KIND: Record<string, DocumentKind> = { pdf: "pdf", txt: "text", text: "text", md: "markdown", markdown: "markdown", csv: "csv", html: "html", htm: "html" };

export const SUPPORTED_UPLOAD_TYPES = Object.keys(MIME_TO_KIND);

/** Decide the document kind from the declared MIME type, falling back to the file extension. */
export function detectKind(filename: string, declaredMime: string | null | undefined): DocumentKind | null {
  const mime = (declaredMime ?? "").split(";")[0]!.trim().toLowerCase();
  if (mime && MIME_TO_KIND[mime]) return MIME_TO_KIND[mime]!;
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && EXT_TO_KIND[ext]) return EXT_TO_KIND[ext]!;
  if (mime === "application/octet-stream" || !mime) return null;
  return null;
}

export interface ParseDeps {
  /** Needed for PDFs. */
  gen?: GeminiGenerate;
  model?: string;
  /** Continuation rounds when the PDF conversion hits the output limit (default 4). */
  maxPdfRounds?: number;
  signal?: AbortSignal;
}

export class ParseError extends Error {
  constructor(
    public readonly code: "unsupported_type" | "empty" | "pdf_unavailable" | "pdf_failed",
    message: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export async function parseDocument(bytes: Uint8Array, kind: DocumentKind, filename: string, url: string, deps: ParseDeps = {}): Promise<ExtractedPage> {
  const title = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || filename;
  switch (kind) {
    case "html":
      return extractPage(new TextDecoder().decode(bytes), url);
    case "text":
    case "markdown":
      return markdownToPage(new TextDecoder().decode(bytes), title, url);
    case "csv":
      return csvToPage(new TextDecoder().decode(bytes), title, url);
    case "pdf": {
      if (!deps.gen) throw new ParseError("pdf_unavailable", "PDF parsing needs the Gemini client");
      const markdown = await pdfToMarkdown(bytes, deps);
      return markdownToPage(markdown, title, url);
    }
  }
}

/** Split Markdown/plain text into heading-delimited sections. */
export function markdownToPage(text: string, fallbackTitle: string, url: string): ExtractedPage {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection = { heading: "", level: 0, text: "" };
  let title = "";
  for (const raw of lines) {
    const m = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (current.text.trim() || current.heading) sections.push(current);
      const level = m[1]!.length;
      current = { heading: m[2]!.trim(), level, text: "" };
      if (!title && level === 1) title = current.heading;
      continue;
    }
    current.text += raw + "\n";
  }
  if (current.text.trim() || current.heading) sections.push(current);
  const cleaned = sections.map((s) => ({ ...s, text: s.text.replace(/\n{3,}/g, "\n\n").trim() })).filter((s) => s.text || s.heading);
  if (!cleaned.length) throw new ParseError("empty", "The document contains no readable text");
  const body = cleaned.map((s) => (s.heading ? `${"#".repeat(Math.max(1, Math.min(6, s.level || 2)))} ${s.heading}\n${s.text}` : s.text)).join("\n").trim();
  return { url, title: title || fallbackTitle, description: "", lang: null, canonical: null, sections: cleaned, links: [], text: body };
}

/** CSV → Markdown tables in blocks of `rowsPerSection` rows so each chunk stays self-describing (header repeated). */
export function csvToPage(text: string, title: string, url: string, rowsPerSection = 40): ExtractedPage {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new ParseError("empty", "The CSV has no data rows");
  const header = rows[0]!;
  const sections: ExtractedSection[] = [];
  for (let i = 1; i < rows.length; i += rowsPerSection) {
    const slice = rows.slice(i, i + rowsPerSection);
    const table = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...slice.map((r) => `| ${header.map((_, j) => (r[j] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
    sections.push({ heading: `${title} (rows ${i}–${i + slice.length - 1})`, level: 2, text: table });
  }
  const body = sections.map((s) => `## ${s.heading}\n${s.text}`).join("\n");
  return { url, title, description: `${rows.length - 1} rows, columns: ${header.join(", ")}`, lang: null, canonical: null, sections, links: [], text: body };
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true; // a quote mid-field is literal (lenient)
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const PDF_PROMPT = `Convert this PDF to clean Markdown for a knowledge base. Keep the document's own headings (as #/##/###), lists and tables (as Markdown tables); keep every figure, date, fee, requirement and name exactly as written. Do not summarise, do not add commentary, do not translate. Output Markdown only.`;

async function pdfToMarkdown(bytes: Uint8Array, deps: ParseDeps): Promise<string> {
  const gen = deps.gen!;
  const model = deps.model ?? "gemini-3.6-flash";
  const data = Buffer.from(bytes).toString("base64");
  let out = "";
  let rounds = 0;
  let prompt = PDF_PROMPT;
  for (;;) {
    const res = await gen.generate({
      model,
      system: "You are a precise document conversion engine.",
      parts: [{ text: prompt }, { inlineData: { mimeType: "application/pdf", data } }],
      temperature: 0,
      maxOutputTokens: 8_192,
      timeoutMs: 120_000,
      signal: deps.signal,
    });
    out += (out && !out.endsWith("\n") ? "\n" : "") + res.text;
    rounds++;
    if (res.finishReason !== "MAX_TOKENS" || rounds >= (deps.maxPdfRounds ?? 4)) break;
    prompt = `${PDF_PROMPT}\n\nYou already produced the beginning of the conversion, ending with:\n"""\n${out.slice(-600)}\n"""\nContinue EXACTLY from where that stopped, without repeating anything.`;
  }
  if (!out.trim()) throw new ParseError("pdf_failed", "The PDF produced no text");
  return out;
}
