import { VectorDisplay } from '../../src/vector-display.js';
import { mount } from '../../src/ui/index.js';
import { view, onRouteChange } from './app.js';

const root = document.documentElement;
const canvas = document.getElementById('screen');

let display;
try {
  // A wide 16:10 tube, a fast beam (a whole page traces in about two seconds),
  // and a little less corner dwell so small text doesn't look beaded.
  display = new VectorDisplay(canvas, {
    width: 1280,
    height: 800,
    beamSpeed: 42000,
    persistence: 0.12,
    curvature: 0.018,
    dwell: 0.3,
    glow: 0.7,
  });
} catch (err) {
  document.querySelector('.tube__fallback').hidden = false;
  throw err;
}

const app = mount(display, view, { style: { size: 12, spacing: 1, lineHeight: 1.55 } });
addEventListener('hashchange', () => {
  onRouteChange();
  app.invalidate();
});

const buttons = document.querySelectorAll('[data-set-phosphor]');
buttons.forEach((b) =>
  b.addEventListener('click', () => {
    display.color = b.dataset.setPhosphor;
    root.dataset.phosphor = display.color;
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }),
);

// For poking at it from the console.
window.vd = display;
window.app = app;
