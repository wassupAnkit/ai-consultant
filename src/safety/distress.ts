/**
 * Deterministic distress and self-harm cues, in the languages Expert Education's counsellors and
 * students write in. The classifier's own signals (`emotional_distress`, `crisis_safeguarding`)
 * missed the Bengali "ami r parchi na… kono kaj er na" and the Hinglish "sab khatam" in the South
 * Asia counsellor audit (Oct 2026) while Romanized Nepali "ma marchu hola" worked, so a fixed
 * phrase list backs it up: a hit always sets the flag, whatever the classifier said.
 *
 * Phrases are deliberately conservative — each says, in that language, that someone wants to die,
 * end their life or hurt themselves (`selfHarm`), or that they cannot go on / everything is over /
 * they are worthless (distress) — so ordinary worry ("nervous about the interview") does not
 * trigger a safety response. Matching is case-insensitive; Latin-script phrases match whole words
 * with any spacing, other scripts match as substrings. Add a phrase only with its meaning below.
 */

export type DistressLanguage = "english" | "nepali" | "hindi" | "bengali" | "vietnamese" | "tagalog" | "thai" | "sinhala" | "tamil";

export interface DistressSignal {
  /** The cue is about dying, ending one's life, or self-harm (not only being overwhelmed). */
  selfHarm: boolean;
  language: DistressLanguage;
  /** The phrase that matched, as listed here. */
  cue: string;
}

interface PhraseSet {
  language: DistressLanguage;
  /** Wanting to die, end one's life, or hurt oneself. */
  selfHarm: readonly string[];
  /** Cannot go on, everything is over, hopeless, worthless. */
  distress: readonly string[];
}

const PHRASES: readonly PhraseSet[] = [
  {
    language: "english",
    selfHarm: [
      "kill myself", "killing myself", "kill himself", "kill herself", "kill themselves",
      "end my life", "end his life", "end her life", "end their life", "end it all",
      "take my own life", "take my life", "take his own life", "take her own life",
      "suicide", "suicidal", "want to die", "wants to die", "wanna die",
      "don't want to live", "do not want to live", "doesn't want to live", "no reason to live",
      "better off dead", "hurt myself", "harm myself", "self-harm", "self harm", "cutting myself",
    ],
    distress: ["can't cope", "cannot cope", "can't go on", "cannot go on", "can't take it anymore", "can't take this anymore", "no way out", "hopeless", "worthless"],
  },
  {
    language: "nepali",
    // Romanized: marchu = "I will die"; marna man/chahanchu = "want to die"; aatmahatya = suicide;
    // bachna/jiuna man chaina = "don't feel like living". Devanagari: the same.
    // Distress: aba sakdina = "I can't (go on) anymore"; sabai sakiyo = "everything is finished".
    selfHarm: ["marchu", "mardinchu", "marna man", "marna chahanchu", "aatmahatya", "atmahatya", "bachna man chaina", "jiuna man chaina", "मर्छु", "मर्न मन", "आत्महत्या", "बाँच्न मन छैन", "जिउन मन छैन"],
    distress: ["aba sakdina", "sakdina aba", "sabai sakiyo", "sab sakiyo", "अब सक्दिन", "सबै सकियो"],
  },
  {
    language: "hindi",
    // Hinglish: mar jaunga/jaungi = "I will die"; khudkushi = suicide; jeena nahi chahta/chahti =
    // "don't want to live"; jaan de dunga/dungi = "I will give up my life". Devanagari: the same.
    // Distress: sab khatam = "everything is over"; kuch nahi bacha = "nothing is left";
    // bardasht nahi hota = "I can't bear it".
    selfHarm: ["mar jaunga", "mar jaungi", "mar jana chahta", "mar jana chahti", "khudkushi", "jeena nahi chahta", "jeena nahi chahti", "jaan de dunga", "jaan de dungi", "मर जाऊंगा", "मर जाऊँगा", "मर जाना चाहता", "मर जाना चाहती", "खुदकुशी", "ख़ुदकुशी", "जीना नहीं चाहता", "जीना नहीं चाहती", "जान दे दूंगा", "जान दे दूँगा"],
    distress: ["sab khatam", "sab khatm", "kuch nahi bacha", "bardasht nahi hota", "सब खत्म", "सब ख़त्म", "कुछ नहीं बचा", "बर्दाश्त नहीं होता"],
  },
  {
    language: "bengali",
    // Roman: atmohotta = suicide; more/mor jabo = "I will die"; morte chai = "want to die";
    // bachte chai na = "don't want to live". Script: the same.
    // Distress: (aar/r) parchi na = "I can't (take it) anymore"; kono kaj er na = "of no use";
    // sob shesh = "everything is over".
    selfHarm: ["atmohotta", "attohotta", "atmohatya", "mor jabo", "more jabo", "morte chai", "bachte chai na", "আত্মহত্যা", "মরে যাব", "মরে যেতে চাই", "বাঁচতে চাই না"],
    distress: ["r parchi na", "ar parchi na", "aar parchi na", "kono kaj er na", "kono kajer na", "sob shesh", "shob shesh", "আর পারছি না", "কোনো কাজের না", "কোন কাজের না", "সব শেষ"],
  },
  {
    language: "vietnamese",
    // tự tử / tự sát = suicide; muốn chết = want to die; không muốn sống = don't want to live.
    // Distress: tuyệt vọng = despair; không chịu nổi = can't bear it; bế tắc = at a dead end.
    selfHarm: ["tự tử", "tự sát", "muốn chết", "không muốn sống", "muon chet", "khong muon song"],
    distress: ["tuyệt vọng", "không chịu nổi", "bế tắc", "tuyet vong", "khong chiu noi"],
  },
  {
    language: "tagalog",
    // magpapakamatay = will kill oneself; gusto ko nang mamatay = I want to die;
    // ayoko nang mabuhay = I don't want to live. Distress: hindi/di ko na kaya = I can't anymore.
    selfHarm: ["magpapakamatay", "magpakamatay", "gusto ko nang mamatay", "gusto ko ng mamatay", "ayoko nang mabuhay", "ayoko ng mabuhay"],
    distress: ["hindi ko na kaya", "di ko na kaya", "wala na akong pag-asa"],
  },
  {
    language: "thai",
    // ฆ่าตัวตาย = suicide; อยากตาย = want to die; ไม่อยากมีชีวิตอยู่ = don't want to live.
    // Distress: ไม่ไหวแล้ว = can't take it anymore; หมดหวัง / สิ้นหวัง = hopeless.
    selfHarm: ["ฆ่าตัวตาย", "อยากตาย", "ไม่อยากมีชีวิตอยู่"],
    distress: ["ไม่ไหวแล้ว", "หมดหวัง", "สิ้นหวัง"],
  },
  {
    language: "sinhala",
    // සියදිවි නසා = suicide (take one's own life); මැරෙන්න ඕනේ = want to die. Distress: මට තවත් බැහැ = I can't anymore.
    selfHarm: ["සියදිවි නසා", "මැරෙන්න ඕනේ", "මැරෙන්න ඕනෙ"],
    distress: ["මට තවත් බැහැ"],
  },
  {
    language: "tamil",
    // தற்கொலை = suicide; சாக வேண்டும் / சாகணும் = want to die; வாழ விரும்பவில்லை = don't want to live.
    // Distress: இனி முடியாது = can't anymore; நம்பிக்கை இல்லை = no hope.
    selfHarm: ["தற்கொலை", "சாக வேண்டும்", "சாகணும்", "வாழ விரும்பவில்லை"],
    distress: ["இனி முடியாது", "நம்பிக்கை இல்லை"],
  },
];

const LATIN = /^[\p{Script=Latin}\s'’-]+$/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Matcher {
  test: (text: string) => boolean;
  cue: string;
  language: DistressLanguage;
  selfHarm: boolean;
}

function matcher(cue: string, language: DistressLanguage, selfHarm: boolean): Matcher {
  if (LATIN.test(cue)) {
    // Whole words, any whitespace between them, either apostrophe.
    const body = escapeRe(cue.toLowerCase()).replace(/\s+/g, "\\s+").replace(/'/g, "['’]?");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
    return { test: (t) => re.test(t), cue, language, selfHarm };
  }
  const needle = cue.normalize("NFC").toLowerCase();
  return { test: (t) => t.includes(needle), cue, language, selfHarm };
}

/** Self-harm cues first, so a message with both reports the stronger signal. */
const MATCHERS: readonly Matcher[] = [
  ...PHRASES.flatMap((p) => p.selfHarm.map((c) => matcher(c, p.language, true))),
  ...PHRASES.flatMap((p) => p.distress.map((c) => matcher(c, p.language, false))),
];

/** The first distress cue in `text` (a self-harm cue wins over a distress one), else null. */
export function detectDistress(text: string): DistressSignal | null {
  if (!text) return null;
  const t = text.normalize("NFC").toLowerCase();
  for (const m of MATCHERS) if (m.test(t)) return { selfHarm: m.selfHarm, language: m.language, cue: m.cue };
  return null;
}
