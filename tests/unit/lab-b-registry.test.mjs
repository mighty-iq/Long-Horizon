// Lab B tests register through HF.lab.register when the registry is loaded, else queue in HF.labPending
// (load order never breaks); each loads without a DOM and follows the registry contract.
import { ROOT } from './load.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const FILES = { 'lab.matrix': 'matrix', 'lab.series': 'series', 'lab.graph': 'graph', 'lab.switch': 'switch' };
const src = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function context(withRegistry) {
  const ctx = vm.createContext({ console });
  ctx.globalThis = ctx;
  vm.runInContext(src('js/core/rng.js'), ctx);
  vm.runInContext(src('js/core/stats.js'), ctx);
  if (withRegistry) vm.runInContext(src('js/lab/index.js'), ctx);
  return ctx;
}

export default async function (t) {
  await t.test('lab-b: without the registry the tests queue in HF.labPending', () => {
    const ctx = context(false);
    for (const f of Object.values(FILES)) vm.runInContext(src('js/lab/tests/' + f + '.js'), ctx);
    t.eq(ctx.HF.labPending.map(x => x.id), Object.keys(FILES));
    t.ok(!ctx.HF.lab || !ctx.HF.lab.tests, 'nothing else created');
    const m = ctx.HF.labPending[0].gen({ form: 'A' });
    t.eq(m.seed, 'holdfast/lab/v1/lab.matrix/A', 'release seed without the registry matches HF.lab.formSeed');
  });

  await t.test('lab-b: with the registry they register (and pass its validation)', () => {
    if (!fs.existsSync(path.join(ROOT, 'js/lab/index.js'))) return;
    const ctx = context(true);
    for (const f of Object.values(FILES)) vm.runInContext(src('js/lab/tests/' + f + '.js'), ctx);
    t.ok(!ctx.HF.labPending, 'nothing queued');
    for (const id of Object.keys(FILES)) {
      const test = ctx.HF.lab.tests[id];
      t.ok(test && test.part === 'B' && test.version === 1, id + ' registered as part B');
      const spec = test.gen({ form: 'C' });
      t.eq(spec.seed, ctx.HF.lab.formSeed(id, 'C')); t.ok(spec.release);
      const p = test.practice();
      t.ok(p.practice === true && p.form === 'P' && p.trials.length > 0, id + ' practice spec');
      const r = test.score(spec, { answers: [] });
      t.eq(Object.keys(ctx.HF.lab.makeResult(spec, 0, '', {}, [])).filter(k => !(k in r)), [], id + ' result has the shared fields');
      t.eq([r.testId, r.form, r.seed], [id, 'C', spec.seed]);
    }
    t.eq(ctx.HF.lab.visitMinutes('standard', { part: 'B' }), 27, 'Lab B ≈ 27 min as in PLAN §6');
  });
}
