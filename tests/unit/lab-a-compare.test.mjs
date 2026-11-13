// Reliable change (Jacobson & Truax) against B2, verdicts, calibration rules, composites, near/mid/far levels.
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/tests/sspan.js', 'js/lab/levels.js', 'js/lab/compare.js']) load(f);

const T0 = new Date(2026, 0, 5, 10).getTime(), DAY = 86400000;
function v(id, kind, day, scores, extra) {
  const tests = {};
  Object.keys(scores).forEach(k => { tests[k] = { score: scores[k], flags: [] }; });
  return Object.assign({ id, kind, config: 'standard', form: 'A', startedAt: T0 + day * DAY, endedAt: T0 + day * DAY + 3e6, tests, flags: [] }, extra || {});
}
function recs(visits, calibration, blocks) {
  return { profile: { anonId: 'a' }, settings: {}, sessions: [], blocks: blocks || [], labVisits: visits, events: [], calibration: calibration || null };
}
const CAL = { version: 'test-1', source: 'unit', tests: { 'lab.sspan': { r: 0.8, sd: 10, mean: 50, n: 60 }, 'lab.update': { r: 0.7, sd: 0.1, mean: 0.6, n: 49 } } };

export default async function (t) {
  const L = HF.lab;

  await t.test('RCI numbers: sd 10, r .8 → Sdiff 6.325, band ±12.40; verdicts above / inside / below', () => {
    const base = [v('b1', 'B1', 0, { 'lab.sspan': 48 }), v('b2', 'B2', 4, { 'lab.sspan': 50 })];
    const sdiff = 10 * Math.sqrt(2 * 0.2);
    t.near(sdiff, 6.3246, 1e-4);
    let c = L.compare(recs(base.concat([v('p', 'POST', 40, { 'lab.sspan': 63 })]), CAL))['lab.sspan'];
    t.near(c.rci, 13 / sdiff, 1e-9); t.near(c.rci, 2.0555, 1e-4); t.eq(c.verdict, 'above');
    t.near(c.band, 1.96 * sdiff, 1e-9); t.near(c.band, 12.396, 1e-3);
    t.eq([c.b2, c.latest, c.change, c.latestKind, c.r, c.sd, c.n], [50, 63, 13, 'POST', 0.8, 10, 60]);
    t.near(HF.stats.rci(50, 62.4, 10, 0.8), 1.96, 0.001);
    c = L.compare(recs(base.concat([v('p', 'POST', 40, { 'lab.sspan': 45 })]), CAL))['lab.sspan'];
    t.eq(c.verdict, 'inside'); t.near(c.rci, -5 / sdiff, 1e-9);
    c = L.compare(recs(base.concat([v('p', 'POST', 40, { 'lab.sspan': 30 })]), CAL))['lab.sspan'];
    t.eq(c.verdict, 'below'); t.near(c.rci, -3.1623, 1e-4);
  });

  await t.test('reference is B2; latest is the most recent later visit; B2 sittings merge', () => {
    const vs = [v('b1', 'B1', 0, { 'lab.sspan': 70 }),
      v('b2a', 'B2', 4, { 'lab.sspan': 50 }), v('b2b', 'B2', 5, { 'lab.matrix': 0.5 }),
      v('q', 'Q', 20, { 'lab.sspan': 55 }), v('p', 'POST', 40, { 'lab.sspan': 58 })];
    const c = L.compare(recs(vs, CAL));
    t.eq([c['lab.sspan'].b2, c['lab.sspan'].latest, c['lab.sspan'].latestKind], [50, 58, 'POST']);
    t.eq(c['lab.matrix'].verdict, 'uncalibrated'); t.eq(c['lab.matrix'].b2, 0.5); t.eq(c['lab.matrix'].latest, null);
    const scores = L.visitScores(recs(vs));
    t.eq(scores.map(x => x.kind), ['B1', 'B2', 'Q', 'POST']);
    t.eq(scores[1].scores, { 'lab.sspan': 50, 'lab.matrix': 0.5 });
  });

  await t.test('verdict precedence: no-baseline, uncalibrated (missing or n < 50), null before any retest', () => {
    const noB2 = L.compare(recs([v('b1', 'B1', 0, { 'lab.sspan': 50 }), v('p', 'POST', 40, { 'lab.sspan': 60 })], CAL));
    t.eq([noB2['lab.sspan'].verdict, noB2['lab.sspan'].b2, noB2['lab.sspan'].latest], ['no-baseline', null, 60]);
    const unc = L.compare(recs([v('b2', 'B2', 4, { 'lab.update': 0.5 }), v('p', 'POST', 40, { 'lab.update': 0.9 })], CAL));
    t.eq(unc['lab.update'].verdict, 'uncalibrated', 'n 49 < 50'); t.near(unc['lab.update'].change, 0.4, 1e-12);
    const none = L.compare(recs([v('b2', 'B2', 4, { 'lab.sspan': 50 })], CAL));
    t.eq([none['lab.sspan'].verdict, none['lab.sspan'].latest, none['lab.sspan'].rci], [null, null, null]);
    t.near(none['lab.sspan'].band, 12.396, 1e-3);
    const nocal = L.compare(recs([v('b2', 'B2', 4, { 'lab.sspan': 50 }), v('p', 'POST', 40, { 'lab.sspan': 70 })]));
    t.eq(nocal['lab.sspan'].verdict, 'uncalibrated'); t.eq(nocal['lab.sspan'].change, 20);
    const bad = L.compare(recs([v('b2', 'B2', 4, { 'lab.sspan': 50 }), v('p', 'POST', 40, { 'lab.sspan': 70 })],
      { tests: { 'lab.sspan': { r: 1, sd: 10, n: 80 } } }));
    t.eq(bad['lab.sspan'].verdict, 'uncalibrated', 'r = 1 is unusable');
    t.eq(Object.keys(L.compare(recs([]))).length, 0);
  });

  await t.test('practice-adjusted RCI and direction from the registry', () => {
    const cal = { tests: { 'lab.sspan': { r: 0.8, sd: 10, mean: 50, n: 60, practice: 2, practiceN: 40 } } };   // practice needs practiceN ≥ 30 (SC-08)
    const c = L.compare(recs([v('b2', 'B2', 4, { 'lab.sspan': 50 }), v('p', 'POST', 40, { 'lab.sspan': 60 })], cal))['lab.sspan'];
    t.near(c.rciPractice, 8 / (10 * Math.sqrt(0.4)), 1e-9); t.eq(c.higherIsBetter, true);
  });

  await t.test('composites: mean z per level from calibration, sign flipped when lower is better', () => {
    const cal = { tests: { 'lab.sspan': { r: 0.8, sd: 10, mean: 50, n: 60 }, 'lab.zz-cost': { r: 0.8, sd: 2, mean: 10, n: 60 } } };
    L.register({ id: 'lab.zz-cost', label: 'cost', paradigm: 'x', minutes: 1, defaultLevel: 'mid', higherIsBetter: false, gen() {}, score() {} });
    try {
      const comp = L.composites(recs([v('b2', 'B2', 4, { 'lab.sspan': 60, 'lab.zz-cost': 6, 'lab.matrix': 0.7 })], cal));
      t.eq(comp.length, 1);
      t.near(comp[0].mid, (1 + 2) / 2, 1e-12); t.eq(comp[0].near, null); t.eq(comp[0].far, null);
      t.eq(comp[0].n, { near: 0, mid: 2, far: 0 });
    } finally { delete L.tests['lab.zz-cost']; }
  });

  await t.test('levels: near / mid / far from the training log (PLAN §6)', () => {
    const blocks = (track, n, role) => Array.from({ length: n }, (_, k) => ({ id: track + k, trackId: track, role: role || 'rated' }));
    let lv = L.levels(recs([], null, []));
    t.eq(['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind', 'lab.switch', 'lab.matrix', 'lab.series', 'lab.graph'].map(id => lv[id].level),
      ['mid', 'mid', 'mid', 'mid', 'mid', 'mid', 'far', 'far', 'far']);
    lv = L.levels(recs([], null, blocks('nback.plain', 12).concat(blocks('rel.grid.T1', 12))));
    t.eq([lv['lab.nback'].level, lv['lab.rel'].level, lv['lab.matrix'].closer, lv['lab.switch'].closer], ['near', 'near', 'mid', null]);
    lv = L.levels(recs([], null, blocks('rel.steps', 30)));
    t.eq([lv['lab.rel'].level, lv['lab.nback'].level, lv['lab.series'].closer], ['mid', 'mid', 'mid']);
    t.ok(lv['lab.rel'].note.includes('Equal Steps has no near probe'), lv['lab.rel'].note);
    lv = L.levels(recs([], null, blocks('nback.switch', 10).concat(blocks('span.op', 10))));
    t.eq([lv['lab.nback'].level, lv['lab.switch'].level, lv['lab.switch'].closer, lv['lab.sspan'].level], ['near', 'mid', 'near', 'near']);
    lv = L.levels(recs([], null, blocks('nback.plain', 30, 'tutorial').concat(blocks('nback.plain', 30, 'probe'), blocks('nback.plain', 9))));
    t.eq(lv['lab.nback'].level, 'mid', 'tutorial and probe blocks do not count; 9 < 10');
    lv = L.levels(recs([], null, blocks('vs.search', 200)));
    t.eq([lv['lab.nback'].level, lv['lab.rel'].level, lv['lab.matrix'].closer], ['mid', 'mid', null], 'visual-search control');
    t.eq(L.trained(recs([], null, blocks('rel.stream', 3))).stream, 3);
    t.eq(L.levels(recs([], null, blocks('rel.stream', 10)))['lab.rel'].level, 'near');
  });
}
