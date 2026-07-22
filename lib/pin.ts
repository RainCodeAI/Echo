/** Client-side PIN helpers for crew management UI. */

export function generatePin(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(1000 + (array[0] % 9000)).padStart(4, "0");
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function normalizePin(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}
