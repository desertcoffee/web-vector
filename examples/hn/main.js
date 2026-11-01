import { VectorDisplay } from '../../src/vector-display.js';
import { mount } from '../../src/ui/index.js';
import { view } from './app.js';
import { onSettle, pending } from './api.js';
import { bindPanel } from '../../demo/controls.js';

const canvas = document.getElementById('screen');

let display;
try {
  // A wide 16:10 tube, a fast beam (a whole page traces in about two seconds), scan
  // order so the beam always paints top-down, and a little less corner dwell so small
  // text doesn't look beaded.
  display = new VectorDisplay(canvas, {
    order: 'scan',
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
addEventListener('hashchange', () => app.invalidate());
// Data arrives asynchronously: re-render when a request lands, and keep the loading
// dots moving while any are in flight.
onSettle(() => app.invalidate());
setInterval(() => pending() && app.invalidate(), 320);

// Saved separately from the demo's settings, since the defaults differ. This page's beam
// runs far faster than the demo's, so its knob needs more headroom.
bindPanel(display, { storageKey: 'xy1024:news:display', knobs: { beam: { max: 100000 } } });

// For poking at it from the console.
window.vd = display;
window.app = app;
