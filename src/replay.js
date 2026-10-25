// Replay a day: scrub through one day of the plan on a schematic map, with a
// "who is busy when" timeline and the problems live at the chosen minute.
import { suggestions, sevOf, kidNames } from './plan.js';
import { normalizePlace } from './travel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mins = (d) => d.getHours() * 60 + d.getMinutes();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m) % 60).padStart(2, '0')}`;
const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const T0 = 6 * 60;
const T1 = 22 * 60;
const VW = 920;
const GL = 84;
const GR = 14;
const LH = 40;
const TOP = 24;
const SPEEDS = [3, 6, 15, 30];
const HOME = { x: 380, y: 205, label: 'Home' };
const AWAY = { x: 380, y: 392, label: 'Away from home' };
const clampT = (t) => Math.max(T0, Math.min(T1, t));

export function createReplay(ctx) {
  const R = { day: 0, time: 16 * 60, playing: false, speed: 6, track: 'all', routes: true, travel: false, only: false, raf: 0, last: 0, init: false, scrub: false, gkey: '', probKey: '', whoHTML: '', layoutKey: '', layout: null };
  const plan = () => ctx.plan();
  const dayDate = (i = R.day) => { const w = ctx.weekStart(); return new Date(w.getFullYear(), w.getMonth(), w.getDate() + i); };
  const dayOf = (d) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - ctx.weekStart()) / 86_400_000);
  const dayTrips = () => plan().trips.filter((t) => dayOf(t.start) === R.day);
  const name = (id) => plan().people.get(id)?.name ?? plan().drivers.get(id)?.name ?? id;
  const relOf = (ids) => R.track === 'all' || ids.includes(R.track);
  const kidColor = (k) => plan().people.get(k)?.color ?? 'var(--both)';

  /* places on the map: real coordinates when every place has them, otherwise a ring around home */
  function layout() {
    const names = [...new Set(plan().trips.flatMap((t) => [t.from, t.to]).filter(Boolean))].sort();
    const key = names.join('|');
    if (key === R.layoutKey) return R.layout;
    const places = ctx.settings().places || {};
    const homeC = places[normalizePlace(ctx.settings().home || 'home')];
    const coords = names.map((n) => places[normalizePlace(n)]);
    const out = { Home: HOME };
    if (homeC && coords.every(Boolean) && names.length) {
      const all = [homeC, ...coords];
      const [minLat, maxLat] = [Math.min(...all.map((c) => c.lat)), Math.max(...all.map((c) => c.lat))];
      const [minLng, maxLng] = [Math.min(...all.map((c) => c.lng)), Math.max(...all.map((c) => c.lng))];
      const px = (c) => ({ x: 90 + ((c.lng - minLng) / ((maxLng - minLng) || 1)) * 580, y: 340 - ((c.lat - minLat) / ((maxLat - minLat) || 1)) * 290 });
      out.Home = { ...px(homeC), label: 'Home' };
      names.forEach((n, i) => { out[n] = { ...px(coords[i]), label: n }; });
    } else {
      // spread round an ellipse, skipping the bottom where the "away" box sits
      const n = names.length;
      names.forEach((nm, i) => {
        const a = (110 + (i + 0.5) * (320 / n)) * (Math.PI / 180);
        out[nm] = { x: HOME.x + Math.cos(a) * 300, y: HOME.y + Math.sin(a) * 150, label: nm };
      });
    }
    R.layoutKey = key;
    R.layout = out;
    return out;
  }
  const P = (n) => layout()[n ?? 'Home'] ?? HOME;

  const span = (t) => ({ s: mins(t.start), e: Math.max(mins(t.start) + 1, mins(t.end)) });
  function phase(t, time) {
    const { s, e } = span(t);
    if (time < s || time > e) return null;
    return { pos: lerp(P(t.from), P(t.to), (time - s) / (e - s)) };
  }
  const busyAt = (key, time) => (plan().busy.get(key) || []).find((e) => dayOf(e.start) === R.day && time >= mins(e.start) && time < mins(e.end));
  const busyWindows = (key) => (plan().busy.get(key) || []).filter((e) => dayOf(e.start) === R.day);
  const tripText = (t, who) => {
    const kids = kidNames(plan(), t);
    if (t.kind === 'pickup') return `${who} is bringing ${kids} home from ${t.from}`;
    if (t.kind === 'handoff') return `${who} is taking ${kids} from ${t.from} to ${t.to}`;
    return `${who} is driving ${kids} to ${t.to}, arriving ${hhmm(mins(t.end))}`;
  };

  /* where is everyone at this minute? */
  function model(time) {
    const M = { marks: [], lines: [], kidLines: [] };
    const dts = dayTrips();
    const adults = [...plan().drivers.values()].filter((d) => !d.pool);
    adults.forEach((d, i) => {
      const off = (i - (adults.length - 1) / 2) * 44;
      const away = busyAt(d.key, time);
      const act = dts.filter((t) => t.driver === d.key).map((t) => ({ t, ph: phase(t, time) })).filter((x) => x.ph);
      let base; let text; let sev = 'ok'; let ids = [d.key]; let ghosts; let first = null;
      if (away) { base = { x: AWAY.x + off, y: AWAY.y - 42 }; text = `${d.name} is at ${away.title} until ${hhmm(mins(away.end))}`; sev = 'muted'; ghosts = act; }
      else if (act.length) { base = act[0].ph.pos; first = act[0].t; text = tripText(first, d.name); ids = [d.key, ...first.kids]; ghosts = act.slice(1); }
      else { base = { x: P('Home').x + off, y: P('Home').y + 44 }; text = `${d.name} is at home`; sev = 'muted'; ghosts = []; }
      M.marks.push({ type: 'adult', x: base.x, y: base.y, text: d.initial, ids, flag: first ? plan().status[first.id] : null });
      ghosts.forEach((g) => M.marks.push({ type: 'ghost', x: g.ph.pos.x, y: g.ph.pos.y, text: d.initial, ids: [d.key, ...g.t.kids], flag: 'x' }));
      if (ghosts.length) {
        const g = ghosts[0].t;
        sev = 'bad';
        text = away ? `${text}, but is due to take ${kidNames(plan(), g)} ${g.to ? `to ${g.to}` : `home from ${g.from}`}` : `${text}, and is also due to take ${kidNames(plan(), g)} ${g.to ? `to ${g.to}` : `home from ${g.from}`}`;
      }
      M.lines.push({ who: d.name, text, sev, ids: [d.key] });
    });
    dts.filter((t) => t.driver && plan().drivers.get(t.driver)?.pool).forEach((t) => {
      const ph = phase(t, time);
      if (!ph) return;
      const d = plan().drivers.get(t.driver);
      M.marks.push({ type: 'car', x: ph.pos.x, y: ph.pos.y, text: d.initial, ids: [d.key, ...t.kids], flag: plan().status[t.id] });
      M.lines.push({ who: d.name, text: tripText(t, d.name), sev: 'ok', ids: [d.key, ...t.kids] });
    });
    dts.filter((t) => !t.driver).forEach((t) => {
      const { s, e } = span(t);
      if (time >= s - 15 && time <= e) M.lines.push({ who: 'Nobody', text: `No driver for ${kidNames(plan(), t)} ${t.to ? `to ${t.to}` : `from ${t.from}`} at ${hhmm(s)}`, sev: 'bad', ids: t.kids });
    });
    // kids: riding, at an activity, away somewhere unknown, or at home
    const kids = [...plan().people.values()].filter((p) => p.role === 'kid');
    kids.forEach((k, i) => {
      const riding = dts.find((t) => t.kids.includes(k.id) && phase(t, time));
      let pos; let text;
      if (riding) {
        const ph = phase(riding, time);
        pos = riding.driver ? { x: ph.pos.x - 14 + i * 16, y: ph.pos.y - 22 } : { x: P(riding.from).x + i * 22 - 11, y: P(riding.from).y + 32 };
        text = riding.driver ? `${k.name} is riding ${riding.to ? `to ${riding.to}` : 'home'}` : `${k.name} is waiting ${riding.from ? `at ${riding.from}` : 'at home'} with no driver`;
      } else {
        const ev = ctx.events().find((e) => e.person === k.id && !e.allDay && dayOf(e.start) === R.day && time >= mins(e.start) && time < mins(e.end));
        if (ev && ev.location && layout()[ev.location]) { pos = { x: P(ev.location).x + i * 22 - 11, y: P(ev.location).y + 32 }; text = `${k.name} is at ${ev.title}`; }
        else if (ev) { pos = { x: AWAY.x - 100 + i * 22, y: AWAY.y }; text = `${k.name} is at ${ev.title}`; }
        else { pos = { x: P('Home').x - 40 + i * 22, y: P('Home').y - 38 }; text = `${k.name} is at home`; }
      }
      M.marks.push({ type: 'kid', kid: k.id, x: pos.x, y: pos.y, text: k.name[0], ids: [k.id, riding?.driver ?? 'none'], flag: riding ? plan().status[riding.id] : null });
      M.kidLines.push({ kid: k.id, text });
    });
    return M;
  }

  /* the map */
  function drawMap(M) {
    const el = $('mapSvg');
    const sc = Math.max(0.3, (el.clientWidth || 760) / 760);
    const k = Math.max(1, 0.75 / sc);
    const fs = Math.max(13, 12.5 / sc);
    const dts = dayTrips();
    const H = P('Home');
    const used = [...new Set(dts.flatMap((t) => [t.from, t.to]).filter(Boolean))];
    let s = '';
    const pairs = new Map();
    dts.forEach((t) => { const key = `${t.from ?? 'Home'}→${t.to ?? 'Home'}`; if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(t); });
    for (const ts of pairs.values()) {
      const a = P(ts[0].from); const b = P(ts[0].to);
      const live = ts.some((t) => phase(t, R.time));
      const need = ts.some((t) => !t.driver && R.time >= span(t).s - 15 && R.time <= span(t).e);
      const flagged = ts.some((t) => plan().status[t.id]);
      const dim = (R.only && !flagged) ? 0.18 : ts.some((t) => relOf([t.driver || 'none', ...t.kids])) ? 1 : 0.25;
      if (R.routes || live || need) s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="opacity:${dim};stroke:${need ? 'var(--warn)' : live ? 'var(--ink)' : 'var(--line)'};stroke-width:${live || need ? 3.5 : 2.5};${need ? 'stroke-dasharray:7 6;' : ''}"/>`;
      if (R.travel) s += `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 + 4}" text-anchor="middle" style="opacity:${dim};fill:var(--muted);font:600 ${(fs * 0.85).toFixed(1)}px 'B612 Mono',monospace;paint-order:stroke;stroke:var(--panel);stroke-width:5px">${ts[0].leg.travelMin ?? Math.round((ts[0].end - ts[0].start) / 60000)} min</text>`;
    }
    used.forEach((p) => {
      const L = P(p);
      const here = dts.filter((t) => t.from === p || t.to === p);
      const need = here.some((t) => !t.driver && t.to === p && R.time >= span(t).s - 15 && R.time <= span(t).e);
      const flaggedLive = here.some((t) => plan().status[t.id] && phase(t, R.time));
      const flagged = here.some((t) => plan().status[t.id]);
      const dim = (R.only && !flagged) ? 0.18 : (R.track === 'all' || here.some((t) => relOf([t.driver || 'none', ...t.kids]))) ? 1 : 0.25;
      const label = p.length > 18 ? `${p.slice(0, 17)}…` : p;
      s += `<g style="opacity:${dim}"><rect x="${L.x - 70}" y="${L.y - 18}" width="140" height="36" rx="6" style="fill:var(--panel);stroke:${flaggedLive ? 'var(--bad)' : 'var(--line)'};stroke-width:${flaggedLive ? 2.5 : 1.5}"/>`;
      s += `<text x="${L.x}" y="${L.y + 5}" text-anchor="middle" style="fill:var(--ink);font:600 ${fs.toFixed(1)}px 'Bricolage Grotesque',sans-serif"><title>${esc(p)}</title>${esc(label)}</text>`;
      if (need) s += `<text x="${L.x}" y="${L.y + 38}" text-anchor="middle" style="fill:var(--warn);font:700 ${(fs * 0.9).toFixed(1)}px 'Bricolage Grotesque',sans-serif">▲ Needs a driver</text>`;
      s += '</g>';
    });
    s += `<rect x="${AWAY.x - 72}" y="${AWAY.y - 18}" width="144" height="36" rx="6" style="fill:none;stroke:var(--muted);stroke-width:1.5;stroke-dasharray:5 4"/><text x="${AWAY.x}" y="${AWAY.y + 5}" text-anchor="middle" style="fill:var(--muted);font:600 ${fs.toFixed(1)}px 'Bricolage Grotesque',sans-serif">Away from home</text>`;
    s += `<rect x="${H.x - 46}" y="${H.y - 22}" width="92" height="44" rx="8" style="fill:var(--rail)"/><text x="${H.x}" y="${H.y + 6}" text-anchor="middle" style="fill:var(--rail-ink);font:700 ${(fs * 1.1).toFixed(1)}px 'Bricolage Grotesque',sans-serif">Home</text>`;
    const order = { kid: 0, car: 1, adult: 2, ghost: 3 };
    M.marks.slice().sort((a, b) => order[a.type] - order[b.type]).forEach((m) => {
      let o = relOf(m.ids) ? 1 : 0.22;
      if (R.only && !m.flag) o = Math.min(o, 0.2);
      const ring = m.flag && m.flag !== 'x' ? `<circle r="${m.type === 'kid' ? 15 : 21}" style="fill:none;stroke:${sevOf(m.flag) === 'bad' ? 'var(--bad)' : 'var(--warn)'};stroke-width:2.5"/>` : '';
      let body;
      if (m.type === 'ghost') body = `<circle r="16" style="fill:var(--bg);stroke:var(--bad);stroke-width:2.5;stroke-dasharray:4 3"/><text y="5" text-anchor="middle" style="fill:var(--bad);font:700 14px 'B612 Mono',monospace">${esc(m.text)}</text>`;
      else if (m.type === 'kid') body = `<circle r="11" style="fill:${kidColor(m.kid)}"/><text y="4" text-anchor="middle" style="fill:#fff;font:700 12px 'B612 Mono',monospace">${esc(m.text)}</text>`;
      else body = `<circle r="16" style="fill:${m.type === 'car' ? 'var(--both)' : 'var(--rail)'}"/><text y="5" text-anchor="middle" style="fill:${m.type === 'car' ? 'var(--panel)' : 'var(--rail-ink)'};font:700 14px 'B612 Mono',monospace">${esc(m.text)}</text>`;
      s += `<g transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)}) scale(${k.toFixed(2)})" style="opacity:${o}">${ring}${body}</g>`;
    });
    el.innerHTML = s;
  }

  /* the timeline: you can drag across it */
  function lanesForDay() {
    const dts = dayTrips();
    const adults = [...plan().drivers.values()].filter((d) => !d.pool).map((d) => [d.key, d.name]);
    const pools = [...plan().drivers.values()].filter((d) => d.pool && dts.some((t) => t.driver === d.key)).map((d) => [d.key, d.name]);
    return [...adults, ...pools, [null, 'Nobody']];
  }
  function drawGantt() {
    const dts = dayTrips();
    const lanes = lanesForDay();
    const VH = TOP + lanes.length * LH + 76;
    const X = (t) => GL + (clampT(t) - T0) / (T1 - T0) * (VW - GL - GR);
    const key = `${R.day}|${R.track}|${R.only}|${lanes.length}|${dts.map((t) => `${t.id}:${t.driver}:${plan().status[t.id] ?? ''}`).join(',')}`;
    if (key !== R.gkey) {
      R.gkey = key;
      $('ganttSvg').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
      $('ganttCur').setAttribute('viewBox', `0 0 ${VW} ${VH}`);
      let s = '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--muted);stroke-width:1.5;opacity:.4"/></pattern></defs>';
      for (let h = 6; h <= 22; h++) {
        const x = X(h * 60);
        s += `<line x1="${x}" y1="${TOP - 4}" x2="${x}" y2="${VH - 8}" style="stroke:var(--line);stroke-width:1"/>`;
        if (h % 3 === 0) s += `<text x="${x}" y="14" text-anchor="middle" style="fill:var(--muted);font:12px 'B612 Mono',monospace">${String(h).padStart(2, '0')}:00</text>`;
      }
      lanes.forEach(([k, nm], li) => {
        const y = TOP + li * LH;
        s += `<text x="${GL - 10}" y="${y + LH / 2 + 5}" text-anchor="end" style="fill:var(--ink);font:600 14px 'Bricolage Grotesque',sans-serif">${esc(nm.length > 10 ? `${nm.slice(0, 9)}…` : nm)}</text>`;
        s += `<line x1="${GL}" y1="${y + LH}" x2="${VW - GR}" y2="${y + LH}" style="stroke:var(--line);stroke-width:1"/>`;
        if (k) busyWindows(k).forEach((w) => { s += `<rect x="${X(mins(w.start))}" y="${y + 3}" width="${Math.max(0, X(mins(w.end)) - X(mins(w.start)))}" height="${LH - 6}" rx="3" style="fill:url(#hatch);stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3"><title>${esc(w.title)}</title></rect>`; });
        const lane = dts.filter((t) => (t.driver || null) === k).sort((a, b) => a.start - b.start);
        const rows = [];
        const rowOf = {};
        lane.forEach((t) => {
          let r = rows.findIndex((e) => e <= mins(t.start));
          if (r < 0) { r = rows.length; rows.push(0); }
          rows[r] = mins(t.end);
          rowOf[t.id] = r;
        });
        const bh = Math.floor((LH - 8) / Math.max(1, rows.length)) - (rows.length > 1 ? 1 : 0);
        lane.forEach((t) => {
          const x = X(mins(t.start));
          const w = Math.max(6, X(mins(t.end)) - x);
          const by = y + 4 + rowOf[t.id] * (bh + 2);
          const kind = plan().status[t.id];
          const color = t.kids.length > 1 ? 'var(--both)' : kidColor(t.kids[0]);
          let o = relOf([t.driver || 'none', ...t.kids]) ? 1 : 0.2;
          if (R.only && !kind) o *= 0.25;
          const edge = kind ? `stroke:${sevOf(kind) === 'bad' ? 'var(--bad)' : 'var(--warn)'};stroke-width:2.5;` : '';
          const look = t.driver ? `fill:${color};${edge}` : 'fill:none;stroke:var(--warn);stroke-width:2;stroke-dasharray:4 3;';
          s += `<g style="opacity:${o}"><rect x="${x}" y="${by}" width="${w}" height="${bh}" rx="3" style="${look}"><title>${esc(`${t.title}: ${kidNames(plan(), t)}`)}</title></rect></g>`;
        });
      });
      const ly = TOP + LH * lanes.length + 14;
      const unit = 14;
      const adults = [...plan().drivers.values()].filter((d) => !d.pool);
      let cap = '';
      s += `<text x="${GL - 10}" y="${ly + 30}" text-anchor="end" style="fill:var(--ink);font:600 14px 'Bricolage Grotesque',sans-serif">Drivers</text><text x="${GL - 10}" y="${ly + 46}" text-anchor="end" style="fill:var(--muted);font:12px 'Bricolage Grotesque',sans-serif">needed</text>`;
      for (let t = T0; t < T1; t += 10) {
        const mid = t + 5;
        const demand = dts.filter((x) => !plan().drivers.get(x.driver)?.pool && mid >= span(x).s && mid < span(x).e).length;
        const free = adults.filter((d) => !busyAt(d.key, mid)).length;
        const x0 = X(t);
        const x1 = X(t + 10);
        const bad = demand > free;
        if (demand) s += `<rect x="${x0}" y="${ly + 44 - demand * unit}" width="${(x1 - x0 + 0.5).toFixed(1)}" height="${demand * unit}" style="fill:${bad ? 'var(--bad)' : 'var(--muted)'};opacity:${bad ? 0.85 : 0.35}"/>`;
        cap += `${cap ? 'L' : 'M'}${x0.toFixed(1)},${ly + 44 - free * unit} L${x1.toFixed(1)},${ly + 44 - free * unit} `;
      }
      s += `<path d="${cap}" style="fill:none;stroke:var(--ok);stroke-width:2"/>`;
      $('ganttSvg').innerHTML = s;
    }
    const cx = X(R.time);
    $('ganttCur').innerHTML = `<line x1="${cx}" y1="${TOP - 6}" x2="${cx}" y2="${VH - 6}" style="stroke:var(--ink);stroke-width:2"/><path d="M${cx - 8},2 L${cx + 8},2 L${cx},13 Z" style="fill:var(--ink)"/>`;
  }

  /* the panels */
  function moments() {
    return plan().alerts.map((a) => ({ a, day: dayOf(a.start), t: mins(a.start) + 2 })).sort((x, y) => x.day - y.day || x.t - y.t);
  }
  function jumpNext() {
    const ms = moments();
    if (!ms.length) return;
    const cur = R.day * 2000 + R.time;
    const nx = ms.find((m) => m.day * 2000 + m.t > cur + 1) || ms[0];
    R.day = nx.day;
    R.time = nx.t;
    setPlaying(false);
    render();
  }
  function activeAlerts() {
    return plan().alerts.filter((a) => {
      if (dayOf(a.start) !== R.day) return false;
      const ts = a.trips.map((id) => plan().trips.find((t) => t.id === id)).filter(Boolean);
      const s = ts.length ? Math.min(...ts.map((t) => span(t).s)) : mins(a.start);
      const e = ts.length ? Math.max(...ts.map((t) => span(t).e)) : mins(a.start) + 30;
      return R.time >= s - 15 && R.time <= e;
    });
  }
  function probHTML(act) {
    let h = '';
    if (!act.length) h += `<p class="calm">${plan().alerts.length ? 'Nothing is wrong at this moment.' : 'Nothing is wrong this week.'}</p>`;
    act.forEach((a) => {
      const c = ctx.alertCopy(a);
      const sev = sevOf(a.kind);
      const o = suggestions(plan(), a);
      h += `<div class="rp-alert ${sev}"><b>${sev === 'bad' ? '▲' : '◆'} ${esc(c.h)}</b><p>${esc(c.p)}</p>${o.map((x, i) => `<button class="opt" data-alert="${esc(a.id)}" data-i="${i}">${esc(x.label)}</button>`).join('')}</div>`;
    });
    if (plan().alerts.length) h += '<button class="rbtn" id="rpNext">Jump to next problem</button>';
    return h;
  }
  function hud(M) {
    $('rpClock').textContent = hhmm(R.time);
    $('rpDayName').textContent = dayDate().toLocaleDateString([], { weekday: 'long' });
    const lines = M.lines.slice();
    const kl = M.kidLines.find((x) => x.kid === R.track);
    if (kl) lines.unshift({ who: name(kl.kid), text: kl.text, sev: 'ok', ids: [kl.kid] });
    const html = lines.map((l) => {
      const body = l.text.startsWith(l.who) ? `<b>${esc(l.who)}</b>${esc(l.text.slice(l.who.length))}` : esc(l.text);
      return `<li class="${l.sev}${relOf(l.ids) ? '' : ' dim'}"><i aria-hidden="true">${l.sev === 'bad' ? '▲' : l.sev === 'muted' ? '○' : '●'}</i><span>${body}</span></li>`;
    }).join('');
    if (html !== R.whoHTML) { R.whoHTML = html; $('rpWho').innerHTML = html; }
    const act = activeAlerts();
    const key = `${R.day}|${plan().alerts.map((a) => a.id).join(',')}|${act.map((a) => a.id).join(',')}`;
    if (key !== R.probKey) { R.probKey = key; $('rpProb').innerHTML = probHTML(act); }
  }
  function chips() {
    const alertDays = new Set(plan().alerts.map((a) => dayOf(a.start)));
    $('rpDays').innerHTML = [...Array(7)].map((_, i) => {
      const d = dayDate(i);
      return `<button class="rbtn" data-day="${i}" aria-pressed="${i === R.day}">${d.toLocaleDateString([], { weekday: 'short' })} ${d.getDate()}${alertDays.has(i) ? ' •' : ''}</button>`;
    }).join('');
    const who = [['all', 'Everyone'], ...[...plan().drivers.values()].map((d) => [d.key, d.name]),
      ...[...plan().people.values()].filter((p) => p.role === 'kid').map((p) => [p.id, p.name])];
    $('rpTrack').innerHTML = who.map(([k, n]) => `<button class="rbtn" data-track="${esc(k)}" aria-pressed="${k === R.track}">${esc(n)}</button>`).join('');
    $('rpRoutes').setAttribute('aria-pressed', String(R.routes));
    $('rpTravel').setAttribute('aria-pressed', String(R.travel));
    $('rpOnly').setAttribute('aria-pressed', String(R.only));
  }
  function render(planChanged = false) {
    if (planChanged) { R.gkey = ''; R.probKey = ''; R.whoHTML = ''; }
    if (ctx.view() !== 'replay') return;
    R.time = clampT(R.time);
    const M = model(R.time);
    drawMap(M);
    drawGantt();
    hud(M);
    chips();
    $('rpTime').value = Math.floor(R.time);
  }
  function show() {
    R.gkey = '';
    R.probKey = '';
    if (!R.init) {
      R.init = true;
      const ms = moments();
      if (ms.length) { R.day = ms[0].day; R.time = ms[0].t; }
      else {
        const first = plan().trips[0];
        if (first) { R.day = dayOf(first.start); R.time = mins(first.start); }
      }
    }
    if (R.playing) { R.raf = 0; setPlaying(true); }
    render();
  }
  function reset() { R.init = false; R.track = 'all'; R.layoutKey = ''; setPlaying(false); }

  /* play, step, scrub */
  function loop(now) {
    if (!R.playing || ctx.view() !== 'replay') { R.raf = 0; return; }
    const dt = Math.min(0.1, (now - R.last) / 1000);
    R.last = now;
    R.time += dt * R.speed;
    if (R.time > T1) R.time = T0;
    render();
    R.raf = requestAnimationFrame(loop);
  }
  function setPlaying(p) {
    R.playing = p;
    $('rpPlay').textContent = p ? 'Pause' : 'Play';
    $('rpPlay').setAttribute('aria-pressed', String(p));
    if (p && !R.raf) { R.last = performance.now(); R.raf = requestAnimationFrame(loop); }
  }
  $('rpPlay').onclick = () => setPlaying(!R.playing);
  $('rpBack').onclick = () => { setPlaying(false); R.time = clampT(R.time - 15); render(); };
  $('rpFwd').onclick = () => { setPlaying(false); R.time = clampT(R.time + 15); render(); };
  $('rpSpeed').oninput = (e) => { R.speed = SPEEDS[Number(e.target.value) - 1]; $('rpSpeedOut').textContent = `${R.speed} min per second`; };
  $('rpTime').oninput = (e) => { setPlaying(false); R.time = Number(e.target.value); render(); };
  $('rpDays').onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    R.day = Number(b.dataset.day);
    const ms = moments().filter((m) => m.day === R.day);
    const first = dayTrips()[0];
    R.time = ms.length ? ms[0].t : first ? mins(first.start) : 8 * 60;
    render(true);
  };
  $('rpTrack').onclick = (e) => { const b = e.target.closest('[data-track]'); if (!b) return; R.track = b.dataset.track; render(true); };
  $('rpRoutes').onclick = () => { R.routes = !R.routes; render(); };
  $('rpTravel').onclick = () => { R.travel = !R.travel; render(); };
  $('rpOnly').onclick = () => { R.only = !R.only; render(true); };
  $('rpProb').addEventListener('click', (ev) => {
    if (ev.target.closest('#rpNext')) { jumpNext(); return; }
    const b = ev.target.closest('.opt');
    if (b) ctx.applyFix(b.dataset.alert, Number(b.dataset.i));
  });
  const gw = $('gwrap');
  const scrubTo = (e) => {
    const r = gw.getBoundingClientRect();
    const vx = (e.clientX - r.left) / (r.width || 1) * VW;
    R.time = clampT(T0 + (vx - GL) / (VW - GL - GR) * (T1 - T0));
    render();
  };
  gw.addEventListener('pointerdown', (e) => { R.scrub = true; setPlaying(false); try { gw.setPointerCapture(e.pointerId); } catch { /* ignore */ } scrubTo(e); });
  gw.addEventListener('pointermove', (e) => { if (R.scrub) scrubTo(e); });
  gw.addEventListener('pointerup', () => { R.scrub = false; });
  gw.addEventListener('pointercancel', () => { R.scrub = false; });
  document.addEventListener('keydown', (e) => {
    if (ctx.view() !== 'replay' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'h' || e.key === 'H') $('replay').classList.toggle('hud-off');
    else if (e.key === 'ArrowRight') { $('rpFwd').click(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { $('rpBack').click(); e.preventDefault(); }
    else if (e.key === ' ' && tag !== 'button') { setPlaying(!R.playing); e.preventDefault(); }
  });

  return { show, render, reset };
}
