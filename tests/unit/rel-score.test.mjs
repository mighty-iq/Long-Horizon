// Relations scorer: hand-built specs and logs (Equal Steps, Relation Grid, Relation Stream) + dispatcher.
import { HF, load } from './load.mjs';

for (const f of ['js/tasks/relations/steps.js', 'js/tasks/relations/grid.js', 'js/tasks/relations/stream.js', 'js/tasks/relations/score.js']) load(f);

const R = () => HF.tasks.relations;
const FIELDS = ['trackId', 'kind', 'ba', 'baMean', 'y', 'dprime', 'crit', 'streams', 'nScorable', 'nVoided', 'voidedRatio', 'plain', 'why', 'extra'];

/** A hand-built Equal Steps spec (b = 1): numbers 3, 6, 9, 8, 7, 5, 4 → 9 ✓, 8 ✗ (3 vs 1), 7 ✓, 5 ✗ near (1 vs 2), 4 ✗ (2 vs 1, near). */
function stepsSpec() {
  const xs = [3, 6, 9, 8, 7, 5, 4], S = R().steps;
  return {
    kind: 'stream', task: 'relations', trackId: 'rel.steps', seed: 'hand', set: 'numbers', rung: 0,
    params: S.params(0), onMs: 500, soaMs: 3000, streams: ['main'], leadIn: 2,
    trials: xs.map((x, i) => { const j = S.judge(xs, 1, i); return { i, stim: { main: { number: x } }, scorable: j.scorable, target: { main: j.target }, lure: { main: j.scorable && !j.target && j.near ? 'near' : null } }; }),
    meta: { targets: { main: 2 }, lures: { main: 2 }, protocol: null },
  };
}

export default async function (t) {
  await t.test('score: Equal Steps — hits, misses, false alarms, lure false alarms, why[] from the rule', () => {
    const spec = stepsSpec();
    t.eq(spec.trials.map((x) => (x.target.main ? 'T' : x.lure.main ? 'L' : x.scorable ? '-' : '.')).join(''), '..T-TLL');
    // press 9 (hit), 8 (fa), 5 (lure fa); miss 7; 4 untouched (cr); a press on a lead-in item and a duplicate are ignored
    const log = { responses: [{ key: 'match', t: 100, trial: 1 }, { key: 'match', t: 6450, trial: 2 }, { key: 'match', t: 6900, trial: 2 },
      { key: 'match', t: 9600, trial: 3, rt: 610 }, { key: 'match2', t: 12300, trial: 4 }, { key: 'match', t: 15700, trial: 5 }], voided: [], paused: false };
    const r = R().score(spec, log);
    for (const k of FIELDS) t.ok(k in r, 'field ' + k);
    const m = r.streams.main;
    t.eq([m.hits, m.misses, m.fas, m.crs, m.lureFas, m.lureTrials], [1, 1, 2, 1, 1, 2]);
    t.near(m.hitRate, 0.5); t.near(m.faRate, 2 / 3); t.near(r.ba, (0.5 + 1 / 3) / 2); t.eq(r.ba, r.baMean);
    t.near(r.y, 0); t.eq(m.rtMedian, 450); // 6450 − 2 × 3000
    t.eq(r.plain, { caught: 1, targets: 2, falsePresses: 2, nonTargets: 3 });
    t.eq([r.extra.correct, r.extra.errors, r.extra.errorsByStream.main], [2, 3, 3]);
    t.eq([r.nScorable, r.nVoided, r.voidedRatio], [5, 0, 0]);
    t.eq(r.why.map((w) => [w.i, w.outcome]), [[2, 'hit'], [3, 'fa'], [4, 'miss'], [5, 'lure-fa'], [6, 'cr']]);
    t.eq(r.why[0].text, 'Match: 3, 6, 9 — steps of 3 and 3.');
    t.eq(r.why[1].text, 'Not a match: the steps were 3 and 1.');
    t.eq(r.why[3].text, 'Not a match: the steps were 1 and 2 — close, but not equal.');
    t.ok(r.why.every((w) => w.stream === 'main'));
  });

  await t.test('score: Equal Steps — perfect, never-press, voided trials excluded, empty log', () => {
    const spec = R().gen({ trackId: 'rel.steps', rung: 9, seed: 'sc1' });
    const targets = spec.trials.filter((x) => x.target.main).map((x) => x.i);
    const perfect = R().score(spec, { responses: targets.map((i) => ({ key: 'match', t: i * spec.soaMs + 700, trial: i })), voided: [] });
    t.eq(perfect.ba, 1); t.ok(perfect.dprime > 2.5); t.eq(perfect.plain, { caught: 6, targets: 6, falsePresses: 0, nonTargets: 14 });
    t.eq([perfect.extra.correct, perfect.extra.errors, perfect.extra.accuracy], [20, 0, 1]); t.eq(perfect.streams.main.rtMedian, 700);
    const never = R().score(spec, { responses: [], voided: [] });
    t.eq(never.ba, 0.5); t.eq([never.extra.correct, never.extra.errors], [14, 6]); t.near(never.y, 0);
    t.eq(R().score(spec, undefined).ba, 0.5);
    const nonT = spec.trials.filter((x) => x.scorable && !x.target.main).map((x) => x.i);
    const v = R().score(spec, { responses: targets.map((i) => ({ key: 'match', t: 0, trial: i })), voided: [targets[0], targets[1], nonT[0], 0] });
    t.eq([v.nScorable, v.nVoided], [17, 3]); t.near(v.voidedRatio, 3 / 20);
    t.eq([v.streams.main.hits, v.streams.main.crs], [4, 13]); t.eq(v.why.length, 17);
    t.ok(!v.why.some((w) => w.i === targets[0]));
    t.eq(R().score(Object.assign({}, spec, { meta: Object.assign({}, spec.meta, { protocol: 'wang' }) }), { responses: [], paused: true }).extra.protocol, 'wang');
  });

  await t.test('score: Relation Grid — MATCH/NO/timeouts, voided, why[] texts', () => {
    const spec = R().gen({ trackId: 'rel.grid.T1', rung: 2, seed: 'hand' });
    // four hand-made arrays (digits; last digit counts)
    const cells = (tails) => tails.map((d, k) => String((k + 1) % 10) + String((k * 3) % 10) + d);
    spec.trials = [
      { i: 0, stim: { size: 3, cells: cells(['7', '1', '2', '5', '5', '5', '0', '8', '9']), kept: [] }, answer: 'match', meta: { line: 'row2', near: 0 } },
      { i: 1, stim: { size: 3, cells: cells(['3', '1', '2', '3', '4', '6', '7', '8', '9']), kept: [] }, answer: 'no', meta: { line: null, near: 1 } },
      { i: 2, stim: { size: 3, cells: cells(['4', '1', '2', '0', '4', '6', '7', '8', '4']), kept: [] }, answer: 'no', meta: { line: null, near: 0 } },
      { i: 3, stim: { size: 3, cells: cells(['6', '1', '2', '6', '4', '5', '6', '8', '9']), kept: [] }, answer: 'match', meta: { line: 'col1', near: 0 } },
      { i: 4, stim: { size: 3, cells: cells(['1', '2', '3', '4', '5', '6', '7', '8', '0']), kept: [] }, answer: 'no', meta: { line: null, near: 0 } },
    ];
    const log = { answers: [{ i: 0, response: 'match', rt: 1200 }, { i: 1, response: 'match', rt: 900 }, { i: 2, response: null, rt: null },
      { i: 3, response: null, rt: null }, { i: 4, response: 'no', rt: 800, voided: true }], paused: false };
    const r = R().score(spec, log);
    for (const k of FIELDS) t.ok(k in r, 'field ' + k);
    const m = r.streams.main;
    t.eq([m.hits, m.misses, m.fas, m.crs, m.lureFas, m.lureTrials, m.rtMedian], [1, 1, 1, 1, 1, 1, 1200]);
    t.eq([r.nScorable, r.nVoided, r.voidedRatio, r.extra.timeouts], [4, 1, 0.2, 2]);
    t.eq([r.extra.correct, r.extra.errors], [2, 2]); t.near(r.ba, 0.5);
    t.eq(r.why.map((w) => w.outcome), ['hit', 'lure-fa', 'cr', 'miss']);
    t.eq(r.why[0].text, 'Row 2: 5, 5, 5 — all the same.'); t.eq(r.why[0].line, 'row2'); t.eq(r.why[0].cells, [3, 4, 5]);
    t.eq(r.why[1].text, 'No line fits. Closest: Column 1: 3, 3, 7 — two the same, one different.');
    t.eq(r.why[2].text, 'No line fits the rule.');
    t.eq(r.why[3].text, 'Column 1: 6, 6, 6 — all the same.');
    t.eq(R().score(spec, { answers: [] }).extra.timeouts, 5);
  });

  await t.test('score: Relation Grid — rule wording for Different, Ascending, five-cell shapes, T6, 4×4', () => {
    const G = R().grid;
    for (const tier of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']) {
      const spec = R().gen({ trackId: 'rel.grid.' + tier, rung: 6, seed: 'words' + tier });
      const tgt = spec.trials.find((x) => x.answer === 'match'), non = spec.trials.find((x) => x.answer === 'no');
      const a = G.explain(spec, tgt), b = G.explain(spec, non);
      t.eq(a.line, tgt.meta.line, tier);
      t.ok(/ — (all|increasing|same shape|same fill)/.test(a.text), tier + ': ' + a.text);
      t.ok(/^No (line|shape) fits/.test(b.text), tier + ': ' + b.text);
      const sol = G.solve(spec, tgt);
      t.eq(sol.targets, [tgt.meta.line]);
      const r = R().score(spec, { answers: spec.trials.map((x) => ({ i: x.i, response: x.answer, rt: 1000 })) });
      t.eq(r.ba, 1, tier + ' perfect');
    }
    const t2 = R().gen({ trackId: 'rel.grid.T2', rung: 0, seed: 'asc', variant: 'digits' });
    const tr2 = t2.trials.find((x) => x.answer === 'match');
    t.ok(/ — increasing from (left to right|top to bottom)\.$/.test(G.explain(t2, tr2).text));
  });

  await t.test('score: Relation Stream — press-only scoring and explanations', () => {
    const spec = R().gen({ trackId: 'rel.stream', rung: 1, seed: 'sc', params: { rule: 'same' } });
    const targets = spec.trials.filter((x) => x.target.main).map((x) => x.i), lures = spec.trials.filter((x) => x.lure.main === 'near').map((x) => x.i);
    const log = { responses: targets.concat(lures.slice(0, 3)).map((i) => ({ key: 'match', t: i * spec.soaMs + 400, trial: i })), voided: [] };
    const r = R().score(spec, log), m = r.streams.main;
    t.eq([m.hits, m.misses, m.fas, m.lureFas, m.lureTrials], [6, 0, 3, 3, lures.length]);
    t.eq(r.plain, { caught: 6, targets: 6, falsePresses: 3, nonTargets: 24 }); t.eq(m.rtMedian, 400);
    t.eq(r.why.length, 30);
    const w = r.why.find((x) => x.i === targets[0]);
    t.eq(w.outcome, 'hit'); t.ok(/^Match: (Row|Column) [123]: .* — all the same\.$/.test(w.text)); t.eq(w.line, spec.trials[targets[0]].line);
    t.eq(r.why.find((x) => x.i === lures[0]).outcome, 'lure-fa');
  });

  await t.test('score: dispatcher errors', () => {
    t.throws(() => R().score(null, {}));
    t.throws(() => R().score({ kind: 'span', trials: [] }, {}));
    t.throws(() => R().gen({ trackId: 'rel.unknown', rung: 0, seed: 'x' }));
    t.throws(() => R().gen({}));
  });
}
