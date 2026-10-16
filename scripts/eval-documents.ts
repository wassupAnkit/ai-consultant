/**
 * Field-accuracy eval of document extraction on the SYNTHETIC fixtures (tests/fixtures/documents),
 * against the values they were generated from. Real Gemini calls: needs GOOGLE_API_KEY in the
 * environment. Never point this at real student documents or production data.
 *
 *   bun run scripts/eval-documents.ts [--model gemini-3.6-flash] [--fallback gemini-3.5-flash-lite]
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { extractDocument } from "../src/documents/student/extract";
import { sniffMimeType } from "../src/documents/student/service";
import { GeminiGenerate } from "../src/llm/generate";
import { EXPECTED } from "../tests/fixtures/documents/specimens";

const { values: args } = parseArgs({ options: { model: { type: "string" }, fallback: { type: "string" } } });
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_API_KEY is not set");
  process.exit(2);
}
const model = args.model ?? process.env.GEMINI_DOC_MODEL ?? "gemini-3.6-flash";
const gen = new GeminiGenerate({ apiKey });
const DIR = join(import.meta.dir, "../tests/fixtures/documents");
// The fixtures' "today": the passport expires in 2032, so no expiry warning is expected.
const today = new Date("2026-10-12T00:00:00Z");

const norm = (v: string | undefined | null) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const rows: string[][] = [];
let ok = 0;
let total = 0;
for (const [file, want] of Object.entries(EXPECTED)) {
  const bytes = new Uint8Array(await Bun.file(join(DIR, file)).arrayBuffer());
  const mimeType = sniffMimeType(bytes);
  if (!mimeType) throw new Error(`${file}: not a supported type`);
  const out = await extractDocument({ attachmentId: file, fileName: file, mimeType, bytes }, { gen, model, ...(args.fallback ? { fallbackModel: args.fallback } : {}), today });
  const got = Object.fromEntries(out.view.fields.map((f) => [f.key, f]));
  const check = (label: string, expected: string, actual: string, extra = "") => {
    const pass = norm(expected) === norm(actual);
    total++;
    if (pass) ok++;
    rows.push([file, label, expected, actual || "—", pass ? "ok" : "MISS", extra]);
  };
  check("documentType", want.documentType, out.view.documentType, `${out.ms} ms`);
  check("warnings", want.warnings.join(","), out.view.warnings.map((w) => w.code).join(","));
  for (const [key, value] of Object.entries(want.fields)) check(key, value, got[key]?.value ?? "", got[key] ? `${got[key]!.source}/${got[key]!.confidence}` : "");
}

const widths = rows[0]!.map((_, i) => Math.min(40, Math.max(...rows.map((r) => r[i]!.length), ["file", "field", "expected", "got", "", "source"][i]!.length)));
const line = (r: string[]) => r.map((c, i) => c.slice(0, 40).padEnd(widths[i]!)).join("  ");
console.log(`model ${model}${args.fallback ? ` (fallback ${args.fallback})` : ""}\n`);
console.log(line(["file", "field", "expected", "got", "", "source"]));
for (const r of rows) console.log(line(r));
console.log(`\nfield accuracy: ${ok}/${total} (${((100 * ok) / total).toFixed(1)}%)`);
process.exit(ok === total ? 0 : 1);
