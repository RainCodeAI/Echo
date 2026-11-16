// The config entry point is CommonJS; import the default and destructure.
import sentryConfig from "@sentry/nextjs/config";

const { withSentryConfig } = sentryConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const common = [
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Field capture needs mic (and optionally camera for photos).
      {
        key: "Permissions-Policy",
        value: "camera=(self), microphone=(self), geolocation=()",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
    ];

    return [
      { source: "/:path*", headers: common },
      {
        source: "/dashboard/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

/**
 * Sentry build integration. Source maps upload only when SENTRY_AUTH_TOKEN
 * (+ SENTRY_ORG / SENTRY_PROJECT) are set — e.g. in Vercel production. Without
 * them the build is unchanged apart from the SDK being bundled (and inert
 * until a DSN is configured).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
