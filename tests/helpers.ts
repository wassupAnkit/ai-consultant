import { RunnableLambda } from "@langchain/core/runnables";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import type { BaseMessage } from "@langchain/core/messages";
import { loadEnv, type Env } from "../src/config/env";
import { buildGraph, type GraphDeps } from "../src/graph";
import { PromptRegistry } from "../src/prompts/registry";
import { NullKnowledgeStore, type KnowledgeStore, type RetrievedChunk } from "../src/retrieval/store";
import { FALLBACK_INTENT, type Intent } from "../src/schemas/intent.schema";

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    GOOGLE_API_KEY: "test-key",
    MONGODB_URI: "mongodb://localhost:27017",
    LOG_LEVEL: "error",
    RATE_LIMIT_RPM: "1000",
    // Round-0 facts-register excerpts shift every evidence number; tests/facts-register.test.ts turns them on.
    FACTS_REGISTER_ENABLED: "false",
    ...overrides,
  });
}

export function intentOf(partial: Partial<Intent> & { primary_intent?: Intent["primary_intent"] }, input = "test"): Intent {
  return { ...FALLBACK_INTENT(input), confidence_level: "high", contextual_flags: [], ...partial };
}

export const sampleChunk = (n = 1, country: string | null = "australia"): RetrievedChunk => ({
  id: `chunk-${n}`,
  url: `https://experteducation.com/nepal/destinations/study-in-australia/#${n}`,
  title: "Study in Australia",
  section: "Tuition & Costs",
  docType: "destination",
  country,
  source: "experteducation.com",
  content: `Bachelor tuition ranges from AUD 20,000 to 45,000 per year. Living costs are about AUD 2,000–3,500 per month. (${n})`,
  score: 1 / n,
  matchedBy: ["vector"],
});

/** Graph wired with fakes: fixed classifier output, canned answer, in-memory knowledge, optional research model/tools. */
export function fakeGraph(opts: {
  intent: Intent;
  answer?: string;
  /** Answer model override, for streaming shapes a canned string cannot express (e.g. thought parts). */
  answerModel?: GraphDeps["answerModel"];
  /** Cheaper model the answer node degrades to; wired like production when a test needs the fallback. */
  answerFallbackModel?: GraphDeps["answerFallbackModel"];
  /** DeepThink answer model; absent → DeepThink turns use the primary, as in production without one. */
  answerDeepModel?: GraphDeps["answerDeepModel"];
  chunks?: RetrievedChunk[];
  researchModel?: GraphDeps["researchModel"];
  tools?: GraphDeps["tools"];
  research?: GraphDeps["research"];
  knowledge?: KnowledgeStore;
  crmProvider?: GraphDeps["crmProvider"];
  crmWrites?: GraphDeps["crmWrites"];
  workspaceProvider?: GraphDeps["workspaceProvider"];
  gmailDrafts?: GraphDeps["gmailDrafts"];
  /** Full classifier override (e.g. one that returns `extras` next to the intent). */
  classifier?: GraphDeps["classifier"];
  /** Country skill packs (SKILL_PACKS_ENABLED); off unless a test turns them on. */
  skillPacks?: boolean;
  /** Market packs (MARKET_PACKS_ENABLED); absent → follows `skillPacks`. */
  marketPacks?: boolean;
  /** Environment override (e.g. a short ANSWER_TIMEOUT_MS); default `testEnv()`. */
  env?: Env;
  /** Student document intake (the `documents` node); absent → attachments are never read. */
  documents?: GraphDeps["documents"];
}) {
  const env = opts.env ?? testEnv();
  const classifier = opts.classifier ?? RunnableLambda.from(async (_m: BaseMessage[]) => opts.intent);
  const answerModel = opts.answerModel ?? new FakeListChatModel({ responses: [opts.answer ?? "Here is a grounded answer [1]."] });
  const knowledge = opts.knowledge ?? new NullKnowledgeStore(opts.chunks ?? [sampleChunk(1), sampleChunk(2)]);
  const prompts = new PromptRegistry(null, { label: "production", cacheTtlSeconds: 0 });
  return {
    graph: buildGraph({
      env,
      classifier,
      answerModel,
      answerFallbackModel: opts.answerFallbackModel,
      answerDeepModel: opts.answerDeepModel,
      knowledge,
      prompts,
      researchModel: opts.researchModel,
      tools: opts.tools,
      research: opts.research,
      crmProvider: opts.crmProvider,
      crmWrites: opts.crmWrites,
      workspaceProvider: opts.workspaceProvider,
      gmailDrafts: opts.gmailDrafts,
      skillPacks: opts.skillPacks,
      marketPacks: opts.marketPacks,
      documents: opts.documents,
    }),
    env,
  };
}
