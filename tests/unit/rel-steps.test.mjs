// Equal Steps (rel.steps): exact counts, independent solver, shortcut responders, Wang's worked example.
// Three families × 12 levels: 6 targets + 4 near misses (default), 10 + 4 (Wang protocol, SPEC §5 amended 6 Nov) and
// 6 + 6 (Stretch: lureCount 6, amended 12 Nov so that the ±1 responder stays below Stretch's U).
// The 10,000-seed loops run in worker threads when available.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { HF, load } from './load.mjs';

for (const f of ['js/tasks/relations/steps.js', 'js/tasks/relations/grid.js', 'js/tasks/relations/stream.js', 'js/tasks/relations/score.js']) load(f);

const SEEDS = 10000, SHORTCUT_BLOCKS = 2000, FAMILIES = [[6, 4], [10, 4], [6, 6]];   // [targets, near misses]
const LEVELS = [[1, 9], [1, 19], [1, 29], [1, 39], [2, 9], [2, 19], [2, 29], [2, 39], [3, 9], [3, 19], [3, 29], [3, 39]];

// Independent solver: written from the rule text only (unsigned step at lag b repeats; a step of 0 never counts).
function solve(xs, b) {
  return xs.map((x, t) => {
    if (t < b + 1) return { scorable: false, target: false, near: false };
    const now = Math.abs(xs[t] - xs[t - b]), prev = Math.abs(xs[t - 1] - xs[t - 1 - b]);
    return { scorable: true, target: now === prev && now > 0, near: Math.abs(now - prev) === 1 };
  });
}
const numbers = (spec) => spec.trials.map((tr) => tr.stim.main.number);
function blockBA(xs, b, press) {
  let h = 0, fa = 0, nT = 0, nN = 0;
  const sol = solve(xs, b);
  for (let t = b + 1; t < xs.length; t++) {
    const p = press(xs, b, t);
    if (sol[t].target) { nT++; if (p) h++; } else { nN++; if (p) fa++; }
  }
  return { ba: (h / nT + (1 - fa / nN)) / 2, raw: (h + nN - fa) / (nT + nN) };
}
const R = {
  always: () => true,
  never: () => false,
  smallStep: (x, b, t) => Math.abs(x[t] - x[t - b]) <= 2,                 // "press if the last step ≤ 2"
  smallAdjacent: (x, b, t) => Math.abs(x[t] - x[t - 1]) <= 2,             // same, on neighbouring numbers
  familiarity: (x, b, t) => { for (let k = 1; k <= b + 1; k++) if (x[t - k] === x[t]) return true; return false; },
  wrongLag: (x, b, t) => Math.abs(x[t] - x[t - 1]) === Math.abs(x[t - 1] - x[t - 2]), // the 1-back rule at every level
  bigStep: (x, b, t) => Math.abs(x[t] - x[t - b]) >= 3,
};
const withinOne = (x, b, t) => Math.abs(Math.abs(x[t] - x[t - b]) - Math.abs(x[t - 1] - x[t - 1 - b])) <= 1;
const sameDirection = (x, b, t) => Math.sign(x[t] - x[t - 1]) === Math.sign(x[t - 1] - x[t - 2]);

/** One block: counts, solver agreement, range, no zero steps. Returns an error string or null. */
function checkBlock(spec, L, nT, i, nN = 4) {
  const [b, M] = LEVELS[L], xs = numbers(spec), sol = solve(xs, b), tag = `L${L} targets ${nT} near ${nN} seed ${i}`;
  if (spec.meta.fallback) return tag + ': fallback used';
  if (xs.length !== b + 21 || spec.leadIn !== b + 1) return tag + ': length';
  if (spec.meta.targets.main !== nT || spec.meta.lures.main !== nN || spec.meta.lureCount !== nN || spec.params.targets !== nT || spec.params.nearMisses !== nN) return tag + ': meta counts';
  let cT = 0, cN = 0, cS = 0;
  for (let k = 0; k < xs.length; k++) {
    const tr = spec.trials[k];
    if (!(Number.isInteger(xs[k]) && xs[k] >= 1 && xs[k] <= M)) return tag + `: number ${xs[k]} out of 1–${M}`;
    if (k >= b && xs[k] === xs[k - b]) return tag + `: step 0 at ${k}`;
    if (tr.i !== k || tr.scorable !== sol[k].scorable) return tag + `: scorable flag at ${k}`;
    if (tr.target.main !== sol[k].target) return tag + `: target flag at ${k}`;
    const near = sol[k].scorable && !sol[k].target && sol[k].near;
    if ((tr.lure.main === 'near') !== near) return tag + `: lure flag at ${k}`;
    if (sol[k].scorable) cS++;
    if (sol[k].target) cT++; else if (near) cN++;
  }
  if (cS !== 20 || cT !== nT || cN !== nN) return tag + `: counts ${cS}/${cT}/${cN}`;
  return null;
}

/** Seeds [from, to) for both families and all 12 levels. */
function runChunk({ from, to }) {
  const S = HF.tasks.relations.steps, out = {};
  for (const [nT, nN] of FAMILIES) {
    for (let L = 0; L < 12; L++) {
      const b = LEVELS[L][0], res = { blocks: 0, errors: [], ba: {}, n: 0, withinOne: [], withinOneRaw: [], dir: 0 };
      for (let i = from; i < to; i++) {
        const spec = S.gen({ trackId: 'rel.steps', rung: 2 * L + (i & 1), seed: nN === 4 ? `st${nT}-${L}-${i}` : `st${nT}n${nN}-${L}-${i}`,
          targets: nT === 6 ? undefined : nT, lureCount: nN === 4 ? undefined : nN, protocol: nT === 10 ? 'wang' : null });
        res.blocks++;
        const err = checkBlock(spec, L, nT, i, nN);
        if (err && res.errors.length < 5) res.errors.push(err);
        if (i < SHORTCUT_BLOCKS) {
          const xs = numbers(spec);
          res.n++;
          for (const [k, f] of Object.entries(R)) res.ba[k] = (res.ba[k] || 0) + blockBA(xs, b, f).ba;
          const pm = blockBA(xs, b, withinOne);
          if (res.withinOne.length < 3 && (Math.abs(pm.ba - (1 + (20 - nT - nN) / (20 - nT)) / 2) > 1e-12 || Math.abs(pm.raw - ((20 - nN) / 20)) > 1e-12)) res.withinOne.push(`${pm.ba}/${pm.raw}`);
          if (b === 1) res.dir += blockBA(xs, b, sameDirection).ba;
        }
      }
      out[nT + '-' + nN + '/' + L] = res;
    }
  }
  return out;
}

if (!isMainThread && workerData && workerData.relStepsChunk) parentPort.postMessage(runChunk(workerData));

function inWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: Object.assign({ relStepsChunk: true }, data) });
    w.once('message', resolve); w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error('worker exit ' + code)); });
  });
}

export default async function (t) {
  const S = HF.tasks.relations.steps;

  await t.test('steps: rung → level, back, range and pace (SPEC §5); targets option', () => {
    for (let r = 0; r <= 23; r++) {
      const p = S.params(r), L = Math.floor(r / 2);
      t.eq([p.level, p.back, p.maxNumber], [L, LEVELS[L][0], LEVELS[L][1]], 'rung ' + r);
      t.eq([p.onMs, p.soaMs], r % 2 ? [500, 2500] : [500, 3000], 'pace ' + r);
      t.eq(p.maxStep, Math.floor((LEVELS[L][1] - 1) / 2));
    }
    t.eq(S.params(99).level, 11); t.eq(S.params(-3).level, 0);
    t.eq([S.targetsOf(undefined), S.targetsOf(10), S.targetsOf('10'), S.targetsOf(0), S.targetsOf(40)], [6, 10, 10, 1, 16]);
    t.eq([S.nearOf(undefined), S.nearOf(6), S.nearOf(9), S.nearOf(-1), S.targetsOf(40, 6), S.targetsOf(40, 0)], [4, 6, 6, 0, 14, 20], 'near-miss count (lureCount) 0–6');
    for (const nT of [1, 8, 12, 16]) {
      const sp = S.gen({ trackId: 'rel.steps', rung: 2, seed: 'n' + nT, targets: nT });
      t.eq(sp.trials.filter((x) => x.target.main).length, nT); t.eq(sp.trials.filter((x) => x.lure.main === 'near').length, 4);
    }
  });

  await t.test("steps: Wang 2025 Fig. 1C worked example (3, 6, 9, 8, 7)", () => {
    const xs = [3, 6, 9, 8, 7];
    // 1-back marks: 9 ✓, 8 ✗, 7 ✓ ; 2-back marks: 8 ✗, 7 ✓ (the 2-back ✓ needs the unsigned rule)
    t.eq([2, 3, 4].map((i) => S.judge(xs, 1, i).target), [true, false, true]);
    t.eq([3, 4].map((i) => S.judge(xs, 2, i).target), [false, true]);
    t.eq(S.judge(xs, 2, 4).sameSign, false);
    t.eq(S.explain(xs, 1, 2), 'Match: 3, 6, 9 — steps of 3 and 3.');
    t.ok(/^Not a match: the steps were 3 and 1/.test(S.explain(xs, 1, 3)));
    t.ok(/^Match: 6 → 8 \(2\) and 9 → 7 \(2\)/.test(S.explain(xs, 2, 4)));
    t.eq(S.explain([5, 8, 12], 1, 2), 'Not a match: the steps were 3 and 4 — close, but not equal.');
  });

  await t.test(`steps: ${SEEDS} seeds × 12 levels × {6 + 4, 10 + 4, 6 + 6} targets + near misses — exact counts, solver, shortcut responders`, async () => {
    const n = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length)));
    const chunks = Array.from({ length: n }, (_, k) => ({ from: Math.floor((k * SEEDS) / n), to: Math.floor(((k + 1) * SEEDS) / n) }));
    let parts;
    try { parts = n > 1 ? await Promise.all(chunks.map(inWorker)) : [runChunk({ from: 0, to: SEEDS })]; }
    catch (e) { parts = [runChunk({ from: 0, to: SEEDS })]; }
    for (const [nT, nN] of FAMILIES) {
      for (let L = 0; L < 12; L++) {
        const key = nT + '-' + nN + '/' + L, b = LEVELS[L][0], tag = `targets ${nT} near ${nN} L${L}`;
        const errors = [].concat(...parts.map((p) => p[key].errors.concat(p[key].withinOne.map((x) => 'within ±1 BA/raw ' + x))));
        t.eq(parts.reduce((s, p) => s + p[key].blocks, 0), SEEDS, tag + ' blocks');
        if (errors.length) throw new Error(tag + ': ' + errors.join(' | '));
        const nSc = parts.reduce((s, p) => s + p[key].n, 0);
        t.eq(nSc, SHORTCUT_BLOCKS);
        for (const k of Object.keys(parts[0][key].ba)) {
          const ba = parts.reduce((s, p) => s + (p[key].ba[k] || 0), 0) / nSc;
          if (k === 'always' || k === 'never') t.near(ba, 0.5, 1e-12, `${tag} ${k}`);
          else if (b === 1 && k === 'wrongLag') continue; // at 1-back this IS the rule
          else t.ok(ba <= 0.60, `${tag} ${k} BA ${ba.toFixed(3)} > .60`);
        }
        // within ±1 of the previous step (SPEC §4.6 approximate responder) presses on the targets and the near
        // misses only: BA = (1 + 10/14)/2 ≈ .857 with 6 targets and 4 near misses, (1 + 8/14)/2 ≈ .786 with 6 and 6
        // (Stretch), (1 + 6/10)/2 = .800 with 10 and 4 — checked per block in runChunk. Same direction at 1-back is inherent to Wang's rule: regression guard only.
        if (b === 1) {
          const dir = parts.reduce((s, p) => s + p[key].dir, 0) / nSc;
          t.ok(dir <= 0.80, `${tag} same-direction BA ${dir.toFixed(3)}`);
        }
      }
    }
  });

  await t.test('steps: deterministic per seed (also after other calls); Wang protocol uses the same generator', () => {
    const first = [0, 7, 15, 23].map((r) => S.gen({ trackId: 'rel.steps', rung: r, seed: 'det' + r }));
    const first10 = [0, 7, 15, 23].map((r) => S.gen({ trackId: 'rel.steps', rung: r, seed: 'det' + r, targets: 10, protocol: 'wang' }));
    for (let i = 0; i < 30; i++) S.gen({ trackId: 'rel.steps', rung: i % 24, seed: 'noise' + i, targets: i & 1 ? 10 : 6 });
    for (const [k, r] of [0, 7, 15, 23].entries()) {
      const a = S.gen({ trackId: 'rel.steps', rung: r, seed: 'det' + r });
      t.eq(a, first[k], 'rung ' + r + ' (after other calls)');
      t.eq(S.gen({ trackId: 'rel.steps', rung: r, seed: 'det' + r, targets: 10, protocol: 'wang' }), first10[k]);
      const w = S.gen({ trackId: 'rel.steps', rung: r, seed: 'det' + r, protocol: 'wang' });
      t.eq(w.meta.protocol, 'wang'); t.eq(numbers(w), numbers(a)); // the protocol flag alone changes nothing
      t.eq(first10[k].meta.targets.main, 10); t.eq(first10[k].meta.protocol, 'wang');
    }
    t.ok(JSON.stringify(numbers(S.gen({ trackId: 'rel.steps', rung: 4, seed: 'x1' }))) !== JSON.stringify(numbers(S.gen({ trackId: 'rel.steps', rung: 4, seed: 'x2' }))));
  });

  await t.test('steps: deterministic fallback is valid at every level for every target / near-miss family', () => {
    for (const [nT, nN] of FAMILIES.concat([[10, 6], [14, 6], [6, 0]])) {
      for (let L = 0; L < 12; L++) {
        const p = S.params(2 * L), xs = S._fallbackBuild(p, nT, nN);
        t.eq(S.verify(xs, p, nT, nN), null, `fallback L${L} targets ${nT} near ${nN}`);
        const sol = solve(xs, p.back);
        t.eq(sol.filter((s) => s.target).length, nT); t.eq(sol.filter((s) => s.scorable && !s.target && s.near).length, nN);
      }
    }
  });

  await t.test('steps: dispatcher routes rel.steps; scorer accuracy is symmetric with 10 targets', () => {
    const a = HF.tasks.relations.gen({ trackId: 'rel.steps', rung: 3, seed: 'd' }), b = S.gen({ trackId: 'rel.steps', rung: 3, seed: 'd' });
    t.eq(a, b); t.eq(a.kind, 'stream'); t.eq(a.streams, ['main']); t.eq(a.meta.targets.main, 6); t.eq(a.meta.lures.main, 4);
    const w = HF.tasks.relations.gen({ trackId: 'rel.steps', rung: 6, seed: 'w', targets: 10, protocol: 'wang' });
    const all = w.trials.filter((x) => x.scorable).map((x) => ({ key: 'match', t: 0, trial: x.i }));
    const never = HF.tasks.relations.score(w, { responses: [] }), always = HF.tasks.relations.score(w, { responses: all });
    t.eq([never.extra.accuracy, always.extra.accuracy, never.ba, always.ba], [0.5, 0.5, 0.5, 0.5]);
  });
}
