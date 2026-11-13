/* Long-Horizon — Relation Stream generator (trackId 'rel.stream'). Pure: no DOM, no timers. MIT licence.
   Needs js/tasks/relations/grid.js (content variants) loaded first.

   Task (Oberauer's relation-monitoring form; Oberauer et al. 2008, Himi et al. 2023; implemented from their
   descriptions): a 3×3 grid of 3-symbol strings stays on screen; every step 1–3 cells get a new string. Only the
   LAST symbol of each string counts (the middle one for icons). Press MATCH when a row or column satisfies the
   block's rule — Same (all three equal) or Different (all three distinct), fixed per block (from the seed;
   params.rule overrides). The press window lasts until the next change.

   Ladder (SPEC §5): rung r = 0…5 → { changeMs, cells }: (2000, 1) (1500, 1) (1000, 1) (1000, 2) (750, 2) (750, 3).
   Block: trial 0 = the full initial grid (no target line, not scorable), then 30 changes (scorable).
   Exactly 6 designated changes produce a target line — exactly one, through a changed cell — and the grid holds
   NO target line after any other change (so a target always disappears at the next change). Designated changes
   are never consecutive and never among the first two; their lines are 3 rows and 3 columns.
   Every changed cell gets a different relevant symbol and a fresh string.

   Shortcut resistance (measured in tests/unit/rel-stream.test.mjs):
     Same blocks: almost every non-target change also makes a PAIR through a changed cell (two equal, one
     different: a near miss), so "any change makes a pair" presses on targets and non-targets alike.
     Different blocks: almost every non-target change leaves the changed symbol unequal to the two others in one of
     its lines while those two are equal (a near miss), so "the new symbol differs from its neighbours" does not
     help either. Candidate changes are also weighted so that grid-wide statistics (the most frequent symbol's
     count, the number of distinct symbols) do not separate target states from the others.

   gen(opts) → stream BlockSpec (SPEC §4.2)
     opts = { trackId: 'rel.stream', rung: 0…5, seed, set?, variant?, params?: { rule?: 'same'|'different', changeMs? } }
     → { kind: 'stream', task: 'relations', trackId: 'rel.stream', seed, set, rung,
         params: { changeMs, cells, rule, variant }, onMs: changeMs, soaMs: changeMs (the grid never blanks),
         streams: ['main'], leadIn: 1,
         trials: [ { i, stim: { main: { grid: [9 cells], changed: [cell indices] } }, scorable, target: { main },
                     lure: { main: null|'near' }, line: lineId|null } ],
         meta: { targets: { main: 6 }, lures: { main: <near-miss changes> }, rule: { id, lines: 'rows-columns', text },
                 variant, setId, relevantPos, lines: [ { id, cells, label } ], initialMs (suggested longer first view),
                 solverChecked: true, fallback: null|'deterministic', attempts } }
     Cells use the Grid's formats: digits/letters → 3-character strings; other variants → [a, b, c].
   solve(spec, trial) → { targets: [lineId], near: [lineId] } for the grid state of that trial (the rule).
   explain(spec, i) → plain-English sentence for trial i (used by score.js).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var R = tasks.relations || (tasks.relations = {});

  var RUNGS = [[2000, 1], [1500, 1], [1000, 1], [1000, 2], [750, 2], [750, 3]];
  var CHANGES = 30, TARGETS = 6, ATTEMPTS = 200, STEP_TRIES = 60;
  var LINES = [
    { id: 'row1', cells: [0, 1, 2], kind: 'row', label: 'Row 1' }, { id: 'row2', cells: [3, 4, 5], kind: 'row', label: 'Row 2' },
    { id: 'row3', cells: [6, 7, 8], kind: 'row', label: 'Row 3' }, { id: 'col1', cells: [0, 3, 6], kind: 'col', label: 'Column 1' },
    { id: 'col2', cells: [1, 4, 7], kind: 'col', label: 'Column 2' }, { id: 'col3', cells: [2, 5, 8], kind: 'col', label: 'Column 3' }
  ];
  var LINES_OF = [[0, 3], [0, 4], [0, 5], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5]]; // cell → its row and column

  function toInt(x, d) { x = Number(x); return isFinite(x) ? Math.round(x) : d; }
  function clampInt(x, lo, hi) { x = toInt(x, lo); return x < lo ? lo : (x > hi ? hi : x); }
  function grid() { if (!R.grid || !R.grid.content) throw new Error('rel.stream: load js/tasks/relations/grid.js first'); return R.grid; }

  // ---------- the rule ----------
  /** 2 = target, 1 = near miss (all but one element fits), 0 = neither. */
  function lineStatus(rule, s, L) {
    var a = s[L[0]], b = s[L[1]], c = s[L[2]];
    if (rule === 'same') {
      if (a === b && b === c) return 2;
      return (a === b || a === c || b === c) ? 1 : 0;
    }
    if (a !== b && a !== c && b !== c) return 2;
    return (a === b && b === c) ? 0 : 1;
  }
  function judge(rule, s) {
    var targets = [], near = [];
    for (var li = 0; li < 6; li++) {
      var st = lineStatus(rule, s, LINES[li].cells);
      if (st === 2) targets.push(li); else if (st === 1) near.push(li);
    }
    return { targets: targets, near: near };
  }
  function countTargets(rule, s) {
    var n = 0, t = -1;
    for (var li = 0; li < 6; li++) if (lineStatus(rule, s, LINES[li].cells) === 2) { n++; t = li; }
    return n === 1 ? t : (n === 0 ? -1 : -2); // −1 none, −2 several
  }
  /** Near-miss change: through a changed cell, a line with all but one element fitting the rule *because of* it.
      Same: the changed symbol equals exactly one other in a line (a pair, third different).
      Different: in a line through it, the two other cells are equal and the changed symbol differs from them. */
  function nearChange(rule, s, changed) {
    for (var i = 0; i < changed.length; i++) {
      var c = changed[i];
      for (var k = 0; k < 2; k++) {
        var L = LINES[LINES_OF[c][k]].cells, o0 = -1, o1 = -1;
        for (var j = 0; j < 3; j++) if (L[j] !== c) { if (o0 < 0) o0 = s[L[j]]; else o1 = s[L[j]]; }
        if (rule === 'same') { if ((s[c] === o0) !== (s[c] === o1)) return true; }
        else if (o0 === o1 && s[c] !== o0) return true;
      }
    }
    return false;
  }
  var CNT = new Array(64);
  function maxCount(s, A) {
    var m = 0, i;
    for (i = 0; i < A; i++) CNT[i] = 0;
    for (i = 0; i < 9; i++) { CNT[s[i]]++; if (CNT[s[i]] > m) m = CNT[s[i]]; }
    return m;
  }
  function distinct(s) { var bits = 0, n = 0; for (var i = 0; i < 9; i++) { var b = 1 << s[i]; if (!(bits & b)) { bits |= b; n++; } } return n; }

  // ---------- construction ----------
  function planTargets(rng) {
    // 6 of changes 3…30, no two consecutive
    for (var guard = 0; guard < 1000; guard++) {
      var pos = rng.sample(range(28), TARGETS).map(function (x) { return x + 3; }).sort(function (a, b) { return a - b; }), ok = true;
      for (var i = 1; i < pos.length; i++) if (pos[i] - pos[i - 1] < 2) ok = false;
      if (ok) return pos;
    }
    return [4, 9, 14, 19, 24, 29];
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  function initialGrid(rule, A, rng) {
    for (var t = 0; t < 500; t++) {
      var s = [], c, sub = rule === 'same' ? null : rng.sample(range(A), Math.min(A, rng.int(3, 4)));
      for (c = 0; c < 9; c++) s.push(sub ? rng.pick(sub) : rng.int(0, A - 1));
      var j = judge(rule, s);
      if (j.targets.length === 0 && j.near.length >= 1) return s;
    }
    return null;
  }

  /** Propose a new relevant symbol for cell c: usually one seen in its row or column, else any; never the old one. */
  function proposeSym(s, c, A, rng, pNeighbour) {
    var old = s[c];
    if (rng.next() < pNeighbour) {
      var pool = [];
      for (var k = 0; k < 2; k++) {
        var L = LINES[LINES_OF[c][k]].cells;
        for (var j = 0; j < 3; j++) if (L[j] !== c && s[L[j]] !== old) pool.push(s[L[j]]);
      }
      if (pool.length) return pool[Math.floor(rng.next() * pool.length)];
    }
    var v = Math.floor(rng.next() * (A - 1));
    return v >= old ? v + 1 : v;
  }

  /** k distinct cells; if `must` is given, at least one of them comes from it (breaks a standing target line). */
  function pickCells(k, must, rng) {
    var pool = [0, 1, 2, 3, 4, 5, 6, 7, 8], cells = new Array(k), i, j, t; // fresh every call: output depends on rng only
    for (i = 0; i < k; i++) { j = i + Math.floor(rng.next() * (9 - i)); t = pool[i]; pool[i] = pool[j]; pool[j] = t; cells[i] = pool[i]; }
    if (must && must.length) {
      var hit = false;
      for (i = 0; i < k; i++) if (must.indexOf(cells[i]) >= 0) hit = true;
      if (!hit) cells[Math.floor(rng.next() * k)] = must[Math.floor(rng.next() * must.length)]; // none was in `must`: no duplicate
    }
    return cells;
  }

  function others(L, c, s) { var o = []; for (var j = 0; j < 3; j++) if (L[j] !== c) o.push(s[L[j]]); return o; }

  /** A symbol for cell c that makes a near miss through c without completing a target line; −1 if none.
      Same: equal to exactly one of the two other cells of a line. Different: unequal to a line's two (equal) others,
      while the crossing line keeps a repeat. */
  function proposeNear(ctx, s, c, rng) {
    var old = s[c], k0 = rng.next() < 0.5 ? 0 : 1, kk, x;
    for (kk = 0; kk < 2; kk++) {
      var o1 = others(LINES[LINES_OF[c][(k0 + kk) % 2]].cells, c, s), o2 = others(LINES[LINES_OF[c][(k0 + kk + 1) % 2]].cells, c, s);
      if (ctx.rule === 'same') {
        if (o1[0] !== o1[1]) {
          var v = o1[rng.next() < 0.5 ? 0 : 1];
          if (v !== old && !(o2[0] === v && o2[1] === v)) return v;
        }
      } else if (o1[0] === o1[1]) {
        var pool = [];
        if (o2[0] === o2[1]) {
          var offGrid = rng.next() < 0.25;
          for (x = 0; x < ctx.A; x++) if (x !== o1[0] && x !== old && (offGrid || s.indexOf(x) >= 0)) pool.push(x);
        } else {
          if (o2[0] !== o1[0] && o2[0] !== old) pool.push(o2[0]);
          if (o2[1] !== o1[0] && o2[1] !== old) pool.push(o2[1]);
        }
        if (pool.length) return pool[Math.floor(rng.next() * pool.length)];
      }
    }
    return -1;
  }

  /** Weight of a valid non-target candidate (relaxed = 1 for all). */
  function weightOf(ctx, s, changed, relaxed) {
    if (relaxed) return 1;
    var w = nearChange(ctx.rule, s, changed) ? 12 : 1;
    // keep grid-wide statistics in the band that target states occupy
    if (ctx.rule === 'same') { if (maxCount(s, ctx.A) >= 3) w *= 3; }
    else if (distinct(s) >= 4) w *= 3;
    return w;
  }

  function stepNon(ctx, s, mustBreak, rng, relaxed) {
    var cands = [], ws = [], total = 0, t, i;
    for (t = 0; t < (relaxed ? 3 * STEP_TRIES : STEP_TRIES) && cands.length < 6; t++) {
      var cells = pickCells(ctx.k, mustBreak, rng), ns = s.slice();
      for (i = 0; i < cells.length; i++) {
        var v = rng.next() < 0.15 ? -1 : proposeNear(ctx, ns, cells[i], rng);
        ns[cells[i]] = v >= 0 ? v : proposeSym(ns, cells[i], ctx.A, rng, 0.8);
      }
      var ok = true;
      for (i = 0; i < cells.length; i++) if (ns[cells[i]] === s[cells[i]]) ok = false;
      if (!ok || countTargets(ctx.rule, ns) !== -1) continue;
      if (ctx.rule === 'different' && !relaxed && distinct(ns) < 3) continue; // target states always have ≥ 3
      var w = weightOf(ctx, ns, cells, relaxed);
      cands.push({ s: ns, cells: cells }); ws.push(w); total += w;
    }
    if (!cands.length) return null;
    var x = rng.next() * total;
    for (i = 0; i < cands.length; i++) { x -= ws[i]; if (x < 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  function stepTarget(ctx, s, kind, rng) {
    var t, i, j;
    for (t = 0; t < STEP_TRIES * 2; t++) {
      var lineIds = [];
      for (i = 0; i < 6; i++) if (t >= STEP_TRIES || LINES[i].kind === kind) lineIds.push(i);
      var li = lineIds[Math.floor(rng.next() * lineIds.length)], L = LINES[li].cells;
      var mL = 1 + Math.floor(rng.next() * Math.min(ctx.k, 3));
      var inL = rng.sample(L, mL), outside = [];
      for (i = 0; i < 9; i++) if (L.indexOf(i) < 0) outside.push(i);
      var cells = inL.concat(rng.sample(outside, ctx.k - mL)), ns = s.slice(), unchanged = [];
      for (i = 0; i < 3; i++) if (inL.indexOf(L[i]) < 0) unchanged.push(L[i]);
      var ok = true;
      if (ctx.rule === 'same') {
        var v;
        if (unchanged.length) {
          v = s[unchanged[0]];
          for (i = 1; i < unchanged.length; i++) if (s[unchanged[i]] !== v) ok = false;
        } else v = Math.floor(rng.next() * ctx.A);
        for (i = 0; i < inL.length && ok; i++) { if (s[inL[i]] === v) ok = false; ns[inL[i]] = v; }
      } else {
        var used = unchanged.map(function (c) { return s[c]; });
        if (used.length === 2 && used[0] === used[1]) ok = false;
        for (i = 0; i < inL.length && ok; i++) {
          var opts = [];
          for (j = 0; j < ctx.A; j++) if (used.indexOf(j) < 0 && j !== s[inL[i]]) opts.push(j);
          // prefer symbols already on the grid (keeps the grid's distinct count in its usual band)
          var onGrid = opts.filter(function (x) { return s.indexOf(x) >= 0; });
          var pool = onGrid.length && rng.next() < 0.92 ? onGrid : opts;
          if (!pool.length) { ok = false; break; }
          var pick = pool[Math.floor(rng.next() * pool.length)];
          ns[inL[i]] = pick; used.push(pick);
        }
      }
      if (!ok) continue;
      for (i = mL; i < cells.length; i++) ns[cells[i]] = proposeSym(ns, cells[i], ctx.A, rng, 0.8);
      for (i = 0; i < cells.length; i++) if (ns[cells[i]] === s[cells[i]]) ok = false;
      if (!ok || countTargets(ctx.rule, ns) !== li) continue;
      return { s: ns, cells: cells, line: li };
    }
    return null;
  }

  function buildBlock(ctx, rng, relaxed) {
    var s = initialGrid(ctx.rule, ctx.A, rng);
    if (!s) return null;
    var D = planTargets(rng), kinds = rng.shuffle(['row', 'row', 'row', 'col', 'col', 'col']), states = [{ s: s, cells: [], line: -1 }], j, di = 0;
    for (j = 1; j <= CHANGES; j++) {
      var prev = states[j - 1], step;
      if (D.indexOf(j) >= 0) step = stepTarget(ctx, prev.s, kinds[di++], rng);
      else step = stepNon(ctx, prev.s, prev.line >= 0 ? LINES[prev.line].cells : null, rng, relaxed);
      if (!step) return null;
      if (step.line === undefined) step.line = -1;
      states.push(step);
    }
    return states;
  }

  function strings(ctx, states, rng) {
    // fresh irrelevant symbols for every new string; kept cells keep theirs
    var strs = [], j, c, p, rel = ctx.v.relevantPos;
    function fresh(sym) { var a = [0, 0, 0]; for (p = 0; p < 3; p++) a[p] = p === rel ? sym : Math.floor(rng.next() * ctx.A); return a; }
    var first = [];
    for (c = 0; c < 9; c++) first.push(fresh(states[0].s[c]));
    strs.push(first);
    for (j = 1; j < states.length; j++) {
      var cur = strs[j - 1].slice();
      for (var i = 0; i < states[j].cells.length; i++) { c = states[j].cells[i]; cur[c] = fresh(states[j].s[c]); }
      strs.push(cur);
    }
    return strs;
  }

  function makeCtx(opts) {
    opts = opts || {};
    var G = grid(), seed = String(opts.seed == null ? '' : opts.seed), h = HF.rng.hash('rel.stream/' + seed);
    var rung = clampInt(opts.rung, 0, RUNGS.length - 1), given = opts.params || {};
    var pv = G.content.pick(opts, 'T1', seed), v = pv.v;
    var rule = given.rule === 'same' || given.rule === 'different' ? given.rule : ((h[0] & 1) ? 'different' : 'same');
    var changeMs = toInt(given.changeMs, 0) > 0 ? toInt(given.changeMs, 0) : RUNGS[rung][0];
    return { opts: opts, seed: seed, rung: rung, v: v, glyphSet: pv.glyphSet, rule: rule, k: RUNGS[rung][1], changeMs: changeMs,
      A: G.content.size(v), map: G.content.order(v, seed) };
  }

  /** Deterministic fallback: a seed-independent search with the soft constraints dropped (uniform weights, no
      distinct-count floor, 3× the candidates per step). Throws if even that fails (never seen; tested per rule/rung). */
  function fallbackStates(ctx) {
    var fb = HF.rng.create('rel.stream.fallback/' + ctx.rule + '/' + ctx.k + '/' + ctx.A), rng, states = null;
    for (var k = 0; k < ATTEMPTS && !states; k++) { rng = fb.fork('f' + k); states = buildBlock(ctx, rng, true); }
    if (!states) throw new Error('rel.stream: no valid block');
    return { states: states, rng: rng };
  }

  function gen(opts) {
    var ctx = makeCtx(opts), base = HF.rng.create('rel.stream/' + ctx.seed), states = null, tries = 0, fallback = null, rng = null;
    while (!states && tries < ATTEMPTS) { rng = base.fork('a' + tries); states = buildBlock(ctx, rng, false); tries++; }
    if (!states) {
      fallback = 'deterministic';
      var fbk = fallbackStates(ctx);
      states = fbk.states; rng = fbk.rng;
    }
    var strs = strings(ctx, states, rng), G = grid(), trials = [], near = 0, j, c;
    for (j = 0; j < states.length; j++) {
      var cells = [];
      for (c = 0; c < 9; c++) cells.push(G.content.cell(ctx.v, ctx.map, strs[j][c]));
      var isT = states[j].line >= 0, isNear = j > 0 && !isT && nearChange(ctx.rule, states[j].s, states[j].cells);
      if (isNear) near++;
      trials.push({
        i: j,
        stim: { main: { grid: cells, changed: states[j].cells.slice().sort(function (a, b) { return a - b; }) } },
        scorable: j > 0, target: { main: isT }, lure: { main: isNear ? 'near' : null },
        line: isT ? LINES[states[j].line].id : null
      });
    }
    var setId = ctx.v.id === 'glyphs' ? ctx.glyphSet : ctx.v.setId;
    return {
      kind: 'stream', task: 'relations', trackId: 'rel.stream', seed: ctx.seed, set: ctx.opts.set || setId, rung: ctx.rung,
      params: { changeMs: ctx.changeMs, cells: ctx.k, rule: ctx.rule, variant: ctx.v.id },
      onMs: ctx.changeMs, soaMs: ctx.changeMs, streams: ['main'], leadIn: 1, trials: trials,
      meta: {
        targets: { main: TARGETS }, lures: { main: near },
        rule: { id: ctx.rule, lines: 'rows-columns',
          text: 'Press MATCH as soon as the ' + ctx.v.noun + ' in a row or column are all ' + (ctx.rule === 'same' ? 'the same.' : 'different.') },
        variant: ctx.v.id, setId: setId, relevantPos: ctx.v.relevantPos,
        lines: LINES.map(function (L) { return { id: L.id, cells: L.cells.slice(), label: L.label }; }),
        initialMs: Math.max(3000, 2 * ctx.changeMs), solverChecked: true, fallback: fallback, attempts: tries
      }
    };
  }

  // ---------- the rule on a finished spec ----------
  function relevant(spec, trial) {
    var g = trial.stim.main.grid, pos = spec.meta.relevantPos, out = [];
    for (var c = 0; c < 9; c++) out.push(g[c][pos]);
    return out;
  }
  function solve(spec, trial) {
    var s = relevant(spec, trial), j = judge(spec.meta.rule.id, s);
    return { targets: j.targets.map(function (x) { return LINES[x].id; }), near: j.near.map(function (x) { return LINES[x].id; }), values: s };
  }
  function nameable(spec) { var v = spec.meta.variant; return v === 'digits' || v === 'letters' || v === 'dots'; }
  function explain(spec, i) {
    var tr = spec.trials[i];
    if (!tr || !tr.scorable) return 'The starting grid: no row or column fits yet.';
    var sol = solve(spec, tr), rule = spec.meta.rule.id, s = sol.values;
    function show(L) { return L.label + (nameable(spec) ? ': ' + L.cells.map(function (c) { return s[c]; }).join(', ') : ''); }
    if (sol.targets.length) {
      var L = LINES[indexOf(sol.targets[0])];
      return 'Match: ' + show(L) + ' — all ' + (rule === 'same' ? 'the same.' : 'different.');
    }
    var ch = tr.stim.main.changed;
    for (var k = 0; k < ch.length; k++) {
      for (var m = 0; m < 2; m++) {
        var Ln = LINES[LINES_OF[ch[k]][m]];
        if (sol.near.indexOf(Ln.id) >= 0 && nearChange(rule, s, [ch[k]])) {
          return 'Not a match: ' + show(Ln) + ' — ' + (rule === 'same' ? 'two the same, one different.' : 'almost — one symbol repeats.');
        }
      }
    }
    return 'Not a match: no row or column is all ' + (rule === 'same' ? 'the same.' : 'different.');
  }
  function indexOf(id) { for (var i = 0; i < 6; i++) if (LINES[i].id === id) return i; return -1; }

  var api = { id: 'rel.stream', gen: gen, solve: solve, explain: explain, judge: judge, nearChange: nearChange,
    RUNGS: RUNGS, LINES: LINES, _internal: { makeCtx: makeCtx, buildBlock: buildBlock, fallbackStates: fallbackStates } };
  R.stream = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
