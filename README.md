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

## Next (Sunday plan)

- Real travel time between locations (routing API or straight-line distance estimate)
- Conflict drill-in options: swap drivers, ask a carpool contact
- "Sunday briefing" summary of the coming week
- Nudge about calendar gaps (e.g. no school pickups in any feed) so the radar doesn't give false confidence
