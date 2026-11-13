// Lab registry: register(), visit configurations, minutes, forms (Latin square), form seeds, palette, pending queue.
import { createRequire } from 'node:module';
import path from 'node:path';
import { HF, load, ROOT } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/tests/nback-probe.js', 'js/lab/tests/rel-probe.js', 'js/lab/tests/sspan.js',
  'js/lab/tests/update.js', 'js/lab/tests/bind.js']) load(f);

export default async function (t) {
  const L = HF.lab;

  await t.test('register validates and fills defaults', () => {
    const ok = { id: 'lab.zz-temp', label: 'Temp', paradigm: 'temp', minutes: 3, defaultLevel: 'far', gen() { return {}; }, score() { return {}; } };
    const r = L.register(Object.assign({}, ok));
    t.eq([r.part, r.higherIsBetter, r.version], ['A', true, 1]);
    t.ok(L.tests['lab.zz-temp'] === r);
    delete L.tests['lab.zz-temp'];
    for (const bad of [{ id: 'x' }, { minutes: 0 }, { defaultLevel: 'near-ish' }, { gen: null }, { score: 1 }, { part: 'C' }, { label: '' }, { rows: 5 }]) {
      t.throws(() => L.register(Object.assign({}, ok, bad)), 'should reject ' + JSON.stringify(bad));
    }
    t.throws(() => L.register(null));
    t.ok(!L.tests['lab.zz-temp']);
  });

  await t.test('my Lab A tests are registered with the SPEC §7 fields', () => {
    for (const id of ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind']) {
      const x = L.tests[id];
      t.ok(x, id);
      t.eq([x.id, x.part, typeof x.gen, typeof x.score, typeof x.practice, typeof x.rows], [id, 'A', 'function', 'function', 'function', 'function']);
      t.ok(typeof x.label === 'string' && typeof x.paradigm === 'string' && x.minutes > 0, id + ' fields');
    }
    t.eq(['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind'].map(id => L.tests[id].defaultLevel), ['near', 'near', 'mid', 'mid', 'mid']);
  });

  await t.test('visitTests per configuration (PLAN §6)', () => {
    t.eq(L.visitTests('standard'), ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.matrix', 'lab.series', 'lab.graph', 'lab.switch']);
    t.eq(L.visitTests('extended'), ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind', 'lab.matrix', 'lab.series', 'lab.graph', 'lab.switch']);
    t.eq(L.visitTests('minimum'), ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.matrix', 'lab.series']);
    t.eq(L.visitTests('quick'), ['lab.nback', 'lab.rel']);
    t.eq(L.visitTests('nonsense'), L.visitTests('standard'));
    t.eq(L.visitTests('standard', { part: 'B' }), ['lab.matrix', 'lab.series', 'lab.graph', 'lab.switch']);
    t.eq(L.visitTests('extended', { reasoning: false }), ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind']);
    const a = L.visitTests('standard'); a.push('x'); t.eq(L.visitTests('standard').length, 8, 'returns a copy');
  });

  await t.test('visit minutes match PLAN §6 (52 / 57 / 36 / 12)', () => {
    // with the default minutes for the reasoning tests (lab-B registers its own; restore after)
    const saved = {};
    for (const id of ['lab.matrix', 'lab.series', 'lab.graph', 'lab.switch']) { saved[id] = L.tests[id]; delete L.tests[id]; }
    try {
      t.eq([L.visitMinutes('standard'), L.visitMinutes('extended'), L.visitMinutes('minimum'), L.visitMinutes('quick')], [52, 57, 36, 12]);
      t.eq(L.visitMinutes('standard', { part: 'A' }), 25);
      t.eq(L.visitMinutes('standard', { part: 'B' }), 27);
    } finally { for (const id of Object.keys(saved)) if (saved[id]) L.tests[id] = saved[id]; }
  });

  await t.test('forms: balanced Latin square, anonId hash spreads rows evenly', () => {
    const sq = L.LATIN;
    for (const row of sq) t.eq([...row].sort(), ['A', 'B', 'C', 'D']);
    for (let c = 0; c < 4; c++) t.eq(sq.map(r => r[c]).sort(), ['A', 'B', 'C', 'D']);
    const pairs = new Set();
    for (const row of sq) for (let c = 0; c < 3; c++) pairs.add(row[c] + row[c + 1]);
    t.eq(pairs.size, 12, 'every ordered pair of forms adjacent exactly once (Williams design)');
    const counts = {};
    for (let i = 0; i < 4000; i++) { const k = L.formOrder('anon-' + i).join(''); counts[k] = (counts[k] || 0) + 1; }
    t.eq(Object.keys(counts).length, 4);
    t.ok(Object.values(counts).every(n => n > 880 && n < 1120), JSON.stringify(counts));
    t.eq(L.formOrder('abc'), L.formOrder('abc'));
    t.eq(L.formOrder(undefined).length, 4);
  });

  await t.test('form seeds are fixed per (test, form) and variants give fresh sequences', () => {
    t.eq(L.formSeed('lab.sspan', 'B'), 'holdfast/lab/v1/lab.sspan/B');
    t.eq(L.formSeed('lab.sspan', 'B', 'Q1'), 'holdfast/lab/v1/lab.sspan/B/Q1');
    t.eq(L.seedOf('lab.sspan', { form: 'C' }), L.formSeed('lab.sspan', 'C'));
    t.eq(L.seedOf('lab.sspan', { form: 'C', seed: 'own' }), 'own');
    t.throws(() => L.seedOf('lab.sspan', { form: 'E' }));
    const a = L.tests['lab.sspan'].gen({ form: 'A' }), a2 = L.tests['lab.sspan'].gen({ form: 'A' });
    const q = L.tests['lab.sspan'].gen({ form: 'A', seed: L.formSeed('lab.sspan', 'A', 'Q1') });
    t.eq(a, a2); t.ok(JSON.stringify(a.trials) !== JSON.stringify(q.trials));
    t.eq([a.form, a.seed, a.version, a.testId], ['A', 'holdfast/lab/v1/lab.sspan/A', 1, 'lab.sspan']);
  });

  await t.test('palette: Okabe–Ito colours, each with a distinct pattern and name', () => {
    const p = L.PALETTE;
    t.eq(p.map(x => x.hex), ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7']);
    t.eq(new Set(p.map(x => x.pattern)).size, p.length);
    t.eq(new Set(p.map(x => x.name)).size, p.length);
    t.ok(p.every((x, i) => x.index === i && x.label.includes(x.pattern)));
  });

  await t.test('missing() lists unregistered configured tests', () => {
    t.ok(L.missing('quick').length === 0);
    t.ok(Array.isArray(L.missing('standard')));
  });

  await t.test('tests queued in HF.labPending before the registry loads get registered; bad ones are reported', () => {
    const require = createRequire(import.meta.url);
    const abs = path.join(ROOT, 'js/lab/index.js');
    const before = HF.lab;
    HF.labPending = [{ id: 'lab.zz-queued', label: 'Q', paradigm: 'q', minutes: 1, defaultLevel: 'mid', gen() {}, score() {} }, { id: 'bad' }];
    delete require.cache[require.resolve(abs)];
    require(abs);
    try {
      t.ok(HF.lab.tests['lab.zz-queued'], 'queued test registered');
      t.eq(HF.labPending.length, 0); t.eq(HF.lab.pendingErrors.length, 1);
      t.ok(HF.lab.tests['lab.sspan'] && HF.lab.tests === before.tests, 'the registry object is kept');
    } finally { delete before.tests['lab.zz-queued']; HF.lab = before; }
  });
}
