// Shortcut responders (SPEC §4.6 and §5 as amended 6 Nov), scored with the real scorer (HF.tasks.nback.score) on
// 2,000 controlled blocks per version (500 each at n = 1, 2, 3, 5) with lureCount 4, and 1,000 with lureCount 6.
//   • always-press, never-press: BA ≤ .60 (exactly .50)
//   • Arithmetic "same first operand as n back": BA ≤ .60 (look-alike lures catch it; targets never share it)
//   • familiarity, literal (any item seen in the last n + 1; Transform also "its next item" seen): Plain/Dual —
//     where it is the task done imprecisely — BA < .87 with lureCount 4 and < .80 with 6, from 2-back (1-back has
//     no lures: there familiarity is the rule itself); Executive versions BA ≤ .60
//   • rule-aware familiarity (Transform: the item is the rule step of one of the last n + 1; Arithmetic: the value
//     seen; Switch: the cued feature seen): BA < .87 with lureCount 4 and < .80 with 6, from 2-back — the
//     lureCount lures are rule-related, so at 2-back it scores exactly 1 − lureCount / 28
//   • Switch, ignoring the cue (compare one feature, whatever the cue says): BA ≤ .73
// HF_VERBOSE=1 prints the tables.
import { HF, load } from './load.mjs';
import { optsFor, NS, ikey, parseExpr, KIND } from './nback-gen.test.mjs';
load('js/content/sets.js');
load('js/tasks/nback/gen.js');
load('js/tasks/nback/score.js');

const VERBOSE = !!process.env.HF_VERBOSE;
const ORD = { days: 7, months: 12, clock: 12, compass: 8, ring8: 8 };

// feature extractors: what a responder compares (own code; no generator internals)
function feats(spec, st) {
  const kind = KIND[spec.trackId];
  return spec.trials.map(tr => {
    const it = tr.stim[st];
    if (kind === 'arith') { const e = parseExpr(it.expr); return { key: it.expr, value: e.value, first: e.a }; }
    if (kind === 'switch') return { what: ikey(it.what), where: ikey(it.where), cue: tr.cue };
    if (kind === 'transform') { const s = HF.sets.get(spec.set); return { idx: HF.sets.indexOf(s, it), K: ORD[spec.set] }; }
    return { key: ikey(it) };
  });
}
const KEY = { main: 'match', pos: 'match', snd: 'match2' };
function respond(spec, decide) { // decide(f, t, n, st) → press?
  const n = spec.params.n, responses = [];
  for (const st of spec.streams) {
    const f = feats(spec, st);
    for (let t = n; t < spec.trials.length; t++) if (decide(f, t, n, spec, st)) responses.push({ key: KEY[st], t: t * spec.soaMs + 700, trial: t });
  }
  return { responses, voided: [], paused: false };
}
const within = (t, n, pred) => { for (let k = 1; k <= n + 1 && t - k >= 0; k++) if (pred(t - k)) return true; return false; };
const RESPONDERS = {
  always: () => true,
  never: () => false,
  seen: (f, t, n, spec) => { // any item seen in the last n + 1: the same item / expression / both features
    const kind = KIND[spec.trackId], x = f[t];
    if (kind === 'transform') return within(t, n, u => f[u].idx === x.idx);
    if (kind === 'switch') return within(t, n, u => f[u].what === x.what && f[u].where === x.where);
    return within(t, n, u => f[u].key === x.key);
  },
  nextSeen: (f, t, n, spec) => { // Transform: "its next item" (the rule step of the current item) seen in the last n + 1
    const x = f[t];
    return within(t, n, u => f[u].idx === (x.idx + spec.params.step + x.K) % x.K);
  },
  ruleSeen: (f, t, n, spec) => { // rule-aware familiarity: the rule holds with one of the last n + 1 items
    const kind = KIND[spec.trackId], x = f[t];
    if (kind === 'transform') return within(t, n, u => x.idx === (f[u].idx + spec.params.step + x.K) % x.K);
    if (kind === 'arith') return within(t, n, u => f[u].value === x.value);
    return within(t, n, u => f[u][x.cue] === x[x.cue]); // switch: the cued feature
  },
  sameFirstOperand: (f, t, n) => f[t].first === f[t - n].first,
  ignoreCueWhat: (f, t, n) => f[t].what === f[t - n].what,
  ignoreCueWhere: (f, t, n) => f[t].where === f[t - n].where
};
const APPLIES = {
  'nback.plain': ['always', 'never', 'seen'],
  'nback.dual': ['always', 'never', 'seen'],
  'nback.transform': ['always', 'never', 'seen', 'nextSeen', 'ruleSeen'],
  'nback.arith': ['always', 'never', 'seen', 'ruleSeen', 'sameFirstOperand'],
  'nback.switch': ['always', 'never', 'seen', 'ruleSeen', 'ignoreCueWhat', 'ignoreCueWhere']
};
// lures per block that a position-blind (rule-aware) familiarity responder falls for, controlled, from 2-back:
// the lureCount position lures (rule-related in the Executive versions); the version-specific ones never fool it
function famLures(trackId, L) { return L; }

export function shortcutTable(blocksPerN = 500, extra) {
  const NB = HF.tasks.nback, table = {};
  for (const trackId of Object.keys(APPLIES)) {
    const rows = {};
    for (const r of APPLIES[trackId]) rows[r] = { all: [], byN: {} };
    for (let s = 0; s < blocksPerN * NS.length; s++) {
      const spec = NB.gen(optsFor(trackId, s, Object.assign({ seed: 'sc' + s }, extra || {}))), n = spec.params.n;
      for (const r of APPLIES[trackId]) {
        const ba = NB.score(spec, respond(spec, RESPONDERS[r])).ba;
        rows[r].all.push(ba);
        (rows[r].byN[n] || (rows[r].byN[n] = [])).push(ba);
      }
    }
    table[trackId] = rows;
  }
  return table;
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

export default async function (t) {
  const T4 = shortcutTable(500), T6 = shortcutTable(250, { lureCount: 6 });
  if (VERBOSE) for (const [name, table] of [['lureCount 4, 2,000', T4], ['lureCount 6, 1,000', T6]]) {
    console.log(`  shortcut BA (controlled, ${name} blocks per version)`.padEnd(54), '  all     n=1    n=2    n=3    n=5');
    for (const [tr, rows] of Object.entries(table)) for (const [r, v] of Object.entries(rows)) {
      console.log('  ' + (tr + ' ' + r).padEnd(52), mean(v.all).toFixed(3).padStart(6), NS.map(n => mean(v.byN[n]).toFixed(3).padStart(7)).join(''));
    }
  }

  await t.test('shortcuts: always-press and never-press average BA ≤ .60 (exactly .50) in every version, n and lure count', () => {
    for (const table of [T4, T6]) for (const [tr, rows] of Object.entries(table)) for (const r of ['always', 'never']) {
      t.ok(mean(rows[r].all) <= 0.6, `${tr} ${r} ${mean(rows[r].all)}`);
      for (const n of NS) t.near(mean(rows[r].byN[n]), 0.5, 1e-9, `${tr} ${r} n=${n}`);
    }
  });

  await t.test('shortcuts: Arithmetic "same first operand" responder ≤ .60 (look-alikes catch it)', () => {
    for (const table of [T4, T6]) {
      const v = table['nback.arith'].sameFirstOperand;
      t.ok(mean(v.all) <= 0.6, 'mean ' + mean(v.all));
      for (const n of NS.filter(x => x >= 2)) t.ok(mean(v.byN[n]) <= 0.45, `n=${n}: ${mean(v.byN[n])}`);
    }
  });

  await t.test('shortcuts: Plain/Dual familiarity < .87 with 4 lures and < .80 with 6, from 2-back (1-back = the rule)', () => {
    for (const [table, L, bound] of [[T4, 4, 0.87], [T6, 6, 0.80]]) for (const tr of ['nback.plain', 'nback.dual']) {
      const v = table[tr].seen;
      for (const n of [2, 3, 5]) t.ok(mean(v.byN[n]) < bound, `${tr} L=${L} n=${n}: ${mean(v.byN[n]).toFixed(3)}`);
      t.near(mean(v.byN[2]), 1 - L / 28, 1e-9, `${tr} L=${L} n=2 ceiling`); // fillers never look familiar at 2-back
      t.near(mean(v.byN[1]), 1, 1e-9, `${tr} 1-back`);
    }
  });

  await t.test('shortcuts: Executive literal familiarity (item seen, Transform next item seen) ≤ .60 at every n', () => {
    for (const table of [T4, T6]) for (const tr of ['nback.transform', 'nback.arith', 'nback.switch']) for (const r of ['seen', 'nextSeen']) {
      const v = table[tr][r];
      if (!v) continue;
      t.ok(mean(v.all) <= 0.6, `${tr} ${r} ${mean(v.all)}`);
      for (const n of NS) t.ok(mean(v.byN[n]) <= 0.6, `${tr} ${r} n=${n}: ${mean(v.byN[n]).toFixed(3)}`);
    }
  });

  await t.test('shortcuts: Executive rule-aware familiarity < .87 with 4 lures and < .80 with 6 (exactly 1 − L/28 at 2-back)', () => {
    for (const [table, L, bound] of [[T4, 4, 0.87], [T6, 6, 0.80]]) for (const tr of ['nback.transform', 'nback.arith', 'nback.switch']) {
      const v = table[tr].ruleSeen, ceil = 1 - famLures(tr, L) / 28;
      t.near(mean(v.byN[2]), ceil, 1e-9, `${tr} L=${L} n=2`);
      for (const n of [2, 3, 5]) t.ok(mean(v.byN[n]) < bound && mean(v.byN[n]) <= ceil + 1e-9, `${tr} L=${L} n=${n}: ${mean(v.byN[n]).toFixed(3)}`);
    }
  });

  await t.test('shortcuts: Switch — ignoring the cue scores ≤ .73 at every n', () => {
    for (const table of [T4, T6]) for (const r of ['ignoreCueWhat', 'ignoreCueWhere']) {
      const v = table['nback.switch'][r];
      t.ok(mean(v.all) <= 0.73, r + ' ' + mean(v.all));
      for (const n of NS) t.ok(mean(v.byN[n]) <= 0.73, `${r} n=${n}: ${mean(v.byN[n]).toFixed(3)}`);
    }
  });
}
