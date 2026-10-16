/**
 * Edge's persona: deployment-configurable, not tied to any one company. Unset
 * PERSONA_COMPANY_NAME (the default) means the assistant names no employer and
 * asserts no company facts as ground truth — company-specific facts a consultant
 * needs should come from the knowledge base as cited evidence.
 *
 * Read directly from process.env, not through loadEnv()/getEnv() (src/config/env.ts),
 * so importing this module never requires the full Env schema (GOOGLE_API_KEY,
 * MONGODB_URI, …) to be set. PERSONA_* are documented and validated in env.ts too,
 * for consistency with every other deployment setting, but prompts/consultant.ts and
 * prompts/intents.ts import PERSONA directly and must stay importable standalone.
 */
const personaName = process.env.PERSONA_NAME?.trim() || "Edge";
const companyName = process.env.PERSONA_COMPANY_NAME?.trim() || undefined;
const companyAbout = process.env.PERSONA_COMPANY_ABOUT?.trim() || undefined;

export const PERSONA = {
  name: personaName,
  fullTitle: `${personaName}, the internal AI assistant for consultants and staff`,
  company: companyName ? { name: companyName, about: companyAbout } : undefined,
} as const;

export type Persona = typeof PERSONA;
