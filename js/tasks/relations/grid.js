/* Long-Horizon — Relation Grid generator (trackIds 'rel.grid.T1' … 'rel.grid.T8'). Pure: no DOM, no timers. MIT licence.

   Task (relation-monitoring arrays after Chuderski 2014, Bateman et al. 2019, Li & Birney 2026; implemented from
   their descriptions): a 3×3 grid (4×4 in T7) of 3-symbol strings. Only one position of each string counts: the
   LAST symbol, or the MIDDLE one in the icon variant. Answer MATCH if some line satisfies the rule, else NO.
   Every array has exactly one target line or none.

   Tiers (PLAN §4.2)                               lines judged
     T1 Same                                       rows + columns (6)
     T2 Ascending (rows left→right, columns top→bottom; strictly increasing)   rows + columns
     T3 Different (all distinct)                   rows + columns
     T4 Same OR Different, one rule per block      rows + columns + both diagonals (8)
        (rule from the block seed; params.rule overrides)
     T5 Five-same                                  five-cell shapes (below)
     T6 Two features: every cell is ONE glyph with a shape and a fill pattern; rule "same shape AND all-different
        fills" or its mirror "same fill AND all-different shapes" (one per block, from the seed; params.sameFeature
        'shape'|'fill' overrides)                                                                  rows + columns
     T7 4×4 grid, Same OR Different on 4-cell rows/columns, one rule per block (from the seed)     8 lines
     T8 Five-different                             five-cell shapes
   Five-cell shapes in a 3×3 grid (Chuderski 2014: "a cross, or a T in any of four rotations"); cells 0–8 row-major:
     plus     = 1 3 4 5 7   (centre + its four neighbours)
     T-top    = 0 1 2 4 7   (top row + middle column below it)
     T-bottom = 6 7 8 4 1   (bottom row + middle column above it)
     T-left   = 0 3 6 4 5   (left column + middle row to its right)
     T-right  = 2 5 8 4 3   (right column + middle row to its left)
   Target lines per block (10 target arrays): rows/columns 5 + 5; T4 rows 4, columns 4, diagonals 2;
   T5/T8 plus 2 + T shapes 8 (any rotation).

   Pressure steps (SPEC §5; rung r = 0…8 = R1…R9; effects cumulative):
     R1 8000 ms, 1–4 strings kept from the previous array | R2 5500 kept | R3 5500 all replaced | R4 4500
     R5 4500 + 6 duplicate distractor symbols in irrelevant positions | R6 4500 + near-miss lines
     R7 3500 | R8 2750 | R9 2000.   itiMs 100. 20 arrays per block, 10 with exactly one target line.
   Kept strings (R1/R2): 1–4 per array after the first, identical to the previous array's string in the same cell,
   never all cells of the new target line; every other string differs from the one it replaces (R3+: all of them).
   Without distractors no irrelevant symbol appears more than 3 times in a 3×3 grid (5 in 4×4); with distractors one
   relevant symbol of the array appears exactly 6 times in irrelevant positions and no other more than twice (3×3).
   Near-miss lines ("all but one element fits"): Same — exactly one cell differs; Different — exactly one repeat;
   Ascending — two of the three order relations hold; T6 — a line that satisfies exactly one of the two relations.
   Let tn = number of target-or-near lines in an array. Allowed tn (low = R1–R5, high = R6–R9):
     rows/cols Same {1} / {2,3}; rows/cols Different {4,5} / {6}; +diagonals Same {1} / {2,3}, Different {6,7} / {8};
     five-same {1} / {2,3}; five-different {1,2} / {3,4}; Ascending {1,2} / {3,4};
     4×4 Same {1} / {2,3}; 4×4 Different {3,4,5} / {7,8}; T6: same-feature lines 1 / 2–3 and diff-feature lines 1–2 / 2–3.
   (Different at R1–R5 therefore always contains 1–2 easy all-same lines; from R6 every non-target line is a near miss.)
   Every T2 array also holds at least one strictly DESCENDING line (matched in pairs), so ignoring the stated
   direction ("any monotone line") does not beat chance.

   No shortcut beats chance: arrays come in matched pairs. Each block draws 10 "keys" and builds one target array
   and one non-target array from every key. A key fixes the multiset of relevant-symbol counts (so the most frequent
   symbol's count and the number of distinct symbols are identical within each pair) and the per-line profile
   (tn, hence the number of lines with a repeat, all-same lines, all-distinct lines). Keys are drawn from the overlap
   of the natural target and non-target distributions (exact enumeration of the 21,147 equality patterns of a 3×3
   grid; T2 adds a random order of the symbol classes and builds the twin from the same pattern under a random grid
   symmetry with a fresh order; T6 pairs two patterns; T7 uses random 4×4 arrays and swap-made twins). So the pair
   detector, the duplicate counter and distinct-count heuristics see identical statistics in target and non-target
   arrays (measured: .500 for each, tests/unit/rel-grid.test.mjs).

   Content variants (opts.variant, or inferred from opts.set; default digits):
     digits   '0'–'9' (10), last symbol counts, cells are 3-character strings, natural order
     letters  B D F G H K M P R T (10), last symbol, strings, alphabetical order
     icons    indices 0–7 into set 'shapes' (8), MIDDLE symbol counts, cells are [a, b, c]; order key on screen
     dots     numerosity 1–9 (9), last, cells [n, n, n]; natural order
     bars     orientation index 0–7 (angle = index × 22.5° clockwise from vertical), last; order key = clockwise
     glyphs   indices 0–7 of a glyph family (glyphsA–H from opts.set, else from the seed), last; order key on screen
     lab      Lab-only (never trained): LOCATION — each symbol is a small square frame with one dot in one of its
              8 outer cells, index 0–7 clockwise from top-left (the grid8 convention); last; order key = clockwise
     colors   OPT-IN ONLY (never chosen by default): colour index 0–7 (Okabe–Ito order), last; order key on screen
   T6 cells are { shape: index, fill: 'solid'|'empty'|'hlines'|'vlines'|'dots'|'checks' } (shapes from set
   'shapes', or a glyph family when the glyphs variant is requested). T6 has no irrelevant positions, so the R5
   distractor step does nothing there (documented deviation).

   gen(opts) → discrete BlockSpec (SPEC §4.3)
     opts = { trackId: 'rel.grid.T1'…'T8', rung: 0…8, seed, set?, variant?, lab?: bool,
              params?: { rule?, windowMs?, itiMs? } }
     → { kind: 'discrete', task: 'relations', trackId, seed, set, rung, params: { tier, step, windowMs, itiMs, keep,
         replace, distractors, nearMiss, variant, rule }, windowMs, itiMs,
         trials: [ { i, stim: { size, cells: [size² cells], kept: [cell indices] }, answer: 'match'|'no',
                     meta: { line: lineId|null, lineCells: [..]|null, near: <# near-miss lines>, key, twin: i,
                             distractor: symbol|null } } ],
         meta: { tier, step, rule: { id, text, lines, direction?, sameFeature?, orderKey? }, variant, setId,
                 relevantPos, size, alphabetSize, lines: [ { id, cells, label } ], arrays: 20, targets: 10,
                 solverChecked: true, fallback: null|'deterministic', attempts } }
   solve(spec, trial) → { targets: [lineId], near: [lineId], values: { [lineId]: [display symbols] } }  (the rule)
   explain(spec, trial) → { text, line, cells }   plain-English "why" from solve() (used by score.js)
   content.{pick, size, display, cell, order}      content-variant helpers shared with stream.js
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var tasks = HF.tasks || (HF.tasks = {});
  var R = tasks.relations || (tasks.relations = {});

  var ARRAYS = 20, PAIRS = 10, ITI_MS = 100, ATTEMPTS = 200, LAYOUT_TRIES = 600, TWIN_TRIES = 300;

  var RUNGS = [
    { step: 'R1', windowMs: 8000, keep: true, distractors: false, nearMiss: false },
    { step: 'R2', windowMs: 5500, keep: true, distractors: false, nearMiss: false },
    { step: 'R3', windowMs: 5500, keep: false, distractors: false, nearMiss: false },
    { step: 'R4', windowMs: 4500, keep: false, distractors: false, nearMiss: false },
    { step: 'R5', windowMs: 4500, keep: false, distractors: true, nearMiss: false },
    { step: 'R6', windowMs: 4500, keep: false, distractors: true, nearMiss: true },
    { step: 'R7', windowMs: 3500, keep: false, distractors: true, nearMiss: true },
    { step: 'R8', windowMs: 2750, keep: false, distractors: true, nearMiss: true },
    { step: 'R9', windowMs: 2000, keep: false, distractors: true, nearMiss: true }
  ];

  // ---------- geometry ----------
  function mkLines3() {
    var rows = [], cols = [], r, c;
    for (r = 0; r < 3; r++) rows.push({ id: 'row' + (r + 1), cells: [r * 3, r * 3 + 1, r * 3 + 2], kind: 'row', label: 'Row ' + (r + 1) });
    for (c = 0; c < 3; c++) cols.push({ id: 'col' + (c + 1), cells: [c, c + 3, c + 6], kind: 'col', label: 'Column ' + (c + 1) });
    return rows.concat(cols);
  }
  function mkLines4() {
    var out = [], r, c;
    for (r = 0; r < 4; r++) out.push({ id: 'row' + (r + 1), cells: [r * 4, r * 4 + 1, r * 4 + 2, r * 4 + 3], kind: 'row', label: 'Row ' + (r + 1) });
    for (c = 0; c < 4; c++) out.push({ id: 'col' + (c + 1), cells: [c, c + 4, c + 8, c + 12], kind: 'col', label: 'Column ' + (c + 1) });
    return out;
  }
  var LINES = {
    rc3: mkLines3(),
    rcd3: mkLines3().concat([
      { id: 'diag1', cells: [0, 4, 8], kind: 'diag', label: 'The diagonal from top left' },
      { id: 'diag2', cells: [2, 4, 6], kind: 'diag', label: 'The diagonal from top right' }
    ]),
    five: [
      { id: 'plus', cells: [1, 3, 4, 5, 7], kind: 'plus', label: 'The plus' },
      { id: 'T-top', cells: [0, 1, 2, 4, 7], kind: 'T', label: 'The T along the top' },
      { id: 'T-bottom', cells: [6, 7, 8, 4, 1], kind: 'T', label: 'The T along the bottom' },
      { id: 'T-left', cells: [0, 3, 6, 4, 5], kind: 'T', label: 'The T along the left side' },
      { id: 'T-right', cells: [2, 5, 8, 4, 3], kind: 'T', label: 'The T along the right side' }
    ],
    rc4: mkLines4()
  };
  var KIND_PLAN = {
    rc3: ['row', 'row', 'row', 'row', 'row', 'col', 'col', 'col', 'col', 'col'],
    rc4: ['row', 'row', 'row', 'row', 'row', 'col', 'col', 'col', 'col', 'col'],
    rcd3: ['row', 'row', 'row', 'row', 'col', 'col', 'col', 'col', 'diag', 'diag'],
    five: ['plus', 'plus', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T']
  };
  var TN = {
    'rc3/same': [[1], [2, 3]], 'rc3/different': [[4, 5], [6]],
    'rcd3/same': [[1], [2, 3]], 'rcd3/different': [[6, 7], [8]],
    'five/same': [[1], [2, 3]], 'five/different': [[1, 2], [3, 4]],
    'rc3/ascending': [[1, 2], [3, 4]],
    'rc4/same': [[1], [2, 3]], 'rc4/different': [[3, 4, 5], [7, 8]]
  };
  var T6_SETS = { low: { s: [1], d: [1, 2] }, high: { s: [2, 3], d: [2, 3] } };

  var TIERS = {
    T1: { rule: 'same', ls: 'rc3', size: 3 },
    T2: { rule: 'ascending', ls: 'rc3', size: 3 },
    T3: { rule: 'different', ls: 'rc3', size: 3 },
    T4: { rule: 'seed', ls: 'rcd3', size: 3 },
    T5: { rule: 'same', ls: 'five', size: 3 },
    T6: { rule: 'two', ls: 'rc3', size: 3 },
    T7: { rule: 'seed', ls: 'rc4', size: 4 },
    T8: { rule: 'different', ls: 'five', size: 3 }
  };

  // ---------- content variants ----------
  var FILLS = ['solid', 'empty', 'hlines', 'vlines', 'dots', 'checks'];
  var VARIANTS = {
    digits: { id: 'digits', kind: 'text', alphabet: '0123456789'.split(''), relevantPos: 2, order: 'natural', setId: 'digits', noun: 'last digits' },
    letters: { id: 'letters', kind: 'text', alphabet: 'BDFGHKMPRT'.split(''), relevantPos: 2, order: 'natural', setId: 'letters', noun: 'last letters' },
    icons: { id: 'icons', kind: 'index', size: 8, relevantPos: 1, order: 'key', permute: true, setId: 'shapes', noun: 'middle icons' },
    dots: { id: 'dots', kind: 'num', size: 9, offset: 1, relevantPos: 2, order: 'natural', setId: 'dots', noun: 'last dot groups' },
    bars: { id: 'bars', kind: 'index', size: 8, relevantPos: 2, order: 'key', setId: 'bars', noun: 'last bars' },
    glyphs: { id: 'glyphs', kind: 'index', size: 8, relevantPos: 2, order: 'key', permute: true, setId: null, noun: 'last glyphs' },
    lab: { id: 'lab', kind: 'index', size: 8, relevantPos: 2, order: 'key', setId: 'lab', noun: 'last dot positions' },
    colors: { id: 'colors', kind: 'index', size: 8, relevantPos: 2, order: 'key', setId: 'colors', optIn: true, noun: 'last colours' }
  };
  var GLYPH_SETS = ['glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH'];
  function alphaSize(v) { return v.kind === 'text' ? v.alphabet.length : v.size; }

  /** Which content variant a block uses. Colour only when explicitly asked for. */
  function pickVariant(opts, tier, seedHash) {
    var set = opts.set ? String(opts.set) : '', want = opts.variant ? String(opts.variant) : '', id = 'digits', glyphSet = null;
    if (opts.lab === true || want === 'lab' || set === 'lab' || set === 'glyphsLab') id = 'lab';
    else if (VARIANTS[want]) id = want;
    else if (set === 'digits' || set === 'numbers') id = 'digits';
    else if (set === 'letters') id = 'letters';
    else if (set === 'shapes' || set === 'icons') id = 'icons';
    else if (set === 'dots') id = 'dots';
    else if (set === 'bars') id = 'bars';
    else if (set === 'colors' || set === 'colours') id = 'colors';
    else if (/^glyphs[A-H]$/.test(set)) id = 'glyphs';
    if (id === 'glyphs') glyphSet = /^glyphs[A-H]$/.test(set) ? set : GLYPH_SETS[seedHash[3] % 8];
    if (tier === 'T6' && id !== 'glyphs') id = 'icons';
    return { v: VARIANTS[id], glyphSet: glyphSet };
  }

  // ---------- small helpers ----------
  function ff(A, k) { var r = 1; for (var i = 0; i < k; i++) r *= (A - i); return r; }
  function pickCum(items, cum, rng) {
    var x = rng.next() * cum[cum.length - 1], lo = 0, hi = cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
    return items[lo];
  }
  function toInt(x, d) { x = Number(x); return isFinite(x) ? Math.round(x) : d; }
  function clampInt(x, lo, hi) { x = toInt(x, lo); return x < lo ? lo : (x > hi ? hi : x); }
  /** Distinct count d and max multiplicity mm of sym over cells, encoded as d * 8 + mm (no allocation). */
  function lineCode(sym, cells) {
    var n = cells.length, i, j;
    if (n === 3) {
      var a = sym[cells[0]], b = sym[cells[1]], c = sym[cells[2]];
      if (a === b) return b === c ? 11 : 18;     // d1 mm3 | d2 mm2
      return (a === c || b === c) ? 18 : 25;     // d2 mm2 | d3 mm1
    }
    var d = 0, mm = 0;
    for (i = 0; i < n; i++) {
      var v = sym[cells[i]], first = true, cnt = 1;
      for (j = 0; j < i; j++) if (sym[cells[j]] === v) { first = false; break; }
      if (!first) continue;
      d++;
      for (j = i + 1; j < n; j++) if (sym[cells[j]] === v) cnt++;
      if (cnt > mm) mm = cnt;
    }
    return d * 8 + mm;
  }
  function lineDM(sym, cells) { var x = lineCode(sym, cells); return { d: x >> 3, mm: x & 7 }; }

  // ---------- equality patterns of a 3×3 grid (set partitions; Bell(9) = 21,147) ----------
  var PARTS = null;
  function parts() {
    if (PARTS) return PARTS;
    var list = [], a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    (function rec(i, mx) {
      if (i === 9) { list.push(a.slice()); return; }
      for (var v = 0; v <= mx + 1; v++) { a[i] = v; rec(i + 1, v > mx ? v : mx); }
    })(1, 0);
    var n = list.length, lab = new Array(n), k = new Uint8Array(n), prof = new Array(n), p, c;
    for (p = 0; p < n; p++) {
      var cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0], kk = 0;
      for (c = 0; c < 9; c++) { cnt[list[p][c]]++; if (list[p][c] + 1 > kk) kk = list[p][c] + 1; }
      lab[p] = list[p]; k[p] = kk;
      prof[p] = cnt.slice(0, kk).sort(function (x, y) { return y - x; }).join('.');
    }
    PARTS = { n: n, lab: lab, k: k, prof: prof };
    return PARTS;
  }

  /** Same / Different on a 3×3 line set: key = profile|tn → target patterns by line, non-target patterns. */
  var EQ = {};
  function eqTable(ls, rule) {
    var id = ls + '/' + rule;
    if (EQ[id]) return EQ[id];
    var P = parts(), lines = LINES[ls], keys = {}, order = [], p, li;
    for (p = 0; p < P.n; p++) {
      var nT = 0, nN = 0, tline = -1, lab = P.lab[p];
      for (li = 0; li < lines.length; li++) {
        var code = lineCode(lab, lines[li].cells), d = code >> 3, mm = code & 7, len = lines[li].cells.length;
        var isT = rule === 'same' ? d === 1 : d === len;
        var isN = !isT && (rule === 'same' ? mm === len - 1 : d === len - 1);
        if (isT) { nT++; tline = li; } else if (isN) nN++;
      }
      if (nT > 1) continue;
      var tn = nT + nN, key = P.prof[p] + '|' + tn, e = keys[key];
      if (!e) { e = keys[key] = { key: key, k: P.k[p], tn: tn, T: {}, N: [] }; order.push(key); }
      if (nT) (e.T[tline] || (e.T[tline] = [])).push(p);
      else e.N.push(p);
    }
    return (EQ[id] = { id: id, ls: ls, rule: rule, keys: keys, order: order });
  }

  /** Key distribution: overlap of the natural target and non-target distributions, restricted to tn ∈ tnSet. */
  var QC = {};
  function keyDist(tab, A, tnSet, kind) {
    var id = tab.id + '/' + A + '/' + tnSet.join(',') + '/' + kind;
    if (QC[id]) return QC[id];
    var lines = LINES[tab.ls], cand = [], ZT = 0, ZN = 0, i;
    for (i = 0; i < tab.order.length; i++) {
      var e = tab.keys[tab.order[i]];
      if (e.k > A || tnSet.indexOf(e.tn) < 0 || !e.N.length) continue;
      var tl = [], nT = 0;
      for (var li in e.T) if (lines[+li].kind === kind) { tl.push(+li); nT += e.T[li].length; }
      if (!nT) continue;
      var f = ff(A, e.k);
      cand.push({ e: e, wT: nT * f, wN: e.N.length * f, tl: tl });
      ZT += nT * f; ZN += e.N.length * f;
    }
    var items = [], cum = [], s = 0;
    for (i = 0; i < cand.length; i++) {
      var q = Math.min(cand[i].wT / ZT, cand[i].wN / ZN);
      if (q > 0) { s += q; items.push(cand[i]); cum.push(s); }
    }
    return (QC[id] = { items: items, cum: cum });
  }

  /** Row/column statistics of every 3×3 pattern (for T2 and T6). */
  var RC = null;
  function rcStats() {
    if (RC) return RC;
    var P = parts(), lines = LINES.rc3, n1 = new Uint8Array(P.n), n12 = new Uint8Array(P.n), n3 = new Uint8Array(P.n), p, li;
    var byD3 = {}, byS = {};
    for (p = 0; p < P.n; p++) {
      for (li = 0; li < 6; li++) {
        var d = lineDM(P.lab[p], lines[li].cells).d;
        if (d === 1) n1[p]++;
        if (d <= 2) n12[p]++;
        if (d === 3) n3[p]++;
      }
      var kd = P.prof[p] + '|' + n3[p], ks = P.prof[p] + '|' + n1[p] + '|' + n12[p];
      (byD3[kd] || (byD3[kd] = [])).push(p);
      (byS[ks] || (byS[ks] = [])).push(p);
    }
    RC = { n1: n1, n12: n12, n3: n3, byD3: byD3, byS: byS };
    return RC;
  }
  /** Natural (uniform-random-array) weights over patterns that pass `filter`, for alphabet size A. */
  var NAT = {};
  function natural(id, A, filter) {
    var key = id + '/' + A;
    if (NAT[key]) return NAT[key];
    var P = parts(), items = [], cum = [], s = 0, p;
    for (p = 0; p < P.n; p++) {
      if (P.k[p] > A || !filter(p)) continue;
      s += ff(A, P.k[p]); items.push(p); cum.push(s);
    }
    return (NAT[key] = { items: items, cum: cum });
  }

  function transpose3(lab) { var out = new Array(9); for (var c = 0; c < 9; c++) out[(c % 3) * 3 + Math.floor(c / 3)] = lab[c]; return out; }
  function lineIndex(ls, id) { var L = LINES[ls]; for (var i = 0; i < L.length; i++) if (L[i].id === id) return i; return -1; }

  // ---------- rules on relevant symbols (internal indices; for ascending, index order = ascending order) ----------
  function ascScore(sym, cells) {
    var a = sym[cells[0]], b = sym[cells[1]], c = sym[cells[2]];
    return (a < b ? 1 : 0) + (b < c ? 1 : 0) + (a < c ? 1 : 0);
  }
  function isDesc(sym, cells) { return sym[cells[0]] > sym[cells[1]] && sym[cells[1]] > sym[cells[2]]; }

  /** Status of one line: 2 = target, 1 = near miss, 0 = neither; +4 if strictly descending (ascending rule). */
  function lineStatus(rule, sym, sym2, cells) {
    var len = cells.length, code, d, t, n;
    if (rule === 'same' || rule === 'different') {
      code = lineCode(sym, cells); d = code >> 3;
      t = rule === 'same' ? d === 1 : d === len;
      n = !t && (rule === 'same' ? (code & 7) === len - 1 : d === len - 1);
      return t ? 2 : (n ? 1 : 0);
    }
    if (rule === 'ascending') {
      var sc = ascScore(sym, cells);
      return (sc === 3 ? 2 : (sc === 2 ? 1 : 0)) + (isDesc(sym, cells) ? 4 : 0);
    }
    // two-feature: sym = the "same" feature, sym2 = the "different" feature
    var s1 = (lineCode(sym, cells) >> 3) === 1, d2 = (lineCode(sym2, cells) >> 3) === len;
    return (s1 && d2) ? 2 : ((s1 || d2) ? 1 : 0);
  }

  /** Counts only (hot path): fills out = { nT, tline, nNear, desc }. */
  function judgeCount(ls, rule, sym, sym2, out) {
    var lines = LINES[ls], nT = 0, tline = -1, nNear = 0, desc = 0, li, st;
    for (li = 0; li < lines.length; li++) {
      st = lineStatus(rule, sym, sym2, lines[li].cells);
      if ((st & 3) === 2) { nT++; tline = li; } else if ((st & 3) === 1) nNear++;
      if (st & 4) desc++;
    }
    out.nT = nT; out.tline = tline; out.nNear = nNear; out.desc = desc;
    return out;
  }

  /** Judge every line (lists; used by solve/explain and tests). */
  function judgeLines(ls, rule, sym, sym2) {
    var lines = LINES[ls], targets = [], near = [], desc = 0, li, st;
    for (li = 0; li < lines.length; li++) {
      st = lineStatus(rule, sym, sym2, lines[li].cells);
      if ((st & 3) === 2) targets.push(li); else if ((st & 3) === 1) near.push(li);
      if (st & 4) desc++;
    }
    return { targets: targets, near: near, desc: desc };
  }

  // ---------- layouts (equality structure + order) ----------
  /** Partition-based tiers (T1, T3, T4, T5, T8). Returns 10 pairs { T: {lab, k, line}, N: {lab, k}, key }. */
  function pairsEq(cfg, rng) {
    var tab = eqTable(cfg.ls, cfg.rule), kinds = rng.shuffle(KIND_PLAN[cfg.ls]), out = [], P = parts();
    for (var j = 0; j < PAIRS; j++) {
      var Q = keyDist(tab, cfg.A, cfg.tnSet, kinds[j]);
      if (!Q.items.length) return null;
      var c = pickCum(Q.items, Q.cum, rng), li = rng.pick(c.tl);
      var pT = rng.pick(c.e.T[li]), pN = rng.pick(c.e.N);
      out.push({ key: c.e.key, T: { lab: P.lab[pT], k: P.k[pT], line: li }, N: { lab: P.lab[pN], k: P.k[pN] } });
    }
    return out;
  }

  /** T2 Ascending: pattern + random order of its classes (rank[label]). */
  var RANK = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  function ascLayout(lab, k, rng) {
    var i, j, t, sym = new Array(9);
    for (i = 0; i < k; i++) RANK[i] = i;                 // reset: the result depends on rng only
    for (i = k - 1; i > 0; i--) { j = Math.floor(rng.next() * (i + 1)); t = RANK[i]; RANK[i] = RANK[j]; RANK[j] = t; }
    for (var c = 0; c < 9; c++) sym[c] = RANK[lab[c]];
    return sym;
  }
  function range(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = i; return a; }
  // the 8 symmetries of a 3×3 grid (rows/columns map to rows/columns): D4[g][c] = new index of cell c
  var D4 = (function () {
    var maps = [
      function (r, c) { return [r, c]; }, function (r, c) { return [c, 2 - r]; }, function (r, c) { return [2 - r, 2 - c]; },
      function (r, c) { return [2 - c, r]; }, function (r, c) { return [r, 2 - c]; }, function (r, c) { return [2 - r, c]; },
      function (r, c) { return [c, r]; }, function (r, c) { return [2 - c, 2 - r]; }
    ];
    return maps.map(function (f) { var a = []; for (var x = 0; x < 9; x++) { var y = f(Math.floor(x / 3), x % 3); a.push(y[0] * 3 + y[1]); } return a; });
  })();
  function applySym(lab, g) { var out = new Array(9); for (var c = 0; c < 9; c++) out[D4[g][c]] = lab[c]; return out; }

  function pairsAsc(cfg, rng) {
    // an ascending line and a descending lure both need an all-distinct line: propose patterns with ≥ 2 of them
    var P = parts(), S = rcStats(), nat = natural('n3ge2', cfg.A, function (p) { return S.n3[p] >= 2; });
    var kinds = rng.shuffle(KIND_PLAN.rc3), out = [], j, t, u, jl = {}, jn = {};
    for (j = 0; j < PAIRS; j++) {
      var done = null;
      for (t = 0; t < LAYOUT_TRIES && !done; t++) {
        var p = pickCum(nat.items, nat.cum, rng), lab = P.lab[p], sym = ascLayout(lab, P.k[p], rng);
        judgeCount('rc3', 'ascending', sym, null, jl);
        if (jl.nT !== 1) continue;
        var tn = 1 + jl.nNear, desc = jl.desc;
        if (cfg.tnSet.indexOf(tn) < 0 || desc < 1) continue; // a descending lure line in every array
        if (LINES.rc3[jl.tline].kind !== kinds[j]) { sym = transpose3(sym); lab = transpose3(lab); judgeCount('rc3', 'ascending', sym, null, jl); }
        var tline = jl.tline;
        // twin: the same equality pattern under a random symmetry, with a fresh order of its symbol classes
        for (u = 0; u < TWIN_TRIES; u++) {
          var labN = applySym(P.lab[p], Math.floor(rng.next() * 8)), symN = ascLayout(labN, P.k[p], rng);
          judgeCount('rc3', 'ascending', symN, null, jn);
          if (jn.nT === 0 && jn.nNear === tn && jn.desc === desc) {
            done = { key: P.prof[p] + '|' + S.n3[p] + '|' + tn + '|' + desc,
              T: { lab: lab, k: P.k[p], sym: sym, line: tline }, N: { lab: labN, k: P.k[p], sym: symN } };
            break;
          }
        }
      }
      if (!done) return null;
      out.push(done);
    }
    return out;
  }

  /** T6: a "same" pattern (feature X) and a "different" pattern (feature Y). */
  function pairsTwo(cfg, rng) {
    var P = parts(), S = rcStats(), sets = cfg.high ? T6_SETS.high : T6_SETS.low;
    var natS = natural('t6s' + sets.s.join(','), cfg.AX, function (p) { return sets.s.indexOf(S.n1[p]) >= 0; });
    var natD = natural('t6d' + sets.d.join(','), cfg.AY, function (p) { return sets.d.indexOf(S.n3[p]) >= 0; });
    var kinds = rng.shuffle(KIND_PLAN.rc3), out = [], j, t, u, jl = {}, jn = {};
    for (j = 0; j < PAIRS; j++) {
      var done = null;
      for (t = 0; t < LAYOUT_TRIES && !done; t++) {
        var ps = pickCum(natS.items, natS.cum, rng), pd = pickCum(natD.items, natD.cum, rng);
        var a = P.lab[ps], b = P.lab[pd];
        judgeCount('rc3', 'two', a, b, jl);
        if (jl.nT !== 1) continue;
        if (LINES.rc3[jl.tline].kind !== kinds[j]) { a = transpose3(a); b = transpose3(b); judgeCount('rc3', 'two', a, b, jl); }
        var listS = S.byS[P.prof[ps] + '|' + S.n1[ps] + '|' + S.n12[ps]], listD = S.byD3[P.prof[pd] + '|' + S.n3[pd]];
        for (u = 0; u < TWIN_TRIES; u++) {
          var qs = rng.pick(listS), qd = rng.pick(listD);
          judgeCount('rc3', 'two', P.lab[qs], P.lab[qd], jn);
          if (jn.nT === 0) {
            done = { key: P.prof[ps] + '|' + S.n1[ps] + '|' + S.n12[ps] + '/' + P.prof[pd] + '|' + S.n3[pd],
              T: { lab: a, lab2: b, k: P.k[ps], k2: P.k[pd], line: jl.tline },
              N: { lab: P.lab[qs], lab2: P.lab[qd], k: P.k[qs], k2: P.k[qd] } };
            break;
          }
        }
      }
      if (!done) return null;
      out.push(done);
    }
    return out;
  }

  /** T7 4×4: random arrays with a planted line; twin = one swap that turns the line into a near miss. */
  var S4 = {};
  function stats4(sym, rule) {
    judgeCount('rc4', rule, sym, null, S4);
    return { nT: S4.nT, tline: S4.tline, tn: S4.nT + S4.nNear };
  }
  function pairs4(cfg, rng) {
    var lines = LINES.rc4, kinds = rng.shuffle(KIND_PLAN.rc4), out = [], j, t, same = cfg.rule === 'same';
    for (j = 0; j < PAIRS; j++) {
      var done = null;
      for (t = 0; t < LAYOUT_TRIES && !done; t++) {
        var cand = [];
        for (var li = 0; li < 8; li++) if (lines[li].kind === kinds[j]) cand.push(li);
        var L = rng.pick(cand), cells = lines[L].cells, sym = new Array(16), c, i;
        if (same) {
          var a = rng.int(0, cfg.A - 1);
          for (c = 0; c < 16; c++) sym[c] = rng.int(0, cfg.A - 1);
          for (i = 0; i < 4; i++) sym[cells[i]] = a;
        } else {
          var m = Math.min(cfg.A, rng.int(4, 5)), sub = rng.sample(range(cfg.A), m), inL = rng.sample(sub, 4);
          for (c = 0; c < 16; c++) sym[c] = rng.pick(sub);
          for (i = 0; i < 4; i++) sym[cells[i]] = inL[i];
        }
        var st = stats4(sym, cfg.rule);
        if (st.nT !== 1 || st.tline !== L || cfg.tnSet.indexOf(st.tn) < 0) continue;
        var twin = twin4(sym, cells, st.tn, cfg.rule, rng);
        if (twin) done = { key: 'tn' + st.tn, T: { lab: sym, k: cfg.A, line: L }, N: { lab: twin, k: cfg.A } };
      }
      if (!done) return null;
      out.push(done);
    }
    return out;
  }
  function twin4(sym, Lcells, tn, rule, rng) {
    var us = rng.shuffle(Lcells), others = [], c, i, j;
    for (c = 0; c < 16; c++) if (Lcells.indexOf(c) < 0) others.push(c);
    others = rng.shuffle(others);
    var s = sym.slice();
    for (i = 0; i < us.length; i++) {
      for (j = 0; j < others.length; j++) {
        var u = us[i], v = others[j], ok;
        if (rule === 'same') ok = s[v] !== s[u];
        else { ok = false; for (var w = 0; w < 4; w++) if (Lcells[w] !== u && s[Lcells[w]] === s[v]) ok = true; }
        if (!ok) continue;
        var tmp = s[u]; s[u] = s[v]; s[v] = tmp;
        var st = stats4(s, rule);
        if (st.nT === 0 && st.tn === tn) return s.slice();
        tmp = s[u]; s[u] = s[v]; s[v] = tmp;
      }
    }
    return null;
  }

  // ---------- symbols and strings ----------
  /** Injective class → symbol map; keeps up to keepN cells' previous symbols when the pattern allows. */
  function shuffleInPlace(a, n, rng) {
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(rng.next() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function cellOrder(n, rng) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = i; return shuffleInPlace(a, n, rng); }
  function flags(n, cells) { var f = new Array(n); for (var i = 0; i < n; i++) f[i] = false; if (cells) for (i = 0; i < cells.length; i++) f[cells[i]] = true; return f; }

  function assignEq(lab, k, A, prev, keepN, tCells, rng) {
    var n = lab.length, map = new Array(k), used = new Array(A), kept = [], i, maxInT = tCells ? tCells.length - 1 : 99, inT = 0;
    for (i = 0; i < k; i++) map[i] = -1;
    for (i = 0; i < A; i++) used[i] = -1;
    if (prev && keepN > 0) {
      var order = cellOrder(n, rng), inLine = flags(n, tCells);
      for (i = 0; i < n && kept.length < keepN; i++) {
        var c = order[i], b = lab[c], s = prev[c];
        if (inLine[c] && inT >= maxInT) continue;
        if ((map[b] === -1 && used[s] === -1) || map[b] === s) {
          map[b] = s; used[s] = b; kept.push(c);
          if (inLine[c]) inT++;
        }
      }
    }
    var free = [];
    for (i = 0; i < A; i++) if (used[i] === -1) free.push(i);
    shuffleInPlace(free, free.length, rng);
    for (i = 0; i < k; i++) if (map[i] === -1) map[i] = free.pop();
    var sym = new Array(n);
    for (i = 0; i < n; i++) sym[i] = map[lab[i]];
    return { sym: sym, kept: kept };
  }

  /** Ascending: ranks → values (order preserving), keeping previous symbols where consistent. */
  function assignAsc(rankSym, A, prev, keepN, tCells, rng) {
    var n = rankSym.length, k = 0, i, c;
    for (i = 0; i < n; i++) if (rankSym[i] + 1 > k) k = rankSym[i] + 1;
    var fix = [], kept = [], order = rng.shuffle(range(n)), maxInT = tCells ? tCells.length - 1 : 99, inT = 0;
    for (i = 0; i < k; i++) fix.push(-1);
    function feasible(f) {
      var lastR = -1, lastV = -1;
      for (var r = 0; r < k; r++) {
        if (f[r] < 0) continue;
        if (f[r] - lastV - 1 < r - lastR - 1) return false;
        lastR = r; lastV = f[r];
      }
      return (A - 1 - lastV) >= (k - 1 - lastR);
    }
    if (prev && keepN > 0) {
      for (i = 0; i < n && kept.length < keepN; i++) {
        c = order[i];
        var r = rankSym[c], v = prev[c], isT = tCells && tCells.indexOf(c) >= 0;
        if (isT && inT >= maxInT) continue;
        if (fix[r] === v) { kept.push(c); if (isT) inT++; continue; }
        if (fix[r] !== -1) continue;
        var clash = false;
        for (var q = 0; q < k; q++) if (fix[q] === v) clash = true;
        if (clash) continue;
        fix[r] = v;
        if (feasible(fix)) { kept.push(c); if (isT) inT++; } else fix[r] = -1;
      }
    }
    // fill the gaps with random increasing values
    var vals = fix.slice(), lastR = -1, lastV = -1;
    for (var r2 = 0; r2 <= k; r2++) {
      if (r2 < k && vals[r2] < 0) continue;
      var hiV = r2 < k ? vals[r2] : A, g = r2 - lastR - 1;
      if (g > 0) {
        var pool = [];
        for (var x = lastV + 1; x < hiV; x++) pool.push(x);
        var pickd = rng.sample(pool, g).sort(function (p1, p2) { return p1 - p2; });
        for (var gi = 0; gi < g; gi++) vals[lastR + 1 + gi] = pickd[gi];
      }
      if (r2 < k) { lastR = r2; lastV = vals[r2]; }
    }
    var sym = new Array(n);
    for (i = 0; i < n; i++) sym[i] = vals[rankSym[i]];
    return { sym: sym, kept: kept };
  }

  /** Strings: kept cells copy the previous string; others get fresh irrelevant symbols (capped; distractors). */
  function pickCapped(A, delta, cur, counts, cap, rng) {
    var s, tries;
    for (tries = 0; tries < 24; tries++) {
      s = Math.floor(rng.next() * A);
      if (s !== delta && s !== cur && counts[s] < cap) return s;
    }
    var opts = [];
    for (s = 0; s < A; s++) if (s !== delta && s !== cur && counts[s] < cap) opts.push(s);
    if (!opts.length) for (s = 0; s < A; s++) if (s !== delta && s !== cur) opts.push(s);
    return opts[Math.floor(rng.next() * opts.length)];
  }
  function buildStrings(sym, A, relPos, prevStr, kept, distract, rng) {
    var n = sym.length, strs = new Array(n), slots = [], counts = new Array(A), isKept = flags(n, kept), c, p, i, s;
    for (i = 0; i < A; i++) counts[i] = 0;
    for (c = 0; c < n; c++) {
      if (isKept[c]) {
        strs[c] = prevStr[c].slice();
        for (p = 0; p < 3; p++) if (p !== relPos) counts[strs[c][p]]++;
      } else {
        strs[c] = [-1, -1, -1]; strs[c][relPos] = sym[c];
        for (p = 0; p < 3; p++) if (p !== relPos) slots.push(c * 3 + p);
      }
    }
    shuffleInPlace(slots, slots.length, rng);
    var delta = -1, nSlots = n * 2, first = 0;
    if (distract && slots.length >= 6) {
      var present = [];
      for (c = 0; c < n; c++) if (present.indexOf(sym[c]) < 0) present.push(sym[c]);
      delta = present[Math.floor(rng.next() * present.length)];
      for (i = 0; i < 6; i++) strs[(slots[i] / 3) | 0][slots[i] % 3] = delta;
      counts[delta] += 6;
      first = 6;
    }
    // caps: with distractors no other irrelevant symbol may rival the 6 duplicates; without, at most 3 per symbol in
    // a 3×3 grid (a little more in 4×4), so a run of 6 identical irrelevant symbols only ever means distractors
    var cap = delta >= 0 ? Math.max(2, Math.ceil((nSlots - 6) / (A - 1))) : Math.max(3, Math.ceil(nSlots / A) + (n > 9 ? 1 : 0));
    for (i = first; i < slots.length; i++) {
      s = pickCapped(A, delta, -1, counts, cap, rng);
      strs[(slots[i] / 3) | 0][slots[i] % 3] = s; counts[s]++;
    }
    // a fresh string must never repeat the previous string in the same cell (only kept cells do)
    var ok = true;
    if (prevStr) {
      for (c = 0; c < n; c++) {
        if (isKept[c] || !sameStr(strs[c], prevStr[c])) continue;
        var fixed = false;
        for (p = 0; p < 3 && !fixed; p++) {
          if (p === relPos || strs[c][p] === delta) continue; // never move a distractor (exactly 6)
          var cur = strs[c][p], nv = pickCapped(A, delta, cur, counts, cap, rng);
          counts[cur]--; strs[c][p] = nv; counts[nv]++; fixed = true;
        }
        if (!fixed) ok = false;
      }
    }
    return { strs: strs, delta: delta, ok: ok };
  }
  function sameStr(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

  // ---------- block ----------
  function ruleFor(tier, cfgRule, seedHash, given) {
    if (cfgRule !== 'seed' && cfgRule !== 'two') return cfgRule;
    if (cfgRule === 'two') {
      if (given && (given.sameFeature === 'shape' || given.sameFeature === 'fill')) return given.sameFeature;
      return (seedHash[1] & 1) ? 'fill' : 'shape';
    }
    if (given && (given.rule === 'same' || given.rule === 'different')) return given.rule;
    return (seedHash[0] & 1) ? 'different' : 'same';
  }

  function ruleText(tier, rule, ls, variant) {
    var where = ls === 'rcd3' ? 'a row, column or diagonal' : (ls === 'five' ? 'a plus or a T shape (any rotation)' : 'a row or column');
    var noun = variant.noun;
    if (tier === 'T6') {
      return rule === 'shape'
        ? 'MATCH if ' + where + ' has the same shape in all three cells AND three different fills.'
        : 'MATCH if ' + where + ' has the same fill in all three cells AND three different shapes.';
    }
    if (rule === 'same') return 'MATCH if the ' + noun + ' in ' + where + ' are all the same.';
    if (rule === 'different') return 'MATCH if the ' + noun + ' in ' + where + ' are all different.';
    return 'MATCH if the ' + noun + ' in a row increase from left to right, or in a column increase from top to bottom' +
      (variant.order === 'key' ? ' (order as in the key).' : '.');
  }

  function params(tier, rung, given) {
    var r = clampInt(rung, 0, 8), st = RUNGS[r], g = given || {};
    var windowMs = toInt(g.windowMs, 0) > 0 ? toInt(g.windowMs, 0) : st.windowMs;
    var itiMs = toInt(g.itiMs, -1) >= 0 ? toInt(g.itiMs, ITI_MS) : ITI_MS;
    return { tier: tier, step: st.step, windowMs: windowMs, itiMs: itiMs, keep: st.keep, replace: !st.keep,
      distractors: st.distractors && tier !== 'T6', nearMiss: st.nearMiss };
  }

  function tierOf(trackId) {
    var m = /^rel\.grid\.(T[1-8])$/.exec(String(trackId || ''));
    return m ? m[1] : 'T1';
  }

  var JC = {};
  /** One attempt at a whole block; null if some constraint could not be met. */
  function buildBlock(ctx, rng, relaxed) {
    var cfg = ctx.cfg, pairs;
    if (ctx.tier === 'T2') pairs = pairsAsc(cfg, rng);
    else if (ctx.tier === 'T6') pairs = pairsTwo(cfg, rng);
    else if (ctx.tier === 'T7') pairs = pairs4(cfg, rng);
    else pairs = pairsEq(cfg, rng);
    if (!pairs) return null;
    // display order: 10 targets and 10 twins in random order
    var types = shuffleInPlace(['T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N'], ARRAYS, rng);
    var tOrder = cellOrder(PAIRS, rng), nOrder = cellOrder(PAIRS, rng), ti = 0, ni = 0, slotT = new Array(PAIRS), slotN = new Array(PAIRS), plan = [], i;
    for (i = 0; i < ARRAYS; i++) {
      var pi = types[i] === 'T' ? tOrder[ti++] : nOrder[ni++];
      plan.push({ type: types[i], pair: pi });
      if (types[i] === 'T') slotT[pi] = i; else slotN[pi] = i;
    }
    var lines = LINES[ctx.ls], prevSym = null, prevStr = null, prev2 = null, trials = [];
    for (i = 0; i < ARRAYS; i++) {
      var pl = plan[i], pr = pairs[pl.pair], L = pl.type === 'T' ? pr.T : pr.N;
      var keepN = (!relaxed && ctx.p.keep && i > 0) ? rng.int(1, 4) : 0;
      var tCells = pl.type === 'T' ? lines[L.line].cells : null, a, b = null, sym, sym2 = null, kept, built = null;
      if (ctx.tier === 'T6') {
        var res = null;
        for (var at = 0; at < 30 && !(res && res.ok); at++) res = assignTwo(L, cfg, prevSym, prev2, keepN, tCells, rng);
        if (!res.ok) return null;
        sym = res.sym; sym2 = res.sym2; kept = res.kept;
      } else {
        a = ctx.tier === 'T2' ? assignAsc(L.sym, cfg.A, prevSym, keepN, tCells, rng) : assignEq(L.lab, L.k, cfg.A, prevSym, keepN, tCells, rng);
        sym = a.sym; kept = a.kept;
        built = buildStrings(sym, cfg.A, ctx.v.relevantPos, prevStr, kept, ctx.p.distractors, rng);
        if (!built.ok) return null;
      }
      if (keepN > 0 && kept.length === 0) return null; // R1/R2 promise 1–4 kept strings: rebuild the block
      var jl = ctx.tier === 'T6' ? judgeCount('rc3', 'two', sym, sym2, JC) : judgeCount(ctx.ls, ctx.ruleEval, sym, null, JC);
      var want = pl.type === 'T' ? 1 : 0;
      if (jl.nT !== want || (want && jl.tline !== L.line)) return null; // never expected
      trials.push({
        i: i, type: pl.type, pair: pl.pair, sym: sym, sym2: sym2, strs: built ? built.strs : null, kept: kept,
        delta: built ? built.delta : -1, line: want ? L.line : -1, near: jl.nNear, key: pr.key
      });
      prevSym = sym; prev2 = sym2; prevStr = built ? built.strs : null;
    }
    for (i = 0; i < ARRAYS; i++) trials[i].twin = trials[i].type === 'T' ? slotN[trials[i].pair] : slotT[trials[i].pair];
    return trials;
  }

  /** T6: two injective maps, keeping a cell only if both features stay consistent. */
  function assignTwo(L, cfg, prevA, prevB, keepN, tCells, rng) {
    // feature X = the "same" feature (pattern lab), feature Y = the "different" feature (pattern lab2)
    var n = 9, mapA = [], mapB = [], usedA = new Array(cfg.AX), usedB = new Array(cfg.AY), kept = [], i, inT = 0;
    for (i = 0; i < L.k; i++) mapA.push(-1);
    for (i = 0; i < L.k2; i++) mapB.push(-1);
    for (i = 0; i < cfg.AX; i++) usedA[i] = -1;
    for (i = 0; i < cfg.AY; i++) usedB[i] = -1;
    if (prevA && keepN > 0) {
      var order = rng.shuffle(range(n));
      for (i = 0; i < n && kept.length < keepN; i++) {
        var c = order[i], ba = L.lab[c], bb = L.lab2[c], sa = prevA[c], sb = prevB[c], isT = tCells && tCells.indexOf(c) >= 0;
        if (isT && inT >= 2) continue;
        var okA = (mapA[ba] === -1 && usedA[sa] === -1) || mapA[ba] === sa;
        var okB = (mapB[bb] === -1 && usedB[sb] === -1) || mapB[bb] === sb;
        if (okA && okB) { mapA[ba] = sa; usedA[sa] = ba; mapB[bb] = sb; usedB[sb] = bb; kept.push(c); if (isT) inT++; }
      }
    }
    var freeA = [], freeB = [];
    for (i = 0; i < cfg.AX; i++) if (usedA[i] === -1) freeA.push(i);
    for (i = 0; i < cfg.AY; i++) if (usedB[i] === -1) freeB.push(i);
    freeA = rng.shuffle(freeA); freeB = rng.shuffle(freeB);
    for (i = 0; i < L.k; i++) if (mapA[i] === -1) mapA[i] = freeA.pop();
    for (i = 0; i < L.k2; i++) if (mapB[i] === -1) mapB[i] = freeB.pop();
    var sym = new Array(n), sym2 = new Array(n), ok = true;
    for (i = 0; i < n; i++) { sym[i] = mapA[L.lab[i]]; sym2[i] = mapB[L.lab2[i]]; }
    // a non-kept cell must not repeat the previous glyph in the same cell (caller retries)
    if (prevA) for (i = 0; i < n; i++) if (kept.indexOf(i) < 0 && sym[i] === prevA[i] && sym2[i] === prevB[i]) ok = false;
    return { sym: sym, sym2: sym2, kept: kept, ok: ok };
  }

  function makeCtx(opts) {
    opts = opts || {};
    var trackId = opts.trackId || 'rel.grid.T1', tier = tierOf(trackId), T = TIERS[tier];
    var seed = String(opts.seed == null ? '' : opts.seed), h = HF.rng.hash('rel.grid/' + seed);
    var pv = pickVariant(opts, tier, h), v = pv.v, rung = clampInt(opts.rung, 0, 8);
    var p = params(tier, rung, opts.params), high = p.nearMiss;
    var rule = ruleFor(tier, T.rule, h, opts.params), ls = T.ls, cfg;
    var map = null, A = alphaSize(v);
    if (v.permute) {
      // icons / glyphs: internal order 0..7 ↦ displayed index (the on-screen order key)
      map = HF.rng.create('rel.grid.key/' + seed).shuffle(range(v.size));
    }
    if (tier === 'T6') {
      var AX = rule === 'shape' ? 8 : FILLS.length, AY = rule === 'shape' ? FILLS.length : 8;
      cfg = { AX: AX, AY: AY, high: high };
    } else {
      var tnKey = ls + '/' + (tier === 'T2' ? 'ascending' : rule);
      cfg = { A: A, rule: rule, ls: ls, tnSet: TN[tnKey][high ? 1 : 0], high: high };
    }
    return { opts: opts, trackId: trackId, tier: tier, seed: seed, v: v, glyphSet: pv.glyphSet, rung: rung, p: p, rule: rule,
      ls: ls, cfg: cfg, map: map, A: A, ruleEval: tier === 'T2' ? 'ascending' : rule };
  }

  function displaySym(ctx, idx) {
    var v = ctx.v;
    if (v.kind === 'text') return v.alphabet[idx];
    if (v.kind === 'num') return idx + v.offset;
    return ctx.map ? ctx.map[idx] : idx;
  }

  function gen(opts) {
    var ctx = makeCtx(opts), base = HF.rng.create('rel.grid/' + ctx.seed + '/' + ctx.tier), trials = null, tries = 0, fallback = null;
    while (!trials && tries < ATTEMPTS) { trials = buildBlock(ctx, base.fork('a' + tries), false); tries++; }
    if (!trials) { fallback = 'deterministic'; trials = fallbackTrials(ctx); }
    return toSpec(ctx, trials, tries, fallback);
  }

  /** Deterministic fallback: a seed-independent search with no kept strings and any near-miss count. Throws if even
      that fails (never seen; tested for every tier and rule). */
  function fallbackTrials(ctx) {
    var fb = HF.rng.create('rel.grid.fallback/' + ctx.tier + '/' + ctx.rule + '/' + ctx.v.id), trials = null, k;
    if (ctx.cfg.tnSet) ctx.cfg.tnSet = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (k = 0; k < ATTEMPTS && !trials; k++) trials = buildBlock(ctx, fb.fork('f' + k), true);
    if (!trials) throw new Error('rel.grid: no valid block for ' + ctx.tier);
    return trials;
  }

  function toSpec(ctx, trials, tries, fallback) {
    var lines = LINES[ctx.ls], size = ctx.tier === 'T7' ? 4 : 3, out = [], i, c, disp = [], text = ctx.v.kind === 'text';
    for (i = 0; i < 10; i++) disp.push(displaySym(ctx, i));
    for (i = 0; i < trials.length; i++) {
      var t = trials[i], cells = new Array(t.sym.length);
      for (c = 0; c < t.sym.length; c++) {
        if (ctx.tier === 'T6') {
          var shape = ctx.rule === 'shape' ? t.sym[c] : t.sym2[c], fill = ctx.rule === 'shape' ? t.sym2[c] : t.sym[c];
          cells[c] = { shape: ctx.map ? ctx.map[shape] : shape, fill: FILLS[fill] };
        } else {
          var s = t.strs[c];
          cells[c] = text ? disp[s[0]] + disp[s[1]] + disp[s[2]] : [disp[s[0]], disp[s[1]], disp[s[2]]];
        }
      }
      out.push({
        i: i,
        stim: { size: size, cells: cells, kept: t.kept.slice().sort(function (a, b) { return a - b; }) },
        answer: t.type === 'T' ? 'match' : 'no',
        meta: {
          line: t.line >= 0 ? lines[t.line].id : null, lineCells: t.line >= 0 ? lines[t.line].cells.slice() : null,
          near: t.near, key: t.key, twin: t.twin, distractor: t.delta >= 0 ? displaySym(ctx, t.delta) : null
        }
      });
    }
    var orderKey = null;
    if (ctx.tier === 'T2' && ctx.v.order === 'key') { orderKey = []; for (i = 0; i < ctx.A; i++) orderKey.push(displaySym(ctx, i)); }
    var setId = ctx.v.id === 'glyphs' ? ctx.glyphSet : ctx.v.setId;
    if (ctx.tier === 'T6') setId = ctx.v.id === 'glyphs' ? ctx.glyphSet : 'shapes';
    var ruleId = ctx.tier === 'T6' ? (ctx.rule === 'shape' ? 'same-shape-different-fill' : 'same-fill-different-shape')
      : (ctx.tier === 'T5' ? 'five-same' : (ctx.tier === 'T8' ? 'five-different' : ctx.ruleEval));
    var params = {};
    for (var k in ctx.p) params[k] = ctx.p[k];
    params.variant = ctx.v.id; params.rule = ruleId;
    return {
      kind: 'discrete', task: 'relations', trackId: ctx.trackId, seed: ctx.seed, set: ctx.opts.set || setId, rung: ctx.rung,
      params: params, windowMs: ctx.p.windowMs, itiMs: ctx.p.itiMs, trials: out,
      meta: {
        tier: ctx.tier, step: ctx.p.step,
        rule: {
          id: ruleId, base: ctx.tier === 'T6' ? 'two-feature' : ctx.ruleEval, text: ruleText(ctx.tier, ctx.ruleEval === 'ascending' ? 'ascending' : ctx.rule, ctx.ls, ctx.v),
          lines: ctx.ls === 'rcd3' ? 'rows-columns-diagonals' : (ctx.ls === 'five' ? 'plus-and-T' : 'rows-columns'),
          direction: ctx.tier === 'T2' ? 'rows left to right, columns top to bottom; strictly increasing' : null,
          sameFeature: ctx.tier === 'T6' ? ctx.rule : null, fills: ctx.tier === 'T6' ? FILLS.slice() : null,
          orderKey: orderKey
        },
        variant: ctx.v.id, setId: setId, relevantPos: ctx.tier === 'T6' ? null : ctx.v.relevantPos, size: size,
        alphabetSize: ctx.tier === 'T6' ? null : ctx.A,
        lines: lines.map(function (L) { return { id: L.id, cells: L.cells.slice(), label: L.label }; }),
        arrays: ARRAYS, targets: PAIRS, solverChecked: true, fallback: fallback, attempts: tries
      }
    };
  }

  // ---------- the rule on a finished spec (scorer, tutorial) ----------
  function internalOf(spec, sym) {
    // display symbol → order index (for ascending); equality rules only need identity
    var v = VARIANTS[spec.meta.variant];
    if (v.kind === 'text') return v.alphabet.indexOf(sym);
    if (v.kind === 'num') return sym - v.offset;
    var key = spec.meta.rule.orderKey;
    return key ? key.indexOf(sym) : sym;
  }
  function relevantOf(spec, trial) {
    var cells = trial.stim.cells, pos = spec.meta.relevantPos, out = [], c;
    for (c = 0; c < cells.length; c++) out.push(cells[c][pos]);
    return out;
  }
  function lsOf(spec) { return spec.meta.size === 4 ? 'rc4' : (spec.meta.rule.lines === 'rows-columns-diagonals' ? 'rcd3' : (spec.meta.rule.lines === 'plus-and-T' ? 'five' : 'rc3')); }

  function solve(spec, trial) {
    var ls = lsOf(spec), lines = LINES[ls], base = spec.meta.rule.base, jl, values = {}, c, li;
    if (base === 'two-feature') {
      var shapes = [], fills = [];
      for (c = 0; c < 9; c++) { shapes.push(trial.stim.cells[c].shape); fills.push(trial.stim.cells[c].fill); }
      var same = spec.meta.rule.sameFeature === 'shape' ? shapes : fills, diff = spec.meta.rule.sameFeature === 'shape' ? fills : shapes;
      jl = judgeLines('rc3', 'two', same, diff);
      for (li = 0; li < lines.length; li++) values[lines[li].id] = lines[li].cells.map(function (x) { return trial.stim.cells[x]; });
    } else {
      var rel = relevantOf(spec, trial), sym = base === 'ascending' ? rel.map(function (s) { return internalOf(spec, s); }) : rel;
      jl = judgeLines(ls, base, sym);
      for (li = 0; li < lines.length; li++) values[lines[li].id] = lines[li].cells.map(function (x) { return rel[x]; });
    }
    return {
      targets: jl.targets.map(function (x) { return lines[x].id; }),
      near: jl.near.map(function (x) { return lines[x].id; }),
      values: values
    };
  }

  function nameable(spec) { var v = spec.meta.variant; return v === 'digits' || v === 'letters' || v === 'dots'; }
  function phrase(spec, lineId, isTarget) {
    var base = spec.meta.rule.base, kind = /^col/.test(lineId) ? 'col' : 'row';
    if (base === 'two-feature') {
      var sf = spec.meta.rule.sameFeature;
      return isTarget ? (sf === 'shape' ? 'same shape, all different fills' : 'same fill, all different shapes')
        : (sf === 'shape' ? 'only one of the two relations holds (same shape, different fills)' : 'only one of the two relations holds (same fill, different shapes)');
    }
    var five = spec.meta.rule.lines === 'plus-and-T', n4 = spec.meta.size === 4;
    var all = five ? 'all five' : (n4 ? 'all four' : 'all');
    if (base === 'same') return isTarget ? all + ' the same' : (five ? 'four the same, one different' : (n4 ? 'three the same, one different' : 'two the same, one different'));
    if (base === 'different') return isTarget ? all + ' different' : 'almost — one symbol repeats';
    return isTarget ? (kind === 'col' ? 'increasing from top to bottom' : 'increasing from left to right') : 'almost — one step goes the wrong way';
  }
  function describeLine(spec, sol, lineId) {
    var L = null, ls = LINES[lsOf(spec)];
    for (var i = 0; i < ls.length; i++) if (ls[i].id === lineId) L = ls[i];
    var vals = sol.values[lineId];
    if (spec.meta.rule.base !== 'two-feature' && nameable(spec)) return L.label + ': ' + vals.join(', ');
    return L.label;
  }

  function explain(spec, trial) {
    var sol = solve(spec, trial), t;
    if (sol.targets.length) {
      t = sol.targets[0];
      var L = LINES[lsOf(spec)][lineIndex(lsOf(spec), t)];
      return { text: describeLine(spec, sol, t) + ' — ' + phrase(spec, t, true) + '.', line: t, cells: L.cells.slice() };
    }
    var where = spec.meta.rule.lines === 'plus-and-T' ? 'shape' : 'line';
    if (sol.near.length) {
      t = sol.near[0];
      var Ln = LINES[lsOf(spec)][lineIndex(lsOf(spec), t)];
      return { text: 'No ' + where + ' fits. Closest: ' + describeLine(spec, sol, t) + ' — ' + phrase(spec, t, false) + '.', line: null, cells: Ln.cells.slice() };
    }
    return { text: 'No ' + where + ' fits the rule.', line: null, cells: null };
  }

  var api = {
    id: 'rel.grid', gen: gen, solve: solve, explain: explain, params: params, tierOf: tierOf,
    LINES: LINES, VARIANTS: VARIANTS, FILLS: FILLS, RUNGS: RUNGS, TIERS: TIERS, TN: TN,
    /** Content variants, shared with stream.js. */
    content: {
      pick: function (opts, tier, seed) { return pickVariant(opts || {}, tier || 'T1', HF.rng.hash('rel.grid/' + String(seed == null ? '' : seed))); },
      size: alphaSize,
      display: function (v, map, idx) { return displaySym({ v: v, map: map }, idx); },
      cell: function (v, map, s3) {
        if (v.kind === 'text') return displaySym({ v: v, map: map }, s3[0]) + displaySym({ v: v, map: map }, s3[1]) + displaySym({ v: v, map: map }, s3[2]);
        return [displaySym({ v: v, map: map }, s3[0]), displaySym({ v: v, map: map }, s3[1]), displaySym({ v: v, map: map }, s3[2])];
      },
      order: function (v, seed) { return v.permute ? HF.rng.create('rel.grid.key/' + String(seed == null ? '' : seed)).shuffle(range(v.size)) : null; }
    },
    _internal: { parts: parts, eqTable: eqTable, keyDist: keyDist, judgeLines: judgeLines, judgeCount: judgeCount, lineCode: lineCode,
      makeCtx: makeCtx, buildBlock: buildBlock, fallbackTrials: fallbackTrials, toSpec: toSpec, assignEq: assignEq, assignAsc: assignAsc, buildStrings: buildStrings }
  };
  R.grid = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
