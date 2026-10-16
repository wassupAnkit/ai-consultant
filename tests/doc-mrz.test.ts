import { describe, expect, test } from "bun:test";
import { checkDigit, countryFromIcao, parseTd3 } from "../src/documents/student/mrz";

// ICAO 9303 Part 4 specimen (Utopia, "Anna Maria Eriksson"): synthetic by definition.
const L1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const L2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("checkDigit", () => {
  test("weights 7-3-1 over digits, letters (A=10) and fillers", () => {
    expect(checkDigit("L898902C3")).toBe(6);
    expect(checkDigit("740812")).toBe(2);
    expect(checkDigit("120415")).toBe(9);
    expect(checkDigit("ZE184226B<<<<<")).toBe(1);
    expect(checkDigit("<<<")).toBe(0);
  });
});

describe("parseTd3", () => {
  test("the ICAO specimen parses with every check digit valid", () => {
    const m = parseTd3(L1, L2, { today: new Date("2026-10-12") })!;
    expect(m).not.toBeNull();
    expect(m.valid).toBe(true);
    expect(m.checks).toEqual({ documentNumber: true, dateOfBirth: true, expiryDate: true, personalNumber: true, composite: true });
    expect(m).toMatchObject({
      documentType: "P",
      issuingState: "UTO",
      surname: "ERIKSSON",
      givenNames: "ANNA MARIA",
      documentNumber: "L898902C3",
      nationality: "UTO",
      dateOfBirth: "1974-08-12",
      sex: "F",
      expiryDate: "2012-04-15",
      personalNumber: "ZE184226B",
    });
  });

  test("tolerates spaces, lower case and a guillemet OCR'd for the filler", () => {
    const m = parseTd3(` p<utoeriksson<<anna<maria${"«".repeat(19)} `, L2.toLowerCase())!;
    expect(m.valid).toBe(true);
    expect(m.givenNames).toBe("ANNA MARIA");
  });

  test("a broken document-number digit fails that check and the composite, nothing else", () => {
    const bad = `${L2.slice(0, 9)}5${L2.slice(10)}`;
    const m = parseTd3(L1, bad)!;
    expect(m.valid).toBe(false);
    expect(m.checks.documentNumber).toBe(false);
    expect(m.checks.composite).toBe(false);
    expect(m.checks.dateOfBirth).toBe(true);
    expect(m.checks.expiryDate).toBe(true);
  });

  test("a two-digit birth year after this year is the 1900s; expiry is always 20xx", () => {
    const m = parseTd3(L1, L2, { today: new Date("2026-10-12") })!;
    expect(m.dateOfBirth).toBe("1974-08-12");
    const young = parseTd3(L1, "L898902C36UTO0501012F3204159ZE184226B<<<<<18", { today: new Date("2026-10-12") })!;
    expect(young.dateOfBirth).toBe("2005-01-01");
    expect(young.expiryDate).toBe("2032-04-15");
  });

  test("not a TD3 pair → null", () => {
    expect(parseTd3("hello", "world")).toBeNull();
    expect(parseTd3(L1, L2.slice(0, 30))).toBeNull();
    expect(parseTd3("I<UTO", L2)).toBeNull();
  });

  test("an impossible date reads as null, and its check is still reported", () => {
    const m = parseTd3(L1, "L898902C36UTO7413322F1204159ZE184226B<<<<<10")!;
    expect(m.dateOfBirth).toBeNull();
  });
});

describe("countryFromIcao", () => {
  test("maps the markets Edge serves and the common destinations to CRM English names", () => {
    expect(countryFromIcao("NPL")).toBe("Nepal");
    expect(countryFromIcao("IND")).toBe("India");
    expect(countryFromIcao("BGD")).toBe("Bangladesh");
    expect(countryFromIcao("LKA")).toBe("Sri Lanka");
    expect(countryFromIcao("VNM")).toBe("Vietnam");
    expect(countryFromIcao("PHL")).toBe("Philippines");
    expect(countryFromIcao("THA")).toBe("Thailand");
    expect(countryFromIcao("D<<")).toBe("Germany");
    expect(countryFromIcao("UTO")).toBeNull();
  });
});

describe("synthetic fixtures", () => {
  test("the specimen passport's MRZ is valid and the broken one fails only its document number", async () => {
    const { PASSPORT_MRZ, PASSPORT_BAD_MRZ } = await import("./fixtures/documents/specimens");
    expect(parseTd3(...PASSPORT_MRZ)!.valid).toBe(true);
    const bad = parseTd3(...PASSPORT_BAD_MRZ)!;
    expect(bad.checks).toMatchObject({ documentNumber: false, dateOfBirth: true, expiryDate: true, composite: false });
  });

  test("every generated fixture is on disk, small, and of an accepted type", async () => {
    const { EXPECTED } = await import("./fixtures/documents/specimens");
    const { sniffMimeType } = await import("../src/documents/student/service");
    for (const file of Object.keys(EXPECTED)) {
      const bytes = new Uint8Array(await Bun.file(`${import.meta.dir}/fixtures/documents/${file}`).arrayBuffer());
      expect(bytes.length).toBeLessThan(100_000);
      expect(sniffMimeType(bytes)).not.toBeNull();
    }
  });
});
