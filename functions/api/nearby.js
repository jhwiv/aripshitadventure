// Cloudflare Pages Function: POST /api/nearby
//
// The browser used to POST Overpass itself. Public Overpass instances
// close the connection, time out, or return 429/504 often enough that
// Nearby sat on "Searching nearby…" and then failed. Asking the mirrors
// one after another made that worse: the four that do not answer each
// burned ~6s, so an uncached tap took 19–25s before the French interpreter
// replied. This function starts every mirror at once, keeps the first
// valid JSON, and aborts the rest. The whole race has an ~8s budget.
// After that the function returns a clean error and the panel shows the
// Google Maps link. caches.default holds a brief copy keyed on rounded
// lat/lng + category so a second tap in the same spot does not race again.
//
// Body: { lat, lng, categories, radius? }
// categories must be one of the four button values in index.html.

const ALLOWED_CATEGORIES = new Set([
  'cafe|restaurant|bakery',
  'restaurant|cafe',
  'bar|pub',
  'pharmacy',
]);

// French and Swiss interpreters answered in about a second on 2026-10-02.
// The other four (de, kumi, private.coffee, mail.ru) returned 521 or hung.
// All six start together; list order is not a wait order. Promise.any
// keeps whichever returns valid JSON first.
const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const DEFAULT_RADIUS = 800;
const MIN_RADIUS = 100;
const MAX_RADIUS = 2000;
const TOTAL_BUDGET_MS = 8000;
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

  const query = `[out:json][timeout:6];(node["amenity"~"${categories}"]["name"](around:${radius},${lat},${lng}););out body 20;`;
  const winner = await raceMirrors(query);
  if (!winner) {
    return json({ ok: false, error: 'overpass unavailable' }, 502);
  }

  const out = json({ ok: true, elements: winner.elements }, 200, CACHE_SECONDS);
  await cachePut(cacheKey, out.clone());
  return out;
}

// First valid JSON wins. Every other request is aborted, and nothing
// is allowed to run past TOTAL_BUDGET_MS. Failures are not cached.
async function raceMirrors(query) {
  const deadline = AbortSignal.timeout(TOTAL_BUDGET_MS);
  const controllers = MIRRORS.map(() => new AbortController());
  const onDeadline = () => {
    for (const controller of controllers) controller.abort();
  };
  if (deadline.aborted) onDeadline();
  else deadline.addEventListener('abort', onDeadline, { once: true });

  const attempts = MIRRORS.map((endpoint, i) =>
    fetchMirror(endpoint, query, controllers[i].signal)
  );

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  } finally {
    deadline.removeEventListener('abort', onDeadline);
    for (const controller of controllers) controller.abort();
  }
}

async function fetchMirror(endpoint, query, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'aripshitadventure-nearby/1.0 (trip guide)',
    },
    body: 'data=' + encodeURIComponent(query),
    signal,
  });
  if (!res.ok) throw new Error('mirror ' + res.status);
  const data = await res.json();
  // overpass.osm.ch often answers first with elements:[] for a query the
  // French interpreter fills. An empty list is not a win — let the race
  // continue. A real empty area still ends as the clean 502 below.
  if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
    throw new Error('mirror empty');
  }
  return { elements: data.elements };
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
