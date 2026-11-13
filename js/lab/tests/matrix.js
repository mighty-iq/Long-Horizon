/* Long-Horizon Lab — lab.matrix: generated 3×3 figural matrices. Pure module (no DOM, deterministic per seed). MIT licence.

   Paradigm: Sandia/RAVEN-style matrices (rule types after Matzen et al. 2010, which Wang et al. 2025 used) with an
   I-RAVEN-style attribute-bisection answer set (Hu et al. 2021). Our own generator, shapes and items: no Raven, ICAR,
   OMIB, MaRs or Sandia items or code. Full format notes: docs/dev/lab-items.md.

   API — the test object is registered with HF.lab.register (or queued in HF.labPending) and exported for node:
     gen({ form: 'A'|'B'|'C'|'D', seed? }) → TestSpec   Omit `seed` in real visits: the fixed release seed of the form
                                                        is used, so community data stay comparable. Any other seed gives
                                                        a fresh instance of the same blueprint (tests, practice).
     score(spec, log) → TestResult                      rows(spec, log) → [ExportRow]   (one row per trial)
     practice() → TestSpec (form 'P', practice: true)  the rule tutorial as an unscored spec, identical at every visit
     tutorial() → { intro, ruleTypes, items: [TutorialItem] }   same content (research/04 §11.2); gen() also copies it into
                                                        spec.instructions / ruleTypes / practice
     solve(item) → { ok, matches, predictions, ambiguous, unexplained, distinct }   independent brute-force solver that
                                                        works only from the drawn shapes (perceive → rule hypotheses)
     explain(item) → [sentence]                         rule text for feedback in the tutorial
     shapePath(type) → SVG path data (0 0 100 100 box, centre 50 50, radius ≈ 45), SHAPES (type → { sym, family })
     genItem(template, seedString, answerPos) → Item, BLUEPRINT_ITEMS, shortcuts.* (answer-only pickers, for tests)

   TestSpec (SPEC §4.3 discrete shape, extended):
     { kind: 'discrete', task: 'lab', testId: 'lab.matrix', trackId: 'lab.matrix', form, seed, release: bool,
       blueprint: 'matrix-1', set: 'labMatrix', rung: null, params: { nScored: 18, nChecks: 2 },
       windowMs: 45000, itiMs: 500, tooFastMs: 2000, instructions: <intro>, ruleTypes: [3 strings],
       practice: [TutorialItem] (4 worked examples with explain[]; unscored), trials: [Trial] (18 scored + 2 checks),
       meta: { solverChecked: true, fallback: [ { i, template } ] } }
     Trial = { i, check: bool, stim: Stim, answer: <option index 0–7>, meta: ItemMeta }
     Stim  = { layout: 'one'|'grid'|'pair', cells: [8 Cell] (row-major; the 9th, bottom-right, is the blank), options: [8 Cell] }
     Cell  = { shapes: [ { type, fill, x, y, r, rot } ] }  x, y = centre and r = radius in a 0–100 cell box;
             rot = degrees clockwise. Draw shapePath(type) with transform
             `translate(x y) rotate(rot) scale(r / 45) translate(-50 -50)`. fill ∈ none | solid | lines | dots | grid
             (black-and-white patterns; no colour anywhere in this test).
     ItemMeta = { template, nRules, rules: [ { slot, rule: 'prog'|'dist3', variant: 'same'|'shift'|'latin', dir: 'h'|'v'|'both', step } ],
                  constants: [ { slot, value } ], layout, elements, plaus: 'near'|'far', split: [slot...], answerPos, attempts }
   Log (SPEC §4.3): { answers: [ { i, response: 0–7 | null, rt: ms | null, voided: bool, timedOut?: bool } ], paused: bool }
   TestResult: { score: proportion correct over scored items that were administered and not voided (timeouts = wrong),
                 scoreLabel, sub: { correct, n, nItems, timeouts, voided, missing, tooFast, medianRtCorrect, byRules, checks },
                 flags: [ 'incomplete' | 'many-voided' | 'too-fast' | 'check-failed' ] }

   Rules: every attribute slot ('c0.size' = size of component 0) follows exactly one rule; 1–4 slots vary, the rest are
   constant. prog = equal steps along rows (h) or columns (v); 'same' = every row identical, 'shift' = each row starts
   elsewhere. dist3 = three values once each per row/column; 'same' = identical rows (h) or columns (v), 'latin' = every
   row AND column holds the three values. Options = the product of value pairs on 3 slots (2 × 2 × 2) or 4 × 2 values on
   2 slots, so every option value appears equally often and no option stands out: answer-only shortcuts fall to chance.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var TEST_ID = 'lab.matrix';
  var BLUEPRINT = 'matrix-1';
  var VERSION = 1;
  /** The fixed release seed of a form: HF.lab.formSeed when the registry is loaded, else the same string. */
  function defaultSeed(form) {
    return (HF.lab && typeof HF.lab.formSeed === 'function') ? HF.lab.formSeed(TEST_ID, form) : 'holdfast/lab/v1/' + TEST_ID + '/' + form;
  }
  var FORMS = ['A', 'B', 'C', 'D'];
  /** Adds the registry's shared TestResult fields (HF.lab.makeResult shape): testId, form, seed, version. */
  function stamp(spec, r) {
    r.testId = TEST_ID; r.form = spec.form || null; r.seed = spec.seed || null; r.version = spec.version || VERSION;
    return r;
  }
  var TUTORIAL_SEED = 'holdfast-lab1/matrix/tutorial';
  var MAX_ATTEMPTS = 200;
  var WINDOW_MS = 45000, ITI_MS = 500, TOO_FAST_MS = 2000, PRACTICE_WINDOW_MS = 120000;

  // ---------------------------------------------------------------- shapes (our own simple paths)
  function r1(x) { return Math.round(x * 10) / 10; }
  function poly(pts) { return 'M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + 'Z'; }
  function regular(k, offsetDeg, rad) {
    var pts = [];
    for (var j = 0; j < k; j++) {
      var a = (offsetDeg + 360 * j / k) * Math.PI / 180;
      pts.push([50 + rad * Math.sin(a), 50 - rad * Math.cos(a)]);
    }
    return pts;
  }
  function star(k, ro, ri) {
    var pts = [];
    for (var j = 0; j < 2 * k; j++) {
      var a = (180 * j / k) * Math.PI / 180, rad = j % 2 ? ri : ro;
      pts.push([50 + rad * Math.sin(a), 50 - rad * Math.cos(a)]);
    }
    return pts;
  }
  // sym = order of rotational symmetry (0 = continuous). Orientation is only ever varied or used in options with sym 1.
  // fw = interior width (≈ inscribed-circle diameter, path units): a fill pattern is judged only where fw · r / 45 ≥ FILL_MIN.
  var SHAPES = {
    circle:    { sym: 0, fw: 90, family: 'sym', path: 'M5 50A45 45 0 1 1 95 50A45 45 0 1 1 5 50Z' },
    square:    { sym: 4, fw: 64, family: 'sym', path: poly(regular(4, 45, 45)) },
    triangle:  { sym: 3, fw: 45, family: 'sym', path: poly(regular(3, 0, 45)) },
    pentagon:  { sym: 5, fw: 73, family: 'sym', path: poly(regular(5, 0, 45)) },
    hexagon:   { sym: 6, fw: 78, family: 'sym', path: poly(regular(6, 0, 45)) },
    diamond:   { sym: 2, fw: 47, family: 'sym', path: poly([[50, 5], [78, 50], [50, 95], [22, 50]]) },
    star:      { sym: 5, fw: 22, family: 'sym', path: poly(star(5, 46, 19)) },
    cross:     { sym: 4, fw: 26, family: 'sym', path: poly([[37, 6], [63, 6], [63, 37], [94, 37], [94, 63], [63, 63], [63, 94], [37, 94], [37, 63], [6, 63], [6, 37], [37, 37]]) },
    arrow:     { sym: 1, fw: 24, family: 'asym', path: poly([[50, 5], [86, 44], [62, 44], [62, 95], [38, 95], [38, 44], [14, 44]]) },
    kite:      { sym: 1, fw: 40, family: 'asym', path: poly([[50, 5], [80, 38], [50, 95], [20, 38]]) },
    half:      { sym: 1, fw: 45, family: 'asym', path: 'M5 72.5A45 45 0 0 1 95 72.5Z' },
    trapezoid: { sym: 1, fw: 48, family: 'asym', path: poly([[32, 24], [68, 24], [93, 76], [7, 76]]) },
    ell:       { sym: 1, fw: 25, family: 'asym', path: poly([[20, 5], [45, 5], [45, 70], [80, 70], [80, 95], [20, 95]]) },
    tee:       { sym: 1, fw: 24, family: 'asym', path: poly([[8, 9], [92, 9], [92, 34], [62, 34], [62, 92], [38, 92], [38, 34], [8, 34]]) },
    house:     { sym: 1, fw: 60, family: 'asym', path: poly([[50, 6], [92, 42], [92, 92], [8, 92], [8, 42]]) },
    tomb:      { sym: 1, fw: 60, family: 'asym', path: 'M20 88L20 42A30 30 0 0 1 80 42L80 88Z' },
    drop:      { sym: 1, fw: 56, family: 'asym', path: 'M50 5L80 50A33 33 0 1 1 20 50Z' },
    rtri:      { sym: 1, fw: 40, family: 'asym', path: poly([[16, 84], [84, 84], [16, 16]]) }
  };
  var SYM = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'diamond', 'star', 'cross'];
  var ASYM = ['arrow', 'kite', 'half', 'trapezoid', 'ell', 'tee', 'house', 'tomb', 'drop', 'rtri'];
  var ALL_TYPES = SYM.concat(ASYM);
  var FAT_MIN_FW = 40, FILL_MIN = 14;      // fill-carrying shapes: fw ≥ 40; a visible pattern: ≥ 14 % of the cell across
  var FILLS = ['none', 'solid', 'lines', 'dots', 'grid'];
  var SIZE_FRAC = [0.45, 0.63, 0.82, 1.0];
  var NAMES = {
    type: { circle: 'circle', square: 'square', triangle: 'triangle', pentagon: 'pentagon', hexagon: 'hexagon', diamond: 'diamond', star: 'star', cross: 'cross', arrow: 'arrow', kite: 'kite', half: 'half-disc', trapezoid: 'trapezoid', ell: 'L-shape', tee: 'T-shape' },
    fill: { none: 'empty', solid: 'solid', lines: 'striped', dots: 'dotted', grid: 'checked' },
    size: ['small', 'medium', 'large', 'very large'],
    pos: ['top left', 'top right', 'bottom right', 'bottom left']
  };
  NAMES.type.house = 'house'; NAMES.type.tomb = 'arch'; NAMES.type.drop = 'drop'; NAMES.type.rtri = 'right triangle';

  function shapePath(type) { return SHAPES[type] ? SHAPES[type].path : SHAPES.circle.path; }

  // ---------------------------------------------------------------- attributes and layouts
  var KIND = { type: 'cat', fill: 'cat', size: 'ord', count: 'ord', orient: 'cyc', pos: 'cyc' };
  var DOMAIN = { size: [0, 1, 2, 3], count: [1, 2, 3, 4], orient: [0, 1, 2, 3, 4, 5, 6, 7], pos: [0, 1, 2, 3], fill: FILLS };
  var PERIOD = { orient: 8, pos: 4 };
  var LAYOUTS = {
    one:  { comps: [[50, 50]], R: 40, attrs: ['type', 'size', 'fill', 'orient'] },
    grid: { comps: [[50, 50]], R: 19, attrs: ['type', 'size', 'fill', 'orient', 'count', 'pos'] },
    pair: { comps: [[27, 50], [73, 50]], R: 21, attrs: ['type', 'size', 'fill', 'orient'] }
  };
  var CORNERS = [[30, 30], [70, 30], [70, 70], [30, 70]];           // pos 0..3, clockwise from top left
  var COUNT_LAYOUT = { 1: [[50, 50]], 2: [[30, 50], [70, 50]], 3: [[30, 31], [70, 31], [50, 71]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]] };

  function attrOf(slot) { return slot.split('.')[1]; }
  function compOf(slot) { return +slot.charAt(1); }
  function slotsOf(layout) {
    var L = LAYOUTS[layout], out = [];
    for (var k = 0; k < L.comps.length; k++) for (var a = 0; a < L.attrs.length; a++) out.push('c' + k + '.' + L.attrs[a]);
    return out;
  }
  function mod(a, p) { return ((a % p) + p) % p; }

  // ---------------------------------------------------------------- blueprint (identical for forms A–D)
  // rules: [slot, rule, variant]; split: [[slot, k]] with Π k = 8; plaus: 'far' (easier: odd alternative values)
  // or 'near' (harder: alternatives taken from the matrix and one step away — minimal-difference distractors).
  function T(layout, rules, split, plaus) {
    return { layout: layout, rules: rules.map(function (r) { return { slot: r[0], rule: r[1], variant: r[2] }; }), split: split, plaus: plaus };
  }
  var BLUEPRINT_ITEMS = [
    T('one',  [['c0.size', 'prog', 'same']], [['c0.size', 4], ['c0.fill', 2]], 'far'),
    T('one',  [['c0.type', 'dist3', 'same']], [['c0.type', 4], ['c0.fill', 2]], 'far'),
    T('grid', [['c0.pos', 'prog', 'same']], [['c0.pos', 4], ['c0.type', 2]], 'far'),
    T('one',  [['c0.fill', 'dist3', 'same'], ['c0.size', 'prog', 'same']], [['c0.fill', 4], ['c0.size', 2]], 'far'),
    T('one',  [['c0.type', 'dist3', 'same'], ['c0.orient', 'prog', 'same']], [['c0.type', 4], ['c0.orient', 2]], 'far'),
    T('grid', [['c0.count', 'prog', 'same'], ['c0.type', 'dist3', 'same']], [['c0.type', 4], ['c0.count', 2]], 'far'),
    T('one',  [['c0.type', 'dist3', 'latin'], ['c0.fill', 'dist3', 'same'], ['c0.orient', 'prog', 'same']], [['c0.type', 2], ['c0.fill', 2], ['c0.orient', 2]], 'far'),
    T('pair', [['c0.type', 'dist3', 'same'], ['c1.size', 'prog', 'same'], ['c1.fill', 'dist3', 'same']], [['c0.type', 2], ['c1.size', 2], ['c1.fill', 2]], 'far'),
    T('grid', [['c0.count', 'prog', 'shift'], ['c0.fill', 'dist3', 'same'], ['c0.size', 'prog', 'same']], [['c0.count', 2], ['c0.fill', 2], ['c0.size', 2]], 'far'),
    T('one',  [['c0.orient', 'prog', 'shift'], ['c0.type', 'dist3', 'same'], ['c0.fill', 'dist3', 'latin']], [['c0.orient', 2], ['c0.type', 2], ['c0.fill', 2]], 'near'),
    T('pair', [['c0.size', 'prog', 'shift'], ['c1.type', 'dist3', 'latin'], ['c0.fill', 'dist3', 'same']], [['c0.size', 2], ['c1.type', 2], ['c0.fill', 2]], 'near'),
    T('grid', [['c0.pos', 'prog', 'shift'], ['c0.type', 'dist3', 'latin'], ['c0.fill', 'dist3', 'same']], [['c0.pos', 2], ['c0.type', 2], ['c0.fill', 2]], 'near'),
    T('pair', [['c0.type', 'dist3', 'latin'], ['c0.fill', 'dist3', 'same'], ['c1.size', 'prog', 'shift'], ['c1.orient', 'prog', 'same']], [['c0.type', 2], ['c1.size', 2], ['c1.orient', 2]], 'near'),
    T('pair', [['c0.type', 'dist3', 'same'], ['c0.orient', 'prog', 'shift'], ['c1.fill', 'dist3', 'latin'], ['c1.size', 'prog', 'same']], [['c0.orient', 2], ['c1.fill', 2], ['c1.size', 2]], 'near'),
    T('grid', [['c0.count', 'prog', 'shift'], ['c0.type', 'dist3', 'latin'], ['c0.fill', 'dist3', 'same'], ['c0.orient', 'prog', 'same']], [['c0.count', 2], ['c0.type', 2], ['c0.fill', 2]], 'near'),
    T('grid', [['c0.pos', 'prog', 'same'], ['c0.orient', 'prog', 'shift'], ['c0.fill', 'dist3', 'latin'], ['c0.type', 'dist3', 'same']], [['c0.pos', 2], ['c0.orient', 2], ['c0.fill', 2]], 'near'),
    T('pair', [['c0.fill', 'dist3', 'latin'], ['c0.size', 'prog', 'shift'], ['c1.type', 'dist3', 'latin'], ['c1.fill', 'dist3', 'same']], [['c0.fill', 2], ['c0.size', 2], ['c1.type', 2]], 'near'),
    T('pair', [['c0.size', 'prog', 'shift'], ['c0.fill', 'dist3', 'latin'], ['c1.type', 'dist3', 'latin'], ['c1.orient', 'prog', 'shift']], [['c0.size', 2], ['c1.type', 2], ['c1.orient', 2]], 'near')
  ];
  // Attention checks (research/04 §19): every cell identical; inserted after scored items 6 and 12.
  var CHECK_ITEM = T('one', [], [['c0.fill', 2], ['c0.size', 2], ['c0.orient', 2]], 'far');
  CHECK_ITEM.check = true;
  var CHECK_AFTER = [6, 12];
  // Rule tutorial (same at every visit): one "steps" rule, one "set of three", then two rules on number/fill and on position/rotation.
  var TUTORIAL_ITEMS = [
    T('one',  [['c0.size', 'prog', 'same']], [['c0.size', 4], ['c0.fill', 2]], 'far'),
    T('one',  [['c0.type', 'dist3', 'latin']], [['c0.type', 4], ['c0.fill', 2]], 'far'),
    T('grid', [['c0.count', 'prog', 'same'], ['c0.fill', 'dist3', 'same']], [['c0.count', 2], ['c0.fill', 2], ['c0.type', 2]], 'far'),
    T('grid', [['c0.pos', 'prog', 'same'], ['c0.orient', 'prog', 'same']], [['c0.pos', 2], ['c0.orient', 2], ['c0.size', 2]], 'far')
  ];
  var TUTORIAL_TEXT = {
    intro: 'Each puzzle is a 3 × 3 grid with the bottom-right cell missing. Every feature of the shapes (shape, size, fill, rotation, number, position) follows its own rule along the rows or down the columns. Choose the option that fits every rule. You have 45 seconds per puzzle.',
    rules: [
      'Same: a feature does not change.',
      'Steps: a feature changes by the same step each time: bigger, one more, a turn, or one corner further.',
      'Set of three: three different values each appear once in every row (or column).'
    ]
  };

  // ---------------------------------------------------------------- rendering (logical state → drawn shapes)
  function render(layout, st) {
    var L = LAYOUTS[layout], shapes = [];
    for (var k = 0; k < L.comps.length; k++) {
      var p = 'c' + k + '.';
      var r = r1(L.R * SIZE_FRAC[st[p + 'size']]);
      var rot = (st[p + 'orient'] || 0) * 45;
      var centres;
      if (layout === 'grid') {
        var count = st[p + 'count'], pos = st[p + 'pos'];
        centres = (count === 1 && typeof pos === 'number') ? [CORNERS[pos]] : COUNT_LAYOUT[count];
      } else centres = [L.comps[k]];
      for (var j = 0; j < centres.length; j++) {
        shapes.push({ type: st[p + 'type'], fill: st[p + 'fill'], x: centres[j][0], y: centres[j][1], r: r, rot: rot });
      }
    }
    return { shapes: shapes };
  }

  // ---------------------------------------------------------------- perception (drawn shapes → attribute values); solver side
  function canonRot(type, rot) {
    var k = SHAPES[type] ? SHAPES[type].sym : 1;
    var x = mod(rot, 360);
    if (k === 0) return 0;
    if (k === 1) return x;
    return Math.round(mod(x, 360 / k) * 1000) / 1000;
  }
  function nearestIdx(arr, x) {
    var best = 0;
    for (var i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[best] - x)) best = i;
    return best;
  }
  function cornerIndex(x, y) {
    for (var i = 0; i < 4; i++) if (CORNERS[i][0] === x && CORNERS[i][1] === y) return i;
    return -1;
  }
  function samePositions(shapes, pts) {
    if (!pts || shapes.length !== pts.length) return false;
    var a = shapes.map(function (s) { return s.x + ',' + s.y; }).sort().join(' ');
    var b = pts.map(function (p) { return p[0] + ',' + p[1]; }).sort().join(' ');
    return a === b;
  }
  function perceive(layout, cell) {
    var L = LAYOUTS[layout], sh = (cell && cell.shapes) || [], out = {};
    function from(p, s) {
      if (!SHAPES[s.type]) return false;
      out[p + 'type'] = s.type;
      out[p + 'fill'] = s.fill;
      out[p + 'size'] = nearestIdx(SIZE_FRAC, s.r / L.R);
      out[p + 'orient'] = canonRot(s.type, s.rot);
      return true;
    }
    if (layout === 'grid') {
      if (!sh.length || sh.length > 4) return null;
      var s0 = sh[0];
      for (var j = 1; j < sh.length; j++) {
        if (sh[j].type !== s0.type || sh[j].fill !== s0.fill || sh[j].r !== s0.r || sh[j].rot !== s0.rot) return null;
      }
      out['c0.count'] = sh.length;
      if (sh.length === 1) {
        var ci = cornerIndex(s0.x, s0.y);
        if (ci >= 0) out['c0.pos'] = ci;
        else if (s0.x === 50 && s0.y === 50) out['c0.pos'] = 'C';
        else return null;
      } else {
        if (!samePositions(sh, COUNT_LAYOUT[sh.length])) return null;
        out['c0.pos'] = 'L';
      }
      if (!from('c0.', s0)) return null;
      return out;
    }
    if (sh.length !== L.comps.length) return null;
    var sorted = sh.slice().sort(function (a, b) { return a.x - b.x; });
    for (var k = 0; k < sorted.length; k++) if (!from('c' + k + '.', sorted[k])) return null;
    return out;
  }
  function signature(cell) {
    return cell.shapes.map(function (s) { return [s.type, s.fill, s.x, s.y, s.r, canonRot(s.type, s.rot)].join(':'); }).sort().join('|');
  }

  // ---------------------------------------------------------------- solver: rule hypotheses from the 8 visible cells
  var PKIND = { type: 'cat', fill: 'cat', size: 'ord', count: 'ord', orient: 'cyc', pos: 'cyc' };
  var PPERIOD = { orient: 360, pos: 4 };
  var PDOMAIN = { size: [0, 1, 2, 3], count: [1, 2, 3, 4] };
  function transpose(g) { return [[g[0][0], g[1][0], g[2][0]], [g[0][1], g[1][1], g[2][1]], [g[0][2], g[1][2], g[2][2]]]; }
  /** Every hypothesis of the rule family that fits the 8 known cells; returns the distinct predicted values. */
  function predictCell(g, attr) {
    var kind = PKIND[attr], period = PPERIOD[attr], preds = [];
    function add(v) { for (var i = 0; i < preds.length; i++) if (preds[i] === v) return; preds.push(v); }
    function step(a, b) { return kind === 'cyc' ? mod(b - a, period) : b - a; }
    function next(a, d) {
      if (kind === 'cyc') return mod(a + d, period);
      var v = a + d;
      return PDOMAIN[attr] && PDOMAIN[attr].indexOf(v) < 0 ? null : v;
    }
    function tryRows(m) {
      var r0 = m[0], r1_ = m[1], r2 = m[2];
      // constant along each row (rows may differ)
      if (r0[0] === r0[1] && r0[1] === r0[2] && r1_[0] === r1_[1] && r1_[1] === r1_[2] && r2[0] === r2[1]) add(r2[0]);
      // progression: the same non-zero step in every row
      if (kind !== 'cat' && typeof r0[0] === 'number') {
        var d = step(r0[0], r0[1]);
        if (d !== 0 && step(r0[1], r0[2]) === d && step(r1_[0], r1_[1]) === d && step(r1_[1], r1_[2]) === d && step(r2[0], r2[1]) === d) {
          var v = next(r2[1], d);
          if (v !== null) add(v);
        }
      }
      // distribution of three: the same three distinct values in every row
      if (r0[0] !== r0[1] && r0[1] !== r0[2] && r0[0] !== r0[2]) {
        var S = r0.slice();
        var inS = function (x) { return S.indexOf(x) >= 0; };
        if (inS(r1_[0]) && inS(r1_[1]) && inS(r1_[2]) && r1_[0] !== r1_[1] && r1_[1] !== r1_[2] && r1_[0] !== r1_[2] &&
            r2[0] !== r2[1] && inS(r2[0]) && inS(r2[1])) {
          for (var q = 0; q < 3; q++) if (S[q] !== r2[0] && S[q] !== r2[1]) add(S[q]);
        }
      }
    }
    tryRows(g);
    tryRows(transpose(g));
    return preds;
  }
  function solve(item) {
    var stim = item.stim, layout = stim.layout;
    var pc = stim.cells.map(function (c) { return perceive(layout, c); });
    var po = stim.options.map(function (c) { return perceive(layout, c); });
    var bad = function (p) { return !p; };
    if (stim.cells.length !== 8 || stim.options.length !== 8 || pc.some(bad) || po.some(bad)) {
      return { ok: false, reason: 'unperceivable', matches: [], predictions: {}, ambiguous: [], unexplained: [], distinct: false };
    }
    var slots = Object.keys(pc[0]).sort();
    var predictions = {}, ambiguous = [], unexplained = [];
    slots.forEach(function (slot) {
      var vals = pc.map(function (p) { return p[slot]; });
      var attr = attrOf(slot);
      if (attr === 'pos' && vals.some(function (v) { return typeof v !== 'number'; })) {
        predictions[slot] = { derived: true };      // positions come from the count layout here
        return;
      }
      var g = [[vals[0], vals[1], vals[2]], [vals[3], vals[4], vals[5]], [vals[6], vals[7], undefined]];
      var preds = predictCell(g, attr);
      if (!preds.length) unexplained.push(slot);
      else if (preds.length > 1) ambiguous.push(slot);
      else predictions[slot] = { value: preds[0] };
    });
    var matches = [];
    po.forEach(function (p, idx) {
      var ok = slots.every(function (slot) {
        var pr = predictions[slot];
        if (!pr) return false;
        if (pr.derived) return typeof p[slot] !== 'number';
        return p[slot] === pr.value;
      });
      if (ok) matches.push(idx);
    });
    var sigs = stim.options.map(signature), seen = {}, distinct = true;
    sigs.forEach(function (s) { if (seen[s]) distinct = false; seen[s] = true; });
    var flat = {};
    Object.keys(predictions).forEach(function (s) { flat[s] = predictions[s].derived ? 'derived' : predictions[s].value; });
    return { ok: !ambiguous.length && !unexplained.length && matches.length === 1 && distinct,
             matches: matches, predictions: flat, ambiguous: ambiguous, unexplained: unexplained, distinct: distinct };
  }

  // ---------------------------------------------------------------- generator
  function grid3(fn) { return [[fn(0, 0), fn(0, 1), fn(0, 2)], [fn(1, 0), fn(1, 1), fn(1, 2)], [fn(2, 0), fn(2, 1), fn(2, 2)]]; }
  function isProgTriple(t, attr) {
    if (KIND[attr] === 'cat') return false;
    var P = PERIOD[attr];
    var d1 = P ? mod(t[1] - t[0], P) : t[1] - t[0], d2 = P ? mod(t[2] - t[1], P) : t[2] - t[1];
    return d1 !== 0 && d1 === d2;
  }
  function typePool(needAsym, needFill) {
    var pool = needAsym ? ASYM : ALL_TYPES;
    return needFill ? pool.filter(function (t) { return SHAPES[t].fw >= FAT_MIN_FW; }) : pool;
  }
  function valuePool(attr, need) { return attr === 'type' ? typePool(need.asym, need.fill) : DOMAIN[attr]; }
  /** Template rules (checked by gen and the tests): Π split = 8; size never varies in a component whose type varies;
      count and pos never both vary or split. Returns a list of problems. */
  function templateProblems(tpl) {
    var out = [], used = {}, prod = 1;
    tpl.rules.forEach(function (r) { used[r.slot] = 'rule'; });
    tpl.split.forEach(function (x) { prod *= x[1]; if (!used[x[0]]) used[x[0]] = 'split'; });
    if (prod !== 8) out.push('split product ' + prod);
    for (var k = 0; k < LAYOUTS[tpl.layout].comps.length; k++) {
      if (used['c' + k + '.size'] && used['c' + k + '.type']) out.push('size and type both vary in component ' + k);
    }
    if (used['c0.count'] && used['c0.pos']) out.push('count and pos both vary');
    return out;
  }
  /** Every shape of a component whose fill is judged must show its pattern (fw · r / 45 ≥ FILL_MIN). */
  function fillVisible(layout, cells, comps) {
    var L = LAYOUTS[layout];
    for (var i = 0; i < cells.length; i++) {
      var sh = cells[i].shapes;
      for (var j = 0; j < sh.length; j++) {
        var k = layout === 'pair' ? (sh[j].x < 50 ? 0 : 1) : 0;
        if (comps[k] && SHAPES[sh[j].type].fw * sh[j].r / 45 < FILL_MIN) return false;
      }
    }
    return L ? true : false;
  }

  /** Build the 3×3 value grid of one rule. Returns { grid, dir, step } or null if the draw does not fit the domain. */
  function ruleGrid(rule, attr, need, rng, dir) {
    var pool = valuePool(attr, need), P = PERIOD[attr];
    var g, step = 0;
    if (rule.rule === 'prog') {
      if (KIND[attr] === 'cat') return null;
      var steps = attr === 'orient' ? [1, -1, 2, -2] : [1, -1];
      step = rng.pick(steps);
      var at = function (b, c) { return P ? mod(b + step * c, P) : b + step * c; };
      var okBase = function (b) { return P ? true : (pool.indexOf(b) >= 0 && pool.indexOf(b + 2 * step) >= 0); };
      var bases = pool.filter(okBase);
      if (!bases.length) return null;
      var rowBase;
      if (rule.variant === 'shift') {
        var b0 = rng.pick(bases), b1, b2, tries = 0;
        do { b1 = rng.pick(bases); tries++; } while (b1 === b0 && tries < 50);
        if (b1 === b0) return null;
        var others = bases.filter(function (b) { return b !== b1; });
        if (P) { var fresh = others.filter(function (b) { return b !== b0; }); if (fresh.length) others = fresh; }
        b2 = rng.pick(others);
        rowBase = [b0, b1, b2];
      } else {
        var b = rng.pick(bases);
        rowBase = [b, b, b];
      }
      g = grid3(function (r, c) { return at(rowBase[r], c); });
    } else if (rule.rule === 'dist3') {
      if (pool.length < 3) return null;
      var S = rng.sample(pool, 3), perm, tries2 = 0;
      do { perm = rng.shuffle(S); tries2++; } while (isProgTriple(perm, attr) && tries2 < 30);
      if (isProgTriple(perm, attr)) return null;
      if (rule.variant === 'latin') {
        var sh = rng.pick([1, 2]);
        g = grid3(function (r, c) { return perm[(c + sh * r) % 3]; });
        dir = 'both';
      } else g = grid3(function (r, c) { return perm[c]; });
    } else return null;
    if (dir === 'v') g = transpose(g);
    return { grid: g, dir: dir, step: step };
  }

  function contextValues(grid) { var out = []; for (var i = 0; i < 8; i++) { var v = grid[Math.floor(i / 3)][i % 3]; if (out.indexOf(v) < 0) out.push(v); } return out; }
  function dist(attr, a, b) {
    if (KIND[attr] === 'cat') return a === b ? 0 : 1;
    if (PERIOD[attr]) { var d = mod(a - b, PERIOD[attr]); return Math.min(d, PERIOD[attr] - d); }
    return Math.abs(a - b);
  }
  /** Alternative values for a split slot. k = 2 → 1 alternative; k = 4 → 3 alternatives. */
  function alternatives(attr, k, v, ctx, plaus, pool, rng) {
    var cands = pool.filter(function (x) { return x !== v; });
    if (k === 4) {
      if (attr === 'orient') return [mod(v + 2, 8), mod(v + 4, 8), mod(v + 6, 8)];
      if (KIND[attr] !== 'cat') return cands.length >= 3 ? rng.sample(cands, 3) : null;
      var inCtx = rng.shuffle(cands.filter(function (x) { return ctx.indexOf(x) >= 0; }));
      var outCtx = rng.shuffle(cands.filter(function (x) { return ctx.indexOf(x) < 0; }));
      var pick = inCtx.concat(outCtx).slice(0, 3);
      return pick.length === 3 ? pick : null;
    }
    // Alternatives come from the matrix itself whenever possible (so "pick the option whose features all occur in the
    // matrix" fails); plaus only sets the distance on ordered features: near = one step (minimal difference), far = ≥ 2.
    var scored = cands.map(function (x) {
      var s = 0, d = dist(attr, x, v), inC = ctx.indexOf(x) >= 0;
      if (KIND[attr] === 'cat') s = inC ? 2 : 0;
      else if (plaus === 'near') s = (d === 1 ? 2 : 0) + (inC ? 1.5 : 0);
      else s = (d >= 2 ? 2 : 0) + (inC ? 1.5 : 0);
      return { x: x, s: s + rng.next() * 0.5 };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.length ? [scored[0].x] : null;
  }

  function tryBuild(tpl, rng, answerPos) {
    var layout = tpl.layout, slots = slotsOf(layout);
    var ruleBySlot = {}, splitBySlot = {};
    tpl.rules.forEach(function (r) { ruleBySlot[r.slot] = r; });
    tpl.split.forEach(function (s) { splitBySlot[s[0]] = s[1]; });
    var nComp = LAYOUTS[layout].comps.length, need = [];
    for (var k = 0; k < nComp; k++) {
      need.push({ asym: !!(ruleBySlot['c' + k + '.orient'] || splitBySlot['c' + k + '.orient']),
                  fill: !!(ruleBySlot['c' + k + '.fill'] || splitBySlot['c' + k + '.fill']) });
    }

    // directions: rules with a direction get h or v; with ≥ 2 such rules both directions appear (Sandia style)
    var directional = tpl.rules.filter(function (r) { return r.variant !== 'latin'; });
    var dirs = directional.map(function () { return rng.pick(['h', 'v']); });
    if (dirs.length >= 2 && dirs.every(function (d) { return d === dirs[0]; })) dirs[rng.int(0, dirs.length - 1)] = dirs[0] === 'h' ? 'v' : 'h';
    var dirOf = {};
    directional.forEach(function (r, i) { dirOf[r.slot] = dirs[i]; });

    var grids = {}, rulesOut = [], constants = [];
    for (var ri = 0; ri < tpl.rules.length; ri++) {
      var rule = tpl.rules[ri], attr = attrOf(rule.slot);
      var res = ruleGrid(rule, attr, need[compOf(rule.slot)], rng, dirOf[rule.slot] || 'both');
      if (!res) return null;
      grids[rule.slot] = res.grid;
      rulesOut.push({ slot: rule.slot, rule: rule.rule, variant: rule.variant, dir: res.dir, step: res.step });
    }
    // constants
    var posVaries = !!ruleBySlot['c0.pos'], countVaries = !!ruleBySlot['c0.count'];
    slots.forEach(function (slot) {
      if (grids[slot]) return;
      var attr = attrOf(slot), comp = compOf(slot), v;
      if (attr === 'type') v = rng.pick(typePool(need[comp].asym, need[comp].fill));
      else if (attr === 'orient') v = need[comp].asym ? rng.int(0, 7) : 0;
      else if (attr === 'size' && need[comp].fill) v = rng.pick(layout === 'one' ? [1, 2, 3] : [2, 3, 3]);
      else if (attr === 'count') v = posVaries || splitBySlot['c0.pos'] ? 1 : rng.int(2, 4);
      else if (attr === 'pos') v = countVaries || !(posVaries || splitBySlot['c0.pos']) ? 'C' : rng.int(0, 3);
      else v = rng.pick(DOMAIN[attr]);
      grids[slot] = grid3(function () { return v; });
      constants.push({ slot: slot, value: v });
    });
    if (layout === 'grid' && !countVaries && !posVaries && grids['c0.count'][0][0] === 1 && grids['c0.pos'][0][0] === 'C') return null;

    // answer state and split value sets
    var answer = {};
    slots.forEach(function (slot) { answer[slot] = grids[slot][2][2]; });
    var sets = [];
    for (var si = 0; si < tpl.split.length; si++) {
      var sslot = tpl.split[si][0], sk = tpl.split[si][1], sattr = attrOf(sslot);
      var alts = alternatives(sattr, sk, answer[sslot], contextValues(grids[sslot]), tpl.plaus,
        valuePool(sattr, need[compOf(sslot)]), rng);
      if (!alts) return null;
      sets.push({ slot: sslot, values: [answer[sslot]].concat(alts) });
    }
    // options: the product of the split value sets; combo 0 = the answer
    var combos = [[]];
    sets.forEach(function (s) {
      var next = [];
      combos.forEach(function (c) { s.values.forEach(function (_, vi) { next.push(c.concat([vi])); }); });
      combos = next;
    });
    if (combos.length !== 8) return null;
    var optionStates = combos.map(function (c) {
      var st = {};
      slots.forEach(function (slot) { st[slot] = answer[slot]; });
      c.forEach(function (vi, j) { st[sets[j].slot] = sets[j].values[vi]; });
      return st;
    });
    var order = [0].concat(rng.shuffle([1, 2, 3, 4, 5, 6, 7]));
    var arranged = new Array(8), di = 1;
    arranged[answerPos] = optionStates[0];
    for (var oi = 0; oi < 8; oi++) if (oi !== answerPos) arranged[oi] = optionStates[order[di++]];

    var cells = [];
    for (var ci = 0; ci < 8; ci++) {
      var st = {};
      slots.forEach(function (slot) { st[slot] = grids[slot][Math.floor(ci / 3)][ci % 3]; });
      cells.push(render(layout, st));
    }
    var options = arranged.map(function (s) { return render(layout, s); });
    if (!fillVisible(layout, cells.concat(options), need.map(function (n) { return n.fill; }))) return null;
    var item = {
      stim: { layout: layout, cells: cells, options: options },
      answer: answerPos,
      meta: {
        nRules: tpl.rules.length, rules: rulesOut, constants: constants, layout: layout,
        elements: elementsOf(layout, cells), plaus: tpl.plaus, split: tpl.split.map(function (s) { return s[0]; }), answerPos: answerPos
      }
    };
    var sol = solve(item);
    if (!sol.ok || sol.matches[0] !== answerPos) return null;
    return item;
  }
  function elementsOf(layout, cells) {
    var m = 0;
    cells.forEach(function (c) { if (c.shapes.length > m) m = c.shapes.length; });
    return m;
  }

  function fallbackItem(answerPos) {
    // Deterministic, always valid: one circle growing along the rows; options = 4 sizes × 2 fills.
    var cells = [], layout = 'one';
    var st = function (size, fill) { return { 'c0.type': 'circle', 'c0.size': size, 'c0.fill': fill, 'c0.orient': 0 }; };
    for (var i = 0; i < 8; i++) cells.push(render(layout, st(i % 3, 'none')));
    var opts = [];
    [2, 0, 1, 3].forEach(function (s) { ['none', 'solid'].forEach(function (f) { opts.push(st(s, f)); }); });
    var arranged = new Array(8), di = 1;
    arranged[answerPos] = opts[0];
    for (var oi = 0; oi < 8; oi++) if (oi !== answerPos) arranged[oi] = opts[di++];
    return {
      stim: { layout: layout, cells: cells, options: arranged.map(function (s) { return render(layout, s); }) },
      answer: answerPos,
      meta: { nRules: 1, rules: [{ slot: 'c0.size', rule: 'prog', variant: 'same', dir: 'h', step: 1 }],
              constants: [{ slot: 'c0.type', value: 'circle' }, { slot: 'c0.fill', value: 'none' }, { slot: 'c0.orient', value: 0 }],
              layout: layout, elements: 1, plaus: 'far', split: ['c0.size', 'c0.fill'], answerPos: answerPos, fallback: true }
    };
  }

  /** Generate one item from a template. seedString fixes it; answerPos (0–7) is where the right option goes. */
  function genItem(tpl, seedString, answerPos) {
    var bad = templateProblems(tpl);
    if (bad.length) throw new Error('lab.matrix: bad template: ' + bad.join('; '));
    var pos = answerPos == null ? 0 : answerPos;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var item = tryBuild(tpl, HF.rng.create(seedString + '#' + attempt), pos);
      if (item) { item.meta.attempts = attempt + 1; return item; }
    }
    return fallbackItem(pos);
  }

  // balanced answer positions: each of 0–7 used ⌊n/8⌋ or ⌈n/8⌉ times
  function answerPositions(rng, n) {
    var out = [];
    while (out.length < n) out = out.concat(rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]));
    return out.slice(0, n);
  }
  function sequence() {
    var seq = [];
    BLUEPRINT_ITEMS.forEach(function (tpl, idx) {
      seq.push({ tpl: tpl, template: idx + 1 });
      if (CHECK_AFTER.indexOf(idx + 1) >= 0) seq.push({ tpl: CHECK_ITEM, template: 'check' });
    });
    return seq;
  }

  function gen(opts) {
    opts = opts || {};
    var form = opts.form || 'A';
    if (form === 'P') return practice(opts);
    if (FORMS.indexOf(form) < 0) throw new Error('lab.matrix.gen: form must be A, B, C or D');
    var seed = opts.seed != null && opts.seed !== '' ? String(opts.seed) : defaultSeed(form);
    var release = seed === defaultSeed(form);
    var seq = sequence();
    var positions = answerPositions(HF.rng.create(seed + '/answers'), seq.length);
    var fallback = [];
    var trials = seq.map(function (s, i) {
      var item = genItem(s.tpl, seed + '/item' + i, positions[i]);
      item.meta.template = s.template;
      if (item.meta.fallback) fallback.push({ i: i, template: s.template });
      return { i: i, check: s.template === 'check', stim: item.stim, answer: item.answer, meta: item.meta };
    });
    var tut = tutorial();
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: form, seed: seed, release: release, version: VERSION,
      blueprint: BLUEPRINT, set: 'labMatrix', rung: null,
      params: { nScored: BLUEPRINT_ITEMS.length, nChecks: CHECK_AFTER.length, options: 8 },
      windowMs: WINDOW_MS, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS,
      instructions: tut.intro, ruleTypes: tut.ruleTypes, practice: tut.items, trials: trials,
      meta: { solverChecked: true, fallback: fallback }
    };
  }

  var tutorialCache = null;
  /** The rule tutorial, identical at every visit: { intro, ruleTypes: [3 strings], items: [TutorialItem] }.
      TutorialItem = Trial fields + { tutorial: true, explain: [sentence] } (feedback allowed here, never on scored items). */
  function tutorial() {
    if (!tutorialCache) {
      tutorialCache = TUTORIAL_ITEMS.map(function (tpl, i) {
        var item = genItem(tpl, TUTORIAL_SEED + '/' + i, [5, 2, 7, 0][i]);
        item.meta.template = 'tutorial' + (i + 1);
        return { i: i, tutorial: true, stim: item.stim, answer: item.answer, meta: item.meta, explain: explain(item) };
      });
    }
    return { intro: TUTORIAL_TEXT.intro, ruleTypes: TUTORIAL_TEXT.rules.slice(), items: JSON.parse(JSON.stringify(tutorialCache)) };
  }

  /** practice({ seed? }) → TestSpec: the rule tutorial as an unscored spec, identical at every visit (seed ignored).
      Untimed in spirit; windowMs is a 120 s safety cap. Feedback (item.explain) is allowed here only. */
  function practice() {
    var tut = tutorial();
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: 'P', seed: TUTORIAL_SEED, release: true, version: VERSION,
      blueprint: BLUEPRINT, set: 'labMatrix', rung: null, practice: true, params: { nScored: 0, nChecks: 0, options: 8 },
      windowMs: PRACTICE_WINDOW_MS, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS,
      instructions: tut.intro, ruleTypes: tut.ruleTypes, trials: tut.items, meta: { solverChecked: true, fallback: [] }
    };
  }

  // ---------------------------------------------------------------- explanations (from the item's own rules)
  var ATTR_LABEL = { type: 'Shape', size: 'Size', fill: 'Fill', orient: 'Rotation', count: 'Number', pos: 'Position' };
  function valueName(attr, v) {
    if (attr === 'type') return NAMES.type[v] || v;
    if (attr === 'fill') return NAMES.fill[v] || v;
    if (attr === 'size') return NAMES.size[v];
    if (attr === 'orient') return (v * 45) + '°';
    if (attr === 'pos') return typeof v === 'number' ? NAMES.pos[v] : 'centre';
    return String(v);
  }
  function stepText(attr, step) {
    var up = step > 0, n = Math.abs(step);
    if (attr === 'size') return up ? 'gets one size larger' : 'gets one size smaller';
    if (attr === 'count') return up ? 'gains one shape' : 'loses one shape';
    if (attr === 'orient') return 'turns ' + (n * 45) + '° ' + (up ? 'clockwise' : 'anticlockwise');
    if (attr === 'pos') return 'moves one corner ' + (up ? 'clockwise' : 'anticlockwise');
    return 'changes by ' + step;
  }
  function andList(names) {
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function explain(item) {
    var meta = item.meta, out = [], two = meta.layout === 'pair';
    var figure = function (slot) { return two ? (compOf(slot) === 0 ? ' of the left figure' : ' of the right figure') : ''; };
    var valuesOfRule = function (rule) {
      // the rule's values as drawn (perceived from the cells), in order of first appearance
      var vals = [];
      for (var i = 0; i < 8; i++) {
        var v = perceive(meta.layout, item.stim.cells[i])[rule.slot];
        if (attrOf(rule.slot) === 'orient') v = v / 45;
        if (vals.indexOf(v) < 0) vals.push(v);
      }
      return vals;
    };
    meta.rules.forEach(function (rule) {
      var attr = attrOf(rule.slot), word = ATTR_LABEL[attr].toLowerCase();
      var label = ATTR_LABEL[attr] + figure(rule.slot) + ': ';
      var along = rule.dir === 'v' ? 'down each column' : 'along each row';
      if (rule.rule === 'prog') {
        out.push(label + stepText(attr, rule.step) + ' at each step ' + along +
          (rule.variant === 'shift' ? ' (each ' + (rule.dir === 'v' ? 'column' : 'row') + ' starts from a different ' + word + ').'
                                    : ', the same in every ' + (rule.dir === 'v' ? 'column.' : 'row.')));
      } else {
        var names = andList(valuesOfRule(rule).map(function (v) { return valueName(attr, v); }));
        if (rule.variant === 'latin') out.push(label + 'every row and every column has each of ' + names + ' once.');
        else if (rule.dir === 'v') out.push(label + 'each row keeps one ' + word + '; the three rows show ' + names + '.');
        else out.push(label + 'each column keeps one ' + word + '; every row shows ' + names + ' in the same order.');
      }
    });
    var consts = (meta.constants || []).filter(function (c) {
      var a = attrOf(c.slot);
      if (a === 'pos' && c.value === 'C') return false;
      if (a === 'orient' && c.value === 0) return false;
      if (a === 'count' && c.value === 1) return false;
      return true;
    });
    if (consts.length) {
      out.push('The same everywhere: ' + andList(consts.map(function (c) {
        var a = attrOf(c.slot);
        return ATTR_LABEL[a].toLowerCase() + figure(c.slot) + ' (' + valueName(a, c.value) + ')';
      })) + '.');
    }
    out.push('Only option ' + (item.answer + 1) + ' fits every rule.');
    return out;
  }

  // ---------------------------------------------------------------- answer-only shortcut pickers (tests: must be at chance)
  function optionVectors(item) {
    var layout = item.stim.layout;
    var ps = item.stim.options.map(function (c) { return perceive(layout, c); });
    var slots = Object.keys(ps[0]).sort();
    return { ps: ps, slots: slots };
  }
  function pickBest(scores, rng, maximize) {
    var best = maximize ? -Infinity : Infinity, idx = [];
    scores.forEach(function (s, i) {
      var better = maximize ? s > best + 1e-9 : s < best - 1e-9;
      if (better) { best = s; idx = [i]; } else if (Math.abs(s - best) <= 1e-9) idx.push(i);
    });
    return rng.pick(idx);
  }
  function numDist(slot, a, b) {
    var attr = attrOf(slot);
    if (typeof a !== 'number' || typeof b !== 'number') return a === b ? 0 : 1;
    if (attr === 'orient') { var d = mod(a - b, 360); return Math.min(d, 360 - d) / 180; }
    if (attr === 'pos') { var e = mod(a - b, 4); return Math.min(e, 4 - e) / 2; }
    return Math.abs(a - b) / 3;
  }
  var shortcuts = {
    /** majority vote: the option whose attribute values are the most common among the 8 options */
    majority: function (item, rng) {
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.slots.reduce(function (s, slot) { return s + v.ps.filter(function (q) { return q[slot] === p[slot]; }).length; }, 0);
      });
      return pickBest(scores, rng, true);
    },
    /** odd one out: the option with the most attribute mismatches against the others */
    oddOneOut: function (item, rng) {
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.ps.reduce(function (s, q) { return s + v.slots.filter(function (slot) { return q[slot] !== p[slot]; }).length; }, 0);
      });
      return pickBest(scores, rng, true);
    },
    /** centroid: the most typical option (the RAVEN exploit) */
    centroid: function (item, rng) {
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.ps.reduce(function (s, q) { return s + v.slots.filter(function (slot) { return q[slot] !== p[slot]; }).length; }, 0);
      });
      return pickBest(scores, rng, false);
    },
    numericOdd: function (item, rng) {
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.ps.reduce(function (s, q) { return s + v.slots.reduce(function (t, slot) { return t + numDist(slot, p[slot], q[slot]); }, 0); }, 0);
      });
      return pickBest(scores, rng, true);
    },
    numericCentroid: function (item, rng) {
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.ps.reduce(function (s, q) { return s + v.slots.reduce(function (t, slot) { return t + numDist(slot, p[slot], q[slot]); }, 0); }, 0);
      });
      return pickBest(scores, rng, false);
    },
    /** uses the matrix too: the option whose values all occur somewhere in the 8 visible cells */
    contextPresence: function (item, rng) {
      var layout = item.stim.layout;
      var pc = item.stim.cells.map(function (c) { return perceive(layout, c); });
      var v = optionVectors(item);
      var scores = v.ps.map(function (p) {
        return v.slots.filter(function (slot) { return pc.some(function (q) { return q[slot] === p[slot]; }); }).length;
      });
      return pickBest(scores, rng, true);
    }
  };

  // ---------------------------------------------------------------- scoring
  function indexAnswers(log) {
    var by = {};
    ((log && log.answers) || []).forEach(function (a) { if (a && a.i != null && !by[a.i]) by[a.i] = a; });
    return by;
  }
  function isTimeout(a) { return !!a.timedOut || a.response === null || a.response === undefined || a.response === ''; }
  function score(spec, log) {
    var by = indexAnswers(log), st = HF.stats;
    var nItems = 0, n = 0, correct = 0, timeouts = 0, voided = 0, missing = 0, tooFast = 0, rtsCorrect = [];
    var byRules = {}, checks = { n: 0, failed: 0 };
    spec.trials.forEach(function (t) {
      var a = by[t.i];
      if (t.check) {
        if (a && !a.voided) { checks.n++; if (isTimeout(a) || Number(a.response) !== t.answer) checks.failed++; }
        return;
      }
      nItems++;
      if (!a) { missing++; return; }
      if (a.voided) { voided++; return; }
      n++;
      var key = String(t.meta.nRules), b = byRules[key] || (byRules[key] = { correct: 0, n: 0 });
      b.n++;
      if (isTimeout(a)) { timeouts++; return; }
      if (typeof a.rt === 'number' && a.rt < (spec.tooFastMs || TOO_FAST_MS)) tooFast++;
      if (Number(a.response) === t.answer) { correct++; b.correct++; if (typeof a.rt === 'number') rtsCorrect.push(a.rt); }
    });
    var flags = [];
    if (missing > 0) flags.push('incomplete');
    if (nItems && voided / nItems > 0.10) flags.push('many-voided');
    if (tooFast >= 3) flags.push('too-fast');
    if (checks.failed > 0) flags.push('check-failed');
    return stamp(spec, {
      testId: TEST_ID, score: n ? correct / n : null, scoreLabel: correct + ' of ' + n + ' correct',
      higherIsBetter: true, unit: 'proportion',
      sub: { correct: correct, n: n, nItems: nItems, timeouts: timeouts, voided: voided, missing: missing, tooFast: tooFast,
             medianRtCorrect: rtsCorrect.length ? st.median(rtsCorrect) : null, byRules: byRules, checks: checks,
             form: spec.form, blueprint: spec.blueprint, release: !!spec.release, paused: !!(log && log.paused) },
      flags: flags
    });
  }
  function rows(spec, log) {
    var by = indexAnswers(log);
    return spec.trials.map(function (t) {
      var a = by[t.i] || null;
      var resp = a && !isTimeout(a) ? Number(a.response) : null;
      return {
        test: TEST_ID, form: spec.form, blueprint: spec.blueprint, seed: spec.seed, i: t.i, check: !!t.check,
        template: t.meta.template, nRules: t.meta.nRules, layout: t.meta.layout, elements: t.meta.elements, plaus: t.meta.plaus,
        rules: t.meta.rules.map(function (r) { return r.slot + ':' + r.rule + ':' + r.variant + ':' + r.dir; }).join(' '),
        answer: t.answer, response: resp, correct: a && !a.voided ? resp === t.answer : null,
        rt: a ? (a.rt == null ? null : a.rt) : null, timedOut: a ? isTimeout(a) && !a.voided : null, voided: a ? !!a.voided : null
      };
    });
  }

  var test = {
    id: TEST_ID, label: 'Matrices', paradigm: 'generated 3×3 figural matrices (Sandia/RAVEN-style rules)',
    minutes: 9, defaultLevel: 'far', higherIsBetter: true, unit: 'proportion', exploratory: false,
    blueprint: BLUEPRINT, formSeed: defaultSeed, part: 'B', version: VERSION,
    gen: gen, score: score, rows: rows, practice: practice, tutorial: tutorial, solve: solve, explain: explain,
    shapePath: shapePath, SHAPES: SHAPES, FILLS: FILLS, SIZE_FRAC: SIZE_FRAC, LAYOUTS: LAYOUTS,
    genItem: genItem, perceive: perceive, signature: signature, BLUEPRINT_ITEMS: BLUEPRINT_ITEMS, CHECK_ITEM: CHECK_ITEM,
    TUTORIAL_ITEMS: TUTORIAL_ITEMS, shortcuts: shortcuts, templateProblems: templateProblems, FILL_MIN: FILL_MIN
  };
  if (HF.lab && HF.lab.register) HF.lab.register(test); else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
