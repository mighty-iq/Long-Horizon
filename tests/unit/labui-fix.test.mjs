// Phase 4 fixes in the Lab UI area (labui): CSV formula guard with '-' (CB-08), the calibration tombstone in the export
// and the Lab texts (CB-07), study state and export for 'study-posted' (SC-04) and 'study-leave' (QA), neutral study
// texts (SC-01, SC-04), noise-band verdict wording and practiceN import (SC-08).
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/tests/sspan.js', 'js/lab/schedule.js', 'js/lab/levels.js', 'js/lab/compare.js',
  'js/lab/study.js', 'js/lab/export.js']) load(f);
// DOM modules whose texts and pure helpers are checked here (nothing touches the DOM at load time)
load('js/ui/study.js');
load('js/ui/lab.js');

const T = (m, d, h = 10) => new Date(2026, m - 1, d, h).getTime();

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

function studyRecords(extraEvents, calibration) {
  const d = HF.study.draw('labui-fix', { template: 'default' });
  return {
    d,
    records: {
      schema: 1, profile: { anonId: 'anon-y' }, settings: {}, calibration: calibration === undefined ? null : calibration,
      sessions: [], blocks: [],
      labVisits: [{ id: 'v1', kind: 'B2', config: 'standard', form: 'A', startedAt: T(2, 1), endedAt: T(2, 1, 11), tests: { 'lab.sspan': { score: 0.6, sub: {}, flags: [] } }, flags: [] },
        { id: 'v2', kind: 'POST', config: 'standard', form: 'B', startedAt: T(3, 1), endedAt: T(3, 1, 11), tests: { 'lab.sspan': { score: 0.9, sub: {}, flags: [] } }, flags: [] }],
      events: [{ id: 'e1', t: T(1, 20), type: 'study-enrol', template: 'default', consentAt: T(1, 20) },
        { id: 'e2', t: T(2, 2), type: 'study-draw', arm: d.arm, salt: d.salt, commitment: d.commitment, template: 'default', arms: d.arms }].concat(extraEvents || [])
    }
  };
}

export default async function (t) {
  await t.test('CB-08: CSV guard adds a quote before "-" text, but negative numbers stay numbers', () => {
    const csv = HF.lab.toCsv([{ a: '-2+3', b: -1.5, c: '-3', d: '-0.25', e: '-1e3', f: '-x', g: '=1', h: '+1', i: '@a', j: '-', k: 'ok-ish', l: '-.5' }]);
    const [head, row] = parseCsv(csv);
    const v = {}; head.forEach((k, i) => { v[k] = row[i]; });
    t.eq([v.a, v.f, v.j, v.g, v.h, v.i], ["'-2+3", "'-x", "'-", "'=1", "'+1", "'@a"], 'formula-like text guarded');
    t.eq([v.b, v.c, v.d, v.e, v.l, v.k], ['-1.5', '-3', '-0.25', '-1e3', '-.5', 'ok-ish'], 'numbers and plain text untouched');
  });

  await t.test('CB-07: a calibration tombstone counts as no calibration (export, compare, Lab texts)', () => {
    const cal = { version: 'c1', source: 'unit', updatedAt: T(1, 1), tests: { 'lab.sspan': { r: 0.8, sd: 0.1, mean: 0.7, n: 80 } } };
    const withCal = HF.lab.exportBundle(studyRecords([], cal).records, { now: T(3, 2) }).json;
    t.eq(withCal.scores.calibration.version, 'c1');
    t.eq(withCal.scores.compare['lab.sspan'].verdict, 'above');
    const tomb = { updatedAt: T(2, 20), removed: true, tests: {} };
    const j = HF.lab.exportBundle(studyRecords([], tomb).records, { now: T(3, 2) }).json;
    t.eq(j.scores.calibration, null, 'export: removed = none');
    t.eq(j.scores.compare['lab.sspan'].verdict, 'uncalibrated', 'compare: removed = none');
    // what lab.js writes on "Remove" survives a merge with the older calibration (another tab, an older backup)
    const older = HF.schema.defaultRecords(); older.calibration = cal;
    const newer = HF.schema.defaultRecords(); newer.calibration = tomb;
    for (const m of [HF.schema.merge(older, newer), HF.schema.merge(newer, older)]) {
      t.ok(m.calibration && m.calibration.removed === true, 'tombstone wins: ' + JSON.stringify(m.calibration));
      t.eq(HF.lab.exportBundle(Object.assign(studyRecords([]).records, { calibration: m.calibration }), { now: T(3, 2) }).json.scores.calibration, null);
    }
  });

  await t.test('SC-04 + QA: study state reads study-posted (for this draw) and study-leave; the export carries both', () => {
    let { d, records } = studyRecords([]);
    let st = HF.study.state(records);
    t.eq([st.arm, st.postedAt, st.left], [d.arm, null, null]);
    ({ d, records } = studyRecords([{ id: 'p0', t: T(2, 3), type: 'study-posted', commitment: 'another code' }]));
    t.eq(HF.study.state(records).postedAt, null, 'a posted event for another commitment does not count');
    ({ d, records } = studyRecords([{ id: 'p1', t: T(2, 3), type: 'study-posted', commitment: null }]));
    records.events[2].commitment = d.commitment;
    st = HF.study.state(records);
    t.eq(st.postedAt, T(2, 3));
    records.events.push({ id: 'l1', t: T(2, 20), type: 'study-leave' }, { id: 'l2', t: T(2, 25), type: 'study-leave' });
    st = HF.study.state(records);
    t.eq([st.left, st.arm, st.template], [T(2, 20), d.arm, 'default'], 'the first leave counts; template and arm stay for the export');
    const j = HF.lab.exportBundle(records, { now: T(3, 2) }).json;
    t.eq([j.study.leftAt, j.study.codePostedAt], [new Date(T(2, 20)).toISOString(), new Date(T(2, 3)).toISOString()]);
    // a leave before the (latest) enrolment does not count, as in HF.engine.derive (a new enrolment starts afresh)
    const ev2 = [{ id: 'x1', t: 1, type: 'study-leave' }, { id: 'x2', t: 2, type: 'study-enrol', template: 'wang', consentAt: 2 }];
    t.eq(HF.study.state({ events: ev2 }).left, null);
    t.eq(HF.study.state({ events: ev2.concat([{ id: 'x3', t: 3, type: 'study-leave' }]) }).left, 3);
    t.eq(HF.lab.exportBundle(studyRecords([]).records, { now: T(3, 2) }).json.study.leftAt, null);
  });

  await t.test('SC-01: participant-facing study texts never say which programme is the comparison', () => {
    const bad = /control|comparison|matched|untrained|no memory load|same dose|dose|placebo|active/i;
    const P = HF.ui.study.PLAN_TEXT, TT = HF.ui.study.TEMPLATE_TEXT;
    for (const id of Object.keys(P)) t.ok(!bad.test(P[id]), 'PLAN_TEXT.' + id + ': ' + P[id]);
    for (const id of Object.keys(TT)) t.ok(!bad.test(TT[id]), 'TEMPLATE_TEXT.' + id + ': ' + TT[id]);
    for (const id of HF.study.TEMPLATE_ORDER) {
      const tpl = HF.study.templates[id];
      t.ok(!bad.test(tpl.title) && !/ vs /.test(tpl.title), 'title ' + tpl.title);
      for (const a of tpl.arms) t.ok(typeof P[a.id] === 'string' && P[a.id].length > 10, 'every arm has a line: ' + a.id);
      // the same style for every training arm: "<Task>: <what you do>." — one sentence head, a colon, a full stop
      for (const a of tpl.arms) t.ok(/^[A-Z][^:]{2,40}: .+\.$/.test(P[a.id]), 'style ' + a.id + ': ' + P[a.id]);
    }
    t.eq(P['cao-search'], P.search); t.eq(P['wang-search'], P.search);
  });

  await t.test('SC-04: the commitment code is described as showing the programme behind the posted code', () => {
    const lim = HF.study.limitations.join(' ');
    t.ok(lim.includes('shows that the programme you followed is the one behind the code you posted'), lim);
    t.ok(!/shows later that a solo draw was not repeated/.test(lim));
  });

  await t.test('SC-08: verdict texts say measurement noise only; the retest gain is not subtracted; practiceN imported', () => {
    const v = HF.ui.lab.verdictText;
    const up = v({ verdict: 'above', higherIsBetter: true });
    t.ok(up.includes('measurement noise alone') && up.includes('not subtracted') && !/retesting usually gives/.test(up), up);
    t.ok(v({ verdict: 'below', higherIsBetter: true }).includes('measurement noise alone'));
    t.ok(v({ verdict: 'above', higherIsBetter: false }).includes('beyond measurement noise'));
    const adj = v({ verdict: 'above', higherIsBetter: true, rciPractice: 2.5 });
    t.ok(adj.includes('at least 30 people who did not train: still above.'), adj);
    t.ok(v({ verdict: 'above', higherIsBetter: true, rciPractice: 1.0 }).endsWith('inside.'));
    t.ok(!v({ verdict: 'above', higherIsBetter: true, rciPractice: null }).includes('subtracting'));
    const res = HF.ui.lab.parseCalibration(JSON.stringify({ version: 'v', tests: { 'lab.sspan': { r: 0.8, sd: 0.1, n: 60, practice: 0.04, practiceN: 31 } } }));
    t.eq([res.ok, res.calibration.tests['lab.sspan'].practiceN, res.calibration.tests['lab.sspan'].practice], [true, 31, 0.04]);
  });
}
