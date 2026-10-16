/**
 * SYNTHETIC identity documents for tests, the fixture generator (scripts/make-doc-fixtures.ts) and
 * the extraction eval (scripts/eval-documents.ts). Every name, number and date here is invented;
 * none belongs to a real person. Never add a real student's document to this folder.
 */
import { checkDigit } from "../../../src/documents/student/mrz";

const pad = (s: string, n: number) => s.padEnd(n, "<").slice(0, n);

/** A TD3 MRZ pair with correct ICAO 9303 check digits. */
export function td3(p: { issuer: string; surname: string; given: string; number: string; nationality: string; dob: string; sex: "M" | "F"; expiry: string; personal?: string }): [string, string] {
  const l1 = pad(`P<${p.issuer}${p.surname.toUpperCase().replace(/ /g, "<")}<<${p.given.toUpperCase().replace(/ /g, "<")}`, 44);
  const num = pad(p.number, 9);
  const dob = p.dob.slice(2).replace(/-/g, "");
  const exp = p.expiry.slice(2).replace(/-/g, "");
  const personal = pad(p.personal ?? "", 14);
  const personalCheck = /^<*$/.test(personal) ? "<" : String(checkDigit(personal));
  const body = `${num}${checkDigit(num)}${p.nationality}${dob}${checkDigit(dob)}${p.sex}${exp}${checkDigit(exp)}${personal}${personalCheck}`;
  const composite = checkDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  return [l1, `${body}${composite}`];
}

export const PASSPORT = {
  file: "passport-nepal-valid.png",
  issuer: "NPL",
  surname: "SHRESTHA",
  given: "SITA KUMARI",
  number: "PX0012345",
  nationality: "NPL",
  dob: "2001-02-03",
  sex: "F" as const,
  issue: "2022-04-16",
  expiry: "2032-04-15",
  placeOfBirth: "KATHMANDU",
  authority: "MOFA, DEPARTMENT OF PASSPORTS",
};
export const PASSPORT_MRZ = td3(PASSPORT);

/** The same passport with the document-number check digit broken. */
export const PASSPORT_BAD_MRZ: [string, string] = [PASSPORT_MRZ[0], `${PASSPORT_MRZ[1].slice(0, 9)}${(Number(PASSPORT_MRZ[1][9]) + 1) % 10}${PASSPORT_MRZ[1].slice(10)}`];

export const CITIZENSHIP = {
  file: "citizenship-nepal.png",
  number: "27-01-76-04321",
  fullName: "RAM BAHADUR THAPA",
  nameNepali: "राम बहादुर थापा",
  sex: "M" as const,
  dobBs: "2058-02-01",
  placeOfBirth: "POKHARA, KASKI",
  district: "KASKI",
  municipality: "POKHARA METROPOLITAN CITY",
  ward: "WARD NO. 8",
  father: "HARI BAHADUR THAPA",
  mother: "SITA THAPA",
  issueBs: "2075-06-10",
  authority: "DISTRICT ADMINISTRATION OFFICE, KASKI",
};

export const AADHAAR = {
  file: "aadhaar-india.png",
  name: "PRIYA SHARMA",
  dob: "1999-11-23",
  sex: "F" as const,
  /** Starts with 9 like a real one would not (Aadhaar never begins with 0 or 1); still invented. */
  number: "9876 5432 1098",
  address: "HOUSE 12, MG ROAD, PUNE, MAHARASHTRA 411001",
};

export const NOT_ID = { file: "transcript-not-id.pdf", title: "ACADEMIC TRANSCRIPT", school: "EXAMPLE HIGHER SECONDARY SCHOOL" };

/** What extraction must produce for each fixture (field key → value), used by scripts/eval-documents.ts. */
export const EXPECTED: Record<string, { documentType: string; warnings: string[]; fields: Record<string, string> }> = {
  [PASSPORT.file]: {
    documentType: "passport",
    warnings: [],
    fields: { surname: "Shrestha", givenNames: "Sita Kumari", documentNumber: PASSPORT.number, dateOfBirth: PASSPORT.dob, expiryDate: PASSPORT.expiry, nationality: "Nepal", sex: "Female", issuingCountry: "Nepal" },
  },
  "passport-nepal-bad-mrz.png": {
    documentType: "passport",
    warnings: ["mrz_checksum_failed"],
    fields: { surname: "Shrestha", givenNames: "Sita Kumari", dateOfBirth: PASSPORT.dob, expiryDate: PASSPORT.expiry },
  },
  [CITIZENSHIP.file]: {
    documentType: "national_id",
    warnings: [],
    fields: { fullName: "Ram Bahadur Thapa", nationalIdNumber: CITIZENSHIP.number, dateOfBirth: `${CITIZENSHIP.dobBs} B.S.`, fatherName: "Hari Bahadur Thapa", motherName: "Sita Thapa", sex: "Male" },
  },
  [AADHAAR.file]: {
    documentType: "national_id",
    warnings: ["aadhaar_masked"],
    fields: { fullName: "Priya Sharma", nationalIdNumber: "XXXX-XXXX-1098", dateOfBirth: AADHAAR.dob, sex: "Female" },
  },
  [NOT_ID.file]: { documentType: "other", warnings: ["not_identity_document"], fields: {} },
};
