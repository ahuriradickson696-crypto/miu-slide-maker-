// Minimal service worker — exists primarily to satisfy PWA installability
// criteria (manifest + service worker + HTTPS) so "Add to Home Screen" on
// Android/iOS actually behaves like an installed app instead of just a
// bookmark, and gives a basic offline fallback for the app shell.
//
// Deliberately NOT caching API/server-function calls (deck generation,
// exports, auth) — those must always hit the network. Only static,
// content-hashed build assets and the app shell are cached.

const CACHE_VERSION = "miu-slide-studio-v1";
const OFFLINE_URL = "/";

const PRECACHE_URLS = ["/", "/manifest.webmanifest", "/favicon.ico", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Precaching is best-effort — a failed asset shouldn't block install.
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept POST (server functions, form submits)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Gemini, Google fonts, etc.)

  // Server functions and API routes are dynamic — always network, never cache.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn")) return;

  // Navigations: try network first (fresh content), fall back to the
  // cached shell if offline so the app still opens instead of showing the
  // browser's default offline error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || caches.match(request))),
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts): cache-first, since Vite fingerprints
  // filenames — a cached copy is never stale for a given filename.
  if (/\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
            return res;
          }),
      ),
    );
  }
});
