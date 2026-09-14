#!/usr/bin/env python3
"""Rebuild trip-data.json from Jon Ripchick's 2026-09-14 emails.

Does not invent missing facts. Remaining London days stay high-level.
OPO→EWR date, ORY hotel, and Thu dinner are labeled unconfirmed/TBD.
"""
from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LONDON_HOTEL = "53 Greek Street Airbnb (HMFRRRZRTN)"
ORY_HOTEL = "ORY hotel (TBD)"
BAYEUX_HOTEL = "Home in Bayeux — furnished apartment with cathedral view (Airbnb, hosted by Bruno)"
PORTO_HOTEL = "Rua dos Mercadores 77 Airbnb — Ribeira São João, 3rd floor (HM549AK8C2)"

LONDON_ADDR = "53 Greek Street, London W1D 3DR"
BAYEUX_ADDR = "4 Rue Franche, Bayeux, France"
PORTO_ADDR = "Rua dos Mercadores 77, Ribeira São João, Porto, Portugal (3rd floor)"


def I(type, time, text, **kw):
    return {
        "type": type,
        "time": time,
        "end_time": kw.get("end_time"),
        "text": text,
        "location": kw.get("location"),
        "why": kw.get("why"),
        "contact": kw.get("contact"),
        "flight": kw.get("flight"),
        "hotel": kw.get("hotel"),
        "restaurant": kw.get("restaurant"),
        "duration_min": kw.get("duration_min"),
    }


def main():
    src = json.loads((ROOT / "data/trip-data.json").read_text())
    weather = [d.get("weather") for d in src["days"]]
    day9 = deepcopy(src["days"][8])
    day10 = deepcopy(src["days"][9])
    day12 = deepcopy(src["days"][11])
    day13 = deepcopy(src["days"][12])
    day14 = deepcopy(src["days"][13])

    src["destination"] = "London → Normandy → Porto"
    src["meta"] = (
        "Mon Oct 12 – Mon Oct 26, 2026 · 14 nights · 2 adults · Cultural WWII history & Port wine country · "
        "5 London + 3 Normandy + 4 Porto nights (plus 1 overnight-flight night and 1 Orly-hotel night not attributed to any city). "
        "Flights and stays from Jonathan Ripchick emails 2026-09-14. "
        "OPO→EWR date assumed Oct 26 — confirm with Jon. ORY hotel TBD."
    )
    src["cities"] = [
        {
            "name": "London",
            "nights": 5,
            "days_range": "Day 1–Day 7",
            "focus": (
                "WWII history ideas — Churchill War Rooms; Imperial War Museum; Battle of Britain Bunker; "
                "Bletchley Park; The Tank Museum Bovington (maybe overnight); West End play. "
                "Wed Oct 14 and Thu Oct 15 are the only fully detailed days."
            ),
            "stay": "53 Greek Street, Soho (Airbnb HMFRRRZRTN) — check-in 3:00 PM, check-out 10:00 AM · Oct 12–18",
            "transport_in": (
                "Fly EWR→LHR · British Airways BA184 · departs 5:50 PM Oct 12, arrives 5:50 AM Oct 13 "
                "(Jon typed LHW; this guide uses LHR). Transfer from Heathrow to 53 Greek St not specified."
            ),
        },
        {
            "name": "Normandy",
            "nights": 3,
            "days_range": "Day 8–Day 11",
            "focus": (
                "Objective Normandy American Sector tour (Utah, Omaha, American Cemetery) — guide Elisha "
                "(objectivenormandy.com lists Elisa Denis); self-guided Bayeux; Mont-Saint-Michel. Stay Bayeux."
            ),
            "stay": "4 Rue Franche, Bayeux (Airbnb HMKWYPDKBE) — check-in 5:00 PM Oct 19, check-out 12:00 PM Oct 22",
            "transport_in": (
                "Fly LHR→ORY BA8137 Oct 18, overnight at an ORY hotel (TBD), then to Bayeux Oct 19. "
                "ORY→Bayeux transfer is not specified — confirm with Jon."
            ),
        },
        {
            "name": "Porto",
            "nights": 4,
            "days_range": "Day 11–Day 15",
            "focus": "Self-guided city; Douro Valley.",
            "stay": (
                "Rua dos Mercadores 77, Ribeira São João, 3rd floor (Airbnb HM549AK8C2) — "
                "check-in 4:00 PM Oct 22, check-out 11:00 AM Oct 26. Jon wrote “Ribera San Joao.”"
            ),
            "transport_in": (
                "Fly ORY→OPO · TAP TP455 · departs 4:50 PM arrives 6:05 PM Oct 22. "
                "Bayeux→ORY transfer that morning is not specified."
            ),
        },
    ]
    src["introduction"] = {
        "arc": (
            "This itinerary threads WWII history across Britain and Normandy before closing in Porto. "
            "London nights are at 53 Greek Street in Soho. Wednesday Oct 14 is Imperial War Museum, "
            "Borough Market, dinner at Funky Noodle, then Operation Mincemeat at the Fortune Theatre. "
            "Thursday Oct 15 is Churchill War Rooms and the Kensington Royal Village walk; dinner that night is TBD. "
            "Other London days are still high-level ideas only (Battle of Britain Bunker, Bletchley Park, "
            "Tank Museum Bovington maybe overnight). Sunday Oct 18 flies Heathrow to Paris Orly "
            "(BA8137); the Orly hotel that night is TBD. Three nights in Bayeux cover the American Sector "
            "tour with Objective Normandy, a self-guided Bayeux day, and Mont-Saint-Michel — how you get "
            "from Orly to Bayeux on Oct 19 is not specified. Thursday Oct 22 flies Orly to Porto (TP455) "
            "to the Ribeira apartment. The return TAP TP211 OPO→EWR (7:30 PM–11:55 PM) has no date in Jon’s "
            "email; this guide assumes Oct 26 from the Porto checkout — confirm with Jon."
        ),
        "differentiators": (
            "Lodging is now three confirmed Airbnbs plus one missing Orly hotel: London HMFRRRZRTN at "
            "53 Greek St; Bayeux HMKWYPDKBE at 4 Rue Franche; Porto HM549AK8C2 at Rua dos Mercadores 77, "
            "3rd floor. The Channel ferry and UK rental are no longer on this plan — London to Normandy "
            "is LHR→ORY, then an unspecified transfer to Bayeux. Nuremberg stays dropped. "
            "The Bayeux Tapestry Museum remains closed for renovation through October 2027; the tapestry "
            "itself is on loan at the British Museum in London (10 Sep 2026 – Jul 2027) during these London days."
        ),
    }

    src["days"] = [
        day1(weather[0]),
        day2(weather[1]),
        day3(weather[2]),
        day4(weather[3]),
        day5(weather[4]),
        day6(weather[5]),
        day7(weather[6]),
        day8(weather[7]),
        day9,
        day10,
        day11(weather[10]),
        day12,
        day13,
        day14,
        day15(weather[14]),
    ]

    # Keep Day 9–10 / 12–14 lodging names consistent; drop stale "address pending" copy.
    for day in src["days"]:
        for item in day.get("items") or []:
            if item.get("hotel") and item["hotel"].get("name"):
                name = item["hotel"]["name"]
                if "Bayeux" in name or "Bruno" in name:
                    item["hotel"]["name"] = BAYEUX_HOTEL
                    item["hotel"]["address"] = BAYEUX_ADDR
                if "Porto Airbnb" in name or name == PORTO_HOTEL:
                    item["hotel"]["name"] = PORTO_HOTEL
                    item["hotel"]["address"] = PORTO_ADDR
            why = item.get("why") or ""
            if "Porto Airbnb's confirmed address (still pending)" in why:
                item["why"] = why.replace(
                    "Exact time depends on the Porto Airbnb's confirmed address (still pending) — refine once known.",
                    "From Rua dos Mercadores 77 (Ribeira São João, 3rd floor).",
                ).replace(
                    "exact time depends on the confirmed address",
                    "from Rua dos Mercadores 77",
                )

    out = ROOT / "data/trip-data.json"
    out.write_text(json.dumps(src, indent=2, ensure_ascii=False) + "\n")
    (ROOT / "data/trip-data.min.json").write_text(
        json.dumps(src, separators=(",", ":"), ensure_ascii=False) + "\n"
    )
    reembed(src)
    print("updated trip-data + embedded index.html")


def day1(weather):
    return {
        "label": "Day 1 · Mon Oct 12 · Depart Newark",
        "city": "London",
        "headline": "Overnight British Airways to Heathrow — Jon wrote LHW; this guide uses LHR",
        "weather": weather,
        "items": [
            I(
                "Flight",
                "17:50",
                "Newark (EWR) to London Heathrow (LHR) — British Airways BA184, nonstop overnight",
                why=(
                    "Flight number and times from Jonathan Ripchick email 2026-09-14. "
                    "Jon typed arrival airport as LHW — treated here as LHR (London Heathrow). "
                    "Published BA184 is EWR→LHR, typically Heathrow Terminal 5."
                ),
                contact={"phone": None, "website": "https://www.britishairways.com"},
                flight={
                    "carrier": "British Airways",
                    "flight_number": "BA184",
                    "from_airport": "EWR",
                    "to_airport": "LHR",
                    "depart_time": "17:50",
                    "arrive_time": "05:50",
                    "duration": "7h 00m",
                    "nonstop": True,
                    "cabin": None,
                    "aircraft": None,
                    "confirmation_note": (
                        "From Jon’s 2026-09-14 email: BA184 EWR 5:50 PM → LHR 5:50 AM (+1). "
                        "He typed LHW; display uses LHR. Confirm the ticket / record locator with Jon or BA."
                    ),
                },
            )
        ],
    }


def day2(weather):
    return {
        "label": "Day 2 · Tue Oct 13 · Arrive London",
        "city": "London",
        "headline": "Land Heathrow 5:50 AM — 53 Greek Street is booked; day’s plan is still high-level",
        "weather": weather,
        "items": [
            I(
                "Flight",
                "05:50",
                "Land Heathrow (LHR) — BA184 from EWR. Jon typed LHW; this is LHR.",
                why="Arrival time from Jon’s 2026-09-14 email. No terminal/immigration plan was specified.",
            ),
            I(
                "Transport",
                "07:00",
                "Transfer Heathrow to 53 Greek Street — method not specified",
                why="Jon listed the address but not how to get there from LHR. Confirm Tube / Elizabeth line / taxi with Jon.",
                location=LONDON_ADDR,
            ),
            I(
                "Hotel",
                "15:00",
                "53 Greek Street Airbnb is booked from Oct 12 — official check-in 3:00 PM",
                why=(
                    "Booking dates 10/12–10/18, Airbnb HMFRRRZRTN, check-in 3:00 PM / check-out 10:00 AM. "
                    "Travelers land Oct 13 ~5:50 AM, after the Oct 12 check-in window has already opened — "
                    "confirm key/access and whether morning arrival is fine."
                ),
                hotel={
                    "name": LONDON_HOTEL,
                    "address": LONDON_ADDR,
                    "phone": None,
                    "website": None,
                    "check_in_time": "15:00",
                    "confirmation_note": (
                        "Airbnb HMFRRRZRTN · 53 Greek St. · Oct 12–18 · check-in 3:00 PM, check-out 10:00 AM. "
                        "From Jon’s 2026-09-14 email. Ground-floor of this building is a bar (Thirst); "
                        "the listing is the Airbnb, not the bar. No listing URL was in the email."
                    ),
                },
            ),
            I(
                "Note",
                "16:00",
                "Rest of Tuesday is high-level only — no day-by-day from Jon for Oct 13",
                why=(
                    "Aug thread London ideas still open for unused days: Churchill War Rooms (scheduled Thu), "
                    "Imperial War Museum (scheduled Wed), Battle of Britain Bunker, Bletchley Park, "
                    "Tank Museum Bovington (maybe overnight), West End play (Operation Mincemeat is Wed night)."
                ),
            ),
        ],
    }


def day3(weather):
    return {
        "label": "Day 3 · Wed Oct 14 · Imperial War Museum, Borough Market & Operation Mincemeat",
        "city": "London",
        "headline": "IWM then Borough Market; Funky Noodle dinner and Operation Mincemeat at 7:30 PM",
        "weather": weather,
        "items": [
            I(
                "Transport",
                "09:30",
                "53 Greek St → Imperial War Museum: 12 min walk to Piccadilly Circus; Bakerloo southbound to Lambeth North, 4 stops; 9 min walk to the museum",
                why="Routing from Jon’s 2026-09-14 day-plan email. Tube running time between stops was not given.",
                location="Lambeth Road, London SE1 6HZ",
            ),
            I(
                "Activity",
                "09:30",
                "Imperial War Museum — 9:30 AM–12:00 PM window from Jon",
                end_time="12:00",
                location="Lambeth Road, London SE1 6HZ",
                why="Free museum; no ticket required for general admission. Jon blocked 9:30 AM–12:00 PM including transit from Soho.",
                contact={
                    "website": "https://www.iwm.org.uk/visits/iwm-london",
                    "booking_note": "General admission is free. Allow time for the WWII and Holocaust galleries.",
                    "hours": "Daily 10 AM–6 PM",
                    "price": "Free (donations welcome)",
                    "phone": "+44 20 7416 5000",
                },
            ),
            I(
                "Transport",
                "12:00",
                "IWM → Borough Market: 13 min walk to Elephant and Castle northbound Platform 1, 2 stops to London Bridge exit west side, 2 min walk",
                why="Routing from Jon’s 2026-09-14 email. 12:00–2:30 PM block includes walking the area.",
                location="Borough Market, 8 Southwark Street, London SE1 1TL",
                duration_min=None,
            ),
            I(
                "Activity",
                "12:00",
                "Borough Market — walk the area, then return to 53 Greek St to rest",
                end_time="14:30",
                location="Borough Market, 8 Southwark Street, London SE1 1TL",
                why="Jon: 12:00–2:30 PM at Borough Market, then back to 53 Greek St to rest before dinner. No lunch restaurant named.",
            ),
            I(
                "Note",
                "14:30",
                "Return to 53 Greek Street to rest before dinner",
                location=LONDON_ADDR,
            ),
            I(
                "Transport",
                "18:00",
                "Walk to Funky Noodle — Jon: 3 min from 53 Greek St",
                location="103 Charing Cross Road, London WC2H 0DT",
                duration_min=3,
                why="Jon said 3 minutes from 53 Greek St. The restaurant’s own address is 103 Charing Cross Road (around the corner from Greek Street), not on Greek Street itself.",
            ),
            I(
                "Dinner",
                "18:00",
                "Dinner at Funky Noodle — 3 min walk from 53 Greek St",
                restaurant={
                    "name": "Funky Noodle",
                    "neighborhood": "Soho / Charing Cross Road",
                    "cuisine": "Northwest Chinese, hand-pulled noodles",
                    "price_range": "££",
                    "why": (
                        "Jon’s Wednesday dinner, 3 minutes from 53 Greek St. Real venue is Funky Noodle, "
                        "103 Charing Cross Road, London WC2H 0DT — their site says they do not take reservations (walk-in)."
                    ),
                    "contact": {
                        "address": "103 Charing Cross Road, London WC2H 0DT",
                        "website": "https://www.funky-noodle.com/",
                        "hours": "Listed daily 12:00–10:00 PM",
                    },
                    "reservation": {"platform": "walkin"},
                    "open_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                    "verify_status": "verify_before_booking",
                    "verify_url": "https://www.google.com/maps/search/?api=1&query=Funky%20Noodle%20103%20Charing%20Cross%20Road%20London",
                },
            ),
            I(
                "Transport",
                "18:45",
                "15 min walk from Funky Noodle to Fortune Theatre",
                location="Fortune Theatre, 29 Russell Street, London WC2B 5HH",
                duration_min=15,
                why="Jon: 6:45 PM, 15-minute walk from Funky Noodle to the theatre. Arrive 7:00 PM for a 7:30 PM show.",
            ),
            I(
                "Activity",
                "19:00",
                "Operation Mincemeat — Fortune Theatre, 29 Russell Street — arrive 7:00 PM for 7:30 PM showtime",
                end_time="22:00",
                location="Fortune Theatre, 29 Russell Street, London WC2B 5HH",
                why=(
                    "From Jon’s 2026-09-14 email. The show is at the Fortune Theatre (29 Russell Street / WC2B 5HH). "
                    "Published evening performances are 7:30 PM; running time about 2 hours 20 minutes including interval "
                    "(typical finish ~9:50 PM), which matches Jon’s 10:00 PM return."
                ),
                contact={
                    "website": "https://www.atgtickets.com/shows/operation-mincemeat-a-new-musical/fortune-theatre/",
                    "phone": "0333 009 6690",
                    "hours": "Evening performances Mon–Sat 7:30 PM",
                    "booking_note": "Jon listed the show and theatre; ticket status was not in the email — confirm seats are held.",
                },
            ),
            I(
                "Transport",
                "22:00",
                "Return to 53 Greek Street",
                location=LONDON_ADDR,
                why="Jon: 10:00 PM return to 53 Greek St. Route not specified.",
            ),
        ],
    }


def day4(weather):
    return {
        "label": "Day 4 · Thu Oct 15 · Churchill War Rooms & Kensington Walk",
        "city": "London",
        "headline": "War Rooms in the morning, Kensington Royal Village walk at 2:00 PM — dinner TBD",
        "weather": weather,
        "items": [
            I(
                "Transport",
                "09:30",
                "Walk 53 Greek St → Churchill War Rooms — about 20 minutes to King Charles Street, London SW1A 2AQ",
                location="Clive Steps, King Charles Street, London SW1A 2AQ",
                duration_min=20,
                why="Jon’s Thursday plan: 9:30 AM walk, about 20 minutes.",
            ),
            I(
                "Activity",
                "10:00",
                "Churchill War Rooms — 10:00 AM–12:00 PM",
                end_time="12:00",
                location="Clive Steps, King Charles Street, London SW1A 2AQ",
                why="Jon blocked 10:00 AM–12:00 PM. Book timed-entry tickets — October dates can sell out.",
                contact={
                    "phone": "+44 20 7930 6961",
                    "website": "https://www.iwm.org.uk/visits/churchill-war-rooms",
                    "booking_note": "Timed-entry tickets at iwm.org.uk. Audio guide included.",
                    "hours": "Daily 9:30 AM–6 PM (last entry 5 PM)",
                },
            ),
            I(
                "Note",
                "12:00",
                "12:00–2:00 PM — lunch (restaurant not named), then transit to High Street Kensington",
                end_time="14:00",
                why="Jon: lunch then transit. No restaurant named. Do not treat any leftover Soho/Westminster booking as Thursday lunch.",
            ),
            I(
                "Transport",
                "12:30",
                "To High Street Kensington: walk 9 min to St. James’s Park; Circle westbound via Victoria, 5 stops",
                location="High Street Kensington Underground station, London W8 (meet by the Wasabi restaurant at the end of the shopping arcade linking the station to the High Street)",
                duration_min=9,
                why="Jon’s routing. duration_min is the 9-minute walk only; Circle-line running time was not given.",
            ),
            I(
                "Activity",
                "14:00",
                "London Walks: Kensington Royal Village — meet at Wasabi at the end of the tube shopping arcade",
                end_time="16:00",
                location="High Street Kensington Underground station, London W8 (meet by the Wasabi restaurant at the end of the shopping arcade linking the station to the High Street)",
                why=(
                    "Jon’s Thursday 2:00–4:00 PM block. An earlier Aug 21 confirmation email reserved this walk "
                    "(Walk ID 110, 2 attendees, 2:00 PM 15/10) — that booking matches this day; confirm it still stands."
                ),
                contact={
                    "phone": "+44 20 7624 3978",
                    "website": "https://www.walks.com",
                    "booking_note": "Earlier reservation: Walk ID 110, 2 attendees, 15 Oct 2026 2:00 PM. Meet by Wasabi, 5 min before start.",
                    "hours": "2:00 PM, 15/10/2026",
                },
            ),
            I(
                "Transport",
                "16:00",
                "Return to 53 Greek St: Circle eastbound platform 2, 3 stops to Paddington; 3 min to Elizabeth line platform A; 2 stops to Tottenham Court Road; exit Dean/Oxford St; 9 min walk",
                location=LONDON_ADDR,
                why="Jon’s 4:00 PM return routing. Individual walk legs 3 min + 9 min; tube times not given as minutes.",
            ),
            I(
                "Dinner",
                "19:00",
                "Dinner TBD — Jon did not name a Thursday restaurant",
                why="Leave this open. Do not reuse an old leftover booking as if it were Thursday dinner.",
            ),
        ],
    }


def day5(weather):
    return {
        "label": "Day 5 · Fri Oct 16 · London — high-level only",
        "city": "London",
        "headline": "No day-by-day from Jon for Friday — leftover London ideas only",
        "weather": weather,
        "items": [
            I(
                "Note",
                "09:00",
                "Friday is not detailed in the Sep 14 emails",
                why=(
                    "Still-open London ideas from the Aug thread (not scheduled to a clock time): "
                    "Battle of Britain Bunker (about an hour from center); Bletchley Park; "
                    "The Tank Museum Bovington (Jon: maybe an overnight — that would have to be before the Oct 18 LHR→ORY flight). "
                    "The West End play on this trip is Wednesday’s Operation Mincemeat."
                ),
            )
        ],
    }


def day6(weather):
    return {
        "label": "Day 6 · Sat Oct 17 · London — high-level only",
        "city": "London",
        "headline": "No day-by-day from Jon for Saturday — confirm any leftover walk reservations",
        "weather": weather,
        "items": [
            I(
                "Note",
                "09:00",
                "Saturday is not detailed in the Sep 14 emails",
                why=(
                    "Earlier emails reserved London Walks on this Saturday that Jon’s Sep 14 day-by-day did not restate: "
                    "Thames Sightseeing / Brunel’s River Walk (Walk ID 3315, 10:00 AM) and Disastrous London (Walk ID 430, 2:30 PM). "
                    "Confirm whether those still stand. Other unused London ideas: Bunker, Bletchley, Tank Museum."
                ),
            )
        ],
    }


def day7(weather):
    return {
        "label": "Day 7 · Sun Oct 18 · Fly London → Paris Orly",
        "city": "London",
        "headline": "Checkout 10:00 AM · BA8137 LHR→ORY 3:00 PM · Orly hotel TBD",
        "weather": weather,
        "items": [
            I(
                "Hotel",
                "10:00",
                "Check out of 53 Greek Street Airbnb — official check-out 10:00 AM",
                hotel={
                    "name": LONDON_HOTEL,
                    "address": LONDON_ADDR,
                    "phone": None,
                    "website": None,
                    "check_out_time": "10:00",
                    "confirmation_note": "Airbnb HMFRRRZRTN · check-out 10:00 AM Oct 18. Same-day LHR→ORY at 3:00 PM. Transfer to Heathrow not specified.",
                },
            ),
            I(
                "Transport",
                "11:00",
                "53 Greek St → Heathrow (LHR) — method not specified",
                why="Jon listed the 3:00 PM LHR departure but not how to get to the airport. BA8137 is a BA codeshare typically from Heathrow Terminal 4 (operated by Vueling as VY8961) — not BA’s usual T5.",
            ),
            I(
                "Flight",
                "15:00",
                "London Heathrow (LHR) to Paris Orly (ORY) — British Airways BA8137",
                contact={"website": "https://www.britishairways.com"},
                flight={
                    "carrier": "British Airways",
                    "flight_number": "BA8137",
                    "from_airport": "LHR",
                    "to_airport": "ORY",
                    "depart_time": "15:00",
                    "arrive_time": "17:35",
                    "duration": "1h 35m",
                    "nonstop": True,
                    "cabin": None,
                    "aircraft": None,
                    "confirmation_note": (
                        "From Jon’s 2026-09-14 email: BA8137 LHR 3:00 PM → ORY 5:35 PM. "
                        "Published BA8137 is a BA codeshare on Vueling VY8961 (typically LHR T4 → ORY T3). "
                        "Confirm the ticket and operating carrier with Jon / BA."
                    ),
                },
                why="Clock time 3:00–5:35 is 2h 35m; UK is 1 hour behind France in October, so airborne time is ~1h 35m.",
            ),
            I(
                "Hotel",
                "18:30",
                "ORY hotel night of Oct 18 — TBD",
                why="Jon: “ORY hotel 10/18/26 — TBD.” Do not invent a property, address, or transfer from ORY.",
                hotel={
                    "name": ORY_HOTEL,
                    "address": None,
                    "phone": None,
                    "website": None,
                    "city": "Orly (TBD)",
                    "check_in_time": None,
                    "confirmation_note": (
                        "Unbooked / unnamed. Night of Sunday Oct 18 only. "
                        "Needed because the next Bayeux check-in is Monday Oct 19 at 5:00 PM."
                    ),
                },
            ),
        ],
    }


def day8(weather):
    return {
        "label": "Day 8 · Mon Oct 19 · To Bayeux — transfer from Orly not specified",
        "city": "Normandy",
        "headline": "Get from the Orly-area hotel to Bayeux; check in 5:00 PM. American Sector tour day still unconfirmed.",
        "weather": weather,
        "items": [
            I(
                "Note",
                "09:00",
                "Transfer ORY hotel → Bayeux is not specified — confirm with Jon",
                why=(
                    "Starting from an unnamed Orly hotel. Do not assume a same-morning American Sector tour "
                    "until pickup and timing are confirmed with Elisha / Objective Normandy."
                ),
            ),
            I(
                "Activity",
                "10:00",
                "Objective Normandy — American Sector (Utah, Omaha, American Cemetery) — confirm which day",
                location="American Cemetery, 14710 Colleville-sur-Mer, France",
                why=(
                    "From the Aug city-level plan: full-day American Sector tour, guide Elisha, "
                    "https://objectivenormandy.com/ (site lists the guide as Elisa Denis). "
                    "Jon’s Sep 14 email did not assign this tour to Oct 19. Official Bayeux check-in is 5:00 PM."
                ),
                contact={
                    "website": "https://objectivenormandy.com/",
                    "booking_note": "Confirm date, pickup (Orly vs Bayeux), and group size with contact@objectivenormandy.com.",
                },
            ),
            I(
                "Hotel",
                "17:00",
                "Check in to 4 Rue Franche, Bayeux (Airbnb HMKWYPDKBE) — official check-in 5:00 PM",
                hotel={
                    "name": BAYEUX_HOTEL,
                    "address": BAYEUX_ADDR,
                    "phone": None,
                    "website": None,
                    "check_in_time": "17:00",
                    "confirmation_note": (
                        "Airbnb HMKWYPDKBE · 4 Rue Franche, Bayeux · Oct 19–22 · check-in 5:00 PM, check-out 12:00 PM. "
                        "From Jon’s 2026-09-14 email. Arrival time from Orly is unknown — message the host if you will be late."
                    ),
                },
            ),
        ],
    }


def day11(weather):
    return {
        "label": "Day 11 · Thu Oct 22 · Fly Orly → Porto",
        "city": "Porto",
        "headline": "Bayeux checkout 12:00 PM · TP455 ORY→OPO 4:50 PM · Ribeira apartment 3rd floor",
        "weather": weather,
        "items": [
            I(
                "Hotel",
                "12:00",
                "Check out of 4 Rue Franche, Bayeux — official check-out 12:00 PM",
                hotel={
                    "name": BAYEUX_HOTEL,
                    "address": BAYEUX_ADDR,
                    "phone": None,
                    "website": None,
                    "check_out_time": "12:00",
                    "confirmation_note": (
                        "Airbnb HMKWYPDKBE · check-out 12:00 PM Oct 22. Same-day TP455 ORY 4:50 PM. "
                        "Bayeux→ORY transfer is not specified — confirm with Jon. Official checkout is 12:00 PM; "
                        "leaving earlier is a “no later than” bound, not a required 12:00 departure."
                    ),
                },
            ),
            I(
                "Transport",
                "12:30",
                "Bayeux → Paris Orly (ORY) — method and duration not specified",
                why="Needed to make TP455 at 4:50 PM. Do not invent a driver, train, or drive time.",
            ),
            I(
                "Flight",
                "16:50",
                "Paris Orly (ORY) to Porto (OPO) — TAP TP455",
                contact={"website": "https://www.flytap.com"},
                flight={
                    "carrier": "TAP Air Portugal",
                    "flight_number": "TP455",
                    "from_airport": "ORY",
                    "to_airport": "OPO",
                    "depart_time": "16:50",
                    "arrive_time": "18:05",
                    "duration": "2h 15m",
                    "nonstop": True,
                    "cabin": None,
                    "aircraft": None,
                    "confirmation_note": (
                        "From Jon’s 2026-09-14 email: TP455 ORY 4:50 PM → OPO 6:05 PM. "
                        "Portugal is 1 hour behind mainland France, so airborne time is ~2h 15m. Confirm the ticket with Jon / TAP."
                    ),
                },
            ),
            I(
                "Transport",
                "18:20",
                "OPO → Rua dos Mercadores 77 — method not specified",
                location=PORTO_ADDR,
                why="Apartment is in Ribeira São João (Jon: Ribera San Joao), 3rd floor. Official check-in 4:00 PM; flight lands 6:05 PM.",
            ),
            I(
                "Hotel",
                "18:45",
                "Check in to Rua dos Mercadores 77, Ribeira São João, 3rd floor (Airbnb HM549AK8C2)",
                hotel={
                    "name": PORTO_HOTEL,
                    "address": PORTO_ADDR,
                    "phone": None,
                    "website": None,
                    "check_in_time": "16:00",
                    "confirmation_note": (
                        "Airbnb HM549AK8C2 · Rua dos Mercadores 77, Ribeira São João, Apt 3rd floor · Oct 22–26 · "
                        "check-in 4:00 PM, check-out 11:00 AM. From Jon’s 2026-09-14 email (he wrote “Ribera San Joao”). "
                        "Unit number beyond “3rd floor” was not given. Flight lands after official check-in — that is fine if access is arranged."
                    ),
                },
            ),
            I(
                "Note",
                "19:30",
                "Evening in Ribeira — self-guided; no dinner named for arrival night",
                location="Cais da Ribeira, 4050-510 Porto, Portugal",
                why="Aug plan for Porto is self-guided city + Douro Valley. The apartment is on Rua dos Mercadores in Ribeira.",
            ),
        ],
    }


def day15(weather):
    return {
        "label": "Day 15 · Mon Oct 26 · Depart Porto for Newark (date assumed)",
        "city": "Porto",
        "headline": "Checkout 11:00 AM · TAP TP211 7:30 PM — Oct 26 assumed, confirm with Jon",
        "weather": weather,
        "items": [
            I(
                "Hotel",
                "11:00",
                "Check out of Rua dos Mercadores 77 — official check-out 11:00 AM",
                hotel={
                    "name": PORTO_HOTEL,
                    "address": PORTO_ADDR,
                    "phone": None,
                    "website": None,
                    "check_out_time": "11:00",
                    "confirmation_note": (
                        "Airbnb HM549AK8C2 · check-out 11:00 AM. Return flight that evening is assumed to be this calendar day."
                    ),
                },
            ),
            I(
                "Note",
                "12:00",
                "Oct 26 assumed — confirm the TP211 date with Jon",
                why=(
                    "Jon listed TAP TP211 OPO 7:30 PM → EWR 11:55 PM with no date. "
                    "This guide places it on Oct 26 because Porto checkout is Oct 26. "
                    "If the ticket is a different day, the whole Day 15 block is wrong."
                ),
            ),
            I(
                "Transport",
                "16:00",
                "Rua dos Mercadores 77 → Porto Airport (OPO) — method not specified",
                why="Flight is 7:30 PM. No driver or duration was in the email.",
            ),
            I(
                "Flight",
                "19:30",
                "Porto (OPO) to Newark (EWR) — TAP TP211 · Oct 26 assumed — confirm with Jon",
                contact={"website": "https://www.flytap.com"},
                flight={
                    "carrier": "TAP Air Portugal",
                    "flight_number": "TP211",
                    "from_airport": "OPO",
                    "to_airport": "EWR",
                    "depart_time": "19:30",
                    "arrive_time": "23:55",
                    "duration": "8h 25m",
                    "nonstop": True,
                    "cabin": None,
                    "aircraft": None,
                    "confirmation_note": (
                        "Oct 26 assumed — confirm with Jon. Email gave TP211 OPO 7:30 PM → EWR 11:55 PM and no date. "
                        "Placed on Oct 26 only because Porto checkout is that day. "
                        "Duration 8h 25m is from those clock times on Oct 26 (Portugal already off summer time; US still on EDT)."
                    ),
                    "_dateUnconfirmed": True,
                },
            ),
        ],
    }


def reembed(trip):
    html_path = ROOT / "index.html"
    html = html_path.read_text()
    trip_json = json.dumps(trip, indent=2, ensure_ascii=False)
    html, n = re.subn(
        r'<script id="trip-data" type="application/json">[\s\S]*?</script>',
        '<script id="trip-data" type="application/json">' + trip_json + "</script>",
        html,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"trip-data reembed failed ({n})")
    html_path.write_text(html)


if __name__ == "__main__":
    main()
