// Relation Grid (rel.grid.T1–T8): 10,000 seeds per tier checked by an independent solver; pressure-step features;
// matched pairs; shortcut responders over 2,000 blocks per tier. Heavy loops run in worker threads when available.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { HF, load } from './load.mjs';

for (const f of ['js/tasks/relations/steps.js', 'js/tasks/relations/grid.js', 'js/tasks/relations/stream.js', 'js/tasks/relations/score.js']) load(f);

const SEEDS = 10000, SHORTCUT_BLOCKS = 2000;
const TIERS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const VARIANTS = ['digits', 'letters', 'icons', 'dots', 'bars', 'glyphs', 'lab'];
const WINDOWS = [8000, 5500, 5500, 4500, 4500, 4500, 3500, 2750, 2000];

// ---- independent geometry and rules (restated from the module header, not imported) ----
const rows = (n) => Array.from({ length: n }, (_, r) => ({ id: 'row' + (r + 1), kind: 'row', cells: Array.from({ length: n }, (_, c) => r * n + c) }));
const cols = (n) => Array.from({ length: n }, (_, c) => ({ id: 'col' + (c + 1), kind: 'col', cells: Array.from({ length: n }, (_, r) => r * n + c) }));
const LS = {
  rc3: [...rows(3), ...cols(3)],
  rcd3: [...rows(3), ...cols(3), { id: 'diag1', kind: 'diag', cells: [0, 4, 8] }, { id: 'diag2', kind: 'diag', cells: [2, 4, 6] }],
  five: [{ id: 'plus', kind: 'plus', cells: [1, 3, 4, 5, 7] }, { id: 'T-top', kind: 'T', cells: [0, 1, 2, 4, 7] },
    { id: 'T-bottom', kind: 'T', cells: [6, 7, 8, 4, 1] }, { id: 'T-left', kind: 'T', cells: [0, 3, 6, 4, 5] }, { id: 'T-right', kind: 'T', cells: [2, 5, 8, 4, 3] }],
  rc4: [...rows(4), ...cols(4)],
};
const LS_OF = { T1: 'rc3', T2: 'rc3', T3: 'rc3', T4: 'rcd3', T5: 'five', T6: 'rc3', T7: 'rc4', T8: 'five' };
const KINDS = { rc3: { row: 5, col: 5 }, rc4: { row: 5, col: 5 }, rcd3: { row: 4, col: 4, diag: 2 }, five: { plus: 2, T: 8 } };
const TN = { T1: [[1], [2, 3]], T3: [[4, 5], [6]], T4same: [[1], [2, 3]], T4different: [[6, 7], [8]], T5: [[1], [2, 3]],
  T8: [[1, 2], [3, 4]], T2: [[1, 2], [3, 4]], T7same: [[1], [2, 3]], T7different: [[3, 4, 5], [7, 8]] };
const ALPHA = { digits: '0123456789'.split(''), letters: 'BDFGHKMPRT'.split(''), icons: [0, 1, 2, 3, 4, 5, 6, 7],
  bars: [0, 1, 2, 3, 4, 5, 6, 7], glyphs: [0, 1, 2, 3, 4, 5, 6, 7], lab: [0, 1, 2, 3, 4, 5, 6, 7], dots: [1, 2, 3, 4, 5, 6, 7, 8, 9], colors: [0, 1, 2, 3, 4, 5, 6, 7] };
const FILLS = ['solid', 'empty', 'hlines', 'vlines', 'dots', 'checks'];

function distinct(vals) { let n = 0; for (let i = 0; i < vals.length; i++) { let seen = false; for (let j = 0; j < i; j++) if (vals[j] === vals[i]) { seen = true; break; } if (!seen) n++; } return n; }
function maxMult(vals) { let x = 0; for (let i = 0; i < vals.length; i++) { let c = 0; for (let j = 0; j < vals.length; j++) if (vals[j] === vals[i]) c++; if (c > x) x = c; } return x; }
const profile = (vals) => { const m = new Map(); for (const v of vals) m.set(v, (m.get(v) || 0) + 1); return [...m.values()].sort((a, b) => b - a).join('.'); };
function ruleOf(spec, tier) {
  if (tier === 'T1' || tier === 'T5') return 'same';
  if (tier === 'T3' || tier === 'T8') return 'different';
  if (tier === 'T2') return 'ascending';
  if (tier === 'T6') return 'two';
  return spec.meta.rule.id; // T4, T7: shown on the rule card
}
function relevant(spec, tr) { return tr.stim.cells.map((c) => c[spec.meta.relevantPos]); }
function rankOf(spec) {
  const v = spec.meta.variant, key = spec.meta.rule.orderKey;
  if (v === 'digits' || v === 'letters') return (s) => s.charCodeAt(0);
  if (v === 'dots') return (s) => s;
  return (s) => key.indexOf(s);
}
/** For every line: target / near counts (+ T2 descending, T6 same/diff line counts). `vals` = relevant symbols
    (or T6 cells), precomputed once per array. */
function judge(spec, tier, vals, rk) {
  const rule = ruleOf(spec, tier), lines = LS[LS_OF[tier]], out = { targets: [], near: 0, desc: 0, nS: 0, nD: 0, lines };
  if (rule === 'two') {
    const sf = spec.meta.rule.sameFeature, df = sf === 'shape' ? 'fill' : 'shape';
    for (const L of lines) {
      const [a, b, c] = L.cells.map((x) => vals[x]);
      const s = a[sf] === b[sf] && b[sf] === c[sf], d = a[df] !== b[df] && a[df] !== c[df] && b[df] !== c[df];
      if (s) out.nS++; if (d) out.nD++;
      if (s && d) out.targets.push(L.id); else if (s || d) out.near++;
    }
    return out;
  }
  for (const L of lines) {
    const n = L.cells.length;
    let t = false, near = false;
    if (rule === 'same' || rule === 'different') {
      const v = L.cells.map((c) => vals[c]), d = distinct(v);
      if (rule === 'same') { t = d === 1; near = !t && maxMult(v) === n - 1; } else { t = d === n; near = !t && d === n - 1; }
    } else {
      const r0 = rk(vals[L.cells[0]]), r1 = rk(vals[L.cells[1]]), r2 = rk(vals[L.cells[2]]), sc = (r0 < r1) + (r1 < r2) + (r0 < r2);
      t = sc === 3; near = sc === 2; if (r0 > r1 && r1 > r2) out.desc++;
    }
    if (t) out.targets.push(L.id); else if (near) out.near++;
  }
  return out;
}
const sameCell = (a, b) => (typeof a === 'string' ? a === b : (a.shape !== undefined ? a.shape === b.shape && a.fill === b.fill : a[0] === b[0] && a[1] === b[1] && a[2] === b[2]));
const valsOf = (spec, tier, tr) => (tier === 'T6' ? tr.stim.cells : relevant(spec, tr));

/** Checks for one block; returns an error string or null. The brief's invariants (counts, solver, one or zero target
    lines, line kinds) run on every seed; `full` adds formats, pressure-step features and twin profiles (every 3rd seed). */
function checkBlock(spec, tier, rung, seedIdx, wantVariant, full) {
  const tag = `${tier} R${rung + 1} seed ${seedIdx}`, ls = LS_OF[tier], size = ls === 'rc4' ? 4 : 3;
  if (spec.kind !== 'discrete' || spec.trials.length !== 20) return tag + ': shape';
  if (spec.windowMs !== WINDOWS[rung] || spec.itiMs !== 100) return tag + ': timing';
  if (spec.meta.fallback) return tag + ': fallback used';
  const variant = spec.meta.variant, alpha = new Set(ALPHA[variant] || []);
  if (tier === 'T6' ? !['icons', 'glyphs'].includes(variant) : variant !== wantVariant) return tag + ': variant ' + variant;
  if (tier !== 'T6' && spec.meta.relevantPos !== (variant === 'icons' ? 1 : 2)) return tag + ': relevant position';
  const kinds = {}, rule = ruleOf(spec, tier), hi = rung >= 5 ? 1 : 0, rk = tier === 'T2' ? rankOf(spec) : null, pos = spec.meta.relevantPos;
  const vals = spec.trials.map((tr) => valsOf(spec, tier, tr));
  let nMatch = 0;
  for (let i = 0; i < 20; i++) {
    const tr = spec.trials[i], cells = tr.stim.cells;
    if (tr.i !== i || cells.length !== size * size) return tag + `: array ${i} shape`;
    if (full) for (const cell of cells) {
      if (tier === 'T6') {
        if (!(Number.isInteger(cell.shape) && cell.shape >= 0 && cell.shape < 8 && FILLS.includes(cell.fill))) return tag + ': T6 cell';
      } else {
        if ((variant === 'digits' || variant === 'letters') !== (typeof cell === 'string')) return tag + ': cell type';
        if (cell.length !== 3 || !alpha.has(cell[0]) || !alpha.has(cell[1]) || !alpha.has(cell[2])) return tag + `: cell ${cell} not in ${variant}`;
      }
    }
    const j = judge(spec, tier, vals[i], rk);
    if (tr.answer === 'match') {
      nMatch++;
      if (j.targets.length !== 1 || j.targets[0] !== tr.meta.line) return tag + `: array ${i} target lines ${j.targets} vs ${tr.meta.line}`;
      const kind = j.lines.find((L) => L.id === j.targets[0]).kind;
      kinds[kind] = (kinds[kind] || 0) + 1;
    } else if (tr.answer !== 'no' || j.targets.length !== 0) return tag + `: array ${i} has target lines ${j.targets}`;
    if (!full) continue;
    // near-miss density (R1–R5 vs R6–R9)
    if (tier === 'T6') {
      const ok = hi ? [2, 3].includes(j.nS) && [2, 3].includes(j.nD) : j.nS === 1 && [1, 2].includes(j.nD);
      if (!ok) return tag + `: T6 line counts S${j.nS} D${j.nD}`;
    } else {
      const key = tier === 'T4' || tier === 'T7' ? tier + rule : tier, tn = j.targets.length + j.near;
      if (!TN[key][hi].includes(tn)) return tag + `: array ${i} target-or-near lines ${tn}`;
      if (tier === 'T2' && j.desc < 1) return tag + `: array ${i} has no descending lure line`;
    }
    // pressure-step features
    const prev = i > 0 ? spec.trials[i - 1].stim.cells : null, kept = tr.stim.kept;
    if (rung <= 1 && i > 0) { if (kept.length < 1 || kept.length > 4) return tag + `: array ${i} kept ${kept.length}`; }
    else if (kept.length) return tag + `: array ${i} kept strings at R${rung + 1}`;
    if (prev) {
      for (let c = 0; c < cells.length; c++) if (sameCell(cells[c], prev[c]) !== kept.includes(c)) return tag + `: array ${i} cell ${c} kept/replaced mismatch`;
    }
    if (tier !== 'T6') {
      const irr = new Map();
      for (const cell of cells) for (let p = 0; p < 3; p++) if (p !== pos) irr.set(cell[p], (irr.get(cell[p]) || 0) + 1);
      let top = null, topN = 0, second = 0;
      for (const [sym, n] of irr) { if (n > topN) { second = topN; top = sym; topN = n; } else if (n > second) second = n; }
      if (rung >= 4) {
        const d = tr.meta.distractor;
        if (top !== d || topN !== 6 || second >= 6) return tag + `: array ${i} distractors ${top}×${topN}, next ×${second}`;
        if (!vals[i].includes(d)) return tag + `: array ${i} distractor is not a relevant symbol`;
        if (size === 3 && second > 2) return tag + `: array ${i} second irrelevant symbol ×${second}`;
      } else if (topN >= 6 || (size === 3 && topN > 3 && kept.length === 0)) return tag + `: array ${i} irrelevant duplicates ×${topN}`;
    }
  }
  if (nMatch !== 10) return tag + ': ' + nMatch + ' target arrays';
  const wantKinds = KINDS[ls];
  for (const k of Object.keys(wantKinds)) if ((kinds[k] || 0) !== wantKinds[k]) return tag + ': target line kinds ' + JSON.stringify(kinds);
  // matched pairs: a target array and its twin share the relevant-symbol count profile (per feature in T6)
  if (full) for (const tr of spec.trials) {
    if (tr.answer !== 'match') continue;
    const tw = spec.trials[tr.meta.twin];
    if (!tw || tw.answer !== 'no' || tw.meta.twin !== tr.i) return tag + ': twin link';
    if (tier === 'T6') {
      for (const f of ['shape', 'fill']) if (profile(tr.stim.cells.map((c) => c[f])) !== profile(tw.stim.cells.map((c) => c[f]))) return tag + ': T6 twin profile';
    } else if (profile(vals[tr.i]) !== profile(vals[tw.i])) return tag + ': twin profile';
  }
  return null;
}

// ---- shortcut responders: f(a, spec) where a = per-array facts computed once (vals, distinct, maxMult, lines) ----
const anyLine = (tier, vals, pred) => LS[LS_OF[tier]].some((L) => pred(L.cells.map((c) => vals[c])));
function facts(spec, tier, vals) {
  if (tier === 'T6') return { vals };
  return { vals, d: distinct(vals), mm: maxMult(vals), pair: anyLine(tier, vals, (x) => distinct(x) < x.length) };
}
function responders(tier) {
  const base = { always: () => true, never: () => false };
  if (tier === 'T6') {
    return Object.assign(base, {
      pairDetector: (a) => anyLine(tier, a.vals, (x) => distinct(x.map((y) => y.shape)) < 3 || distinct(x.map((y) => y.fill)) < 3),
      sameFeatureOnly: (a, sp) => anyLine(tier, a.vals, (x) => distinct(x.map((y) => y[sp.meta.rule.sameFeature])) === 1),
      diffFeatureOnly: (a, sp) => anyLine(tier, a.vals, (x) => distinct(x.map((y) => y[sp.meta.rule.sameFeature === 'shape' ? 'fill' : 'shape'])) === 3),
      shapeDup3: (a) => maxMult(a.vals.map((c) => c.shape)) >= 3, fillDup3: (a) => maxMult(a.vals.map((c) => c.fill)) >= 3,
    });
  }
  base.pairDetector = (a) => a.pair;
  base.duplicateCounter = (a) => a.mm >= 3;
  for (let k = 2; k <= 9; k++) { base['distinct<=' + k] = (a) => a.d <= k; base['distinct>=' + k] = (a) => a.d >= k; }
  if (tier === 'T2') base.monotone = (a, sp) => { const rk = rankOf(sp); return anyLine(tier, a.vals, (x) => { const r = x.map(rk); return (r[0] < r[1] && r[1] < r[2]) || (r[0] > r[1] && r[1] > r[2]); }); };
  return base;
}
function blockBA(spec, all, f) {
  let h = 0, fa = 0;
  for (const tr of spec.trials) { const p = f(all[tr.i], spec); if (tr.answer === 'match') { if (p) h++; } else if (p) fa++; }
  return (h / 10 + 1 - fa / 10) / 2;
}

/** The heavy part: seeds [from, to) for every tier. */
function runChunk({ from, to }) {
  const G = HF.tasks.relations.grid, out = {};
  for (const tier of TIERS) {
    const res = { blocks: 0, errors: [], ba: {}, n: 0 }, R = responders(tier);
    for (let i = from; i < to; i++) {
      const rung = i % 9, variant = VARIANTS[i % VARIANTS.length];
      const spec = G.gen({ trackId: 'rel.grid.' + tier, rung, seed: `g${tier}-${i}`, variant });
      res.blocks++;
      const err = checkBlock(spec, tier, rung, i, variant, i % 3 === 0);
      if (err && res.errors.length < 5) res.errors.push(err);
      if (i < SHORTCUT_BLOCKS) {
        res.n++;
        const all = spec.trials.map((tr) => facts(spec, tier, valsOf(spec, tier, tr)));
        for (const [k, f] of Object.entries(R)) res.ba[k] = (res.ba[k] || 0) + blockBA(spec, all, f);
      }
    }
    out[tier] = res;
  }
  return out;
}

if (!isMainThread && workerData && workerData.relGridChunk) parentPort.postMessage(runChunk(workerData));

function inWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: Object.assign({ relGridChunk: true }, data) });
    w.once('message', resolve); w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error('worker exit ' + code)); });
  });
}

export default async function (t) {
  const G = HF.tasks.relations.grid;

  await t.test(`grid: ${SEEDS} seeds per tier — independent solver, counts, pressure steps, matched pairs, shortcuts`, async () => {
    const n = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length)));
    const chunks = Array.from({ length: n }, (_, k) => ({ from: Math.floor((k * SEEDS) / n), to: Math.floor(((k + 1) * SEEDS) / n) }));
    let parts;
    try { parts = n > 1 ? await Promise.all(chunks.map(inWorker)) : [runChunk({ from: 0, to: SEEDS })]; }
    catch (e) { parts = [runChunk({ from: 0, to: SEEDS })]; }
    for (const tier of TIERS) {
      const errors = [].concat(...parts.map((p) => p[tier].errors)), blocks = parts.reduce((s, p) => s + p[tier].blocks, 0);
      t.eq(blocks, SEEDS, tier + ' blocks');
      if (errors.length) throw new Error(errors.join(' | '));
      const nSc = parts.reduce((s, p) => s + p[tier].n, 0), names = Object.keys(parts[0][tier].ba);
      t.eq(nSc, SHORTCUT_BLOCKS);
      for (const k of names) {
        const ba = parts.reduce((s, p) => s + (p[tier].ba[k] || 0), 0) / nSc;
        if (k === 'always' || k === 'never') t.near(ba, 0.5, 1e-12, tier + ' ' + k);
        else t.ok(ba <= 0.60, `${tier} ${k} BA ${ba.toFixed(3)} > .60`);
      }
    }
  });

  await t.test('grid: deterministic per seed; rule per block for T4, T6, T7 comes from the seed', () => {
    const first = TIERS.map((tier) => G.gen({ trackId: 'rel.grid.' + tier, rung: 3, seed: 'det' }));
    for (let i = 0; i < 50; i++) G.gen({ trackId: 'rel.grid.' + TIERS[i % 8], rung: i % 9, seed: 'noise' + i, variant: VARIANTS[i % 7] });
    TIERS.forEach((tier, k) => t.eq(G.gen({ trackId: 'rel.grid.' + tier, rung: 3, seed: 'det' }), first[k], tier + ' (after other calls)'));
    const rules = new Set(), mirror = new Set(), r7 = new Set();
    for (let i = 0; i < 40; i++) {
      rules.add(G.gen({ trackId: 'rel.grid.T4', rung: 0, seed: 'r' + i }).meta.rule.id);
      mirror.add(G.gen({ trackId: 'rel.grid.T6', rung: 0, seed: 'r' + i }).meta.rule.sameFeature);
      r7.add(G.gen({ trackId: 'rel.grid.T7', rung: 0, seed: 'r' + i }).meta.rule.id);
    }
    t.eq([...rules].sort(), ['different', 'same']); t.eq([...mirror].sort(), ['fill', 'shape']); t.eq([...r7].sort(), ['different', 'same']);
    t.eq(G.gen({ trackId: 'rel.grid.T4', rung: 0, seed: 'r1', params: { rule: 'different' } }).meta.rule.id, 'different');
    t.eq(G.gen({ trackId: 'rel.grid.T4', rung: 0, seed: 'r1', params: { rule: 'same' } }).meta.rule.id, 'same');
  });

  await t.test('grid: Ascending states its direction and shows an order key where there is no natural order', () => {
    for (const v of VARIANTS) {
      const sp = G.gen({ trackId: 'rel.grid.T2', rung: 2, seed: 'k' + v, variant: v });
      t.ok(/left to right/.test(sp.meta.rule.direction) && /top to bottom/.test(sp.meta.rule.direction));
      const natural = v === 'digits' || v === 'letters' || v === 'dots';
      t.eq(sp.meta.rule.orderKey === null, natural, v);
      if (!natural) t.eq(sp.meta.rule.orderKey.slice().sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  await t.test('grid: variants — default digits, colour only on request, set inference, Lab call shape', () => {
    t.eq(G.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'v' }).meta.variant, 'digits');
    t.eq(G.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'v', set: 'letters' }).meta.variant, 'letters');
    t.eq(G.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'v', set: 'shapes' }).meta.variant, 'icons');
    const gl = G.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'v', set: 'glyphsC' });
    t.eq([gl.meta.variant, gl.meta.setId], ['glyphs', 'glyphsC']);
    t.ok(/^glyphs[A-H]$/.test(G.gen({ trackId: 'rel.grid.T3', rung: 0, seed: 'v', variant: 'glyphs' }).meta.setId));
    const col = G.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'v', variant: 'colors' });
    t.eq(col.meta.variant, 'colors');
    for (let i = 0; i < 30; i++) t.ok(G.gen({ trackId: 'rel.grid.T' + (1 + (i % 8)), rung: i % 9, seed: 'nc' + i }).meta.variant !== 'colors');
    // the Lab relation probe (js/lab/tests/rel-probe.js) calls exactly this
    for (const tr of ['rel.grid.T1', 'rel.grid.T3']) {
      const sp = HF.tasks.relations.gen({ trackId: tr, rung: 1, set: 'lab', variant: 'lab', seed: 'labseed', lab: true, protocol: null });
      t.eq([sp.meta.variant, sp.meta.setId, sp.windowMs, sp.trials.length], ['lab', 'lab', 5500, 20]);
      t.eq(sp.trials.filter((x) => x.answer === 'match').length, 10);
      t.ok(sp.trials.every((x) => x.answer === 'no' || /^(row|col)[123]$/.test(x.meta.line)));
    }
    t.eq(G.gen({ trackId: 'rel.grid.T5', rung: 0, seed: 'v', lab: true }).meta.variant, 'lab');
  });

  await t.test('grid: relaxed fallback blocks are valid for every tier and rule', () => {
    const I = G._internal;
    for (const tier of TIERS) {
      for (const params of tier === 'T4' || tier === 'T7' ? [{ rule: 'same' }, { rule: 'different' }] : tier === 'T6' ? [{ sameFeature: 'shape' }, { sameFeature: 'fill' }] : [{}]) {
        for (const rung of [0, 4, 8]) {
          const ctx = I.makeCtx({ trackId: 'rel.grid.' + tier, rung, seed: 'fb', params });
          const trials = I.fallbackTrials(ctx); // the exact path gen() takes after 200 failed attempts
          t.ok(trials, tier + ' relaxed block');
          const spec = I.toSpec(ctx, trials, 0, 'deterministic');
          for (const tr of spec.trials) {
            const j = judge(spec, tier, valsOf(spec, tier, tr), tier === 'T2' ? rankOf(spec) : null);
            t.eq(j.targets.length, tr.answer === 'match' ? 1 : 0, tier + ' relaxed array');
          }
        }
      }
    }
  });

  await t.test('grid: dispatcher routes rel.grid.T1–T8 and rejects unknown ids', () => {
    for (const tier of TIERS) t.eq(HF.tasks.relations.gen({ trackId: 'rel.grid.' + tier, rung: 2, seed: 'z' }).trackId, 'rel.grid.' + tier);
    t.throws(() => HF.tasks.relations.gen({ trackId: 'rel.grid.T9', rung: 0, seed: 'z' }));
    t.throws(() => HF.tasks.relations.gen({ trackId: 'nback.plain', rung: 0, seed: 'z' }));
  });
}
