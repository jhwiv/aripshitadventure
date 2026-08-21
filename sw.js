// Service worker for offline access to the trip itinerary.
//
// A service worker can never retroactively cache the very first page
// load's own resources - the browser dispatches those requests before the
// SW has finished installing/activating, so a purely "cache whatever flows
// through fetch" strategy leaves the cache empty until a SECOND visit.
// Confirmed live: without an explicit precache step, going offline and
// reloading right after the very first visit failed outright
// (net::ERR_FAILED, empty cache). Real travelers browsing this on the way
// to the airport and losing signal mid-trip need the FIRST visit to count.
//
// Fix: on install, fetch index.html itself and parse out its own
// same-origin <script src>/<link href> references, so the exact
// auto-cache-busted (?v=...) asset URLs are discovered dynamically rather
// than hardcoded here (which would go stale on every deploy). After that,
// runtime fetches are cached opportunistically (network-first, falling
// back to cache when offline) so anything else the traveler visits -
// individual day tabs are all client-side render, so no extra requests
// there, but this also covers vendor/leaflet files, the manifest, etc.
//
// Deliberately does NOT touch third-party requests (weather, maps tiles,
// Overpass local search, the chat worker) or /api/ (flight-status) - those
// need to be live or fail, and already degrade gracefully ("Weather
// unavailable" etc.) when offline.

const CACHE_NAME = 'trip-cache-v4';
const ALWAYS_PRECACHE = [
  '/', '/index.html', '/manifest.json', '/favicon-32.png', '/sw.js',
  '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(CACHE_NAME);
      // Discover the current build's actual asset URLs from index.html
      // itself, so the cache-buster stamp never needs to be duplicated here.
      // Fetched twice deliberately: reading .text() from a Response
      // consumes/locks its body, so cloning it AFTER that throws - caching
      // the html needs its own untouched fetch, not a clone of the one
      // already read for parsing. (Found live: the clone-after-read
      // ordering bug silently aborted this whole block via the outer
      // catch, which is why style.css/app.js/vendor files never made it
      // into the cache on the first pass at this.)
      try {
        const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
        const htmlForCache = await fetch('/index.html', { cache: 'no-store' });
        await cache.put('/index.html', htmlForCache.clone());
        await cache.put('/', htmlForCache);
        const urls = new Set();
        const re = /<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g;
        let m;
        while ((m = re.exec(html))) {
          const u = m[1];
          if (/^https?:\/\//.test(u)) continue; // skip fonts.googleapis.com etc - third-party, not ours to cache
          urls.add(u.startsWith('/') ? u : '/' + u);
        }
        await Promise.all(Array.from(urls).map(function (u) {
          return fetch(u, { cache: 'no-store' }).then(function (r) {
            if (r.ok) return cache.put(u, r);
          }).catch(function () { /* one missing asset shouldn't block install */ });
        }));
      } catch (e) { /* offline on first install attempt - nothing to precache yet */ }

      await Promise.all(ALWAYS_PRECACHE.map(function (u) {
        return fetch(u, { cache: 'no-store' }).then(function (r) {
          if (r.ok) return cache.put(u, r);
        }).catch(function () {});
      }));
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  event.respondWith(
    fetch(req).then(function (res) {
      var resClone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(req, resClone); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match('/index.html') || caches.match('/');
      });
    })
  );
});
