// Engine: record size (Phase 4, CA-05) — HF.engine.compactRecords on simulated multi-year data must leave derive(),
// the Progress series and the History rows unchanged, never touch Study or Lab records, bump updatedAt once (so a
// merge keeps the compacted copy) and be idempotent. Also covers blocks stored before commit-time slimming.
import { HF, loadAllPure } from './load.mjs';
import { loadEngine, runLearner, population, DAY } from '../sim/lib.mjs';
loadEngine();
loadAllPure();

const isNum = (x) => typeof x === 'number' && isFinite(x);

/** A history of ~2 years: a real 45-day Varied run tiled in time (fresh ids) plus a sparse 200-day Mastery run. */
function history() {
  population('pop-compact');
  const base = runLearner(HF, { id: 'cv', modeId: 'varied', days: 45, learnerOpts: { pDay: 0.9, pSecond: 0.2 } }).records;
  const mast = runLearner(HF, { id: 'cm', modeId: 'mastery', days: 200, start: Date.UTC(2026, 0, 5) + 46 * DAY, learnerOpts: { pDay: 0.3, pSecond: 0 } }).records;
  const rec = { ...base, sessions: [], blocks: [], events: [], labVisits: [] };
  for (let k = 0; k < 14; k++) {
    const dt = k * 50 * DAY + (k >= 1 ? 200 * DAY : 0), sfx = '~' + k;
    rec.sessions.push(...base.sessions.map(s => ({ ...s, id: s.id + sfx, startedAt: s.startedAt + dt, endedAt: s.endedAt && s.endedAt + dt, dayKey: HF.goals.dayKey(s.startedAt + dt) })));
    rec.blocks.push(...base.blocks.map(b => ({ ...b, id: b.id + sfx, sessionId: b.sessionId + sfx, t: b.t + dt })));
    rec.events.push(...base.events.map(e => ({ ...e, id: e.id + sfx, t: e.t + dt })));
  }
  rec.sessions.push(...mast.sessions); rec.blocks.push(...mast.blocks); rec.events.push(...mast.events);
  // blocks stored before commit-time slimming: full precision, nulls, catalog rungParams, frame, endedAt
  rec.blocks = rec.blocks.map((b, i) => i % 3 ? b : {
    ...b, protocol: b.protocol || null, unitId: b.unitId || null, purpose: b.purpose || null, capRung: isNum(b.capRung) ? b.capRung : null, study: null,
    rungParams: b.rungParams || HF.catalog.params(b.trackId, b.rung), frame: { fps: 60, medianMs: 16.667, maxMs: 33.4, stalls: 0, lowPrecision: false },
    endedAt: b.t + 80000, lures: { main: 4 },
    result: { ...b.result, dprime: 1.2345678901234567, crit: -0.012345678901234, extra: { ...(b.result.extra || {}), leadInPresses: 0, scored: 20 } }
  });
  // a Study session (arm 'varied') and a Lab visit, both old: never touched
  const sb = rec.blocks.filter(b => b.sessionId === rec.sessions[3].id);
  rec.sessions[3] = { ...rec.sessions[3], study: { template: 'default', arm: 'varied' } };
  rec.blocks = rec.blocks.map(b => (b.sessionId === rec.sessions[5].id ? { ...b, study: 'varied' } : b));
  rec.labVisits = [{ id: 'v1', kind: 'B1', startedAt: rec.sessions[0].startedAt - DAY, endedAt: rec.sessions[0].startedAt - DAY + 3600000, tests: {} }];
  return { rec, studySessions: [rec.sessions[3].id, rec.sessions[5].id], nStudyBlocks: sb.length };
}

/** What Progress (js/ui/progress.js) reads: per session and track the last level, the mean BA of scored blocks
 *  and the Transform rule markers; and History's per-block row. */
function progressView(rec) {
  const C = HF.catalog, bad = (b) => !!(b.interrupted || (isNum(b.voidedRatio) && b.voidedRatio > 0.2));
  const training = (b) => b.role !== 'tutorial' && b.role !== 'probe' && !!C.get(b.trackId);
  const scored = (b) => training(b) && b.role !== 'warmup' && !bad(b) && !!b.result && isNum(b.result.ba);
  const blocks = rec.blocks.slice().sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const by = {};
  for (const b of blocks) (by[b.sessionId + '|' + b.trackId] ||= []).push(b);
  const series = Object.keys(by).sort().map((k) => {
    const bl = by[k], last = bl[bl.length - 1], sc = bl.filter(scored);
    return [k, isNum(last.levelAfter) ? last.levelAfter : last.rung, sc.length ? sc.reduce((s, b) => s + b.result.ba, 0) / sc.length : null,
      bl[0].trackId === 'nback.transform' ? bl.map(b => (b.rungParams && isNum(b.rungParams.step) ? b.rungParams.step : 1)).join(',') : ''];
  });
  const rows = blocks.map(b => [b.id, b.sessionId, b.t, b.trackId, b.rung, b.set, b.role, b.purpose || null, b.mode, b.protocol || null, b.unitId || null,
    b.levelBefore, b.levelAfter, b.moved, b.reason, b.result && b.result.ba, !!b.interrupted, b.voidedRatio, b.seed,
    JSON.stringify(b.rungParams || C.params(b.trackId, b.rung)), b.lureCount ?? null, b.lureMode || null, b.durationMs ?? null]);
  return JSON.stringify({ series, rows });
}

export default async function (t) {
  const E = HF.engine;
  const { rec, studySessions } = history();
  const last = Math.max(...rec.blocks.map(b => b.t)), now = last + DAY;

  await t.test(`compactRecords: ${rec.blocks.length} blocks over ${Math.round((last - Math.min(...rec.blocks.map(b => b.t))) / DAY)} days — derive, Progress and History unchanged (CA-05)`, () => {
    const before = JSON.stringify(rec).length;
    const out = E.compactRecords(rec, now);
    t.ok(out.compacted > 0.5 * rec.blocks.length, 'compacted ' + out.compacted);
    const after = JSON.stringify(out.records).length;
    t.eq(before - after, out.savedChars, 'savedChars is exact');
    const d0 = E.derive(rec, now), d1 = E.derive(out.records, now);
    for (const k of Object.keys(d0)) t.eq(JSON.stringify(d1[k]), JSON.stringify(d0[k]), 'derived.' + k);
    t.eq(progressView(out.records), progressView(rec), 'Progress series and History rows');
    // a plan made now is the same too (the planner reads the last Span blocks' timing, sets last used …)
    t.eq(JSON.stringify(E.plan(out.records, d1, { now, id: 'P' })), JSON.stringify(E.plan(rec, d0, { now, id: 'P' })), 'plan');
    const old = rec.blocks.filter(b => b.t < now - 90 * DAY), oldChars = old.reduce((s, b) => s + JSON.stringify(b).length, 0);
    t.ok(out.savedChars / oldChars > 0.3, `saved ${(100 * out.savedChars / oldChars).toFixed(0)} % of the old blocks (${(100 * (before - after) / before).toFixed(0)} % of the records)`);
  });

  await t.test('compactRecords: Study blocks, Lab visits, recent blocks, sessions and events untouched; idempotent; one updatedAt bump', () => {
    const out = E.compactRecords(rec, now);
    const byId = new Map(rec.blocks.map(b => [b.id, b]));
    for (const b of out.records.blocks) {
      const o = byId.get(b.id);
      if (studySessions.includes(o.sessionId) || o.study) t.ok(b === o, 'study block untouched ' + b.id);
      if (o.t >= now - 90 * DAY) t.ok(b === o, 'recent block untouched');
      if (b !== o) { t.eq([b.compacted, b.updatedAt], [true, now]); }
    }
    t.ok(out.records.labVisits === rec.labVisits && out.records.sessions === rec.sessions && out.records.events === rec.events);
    const again = E.compactRecords(out.records, now + DAY);
    t.eq([again.compacted, again.savedChars], [0, 0]);
    t.ok(again.records === out.records, 'nothing changed → the same records object');
    const later = E.compactRecords(out.records, now + 30 * DAY);
    t.ok(later.records.blocks.every(b => !b.compacted || b.updatedAt === now || b.updatedAt === now + 30 * DAY), 'compacted blocks keep their first updatedAt');
    t.ok(later.records.blocks.filter(b => b.updatedAt === now).length === out.compacted, 'no second bump');
    // a merge with another tab's full copy keeps the compacted blocks (HF.schema.merge: newer updatedAt wins)
    if (HF.schema && HF.schema.merge) {
      const m = HF.schema.merge(rec, out.records);
      const mm = new Map(m.blocks.map(b => [b.id, b]));
      t.ok(out.records.blocks.filter(b => b.compacted).every(b => mm.get(b.id).compacted), 'merge keeps compacted copies');
      const m2 = HF.schema.merge(out.records, rec);
      t.ok(m2.blocks.filter(b => b.compacted).length === out.compacted, 'in either order');
    }
    t.ok(!Object.isFrozen(rec) && rec.blocks.every(b => !b.compacted), 'input never mutated');
  });

  await t.test('compactRecords: force + targetChars also shrinks younger blocks, never the last keepDays days or an open session', () => {
    const open = { ...rec.sessions[rec.sessions.length - 1] };
    const r2 = { ...rec, sessions: rec.sessions.slice(0, -1).concat([{ ...open, endedAt: null }]) };
    const size = JSON.stringify(r2).length;
    const soft = E.compactRecords(r2, now, { targetChars: 1000 });
    const hard = E.compactRecords(r2, now, { force: true, targetChars: Math.round(size * 0.55) });
    t.ok(hard.compacted > soft.compacted, `force compacts more (${soft.compacted} → ${hard.compacted})`);
    const studyS = new Set(r2.sessions.filter(s => s.study).map(s => s.id));
    const left = hard.records.blocks.filter(b => !b.compacted && b.t < now - 7 * DAY && !b.study && !studyS.has(b.sessionId) && b.sessionId !== open.id);
    t.ok(JSON.stringify(hard.records).length <= size * 0.55 || left.length === 0, 'reaches the target, or compacts everything it may (' + left.length + ' left)');
    t.ok(hard.records.blocks.every(b => !b.compacted || (b.t < now - 7 * DAY && b.sessionId !== open.id)), 'last 7 days and the open session kept');
    t.eq(JSON.stringify(E.derive(hard.records, now)), JSON.stringify(E.derive(r2, now)), 'derive unchanged');
    t.eq(progressView(hard.records), progressView(r2), 'Progress unchanged');
  });
}
