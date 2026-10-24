// Week view: one horizontal lane per person plus a "car" lane, time running
// left to right across the week, conflicts drawn as red bands over every lane.

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 22;
const HOUR_PX = 26;
const DAY_PX = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
const DAY_MS = 86_400_000;

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

// x offset (px) of a moment, clamped to the visible part of its day
function x(date, weekStart) {
  const day = Math.floor((startOfDay(date) - weekStart) / DAY_MS);
  const hours = Math.min(Math.max(date.getHours() + date.getMinutes() / 60, DAY_START_HOUR), DAY_END_HOUR);
  return day * DAY_PX + (hours - DAY_START_HOUR) * HOUR_PX;
}

function span(start, end, weekStart) {
  const left = x(start, weekStart);
  // events crossing midnight are clipped at the end of their first day
  const sameDay = startOfDay(start).getTime() === startOfDay(end).getTime();
  const right = sameDay ? x(end, weekStart) : x(new Date(startOfDay(start).getTime() + DAY_END_HOUR * 3_600_000), weekStart);
  return { left, width: Math.max(right - left, 4) };
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function renderWeek(root, { family, events, legs, assignment, conflicts, weekStart, selectedId, onSelect }) {
  const nameOf = (id) => family.find((p) => p.id === id)?.name ?? id;
  const colorOf = (id) => family.find((p) => p.id === id)?.color ?? '#888';
  const inConflict = new Set(conflicts.flatMap((c) => c.leg ? c.leg.events.map((e) => e.id) : c.events.map((e) => e.id)));
  const days = [...Array(7)].map((_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));

  root.innerHTML = '';
  root.style.setProperty('--day-px', `${DAY_PX}px`);
  root.style.setProperty('--hour-px', `${HOUR_PX}px`);

  const labels = el('div', 'labels');
  const track = el('div', 'track');
  track.style.width = `${7 * DAY_PX}px`;
  root.append(labels, el('div', 'scroller', [track]));

  // header: days + hour ticks
  labels.append(el('div', 'label header-label', [document.createTextNode('')]));
  const header = el('div', 'lane header');
  days.forEach((d, i) => {
    const h = el('div', 'day-head', [text(fmtDay(d))]);
    h.style.left = `${i * DAY_PX}px`;
    header.append(h);
    for (let hr = DAY_START_HOUR; hr < DAY_END_HOUR - 1; hr += 3) {
      const t = el('div', 'tick', [text(fmtTime(new Date(2000, 0, 1, hr)).replace(':00', ''))]);
      t.style.left = `${i * DAY_PX + (hr - DAY_START_HOUR) * HOUR_PX}px`;
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
      if (e.end < weekStart) continue;
      const b = block(span(e.start, e.end, weekStart), e.title, e.location, person.color);
      b.title = `${e.title}\n${fmtTime(e.start)}–${fmtTime(e.end)}${e.location ? `\n${e.location}` : ''}`;
      if (e.free) b.classList.add('free');
      if (inConflict.has(e.id)) b.classList.add('conflict');
      lane.append(b);
    }
    for (const e of events.filter((e) => e.person === person.id && e.allDay)) {
      const day = Math.floor((startOfDay(e.start) - weekStart) / DAY_MS);
      if (day < 0 || day > 6) continue;
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
    const b = block(span(l.start, l.end, weekStart), driver ? nameOf(driver) : 'No driver', `${kids} ${where}`,
      driver ? colorOf(driver) : null);
    b.classList.add('leg', l.kind);
    if (!driver) b.classList.add('conflict');
    b.title = `${l.kind}: ${kids} ${where}\n${fmtTime(l.start)}–${fmtTime(l.end)}\nDriver: ${driver ? nameOf(driver) : 'nobody free'}`;
    car.append(b);
  }
  lanes.append(car);

  // conflict bands on top of everything
  for (const c of conflicts) {
    const { left, width } = span(c.start, c.end, weekStart);
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
