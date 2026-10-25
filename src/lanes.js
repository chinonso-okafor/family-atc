// Lanes view: one horizontal lane per person plus a "car" lane, time running
// left to right across a week (or one zoomed-in day), conflicts drawn as red
// bands over every lane.

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 22;
const WEEK_HOUR_PX = 26;
const DAY_VIEW_HOUR_PX = 80;
const DAY_MS = 86_400_000;

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

const dayIndex = (date, from) => Math.round((startOfDay(date) - from) / DAY_MS);

// x offset (px) of a moment, clamped to the visible part of its day
function x(date, g) {
  const hours = Math.min(Math.max(date.getHours() + date.getMinutes() / 60, DAY_START_HOUR), DAY_END_HOUR);
  return dayIndex(date, g.from) * g.dayPx + (hours - DAY_START_HOUR) * g.hourPx;
}

function span(start, end, g) {
  const left = x(start, g);
  // events crossing midnight are clipped at the end of their first day
  const sameDay = startOfDay(start).getTime() === startOfDay(end).getTime();
  const right = sameDay ? x(end, g) : x(new Date(startOfDay(start).getTime() + DAY_END_HOUR * 3_600_000), g);
  return { left, width: Math.max(right - left, 4) };
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function renderLanes(root, { family, events, legs, assignment, conflicts, names, from, dayCount = 7, selectedId, onSelect, onDay }) {
  const hourPx = dayCount === 1 ? DAY_VIEW_HOUR_PX : WEEK_HOUR_PX;
  const g = { from, hourPx, dayPx: (DAY_END_HOUR - DAY_START_HOUR) * hourPx };
  const DAY_PX = g.dayPx;
  const visible = (d) => dayIndex(d, from) >= 0 && dayIndex(d, from) < dayCount;
  events = events.filter((e) => visible(e.start));
  legs = legs.filter((l) => visible(l.start));
  conflicts = conflicts.filter((c) => visible(c.start));
  const nameOf = (id) => names?.get(id) ?? family.find((p) => p.id === id)?.name ?? id;
  const colorOf = (id) => family.find((p) => p.id === id)?.color ?? '#888';
  const inConflict = new Set(conflicts.flatMap((c) => c.leg ? c.leg.events.map((e) => e.id) : c.events.map((e) => e.id)));
  const days = [...Array(dayCount)].map((_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));

  root.innerHTML = '';
  root.style.setProperty('--day-px', `${DAY_PX}px`);
  root.style.setProperty('--hour-px', `${hourPx}px`);

  const labels = el('div', 'labels');
  const track = el('div', 'track');
  track.style.width = `${dayCount * DAY_PX}px`;
  root.append(labels, el('div', 'scroller', [track]));

  // header: days + hour ticks
  labels.append(el('div', 'label header-label', [document.createTextNode('')]));
  const header = el('div', 'lane header');
  days.forEach((d, i) => {
    const h = el(onDay ? 'button' : 'div', 'day-head', [text(fmtDay(d))]);
    h.style.left = `${i * DAY_PX}px`;
    if (onDay) {
      h.title = 'Open this day';
      h.addEventListener('click', () => onDay(d));
    }
    header.append(h);
    for (let hr = DAY_START_HOUR; hr < DAY_END_HOUR - 1; hr += dayCount === 1 ? 1 : 3) {
      const t = el('div', 'tick', [text(fmtTime(new Date(2000, 0, 1, hr)).replace(':00', ''))]);
      t.style.left = `${i * DAY_PX + (hr - DAY_START_HOUR) * hourPx}px`;
      header.append(t);
    }
  });
  track.append(header);

  const lanes = el('div', 'lanes');
  track.append(lanes);

  for (const person of family) {
    labels.append(el('div', `label ${person.role}`, [
      swatch(person.color), text(person.name), el('small', '', [text(person.role)]),
    ]));
    const lane = el('div', 'lane');
    for (const e of events.filter((e) => e.person === person.id && !e.allDay)) {
      const b = block(span(e.start, e.end, g), e.title, e.location, person.color);
      b.title = `${e.title}\n${fmtTime(e.start)}–${fmtTime(e.end)}${e.location ? `\n${e.location}` : ''}`;
      if (e.free) b.classList.add('free');
      if (inConflict.has(e.id)) b.classList.add('conflict');
      lane.append(b);
    }
    for (const e of events.filter((e) => e.person === person.id && e.allDay)) {
      const day = dayIndex(e.start, from);
      const b = el('div', 'allday', [text(e.title)]);
      b.style.left = `${day * DAY_PX}px`;
      lane.append(b);
    }
    lanes.append(lane);
  }

  // car lane: every trip the kids' calendars imply, and who's driving it
  labels.append(el('div', 'label car', [text('🚗 Car')]));
  const car = el('div', 'lane car');
  for (const l of legs) {
    const driver = assignment.get(l.id);
    const where = l.kind === 'pickup' ? `from ${l.from}` : `to ${l.to}`;
    const kids = l.kids.map(nameOf).join(' + ');
    const b = block(span(l.start, l.end, g), driver ? nameOf(driver) : 'No driver', `${kids} ${where}`,
      driver ? colorOf(driver) : null);
    b.classList.add('leg', l.kind);
    if (!driver) b.classList.add('conflict');
    b.title = `${l.kind}: ${kids} ${where}\n${fmtTime(l.start)}–${fmtTime(l.end)}\nDriver: ${driver ? nameOf(driver) : 'nobody free'}`;
    car.append(b);
  }
  lanes.append(car);

  // conflict bands on top of everything
  for (const c of conflicts) {
    const { left, width } = span(c.start, c.end, g);
    const band = el('button', `band${c.id === selectedId ? ' selected' : ''}`);
    band.style.left = `${left}px`;
    band.style.width = `${Math.max(width, 10)}px`;
    band.setAttribute('aria-label', `Conflict at ${fmtDay(c.start)} ${fmtTime(c.start)}`);
    band.addEventListener('click', () => onSelect(c.id));
    lanes.append(band);
  }
}

function block({ left, width }, title, sub, color) {
  const b = el('div', 'block', [el('strong', '', [text(title)]), el('span', '', [text(sub || '')])]);
  b.style.left = `${left}px`;
  b.style.width = `${width}px`;
  if (color) b.style.setProperty('--c', color);
  return b;
}

const swatch = (color) => {
  const s = el('span', 'swatch');
  s.style.background = color;
  return s;
};
const text = (t) => document.createTextNode(t);
function el(tag, cls, children = []) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...children);
  return n;
}

export { fmtTime, fmtDay };
