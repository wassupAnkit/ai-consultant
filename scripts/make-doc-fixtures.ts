/**
 * Generates the SYNTHETIC identity-document fixtures in tests/fixtures/documents/ from the
 * invented values in tests/fixtures/documents/specimens.ts. Nothing here is a real person's
 * document; every card carries a "SPECIMEN" mark. Needs ImageMagick (`convert`) with Pango.
 *
 *   bun run scripts/make-doc-fixtures.ts
 */
import { $ } from "bun";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AADHAAR, CITIZENSHIP, NOT_ID, PASSPORT, PASSPORT_BAD_MRZ, PASSPORT_MRZ } from "../tests/fixtures/documents/specimens";

const OUT = join(import.meta.dir, "../tests/fixtures/documents");
const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(m) - 1]} ${y}`;
};

/**
 * Render Pango markup onto a card (plus, for a passport, the two MRZ lines in a monospace face,
 * drawn as plain text because Pango markup cannot carry the "<" fillers) and write a small PNG.
 */
async function card(name: string, markup: string, size = "1000x620", mrz?: [string, string]) {
  const out = join(OUT, name);
  const [paper, edge] = ["#f3efe4", "#9a8f7a"];
  const text = `pango:${markup}`;
  if (mrz) {
    const lines = `label:${mrz[0]}\n${mrz[1]}`;
    await $`convert -background ${paper} ${text} -font DejaVu-Sans-Mono -pointsize 25 ${lines} -append -gravity center -extent ${size} -bordercolor ${edge} -border 3 -colorspace Gray -depth 8 -colors 32 ${out}`.quiet();
  } else {
    await $`convert -size ${size} -background ${paper} ${text} -gravity center -extent ${size} -bordercolor ${edge} -border 3 -colorspace Gray -depth 8 -colors 32 ${out}`.quiet();
  }
  return out;
}

const passport = `<span font="DejaVu Sans 15">
<b>NEPAL · नेपाल</b>          <b>PASSPORT</b>        <span foreground="#b03030">SPECIMEN — SYNTHETIC TEST DOCUMENT</span>

Type / प्रकार: P      Country code: NPL      Passport No.: <b>${PASSPORT.number}</b>
Surname: <b>${PASSPORT.surname}</b>
Given Names: <b>${PASSPORT.given}</b>
Nationality: NEPALESE          Sex: ${PASSPORT.sex}
Date of Birth: <b>${fmt(PASSPORT.dob)}</b>          Place of Birth: ${PASSPORT.placeOfBirth}
Date of Issue: ${fmt(PASSPORT.issue)}          Date of Expiry: <b>${fmt(PASSPORT.expiry)}</b>
Issuing Authority: ${PASSPORT.authority}
</span>`;

const citizenship = `<span font="Lohit Devanagari 15">
<b>नेपाल सरकार · GOVERNMENT OF NEPAL</b>
<b>नेपाली नागरिकताको प्रमाणपत्र · CERTIFICATE OF NEPALESE CITIZENSHIP</b>   <span foreground="#b03030">SPECIMEN — SYNTHETIC</span>

ना.प्र.नं. / Citizenship Certificate No.: <b>${CITIZENSHIP.number}</b>
नाम थर / Full Name: <b>${CITIZENSHIP.fullName}</b> (${CITIZENSHIP.nameNepali})
लिङ्ग / Sex: पुरुष / Male
जन्म स्थान / Place of Birth: ${CITIZENSHIP.placeOfBirth}
स्थायी ठेगाना / Permanent Address: ${CITIZENSHIP.municipality}, ${CITIZENSHIP.ward}, District: ${CITIZENSHIP.district}
जन्म मिति / Date of Birth (B.S.): Year ${CITIZENSHIP.dobBs.slice(0, 4)} Month ${CITIZENSHIP.dobBs.slice(5, 7)} Day ${CITIZENSHIP.dobBs.slice(8, 10)}
बाबुको नाम / Father's Name: ${CITIZENSHIP.father}
आमाको नाम / Mother's Name: ${CITIZENSHIP.mother}
जारी मिति / Date of Issue (B.S.): ${CITIZENSHIP.issueBs}
जारी गर्ने / Issued by: ${CITIZENSHIP.authority}
</span>`;

const aadhaar = `<span font="Lohit Devanagari 16">
<b>भारत सरकार · GOVERNMENT OF INDIA</b>          <span foreground="#b03030">SPECIMEN — SYNTHETIC TEST CARD</span>

<b>${AADHAAR.name}</b>
जन्म तिथि / DOB: ${AADHAAR.dob.split("-").reverse().join("/")}
महिला / FEMALE
Address: ${AADHAAR.address}

<span font="DejaVu Sans Mono 30"><b>${AADHAAR.number}</b></span>
मेरा आधार, मेरी पहचान
</span>`;

const transcript = `<span font="DejaVu Sans 15">
<b>${NOT_ID.school}</b>
<b>${NOT_ID.title}</b>   <span foreground="#b03030">SPECIMEN — SYNTHETIC</span>

Student: TEST STUDENT ONE          Grade 12 (Science)          Year: 2023

English .......................... A
Mathematics ...................... B+
Physics .......................... A
Chemistry ........................ B
Biology .......................... A+

GPA: 3.62 / 4.00
</span>`;

{
  await card(PASSPORT.file, passport, "1000x620", PASSPORT_MRZ);
  await card("passport-nepal-bad-mrz.png", passport, "1000x620", PASSPORT_BAD_MRZ);
  await card(CITIZENSHIP.file, citizenship, "1100x620");
  await card(AADHAAR.file, aadhaar, "900x560");
  // The non-identity document as a one-page PDF (ImageMagick wraps the rendered page).
  const page = await card("transcript.png", transcript, "850x600");
  await $`convert ${page} -compress zip ${join(OUT, NOT_ID.file)}`.quiet();
  await rm(page);
  for (const f of [PASSPORT.file, "passport-nepal-bad-mrz.png", CITIZENSHIP.file, AADHAAR.file, NOT_ID.file]) {
    console.log(`${f}\t${Bun.file(join(OUT, f)).size} bytes`);
  }
}
