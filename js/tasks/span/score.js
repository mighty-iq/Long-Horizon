/* Long-Horizon — Span training scorer (pure, no DOM). MIT licence.
   HF.tasks.span.score(spec, log) → BlockResult (SPEC §4.5)
     spec = SpanBlockSpec from HF.tasks.span.gen
     log  = SPEC §4.4: { trials: [ { i, proc: [ { resp: true|false|null, rt } ], recall: ['F', 'K', …], voided } ], paused }
   Scoring (PLAN §4.3, SPEC §6):
   - recall = partial credit: items recalled in their serial position / items presented, over non-voided trials
     (forward: recall[k] = mem[k]; backward: recall[k] = mem[setSize − 1 − k]). All trials of a block share one set
     size, so the unit and load versions of partial credit are the same number;
   - procAcc = correct judgements / judgements (no answer within the limit = wrong);
   - ba = baMean = y = recall (the controller moves span on recall ≥ .80 with procAcc ≥ .85, down < .60);
   - streams.proc = SDT of the judgements (target = a true equation, 'true' = yes); dprime/crit come from it;
     a missing judgement counts as an error on both kinds (miss on a true equation, fa on a false one);
   - plain = { caught: items in place, targets: items shown, falsePresses: wrong or missing judgements, nonTargets: judgements };
   - why: one entry per trial (stream 'recall', outcome 'hit' if the whole list was in place, else 'miss') and one per
     wrong judgement (stream 'proc', outcome 'fa' = said true to a false equation, 'miss' otherwise), with texts built
     from the same comparison that is scored.
   extra = { recall, procAcc, setSize, order, itemsCorrect, itemsTotal, perfectTrials, procTimeouts, procRtMedian }.
   A trial with voided: true is excluded from every count; nScorable counts trials.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var api = tasks.span || (tasks.span = {});

  function median(arr) {
    var a = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function expected(trial) {
    var mem = trial.pairs.map(function (p) { return p.mem; });
    return trial.order === 'backward' ? mem.slice().reverse() : mem;
  }

  function score(spec, log) {
    log = log || {};
    var byI = {};
    (log.trials || []).forEach(function (t) { if (t && t.i != null && !byI[t.i]) byI[t.i] = t; });
    var items = 0, ok = 0, perfect = 0, nVoided = 0, nTrials = 0;
    var h = 0, m = 0, fa = 0, cr = 0, procTo = 0, rts = [];
    var why = [];
    spec.trials.forEach(function (tr) {
      var L = byI[tr.i];
      if (L && L.voided) { nVoided++; return; }
      nTrials++;
      var want = expected(tr), got = (L && L.recall) || [];
      var inPlace = 0, shown = [];
      for (var k = 0; k < want.length; k++) {
        var g = got[k] == null ? null : String(got[k]);
        if (g === want[k]) inPlace++;
        shown.push(g == null ? '_' : g);
      }
      items += want.length; ok += inPlace;
      if (inPlace === want.length) perfect++;
      why.push({
        i: tr.i, stream: 'recall', outcome: inPlace === want.length ? 'hit' : 'miss',
        text: 'List ' + want.join(' ') + (tr.order === 'backward' ? ' (recall in reverse)' : '') + ': you entered ' +
          shown.join(' ') + ' — ' + inPlace + ' of ' + want.length + ' in the right place.'
      });
      tr.pairs.forEach(function (p, j) {
        var x = (L && L.proc && L.proc[j]) || {};
        var resp = x.resp === true || x.resp === false ? x.resp : null;
        var truthy = !!p.proc.correct;
        if (resp == null) procTo++;
        if (truthy) { if (resp === true) { h++; if (typeof x.rt === 'number') rts.push(x.rt); } else m++; }
        else { if (resp === false) { cr++; if (typeof x.rt === 'number') rts.push(x.rt); } else fa++; }
        if (resp !== truthy) {
          var right = p.proc.a + ' ' + (p.proc.op === '+' ? '+' : '−') + ' ' + p.proc.b + ' = ' + p.proc.value;
          why.push({
            i: tr.i, stream: 'proc', outcome: !truthy && resp === true ? 'fa' : 'miss',
            text: p.proc.text + ' is ' + (truthy ? 'true' : 'false (' + right + ')') +
              (resp == null ? '; no answer in time.' : '; you answered ' + (resp ? 'true' : 'false') + '.')
          });
        }
      });
    });
    var recall = items ? ok / items : 0;
    var nJ = h + m + fa + cr;
    var procAcc = nJ ? (h + cr) / nJ : 0;
    var s = HF.stats.sdt(h, m, fa, cr);
    var nAll = spec.trials.length;
    var proc = {
      hits: h, misses: m, fas: fa, crs: cr, lureFas: 0, lureTrials: 0, hitRate: s.hitRate, faRate: s.faRate,
      ba: s.ba, dprime: s.dprime, criterion: s.criterion, rtMedian: median(rts)
    };
    return {
      trackId: spec.trackId, kind: 'span', ba: recall, baMean: recall, y: recall,
      dprime: nJ ? s.dprime : NaN, crit: nJ ? s.criterion : NaN,
      streams: { proc: proc },
      nScorable: nTrials, nVoided: nVoided, voidedRatio: nAll ? nVoided / nAll : 0,
      plain: { caught: ok, targets: items, falsePresses: nJ - (h + cr), nonTargets: nJ },
      why: why,
      extra: {
        recall: recall, procAcc: procAcc, setSize: spec.params && spec.params.setSize, order: spec.trials[0] && spec.trials[0].order,
        itemsCorrect: ok, itemsTotal: items, perfectTrials: perfect, procTimeouts: procTo, procRtMedian: median(rts)
      }
    };
  }

  api.score = score;
  api.expected = expected;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
