import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { sha256 } from "../activity/identity";
import { LiveFetchError, type LivePage } from "../live/fetch";
import type { RetrievedChunk } from "../retrieval/store";
import { EvidenceCollector } from "./evidence";

/** Anything that can fetch a page live (the policy-checked implementation lives in src/live/fetch.ts). */
export interface PageFetcher {
  fetch(url: string, opts: { explicit?: boolean; signal?: AbortSignal }): Promise<LivePage>;
}

const CHUNK_CHARS = 1_800;
const MAX_CHUNKS = 3;

/**
 * Turn a fetched page into a few citable chunks. With a `focus`, sections are
 * ranked by how many focus terms they contain so the evidence is the part of
 * the page the model actually asked about.
 */
export function pageToChunks(page: LivePage, focus?: string, maxChunks = MAX_CHUNKS): (RetrievedChunk & { fetchedAt: string })[] {
  const host = hostOf(page.finalUrl);
  const terms = (focus ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const sections = page.sections.filter((s) => s.text.trim().length > 40);
  let picked: { heading: string; text: string }[] = [];
  if (terms.length) {
    // Keep only sections that mention a focus term (best first); fall back to page order if none do.
    const scored = sections.map((s, i) => ({
      s,
      i,
      score: terms.reduce((n, t) => n + (s.text.toLowerCase().includes(t) || s.heading.toLowerCase().includes(t) ? 1 : 0), 0),
    }));
    const relevant = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
    picked = (relevant.length ? relevant : scored).slice(0, maxChunks).map((x) => ({ heading: x.s.heading, text: x.s.text.slice(0, CHUNK_CHARS) }));
  } else {
    // No focus: merge consecutive sections into ≤ CHUNK_CHARS bodies, page order, up to maxChunks.
    for (const s of sections) {
      const last = picked.at(-1);
      if (last && last.text.length + s.text.length + 1 <= CHUNK_CHARS) {
        last.text += "\n" + s.text;
        continue;
      }
      if (picked.length >= maxChunks) break;
      picked.push({ heading: s.heading, text: s.text.slice(0, CHUNK_CHARS) });
    }
  }
  if (!picked.length && page.text) picked.push({ heading: "", text: page.text.slice(0, CHUNK_CHARS) });
  return picked.map((b, i) => ({
    id: `live:${sha256(`${page.finalUrl}#${i}#${b.text.slice(0, 64)}`)}`,
    url: page.finalUrl,
    title: page.title,
    section: b.heading,
    docType: "live_page",
    country: null,
    source: `live:${host}`,
    content: b.text,
    score: 1,
    matchedBy: ["page"] as RetrievedChunk["matchedBy"],
    fetchedAt: page.fetchedAt,
  }));
}

export function makeFetchPageTool(fetcher: PageFetcher, ctx: { collector: EvidenceCollector; explicitUrls: Set<string>; signal?: AbortSignal }) {
  return tool(
    async (input) => {
      const explicit = ctx.explicitUrls.has(normalizeForMatch(input.url));
      let page: LivePage;
      try {
        page = await fetcher.fetch(input.url, { explicit, signal: ctx.signal });
      } catch (err) {
        if (err instanceof LiveFetchError) {
          const hint =
            err.code === "policy_denied"
              ? " Try web_search for an allowed source, or ask the consultant to paste the URL explicitly."
              : err.code === "http_error" || err.code === "timeout"
                ? " The site may block automated readers; rely on web_search snippets or another page."
                : "";
          return `error (${err.code}): ${err.message}.${hint}`;
        }
        return `error: ${(err as Error).message}`;
      }
      const added = ctx.collector.add(pageToChunks(page, input.focus), "page", true);
      const head = `Fetched ${page.finalUrl} — "${page.title}"${page.truncated ? " (page truncated)" : ""}${page.fromCache ? " (cached)" : ""}.`;
      return `${head}\n\n${EvidenceCollector.summaryForModel(added, 600)}`;
    },
    {
      name: "fetch_page",
      description:
        "Fetch one web page and read it: a partner university's course/fee/entry-requirements page, an official immigration page, or a URL the consultant pasted. Use `focus` to say what you need from the page so the most relevant sections are returned as citable live evidence. Only experteducation.com, partner-university domains, official sites on the allowlist, and URLs the consultant explicitly provided can be fetched.",
      schema: z.object({
        url: z.string().min(8).max(2_000).describe("Absolute http(s) URL."),
        focus: z.string().max(200).optional().describe("What to look for on the page, e.g. 'international tuition fees 2026' or 'IELTS requirement'."),
      }),
    },
  );
}

export function normalizeForMatch(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
