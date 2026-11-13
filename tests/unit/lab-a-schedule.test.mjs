// Lab schedule: windows, statuses, forms, flags, reasoning cap, no-baseline path, study programmes.
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/schedule.js', 'js/lab/study.js']) load(f);

const D = (m, d, h = 10, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const pad = n => (n < 10 ? '0' : '') + n;
const dayKey = ms => { const x = new Date(ms); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };

function tests(ids) { const o = {}; ids.forEach(id => { o[id] = { score: 0.5, flags: [] }; }); return o; }
function visit(id, kind, start, ids, extra) {
  return Object.assign({ id, kind, config: 'standard', form: null, startedAt: start, endedAt: start + 50 * 60000,
    device: { class: 'desktop', input: 'keyboard' }, hour: new Date(start).getHours(), checkin: {}, closeout: {}, tests: tests(ids), flags: [] }, extra || {});
}
function sessions(n, firstDay, opts) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const st = D(1, firstDay + k, (opts && opts.hour) || 18);
    out.push({ id: 's' + k, startedAt: st, endedAt: st + 25 * 60000, dayKey: dayKey(st), counted: true, mode: 'varied' });
  }
  return out;
}
function recs(o) {
  o = o || {};
  return { schema: 1, profile: { anonId: o.anonId || 'anon-7' }, settings: Object.assign({ labConfig: 'standard' }, o.settings || {}),
    sessions: o.sessions || [], blocks: [], labVisits: o.visits || [], events: o.events || [], calibration: null };
}

export default async function (t) {
  const L = HF.lab;
  const STD = L.visitTests('standard'), A = L.visitTests('standard', { part: 'A' }), B = L.visitTests('standard', { part: 'B' });
  const row = L.formOrder('anon-7');
  const sod = L._date.startOfDay, add = L._date.addDays, eod = L._date.endOfDay;

  await t.test('fresh user: B1 due with the first form of the Latin-square row and all standard tests', () => {
    const s = L.schedule(recs(), null, D(1, 5));
    t.eq(s.path, 'measure'); t.eq(s.counted, 0);
    t.eq([s.next.kind, s.next.status, s.next.form, s.next.config], ['B1', 'due', row[0], 'standard']);
    t.eq(s.next.tests, STD); t.eq(s.next.notToday, false);
    t.eq(s.plan.map(p => p.kind), ['B1', 'B2', 'Q', 'POST', 'FU']);
    t.eq(s.plan.map(p => p.status), ['due', 'waiting', 'waiting', 'waiting', 'waiting']);
    t.eq(s.reasoningLeft, 4);
  });

  await t.test('B1 in two sittings: part B due within 3 days, then B2 2–7 days after B1', () => {
    const v1 = visit('v1', 'B1', D(1, 5), A);
    let s = L.schedule(recs({ visits: [v1] }), null, D(1, 6));
    t.eq([s.next.kind, s.next.part, s.next.status], ['B1', 'B', 'due']); t.eq(s.next.tests, B);
    t.eq(s.next.dueTo, eod(add(D(1, 5), 3)));
    s = L.schedule(recs({ visits: [v1] }), null, D(1, 10));
    t.eq(s.next.status, 'overdue');
    const v2 = visit('v2', 'B1', D(1, 7), B);
    const r = recs({ visits: [v1, v2] });
    s = L.schedule(r, null, D(1, 8));
    t.eq(s.plan[0].status, 'done');
    t.eq([s.next.kind, s.next.status], ['B2', 'upcoming']);
    const ref = D(1, 7) + 50 * 60000;
    t.eq(s.next.dueFrom, add(sod(ref), 2)); t.eq(s.next.dueTo, eod(add(ref, 7)));
    t.eq(new Date(s.next.dueFrom).getDate(), 9); t.eq(new Date(s.next.dueTo).getDate(), 14);
    t.eq(L.schedule(r, null, D(1, 9, 0, 1)).next.status, 'due');
    t.eq(L.schedule(r, null, D(1, 14, 23, 59)).next.status, 'due');
    t.eq(L.schedule(r, null, D(1, 15, 0, 1)).next.status, 'overdue');
    t.eq(s.next.form, row[1]);
  });

  await t.test('training before B2 makes B2 missed; Q after session 10 with the quick tests; then POST waits', () => {
    const b1 = visit('b1', 'B1', D(1, 2), STD);
    let s = L.schedule(recs({ visits: [b1], sessions: sessions(1, 5) }), null, D(1, 6));
    t.eq(s.plan[1].status, 'missed'); t.eq(s.path, 'measure');
    const b2 = visit('b2', 'B2', D(1, 5, 9), STD);
    const base = [b1, b2];
    s = L.schedule(recs({ visits: base, sessions: sessions(9, 6) }), null, D(1, 20));
    t.eq([s.next.kind, s.next.status], ['Q', 'waiting']); t.eq(s.next.waitingFor, { sessions: 10, done: 9 });
    s = L.schedule(recs({ visits: base, sessions: sessions(10, 6) }), null, D(1, 15, 20));
    t.eq([s.next.kind, s.next.status, s.next.config, s.next.form], ['Q', 'due', 'quick', row[1]]);
    t.eq(s.next.tests, ['lab.nback', 'lab.rel']); t.eq(s.next.beforeSession, 11);
    t.eq(s.next.notToday, true, 'session 10 was today: the Lab comes before training on a training day');
    t.eq(L.schedule(recs({ visits: base, sessions: sessions(10, 6) }), null, D(1, 16, 9)).next.notToday, false);
    t.ok(s.seedFor('Q', 'lab.nback').endsWith('/' + row[1] + '/Q1'), s.seedFor('Q', 'lab.nback'));
    s = L.schedule(recs({ visits: base, sessions: sessions(11, 6) }), null, D(1, 20));
    t.eq(s.plan[2].status, 'missed'); t.eq([s.next.kind, s.next.status], ['POST', 'waiting']);
    t.eq(s.next.waitingFor, { sessions: 20, done: 11 });
  });

  await t.test('POST 1–3 days after session 20, FU 8–12 weeks after POST', () => {
    const b1 = visit('b1', 'B1', D(1, 2), STD), b2 = visit('b2', 'B2', D(1, 5, 9), STD);
    const q = visit('q', 'Q', D(1, 16, 9), ['lab.nback', 'lab.rel'], { config: 'quick' });
    const ss = sessions(20, 6); // session 20 on Jan 25
    const r = recs({ visits: [b1, b2, q], sessions: ss });
    let s = L.schedule(r, null, D(1, 25, 20));
    t.eq([s.next.kind, s.next.status, s.next.notToday], ['POST', 'upcoming', true]);
    t.eq(s.next.dueFrom, D(1, 26, 0)); t.eq(s.next.dueTo, eod(D(1, 28)));
    t.eq(s.next.tests, STD); t.eq(s.next.form, row[2]);
    t.eq(L.schedule(r, null, D(1, 27)).next.status, 'due');
    t.eq(L.schedule(r, null, D(1, 30)).next.status, 'overdue');
    const post = visit('post', 'POST', D(1, 27, 10), STD);
    const r2 = recs({ visits: [b1, b2, q, post], sessions: ss });
    s = L.schedule(r2, null, D(2, 1));
    t.eq([s.next.kind, s.next.status, s.next.form], ['FU', 'upcoming', row[3]]);
    t.eq(s.next.dueFrom, add(sod(D(1, 27, 10)), 56)); t.eq(s.next.dueTo, eod(add(D(1, 27, 10), 84)));
    t.eq(L.schedule(r2, null, add(D(1, 27, 10), 60)).next.status, 'due');
    t.eq(L.schedule(r2, null, add(D(1, 27, 10), 90)).next.status, 'overdue');
    const fu = visit('fu', 'FU', add(D(1, 27, 10), 63), STD);
    s = L.schedule(recs({ visits: [b1, b2, q, post, fu], sessions: ss }), null, add(D(1, 27, 10), 70));
    t.eq(s.next, null); t.eq(s.reasoningLeft, 0);
    t.eq(s.plan.map(p => p.status), ['done', 'done', 'done', 'done', 'done']);
    t.eq(s.testsFor('X'), A, 'extra visits are memory-only');
    t.eq(s.testsFor('Q'), ['lab.nback', 'lab.rel']);
  });

  await t.test('reasoning tests at most 4 times; forms follow the Latin square; recorded forms win', () => {
    const b1 = visit('b1', 'B1', D(1, 2), STD, { form: 'C' });
    const extra = visit('x1', 'X', D(1, 3), B); // an odd record that ran reasoning tests
    const s = L.schedule(recs({ visits: [b1, extra] }), null, D(1, 4));
    t.eq(s.reasoningLeft, 2);
    t.eq(s.formFor('B1'), 'C'); t.eq(s.formFor('B2'), row[1]); t.eq(s.formFor('POST'), row[2]); t.eq(s.formFor('FU'), row[3]);
    t.eq(s.formFor('X'), row[1 % 4], 'X rotates through the row');
    t.ok(s.seedFor('X', 'lab.sspan').endsWith('/X2'));
    t.eq(s.seedFor('B2', 'lab.sspan'), L.formSeed('lab.sspan', row[1]));
    const four = ['B1', 'B2', 'POST', 'FU'].map((k, i) => visit('r' + i, k, D(1, 2 + i), B));
    const s4 = L.schedule(recs({ visits: four.slice(0, 3).concat([visit('xx', 'X', D(1, 9), B)]) }), null, D(1, 10));
    t.eq(s4.reasoningLeft, 0); t.eq(s4.testsFor('FU'), A, 'no fifth exposure');
    t.eq(s4.testsFor('POST'), STD, 'a kind that already had reasoning keeps it');
  });

  await t.test('no-baseline path: training first, POST and FU still scheduled, extra visits allowed', () => {
    const s = L.schedule(recs({ sessions: sessions(3, 6) }), null, D(1, 10));
    t.eq(s.path, 'no-baseline');
    t.eq(s.plan.map(p => p.status), ['skipped', 'skipped', 'skipped', 'waiting', 'waiting']);
    t.eq([s.next.kind, s.next.status], ['POST', 'waiting']); t.ok(s.canStartExtra);
    const s20 = L.schedule(recs({ sessions: sessions(20, 6) }), null, D(1, 27));
    t.eq([s20.next.kind, s20.next.status], ['POST', 'due']);
    // a train-first user who has not trained yet can still take B1
    t.eq(L.schedule(recs({ sessions: [] }), null, D(1, 1)).path, 'measure');
    // an aborted B1 (no test results) is not a baseline
    const aborted = visit('b0', 'B1', D(1, 1), []);
    const sa = L.schedule(recs({ visits: [aborted], sessions: sessions(2, 6) }), null, D(1, 10));
    t.eq(sa.path, 'no-baseline');
    t.eq(L.schedule(recs({ visits: [aborted] }), null, D(1, 2)).next.kind, 'B1');
  });

  await t.test('visit flags: device class, input, time of day (circular), after training, outside window', () => {
    const b1 = visit('b1', 'B1', D(1, 2, 23), STD);
    const b2 = visit('b2', 'B2', D(1, 12, 1), STD, { device: { class: 'phone', input: 'touch' } }); // 1 a.m. = 2 h from 23 h; day 10 after B1
    const q = visit('q', 'Q', D(1, 16, 19), ['lab.nback', 'lab.rel'], { config: 'quick', flags: ['help-used'] });
    const ss = sessions(10, 6); ss[9].startedAt = D(1, 15, 8); ss[9].endedAt = D(1, 15, 9);
    ss.push({ id: 'same-day', startedAt: D(1, 16, 8), endedAt: D(1, 16, 9), dayKey: dayKey(D(1, 16, 8)), counted: false });
    const s = L.schedule(recs({ visits: [b1, b2, q], sessions: ss }), null, D(1, 17));
    const f = id => s.visits.find(v => v.id === id).flags;
    t.eq(f('b1'), []);
    t.ok(f('b2').includes('device-class') && f('b2').includes('device-input'), JSON.stringify(f('b2')));
    t.ok(!f('b2').includes('time-of-day'), '23 h vs 1 h is 2 h apart');
    t.ok(f('b2').includes('outside-window'), 'B2 on day 10 is outside 2–7 days');
    t.ok(f('q').includes('time-of-day') && f('q').includes('after-training') && f('q').includes('help-used'), JSON.stringify(f('q')));
  });

  await t.test('settings.labConfig and partial visits shape the next visit', () => {
    const s = L.schedule(recs({ settings: { labConfig: 'minimum' } }), null, D(1, 1));
    t.eq(s.next.tests, ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.matrix', 'lab.series']);
    const half = visit('b1', 'B1', D(1, 1), ['lab.nback', 'lab.rel'], { config: 'extended' });
    const s2 = L.schedule(recs({ visits: [half] }), null, D(1, 2));
    t.eq([s2.next.part, s2.next.config], ['A', 'extended']);
    t.eq(s2.next.tests, ['lab.sspan', 'lab.update', 'lab.bind']);
  });

  await t.test('study templates: Cao (6 sessions, no Q) and the Lab-only arm (calendar-based)', () => {
    const b1 = visit('b1', 'B1', D(1, 2), STD), b2 = visit('b2', 'B2', D(1, 5, 9), STD);
    const cao = [{ id: 'e1', t: D(1, 5, 12), type: 'study-enrol', template: 'cao', consentAt: D(1, 5, 12) },
      { id: 'e2', t: D(1, 5, 13), type: 'study-draw', arm: 'cao-exec', salt: 'x', commitment: 'y' }];
    const s = L.schedule(recs({ visits: [b1, b2], sessions: sessions(6, 6), events: cao }), null, D(1, 12));
    t.eq(s.programme.sessions, 6); t.eq(s.programme.quickBefore, null);
    t.eq(s.plan.map(p => p.kind), ['B1', 'B2', 'POST', 'FU']);
    t.eq([s.next.kind, s.next.status], ['POST', 'due']);
    const lab = [{ id: 'e1', t: D(1, 5, 12), type: 'study-enrol', template: 'default' },
      { id: 'e2', t: D(1, 5, 13), type: 'study-draw', arm: 'labonly', salt: 'x', commitment: 'y' }];
    const ref = D(1, 5, 9) + 50 * 60000;
    let sl = L.schedule(recs({ visits: [b1, b2], events: lab }), null, D(1, 10));
    t.eq([sl.next.kind, sl.next.status], ['Q', 'upcoming']);
    t.eq(sl.next.dueFrom, add(sod(ref), 17));
    sl = L.schedule(recs({ visits: [b1, b2, visit('q', 'Q', add(ref, 18), ['lab.nback', 'lab.rel'])], events: lab }), null, add(ref, 37));
    t.eq([sl.next.kind, sl.next.status], ['POST', 'due']);
    t.eq(sl.next.dueFrom, add(sod(ref), 36)); t.eq(sl.next.dueTo, eod(add(ref, 38)));
  });
}
