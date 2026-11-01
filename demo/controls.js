// Panel controls shared by the demo and the news terminal: phosphor keys, beam knobs and
// a reset key, with the settings saved in localStorage.
//
// Rotary knob: drag vertically, scroll, or use arrow keys. Double-click resets it.

const SWEEP = 270;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The beam knobs: [data-knob] name -> display property and range. */
export const DISPLAY_KNOBS = {
  intensity: { prop: 'intensity', min: 0.25, max: 2.5, log: true, format: (v) => v.toFixed(2) },
  focus: { prop: 'focus', min: 0.6, max: 5, log: true, format: (v) => v.toFixed(2) },
  persistence: {
    prop: 'persistence',
    min: 0.02,
    max: 2.5,
    log: true,
    format: (v) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`),
  },
  beam: {
    prop: 'beamSpeed',
    min: 200,
    max: 20000,
    log: true,
    format: (v) => (v < 1000 ? `${Math.round(v)}/s` : `${(v / 1000).toFixed(1)}k/s`),
  },
};

const PHOSPHORS = ['green', 'orange'];

function readSettings(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeSettings(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Storage is unavailable (private mode, disabled, full): settings just won't persist.
  }
}

/**
 * Wire the page's panel to a display: [data-set-phosphor] keys, [data-knob] dials and the
 * [data-action="reset-display"] key.
 *
 * The display's settings at the time of the call are this page's defaults. Saved settings
 * from `storageKey` are restored over them (malformed values are ignored, out-of-range
 * numbers are clamped to the knob's range),
 * every change is saved, and the reset key, which is only enabled when something differs
 * from the defaults, puts everything back and forgets the saved copy.
 * `knobs` overrides knob ranges, e.g. { beam: { max: 100000 } }.
 */
export function bindPanel(display, { storageKey, knobs: overrides = {} }) {
  const defs = {};
  for (const [name, def] of Object.entries(DISPLAY_KNOBS)) defs[name] = { ...def, ...overrides[name] };
  const props = ['color', ...Object.values(defs).map((d) => d.prop)];
  const defaults = Object.fromEntries(props.map((p) => [p, display[p]]));

  const saved = readSettings(storageKey);
  if (PHOSPHORS.includes(saved.color)) display.color = saved.color;
  for (const d of Object.values(defs)) {
    const v = saved[d.prop];
    if (typeof v === 'number' && Number.isFinite(v)) display[d.prop] = clamp(v, d.min, d.max);
  }

  const resetKey = document.querySelector('[data-action="reset-display"]');
  const same = (a, b) => (typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) : a === b);
  let ready = false;
  const save = () => {
    if (!ready) return;
    const now = Object.fromEntries(props.map((p) => [p, display[p]]));
    const changed = props.some((p) => !same(now[p], defaults[p]));
    writeSettings(storageKey, changed ? now : null);
    if (resetKey) resetKey.disabled = !changed;
  };

  // Phosphor keys.
  const keys = document.querySelectorAll('[data-set-phosphor]');
  const setPhosphor = (color) => {
    display.color = color;
    document.documentElement.dataset.phosphor = color;
    keys.forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.setPhosphor === color)));
    save();
  };
  keys.forEach((k) => k.addEventListener('click', () => setPhosphor(k.dataset.setPhosphor)));
  setPhosphor(display.color);

  // Knobs. Double-click returns a knob to the page default, not to whatever was restored.
  const knobs = {};
  for (const [name, { prop, ...opts }] of Object.entries(defs)) {
    const el = document.querySelector(`[data-knob="${name}"]`);
    if (!el) continue;
    knobs[name] = createKnob(el, {
      ...opts,
      value: display[prop],
      reset: defaults[prop],
      onChange: (v) => {
        display[prop] = v;
        save();
      },
    });
  }

  const reset = () => {
    setPhosphor(defaults.color);
    for (const [name, knob] of Object.entries(knobs)) knob.set(defaults[defs[name].prop]);
  };
  resetKey?.addEventListener('click', reset);

  ready = true;
  save();
  return { setPhosphor, knobs, reset };
}

export function createKnob(root, { min, max, value, reset = value, log = false, format = (v) => v.toFixed(2), onChange }) {
  const dial = root.querySelector('.knob__dial');
  const out = root.querySelector('.knob__value');
  const toNorm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromNorm = (n) => (log ? min * Math.pow(max / min, n) : min + n * (max - min));
  let n = toNorm(value);

  dial.setAttribute('role', 'slider');
  dial.tabIndex = 0;
  dial.setAttribute('aria-valuemin', String(min));
  dial.setAttribute('aria-valuemax', String(max));

  function set(next, emit = true) {
    n = clamp(next, 0, 1);
    const v = fromNorm(n);
    dial.style.setProperty('--turn', `${-SWEEP / 2 + n * SWEEP}deg`);
    dial.setAttribute('aria-valuenow', String(+v.toPrecision(4)));
    dial.setAttribute('aria-valuetext', format(v));
    out.textContent = format(v);
    if (emit) onChange(v);
  }

  let drag = null;
  dial.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dial.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, x: e.clientX, n };
    root.classList.add('is-turning');
  });
  dial.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const fine = e.shiftKey ? 0.25 : 1;
    set(drag.n + ((drag.y - e.clientY) / 180 + (e.clientX - drag.x) / 360) * fine);
  });
  const end = () => {
    drag = null;
    root.classList.remove('is-turning');
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('dblclick', () => set(toNorm(reset)));
  dial.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      set(n - Math.sign(e.deltaY) * (e.shiftKey ? 0.01 : 0.04));
    },
    { passive: false },
  );
  dial.addEventListener('keydown', (e) => {
    const steps = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in steps) set(n + steps[e.key]);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  });

  set(n, false);
  return { set: (v) => set(toNorm(v)), get: () => fromNorm(n) };
}
