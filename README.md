# vector-ui

A vector (random-scan) CRT for the browser. One simulated electron beam traces every
line onto a near-black tube in green or orange phosphor. Lines are the only primitive
(text is a stroke font), and every line is drawn on by the beam when it appears.

On top of the display there's a small UI layer: a markup DSL for general interface
primitives, with flex layout and a runtime that only re-traces what changed. A Hacker
News recreation built with it is included.

No dependencies and no build step. It uses plain ES modules and WebGL2.

## Run the demo

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The demo is an instrument-style monitor with a phosphor switch, four knobs (intensity,
focus, persistence and beam rate), two refresh toggles and five programs.

- **Fade & redraw** makes the single beam keep redrawing everything itself, so lines fade
  between visits. A big screen or a slow beam leaves parts of it dim. The **Redraw cycle**
  readout shows how long one pass takes.
- **Auto persist** raises persistence to at least one redraw cycle, which keeps every line
  visible. The persist knob keeps your own value; a red marker and red readout show the
  value in use. Turn it off and persistence drops back to your value.
- **Fast ghost fade** (on by default; works in fade & redraw, with or without auto persist)
  lets whatever won't be redrawn fade in half a second instead of lingering at the full
  persistence. That covers removed lines and the old positions of scrolled ones. Lines that
  are still on screen keep the full persistence, whether auto persist set it or you did.
  It only matters when persistence is longer than half a second.

Each page saves these settings in this browser (`localStorage`) as you change them, and
**Reset to defaults** puts them back. The five programs are a title card, a Battlezone-style
terrain, a two-channel oscilloscope, a terminal you can type into (try `HELP`), and a
sketch pad. The display is exposed as `window.vd`, so you can draw from the console:

```js
vd.line(100, 100, 900, 600);
vd.text('HELLO', 512, 360, { size: 60, align: 'center', color: 'alt' });
```

`hn.html` is the news terminal: Hacker News rebuilt with the UI DSL on a wide tube, with
the same phosphor switch and beam knobs as the demo. It reads live data from the
[HN Search API](https://hn.algolia.com/api) and is read-only: nothing is ever posted. You
can browse the front page (ranked HN-style, with more pages after it), new, past, comments,
ask, show, jobs, full comment threads (collapsible), user pages, submissions, stories from a
site, and search. Story titles open the article in a new tab, as on HN. Routes live in the
URL hash, so back and forward work. Data loading lives in `examples/hn/api.js`: a small
cache that refreshes in the background, turns HN's HTML into plain text, and shows a retry
link when a request fails.

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
| `order`       | `'queue'` | `'queue'` traces shapes in the order they were added; `'scan'` always traces the top-most waiting shape next, left to right within a row |
| `ghostFade`   | `null`    | seconds; when shorter than `persistence`, phosphor left by lines that were removed or moved fades this fast, while lines still on the display list keep fading at `persistence` |
| `refresh`     | `'continuous'` | `'continuous'` holds drawn lines at steady brightness for free; `'beam'` makes the beam redraw the display list pass after pass, and lines fade between visits |

All of these except `width`/`height` are plain properties you can change at any time,
e.g. `vd.color = 'orange'`. Lines that use the default colour cross-fade to the new phosphor.

### Drawing

Every call queues a shape for the beam and returns a `Shape`. The beam draws shapes one
at a time, in queue order or top-down depending on the `order` option.

- `line(x0, y0, x1, y1, opts)`
- `path(points, opts)`: open polyline, `points` is `[[x, y], ...]`
- `polygon(points, opts)`: closed polyline
- `rect(x, y, w, h, opts)`
- `circle(cx, cy, r, opts)`: also takes `segments` and `startAngle`
- `text(str, x, y, opts)`: also takes `size` (cap height), `spacing`, `lineHeight`, `align`
- `shape(strokes, opts)`: several polylines `[[[x, y], ...], ...]` traced as one shape
- `clear()`: remove everything (it fades out over the persistence time)
- `idle()`: a promise that resolves once everything queued so far has been traced
- `cycleTime`: seconds for the beam to trace everything on the display list once (in
  `refresh: 'beam'`, roughly how long each line waits between redraws)
- `onFrame(fn)`: calls `fn(dt, time)` every frame, before the beam moves; returns an unsubscribe function
- `clientToDisplay(clientX, clientY)`: maps a pointer position to display units, accounting for curvature

Shape options: `color` (`'green'`, `'orange'`, `'alt'` for whichever phosphor the display
*isn't* using, or omit it to follow the display), `intensity`, `speed` (overrides
`beamSpeed` for this shape), and `priority` (trace it ahead of other queued shapes;
`vd.prioritize(shape)` does the same for a shape that's already queued).

### `Shape`

- `drawn`: a promise that resolves when the beam finishes tracing the shape
- `update(strokes)`: replace the geometry. A drawn shape moves instantly instead of being
  re-traced, and phosphor persistence leaves a trail. Use this for animation.
- `translate(dx, dy)`, `remove()`
- `state`: `'queued' | 'drawing' | 'drawn' | 'removed'`; `intensity` and `color` can be changed live

The stroke font is also exported from `src/vector-font.js` (`textStrokes`, `measureText`)
if you want text geometry for `update()`.

## UI DSL

`src/ui/` is a small declarative UI layer for the display. Views are written in a
markup language embedded in tagged templates. `${}` holes carry data, child nodes and
event handlers:

```js
import { ui, mount } from './src/ui/index.js';

let count = 0;
const view = () => ui`
  column gap=10 pad=24 {
    text "Clicked ${count} times" size=20 bold
    row gap=8 {
      button "Add one" on:click=${() => count++}
      link "Reset" dim on:click=${() => (count = 0)}
    }
    ${['alpha', 'beta'].map((name) => ui`text ${name} key=${name}`)}
  }`;

const app = mount(vd, view, { style: { size: 12 } });
```

**Syntax.** `type ["content"] attr=value attr ... { children }`. A node ends at a newline,
`;` or `}`, so several nodes can share a line: `row { text "a"; text "b" }`. Values can be
strings (which may contain holes), numbers, bare words or holes, and a bare attribute
means `true`. A hole in attribute position spreads an object of props, and `//` starts a
comment. A child hole may be a node, an array of nodes, a string, or `null`/`false`.
Templates are parsed once per call site. Errors name the problem and the template line,
e.g. `"link" starts a new element; separate nodes with a newline or ";"`. If you'd rather
not use templates, `h(type, props, ...children)` builds the same nodes.

**Elements**

| element | what it is |
| --- | --- |
| `column`, `row` | flex containers: `gap`, `pad`, `align` (`start` `center` `end` `stretch`, plus `baseline` for rows; rows default to baseline), `justify` (`start` `center` `end` `between`). When a row overflows, its `wrap` text gives up width and wraps |
| `box` | a column with a border |
| `stack` | children on top of each other |
| `scroll` | a column that clips and scrolls (wheel, arrow keys, touch drag) and has a scrollbar |
| `text "..."` | `size`, `bold`, `wrap`, `align` (`left` `center` `right`), `underline` |
| `link "..."` | text that underlines on hover; `on:click`, or `href` (`#...` routes, anything else opens a new tab) |
| `button "..."` | chamfered, bordered label |
| `input` | single-line field: `value`, `placeholder`, `password`, `autofocus`, `on:input(value)`, `on:submit(value)` |
| `icon "name"` | `upvote` `downvote` `chevron-*` `arrow-left/right` `close` `plus` `minus` `check` `menu` `search` `circle` `star` `external` `dot` |
| `divider` | a line across its parent (vertical inside a row) |
| `spacer` | flexible space, or a fixed gap with `size=` |

Every element also takes `key`, `width`/`height` (a number or `fill`), `grow`,
`pad` (CSS-style shorthand) or `padX`/`padY`, `border` (`true` or `dashed`) with
`chamfer=`, and `fill=hatch` (a line-hatched background that leaves a margin around the
content, with `hatch=` spacing). `on:click` makes any element clickable. `color`,
`size`, `spacing` and `lineHeight` are inherited; `intensity` multiplies down the tree,
and `dim`/`bright` are shorthands for it.

**Rendering.** Every render lays out and paints the tree into keyed draw items, then
reconciles them with the shapes already on the tube:
- An unchanged item stays put, and a moved one slides into place, leaving a phosphor ghost.
- An item whose content changed fades out while the beam traces its replacement.

So hiding a story slides the rows below it up and re-traces only the rank numbers.
Typing traces one glyph per keystroke. Content that scrolls into view is held back until
the scroll comes to rest. With the display in `order: 'scan'` (as the news terminal is),
the beam then paints the newly revealed area strictly top-down, whichever direction you
scrolled. Whatever is under the pointer or focus still jumps the beam queue. Give list items a `key` so
they keep their identity when they move.

Handlers run, then the view re-renders on the next frame; call `app.invalidate()` after
changing state anywhere else. Hover, focus and the caret only repaint, and scrolling only
re-positions the existing layout, so those stay cheap even on a 500-comment thread. Hover, Tab and Shift+Tab focus (shown as corner
brackets), Enter and Space activation, a blinking caret, and soft keyboards on touch
devices are handled by the runtime.

## How it works

- **Beam:** shapes are traced at a finite speed. Blank moves between strokes are cheap
  but not free, and each stroke start has a small settle time.
- **Phosphor:** an RGBA16F accumulation buffer holds slow and fast components for each
  colour. The beam head adds a short hot flash plus an afterglow that decays over
  `persistence`. Removed or moved lines stop being refreshed and fade.
- **Refresh:** by default, lines on the display list are topped up every frame to hold a
  steady brightness. In `refresh: 'beam'`, the beam serves new shapes first, then walks the
  display list (top-down in `'scan'` order). Each visit tops a line back up to full
  brightness, so how dim a line gets depends only on how long the beam took to come back.
  A line that moved since its last visit is dark where it is now until the beam reaches it.
  Once moved lines come to rest (after a scroll, say), they're repainted first, top-down,
  before the regular pass carries on.
  With `ghostFade`, the buffer itself decays at the faster ghost rate, and lines still on
  the display list are topped up each frame to make up the difference. So only the
  leftovers fade quickly.
- **Spot:** each segment is the analytic integral of a gaussian spot swept along it, so
  polylines join seamlessly. Ends and corners get extra dwell energy, as on real hardware.
- **Composite:** a 4-level bloom, a saturating tone curve (bright cores bleach toward
  white), barrel distortion, phosphor grain, and a near-black glass tint. There are no
  scanlines, because vector monitors don't have any.

It needs WebGL2. If float render targets (`EXT_color_buffer_float`) are missing, it falls
back to 8-bit buffers with scaled energies and dithered bloom.
