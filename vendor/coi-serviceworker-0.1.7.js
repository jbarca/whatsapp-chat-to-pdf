/*! coi-serviceworker v0.1.7 helper script ~https://github.com/getsentry/coi-serviceworker | MIT License */
// This script attempts to register a service worker that enables crossOriginIsolated
// via COOP/COEP headers for faster model inference on multi-threaded hardware.
// If not already registered, it registers the worker and reloads the page.

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.serviceWorker) {
  const coiRegistrationKey = 'wa2pdf-coi-sw-registered';
  if (!sessionStorage.getItem(coiRegistrationKey)) {
    navigator.serviceWorker.register('vendor/coi-sw.js')
      .then(() => {
        sessionStorage.setItem(coiRegistrationKey, 'true');
        // Only reload if not in sample mode (tests and sample mode skip reload)
        if (!window.location.search.includes('sample=1') && !window.location.search.includes('test') && !navigator.webdriver) {
          window.location.reload();
        }
      })
      .catch(err => console.error('COI Service Worker registration failed:', err));
  }
}
