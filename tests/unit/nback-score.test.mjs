// HF.tasks.nback.score — hand-built logs (SPEC §4.5): perfect runs, never/always press, voided trials,
// lead-in and duplicate presses, Dual keys, protocol counts (Cao, Jaeggi), RTs, and explanations.
import { HF, load } from './load.mjs';
load('js/content/sets.js');
load('js/tasks/nback/gen.js');
load('js/tasks/nback/score.js');

const TRACKS = ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch'];
const KEY = { main: 'match', pos: 'match', snd: 'match2' };
function perfectLog(spec, rt = 650) {
  const responses = [];
  for (const tr of spec.trials) for (const st of spec.streams) if (tr.target[st]) responses.push({ key: KEY[st], t: tr.i * spec.soaMs + rt, trial: tr.i });
  return { responses, voided: [], paused: false };
}
const days = d => ({ text: d });
function handSpec(trackId, set, n, items, labels, extra) { // a spec built by hand (not by gen)
  const trials = items.map((it, i) => Object.assign({ i, stim: { main: it }, scorable: i >= n, target: { main: !!(labels[i] && labels[i] === 'T') },
    lure: { main: labels[i] && labels[i] !== 'T' ? labels[i] : null } }, extra && extra.cues ? { cue: extra.cues[i] } : {}));
  return { kind: 'stream', task: 'nback', trackId, seed: 'hand', set, rung: 2 * (n - 1), params: Object.assign({ n, onMs: 500, soaMs: 3000 }, extra && extra.params),
    onMs: 500, soaMs: 3000, streams: ['main'], leadIn: n, sets: Object.assign({ main: set }, extra && extra.sets), trials, meta: {} };
}

export default async function (t) {
  const NB = HF.tasks.nback, S = HF.stats;

  await t.test('score: a perfect run gives BA 1 in every version (both Dual streams), with plain counts', () => {
    for (const trackId of TRACKS) for (const rung of [0, 2, 4]) {
      const spec = NB.gen({ trackId, rung, seed: 'perfect' + rung }), r = NB.score(spec, perfectLog(spec));
      t.eq(r.ba, 1, trackId); t.eq(r.baMean, 1); t.eq(r.y, 1);
      t.eq(r.kind, 'stream'); t.eq(r.trackId, trackId);
      for (const st of spec.streams) {
        const s = r.streams[st];
        t.eq([s.hits, s.misses, s.fas, s.crs, s.lureFas], [6, 0, 0, 14, 0], trackId + ' ' + st);
        t.eq(s.lureTrials, spec.meta.lures[st]); t.eq(s.rtMedian, 650);
        t.ok(s.dprime > 2.5);
      }
      const k = spec.streams.length;
      t.eq(r.plain, { caught: 6 * k, targets: 6 * k, falsePresses: 0, nonTargets: 14 * k });
      t.eq([r.nScorable, r.nVoided, r.voidedRatio], [20, 0, 0]);
      t.eq([r.extra.correct, r.extra.errors, r.extra.scored], [20 * k, 0, 20]);
      t.eq(r.why.length, 20 * k);
      for (const w of r.why) {
        const isT = spec.trials[w.i].target[w.stream];
        t.ok(isT ? w.text.startsWith('Match: ') : w.text.startsWith('Not a match: '), w.text);
        t.eq(w.outcome, isT ? 'hit' : 'cr');
      }
    }
  });

  await t.test('score: never-press and always-press give BA .5; always-press shows every lure false alarm', () => {
    for (const trackId of TRACKS) {
      const spec = NB.gen({ trackId, rung: trackId === 'nback.switch' ? 3 : 2, seed: 'np' });
      const never = NB.score(spec, { responses: [], voided: [] });
      t.eq(never.ba, 0.5); t.eq(never.y, 0);
      for (const st of spec.streams) t.eq([never.streams[st].misses, never.streams[st].crs], [6, 14]);
      const allPress = { responses: [] };
      for (const tr of spec.trials) for (const st of spec.streams) allPress.responses.push({ key: KEY[st], t: tr.i * 3000 + 500, trial: tr.i });
      const always = NB.score(spec, allPress);
      t.eq(always.ba, 0.5);
      for (const st of spec.streams) {
        const k = spec.meta.lures[st]; // Plain/Dual 4, Transform/Arithmetic 6, Switch 7
        t.ok(k >= 4, trackId + ' lures ' + k);
        t.eq([always.streams[st].fas, always.streams[st].lureFas, always.streams[st].lureTrials], [14, k, k], trackId);
        t.eq(always.why.filter(w => w.stream === st && w.outcome === 'lure-fa').length, k);
      }
      t.eq(always.extra.leadInPresses, spec.params.n * spec.streams.length);
    }
  });

  await t.test('score: voided trials are excluded from every count, and presses on them are ignored', () => {
    const spec = NB.gen({ trackId: 'nback.plain', rung: 2, seed: 'void', set: 'letters' });
    const tg = spec.trials.filter(tr => tr.target.main).map(tr => tr.i), lu = spec.trials.filter(tr => tr.lure.main).map(tr => tr.i);
    const fi = spec.trials.filter(tr => tr.scorable && !tr.target.main && !tr.lure.main).map(tr => tr.i);
    const voided = [tg[0], tg[1], lu[0], fi[0], 0]; // trial 0 is in the lead-in
    const log = perfectLog(spec);
    log.voided = voided;
    log.responses.push({ key: 'match', t: lu[0] * 3000 + 400, trial: lu[0] }, { key: 'match', t: fi[0] * 3000 + 400, trial: fi[0] });
    const r = NB.score(spec, log);
    t.eq([r.streams.main.hits, r.streams.main.misses, r.streams.main.fas, r.streams.main.crs], [4, 0, 0, 12]);
    t.eq([r.streams.main.lureTrials, r.streams.main.lureFas], [3, 0]);
    t.eq([r.nScorable, r.nVoided, r.voidedRatio], [20, 4, 0.2]);
    t.eq(r.ba, 1);
    t.eq(r.why.length, 16);
    t.ok(r.why.every(w => !voided.includes(w.i)));
    t.eq([r.extra.correct, r.extra.errors, r.extra.scored], [16, 0, 16]);
    t.eq(r.plain, { caught: 4, targets: 4, falsePresses: 0, nonTargets: 12 });
  });

  await t.test('score: lead-in presses, duplicate presses, unknown keys and out-of-range trials do not count', () => {
    const spec = NB.gen({ trackId: 'nback.transform', rung: 4, seed: 'dup', set: 'days' }), n = spec.params.n;
    const log = perfectLog(spec);
    const tg = spec.trials.find(tr => tr.target.main).i;
    log.responses.push({ key: 'match', t: tg * 3000 + 900, trial: tg }, { key: 'match', t: 100, trial: 0 }, { key: 'match', t: (n - 1) * 3000 + 100, trial: n - 1 },
      { key: 'no', t: 5, trial: n + 1 }, { key: 'match', t: 1e6, trial: 999 }, { key: 'match2', t: 7, trial: n + 2 });
    const r = NB.score(spec, log);
    t.eq([r.streams.main.hits, r.streams.main.fas], [6, 0]);
    t.eq(r.extra.leadInPresses, 2);
    t.eq(r.streams.main.rtMedian, 650, 'first response per window keeps its RT');
  });

  await t.test('score: Dual maps match → position, match2 → sound; the weaker stream decides', () => {
    const spec = NB.gen({ trackId: 'nback.dual', rung: 2, seed: 'dual' });
    const log = { responses: perfectLog(spec).responses.filter(x => x.key === 'match') };
    const r = NB.score(spec, log);
    t.eq(r.streams.pos.ba, 1); t.eq(r.streams.snd.ba, 0.5); t.eq(r.ba, 0.5); t.eq(r.baMean, 0.75);
    t.eq(r.extra.errorsByStream, { pos: 0, snd: 6 });
    t.eq(r.why.length, 40);
    t.ok(r.why.filter(w => w.stream === 'snd' && w.outcome === 'miss').length === 6);
  });

  await t.test('score: protocol counts over the 20 scorable items (Cao: correct > 18 up, errors ≥ 5 down; Jaeggi: errors per stream)', () => {
    const spec = NB.gen({ trackId: 'nback.transform', rung: 2, seed: 'cao', protocol: 'cao' });
    const tg = spec.trials.filter(tr => tr.target.main).map(tr => tr.i), non = spec.trials.filter(tr => tr.scorable && !tr.target.main).map(tr => tr.i);
    const log = perfectLog(spec);
    log.responses = log.responses.filter(x => x.trial !== tg[0]);                 // 1 miss
    log.responses.push({ key: 'match', t: non[0] * 3000 + 500, trial: non[0] }); // 1 false alarm
    let r = NB.score(spec, log);
    t.eq([r.extra.correct, r.extra.errors], [18, 2]);
    log.responses = log.responses.filter(x => x.trial !== tg[1] && x.trial !== tg[2]);
    log.responses.push({ key: 'match', t: non[1] * 3000 + 500, trial: non[1] });
    r = NB.score(spec, log);
    t.eq([r.extra.correct, r.extra.errors], [15, 5]);
    const d = NB.gen({ trackId: 'nback.dual', rung: 0, seed: 'jaeggi', protocol: 'jaeggi' });
    const dl = perfectLog(d);
    dl.responses = dl.responses.filter(x => !(x.key === 'match2' && x.trial === d.trials.find(tr => tr.target.snd).i));
    dl.responses.push({ key: 'match', t: 1, trial: d.trials.find(tr => tr.scorable && !tr.target.pos).i });
    r = NB.score(d, dl);
    t.eq(r.extra.errorsByStream, { pos: 1, snd: 1 }); t.eq(r.extra.correctByStream, { pos: 19, snd: 19 });
  });

  await t.test('score: SDT values come from HF.stats.sdt; BA, y, d′ and criterion aggregate as SPEC §4.5 says', () => {
    const spec = NB.gen({ trackId: 'nback.dual', rung: 4, seed: 'sdt' });
    const log = perfectLog(spec);
    log.responses = log.responses.filter((x, k) => k % 3 !== 0);
    const pos2 = spec.trials.filter(tr => tr.scorable && !tr.target.pos).slice(0, 3);
    pos2.forEach(tr => log.responses.push({ key: 'match', t: tr.i * 3000 + 300, trial: tr.i }));
    const r = NB.score(spec, log);
    for (const st of ['pos', 'snd']) {
      const s = r.streams[st], ref = S.sdt(s.hits, s.misses, s.fas, s.crs);
      t.eq([s.hitRate, s.faRate, s.ba, s.dprime, s.criterion], [ref.hitRate, ref.faRate, ref.ba, ref.dprime, ref.criterion]);
    }
    t.eq(r.ba, Math.min(r.streams.pos.ba, r.streams.snd.ba));
    t.near(r.baMean, (r.streams.pos.ba + r.streams.snd.ba) / 2, 1e-12);
    t.near(r.dprime, (r.streams.pos.dprime + r.streams.snd.dprime) / 2, 1e-12);
    const yp = Math.max(0, r.streams.pos.hitRate - r.streams.pos.faRate), ys = Math.max(0, r.streams.snd.hitRate - r.streams.snd.faRate);
    t.near(r.y, (yp + ys) / 2, 1e-12);
  });

  await t.test('score: RTs from r.rt, then logged onsets, then the nominal onset; no hits → rtMedian null', () => {
    const spec = NB.gen({ trackId: 'nback.plain', rung: 2, seed: 'rt' });
    const tg = spec.trials.filter(tr => tr.target.main).map(tr => tr.i);
    const onsets = spec.trials.map(tr => tr.i * 3000 + 17);
    const log = { onsets, responses: tg.map((i, k) => k < 2 ? { key: 'match', t: i * 3000 + 9999, trial: i, rt: 400 + k } : { key: 'match', t: i * 3000 + 17 + 600, trial: i }) };
    t.eq(NB.score(spec, log).streams.main.rtMedian, 600);
    delete log.onsets;
    t.eq(NB.score(spec, log).streams.main.rtMedian, 617);
    t.eq(NB.score(spec, { responses: [] }).streams.main.rtMedian, null);
  });

  await t.test('score: explanations — the Cao examples, word for word, on a hand-built block', () => {
    const items = ['Tue', 'Sat', 'Wed', 'Sat', 'Mon', 'Thu', 'Fri'].map(days);
    //               0      1      2(T)   3 same  4       5       6 rule-n-1 (Fri = Thu + 1 one back)
    const spec = handSpec('nback.transform', 'days', 2, items, [null, null, 'T', 'same', null, null, 'rule-n-1'], { params: { step: 1 } });
    const r = NB.score(spec, { responses: [{ key: 'match', t: 6500, trial: 2 }, { key: 'match', t: 9400, trial: 3 }] });
    const text = i => r.why.find(w => w.i === i).text;
    t.eq(text(2), 'Match: Wed is the day after Tue, two back.');
    t.eq(text(3), 'Not a match: Sat is the same day as two back — the rule is the day after.');
    t.eq(text(4), 'Not a match: two back was Wed, so a match would be Thu.');
    t.eq(text(6), 'Not a match: Fri is the day after Thu, but that was one back, not two back.');
    t.eq(r.why.find(w => w.i === 3).outcome, 'lure-fa');
    t.eq(r.streams.main.lureFas, 1);
    t.eq(NB.explain(spec, 'main', 2), text(2));
  });

  await t.test('score: explanations for Plain, Arithmetic, Switch and the step variants', () => {
    const p = handSpec('nback.plain', 'letters', 2, ['K', 'R', 'K', 'S', 'S', 'K'].map(days), [null, null, 'T', null, 'n-1', 'n+1']);
    let r = NB.score(p, { responses: [] });
    t.eq(r.why.map(w => w.text), ['Match: K is the same letter as two back.', 'Not a match: two back was R.',
      'Not a match: S matches one back, not two back.', 'Not a match: K matches three back, not two back.']);
    const kk = handSpec('nback.plain', 'letters', 2, ['K', 'R', 'K', 'K'].map(days), [null, null, 'T', 'n-1+n+1']);
    t.eq(NB.score(kk, { responses: [] }).why[1].text, 'Not a match: K matches one and three back, not two back.');
    const M = '−';
    const a = handSpec('nback.arith', 'arith', 2, [{ expr: '3 + 4', value: 7 }, { expr: '6 ' + M + ' 1', value: 5 }, { expr: '9 ' + M + ' 2', value: 7 }, { expr: '6 + 2', value: 8 }],
      [null, null, 'T', 'lookalike']);
    r = NB.score(a, { responses: [] });
    t.eq(r.why[0].text, 'Match: 9 ' + M + ' 2 = 7, the same value as 3 + 4 two back.');
    t.eq(r.why[1].text, 'Not a match: 6 + 2 starts like 6 ' + M + ' 1 (two back) but equals 8, not 5.');
    const sw = handSpec('nback.switch', 'digits', 1, [{ what: { text: '3' }, where: { cell: 0 } }, { what: { text: '3' }, where: { cell: 4 } }, { what: { text: '5' }, where: { cell: 4 } }],
      [null, 'T', 'uncued'], { cues: [null, 'what', 'what'], sets: { what: 'digits', where: 'grid8' }, params: { switchRate: 0.5 } });
    r = NB.score(sw, { responses: [] });
    t.eq(r.why[0].text, 'Match: the cue is WHAT, and 3 is the same digit as one back.');
    t.eq(r.why[1].text, 'Not a match: the position matches one back, but the cue is WHAT and the digit differs.');
    const c = handSpec('nback.transform', 'compass', 1, ['N', 'NE', 'E'].map(days), [null, 'T', 'T'], { params: { step: 1 } });
    t.eq(NB.score(c, { responses: [] }).why[0].text, 'Match: NE is one point clockwise from N, one back.');
    const b = handSpec('nback.transform', 'days', 1, ['Wed', 'Tue'].map(days), [null, 'T'], { params: { step: -1 } });
    t.eq(NB.score(b, { responses: [] }).why[0].text, 'Match: Tue is the day before Wed, one back.');
  });

  await t.test('score: an empty or paused log still returns a complete BlockResult', () => {
    const spec = NB.gen({ trackId: 'nback.switch', rung: 1, seed: 'empty' });
    const r = NB.score(spec, { paused: true });
    for (const k of ['trackId', 'kind', 'ba', 'baMean', 'y', 'dprime', 'crit', 'streams', 'nScorable', 'nVoided', 'voidedRatio', 'plain', 'why', 'extra']) t.ok(k in r, k);
    t.eq(r.extra.paused, true);
    const all = NB.score(spec, { voided: spec.trials.map(tr => tr.i) });
    t.ok(Number.isNaN(all.ba)); t.eq(all.voidedRatio, 1); t.eq(all.why.length, 0);
  });
}
