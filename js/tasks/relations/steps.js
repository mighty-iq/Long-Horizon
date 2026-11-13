/* Long-Horizon — Equal Steps generator (trackId 'rel.steps'). Pure: no DOM, no timers. MIT licence.

   Task (Wang et al. 2025, Fig. 1C; rule implemented from the paper's description, unsigned as its worked example
   requires — research/09 §3.2): numbers appear one at a time; with back b, the STEP at item t is
   s_t = |x_t − x_(t−b)|. Item t is a target iff s_t = s_(t−1) and s_t ≥ 1 ("the step repeats").
   Example (b = 1): 3, 6, 9 → 9 is a target (steps 3 and 3); 9, 8 → no; 8, 7 → target (1 and 1).
   Example (b = 2): 3, 6, 9, 8, 7 → 7 is a target: |7 − 9| = 2 and |8 − 6| = 2.

   Ladder (SPEC §5): rung r = 0…23 → level L = floor(r / 2), pace = r odd ? fast : std.
     L0–L3: 1-back, numbers 1…9 / 19 / 29 / 39;  L4–L7: 2-back;  L8–L11: 3-back (beyond Wang).
     std = { onMs 500, soaMs 3000 }, fast = { onMs 500, soaMs 2500 }.
   Block: leadIn = b + 1 numbers, then 20 scorable numbers with exactly T targets (opts.targets, 1…20 − N, default 6)
   and exactly N near misses (|s_t − s_(t−1)| = 1; N = opts.lureCount, 0…6, default 4, Stretch 6 — amended 12 Nov,
   Phase 4); the other 20 − T − N have |s_t − s_(t−1)| ≥ 2. No accidental targets or near misses. The Wang protocol passes targets: 10 (10 targets, 4 near misses, 6 fillers) so that raw accuracy
   is symmetric (always- and never-press both score .50) and Wang's "< .50 → down" rule can fire (SPEC §5).
   Steps are never 0 (no number repeats at lag b anywhere), so "a step of 0 is never a target" holds trivially.

   Construction: a step plan first (target = copy the previous step, near = previous ± 1, filler = any step at
   least 2 away), steps drawn uniformly from 1…K with K = floor((M − 1) / 2), so every step fits from any number.
     b ≥ 2: the b interleaved chains x_j, x_(j+b), … are walks with those steps (direction random where both fit);
            same-sign and opposite-sign targets occur about equally often.
     b = 1: a small dynamic programme picks directions. Targets continue in the same direction (3, 6, 9); a
            target "returns" (6, 9, 6 — equal size, opposite sign) only where the plan cannot be realised
            otherwise: at most once per block (about 0.5 per block), or twice with more than 8 targets (about 1.4
            per block with 10, where runs of equal steps are frequent). Near misses keep the direction where
            possible, fillers mostly do (p = .95), to load the direction heuristic with lures.
   Every block is re-judged from the numbers alone by judge() (the scorer's rule) before it is returned.
   After 200 failed attempts a deterministic construction is used (spec.meta.fallback = 'deterministic').

   gen(opts) → stream BlockSpec (SPEC §4.2)
     opts = { trackId: 'rel.steps', rung, seed, set?, targets?: 1…20 − N (default 6; Wang protocol 10),
              lureCount?: N near misses 0…6 (default 4; the planner passes 6 in Stretch),
              params?: { back?, maxNumber?, onMs?, soaMs? }, protocol?: null|'wang' }
              (params may override timing, or back ∈ {1,2,3} / maxNumber ∈ {9,19,29,39})
     → { kind: 'stream', task: 'relations', trackId: 'rel.steps', seed, set, rung,
         params: { level, back, maxNumber, maxStep, pace, onMs, soaMs, targets, nearMisses }, onMs, soaMs,
         streams: ['main'], leadIn: b + 1,
         trials: [ { i, stim: { main: { number } }, scorable, target: { main: bool }, lure: { main: null|'near' } } ],
         meta: { targets: { main: T }, lures: { main: N }, lureCount: N, lurePlan: N, rule: { id: 'equal-steps', back, maxNumber, unsigned: true,
                 text }, level, label, protocol: null|'wang', returns: <targets realised as returns>,
                 solverChecked: true, fallback: null|'deterministic', attempts } }
   judge(numbers, b, t) → { scorable, now, prev, target, near, sameSign }   (the rule, shared with score.js)
   verify(numbers, params, T?, N?) → null | reason ;  targetsOf(x, N?) → the clamped target count; nearOf(x) → N.
   explain(numbers, b, t) → plain-English sentence for item t (used by score.js for why[]).
   params(rung, given?) → the params object above.

   Approximate responder (SPEC §4.6 as amended): "within ±1 of the last step" presses on exactly the T targets and
   the N near misses, so its BA is (1 + (20 − T − N)/(20 − T)) / 2 in every block by construction — .857 with 6
   targets and 4 near misses (< U .87), .786 with 6 and 6 (Stretch: < U .80, or .79 after self-correction; Phase 4),
   .800 with 10 and 4 — and its raw accuracy is .80 with 4 near misses (Wang moves up only on > .80). It is the near misses
   doing their job, not a shortcut around the comparison. Inherent 1-back cue (not in the brief's list): "same
   direction" responders score ~.72 at 1-back, because Wang's 1-back targets are continuations; measured in
   tests/unit/rel-steps.test.mjs.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var R = tasks.relations || (tasks.relations = {});

  var LEVELS = [[1, 9], [1, 19], [1, 29], [1, 39], [2, 9], [2, 19], [2, 29], [2, 39], [3, 9], [3, 19], [3, 29], [3, 39]];
  var MAX_RUNG = 23, SCORABLE = 20, TARGETS = 6, NEAR = 4, NEAR_MAX = 6, ATTEMPTS = 200;
  var PACE = { std: { onMs: 500, soaMs: 3000 }, fast: { onMs: 500, soaMs: 2500 } };
  var W_NEAR_SAME_DIR = 1, W_FILL_SAME_DIR = 0.95;
  function RETURN_BUDGET(nT) { return nT > 8 ? 2 : 1; }

  function toInt(x, dflt) { x = Number(x); return isFinite(x) ? Math.round(x) : dflt; }
  function clampInt(x, lo, hi) { x = toInt(x, lo); return x < lo ? lo : (x > hi ? hi : x); }

  /** Rung → parameters. `given` (catalog params) may override timing and, if valid, back / maxNumber. */
  function params(rung, given) {
    var r = clampInt(rung, 0, MAX_RUNG), L = Math.floor(r / 2), pace = (r % 2) ? 'fast' : 'std';
    var b = LEVELS[L][0], M = LEVELS[L][1], g = given || {};
    if ([1, 2, 3].indexOf(toInt(g.back, 0)) >= 0) b = toInt(g.back, b);
    if ([9, 19, 29, 39].indexOf(toInt(g.maxNumber, 0)) >= 0) M = toInt(g.maxNumber, M);
    var onMs = toInt(g.onMs, 0) > 0 ? toInt(g.onMs, 0) : PACE[pace].onMs;
    var soaMs = toInt(g.soaMs, 0) > onMs ? toInt(g.soaMs, 0) : PACE[pace].soaMs;
    return { level: L, back: b, maxNumber: M, maxStep: Math.floor((M - 1) / 2), pace: pace, onMs: onMs, soaMs: soaMs };
  }

  function label(p) {
    return 'Equal Steps ' + p.back + '-back · 1–' + p.maxNumber + (p.pace === 'fast' ? ' · fast' : '');
  }

  /** The rule. numbers: array of integers; item t is judged against item t − 1 (steps at lag b). */
  function judge(xs, b, t) {
    if (t < b + 1 || t >= xs.length) return { scorable: false, now: null, prev: null, target: false, near: false, sameSign: null };
    var d1 = xs[t] - xs[t - b], d0 = xs[t - 1] - xs[t - 1 - b];
    var now = Math.abs(d1), prev = Math.abs(d0);
    return {
      scorable: true, now: now, prev: prev,
      target: now === prev && now >= 1,
      near: Math.abs(now - prev) === 1,
      sameSign: d1 === 0 || d0 === 0 ? null : (d1 > 0) === (d0 > 0)
    };
  }

  /** Plain-English explanation of item t, from judge(). */
  function explain(xs, b, t) {
    var j = judge(xs, b, t);
    if (!j.scorable) return 'Not judged yet: the first ' + (b + 1) + ' numbers only set up the steps.';
    var a0 = xs[t - 1 - b], a1 = xs[t - 1], c0 = xs[t - b], c1 = xs[t];
    if (b === 1) {
      if (j.target) return 'Match: ' + xs[t - 2] + ', ' + xs[t - 1] + ', ' + xs[t] + ' — steps of ' + j.prev + ' and ' + j.now + '.';
      if (j.near) return 'Not a match: the steps were ' + j.prev + ' and ' + j.now + ' — close, but not equal.';
      return 'Not a match: the steps were ' + j.prev + ' and ' + j.now + '.';
    }
    var pair0 = a0 + ' → ' + a1 + ' (' + j.prev + ')', pair1 = c0 + ' → ' + c1 + ' (' + j.now + ')';
    if (j.target) return 'Match: ' + pair0 + ' and ' + pair1 + ' — steps of ' + j.prev + ' and ' + j.now + '.';
    if (j.near) return 'Not a match: ' + pair0 + ' and ' + pair1 + ' — steps of ' + j.prev + ' and ' + j.now + ', close, but not equal.';
    return 'Not a match: ' + pair0 + ' and ' + pair1 + ' — steps of ' + j.prev + ' and ' + j.now + '.';
  }

  // ---------- construction ----------

  /** opts.lureCount → near misses per block: an integer 0…6, default 4 (Stretch 6). */
  function nearOf(x) {
    var n = x === undefined || x === null ? NEAR : toInt(x, NEAR);
    return n < 0 ? 0 : (n > NEAR_MAX ? NEAR_MAX : n);
  }
  /** opts.targets → targets per block: an integer 1…(20 scorable − N near misses), default 6. */
  function targetsOf(x, nN) {
    var n = toInt(x, TARGETS), max = SCORABLE - nearOf(nN);
    return n < 1 ? 1 : (n > max ? max : n);
  }
  /** Types of the 20 scorable items: 'T' (target), 'N' (near miss), 'F' (filler). */
  function planTypes(rng, nT, nN) {
    var a = [], k;
    for (k = 0; k < nT; k++) a.push('T');
    for (k = 0; k < nN; k++) a.push('N');
    while (a.length < SCORABLE) a.push('F');
    return rng.shuffle(a);
  }

  /** Steps s[b..n−1] for the planned types (s[t] = 0 for t < b). */
  function planSteps(ty, b, n, K, rng) {
    var s = new Array(n), t, c, opts, v;
    for (t = 0; t < b; t++) s[t] = 0;
    s[b] = rng.int(1, K);
    for (t = b + 1; t < n; t++) {
      c = s[t - 1];
      if (ty[t] === 'T') s[t] = c;
      else if (ty[t] === 'N') {
        opts = [];
        if (c - 1 >= 1) opts.push(c - 1);
        if (c + 1 <= K) opts.push(c + 1);
        s[t] = rng.pick(opts);
      } else {
        opts = [];
        for (v = 1; v <= K; v++) if (Math.abs(v - c) >= 2) opts.push(v);
        s[t] = rng.pick(opts);
      }
    }
    return s;
  }

  /** b ≥ 2: independent chains; every step ≤ K ≤ (M − 1) / 2 fits from any number. */
  function realiseChains(s, b, n, M, rng) {
    var x = new Array(n), t, up, dn;
    for (t = 0; t < b; t++) x[t] = rng.int(1, M);
    for (t = b; t < n; t++) {
      up = x[t - b] + s[t] <= M; dn = x[t - b] - s[t] >= 1;
      if (up && dn) x[t] = rng.chance(0.5) ? x[t - b] + s[t] : x[t - b] - s[t];
      else x[t] = up ? x[t - b] + s[t] : x[t - b] - s[t];
    }
    return x;
  }

  /** b = 1: choose directions. G[t][x][sign][r] = the rest can be completed from x_t = x, step sign, r returns left.
      B = most returns allowed in the block (1; 2 when a block has more than 8 targets). */
  function realiseOneBack(s, ty, n, M, B, rng) {
    var W = M + 1, R1 = B + 1, G = new Uint8Array(n * W * 2 * R1), t, xx, sg, r, sp, c, x2, ok;
    function idx(tt, xv, sgn, rr) { return ((tt * W + xv) * 2 + sgn) * R1 + rr; }
    function cost(tt, sgn, spn) { return (ty[tt] === 'T' && spn !== sgn) ? 1 : 0; }
    for (xx = 1; xx <= M; xx++) for (sg = 0; sg < 2; sg++) for (r = 0; r <= B; r++) G[idx(n - 1, xx, sg, r)] = 1;
    for (t = n - 2; t >= 1; t--) {
      for (xx = 1; xx <= M; xx++) for (sg = 0; sg < 2; sg++) for (r = 0; r <= B; r++) {
        ok = 0;
        for (sp = 0; sp < 2 && !ok; sp++) {
          c = cost(t + 1, sg, sp); if (c > r) continue;
          x2 = xx + (sp ? s[t + 1] : -s[t + 1]);
          if (x2 >= 1 && x2 <= M && G[idx(t + 1, x2, sp, r - c)]) ok = 1;
        }
        G[idx(t, xx, sg, r)] = ok;
      }
    }
    var starts = [], rr;
    for (rr = 0; rr <= B && !starts.length; rr++) {
      for (xx = 1; xx <= M; xx++) for (sg = 0; sg < 2; sg++) {
        x2 = xx + (sg ? s[1] : -s[1]);
        if (x2 >= 1 && x2 <= M && G[idx(1, x2, sg, rr)]) starts.push([xx, sg]);
      }
    }
    if (!starts.length) return null;
    var st = rng.pick(starts), x = new Array(n);
    x[0] = st[0]; x[1] = st[0] + (st[1] ? s[1] : -s[1]); sg = st[1]; r = B;
    for (t = 2; t < n; t++) {
      var safe = [], any = [];
      for (sp = 0; sp < 2; sp++) {
        c = cost(t, sg, sp); if (c > r) continue;
        x2 = x[t - 1] + (sp ? s[t] : -s[t]);
        if (x2 < 1 || x2 > M) continue;
        if (c === 0 && G[idx(t, x2, sp, 0)]) safe.push(sp);
        if (G[idx(t, x2, sp, r - c)]) any.push(sp);
      }
      var opts = safe.length ? safe : any;
      if (!opts.length) return null;
      if (opts.length === 1) sp = opts[0];
      else if (ty[t] === 'T') sp = sg;
      else sp = rng.chance(ty[t] === 'N' ? W_NEAR_SAME_DIR : W_FILL_SAME_DIR) ? sg : 1 - sg;
      r -= cost(t, sg, sp);
      x[t] = x[t - 1] + (sp ? s[t] : -s[t]);
      sg = sp;
    }
    return x;
  }

  function attempt(p, nT, nN, rng) {
    var b = p.back, M = p.maxNumber, K = p.maxStep, n = b + 1 + SCORABLE, k;
    var types = planTypes(rng, nT, nN), ty = new Array(n);
    for (k = 0; k < n; k++) ty[k] = null;
    for (k = 0; k < SCORABLE; k++) ty[b + 1 + k] = types[k];
    var s = planSteps(ty, b, n, K, rng);
    return b === 1 ? realiseOneBack(s, ty, n, M, RETURN_BUDGET(nT), rng) : realiseChains(s, b, n, M, rng);
  }

  /** Deterministic construction that is valid for every level and target count (used only after ATTEMPTS failures):
      targets at the first nT positions of a fixed order; near misses at scorable positions 2, 8, 14, 18 (then 0, 6,
      12, 3, 9, 15 — the first nN that hold no target). */
  var FALLBACK_T_ORDER = [1, 4, 7, 10, 13, 16, 5, 11, 17, 19, 3, 9, 15, 0, 6, 12, 2, 8, 14, 18];
  var FALLBACK_N_ORDER = [2, 8, 14, 18, 0, 6, 12, 3, 9, 15];
  function fallbackBuild(p, nT, nN) {
    nN = nearOf(nN); nT = targetsOf(nT, nN);
    var b = p.back, M = p.maxNumber, K = p.maxStep, n = b + 1 + SCORABLE, t, c;
    var T_AT = FALLBACK_T_ORDER.slice(0, nT), N_AT = FALLBACK_N_ORDER.filter(function (q) { return T_AT.indexOf(q) < 0; }).slice(0, nN);
    var ty = new Array(n), s = new Array(n), x = new Array(n);
    for (t = 0; t < n; t++) ty[t] = null;
    for (t = 0; t < SCORABLE; t++) ty[b + 1 + t] = T_AT.indexOf(t) >= 0 ? 'T' : (N_AT.indexOf(t) >= 0 ? 'N' : 'F');
    for (t = 0; t < b; t++) s[t] = 0;
    s[b] = 2;
    for (t = b + 1; t < n; t++) {
      c = s[t - 1];
      if (ty[t] === 'T') s[t] = c;
      else if (ty[t] === 'N') s[t] = c + 1 <= K ? c + 1 : c - 1;
      else s[t] = c <= 2 ? K : 1;
    }
    for (t = 0; t < b; t++) x[t] = 1 + ((3 * t) % M);
    if (b === 1) {
      for (t = 1; t < n; t++) {
        var prevSign = t >= 2 ? (x[t - 1] > x[t - 2] ? 1 : -1) : 1, v;
        if (ty[t] === 'T') {
          v = x[t - 1] + prevSign * s[t];
          if (v < 1 || v > M) v = x[t - 2]; // return
        } else {
          v = x[t - 1] + s[t];
          if (v > M) v = x[t - 1] - s[t];
        }
        x[t] = v;
      }
    } else {
      for (t = b; t < n; t++) x[t] = x[t - b] + s[t] <= M ? x[t - b] + s[t] : x[t - b] - s[t];
    }
    return x;
  }

  /** Verify a number stream against the spec counts with the rule alone. Returns null if valid, else a reason. */
  function verify(xs, p, wantT, wantN) {
    var b = p.back, n = b + 1 + SCORABLE, nT = 0, nN = 0, t, j;
    wantN = nearOf(wantN); wantT = targetsOf(wantT, wantN);
    if (!xs || xs.length !== n) return 'length';
    for (t = 0; t < n; t++) if (!(xs[t] >= 1 && xs[t] <= p.maxNumber && Math.round(xs[t]) === xs[t])) return 'range';
    for (t = b; t < n; t++) if (xs[t] === xs[t - b]) return 'zero-step';
    for (t = b + 1; t < n; t++) {
      j = judge(xs, b, t);
      if (j.target) nT++; else if (j.near) nN++;
    }
    if (nT !== wantT) return 'targets ' + nT;
    if (nN !== wantN) return 'near ' + nN;
    return null;
  }

  function gen(opts) {
    opts = opts || {};
    var p = params(opts.rung, opts.params), nN = nearOf(opts.lureCount), nT = targetsOf(opts.targets, nN);
    p.targets = nT; p.nearMisses = nN;
    var seed = String(opts.seed == null ? '' : opts.seed);
    var base = HF.rng.create('rel.steps/' + seed), xs = null, tries = 0, fallback = null;
    while (!xs && tries < ATTEMPTS) {
      var cand = attempt(p, nT, nN, base.fork('a' + tries));
      tries++;
      if (cand && !verify(cand, p, nT, nN)) xs = cand;
    }
    if (!xs) {
      xs = fallbackBuild(p, nT, nN); fallback = 'deterministic';
      var why = verify(xs, p, nT, nN);
      if (why) throw new Error('rel.steps fallback invalid (' + why + ')'); // never expected; guarded by tests
    }
    var b = p.back, trials = [], returns = 0, t, j;
    for (t = 0; t < xs.length; t++) {
      j = judge(xs, b, t);
      if (j.target && j.sameSign === false && b === 1) returns++;
      trials.push({
        i: t,
        stim: { main: { number: xs[t] } },
        scorable: j.scorable,
        target: { main: j.target },
        lure: { main: j.scorable && !j.target && j.near ? 'near' : null }
      });
    }
    return {
      kind: 'stream', task: 'relations', trackId: 'rel.steps', seed: seed, set: opts.set || 'numbers', rung: clampInt(opts.rung, 0, MAX_RUNG),
      params: p, onMs: p.onMs, soaMs: p.soaMs, streams: ['main'], leadIn: b + 1, trials: trials,
      meta: {
        targets: { main: nT }, lures: { main: nN }, lureCount: nN, lurePlan: nN,
        rule: {
          id: 'equal-steps', back: b, maxNumber: p.maxNumber, unsigned: true,
          text: b === 1
            ? 'Press when the step from the last number equals the step before it. Size counts, not direction.'
            : 'Press when the jump from the number ' + b + ' back equals the jump one item earlier. Size counts, not direction.'
        },
        level: p.level, label: label(p), protocol: opts.protocol || null, returns: returns,
        solverChecked: true, fallback: fallback, attempts: tries
      }
    };
  }

  var api = {
    id: 'rel.steps', gen: gen, params: params, judge: judge, explain: explain, verify: verify, label: label,
    LEVELS: LEVELS, MAX_RUNG: MAX_RUNG, targetsOf: targetsOf, nearOf: nearOf, _fallbackBuild: fallbackBuild
  };
  R.steps = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
