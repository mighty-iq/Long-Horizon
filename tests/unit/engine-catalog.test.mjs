// Engine: catalog, modes and learner model.
import { HF } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
loadEngine();

export default async function (t) {
  const C = HF.catalog;

  await t.test('catalog: every SPEC §2.1 track exists with its task, structure and keys', () => {
    const ids = C.ids();
    t.eq(ids.length, 19);
    const want = { 'nback.plain': 'identity', 'nback.dual': 'identity-dual', 'nback.transform': 'transform', 'nback.arith': 'arith', 'nback.switch': 'switch',
      'rel.steps': 'steps', 'rel.stream': 'rstream', 'span.op': 'span-forward', 'span.sym': 'span-forward', 'span.back': 'span-backward', 'vs.search': 'search' };
    for (const [id, s] of Object.entries(want)) t.eq(C.get(id).structure, s, id);
    for (let k = 1; k <= 8; k++) t.eq(C.get('rel.grid.T' + k).structure, 'grid-T' + k);
    t.eq(C.get('nback.dual').keys, ['match', 'match2']);
    t.eq(C.get('rel.grid.T3').keys, ['match', 'no']);
    t.eq(C.get('nback.transform').experimental, true);
    t.eq(C.get('nback.plain').experimental, false);
  });

  await t.test('catalog: n-back ladders are exact (SPEC §5)', () => {
    for (const id of ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith']) {
      t.eq(C.rungCount(id), 32, id + ' (to 16-back: SPEC §5 amended 12 Nov, SC-05)');
      for (let r = 0; r <= 31; r++) {
        const p = C.params(id, r);
        t.eq(p, { n: 1 + Math.floor(r / 2), onMs: 500, soaMs: r % 2 ? 2500 : 3000 }, id + ' r' + r);
      }
    }
    t.eq(C.levelLabel('nback.plain', 4), '3-back');
    t.eq(C.levelLabel('nback.plain', 5), '3-back · fast');
    t.eq(C.rungForN('nback.transform', 4), 6);
  });

  await t.test('catalog: Switch, Equal Steps, Grid, Stream, Span and search ladders', () => {
    t.eq(C.rungCount('nback.switch'), 27);
    t.eq(C.params('nback.switch', 3), { n: 2, onMs: 500, soaMs: 3000, switchRate: 0.25 });
    t.eq(C.params('nback.switch', 4), { n: 2, onMs: 500, soaMs: 3000, switchRate: 0.5 });
    t.eq(C.params('nback.switch', 5), { n: 2, onMs: 500, soaMs: 2500, switchRate: 0.5 });
    t.eq(C.rungCount('rel.steps'), 24);
    t.eq(C.params('rel.steps', 0), { level: 0, back: 1, maxNumber: 9, onMs: 500, soaMs: 3000 });
    t.eq(C.params('rel.steps', 13), { level: 6, back: 2, maxNumber: 29, onMs: 500, soaMs: 2500 });
    t.eq(C.params('rel.steps', 23).back, 3);
    t.eq(C.levelLabel('rel.steps', 12), '2-back up to 29', 'no repeated version name (PQ-14)');
    t.eq([C.fullLabel('rel.steps', 12), C.levelLabel('rel.stream', 1), C.fullLabel('rel.stream', 1)], ['Equal Steps · 2-back up to 29', 'Step 2 of 6', 'Relation Stream · step 2 of 6']);
    for (const id of C.ids()) for (let r = 0; r <= C.maxRung(id); r++) t.ok(!C.levelLabel(id, r).includes(C.get(id).name) && !C.levelLabel(id, r).includes(C.get(id).short), id + ' r' + r + ': ' + C.levelLabel(id, r));
    const g = C.params('rel.grid.T2', 3);
    t.eq([g.windowMs, g.keep, g.distractors, g.nearMiss, g.tier, g.rule], [4500, false, 0, false, 2, 'ascending']);
    t.eq(C.params('rel.grid.T1', 0).windowMs, 8000); t.eq(C.params('rel.grid.T1', 0).keep, true);
    t.eq(C.params('rel.grid.T1', 2).keep, false);
    t.eq(C.params('rel.grid.T1', 4).distractors, 6);
    const r6 = C.params('rel.grid.T1', 5); t.ok(r6.distractors === 6 && r6.nearMiss && !r6.keep, 'R6 cumulative');
    t.eq(C.params('rel.grid.T5', 8).windowMs, 2000);
    t.eq(C.levelLabel('rel.grid.T2', 3), 'Tier 2 · step 4 of 9');
    t.eq(C.rungCount('rel.stream'), 6);
    t.eq([C.params('rel.stream', 4).changeMs, C.params('rel.stream', 4).cells], [750, 2]);
    t.eq(C.params('span.op', 0).setSize, 2); t.eq(C.params('span.back', 7).setSize, 9);
    t.eq(C.rungCount('vs.search'), 20);
    t.eq([C.params('vs.search', 18), C.params('vs.search', 19)], [{ size: 64, windowMs: 1500, trials: 40 }, { size: 64, windowMs: 1000, trials: 40 }], 'shorter deadlines on top (12 Nov)');
    t.eq(C.levelLabel('vs.search', 19), '64 items · 1.0 s');
    t.eq(C.params('vs.search', 5), { size: 16, windowMs: 2000, trials: 40 });
    t.eq(C.params('vs.search', 11).size, 40); t.eq(C.params('vs.search', 17), { size: 64, windowMs: 2000, trials: 40 });
    t.eq([C.estBlockMs('vs.search', C.params('vs.search', 0)), C.estBlockMs('vs.search', C.params('vs.search', 17)), C.estBlockMs('vs.search', { size: 8, windowMs: 3000, trials: 20 })],
      [80000, 60000, 40000], 'search block ≈ 40 × (half the window + 500 ms blank)');
    t.eq(C.levelLabel('vs.search', 16), '64 items · 3.0 s');
  });

  await t.test('catalog: difficulty rises along every ladder, ≈ 1 logit per n on n-back', () => {
    for (const id of C.ids()) for (let r = 1; r <= C.maxRung(id); r++) t.ok(C.difficulty(id, r) > C.difficulty(id, r - 1), id + ' r' + r);
    t.near(C.difficulty('nback.plain', 4) - C.difficulty('nback.plain', 2), 1, 1e-9);
    for (let r = 0; r <= 31; r++) t.near(C.difficulty('nback.transform', r) - C.difficulty('nback.plain', r), 1, 1e-9, 'Transform one n above Plain');
    t.near(C.difficulty('nback.transform', 4, { step: 2 }) - C.difficulty('nback.transform', 4), 0.25, 1e-9);
    t.ok(C.difficulty('nback.plain', 4, { lureCount: 6 }) > C.difficulty('nback.plain', 4, { lureCount: 4 }));
  });

  await t.test('catalog: Stretch uses only fast half-steps from 2-back', () => {
    t.eq(C.allowedRungs('nback.plain', 'stretch').slice(0, 5), [0, 1, 3, 5, 7]);
    t.eq(C.allowedRungs('nback.switch', 'stretch').slice(0, 6), [0, 1, 2, 5, 8, 11]);
    t.eq(C.allowedRungs('rel.grid.T1', 'stretch').length, 9);
    t.eq(C.allowedRungs('nback.plain', 'varied').length, 32);
  });

  await t.test('catalog: gates (Executive at Plain 2-back or lesson; tiers at step 6; Stream with T3; T8 opt-in; Span setting)', () => {
    const ctx = (peak, extra) => ({ peak, lessons: {}, settings: {}, ...extra });
    t.eq(C.gateOpen('nback.transform', ctx({ 'nback.plain': 1 })), false);
    t.eq(C.gateOpen('nback.transform', ctx({ 'nback.plain': 2 })), true);
    t.eq(C.gateOpen('nback.arith', ctx({}, { lessons: { 'lesson.arith': 1 } })), true);
    t.eq(C.gateOpen('nback.switch', ctx({}, { lessons: { 'lesson.arith': 1 } })), false);
    t.eq(C.gateOpen('rel.grid.T2', ctx({ 'rel.grid.T1': 4 })), false);
    t.eq(C.gateOpen('rel.grid.T2', ctx({ 'rel.grid.T1': 5 })), true);
    t.eq(C.gateOpen('rel.stream', ctx({ 'rel.grid.T2': 5 })), true);
    t.eq(C.gateOpen('rel.stream', ctx({ 'rel.grid.T1': 8 })), false);
    t.eq(C.gateOpen('rel.grid.T8', ctx({ 'rel.grid.T7': 5 })), false);
    t.eq(C.ladderGateOpen('rel.grid.T8', ctx({ 'rel.grid.T7': 5 })), true);
    t.eq(C.gateOpen('rel.grid.T8', ctx({ 'rel.grid.T7': 5 }, { settings: { gridT8: true } })), true);
    t.eq(C.gateOpen('span.op', ctx({})), false);
    t.eq(C.gateOpen('span.op', ctx({}, { settings: { spanOn: true } })), true);
    t.eq(C.gateOpen('vs.search', ctx({})), false);
    t.eq(C.gateOpen('vs.search', ctx({}, { study: { arm: 'control' } })), true);
    t.eq(C.gateOpen('nback.dual', ctx({})), true);
  });

  await t.test('catalog: rule cards for every track, rung and set; sets never Lab-only', () => {
    for (const id of C.ids()) {
      const sets = C.trainingSets(id);
      t.ok(sets.length > 0, id);
      t.ok(!sets.some(s => /lab/i.test(s)), id + ' lab set');
      t.ok(C.LESSONS[C.get(id).lessonId], id + ' lesson');
      for (let r = 0; r <= C.maxRung(id); r++) for (const s of sets) {
        const card = C.ruleCard(id, r, s === 'glyphs' ? 'glyphsC' : s);
        t.ok(card.title && card.rule && card.keys && card.example, `${id} r${r} ${s}`);
        t.ok(!/undefined|NaN/.test(JSON.stringify(card)), `${id} r${r} ${s}: ${JSON.stringify(card)}`);
      }
    }
    t.ok(/day after/.test(C.ruleCard('nback.transform', 2, 'days').rule));
    t.ok(/Wed is the day after Tue/.test(C.ruleCard('nback.transform', 2, 'days').example));
    t.ok(/two days after/.test(C.ruleCard('nback.transform', 2, 'days', { step: 2 }).rule));
    t.eq(C.trainingSets('nback.dual'), ['tones']);
    t.eq(C.contentFamily('grid8'), 'spatial'); t.eq(C.contentFamily('glyphsF'), 'symbolic'); t.eq(C.familiesFor('nback.dual', 'tones'), ['spatial', 'audio']);
  });

  await t.test('modes: thresholds and caps (SPEC §6, PLAN §5)', () => {
    const M = HF.modes;
    t.eq([M.get('varied').U, M.get('varied').D], [0.87, 0.73]);
    t.eq([M.get('sprint').U, M.get('sprint').D], [0.92, 0.78]);
    t.eq([M.get('stretch').U, M.get('stretch').D, M.get('stretch').weeklyCap, M.get('stretch').opensAfter], [0.80, 0.64, 4, 6]);
    t.eq([M.get('mastery').U, M.get('free').D], [0.87, 0.73]);
    t.eq(M.target('stretch'), 0.72); t.eq(M.target('sprint'), 0.85);
    t.eq(M.get('stretch').spanUp, 0.70); t.eq(M.get('varied').spanUp, 0.80); t.eq(M.get('varied').spanDown, 0.60);
    const th = M.thresholds('varied', -0.02); t.near(th.U, 0.85, 1e-12); t.near(th.D, 0.71, 1e-12);
    t.eq(M.get('nope').id, 'varied');
  });

  await t.test('learner: prediction, update direction, K decay and level-equivalent', () => {
    const L = HF.learner, m = L.create();
    t.near(L.predictBA(m, 'nback.plain', 0), 0.5 + 0.5 / (1 + Math.exp(-2.2)), 1e-9);
    const blk = (y, rung, t0, extra) => ({ trackId: 'nback.plain', set: 'grid8', role: 'rated', rung, t: t0, result: { ba: 0.5 + y / 2, y }, ...extra });
    const before = L.thetaEff(m, 'nback.plain', 'grid8');
    const u = L.update(m, blk(1, 4, 0));
    t.ok(u.e > 0 && L.thetaEff(m, 'nback.plain', 'grid8') > before, 'good block raises θ');
    t.near(u.K, 1, 1e-12);
    const u2 = L.update(m, blk(0.2, 4, 1000));
    t.ok(u2.e < 0, 'poor block lowers θ'); t.near(u2.K, 1 / 1.05, 1e-6);
    for (let i = 0; i < 40; i++) L.update(m, blk(0.6, 4, 2000 + i));
    const kBefore = Math.max(0.15, 1 / (1 + 0.05 * m.n['nback.plain']));
    const u3 = L.update(m, blk(0.6, 4, 2000 + 60 * 86400000));
    t.ok(u3.K > kBefore + 0.05, 'K grows back after 60 days off');
    t.ok(m.theta['v:nback.plain'] !== undefined && m.theta.g !== undefined && m.theta['f:spatial'] !== undefined && m.theta['s:identity'] !== undefined && m.theta['t:nback'] !== undefined);
    const eq = L.levelEquivalent(m, 'nback.plain');
    t.ok(eq >= -1 && eq <= 31);
    if (eq >= 0) t.ok(L.predictBA(m, 'nback.plain', eq) >= 0.8 && (eq === 31 || L.predictBA(m, 'nback.plain', eq + 1) < 0.8));
    t.ok(/back/.test(L.levelEquivalentText(m, 'nback.plain')));
  });

  await t.test('learner: excluded blocks, placement without history, replay is deterministic', () => {
    const L = HF.learner;
    t.eq(L.updatesModel({ trackId: 'nback.plain', role: 'tutorial', result: { ba: 0.9, y: 0.8 } }), false);
    t.eq(L.updatesModel({ trackId: 'nback.plain', role: 'assist', result: { ba: 0.9, y: 0.8 } }), false);
    t.eq(L.updatesModel({ trackId: 'nback.plain', role: 'rated', interrupted: true, result: { ba: 0.9, y: 0.8 } }), false);
    t.eq(L.updatesModel({ trackId: 'nback.plain', role: 'rated', voidedRatio: 0.25, result: { ba: 0.9, y: 0.8 } }), false);
    t.eq(L.updatesModel({ trackId: 'nback.plain', role: 'warmup', result: { ba: 0.9, y: 0.8 } }), true);
    t.eq(L.placement(L.create(), 'nback.plain', 0.8), 0);
    const blocks = [0.9, 0.8, 0.6, 0.85].map((ba, i) => ({ trackId: 'rel.steps', set: 'numbers', role: 'rated', rung: i, t: i * 1000, result: { ba, y: 2 * ba - 1 } }));
    const a = L.replay(blocks), b = L.replay(blocks);
    t.eq(a.theta, b.theta);
    const p = L.placement(a, 'rel.steps', 0.8);
    t.ok(p >= 0 && p <= C.maxRung('rel.steps'));
    const ps = L.placement(a, 'nback.plain', 0.72, 'stretch');
    t.ok(C.allowedRungs('nback.plain', 'stretch').includes(ps), 'stretch placement on an allowed rung');
    // span predicts recall directly
    t.ok(L.predictBA(L.create(), 'span.op', 0) > 0.85);
  });
}
