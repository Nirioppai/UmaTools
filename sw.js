const CACHE_VERSION = "v23";
const STATIC_CACHE = `umatools-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `umatools-runtime-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/events.html",
  "/hints.html",
  "/random.html",
  "/optimizer.html",
  "/calculator.html",
  "/stamina.html",
  "/umadle.html",
  "/404.html",
  "/robots.txt",
  "/sitemap.xml",
  "/site.webmanifest",
  "/css/base.css",
  "/css/theme-d.build.css",
  "/css/landing.css",
  "/css/events.css",
  "/css/hints.css",
  "/css/random.css",
  "/css/umadle.css",
  "/css/optimizer.css",
  "/css/rating.css",
  "/css/calculator.css",
  "/css/stamina.css",
  "/css/tutorial.css",
  "/js/nav.js",
  "/js/rating-shared.js",
  "/js/tutorial.js",
  "/js/ocr.js",
  "/js/hints.js",
  "/js/random.js",
  "/js/optimizer.js",
  "/js/calculator.js",
  "/js/stamina.js",
  "/js/umadle.js",
  "/js/search.js",
  "/js/recommend.js",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/og-default.png",
  "/assets/rank_badges.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("umatools-") && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request));
}

function staleWhileRevalidate(request) {
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function isCodeAsset(pathname) {
  return pathname.endsWith(".js") || pathname.endsWith(".css");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_vercel/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    // Keep code assets fresh without requiring hard refreshes after deploys.
    event.respondWith(isCodeAsset(url.pathname) ? networkFirst(request) : cacheFirst(request));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".csv") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});



