// Rotary knob: drag vertically, scroll, or use arrow keys. Double-click resets.

const SWEEP = 270;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createKnob(root, { min, max, value, log = false, format = (v) => v.toFixed(2), onChange }) {
  const dial = root.querySelector('.knob__dial');
  const out = root.querySelector('.knob__value');
  const toNorm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromNorm = (n) => (log ? min * Math.pow(max / min, n) : min + n * (max - min));
  const initial = toNorm(value);
  let n = initial;

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
  dial.addEventListener('dblclick', () => set(initial));
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
