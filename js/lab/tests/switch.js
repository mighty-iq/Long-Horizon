/* Long-Horizon Lab — lab.switch: cued digit task switching (EXPLORATORY). Pure module (no DOM, deterministic). MIT licence.

   Paradigm: the digit switch task Cao et al. (2026) used as their switching outcome (after Tayeb & Lavidor 2016),
   rebuilt from the published description: digits 1–9 without 5; one cue asks "lower or higher than 5?", the other
   "odd or even?". Left key F = LOW / ODD, right key J = HIGH / EVEN (Cao: left below 5 / odd, right above 5 / even).
   Two single-task (pure) blocks, then a mixed block with 50 % switches. Cao timing: fixation 100 ms, digit until the
   response (max 3,000 ms), blank 50 ms. Switch costs are known to be unreliable (Hedge et al. 2018): this test is
   exploratory and is not part of any composite. Full notes: docs/dev/lab-items.md.

   Cue = colour AND word AND frame shape, never colour alone: magnitude = "LOW · HIGH" in a square frame (colour token
   'cueA', Okabe–Ito blue), parity = "ODD · EVEN" in a diamond frame (colour token 'cueB', Okabe–Ito orange).

   API (registered with HF.lab.register, or queued in HF.labPending; exported for node):
     gen({ form, seed? }) → TestSpec        score(spec, log) → TestResult        rows(spec, log) → [ExportRow]
     practice() → TestSpec (form 'P', 16 unscored trials in 3 blocks)
     check(spec) → { ok, problems }         re-derives every correct key and trial type from digit + cue alone
     CUES, correctKey(digit, task)

   TestSpec (SPEC §4.3 discrete, directly runnable by a discrete runner; answers use the logical keys):
     { kind: 'discrete', task: 'lab', testId: 'lab.switch', trackId: 'lab.switch', form, seed, release, blueprint: 'switch-1',
       set: 'labDigits', rung: null, windowMs: 3000, itiMs: 150,
       params: { fixationMs: 100, blankMs: 50, keys: { left: 'no' (F), right: 'match' (J) }, nPure: 16, nMixed: 49 },
       cues: CUES, blocks: [ { id: 'pureM'|'pureP'|'mixed', kind: 'pure'|'mixed', task: 'magnitude'|'parity'|null,
                               from, to (trial indices, inclusive), practice: [Trial], instructions } ],
       trials: [Trial] (81, flat, in running order), meta: { checked: true, switches, repeats, fallback } }
     Trial = { i, block, stim: { digit: 1–9 (≠ 5), task: 'magnitude'|'parity' }, answer: 'no' | 'match',
               meta: { trialType: 'pure'|'first'|'repeat'|'switch', congruent: bool, side: 'left'|'right' } }
     Practice trials have the same shape (with practice: true); the view may give feedback on them, never on scored trials.
   Log (SPEC §4.3): { answers: [ { i, response: 'no'|'match'|'left'|'right'|null, rt: ms|null, voided: bool, timedOut?: bool } ], paused }
   TestResult: { score: switch cost in ms (median RT correct switch − correct repeat, mixed block) — LOWER is better; null
                 when either condition has < 5 usable trials, scoreLabel, higherIsBetter: false, unit: 'ms', exploratory: true,
                 sub: { switchCostRt, mixingCostRt, switchCostEr, mixingCostEr, medianRt: { pure, repeat, switch },
                        errorRate: { pure, repeat, switch }, pureMedianRt (THE speed check), accuracy, n, timeouts,
                        anticipations, voided, missing, usable: { pure, repeat, switch } }, flags }
   RT rules: correct trials only; excluded: the first trial of each block, trials right after an error or timeout,
   RT < 200 ms (anticipations), voided trials. Error rates: all answered or timed-out trials except each block's first.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var TEST_ID = 'lab.switch';
  var BLUEPRINT = 'switch-1';
  var VERSION = 1;
  /** The fixed release seed of a form: HF.lab.formSeed when the registry is loaded, else the same string. */
  function defaultSeed(form) {
    return (HF.lab && typeof HF.lab.formSeed === 'function') ? HF.lab.formSeed(TEST_ID, form) : 'holdfast/lab/v1/' + TEST_ID + '/' + form;
  }
  var FORMS = ['A', 'B', 'C', 'D'];
  /** Adds the registry's shared TestResult fields (HF.lab.makeResult shape): testId, form, seed, version. */
  function stamp(spec, r) {
    r.testId = TEST_ID; r.form = spec.form || null; r.seed = spec.seed || null; r.version = spec.version || VERSION;
    return r;
  }
  var DIGITS = [1, 2, 3, 4, 6, 7, 8, 9];
  var N_PURE = 16, N_MIXED = 49;                    // 16 + 16 + 49 = 81 scored trials
  var WINDOW_MS = 3000, ITI_MS = 150, FIX_MS = 100, BLANK_MS = 50, ANTICIPATION_MS = 200, MIN_USABLE = 5;
  var PURE_FIRST = { A: 'magnitude', B: 'parity', C: 'magnitude', D: 'parity' };
  var MAX_ATTEMPTS = 500;

  var CUES = {
    magnitude: { id: 'magnitude', word: 'LOW · HIGH', question: 'Lower or higher than 5?', frame: 'square', colorToken: 'cueA',
                 color: '#0072B2', left: 'LOW', right: 'HIGH' },
    parity:    { id: 'parity', word: 'ODD · EVEN', question: 'Odd or even?', frame: 'diamond', colorToken: 'cueB',
                 color: '#E69F00', left: 'ODD', right: 'EVEN' }
  };
  var INSTRUCTIONS = {
    magnitude: 'Blue square, LOW · HIGH: is the digit lower or higher than 5? F (left) = lower, J (right) = higher.',
    parity: 'Orange diamond, ODD · EVEN: is the digit odd or even? F (left) = odd, J (right) = even.',
    mixed: 'Now both tasks are mixed. Read the cue on every trial: LOW · HIGH (square) or ODD · EVEN (diamond). Same keys. Be fast and accurate.'
  };

  /** 'no' = F = left = LOW / ODD; 'match' = J = right = HIGH / EVEN */
  function correctKey(digit, task) {
    if (task === 'magnitude') return digit < 5 ? 'no' : 'match';
    return digit % 2 === 1 ? 'no' : 'match';
  }
  function congruent(digit) { return correctKey(digit, 'magnitude') === correctKey(digit, 'parity'); }
  function other(task) { return task === 'magnitude' ? 'parity' : 'magnitude'; }
  function maxRun(arr) { var best = 0, run = 0; for (var i = 0; i < arr.length; i++) { run = i && arr[i] === arr[i - 1] ? run + 1 : 1; if (run > best) best = run; } return best; }
  function noAdjacentRepeat(ds) { for (var i = 1; i < ds.length; i++) if (ds[i] === ds[i - 1]) return false; return true; }

  // ---------------------------------------------------------------- sequences
  /** Pure block: each digit twice, no digit twice in a row, at most 4 equal answers in a row. */
  function pureDigits(rng, task, n) {
    var base = [];
    while (base.length < n) base = base.concat(DIGITS);
    base = base.slice(0, n);
    for (var t = 0; t < MAX_ATTEMPTS; t++) {
      var ds = rng.shuffle(base);
      if (noAdjacentRepeat(ds) && maxRun(ds.map(function (d) { return correctKey(d, task); })) <= 4) return ds;
    }
    return null;
  }
  /** Mixed block: trial 0 + 48 transitions (24 switch, 24 repeat; runs ≤ 4); digits balanced over
      transition × congruency (each of the 8 digits 3 times per transition type), no digit twice in a row. */
  function mixedSequence(rng, n) {
    var k = n - 1, half = k / 2;
    for (var t = 0; t < MAX_ATTEMPTS; t++) {
      var trans = rng.shuffle(fill('switch', half).concat(fill('repeat', half)));
      if (maxRun(trans) > 4) continue;
      var tasks = [rng.pick(['magnitude', 'parity'])];
      for (var i = 0; i < k; i++) tasks.push(trans[i] === 'switch' ? other(tasks[i]) : tasks[i]);
      // digits per transition type: each digit 3 times (24 = 8 × 3)
      var pools = { 'switch': rng.shuffle(rep(DIGITS, half / DIGITS.length)), repeat: rng.shuffle(rep(DIGITS, half / DIGITS.length)) };
      var ds = [rng.pick(DIGITS)], ok = true;
      for (var j = 0; j < k && ok; j++) {
        var pool = pools[trans[j]], idx = -1;
        for (var q = 0; q < pool.length; q++) if (pool[q] !== ds[ds.length - 1]) { idx = q; break; }
        if (idx < 0) { ok = false; break; }
        ds.push(pool.splice(idx, 1)[0]);
      }
      if (!ok) continue;
      if (maxRun(ds.map(function (d, x) { return correctKey(d, tasks[x]); })) > 5) continue;
      return { tasks: tasks, digits: ds, trans: [null].concat(trans) };
    }
    return null;
  }
  function fill(v, n) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
  function rep(arr, times) { var a = []; for (var i = 0; i < times; i++) a = a.concat(arr); return a; }

  function trial(i, block, digit, task, trialType) {
    var ans = correctKey(digit, task);
    return { i: i, block: block, stim: { digit: digit, task: task }, answer: ans,
             meta: { trialType: trialType, congruent: congruent(digit), side: ans === 'no' ? 'left' : 'right' } };
  }
  // A fixed, valid fallback (never expected): alternating digits and an ABAB.. / AABB.. task pattern.
  function fallbackMixed(n) {
    var tasks = [], ds = [], trans = [null];
    var pattern = ['magnitude', 'magnitude', 'parity', 'parity'];
    for (var i = 0; i < n; i++) { tasks.push(pattern[i % 4]); ds.push(DIGITS[(i * 3) % 8]); if (i) trans.push(tasks[i] === tasks[i - 1] ? 'repeat' : 'switch'); }
    return { tasks: tasks, digits: ds, trans: trans };
  }

  function gen(opts) {
    opts = opts || {};
    var form = opts.form || 'A';
    if (form === 'P') return practice(opts);
    if (FORMS.indexOf(form) < 0) throw new Error('lab.switch.gen: form must be A, B, C or D');
    var seed = opts.seed != null && opts.seed !== '' ? String(opts.seed) : defaultSeed(form);
    var release = seed === defaultSeed(form);
    var rng = HF.rng.create(seed);
    var first = PURE_FIRST[form], second = other(first), fallback = false;
    var trials = [], blocks = [];
    [first, second].forEach(function (task) {
      var ds = pureDigits(rng.fork('pure-' + task), task, N_PURE);
      if (!ds) { ds = DIGITS.concat(DIGITS); fallback = true; }
      var id = task === 'magnitude' ? 'pureM' : 'pureP', from = trials.length;
      ds.forEach(function (d, j) { trials.push(trial(trials.length, id, d, task, j === 0 ? 'first' : 'pure')); });
      blocks.push({ id: id, kind: 'pure', task: task, from: from, to: trials.length - 1, instructions: INSTRUCTIONS[task],
                    practice: practiceBlock(id) });
    });
    var mx = mixedSequence(rng.fork('mixed'), N_MIXED);
    if (!mx) { mx = fallbackMixed(N_MIXED); fallback = true; }
    var mFrom = trials.length;
    mx.digits.forEach(function (d, j) { trials.push(trial(trials.length, 'mixed', d, mx.tasks[j], j === 0 ? 'first' : mx.trans[j])); });
    blocks.push({ id: 'mixed', kind: 'mixed', task: null, from: mFrom, to: trials.length - 1, instructions: INSTRUCTIONS.mixed,
                  practice: practiceBlock('mixed') });
    var sw = mx.trans.filter(function (x) { return x === 'switch'; }).length;
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: form, seed: seed, release: release, version: VERSION,
      blueprint: BLUEPRINT, set: 'labDigits', rung: null, windowMs: WINDOW_MS, itiMs: ITI_MS,
      params: { fixationMs: FIX_MS, blankMs: BLANK_MS, keys: { left: 'no', right: 'match' }, nPure: N_PURE, nMixed: N_MIXED,
                pureOrder: [first, second], anticipationMs: ANTICIPATION_MS },
      cues: CUES, blocks: blocks, trials: trials,
      meta: { checked: true, switches: sw, repeats: N_MIXED - 1 - sw, fallback: fallback }
    };
  }

  // Practice (identical at every visit, unscored): 4 trials per pure task, 8 mixed (4 switches).
  var practiceCache = null;
  function practiceBlock(id) {
    if (!practiceCache) {
      var pm = [2, 7, 4, 9], pp = [3, 8, 1, 6];
      var mixT = ['parity', 'parity', 'magnitude', 'magnitude', 'parity', 'magnitude', 'magnitude', 'parity'];   // 4 switches, 3 repeats
      var mixD = [7, 2, 8, 3, 1, 6, 4, 9];
      practiceCache = {
        pureM: pm.map(function (d, j) { return trial(j, 'practice-pureM', d, 'magnitude', j ? 'pure' : 'first'); }),
        pureP: pp.map(function (d, j) { return trial(j, 'practice-pureP', d, 'parity', j ? 'pure' : 'first'); }),
        mixed: mixD.map(function (d, j) { return trial(j, 'practice-mixed', d, mixT[j], j === 0 ? 'first' : (mixT[j] === mixT[j - 1] ? 'repeat' : 'switch')); })
      };
      Object.keys(practiceCache).forEach(function (k) { practiceCache[k].forEach(function (t) { t.practice = true; }); });
    }
    return JSON.parse(JSON.stringify(practiceCache[id]));
  }

  /** practice({ seed? }) → TestSpec: all 16 practice trials (4 magnitude, 4 parity, 8 mixed) in three blocks, for a
      runner that runs practice up front. A runner that interleaves uses spec.blocks[k].practice from gen() instead. */
  function practice() {
    var trials = [], blocks = [];
    [['pureM', 'pure', 'magnitude'], ['pureP', 'pure', 'parity'], ['mixed', 'mixed', null]].forEach(function (b) {
      var from = trials.length;
      practiceBlock(b[0]).forEach(function (t) { t.i = trials.length; trials.push(t); });
      blocks.push({ id: 'practice-' + b[0], kind: b[1], task: b[2], from: from, to: trials.length - 1,
                    instructions: INSTRUCTIONS[b[2] || 'mixed'], practice: [] });
    });
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: 'P', seed: 'fixed', release: true, version: VERSION,
      blueprint: BLUEPRINT, set: 'labDigits', rung: null, practice: true, windowMs: WINDOW_MS, itiMs: ITI_MS,
      params: { fixationMs: FIX_MS, blankMs: BLANK_MS, keys: { left: 'no', right: 'match' }, nPure: 4, nMixed: 8,
                pureOrder: ['magnitude', 'parity'], anticipationMs: ANTICIPATION_MS },
      cues: CUES, blocks: blocks, trials: trials, meta: { checked: true, switches: 4, repeats: 3, fallback: false }
    };
  }

  /** Independent check of a spec: keys, trial types, balance and constraints re-derived from digit + cue. */
  function check(spec) {
    var problems = [];
    var keyOf = function (d, task) { return task === 'magnitude' ? (d > 5 ? 'match' : 'no') : (d % 2 === 0 ? 'match' : 'no'); };
    spec.trials.forEach(function (t, idx) {
      if (t.i !== idx) problems.push('index ' + idx);
      if (t.stim.digit === 5 || DIGITS.indexOf(t.stim.digit) < 0) problems.push('digit ' + idx);
      if (t.answer !== keyOf(t.stim.digit, t.stim.task)) problems.push('key ' + idx);
      var cong = keyOf(t.stim.digit, 'magnitude') === keyOf(t.stim.digit, 'parity');
      if (t.meta.congruent !== cong) problems.push('congruency ' + idx);
    });
    spec.blocks.forEach(function (b) {
      var ts = spec.trials.slice(b.from, b.to + 1);
      if (ts[0].meta.trialType !== 'first') problems.push('first ' + b.id);
      for (var j = 1; j < ts.length; j++) {
        if (ts[j].stim.digit === ts[j - 1].stim.digit) problems.push('digit repeat ' + b.id + ' ' + j);
        var want = b.kind === 'pure' ? 'pure' : (ts[j].stim.task === ts[j - 1].stim.task ? 'repeat' : 'switch');
        if (ts[j].meta.trialType !== want) problems.push('type ' + b.id + ' ' + j);
        if (b.kind === 'pure' && ts[j].stim.task !== b.task) problems.push('task ' + b.id + ' ' + j);
      }
      if (b.kind === 'pure') {
        if (ts.length !== N_PURE) problems.push('pure length');
        DIGITS.forEach(function (d) { if (ts.filter(function (t) { return t.stim.digit === d; }).length !== N_PURE / 8) problems.push('pure balance ' + d); });
      } else {
        if (ts.length !== N_MIXED) problems.push('mixed length');
        var rest = ts.slice(1);
        ['switch', 'repeat'].forEach(function (tt) {
          var sub = rest.filter(function (t) { return t.meta.trialType === tt; });
          if (sub.length !== (N_MIXED - 1) / 2) problems.push(tt + ' count ' + sub.length);
          DIGITS.forEach(function (d) { if (sub.filter(function (t) { return t.stim.digit === d; }).length !== (N_MIXED - 1) / 16) problems.push(tt + ' digit ' + d); });
          if (sub.filter(function (t) { return t.meta.congruent; }).length !== sub.length / 2) problems.push(tt + ' congruency');
        });
      }
    });
    return { ok: problems.length === 0, problems: problems };
  }

  // ---------------------------------------------------------------- scoring
  function normResp(r) {
    if (r === 'left' || r === 'no' || r === 'KeyF' || r === 'F' || r === 'f') return 'no';
    if (r === 'right' || r === 'match' || r === 'KeyJ' || r === 'J' || r === 'j') return 'match';
    return null;
  }
  function indexAnswers(log) {
    var by = {};
    ((log && log.answers) || []).forEach(function (a) { if (a && a.i != null && !by[a.i]) by[a.i] = a; });
    return by;
  }
  function classify(spec, log) {
    var by = indexAnswers(log), prevBad = false, prevBlock = null;
    return spec.trials.map(function (t) {
      if (t.block !== prevBlock) { prevBad = false; prevBlock = t.block; }
      var a = by[t.i], c = { t: t, a: a || null, state: 'missing', rtUse: false, erUse: false, correct: null, reason: '' };
      if (!a) { c.reason = 'missing'; prevBad = true; return c; }
      if (a.voided) { c.state = 'voided'; c.reason = 'voided'; prevBad = true; return c; }
      var resp = normResp(a.response);
      var timedOut = !!a.timedOut || resp === null;
      c.state = timedOut ? 'timeout' : 'answered';
      c.correct = !timedOut && resp === t.answer;
      var first = t.meta.trialType === 'first';
      c.erUse = !first;
      var antic = !timedOut && typeof a.rt === 'number' && a.rt < ANTICIPATION_MS;
      c.anticipation = antic;
      if (first) c.reason = 'block-first';
      else if (!c.correct) c.reason = timedOut ? 'timeout' : 'error';
      else if (prevBad) c.reason = 'after-error';
      else if (antic) c.reason = 'anticipation';
      else if (typeof a.rt !== 'number') c.reason = 'no-rt';
      else { c.rtUse = true; c.reason = ''; }
      prevBad = !c.correct;
      return c;
    });
  }
  function cond(c) { return c.t.meta.trialType === 'switch' ? 'switch' : (c.t.meta.trialType === 'repeat' ? 'repeat' : (c.t.meta.trialType === 'pure' ? 'pure' : null)); }
  function score(spec, log) {
    var st = HF.stats, cls = classify(spec, log);
    var rts = { pure: [], repeat: [], 'switch': [] }, er = { pure: [0, 0], repeat: [0, 0], 'switch': [0, 0] };
    var answered = 0, correct = 0, timeouts = 0, antic = 0, voided = 0, missing = 0;
    cls.forEach(function (c) {
      if (c.state === 'missing') { missing++; return; }
      if (c.state === 'voided') { voided++; return; }
      if (c.state === 'timeout') timeouts++;
      answered++;
      if (c.correct) correct++;
      if (c.anticipation) antic++;
      var k = cond(c);
      if (!k) return;
      if (c.erUse) { er[k][1]++; if (!c.correct) er[k][0]++; }
      if (c.rtUse) rts[k].push(c.a.rt);
    });
    var med = function (a) { return a.length >= MIN_USABLE ? st.median(a) : null; };
    var rate = function (p) { return p[1] ? p[0] / p[1] : null; };
    var mRt = { pure: med(rts.pure), repeat: med(rts.repeat), 'switch': med(rts['switch']) };
    var eR = { pure: rate(er.pure), repeat: rate(er.repeat), 'switch': rate(er['switch']) };
    var diff = function (a, b) { return a === null || b === null ? null : Math.round((a - b) * 10) / 10; };
    var diffR = function (a, b) { return a === null || b === null ? null : Math.round((a - b) * 10000) / 10000; };
    var swRt = diff(mRt['switch'], mRt.repeat), mixRt = diff(mRt.repeat, mRt.pure);
    var total = spec.trials.length, flags = ['exploratory'];
    var acc = answered ? correct / answered : null;
    if (missing > 0) flags.push('incomplete');
    if (total && voided / total > 0.10) flags.push('many-voided');
    if (acc !== null && acc < 0.70) flags.push('low-accuracy');
    if (answered && timeouts / answered > 0.10) flags.push('many-timeouts');
    if (answered && antic / answered > 0.05) flags.push('anticipations');
    if (swRt === null) flags.push('insufficient-data');
    return stamp(spec, {
      testId: TEST_ID, score: swRt,
      scoreLabel: swRt === null ? 'Switch cost: not enough usable trials (exploratory)' : 'Switch cost ' + Math.round(swRt) + ' ms (exploratory; lower = faster switching)',
      higherIsBetter: false, unit: 'ms', exploratory: true,
      sub: { switchCostRt: swRt, mixingCostRt: mixRt, switchCostEr: diffR(eR['switch'], eR.repeat), mixingCostEr: diffR(eR.repeat, eR.pure),
             medianRt: mRt, errorRate: eR, pureMedianRt: mRt.pure, speedCheck: { pureMedianRt: mRt.pure, pureErrorRate: eR.pure },
             accuracy: acc, n: answered, timeouts: timeouts, anticipations: antic, voided: voided, missing: missing,
             usable: { pure: rts.pure.length, repeat: rts.repeat.length, 'switch': rts['switch'].length },
             form: spec.form, blueprint: spec.blueprint, release: !!spec.release, paused: !!(log && log.paused) },
      flags: flags
    });
  }
  function rows(spec, log) {
    return classify(spec, log).map(function (c) {
      var t = c.t, a = c.a;
      return {
        test: TEST_ID, form: spec.form, blueprint: spec.blueprint, seed: spec.seed, i: t.i, block: t.block,
        task: t.stim.task, digit: t.stim.digit, trialType: t.meta.trialType, congruent: t.meta.congruent,
        answer: t.answer, response: a && c.state === 'answered' ? normResp(a.response) : null, correct: c.correct,
        rt: a ? (a.rt == null ? null : a.rt) : null, timedOut: c.state === 'timeout', voided: c.state === 'voided',
        rtUsed: c.rtUse, excluded: c.reason
      };
    });
  }

  var test = {
    id: TEST_ID, label: 'Task switching', paradigm: 'cued digit task switching (Cao et al. 2026; Tayeb & Lavidor 2016)',
    minutes: 5, defaultLevel: 'mid', higherIsBetter: false, unit: 'ms', exploratory: true,
    blueprint: BLUEPRINT, formSeed: defaultSeed, part: 'B', version: VERSION, instructions: INSTRUCTIONS,
    gen: gen, score: score, rows: rows, practice: practice, check: check, CUES: CUES, correctKey: correctKey, DIGITS: DIGITS
  };
  if (HF.lab && HF.lab.register) HF.lab.register(test); else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
