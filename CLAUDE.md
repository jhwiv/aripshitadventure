# aripshitadventure — Agent Notes

Read this before touching the site. It exists because this repo has no test
suite and no CI beyond a cache-buster — the only thing that keeps a future
session from re-breaking something already fixed once is this file. When you
finish a real piece of work (not a typo fix), add a short entry to the
**Decisions & fixed bugs** log at the bottom, in the same terse style as the
existing entries. Don't just say "fixed X" — say what was actually wrong and
why, so the next session doesn't have to re-diagnose it.

## What this is

Static single-page trip guide for **London → Normandy → Porto**, Oct 10–22
2026 (12 nights, 2 adults, WWII-history focus). No build step, no framework —
plain `index.html` / `app.js` / `style.css`. Deployed to **aripshitadventure.com**
via Cloudflare Pages, connected to this repo's **`main`** branch (the only
branch that exists here — unlike some sibling repos, there's no stale `main`
vs `master` confusion to worry about).

Every push to `main` triggers `.github/workflows/auto-cache-bust.yml`, which
rewrites every `?v=...` query string in `index.html` to the new commit SHA and
pushes a `chore: cache-bust ... [skip cache-bust]` follow-up commit. **Always
`git fetch origin main && git rebase origin/main` immediately before pushing**
— that bot commit lands fast and a stale local `main` will conflict.

## Architecture essentials

- **The data files are not what the site reads.** `data/trip-data.json` and
  `data/pins.json` are the source-of-truth JSON, but `app.js` reads them from
  inline `<script id="trip-data">` / `<script id="pins-data">` blobs embedded
  directly in `index.html`. Editing the `data/*.json` files alone does
  **nothing** to the live site — the matching `<script>` block in
  `index.html` must be re-embedded too. (See README.md for the full note.)
- **It's one continuous-scroll page, not real tabs.** The nav chips
  (`.nav-chip[data-target="tab-xxx"]`) scroll-jump to `<section id="tab-xxx">`
  elements further down the same page — there's no show/hide logic, no
  routing. A scroll-spy highlights whichever chip's section is in view.
  Keep this in mind before writing a Playwright test that clicks a chip and
  expects instant content — `scroll-behavior: smooth` in the CSS means a
  click can take real time to land; for fast tests, drive it directly with
  `element.scrollIntoView({behavior:'instant'})` instead of clicking + waiting.
- **The welcome/onboarding screen** gates on `localStorage`
  (`aripshitadventure-welcomed`). Append `?direct=1` to bypass it for testing
  — the inline script sets the flag and `display:none`s the screen via
  **inline style**, not a CSS class, so don't assert on `.classList` when
  checking whether it's hidden.

## Verification discipline

This sandbox's egress policy blocks essentially all outbound HTTPS —
`google.com`, CDN tile hosts, Open-Meteo, the production domain itself,
the shared chat/flight-status Workers, all of it. `WebFetch` on most
consumer sites returns `EGRESS_BLOCKED`. `WebSearch` still works (routed
differently) and is the only way to check whether a URL you're about to
ship actually exists — use it before adding any outbound link you haven't
already verified another way. Never fabricate a URL "because it's probably
right" — this has bitten this project before (the old Street View embed
trick; see log below).

To verify a UI change:
1. `python3 -m http.server <port>` from the repo root.
2. Playwright against `http://localhost:<port>/index.html?direct=1`, with
   every non-localhost request routed through `page.route('**://*/**', ...)`
   and aborted — the app degrades gracefully (weather/map/chat show
   "unavailable"), so this doesn't block rendering.
3. Screenshot and/or `page.evaluate()` to read real computed values (colors,
   text content, attribute values) — don't infer from the code alone.
4. `/api/flight-status` will 404 against the plain `http.server` (no
   Cloudflare Functions runtime locally) — that's expected, not a bug.

There is **no way to check the live production site** from this sandbox
(egress to aripshitadventure.com itself is blocked). Never claim something
is "live" or "deployed" — only that it's pushed to `main` and passed local
verification. Say exactly which one you checked.

## Photo/licensing discipline

Before using any image the user uploads or you source, check for stock-photo
watermark strings (Adobe/Getty/Shutterstock) in its metadata. A genuine file
upload lands in `/root/.claude/uploads/<session-id>/` with readable bytes; an
image the user merely pasted into chat renders visually but often doesn't —
verify with `find /root/.claude/uploads` before assuming you have real bytes
to work with, rather than guessing from what's visually described.

## Trip data shape (quick reference)

`day`: `label`, `city`, `headline`, `weather`, `items[]`.
`item`: `type`, `time`, `end_time`, `text`, `location`, `why`, `contact`,
`flight`, `hotel`, `restaurant`. A restaurant/hotel's name is one level down
(`item.restaurant.name` / `item.hotel.name`); an Activity/Transport/Note item's
only display text is `item.text`. Check `data/trip-data.json` directly before
assuming a field exists — don't guess a shape from what "seems like it should
be there."

## Flight data

Flight status is proxied server-side (`functions/api/flight-status.js`) to
`https://flight-status.jhwiv-online.workers.dev/` — the **same shared Worker**
`santafejune.com` and `trip-optimizer` use, on purpose, not a separate
AeroAPI integration. That Worker's own `ALLOWED_ORIGINS` CORS allowlist does
**not** include this domain, which is exactly why the proxy exists (a
server-to-server fetch isn't subject to browser CORS) — don't "simplify" this
into a direct client-side fetch, it'll be blocked. The Worker's real source
lives in `jhwiv/santafe-itinerary` (`worker/worker.js` — NOT
`worker/flight-status-worker.js`, which is a stale, superseded duplicate;
check commit dates before trusting either).

## Decisions & fixed bugs (most recent first)

- **Added "Book & Confirm" timeline + expanded local-knowledge content
  (2026-08-11), from a user-requested tour/pacing sanity check.** Three
  separate pieces of work from one request:
  1. **A real timing bug: Day 6→7 ferry arrival was off by 1.5 hours.**
     The ferry item claimed departure 22:45, "approx. 8 hrs" duration, and
     arrival "approx. 06:15 local time" — but 22:45 + 8h + the stated 1h
     UK→France timezone shift computes to 07:45, not 06:15 (confirmed both
     that the 8hr overnight-crossing duration is realistic AND that the
     arrival math was wrong, via `WebSearch` before touching anything).
     Fixed the arrival time and cascaded Day 7's morning sequence (ferry
     dock → drive to Bayeux → luggage drop → guide meeting → the whole
     guided-tour day) forward by the same ~30–90min this correction
     implies. **If a future edit touches any overnight/timezone-crossing
     transfer, recompute arrival from departure + duration + timezone
     shift explicitly — don't trust a stated arrival time at face value,
     even one that already looks internally plausible.**
  2. **New "Book & Confirm — Tours, Tickets & Transport" timeline**
     (`renderBookingActions()`, Condensed tab, right after the existing
     restaurant Reservation Timeline) — the restaurant timeline only ever
     covered `item.restaurant`; nothing tracked the trip's actual
     ticketed/guided bookings (Bunker, Bletchley, Tank Museum, ferry,
     D-Day guide, Mont-Saint-Michel, Douro tour, flights, hotels). Each
     entry's guidance is real, individually researched per venue (via
     `WebSearch`), not a blanket rule — critically, the venues genuinely
     disagree with each other: the Battle of Britain Bunker has NO walk-in
     access at all (phone/email pre-book mandatory), Bletchley Park and
     the Tank Museum need no advance booking whatsoever, and
     Mont-Saint-Michel's ticket office doesn't even release tickets until
     about a month before the visit — booking it "early" would just fail.
     Added a 5th timeline urgency tier (`.tl-wait`, teal) alongside the
     existing 4 specifically for that last case, since "don't book yet"
     is a genuinely different message than "no rush." **If a future trip
     rebuild changes which venues are visited, this list needs its own
     re-research per new venue — don't carry over old venues' policies to
     new ones that happen to be a similar "type" (e.g. another small
     UK museum won't necessarily share Bletchley's no-booking-needed
     policy).**
  3. **Local-knowledge content deepened** to match the specificity level
     of the zurich-weekend.com reference (verified via `WebSearch`, since
     direct `WebFetch` to that domain is blocked same as everywhere else):
     a new "Apps to Download — Before You Land" Essentials card (8 apps,
     each tied to a specific moment on THIS itinerary — Trainline for the
     Day 5 Bletchley train, offline Google Maps for rural Normandy
     driving, Andante's own app for Porto transit top-up — not a generic
     "useful apps abroad" list), and the City Transit cards expanded from
     one sentence each to 4 concrete, non-generic tips per city (Tube
     escalator etiquette, French shop-greeting norms, Portuguese meal
     timing, etc.). Motivated in part by a real finding from the pacing
     check: the free-time detector already flags 19 separate unscheduled
     gaps (2.5–6.5 hrs each) across the trip — deliberately honest, not a
     bug (see `a9f7a50` in this log) — but it means travelers genuinely
     need this kind of local knowledge to fill real unscheduled time, not
     just a nice-to-have.
- **Banner/hero photos compressed; a dead unreferenced image deleted
  (2026-08-11).** The 5 real location photos were all 2400×1600 (or
  1920×1272) source JPEGs — 3.3MB total — being served for a full-bleed
  banner/hero that displays at realistic phone/tablet widths, not desktop-
  fullscreen-retina. Resized to max 1600px wide, re-encoded at JPEG q80
  progressive: 3.3MB → 1.4MB (~57% smaller), verified visually lossless
  at actual display size via before/after screenshots. Also deleted
  `porto.jpg` at the repo root (836×360, 114KB) — grepped every file for
  it first and confirmed it was referenced NOWHERE (not `index.html`,
  `app.js`, `style.css`, or `manifest.json`); genuinely dead weight sitting
  in the deployed bundle. If a new banner/hero photo is ever added, resize
  it to ~1600px wide before committing — don't commit a phone-camera-
  resolution or stock-photo-original file straight through.
- **Live Cams tab suppressed entirely (2026-08-11).** The tab (Street
  Views → Live Cams, see the entry directly below) was removed at the
  user's request: nav chip, `<section id="tab-livecams">`, the
  `renderLiveCams()` IIFE, and its dedicated `.sv-card`/`.sv-title`/
  `.sv-open-btn` CSS are all gone — not hidden via CSS, actually deleted,
  so there's no dead/unreachable code sitting in the bundle. If a future
  session is asked to bring some version of this back, the entry below
  documents the 4 real webcams + reasoning that were already researched —
  reuse that rather than re-deriving it, but don't just uncomment old code
  from git history without re-verifying the links still resolve.
- **Street Views → Live Cams (2026-08-11, superseded by suppression above).** The old tab linked every
  landmark pin to a Google Maps Street View search — a static photo, not a
  live feed, and confusing given the tab was literally called "Street
  Views." Most of this trip's stops (small museums, monuments) have no
  dedicated public webcam, so rather than fabricate one per pin, it's now a
  curated list of 4 real webcams (found + sanity-checked via `WebSearch`,
  since direct `WebFetch` is blocked) that actually cover an itinerary day:
  Westminster (Day 2), Utah Beach Museum's own cams (Day 7),
  Mont-Saint-Michel via the official Normandy tourism board (Day 9), Douro/
  Ribeira (Day 11). `renderStreetViews()` → `renderLiveCams()`, section id
  `tab-streetviews`→`tab-livecams`, list id `streetViewList`→`liveCamList`.
- **History expanded 4 → 10 entries (2026-08-11).** A 12-night trip billed
  as "Cultural WWII focus" had history context for barely half its days.
  Now one entry per major stop, each tagged with the day it's relevant to,
  grounded in facts already stated in the trip's own item text (e.g. Tiger
  131 "the only running Tiger I in the world," the Sainte-Mère-Église
  paratrooper story) rather than introduced fresh. If a future rebuild
  changes which sites are visited, re-check this list against the new
  `days[]` — it's hand-mapped to specific day numbers, not derived.
- **Contrast pass (2026-08-11).** Two colors reused almost everywhere
  (`#9aa1ad` for captions/times/labels, `#3f7d86` for links/the nav pill
  text) both measured under WCAG AA's 4.5:1 against their real backgrounds
  (as low as 2.3:1). Darkened to `#656d7c` / `#376e76` sitewide, same hue,
  verified against every real background color in use, not eyeballed.
  If you add a new muted-gray or teal text color, compute its contrast
  ratio against the actual element background before shipping — don't
  assume a color that "looks similar" to an existing one also passes.
- **Drive-time badges + nav icons (2026-08-10).** `directionsLinksHTML`
  gained icons; `parseTransportDuration()` extracts a duration from a
  Transport item's own text, but only from the segment AFTER the text's
  last `—`/`·` delimiter — this is deliberate, not incidental: matching
  anywhere in the string false-positives on boarding-window language like
  "boarding opens approx. 90 min before departure" (a window, not the
  travel time). If this ever needs to parse a new phrasing, keep the
  anchor-to-last-delimiter approach; don't switch to a bare regex search.
- **Icon: settled on the user's real photo, not a designed mark
  (2026-08-10).** Went through 3 wrong guesses first — a generic compass, a
  three-dot route mark, and a Euro-banknote-style bridge motif (styled and
  restyled twice) — before the user sent their own Mont-Saint-Michel photo
  and asked for it to be used directly. Lesson: a request like "make it
  represent X" is not necessarily asking for an abstract design at all; if
  the user has already shared a real photo from the trip, that's very
  likely the actual answer, not a design brief to interpret.
- **Street View iframe embed never worked (fixed 2026-08-10, since fully
  replaced — see above).** The original design tried
  `google.com/maps?layer=c&cbll=...&output=svembed` as a "keyless embed"
  trick. It doesn't work — Google no longer honors that URL shape as an
  embeddable panorama, confirmed live by the user's own screenshot showing
  a generic zoomed-out world map instead. This sandbox can't reach
  google.com to test such tricks itself; don't ship an unverified "clever"
  URL trick again without a way to actually confirm it renders.
- **Map filter wasn't re-zooming (2026-08-10).** Clicking a city filter
  only toggled marker opacity; `fitBounds()` was never called again after
  initial load, so the map stayed at whatever zoom it started at regardless
  of which city was selected. Fixed by recomputing bounds from the visible
  markers on every filter change.
- **Flight status must use the shared Worker, not a separate
  implementation (2026-08-10).** See "Flight data" above.
- **iOS "Add to Home Screen" icon was simply never wired up (2026-08-10).**
  `apple-touch-icon` link tag was missing entirely from `<head>` — not a
  caching issue, not an iOS quirk, just absent. Always check the actual
  `<head>` markup exists before assuming a platform-specific bug.
- **Street View / Map marker titles were raw street addresses
  (2026-08-10).** `PINS.landmarks` is keyed by full street address (needed
  for accurate coordinates), but both the old Street View cards and the
  map's marker popups displayed `loc.split(',')[0]` as the venue name —
  fine when the street name happens to BE the venue ("Livraria Lello,
  Rua..." → "Livraria Lello"), genuinely confusing otherwise ("Wren Ave"
  for the Battle of Britain Bunker, "Sherwood Drive" for Bletchley Park, a
  bare postal code for Pointe du Hoc). This is why `landmarkDisplayName()`
  and the `LANDMARK_DISPLAY_NAMES` override map exist — grep for every
  `loc.split(',')[0]` call site before adding a new one; there were two
  independent call sites reading the same bad name and both needed fixing
  together, not just the one that prompted the report.
- **City-card night total silently dropped a night (2026-08-10).** The
  Trip Overview city cards summed `cities[].nights` for the "X of Y
  nights" total, but a city's own `nights` field only covers nights spent
  actually IN that city — the overnight Portsmouth↔Caen ferry crossing
  belongs to no city entry, so the sum silently came out to 11 while the
  trip is genuinely 12 nights (the hero's own meta line already said 12
  correctly). Fixed by deriving the total from `days.length - 1` (ground
  truth) instead of summing city entries — this is the general rule any
  future "total nights" computation on this site should follow, not just
  this one card.
- **Itinerary rebuilt: Nuremberg dropped, London/Normandy/Porto
  restructured (2026-08-10).** Direct response to traveler feedback that
  Nuremberg was hard to reach from Normandy. Added Battle of Britain
  Bunker, Bletchley Park, and The Tank Museum to London; kept the American
  Sector D-Day tour, added a self-guided Bayeux day and Mont-Saint-Michel
  to Normandy; compressed Porto to 3 nights. Every Nuremberg reference had
  to be swept across `trip-data.json`, `pins.json`, `manifest.json`,
  `app.js`, and `index.html` (nav, map filters/legend, packing list,
  embassy/transit reference, `CITY_COLORS`/`CITIES`/`CITY_TZ`, timezone
  map) — a city removal is NOT just a data-file edit, it touches constants
  scattered through the JS too. If a city is ever added or removed again,
  grep for the old city name across all five of those files, not just the
  two data files.
- **Continuous-scroll rebuild replaced a click-based tab system
  (2026-08-10) — the current architecture (see "Architecture essentials"
  above).** The prior version (illustrated SVG city banners, a show/hide
  tab system) was built from a stale ~4.5-month-old *archived* snapshot of
  the reference site (zurich-pwa) instead of its actively-maintained
  source — confirmed by reading zurich-pwa's real current source and
  comparing against the user's own live screenshots of aripshitadventure,
  which didn't match. The real pattern is what's live today: one
  continuous-scroll page, a scroll-spy nav, real photo banners at city
  transitions, a full-bleed photo hero with a carousel. **Lesson: when
  copying a pattern from a sibling/reference repo, read its CURRENT
  source directly — an archived or cached copy can be meaningfully stale
  without looking obviously wrong.** The illustrated SVG banners
  themselves were a deliberate stopgap for a separate, real constraint:
  this sandbox's egress is blocked to every image host, including the
  exact CDN the reference sites hotlink from, so no real photo could be
  fetched at the time. They were replaced with real licensed photos once
  the user supplied them directly (uploaded via chat, not fetched) — if a
  banner/hero ever needs a new photo, get it from the user, don't try to
  hotlink one; the egress block isn't going away.
- **"Self-drive" mislabeling shipped, then had to be walked back
  (2026-08-09→08-10).** One commit added a blanket text transform —
  display-time only, `humanizeTransportText()` — that replaced "Private
  driver" with "Self-drive" and "Private transfer" with "Self-drive
  transfer" on every Transport item, based on the user having said twice
  that no private driver was wanted for the trip in general. A later
  traveler-review pass checked every actual instance against the real
  trip data and found 100% of them are genuinely hired, concierge-arranged
  chauffeur services with dedicated contacts and price estimates (the
  Normandy D-Day guide, the Paris CDG driver, the Douro Valley driver, the
  Porto airport transfer) — not one was meant to be self-driven. The
  general preference didn't apply to these specific, already-arranged
  services. Removed the relabeling entirely (kept the Navigate buttons —
  useful regardless of who's driving) and fixed the welcome-screen copy,
  which made the same wrong assumption. **Lesson: a general stated
  preference doesn't automatically apply to every specific instance in the
  data — check what the data actually says before applying a blanket
  transform, especially a text-replacement one that's easy to write
  broadly and hard to notice is wrong once it's shipped.**
- **Day 1's flight time was physically impossible (2026-08-10).** The
  EWR→LHR flight departed 8:20 AM and landed 8:40 PM the same day —
  internally self-consistent arithmetic, but this route is flown
  overnight in reality, never as a same-day daytime flight. Separately,
  `cities[].transport_in` claimed a Normandy leg routed through CDG that
  never existed anywhere in `days[]` at all — Day 6 just started already
  in Normandy with no transition item, and the claimed routing was also
  geographically implausible (Caen is closer to London than Paris).
  Restructured Day 1 around a real overnight EWR→LHR routing and added an
  actual Eurotunnel Le Shuttle transfer for the Normandy leg. **Lesson:
  "the times add up" is necessary but not sufficient — cross-check a
  flight or transfer against whether that routing is realistic at all,
  not just whether its own numbers are self-consistent.** Fixing this
  surfaced three follow-on bugs in the same pass, all worth knowing about
  if you touch time/text rendering again: (1) the "Arrives X" suffix logic
  assumed `item.time` is always a departure time, but for this now-
  overnight flight it's deliberately the ARRIVAL time, producing a
  duplicated "9:35 AM · Arrives 9:35 AM" — now handled in every render
  path that shows flight times; (2) the new Eurotunnel item's own text
  used the phrase "door to door," which fed the same "last `to X` wins"
  trap in `parseTransportDestination` (its own "to door" beat "to
  Bayeux"), silently breaking the Navigate link; (3) an item with no
  `end_time` gets double-counted as its own separate "Free time" gap by
  the free-time detector — always set `end_time` on a multi-hour transfer.
- **Weather line was silently blank on every single day (2026-08-09).**
  `day.weather` is a plain string in this trip's real data (e.g. `"High
  59°F / low 48°F · overcast..."`), but the renderer read
  `day.weather.summary`/`day.weather.condition` — object-shaped access on
  a string is always `undefined`, so the weather line rendered empty on
  every city-tab day block, silently, with no error. Exactly the failure
  class this file's "Trip data shape" section exists to prevent: check the
  real field's actual type/shape before writing an accessor, don't assume
  a nested-object shape because it "seems like" it should be one.
- **A flagged data conflict shipped anyway — Antiqvvm double-booked
  (2026-08-09).** Day 10's own record already carried a `closure_note`
  saying it had been "moved to Day 11" due to a Monday closure, plus a
  ready backup restaurant that was never actually applied — the flag
  existed in the data, but the swap it described had never been made, so
  the same restaurant was booked for dinner on both Day 10 AND Day 11.
  **Lesson: a `_note`/`closure_note`/similar flag describing a fix is not
  evidence the fix was actually applied — verify the described change
  landed in the data, don't trust the annotation at face value.**
- **`transport_in` existed in the data but was never rendered anywhere
  (2026-08-10).** The third instance of the same failure class as the
  weather bug above: a real, correct field sitting in `cities[]` with
  nothing on the site ever displaying it, so a stale/wrong value (it said
  "Fly CFR→NUE via connection" long after the actual plan changed to a
  private driver + a real flight) went unnoticed because nothing showed it
  to anyone, including whoever last edited the data. Now surfaced on each
  city's overview card. **If you add a new field to `trip-data.json`,
  confirm something on the site actually renders it — an unrendered field
  can silently drift from reality indefinitely with nothing to catch it.**
- **Offline support was promised in the UI and didn't exist
  (2026-08-10).** The welcome screen's own tip told travelers to install
  the site "before you land" because "Wi-Fi at Churchill's bunker is not
  what it used to be" — but there was no service worker at all; a
  traveler who followed that advice and lost signal would have gotten a
  blank failed load. Built the precache-on-install service worker that's
  live today (see `sw.js`'s own header comment for the two real caching
  bugs found while building it — response-clone-after-read, and first-
  visit-can't-retroactively-cache). **Lesson: copy that promises a
  capability is a claim about the code, not just marketing text — check
  the feature it describes actually exists before shipping copy that
  assumes it does.**
- **Fixed-position mobile elements collided more than once
  (2026-08-09→08-10).** The bottom-left FAB stack and the day quick-jump
  pill row overlapped on mobile hard enough that "Day 1" was completely
  unreachable behind the chat FAB — found once during a traveler-review
  pass (fixed with exact bounding-box math, not eyeballing) and then
  again after the continuous-scroll rebuild reintroduced a related
  collision (a stale mobile-only padding hack from the old tab
  architecture crushed the day pills into a single column). **Any new
  fixed-position element (FAB, pill row, banner) needs its bounding box
  checked against every OTHER fixed-position element on mobile widths —
  this has now broken twice via two unrelated code paths.** Also worth
  knowing: an initial audit pass during the first fix flagged several
  false "overlap" hits that turned out to be screenshot-timing artifacts
  from the site's own `scroll-behavior: smooth` — a screenshot taken
  before a smooth-scroll settles shows a transient, non-representative
  state; always wait for scroll to settle before treating a screenshot as
  ground truth.
- **`welcome-screen`/`packing-list-v2` are adapted from the
  `travel-app-components` library**, not written from scratch for this
  trip (`fc069f0`) — if either needs a fix, check whether the same bug
  exists in the library's source components too, since other trip sites
  reuse them.
- **Print stylesheet: colors that work on screen can fail on paper
  (2026-08-10).** City banners rendered white-on-navy on screen (fine,
  photo background) but the print stylesheet didn't override that, so a
  printed itinerary showed white text on a white page — unreadable. Any
  new colored-background element needs its own print-stylesheet check,
  not just a screen check.
- **Home timezone was guessed from the departure airport, and was wrong
  (2026-08-10).** The time pill's `HOME_TZ` was set to `America/New_York`
  — inferred from the EWR departure airport — not the traveler's actual
  home base (Dallas, TX / Central). An airport code is not a reliable
  proxy for where someone lives; if a "home" fact like this is ever needed
  again, use what the traveler has actually told you, not what's
  inferable from trip logistics.
