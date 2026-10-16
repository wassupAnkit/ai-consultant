/**
 * Deterministic checks on what the model read from an identity document: dates to YYYY-MM-DD,
 * expiry, Aadhaar masking, and agreement with the CRM. Nothing here calls a model.
 */
import type { DocumentWarning } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const iso = (y: number, m: number, d: number): string | null => {
  if (!(y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};

/** Year, month, day out of the common printed forms; day-first for the numeric ones (none of the markets writes month-first). */
function parts(text: string): [number, number, number] | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(t);
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])];
  // "12 JAN 1999", "12 Jan/Jan 1999" (bilingual passports print the month twice), "12-jan-1999"
  m = /^(\d{1,2})[ -]?([a-z]{3,9})(?:\/[a-z]{3,9})?[ -]?(\d{4})$/.exec(t);
  if (m && MONTHS[m[2]!]) return [Number(m[3]), MONTHS[m[2]!]!, Number(m[1])];
  // "January 12, 1999"
  m = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1]!]) return [Number(m[3]), MONTHS[m[1]!]!, Number(m[2])];
  return null;
}

export interface NormalisedDate {
  /** YYYY-MM-DD (Gregorian), or null when unreadable or in another calendar. */
  iso: string | null;
  calendar: "gregorian" | "bikram_sambat" | null;
  /** What to show: the ISO date, or the date as printed with its calendar ("2055-05-12 B.S."). */
  text: string | null;
}

/**
 * A printed date as YYYY-MM-DD. Nepal's citizenship certificates print dates in Bikram Sambat,
 * about 56.7 years ahead of the Gregorian calendar; those are kept as text and never converted
 * (a wrong conversion would land in the CRM as a real date). A date more than a year ahead of
 * today (30 years for `future` dates such as an expiry) is treated as Bikram Sambat too.
 */
export function normaliseDate(text: string | null | undefined, opts: { today?: Date; calendar?: string | null; future?: boolean } = {}): NormalisedDate {
  const raw = (text ?? "").trim();
  if (!raw) return { iso: null, calendar: null, text: null };
  const p = parts(raw);
  if (!p) return { iso: null, calendar: null, text: null };
  const today = opts.today ?? new Date();
  const limit = today.getUTCFullYear() + (opts.future ? 30 : 1);
  const bs = opts.calendar === "bikram_sambat" || p[0] > limit;
  if (bs) {
    const shown = `${p[0]}-${String(p[1]).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
    return { iso: null, calendar: "bikram_sambat", text: `${shown} B.S.` };
  }
  const value = iso(...p);
  return { iso: value, calendar: value ? "gregorian" : null, text: value };
}

/** An Aadhaar number reduced to its last four digits (`XXXX-XXXX-1234`); null without four digits. */
export function maskAadhaar(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

/** `expired` before today, `expires_within_12_months` up to a year ahead. */
export function expiryWarnings(expiryIso: string | null, today: Date = new Date()): DocumentWarning[] {
  if (!expiryIso) return [];
  const expiry = Date.parse(`${expiryIso}T00:00:00Z`);
  if (!Number.isFinite(expiry)) return [];
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (expiry < start) return [{ code: "expired", message: `The document expired on ${expiryIso}.` }];
  const inAYear = Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate());
  if (expiry <= inAYear) return [{ code: "expires_within_12_months", message: `The document expires on ${expiryIso}, within 12 months; most visas need longer validity.` }];
  return [];
}

/** "SITA KUMARI" → "Sita Kumari"; hyphenated and apostrophe parts keep their capitals. */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

const tokens = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** True when every part of the CRM's name appears on the document (order, case, accents and hyphens ignored). */
export function namesMatch(documentName: string, crmName: string): boolean {
  const doc = new Set(tokens(documentName));
  const crm = tokens(crmName);
  return crm.length > 0 && crm.every((t) => doc.has(t));
}

/** Name and date of birth against the CRM contact; a value missing on either side is not a mismatch. */
export function crmWarnings(doc: { holderName: string | null; dateOfBirth: string | null }, crm: { name?: string | null; dateOfBirth?: string | null }): DocumentWarning[] {
  const out: DocumentWarning[] = [];
  const crmName = crm.name?.trim();
  if (doc.holderName && crmName && !namesMatch(doc.holderName, crmName)) {
    out.push({ code: "name_mismatch_crm", message: `The name on the document (${doc.holderName}) differs from the CRM (${crmName}).` });
  }
  const crmDob = crm.dateOfBirth?.trim().slice(0, 10);
  if (doc.dateOfBirth && crmDob && crmDob !== doc.dateOfBirth) {
    out.push({ code: "dob_mismatch_crm", message: `The date of birth on the document (${doc.dateOfBirth}) differs from the CRM (${crmDob}).` });
  }
  return out;
}

/** The CRM's gender values from a document's sex marker. */
export function genderFromDocument(sex: string | null | undefined): "Male" | "Female" | "Other" | null {
  const s = (sex ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "m" || s === "male" || s === "पुरुष") return "Male";
  if (s === "f" || s === "female" || s === "महिला") return "Female";
  if (s === "x" || s === "other" || s === "o") return "Other";
  return null;
}
