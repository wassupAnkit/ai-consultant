import { describe, expect, test } from "bun:test";
import { ProgramSearchRequestSchema } from "../src/app/http";
import { extractPage } from "../src/ingest/extract";
import { buildProgramFilter, extractPrograms, MongoProgramSearch, ProgramExtractionSchema, programUrl, renderProgramPage, renderProgramText, toProgramRecordLike, type ProgramRecord } from "../src/ingest/programs";
import type { CrawlSource } from "../src/ingest/sources";
import { zodToGeminiSchema } from "../src/llm/generate";
import { FakeGemini, SAMPLE_HTML } from "./fakes";

const source: Pick<CrawlSource, "name" | "country" | "partnerSlug"> = { name: "partner:monash-university", country: "australia", partnerSlug: "monash-university" };

const llmProgram = {
  programName: "Master of Information Technology",
  level: "master",
  discipline: "Information Technology",
  disciplineTags: ["it", "computing"],
  campuses: ["Clayton"],
  deliveryModes: ["on_campus"],
  duration: { value: 2, unit: "years", text: "2 years full time" },
  tuition: [{ amount: 47900, currency: "AUD", period: "per_year", audience: "international", year: 2026, text: "International students: AUD 47,900 per year (2026 indicative)" }],
  intakes: ["February", "July"],
  applicationDeadlines: [],
  entryRequirements: { academic: ["Australian bachelor degree (or equivalent) with at least a 60% average"], text: null },
  englishRequirements: { ielts: { overall: 6.5, minBand: 6.0 }, pte: null, toefl: null, duolingo: null, other: [] },
  scholarships: [{ name: "International Merit Scholarship", amount: "AUD 10,000", text: "for high-achieving students" }],
  codes: { cricos: "012345A", courseCode: "C6001", ucas: null, other: [] },
  evidence: ["International students: AUD 47,900 per year"],
  confidence: 0.9,
};

const ok = (programs: unknown[], pageDescribesPrograms = true) => ({ text: "", json: { pageDescribesPrograms, programs }, finishReason: "STOP" as const, usage: { input: 1, output: 1, total: 2 } });

describe("program extraction", () => {
  test("schema defaults optional arrays and Gemini schema uses nullable instead of type arrays", () => {
    const parsed = ProgramExtractionSchema.parse({ pageDescribesPrograms: true, programs: [{ ...llmProgram, disciplineTags: undefined, campuses: undefined }] });
    expect(parsed.programs[0]!.disciplineTags).toEqual([]);
    const schema = JSON.stringify(zodToGeminiSchema(ProgramExtractionSchema));
    expect(schema).not.toContain('"null"');
    expect(schema).toContain('"nullable":true');
    expect(schema).not.toContain('"default"');
    expect(schema).not.toContain("additionalProperties");
  });

  test("extractPrograms maps model output to records with provenance and stable ids", async () => {
    const gen = new FakeGemini([ok([llmProgram])]);
    const page = await extractPage(SAMPLE_HTML, "https://www.monash.edu/study/mit");
    const records = await extractPrograms(page, { source, contentHash: "h1", university: "Monash University" }, { gen: gen.asGemini(), model: "flash-lite" });
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r).toMatchObject({ university: "Monash University", universitySlug: "monash-university", country: "australia", sourceUrl: "https://www.monash.edu/study/mit", source: "partner:monash-university", model: "flash-lite", contentHash: "h1" });
    expect(r._id).toMatch(/^[0-9a-f]{64}$/);
    expect(gen.requests[0]!.responseSchema).toBeDefined();
    expect(gen.requests[0]!.parts[0]).toMatchObject({ text: expect.stringContaining("Institution: Monash University") });
    const again = await extractPrograms(page, { source, contentHash: "h2", university: "Monash University" }, { gen: new FakeGemini([ok([llmProgram])]).asGemini(), model: "flash-lite" });
    expect(again[0]!._id).toBe(r._id); // same page + program → same id
  });

  test("falls back to the second model on invalid output, drops low-confidence and listing pages", async () => {
    const bad = { text: "not json", finishReason: "STOP" as const, usage: { input: 1, output: 1, total: 2 } };
    const gen = new FakeGemini([bad, ok([{ ...llmProgram, confidence: 0.2 }, llmProgram])]);
    const page = await extractPage(SAMPLE_HTML, "https://www.monash.edu/study/mit");
    const records = await extractPrograms(page, { source, contentHash: "h", university: "Monash" }, { gen: gen.asGemini(), model: "flash-lite", fallbackModel: "flash" });
    expect(gen.requests.map((r) => r.model)).toEqual(["flash-lite", "flash"]);
    expect(records).toHaveLength(1);
    expect(records[0]!.model).toBe("flash");
    expect(await extractPrograms(page, { source, contentHash: "h", university: "Monash" }, { gen: new FakeGemini([ok([llmProgram], false)]).asGemini(), model: "m" })).toEqual([]);
    expect(await extractPrograms(page, { source, contentHash: "h", university: "Monash" }, { gen: new FakeGemini([bad]).asGemini(), model: "m" })).toEqual([]);
  });

  test("renderProgramText / renderProgramPage are deterministic and citable", () => {
    const record = { ...llmProgram, _id: "abc", university: "Monash University", universitySlug: "monash-university", country: "australia", sourceUrl: "https://www.monash.edu/study/mit", source: "partner:monash-university", contentHash: "h", model: "m", extractedAt: new Date(0), updatedAt: new Date(0) } as unknown as ProgramRecord;
    const text = renderProgramText(record);
    expect(text).toContain("Monash University — Master of Information Technology (master)");
    expect(text).toContain("Tuition (international, per year, 2026): AUD 47,900");
    expect(text).toContain("English: IELTS 6.5 (min band 6)");
    expect(text).toContain("CRICOS 012345A");
    expect(text).toContain("Source: https://www.monash.edu/study/mit");
    const page = renderProgramPage(record);
    expect(page.url).toBe("https://www.monash.edu/study/mit#program:master-of-information-technology");
    expect(programUrl(record)).toBe(page.url);
    expect(page.canonical).toBe(record.sourceUrl);
    const like = toProgramRecordLike(record);
    expect(like).toMatchObject({ id: "abc", url: record.sourceUrl, level: "master" });
    expect(like.summary).toContain("AUD 47,900");
    // The record's own write date travels with it, so the prompt can date its fees.
    expect(like.updatedAt).toBe(record.updatedAt.toISOString());
  });

  test("buildProgramFilter composes field filters", () => {
    expect(buildProgramFilter({})).toEqual({});
    const f = buildProgramFilter({ q: "data science", countries: ["australia"], university: "monash", levels: ["master"], disciplines: ["IT"], intake: "feb", maxTuition: 50000, currency: "aud", maxIeltsOverall: 6.5, hasScholarships: true }) as { $and: Record<string, unknown>[] };
    expect(f.$and[0]).toEqual({ $text: { $search: "data science" } });
    expect(f.$and).toContainEqual({ country: { $in: ["australia"] } });
    expect(f.$and).toContainEqual({ university: { $regex: "monash", $options: "i" } });
    expect(f.$and).toContainEqual({ level: { $in: ["master"] } });
    expect(JSON.stringify(f.$and.find((c) => c.tuition))).toContain('"currency":"AUD"');
    expect(f.$and).toContainEqual({ "englishRequirements.ielts.overall": { $lte: 6.5, $ne: null } });
    expect(f.$and).toContainEqual({ "scholarships.0": { $exists: true } });
    const currencyOnly = buildProgramFilter({ currency: "gbp" }) as { $and: Record<string, unknown>[] };
    expect(currencyOnly.$and).toContainEqual({ "tuition.currency": "GBP" });
  });

  test("the research search contract filters on every given country, else the single one", async () => {
    const filters: unknown[] = [];
    const cursor = { sort: () => cursor, skip: () => cursor, limit: () => cursor, toArray: async () => [] };
    const col = { find: (f: unknown) => (filters.push(f), cursor), countDocuments: async () => 0 };
    const search = new MongoProgramSearch(col as never);
    await search.search({ country: "canada", countries: ["canada", "australia"] });
    await search.search({ country: "canada" });
    expect(filters[0]).toEqual({ $and: [{ country: { $in: ["canada", "australia"] } }] });
    expect(filters[1]).toEqual({ $and: [{ country: { $in: ["canada"] } }] });
  });

  test("ProgramSearchRequestSchema validates the API body", () => {
    expect(ProgramSearchRequestSchema.parse({ q: "nursing", countries: ["canada"], limit: 10 }).limit).toBe(10);
    expect(() => ProgramSearchRequestSchema.parse({ limit: 500 })).toThrow();
    expect(() => ProgramSearchRequestSchema.parse({ universitySlugs: ["Bad Slug"] })).toThrow();
  });
});
