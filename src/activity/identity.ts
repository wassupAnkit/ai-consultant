import { createHash, createHmac } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Stable pseudonymous user id for the activity log. With a secret it is an
 * HMAC (cannot be reversed by dictionary attack on known emails); without one
 * it degrades to plain sha256 so development still produces stable ids.
 */
export function hashUser(ownerId: string, secret?: string): string {
  return secret ? createHmac("sha256", secret).update(ownerId).digest("hex") : sha256(ownerId);
}
