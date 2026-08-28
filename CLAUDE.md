# aripshitadventure — Agent Notes

Read this before touching the site. It exists because this repo has no test
suite and no CI beyond a cache-buster — the only thing that keeps a future
session from re-breaking something already fixed once is this file. When you
finish a real piece of work (not a typo fix), add a short entry to the
**Decisions & fixed bugs** log at the bottom, in the same terse style as the
existing entries. Don't just say "fixed X" — say what was actually wrong and
why, so the next session doesn't have to re-diagnose it.

## ITINERARY REPLACEMENT PLAYBOOK — read this in full before swapping in a new/updated itinerary

This section exists so that "the traveler has a new PDF/export for roughly
the same trip" can be done with **minimal iteration** — reusing the mature
app.js/style.css shell and every fix below, instead of re-discovering each
one the hard way again. It is a mechanical index distilled from the full
**117-commit** decisions log below (`git log --oneline | wc -l` as of
2026-08-18) plus `jhwiv/cloudflare-worker`'s
`docs/new-trip-site-playbook.md` and `docs/cloudflare-wiki.md`, and
`jhwiv/trip-optimizer`'s `CLAUDE.md` (the upstream itinerary-builder this
site's source data comes from — read that file's own 21 KNOWN FAILURE MODEs
too if the source itinerary was built there, since a bug in the export is a
bug in this site's input). Do not skip steps because "this trip seems
simple" — every step here exists because skipping it once already cost real
debugging time or a real user-visible bug on this exact project.

### 0. Data ingestion — get this right first, everything downstream depends on it

- **Prefer the trip-optimizer "Export as Web App" JSON over a hand-typed or
  PDF-extracted itinerary.** It's the structured `<script id="trip-data"
  type="application/json">` blob this site's whole schema already matches
  (`data/trip-data.json`'s shape). A PDF requires re-extracting every date,
  time, address, phone, and price by hand or OCR — exactly the class of
  transcription error the HARD RULE below exists to prevent. If only a PDF
  is available, say so explicitly and treat every extracted fact as
  UNVERIFIED until independently checked, same as the app.js schema note
  below already requires for prose claims.
- **Check the real data shape before writing any accessor** — do not assume
  a nested-object shape "because it seems like it should be one." Canonical
  shapes are in "Trip data shape (quick reference)" below; the historical
  reason this is called out this hard is the `day.weather` string-vs-object
  bug (2026-08-09) that silently blanked every day's weather line.
- Confirm what's actually changing vs. the current `data/trip-data.json`:
  same 3 cities with different venues/schedule, a different city set
  entirely, different traveler count/dates, etc. — this determines whether
  step 6 (city add/remove touches 5 files) applies.

### 1. Data-quality QA — run ALL of this on the NEW data before writing a line of render code

Distilled from `cloudflare-worker`'s "Itinerary-data QA checklist" — this
methodology is what actually found real defects here (a restaurant booked
on its own closed day, a missing international transition, an impossible
same-day transatlantic flight), not a "looks fine" skim:

1. **Date/weekday check** — recompute every day's weekday from the trip
   start date, compare against the label.
2. **Within-day time ordering** — every item's `time` ≥ previous item's
   `end_time`.
3. **Flight/transfer time math against REAL timezones**, not just internal
   arithmetic — convert to UTC using the actual airport-country/date offset
   (check DST). Then check ROUTING PLAUSIBILITY separately: internally
   self-consistent numbers can still describe a flight that never operates
   that way in reality (Day 1's original EWR→LHR was a same-day daytime
   flight — arithmetic was fine, the route is only ever flown overnight).
4. **Night-count reconciliation from hotel check-in/check-out events**, not
   `day.city` — a transit day's activities happen in the origin city but
   the night is spent in the destination city's hotel.
5. **Inter-city transition continuity** — every city change needs an actual
   Flight/Transport item that plausibly gets the traveler there. A day that
   just starts in the new city with no transition item is a missing-leg
   bug (this is the single most consequential check).
6. **Scan every object for the plan's own QC flags** — `_`-prefixed fields,
   `closure_note`, `verify_status`. **A flag describing an intended fix
   (e.g. "moved to Day 11") is not evidence the fix was applied — verify
   the described change actually landed in the data.** (Antiqvvm was
   double-booked on both Day 10 AND Day 11 this way.)
7. **Full prose fact-check sweep — mandatory, not optional half-credit.**
   Extract every `why`/`confirmation_note`/`differentiators`/History-tab
   field that asserts a falsifiable claim (a date, a count, a named
   historical connection, a tour schedule, a loyalty/consortium
   affiliation, a "the only X in the world" superlative) and run
   `WebSearch` on **every one**, not a sample. This is real work — the
   2026-08-11 pass ran ~12 searches for one day's content alone — budget
   for it. This project has shipped a fabricated Tiger 131/Enigma
   connection, a fabricated Battle of Britain Bunker tour schedule that
   would have blocked entry entirely, a wrong Michelin star count, and a
   fabricated Marriott Bonvoy affiliation at a Relais & Châteaux property —
   **loyalty/consortium claims and named historical connections are the
   two highest-hit-rate fabrication shapes found so far**, check those
   first. A score/QA verdict given without this sweep is incomplete, not
   conservative — say so explicitly rather than presenting a structural-only
   pass as if it covered content accuracy too.
8. **Distance-from-hotel plausibility** for every restaurant/activity pick
   — cross-check its real address (verified via `WebSearch`, not assumed)
   against its host-city hotel's coordinates in `pins.json`. Flag (don't
   silently accept) anything that isn't a walkable/short pivot.
9. **Address/contact accuracy** — verify every phone/address/website via
   `WebSearch` independently of the distance check; a wrong address can
   still "look" plausible (Pentolina's was a neighborhood name mistaken for
   a street; Taberninha do Manel's put it on the wrong side of the river).
10. **Venue existence is its own check, separate from cuisine/price fit.**
    A restaurant swapped in purely for matching cuisine/simplicity/price can
    still not exist — "does this fit the brief" and "is this a real,
    open business" are different questions and passing the first proves
    nothing about the second (2026-08-24: La Creperie du Vieux Chateau, a
    perfectly on-brief pick, doesn't appear to be a real venue; found only
    because a dedicated research pass specifically searched for the
    business's existence, not its menu). Search for the venue by name +
    address and confirm an independent source (review site, local press,
    the platform's own listing) shows it operating, before checking
    anything else about it.
11. **Reservation-platform links — verify per venue, don't assume by
    country.** Confirm via `WebSearch` (or a live platform check) that a
    restaurant is actually listed on the platform before writing a
    `res_url` — never guess a URL slug or assume a platform based on
    region. As a prior only (not a substitute for checking): OpenTable and
    Resy both have real UK presence, TheFork dominates France/Portugal,
    Resy's footprint outside the US/UK is negligible — but this project has
    already found a real exception (Zizzi Victoria, 2026-08-24: assumed
    "not on OpenTable" by an earlier pass, actually listed) in the
    direction the prior would have predicted correctly, so treat the prior
    as a place to look first, not a reason to skip looking. A restaurant
    with no confirmed platform listing gets `platform="phone"` (or
    `"walkin"` if it doesn't take reservations) — never a fabricated link.

### 2. Rendering — reuse the shell, but audit every render path

- **Grep every render/call site for a field before considering a fix (or a
  new field's wiring) complete.** This exact bug shape has recurred at
  least 5 times: `HotelCard` missing a `flags` prop, restaurant
  `.why`/contact info rendering in only one of two list views, flight
  Arrives-suffix logic fixed in one render path and not the others,
  `transport_in` sitting populated and unrendered anywhere. One render path
  working is not evidence every render path was checked.
- **Grep `app.js` for every field the new data populates that the old data
  didn't** (or vice versa) — an unrendered field can drift from reality
  indefinitely with nothing to catch it (this is how the stale "MV
  Normandie" ferry name and The Yeatman's fabricated Bonvoy claim both sat
  live for a while). If a field is genuinely new, decide explicitly whether
  it needs a render path, don't leave it silently dead.
- **Any show/hide UI element uses the `display:none` default +
  `.active`-class toggle pattern already established everywhere else in
  this codebase — never the HTML `hidden` attribute.** Author CSS beats the
  UA `[hidden]` rule on specificity when both apply; this shipped a
  permanently-visible modal once already.
- **Duration/free-time math**: give every new Transport item a real
  `item.duration_min` (integer minutes) in the generator — this is now the
  primary source `transportDurationMinutesOf()`/`transportDurationBadgeOf()`/
  `dayTransitSummary()` read, and it's what the free-time-gap detector uses
  to compute `thisEnd` when `end_time` is absent. The older
  `parseTransportDuration()` text regex (anchored to the segment after the
  text's last `—`/`·`) still exists as a fallback only, and is a known trap:
  it silently misses any duration phrased earlier in the sentence or spread
  across a multi-leg description (2026-08-24: a real ferry's "approx. 8 hrs"
  and a real multi-leg walk's total both went uncounted this way, causing
  false "Free time (~X hrs, unscheduled)" cards on real drive/transit time).
  A prose-only duration on a new Transport item is a bug waiting to
  reproduce this, not a style choice — set `duration_min` every time.
- **Times render 12-hour** via a `formatTime12()`-equivalent helper
  everywhere a time appears — the source data is 24-hour.

### 3. City/scope changes — touches more than the data file

If the new itinerary adds or removes a city (not just swaps venues within
the existing 3), grep the OLD city name across **all** of: `trip-data.json`,
`pins.json`, `manifest.json`, `app.js` (`CITY_COLORS`/`CITIES`/`CITY_TZ`/
timezone map, nav chips, map filters/legend, packing list, embassy/transit
reference), and `index.html` (nav markup) — a city removal/addition is
never just a data-file edit.

### 4. Personal/contextual facts — never infer, always ask or leave unconfirmed

Home timezone, home base, traveler count/relationship, budget tier — none
of these should be inferred from trip logistics (a departure airport is not
proof of home city; this shipped `America/New_York` inferred from EWR when
the real home base was Dallas/Central). Ask directly if the new itinerary
doesn't state it, or leave it explicitly unconfirmed rather than guessing.

### 5. Photos — cannot hotlink, must be sourced from the user

This sandbox's egress is blocked to every image host (Unsplash, Pexels,
Google Maps tiles, all of it) — confirmed repeatedly, don't re-test it.
Real photos must come from the user (upload, not paste — see
`cloudflare-wiki.md` corrected-mistake #7 for the paste-vs-upload
distinction and the fallback GitHub-web-upload path). Before wiring any
supplied photo in: check for stock-service metadata strings (`strings
photo.jpg | grep -iE "adobe|getty|shutterstock|istock|..."`) — a visible
watermark's absence is not proof of a clean license. Resize to ~1600px wide
/ JPEG q80 progressive before committing (source files here were 2400×1600
at 3.3MB total; unnecessary for phone/tablet display width).

### 6. Verification — this sandbox cannot reach the live site or most external hosts

- `python3 -m http.server <port>` + Playwright against
  `http://localhost:<port>/index.html?direct=1` (bypasses the
  localStorage-gated welcome screen), with every non-localhost request
  routed through `page.route('**://*/**', ...)` and aborted — the app
  degrades gracefully (weather/map/chat show "unavailable").
- Screenshot and/or `page.evaluate()` for real computed values — don't
  infer from source code alone that a UI change works.
- Nav is continuous-scroll with `scroll-behavior: smooth` — for fast tests
  drive sections directly with
  `element.scrollIntoView({behavior:'instant'})` rather than click + wait.
- **There is no way to check the live production site from this sandbox**
  (egress to aripshitadventure.com itself is blocked). Never say "live" or
  "deployed" — only "pushed to `main`" and "passed local verification." Say
  exactly which one was checked, every time.
- Any fixed-position element (FAB, day-pill row, banner, time pill) needs
  its bounding box checked against every OTHER fixed-position element at
  real mobile widths (360–428px) — this has broken twice via two unrelated
  code paths already.
- Any colored-background/JS-toggled element needs an explicit `@media
  print` check — colors and collapsed-state visibility that work on screen
  can silently fail on paper.

### 7. Deploy

- `git fetch origin main && git rebase origin/main` immediately before
  every push — the auto-cache-bust bot commit lands fast and a stale local
  `main` will conflict.
- **Any edit to `data/trip-data.json` or `data/pins.json` must be
  re-embedded into `index.html`'s matching `<script id="trip-data">`/
  `<script id="pins-data">` blob, or the live site won't reflect it** —
  editing the data files alone does nothing.
- If the new itinerary changes cities/days/schedule, `jhwiv/cloudflare-worker`'s
  `wwii2026` `ITINERARY_SCHEDULE`/`WWII2026_ITINERARY` blob (`src/index.js`)
  needs the matching update — via **PR**, never a direct push to `main`
  (that repo auto-deploys to the shared production Worker every live trip
  site's chat depends on). Verify segment contiguity (`from[i+1] ===
  to[i]` at every city transition) before opening the PR — two real bugs
  shipped from getting this wrong across differing UTC offsets.

### 8. Editorial commentary belongs in the decisions log, never in traveler-facing text

When a venue is replaced, the new venue's `why`/`closure_note` field must
describe ONLY facts a traveler needs (what it is, why it fits, hours/access
notes) — never "replaces X" / "the old pick was closed" / "a research pass
confirmed the previous choice doesn't exist." **This has already recurred
twice on this exact project** (both restaurant-replacement passes,
2026-08-2x) despite being caught and fixed the first time — writing the
lesson down once was not enough to stop it happening again. Before
finalizing any replacement, re-read every field you wrote for the new venue
and ask "would a traveler reading this on their phone need this sentence,"
not "is this sentence true" — true-but-irrelevant meta-commentary about the
edit itself is the failure mode, and it hides inside otherwise-plausible
descriptive text rather than announcing itself. Grep the rendered page for
the OLD venue's name after any replacement — if it still appears, it's
almost always quoted inside the new venue's own description, not a leftover
duplicate booking.

### 9. Available MCP connectors — what's actually useful for this project

Checked directly, not assumed, as of 2026-08-24 — re-verify before relying
on any of these again, connector capabilities change:

- **Resy** (`display_resy_restaurant_availabilities_app`) — requires a real
  Google Places ID as input, which nothing in this sandbox can look up
  (no Places API access here). Not usable for wiring reservation links from
  this environment; a Resy link still has to be found and verified via
  plain `WebSearch` instead.
- **Uber** (`get_estimates_between_two_locations_claude`) — immediate/live
  rides only, cannot price or plan for a future travel date. Not useful for
  pre-trip transfer-cost estimates.
- **Cloudflare Developer Platform** connector covers D1/KV/R2/Workers/
  Hyperdrive — it does **not** cover Cloudflare Pages, which is what this
  site and its deploy actually run on. Don't reach for it expecting Pages
  project/deployment visibility.
- **Tripadvisor** (`search_hotels`/`hotel_details`/`compare_hotels`) — real
  hotel data, usable for lodging research/verification if a future trip
  needs it.
- **Civitatis**, **Viator** — tour/activity search and booking-adjacent
  data; usable for activity research on a future trip, not used this
  session because this trip's activities were already sourced.
- Plain `WebSearch` remains the actual workhorse for every fact-check in
  section 1 above (venue existence, reservation platform, address/phone,
  prose claims) — none of the connectors above replace it.

### 10. When done, add an entry to the Decisions & fixed bugs log below

Same terse-but-specific style as the existing entries — what was actually
wrong, why, and what the fix was, not just "updated itinerary." If this
pass finds a NEW failure shape not already covered by sections 0–7 above,
add it to this playbook too, not just the chronological log — the log
records history; this section is what a future session actually reads
first.

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

### A "QA pass" / "peer review" / "score the app" request has TWO required
### halves, not one — content fact-checking is not optional extra credit

**This has been the single biggest recurring gap in this project's history**
(logged three times independently: the Tiger 131/Enigma fabrication, the
Battle of Britain Bunker's fake tour schedule that actually broke Day 4's
bookability, the Michelin star count). Every "QA" pass run before 2026-08-11
checked structure (does it render, console errors, checkbox interactivity)
and internal math (does the weekday label match the computed calendar, does
flight arrival match departure+duration+timezone) — both checkable by
comparing the data to itself or a formula, both exhaustively coverable by
one script. **Neither of those checks a single word of prose against
reality.** A specific factual claim (a historical detail, a tour schedule,
a star count, a "the only X in the world" superlative) is only ever caught
by deliberately recognizing it as a checkable claim and running `WebSearch`
on it — there is no mechanical substitute, and skipping it is not a smaller
version of QA, it's a different, unstarted half of it.

**The standing rule: any future "QA pass," "peer review," or "score this"**
**request on this project must include an explicit prose fact-check sweep**,
structured the same way the 2026-08-11 pass did it:
1. Extract every prose field that could carry a specific claim (`why`,
   `confirmation_note`, `differentiators`, `arc`, History-tab entries,
   anything with a named person/date/number/superlative/schedule).
2. Triage: does this sentence assert something falsifiable (a date, a
   count, a schedule, a named historical connection), or is it just
   opinion/description ("worth the detour," "a great restaurant")? Only
   the former needs external verification.
3. Run `WebSearch` on every claim from step 2 — not a sample, all of them.
   This is real, non-trivial work (the 2026-08-11 pass ran ~12 searches for
   one day's worth of content); budget for it rather than compressing it
   into "spot-checked a couple."
4. A score or "passed QA" verdict given without having done this is
   **incomplete, not just conservative** — say so explicitly rather than
   presenting a structural-only pass as if it covered content accuracy too.
   The 8.5/10 given on 2026-08-11 before this rule existed is the concrete
   example of what NOT to repeat: a confident-sounding number that only
   ever measured half of what "quality" means for a fact-driven trip site.

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
`flight`, `hotel`, `restaurant`, `duration_min` (integer minutes; Transport
items only — see playbook section 2). A restaurant/hotel's name is one level
down (`item.restaurant.name` / `item.hotel.name`); an Activity/Transport/Note
item's only display text is `item.text`. `restaurant.reservation`:
`{platform, phone|url}` — `platform` is one of `resy`/`opentable`/`tock`/
`thefork`/`sevenrooms`/`yelp`/`phone`/`walkin` (`RESERVATION_LABELS` in
`app.js`). Check `data/trip-data.json` directly before assuming a field
exists — don't guess a shape from what "seems like it should be there."

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

- **Three restaurants had a "Call to reserve" badge with no actual phone
  number behind it (no link, no walk-in label) + brand-colored reservation
  icons replaced the plain text-only badges (2026-08-28).** User reported
  "Some restaurants don't say walk in only and don't have links to make
  reservations" — traced to `R()` calls (and two hand-built backup dicts)
  where `platform="phone"` but the phone value was `None`/absent, so
  `restaurantCardHTML`'s `reserveHref` fallback chain (`reservation.url` →
  `reservation.phone` → `contact.phone`) resolved to `null` while the badge
  label still said "Call to reserve" — a broken, misleading state, not the
  honest "Walk-in only" the user was expecting to see instead. Found by
  scripting a check across all 21 primary + backup restaurants for
  "platform isn't walkin AND no url/phone anywhere," not by eyeballing.
  Three real numbers found via `WebSearch`, each cross-checked against 2+
  independent sources: **Tasca da Quinta** (Douro Valley, primary booking)
  +351 918 754 102; **Mio Restaurant & Bar** (Westminster, a backup) +44 20
  7222 0058, also confirmed closed Sat–Sun (its `why` text updated from a
  hedge to the actual confirmed hours); **Spaghetti House, Kensington High
  St** (a backup) +44 20 7937 8961, confirmed NOT on OpenTable despite an
  OpenTable-branded listing page existing for it (their own site is
  phone/website-only) — a reminder that a platform's own SEO page for a
  restaurant isn't proof of an active bookable listing. Also added
  brand-colored reservation-platform badges (`RESERVATION_ICON_SVG`/
  `RESERVATION_MONOGRAM`/`RESERVATION_BRAND_COLOR`/`reservationBadgeHTML()`
  in `app.js`, near `RESERVATION_LABELS`) so each platform is visually
  distinct instead of one uniform teal pill: TheFork gets a real fork glyph
  (matches its actual green-circle-fork logo, confirmed via design-press
  coverage of the 2023 rebrand — not a generic pick), Yelp uses the real
  official simple-icons SVG (the one logo-asset host this sandbox could
  actually reach), and OpenTable/Resy/SevenRooms/Tock render as a
  colored-initial monogram in the platform's real, WebSearch-confirmed
  brand color rather than a guessed exact logo shape (this sandbox's
  egress is blocked to every brand-asset/logo CDN, same constraint
  CLAUDE.md's photo-sourcing section already documents for images — see
  that entry for the general pattern). Wired into both consumers of
  `RESERVATION_LABELS` (`restaurantCardHTML`'s `.meal-badge` and
  `renderReservationTimeline`'s `.tl-note`), not just one. Verified live
  via Playwright: all 21 restaurant badges render with an icon, zero rows
  have neither a working reserve link nor a "Walk-in only" label, and the
  existing free-time/transit-chip smoke check (12 legitimate free-time
  cards, 9 transit chips, unchanged) confirms nothing else regressed.
- **Two reservation-link corrections (Trattoria Brutto → Resy, Zizzi
  Victoria → OpenTable) + a forward-looking playbook update, no itinerary
  content touched (2026-08-28).** User explicitly required "don't change
  any of the itinerary" this pass. `WebSearch` found a genuine Resy listing
  for Trattoria Brutto (`resy.com/cities/london-england/venues/brutto`,
  confirmed via multiple independent sources including a Resy blog
  feature) — previously wired to a guessed/lower-confidence OpenTable URL.
  Also found, incidental to that check, that Zizzi (Victoria) IS on
  OpenTable (`opentable.co.uk/r/zizzi-victoria`) — the prior full
  reservation-sweep pass had marked it `platform="phone"` on a "not on
  OpenTable" finding that a direct re-check didn't confirm. Both are pure
  `reservation` field edits in `build_trip_data.py`'s `R()` calls; re-ran
  the full generator → assemble → qa_check2 (night counts unchanged:
  London 5 / Normandy 3 / Porto 4) → reembed pipeline, then a Playwright
  pass confirming both new badges/links render and no stale/duplicate
  restaurant names or closure conflicts were introduced. Also used this
  pass to write up the session's recurring lesson shapes (venue-existence
  as its own check, reservation-platform verification, the `duration_min`
  field, editorial-commentary leakage, MCP connector capabilities) into the
  playbook above (sections 1, 2, 8, 9) rather than leaving them only in
  this chronological log — see the playbook's own section 10 note on why
  that distinction matters for a future session.
- **Real OpenTable/Resy/TheFork/SevenRooms reservation links added across
  all 21 restaurants, plus a full open-day verification sweep that caught
  two real problems — one restaurant that doesn't appear to exist, one
  confirmed closed on its scheduled night (2026-08-22).** Asked to add
  real reservation-service links and confirm every restaurant is open on
  its scheduled night. Delegated the research to a background agent
  (21 venues × verifying a real online-booking presence + cross-checking
  posted hours against the exact scheduled date, not a guess) — this
  app's hard rule is no fabricated URLs, so every link had to be
  independently found on the actual platform, not pattern-guessed
  (`opentable.com/r/<slug>` is easy to invent and would silently 404).
  - **Two real problems surfaced, not hypothetical risk:**
    1. **"La Creperie du Vieux Chateau" (Day 8 lunch, Grandcamp-Maisy) —
       could not be verified to exist at its stated address** (1 Quai
       Crampon) in any directory (Pages Jaunes, TripAdvisor, Mappy). This
       entry had survived every prior fact-check pass in this file's
       history untouched, because nothing had specifically tried to
       confirm the VENUE ITSELF exists, only its cuisine/price/simplicity
       fit. Replaced with **Les Flots Bleus** (66 Quai Crampon, a few
       doors down on the same harbor quay) — independently confirmed via
       four+ corroborating sources (Yelp, Mappy, Petit Futé, the venue's
       own site). Its Monday lunch window is narrow (12:00–2:00 PM only,
       no Monday dinner at all), so the Omaha Beach activity's `end_time`
       was pulled 30 min earlier (13:30→13:00) and lunch moved 45 min
       earlier (14:00→13:15) to land comfortably inside that window rather
       than arriving at the edge of closing time.
    2. **Cafe Santiago (Day 14 lunch) — confirmed CLOSED SUNDAYS** per the
       venue's own site, and Day 14 falls on a Sunday. Replaced with
       **Francesinhas Al Forno da Baixa** (Rua do Almada 160) — same
       francesinha-focused, walk-in-casual concept, confirmed open daily
       including Sundays, in the same Baixa neighborhood.
  - **9 restaurants got real reservation-platform links** (verified by
    actually finding the listing, not guessing a URL pattern): OpenTable
    for Blacklock Soho, Osteria dell'Angolo, Spagnoletti, Trattoria Brutto,
    A Pizzaiolo Clérigos; TheFork for Essenza, KOB by Olivier, 1828
    Steakhouse; SevenRooms for Bocca di Lupo. Added `thefork` and
    `sevenrooms` to `RESERVATION_LABELS` (`app.js`) — previously only
    resy/opentable/tock/yelp/phone/walkin existed, and TheFork specifically
    is the dominant reservation platform in France and Portugal, where
    over half this trip's restaurants are.
  - **12 restaurants confirmed as genuinely phone/walk-in only** — no
    online booking presence exists for them anywhere, which is itself a
    real, useful finding (not a gap in the research): Regency Cafe, Zizzi
    Victoria, The Anchor Bankside, Bovington Tank Museum Cafe, both
    Bayeux dinners (Le Moulin de la Galette, Le Volet Qui Penche), Pizza
    Sam, Ribeira Square, Tasca da Quinta, Adega São Nicolau, and both new
    replacements (Les Flots Bleus, Francesinhas Al Forno da Baixa).
    **Explicitly did NOT link a same-named-adjacent restaurant found for
    Adega São Nicolau** — the research turned up a similarly-named but
    confirmed-DIFFERENT restaurant on TheFork; attaching that link would
    have sent the traveler to book the wrong table, so it was left
    phone-only instead, exactly the caution this file's hard rule exists
    for.
  - **A lesson from the last restaurant-swap pass applied again before
    shipping, not after being caught by a test:** the first draft of both
    replacement restaurants' `why` text editorialized about the swap
    itself ("Replaces Cafe Santiago, which a research pass confirmed is
    closed..."). Caught by my own verification script (which specifically
    checks the OLD name is gone from the rendered page) still finding the
    old names — because they were quoted inside the NEW restaurant's own
    description. Trimmed to only traveler-relevant facts before shipping,
    same fix already documented in the prior restaurant-swap entry for the
    identical mistake shape.
  - **Full open-day cross-check re-run across all 21 restaurants** (not
    just the 2 replaced ones) — computed each day's actual weekday from
    its calendar date and confirmed every single restaurant's `open_days`
    includes the day it's actually scheduled for. Zero conflicts, run
    programmatically before writing this entry, not eyeballed.
  - Verified live via Playwright: all 20 restaurants with a phone or URL
    show a working "Reserve" link (the 21st, Tasca da Quinta, correctly
    shows none — no phone number was found from any source, an honest gap
    rather than a fabricated one); reservation badges read "Book via
    OpenTable"/"Book via TheFork"/"Book via SevenRooms"/"Call to
    reserve"/"Walk-in only" correctly per restaurant; zero console errors;
    re-confirmed after trimming the why-text that neither replaced
    restaurant's old name appears anywhere on the rendered page.

- **Transfer/travel-time display rebuilt around a structured `duration_min`
  field, fixing a real "free time" mislabeling bug found during a live
  investigation, not a guess (2026-08-22).** Told the traveler wasn't
  finding transfer/travel-time info easy to understand and asked to
  "study and come back with thoughts" before implementing anything —
  loaded the actual live site (not just the code) via Playwright and
  traced exactly where the confusion came from, per this file's own
  Verification Discipline rule.
  - **Root cause:** every transfer's duration lived only in freeform prose
    (`item.text`), extracted by `parseTransportDuration()` — a regex
    ANCHORED to the segment right after the text's LAST `—`/`·` separator.
    Anything that didn't fit that exact shape got no duration at all, with
    no fallback and no visible error.
  - **Two concrete, screenshot-verified bugs this caused, not just a vague
    "hard to read":**
    1. The overnight Portsmouth→Ouistreham ferry — the single longest and
       most consequential transfer in the whole itinerary — showed **no
       duration anywhere**. Its text is `"...approx. 8 hrs — arrives...
       (Day 8)"`; the "8 hrs" sits between two dashes, not after the LAST
       one, so the regex silently missed it despite the number being
       right there in the bolded item title.
    2. **Real transit time was being mislabeled as "free time."** The
       Bovington drive's actual 2h30m duration lived only in the item's
       `why` text, never in `text` itself — so with no badge AND no parsed
       duration, the free-time gap detector (which reads the SAME
       regex-parsed value to compute where an item "ends") treated the
       drive as instantaneous and rendered **"Free time (~2.5 hrs,
       unscheduled)"** directly after it. The traveler would have been
       told they had nothing to do for 2.5 hours while actually driving to
       Dorset. Confirmed via Playwright screenshot before touching any
       code, and reproduced a second, independent instance of the same bug
       shape on the Douro Valley return drive ("2h via N222…" → "Free time
       (~4 hrs)" that was actually 2 hours driving + 2 hours real free
       time, conflated into one wrong number).
    3. Secondary issues found in the same pass: a multi-leg transfer
       ("50 min ... then 15 min walk") only ever captured the FIRST
       number, silently dropping the second; "2h" shorthand (no "m"
       suffix, no "hr"/"hour" word) wasn't recognized by the regex at all;
       and the Condensed tab — very likely the first thing anyone actually
       looks at — showed **zero** duration information anywhere, since all
       the badge logic lived only in the day-tab render path.
  - **Fix (`app.js` + `build_trip_data.py`):** added a real `duration_min`
    field (minutes, an integer) to every Transport item with a known
    duration — 19 items, each value pulled from a number ALREADY present
    in that item's own `text` or `why` field (never a new estimate; the
    Barbican Tube hop and the Bovington drive both already stated their
    real duration in `why`, just never in the field anything read). New
    helpers `transportDurationMinutesOf()`/`transportDurationBadgeOf()`
    prefer `duration_min` when present, falling back to the old
    text-parsing regex only for anything that predates the field — not a
    breaking change, a preferred-source upgrade. Fixed in THREE
    independent render paths that had each grown their own copy of the
    same regex call (`renderItemHTML`'s badge, the free-time gap
    calculator, and a third "reference card" path near the bottom of the
    file) — the third one would have kept the exact same bug alive even
    after the first two were fixed, had it not been grepped for
    specifically.
  - **New: a day-level "on the move ~Xh Ym today" chip** (`dayTransitSummary()`),
    shown on both the day-tab view (next to the weather chip) and the
    Condensed view (next to the day label), summing every Transport leg's
    `duration_min` plus every Flight leg's own `flight.duration` for that
    day — so a multi-leg travel day (drive + overnight ferry; private
    driver + flight + private driver) doesn't require mentally adding up
    several separate badges scattered down the page. Only counts legs with
    a KNOWN duration (a floor, never a guess dressed up as complete), and
    only shows when the total is ≥60 min or there are 2+ transit legs, so
    a single 15-minute tube hop doesn't get a chip of its own.
  - **Condensed view gained duration badges for the first time** — every
    Transport/Flight row now shows its duration inline, matching what the
    day-tab cards already did, closing the gap on what's likely the app's
    most-viewed screen.
  - Verified live via Playwright, re-checking the EXACT same two bugs
    found during the investigation: the ferry now shows "⏱ 8h", the
    Bovington drive shows "⏱ 2h 30m" AND the false "Free time (~2.5 hrs)"
    card after it is completely gone (Tank Museum now follows directly);
    same for the Douro return drive (now "⏱ 2h", no more false "~4 hrs"
    free-time card); the RAF Uxbridge multi-leg transfer now shows the
    full "⏱ 1h 5m" (50+15, not just 50); Condensed shows 22 duration
    badges and 9 day-level transit chips, up from zero of either; a
    full-site smoke test across every tab found zero NaN/negative
    durations and zero console errors.

- **All 16 non-simple restaurants replaced with real, verified simple
  options for a finicky 20-year-old eater (2026-08-22).** Asked to change
  out restaurants across the trip to suit a picky 20-year-old who likes
  pasta, meat, and bread — not complex multi-component tasting-style
  entrees or unfamiliar/spicy cuisines. Reviewed all 21 restaurant slots
  in the plan and identified 16 that didn't fit the profile: Indian
  (Cinnamon Club, Dishoom), Thai (Smoking Goat, Kiln), Spanish-Moorish
  fusion (Moro), three Michelin-starred/tasting-menu venues (The Ledbury,
  Pedro Lemos, The Yeatman), seafood-forward (Antunes), and several
  chef-driven contemporary Portuguese spots (Cantinho do Avillez, DOC, and
  — after actually checking their real menus rather than assuming — Le
  Lion d'Or and O Paparico too, both genuinely composed/plated French and
  traditional cuisine, not simple). 5 slots were already a good fit
  (Regency Cafe, The Anchor Bankside, Bovington Tank Museum Cafe, La
  Creperie du Vieux Chateau, Cafe Santiago) and were left untouched.
  - **Delegated the actual restaurant research to a background agent**
    rather than guessing plausible-sounding names — this app's hard rule
    is no fabricated venue names/addresses/phones, and finding 16 real,
    currently-operating, verified alternatives across 3 countries in one
    pass would have been a huge inline context cost. The agent was given
    the exact meal slot, the day's geographic/logistics constraint (e.g.
    "near Westminster, traveler visits Churchill War Rooms that morning"),
    and instructed to verify each pick via WebSearch (not just propose a
    name), with a real backup for each.
  - **The agent was also asked to evaluate two borderline picks (Le Lion
    d'Or, O Paparico) rather than assume "French"/"traditional" means
    simple** — it checked their actual menus and found both genuinely
    fine-dining/composed (duckling in cocoa sauce, foie gras with a
    peach tatin; a sealed-envelope surprise tasting menu), so both were
    replaced too, not kept on a surface-level cuisine-label assumption.
  - **Fixed a real, pre-existing bug found in the process, not
    introduced by this pass:** the original L'Angle Saint Laurent entry
    (Day 9 dinner) already carried its own `closure_note` flagging that
    the restaurant is closed Mon–Tue while the trip visits on a Tuesday —
    an unresolved conflict baked into the plan since the original PDF
    import. Its replacement (Le Volet Qui Penche) is confirmed open that
    Tuesday, closing the gap as a side effect of finding a simpler
    restaurant, not a separate fix.
  - **Cross-checked every new pick's `open_days` against the actual
    scheduled weekday, programmatically, before shipping** — computed
    each day's real day-of-week from its calendar date and confirmed no
    restaurant is scheduled on a day it's marked closed (the same class
    of bug the Le Lion d'Or/Tuesday case above already showed can hide in
    this data). Zero conflicts found across all 16 replacements.
  - Also fixed several ripple effects the swap created: the Day 5 label
    named "Kiln Dinner" specifically (now generic "Dinner"), the trip's
    `arc`/`differentiators` intro text described a "farewell dinner at
    The Yeatman" (now the actual new restaurant), the packing list's
    dinner-outfit section specifically named The Ledbury and Pedro Lemos
    as "the two dressiest dinners" requiring smart-casual (now reflects
    that literally every dinner on the trip is simple/smart-casual, since
    there is no longer a standout fine-dining night), and one
    booking-actions timeline entry still referenced "The Yeatman farewell
    dinner" with its old phone number.
  - **One judgment call, surfaced rather than silently applied:** the Day
    5 dinner (Kiln) was originally marked "(user-requested)" in its own
    item text — a signal someone had specifically asked for it. Replaced
    it anyway per the current direct instruction to simplify every
    restaurant, but flagging this explicitly since it overrides an
    earlier explicit preference rather than a generic pick.
  - One replacement (Tasca da Quinta, Day 13 lunch, Douro Valley) carries
    a genuine data-confidence gap the research agent flagged rather than
    guessed past: its exact address wasn't fully consistent across
    sources, and no phone number could be confirmed. Recorded honestly via
    `closure_note` telling the traveler to call ahead and confirm, rather
    than presenting an unverified address as fact, per this file's
    verify-or-strip rule — with a fully-confirmed backup (Castas e Pratos)
    listed alongside it.
  - Verified live via Playwright: all 16 new restaurant names render
    correctly in the Meals & Reservations list, the day-by-day city tabs,
    and (where applicable) the booking-actions timeline; all 13 old names
    (including both former "Le Lion d'Or" instances) are completely gone
    from the rendered page; the 5 kept restaurants are still present and
    unchanged; zero console errors.

- **Real Normandy Airbnb booking added from a traveler-supplied screenshot
  (2026-08-22), replacing the last remaining lodging placeholder.** The
  traveler shared a screenshot of the Airbnb app's own reservation screen
  — "Home in Bayeux," hosted by Bruno, check-in Mon Oct 19 5:00 PM,
  checkout Thu Oct 22 12:00 PM, address "4 Rue Franche," description
  "Furnished 3* apartment with cathedral view" — and asked to "add the
  appropriate night." This is a first-party screenshot of the actual
  booking record, a stronger source than the prior pass's forwarded
  emails, so every fact on it was taken as fact (name, host, address,
  check-in/checkout times) rather than re-flagged as unconfirmed.
  - **Night math checked before writing anything, not assumed:** Oct 19
    check-in → Oct 22 checkout is exactly 3 nights, matching the existing
    Day 8/9/10 Normandy stay structure precisely — no day shifting needed,
    just filling in the real property on the three touchpoints (Day 8
    check-in item, Day 10 "last Normandy night" reminder, Day 11 checkout
    item).
  - **Found and reconciled a real, if harmless, time gap:** the plan's
    checkout item is at 08:00 AM (to leave enough buffer for the 2h45m
    drive to Paris CDG before a 13:00 flight), but the Airbnb's actual
    checkout deadline is 12:00 PM. Checked whether this was a conflict —
    it isn't: a checkout time is a "no later than" bound, not a required
    departure time, so leaving 4 hours early needs no host coordination.
    Recorded both facts in the checkout item's `confirmation_note` rather
    than silently using only one and hiding the discrepancy.
  - Updated all three Day 8/10/11 `hotel` objects, the Normandy city card
    `stay` field, and the booking-actions timeline entry (retitled to
    "message host about late arrival" now that the property itself is
    confirmed — the 9:30 PM arrival vs. 5:00 PM check-in-start gap is the
    one real remaining action).
  - Verified live via Playwright: "Home in Bayeux," the host name, and the
    address all render correctly in the Air & Hotel tab and the condensed
    city card; no stale "traveler to book" placeholder text remains
    anywhere for Normandy; the derived night count (via the same
    hotel-event QA script used throughout this file's history) is still
    exactly 3 Normandy nights. Noted for the record, not fixed as part of
    this pass: the day-by-day city-tab Hotel item card shows only
    `item.text` (e.g. "Check in to Home in Bayeux (Airbnb)"), not
    `item.hotel.address`/host inline — this matches how every hotel item
    on this site has always rendered (full details live in the Air &
    Hotel tab and city summary card, confirmed still true here), not a
    regression introduced by this change.

- **"Take email info as canonical" (2026-08-22) — follow-up to the lodging
  pass below, resolving the Porto ambiguity that pass deliberately left
  open, plus a render-path audit gap found while acting on it.**
  1. **Porto lodging: the ambiguous "ambiguous, flag it" note from the
     prior pass was replaced with a firm decision, per direct instruction.**
     The bare "Join my trip to Porto" Airbnb invite (no listing attached)
     now supersedes the PDF-sourced VRBO confirmation outright — both Day
     11 check-in and Day 15 check-out `hotel` objects were changed from
     `"Porto VRBO rental"` (with a specific-looking but now-superseded
     address/phone) to `"Porto Airbnb (specific listing not yet shared)"`
     with `address`/`phone` left `null`, since no listing was actually
     shared and this session still cannot reach airbnb.com to find one.
     The city card, booking-actions timeline entry, and a stray "Ribeira
     VRBO" mention in the Pedro Lemos restaurant's `why` text were all
     updated to match. Same treatment applied to London's hedged "appears
     to be the booked lodging" language — firmed up to a direct statement,
     consistent with treating the email as the source of truth rather than
     a possible signal.
  2. **Re-read the three forwarded London Walks confirmation emails in
     full** (previously only skimmed as "now-confirmed tour bookings" and
     explicitly left for a separate pass) — each contained real reservation
     data the prior pass hadn't extracted: exact meeting points, attendee
     counts, and a numeric Walk ID (Kensington Royal Village: ID 110, 2pm
     15/10; Thames: ID 3315, 10am 17/10; Disastrous London: ID 430, 2:30pm
     17/10). **One of the three was a bigger find than "now confirmed": the
     existing Day 6 10am item was a generic City Cruises boat-cruise
     placeholder, but Jonathan's actual reservation is for a London Walks
     GUIDED WALKING TOUR** ("Thames Sightseeing, Brunel's River Walk") —
     a different activity, not just a different booking status for the
     same one. Replaced the City Cruises entry outright rather than
     patching it. All three items' `location` fields were updated to the
     email's exact meeting points, and `pins.json`/`LANDMARK_DISPLAY_NAMES`
     (`app.js`) keys were renamed to match — both are keyed by exact string
     match against `item.location`, so a location text change with no
     matching key rename would have silently dropped the map pin, the
     established failure pattern this file's playbook already warns about.
  3. **Render-path audit gap, found while verifying the walk-ID text
     actually appeared on screen (the file's own Verification Discipline
     rule) rather than assuming a data field renders because a similar one
     does:** `contact.booking_note`, `contact.hours`, and `contact.price`
     are written into `trip-data.json` by the generator but **`app.js`
     never reads any of the three for a generic Activity item** — confirmed
     by grep (`booking_note` has zero matches in `app.js`) and by reading
     `renderItemHTML` directly (only `item.contact.phone`/`.website` render
     as links; `item.location` is used only to build the directions-link
     search query, never shown as visible text). The first draft of this
     fix put the Walk ID/confirmation status in exactly those three dead
     fields — it would have been invisible on the live page despite being
     "in the data," the identical failure shape this file's KNOWN FAILURE
     MODE history (trip-optimizer's CLAUDE.md, same pattern) documents
     repeatedly. Fixed by folding the essential facts (RESERVED status,
     Walk ID, meeting point) into `item.why`, which **is** rendered
     (`renderItemHTML`'s `item-why` div) — confirmed by re-running the
     Playwright check and watching `hasWalkID` flip from `false` to `true`
     against the live page, not assumed fixed from the code change alone.
     `contact.booking_note`/`hours`/`price` were left populated in the data
     (harmless, just currently unused) rather than deleted, since a future
     render-path change could pick them up.
  4. A first version of the `why` addition also editorialized about the
     edit itself ("Replaces an earlier placeholder City Cruises boat-tour
     entry") — appropriate for this decisions log, not for text a traveler
     reads mid-trip. Trimmed to only the traveler-relevant facts before
     shipping.

  Verified live via Playwright against a local static server (fresh
  instance, not reused from the prior pass): all three walks show
  "— RESERVED" in the visible item title and their Walk ID/meeting-point
  detail in the visible `why` text; no stale "City Cruises" text remains;
  the Porto Airbnb (not VRBO) name/notes render in the city tab, Air &
  Hotel tab, and booking-actions timeline; the map tab renders without
  error with the three renamed landmark keys. Confirmed all three renamed
  `location` strings have matching `pins.json` entries (Python cross-check
  against the live `trip-data.json`), and that the only unmatched
  locations (two London theatre addresses, one Normandy cemetery address
  variant) are pre-existing gaps unrelated to this pass, not new
  regressions — checked before writing this entry, not assumed clean.

- **London lodging updated from an unbooked placeholder to a real Airbnb
  listing, sourced from the traveler's own email, not guessed
  (2026-08-21).** Asked to "look through my email and find updated lodging
  for the trip and update the app," with the travelers identified as
  Jonathan and Benjamin Ripchick. Searched the connected Gmail account and
  found two real signals from Jonathan (`jrippy1971@gmail.com`), both sent
  the same evening: a shared Airbnb room link ("Rental unit in Greater
  London · ★4.64 · 2 bedrooms · 3 beds · 1 bath", listing id
  `1301482252564927308`) and a matching Airbnb co-traveler trip invite
  ("Join my trip to Greater London") — together, a real signal that this
  replaces the earlier "VRBO rental (traveler to book)" placeholder.
  - **What was NOT in the email, and was NOT guessed:** the exact street
    address, the host name, and the price. Airbnb never exposes those in a
    shared-listing email before booking, and this sandbox's egress policy
    blocks `airbnb.com` outright (confirmed via `WebFetch`, not assumed) —
    so there was no way to independently verify them. Per this file's own
    HARD RULE (never emit an address/phone/price that hasn't been verified
    against an external source), the hotel object's `address` and `phone`
    are left `null`, `website` is set to the canonical (tracking-param
    stripped) listing URL from the email, and `confirmation_note` explains
    exactly what is and isn't confirmed and tells the traveler to get the
    real address from Jonathan directly.
  - Every generic "VRBO" reference tied to the London leg was updated to
    "Airbnb" for consistency — the Day 2 check-in/Day 7 check-out items,
    four other same-day item texts that referred back to "the VRBO"
    informally, the city-card `stay`/`transport_in` fields, the
    introduction's `differentiators` text, and the booking-actions
    timeline entry (re-titled "confirm address" rather than "not booked
    yet," since it now clearly is booked, just not fully documented here).
  - **Porto lodging: found a signal but deliberately did NOT act on it as
    a replacement.** The same email search also turned up "Join my trip to
    Porto" (an Airbnb co-traveler trip invite, cc'ing a second address)
    sent the same evening — but unlike London, it carried no listing link
    or any other detail. The existing plan already has a specific,
    PDF-sourced Porto VRBO with an address and phone number ("VRBO
    confirmation in hand"). Overwriting that with "Airbnb, details
    unknown" on the strength of a bare trip-invite email would have been a
    guess, not a finding — this file's own personal/contextual-facts rule
    is "never infer, always ask or leave unconfirmed." Left the existing
    VRBO data intact and added an explicit `FLAG:` note (in both the Day
    11 check-in and Day 15 check-out hotel objects, plus the
    booking-actions entry, re-titled "confirm which property") surfacing
    the ambiguity for the traveler to resolve, rather than picking a side.
  - Normandy: no new lodging email found at all (searched broadly for
    Bayeux/Normandy/Caen alongside Jonathan's address); left untouched.
  - Verified live via Playwright against a local static server: the
    London Airbnb details render correctly in the city tab, the Air &
    Hotel tab's hotel table, and the condensed city cards; the
    booking-actions timeline shows the reworded London and Porto entries;
    zero console errors; the stale placeholder hotel name
    ("VRBO rental (traveler to book)") no longer appears anywhere for
    London.
  - Did not touch anything outside lodging, per the task's scope — even
    though the same email search surfaced three now-CONFIRMED London
    Walks tour reservations (Disastrous London walk, Thames cruise,
    Kensington Royal Village tour) that the booking-actions timeline still
    lists as "book soon," left for a separate pass since the traveler
    asked specifically about lodging.

- **Nuremberg dropped again, overnight ferry restored, 3 real Normandy
  nights restored (2026-08-21) — direct traveler correction of the
  2026-08-18 rebuild below, same day it shipped.** The traveler reported
  three problems in one message against the live site: "Old link still has
  Nuremberg / Also shows ferry as late in day rather than overnight and
  only 2 days in Normandy which should be 3. Still want to arrive Porto on
  Thursday 10/22." Rather than assume the first complaint was a caching
  artifact, asked a clarifying question first — the traveler confirmed
  directly: **"Nuremberg shouldn't be there."** It should never have been
  re-added; the 2026-08-18 rebuild trusted the uploaded PDF's contents over
  what the traveler actually wanted, and this is the fix for that class of
  mistake, not just this one trip.
  - **Removed Nuremberg entirely** (not merged into another city, not kept
    as an optional day — gone), across every file the playbook's §3 says a
    city change touches: `data/trip-data.json` (regenerated from the
    `build_trip_data.py`/`assemble.py` generator scripts, not hand-edited),
    `data/pins.json`, `data/trip-data.min.json` (regenerated to match),
    `app.js` (`CITY_COLORS`/`CITY_FLAGS`/`CITIES`, the duplicate `CITY_TZ`,
    `LANDMARK_DISPLAY_NAMES`, `guessCityForLandmark`, the Essentials
    apps/entry-requirements/embassy content, the Transit tab, the History
    tab, and the booking-actions `ACTIONS` array — the Nuremberg-hotel-choice
    and Courtroom-600-confirmation-call entries removed outright, not
    repointed), `index.html` (nav chip, the entire `tab-city-Nuremberg`
    section + `cityDays-Nuremberg` container, map filter button + legend
    dot, title/meta description/welcome screen, packing list content), and
    `style.css` (`.nav-chip--nuremberg.active`). Mont-Saint-Michel — the
    real Day 10 stop Nuremberg had displaced — is back in the History tab,
    the Transit tab's Normandy tips, and the packing list's footwear/layers
    guidance.
  - **Restored the overnight ferry and fixed the resulting night-count
    math.** The 2026-08-18 rebuild's Day 7 had the Portsmouth–Ouistreham
    crossing landing in the same evening ("late in day"); the actual
    Brittany Ferries service on this route is an overnight sailing
    (departs 22:45, docks ~07:45 the next morning, cabin booked) — restored
    as a real transit night belonging to no city, exactly like the
    transatlantic flight night the previous entry already establishes as
    precedent. With Nuremberg gone and the ferry genuinely overnight, the
    3 Normandy touring days the traveler asked for (Day 8 D-Day sites +
    evening Normandy check-in, Day 9 self-guided Bayeux, Day 10
    Mont-Saint-Michel) fit the calendar with no other day shifted — reused
    the pre-Nuremberg, already-verified Bayeux and Mont-Saint-Michel content
    from `git log` history rather than re-researching it. Day 11 flies
    Normandy→Porto via Paris CDG (reusing the old verified Air France
    CDG–OPO routing) and still lands the traveler in Porto on Thursday
    Oct 22, exactly as required. Verified with a corrected QA script that
    derives nights from actual hotel check-in/check-out events (not a
    summary header line, per this file's own established rule): London 5 +
    Normandy 3 + Porto 4 = 12 bed-nights, +1 overnight-flight night +1
    overnight-ferry night = 14 total, matching `days.length - 1`.
  - **A judgment call, not a literal instruction follow:** the traveler's
    second answer, given in response to a since-superseded question, was
    "Start Tank Museum day a day earlier" — but with Nuremberg removed, the
    calendar already fits every stated constraint (overnight ferry, 3
    Normandy nights, Porto arrival Thu 10/22) without shifting the Tank
    Museum day off Oct 18. Kept it on Oct 18 rather than force a shift the
    math no longer requires; flagged this explicitly to the traveler rather
    than silently picking one interpretation.
  - **Found and fixed a bug the first rebuild introduced and never
    caught:** every restaurant's `verify_url` in `build_trip_data.py`'s `R()`
    helper had the destination string `"London → Normandy → Nuremberg →
    Porto"` hardcoded into the Google Maps search query — meaning removing
    Nuremberg from the visible data didn't remove it from ~20 embedded
    verify-on-Maps links until this was caught by a post-re-embed grep
    sweep of the rendered `index.html`, not by reading the generator script
    in isolation. Fixed at the source (the generator), then regenerated,
    not patched in the output.
  - Bumped `sw.js`'s `CACHE_NAME` (`v3` → `v4`) alongside this content
    change, per the existing convention from the previous entry's cache-bust
    fix.
  - Verified via Playwright against a local static server (not
    just source-reading): nav chips, the Normandy tab's banner text ("3
    nights · Day 7–Day 11"), zero remaining "Nuremberg" anywhere in the
    rendered page body, the map filters/legend, the packing list, the
    History tab, the booking-actions timeline, and the Normandy day-by-day
    content (ferry + Mont-Saint-Michel present) all confirmed live. No
    egress to the actual routesmith.ai/aripshitadventure.com domains exists
    in this sandbox — this is local-dev verification only, not a
    production check; that distinction is called out explicitly per this
    file's own Verification discipline section.
  - **`cloudflare-worker`'s companion `wwii2026` chat data (PR #5,
    `claude/aripshitadventure-review-8k14kt`) still needs the same
    Nuremberg-removal resync** — `ITINERARY_SCHEDULE.wwii2026`,
    `WWII_ITINERARY`, and `buildPrompt`'s trip-description text all still
    reflect the Nuremberg-inclusive 17-day build as of this entry. Tracked
    as the next step, not yet done.

- **Full itinerary rebuild: new 15-day PDF (Oct 12–26 2026, 14 nights),
  Nuremberg reinstated, London days rewritten (2026-08-18), following the
  new ITINERARY REPLACEMENT PLAYBOOK at the top of this file.** The
  traveler supplied a fresh routesmith.ai PDF export for "roughly the same
  trip, many changes" — extracted via `pypdf` (36 pages; the repo's
  Cloudflare Functions `/api/flight-status` proxy isn't reachable from a
  PDF, so times/addresses/phones came from the PDF text directly, which
  itself already went through trip-optimizer's own Google Places
  verification per that repo's CLAUDE.md hard rule).
  - **Nuremberg is back** (2 nights, Day 9–11: Nuremberg Trials Memorial &
    Courtroom 600, Documentation Center) after being dropped 2026-08-10.
    Re-added across all 5 files the playbook's §3 says a city change
    touches: `data/trip-data.json`, `data/pins.json` (reused the still-valid
    city-center and two landmark coordinates from before the removal, via
    `git show <pre-drop-commit>:data/pins.json`), `app.js`
    (`CITY_COLORS`/`CITY_FLAGS`/`CITIES`, the separate duplicate `CITY_TZ`
    a few hundred lines down, `LANDMARK_DISPLAY_NAMES`,
    `guessCityForLandmark`'s substring matcher, the Essentials
    apps/entry-requirements/embassy content, the Transit tab, the History
    tab, the booking-actions timeline), and `index.html` (a new nav chip, a
    new `tab-city-Nuremberg` section + `cityDays-Nuremberg` container — the
    render target `getElementById('cityDays-' + cityName)` needs, or
    Nuremberg's days would have silently never rendered at all — plus the
    map filter button and legend dot). **No licensed Nuremberg photo
    exists** — a prior `nuremberg.jpg`/Chautauqua banner collage was
    deleted 2026-08-11 specifically for being unlicensed stock; reusing it
    would have repeated that exact mistake, so the new Nuremberg banner
    intentionally has no `.location-banner-img` child and falls back to the
    container's own solid navy background instead of a broken or
    unlicensed image. Needs a real traveler-supplied photo (upload, not a
    hotlink) to match the other three cities.
  - **Found and fixed a real, critical date bug the same way the playbook's
    QA checklist is meant to catch:** the new PDF's own header claimed
    "6+2+2+4 nights" (=14) for London/Normandy/Nuremberg/Porto, but the
    actual day-by-day only supports 5 London nights (check-in Tue Oct 13,
    depart Sun Oct 18 morning) — the header's own arithmetic didn't match
    its own day sequence. Derived the real per-city counts from the actual
    hotel check-in/check-out day indices in code (`5+2+2+4` bed-nights + 1
    night lost to the transatlantic overnight flight = 14 total, matching
    `days.length - 1`) rather than trusting the summary line, per this
    file's own §1.6 rule and the precedent already set for the old
    itinerary's "silently dropped a night" bug.
  - **`app.js` had TWO independent hardcoded `new Date(2026, 9, 10)`
    instances** (`renderCountdown`'s local `tripStart`, and the
    module-level `TRIP_START` that `dayDateISO()` — used by the timezone
    pill, the booking-actions timeline's "days until" math, and the
    Air & Hotel date labels — is built on). Both silently would have kept
    computing every date-relative feature two days off the real Oct 12
    start had they not been caught; found by an explicit grep sweep for
    any remaining `2026, 9,` / `Oct 10` / `Oct 22` literal after the data
    swap, not assumed clean because the JSON files were already correct.
  - **Full mandatory prose fact-check sweep (§1.7), delegated to a
    background research agent** rather than sampled: 19 checkable claims
    (historical facts, tour schedules, restaurant closures, Michelin
    status) verified via WebSearch. Found and fixed 7 real errors before
    they ever reached the data file: a garbled/misattributed Churchill
    quote at the Battle of Britain Bunker (conflated his Aug 20 Commons
    speech with the real Sept 15 gallery visit), a false claim that
    Princess Diana's funeral "began" at a church on the Kensington walk
    (the service was at Westminster Abbey; the walk's real connection is
    to Kensington Palace, not a church), Nuremberg's Courtroom 600 wrongly
    called "still an active courtroom today" (it stopped hosting real
    trials in March 2020), the American Cemetery's grave count off by one
    (9,388 → 9,389), wrong Battle of Britain Bunker hours (was "typically
    Wed–Sun 10–5," actually open all 7 days, 10–4:30), and Kiln/Moro both
    wrongly marked "closed Sundays" (Kiln is open all 7 days; Moro is
    Sunday-lunch-only, not fully closed). Softened the Livraria
    Lello/J.K. Rowling claim to note it's a popular legend Rowling has
    publicly denied, rather than presenting it as settled fact.
  - **Critical, booking-blocking finding the fact-check sweep surfaced as
    a side effect, not one of the 19 claims it was sent to check:** the new
    PDF scheduled a Bayeux Tapestry Museum visit (Day 9) — but that
    museum is closed for renovation through October 2027, spanning this
    entire trip. This exact fact was ALREADY known to this project (the
    pre-Nuremberg-drop itinerary's own `introduction.differentiators` text
    says so explicitly) — the new routesmith.ai generation simply
    regenerated content that contradicted it. Per the HARD RULE
    (`trip-optimizer`'s CLAUDE.md: a closed venue is BLOCKED and replaced,
    never flagged-and-shipped), substituted the same fix already proven
    for this project — the Battle of Normandy Memorial Museum + Bayeux War
    Cemetery — reusing the exact verified address/phone from
    `git show <pre-drop-commit>:data/trip-data.json` rather than
    re-researching it, with the substitution stated explicitly in the
    item's own `why` text so it's transparent, not silently swapped.
  - **Distance-from-hotel audit**: flagged Pedro Lemos (Day 12) as a
    genuine ~5–6 km taxi ride from the Ribeira VRBO, not walkable — same
    finding this project made once before for a different Porto lodging
    location, now re-verified against the new VRBO's neighborhood.
  - **`menu_highlights` deliberately left empty for every new/changed
    restaurant** rather than fabricated — the field is real, sourced-via-
    WebSearch content per this project's own established rule ("kitchens
    change seasonally... not a static fact"), and populating ~24 dining
    entries' dish lists was out of scope for this pass. `app.js`'s menu
    modal already degrades gracefully when the field is absent ("No
    verified menu highlights for this one yet"), confirmed live rather
    than assumed — this is a disclosed, honest gap, not a silently dropped
    feature.
  - Confirmed live via Playwright against a fresh `python3 -m http.server`
    (not just JSON validation): all 15 days render, the Nuremberg tab shows
    real content (not a blank/broken section), the map renders Nuremberg's
    purple markers and route-overview line, the print stylesheet reads
    cleanly, the Air & Hotel flight cards show the correct (new) dates and
    the expected "not checked against a live schedule" warning (no
    Cloudflare Functions runtime under plain `http.server`, matching this
    file's own documented expectation), a menu popup opens correctly in
    its honest no-highlights state, and zero `pageerror` events across a
    10-tab sweep. `data/trip-data.json`/`data/pins.json` re-embedded into
    `index.html`'s matching `<script>` tags per this file's own hard rule;
    `data/trip-data.min.json` regenerated to match.
- **Nav tab pills redesigned for contrast/visual interest, and rebalanced
  to actually fit on 2 rows (2026-08-11), per direct request:** the old
  chips were pale-gray-on-white with only a thin gold outline for the
  active state — real contrast only appeared on close inspection. Also,
  despite the nav markup being split into two `.nav-row` divs specifically
  to read as "two rows," the 6-chip second row didn't fit in one line at
  any common phone width, so it silently wrapped into a 3rd visual line
  (`Packing` spilling alone) — the two-row layout was aspirational, not
  actually achieved on a real phone.
  - **Contrast/visual interest**: chips now have a real border, filled
    navy `.active` state (white text, drop shadow) instead of a
    near-invisible border-only active state, and the three city chips
    (London/Normandy/Porto) get their OWN accent color when active — the
    same teal/coral/gold `CITY_COLORS` already used for day banners and
    badges elsewhere in the site — plus a flag emoji, so the nav previews
    which color belongs to which city before you've tapped into a day.
  - **Fitting 2 rows**: measured actual chip pixel widths via Playwright
    rather than guessing. Rebalanced the 4/6 split to 5/5 (moved
    Essentials to row 1), shortened two labels that don't need their full
    section-heading text in the nav (`Air & Hotel` → `✈️ Stay`, `Packing`
    → `Pack` — both still show their full real heading once you tap in),
    tightened chip padding/gap, and widened the "compact" media-query
    breakpoint from 420px to 480px, since 420px was leaving large-phone
    widths (414-430px, iPhone Plus/Pro Max and most big Android phones)
    stuck with full desktop padding in a still-phone-narrow container —
    exactly where row 2 broke again. Verified computed chip widths against
    the real available nav width at 360/375/390/402/414/428/480/600/768px
    — both rows fit on exactly one line each (2 total) across that whole
    range, confirmed via Playwright screenshots at 360px (the tightest
    real case) and 390px, plus the three city active-color states and the
    Essentials/reference-row active state. Full 10-tab console-error sweep
    clean.
- **The menu-popup modal shipped in the previous entry was permanently
  visible on every page load (2026-08-11), reported directly with a
  screenshot: a dark scrim over the whole hero and a white bar cut across
  the bottom.** Root cause: `#menuModal` used the HTML `hidden` attribute
  to start closed, but its CSS rule set `display: flex` unconditionally —
  `.menu-modal-overlay { display: flex; ... }` has the same specificity as
  the browser's own default `[hidden] { display: none }` rule, and author
  CSS in `style.css` loads after the user-agent stylesheet, so the class
  rule silently won the cascade regardless of the `hidden` attribute. The
  overlay's `rgba(13,33,51,0.55)` scrim was the "screen dims"; the empty
  `.menu-modal` div (white background, `align-items: flex-end`) with no
  restaurant selected yet was the "white bar" at the bottom. This is
  exactly why every OTHER show/hide element in this file (`.panel`,
  `.local-cats`, etc.) already uses a `display:none` default +
  `.active { display: ... }` toggle rather than the `hidden` attribute —
  the modal broke that established convention and paid for it immediately.
  **Fixed** by switching `#menuModal` to the same `.active`-class pattern:
  `display: none` default, `.menu-modal-overlay.active { display: flex; }`,
  JS now does `classList.add/remove('active')` instead of setting
  `.hidden`, and the stray `hidden` attribute was removed from the markup
  in `index.html`. Confirmed live via Playwright at the exact viewport/URL
  shape from the report (`?direct=1`, narrow mobile width): computed
  `display` is `none` with no `.active` class on load (screenshot: clean
  hero, no scrim, no bar), `flex` after clicking a restaurant name
  (screenshot: modal opens correctly), back to `none` after closing.
- **Menu popups, a second backup-visibility bug, two real address/phone
  errors, and a distance-from-hotel audit (2026-08-11), from the user
  directly: "Restaurants should have menu pop up cards. I also don't see
  back up restaurants. Have you validated restaurant recommendations make
  sense based on distance from hotel."**
  - **Backup restaurants were STILL invisible in the main reading path.**
    The previous "Do it" pass (entry below) wired backups into the
    consolidated Meals & Reservations list, but `renderItemHTML` — the
    day-by-day item card in each city tab, the way most people actually
    read this itinerary — never rendered `item.restaurant` at all beyond
    the plain `"Dinner at X"` headline. Same root cause as the flags/props
    gaps this project keeps finding: a fix landing in one render path and
    not its sibling. Fixed by hoisting `restaurantDetailLines`/a new
    `restaurantCardHTML` to module scope so BOTH `renderItemHTML` and
    `renderMeals` call the exact same function — a booking's backup, hours,
    price, and now its menu trigger are visible everywhere the booking
    itself is.
  - **A THIRD instance of the same bug, found while fixing the second:**
    every primary restaurant's own `.why` field (11 of them, real
    descriptive text — Veeraswamy's 1926 founding, Pentolina's
    locals-only pasta, etc.) has never rendered anywhere. Only a
    *backup's* `.why` ever reached the screen. Fixed in the same
    `restaurantCardHTML` pass.
  - **Menu popups**, per the direct request: tapping any restaurant name
    (day card or Meals list, primary or backup) opens a bottom-sheet modal
    (`#menuModal`) with cuisine/price/address and a "What to order" list.
    Per this file's hard rule against fabricating facts, the dish list is
    NOT model-generated — it's `menu_highlights[]`, added to all 17 unique
    restaurants in `trip-data.json` this session from real `WebSearch`
    results (restaurant reviews, Michelin Guide, the restaurants' own
    sites), with an explicit on-card caveat ("kitchens change seasonally —
    confirm before booking") since a menu is not a static fact the way an
    address is.
  - **Distance-from-hotel audit, done properly rather than answered from
    memory**: cross-checked every restaurant's real address against its
    host-city hotel (`pins.json` coordinates for the hotels; addresses
    verified via `WebSearch`, not assumed). Two were fine everywhere in
    Bayeux (small town, everything's close) and most of London/Porto.
    Two genuine problems found and fixed with a logistics note appended to
    the restaurant's own `.why` text (now visible thanks to the fix
    above): **Pedro Lemos** (Day 11 primary) is a real ~5 km / 15-20 min
    taxi ride from The Yeatman in Foz do Douro — not walkable, and nothing
    in the plan said so. **Pentolina** (Day 3's Clio backup) is in
    Hammersmith, ~20-25 min from the Mayfair hotel by tube/taxi — a
    legitimate restaurant but a poor same-evening pivot, now labeled as
    such.
  - **Two address/contact errors found DURING that audit, independent of
    distance**: **Pentolina**'s address was wrong in a way that would have
    sent someone to the wrong postcode — `"71 Brook Green, ... W6 7BE"`
    (Brook Green is the neighborhood name, not the street) corrected to
    the real `"71 Blythe Road, London W14 0HP"`; phone and website were
    also wrong (`+44 20 7602 1932` / `pentolina.co.uk` → the real
    `+44 20 3010 0091` / `pentolinarestaurant.co.uk`), and `open_days`
    wrongly included Sunday (verified twice: closed Sun AND Mon).
    **Taberninha do Manel**'s address was wrong in a way that inverted the
    actual geography — `"Cais da Ribeira 36, Porto"` (the Porto-side quay,
    across the river) corrected to the real `"Avenida Diogo Leite 308,
    Vila Nova de Gaia"` — which is on the SAME side of the river as The
    Yeatman, a few hundred meters away, not across a bridge. Neither error
    would have been caught by the distance audit itself since a wrong
    address can still "look" plausible; both were only caught by
    independently verifying every restaurant's address against a real
    source rather than trusting what was already in the data.
  - Verified live via Playwright: the Day 2 Veeraswamy day-card now shows
    its backup (Gymkhana) and its own `.why` text with zero code changes
    needed on the Meals list side; clicking either restaurant's name opens
    a modal with the real, sourced dish list; the corrected Pentolina
    phone/Taberninha do Manel address/Pedro Lemos taxi note all render
    correctly; full 10-tab console-error sweep clean.
- **Wired ~10 previously-dead `trip-data.json` fields into the live UI
  (2026-08-11), after asking "are there repairs or changes called for" and
  the user replying "Do it" to my own offer.** A field-usage audit had
  found real, already-populated data that no render path ever displayed:
  restaurant `hours`/`closure_note`/`hours_note`, pre-picked `backup`
  restaurants, `cuisine`/`neighborhood`/`price_range`, hotel
  `check_in_time`/`check_out_time`, and flight `cabin`/`aircraft`/
  `airport_arrival_buffer` plus lounge `gate_proximity`/`notes`. None of
  this needed a data change — only render code. Two new shared helpers
  were added specifically to avoid the sibling-render-path-drift bug this
  project has hit repeatedly (see the contact-info fix further down this
  log): `hotelCheckTimesLine(h)` (used by both `essentialsHotels` and
  `hotelTable` — the two independent hotel-card locations) and
  `restaurantDetailLines(r)` inside `renderMeals()` (used for both a
  primary booking and its `backup`, so the two don't drift from each
  other). New `.meal-backup`/`.meal-backup-label` CSS added (dashed-border
  card, DM Mono label) for the "if this falls through" block. Verified
  live via Playwright on a fresh `python3 -m http.server`: Veeraswamy
  (has a `backup`, Gymkhana) renders cuisine/neighborhood/price, hours,
  a closure-conflict note, and the full backup block with its own
  directions/phone/website links; Scott's Mayfair (no `backup` field)
  correctly renders with no backup block; both hotel-card locations show
  check-in/check-out times; all three flight cards show cabin/aircraft,
  the arrival buffer, and per-lounge gate proximity/notes; zero console
  errors across a full 10-tab sweep. Screenshot-confirmed the new
  backup-block styling reads cleanly at mobile width (402px).
- **A 4th fabrication found: The Yeatman Hotel's loyalty-affiliation claim
  (2026-08-11), asked directly whether any repairs were still called for.**
  Rather than answer from memory, re-checked a few named claims the prior
  fact-check pass hadn't gotten to yet. The Yeatman's `confirmation_note`
  said "Marriott Bonvoy partner (Design Hotels) — verify point redemption
  or discount." Verified via `WebSearch`: false. The Yeatman is a Relais &
  Châteaux member — an entirely different consortium — and Relais &
  Châteaux doesn't even run a points-based loyalty program at all. This is
  the same shape of fabrication as the Tiger 131/Enigma claim (a plausible-
  sounding but invented affiliation), and it's worse in one respect: unlike
  `restaurant.cuisine`/`differentiators` (confirmed dead fields nothing
  renders), `confirmation_note` DOES render, in both the Essentials and Air
  & Hotel tabs — this fabrication has been live and visible the whole time,
  actively telling the traveler to try redeeming Marriott points at a hotel
  with no such program. Fixed to state the real affiliation and how to
  actually get upgrades/perks there (a Relais & Châteaux Preferred Partner
  travel advisor, not point redemption). Cantinho do Avillez (real - chef
  José Avillez's first restaurant outside Lisbon, confirmed) and Clio (real
  - genuinely Michelin Guide-listed shortly after opening, matches the
  app's own soft "recently added" phrasing) were also re-checked and held
  up. **Pattern to watch for going forward: hotel/restaurant loyalty and
  consortium affiliations are evidently a recurring fabrication shape in
  this kind of AI-drafted content (this is the second one found, after
  a documented history of the identical failure mode in this project's
  sibling `trip-optimizer` repo) — treat any named loyalty program,
  consortium, or "partner" claim on a hotel/restaurant as needing its own
  explicit verification, not just headline historical/schedule claims.**
- **Full prose fact-check across the whole itinerary (2026-08-11),
  triggered by the user asking why the Tank Museum's Enigma fabrication
  wasn't caught earlier.** Rather than answer in the abstract, extracted
  every `why`/`confirmation_note`/`differentiators` field in the data
  (~35 prose fields) and triaged which contained a specific, checkable
  factual claim vs. pure opinion/description. Verified every checkable
  one via `WebSearch`. Most held up (Veeraswamy's 1926 founding, Bayeux
  Cathedral's 1077 consecration, the Bayeux Tapestry Museum's Sept
  2025–Oct 2027 closure window, the Douro's 2001 UNESCO listing, Marriott's
  3pm standard check-in, the Thames wartime river-ferry service, and the
  Kiln/Veeraswamy Sunday-closure claim — which cross-checks correctly
  against their own `open_days` fields — were all confirmed accurate).
  Three were not:
  1. **Battle of Britain Bunker's tour schedule was fabricated, and it
     wasn't just a trivia error — it broke the actual plan.** The item
     claimed 5 daily tour slots (10:15, 11:30, 12:45, 14:00, 15:15). The
     real cadence, verified via `WebSearch`, is 2 slots (10:00 and 14:00),
     evening/weekend by special arrangement only. The existing plan had
     the traveler arriving at 10:15 (15 min after the ONLY morning slot
     starts) and leaving at 13:00 (an hour before the only other slot) —
     given this venue has zero walk-in access, the itinerary as written
     would not have let them actually see the bunker at all. Shifted the
     whole visit 30min earlier (Underground departs 08:45, not 09:15;
     bunker 09:50–12:00, not 10:15; return Underground 12:15, not 13:00)
     so it actually lines up with the real 10:00 slot, corrected the `why`
     text to state the real cadence, and updated the "Book & Confirm"
     timeline entry to explicitly say "request the 10:00 tour." **This is
     the second time a fabricated detail on this exact item wasn't a
     harmless embellishment — the Enigma claim was wrong but inert, this
     one would have caused a real, on-the-ground failure to get into the
     venue at all.**
  2. Bayeux War Cemetery's item attributed the 4,648 total-burials figure
     specifically to "British and Commonwealth" graves — the real
     Commonwealth-only count is 4,144; the rest (~500) are other
     nationalities, mostly German war graves. Fixed to state both numbers
     with the correct attribution.
  3. Day 6's transport `why` claimed a same-day London↔Bovington round
     trip would be "close to 8 hours of driving" — the real one-way drive
     (verified two turns ago) is 2h24m–3h with traffic, so round trip is
     realistically 4.8–6 hours. Corrected.
  **Where the claim came from**: git-blamed the Enigma fabrication and
  confirmed it was introduced by this session's own `30f8e04` (the
  itinerary rebuild that added the Tank Museum in the first place) — not
  inherited legacy content. Worth remembering for any future new content:
  when writing a NEW specific/checkable claim (a historical fact, a named
  connection between two things, an exact schedule), verify it in the
  same turn it's written, rather than assuming it'll get caught later —
  it took 6+ intervening sessions of unrelated work before anyone
  happened to check this one.
- **Tank Museum day fully verified (2026-08-11), found a fabricated
  history claim AND a systemic free-time miscalculation affecting 21
  items trip-wide.** User asked to verify all the Tank Museum logistics.
  Checked every checkable claim via `WebSearch` rather than spot-checking:
  address/phone/hours (all correct — 10am-5pm, no closure conflict on
  Oct 15, last admission ~4pm, the planned 10:15-2:00 visit sits
  comfortably inside that), both drive legs (121mi/2h24m real vs.
  120mi/2h30m stated; 65-68mi/1h13-19m real vs. 65mi/1h20m stated — both
  accurate and appropriately conservative), and the Tiger 131 historical
  claims.
  - **Found a fabrication**: the item's `why` field claimed Tiger 131
    "helped break Enigma's naval codes at Bletchley." This is false — the
    real Naval Enigma captures were separate incidents involving U-boats
    (U-110 in 1941, U-559 in 1942), unconnected to this tank, captured in
    Tunisia in April 1943 by an entirely different unit. The claim reads
    like an invented link to tie the day back to the previous day's
    Bletchley Park visit. Replaced with Tiger 131's own real significance
    (Churchill and King George VI both visited it; Allied engineers used
    it to study German tank design) and an explicit note that it is NOT
    connected to Bletchley Park, in case a future edit tries to re-add
    the link. Since the address/hours/phone were independently verified
    in the same pass, also updated the item's stale `_locationUnverified`
    flag to reflect that rather than leaving a "still unverified" warning
    on facts that had just been checked.
  - **Found a real, systemic bug while screenshotting the fix**: a
    "Free time (~2.8 hrs, unscheduled)" card appeared directly after the
    Tank Museum's own 2h30m drive — the drive itself was being counted as
    free time. Root cause: the day-block renderer's free-time detector
    computes a Transport item's "end" from `item.end_time`, falling back
    to the item's own START time if absent — exactly the bug already
    fixed once for Flight items (see the comment a few lines above it in
    `app.js`), but never fixed for Transport. 21 of the trip's Transport
    items have no `end_time`. Fixed by adding
    `parseTransportDurationMinutes()` (reuses the existing
    `parseTransportDuration()` already used for the Navigate duration
    badges) so a Transport item's implied end is now `item.time +` its
    own parsed duration when `end_time` is absent. Confirmed live:
    trip-wide free-time card count dropped from 19 to 15 — 4 false
    positives eliminated — while the genuine ~2.9hr gap at the Portsmouth
    ferry terminal (arrival to check-in) correctly still shows. **If a
    new Transport item type or duration phrasing is ever added, verify
    `parseTransportDurationMinutes()` still parses it — a silent parse
    failure just falls back to the old (wrong) zero-duration behavior for
    that one item, not an error.**
- **Packing list de-fancified for the real travelers (a 57-year-old
  father and 20-year-old son, "nothing fancy needed") + a real Michelin
  fact-check (2026-08-11).** The Dinner outfits section implied a
  separate "dressier" formal outfit was needed for Pedro Lemos and
  Gordon Ramsay's River Restaurant. Checked both venues' actual current
  dress codes via `WebSearch` before deciding whether that tier was
  warranted: Pedro Lemos is "smart and elegant," not black-tie; The
  River Restaurant is officially smart casual, jacket optional. Neither
  requires anything beyond what the regular smart-casual tier already
  covers, so the separate "dressier outfit" line was removed — one
  nicer smart-casual outfit does the job. Same treatment for the
  footwear line ("dressier shoes" → "a clean pair that isn't your
  walking sneakers").
  - **Caught a real factual error while checking this**: the data
    claimed Pedro Lemos has "2 Michelin stars" (in `restaurant.cuisine`,
    `restaurant.why`, AND `introduction.differentiators`) — it actually
    has 1, confirmed via `WebSearch`. Separately, the plan implied
    Gordon Ramsay's River Restaurant is a fellow Michelin night; it
    isn't — it holds a standard Michelin Guide listing and a "Plate"
    award, not a star (a different Gordon Ramsay restaurant at the same
    hotel, Restaurant 1890, has the star — not the one this trip
    actually booked). Fixed all three source locations, not just the
    packing list. Note: `restaurant.cuisine` and
    `introduction.differentiators` are BOTH fields nothing in `app.js`
    ever renders anywhere on the live site (grepped to confirm) — the
    packing list is the first and only place a Michelin claim is
    actually shown to a reader, which is exactly why this had never
    surfaced as a visible bug before now.
- **Ferry-crossing content deepened by studying a sibling ferry-heavy
  trip site (maritimes-grandloop-v2), fixing a real rendering gap along
  the way (2026-08-11).** User asked to check maritimesgrandloop.com for
  patterns on what's helpful for a ferry crossing, then make sure that
  knowledge was in this trip's data. Read the actual sibling repo
  (`/workspace/jhwiv/maritimes-grandloop-v2`, since the live domain is
  egress-blocked same as everywhere else) rather than guessing at the
  pattern. What it does that this app didn't: check-in window stated as
  its own fact, what's actually onboard (cabins/lounge/cafeteria), a
  direct phone number as a tap-to-call link, and a "pack an essentials
  bag, don't bury it in luggage" tip.
  - **Found a real, two-location rendering bug while implementing this**:
    `item.contact.phone`/`.website` were silently dropped for every
    Transport-type item in BOTH independent render paths
    (`renderItemHTML`'s `navigateRow` and `renderTransportQuickRef`'s
    `navLine`) — only non-Transport items ever rendered contact info. The
    Brittany Ferries check-in item already HAD a `contact.website`
    populated in the data and it was invisible on the live site the whole
    time. Separately, `booking_note` (a field on that same item) was never
    read by ANY renderer at all — a second dead field. Fixed both render
    paths (mirroring this file's own established "check every render
    path" rule from the marker-titles entry below) and consolidated
    `booking_note`'s real content into `why`, which already renders
    everywhere, rather than wiring up a second parallel field.
  - **Also caught a stale fact via research**: the dinner item's `why`
    named "MV Normandie" as one of the two ships on this route — Brittany
    Ferries retired the MV Normandie in 2025; the route is now served by
    the MV Guillaume de Normandie and MV Mont St Michel. Fixed.
  - Added the real customer service number (+44 330 159 7000, verified via
    `WebSearch`, not guessed), and an honest flag that this plan implies
    foot-passenger travel (no rental car anywhere in Normandy) rather than
    asserting it outright — worth reconfirming at booking since it changes
    which check-in line to use at the port.
  - **New CSS**: `.navigate-row > a[href^="tel:"]`/`a[href^="http"]` — the
    navigate-row previously only ever contained the directions pills and a
    duration badge, so a bare contact link had no matching style until
    this was added.
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
