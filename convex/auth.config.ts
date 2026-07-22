/**
 * Convex auth configuration.
 *
 * Clerk JWT template named `convex` must exist (Clerk preset) so tokens carry
 * `aud: "convex"`.
 *
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
