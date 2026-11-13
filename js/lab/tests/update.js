/* Long-Horizon — Lab test lab.update: spatial memory updating (pure, no DOM). MIT licence.
   Mid transfer. Lab-only paradigm, never trained.
   Design (research/04 §12.1 A4, after the spatial-figural updating idea in Wilhelm et al. 2013, written fresh):
   a 3×3 grid; 2–4 colours per trial; one coloured square appears at a time, at successive positions, 2–4 positions
   per colour; each appearance lasts 2.0 / 2.4 / 2.8 s for 2 / 3 / 4 colours, then a 0.5 s gap. At the end the
   player taps the LAST position of each colour (colours asked in a random order). 10 trials.
   Blueprint (positions per colour, one entry per trial; order shuffled per form):
     [2,3] [3,3] [3,4] · [2,2,3] [2,3,3] [3,3,3] [2,3,4] · [2,2,2,3] [2,2,3,3] [2,3,3,3]  → 30 colours, 81 appearances.
   Sequence rules: each colour's first appearance comes first (random colour order), then the moves in a random
   order with no colour twice in a row; a colour always moves to a cell that no colour occupies at that moment, so
   the final positions are distinct. Colours are Okabe–Ito with a redundant pattern (HF.lab.PALETTE).

   TestSpec  { kind: 'update', testId, form, seed, version, practice, grid: 3, gapMs: 500,
               palette: HF.lab.PALETTE (copy),
               trials: [ { i, load, stepMs, colours: [paletteIndex…], positions: [count per colour],
                           steps: [ { colour: k (index into this trial's colours), cell: 0..8 } ],
                           probes: [ { colour: k, answer: cell } ] } ],
               meta: { loads, colours: 30, steps: 81, fallback: n } }   cells are row-major (row × 3 + col).
   Log       { trials: [ { i, answers: [ { probe: j, response: cell|null, rt } ], voided } ], paused }
             answers[j] belongs to probes[j] (if 'probe' is missing, the array index is used).
   Result    score = proportion of colours placed correctly (30 in all).
             sub = { correct, total, byLoad: { 2, 3, 4 }, timeouts, rtMedian, trials, voided }
             flags: 'interrupted' (> 10 % of trials voided or paused), 'incomplete'.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  // shared helpers from js/lab/index.js, resolved at call time (this file may load before it)
  var H = {
    median: function (a) { return HF.lab._h.median(a); },
    round: function (x, d) { return HF.lab._h.round(x, d); },
    byIndex: function (l, k) { return HF.lab._h.byIndex(l, k); }
  };

  var ID = 'lab.update';
  var TEMPLATES = [[2, 3], [3, 3], [3, 4], [2, 2, 3], [2, 3, 3], [3, 3, 3], [2, 3, 4], [2, 2, 2, 3], [2, 2, 3, 3], [2, 3, 3, 3]];
  var STEP_MS = { 2: 2000, 3: 2400, 4: 2800 };
  var GAP_MS = 500;
  var CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  function noRepeats(seq) {
    for (var j = 1; j < seq.length; j++) if (seq[j] === seq[j - 1]) return false;
    return true;
  }

  /** order of colour appearances: first appearances, then moves; no colour twice in a row */
  function sequence(rng, counts) {
    var C = counts.length, k, j;
    var moves = [];
    for (k = 0; k < C; k++) for (j = 1; j < counts[k]; j++) moves.push(k);
    var colours = [];
    for (k = 0; k < C; k++) colours.push(k);
    for (var attempt = 0; attempt < 200; attempt++) {
      var seq = rng.shuffle(colours).concat(rng.shuffle(moves));
      if (noRepeats(seq)) return { seq: seq, fallback: false };
    }
    // deterministic greedy fallback: most remaining moves first, never the previous colour
    var first = colours.slice().sort(function (a, b) { return counts[a] - counts[b]; });
    var left = counts.map(function (n) { return n - 1; }), out = first.slice();
    while (out.length < first.length + moves.length) {
      var prev = out[out.length - 1], best = -1;
      for (k = 0; k < C; k++) if (k !== prev && left[k] > 0 && (best < 0 || left[k] > left[best])) best = k;
      if (best < 0) break;
      out.push(best); left[best]--;
    }
    for (k = 0; k < C; k++) while (left[k] > 0) { out.push(k); left[k]--; } // counts stay exact even if a repeat is forced
    return { seq: out, fallback: true };
  }

  function makeTrial(rng, counts, i) {
    var C = counts.length;
    var colours = rng.sample(HF.lab.PALETTE.map(function (p) { return p.index; }), C);
    var s = sequence(rng, counts);
    var pos = [];
    for (var k = 0; k < C; k++) pos.push(null);
    var steps = s.seq.map(function (k) {
      var free = CELLS.filter(function (c) { return pos.indexOf(c) < 0; });
      var cell = rng.pick(free);
      pos[k] = cell;
      return { colour: k, cell: cell };
    });
    var order = [];
    for (var q = 0; q < C; q++) order.push(q);
    var probes = rng.shuffle(order).map(function (k) { return { colour: k, answer: pos[k] }; });
    return { i: i, load: C, stepMs: STEP_MS[C] || 2400, colours: colours, positions: counts.slice(), steps: steps, probes: probes, fallback: s.fallback };
  }

  function build(seed, templates, keepOrder) {
    var rng = HF.rng.create(seed);
    var list = keepOrder ? templates.slice() : rng.shuffle(templates);
    var fb = 0;
    var trials = list.map(function (t, i) {
      // which colour gets which count is random; the multiset is the blueprint
      var tr = makeTrial(rng, rng.shuffle(t), i);
      if (tr.fallback) fb++;
      delete tr.fallback;
      return tr;
    });
    var nCol = 0, nSteps = 0;
    trials.forEach(function (t) { nCol += t.load; nSteps += t.steps.length; });
    return { trials: trials, meta: { loads: trials.map(function (t) { return t.load; }), colours: nCol, steps: nSteps, fallback: fb } };
  }

  function palette() { return HF.lab.PALETTE.map(function (p) { var c = {}; Object.keys(p).forEach(function (k) { c[k] = p[k]; }); return c; }); }

  function gen(o) {
    o = o || {};
    var seed = HF.lab.seedOf(ID, o);
    var b = build(seed, TEMPLATES, false);
    return { kind: 'update', testId: ID, form: o.form || null, seed: seed, version: 1, practice: false,
      grid: 3, gapMs: GAP_MS, palette: palette(), trials: b.trials, meta: b.meta };
  }

  /** one trial with two colours, two positions each — identical at every visit, not scored */
  function practice(o) {
    o = o || {};
    var seed = o.seed ? String(o.seed) : HF.lab.formSeed(ID, 'P');
    var b = build(seed, [[2, 2]], true);
    return { kind: 'update', testId: ID, form: 'P', seed: seed, version: 1, practice: true,
      grid: 3, gapMs: GAP_MS, palette: palette(), trials: b.trials, meta: b.meta };
  }

  function answersOf(L, nProbes) {
    var a = [], list = (L && L.answers) || [];
    list.forEach(function (x, idx) { var j = x && x.probe != null ? x.probe : idx; if (j < nProbes && a[j] == null) a[j] = x; });
    return a;
  }

  function walk(tr, L) {
    var ans = answersOf(L, tr.probes.length);
    return tr.probes.map(function (p, j) {
      var x = ans[j] || {};
      var resp = x.response == null ? null : Number(x.response);
      return { j: j, colour: p.colour, answer: p.answer, response: resp, rt: typeof x.rt === 'number' ? x.rt : null, ok: resp === p.answer };
    });
  }

  function score(spec, log) {
    log = log || {};
    var logs = H.byIndex(log.trials, 'i');
    var ok = 0, total = 0, timeouts = 0, rts = [], voided = 0, nTrials = 0, incomplete = false;
    var byLoad = {}, byLoadN = {};
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i];
      if (!L) { incomplete = true; return; }
      if (L.voided) { voided++; return; }
      nTrials++;
      walk(tr, L).forEach(function (w) {
        total++; byLoadN[tr.load] = (byLoadN[tr.load] || 0) + 1;
        if (w.ok) { ok++; byLoad[tr.load] = (byLoad[tr.load] || 0) + 1; if (w.rt != null) rts.push(w.rt); }
        if (w.response == null) timeouts++;
      });
    });
    var bl = {};
    Object.keys(byLoadN).forEach(function (k) { bl[k] = H.round((byLoad[k] || 0) / byLoadN[k]); });
    var sc = total ? ok / total : null;
    var flags = [];
    if (log.paused || (spec.trials.length && voided / spec.trials.length > 0.10)) flags.push('interrupted');
    if (incomplete) flags.push('incomplete');
    var label = sc == null ? 'no scored trials' : ok + ' of ' + total + ' colours placed (' + Math.round(100 * sc) + ' %)';
    return HF.lab.makeResult(spec, sc == null ? null : H.round(sc), label,
      { correct: ok, total: total, byLoad: bl, timeouts: timeouts, rtMedian: H.median(rts), trials: nTrials, voided: voided }, flags);
  }

  function rows(spec, log) {
    var logs = H.byIndex(log && log.trials, 'i');
    var out = [];
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i], vd = !!(L && L.voided);
      walk(tr, L).forEach(function (w) {
        var pal = spec.palette[tr.colours[w.colour]] || {};
        out.push({ trial: tr.i, load: tr.load, positions: tr.positions.join('+'), steps: tr.steps.length, probe: w.j,
          item: pal.id || tr.colours[w.colour], correct_answer: w.answer, response: w.response,
          rt: w.rt == null ? null : Math.round(w.rt), correct: w.ok, timeout: !!L && !vd && w.response == null, voided: vd });
      });
    });
    return out;
  }

  var test = {
    id: ID, label: 'Updating', paradigm: 'spatial memory updating (last position of each colour)', part: 'A',
    minutes: 6, defaultLevel: 'mid', higherIsBetter: true, version: 1,
    gen: gen, practice: practice, score: score, rows: rows
  };
  if (HF.lab && typeof HF.lab.register === 'function') test = HF.lab.register(test);
  else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
