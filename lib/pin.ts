/** Client-side PIN helpers for crew management UI (4 or 6 digits). */

export type PinLength = 4 | 6;

export function generatePin(length: PinLength = 4): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Full range including leading zeros (modulo bias over 2^32 is negligible).
  const space = 10 ** length;
  return String(array[0] % space).padStart(length, "0");
}

export function isValidPin(pin: string, length: PinLength = 4): boolean {
  return pin.length === length && /^\d+$/.test(pin);
}

export function normalizePin(value: string, length: PinLength = 4): string {
  return value.replace(/\D/g, "").slice(0, length);
}
