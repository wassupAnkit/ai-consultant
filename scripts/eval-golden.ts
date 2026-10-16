/**
 * Golden-facts eval: ask a running Edge every case in data/eval/golden-facts.jsonl (generated
 * from the facts registers by `bun run golden:build`) and check the answer states the exact
 * figures. No judge model; see src/eval/golden.ts for the matching rules.
 *
 *   # production, from inside an Edge pod (the script ships in the image):
 *   kubectl exec <pod> -- sh -c 'bun scripts/eval-golden.ts --url http://localhost:3000 --api-key "$API_KEY" --sample 40'
 *   # a local backend:
 *   bun run eval:golden -- --url http://localhost:3002 --api-key "$(cat <key file>)" --repeat 3 --label oct12
 *   # release gate: exit 1 below 85% pass or above 2% stale
 *   bun run eval:golden -- --url … --api-key … --min-pass 0.85 --max-stale 0.02
 *
 * Sets: --set facts (generated from the registers; default) | scenarios (audit failures,
 * data/eval/golden-scenarios.jsonl: expected and forbidden figures, required and rejected claims) | both.
 * Every run also records whether Edge's own "Figure check" line fired (figure-check flagged %).
 *
 * Options: --cases <jsonl>  --scenarios <jsonl>  --only id1,id2  --registers australia,united_kingdom  --sample N (every k-th case, a
 * stable subset)  --limit N  --repeat N (runs per case; adds a consistency score)  --concurrency 3
 * --label name  --out file  --verbose (print every failing answer's figures).
 * Each case runs as a new session. Run files land in data/eval/runs/ (git-ignored).
 */
import { parseArgs } from "node:util";
import { parseGolden, parseScenarios, scoreAnswer, scoreScenario, summarizeGolden, validateScenarios, type CaseOutcome, type GoldenRunRow } from "../src/eval/golden";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    cases: { type: "string" },
    scenarios: { type: "string" },
    set: { type: "string", default: "facts" },
    "api-key": { type: "string" },
    only: { type: "string" },
    registers: { type: "string" },
    sample: { type: "string" },
    limit: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
    label: { type: "string", default: "golden" },
    out: { type: "string" },
    "min-pass": { type: "string" },
    "max-stale": { type: "string" },
    "max-wrong": { type: "string" },
    "timeout-ms": { type: "string", default: "150000" },
    verbose: { type: "boolean", default: false },
  },
});

if (!values.url) {
  console.error("--url is required (a running Edge, e.g. http://localhost:3000)");
  process.exit(2);
}
const base = values.url.replace(/\/+$/, "");
const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);

/** One question with its own scorer, from either set. */
interface EvalCase {
  id: string;
  register: string;
  set: "facts" | "scenarios";
  question: string;
  expected: string;
  score: (answer: string) => { outcome: CaseOutcome; missing: string[]; staleFound: string[]; reasons?: string[] };
}

const which = values.set;
if (!["facts", "scenarios", "both"].includes(which ?? "")) {
  console.error("--set must be facts, scenarios or both");
  process.exit(2);
}
let cases: EvalCase[] = [];
if (which !== "scenarios") {
  const facts = parseGolden(await Bun.file(values.cases ?? new URL("../data/eval/golden-facts.jsonl", import.meta.url).pathname).text());
  cases.push(...facts.map((c): EvalCase => ({ id: c.id, register: c.register, set: "facts", question: c.question, expected: c.expect.map((f) => f.text).join(" ; "), score: (a) => scoreAnswer(c, a) })));
}
if (which !== "facts") {
  const scenarios = parseScenarios(await Bun.file(values.scenarios ?? new URL("../data/eval/golden-scenarios.jsonl", import.meta.url).pathname).text());
  const invalid = validateScenarios(scenarios);
  if (invalid.length) {
    console.error(`golden-scenarios.jsonl is invalid:\n  ${invalid.join("\n  ")}`);
    process.exit(2);
  }
  cases.push(
    ...scenarios.map((c): EvalCase => ({
      id: c.id,
      register: c.register,
      set: "scenarios",
      question: c.question,
      expected: [...c.expect, ...c.require.map((r) => r.label)].join(" ; ") + (c.forbid.length || c.reject.length ? ` | never: ${[...c.forbid, ...c.reject.map((r) => r.label)].join(" ; ")}` : ""),
      score: (a) => {
        const r = scoreScenario(c, a);
        return { outcome: r.outcome, missing: r.reasons.filter((x) => x.startsWith("missing")), staleFound: [], reasons: r.reasons };
      },
    })),
  );
}
const only = list(values.only);
const registers = list(values.registers);
if (only) cases = cases.filter((c) => only.includes(c.id));
if (registers) cases = cases.filter((c) => registers.includes(c.register));
if (values.sample) {
  // Evenly spread over the whole list, so every register is sampled.
  const n = Math.min(Number(values.sample), cases.length);
  const picked = new Set(Array.from({ length: n }, (_, k) => Math.floor((k * cases.length) / n)));
  cases = cases.filter((_, i) => picked.has(i));
}
if (values.limit) cases = cases.slice(0, Number(values.limit));
if (!cases.length) {
  console.error("no cases match the filters");
  process.exit(2);
}

const repeat = Math.max(1, Number(values.repeat));
const headers: Record<string, string> = { "content-type": "application/json" };
if (values["api-key"]) headers["x-api-key"] = values["api-key"];
const timeoutMs = Number(values["timeout-ms"]);

async function ask(question: string): Promise<{ answer: string; ms: number; error?: string }> {
  const started = performance.now();
  try {
    const res = await fetch(`${base}/v1/chat`, { method: "POST", headers, body: JSON.stringify({ message: question, newSession: true }), signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(performance.now() - started);
    if (!res.ok) return { answer: "", ms, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const body = (await res.json()) as { answer?: string };
    return { answer: String(body.answer ?? ""), ms };
  } catch (err) {
    return { answer: "", ms: Math.round(performance.now() - started), error: (err as Error).message.slice(0, 200) };
  }
}

console.log(`golden ${which}: ${cases.length} cases × ${repeat} run(s) against ${base} (concurrency ${values.concurrency})`);
const startedAt = new Date().toISOString();
const rows: GoldenRunRow[] = cases.map((c) => ({ id: c.id, register: c.register, set: c.set, runs: [] }));
const answers = new Map<string, string[]>();
const jobs = cases.flatMap((c, i) => Array.from({ length: repeat }, () => ({ c, i })));
let done = 0;
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    while (jobs.length) {
      const { c, i } = jobs.shift()!;
      const r = await ask(c.question);
      const score = r.error ? { outcome: "miss" as const, missing: [c.expected], staleFound: [], reasons: [] } : c.score(r.answer);
      rows[i]!.runs.push({
        outcome: score.outcome,
        ms: r.ms,
        missing: score.missing,
        staleFound: score.staleFound,
        ...(score.reasons?.length ? { reasons: score.reasons } : {}),
        flagged: /Figure check:/.test(r.answer),
        ...(r.error ? { error: r.error } : {}),
      });
      answers.set(c.id, [...(answers.get(c.id) ?? []), r.answer]);
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${cases.length * repeat}`);
    }
  }),
);

const summary = summarizeGolden(rows);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\npass ${pct(summary.passRate)}  stale ${pct(summary.staleRate)}  wrong ${pct(summary.wrongRate)}  errors ${pct(summary.errorRate)}  figure-check flagged ${pct(summary.flagRate)}${summary.consistency !== null ? `  consistency ${pct(summary.consistency)}` : ""}  p50 ${(summary.p50Ms / 1000).toFixed(1)} s  p95 ${(summary.p95Ms / 1000).toFixed(1)} s`);
for (const set of ["facts", "scenarios"] as const) {
  const part = rows.filter((r) => r.set === set);
  if (part.length && which === "both") {
    const s = summarizeGolden(part);
    console.log(`  [${set}] ${part.length} cases  pass ${pct(s.passRate)}  stale ${pct(s.staleRate)}  wrong ${pct(s.wrongRate)}${s.consistency !== null ? `  consistency ${pct(s.consistency)}` : ""}`);
  }
}
for (const [reg, s] of Object.entries(summary.byRegister)) console.log(`  ${reg.padEnd(16)} ${String(s.cases).padStart(4)} cases  pass ${pct(s.passRate)}  stale ${pct(s.staleRate)}`);

const failing = rows.filter((r) => r.runs.some((x) => x.outcome !== "pass"));
if (failing.length) {
  console.log(`\nfailing cases (${failing.length}):`);
  for (const r of failing) {
    const c = cases.find((x) => x.id === r.id)!;
    const outcomes = r.runs.map((x) => x.outcome).join("/");
    const stale = [...new Set(r.runs.flatMap((x) => x.staleFound))];
    const missing = [...new Set(r.runs.flatMap((x) => x.missing))];
    const errors = [...new Set(r.runs.flatMap((x) => (x.error ? [x.error] : [])))];
    const reasons = [...new Set(r.runs.flatMap((x) => x.reasons ?? []))];
    console.log(`  ${outcomes.padEnd(14)} ${r.id}\n      expected ${c.expected}${reasons.length ? `; ${reasons.join("; ")}` : missing.length ? `; missing ${missing.join(", ")}` : ""}${stale.length ? `; STALE ${stale.join(", ")}` : ""}${errors.length ? `; error ${errors[0]}` : ""}`);
    if (values.verbose) for (const a of answers.get(r.id) ?? []) console.log(`      > ${a.slice(0, 400).replace(/\n/g, " ")}`);
  }
}

const out = values.out ?? new URL(`../data/eval/runs/golden-${values.label}-${startedAt.replace(/[:.]/g, "-")}.json`, import.meta.url).pathname;
await Bun.write(out, JSON.stringify({ label: values.label, url: base, startedAt, finishedAt: new Date().toISOString(), summary, rows, answers: Object.fromEntries(answers) }, null, 1));
console.log(`\nrun file: ${out}`);

const minPass = values["min-pass"] ? Number(values["min-pass"]) : null;
const maxStale = values["max-stale"] ? Number(values["max-stale"]) : null;
const maxWrong = values["max-wrong"] ? Number(values["max-wrong"]) : null;
const gateFailed = (minPass !== null && summary.passRate < minPass) || (maxStale !== null && summary.staleRate > maxStale) || (maxWrong !== null && summary.wrongRate > maxWrong);
if (gateFailed) {
  console.error(`\nGATE FAILED: pass ${pct(summary.passRate)} (min ${minPass ?? "-"}), stale ${pct(summary.staleRate)} (max ${maxStale ?? "-"}), wrong ${pct(summary.wrongRate)} (max ${maxWrong ?? "-"})`);
  process.exit(1);
}
