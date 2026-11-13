# Task views: Relations, Span, visual search — developer notes

Owner: P1b. Files: `js/tasks/relations/view.js` (`HF.views.relations` + the shared `HF.views.kit`),
`js/tasks/span/view.js` (`HF.views.span`), `js/tasks/vsearch/view.js` (`HF.views.vsearch`), `css/views.css`,
e2e `tests/e2e/test_views_*.py` with the harness `tests/e2e/pages/views.html`. Every file's header comment is the
contract; this page explains the choices. Contract: `docs/dev/contracts-ui.md` §1.

## How a caller uses them

```js
var view = HF.views.relations.create(root, spec, ctx);     // or HF.views.vsearch / HF.views.span
// streams and arrays: the core runners, with the view's suggested options merged in
var log = await HF.timing.runStream(spec, view, Object.assign({}, view.runOpts, myOpts));   // rel.steps, rel.stream
var log = await HF.timing.runDiscrete(spec, view, Object.assign({}, view.runOpts, myOpts)); // rel.grid.*, vs.search
// span: its own flow
var log = await view.run({ timing: HF.timing, input: HF.input, onProgress: fn, onPause: fn? });
var result = HF.tasks.relations.score(spec, log);           // / span.score / vsearch.score, unchanged
view.destroy();
```

- `root` should have a definite height (the screen area while chrome is hidden). The view fills it: head (rule line or
  status), the stage (stimulus, centred) and the pads at the bottom. Square stimuli are `--hf-v-side` wide =
  min(stage width, 34rem, 100svh − `--hf-v-reserve`); a caller that keeps its own bar above the view adds that bar's
  height to `--hf-v-reserve` on the root.
- `view.kind` is `'stream' | 'discrete' | 'custom'`; `view.runOpts` = `{ keys }` plus, for Relation Stream,
  `leadMs = max(500, meta.initialMs − soaMs)` (see below). `view.pads` are the pad buttons (`data-key`), handled by
  HF.input's pointerdown listener; nothing else is needed for touch.
- `view.feedback(outcome, key?)` (`'good' | 'bad'`) sets `data-fb` on the pad for 300 ms, at most 3 per second (extra
  calls return false); without `key` it flashes the last pad pressed, else MATCH. Keyboard presses also show
  `.is-down` on the matching pad for 120 ms (pointer presses get it from HF.input).
- `view.reset(spec)` re-renders for a new spec (a stream restarted with a fresh seed); re-creating the view also works.
- `view.mark(cells | null)` (Grid, Stream) frames cells, e.g. the target line in a lesson; not during timed runs.
- `HF.views.relations.renderGrid(el, spec, trial, { highlight, mark })` draws a static array for lessons and examples;
  `HF.views.relations.symbolHTML(spec, value)` one symbol (order keys, examples).

## Timing discipline

- `prepare(trial)` runs in a timer during the blank and writes markup built from cached strings (every symbol's SVG
  is built once per view) into hidden elements. `show()` / `hide()` only flip classes whose CSS is `visibility`, so no
  layout happens in the stimulus frame, and nothing is read. No transitions or animations anywhere in `views.css`.
- Equal Steps double-buffers the number (and the assist tape), so `prepare(next)` never touches what is on screen
  even when an item is persistent.
- Relation Grid keeps the cell frames on screen; the 0.1 s blank hides the strings only (no flicker of the grid).
- Relation Stream: every cell has two layers. `prepare(trial)` compares the trial's full grid with what is on screen
  and writes only differing cells into their hidden layer; `show()` swaps exactly those layers (the e2e audit checks
  that the swapped cells equal the generator's `changed` list). The runner calls `hide(prev)` and `show(next)` in the
  same frame, which cancel out, so the grid never blanks; `hide()` alone (end, pause) conceals it.
- **First stream view:** `prepare(trial 0)` reveals the first grid at once, so it stays up during the runner's lead-in.
  With `leadMs = initialMs − soaMs` the first view lasts `meta.initialMs` (measured ≈ 3,050 ms for 3,000). Trial 0 is not
  scorable, so its logged onset (later than its first paint) does not matter.
- Measured on this shared 2-CPU machine (headless Chromium, 60 Hz): items 500 ms ± 1 frame, SOA ± 1 frame,
  memoranda 1,000 ms ± 1 frame, first stream view 3,047–3,056 ms for 3,000; no long animation frame in Long-Horizon
  scripts. Other processes occasionally drop a frame (33–50 ms): at most one item per block was voided, and the
  scorers excluded it. The stream tests retry a block (≤ 3 attempts, as the core timing test) only in that case.

## Relations

- **Equal Steps:** one large number (`clamp(5rem, 24vmin, 10rem)`, tabular figures) + MATCH. `ctx.assist.steps`
  (tutorial only) adds a tape of the last b + 2 numbers with "step k" under each (k = |x − the number b back|): the
  number the new one is compared with is dashed, the last step is bold. The learner still computes the new step.
- **Grid:** rule line from `spec.meta.rule.text` (shown as "Match …", "and" in bold, never all-caps), the order key
  when `meta.rule.orderKey` is set (T2 with icons, bars, glyphs, lab or colours: symbols with ranks 1–8, "1 = lowest"),
  then the grid, then NO (F, left) and MATCH (J). No countdown. Strings are 3 symbols in a row with equal weight; only
  `ctx.assist.highlight` dims the two irrelevant symbols and underlines the relevant one.
- **Symbols:** digits and letters as text (cells are strings; fixed-width slots, wider for letters so "M" never
  crowds); icons = `HF.sets.shapePath` filled; dots = canonical 3×3 layouts per numerosity (1 centre, 2 diagonal, …,
  8 ring, 9 full) on die-face tiles, so 7, 8 and 9 differ by pattern and the three groups never run together; bars = a thick rounded line at 22.5° × index clockwise from vertical; glyphs = `HF.sets.glyphPath` with
  `HF.sets.glyphStyle` (stroke or fill); lab = a frame with one dot in grid8 position; colours (opt-in only) =
  Okabe–Ito swatch plus a distinct pattern per colour, so colour is never the only cue (`forced-color-adjust: none`).
- **T6:** one symbol per cell, the shape's outline filled with a pattern (solid, empty, horizontal lines, vertical lines,
  dots, checks: SVG patterns defined once per view in `currentColor`). Glyph families (stroked lines cannot hold a
  fill) put the glyph on a patterned tile with a surface-coloured halo.
- Sizes use container units of the grid (`cqw`, with rem fallbacks): 3×3 symbols 8.4cqw, text 9.4cqw; 4×4 6.2/7cqw;
  T6 symbols 19cqw. On a 360 px phone a 3×3 grid is 328 px: text ≈ 31 px, symbols ≈ 28 px; T7 cells ≈ 82 px.

## Span

`view.run(ctx2)` runs the block as one `HF.timing.custom(handlers, { kind: 'span' })` flow, from the start of the run
to the log, and drives the stimuli with `flow.frame()` (onset = the frame timestamp in which an item is made
visible; the next frame is logged as `shown`), durations counted in frames of the interval measured at the start
(`HF.timing.measureFrameInterval`), RTs from `event.timeStamp`. A list = a short blank, then per pair: judgement
("7 − 3 = 4" / "Right or wrong?", F/left = wrong, J/right = right, up to `spec.procLimitMs`, no countdown) → 250 ms →
memorandum for `spec.memMs` → 250 ms; then the recall keypad (the 12 symbols in fixed order, Skip, Delete, Done;
keyboard: type the symbol, Backspace, Enter). Between lists a 1.2 s "List 2 of 3" (with per-response feedback, also
"3 of 4 in the right place · sums: 4 of 4 right", computed with `HF.tasks.span.expected`, the scorer's comparison).

- **Skip** (from the automated OSPAN's "blank") keeps serial positions when an item is forgotten, which partial-credit
  scoring needs; it is logged as `null`. Entries beyond the set size are ignored. Pointer presses on the keypad do
  not move focus (mousedown is prevented), so Enter always means Done; keyboard users still Tab to the keys.
- Typing in recall is caught in the capture phase, so letters that are also answer or pause keys (F, J, K, P) are
  symbols there; Escape still pauses. The block stays busy through recall, so Space on a focused keypad key is let
  through to the button (HF.input would otherwise turn it into `next`).
- **Pause**: every source goes through the flow — Escape/P (the core's HF.input listener), page hidden, `pagehide`,
  `HF.timing.pause/resume/abort` (e.g. the player's own controls), `view.pause/resume/abort` (= the flow's) and the
  built-in panel. The core keeps the first pause start, appends later reasons and tells `HF.timing.onPause`
  subscribers; the view's `pause` handler voids the list in progress (any phase up to Done), its `resume` handler
  starts the next list after a 1 s "Get ready", its `abort` handler voids the rest. If `ctx2.onPause(info)` is given
  (info adds `voided`) the caller shows its own pause UI and resumes with `view.resume()` or `HF.timing.resume()`;
  otherwise a small built-in panel (Resume focused, End block) appears in the stage and the inactive judgement pads
  are hidden (visibility only, nothing moves). A player that shows an overlay for every `HF.timing.onPause` event
  should pass `ctx2.onPause` (a no-op is enough) so the built-in panel stays away.
- **Voiding** (never charge a dropped frame): pause; a memorandum painted late (> 1.5 frames) or on for more than
  memMs ± 1.5 frames; a judgement that timed out after a late paint or a frame gap > 2.5 intervals while displayed.
  Answered judgements are not voided by a stall (only their RT is affected). Flags are logged either way.
- Busy, `<html data-busy>` and the wake lock belong to the flow: on from `run()` to the log, off while paused (the
  view no longer touches `HF.timing.busy` itself).
- Log = SPEC §4.4 plus per-item onsets/shown/offsets, flags, `recallRts`, `recallMs`, `voidReason`, `pauses` (the
  flow's, with the phase each began in), `aborted`, `abortReason`, `interval`, `frame` (times from t0 = the first
  judgement onset). Abort lists unplayed lists as voided
  (`'not-presented'`), so the scorer never counts them as wrong.

## Visual search

One SVG whose viewBox is the 100-unit field, so the box width is the field width. The box is never narrower than
`spec.field.minFieldPx` (360 px: full-bleed on a 360 px phone, spilling into the view's padding, centred) and grows to
38rem or what the height allows. Each item fills the generator's 7-unit box (±3.5 units including a 1-unit stroke):
25.2 px items and 3.6 px strokes at the minimum, ≥ 3.6 px between items at 64 (10 × 10 grid). T = bar + upright;
L = foot + upright standing 1.1 units in from the foot's end (an "offset L", so the junction is not a plain corner).
A fixation cross shows in the blank only. Pads: Absent (F, left), Present (J). Covered in e2e at 8 … 64 items,
desktop, 390 px and 360 px phones (field exactly 360 px there).

## Tests (`tests/e2e/test_views_*.py`, Chromium, one browser at a time)

`test_views_relations.py`, `test_views_span.py`, `test_views_vsearch.py` play scripted blocks (perfect and imperfect)
with real key presses (desktop 1366×768) and taps (phone 390×844), light and dark, through the real runners, and
check the scorers' results, frame accuracy, pauses, busy flags, layout (no scrolling) and console errors;
`test_views_srcdoc.py` plays a Grid, Stream, Span and search block by clicks inside a sandboxed `srcdoc` iframe
(opaque origin, storage blocked); `test_views_shots.py` writes the screenshots to `out/views/`;
`test_views_all.py` runs all five and writes `out/views/summary.json`.
