import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time API key verification for the `x-api-key` header.
 *
 * Both sides are hashed before comparison so the buffers are always the same
 * length: timingSafeEqual never throws and the key length is not leaked.
 * Framework-agnostic so it works with Bun.serve handlers and in tests.
 */
export function createApiKeyVerifier(expectedKey: string | undefined) {
  const expectedDigest = expectedKey ? createHash("sha256").update(expectedKey).digest() : null;
  return {
    enabled: expectedDigest !== null,
    verify(provided: string | null | undefined): boolean {
      if (!expectedDigest) return true; // auth disabled (non-production only; enforced by env schema)
      if (typeof provided !== "string" || provided.length === 0) return false;
      const providedDigest = createHash("sha256").update(provided).digest();
      return timingSafeEqual(providedDigest, expectedDigest);
    },
  };
}
