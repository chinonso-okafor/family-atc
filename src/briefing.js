// Calendar-gap warnings and the plain-text Sunday briefing.

const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'long' });

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
        warnings.push(`${noLoc.length} of ${p.name}'s events ${noLoc.length === 1 ? 'has' : 'have'} no location (${noLoc.slice(0, 3).map((e) => `"${e.title}"`).join(', ')}${noLoc.length > 3 ? ', …' : ''}), so no rides can be planned for them.`);
      }
    }
  }
  return warnings;
}

// Plain-text Sunday briefing for the family chat, built from the live plan
// (so it reflects any drivers changed by hand).
export function planBriefing({ plan, weekStart, copy, suggestions, gaps = [], fmt }) {
  const lines = [`Tower briefing: week of ${weekStart.toLocaleDateString([], { month: 'long', day: 'numeric' })}`, ''];
  lines.push(plan.alerts.length
    ? `${plan.alerts.length} thing${plan.alerts.length === 1 ? '' : 's'} to sort out before Monday.`
    : 'Nothing needs a decision. Every ride has a driver.');
  let day = '';
  for (const a of plan.alerts) {
    const label = fmtDay(a.start).toUpperCase();
    if (label !== day) { lines.push('', label); day = label; }
    const c = copy(a, plan);
    lines.push(`• ${fmt(a.start)} ${c.h}. ${c.p}`);
    const [first] = suggestions(plan, a);
    if (first) lines.push(`   Try: ${first.label}.`);
  }
  const load = new Map();
  for (const t of plan.trips) if (t.driver) load.set(t.driver, (load.get(t.driver) ?? 0) + 1);
  if (load.size) {
    lines.push('', `Driving: ${[...load].map(([k, n]) => `${plan.drivers.get(k).name} ${n} trip${n === 1 ? '' : 's'}`).join(', ')}.`);
  }
  if (gaps.length) lines.push('', 'Check before trusting this:', ...gaps.map((g) => `• ${g}`));
  return lines.join('\n');
}
