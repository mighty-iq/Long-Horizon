/* Long-Horizon — n-back family scorer (pure, no DOM). MIT licence.
 * Owner: n-back agent. Needs HF.stats, HF.sets and js/tasks/nback/gen.js (shared rule kernel) loaded first.
 *
 * HF.tasks.nback.score(spec, log) → BlockResult                       SPEC.md §4.5
 *   spec  a BlockSpec from HF.tasks.nback.gen (see gen.js)
 *   log   { responses: [ { key: 'match' | 'match2', t: <ms from block start>, trial: <i>, rt?: <ms> } ],
 *           voided: [i, ...], paused: bool, onsets?: [<ms from block start> per trial] }
 *         Keys: single-stream versions use 'match' for stream 'main'; Dual uses 'match' for 'pos' and
 *         'match2' for 'snd'. Only the first response per key per trial counts. Other keys are ignored.
 *         RT = r.rt if given, else r.t − onsets[i] if onsets are logged, else r.t − i × soaMs (nominal).
 *
 *   BlockResult = { trackId, kind: 'stream', ba, baMean, y, dprime, crit,
 *     streams: { [stream]: { hits, misses, fas, crs, lureFas, lureTrials, hitRate, faRate, ba, dprime,
 *                            criterion, rtMedian } },
 *     nScorable, nVoided, voidedRatio, plain: { caught, targets, falsePresses, nonTargets },
 *     why: [ { i, stream, outcome: 'hit' | 'miss' | 'fa' | 'lure-fa' | 'cr', text } ],
 *     extra: { correct, errors, errorsByStream, correctByStream, scored, leadInPresses, paused } }
 *   • Only scorable trials (i ≥ n) that are not voided count, everywhere (SDT, plain, why, extra).
 *   • ba = the weakest stream's balanced accuracy (the controller's value); baMean = mean over streams;
 *     y = mean over streams of max(0, hit rate − false-alarm rate); dprime, crit = means (log-linear
 *     correction, HF.stats.sdt). rtMedian = median RT of hits (null when there are none).
 *   • nScorable = scorable trials in the block (20); nVoided = scorable trials voided; voidedRatio = their ratio.
 *   • plain sums over streams (for the plain-language debrief).
 *   • extra serves the protocols: Cao counts correct = hits + correct rejections over the scorable items
 *     (> 18 → up, errors ≥ 5 → down); Jaeggi counts errors per stream = misses + false alarms.
 *   • why[] explains every counted trial from the same rule kernel that labelled it (gen.js maskAt), e.g.
 *     "Match: Wed is the day after Tue, two back." / "Not a match: Sat is the same day as two back — the
 *     rule is the day after." The words "Match" / "Not a match" always follow the spec's target label.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var NB = tasks.nback || (tasks.nback = {});

  var KEY_OF = { main: 'match', pos: 'match', snd: 'match2' };

  function words(n) { return NB.words ? NB.words(n) : String(n); }
  function back(k) { return words(k) + ' back'; }

  function median(arr) { return arr.length ? HF.stats.median(arr) : null; }
  function mean(arr) { var v = arr.filter(function (x) { return typeof x === 'number' && isFinite(x); }); return v.length ? HF.stats.mean(v) : NaN; }

  // ───────────────────────────── explanations ─────────────────────────────
  function setFor(spec, st) {
    var sets = spec.sets || { main: spec.set };
    return HF.sets.get(st === 'pos' ? 'grid8' : (sets[st] || sets.main || spec.set));
  }
  function nm(it, fallback) { var x = HF.sets.name(it); return x === null || x === undefined ? fallback : x; }

  function explainIdentity(spec, st, i, mask, isTarget) {
    var n = spec.params.n, set = setFor(spec, st), noun = st === 'snd' ? (set && set.noun === 'letter' ? 'letter' : 'sound') : (set ? set.noun : 'item');
    var cur = spec.trials[i].stim[st], prev = spec.trials[i - n].stim[st], name = nm(cur, null);
    if (isTarget) return name ? 'Match: ' + name + ' is the same ' + noun + ' as ' + back(n) + '.' : 'Match: the same ' + noun + ' as ' + back(n) + '.';
    var lags = [];
    if (n >= 2 && (mask & 4)) lags.push(words(n - 1));
    if (n >= 2 && (mask & 8)) lags.push(words(n + 1));
    if (lags.length) return 'Not a match: ' + (name || 'this ' + noun) + ' matches ' + lags.join(' and ') + ' back, not ' + back(n) + '.';
    var pn = nm(prev, null);
    return pn ? 'Not a match: ' + back(n) + ' was ' + pn + '.' : 'Not a match: ' + back(n) + ' was a different ' + noun + '.';
  }

  function explainTransform(spec, st, i, mask, isTarget) {
    var n = spec.params.n, step = spec.params.step || 1, set = setFor(spec, st);
    var cur = spec.trials[i].stim[st], prev = spec.trials[i - n].stim[st];
    var rel = HF.sets.relPhrase(set, step), rule = HF.sets.rulePhrase(set, step);
    if (isTarget) return 'Match: ' + nm(cur, '?') + ' is ' + rel + ' ' + nm(prev, '?') + ', ' + back(n) + '.';
    if (mask & 4) return 'Not a match: ' + nm(cur, '?') + ' is the same ' + set.noun + ' as ' + back(n) + ' — the rule is ' + rule + '.';
    if (n >= 2 && (mask & 24)) {
      var k = (mask & 8) ? n - 1 : n + 1, src = spec.trials[i - k].stim[st];
      return 'Not a match: ' + nm(cur, '?') + ' is ' + rel + ' ' + nm(src, '?') + ', but that was ' + back(k) + ', not ' + back(n) + '.';
    }
    var expected = HF.sets.step(set, prev, step);
    return 'Not a match: ' + back(n) + ' was ' + nm(prev, '?') + ', so a match would be ' + nm(expected, '?') + '.';
  }

  function explainArith(spec, st, i, mask, isTarget) {
    var n = spec.params.n, cur = spec.trials[i].stim[st], prev = spec.trials[i - n].stim[st];
    var e = cur.expr + ' = ' + cur.value;
    if (isTarget) return 'Match: ' + e + ', the same value as ' + prev.expr + ' ' + back(n) + '.';
    if (cur.expr === prev.expr) return 'Not a match: the same sum as ' + back(n) + ' — a match must be written differently.';
    if (n >= 2 && (mask & 12)) {
      var k = (mask & 4) ? n - 1 : n + 1, src = spec.trials[i - k].stim[st];
      return 'Not a match: ' + e + ' equals ' + src.expr + ', but that was ' + back(k) + ', not ' + back(n) + '.';
    }
    if (mask & 16) return 'Not a match: ' + cur.expr + ' starts like ' + prev.expr + ' (' + back(n) + ') but equals ' + cur.value + ', not ' + prev.value + '.';
    return 'Not a match: ' + e + ', but ' + back(n) + ' was ' + prev.expr + ' = ' + prev.value + '.';
  }

  function explainSwitch(spec, st, i, mask, isTarget) {
    var n = spec.params.n, tr = spec.trials[i], cue = tr.cue === 'where' ? 'where' : 'what', other = cue === 'where' ? 'what' : 'where';
    var whatSet = HF.sets.get((spec.sets && spec.sets.what) || spec.set);
    var noun = { what: whatSet ? whatSet.noun : 'symbol', where: 'position' };
    var CUE = cue.toUpperCase();
    var cur = tr.stim[st], prev = spec.trials[i - n].stim[st];
    if (isTarget) return 'Match: the cue is ' + CUE + ', and ' + nm(cur[cue], 'it') + ' is the same ' + noun[cue] + ' as ' + back(n) + '.';
    if (mask & 4) return 'Not a match: the ' + noun[other] + ' matches ' + back(n) + ', but the cue is ' + CUE + ' and the ' + noun[cue] + ' differs.';
    if (n >= 2 && (mask & 24)) {
      var k = (mask & 8) ? n - 1 : n + 1;
      return 'Not a match: the ' + noun[cue] + ' matches ' + back(k) + ', not ' + back(n) + ' (the cue is ' + CUE + ').';
    }
    return 'Not a match: the cue is ' + CUE + ', and the ' + noun[cue] + ' ' + back(n) + ' was ' + nm(prev[cue], 'different') + '.';
  }

  function explain(spec, kind, st, i, row, isTarget) {
    var mask = row ? row.mask : 0;
    if (row && row.target !== isTarget) return isTarget ? 'Match.' : 'Not a match.'; // spec and stimuli disagree (never for generated blocks)
    if (kind === 'transform') return explainTransform(spec, st, i, mask, isTarget);
    if (kind === 'arith') return explainArith(spec, st, i, mask, isTarget);
    if (kind === 'switch') return explainSwitch(spec, st, i, mask, isTarget);
    return explainIdentity(spec, st, i, mask, isTarget);
  }

  // ───────────────────────────── scoring ─────────────────────────────
  function score(spec, log) {
    log = log || {};
    var streams = spec.streams || ['main'], trials = spec.trials || [], n = spec.params ? spec.params.n : spec.leadIn;
    var kind = NB.STRUCTURES ? NB.STRUCTURES[spec.trackId] : 'identity';
    if (kind === 'identity-dual' || !kind) kind = 'identity';
    var voided = {};
    (log.voided || []).forEach(function (i) { voided[i] = true; });
    var soa = spec.soaMs || 3000;

    // first response per key per trial window
    var pressed = { match: {}, match2: {} }, rts = { match: {}, match2: {} }, leadInPresses = 0;
    (log.responses || []).forEach(function (r) {
      if (!r || !pressed[r.key]) return;
      var i = r.trial;
      if (!(i >= 0 && i < trials.length) || pressed[r.key][i]) return;
      pressed[r.key][i] = true;
      var rt = typeof r.rt === 'number' ? r.rt
        : (log.onsets && typeof log.onsets[i] === 'number' ? r.t - log.onsets[i] : (typeof r.t === 'number' ? r.t - i * soa : null));
      rts[r.key][i] = typeof rt === 'number' && isFinite(rt) ? rt : null;
      if (!trials[i].scorable) leadInPresses++;
    });

    var an = null;
    try { an = NB.analyze ? NB.analyze(spec) : null; } catch (e) { an = null; }

    var res = { trackId: spec.trackId, kind: 'stream', streams: {}, why: [], plain: { caught: 0, targets: 0, falsePresses: 0, nonTargets: 0 },
      extra: { correct: 0, errors: 0, errorsByStream: {}, correctByStream: {}, scored: 0, leadInPresses: leadInPresses, paused: !!log.paused } };
    var nScorable = 0, nVoided = 0;
    trials.forEach(function (tr) { if (tr.scorable) { nScorable++; if (voided[tr.i]) nVoided++; } });
    res.nScorable = nScorable; res.nVoided = nVoided; res.voidedRatio = nScorable ? nVoided / nScorable : 0;
    res.extra.scored = nScorable - nVoided;

    var bas = [], ys = [], ds = [], cs = [];
    streams.forEach(function (st) {
      var key = KEY_OF[st] || 'match', h = 0, m = 0, fa = 0, cr = 0, lfa = 0, lt = 0, hitRts = [];
      trials.forEach(function (tr) {
        var i = tr.i;
        if (!tr.scorable || voided[i]) return;
        var isT = !!tr.target[st], isL = !isT && !!tr.lure[st], p = !!pressed[key][i], outcome;
        if (isL) lt++;
        if (isT && p) { h++; outcome = 'hit'; if (rts[key][i] !== null && rts[key][i] !== undefined) hitRts.push(rts[key][i]); }
        else if (isT) { m++; outcome = 'miss'; }
        else if (p) { fa++; if (isL) { lfa++; outcome = 'lure-fa'; } else outcome = 'fa'; }
        else { cr++; outcome = 'cr'; }
        res.why.push({ i: i, stream: st, outcome: outcome, text: explain(spec, kind, st, i, an ? an[st][i] : null, isT) });
      });
      var sd = HF.stats.sdt(h, m, fa, cr);
      res.streams[st] = { hits: h, misses: m, fas: fa, crs: cr, lureFas: lfa, lureTrials: lt, hitRate: sd.hitRate, faRate: sd.faRate,
        ba: sd.ba, dprime: sd.dprime, criterion: sd.criterion, rtMedian: median(hitRts) };
      bas.push(sd.ba); ys.push(sd.y); ds.push(sd.dprime); cs.push(sd.criterion);
      res.plain.caught += h; res.plain.targets += h + m; res.plain.falsePresses += fa; res.plain.nonTargets += fa + cr;
      res.extra.correct += h + cr; res.extra.errors += m + fa;
      res.extra.errorsByStream[st] = m + fa; res.extra.correctByStream[st] = h + cr;
    });
    var finite = bas.filter(function (b) { return typeof b === 'number' && isFinite(b); });
    res.ba = finite.length ? Math.min.apply(null, finite) : NaN;
    res.baMean = mean(bas); res.y = mean(ys); res.dprime = mean(ds); res.crit = mean(cs);
    res.why.sort(function (a, b) { return a.i - b.i || (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0); });
    return res;
  }

  NB.score = score;
  NB.explain = function (spec, stream, i) { // one trial's explanation (tutorial feedback, rule cards)
    var kind = NB.STRUCTURES[spec.trackId] === 'identity-dual' ? 'identity' : NB.STRUCTURES[spec.trackId];
    var an = NB.analyze(spec);
    return explain(spec, kind, stream, i, an[stream][i], !!spec.trials[i].target[stream]);
  };
  if (typeof module === 'object' && module.exports) module.exports = NB;
})(typeof window !== 'undefined' ? window : globalThis);
