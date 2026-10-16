import { describe, expect, test } from "bun:test";
import { crmWarnings, expiryWarnings, genderFromDocument, maskAadhaar, namesMatch, normaliseDate, titleCase } from "../src/documents/student/validate";

const TODAY = new Date("2026-10-12T08:00:00Z");

describe("normaliseDate", () => {
  test("ISO, day-first numeric and month-name forms become YYYY-MM-DD", () => {
    expect(normaliseDate("1999-01-12", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("12/01/1999", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("12.01.1999", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("12 JAN 1999", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("12 Jan/Jan 1999", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("January 12, 1999", { today: TODAY }).iso).toBe("1999-01-12");
    expect(normaliseDate("1999/01/12", { today: TODAY }).iso).toBe("1999-01-12");
  });

  test("impossible or empty dates are null", () => {
    expect(normaliseDate("31/02/1999", { today: TODAY }).iso).toBeNull();
    expect(normaliseDate("", { today: TODAY }).iso).toBeNull();
    expect(normaliseDate(null, { today: TODAY }).iso).toBeNull();
    expect(normaliseDate("soon", { today: TODAY }).iso).toBeNull();
  });

  test("a Bikram Sambat date (Nepal, year far ahead of today) is kept as text, never as a Gregorian date", () => {
    const d = normaliseDate("2055-05-12", { today: TODAY, calendar: "bikram_sambat" });
    expect(d.iso).toBeNull();
    expect(d.calendar).toBe("bikram_sambat");
    expect(d.text).toBe("2055-05-12 B.S.");
    // Even when the model forgot to say so, a birth year decades ahead of today cannot be Gregorian.
    expect(normaliseDate("2058-02-01", { today: TODAY }).calendar).toBe("bikram_sambat");
    // Expiry dates may lie in the future: allowed up to 30 years ahead.
    expect(normaliseDate("2034-04-15", { today: TODAY, future: true }).iso).toBe("2034-04-15");
  });
});

describe("maskAadhaar", () => {
  test("keeps only the last four digits, whatever the spacing", () => {
    expect(maskAadhaar("2345 6789 0123")).toBe("XXXX-XXXX-0123");
    expect(maskAadhaar("234567890123")).toBe("XXXX-XXXX-0123");
    expect(maskAadhaar("XXXX XXXX 0123")).toBe("XXXX-XXXX-0123");
    expect(maskAadhaar("0123")).toBe("XXXX-XXXX-0123");
    expect(maskAadhaar("no number")).toBeNull();
  });
});

describe("expiryWarnings", () => {
  test("expired, within 12 months, or nothing", () => {
    expect(expiryWarnings("2026-10-11", TODAY).map((w) => w.code)).toEqual(["expired"]);
    expect(expiryWarnings("2027-10-01", TODAY).map((w) => w.code)).toEqual(["expires_within_12_months"]);
    expect(expiryWarnings("2027-10-13", TODAY)).toEqual([]);
    expect(expiryWarnings(null, TODAY)).toEqual([]);
  });
});

describe("names and the CRM", () => {
  test("titleCase keeps hyphens and apostrophes", () => {
    expect(titleCase("SITA KUMARI SHRESTHA-RAI")).toBe("Sita Kumari Shrestha-Rai");
    expect(titleCase("o'brien")).toBe("O'Brien");
  });

  test("names match when every CRM name part is on the document, in any order and case", () => {
    expect(namesMatch("Sita Kumari Shrestha", "sita shrestha")).toBe(true);
    expect(namesMatch("SHRESTHA SITA KUMARI", "Sita Shrestha")).toBe(true);
    expect(namesMatch("Sita Shrestha", "Gita Shrestha")).toBe(false);
    expect(namesMatch("Anna-Maria Eriksson", "Anna Maria Eriksson")).toBe(true);
  });

  test("crmWarnings flags a different name or date of birth, and stays quiet on gaps", () => {
    const codes = (doc: { holderName: string | null; dateOfBirth: string | null }, crm: { name?: string | null; dateOfBirth?: string | null }) => crmWarnings(doc, crm).map((w) => w.code);
    expect(codes({ holderName: "Sita Shrestha", dateOfBirth: "2001-02-03" }, { name: "Sita Shrestha", dateOfBirth: "2001-02-03" })).toEqual([]);
    expect(codes({ holderName: "Sita Shrestha", dateOfBirth: "2001-02-03" }, { name: "Gita Shrestha", dateOfBirth: "2001-02-04T00:00:00.000Z" })).toEqual(["name_mismatch_crm", "dob_mismatch_crm"]);
    expect(codes({ holderName: null, dateOfBirth: null }, { name: "Gita", dateOfBirth: "2001-02-04" })).toEqual([]);
    expect(codes({ holderName: "Sita", dateOfBirth: "2001-02-03" }, { name: null, dateOfBirth: "" })).toEqual([]);
  });

  test("genderFromDocument maps sex markers to the CRM's values", () => {
    expect(genderFromDocument("M")).toBe("Male");
    expect(genderFromDocument("female")).toBe("Female");
    expect(genderFromDocument("X")).toBe("Other");
    expect(genderFromDocument(null)).toBeNull();
  });
});
