import { describe, expect, test } from "bun:test";
import type { Embeddings } from "@langchain/core/embeddings";
import type { KbChunkDoc, KbPageDoc } from "../src/db/mongo";
import {
  chunkGuide,
  GUIDE_CHUNK_MAX,
  guideChunkDocs,
  guideInfo,
  ingestGuides,
  loadGuideFiles,
  planGuideIngest,
  type GuideFile,
} from "../src/ingest/guides";
import { sourceKindOf } from "../src/retrieval/store";

const DATA = `${import.meta.dir}/../data`;

const row = (i: number) => `| Fact ${i} with a reasonably long description of the rule | AUD${1000 + i}.00 for the primary applicant, more words here | 2026-07-01 | Subclass 500 primary applicants | [Home Affairs](https://immi.homeaffairs.gov.au/x${i}) | 2026-10-09 |`;
const HEADER = "| Fact | Value | Effective from | Applies to | Official source | Checked |\n|---|---|---|---|---|---|";

const FACTS: GuideFile = {
  kind: "facts",
  slug: "australia",
  markdown: [
    "# Australia: Facts Register (student visas)",
    "",
    "*Dated, cited facts. Checked 9 October 2026. Rows marked (secondary — verify) need checking.*",
    "",
    "## Closed or replaced programmes and rules",
    "",
    HEADER,
    "| GTE replaced by GS | GS from 23 March 2024 | 2024-03-23 | All 500 applicants | [Home Affairs](https://immi.homeaffairs.gov.au/gs) | 2026-10-09 |",
    "",
    "Notes",
    "- Old rules apply to applications lodged before 2 October 2026.",
    "",
    "## Visa application charges",
    "",
    HEADER,
    ...Array.from({ length: 14 }, (_, i) => row(i)),
    "",
    "Notes",
    "- The charge is not refunded on refusal.",
    "",
    "## Next review dates",
    "",
    HEADER,
    "| Visa application charges | Review every 1 July | annual | All AU charges | [Home Affairs](https://immi.homeaffairs.gov.au/p) | 2026-10-09 |",
  ].join("\n"),
};

const MARKET: GuideFile = {
  kind: "market",
  slug: "nepal",
  markdown: [
    "# Nepal — Source-Market Counselling Guide",
    "",
    "*Reference for counsellors. Researched 8 October 2026.*",
    "",
    "## 4. Money",
    "",
    "- **NRB.** Nepal Rastra Bank sets the foreign-exchange rules for students paying tuition abroad, and banks follow its circulars.",
    "",
    "## 5. Origin-side steps & documents",
    "",
    "### NOC",
    "",
    "The Ministry of Education issues the No Objection Certificate online before a student can buy foreign exchange.",
    "",
    "## Sources",
    "",
    "- [a](https://example.com/a)",
  ].join("\n"),
};

describe("guide metadata per kind", () => {
  test("market guide: global, origin market in metadata, research date", () => {
    expect(guideInfo(MARKET)).toEqual({
      kind: "market",
      slug: "nepal",
      source: "guide:market/nepal",
      pageUrl: "guide://market/nepal",
      title: "Nepal — Source-Market Counselling Guide",
      docType: "market_guide",
      country: "global",
      market: "nepal",
      updated: "2026-10-08",
    });
  });

  test("facts register: the destination as country; compliance: destination or global; job map: global", () => {
    const facts = guideInfo(FACTS);
    expect([facts.source, facts.docType, facts.country, facts.market, facts.updated]).toEqual(["guide:facts/australia", "facts_register", "australia", null, "2026-10-09"]);
    const comp = guideInfo({ kind: "compliance", slug: "united_kingdom", markdown: "# UK — Compliance\n\n*Researched 9 October 2026.*" });
    expect([comp.docType, comp.country]).toEqual(["compliance_guide", "united_kingdom"]);
    expect(guideInfo({ kind: "compliance", slug: "source-markets", markdown: "# Source markets" }).country).toBe("global");
    expect(guideInfo({ kind: "facts", slug: "scholarships", markdown: "# Scholarships" }).country).toBe("global");
    const job = guideInfo({ kind: "counsellor", slug: "job-map", markdown: "# Counsellor job map\n\nResearched 9 October 2026." });
    expect([job.source, job.docType, job.country, job.updated]).toEqual(["guide:counsellor/job-map", "counsellor_guide", "global", "2026-10-09"]);
    expect(guideInfo({ kind: "counsellor", slug: "x", markdown: "# X\n\nno date" }).updated).toBeNull();
  });

  test("guide sources are staff-document provenance (sourceKind upload), so retrieval quotas treat them like uploads", () => {
    expect(sourceKindOf("guide:facts/australia", "facts_register")).toBe("upload");
    expect(sourceKindOf("facts-register:australia", "facts_register")).toBe("upload");
  });
});

describe("chunking a guide by section", () => {
  test("one chunk per section with doc title and heading path; Sources skipped; anchors are GitHub-style", () => {
    const chunks = chunkGuide(MARKET);
    expect(chunks.map((c) => [c.section, c.url])).toEqual([
      ["About this document", "guide://market/nepal#about"],
      ["4. Money", "guide://market/nepal#4-money"],
      ["5. Origin-side steps & documents › NOC", "guide://market/nepal#noc"],
    ]);
    expect(chunks[1]!.content).toStartWith("Nepal — Source-Market Counselling Guide — 4. Money\n\n- **NRB.**");
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  test("a table that fits stays whole; a long one splits by row groups with the header repeated", () => {
    const chunks = chunkGuide(FACTS);
    const closed = chunks.filter((c) => c.section === "Closed or replaced programmes and rules");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.content).toContain(`${HEADER}\n| GTE replaced by GS`);
    expect(closed[0]!.content).toContain("Notes\n- Old rules apply");

    const fees = chunks.filter((c) => c.section === "Visa application charges");
    expect(fees.length).toBeGreaterThan(1);
    for (const c of fees) {
      expect(c.content.length).toBeLessThanOrEqual(GUIDE_CHUNK_MAX);
      expect(c.content).toStartWith("Australia: Facts Register (student visas) — Visa application charges\n\n");
      if (c.content.includes("| Fact ")) expect(c.content).toContain(HEADER);
      expect(c.url).toBe("guide://facts/australia#visa-application-charges");
    }
    // Every row lands in exactly one chunk, in order.
    const rows = fees.flatMap((c) => c.content.split("\n").filter((l) => l.startsWith("| Fact ") && !l.startsWith("| Fact |")));
    expect(rows).toEqual(Array.from({ length: 14 }, (_, i) => row(i)));
    expect(new Set(fees.map((c) => c.key)).size).toBe(fees.length);
  });

  test("an over-long paragraph is cut at sentence boundaries, never above the limit", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} explains one more detail of the Vietnamese notarisation process.`).join(" ");
    const chunks = chunkGuide({ kind: "market", slug: "vietnam", markdown: `# Vietnam guide\n\n## 3. Academic background\n\n${long}` });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(GUIDE_CHUNK_MAX);
    expect(chunks.map((c) => c.content.split("\n\n").slice(1).join("\n\n")).join(" ")).toBe(long);
  });

  test("the shipped guides all chunk within the limit, with headers", async () => {
    const files = await loadGuideFiles(DATA);
    const kinds = new Set(files.map((f) => f.kind));
    expect([...kinds].sort()).toEqual(["compliance", "counsellor", "facts", "market"]);
    expect(files.some((f) => f.slug === "README")).toBe(false);
    expect(files.find((f) => f.kind === "counsellor")?.slug).toBe("job-map");
    for (const f of files) {
      const info = guideInfo(f);
      expect(info.updated).toMatch(/^2026-\d\d-\d\d$/);
      const chunks = chunkGuide(f);
      expect(chunks.length).toBeGreaterThan(3);
      for (const c of chunks) {
        expect(c.content.length).toBeLessThanOrEqual(GUIDE_CHUNK_MAX);
        expect(c.content).toStartWith(`${info.title} — `);
        expect(c.content).not.toContain("<!--");
      }
    }
  });
});

describe("chunk documents and the idempotent plan", () => {
  test("chunk docs carry source, sourceKind, docType, country, url anchor, market and updated", async () => {
    const docs = await guideChunkDocs(MARKET);
    expect(docs[1]).toMatchObject({
      source: "guide:market/nepal",
      sourceKind: "upload",
      url: "guide://market/nepal#4-money",
      title: "Nepal — Source-Market Counselling Guide",
      section: "4. Money",
      docType: "market_guide",
      country: "global",
      chunkIndex: 1,
      metadata: { kind: "market", slug: "nepal", market: "nepal", updated: "2026-10-08", anchor: "4-money" },
    });
    expect(docs[1]!.updatedAt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(docs[1]!._id).toMatch(/^[0-9a-f]{64}$/);
    expect(docs[1]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(docs.map((d) => d._id)).size).toBe(docs.length);
  });

  test("first run embeds everything; an unchanged rerun embeds nothing; an edit re-embeds one section and drops a removed one", async () => {
    const desired = [{ file: FACTS, docs: await guideChunkDocs(FACTS) }];
    const first = planGuideIngest(desired, []);
    expect(first.guides[0]!.embed).toHaveLength(desired[0]!.docs.length);
    expect(first.orphanSources).toEqual([]);

    const stored = desired[0]!.docs.map((d) => ({ ...d }));
    const again = planGuideIngest(desired, stored);
    expect([again.guides[0]!.embed.length, again.guides[0]!.retag.length, again.guides[0]!.remove.length, again.guides[0]!.unchanged]).toEqual([0, 0, 0, stored.length]);

    const edited: GuideFile = { ...FACTS, markdown: FACTS.markdown.replace("GS from 23 March 2024", "GS from 23 March 2024 (lodgement date)").replace(/\n## Next review dates[\s\S]*$/, "") };
    const plan = planGuideIngest([{ file: edited, docs: await guideChunkDocs(edited) }], stored);
    expect(plan.guides[0]!.embed.map((d) => d.section)).toEqual(["Closed or replaced programmes and rules"]);
    expect(plan.guides[0]!.remove).toHaveLength(1);

    const forced = planGuideIngest(desired, stored, { force: true });
    expect(forced.guides[0]!.embed).toHaveLength(stored.length);
  });

  test("a changed date only retags (no re-embedding); a guide no longer shipped is an orphan source", async () => {
    const stored = (await guideChunkDocs(FACTS)).map((d) => ({ ...d }));
    const redated: GuideFile = { ...FACTS, markdown: FACTS.markdown.replace("Checked 9 October 2026", "Checked 20 October 2026") };
    const plan = planGuideIngest([{ file: redated, docs: await guideChunkDocs(redated) }], [...stored, { ...stored[0]!, _id: "x", source: "guide:facts/canada" }]);
    // The intro chunk's text changed (it quotes the date); every other section only retags.
    expect(plan.guides[0]!.embed.map((d) => d.section)).toEqual(["About this document"]);
    expect(plan.guides[0]!.retag).toHaveLength(stored.length - 1);
    expect(plan.orphanSources).toEqual(["guide:facts/canada"]);
  });
});

/** Just enough of a Mongo collection for ingestGuides: find/bulkWrite/deleteMany/replaceOne/updateOne by _id or source. */
function fakeCollection<T extends { _id: string; source: string }>() {
  const rows = new Map<string, T>();
  const matches = (doc: T, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, cond]) => {
      const v = (doc as Record<string, unknown>)[k];
      if (cond && typeof cond === "object" && "$in" in cond) return (cond.$in as unknown[]).includes(v);
      if (cond && typeof cond === "object" && "$regex" in cond) return new RegExp(cond.$regex as string).test(String(v));
      return v === cond;
    });
  return {
    rows,
    find(filter: Record<string, unknown>) {
      return { toArray: async () => [...rows.values()].filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
    },
    async bulkWrite(ops: { replaceOne?: { filter: { _id: string }; replacement: T }; updateOne?: { filter: { _id: string }; update: { $set: Partial<T> } } }[]) {
      for (const op of ops) {
        if (op.replaceOne) rows.set(op.replaceOne.filter._id, { ...op.replaceOne.replacement, _id: op.replaceOne.filter._id });
        if (op.updateOne) rows.set(op.updateOne.filter._id, { ...rows.get(op.updateOne.filter._id)!, ...op.updateOne.update.$set });
      }
      return {};
    },
    async deleteMany(filter: Record<string, unknown>) {
      let deletedCount = 0;
      for (const [id, d] of rows) if (matches(d, filter)) (rows.delete(id), deletedCount++);
      return { deletedCount };
    },
    async replaceOne(filter: { _id: string }, doc: Omit<T, "_id">) {
      rows.set(filter._id, { ...(doc as T), _id: filter._id });
      return {};
    },
    async updateOne(filter: { _id: string }, update: { $set: Partial<T> }) {
      const d = rows.get(filter._id);
      if (d) rows.set(filter._id, { ...d, ...update.$set });
      return {};
    },
  };
}

class CountingEmbeddings {
  calls = 0;
  texts = 0;
  async embedDocuments(texts: string[]) {
    this.calls++;
    this.texts += texts.length;
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
  async embedQuery() {
    return [0.1, 0.2, 0.3];
  }
}

describe("ingestGuides against a fake store", () => {
  test("writes chunks and a page per guide, skips unchanged on rerun, deletes vanished guides, and dry-run writes nothing", async () => {
    const kbChunks = fakeCollection<KbChunkDoc>();
    const kbPages = fakeCollection<KbPageDoc & { source: string }>();
    const embeddings = new CountingEmbeddings();
    const deps = { collections: { kbChunks, kbPages } as never, embeddings: embeddings as unknown as Embeddings, runId: "run-1" };

    const dry = await ingestGuides([FACTS, MARKET], { ...deps, dryRun: true });
    expect(dry.chunksWritten).toBeGreaterThan(0);
    expect([kbChunks.rows.size, kbPages.rows.size, embeddings.texts]).toEqual([0, 0, 0]);

    const first = await ingestGuides([FACTS, MARKET], deps);
    expect(first.guides).toBe(2);
    expect(kbChunks.rows.size).toBe(first.chunksWritten);
    expect(embeddings.texts).toBe(first.chunksWritten);
    expect([...kbChunks.rows.values()].every((c) => c.embedding.length === 3 && c.sourceKind === "upload")).toBe(true);
    expect(kbPages.rows.get("guide://facts/australia")).toMatchObject({ source: "guide:facts/australia", sourceKind: "upload", country: "australia", runId: "run-1" });

    const before = embeddings.texts;
    const second = await ingestGuides([FACTS, MARKET], { ...deps, runId: "run-2" });
    expect([second.chunksWritten, second.chunksUnchanged, embeddings.texts - before]).toEqual([0, first.chunksWritten, 0]);
    expect(kbPages.rows.get("guide://facts/australia")?.runId).toBe("run-2");

    const third = await ingestGuides([FACTS], deps);
    expect(third.orphansDeleted).toEqual({ pages: 1, chunks: chunkGuide(MARKET).length });
    expect([...kbChunks.rows.values()].every((c) => c.source === "guide:facts/australia")).toBe(true);
    expect(kbPages.rows.has("guide://market/nepal")).toBe(false);
  });

  test("never sweeps when no guide files were loaded (a wrong data path must not wipe the guides)", async () => {
    const kbChunks = fakeCollection<KbChunkDoc>();
    const kbPages = fakeCollection<KbPageDoc & { source: string }>();
    const deps = { collections: { kbChunks, kbPages } as never, embeddings: new CountingEmbeddings() as unknown as Embeddings };
    await ingestGuides([FACTS], deps);
    const size = kbChunks.rows.size;
    await expect(ingestGuides([], deps)).rejects.toThrow(/no guide files/);
    expect(kbChunks.rows.size).toBe(size);
  });
});

describe("runtime copies", () => {
  test("every docs/{markets,compliance,facts,counsellor} guide ships an identical data/ copy (copy it after editing)", async () => {
    const docs = await loadGuideFiles(`${import.meta.dir}/../docs`);
    const data = await loadGuideFiles(DATA);
    expect(data.map((f) => `${f.kind}/${f.slug}`)).toEqual(docs.map((f) => `${f.kind}/${f.slug}`));
    for (const [i, f] of docs.entries()) expect(`${f.kind}/${f.slug}:\n${data[i]!.markdown}`).toBe(`${f.kind}/${f.slug}:\n${f.markdown}`);
  });
});
