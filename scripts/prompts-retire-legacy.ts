/**
 * Retire the Langflow-era prompts in Langfuse: every prompt that is not part of
 * the Edge set loses its `production` label and gets `legacy` instead, so the
 * dashboard shows one clear production prompt set. Nothing is deleted.
 *
 *   bun run scripts/prompts-retire-legacy.ts            # dry run
 *   bun run scripts/prompts-retire-legacy.ts --apply
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { getLangfuse, shutdownLangfuse } from "../src/observability/langfuse";
import { logger } from "../src/observability/logger";
import { localPrompts } from "../src/prompts/registry";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { apply: { type: "boolean", default: false } } });
const env = loadEnv();
const langfuse = getLangfuse(env);
if (!langfuse) {
  logger.error("Langfuse is not configured");
  process.exit(1);
}
const keep = new Set(Object.keys(localPrompts()));
const label = env.LANGFUSE_PROMPT_LABEL;

const list = await langfuse.api.prompts.list({ limit: 100 });
let retired = 0;
for (const p of list.data) {
  if (keep.has(p.name)) continue;
  const labelled = p.labels?.includes(label);
  if (!labelled) continue;
  const version = Math.max(...p.versions);
  logger.info(values.apply ? "retiring prompt" : "would retire prompt", { name: p.name, version, labels: p.labels });
  if (values.apply) {
    await langfuse.api.promptVersion.update(p.name, version, { newLabels: ["legacy"] });
    retired++;
  }
}
const after = await langfuse.api.prompts.list({ limit: 100, label });
logger.info(values.apply ? "legacy prompts retired" : "dry run complete", {
  retired,
  productionPrompts: after.data.map((p) => p.name).sort(),
});
await shutdownLangfuse();
