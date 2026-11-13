/* Long-Horizon — Lab registry (pure, no DOM). MIT licence.

   Load order: this file FIRST among js/lab/*, then js/lab/tests/*.js (each calls HF.lab.register),
   then schedule.js, levels.js, compare.js, study.js, export.js (they only read the registry at call time).
   A test file that loads earlier may push its object onto HF.labPending; this file registers those on load
   (failures are listed in HF.lab.pendingErrors instead of throwing).

   Produces
   --------
   HF.lab.register(test) → test        validates and stores a Lab test; throws on a malformed object.
     test = { id: 'lab.xxx', label, paradigm, part: 'A'|'B' (memory | reasoning & control),
              minutes: <number>, defaultLevel: 'near'|'mid'|'far',
              gen({ form: 'A'|'B'|'C'|'D', seed? }) → TestSpec       (seed defaults to formSeed(id, form))
              score(spec, log) → TestResult { score, scoreLabel, sub: {...}, flags: [...], testId, form, seed, version }
              practice?({ seed? }) → TestSpec (unscored, identical at every visit by default)
              rows?(spec, log) → [ {flat row} ]   one row per trial/item for the study export
              higherIsBetter?: bool (default true; e.g. a cost score sets false), version?: int (blueprint version) }
     defaultLevel = the test's designed role for the default programme (Varied: n-back + Relation Grid);
     HF.lab.levels(records) gives the level for one user from the training log.
   HF.lab.tests[id]                      the registered tests.
   HF.lab.visitTests(config, opts?) → [labTestId]   config: 'standard'|'minimum'|'quick'|'extended'
     (unknown config → 'standard'); opts.part 'A'|'B' keeps one sitting; opts.reasoning === false drops part B.
     Lists the configured ids whether or not they are registered (HF.lab.missing(config) lists unregistered ones).
   HF.lab.visitMinutes(config, opts?) → minutes incl. a 1-min check-in per sitting and a 1-min close-out after the
     reasoning sitting (standard 52 = 25 + 27, extended 57, minimum 36, quick 12 with the default minutes; PLAN §6).
   HF.lab.FORMS ['A','B','C','D']; HF.lab.LATIN (balanced 4×4 Latin square, Williams design);
   HF.lab.formOrder(anonId) → row of LATIN chosen by cyrb128(anonId) mod 4: forms for B1, B2, POST, FU.
   HF.lab.formSeed(testId, form, variant?) → 'holdfast/lab/v1/<testId>/<form>[/<variant>]'
     fixed per release so community data are comparable; variant 'Q1', 'X2', … gives fresh sequences
     for quick checks and extra visits; form 'P' = practice.
   HF.lab.PALETTE — Okabe–Ito colours, each with a redundant pattern name (colour is never the only cue).
   HF.lab.makeResult(spec, score, scoreLabel, sub, flags) → TestResult (shared shape).
   HF.lab.partOf(id), HF.lab.CONFIGS, HF.lab.IDS, HF.lab.FULL_KINDS, HF.lab.KINDS, HF.lab.BLUEPRINT.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var prev = HF.lab || {};

  var BLUEPRINT = 'v1';
  var IDS = ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind', 'lab.matrix', 'lab.series', 'lab.graph', 'lab.switch'];
  var PART = {
    'lab.nback': 'A', 'lab.rel': 'A', 'lab.sspan': 'A', 'lab.update': 'A', 'lab.bind': 'A',
    'lab.matrix': 'B', 'lab.series': 'B', 'lab.graph': 'B', 'lab.switch': 'B'
  };
  // Order inside a sitting follows research/04 §12 and PLAN §6.
  var CONFIGS = {
    standard: ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.matrix', 'lab.series', 'lab.graph', 'lab.switch'],
    extended: ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind', 'lab.matrix', 'lab.series', 'lab.graph', 'lab.switch'],
    minimum: ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.matrix', 'lab.series'],
    quick: ['lab.nback', 'lab.rel']
  };
  // Used only when a test is not registered (minutes include its practice items).
  var DEFAULT_MINUTES = {
    'lab.nback': 6, 'lab.rel': 5, 'lab.sspan': 7, 'lab.update': 6, 'lab.bind': 5,
    'lab.matrix': 9, 'lab.series': 6, 'lab.graph': 5, 'lab.switch': 5
  };
  var FORMS = ['A', 'B', 'C', 'D'];
  // Williams design: every form precedes every other form exactly once across the four rows.
  var LATIN = [['A', 'B', 'D', 'C'], ['B', 'C', 'A', 'D'], ['C', 'D', 'B', 'A'], ['D', 'A', 'C', 'B']];
  var FULL_KINDS = ['B1', 'B2', 'POST', 'FU'];
  var KINDS = ['B1', 'B2', 'Q', 'POST', 'FU', 'X'];
  var LEVELS = ['near', 'mid', 'far'];

  // Okabe & Ito (2008) colour-blind-safe palette (black omitted: it clashes with the grid lines).
  // The view draws the pattern on the patch too, so colour is never the only cue.
  var PALETTE = [
    { id: 'orange', name: 'orange', hex: '#E69F00', pattern: 'dots' },
    { id: 'sky', name: 'sky blue', hex: '#56B4E9', pattern: 'stripes' },
    { id: 'green', name: 'bluish green', hex: '#009E73', pattern: 'checks' },
    { id: 'yellow', name: 'yellow', hex: '#F0E442', pattern: 'rings' },
    { id: 'blue', name: 'blue', hex: '#0072B2', pattern: 'waves' },
    { id: 'vermillion', name: 'vermillion', hex: '#D55E00', pattern: 'cross' },
    { id: 'purple', name: 'reddish purple', hex: '#CC79A7', pattern: 'zigzag' }
  ];
  PALETTE.forEach(function (p, i) { p.index = i; p.label = p.name + ' · ' + p.pattern; });

  var tests = prev.tests || {};

  function partOf(id) {
    var t = tests[id];
    if (t && (t.part === 'A' || t.part === 'B')) return t.part;
    return PART[id] || 'A';
  }

  function register(test) {
    var problems = [];
    if (!test || typeof test !== 'object') throw new Error('HF.lab.register: test object required');
    if (typeof test.id !== 'string' || test.id.indexOf('lab.') !== 0) problems.push('id must be a string starting with "lab."');
    if (typeof test.label !== 'string' || !test.label) problems.push('label');
    if (typeof test.paradigm !== 'string' || !test.paradigm) problems.push('paradigm');
    if (!(typeof test.minutes === 'number' && test.minutes > 0)) problems.push('minutes (> 0)');
    if (LEVELS.indexOf(test.defaultLevel) < 0) problems.push('defaultLevel (near|mid|far)');
    if (typeof test.gen !== 'function') problems.push('gen(opts)');
    if (typeof test.score !== 'function') problems.push('score(spec, log)');
    if (test.part != null && test.part !== 'A' && test.part !== 'B') problems.push('part (A|B)');
    if (test.practice != null && typeof test.practice !== 'function') problems.push('practice must be a function');
    if (test.rows != null && typeof test.rows !== 'function') problems.push('rows must be a function');
    if (problems.length) throw new Error('HF.lab.register(' + (test && test.id) + '): bad or missing ' + problems.join(', '));
    if (test.part == null) test.part = PART[test.id] || 'A';
    if (test.higherIsBetter == null) test.higherIsBetter = true;
    if (test.version == null) test.version = 1;
    tests[test.id] = test;
    return test;
  }

  function visitTests(config, opts) {
    opts = opts || {};
    var list = (CONFIGS[config] || CONFIGS.standard).slice();
    if (opts.part) list = list.filter(function (id) { return partOf(id) === opts.part; });
    if (opts.reasoning === false) list = list.filter(function (id) { return partOf(id) !== 'B'; });
    return list;
  }

  function missing(config) {
    return visitTests(config).filter(function (id) { return !tests[id]; });
  }

  function minutesOf(id) {
    var t = tests[id];
    return t && typeof t.minutes === 'number' ? t.minutes : (DEFAULT_MINUTES[id] || 5);
  }

  function visitMinutes(config, opts) {
    var list = visitTests(config, opts);
    var m = 0, parts = {};
    list.forEach(function (id) { m += minutesOf(id); parts[partOf(id)] = true; });
    var sittings = Object.keys(parts).length;
    if (!sittings) return 0;
    return m + sittings /* check-in per sitting */ + (parts.B ? 1 : 0) /* close-out ends the reasoning sitting */;
  }

  function formOrder(anonId) {
    var h = HF.rng && HF.rng.hash ? HF.rng.hash(String(anonId == null ? '' : anonId))[0] : 0;
    return LATIN[h % 4].slice();
  }

  function formSeed(testId, form, variant) {
    // 'holdfast/…' is the working name, kept on purpose: the seed string defines every form (and formSeedHash)
    return 'holdfast/lab/' + BLUEPRINT + '/' + testId + '/' + (form || 'A') + (variant ? '/' + variant : '');
  }

  /** seed for gen(): an explicit seed wins, else the fixed form seed. */
  function seedOf(testId, o) {
    o = o || {};
    if (o.seed != null && o.seed !== '') return String(o.seed);
    var form = o.form || 'A';
    if (FORMS.indexOf(form) < 0 && form !== 'P') throw new Error(testId + '.gen: form must be A, B, C or D');
    return formSeed(testId, form);
  }

  function makeResult(spec, score, scoreLabel, sub, flags) {
    spec = spec || {};
    return {
      testId: spec.testId || null, score: score, scoreLabel: scoreLabel, sub: sub || {}, flags: flags || [],
      form: spec.form || null, seed: spec.seed || null, version: spec.version || 1
    };
  }

  // small shared helpers for the test files (not part of the public contract)
  function median(arr) {
    var a = (arr || []).filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function round(x, dp) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    var f = Math.pow(10, dp == null ? 3 : dp);
    return Math.round(x * f) / f;
  }
  function byIndex(list, key) {
    var m = {};
    (list || []).forEach(function (x) { if (x && x[key || 'i'] != null && m[x[key || 'i']] == null) m[x[key || 'i']] = x; });
    return m;
  }

  var api = {
    tests: tests, register: register, visitTests: visitTests, missing: missing, visitMinutes: visitMinutes,
    minutesOf: minutesOf, partOf: partOf, formOrder: formOrder, formSeed: formSeed, seedOf: seedOf,
    makeResult: makeResult, IDS: IDS, PART: PART, CONFIGS: CONFIGS, FORMS: FORMS, LATIN: LATIN,
    FULL_KINDS: FULL_KINDS, KINDS: KINDS, BLUEPRINT: BLUEPRINT, PALETTE: PALETTE, DEFAULT_MINUTES: DEFAULT_MINUTES,
    _h: { median: median, round: round, byIndex: byIndex }
  };
  // keep functions added by later files if this file is (re)loaded after them
  Object.keys(prev).forEach(function (k) { if (!(k in api)) api[k] = prev[k]; });
  HF.lab = api;
  // tests that loaded before this file queue themselves in HF.labPending; register them now
  api.pendingErrors = [];
  if (Array.isArray(HF.labPending)) {
    HF.labPending.splice(0).forEach(function (t) {
      try { register(t); } catch (e) { api.pendingErrors.push(String(e && e.message)); }
    });
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
