// Cloudflare Pages Function: /api/flight-status
//
// Fetches live status for an American Airlines flight from FlightAware AeroAPI,
// caches the response for 3 minutes at the edge, and returns a small JSON shape
// the client uses to update the Flights & Hotel tab.
//
// Usage: GET /api/flight-status?ident=AAL3006&date=2026-06-03
//   ident — ICAO flight ident (e.g. AAL3006). Required.
//   date  — YYYY-MM-DD departure date in origin TZ. Required.
//
// Env vars (set in Cloudflare Pages dashboard):
//   AEROAPI_KEY — FlightAware AeroAPI personal-tier key
//
// Response shape:
//   {
//     ok: true,
//     ident: "AAL3006",
//     status: "Scheduled" | "Delayed" | "On Time" | "Boarding" | "In Air" |
//             "Landed" | "Arrived" | "Cancelled" | "Diverted" | "Unknown",
//     statusLevel: "sched" | "ontime" | "delayed" | "now" | "done" | "cancel",
//     scheduledOut: "2026-06-03T11:00:00Z",  // ISO
//     estimatedOut: "2026-06-03T11:00:00Z",  // ISO, may equal scheduledOut
//     actualOut: null | "2026-06-03T11:08:00Z",
//     scheduledIn:  "2026-06-03T12:40:00Z",
//     estimatedIn:  "2026-06-03T12:40:00Z",
//     actualIn:     null | "2026-06-03T12:52:00Z",
//     delayMinutes: 0,
//     gateOrigin: "B14" | null,
//     gateDestination: "C32" | null,
//     terminalOrigin: "B" | null,
//     terminalDestination: "C" | null,
//     cancelled: false,
//     diverted: false,
//     fetchedAt: "2026-06-03T13:45:11Z"
//   }

const CACHE_TTL_SECONDS = 180; // 3 minutes

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ident = (url.searchParams.get('ident') || '').trim().toUpperCase();
  const date = (url.searchParams.get('date') || '').trim();

  // Validate inputs
  if (!/^[A-Z]{2,3}\d{1,4}$/.test(ident)) {
    return json({ ok: false, error: 'invalid ident' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: 'invalid date' }, 400);
  }
  if (!env.AEROAPI_KEY) {
    return json({ ok: false, error: 'AEROAPI_KEY not configured' }, 500);
  }

  // Try edge cache first (3 min)
  const cacheKey = new Request(`https://cache.local/flight-status/${ident}/${date}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // Build AeroAPI request: ±1 day window around departure date
  const start = `${date}T00:00:00Z`;
  const endDate = nextDay(date);
  const end = `${endDate}T00:00:00Z`;
  const aeroUrl = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}?start=${start}&end=${end}`;

  let upstream;
  try {
    upstream = await fetch(aeroUrl, {
      headers: { 'x-apikey': env.AEROAPI_KEY, 'Accept': 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: false },
    });
  } catch (err) {
    return json({ ok: false, error: 'aeroapi fetch failed', detail: String(err) }, 502);
  }

  if (!upstream.ok) {
    const body = await upstream.text();
    return json({ ok: false, error: `aeroapi ${upstream.status}`, detail: body.slice(0, 400) }, 502);
  }

  const data = await upstream.json();
  const flights = Array.isArray(data.flights) ? data.flights : [];

  // Pick the flight whose scheduled_out date (in origin TZ) matches `date`.
  // AeroAPI returns multiple instances if the flight ran on adjacent days.
  const match = pickFlight(flights, date) || flights[0] || null;

  const result = match ? extract(match) : {
    ok: true,
    ident,
    status: 'Unknown',
    statusLevel: 'sched',
    note: 'no flight data',
  };
  result.ok = true;
  result.ident = ident;
  result.fetchedAt = new Date().toISOString();

  const response = json(result, 200, {
    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    'Access-Control-Allow-Origin': '*',
  });

  // Stash in edge cache for next request (clone before returning)
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// --- helpers ---

function pickFlight(flights, date) {
  // Prefer the instance whose scheduled_out's local date matches the requested date.
  for (const f of flights) {
    if (!f.scheduled_out) continue;
    const tz = f.origin?.timezone || 'UTC';
    const localDate = isoToLocalDate(f.scheduled_out, tz);
    if (localDate === date) return f;
  }
  // Fallback: closest by absolute time
  return flights[0] || null;
}

function extract(f) {
  const cancelled = !!f.cancelled;
  const diverted = !!f.diverted;
  const schedOut = f.scheduled_out || null;
  const estOut = f.estimated_out || schedOut;
  const actOut = f.actual_out || null;
  const schedIn = f.scheduled_in || null;
  const estIn = f.estimated_in || schedIn;
  const actIn = f.actual_in || null;

  // Delay (in minutes) = (estimated_out or actual_out) - scheduled_out
  let delayMinutes = 0;
  if (schedOut) {
    const refOut = actOut || estOut;
    if (refOut) {
      delayMinutes = Math.round((Date.parse(refOut) - Date.parse(schedOut)) / 60000);
    }
  }

  // Status derivation
  let status = 'Scheduled';
  let statusLevel = 'sched';
  if (cancelled) {
    status = 'Cancelled'; statusLevel = 'cancel';
  } else if (diverted) {
    status = 'Diverted'; statusLevel = 'cancel';
  } else if (actIn) {
    status = 'Arrived'; statusLevel = 'done';
  } else if (actOut) {
    status = 'In Air'; statusLevel = 'now';
  } else if (delayMinutes >= 15) {
    status = 'Delayed'; statusLevel = 'delayed';
  } else if (delayMinutes <= -5) {
    // Earlier than scheduled — rare but possible
    status = 'On Time'; statusLevel = 'ontime';
  } else if (estOut && Date.parse(estOut) - Date.now() < 45 * 60 * 1000 && Date.parse(estOut) - Date.now() > 0) {
    status = 'Boarding'; statusLevel = 'now';
  } else if (delayMinutes !== 0) {
    status = 'On Time'; statusLevel = 'ontime';
  }

  return {
    status,
    statusLevel,
    scheduledOut: schedOut,
    estimatedOut: estOut,
    actualOut: actOut,
    scheduledIn: schedIn,
    estimatedIn: estIn,
    actualIn: actIn,
    delayMinutes,
    gateOrigin: f.gate_origin || null,
    gateDestination: f.gate_destination || null,
    terminalOrigin: f.terminal_origin || null,
    terminalDestination: f.terminal_destination || null,
    cancelled,
    diverted,
  };
}

function nextDay(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isoToLocalDate(iso, tz) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}
