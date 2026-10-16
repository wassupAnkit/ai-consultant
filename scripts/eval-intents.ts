/**
 * Classifier evaluation against a golden set (default data/eval/intents.jsonl).
 *
 * Two classifiers can be scored on the same rows:
 *   --classifier gemini   the production structured-output classifier (default)
 *   --classifier jev      the TypeSafe Jev decision classifier (src/classify/jev.ts; needs OPENROUTER_API_KEY)
 *
 * Reports intent, task and needs_research accuracy, prompt-injection recall,
 * expected-flag recall and a per-intent recall table (so a newly added class
 * that only hits 1/5 is visible even when the aggregate passes). For Jev it also
 * scores audience, channel, stage and the yes/no signals, with false-positive
 * counts for the safety signals. Exit code 1 if intent or task accuracy falls
 * below --min (default 0.85), or injection recall falls below 0.95.
 *
 * Golden line fields: text, intent, accept[], task, acceptTask[], needs_research,
 * injection, flags[] (each must be set). Routing fields: destinations[] (the countries the
 * request is about) and mode ("single" | "comparison" | "none"); every row runs the classifier
 * output through `decideRoute` (single-turn, so no history carry-over) and rows with those
 * fields are scored for country precision / recall / exact match and mode accuracy, next to
 * the same numbers for the keyword layer alone (no classifier). Origin fields: origin (the
 * student's source market) and counsellorRegion (the market the simulated counsellor sits in,
 * passed to `decideRoute` as the region default); rows with `origin` are scored for origin
 * accuracy, split by the layer that supplied the route's origin. Routing and origin numbers are
 * reported, not gated. Optional `id` names the row in --out. Jev-only fields, ignored by the
 * Gemini scorer: audience/acceptAudience[], channel/acceptChannel[], stage/acceptStage[],
 * signals[] (each must fire), acceptSignals[] (tolerated if they fire).
 *
 *   bun run eval:intents
 *   bun run eval:intents -- --classifier jev
 *   bun run eval:intents -- --min 0.9 --model gemini-3.5-flash
 *   bun run eval:intents -- --only caseload_management,offer_enrolment
 *   bun run eval:intents -- --file data/eval/intents-deep.jsonl --out data/eval/runs/deep-jev.json --classifier jev
 */
import { parseArgs } from "node:util";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Audience, CaseStage, Channel, Signal } from "../src/classify/jev";
import { decideRoute, type OriginSource, type RouteDecision } from "../src/routing/route";
import { isMarket, type CounsellorRegion, type Market } from "../src/routing/markets";
import type { ContextFlag, Destination, PrimaryIntent, Task } from "../src/schemas/intent.schema";

export interface Golden {
  /** Optional stable id (the coverage id for intents-deep.jsonl); echoed in --out. */
  id?: string;
  text: string;
  intent?: PrimaryIntent;
  accept?: PrimaryIntent[];
  task?: Task;
  acceptTask?: Task[];
  needs_research?: boolean;
  injection?: boolean;
  /** Flags that must be present (besides prompt_injection_attempt, covered by `injection`). */
  flags?: ContextFlag[];
  // Jev-only expectations
  audience?: Audience;
  acceptAudience?: Audience[];
  channel?: Channel;
  acceptChannel?: Channel[];
  stage?: CaseStage;
  acceptStage?: CaseStage[];
  signals?: Signal[];
  acceptSignals?: Signal[];
  // Routing expectations (scored by decideRoute over the classifier output)
  destinations?: Destination[];
  mode?: RouteDecision["mode"];
  /** The student's source market the route must reach. */
  origin?: Market;
  /** The market the simulated counsellor sits in: `decideRoute`'s region default for this row. */
  counsellorRegion?: Market;
  /** Labels flagged for a human (data/eval/review/); scored like any other row. */
  review?: boolean;
}

/** What every classifier must produce for scoring. */
export interface Prediction {
  intent: string;
  task: string;
  needs_research: boolean;
  flags: string[];
  confidence?: number;
  audience?: string;
  channel?: string;
  stage?: string;
  signals?: string[];
  cost?: number;
  destinations: Destination[];
  secondary: PrimaryIntent[];
  references_prior_turn?: boolean;
  /** The classifier's free-text origin ("Nepal"); Gemini only. */
  origin?: string | null;
}

/** Golden lines from JSONL text: blank lines and `#` comments skipped. */
export function parseGolden(text: string): Golden[] {
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
    .map((l) => JSON.parse(l) as Golden);
}

/** The row's simulated counsellor as `decideRoute` takes it (a CRM branch in that market), else null. */
export function counsellorRegionOf(g: Pick<Golden, "counsellorRegion">): CounsellorRegion | null {
  return g.counsellorRegion && isMarket(g.counsellorRegion) ? { market: g.counsellorRegion, onshore: null, branch: null, source: "crm_branch" } : null;
}

/** Single-turn route for one row: no history, extras only when Jev classified. */
export function routeFor(g: Golden, r: Prediction, destinations: Destination[], jev: boolean): RouteDecision {
  return decideRoute({
    intent: { destinations, task: r.task as Task, primary_intent: r.intent as PrimaryIntent, secondary_intents: r.secondary, origin: r.origin ?? null },
    extras: jev ? { stage: (r.stage ?? "unspecified") as CaseStage, references_prior_turn: r.references_prior_turn ?? false } : null,
    input: g.text,
    history: [],
    counsellorRegion: counsellorRegionOf(g),
  });
}

/** Hit/total tally with an optional accept list. Returns null when the row has no expectation. */
export class Tally {
  hit = 0;
  total = 0;
  score(expected: string | undefined, accept: string[] | undefined, got: string | undefined): boolean | null {
    if (expected === undefined) return null;
    this.total++;
    const ok = got !== undefined && new Set([expected, ...(accept ?? [])]).has(got);
    if (ok) this.hit++;
    return ok;
  }
  get pct() {
    return this.total ? (100 * this.hit) / this.total : 100;
  }
  get text() {
    return `${this.pct.toFixed(1)}%  (${this.hit}/${this.total})`;
  }
}

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : "100.0");

/** Country precision/recall/exact match and mode accuracy over rows that carry routing labels. */
export class RouteTally {
  tp = 0;
  fp = 0;
  fn = 0;
  exact = 0;
  rows = 0;
  modeHit = 0;
  modeRows = 0;
  score(g: Pick<Golden, "destinations" | "mode">, route: Pick<RouteDecision, "countries" | "countrySource" | "mode">): string[] {
    const misses: string[] = [];
    if (g.destinations) {
      this.rows++;
      const want = new Set(g.destinations);
      const got = new Set(route.countries);
      const tp = [...got].filter((d) => want.has(d)).length;
      this.tp += tp;
      this.fp += got.size - tp;
      this.fn += want.size - tp;
      if (tp === want.size && got.size === want.size) this.exact++;
      else misses.push(`countries [${g.destinations.join(",") || "none"}] got ${route.countries.join(",") || "none"} (${route.countrySource.join("+") || "no source"})`);
    }
    if (g.mode) {
      this.modeRows++;
      if (route.mode === g.mode) this.modeHit++;
      else misses.push(`mode [${g.mode}] got ${route.mode}`);
    }
    return misses;
  }
  get text() {
    return `precision ${pct(this.tp, this.tp + this.fp)}%, recall ${pct(this.tp, this.tp + this.fn)}%, exact ${pct(this.exact, this.rows)}% (${this.exact}/${this.rows}); mode ${pct(this.modeHit, this.modeRows)}% (${this.modeHit}/${this.modeRows})`;
  }
}

/**
 * Origin accuracy over rows that carry `origin`, split two ways: by the layer that supplied the
 * route's origin ("none" when it routed none — every such row is a miss), and by whether the row
 * set a counsellor region (the region-default and explicit-override cases) or not.
 */
export class OriginTally {
  hit = 0;
  total = 0;
  bySource = new Map<OriginSource | "none", { hit: number; total: number }>();
  byRegion = { withRegion: { hit: 0, total: 0 }, noRegion: { hit: 0, total: 0 } };
  /** null when the row has no origin label; otherwise whether the route reached it. */
  score(g: Pick<Golden, "origin" | "counsellorRegion">, route: Pick<RouteDecision, "origin" | "originSource">): boolean | null {
    if (!g.origin) return null;
    const ok = route.origin === g.origin;
    const bump = (t: { hit: number; total: number }) => {
      t.total++;
      if (ok) t.hit++;
    };
    this.total++;
    if (ok) this.hit++;
    const key = route.originSource ?? "none";
    const s = this.bySource.get(key) ?? { hit: 0, total: 0 };
    bump(s);
    this.bySource.set(key, s);
    bump(g.counsellorRegion ? this.byRegion.withRegion : this.byRegion.noRegion);
    return ok;
  }
  get text() {
    const sources = [...this.bySource.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
      .map(([k, t]) => `${k} ${t.hit}/${t.total}`)
      .join(" · ");
    const { withRegion: w, noRegion: n } = this.byRegion;
    return `${pct(this.hit, this.total)}% (${this.hit}/${this.total}); by route source: ${sources || "n/a"}; counsellor region set ${w.hit}/${w.total}, not set ${n.hit}/${n.total}`;
  }
}

/** One row of --out: the label next to what the classifier and the route produced. */
export interface RowRecord {
  id?: string;
  text: string;
  label: { intent?: string; task?: string; destinations?: string[]; mode?: string; origin?: string; counsellorRegion?: string };
  error?: string;
  intent: string;
  secondary: string[];
  task: string;
  confidence?: number;
  stage?: string;
  classifierDestinations: string[];
  classifierOrigin?: string | null;
  route: Pick<RouteDecision, "countries" | "countrySource" | "mode" | "origin" | "originSource">;
  ok: { intent: boolean | null; task: boolean | null; countries: boolean | null; mode: boolean | null; origin: boolean | null };
}

export function rowRecord(g: Golden, r: Prediction, route: RouteDecision, error?: string): RowRecord {
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const accepts = (expected: string | undefined, accept: string[] | undefined, got: string) => (expected === undefined ? null : expected === got || (accept ?? []).includes(got));
  return {
    ...(g.id ? { id: g.id } : {}),
    text: g.text,
    label: { intent: g.intent, task: g.task, destinations: g.destinations, mode: g.mode, origin: g.origin, counsellorRegion: g.counsellorRegion },
    ...(error ? { error } : {}),
    intent: r.intent,
    secondary: r.secondary,
    task: r.task,
    ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
    ...(r.stage !== undefined ? { stage: r.stage } : {}),
    classifierDestinations: r.destinations,
    ...(r.origin !== undefined ? { classifierOrigin: r.origin } : {}),
    route: { countries: route.countries, countrySource: route.countrySource, mode: route.mode, origin: route.origin, originSource: route.originSource },
    ok: {
      intent: accepts(g.intent, g.accept, r.intent),
      task: accepts(g.task, g.acceptTask, r.task),
      countries: g.destinations ? sameSet(g.destinations, route.countries) : null,
      mode: g.mode ? g.mode === route.mode : null,
      origin: g.origin ? g.origin === route.origin : null,
    },
  };
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the input order in the result. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function main() {
  const { loadEnv } = await import("../src/config/env");
  const { createChatModel } = await import("../src/llm/gemini");
  const { CLASSIFIER_PROMPT } = await import("../src/prompts/intents");
  const { createJevClient, SIGNALS } = await import("../src/classify/jev");
  const { FALLBACK_INTENT, IntentSchema } = await import("../src/schemas/intent.schema");

  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      min: { type: "string", default: "0.85" },
      model: { type: "string" },
      concurrency: { type: "string", default: "4" },
      /** Comma-separated intents: evaluate only golden lines labelled with one of them. */
      only: { type: "string" },
      classifier: { type: "string", default: "gemini" },
      /** Golden JSONL to score (relative to the working directory). */
      file: { type: "string" },
      /** Write every row's label, prediction and route as JSON here. */
      out: { type: "string" },
      /** Retry a classifier error this many times before scoring the production fallback. */
      retries: { type: "string", default: "0" },
      /** Stop printing individual failures (summary only); useful for large files. */
      quiet: { type: "boolean", default: false },
    },
  });
  const env = loadEnv();
  if (values.model) env.GEMINI_CLASSIFIER_MODEL = values.model;

  type Classify = (text: string) => Promise<Prediction>;
  const useJev = values.classifier === "jev";
  let classify: Classify;
  if (useJev) {
    const jev = createJevClient(env);
    if (!jev) {
      console.error("OPENROUTER_API_KEY is not set; cannot evaluate the Jev classifier.");
      process.exit(2);
    }
    classify = async (text) => {
      const c = await jev.classify(text);
      return {
        intent: c.primary_intent,
        task: c.task,
        needs_research: c.needs_research,
        flags: c.contextual_flags,
        confidence: c.intent_confidence,
        audience: c.audience,
        channel: c.channel,
        stage: c.stage,
        signals: c.signals,
        cost: c.usage.cost,
        destinations: c.destinations,
        secondary: c.secondary_intents,
        references_prior_turn: c.references_prior_turn,
      };
    };
  } else if (values.classifier === "gemini") {
    const model = createChatModel(env, "classifier").withStructuredOutput(IntentSchema, { name: "classify_intent" });
    classify = async (text) => {
      const r = IntentSchema.parse(await model.invoke([new SystemMessage(CLASSIFIER_PROMPT), new HumanMessage(text)]));
      return { intent: r.primary_intent, task: r.task, needs_research: r.needs_research, flags: r.contextual_flags, destinations: r.destinations, secondary: r.secondary_intents, origin: r.origin };
    };
  } else {
    console.error(`unknown --classifier ${values.classifier} (gemini | jev)`);
    process.exit(2);
  }

  const file = values.file ? Bun.file(values.file) : Bun.file(new URL("../data/eval/intents.jsonl", import.meta.url));
  const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
  const golden = parseGolden(await file.text()).filter((g) => !only || (g.intent && only.has(g.intent)));

  const intentT = new Tally(),
    taskT = new Tally(),
    researchT = new Tally(),
    audienceT = new Tally(),
    channelT = new Tally(),
    stageT = new Tally();
  let injectionTP = 0,
    injectionTotal = 0,
    injectionFP = 0;
  let flagTP = 0,
    flagTotal = 0;
  let signalTP = 0,
    signalTotal = 0;
  /** Every signal and advisory flag is counted as a false positive when it fires on a row that neither expects nor tolerates it. */
  const signalFP = new Map<string, number>();
  const TRACKED_SIGNALS: readonly string[] = [...SIGNALS, "policy_recency", "integrity_risk", "crm_write_requested"];
  let stageOverreach = 0,
    stageUnspecifiedRows = 0;
  let errors = 0,
    cost = 0;
  const confusion = new Map<string, number>();
  const failures: string[] = [];
  const perIntent = new Map<string, { hit: number; total: number }>();
  const confRight: number[] = [],
    confWrong: number[] = [];
  const routeT = new RouteTally(),
    keywordRouteT = new RouteTally();
  const originT = new OriginTally(),
    keywordOriginT = new OriginTally();
  const retries = Number(values.retries);
  let done = 0;

  const records = await pool(golden, Number(values.concurrency), async (g) => {
    let r: Prediction;
    let error: string | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await classify(g.text);
        error = undefined;
        break;
      } catch (err) {
        error = ((err as Error).message.split("\n")[0] ?? "").slice(0, 120);
        if (attempt < retries) continue;
        // Production falls back to general_inquiry on a classifier error; score it the same way rather than abort the run.
        errors++;
        failures.push(`✗ classifier error (${error}): "${g.text}"`);
        const f = FALLBACK_INTENT(g.text);
        r = { intent: f.primary_intent, task: f.task, needs_research: f.needs_research, flags: f.contextual_flags, destinations: f.destinations, secondary: f.secondary_intents };
        break;
      }
    }
    if (++done % 100 === 0) console.error(`… ${done}/${golden.length}`);
    cost += r.cost ?? 0;

    const route = routeFor(g, r, r.destinations, useJev);
    for (const miss of routeT.score(g, route)) failures.push(`✗ route ${miss}: "${g.text}"`);
    const keywordRoute = routeFor(g, { ...r, origin: null }, [], useJev);
    keywordRouteT.score(g, keywordRoute);
    if (originT.score(g, route) === false) failures.push(`✗ origin [${g.origin}${g.counsellorRegion ? `, counsellor ${g.counsellorRegion}` : ""}] got ${route.origin ?? "none"} (${route.originSource ?? "no source"}): "${g.text}"`);
    keywordOriginT.score(g, keywordRoute);

    const okIntent = intentT.score(g.intent, g.accept, r.intent);
    if (g.intent) {
      const tally = perIntent.get(g.intent) ?? { hit: 0, total: 0 };
      tally.total++;
      if (okIntent) tally.hit++;
      else {
        const key = `${g.intent} → ${r.intent}`;
        confusion.set(key, (confusion.get(key) ?? 0) + 1);
        failures.push(`✗ intent [${g.intent}] got ${r.intent}${r.confidence !== undefined ? ` (${r.confidence.toFixed(2)})` : ""}: "${g.text}"`);
      }
      perIntent.set(g.intent, tally);
      if (r.confidence !== undefined) (okIntent ? confRight : confWrong).push(r.confidence);
    }
    if (taskT.score(g.task, g.acceptTask, r.task) === false) failures.push(`✗ task [${g.task}] got ${r.task}: "${g.text}"`);
    if (g.needs_research !== undefined) {
      researchT.total++;
      if (r.needs_research === g.needs_research) researchT.hit++;
      else failures.push(`✗ needs_research [${g.needs_research}] got ${r.needs_research}: "${g.text}"`);
    }
    const injected = r.flags.includes("prompt_injection_attempt");
    if (g.injection) {
      injectionTotal++;
      if (injected) injectionTP++;
      else failures.push(`✗ injection not flagged: "${g.text}"`);
    } else if (injected) {
      injectionFP++;
      failures.push(`✗ injection false positive: "${g.text}"`);
    }
    for (const flag of g.flags ?? []) {
      flagTotal++;
      if (r.flags.includes(flag)) flagTP++;
      else failures.push(`✗ flag ${flag} not set (got ${r.flags.join(",") || "none"}): "${g.text}"`);
    }

    if (useJev) {
      if (audienceT.score(g.audience, g.acceptAudience, r.audience) === false) failures.push(`✗ audience [${g.audience}] got ${r.audience}: "${g.text}"`);
      if (channelT.score(g.channel, g.acceptChannel, r.channel) === false) failures.push(`✗ channel [${g.channel}] got ${r.channel}: "${g.text}"`);
      if (stageT.score(g.stage, g.acceptStage, r.stage) === false) failures.push(`✗ stage [${g.stage}] got ${r.stage}: "${g.text}"`);
      if (g.stage === "unspecified") {
        stageUnspecifiedRows++;
        if (r.stage !== "unspecified" && !g.acceptStage?.includes(r.stage as CaseStage)) stageOverreach++;
      }
      const tolerated = new Set<string>([...(g.signals ?? []), ...(g.acceptSignals ?? []), ...(g.flags ?? [])]);
      for (const s of g.signals ?? []) {
        signalTotal++;
        if (r.signals?.includes(s)) signalTP++;
        else failures.push(`✗ signal ${s} not set (got ${r.signals?.join(",") || "none"}): "${g.text}"`);
      }
      for (const s of TRACKED_SIGNALS) {
        const fired = r.signals?.includes(s) || r.flags.includes(s);
        if (fired && !tolerated.has(s)) {
          signalFP.set(s, (signalFP.get(s) ?? 0) + 1);
          failures.push(`✗ false positive ${s}: "${g.text}"`);
        }
      }
    }
    return rowRecord(g, r, route, error);
  });

  if (values.out) {
    await Bun.write(values.out, JSON.stringify({ classifier: values.classifier, model: useJev ? env.JEV_MODEL : env.GEMINI_CLASSIFIER_MODEL, file: values.file ?? "data/eval/intents.jsonl", at: new Date().toISOString(), rows: records }, null, 1));
    console.error(`wrote ${records.length} rows to ${values.out}`);
  }

  const injectionRecall = injectionTotal ? injectionTP / injectionTotal : 1;
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "n/a");

  console.log(`\nClassifier: ${values.classifier} (${useJev ? env.JEV_MODEL : env.GEMINI_CLASSIFIER_MODEL})  rows: ${golden.length}${values.file ? `  file: ${values.file}` : ""}`);
  console.log(`Intent accuracy: ${intentT.text}`);
  console.log(`Task accuracy: ${taskT.text}`);
  console.log(`needs_research accuracy: ${researchT.text}`);
  console.log(`Injection recall: ${(injectionRecall * 100).toFixed(1)}%  (${injectionTP}/${injectionTotal}), false positives ${injectionFP}`);
  if (routeT.rows || routeT.modeRows) {
    console.log(`Routing (classifier + keywords): ${routeT.text}`);
    console.log(`Routing (keywords only):         ${keywordRouteT.text}`);
  }
  if (originT.total) {
    console.log(`Origin (classifier + keywords): ${originT.text}`);
    console.log(`Origin (keywords only):         ${keywordOriginT.text}`);
  }
  if (flagTotal) console.log(`Expected-flag recall: ${((flagTP / flagTotal) * 100).toFixed(1)}%  (${flagTP}/${flagTotal})`);
  if (useJev) {
    console.log(`Audience: ${audienceT.text} | Channel: ${channelT.text} | Stage: ${stageT.text}`);
    console.log(
      `Signal recall: ${signalTotal ? ((100 * signalTP) / signalTotal).toFixed(1) : "100.0"}%  (${signalTP}/${signalTotal}); false positives: ${TRACKED_SIGNALS.map((s) => `${s}=${signalFP.get(s) ?? 0}`).join(", ")}`,
    );
    console.log(`Stage over-reach: ${stageOverreach}/${stageUnspecifiedRows} rows labelled unspecified got a stage`);
    console.log(`Intent confidence when right ${avg(confRight)}, when wrong ${avg(confWrong)}; total cost $${cost.toFixed(4)}`);
  }
  if (errors) console.log(`Classifier errors (scored as the production fallback): ${errors}`);
  console.log("\nPer-intent recall:");
  for (const [intent, t] of [...perIntent.entries()].sort((a, b) => a[1].hit / a[1].total - b[1].hit / b[1].total || a[0].localeCompare(b[0]))) {
    console.log(`  ${t.hit / t.total < 1 ? "!" : " "} ${intent.padEnd(24)} ${t.hit}/${t.total}`);
  }
  if (confusion.size) {
    console.log("\nConfusions:");
    for (const [k, v] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
  }
  if (failures.length && !values.quiet) console.log("\n" + failures.join("\n"));
  const min = Number(values.min);
  if (intentT.pct / 100 < min || taskT.pct / 100 < min || injectionRecall < 0.95) {
    console.error(`\nFAILED: intent ${intentT.pct.toFixed(1)}% or task ${taskT.pct.toFixed(1)}% < ${(min * 100).toFixed(0)}%, or injection recall < 95%`);
    process.exit(1);
  }
  console.log("\nPASSED");
}

if (import.meta.main) await main();
