import { describe, expect, test } from "bun:test";
import {
  checkCatalog,
  COLUMNS,
  csvCell,
  indexRows,
  loadCatalog,
  parseCatalogMarkdown,
  parseEntities,
  parseRenameMap,
  parseRetiredIds,
  parseSeed,
  renameRefs,
  replaceGeneratedBlock,
  resolveRef,
  scanDocRefs,
  scanIdRefs,
  splitRow,
  suggestFor,
  toCsv,
  type CatalogRow,
  type SeedRow,
} from "../scripts/catalog";

const HEADER = `| ${COLUMNS.join(" | ")} |\n|${"---|".repeat(COLUMNS.length)}`;
const ENTITIES = new Set(["Course", "Institution", "Destination", "VisaRule", "Agency"]);

function row(over: Partial<Record<(typeof COLUMNS)[number], string>> = {}): string {
  const base: Record<string, string> = {
    id: "A.001",
    attribute: "course_title_official",
    full_name: "Official course title",
    entity: "Course",
    variant_axes: "-",
    data_type: "string",
    possible_values: "e.g. Master of IT",
    definition: "The award title as printed on the course page.",
    data_source: "University Website",
    collection_method: "llm_extraction",
    refresh_cadence: "on_source_change",
    owner_role: "ingest_pipeline",
    tier: "1",
    quotable: "yes",
    today_field_path: "ProgramRecord.programName",
    countries: "all",
    stages: "S3;S4",
    seed: "-",
    notes: "-",
    ...over,
  };
  return `| ${COLUMNS.map((c) => base[c]).join(" | ")} |`;
}

function doc(rows: string[], title = "# A. Course", section = "## Identity"): string {
  return `${title}\n\nIntro paragraph.\n\n${section}\n\n${HEADER}\n${rows.join("\n")}\n`;
}

function parse(md: string, file = "03-catalog/course.md") {
  return parseCatalogMarkdown(md, file);
}

function check(rows: CatalogRow[], extra: Partial<Parameters<typeof checkCatalog>[0]> = {}) {
  return checkCatalog({ rows, seed: [], entities: ENTITIES, retired: [], idRefTexts: [], docTexts: [], ...extra });
}

describe("parser", () => {
  test("accepts the 19-column header and attaches section + line", () => {
    const { rows, issues } = parse(doc([row()]));
    expect(issues).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.section).toBe("Identity");
    expect(rows[0]!.line).toBe(9);
    expect(rows[0]!.letter).toBe("A");
    expect(rows[0]!.attribute).toBe("course_title_official");
  });
  test("rejects a wrong column count with the line number", () => {
    const bad = row().replace(" | S3;S4 | ", " | ");
    const { rows, issues } = parse(doc([bad]));
    expect(rows).toHaveLength(0);
    expect(issues[0]!.rule).toBe("columns");
    expect(issues[0]!.line).toBe(9);
  });
  test("rejects a header that differs from the contract", () => {
    const { issues } = parse(doc([row()]).replace("| notes |", "| remarks |"));
    expect(issues.some((i) => i.rule === "columns")).toBe(true);
  });
  test("escaped pipes round-trip inside a cell", () => {
    const { rows } = parse(doc([row({ possible_values: "a \\| b" })]));
    expect(rows[0]!.possible_values).toBe("a | b");
    expect(splitRow("| x | y \\| z |")).toEqual(["x", "y | z"]);
  });
  test("parses entities, seed sheet and retired ids", () => {
    const entities = parseEntities("# 01\n\n## Entities\n\n| Entity | Key | What |\n|---|---|---|\n| **Course** | id | x |\n| **Destination×Level** | c+l | y |\n\n## Relationships\n\n| Entity | Key |\n| **Nope** | z |\n");
    expect([...entities]).toEqual(["Course", "Destination×Level"]);
    const seed = parseSeed("country\tattribute_full_name\tattribute\tpossible_values\tdata_type\tdata_scope\tdata_source\tdefinition\tdata_notes\nAll\tX\tgic_amount\tv\tmoney\tDestination\tGov\tThe GIC amount.\tn\n");
    expect(seed).toEqual([{ attribute: "gic_amount", definition: "The GIC amount.", country: "All" }]);
    const retired = parseRetiredIds("# R\n\n## Retired ids\n\n| id | former attribute | superseded_by | reason |\n|---|---|---|---|\n| T.019 | `application_deadline_type` | `K.009` | dup |\n");
    expect(retired).toEqual([{ id: "T.019", attribute: "application_deadline_type", supersededBy: "K.009", reason: "dup" }]);
  });
});

describe("checks", () => {
  test("duplicate ids and attributes across files are errors", () => {
    const a = parse(doc([row()])).rows;
    const b = parse(doc([row({ id: "B.001", entity: "Institution" })], "# B. Institution"), "03-catalog/institution.md").rows;
    const c = parse(doc([row({ attribute: "other_name" })])).rows; // same id A.001 again
    const issues = check([...a, ...b, ...c]);
    expect(issues.filter((i) => i.rule === "attribute_unique")).toHaveLength(1);
    expect(issues.filter((i) => i.rule === "id_unique")).toHaveLength(1);
  });
  test("one negative case per vocabulary column", () => {
    const cases: Array<[Partial<Record<(typeof COLUMNS)[number], string>>, string]> = [
      [{ entity: "Banana" }, "vocab_entity"],
      [{ variant_axes: "colour" }, "vocab_variant_axes"],
      [{ variant_axes: "level;level" }, "vocab_variant_axes"],
      [{ data_type: "array[foo]" }, "vocab_data_type"],
      [{ data_source: "Government / Immigration (See X)" }, "vocab_data_source"],
      [{ collection_method: "scrape" }, "vocab_collection_method"],
      [{ refresh_cadence: "sometimes" }, "vocab_refresh_cadence"],
      [{ owner_role: "ceo" }, "vocab_owner_role"],
      [{ tier: "4" }, "vocab_tier"],
      [{ quotable: "no" }, "vocab_quotable"],
      [{ countries: "AU;XX" }, "vocab_countries"],
      [{ countries: "origin:ZZ" }, "vocab_countries"],
      [{ stages: "S21" }, "vocab_stages"],
      [{ seed: "no" }, "vocab_seed"],
      [{ definition: "" }, "required_nonempty"],
      [{ id: "A.1" }, "id_format"],
    ];
    for (const [over, rule] of cases) {
      const issues = check(parse(doc([row(over)])).rows);
      expect(issues.map((i) => i.rule)).toContain(rule);
    }
    expect(check(parse(doc([row({ data_type: "array[string]", countries: "AU;NL;origin:NP", variant_axes: "level;nationality" })])).rows)).toHaveLength(0);
  });
  test("id letter must match the file; NL is an accepted destination", () => {
    const rows = parse(doc([row({ id: "E.001", countries: "NL" })])).rows; // in course.md
    const issues = check(rows);
    expect(issues.map((i) => i.rule)).toContain("id_letter_matches_file");
    expect(issues.map((i) => i.rule)).not.toContain("vocab_countries");
  });
  test("seed coverage: missing, duplicated, stray and changed definitions", () => {
    const seed: SeedRow[] = [
      { attribute: "gic_amount", definition: "The GIC amount.", country: "Canada" },
      { attribute: "never_added", definition: "x", country: "All" },
    ];
    const rows = parse(
      doc([
        row({ id: "E.001", attribute: "gic_amount", seed: "yes", definition: "The GIC amount." }),
        row({ id: "E.002", attribute: "stray", seed: "yes" }),
        row({ id: "E.003", attribute: "changed", seed: "-" }),
      ]),
      "03-catalog/destination-visa.md",
    ).rows;
    const issues = check(rows, { seed });
    const rules = issues.map((i) => i.rule);
    expect(rules).toContain("seed_missing");
    expect(rules).toContain("seed_not_in_sheet");
    expect(rules).not.toContain("seed_duplicate");
    const dup = check([...rows, ...parse(doc([row({ id: "E.004", attribute: "gic_amount", seed: "yes", definition: "different" })]), "03-catalog/destination-visa.md").rows], { seed });
    expect(dup.map((i) => i.rule)).toContain("seed_duplicate");
    expect(dup.map((i) => i.rule)).toContain("seed_definition_changed");
  });
  test("id references: dangling and retired", () => {
    const rows = parse(doc([row()])).rows;
    const issues = check(rows, {
      retired: [{ id: "A.099", attribute: "old", supersededBy: "A.001", reason: "dup" }],
      idRefTexts: [{ file: "07.md", text: "see A.001 and A.150, formerly A.099" }],
    });
    expect(issues.find((i) => i.rule === "id_ref_dangling")?.id).toBe("A.150");
    expect(issues.find((i) => i.rule === "id_ref_retired")?.message).toContain("A.001");
    expect(scanIdRefs("E.150 and E.009", "x").map((r) => r.id)).toEqual(["E.150", "E.009"]);
    const reused = check(parse(doc([row({ id: "A.099" })])).rows, { retired: [{ id: "A.099", attribute: "old", supersededBy: "A.001", reason: "dup" }] });
    expect(reused.map((i) => i.rule)).toContain("id_retired_reused");
  });
  test("doc references: normalisation, wildcards, dangling and suggestions", () => {
    const rows = parse(doc([row(), row({ id: "A.002", attribute: "course_title_aliases", stages: "S3" }), row({ id: "A.003", attribute: "english_overall_min", stages: "S6" })])).rows;
    const refs = scanDocRefs("uses `A.course_title_official`, `A.course_title_aliases[]`, `A.course_title_*`, `A.*`, `E.english_overall_min`, `A.course_title_official.sub.field` and `A.nonsense`", "07.md");
    expect(refs.map((r) => r.name)).toEqual(["course_title_official", "course_title_aliases", "course_title", "", "english_overall_min", "course_title_official", "nonsense"]);
    expect(refs[2]!.prefix).toBe(true);
    expect(refs[3]!.domainWildcard).toBe(true);
    const { byAttr, byLetter } = indexRows(rows);
    expect(refs.map((r) => resolveRef(r, byAttr, byLetter))).toEqual([true, true, true, true, false, true, false]);
    const cross = suggestFor(refs[4]!, rows);
    expect(cross[0]).toMatchObject({ target: "A.english_overall_min", kind: "cross_letter_exact" });
    const issues = check(rows, { docTexts: [{ file: "07.md", text: "`A.course_title_official` `A.nonsense`" }] });
    expect(issues.filter((i) => i.rule === "dangling_ref")).toHaveLength(1);
  });
});

describe("csv", () => {
  test("quotes commas, quotes and newlines; sorts by letter then number", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    const rows = [
      ...parse(doc([row({ id: "B.001", entity: "Institution" })], "# B. Institution"), "03-catalog/institution.md").rows,
      ...parse(doc([row({ id: "A.010", attribute: "b" }), row({ id: "A.002", attribute: "a, c" })])).rows,
    ];
    const csv = toCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(COLUMNS.join(","));
    expect(lines[1]!.startsWith("A.002,")).toBe(true);
    expect(lines[1]).toContain('"a, c"');
    expect(lines[2]!.startsWith("A.010,")).toBe(true);
    expect(lines[3]!.startsWith("B.001,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("rename-refs and generated blocks", () => {
  test("renames backticked tokens, keeps suffixes, strips TBC markers when resolved", () => {
    const map = parseRenameMap("# comment\nH.coverage_pct\tH.scholarship_coverage_pct\nE.old\tE.new\n");
    const { text, count } = renameRefs("`H.coverage_pct` (catalog name TBC), `H.coverage_pct[]`, `E.old.sub` (TBC), `E.other`", map, (t) => t === "H.scholarship_coverage_pct");
    expect(count).toBe(3);
    expect(text).toBe("`H.scholarship_coverage_pct`, `H.scholarship_coverage_pct[]`, `E.new.sub` (TBC), `E.other`");
  });
  test("replaceGeneratedBlock swaps only the marked region", () => {
    const doc = "intro\n<!-- generated:x:start -->\nold\n<!-- generated:x:end -->\noutro";
    expect(replaceGeneratedBlock(doc, "x", "new")).toBe("intro\n<!-- generated:x:start -->\nnew\n<!-- generated:x:end -->\noutro");
    expect(() => replaceGeneratedBlock(doc, "missing", "n")).toThrow();
  });
});

describe("real catalog (docs/data-model)", () => {
  test("all 24 domain files parse with 19 columns and unique ids", async () => {
    const cat = await loadCatalog();
    expect(cat.files.length).toBe(24);
    expect(cat.parseIssues).toHaveLength(0);
    expect(cat.rows.length).toBeGreaterThan(1700);
    expect(new Set(cat.rows.map((r) => r.id)).size).toBe(cat.rows.length);
    expect(new Set(cat.rows.map((r) => r.attribute)).size).toBe(cat.rows.length);
    expect(cat.seed).toHaveLength(82);
    expect(cat.entities.size).toBeGreaterThanOrEqual(27);
  });

  test("strict check with 07/08 references reports no issues (CI gate)", async () => {
    const cat = await loadCatalog();
    const issues = checkCatalog({ ...cat, docTexts: cat.docTexts });
    const summary = issues.map((i) => `${i.level}:${i.rule} ${i.file}:${i.line ?? ""} ${i.id ?? ""} ${i.message}`);
    expect(summary).toEqual([]);
  });

  test("every seed attribute appears exactly once with seed=yes", async () => {
    const cat = await loadCatalog();
    for (const s of cat.seed) {
      const hits = cat.rows.filter((r) => r.attribute === s.attribute);
      expect(hits.map((r) => r.id)).toHaveLength(1);
      expect(hits[0]!.seed).toBe("yes");
    }
  });

  test("catalog.csv is in sync with 03-catalog/*.md", async () => {
    const cat = await loadCatalog();
    const csv = await Bun.file(new URL("../docs/data-model/catalog.csv", import.meta.url)).text();
    expect(csv).toBe(toCsv(cat.rows));
    expect(csv.split("\r\n").length - 2).toBe(cat.rows.length); // header + trailing CRLF
  });
});
