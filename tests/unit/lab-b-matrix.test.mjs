// lab.matrix — generator, solver, shortcut pickers, form equivalence, scoring (SPEC §4.6, research/04 §11).
import { HF, load, ROOT } from './load.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
load('js/lab/tests/matrix.js');
const M = require(path.join(ROOT, 'js/lab/tests/matrix.js'));

const N_ITEMS = 10000;
const TEMPLATES = M.BLUEPRINT_ITEMS.concat([M.CHECK_ITEM], M.TUTORIAL_ITEMS);

function ruleSlotVaries(item, slot) {
  const vals = item.stim.cells.map(c => M.perceive(item.stim.layout, c)[slot]);
  return new Set(vals.map(String)).size > 1;
}

export default async function (t) {
  // pickers are tallied on the scored pool (the 18 blueprint templates) and, separately, on the unscored
  // attention checks and tutorial items (trivial by design: every cell identical / worked examples)
  const stats = { n: 0, fallback: 0, pickers: {}, nOther: 0, other: {} };
  for (const k of Object.keys(M.shortcuts)) { stats.pickers[k] = 0; stats.other[k] = 0; }

  await t.test('matrix: 10,000 generated items each have exactly one option that fits every rule (solver)', () => {
    const rng = HF.rng.create('lab-b-matrix-pickers');
    for (let i = 0; i < N_ITEMS; i++) {
      const tpl = TEMPLATES[i % TEMPLATES.length];
      const item = M.genItem(tpl, 'unit-matrix-' + i, i % 8);
      if (item.meta.fallback) { stats.fallback++; continue; }
      const sol = M.solve(item);
      t.ok(sol.ok, `item ${i}: solver not ok ${JSON.stringify({ a: sol.ambiguous, u: sol.unexplained, m: sol.matches, d: sol.distinct })}`);
      t.eq(sol.matches, [item.answer], `item ${i}: unique match is the keyed answer`);
      t.eq(item.stim.cells.length, 8); t.eq(item.stim.options.length, 8);
      for (const r of item.meta.rules) t.ok(ruleSlotVaries(item, r.slot), `item ${i}: rule slot ${r.slot} does not vary`);
      for (const cell of item.stim.cells.concat(item.stim.options)) {
        for (const s of cell.shapes) {
          t.ok(!('color' in s) && !('colour' in s), 'no colour attribute anywhere');
          t.ok(s.x - s.r >= 0 && s.x + s.r <= 100 && s.y - s.r >= 0 && s.y + s.r <= 100, `item ${i}: shape inside the cell`);
          t.ok(M.FILLS.indexOf(s.fill) >= 0 && M.SHAPES[s.type], 'known fill and type');
          if (s.rot % 360 !== 0) t.eq(M.SHAPES[s.type].sym, 1, `item ${i}: only asymmetric shapes are rotated`);
        }
      }
      // perceptual constraints: fill judged only where the pattern is visible; size never compared across shape types
      const used = {}; item.meta.rules.forEach(r => { used[r.slot] = 1; }); item.meta.split.forEach(sl => { used[sl] = 1; });
      const all = item.stim.cells.concat(item.stim.options);
      const compOf = sh => item.stim.layout === 'pair' ? (sh.x < 50 ? 0 : 1) : 0;
      for (let k = 0; k < 2; k++) {
        const shapes = [].concat(...all.map(c => c.shapes.filter(sh => compOf(sh) === k)));
        if (used['c' + k + '.fill']) t.ok(shapes.every(sh => M.SHAPES[sh.type].fw * sh.r / 45 >= M.FILL_MIN), `item ${i}: fill visible`);
        if (used['c' + k + '.size']) t.eq(new Set(shapes.map(sh => sh.type)).size, 1, `item ${i}: size varies on one shape type only`);
      }
      const scored = M.BLUEPRINT_ITEMS.indexOf(tpl) >= 0;
      if (!scored) stats.nOther++;
      for (const k of Object.keys(M.shortcuts)) {
        if (M.shortcuts[k](item, rng) !== item.answer) continue;
        if (scored) stats.pickers[k]++; else stats.other[k]++;
      }
    }
    t.eq(stats.fallback, 0, 'no deterministic fallbacks needed');
  });

  await t.test('matrix: answer-only shortcuts score at chance (≤ 20 % with 8 options) on the scored pool', () => {
    const nScored = N_ITEMS - stats.nOther;
    const rate = k => stats.pickers[k] / nScored;
    for (const k of ['majority', 'oddOneOut', 'centroid', 'numericOdd', 'numericCentroid']) {
      t.ok(rate(k) <= 0.20, `${k} ${rate(k).toFixed(3)}`);
      t.ok(rate(k) >= 0.08, `${k} suspiciously low ${rate(k).toFixed(3)} (anti-cue)`);
    }
    // uses the matrix as well (not answer-only): distractor values are taken from the matrix itself
    t.ok(rate('contextPresence') <= 0.20, `contextPresence ${rate('contextPresence').toFixed(3)}`);
    console.log('  lab.matrix shortcuts over ' + nScored + ' scored-pool items: ' +
      Object.keys(stats.pickers).map(k => k + ' ' + (100 * rate(k)).toFixed(1) + '%').join(', ') +
      ' | unscored checks + tutorial (' + stats.nOther + '): contextPresence ' + (100 * stats.other.contextPresence / stats.nOther).toFixed(0) + '%');
  });

  await t.test('matrix: every template obeys the blueprint rules', () => {
    for (const tpl of TEMPLATES) t.eq(M.templateProblems(tpl), [], JSON.stringify(tpl.rules));
    t.ok(M.templateProblems({ layout: 'one', rules: [{ slot: 'c0.size' }, { slot: 'c0.type' }], split: [['c0.fill', 8]] }).length === 1);
    t.throws(() => M.genItem({ layout: 'one', rules: [], split: [['c0.fill', 2]], plaus: 'far' }, 'x', 0), 'bad template throws');
  });

  await t.test('matrix: the solver rejects corrupted items', () => {
    const item = M.genItem(M.BLUEPRINT_ITEMS[12], 'corrupt', 3);
    const dup = JSON.parse(JSON.stringify(item));
    dup.stim.options[0] = dup.stim.options[1];
    t.ok(!M.solve(dup).ok, 'duplicate options rejected');
    const two = JSON.parse(JSON.stringify(item));
    two.stim.options[(item.answer + 1) % 8] = JSON.parse(JSON.stringify(item.stim.options[item.answer]));
    t.ok(!M.solve(two).ok, 'two fitting options rejected');
    const odd = JSON.parse(JSON.stringify(item));
    odd.stim.cells[0].shapes[0].type = 'nonsense';
    t.ok(!M.solve(odd).ok, 'unknown shape rejected');
  });

  await t.test('matrix: forms A–D are blueprint-matched, deterministic and distinct', () => {
    const forms = ['A', 'B', 'C', 'D'].map(f => M.gen({ form: f }));
    const feat = tr => [tr.check, tr.meta.template, tr.meta.nRules, tr.meta.layout, tr.meta.plaus,
      tr.meta.rules.map(r => r.slot + ':' + r.rule + ':' + r.variant).join(' '), tr.meta.split.join(' ')].join('|');
    for (const s of forms) {
      t.eq(s.trials.length, 20); t.eq(s.trials.filter(x => x.check).length, 2);
      t.ok(s.release, 'default seed is the release form seed'); t.eq(s.meta.fallback.length, 0);
      t.eq(s.trials.map(feat), forms[0].trials.map(feat), 'same blueprint features at every position');
      const pos = {}; s.trials.forEach(x => { pos[x.answer] = (pos[x.answer] || 0) + 1; });
      t.ok(Object.keys(pos).length === 8 && Object.values(pos).every(c => c >= 2 && c <= 3), 'answer positions balanced ' + JSON.stringify(pos));
      t.eq(s.trials.map(x => x.meta.nRules).filter((_, i) => !s.trials[i].check), [1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4]);
      for (const x of s.trials) t.ok(M.solve(x).ok, 'form item solves');
    }
    t.eq(JSON.stringify(M.gen({ form: 'C' })), JSON.stringify(forms[2]), 'deterministic');
    t.ok(JSON.stringify(forms[0].trials) !== JSON.stringify(forms[1].trials), 'forms differ in content');
    const other = M.gen({ form: 'A', seed: 'not-the-release-seed' });
    t.ok(!other.release && other.seed === 'not-the-release-seed', 'explicit seed → non-release instance');

    // Simulated solvers (ability × rule type): equal expected accuracy across forms
    const acc = forms.map(s => {
      const r = HF.rng.create('sim-people');
      let sum = 0, n = 0;
      for (let p = 0; p < 300; p++) {
        const a = r.next() * 3 - 1.5;
        for (const tr of s.trials) {
          if (tr.check) continue;
          const sol = M.solve(tr), layout = tr.stim.layout;
          const known = Object.keys(sol.predictions).filter(slot => {
            const rule = tr.meta.rules.find(x => x.slot === slot);
            const diff = rule ? (rule.variant === 'same' ? 0 : 0.8) + 0.3 : -1.5;
            return r.next() < 1 / (1 + Math.exp(-(a + 1.2 - diff)));
          });
          const fit = tr.stim.options.map((o, idx) => idx).filter(idx => {
            const pv = M.perceive(layout, tr.stim.options[idx]);
            return known.every(slot => sol.predictions[slot] === 'derived' || pv[slot] === sol.predictions[slot]);
          });
          sum += fit.indexOf(tr.answer) >= 0 ? 1 / fit.length : 0; n++;
        }
      }
      return sum / n;
    });
    const spread = Math.max(...acc) - Math.min(...acc);
    t.ok(spread < 0.02, 'simulated accuracy spread across forms ' + spread.toFixed(4) + ' ' + acc.map(x => x.toFixed(3)).join(' '));
  });

  await t.test('matrix: the rule tutorial is fixed, solvable and explained by the same rules', () => {
    const a = M.tutorial(), b = M.tutorial();
    t.eq(JSON.stringify(a), JSON.stringify(b));
    t.eq(a.items.length, 4); t.eq(a.ruleTypes.length, 3); t.ok(a.intro.length > 40);
    for (const it of a.items) {
      t.ok(M.solve(it).ok, 'tutorial item solves');
      t.ok(it.explain.length >= 2 && /fits every rule/.test(it.explain[it.explain.length - 1]));
      t.eq(it.explain.length - 1 - (/^The same everywhere/.test(it.explain[it.explain.length - 2]) ? 1 : 0), it.meta.rules.length, 'one sentence per rule');
    }
    const p = M.practice();
    t.eq(p.form, 'P'); t.ok(p.practice); t.eq(p.trials.length, 4);
    t.eq(JSON.stringify(M.gen({ form: 'D' }).practice), JSON.stringify(a.items), 'gen carries the same tutorial');
    t.eq(M.gen({ form: 'P' }).form, 'P', "form 'P' gives the practice spec");
  });

  await t.test('matrix: scoring with hand-built logs', () => {
    const spec = M.gen({ form: 'A' });
    const scored = spec.trials.filter(x => !x.check), checks = spec.trials.filter(x => x.check);
    const wrong = x => (x.answer + 1) % 8;
    const answers = [];
    scored.forEach((x, k) => {
      if (k < 10) answers.push({ i: x.i, response: x.answer, rt: 8000 + k, voided: false });
      else if (k < 13) answers.push({ i: x.i, response: wrong(x), rt: 9000, voided: false });
      else if (k === 13) answers.push({ i: x.i, response: null, rt: null, voided: false, timedOut: true });
      else if (k === 14) answers.push({ i: x.i, response: x.answer, rt: 3000, voided: true });
      // 15–17 missing (visit abandoned)
    });
    answers.push({ i: checks[0].i, response: checks[0].answer, rt: 4000, voided: false });
    answers.push({ i: checks[1].i, response: wrong(checks[1]), rt: 4000, voided: false });
    const r = M.score(spec, { answers, paused: false });
    t.near(r.score, 10 / 14, 1e-12);
    t.eq([r.sub.correct, r.sub.n, r.sub.nItems, r.sub.timeouts, r.sub.voided, r.sub.missing], [10, 14, 18, 1, 1, 3]);
    t.eq(r.sub.checks, { n: 2, failed: 1 });
    t.eq(r.flags.sort(), ['check-failed', 'incomplete']);
    t.eq(r.scoreLabel, '10 of 14 correct');
    t.eq([r.testId, r.form, r.seed, r.version], ['lab.matrix', 'A', spec.seed, 1]);
    t.eq(r.sub.byRules['1'], { correct: 3, n: 3 });
    t.eq(r.sub.medianRtCorrect, 8004.5);
    const rows = M.rows(spec, { answers });
    t.eq(rows.length, 20);
    t.eq(rows.filter(x => x.correct === true).length, 11, '10 scored + 1 check');
    t.eq(rows.filter(x => x.timedOut).length, 1); t.eq(rows.filter(x => x.voided).length, 1);
    t.eq(rows.filter(x => x.correct === null).length, 4, 'voided + 3 missing');

    const fast = scored.map(x => ({ i: x.i, response: x.answer, rt: 1500, voided: false }));
    const rf = M.score(spec, { answers: fast });
    t.eq(rf.score, 1); t.ok(rf.flags.indexOf('too-fast') >= 0);
    const vo = scored.map((x, k) => ({ i: x.i, response: x.answer, rt: 6000, voided: k < 2 }));
    t.ok(M.score(spec, { answers: vo }).flags.indexOf('many-voided') >= 0, '2 of 18 voided > 10 %');
    t.eq(M.score(spec, { answers: [] }).score, null);
    const strResp = scored.map(x => ({ i: x.i, response: String(x.answer), rt: 6000, voided: false }));
    t.eq(M.score(spec, { answers: strResp }).score, 1, 'numeric strings accepted as option indices');
  });
}
