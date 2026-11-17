import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk auth proxy (Next 16 renamed `middleware.ts` → `proxy.ts`).
 * - /dashboard/* requires owner/office authentication.
 * - /entry/* is excluded from the middleware entirely (field workers use a
 *   PIN, not Clerk; see the matcher below).
 * - Marketing + auth routes stay public.
 */
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // The crew page (/entry/*) uses PINs, not Clerk: keep it out of the
    // middleware so it never waits on (or breaks with) a Clerk handshake
    // redirect, which matters on weak job-site signal.
    "/((?!_next|entry(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
