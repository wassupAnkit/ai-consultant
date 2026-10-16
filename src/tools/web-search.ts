import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { sha256 } from "../activity/identity";
import type { WebSearchResult } from "../live/search";
import type { RetrievedChunk } from "../retrieval/store";
import { EvidenceCollector } from "./evidence";

/** Anything that can run a grounded web search (the Gemini implementation lives in src/live/search.ts). */
export interface WebSearcher {
  search(query: string, opts: { site?: string; k?: number; signal?: AbortSignal }): Promise<WebSearchResult>;
}

/** Social / UGC hosts are never citable evidence for a consultant (no editorial control, unstable). */
const EXCLUDED_WEB_HOSTS = ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "youtube.com", "youtu.be", "reddit.com", "quora.com", "pinterest.com", "threads.net"];

export function isExcludedWebHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return EXCLUDED_WEB_HOSTS.some((x) => h === x || h.endsWith("." + x));
  } catch {
    return true;
  }
}

export function webResultsToChunks(result: WebSearchResult): (RetrievedChunk & { fetchedAt: string })[] {
  const fetchedAt = new Date().toISOString();
  return result.results
    .filter((r) => r.snippet && !isExcludedWebHost(r.url))
    .map((r) => {
      let host = r.url;
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        /* keep url */
      }
      return {
        id: `web:${sha256(r.url)}`,
        url: r.url,
        title: r.title ?? host,
        section: "web search result",
        docType: "web",
        country: null,
        source: `web:${host}`,
        content: r.snippet!,
        score: 0.5,
        matchedBy: ["web"] as RetrievedChunk["matchedBy"],
        fetchedAt,
      };
    });
}

export function makeWebSearchTool(searcher: WebSearcher, ctx: { collector: EvidenceCollector; signal?: AbortSignal }) {
  return tool(
    async (input) => {
      const result = await searcher.search(input.query, { site: input.site, k: 8, signal: ctx.signal });
      const usable = result.results.filter((r) => !isExcludedWebHost(r.url));
      const added = ctx.collector.add(webResultsToChunks(result), "web", true);
      const lines = [
        result.summary ? `Grounded summary (not citable itself — cite the numbered evidence or fetch a page):\n${result.summary}` : "",
        usable.length
          ? "Pages found (official government/university pages outrank third-party aggregators):\n" +
            usable.map((r) => `- ${r.url}${r.title ? ` — ${r.title}` : ""}${r.allowed ? " (fetchable with fetch_page)" : ""}`).join("\n")
          : "No usable pages found (social-media results are ignored).",
        added.length ? `New evidence:\n${EvidenceCollector.summaryForModel(added, 400)}` : "No citable snippets were returned; fetch a page for details.",
      ].filter(Boolean);
      return lines.join("\n\n");
    },
    {
      name: "web_search",
      description:
        "Search the live web (Google) for current information the knowledge base lacks: visa rule changes, deadlines, fee updates, news, or facts about a university not yet indexed. Returns a grounded summary plus the pages it came from; snippets become citable evidence marked live. Prefer official government/university sites; use `site` to restrict to one domain.",
      schema: z.object({
        query: z.string().min(3).max(300).describe("Search query."),
        site: z.string().max(100).optional().describe("Restrict to one site, e.g. 'homeaffairs.gov.au' or 'monash.edu'."),
      }),
    },
  );
}
