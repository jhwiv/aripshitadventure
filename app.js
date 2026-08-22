(function () {
  'use strict';

  var TRIP = JSON.parse(document.getElementById('trip-data').textContent);
  var PINS = JSON.parse(document.getElementById('pins-data').textContent);

  // Same worker that already backs zurich-weekend.com's concierge chat —
  // this trip is registered there under the "wwii2026" site key.
  var CHAT_API = 'https://cloudflare-worker.jhwiv-online.workers.dev/api/chat/wwii2026';

  var CITY_COLORS = { London: '#3f7d86', Normandy: '#c9524b', Porto: '#c9a24b' };
  var CITY_FLAGS = { London: '🇬🇧', Normandy: '🇫🇷', Porto: '🇵🇹' };
  var CITIES = ['London', 'Normandy', 'Porto'];

  // Hero photo carousel — one of these is picked at random on every page
  // load (see renderHeroPhoto below). Neither zurich-pwa nor
  // maritimes-grandloop-v2 actually has a rotating hero (both use a single
  // static photo), so this is a new feature built specifically per
  // request rather than copied from either reference. Hosted locally under
  // images/, since this environment cannot reach any external image host
  // (confirmed against images.unsplash.com itself, the exact CDN both
  // reference sites use, which 403s here too) — real files delivered via a
  // GitHub upload instead. All three are free-license (Unsplash/Pexels)
  // photos from the trip's own photo manifest. Add more local images/*.jpg
  // entries here to widen the rotation further.
  var HERO_PHOTOS = [
    'images/hero-02-london-night.jpg', 'images/hero-03-normandy.jpg',
    'images/banner-porto.jpg'
  ];

  var ITEM_ICONS = {
    Flight: '✈️', Transport: '🚗', Hotel: '🏨', Dinner: '🍽️',
    Lunch: '🍽️', Breakfast: '☕', Activity: '📍', Note: '📝'
  };

  // PINS.landmarks is keyed by full street address (needed for accurate
  // coordinates), but showing that raw key as a display name/title reads as
  // confusing or meaningless for anything whose street name isn't itself
  // recognizable - "St. Andrew's Road" (Battle of Britain Bunker), or
  // "Boulevard Fabian Ware" (the Battle of Normandy Memorial Museum). A
  // plain `loc.split(',')[0]` happens to work when the street name IS the venue
  // (e.g. "Livraria Lello, Rua..." -> "Livraria Lello"), which is why this
  // went unnoticed for the entries that already read fine - it's not a
  // regression from any one rebuild, it's an inherent gap in that heuristic
  // for any address whose first segment isn't the venue's own name. Used by
  // initMapOnce (marker popups/directions links) - fixing only one would
  // leave the other showing the same confusing text and its directions
  // link built from the same unhelpful query.
  var LANDMARK_DISPLAY_NAMES = {
    'Riverside Building, County Hall, London SE1 7PB': 'London Eye',
    'Clive Steps, King Charles Street, London SW1A 2AQ': 'Churchill War Rooms',
    'Lambeth Road, London SE1 6HZ': 'Imperial War Museum London',
    'High Street Kensington Underground station, London W8 (meet by the Wasabi restaurant at the end of the shopping arcade linking the station to the High Street)': 'Kensington Royal Village Walk (departs High St Kensington)',
    "St. Andrew's Road, RAF Uxbridge, Uxbridge UB10 0RN": 'Battle of Britain Bunker',
    'Embankment Underground station, London (river exit)': "Thames Sightseeing, Brunel's River Walk (departs Embankment)",
    'Barbican Underground station, London': 'Disastrous London Walk (departs Barbican)',
    'Bovington Camp, Wareham, Dorset BH20 6JG': 'The Tank Museum, Bovington',
    'Omaha Beach, Avenue de la Liberation, 14710 Colleville-sur-Mer': 'Omaha Beach',
    'American Cemetery, 14710 Colleville-sur-Mer, France': 'Normandy American Cemetery',
    'Boulevard Fabian Ware, 14400 Bayeux': 'Musée Mémorial de la Bataille de Normandie & British War Cemetery',
    'Le Mont-Saint-Michel, 50170, Normandy': 'Mont-Saint-Michel',
    'Cais da Ribeira, 4050-510 Porto, Portugal': 'Ribeira Waterfront',
    "Rua do Agro 141, 4400-281 Vila Nova de Gaia": "Graham's Port Lodge",
    'Praca Almeida Garrett, 4000-069 Porto': 'São Bento Station',
    'Vilarinho dos Freires, 5050-364 Peso da Regua': 'Quinta do Vallado',
    'Rua das Carmelitas 144, 4050-161 Porto': 'Livraria Lello',
    'Rua de Sao Filipe de Nery, 4050-546 Porto': 'Clérigos Tower',
  };
  function landmarkDisplayName(loc) {
    return LANDMARK_DISPLAY_NAMES[loc] || loc.split(',')[0];
  }

  var RESERVATION_LABELS = {
    resy: 'Book via Resy',
    opentable: 'Book via OpenTable',
    tock: 'Book via Tock',
    yelp: 'Book via Yelp',
    phone: 'Call to reserve',
    walkin: 'Walk-in only'
  };

  function mapsLink(query) {
    return 'https://maps.google.com/?q=' + encodeURIComponent(query);
  }

  // All times in the source data are 24-hour "HH:MM" strings - display
  // everything as 12-hour with AM/PM. Non-matching input is returned as-is
  // rather than guessed at.
  function formatTime12(t) {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return t || '';
    var parts = t.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + ampm;
  }

  // check_in_time/check_out_time live on two DIFFERENT Hotel items per stay
  // (the arrival item carries check_in_time, the departure item carries
  // check_out_time) - both render paths that build hotelsByName already
  // merge same-named hotel items' fields together, so by the time either
  // renderer sees h, both times are already present on the same object.
  // One shared helper (not copy-pasted per call site) so a future fix to
  // this formatting doesn't have to be applied twice and risk drifting.
  function hotelCheckTimesLine(h) {
    if (!h.check_in_time && !h.check_out_time) return '';
    var bits = [];
    if (h.check_in_time) bits.push('Check-in ' + esc(formatTime12(h.check_in_time)));
    if (h.check_out_time) bits.push('check-out ' + esc(formatTime12(h.check_out_time)));
    return '<div class="ref-line">' + bits.join(' · ') + '</div>';
  }

  // Renders a restaurant's cuisine/neighborhood/price + hours + closure note
  // the same way everywhere it's used - kept as one function so the many
  // call sites (day-item cards, the Meals & Reservations list, a backup
  // nested inside either of those) don't drift the way other duplicated
  // render logic in this file already has (see CLAUDE.md).
  function restaurantDetailLines(r) {
    var contact = r.contact || {};
    var meta = [r.cuisine, r.neighborhood, r.price_range].filter(Boolean).join(' · ');
    var closure = r.closure_note || r.hours_note || null;
    return (meta ? '<div class="meal-meta">' + esc(meta) + '</div>' : '') +
      (contact.hours ? '<div class="meal-meta">' + esc(contact.hours) + '</div>' : '') +
      (closure ? '<div class="meal-meta">' + esc(closure) + '</div>' : '');
  }

  // Full restaurant card: clickable name (opens the menu popup), details,
  // directions/reserve/website links, and — if this booking has a
  // pre-picked backup — the backup's own card nested underneath. ONE
  // function used by both the day-item cards (renderItemHTML) and the
  // consolidated Meals & Reservations list (renderMeals), so a booking's
  // backup is visible everywhere the booking itself is, not just in one of
  // the two places a reader might actually be looking. This function is
  // exactly what was missing before — backups only ever rendered in the
  // Meals & Reservations list, invisible to anyone reading day-by-day.
  function restaurantCardHTML(r) {
    var contact = r.contact || {};
    var platform = (r.reservation && r.reservation.platform) || null;
    var label = RESERVATION_LABELS[platform] || 'Reservation info unavailable';
    var reserveHref = (r.reservation && r.reservation.url) ? r.reservation.url
      : (r.reservation && r.reservation.phone) ? 'tel:' + r.reservation.phone
      : (contact.phone ? 'tel:' + contact.phone : null);
    var b = r.backup;
    var backupBlock = b ? '<div class="meal-backup">' +
      '<div class="meal-backup-label">If this falls through</div>' +
      '<div class="meal-name">' + menuTriggerHTML(b.name) + '</div>' +
      restaurantDetailLines(b) +
      (b.why ? '<div class="meal-meta">' + esc(b.why) + '</div>' : '') +
      '<div class="item-links">' + directionsLinksHTML(b.name) +
      ((b.contact || {}).phone ? '<a href="tel:' + esc(b.contact.phone) + '">' + esc(b.contact.phone) + '</a>' : '') +
      ((b.contact || {}).website ? '<a href="' + esc(b.contact.website) + '" target="_blank" rel="noopener">Website</a>' : '') +
      '</div></div>' : '';
    return '<div class="meal-top"><span class="meal-name">' + menuTriggerHTML(r.name) + '</span>' +
      '<span class="meal-badge">' + esc(label) + '</span></div>' +
      restaurantDetailLines(r) +
      // r.why (the restaurant's own description) previously rendered ONLY
      // on a backup pick, never on the primary - every one of the 11
      // primary restaurants in this trip has real, populated why text that
      // has never once reached the screen. Same dead-field shape as the
      // backup-visibility bug above; fixed the same way, in the same pass.
      (r.why ? '<div class="meal-meta">' + esc(r.why) + '</div>' : '') +
      '<div class="item-links">' +
      directionsLinksHTML(r.name) +
      (reserveHref ? '<a href="' + esc(reserveHref) + '" target="_blank" rel="noopener">Reserve</a>' : '') +
      (contact.website ? '<a href="' + esc(contact.website) + '" target="_blank" rel="noopener">Website</a>' : '') +
      '</div>' +
      backupBlock;
  }

  function menuTriggerHTML(name) {
    return '<button type="button" class="menu-trigger" data-restaurant="' + esc(name) + '">' + esc(name) + '<span class="menu-trigger-hint">Menu ›</span></button>';
  }

  // Name -> restaurant object, covering both a day's primary booking and
  // its backup (if any) - built once so the menu popup can look up either
  // by the name printed on its own clickable trigger, from wherever that
  // trigger was clicked.
  var RESTAURANTS_BY_NAME = {};
  (TRIP.days || []).forEach(function (day) {
    (day.items || []).forEach(function (item) {
      if (!item.restaurant) return;
      RESTAURANTS_BY_NAME[item.restaurant.name] = item.restaurant;
      if (item.restaurant.backup) RESTAURANTS_BY_NAME[item.restaurant.backup.name] = item.restaurant.backup;
    });
  });

  // Three-way directions picker — Google Maps, Apple Maps, Waze. All three
  // are standard, keyless universal-link formats (no API key for any of
  // them): Google opens maps.google.com, Apple Maps opens maps.apple.com
  // (works on iOS/macOS, falls back to a web preview elsewhere), Waze opens
  // waze.com/ul (falls back to the Waze web site if the app isn't
  // installed). Behavior when tapped (native app vs. web fallback) depends
  // on the visitor's device/installed apps - not something verifiable from
  // a headless browser, only that the links themselves are well-formed.
  function directionsLinksHTML(query) {
    var q = encodeURIComponent(query);
    return '<span class="directions-group">' +
      '<a href="https://maps.google.com/?q=' + q + '" target="_blank" rel="noopener">🗺️ Google</a>' +
      '<a href="https://maps.apple.com/?q=' + q + '" target="_blank" rel="noopener">🧭 Apple</a>' +
      '<a href="https://waze.com/ul?q=' + q + '&navigate=yes" target="_blank" rel="noopener">🚗 Waze</a>' +
      '</span>';
  }

  // Pulls a duration ("45 min", "2h30m", "40-50 min") out of a Transport
  // item's own text, ANCHORED to the start of whatever follows the text's
  // last " — " or " · " separator - the consistent convention this data
  // uses for "action — duration [via road] [(distance)]" (e.g. "Drive to
  // Juno Beach — 45 min via D514"). Anchoring to the start of that trailing
  // segment (not just searching the whole string) deliberately avoids
  // false-matching a number that isn't a travel duration but happens to
  // share a unit word later in the same sentence - e.g. "Check in for
  // Brittany Ferries... — boarding opens approx. 90 min before departure"
  // is a check-in WINDOW, not how long the crossing takes, and correctly
  // returns null here since "boarding opens" precedes the number. Returns
  // null (never a fabricated/guessed value) for anything that isn't in
  // this shape, rather than trying to parse free-form prose everywhere.
  function parseTransportDuration(text) {
    if (!text) return null;
    var lastDash = text.lastIndexOf(' — ');
    var lastDot = text.lastIndexOf(' · ');
    var cut = Math.max(lastDash, lastDot);
    var segment = cut === -1 ? text : text.slice(cut + 3);
    var m = segment.match(/^\s*(?:approx\.?\s*~?)?(\d+\s?h\s?\d*m|\d+(?:[–-]\d+)?\s*(?:min|mins|minutes)|\d+\s*(?:hrs?|hours?))\b/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  }

  // Converts a parseTransportDuration() string ("2h30m", "50 min",
  // "40-50 min") into a minute count, for computing a Transport item's
  // implied end time when it has no explicit end_time - the same class of
  // fix already applied to Flight items below (see the day-block loop's
  // "thisEnd" comment): without this, a Transport item with a real
  // multi-hour duration in its own text but no end_time gets treated as a
  // zero-duration point event, and the free-time detector then counts the
  // ENTIRE drive itself as unscheduled "free time." A range ("40-50 min")
  // conservatively uses the upper bound, since underestimating a drive's
  // duration only makes the false-free-time overstatement worse.
  function parseTransportDurationMinutes(text) {
    var d = parseTransportDuration(text);
    if (!d) return null;
    var hm = d.match(/^(\d+)\s?h\s?(\d*)m$/i);
    if (hm) return parseInt(hm[1], 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);
    var hoursOnly = d.match(/^(\d+)\s*(?:hrs?|hours?)$/i);
    if (hoursOnly) return parseInt(hoursOnly[1], 10) * 60;
    var range = d.match(/^(\d+)[–-](\d+)\s*(?:min|mins|minutes)$/i);
    if (range) return parseInt(range[2], 10);
    var minsOnly = d.match(/^(\d+)\s*(?:min|mins|minutes)$/i);
    if (minsOnly) return parseInt(minsOnly[1], 10);
    return null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------------------------------------------------------
     NAVIGATION — continuous scroll with scroll-spy active-nav
     highlighting. Matches zurich-pwa's real, current mechanism
     (confirmed by reading its actual source directly): every section
     lives in the page's normal flow all the time - nothing is hidden
     and shown on click anymore. A nav-chip click smooth-scrolls to its
     section; a scroll listener keeps the nav highlight in sync with
     whatever section the user has actually scrolled to, unprompted -
     exactly the "tabs auto-advance as you scroll" behavior the real
     site has and this build's earlier click-only tab system did not.
     --------------------------------------------------------- */
  var navChips = Array.prototype.slice.call(document.querySelectorAll('.nav-chip'));
  var tabSections = Array.prototype.slice.call(document.querySelectorAll('.tab-section'));
  var navTapLock = false;
  var navTapTimer = null;

  function scrollToSection(targetId) {
    var el = document.getElementById(targetId);
    if (!el) return;
    navChips.forEach(function (c) { c.classList.toggle('active', c.dataset.target === targetId); });
    lastActiveSection = targetId;
    navTapLock = true;
    clearTimeout(navTapTimer);
    // Give the smooth scroll time to finish before scroll-spy can override
    // the just-clicked chip - otherwise a fast scroll-spy tick mid-animation
    // can flicker the highlight back to whatever section is passing by.
    navTapTimer = setTimeout(function () { navTapLock = false; }, 1000);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  navChips.forEach(function (chip) {
    chip.addEventListener('click', function () { scrollToSection(chip.dataset.target); });
  });

  var lastActiveSection = tabSections.length ? tabSections[0].id : null;
  function onScroll() {
    if (navTapLock) return;
    var navH = 96; // clearance below the sticky nav
    var active = lastActiveSection;
    tabSections.forEach(function (s) {
      if (s.getBoundingClientRect().top <= navH) active = s.id;
    });
    if (active && active !== lastActiveSection) {
      lastActiveSection = active;
      navChips.forEach(function (c) { c.classList.toggle('active', c.dataset.target === active); });
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------------------------------------------------
     HERO
     --------------------------------------------------------- */
  document.getElementById('heroRoute').textContent = TRIP.destination;
  document.getElementById('heroMeta').textContent = TRIP.meta;
  document.title = TRIP.destination + ' · ' + TRIP.meta;

  // Hero photo carousel - picks a different photo on each page load (a
  // real rotation, not just a static hero). Filters out any leftover
  // PHOTO_URL_* placeholder entries, so this degrades cleanly to the plain
  // gradient background (see .hero's CSS) if HERO_PHOTOS is ever emptied
  // back out. Accepts both real http(s) URLs and local relative paths
  // (e.g. 'images/london.jpg') since the actual photos are hosted locally.
  (function renderHeroPhoto() {
    var el = document.getElementById('heroPhoto');
    if (!el) return;
    var real = HERO_PHOTOS.filter(function (u) { return !/^PHOTO_URL_/.test(u); });
    if (!real.length) return;
    var pick = real[Math.floor(Math.random() * real.length)];
    el.style.backgroundImage = 'url(\'' + pick + '\')';
  })();

  // Trip countdown - computed from the real trip dates (Oct 12-26 2026),
  // not a static string, so it stays correct no matter when the page loads.
  (function renderCountdown() {
    var el = document.getElementById('countdownBadge');
    if (!el) return;
    var totalDays = (TRIP.days || []).length;
    if (!totalDays) return;
    var tripStart = new Date(2026, 9, 12); tripStart.setHours(0, 0, 0, 0);
    var tripEnd = new Date(tripStart); tripEnd.setDate(tripEnd.getDate() + totalDays - 1);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var msPerDay = 86400000;
    var daysUntilStart = Math.round((tripStart - today) / msPerDay);
    if (daysUntilStart > 0) {
      el.textContent = '✈ ' + daysUntilStart + (daysUntilStart === 1 ? ' day' : ' days') + ' until departure';
    } else if (today <= tripEnd) {
      var dayNum = Math.round((today - tripStart) / msPerDay) + 1;
      el.textContent = '📍 Day ' + dayNum + ' of ' + totalDays + ' — enjoy the trip';
    } else {
      el.textContent = '✓ Trip complete — hope it was a ripshit adventure';
    }
  })();

  /* ---------------------------------------------------------
     OVERVIEW: city cards + logistics + arc
     --------------------------------------------------------- */
  var cityCardsEl = document.getElementById('cityCards');
  // Ground truth is the actual day count (N days = N-1 nights), NOT a sum of
  // cities[].nights - a city's own nights entry only covers nights actually
  // spent THERE, so a night spent in transit (e.g. this trip's overnight
  // EWR-LHR flight, or the overnight Portsmouth-Ouistreham ferry, neither of
  // which belongs to any city) is real trip time that a naive sum silently
  // drops. Summing cities[].nights here gives 12
  // (5 London + 3 Normandy + 4 Porto), while the trip is
  // genuinely 14 nights (days.length - 1) - the missing two are the
  // overnight-flight night and the overnight-ferry night, which the hero's
  // own meta line spells out explicitly.
  var totalTripNights = (TRIP.days || []).length ? (TRIP.days.length - 1) : 0;
  var tripNightsTotalEl = document.getElementById('tripNightsTotal');
  if (tripNightsTotalEl) tripNightsTotalEl.textContent = totalTripNights;
  (TRIP.cities || []).forEach(function (c) {
    var card = document.createElement('div');
    card.className = 'city-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', 'false');

    var pct = totalTripNights ? Math.round((Number(c.nights) || 0) / totalTripNights * 100) : 0;
    var color = CITY_COLORS[c.name] || '#8a8f98';
    // Plain "X of Y nights" instead of a bare percentage - a raw "45%" next
    // to a bar reads as ambiguous (45% of what?) without a legend attached
    // to every single card; a fraction is self-explanatory on its own, and
    // the shared caption above the card list explains what the bar itself
    // (fill width) represents.
    var nightsLabel = esc(c.nights) + ' of ' + totalTripNights + ' nights';
    var flag = CITY_FLAGS[c.name] || '';
    // c.focus is a free-text highlight list (e.g. "WWII history — Churchill War
    // Rooms, Imperial War Museum, Battle of Britain Bunker") — split it into
    // individual chips for the expanded view rather than one dense sentence.
    var focusChips = (c.focus || '')
      .split(/—|,/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    card.innerHTML =
      '<div class="city-card-head">' +
        '<div class="city-card-flag">' + flag + '</div>' +
        '<div class="city-card-name">' + esc(c.name) + '</div>' +
        '<div class="city-card-bar-track"><div class="city-card-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        '<div class="city-card-nights">' + nightsLabel + '</div>' +
        '<div class="city-card-chevron">▾</div>' +
      '</div>' +
      '<div class="city-card-body-outer"><div class="city-card-body-inner"><div class="city-card-body">' +
        '<div class="nights-detail">' + esc(c.days_range) + '</div>' +
        '<div class="stay">' + esc(c.stay) + '</div>' +
        (c.transport_in ? '<div class="city-transport-in">→ ' + esc(c.transport_in) + '</div>' : '') +
        (focusChips.length ? '<div class="city-card-focus">' + focusChips.map(function (f) {
          return '<span class="city-card-focus-chip">' + esc(f) + '</span>';
        }).join('') + '</div>' : '') +
        '<div class="wx" id="wx-' + esc(c.name) + '"><span class="wx-loading">Loading weather…</span></div>' +
      '</div></div></div>';

    function toggleCard() {
      var isExpanded = card.classList.toggle('expanded');
      card.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }
    card.addEventListener('click', toggleCard);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(); }
    });

    cityCardsEl.appendChild(card);
  });

  var logisticsEl = document.getElementById('logisticsChips');
  (TRIP.logistics || []).forEach(function (l) {
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = l;
    logisticsEl.appendChild(tag);
  });

  document.getElementById('arcText').textContent =
    (TRIP.introduction && TRIP.introduction.arc) || '';

  document.getElementById('footerNote').textContent =
    'Generated ' + (TRIP.generatedOn || '') + ' · Weather, map, and local search are live. Verify addresses/hours before relying on them for bookings.';

  /* ---------------------------------------------------------
     ITEM CARD (shared by condensed + city tabs)
     --------------------------------------------------------- */
  function itemExtra(item) {
    var bits = [];
    if (item.restaurant && item.restaurant.name) bits.push(item.restaurant.name);
    if (item.hotel && item.hotel.name) bits.push(item.hotel.name);
    return bits;
  }

  // The user is driving themselves, not hiring a private driver - the
  // source plan's wording assumed a chauffeur service that was never
  // requested. Swap the framing at render time (data itself is untouched).
  // Which hotel is actually being slept at THIS specific day. day.city is
  // NOT reliable for this on a transit day (it reflects where the day's
  // activities happen, not where the night is spent - documented failure
  // mode) - check for an actual check-in item first, only fall back to the
  // city-level hotel mapping when there isn't one.
  function resolveDayHotelName(day) {
    var checkin = null;
    (day.items || []).forEach(function (it) {
      if (it.type === 'Hotel' && it.hotel && it.hotel.name && /check[\s-]?in/i.test(it.text || '')) {
        checkin = it.hotel.name;
      }
    });
    if (checkin) return checkin;
    var fallback = null;
    Object.keys(PINS.hotels || {}).forEach(function (name) { if (PINS.hotels[name].city === day.city) fallback = name; });
    return fallback;
  }

  // Extract a clean "to <destination>" from a Transport item's free text so
  // the maps links navigate to an actual place, not the raw sentence
  // ("Drive to Juno Beach — 45 min via D514" -> "Juno Beach"). Falls back
  // to null (caller uses the existing generic fallback) when no "to X"
  // phrase is present, e.g. a pickup event that isn't itself a destination.
  function parseTransportDestination(text, day) {
    if (!text) return null;
    // Using exec() in a loop (not .match() with /g) because .match() with
    // the global flag discards capture groups and returns whole matches
    // instead - which silently included the trailing delimiter ("Juno
    // Beach —" instead of "Juno Beach"), breaking the hotel-name check
    // below since "hotel —" doesn't match /\bhotel$/. Caught by testing
    // before push, not assumed correct.
    var re = /\bto\s+([^—·(]+?)(?:\s*[—·(]|\s+for\b|$)/gi;
    var m, last = null;
    while ((m = re.exec(text)) !== null) { last = m[1]; }
    if (!last) return null;
    var dest = last.trim();
    if (!dest) return null;
    if (/\bhotel$/i.test(dest)) {
      return resolveDayHotelName(day) || dest;
    }
    return dest;
  }

  function renderItemHTML(item, day) {
    var icon = ITEM_ICONS[item.type] || '•';
    var extras = itemExtra(item);
    var displayText = item.text;
    var searchTarget = extras[0] || (item.location ? item.location : item.text) || (day.city || '');
    if (item.type === 'Transport') {
      var driveDest = parseTransportDestination(item.text, day);
      if (driveDest) searchTarget = driveDest;
    }
    var timeLine = esc(formatTime12(item.time)) + (item.end_time ? '–' + esc(formatTime12(item.end_time)) : '');
    var flightWarn = '';
    if (item.type === 'Flight' && item.flight) {
      var f = item.flight;
      // Flight items previously only showed the departure time, leaving a
      // long unexplained gap to whatever the next item was - show arrival
      // too, same info the Air & Hotel tab already has. For an overnight
      // flight, item.time is deliberately set to the ARRIVAL time (so the
      // item sorts into the correct day/position) rather than the departure
      // time, which belongs to the previous calendar day - appending
      // "Arrives X" in that case just repeated the same time twice
      // ("9:35 AM · Arrives 9:35 AM"). Show the full Departs/Arrives pair
      // instead whenever item.time isn't the departure time.
      if (f.depart_time && f.arrive_time && f.depart_time !== item.time) {
        timeLine = 'Departs ' + esc(formatTime12(f.depart_time)) + ' → Arrives ' + esc(formatTime12(f.arrive_time));
      } else if (f.arrive_time) {
        timeLine += ' · Arrives ' + esc(formatTime12(f.arrive_time));
      }
      if (f._modelEstimatedFlightNumber) {
        flightWarn = '<div class="flight-warn">⚠ Flight number/time not checked against a live schedule — confirm with the airline before booking.</div>';
      }
    }
    if (item._locationUnverified) {
      flightWarn += '<div class="flight-warn">⚠ ' + esc(item._locationUnverified) + '</div>';
    }
    var driveDuration = item.type === 'Transport' ? parseTransportDuration(item.text) : null;
    var durationBadge = driveDuration ? '<span class="drive-duration">⏱ ' + esc(driveDuration) + '</span>' : '';
    // Transport items with a real contact (e.g. a ferry operator's booking
    // line/website) previously had that contact silently dropped - the
    // navigate-row only ever rendered directions links, never
    // item.contact.phone/website, even when populated. Append the same
    // phone/website treatment the non-Transport branch already gives,
    // rather than losing real, already-present contact data.
    var contactLinks = (item.contact && item.contact.phone ? '<a href="tel:' + esc(item.contact.phone) + '">' + esc(item.contact.phone) + '</a>' : '') +
      (item.contact && item.contact.website ? '<a href="' + esc(item.contact.website) + '" target="_blank" rel="noopener">Website</a>' : '');
    var navigateRow = item.type === 'Transport'
      ? '<div class="navigate-row"><span class="navigate-label">🧭 Navigate:</span>' + durationBadge + directionsLinksHTML(searchTarget + (day.city ? ', ' + day.city : '')) + contactLinks + '</div>'
      : '<div class="item-links">' + directionsLinksHTML(searchTarget + (day.city ? ', ' + day.city : '')) + contactLinks + '</div>';
    // A Dinner/Lunch/Breakfast item's own restaurant details (hours, price,
    // backup pick, menu popup trigger) previously rendered ONLY in the
    // separate Meals & Reservations list, invisible to anyone reading the
    // itinerary day-by-day in a city tab - the more common way to browse it.
    // restaurantCardHTML already includes its own directions/website links,
    // so it replaces navigateRow here rather than sitting alongside it.
    var restaurantBlock = item.restaurant
      ? '<div class="item-restaurant-card">' + restaurantCardHTML(item.restaurant) + '</div>'
      : navigateRow;
    return '<div class="item">' +
      '<div class="item-icon">' + icon + '</div>' +
      '<div class="item-body">' +
      '<div class="item-time">' + timeLine + '</div>' +
      '<div class="item-text">' + esc(displayText || '') + '</div>' +
      flightWarn +
      (item.why ? '<div class="item-why">' + esc(item.why) + '</div>' : '') +
      (item.logistics ? renderLogisticsRows(item.logistics) : '') +
      restaurantBlock +
      '</div></div>';
  }

  // Wear/Expect/Arrive rows — adapted from santafe-itinerary's per-activity
  // accordion pattern, scoped to this trip's genuinely bookable/guided
  // experiences (timed-entry sites, private tastings/tours) rather than
  // every single item. General practical planning guidance, explicitly
  // labeled as such — never a substitute for the venue's own real address/
  // hours/phone, which come from the verified contact/hotel/restaurant
  // fields elsewhere.
  function renderLogisticsRows(l) {
    var rows = [];
    if (l.wear) rows.push(['Wear', l.wear]);
    if (l.expect) rows.push(['Expect', l.expect]);
    if (l.meet) rows.push(['Arrive', l.meet]);
    if (!rows.length) return '';
    return '<div class="logistics-rows">' + rows.map(function (r) {
      return '<div class="logistics-row"><span class="logistics-label">' + esc(r[0]) + '</span><p>' + esc(r[1]) + '</p></div>';
    }).join('') + '<p class="logistics-disclaimer">General planning guidance — not a verified fact about this specific venue.</p></div>';
  }

  function toMinutes(t) {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    var p = t.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  // Several days had large silent gaps between a morning activity and an
  // evening dinner (e.g. 5-7 hours unaccounted for) with nothing telling
  // the reader it's unscheduled leisure time rather than a missing item -
  // label it honestly instead of leaving it silent. Threshold is 150 min;
  // doesn't invent an activity, just names the gap.
  var FREE_TIME_THRESHOLD_MIN = 150;
  function freeTimeCardHTML(gapMin) {
    var hrs = (gapMin / 60).toFixed(1).replace(/\.0$/, '');
    return '<div class="item free-time-item">' +
      '<div class="item-icon">🕐</div>' +
      '<div class="item-body"><div class="item-text">Free time (~' + hrs + ' hrs, unscheduled)</div></div></div>';
  }

  // day.weather is a plain string in this trip's real data (e.g. "High 59°F
  // / low 48°F · overcast with 40% chance of light rain") - not an object
  // with .summary/.condition fields, which a previous version of this
  // function assumed. That silently blanked the per-day weather line on
  // every city tab, since the object-shaped access always returned
  // undefined on a string. Fixed to read the string directly.
  function weatherAdvisory(weatherStr) {
    if (!weatherStr) return '';
    var hiMatch = weatherStr.match(/High\s+(\d+)°F/i);
    var loMatch = weatherStr.match(/low\s+(\d+)°F/i);
    var rainMatch = weatherStr.match(/(\d+)%/);
    var hi = hiMatch ? parseInt(hiMatch[1], 10) : null;
    var lo = loMatch ? parseInt(loMatch[1], 10) : null;
    var rainPct = rainMatch ? parseInt(rainMatch[1], 10) : null;
    var bits = [];
    if (rainPct != null && rainPct >= 30) bits.push('pack a rain layer');
    if (lo != null && lo <= 50) bits.push('mornings run cool — bring a jacket');
    if (hi != null && hi >= 70) bits.push('warm for the season — light layers work');
    if (!bits.length) return '';
    var joined = bits.join('; ');
    return joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
  }

  // Compact "weather chip" — collapsed to an icon + hi/lo temp range (an
  // infographic glance, not a sentence), expandable on click/tap to reveal
  // the full original text plus the advisory tip. Replaces the old
  // always-expanded .day-block-weather paragraph, which repeated a full
  // sentence on all 13 days regardless of whether the reader wanted the
  // detail. Parses the "High X°F / low Y°F · <condition>" shape
  // weatherAdvisory() above already parses (kept as a SEPARATE regex pass
  // rather than refactored to share one, since this one also needs an icon
  // + short-label lookup weatherAdvisory has no reason to do).
  // day-block-weather/.day-block-weather's plain-text rendering below is
  // kept only as a fail-safe for a weather string shaped too differently
  // for this regex to match at all (parseWeatherLine returns null), not
  // because any day in this trip's real data currently needs it.
  var WX_ICON_RULES = [
    [/thunderstorm/i, '⛈️'],
    [/snow/i, '❄️'],
    [/rain|drizzle|shower/i, '🌧️'],
    [/fog/i, '🌫️'],
    [/overcast/i, '☁️'],
    [/cloud/i, '⛅'],
    [/sun|clear|dry/i, '☀️']
  ];
  var WX_SHORT_RULES = [
    [/overcast/i, 'Overcast'],
    [/thunderstorm/i, 'Storms'],
    [/heavy rain/i, 'Heavy rain'],
    [/light rain|drizzle/i, 'Light rain'],
    [/rain/i, 'Rain likely'],
    [/shower/i, 'Showers'],
    [/snow/i, 'Snow'],
    [/fog/i, 'Foggy'],
    [/partly cloudy|partly sunny/i, 'Partly cloudy'],
    [/mostly cloudy/i, 'Mostly cloudy'],
    [/mostly sunny|sun with high clouds/i, 'Mostly sunny'],
    [/sunny|clear/i, 'Clear'],
    [/cloud/i, 'Cloudy'],
    [/dry/i, 'Dry']
  ];
  function pickFirst(rules, text, fallback) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(text)) return rules[i][1];
    }
    return fallback;
  }
  function parseWeatherLine(weatherStr) {
    if (!weatherStr) return null;
    var m = weatherStr.match(/High\s+(-?\d+)°F\s*\/\s*low\s+(-?\d+)°F\s*·\s*(.*)/i);
    if (!m) return null;
    return {
      hi: m[1], lo: m[2], detail: m[3],
      icon: pickFirst(WX_ICON_RULES, m[3], '🌤️'),
      short: pickFirst(WX_SHORT_RULES, m[3], m[3].split(',')[0].split(';')[0])
    };
  }

  function renderDayBlockHTML(day, dayNum) {
    var weatherLine = (typeof day.weather === 'string' && day.weather) || '';
    var advisory = weatherAdvisory(weatherLine);
    var wx = parseWeatherLine(weatherLine);
    // Day banner: a thin navy divider per day, matching the real
    // .day-banner pattern (eyebrow "DAY N" + the date) - sits right above
    // each day's own content, same as it does directly under the location
    // banner for a city's first day in the confirmed real reference.
    var labelParts = (day.label || '').split('·').map(function (s) { return s.trim(); });
    var dayBanner = '<div class="day-banner">' +
      '<div class="day-banner-eyebrow">' + esc((labelParts[0] || '').toUpperCase()) + '</div>' +
      '<div class="day-banner-title">' + esc(labelParts[1] || '') + '</div>' +
      '</div>';
    var html = dayBanner + '<div class="day-block" id="day-' + dayNum + '">' +
      '<div class="day-block-label">' + esc(day.label) + '</div>' +
      '<div class="day-block-headline">' + esc(day.headline) + '</div>' +
      (wx ?
        '<div class="wx-chip" role="button" tabindex="0" aria-expanded="false">' +
          '<span class="wx-chip-icon">' + wx.icon + '</span>' +
          '<span class="wx-chip-temp">' + esc(wx.hi) + '°/' + esc(wx.lo) + '°F</span>' +
          '<span class="wx-chip-short">' + esc(wx.short) + '</span>' +
          '<span class="wx-chip-caret">⌄</span>' +
          '<div class="wx-chip-detail">' + esc(weatherLine) +
            (advisory ? '<p class="weather-tip">' + esc(advisory) + '</p>' : '') +
          '</div>' +
        '</div>' :
        (weatherLine ? '<div class="day-block-weather">' + esc(weatherLine) +
          (advisory ? '<p class="weather-tip">' + esc(advisory) + '</p>' : '') + '</div>' : ''));
    var items = day.items || [];
    items.forEach(function (item, i) {
      html += renderItemHTML(item, day);
      // A Flight item's own "end" is its arrival time (item.flight.arrive_time),
      // not its departure time (item.time) - using item.time here produced a
      // false ~14hr "free time" gap between an 8:20 AM departure/8:40 PM
      // arrival and the next item, caught by screenshot before push.
      // Same class of bug for Transport items: a drive/transfer with a real
      // multi-hour duration in its own text but no explicit end_time was
      // being treated as instantaneous, so the detector counted the ENTIRE
      // drive as unscheduled "free time" (caught on the Tank Museum day -
      // a stated "2h30m" drive showed as "~2.8 hrs free time" right after
      // it, when the real gap to the next item was ~15 minutes).
      var flightArrive = item.type === 'Flight' && item.flight ? toMinutes(item.flight.arrive_time) : null;
      var transportDurationMin = item.type === 'Transport' ? parseTransportDurationMinutes(item.text) : null;
      var transportEnd = transportDurationMin != null ? toMinutes(item.time) + transportDurationMin : null;
      var thisEnd = toMinutes(item.end_time) || flightArrive || transportEnd || toMinutes(item.time);
      var next = items[i + 1];
      var nextStart = next ? toMinutes(next.time) : null;
      // Skip when the next item is just an "Overnight at X" reminder - that's
      // bedtime, not meaningfully free/unscheduled time to call out.
      var nextIsOvernightReminder = next && next.type === 'Hotel' && /^overnight\b/i.test(next.text || '');
      if (thisEnd != null && nextStart != null && !nextIsOvernightReminder &&
          (nextStart - thisEnd) >= FREE_TIME_THRESHOLD_MIN) {
        html += freeTimeCardHTML(nextStart - thisEnd);
      }
    });
    html += '</div>';
    return html;
  }

  // Delegated (not per-element) so it works for every .wx-chip regardless of
  // which container rendered it (city tabs, condensed list) without needing
  // to re-bind after each innerHTML render.
  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('.wx-chip');
    if (!chip) return;
    var open = chip.getAttribute('aria-expanded') === 'true';
    chip.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var chip = e.target.closest && e.target.closest('.wx-chip');
    if (!chip) return;
    e.preventDefault();
    var open = chip.getAttribute('aria-expanded') === 'true';
    chip.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  /* ---------------------------------------------------------
     CITY TABS — group days by city
     --------------------------------------------------------- */
  CITIES.forEach(function (cityName) {
    var container = document.getElementById('cityDays-' + cityName);
    if (!container) return;
    var html = '';
    var dayNums = [];
    (TRIP.days || []).forEach(function (day, idx) {
      if (day.city === cityName) {
        html += renderDayBlockHTML(day, idx + 1);
        dayNums.push(idx + 1);
      }
    });
    if (!html) { container.innerHTML = '<p class="ai-note">No days assigned to this city.</p>'; return; }
    // Quick-jump nav so a 5-day city tab (e.g. London) doesn't force scrolling
    // past every earlier day to reach the one you actually want.
    var jumpNav = dayNums.length > 1
      ? '<div class="day-jump-nav">' + dayNums.map(function (n) {
          return '<a href="#day-' + n + '" class="day-jump-pill">Day ' + n + '</a>';
        }).join('') + '</div>'
      : '';
    container.innerHTML = jumpNav + html;
  });

  /* ---------------------------------------------------------
     CONDENSED — compact one-line-per-item list
     --------------------------------------------------------- */
  var condensedEl = document.getElementById('condensedList');
  (function renderCondensed() {
    var html = '';
    (TRIP.days || []).forEach(function (day, idx) {
      var color = CITY_COLORS[day.city] || '#8a8f98';
      var flag = CITY_FLAGS[day.city] || '';
      // A left accent bar + flag give an instant "which leg of the trip am I
      // looking at" cue while scrolling a long, all-days-at-once list - city
      // tabs already split this apart, but Condensed deliberately shows
      // everything back to back with nothing else marking the boundary.
      html += '<div class="cond-day" style="border-left-color:' + color + '">' +
        '<div class="cond-day-head">' +
          (flag ? '<span class="cond-day-flag">' + flag + '</span>' : '') +
          '<span class="cond-day-label">' + esc(day.label) + '</span>' +
        '</div>' +
        // The headline already exists on every day (it's the same one-line
        // "what this day is about" shown at the top of the day-tab card) but
        // Condensed never rendered it - without it this view was just a flat
        // list of times and venue names with no sense of the day's shape.
        (day.headline ? '<div class="cond-day-headline">' + esc(day.headline) + '</div>' : '');
      (day.items || []).forEach(function (item) {
        var name = (item.restaurant && item.restaurant.name) || (item.hotel && item.hotel.name) || '';
        var unverifiedTag = (item.type === 'Flight' && item.flight && item.flight._modelEstimatedFlightNumber)
          ? ' <span class="cond-warn">⚠ unverified schedule</span>'
          : (item._locationUnverified ? ' <span class="cond-warn">⚠ unverified</span>' : '');
        var condText = item.text;
        var condTimeLabel = (item.type === 'Flight' && item.flight && item.flight.depart_time && item.flight.depart_time !== item.time)
          ? 'Arrives ' + formatTime12(item.time)
          : formatTime12(item.time);
        var icon = ITEM_ICONS[item.type] || '•';
        html += '<div class="cond-row">' +
          '<div class="cond-row-icon">' + icon + '</div>' +
          '<div class="cond-row-body">' +
            '<span class="cond-time">' + esc(condTimeLabel) + '</span>' +
            esc(condText || '') + (name ? ' — <strong>' + esc(name) + '</strong>' : '') + unverifiedTag +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    });
    condensedEl.innerHTML = html;
  })();

  /* ---------------------------------------------------------
     MEALS & RESERVATIONS — built from real reservation.platform,
     never a fabricated confirmation status (see plan notes: this
     trip's data has no confirmation-tracking field at all).
     --------------------------------------------------------- */
  var mealsEl = document.getElementById('mealsList');
  (function renderMeals() {
    var rows = [];
    (TRIP.days || []).forEach(function (day, idx) {
      (day.items || []).forEach(function (item) {
        if (!item.restaurant) return;
        rows.push({ day: day.label, time: item.time, r: item.restaurant });
      });
    });
    if (!rows.length) { mealsEl.innerHTML = '<p class="ai-note">No restaurant reservations in this plan.</p>'; return; }
    // restaurantCardHTML/restaurantDetailLines are the SAME shared helpers
    // renderItemHTML uses for a restaurant item's day-by-day card - kept as
    // one function so a booking's backup/hours/price don't drift between
    // the two places a reader might see it (see CLAUDE.md).
    mealsEl.innerHTML = rows.map(function (row) {
      var r = row.r;
      var contact = r.contact || {};
      return '<div class="meal-row">' +
        '<div class="meal-meta">' + esc(row.day) + ' · ' + esc(formatTime12(row.time)) +
        (contact.address ? ' · ' + esc(contact.address) : '') + '</div>' +
        restaurantCardHTML(r) +
        '</div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     ESSENTIALS — real hotel data + general reference
     --------------------------------------------------------- */
  (function renderEssentials() {
    var hotelsByName = {};
    (TRIP.days || []).forEach(function (day) {
      (day.items || []).forEach(function (item) {
        if (item.hotel && item.hotel.name) {
          var h = hotelsByName[item.hotel.name] || {};
          Object.keys(item.hotel).forEach(function (k) { if (item.hotel[k] && !h[k]) h[k] = item.hotel[k]; });
          hotelsByName[item.hotel.name] = h;
        }
      });
    });
    var el = document.getElementById('essentialsHotels');
    el.innerHTML = Object.keys(hotelsByName).map(function (name) {
      var h = hotelsByName[name];
      return '<div class="ref-card"><div class="ref-title">' + esc(name) + '</div>' +
        (h.address ? '<div class="ref-line">' + esc(h.address) + '</div>' : '') +
        (h.phone ? '<div class="ref-line"><a href="tel:' + esc(h.phone) + '">' + esc(h.phone) + '</a></div>' : '') +
        (h.website ? '<div class="ref-line"><a href="' + esc(h.website) + '" target="_blank" rel="noopener">Website</a></div>' : '') +
        hotelCheckTimesLine(h) +
        (h.confirmation_note ? '<div class="ref-line ai-note">' + esc(h.confirmation_note) + '</div>' : '') +
        '</div>';
    }).join('');

    var general = {
      'Currency': 'UK: Pound sterling (GBP). France/Portugal: Euro (EUR). Contactless cards are widely accepted in all three countries.',
      'Power outlets': 'UK uses Type G plugs (230V). France and Portugal use Type C/E/F plugs (230V) — a UK adapter will NOT work in Normandy/Porto and vice versa.',
      'Emergency number': 'UK: 999 or 112. France, Portugal: 112 (EU-wide emergency number works in both).',
      'Tipping': 'UK: not obligatory, 10-12.5% if no service charge added. France: service is usually included, round up or leave small change. Portugal: not expected, rounding up is appreciated.',
      'Health & water': 'Tap water is safe to drink in London, Normandy, and Porto. No special vaccinations are required for typical US travelers to the UK, France, or Portugal — check with your doctor or a travel clinic if you have specific health needs. Pharmacies (marked with a green cross) can handle minor ailments without a doctor visit.',
      'Travel insurance': 'None of these three countries have a reciprocal healthcare agreement with the US — a travel insurance policy covering medical care, evacuation, and trip interruption is strongly recommended for a trip this length.',
      'Staying connected': 'An eSIM covering the UK + EU roaming zone (e.g. Airalo, Holafly, or your carrier\'s international day-pass) is the simplest way to have data in all three countries without swapping physical SIM cards. Hotel and cafe wifi is also widely available.'
    };
    document.getElementById('essentialsGeneral').innerHTML = Object.keys(general).map(function (k) {
      return '<div class="ref-card"><div class="ref-title">' + esc(k) + '</div><div class="ref-line">' + esc(general[k]) + '</div></div>';
    }).join('');

    // Each entry ties to a SPECIFIC moment on this itinerary (the overnight
    // ferry, the rural Normandy driving days, the Andante top-up) —
    // deliberately not a generic "useful apps abroad" list.
    var APPS = [
      { name: 'Citymapper or TfL Go', why: 'London routing across Tube/bus/Overground — either works well; TfL Go is the official app with live disruption alerts.' },
      { name: 'Google Maps — download OFFLINE areas for Normandy', why: 'Rural coverage between Bayeux, the D-Day beaches, and Mont-Saint-Michel can be spotty. Download the Normandy region for offline use before you leave London; this site itself works offline too (see the install prompt) but it isn\'t turn-by-turn navigation.' },
      { name: 'Uber AND Bolt (both)', why: 'Coverage and pricing differ by city — Bolt is often cheaper/more available in Porto and France than Uber alone. Worth having both installed rather than picking one in advance.' },
      { name: 'Andante Porto', why: 'Top up Porto\'s transit card directly from your phone instead of hunting for a station machine.' },
      { name: 'An eSIM app (Airalo, Holafly, or similar)', why: 'Install and set up the eSIM profile BEFORE departure — activating it is much easier on home wifi than fumbling with it at Heathrow arrivals.' },
      { name: 'WhatsApp', why: 'The default way small tour operators and some restaurants in France/Portugal actually communicate — useful to have installed in case a driver or restaurant reaches out this way to confirm details.' },
      { name: 'Your bank/card app', why: 'Check it has real-time foreign-transaction alerts and no foreign transaction fee before you go — cheaper and safer than carrying much cash across two currencies (GBP, then EUR).' }
    ];
    document.getElementById('essentialsApps').innerHTML = APPS.map(function (a) {
      return '<div class="ref-card"><div class="ref-title">' + esc(a.name) + '</div><div class="ref-line">' + esc(a.why) + '</div></div>';
    }).join('');

    // Before You Go — entry requirements are the single most time-sensitive
    // pre-trip action item (can block travel entirely if missed), so this
    // gets its own prominent callout above everything else on the tab
    // rather than being buried as one more item in the general list.
    document.getElementById('beforeYouGo').innerHTML =
      '<div class="byg-card">' +
      '<div class="byg-title">⚠ Before You Go — Entry Requirements</div>' +
      '<div class="byg-line"><strong>UK (London):</strong> US citizens need an Electronic Travel Authorisation (ETA) approved before flying in — apply online well ahead of departure. This is separate from, and in addition to, your passport.</div>' +
      '<div class="byg-line"><strong>EU (Normandy, Porto):</strong> The EU\'s ETIAS travel authorization has been repeatedly delayed but is expected to apply to US visa-exempt travelers by the time frame of this trip — check current status and apply if required before departure.</div>' +
      '<div class="byg-line"><strong>Passport:</strong> Valid at least 6 months past the Oct 26, 2026 return date (already on the packing list) and issued within the last 10 years for Schengen entry.</div>' +
      '<div class="byg-line">Requirements and processing times change — verify the current rules directly (gov.uk for the UK ETA, the official EU ETIAS site) close to departure rather than relying on this note alone.</div>' +
      '</div>';

    // Emergency & consular contacts — one nearest post per leg of the trip.
    var embassies = [
      { city: 'London', name: 'U.S. Embassy London', note: 'Covers the UK leg directly.' },
      { city: 'Normandy', name: 'U.S. Embassy Paris', note: 'Nearest major U.S. diplomatic post to Normandy.' },
      { city: 'Porto', name: 'U.S. Embassy Lisbon', note: 'Nearest major U.S. diplomatic post to Porto.' }
    ];
    document.getElementById('essentialsEmbassy').innerHTML = embassies.map(function (e) {
      return '<div class="ref-card"><div class="ref-title">' + esc(e.city) + ' — ' + esc(e.name) + '</div>' +
        '<div class="ref-line">' + esc(e.note) + ' Search "' + esc(e.name) + '" for current address, phone, and after-hours emergency contact.</div></div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     TRANSPORT QUICK REFERENCE — every transfer/flight in the plan, in
     order. The drive/transfer duration is already embedded in each
     Transport item's own text field (e.g. "Drive to Juno Beach — 45 min
     via D514") - this just pulls every one of those into one scannable
     list instead of leaving them buried inside each day's card stack.
     --------------------------------------------------------- */
  (function renderTransportQuickRef() {
    var rows = [];
    (TRIP.days || []).forEach(function (day, idx) {
      (day.items || []).forEach(function (item) {
        if (item.type !== 'Transport' && item.type !== 'Flight') return;
        rows.push({ dayNum: idx + 1, dayLabel: day.label, item: item, day: day });
      });
    });
    var el = document.getElementById('transportQuickRef');
    if (!rows.length) { el.innerHTML = '<p class="ai-note">No transport/flight items in this plan.</p>'; return; }
    el.innerHTML = rows.map(function (row) {
      var item = row.item;
      var icon = ITEM_ICONS[item.type] || '•';
      var flightLine = '';
      var flightWarn = '';
      if (item.type === 'Flight' && item.flight) {
        var f = item.flight;
        flightLine = '<div class="ref-line">' + esc(f.from_airport || '') + ' → ' + esc(f.to_airport || '') +
          (f.duration ? ' · ' + esc(f.duration) : '') + (f.nonstop ? ' · Nonstop' : '') + '</div>';
        if (f._modelEstimatedFlightNumber) {
          flightWarn = '<div class="flight-warn">⚠ Flight number/time not checked against a live schedule — confirm with the airline before booking.</div>';
        }
      }
      var navLine = '';
      if (item.type === 'Transport') {
        var dest = parseTransportDestination(item.text, row.day);
        var query = (dest || item.text || '') + (row.day.city ? ', ' + row.day.city : '');
        var refDuration = parseTransportDuration(item.text);
        var refDurationBadge = refDuration ? '<span class="drive-duration">⏱ ' + esc(refDuration) + '</span>' : '';
        // Same fix as renderItemHTML's navigateRow - a Transport item's own
        // contact.phone/website (e.g. a ferry operator) was silently
        // dropped here too, a second independent render path with the
        // identical gap.
        var refContactLinks = (item.contact && item.contact.phone ? '<a href="tel:' + esc(item.contact.phone) + '">' + esc(item.contact.phone) + '</a>' : '') +
          (item.contact && item.contact.website ? '<a href="' + esc(item.contact.website) + '" target="_blank" rel="noopener">Website</a>' : '');
        navLine = '<div class="navigate-row"><span class="navigate-label">🧭 Navigate:</span>' + refDurationBadge + directionsLinksHTML(query) + refContactLinks + '</div>';
      }
      var refText = item.text;
      // Same overnight-flight case as the item-card renderer: item.time is
      // the arrival time when it differs from flight.depart_time, so label
      // it explicitly instead of showing a bare time that reads as departure.
      var timeLabel = (item.type === 'Flight' && item.flight && item.flight.depart_time && item.flight.depart_time !== item.time)
        ? 'Arrives ' + esc(formatTime12(item.time))
        : esc(formatTime12(item.time));
      return '<div class="ref-card">' +
        '<div class="ref-title">' + icon + ' Day ' + row.dayNum + ' · ' + timeLabel + '</div>' +
        '<div class="ref-line">' + esc(refText || '') + '</div>' +
        flightLine +
        flightWarn +
        navLine +
        '</div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     TRANSIT — general per-city reference
     --------------------------------------------------------- */
  (function renderTransit() {
    var content = {
      London: [
        'Contactless card or phone tap works directly on the Tube, buses, and Overground — no need for an Oyster card, and it auto-caps at the daily fare. Black cabs can be hailed on the street and take contactless too; Uber/Bolt also operate widely. Heathrow Express runs every 15 min to Paddington.',
        'Stand on the RIGHT on Tube escalators — blocking the left side (the walking lane) is a real, noticeable local irritant, especially at rush hour.',
        'The Underground map is topological, not geographic — two "adjacent" stations can be a 15-minute walk apart above ground. Worth checking a real map before assuming a Tube ride is the fastest option for a short hop.',
        'Pubs: order and pay at the bar, no table service unless it\'s a gastropub. Tipping at the bar isn\'t expected.'
      ],
      Normandy: [
        'Rural and car-dependent — Bayeux, the D-Day beaches, and Mont-Saint-Michel have limited public transit. A private driver or rental car is the practical way to cover these sites in a day; taxis exist in Bayeux but are sparse.',
        'Small-town shops (Bayeux included) commonly close for a long lunch, roughly 12:30–2pm, and many close entirely on Mondays — worth knowing for Day 9\'s self-guided Bayeux day specifically.',
        'A simple "Bonjour" before asking anything in a shop or café isn\'t optional politeness here — skipping straight to a question reads as genuinely rude, even in tourist-heavy spots.',
        'Fuel up before a rural drive (especially to Mont-Saint-Michel) — small-town stations can be sparse, and many switch to card-only, unattended pumps overnight.'
      ],
      Porto: [
        'The Andante card covers metro, bus, and some train lines — buy and top up at metro station machines or the Andante app. The historic center (Ribeira, Clérigos) is steep and best walked; Uber/Bolt are common for the Vila Nova de Gaia crossing or longer trips.',
        'Meal times run later than a US traveler expects — lunch from ~12:30pm, dinner rarely starts before 7:30–8pm; showing up at 6pm may mean an empty, still-prepping restaurant.',
        'The Elevador dos Guindais funicular is a cheap, fast way to skip the steepest Ribeira-to-upper-town climb — useful for Day 11\'s evening Ribeira walk.',
        'Vinho verde (a young, slightly sparkling white/rosé) is the everyday casual wine here — don\'t confuse it with the fortified Port being toured/tasted in Vila Nova de Gaia; they\'re unrelated styles from the same region.'
      ]
    };
    document.getElementById('transitList').innerHTML = CITIES.map(function (c) {
      var tips = content[c] || [];
      return '<div class="ref-card"><div class="ref-title">' + esc(c) + '</div>' +
        tips.map(function (t) { return '<div class="ref-line">' + esc(t) + '</div>'; }).join('') +
        '</div>';
    }).join('');
  })();


  /* ---------------------------------------------------------
     HISTORY — AI-authored general context (labeled at top of tab)
     --------------------------------------------------------- */
  (function renderHistory() {
    // One entry per major stop rather than one per city - a 14-night trip
    // built around 6 distinct WWII sites (plus Mont-Saint-Michel, a major
    // non-WWII historical stop) reads thin at 4 entries. Each is tagged
    // with the day it corresponds to on THIS itinerary (cross-checked
    // against the real trip-data.json, not guessed) so it reads as
    // context for a specific day, not a detached encyclopedia list.
    // Historical claims here were verified via WebSearch as part of the
    // mandatory prose fact-check sweep (see CLAUDE.md).
    var entries = [
      { day: 'Day 3', title: 'Churchill War Rooms & the Cabinet War Rooms', body: 'The underground bunker beneath Whitehall where Churchill’s War Cabinet ran Britain’s war effort from 1939 to 1945, preserved largely as staff left it on VJ Day — the Map Room’s pins and grease-pencil marks are original. London itself was hit hard during the Blitz (1940–41); much of the East End and City were rebuilt after the war, and the scars are still visible in odd gaps in otherwise Victorian streetscapes.' },
      { day: 'Day 4', title: 'Imperial War Museum London', body: 'Founded in 1917 to document the First World War, IWM London’s collection now spans both World Wars and beyond, housed on the site of the former Bethlem Royal Hospital (“Bedlam”) on Lambeth Road. Its WWII galleries — the Blitz, the Holocaust exhibition, the home front — go deeper than any single site earlier in the trip.' },
      { day: 'Day 5', title: 'The Battle of Britain & the Uxbridge Bunker', body: 'In summer/autumn 1940, RAF Fighter Command’s No. 11 Group — directed from the underground Operations Room at RAF Uxbridge — coordinated the fighter squadrons that fought off the Luftwaffe’s assault on Britain’s airfields and cities. The battle’s outcome forced Hitler to indefinitely postpone Operation Sea Lion, the planned invasion of Britain. Churchill visited the gallery here on September 15, 1940 — the raid’s climax, still marked today as “Battle of Britain Day.”' },
      { day: 'Day 7', title: 'Armored warfare & The Tank Museum', body: 'Bovington has trained British tank crews since 1916, and its museum holds one of the world’s largest tank collections — 300+ vehicles from WWI’s first prototypes to modern main battle tanks. The star exhibit, Tiger 131, is the only running Tiger I in the world: captured largely intact in Tunisia in April 1943, it gave Allied engineers their first real look at German tank design.' },
      { day: 'Day 8', title: 'D-Day: the American sector', body: 'On June 6, 1944, Allied forces landed across five beaches — Utah, Omaha, Gold, Juno, Sword — in the largest seaborne invasion in history. Omaha saw the heaviest fighting of the five landings. Pointe du Hoc, the clifftop battery just west of Omaha, was scaled under fire by the 2nd Ranger Battalion — the cratered ground is still visible today, and it sits on this day’s self-drive route. The American Cemetery above Omaha holds 9,389 graves and lists 1,557 more names on its Walls of the Missing.' },
      { day: 'Day 9', title: 'Bayeux: first city liberated, and the British sector', body: 'Bayeux was the first French city liberated, on June 7, 1944 — spared the destruction that flattened Caen and other Norman towns, which is why its medieval center still stands. It sits in the British and Canadian sector of the invasion; Bayeux War Cemetery, across the road from the Battle of Normandy Memorial Museum, is the largest British and Commonwealth WWII cemetery in France. (Bayeux is also home to the 11th-century Bayeux Tapestry, depicting a much older invasion — William the Conqueror’s 1066 conquest of England — though the museum housing it is closed for renovation through October 2027, so it isn’t part of this visit.)' },
      { day: 'Day 10', title: 'Mont-Saint-Michel: eight centuries before D-Day', body: 'A Benedictine abbey has stood on this tidal island since the 8th century; the current Gothic abbey dates mostly to the 13th. It withstood a decades-long English siege during the Hundred Years’ War (1337–1453) without ever being taken — one of the only Norman strongholds that didn’t fall. Used as a prison after the French Revolution, it was restored and reconsecrated in the 19th century and is now one of France’s most-visited sites outside Paris.' },
      { day: 'Days 12–13', title: 'Porto & the Douro', body: 'Porto’s wine trade dates to Roman times, but the fortified “port” style was shaped by 17th–18th century trade with England. Port wine is aged in lodges across the river in Vila Nova de Gaia, not in Porto itself — the grapes come from terraced vineyards up the Douro Valley, one of the oldest demarcated wine regions in the world (1756).' }
    ];
    document.getElementById('historyList').innerHTML = entries.map(function (e) {
      return '<div class="accordion-item"><button class="accordion-header">' +
        '<span class="history-day-tag">' + esc(e.day) + '</span>' + esc(e.title) + '</button>' +
        '<div class="accordion-body">' + esc(e.body) + '</div></div>';
    }).join('');
    document.querySelectorAll('#historyList .accordion-header').forEach(function (btn) {
      btn.addEventListener('click', function () { btn.parentElement.classList.toggle('open'); });
    });
  })();

  /* ---------------------------------------------------------
     AIR & HOTEL — consolidated real flight/hotel data
     --------------------------------------------------------- */
  var TRIP_START = new Date(2026, 9, 12); // Oct 12 2026, confirmed against day labels
  function dayDateISO(dayIndex) {
    var d = new Date(TRIP_START);
    d.setDate(d.getDate() + dayIndex);
    return d.toISOString().slice(0, 10);
  }

  (function renderAirHotel() {
    var flights = [];
    var hotelsByName = {};
    (TRIP.days || []).forEach(function (day, idx) {
      (day.items || []).forEach(function (item) {
        if (item.type === 'Flight' && item.flight) flights.push({ f: item.flight, dayIndex: idx });
        if (item.hotel && item.hotel.name) {
          var h = hotelsByName[item.hotel.name] || { city: day.city };
          Object.keys(item.hotel).forEach(function (k) { if (item.hotel[k] && !h[k]) h[k] = item.hotel[k]; });
          hotelsByName[item.hotel.name] = h;
        }
      });
    });

    document.getElementById('flightTable').innerHTML = flights.map(function (row, i) {
      var f = row.f;
      var unverified = !!f._modelEstimatedFlightNumber;
      return '<div class="ref-card">' +
        '<div class="ref-title">' + esc(f.carrier || '') + ' · ' + esc(f.flight_number || 'TBD') + '</div>' +
        (unverified ? '<div class="flight-warn">⚠ Flight number/time not checked against a live schedule — confirm with the airline before booking.</div>' : '') +
        '<div class="ref-line">' + esc(f.from_airport || '') + ' → ' + esc(f.to_airport || '') +
        (f.depart_time ? ' · Departs ' + esc(formatTime12(f.depart_time)) : '') + (f.arrive_time ? ' · Arrives ' + esc(formatTime12(f.arrive_time)) : '') + '</div>' +
        (f.duration ? '<div class="ref-line">' + esc(f.duration) + (f.nonstop ? ' · Nonstop' : '') + '</div>' : '') +
        (f.cabin || f.aircraft ? '<div class="ref-line">' + [f.cabin, f.aircraft].filter(Boolean).map(esc).join(' · ') + '</div>' : '') +
        (f.airport_arrival_buffer ? '<div class="ref-line">Arrive ' + esc(f.airport_arrival_buffer) + ' before departure</div>' : '') +
        (f.confirmation_note ? '<div class="ref-line ai-note">' + esc(f.confirmation_note) + '</div>' : '') +
        (f.lounge_access && f.lounge_access.length ? f.lounge_access.map(function (l) {
          return '<div class="ref-line">Lounge: ' + esc(l.name || '') +
            (l.terminal ? ' · ' + esc(l.terminal) : '') +
            (l.gate_proximity ? ' · ' + esc(l.gate_proximity) : '') +
            (l.access ? '<br><span class="ai-note">Access: ' + esc(l.access) + '</span>' : '') +
            (l.notes ? '<br><span class="ai-note">' + esc(l.notes) + '</span>' : '') + '</div>';
        }).join('') : '') +
        '<div class="ref-line flight-status" id="fstatus-' + i + '">Checking live schedule…</div>' +
        '</div>';
    }).join('') || '<p class="ai-note">No flights in this plan.</p>';

    // Live schedule check via /api/flight-status, which proxies server-side
    // to the same shared flight-status Worker santafejune.com/trip-optimizer
    // already use in production (see that function's own header comment) -
    // no separate AEROAPI_KEY needed in this project.
    flights.forEach(function (row, i) {
      var f = row.f;
      var el = document.getElementById('fstatus-' + i);
      if (!f.flight_number || !el) return;
      var qs = 'ident=' + encodeURIComponent(f.flight_number) + '&date=' + dayDateISO(row.dayIndex);
      if (f.from_airport) qs += '&origin=' + encodeURIComponent(f.from_airport);
      if (f.to_airport) qs += '&destination=' + encodeURIComponent(f.to_airport);
      var url = '/api/flight-status?' + qs;
      fetch(url).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.beyondHorizon) {
          // AeroAPI's personal tier only resolves live status ~2 days out -
          // this is the normal, expected case for a trip booked weeks/months
          // ahead, not a failure. Say so plainly instead of the generic
          // "could not verify" warning, which reads like something's wrong.
          el.textContent = 'Live tracking opens closer to departure (not yet available this far out).';
          el.classList.add('flight-status-pending');
        } else if (data && data.ok && data.status && data.status !== 'Unknown') {
          el.textContent = '✓ Live status: ' + data.status + (data.scheduledOut ? ' · scheduled ' + data.scheduledOut : '');
          el.classList.add('flight-status-ok');
        } else {
          el.textContent = '⚠ Could not verify this flight against a live schedule.';
          el.classList.add('flight-status-warn');
        }
      }).catch(function () {
        el.textContent = '⚠ Live schedule check unavailable right now.';
        el.classList.add('flight-status-warn');
      });
    });

    document.getElementById('hotelTable').innerHTML = Object.keys(hotelsByName).map(function (name) {
      var h = hotelsByName[name];
      return '<div class="ref-card"><div class="ref-title">' + esc(name) + ' <span class="ref-city">' + esc(h.city || '') + '</span></div>' +
        (h.address ? '<div class="ref-line">' + esc(h.address) + '</div>' : '') +
        (h.phone ? '<div class="ref-line"><a href="tel:' + esc(h.phone) + '">' + esc(h.phone) + '</a></div>' : '') +
        (h.room_type ? '<div class="ref-line">' + esc(h.room_type) + '</div>' : '') +
        hotelCheckTimesLine(h) +
        (h.confirmation_note ? '<div class="ref-line ai-note">' + esc(h.confirmation_note) + '</div>' : '') +
        '</div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     RESERVATION TIMELINE — every restaurant reservation, sorted by
     date, with an urgency badge computed from real elapsed days
     (today → the reservation's real date, via dayDateISO). The
     platform-specific "booking window" framing (OpenTable/Resy
     windows typically open ~30 days out) is general, labeled
     booking-channel knowledge — never a per-venue confirmed fact,
     since this trip's data has no confirmation-tracking field.
     --------------------------------------------------------- */
  (function renderReservationTimeline() {
    var el = document.getElementById('reservationTimeline');
    if (!el) return;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var rows = [];
    (TRIP.days || []).forEach(function (day, idx) {
      (day.items || []).forEach(function (item) {
        if (!item.restaurant) return;
        var r = item.restaurant;
        var resDate = new Date(dayDateISO(idx) + 'T00:00:00');
        var daysUntil = Math.round((resDate - today) / 86400000);
        rows.push({ day: day.label, time: item.time, r: r, daysUntil: daysUntil, dateISO: dayDateISO(idx) });
      });
    });
    rows.sort(function (a, b) { return a.dateISO.localeCompare(b.dateISO); });

    if (!rows.length) { el.innerHTML = '<p class="ai-note">No restaurant reservations in this plan.</p>'; return; }

    var ONLINE_PLATFORMS = { resy: 1, opentable: 1, tock: 1, yelp: 1 };
    el.innerHTML = rows.map(function (row) {
      var r = row.r;
      var platform = (r.reservation && r.reservation.platform) || null;
      var cls = 'tl-flex', badge = 'Reservation info unavailable';
      if (row.daysUntil < 0) {
        cls = 'tl-done'; badge = 'Date has passed';
      } else if (platform === 'walkin') {
        cls = 'tl-flex'; badge = 'No booking needed';
      } else if (platform === 'phone') {
        cls = 'tl-soon'; badge = 'Call to reserve';
      } else if (ONLINE_PLATFORMS[platform]) {
        if (row.daysUntil <= 30) { cls = 'tl-urgent'; badge = 'Booking window likely open'; }
        else { cls = 'tl-flex'; badge = 'Opens ~' + (row.daysUntil - 30) + 'd (in ' + row.daysUntil + ' days)'; }
      }
      return '<li class="timeline-row ' + cls + '">' +
        '<span class="tl-badge">' + esc(badge) + '</span>' +
        '<div class="tl-body">' +
        '<p class="tl-name">' + esc(r.name) + ' · ' + esc(row.day.split('·').slice(0, 2).map(function (s) { return s.trim(); }).join(' · ')) + ', ' + esc(formatTime12(row.time)) + '</p>' +
        '<p class="tl-note">' + esc(RESERVATION_LABELS[platform] || 'Verify booking channel directly with the venue') +
        (r.contact && r.contact.phone ? ' · <a href="tel:' + esc(r.contact.phone) + '">' + esc(r.contact.phone) + '</a>' : '') + '</p>' +
        '</div></li>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     BOOKING ACTIONS — everything bookable that ISN'T a restaurant:
     lodging (VRBOs), museum/attraction tickets, the rental car, the
     overnight ferry, and the Douro Valley tour. Curated, not derived
     from a data field (Activity/Transport items have no "needs
     advance booking" flag to key off), the same way the History
     entries are hand-mapped to specific days rather than computed.
     Each entry's guidance was researched per-venue (real, current
     policies as of this writing) - NOT a blanket "book everything
     early" rule, because the venues genuinely don't agree with each
     other: the Battle of Britain Bunker is MANDATORY pre-book with no
     walk-in option at all, the Tank Museum needs no advance booking
     whatsoever.
     --------------------------------------------------------- */
  (function renderBookingActions() {
    var el = document.getElementById('bookingActionsTimeline');
    if (!el) return;
    var ACTIONS = [
      {
        dayIdx: 1, kind: 'soon',
        title: 'London Airbnb (Day 2 check-in) — confirm address',
        note: 'Booked via Airbnb — Jonathan shared the listing and a co-traveler trip invite by email (2 bedrooms, 3 beds, 1 bath, ★4.64, Greater London) for the 5 nights Oct 13–18. The exact address wasn\'t in the email itself, so get it plus check-in instructions from Jonathan before departure, and confirm early check-in or luggage drop given the overnight-flight arrival.',
      },
      {
        dayIdx: 2, kind: 'urgent',
        title: 'Phantom of the Opera matinee (Day 3, 2:30 PM)',
        note: 'Book directly via thephantomoftheopera.com now — best seats for a specific October date sell out 4–6 weeks ahead. Stalls center or Dress Circle for sightlines.',
      },
      {
        dayIdx: 2, kind: 'soon',
        title: 'Churchill War Rooms (Day 3, 10:00 AM)',
        note: 'Book timed-entry tickets at iwm.org.uk — October dates can sell out 3+ weeks out. Audio guide is included.',
      },
      {
        dayIdx: 4, kind: 'urgent',
        title: 'Battle of Britain Bunker (Day 5)',
        note: 'MANDATORY pre-book — there is no walk-in access at all; the underground bunker is only seen on a booked guided tour, slots limited to 20 people, tours every 45–60 min. Call +44 1895 238154 or book via battleofbritainbunker.co.uk, 7–14 days ahead. Photo ID required at the gate. Note: the venue is open all 7 days, 10 AM–4:30 PM (last admission 3:30 PM) — not the Wed–Sun-only schedule sometimes assumed.',
      },
      {
        dayIdx: 4, kind: 'urgent',
        title: 'Hamilton (Day 5, 7:30 PM)',
        note: 'Book directly via hamiltonmusical.com/london now — same sell-out risk as Phantom for a specific October date. Stalls rows A–M or Dress Circle A–C for sightlines.',
      },
      {
        dayIdx: 6, kind: 'soon',
        title: 'Rental car pickup (Day 7 morning)',
        note: 'Pickup location not yet chosen. Book a larger vehicle for comfort — the Bovington→Portsmouth leg, then the Bayeux-based Normandy touring days, are several long driving days in a row. Reserve soon; larger-vehicle availability tightens closer to the date.',
      },
      {
        dayIdx: 6, kind: 'urgent',
        title: 'Overnight Brittany Ferries crossing — book the cabin (Day 7 night)',
        note: 'Portsmouth→Ouistreham (Caen), departs 10:45 PM arrives ~7:45 AM, approx. 8 hrs. Book a cabin, not just a seat, for an overnight sailing — cabins sell out ahead of the crossing date. +44 330 159 7000 or brittany-ferries.co.uk.',
      },
      {
        dayIdx: 7, kind: 'soon',
        title: 'Normandy Airbnb — message host about late arrival (Day 8 check-in)',
        note: 'Booked — "Home in Bayeux," 4 Rue Franche, hosted by Bruno, 3 nights (check-in Mon Oct 19 5:00 PM, checkout Thu Oct 22 12:00 PM). Late arrival expected ~9:30 PM after the ferry docks and a full day of D-Day sites — message Bruno ahead of time to confirm self-check-in/lockbox instructions for that late.',
      },
      {
        dayIdx: 10, kind: 'urgent',
        title: 'Porto Airbnb — get the listing (Day 11 check-in)',
        note: 'Booked via Airbnb — Jonathan sent a co-traveler trip invite by email on Aug 21, 2026 for the 4 nights Oct 22–26, replacing the earlier VRBO placeholder. No specific listing or address was attached to the invite, so get the actual property and check-in instructions from Jonathan before the trip.',
      },
      {
        dayIdx: 12, kind: 'soon',
        title: 'Quinta do Vallado Douro Valley tasting (Day 13)',
        note: 'Book 7+ days ahead via quintadovallado.com or reservas@quintadovallado.com — it\'s not a walk-in tasting room. Also confirm the private driver for the day (GetYourGuide or hotel concierge) 3 days ahead.',
      },
      {
        dayIdx: 12, kind: 'soon',
        title: 'The Yeatman farewell dinner (Day 14, 8:00 PM)',
        note: 'Call +351 22 013 3100 to reserve — a Michelin-recognized dining room on the last night deserves an advance booking, not a walk-in gamble.',
      },
      {
        dayIdx: 0, kind: 'flex',
        title: 'Flights (all 3 legs)',
        note: 'Flight numbers (UA940, TP1094, UA145) are the planner\'s scheduled-operating-flight guess, not a confirmed booking — verify the actual flight number, times, and equipment when you book. Nothing else to do until online check-in opens (typically 24–48h before each departure).',
      },
    ];
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var BADGES = {
      urgent: 'Do this now', soon: 'Book soon', flex: 'Not urgent', wait: "Don't book yet",
    };
    el.innerHTML = ACTIONS.map(function (a) {
      var visitDate = new Date(dayDateISO(a.dayIdx) + 'T00:00:00');
      var daysUntil = Math.round((visitDate - today) / 86400000);
      return '<li class="timeline-row tl-' + a.kind + '">' +
        '<span class="tl-badge">' + esc(BADGES[a.kind]) + '</span>' +
        '<div class="tl-body">' +
        '<p class="tl-name">' + esc(a.title) + ' <span class="ref-city">visit in ' + daysUntil + ' days</span></p>' +
        '<p class="tl-note">' + esc(a.note) + '</p>' +
        '</div></li>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     LIVE WEATHER (Open-Meteo, free, no key) — full field set
     --------------------------------------------------------- */
  var WX_CODES = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    95: 'Thunderstorm'
  };

  function fetchWeather(lat, lng, tz) {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat + '&longitude=' + lng
      + '&current=temperature_2m,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
      + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=' + encodeURIComponent(tz) + '&forecast_days=1';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('weather ' + r.status);
      return r.json();
    });
  }

  function shortTime(iso) {
    if (!iso) return '';
    var t = iso.split('T')[1];
    return t ? formatTime12(t.slice(0, 5)) : '';
  }

  Object.keys(PINS.cities || {}).forEach(function (cityName) {
    var c = PINS.cities[cityName];
    var el = document.getElementById('wx-' + cityName);
    if (!el) return;
    fetchWeather(c.lat, c.lng, c.tz).then(function (data) {
      var cur = data.current;
      var day = data.daily;
      var t = Math.round(cur.temperature_2m);
      var cond = WX_CODES[cur.weather_code] || 'Mixed';
      var hi = day && day.temperature_2m_max ? Math.round(day.temperature_2m_max[0]) : null;
      var lo = day && day.temperature_2m_min ? Math.round(day.temperature_2m_min[0]) : null;
      var rain = day && day.precipitation_probability_max ? day.precipitation_probability_max[0] : null;
      var wind = Math.round(cur.wind_speed_10m);
      var sunrise = day && day.sunrise ? shortTime(day.sunrise[0]) : null;
      var sunset = day && day.sunset ? shortTime(day.sunset[0]) : null;
      el.innerHTML =
        '<div class="wx-top">' + t + '°F' + (hi != null && lo != null ? ' <span class="wx-hilo">Hi ' + hi + '° / Lo ' + lo + '°</span>' : '') + '</div>' +
        '<div class="wx-cond">' + esc(cond) + '</div>' +
        '<div class="wx-stats">' +
        (rain != null ? '<span class="wx-stat">Rain ' + rain + '%</span>' : '') +
        '<span class="wx-stat">Wind ' + wind + ' mph</span>' +
        (sunrise ? '<span class="wx-stat">☀ ' + sunrise + '</span>' : '') +
        (sunset ? '<span class="wx-stat">☾ ' + sunset + '</span>' : '') +
        '</div>';
    }).catch(function () {
      el.innerHTML = '<span class="wx-loading">Weather unavailable</span>';
    });
  });

  /* ---------------------------------------------------------
     MAP (Leaflet + free CartoDB tiles, no API key)
     --------------------------------------------------------- */
  var mapInstance = null;
  var mapMarkers = []; // { marker, city }

  function initMapOnce() {
    if (mapInstance) { mapInstance.invalidateSize(); return; }
    var mapEl = document.getElementById('itineraryMap');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('itineraryMap', { scrollWheelZoom: false }).setView([48.5, 2.5], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19
    }).addTo(mapInstance);

    var bounds = [];

    function addMarker(name, lat, lng, city, extraLabel) {
      var color = CITY_COLORS[city] || '#3f7d86';
      var marker = L.circleMarker([lat, lng], {
        radius: 7, color: color, fillColor: color, fillOpacity: 0.85, weight: 2
      }).addTo(mapInstance);
      marker.bindPopup(
        '<strong>' + esc(name) + '</strong>' + (extraLabel ? '<br>' + esc(extraLabel) : '') +
        '<br>' + directionsLinksHTML(name + ', ' + city)
      );
      bounds.push([lat, lng]);
      mapMarkers.push({ marker: marker, city: city });
    }

    Object.keys(PINS.hotels || {}).forEach(function (name) {
      var h = PINS.hotels[name];
      addMarker(name, h.lat, h.lng, h.city, 'Hotel');
    });

    Object.keys(PINS.landmarks || {}).forEach(function (loc) {
      var p = PINS.landmarks[loc];
      addMarker(landmarkDisplayName(loc), p.lat, p.lng, guessCityForLandmark(loc), p.approx ? 'Approximate location' : null);
    });

    // Route overview line — straight connectors between city centers in the
    // order the trip actually visits them (derived from each day's own
    // `city` field, deduped for consecutive repeats). This is NOT a real
    // driving route (no routing API/key used or available) - just shows the
    // overall shape of the trip at a glance. Labeled honestly, not implied
    // as turn-by-turn directions.
    var visitOrder = [];
    (TRIP.days || []).forEach(function (day) {
      if (day.city && visitOrder[visitOrder.length - 1] !== day.city) visitOrder.push(day.city);
    });
    var routePoints = visitOrder
      .map(function (city) { return PINS.cities[city]; })
      .filter(Boolean)
      .map(function (c) { return [c.lat, c.lng]; });
    if (routePoints.length > 1) {
      L.polyline(routePoints, {
        color: '#c9a24b', weight: 3, opacity: 0.85, dashArray: '2 10', lineCap: 'round'
      }).addTo(mapInstance).bindPopup('Overview route between cities — straight-line, not an actual driving path.');
    }

    if (bounds.length) mapInstance.fitBounds(bounds, { padding: [24, 24] });
  }

  function guessCityForLandmark(loc) {
    var l = loc.toLowerCase();
    if (l.indexOf('london') !== -1 || /sw1|se1|wc1|wc2|ec1|ec3|west end|uxbridge|bletchley|bovington|dorset/.test(l)) return 'London';
    if (l.indexOf('normandy') !== -1 || l.indexOf('caen') !== -1 || l.indexOf('cricqueville') !== -1 || l.indexOf('sainte-marie') !== -1 || l.indexOf('sainte-mère') !== -1 || l.indexOf('bayeux') !== -1 || l.indexOf('mont-saint-michel') !== -1 || l.indexOf('colleville') !== -1) return 'Normandy';
    if (l.indexOf('porto') !== -1 || l.indexOf('gaia') !== -1 || l.indexOf('douro') !== -1 || l.indexOf('sabrosa') !== -1 || l.indexOf('regua') !== -1) return 'Porto';
    return 'London';
  }

  document.getElementById('mapFilters').addEventListener('click', function (e) {
    var btn = e.target.closest('.map-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.map-filter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    var city = btn.dataset.city;
    // Filtering previously only dimmed non-matching markers, leaving the
    // map at whatever zoom level initMapOnce's one-time fitBounds(all
    // markers) had set - so picking "London" alone still showed the whole
    // trip's ~1000-mile UK-to-Portugal span, a genuinely unhelpful "100k
    // foot view" for looking at one city's own points. Re-fit to just the
    // visible markers' own bounds on every filter change instead (the
    // "all" case naturally re-collects every marker, since `show` is true
    // for all of them there too).
    var visibleLatLngs = [];
    mapMarkers.forEach(function (m) {
      var show = city === 'all' || m.city === city;
      m.marker.setStyle({ opacity: show ? 1 : 0, fillOpacity: show ? 0.85 : 0 });
      if (show) visibleLatLngs.push(m.marker.getLatLng());
    });
    if (visibleLatLngs.length && mapInstance) {
      mapInstance.fitBounds(visibleLatLngs, { padding: [24, 24], maxZoom: 12 });
    }
  });

  /* ---------------------------------------------------------
     GEOLOCATION helper — used by local search + chat
     --------------------------------------------------------- */
  var lastKnownPosition = null;
  function getPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(null);
      }, 6000);
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          lastKnownPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          resolve(lastKnownPosition);
        },
        function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(null);
        },
        { timeout: 5500 }
      );
    });
  }

  function currentCityCoords() {
    // Whichever city tab is currently active; otherwise default to London.
    var activeSection = document.querySelector('.tab-section.active');
    if (activeSection && activeSection.id.indexOf('tab-city-') === 0) {
      var city = activeSection.id.replace('tab-city-', '');
      if (PINS.cities[city]) return PINS.cities[city];
    }
    return PINS.cities.London;
  }

  /* ---------------------------------------------------------
     LOCAL SEARCH (Overpass / OpenStreetMap, free)
     --------------------------------------------------------- */
  var fabLocal = document.getElementById('fabLocal');
  var localPanel = document.getElementById('localPanel');
  var localClose = document.getElementById('localClose');
  var localResults = document.getElementById('localResults');
  var fabChat = document.getElementById('fabChat');
  var chatPanel = document.getElementById('chatPanel');
  var chatClose = document.getElementById('chatClose');

  function closeAllPanels() {
    localPanel.classList.remove('active');
    chatPanel.classList.remove('active');
  }
  fabLocal.addEventListener('click', function () {
    var open = localPanel.classList.contains('active');
    closeAllPanels();
    if (!open) localPanel.classList.add('active');
  });
  fabChat.addEventListener('click', function () {
    var open = chatPanel.classList.contains('active');
    closeAllPanels();
    if (!open) {
      chatPanel.classList.add('active');
      // Warm the GPS cache as soon as the concierge opens, so location-aware
      // answers are possible from the very first message (matches zurich-weekend's
      // concierge-chat pattern) instead of only ever picking up whatever the
      // Local Search fab happened to request earlier.
      if (!lastKnownPosition) getPosition();
    }
  });
  localClose.addEventListener('click', closeAllPanels);
  chatClose.addEventListener('click', closeAllPanels);

  /* ---------------------------------------------------------
     RESTAURANT MENU POPUP — opened by tapping a restaurant's name
     (menu-trigger buttons, rendered by restaurantCardHTML) anywhere on
     the site. Content is built from menu_highlights (verified via web
     research, not the model's own generation - see CLAUDE.md) plus the
     same cuisine/price/address data already shown on the card itself.
     --------------------------------------------------------- */
  var menuModal = document.getElementById('menuModal');
  var menuModalBody = document.getElementById('menuModalBody');

  function openMenuModal(name) {
    var r = RESTAURANTS_BY_NAME[name];
    if (!r || !menuModal || !menuModalBody) return;
    var contact = r.contact || {};
    var meta = [r.cuisine, r.neighborhood, r.price_range].filter(Boolean).join(' · ');
    var highlights = r.menu_highlights || [];
    menuModalBody.innerHTML =
      '<button type="button" class="menu-modal-close" aria-label="Close menu">&times;</button>' +
      '<div class="menu-modal-title">' + esc(r.name) + '</div>' +
      (meta ? '<div class="meal-meta">' + esc(meta) + '</div>' : '') +
      (contact.address ? '<div class="meal-meta">' + esc(contact.address) + '</div>' : '') +
      (highlights.length
        ? '<div class="menu-modal-section-label">What to order</div>' +
          '<ul class="menu-highlights">' + highlights.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' +
          '<p class="menu-modal-caveat">Based on published reviews and the restaurant’s own site — kitchens change seasonally, so confirm before booking.</p>'
        : '<p class="ai-note">No verified menu highlights for this one yet — check their website or call ahead.</p>') +
      '<div class="item-links">' + directionsLinksHTML(r.name) +
      (contact.phone ? '<a href="tel:' + esc(contact.phone) + '">' + esc(contact.phone) + '</a>' : '') +
      (contact.website ? '<a href="' + esc(contact.website) + '" target="_blank" rel="noopener">Website</a>' : '') +
      '</div>';
    menuModal.classList.add('active');
  }
  function closeMenuModal() { if (menuModal) menuModal.classList.remove('active'); }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('.menu-trigger');
    if (trigger) { openMenuModal(trigger.getAttribute('data-restaurant')); return; }
    if (menuModal && menuModal.classList.contains('active')) {
      if (e.target === menuModal || (e.target.closest && e.target.closest('.menu-modal-close'))) closeMenuModal();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menuModal && menuModal.classList.contains('active')) closeMenuModal();
  });

  function haversineMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000, toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function runLocalSearch(categories) {
    localResults.textContent = 'Searching nearby…';
    var pos = lastKnownPosition || await getPosition();
    var center = pos || currentCityCoords();
    var query = '[out:json][timeout:8];(node["amenity"~"' + categories + '"]["name"](around:800,' + center.lat + ',' + center.lng + '););out body 20;';
    try {
      var res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (!res.ok) throw new Error('overpass ' + res.status);
      var data = await res.json();
      var places = (data.elements || [])
        .filter(function (el) { return el.tags && el.tags.name; })
        .map(function (el) {
          var lat = el.lat != null ? el.lat : (el.center && el.center.lat);
          var lng = el.lon != null ? el.lon : (el.center && el.center.lon);
          var dist = (lat != null && lng != null) ? haversineMeters(center.lat, center.lng, lat, lng) : null;
          return { name: el.tags.name, type: el.tags.amenity, dist: dist };
        })
        .filter(function (p) { return p.dist != null; })
        .sort(function (a, b) { return a.dist - b.dist; })
        .slice(0, 10);

      if (!places.length) {
        localResults.textContent = 'No results nearby — try Google Maps directly.';
        return;
      }
      localResults.innerHTML = places.map(function (p) {
        var mins = Math.round((p.dist * 1.4) / 67);
        return '<div class="local-result">' +
          '<div class="name">' + esc(p.name) + '</div>' +
          '<div class="meta">' + esc(p.type || '') + ' · ~' + Math.max(mins, 1) + ' min walk · ' + directionsLinksHTML(p.name) + '</div>' +
          '</div>';
      }).join('');
    } catch (err) {
      localResults.textContent = 'Local search is unavailable right now (network error). Try again in a moment.';
    }
  }

  document.getElementById('localCats').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    runLocalSearch(btn.dataset.cat);
  });

  /* ---------------------------------------------------------
     CHAT CONCIERGE — streams from the Cloudflare Worker
     --------------------------------------------------------- */
  var chatMessages = document.getElementById('chatMessages');
  var chatInput = document.getElementById('chatInput');
  var chatSend = document.getElementById('chatSend');
  var chatHistory = [];
  var isFirstChatMessage = true;

  function addMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'chat-msg chat-msg--' + (role === 'user' ? 'user' : 'bot');
    div.innerHTML = linkify(text);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function linkify(text) {
    var escaped = esc(text);
    return escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  async function sendChat() {
    var msg = chatInput.value.trim();
    if (!msg) return;
    addMsg('user', msg);
    chatInput.value = '';
    var botDiv = addMsg('bot', '…');

    if (isFirstChatMessage) {
      isFirstChatMessage = false;
      if (!lastKnownPosition) {
        // Give a permission prompt / fix a brief moment to resolve so the very
        // first answer can already be location-aware, capped so a denied or
        // slow GPS request never stalls sending the message.
        await Promise.race([
          getPosition(),
          new Promise(function (resolve) { setTimeout(resolve, 2000); })
        ]);
      }
    }
    var pos = lastKnownPosition;

    try {
      var res = await fetch(CHAT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: chatHistory,
          lat: pos ? pos.lat : null,
          lng: pos ? pos.lng : null,
          gpsStatus: pos ? 'granted' : null,
          localTime: new Date().toISOString(),
          activeTab: (document.querySelector('.tab-section.active') || {}).id || 'itinerary'
        })
      });

      if (!res.ok || !res.body) {
        botDiv.textContent = 'The concierge is unavailable right now — try again in a moment.';
        return;
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var full = '';
      var buf = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            var obj = JSON.parse(payload);
            if (obj.response) full += obj.response;
          } catch (e) { /* ignore malformed chunk */ }
        }
        botDiv.innerHTML = linkify(full || '…');
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
      if (!full) botDiv.textContent = 'No response — try again.';
      chatHistory.push({ role: 'user', content: msg });
      chatHistory.push({ role: 'assistant', content: full });
      chatHistory = chatHistory.slice(-8);
    } catch (err) {
      botDiv.textContent = 'Connection error — the concierge worker may be unreachable.';
    }
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });

  var chatSuggestions = document.getElementById('chatSuggestions');
  if (chatSuggestions) {
    chatSuggestions.addEventListener('click', function (e) {
      var btn = e.target.closest('.chat-suggest-btn');
      if (!btn) return;
      var q = btn.getAttribute('data-q');
      if (!q) return;
      chatInput.value = q;
      sendChat();
    });
  }

  /* ---------------------------------------------------------
     TIME PILL — home vs. current-leg local time, adapted from
     maritimes-grandloop-v2. The zone table is built from the real
     per-day city + computed date already on the page (dayDateISO,
     TRIP.days) rather than a separately hand-maintained date range,
     so it can't drift from the actual itinerary.
     --------------------------------------------------------- */
  (function () {
    var pill = document.getElementById('time-pill');
    if (!pill) return;

    var CITY_TZ = {
      London: { tz: 'Europe/London', flag: '🇬🇧' },
      Normandy: { tz: 'Europe/Paris', flag: '🇫🇷' },
      Porto: { tz: 'Europe/Lisbon', flag: '🇵🇹' }
    };
    var HOME_TZ = 'America/Chicago'; // traveler's actual home base is Dallas, TX (Central), not the EWR departure city
    var NY_TZ = 'America/New_York'; // both this trip's flights route through Newark (EWR) - worth its own zone alongside home

    var zones = (TRIP.days || []).map(function (day, idx) {
      return { date: dayDateISO(idx), city: day.city, info: CITY_TZ[day.city] };
    }).filter(function (z) { return z.info; });

    function todayISO() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function currentZone() {
      var today = todayISO();
      for (var i = 0; i < zones.length; i++) {
        if (zones[i].date === today) return zones[i];
      }
      return zones[0] || null; // before/after the trip: default to the first leg
    }

    function fmtTime(tz) {
      return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    }

    var destFlag = document.getElementById('tp-dest-flag');
    var destTime = document.getElementById('tp-dest-time');
    var destLabel = document.getElementById('tp-dest-label');
    var homeTime = document.getElementById('tp-home-time');
    var nyTime = document.getElementById('tp-ny-time');
    var sep = document.getElementById('tp-sep-1');
    var destZone = document.getElementById('tp-dest');

    function update() {
      homeTime.textContent = fmtTime(HOME_TZ);
      if (nyTime) nyTime.textContent = fmtTime(NY_TZ);
      var zone = currentZone();
      if (!zone || zone.info.tz === HOME_TZ) {
        sep.style.display = 'none';
        destZone.style.display = 'none';
      } else {
        sep.style.display = '';
        destZone.style.display = '';
        destFlag.textContent = zone.info.flag;
        destTime.textContent = fmtTime(zone.info.tz);
        destLabel.textContent = zone.city.toUpperCase();
      }
      pill.classList.add('visible');
    }

    update();
    setInterval(update, 30000);
  })();

  // The map's container is now always in normal document flow (never
  // display:none since the continuous-scroll rebuild), so Leaflet can size
  // itself correctly on first init without waiting for a tab-click reveal.
  // Called last, after every other setup in this IIFE (mapMarkers etc.) has
  // already run - calling it too early threw (confirmed live: an earlier
  // attempt at this placed the call right after the nav setup, before
  // mapMarkers was declared further down the file, which broke ALL city-day
  // rendering, not just the map, since the resulting uncaught exception
  // aborted the rest of the script).
  initMapOnce();

})();

/* ---------------------------------------------------------
   PACKING LIST persistence (from travel-app-components/packing-list-v2)
   Separate top-level IIFE (matches the component's documented pattern) -
   works regardless of which tab is active since checkboxes exist in the
   DOM at all times, just hidden via .tab-section { display: none }.
   --------------------------------------------------------- */
(function () {
  var panel = document.getElementById('tab-packing');
  if (!panel) return;
  var STORAGE_KEY = 'aripshitadventure-packing-v1';
  var checks = Array.prototype.slice.call(panel.querySelectorAll('.pack-list input[type="checkbox"]'));
  if (!checks.length) return;

  checks.forEach(function (cb, i) {
    var groupEl = cb.closest('[data-pack-group]');
    var group = groupEl ? groupEl.getAttribute('data-pack-group') : 'x';
    cb.dataset.pkid = group + ':' + i;
  });

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { saved = {}; }
  checks.forEach(function (cb) { if (saved[cb.dataset.pkid]) cb.checked = true; });

  var progress = document.getElementById('pack-progress');
  function updateProgress() {
    var done = checks.filter(function (c) { return c.checked; }).length;
    if (progress) progress.textContent = done + ' of ' + checks.length + ' packed';
    checks.forEach(function (c) {
      var li = c.closest('li');
      if (li) li.classList.toggle('is-packed', c.checked);
    });
  }
  function save() {
    var out = {};
    checks.forEach(function (c) { if (c.checked) out[c.dataset.pkid] = 1; });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  }

  checks.forEach(function (cb) {
    cb.addEventListener('change', function () { save(); updateProgress(); });
  });

  var resetBtn = document.getElementById('pack-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!confirm('Clear all checked items on the packing list?')) return;
      checks.forEach(function (c) { c.checked = false; });
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      updateProgress();
    });
  }

  updateProgress();
})();
