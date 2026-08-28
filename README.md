# Arip Shit Adventure

Trip guide for **London → Normandy → Porto**, Oct 12–26 2026 (14 nights, 2 adults).

Static site, no build step, deployed via Cloudflare Pages. Content originates from the
verified itinerary export (`data/trip-data.json` — the same structured JSON embedded in
the "Export as Web App" download from the trip-planning app that built this itinerary),
but at runtime `app.js` reads it from an inline `<script id="trip-data">` JSON blob
embedded directly in `index.html` (same for `data/pins.json` → `<script id="pins-data">`),
not from a `fetch()` of the `data/` files themselves. **Any edit to `data/trip-data.json`
or `data/pins.json` must be re-embedded into `index.html`'s matching `<script>` tag, or the
live site won't reflect it.** `data/trip-data.min.json` is a minified mirror of
`trip-data.json`, kept for reference/diffing — nothing reads it at runtime either.

## Features

- Day-by-day itinerary rendered from the `trip-data` JSON embedded in `index.html` (sourced from `data/trip-data.json`)
- Live weather per city (Open-Meteo, free/keyless) — `data/pins.json` holds city coordinates
- Interactive map (Leaflet, vendored locally in `vendor/leaflet/` — no CDN dependency; tiles from OpenStreetMap's standard tile server, free and keyless. Previously used CartoDB's basemap tiles, which started requiring a signup-gated API key in 2026 and were watermarking unauthenticated requests "API KEY REQUIRED" — switched to OSM to stay genuinely keyless.)
- Location-aware local search (OpenStreetMap Overpass API — coffee/food/drinks/pharmacy near you or the city you're viewing)
- AI trip concierge chat — streams from the `wwii2026` route on the shared `jhwiv/cloudflare-worker` project (same worker that backs zurich-weekend.com), which itself calls Cloudflare Workers AI + Open-Meteo + Overpass server-side

## Coordinate accuracy

`data/pins.json` has a `_note` field with the current status. As of 2026-08-28, landmark and
hotel coordinates are verified via real TomTom geocoding/POI search (not the original
hand-estimated "general geographic knowledge" pass this started with — see `CLAUDE.md`'s
decisions log for the two-pass history). City-center pins are still a best-effort estimate
(a city center has no single correct point), and a few Douro Valley entries stay flagged
`"approx": true` (a winery/village doesn't have one exact door-front coordinate the way a
street address does). Every "Directions" link uses a Google Maps **text search** (not these
coordinates), so turn-by-turn navigation is accurate regardless of pin precision — verify
anything you're booking against, don't rely on the map pin alone.

## Local dev

```
python3 -m http.server 8910
```

No build step — plain HTML/CSS/JS.

## Deploy

Connect this repo to Cloudflare Pages (build command: none, output directory: `/`), same as
the zurich-weekend.com / zurich-pwa setup.
