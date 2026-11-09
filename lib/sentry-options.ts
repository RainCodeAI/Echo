import type { BrowserOptions } from "@sentry/nextjs";

/**
 * Shared Sentry privacy settings. Echo traffic carries audio, photos and
 * transcripts with customer names/addresses, so Sentry gets error metadata
 * only: no request/response bodies, cookies, query strings or user info.
 */
export const sentryPrivacyOptions: Pick<
  BrowserOptions,
  "tracesSampleRate" | "dataCollection"
> = {
  tracesSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    urlQueryParams: false,
    httpBodies: [],
  },
};
