/* Long-Horizon — Span training generator (pure, no DOM). MIT licence.
   Tracks (SPEC §2.1): span.op (operation span: letters), span.sym (symbol span: symbols), span.back (letters,
   recalled in reverse order). Complex span: a quick true/false judgement of "a ± b = c" alternates with one item to
   remember; after setSize pairs the player recalls the items on a 12-key keypad (PLAN §4.3).
   Ladder (SPEC §5): rung r = 0…7 → setSize = r + 2; 3 trials per block.

   HF.tasks.span.gen(opts) → SpanBlockSpec
     opts = { trackId, rung, params?: { setSize?, procLimitMs? }, set?: 'letters12'|'symbols12', seed, procLimitMs? }
     SpanBlockSpec (SPEC §4.4) = { kind: 'span', task: 'span', trackId, seed, set, rung, params: { setSize },
       procLimitMs (personal limit; default 4000 until measured), memMs: 1000,
       trials: [ { i, setSize, order: 'forward'|'backward', recallKeypad: [12 symbols, fixed order],
                   pairs: [ { proc: { text: '7 − 3 = 4', a, b, op: '+'|'-', shown, value, correct: bool }, mem: 'F' } ] } ],
       meta: { procTotal, procCorrect, solverChecked: true, fallback: false } }
   Rules:
   - memoranda: distinct within a trial, sampled from the 12-symbol set (letters12: F H J K L N P Q R S T Y;
     symbols12: # % & @ $ ? ! * § ¶ £ ¥ — none of them appear in the equations);
   - judgements: exactly half of the block's 3 × setSize equations are true (odd totals: ± 1, seeded), shuffled;
     a false equation shows the true result ± 1 or ± 2 (half each, so a parity check alone cannot reach 85 %),
     always inside the range a true equation of that kind can show (sums 4–18, differences 1–16), and no equation
     repeats inside a block. Operands: a + b with a, b in 2–9; a − b with b in 2–9 and a in b+1 … 18.
   HF.tasks.span.SETS, HF.tasks.span.setSizeFor(rung), HF.tasks.span.solve(proc) → bool (true iff the equation holds),
   HF.tasks.span.genPractice({ seed, n }) → [proc] (judgement-only items to measure the personal limit),
   HF.tasks.span.procLimitFrom(rts) → mean + 2.5 SD of correct-judgement RTs (Unsworth et al. 2005), clamped 1500–10000 ms
     (needs ≥ 5 RTs, else 4000).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var api = tasks.span || (tasks.span = {});

  var SETS = {
    letters12: ['F', 'H', 'J', 'K', 'L', 'N', 'P', 'Q', 'R', 'S', 'T', 'Y'],
    symbols12: ['#', '%', '&', '@', '$', '?', '!', '*', '§', '¶', '£', '¥']
  };
  var TRACKS = {
    'span.op': { set: 'letters12', order: 'forward' },
    'span.sym': { set: 'symbols12', order: 'forward' },
    'span.back': { set: 'letters12', order: 'backward' }
  };
  var TRIALS = 3, MEM_MS = 1000, DEFAULT_PROC_MS = 4000;
  var MINUS = '−';
  var RANGE = { '+': [4, 18], '-': [1, 16] };

  function setSizeFor(rung) { return Math.max(2, Math.min(9, (rung | 0) + 2)); }

  function solve(p) {
    var v = p.op === '+' ? p.a + p.b : p.a - p.b;
    return v === p.shown;
  }

  function makeEquation(rng, correct) {
    var op = rng.next() < 0.5 ? '+' : '-', a, b, value;
    if (op === '+') { a = rng.int(2, 9); b = rng.int(2, 9); value = a + b; }
    else { b = rng.int(2, 9); a = rng.int(b + 1, 18); value = a - b; }
    var shown = value;
    if (!correct) {
      var mag = rng.next() < 0.5 ? 1 : 2, sign = rng.next() < 0.5 ? -1 : 1;
      shown = value + sign * mag;
      var lo = RANGE[op][0], hi = RANGE[op][1];
      if (shown < lo || shown > hi) shown = value - sign * mag;
    }
    return {
      text: a + ' ' + (op === '+' ? '+' : MINUS) + ' ' + b + ' = ' + shown,
      a: a, b: b, op: op, shown: shown, value: value, correct: shown === value
    };
  }

  function gen(opts) {
    opts = opts || {};
    var trackId = TRACKS[opts.trackId] ? opts.trackId : 'span.op';
    var tr = TRACKS[trackId];
    var params = opts.params || {};
    var rung = opts.rung == null ? 1 : opts.rung | 0;
    var setSize = params.setSize ? Math.max(2, Math.min(9, params.setSize | 0)) : setSizeFor(rung);
    var set = SETS[opts.set] ? opts.set : tr.set;
    var symbols = SETS[set];
    var seed = String(opts.seed == null ? 'span' : opts.seed);
    var rng = HF.rng.create(seed);
    var procLimitMs = opts.procLimitMs || params.procLimitMs || DEFAULT_PROC_MS;

    var total = TRIALS * setSize;
    var nTrue = Math.floor(total / 2) + (total % 2 ? rng.int(0, 1) : 0);
    var truth = [];
    for (var j = 0; j < total; j++) truth.push(j < nTrue);
    truth = rng.shuffle(truth);

    var seen = {}, at = 0, fallback = false;
    var trials = [];
    for (var t = 0; t < TRIALS; t++) {
      var mem = rng.sample(symbols, setSize);
      var pairs = [];
      for (var k = 0; k < setSize; k++) {
        var want = truth[at++], eq = null;
        for (var attempt = 0; attempt < 200; attempt++) {
          eq = makeEquation(rng, want);
          var key = eq.a + eq.op + eq.b;
          if (!seen[key] && eq.correct === want) { seen[key] = true; break; }
          if (attempt === 199) fallback = true;
        }
        pairs.push({ proc: eq, mem: mem[k] });
      }
      trials.push({ i: t, setSize: setSize, order: tr.order, recallKeypad: symbols.slice(), pairs: pairs });
    }
    var procCorrect = 0;
    trials.forEach(function (x) { x.pairs.forEach(function (p) { if (p.proc.correct) procCorrect++; }); });
    return {
      kind: 'span', task: 'span', trackId: trackId, seed: seed, set: set, rung: rung,
      params: { setSize: setSize }, procLimitMs: procLimitMs, memMs: MEM_MS, trials: trials,
      meta: { procTotal: total, procCorrect: procCorrect, solverChecked: true, fallback: fallback }
    };
  }

  function genPractice(opts) {
    opts = opts || {};
    var rng = HF.rng.create(String(opts.seed == null ? 'span-practice' : opts.seed));
    var n = opts.n || 12, out = [];
    for (var j = 0; j < n; j++) out.push(makeEquation(rng, j % 2 === 0));
    return rng.shuffle(out);
  }

  function procLimitFrom(rts) {
    var xs = (rts || []).filter(function (x) { return typeof x === 'number' && isFinite(x) && x > 0; });
    if (xs.length < 5) return DEFAULT_PROC_MS;
    var m = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var v = xs.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (xs.length - 1);
    var lim = Math.round(m + 2.5 * Math.sqrt(v));
    return Math.max(1500, Math.min(10000, lim));
  }

  api.gen = gen;
  api.SETS = SETS;
  api.TRACKS = TRACKS;
  api.setSizeFor = setSizeFor;
  api.solve = solve;
  api.genPractice = genPractice;
  api.procLimitFrom = procLimitFrom;
  api.DEFAULT_PROC_MS = DEFAULT_PROC_MS;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
