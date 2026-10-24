import { parseIcs } from './ics.js';
import { detectConflicts } from './conflicts.js';
import { renderLanes, startOfDay, fmtTime, fmtDay } from './lanes.js';
import { makeTravelTime, normalizePlace, geocode } from './travel.js';
import { optionsFor, calendarGaps, sundayBriefing } from './briefing.js';

const STORAGE_KEY = 'family-atc:v1';
const SETTINGS_KEY = 'family-atc:settings:v1';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6'];
const SAMPLE = [
  { id: 'mom', name: 'Mom', role: 'adult', file: 'samples/mom.ics' },
  { id: 'dad', name: 'Dad', role: 'adult', file: 'samples/dad.ics' },
  { id: 'ada', name: 'Ada', role: 'kid', file: 'samples/ada.ics' },
  { id: 'ben', name: 'Ben', role: 'kid', file: 'samples/ben.ics' },
];

const state = {
  family: load() ?? [], // [{id, name, role, color, ics}]
  view: 'week', // or 'day'
  focus: startOfDay(new Date()), // the day being looked at; the week is the one containing it
  bufferMin: 20,
  selectedId: null,
  settings: loadSettings(), // { home, places: {normalizedName: {lat,lng}}, carpool: [{name, note}] }
  lastEvents: [],
};

const $ = (sel) => document.querySelector(sel);

function mondayOf(d) {
  const s = startOfDay(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - ((s.getDay() + 6) % 7));
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
function loadSettings() {
  try {
    return { home: '', places: {}, carpool: [], ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { home: '', places: {}, carpool: [] };
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch { /* see save() */ }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.family));
  } catch { /* private mode etc. — the app still works for this visit */ }
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function eventsBetween(rangeStart, rangeEnd, errors = []) {
  return state.family.flatMap((p) => {
    try {
      return parseIcs(p.ics, { person: p.id, rangeStart, rangeEnd });
    } catch (err) {
      errors.push(`${p.name}: couldn't read calendar (${err.message})`);
      return [];
    }
  });
}

const travelTime = () => makeTravelTime({ places: state.settings.places, home: state.settings.home, fallbackMin: state.bufferMin });

// First conflict after `from`, looking up to 12 weeks ahead.
function nextConflictAfter(from) {
  const events = eventsBetween(from, addDays(from, 84));
  return detectConflicts(events, state.family, { travelMin: travelTime() }).conflicts
    .find((c) => c.start >= from);
}

function render() {
  renderPeople();
  const weekStart = mondayOf(state.focus);
  const weekEnd = addDays(weekStart, 7);
  const isDay = state.view === 'day';
  const from = isDay ? state.focus : weekStart;
  const to = isDay ? addDays(state.focus, 1) : weekEnd;
  $('#week-label').textContent = isDay
    ? state.focus.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : `${fmtDay(weekStart)} – ${fmtDay(addDays(weekEnd, -1))}`;
  $('#today').textContent = isDay ? 'Today' : 'This week';
  $('#prev').setAttribute('aria-label', isDay ? 'Previous day' : 'Previous week');
  $('#next').setAttribute('aria-label', isDay ? 'Next day' : 'Next week');
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));

  // conflicts are always worked out for the whole week, so drivers are
  // assigned with the same context whichever view is showing
  const errors = [];
  const events = eventsBetween(weekStart, weekEnd, errors);
  $('#errors').textContent = errors.join(' · ');

  state.lastEvents = events;
  const { legs, assignment, conflicts } = detectConflicts(events, state.family, { travelMin: travelTime() });
  if (!conflicts.some((c) => c.id === state.selectedId)) state.selectedId = null;

  const shown = conflicts.filter((c) => c.start >= from && c.start < to);
  const next = state.family.length && !shown.length ? nextConflictAfter(to) : null;
  const jump = $('#next-conflict');
  jump.hidden = !next && !(state.family.length && !shown.length);
  jump.disabled = !next;
  jump.textContent = next
    ? `No conflicts ${isDay ? 'today' : 'this week'}. Next: ${fmtDay(next.start)} ${fmtTime(next.start)} →`
    : `No conflicts in the next 12 weeks`;
  jump.onclick = next ? () => { state.focus = startOfDay(next.start); state.selectedId = next.id; render(); } : null;

  const rides = legs.length;
  $('#summary').textContent = state.family.length
    ? `${rides} car trip${rides === 1 ? '' : 's'} this week · ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`
    : 'Add each person\'s calendar to get started.';
  $('#summary').classList.toggle('bad', conflicts.length > 0);

  renderLanes($('#week'), {
    family: state.family, events, legs, assignment, conflicts,
    from,
    dayCount: isDay ? 1 : 7,
    selectedId: state.selectedId,
    onSelect: (id) => { state.selectedId = id; render(); },
    onDay: isDay ? null : (d) => { state.view = 'day'; state.focus = d; render(); },
  });
  renderDetail(conflicts.find((c) => c.id === state.selectedId));
  renderList(conflicts);
  renderMonitor(conflicts, 'this week', next ?? (conflicts.length ? null : nextConflictAfter(weekEnd)));
  renderGaps(events);
  $('#briefing').textContent = state.family.length
    ? sundayBriefing({ family: state.family, legs, assignment, conflicts, events, weekStart, carpool: state.settings.carpool })
    : '';
  $('#home').value = state.settings.home;
  $('#carpool').value = state.settings.carpool.map((c) => (c.note ? `${c.name}, ${c.note}` : c.name)).join('\n');
}

// Top-right panel: the week's conflicts at a glance, wherever you're scrolled to.
function renderMonitor(conflicts, label, next) {
  const box = $('#monitor');
  box.hidden = !state.family.length;
  box.classList.toggle('alert', conflicts.length > 0);
  $('#monitor-range').textContent = label;
  $('#monitor-count').textContent = conflicts.length
    ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`
    : 'All clear';
  const ol = $('#monitor-list');
  ol.innerHTML = '';
  for (const c of conflicts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = c.id === state.selectedId ? 'selected' : '';
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = `${c.start.toLocaleDateString([], { weekday: 'short' })} ${fmtTime(c.start)}`;
    btn.append(when, document.createTextNode(headline(c)));
    btn.addEventListener('click', () => { state.selectedId = c.id; state.focus = startOfDay(c.start); render(); $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    li.append(btn);
    ol.append(li);
  }
  const nb = $('#monitor-next');
  nb.hidden = conflicts.length > 0 || !next;
  if (next) {
    nb.textContent = `Next: ${fmtDay(next.start)} ${fmtTime(next.start)} →`;
    nb.onclick = () => { state.focus = startOfDay(next.start); state.selectedId = next.id; render(); };
  }
}

function renderList(conflicts) {
  const ul = $('#conflict-list');
  ul.innerHTML = '';
  for (const c of conflicts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = `${fmtDay(c.start)} ${fmtTime(c.start)} · ${headline(c)}`;
    btn.addEventListener('click', () => { state.selectedId = c.id; state.focus = startOfDay(c.start); render(); });
    li.append(btn);
    ul.append(li);
  }
}

const nameOf = (id) => state.family.find((p) => p.id === id)?.name ?? id;

function headline(c) {
  if (c.type === 'double-booked') return `${nameOf(c.people[0])} is in two places at once`;
  const l = c.leg;
  if (c.type === 'tight-handoff') return `${l.kids.map(nameOf).join(' and ')} can't get from ${l.from} to ${l.to} in time`;
  const kids = l.kids.map(nameOf).join(' and ');
  if (l.kind === 'dropoff') return `${kids} needs a ride to ${l.to}`;
  if (l.kind === 'pickup') return `${kids} needs picking up from ${l.from}`;
  return `${kids} needs getting from ${l.from} to ${l.to}`;
}

function renderDetail(c) {
  const box = $('#detail');
  if (!c) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const lines = [];
  if (c.type === 'double-booked') {
    for (const e of c.events) lines.push(`${e.title}: ${fmtTime(e.start)}–${fmtTime(e.end)}${e.location ? ` at ${e.location}` : ''}`);
  } else {
    lines.push(`Car needed ${fmtTime(c.start)}–${fmtTime(c.end)} (about ${c.leg.travelMin ?? state.bufferMin} min of driving)`);
    for (const b of c.busy) lines.push(`${nameOf(b.adult)} is busy: ${b.event.title} ${fmtTime(b.event.start)}–${fmtTime(b.event.end)}`);
    for (const d of c.drivingElsewhere) {
      lines.push(`${nameOf(d.adult)} is free but already driving ${d.leg.kids.map(nameOf).join(' + ')} ${d.leg.kind === 'pickup' ? `from ${d.leg.from}` : `to ${d.leg.to}`}`);
    }
  }
  box.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = `${fmtDay(c.start)} · ${headline(c)}`;
  const ul = document.createElement('ul');
  for (const t of lines) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  const opts = optionsFor(c, { nameOf, carpool: state.settings.carpool });
  const optsBox = document.createElement('div');
  if (opts.length) {
    const oh = document.createElement('h4');
    oh.textContent = 'Options';
    const ol = document.createElement('ul');
    for (const t of opts) {
      const li = document.createElement('li');
      li.textContent = t;
      ol.append(li);
    }
    optsBox.append(oh, ol);
  }
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = 'Close';
  close.addEventListener('click', () => { state.selectedId = null; render(); });
  box.append(h, ul, optsBox, close);
}

function renderGaps(events) {
  const ul = $('#gaps');
  ul.innerHTML = '';
  for (const g of calendarGaps(events, state.family)) {
    const li = document.createElement('li');
    li.textContent = g;
    ul.append(li);
  }
  $('#gaps-box').hidden = !ul.children.length;
}

function renderPeople() {
  const ul = $('#people');
  ul.innerHTML = '';
  for (const p of state.family) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${p.color}"></span>`;
    const name = document.createElement('input');
    name.value = p.name;
    name.addEventListener('change', () => { p.name = name.value.trim() || p.name; save(); render(); });
    const role = document.createElement('select');
    role.innerHTML = '<option value="adult">adult (can drive)</option><option value="kid">kid</option>';
    role.value = p.role;
    role.addEventListener('change', () => { p.role = role.value; save(); render(); });
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => { state.family = state.family.filter((x) => x !== p); save(); render(); });
    li.append(name, role, rm);
    ul.append(li);
  }
}

const ADULT_NAMES = /^(mom|mum|mommy|mother|dad|daddy|father|parent|grandma|grandpa|granny|nanny)\b/i;

// Re-uploading someone's calendar replaces it instead of adding them twice.
async function addFiles(files) {
  for (const f of files) {
    const ics = await f.text();
    const name = ics.match(/^X-WR-CALNAME:(.+)$/m)?.[1].trim() || f.name.replace(/\.ics$/i, '');
    const existing = state.family.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.ics = ics;
      continue;
    }
    state.family.push({
      id: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now().toString(36)}`,
      name,
      role: ADULT_NAMES.test(name) ? 'adult' : 'kid',
      color: COLORS[state.family.length % COLORS.length],
      ics,
    });
  }
  $('#add-files').value = '';
  save();
  render();
}

async function loadSample() {
  const extra = await (await fetch('samples/places.json')).json();
  state.settings = { home: extra.home, places: extra.places, carpool: extra.carpool };
  saveSettings();
  state.family = await Promise.all(SAMPLE.map(async (p, i) => ({
    id: p.id, name: p.name, role: p.role, color: COLORS[i],
    ics: await (await fetch(p.file)).text(),
  })));
  save();
  render();
}

$('#add-files').addEventListener('change', (e) => addFiles(e.target.files));
$('#load-sample').addEventListener('click', loadSample);
$('#clear-all').addEventListener('click', () => {
  if (!confirm('Remove everyone\'s calendar from this browser?')) return;
  state.family = [];
  save();
  render();
});

const THEME_KEY = 'family-atc:theme';
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  $('#theme').value = theme;
}
try { applyTheme(localStorage.getItem(THEME_KEY) || 'auto'); } catch { applyTheme('auto'); }
$('#theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
  try { localStorage.setItem(THEME_KEY, e.target.value); } catch { /* per-visit only */ }
});
$('#home').addEventListener('change', (e) => { state.settings.home = e.target.value.trim(); saveSettings(); render(); });
$('#carpool').addEventListener('change', (e) => {
  state.settings.carpool = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, ...note] = l.split(',');
    return { name: name.trim(), note: note.join(',').trim() };
  });
  saveSettings();
  render();
});
$('#copy-briefing').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#briefing').textContent); $('#copy-briefing').textContent = 'Copied'; }
  catch { $('#copy-briefing').textContent = 'Select the text and copy it'; }
  setTimeout(() => { $('#copy-briefing').textContent = 'Copy briefing'; }, 2000);
});
$('#locate').addEventListener('click', locatePlaces);
$('#prev').addEventListener('click', () => shift(-1));
$('#next').addEventListener('click', () => shift(1));
$('#today').addEventListener('click', () => { state.focus = startOfDay(new Date()); render(); });
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
}
$('#buffer').addEventListener('change', (e) => { state.bufferMin = Number(e.target.value) || 20; render(); });

// Look up every address we don't have coordinates for, one per second
// (Nominatim's usage policy), then re-render with real travel times.
async function locatePlaces() {
  const names = new Map();
  if (state.settings.home) names.set(normalizePlace(state.settings.home), state.settings.home);
  for (const e of state.lastEvents) if (e.location) names.set(normalizePlace(e.location), e.location);
  const todo = [...names].filter(([key]) => !state.settings.places[key]);
  const status = $('#locate-status');
  const failed = [];
  for (const [i, [key, label]] of todo.entries()) {
    status.textContent = `Looking up ${i + 1} of ${todo.length}: ${label}`;
    try {
      const hit = await geocode(label);
      if (hit) state.settings.places[key] = hit; else failed.push(label);
    } catch {
      failed.push(label);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  saveSettings();
  status.textContent = failed.length
    ? `Couldn't find: ${failed.join('; ')}. Those use the flat ${state.bufferMin} min estimate.`
    : todo.length ? 'All places found.' : 'Nothing new to look up.';
  render();
}

function shift(direction) {
  state.focus = addDays(state.focus, direction * (state.view === 'day' ? 1 : 7));
  render();
}

render();
