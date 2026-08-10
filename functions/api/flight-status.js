// Cloudflare Pages Function: /api/flight-status
//
// Thin server-side proxy to the SAME shared flight-status Worker
// santafejune.com (and trip-optimizer) already use in production:
// https://flight-status.jhwiv-online.workers.dev/ — not a separate,
// locally-duplicated AeroAPI integration. Two reasons this is a proxy
// rather than a direct client-side fetch to that Worker:
//
// 1. The Worker's CORS allowlist (see jhwiv/santafe-itinerary's
//    worker/worker.js) only permits santafejune.com/trip-optimizer's own
//    origins — a browser-side fetch from aripshitadventure.com would be
//    silently blocked by CORS. A server-to-server fetch (this function
//    calling the Worker) isn't subject to browser CORS at all, so no
//    change to that shared, multi-consumer Worker or its allowlist is
//    needed just to add this site as a fourth caller.
// 2. This site's OWN previous implementation here duplicated the AeroAPI
//    call directly and needed its own separate AEROAPI_KEY secret in this
//    Pages project — which most likely was never actually configured
//    (nothing in this repo's setup docs mentions setting it), meaning the
//    feature was probably silently non-functional in production. It also
//    used a naive UTC-day-boundary window for the AeroAPI query, exactly
//    the bug the shared Worker's real history (see worker/worker.js's own
//    comments) already found and fixed once: a US-evening/UK-evening
//    departure that spills into the next UTC day can get matched against
//    the WRONG day's flight instance and misreport status (confirmed
//    real incident: a cancelled prior-day flight showing as today's
//    status). Proxying to the shared, already-fixed Worker gets that fix,
//    the beyondHorizon sentinel (AeroAPI's personal tier only resolves
//    ~2 days out — this trip is planned 60+ days ahead, so most calls
//    correctly report "not yet checkable" instead of a misleading
//    Unknown), and the mismatchedDate safety guard for free, and needs no
//    AEROAPI_KEY in THIS project at all.
//
// Usage: GET /api/flight-status?ident=UA934&date=2026-10-10&origin=EWR&destination=LHR
//   ident  — flight number (e.g. UA934). Required.
//   date   — YYYY-MM-DD departure date in origin TZ. Required.
//   origin / destination — airport codes, optional but recommended (lets
//     the Worker disambiguate a flight number that flies multiple legs on
//     the same day).
//
// Response: passed through verbatim from the shared Worker — see its own
// header comment for the full shape (ok, status, statusLevel,
// scheduledOut/estimatedOut/actualOut, beyondHorizon, mismatchedDate, ...).

const UPSTREAM = 'https://flight-status.jhwiv-online.workers.dev/';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const ident = (url.searchParams.get('ident') || '').trim().toUpperCase();
  const date = (url.searchParams.get('date') || '').trim();
  const origin = (url.searchParams.get('origin') || '').trim().toUpperCase();
  const destination = (url.searchParams.get('destination') || '').trim().toUpperCase();

  if (!/^[A-Z]{2,3}\d{1,4}$/.test(ident)) {
    return json({ ok: false, error: 'invalid ident' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: 'invalid date' }, 400);
  }

  const upstreamUrl = new URL(UPSTREAM);
  upstreamUrl.searchParams.set('ident', ident);
  upstreamUrl.searchParams.set('date', date);
  if (origin) upstreamUrl.searchParams.set('origin', origin);
  if (destination) upstreamUrl.searchParams.set('destination', destination);

  let upstream;
  try {
    // No Origin header set on a server-side fetch, so the shared Worker's
    // CORS allowlist check (which only affects the response header it
    // sends back, not whether it responds at all) is irrelevant here.
    upstream = await fetch(upstreamUrl.toString(), { headers: { 'Accept': 'application/json' } });
  } catch (err) {
    return json({ ok: false, error: 'flight-status worker fetch failed', detail: String(err) }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': upstream.headers.get('Cache-Control') || 'public, max-age=180',
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}
