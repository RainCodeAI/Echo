import * as Sentry from "@sentry/nextjs";
import { sentryPrivacyOptions } from "@/lib/sentry-options";

/**
 * Browser error monitoring. Disabled unless NEXT_PUBLIC_SENTRY_DSN is set, so
 * local dev and forks send nothing. Most valuable on the field entry page,
 * where mic/recorder failures on specific phones would otherwise be invisible.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  ...sentryPrivacyOptions,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
