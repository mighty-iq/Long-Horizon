// HF.tasks.nback.gen — SPEC §4.6 checks for every version:
//   10,000 seeds per version over n = 1, 2, 3, 5 (plus Dual): exact target and lure counts and lure mixes,
//   an independent solver that re-derives every label from the stimuli, no accidental targets, fillers that
//   match nothing at n−1 / n / n+1, ≤ 2 targets in a row, no immediate repeats unless the rule needs them,
//   item formats; then uncontrolled mode (Cao / Jaeggi), Stretch lure counts, high n, determinism, options.
import { HF, load } from './load.mjs';
load('js/content/sets.js');
load('js/tasks/nback/gen.js');
load('js/tasks/nback/score.js');

// ── independent solver (own copy of the rules; does not use HF.tasks.nback internals) ──
const ORDERS = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  clock: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  ring8: [0, 1, 2, 3, 4, 5, 6, 7]
};
export const KIND = { 'nback.plain': 'identity', 'nback.dual': 'identity', 'nback.transform': 'transform', 'nback.arith': 'arith', 'nback.switch': 'switch' };
export function ikey(it) {
  if (it.cell !== undefined) return 'c' + it.cell;
  if (it.text !== undefined) return 't' + it.text;
  if (it.shape !== undefined) return 's' + it.shape;
  if (it.glyph !== undefined) return 'g' + it.glyph + it.index;
  if (it.tone !== undefined) return 'n' + it.tone;
  if (it.clip !== undefined) return 'k' + it.clip;
  if (it.expr !== undefined) return 'e' + it.expr;
  return '?';
}
export function parseExpr(e) {
  const m = /^([1-9]) ([+−]) ([1-9])$/.exec(e);
  if (!m) return null;
  const a = +m[1], b = +m[3];
  return { a, b, op: m[2], value: m[2] === '+' ? a + b : a - b };
}
/** → { [stream]: [ { target, lure, types, nothing, pureTarget } per trial ] } */
export function solve(spec) {
  const n = spec.params.n, kind = KIND[spec.trackId], out = {};
  for (const st of spec.streams) {
    const items = spec.trials.map(tr => tr.stim[st]), rows = [];
    let keys, idx, ex, wk, hk;
    if (kind === 'identity') keys = items.map(ikey);
    if (kind === 'transform') { const order = ORDERS[spec.set]; idx = items.map(it => order.indexOf(it.cell !== undefined ? it.cell : it.text)); }
    if (kind === 'arith') ex = items.map(it => parseExpr(it.expr));
    if (kind === 'switch') { wk = items.map(it => ikey(it.what)); hk = items.map(it => ikey(it.where)); }
    for (let t = 0; t < items.length; t++) {
      if (t < n) { rows.push({ target: false, lure: null, types: [], nothing: true, pureTarget: false }); continue; }
      const A = t - n, B = n >= 2 ? t - n + 1 : -1, C = t - n - 1, types = [];
      let target, nothing, pure;
      if (kind === 'identity') {
        const eq = u => u >= 0 && keys[u] === keys[t];
        target = eq(A);
        if (!target && n >= 2) { if (eq(B)) types.push('n-1'); if (eq(C)) types.push('n+1'); }
        nothing = !eq(A) && !eq(B) && !eq(C);
        pure = target && !eq(B) && (n === 1 || !eq(C));
      } else if (kind === 'transform') {
        const K = ORDERS[spec.set].length, step = spec.params.step;
        const rel = u => u >= 0 && idx[t] === ((idx[u] + step) % K + K) % K, same = idx[t] === idx[A];
        target = rel(A);
        if (!target && n >= 2) { if (same) types.push('same'); if (rel(B)) types.push('rule-n-1'); if (rel(C)) types.push('rule-n+1'); }
        nothing = !rel(A) && !rel(B) && !rel(C) && !same;
        pure = target && !rel(B) && (n === 1 || !rel(C));
      } else if (kind === 'arith') {
        const val = u => u >= 0 && ex[u].value === ex[t].value, vm = u => val(u) && items[u].expr !== items[t].expr;
        const look = ex[t].a === ex[A].a && ex[t].value !== ex[A].value;
        target = vm(A);
        if (!target && n >= 2) { if (vm(B)) types.push('value-n-1'); if (vm(C)) types.push('value-n+1'); if (look) types.push('lookalike'); }
        nothing = !val(A) && !val(B) && !val(C) && ex[t].a !== ex[A].a;
        pure = target && !val(B) && (n === 1 || !val(C));
      } else {
        const cue = spec.trials[t].cue, F = cue === 'what' ? wk : hk, Gk = cue === 'what' ? hk : wk;
        const cm = u => u >= 0 && F[u] === F[t], um = Gk[A] === Gk[t];
        target = cm(A);
        if (!target && um) types.push('uncued');
        if (!target && n >= 2) { if (cm(B)) types.push('cued-n-1'); if (cm(C)) types.push('cued-n+1'); }
        nothing = !cm(A) && !cm(B) && !cm(C) && !um;
        pure = target && !um && !cm(B) && (n === 1 || !cm(C));
      }
      rows.push({ target, lure: types.length ? types.join('+') : null, types, nothing, pureTarget: pure });
    }
    out[st] = rows;
  }
  return out;
}

// expected lure mix per stream (controlled; SPEC §5 as amended 6 Nov): lureCount position lures at n±1 (rule-related in the
// Executive versions) plus, from 2-back, Transform 2 'same', Arithmetic 2 look-alikes, Switch 3 uncued.
// 1-back: none, except Switch round(lureCount / 2) uncued.
function expectedMix(kind, n, L) {
  const out = {};
  if (n === 1) { if (kind === 'switch' && Math.round(L / 2) > 0) out.uncued = Math.round(L / 2); return out; }
  if (L > 0) out[{ identity: 'lag', transform: 'rule', arith: 'value', switch: 'cued' }[kind]] = L;
  if (kind === 'transform') out.same = 2;
  if (kind === 'arith') out.lookalike = 2;
  if (kind === 'switch') out.uncued = 3;
  return out;
}
function maxRun(flags) { let r = 0, m = 0; for (const f of flags) { r = f ? r + 1 : 0; if (r > m) m = r; } return m; }

/** All §4.6 checks for one block; returns a list of problems (empty = fine). */
export function checkBlock(spec, o) {
  const errs = [], n = spec.params.n, kind = KIND[spec.trackId], L = 20 + n, sol = solve(spec), controlled = o.lureMode !== 'uncontrolled';
  const lureCount = o.lureCount === undefined ? 4 : o.lureCount;
  const bad = m => { if (errs.length < 5) errs.push(m); };
  if (spec.kind !== 'stream' || spec.task !== 'nback' || spec.trackId !== o.trackId) bad('header');
  if (spec.trials.length !== L || spec.leadIn !== n) bad('length');
  if (!spec.meta.solverChecked || spec.meta.fallback) bad('fallback ' + spec.meta.fallback);
  if (JSON.stringify(spec.streams) !== JSON.stringify(kind === 'identity' && spec.trackId === 'nback.dual' ? ['pos', 'snd'] : ['main'])) bad('streams');
  spec.trials.forEach((tr, t) => {
    if (tr.i !== t || tr.scorable !== (t >= n)) bad('index/scorable at ' + t);
    if (kind === 'switch') { if (t < n ? tr.cue !== null : !(tr.cue === 'what' || tr.cue === 'where')) bad('cue at ' + t); }
    else if (tr.cue !== undefined) bad('unexpected cue');
  });
  for (const st of spec.streams) {
    const rows = sol[st], items = spec.trials.map(tr => tr.stim[st]);
    const tflags = spec.trials.map(tr => tr.target[st]);
    let nt = 0, nl = 0; const mix = {};
    spec.trials.forEach((tr, t) => {
      const r = rows[t];
      if (t < n) { if (tr.target[st] || tr.lure[st] !== null) bad('lead-in labelled at ' + t); return; }
      if (tr.target[st] !== r.target) bad(`${st} target mismatch at ${t}: spec ${tr.target[st]} solver ${r.target}`);
      if (tr.lure[st] !== r.lure) bad(`${st} lure mismatch at ${t}: spec ${tr.lure[st]} solver ${r.lure}`);
      if (r.target) nt++;
      if (r.lure) { nl++; const k = kind === 'switch' && r.lure.startsWith('cued') ? 'cued' : (kind === 'transform' && r.lure.startsWith('rule') ? 'rule' : (kind === 'arith' && r.lure.startsWith('value') ? 'value' : r.lure)); mix[k] = (mix[k] || 0) + 1; }
      if (controlled) {
        if (r.lure && r.types.length !== 1) bad('lure with several types at ' + t + ': ' + r.lure);
        if (!r.target && !r.lure && !r.nothing) bad(`${st} filler matches something at n±1 at ${t}`);
        if (r.target && !r.pureTarget) bad(`${st} target also matches at n±1 (or uncued) at ${t}`);
      }
    });
    if (nt !== 6) bad(`${st}: ${nt} targets`);
    if (maxRun(tflags.slice(n)) > 2) bad(`${st}: 3 targets in a row`);
    if (spec.meta.targets[st] !== nt || spec.meta.lures[st] !== nl) bad('meta counts');
    if (controlled) {
      const want = expectedMix(kind, n, lureCount), total = Object.values(want).reduce((a, v) => a + v, 0);
      if (nl !== total) bad(`${st}: ${nl} lures, want ${total}`);
      if (kind === 'identity') {
        const a = mix['n-1'] || 0, b = mix['n+1'] || 0;
        if (Math.abs(a - b) > 1 || a + b !== total) bad(`${st}: lure mix ${JSON.stringify(mix)}`);
      } else {
        for (const k of Object.keys(want)) if ((mix[k] || 0) !== want[k]) bad(`${st}: lure mix ${JSON.stringify(mix)} want ${JSON.stringify(want)}`);
        for (const k of Object.keys(mix)) if (!(k in want)) bad(`${st}: unexpected lure ${k}`);
      }
      if (kind === 'transform' && total) { const r1 = spec.trials.filter(tr => tr.lure[st] === 'rule-n-1').length, r2 = spec.trials.filter(tr => tr.lure[st] === 'rule-n+1').length; if (Math.abs(r1 - r2) > 1) bad('rule lures unbalanced'); }
      if (kind === 'arith' && total) { const v1 = spec.trials.filter(tr => tr.lure[st] === 'value-n-1').length, v2 = spec.trials.filter(tr => tr.lure[st] === 'value-n+1').length; if (Math.abs(v1 - v2) > 1) bad('value lures unbalanced'); }
      if (kind === 'switch' && total) { const c1 = spec.trials.filter(tr => tr.lure[st] === 'cued-n-1').length, c2 = spec.trials.filter(tr => tr.lure[st] === 'cued-n+1').length; if (Math.abs(c1 - c2) > 1) bad('cued lures unbalanced'); }
    }
    // immediate repeats only where the rule needs them
    for (let t = 1; t < L; t++) {
      if (kind === 'arith') {
        for (let k = 1; k <= n + 1 && t - k >= 0; k++) if (items[t].expr === items[t - k].expr) bad(`same expression within ${n + 1} at ${t}`);
      } else if (ikey(items[t].what || items[t]) + (items[t].where ? ikey(items[t].where) : '') === ikey(items[t - 1].what || items[t - 1]) + (items[t - 1].where ? ikey(items[t - 1].where) : '')) {
        const ok = kind === 'identity' && t >= n && ((n === 1 && rows[t].target) || (n === 2 && controlled && spec.trials[t].lure[st] === 'n-1'));
        if (!ok) bad(`${st}: immediate repeat at ${t}`);
      }
    }
    // item formats
    for (const it of items) {
      if (kind === 'arith') {
        const e = parseExpr(it.expr);
        if (!e || e.value !== it.value || it.value < 1 || it.value > 9 || /-/.test(it.expr)) bad('arith item ' + JSON.stringify(it));
      } else if (kind === 'switch') {
        if (!(it.where.cell >= 0 && it.where.cell <= 7) || HF.sets.indexOf(spec.sets.what, it.what) < 0) bad('switch item');
      } else if (st === 'pos') { if (!(it.cell >= 0 && it.cell <= 7) || Object.keys(it).length !== 1) bad('pos item'); }
      else if (HF.sets.indexOf(st === 'snd' ? spec.sets.snd : spec.set, it) < 0) bad('item not in set ' + JSON.stringify(it));
    }
  }
  if (spec.trackId === 'nback.dual') {
    const both = spec.trials.filter(tr => tr.target.pos && tr.target.snd).length;
    if (both !== 2) bad('dual coincident targets ' + both);
  }
  if (kind === 'switch') {
    const cues = spec.trials.slice(n).map(tr => tr.cue);
    let sw = 0; for (let k = 1; k < cues.length; k++) if (cues[k] !== cues[k - 1]) sw++;
    if (sw !== Math.round(spec.params.switchRate * 19)) bad('switches ' + sw);
    const tw = spec.trials.filter(tr => tr.target.main && tr.cue === 'what').length;
    if (controlled && (tw < 2 || tw > 4)) bad('targets per cue ' + tw);
  }
  return errs;
}

export const NS = [1, 2, 3, 5];
export function optsFor(trackId, s, extra) {
  const n = NS[s % 4], S = HF.sets;
  const o = { trackId, seed: 'g' + s, rung: trackId === 'nback.switch' ? 3 * (n - 1) + (Math.floor(s / 4) % 3) : 2 * (n - 1) + (Math.floor(s / 4) % 2) };
  if (trackId === 'nback.plain') { const sets = S.forTrack(trackId); o.set = sets[Math.floor(s / 4) % sets.length]; }
  if (trackId === 'nback.transform') {
    const sets = S.forTrack(trackId); o.set = sets[Math.floor(s / 4) % sets.length];
    o.params = { n, onMs: 500, soaMs: 3000, step: [1, 1, 1, 2, -1][Math.floor(s / 20) % 5] };
  }
  if (trackId === 'nback.switch') o.set = ['digits', 'shapes'][Math.floor(s / 4) % 2];
  if (trackId === 'nback.dual') o.set = 'tones';
  return Object.assign(o, extra || {});
}

export default async function (t) {
  const NB = HF.tasks.nback;
  const SEEDS = 10000;

  for (const trackId of ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch']) {
    await t.test(`gen ${trackId}: ${SEEDS} seeds over n = 1, 2, 3, 5 — exact counts, solver agrees, fillers clean, spread`, () => {
      const problems = [], perN = {};
      for (let s = 0; s < SEEDS; s++) {
        const o = optsFor(trackId, s), spec = NB.gen(o), e = checkBlock(spec, o);
        perN[spec.params.n] = (perN[spec.params.n] || 0) + 1;
        if (e.length && problems.length < 3) problems.push(`seed ${o.seed} n=${spec.params.n} set=${spec.set}: ${e.join('; ')}`);
      }
      t.ok(!problems.length, problems.join(' | '));
      t.eq(Object.keys(perN).map(Number), NS);
    });
  }

  await t.test('gen: Dual with spoken letters (when clips exist) and Plain with tones', () => {
    const saved = globalThis.HF_AUDIO_CLIPS;
    try {
      globalThis.HF_AUDIO_CLIPS = { letters: { F: 1, H: 1, J: 1, K: 1, L: 1, M: 1, Q: 1, R: 1 } };
      for (let s = 0; s < 500; s++) {
        const o = { trackId: 'nback.dual', rung: 2 * (NS[s % 4] - 1), set: 'lettersAudio', seed: 'la' + s }, spec = NB.gen(o);
        t.eq(spec.set, 'lettersAudio'); t.eq(spec.sets, { pos: 'grid8', snd: 'lettersAudio' });
        const e = checkBlock(spec, o); t.ok(!e.length, e.join('; '));
        t.ok(spec.trials.every(tr => typeof tr.stim.snd.clip === 'string'));
      }
    } finally { if (saved === undefined) delete globalThis.HF_AUDIO_CLIPS; else globalThis.HF_AUDIO_CLIPS = saved; }
    const fb = NB.gen({ trackId: 'nback.dual', rung: 2, set: 'lettersAudio', seed: 'x' });
    t.eq(fb.set, 'tones'); t.eq(fb.meta.setFallback, 'lettersAudio');
  });

  await t.test('gen: uncontrolled lures (Cao transform, Jaeggi dual) — 6 targets, no accidental target, accidental lures labelled', () => {
    const problems = []; let lures = 0, blocks = 0;
    for (const trackId of ['nback.transform', 'nback.dual', 'nback.plain', 'nback.arith', 'nback.switch']) {
      for (let s = 0; s < 1000; s++) {
        const o = optsFor(trackId, s, { lureMode: 'uncontrolled', seed: 'u' + s }), spec = NB.gen(o), e = checkBlock(spec, o);
        if (spec.meta.lureMode !== 'uncontrolled' || spec.meta.lureCount !== null) e.push('meta lureMode');
        if (e.length && problems.length < 3) problems.push(`${trackId} seed ${o.seed}: ${e.join('; ')}`);
        if (spec.params.n >= 2) { blocks++; for (const st of spec.streams) lures += spec.meta.lures[st]; }
      }
    }
    t.ok(!problems.length, problems.join(' | '));
    t.ok(lures / blocks > 1, 'accidental lures should occur: ' + (lures / blocks).toFixed(2) + ' per block');
    // protocol defaults
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 0, seed: 'c', protocol: 'cao' }).meta.lureMode, 'uncontrolled');
    t.eq(NB.gen({ trackId: 'nback.dual', rung: 0, seed: 'j', protocol: 'jaeggi' }).meta.lureMode, 'uncontrolled');
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 0, seed: 'c', protocol: 'cao', lureMode: 'controlled' }).meta.lureMode, 'controlled');
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 0, seed: 'w', protocol: 'wang' }).meta.lureMode, 'controlled');
  });

  await t.test('gen: Cao transform block = days, +1, 500 / 3000 ms, 20 + n items, 6 targets', () => {
    for (let n = 1; n <= 6; n++) {
      const spec = NB.gen({ trackId: 'nback.transform', rung: 2 * (n - 1), set: 'days', seed: 'cao' + n, protocol: 'cao' });
      t.eq([spec.set, spec.params.step, spec.onMs, spec.soaMs, spec.trials.length, spec.meta.targets.main], ['days', 1, 500, 3000, 20 + n, 6]);
      t.eq(spec.meta.rule.text, 'Press when the day is the day after the one ' + NB.words(n) + ' back.');
    }
  });

  await t.test('gen: Stretch (lureCount 6), lureCount 0, and high n (6–9) stay exact', () => {
    const problems = [];
    for (const trackId of ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch']) {
      for (let s = 0; s < 300; s++) {
        const o = optsFor(trackId, s, { lureCount: [6, 0, 4][s % 3], seed: 'st' + s });
        const spec = NB.gen(o), e = checkBlock(spec, o);
        if (e.length && problems.length < 3) problems.push(`${trackId} ${o.seed} L=${o.lureCount}: ${e.join('; ')}`);
      }
      for (let s = 0; s < 200; s++) {
        const n = 6 + (s % 4), rung = trackId === 'nback.switch' ? 3 * (n - 1) + (s % 3) : 2 * (n - 1) + (s % 2);
        const o = { trackId, rung, seed: 'hi' + s, set: trackId === 'nback.transform' ? 'days' : undefined };
        if (trackId === 'nback.transform') o.params = { step: 1 };
        const spec = NB.gen(o), e = checkBlock(spec, o);
        if (spec.params.n !== n) e.push('n');
        if (e.length && problems.length < 3) problems.push(`${trackId} n=${n} ${o.seed}: ${e.join('; ')}`);
      }
    }
    t.ok(!problems.length, problems.join(' | '));
  });

  await t.test('gen: lure totals per SPEC §5 (amended) — Plain/Dual 4 (6), Transform/Arithmetic 6 (8), Switch 7 (9); cap at 6', () => {
    const want = { 'nback.plain': [4, 6], 'nback.dual': [4, 6], 'nback.transform': [6, 8], 'nback.arith': [6, 8], 'nback.switch': [7, 9] };
    for (const [trackId, [l4, l6]] of Object.entries(want)) {
      const rung = trackId === 'nback.switch' ? 3 : 2;
      const a = NB.gen({ trackId, rung, seed: 'tot' }), b = NB.gen({ trackId, rung, seed: 'tot', lureCount: 6 });
      for (const st of a.streams) { t.eq(a.meta.lures[st], l4, trackId); t.eq(b.meta.lures[st], l6, trackId + ' stretch'); }
      t.eq([a.meta.lureCount, b.meta.lureCount], [l4, l6]);
    }
    const capped = NB.gen({ trackId: 'nback.plain', rung: 4, seed: 'cap', lureCount: 9 });
    t.eq([capped.meta.lureCount, capped.meta.lureCountCapped], [6, 9]);
  });

  await t.test('gen: deterministic for the same opts; seeds differ', () => {
    for (const trackId of ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch']) {
      const o = optsFor(trackId, 7);
      t.eq(JSON.stringify(NB.gen(o)), JSON.stringify(NB.gen(Object.assign({}, o))), trackId);
      t.ok(JSON.stringify(NB.gen(o).trials) !== JSON.stringify(NB.gen(Object.assign({}, o, { seed: 'other' })).trials), trackId + ' seed');
    }
  });

  await t.test('gen: rung → n, pace and switch rate follow SPEC §5; params override', () => {
    const p = r => NB.gen({ trackId: 'nback.plain', rung: r, seed: 'r' }).params;
    t.eq(p(0), { n: 1, onMs: 500, soaMs: 3000 }); t.eq(p(1), { n: 1, onMs: 500, soaMs: 2500 });
    t.eq(p(4), { n: 3, onMs: 500, soaMs: 3000 }); t.eq(p(17), { n: 9, onMs: 500, soaMs: 2500 });
    const q = r => NB.gen({ trackId: 'nback.switch', rung: r, seed: 'r' }).params;
    t.eq(q(0), { n: 1, onMs: 500, soaMs: 3000, switchRate: 0.25 }); t.eq(q(1), { n: 1, onMs: 500, soaMs: 3000, switchRate: 0.5 });
    t.eq(q(2), { n: 1, onMs: 500, soaMs: 2500, switchRate: 0.5 }); t.eq(q(26), { n: 9, onMs: 500, soaMs: 2500, switchRate: 0.5 });
    t.eq(NB.ladder('nback.arith', 5), { n: 3, fast: true });
    const o = NB.gen({ trackId: 'nback.transform', rung: 0, seed: 'p', params: { n: 4, onMs: 400, soaMs: 2000, step: -1 } });
    t.eq(o.params, { n: 4, onMs: 400, soaMs: 2000, step: -1 }); t.eq(o.trials.length, 24);
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 0, seed: 'p', params: { step: 7 } }).meta.stepFallback, 7); // 7 ≡ 0 for days
  });

  await t.test('gen: sets — defaults, fallbacks, Lab glyphs only with lab: true, glyph family built before the stream', () => {
    t.eq(NB.gen({ trackId: 'nback.plain', rung: 2, seed: 's' }).set, 'grid8');
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 2, seed: 's' }).set, 'days');
    t.eq(NB.gen({ trackId: 'nback.switch', rung: 2, seed: 's' }).sets, { main: 'digits', what: 'digits', where: 'grid8' });
    const g = NB.gen({ trackId: 'nback.plain', rung: 2, seed: 's', set: 'glyphsLab' });
    t.eq(g.set, 'grid8'); t.eq(g.meta.setFallback, 'glyphsLab');
    const lab = NB.gen({ trackId: 'nback.plain', rung: 2, seed: 's', set: 'glyphsLab', lab: true });
    t.eq(lab.set, 'glyphsLab'); t.ok(checkBlock(lab, { trackId: 'nback.plain' }).length === 0);
    t.eq(NB.gen({ trackId: 'nback.transform', rung: 2, seed: 's', set: 'letters' }).set, 'days');
    t.eq(NB.gen({ trackId: 'nback.dual', rung: 2, seed: 's', set: 'grid8' }).meta.setFallback, undefined);
    t.throws(() => NB.gen({ trackId: 'nback.nope', rung: 0, seed: 's' }));
    t.ok(NB.gen({ trackId: 'nback.plain', rung: 2, set: 'glyphsC' }).seed.length > 4, 'a missing seed is generated and logged');
  });

  await t.test('gen: arithmetic never shows the same expression at lag n, and targets never share the first operand', () => {
    for (let s = 0; s < 1000; s++) {
      const spec = NB.gen({ trackId: 'nback.arith', rung: 2 * (NS[s % 4] - 1), seed: 'a' + s, lureMode: s % 2 ? 'uncontrolled' : 'controlled' }), n = spec.params.n;
      for (let t2 = n; t2 < spec.trials.length; t2++) {
        const cur = spec.trials[t2].stim.main, nb = spec.trials[t2 - n].stim.main;
        t.ok(cur.expr !== nb.expr, 'identical at lag n');
        if (spec.trials[t2].target.main) t.ok(parseExpr(cur.expr).a !== parseExpr(nb.expr).a, 'target shares first operand');
      }
    }
  });

  await t.test('gen: meta.lurePlan = the requested count; regenerating with it reproduces the lures (CA-08)', () => {
    const NB = HF.tasks.nback;
    const cases = [['nback.transform', 2, 'days', 4], ['nback.arith', 2, 'arith', 4], ['nback.switch', 3, 'digits', 4], ['nback.switch', 0, 'digits', 4],
      ['nback.plain', 2, 'letters', 6], ['nback.plain', 0, 'letters', 4], ['nback.dual', 4, 'tones', 4]];
    for (const [trackId, rung, set, lc] of cases) {
      const a = NB.gen({ trackId, rung, set, seed: 'lp', lureCount: lc });
      t.eq(a.meta.lurePlan, lc, trackId + ' lurePlan');
      const b = NB.gen({ trackId, rung: a.rung, params: { ...a.params }, set: a.set, seed: 'lp/r1', lureCount: a.meta.lurePlan,
        lureMode: a.meta.lurePlan == null ? 'uncontrolled' : 'controlled' });
      t.eq([b.meta.lureCount, b.meta.lures], [a.meta.lureCount, a.meta.lures], `${trackId} n=${a.params.n} regenerated lures`);
    }
    const u = NB.gen({ trackId: 'nback.transform', rung: 2, set: 'days', seed: 'lp', protocol: 'cao' });
    t.eq([u.meta.lureMode, u.meta.lurePlan], ['uncontrolled', null], 'uncontrolled (Cao) → null');
    t.eq(NB.gen({ trackId: 'nback.plain', rung: 2, set: 'letters', seed: 'lp', lureCount: 9 }).meta.lurePlan, 6, 'clamped to 6');
  });
}
