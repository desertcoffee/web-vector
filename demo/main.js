import { VectorDisplay } from '../src/vector-display.js';
import { PROGRAMS } from './programs.js';
import { bindPanel } from './controls.js';

const root = document.documentElement;
const canvas = document.getElementById('screen');
const kbd = document.getElementById('kbd');

let display;
try {
  display = new VectorDisplay(canvas, { color: 'green' });
} catch (err) {
  console.error(err);
  document.querySelector('.tube__fallback').hidden = false;
  throw err;
}
// Handy for poking at it from the console: vd.line(100, 100, 900, 600)
window.vd = display;

// -- panel ----------------------------------------------------------------

const { setPhosphor, knobs } = bindPanel(display, { storageKey: 'xy1024:demo:display' });

// -- programs ---------------------------------------------------------------

const STOPPED = Symbol('stopped');
const programButtons = document.querySelectorAll('[data-program]');
let current = null;

function run(name) {
  current?.stop();
  display.clear();

  const ac = new AbortController();
  const { signal } = ac;
  const disposers = [];
  const check = () => {
    if (signal.aborted) throw STOPPED;
  };
  const ctx = {
    d: display,
    canvas,
    kbd,
    signal,
    ui: {
      togglePhosphor: () => setPhosphor(display.color === 'green' ? 'orange' : 'green'),
      setBeamSpeed: (v) => knobs.beam.set(v),
    },
    idle: () => display.idle().then(check),
    sleep: (ms) =>
      new Promise((resolve) => {
        const id = setTimeout(resolve, ms);
        disposers.push(() => clearTimeout(id));
      }).then(check),
    frame: (fn) => disposers.push(display.onFrame(fn)),
    every: (ms, fn) => {
      const id = setInterval(fn, ms);
      disposers.push(() => clearInterval(id));
    },
    listen: (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      disposers.push(() => target.removeEventListener(type, fn, opts));
    },
    onStop: (fn) => disposers.push(fn),
  };

  current = {
    name,
    stop() {
      ac.abort();
      disposers.forEach((fn) => fn());
    },
  };
  programButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.program === name)));
  canvas.setAttribute('aria-label', `Vector display running the ${name} program`);
  root.dataset.running = name;

  PROGRAMS[name](ctx).catch((err) => {
    if (err !== STOPPED) console.error(err);
  });
}

programButtons.forEach((b) => b.addEventListener('click', () => run(b.dataset.program)));
document.querySelector('[data-action="replay"]').addEventListener('click', () => run(current?.name ?? 'title'));

run('title');
