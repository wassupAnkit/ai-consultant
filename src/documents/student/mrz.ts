/**
 * Passport machine-readable zone (ICAO 9303 TD3: two lines of 44 characters), parsed and checked
 * in code. The model only transcribes the two lines; whether they are right is decided here by
 * the check digits, never by the model.
 *
 * Line 1: P<ISSUER SURNAME<<GIVEN<NAMES<<<...
 * Line 2: document number(9) check · nationality(3) · birth YYMMDD check · sex · expiry YYMMDD
 *         check · personal number(14) check · composite check (over 1-10, 14-20, 22-43).
 */

export interface MrzChecks {
  documentNumber: boolean;
  dateOfBirth: boolean;
  expiryDate: boolean;
  personalNumber: boolean;
  composite: boolean;
}

export interface Td3 {
  documentType: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  /** YYYY-MM-DD, null when the six digits are not a real date. */
  dateOfBirth: string | null;
  sex: "M" | "F" | "X";
  expiryDate: string | null;
  personalNumber: string | null;
  checks: MrzChecks;
  /** Every check digit holds. */
  valid: boolean;
}

const WEIGHTS = [7, 3, 1] as const;

function charValue(c: string): number {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
  return 0; // "<" filler
}

/** ICAO 9303 check digit: values weighted 7, 3, 1 repeating, summed mod 10. */
export function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += charValue(field[i]!) * WEIGHTS[i % 3]!;
  return sum % 10;
}

const digitOk = (field: string, check: string) => /^[0-9]$/.test(check) ? checkDigit(field) === Number(check) : check === "<" && /^<*$/.test(field);

/** OCR noise the model tends to keep: spaces, lower case, guillemets for the filler. */
export function normaliseMrzLine(line: string): string {
  return line.toUpperCase().replace(/[«‹＜]/g, "<").replace(/\s+/g, "").replace(/[^A-Z0-9<]/g, "");
}

function isoDate(yymmdd: string, century: number): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const y = century + Number(yymmdd.slice(0, 2));
  const m = Number(yymmdd.slice(2, 4));
  const d = Number(yymmdd.slice(4, 6));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const names = (s: string) => s.split("<").filter(Boolean).join(" ");

/** Parse a TD3 pair; null when the lines are not a passport MRZ. `today` decides the birth century. */
export function parseTd3(line1: string, line2: string, opts: { today?: Date } = {}): Td3 | null {
  const l1 = normaliseMrzLine(line1);
  const l2 = normaliseMrzLine(line2).padEnd(44, "<");
  if (l1.length < 30 || !l1.startsWith("P") || normaliseMrzLine(line2).length < 42) return null;
  const top = l1.padEnd(44, "<").slice(0, 44);
  const bottom = l2.slice(0, 44);

  const issuingState = top.slice(2, 5);
  const [surnamePart = "", givenPart = ""] = top.slice(5).split("<<");
  const documentNumber = bottom.slice(0, 9);
  const birth = bottom.slice(13, 19);
  const expiry = bottom.slice(21, 27);
  const personal = bottom.slice(28, 42);
  const sexChar = bottom[20]!;

  const checks: MrzChecks = {
    documentNumber: digitOk(documentNumber, bottom[9]!),
    dateOfBirth: digitOk(birth, bottom[19]!),
    expiryDate: digitOk(expiry, bottom[27]!),
    personalNumber: digitOk(personal, bottom[42]!),
    composite: digitOk(bottom.slice(0, 10) + bottom.slice(13, 20) + bottom.slice(21, 43), bottom[43]!),
  };

  const yy = (opts.today ?? new Date()).getUTCFullYear() % 100;
  const birthCentury = /^\d{2}/.test(birth) && Number(birth.slice(0, 2)) > yy ? 1900 : 2000;
  return {
    documentType: top.slice(0, 2).replace(/<+$/, ""),
    issuingState,
    surname: names(surnamePart),
    givenNames: names(givenPart),
    documentNumber: documentNumber.replace(/<+$/, ""),
    nationality: bottom.slice(10, 13),
    dateOfBirth: isoDate(birth, birthCentury),
    sex: sexChar === "M" || sexChar === "F" ? sexChar : "X",
    expiryDate: isoDate(expiry, 2000),
    personalNumber: personal.replace(/<+$/, "") || null,
    checks,
    valid: Object.values(checks).every(Boolean),
  };
}

/** ICAO three-letter codes → country names as the CRM stores them. Unknown → null (use the visual zone). */
const ICAO_COUNTRIES: Record<string, string> = {
  NPL: "Nepal",
  IND: "India",
  BGD: "Bangladesh",
  LKA: "Sri Lanka",
  VNM: "Vietnam",
  PHL: "Philippines",
  THA: "Thailand",
  PAK: "Pakistan",
  BTN: "Bhutan",
  MMR: "Myanmar",
  KHM: "Cambodia",
  IDN: "Indonesia",
  MYS: "Malaysia",
  CHN: "China",
  KOR: "South Korea",
  JPN: "Japan",
  MNG: "Mongolia",
  AFG: "Afghanistan",
  ARE: "United Arab Emirates",
  NGA: "Nigeria",
  KEN: "Kenya",
  GHA: "Ghana",
  AUS: "Australia",
  NZL: "New Zealand",
  GBR: "United Kingdom",
  GBD: "United Kingdom",
  GBN: "United Kingdom",
  IRL: "Ireland",
  USA: "United States",
  CAN: "Canada",
  "D<<": "Germany",
  DEU: "Germany",
  FRA: "France",
  NLD: "Netherlands",
  SGP: "Singapore",
};

export function countryFromIcao(code: string | null | undefined): string | null {
  if (!code) return null;
  return ICAO_COUNTRIES[normaliseMrzLine(code).padEnd(3, "<").slice(0, 3)] ?? null;
}
