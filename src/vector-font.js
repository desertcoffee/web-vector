// Stroke font for the vector display.
//
// Glyphs live on a 4 x 6 grid (x: 0..4, y: 0..6, y grows downward, baseline at 6).
// Each glyph is a list of strokes; each stroke is a flat [x, y, x, y, ...] polyline
// the beam traces without blanking. A single-point stroke is a dot.

export const GLYPH_WIDTH = 4;
export const GLYPH_HEIGHT = 6;
export const GLYPH_ADVANCE = 6;

const O = [1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0];

export const GLYPHS = {
  ' ': [],
  A: [[0, 6, 0, 2, 2, 0, 4, 2, 4, 6], [0, 4, 4, 4]],
  B: [[0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 2, 6, 4, 4, 4, 2, 2, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
  G: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[4, 0, 4, 5, 3, 6, 1, 6, 0, 5]],
  K: [[0, 0, 0, 6], [4, 0, 0, 3, 4, 6]],
  L: [[0, 0, 0, 6, 4, 6]],
  M: [[0, 6, 0, 0, 2, 2, 4, 0, 4, 6]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
  O: [O],
  P: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  Q: [O, [2, 4, 4, 6]],
  R: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [2, 3, 4, 6]],
  S: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  U: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
  V: [[0, 0, 2, 6, 4, 0]],
  W: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]],
  X: [[0, 0, 4, 6], [4, 0, 0, 6]],
  Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]],
  Z: [[0, 0, 4, 0, 0, 6, 4, 6]],

  0: [O, [4, 1, 0, 5]],
  1: [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
  2: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
  3: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5], [1, 3, 3, 3]],
  4: [[3, 6, 3, 0, 0, 4, 4, 4]],
  5: [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 0, 6]],
  6: [[3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  7: [[0, 0, 4, 0, 1, 6]],
  8: [[1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  9: [[4, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6]],

  '.': [[2, 6]],
  ',': [[2, 5, 2, 6, 1, 7]],
  ':': [[2, 1.5], [2, 4.5]],
  ';': [[2, 1.5], [2, 4.5, 2, 5.5, 1, 6.5]],
  '!': [[2, 0, 2, 4], [2, 6]],
  '?': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 2, 3, 2, 4], [2, 6]],
  "'": [[2, 0, 2, 2]],
  '"': [[1, 0, 1, 2], [3, 0, 3, 2]],
  '`': [[1, 0, 2, 1]],
  '-': [[1, 3, 3, 3]],
  '_': [[0, 6, 4, 6]],
  '+': [[0, 3, 4, 3], [2, 1, 2, 5]],
  '=': [[0, 2, 4, 2], [0, 4, 4, 4]],
  '*': [[2, 1, 2, 5], [0, 2, 4, 4], [0, 4, 4, 2]],
  '/': [[0, 6, 4, 0]],
  '\\': [[0, 0, 4, 6]],
  '|': [[2, -0.5, 2, 6.5]],
  '(': [[3, 0, 1, 2, 1, 4, 3, 6]],
  ')': [[1, 0, 3, 2, 3, 4, 1, 6]],
  '[': [[3, 0, 1, 0, 1, 6, 3, 6]],
  ']': [[1, 0, 3, 0, 3, 6, 1, 6]],
  '{': [[3, 0, 2, 1, 2, 2, 1, 3, 2, 4, 2, 5, 3, 6]],
  '}': [[1, 0, 2, 1, 2, 2, 3, 3, 2, 4, 2, 5, 1, 6]],
  '<': [[3, 1, 1, 3, 3, 5]],
  '>': [[1, 1, 3, 3, 1, 5]],
  '^': [[1, 2, 2, 0, 3, 2]],
  '~': [[0, 3, 1, 2, 3, 4, 4, 3]],
  '#': [[1, 1, 1, 5], [3, 1, 3, 5], [0, 2, 4, 2], [0, 4, 4, 4]],
  '%': [[0, 6, 4, 0], [0, 0, 1, 0, 1, 1, 0, 1, 0, 0], [3, 5, 4, 5, 4, 6, 3, 6, 3, 5]],
  '@': [[3, 4, 3, 2, 1, 2, 1, 4, 4, 4, 4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 4, 6]],
  '&': [[4, 6, 1, 2, 1, 1, 2, 0, 3, 1, 3, 2, 0, 4, 0, 5, 1, 6, 2, 6, 4, 4]],
  '$': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5], [2, -0.5, 2, 6.5]],
};

const FALLBACK = [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0]];

function glyphFor(ch) {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? FALLBACK;
}

const TYPOGRAPHIC = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*', '·': '-' };

/**
 * Map text onto glyphs the font has: typographic punctuation to ASCII, accents stripped
 * (é -> e), tabs to spaces, and anything else outside printable ASCII (emoji, CJK, ...)
 * to a single unknown-glyph box. One output character per glyph keeps layout exact.
 */
export function normalizeText(str) {
  return String(str)
    .replace(/[‘’“”–—…•·]/g, (c) => TYPOGRAPHIC[c])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\t/g, '  ')
    .replace(/[^\n\x20-\x7e]/gu, '\u25a1');
}

/** Width of a single line of text in display units. */
export function measureText(str, { size = 24, spacing = 1 } = {}) {
  const s = size / GLYPH_HEIGHT;
  const longest = Math.max(0, ...normalizeText(str).split('\n').map((l) => l.length));
  if (!longest) return 0;
  return (longest * GLYPH_ADVANCE * spacing - (GLYPH_ADVANCE * spacing - GLYPH_WIDTH)) * s;
}

/**
 * Lay text out as strokes ([[x, y], ...] point lists).
 * `x, y` is the top-left of the first line's cap height (or top-center / top-right per `align`).
 */
export function textStrokes(str, x, y, { size = 24, spacing = 1, lineHeight = 1.7, align = 'left' } = {}) {
  const s = size / GLYPH_HEIGHT;
  const strokes = [];
  normalizeText(str).split('\n').forEach((line, row) => {
    const w = measureText(line, { size, spacing });
    let ox = x;
    if (align === 'center') ox -= w / 2;
    else if (align === 'right') ox -= w;
    const oy = y + row * size * lineHeight;
    [...line].forEach((ch, col) => {
      const gx = ox + col * GLYPH_ADVANCE * spacing * s;
      for (const flat of glyphFor(ch)) {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) pts.push([gx + flat[i] * s, oy + flat[i + 1] * s]);
        strokes.push(pts);
      }
    });
  });
  return strokes;
}
