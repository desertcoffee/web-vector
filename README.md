# vector-ui

A vector (random-scan) CRT for the browser. One simulated electron beam traces every
line onto a near-black tube in green or orange phosphor. Lines are the only primitive
(text is a stroke font), and every line is drawn on by the beam when it appears.

No dependencies and no build step. It uses plain ES modules and WebGL2.

## Run the demo

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The demo is an instrument-style monitor with a phosphor switch, four knobs (intensity,
focus, persistence and beam rate) and five programs: a title card, a Battlezone-style
terrain, a two-channel oscilloscope, a terminal you can type into (try `HELP`), and a
sketch pad. The display is exposed as `window.vd`, so you can draw from the console:

```js
vd.line(100, 100, 900, 600);
vd.text('HELLO', 512, 360, { size: 60, align: 'center', color: 'alt' });
```

## Use it

```html
<canvas id="screen" style="width: 800px; aspect-ratio: 4 / 3"></canvas>
<script type="module">
  import { VectorDisplay } from './src/vector-display.js';

  const vd = new VectorDisplay(document.getElementById('screen'), { color: 'green' });
  vd.rect(40, 40, 944, 688);
  await vd.text('READY', 512, 340, { size: 72, align: 'center' }).drawn;
  vd.circle(512, 560, 60, { color: 'orange' });
</script>
```

Coordinates are in display units: `width × height` (1024 × 768 by default), with the
origin at the top-left. The logical display is letterboxed into the canvas, and the canvas
can be any CSS size; the display tracks resizes and device pixel ratio.

### `new VectorDisplay(canvas, options)`

| option        | default   | meaning                                                         |
| ------------- | --------- | --------------------------------------------------------------- |
| `width`/`height` | 1024 / 768 | logical display size                                       |
| `color`       | `'green'` | default phosphor: `'green'` or `'orange'`                       |
| `beamSpeed`   | 2400      | tracing speed, display units per second                         |
| `persistence` | 0.16      | phosphor decay time constant, seconds                           |
| `intensity`   | 1         | overall brightness                                              |
| `focus`       | 1         | beam spot size (above 1 defocuses; same energy, spread wider)   |
| `glow`        | 1         | bloom strength                                                  |
| `curvature`   | 0.035     | tube barrel distortion                                          |
| `writeBoost`  | 1.6       | afterglow where the beam has just written                       |
| `flash`       | 9         | brief extra brightness at the beam head                         |
| `dwell`       | 0.8       | brightness of beam dwell at stroke ends and sharp corners       |

All of these except `width`/`height` are plain properties you can change at any time,
e.g. `vd.color = 'orange'`. Lines that use the default colour cross-fade to the new phosphor.

### Drawing

Every call queues a shape for the beam and returns a `Shape`. The beam draws shapes one
at a time, in order.

- `line(x0, y0, x1, y1, opts)`
- `path(points, opts)`: open polyline, `points` is `[[x, y], ...]`
- `polygon(points, opts)`: closed polyline
- `rect(x, y, w, h, opts)`
- `circle(cx, cy, r, opts)`: also takes `segments` and `startAngle`
- `text(str, x, y, opts)`: also takes `size` (cap height), `spacing`, `lineHeight`, `align`
- `shape(strokes, opts)`: several polylines `[[[x, y], ...], ...]` traced as one shape
- `clear()`: remove everything (it fades out over the persistence time)
- `idle()`: a promise that resolves once everything queued so far has been traced
- `onFrame(fn)`: calls `fn(dt, time)` every frame, before the beam moves; returns an unsubscribe function
- `clientToDisplay(clientX, clientY)`: maps a pointer position to display units, accounting for curvature

Shape options: `color` (`'green'`, `'orange'`, `'alt'` for whichever phosphor the display
*isn't* using, or omit it to follow the display), `intensity`, and `speed` (overrides
`beamSpeed` for this shape).

### `Shape`

- `drawn`: a promise that resolves when the beam finishes tracing the shape
- `update(strokes)`: replace the geometry. A drawn shape moves instantly instead of being
  re-traced, and phosphor persistence leaves a trail. Use this for animation.
- `translate(dx, dy)`, `remove()`
- `state`: `'queued' | 'drawing' | 'drawn' | 'removed'`; `intensity` and `color` can be changed live

The stroke font is also exported from `src/vector-font.js` (`textStrokes`, `measureText`)
if you want text geometry for `update()`.

## How it works

- **Beam:** shapes are traced at a finite speed. Blank moves between strokes are cheap
  but not free, and each stroke start has a small settle time.
- **Phosphor:** an RGBA16F accumulation buffer holds slow and fast components for each
  colour. Lines on the display list are refreshed every frame to hold a steady brightness.
  The beam head adds a short hot flash plus an afterglow that decays over `persistence`.
  Removed or moved lines simply stop being refreshed and fade.
- **Spot:** each segment is the analytic integral of a gaussian spot swept along it, so
  polylines join seamlessly. Ends and corners get extra dwell energy, as on real hardware.
- **Composite:** a 4-level bloom, a saturating tone curve (bright cores bleach toward
  white), barrel distortion, phosphor grain, and a near-black glass tint. There are no
  scanlines, because vector monitors don't have any.

It needs WebGL2. If float render targets (`EXT_color_buffer_float`) are missing, it falls
back to 8-bit buffers with scaled energies and dithered bloom.
