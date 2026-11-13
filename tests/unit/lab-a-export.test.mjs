// Study export bundle: JSON sections (research/04 §18), CSV tables, salt reveal, trial rows from logs, CSV safety.
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/tests/sspan.js', 'js/lab/tests/update.js', 'js/lab/tests/bind.js',
  'js/lab/schedule.js', 'js/lab/levels.js', 'js/lab/compare.js', 'js/lab/study.js', 'js/lab/export.js']) load(f);

const T = (m, d, h = 10) => new Date(2026, m - 1, d, h).getTime();

function run(testId, form) {
  const def = HF.lab.tests[testId];
  const spec = def.gen({ form });
  let log;
  if (testId === 'lab.sspan') log = { trials: spec.trials.map(tr => ({ i: tr.i, proc: tr.pairs.map(p => ({ resp: p.proc.symmetric, rt: 1800 })), recall: tr.pairs.map(p => p.mem) })) };
  else log = { trials: spec.trials.map(tr => ({ i: tr.i, answers: tr.probes.map((p, j) => ({ probe: j, response: p.answer, rt: 1500 })) })) };
  return { spec, log, result: def.score(spec, log) };
}

function build(opts) {
  opts = opts || {};
  const ids = ['lab.sspan', 'lab.update', 'lab.bind'];
  const visits = [], labLogs = {};
  const kinds = opts.kinds || ['B1', 'B2'];
  kinds.forEach((kind, k) => {
    const form = HF.lab.formOrder('anon-x')[k % 4];
    const tests = {};
    labLogs['v' + k] = {};
    ids.forEach(id => { const r = run(id, form); tests[id] = r.result; labLogs['v' + k][id] = { log: r.log, spec: k === 0 ? r.spec : undefined }; });
    tests['lab.nback'] = { score: 1.2, scoreLabel: 'd′ 1.20', sub: {}, flags: ['too-fast'], form, seed: 'x', version: 1 };
    visits.push({ id: 'v' + k, kind, config: 'extended', form, startedAt: T(1, 2 + 5 * k), endedAt: T(1, 2 + 5 * k) + 3e6,
      device: { class: 'desktop', input: 'keyboard' }, hour: 10, checkin: { sleep: 7, alertness: 4, note: 'slept, badly' },
      closeout: { effort: 4, help: false, strategy: '=SUM(A1) "quoted"\nnew line' }, tests, flags: [] });
  });
  const d = HF.study.draw('exp', { template: 'default' });
  const records = {
    schema: 1, appVersion: '1.0.0', profile: { anonId: 'anon-x' }, settings: { labConfig: 'extended' },
    calibration: { version: 'c1', source: 'unit', updatedAt: T(1, 1), tests: { 'lab.sspan': { r: 0.8, sd: 0.1, mean: 0.7, n: 80 } } },
    sessions: [{ id: 's1', startedAt: T(1, 13, 18), endedAt: T(1, 13, 18) + 1.5e6, dayKey: '2026-01-13', mode: 'varied', protocol: null,
      study: { template: 'default', arm: d.arm }, planned: 14, completed: 14, counted: true, minutes: 25, endedBy: 'done' }],
    blocks: [{ id: 'k1', sessionId: 's1', t: T(1, 13, 18), trackId: 'nback.plain', set: opts.labSet ? 'glyphsLab' : 'letters', role: 'rated', mode: 'varied',
      protocol: null, seed: 'abc', rung: 2, levelBefore: 2, levelAfter: 3, moved: 1, reason: 'up', result: { ba: 0.9, baMean: 0.9, y: 0.8, dprime: 2.1, crit: 0.1 },
      interrupted: false, voidedRatio: 0, frame: { fps: 60, stalls: 0 } }],
    labVisits: visits,
    events: [{ id: 'e1', t: T(1, 7), type: 'study-enrol', template: 'default', consentAt: T(1, 7) },
      { id: 'e2', t: T(1, 7, 11), type: 'study-draw', arm: d.arm, salt: d.salt, commitment: d.commitment },
      { id: 'e3', t: T(1, 7, 12), type: 'study-expect', when: 'B2', values: { memory: 6, reasoning: 4, everyday: 5 } },
      { id: 'e4', t: T(1, 8), type: 'note', text: 'tired' }]
  };
  return { records, labLogs, draw: d };
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  return rows;
}

export default async function (t) {
  const L = HF.lab;

  await t.test('export bundle: JSON sections and shapes', () => {
    const { records, labLogs, draw } = build();
    const out = L.exportBundle(records, { labLogs, now: T(1, 20), appVersion: '1.0.0', includeUA: false, userAgent: 'UA' });
    const j = out.json;
    t.eq(Object.keys(j), ['meta', 'study', 'visits', 'labTrials', 'scores', 'training', 'questionnaires', 'notes']);
    t.eq([j.meta.exportSchema, j.meta.kind, j.meta.appVersion, j.meta.anonId, j.meta.userAgent], [1, 'long-horizon-study-export', '1.0.0', 'anon-x', null]);
    t.eq(L.EXPORT_KIND, 'long-horizon-study-export');
    t.ok(/^[0-9a-f]{64}$/.test(j.meta.formSeedHash)); t.eq(j.meta.blueprints['lab.sspan'], 1);
    t.eq(j.meta.device, { class: 'desktop', input: 'keyboard' });
    t.eq([j.study.template, j.study.arm, j.study.mode, j.study.commitment, j.study.verified], ['default', draw.arm, 'solo', draw.commitment, true]);
    t.eq([j.study.salt, j.study.saltRevealed], [null, false], 'salt hidden before Post');
    t.eq(j.visits.length, 2); t.eq(Object.keys(j.visits[0].tests).sort(), ['lab.bind', 'lab.nback', 'lab.sspan', 'lab.update']);
    t.eq(j.visits[1].tests['lab.sspan'].score, 1);
    t.eq(j.labTrials.length, 2 * (84 + 30 + 58));
    t.ok(j.labTrials.every(r => r.visit_id && r.kind && r.test));
    t.eq(j.notes.filter(n => n.includes('lab.nback')).length, 2, 'missing n-back logs are noted');
    t.eq(j.scores.compare['lab.sspan'].verdict, null, 'calibrated, but no visit after B2 yet');
    t.eq(j.scores.calibration.tests['lab.sspan'].n, 80);
    t.eq(j.scores.levels['lab.sspan'].level, 'mid');
    t.eq([j.training.counted, j.training.setsUsed, j.training.labSetsTrained], [1, ['letters'], false]);
    t.eq(j.training.adherence.programme, 20);
    t.eq(j.questionnaires.expectations[0].values.memory, 6); t.eq(j.questionnaires.notes[0].text, 'tired');
    t.ok(/^long-horizon-study-anon-x-2026-01-20\.json$/.test(out.filename), out.filename);
    JSON.parse(JSON.stringify(j));
  });

  await t.test('salt is revealed after Post (or on request); Lab sets in training are detected', () => {
    const a = build({ kinds: ['B1', 'B2', 'POST'] });
    t.eq(L.exportBundle(a.records, { labLogs: a.labLogs, now: T(3, 1) }).json.study.salt, a.draw.salt);
    const b = build({ labSet: true });
    const jb = L.exportBundle(b.records, { labLogs: b.labLogs, now: T(3, 1), revealSalt: true }).json;
    t.eq(jb.study.salt, b.draw.salt); t.eq(jb.training.labSetsTrained, true);
  });

  await t.test('CSV tables: headers, one row per visit × test, per trial, per block; safe quoting', () => {
    const { records, labLogs } = build();
    const out = L.exportBundle(records, { labLogs, now: T(1, 20) });
    const visits = parseCsv(out.csv.visits);
    t.eq(visits[0].slice(0, 4), ['visit_id', 'kind', 'config', 'form']);
    t.eq(visits.length, 1 + 2 * 4);
    const head = visits[0];
    const strat = visits[1][head.indexOf('closeout_strategy')];
    t.eq(strat, '\'=SUM(A1) "quoted"\nnew line', 'formula guard + quotes + newline survive');
    t.eq(visits[1][head.indexOf('checkin_note')], 'slept, badly');
    t.ok(head.includes('score') && head.includes('test_flags') && head.includes('seed'));
    const trials = parseCsv(out.csv.trials);
    t.eq(trials.length, 1 + 2 * (84 + 30 + 58));
    t.eq(trials[0].slice(0, 3), ['visit_id', 'kind', 'test']);
    t.ok(trials.slice(1).every(r => r.length === trials[0].length));
    const blocks = parseCsv(out.csv.blocks);
    t.eq(blocks.length, 2); t.eq(blocks[1][blocks[0].indexOf('track')], 'nback.plain');
    t.eq(blocks[1][blocks[0].indexOf('interrupted')], 'false');
    const sessions = parseCsv(out.csv.sessions);
    t.eq(sessions.length, 2); t.eq(sessions[1][sessions[0].indexOf('study_arm')], records.sessions[0].study.arm);
  });

  await t.test('specs are regenerated from form + seed when the log has none; empty records export cleanly', () => {
    const { records, labLogs } = build();
    const rows = L.exportBundle(records, { labLogs, now: T(1, 20) }).json.labTrials;
    const v1 = rows.filter(r => r.visit_id === 'v1' && r.test === 'lab.sspan');
    t.eq(v1.length, 84); t.ok(v1.every(r => r.correct === true));
    const empty = L.exportBundle({}, { now: T(1, 1) });
    t.eq([empty.json.visits.length, empty.json.labTrials.length, empty.json.study], [0, 0, null]);
    t.ok(empty.csv.visits.startsWith('visit_id,'));
    t.eq(L.toCsv([{ a: 1, b: true, c: null, d: { x: 1 } }]), 'a,b,c,d\r\n1,true,,"{""x"":1}"\r\n');
  });
}
