// lab.series — generator, uniqueness solver, cheap guessers, forms, accepted formats, scoring (SPEC §4.6).
import { HF, load, ROOT } from './load.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
load('js/lab/tests/series.js');
const S = require(path.join(ROOT, 'js/lab/tests/series.js'));

const N_ITEMS = 10000;
const FAMS = Object.keys(S.FAMILIES);
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// generator family → the solver family that describes the same rule
const SOLVER_FAMILY = { arith: 'arith', geom: 'geom', second: 'second', twostep: 'cycle2', interleave: 'interleave', fib: 'fib',
  mulAdd: 'mulAdd', cycle3: 'cycle3', lskip: 'arith', lrep: 'rep', linterleave: 'interleave', lgrow: 'second',
  ltwostep: 'cycle2', linterleave2: 'interleave' };
const pos = (item) => item.stim.terms.map(x => item.stim.kind === 'letter' ? ABC.indexOf(x) + 1 : Number(x));

export default async function (t) {
  const hits = {}; const perFam = {};
  await t.test('series: 10,000 items have one answer across all rule families (solver)', () => {
    let fallback = 0;
    for (let i = 0; i < N_ITEMS; i++) {
      const fam = FAMS[i % FAMS.length];
      const item = S.genItem(fam, 'unit-series-' + i);
      if (item.meta.fallback) { fallback++; continue; }
      const sol = S.solve(item);
      t.ok(sol.ok, `item ${i} (${fam}) ${item.stim.display} → ${item.answer}: ${JSON.stringify(sol.predictions)}`);
      t.ok(sol.predictions.some(p => p.family === SOLVER_FAMILY[fam]), `item ${i}: the solver recognises the ${fam} rule`);
      const xs = pos(item);
      if (item.stim.kind === 'letter') t.ok(xs.every(x => x >= 1 && x <= 26) && /^[A-Z]$/.test(item.answer), 'letters A–Z');
      else t.ok(xs.every(x => Number.isInteger(x) && x >= 0 && x <= 999) && /^\d{1,3}$/.test(item.answer), 'numbers 0–999');
      t.ok(xs.length >= 5 && xs.length <= 8, 'five to eight shown terms');
      perFam[fam] = (perFam[fam] || 0) + 1;
      for (const k of Object.keys(S.shortcuts)) {
        const g = S.shortcuts[k](xs);
        if (g === item.meta.answerValue) { hits[k] = hits[k] || {}; hits[k][fam] = (hits[k][fam] || 0) + 1; }
      }
    }
    t.eq(fallback, 0, 'no fallbacks needed');
  });

  await t.test('series: cheap guessers only solve the families whose rule they are', () => {
    const own = { repeatLastDiff: ['arith', 'lskip'], lastRatio: ['geom'] };
    for (const k of Object.keys(S.shortcuts)) {
      for (const fam of Object.keys(hits[k] || {})) {
        t.ok((own[k] || []).indexOf(fam) >= 0, `${k} solved ${hits[k][fam]} ${fam} items`);
      }
    }
    // on a full form: repeat-last-difference solves exactly the 2 constant-step warm-ups out of 14
    for (const f of ['A', 'B', 'C', 'D']) {
      const spec = S.gen({ form: f });
      const n = spec.trials.filter(x => S.shortcuts.repeatLastDiff(pos(x)) === x.meta.answerValue).length;
      t.eq(n, 2, 'form ' + f);
    }
    console.log('  lab.series guessers over ' + N_ITEMS + ' items: repeat-last-difference ' +
      ((Object.values(hits.repeatLastDiff || {}).reduce((a, b) => a + b, 0)) / N_ITEMS * 100).toFixed(1) +
      '% (only arith/lskip), repeat-last-term ' + (Object.values(hits.repeatLastTerm || {}).length) + ' families, two-back ' +
      (Object.values(hits.twoBack || {}).length) + ' families; per form 2/14 = 14.3%');
  });

  await t.test('series: hand-made fallbacks are valid too', () => {
    for (const fam of FAMS) {
      const it = S.fallbackItem(fam);
      t.ok(S.solve(it).ok, 'fallback ' + fam + ' ' + it.stim.display);
      if (!S.FAMILIES[fam].constantStep) {
        for (const k of Object.keys(S.shortcuts)) {
          if (k === 'lastRatio' && S.FAMILIES[fam].constantRatio) continue;
          t.ok(S.shortcuts[k](pos(it)) !== it.meta.answerValue, `fallback ${fam} not solved by ${k}`);
        }
      }
    }
  });

  await t.test('series: forms A–D follow one blueprint (8 number + 6 letter items)', () => {
    const forms = ['A', 'B', 'C', 'D'].map(f => S.gen({ form: f }));
    for (const s of forms) {
      t.eq(s.trials.length, 14); t.ok(s.release); t.eq(s.meta.fallback.length, 0);
      t.eq(s.trials.map(x => x.meta.family), S.BLUEPRINT_ITEMS);
      t.eq(s.trials.map(x => x.meta.nShown), forms[0].trials.map(x => x.meta.nShown));
      t.eq(s.trials.filter(x => x.stim.kind === 'number').length, 8);
      t.eq(s.trials.filter(x => x.stim.kind === 'letter').length, 6);
      for (const x of s.trials) t.ok(S.solve(x).ok);
      t.eq(s.practice.length, 2); t.eq(s.windowMs, 60000);
    }
    t.eq(JSON.stringify(S.gen({ form: 'B' })), JSON.stringify(forms[1]), 'deterministic');
    t.ok(JSON.stringify(forms[0].trials) !== JSON.stringify(forms[3].trials));
    const p = S.practice();
    t.eq(p.form, 'P'); t.eq(p.trials.map(x => x.answer), ['10', 'J']);
    for (const x of p.trials) t.ok(S.solve(x).unique && S.solve(x).answer === x.answer, 'practice items unique');
  });

  await t.test('series: accepted answer formats', () => {
    const cases = [
      ['number', '7', '7'], ['number', '007', '7'], ['number', ' 12 ', '12'], ['number', '+5', '5'], ['number', '12.0', '12'],
      ['number', '１２', '12'], ['number', '12.', '12'], ['number', '-3', null], ['number', '−3', null], ['number', '3 4', '34'],
      ['number', '1,000', null], ['number', 'abc', null], ['number', '', null], ['number', null, null], ['number', '12.5', null],
      ['letter', 'g', 'G'], ['letter', ' K. ', 'K'], ['letter', 'Ｇ', 'G'], ['letter', 'ab', null], ['letter', '7', null],
      ['letter', 'é', null], ['letter', '"Q"', null], ['letter', 'Q"', 'Q']
    ];
    for (const [kind, raw, want] of cases) t.eq(S.normalize(kind, raw), want, `${kind} ${JSON.stringify(raw)}`);
  });

  await t.test('series: scoring with hand-built logs', () => {
    const spec = S.gen({ form: 'A' });
    const tr = spec.trials;
    const fmt = x => x.stim.kind === 'letter' ? x.answer.toLowerCase() + ' ' : '0' + x.answer;   // accepted variants
    const answers = [];
    tr.forEach((x, k) => {
      if (k < 8) answers.push({ i: x.i, response: fmt(x), rt: 12000, voided: false });
      else if (k === 8) answers.push({ i: x.i, response: 'zz', rt: 9000, voided: false });               // invalid → wrong
      else if (k === 9) answers.push({ i: x.i, response: x.stim.kind === 'letter' ? 'A' : '1', rt: 9000, voided: false }); // wrong
      else if (k === 10) answers.push({ i: x.i, response: null, rt: null, voided: false, timedOut: true });
      else if (k === 11) answers.push({ i: x.i, response: x.answer, rt: 5000, voided: true });
      // 12, 13 missing
    });
    const r = S.score(spec, { answers });
    t.near(r.score, 8 / 11, 1e-12);
    t.eq([r.sub.correct, r.sub.n, r.sub.nItems, r.sub.timeouts, r.sub.voided, r.sub.missing, r.sub.invalid], [8, 11, 14, 1, 1, 2, 1]);
    t.eq(r.flags.sort(), ['incomplete']);
    const numbersRight = tr.slice(0, 8).filter(x => x.stim.kind === 'number').length;
    t.eq(r.sub.byKind.number.correct, numbersRight);
    t.eq([r.testId, r.form, r.version], ['lab.series', 'A', 1]);
    const rows = S.rows(spec, { answers });
    t.eq(rows.length, 14);
    t.eq(rows.filter(x => x.correct === true).length, 8);
    t.eq(rows[0].responseCanonical, tr[0].answer);
    const fast = tr.map(x => ({ i: x.i, response: x.answer, rt: 900, voided: false }));
    const rf = S.score(spec, { answers: fast });
    t.eq(rf.score, 1); t.ok(rf.flags.indexOf('too-fast') >= 0);
  });
}
