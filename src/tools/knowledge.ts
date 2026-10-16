import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { KnowledgeStore } from "../retrieval/store";
import type { Market } from "../routing/markets";
import { DESTINATIONS } from "../schemas/intent.schema";
import { EvidenceCollector } from "./evidence";

/**
 * Knowledge-base search as a research tool: adds hits to the collector, tells the model what was new.
 * The student's source market comes from the turn's route (`ctx.market`), not from the model, so
 * every search ranks the student's own market pages ahead of other markets'.
 */
export function makeSearchKnowledgeBaseTool(knowledge: KnowledgeStore, ctx: { collector: EvidenceCollector; topK: number; signal?: AbortSignal; market?: Market }) {
  return tool(
    async (input) => {
      const chunks = await knowledge.search(
        {
          text: input.query,
          k: ctx.topK,
          countries: input.countries?.length ? input.countries : undefined,
          docTypes: input.docTypes?.length ? input.docTypes : undefined,
          sources: input.sources?.length ? input.sources : undefined,
          sourceKinds: input.sourceKinds?.length ? input.sourceKinds : undefined,
          ...(ctx.market ? { market: ctx.market } : {}),
        },
        { signal: ctx.signal },
      );
      const added = ctx.collector.add(chunks, "kb", false);
      return EvidenceCollector.summaryForModel(added);
    },
    {
      name: "search_knowledge_base",
      description:
        "Search Expert Education's indexed knowledge base (experteducation.com market sites, partner-university websites, staff-uploaded documents). Use a focused natural-language query; optionally restrict by destination country, source or document type. Returns new evidence excerpts with citation numbers.",
      schema: z.object({
        query: z.string().min(2).max(300).describe("What to look for, phrased as a search query."),
        countries: z.array(z.enum(DESTINATIONS)).max(4).optional().describe("Destination countries to restrict to."),
        sources: z
          .array(z.string().min(2).max(80))
          .max(5)
          .optional()
          .describe('Source ids to restrict to, e.g. "experteducation.com", "partner:monash.edu", "upload:<slug>".'),
        docTypes: z.array(z.string().min(2).max(40)).max(5).optional().describe('Document types, e.g. "destination", "partner_university", "program", "blog".'),
        sourceKinds: z
          .array(z.enum(["site", "partner", "upload", "program", "official"]))
          .max(5)
          .optional()
          .describe("Provenance classes: site (experteducation.com), partner (university websites), upload (staff documents), program (extracted course records), official (government, regulator and test-body pages, re-crawled nightly)."),
      }),
    },
  );
}
