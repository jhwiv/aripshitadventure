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
