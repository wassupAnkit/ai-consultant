import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ExtractedPage } from "./extract";

export interface Chunk {
  index: number;
  section: string;
  content: string;
}

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1_800,
  chunkOverlap: 200,
  separators: ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " ", ""],
});

/**
 * Split a page into overlapping chunks (~450 tokens). Each chunk is prefixed
 * with the page title and its heading path so it stays meaningful on its own
 * and lexical search can match on headings.
 */
export async function chunkPage(page: ExtractedPage, minChars = 80): Promise<Chunk[]> {
  const out: Chunk[] = [];
  let index = 0;
  const groups = groupSections(page);
  for (const g of groups) {
    const body = g.text.trim();
    if (body.length < minChars) continue;
    const parts = await splitter.splitText(body);
    for (const part of parts) {
      const text = part.trim();
      if (text.length < minChars) continue;
      const header = [page.title, g.heading].filter(Boolean).join(" — ");
      out.push({ index: index++, section: g.heading, content: header ? `${header}\n\n${text}` : text });
    }
  }
  return out;
}

/** Merge tiny sections into their neighbours so chunks are not fragmentary. */
function groupSections(page: ExtractedPage): { heading: string; text: string }[] {
  const groups: { heading: string; text: string }[] = [];
  let path: string[] = [];
  for (const s of page.sections) {
    if (s.heading) {
      path = [...path.filter((_, i) => i < Math.max(0, s.level - 1)), s.heading];
    }
    const heading = path.join(" > ");
    const last = groups[groups.length - 1];
    const text = s.text.trim();
    if (!text) continue;
    if (last && (last.text.length < 300 || last.heading === heading)) {
      last.text += "\n" + (s.heading && last.heading !== heading ? `### ${s.heading}\n` : "") + text;
      if (!last.heading) last.heading = heading;
    } else {
      groups.push({ heading, text });
    }
  }
  return groups;
}
