/* Long-Horizon — Lab test lab.rel: relation probe (pure, no DOM). MIT licence.
   Near transfer for Relation Grid / Relation Stream trainees, mid otherwise (Equal Steps has no near probe).
   Design (PLAN §6, research/04 §12.1 A2, after Chuderski 2014): 3×3 arrays where only one position of each string
   counts; two mini-blocks of 20 arrays — "a row or column all the same" then "a row or column all different";
   half the arrays hold exactly one target line, split between rows and columns; 5.5 s window + 0.1 s blank
   (Grid rung 1 = R2, strings kept between arrays). Lab-only content: set 'lab' (reserved, never trained).
   The arrays come from the training generator HF.tasks.relations.gen (or HF.tasks.relations.grid.gen when there is no
   dispatcher), called lazily at gen time:
     Same:      { trackId: 'rel.grid.T1', rung: 1, set: 'lab', variant: 'lab', seed, lab: true }
     Different: { trackId: 'rel.grid.T3', rung: 1, set: 'lab', variant: 'lab', seed, lab: true }

   TestSpec  { kind: 'discrete-set', testId: 'lab.rel', form, seed, version, practice: bool,
               blocks: [ DiscreteBlockSpec (SPEC §4.3) Same, DiscreteBlockSpec Different ] (each block gets .rule),
               meta: { rules: ['same', 'different'], arrays: 40, targets: 20, rung: 1 } }
   Log       { blocks: [ DiscreteLog (SPEC §4.3: { answers: [{ i, response: 'match'|'no'|null, rt, voided }], paused }) × 2 ] }
   Result    score = hit rate − false-alarm rate over all 40 arrays (Chuderski's score).
             A timeout (response null) counts as "no target found": a miss on a target array, a correct rejection
             otherwise (as in Chuderski's go/no-go monitoring); timeouts are reported in sub.timeouts.
             sub = { hitRate, faRate, dprime, criterion, hits, misses, fas, crs, timeouts, rtMedian (hits), voided,
                     same: { hmf, dprime }, different: { hmf, dprime } }
             flags: 'interrupted' (> 10 % voided or a block paused), 'incomplete' (a block log missing).
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

  var ID = 'lab.rel';
  var RUNG = 1; // R2: 5.5 s, strings kept (Chuderski)
  var RULES = [{ rule: 'same', trackId: 'rel.grid.T1' }, { rule: 'different', trackId: 'rel.grid.T3' }];

  /** HF.tasks.relations.gen (dispatcher by trackId) when present, else the Grid generator HF.tasks.relations.grid.gen */
  function relGen() {
    var t = HF.tasks && HF.tasks.relations;
    if (t && typeof t.gen === 'function') return t.gen;
    if (t && t.grid && typeof t.grid.gen === 'function') return t.grid.gen;
    throw new Error('lab.rel: HF.tasks.relations.gen is not loaded (js/tasks/relations/*.js)');
  }

  function block(r, seed) {
    var spec = relGen()({ trackId: r.trackId, rung: RUNG, set: 'lab', variant: 'lab', seed: seed, lab: true, protocol: null });
    if (!spec || !Array.isArray(spec.trials)) throw new Error('lab.rel: the relations generator returned no trials');
    var targets = spec.trials.filter(function (t) { return t.answer === 'match'; }).length;
    if (spec.trials.length !== 20 || targets !== 10) {
      throw new Error('lab.rel: unexpected ' + r.rule + ' block (' + spec.trials.length + ' arrays, ' + targets + ' targets)');
    }
    spec.rule = r.rule;
    return spec;
  }

  function gen(o) {
    o = o || {};
    var seed = HF.lab.seedOf(ID, o);
    return {
      kind: 'discrete-set', testId: ID, form: o.form || null, seed: seed, version: 1, practice: false,
      blocks: RULES.map(function (r, b) { return block(r, seed + '/b' + b); }),
      meta: { rules: ['same', 'different'], arrays: 40, targets: 20, rung: RUNG }
    };
  }

  /** 2 target + 2 non-target arrays per rule, identical at every visit — not scored */
  function practice(o) {
    o = o || {};
    var seed = o.seed ? String(o.seed) : HF.lab.formSeed(ID, 'P');
    var blocks = RULES.map(function (r, b) {
      var full = block(r, seed + '/b' + b);
      var pos = full.trials.filter(function (t) { return t.answer === 'match'; }).slice(0, 2);
      var neg = full.trials.filter(function (t) { return t.answer !== 'match'; }).slice(0, 2);
      var pick = [pos[0], neg[0], neg[1], pos[1]].map(function (t, k) {
        var c = JSON.parse(JSON.stringify(t)); c.i = k; return c;
      });
      var copy = {};
      Object.keys(full).forEach(function (k) { copy[k] = full[k]; });
      copy.trials = pick;
      return copy;
    });
    return { kind: 'discrete-set', testId: ID, form: 'P', seed: seed, version: 1, practice: true, blocks: blocks, meta: { rules: ['same', 'different'], arrays: 8, targets: 4, rung: RUNG } };
  }

  function walk(bs, L) {
    var ans = H.byIndex(L && L.answers, 'i');
    return bs.trials.map(function (tr) {
      var a = ans[tr.i];
      var resp = a ? (a.response === undefined ? null : a.response) : null;
      var isT = tr.answer === 'match';
      var out;
      if (a && a.voided) out = 'voided';
      else if (isT) out = resp === 'match' ? 'hit' : 'miss';
      else out = resp === 'match' ? 'fa' : 'cr';
      return { i: tr.i, target: isT, response: resp, rt: a && typeof a.rt === 'number' ? a.rt : null, outcome: out, trial: tr };
    });
  }

  function score(spec, log) {
    log = log || {};
    var logs = log.blocks || [];
    var tot = { h: 0, m: 0, fa: 0, cr: 0 }, rts = [], timeouts = 0, voided = 0, n = 0, incomplete = false, paused = false;
    var per = {};
    spec.blocks.forEach(function (bs, b) {
      var L = logs[b];
      if (!L) { incomplete = true; return; }
      if (L.paused) paused = true;
      var c = { h: 0, m: 0, fa: 0, cr: 0 };
      walk(bs, L).forEach(function (w) {
        n++;
        if (w.outcome === 'voided') { voided++; return; }
        if (w.response == null) timeouts++;
        if (w.outcome === 'hit') { c.h++; if (w.rt != null) rts.push(w.rt); }
        else if (w.outcome === 'miss') c.m++;
        else if (w.outcome === 'fa') c.fa++;
        else c.cr++;
      });
      var s = HF.stats.sdt(c.h, c.m, c.fa, c.cr);
      per[bs.rule || ('block' + (b + 1))] = { hmf: H.round(s.hitRate - s.faRate), dprime: H.round(s.dprime), h: c.h, m: c.m, fa: c.fa, cr: c.cr };
      Object.keys(c).forEach(function (k) { tot[k] += c[k]; });
    });
    var s = HF.stats.sdt(tot.h, tot.m, tot.fa, tot.cr);
    var valid = tot.h + tot.m + tot.fa + tot.cr;
    var hmf = (tot.h + tot.m) && (tot.fa + tot.cr) ? s.hitRate - s.faRate : null;
    var flags = [];
    if (paused || (n && voided / n > 0.10)) flags.push('interrupted');
    if (incomplete) flags.push('incomplete');
    var sub = {
      hitRate: valid ? H.round(s.hitRate) : null, faRate: valid ? H.round(s.faRate) : null,
      dprime: valid ? H.round(s.dprime) : null, criterion: valid ? H.round(s.criterion) : null,
      hits: tot.h, misses: tot.m, fas: tot.fa, crs: tot.cr, timeouts: timeouts, voided: voided,
      rtMedian: H.median(rts), same: per.same || null, different: per.different || null
    };
    var label = hmf == null ? 'no scored arrays' : 'hits − false presses ' + hmf.toFixed(2);
    return HF.lab.makeResult(spec, hmf == null ? null : H.round(hmf), label, sub, flags);
  }

  function rows(spec, log) {
    var logs = (log && log.blocks) || [];
    var out = [];
    spec.blocks.forEach(function (bs, b) {
      walk(bs, logs[b]).forEach(function (w) {
        var m = w.trial.meta || {};
        out.push({
          block: b + 1, rule: bs.rule, trial: w.i, target_line: m.line != null ? m.line : (m.targetLine != null ? m.targetLine : null),
          correct_answer: w.trial.answer, response: w.response, rt: w.rt == null ? null : Math.round(w.rt), outcome: w.outcome,
          correct: w.outcome === 'hit' || w.outcome === 'cr', timeout: w.response == null && w.outcome !== 'voided',
          voided: w.outcome === 'voided', block_seed: bs.seed
        });
      });
    });
    return out;
  }

  var test = {
    id: ID, label: 'Relation probe', paradigm: 'relation monitoring with Lab-only content (same, then different)', part: 'A',
    minutes: 5, defaultLevel: 'near', higherIsBetter: true, version: 1,
    gen: gen, practice: practice, score: score, rows: rows
  };
  if (HF.lab && typeof HF.lab.register === 'function') test = HF.lab.register(test);
  else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
