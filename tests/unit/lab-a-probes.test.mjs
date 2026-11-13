// Lab probes lab.nback and lab.rel. They call the training generators lazily; these tests use the real
// HF.tasks.nback.gen / HF.tasks.relations.gen when they load, else a small local stub (printed below).
import { HF, load } from './load.mjs';

load('js/lab/index.js');
load('js/lab/tests/nback-probe.js');
load('js/lab/tests/rel-probe.js');

function tryLoad(files) {
  const errors = [];
  for (const f of files) { try { load(f); } catch (e) { errors.push(f + ': ' + (e && e.message)); } }
  return errors;
}

// ---------- stubs (installed only while a test runs, and only when the real generator is missing) ----------
function stubNback(opts) {
  const n = (opts.params && opts.params.n) || 1 + Math.floor(opts.rung / 2);
  const rng = HF.rng.create('stub-nback/' + opts.seed);
  const len = 20 + n;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const order = rng.shuffle(Array.from({ length: 20 }, (_, k) => k + n));
    const T = new Set(order.slice(0, 6)), Lu = new Set(order.slice(6, 10));
    const items = [];
    let ok = true;
    for (let i = 0; i < len && ok; i++) {
      const back = items[i - n], near = [items[i - n + 1], items[i - n - 1]].filter(x => x != null && i >= n);
      let cand;
      if (T.has(i)) cand = [back];
      else if (Lu.has(i)) cand = near.filter(x => x !== back);
      else cand = [0, 1, 2, 3, 4, 5, 6, 7].filter(x => (i < n || x !== back) && !near.includes(x));
      if (!cand.length) ok = false; else items.push(rng.pick(cand));
    }
    if (!ok) continue;
    return {
      kind: 'stream', task: 'nback', trackId: opts.trackId, seed: opts.seed, set: opts.set, rung: opts.rung,
      params: { n, onMs: 500, soaMs: 3000 }, onMs: 500, soaMs: 3000, streams: ['main'], leadIn: n,
      trials: items.map((x, i) => ({ i, stim: { main: { glyph: opts.set, index: x } }, scorable: i >= n,
        target: { main: T.has(i) }, lure: { main: Lu.has(i) ? 'n±1' : null } })),
      meta: { targets: { main: 6 }, lures: { main: 4 }, rule: { n }, solverChecked: true, stub: true }
    };
  }
  throw new Error('stub n-back failed');
}

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8]];
const LINE_NAMES = ['r0', 'r1', 'r2', 'c0', 'c1', 'c2'];
function relevant(cell, pos) {
  if (typeof cell === 'string') return pos == null ? cell.slice(-1) : cell.charAt(pos);
  if (Array.isArray(cell)) return JSON.stringify(cell[pos == null ? cell.length - 1 : pos]);
  if (cell && typeof cell === 'object') { for (const k of ['rel', 'key', 'value', 'last']) if (cell[k] != null) return JSON.stringify(cell[k]); }
  return null;
}
function targetLines(grid, rule, pos) {
  const v = grid.map(c => relevant(c, pos));
  if (v.some(x => x == null)) return null;
  const hits = [];
  LINES.forEach((l, k) => {
    const s = new Set(l.map(c => v[c]));
    if ((rule === 'same' && s.size === 1) || (rule === 'different' && s.size === 3)) hits.push(LINE_NAMES[k]);
  });
  return hits;
}
function stubRel(opts) {
  const rule = opts.trackId === 'rel.grid.T3' ? 'different' : 'same';
  const rng = HF.rng.create('stub-rel/' + opts.seed);
  const flags = rng.shuffle(Array.from({ length: 20 }, (_, k) => k < 10));
  const trials = flags.map((isT, i) => {
    for (;;) {
      const grid = Array.from({ length: 9 }, () => rng.pick(['x', 'y', 'z']) + rng.pick(['x', 'y', 'z']) + rng.pick(['A', 'B', 'C', 'D']));
      const lines = targetLines(grid, rule);
      if (isT ? lines.length === 1 : lines.length === 0) return { i, stim: { grid, rule }, answer: isT ? 'match' : 'no', meta: { line: isT ? lines[0] : null } };
    }
  });
  return { kind: 'discrete', task: 'relations', trackId: opts.trackId, seed: opts.seed, set: opts.set, rung: opts.rung,
    params: { windowMs: 5500 }, windowMs: 5500, itiMs: 100, trials, meta: { stub: true } };
}

async function withGen(ns, real, stub, fn) {
  HF.tasks = HF.tasks || {};
  const had = HF.tasks[ns];
  if (!real) HF.tasks[ns] = Object.assign({}, had || {}, { gen: stub });
  try { await fn(); } finally { if (!real) { if (had) HF.tasks[ns] = had; else delete HF.tasks[ns]; } }
}

function stimKey(st) { return st && st.glyph != null ? st.glyph + ':' + st.index : JSON.stringify(st); }

function nbackSolve(bs, n) {
  const k = bs.trials.map(tr => stimKey(tr.stim.main));
  let targets = 0, lures = 0, agree = true;
  bs.trials.forEach((tr, i) => {
    if (!tr.scorable) return;
    const isT = k[i] === k[i - n];
    if (isT !== !!tr.target.main) agree = false;
    if (isT) targets++;
    else if (k[i] === k[i - n + 1] || (i - n - 1 >= 0 && k[i] === k[i - n - 1])) lures++;
  });
  return { targets, lures, agree };
}

export default async function (t) {
  const errN = tryLoad(['js/content/sets.js', 'js/tasks/nback/gen.js']);
  const realN = !!(HF.tasks && HF.tasks.nback && typeof HF.tasks.nback.gen === 'function');
  const errR = tryLoad(['js/tasks/relations/steps.js', 'js/tasks/relations/grid.js', 'js/tasks/relations/stream.js', 'js/tasks/relations/score.js']);
  const RR = HF.tasks && HF.tasks.relations;
  const realR = !!(RR && (typeof RR.gen === 'function' || (RR.grid && typeof RR.grid.gen === 'function')));
  console.log('lab-a-probes: n-back probe uses ' + (realN ? 'the REAL HF.tasks.nback.gen' : 'a STUB generator') +
    (errN.length ? ' (load errors: ' + errN.join('; ') + ')' : '') + '; relation probe uses ' +
    (realR ? 'the REAL ' + (typeof RR.gen === 'function' ? 'HF.tasks.relations.gen' : 'HF.tasks.relations.grid.gen (no dispatcher yet)') : 'a STUB generator') + (errR.length ? ' (load errors: ' + errR.join('; ') + ')' : ''));

  const NB = HF.lab.tests['lab.nback'], RP = HF.lab.tests['lab.rel'];

  await t.test('lab.nback without a generator throws a clear error', async () => {
    if (realN) return;
    let msg = '';
    try { NB.gen({ form: 'A' }); } catch (e) { msg = e.message; }
    t.ok(msg.includes('HF.tasks.nback.gen'), msg);
  });

  await withGen('nback', realN, stubNback, async () => {
    await t.test('lab.nback: ABAB blocks, 90 items, 80 scorable, 6 targets + 4 lures each, glyphsLab, solver agrees', () => {
      for (const form of ['A', 'B', 'C', 'D']) {
        const spec = NB.gen({ form });
        t.eq(spec.blocks.map(b => b.trials.length), [22, 23, 22, 23]);
        t.eq(spec.meta.order, [2, 3, 2, 3]);
        t.eq(spec.blocks.reduce((a, b) => a + b.trials.filter(x => x.scorable).length, 0), 80);
        spec.blocks.forEach((bs, b) => {
          const n = spec.meta.order[b];
          const sv = nbackSolve(bs, n);
          t.ok(sv.agree, 'solver agrees with target flags');
          t.eq([sv.targets, sv.lures], [6, 4], 'targets/lures in block ' + b);
          t.ok(bs.trials.every(x => !x.stim.main.glyph || x.stim.main.glyph === 'glyphsLab'), 'Lab-only glyphs');
          t.eq(bs.set, 'glyphsLab');
        });
        t.eq(new Set(spec.blocks.map(b => b.seed)).size, 4);
      }
      t.eq(NB.gen({ form: 'B' }), NB.gen({ form: 'B' }));
      t.ok(JSON.stringify(NB.gen({ form: 'A' }).blocks) !== JSON.stringify(NB.gen({ form: 'B' }).blocks));
    });

    await t.test('lab.nback: many probe seeds keep exact counts and solver agreement (retries replace fallback blocks)', () => {
      const seeds = realN ? 250 : 500; // the n-back agent runs its own 10,000-seed checks on the generator itself
      let retried = 0, blocks = 0;
      for (let s = 0; s < seeds; s++) {
        const spec = NB.gen({ seed: 'many' + s });
        spec.blocks.forEach((bs, b) => {
          blocks++; if (bs.labRetries) retried++;
          const sv = nbackSolve(bs, spec.meta.order[b]);
          if (!sv.agree || sv.targets !== 6 || sv.lures !== 4) throw new Error('seed ' + s + ' block ' + b + ' ' + JSON.stringify(sv));
          if (bs.meta && bs.meta.fallback) throw new Error('fallback block kept');
        });
      }
      console.log('lab-a-probes: ' + blocks + ' probe blocks checked; ' + retried + ' needed a derived seed because the generator fell back');
    });

    await t.test('lab.nback score: perfect presses, lure presses, d′, RT, flags', () => {
      const spec = NB.gen({ form: 'A' });
      const press = (pred, rtMs) => ({ blocks: spec.blocks.map(bs => ({ responses: bs.trials.filter(pred).map(tr => ({ key: 'match', t: tr.i * 3000 + rtMs, trial: tr.i })), voided: [], paused: false })) });
      const perfect = NB.score(spec, press(tr => tr.scorable && tr.target.main, 600));
      const dp = HF.stats.normInv(6.5 / 7) - HF.stats.normInv(0.5 / 15);
      t.near(perfect.score, Math.round(dp * 1000) / 1000, 1e-9);
      t.eq([perfect.sub.hits, perfect.sub.fas, perfect.sub.hitRate, perfect.sub.faRate], [24, 0, 1, 0]);
      t.eq(perfect.sub.rtMedian, 600); t.eq(perfect.flags, []); t.eq(perfect.sub.blocks.length, 4);
      t.near(perfect.sub.dprime2, perfect.sub.dprime3, 1e-9);
      t.eq([perfect.testId, perfect.form], ['lab.nback', 'A']);
      const lures = NB.score(spec, press(tr => tr.scorable && tr.lure.main, 600));
      t.eq([lures.sub.lureFas, lures.sub.lureTrials, lures.sub.lureFaRate], [16, 16, 1]);
      t.ok(lures.score < 0, 'pressing lures only is below chance');
      const fast = NB.score(spec, press(tr => tr.scorable && tr.target.main, 100));
      t.ok(fast.flags.includes('too-fast'), JSON.stringify(fast.flags));
      // RT from logged onsets
      const L = press(tr => tr.scorable && tr.target.main, 600);
      L.blocks.forEach(b => { b.onsets = spec.blocks[0].trials.concat(spec.blocks[1].trials).map((_, i) => i * 3000 + 40); });
      t.eq(NB.score(spec, L).sub.rtMedian, 560);
      // voided + missing block
      const V = press(tr => tr.scorable && tr.target.main, 600);
      V.blocks[0].voided = spec.blocks[0].trials.filter(x => x.scorable).slice(0, 12).map(x => x.i);
      const vr = NB.score(spec, V);
      t.ok(vr.flags.includes('interrupted')); t.eq(vr.sub.voided, 12);
      const miss = NB.score(spec, { blocks: [V.blocks[1]] });
      t.ok(miss.flags.includes('incomplete'));
    });

    await t.test('lab.nback shortcuts: always-press and never-press stay near chance (|d′| < .5, BA = .5)', () => {
      let dAlways = 0, dNever = 0, n = 0;
      for (let s = 0; s < 100; s++) {
        const spec = NB.gen({ seed: 'short' + s });
        const all = { blocks: spec.blocks.map(bs => ({ responses: bs.trials.map(tr => ({ key: 'match', t: tr.i * 3000 + 700, trial: tr.i })) })) };
        const none = { blocks: spec.blocks.map(() => ({ responses: [] })) };
        const a = NB.score(spec, all), z = NB.score(spec, none);
        dAlways += a.score; dNever += z.score; n++;
        t.eq((a.sub.hitRate + 1 - a.sub.faRate) / 2, 0.5); t.eq((z.sub.hitRate + 1 - z.sub.faRate) / 2, 0.5);
      }
      t.ok(Math.abs(dAlways / n) < 0.5 && Math.abs(dNever / n) < 0.5, dAlways / n + ' ' + dNever / n);
    });

    await t.test('lab.nback rows: one row per item with outcome', () => {
      const spec = NB.gen({ form: 'C' });
      const rows = NB.rows(spec, { blocks: spec.blocks.map(() => ({ responses: [] })) });
      t.eq(rows.length, 90);
      t.eq(rows.filter(r => r.outcome === 'miss').length, 24);
      t.ok(rows.every(r => 'rt' in r && 'block_seed' in r));
    });

    await t.test('lab.nback practice: one fixed 2-back block', () => {
      const p = NB.practice(), p2 = NB.practice();
      t.eq(p.blocks.length, 1); t.eq(p.blocks[0].trials.length, 22); t.ok(p.practice); t.eq(p, p2);
    });
  });

  await t.test('lab.rel without a generator throws a clear error', async () => {
    if (realR) return;
    let msg = '';
    try { RP.gen({ form: 'A' }); } catch (e) { msg = e.message; }
    t.ok(msg.includes('HF.tasks.relations.gen'), msg);
  });

  await withGen('relations', realR, stubRel, async () => {
    await t.test('lab.rel: Same then Different, 2 × 20 arrays, 10 targets each, solver agrees', () => {
      let solverRan = 0, solverSkipped = 0;
      for (const form of ['A', 'B', 'C', 'D']) {
        const spec = RP.gen({ form });
        t.eq(spec.blocks.map(b => b.rule), ['same', 'different']);
        t.eq(spec.blocks.map(b => b.trials.length), [20, 20]);
        t.eq(spec.blocks.map(b => b.trials.filter(x => x.answer === 'match').length), [10, 10]);
        t.eq(spec.blocks.map(b => b.trackId), ['rel.grid.T1', 'rel.grid.T3']);
        if (realR) {
          for (const bs of spec.blocks) {
            const lines = bs.trials.filter(x => x.answer === 'match').map(x => String(x.meta && x.meta.line));
            t.eq([lines.filter(l => /^row/.test(l)).length, lines.filter(l => /^col/.test(l)).length], [5, 5], 'targets split between rows and columns');
          }
          t.eq(spec.blocks.map(b => b.windowMs), [5500, 5500]);
        }
        for (const bs of spec.blocks) for (const tr of bs.trials) {
          const grid = tr.stim && (tr.stim.cells || tr.stim.grid);
          const pos = bs.meta && bs.meta.relevantPos != null ? bs.meta.relevantPos : null;
          const lines = Array.isArray(grid) && grid.length === 9 ? targetLines(grid, bs.rule, pos) : null;
          if (!lines) { solverSkipped++; continue; }
          solverRan++;
          if (tr.answer === 'match' ? lines.length !== 1 : lines.length !== 0) throw new Error('rel solver disagrees: ' + JSON.stringify(tr));
        }
      }
      if (solverSkipped) console.log('lab-a-probes: relation solver skipped ' + solverSkipped + ' arrays (unknown stim format)');
      t.ok(solverRan + solverSkipped === 160);
    });

    await t.test('lab.rel: 500 probe seeds (1,000 blocks) — exact counts, one target line or none (independent solver)', () => {
      let arrays = 0;
      for (let s = 0; s < 500; s++) {
        const spec = RP.gen({ seed: 'relmany' + s });
        for (const bs of spec.blocks) {
          if (bs.trials.length !== 20 || bs.trials.filter(x => x.answer === 'match').length !== 10) throw new Error('counts ' + s);
          const pos = bs.meta && bs.meta.relevantPos != null ? bs.meta.relevantPos : null;
          for (const tr of bs.trials) {
            const grid = tr.stim && (tr.stim.cells || tr.stim.grid);
            const lines = Array.isArray(grid) && grid.length === 9 ? targetLines(grid, bs.rule, pos) : null;
            if (!lines) continue;
            arrays++;
            if (tr.answer === 'match' ? lines.length !== 1 : lines.length !== 0) throw new Error('solver ' + s + ' ' + JSON.stringify(tr.stim));
          }
        }
      }
      t.eq(arrays, 20000, 'every array solved');
    });

    await t.test('lab.rel score: hits − false alarms; timeouts count as "no"; flags', () => {
      const spec = RP.gen({ form: 'A' });
      const answer = fn => ({ blocks: spec.blocks.map(bs => ({ answers: bs.trials.map(tr => ({ i: tr.i, response: fn(tr), rt: 2000 })), paused: false })) });
      const perfect = RP.score(spec, answer(tr => tr.answer));
      t.eq([perfect.score, perfect.sub.hitRate, perfect.sub.faRate, perfect.flags.length], [1, 1, 0, 0]);
      t.eq(perfect.sub.same.hmf, 1); t.eq(perfect.sub.different.hmf, 1);
      t.eq(RP.score(spec, answer(() => 'match')).score, 0);
      const to = RP.score(spec, answer(() => null));
      t.eq([to.score, to.sub.timeouts, to.sub.crs], [0, 40, 20]);
      // 15 of 20 targets, 4 of 20 false alarms → .75 − .20
      let k = 0, j = 0;
      const mixed = RP.score(spec, answer(tr => tr.answer === 'match' ? (k++ < 15 ? 'match' : 'no') : (j++ < 4 ? 'match' : 'no')));
      t.near(mixed.score, 0.55, 1e-9);
      const vd = answer(tr => tr.answer); vd.blocks[0].answers.slice(0, 5).forEach(a => { a.voided = true; });
      t.ok(RP.score(spec, vd).flags.includes('interrupted'));
      t.ok(RP.score(spec, { blocks: [vd.blocks[0]] }).flags.includes('incomplete'));
    });

    await t.test('lab.rel practice and rows', () => {
      const p = RP.practice();
      t.eq(p.blocks.map(b => b.trials.length), [4, 4]);
      t.eq(p.blocks.map(b => b.trials.filter(x => x.answer === 'match').length), [2, 2]);
      t.eq(p, RP.practice());
      const spec = RP.gen({ form: 'D' });
      const rows = RP.rows(spec, { blocks: [{ answers: [] }, { answers: [] }] });
      t.eq(rows.length, 40); t.eq(rows.filter(r => r.timeout).length, 40);
    });
  });
}
