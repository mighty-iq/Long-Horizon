// Engine × generators: approximate responders (SPEC §4.6) must not climb through self-correction (CA-02) and must not
// pass Mastery units (Phase 4 lead finding). Uses the real n-back generator and scorer, planner, commit and derive.
import { HF, loadAllPure } from './load.mjs';
loadAllPure();

const DAY = 86400000;
const key = (it) => JSON.stringify(it);
/** Familiarity responder: presses when the item appeared in the last n + 1 items (SPEC §4.6). */
function familiarityLog(spec) {
  const n = spec.params.n, xs = spec.trials.map((t) => key(t.stim.main)), responses = [];
  for (let t = n; t < xs.length; t++) {
    let seen = false;
    for (let k = 1; k <= n + 1 && t - k >= 0; k++) if (xs[t - k] === xs[t]) seen = true;
    if (seen) responses.push({ key: 'match', trial: t, t: t * spec.soaMs + 600 });
  }
  return { responses, voided: [], paused: false };
}
const lapseLog = () => ({ responses: [], voided: [], paused: false });
/** Equal Steps "±1 responder": presses when the step is within ±1 of the comparison step (SPEC §4.6). */
function withinOneLog(spec) {
  const xs = spec.trials.map((tr) => tr.stim.main.number), b = spec.params.back, responses = [];
  for (const tr of spec.trials) {
    if (!tr.scorable) continue;
    const t = tr.i;
    if (Math.abs(Math.abs(xs[t] - xs[t - b]) - Math.abs(xs[t - 1] - xs[t - 1 - b])) <= 1) responses.push({ key: 'match', trial: t, t: t * spec.soaMs + 600 });
  }
  return { responses, voided: [], paused: false };
}

/** Rated Plain n-back blocks played by the familiarity responder for `days` × 7, with one lapse (BA .5) at block 12. */
function climb(modeId, days) {
  const E = HF.engine, C = HF.catalog, NB = HF.tasks.nback;
  let now = new Date(2026, 9, 1, 9).getTime(), r = E.newRecords(now), maxRung = 0, minOffset = 0, n = 0;
  r.settings = { ...r.settings, mode: modeId };
  for (let day = 0; day < days; day++) {
    for (let k = 0; k < 7; k++) {
      n++; now += 4 * 60000;
      const d = E.derive(r, now), tr = d.tracks['nback.plain'];
      const allowed = C.allowedRungs('nback.plain', modeId), rung = allowed.find((x) => x >= tr.level) ?? allowed[allowed.length - 1];
      const lures = modeId === 'stretch' ? 6 : 4;
      const bp = { slotId: 'k' + k, sessionId: 'S' + day, trackId: 'nback.plain', taskId: 'nback', role: 'rated', modeId, rung,
        params: C.params('nback.plain', rung), set: 'grid8', seed: `fam${day}:${k}`, lureCount: lures, lureMode: 'controlled' };
      const spec = NB.gen({ trackId: bp.trackId, rung, params: bp.params, set: 'grid8', seed: bp.seed, lureCount: lures });
      const res = NB.score(spec, n === 12 ? lapseLog(spec) : familiarityLog(spec));
      r = E.commit(r, bp, spec, res, { now: now + 70000, t: now, sessionId: bp.sessionId, derived: d }).records;
      const after = E.derive(r, now + 70000).tracks['nback.plain'];
      maxRung = Math.max(maxRung, after.level);
      minOffset = Math.min(minOffset, after.offsets[modeId] || 0);
    }
    now += DAY - 7 * 4 * 60000;
  }
  return { maxRung, minOffset };
}

export default async function (t) {
  if (!HF.tasks || !HF.tasks.nback || !HF.tasks.nback.gen) { await t.test('shortcuts: generators not loaded — skipped', () => {}); return; }

  await t.test('familiarity responder (BA .857 at 2-back) never climbs past 2-back in Varied (CA-02)', () => {
    const v = climb('varied', 12);
    t.ok(v.maxRung <= 3, `reached rung ${v.maxRung} (${HF.catalog.levelLabel('nback.plain', v.maxRung)})`);
    t.ok(v.minOffset >= -0.01 - 1e-12, 'offset ' + v.minOffset);
  });

  await t.test('familiarity responder (BA .786 with 6 lures) never climbs past 2-back in Stretch (CA-02)', () => {
    const s = climb('stretch', 12);
    t.ok(s.maxRung <= 3, `reached rung ${s.maxRung}`);
  });

  await t.test('familiarity responder never passes a Mastery n-back unit (unit bar .87 > .857)', () => {
    const E = HF.engine, NB = HF.tasks.nback;
    let now = new Date(2026, 9, 1, 9).getTime(), r = E.newRecords(now);
    r.settings = { ...r.settings, mode: 'mastery', balance: { nback: 100, relations: 0, span: 0 } };
    r.events.push({ id: 'tut', t: now, type: 'lesson-passed', lessonId: 'lesson.nback' });
    for (let day = 0; day < 8; day++) {
      let d = E.derive(r, now);
      const plan = E.plan(r, d, { now, id: 'M' + day });
      r = E.beginSession(r, plan, { now }).records;
      for (const slot of plan.slots) {
        d = E.derive(r, now);
        const bp = E.prepare(slot, r, d, { sessionId: plan.id });
        const spec = NB.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode });
        r = E.commit(r, bp, spec, NB.score(spec, familiarityLog(spec)), { now: now + 70000, t: now, sessionId: plan.id, derived: d }).records;
        now += 90000;
      }
      r = E.endSession(r, plan.id, { now }).records;
      now += DAY;
    }
    const ms = E.derive(r, now).mastery.units.u01;
    t.eq(ms.status, 'open', 'u01 (Plain 2-back) stays open');
    t.ok(ms.qualifying.every((q) => !q), 'no qualifying block at .857');
  });

  await t.test('Equal Steps ±1 responder never climbs in Stretch: the planner asks for 6 near misses (BA .786 < U .79)', () => {
    if (!HF.tasks.relations || !HF.tasks.relations.gen) { t.ok(true, 'relations not loaded'); return; }
    const E = HF.engine, R = HF.tasks.relations;
    for (const modeId of ['stretch', 'varied']) {
      let now = new Date(2026, 9, 1, 9).getTime(), r = E.newRecords(now), n = 0, bas = [];
      r.settings = { ...r.settings, mode: modeId };
      r.events.push({ id: 'ls', t: now, type: 'lesson-passed', lessonId: 'lesson.steps' });
      for (let day = 0; day < 12; day++) {
        for (let k = 0; k < 7; k++) {
          n++; now += 4 * 60000;
          const d = E.derive(r, now);
          const slot = { slotId: 'k' + k, index: k, trackId: 'rel.steps', role: 'rated', taskId: 'relations', set: 'numbers', modeId, sessionIndex: 10, phase: 'random', glyphs: 'glyphsA' };
          const bp = E.prepare(slot, r, d, { sessionId: 'S' + day });
          if (n === 1) t.eq(bp.lureCount, modeId === 'stretch' ? 6 : 4, modeId + ': near misses asked for');
          const spec = R.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount });
          const res = R.score(spec, n === 12 ? lapseLog(spec) : withinOneLog(spec));
          if (n !== 12) bas.push(res.ba);
          r = E.commit(r, bp, spec, res, { now: now + 70000, t: now, sessionId: bp.sessionId, derived: d }).records;
        }
        now += DAY - 7 * 4 * 60000;
      }
      const ups = r.blocks.filter((b) => b.moved > 0).length, off = E.derive(r, now).tracks['rel.steps'].offsets[modeId] || 0;
      t.near(bas.reduce((a, x) => a + x, 0) / bas.length, modeId === 'stretch' ? (1 + 8 / 14) / 2 : (1 + 10 / 14) / 2, 1e-9, modeId + ' responder BA');
      t.eq(ups, 0, `${modeId}: no up move in ${r.blocks.length} blocks (offset ${off})`);
    }
  });
}
