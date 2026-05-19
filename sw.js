// Service worker — offline-eerste cachelaag voor Rijn Waterstanden.
// Strategie per type:
//   - app-shell (HTML/CSS/icons/manifest): cache-first
//   - data.json: network-first, val terug op cache als offline
//   - PEGELONLINE direct-fetch: altijd live, geen caching
//   - cross-origin requests: niet onderscheppen

const CACHE_VERSION = "v1";
const CACHE_NAME = `rijn-${CACHE_VERSION}`;

// Relatieve paden — werkt zowel op user.github.io/repo/ als op een custom domain
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll faalt als één bestand ontbreekt — addAll vervangen door losse adds
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((e) => console.warn("SW: cache miss", url, e.message))
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip cross-origin (PEGELONLINE, wasserkarte, fonts CDN, etc.) — laat browser doen
  if (url.origin !== self.location.origin) return;

  // data.json: network-first
  if (url.pathname.endsWith("data.json")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache de verse versie
          const copy = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Alles anders: cache-first met network-fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

// Optioneel: ontvang berichten van de pagina om handmatig te invalideren
self.addEventListener("message", (event) => {
  if (event.data === "clearCache") {
    caches.delete(CACHE_NAME).then(() => {
      event.source && event.source.postMessage("cacheCleared");
    });
  }
});
