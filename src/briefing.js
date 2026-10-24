// Turns conflicts into things a person can act on: concrete options for each
// conflict, calendar-gap warnings, and the plain-text Sunday briefing.

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'long' });
const place = (l) => (l.kind === 'pickup' ? `from ${l.from}` : `to ${l.to}`);

export function optionsFor(conflict, { nameOf, carpool = [] }) {
  const out = [];
  if (conflict.type === 'no-driver') {
    const l = conflict.leg;
    for (const d of conflict.drivingElsewhere) {
      const them = d.leg.kids.map(nameOf).join(' + ');
      if (d.swapCover.length) {
        out.push(`${nameOf(d.adult)} drives ${l.kids.map(nameOf).join(' + ')}, and ${d.swapCover.map(nameOf).join(' or ')} takes ${them} ${place(d.leg)} instead.`);
      } else {
        out.push(`${nameOf(d.adult)} could drive this, but then nobody is left to take ${them} ${place(d.leg)}.`);
      }
    }
    for (const b of conflict.busy) {
      out.push(`${nameOf(b.adult)} moves or leaves early from "${b.event.title}" (${fmtTime(b.event.start)}–${fmtTime(b.event.end)}).`);
    }
    for (const c of carpool) {
      out.push(`Ask ${c.name}${c.note ? ` (${c.note})` : ''} for a ride ${place(l)}.`);
    }
  } else if (conflict.type === 'tight-handoff') {
    const [a, b] = conflict.leg.events;
    out.push(`Leave "${a.title}" ${conflict.leg.travelMin ? `about ${conflict.leg.travelMin} min` : 'early'} before it ends.`);
    out.push(`Arrive late to "${b.title}" and tell the organizer.`);
    for (const c of carpool) out.push(`Ask ${c.name} to take ${conflict.leg.kids.map(nameOf).join(' + ')} to ${conflict.leg.to}.`);
  } else {
    out.push('Pick one of the two, or ask the organizer whether one is optional.');
  }
  return out;
}

// Warnings about what the radar can't see. It would rather say "I might be blind
// here" than show a calm week built on an empty calendar.
export function calendarGaps(events, family) {
  const warnings = [];
  for (const p of family) {
    const mine = events.filter((e) => e.person === p.id);
    if (!mine.length) {
      warnings.push(`${p.name} has no events this week. Is their calendar up to date?`);
      continue;
    }
    if (p.role === 'kid') {
      const noLoc = mine.filter((e) => !e.allDay && !e.free && !e.location);
      if (noLoc.length) {
        warnings.push(`${noLoc.length} of ${p.name}'s events have no location (${noLoc.slice(0, 3).map((e) => `"${e.title}"`).join(', ')}${noLoc.length > 3 ? ', …' : ''}), so no rides can be planned for them.`);
      }
    }
  }
  return warnings;
}

export function sundayBriefing({ family, legs, assignment, conflicts, events, weekStart, carpool = [] }) {
  const nameOf = (id) => family.find((p) => p.id === id)?.name ?? id;
  const lines = [];
  const weekLabel = weekStart.toLocaleDateString([], { month: 'long', day: 'numeric' });
  lines.push(`Sunday briefing: week of ${weekLabel}`);
  lines.push('');
  lines.push(conflicts.length
    ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} to sort out before Monday.`
    : 'No conflicts found. Every ride has a driver.');

  const days = new Map();
  for (const c of conflicts) {
    const k = c.start.toDateString();
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(c);
  }
  for (const list of days.values()) {
    lines.push('', fmtDay(list[0].start).toUpperCase());
    for (const c of list) {
      const what = c.type === 'double-booked'
        ? `${nameOf(c.people[0])} is booked in two places: ${c.events.map((e) => `"${e.title}"`).join(' and ')}`
        : c.type === 'tight-handoff'
          ? `${c.leg.kids.map(nameOf).join(' + ')} can't get from ${c.leg.from} to ${c.leg.to} in time`
          : `Nobody can take ${c.leg.kids.map(nameOf).join(' + ')} ${place(c.leg)} (${c.leg.kind})`;
      lines.push(`• ${fmtTime(c.start)}: ${what}`);
      const [first] = optionsFor(c, { nameOf, carpool });
      if (first) lines.push(`   Try: ${first}`);
    }
  }

  const load = new Map();
  for (const l of legs) {
    const d = assignment.get(l.id);
    if (d) load.set(d, (load.get(d) ?? 0) + 1);
  }
  if (load.size) {
    lines.push('', `Driving load: ${[...load].map(([id, n]) => `${nameOf(id)} ${n} trip${n === 1 ? '' : 's'}`).join(', ')}.`);
  }

  const gaps = calendarGaps(events, family);
  if (gaps.length) lines.push('', 'Check before trusting this:', ...gaps.map((g) => `• ${g}`));
  return lines.join('\n');
}
