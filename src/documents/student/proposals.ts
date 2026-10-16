/**
 * The CRM writes a read document should become, decided in code (never by the research model).
 * Each planned write is then dry-run through CrmWriteService.propose and shown as an approval
 * card; nothing reaches the CRM until the counsellor approves it.
 *
 * Every field the document gives that the contact can hold is proposed when it differs from the CRM:
 * - Identity (name, date of birth, gender, nationality): a passport always; a national ID unless a
 *   passport came in the same turn. A national ID sets the nationality only when only citizens hold it.
 * - Passport number, country and expiry from a passport; country of birth from either.
 * - Home address (an ID, or a passport's address page), unless the CRM address is in another country.
 * - Everything else read (ID number, issue, authority, parents, place of birth, a B.S. date) → one
 *   `crm_create_note` per document.
 * - The file → `crm_attach_contact_document` with a short-lived signed link, never the bytes.
 *
 * Dates sent are always YYYY-MM-DD (crm-api refuses anything else); a Bikram Sambat date is
 * never converted and goes into the note only.
 */
import { z } from "zod";
import { idKindLabel, type ExtractionOutcome } from "./extract";
import { CRM_DOCUMENT_TYPES } from "./types";
import { namesMatch } from "./validate";

export interface CrmContactNow {
  name: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  countryOfPassport: string | null;
  country: string | null;
  city: string | null;
  /** Not exposed by crm_get_contact today; compared when a later crm-api adds them. */
  passportNo?: string | null;
  passportExpiryDate?: string | null;
  addressLineOne?: string | null;
  state?: string | null;
  countryOfBirth?: string | null;
  postalCode?: string | null;
}

const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim()));

const ContactSchema = z.object({
  name: text,
  dateOfBirth: text,
  gender: text,
  nationality: text,
  countryOfPassport: text,
  country: text,
  city: text,
  passportNo: text,
  passportExpiryDate: text,
  addressLineOne: text,
  state: text,
  countryOfBirth: text,
  postalCode: text,
});

/** The current values of `crm_get_contact`'s structured `contact`, or null when it has none. */
export function contactFromCrm(structured: Record<string, unknown> | undefined): CrmContactNow | null {
  const parsed = ContactSchema.safeParse(structured?.contact);
  return parsed.success ? parsed.data : null;
}

export interface PlannedWrite {
  tool: string;
  args: Record<string, unknown>;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const day = (v: string | null | undefined) => (v ?? "").trim().slice(0, 10);

/** The note's fixed layout: a header naming the file and the day it was read, then one line per value. */
export function identityNote(o: { fileName: string; readOn: string; kindLabel: string; country: string | null; lines: [string, string | null][] }): string {
  return [
    `Identity document (from ${o.fileName}, read ${o.readOn})`,
    `Document: ${o.kindLabel}`,
    ...(o.country ? [`Issuing country: ${o.country}`] : []),
    ...o.lines.filter(([, v]) => v).map(([label, v]) => `${label}: ${v}`),
  ].join("\n");
}

/** IDs only a country's own citizens hold, so the issuing country is the holder's nationality. Aadhaar and PhilSys are not. */
const CITIZEN_ONLY_IDS = new Set<string>(["nepal_citizenship", "bangladesh_nid", "sri_lanka_nic", "vietnam_cccd", "thailand_id"]);

/** "Ram Bahadur Thapa" → given "Ram Bahadur", surname "Thapa" (South and South-East Asian IDs print the family name last). */
function splitName(full: string | null): { given: string; surname: string } | null {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? { given: parts.slice(0, -1).join(" "), surname: parts.at(-1)! } : null;
}

export function planCrmWrites(o: {
  outcome: ExtractionOutcome;
  contactId: string;
  /** The contact as the CRM has it now; null when it could not be read (every field is then proposed). */
  crm: CrmContactNow | null;
  file: { name: string; mimeType: string; sizeBytes: number; sha256: string; url: string };
  /** YYYY-MM-DD, for the note header. */
  readOn: string;
  /** A passport was read in the same turn: it, not this national ID, sets name, date of birth, gender and nationality. */
  passportInTurn?: boolean;
}): PlannedWrite[] {
  const { view, values } = o.outcome;
  if (!values || view.documentType === "other") return [];
  const crm = o.crm;
  const passport = view.documentType === "passport";
  const writes: PlannedWrite[] = [];
  const update: Record<string, unknown> = {};
  const setIfDifferent = (field: string, value: string | null, current: string | null | undefined, cmp = same) => {
    if (value && !(current && cmp(value, current))) update[field] = value;
  };

  // Identity: a passport always; a national ID unless a passport came with it.
  if (passport || !o.passportInTurn) {
    const name =
      values.givenNames && values.surname ? { given: values.givenNames, surname: values.surname } : passport ? null : splitName(values.holderName);
    const docName = name ? `${name.given} ${name.surname}` : "";
    const sameName = Boolean(crm?.name && docName && namesMatch(docName, crm.name) && namesMatch(crm.name, docName));
    if (name && !sameName) {
      update.firstName = name.given;
      update.lastName = name.surname;
    } else if (passport && !sameName) {
      if (values.givenNames) update.firstName = values.givenNames;
      if (values.surname) update.lastName = values.surname;
    }
    setIfDifferent("dateOfBirth", values.dateOfBirth, crm?.dateOfBirth, (a, b) => a === day(b));
    setIfDifferent("gender", values.gender, crm?.gender);
    const nationality = values.nationality ?? (!passport && CITIZEN_ONLY_IDS.has(o.outcome.idKind) ? view.country : null);
    setIfDifferent("nationality", nationality, crm?.nationality);
  }
  if (passport) {
    setIfDifferent("passportNo", values.passportNo, crm?.passportNo);
    setIfDifferent("countryOfPassport", values.countryOfPassport, crm?.countryOfPassport);
    setIfDifferent("passportExpiryDate", values.expiryDate, crm?.passportExpiryDate, (a, b) => a === day(b));
  }

  // Address: a document's home address fills the CRM unless the CRM already holds an address in
  // another country (an onshore student's current address); then it goes into the note instead.
  const a = values.address;
  const hasAddress = Boolean(a.line || a.city || a.state || a.postalCode);
  const addressElsewhere = Boolean(hasAddress && crm?.country && a.country && !same(crm.country, a.country));
  if (hasAddress && !addressElsewhere) {
    setIfDifferent("addressLineOne", a.line, crm?.addressLineOne);
    setIfDifferent("city", a.city, crm?.city);
    setIfDifferent("state", a.state, crm?.state);
    setIfDifferent("postalCode", a.postalCode, crm?.postalCode);
    setIfDifferent("country", a.country, crm?.country);
  }
  setIfDifferent("countryOfBirth", values.countryOfBirth, crm?.countryOfBirth);
  if (Object.keys(update).length) writes.push({ tool: "crm_update_contact", args: { id: o.contactId, ...update } });

  // Everything read that has no contact field goes into one note per document.
  const idField = view.fields.find((f) => f.key === "nationalIdNumber");
  const lines: [string, string | null][] = [
    ...(passport ? [] : [[idField?.label ?? "ID number", values.nationalIdNumber] as [string, string | null]]),
    ["Date of issue", values.issueDateText],
    ["Place of issue", values.placeOfIssue],
    ["Issuing authority", values.issuingAuthority],
    ["Father's name", values.fatherName],
    ["Mother's name", values.motherName],
    ["Place of birth", values.placeOfBirth],
    // A date the contact cannot take (Bikram Sambat) is kept here.
    ["Date of birth", values.dateOfBirth ? null : values.dateOfBirthText],
    [`Permanent address (the CRM keeps the ${crm?.country} address)`, addressElsewhere ? [a.line, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ") : null],
  ];
  if (lines.some(([, v]) => v)) {
    writes.push({
      tool: "crm_create_note",
      args: {
        source: "contact",
        recordId: o.contactId,
        type: "general",
        description: identityNote({ fileName: view.fileName, readOn: o.readOn, kindLabel: idKindLabel(o.outcome.idKind), country: view.country, lines }),
      },
    });
  }

  const crmType = CRM_DOCUMENT_TYPES[view.documentType];
  writes.push({
    tool: "crm_attach_contact_document",
    args: {
      contactId: o.contactId,
      documentType: crmType.name,
      category: crmType.category,
      fileName: o.file.name,
      mimeType: o.file.mimeType,
      sizeBytes: o.file.sizeBytes,
      sha256: o.file.sha256,
      fileUrl: o.file.url,
    },
  });
  return writes;
}
