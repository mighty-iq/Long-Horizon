/* Long-Horizon — n-back family generator (pure, no DOM). MIT licence.
 * Owner: n-back agent. Needs HF.rng and HF.sets loaded first; js/tasks/nback/score.js loads after it.
 *
 * ── API (HF.tasks.nback) ───────────────────────────────────────────────────────────────────────
 *   gen(opts) → BlockSpec                                        SPEC.md §4.1, §4.2, §5
 *     opts = { trackId: 'nback.plain' | 'nback.dual' | 'nback.transform' | 'nback.arith' | 'nback.switch',
 *              rung: int, params?: { n, onMs, soaMs, switchRate (switch), step (transform) },
 *              set?: setId, seed: string, lureCount?: int (default 4, Stretch 6, max 6), lureMode?: 'controlled' | 'uncontrolled',
 *              protocol?: null | 'cao' | 'wang' | 'jaeggi', lab?: bool }
 *     Missing params come from the ladder (SPEC §5): plain/dual/transform/arith n = 1 + floor(rung / 2),
 *     odd rungs fast; switch n = 1 + floor(rung / 3), rung mod 3 → 0: std .25, 1: std .50, 2: fast .50.
 *     Pace std = 500 / 3000 ms, fast = 500 / 2500 ms. lureMode defaults to 'uncontrolled' for the cao and
 *     jaeggi protocols, else 'controlled'. A set the track cannot use falls back to HF.sets.defaultFor
 *     (meta.setFallback records the request); glyphsLab only with lab: true. Same opts → same block.
 *   ladder(trackId, rung) → { n, fast, switchRate? }     the SPEC §5 rung → parameter mapping
 *   analyze(spec) → { [stream]: [ { mask, target, lure } per trial ] }   re-derived from the stimuli
 *   LURE_NAMES, BITS, STRUCTURES                          shared with score.js (explanations)
 *
 * ── BlockSpec (SPEC §4.2) ──────────────────────────────────────────────────────────────────────
 *   { kind: 'stream', task: 'nback', trackId, seed, set, rung, params: { n, onMs, soaMs, switchRate?, step? },
 *     onMs, soaMs, streams: ['main'] | ['pos', 'snd'], leadIn: n,
 *     sets: { main } | { pos: 'grid8', snd } | { main, what, where: 'grid8' },
 *     trials: [ { i, stim: { main: Item } | { pos: Item, snd: Item }, cue?: 'what' | 'where' | null,
 *                 scorable, target: { [stream]: bool }, lure: { [stream]: null | string } } ],
 *     meta: { n, structure, lureMode, lureCount, lurePlan, targets: { [stream]: 6 }, lures: { [stream]: k },
 *             lureTypes: { [stream]: { label: count } }, rule: { kind, n, step?, text }, switches?, cueCounts?,
 *             solverChecked: true, attempts, fallback: null | 'uncontrolled-relaxed', setFallback? } }
 *     meta.lureCount = position lures actually planned per stream (incl. version-specific ones, null if uncontrolled);
 *     meta.lurePlan = the requested lureCount (0–6) when lures were controlled, else null (Phase 4, CA-08): to
 *     regenerate an equivalent block pass { lureCount: meta.lurePlan, lureMode: meta.lurePlan == null ? 'uncontrolled' : 'controlled' }.
 *   20 + n items; the first n (lead-in) are never scorable or targets; exactly 6 targets per stream among
 *   the 20 scorable items; at most 2 targets in a row per stream; no item repeats immediately unless the
 *   rule needs it (Plain 1-back targets, Plain 2-back n−1 lures).
 *
 * ── Item formats (stim.<stream>) ───────────────────────────────────────────────────────────────
 *   Plain        the set's item: { cell: 0..7 } | { text: 'K' } | { shape: 'tri' } | { glyph: 'glyphsC', index: 3 }
 *                | { tone: 0..7 } | { clip: 'F' }
 *   Dual         pos: { cell: 0..7 } (grid8), snd: { tone: 0..7 } (tones) or { clip: 'F' } (lettersAudio)
 *   Transform    a cyclic set's item: { text: 'Tue' } (days, months, clock, compass) or { cell: 0..7 } (ring8)
 *   Arithmetic   { expr: '3 + 4', value: 7 } — a + b or a − b (U+2212), operands 1–9, value 1–9
 *   Switch       { what: { text: '7' } | { shape: 'tri' }, where: { cell: 0..7 } }; trial.cue = 'what' | 'where'
 *                on scorable trials, null in the lead-in
 *
 * ── Rules (target = rule match with the item n back) and lure labels ───────────────────────────
 *   Plain/Dual   same item                              lures 'n-1', 'n+1' (same item one closer / one further)
 *   Transform    item = order[(index(n back) + step) mod len], step = params.step (default +1: "the day after")
 *                lures 'same' (identity with n back), 'rule-n-1', 'rule-n+1' (the rule holds one closer / further)
 *   Arithmetic   same value, different expression        lures 'value-n-1', 'value-n+1', 'lookalike' (same first
 *                operand as n back, other value). The identical expression never appears at lag n (nor anywhere
 *                within the last n + 1 items), so no target ever shares its first operand with the item n back.
 *   Switch       the cued feature equals that feature n back (and, in our blocks, the other feature differs)
 *                lures 'uncued' (the other feature matches n back), 'cued-n-1', 'cued-n+1'
 *   Controlled lures (default; SPEC §5 as amended 6 Nov), per stream from 2-back: lureCount (default 4, Stretch 6)
 *     position lures at n±1, split evenly n−1 / n+1 — in the Executive versions these are rule-related
 *     (rule-n±1, value-n±1, cued-n±1) — PLUS the version-specific lures: Transform 2 'same', Arithmetic 2
 *     look-alikes, Switch 3 uncued. So Plain/Dual 4 (6), Transform/Arithmetic 6 (8), Switch 7 (9). 1-back: no
 *     lures, except Switch: round(lureCount / 2) uncued (2; Stretch 3). Every other non-target (filler)
 *     matches nothing at n−1, n or n+1: no rule match, and for Transform no identity at n, Arithmetic no
 *     look-alike, Switch no uncued match at n. Targets match only at lag n. Each lure has exactly one type.
 *   Uncontrolled (Cao, Jaeggi): exactly 6 targets; other items random except never a target; lures that
 *     happen anyway are labelled (several types joined with '+').
 *
 * Method: (1) plan the categories: Switch cue sequence first; 6 target positions (runs ≤ 2; Switch: 2–4 on
 * each cue; Dual: 2 shared + 4 + 4); lures placed one by one, each placement kept only if the plan stays
 * structurally possible (union–find over the equalities and inequalities the categories imply, with cyclic
 * offsets for Transform); (2) a depth-first search over item values, left to right, where each position's
 * match mask (maskAt) must equal its planned category exactly, with early checks between equality classes
 * and a lazy shuffle of each position's candidates; (3) on a dead end beyond 600 nodes, re-plan (lure
 * placement itself retries 12 orders first). Up to 400 plans (100,000 test blocks: mean 1.09, max 21), then a
 * deterministic uncontrolled fallback (meta.fallback, never seen in tests). Finally analyze() re-derives every
 * label from the stimuli and must agree (meta.solverChecked).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var NB = tasks.nback || (tasks.nback = {});

  var STRUCTURES = { 'nback.plain': 'identity', 'nback.dual': 'identity-dual', 'nback.transform': 'transform', 'nback.arith': 'arith', 'nback.switch': 'switch' };
  var STD = { onMs: 500, soaMs: 3000 }, FAST = { onMs: 500, soaMs: 2500 };
  var N_SCORABLE = 20, N_TARGETS = 6, MAX_RUN = 2, MAX_PLANS = 400, NODE_BUDGET = 600;
  var MAX_N = 16;   // the catalog's n-back ladders reach 16-back (Phase 4, SC-05); Switch stops at 9 by its ladder
  // match-mask bits of one trial in one stream
  var BITS = { TARGET: 1, IMPURE: 2, LURE_A: 4, LURE_B: 8, LURE_C: 16, FORBIDDEN: 32 };
  var LURE_NAMES = {
    identity: { 4: 'n-1', 8: 'n+1' },
    transform: { 4: 'same', 8: 'rule-n-1', 16: 'rule-n+1' },
    arith: { 4: 'value-n-1', 8: 'value-n+1', 16: 'lookalike' },
    'switch': { 4: 'uncued', 8: 'cued-n-1', 16: 'cued-n+1' }
  };
  var NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function words(n) { return NUM_WORDS[n] || String(n); }

  function ladder(trackId, rung) {
    rung = Math.max(0, Math.floor(+rung || 0));
    if (trackId === 'nback.switch') {
      var sub = rung % 3;
      return { n: 1 + Math.floor(rung / 3), fast: sub === 2, switchRate: sub === 0 ? 0.25 : 0.5 };
    }
    return { n: 1 + Math.floor(rung / 2), fast: rung % 2 === 1 };
  }

  // ───────────────────────────── the rule kernel ─────────────────────────────
  // ctx = { kind: 'identity'|'transform'|'arith'|'switch', K, nx (transform), val, first (arith), cue (switch: 0 what, 1 where) }
  // Values are integers: item index (identity, arith), order index (transform), what·8 + where (switch).
  function maskAt(ctx, s, t, n, v) {
    var a = s[t - n], hasB = n >= 2, b = hasB ? s[t - n + 1] : -1, hasC = t - n - 1 >= 0, c = hasC ? s[t - n - 1] : -1, m = 0;
    if (ctx.kind === 'identity') {
      if (v === a) m |= 1;
      if (hasB && v === b) m |= 4;
      if (hasC && v === c) m |= 8;
    } else if (ctx.kind === 'transform') {
      var nx = ctx.nx;
      if (v === nx[a]) m |= 1;
      if (v === a) m |= 4;
      if (hasB && v === nx[b]) m |= 8;
      if (hasC && v === nx[c]) m |= 16;
    } else if (ctx.kind === 'arith') {
      var val = ctx.val, fst = ctx.first;
      if (v === a) m |= 32; else if (val[v] === val[a]) m |= 1;
      if (hasB && v !== b && val[v] === val[b]) m |= 4;
      if (hasC && v !== c && val[v] === val[c]) m |= 8;
      if (fst[v] === fst[a] && val[v] !== val[a]) m |= 16;
    } else { // switch: cued feature f, uncued feature g
      var q = ctx.cue[t];
      var fv = q ? (v & 7) : (v >> 3), gv = q ? (v >> 3) : (v & 7);
      var fa = q ? (a & 7) : (a >> 3), ga = q ? (a >> 3) : (a & 7);
      if (fv === fa) { m |= 1; if (gv === ga) m |= 2; } else if (gv === ga) m |= 4;
      if (hasB && fv === (q ? (b & 7) : (b >> 3))) m |= 8;
      if (hasC && fv === (q ? (c & 7) : (c >> 3))) m |= 16;
    }
    return m;
  }
  // cat: −1 lead-in, −2 uncontrolled non-target, −3 uncontrolled target,
  //      else the exact planned mask (1 target, 0 filler, 4 / 8 / 16 lure)
  function repeatOK(ctx, s, t, n, v, cat, relaxed) {
    if (t === 0 || relaxed) return true; // relaxed (fallback only): the mask still forbids lag-n twins
    if (ctx.kind === 'arith') { // no identical expression within the last n + 1 items
      for (var k = 1; k <= n + 1 && t - k >= 0; k++) if (s[t - k] === v) return false;
      return true;
    }
    if (v !== s[t - 1]) return true;
    // immediate repeats only where the rule needs them: Plain 1-back targets, Plain 2-back n−1 lures
    return ctx.kind === 'identity' && (((cat === 1 || cat === -3) && n === 1) || (cat === 4 && n === 2));
  }
  // the lure bit that means "matches at lag n + 1" (ignored for 1-back targets: 1-back has no lures)
  function lagCBit(kind) { return kind === 'identity' || kind === 'arith' ? 8 : 16; }
  function okAt(ctx, s, t, n, v, cat, relaxed) {
    if (!repeatOK(ctx, s, t, n, v, cat, relaxed)) return false;
    if (t < n) return true;
    var m = maskAt(ctx, s, t, n, v);
    if (cat === 1 && n === 1) m &= ~lagCBit(ctx.kind);
    if (cat >= 0) return m === cat;          // controlled: exactly the planned category
    if (cat === -3) return (m & 1) && !(m & 34) ? true : false; // uncontrolled target: pure target
    return !(m & 33);                          // uncontrolled non-target: never a target, never forbidden
  }
  function feat(ctx, ch, v) { // the feature a plan check compares: item / order index, value, what or where
    if (ctx.kind === 'arith') return ctx.val[v];
    if (ctx.kind === 'switch') return ch === 0 ? (v >> 3) : (v & 7);
    return v;
  }
  function earlyOK(ctx, s, t, v, list, K) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var fa = feat(ctx, c[0], c[1] === t ? v : s[c[1]]), fb = feat(ctx, c[0], c[2] === t ? v : s[c[2]]);
      if ((((fa - fb - c[3]) % K) + K) % K === 0) return false;
    }
    return true;
  }
  // a superset of the values a category allows (forced categories need not try all K values); null = all
  function domain(ctx, s, t, n, cat) {
    if (t < n || cat === 0 || cat === -2) return null;
    var k = ctx.kind, a = s[t - n];
    if (cat === 1 || cat === -3) {
      if (k === 'identity') return [a];
      if (k === 'transform') return [ctx.nx[a]];
      if (k === 'arith') return ctx.byValue[ctx.val[a]];
      return ctx.cue[t] ? ctx.byWhere[a & 7] : ctx.byWhat[a >> 3];
    }
    var b = n >= 2 ? s[t - n + 1] : -1, c = t - n - 1 >= 0 ? s[t - n - 1] : -1;
    if (k === 'identity') return [cat === 4 ? b : c];
    if (k === 'transform') return [cat === 4 ? a : ctx.nx[cat === 8 ? b : c]];
    if (k === 'arith') return cat === 16 ? ctx.byFirst[ctx.first[a]] : ctx.byValue[ctx.val[cat === 4 ? b : c]];
    var q = ctx.cue[t]; // switch: uncued equal (4) or cued equal to n−1 / n+1 (8 / 16)
    if (cat === 4) return q ? ctx.byWhat[a >> 3] : ctx.byWhere[a & 7];
    var src = cat === 8 ? b : c;
    return q ? ctx.byWhere[src & 7] : ctx.byWhat[src >> 3];
  }
  // Depth-first search with chronological backtracking. Candidates are drawn by a lazy Fisher–Yates shuffle of
  // the position's domain and tested one at a time: the first valid draw is uniform over the valid values, and
  // fillers (most values valid) need one or two tests instead of K.
  function search(ctx, cats, n, rng, budget, relaxed) {
    var L = cats.length, K = ctx.K, s = new Array(L), perm = new Int32Array(L * K), size = new Int32Array(L), pos = new Int32Array(L);
    var nodes = 0, t = 0, i;
    function init(u) {
      var dom = domain(ctx, s, u, n, cats[u]), base = u * K;
      if (dom) { size[u] = dom.length; for (i = 0; i < dom.length; i++) perm[base + i] = dom[i]; }
      else { size[u] = K; for (i = 0; i < K; i++) perm[base + i] = i; }
      pos[u] = 0;
    }
    function draw(u) { // next valid candidate at u, or −1
      var base = u * K, cat = cats[u], early = cats.checks ? cats.checks[u] : null;
      while (pos[u] < size[u]) {
        var a = pos[u], j = a + Math.floor(rng.next() * (size[u] - a)), x = perm[base + j];
        perm[base + j] = perm[base + a]; perm[base + a] = x; pos[u]++;
        if (x < 0 || !okAt(ctx, s, u, n, x, cat, relaxed)) continue;
        if (early && !earlyOK(ctx, s, u, x, early, cats.checksK)) continue;
        return x;
      }
      return -1;
    }
    init(0);
    while (t >= 0) {
      var v = draw(t);
      if (v < 0) { t--; continue; }
      s[t] = v;
      if (++nodes > budget) return null;
      t++;
      if (t === L) return s;
      init(t);
    }
    return null;
  }

  // ───────────────────────────── planning ─────────────────────────────
  function rangeArr(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function num(a, b) { return a - b; }
  function runOK(sorted) {
    var run = 1;
    for (var i = 1; i < sorted.length; i++) { run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1; if (run > MAX_RUN) return false; }
    return true;
  }
  function pickTargets(rng, test) { // 6 of the 20 scorable offsets, runs ≤ 2, optional extra test
    for (var k = 0; k < 2000; k++) {
      var p = rng.sample(rangeArr(N_SCORABLE), N_TARGETS).sort(num);
      if (runOK(p) && (!test || test(p))) return p;
    }
    return null;
  }
  function rep(x, k) { var a = []; for (var i = 0; i < k; i++) a.push(x); return a; }
  function alternate(x, y, k, rng) { var a = [], first = rng.chance(0.5); for (var i = 0; i < k; i++) a.push((i % 2 === 0) === first ? x : y); return a; }
  // version-specific lures added on top of the lureCount rule-related ones, from 2-back (SPEC §5, amended 6 Nov)
  var EXEC_EXTRA = { transform: 2, arith: 2, 'switch': 3 };
  // planned lure masks for one stream (controlled mode): lureCount position lures at n±1 (rule-related in the
  // Executive versions), split n−1 / n+1, plus Transform 2 'same', Arithmetic 2 look-alikes, Switch 3 uncued.
  function lureMix(kind, n, L, rng) {
    L = Math.max(0, L);
    if (n === 1) return kind === 'switch' ? rep(4, Math.round(L / 2)) : []; // 1-back: Switch uncued only, else none
    if (kind === 'identity') return alternate(4, 8, L, rng);
    var rule = kind === 'arith' ? alternate(4, 8, L, rng) : alternate(8, 16, L, rng);
    return rep(kind === 'arith' ? 16 : 4, EXEC_EXTRA[kind]).concat(rule);
  }
  function needsLagC(kind, mask) { return mask === lagCBit(kind); }

  // Structural check of a controlled plan, before any values are drawn. Each category implies equalities
  // ("x[t] equals x[u] shifted by d") and inequalities between positions, per feature channel (Switch: what
  // and where; Arithmetic: the value; Transform: cyclic offsets, d = step). Union–find with offsets merges the
  // equalities; the plan is impossible if an inequality joins two positions already forced equal. Plans that
  // pass are almost always solvable by the value search; the rest is caught by its node budget.
  // forRelations visits the relations implied by category `cat` at position t: visit(isEq, channel, u, d, t)
  // means "x[t] = x[u] + d" (isEq) or "x[t] ≠ x[u] + d". No allocation: called thousands of times per block.
  function forRelations(kind, cat, t, n, q, step, visit) {
    var A = t - n, B = n >= 2 ? t - n + 1 : -1, C = t - n - 1, d = kind === 'transform' ? step : 0;
    var cq = kind === 'switch' ? q : 0, cg = 1 - cq;
    if (cat === 1) { // target (1-back targets may also match at lag 2)
      visit(true, cq, A, d, t); visit(false, cq, B, d, t); visit(false, cq, (n === 1 ? -1 : C), d, t);
      if (kind === 'switch') visit(false, cg, A, 0, t);
    } else if (cat === 0) { // filler
      visit(false, cq, A, d, t); visit(false, cq, B, d, t); visit(false, cq, C, d, t);
      if (kind === 'transform') visit(false, 0, A, 0, t);
      if (kind === 'switch') visit(false, cg, A, 0, t);
    } else if (kind === 'switch') {
      if (cat === 4) { visit(true, cg, A, 0, t); visit(false, cq, A, 0, t); visit(false, cq, B, 0, t); visit(false, cq, C, 0, t); }
      else if (cat === 8) { visit(true, cq, B, 0, t); visit(false, cq, A, 0, t); visit(false, cq, C, 0, t); visit(false, cg, A, 0, t); }
      else { visit(true, cq, C, 0, t); visit(false, cq, A, 0, t); visit(false, cq, B, 0, t); visit(false, cg, A, 0, t); }
    } else if (kind === 'transform') {
      if (cat === 4) { visit(true, 0, A, 0, t); visit(false, 0, B, d, t); visit(false, 0, C, d, t); }
      else if (cat === 8) { visit(true, 0, B, d, t); visit(false, 0, A, d, t); visit(false, 0, A, 0, t); visit(false, 0, C, d, t); }
      else { visit(true, 0, C, d, t); visit(false, 0, A, d, t); visit(false, 0, A, 0, t); visit(false, 0, B, d, t); }
    } else { // identity (n−1 = 4, n+1 = 8) and arith values (value n−1 = 4, n+1 = 8, look-alike = 16)
      if (cat === 4) { visit(true, 0, B, 0, t); visit(false, 0, A, 0, t); visit(false, 0, C, 0, t); }
      else if (cat === 8) { visit(true, 0, C, 0, t); visit(false, 0, A, 0, t); visit(false, 0, B, 0, t); }
      else { visit(false, 0, A, 0, t); visit(false, 0, B, 0, t); visit(false, 0, C, 0, t); }
    }
  }
  // union–find with offsets over (channel × position), in scratch arrays: index = channel · 64 + position
  var UF_PAR = new Int32Array(128), UF_OFF = new Int32Array(128), UF_FIRST = new Int32Array(128);
  var UF_K = 1, UF_FAIL = false, UF_PASS = 0, UF_CHECKS = null;
  function ufFind(x) { // root of x; UF_OFF[x] becomes x − root (mod K)
    var p = UF_PAR[x];
    if (p === x) return x;
    var r = ufFind(p);
    UF_OFF[x] = (UF_OFF[x] + UF_OFF[p]) % UF_K; UF_PAR[x] = r;
    return r;
  }
  function ufVisit(isEq, ch, u, d, t) {
    if (u < 0 || UF_FAIL) return;
    var a = ch * 64 + t, b = ch * 64 + u;
    if (UF_PASS === 1) { // merge equalities
      if (!isEq) return;
      var ra = ufFind(a), rb = ufFind(b);
      if (ra === rb) { if (((UF_OFF[a] - UF_OFF[b] - d) % UF_K + UF_K) % UF_K !== 0) UF_FAIL = true; return; }
      UF_PAR[ra] = rb; UF_OFF[ra] = ((UF_OFF[b] + d - UF_OFF[a]) % UF_K + UF_K) % UF_K; // x[a] = x[b] + d
      return;
    }
    if (isEq) return; // pass 2: inequalities
    var r1 = ufFind(a), r2 = ufFind(b);
    if (r1 === r2) { if (((UF_OFF[a] - UF_OFF[b] - d) % UF_K + UF_K) % UF_K === 0) UF_FAIL = true; return; }
    if (!UF_CHECKS) return;
    // early check between the classes' first members pA, pB: x[pA] − x[pB] ≠ off(pA) − off(a) − off(pB) + off(b) + d
    var pA = UF_FIRST[r1], pB = UF_FIRST[r2];
    ufFind(pA); ufFind(pB);
    var D = (((UF_OFF[pA] - UF_OFF[a] - UF_OFF[pB] + UF_OFF[b] + d) % UF_K) + UF_K) % UF_K;
    var posA = pA - ch * 64, posB = pB - ch * 64, due = posA > posB ? posA : posB;
    (UF_CHECKS[due] || (UF_CHECKS[due] = [])).push([ch, posA, posB, D]);
  }
  // Structural check of a controlled plan, before any values are drawn. Each category implies equalities
  // ("x[t] equals x[u] shifted by d") and inequalities between positions, per feature channel (Switch: what
  // and where; Arithmetic: the value; Transform: cyclic offsets, d = step). Union–find with offsets merges the
  // equalities; the plan is impossible if an inequality joins two positions already forced equal. Plans that
  // pass are almost always solvable by the value search; the rest is caught by its node budget.
  // feasible(...) → false, or true, or (withChecks) an array per position u of early checks [channel, pA, pB, D]:
  // "feature(x[pA]) − feature(x[pB]) ≠ D (mod K)", due when the later of pA, pB is assigned. pA and pB are the
  // first members of two equality classes, so the value search sees a conflict as soon as it becomes certain
  // (instead of many positions later, where chronological backtracking cannot repair it).
  function feasible(kind, cats, n, cue, step, K, withChecks) {
    var L = cats.length, nch = kind === 'switch' ? 2 : 1, t, i, ch;
    for (i = 0; i < nch * 64; i++) { UF_PAR[i] = i; UF_OFF[i] = 0; }
    UF_K = K; UF_FAIL = false; UF_CHECKS = null;
    for (UF_PASS = 1; UF_PASS <= 2; UF_PASS++) {
      if (UF_PASS === 2 && withChecks) {
        for (i = 0; i < nch * 64; i++) UF_FIRST[i] = -1;
        for (ch = 0; ch < nch; ch++) for (t = 0; t < L; t++) { var r = ufFind(ch * 64 + t); if (UF_FIRST[r] < 0) UF_FIRST[r] = ch * 64 + t; }
        UF_CHECKS = []; for (t = 0; t < L; t++) UF_CHECKS.push(null);
      }
      for (t = 0; t < L; t++) {
        if (t >= n && cats[t] >= 0) forRelations(kind, cats[t], t, n, cue ? cue[t] : 0, step, ufVisit);
        // no immediate repeats (identity: except 1-back targets and 2-back n−1 lures; transform: never)
        if (t > 0 && (kind === 'identity' || kind === 'transform') && !(kind === 'identity' && ((cats[t] === 1 && n === 1) || (cats[t] === 4 && n === 2)))) ufVisit(false, 0, t - 1, 0, t);
        if (UF_FAIL) { UF_CHECKS = null; return false; }
      }
    }
    var out = withChecks ? UF_CHECKS : true;
    UF_CHECKS = null;
    return out;
  }

  // categories for every position of one stream; null if the plan cannot be completed
  function streamCats(kind, n, targets, lures, controlled, rng, cue, step, K) {
    var L = N_SCORABLE + n, cats = [], isT = {}, j;
    targets.forEach(function (x) { isT[x] = true; });
    for (var t = 0; t < L; t++) cats.push(t < n ? -1 : (isT[t - n] ? (controlled ? 1 : -3) : (controlled ? 0 : -2)));
    if (!controlled) return cats;
    if (!feasible(kind, cats, n, cue, step, K)) return null;
    var nonT = rangeArr(N_SCORABLE).filter(function (x) { return !isT[x]; }), ok = false;
    // greedy placement can block itself (tight at 2-back with 6 lures): retry with fresh orders before re-planning
    for (var tries = 0; tries < 12 && !ok; tries++) {
      nonT.forEach(function (x) { cats[n + x] = 0; });
      var free = rng.shuffle(nonT), types = rng.shuffle(lures);
      ok = true;
      for (var k = 0; k < types.length && ok; k++) {
        var placed = false;
        for (j = 0; j < free.length && !placed; j++) {
          if (free[j] === null) continue;
          if (needsLagC(kind, types[k]) && free[j] < 1) continue;
          cats[n + free[j]] = types[k];
          if (feasible(kind, cats, n, cue, step, K)) { free[j] = null; placed = true; }
          else cats[n + free[j]] = 0;
        }
        if (!placed) ok = false;
      }
    }
    if (!ok) return null;
    cats.checks = feasible(kind, cats, n, cue, step, K, true);
    cats.checksK = K;
    return cats;
  }
  function planCues(rng, rate) { // cue per scorable offset, exactly round(rate × 19) changes, 6..14 of each
    var nT = N_SCORABLE - 1, sw = Math.round(rate * nT);
    for (var k = 0; k < 2000; k++) {
      var at = {}, cues = [], cur = rng.chance(0.5) ? 1 : 0, ones = 0;
      rng.sample(rangeArr(nT), sw).forEach(function (x) { at[x] = true; });
      for (var j = 0; j < N_SCORABLE; j++) { if (j > 0 && at[j - 1]) cur = 1 - cur; cues.push(cur); ones += cur; }
      if (ones >= 6 && ones <= 14) return { cues: cues, switches: sw };
    }
    return null;
  }

  // ───────────────────────────── options ─────────────────────────────
  function normalize(opts) {
    opts = opts || {};
    var trackId = opts.trackId, kind0 = STRUCTURES[trackId];
    if (!kind0) throw new Error('nback.gen: unknown trackId ' + trackId);
    if (!HF.sets || !HF.rng) throw new Error('nback.gen: HF.rng and HF.sets must be loaded first');
    var p = opts.params || {}, lad = ladder(trackId, opts.rung);
    var n = Math.floor(+p.n || lad.n);
    if (!(n >= 1 && n <= MAX_N)) throw new Error('nback.gen: n out of range');
    var pace = lad.fast ? FAST : STD;
    var o = {
      trackId: trackId, rung: Math.max(0, Math.floor(+opts.rung || 0)), kind: kind0 === 'identity-dual' ? 'identity' : kind0,
      dual: kind0 === 'identity-dual', structure: kind0, n: n,
      onMs: +p.onMs > 0 ? +p.onMs : pace.onMs, soaMs: +p.soaMs > 0 ? +p.soaMs : pace.soaMs,
      seed: opts.seed !== undefined && opts.seed !== null ? String(opts.seed) : HF.rng.newSeed(),
      protocol: opts.protocol || null, lab: !!opts.lab
    };
    o.lureMode = opts.lureMode === 'uncontrolled' || opts.lureMode === 'controlled' ? opts.lureMode
      : (o.protocol === 'cao' || o.protocol === 'jaeggi' ? 'uncontrolled' : 'controlled');
    // lureCount: 4 by default, 6 in Stretch; capped at 6 (more does not fit 14 non-targets reliably at 2-back)
    var lc = opts.lureCount === undefined || opts.lureCount === null ? 4 : Math.floor(+opts.lureCount);
    if (!isFinite(lc)) lc = 4;
    if (lc > 6) o.lureCountCapped = lc;
    o.lureCountRequested = Math.max(0, Math.min(6, lc));
    // set
    var allowed = HF.sets.forTrack(trackId).slice();
    if (o.lab && trackId === 'nback.plain') allowed.push('glyphsLab');
    var set = opts.set;
    if (allowed.indexOf(set) < 0) {
      // Dual's position stream is always grid8, so set: 'grid8' simply means "default sound"
      if (set !== undefined && set !== null && !(kind0 === 'identity-dual' && set === 'grid8')) o.setFallback = set;
      set = HF.sets.defaultFor(trackId);
    }
    o.set = set;
    if (o.kind === 'switch') {
      var rate = +p.switchRate;
      o.switchRate = rate >= 0 && rate <= 1 ? rate : lad.switchRate;
    }
    if (o.kind === 'transform') {
      var K = HF.sets.get(set).order.length, st = p.step === undefined ? 1 : Math.round(+p.step);
      if (!isFinite(st) || ((st % K) + K) % K === 0) { o.stepFallback = p.step; st = 1; }
      o.step = st;
    }
    return o;
  }

  function buildCtx(o) {
    var set = HF.sets.get(o.set);
    if (o.kind === 'identity') return { kind: 'identity', K: set.items.length };
    if (o.kind === 'transform') {
      var K = set.order.length, nx = [];
      for (var v = 0; v < K; v++) nx.push((((v + o.step) % K) + K) % K);
      return { kind: 'transform', K: K, nx: nx };
    }
    if (o.kind === 'arith') {
      var val = [], first = [], byValue = [], byFirst = [], x;
      for (x = 0; x <= 9; x++) { byValue.push([]); byFirst.push([]); }
      set.items.forEach(function (it, i) {
        var e = HF.sets.parseExpr(it.expr);
        val.push(e.value); first.push(e.a); byValue[e.value].push(i); byFirst[e.a].push(i);
      });
      return { kind: 'arith', K: set.items.length, val: val, first: first, byValue: byValue, byFirst: byFirst };
    }
    var W = set.items.length, byWhat = [], byWhere = [], w, c;
    for (w = 0; w < W; w++) { byWhat.push([]); for (c = 0; c < 8; c++) byWhat[w].push(w * 8 + c); }
    for (c = 0; c < 8; c++) { byWhere.push([]); for (w = 0; w < W; w++) byWhere[c].push(w * 8 + c); }
    return { kind: 'switch', K: W * 8, cue: null, byWhat: byWhat, byWhere: byWhere };
  }

  function labelOf(kind, mask, n) {
    if (mask & 1) return null;
    var bits = mask & 28, names = LURE_NAMES[kind], out = [];
    if (!bits) return null;
    if (n === 1) bits = kind === 'switch' ? (bits & 4) : 0;
    [4, 8, 16].forEach(function (b) { if (bits & b) out.push(names[b]); });
    return out.length ? out.join('+') : null;
  }
  function clone(it) { var c = {}; for (var k in it) if (it.hasOwnProperty(k)) c[k] = it[k]; return c; }

  // ───────────────────────────── one attempt ─────────────────────────────
  function attempt(o, rng, relaxed) {
    var n = o.n, L = N_SCORABLE + n, controlled = o.lureMode === 'controlled' && !relaxed;
    var ctx = buildCtx(o), plan = { streams: {} }, j;
    var lureL = controlled ? o.lureCountRequested : 0;
    if (o.kind === 'switch') {
      var cp = planCues(rng, o.switchRate);
      if (!cp) return null;
      ctx.cue = rangeArr(L).map(function (t) { return t < n ? -1 : cp.cues[t - n]; });
      plan.switches = cp.switches;
      var tg = pickTargets(rng, function (p) {
        var w = 0; p.forEach(function (x) { w += cp.cues[x]; });
        return w >= 2 && w <= N_TARGETS - 2; // both cues have targets
      });
      if (!tg) return null;
      plan.streams.main = { targets: tg, cats: streamCats('switch', n, tg, lureMix('switch', n, lureL, rng), controlled, rng, ctx.cue, 0, ctx.K) };
    } else if (o.dual) {
      var tp = null, ts = null;
      for (var k = 0; k < 2000 && !tp; k++) {
        var pos = rng.sample(rangeArr(N_SCORABLE), 10), roles = rng.shuffle(['B', 'B', 'P', 'P', 'P', 'P', 'S', 'S', 'S', 'S']);
        var a = [], b = [];
        for (j = 0; j < 10; j++) { if (roles[j] !== 'S') a.push(pos[j]); if (roles[j] !== 'P') b.push(pos[j]); }
        a.sort(num); b.sort(num);
        if (runOK(a) && runOK(b)) { tp = a; ts = b; }
      }
      if (!tp) return null;
      var kSnd = HF.sets.get(o.set).items.length;
      plan.streams.pos = { targets: tp, cats: streamCats('identity', n, tp, lureMix('identity', n, lureL, rng), controlled, rng, null, 0, 8) };
      plan.streams.snd = { targets: ts, cats: streamCats('identity', n, ts, lureMix('identity', n, lureL, rng), controlled, rng, null, 0, kSnd) };
    } else {
      var t1 = pickTargets(rng, null);
      if (!t1) return null;
      plan.streams.main = { targets: t1, cats: streamCats(o.kind, n, t1, lureMix(o.kind, n, lureL, rng), controlled, rng, null, o.step || 0, ctx.K) };
    }
    var streams = o.dual ? ['pos', 'snd'] : ['main'], seqs = {};
    for (j = 0; j < streams.length; j++) {
      var st = plan.streams[streams[j]];
      if (!st.cats) return null;
      var sctx = ctx;
      if (o.dual) sctx = { kind: 'identity', K: streams[j] === 'pos' ? 8 : HF.sets.get(o.set).items.length };
      var seq = search(sctx, st.cats, n, rng, relaxed ? 20000 : NODE_BUDGET, relaxed);
      if (!seq) return null;
      seqs[streams[j]] = { seq: seq, ctx: sctx };
    }
    plan.seqs = seqs;
    return plan;
  }

  // ───────────────────────────── spec assembly ─────────────────────────────
  function ruleText(o) {
    var set = HF.sets.get(o.set), nb = words(o.n) + ' back';
    if (o.dual) return 'Two streams: press for the position when it matches ' + nb + ', and for the sound when it matches ' + nb + '.';
    if (o.kind === 'identity') return 'Press when the ' + set.noun + ' is the same as ' + nb + '.';
    if (o.kind === 'transform') return 'Press when the ' + set.noun + ' is ' + HF.sets.relPhrase(set, o.step) + ' the one ' + nb + '.';
    if (o.kind === 'arith') return 'Press when the answer equals the answer ' + nb + ', written as a different sum.';
    return 'A cue says WHAT or WHERE. Press when that feature (the ' + set.noun + ' or the position) matches the item ' + nb + '.';
  }

  function assemble(o, plan, attempts, fallback) {
    var n = o.n, L = N_SCORABLE + n, setObj = HF.sets.get(o.set), whatSet = setObj;
    var streams = o.dual ? ['pos', 'snd'] : ['main'];
    var trials = [], meta = {
      n: n, structure: o.structure, lureMode: fallback ? 'uncontrolled' : o.lureMode,
      lureCount: o.lureMode === 'controlled' && !fallback ? (lureMixCount(o)) : null,
      // the requested position-lure count (opts.lureCount after the 0–6 clamp; null when lures were not controlled):
      // regenerate a block with { lureCount: meta.lurePlan } — meta.lureCount already includes version-specific lures (CA-08)
      lurePlan: o.lureMode === 'controlled' ? o.lureCountRequested : null,
      targets: {}, lures: {}, lureTypes: {}, rule: { kind: o.kind, n: n, text: ruleText(o) },
      solverChecked: false, attempts: attempts, fallback: fallback || null
    };
    if (o.kind === 'transform') { meta.rule.step = o.step; meta.rule.order = setObj.order.map(function (it) { return HF.sets.name(it); }); }
    if (o.setFallback !== undefined) meta.setFallback = o.setFallback;
    if (o.stepFallback !== undefined) meta.stepFallback = o.stepFallback;
    if (o.lureCountCapped !== undefined) meta.lureCountCapped = o.lureCountCapped;
    for (var t = 0; t < L; t++) {
      var tr = { i: t, stim: {}, scorable: t >= n, target: {}, lure: {} };
      streams.forEach(function (st) {
        var v = plan.seqs[st].seq[t], item;
        if (o.dual) item = st === 'pos' ? { cell: v } : clone(setObj.items[v]);
        else if (o.kind === 'switch') item = { what: clone(whatSet.items[v >> 3]), where: { cell: v & 7 } };
        else item = clone(setObj.items[v]);
        tr.stim[st] = item;
        if (t >= n) {
          var m = maskAt(plan.seqs[st].ctx, plan.seqs[st].seq, t, n, v);
          tr.target[st] = !!(m & 1);
          tr.lure[st] = labelOf(o.kind, m, n);
        } else { tr.target[st] = false; tr.lure[st] = null; }
      });
      if (o.kind === 'switch') tr.cue = t >= n ? (plan.seqs.main.ctx.cue[t] ? 'where' : 'what') : null;
      trials.push(tr);
    }
    streams.forEach(function (st) {
      var nt = 0, nl = 0, types = {};
      trials.forEach(function (tr) {
        if (tr.target[st]) nt++;
        if (tr.lure[st]) { nl++; types[tr.lure[st]] = (types[tr.lure[st]] || 0) + 1; }
      });
      meta.targets[st] = nt; meta.lures[st] = nl; meta.lureTypes[st] = types;
    });
    if (o.kind === 'switch') {
      meta.switches = plan.switches;
      var cc = { what: 0, where: 0 };
      trials.forEach(function (tr) { if (tr.cue) cc[tr.cue]++; });
      meta.cueCounts = cc;
    }
    var params = { n: n, onMs: o.onMs, soaMs: o.soaMs };
    if (o.kind === 'switch') params.switchRate = o.switchRate;
    if (o.kind === 'transform') params.step = o.step;
    var spec = {
      kind: 'stream', task: 'nback', trackId: o.trackId, seed: o.seed, set: o.set, rung: o.rung, params: params,
      onMs: o.onMs, soaMs: o.soaMs, streams: streams, leadIn: n,
      sets: o.dual ? { pos: 'grid8', snd: o.set } : (o.kind === 'switch' ? { main: o.set, what: o.set, where: 'grid8' } : { main: o.set }),
      trials: trials, meta: meta
    };
    if (o.protocol) spec.protocol = o.protocol;
    return spec;
  }
  function lureMixCount(o) {
    if (o.n === 1) return o.kind === 'switch' ? Math.round(o.lureCountRequested / 2) : 0;
    return o.lureCountRequested + (EXEC_EXTRA[o.kind] || 0);
  }

  // ───────────────────────────── analysis (shared with score.js and the self-check) ─────────────────────────────
  function decode(spec, st) { // stimuli → integer values and rule context for one stream
    var kind = STRUCTURES[spec.trackId] === 'identity-dual' ? 'identity' : STRUCTURES[spec.trackId];
    var n = spec.params.n, sets = spec.sets || { main: spec.set }, o = { kind: kind, set: sets[st] || spec.set, step: spec.params.step || 1 };
    if (kind === 'switch') o.set = sets.what || spec.set;
    var ctx = buildCtx(o), seq = [], cue = [];
    if (STRUCTURES[spec.trackId] === 'identity-dual') ctx = { kind: 'identity', K: st === 'pos' ? 8 : HF.sets.get(sets.snd || spec.set).items.length };
    spec.trials.forEach(function (tr, t) {
      var it = tr.stim[st];
      if (kind === 'switch') {
        seq.push(HF.sets.indexOf(o.set, it.what) * 8 + it.where.cell);
        cue.push(tr.cue === 'where' ? 1 : (tr.cue === 'what' ? 0 : -1));
      } else if (STRUCTURES[spec.trackId] === 'identity-dual' && st === 'pos') seq.push(it.cell);
      else seq.push(HF.sets.indexOf(STRUCTURES[spec.trackId] === 'identity-dual' ? (sets.snd || spec.set) : o.set, it));
    });
    if (kind === 'switch') ctx.cue = cue;
    return { ctx: ctx, seq: seq, n: n, kind: kind };
  }
  function analyze(spec) {
    var out = {};
    spec.streams.forEach(function (st) {
      var d = decode(spec, st), rows = [];
      for (var t = 0; t < d.seq.length; t++) {
        if (t < d.n || d.seq[t] < 0) { rows.push({ mask: 0, target: false, lure: null, value: d.seq[t] }); continue; }
        var m = maskAt(d.ctx, d.seq, t, d.n, d.seq[t]);
        rows.push({ mask: m, target: !!(m & 1), lure: labelOf(d.kind, m, d.n), value: d.seq[t] });
      }
      out[st] = rows;
    });
    return out;
  }
  function selfCheck(spec, o) {
    var an = analyze(spec), ok = true;
    spec.streams.forEach(function (st) {
      var rows = an[st], nt = 0, run = 0, maxRun = 0;
      spec.trials.forEach(function (tr, t) {
        var r = rows[t];
        if (tr.scorable !== (t >= o.n)) ok = false;
        if (r.target !== tr.target[st] || r.lure !== tr.lure[st]) ok = false;
        if (r.mask & 32) ok = false;
        if (tr.target[st]) { nt++; run++; if (run > maxRun) maxRun = run; } else run = 0;
      });
      if (nt !== N_TARGETS || maxRun > MAX_RUN) ok = false;
      if (spec.meta.lureMode === 'controlled' && spec.meta.lures[st] !== spec.meta.lureCount) ok = false;
    });
    return ok;
  }

  // ───────────────────────────── entry point ─────────────────────────────
  function gen(opts) {
    var o = normalize(opts);
    HF.sets.prepare(o.set);
    var rng = HF.rng.create(o.seed), spec = null;
    for (var a = 1; a <= MAX_PLANS && !spec; a++) {
      var plan = attempt(o, rng, false);
      if (!plan) continue;
      var s = assemble(o, plan, a, null);
      if (selfCheck(s, o)) spec = s;
    }
    if (!spec) { // deterministic fallback: uncontrolled, repeats allowed (should never be needed)
      var frng = HF.rng.create(o.seed + '/fallback');
      for (var b = 1; b <= MAX_PLANS && !spec; b++) {
        var fp = attempt(o, frng, true);
        if (!fp) continue;
        var fs = assemble(o, fp, MAX_PLANS + b, 'uncontrolled-relaxed');
        if (selfCheck(fs, o)) spec = fs;
      }
      if (!spec) throw new Error('nback.gen: no valid block for ' + o.trackId + ' n=' + o.n + ' set=' + o.set);
    }
    spec.meta.solverChecked = true;
    return spec;
  }

  NB.gen = gen;
  NB.ladder = ladder;
  NB.analyze = analyze;
  NB.decode = decode;
  NB.maskAt = maskAt;
  NB.BITS = BITS;
  NB.LURE_NAMES = LURE_NAMES;
  NB.STRUCTURES = STRUCTURES;
  NB.words = words;
  if (typeof module === 'object' && module.exports) module.exports = NB;
})(typeof window !== 'undefined' ? window : globalThis);
