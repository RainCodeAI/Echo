/** Client-side PIN helpers for crew management UI. */

export function generatePin(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Full 0000–9999 range (modulo bias over 2^32 is negligible).
  return String(array[0] % 10000).padStart(4, "0");
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function normalizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}
