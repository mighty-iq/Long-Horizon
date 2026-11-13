// Engine: Mastery Path state machine, badges and the Free-play coach.
import { HF } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
loadEngine();

const DAY = 86400000;
const at = (d, h = 10, m = 0) => new Date(2026, 0, d, h, m).getTime();
let n = 0;
const blk = (o) => ({ id: 'b' + (n++), sessionId: o.sessionId || 's' + o.day, t: at(o.day, 10, o.i || 0), trackId: o.trackId || 'nback.plain', role: o.role || 'rated', unitId: o.unitId || 'u01', purpose: o.purpose || 'unit', rung: o.rung != null ? o.rung : 2, levelBefore: 2, levelAfter: 2, result: { ba: o.ba } });

export default async function (t) {
  const M = HF.mastery;

  await t.test('mastery: the path starts as PLAN §5 lists it and alternates tasks', () => {
    t.eq(M.PATH.slice(0, 13).map(u => [u.trackId, u.target]), [
      ['nback.plain', 2], ['rel.grid.T1', 5], ['nback.transform', 2], ['rel.steps', 2], ['nback.plain', 4], ['rel.grid.T2', 5],
      ['rel.steps', 8], ['nback.dual', 2], ['rel.grid.T3', 5], ['nback.arith', 2], ['nback.switch', 3], ['nback.plain', 6], ['rel.grid.T4', 5]]);
    t.eq(HF.catalog.levelLabel('rel.steps', 2), '1-back up to 19');
    t.eq(HF.catalog.levelLabel('rel.steps', 8), '2-back up to 9');
    t.ok(M.unitLabel(M.unit('u02')).includes('step 6'));
    t.eq(M.unitLabel(M.unit('u04')), 'Equal Steps · 1-back up to 19', 'unit label keeps the name once (PQ-14)');
    t.eq(M.criterionMet([0.9, 0.7, 0.86], 'rel.grid.T1'), true); t.eq(M.criterionMet([0.9, 0.7, 0.8], 'rel.grid.T1'), false); t.eq(M.criterionMet([0.84, 0.86, 0.9, 0.7], 'rel.grid.T1'), true);
    // n-back / Equal Steps units need .87: a familiarity or ±1 responder scores (1 + 10/14)/2 ≈ .857 there (SPEC §4.6)
    const fam = (1 + 10 / 14) / 2;
    t.eq(M.criterionMet([fam, fam, fam], 'nback.plain'), false); t.eq(M.criterionMet([fam, fam, fam], 'rel.steps'), false);
    t.eq(M.criterionMet([fam, fam, fam], 'rel.grid.T2'), true, 'the Grid keeps .85');
    t.eq(M.criterionMet([0.881, 0.7, 0.893], 'nback.transform'), true);
    t.eq([HF.modes.unitPassFor('nback.dual'), HF.modes.unitPassFor('rel.steps'), HF.modes.unitPassFor('rel.grid.T4')], [0.87, 0.87, 0.85]);
  });

  await t.test('mastery: criterion → pending check (not on the same day) → pass → reviews at 2/7/21 days', () => {
    const blocks = [blk({ day: 5, ba: 0.9 }), blk({ day: 5, ba: 0.7, i: 1 }), blk({ day: 5, ba: 0.88, i: 2 })];
    let s = M.state(blocks, [], at(5, 20));
    t.eq(s.units.u01.status, 'pending-check'); t.eq(s.checkDue.nback, null, 'not due the same day');
    t.eq(s.current.nback, 'u03', 'the next n-back unit can start');
    s = M.state(blocks, [], at(6, 9));
    t.eq(s.checkDue.nback, 'u01');
    const ev = [{ type: 'mastery-check', t: at(6, 11), unitId: 'u01', ba: 0.83, pass: true }];
    s = M.state(blocks, ev, at(6, 12));
    t.eq([s.units.u01.status, s.units.u01.passDay], ['passed', '2026-01-06']);
    t.eq(s.units.u01.reviews[0].dueDay, '2026-01-08');
    t.eq(s.reviewDue.nback, null);
    s = M.state(blocks, ev, at(8, 9));
    t.eq(s.reviewDue.nback.unitId, 'u01');
    const rev = blk({ day: 8, purpose: 'review', role: 'check', ba: 0.9 });
    s = M.state(blocks.concat([rev]), ev, at(9, 9));
    t.eq(s.units.u01.reviews.map(r => r.dueDay), ['2026-01-08', '2026-01-13']);
    t.eq(s.reviewDue.nback, null);
    t.eq(s.passedCount, 1);
  });

  await t.test('mastery: failed checks, move on after 3, a poor review reopens the unit for one session', () => {
    const blocks = [blk({ day: 5, ba: 0.9 }), blk({ day: 5, ba: 0.9, i: 1 })];
    const fail = (d) => ({ type: 'mastery-check', t: at(d, 11), unitId: 'u01', ba: 0.7, pass: false });
    let s = M.state(blocks, [fail(6)], at(6, 12));
    t.eq([s.units.u01.status, s.units.u01.failedChecks], ['pending-check', 1]);
    t.eq(s.checkDue.nback, null, 'retest on a later day');
    t.eq(M.state(blocks, [fail(6)], at(7, 9)).checkDue.nback, 'u01');
    s = M.state(blocks, [fail(6), fail(7), fail(8)], at(9, 9));
    t.eq([s.units.u01.status, s.units.u01.flagged], ['moved-on', true]);
    const ok = [{ type: 'mastery-check', t: at(6, 11), unitId: 'u01', ba: 0.9, pass: true }];
    const poor = blk({ day: 8, purpose: 'review', role: 'check', ba: 0.7, sessionId: 'r1' });
    s = M.state(blocks.concat([poor]), ok, at(9, 9));
    t.eq([s.units.u01.status, s.current.nback], ['reopened', 'u01']);
    // CA-01: the whole next session serves the reopened unit, not just its first block
    const again = blk({ day: 9, ba: 0.85, sessionId: 'r2' }), again2 = blk({ day: 9, ba: 0.85, sessionId: 'r2', i: 5 });
    s = M.state(blocks.concat([poor, again, again2]), ok, at(9, 12));
    t.eq([s.units.u01.status, s.current.nback], ['reopened', 'u01'], 'still reopened while session r2 runs');
    s = M.state(blocks.concat([poor, again, again2]), ok, at(9, 13), { endedSessions: { r2: true } });
    t.eq(s.units.u01.status, 'passed', 'closed once that session has ended');
    s = M.state(blocks.concat([poor, again, blk({ day: 10, ba: 0.9, sessionId: 'r3' })]), ok, at(10, 12));
    t.eq(s.units.u01.status, 'passed', 'or when a later session plays it');
  });

  await t.test('mastery: a task whose units are all passed is done (maintenance)', () => {
    const ev = [], blocks = [];
    M.unitsOfTask('relations').forEach((u, i) => {
      blocks.push(blk({ day: 2, i: 2 * i, trackId: u.trackId, unitId: u.id, rung: u.target, ba: 0.9 }), blk({ day: 2, i: 2 * i + 1, trackId: u.trackId, unitId: u.id, rung: u.target, ba: 0.9 }));
      ev.push({ type: 'mastery-check', t: at(3, 10, i), unitId: u.id, ba: 0.9, pass: true });
    });
    const s = M.state(blocks, ev, at(4));
    t.eq([s.done.relations, s.current.relations, s.done.nback], [true, null, false]);
  });

  await t.test('badges: 12 ids, each earned from records', () => {
    const B = HF.badges;
    t.eq(B.ids(), ['rules-learned', 'nback-3', 'nback-5', 'exec-all', 'rel-different', 'rel-five', 'explorer', 'baselines', 'post-test', 'follow-up', 'comeback', 'reflective']);
    const facts = { lessonPassed: { 'lesson.nback': 10 }, nReach: { 3: 20 }, firstBlock: { 'nback.transform': 30, 'nback.arith': 40 }, reach: { 'rel.grid.T2': { 5: 50 } },
      setFirst: {}, explorerSets: ['grid8'], labEnded: { B1: 60, B2: 70 }, comebackAt: 80, firstNoteAt: 90 };
    const got = B.compute(facts);
    t.eq(got, { 'rules-learned': 10, 'nback-3': 20, 'rel-different': 50, baselines: 70, comeback: 80, reflective: 90 });
    facts.firstBlock['nback.switch'] = 35;
    t.eq(B.compute(facts)['exec-all'], 40);
    t.eq(B.diff({ a: 1 }, { a: 1, b: 2 }), ['b']);
    const all = { lessonPassed: {}, nReach: {}, firstBlock: {}, reach: {}, setFirst: { grid8: 5 }, explorerSets: ['grid8'], labEnded: {} };
    B.EXPLORER_TRACKS.forEach((id, i) => { all.firstBlock[id] = 100 + i; });
    t.eq(B.compute(all).explorer, 100 + B.EXPLORER_TRACKS.length - 1);
  });

  await t.test('coach: Edge, Due, Growing and New suggestions with predicted BA', () => {
    const rec = HF.engine.newRecords(at(1));
    const mk = (tid, day, ba, rung) => ({ id: tid + day, sessionId: 's' + day, t: at(day), trackId: tid, set: HF.catalog.defaultSet(tid), role: 'rated', mode: 'free', rung, levelBefore: rung, levelAfter: rung, moved: 0, reason: 'stay', result: { ba, y: 2 * ba - 1 } });
    rec.blocks = [mk('nback.plain', 2, 0.9, 2), mk('rel.grid.T1', 3, 0.8, 3), mk('nback.plain', 4, 0.95, 2), mk('nback.plain', 5, 0.95, 2), mk('nback.plain', 6, 0.95, 2)];
    const d = HF.engine.derive(rec, at(7));
    const s = HF.coach.suggest(d, { now: at(7), trackId: 'nback.plain' });
    const kinds = s.map(x => x.kind);
    t.eq(kinds.slice(0, 2), ['edge', 'due']);
    t.ok(kinds.includes('new'));
    const edge = s[0];
    t.ok(Math.abs(edge.predicted - 0.8) < 0.1, 'edge predicted ≈ .80: ' + edge.predicted);
    t.eq(s[1].trackId, 'rel.grid.T1');
    t.ok(/day/.test(s[1].why));
    const opts = HF.coach.options(d, 'nback.plain');
    t.eq(opts.map(o => o.rung), [d.tracks['nback.plain'].level - 1, d.tracks['nback.plain'].level, d.tracks['nback.plain'].level + 1]);
    t.ok(opts[0].predicted > opts[2].predicted);
    t.ok(!HF.coach.freeTracks(d).includes('vs.search'));
    t.eq(HF.coach.table(d, 'rel.stream').length, 6);
  });
}
