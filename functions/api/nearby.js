// Cloudflare Pages Function: POST /api/nearby
//
// The browser used to POST Overpass itself. Public Overpass instances
// close the connection, time out, or return 429/504 often enough that
// Nearby sat on "Searching nearby…" and then failed. This function asks
// the same mirrors from the server, with a short per-try timeout, and
// returns the first valid JSON. caches.default holds a brief copy so a
// second tap in the same spot does not hammer Overpass again.
//
// Body: { lat, lng, categories, radius? }
// categories must be one of the four button values in index.html.

const ALLOWED_CATEGORIES = new Set([
  'cafe|restaurant|bakery',
  'restaurant|cafe',
  'bar|pub',
  'pharmacy',
]);

// The first four are the required order. On 2026-10-02 all four were
// down or timed out from both this environment and the Pages function
// (overpass-api.de returned 521). The French and Swiss public interpreters
// answered the same query in about a second, so they are extra fallbacks
// after the required list — still first-good-JSON, still not cached on failure.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const DEFAULT_RADIUS = 800;
const MIN_RADIUS = 100;
const MAX_RADIUS = 2000;
const TRY_TIMEOUT_MS = 6000;
const CACHE_SECONDS = 120;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }

  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  const categories = String((body && body.categories) || '');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return json({ ok: false, error: 'invalid lat' }, 400);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return json({ ok: false, error: 'invalid lng' }, 400);
  }
  if (!ALLOWED_CATEGORIES.has(categories)) {
    return json({ ok: false, error: 'invalid categories' }, 400);
  }

  let radius = Number(body && body.radius);
  if (!Number.isFinite(radius)) radius = DEFAULT_RADIUS;
  radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(radius)));

  const cacheKey = nearbyCacheKey(request.url, lat, lng, categories, radius);
  const cached = await cacheMatch(cacheKey);
  if (cached) return cached;

  const query = `[out:json][timeout:8];(node["amenity"~"${categories}"]["name"](around:${radius},${lat},${lng}););out body 20;`;
  const errors = [];

  for (const endpoint of MIRRORS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'aripshitadventure-nearby/1.0 (trip guide)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(TRY_TIMEOUT_MS),
      });
      if (!res.ok) {
        errors.push(endpoint + ' ' + res.status);
        continue;
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.elements)) {
        errors.push(endpoint + ' bad json');
        continue;
      }
      const out = json({ ok: true, elements: data.elements }, 200, CACHE_SECONDS);
      await cachePut(cacheKey, out.clone());
      return out;
    } catch (err) {
      errors.push(endpoint + ' ' + (err && err.name ? err.name : String(err)));
    }
  }

  return json({ ok: false, error: 'overpass unavailable', detail: errors.join(' | ') }, 502);
}

function nearbyCacheKey(requestUrl, lat, lng, categories, radius) {
  const url = new URL(requestUrl);
  url.search = '';
  // ~100 m buckets so a second tap shares the cache entry.
  url.searchParams.set('lat', lat.toFixed(3));
  url.searchParams.set('lng', lng.toFixed(3));
  url.searchParams.set('cat', categories);
  url.searchParams.set('r', String(radius));
  return new Request(url.toString(), { method: 'GET' });
}

async function cacheMatch(key) {
  try {
    return await caches.default.match(key);
  } catch {
    return undefined;
  }
}

async function cachePut(key, response) {
  try {
    await caches.default.put(key, response);
  } catch {
    /* cache is an optimization */
  }
}

function json(body, status = 200, cacheSeconds = 0) {
  const headers = { ...JSON_HEADERS };
  headers['Cache-Control'] = cacheSeconds > 0
    ? 'public, max-age=' + cacheSeconds
    : 'no-store';
  return new Response(JSON.stringify(body), { status, headers });
}
