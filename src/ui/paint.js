// Paint: laid-out nodes -> draw items.
//
// A draw item is a little bundle of strokes in local coordinates plus a position:
//   { key, sig, strokes, x, y, intensity, color, abs }
// `key` identifies it across renders and `sig` summarises its geometry. The runtime
// uses them to decide whether to keep a shape, slide it, or have the beam re-trace it.
// Items that straddle a scroll viewport carry pre-clipped absolute strokes in `abs`.

import { textStrokes } from '../vector-font.js';
import { SCROLLBAR, isLeaf, textMetrics } from './layout.js';

const HOVER_BOOST = 1.45;

// ---------------------------------------------------------------------------
// Icons, on a unit square (y down).

const ring = (cx, cy, r, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
const starPoints = Array.from({ length: 11 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 0.2 : 0.48;
  return [0.5 + Math.cos(a) * r, 0.53 + Math.sin(a) * r];
});

export const ICONS = {
  upvote: [[[0.5, 0.12], [0.95, 0.88], [0.05, 0.88], [0.5, 0.12]]],
  downvote: [[[0.5, 0.88], [0.05, 0.12], [0.95, 0.12], [0.5, 0.88]]],
  'chevron-right': [[[0.3, 0.1], [0.75, 0.5], [0.3, 0.9]]],
  'chevron-left': [[[0.7, 0.1], [0.25, 0.5], [0.7, 0.9]]],
  'chevron-up': [[[0.1, 0.7], [0.5, 0.25], [0.9, 0.7]]],
  'chevron-down': [[[0.1, 0.3], [0.5, 0.75], [0.9, 0.3]]],
  'arrow-right': [[[0.05, 0.5], [0.95, 0.5]], [[0.6, 0.15], [0.95, 0.5], [0.6, 0.85]]],
  'arrow-left': [[[0.95, 0.5], [0.05, 0.5]], [[0.4, 0.15], [0.05, 0.5], [0.4, 0.85]]],
  close: [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]],
  plus: [[[0.5, 0.1], [0.5, 0.9]], [[0.1, 0.5], [0.9, 0.5]]],
  minus: [[[0.1, 0.5], [0.9, 0.5]]],
  check: [[[0.08, 0.55], [0.38, 0.85], [0.92, 0.15]]],
  menu: [[[0.1, 0.2], [0.9, 0.2]], [[0.9, 0.5], [0.1, 0.5]], [[0.1, 0.8], [0.9, 0.8]]],
  search: [ring(0.42, 0.42, 0.3), [[0.64, 0.64], [0.94, 0.94]]],
  circle: [ring(0.5, 0.5, 0.45, 24)],
  star: [starPoints],
  external: [[[0.55, 0.1], [0.9, 0.1], [0.9, 0.45]], [[0.9, 0.1], [0.45, 0.55]], [[0.4, 0.2], [0.1, 0.2], [0.1, 0.9], [0.8, 0.9], [0.8, 0.6]]],
  dot: [[[0.5, 0.5]]],
};

// ---------------------------------------------------------------------------
// Geometry helpers

const glyphCache = new Map();
function glyphs(line, style, bold) {
  const key = `${style.size}|${style.spacing}|${bold ? 'b' : ''}|${line}`;
  let strokes = glyphCache.get(key);
  if (!strokes) {
    strokes = textStrokes(line, 0, 0, { size: style.size, spacing: style.spacing });
    if (bold) {
      // A second, slightly offset pass right after each stroke reads as a heavier weight.
      const o = Math.max(0.45, style.size * 0.055);
      strokes = strokes.flatMap((st) => [st, st.map(([x, y]) => [x + o, y + o * 0.35])]);
    }
    if (glyphCache.size > 8000) glyphCache.clear();
    glyphCache.set(key, strokes);
  }
  return { strokes, key };
}

function rectPath(w, h, c) {
  c = Math.max(0, Math.min(c, w / 2, h / 2));
  if (!c) return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
  return [[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c], [c, 0]];
}

function dashes(path, on = 5, off = 4) {
  const out = [];
  let cur = null;
  let phase = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let t = 0;
    while (t < len) {
      const drawing = phase < on;
      const step = Math.min(len - t, drawing ? on - phase : on + off - phase);
      const p0 = [ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len];
      const p1 = [ax + ((bx - ax) * (t + step)) / len, ay + ((by - ay) * (t + step)) / len];
      if (drawing) {
        if (!cur) cur = [p0];
        cur.push(p1);
      } else if (cur) {
        out.push(cur);
        cur = null;
      }
      t += step;
      phase = (phase + step) % (on + off);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function clipSegment(ax, ay, bx, by, c) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - c.x, c.x + c.w - ax, ay - c.y, c.y + c.h - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy, t0 === 0, t1 === 1];
}

/** Clip local strokes (offset by ox, oy) to rect c; returns absolute strokes. */
function clipStrokes(strokes, ox, oy, c) {
  const out = [];
  for (const st of strokes) {
    if (st.length === 1) {
      const x = st[0][0] + ox;
      const y = st[0][1] + oy;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) out.push([[x, y]]);
      continue;
    }
    let cur = null;
    for (let i = 0; i < st.length - 1; i++) {
      const seg = clipSegment(st[i][0] + ox, st[i][1] + oy, st[i + 1][0] + ox, st[i + 1][1] + oy, c);
      if (!seg) {
        if (cur) out.push(cur);
        cur = null;
        continue;
      }
      const [sx, sy, ex, ey, startsInside, endsInside] = seg;
      if (cur && startsInside) cur.push([ex, ey]);
      else {
        if (cur) out.push(cur);
        cur = [[sx, sy], [ex, ey]];
      }
      if (!endsInside) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

const intersect = (a, b) => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
};
const overlaps = (r, c) => r.x <= c.x + c.w && r.x + r.w >= c.x && r.y <= c.y + c.h && r.y + r.h >= c.y;
const cut = (segs, a, b) =>
  segs.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a]] : []), ...(b < e ? [[b, e]] : [])]));
const f1 = (v) => v.toFixed(1);

export const isInteractive = (L) =>
  L.type === 'link' || L.type === 'button' || L.type === 'input' || typeof L.props['on:click'] === 'function' || L.props.href != null;

// ---------------------------------------------------------------------------

function emit(ctx, L, part, sig, strokes, x, y, bbox, intensity, color = L.style.color) {
  const priority = ctx.rt.hover === L.key || ctx.rt.focus === L.key;
  const item = {
    key: `${L.key}|${part}`,
    sig,
    strokes,
    x,
    y,
    intensity: intensity * ctx.boost,
    color,
    priority,
    scroll: ctx.owner?.state ?? null,
    abs: null,
    vis: bbox[3] - bbox[1], // visible height, so the runtime can tell when a clipped item grows
  };
  const c = ctx.clip;
  if (c) {
    const x0 = x + bbox[0];
    const y0 = y + bbox[1];
    const x1 = x + bbox[2];
    const y1 = y + bbox[3];
    if (x1 < c.x || y1 < c.y || x0 > c.x + c.w || y0 > c.y + c.h) return;
    if (x0 < c.x || y0 < c.y || x1 > c.x + c.w || y1 > c.y + c.h) {
      item.abs = clipStrokes(strokes, x, y, c);
      if (!item.abs.length) return;
      item.vis = Math.min(y1, c.y + c.h) - Math.max(y0, c.y);
    }
  }
  ctx.items.push(item);
}

function paintLines(ctx, L, part, lines, x, y, w, align, intensity, underline) {
  const { style } = L;
  const tm = textMetrics(style);
  const bold = !!L.props.bold;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const lw = tm.width(line.length);
    const lx = x + (align === 'center' ? (w - lw) / 2 : align === 'right' ? w - lw : 0);
    const ly = y + i * style.size * style.lineHeight;
    const g = glyphs(line, style, bold);
    emit(ctx, L, `${part}${i}`, `t|${g.key}`, g.strokes, lx, ly, [-1, -style.size * 0.15, lw + 1, style.size * 1.25], intensity);
    if (underline) {
      const uy = ly + style.size + Math.max(2, style.size * 0.3);
      emit(ctx, L, `u${i}`, `u|${f1(lw)}`, [[[0, 0], [lw, 0]]], lx, uy, [0, -1, lw, 1], intensity * 0.8);
    }
  });
}

function paintBorder(ctx, L, mode, intensity, chamfer = +(L.props.chamfer ?? 0)) {
  const { w, h } = L.rect;
  const path = rectPath(w, h, chamfer);
  const strokes = mode === 'dashed' ? dashes(path) : [path];
  emit(ctx, L, 'border', `b|${f1(w)}|${f1(h)}|${chamfer}|${mode}`, strokes, L.rect.x, L.rect.y, [0, 0, w, h], intensity);
}

/** Hatched fill that leaves a margin around the content inside it. */
function paintFill(ctx, L, intensity) {
  const r = L.rect;
  const sp = Math.max(1.5, +(L.props.hatch ?? 3));
  const holes = [];
  const collect = (n) => {
    for (const k of n.kids) {
      if (!k.rect) continue;
      if (isLeaf(k.type) || (k.props.border ?? k.border)) {
        const { x, y, w, h } = k.rect;
        holes.push([x - r.x - 3, y - r.y - 2.5, x - r.x + w + 3, y - r.y + h + 2.5]);
      } else collect(k);
    }
  };
  collect(L);
  const strokes = [];
  let row = 0;
  for (let y = sp / 2; y < r.h; y += sp, row++) {
    let segs = [[0, r.w]];
    for (const [x0, y0, x1, y1] of holes) if (y >= y0 && y <= y1) segs = cut(segs, x0, x1);
    // Alternate direction like a raster so the beam doesn't fly back each line.
    if (row % 2) segs.reverse();
    for (const [a, b] of segs) if (b - a > 1) strokes.push(row % 2 ? [[b, y], [a, y]] : [[a, y], [b, y]]);
  }
  const sig = `f|${f1(r.w)}|${f1(r.h)}|${sp}|${holes.map((hl) => hl.map((v) => v.toFixed(0)).join(',')).join(';')}`;
  emit(ctx, L, 'fill', sig, strokes, r.x, r.y, [0, 0, r.w, r.h], intensity * +(L.props.fillIntensity ?? 0.3));
}

function paintFocus(ctx, L, intensity) {
  const { x, y, w, h } = L.rect;
  const e = 3;
  const a = Math.min(7, w / 3 + e, h / 3 + e);
  const [x0, y0, x1, y1] = [-e, -e, w + e, h + e];
  const strokes = [
    [[x0, y0 + a], [x0, y0], [x0 + a, y0]],
    [[x1 - a, y0], [x1, y0], [x1, y0 + a]],
    [[x1, y1 - a], [x1, y1], [x1 - a, y1]],
    [[x0 + a, y1], [x0, y1], [x0, y1 - a]],
  ];
  emit(ctx, L, 'focus', `fr|${f1(w)}|${f1(h)}`, strokes, x, y, [x0, y0, x1, y1], intensity);
}

function collectFocusables(L, ctx) {
  if (isInteractive(L)) ctx.focusables.push({ L, owner: ctx.owner });
  for (const k of L.kids) collectFocusables(k, ctx);
}

// ---------------------------------------------------------------------------

/**
 * ctx: { items, hits, focusables, scrolls, clip, owner, boost, rt }
 * rt provides hover, focus, focusVisible, caretOn and inputValue(L).
 */
export function paint(L, ctx) {
  const r = L.rect;
  if (!r) return;
  if (ctx.clip && !overlaps(r, ctx.clip)) {
    collectFocusables(L, ctx);
    return;
  }
  const { rt } = ctx;
  const interactive = isInteractive(L);
  const hovered = interactive && rt.hover === L.key;
  const focused = rt.focus === L.key;
  const boost = ctx.boost;
  if (hovered) ctx.boost *= HOVER_BOOST;
  const { style, pad } = L;
  const I = style.intensity;

  // Pre-order, so children land after (and win hit tests over) their parents.
  if (interactive) {
    ctx.focusables.push({ L, owner: ctx.owner });
    ctx.hits.push({ L, rect: ctx.clip ? intersect(r, ctx.clip) : r });
  }

  if (L.props.fill) paintFill(ctx, L, I);
  const border = L.props.border ?? L.border;
  if (border && L.type !== 'button' && L.type !== 'input') paintBorder(ctx, L, border === 'dashed' ? 'dashed' : 'solid', I);

  switch (L.type) {
    case 'text':
    case 'link': {
      const underline = !!L.props.underline || (L.type === 'link' && (hovered || (focused && rt.focusVisible)));
      paintLines(ctx, L, 't', L.lines, r.x + pad.l, r.y + pad.t, r.w - pad.l - pad.r, L.props.align ?? 'left', I, underline);
      break;
    }
    case 'button': {
      paintBorder(ctx, L, L.props.border === 'dashed' ? 'dashed' : 'solid', I * 0.85, +(L.props.chamfer ?? 3));
      const textH = style.size + (L.lines.length - 1) * style.size * style.lineHeight;
      const ty = r.y + (r.h - textH) / 2;
      paintLines(ctx, L, 't', L.lines, r.x + pad.l, ty, r.w - pad.l - pad.r, 'center', I, false);
      break;
    }
    case 'input': {
      const active = focused;
      paintBorder(ctx, L, 'solid', I * (active ? 1.25 : 0.7), +(L.props.chamfer ?? 0));
      const tm = textMetrics(style);
      const innerW = r.w - pad.l - pad.r;
      const fits = Math.max(1, Math.floor((innerW - 3 + tm.advance - tm.width(1)) / tm.advance));
      const value = rt.inputValue(L);
      const shown = L.props.password ? '*'.repeat(value.length) : value;
      const first = Math.max(0, shown.length - fits);
      const visible = shown.slice(first);
      const ty = r.y + (r.h - style.size) / 2;
      // One item per character, keyed by its index in the value: typing traces just the
      // new glyph, and when the field scrolls the rest slide instead of re-tracing.
      for (let i = 0; i < visible.length; i++) {
        const ch = visible[i];
        if (ch === ' ') continue;
        const g = glyphs(ch, style, false);
        emit(ctx, L, `c${first + i}`, `t|${g.key}`, g.strokes, r.x + pad.l + i * tm.advance, ty, [-1, -2, tm.advance, style.size + 2], I);
      }
      if (!visible && L.props.placeholder && !active) {
        paintLines(ctx, L, 'p', [String(L.props.placeholder)], r.x + pad.l, ty, innerW, 'left', I * 0.4, false);
      }
      if (active && rt.caretOn) {
        const cx = r.x + pad.l + tm.width(visible.length) + (visible ? tm.advance - tm.width(1) : 0) + 0.5;
        emit(ctx, L, 'caret', `c|${style.size}`, [[[0, -2], [0, style.size + 2]]], cx, ty, [-1, -2, 1, style.size + 2], I * 1.2);
      }
      break;
    }
    case 'icon': {
      const s = +(L.props.size ?? style.size);
      const def = ICONS[L.content] ?? [rectPath(1, 1, 0)];
      const strokes = def.map((st) => st.map(([px, py]) => [px * s, py * s]));
      emit(ctx, L, 'i', `i|${L.content}|${s}`, strokes, r.x + pad.l, r.y + pad.t, [0, 0, s, s], I);
      break;
    }
    case 'divider':
      if (L.axis === 'row') {
        const len = r.h - pad.t - pad.b;
        emit(ctx, L, 'd', `d|v|${f1(len)}`, [[[0, 0], [0, len]]], r.x + pad.l + 0.5, r.y + pad.t, [-1, 0, 1, len], I);
      } else {
        const len = r.w - pad.l - pad.r;
        emit(ctx, L, 'd', `d|h|${f1(len)}`, [[[0, 0], [len, 0]]], r.x + pad.l, r.y + pad.t + 0.5, [0, -1, len, 1], I);
      }
      break;
    case 'scroll': {
      const { inner, scroll: st } = L;
      const clip = ctx.clip ? intersect(ctx.clip, inner) : { ...inner };
      ctx.scrolls.push({ key: L.key, rect: clip, state: st });
      const saved = [ctx.clip, ctx.owner];
      ctx.clip = clip;
      ctx.owner = { state: st, inner };
      for (const k of L.kids) paint(k, ctx);
      [ctx.clip, ctx.owner] = saved;
      if (st.max > 0.5) {
        const x = inner.x + inner.w - SCROLLBAR / 2;
        emit(ctx, L, 'track', `sbt|${f1(inner.h)}`, [[[0, 0], [0, inner.h]]], x, inner.y, [-1, 0, 1, inner.h], I * 0.18);
        const len = Math.max(24, (inner.h * inner.h) / st.content);
        const pos = (st.y / st.max) * (inner.h - len);
        const thumb = [[[-1.5, 0], [-1.5, len]], [[1.5, len], [1.5, 0]]];
        emit(ctx, L, 'thumb', `sbh|${f1(len)}`, thumb, x, inner.y + pos, [-2, 0, 2, len], I * 0.7);
      }
      break;
    }
    default:
      for (const k of L.kids) paint(k, ctx);
  }

  if (focused && rt.focusVisible && L.type !== 'input') paintFocus(ctx, L, I);
  ctx.boost = boost;
}
