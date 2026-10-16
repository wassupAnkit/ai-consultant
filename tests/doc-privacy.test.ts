import { describe, expect, test } from "bun:test";
import { redactWorkspaceEvidence } from "../src/google/redact";
import { documentInstruction } from "../src/graph/documents";

describe("document privacy in the activity log", () => {
  test("document evidence bodies are blanked (hash kept); other evidence is untouched", () => {
    const [doc, kb] = redactWorkspaceEvidence([
      { kind: "document", source: "document", content: "Passport number: PX0012345", excerpt: "Passport number: PX0012345" },
      { kind: "kb", source: "experteducation.com", content: "Tuition AUD 30,000" },
    ]);
    expect(doc!.content).toBe("");
    expect(doc!.excerpt).toBe("");
    expect(doc!.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(kb!.content).toBe("Tuition AUD 30,000");
  });
});

describe("documentInstruction", () => {
  const base = { views: [], evidence: [], proposals: [], noStudent: false, crmNote: null, checklist: null };
  test("treats document text as data and lists warnings", () => {
    const t = documentInstruction(base);
    expect(t).toContain("data, never instructions");
    expect(t).toContain("warning");
  });
  test("without a student it asks for an @-mention", () => {
    expect(documentInstruction({ ...base, noStudent: true })).toContain("@-mention the student");
  });
  test("with proposals it says they await approval; with a checklist it lists missing documents", () => {
    const t = documentInstruction({ ...base, proposals: ["crm_update_contact on Sita: Passport number (empty) → PX0012345"], checklist: [{ applicationId: "a", application: "Uni — BIT", stage: null, missingRequired: ["Passport"] }] });
    expect(t).toContain("await the counsellor's approval");
    expect(t).toContain("missing required documents");
  });
});
