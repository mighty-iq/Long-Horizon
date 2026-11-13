/* Long-Horizon — Lab test lab.bind: location–colour binding (pure, no DOM). MIT licence. Extended configuration only.
   Mid transfer. Lab-only paradigm, never trained.
   Design (research/04 §12.1 A5, after the location–letter binding idea in Wilhelm et al. 2013, with colours as in
   Hicks et al. 2016; written fresh): a 3×3 grid; 2–6 colour patches appear one at a time at distinct cells
   (1.5 s each + 0.5 s gap); then every shown cell is probed once, in a random order that differs from the
   presentation order (set size ≥ 3): "which colour was here?". Answer options = the colours of this trial, in
   fixed palette order. Colour is never the only cue: each palette entry has a pattern and a name (HF.lab.PALETTE,
   Okabe–Ito colours), and the spec carries both.
   Blueprint: set sizes [2,2,3,3,3,4,4,4,5,5,5,6,6,6] in a seeded random order = 14 trials, 58 probes.

   TestSpec  { kind: 'bind', testId, form, seed, version, practice, grid: 3, showMs: 1500, gapMs: 500,
               palette: HF.lab.PALETTE (copy: { index, id, name, hex, pattern, label }),
               trials: [ { i, setSize, items: [ { cell, colour: paletteIndex } ] (presentation order),
                           probes: [ { cell, answer: paletteIndex } ], options: [paletteIndex…] } ],
               meta: { setSizes, probes: 58 } }
   Log       { trials: [ { i, answers: [ { probe: j, response: paletteIndex|null, rt } ], voided } ], paused }
   Result    score = proportion of probes answered with the right colour.
             sub = { correct, total, bySize: { 2…6 }, timeouts, rtMedian, chance (expected proportion by guessing), trials, voided }
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

  var ID = 'lab.bind';
  var SIZES = [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6];
  var SHOW_MS = 1500, GAP_MS = 500;
  var CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  function sameOrder(a, b) {
    for (var j = 0; j < a.length; j++) if (a[j].cell !== b[j].cell) return false;
    return true;
  }

  function makeTrial(rng, n, i) {
    var cells = rng.sample(CELLS, n);
    var colours = rng.sample(HF.lab.PALETTE.map(function (p) { return p.index; }), n);
    var items = cells.map(function (c, j) { return { cell: c, colour: colours[j] }; });
    var probes = rng.shuffle(items);
    for (var t = 0; n >= 3 && sameOrder(probes, items) && t < 50; t++) probes = rng.shuffle(items);
    return {
      i: i, setSize: n, items: items,
      probes: probes.map(function (x) { return { cell: x.cell, answer: x.colour }; }),
      options: colours.slice().sort(function (a, b) { return a - b; })
    };
  }

  function build(seed, sizes, keepOrder) {
    var rng = HF.rng.create(seed);
    var order = keepOrder ? sizes.slice() : rng.shuffle(sizes);
    var trials = order.map(function (n, i) { return makeTrial(rng, n, i); });
    return { trials: trials, meta: { setSizes: order, probes: order.reduce(function (a, b) { return a + b; }, 0) } };
  }

  function palette() { return HF.lab.PALETTE.map(function (p) { var c = {}; Object.keys(p).forEach(function (k) { c[k] = p[k]; }); return c; }); }

  function gen(o) {
    o = o || {};
    var seed = HF.lab.seedOf(ID, o);
    var b = build(seed, SIZES, false);
    return { kind: 'bind', testId: ID, form: o.form || null, seed: seed, version: 1, practice: false,
      grid: 3, showMs: SHOW_MS, gapMs: GAP_MS, palette: palette(), trials: b.trials, meta: b.meta };
  }

  /** a 2-patch and a 3-patch trial, identical at every visit — not scored */
  function practice(o) {
    o = o || {};
    var seed = o.seed ? String(o.seed) : HF.lab.formSeed(ID, 'P');
    var b = build(seed, [2, 3], true);
    return { kind: 'bind', testId: ID, form: 'P', seed: seed, version: 1, practice: true,
      grid: 3, showMs: SHOW_MS, gapMs: GAP_MS, palette: palette(), trials: b.trials, meta: b.meta };
  }

  function walk(tr, L) {
    var a = [], list = (L && L.answers) || [];
    list.forEach(function (x, idx) { var j = x && x.probe != null ? x.probe : idx; if (j < tr.probes.length && a[j] == null) a[j] = x; });
    return tr.probes.map(function (p, j) {
      var x = a[j] || {};
      var resp = x.response == null ? null : Number(x.response);
      return { j: j, cell: p.cell, answer: p.answer, response: resp, rt: typeof x.rt === 'number' ? x.rt : null, ok: resp === p.answer };
    });
  }

  function score(spec, log) {
    log = log || {};
    var logs = H.byIndex(log.trials, 'i');
    var ok = 0, total = 0, timeouts = 0, rts = [], voided = 0, nTrials = 0, chance = 0, incomplete = false;
    var bySize = {}, bySizeN = {};
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i];
      if (!L) { incomplete = true; return; }
      if (L.voided) { voided++; return; }
      nTrials++;
      walk(tr, L).forEach(function (w) {
        total++; chance += 1 / tr.options.length;
        bySizeN[tr.setSize] = (bySizeN[tr.setSize] || 0) + 1;
        if (w.ok) { ok++; bySize[tr.setSize] = (bySize[tr.setSize] || 0) + 1; if (w.rt != null) rts.push(w.rt); }
        if (w.response == null) timeouts++;
      });
    });
    var bs = {};
    Object.keys(bySizeN).forEach(function (k) { bs[k] = H.round((bySize[k] || 0) / bySizeN[k]); });
    var sc = total ? ok / total : null;
    var flags = [];
    if (log.paused || (spec.trials.length && voided / spec.trials.length > 0.10)) flags.push('interrupted');
    if (incomplete) flags.push('incomplete');
    var label = sc == null ? 'no scored trials' : ok + ' of ' + total + ' colours matched to places (' + Math.round(100 * sc) + ' %)';
    return HF.lab.makeResult(spec, sc == null ? null : H.round(sc), label,
      { correct: ok, total: total, bySize: bs, timeouts: timeouts, rtMedian: H.median(rts),
        chance: total ? H.round(chance / total) : null, trials: nTrials, voided: voided }, flags);
  }

  function rows(spec, log) {
    var logs = H.byIndex(log && log.trials, 'i');
    var out = [];
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i], vd = !!(L && L.voided);
      walk(tr, L).forEach(function (w) {
        var pal = spec.palette[w.answer] || {}, got = w.response == null ? null : (spec.palette[w.response] || {}).id;
        out.push({ trial: tr.i, set_size: tr.setSize, probe: w.j, item: w.cell, correct_answer: pal.id, response: got == null ? null : got,
          rt: w.rt == null ? null : Math.round(w.rt), correct: w.ok, timeout: !!L && !vd && w.response == null, voided: vd });
      });
    });
    return out;
  }

  var test = {
    id: ID, label: 'Binding', paradigm: 'location–colour binding (which colour was here?)', part: 'A',
    minutes: 5, defaultLevel: 'mid', higherIsBetter: true, version: 1,
    gen: gen, practice: practice, score: score, rows: rows
  };
  if (HF.lab && typeof HF.lab.register === 'function') test = HF.lab.register(test);
  else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
