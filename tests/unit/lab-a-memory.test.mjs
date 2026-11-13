// Lab memory tests lab.sspan, lab.update, lab.bind: exact counts and solvers over 10,000 seeds, shortcut checks,
// form equivalence across A–D, scoring.
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/tests/sspan.js', 'js/lab/tests/update.js', 'js/lab/tests/bind.js']) load(f);

const sorted = a => a.slice().sort((x, y) => x - y);
const FORMS = ['A', 'B', 'C', 'D'];

export default async function (t) {
  const SS = HF.lab.tests['lab.sspan'], UP = HF.lab.tests['lab.update'], BI = HF.lab.tests['lab.bind'];

  /* ---------------- spatial span ---------------- */
  await t.test('lab.sspan: blueprint, symmetry solver and storage cells over 10,000 seeds', () => {
    let blackSym = 0, blackAsym = 0, nSym = 0, nAsym = 0, oddCounts = 0;
    for (let s = 0; s < 10000; s++) {
      const spec = SS.gen({ seed: 'ss' + s });
      if (spec.trials.length !== 12) throw new Error('trials');
      if (sorted(spec.trials.map(x => x.setSize)).join() !== '2,2,2,3,3,3,4,4,4,5,5,5') throw new Error('set sizes ' + s);
      let judg = 0, sym = 0;
      for (const tr of spec.trials) {
        if (tr.pairs.length !== tr.setSize || tr.recallKeypad.length !== 16 || tr.order !== 'forward') throw new Error('trial shape');
        const cells = tr.pairs.map(p => p.mem);
        if (new Set(cells).size !== cells.length || !cells.every(c => c >= 0 && c < 16)) throw new Error('cells ' + s);
        for (const { proc } of tr.pairs) {
          judg++;
          if (proc.rows.length !== 8 || !proc.rows.every(r => /^[01]{8}$/.test(r))) throw new Error('pattern format');
          if (proc.fallback) throw new Error('fallback pattern ' + s);
          const isSym = proc.rows.every(r => r === r.split('').reverse().join(''));
          if (isSym !== proc.symmetric || SS.isSymmetric(proc.rows) !== proc.symmetric) throw new Error('solver disagrees ' + s);
          const black = proc.rows.join('').split('').filter(c => c === '1').length;
          if (black !== proc.black || black < 24 || black > 40) throw new Error('black count ' + black);
          if (black % 2) oddCounts++;
          if (proc.symmetric) { sym++; nSym++; blackSym += black; } else {
            nAsym++; blackAsym += black;
            let mism = 0;
            proc.rows.forEach(r => { for (let c = 0; c < 4; c++) if (r[c] !== r[7 - c]) mism++; });
            if (mism !== 4 && mism !== 6) throw new Error('mismatched pairs ' + mism);
          }
        }
      }
      if (judg !== 42 || sym !== 21) throw new Error('judgements ' + judg + '/' + sym);
    }
    t.eq(oddCounts, 0, 'black-cell parity is always even, so it carries no information');
    t.near(blackSym / nSym, blackAsym / nAsym, 0.1, 'density matched between symmetric and asymmetric patterns');
  });

  await t.test('lab.sspan shortcuts: density and parity heuristics at chance', () => {
    let n = 0, dens = 0, par = 0;
    for (let s = 0; s < 500; s++) {
      for (const tr of SS.gen({ seed: 'sh' + s }).trials) for (const { proc } of tr.pairs) {
        n++;
        if ((proc.black > 32) === proc.symmetric) dens++;
        if ((proc.black % 4 === 0) === proc.symmetric) par++;
      }
    }
    t.ok(Math.abs(dens / n - 0.5) < 0.03, 'density ' + dens / n);
    t.ok(Math.abs(par / n - 0.5) < 0.03, 'parity ' + par / n);
  });

  await t.test('lab.sspan forms A–D: same blueprint, different content', () => {
    const specs = FORMS.map(form => SS.gen({ form }));
    for (const sp of specs) {
      t.eq(sorted(sp.meta.setSizes), [2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]);
      t.eq([sp.meta.judgements, sp.meta.symmetric, sp.meta.cells, sp.procLimitMs, sp.memMs], [42, 21, 42, 6000, 1000]);
    }
    t.eq(new Set(specs.map(sp => JSON.stringify(sp.trials))).size, 4);
  });

  await t.test('lab.sspan score: partial credit (unit and load), judgement floor, voided, incomplete', () => {
    const spec = SS.gen({ form: 'A' });
    const perfect = { trials: spec.trials.map(tr => ({ i: tr.i, proc: tr.pairs.map(p => ({ resp: p.proc.symmetric, rt: 2000 })), recall: tr.pairs.map(p => p.mem) })) };
    const r = SS.score(spec, perfect);
    t.eq([r.score, r.sub.pcl, r.sub.absolute, r.sub.perfect, r.sub.procAcc, r.flags.length], [1, 1, 42, 12, 1, 0]);
    // first trial of size 5 gets 3 in place; one size-2 trial gets 0
    const log = JSON.parse(JSON.stringify(perfect));
    const t5 = spec.trials.find(x => x.setSize === 5), t2 = spec.trials.find(x => x.setSize === 2);
    const L5 = log.trials.find(x => x.i === t5.i), L2 = log.trials.find(x => x.i === t2.i);
    L5.recall = [L5.recall[0], L5.recall[1], L5.recall[2], L5.recall[4], L5.recall[3]];
    L2.recall = [L2.recall[1], L2.recall[0]];
    const r2 = SS.score(spec, log);
    t.near(r2.score, Math.round(((10 + 0.6 + 0) / 12) * 1000) / 1000, 1e-9);
    t.near(r2.sub.pcl, Math.round((38 / 42) * 1000) / 1000, 1e-9);
    t.eq(r2.sub.absolute, 35);
    // judgements: 9 of 42 wrong → .786 < .80
    const bad = JSON.parse(JSON.stringify(perfect));
    let k = 0;
    bad.trials.forEach(L => L.proc.forEach(p => { if (k++ < 9) p.resp = !p.resp; }));
    const r3 = SS.score(spec, bad);
    t.ok(r3.flags.includes('proc-floor'), JSON.stringify(r3.flags)); t.near(r3.sub.procAcc, 0.786, 1e-9);
    const vd = JSON.parse(JSON.stringify(perfect)); vd.trials[0].voided = true; vd.trials[1].voided = true;
    const r4 = SS.score(spec, vd);
    t.ok(r4.flags.includes('interrupted')); t.eq(r4.sub.trials, 10); t.eq(r4.score, 1);
    t.ok(SS.score(spec, { trials: perfect.trials.slice(0, 6) }).flags.includes('incomplete'));
    t.eq(SS.rows(spec, perfect).length, 84);
  });

  await t.test('lab.sspan practice: two fixed trials of two cells', () => {
    const p = SS.practice();
    t.eq(p.trials.map(x => x.setSize), [2, 2]); t.eq(p.meta.symmetric, 2); t.ok(p.practice); t.eq(p, SS.practice());
  });

  /* ---------------- updating ---------------- */
  function replay(tr) {
    const pos = new Array(tr.load).fill(null);
    tr.steps.forEach((st, j) => {
      if (pos.includes(st.cell)) throw new Error('moved onto an occupied cell');
      if (j > 0 && tr.steps[j - 1].colour === st.colour) throw new Error('same colour twice in a row');
      pos[st.colour] = st.cell;
    });
    return pos;
  }

  await t.test('lab.update: blueprint, sequence rules and solver over 10,000 seeds', () => {
    const want = ['2,3', '3,3', '3,4', '2,2,3', '2,3,3', '3,3,3', '2,3,4', '2,2,2,3', '2,2,3,3', '2,3,3,3'].sort().join('|');
    for (let s = 0; s < 10000; s++) {
      const spec = UP.gen({ seed: 'up' + s });
      if (spec.meta.fallback) throw new Error('fallback ' + s);
      if (spec.trials.map(x => sorted(x.positions).join()).sort().join('|') !== want) throw new Error('blueprint ' + s);
      if (spec.meta.colours !== 30 || spec.meta.steps !== 81) throw new Error('totals ' + s);
      for (const tr of spec.trials) {
        const C = tr.load;
        if (tr.colours.length !== C || new Set(tr.colours).size !== C || !tr.colours.every(c => c >= 0 && c < HF.lab.PALETTE.length)) throw new Error('colours');
        if (tr.stepMs !== { 2: 2000, 3: 2400, 4: 2800 }[C]) throw new Error('timing');
        const firsts = tr.steps.slice(0, C).map(x => x.colour);
        if (new Set(firsts).size !== C) throw new Error('first appearances first');
        const counts = new Array(C).fill(0);
        tr.steps.forEach(x => counts[x.colour]++);
        if (counts.join() !== tr.positions.join()) throw new Error('positions per colour');
        const final = replay(tr);
        if (new Set(final).size !== C) throw new Error('final cells distinct');
        if (tr.probes.length !== C || sorted(tr.probes.map(p => p.colour)).join() !== Array.from({ length: C }, (_, k) => k).join()) throw new Error('probes');
        if (!tr.probes.every(p => p.answer === final[p.colour])) throw new Error('solver disagrees ' + s);
      }
    }
  });

  await t.test('lab.update forms A–D share the blueprint; score and rows', () => {
    const specs = FORMS.map(form => UP.gen({ form }));
    for (const sp of specs) t.eq([sp.meta.colours, sp.meta.steps, sorted(sp.meta.loads).join()], [30, 81, '2,2,2,3,3,3,3,4,4,4']);
    t.eq(new Set(specs.map(sp => JSON.stringify(sp.trials))).size, 4);
    const spec = specs[0];
    const perfect = { trials: spec.trials.map(tr => ({ i: tr.i, answers: tr.probes.map((p, j) => ({ probe: j, response: p.answer, rt: 1500 })) })) };
    const r = UP.score(spec, perfect);
    t.eq([r.score, r.sub.correct, r.sub.total, r.flags.length], [1, 30, 30, 0]);
    t.eq(r.sub.byLoad, { 2: 1, 3: 1, 4: 1 });
    const half = JSON.parse(JSON.stringify(perfect));
    let k = 0;
    half.trials.forEach(L => L.answers.forEach(a => { if (k++ % 2) a.response = (a.response + 1) % 9; }));
    t.eq(UP.score(spec, half).sub.correct, 15);
    const none = UP.score(spec, { trials: spec.trials.map(tr => ({ i: tr.i, answers: [] })) });
    t.eq([none.score, none.sub.timeouts], [0, 30]);
    t.eq(UP.rows(spec, perfect).length, 30);
    const p = UP.practice(); t.eq([p.trials.length, p.trials[0].load, p.trials[0].steps.length], [1, 2, 4]); t.eq(p, UP.practice());
  });

  /* ---------------- binding ---------------- */
  await t.test('lab.bind: blueprint, distinct cells and colours, probe solver over 10,000 seeds', () => {
    for (let s = 0; s < 10000; s++) {
      const spec = BI.gen({ seed: 'bi' + s });
      if (sorted(spec.trials.map(x => x.setSize)).join() !== '2,2,3,3,3,4,4,4,5,5,5,6,6,6' || spec.meta.probes !== 58) throw new Error('blueprint ' + s);
      for (const tr of spec.trials) {
        const n = tr.setSize;
        if (tr.items.length !== n || new Set(tr.items.map(x => x.cell)).size !== n || new Set(tr.items.map(x => x.colour)).size !== n) throw new Error('items ' + s);
        if (!tr.items.every(x => x.cell >= 0 && x.cell < 9)) throw new Error('cell range');
        const at = {};
        tr.items.forEach(x => { at[x.cell] = x.colour; });
        if (tr.probes.length !== n || new Set(tr.probes.map(p => p.cell)).size !== n) throw new Error('probes ' + s);
        if (!tr.probes.every(p => at[p.cell] === p.answer)) throw new Error('solver disagrees ' + s);
        if (sorted(tr.options).join() !== sorted(tr.items.map(x => x.colour)).join() || tr.options.join() !== sorted(tr.options).join()) throw new Error('options');
        if (n >= 3 && tr.probes.map(p => p.cell).join() === tr.items.map(x => x.cell).join()) throw new Error('probe order equals presentation order');
      }
    }
  });

  await t.test('lab.bind: colour is never the only cue; forms share the blueprint; scoring', () => {
    const spec = BI.gen({ form: 'A' });
    t.ok(spec.palette.every(p => p.pattern && p.name && p.hex), 'pattern + name for every colour');
    t.eq([spec.showMs, spec.gapMs, spec.grid], [1500, 500, 3]);
    const specs = FORMS.map(form => BI.gen({ form }));
    for (const sp of specs) t.eq([sp.meta.probes, sorted(sp.meta.setSizes).join()], [58, '2,2,3,3,3,4,4,4,5,5,5,6,6,6']);
    t.eq(new Set(specs.map(sp => JSON.stringify(sp.trials))).size, 4);
    const perfect = { trials: spec.trials.map(tr => ({ i: tr.i, answers: tr.probes.map((p, j) => ({ probe: j, response: p.answer, rt: 1200 })) })) };
    const r = BI.score(spec, perfect);
    t.eq([r.score, r.sub.correct, r.sub.total, r.flags.length], [1, 58, 58, 0]);
    t.near(r.sub.chance, Math.round((14 / 58) * 1000) / 1000, 1e-9);
    const first = { trials: spec.trials.map(tr => ({ i: tr.i, answers: tr.probes.map((p, j) => ({ probe: j, response: tr.options[0], rt: 1200 })) })) };
    t.eq(BI.score(spec, first).sub.correct, 14, 'always the first option is right once per trial');
    t.eq(BI.rows(spec, perfect).length, 58);
    const rows = BI.rows(spec, perfect);
    t.ok(rows.every(x => typeof x.correct_answer === 'string' && x.correct), 'rows name the colour by id');
    const vd = JSON.parse(JSON.stringify(perfect)); vd.trials.slice(0, 2).forEach(L => { L.voided = true; });
    t.ok(BI.score(spec, vd).flags.includes('interrupted'));
    const p = BI.practice(); t.eq(p.trials.map(x => x.setSize), [2, 3]); t.eq(p, BI.practice());
  });
}
