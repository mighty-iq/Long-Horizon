/* Long-Horizon — Relations family: dispatcher and scorer (Equal Steps, Relation Grid, Relation Stream). Pure. MIT licence.
   Needs steps.js, grid.js and stream.js loaded first (js/manifest.json order).

   HF.tasks.relations.gen(opts) → BlockSpec, by opts.trackId:
     'rel.steps' → steps.gen   'rel.grid.T1'…'rel.grid.T8' → grid.gen   'rel.stream' → stream.gen   (else throws)

   HF.tasks.relations.score(spec, log) → BlockResult (SPEC §4.5)
   Stream specs (Equal Steps, Relation Stream) — press-only signal detection on the single stream 'main':
     log = { responses: [ { key: 'match', t, trial, rt? } ], voided: [i…], paused }
     A trial counts as pressed if any 'match' response names it (the first one gives the RT: r.rt if given, else
     t − i × soaMs, i.e. from the nominal onset). Responses on lead-in trials are ignored.
     target + press = hit; target + no press = miss; non-target + press = false alarm ('lure-fa' on a near miss);
     non-target + no press = correct rejection.
   Discrete specs (Relation Grid) — two-choice answers:
     log = { answers: [ { i, response: 'match'|'no'|null, rt, voided } ], paused }
     MATCH on a target array = hit; MATCH on a non-target = false alarm ('lure-fa' if the array holds a near-miss
     line); NO or timeout (null) on a target = miss; NO or timeout on a non-target = correct rejection
     (timeouts are also counted in extra.timeouts). A missing answer counts as a timeout.
   Voided trials are excluded from every count. Rates, d′ (log-linear) and BA come from HF.stats.sdt.
   → { trackId, kind, ba, baMean, y, dprime, crit,
       streams: { main: { hits, misses, fas, crs, lureFas, lureTrials, hitRate, faRate, ba, dprime, criterion, rtMedian } },
       nScorable (scorable trials that counted), nVoided, voidedRatio (= nVoided / all scorable trials),
       plain: { caught, targets, falsePresses, nonTargets },
       why: [ { i, stream: 'main', outcome: 'hit'|'miss'|'fa'|'cr'|'lure-fa', text, line?, cells? } ]  (every counted trial,
            text from the same rule that set the answer),
       extra: { correct, errors, accuracy, errorsByStream: { main }, timeouts (grid), paused, protocol } }
     correct = hits + correct rejections and errors = misses + false alarms over the counted scorable items
     (Wang's daily accuracy sums these over the day's blocks).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var R = tasks.relations || (tasks.relations = {});

  function need(name) {
    if (!R[name]) throw new Error('relations: js/tasks/relations/' + name + '.js is not loaded');
    return R[name];
  }

  function gen(opts) {
    var id = String((opts && opts.trackId) || '');
    if (id === 'rel.steps') return need('steps').gen(opts);
    if (id === 'rel.stream') return need('stream').gen(opts);
    if (/^rel\.grid\.T[1-8]$/.test(id)) return need('grid').gen(opts);
    throw new Error('relations.gen: unknown trackId "' + id + '"');
  }

  function median(xs) { return xs.length ? HF.stats.median(xs) : null; }

  function summarise(spec, c, why, rts, nVoided, nTotal, extra) {
    var s = HF.stats.sdt(c.h, c.m, c.fa, c.cr);
    var main = {
      hits: c.h, misses: c.m, fas: c.fa, crs: c.cr, lureFas: c.lfa, lureTrials: c.lt,
      hitRate: s.hitRate, faRate: s.faRate, ba: s.ba, dprime: s.dprime, criterion: s.criterion, rtMedian: median(rts)
    };
    var counted = c.h + c.m + c.fa + c.cr;
    extra.correct = c.h + c.cr;
    extra.errors = c.m + c.fa;
    extra.accuracy = counted ? extra.correct / counted : null;
    extra.errorsByStream = { main: extra.errors };
    return {
      trackId: spec.trackId, kind: spec.kind,
      ba: s.ba, baMean: s.ba, y: s.y, dprime: s.dprime, crit: s.criterion,
      streams: { main: main },
      nScorable: counted, nVoided: nVoided, voidedRatio: nTotal ? nVoided / nTotal : 0,
      plain: { caught: c.h, targets: c.h + c.m, falsePresses: c.fa, nonTargets: c.fa + c.cr },
      why: why, extra: extra
    };
  }

  function explainStream(spec, tr) {
    if (spec.trackId === 'rel.steps') {
      var xs = spec.trials.map(function (t) { return t.stim.main.number; });
      return { text: need('steps').explain(xs, spec.params.back, tr.i) };
    }
    return { text: need('stream').explain(spec, tr.i), line: tr.line || null };
  }

  function scoreStream(spec, log) {
    log = log || {};
    var pressed = {}, rtOf = {}, voided = {}, i, r;
    var responses = log.responses || [], vlist = log.voided || [];
    for (i = 0; i < vlist.length; i++) voided[vlist[i]] = true;
    for (i = 0; i < responses.length; i++) {
      r = responses[i];
      if (!r || r.key !== 'match' || typeof r.trial !== 'number' || pressed[r.trial]) continue;
      pressed[r.trial] = true;
      rtOf[r.trial] = typeof r.rt === 'number' ? r.rt : (typeof r.t === 'number' ? r.t - r.trial * spec.soaMs : null);
    }
    var c = { h: 0, m: 0, fa: 0, cr: 0, lfa: 0, lt: 0 }, why = [], rts = [], nVoided = 0, nTotal = 0;
    for (i = 0; i < spec.trials.length; i++) {
      var tr = spec.trials[i];
      if (!tr.scorable) continue;
      nTotal++;
      if (voided[tr.i]) { nVoided++; continue; }
      var isT = !!tr.target.main, p = !!pressed[tr.i], lure = !!(tr.lure && tr.lure.main), out;
      if (lure) c.lt++;
      if (isT) {
        if (p) { c.h++; out = 'hit'; if (rtOf[tr.i] != null) rts.push(rtOf[tr.i]); } else { c.m++; out = 'miss'; }
      } else if (p) { c.fa++; out = lure ? 'lure-fa' : 'fa'; if (lure) c.lfa++; }
      else { c.cr++; out = 'cr'; }
      var ex = explainStream(spec, tr), w = { i: tr.i, stream: 'main', outcome: out, text: ex.text };
      if (ex.line) w.line = ex.line;
      why.push(w);
    }
    return summarise(spec, c, why, rts, nVoided, nTotal,
      { paused: !!log.paused, protocol: (spec.meta && spec.meta.protocol) || null });
  }

  function scoreGrid(spec, log) {
    log = log || {};
    var byI = {}, answers = log.answers || [], i;
    for (i = 0; i < answers.length; i++) if (answers[i] && typeof answers[i].i === 'number' && !byI[answers[i].i]) byI[answers[i].i] = answers[i];
    var c = { h: 0, m: 0, fa: 0, cr: 0, lfa: 0, lt: 0 }, why = [], rts = [], nVoided = 0, timeouts = 0, G = need('grid');
    for (i = 0; i < spec.trials.length; i++) {
      var tr = spec.trials[i], a = byI[tr.i];
      if (a && a.voided) { nVoided++; continue; }
      var resp = a && (a.response === 'match' || a.response === 'no') ? a.response : null;
      var isT = tr.answer === 'match', lure = !isT && tr.meta && tr.meta.near > 0, out;
      if (resp === null) timeouts++;
      if (lure) c.lt++;
      if (isT) {
        if (resp === 'match') { c.h++; out = 'hit'; if (a && typeof a.rt === 'number') rts.push(a.rt); } else { c.m++; out = 'miss'; }
      } else if (resp === 'match') { c.fa++; out = lure ? 'lure-fa' : 'fa'; if (lure) c.lfa++; }
      else { c.cr++; out = 'cr'; }
      var ex = G.explain(spec, tr), w = { i: tr.i, stream: 'main', outcome: out, text: ex.text };
      if (ex.line) w.line = ex.line;
      if (ex.cells) w.cells = ex.cells;
      why.push(w);
    }
    return summarise(spec, c, why, rts, nVoided, spec.trials.length, { timeouts: timeouts, paused: !!log.paused, protocol: null });
  }

  function score(spec, log) {
    if (!spec || !spec.trials) throw new Error('relations.score: no spec');
    if (spec.kind === 'stream') return scoreStream(spec, log);
    if (spec.kind === 'discrete') return scoreGrid(spec, log);
    throw new Error('relations.score: unknown spec kind "' + spec.kind + '"');
  }

  var api = { gen: gen, score: score };
  R.gen = gen;
  R.score = score;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
