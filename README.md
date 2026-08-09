# Arip Shit Adventure

Trip guide for **London → Normandy → Nuremberg → Porto**, Oct 10–24 2026 (14 nights, 2 adults).

Static site, no build step, deployed via Cloudflare Pages. Content is sourced directly from
the verified itinerary export (`data/trip-data.json` — the same structured JSON embedded in
the "Export as Web App" download from the trip-planning app that built this itinerary).

## Features

- Day-by-day itinerary rendered from `data/trip-data.json` at runtime
- Live weather per city (Open-Meteo, free/keyless) — `data/pins.json` holds city coordinates
- Interactive map (Leaflet + free CartoDB tiles, vendored locally in `vendor/leaflet/` — no CDN dependency, no API key)
- Location-aware local search (OpenStreetMap Overpass API — coffee/food/drinks/pharmacy near you or the city you're viewing)
- AI trip concierge chat — streams from the `wwii2026` route on the shared `jhwiv/cloudflare-worker` project (same worker that backs zurich-weekend.com), which itself calls Cloudflare Workers AI + Open-Meteo + Overpass server-side

## Coordinate accuracy

`data/pins.json` has a `_note` field: coordinates are best-effort from general geographic
knowledge (no live geocoding was available when this was built). City-center and major-landmark
pins are high confidence; a few Douro Valley/restaurant pins are marked `"approx": true`.
Every "Directions" link uses a Google Maps **text search** (not these coordinates), so
turn-by-turn navigation is accurate regardless of pin precision — verify anything you're
booking against, don't rely on the map pin alone.

## Local dev

```
python3 -m http.server 8910
```

No build step — plain HTML/CSS/JS.

## Deploy

Connect this repo to Cloudflare Pages (build command: none, output directory: `/`), same as
the zurich-weekend.com / zurich-pwa setup.
