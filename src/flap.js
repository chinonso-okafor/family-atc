// Split-flap display (the departures-board look) and its optional clack.

const RM = !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-:';

export const sound = { on: false };
let actx = null;
let lastClack = 0;

export function clack(vol = 0.1) {
  if (!sound.on) return;
  const now = performance.now();
  if (now - lastClack < 35) return;
  lastClack = now;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(actx.sampleRate * 0.03);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    const g = actx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(actx.destination);
    src.start();
  } catch { /* no audio available */ }
}

export function makeFlap(el, width) {
  el.dataset.w = width;
  el.dataset.v = '';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i><b> </b></i>'.repeat(width);
}

export function setFlap(el, text) {
  const w = Number(el.dataset.w);
  text = String(text).toUpperCase().padEnd(w, ' ').slice(0, w);
  if (el.dataset.v === text) return;
  el.dataset.v = text;
  [...el.children].forEach((c, i) => {
    const b = c.firstChild;
    c._t = text[i];
    if (RM) { b.textContent = c._t; return; }
    if (c._busy || b.textContent === c._t) return;
    c._busy = true;
    let n = 3 + Math.floor(Math.random() * 5) + (i % 3);
    const flip = () => { c.classList.remove('f'); void c.offsetWidth; c.classList.add('f'); };
    const step = () => {
      if (n-- > 0) {
        b.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        flip();
        clack(0.06);
        setTimeout(step, 48);
      } else {
        b.textContent = c._t;
        flip();
        c._busy = false;
      }
    };
    setTimeout(step, i * 20);
  });
}

export const reducedMotion = RM;
