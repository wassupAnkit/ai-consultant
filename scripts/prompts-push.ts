/**
 * Seed / update Edge's prompts in Langfuse so the team can edit them there.
 * Creates a new version only when the text differs from the current labelled
 * version, and applies the label (default: LANGFUSE_PROMPT_LABEL).
 *
 *   bun run prompts:push
 *   bun run prompts:push -- --label staging
 */
import { parseArgs } from "node:util";
import { loadEnv } from "../src/config/env";
import { getLangfuse, shutdownLangfuse } from "../src/observability/langfuse";
import { logger } from "../src/observability/logger";
import { localPrompts } from "../src/prompts/registry";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { label: { type: "string" } } });
const env = loadEnv();
const langfuse = getLangfuse(env);
if (!langfuse) {
  logger.error("Langfuse is not configured (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY)");
  process.exit(1);
}
const label = values.label ?? env.LANGFUSE_PROMPT_LABEL;

let created = 0;
let unchanged = 0;
for (const [name, text] of Object.entries(localPrompts())) {
  let current: string | null = null;
  try {
    const existing = await langfuse.prompt.get(name, { label, cacheTtlSeconds: 0, type: "text" });
    current = existing.prompt;
  } catch {
    current = null;
  }
  if (current === text) {
    unchanged++;
    continue;
  }
  await langfuse.prompt.create({ name, prompt: text, type: "text", labels: [label], commitMessage: "Synced from expert-ai-consultant repo (prompts:push)" });
  created++;
  logger.info("prompt pushed", { name, label });
}
logger.info("prompts synced", { label, created, unchanged });
await shutdownLangfuse();
