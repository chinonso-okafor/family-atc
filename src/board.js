// Today's board: the day's departures as a split-flap board, read from the plan.
import { makeFlap, setFlap } from './flap.js';

const $ = (id) => document.getElementById(id);
const mins = (d) => d.getHours() * 60 + d.getMinutes();
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const COLS = [['time', 5], ['who', 5], ['where', 14], ['driver', 8], ['status', 12]];
const same = (a, b) => a.toDateString() === b.toDateString();

export function createBoard(ctx) {
  const B = { day: null, clock: null, built: '' };

  // today if it's in the plan's week and has trips, otherwise the first day that does
  function pickDay() {
    const trips = ctx.plan().trips;
    const today = new Date();
    if (trips.some((t) => same(t.start, today))) return today;
    return trips.length ? trips[0].start : today;
  }

  function row(t, now) {
    const plan = ctx.plan();
    const kind = plan.status[t.id];
    let status = 'ON TIME';
    let sev = 'ok';
    const leave = mins(t.start);
    if (now >= leave) { status = 'DEPARTED'; sev = 'dim'; }
    else if (kind === 'away') { status = 'DRIVER BUSY'; sev = 'bad'; }
    else if (kind === 'double') { status = 'DOUBLE-BOOK'; sev = 'bad'; }
    else if (kind === 'clash') { status = 'BOOKED TWICE'; sev = 'bad'; }
    else if (kind === 'late') { status = 'TOO TIGHT'; sev = 'warn'; }
    else if (kind === 'tight') { status = 'TIGHT TURN'; sev = 'warn'; }
    else if (kind === 'none') { status = 'NEEDS DRIVER'; sev = 'warn'; }
    else if (leave - now <= 15) { status = 'BOARDING'; }
    const who = t.kids.length > 1 ? 'BOTH' : (plan.people.get(t.kids[0])?.name ?? '');
    return { time: hhmm(leave), who, where: (t.kind === 'pickup' ? t.from : t.to) ?? 'HOME', driver: t.driver ? plan.drivers.get(t.driver).name : 'NONE', status, sev };
  }

  function refresh() {
    if (!B.day) {
      B.day = pickDay();
      const now = new Date();
      B.clock = same(B.day, now) ? mins(now) : 7 * 60 + 50;
    }
    const trips = ctx.plan().trips.filter((t) => same(t.start, B.day)).sort((a, b) => a.start - b.start);
    $('boardDay').textContent = B.day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    $('clock').textContent = hhmm(B.clock);
    const rows = $('rows');
    const key = trips.map((t) => t.id).join(',');
    if (key !== B.built) {
      B.built = key;
      rows.innerHTML = trips.length
        ? trips.map((t) => `<div class="brow" data-id="${t.id.replace(/"/g, '')}">${COLS.map(([k, w]) => `<span class="flap col-${k}" style="--w:${w}" data-k="${k}"></span>`).join('')}</div>`).join('')
        : '<p style="color:#9FB0BF;margin:12px 0">No departures this day.</p>';
      rows.querySelectorAll('.flap').forEach((el) => makeFlap(el, COLS.find((c) => c[0] === el.dataset.k)[1]));
    }
    trips.forEach((t) => {
      const r = rows.querySelector(`[data-id="${t.id.replace(/"/g, '')}"]`);
      if (!r) return;
      const x = row(t, B.clock);
      r.dataset.sev = x.sev;
      r.setAttribute('aria-label', `${x.time}, ${x.who}, ${t.title} at ${x.where}, driver ${x.driver.toLowerCase()}, ${x.status.toLowerCase()}`);
      COLS.forEach(([k]) => setFlap(r.querySelector(`.col-${k}`), x[k]));
    });
  }

  $('tick').onclick = () => {
    B.clock += 15;
    if (B.clock > 22 * 60) B.clock = 7 * 60 + 50;
    refresh();
  };

  return { refresh, reset: () => { B.day = null; B.built = ''; } };
}
