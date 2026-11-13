// Visual search scorer: SDT counts, timeouts, voiding, plain-language numbers.
import { HF, load } from './load.mjs';

load('js/tasks/vsearch/gen.js');
load('js/tasks/vsearch/score.js');

export default async function (t) {
  const V = HF.tasks.vsearch;
  const spec = V.gen({ rung: 4, seed: 'score' });   // 20 displays (no params): the numbers below

  await t.test('vsearch score: a 40-display training block (SC-02)', () => {
    const s40 = V.gen({ rung: 4, seed: 'score40', params: HF.catalog ? HF.catalog.params('vs.search', 4) : { trials: 40 } });
    const r = V.score(s40, { answers: s40.trials.map(tr => ({ i: tr.i, response: tr.answer, rt: 900 })) });
    t.eq([r.ba, r.streams.main.hits, r.streams.main.crs, r.nScorable, r.why.length], [1, 20, 20, 40, 40]);
  });

  await t.test('vsearch score: perfect block', () => {
    const log = { answers: spec.trials.map(tr => ({ i: tr.i, response: tr.answer, rt: tr.answer === 'match' ? 800 : 1200 })) };
    const r = V.score(spec, log);
    t.eq(r.ba, 1); t.eq(r.streams.main.hits, 10); t.eq(r.streams.main.crs, 10); t.ok(r.dprime > 2.5);
    t.eq(r.plain, { caught: 10, targets: 10, falsePresses: 0, nonTargets: 10 });
    t.eq(r.extra.rtPresent, 800); t.eq(r.extra.rtAbsent, 1200); t.eq(r.why.length, 20);
    t.eq(r.trackId, 'vs.search'); t.eq(r.kind, 'discrete');
  });

  await t.test('vsearch score: timeouts are errors; plain.falsePresses counts real presses only', () => {
    const log = { answers: spec.trials.map(tr => ({ i: tr.i, response: null, rt: null })) };
    const r = V.score(spec, log);
    t.eq(r.ba, 0); t.eq(r.extra.timeouts, { present: 10, absent: 10 });
    t.eq(r.streams.main.misses, 10); t.eq(r.streams.main.fas, 10); t.eq(r.plain.falsePresses, 0);
    t.ok(r.why.every(w => w.text.includes('no answer in time')));
  });

  await t.test('vsearch score: mixed answers and voided displays', () => {
    const P = spec.trials.filter(x => x.answer === 'match'), A = spec.trials.filter(x => x.answer === 'no');
    const answers = [];
    P.forEach((tr, k) => answers.push({ i: tr.i, response: k < 7 ? 'match' : 'no', rt: 900 }));      // 7 hits, 3 misses
    A.forEach((tr, k) => answers.push({ i: tr.i, response: k < 2 ? 'match' : 'no', rt: 1000 }));     // 2 fa, 8 cr
    answers.find(a => a.i === P[0].i).voided = true;                                                  // one hit voided
    const r = V.score(spec, { answers });
    t.eq(r.nVoided, 1); t.eq(r.nScorable, 19); t.near(r.voidedRatio, 0.05, 1e-12);
    t.eq([r.streams.main.hits, r.streams.main.misses, r.streams.main.fas, r.streams.main.crs], [6, 3, 2, 8]);
    t.near(r.ba, (6 / 9 + 8 / 10) / 2, 1e-12); t.near(r.y, 6 / 9 - 2 / 10, 1e-12);
    t.eq(r.plain.falsePresses, 2);
  });
}
