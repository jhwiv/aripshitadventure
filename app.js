(function () {
  'use strict';

  var TRIP = JSON.parse(document.getElementById('trip-data').textContent);
  var PINS = JSON.parse(document.getElementById('pins-data').textContent);

  // Same worker that already backs zurich-weekend.com's concierge chat —
  // this trip is registered there under the "wwii2026" site key.
  var CHAT_API = 'https://cloudflare-worker.jhwiv-online.workers.dev/api/chat/wwii2026';

  var CITY_COLORS = { London: '#3f7d86', Normandy: '#c9524b', Nuremberg: '#8a5fc9', Porto: '#c9a24b' };

  var ITEM_ICONS = {
    Flight: '✈️', Transport: '🚗', Hotel: '🏨', Dinner: '🍽️',
    Lunch: '🍽️', Breakfast: '☕', Activity: '📍', Note: '📝'
  };

  /* ---------------------------------------------------------
     HERO
     --------------------------------------------------------- */
  document.getElementById('heroTitle').textContent = 'Arip Shit Adventure';
  document.getElementById('heroRoute').textContent = TRIP.destination;
  document.getElementById('heroMeta').textContent = TRIP.meta;
  document.title = TRIP.destination + ' · ' + TRIP.meta;

  /* ---------------------------------------------------------
     OVERVIEW: city cards + logistics
     --------------------------------------------------------- */
  var cityCardsEl = document.getElementById('cityCards');
  (TRIP.cities || []).forEach(function (c) {
    var card = document.createElement('div');
    card.className = 'city-card';
    card.innerHTML =
      '<h3>' + c.name + '</h3>' +
      '<div class="nights">' + c.nights + ' nights · ' + c.days_range + '</div>' +
      '<div class="stay">' + c.stay + '</div>' +
      '<div class="wx loading" id="wx-' + c.name + '">Loading weather…</div>';
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
     DAY NAV + DAY SECTIONS
     --------------------------------------------------------- */
  var dayNavEl = document.getElementById('dayNav');
  var daysSectionEl = document.getElementById('daysSection');

  function itemExtra(item) {
    var bits = [];
    if (item.restaurant && item.restaurant.name) bits.push(item.restaurant.name);
    if (item.hotel && item.hotel.name) bits.push(item.hotel.name);
    return bits;
  }

  function mapsLink(query) {
    return 'https://maps.google.com/?q=' + encodeURIComponent(query);
  }

  (TRIP.days || []).forEach(function (day, idx) {
    var dayNum = idx + 1;

    // nav pill
    var pill = document.createElement('button');
    pill.className = 'day-nav-btn';
    pill.textContent = 'Day ' + dayNum;
    pill.dataset.target = 'day-' + dayNum;
    pill.addEventListener('click', function () {
      document.getElementById('day-' + dayNum).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    dayNavEl.appendChild(pill);

    // day block
    var block = document.createElement('div');
    block.className = 'day-block';
    block.id = 'day-' + dayNum;

    var weatherLine = (day.weather && (day.weather.summary || day.weather.condition)) || '';

    var html = '<div class="day-block-label">' + day.label + '</div>' +
      '<div class="day-block-headline">' + day.headline + '</div>' +
      (weatherLine ? '<div class="day-block-weather">' + weatherLine + '</div>' : '');

    (day.items || []).forEach(function (item) {
      var icon = ITEM_ICONS[item.type] || '•';
      var extras = itemExtra(item);
      var searchTarget = extras[0] || (item.location ? item.location : item.text) || (day.city || '');
      html += '<div class="item">' +
        '<div class="item-icon">' + icon + '</div>' +
        '<div class="item-body">' +
        '<div class="item-time">' + (item.time || '') + (item.end_time ? '–' + item.end_time : '') + '</div>' +
        '<div class="item-text">' + (item.text || '') + '</div>' +
        (item.why ? '<div class="item-why">' + item.why + '</div>' : '') +
        '<div class="item-links">' +
        '<a href="' + mapsLink(searchTarget + (day.city ? ', ' + day.city : '')) + '" target="_blank" rel="noopener">Directions</a>' +
        (item.contact && item.contact.phone ? '<a href="tel:' + item.contact.phone + '">' + item.contact.phone + '</a>' : '') +
        (item.contact && item.contact.website ? '<a href="' + item.contact.website + '" target="_blank" rel="noopener">Website</a>' : '') +
        '</div></div></div>';
    });

    block.innerHTML = html;
    daysSectionEl.appendChild(block);
  });

  // active-pill highlighting on scroll
  var dayBlocks = Array.prototype.slice.call(document.querySelectorAll('.day-block'));
  var navPills = Array.prototype.slice.call(document.querySelectorAll('.day-nav-btn'));
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          navPills.forEach(function (p) {
            p.classList.toggle('active', p.dataset.target === id);
          });
        }
      });
    }, { rootMargin: '-40% 0px -50% 0px' });
    dayBlocks.forEach(function (b) { obs.observe(b); });
  }

  /* ---------------------------------------------------------
     LIVE WEATHER (Open-Meteo, free, no key)
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
      + '&current=temperature_2m,weather_code'
      + '&temperature_unit=fahrenheit&timezone=' + encodeURIComponent(tz);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('weather ' + r.status);
      return r.json();
    });
  }

  Object.keys(PINS.cities || {}).forEach(function (cityName) {
    var c = PINS.cities[cityName];
    var el = document.getElementById('wx-' + cityName);
    if (!el) return;
    fetchWeather(c.lat, c.lng, c.tz).then(function (data) {
      var t = Math.round(data.current.temperature_2m);
      var cond = WX_CODES[data.current.weather_code] || 'Mixed';
      el.textContent = t + '°F, ' + cond;
      el.classList.remove('loading');
    }).catch(function () {
      el.textContent = 'Weather unavailable';
      el.classList.remove('loading');
    });
  });

  /* ---------------------------------------------------------
     MAP (Leaflet + free CartoDB tiles, no API key)
     --------------------------------------------------------- */
  function initMap() {
    var mapEl = document.getElementById('itineraryMap');
    if (!mapEl || typeof L === 'undefined') return;

    var map = L.map('itineraryMap', { scrollWheelZoom: false }).setView([48.5, 2.5], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19
    }).addTo(map);

    var bounds = [];

    function addMarker(name, lat, lng, city, extraLabel) {
      var color = CITY_COLORS[city] || '#3f7d86';
      var marker = L.circleMarker([lat, lng], {
        radius: 7, color: color, fillColor: color, fillOpacity: 0.85, weight: 2
      }).addTo(map);
      marker.bindPopup(
        '<strong>' + name + '</strong>' + (extraLabel ? '<br>' + extraLabel : '') +
        '<br><a href="' + mapsLink(name + ', ' + city) + '" target="_blank" rel="noopener">Directions</a>'
      );
      bounds.push([lat, lng]);
    }

    Object.keys(PINS.hotels || {}).forEach(function (name) {
      var h = PINS.hotels[name];
      addMarker(name, h.lat, h.lng, h.city, 'Hotel');
    });

    Object.keys(PINS.landmarks || {}).forEach(function (loc) {
      var p = PINS.landmarks[loc];
      addMarker(loc.split(',')[0], p.lat, p.lng, guessCityForLandmark(loc), p.approx ? 'Approximate location' : null);
    });

    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
  }

  function guessCityForLandmark(loc) {
    var l = loc.toLowerCase();
    if (l.indexOf('london') !== -1 || /sw1|se1|wc1|ec3|west end/.test(l)) return 'London';
    if (l.indexOf('normandy') !== -1 || l.indexOf('caen') !== -1 || l.indexOf('cricqueville') !== -1 || l.indexOf('sainte-marie') !== -1 || l.indexOf('courseulles') !== -1) return 'Normandy';
    if (l.indexOf('nuremberg') !== -1 || l.indexOf('nürnberg') !== -1) return 'Nuremberg';
    if (l.indexOf('porto') !== -1 || l.indexOf('gaia') !== -1 || l.indexOf('douro') !== -1 || l.indexOf('sabrosa') !== -1) return 'Porto';
    return 'London';
  }

  // Leaflet's script tag is loaded before this file in index.html, so L should exist.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initMap();
  } else {
    window.addEventListener('DOMContentLoaded', initMap);
  }

  /* ---------------------------------------------------------
     GEOLOCATION helper — used by local search + chat
     --------------------------------------------------------- */
  var lastKnownPosition = null;
  function getPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var settled = false;
      // Belt-and-suspenders timeout: some browsers only start the geolocation
      // API's own `timeout` clock once the permission prompt is answered, so
      // an unanswered prompt can otherwise hang this forever.
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
    // Fall back to the city of the day-block nearest the viewport center.
    var best = null, bestDist = Infinity;
    dayBlocks.forEach(function (b) {
      var rect = b.getBoundingClientRect();
      var dist = Math.abs(rect.top);
      if (dist < bestDist) { bestDist = dist; best = b; }
    });
    if (best) {
      var idx = dayBlocks.indexOf(best);
      var city = TRIP.days[idx] && TRIP.days[idx].city;
      if (city && PINS.cities[city]) return PINS.cities[city];
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
          '<div class="name">' + p.name + '</div>' +
          '<div class="meta">' + (p.type || '') + ' · ~' + Math.max(mins, 1) + ' min walk · ' +
          '<a href="' + mapsLink(p.name) + '" target="_blank" rel="noopener">Directions</a></div>' +
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
    // Render [Label](url) markdown links; escape everything else minimally.
    var escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
          activeTab: 'itinerary'
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

})();
