import { describe, expect, test } from "bun:test";
import { testEnv } from "./helpers";

const KEY = Buffer.alloc(32, 5).toString("base64");
const SECRET = "doc-url-secret-0123456789abcdef0123";

describe("student document settings", () => {
  test("off by default, with a 10 MB limit and the doc model default", () => {
    const env = testEnv();
    expect(env.STUDENT_DOCS_ACTIVE).toBe(false);
    expect(env.STUDENT_DOC_MAX_BYTES).toBe(10_485_760);
    expect(env.GEMINI_DOC_MODEL).toBe("gemini-3.6-flash");
  });

  test("on only with the switch, the key, the secret and the base URL", () => {
    expect(testEnv({ STUDENT_DOC_ENC_KEY: KEY, DOCUMENT_URL_SECRET: SECRET, PUBLIC_BASE_URL: "https://edge.example.com" }).STUDENT_DOCS_ACTIVE).toBe(false);
    expect(testEnv({ STUDENT_DOCS_ENABLED: "true", STUDENT_DOC_ENC_KEY: KEY, DOCUMENT_URL_SECRET: SECRET, PUBLIC_BASE_URL: "https://edge.example.com" }).STUDENT_DOCS_ACTIVE).toBe(true);
  });

  test("a half-set or malformed configuration stops the boot", () => {
    expect(() => testEnv({ STUDENT_DOCS_ENABLED: "true", STUDENT_DOC_ENC_KEY: KEY })).toThrow(/DOCUMENT_URL_SECRET/);
    expect(() => testEnv({ STUDENT_DOC_ENC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(() => testEnv({ STUDENT_DOC_MAX_BYTES: String(20 * 1024 * 1024) })).toThrow();
    expect(() => testEnv({ PUBLIC_BASE_URL: `https://${"a".repeat(80)}.example.com` })).toThrow(/80 characters/);
  });
});
