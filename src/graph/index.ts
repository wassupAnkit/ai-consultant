import { END, START, StateGraph } from "@langchain/langgraph";
import type { Env } from "../config/env";
import { makeNodes, type GraphDeps } from "./nodes";
import { makeResearchNode } from "./research";
import { makeDocumentsNode } from "./documents";
import { EdgeState } from "./state";

export const GRAPH_NAME = "edge_consultant";

/**
 * (attachments) documents → classify
 * classify → (prompt injection) refuse → END
 *          → (needs_research = false) generate → END
 *          → research → generate → END
 *          → (a rewrite asking for the home currency) rates → generate → END
 *
 * `research` = deterministic knowledge-base search, then a bounded tool-calling
 * loop (narrower KB queries, program records, web search, live page fetch)
 * inside one node so the answer model's tokens stay the only streamed tokens.
 * The graph is stateless; conversation persistence happens in ChatService so
 * the graph can be unit-tested with fakes and no database.
 */
export function buildGraph(deps: GraphDeps) {
  const n = makeNodes(deps);
  // Same resolution as makeNodes: market packs follow skill packs unless set on their own.
  const skillPacks = deps.skillPacks ?? deps.env.SKILL_PACKS_ENABLED ?? false;
  const marketPacks = deps.marketPacks ?? deps.env.MARKET_PACKS_ENABLED ?? skillPacks;
  // Compliance guides: round-0 excerpts and the search_compliance_guides tool, with either pack flag.
  const complianceGuides = deps.research?.complianceGuides ?? (skillPacks || marketPacks);
  const research = makeResearchNode({
    tools: { knowledge: deps.knowledge, ...deps.tools, ...(complianceGuides ? { complianceGuides: true } : {}) },
    ...(deps.crmProvider ? { crmProvider: deps.crmProvider } : {}),
    ...(deps.crmWrites ? { crmWrites: deps.crmWrites } : {}),
    ...(deps.workspaceProvider ? { workspaceProvider: deps.workspaceProvider } : {}),
    ...(deps.gmailDrafts ? { gmailDrafts: deps.gmailDrafts } : {}),
    ...(deps.env.CRM_WEB_URL ? { crmWebUrl: deps.env.CRM_WEB_URL } : {}),
    researchModel: deps.researchModel,
    prompts: deps.prompts,
    config: {
      maxRounds: deps.research?.maxRounds ?? deps.env.RESEARCH_MAX_ROUNDS ?? 3,
      budgetMs: deps.research?.budgetMs ?? deps.env.RESEARCH_BUDGET_MS ?? 25_000,
      maxEvidence: deps.research?.maxEvidence ?? deps.env.RESEARCH_MAX_EVIDENCE ?? 24,
      topK: deps.research?.topK ?? deps.env.RETRIEVAL_TOP_K,
      toolTimeoutMs: deps.research?.toolTimeoutMs,
      maxCallsPerRound: deps.research?.maxCallsPerRound,
      roundTimeoutMs: deps.research?.roundTimeoutMs ?? deps.env.RESEARCH_ROUND_TIMEOUT_MS,
      minRoundMs: deps.research?.minRoundMs ?? deps.env.RESEARCH_MIN_ROUND_MS,
      urgentMaxRounds: deps.research?.urgentMaxRounds ?? deps.env.RESEARCH_URGENT_MAX_ROUNDS,
      shortMaxRounds: deps.research?.shortMaxRounds ?? deps.env.RESEARCH_SHORT_MAX_ROUNDS,
      officialKbMinHits: deps.research?.officialKbMinHits ?? (deps.env as Partial<Pick<Env, "OFFICIAL_KB_MIN_HITS">>).OFFICIAL_KB_MIN_HITS ?? 0,
      intentScoping: deps.research?.intentScoping ?? deps.env.RESEARCH_INTENT_SCOPING ?? true,
      streamReasoning: deps.research?.streamReasoning ?? false,
      compareFanout: deps.research?.compareFanout ?? deps.env.COMPARE_FANOUT_ENABLED ?? false,
      compareMaxCountries: deps.research?.compareMaxCountries ?? deps.env.COMPARE_MAX_COUNTRIES ?? 3,
      compareBranchRounds: deps.research?.compareBranchRounds ?? deps.env.COMPARE_BRANCH_ROUNDS ?? 2,
      complianceGuides,
      factsRegister: deps.research?.factsRegister ?? (deps.env as Partial<Pick<Env, "FACTS_REGISTER_ENABLED">>).FACTS_REGISTER_ENABLED ?? true,
      fxRates: deps.research?.fxRates ?? (deps.env as Partial<Pick<Env, "FX_RATES_ENABLED">>).FX_RATES_ENABLED ?? true,
    },
  });
  const documents = deps.documents ? makeDocumentsNode({ intake: deps.documents, ...(deps.crmProvider ? { crmProvider: deps.crmProvider } : {}), ...(deps.crmWrites ? { crmWrites: deps.crmWrites } : {}) }) : null;
  const graph = new StateGraph(EdgeState)
    .addNode("documents", documents ?? (async () => ({})))
    .addNode("classify", n.classify)
    .addNode("refuse", n.refuse)
    .addNode("research", research)
    .addNode("rates", n.rates)
    .addNode("generate", n.generate)
    // A turn with attachments reads them first (when document intake is on); every other turn starts at classify.
    .addConditionalEdges(START, (state) => (documents && state.attachments.length ? "documents" : "classify"), { documents: "documents", classify: "classify" })
    .addEdge("documents", "classify")
    .addConditionalEdges("classify", n.route, { refuse: "refuse", research: "research", rates: "rates", generate: "generate" })
    .addEdge("refuse", END)
    .addEdge("research", "generate")
    .addEdge("rates", "generate")
    .addEdge("generate", END);
  return graph.compile({ name: GRAPH_NAME });
}

export type EdgeGraph = ReturnType<typeof buildGraph>;
export { ANSWER_TAG, RESEARCH_TAG, type EdgeStateType } from "./state";
export type { GraphDeps } from "./nodes";
export type { ResearchConfig, ToolCapableModel } from "./research";
