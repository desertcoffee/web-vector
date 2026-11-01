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
    max: 10,
    log: true,
    format: (v) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`),
  },
  beam: {
    prop: 'beamSpeed',
    min: 200,
    max: 100000,
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
 * Wire the page's panel to a display: [data-set-phosphor] keys, [data-knob] dials,
 * [data-toggle] keys ("redraw" switches the display to fade & redraw, "autoPersist" keeps
 * persistence at least one redraw cycle long), the [data-readout="cycle"] output and the
 * [data-action="reset-display"] key.
 *
 * The display's settings at the time of the call are this page's defaults. Saved settings
 * from `storageKey` are restored over them (malformed values are ignored, out-of-range
 * numbers are clamped to the knob's range), every change is saved, and the reset key, which
 * is only enabled when something differs from the defaults, puts everything back and
 * forgets the saved copy. `knobs` overrides knob ranges, e.g. { beam: { max: 100000 } }.
 *
 * Auto persist never touches the persist knob itself: the knob keeps your value (and that
 * is what's saved), while a red marker and readout show what's actually in use.
 */
export function bindPanel(display, { storageKey, knobs: overrides = {} }) {
  const defs = {};
  for (const [name, def] of Object.entries(DISPLAY_KNOBS)) defs[name] = { ...def, ...overrides[name] };
  const knobProps = Object.values(defs).map((d) => d.prop);

  const defaults = { color: display.color, refresh: display.refresh, autoPersist: false };
  for (const p of knobProps) defaults[p] = display[p];
  const settings = { ...defaults };

  const saved = readSettings(storageKey);
  if (PHOSPHORS.includes(saved.color)) settings.color = saved.color;
  if (saved.refresh === 'beam' || saved.refresh === 'continuous') settings.refresh = saved.refresh;
  if (typeof saved.autoPersist === 'boolean') settings.autoPersist = saved.autoPersist;
  for (const d of Object.values(defs)) {
    const v = saved[d.prop];
    if (typeof v === 'number' && Number.isFinite(v)) settings[d.prop] = clamp(v, d.min, d.max);
  }

  const resetKey = document.querySelector('[data-action="reset-display"]');
  const same = (a, b) => (typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) : a === b);
  let ready = false;
  const save = () => {
    if (!ready) return;
    const changed = Object.keys(defaults).some((p) => !same(settings[p], defaults[p]));
    writeSettings(storageKey, changed ? settings : null);
    if (resetKey) resetKey.disabled = !changed;
  };

  // Phosphor keys.
  const phosphorKeys = document.querySelectorAll('[data-set-phosphor]');
  const setPhosphor = (color) => {
    settings.color = display.color = color;
    document.documentElement.dataset.phosphor = color;
    phosphorKeys.forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.setPhosphor === color)));
    save();
  };
  phosphorKeys.forEach((k) => k.addEventListener('click', () => setPhosphor(k.dataset.setPhosphor)));

  // Knobs. Double-click returns a knob to the page default, not to whatever was restored.
  // Persistence goes through the auto-persist loop below rather than straight to the display.
  const knobs = {};
  for (const [name, { prop, ...opts }] of Object.entries(defs)) {
    if (prop !== 'persistence') display[prop] = settings[prop];
    const el = document.querySelector(`[data-knob="${name}"]`);
    if (!el) continue;
    knobs[name] = createKnob(el, {
      ...opts,
      value: settings[prop],
      reset: defaults[prop],
      onChange: (v) => {
        settings[prop] = v;
        if (prop !== 'persistence') display[prop] = v;
        save();
      },
    });
  }

  // Refresh toggles.
  const redrawKey = document.querySelector('[data-toggle="redraw"]');
  const autoKey = document.querySelector('[data-toggle="autoPersist"]');
  const syncToggles = () => {
    display.refresh = settings.refresh;
    redrawKey?.setAttribute('aria-pressed', String(settings.refresh === 'beam'));
    autoKey?.setAttribute('aria-pressed', String(settings.autoPersist));
    if (autoKey) autoKey.disabled = settings.refresh !== 'beam';
  };
  redrawKey?.addEventListener('click', () => {
    settings.refresh = settings.refresh === 'beam' ? 'continuous' : 'beam';
    syncToggles();
    updatePersistence(0);
    save();
  });
  autoKey?.addEventListener('click', () => {
    settings.autoPersist = !settings.autoPersist;
    syncToggles();
    updatePersistence(0);
    save();
  });

  // Auto persist: in fade & redraw, a line is visited once per cycle, so a persistence of at
  // least one cycle keeps everything above ~37% brightness. Rise quickly so nothing fades
  // while it catches up; settle back gently when the screen gets lighter.
  const cycleOut = document.querySelector('[data-readout="cycle"]');
  let effective = settings.persistence;
  let shownCycle = '';
  const updatePersistence = (dt) => {
    const auto = settings.autoPersist && settings.refresh === 'beam';
    const cycle = display.cycleTime;
    if (auto) {
      const target = Math.max(settings.persistence, Math.min(defs.persistence.max, cycle));
      effective += (target - effective) * (1 - Math.exp(-dt * (target > effective ? 8 : 2)));
      if (Math.abs(target - effective) < 1e-4) effective = target;
    } else effective = settings.persistence;
    display.persistence = effective;
    knobs.persistence?.setMarker(auto && effective > settings.persistence * 1.005 ? effective : null);
    if (cycleOut) {
      const text = settings.refresh === 'beam' ? DISPLAY_KNOBS.persistence.format(cycle) : 'free';
      if (text !== shownCycle) cycleOut.textContent = shownCycle = text;
    }
  };
  display.onFrame(updatePersistence);

  const reset = () => {
    Object.assign(settings, defaults);
    setPhosphor(settings.color);
    for (const [name, knob] of Object.entries(knobs)) knob.set(defaults[defs[name].prop]);
    syncToggles();
    updatePersistence(0);
    save();
  };
  resetKey?.addEventListener('click', reset);

  setPhosphor(settings.color);
  syncToggles();
  updatePersistence(0);
  ready = true;
  save();
  return { setPhosphor, knobs, reset, settings };
}

export function createKnob(root, { min, max, value, reset = value, log = false, format = (v) => v.toFixed(2), onChange }) {
  const dial = root.querySelector('.knob__dial');
  const out = root.querySelector('.knob__value');
  const toNorm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromNorm = (n) => (log ? min * Math.pow(max / min, n) : min + n * (max - min));
  let n = toNorm(value);
  let marker = null;
  let markerValue = null;
  const angle = (norm) => `${-SWEEP / 2 + clamp(norm, 0, 1) * SWEEP}deg`;

  dial.setAttribute('role', 'slider');
  dial.tabIndex = 0;
  dial.setAttribute('aria-valuemin', String(min));
  dial.setAttribute('aria-valuemax', String(max));

  function set(next, emit = true) {
    n = clamp(next, 0, 1);
    const v = fromNorm(n);
    dial.style.setProperty('--turn', angle(n));
    dial.setAttribute('aria-valuenow', String(+v.toPrecision(4)));
    describe();
    if (emit) onChange(v);
  }

  function describe() {
    const own = format(fromNorm(n));
    out.textContent = markerValue == null ? own : format(markerValue);
    dial.setAttribute('aria-valuetext', markerValue == null ? own : `${own}, overridden to ${format(markerValue)}`);
  }

  /** Show (or with null, hide) a red marker for a value in effect other than the knob's own. */
  function setMarker(v) {
    const next = v == null ? null : +v.toPrecision(3);
    if (next === markerValue) return;
    markerValue = next;
    if (next != null && !marker) {
      marker = document.createElement('span');
      marker.className = 'knob__marker';
      marker.setAttribute('aria-hidden', 'true');
      dial.append(marker);
    }
    if (next != null) marker.style.setProperty('--mark', angle(toNorm(next)));
    root.classList.toggle('has-marker', next != null);
    describe();
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
  return { set: (v) => set(toNorm(v)), get: () => fromNorm(n), setMarker };
}
