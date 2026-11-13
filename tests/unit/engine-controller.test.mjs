// Engine: level controller (SPEC §6) and the published protocols' controllers.
import { HF } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
loadEngine();

const res = (ba, extra) => ({ ba, baMean: ba, y: 2 * ba - 1, voidedRatio: 0, ...extra });
const stream = (h, m, fa, cr) => ({ hits: h, misses: m, fas: fa, crs: cr });

export default async function (t) {
  const K = HF.controller;
  const next = (o) => K.next({ trackId: 'nback.plain', level: 6, role: 'rated', modeId: 'varied', ...o });

  await t.test('controller: up at U, down below D, stay between (each mode)', () => {
    t.eq(next({ result: res(0.87) }), { levelAfter: 7, moved: 1, reason: 'up' });
    t.eq(next({ result: res(0.869) }).moved, 0);
    t.eq(next({ result: res(0.73) }).moved, 0);
    t.eq(next({ result: res(0.729) }), { levelAfter: 5, moved: -1, reason: 'down' });
    t.eq(next({ modeId: 'sprint', result: res(0.91), sessionState: { downMoved: { 'nback.plain': true } } }).moved, 0);
    t.eq(next({ modeId: 'sprint', result: res(0.77) }).moved, -1);
    t.eq(next({ modeId: 'stretch', level: 5, result: res(0.80) }).levelAfter, 7, 'Stretch moves along fast half-steps');
    t.eq(next({ modeId: 'stretch', level: 5, result: res(0.63) }).levelAfter, 3);
    t.eq(next({ modeId: 'stretch', level: 5, result: res(0.70) }).moved, 0);
    t.eq(next({ modeId: 'mastery', result: res(0.88) }).moved, 1);
  });

  await t.test('controller: Sprint double steps until the first down move in the session; placement double steps', () => {
    t.eq(next({ modeId: 'sprint', result: res(0.95) }), { levelAfter: 8, moved: 2, reason: 'up-double' });
    t.eq(next({ modeId: 'sprint', result: res(0.95), sessionState: { downMoved: { 'rel.steps': true } } }).moved, 2, 'per track');
    t.eq(next({ modeId: 'sprint', result: res(0.95), sessionState: { downMoved: { 'nback.plain': true } } }).moved, 1);
    t.eq(next({ result: res(0.9), trackState: { placing: true } }), { levelAfter: 8, moved: 2, reason: 'up-placement' });
    t.eq(next({ result: res(0.6), trackState: { placing: true } }).moved, -1, 'down moves are single');
    t.eq(next({ level: 31, result: res(1) }), { levelAfter: 31, moved: 0, reason: 'top' });
    t.eq(next({ level: 17, result: res(1) }), { levelAfter: 18, moved: 1, reason: 'up' }, '9-back is no longer the top (SC-05)');
    t.eq(next({ level: 0, result: res(0.5) }), { levelAfter: 0, moved: 0, reason: 'bottom' });
    t.eq(next({ level: 30, result: res(1), trackState: { placing: true } }).levelAfter, 31, 'clamped to the ladder');
  });

  await t.test('controller: warm-ups, checks, interrupted and voided blocks move nothing; Free only on level', () => {
    for (const role of ['warmup', 'check', 'assist', 'tutorial', 'probe', 'protocol']) t.eq(next({ role, result: res(1) }).moved, 0, role);
    t.eq(next({ result: res(1), interrupted: true }).reason, 'interrupted');
    t.eq(next({ result: res(1, { voidedRatio: 0.25 }) }).reason, 'interrupted');
    t.eq(next({ result: res(1, { voidedRatio: 0.2 }) }).moved, 1, 'exactly 20 % voided still counts');
    t.eq(next({ result: { ba: NaN } }).reason, 'interrupted');
    t.eq(next({ role: 'free', modeId: 'free', rung: 5, result: res(1) }), { levelAfter: 6, moved: 0, reason: 'off-level' });
    t.eq(next({ role: 'free', modeId: 'free', rung: 6, result: res(1) }).levelAfter, 7);
  });

  await t.test('controller: Mastery cap and a unit below the level', () => {
    t.eq(next({ modeId: 'mastery', level: 4, rung: 4, result: res(0.95), trackState: { capRung: 4 } }), { levelAfter: 4, moved: 0, reason: 'capped' });
    t.eq(next({ modeId: 'mastery', level: 3, rung: 3, result: res(0.95), trackState: { capRung: 4, placing: true } }).levelAfter, 4, 'double step capped');
    t.eq(next({ modeId: 'mastery', level: 8, rung: 4, result: res(0.5), trackState: { capRung: 4 } }), { levelAfter: 8, moved: 0, reason: 'below-level' });
  });

  await t.test('controller: Span thresholds (recall .80/.60, judgements .85; Stretch up at .70)', () => {
    const sp = (ba, procAcc, modeId = 'varied') => K.next({ trackId: 'span.op', level: 3, role: 'rated', modeId, result: { ba, extra: { procAcc } } }).moved;
    t.eq(sp(0.8, 0.9), 1); t.eq(sp(0.8, 0.84), 0); t.eq(sp(0.79, 0.9), 0); t.eq(sp(0.59, 0.95), -1); t.eq(sp(0.6, 0.95), 0);
    t.eq(sp(0.7, 0.9, 'stretch'), 1); t.eq(sp(0.69, 0.9, 'stretch'), 0);
  });

  await t.test('controller: self-correction offsets and thresholds', () => {
    t.eq(K.selfCorrect(0, 0.84, 0.80), -0.01);
    t.eq(K.selfCorrect(0, 0.83, 0.80), 0);
    t.eq(K.selfCorrect(0, 0.76, 0.80), 0.01);
    t.eq(K.selfCorrect(-0.01, 0.9, 0.80), -0.01, 'negative offsets stop at −.01 (CA-02)');
    t.eq(K.selfCorrect(-0.05, 0.9, 0.80), -0.01, 'an old −.05 is pulled back to −.01');
    // U never falls to the approximate-responder bound (SPEC §4.6): .857 with 4 lures, .786 with Stretch's 6
    for (const m of ['varied', 'sprint', 'mastery', 'free']) t.ok(HF.modes.thresholds(m, HF.modes.OFFSET_MIN).U > (1 + 10 / 14) / 2 + 1e-9, m);
    t.ok(HF.modes.thresholds('stretch', HF.modes.OFFSET_MIN).U > (1 + 8 / 14) / 2 + 1e-9, 'stretch');
    t.eq(K.selfCorrect(0.05, 0.6, 0.80), 0.05);
    t.eq(next({ result: res(0.86), trackState: { offset: -0.01 } }).moved, 1, 'U .86 after a −.01 offset');
    t.eq(next({ result: res(0.72), trackState: { offset: -0.01 } }).moved, 0, 'D .72 after a −.01 offset');
  });

  await t.test('controller: fatigue = two rated blocks in a row ≤ first-two mean − .15', () => {
    t.eq(K.fatigue([0.85, 0.85, 0.7, 0.7]), true);
    t.eq(K.fatigue([0.85, 0.85, 0.7, 0.71]), false);
    t.eq(K.fatigue([0.85, 0.85, 0.7]), false);
    t.eq(K.fatigue([0.85, 0.85, 0.8, 0.6, 0.65]), true);
  });

  await t.test('protocols: Cao per-block rule (> 18 correct up, ≥ 5 errors down, never below 1-back)', () => {
    const P = HF.protocols, cao = (h, m, fa, cr, rung = 2) => P.caoMove({ ba: 0.8, streams: { main: stream(h, m, fa, cr) } }, rung);
    t.eq(cao(6, 0, 1, 13).levelAfter, 4, '19 correct → up');
    t.eq(cao(5, 1, 1, 13).levelAfter, 2, '18 correct → stay');
    t.eq(cao(4, 2, 2, 12).levelAfter, 2, '4 errors → stay');
    t.eq(cao(4, 2, 3, 11).levelAfter, 0, '5 errors → down');
    t.eq(cao(1, 5, 4, 10, 0).levelAfter, 0, 'floor 1-back');
    t.eq(cao(6, 0, 0, 14, 16).levelAfter, 18, '9-back → 10-back (SC-05)');
    t.eq([HF.protocols.MAX_N, cao(6, 0, 0, 14, 30).levelAfter, cao(6, 0, 0, 14, 30).reason], [16, 30, 'top'], 'ceiling 16-back');
    t.eq(P.caoMove({ ba: 0.9, streams: { main: stream(6, 0, 0, 14) } }, 2, true).reason, 'interrupted');
    t.eq(cao(5, 0, 0, 14).levelAfter, 4, 'scaled to 20 with a voided trial');
  });

  await t.test('protocols: Jaeggi errors per stream (< 3 both up, > 5 either down)', () => {
    const P = HF.protocols, jg = (a, b) => P.jaeggiMove({ ba: 0.8, streams: { pos: stream(...a), snd: stream(...b) } }, 4).levelAfter;
    t.eq(jg([6, 0, 2, 12], [5, 1, 1, 13]), 6);
    t.eq(jg([6, 0, 3, 11], [6, 0, 0, 14]), 4);
    t.eq(jg([6, 0, 0, 14], [3, 3, 3, 11]), 2);
    t.eq(jg([5, 1, 4, 10], [6, 0, 0, 14]), 4, 'exactly 5 errors stays');
  });

  await t.test('protocols: Wang day rule (> .80 up, < .50 down, L0–L7)', () => {
    const P = HF.protocols;
    t.eq(P.wangDayMove(0.81, 2).levelAfter, 4); t.eq(P.wangDayMove(0.80, 2).levelAfter, 2);
    t.eq(P.wangDayMove(0.49, 2).levelAfter, 0); t.eq(P.wangDayMove(0.50, 2).levelAfter, 2);
    t.eq(P.wangDayMove(0.95, 14).levelAfter, 14, 'top L7'); t.eq(P.wangDayMove(0.1, 0).levelAfter, 0);
    const blk = (h, cr) => ({ result: { streams: { main: { h, m: 6 - h, fa: 14 - cr, cr } } } });
    t.near(P.dayAccuracy([blk(6, 14), blk(3, 13)]), 36 / 40, 1e-12);
  });

  await t.test('controller: Span moves with one voided list of three, not with two; other tasks keep 20 % (CA-10)', () => {
    t.eq([K.voidLimit('span.op'), K.voidLimit('span.back'), K.voidLimit('nback.plain'), K.voidLimit('rel.grid.T1'), K.voidLimit('vs.search')], [0.34, 0.34, 0.2, 0.2, 0.2]);
    const sp = (vr) => K.next({ trackId: 'span.op', level: 3, role: 'rated', modeId: 'varied', result: { ba: 0.9, voidedRatio: vr, extra: { procAcc: 0.95 } } });
    t.eq([sp(0).moved, sp(1 / 3).moved, sp(2 / 3).reason], [1, 1, 'interrupted']);
    t.eq(next({ result: res(0.95, { voidedRatio: 0.25 }) }).reason, 'interrupted', 'n-back with 25 % voided still moves nothing');
    const stored = (trackId, vr) => ({ trackId, role: 'rated', voidedRatio: vr, interrupted: false, result: { ba: 0.9, voidedRatio: vr } });
    t.eq([K.blockBad(stored('span.sym', 1 / 3)), K.blockBad(stored('span.sym', 2 / 3)), K.blockBad(stored('nback.plain', 0.25))], [false, true, true]);
    t.eq([HF.learner.updatesModel({ ...stored('span.op', 1 / 3), t: 1, set: 'letters', rung: 1, result: { ba: 0.9, y: 0.9, voidedRatio: 1 / 3 } }),
      HF.learner.updatesModel({ ...stored('span.op', 2 / 3), t: 1, set: 'letters', rung: 1, result: { ba: 0.9, y: 0.9, voidedRatio: 2 / 3 } })], [true, false], 'model update follows the same limit');
    t.eq(K.next({ trackId: 'span.op', level: 3, role: 'rated', modeId: 'varied', interrupted: true, result: { ba: 0.9, voidedRatio: 1 / 3, extra: { procAcc: 0.95 } } }).reason, 'interrupted', 'a pause still moves nothing');
  });
}
