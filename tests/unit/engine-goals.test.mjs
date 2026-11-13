// Engine: calendar helpers, counted sessions, weekly goals, protocol state and due logic.
import { HF } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
loadEngine();

const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime(); // local time
const sess = (id, t, mode = 'varied', extra) => ({ id, startedAt: t, dayKey: HF.goals.dayKey(t), mode, planned: 14, endedBy: 'done', ...extra });

export default async function (t) {
  const G = HF.goals;

  await t.test('goals: local day and Monday-start week keys', () => {
    t.eq(G.dayKey(at(2026, 11, 6, 23, 59)), '2026-11-06');
    t.eq(G.weekKey('2026-11-06'), '2026-11-02');   // Friday → Monday
    t.eq(G.weekKey('2026-11-08'), '2026-11-02');   // Sunday
    t.eq(G.weekKey('2026-11-09'), '2026-11-09');   // Monday
    t.eq(G.addDays('2026-12-30', 3), '2027-01-02');
    t.eq(G.dayDiff('2026-03-27', '2026-03-30'), 3);
    t.eq(G.dow('2026-11-09'), 0);
  });

  await t.test('goals: a session qualifies when done, ended for fatigue, or half played', () => {
    t.eq(G.qualifies({ endedBy: 'done', planned: 14 }, 3), true);
    t.eq(G.qualifies({ endedBy: 'quit', planned: 14 }, 7), true);
    t.eq(G.qualifies({ endedBy: 'quit', planned: 14 }, 6), false);
    t.eq(G.qualifies({ endedBy: 'fatigue', planned: 14 }, 2), true);
    t.eq(G.qualifies({ endedBy: 'done', planned: 14 }, 0), false);
  });

  await t.test('goals: one counted session a day; Sprint 2 if ≥ 3 h apart', () => {
    const s = [sess('a', at(2026, 1, 5, 9)), sess('b', at(2026, 1, 5, 18)), sess('c', at(2026, 1, 6, 9))];
    const c = G.countSessions(s, { a: 14, b: 14, c: 14 });
    t.eq(Object.keys(c.counted).sort(), ['a', 'c']); t.eq(c.why.b, 'day-limit');
    const sp = [sess('a', at(2026, 1, 5, 9), 'sprint'), sess('b', at(2026, 1, 5, 11, 30), 'sprint'), sess('c', at(2026, 1, 5, 12, 5), 'sprint'), sess('d', at(2026, 1, 5, 20), 'sprint')];
    const c2 = G.countSessions(sp, { a: 14, b: 14, c: 14, d: 14 });
    t.eq(Object.keys(c2.counted).sort(), ['a', 'c'], 'second Sprint session needs a 3 h gap, third is over the daily limit');
    t.eq(c2.why.b, 'gap'); t.eq(c2.why.d, 'day-limit');
  });

  await t.test('goals: Stretch needs 20 h between counted sessions and counts at most 4 a week', () => {
    const days = [5, 6, 7, 8, 9, 10];
    const s = days.map((d, i) => sess('s' + i, at(2026, 1, d, i === 1 ? 8 : 9), 'stretch'));
    const c = G.countSessions(s, Object.fromEntries(s.map(x => [x.id, 14])));
    t.eq(c.why.s1, 'counted', '23 h after the previous one counts');
    t.eq(c.why.s4, 'week-cap');
    const s2 = [sess('x', at(2026, 1, 5, 20), 'stretch'), sess('y', at(2026, 1, 6, 9), 'stretch')];
    t.eq(G.countSessions(s2, { x: 14, y: 14 }).why.y, 'gap');
    const wk = [5, 6, 7, 8, 9].map((d, i) => sess('w' + i, at(2026, 1, d, 9), 'stretch'));
    const c3 = G.countSessions(wk, Object.fromEntries(wk.map(x => [x.id, 14])));
    t.eq(Object.keys(c3.counted).length, 4); t.eq(c3.why.w4, 'week-cap');
  });

  await t.test('goals: weekly target clamped to the mode cap, pauses, fresh start, weeks met', () => {
    t.eq(G.weeklyTarget({ weeklyTarget: 5 }, 'stretch'), 4);
    t.eq(G.weeklyTarget({ weeklyTarget: 7 }, 'varied'), 5);
    t.eq(G.weeklyTarget({ weeklyTarget: 1 }, 'varied'), 3);
    const s = [sess('a', at(2026, 11, 2)), sess('b', at(2026, 11, 3)), sess('c', at(2026, 11, 4))];
    const list = G.countSessions(s, { a: 14, b: 14, c: 14 }).list;
    const w = G.week(list, { now: at(2026, 11, 5, 12), settings: { weeklyTarget: 4, mode: 'varied' } });
    t.eq([w.weekKey, w.target, w.count, w.remaining, w.met, w.reachable], ['2026-11-02', 4, 3, 1, false, true]);
    t.eq(w.days.map(d => d.counted), [1, 1, 1, 0, 0, 0, 0]);
    t.eq(w.daysLeft, 4);
    const w2 = G.week(list, { now: at(2026, 11, 5, 12), settings: { weeklyTarget: 4 }, events: [{ type: 'goal-pause', from: '2026-11-06', to: '2026-11-08' }] });
    t.eq([w2.target, w2.pausedDays, w2.met], [2, 3, true], 'target scales with paused days');
    t.ok(!('missed' in w) && !('streak' in w), 'no loss framing');
    const mon = G.week([], { now: at(2026, 11, 9, 8), settings: {} });
    t.eq(mon.freshStart, true);
    t.eq(w2.weeksMet, 1);
  });

  await t.test('goals: canCountNow explains why a session would not count', () => {
    const list = G.countSessions([sess('a', at(2026, 1, 5, 9))], { a: 14 }).list;
    t.eq(G.canCountNow(list, at(2026, 1, 5, 15), 'varied').reason, 'day-limit');
    t.eq(G.canCountNow(list, at(2026, 1, 5, 15), 'sprint').ok, true);
    t.eq(G.canCountNow(list, at(2026, 1, 5, 11), 'sprint').reason, 'gap');
    t.eq(G.canCountNow(list, at(2026, 1, 6, 1), 'stretch').reason, 'gap');
  });

  await t.test('protocols: Cao state — N − 2 start, one session per day, complete after 6, follow-up at ≥ 80 days', () => {
    const P = HF.protocols;
    const mk = (sid, day, rungs, purpose) => rungs.map((r, i) => ({ id: sid + i, sessionId: sid, t: at(2026, 1, day, 10, i), trackId: 'nback.transform', protocol: 'cao', rung: r, levelAfter: rungs[i + 1] != null ? rungs[i + 1] : r + 2, purpose: purpose || 'train', result: { ba: 0.8 } }));
    let blocks = mk('s1', 5, Array(20).fill(0).map((_, i) => Math.min(6, 2 * Math.floor(i / 4))));
    let st = P.state(blocks, at(2026, 1, 5, 18)).cao;
    t.eq([st.sessionsDone, st.lastEndN, st.nextStartN, st.playedToday], [1, 5, 3, true]);
    t.eq(P.due('cao', st, at(2026, 1, 5, 20)).due, false);
    t.eq(P.due('cao', P.state(blocks, at(2026, 1, 6, 9)).cao, at(2026, 1, 6, 9)).sessionNo, 2);
    t.eq(P.nextRung('cao', st, [], 'train'), 4, 'session 2 starts at 3-back');
    t.eq(P.nextRung('cao', st, [{ levelAfter: 8 }], 'train'), 8, 'inside a session: the last levelAfter');
    for (let k = 2; k <= 6; k++) blocks = blocks.concat(mk('s' + k, 5 + k, Array(20).fill(2)));
    st = P.state(blocks, at(2026, 1, 12, 9)).cao;
    t.eq([st.sessionsDone, st.complete], [6, true]);
    t.eq(st.followup.startN, 2); t.eq(st.followup.from, G.addDays('2026-01-11', 80));
    t.eq(P.due('cao', st, at(2026, 1, 12, 9)).reason, 'continue');
    const late = P.state(blocks, at(2026, 4, 2, 9)).cao;
    t.eq(P.due('cao', late, at(2026, 4, 2, 9)).purpose, 'followup');
    t.eq(P.nextRung('cao', late, [], 'followup'), 2);
  });

  await t.test('protocols: Wang day state and Jaeggi state', () => {
    const P = HF.protocols;
    const wb = (day, i, rung, after, bad) => ({ id: 'w' + day + i, sessionId: 'w' + day, t: at(2026, 1, day, 10, i), trackId: 'rel.steps', protocol: 'wang', rung, levelAfter: after, interrupted: !!bad, result: { ba: 0.9, streams: { main: { h: 6, m: 0, fa: 1, cr: 13 } } } });
    const blocks = [0, 1, 2, 3, 4].map(i => wb(5, i, 0, i === 4 ? 2 : 0)).concat([wb(6, 0, 2, 2), wb(6, 1, 2, 2, true)]);
    const st = P.state(blocks, at(2026, 1, 6, 12)).wang;
    t.eq([st.level, st.daysDone, st.blocksToday], [1, 1, 1], 'interrupted blocks do not count toward the day');
    t.eq(P.due('wang', st, at(2026, 1, 6, 12)).blocksLeft, 4);
    t.eq(P.nextRung('wang', st, []), 2);
    const jb = [0, 1, 2].map(i => ({ id: 'j' + i, sessionId: 'j', t: at(2026, 1, 5, 10, i), trackId: 'nback.dual', protocol: 'jaeggi', rung: 2 * i, levelAfter: 2 * i + 2, result: { ba: 0.9 } }));
    const js = P.state(jb, at(2026, 1, 6, 9)).jaeggi;
    t.eq([js.nextStartN, js.sessionsDone, js.playedToday], [4, 0, false]);
    t.eq(P.nextRung('jaeggi', js, []), 6);
  });
}
