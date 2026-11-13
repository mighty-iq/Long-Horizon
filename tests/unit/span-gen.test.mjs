// Span training generator: exact counts, solver, plausibility, shortcut checks (SPEC §4.6).
import { HF, load } from './load.mjs';

load('js/tasks/span/gen.js');
load('js/tasks/span/score.js');

const TRACKS = ['span.op', 'span.sym', 'span.back'];
const RANGE = { '+': [4, 18], '-': [1, 16] };

export default async function (t) {
  const S = HF.tasks.span;

  await t.test('span gen: exact counts and solver over 10,000 seeds per track', () => {
    for (const trackId of TRACKS) {
      const want = S.TRACKS[trackId];
      for (let s = 0; s < 10000; s++) {
        const rung = s % 8, n = rung + 2;
        const spec = S.gen({ trackId, rung, seed: trackId + ':' + s });
        if (spec.kind !== 'span' || spec.trials.length !== 3) throw new Error('shape ' + s);
        if (spec.params.setSize !== n || spec.set !== want.set) throw new Error('setSize/set ' + s);
        if (spec.meta.fallback) throw new Error('fallback ' + s);
        const symbols = S.SETS[want.set];
        let nTrue = 0;
        const seen = new Set();
        for (const tr of spec.trials) {
          if (tr.setSize !== n || tr.pairs.length !== n || tr.order !== want.order) throw new Error('trial shape ' + s);
          if (tr.recallKeypad.length !== 12 || tr.recallKeypad.join() !== symbols.join()) throw new Error('keypad ' + s);
          const mem = tr.pairs.map(p => p.mem);
          if (new Set(mem).size !== n || !mem.every(m => symbols.includes(m))) throw new Error('memoranda ' + s);
          for (const { proc } of tr.pairs) {
            const value = proc.op === '+' ? proc.a + proc.b : proc.a - proc.b;
            if (value !== proc.value) throw new Error('value ' + s);
            if (S.solve(proc) !== proc.correct || (proc.shown === value) !== proc.correct) throw new Error('solver ' + s);
            const text = `${proc.a} ${proc.op === '+' ? '+' : '−'} ${proc.b} = ${proc.shown}`;
            if (proc.text !== text) throw new Error('text ' + proc.text);
            if (proc.op === '+' && !(proc.a >= 2 && proc.a <= 9 && proc.b >= 2 && proc.b <= 9)) throw new Error('operands + ' + s);
            if (proc.op === '-' && !(proc.b >= 2 && proc.b <= 9 && proc.a > proc.b && proc.a <= 18)) throw new Error('operands - ' + s);
            if (proc.shown < RANGE[proc.op][0] || proc.shown > RANGE[proc.op][1]) throw new Error('range ' + proc.text);
            if (!proc.correct && ![1, 2].includes(Math.abs(proc.shown - value))) throw new Error('wrong answer not plausible ' + proc.text);
            const key = proc.a + proc.op + proc.b;
            if (seen.has(key)) throw new Error('repeated equation ' + s);
            seen.add(key);
            if (proc.correct) nTrue++;
          }
        }
        const total = 3 * n;
        if (nTrue !== Math.floor(total / 2) && nTrue !== Math.ceil(total / 2)) throw new Error('balance ' + nTrue + '/' + total);
        if (spec.meta.procTotal !== total || spec.meta.procCorrect !== nTrue) throw new Error('meta ' + s);
      }
    }
  });

  await t.test('span gen: deterministic per seed, differs across seeds', () => {
    const a = S.gen({ trackId: 'span.op', rung: 3, seed: 'q' }), b = S.gen({ trackId: 'span.op', rung: 3, seed: 'q' });
    const c = S.gen({ trackId: 'span.op', rung: 3, seed: 'r' });
    t.eq(a, b); t.ok(JSON.stringify(a) !== JSON.stringify(c));
  });

  await t.test('span gen: ladder, params override, defaults', () => {
    t.eq([0, 1, 7, 9, -3].map(S.setSizeFor), [2, 3, 9, 9, 2]);
    t.eq(S.gen({ trackId: 'span.sym', rung: 0, params: { setSize: 5 }, seed: 'p' }).params.setSize, 5);
    const d = S.gen({ trackId: 'span.back', seed: 'd' });
    t.eq(d.procLimitMs, 4000); t.eq(d.memMs, 1000); t.eq(d.trials[0].order, 'backward');
    t.eq(S.gen({ trackId: 'span.op', rung: 2, seed: 'x', procLimitMs: 3100 }).procLimitMs, 3100);
  });

  await t.test('span gen shortcuts: always-true ≈ .5, parity check ≤ .80 (< the .85 judgement criterion)', () => {
    let n = 0, always = 0, parity = 0, mag1 = 0, wrong = 0;
    for (let s = 0; s < 2000; s++) {
      const spec = S.gen({ trackId: TRACKS[s % 3], rung: s % 8, seed: 'sc' + s });
      for (const tr of spec.trials) for (const { proc } of tr.pairs) {
        n++;
        if (proc.correct) always++;
        const guess = ((proc.a + proc.b) % 2) === (proc.shown % 2);
        if (guess === proc.correct) parity++;
        if (!proc.correct) { wrong++; if (Math.abs(proc.shown - proc.value) === 1) mag1++; }
      }
    }
    t.near(always / n, 0.5, 0.01, 'always-true');
    t.ok(parity / n <= 0.80, 'parity ' + (parity / n).toFixed(3));
    t.near(mag1 / wrong, 0.5, 0.03, 'off-by-one share');
  });

  await t.test('span practice items and personal processing limit', () => {
    const p = S.genPractice({ seed: 'pp', n: 12 });
    t.eq(p.length, 12); t.eq(p.filter(x => x.correct).length, 6);
    t.ok(p.every(x => S.solve(x) === x.correct));
    t.eq(S.procLimitFrom([1000, 1000]), 4000, 'too few');
    t.eq(S.procLimitFrom([2000, 2000, 2000, 2000, 2000]), 2000);
    const rts = [1000, 1200, 1400, 1600, 1800];
    const m = 1400, sd = Math.sqrt(((400 ** 2) * 2 + (200 ** 2) * 2) / 4);
    t.eq(S.procLimitFrom(rts), Math.round(m + 2.5 * sd));
    t.eq(S.procLimitFrom([9000, 9500, 9900, 9800, 9700, 20000]), 10000, 'clamped');
  });
}
