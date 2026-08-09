(function () {
  'use strict';

  var TRIP = JSON.parse(document.getElementById('trip-data').textContent);
  var PINS = JSON.parse(document.getElementById('pins-data').textContent);

  // Same worker that already backs zurich-weekend.com's concierge chat —
  // this trip is registered there under the "wwii2026" site key.
  var CHAT_API = 'https://cloudflare-worker.jhwiv-online.workers.dev/api/chat/wwii2026';

  var CITY_COLORS = { London: '#3f7d86', Normandy: '#c9524b', Nuremberg: '#8a5fc9', Porto: '#c9a24b' };
  var CITIES = ['London', 'Normandy', 'Nuremberg', 'Porto'];

  var ITEM_ICONS = {
    Flight: '✈️', Transport: '🚗', Hotel: '🏨', Dinner: '🍽️',
    Lunch: '🍽️', Breakfast: '☕', Activity: '📍', Note: '📝'
  };

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
      '<a href="https://maps.google.com/?q=' + q + '" target="_blank" rel="noopener">Google</a>' +
      '<a href="https://maps.apple.com/?q=' + q + '" target="_blank" rel="noopener">Apple</a>' +
      '<a href="https://waze.com/ul?q=' + q + '&navigate=yes" target="_blank" rel="noopener">Waze</a>' +
      '</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------------------------------------------------------
     TAB SWITCHING
     --------------------------------------------------------- */
  var navChips = Array.prototype.slice.call(document.querySelectorAll('.nav-chip'));
  var tabSections = Array.prototype.slice.call(document.querySelectorAll('.tab-section'));

  function activateTab(targetId) {
    tabSections.forEach(function (s) { s.classList.toggle('active', s.id === targetId); });
    navChips.forEach(function (c) { c.classList.toggle('active', c.dataset.target === targetId); });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (targetId === 'tab-map') { initMapOnce(); }
  }

  navChips.forEach(function (chip) {
    chip.addEventListener('click', function () { activateTab(chip.dataset.target); });
  });

  /* ---------------------------------------------------------
     HERO
     --------------------------------------------------------- */
  document.getElementById('heroRoute').textContent = TRIP.destination;
  document.getElementById('heroMeta').textContent = TRIP.meta;
  document.title = TRIP.destination + ' · ' + TRIP.meta;

  /* ---------------------------------------------------------
     OVERVIEW: city cards + logistics + arc
     --------------------------------------------------------- */
  var cityCardsEl = document.getElementById('cityCards');
  (TRIP.cities || []).forEach(function (c) {
    var card = document.createElement('div');
    card.className = 'city-card';
    card.innerHTML =
      '<h3>' + esc(c.name) + '</h3>' +
      '<div class="nights">' + esc(c.nights) + ' nights · ' + esc(c.days_range) + '</div>' +
      '<div class="stay">' + esc(c.stay) + '</div>' +
      '<div class="wx" id="wx-' + esc(c.name) + '"><span class="wx-loading">Loading weather…</span></div>';
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
  function humanizeTransportText(text) {
    if (!text) return text;
    return text.replace(/Private driver/gi, 'Self-drive').replace(/Private transfer/gi, 'Self-drive transfer');
  }

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
    var displayText = item.type === 'Transport' ? humanizeTransportText(item.text) : item.text;
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
      // too, same info the Air & Hotel tab already has.
      if (f.arrive_time) timeLine += ' · Arrives ' + esc(formatTime12(f.arrive_time));
      if (f._modelEstimatedFlightNumber) {
        flightWarn = '<div class="flight-warn">⚠ Flight number/time not checked against a live schedule — confirm with the airline before booking.</div>';
      }
    }
    if (item._locationUnverified) {
      flightWarn += '<div class="flight-warn">⚠ ' + esc(item._locationUnverified) + '</div>';
    }
    var navigateRow = item.type === 'Transport'
      ? '<div class="navigate-row"><span class="navigate-label">🧭 Navigate:</span>' + directionsLinksHTML(searchTarget + (day.city ? ', ' + day.city : '')) + '</div>'
      : '<div class="item-links">' + directionsLinksHTML(searchTarget + (day.city ? ', ' + day.city : '')) +
        (item.contact && item.contact.phone ? '<a href="tel:' + esc(item.contact.phone) + '">' + esc(item.contact.phone) + '</a>' : '') +
        (item.contact && item.contact.website ? '<a href="' + esc(item.contact.website) + '" target="_blank" rel="noopener">Website</a>' : '') +
        '</div>';
    return '<div class="item">' +
      '<div class="item-icon">' + icon + '</div>' +
      '<div class="item-body">' +
      '<div class="item-time">' + timeLine + '</div>' +
      '<div class="item-text">' + esc(displayText || '') + '</div>' +
      flightWarn +
      (item.why ? '<div class="item-why">' + esc(item.why) + '</div>' : '') +
      navigateRow +
      '</div></div>';
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

  function renderDayBlockHTML(day, dayNum) {
    var weatherLine = (day.weather && (day.weather.summary || day.weather.condition)) || '';
    var html = '<div class="day-block" id="day-' + dayNum + '">' +
      '<div class="day-block-label">' + esc(day.label) + '</div>' +
      '<div class="day-block-headline">' + esc(day.headline) + '</div>' +
      (weatherLine ? '<div class="day-block-weather">' + esc(weatherLine) + '</div>' : '');
    var items = day.items || [];
    items.forEach(function (item, i) {
      html += renderItemHTML(item, day);
      // A Flight item's own "end" is its arrival time (item.flight.arrive_time),
      // not its departure time (item.time) - using item.time here produced a
      // false ~14hr "free time" gap between an 8:20 AM departure/8:40 PM
      // arrival and the next item, caught by screenshot before push.
      var flightArrive = item.type === 'Flight' && item.flight ? toMinutes(item.flight.arrive_time) : null;
      var thisEnd = toMinutes(item.end_time) || flightArrive || toMinutes(item.time);
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

  /* ---------------------------------------------------------
     CITY TABS — group days by city
     --------------------------------------------------------- */
  CITIES.forEach(function (cityName) {
    var container = document.getElementById('cityDays-' + cityName);
    if (!container) return;
    var html = '';
    (TRIP.days || []).forEach(function (day, idx) {
      if (day.city === cityName) html += renderDayBlockHTML(day, idx + 1);
    });
    container.innerHTML = html || '<p class="ai-note">No days assigned to this city.</p>';
  });

  /* ---------------------------------------------------------
     CONDENSED — compact one-line-per-item list
     --------------------------------------------------------- */
  var condensedEl = document.getElementById('condensedList');
  (function renderCondensed() {
    var html = '';
    (TRIP.days || []).forEach(function (day, idx) {
      html += '<div class="cond-day"><div class="cond-day-label">' + esc(day.label) + '</div>';
      (day.items || []).forEach(function (item) {
        var name = (item.restaurant && item.restaurant.name) || (item.hotel && item.hotel.name) || '';
        var unverifiedTag = (item.type === 'Flight' && item.flight && item.flight._modelEstimatedFlightNumber)
          ? ' <span class="cond-warn">⚠ unverified schedule</span>' : '';
        var condText = item.type === 'Transport' ? humanizeTransportText(item.text) : item.text;
        html += '<div class="cond-row"><span class="cond-time">' + esc(formatTime12(item.time)) + '</span> ' +
          esc(condText || '') + (name ? ' — <strong>' + esc(name) + '</strong>' : '') + unverifiedTag + '</div>';
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
    mealsEl.innerHTML = rows.map(function (row) {
      var r = row.r;
      var platform = (r.reservation && r.reservation.platform) || null;
      var label = RESERVATION_LABELS[platform] || 'Reservation info unavailable';
      var contact = r.contact || {};
      var reserveHref = (r.reservation && r.reservation.url) ? r.reservation.url
        : (r.reservation && r.reservation.phone) ? 'tel:' + r.reservation.phone
        : (contact.phone ? 'tel:' + contact.phone : null);
      return '<div class="meal-row">' +
        '<div class="meal-top"><span class="meal-name">' + esc(r.name) + '</span>' +
        '<span class="meal-badge">' + esc(label) + '</span></div>' +
        '<div class="meal-meta">' + esc(row.day) + ' · ' + esc(formatTime12(row.time)) +
        (contact.address ? ' · ' + esc(contact.address) : '') + '</div>' +
        '<div class="item-links">' +
        directionsLinksHTML(r.name) +
        (reserveHref ? '<a href="' + esc(reserveHref) + '" target="_blank" rel="noopener">Reserve</a>' : '') +
        (contact.website ? '<a href="' + esc(contact.website) + '" target="_blank" rel="noopener">Website</a>' : '') +
        '</div></div>';
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
        (h.confirmation_note ? '<div class="ref-line ai-note">' + esc(h.confirmation_note) + '</div>' : '') +
        '</div>';
    }).join('');

    var general = {
      'Currency': 'UK: Pound sterling (GBP). France/Germany: Euro (EUR). Portugal: Euro (EUR). Contactless cards are widely accepted in all four countries.',
      'Power outlets': 'UK uses Type G plugs (230V). France, Germany, and Portugal use Type C/E/F plugs (230V) — a UK adapter will NOT work in Normandy/Nuremberg/Porto and vice versa.',
      'Emergency number': 'UK: 999 or 112. France, Germany, Portugal: 112 (EU-wide emergency number works in all three).',
      'Tipping': 'UK: not obligatory, 10-12.5% if no service charge added. France/Germany: service is usually included, round up or leave small change. Portugal: not expected, rounding up is appreciated.'
    };
    document.getElementById('essentialsGeneral').innerHTML = Object.keys(general).map(function (k) {
      return '<div class="ref-card"><div class="ref-title">' + esc(k) + '</div><div class="ref-line">' + esc(general[k]) + '</div></div>';
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
        navLine = '<div class="navigate-row"><span class="navigate-label">🧭 Navigate:</span>' + directionsLinksHTML(query) + '</div>';
      }
      var refText = item.type === 'Transport' ? humanizeTransportText(item.text) : item.text;
      return '<div class="ref-card">' +
        '<div class="ref-title">' + icon + ' Day ' + row.dayNum + ' · ' + esc(formatTime12(item.time)) + '</div>' +
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
      London: 'Contactless card or phone tap works directly on the Tube, buses, and Overground — no need for an Oyster card. Black cabs can be hailed on the street; Uber/Bolt also operate widely. Heathrow Express runs every 15 min to Paddington.',
      Normandy: 'Rural and car-dependent — Bayeux and the D-Day beaches have limited public transit. A private driver or rental car is the practical way to cover the beach sites in a day; taxis exist in Bayeux but are sparse.',
      Nuremberg: 'VAG runs an efficient U-Bahn/tram/bus network — a day ticket covers all of it. The old town is very walkable; the Documentation Center and Rally Grounds are a short tram ride from the center.',
      Porto: 'The Andante card covers metro, bus, and some train lines. The historic center (Ribeira, Clérigos) is steep and best walked; Uber/Bolt are common for the Vila Nova de Gaia crossing or longer trips.'
    };
    document.getElementById('transitList').innerHTML = CITIES.map(function (c) {
      return '<div class="ref-card"><div class="ref-title">' + esc(c) + '</div><div class="ref-line">' + esc(content[c]) + '</div></div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     STREET VIEWS — keyless Google embed (output=svembed),
     same trick zurich-pwa uses. No API key needed.
     --------------------------------------------------------- */
  (function renderStreetViews() {
    var entries = [];
    Object.keys(PINS.landmarks || {}).forEach(function (loc) {
      var p = PINS.landmarks[loc];
      entries.push({ name: loc.split(',')[0], lat: p.lat, lng: p.lng });
    });
    Object.keys(PINS.hotels || {}).forEach(function (name) {
      var h = PINS.hotels[name];
      entries.push({ name: name, lat: h.lat, lng: h.lng });
    });
    var el = document.getElementById('streetViewList');
    el.innerHTML = entries.map(function (e) {
      var embedUrl = 'https://www.google.com/maps?layer=c&cbll=' + e.lat + ',' + e.lng + '&output=svembed';
      var fullUrl = 'https://www.google.com/maps?layer=c&cbll=' + e.lat + ',' + e.lng;
      return '<div class="sv-card">' +
        '<div class="sv-title">' + esc(e.name) + '</div>' +
        '<iframe class="sv-frame" src="' + embedUrl + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>' +
        '<a class="sv-link" href="' + fullUrl + '" target="_blank" rel="noopener">Open panorama in Google Maps ↗</a>' +
        '<div class="item-links" style="margin-top:4px;">' + directionsLinksHTML(e.name) + '</div>' +
        '</div>';
    }).join('');
  })();

  /* ---------------------------------------------------------
     HISTORY — AI-authored general context (labeled at top of tab)
     --------------------------------------------------------- */
  (function renderHistory() {
    var entries = [
      { title: 'Churchill War Rooms & the Blitz', body: 'The underground bunker beneath Whitehall where Churchill’s War Cabinet directed Britain’s WWII strategy, preserved largely as it was left in 1945. London itself was hit hard during the Blitz (1940–41) — much of the East End and City were rebuilt after the war, and the scars are still visible in odd gaps in otherwise Victorian streetscapes.' },
      { title: 'The Normandy Landings', body: 'On June 6, 1944 (D-Day), Allied forces landed across five beaches — Utah, Omaha, Gold, Juno, Sword — in the largest seaborne invasion in history. The American Cemetery at Colleville-sur-Mer overlooks Omaha Beach; Pointe du Hoc, a cliff assaulted by U.S. Army Rangers, still shows the bomb-cratered landscape. Juno was the Canadian sector.' },
      { title: 'The Nuremberg Trials', body: 'Nuremberg was chosen for the 1945–46 International Military Tribunal partly for symbolic reasons — it had been the site of the Nazi Party’s massive annual rallies. Courtroom 600, where the trials were held, is still an active courtroom and only open to visitors when not in session. The Rally Grounds (Reichsparteitagsgelände) and their Documentation Center now serve as a museum on the mechanics of Nazi propaganda.' },
      { title: 'Porto & the Douro', body: 'Porto’s wine trade dates to Roman times, but the fortified “port” style was shaped by 17th–18th century trade with England. Port wine is aged in lodges across the river in Vila Nova de Gaia, not in Porto itself — the grapes come from terraced vineyards up the Douro Valley, one of the oldest demarcated wine regions in the world (1756).' }
    ];
    document.getElementById('historyList').innerHTML = entries.map(function (e) {
      return '<div class="accordion-item"><button class="accordion-header">' + esc(e.title) + '</button>' +
        '<div class="accordion-body">' + esc(e.body) + '</div></div>';
    }).join('');
    document.querySelectorAll('#historyList .accordion-header').forEach(function (btn) {
      btn.addEventListener('click', function () { btn.parentElement.classList.toggle('open'); });
    });
  })();

  /* ---------------------------------------------------------
     AIR & HOTEL — consolidated real flight/hotel data
     --------------------------------------------------------- */
  var TRIP_START = new Date(2026, 9, 10); // Oct 10 2026, confirmed against day labels
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
        '<div class="ref-title">' + esc(f.carrier || '') + ' ' + esc(f.flight_number || '') + '</div>' +
        (unverified ? '<div class="flight-warn">⚠ Flight number/time not checked against a live schedule — confirm with the airline before booking.</div>' : '') +
        '<div class="ref-line">' + esc(f.from_airport || '') + ' → ' + esc(f.to_airport || '') +
        (f.depart_time ? ' · Departs ' + esc(formatTime12(f.depart_time)) : '') + (f.arrive_time ? ' · Arrives ' + esc(formatTime12(f.arrive_time)) : '') + '</div>' +
        (f.duration ? '<div class="ref-line">' + esc(f.duration) + (f.nonstop ? ' · Nonstop' : '') + '</div>' : '') +
        (f.confirmation_note ? '<div class="ref-line ai-note">' + esc(f.confirmation_note) + '</div>' : '') +
        (f.lounge_access && f.lounge_access.length ? f.lounge_access.map(function (l) {
          return '<div class="ref-line">Lounge: ' + esc(l.name || '') +
            (l.terminal ? ' · ' + esc(l.terminal) : '') +
            (l.access ? '<br><span class="ai-note">Access: ' + esc(l.access) + '</span>' : '') + '</div>';
        }).join('') : '') +
        '<div class="ref-line flight-status" id="fstatus-' + i + '">Checking live schedule…</div>' +
        '</div>';
    }).join('') || '<p class="ai-note">No flights in this plan.</p>';

    // Live schedule check via /api/flight-status (Cloudflare Pages Function,
    // needs AEROAPI_KEY set in the Pages project's env vars to actually work -
    // without it this correctly reports "could not verify" rather than
    // silently pretending the flight is confirmed).
    flights.forEach(function (row, i) {
      var f = row.f;
      var el = document.getElementById('fstatus-' + i);
      if (!f.flight_number || !el) return;
      var url = '/api/flight-status?ident=' + encodeURIComponent(f.flight_number) + '&date=' + dayDateISO(row.dayIndex);
      fetch(url).then(function (r) { return r.json(); }).then(function (data) {
        if (data && data.ok && data.status && data.status !== 'Unknown') {
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
        (h.confirmation_note ? '<div class="ref-line ai-note">' + esc(h.confirmation_note) + '</div>' : '') +
        '</div>';
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
      addMarker(loc.split(',')[0], p.lat, p.lng, guessCityForLandmark(loc), p.approx ? 'Approximate location' : null);
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
    if (l.indexOf('london') !== -1 || /sw1|se1|wc1|ec3|west end/.test(l)) return 'London';
    if (l.indexOf('normandy') !== -1 || l.indexOf('caen') !== -1 || l.indexOf('cricqueville') !== -1 || l.indexOf('sainte-marie') !== -1 || l.indexOf('courseulles') !== -1) return 'Normandy';
    if (l.indexOf('nuremberg') !== -1 || l.indexOf('nürnberg') !== -1) return 'Nuremberg';
    if (l.indexOf('porto') !== -1 || l.indexOf('gaia') !== -1 || l.indexOf('douro') !== -1 || l.indexOf('sabrosa') !== -1) return 'Porto';
    return 'London';
  }

  document.getElementById('mapFilters').addEventListener('click', function (e) {
    var btn = e.target.closest('.map-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.map-filter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    var city = btn.dataset.city;
    mapMarkers.forEach(function (m) {
      var show = city === 'all' || m.city === city;
      var el = m.marker.getElement && m.marker.getElement();
      m.marker.setStyle({ opacity: show ? 1 : 0, fillOpacity: show ? 0.85 : 0 });
    });
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
    if (!open) chatPanel.classList.add('active');
  });
  localClose.addEventListener('click', closeAllPanels);
  chatClose.addEventListener('click', closeAllPanels);

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
