/* Echo service worker — installable PWA shell.
 *
 * Deliberately conservative about what it caches:
 *  - Precache only the public shell ("/" + manifest).
 *  - Cache-first for immutable static build assets (/_next/static, icons).
 *  - Navigations are network-first and are NEVER cached, so an authenticated
 *    dashboard can't be served to a signed-out user from cache. Offline
 *    navigations fall back to the cached public shell.
 *  - Everything else (Convex/Clerk APIs, cross-origin) is passed straight
 *    through — never cached.
 */
const CACHE = "echo-shell-v2";
const PRECACHE = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Immutable, non-sensitive assets that are safe to cache long-term. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: always try the network; fall back to the shell when offline.
  // Never cache the response (it may be an authenticated page).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Static build assets: cache-first, populate on first use.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else (APIs, cross-origin): straight through, no caching.
});
