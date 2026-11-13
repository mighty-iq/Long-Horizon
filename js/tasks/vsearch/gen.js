/* Long-Horizon — visual search generator (pure, no DOM). MIT licence.
   Track vs.search (SPEC §2.1, §5): is there a T among rotated Ls? 'match' = present (J), 'no' = absent (F).
   The active control of Study mode (PLAN §6): no memory load, same adaptive rule as training.
   Ladder (SPEC §5, amended): rung r = 0…17 → size = [8, 12, 16, 24, 32, 40, 48, 56, 64][floor(r / 2)],
   windowMs = r odd ? 2000 : 3000; r = 18, 19 → 64 items with 1500 and 1000 ms (amended 12 Nov, Phase 4).
   Block: params.trials displays (an even number 2–200; training and Study blocks get 40 from the catalog, SPEC §5
   amended 12 Nov, Phase 4 SC-02; callers without params, such as the lesson check, get 20), exactly half
   target-present (seeded order), itiMs 500.

   HF.tasks.vsearch.gen(opts) → DiscreteBlockSpec (SPEC §4.3)
     opts = { trackId: 'vs.search', rung, params?: { size?, windowMs?, trials? }, seed, set? }
     { kind: 'discrete', task: 'vsearch', trackId, seed, set: 'tl', rung, params: { size, windowMs, trials }, windowMs, itiMs: 500,
       field: { w: 100, h: 100, grid, cell, item: 7, jitter, minGap, minFieldPx: 360, itemPx },
       trials: [ { i, answer: 'match'|'no',
                   stim: { present: bool, size, items: [ { x, y, rot: 0|90|180|270, kind: 'T'|'L', cell } ] },
                   meta: { target: <item index>|null } } ],
       meta: { present: trials / 2, solverChecked: true } }
   Layout (field units; the view scales the 100 × 100 field to the screen; x, y = item centre; cell is row-major):
     size ≤ 48: invisible 8 × 8 grid, cell 12.5, jitter ± 2 → at least 1.5 units between item boxes;
     size 56, 64: invisible 10 × 10 grid, cell 10, jitter ± 1 → at least 1 unit between item boxes.
   Each item takes a distinct random cell, so bounding boxes never overlap, and no display fills its grid
   (at most 75 % of the cells), so layouts stay irregular. Item size is the same at every set size (7 units), so
   difficulty comes from the number of items, not from smaller drawings.
   Legibility assumption: the view draws the field at least 360 CSS px wide (field.minFieldPx). Then an item is at least
   25 px across (field.itemPx = 25.2, about 1° of visual angle at 35 cm), with at least 3.6 px between items at 64; the
   view should draw strokes of at least 3 px (about 1/7 of the item).
   Every item (T or L) gets an independent random rotation; on present displays the T replaces one L, so set size,
   rotations and positions carry no information about the answer.
   HF.tasks.vsearch.LADDER(rung) → { size, windowMs }; HF.tasks.vsearch.layout(size) → field;
   HF.tasks.vsearch.solve(stim) → 'match'|'no'; HF.tasks.vsearch.SIZES; HF.tasks.vsearch.MAX_RUNG = 19.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var api = tasks.vsearch || (tasks.vsearch = {});

  var SIZES = [8, 12, 16, 24, 32, 40, 48, 56, 64];
  var TOP_WINDOWS = [1500, 1000];          // r = 18, 19: shorter deadlines at 64 items
  var MAX_RUNG = 2 * SIZES.length - 1 + TOP_WINDOWS.length; // 19
  var ITEM = 7, MIN_FIELD_PX = 360;
  var ROTS = [0, 90, 180, 270];
  var TRIALS = 20, ITI_MS = 500;   // default display count when params.trials is not given (lessons, figures)

  function layout(size) {
    var grid = size > 48 ? 10 : 8;
    var cell = 100 / grid, jitter = grid === 8 ? 2 : 1;
    return {
      w: 100, h: 100, grid: grid, cell: cell, item: ITEM, jitter: jitter, minGap: cell - 2 * jitter - ITEM,
      minFieldPx: MIN_FIELD_PX, itemPx: Math.round(ITEM * MIN_FIELD_PX / 100 * 10) / 10
    };
  }

  function ladder(rung) {
    var r = Math.max(0, Math.min(MAX_RUNG, rung | 0));
    if (r >= 2 * SIZES.length) return { size: SIZES[SIZES.length - 1], windowMs: TOP_WINDOWS[r - 2 * SIZES.length] };
    return { size: SIZES[Math.floor(r / 2)], windowMs: r % 2 ? 2000 : 3000 };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function display(rng, F, size, present) {
    var cells = [];
    for (var c = 0; c < F.grid * F.grid; c++) cells.push(c);
    var chosen = rng.sample(cells, size);
    var items = chosen.map(function (cell) {
      var row = Math.floor(cell / F.grid), col = cell % F.grid;
      return {
        x: round2((col + 0.5) * F.cell + (rng.next() * 2 - 1) * F.jitter),
        y: round2((row + 0.5) * F.cell + (rng.next() * 2 - 1) * F.jitter),
        rot: rng.pick(ROTS), kind: 'L', cell: cell
      };
    });
    var target = null;
    if (present) { target = rng.int(0, size - 1); items[target].kind = 'T'; }
    return { stim: { present: !!present, size: size, items: items }, target: target };
  }

  function solve(stim) {
    var t = 0;
    (stim.items || []).forEach(function (it) { if (it.kind === 'T') t++; });
    return t === 1 ? 'match' : 'no';
  }

  function gen(opts) {
    opts = opts || {};
    var rung = opts.rung == null ? 0 : Math.max(0, Math.min(MAX_RUNG, opts.rung | 0));
    var lad = ladder(rung), params = opts.params || {};
    var size = params.size && SIZES.indexOf(params.size) >= 0 ? params.size : lad.size;
    var windowMs = params.windowMs || lad.windowMs;
    var nT = Math.floor(+params.trials);
    nT = nT >= 2 && nT <= 200 ? nT - (nT % 2) : TRIALS;
    var seed = String(opts.seed == null ? 'vsearch' : opts.seed);
    var rng = HF.rng.create(seed);
    var F = layout(size);
    var flags = [];
    for (var j = 0; j < nT; j++) flags.push(j < nT / 2);
    flags = rng.shuffle(flags);
    var trials = flags.map(function (present, i) {
      var d = display(rng, F, size, present);
      return { i: i, answer: present ? 'match' : 'no', stim: d.stim, meta: { target: d.target } };
    });
    return {
      kind: 'discrete', task: 'vsearch', trackId: 'vs.search', seed: seed, set: 'tl', rung: rung,
      params: { size: size, windowMs: windowMs, trials: nT }, windowMs: windowMs, itiMs: ITI_MS,
      field: F, trials: trials, meta: { present: nT / 2, solverChecked: true }
    };
  }

  api.gen = gen;
  api.LADDER = ladder;
  api.layout = layout;
  api.SIZES = SIZES;
  api.MAX_RUNG = MAX_RUNG;
  api.TRIALS = TRIALS;
  api.FIELD = layout(SIZES[0]);
  api.solve = solve;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
