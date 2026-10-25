// Tower briefing: plan the week's driving, replay a day, and today's board.
import { parseIcs } from './ics.js';
import { makeTravelTime, normalizePlace, geocode } from './travel.js';
import { buildPlan, suggestions, wouldConflict, sevOf, kidNames } from './plan.js';
import { calendarGaps, planBriefing } from './briefing.js';
import { renderLanes, startOfDay } from './lanes.js';
import { makeFlap, setFlap, clack, sound, reducedMotion } from './flap.js';
import { createReplay } from './replay.js';
import { createBoard } from './board.js';

const FAMILY_KEY = 'family-atc:v1';
const SETTINGS_KEY = 'family-atc:settings:v1';
const OVERRIDES_KEY = 'family-atc:overrides:v1';
const THEME_KEY = 'family-atc:theme';
const COLORS = ['#0B7AA8', '#6D4AD8', '#C2410C', '#2B8A3E', '#B83280', '#0F766E'];
const ADULT_NAMES = /^(mom|mum|mommy|mother|dad|daddy|father|parent|grandma|grandpa|granny|nanny)\b/i;
const SAMPLE = [
  { id: 'mom', name: 'Mom', role: 'adult', file: 'samples/mom.ics' },
  { id: 'dad', name: 'Dad', role: 'adult', file: 'samples/dad.ics' },
  { id: 'ada', name: 'Ada', role: 'kid', file: 'samples/ada.ics' },
  { id: 'ben', name: 'Ben', role: 'kid', file: 'samples/ben.ics' },
];
const TAGS = { away: 'Driver busy', double: 'Double-booked', tight: 'Tight turn', none: 'Needs a driver', late: 'Too tight to make', clash: 'Booked twice' };
const ORDER = { away: 0, double: 1, clash: 2, late: 3, tight: 4, none: 5 };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayLong = (d) => d.toLocaleDateString([], { weekday: 'long' });
const dateLong = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'long' });

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: works for this visit */ }
}

function mondayOf(d) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}
// On a weekend you're planning next week; otherwise this one.
function planningWeek(today = new Date()) {
  const day = today.getDay();
  return day === 0 || day === 6 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

const S = {
  family: read(FAMILY_KEY, []),
  settings: { home: '', places: {}, carpool: [], ...read(SETTINGS_KEY, {}) },
  overrides: read(OVERRIDES_KEY, {}),
  bufferMin: 20,
  weekStart: planningWeek(),
  view: 'plan',
  events: [],
  plan: null,
  alertsView: [], // alerts on screen, including ones animating out
  changed: new Set(),
  lastNote: '',
  total: 0,
  stamped: false,
  flash: null,
};

/* ---------- Data ---------- */
function rebuild() {
  const weekEnd = addDays(S.weekStart, 7);
  const errors = [];
  S.events = S.family.flatMap((p) => {
    try {
      return parseIcs(p.ics, { person: p.id, rangeStart: S.weekStart, rangeEnd: weekEnd });
    } catch (err) {
      errors.push(`${p.name}: couldn't read calendar (${err.message})`);
      return [];
    }
  });
  $('errors').textContent = errors.join(' · ');
  const travelMin = makeTravelTime({ places: S.settings.places, home: S.settings.home, fallbackMin: S.bufferMin });
  S.plan = buildPlan({ events: S.events, family: S.family, carpool: S.settings.carpool, travelMin, overrides: S.overrides });
  update();
}

const dayIndex = (d) => Math.round((startOfDay(d) - S.weekStart) / 86_400_000);
const tripById = (id) => S.plan.trips.find((t) => t.id === id);
const driverName = (key) => S.plan.drivers.get(key)?.name ?? 'Nobody';
const personName = (id) => S.plan.people.get(id)?.name ?? id;
const placeLine = (t) => (t.kind === 'pickup' ? `pick-up at ${t.from}` : t.kind === 'handoff' ? `${t.from} → ${t.to}` : `to ${t.to}`);

/* ---------- Alert wording ---------- */
export function alertCopy(a, plan = S.plan) {
  const ts = a.trips.map((id) => plan.trips.find((t) => t.id === id)).filter(Boolean);
  const later = ts[0];
  const earlier = ts[1] || ts[0];
  const d = a.driver && plan.drivers.get(a.driver);
  const kids = later ? kidNames(plan, later) : '';
  if (a.kind === 'double') {
    return { h: `${d.name} can’t be in two places`, p: `${later.title} (${kids}) leaves at ${fmt(later.start)}, but ${earlier.title.toLowerCase()} keeps ${d.name} busy until ${fmt(earlier.end)}.` };
  }
  if (a.kind === 'away') {
    return { h: `${d.name} isn’t free for this one`, p: `${d.name} is at ${a.event.title} until ${fmt(a.event.end)}, but is down for ${later.title.toLowerCase()} at ${fmt(later.start)}.` };
  }
  if (a.kind === 'tight') {
    return { h: `Tight turn for ${d.name}`, p: `Only ${a.gap} minutes between ${earlier.title.toLowerCase()} and ${later.title.toLowerCase()}. Any delay and one of them is late.` };
  }
  if (a.kind === 'late') {
    const [prev, next] = later.leg.events;
    return { h: `${kids} can’t get to ${later.to} in time`, p: `${prev.title} ends at ${fmt(prev.end)} and ${next.title} starts at ${fmt(next.start)}, about ${a.travelMin} minutes away.` };
  }
  if (a.kind === 'clash') {
    const [e1, e2] = a.events;
    return { h: `${plan.people.get(a.person)?.name ?? a.person} is booked in two places`, p: `${e1.title} (${fmt(e1.start)}–${fmt(e1.end)}) overlaps ${e2.title} (${fmt(e2.start)}–${fmt(e2.end)}).` };
  }
  // open slot: say why nobody can take it
  const why = [];
  for (const [key, events] of plan.busy) {
    const e = events.find((x) => x.start < later.end && later.start < x.end);
    const other = plan.trips.find((t) => t !== later && t.driver === key && t.start < later.end && later.start < t.end);
    if (e) why.push(`${plan.drivers.get(key).name} is at ${e.title} until ${fmt(e.end)}`);
    else if (other) why.push(`${plan.drivers.get(key).name} is driving ${kidNames(plan, other)}`);
  }
  const needs = later.kids.length > 1 ? 'need' : 'needs';
  return { h: `Nobody is driving ${later.title.toLowerCase()}`, p: `${kids} ${needs} a ride ${placeLine(later)} at ${fmt(later.start)}.${why.length ? ` ${why.join(', and ')}.` : ''}` };
}

function noFixText(a) {
  if (a.kind === 'late') return 'No driver fixes this. Leave early or arrive late, and tell the organiser.';
  if (a.kind === 'clash') return 'Pick one, or ask whether one of them is optional.';
  return S.settings.carpool.length ? 'No quick fix. Try the driver menu on the strip.' : 'No quick fix. Add a carpool contact under Calendars to get more options.';
}

/* ---------- Plan the week ---------- */
function stripHTML(t) {
  const kind = S.plan.status[t.id];
  const sev = sevOf(kind);
  const d = t.driver ? S.plan.drivers.get(t.driver) : null;
  const many = t.kids.length > 1;
  const color = many ? 'var(--both)' : (S.plan.people.get(t.kids[0])?.color ?? 'var(--both)');
  const tab = many ? t.kids.map((k) => personName(k)[0]).join('').slice(0, 3) : personName(t.kids[0])[0];
  const tag = kind ? `<span class="tag ${sev}">${sev === 'bad' ? '▲' : '◆'} ${TAGS[kind]}</span>` : '';
  const label = `Driver for ${t.title}: ${d ? d.name : 'nobody yet'}. Change driver.`;
  return `<article class="strip${S.changed.has(t.id) ? ' pulse' : ''}" data-id="${esc(t.id)}" data-sev="${sev}" style="--kid:${color}">
    <span class="tab" aria-hidden="true">${esc(tab)}</span>
    <b class="time">${fmt(t.start)}</b>
    <div class="main"><div class="title">${esc(t.title)}</div><div class="meta">${esc(kidNames(S.plan, t))}, ${esc(placeLine(t))}</div></div>
    <span class="tagslot">${tag}</span>
    <button class="pill${d ? '' : ' empty'}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}">${d ? `<i>${esc(d.initial)}</i>${esc(d.name)}` : 'Assign'}</button>
    <span class="grip" aria-hidden="true" title="Drag onto a driver"><i></i><i></i><i></i><i></i><i></i><i></i></span>
  </article>`;
}

function renderBays() {
  const bays = $('bays');
  $('planHint').hidden = !S.plan.trips.length;
  if (!S.family.length) {
    bays.innerHTML = `<div class="welcome"><h2>Add the family’s calendars</h2>
      <p class="hint">Each person’s .ics export goes in, and every drop-off, pick-up and handoff the kids need comes out as a flight strip with a driver. Try the sample family first if you like.</p>
      <div class="row"><button class="btn" data-act="sample">Load sample family</button><button class="btn" data-act="setup">Add calendars</button></div></div>`;
    return;
  }
  if (!S.plan.trips.length) {
    bays.innerHTML = `<div class="welcome"><h2>No car trips this week</h2><p class="hint">None of the kids’ events this week have a location, so there’s nothing to drive. Check the calendars are up to date.</p></div>`;
    return;
  }
  bays.innerHTML = [...Array(7)].map((_, i) => {
    const day = addDays(S.weekStart, i);
    const ts = S.plan.trips.filter((t) => dayIndex(t.start) === i).sort((a, b) => a.start - b.start);
    if (!ts.length) return '';
    const n = ts.filter((t) => S.plan.status[t.id]).length;
    const count = n ? `${n} ${n > 1 ? 'strips need' : 'strip needs'} attention` : 'All clear';
    return `<section class="bay" aria-label="${dayLong(day)}"><div class="bay-head"><h2>${dayLong(day)}</h2><span class="date">${dateLong(day)}</span><span class="count${n ? ' on' : ''}">${count}</span></div><div class="strips">${ts.map(stripHTML).join('')}</div></section>`;
  }).join('');
}

/* ---------- Needs a decision ---------- */
function syncAlerts(list) {
  const ids = new Set(list.map((a) => a.id));
  for (const e of S.alertsView) {
    if (!ids.has(e.id) && !e.leaving) {
      e.leaving = true;
      e.note = S.lastNote || 'Cleared';
      setTimeout(() => { S.alertsView = S.alertsView.filter((x) => x !== e); renderAlerts(); }, reducedMotion ? 600 : 1450);
    }
  }
  for (const a of list) {
    const ex = S.alertsView.find((e) => e.id === a.id && !e.leaving);
    if (ex) ex.data = a;
    else S.alertsView.push({ id: a.id, data: a, leaving: false, fresh: true });
  }
}

function alertHTML(e) {
  const a = e.data;
  const sev = sevOf(a.kind);
  const day = dayLong(a.start);
  if (e.leaving) {
    return `<div class="alert-wrap leaving"><div class="inner"><article class="alert done"><div class="alert-top"><span class="chip ok">✓ Cleared</span><span class="day">${day}</span></div><div class="done-msg">${esc(e.note)}</div></article></div></div>`;
  }
  const copy = alertCopy(a);
  const opts = suggestions(S.plan, a);
  const chip = sev === 'bad' ? '▲ Conflict' : a.kind === 'tight' ? '◆ Tight turn' : a.kind === 'late' ? '◆ Too tight' : '◆ Open slot';
  const flash = S.flash === a.id ? ' flash' : '';
  return `<div class="alert-wrap${e.fresh ? ' fresh' : ''}"><div class="inner"><article class="alert ${sev}${flash}" data-alert-id="${esc(a.id)}" aria-label="${esc(copy.h)}">
    <div class="alert-top"><span class="chip ${sev}">${chip}</span><span class="day">${day} ${fmt(a.start)}</span></div>
    <h3>${esc(copy.h)}</h3><p>${esc(copy.p)}</p>
    <div class="opts">${opts.length ? opts.map((o, i) => `<button class="opt" data-alert="${esc(a.id)}" data-i="${i}">${esc(o.label)}</button>`).join('') : `<p>${esc(noFixText(a))}</p>`}</div>
  </article></div></div>`;
}

function renderAlerts() {
  const list = $('alertList');
  if (!S.alertsView.length) {
    list.innerHTML = S.family.length
      ? '<div class="empty-state"><b>All clear.</b> Nothing needs a decision this week.</div>'
      : '<div class="empty-state">Alerts show up here once calendars are added.</div>';
    return;
  }
  const items = [...S.alertsView].sort((a, b) => a.data.start - b.data.start || ORDER[a.data.kind] - ORDER[b.data.kind]);
  list.innerHTML = items.map(alertHTML).join('');
  items.forEach((e) => { e.fresh = false; });
  S.flash = null;
}

function renderGaps() {
  const gaps = calendarGaps(S.events, S.family);
  $('gaps').innerHTML = gaps.length
    ? `<div class="gap-card"><h3>Check before trusting this</h3><ul>${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`
    : '';
}

/* ---------- Header, hero board, stamp ---------- */
function renderHeader() {
  const today = new Date();
  const thisWeek = mondayOf(today).getTime() === S.weekStart.getTime();
  $('dateLine').textContent = `${dayLong(today)} ${dateLong(today)}. ${thisWeek ? 'This week, from' : 'Planning the week of'} ${dateLong(S.weekStart)}.`;
  const open = S.plan.alerts.length;
  const hf = $('heroFlap');
  hf.dataset.tone = open ? 'warn' : 'ok';
  setFlap(hf, open ? `${open} TO CLEAR` : 'ALL CLEAR');
  $('heroSr').textContent = open ? `${open} to clear` : 'All clear';
  $('lede').textContent = !S.family.length
    ? 'Add the family’s calendars to start.'
    : open ? `${open} ${open > 1 ? 'things need' : 'thing needs'} a decision${thisWeek ? '' : ' before Monday'}.` : 'Nothing needs a decision. The week is clear.';
}

function maybeStamp(open) {
  S.total = Math.max(S.total, open);
  if (open > 0) { S.stamped = false; return; }
  if (S.total > 0 && !S.stamped) {
    S.stamped = true;
    const st = $('stamp');
    st.hidden = false;
    st.classList.remove('bye', 'hit');
    void st.offsetWidth;
    st.classList.add('hit');
    clack(0.35);
    clearTimeout(S.stampT);
    S.stampT = setTimeout(hideStamp, 3400);
  }
}
function hideStamp() {
  const st = $('stamp');
  if (st.hidden) return;
  st.classList.add('bye');
  setTimeout(() => { st.hidden = true; st.classList.remove('bye', 'hit'); }, reducedMotion ? 0 : 480);
}
const announce = (msg) => { $('live').textContent = msg; };

function update() {
  syncAlerts(S.plan.alerts);
  renderHeader();
  renderBays();
  renderAlerts();
  renderGaps();
  renderPeople();
  if (S.view === 'today') board.refresh();
  if (S.view === 'replay') replay.render(true);
  if (S.view === 'lanes') renderLanesView();
  maybeStamp(S.plan.alerts.length);
  S.changed = new Set();
}

/* ---------- Changing drivers ---------- */
function setDriver(tripId, driver, note) {
  S.overrides = { ...S.overrides, [tripId]: driver };
  write(OVERRIDES_KEY, S.overrides);
  S.changed = new Set([tripId]);
  S.lastNote = note;
  clack(0.2);
  rebuild();
  const left = S.plan.alerts.length;
  announce(`${note}. ${left ? `${left} left to clear.` : 'All clear.'}`);
}

function applyFix(alertId, index) {
  const a = S.plan.alerts.find((x) => x.id === alertId);
  const fix = a && suggestions(S.plan, a)[index];
  if (fix) setDriver(fix.tripId, fix.driver, fix.label);
}

function assign(t, key) {
  setDriver(t.id, key, key ? `${driverName(key)} now has ${t.title.toLowerCase()}` : `${t.title} unassigned`);
}

$('alertList').addEventListener('click', (ev) => {
  const b = ev.target.closest('.opt');
  if (b) applyFix(b.dataset.alert, Number(b.dataset.i));
});

function closeMenu() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  document.querySelectorAll(".pill[aria-expanded='true']").forEach((p) => p.setAttribute('aria-expanded', 'false'));
}
function openMenu(btn) {
  const strip = btn.closest('.strip');
  const t = tripById(strip.dataset.id);
  const was = btn.getAttribute('aria-expanded') === 'true';
  closeMenu();
  if (was || !t) return;
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = [...S.plan.drivers.keys(), 'none'].map((k) => {
    const name = k === 'none' ? 'Nobody yet' : driverName(k);
    const now = k === t.driver || (k === 'none' && !t.driver);
    const bad = k !== 'none' && !now && wouldConflict(S.plan, t, k);
    return `<button role="menuitem" data-k="${esc(k)}"><span>${esc(name)}${now ? ' (now)' : ''}</span>${bad ? '<small>conflict</small>' : ''}</button>`;
  }).join('');
  strip.appendChild(m);
  btn.setAttribute('aria-expanded', 'true');
  m.querySelector('button').focus();
  m.addEventListener('click', (e) => {
    const item = e.target.closest('button');
    if (!item) return;
    closeMenu();
    assign(t, item.dataset.k === 'none' ? null : item.dataset.k);
  });
}
$('bays').addEventListener('click', (ev) => {
  const p = ev.target.closest('.pill');
  if (p) { ev.stopPropagation(); openMenu(p); return; }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'sample') loadSample();
  if (act === 'setup') toggleDrawer(true);
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('.menu') && !ev.target.closest('.pill')) closeMenu(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });

// drag a strip by its dots onto a driver in the dock
$('bays').addEventListener('pointerdown', (ev) => {
  const grip = ev.target.closest('.grip');
  if (!grip || (ev.button !== undefined && ev.button !== 0)) return;
  ev.preventDefault();
  beginDrag(ev, grip.closest('.strip'), grip);
});
function beginDrag(e, strip, grip) {
  closeMenu();
  const t = tripById(strip.dataset.id);
  const rect = strip.getBoundingClientRect();
  const dock = $('dock');
  $('dockItems').innerHTML = [...S.plan.drivers.values()].map((d) => `<div class="dock-item" data-driver="${esc(d.key)}"><i>${esc(d.initial)}</i><span>${esc(d.name)}</span></div>`).join('')
    + '<div class="dock-item" data-driver="none"><i>–</i><span>Nobody</span></div>';
  const ghost = strip.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
  document.body.appendChild(ghost);
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  let over = null;
  strip.classList.add('lifted');
  dock.hidden = false;
  requestAnimationFrame(() => dock.classList.add('show'));
  try { grip.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  const move = (ev) => {
    ghost.style.transform = `translate(${ev.clientX - dx - rect.left}px,${ev.clientY - dy - rect.top}px) rotate(-1.5deg) scale(1.03)`;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const item = el?.closest ? el.closest('.dock-item') : null;
    if (item !== over) {
      over?.classList.remove('over');
      over = item;
      if (over) { over.classList.add('over'); clack(0.08); }
    }
  };
  const end = (ev) => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    ghost.remove();
    dock.classList.remove('show');
    setTimeout(() => { dock.hidden = true; }, 220);
    strip.classList.remove('lifted');
    if (over) {
      over.classList.remove('over');
      if (ev.type === 'pointerup') assign(t, over.dataset.driver === 'none' ? null : over.dataset.driver);
    }
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/* ---------- Other views ---------- */
const ctx = {
  plan: () => S.plan,
  weekStart: () => S.weekStart,
  events: () => S.events,
  settings: () => S.settings,
  view: () => S.view,
  alertCopy,
  applyFix,
  fmt,
};
const replay = createReplay(ctx);
const board = createBoard(ctx);

function renderLanesView() {
  const legs = S.plan.trips.map((t) => t.leg);
  const assignment = new Map(S.plan.trips.map((t) => [t.id, t.driver]));
  const names = new Map([...S.plan.drivers.values()].map((d) => [d.key, d.name]));
  const conflicts = S.plan.alerts.map((a) => {
    const ts = a.trips.map(tripById).filter(Boolean);
    const start = ts.length ? new Date(Math.min(...ts.map((t) => t.start))) : a.start;
    const end = ts.length ? new Date(Math.max(...ts.map((t) => t.end))) : new Date(+a.start + 1_800_000);
    return { id: a.id, start, end, leg: ts[0]?.leg, events: a.events ?? [] };
  });
  renderLanes($('week'), {
    family: S.family, events: S.events, legs, assignment, conflicts, names,
    from: S.weekStart, dayCount: 7, selectedId: null,
    onSelect: (id) => { S.flash = id; setView('plan'); renderAlerts(); document.querySelector(`[data-alert-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  });
}

function setView(v) {
  S.view = v;
  for (const [name, el] of [['plan', 'planView'], ['replay', 'replayView'], ['today', 'todayView'], ['lanes', 'lanesView']]) {
    $(el).hidden = v !== name;
    $(`tab${name[0].toUpperCase()}${name.slice(1)}`).setAttribute('aria-pressed', String(v === name));
  }
  if (v === 'today') board.refresh();
  if (v === 'replay') replay.show();
  if (v === 'lanes') renderLanesView();
}
$('tabPlan').onclick = () => setView('plan');
$('tabReplay').onclick = () => setView('replay');
$('tabToday').onclick = () => setView('today');
$('tabLanes').onclick = () => setView('lanes');

/* ---------- Week, utilities ---------- */
function shiftWeek(n) {
  S.weekStart = addDays(S.weekStart, 7 * n);
  S.alertsView = [];
  S.total = 0;
  S.stamped = false;
  replay.reset();
  board.reset();
  rebuild();
}
$('prevWeek').onclick = () => shiftWeek(-1);
$('nextWeek').onclick = () => shiftWeek(1);

$('soundBtn').onclick = () => {
  sound.on = !sound.on;
  $('soundBtn').setAttribute('aria-pressed', String(sound.on));
  $('soundBtn').textContent = sound.on ? 'Sound on' : 'Sound off';
  if (sound.on) clack(0.25);
};
$('resetBtn').onclick = () => {
  const ids = new Set(S.plan.trips.map((t) => t.id));
  S.overrides = Object.fromEntries(Object.entries(S.overrides).filter(([id]) => !ids.has(id)));
  write(OVERRIDES_KEY, S.overrides);
  S.alertsView = [];
  S.total = 0;
  S.stamped = false;
  S.lastNote = '';
  $('stamp').hidden = true;
  closeMenu();
  rebuild();
  announce(`Plan reset. ${S.plan.alerts.length} to clear.`);
};
$('stamp').onclick = hideStamp;
$('copyBtn').onclick = async () => {
  const text = planBriefing({ plan: S.plan, weekStart: S.weekStart, copy: alertCopy, suggestions, gaps: calendarGaps(S.events, S.family), fmt });
  try {
    await navigator.clipboard.writeText(text);
    $('copyBtn').textContent = 'Copied';
  } catch {
    $('copyBtn').textContent = 'Copy blocked';
  }
  setTimeout(() => { $('copyBtn').textContent = 'Copy briefing'; }, 2000);
};

/* ---------- Calendars and settings ---------- */
function toggleDrawer(open = $('drawer').hidden) {
  $('drawer').hidden = !open;
  $('setupBtn').setAttribute('aria-expanded', String(open));
  $('setupBtn').setAttribute('aria-pressed', String(open));
  if (open) $('drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('setupBtn').onclick = () => toggleDrawer();

const saveFamily = () => write(FAMILY_KEY, S.family);
const saveSettings = () => write(SETTINGS_KEY, S.settings);

function renderPeople() {
  const ul = $('people');
  ul.innerHTML = '';
  for (const p of S.family) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = p.color;
    const name = document.createElement('input');
    name.value = p.name;
    name.setAttribute('aria-label', 'Name');
    name.addEventListener('change', () => { p.name = name.value.trim() || p.name; saveFamily(); rebuild(); });
    const role = document.createElement('select');
    role.setAttribute('aria-label', `${p.name}'s role`);
    role.innerHTML = '<option value="adult">adult (can drive)</option><option value="kid">kid</option>';
    role.value = p.role;
    role.addEventListener('change', () => { p.role = role.value; saveFamily(); rebuild(); });
    const rm = document.createElement('button');
    rm.className = 'btn';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => { S.family = S.family.filter((x) => x !== p); saveFamily(); rebuild(); });
    li.append(sw, name, role, rm);
    ul.append(li);
  }
  $('home').value = S.settings.home;
  $('carpool').value = S.settings.carpool.map((c) => (c.note ? `${c.name}, ${c.note}` : c.name)).join('\n');
}

// Re-uploading someone's calendar replaces it instead of adding them twice.
async function addFiles(files) {
  for (const f of files) {
    const ics = await f.text();
    const name = ics.match(/^X-WR-CALNAME:(.+)$/m)?.[1].trim() || f.name.replace(/\.ics$/i, '');
    const existing = S.family.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.ics = ics; continue; }
    S.family.push({
      id: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36)}`,
      name,
      role: ADULT_NAMES.test(name) ? 'adult' : 'kid',
      color: COLORS[S.family.length % COLORS.length],
      ics,
    });
  }
  $('addFiles').value = '';
  saveFamily();
  rebuild();
}

async function loadSample() {
  const extra = await (await fetch('samples/places.json')).json();
  S.settings = { home: extra.home, places: extra.places, carpool: extra.carpool };
  saveSettings();
  S.family = await Promise.all(SAMPLE.map(async (p, i) => ({
    id: p.id, name: p.name, role: p.role, color: COLORS[i],
    ics: await (await fetch(p.file)).text(),
  })));
  saveFamily();
  S.weekStart = new Date(2026, 9, 26); // the sample's seeded week
  S.alertsView = [];
  S.total = 0;
  replay.reset();
  board.reset();
  rebuild();
}

$('addFiles').addEventListener('change', (e) => addFiles(e.target.files));
$('loadSample').onclick = loadSample;
$('clearAll').onclick = () => {
  if (!confirm('Remove everyone’s calendar from this browser?')) return;
  S.family = [];
  S.overrides = {};
  saveFamily();
  write(OVERRIDES_KEY, S.overrides);
  S.alertsView = [];
  rebuild();
};
$('home').addEventListener('change', (e) => { S.settings.home = e.target.value.trim(); saveSettings(); rebuild(); });
$('buffer').addEventListener('change', (e) => { S.bufferMin = Number(e.target.value) || 20; rebuild(); });
$('carpool').addEventListener('change', (e) => {
  S.settings.carpool = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, ...note] = l.split(',');
    return { name: name.trim(), note: note.join(',').trim() };
  });
  saveSettings();
  rebuild();
});

// Look up every address we don't have coordinates for, one per second
// (Nominatim's usage policy), then rebuild with real travel times.
$('locate').onclick = async () => {
  const names = new Map();
  if (S.settings.home) names.set(normalizePlace(S.settings.home), S.settings.home);
  for (const e of S.events) if (e.location) names.set(normalizePlace(e.location), e.location);
  const todo = [...names].filter(([key]) => !S.settings.places[key]);
  const status = $('locateStatus');
  const failed = [];
  for (const [i, [key, label]] of todo.entries()) {
    status.textContent = `Looking up ${i + 1} of ${todo.length}: ${label}`;
    try {
      const hit = await geocode(label);
      if (hit) S.settings.places[key] = hit; else failed.push(label);
    } catch {
      failed.push(label);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  saveSettings();
  status.textContent = failed.length
    ? `Couldn't find: ${failed.join('; ')}. Those use the ${S.bufferMin} minute estimate.`
    : todo.length ? 'All places found.' : 'Nothing new to look up.';
  rebuild();
};

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  $('theme').value = theme;
}
applyTheme(read(THEME_KEY, 'auto'));
$('theme').addEventListener('change', (e) => { applyTheme(e.target.value); write(THEME_KEY, e.target.value); });

/* ---------- Go ---------- */
makeFlap($('heroFlap'), 12);
if (!S.family.length) toggleDrawer(true);
rebuild();
