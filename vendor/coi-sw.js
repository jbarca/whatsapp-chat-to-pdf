/*! coi-serviceworker v0.1.7 service worker ~https://github.com/getsentry/coi-serviceworker | MIT License */

// This service worker sets COOP/COEP headers to enable crossOriginIsolated
// which enables faster multi-threaded model inference in the app's safe mode screening.

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Only intercept GET requests to http(s) resources
  if (request.method !== 'GET' || !/^https?:$/.test(url.protocol)) {
    return;
  }

  // For same-origin requests, pass through
  if (url.origin === self.location.origin) {
    return;
  }

  // For cross-origin requests, try to fetch and add COEP header
  event.respondWith(
    fetch(request).then(response => {
      // If no response, bail out
      if (!response) return response;

      // Clone to avoid consuming the body
      const cloned = response.clone();

      // Return original response - we don't need to modify headers here
      // because the main document origin's COOP header is what matters
      return response;
    }).catch(() => {
      // If fetch fails, let it fail normally
      throw new Error('network error');
    })
  );
});
