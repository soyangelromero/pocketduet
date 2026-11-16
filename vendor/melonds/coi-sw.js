// Optional "coi-serviceworker" helper: some static hosts (GitHub Pages, plain object storage, a simple `python -m
// http.server`, ...) cannot send custom headers. SharedArrayBuffer (and therefore this port with threads) needs
// cross-origin isolation, which is what the COOP/COEP headers provide. This service worker re-serves every same-origin
// response with those headers added, so the page becomes `crossOriginIsolated` after one reload.
//
// It is OPTIONAL: if the host already sends the headers (the Node server and `scripts/serve.mjs` do), the page is
// isolated on the first load and the registration script in `demo/index.html` does nothing. If this worker cannot fix
// the isolation (service workers need HTTPS or localhost), the page keeps working without threads? No: the port needs
// threads, so it explains the requirement (see README "Requisitos").
//
// Technique adapted from coi-serviceworker by Guido Zuidhof (MIT, https://github.com/gzuidhof/coi-serviceworker).
// Deliberately dependency-free and small: it only handles same-origin GETs and leaves the rest untouched.

/* eslint-env serviceworker */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // The known coi-serviceworker guard: do not break `only-if-cached` requests from a different mode.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  // Only same-origin responses are re-wrapped; a cross-origin resource must send its own CORP/CORS headers.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const response = await fetch(request);
      if (response.status === 0) return response; // opaque response: nothing to wrap
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
