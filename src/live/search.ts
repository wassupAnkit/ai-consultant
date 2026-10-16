import type { GeminiGenerate } from "../llm/generate";
import { sanitizeRetrieved } from "../safety/sanitize";
import type { LiveCache } from "./cache";
import type { DomainPolicy } from "./policy";

/**
 * Web search via Gemini's Google Search grounding. The model answers the query
 * from live search results and returns grounding metadata: the pages it used
 * and which sentences each page supports. We surface those pages as results
 * (with the supporting text as the snippet) so the research loop can cite them
 * or fetch them in full.
 */
export interface WebSearchHit {
  url: string;
  title: string | null;
  snippet: string | null;
  /** Whether the domain policy would let us fetch this page in full. */
  allowed: boolean;
}

export interface WebSearchResult {
  query: string;
  /** Grounded summary written by the model (may be empty). */
  summary: string;
  results: WebSearchHit[];
  /** Search queries Google actually ran. */
  queries: string[];
  fromCache: boolean;
}

export interface WebSearchDeps {
  gen: GeminiGenerate;
  model: string;
  cache?: LiveCache;
  policy?: DomainPolicy;
  fetchImpl?: typeof fetch;
  cacheTtlSeconds?: number;
  /** Resolve Google's grounding-redirect URIs to the real page URL (default true). */
  resolveRedirects?: boolean;
}

const SEARCH_SYSTEM = `You are a web research assistant for an international-education consultancy. Answer the query factually and concisely (at most ~200 words) using Google Search results. Quote figures, dates, thresholds and requirements exactly as the sources state them and name the source site inline. If the results do not contain the answer, say "Not found in search results." Do not add advice or opinions.`;

const REDIRECT_HOST = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;

export async function webSearch(query: string, opts: { site?: string; k?: number; signal?: AbortSignal }, deps: WebSearchDeps): Promise<WebSearchResult> {
  const q = opts.site ? `site:${opts.site} ${query}` : query;
  const k = opts.k ?? 8;
  const cached = await deps.cache?.get<WebSearchResult>("search", `${deps.model}|${q}`).catch(() => null);
  if (cached) return { ...cached, results: cached.results.slice(0, k), fromCache: true };

  const gen = await deps.gen.generate({
    model: deps.model,
    system: SEARCH_SYSTEM,
    parts: [{ text: q }],
    tools: [{ google_search: {} }],
    temperature: 0,
    maxOutputTokens: 1_024,
    signal: opts.signal,
    timeoutMs: 20_000,
  });

  const chunks = gen.grounding?.chunks ?? [];
  const supports = gen.grounding?.supports ?? [];
  // Resolve Google's redirect URIs a few at a time (a burst of parallel HEADs gets throttled and times out).
  const resolved: string[] = new Array(chunks.length);
  const queue = chunks.map((c, i) => i);
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length || 1) }, async () => {
      while (queue.length) {
        const i = queue.shift()!;
        resolved[i] = deps.resolveRedirects === false ? chunks[i]!.uri : await resolveRedirect(chunks[i]!.uri, deps.fetchImpl ?? fetch);
      }
    }),
  );
  const seen = new Set<string>();
  const results: WebSearchHit[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const url = resolved[i] ?? chunks[i]!.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const snippet = supports
      .filter((s) => s.chunkIndexes.includes(i))
      .map((s) => s.text)
      .join(" ")
      .trim();
    const allowed = deps.policy ? (await deps.policy.check(url)).ok : true;
    results.push({ url, title: chunks[i]!.title, snippet: snippet ? sanitizeRetrieved(snippet, 600) : null, allowed });
  }

  const result: WebSearchResult = {
    query: q,
    summary: sanitizeRetrieved(gen.text, 2_000),
    results,
    queries: gen.grounding?.queries ?? [],
    fromCache: false,
  };
  await deps.cache?.set("search", `${deps.model}|${q}`, result, deps.cacheTtlSeconds ?? 24 * 3600).catch(() => undefined);
  return { ...result, results: result.results.slice(0, k) };
}

/** Grounding chunks point at `vertexaisearch.cloud.google.com/grounding-api-redirect/…`; follow one hop to the real page. */
export async function resolveRedirect(uri: string, fetchImpl: typeof fetch): Promise<string> {
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    return uri;
  }
  if (!REDIRECT_HOST.test(host)) return uri;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(uri, { method: attempt === 0 ? "HEAD" : "GET", redirect: "manual", signal: AbortSignal.timeout(6_000) });
      const location = res.headers.get("location");
      if (location) return new URL(location, uri).toString();
      // Some runtimes follow anyway and expose the final URL.
      if (res.url && !REDIRECT_HOST.test(new URL(res.url).hostname)) return res.url;
      if (res.status < 500) break;
    } catch {
      /* retry once, then keep the redirect uri */
    }
  }
  return uri;
}
