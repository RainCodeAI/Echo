import * as Sentry from "@sentry/nextjs";
import { sentryPrivacyOptions } from "@/lib/sentry-options";

/**
 * Server/edge error monitoring for the Next.js app (Convex functions report
 * through the Convex dashboard's own exception-reporting integration).
 * Disabled unless SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set.
 */
export function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: !!dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    ...sentryPrivacyOptions,
  });
}

export const onRequestError = Sentry.captureRequestError;
