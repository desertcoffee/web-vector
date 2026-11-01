// Layout for ui nodes: a small flexbox.
//
// build()   turns a UINode tree into layout nodes: flattens fragments, assigns stable keys
//           (explicit `key` props win over position) and resolves inherited style
//           (color, intensity, size, spacing, lineHeight).
// measure() computes intrinsic size for an available width; text wraps here.
// place()   assigns final rects, distributing free space to `grow` children.

import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, normalizeText } from '../vector-font.js';
import { UINode } from './dsl.js';

export const SCROLLBAR = 10; // gutter reserved on the right of a scroll container

const isLeaf = (type) => type === 'text' || type === 'link' || type === 'button' || type === 'input' || type === 'icon';

export function textMetrics(style) {
  const s = style.size / GLYPH_HEIGHT;
  const advance = GLYPH_ADVANCE * style.spacing * s;
  const ink = GLYPH_WIDTH * s;
  return { advance, width: (n) => (n > 0 ? n * advance - (advance - ink) : 0) };
}

function parsePad(props, defaults) {
  let [t, r, b, l] = defaults;
  const v = props.pad;
  if (v != null) {
    const n = String(v).trim().split(/\s+/).map(Number);
    [t, r, b, l] = n.length === 1 ? [n[0], n[0], n[0], n[0]] : n.length === 2 ? [n[0], n[1], n[0], n[1]] : n.length === 3 ? [n[0], n[1], n[2], n[1]] : n;
  }
  if (props.padX != null) r = l = +props.padX;
  if (props.padY != null) t = b = +props.padY;
  return { t, r, b, l };
}

// Text rarely changes between renders, so normalisation and wrapping are memoised.
const memo = new Map();
function cached(kind, key, compute) {
  const k = `${kind}\u0000${key}`;
  let v = memo.get(k);
  if (v === undefined) {
    if (memo.size > 20000) memo.clear();
    v = compute();
    memo.set(k, v);
  }
  return v;
}

function wrap(str, maxChars) {
  const out = [];
  for (const para of str.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > maxChars) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------

/** UINode -> layout node. `parentType` decides the axis of spacers and dividers. */
export function build(node, parentStyle, key, parentType = 'column') {
  const p = node.props;
  const style = { ...parentStyle };
  if (p.color != null) style.color = p.color;
  if (p.size != null) style.size = +p.size;
  if (p.spacing != null) style.spacing = +p.spacing;
  if (p.lineHeight != null) style.lineHeight = +p.lineHeight;
  let k = p.intensity != null ? +p.intensity : 1;
  if (p.dim) k *= 0.5;
  if (p.bright) k *= 1.4;
  style.intensity = parentStyle.intensity * k;

  const horizontal = parentType === 'row';
  const L = {
    type: node.type,
    props: p,
    content: node.content,
    key,
    style,
    axis: horizontal ? 'row' : 'column',
    kids: [],
    gap: +(p.gap ?? 0),
    grow: +(p.grow ?? 0),
    fixedW: typeof p.width === 'number' ? p.width : null,
    fixedH: typeof p.height === 'number' ? p.height : null,
    fillW: p.width === 'fill',
    fillH: p.height === 'fill',
    rect: null,
    m: null,
    mc: null, // measure cache: available width -> size (lines included for text)
  };

  const sz = style.size;
  const defaults = {
    button: [sz * 0.55, sz * 0.85, sz * 0.55, sz * 0.85],
    input: [sz * 0.5, sz * 0.55, sz * 0.5, sz * 0.55],
  };
  L.pad = parsePad(p, defaults[node.type] ?? [0, 0, 0, 0]);
  if (node.type === 'box' && p.border == null) L.border = true;
  if (node.type === 'spacer' && p.size == null && p.grow == null) L.grow = 1;
  if (node.type === 'scroll' && p.height == null && p.grow == null) L.grow = 1;

  const add = (child, path) => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
      child.forEach((c, j) => add(c, `${path}.${j}`));
      return;
    }
    const c = child instanceof UINode ? child : new UINode('text', String(child), {}, []);
    const id = c.props.key != null ? `#${c.props.key}` : `${path}${c.type[0]}`;
    L.kids.push(build(c, style, `${key}/${id}`, node.type));
  };
  node.children.forEach((c, i) => add(c, String(i)));
  return L;
}

// ---------------------------------------------------------------------------

export function measure(L, maxW) {
  // Measuring and placing ask at different widths, so keep every answer, not just the last.
  const hit = L.mc?.get(maxW);
  if (hit) {
    L.m = hit;
    if (hit.lines) L.lines = hit.lines;
    return hit;
  }
  const avail = L.fixedW ?? maxW;
  let m;
  switch (L.type) {
    case 'text':
    case 'link':
    case 'button': {
      const { pad } = L;
      const t = textBlock(L, L.type === 'button' ? Infinity : avail - pad.l - pad.r);
      m = { w: t.w + pad.l + pad.r, h: t.h + pad.t + pad.b, base: pad.t + t.base };
      break;
    }
    case 'input': {
      const { pad, style } = L;
      const w = L.fixedW ?? textMetrics(style).width(+(L.props.cols ?? 24)) + pad.l + pad.r;
      m = { w, h: style.size + pad.t + pad.b, base: pad.t + style.size };
      break;
    }
    case 'icon': {
      const s = +(L.props.size ?? L.style.size);
      m = { w: s + L.pad.l + L.pad.r, h: s + L.pad.t + L.pad.b, base: L.pad.t + s };
      break;
    }
    case 'divider':
      m = L.axis === 'row' ? { w: 1 + L.pad.l + L.pad.r, h: 0, base: 0 } : { w: 0, h: 1 + L.pad.t + L.pad.b, base: 1 };
      break;
    case 'spacer': {
      const s = +(L.props.size ?? 0);
      m = L.axis === 'row' ? { w: s, h: 0, base: 0 } : { w: 0, h: s, base: s };
      break;
    }
    case 'row':
      m = measureRow(L, avail);
      break;
    case 'stack':
      m = measureStack(L, avail);
      break;
    default:
      m = measureColumn(L, avail);
  }
  if (L.fixedW != null) m.w = L.fixedW;
  else if (L.fillW && Number.isFinite(maxW)) m.w = maxW;
  if (L.fixedH != null) m.h = L.fixedH;
  if (L.lines && (L.type === 'text' || L.type === 'link' || L.type === 'button')) m.lines = L.lines;
  (L.mc ??= new Map()).set(maxW, m);
  L.m = m;
  return m;
}

/** Lines, width and height of a text node's content (excluding padding). */
function textBlock(L, inner) {
  const { style } = L;
  const raw = String(L.content ?? '');
  const str = cached('n', raw, () => normalizeText(raw));
  const tm = textMetrics(style);
  let lines;
  if (L.props.wrap && Number.isFinite(inner)) {
    // Largest n with width(n) <= inner; the epsilon keeps exact fits from rounding down.
    const n = Math.max(1, Math.floor((inner + tm.advance - tm.width(1)) / tm.advance + 1e-6));
    lines = cached(`w${n}`, str, () => wrap(str, n));
  } else lines = cached('s', str, () => str.split('\n'));
  L.lines = lines;
  const w = Math.max(0, ...lines.map((l) => tm.width(l.length)));
  const h = style.size + (lines.length - 1) * style.size * style.lineHeight;
  return { w, h, base: style.size };
}

/** Widths for a row's children: fixed ones first (in order), then grow ones share the rest. */
function rowWidths(L, inner) {
  const kids = L.kids;
  let used = L.gap * Math.max(0, kids.length - 1);
  let growSum = 0;
  const widths = kids.map((k) => {
    if (k.grow > 0) {
      growSum += k.grow;
      return 0;
    }
    const w = measure(k, Math.max(0, inner - used)).w;
    used += w;
    return w;
  });
  // Overflowing? Text that can wrap gives up width, last child first (flex-shrink, for words).
  for (let i = kids.length - 1; i >= 0 && used > inner + 0.01; i--) {
    const k = kids[i];
    if (k.grow > 0 || !k.props.wrap || !(k.type === 'text' || k.type === 'link')) continue;
    const before = widths[i];
    widths[i] = measure(k, Math.max(before * 0.25, before - (used - inner))).w;
    used -= before - widths[i];
  }
  const free = Math.max(0, inner - used);
  kids.forEach((k, i) => {
    if (k.grow > 0) {
      widths[i] = (free * k.grow) / growSum;
      measure(k, widths[i]);
    }
  });
  return { widths, used: growSum > 0 ? inner : used, rest: growSum > 0 ? 0 : inner - used };
}

function rowCross(L) {
  const align = L.props.align ?? 'baseline';
  let asc = 0;
  let desc = 0;
  let hmax = 0;
  for (const k of L.kids) {
    asc = Math.max(asc, k.m.base);
    desc = Math.max(desc, k.m.h - k.m.base);
    hmax = Math.max(hmax, k.m.h);
  }
  return { align, asc, h: align === 'baseline' ? asc + desc : hmax };
}

function measureRow(L, avail) {
  const { pad } = L;
  const { used } = rowWidths(L, Math.max(0, avail - pad.l - pad.r));
  const { align, asc, h } = rowCross(L);
  const first = L.kids[0]?.m;
  const base = align === 'baseline' ? asc : first ? (align === 'center' ? (h - first.h) / 2 : align === 'end' ? h - first.h : 0) + first.base : 0;
  return { w: used + pad.l + pad.r, h: h + pad.t + pad.b, base: pad.t + base };
}

function measureColumn(L, avail) {
  const { pad } = L;
  const inner = Math.max(0, avail - pad.l - pad.r - (L.type === 'scroll' ? SCROLLBAR : 0));
  let w = 0;
  let h = 0;
  let base = null;
  L.kids.forEach((k, i) => {
    const m = measure(k, inner);
    if (i) h += L.gap;
    if (base === null) base = h + m.base;
    h += m.h;
    w = Math.max(w, m.w);
  });
  return { w: w + pad.l + pad.r, h: h + pad.t + pad.b, base: pad.t + (base ?? 0) };
}

function measureStack(L, avail) {
  const { pad } = L;
  const inner = Math.max(0, avail - pad.l - pad.r);
  let w = 0;
  let h = 0;
  for (const k of L.kids) {
    const m = measure(k, inner);
    w = Math.max(w, m.w);
    h = Math.max(h, m.h);
  }
  const base = L.kids[0]?.m.base ?? 0;
  return { w: w + pad.l + pad.r, h: h + pad.t + pad.b, base: pad.t + base };
}

// ---------------------------------------------------------------------------

/** `rt` supplies persistent scroll state: rt.scrollState(key) -> { y, target, max, ... }. */
export function place(L, x, y, w, h, rt) {
  L.rect = { x, y, w, h };
  const { pad } = L;
  const ix = x + pad.l;
  const iy = y + pad.t;
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = Math.max(0, h - pad.t - pad.b);
  switch (L.type) {
    case 'row':
      placeRow(L, ix, iy, iw, ih, rt);
      break;
    case 'column':
    case 'box':
      placeColumn(L, ix, iy, iw, ih, rt, 0);
      break;
    case 'stack':
      for (const k of L.kids) {
        const m = measure(k, iw);
        const kw = k.fillW ? iw : m.w;
        const kh = k.fillH ? ih : m.h;
        const align = L.props.align ?? 'start';
        const off = (free) => (align === 'center' ? free / 2 : align === 'end' ? free : 0);
        place(k, ix + off(iw - kw), iy + off(ih - kh), kw, kh, rt);
      }
      break;
    case 'scroll': {
      const cw = Math.max(0, iw - SCROLLBAR);
      let content = 0;
      L.kids.forEach((k, i) => (content += measure(k, cw).h + (i ? L.gap : 0)));
      const st = rt.scrollState(L.key);
      st.view = ih;
      st.content = content;
      st.max = Math.max(0, content - ih);
      st.target = Math.min(Math.max(st.target, 0), st.max);
      st.y = Math.min(Math.max(st.y, 0), st.max);
      L.scroll = st;
      L.inner = { x: ix, y: iy, w: iw, h: ih };
      placeColumn(L, ix, iy, cw, Math.max(ih, content), rt, -st.y);
      break;
    }
    default:
      if (L.type === 'text' || L.type === 'link' || L.type === 'button') measure(L, w);
  }
}

function placeRow(L, ix, iy, iw, ih, rt) {
  const kids = L.kids;
  const { widths, rest } = rowWidths(L, iw);
  const { align, asc, h } = rowCross(L);
  let x = ix;
  let between = 0;
  const justify = L.props.justify;
  if (rest > 0) {
    if (justify === 'center') x += rest / 2;
    else if (justify === 'end') x += rest;
    else if (justify === 'between' && kids.length > 1) between = rest / (kids.length - 1);
  }
  kids.forEach((k, i) => {
    const m = k.m;
    let ky = iy;
    let kh = m.h;
    if (k.fillH || align === 'stretch' || k.type === 'divider') kh = ih;
    else if (align === 'baseline') ky = iy + (ih - h) / 2 + asc - m.base;
    else if (align === 'center') ky = iy + (ih - m.h) / 2;
    else if (align === 'end') ky = iy + ih - m.h;
    place(k, x, ky, widths[i], kh, rt);
    x += widths[i] + L.gap + between;
  });
}

function placeColumn(L, ix, iy, iw, ih, rt, offsetY) {
  const kids = L.kids;
  const heights = [];
  let used = L.gap * Math.max(0, kids.length - 1);
  let growSum = 0;
  kids.forEach((k, i) => {
    const m = measure(k, iw);
    if (k.grow > 0) {
      growSum += k.grow;
      heights[i] = 0;
    } else {
      heights[i] = m.h;
      used += m.h;
    }
  });
  const free = Math.max(0, ih - used);
  kids.forEach((k, i) => {
    if (k.grow > 0) heights[i] = (free * k.grow) / growSum;
  });
  let y = iy + offsetY;
  let between = 0;
  const justify = L.props.justify;
  if (growSum === 0 && free > 0) {
    if (justify === 'center') y += free / 2;
    else if (justify === 'end') y += free;
    else if (justify === 'between' && kids.length > 1) between = free / (kids.length - 1);
  }
  const align = L.props.align ?? 'start';
  kids.forEach((k, i) => {
    const m = k.m;
    let kx = ix;
    let kw = m.w;
    if (k.fillW || align === 'stretch' || k.type === 'divider' || (k.type === 'scroll' && k.fixedW == null)) kw = iw;
    else if (align === 'center') kx = ix + (iw - m.w) / 2;
    else if (align === 'end') kx = ix + iw - m.w;
    place(k, kx, y, kw, heights[i], rt);
    y += heights[i] + L.gap + between;
  });
}

export { isLeaf };
