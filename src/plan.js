// The plan: every car trip the week needs, who is driving it, and what's wrong.
// Drivers start from the automatic assignment in conflicts.js; anything the
// family changes by hand (a driver menu pick, a drag onto the dock, a suggested
// fix) is an override keyed by trip id, so it survives re-renders and reloads.

import { detectConflicts } from './conflicts.js';

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const TIGHT_MIN = 10;
const RANK = { none: 1, late: 2, tight: 3, clash: 4, double: 5, away: 6 };
export const sevOf = (kind) => (kind === 'away' || kind === 'double' || kind === 'clash' ? 'bad' : kind ? 'warn' : '');

export function buildPlan({ events, family, carpool = [], travelMin, overrides = {} }) {
  const { legs, assignment, conflicts } = detectConflicts(events, family, { travelMin });
  const people = new Map(family.map((p) => [p.id, p]));
  const adults = family.filter((p) => p.role === 'adult');
  const drivers = new Map([
    ...adults.map((p) => [p.id, { key: p.id, name: p.name, initial: initialOf(p.name), color: p.color }]),
    ...carpool.map((c, i) => [`carpool:${i}`, { key: `carpool:${i}`, name: c.name, initial: initialOf(c.name), note: c.note, pool: true }]),
  ]);
  const busy = new Map(adults.map((p) => [p.id,
    events.filter((e) => e.person === p.id && !e.allDay && !e.free)]));

  const trips = legs.map((l) => {
    const target = l.kind === 'handoff' ? l.events[1] : l.events[0];
    const fallback = assignment.get(l.id) ?? null;
    const chosen = Object.hasOwn(overrides, l.id) ? overrides[l.id] : fallback;
    return {
      id: l.id,
      leg: l,
      kind: l.kind,
      kids: l.kids,
      title: target.title,
      place: l.kind === 'pickup' ? l.from : l.to,
      from: l.from,
      to: l.to,
      start: l.start,
      end: l.end,
      driver: chosen && drivers.has(chosen) ? chosen : null,
      auto: fallback,
    };
  });

  // problems the drivers can't fix, straight from the engine
  const fixed = [];
  for (const c of conflicts) {
    if (c.type === 'tight-handoff') {
      const t = trips.find((x) => x.id === c.leg.id);
      if (t) fixed.push({ id: `late:${t.id}`, kind: 'late', trips: [t.id], start: c.start, travelMin: c.leg.travelMin });
    } else if (c.type === 'double-booked') {
      const ids = trips.filter((t) => t.leg.events.some((e) => c.events.includes(e))).map((t) => t.id);
      fixed.push({ id: c.id, kind: 'clash', trips: ids, start: c.start, person: c.people[0], events: c.events });
    }
  }

  const plan = { trips, drivers, busy, people, fixed, overrides: { ...overrides } };
  Object.assign(plan, evaluate(plan));
  return plan;
}

const initialOf = (name) => (name.trim()[0] || '?').toUpperCase();

export function evaluate(plan) {
  const alerts = [...plan.fixed];
  const status = {};
  const mark = (id, kind) => { if (!status[id] || RANK[kind] > RANK[status[id]]) status[id] = kind; };
  for (const a of plan.fixed) a.trips.forEach((id) => mark(id, a.kind));

  for (const t of plan.trips) {
    if (!t.driver) {
      alerts.push({ id: `none:${t.id}`, kind: 'none', trips: [t.id], start: t.start });
      mark(t.id, 'none');
      continue;
    }
    const clash = (plan.busy.get(t.driver) || []).find((e) => overlaps(e, t));
    if (clash) {
      alerts.push({ id: `away:${t.id}`, kind: 'away', trips: [t.id], start: t.start, driver: t.driver, event: clash });
      mark(t.id, 'away');
    }
  }

  for (const d of plan.drivers.values()) {
    if (d.pool) continue;
    const mine = plan.trips.filter((t) => t.driver === d.key).sort((a, b) => a.start - b.start);
    for (let i = 0; i < mine.length - 1; i++) {
      const a = mine[i];
      const b = mine[i + 1];
      const gap = (b.start - a.end) / 60_000;
      if (gap < 0) {
        alerts.push({ id: `double:${a.id}+${b.id}`, kind: 'double', trips: [b.id, a.id], start: b.start, driver: d.key });
        mark(a.id, 'double');
        mark(b.id, 'double');
      } else if (gap < TIGHT_MIN && (a.to ?? 'home') !== (b.from ?? 'home')) {
        alerts.push({ id: `tight:${a.id}+${b.id}`, kind: 'tight', trips: [b.id, a.id], start: b.start, driver: d.key, gap: Math.round(gap) });
        mark(a.id, 'tight');
        mark(b.id, 'tight');
      }
    }
  }
  alerts.sort((a, b) => a.start - b.start || RANK[b.kind] - RANK[a.kind]);
  return { alerts, status };
}

// Try a different driver on a trip without changing the plan.
function trial(plan, trip, driver) {
  const keep = trip.driver;
  trip.driver = driver;
  const r = evaluate(plan);
  trip.driver = keep;
  return r;
}

export function wouldConflict(plan, trip, driver) {
  return trial(plan, trip, driver).alerts.some((a) => a.trips.includes(trip.id));
}

// Up to three one-tap fixes for an alert: a different family driver first,
// then a carpool contact. Each fix must clear the trip and lower the total.
export function suggestions(plan, alert) {
  const base = plan.alerts.length;
  const out = [];
  for (const id of alert.trips) {
    const t = plan.trips.find((x) => x.id === id);
    if (!t) continue;
    for (const d of plan.drivers.values()) {
      if (d.key === t.driver) continue;
      const r = trial(plan, t, d.key);
      if (r.alerts.some((a) => a.trips.includes(t.id)) || r.alerts.length >= base) continue;
      out.push({
        rank: d.pool ? 2 : 1,
        tripId: t.id,
        driver: d.key,
        label: d.pool
          ? `Ask ${d.name} to take ${kidNames(plan, t)} (${t.title.toLowerCase()})`
          : `${d.name} takes ${t.title.toLowerCase()}`,
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 3);
}

export const kidNames = (plan, t) => t.kids.map((k) => plan.people.get(k)?.name ?? k).join(' and ');
