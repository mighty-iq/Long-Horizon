/* Long-Horizon Lab — lab.graph: Graph Mapping. Pure module (no DOM, deterministic per seed). MIT licence.

   Paradigm: Jastrzębski, Ociepka & Chuderski (2023, BRM 55:448–460): two isomorphic directed graphs drawn differently;
   find, in the right graph, the nodes that correspond to the highlighted nodes of the left graph. Re-implemented from
   the published description (our own code and layouts; the authors' PsychoPy software is not used). As in the paper,
   each item highlights TWO left nodes (marks 1 and 2); the format also accepts one. Full notes: docs/dev/lab-items.md.

   API (registered with HF.lab.register, or queued in HF.labPending; exported for node):
     gen({ form: 'A'|'B'|'C'|'D', seed? }) → TestSpec     omit seed in real visits (fixed release form)
     score(spec, log) → TestResult                        rows(spec, log) → [ExportRow]
     practice() → TestSpec (form 'P', practice: true)    2 fixed, unscored items shown at every visit
     solve(item) → { ok, isomorphisms, images: [[rightIds]] }   all isomorphisms by backtracking; each target must
                                                          have exactly one image, equal to the answer
     genItem(template, seedString) → Item; BLUEPRINT_ITEMS; isomorphisms(n, edgesA, edgesB); shortcuts.*

   TestSpec (SPEC §4.3 discrete shape, extended):
     { kind: 'discrete', task: 'lab', testId: 'lab.graph', trackId: 'lab.graph', form, seed, release, blueprint: 'graph-1',
       set: 'labGraph', rung: null, params: { nScored: 16, nChecks: 1, targetsPerItem: 2 }, windowMs: 24000, warnMs: 19000,
       itiMs: 500, tooFastMs: 1500, practice: [Trial], trials: [Trial], meta: { solverChecked: true, fallback: [] } }
     Trial = { i, check: bool, stim: Stim, answer: [rightNodeId for mark 1, rightNodeId for mark 2], meta: ItemMeta }
     Stim  = { nodeR: 7,
               left:  { nodes: [ { id, x, y } ], edges: [ [from, to] ], targets: [ { node: leftId, mark: 1 }, { node, mark: 2 } ] },
               right: { nodes: [ { id, x, y } ], edges: [ [from, to] ] } }
             x, y in a 0–100 box per graph; edges are directed (draw an arrowhead at `to`, stopping at the node rim).
             Marks: draw the number in the node AND a distinct outline (ring for 1, square for 2) — never colour alone.
     ItemMeta = { template, n, m, ttype: 'direct'|'mixed'|'indirect', targetTypes: [..], autSize, crossL, crossR }
             direct = the target's (in, out) degree pair is unique in the graph; indirect = shared with another node, so
             it must be told apart through its neighbours.
   Log (SPEC §4.3): { answers: [ { i, response: [rightId|null, rightId|null] | null, rt: ms | null, voided: bool, timedOut?: bool } ], paused }
             (the view asks for mark 1's counterpart, then mark 2's; a node may be changed until the item is submitted).
             A timed-out item is wrong; nodes already placed still count in sub.targetsCorrect (partial credit).
   TestResult: { score: proportion of items with both targets right (timeouts wrong, voided excluded), scoreLabel,
                 sub: { correct, n, nItems, targetsCorrect, targetsN, timeouts, voided, missing, byType, checks, medianRtCorrect }, flags }
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var TEST_ID = 'lab.graph';
  var BLUEPRINT = 'graph-1';
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
  var PRACTICE_SEED = 'holdfast-lab1/graph/practice';
  var MAX_ATTEMPTS = 400;
  var WINDOW_MS = 24000, WARN_MS = 19000, ITI_MS = 500, TOO_FAST_MS = 1500;
  var NODE_R = 7, CLEAR = 12, GRID = [18, 50, 82], JITTER = 4;

  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  // ---------------------------------------------------------------- graph basics
  function adjacency(n, edges) {
    var A = [];
    for (var i = 0; i < n; i++) { A.push([]); for (var j = 0; j < n; j++) A[i].push(0); }
    edges.forEach(function (e) { A[e[0]][e[1]] = 1; });
    return A;
  }
  function signatures(n, edges) {
    var inD = range(n).map(function () { return 0; }), outD = inD.slice();
    edges.forEach(function (e) { outD[e[0]]++; inD[e[1]]++; });
    return range(n).map(function (u) { return inD[u] + ':' + outD[u]; });
  }
  /** All bijections f with (u,v) ∈ A ⇔ (f(u), f(v)) ∈ B, by backtracking with degree-pair pruning. */
  function isomorphisms(n, EA, EB, limit) {
    if (EA.length !== EB.length) return [];
    var A = adjacency(n, EA), B = adjacency(n, EB), sA = signatures(n, EA), sB = signatures(n, EB);
    var f = new Array(n), used = range(n).map(function () { return false; }), out = [], cap = limit || 100000;
    (function rec(i) {
      if (out.length >= cap) return;
      if (i === n) { out.push(f.slice()); return; }
      for (var c = 0; c < n; c++) {
        if (used[c] || sA[i] !== sB[c]) continue;
        var ok = true;
        for (var j = 0; j < i && ok; j++) if (A[i][j] !== B[c][f[j]] || A[j][i] !== B[f[j]][c]) ok = false;
        if (!ok) continue;
        used[c] = true; f[i] = c; rec(i + 1); used[c] = false;
      }
    })(0);
    return out;
  }
  function weaklyConnected(n, edges) {
    var adj = range(n).map(function () { return []; });
    edges.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    var seen = [0], stack = [0];
    while (stack.length) { var u = stack.pop(); adj[u].forEach(function (v) { if (seen.indexOf(v) < 0) { seen.push(v); stack.push(v); } }); }
    return seen.length === n;
  }
  /** Weakly connected digraph, n nodes, m edges, no loops, no antiparallel pairs. */
  function randomDigraph(n, m, rng) {
    if (m < n - 1 || m > n * (n - 1) / 2) return null;
    var order = rng.shuffle(range(n)), edges = [], has = {};
    function add(u, v) { if (u === v || has[u + ',' + v] || has[v + ',' + u]) return false; has[u + ',' + v] = 1; edges.push([u, v]); return true; }
    for (var i = 1; i < n; i++) {
      var u = order[i], v = order[rng.int(0, i - 1)];
      if (rng.chance(0.5)) add(u, v); else add(v, u);
    }
    var tries = 0;
    while (edges.length < m && tries < 300) { add(rng.int(0, n - 1), rng.int(0, n - 1)); tries++; }
    return edges.length === m && weaklyConnected(n, edges) ? edges : null;
  }

  // ---------------------------------------------------------------- drawing
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    var t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return Math.sqrt(x * x + y * y);
  }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function properCross(p1, p2, p3, p4) {
    var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function crossings(pts, edges) {
    var c = 0;
    for (var i = 0; i < edges.length; i++) for (var j = i + 1; j < edges.length; j++) {
      var a = edges[i], b = edges[j];
      if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
      if (properCross(pts[a[0]], pts[a[1]], pts[b[0]], pts[b[1]])) c++;
    }
    return c;
  }
  function clearOK(pts, edges) {
    for (var e = 0; e < edges.length; e++) {
      var a = pts[edges[e][0]], b = pts[edges[e][1]];
      for (var w = 0; w < pts.length; w++) {
        if (w === edges[e][0] || w === edges[e][1]) continue;
        if (segDist(pts[w], a, b) < CLEAR) return false;
      }
    }
    return true;
  }
  /** Node positions on a jittered 3 × 3 grid; every edge clears every other node; crossings within [lo, hi]. */
  function layout(n, edges, rng, lo, hi) {
    for (var t = 0; t < 120; t++) {
      var slots = rng.sample(range(9), n);
      var pts = slots.map(function (s) {
        return { x: GRID[s % 3] + rng.int(-JITTER, JITTER), y: GRID[Math.floor(s / 3)] + rng.int(-JITTER, JITTER), slot: s };
      });
      if (!clearOK(pts, edges)) continue;
      var c = crossings(pts, edges);
      if (c < lo || c > hi) continue;
      return { pts: pts, crossings: c };
    }
    return null;
  }
  // the 8 symmetries of the 3 × 3 slot grid (as slot → slot maps)
  var DIHEDRAL = (function () {
    var maps = [], tf = [
      function (r, c) { return [r, c]; }, function (r, c) { return [c, 2 - r]; }, function (r, c) { return [2 - r, 2 - c]; },
      function (r, c) { return [2 - c, r]; }, function (r, c) { return [r, 2 - c]; }, function (r, c) { return [2 - r, c]; },
      function (r, c) { return [c, r]; }, function (r, c) { return [2 - c, 2 - r]; }];
    tf.forEach(function (f) { maps.push(range(9).map(function (s) { var p = f(Math.floor(s / 3), s % 3); return p[0] * 3 + p[1]; })); });
    return maps;
  })();
  /** True if the right drawing is a rotated/mirrored copy of the left one under some isomorphism. */
  function congruent(slotsL, slotsR, isos) {
    return isos.some(function (f) {
      return DIHEDRAL.some(function (D) { return slotsL.every(function (s, u) { return D[s] === slotsR[f[u]]; }); });
    });
  }

  // ---------------------------------------------------------------- blueprint graph-1 (identical for forms A–D)
  function T(n, m, ttype, crossL, crossR) { return { n: n, m: m, ttype: ttype, crossL: crossL, crossR: crossR }; }
  var BLUEPRINT_ITEMS = [
    T(4, [3, 4], 'direct', [0, 0], [0, 1]), T(4, [3, 4], 'direct', [0, 0], [0, 1]), T(4, [4, 4], 'direct', [0, 0], [0, 1]),
    T(4, [4, 5], 'mixed', [0, 0], [0, 1]), T(5, [4, 5], 'direct', [0, 0], [0, 1]), T(5, [5, 5], 'mixed', [0, 0], [0, 1]),
    T(5, [5, 6], 'mixed', [0, 1], [0, 2]), T(5, [5, 6], 'indirect', [0, 1], [0, 2]),
    T(5, [6, 6], 'mixed', [0, 1], [1, 2]), T(5, [6, 7], 'indirect', [0, 1], [1, 2]), T(6, [5, 6], 'mixed', [0, 1], [1, 2]),
    T(6, [6, 6], 'indirect', [0, 1], [1, 2]), T(6, [6, 7], 'indirect', [0, 1], [1, 2]), T(6, [7, 7], 'indirect', [0, 1], [1, 3]),
    T(6, [7, 7], 'indirect', [0, 2], [1, 3]), T(6, [7, 7], 'indirect', [0, 2], [1, 3])
  ];
  var CHECK_ITEM = { n: 3, m: [2, 2], ttype: 'direct', crossL: [0, 0], crossR: [0, 0], check: true };
  var CHECK_AFTER = [8];
  var PRACTICE_ITEMS = [T(3, [3, 3], 'direct', [0, 0], [0, 0]), T(4, [4, 4], 'mixed', [0, 0], [0, 1])];
  var INSTRUCTIONS = 'The two drawings show the same network of arrows, drawn differently. Find the dots on the right ' +
    'that play the same part as the dots marked 1 and 2 on the left: tap the match for 1, then the match for 2. ' +
    'Count the arrows going in and out, and look at the neighbours. You have 24 seconds per item.';

  // ---------------------------------------------------------------- solver (stimulus only)
  function solve(item) {
    var L = item.stim.left, R = item.stim.right, n = L.nodes.length;
    if (R.nodes.length !== n) return { ok: false, isomorphisms: 0, images: [] };
    var isos = isomorphisms(n, L.edges, R.edges);
    var images = L.targets.map(function (t) {
      var im = [];
      isos.forEach(function (f) { if (im.indexOf(f[t.node]) < 0) im.push(f[t.node]); });
      return im;
    });
    var ok = isos.length > 0 && images.every(function (im, k) { return im.length === 1 && im[0] === item.answer[k]; });
    return { ok: ok, isomorphisms: isos.length, images: images };
  }

  // ---------------------------------------------------------------- generator
  function tryBuild(tpl, rng) {
    var n = tpl.n, m = rng.int(tpl.m[0], tpl.m[1]);
    var E = randomDigraph(n, m, rng);
    if (!E) return null;
    var aut = isomorphisms(n, E, E);
    var sig = signatures(n, E);
    var fixed = range(n).filter(function (u) { return aut.every(function (f) { return f[u] === u; }); });
    var direct = fixed.filter(function (u) { return sig.filter(function (s) { return s === sig[u]; }).length === 1; });
    var indirect = fixed.filter(function (u) { return direct.indexOf(u) < 0; });
    var targets;
    if (tpl.ttype === 'direct') { if (direct.length < 2) return null; targets = rng.sample(direct, 2); }
    else if (tpl.ttype === 'indirect') { if (indirect.length < 2) return null; targets = rng.sample(indirect, 2); }
    else { if (!direct.length || !indirect.length) return null; targets = rng.shuffle([rng.pick(direct), rng.pick(indirect)]); }

    var Ld = layout(n, E, rng, tpl.crossL[0], tpl.crossL[1]);
    if (!Ld) return null;
    var pi = tpl.check ? range(n) : rng.shuffle(range(n));
    var ER = rng.shuffle(E.map(function (e) { return [pi[e[0]], pi[e[1]]]; }));
    var Rd;
    if (tpl.check) {
      Rd = { pts: range(n).map(function (r) { return Ld.pts[pi.indexOf(r)]; }), crossings: Ld.crossings };
    } else {
      Rd = layout(n, ER, rng, tpl.crossR[0], tpl.crossR[1]);
      if (!Rd) return null;
      var isoLR = isomorphisms(n, E, ER);
      var slotsL = Ld.pts.map(function (p) { return p.slot; }), slotsR = Rd.pts.map(function (p) { return p.slot; });
      if (congruent(slotsL, slotsR, isoLR)) return null;
    }
    var nodes = function (pts) { return pts.map(function (p, id) { return { id: id, x: p.x, y: p.y }; }); };
    var item = {
      stim: {
        nodeR: NODE_R,
        left: { nodes: nodes(Ld.pts), edges: E.map(function (e) { return e.slice(); }), targets: targets.map(function (u, k) { return { node: u, mark: k + 1 }; }) },
        right: { nodes: nodes(Rd.pts), edges: ER }
      },
      answer: targets.map(function (u) { return pi[u]; }),
      meta: { n: n, m: m, ttype: tpl.ttype, targetTypes: targets.map(function (u) { return direct.indexOf(u) >= 0 ? 'direct' : 'indirect'; }),
              autSize: aut.length, crossL: Ld.crossings, crossR: Rd.crossings }
    };
    return solve(item).ok ? item : null;
  }
  function fallbackItem() {
    // Deterministic and valid: 0→1, 1→2, 2→3 (a path); right graph relabelled 0↔3, 1↔2 and drawn on another diagonal.
    var E = [[0, 1], [1, 2], [2, 3]], pi = [3, 2, 1, 0];
    return {
      stim: { nodeR: NODE_R,
        left: { nodes: [{ id: 0, x: 18, y: 18 }, { id: 1, x: 50, y: 18 }, { id: 2, x: 50, y: 50 }, { id: 3, x: 82, y: 82 }], edges: E,
                targets: [{ node: 1, mark: 1 }, { node: 3, mark: 2 }] },
        right: { nodes: [{ id: 0, x: 18, y: 82 }, { id: 1, x: 50, y: 50 }, { id: 2, x: 82, y: 50 }, { id: 3, x: 82, y: 18 }],
                 edges: E.map(function (e) { return [pi[e[0]], pi[e[1]]]; }) } },
      answer: [pi[1], pi[3]],
      meta: { n: 4, m: 3, ttype: 'direct', targetTypes: ['direct', 'direct'], autSize: 1, crossL: 0, crossR: 0, fallback: true }
    };
  }
  function genItem(tpl, seedString) {
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var item = tryBuild(tpl, HF.rng.create(seedString + '#' + attempt));
      if (item) { item.meta.attempts = attempt + 1; return item; }
    }
    return fallbackItem();
  }
  function sequence() {
    var seq = [];
    BLUEPRINT_ITEMS.forEach(function (tpl, idx) {
      seq.push({ tpl: tpl, template: idx + 1 });
      if (CHECK_AFTER.indexOf(idx + 1) >= 0) seq.push({ tpl: CHECK_ITEM, template: 'check' });
    });
    return seq;
  }
  function gen(opts) {
    opts = opts || {};
    var form = opts.form || 'A';
    if (form === 'P') return practice(opts);
    if (FORMS.indexOf(form) < 0) throw new Error('lab.graph.gen: form must be A, B, C or D');
    var seed = opts.seed != null && opts.seed !== '' ? String(opts.seed) : defaultSeed(form);
    var release = seed === defaultSeed(form);
    var fallback = [];
    var trials = sequence().map(function (s, i) {
      var item = genItem(s.tpl, seed + '/item' + i);
      item.meta.template = s.template;
      if (item.meta.fallback) fallback.push({ i: i, template: s.template });
      return { i: i, check: s.template === 'check', stim: item.stim, answer: item.answer, meta: item.meta };
    });
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: form, seed: seed, release: release, version: VERSION,
      blueprint: BLUEPRINT, set: 'labGraph', rung: null,
      params: { nScored: BLUEPRINT_ITEMS.length, nChecks: CHECK_AFTER.length, targetsPerItem: 2 },
      windowMs: WINDOW_MS, warnMs: WARN_MS, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS, instructions: INSTRUCTIONS,
      practice: practiceItems(), trials: trials, meta: { solverChecked: true, fallback: fallback }
    };
  }
  var practiceCache = null;
  function practiceItems() {
    if (!practiceCache) {
      practiceCache = PRACTICE_ITEMS.map(function (tpl, i) {
        var item = genItem(tpl, PRACTICE_SEED + '/' + i);
        item.meta.template = 'practice' + (i + 1);
        return { i: i, practice: true, check: false, stim: item.stim, answer: item.answer, meta: item.meta };
      });
    }
    return JSON.parse(JSON.stringify(practiceCache));
  }
  /** practice({ seed? }) → TestSpec: 2 fixed unscored items, identical at every visit (seed ignored); 60 s each. */
  function practice() {
    return {
      kind: 'discrete', task: 'lab', testId: TEST_ID, trackId: TEST_ID, form: 'P', seed: PRACTICE_SEED, release: true, version: VERSION,
      blueprint: BLUEPRINT, set: 'labGraph', rung: null, practice: true, params: { nScored: 0, nChecks: 0, targetsPerItem: 2 },
      windowMs: 60000, warnMs: 55000, itiMs: ITI_MS, tooFastMs: TOO_FAST_MS, instructions: INSTRUCTIONS,
      trials: practiceItems(), meta: { solverChecked: true, fallback: [] }
    };
  }

  // ---------------------------------------------------------------- cheap guessers (tests)
  var shortcuts = {
    /** the right node drawn closest to where the target sits on the left */
    samePlace: function (item, k) {
      var t = item.stim.left.nodes[item.stim.left.targets[k].node], best = null, bd = Infinity;
      item.stim.right.nodes.forEach(function (p) { var d = Math.hypot(p.x - t.x, p.y - t.y); if (d < bd) { bd = d; best = p.id; } });
      return best;
    },
    /** a random right node with the same in/out degree pair (exactly right for direct targets, by design) */
    sameDegree: function (item, k, rng) {
      var L = item.stim.left, R = item.stim.right, n = L.nodes.length;
      var sL = signatures(n, L.edges), sR = signatures(n, R.edges), want = sL[L.targets[k].node];
      var c = range(n).filter(function (v) { return sR[v] === want; });
      return c.length ? rng.pick(c) : rng.int(0, n - 1);
    }
  };

  // ---------------------------------------------------------------- scoring
  function indexAnswers(log) {
    var by = {};
    ((log && log.answers) || []).forEach(function (a) { if (a && a.i != null && !by[a.i]) by[a.i] = a; });
    return by;
  }
  function respArray(a) { return a && Array.isArray(a.response) ? a.response : null; }
  function isTimeout(a) {
    var r = respArray(a);
    return !!a.timedOut || !r || r.every(function (x) { return x === null || x === undefined; });
  }
  function hitsOf(t, a) {
    var r = respArray(a) || [];
    return t.answer.map(function (ans, k) { return r[k] !== null && r[k] !== undefined && Number(r[k]) === ans; });
  }
  function score(spec, log) {
    var by = indexAnswers(log), st = HF.stats;
    var nItems = 0, n = 0, correct = 0, tc = 0, tn = 0, timeouts = 0, voided = 0, missing = 0, tooFast = 0, rts = [];
    var byType = {}, checks = { n: 0, failed: 0 };
    spec.trials.forEach(function (t) {
      var a = by[t.i];
      if (t.check) {
        if (a && !a.voided) { checks.n++; if (!hitsOf(t, a).every(Boolean)) checks.failed++; }
        return;
      }
      nItems++;
      if (!a) { missing++; return; }
      if (a.voided) { voided++; return; }
      n++;
      var b = byType[t.meta.ttype] || (byType[t.meta.ttype] = { correct: 0, n: 0 });
      b.n++;
      tn += t.answer.length;
      var hits = hitsOf(t, a);
      hits.forEach(function (h) { if (h) tc++; });          // partial credit counts nodes placed before a timeout too
      if (isTimeout(a)) { timeouts++; return; }               // …but a timed-out item is wrong
      if (typeof a.rt === 'number' && a.rt < (spec.tooFastMs || TOO_FAST_MS)) tooFast++;
      if (hits.every(Boolean)) { correct++; b.correct++; if (typeof a.rt === 'number') rts.push(a.rt); }
    });
    var flags = [];
    if (missing > 0) flags.push('incomplete');
    if (nItems && voided / nItems > 0.10) flags.push('many-voided');
    if (tooFast >= 3) flags.push('too-fast');
    if (checks.failed > 0) flags.push('check-failed');
    return stamp(spec, {
      testId: TEST_ID, score: n ? correct / n : null, scoreLabel: correct + ' of ' + n + ' correct',
      higherIsBetter: true, unit: 'proportion',
      sub: { correct: correct, n: n, nItems: nItems, targetsCorrect: tc, targetsN: tn, timeouts: timeouts, voided: voided,
             missing: missing, tooFast: tooFast, byType: byType, checks: checks, medianRtCorrect: rts.length ? st.median(rts) : null,
             form: spec.form, blueprint: spec.blueprint, release: !!spec.release, paused: !!(log && log.paused) },
      flags: flags
    });
  }
  function rows(spec, log) {
    var by = indexAnswers(log);
    return spec.trials.map(function (t) {
      var a = by[t.i] || null, to = a ? isTimeout(a) : null, hits = a && !a.voided ? hitsOf(t, a) : null;
      return {
        test: TEST_ID, form: spec.form, blueprint: spec.blueprint, seed: spec.seed, i: t.i, check: !!t.check,
        template: t.meta.template, n: t.meta.n, m: t.meta.m, ttype: t.meta.ttype, crossR: t.meta.crossR,
        answer: t.answer.join(' '), response: a && respArray(a) ? respArray(a).map(function (x) { return x == null ? '-' : x; }).join(' ') : null,
        targetsCorrect: hits ? hits.filter(Boolean).length : null,
        correct: a && !a.voided ? !to && hits.every(Boolean) : null,
        rt: a ? (a.rt == null ? null : a.rt) : null, timedOut: a ? to && !a.voided : null, voided: a ? !!a.voided : null
      };
    });
  }

  var test = {
    id: TEST_ID, label: 'Graph Mapping', paradigm: 'Graph Mapping (Jastrzębski, Ociepka & Chuderski 2023)',
    minutes: 5, defaultLevel: 'far', higherIsBetter: true, unit: 'proportion', exploratory: false,
    blueprint: BLUEPRINT, formSeed: defaultSeed, part: 'B', version: VERSION, instructions: INSTRUCTIONS,
    gen: gen, score: score, rows: rows, practice: practice, solve: solve,
    genItem: genItem, isomorphisms: isomorphisms, signatures: signatures, crossings: crossings,
    BLUEPRINT_ITEMS: BLUEPRINT_ITEMS, CHECK_ITEM: CHECK_ITEM, shortcuts: shortcuts
  };
  if (HF.lab && HF.lab.register) HF.lab.register(test); else (HF.labPending = HF.labPending || []).push(test);
  if (typeof module === 'object' && module.exports) module.exports = test;
})(typeof window !== 'undefined' ? window : globalThis);
