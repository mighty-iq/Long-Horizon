// lab.switch — sequences (independent check), forms, cues, scoring of switch and mixing costs (SPEC §4.6).
import { HF, load, ROOT } from './load.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
load('js/lab/tests/switch.js');
const W = require(path.join(ROOT, 'js/lab/tests/switch.js'));

const flip = k => (k === 'no' ? 'match' : 'no');

/** Builds a log from a per-trial function returning { response, rt } (or null for a missing answer). */
function makeLog(spec, fn) {
  const answers = [];
  spec.trials.forEach(t => { const a = fn(t); if (a) answers.push(Object.assign({ i: t.i, voided: false }, a)); });
  return { answers, paused: false };
}
const RT = { first: 900, pure: 500, repeat: 600, switch: 750 };

export default async function (t) {
  await t.test('switch: 10,000 generated sequences pass the independent check', () => {
    let fallback = 0;
    for (let s = 0; s < 10000; s++) {
      const spec = W.gen({ form: 'ABCD'[s % 4], seed: 'unit-switch-' + s });
      const c = W.check(spec);
      t.ok(c.ok, 'seed ' + s + ': ' + c.problems.slice(0, 4).join('; '));
      if (spec.meta.fallback) fallback++;
      t.eq(spec.trials.length, 81);
      t.eq([spec.meta.switches, spec.meta.repeats], [24, 24]);
    }
    t.eq(fallback, 0);
  });

  await t.test('switch: forms, blocks, practice and cues', () => {
    const forms = ['A', 'B', 'C', 'D'].map(f => W.gen({ form: f }));
    t.eq(forms.map(s => s.params.pureOrder[0]), ['magnitude', 'parity', 'magnitude', 'parity'], 'pure-block order counterbalanced');
    for (const s of forms) {
      t.ok(s.release); t.ok(W.check(s).ok);
      t.eq(s.blocks.map(b => [b.kind, b.to - b.from + 1]), [['pure', 16], ['pure', 16], ['mixed', 49]]);
      t.eq([s.windowMs, s.itiMs, s.params.fixationMs, s.params.blankMs], [3000, 150, 100, 50]);
      t.eq(s.blocks.map(b => b.practice.length), [4, 4, 8]);
      for (const b of s.blocks) for (const p of b.practice) t.eq(p.answer, W.correctKey(p.stim.digit, p.stim.task), 'practice keys');
      const mixP = s.blocks[2].practice;
      t.eq(mixP.filter(p => p.meta.trialType === 'switch').length, 4);
    }
    t.eq(JSON.stringify(W.gen({ form: 'B' })), JSON.stringify(forms[1]), 'deterministic');
    const p = W.practice();
    t.eq([p.form, p.trials.length, p.blocks.length], ['P', 16, 3]);
    t.ok(W.check(Object.assign({}, p, { trials: p.trials })).problems.every(x => /length|balance|count|digit [0-9]|congruency/.test(x)), 'practice keys and trial types consistent');
    // a cue is never colour alone: word, frame and colour all differ between the two tasks
    const c = W.CUES;
    t.ok(c.magnitude.word !== c.parity.word && c.magnitude.frame !== c.parity.frame && c.magnitude.color !== c.parity.color);
    t.eq([c.magnitude.left, c.magnitude.right, c.parity.left, c.parity.right], ['LOW', 'HIGH', 'ODD', 'EVEN']);
    // F = left = 'no' = low/odd; J = right = 'match' = high/even; 5 never shown
    t.eq([1, 4, 6, 9].map(d => W.correctKey(d, 'magnitude')), ['no', 'no', 'match', 'match']);
    t.eq([1, 4, 6, 9].map(d => W.correctKey(d, 'parity')), ['no', 'match', 'match', 'no']);
    t.ok(forms.every(s => s.trials.every(x => x.stim.digit !== 5)));
  });

  await t.test('switch: costs from a perfect, noise-free responder', () => {
    const spec = W.gen({ form: 'A' });
    const r = W.score(spec, makeLog(spec, x => ({ response: x.answer, rt: RT[x.meta.trialType] })));
    t.eq(r.score, 150); t.eq(r.sub.switchCostRt, 150); t.eq(r.sub.mixingCostRt, 100);
    t.eq(r.sub.pureMedianRt, 500); t.eq(r.sub.speedCheck.pureMedianRt, 500);
    t.eq([r.sub.switchCostEr, r.sub.mixingCostEr], [0, 0]);
    t.eq(r.sub.usable, { pure: 30, repeat: 24, switch: 24 });
    t.eq(r.flags, ['exploratory']);
    t.eq([r.higherIsBetter, r.unit, r.exploratory, r.testId, r.version], [false, 'ms', true, 'lab.switch', 1]);
    t.ok(/150 ms/.test(r.scoreLabel));
    const lr = W.score(spec, makeLog(spec, x => ({ response: x.answer === 'no' ? 'left' : 'right', rt: RT[x.meta.trialType] })));
    t.eq(lr.score, 150, "'left'/'right' responses are accepted");
  });

  await t.test('switch: errors, post-error trials, anticipations and timeouts', () => {
    const spec = W.gen({ form: 'C' });
    const sw = spec.trials.filter(x => x.meta.trialType === 'switch');
    const errAt = new Set([sw[2].i, sw[9].i]);           // two errors on switch trials
    const antAt = new Set([spec.trials.find(x => x.meta.trialType === 'pure' && x.i > 3 && !errAt.has(x.i - 1)).i]);
    const toAt = new Set([spec.trials.filter(x => x.meta.trialType === 'repeat')[5].i]);
    const log = makeLog(spec, x => {
      if (errAt.has(x.i)) return { response: flip(x.answer), rt: 700 };
      if (toAt.has(x.i)) return { response: null, rt: null, timedOut: true };
      if (antAt.has(x.i)) return { response: x.answer, rt: 150 };
      return { response: x.answer, rt: RT[x.meta.trialType] };
    });
    const r = W.score(spec, log);
    t.near(r.sub.errorRate.switch, 2 / 24, 1e-12);
    t.near(r.sub.errorRate.repeat, 1 / 24, 1e-12, 'timeout counts as an error');
    t.eq(r.sub.errorRate.pure, 0);
    t.eq([r.sub.timeouts, r.sub.anticipations], [1, 1]);
    t.near(r.sub.switchCostEr, 1 / 24, 1e-4);
    t.eq(r.sub.switchCostRt, 150); t.eq(r.sub.mixingCostRt, 100);
    const rows = W.rows(spec, log);
    const after = new Set([...errAt, ...toAt].map(i => i + 1));
    for (const row of rows) {
      if (after.has(row.i) && row.correct && row.trialType !== 'first') t.eq(row.excluded, 'after-error', 'trial after an error is excluded from RT');
      if (antAt.has(row.i)) t.eq(row.excluded, 'anticipation');
      if (row.trialType === 'first') t.eq(row.rtUsed, false);
    }
    const nUsed = rows.filter(x => x.rtUsed).length;
    t.eq(r.sub.usable.pure + r.sub.usable.repeat + r.sub.usable.switch, nUsed);
  });

  await t.test('switch: flags for missing data, low accuracy and voided trials', () => {
    const spec = W.gen({ form: 'D' });
    const pureOnly = W.score(spec, makeLog(spec, x => x.block === 'mixed' ? null : ({ response: x.answer, rt: 500 })));
    t.eq(pureOnly.score, null); t.ok(pureOnly.flags.indexOf('insufficient-data') >= 0 && pureOnly.flags.indexOf('incomplete') >= 0);
    t.eq(pureOnly.sub.pureMedianRt, 500, 'the speed check survives an abandoned mixed block');
    const r = HF.rng.create('guesser');
    const guess = W.score(spec, makeLog(spec, x => ({ response: r.chance(0.5) ? 'no' : 'match', rt: 400 })));
    t.ok(guess.flags.indexOf('low-accuracy') >= 0, 'random keys flag low accuracy');
    const vo = W.score(spec, makeLog(spec, x => ({ response: x.answer, rt: 500, voided: x.i % 8 === 0 })));
    t.ok(vo.flags.indexOf('many-voided') >= 0);
    const ant = W.score(spec, makeLog(spec, x => ({ response: x.answer, rt: x.i % 10 === 0 ? 120 : 500 })));
    t.ok(ant.flags.indexOf('anticipations') >= 0);
  });
}
