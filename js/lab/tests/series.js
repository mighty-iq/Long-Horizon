/* Long-Horizon Lab — lab.series: number and letter series with a typed answer. Pure module (no DOM, deterministic). MIT licence.

   Paradigm: number series built from operator families in the spirit of ANSIG (Loe et al. 2018) and letter series in
   the spirit of Simon & Kotovsky (1963): our own generator, rules re-implemented from the published descriptions; no
   numGen/ICAR items or code. Full format notes: docs/dev/lab-items.md.

   API (registered with HF.lab.register, or queued in HF.labPending; exported for node):
     gen({ form: 'A'|'B'|'C'|'D', seed? }) → TestSpec     omit seed in real visits (fixed release form)
     score(spec, log) → TestResult                        rows(spec, log) → [ExportRow]
     practice() → TestSpec (form 'P', practice: true)    2 fixed, unscored items shown at every visit
     normalize(kind, raw) → canonical string | null       THE accepted-answer rule (the view uses it to validate input)
     solve(item) → { ok, predictions: [ { family, value } ], values: [distinct], unique }   brute force over all families
     genItem(familyId, seedString) → Item; FAMILIES; BLUEPRINT_ITEMS; shortcuts.* (answer-free guessers, for tests)

   TestSpec (SPEC §4.3 discrete shape, extended):
     { kind: 'discrete', task: 'lab', testId: 'lab.series', trackId: 'lab.series', form, seed, release, blueprint: 'series-1',
       set: 'labSeries', rung: null, params: { nScored: 14, nNumber: 8, nLetter: 6 }, windowMs: 60000, itiMs: 500,
       tooFastMs: 1500, practice: [Trial], trials: [Trial], meta: { solverChecked: true, fallback: [] } }
     Trial = { i, stim: { kind: 'number'|'letter', terms: [string], display: '3, 7, 11, 15, ?' },
               answer: canonical string ('19' | 'K'), meta: { template, family, nShown, answerValue, params } }
   Accepted answers (normalize): Unicode NFKC first (full-width digits/letters), then all whitespace removed and trailing
     . , ; : ! ? ' " stripped. number → optional leading '+', digits, optional '.0…' → canonical decimal without leading
     zeros ('007' → '7', '12.0' → '12'); a minus sign is never accepted (no answer is negative). letter → exactly one
     letter A–Z, case-insensitive → upper case. Anything else → null (= wrong; the view should ask again before submitting).
   Log (SPEC §4.3): { answers: [ { i, response: <typed string> | null, rt: ms | null, voided: bool, timedOut?: bool } ], paused }
   TestResult: { score: proportion correct (timeouts wrong, voided excluded), scoreLabel, sub: { correct, n, nItems,
     timeouts, voided, missing, invalid, tooFast, byKind: { number, letter }, medianRtCorrect }, flags }

   Uniqueness: every family whose free parameters are over-determined by the shown terms (≥ 1 extra term) is fitted;
   all fitted families must predict the same next term, and it must be the answer. Families other than constant steps
   are also rejected when a cheap guess (repeat the last difference, repeat the last term, the last ratio, the term two
   back) happens to give the answer.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var TEST_ID = 'lab.series';
  var BLUEPRINT = 'series-1';
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
  var MAX_ATTEMPTS = 200;
  var WINDOW_MS = 60000, ITI_MS = 500, TOO_FAST_MS = 1500;
  var MAX_NUM = 999;
  var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function letter(p) { return ABC.charAt(p - 1); }
  function diffs(xs) { var d = []; for (var i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]); return d; }
  function allEq(a) { for (var i = 1; i < a.length; i++) if (a[i] !== a[0]) return false; return true; }
  function sign(rng) { return rng.chance(0.5) ? 1 : -1; }

  // ---------------------------------------------------------------- generator families
  // Each returns { xs: [shown terms], answer, params } or null. Letters use positions 1–26 (A = 1), no wrap-around.
  var FAMILIES = {
    // numbers
    arith: { kind: 'number', constantStep: true, make: function (rng) {
      var d = rng.int(2, 9) * (rng.chance(0.7) ? 1 : -1), n = 5;
      var a = d > 0 ? rng.int(1, 40) : rng.int(-d * n + 1, -d * n + 40);
      return seq(a, n, function (x) { return x + d; }, { d: d });
    } },
    geom: { kind: 'number', constantRatio: true, make: function (rng) {
      var v = rng.int(0, 2), n = 5;
      if (v === 0) { var a = rng.int(1, 12); return seq(a, n, function (x) { return x * 2; }, { ratio: 2 }); }
      if (v === 1) { var b = rng.int(1, 4); return seq(b, n, function (x) { return x * 3; }, { ratio: 3 }); }
      var q = rng.int(1, 9); return seq(q * 32, n, function (x) { return x / 2; }, { ratio: 0.5 });
    } },
    second: { kind: 'number', make: function (rng) {
      var d0 = rng.int(1, 5), k = rng.int(1, 3), a = rng.int(1, 20), n = 6, i = 0;
      return seq(a, n, function (x) { var y = x + d0 + k * i; i++; return y; }, { d0: d0, k: k });
    } },
    twostep: { kind: 'number', make: function (rng) {
      var p = rng.int(3, 9), q = -rng.int(1, 6), n = 7;
      if (p + q < 1 || p === -q) return null;
      var st = rng.chance(0.5) ? [p, q] : [q, p], i = 0, a = rng.int(6, 30);
      return seq(a, n, function (x) { var y = x + st[i % 2]; i++; return y; }, { steps: st });
    } },
    interleave: { kind: 'number', make: function (rng) {
      var d1 = rng.int(1, 6) * sign(rng), d2 = rng.int(1, 6) * sign(rng);
      if (d1 === d2) return null;
      return interleave(rng.int(1, 40), d1, rng.int(1, 40), d2, 7, { d1: d1, d2: d2 });
    } },
    fib: { kind: 'number', make: function (rng) {
      var a = rng.int(1, 9), b = rng.int(1, 9), xs = [a, b];
      while (xs.length < 7) xs.push(xs[xs.length - 1] + xs[xs.length - 2]);
      return { xs: xs.slice(0, 6), answer: xs[6], params: { a: a, b: b } };
    } },
    mulAdd: { kind: 'number', make: function (rng) {
      var m = rng.int(2, 3), c = rng.int(1, 9), a = rng.int(1, 5), phase = rng.int(0, 1), i = 0;
      return seq(a, 7, function (x) { var y = ((i + phase) % 2 === 0) ? x * m : x + c; i++; return y; }, { m: m, c: c, phase: phase });
    } },
    cycle3: { kind: 'number', make: function (rng) {
      var st = [rng.int(1, 9) * sign(rng), rng.int(1, 9) * sign(rng), rng.int(1, 9) * sign(rng)];
      if (st[0] === st[1] || st[1] === st[2] || st[0] === st[2] || st[0] + st[1] + st[2] <= 0) return null;
      var i = 0;
      return seq(rng.int(10, 40), 8, function (x) { var y = x + st[i % 3]; i++; return y; }, { steps: st });
    } },
    // letters
    lskip: { kind: 'letter', constantStep: true, make: function (rng) {
      var k = rng.int(2, 4), n = 5, fwd = rng.chance(0.75);
      var a = fwd ? rng.int(1, 26 - n * k) : rng.int(n * k + 1, 26);
      return seq(a, n, function (x) { return x + (fwd ? k : -k); }, { step: fwd ? k : -k });
    } },
    lrep: { kind: 'letter', make: function (rng) {
      var k = rng.int(1, 3) * (rng.chance(0.75) ? 1 : -1), a = k > 0 ? rng.int(1, 26 - 3 * Math.abs(k)) : rng.int(3 * Math.abs(k) + 1, 26);
      var xs = [a, a, a + k, a + k, a + 2 * k, a + 2 * k];
      return { xs: xs, answer: a + 3 * k, params: { step: k } };
    } },
    linterleave: { kind: 'letter', make: function (rng) {
      var d = rng.int(1, 2);
      return interleave(rng.int(1, 6), d, rng.int(21, 26), -d, 6, { d1: d, d2: -d });
    } },
    lgrow: { kind: 'letter', make: function (rng) {
      var fwd = rng.chance(0.6), i = 1, a = fwd ? rng.int(1, 5) : rng.int(22, 26);
      return seq(a, 6, function (x) { var y = x + (fwd ? i : -i); i++; return y; }, { start: fwd ? 1 : -1, grow: fwd ? 1 : -1 });
    } },
    ltwostep: { kind: 'letter', make: function (rng) {
      var p = rng.int(2, 4), q = -rng.int(1, p - 1), i = 0, a = rng.int(1, 6);
      return seq(a, 7, function (x) { var y = x + (i % 2 === 0 ? p : q); i++; return y; }, { steps: [p, q] });
    } },
    linterleave2: { kind: 'letter', make: function (rng) {
      var d1 = rng.int(2, 3), d2 = -rng.int(1, 4);
      if (d1 === -d2) return null;
      return interleave(rng.int(1, 5), d1, rng.int(18, 26), d2, 7, { d1: d1, d2: d2 });
    } }
  };
  function seq(a, n, f, params) {
    var xs = [a];
    while (xs.length < n + 1) xs.push(f(xs[xs.length - 1]));
    return { xs: xs.slice(0, n), answer: xs[n], params: params };
  }
  function interleave(a, d1, b, d2, n, params) {
    var all = [];
    for (var i = 0; i <= n; i++) all.push(i % 2 === 0 ? a + d1 * (i / 2) : b + d2 * ((i - 1) / 2));
    return { xs: all.slice(0, n), answer: all[n], params: params };
  }

  // ---------------------------------------------------------------- solver: every family that the shown terms over-determine
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
  function predictions(xs, kind) {
    var n = xs.length, d = diffs(xs), out = [];
    function add(family, v) { if (isInt(v)) out.push({ family: family, value: v }); }
    // arithmetic (2 params)
    if (n >= 3 && allEq(d)) add('arith', xs[n - 1] + d[0]);
    // geometric (2 params; ratio exact, terms non-zero)
    if (n >= 3 && xs.every(function (x) { return x !== 0; })) {
      var okG = true;   // x[i] / x[i−1] = x[1] / x[0] for every i, by cross-multiplication
      for (var i = 2; i < n; i++) if (xs[i] * xs[0] !== xs[i - 1] * xs[1]) okG = false;
      if (okG && xs[1] !== xs[0]) add('geom', xs[n - 1] * xs[1] / xs[0]);
    }
    // constant second difference (3 params)
    if (n >= 4) { var dd = diffs(d); if (allEq(dd) && dd[0] !== 0) add('second', xs[n - 1] + d[d.length - 1] + dd[0]); }
    // period-2 difference cycle (3 params)
    if (n >= 4) {
      var ok2 = true;
      for (var j = 2; j < d.length; j++) if (d[j] !== d[j - 2]) ok2 = false;
      if (ok2 && d[0] !== d[1]) add('cycle2', xs[n - 1] + d[d.length - 2]);
    }
    // period-3 difference cycle (4 params)
    if (n >= 5) {
      var ok3 = true;
      for (var j3 = 3; j3 < d.length; j3++) if (d[j3] !== d[j3 - 3]) ok3 = false;
      if (ok3 && !(d[0] === d[1] && d[1] === d[2])) add('cycle3', xs[n - 1] + d[d.length - 3]);
    }
    // two interleaved arithmetic series (4 params): each subsequence needs ≥ 3 shown terms
    var ev = xs.filter(function (_, k) { return k % 2 === 0; }), od = xs.filter(function (_, k) { return k % 2 === 1; });
    if (ev.length >= 3 && od.length >= 3 && allEq(diffs(ev)) && allEq(diffs(od))) {
      var sub = n % 2 === 0 ? ev : od, sd = diffs(sub);
      add('interleave', sub[sub.length - 1] + sd[0]);
    }
    // Fibonacci-like (2 params) and Fibonacci plus a constant (3 params)
    if (n >= 3) {
      var okF = true;
      for (var f = 2; f < n; f++) if (xs[f] !== xs[f - 1] + xs[f - 2]) okF = false;
      if (okF) add('fib', xs[n - 1] + xs[n - 2]);
    }
    if (n >= 4) {
      var c = xs[2] - xs[1] - xs[0], okC = c !== 0;
      for (var f2 = 3; f2 < n; f2++) if (xs[f2] !== xs[f2 - 1] + xs[f2 - 2] + c) okC = false;
      if (okC) add('fibc', xs[n - 1] + xs[n - 2] + c);
    }
    // x → m·x + c with integer m ≥ 2 (3 params)
    if (n >= 4 && xs[1] !== xs[0]) {
      var m = (xs[2] - xs[1]) / (xs[1] - xs[0]);
      if (isInt(m) && m >= 2) {
        var cc = xs[1] - m * xs[0], okL = true;
        for (var l = 1; l < n; l++) if (xs[l] !== m * xs[l - 1] + cc) okL = false;
        if (okL) add('linrec', m * xs[n - 1] + cc);
      }
    }
    // alternating × m and + c, either phase (4 params)
    if (n >= 5) {
      for (var ph = 0; ph < 2; ph++) {
        var mi = ph === 0 ? 0 : 1, ai = 1 - mi;              // index of the first × step and of the first + step
        if (xs[mi] === 0) continue;
        var mm = xs[mi + 1] / xs[mi], c2 = xs[ai + 1] - xs[ai];
        if (!isInt(mm) || mm < 2) continue;
        var okM = true;
        for (var t = 0; t < n - 1; t++) {
          var want = ((t + ph) % 2 === 0) ? xs[t] * mm : xs[t] + c2;
          if (xs[t + 1] !== want) okM = false;
        }
        if (okM) add('mulAdd', ((n - 1 + ph) % 2 === 0) ? xs[n - 1] * mm : xs[n - 1] + c2);
      }
    }
    // each value twice, values in equal steps (3 params incl. phase): A A C C E E → G
    if (n >= 5) {
      var pairs = [], okR = true;
      for (var r = 0; r + 1 < n; r += 2) { if (xs[r] !== xs[r + 1]) okR = false; pairs.push(xs[r]); }
      if (okR && pairs.length >= 2 && allEq(diffs(pairs)) && pairs[1] !== pairs[0]) {
        var pd = pairs[1] - pairs[0];
        if (n % 2 === 0) add('rep', pairs[pairs.length - 1] + pd);
        else { if (xs[n - 1] === pairs[pairs.length - 1] + pd) add('rep', xs[n - 1]); }
      }
    }
    if (kind === 'letter') out = out.filter(function (p) { return p.value >= 1 && p.value <= 26; });
    return out;
  }
  function toPositions(item) {
    return item.stim.terms.map(function (s) { return item.stim.kind === 'letter' ? ABC.indexOf(s) + 1 : Number(s); });
  }
  function solve(item) {
    var xs = toPositions(item), preds = predictions(xs, item.stim.kind);
    var values = [];
    preds.forEach(function (p) { if (values.indexOf(p.value) < 0) values.push(p.value); });
    var canon = values.length === 1 ? (item.stim.kind === 'letter' ? letter(values[0]) : String(values[0])) : null;
    return { ok: values.length === 1 && canon === item.answer, unique: values.length === 1, values: values, predictions: preds, answer: canon };
  }

  // ---------------------------------------------------------------- cheap guessers (tests; generator rejects their hits)
  var shortcuts = {
    repeatLastDiff: function (xs) { var n = xs.length; return xs[n - 1] + (xs[n - 1] - xs[n - 2]); },
    repeatLastTerm: function (xs) { return xs[xs.length - 1]; },
    lastRatio: function (xs) { var n = xs.length; return xs[n - 2] ? xs[n - 1] * xs[n - 1] / xs[n - 2] : NaN; },
    twoBack: function (xs) { return xs[xs.length - 2]; }
  };

  // ---------------------------------------------------------------- items and forms
  function display(kind, xs) { return xs.map(function (x) { return kind === 'letter' ? letter(x) : String(x); }); }
  function inRange(kind, all) {
    return all.every(function (x) { return isInt(x) && (kind === 'letter' ? x >= 1 && x <= 26 : x >= 0 && x <= MAX_NUM); });
  }
  function tryBuild(familyId, rng) {
    var fam = FAMILIES[familyId], r = fam.make(rng);
    if (!r) return null;
    if (!inRange(fam.kind, r.xs.concat([r.answer]))) return null;
    if (fam.kind === 'number' && r.answer > MAX_NUM) return null;
    if (!fam.constantStep) {
      // a family's own rule is not a shortcut: constant ratio is the geometric rule itself
      var hit = Object.keys(shortcuts).some(function (k) {
        if (k === 'lastRatio' && fam.constantRatio) return false;
        return shortcuts[k](r.xs) === r.answer;
      });
      if (hit) return null;
    }
    var terms = display(fam.kind, r.xs);
    var item = {
      stim: { kind: fam.kind, terms: terms, display: terms.join(', ') + ', ?' },
      answer: fam.kind === 'letter' ? letter(r.answer) : String(r.answer),
      meta: { family: familyId, nShown: r.xs.length, answerValue: r.answer, params: r.params }
    };
    var sol = solve(item);
    if (!sol.ok) return null;
    return item;
  }
  // Hand-made, solver-checked (unit tests) stand-ins, one per family, used only if 200 draws all fail.
  var FALLBACKS = {
    arith: [[4, 9, 14, 19, 24], 29], geom: [[3, 6, 12, 24, 48], 96], second: [[2, 3, 5, 8, 12, 17], 23],
    twostep: [[10, 17, 14, 21, 18, 25, 22], 29], interleave: [[5, 30, 8, 27, 11, 24, 14], 21], fib: [[3, 4, 7, 11, 18, 29], 47],
    mulAdd: [[2, 4, 7, 14, 17, 34, 37], 74], cycle3: [[20, 24, 22, 23, 27, 25, 26, 30], 28],
    lskip: [[3, 6, 9, 12, 15], 18], lrep: [[2, 2, 4, 4, 6, 6], 8], linterleave: [[1, 26, 2, 25, 3, 24], 4],
    lgrow: [[2, 3, 5, 8, 12, 17], 23], ltwostep: [[1, 4, 3, 6, 5, 8, 7], 10], linterleave2: [[2, 26, 5, 24, 8, 22, 11], 20]
  };
  function fallbackItem(familyId) {
    var kind = FAMILIES[familyId].kind, f = FALLBACKS[familyId], terms = display(kind, f[0]);
    return { stim: { kind: kind, terms: terms, display: terms.join(', ') + ', ?' },
             answer: kind === 'letter' ? letter(f[1]) : String(f[1]),
             meta: { family: familyId, nShown: f[0].length, answerValue: f[1], params: null, fallback: true } };
  }
  function genItem(familyId, seedString) {
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var item = tryBuild(familyId, HF.rng.create(seedString + '#' + attempt));
      if (item) { item.meta.attempts = attempt + 1; return item; }
    }
    return fallbackItem(familyId);
  }

  // Blueprint series-1 (identical for forms A–D), easy → hard; 8 number + 6 letter items.
  var BLUEPRINT_ITEMS = ['arith', 'lskip', 'lrep', 'geom', 'second', 'linterleave', 'twostep', 'lgrow',
                         'interleave', 'ltwostep', 'fib', 'mulAdd', 'linterleave2', 'cycle3'];
  var PRACTICE = [
    { i: 0, practice: true, stim: { kind: 'number', terms: ['2', '4', '6', '8'], display: '2, 4, 6, 8, ?' }, answer: '10',
      meta: { family: 'arith', nShown: 4, answerValue: 10 }, explain: 'Each number is 2 more than the one before.' },
    { i: 1, practice: true, stim: { kind: 'letter', terms: ['B', 'D', 'F', 'H'], display: 'B, D, F, H, ?' }, answer: 'J',
      meta: { family: 'lskip', nShown: 4, answerValue: 10 }, explain: 'Each letter skips one letter of the alphabet.' }
  ];
  var INSTRUCTIONS = 'Each row is a series of numbers or letters that follows a rule. Type the next one and press Enter. ' +
    'Numbers are whole numbers of 0 or more; letters are A–Z (upper or lower case). You have 60 seconds per series.';
  function practiceItems() { return JSON.parse(JSON.stringify(PRACTICE)); }
  /** practice({ seed? }) → TestSpec: 2 fixed unscored items, identical at every visit (seed ignored). */
  function practice() {
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: 'P', seed: 'fixed', release: true, version: VERSION,
      blueprint: BLUEPRINT, set: 'labSeries', rung: null, practice: true, params: { nScored: 0 },
      windowMs: WINDOW_MS, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS, instructions: INSTRUCTIONS,
      trials: practiceItems(), meta: { solverChecked: true, fallback: [] }
    };
  }

  function gen(opts) {
    opts = opts || {};
    var form = opts.form || 'A';
    if (form === 'P') return practice(opts);
    if (FORMS.indexOf(form) < 0) throw new Error('lab.series.gen: form must be A, B, C or D');
    var seed = opts.seed != null && opts.seed !== '' ? String(opts.seed) : defaultSeed(form);
    var release = seed === defaultSeed(form);
    var fallback = [];
    var trials = BLUEPRINT_ITEMS.map(function (fam, i) {
      var item = genItem(fam, seed + '/item' + i);
      item.meta.template = i + 1;
      if (item.meta.fallback) fallback.push({ i: i, template: i + 1 });
      return { i: i, stim: item.stim, answer: item.answer, meta: item.meta };
    });
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: form, seed: seed, release: release, version: VERSION,
      blueprint: BLUEPRINT, set: 'labSeries', rung: null,
      params: { nScored: trials.length, nNumber: 8, nLetter: 6 },
      windowMs: WINDOW_MS, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS, instructions: INSTRUCTIONS,
      practice: practiceItems(), trials: trials, meta: { solverChecked: true, fallback: fallback }
    };
  }

  // ---------------------------------------------------------------- answers and scoring
  function normalize(kind, raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/\s+/g, '').replace(/[.,;:!?'"]+$/, '');
    if (kind === 'number') {
      s = s.replace(/^\+/, '');
      var m = /^(\d{1,6})(?:\.0+)?$/.exec(s);
      return m ? String(parseInt(m[1], 10)) : null;
    }
    if (kind === 'letter') return /^[A-Za-z]$/.test(s) ? s.toUpperCase() : null;
    return null;
  }
  function indexAnswers(log) {
    var by = {};
    ((log && log.answers) || []).forEach(function (a) { if (a && a.i != null && !by[a.i]) by[a.i] = a; });
    return by;
  }
  function isTimeout(a) { return !!a.timedOut || a.response === null || a.response === undefined || a.response === ''; }
  function score(spec, log) {
    var by = indexAnswers(log), st = HF.stats;
    var nItems = 0, n = 0, correct = 0, timeouts = 0, voided = 0, missing = 0, invalid = 0, tooFast = 0, rts = [];
    var byKind = { number: { correct: 0, n: 0 }, letter: { correct: 0, n: 0 } };
    spec.trials.forEach(function (t) {
      nItems++;
      var a = by[t.i];
      if (!a) { missing++; return; }
      if (a.voided) { voided++; return; }
      n++;
      var bk = byKind[t.stim.kind]; bk.n++;
      if (isTimeout(a)) { timeouts++; return; }
      var canon = normalize(t.stim.kind, a.response);
      if (canon === null) invalid++;
      if (typeof a.rt === 'number' && a.rt < (spec.tooFastMs || TOO_FAST_MS)) tooFast++;
      if (canon !== null && canon === t.answer) { correct++; bk.correct++; if (typeof a.rt === 'number') rts.push(a.rt); }
    });
    var flags = [];
    if (missing > 0) flags.push('incomplete');
    if (nItems && voided / nItems > 0.10) flags.push('many-voided');
    if (tooFast >= 3) flags.push('too-fast');
    return stamp(spec, {
      testId: TEST_ID, score: n ? correct / n : null, scoreLabel: correct + ' of ' + n + ' correct',
      higherIsBetter: true, unit: 'proportion',
      sub: { correct: correct, n: n, nItems: nItems, timeouts: timeouts, voided: voided, missing: missing, invalid: invalid,
             tooFast: tooFast, byKind: byKind, medianRtCorrect: rts.length ? st.median(rts) : null,
             form: spec.form, blueprint: spec.blueprint, release: !!spec.release, paused: !!(log && log.paused) },
      flags: flags
    });
  }
  function rows(spec, log) {
    var by = indexAnswers(log);
    return spec.trials.map(function (t) {
      var a = by[t.i] || null, to = a ? isTimeout(a) : null;
      var canon = a && !to ? normalize(t.stim.kind, a.response) : null;
      return {
        test: TEST_ID, form: spec.form, blueprint: spec.blueprint, seed: spec.seed, i: t.i, template: t.meta.template,
        kind: t.stim.kind, family: t.meta.family, terms: t.stim.terms.join(' '), answer: t.answer,
        response: a && !to ? String(a.response) : null, responseCanonical: canon,
        correct: a && !a.voided ? canon !== null && canon === t.answer : null,
        rt: a ? (a.rt == null ? null : a.rt) : null, timedOut: a ? to && !a.voided : null, voided: a ? !!a.voided : null
      };
    });
  }

  var test = {
    id: TEST_ID, label: 'Series', paradigm: 'number and letter series, typed answer',
    minutes: 6, defaultLevel: 'far', higherIsBetter: true, unit: 'proportion', exploratory: false,
    blueprint: BLUEPRINT, formSeed: defaultSeed, part: 'B', version: VERSION, instructions: INSTRUCTIONS,
    gen: gen, score: score, rows: rows, practice: practice, normalize: normalize, solve: solve,
    genItem: genItem, fallbackItem: fallbackItem, FAMILIES: FAMILIES, BLUEPRINT_ITEMS: BLUEPRINT_ITEMS,
    shortcuts: shortcuts, predictions: predictions
  };
  if (HF.lab && HF.lab.register) HF.lab.register(test); else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
