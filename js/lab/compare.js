/* Long-Horizon — Lab comparisons with reliable change (pure, no DOM). MIT licence. PLAN §6, research/04 §14.

   HF.lab.visitScores(records) → [ { kind, id, startedAt, endedAt, form, config, scores: { [testId]: number }, flags } ]
     B1, B2, Q, POST and FU merge their records (two sittings); every X record is its own visit. Sorted by start.
   HF.lab.compare(records) → { [labTestId]: { b2, latest, latestKind, latestAt, change, rci, rciPractice, band,
     verdict, r, sd, n, higherIsBetter } } for every test with at least one score.
     reference = B2 (research/04 §13: the first retest gain is the largest, so B2 is the individual's baseline);
     latest = the most recent visit after B2 with that test (not B1, not B2).
     verdict: 'no-baseline' (no B2 score) → 'uncalibrated' (no usable calibration) → null (nothing after B2 yet)
              → 'above' | 'inside' | 'below' by RCI = (latest − b2) / (sd·√2·√(1 − r)) at ±1.96 (HF.stats.rci).
     Calibration = records.calibration.tests[id] = { r, sd, mean, n[, practice, practiceN] }; usable when 0 ≤ r < 1,
     sd > 0 and n ≥ 50 (PLAN: noise bands only after ≥ 50 people with both baselines). band = 1.96 · Sdiff (half-width in
     score units, for the grey band around B2). The verdict compares the change with measurement noise only: the
     average retest gain is NOT subtracted, so 'above' means "a larger change than measurement noise alone explains".
     rciPractice = (change − practice) / Sdiff subtracts the mean B2 → retest change of people who did not train, and is
     given only when the calibration has practice from practiceN ≥ 30 such people (PRACTICE_MIN_N; the same rule as
     tools/analysis/calibrate.py), else null.
     'above' / 'below' describe the score's position; higherIsBetter (from the registry) says which way is better.
   HF.lab.composites(records) → [ { kind, startedAt, near, mid, far, n: { near, mid, far } } ] — per visit, the mean z
     (z = (score − calibration.mean) / calibration.sd, sign flipped when lower is better) of the calibrated tests at each
     level from HF.lab.levels; null where no calibrated test exists.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var lab = HF.lab || (HF.lab = {});
  var Z95 = 1.96, MIN_N = 50, PRACTICE_MIN_N = 30;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function visitScores(records) {
    var raw = ((records && records.labVisits) || []).filter(function (v) { return v && v.kind && isNum(v.startedAt); })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    var merged = {}, out = [];
    raw.forEach(function (v) {
      var key = v.kind === 'X' ? 'X:' + v.id : v.kind;
      var m = merged[key];
      if (!m) {
        m = merged[key] = { kind: v.kind, id: v.id, startedAt: v.startedAt, endedAt: isNum(v.endedAt) ? v.endedAt : v.startedAt,
          form: v.form || null, config: v.config || null, scores: {}, flags: [] };
        out.push(m);
      }
      if (isNum(v.endedAt) && v.endedAt > m.endedAt) m.endedAt = v.endedAt;
      Object.keys(v.tests || {}).forEach(function (id) {
        var r = v.tests[id];
        if (r && isNum(r.score)) m.scores[id] = r.score;
      });
      (v.flags || []).forEach(function (f) { if (m.flags.indexOf(f) < 0) m.flags.push(f); });
    });
    return out;
  }

  function calOf(records, id) {
    var c = records && records.calibration && records.calibration.tests && records.calibration.tests[id];
    if (!c || !isNum(c.r) || c.r < 0 || c.r >= 1 || !(c.sd > 0) || !(isNum(c.n) && c.n >= MIN_N)) return null;
    return c;
  }

  function higher(id) { var lab = HF.lab, t = lab.tests && lab.tests[id]; return t ? t.higherIsBetter !== false : true; }

  function compare(records) {
    var vs = visitScores(records);
    var b2 = null;
    vs.forEach(function (v) { if (v.kind === 'B2') b2 = v; });
    var ids = [];
    vs.forEach(function (v) { Object.keys(v.scores).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    var out = {};
    ids.forEach(function (id) {
      var b2s = b2 && isNum(b2.scores[id]) ? b2.scores[id] : null;
      var later = vs.filter(function (v) {
        return v.kind !== 'B1' && v.kind !== 'B2' && isNum(v.scores[id]) && (!b2 || v.startedAt > b2.startedAt);
      });
      var latest = later.length ? later[later.length - 1] : null;
      var c = calOf(records, id);
      var row = {
        b2: b2s, latest: latest ? latest.scores[id] : null, latestKind: latest ? latest.kind : null,
        latestAt: latest ? latest.startedAt : null, change: null, rci: null, rciPractice: null, band: null, verdict: null,
        r: c ? c.r : null, sd: c ? c.sd : null, n: c ? c.n : null, higherIsBetter: higher(id)
      };
      out[id] = row;
      if (b2s == null) { row.verdict = 'no-baseline'; return; }
      if (latest) row.change = latest.scores[id] - b2s;
      if (!c) { row.verdict = 'uncalibrated'; return; }
      var sdiff = c.sd * Math.sqrt(2 * (1 - c.r));
      row.band = Z95 * sdiff;
      if (!latest) return;
      row.rci = HF.stats.rci(b2s, latest.scores[id], c.sd, c.r);
      if (isNum(c.practice) && isNum(c.practiceN) && c.practiceN >= PRACTICE_MIN_N) row.rciPractice = (row.change - c.practice) / sdiff;
      row.verdict = row.rci > Z95 ? 'above' : (row.rci < -Z95 ? 'below' : 'inside');
    });
    return out;
  }

  function composites(records) {
    var lab = HF.lab;
    var lv = typeof lab.levels === 'function' ? lab.levels(records) : {};
    return visitScores(records).map(function (v) {
      var acc = { near: [], mid: [], far: [] };
      Object.keys(v.scores).forEach(function (id) {
        var c = calOf(records, id), L = lv[id];
        if (!c || !L || !isNum(c.mean)) return;
        var z = (v.scores[id] - c.mean) / c.sd;
        acc[L.level].push(higher(id) ? z : -z);
      });
      function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
      return { kind: v.kind, id: v.id, startedAt: v.startedAt, near: mean(acc.near), mid: mean(acc.mid), far: mean(acc.far),
        n: { near: acc.near.length, mid: acc.mid.length, far: acc.far.length } };
    });
  }

  lab.visitScores = visitScores;
  lab.compare = compare;
  lab.composites = composites;
  lab.CALIBRATION_MIN_N = MIN_N;
  lab.PRACTICE_MIN_N = PRACTICE_MIN_N;
  if (typeof module === 'object' && module.exports) module.exports = compare;
})(typeof window !== 'undefined' ? window : globalThis);
