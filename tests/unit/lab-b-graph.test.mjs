// lab.graph — generator, isomorphism solver, drawings, cheap guessers, forms, scoring (SPEC §4.6).
import { HF, load, ROOT } from './load.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
load('js/lab/tests/graph.js');
const G = require(path.join(ROOT, 'js/lab/tests/graph.js'));

const N_ITEMS = 10000;
const TEMPLATES = G.BLUEPRINT_ITEMS.concat([G.CHECK_ITEM]);

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  let t0 = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t0 = Math.max(0, Math.min(1, t0));
  return Math.hypot(a.x + t0 * dx - p.x, a.y + t0 * dy - p.y);
}
function drawingOK(g) {
  const pts = g.nodes;
  for (const n of pts) if (n.x < 8 || n.x > 92 || n.y < 8 || n.y > 92) return 'node outside the box';
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 20) return 'nodes too close';
  for (const [u, v] of g.edges) for (const w of pts) if (w.id !== u && w.id !== v && segDist(w, pts[u], pts[v]) < 12) return 'edge passes a node';
  const seen = new Set();
  for (const [u, v] of g.edges) { if (u === v) return 'loop'; const k = u + ',' + v, r = v + ',' + u; if (seen.has(k) || seen.has(r)) return 'double or antiparallel edge'; seen.add(k); }
  return null;
}

export default async function (t) {
  const guess = { same: 0, sameChance: 0, degDirect: [0, 0], degIndirect: [0, 0], targets: 0 };
  await t.test('graph: 10,000 items map each marked node to exactly one right node (all isomorphisms)', () => {
    let fallback = 0;
    const rng = HF.rng.create('lab-b-graph-guess');
    for (let i = 0; i < N_ITEMS; i++) {
      const tpl = TEMPLATES[i % TEMPLATES.length];
      const item = G.genItem(tpl, 'unit-graph-' + i);
      if (item.meta.fallback) { fallback++; continue; }
      const sol = G.solve(item);
      t.ok(sol.ok && sol.isomorphisms >= 1, `item ${i}: ${JSON.stringify(sol.images)} vs ${item.answer}`);
      const L = item.stim.left, R = item.stim.right, n = L.nodes.length;
      t.eq(n, tpl.n); t.ok(L.edges.length >= tpl.m[0] && L.edges.length <= tpl.m[1], 'edge count in range');
      t.eq(L.targets.map(x => x.mark), [1, 2]); t.ok(L.targets[0].node !== L.targets[1].node, 'two different targets');
      t.eq(sol.isomorphisms, G.isomorphisms(n, L.edges, L.edges).length, 'iso count = automorphism count');
      const sig = G.signatures(n, L.edges);
      item.meta.targetTypes.forEach((ty, k) => {
        const unique = sig.filter(s => s === sig[L.targets[k].node]).length === 1;
        t.eq(ty, unique ? 'direct' : 'indirect', 'target type follows degree uniqueness');
      });
      if (tpl.ttype === 'mixed') t.eq(item.meta.targetTypes.slice().sort(), ['direct', 'indirect']);
      else t.eq(item.meta.targetTypes, [tpl.ttype, tpl.ttype]);
      const bad = drawingOK(L) || drawingOK(R);
      t.ok(!bad, `item ${i}: ${bad}`);
      t.ok(G.crossings(L.nodes, L.edges) <= tpl.crossL[1] && G.crossings(R.nodes, R.edges) <= tpl.crossR[1], 'crossings within bounds');
      if (!tpl.check) {
        for (let k = 0; k < 2; k++) {
          guess.targets++;
          if (G.shortcuts.samePlace(item, k) === item.answer[k]) guess.same++;
          guess.sameChance += 1 / n;
          const d = G.shortcuts.sameDegree(item, k, rng) === item.answer[k];
          const arr = item.meta.targetTypes[k] === 'direct' ? guess.degDirect : guess.degIndirect;
          arr[0] += d ? 1 : 0; arr[1]++;
        }
      }
    }
    t.eq(fallback, 0, 'no fallbacks needed');
  });

  await t.test('graph: position copying stays near chance; degree alone fails on indirect targets', () => {
    const same = guess.same / guess.targets, chance = guess.sameChance / guess.targets;
    t.ok(same <= chance + 0.04, `same-place ${same.toFixed(3)} vs chance ${chance.toFixed(3)}`);
    t.eq(guess.degDirect[0], guess.degDirect[1], 'degree pair identifies direct targets (by definition)');
    const di = guess.degIndirect[0] / guess.degIndirect[1];
    t.ok(di <= 0.55, `degree guess on indirect targets ${di.toFixed(3)}`);
    console.log(`  lab.graph guessers over ${guess.targets} targets: same place ${(100 * same).toFixed(1)}% (chance ${(100 * chance).toFixed(1)}%), same degree: direct 100%, indirect ${(100 * di).toFixed(1)}%`);
  });

  await t.test('graph: right drawings are never rotated or mirrored copies of the left ones', () => {
    const grid = [18, 50, 82];
    const slot = p => grid.indexOf(grid.reduce((a, b) => Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a)) +
      3 * grid.indexOf(grid.reduce((a, b) => Math.abs(b - p.y) < Math.abs(a - p.y) ? b : a));
    const tf = [(r, c) => [r, c], (r, c) => [c, 2 - r], (r, c) => [2 - r, 2 - c], (r, c) => [2 - c, r], (r, c) => [r, 2 - c], (r, c) => [2 - r, c], (r, c) => [c, r], (r, c) => [2 - c, 2 - r]];
    for (let i = 0; i < 1500; i++) {
      const item = G.genItem(G.BLUEPRINT_ITEMS[i % 16], 'cong-' + i);
      const L = item.stim.left, R = item.stim.right, n = L.nodes.length;
      for (const f of G.isomorphisms(n, L.edges, R.edges)) {
        for (const T of tf) {
          const copy = L.nodes.every(p => { const s = slot(p), q = T(Math.floor(s / 3), s % 3); return q[0] * 3 + q[1] === slot(R.nodes[f[p.id]]); });
          t.ok(!copy, 'congruent drawing in item ' + i);
        }
      }
    }
  });

  await t.test('graph: forms A–D follow one blueprint', () => {
    const forms = ['A', 'B', 'C', 'D'].map(f => G.gen({ form: f }));
    for (const s of forms) {
      t.eq(s.trials.length, 17); t.ok(s.release); t.eq(s.meta.fallback.length, 0);
      t.eq(s.trials.map(x => x.check), forms[0].trials.map(x => x.check));
      t.eq(s.trials.findIndex(x => x.check), 8);
      t.eq(s.trials.map(x => x.meta.n + x.meta.ttype), forms[0].trials.map(x => x.meta.n + x.meta.ttype));
      for (const x of s.trials) t.ok(G.solve(x).ok);
      t.eq([s.windowMs, s.warnMs], [24000, 19000]);
      t.eq(s.practice.length, 2);
    }
    const meanM = forms.map(s => s.trials.filter(x => !x.check).reduce((a, x) => a + x.meta.m, 0) / 16);
    t.ok(Math.max(...meanM) - Math.min(...meanM) <= 0.5, 'mean edge count within 0.5 across forms ' + meanM.join(' '));
    t.eq(JSON.stringify(G.gen({ form: 'A' })), JSON.stringify(forms[0]), 'deterministic');
    t.ok(JSON.stringify(forms[0].trials) !== JSON.stringify(forms[2].trials));
    const p = G.practice();
    t.eq(p.form, 'P'); t.eq(p.trials.length, 2);
    for (const x of p.trials) t.ok(G.solve(x).ok);
    const chk = forms[0].trials[8];
    t.eq(chk.stim.left.nodes.map(q => [q.x, q.y]), chk.stim.right.nodes.map(q => [q.x, q.y]), 'check item: identical drawings');
  });

  await t.test('graph: scoring with hand-built logs', () => {
    const spec = G.gen({ form: 'B' });
    const sc = spec.trials.filter(x => !x.check), chk = spec.trials.find(x => x.check);
    const other = (x, k) => (x.answer[k] + 1) % x.meta.n;
    const answers = [];
    sc.forEach((x, k) => {
      if (k < 9) answers.push({ i: x.i, response: x.answer.slice(), rt: 7000, voided: false });
      else if (k === 9) answers.push({ i: x.i, response: [x.answer[0], other(x, 1)], rt: 7000, voided: false });     // one of two
      else if (k === 10) answers.push({ i: x.i, response: [x.answer[1], x.answer[0]], rt: 7000, voided: false });      // swapped
      else if (k === 11) answers.push({ i: x.i, response: [x.answer[0], null], rt: null, voided: false, timedOut: true }); // half, timed out
      else if (k === 12) answers.push({ i: x.i, response: null, rt: null, voided: false, timedOut: true });
      else if (k === 13) answers.push({ i: x.i, response: x.answer.slice(), rt: 5000, voided: true });
      // 14, 15 missing
    });
    answers.push({ i: chk.i, response: [chk.answer[1], chk.answer[0]], rt: 3000, voided: false });
    const r = G.score(spec, { answers });
    t.near(r.score, 9 / 13, 1e-12);
    t.eq([r.sub.correct, r.sub.n, r.sub.nItems, r.sub.timeouts, r.sub.voided, r.sub.missing], [9, 13, 16, 2, 1, 2]);
    t.eq([r.sub.targetsCorrect, r.sub.targetsN], [9 * 2 + 1 + 1, 13 * 2]);
    t.eq(r.sub.checks, { n: 1, failed: 1 });
    t.eq(r.flags.sort(), ['check-failed', 'incomplete']);
    t.eq([r.testId, r.form, r.version], ['lab.graph', 'B', 1]);
    const rows = G.rows(spec, { answers });
    t.eq(rows.length, 17);
    t.eq(rows.filter(x => x.correct === true).length, 9);
    t.eq(rows.find(x => x.i === sc[9].i).targetsCorrect, 1);
    t.eq(rows.find(x => x.i === sc[10].i).targetsCorrect, 0);
    t.eq(rows.find(x => x.i === sc[11].i).timedOut, true, 'a half answer that timed out is a timeout');
    t.eq(rows.find(x => x.i === sc[11].i).targetsCorrect, 1, '…with its placed node credited');
    t.eq(rows.find(x => x.i === sc[11].i).correct, false);
    const strs = sc.map(x => ({ i: x.i, response: x.answer.map(String), rt: 8000, voided: false }));
    t.eq(G.score(spec, { answers: strs }).score, 1, 'string node ids accepted');
  });
}
