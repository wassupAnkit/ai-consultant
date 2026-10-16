import { parseRobots, type RobotsRules } from "../ingest/crawler";
import { extractPage, type ExtractedSection } from "../ingest/extract";
import { sanitizeRetrieved } from "../safety/sanitize";
import type { LiveCache } from "./cache";
import type { DomainPolicy } from "./policy";

/**
 * Fetch one web page at answer time (a partner-university page, an official
 * immigration page, or a URL the consultant pasted) and turn it into clean text
 * the research loop can cite. Reuses the crawler's robots.txt parsing and HTML
 * extraction, adds a domain policy, redirect re-checks, a byte cap and a cache.
 */
export interface LivePage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  sections: ExtractedSection[];
  fetchedAt: string;
  fromCache: boolean;
  truncated: boolean;
}

export type LiveFetchErrorCode =
  | "invalid_url"
  | "policy_denied"
  | "robots_disallowed"
  | "unsupported_content"
  | "http_error"
  | "timeout"
  | "too_large"
  | "network_error";

export class LiveFetchError extends Error {
  constructor(
    public readonly code: LiveFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiveFetchError";
  }
}

export interface LiveFetchDeps {
  policy: DomainPolicy;
  cache?: LiveCache;
  fetchImpl?: typeof fetch;
  userAgent: string;
  /** Per-request timeout (default 8 s). */
  timeoutMs?: number;
  /** Response bytes read before truncating (default 2 MB). */
  maxBytes?: number;
  /** Extracted text kept for the prompt (default 20k chars). */
  maxTextChars?: number;
  cacheTtlSeconds?: number;
  /** Skip robots.txt (tests). */
  ignoreRobots?: boolean;
}

const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
const ROBOTS_TTL_MS = 60 * 60_000;

export async function fetchPageForAnswer(url: string, opts: { explicit?: boolean; signal?: AbortSignal }, deps: LiveFetchDeps): Promise<LivePage> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 8_000;
  const maxBytes = deps.maxBytes ?? 2_000_000;
  const maxTextChars = deps.maxTextChars ?? 20_000;

  let u: URL;
  try {
    u = new URL(url);
    u.hash = "";
  } catch {
    throw new LiveFetchError("invalid_url", `Not a valid URL: ${url.slice(0, 200)}`);
  }
  const decision = await deps.policy.check(u.href, { explicit: opts.explicit });
  if (!decision.ok) throw new LiveFetchError("policy_denied", `Fetching ${decision.host ?? "this URL"} is not allowed (${decision.reason})`);

  const cached = await deps.cache?.get<LivePage>("page", u.href).catch(() => null);
  if (cached) return { ...cached, fromCache: true };

  if (!deps.ignoreRobots) {
    const rules = await getRobots(u.origin, deps.userAgent, fetchImpl);
    if (rules.disallow.some((p) => u.pathname.startsWith(p))) throw new LiveFetchError("robots_disallowed", `${u.host} disallows fetching ${u.pathname} (robots.txt)`);
  }

  let res: Response;
  try {
    res = await fetchImpl(u.href, {
      headers: { "user-agent": deps.userAgent, accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8" },
      redirect: "follow",
      signal: combineSignals(opts.signal, AbortSignal.timeout(timeoutMs)),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new LiveFetchError("timeout", `Timed out fetching ${u.host} after ${timeoutMs} ms`);
    throw new LiveFetchError("network_error", `Could not fetch ${u.host}: ${e.message}`);
  }
  if (!res.ok) throw new LiveFetchError("http_error", `${u.host} returned HTTP ${res.status}`);

  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const isHtml = type.includes("html");
  const isText = type.startsWith("text/plain");
  if (!isHtml && !isText) {
    const hint = type.includes("pdf") ? "PDF pages cannot be fetched live; paste the text or upload the document to the knowledge base." : `unsupported content type ${type || "unknown"}`;
    throw new LiveFetchError("unsupported_content", hint);
  }

  const finalUrl = res.url || u.href;
  if (finalUrl !== u.href) {
    const again = await deps.policy.check(finalUrl, { explicit: opts.explicit });
    if (!again.ok) throw new LiveFetchError("policy_denied", `Redirected to ${again.host ?? finalUrl}, which is not allowed (${again.reason})`);
  }

  const { text: raw, truncated } = await readCapped(res, maxBytes);
  let title = finalUrl;
  let sections: ExtractedSection[];
  let text: string;
  let jsRendered = false;
  if (isHtml) {
    const page = await extractPage(raw, finalUrl);
    title = page.title || finalUrl;
    sections = page.sections.map((s) => ({ ...s, text: sanitizeRetrieved(s.text, 4_000) }));
    text = sanitizeRetrieved(page.text, maxTextChars);
    if (text.length < 80) {
      // Client-rendered page (e.g. course finders built as SPAs): fall back to what the server did send —
      // meta description and schema.org JSON-LD — so the caller still gets something citable.
      const fallback = [page.description ? `Summary: ${page.description}` : "", ...(page.jsonLd ?? []).map((j) => `Structured data: ${JSON.stringify(j).slice(0, 4_000)}`)]
        .filter(Boolean)
        .join("\n");
      if (fallback.length > 40) {
        text = sanitizeRetrieved(fallback, maxTextChars);
        sections = [{ heading: title, level: 1, text }];
        jsRendered = true;
      }
    }
  } else {
    text = sanitizeRetrieved(raw, maxTextChars);
    sections = [{ heading: "", level: 1, text }];
  }
  if (!text || text.length < 40) throw new LiveFetchError("unsupported_content", `${u.host} returned a page with no readable text (it is rendered with JavaScript); search the web for the same page's content or a PDF version instead`);
  if (jsRendered) text = `[Page is JavaScript-rendered; only its metadata was readable]\n${text}`;

  const page: LivePage = { url: u.href, finalUrl, title, text, sections, fetchedAt: new Date().toISOString(), fromCache: false, truncated };
  await deps.cache?.set("page", u.href, page, deps.cacheTtlSeconds ?? 6 * 3600).catch(() => undefined);
  return page;
}

async function getRobots(origin: string, userAgent: string, fetchImpl: typeof fetch): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
  let rules: RobotsRules = { disallow: [], crawlDelayMs: 0 };
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(4_000) });
    if (res.ok) rules = parseRobots(await res.text(), userAgent);
  } catch {
    /* no robots → allow */
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

/** Read a response body up to `maxBytes`, cancelling the rest. */
async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** Test hook: clear the per-origin robots cache. */
export function __resetRobotsCache() {
  robotsCache.clear();
}
