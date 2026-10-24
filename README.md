# Family Air Traffic Control

Merge everyone's calendars and flag the moments where a kid needs a ride and no adult is free.

Single-page web app, no backend: calendars are parsed in the browser with [ical.js](https://github.com/kewisch/ical.js) and stay on your machine (saved in localStorage).

## Run it

```sh
npm install      # only needed for tests
npm start        # serves on http://localhost:5173 (any static server works; file:// won't, ES modules need http)
npm test
```

Click **Load sample family** and go to the week of Oct 26 2026 to see three seeded conflicts.

## How it works

- `src/ics.js` expands each feed (RRULEs, moved and cancelled instances, all-day, "show as free") into concrete events for the visible week.
- `src/conflicts.js` turns each kid's located events into car trips: drop-off, pick-up, or a handoff when one activity ends near the start of the next at a different place. Siblings going to the same place at once share a trip. Each trip needs a free adult; a small exact search assigns drivers and anything left over is a conflict. Kids booked in two places at once are flagged too.
- `src/lanes.js` draws the week as horizontal lanes (one per person plus the car) with red bands over conflicts.

Travel time is a flat buffer for now (default 20 min).

## Travel time, options and the briefing

- `src/travel.js` estimates drive time from coordinates (straight-line distance x 1.4 for roads, 35 km/h, 5 min overhead). **Look up travel times** geocodes the addresses with OpenStreetMap's Nominatim (one request per second) and caches them in the browser. Anything it can't find uses the flat buffer.
- A kid whose next activity starts before they can get there is flagged as a **tight handoff**.
- Clicking a conflict lists options: swap drivers (and whether that leaves another trip uncovered), ask a busy adult to move something, or ask a carpool contact (one per line in settings).
- `src/briefing.js` writes the Sunday briefing (copy it into the family chat) and a "Check before trusting this" box for calendars that are empty or have kid events with no location.

## Not done yet

- Fetching Google "secret iCal" URLs (needs a small CORS proxy)
- Sending the briefing anywhere automatically
