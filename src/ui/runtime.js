// UI runtime: mounts a view function onto a VectorDisplay.
//
//   const app = mount(display, () => ui`text "hello"`);
//
// Every render lays the tree out, paints it into draw items and reconciles them with
// the shapes already on the tube:
//   same key, same sig     -> the shape stays (and slides if it moved); no re-trace
//   new key or changed sig -> the old shape fades out and the beam traces the new one
// Content that scrolls into view is held back until the scroll comes to rest, so the
// beam paints the newly revealed area top-down instead of chasing the scroll edge
// (pair this with the display's `order: 'scan'`).
// Event handlers (on:click, on:input, on:submit) run, then the view re-renders on the
// next frame. Call app.invalidate() after changing state from anywhere else.

import { UINode } from './dsl.js';
import { build, measure, place } from './layout.js';
import { paint } from './paint.js';

const DEFAULT_STYLE = { color: null, intensity: 1, size: 12, spacing: 1, lineHeight: 1.6 };
const CARET_BLINK = 0.53;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const contains = (r, [x, y]) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function mount(display, view, options) {
  return new UIRuntime(display, view, options);
}

export class UIRuntime {
  constructor(display, view, { style } = {}) {
    this.display = display;
    this.view = view;
    this.canvas = display.canvas;
    this.style = { ...DEFAULT_STYLE, ...style };
    this.entries = new Map();
    this.scrollStates = new Map();
    this.values = new Map();
    this._live = new Map(); // edits made since the last render, so fast typing never reads stale props
    this.hover = null;
    this.focus = null;
    this.focusVisible = false;
    this.caretOn = true;
    this.pointer = null;
    this.hits = [];
    this.focusables = [];
    this.scrolls = [];
    this._caretClock = 0;
    this._press = null;
    this._dirty = false;
    this._off = [];
    if (!this.canvas.hasAttribute('tabindex')) this.canvas.tabIndex = 0;
    this._kbd = hiddenInput();
    this._bind();
    this._off.push(display.onFrame((dt) => this._tick(dt)));
    this._render();
  }

  /** Re-render on the next frame. */
  invalidate() {
    this._dirty = true;
  }

  destroy() {
    this._off.forEach((off) => off());
    this._kbd.remove();
    for (const e of this.entries.values()) e.shape.remove();
    this.entries.clear();
  }

  // -- hooks used by layout and paint ----------------------------------------

  scrollState(key) {
    let st = this.scrollStates.get(key);
    if (!st) {
      st = { y: 0, target: 0, max: 0, view: 0, content: 0 };
      this.scrollStates.set(key, st);
    }
    this._seenScrolls.add(key);
    return st;
  }

  inputValue(L) {
    if (this._live.has(L.key)) return this._live.get(L.key);
    if (typeof L.props['on:input'] === 'function' && L.props.value != null) return String(L.props.value);
    return this.values.get(L.key) ?? String(L.props.value ?? '');
  }

  // -- rendering -------------------------------------------------------------

  _tick(dt) {
    for (const st of this.scrollStates.values()) {
      if (st.y === st.target) continue;
      st.y += (st.target - st.y) * (1 - Math.exp(-dt * 14));
      if (Math.abs(st.target - st.y) < 0.3) st.y = st.target;
      this._dirty = true;
    }
    if (this._focused()?.type === 'input') {
      this._caretClock += dt;
      if (this._caretClock >= CARET_BLINK) {
        this._caretClock = 0;
        this.caretOn = !this.caretOn;
        this._dirty = true;
      }
    }
    if (this._dirty) this._render();
  }

  _render() {
    this._dirty = false;
    this._live.clear();
    const out = this.view();
    const top = out instanceof UINode ? out : new UINode('column', null, {}, [out]);
    const root = build(top, this.style, 'root');
    const { width, height } = this.display;
    root.fixedW = width;
    root.fixedH = height;
    this._seenScrolls = new Set();
    measure(root, width);
    place(root, 0, 0, width, height, this);

    const ctx = { items: [], hits: [], focusables: [], scrolls: [], clip: null, owner: null, boost: 1, rt: this };
    paint(root, ctx);
    this.hits = ctx.hits;
    this.focusables = ctx.focusables;
    this.scrolls = ctx.scrolls;
    for (const key of this.scrollStates.keys()) if (!this._seenScrolls.has(key)) this.scrollStates.delete(key);
    this._reconcile(ctx.items);

    if (this.focus && !this.focusables.some((f) => f.L.key === this.focus)) this._setFocus(null);
    // `autofocus` takes focus once, when its element first appears.
    const auto = this.focusables.filter((f) => f.L.props.autofocus).map((f) => f.L.key);
    const fresh = auto.find((key) => !this._autofocused?.has(key));
    if (fresh) this._setFocus(fresh);
    this._autofocused = new Set(auto);
    if (this.pointer && !this._press) {
      const hit = this._hitAt(this.pointer);
      this._setHover(hit?.L.key ?? null);
      this._cursor(hit);
    }
  }

  _reconcile(items) {
    const next = new Map();
    for (const it of items) {
      let { key } = it;
      if (next.has(key)) {
        let n = 2;
        while (next.has(`${key}~${n}`)) n++;
        key = `${key}~${n}`;
      }
      let e = this.entries.get(key);
      if (e?.shape.state === 'removed') e = null;
      const moving = it.scroll && (it.scroll.y !== it.scroll.target || it.scroll.dragging);
      if (moving) {
        // Something sliding out from under the viewport edge would otherwise appear
        // untraced; retire it and let it be traced, in order, once the scroll settles.
        if (e && it.vis > e.vis + 0.5) {
          e.shape.remove();
          e = null;
        }
        if (!e) continue;
      }
      if (e && e.sig === it.sig) {
        if (it.abs) {
          const clipKey = `${it.x},${it.y}`;
          if (!e.clipped || e.clipKey !== clipKey) {
            e.shape.update(it.abs);
            e.shape.offsetX = e.shape.offsetY = 0;
            e.clipped = true;
            e.clipKey = clipKey;
          }
        } else {
          if (e.clipped) {
            e.shape.update(it.strokes);
            e.clipped = false;
          }
          e.shape.offsetX = it.x;
          e.shape.offsetY = it.y;
        }
        e.vis = it.vis;
        if (it.priority) this.display.prioritize(e.shape);
      } else {
        e?.shape.remove();
        const shape = this.display.shape(it.abs ?? it.strokes, { priority: it.priority });
        if (!it.abs) {
          shape.offsetX = it.x;
          shape.offsetY = it.y;
        }
        e = { shape, sig: it.sig, clipped: !!it.abs, clipKey: `${it.x},${it.y}`, vis: it.vis };
      }
      e.shape.intensity = it.intensity;
      e.shape.color = it.color ?? null;
      next.set(key, e);
    }
    for (const [key, e] of this.entries) if (!next.has(key)) e.shape.remove();
    this.entries = next;
  }

  // -- input -----------------------------------------------------------------

  _bind() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._off.push(() => target.removeEventListener(type, fn, opts));
    };
    const c = this.canvas;
    on(c, 'pointermove', (e) => this._move(e));
    on(c, 'pointerdown', (e) => this._down(e));
    on(c, 'pointerup', (e) => this._up(e));
    on(c, 'pointercancel', () => this._endPress());
    on(c, 'pointerleave', () => {
      if (this._press) return;
      this.pointer = null;
      this._setHover(null);
    });
    on(c, 'wheel', (e) => this._wheel(e), { passive: false });
    on(window, 'keydown', (e) => this._key(e));
    // Soft keyboards don't send usable keydowns; take whatever lands in the hidden input.
    on(this._kbd, 'input', () => {
      const L = this._focused();
      if (L?.type === 'input' && this._kbd.value) this._edit(L, this.inputValue(L) + this._kbd.value);
      this._kbd.value = '';
    });
  }

  _point(e) {
    return this.display.clientToDisplay(e.clientX, e.clientY);
  }

  _hitAt(p) {
    for (let i = this.hits.length - 1; i >= 0; i--) if (contains(this.hits[i].rect, p)) return this.hits[i];
    return null;
  }

  _scrollAt(p) {
    for (let i = this.scrolls.length - 1; i >= 0; i--) if (contains(this.scrolls[i].rect, p)) return this.scrolls[i];
    return null;
  }

  _focused() {
    return this.focus ? (this.focusables.find((f) => f.L.key === this.focus)?.L ?? null) : null;
  }

  _setHover(key) {
    if (key === this.hover) return;
    this.hover = key;
    this.invalidate();
  }

  _cursor(hit) {
    this.canvas.style.cursor = hit ? (hit.L.type === 'input' ? 'text' : 'pointer') : '';
  }

  _setFocus(key, visible = false) {
    this.focus = key;
    this.focusVisible = visible;
    const L = this._focused();
    if (L?.type === 'input') {
      this.caretOn = true;
      this._caretClock = 0;
      this._kbd.focus({ preventScroll: true });
    } else if (document.activeElement === this._kbd) this.canvas.focus({ preventScroll: true });
    this.invalidate();
  }

  _move(e) {
    const p = this._point(e);
    this.pointer = p;
    const press = this._press;
    if (press?.scroll) {
      const dy = press.p[1] - p[1];
      if (!press.dragging && Math.abs(dy) > 6) press.dragging = true;
      if (press.dragging) {
        const st = press.scroll.state;
        st.dragging = true;
        st.target = st.y = clamp(press.start + dy, 0, st.max);
        this.invalidate();
        return;
      }
    }
    const hit = this._hitAt(p);
    this._setHover(hit?.L.key ?? null);
    this._cursor(hit);
  }

  _down(e) {
    if (e.button !== 0) return;
    const p = this._point(e);
    this.pointer = p;
    const hit = this._hitAt(p);
    this._press = { key: hit?.L.key ?? null, p, dragging: false, scroll: null, start: 0 };
    if (e.pointerType !== 'mouse') {
      const sc = this._scrollAt(p);
      if (sc) Object.assign(this._press, { scroll: sc, start: sc.state.target });
      this.canvas.setPointerCapture?.(e.pointerId);
    }
    if (hit?.L.type !== 'input') this.canvas.focus({ preventScroll: true });
    this._setHover(hit?.L.key ?? null);
  }

  /** Ends a press; a drag-scroll that was holding back new content releases it. */
  _endPress() {
    const press = this._press;
    this._press = null;
    if (press?.scroll?.state.dragging) {
      press.scroll.state.dragging = false;
      this.invalidate();
    }
    return press;
  }

  _up(e) {
    const press = this._endPress();
    if (e.pointerType !== 'mouse') {
      this.pointer = null;
      this._setHover(null);
    }
    if (!press || press.dragging) return;
    const hit = this._hitAt(this._point(e));
    if (hit && hit.L.key === press.key) this._activate(hit.L);
    else if (!hit) this._setFocus(null);
  }

  _activate(L, fromKeyboard = false) {
    if (L.type === 'input') {
      this._setFocus(L.key, fromKeyboard);
      return;
    }
    if (!fromKeyboard) this._setFocus(null);
    const fn = L.props['on:click'];
    if (typeof fn === 'function') fn(L);
    else if (L.props.href != null) {
      const href = String(L.props.href);
      if (href.startsWith('#')) location.hash = href;
      else window.open(href, '_blank', 'noopener');
    }
    this.invalidate();
  }

  _edit(L, value) {
    this._live.set(L.key, value);
    const fn = L.props['on:input'];
    if (typeof fn === 'function') fn(value, L);
    else this.values.set(L.key, value);
    this.caretOn = true;
    this._caretClock = 0;
    this.invalidate();
  }

  _wheel(e) {
    const sc = this._scrollAt(this._point(e));
    if (!sc || sc.state.max <= 0) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.rect.h : 1;
    const scale = this.display.height / this.canvas.getBoundingClientRect().height;
    this._scrollTo(sc.state, sc.state.target + e.deltaY * unit * scale);
  }

  _scrollTo(st, y) {
    st.target = clamp(y, 0, st.max);
    this.invalidate();
  }

  /** Tab order is paint order. Returns false at either end so focus can leave the canvas. */
  _moveFocus(dir) {
    const list = this.focusables;
    const i = list.findIndex((f) => f.L.key === this.focus);
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (next < 0 || next >= list.length) {
      this._setFocus(null);
      return false;
    }
    const f = list[next];
    this._setFocus(f.L.key, true);
    if (f.owner) {
      const { state: st, inner } = f.owner;
      const r = f.L.rect;
      if (r.y < inner.y) this._scrollTo(st, st.y - (inner.y - r.y) - 16);
      else if (r.y + r.h > inner.y + inner.h) this._scrollTo(st, st.y + (r.y + r.h - inner.y - inner.h) + 16);
    }
    return true;
  }

  _key(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const ours = t === this.canvas || t === this._kbd;
    if (!ours && t !== document.body && t !== document.documentElement) return;

    const L = this._focused();
    if (L?.type === 'input') {
      const v = this.inputValue(L);
      if (e.key === 'Enter') {
        const fn = L.props['on:submit'];
        if (typeof fn === 'function') fn(v, L);
        this.invalidate();
      } else if (e.key === 'Backspace') this._edit(L, v.slice(0, -1));
      else if (e.key === 'Escape') this._setFocus(null);
      else if (e.key === 'Tab') {
        if (!this._moveFocus(e.shiftKey ? -1 : 1)) return;
      } else if (e.key.length === 1) this._edit(L, v + e.key);
      else return;
      e.preventDefault();
      return;
    }

    const sc = (this.pointer && this._scrollAt(this.pointer)) || this.scrolls[0];
    const page = sc ? sc.rect.h * 0.85 : 0;
    switch (e.key) {
      case 'Tab':
        if (!ours || !this._moveFocus(e.shiftKey ? -1 : 1)) return;
        break;
      case 'Enter':
        if (!L) return;
        this._activate(L, true);
        break;
      case ' ':
        if (L) this._activate(L, true);
        else if (sc) this._scrollTo(sc.state, sc.state.target + (e.shiftKey ? -page : page));
        else return;
        break;
      case 'Escape':
        if (!this.focus) return;
        this._setFocus(null);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'PageDown':
      case 'PageUp':
      case 'Home':
      case 'End': {
        if (!sc) return;
        const st = sc.state;
        const step = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page }[e.key];
        this._scrollTo(st, e.key === 'Home' ? 0 : e.key === 'End' ? st.max : st.target + step);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }
}

function hiddenInput() {
  const el = document.createElement('input');
  el.type = 'text';
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.tabIndex = -1;
  el.setAttribute('autocapitalize', 'off');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    fontSize: '16px',
  });
  document.body.append(el);
  return el;
}
