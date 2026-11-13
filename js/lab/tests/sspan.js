/* Long-Horizon — Lab test lab.sspan: spatial complex span (pure, no DOM). MIT licence.
   Mid transfer (near only for Span trainees: same paradigm, other content). Lab-only paradigm, never trained.
   Design (PLAN §6, research/04 §12.1 A3; symmetry judgement + spatial storage after the SymSpan idea, written fresh):
   - processing: is this 8×8 black/white pattern symmetric about its vertical axis? self-paced, 6 s cap;
   - storage: one highlighted cell of a 4×4 grid (shown 1 s) after each judgement;
   - recall: tap the cells in the order shown;
   - blueprint: set sizes [2,2,2,3,3,3,4,4,4,5,5,5] in a seeded random order = 12 trials, 42 cells,
     42 judgements of which exactly 21 symmetric (shuffled).
   Patterns: the left half is random (density kept to 24–40 black cells of 64) and mirrored. An asymmetric pattern
   takes 2–3 "moves", each turning one cell of a black mirror pair white and one cell of a white pair black, so the
   black-cell count (and its parity) is the same as a symmetric pattern's: density cannot give the answer.

   TestSpec  { kind: 'span', task: 'lab.sspan', testId, form, seed, version, practice, procLimitMs: 6000, memMs: 1000,
               procGrid: 8, memGrid: 4,
               trials: [ { i, setSize, order: 'forward', recallKeypad: [0..15],
                           pairs: [ { proc: { rows: ['01100110', … 8 strings], symmetric: bool, black: n }, mem: <cell 0..15> } ] } ],
               meta: { setSizes, judgements: 42, symmetric: 21, cells: 42 } }
             Cells are row-major: cell = row × 4 + col.
   Log       SPEC §4.4: { trials: [ { i, proc: [ { resp: true (symmetric) | false | null, rt } ], recall: [cell…], voided } ], paused }
   Result    score = partial-credit unit score: mean over trials of (cells recalled in their serial position / set size).
             sub = { pcl (proportion of all 42 cells in position), absolute (sum of set sizes of perfect trials),
                     perfect, procAcc, procTimeouts, procRtMedian, bySize: { 2: pcu, … }, trials, voided }
             flags: 'proc-floor' (judgement accuracy < .80), 'interrupted' (> 10 % of trials voided or paused),
                    'incomplete' (a trial log missing).
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

  var ID = 'lab.sspan';
  var SET_SIZES = [2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];
  var PROC_LIMIT_MS = 6000, MEM_MS = 1000;
  var KEYPAD = [];
  for (var c0 = 0; c0 < 16; c0++) KEYPAD.push(c0);

  function isSymmetric(rows) {
    for (var r = 0; r < rows.length; r++) {
      var s = rows[r];
      for (var c = 0; c < s.length / 2; c++) if (s.charAt(c) !== s.charAt(s.length - 1 - c)) return false;
    }
    return true;
  }

  function makePattern(rng, symmetric) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var g = [], count = 0, r, c;
      for (r = 0; r < 8; r++) {
        var row = [0, 0, 0, 0, 0, 0, 0, 0];
        for (c = 0; c < 4; c++) { var v = rng.next() < 0.5 ? 1 : 0; row[c] = v; row[7 - c] = v; count += 2 * v; }
        g.push(row);
      }
      if (count < 24 || count > 40) continue;
      if (!symmetric) {
        var k = rng.int(2, 3), black = [], white = [];
        for (r = 0; r < 8; r++) for (c = 0; c < 4; c++) (g[r][c] ? black : white).push([r, c]);
        if (black.length < k || white.length < k) continue;
        rng.sample(black, k).forEach(function (p) { g[p[0]][rng.next() < 0.5 ? p[1] : 7 - p[1]] = 0; });
        rng.sample(white, k).forEach(function (p) { g[p[0]][rng.next() < 0.5 ? p[1] : 7 - p[1]] = 1; });
      }
      return { rows: g.map(function (row) { return row.join(''); }), symmetric: !!symmetric, black: count };
    }
    // unreachable in practice (acceptance ≈ .86 per attempt); deterministic fallback keeps the contract
    var fb = ['11000011', '01100110', '00111100', '10011001', '11000011', '01100110', '00111100', '10011001'];
    if (!symmetric) { fb = fb.slice(); fb[0] = '10100011'; fb[3] = '10011011'; fb[5] = '01100100'; }
    return { rows: fb, symmetric: !!symmetric, black: 32, fallback: true };
  }

  function build(seed, sizes, practiceRun) {
    var rng = HF.rng.create(seed);
    var order = practiceRun ? sizes.slice() : rng.shuffle(sizes);
    var total = order.reduce(function (a, b) { return a + b; }, 0);
    var symFlags = [];
    for (var j = 0; j < total; j++) symFlags.push(j < total / 2);
    symFlags = rng.shuffle(symFlags);
    var at = 0;
    var trials = order.map(function (n, i) {
      var cells = rng.sample(KEYPAD, n);
      var pairs = cells.map(function (cell) {
        return { proc: makePattern(rng, symFlags[at++]), mem: cell };
      });
      return { i: i, setSize: n, order: 'forward', recallKeypad: KEYPAD.slice(), pairs: pairs };
    });
    return { order: order, trials: trials, symmetric: symFlags.filter(Boolean).length, total: total };
  }

  function gen(o) {
    o = o || {};
    var seed = HF.lab.seedOf(ID, o);
    var b = build(seed, SET_SIZES, false);
    return {
      kind: 'span', task: ID, testId: ID, form: o.form || null, seed: seed, version: 1, practice: false,
      procLimitMs: PROC_LIMIT_MS, memMs: MEM_MS, procGrid: 8, memGrid: 4, trials: b.trials,
      meta: { setSizes: b.order, judgements: b.total, symmetric: b.symmetric, cells: b.total }
    };
  }

  /** two trials of two cells (4 judgements, 2 symmetric), identical at every visit — not scored */
  function practice(o) {
    o = o || {};
    var seed = o.seed ? String(o.seed) : HF.lab.formSeed(ID, 'P');
    var b = build(seed, [2, 2], true);
    return {
      kind: 'span', task: ID, testId: ID, form: 'P', seed: seed, version: 1, practice: true,
      procLimitMs: PROC_LIMIT_MS, memMs: MEM_MS, procGrid: 8, memGrid: 4, trials: b.trials,
      meta: { setSizes: b.order, judgements: b.total, symmetric: b.symmetric, cells: b.total }
    };
  }

  function walk(tr, L) {
    var procs = tr.pairs.map(function (p, k) {
      var x = (L && L.proc && L.proc[k]) || {};
      var resp = x.resp === true || x.resp === false ? x.resp : null;
      return { k: k, symmetric: p.proc.symmetric, resp: resp, rt: typeof x.rt === 'number' ? x.rt : null, ok: resp === p.proc.symmetric };
    });
    var recall = (L && L.recall) || [];
    var recs = tr.pairs.map(function (p, k) {
      var got = recall[k] == null ? null : Number(recall[k]);
      return { k: k, cell: p.mem, recalled: got, ok: got === p.mem };
    });
    return { procs: procs, recs: recs };
  }

  function score(spec, log) {
    log = log || {};
    var logs = H.byIndex(log.trials, 'i');
    var pcuSum = 0, nTrials = 0, items = 0, itemsOk = 0, absolute = 0, perfect = 0;
    var procN = 0, procOk = 0, procTo = 0, procRts = [], voided = 0, incomplete = false;
    var bySize = {}, bySizeN = {};
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i];
      if (!L) { incomplete = true; return; }
      if (L.voided) { voided++; return; }
      var w = walk(tr, L);
      var ok = w.recs.filter(function (x) { return x.ok; }).length;
      pcuSum += ok / tr.setSize; nTrials++; items += tr.setSize; itemsOk += ok;
      if (ok === tr.setSize) { absolute += tr.setSize; perfect++; }
      bySize[tr.setSize] = (bySize[tr.setSize] || 0) + ok / tr.setSize;
      bySizeN[tr.setSize] = (bySizeN[tr.setSize] || 0) + 1;
      w.procs.forEach(function (p) {
        procN++; if (p.ok) procOk++; if (p.resp == null) procTo++;
        if (p.ok && p.rt != null) procRts.push(p.rt);
      });
    });
    Object.keys(bySize).forEach(function (k) { bySize[k] = H.round(bySize[k] / bySizeN[k]); });
    var pcu = nTrials ? pcuSum / nTrials : null;
    var procAcc = procN ? procOk / procN : null;
    var flags = [];
    if (procAcc != null && procAcc < 0.80) flags.push('proc-floor');
    if (log.paused || (spec.trials.length && voided / spec.trials.length > 0.10)) flags.push('interrupted');
    if (incomplete) flags.push('incomplete');
    var sub = {
      pcl: items ? H.round(itemsOk / items) : null, absolute: absolute, perfect: perfect,
      procAcc: procAcc == null ? null : H.round(procAcc), procTimeouts: procTo, procRtMedian: H.median(procRts),
      bySize: bySize, trials: nTrials, voided: voided
    };
    var label = pcu == null ? 'no scored trials'
      : 'partial credit ' + pcu.toFixed(2) + ' · judgements ' + Math.round(100 * procAcc) + ' %';
    return HF.lab.makeResult(spec, pcu == null ? null : H.round(pcu), label, sub, flags);
  }

  function rows(spec, log) {
    var logs = H.byIndex(log && log.trials, 'i');
    var out = [];
    spec.trials.forEach(function (tr) {
      var L = logs[tr.i];
      var w = walk(tr, L);
      var vd = !!(L && L.voided);
      w.procs.forEach(function (p) {
        out.push({ trial: tr.i, set_size: tr.setSize, type: 'proc', pos: p.k, item: tr.pairs[p.k].proc.rows.join('/'),
          correct_answer: p.symmetric ? 'symmetric' : 'asymmetric', response: p.resp == null ? null : (p.resp ? 'symmetric' : 'asymmetric'),
          rt: p.rt == null ? null : Math.round(p.rt), correct: p.ok, timeout: !!L && !vd && p.resp == null, voided: vd });
      });
      w.recs.forEach(function (r) {
        out.push({ trial: tr.i, set_size: tr.setSize, type: 'recall', pos: r.k, item: r.cell, correct_answer: r.cell,
          response: r.recalled, rt: null, correct: r.ok, timeout: false, voided: vd });
      });
    });
    return out;
  }

  var test = {
    id: ID, label: 'Spatial span', paradigm: 'spatial complex span (symmetry judgements + grid locations)', part: 'A',
    minutes: 7, defaultLevel: 'mid', higherIsBetter: true, version: 1,
    gen: gen, practice: practice, score: score, rows: rows, isSymmetric: isSymmetric
  };
  if (HF.lab && typeof HF.lab.register === 'function') test = HF.lab.register(test);
  else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
