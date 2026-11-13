// Engine: derive() — levels, availability, offsets, counters, overrides, study, Lab status, speed.
import { HF } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
loadEngine();

const at = (d, h = 10, m = 0) => new Date(2026, 0, d, h, m).getTime();
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

/** Result in the scorer's shape with roughly the given BA (6 targets, 14 non-targets per stream). */
export function resultFor(bp, ba) {
  const tr = HF.catalog.get(bp.trackId);
  if (tr.scale === 'recall') return { trackId: bp.trackId, ba, baMean: ba, y: ba, streams: {}, nScorable: 9, voidedRatio: 0, extra: { recall: ba, procAcc: 0.95 } };
  const nT = tr.blockKind === 'discrete' ? 10 : 6, nN = tr.blockKind === 'discrete' ? 10 : 14;
  const h = Math.round(nT * ba), cr = Math.round(nN * ba), s = HF.stats.sdt(h, nT - h, nN - cr, cr);
  const one = { hits: h, misses: nT - h, fas: nN - cr, crs: cr, lureFas: 0, lureTrials: 4, ba: s.ba, rtMedian: 600 };
  const streams = tr.dualVisual ? { pos: one, snd: one } : { main: one };
  return { trackId: bp.trackId, ba: s.ba, baMean: s.ba, y: s.y, dprime: s.dprime, crit: s.criterion, streams, nScorable: nT + nN, nVoided: 0, voidedRatio: 0, extra: {} };
}

/** Plays one planned session with a BA function; returns the new records and everything emitted. */
export function drive(rec, now, opts = {}) {
  let d = HF.engine.derive(rec, now);
  const plan = HF.engine.plan(rec, d, { now, id: opts.id || 'S' + (rec.sessions.length + 1), modeId: opts.modeId, minutes: opts.minutes, protocolIds: opts.protocolIds });
  ({ records: rec } = HF.engine.beginSession(rec, plan, { now }));
  d = HF.engine.derive(rec, now);
  const events = [], bps = [];
  const slots = plan.slots.slice(0, opts.n != null ? opts.n : plan.slots.length);
  for (const slot of slots) {
    const s = slot.trackId ? slot : HF.planner.freeSlot(plan, { trackId: 'nback.plain' });
    const bp = HF.engine.prepare(s, rec, d, { sessionId: plan.id });
    bps.push(bp);
    const ba = typeof opts.ba === 'function' ? opts.ba(bp, bps.length - 1) : (opts.ba != null ? opts.ba : 0.85);
    const r = HF.engine.commit(rec, bp, null, resultFor(bp, ba), { now, sessionId: plan.id, derived: d, interrupted: opts.interrupt && opts.interrupt(bp, bps.length - 1) });
    rec = r.records; d = r.derived; events.push(...r.events.map(e => ({ ...e, slot: bps.length - 1 })));
    now += 90000;
  }
  const end = HF.engine.endSession(rec, plan.id, { now, endedBy: opts.endedBy });
  return { rec: end.records, plan, bps, events: events.concat(end.events.map(e => ({ ...e, end: true }))), derived: end.derived, now, session: end.session };
}

export default async function (t) {
  await t.test('derive: empty records give a usable state', () => {
    const rec = deepFreeze(HF.engine.newRecords(at(1)));
    const d = HF.engine.derive(rec, at(1));
    t.eq(Object.keys(d.tracks).length, 19);
    t.eq([d.tracks['nback.plain'].available, d.tracks['nback.transform'].available, d.tracks['rel.grid.T1'].available, d.tracks['rel.grid.T2'].available], [true, false, true, false]);
    t.eq([d.tracks['nback.plain'].level, d.tracks['nback.plain'].peak, d.sessionIndex, d.week.target], [0, -1, 1, 4]);
    t.eq(d.badges, {}); t.eq(d.mode.effective, 'varied'); t.eq(d.stretch.open, false); t.eq(d.study, null);
    for (const k of ['tracks', 'model', 'counters', 'pbs', 'week', 'badges', 'mastery', 'protocols', 'lab', 'sessionsCounted']) t.ok(k in d, k);
    t.eq(d.tracks['nback.plain'].zone, { last: [], U: 0.87, D: 0.73, target: 0.8 });
  });

  await t.test('derive + session: levels, peaks, gates, counters and badges come from the blocks', () => {
    let rec = HF.engine.newRecords(at(1));
    const out = drive(rec, at(1), { ba: 0.95 });
    const d = out.derived;
    t.ok(d.tracks['nback.plain'].level >= 4 && d.tracks['nback.plain'].peak === d.tracks['nback.plain'].level, 'placement climbed');
    t.eq(d.tracks['nback.transform'].available, true);
    t.ok(d.tracks['rel.grid.T2'].available, 'T1 reached step 6');
    t.eq([d.counters.sessions, d.counters.blocks, d.sessionsCounted], [1, 14, 1]);
    t.ok(d.counters.minutes > 5 && d.counters.trials > 200);
    t.ok(d.badges['nback-3'] > 0);
    t.eq(d.tracks['nback.plain'].introduced, true); t.eq(d.tracks['nback.transform'].introduced, false);
    t.ok(d.pbs['nback.plain'].peak >= 4);
    t.ok(out.rec.events.some(e => e.type === 'track-intro' && e.trackId === 'rel.grid.T1'));
    t.eq(d.tracks['nback.plain'].zone.last.length, 3);
  });

  await t.test('derive: self-correction offset after 10 settled rated blocks; overrides; placement flag', () => {
    const rec = HF.engine.newRecords(at(1));
    const mk = (i, ba, moved, before, after) => ({ id: 'b' + i, sessionId: 's', t: at(2, 10, i), trackId: 'rel.steps', set: 'numbers', role: 'rated', mode: 'varied', rung: before, levelBefore: before, levelAfter: after, moved, reason: moved < 0 ? 'down' : (moved > 0 ? 'up' : 'stay'), result: { ba, y: 2 * ba - 1 } });
    rec.blocks.push(mk(0, 0.6, -1, 5, 4));
    for (let i = 1; i <= 10; i++) rec.blocks.push(mk(i, 0.86, 0, 4, 4));
    let d = HF.engine.derive(rec, at(3));
    t.eq(d.tracks['rel.steps'].offsets.varied, -0.01);
    t.eq(d.tracks['rel.steps'].placing, false);
    t.eq(d.tracks['rel.steps'].level, 4);
    rec.events.push({ id: 'o1', t: at(2, 12), type: 'override', trackId: 'rel.steps', level: 9 });
    d = HF.engine.derive(rec, at(3));
    t.eq(d.tracks['rel.steps'].level, 9); t.eq(d.tracks['rel.steps'].peak, 5 - 1 >= 0 ? 4 : 4, 'override is not an earned peak');
  });

  await t.test('derive: study arm from events, Stretch opens after 6 counted sessions, Lab status', () => {
    let rec = HF.engine.newRecords(at(1));
    rec.events.push({ id: 'e1', t: at(1), type: 'study-enrol', template: 'cao' }, { id: 'e2', t: at(1, 11), type: 'study-draw', arm: 'cao-trad' });
    rec.labVisits.push({ id: 'v1', kind: 'B1', startedAt: at(1), endedAt: at(1, 11) }, { id: 'v2', kind: 'B2', startedAt: at(4), endedAt: at(4, 11) });
    let d = HF.engine.derive(rec, at(5));
    t.eq(d.study, { template: 'cao', arm: 'cao-trad', enrolledAt: at(1), drawnAt: at(1, 11), left: null });
    t.eq([d.lab.status.baselinesDone, d.lab.status.B2, d.badges.baselines], [true, at(4, 11), at(4, 11)]);
    rec = HF.engine.newRecords(at(1));
    rec.settings = { ...rec.settings, mode: 'stretch' };
    for (let k = 0; k < 6; k++) {
      t.eq(HF.engine.derive(rec, at(1 + k)).mode.effective, 'varied', 'locked before 6 sessions');
      rec = drive(rec, at(1 + k), { ba: 0.8, minutes: 10 }).rec;
    }
    const d2 = HF.engine.derive(rec, at(8));
    t.eq([d2.sessionsCounted, d2.stretch.open, d2.mode.effective], [6, true, 'stretch']);
  });

  await t.test('derive: never mutates its input; unsorted blocks give the same result; fast on 600 blocks', () => {
    let rec = HF.engine.newRecords(at(1));
    for (let k = 0; k < 40; k++) rec = drive(rec, at(1 + k), { ba: (bp, i) => 0.7 + 0.25 * ((i * 7) % 5) / 4, minutes: 25 }).rec;
    const frozen = deepFreeze(JSON.parse(JSON.stringify(rec)));
    const a = HF.engine.derive(frozen, at(45));
    const shuffled = { ...rec, blocks: rec.blocks.slice().reverse() };
    const b = HF.engine.derive(shuffled, at(45));
    t.eq(Object.fromEntries(Object.entries(a.tracks).map(([k, v]) => [k, v.level])), Object.fromEntries(Object.entries(b.tracks).map(([k, v]) => [k, v.level])));
    t.eq(a.badges, b.badges); t.eq(a.model.theta, b.model.theta);
    HF.engine.derive(rec, at(45)); HF.engine.derive(rec, at(45));          // warm up the JIT
    let ms = Infinity;
    for (let i = 0; i < 7; i++) { const t0 = performance.now(); HF.engine.derive(rec, at(45)); ms = Math.min(ms, performance.now() - t0); }
    t.ok(ms < 50, `derive on ${rec.blocks.length} blocks took ${ms.toFixed(1)} ms (best of 7)`);
  });
}
