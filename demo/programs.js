// Demo programs for the XY-1024. Each one receives a context from main.js:
//   d          the VectorDisplay
//   idle()     wait for the beam to finish what's queued (throws if the program was stopped)
//   sleep(ms)  likewise
//   frame(fn)  per-frame callback, removed automatically when the program stops
//   every(ms, fn), listen(target, type, fn)  same idea for timers and DOM events
//   ui         hooks back into the control panel

import { textStrokes, measureText } from '../src/vector-font.js';

const W = 1024;
const H = 768;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------

async function title(c) {
  const { d } = c;
  const m = 34;
  const L = 56;
  d.shape(
    [
      [[m, m + L], [m, m], [m + L, m]],
      [[W - m - L, m], [W - m, m], [W - m, m + L]],
      [[W - m, H - m - L], [W - m, H - m], [W - m - L, H - m]],
      [[m + L, H - m], [m, H - m], [m, H - m - L]],
    ],
    { speed: 5000 },
  );
  d.text('XY-1024', 78, 72, { size: 14, spacing: 1.25 });
  d.text('CH A+B', W - 78, 72, { size: 14, spacing: 1.25, align: 'right' });

  d.text('VECTOR', W / 2, 168, { size: 100, align: 'center' });
  d.text('DISPLAY', W / 2, 300, { size: 100, align: 'center' });

  const wave = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    wave.push([170 + t * 684, 466 + Math.sin(t * TAU * 5) * 18 * Math.sin(t * Math.PI)]);
  }
  d.path(wave, { color: 'alt' });

  d.text('RANDOM-SCAN CRT  /  ONE BEAM  /  LINES ONLY', W / 2, 528, { size: 16, align: 'center', spacing: 1.1 });

  const prompt = 'SELECT A PROGRAM';
  const opts = { size: 14, spacing: 1.25 };
  const px = W / 2 - measureText(prompt, opts) / 2 - 12;
  d.text(prompt, px, 642, opts);
  await c.idle();

  const cx = px + measureText(prompt, opts) + 14;
  let cursor = null;
  c.every(530, () => {
    if (cursor) {
      cursor.remove();
      cursor = null;
    } else cursor = d.line(cx, 656, cx + 11, 656, { speed: 3000 });
  });
}

// ---------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_E = [];
for (let i = 0; i < ICO_V.length; i++) {
  for (let j = i + 1; j < ICO_V.length; j++) {
    const [a, b] = [ICO_V[i], ICO_V[j]];
    if (Math.abs((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 - 4) < 1e-6) ICO_E.push([i, j]);
  }
}

const RIDGE = [
  [0, 0], [38, -16], [66, -7], [108, -40], [146, -19], [178, -29], [226, 0], [262, -11], [298, -5],
  [346, -52], [378, -36], [410, -64], [452, -26], [492, -9], [540, 0], [596, -22], [636, -66],
  [656, -86], [672, -80], [688, -84], [712, -64], [768, -18], [818, -32], [858, -12], [900, -38],
  [942, -17], [982, -24], [1024, 0],
];

async function wireframe(c) {
  const { d } = c;
  const cx = W / 2;
  const hy = 330;
  const f = 620;
  const camH = 60;
  const P = (x, y, z) => [cx + (f * x) / z, hy - (f * (y - camH)) / z];

  // Instrument strip, in the other phosphor.
  const rx = cx;
  const ry = 92;
  const rr = 46;
  const strip = { color: 'alt', speed: 4000 };
  d.circle(rx, ry, rr, { ...strip, intensity: 0.7 });
  d.shape(
    [
      [[rx - rr - 9, ry], [rx - rr + 7, ry]],
      [[rx + rr - 7, ry], [rx + rr + 9, ry]],
      [[rx, ry - rr - 9], [rx, ry - rr + 7]],
      [[rx, ry + rr - 7], [rx, ry + rr + 9]],
    ],
    { ...strip, intensity: 0.7 },
  );
  const sweep = d.line(rx, ry, rx, ry - rr, strip);
  const blipAngle = -0.9;
  const blip = d.shape([[[rx + Math.cos(blipAngle) * 28, ry + Math.sin(blipAngle) * 28]]], strip);
  const hudOpts = { size: 14, spacing: 1.2 };
  const range = (t) => `RANGE ${String(Math.round(420 + 60 * Math.sin(t * 0.7))).padStart(4, '0')}`;
  const hud = d.text(range(0), 64, 62, { ...hudOpts, ...strip });
  d.text('SECTOR 7G', W - 64, 62, { ...hudOpts, ...strip, align: 'right' });

  d.line(0, hy, W, hy, { speed: 4000 });

  // A slowly tumbling icosahedron, queued early so it isn't waiting behind the grid.
  const ico = (t) => {
    const ay = t * 0.55;
    const ax = t * 0.31;
    const [sy, cy, sx, cxr] = [Math.sin(ay), Math.cos(ay), Math.sin(ax), Math.cos(ax)];
    const R = 38;
    const oy = 122 + Math.sin(t * 1.3) * 8;
    const pts = ICO_V.map(([x, y, z]) => {
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y1 = y * cxr - z1 * sx;
      const z2 = y * sx + z1 * cxr;
      return P(x1 * R, y1 * R + oy, z2 * R + 520);
    });
    return ICO_E.map(([a, b]) => [pts[a], pts[b]]);
  };
  const obj = d.shape(ico(0), { intensity: 1.15 });

  // Mountains on the horizon.
  d.path(RIDGE.map(([x, y]) => [x, hy + y]), { color: 'alt', intensity: 0.85 });

  // Ground grid: rails run into the distance, ties scroll toward the viewer.
  const S = 64;
  const NX = 14;
  const zNear = 90;
  const zFar = 1500;
  const rails = [];
  for (let i = 0; i <= NX; i++) {
    for (const x of i ? [-i * S, i * S] : [0]) {
      const z0 = Math.max(zNear, (Math.abs(x) * f) / (W / 2));
      if (z0 < zFar) rails.push([P(x, 0, z0), P(x, 0, zFar)]);
    }
  }
  d.shape(rails, { intensity: 0.5, speed: 9000 });

  const NZ = 22;
  const span = NZ * S;
  const tie = (i, scroll) => {
    const z = zNear + ((((i * S - scroll) % span) + span) % span);
    const xm = Math.min(NX * S, ((W / 2 + 40) * z) / f);
    const depth = (z - zNear) / span;
    return { strokes: [[P(-xm, 0, z), P(xm, 0, z)]], intensity: 0.08 + 0.8 * Math.pow(1 - depth, 1.3) };
  };
  const ties = Array.from({ length: NZ }, (_, i) => {
    const t = tie(i, 0);
    return d.shape(t.strokes, { intensity: t.intensity, speed: 12000 });
  });

  let t = 0;
  let scroll = 0;
  c.frame((dt) => {
    t += dt;
    scroll += dt * 80;
    ties.forEach((s, i) => {
      const next = tie(i, scroll);
      s.update(next.strokes);
      s.intensity = next.intensity;
    });
    obj.update(ico(t));
    const a = t * 2.1 - Math.PI / 2;
    sweep.update([[rx, ry], [rx + Math.cos(a) * rr, ry + Math.sin(a) * rr]]);
    const since = (((a - blipAngle) % TAU) + TAU) % TAU;
    blip.intensity = 0.15 + 1.6 * Math.exp(-since * 1.2);
    hud.update(textStrokes(range(t), 64, 62, hudOpts));
  });
}

// ---------------------------------------------------------------------------

async function scope(c) {
  const { d } = c;
  const div = 76;
  const nx = 10;
  const ny = 8;
  const gw = div * nx;
  const gh = div * ny;
  const x0 = (W - gw) / 2;
  const y0 = 34;
  const xm = x0 + gw / 2;
  const ym = y0 + gh / 2;
  const minor = div / 5;

  // Graticule.
  d.rect(x0, y0, gw, gh, { intensity: 0.55, speed: 6000 });
  const axes = [
    [[x0, ym], [x0 + gw, ym]],
    [[xm, y0], [xm, y0 + gh]],
  ];
  for (let i = 1; i < nx * 5; i++) axes.push([[x0 + i * minor, ym - 5], [x0 + i * minor, ym + 5]]);
  for (let j = 1; j < ny * 5; j++) axes.push([[xm - 5, y0 + j * minor], [xm + 5, y0 + j * minor]]);
  d.shape(axes, { intensity: 0.45, speed: 8000 });
  const dots = [];
  for (let i = 1; i < nx; i++) {
    if (i === nx / 2) continue;
    for (let j = 1; j < ny * 5; j++) dots.push([[x0 + i * div, y0 + j * minor]]);
  }
  for (let j = 1; j < ny; j++) {
    if (j === ny / 2) continue;
    for (let i = 1; i < nx * 5; i++) if (i % 5) dots.push([[x0 + i * minor, y0 + j * div]]);
  }
  d.shape(dots, { intensity: 0.32, speed: 12000 });

  // Two channels: CH1 in the selected phosphor, CH2 in the other one.
  const c1 = y0 + div * 2.4;
  const c2 = y0 + div * 5.8;
  const N = 420;
  const ch1 = (t) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const env = 0.62 + 0.38 * Math.sin(TAU * (u * 0.5 + t * 0.2));
      pts.push([x0 + u * gw, c1 - div * 1.5 * env * Math.sin(TAU * 4 * u) + (Math.random() - 0.5) * 1.8]);
    }
    return pts;
  };
  const ch2 = (t) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const w = TAU * (2.5 * u - t * 0.12);
      let s = 0;
      for (let k = 1; k <= 13; k += 2) s += Math.sin(k * w) / k;
      pts.push([x0 + u * gw, c2 - div * 1.05 * s]);
    }
    return pts;
  };
  const trace1 = d.path(ch1(0), { speed: 1800, intensity: 1.05 });
  const trace2 = d.path(ch2(0), { color: 'alt', speed: 1800 });

  // Markers and readouts.
  const arrow = (x, y) => [[[x - 10, y - 6], [x - 2, y], [x - 10, y + 6]]];
  d.text('1', x0 - 28, c1 - 7, { size: 14 });
  d.shape(arrow(x0 - 2, c1));
  d.text('2', x0 - 28, c2 - 7, { size: 14, color: 'alt' });
  d.shape(arrow(x0 - 2, c2), { color: 'alt' });
  d.shape([[[x0 + gw + 12, c1 - 46], [x0 + gw + 4, c1 - 40], [x0 + gw + 12, c1 - 34]]]);
  const ry = y0 + gh + 30;
  const ro = { size: 15, spacing: 1.1 };
  d.text('CH1  500MV', x0, ry, ro);
  d.text('CH2  1.00V', x0 + 196, ry, { ...ro, color: 'alt' });
  d.text('M 2.00MS', x0 + 392, ry, ro);
  d.text('T1 / 120MV', x0 + gw, ry, { ...ro, align: 'right' });

  let t = 0;
  c.frame((dt) => {
    t += dt;
    trace1.update(ch1(t));
    trace2.update(ch2(t));
  });
}

// ---------------------------------------------------------------------------

async function terminal(c) {
  const { d, kbd, canvas } = c;
  const size = 18;
  const adv = 18;
  const lh = 34;
  const x0 = 64;
  const y0 = 58;
  const cols = Math.floor((W - 2 * x0) / adv);
  const rows = Math.floor((H - y0 - 44) / lh);

  let lines = [[]];
  let row = 0;
  let col = 0;
  let input = '';
  let cursor = null;

  const at = (r, k) => [x0 + k * adv, y0 + r * lh];
  const showCursor = () => {
    cursor?.remove();
    const [x, y] = at(row, col);
    cursor = d.line(x, y + size + 5, x + (size * 4) / 6, y + size + 5, { speed: 4000 });
  };
  const hideCursor = () => {
    cursor?.remove();
    cursor = null;
  };
  const newline = () => {
    col = 0;
    row++;
    if (row === rows) {
      for (const s of lines.shift()) s?.remove();
      for (const l of lines) for (const s of l) s?.translate(0, -lh);
      row--;
    }
    lines.push([]);
  };
  const put = (ch) => {
    if (ch === '\n') return newline();
    if (col >= cols) newline();
    const [x, y] = at(row, col);
    lines[row].push(ch === ' ' ? null : d.text(ch, x, y, { size }));
    col++;
  };
  const print = (s) => [...s].forEach(put);
  const println = (s = '') => {
    print(s);
    newline();
  };
  const prompt = () => {
    print('> ');
    input = '';
    showCursor();
  };
  const reset = () => {
    for (const l of lines) for (const s of l) s?.remove();
    lines = [[]];
    row = col = 0;
  };

  const run = (cmd) => {
    const [name = '', ...rest] = cmd.trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (name) {
      case '':
        break;
      case 'HELP':
        println('HELP      THIS LIST');
        println('CLS       CLEAR THE SCREEN');
        println('TIME      SHOW THE TIME');
        println('ECHO X    PRINT X');
        println('PHOSPHOR  SWAP GREEN / ORANGE');
        println('BEAM N    SET BEAM SPEED, UNITS/S');
        println('ABOUT     ABOUT THIS UNIT');
        break;
      case 'CLS':
      case 'CLEAR':
        reset();
        break;
      case 'TIME':
        println(new Date().toTimeString().slice(0, 8));
        break;
      case 'DATE':
        println(new Date().toDateString().toUpperCase());
        break;
      case 'ECHO':
        println(arg);
        break;
      case 'PHOSPHOR':
      case 'COLOR':
        c.ui.togglePhosphor();
        println(`PHOSPHOR ${d.color.toUpperCase()}`);
        break;
      case 'BEAM':
      case 'SPEED': {
        const v = Number(arg);
        if (!(v >= 100 && v <= 20000)) println('?RANGE 100 - 20000');
        else {
          c.ui.setBeamSpeed(v);
          println(`BEAM ${v} UNITS/S`);
        }
        break;
      }
      case 'ABOUT':
        println('XY-1024 RANDOM-SCAN DISPLAY');
        println('ONE BEAM. TWO PHOSPHORS. LINES ONLY.');
        break;
      default:
        println('?SYNTAX ERROR');
    }
  };

  const type = (ch) => {
    if (input.length >= cols - 3) return;
    const up = ch.toUpperCase();
    input += up;
    put(up);
    showCursor();
  };
  const backspace = () => {
    if (!input) return;
    input = input.slice(0, -1);
    lines[row].pop()?.remove();
    col--;
    showCursor();
  };
  const submit = () => {
    hideCursor();
    newline();
    run(input);
    prompt();
  };

  c.listen(window, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target !== document.body && e.target !== kbd) return;
    if (e.key === 'Enter') submit();
    else if (e.key === 'Backspace') backspace();
    else if (e.key.length === 1) type(e.key);
    else return;
    e.preventDefault();
  });
  // Soft keyboards don't send usable keydowns; take whatever lands in the hidden input.
  c.listen(kbd, 'input', () => {
    [...kbd.value].forEach(type);
    kbd.value = '';
  });
  c.listen(canvas, 'pointerdown', () => kbd.focus({ preventScroll: true }));
  kbd.focus({ preventScroll: true });

  println('XY-1024 MONITOR  REV 2.6');
  println('1 BEAM  2 PHOSPHORS  1024 X 768');
  println();
  println('TYPE HELP FOR COMMANDS.');
  prompt();

  c.every(530, () => {
    if (cursor && cursor.state === 'drawn') hideCursor();
    else if (!cursor) showCursor();
  });
}

// ---------------------------------------------------------------------------

async function sketch(c) {
  const { d, canvas } = c;
  const hint = { size: 11, align: 'center', spacing: 1.25, intensity: 0.7, speed: 6000 };
  d.text('CLICK TO PLOT   SHIFT-CLICK: OTHER PHOSPHOR', W / 2, 30, hint);
  d.text('ESC / RIGHT-CLICK: LIFT PEN   BACKSPACE: UNDO', W / 2, 50, hint);

  const prevTouch = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  c.onStop(() => (canvas.style.touchAction = prevTouch));

  const clampPt = ([x, y]) => [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
  const cross = ([x, y]) => [
    [[x - 15, y], [x - 5, y]],
    [[x + 5, y], [x + 15, y]],
    [[x, y - 15], [x, y - 5]],
    [[x, y + 5], [x, y + 15]],
  ];
  let ptr = null;
  let last = null;
  let reticle = null;
  let band = null;
  const history = [];

  const syncBand = () => {
    if (last && ptr) {
      if (band) band.update([last, ptr]);
      else band = d.path([last, ptr], { intensity: 0.28, speed: 8000 });
    } else if (band) {
      band.remove();
      band = null;
    }
  };
  const lift = () => {
    last = null;
    syncBand();
  };
  const undo = () => {
    const h = history.pop();
    if (!h) return;
    h.shape.remove();
    last = h.prev;
    syncBand();
  };

  c.listen(canvas, 'pointermove', (e) => {
    ptr = clampPt(d.clientToDisplay(e.clientX, e.clientY));
    if (reticle) reticle.update(cross(ptr));
    else reticle = d.shape(cross(ptr), { intensity: 0.75, speed: 6000 });
    syncBand();
  });
  c.listen(canvas, 'pointerleave', () => {
    reticle?.remove();
    reticle = null;
    ptr = null;
    syncBand();
  });
  c.listen(canvas, 'pointerdown', (e) => {
    if (e.button === 2) return lift();
    if (e.button !== 0) return;
    const p = clampPt(d.clientToDisplay(e.clientX, e.clientY));
    const color = e.shiftKey ? 'alt' : null;
    const shape = last ? d.line(last[0], last[1], p[0], p[1], { color }) : d.shape([[p]], { color });
    history.push({ shape, prev: last });
    last = ptr = p;
    syncBand();
  });
  c.listen(canvas, 'contextmenu', (e) => e.preventDefault());
  c.listen(window, 'keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.key === 'Escape') lift();
    else if (e.key === 'Backspace') {
      e.preventDefault();
      undo();
    }
  });
}

export const PROGRAMS = { title, wireframe, scope, terminal, sketch };
