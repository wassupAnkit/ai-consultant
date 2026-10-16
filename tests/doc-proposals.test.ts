import { describe, expect, test } from "bun:test";
import { interpret } from "../src/documents/student/extract";
import { contactFromCrm, identityNote, planCrmWrites } from "../src/documents/student/proposals";
import { passportRead } from "./fixtures/documents/reads";
import { CITIZENSHIP } from "./fixtures/documents/specimens";

const TODAY = new Date("2026-10-12T08:00:00Z");
const FILE = { name: "passport.png", mimeType: "image/png", sizeBytes: 1234, sha256: "a".repeat(64), url: "https://edge.example.com/v1/files/a1?exp=1&sig=b" };
const passport = () => {
  const r = interpret({ attachmentId: "a1", fileName: "passport.png" }, passportRead(), TODAY);
  return { ...r, model: "m", ms: 1 };
};
const citizenship = () => {
  const r = interpret(
    { attachmentId: "c1", fileName: "citizenship.png" },
    {
      readable: true, documentType: "national_id", idKind: "nepal_citizenship", issuingCountry: "Nepal", surname: null, givenNames: null, fullName: CITIZENSHIP.fullName, sex: "M",
      dateOfBirth: CITIZENSHIP.dobBs, dateCalendar: "bikram_sambat", placeOfBirth: CITIZENSHIP.placeOfBirth, placeOfBirthCountry: "Nepal", nationality: "Nepal", documentNumber: null,
      nationalIdNumber: CITIZENSHIP.number, issueDate: CITIZENSHIP.issueBs, expiryDate: null, placeOfIssue: "KASKI", issuingAuthority: CITIZENSHIP.authority,
      fatherName: CITIZENSHIP.father, motherName: CITIZENSHIP.mother, address: { line: CITIZENSHIP.ward, city: CITIZENSHIP.municipality, district: CITIZENSHIP.district, state: "GANDAKI", postalCode: null, country: null },
      mrzLine1: null, mrzLine2: null, uncertainFields: [],
    },
    TODAY,
  );
  return { ...r, model: "m", ms: 1 };
};

describe("contactFromCrm", () => {
  test("reads crm_get_contact's structured contact leniently", () => {
    expect(contactFromCrm({ contact: { id: "c", name: "Sita Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal", countryOfPassport: null } })).toMatchObject({ name: "Sita Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal", countryOfPassport: null });
    expect(contactFromCrm(undefined)).toBeNull();
  });
});

describe("planCrmWrites: passport", () => {
  test("proposes only the profile fields that differ from the CRM, a note with what has no CRM field, then the file", () => {
    const writes = planCrmWrites({ outcome: passport(), contactId: "c-1", crm: { name: "Sita Kumari Shrestha", dateOfBirth: "2001-02-03", gender: "female", nationality: "Nepal", countryOfPassport: null, country: "Nepal", city: null }, file: FILE, readOn: "2026-10-12" });
    expect(writes.map((w) => w.tool)).toEqual(["crm_update_contact", "crm_create_note", "crm_attach_contact_document"]);
    expect(writes[0]!.args).toEqual({ id: "c-1", passportNo: "PX0012345", countryOfPassport: "Nepal", passportExpiryDate: "2032-04-15" });
    const note = String(writes[1]!.args.description);
    expect(note.split("\n").slice(0, 3)).toEqual(["Identity document (from passport.png, read 2026-10-12)", "Document: Passport", "Issuing country: Nepal"]);
    expect(note).toContain("Date of issue: 2022-04-16");
    expect(note).toContain("Place of birth: Kathmandu");
    expect(note).toContain("Issuing authority: MOFA, DEPARTMENT OF PASSPORTS");
    expect(note).not.toContain("PX0012345"); // already a contact field
    expect(writes[2]!.args).toEqual({ contactId: "c-1", documentType: "Passport", category: "Personal", fileName: "passport.png", mimeType: "image/png", sizeBytes: 1234, sha256: "a".repeat(64), fileUrl: FILE.url });
  });

  test("a different CRM name proposes both name fields; an unknown CRM proposes everything", () => {
    const named = planCrmWrites({ outcome: passport(), contactId: "c-1", crm: { name: "Gita Shrestha", dateOfBirth: null, gender: null, nationality: null, countryOfPassport: null, country: null, city: null }, file: FILE, readOn: "2026-10-12" });
    expect(named[0]!.args).toMatchObject({ firstName: "Sita Kumari", lastName: "Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal" });
    const unknown = planCrmWrites({ outcome: passport(), contactId: "c-1", crm: null, file: FILE, readOn: "2026-10-12" });
    expect(Object.keys(unknown[0]!.args).sort()).toEqual(["countryOfPassport", "dateOfBirth", "firstName", "gender", "id", "lastName", "nationality", "passportExpiryDate", "passportNo"].sort());
  });

  test("country of birth, a printed address and parents' names (India's last page) are filled too", () => {
    const r = interpret(
      { attachmentId: "a2", fileName: "passport-in.pdf" },
      passportRead({ placeOfBirthCountry: "India", fatherName: "RAJESH SHARMA", motherName: "ANITA SHARMA", address: { line: "12 MG ROAD", city: "PUNE", district: null, state: "MAHARASHTRA", postalCode: "411001", country: "INDIA" } }),
      TODAY,
    );
    const writes = planCrmWrites({ outcome: { ...r, model: "m", ms: 1 }, contactId: "c-1", crm: { name: "Sita Kumari Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal", countryOfPassport: "Nepal", country: null, city: null, passportNo: "PX0012345", passportExpiryDate: "2032-04-15" }, file: FILE, readOn: "2026-10-12" });
    expect(writes[0]!.args).toEqual({ id: "c-1", countryOfBirth: "India", addressLineOne: "12 Mg Road", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "India" });
    const note = String(writes[1]!.args.description);
    expect(note).toContain("Father's name: Rajesh Sharma");
    expect(note).toContain("Mother's name: Anita Sharma");
    expect(note).not.toContain("Address");
  });

  test("everything already in the CRM → the note and the file only", () => {
    const writes = planCrmWrites({ outcome: passport(), contactId: "c-1", crm: { name: "Sita Kumari Shrestha", dateOfBirth: "2001-02-03", gender: "Female", nationality: "Nepal", countryOfPassport: "Nepal", country: null, city: null, passportNo: "PX0012345", passportExpiryDate: "2032-04-15" }, file: FILE, readOn: "2026-10-12" });
    expect(writes.map((w) => w.tool)).toEqual(["crm_create_note", "crm_attach_contact_document"]);
  });
});

describe("planCrmWrites: national ID", () => {
  test("name, gender, nationality, address and country of birth to the contact, number/issue/parents to one note, then the file; a B.S. date of birth is never written", () => {
    const writes = planCrmWrites({ outcome: citizenship(), contactId: "c-2", crm: { name: "Ram Thapa", dateOfBirth: null, gender: null, nationality: null, countryOfPassport: null, country: null, city: null }, file: { ...FILE, name: "citizenship.png" }, readOn: "2026-10-12" });
    expect(writes.map((w) => w.tool)).toEqual(["crm_update_contact", "crm_create_note", "crm_attach_contact_document"]);
    expect(writes[0]!.args).toEqual({ id: "c-2", firstName: "Ram Bahadur", lastName: "Thapa", gender: "Male", nationality: "Nepal", addressLineOne: "Ward No. 8", city: "Pokhara Metropolitan City", state: "Gandaki", country: "Nepal", countryOfBirth: "Nepal" });
    expect(writes[1]!.args).toMatchObject({ source: "contact", recordId: "c-2", type: "general" });
    const note = String(writes[1]!.args.description);
    expect(note.split("\n")[0]).toBe("Identity document (from citizenship.png, read 2026-10-12)");
    expect(note).toContain("Document: Nepal citizenship certificate");
    expect(note).toContain(`Citizenship certificate number: ${CITIZENSHIP.number}`);
    expect(note).toContain("Date of issue: 2075-06-10 B.S.");
    expect(note).toContain("Father's name: Hari Bahadur Thapa");
    expect(note).toContain("Mother's name: Sita Thapa");
    expect(note).toContain("Place of birth: Pokhara, Kaski");
    expect(note).toContain("Date of birth: 2058-02-01 B.S.");
    expect(writes[2]!.args).toMatchObject({ documentType: "Citizenship/National ID", category: "Personal" });
  });

  test("a Gregorian date of birth that differs is proposed, unless a passport was read in the same turn", () => {
    const o = citizenship();
    o.values!.dateOfBirth = "2001-05-14";
    const crm = { name: "Ram Bahadur Thapa", dateOfBirth: "2001-05-15", gender: null, nationality: null, countryOfPassport: null, country: null, city: null };
    const alone = planCrmWrites({ outcome: o, contactId: "c", crm, file: FILE, readOn: "2026-10-12" });
    expect(alone[0]!.args).toMatchObject({ dateOfBirth: "2001-05-14", gender: "Male", nationality: "Nepal" });
    const withPassport = planCrmWrites({ outcome: o, contactId: "c", crm: { ...crm, name: "Someone Else" }, file: FILE, readOn: "2026-10-12", passportInTurn: true });
    for (const k of ["dateOfBirth", "firstName", "lastName", "gender", "nationality"]) expect(withPassport[0]!.args[k]).toBeUndefined();
    expect(withPassport[0]!.args).toMatchObject({ city: "Pokhara Metropolitan City", countryOfBirth: "Nepal" });
  });

  test("an ID that is not proof of citizenship (Aadhaar) never sets the nationality", () => {
    const o = citizenship();
    o.idKind = "india_aadhaar";
    o.values!.nationality = null;
    o.view.country = "India";
    expect(planCrmWrites({ outcome: o, contactId: "c", crm: null, file: FILE, readOn: "2026-10-12" })[0]!.args.nationality).toBeUndefined();
    const nepal = citizenship();
    nepal.values!.nationality = null;
    expect(planCrmWrites({ outcome: nepal, contactId: "c", crm: null, file: FILE, readOn: "2026-10-12" })[0]!.args.nationality).toBe("Nepal");
  });

  test("a home address abroad never replaces a CRM address in another country: it goes into the note", () => {
    const writes = planCrmWrites({ outcome: citizenship(), contactId: "c", crm: { name: "Ram Bahadur Thapa", dateOfBirth: null, gender: "Male", nationality: "Nepal", countryOfPassport: null, country: "Australia", city: "Sydney" }, file: FILE, readOn: "2026-10-12" });
    for (const k of ["addressLineOne", "city", "state", "country", "postalCode"]) expect(writes[0]!.args[k]).toBeUndefined();
    expect(String(writes[1]!.args.description)).toContain("Permanent address (the CRM keeps the Australia address): Ward No. 8, Pokhara Metropolitan City, Gandaki, Nepal");
  });

  test("identityNote has a fixed layout and skips empty lines", () => {
    expect(identityNote({ fileName: "x.pdf", readOn: "2026-10-12", kindLabel: "India Aadhaar card", country: "India", lines: [["Aadhaar number", "XXXX-XXXX-1098"], ["Father's name", null]] })).toBe(
      "Identity document (from x.pdf, read 2026-10-12)\nDocument: India Aadhaar card\nIssuing country: India\nAadhaar number: XXXX-XXXX-1098",
    );
  });
});

describe("planCrmWrites: nothing to propose", () => {
  test("other and unreadable documents propose nothing", () => {
    const other = interpret({ attachmentId: "o", fileName: "t.png" }, { ...passportRead(), documentType: "other", idKind: "not_identity_document" }, TODAY);
    expect(planCrmWrites({ outcome: { ...other, model: "m", ms: 1 }, contactId: "c", crm: null, file: FILE, readOn: "2026-10-12" })).toEqual([]);
  });
});
