/** Canned model transcriptions of the SYNTHETIC specimens, for tests. */
import type { DocumentRead } from "../../../src/documents/student/extract";
import { PASSPORT, PASSPORT_MRZ } from "./specimens";

export const blankRead: DocumentRead = {
  readable: true, documentType: "passport", idKind: "passport", issuingCountry: null, surname: null, givenNames: null, fullName: null, sex: null,
  dateOfBirth: null, dateCalendar: null, placeOfBirth: null, placeOfBirthCountry: null, nationality: null, documentNumber: null, nationalIdNumber: null,
  issueDate: null, expiryDate: null, placeOfIssue: null, issuingAuthority: null, fatherName: null, motherName: null, address: null, mrzLine1: null, mrzLine2: null, uncertainFields: [],
};

export const passportRead = (over: Partial<DocumentRead> = {}): DocumentRead => ({
  ...blankRead,
  issuingCountry: "Nepal",
  surname: PASSPORT.surname,
  givenNames: PASSPORT.given,
  sex: "F",
  dateOfBirth: PASSPORT.dob,
  dateCalendar: "gregorian",
  placeOfBirth: PASSPORT.placeOfBirth,
  nationality: "NEPALESE",
  documentNumber: PASSPORT.number,
  issueDate: "16 APR 2022",
  expiryDate: PASSPORT.expiry,
  issuingAuthority: PASSPORT.authority,
  mrzLine1: PASSPORT_MRZ[0],
  mrzLine2: PASSPORT_MRZ[1],
  ...over,
});
