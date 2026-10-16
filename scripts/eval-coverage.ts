/**
 * Answer-coverage eval against data/eval/coverage.jsonl: does an answer cover what a complete
 * answer to that question needs, with citations, at what cost and latency? Built to A/B the
 * country skill packs (SKILL_PACKS_ENABLED), market packs (MARKET_PACKS_ENABLED) and comparison
 * fan-out (COMPARE_FANOUT_ENABLED).
 *
 * Each row runs as a fresh single-turn chat through the real graph (classify → research →
 * generate), built here the way src/server.ts builds it, minus everything per-consultant or
 * persistent: no CRM, no Google Workspace, no write approvals, no activity log, no ChatService.
 * Nothing is written to MongoDB: the knowledge base, partner registry and program records are
 * only read, live lookups cache in memory, and query embeddings are not cached. The flags are
 * read from the environment as given, so the graph behaves as the server would with them.
 *
 * A Gemini judge (src/llm/generate.ts, JSON-schema output, temperature 0) then marks each
 * `mustCover` item covered / cited / honest gap. Scores per row: coverage = covered/total,
 * cited = (covered && cited)/total, honesty = (covered || honestGap)/total, inCL / offCL =
 * coverage of the items inside / outside the generated pack checklist, official = whether any
 * cited source sits on the row's officialDomains (checked deterministically, not by the judge).
 * Tables: per country, per intent, per cell, comparisons apart, and — for rows that name the
 * student's `origin` — per origin and per origin × destination; avg tokens and $/turn,
 * cached-input share, p50/p95 latency. Cost is n/a when a model has no price
 * (src/observability/pricing.ts has none for Gemini); tokens are the comparable figure then.
 * The web-search tool's own Gemini call and the judge are outside the turn's tokens.
 *
 * Models: ANSWER_MODEL / RESEARCH_MODEL as configured; when unset (or when the OpenRouter key
 * is unusable, as it is locally) they are the Gemini defaults. That is fine for an A/B as long
 * as both runs use the same models — the header prints them. CLASSIFIER_PROVIDER=gemini skips a
 * Jev call that would only fail and fall back on every row.
 * Timing and reasoning settings (ANSWER_TIMEOUT_MS, RESEARCH_BUDGET_MS, DEEP_THINK_TIMEOUT_MS,
 * ANSWER_REASONING, RESEARCH_REASONING) apply as on the server and the header prints them, e.g.
 *   ANSWER_TIMEOUT_MS=75000 bun run eval:coverage -- --label reasoning-75s
 * There is no HTTP request here, so REQUEST_TIMEOUT_MS never cuts a row.
 *
 *   SKILL_PACKS_ENABLED=false bun run eval:coverage -- --label baseline
 *   SKILL_PACKS_ENABLED=true  bun run eval:coverage -- --label packs
 *   SKILL_PACKS_ENABLED=true COMPARE_FANOUT_ENABLED=true bun run eval:coverage -- --label fanout --only cmp-1,cmp-2
 *   bun run eval:coverage -- --countries au,nz --limit 6 --concurrency 2
 *   bun run eval:coverage -- --compare data/eval/runs/<a>.json data/eval/runs/<b>.json
 *
 * Locally, against another checkout's .env whose Google Workspace config is partial (loadEnv
 * rejects a half-set one) and whose OpenRouter key has expired, blank those settings and load it:
 *   GOOGLE_WORKSPACE_CLIENT_ID= GOOGLE_WORKSPACE_CLIENT_SECRET= GOOGLE_WORKSPACE_REDIRECT_URI= GOOGLE_TOKEN_ENC_KEY= \
 *   ANSWER_MODEL= RESEARCH_MODEL= SKILL_PACKS_ENABLED=false \
 *   bun --env-file=../expert-ai-consultant/.env scripts/eval-coverage.ts --limit 10 --label baseline
 * With LANGFUSE_* set, prompts come from Langfuse (label LANGFUSE_PROMPT_LABEL) exactly as on the
 * server; prompts missing there fall back to the local copies (the SDK logs a 404 for each).
 * Run files land in data/eval/runs/ (git-ignored).
 *
 * Options: --only id1,id2  --countries au,uk,ca,us,nz (any listed country)  --intents a,b
 * --origins nepal,india (rows naming any listed origin)
 * --limit N  --concurrency 2  --label baseline  --out <file>  --judge-model gemini-3.6-flash
 * --counsellor-region origin|none (default origin: each row runs as a counsellor in the row's own
 * origin market, as production defaults to the consultant's CRM branch; none = no default region)
 * --verbose (print each answer's per-item verdicts).
 * The summary counts which routing layer supplied each row's origin ("origin from: keywords …,
 * counsellor …"), so a run shows how many rows were routed by the default rather than the text.
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { setLogLevel } from "../src/observability/logger";
import { closeMongo, getCollections, getDb, pingMongo } from "../src/db/mongo";
import { GeminiEmbeddings } from "../src/llm/embeddings";
import { createAnswerModels, createResearchModel } from "../src/llm/providers";
import { createKnowledgeStore } from "../src/retrieval";
import { parseQuotas, QuotaKnowledgeStore } from "../src/retrieval/multipass";
import { getLangfuse } from "../src/observability/langfuse";
import { createPromptRegistry } from "../src/prompts/registry";
import { createClassifier } from "../src/classify";
import { buildGraph, type EdgeStateType } from "../src/graph";
import { GeminiGenerate } from "../src/llm/generate";
import { InMemoryLiveCache } from "../src/live/cache";
import { fetchPageForAnswer } from "../src/live/fetch";
import { partnerDomainProvider } from "../src/live/partner-domains";
import { DomainPolicy, fetchAllowlist } from "../src/live/policy";
import { webSearch } from "../src/live/search";
import { MongoPartnerRegistry } from "../src/partners/registry";
import { MongoProgramSearch } from "../src/ingest/programs";
import { LlmUsageRecorder, summarizeLlm } from "../src/observability/usage";
import { normalizeUserInput } from "../src/safety/sanitize";
import { CHECKLISTS, MARKET_CHECKLISTS } from "../src/skills/checklists.generated";
import { PACK_DEFINITIONS } from "../src/skills/packs";
import type { PageFetcher, WebSearcher } from "../src/tools";
import { csvRecords } from "./skills-build";
import {
  buildJudgePrompt,
  cellKey,
  citationsIn,
  compareSummaries,
  evalCounsellorRegion,
  formatCompare,
  formatOriginSources,
  formatSummary,
  isComparison,
  JUDGE_SCHEMA,
  JUDGE_SYSTEM,
  normalizeVerdicts,
  officialCited,
  originSourceCounts,
  outsideChecklist,
  parseDataset,
  resolveCountry,
  routeMatches,
  scoreRow,
  summarize,
  validateDataset,
  type CoverageRow,
  type EvidenceRef,
  type RowResult,
  type RunSummary,
} from "../src/eval/coverage";

interface RunFile {
  label: string;
  startedAt: string;
  finishedAt: string;
  config: Record<string, unknown>;
  summary: RunSummary;
  rows: RowResult[];
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    only: { type: "string" },
    countries: { type: "string" },
    intents: { type: "string" },
    origins: { type: "string" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "2" },
    label: { type: "string", default: "run" },
    out: { type: "string" },
    "judge-model": { type: "string", default: "gemini-3.6-flash" },
    "counsellor-region": { type: "string", default: "origin" },
    compare: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

// --- Compare mode: two run files in, delta table out, nothing runs -----------
if (values.compare) {
  if (positionals.length !== 2) {
    console.error("usage: bun run eval:coverage -- --compare <runA.json> <runB.json>");
    process.exit(2);
  }
  const [a, b] = (await Promise.all(positionals.map((p) => Bun.file(p).json()))) as RunFile[];
  console.log(formatCompare(`${a!.label} (${positionals[0]})`, `${b!.label} (${positionals[1]})`, compareSummaries(a!.summary, b!.summary)));
  const ids = (r: RunFile) => new Set(r.rows.map((x) => x.id));
  const onlyA = [...ids(a!)].filter((id) => !ids(b!).has(id));
  const onlyB = [...ids(b!)].filter((id) => !ids(a!).has(id));
  if (onlyA.length || onlyB.length) console.log(`\n! The runs cover different rows (only in A: ${onlyA.join(",") || "none"}; only in B: ${onlyB.join(",") || "none"}); compare like with like.`);
  process.exit(0);
}

const counsellorRegionArg = values["counsellor-region"];
if (counsellorRegionArg !== "origin" && counsellorRegionArg !== "none") {
  console.error(`--counsellor-region must be origin or none (got ${counsellorRegionArg})`);
  process.exit(2);
}
const counsellorRegionMode: "origin" | "none" = counsellorRegionArg;

// --- Dataset ----------------------------------------------------------------
const catalog = new Map(csvRecords(await Bun.file(new URL("../docs/data-model/catalog.csv", import.meta.url)).text()).map((r) => [r.id, r.full_name]));
const packDomains = Object.fromEntries(Object.entries(PACK_DEFINITIONS).map(([c, p]) => [c, p.officialSources.map((s) => s.domain)]));
const all = parseDataset(await Bun.file(new URL("../data/eval/coverage.jsonl", import.meta.url)).text());
const invalid = validateDataset(all, { catalogIds: new Set(catalog.keys()), checklists: CHECKLISTS, marketChecklists: MARKET_CHECKLISTS, packDomains });
if (invalid.length) {
  console.error(`coverage.jsonl is invalid:\n  ${invalid.join("\n  ")}`);
  process.exit(2);
}
const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);
const only = list(values.only);
const countries = list(values.countries)?.map(resolveCountry) ?? null;
const intents = list(values.intents);
const origins = list(values.origins);
let rows = all.filter(
  (r) => (!only || only.includes(r.id)) && (!countries || r.countries.some((c) => countries.includes(c))) && (!intents || intents.includes(r.intent)) && (!origins || (r.origin !== undefined && origins.includes(r.origin))),
);
if (values.limit) rows = rows.slice(0, Number(values.limit));
if (!rows.length) {
  console.error("no rows match the filters");
  process.exit(2);
}

// --- Graph (mirrors src/server.ts; read-only against MongoDB) ---------------
const env = loadEnv();
setLogLevel(process.env.EVAL_LOG_LEVEL === "debug" ? "debug" : "error");
const db = getDb(env);
const collections = getCollections(db);
if (!(await pingMongo(db))) {
  console.error("MongoDB is unreachable; the knowledge base is needed for a meaningful run.");
  process.exit(2);
}
const embeddings = new GeminiEmbeddings({ apiKey: env.GOOGLE_API_KEY, model: env.GEMINI_EMBEDDING_MODEL, dimensions: env.EMBEDDING_DIMENSIONS });
const { store: baseKnowledge, mode: searchMode } = await createKnowledgeStore(env, db, embeddings);
const quotas = parseQuotas(env.RETRIEVAL_QUOTAS);
const knowledge = quotas ? new QuotaKnowledgeStore(baseKnowledge, quotas) : baseKnowledge;
const prompts = createPromptRegistry(env, getLangfuse(env));
await prompts.warm();
const { classifier, provider: classifierProvider } = createClassifier(env);
const { primary: answerModel, deep: answerDeepModel, fallback: answerFallbackModel } = createAnswerModels(env);
const researchModel = createResearchModel(env);
const partners = new MongoPartnerRegistry(collections.kbPartners);
const policy = new DomainPolicy({ allow: fetchAllowlist(env.WEB_FETCH_ALLOWED_DOMAINS), partnerDomains: partnerDomainProvider(partners), allowExplicitUrls: env.WEB_FETCH_ALLOW_EXPLICIT_URLS });
const liveCache = new InMemoryLiveCache();
const gemini = new GeminiGenerate({ apiKey: env.GOOGLE_API_KEY });
const web: WebSearcher | undefined = env.WEB_SEARCH_ENABLED
  ? { search: (q, o) => webSearch(q, o, { gen: gemini, model: env.GEMINI_WEB_SEARCH_MODEL, cache: liveCache, policy, cacheTtlSeconds: env.LIVE_CACHE_TTL_SECONDS }) }
  : undefined;
const fetcher: PageFetcher | undefined = env.WEB_FETCH_ENABLED
  ? {
      fetch: (url, o) =>
        fetchPageForAnswer(url, o, { policy, cache: liveCache, userAgent: env.CRAWL_USER_AGENT, timeoutMs: env.WEB_FETCH_TIMEOUT_MS, maxBytes: env.WEB_FETCH_MAX_BYTES, cacheTtlSeconds: env.LIVE_CACHE_TTL_SECONDS }),
    }
  : undefined;
const graph = buildGraph({
  env,
  classifier,
  answerModel,
  answerFallbackModel,
  answerDeepModel,
  researchModel,
  knowledge,
  prompts,
  tools: { web, fetcher, programs: new MongoProgramSearch(collections.kbPrograms) },
});

const judgeModel = values["judge-model"]!;
const flagEnv = Object.fromEntries(["SKILL_PACKS_ENABLED", "MARKET_PACKS_ENABLED", "COMPARE_FANOUT_ENABLED", "RESEARCH_MAX_ROUNDS", "RESEARCH_BUDGET_MS", "RETRIEVAL_QUOTAS"].map((k) => [k, process.env[k] ?? null]));
// The graph above is built from `env`, so these apply exactly as on the server; recorded as parsed (defaults included).
const timing = { ANSWER_TIMEOUT_MS: env.ANSWER_TIMEOUT_MS, RESEARCH_BUDGET_MS: env.RESEARCH_BUDGET_MS, DEEP_THINK_TIMEOUT_MS: env.DEEP_THINK_TIMEOUT_MS, ANSWER_REASONING: env.ANSWER_REASONING, RESEARCH_REASONING: env.RESEARCH_REASONING };
const config = {
  rows: rows.length,
  filters: { only, countries, intents, origins, limit: values.limit ?? null },
  counsellorRegion: counsellorRegionMode,
  flags: flagEnv,
  timing,
  answerModel: env.ANSWER_MODEL ?? `gemini:${env.GEMINI_MODEL}`,
  researchModel: env.RESEARCH_MODEL ?? `gemini:${env.GEMINI_RESEARCH_MODEL ?? env.GEMINI_MODEL}`,
  classifier: classifierProvider === "jev" ? `jev:${env.JEV_MODEL}` : `gemini:${env.GEMINI_CLASSIFIER_MODEL}`,
  judgeModel,
  searchMode,
  webSearch: Boolean(web),
  webFetch: Boolean(fetcher),
};
console.log(`Coverage eval "${values.label}": ${rows.length} rows, concurrency ${values.concurrency}`);
console.log(`  flags ${Object.entries(flagEnv).map(([k, v]) => `${k}=${v ?? "(unset)"}`).join(" ")}`);
console.log(`  timing ${Object.entries(timing).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  counsellor region ${counsellorRegionMode === "origin" ? "= the row's origin (CRM branch default)" : "none"}`);
console.log(`  answer ${config.answerModel} | research ${config.researchModel} | classifier ${config.classifier} | judge ${judgeModel} | kb ${searchMode}`);

// --- One row ----------------------------------------------------------------
const PACK_META = /pack|skill|market|fanout|fan_out|compare/i;

async function runRow(row: CoverageRow): Promise<RowResult> {
  const base: RowResult = { id: row.id, countries: row.countries, intent: row.intent, cell: cellKey(row), comparison: isComparison(row), ok: false, latencyMs: 0, ...(row.stage ? { stage: row.stage } : {}), ...(row.origin ? { origin: row.origin } : {}) };
  const recorder = new LlmUsageRecorder();
  const started = performance.now();
  let state: EdgeStateType;
  try {
    state = (await graph.invoke(
      { input: normalizeUserInput(row.text, env.MAX_INPUT_CHARS), history: [], sessionId: `eval-coverage-${row.id}`, profile: null, actorEmail: null, deepThink: false, guide: null, priorDestinations: [], priorOrigin: null, counsellorRegion: evalCounsellorRegion(row, counsellorRegionMode) },
      { callbacks: [recorder], runName: "eval-coverage", recursionLimit: 10 },
    )) as EdgeStateType;
  } catch (err) {
    return { ...base, latencyMs: Math.round(performance.now() - started), error: `graph: ${(err as Error).message.split("\n")[0]}` };
  }
  base.latencyMs = Math.round(performance.now() - started);

  const llm = summarizeLlm(recorder.calls, { jevCostUsd: typeof state.meta.jevCost === "number" ? state.meta.jevCost : null });
  const items = (state.evidence.length ? state.evidence : state.chunks.map((c, i) => ({ ...c, n: i + 1, live: false }))) as (EdgeStateType["evidence"][number])[];
  const evidence: EvidenceRef[] = items.map((e) => ({ n: e.n, title: e.title, url: e.url, live: e.live, content: e.content }));
  const citations = citationsIn(state.answer);
  const route = state.route;
  const skills = (state as { skills?: { versions?: string[] } | null }).skills;
  const flags = Object.fromEntries(Object.entries(state.meta).filter(([k]) => PACK_META.test(k)));
  if (skills?.versions) flags.skillPacks = skills.versions;
  const marketPack = (state.meta.route as { marketPack?: string } | undefined)?.marketPack;
  if (marketPack) flags.marketPack = marketPack;
  Object.assign(base, {
    answer: state.answer,
    route: route ? { countries: [...route.countries], mode: route.mode, topic: route.topic, stage: route.stage, origin: route.origin, originSource: route.originSource } : null,
    ...routeMatches(row, route),
    classified: state.intent ? { intent: state.intent.primary_intent, task: state.intent.task, needsResearch: state.intent.needs_research } : null,
    evidence: items.map((e) => ({ n: e.n, title: e.title, url: e.url, live: e.live, kind: e.kind })),
    citations,
    danglingCitations: citations.filter((n) => !evidence.some((e) => e.n === n)),
    research: state.researchTrace ? { rounds: state.researchTrace.rounds, toolCalls: state.researchTrace.toolCalls.length, liveUrls: state.researchTrace.liveUrls.length, budgetExceeded: state.researchTrace.budgetExceeded } : null,
    llm: {
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      cachedInputTokens: llm.cachedInputTokens ?? 0,
      reasoningTokens: llm.reasoningTokens ?? 0,
      costUsd: llm.uncostedCalls ? null : (llm.costUsd ?? null),
      calls: llm.calls.length,
      researchCalls: llm.researchCalls,
      answerModel: llm.answerModel,
      researchModel: llm.researchModel,
      classifierModel: llm.classifierModel,
      usedFallback: llm.usedFallback,
    },
    ...(Object.keys(flags).length ? { flags } : {}),
  } satisfies Partial<RowResult>);

  // Judge.
  const outside = new Set(outsideChecklist(row, CHECKLISTS, MARKET_CHECKLISTS));
  const required = row.mustCover.map((id) => ({ id, label: catalog.get(id) ?? id, inChecklist: !outside.has(id) }));
  const t = performance.now();
  try {
    const res = await gemini.generate({
      model: judgeModel,
      system: JUDGE_SYSTEM,
      parts: [{ text: buildJudgePrompt(row.text, state.answer, evidence, required) }],
      responseSchema: JUDGE_SCHEMA,
      temperature: 0,
      timeoutMs: 60_000,
    });
    if (res.json === undefined) throw new Error(`judge returned no JSON (finish ${res.finishReason})`);
    const verdicts = normalizeVerdicts(res.json, required);
    const official = row.officialDomains?.length ? officialCited(state.answer, evidence, row.officialDomains) : null;
    return { ...base, ok: true, verdicts, scores: scoreRow(verdicts, official), judge: { model: judgeModel, ms: Math.round(performance.now() - t), inputTokens: res.usage.input, outputTokens: res.usage.output } };
  } catch (err) {
    const message = (err as Error).message.split("\n")[0]!.slice(0, 300);
    return { ...base, error: `judge: ${message}`, judge: { model: judgeModel, ms: Math.round(performance.now() - t), inputTokens: 0, outputTokens: 0, error: message } };
  }
}

// --- Run (bounded pool) -----------------------------------------------------
const startedAt = new Date();
const results: RowResult[] = new Array(rows.length);
let next = 0;
let done = 0;
const worker = async () => {
  while (next < rows.length) {
    const i = next++;
    const row = rows[i]!;
    const r = await runRow(row);
    results[i] = r;
    done++;
    const s = r.scores;
    console.log(
      `${String(done).padStart(3)}/${rows.length} ${r.ok ? "✓" : "✗"} ${row.id.padEnd(12)} ${(r.latencyMs / 1000).toFixed(1).padStart(5)}s` +
        (s ? ` cov ${(s.coverage * 100).toFixed(0)}% cited ${(s.citedCoverage * 100).toFixed(0)}% honest ${(s.honesty * 100).toFixed(0)}%${s.official === null ? "" : ` official ${s.official ? "yes" : "no"}`}` : "") +
        ` ev ${r.evidence?.length ?? 0} route ${r.route?.countries.join("+") || "none"}/${r.route?.mode ?? "?"}${r.route?.origin ? ` from ${r.route.origin} (${r.route.originSource})` : ""}${r.originMatch === false ? ` (expected ${r.origin})` : ""}${r.error ? `  ${r.error}` : ""}`,
    );
    if (values.verbose && r.verdicts) {
      for (const v of r.verdicts) console.log(`      ${v.covered ? (v.cited ? "●" : "◐") : v.honestGap ? "?" : "○"} ${v.id} ${v.label}${v.inChecklist ? "" : " (off-checklist)"}`);
    }
  }
};
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, worker));

const summary = summarize(results);
console.log(formatSummary(summary));
const originSources = formatOriginSources(originSourceCounts(results));
if (originSources) console.log(`\n${originSources}`);
console.log("\ncov = covered/total · cited = covered with a supporting [n] · honest = covered or an explicit 'not found' · inCL/offCL = coverage of items inside/outside the pack checklist · offic = cites an official domain · route = routed countries (and origin, when the row names one) match the row · origin = routed origin matches the row's");
const errors = results.filter((r) => !r.ok);
if (errors.length) console.log(`\n${errors.length} row(s) errored and are left out of the scores:\n${errors.map((r) => `  ✗ ${r.id}: ${r.error}`).join("\n")}`);

const stamp = startedAt.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
const out = values.out ?? new URL(`../data/eval/runs/${stamp}-${values.label}.json`, import.meta.url).pathname;
const file: RunFile = { label: values.label!, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), config, summary, rows: results };
await Bun.write(out, JSON.stringify(file, null, 2));
console.log(`\nWrote ${out}`);
await closeMongo();
process.exit(0);
