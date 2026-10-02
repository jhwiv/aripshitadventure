// Cloudflare Pages Function: POST /api/chat
//
// Port of the wwii2026 concierge that used to live at
// jhwiv/cloudflare-worker src/index.js (POST /api/chat/wwii2026).
// That workers.dev hostname now serves the Railbird proxy and must not
// be redeployed. This function is same-origin, so the browser does not
// need that worker's CORS allowlist.
//
// Same model (@cf/meta/llama-3.3-70b-instruct-fp8-fast), same request
// fields (message, history, lat, lng, gpsStatus, localTime, activeTab),
// same SSE shape app.js already parses:
//   data: {"response":"..."}
//   data: [DONE]
//
// The itinerary block is built from functions/_lib/trip-data.js, a plain
// module generated from data/trip-data.json. It is not the worker's stale
// Nuremberg-era blob. The JSON file is not imported directly: the Pages
// function compiler rejects `with { type: 'json' }` and imports that leave
// the functions directory. Regenerate _lib when trip-data.json changes.
// The role text and the 3-option recommendation format are the wwii2026
// prompt; sentences that named Nuremberg / Oct 10–24 are updated so they
// match the itinerary the traveler is actually on.

import trip from '../_lib/trip-data.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const WX_CODES = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm',
};

// City centers match data/pins.json. Paris is the Oct 18 Moxy night
// (Clamart), which is not its own city tab.
const CITY_INFO = {
  London: { tz: 'Europe/London', lat: 51.5074, lng: -0.1278 },
  Normandy: { tz: 'Europe/Paris', lat: 49.2764, lng: -0.7024 },
  Porto: { tz: 'Europe/Lisbon', lat: 41.1579, lng: -8.6291 },
  Paris: { tz: 'Europe/Paris', lat: 48.8014, lng: 2.265 },
};

const WEATHER_LOCATIONS = [
  { ...CITY_INFO.London, label: 'LONDON' },
  { ...CITY_INFO.Paris, label: 'PARIS' },
  { ...CITY_INFO.Normandy, label: 'NORMANDY' },
  { ...CITY_INFO.Porto, label: 'PORTO' },
];

const GEO_CHECKS = [
  { ...CITY_INFO.London, radius: 0.5, label: 'They appear to be IN London right now.' },
  { ...CITY_INFO.Paris, radius: 0.35, label: 'They appear to be IN Paris / near Orly (Moxy Paris Clamart night) right now.' },
  { ...CITY_INFO.Normandy, radius: 0.6, label: 'They appear to be near Bayeux/Normandy right now.' },
  { ...CITY_INFO.Porto, radius: 0.5, label: 'They appear to be IN Porto right now.' },
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const ITINERARY_TEXT = buildItineraryText(trip);
const SCHEDULE = buildSchedule(trip);

const PLACE_HINTS = [
  { match: /\b(greek street|soho|heathrow|westminster|london)\b/i, city: 'London' },
  { match: /\b(bayeux|normandy|caen|omaha|arromanches|mont[- ]saint[- ]michel)\b/i, city: 'Normandy' },
  { match: /\b(porto|ribeira|douro|gaia|clerigos|clérigos)\b/i, city: 'Porto' },
  { match: /\b(orly|clamart|moxy|paris)\b/i, city: 'Paris' },
];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return sseText('The concierge could not read that message. Try again.');
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return sseText('Type a question and send it again.');
  if (message.length > 2000) return sseText('That message is too long. Shorten it and try again.');

  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    return sseText('The concierge is not configured on this deployment (Workers AI binding is missing).');
  }

  const lat = body.lat ?? body.latitude ?? null;
  const lng = body.lng ?? body.longitude ?? null;
  const clientLocalTime = body.localTime ?? null;
  const gpsStatus = body.gpsStatus ?? null;
  const activeTab = typeof body.activeTab === 'string' ? body.activeTab.slice(0, 80) : '';
  const history = Array.isArray(body.history) ? body.history : [];

  try {
    const now = new Date();
    const inferredLocation = getItineraryLocation(now);

    const weatherPromises = WEATHER_LOCATIONS.map((loc) => getWeather(loc.lat, loc.lng, loc.tz));

    let actualLocationWeatherPromise = null;
    let actualLocationLabel = null;
    const gpstz = inferredLocation?.timezone || 'Europe/London';
    if (isCoord(lat) && isCoord(lng)) {
      const covered = WEATHER_LOCATIONS.some((loc) => Math.hypot(lat - loc.lat, lng - loc.lng) < 0.3);
      if (!covered) {
        actualLocationWeatherPromise = getWeather(lat, lng, gpstz);
        actualLocationLabel = 'YOUR CURRENT LOCATION';
      }
    } else if (inferredLocation?.lat != null) {
      const covered = WEATHER_LOCATIONS.some(
        (loc) => Math.hypot(inferredLocation.lat - loc.lat, inferredLocation.lng - loc.lng) < 0.3
      );
      if (!covered) {
        actualLocationWeatherPromise = getWeather(
          inferredLocation.lat, inferredLocation.lng, inferredLocation.timezone
        );
        actualLocationLabel = inferredLocation.city.toUpperCase() + ' (CURRENT LOCATION)';
      }
    }

    let nearbyPlacesPromise = null;
    let queryLocation = null;
    if (isRecommendationQuery(message)) {
      queryLocation = resolveQueryLocation(message);
      const searchLat = queryLocation?.lat ?? (isCoord(lat) ? lat : null) ?? inferredLocation?.lat;
      const searchLng = queryLocation?.lng ?? (isCoord(lng) ? lng : null) ?? inferredLocation?.lng;
      if (searchLat != null && searchLng != null) {
        nearbyPlacesPromise = getNearbyPlaces(searchLat, searchLng, getCategoriesFromMessage(message));
      }
    }

    const [weatherResults, actualLocationWeather, nearbyPlaces] = await Promise.all([
      Promise.all(weatherPromises),
      actualLocationWeatherPromise,
      nearbyPlacesPromise,
    ]);

    let wxSummary = '';
    for (let i = 0; i < weatherResults.length; i++) {
      if (weatherResults[i]) wxSummary += formatWeather(weatherResults[i], WEATHER_LOCATIONS[i].label);
    }
    if (actualLocationWeather && actualLocationLabel) {
      wxSummary += formatWeather(actualLocationWeather, actualLocationLabel);
    }

    const locationNote = buildLocationNote({
      queryLocation, lat, lng, gpsStatus, inferredLocation, activeTab,
    });
    const localTime = formatLocalTime(clientLocalTime, now, inferredLocation?.timezone || 'Europe/London');
    const systemPrompt = buildPrompt(wxSummary, locationNote, localTime, inferredLocation, formatPlacesForPrompt(nearbyPlaces));

    const msgs = [{ role: 'system', content: systemPrompt }];
    for (const h of history.slice(-8)) {
      if (!h || (h.role !== 'user' && h.role !== 'assistant')) continue;
      if (typeof h.content !== 'string' || !h.content) continue;
      msgs.push({ role: h.role, content: h.content.slice(0, 4000) });
    }
    msgs.push({ role: 'user', content: message });

    const result = await env.AI.run(MODEL, {
      messages: msgs,
      max_tokens: 800,
      stream: true,
    });

    if (result && typeof result === 'object' && typeof result.response === 'string' && typeof result.getReader !== 'function') {
      return sseText(result.response);
    }
    const stream = (result && typeof result.getReader === 'function') ? result : null;
    if (!stream) {
      return sseText('The concierge got an unexpected reply from Workers AI. Try again in a moment.');
    }
    return new Response(stream, {
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    const detail = err && err.message ? err.message : 'unknown error';
    return sseText('The concierge could not reach Workers AI (' + detail.slice(0, 180) + '). Try again in a moment.');
  }
}

function sseText(text) {
  const payload = `data: ${JSON.stringify({ response: text })}\n\ndata: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}

function isCoord(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function buildPrompt(wxSummary, locationNote, localTime, inferredLocation, nearbyPlacesContext) {
  const timeLabel = inferredLocation?.city || 'local time';
  return `You are a knowledgeable, friendly travel concierge for a trip through London, Normandy, and Porto (Mon Oct 12 – Mon Oct 26, 2026; 14 nights; 2 adults, Jonathan and Benjamin Ripchick), with a cultural WWII-history focus for the London and Normandy legs and a relaxed wine-country finish in Porto. You are embedded in the trip's guide website.

CRITICAL: Pay close attention to the traveler's CURRENT LOCATION and TIME. Do NOT assume they are in any particular city unless the location data confirms it. They may be browsing any day of the itinerary regardless of where they physically are. If the trip has not started yet, answer from the itinerary for the days they ask about.

CURRENT DATE/TIME (${timeLabel}): ${localTime}
${locationNote}
${nearbyPlacesContext ? '\n' + nearbyPlacesContext + '\n' : ''}
${wxSummary}

FULL ITINERARY:
${ITINERARY_TEXT}

YOUR ROLE:
- Help the traveler decide what to do next based on: the itinerary, current time, weather, and their location.
- Be specific — use times, venue names, confirmation numbers, and lodging names from the itinerary.
- For the WWII sites that are actually on the plan (Churchill War Rooms, Imperial War Museum, Operation Mincemeat, Hamilton, the London Walks, Objective Normandy / the American Sector), give context that helps the visit land, not just logistics.
- Reference restaurants and bookings by name and the day they're booked. If a meal is TBD in the itinerary, say so rather than inventing a reservation.
- London lodging is the Airbnb at 53 Greek Street (HMFRRRZRTN). Bags may stay there until the 12:00 PM departure for Heathrow on Oct 18.
- The night of Sun Oct 18 is Moxy Paris Clamart (confirmation 83193251), after BA8137 LHR to ORY. Mon Oct 19 departs the Moxy at 8:00 AM.
- Normandy lodging is 4 Rue Franche, Bayeux (Airbnb HMKWYPDKBE). Objective Normandy is Wed Oct 21, 9:00 AM–5:00 PM, meet at the apartment. Do not move it.
- Porto lodging is Rua dos Mercadores 77, Ribeira (Airbnb HM549AK8C2). The return flight is TAP TP211 OPO to EWR on Mon Oct 26.
- The Douro Valley day (Sat Oct 24) is a long day — don't suggest the travelers drive themselves unless the itinerary already says a driver or car is arranged.
- This trip does not include Nuremberg, a cross-Channel ferry, or a rental car. Do not invent those.
- Keep answers concise — 2-4 short paragraphs max. Use natural language, not bullet lists, except for the recommendation format below.
- You can respond in English or match the traveler's language.

LOCAL RECOMMENDATIONS (IMPORTANT):
- When a VERIFIED NEARBY PLACES list is provided above, you MUST recommend ONLY from that list. Do not recommend places not on the list. These are confirmed to exist (hours may still be unverified).
- If no verified list is provided, use your general knowledge but note that opening hours should be confirmed.
- Provide exactly 3 options. Each MUST include: a clickable Google Maps link, a one-sentence description of what makes the place good, and the estimated walk time.
- Format EXACTLY like this (the description sentence is mandatory, never omit it):
  [Name of Place](https://maps.google.com/?q=Place+Name+City) — One sentence describing the vibe, specialty, or what to order. ~X min walk.
- The description must tell the traveler WHY this place is worth visiting — mention the food, atmosphere, or specialty.
- Pick well-known, highly-rated, real establishments. Prioritize places that are likely open at the current time of day.
- NEVER say "I don't have specific recommendations" or "ask the hotel staff" — you are the concierge, give real answers.
- Do NOT fabricate place names, but DO use your real knowledge of well-known establishments in these cities.`;
}

function buildLocationNote({ queryLocation, lat, lng, gpsStatus, inferredLocation, activeTab }) {
  let locationNote = '';
  if (queryLocation) {
    locationNote = `QUERY CONTEXT: The user is asking about "${queryLocation.label}" — focus your answer and any recommendations on THAT place, not on the traveler's current position.`;
    if (isCoord(lat) && isCoord(lng)) {
      locationNote += ` (Their actual GPS is ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}, but the question is about a different place/day on the itinerary.)`;
    }
  } else if (isCoord(lat) && isCoord(lng)) {
    locationNote = `USER'S CURRENT GPS: ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}.`;
    let matched = false;
    for (const check of GEO_CHECKS) {
      if (Math.hypot(lat - check.lat, lng - check.lng) < check.radius) {
        locationNote += ' ' + check.label;
        matched = true;
        break;
      }
    }
    if (!matched && inferredLocation?.city) {
      locationNote += ` Based on itinerary, they should be in/near ${inferredLocation.city}. ${inferredLocation.note}`;
    } else if (!matched) {
      locationNote += ' They are not near a known itinerary stop.';
    }
  } else if (inferredLocation?.city) {
    const gpsReason = gpsStatus === 'denied'
      ? 'GPS permission was denied by the user — do NOT ask them to share their location.'
      : 'GPS is not available.';
    locationNote = `USER LOCATION: ${gpsReason} Based on the itinerary schedule, the traveler should currently be in ${inferredLocation.city}. ${inferredLocation.note}`;
  } else {
    const gpsReason = gpsStatus === 'denied'
      ? 'GPS permission was denied by the user — do NOT ask them to share their location.'
      : 'GPS is not available.';
    locationNote = `USER LOCATION: ${gpsReason} ${inferredLocation?.note || 'Location is unknown — make reasonable assumptions based on the itinerary and current date.'}`;
  }
  if (activeTab) {
    locationNote += `\nThe user is currently viewing the "${activeTab}" section of the itinerary (this does NOT necessarily reflect their physical location).`;
  }
  return locationNote;
}

function formatLocalTime(clientLocalTime, now, timeZone) {
  const formatOpts = {
    timeZone, weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  };
  if (clientLocalTime) {
    try {
      return new Date(clientLocalTime).toLocaleString('en-US', formatOpts);
    } catch { /* fall through */ }
  }
  return now.toLocaleString('en-US', formatOpts);
}

function getItineraryLocation(nowUTC) {
  const nowISO = nowUTC.toISOString();
  for (const seg of SCHEDULE) {
    if (nowISO >= seg.from && nowISO < seg.to) return seg;
  }
  if (!SCHEDULE.length) return null;
  if (nowISO < SCHEDULE[0].from) {
    return { city: null, timezone: null, lat: null, lng: null, note: 'The trip has not started yet. The traveler is likely planning ahead. First day is Mon Oct 12, 2026 (BA184 EWR to LHR that evening).' };
  }
  if (nowISO >= SCHEDULE[SCHEDULE.length - 1].to) {
    return { city: null, timezone: null, lat: null, lng: null, note: 'The trip is over. The traveler has returned home.' };
  }
  return null;
}

function isRecommendationQuery(message) {
  return /\b(breakfast|brunch|lunch|dinner|coffee|café|cafe|eat|restaurant|bar|pub|drink|food|recommend|suggestion|where should|good place|nearby|snack|bakery|pastry|grocery|supermarket|pharmacy|gelato|ice cream)\b/i.test(message);
}

function resolveQueryLocation(message) {
  for (const hint of PLACE_HINTS) {
    if (hint.match.test(message)) {
      const info = CITY_INFO[hint.city];
      return { lat: info.lat, lng: info.lng, timezone: info.tz, label: hint.city };
    }
  }
  const dayMatch = message.match(/\bday\s*(\d{1,2})\b/i);
  if (dayMatch) {
    const seg = SCHEDULE[Number(dayMatch[1]) - 1];
    if (seg && seg.lat != null) {
      return { lat: seg.lat, lng: seg.lng, timezone: seg.timezone, label: seg.note };
    }
  }
  const dateMatch = message.match(/\boct(?:ober)?\s*(\d{1,2})\b/i);
  if (dateMatch) {
    const dayNum = Number(dateMatch[1]);
    const seg = SCHEDULE.find((s) => s.dateMonth === 10 && s.dateDay === dayNum);
    if (seg && seg.lat != null) {
      return { lat: seg.lat, lng: seg.lng, timezone: seg.timezone, label: seg.note };
    }
  }
  return null;
}

function getCategoriesFromMessage(message) {
  const msg = message.toLowerCase();
  if (/\b(breakfast|brunch|coffee|café|cafe|bakery|pastry)\b/.test(msg)) return 'cafe|restaurant|bakery';
  if (/\b(bar|pub|drink)\b/.test(msg)) return 'bar|pub';
  if (/\b(pharmacy)\b/.test(msg)) return 'pharmacy';
  if (/\b(lunch|dinner|eat|food|restaurant)\b/.test(msg)) return 'restaurant|cafe';
  return 'cafe|restaurant|bar';
}

async function getWeather(lat, lng, tz) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lng}`
    + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation'
    + '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(tz)}&forecast_days=3`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const current = {
      temp: Math.round(data.current.temperature_2m),
      humidity: data.current.relative_humidity_2m,
      condition: WX_CODES[data.current.weather_code] || 'Mixed',
      windMph: Math.round(data.current.wind_speed_10m),
      precipitation: data.current.precipitation,
    };
    const now = new Date();
    const hourly = [];
    if (data.hourly && data.hourly.time) {
      for (let i = 0; i < data.hourly.time.length && hourly.length < 6; i++) {
        const t = new Date(data.hourly.time[i]);
        if (t >= now) {
          hourly.push({
            hour: t.getHours(),
            temp: Math.round(data.hourly.temperature_2m[i]),
            condition: WX_CODES[data.hourly.weather_code[i]] || 'Mixed',
            rainChance: data.hourly.precipitation_probability[i],
            windMph: Math.round(data.hourly.wind_speed_10m[i]),
          });
        }
      }
    }
    const daily = [];
    if (data.daily && data.daily.time) {
      for (let i = 0; i < data.daily.time.length; i++) {
        daily.push({
          date: data.daily.time[i],
          hi: Math.round(data.daily.temperature_2m_max[i]),
          lo: Math.round(data.daily.temperature_2m_min[i]),
          condition: WX_CODES[data.daily.weather_code[i]] || 'Mixed',
          rainChance: data.daily.precipitation_probability_max[i],
        });
      }
    }
    return { current, hourly, daily };
  } catch {
    return null;
  }
}

function formatWeather(wx, label) {
  if (!wx) return '';
  let s = `\n\n${label} WEATHER: ${wx.current.temp}°F, ${wx.current.condition}, Wind ${wx.current.windMph} mph, Humidity ${wx.current.humidity}%.`;
  if (wx.hourly.length > 0) {
    s += '\nNEXT HOURS:';
    for (const h of wx.hourly) {
      s += `\n  ${h.hour}:00 — ${h.temp}°F, ${h.condition}, ${h.rainChance}% rain, Wind ${h.windMph} mph`;
    }
  }
  if (wx.daily.length > 0) {
    s += '\nDAILY FORECAST:';
    for (const d of wx.daily) {
      s += `\n  ${d.date}: Hi ${d.hi}°F / Lo ${d.lo}°F, ${d.condition}, ${d.rainChance}% rain`;
    }
  }
  return s;
}

const CHAT_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function getNearbyPlaces(lat, lng, categories) {
  // Same two mirrors the original wwii2026 handler tried. The public
  // /api/nearby route is the one with the full mirror list and cache.
  const safeCat = String(categories).replace(/[^a-z|]/g, '');
  const query = `[out:json][timeout:8];(node["amenity"~"${safeCat}"]["name"](around:800,${lat},${lng}););out body 15;`;
  for (const endpoint of CHAT_OVERPASS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'aripshitadventure-chat/1.0 (trip guide)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.elements || !data.elements.length) continue;
      const places = [];
      for (const el of data.elements) {
        const tags = el.tags || {};
        if (!tags.name) continue;
        const placeLat = el.lat != null ? el.lat : (el.center && el.center.lat);
        const placeLng = el.lon != null ? el.lon : (el.center && el.center.lon);
        if (placeLat == null || placeLng == null) continue;
        const dist = haversineMeters(lat, lng, placeLat, placeLng);
        places.push({
          name: tags.name,
          type: tags.amenity || 'place',
          address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
          distance: dist,
          walkTime: walkTimeLabel(dist),
        });
      }
      places.sort((a, b) => a.distance - b.distance);
      return places.slice(0, 8);
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

function formatPlacesForPrompt(places) {
  if (!places || !places.length) return '';
  const lines = ['VERIFIED NEARBY PLACES (from OpenStreetMap, hours unverified):'];
  places.forEach((p, i) => {
    const addr = p.address ? ` — ${p.address}` : '';
    lines.push(`${i + 1}. ${p.name} — ${p.type}${addr} — hours unverified — ${p.walkTime}`);
  });
  lines.push('');
  lines.push('IMPORTANT: When recommending places, STRONGLY PREFER places from this verified list. These are confirmed to exist. Include Google Maps links formatted as [Name](https://maps.google.com/?q=Name+City).');
  return lines.join('\n');
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function walkTimeLabel(meters) {
  const minutes = Math.round((meters * 1.4) / 67);
  return minutes < 2 ? '~2 min walk' : `~${minutes} min walk`;
}

function buildItineraryText(data) {
  const lines = [];
  lines.push(data.destination || '');
  if (data.meta) lines.push(data.meta);
  lines.push('');
  lines.push('CITIES:');
  for (const c of data.cities || []) {
    lines.push(`- ${c.name} (${c.nights} nights, ${c.days_range}). Stay: ${c.stay}`);
    if (c.transport_in) lines.push(`  Getting there: ${clip(c.transport_in, 500)}`);
    if (c.focus) lines.push(`  Focus: ${clip(c.focus, 300)}`);
  }
  if (data.introduction && data.introduction.arc) {
    lines.push('');
    lines.push('OVERVIEW:');
    lines.push(data.introduction.arc);
  }
  lines.push('');
  lines.push('DAY BY DAY:');
  (data.days || []).forEach((day, i) => {
    lines.push(`Day ${i + 1} · ${day.city} · ${day.label}`);
    if (day.headline) lines.push('Headline: ' + day.headline);
    for (const item of day.items || []) {
      const bits = [item.time, item.end_time ? 'until ' + item.end_time : '', item.type, item.text].filter(Boolean);
      lines.push('- ' + clip(bits.join(' · '), 360));
    }
    lines.push('');
  });
  let text = lines.join('\n');
  if (text.length > 24000) text = text.slice(0, 24000) + '\n…';
  return text;
}

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function parseDayDate(label, index) {
  const m = String(label || '').match(/·\s+[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    if (month && day) return { year: 2026, month, day };
  }
  const dt = new Date(Date.UTC(2026, 9, 12 + index));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function addDays(year, month, day, n) {
  const dt = new Date(Date.UTC(year, month - 1, day + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

// UTC instant of local midnight in `timeZone`. Intl offset is applied
// twice so a DST transition doesn't leave the guess an hour off.
function localMidnightISO(year, month, day, timeZone) {
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - tzOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc).toISOString().replace('.000Z', 'Z');
}

function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = Number(map.hour) % 24;
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asUTC - date.getTime();
}

function buildSchedule(data) {
  const days = data.days || [];
  const segs = days.map((day, index) => {
    const info = CITY_INFO[day.city] || CITY_INFO.London;
    const date = parseDayDate(day.label, index);
    const next = addDays(date.year, date.month, date.day, 1);
    return {
      from: localMidnightISO(date.year, date.month, date.day, info.tz),
      to: localMidnightISO(next.year, next.month, next.day, info.tz),
      city: day.city,
      timezone: info.tz,
      lat: info.lat,
      lng: info.lng,
      dateMonth: date.month,
      dateDay: date.day,
      note: `Day ${index + 1}: ${day.headline || day.label}`,
    };
  });
  // Snap each segment's end to the next segment's start so a London/Paris
  // or Paris/Lisbon offset change doesn't leave a gap or an overlap.
  for (let i = 0; i < segs.length - 1; i++) segs[i].to = segs[i + 1].from;
  return segs;
}
