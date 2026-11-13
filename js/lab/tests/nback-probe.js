/* Long-Horizon — Lab test lab.nback: n-back probe (pure, no DOM). MIT licence.
   Near transfer for n-back trainees, mid otherwise (HF.lab.levels decides per user).
   Design (PLAN §6, research/04 §12.1 A1): Lab-only glyph set 'glyphsLab' (never trained), single visual stream,
   500 ms on / 3,000 ms SOA, blocks in ABAB order 2-back, 3-back, 2-back, 3-back; each block 20 + n items,
   leadIn n, 6 targets + 4 n±1 lures; MATCH key only (press-only, as in training); 90 items, 80 scorable.
   The blocks come from the training generator HF.tasks.nback.gen, called lazily at gen time
   ({ trackId: 'nback.plain', rung: 2(n−1), params: { n, onMs: 500, soaMs: 3000 }, set: 'glyphsLab', seed,
   lureCount: 4, lureMode: 'controlled', lab: true }), so this file loads without it. A block that is not exactly
   6 targets + 4 lures, or that the generator marks meta.fallback, is replaced by the block for the next derived seed
   (seed/r1, seed/r2, …; block.labRetries counts them), so every form keeps the same blueprint.

   TestSpec  { kind: 'stream-set', testId: 'lab.nback', form, seed, version, practice: bool, press: 'match',
               blocks: [ StreamBlockSpec (SPEC §4.2) × 4 ], meta: { order: [2,3,2,3], set: 'glyphsLab', targets: 6, lures: 4 } }
   Log       { blocks: [ StreamLog (SPEC §4.2: { responses: [{ key, t, trial }], voided: [i], paused, onsets?: [ms] }) × 4 ] }
             RT = t − onsets[i] when the player logs onsets, else t − i × soaMs.
   Result    score = mean d′ over the scored blocks (log-linear correction, HF.stats.sdt).
             sub = { dprime2, dprime3, hits, misses, fas, crs, hitRate, faRate, lureFaRate, criterion,
                     rtMedian (hits), tooFast, presses, voided, nScorable, blocks: [{ n, dprime, criterion, h, m, fa, cr, lfa, lt }] }
             flags: 'interrupted' (> 10 % of scorable items voided, or a block paused), 'incomplete' (a block log missing),
                    'too-fast' (≥ 10 % of presses, at least 2, under 150 ms).
   Deviation: research/04 §19 proposes 2 "press now" catch frames per block; they are left out because an extra frame
   inside a stream changes what "n back" means. Attention is covered by too-fast presses and the close-out honesty item.
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

  var ID = 'lab.nback';
  var ORDER = [2, 3, 2, 3];
  var SET = 'glyphsLab';
  var ON_MS = 500, SOA_MS = 3000;
  var TOO_FAST_MS = 150;

  function nbackGen() {
    var t = HF.tasks && HF.tasks.nback;
    if (!t || typeof t.gen !== 'function') throw new Error('lab.nback: HF.tasks.nback.gen is not loaded (js/tasks/nback/gen.js)');
    return t.gen;
  }

  /** null when the block has the probe's exact shape, else what is wrong */
  function blockProblem(spec, n) {
    if (!spec || spec.kind !== 'stream' || !Array.isArray(spec.trials)) return 'no stream BlockSpec';
    if (spec.meta && spec.meta.fallback) return 'generator fallback (' + spec.meta.fallback + ')';
    var sc = 0, tg = 0, lu = 0;
    spec.trials.forEach(function (tr) {
      if (!tr.scorable) return;
      sc++;
      if (tr.target && tr.target.main) tg++;
      else if (tr.lure && tr.lure.main) lu++;
    });
    if (spec.trials.length !== 20 + n || sc !== 20 || tg !== 6 || lu !== 4) {
      return 'items=' + spec.trials.length + ', scorable=' + sc + ', targets=' + tg + ', lures=' + lu;
    }
    return null;
  }

  /** Every probe block must have 6 targets and exactly 4 controlled n±1 lures (form equivalence). If the training
      generator falls back for a seed, the next derived seed (seed/r1, seed/r2, …) is used — still deterministic. */
  function block(n, seed) {
    var gen = nbackGen(), last = '';
    for (var r = 0; r < 25; r++) {
      var spec = gen({
        trackId: 'nback.plain', rung: 2 * (n - 1), params: { n: n, onMs: ON_MS, soaMs: SOA_MS },
        set: SET, seed: r ? seed + '/r' + r : seed, lureCount: 4, lureMode: 'controlled', protocol: null, lab: true
      });
      last = blockProblem(spec, n);
      if (!last) { spec.n = n; spec.labRetries = r; return spec; }
    }
    throw new Error('lab.nback: no valid ' + n + '-back block for seed ' + seed + ' (' + last + ')');
  }

  function gen(o) {
    o = o || {};
    var seed = HF.lab.seedOf(ID, o);
    var blocks = ORDER.map(function (n, b) { return block(n, seed + '/b' + b); });
    return {
      kind: 'stream-set', testId: ID, form: o.form || null, seed: seed, version: 1, practice: false, press: 'match',
      blocks: blocks, meta: { order: ORDER.slice(), set: SET, targets: 6, lures: 4, onMs: ON_MS, soaMs: SOA_MS }
    };
  }

  /** one 2-back block, identical at every visit (fixed seed) — not scored */
  function practice(o) {
    o = o || {};
    var seed = o.seed ? String(o.seed) : HF.lab.formSeed(ID, 'P');
    return {
      kind: 'stream-set', testId: ID, form: 'P', seed: seed, version: 1, practice: true, press: 'match',
      blocks: [block(2, seed + '/b0')], meta: { order: [2], set: SET, targets: 6, lures: 4, onMs: ON_MS, soaMs: SOA_MS }
    };
  }

  function nOf(spec, b) {
    var bs = spec.blocks[b];
    if (bs.n) return bs.n;
    if (bs.params && bs.params.n) return bs.params.n;
    return (spec.meta && spec.meta.order && spec.meta.order[b]) || bs.leadIn;
  }

  /** per-trial outcomes for one block (shared by score and rows) */
  function walk(bs, L) {
    L = L || {};
    var soa = bs.soaMs || SOA_MS;
    var voided = {};
    (L.voided || []).forEach(function (i) { voided[i] = true; });
    var press = {};
    (L.responses || []).forEach(function (r) {
      if (!r || r.key !== 'match' || r.trial == null || press[r.trial]) return;
      var onset = L.onsets && typeof L.onsets[r.trial] === 'number' ? L.onsets[r.trial] : r.trial * soa;
      press[r.trial] = { t: r.t, rt: typeof r.t === 'number' ? r.t - onset : null };
    });
    return bs.trials.map(function (tr) {
      var p = press[tr.i] || null;
      var isT = !!(tr.target && tr.target.main);
      var lure = tr.lure && tr.lure.main ? tr.lure.main : null;
      var out;
      if (voided[tr.i]) out = 'voided';
      else if (!tr.scorable) out = p ? 'lead-in-press' : 'lead-in';
      else if (isT) out = p ? 'hit' : 'miss';
      else if (p) out = lure ? 'lure-fa' : 'fa';
      else out = 'cr';
      return { i: tr.i, scorable: !!tr.scorable, target: isT, lure: lure, pressed: !!p, rt: p ? p.rt : null, outcome: out, stim: tr.stim && tr.stim.main };
    });
  }

  function score(spec, log) {
    log = log || {};
    var logs = log.blocks || [];
    var tot = { h: 0, m: 0, fa: 0, cr: 0, lfa: 0, lt: 0 }, perBlock = [], rts = [], dps = [], crits = [];
    var by = { 2: [], 3: [] }, tooFast = 0, presses = 0, voided = 0, scorableN = 0, incomplete = false, paused = false;
    spec.blocks.forEach(function (bs, b) {
      var L = logs[b];
      if (!L) { incomplete = true; return; }
      if (L.paused) paused = true;
      var c = { h: 0, m: 0, fa: 0, cr: 0, lfa: 0, lt: 0 };
      walk(bs, L).forEach(function (w) {
        if (w.pressed) { presses++; if (w.rt != null && w.rt < TOO_FAST_MS) tooFast++; }
        if (!w.scorable) return;
        scorableN++;
        if (w.outcome === 'voided') { voided++; return; }
        if (w.target) { if (w.pressed) { c.h++; if (w.rt != null) rts.push(w.rt); } else c.m++; }
        else {
          if (w.lure) { c.lt++; if (w.pressed) c.lfa++; }
          if (w.pressed) c.fa++; else c.cr++;
        }
      });
      var n = nOf(spec, b);
      if (c.h + c.m + c.fa + c.cr === 0) { perBlock.push({ n: n, dprime: null, criterion: null, h: 0, m: 0, fa: 0, cr: 0, lfa: 0, lt: 0 }); return; }
      var s = HF.stats.sdt(c.h, c.m, c.fa, c.cr);
      perBlock.push({ n: n, dprime: H.round(s.dprime), criterion: H.round(s.criterion), h: c.h, m: c.m, fa: c.fa, cr: c.cr, lfa: c.lfa, lt: c.lt });
      dps.push(s.dprime); crits.push(s.criterion);
      if (by[n]) by[n].push(s.dprime);
      Object.keys(c).forEach(function (k) { tot[k] += c[k]; });
    });
    var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    var sc = mean(dps);
    var flags = [];
    if (paused || (scorableN && voided / scorableN > 0.10)) flags.push('interrupted');
    if (incomplete) flags.push('incomplete');
    if (presses && tooFast >= Math.max(2, 0.10 * presses)) flags.push('too-fast');
    var nT = tot.h + tot.m, nN = tot.fa + tot.cr;
    var sub = {
      dprime2: H.round(mean(by[2])), dprime3: H.round(mean(by[3])),
      hits: tot.h, misses: tot.m, fas: tot.fa, crs: tot.cr, lureFas: tot.lfa, lureTrials: tot.lt,
      hitRate: nT ? H.round(tot.h / nT) : null, faRate: nN ? H.round(tot.fa / nN) : null,
      lureFaRate: tot.lt ? H.round(tot.lfa / tot.lt) : null, criterion: H.round(mean(crits)),
      rtMedian: H.median(rts), tooFast: tooFast, presses: presses, voided: voided, nScorable: scorableN, blocks: perBlock
    };
    var label = sc == null ? 'no scored blocks' : 'd′ ' + sc.toFixed(2) + ' (mean of ' + dps.length + ' blocks)';
    return HF.lab.makeResult(spec, sc == null ? null : H.round(sc), label, sub, flags);
  }

  function rows(spec, log) {
    var logs = (log && log.blocks) || [];
    var out = [];
    spec.blocks.forEach(function (bs, b) {
      var n = nOf(spec, b);
      walk(bs, logs[b]).forEach(function (w) {
        var st = w.stim || {};
        out.push({
          block: b + 1, n: n, trial: w.i, item: st.index != null ? st.index : (st.glyph || st.text || null),
          scorable: w.scorable, target: w.target, lure: w.lure, correct_answer: w.target ? 'match' : 'none',
          response: w.pressed ? 'match' : null, rt: w.rt == null ? null : Math.round(w.rt), outcome: w.outcome,
          correct: w.outcome === 'hit' || w.outcome === 'cr', too_fast: w.rt != null && w.rt < TOO_FAST_MS,
          voided: w.outcome === 'voided', block_seed: bs.seed
        });
      });
    });
    return out;
  }

  var test = {
    id: ID, label: 'N-back probe', paradigm: 'n-back with Lab-only glyphs (2- and 3-back, press on matches)', part: 'A',
    minutes: 6, defaultLevel: 'near', higherIsBetter: true, version: 1,
    gen: gen, practice: practice, score: score, rows: rows, _walk: walk
  };
  if (HF.lab && typeof HF.lab.register === 'function') test = HF.lab.register(test);
  else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
