/**
 * PIN hashing for field-worker entry (Relay-style 4-digit codes).
 *
 * Hashes are one-way and scoped by companyId so the same PIN on two companies
 * does not produce the same digest. Mutations compare hashes with a constant-
 * time check to reduce timing leaks.
 */

const PIN_PATTERN = /^\d{4}$/;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** SHA-256 hex digest of `${companyId}:${pin}`. */
export async function hashPin(
  companyId: string,
  pin: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${companyId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time equality for equal-length hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
