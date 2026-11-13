// Relation Stream (rel.stream): 10,000 seeds per rule (rungs cycled) checked by an independent solver; target lines
// exist exactly after the 6 designated changes; shortcut responders over 2,000 blocks per rule.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { HF, load } from './load.mjs';

for (const f of ['js/tasks/relations/steps.js', 'js/tasks/relations/grid.js', 'js/tasks/relations/stream.js', 'js/tasks/relations/score.js']) load(f);

const SEEDS = 10000, SHORTCUT_BLOCKS = 2000;
const RUNGS = [[2000, 1], [1500, 1], [1000, 1], [1000, 2], [750, 2], [750, 3]];
const VARIANTS = ['digits', 'letters', 'icons', 'dots', 'bars', 'glyphs', 'lab'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8]];
const LINE_IDS = ['row1', 'row2', 'row3', 'col1', 'col2', 'col3'];
const LINES_OF_T = Array.from({ length: 9 }, (_, c) => LINES.map((L, i) => (L.includes(c) ? i : -1)).filter((i) => i >= 0));
const LINES_OF = (c) => LINES_OF_T[c];

const rel = (spec, tr) => tr.stim.main.grid.map((cell) => cell[spec.meta.relevantPos]);
const fits3 = (rule, a, b, c) => (rule === 'same' ? a === b && b === c : a !== b && a !== c && b !== c);
function targetLines(rule, s) { const out = []; for (let i = 0; i < 6; i++) { const L = LINES[i]; if (fits3(rule, s[L[0]], s[L[1]], s[L[2]])) out.push(i); } return out; }
const sameCell = (a, b) => (typeof a === 'string' ? a === b : a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
/** Near-miss change, restated: through a changed cell, Same — it equals exactly one of the line's other two;
    Different — the line's other two are equal and it differs from them. */
function nearChange(rule, s, changed) {
  for (const c of changed) for (const li of LINES_OF(c)) {
    const L = LINES[li], o = L[0] === c ? [s[L[1]], s[L[2]]] : L[1] === c ? [s[L[0]], s[L[2]]] : [s[L[0]], s[L[1]]];
    if (rule === 'same' ? (s[c] === o[0]) !== (s[c] === o[1]) : o[0] === o[1] && s[c] !== o[0]) return true;
  }
  return false;
}

function checkBlock(spec, rule, rung, seedIdx, variant) {
  const tag = `${rule} r${rung} seed ${seedIdx}`, [changeMs, k] = RUNGS[rung];
  if (spec.kind !== 'stream' || spec.trials.length !== 31 || spec.leadIn !== 1) return tag + ': shape';
  if (spec.onMs !== changeMs || spec.soaMs !== changeMs || spec.params.cells !== k) return tag + ': timing';
  if (spec.meta.rule.id !== rule || spec.meta.variant !== variant || spec.meta.fallback) return tag + ': meta';
  let nT = 0, lastT = -9, nNear = 0, prev = null;
  for (let j = 0; j < 31; j++) {
    const tr = spec.trials[j], s = rel(spec, tr), tl = targetLines(rule, s), ch = tr.stim.main.changed;
    if (tr.i !== j || tr.scorable !== (j > 0)) return tag + `: trial ${j} flags`;
    if (tl.length > 1) return tag + `: trial ${j} has ${tl.length} target lines`;
    if ((tl.length === 1) !== tr.target.main) return tag + `: trial ${j} target flag`;
    if (j === 0) { if (tl.length || ch.length) return tag + ': initial grid'; prev = tr; continue; }
    if (ch.length !== k || new Set(ch).size !== k) return tag + `: trial ${j} changed ${ch}`;
    const ps = rel(spec, prev);
    for (let c = 0; c < 9; c++) {
      const changed = ch.includes(c);
      if (changed && (s[c] === ps[c] || sameCell(tr.stim.main.grid[c], prev.stim.main.grid[c]))) return tag + `: trial ${j} cell ${c} did not change`;
      if (!changed && !sameCell(tr.stim.main.grid[c], prev.stim.main.grid[c])) return tag + `: trial ${j} cell ${c} changed silently`;
    }
    if (tl.length) {
      nT++;
      if (!LINES[tl[0]].some((c) => ch.includes(c))) return tag + `: trial ${j} target line not through a changed cell`;
      if (tr.line !== LINE_IDS[tl[0]]) return tag + `: trial ${j} line id`;
      if (j - lastT < 2 || j < 3) return tag + `: trial ${j} target too early or consecutive`;
      lastT = j;
    }
    const near = !tl.length && nearChange(rule, s, ch);
    if ((tr.lure.main === 'near') !== near) return tag + `: trial ${j} lure flag`;
    if (near) nNear++;
    prev = tr;
  }
  if (nT !== 6) return tag + `: ${nT} targets`;
  if (spec.meta.lures.main !== nNear || spec.meta.targets.main !== 6) return tag + ': meta counts';
  return null;
}

// responders get per-state facts computed once: f(a) with a = { s, ch, pairMade, uniqueMade, mc, d, pairLine }
function facts(s, ch) {
  const pairMade = ch.some((c) => LINES_OF(c).some((li) => LINES[li].some((x) => x !== c && s[x] === s[c])));
  const uniqueMade = ch.some((c) => LINES_OF(c).some((li) => LINES[li].every((x) => x === c || s[x] !== s[c])));
  const m = new Map(); let mc = 0; for (const x of s) { const k = (m.get(x) || 0) + 1; m.set(x, k); if (k > mc) mc = k; }
  const pairLine = LINES.some((L) => s[L[0]] === s[L[1]] || s[L[0]] === s[L[2]] || s[L[1]] === s[L[2]]);
  return { pairMade, uniqueMade, mc, d: m.size, pairLine };
}
const RESP = {
  always: () => true, never: () => false,
  anyChangeMakesPair: (a) => a.pairMade,
  changedUniqueInALine: (a) => a.uniqueMade,
  noPairMade: (a) => !a.pairMade,
  duplicateCounter: (a) => a.mc >= 3,
  anyPairLine: (a) => a.pairLine,
};
for (let k = 2; k <= 6; k++) { RESP['distinct<=' + k] = (a) => a.d <= k; RESP['distinct>=' + k] = (a) => a.d >= k; }

function runChunk({ from, to }) {
  const S = HF.tasks.relations.stream, out = {};
  for (const rule of ['same', 'different']) {
    const res = { blocks: 0, errors: [], ba: {}, n: 0 };
    for (let i = from; i < to; i++) {
      const rung = i % 6, variant = VARIANTS[i % VARIANTS.length];
      const spec = S.gen({ trackId: 'rel.stream', rung, seed: `rs-${i}`, variant, params: { rule } });
      res.blocks++;
      const err = checkBlock(spec, rule, rung, i, variant);
      if (err && res.errors.length < 5) res.errors.push(err);
      if (i < SHORTCUT_BLOCKS) {
        res.n++;
        const all = spec.trials.map((tr) => (tr.scorable ? facts(rel(spec, tr), tr.stim.main.changed) : null));
        for (const [name, f] of Object.entries(RESP)) {
          let h = 0, fa = 0, nT = 0, nN = 0;
          for (const tr of spec.trials) {
            if (!tr.scorable) continue;
            const p = f(all[tr.i]);
            if (tr.target.main) { nT++; if (p) h++; } else { nN++; if (p) fa++; }
          }
          res.ba[name] = (res.ba[name] || 0) + (h / nT + 1 - fa / nN) / 2;
        }
      }
    }
    out[rule] = res;
  }
  return out;
}

if (!isMainThread && workerData && workerData.relStreamChunk) parentPort.postMessage(runChunk(workerData));

function inWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: Object.assign({ relStreamChunk: true }, data) });
    w.once('message', resolve); w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error('worker exit ' + code)); });
  });
}

export default async function (t) {
  const S = HF.tasks.relations.stream;

  await t.test(`stream: ${SEEDS} seeds per rule — targets only after the 6 designated changes, solver agrees, shortcuts`, async () => {
    const n = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length)));
    const chunks = Array.from({ length: n }, (_, k) => ({ from: Math.floor((k * SEEDS) / n), to: Math.floor(((k + 1) * SEEDS) / n) }));
    let parts;
    try { parts = n > 1 ? await Promise.all(chunks.map(inWorker)) : [runChunk({ from: 0, to: SEEDS })]; }
    catch (e) { parts = [runChunk({ from: 0, to: SEEDS })]; }
    for (const rule of ['same', 'different']) {
      const errors = [].concat(...parts.map((p) => p[rule].errors));
      t.eq(parts.reduce((s, p) => s + p[rule].blocks, 0), SEEDS, rule + ' blocks');
      if (errors.length) throw new Error(errors.join(' | '));
      const nSc = parts.reduce((s, p) => s + p[rule].n, 0);
      t.eq(nSc, SHORTCUT_BLOCKS);
      for (const k of Object.keys(parts[0][rule].ba)) {
        const ba = parts.reduce((s, p) => s + (p[rule].ba[k] || 0), 0) / nSc;
        if (k === 'always' || k === 'never') t.near(ba, 0.5, 1e-12, rule + ' ' + k);
        else t.ok(ba <= 0.60, `${rule} ${k} BA ${ba.toFixed(3)} > .60`);
      }
    }
  });

  await t.test('stream: rung table, deterministic seeds, rule from the seed', () => {
    const first = RUNGS.map((_, r) => S.gen({ trackId: 'rel.stream', rung: r, seed: 'det' + r }));
    for (let i = 0; i < 30; i++) S.gen({ trackId: 'rel.stream', rung: i % 6, seed: 'noise' + i });
    for (let r = 0; r < 6; r++) {
      const a = S.gen({ trackId: 'rel.stream', rung: r, seed: 'det' + r });
      t.eq(a, first[r], 'rung ' + r + ' (after other calls)');
      t.eq([a.params.changeMs, a.params.cells], RUNGS[r]);
      t.ok(a.meta.initialMs >= 3000);
    }
    const rules = new Set();
    for (let i = 0; i < 40; i++) rules.add(S.gen({ trackId: 'rel.stream', rung: 0, seed: 'q' + i }).meta.rule.id);
    t.eq([...rules].sort(), ['different', 'same']);
    t.eq(HF.tasks.relations.gen({ trackId: 'rel.stream', rung: 2, seed: 'q1' }).trackId, 'rel.stream');
  });

  await t.test('stream: relaxed fallback blocks are valid for both rules and every rung', () => {
    for (const rule of ['same', 'different']) {
      for (let r = 0; r < 6; r++) {
        const ctx = S._internal.makeCtx({ trackId: 'rel.stream', rung: r, seed: 'fb', params: { rule } });
        const states = S._internal.fallbackStates(ctx).states; // the exact path gen() takes after 200 failed attempts
        t.ok(states && states.length === 31, rule + ' r' + r);
        let nT = 0;
        for (let j = 0; j < states.length; j++) {
          const tl = targetLines(rule, states[j].s);
          t.ok(tl.length <= 1);
          if (tl.length) { nT++; t.eq(tl[0], states[j].line); }
        }
        t.eq(nT, 6);
      }
    }
  });

  await t.test('stream: explanations come from the same rule', () => {
    const sp = S.gen({ trackId: 'rel.stream', rung: 0, seed: 'ex', params: { rule: 'same' } });
    const ti = sp.trials.findIndex((x) => x.target.main);
    t.ok(/^Match: (Row|Column) [123]: (\S+), \2, \2 — all the same\.$/.test(S.explain(sp, ti)), S.explain(sp, ti));
    const ni = sp.trials.findIndex((x) => x.lure.main === 'near');
    t.ok(/^Not a match: (Row|Column) [123]: .* — two the same, one different\.$/.test(S.explain(sp, ni)), S.explain(sp, ni));
    t.ok(/^The starting grid/.test(S.explain(sp, 0)));
  });
}
