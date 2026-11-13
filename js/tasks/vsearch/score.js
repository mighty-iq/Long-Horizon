/* Long-Horizon — visual search scorer (pure, no DOM). MIT licence.
   HF.tasks.vsearch.score(spec, log) → BlockResult (SPEC §4.5)
     log = SPEC §4.3: { answers: [ { i, response: 'match'|'no'|null, rt, voided } ], paused }
   SDT on one stream 'main' with target = T present:
     present: 'match' → hit, 'no' or no answer → miss;
     absent:  'no' → correct rejection, 'match' → false alarm, no answer → counted with the false alarms
              (an absent display also needs a decision before the window ends; extra.timeouts gives the split).
   ba = baMean = (hit rate + correct-rejection rate) / 2; y = max(0, hit rate − fa rate); dprime/crit log-linear.
   plain.falsePresses counts real "present" answers on absent displays only.
   why: one entry per display, from the same comparison (outcome 'hit'|'miss'|'fa'|'cr'); the T's place is named as
   row and column of the display's own grid (spec.field.grid: 8, or 10 for 56 and 64 items).
   extra = { timeouts: { present, absent }, rtPresent, rtAbsent (median correct RTs), size, windowMs }.
   Voided displays are excluded from every count.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var api = tasks.vsearch || (tasks.vsearch = {});

  function median(arr) {
    var a = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function where(stim, grid) {
    grid = grid || 8;
    for (var k = 0; k < stim.items.length; k++) {
      var it = stim.items[k];
      if (it.kind === 'T') return 'row ' + (Math.floor(it.cell / grid) + 1) + ', column ' + (it.cell % grid + 1);
    }
    return '';
  }

  function score(spec, log) {
    log = log || {};
    var byI = {};
    (log.answers || []).forEach(function (a) { if (a && a.i != null && !byI[a.i]) byI[a.i] = a; });
    var h = 0, m = 0, fa = 0, cr = 0, toP = 0, toA = 0, realFa = 0, nVoided = 0, nScorable = 0;
    var rtP = [], rtA = [], why = [];
    spec.trials.forEach(function (tr) {
      var a = byI[tr.i];
      if (a && a.voided) { nVoided++; return; }
      nScorable++;
      var resp = a && (a.response === 'match' || a.response === 'no') ? a.response : null;
      var rt = a && typeof a.rt === 'number' ? a.rt : null;
      var present = tr.answer === 'match', out;
      if (present) {
        if (resp === 'match') { h++; out = 'hit'; if (rt != null) rtP.push(rt); }
        else { m++; out = 'miss'; if (resp == null) toP++; }
      } else if (resp === 'no') { cr++; out = 'cr'; if (rt != null) rtA.push(rt); }
      else { fa++; out = 'fa'; if (resp == null) toA++; else realFa++; }
      var text = present
        ? 'A T was there (' + where(tr.stim, spec.field && spec.field.grid) + ')' + (out === 'hit' ? '; you found it.' : resp == null ? '; no answer in time.' : '; you answered absent.')
        : 'No T in this display' + (out === 'cr' ? '; you answered absent.' : resp == null ? '; no answer in time.' : '; you answered present.');
      why.push({ i: tr.i, stream: 'main', outcome: out, text: text });
    });
    var s = HF.stats.sdt(h, m, fa, cr);
    var main = {
      hits: h, misses: m, fas: fa, crs: cr, lureFas: 0, lureTrials: 0, hitRate: s.hitRate, faRate: s.faRate,
      ba: s.ba, dprime: s.dprime, criterion: s.criterion, rtMedian: median(rtP)
    };
    var nAll = spec.trials.length;
    return {
      trackId: spec.trackId || 'vs.search', kind: 'discrete',
      ba: nScorable ? s.ba : 0, baMean: nScorable ? s.ba : 0, y: nScorable ? s.y : 0,
      dprime: s.dprime, crit: s.criterion, streams: { main: main },
      nScorable: nScorable, nVoided: nVoided, voidedRatio: nAll ? nVoided / nAll : 0,
      plain: { caught: h, targets: h + m, falsePresses: realFa, nonTargets: fa + cr },
      why: why,
      extra: { timeouts: { present: toP, absent: toA }, rtPresent: median(rtP), rtAbsent: median(rtA),
        size: spec.params && spec.params.size, windowMs: spec.windowMs }
    };
  }

  api.score = score;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
