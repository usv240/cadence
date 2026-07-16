const CACHE_NAME = "cadence-shell-v5";
const APP_SHELL = ["/", "/app"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/app"))));
    return;
  }
  if (!url.pathname.startsWith("/_next/")) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const responseForCache = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, responseForCache)).catch(() => undefined));
    }
    return response;
  }).catch(() => caches.match(request)));
});
