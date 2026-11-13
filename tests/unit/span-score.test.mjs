// Span training scorer: partial credit, processing accuracy, voiding, why-texts from the same rule.
import { HF, load } from './load.mjs';

load('js/tasks/span/gen.js');
load('js/tasks/span/score.js');

function perfectLog(spec) {
  return {
    trials: spec.trials.map(tr => ({
      i: tr.i,
      proc: tr.pairs.map(p => ({ resp: p.proc.correct, rt: 900 })),
      recall: HF.tasks.span.expected(tr).slice(),
      voided: false
    })),
    paused: false
  };
}

export default async function (t) {
  const S = HF.tasks.span;

  await t.test('span score: perfect block, forward and backward', () => {
    for (const trackId of ['span.op', 'span.sym', 'span.back']) {
      const spec = S.gen({ trackId, rung: 2, seed: 'perfect-' + trackId });
      const r = S.score(spec, perfectLog(spec));
      t.eq(r.ba, 1); t.eq(r.extra.recall, 1); t.eq(r.extra.procAcc, 1); t.eq(r.kind, 'span'); t.eq(r.trackId, trackId);
      t.eq(r.plain, { caught: 12, targets: 12, falsePresses: 0, nonTargets: 12 });
      t.eq(r.why.filter(w => w.stream === 'recall' && w.outcome === 'hit').length, 3);
      t.eq(r.why.filter(w => w.stream === 'proc').length, 0);
      t.ok(r.dprime > 2, 'judgement d′');
      t.eq(r.extra.perfectTrials, 3);
    }
  });

  await t.test('span score: backward needs reverse order; forward order there gets partial credit', () => {
    const spec = S.gen({ trackId: 'span.back', rung: 1, seed: 'bk' }); // set size 3
    const log = perfectLog(spec);
    log.trials[0].recall = spec.trials[0].pairs.map(p => p.mem); // forward order: only the middle item is in place
    const r = S.score(spec, log);
    t.eq(r.extra.itemsCorrect, 3 + 3 + 1); t.near(r.ba, 7 / 9, 1e-12);
    t.ok(r.why[0].text.includes('reverse'), r.why[0].text);
  });

  await t.test('span score: partial credit, null and wrong judgements, voided trial excluded', () => {
    const spec = S.gen({ trackId: 'span.op', rung: 2, seed: 'mix' }); // set size 4, 12 judgements
    const log = perfectLog(spec);
    const m0 = spec.trials[0].pairs.map(p => p.mem);
    log.trials[0].recall = [m0[0], m0[1], 'Z', null];            // 2 of 4
    log.trials[1].voided = true;                                 // excluded entirely
    log.trials[2].proc[0] = { resp: null, rt: null };            // timeout = wrong
    log.trials[2].proc[1] = { resp: !spec.trials[2].pairs[1].proc.correct, rt: 700 }; // wrong
    const r = S.score(spec, log);
    t.eq(r.nScorable, 2); t.eq(r.nVoided, 1); t.near(r.voidedRatio, 1 / 3, 1e-12);
    t.eq(r.extra.itemsTotal, 8); t.eq(r.extra.itemsCorrect, 6); t.near(r.ba, 0.75, 1e-12);
    t.near(r.extra.procAcc, 6 / 8, 1e-12); t.eq(r.extra.procTimeouts, 1);
    t.eq(r.plain.falsePresses, 2); t.eq(r.plain.nonTargets, 8);
    const procWhy = r.why.filter(w => w.stream === 'proc');
    t.eq(procWhy.length, 2);
    t.ok(procWhy.some(w => w.text.includes('no answer in time')), JSON.stringify(procWhy));
    const s = r.streams.proc; t.eq(s.hits + s.misses + s.fas + s.crs, 8);
  });

  await t.test('span score: empty log scores zero without throwing', () => {
    const spec = S.gen({ trackId: 'span.sym', rung: 0, seed: 'empty' });
    const r = S.score(spec, {});
    t.eq(r.ba, 0); t.eq(r.extra.procAcc, 0); t.eq(r.nScorable, 3);
  });
}
