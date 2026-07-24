/**
 * Email helpers for office invites.
 *
 * Invites are matched to a signing-in Clerk user by their (verified) email, so
 * both sides must normalize identically — hence one shared place for it.
 */

/** Lowercase + trim so invite matching is case/whitespace-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Loose structural check — enough to reject obvious typos in the invite form. */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
