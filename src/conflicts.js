// Conflict detection. Two kinds for now:
//  - double-booked: one person has overlapping events
//  - no-driver: a kid needs a ride (drop-off, pick-up or handoff between
//    activities) and no adult is free to take it
//  - tight-handoff: a kid's next activity starts before they can get there
// Travel time comes from a (from, to) -> minutes function (see travel.js).

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const sameLocation = (a, b) => normalize(a.location) === normalize(b.location);
const normalize = (loc) => (loc || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MAX_BACKTRACK_LEGS = 12;

const timed = (events) => events.filter((e) => !e.allDay && !e.free);

// Only kids: an adult with a work block and a meeting at once is normal noise,
// but a kid can't be at soccer and swim at the same time.
export function detectDoubleBookings(events, kids) {
  const byPerson = groupBy(timed(events).filter((e) => kids.includes(e.person)), (e) => e.person);
  const out = [];
  for (const [person, list] of byPerson) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
        const [a, b] = [list[i], list[j]];
        out.push({
          id: `double:${a.id}:${b.id}`,
          type: 'double-booked',
          people: [person],
          events: [a, b],
          start: b.start,
          end: a.end < b.end ? a.end : b.end,
        });
      }
    }
  }
  return out;
}

// Turn kids' located events into the car trips they imply.
export function buildRideLegs(events, kids, travelMin) {
  const flat = typeof travelMin === 'number' ? () => travelMin : travelMin;
  const min = (m) => m * 60_000;
  const legs = [];
  for (const kid of kids) {
    const list = timed(events)
      .filter((e) => e.person === kid && e.location)
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const prev = list[i - 1];
      const next = list[i + 1];
      // events close together (within two typical trips) are one outing, not a trip home in between
      const chained = (x, y) => x.end <= y.start && y.start - x.end <= 2 * min(flat(x.location, y.location));
      const chainedFromPrev = prev && chained(prev, e);
      const chainsToNext = next && chained(e, next);

      if (chainedFromPrev) {
        if (!sameLocation(prev, e)) {
          const need = min(flat(prev.location, e.location));
          const l = leg('handoff', kid, prev.location, e.location, prev.end,
            new Date(Math.max(e.start, +prev.end + need)), [prev, e]);
          l.travelMin = flat(prev.location, e.location);
          l.tight = prev.end.getTime() + need > e.start.getTime();
          legs.push(l);
        }
      } else {
        const t = flat(null, e.location);
        legs.push({ ...leg('dropoff', kid, null, e.location, new Date(e.start - min(t)), e.start, [e]), travelMin: t });
      }
      if (!chainsToNext) {
        const t = flat(e.location, null);
        legs.push({ ...leg('pickup', kid, e.location, null, e.end, new Date(+e.end + min(t)), [e]), travelMin: t });
      }
    }
  }
  return mergeSharedLegs(legs).sort((a, b) => a.start - b.start);
}

function leg(kind, kid, from, to, start, end, events) {
  return { id: `${kind}:${kid}:${+start}`, kind, kids: [kid], from, to, start, end, events };
}

// Siblings going to (or leaving) the same place at the same time share one car.
function mergeSharedLegs(legs) {
  const out = [];
  for (const l of legs) {
    const twin = out.find((o) => o.kind === l.kind && overlaps(o, l)
      && sameLocation({ location: o.from }, { location: l.from })
      && sameLocation({ location: o.to }, { location: l.to }));
    if (twin) {
      twin.kids.push(...l.kids);
      twin.events.push(...l.events);
      twin.start = new Date(Math.min(twin.start, l.start));
      twin.end = new Date(Math.max(twin.end, l.end));
    } else {
      out.push({ ...l, kids: [...l.kids], events: [...l.events] });
    }
  }
  return out;
}

export function assignDrivers(legs, events, adults) {
  const busy = new Map(); // legId -> [{adult, event}]
  const eligible = new Map(); // legId -> [adult]
  for (const l of legs) {
    const reasons = [];
    for (const a of adults) {
      const clash = timed(events).find((e) => e.person === a && overlaps(e, l));
      if (clash) reasons.push({ adult: a, event: clash });
    }
    busy.set(l.id, reasons);
    eligible.set(l.id, adults.filter((a) => !reasons.some((r) => r.adult === a)));
  }

  const assignment = new Map();
  for (const cluster of overlapClusters(legs)) {
    const solve = cluster.length <= MAX_BACKTRACK_LEGS ? solveExact : solveGreedy;
    for (const [id, adult] of solve(cluster, eligible)) assignment.set(id, adult);
  }
  return { assignment, busy, eligible };
}

function overlapClusters(legs) {
  const clusters = [];
  let current = [];
  let currentEnd = 0;
  for (const l of [...legs].sort((a, b) => a.start - b.start)) {
    if (current.length && l.start >= currentEnd) {
      clusters.push(current);
      current = [];
    }
    current.push(l);
    currentEnd = Math.max(currentEnd, l.end);
  }
  if (current.length) clusters.push(current);
  return clusters;
}

// Try every driver/leg combination and keep the one that covers the most legs.
function solveExact(legs, eligible) {
  let best = new Map(legs.map((l) => [l.id, null]));
  let bestCount = -1;
  const chosen = new Map();
  const go = (i, count) => {
    if (count + (legs.length - i) <= bestCount) return;
    if (i === legs.length) {
      bestCount = count;
      best = new Map(chosen);
      return;
    }
    const l = legs[i];
    for (const a of eligible.get(l.id)) {
      const taken = legs.slice(0, i).some((o) => chosen.get(o.id) === a && overlaps(o, l));
      if (taken) continue;
      chosen.set(l.id, a);
      go(i + 1, count + 1);
    }
    chosen.set(l.id, null);
    go(i + 1, count);
  };
  go(0, 0);
  return best;
}

function solveGreedy(legs, eligible) {
  const chosen = new Map();
  for (const l of legs) {
    const a = eligible.get(l.id).find((a) =>
      !legs.some((o) => chosen.get(o.id) === a && overlaps(o, l)));
    chosen.set(l.id, a ?? null);
  }
  return chosen;
}

export function detectConflicts(events, family, { bufferMin = 20, travelMin } = {}) {
  const adults = family.filter((p) => p.role === 'adult').map((p) => p.id);
  const kids = family.filter((p) => p.role === 'kid').map((p) => p.id);
  const legs = buildRideLegs(events, kids, travelMin ?? bufferMin);
  const { assignment, busy, eligible } = assignDrivers(legs, events, adults);

  const noDriver = legs
    .filter((l) => !assignment.get(l.id))
    .map((l) => ({
      id: `ride:${l.id}`,
      type: 'no-driver',
      people: [...l.kids, ...adults],
      leg: l,
      start: l.start,
      end: l.end,
      busy: busy.get(l.id),
      // free adults who were needed for an overlapping leg instead
      drivingElsewhere: eligible.get(l.id).map((a) => {
        const other = legs.find((o) => o !== l && assignment.get(o.id) === a && overlaps(o, l));
        return {
          adult: a,
          leg: other,
          // other adults who could take that trip instead, freeing `a` for this one
          swapCover: other ? eligible.get(other.id).filter((x) => x !== a) : [],
        };
      }),
    }));

  const tight = legs.filter((l) => l.tight).map((l) => ({
    id: `tight:${l.id}`,
    type: 'tight-handoff',
    people: [...l.kids],
    leg: l,
    start: l.events[0].end,
    end: l.events[1].start > l.end ? l.events[1].start : l.end,
  }));

  return {
    legs,
    assignment,
    conflicts: [...detectDoubleBookings(events, kids), ...tight, ...noDriver].sort((a, b) => a.start - b.start),
  };
}

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
