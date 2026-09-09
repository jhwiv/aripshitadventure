# Code-level QA + peer review — aripshitadventure

**Repo:** [jhwiv/aripshitadventure](https://github.com/jhwiv/aripshitadventure) (source for aripshitadventure.com)
**Reviewed:** `main` @ `98bc1f7` (2026-09-09)
**Scope:** this PWA only. trip-optimizer / RouteSmith were not reviewed as products. Coupling risks are noted in §7.
**Method:** static review of `app.js` / `index.html` / `style.css` / `sw.js` / `functions/` / data files, plus a structural itinerary QA script and a **full prose fact-check sweep** (WebSearch on every falsifiable claim, not a sample). Live production was not reachable from this sandbox (egress to aripshitadventure.com is blocked); nothing here is a “live site” check.

**Verdict:** the shell is mature and most of the historical failure modes in `CLAUDE.md` stay fixed (nights math on city cards, weather-string shape, duration_min, reservation badges, sticky clearance). The remaining problems are concentrated in **hardcoded parallel itineraries** (`ACTIONS`, History, packing, Essentials), a **Day 7 car/ferry contradiction**, a **wrong flight number on the booking timeline**, **stale entry-requirement copy**, and **offline/PWA gaps** that the welcome screen still promises as solid.

This pass is docs-only. No refactors.

---

## 1. Program / architecture

### 1.1 Runtime data loading — the JSON is not what the site reads

`app.js` parses inline blobs, not `data/*.json`:

```4:5:app.js
  var TRIP = JSON.parse(document.getElementById('trip-data').textContent);
  var PINS = JSON.parse(document.getElementById('pins-data').textContent);
```

`README.md` is correct about this. This review confirmed byte-level equality: `data/trip-data.json` == `#trip-data` embed, `data/pins.json` == `#pins-data` embed, and `data/trip-data.min.json` == the pretty file. That is healthy *today*. The pipeline risk is that three copies exist and nothing in CI asserts they match. `data/trip-data.min.json` is unused at runtime.

There is **no generator in this repo**. `CLAUDE.md` still describes `build_trip_data.py` / `assemble.py` / re-embed as the ingestion path; those scripts are not present. Edits now happen by hand (or by session-local scripts that never land). That is the RouteSmith-export coupling: the original “Export as Web App” JSON shape is still the schema, but the publish path is copy-paste into `index.html`. Drift is a human process bug, not a build bug.

### 1.2 Hardcoded second itinerary in `app.js`

A large fraction of traveler-facing “truth” is **not** in `TRIP`:

| Surface | Source | Drift risk |
|---|---|---|
| Book & Confirm timeline | `ACTIONS` in `app.js` ~1379–1440 | High — already wrong (TP1094) |
| History tab | `entries` in `app.js` ~1250–1258 | High — day tags are hand-mapped |
| Essentials / apps / ETIAS | `app.js` ~1090–1141 | High — ETIAS copy is stale |
| City transit tips | `app.js` ~1209–1227 | Medium |
| Packing list | hardcoded in `index.html` ~351–423 | Medium |
| Chat concierge | `CHAT_API` → shared Worker `wwii2026` | High — separate repo |

`renderBookingActions` even documents that ACTIONS is “curated, not derived from a data field” (`app.js` 1363–1374). That is honest and also why Book & Confirm can contradict `trip-data.json` with no compile error.

### 1.3 PWA / service worker / offline

`sw.js` is thoughtful (precache by parsing `index.html` so `?v=` stamps stay in sync; skip third-party and `/api/`). Remaining holes:

1. **Hero/banner photos are not discovered.** The install parser only matches `<script src>` / `<link href>` (`sw.js` 51–57). City banners are inline `background-image:url('images/banner-….jpg')` in `index.html` 257–279; hero photos are JS strings in `HERO_PHOTOS` (`app.js` 26–29). Offline, the itinerary text can load while every photo 404s.

2. **Google Fonts are third-party and skipped on purpose** (`sw.js` 55). Offline, the UI falls back to Georgia/serif. Fine, but the welcome-screen “save this before you land” copy (`index.html` 90) oversells how complete the offline app is.

3. **Network-first caches every same-origin GET, including errors** (`sw.js` 90–99). A transient 502 on `/app.js` or a 404 can be stored and then served offline.

4. **Offline fallback returns `index.html` for any miss** (`sw.js` 96–98). A missing `style.css?v=…` or `vendor/leaflet/leaflet.js` is served as HTML. The browser then tries to execute markup as JS/CSS.

5. **`CACHE_NAME` is still `trip-cache-v4`** (`sw.js` 26) after many content deploys. Activate does delete other names, so this is only a problem if install fails partway — but the comment history shows that exact failure mode already happened once.

6. **`/vendor/*` is `immutable` for a year** (`_headers` 32–33) with **no `?v=` on Leaflet** (`index.html` 3137–3138). `app.js`/`style.css` are cache-busted; Leaflet is not. A Leaflet upgrade can stick in browsers for 31536000 seconds.

7. **`manifest.json` has no `maskable` icon** and no screenshots. Android adaptive-icon crop will slice the Mont-Saint-Michel photo. `start_url` is `/` (good). `apple-mobile-web-app-capable` is present; the newer `mobile-web-app-capable` is not.

8. **Install UX is `alert()` copy, not `beforeinstallprompt`** (`index.html` 72–85). On Chrome/Android this ignores the native install prompt. Not broken, just a dead-end control that looks like an install button.

### 1.4 Maps / weather / chat

- **Weather** (`app.js` 1470–1514): Open-Meteo, keyless, degrades to “Weather unavailable”. City-card weather is *today in that city*, not the day’s October forecast in `day.weather`. Two different “weather” products sit next to each other with no label that one is live-now and the other is a static October sketch. Day 1’s `day.weather` is written for a Newark evening (`data/trip-data.json` 39) while `day.city` is `London`.

- **Map** (`app.js` 1517–1618): Leaflet vendored (good). Comment still says “free CartoDB tiles” (`app.js` 1518) after the OSM switch. **OSMF tile usage policy** ([operations.osmfoundation.org/policies/tiles](https://operations.osmfoundation.org/policies/tiles/)) asks production sites not to treat `tile.openstreetmap.org` as a CDN. This site moved *onto* that endpoint after CARTO started watermarking. Low traffic may be tolerated; a block looks like the last map outage.

- **Chat** (`app.js` 9, 1842–1853): browser POSTs directly to `https://cloudflare-worker.jhwiv-online.workers.dev/api/chat/wwii2026` with `lat`/`lng`. Unlike flight-status, there is **no Pages Function proxy**. If that Worker’s CORS allowlist or `wwii2026` itinerary blob is stale (CLAUDE.md already notes Nuremberg still in the Worker as of 2026-08-21), the concierge can answer from a different trip than this page. Chat is also the only feature that will fail entirely when the Worker is down; the UI copy does handle that.

- **Share:** there is no Web Share API, no copy-link, no `og:` tags beyond a generic description. Nothing to review except the absence.

### 1.5 Flight-status proxy

`functions/api/flight-status.js` is a thin allowlisted proxy. Ident/date are regex-checked. `Access-Control-Allow-Origin: *` (line 83) makes this Pages Function an open proxy to the shared Worker for anyone who can guess `UA940` + a date. Ident validation limits SSRF; it does not limit quota burn on the upstream AeroAPI-backed Worker.

`dayDateISO` (`app.js` 1273–1278) feeds the `date=` query. See §2.2 — the date can be **yesterday** in UK/EU timezones because of `toISOString()`.

---

## 2. Logical inconsistencies

### 2.1 Day 7 rental car vs “no rental car in Normandy” — traveler-facing contradiction

Three mutually incompatible stories ship in the same itinerary:

1. Day 7 07:30 item: **“Pick up rental car and depart for Bovington”** (`data/trip-data.json` 1081–1083). Book & Confirm repeats it as an action (`app.js` 1406–1408).
2. Same day’s ferry `why`: **“This plan has no rental car in Normandy — the private drivers/guide … suggest foot-passenger travel”** (`data/trip-data.json` 1176).
3. History tab Day 8: **“it sits on this day’s self-drive route”** (`app.js` 1255). Transit tip: “A private driver or rental car is the practical way” (`app.js` 1217).

There is **no rental-car return / Portsmouth drop-off item**. A traveler following Book & Confirm will pick up a car in London, drive to Portsmouth, then be told at ferry check-in they are a foot passenger. Foot vs vehicle is a different Brittany Ferries product and check-in line. This is the highest-severity logistics bug in the current build.

Orphaned comment at `app.js` 627–629 still asserts “The user is driving themselves, not hiring a private driver” above `resolveDayHotelName` — leftover from the walked-back `humanizeTransportText` transform. Dead comment, live confusion.

### 2.2 `dayDateISO()` is UTC-sliced local midnight

```1273:1278:app.js
  var TRIP_START = new Date(2026, 9, 12); // Oct 12 2026, confirmed against day labels
  function dayDateISO(dayIndex) {
    var d = new Date(TRIP_START);
    d.setDate(d.getDate() + dayIndex);
    return d.toISOString().slice(0, 10);
  }
```

`new Date(2026, 9, 12)` is **local** midnight. `.toISOString()` is UTC. On 12 Oct 2026 the UK is still on BST (UTC+1; DST ends 25 Oct 2026). Local midnight is `2026-10-11T23:00:00.000Z` → **`2026-10-11`**.

Used by: flight-status dates, Book & Confirm “visit in N days”, time-pill zone table (`app.js` 1929–1944). A traveler opening the app in London/Paris/Porto gets every derived calendar date one day early until they hit a UTC-offset ≥ 0 at midnight (this sandbox is UTC, so it would not reproduce). Countdown (`app.js` 517) uses local `Date` arithmetic and is fine; the two clocks can disagree.

### 2.3 Nights math — city cards are correct; hotel-event derivation is not

City-card total uses `days.length - 1` = 14 (`app.js` 536–548). `cities[].nights` sum to 12 (5+3+4) plus 2 transit nights, matching `TRIP.meta`. Weekday labels all match `datetime` for Oct 12–26 2026 (Mon start). **Good.**

Hotel-event derivation (the playbook’s preferred night-count method) **misses London checkout**: Day 7 “Check out of Airbnb rental” has `"hotel": null` (`data/trip-data.json` 1065–1073). Air & Hotel / Essentials hotel cards merge by `item.hotel.name`, so London **never shows a checkout time**. Bayeux and Porto check-out objects are populated.

London Airbnb and Porto Airbnb still have no map pins (`pins.json` `hotels` only has Bayeux). Map therefore shows one lodging marker for a three-city trip.

### 2.4 Flight objects vs Book & Confirm vs live schedules

| Leg | Data | Book & Confirm (`app.js` 1437–1438) | External check (2026-09-09) |
|---|---|---|---|
| EWR→LHR | UA940, 21:00→09:20, 7h 15m, 767-300ER | UA940 | **Real.** Sep 8–Oct 23 2026 window is 21:00 EWR → 09:20 LHR, 7h 20m, 767-300. Duration is 5 min short of published block. |
| CDG→OPO | Air France, **`flight_number: null`**, 13:00→14:20, 2h 20m | **TP1094** | **TP1094 is TAP Lisbon→Valencia, not this trip.** CDG–OPO nonstop is Air France (AF1428 / AF1528 / AF1516…). Current published midday is ~14:00 (AF1528), not 13:00. |
| OPO→EWR | UA145, 12:35→17:00, 8h 25m, 767-300ER | UA145 | **Route/number real.** Current 2026 ops are typically 757-200, ~7h55m, arriving ~15:30–15:50 EDT in summer. Oct 26 is after EU DST (25 Oct) so the 17:00 internal arithmetic can be self-consistent and still not match the published winter schedule. |

Both United objects still carry `"_modelEstimatedFlightNumber": true`, so the UI banners “not checked against a live schedule” (`app.js` 700–702, 1299) even though the numbers are the real scheduled flights. That is conservative, not false — but it sits next to a **fabricated TAP number** on the same Book & Confirm list.

UA940 arithmetic: 21:00 EDT + 7h15m = 09:15 BST, claimed 09:20. Five minutes; published block is 7h20m. P2 vs the TP1094 P0.

### 2.5 UI labels vs behavior

- **Local search copy:** “uses your GPS if allowed, otherwise the city you're viewing” (`index.html` 470). Implementation:

```1652:1660:app.js
  function currentCityCoords() {
    // Whichever city tab is currently active; otherwise default to London.
    var activeSection = document.querySelector('.tab-section.active');
    ...
    return PINS.cities.London;
  }
```

Only `#tab-condensed` has class `active` in markup (`index.html` 209). Scroll-spy toggles **`.nav-chip.active`**, not `.tab-section.active` (`app.js` 409–420). After the continuous-scroll rebuild, **every tab-section is `display:block`** (`style.css` 275). Denied GPS ⇒ always London, including on the Porto tab. Chat `activeTab` (`app.js` 1852) has the same bug — the Worker is always told `tab-condensed`.

- **Day 6 label** is still **“Thames Cruise & Disastrous London Walk”** (`data/trip-data.json` 861). The item is a London Walks *walking* tour; `why` even says “not a boat ride, despite the name” (line 885). Headline: “Thames from Embankment”. Condensed tab + day banner still say Cruise.

- **History tab disclaimer** (`index.html` 321): “AI-authored general historical context, **not independently verified**.” The renderer comment (`app.js` 1248–1249) says the opposite — claims *were* verified. Travelers are told to distrust the one tab that (mostly) checks out; meanwhile Book & Confirm is presented as researched and contains TP1094.

- **Navigate welcome tile** goes to `#tab-transit` (`index.html` 62–63), which is a reference list, not the per-item Google/Apple/Waze row. Easy to think “Navigate” starts turn-by-turn.

- **No share control.** Nothing labeled Share exists except the iOS “Add to Home Screen” alert, which is instructions, not sharing the itinerary.

### 2.6 Pins / locations

Locations in `trip-data.json` with **no** `pins.json` landmark:

- `American Cemetery, 14710 Colleville-sur-Mer` (pins key adds `, France`)
- `His Majesty's Theatre, Haymarket, London SW1Y 4QL`
- `Victoria Palace Theatre, Victoria St, London SW1E 5EA`

`LANDMARK_DISPLAY_NAMES` / map markers key on exact strings (`app.js` 49–71, 1560–1563). Phantom and Hamilton never get map pins. The cemetery pin exists under a slightly different key, so Day 8’s location string does not bind to it (directions still work via text search).

`guessCityForLandmark` still matches `bletchley` (`app.js` 1590) after Bletchley was dropped from the itinerary.

### 2.7 Dead fields (render-path audit)

`booking_note` appears throughout `trip-data.json` and **zero times in `app.js`**. Same for `contact.hours` / `contact.price` on Activity items (restaurant `contact.hours` *does* render via `restaurantDetailLines`). Walk IDs were correctly folded into `why` (which renders); leftover `booking_note` on the Thames walk still contains editorial “replaces an earlier placeholder City Cruises” (`data/trip-data.json` 889) that a future renderer would dump onto the phone.

`verify_status` / `verify_url` are also unrendered. Harmless except `verify_url` still concatenates the trip route into the Google query (`…London → Normandy → Porto`), producing ugly Maps searches.

---

## 3. UI / UX code smells

| Issue | Where | Why it matters |
|---|---|---|
| Nav chips `min-height: 28px` / `9.5px` font below 480px | `style.css` 215–216 | Under 44×44pt. 10 chips, two rows, easy mis-tap. |
| Day-tab cards 40×40 | `style.css` 247 | Same, 15 targets. |
| Welcome feature tiles 7.5px label, 7px padding | `style.css` 63–75 | Look tappable (they are, as of 2026-09-07) but cramped. |
| Scroll-spy line still 96px | `app.js` 412 | Sticky group is ~178–271px. Chip highlight lags the banner you actually landed on unless `navTapLock` is set. Documented in the welcome-tile fix; still true for free scrolling. |
| Leaflet CSS loaded *after* `leaflet.js` | `index.html` 3137–3138 | Classic wrong-size map on first paint; `initMapOnce` runs at end of `app.js` which races the stylesheet. |
| Chat / local panels `bottom: 150px` | `style.css` 731 | On 360px + iOS home indicator, can collide with `#time-pill` (bottom-right, z 65) vs FABs (bottom-left, z 60). Prior FAB collisions were left/bottom; time-pill + panel is the remaining pair. |
| `alert()` install buttons | `index.html` 72, 79 | Looks like a control; is a blocking dialog. No `role="button"` on the Android/iOS divs (they are `<div onclick>`). |
| History accordion `::after { float: right }` | `style.css` 694 | Fragile on wrap; the `+` can sit on the title. |
| Packing IIFE comment claims `.tab-section { display: none }` | `app.js` 1996 | False since continuous-scroll. Harmless. |
| iOS zoom | viewport is `width=device-width, initial-scale=1.0` **without** `maximum-scale=1` | Correct (zoom allowed). Chat input is `font-size: 16px` (`style.css` 754) — also correct. No other `<input>` to zoom-fail. |
| Hero `min-height: 100vh` | `style.css` 121 | Fine; welcome overlay covers it on first visit. |
| Print | `.section-banner` is in the print override (good). Directions hidden (good). | Colored chips still print as gray-ish; not re-tested here. |

**Overflow:** `.cond-row-body` / `.item-body` have `min-width: 0` (good). Long restaurant `why` strings wrap. Day-tab row uses `flex-wrap` not `overflow-x` (good). Map `#itineraryMap` is 400px fixed height — acceptable.

**Dead controls:** none of the welcome tiles are inert anymore. Map filters work. Menu modal uses `.active` not `[hidden]` (the 2026-08-11 bug stays fixed). Local-search category buttons work; the *fallback center* is the dead logic, not the buttons.

---

## 4. Security / secrets / XSS / open redirects

**Secrets:** none in-repo. Flight status no longer needs `AEROAPI_KEY` here (comment in `functions/api/flight-status.js` 16–32). Chat hits a public Worker URL. `GITHUB_TOKEN` is Actions-only.

**XSS**

`esc()` (`app.js` 366–368) encodes `& < >` only. It is interpolated into **HTML attributes**:

```211:212:app.js
  function menuTriggerHTML(name) {
    return '<button type="button" class="menu-trigger" data-restaurant="' + esc(name) + '">' + ...
```

Also `href="' + esc(reserveHref)` / `esc(contact.website)` (lines 191–206, 716, 1084, 1725). A `"` in a restaurant name or a `javascript:` website in the JSON is stored XSS. Current venue names do not contain `"`, so this is latent — it will fire the first time an itinerary import includes a curly quote, an em-dash-as-quote, or a bad URL.

Chat `linkify` (`app.js` 1815–1817) allows any `https?:` URL from the model into `href="$2"` after the *text* is escaped but the **URL is not**. A Worker response of `[x](https://evil.example/"onclick="alert(1))` breaks out of the attribute. `rel="noopener"` is set; `noreferrer` is not. Protocol is limited to `http/https` (good vs `javascript:`).

No `rel="noopener noreferrer"` gap on maps links (noopener is present). `tel:` hrefs use `esc()` but a phone of `123" onclick="…` is the same attribute bug.

**Open redirects:** directions URLs are hardcoded to maps.google.com / maps.apple.com / waze.com with `encodeURIComponent` (`app.js` 236–242). Chat markdown links are the open-redirect surface (any https host). Flight-status proxy does not redirect.

**Headers:** `_headers` is cache-policy only. No CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no `X-Frame-Options`. OSM’s tile policy wants a Referer; default browser `strict-origin-when-cross-origin` usually sends one for https→https.

**PII:** geolocation is sent to a third-party Worker (`app.js` 1848–1850) on first chat message. Expected for the feature; not disclosed in the UI beyond “trip concierge”.

**Cache-bust workflow** rewrites every `?v=` in `index.html` with a regex (`auto-cache-bust.yml` 45). A future `?v=` inside the JSON blob (a booking URL) would get stomped. Today the trip JSON does not contain `?v=`.

---

## 5. Test gaps

There is **no test suite, no Playwright folder, no lint, no typecheck, no CI except cache-bust**. `CLAUDE.md` describes a local `python3 -m http.server` + Playwright ritual that lives only in agent memory.

Minimum tests that would have caught bugs in this review:

1. **Embed equality:** `trip-data.json` == `#trip-data`; `pins.json` == `#pins-data`; minified file == pretty file.
2. **Weekday vs `label`** from a single `TRIP_START`.
3. **`dayDateISO` in `Europe/London` and `America/Chicago`** (the UTC-slice bug).
4. **Hotel check-in/out pairing** (London `hotel: null` checkout).
5. **Flight triple** `depart + duration + TZ = arrive` for every `item.flight`.
6. **ACTIONS `title`/`note` vs `trip-data.json` flight numbers and “rental car” vs ferry `why`.**
7. **Location strings ⊆ `pins.json` keys** (theatre + cemetery suffix).
8. **`.tab-section.active` vs scroll-spy** — or delete the class and read the nav chip instead.
9. **`esc()` attribute round-trip** (`"` and `javascript:` URLs).
10. **SW:** precache includes `images/*`; does not cache `!res.ok`; does not fallback HTML for `.js/.css`.
11. **Restaurant `open_days` vs computed weekday** (this still passes).
12. **No Nuremberg / City Cruises / Yeatman / Ledbury** in rendered text (editorial leftovers still in `booking_note` / hotel `confirmation_note`).

Without (6) and (11)-style content tests, a RouteSmith re-export can resurrect closed restaurants and ghost cities and the app will render them beautifully.

---

## 6. Content fact-check sweep (mandatory half)

Falsifiable claims were extracted from `why` / `confirmation_note` / History / Essentials / ACTIONS / `differentiators` and checked via WebSearch on 2026-09-09. Opinion (“worth the detour”) was skipped.

| Claim | Where | Result |
|---|---|---|
| UK ETA required for US citizens | `app.js` 1126 | **True.** Mandatory since 2026-02-25. |
| ETIAS “expected to apply by the time frame of this trip” (Oct 2026) | `app.js` 1127 | **Stale / likely false.** Official ETIAS site removed the “last quarter of 2026” date (Jul 2026); reporting points to 2027. Applications not open. |
| Schengen passport “6 months past Oct 26” + issued within 10 years | `app.js` 1128, packing list | **10-year issue rule true.** Legal validity is **3 months past exit**, not 6; 6 months is airline buffer. Overstated as a legal requirement. |
| UA940 EWR→LHR overnight Oct 12 21:00→09:20 | `trip-data.json` 52–59 | **True** for the Sep 8–Oct 23 2026 window; duration published 7h20m vs data 7h15m. |
| UA145 OPO→EWR | `trip-data.json` 2578–2585 | **Number/route true.** Aircraft in data (767-300ER) does not match current ops (typically 757-200); arrival 17:00 may not match the published Oct 26 table. |
| TP1094 as a trip flight | `app.js` 1438 | **False.** TAP LIS→VLC. CDG→OPO is Air France. |
| Phantom, His Majesty’s, Wed 2:30pm Oct 14 2026 | Day 3 + ACTIONS | **True.** Booking through Mar 2027; Wed/Sat 2:30 matinees. |
| Hamilton, Victoria Palace, Fri 7:30pm Oct 16 2026 | Day 5 + ACTIONS | **True.** Mon–Sat 7:30; booking through Mar 2027. |
| Bayeux Tapestry Museum closed through Oct 2027 | `introduction.differentiators`, History Day 9 | **True** (official Bayeux Museum). **Missing fact:** the tapestry is on loan at the **British Museum 10 Sep 2026 – Jul 2027** — i.e. during this trip’s London days. History says it “isn’t part of this visit” without mentioning it is in London. |
| American Cemetery 9,389 graves / 1,557 missing | History Day 8 | **True** (ABMC). |
| Tiger 131 only running Tiger I, captured Tunisia 1943 | History Day 7, Tank Museum `why` | **True.** Nuance: it *runs* on Tiger Days; last 2026 Tiger Day is **26 Sep**, before Day 7 (18 Oct). They will see it static. |
| IWM founded 1917; Lambeth = former Bethlem (“Bedlam”) | History Day 4 | **True** (IWM). |
| Bayeux first French town liberated, 7 Jun 1944 | History Day 9 | **True** (standard D-Day history; “town” more precise than “city”). |
| Douro demarcated 1756 | History Days 12–13 | **True** as “first comprehensively regulated wine region”; Chianti 1716 is a common caveat the text does not overclaim. |
| Bunker: “no walk-in access at all”; tours every 45–60 min; photo ID | ACTIONS `app.js` 1397–1398 | **Overstated.** Official site 2026: bunker is **guided-tour only**, advance booking *advised*, **limited same-day tickets at the desk**. Tours ~60 min. Photo ID not stated on the FAQ checked. Hours 10:00–16:30 match. |
| Churchill 15 Sep 1940 bunker visit vs 20 Aug “Few” speech | Day 5 `why` | Previously verified; left as accurate. |
| Brittany Ferries overnight ~22:45, ~8 hrs, cabin | Day 7 | Route/ships (Guillaume de Normandie / Mont St Michel) **true**. Current timetables more often show **23:00** overnight, ~7h. “Confirm the exact time” hedge in `why` is doing real work. |
| KOB hours “Fri 12:30–3pm & 7:30pm–midnight” | Day 12 restaurant | **Incomplete.** Third-party/official-adjacent listings show Mon–Fri lunch+dinner, Sat–Sun dinner. Friday 20:00 booking is still inside Friday hours. `open_days` lists all 7 days, contradicting the hours string. |
| Restaurant `open_days` vs scheduled weekday | all 21 primaries | **No conflicts** (scripted). |
| Les Flots Bleus Mon lunch-only 12:00–14:00 | Day 8 | Consistent with prior verification; not re-litigated. |

Editorial leftovers still in traveler-adjacent fields (playbook §8): hotel `confirmation_note` “replaces the earlier placeholder VRBO”; Thames walk `booking_note` “replaces an earlier placeholder City Cruises”; Le Volet `closure_note` “unlike the restaurant it replaces.” `booking_note` is currently invisible; the hotel notes **do** render in Air & Hotel / Essentials.

---

## 7. RouteSmith / trip-optimizer coupling (not a review of those repos)

This site’s schema is the trip-optimizer “Export as Web App” JSON (`<script id="trip-data">`). Risks if a new export is dropped in:

1. **No generator in-repo** — a new export will be hand-merged into three files plus `index.html`. Forgetting the embed is a silent no-op (already the #1 operational rule in README/CLAUDE.md).
2. **ACTIONS / History / packing / Essentials / Worker `wwii2026` do not update** when JSON does. That is exactly how TP1094, “Thames Cruise”, ETIAS, and the rental-car story survived after the walking-tour and Nuremberg fixes.
3. **`_modelEstimatedFlightNumber`, `booking_note`, `verify_status`** are exporter/QC fields. This app either over-warns on them or ignores them.
4. **Chat Worker is a separate deploy.** CLAUDE.md already records that `jhwiv/cloudflare-worker` `wwii2026` still needed a Nuremberg-removal PR after this site dropped Nuremberg. Concierge answers can be from a different century of the itinerary.
5. **Pins keyed by exact `item.location` strings** — an exporter that tweaks an address drops the map pin (already true for the cemetery suffix).

A new-trip playbook step that is still missing: **grep ACTIONS + History + packing + Worker schedule against the new JSON in CI**, not only in CLAUDE.md.

---

## 8. Prioritized fix list

### P0 — wrong enough to book the wrong thing

| # | Fix | Refs |
|---|---|---|
| 1 | **Reconcile Day 7 car vs ferry.** Pick one: (a) rental London→Portsmouth with an explicit **Portsmouth drop-off** before a foot-passenger ferry, or (b) keep the car onto the ferry and delete the “no rental car in Normandy / foot-passenger” `why`, or (c) private driver / train and delete the pickup item + ACTIONS row. Add the missing return/drop-off item either way. | `data/trip-data.json` 1081–1083, 1176; `app.js` 1406–1408, 1255, 1217 |
| 2 | **Remove TP1094 from Book & Confirm.** State Air France CDG→OPO, `flight_number` unknown, or fill a verified AF number. Do not list TAP. | `app.js` 1436–1438; `data/trip-data.json` 1819–1830 |

### P1 — will mislead on the ground or in pre-trip admin

| # | Fix | Refs |
|---|---|---|
| 3 | Rewrite ETIAS line: not in operation as of Jul 2026; check official EU site near departure; do not imply Oct 2026 travelers must apply. | `app.js` 1127 |
| 4 | Fix `dayDateISO` to format **local Y-M-D** (or a fixed `YYYY-MM-DD` table from the labels). Stop using `toISOString().slice(0,10)`. | `app.js` 1273–1278, 1325, 1446, 1929 |
| 5 | Drive “city you're viewing” from the scroll-spy chip / `lastActiveSection`, not `.tab-section.active`. | `app.js` 1652–1660, 1852; `index.html` 470 |
| 6 | Rename Day 6 label/headline off “Cruise”. | `data/trip-data.json` 861–863 |
| 7 | Soften bunker ACTIONS: tour-only, book ahead *strongly advised*, some walk-up possible; drop unverified “photo ID” / “every 45–60 min”. | `app.js` 1396–1398 |
| 8 | History Day 9: tapestry is in London at the British Museum during this stay. | `app.js` 1256; `introduction.differentiators` |
| 9 | Attach a `hotel` object on London checkout (and checkout times). Pin London + Porto lodgings when addresses exist. | `data/trip-data.json` 1065–1073; `data/pins.json` 8–10 |
| 10 | Align cemetery `location` with the pins key; add theatre pins or stop using unmatched locations. | `data/trip-data.json` vs `data/pins.json` 21 |
| 11 | `esc()`: also encode `"` / `'` in attributes; allowlist `http(s)`/`tel:`/`mailto:` for hrefs. Sanitize chat URLs the same way. | `app.js` 366–368, 211–212, 1815–1817 |
| 12 | SW: precache `images/*`; `if (!res.ok) return res` without `cache.put`; asset fallback must not be HTML. Bump `CACHE_NAME`. Cache-bust Leaflet. | `sw.js` 26, 51–99; `index.html` 3137; `_headers` 32–33 |
| 13 | Confirm CDG–OPO 13:00 against a real AF timetable for Thu 22 Oct 2026; confirm UA145 equipment/arrive for Mon 26 Oct. | `data/trip-data.json` 1819–1830, 2578–2585 |
| 14 | Passport copy: 3 months past Schengen exit is the law; 6 months is airline practice. | `app.js` 1128 |
| 15 | Strip editorial “replaces VRBO / City Cruises / the restaurant it replaces” from traveler-facing fields. | hotel `confirmation_note`; `booking_note` 889; Le Volet `closure_note` |

### P2 — polish, hygiene, tests

| # | Fix | Refs |
|---|---|---|
| 16 | UA940 duration 7h 20m to match published block. | `trip-data.json` 59 |
| 17 | KOB `hours` vs `open_days` (hours are Friday-only; listings show more days). | `trip-data.json` 2118–2134 |
| 18 | OSM tiles: use a policy-compliant provider or self-hosted tiles; update the “CartoDB” comment. | `app.js` 1518–1538 |
| 19 | Nav/day-tab min 44px; wire scroll-spy offset to `--sticky-clearance`. | `style.css` 215–247; `app.js` 412 |
| 20 | Maskable PWA icon; `beforeinstallprompt` or honest “how to install” `<button>`. | `manifest.json`; `index.html` 72–85 |
| 21 | CSP + `X-Content-Type-Options` + restrict flight-status CORS to this origin. | `_headers`; `functions/api/flight-status.js` 83 |
| 22 | Label live Open-Meteo vs static October `day.weather`. | `app.js` 1488–1514 |
| 23 | Delete stale comments (self-drive, CartoDB, packing `display:none`). | `app.js` 627, 1518, 1996 |
| 24 | Render `booking_note` *or* delete it; don’t leave a second source of truth. | `app.js` (no matches) |
| 25 | Add the test list in §5 (even a single `python3` script in CI). | (none today) |
| 26 | Re-sync `jhwiv/cloudflare-worker` `wwii2026` via PR (still called out in CLAUDE.md). | `app.js` 9 |
| 27 | Share: `navigator.share` of the current day URL, or drop the expectation. | (missing) |
| 28 | Leaflet `<link>` before `<script>`. | `index.html` 3137–3138 |

---

## 9. What is in good shape (so the next pass does not re-litigate)

- Weekday labels match the calendar for every day.
- City-card night total uses `days.length - 1`, not a city-nights sum.
- `day.weather` is read as a string; chips parse the `High X°F / low Y°F · …` shape.
- `duration_min` is the primary transport duration; free-time detector uses it (ferry 480, Bovington 150). Two ferry *event* rows (check-in, dock) correctly have no duration.
- Restaurant `open_days` vs scheduled weekdays: zero conflicts in this dump.
- Reservation badges / `rel="noopener"` on outbound links / menu modal `.active` pattern / sticky `--sticky-clearance` / welcome-tile deep links: the bugs those were written to fix are not regressing in source.
- Phantom / Hamilton still exist on the booked weekdays. Tapestry museum still closed in Bayeux. Cemetery counts and Tiger 131 superlative still hold. UK ETA still required.
- No API keys in the tree. Chat `linkify` at least rejects `javascript:`.

---

*Reviewer note: structural QA was run with a local Python script against `data/trip-data.json` (embed equality, weekdays, flight TZ math, restaurant open days, pin key diff, QC flags). Prose claims were checked with WebSearch, not the live domain.*
