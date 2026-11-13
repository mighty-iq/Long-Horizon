// Visual search generator over the full ladder (r 0–19, sizes 8–64): exact counts, solver, layout without overlaps,
// legibility assumptions, shortcut checks (SPEC §4.6).
import { HF, load } from './load.mjs';

load('js/tasks/vsearch/gen.js');
load('js/tasks/vsearch/score.js');

export default async function (t) {
  const V = HF.tasks.vsearch;

  await t.test('vsearch ladder (SPEC §5 amended: r 0–19, sizes 8–64, 1.5 s and 1 s on top)', () => {
    const sizes = [], wins = [];
    for (let r = 0; r <= 19; r++) { const l = V.LADDER(r); sizes.push(l.size); wins.push(l.windowMs); }
    t.eq(sizes, [8, 8, 12, 12, 16, 16, 24, 24, 32, 32, 40, 40, 48, 48, 56, 56, 64, 64, 64, 64]);
    t.eq(wins, Array.from({ length: 18 }, (_, r) => (r % 2 ? 2000 : 3000)).concat([1500, 1000]));
    t.eq(V.MAX_RUNG, 19); t.eq(V.LADDER(99).size, 64); t.eq(V.LADDER(99).windowMs, 1000); t.eq(V.LADDER(-3).size, 8);
    t.eq([V.TRIALS, V.gen({ rung: 5, seed: 'd' }).trials.length, V.gen({ rung: 5, seed: 'd', params: { trials: 40 } }).trials.length], [20, 20, 40],
      'params.trials: training gets 40 from the catalog (SPEC §5 amended 12 Nov, SC-02); 20 without params (lesson check)');
    t.eq(V.gen({ rung: 30, seed: 'clamp' }).rung, 19);
  });

  await t.test('vsearch layout: no grid more than 75 % full, gaps ≥ 1 unit, items ≥ 25 px at a 360 px field', () => {
    for (const size of V.SIZES) {
      const F = V.layout(size);
      t.ok(size <= 0.75 * F.grid * F.grid, size + ' fills ' + size / (F.grid * F.grid));
      t.ok(F.minGap >= 1 - 1e-9, size + ' gap ' + F.minGap);
      t.eq([F.item, F.minFieldPx, F.itemPx], [7, 360, 25.2]);
      t.ok(F.minGap * F.minFieldPx / 100 >= 3.6 - 1e-9, 'gap in px');
      t.eq(F.grid, size > 48 ? 10 : 8);
    }
  });

  await t.test('vsearch gen: counts, solver and non-overlapping layout over 10,000 seeds across all 20 rungs', () => {
    for (let s = 0; s < 10000; s++) {
      const rung = s % 20, lad = V.LADDER(rung), nT = s % 5 === 4 ? 20 : 40;   // training blocks (40) and the default 20
      const spec = V.gen({ trackId: 'vs.search', rung, seed: 'vs' + s, params: nT === 40 ? { trials: 40 } : undefined });
      const F = spec.field, half = F.item / 2, need = F.item + F.minGap - 0.011; // coordinates are rounded to 0.01
      if (spec.kind !== 'discrete' || spec.trials.length !== nT || spec.params.trials !== nT || spec.meta.present !== nT / 2 || spec.windowMs !== lad.windowMs || spec.itiMs !== 500) throw new Error('shape ' + s);
      if (spec.params.size !== lad.size || F.grid !== (lad.size > 48 ? 10 : 8)) throw new Error('size/layout ' + s);
      let present = 0;
      for (const tr of spec.trials) {
        const it = tr.stim.items;
        if (it.length !== lad.size || tr.stim.size !== lad.size) throw new Error('set size ' + s);
        const ts = it.filter(x => x.kind === 'T').length;
        if (tr.stim.present ? ts !== 1 : ts !== 0) throw new Error('T count ' + s);
        if (!it.every(x => x.kind === 'T' || x.kind === 'L')) throw new Error('kind ' + s);
        if (V.solve(tr.stim) !== tr.answer || (tr.answer === 'match') !== tr.stim.present) throw new Error('solver ' + s);
        if (tr.stim.present) { present++; if (it[tr.meta.target].kind !== 'T') throw new Error('meta.target ' + s); }
        const byCell = new Map();
        for (const a of it) {
          if (!(a.cell >= 0 && a.cell < F.grid * F.grid) || byCell.has(a.cell)) throw new Error('cells ' + s);
          byCell.set(a.cell, a);
          if (![0, 90, 180, 270].includes(a.rot)) throw new Error('rot ' + s);
          const cx = (a.cell % F.grid + 0.5) * F.cell, cy = (Math.floor(a.cell / F.grid) + 0.5) * F.cell;
          if (Math.abs(a.x - cx) > F.jitter + 0.006 || Math.abs(a.y - cy) > F.jitter + 0.006) throw new Error('jitter ' + s);
          if (a.x - half < 0 || a.x + half > F.w || a.y - half < 0 || a.y + half > F.h) throw new Error('outside field ' + s);
        }
        // items in non-neighbouring cells are ≥ 2·cell − 2·jitter apart; check every neighbour pair directly
        for (const a of it) {
          const r0 = Math.floor(a.cell / F.grid), c0 = a.cell % F.grid;
          for (let dr = 0; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc <= 0) continue;
            const r1 = r0 + dr, c1 = c0 + dc;
            if (r1 >= F.grid || c1 < 0 || c1 >= F.grid) continue;
            const b = byCell.get(r1 * F.grid + c1);
            if (b && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < need) throw new Error('overlap ' + s);
          }
        }
        if (s % 10 === 0) { // full pairwise check on a tenth of the seeds
          for (let p = 0; p < it.length; p++) for (let q = p + 1; q < it.length; q++) {
            if (Math.max(Math.abs(it[p].x - it[q].x), Math.abs(it[p].y - it[q].y)) < need) throw new Error('pairwise overlap ' + s);
          }
        }
      }
      if (present !== nT / 2) throw new Error('present ' + present);
    }
  });

  await t.test('vsearch gen: deterministic, params override, the T is named in its own grid', () => {
    t.eq(V.gen({ rung: 3, seed: 'z' }), V.gen({ rung: 3, seed: 'z' }));
    t.ok(JSON.stringify(V.gen({ rung: 3, seed: 'z' })) !== JSON.stringify(V.gen({ rung: 3, seed: 'y' })));
    const o = V.gen({ rung: 0, params: { size: 64, windowMs: 2500 }, seed: 'o' });
    t.eq(o.params, { size: 64, windowMs: 2500, trials: 20 }); t.eq(o.trials[0].stim.items.length, 64); t.eq(o.field.grid, 10);
    t.eq([V.gen({ rung: 0, params: { trials: 7 }, seed: 'o' }).trials.length, V.gen({ rung: 0, params: { trials: 0 }, seed: 'o' }).trials.length], [6, 20], 'odd → even, invalid → 20');
    const tr = o.trials.find(x => x.answer === 'match'), T = tr.stim.items[tr.meta.target];
    const why = V.score(o, { answers: [] }).why.find(w => w.i === tr.i).text;
    t.ok(why.includes('row ' + (Math.floor(T.cell / 10) + 1) + ', column ' + (T.cell % 10 + 1)), why);
  });

  await t.test('vsearch shortcuts at chance on all 20 rungs: always / never / orientation count / centre density (2,240 blocks)', () => {
    const ba = { always: 0, never: 0, rot0: 0, centre: 0 };
    let rot0P = 0, rot0A = 0, nP = 0, nA = 0;
    const blocks = 20 * 112;
    for (let s = 0; s < blocks; s++) {
      const spec = V.gen({ rung: s % 20, seed: 'short' + s });
      const answer = (fn) => ({ answers: spec.trials.map(tr => ({ i: tr.i, response: fn(tr) ? 'match' : 'no', rt: 900 })) });
      const size = spec.params.size;
      const zeros = tr => tr.stim.items.filter(x => x.rot === 0).length;
      const centreCount = tr => tr.stim.items.filter(x => Math.abs(x.x - 50) < 25 && Math.abs(x.y - 50) < 25).length;
      ba.always += V.score(spec, answer(() => true)).ba;
      ba.never += V.score(spec, answer(() => false)).ba;
      ba.rot0 += V.score(spec, answer(tr => zeros(tr) > size / 4)).ba;
      ba.centre += V.score(spec, answer(tr => centreCount(tr) > size * 0.25)).ba;
      for (const tr of spec.trials) { if (tr.stim.present) { nP++; rot0P += zeros(tr); } else { nA++; rot0A += zeros(tr); } }
    }
    for (const k of Object.keys(ba)) t.ok(ba[k] / blocks <= 0.53 && ba[k] / blocks >= 0.47, k + ' ' + (ba[k] / blocks).toFixed(3));
    t.near(rot0P / nP, rot0A / nA, 0.05, 'rotation histogram matched');
  });
}
