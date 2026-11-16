/**
 * PIN hashing for field-worker entry (4-digit codes, or 6 when the company
 * turns on longer PINs).
 *
 * Hashes are one-way and scoped by companyId so the same PIN on two companies
 * does not produce the same digest. Mutations compare hashes with a constant-
 * time check to reduce timing leaks.
 */

export type PinLength = 4 | 6;
export const PIN_LENGTHS: readonly PinLength[] = [4, 6];

/** The company's required PIN length (default 4). */
export function companyPinLength(company: { pinLength?: number } | null | undefined): PinLength {
  return company?.pinLength === 6 ? 6 : 4;
}

/** A crew member's PIN length (members created before the setting existed have 4). */
export function memberPinLength(member: { pinLength?: number }): PinLength {
  return member.pinLength === 6 ? 6 : 4;
}

export function isValidPin(pin: string, length: PinLength = 4): boolean {
  return new RegExp(`^\\d{${length}}$`).test(pin);
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

/**
 * Escalating server lockout for repeated PIN failures on one company entry.
 * A flat 60s lock allowed ~14k guesses/day — the whole 4-digit space. Each
 * consecutive lockout (no successful PIN in between) waits longer, capped at
 * 15 minutes so a malicious lockout can't block a crew for hours.
 */
const LOCKOUT_STEPS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export function lockoutDurationMs(consecutiveLockouts: number): number {
  const index = Math.min(
    Math.max(0, consecutiveLockouts - 1),
    LOCKOUT_STEPS_MS.length - 1,
  );
  return LOCKOUT_STEPS_MS[index];
}
