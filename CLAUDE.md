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
- **Duration/free-time math**: a Transport item with no `end_time` is
  miscounted as free time unless `parseTransportDurationMinutes()` (or
  equivalent) derives an implied end from the item's own parsed duration.
  `parseTransportDuration()`'s anchor-to-last-delimiter regex is
  deliberate — matches only after the text's last `—`/`·`, to avoid
  false-positiving on boarding-window language like "boarding opens ~90
  min before departure."
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

### 8. When done, add an entry to the Decisions & fixed bugs log below

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
