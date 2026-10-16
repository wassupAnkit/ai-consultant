/**
 * Regenerate data/eval/golden-facts.jsonl from the facts registers (src/eval/golden.ts).
 *
 *   bun run golden:build            # rewrite the file
 *   bun run golden:build -- --check # exit 1 when the file is out of date (tests run the same check)
 *
 * Run it after every facts-register edit (docs/facts → data/facts) and commit the result with it.
 */
import { parseArgs } from "node:util";
import { buildGoldenCases, toJsonl } from "../src/eval/golden";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { check: { type: "boolean", default: false } } });
const path = new URL("../data/eval/golden-facts.jsonl", import.meta.url).pathname;
const next = toJsonl(buildGoldenCases());
const file = Bun.file(path);
const current = (await file.exists()) ? await file.text() : "";
if (values.check) {
  if (current !== next) {
    console.error("data/eval/golden-facts.jsonl is out of date: run `bun run golden:build` and commit it.");
    process.exit(1);
  }
  console.log("golden-facts.jsonl is up to date");
} else {
  await Bun.write(path, next);
  console.log(`wrote ${next.trim().split("\n").length} cases to data/eval/golden-facts.jsonl`);
}
