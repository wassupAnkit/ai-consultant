import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { COMPLIANCE_SLUGS, complianceChunk, complianceGuidesContents, complianceSectionExcerpt, searchComplianceGuides, type ComplianceSlug } from "../skills/compliance-guides";
import type { RetrievedChunk } from "../retrieval/store";
import { EvidenceCollector } from "./evidence";

/** Sections one search returns: enough for a rule and its neighbour, few enough to leave evidence room. */
export const COMPLIANCE_SEARCH_RESULTS = 2;

/**
 * Expert's compliance guides (src/skills/compliance-guides.ts) as a research tool, so the planner
 * can pull a rule itself when round 0 did not add it: a follow-up angle (the complaint route after
 * the commission rule), another destination, or a section it names. Read from memory, no I/O.
 * Results join the evidence like any knowledge-base hit; a section already collected is reported
 * by its citation number instead of being added twice.
 */
export function makeSearchComplianceGuidesTool(ctx: { collector: EvidenceCollector }) {
  return tool(
    async (input) => {
      const guides = input.guides?.length ? (input.guides as ComplianceSlug[]) : COMPLIANCE_SLUGS;
      let chunks: RetrievedChunk[];
      if (input.section !== undefined && guides.length === 1) {
        const one = complianceSectionExcerpt(guides[0]!, input.section);
        if (!one) return `No section ${input.section} in the ${guides[0]} compliance guide. Sections:\n${complianceGuidesContents()}`;
        chunks = [one];
      } else {
        chunks = searchComplianceGuides(input.query, guides)
          .slice(0, COMPLIANCE_SEARCH_RESULTS)
          .map((r) => complianceChunk(r.guide, r.section));
      }
      if (!chunks.length) return "No compliance-guide section matched. Try the regulator or rule name (e.g. commission, release letter, immigration advice, licence), or pass a guide and a section number.";
      const added = ctx.collector.add(chunks, "kb", false);
      const already = chunks
        .filter((c) => !added.some((a) => a.id === c.id))
        .map((c) => ctx.collector.items.find((i) => i.id === c.id))
        .filter((i) => i !== undefined)
        .map((i) => `[${i.n}] ${i.title} (already collected)`);
      return [added.length ? EvidenceCollector.summaryForModel(added) : "", ...already].filter(Boolean).join("\n\n") || EvidenceCollector.summaryForModel([]);
    },
    {
      name: "search_compliance_guides",
      description:
        "Search Expert's cited compliance guides: what a counsellor or agency may legally and ethically do. Use it for commission (including Australia's ban on commission for onshore transfers), provider transfers and release letters, who may give migration or immigration advice and when to refer to a registered or licensed adviser, agent codes and quality frameworks, a source country's agency licensing, and complaints. Prefer it over web_search for these. Pass a query; optionally restrict to guides, or pass one guide and a section number to read that section. Guides and sections:\n" +
        complianceGuidesContents(),
      schema: z.object({
        query: z.string().min(2).max(300).describe("The rule or situation to look up, e.g. 'university refuses commission for onshore transfer'."),
        guides: z
          .array(z.enum(COMPLIANCE_SLUGS as [ComplianceSlug, ...ComplianceSlug[]]))
          .max(3)
          .optional()
          .describe("Guides to search: a destination (australia, united_kingdom, canada, new_zealand, united_states) or source-markets (agency law in Nepal, India, Bangladesh, Vietnam, the Philippines, Thailand, Sri Lanka)."),
        section: z.number().int().min(1).max(20).optional().describe("With exactly one guide: read this numbered section."),
      }),
    },
  );
}
