// Engine: commit / beginSession / endSession — records, events, immutability; and a contract check with the real
// generators and scorers when they are loaded (gen(prepare(slot)) → score → commit).
import { HF, loadAllPure } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
import { drive, resultFor } from './engine-derive.test.mjs';
loadEngine();

const at = (d, h = 10, m = 0) => new Date(2026, 0, d, h, m).getTime();
const fresh = (settings) => { const r = HF.engine.newRecords(at(1)); r.settings = { ...r.settings, ...(settings || {}) }; r.events.push({ id: 'tut', t: at(1, 9), type: 'lesson-passed', lessonId: 'lesson.nback' }); return r; };
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

export default async function (t) {
  await t.test('commit: BlockRecord has the SPEC §3.3 fields; input records are never mutated', () => {
    const rec = deepFreeze(fresh());
    const d = HF.engine.derive(rec, at(1));
    const plan = HF.engine.plan(rec, d, { now: at(1), id: 'S1' });
    const b1 = HF.engine.beginSession(rec, plan, { now: at(1) });
    t.eq(b1.session.planned, 14); t.eq(b1.session.dayKey, HF.goals.dayKey(at(1)));
    t.eq(HF.engine.beginSession(b1.records, plan, { now: at(1) }).records, b1.records, 'idempotent');
    const r0 = deepFreeze(b1.records);
    const bp = HF.engine.prepare(plan.slots[1], r0, HF.engine.derive(r0, at(1)), { sessionId: 'S1' });
    const c = HF.engine.commit(r0, bp, { meta: {} }, resultFor(bp, 0.95), { now: at(1, 10, 2), sessionId: 'S1', frame: { fps: 60 } });
    // Phase 4 (CA-05): null fields are left out (absent = null) and rungParams equal to the catalog's are left out
    for (const k of ['id', 'sessionId', 't', 'trackId', 'set', 'role', 'mode', 'seed', 'rung', 'levelBefore', 'levelAfter', 'moved', 'reason', 'result', 'interrupted', 'voidedRatio', 'frame'])
      t.ok(k in c.block, 'block.' + k);
    for (const k of ['protocol', 'unitId', 'purpose', 'capRung', 'study']) t.ok(!(k in c.block), 'null block.' + k + ' left out');
    t.ok(!('rungParams' in c.block) && HF.engine.derive(c.records, at(1, 10, 3)).tracks[bp.trackId].blocks === 1, 'catalog rungParams left out');
    for (const k of ['ba', 'baMean', 'y', 'dprime', 'crit', 'streams', 'extra']) t.ok(k in c.block.result, 'result.' + k);
    for (const k of ['ba', 'baMean', 'y', 'dprime', 'crit']) t.ok(Math.abs(c.block.result[k] * 1e4 - Math.round(c.block.result[k] * 1e4)) < 1e-6, 'result.' + k + ' has ≤ 4 decimals');
    t.eq(Object.keys(c.block.result.streams.main).sort(), ['cr', 'fa', 'h', 'lfa', 'lt', 'm', 'rt']);
    t.eq(c.records.blocks.length, 1); t.eq(r0.blocks.length, 0);
    t.eq(c.records.sessions[0].completed, 1);
    t.ok(c.events.some(e => e.type === 'level-up'));
  });

  await t.test('commit: events — level changes, personal best, track-available, tier-open, fatigue once', () => {
    const out = drive(fresh(), at(1), { ba: (bp, i) => i < 7 ? 0.95 : 0.95 });
    const types = out.events.map(e => e.type);
    t.ok(types.includes('level-up') && types.includes('pb') && types.includes('track-available') && types.includes('tier-open'), types.join(','));
    t.ok(out.events.filter(e => e.type === 'track-available').map(e => e.trackId).sort().join() === 'nback.arith,nback.switch,nback.transform');
    t.eq(out.events.filter(e => e.type === 'tier-open')[0].trackId, 'rel.grid.T2');
    // fatigue: first two rated ≈ .95, then two at ≤ .80
    const f = drive(fresh(), at(1), { ba: (bp, i) => (bp.role !== 'rated' ? 0.9 : (i <= 2 ? 0.95 : 0.7)) });
    t.eq(f.events.filter(e => e.type === 'fatigue').length, 1);
    const fz = f.events.find(e => e.type === 'fatigue');
    t.ok(fz.slot >= 4, 'after two rated blocks past the first two');
  });

  await t.test('commit: interrupted or > 20 % voided blocks move nothing and do not update the model', () => {
    const rec = fresh();
    const d = HF.engine.derive(rec, at(1));
    const plan = HF.engine.plan(rec, d, { now: at(1), id: 'S1' });
    let r = HF.engine.beginSession(rec, plan, { now: at(1) }).records;
    const bp = HF.engine.prepare(plan.slots[1], r, HF.engine.derive(r, at(1)), { sessionId: 'S1' });
    const c1 = HF.engine.commit(r, bp, null, resultFor(bp, 1), { now: at(1), sessionId: 'S1', interrupted: true });
    t.eq([c1.block.moved, c1.block.reason, c1.derived.modelBlocks], [0, 'interrupted', 0]);
    const vr = { ...resultFor(bp, 1), voidedRatio: 0.3 };
    const c2 = HF.engine.commit(r, bp, null, vr, { now: at(1), sessionId: 'S1' });
    t.eq([c2.block.reason, c2.block.result.voidedRatio, HF.controller.blockBad(c2.block)], ['interrupted', 0.3, true]);
  });

  await t.test('endSession: counted once a day, week goal event, levels revealed at the end in Stretch', () => {
    let rec = fresh();
    let out = drive(rec, at(5, 9));
    t.eq([out.session.counted, out.session.endedBy], [true, 'done']);
    t.ok(out.events.some(e => e.type === 'session-counted' && e.counted));
    out = drive(out.rec, at(5, 18));
    t.eq(out.session.counted, false);
    t.eq(out.events.find(e => e.type === 'session-counted').reason, 'day-limit');
    rec = fresh({ weeklyTarget: 3 });
    let weekEv = null;
    for (const day of [5, 6, 7]) { const o = drive(rec, at(day), { minutes: 10 }); rec = o.rec; weekEv = weekEv || o.events.find(e => e.type === 'week-goal'); }
    t.eq(weekEv && [weekEv.count, weekEv.target], [3, 3]);
    let s = fresh({ mode: 'stretch' });
    for (let k = 0; k < 6; k++) s = drive(s, at(5 + k), { minutes: 10 }).rec;
    const so = drive(s, at(12), { ba: 0.9 });
    t.eq(so.plan.modeId, 'stretch');
    t.ok(so.events.filter(e => e.type === 'level-up').every(e => e.reveal === 'session-end'));
    t.ok(so.events.some(e => e.type === 'levels-revealed' && e.changes.length > 0));
  });

  await t.test('endSession: partial sessions; quitting early keeps the blocks and counts at half', () => {
    let o = drive(fresh(), at(5), { n: 6 });
    t.eq([o.session.endedBy, o.session.completed, o.session.counted], ['quit', 6, false]);
    o = drive(fresh(), at(5), { n: 7 });
    t.eq(o.session.counted, true);
    o = drive(fresh(), at(5), { n: 3, endedBy: 'fatigue' });
    t.eq(o.session.counted, true);
  });

  await t.test('assist: after two failed checks, Plain rated blocks are assisted until two reach the criterion', () => {
    const rec = fresh();
    rec.events = rec.events.filter(e => e.type !== 'lesson-passed').concat([
      { id: 'f1', t: at(1, 9), type: 'lesson-failed', lessonId: 'lesson.nback' }, { id: 'f2', t: at(1, 9, 5), type: 'lesson-failed', lessonId: 'lesson.nback' },
      { id: 'a1', t: at(1, 9, 6), type: 'assist-start', trackId: 'nback.plain' }]);
    const d = HF.engine.derive(rec, at(1));
    t.eq([d.assist.active, d.assist.trackId], [true, 'nback.plain']);
    const o = drive(rec, at(1), { ba: 0.9 });
    const assisted = o.bps.filter(b => b.role === 'assist');
    t.ok(assisted.length >= 2 && assisted.every(b => b.rung === 2 && b.assist), 'assisted 2-back blocks');
    t.ok(o.events.some(e => e.type === 'assist-faded'));
    t.eq(o.derived.assist.active, false);
    const firstRated = o.bps.findIndex(b => b.trackId === 'nback.plain' && b.role === 'rated');
    t.ok(firstRated > o.bps.findIndex(b => b.role === 'assist'), 'normal blocks after the aid fades');
    t.eq(o.derived.tracks['nback.plain'].ratedBlocks, o.bps.filter(b => b.trackId === 'nback.plain' && b.role === 'rated').length, 'assisted blocks stay out of levels');
  });

  await t.test('assist per track: Plain and Grid T1 assisted at once, each fading after its own 2 blocks at criterion', () => {
    const rec = fresh();
    rec.events = rec.events.filter(e => e.type !== 'lesson-passed').concat([
      { id: 'a1', t: at(1, 9, 6), type: 'assist-start', trackId: 'nback.plain' },
      { id: 'a2', t: at(1, 9, 7), type: 'assist-start', trackId: 'rel.grid.T1' }]);
    const d = HF.engine.derive(rec, at(1));
    t.eq(Object.keys(d.assist.tracks).sort(), ['nback.plain', 'rel.grid.T1']);
    t.ok(d.assist.active && d.assist.tracks['rel.grid.T1'].active);
    // Plain reaches the criterion, the Grid does not (6 of 10 targets)
    const o = drive(rec, at(1), { ba: (bp) => bp.trackId === 'nback.plain' ? 0.9 : 0.6 });
    t.ok(o.bps.some(b => b.trackId === 'rel.grid.T1' && b.role === 'assist') && o.bps.some(b => b.trackId === 'nback.plain' && b.role === 'assist'));
    const faded = o.events.filter(e => e.type === 'assist-faded').map(e => e.trackId);
    t.eq(faded, ['nback.plain']);
    t.eq([o.derived.assist.tracks['nback.plain'].active, o.derived.assist.tracks['rel.grid.T1'].active], [false, true]);
    t.ok(o.bps.filter(b => b.trackId === 'rel.grid.T1' && b.role !== 'warmup').every(b => b.role === 'assist'), 'Grid stays assisted');
    t.eq(o.derived.tracks['rel.grid.T1'].ratedBlocks, 0);
    // next session: Grid still assisted, Plain normal
    const o2 = drive(o.rec, at(2), { ba: 0.9 });
    t.ok(o2.bps.filter(b => b.trackId === 'nback.plain' && b.role !== 'warmup').every(b => b.role === 'rated'));
    t.eq(o2.events.filter(e => e.type === 'assist-faded').map(e => e.trackId), ['rel.grid.T1']);
    // a late assist-start (sound of a lesson replay) for the same track does not restart it
    const rec3 = { ...o2.rec, events: o2.rec.events.concat([{ id: 'a3', t: at(3), type: 'assist-start', trackId: 'nback.plain' }]) };
    t.eq(HF.engine.derive(rec3, at(3)).assist.tracks['nback.plain'].active, false);
  });

  await t.test('assist: the pass bar follows the track — a Grid block with a voided target still needs 7 hits (CA-09)', () => {
    t.eq(['nback.plain', 'nback.transform', 'rel.steps', 'rel.grid.T1', 'rel.grid.T5'].map(HF.derive.assistBar), [4, 4, 4, 7, 7]);
    const rec = fresh();
    rec.events = rec.events.filter(e => e.type !== 'lesson-passed').concat([{ id: 'a2', t: at(1, 9, 7), type: 'assist-start', trackId: 'rel.grid.T1' }]);
    // two assisted Grid blocks with 9 scorable targets (one voided): 5 hits, no false presses — below 7 of 10
    const grid = (i, h) => ({ id: 'g' + i, sessionId: 'G', slotId: 'k' + i, t: at(1, 10, i), trackId: 'rel.grid.T1', set: 'dots', role: 'assist', mode: 'varied', rung: 0,
      levelBefore: 0, levelAfter: 0, moved: 0, reason: 'assist', interrupted: false, voidedRatio: 0.05,
      result: { ba: 0.75, y: 0.5, n: 19, streams: { main: { h, m: 9 - h, fa: 0, cr: 10 } } } });
    let d = HF.engine.derive({ ...rec, blocks: [grid(1, 5), grid(2, 5)] }, at(1, 11));
    t.eq(d.assist.tracks['rel.grid.T1'].active, true, '5 of 9 does not fade the Grid aid');
    d = HF.engine.derive({ ...rec, blocks: [grid(1, 7), grid(2, 8)] }, at(1, 11));
    t.eq(d.assist.tracks['rel.grid.T1'].active, false, '7 and 8 hits do');
  });

  await t.test('endSession: minutes come from block durations plus short gaps, not wall time; opts.minutes wins', () => {
    const rec = fresh();
    const T0 = at(5, 9);
    const plan = HF.engine.plan(rec, HF.engine.derive(rec, T0), { now: T0, id: 'M1' });
    let r = HF.engine.beginSession(rec, plan, { now: T0 }).records;
    // three blocks of 70 s with 20 s debriefs, then the session is resumed 3 h later for a fourth block
    const starts = [T0 + 30e3, T0 + 120e3, T0 + 210e3, T0 + 3 * 3600e3];
    starts.forEach((st, i) => {
      const bp = HF.engine.prepare(plan.slots[i], r, HF.engine.derive(r, st), { sessionId: 'M1' });
      r = HF.engine.commit(r, bp, null, resultFor(bp, 0.85), { now: st + 70e3, t: st, sessionId: 'M1' }).records;
    });
    t.eq(r.blocks.map(b => b.durationMs), [70e3, 70e3, 70e3, 70e3]);
    const end = HF.engine.endSession(r, 'M1', { now: starts[3] + 70e3 + 30e3, endedBy: 'quit' });
    // 30 s lead-in + 4 × 70 s + 20 s + 20 s + 120 s (the 3 h break, capped) + 30 s closing = 500 s
    t.eq(end.session.minutes, Math.round(500e3 / 6000) / 10);
    t.ok(end.session.minutes < 10, 'not the 3 h of wall time');
    t.eq(HF.engine.endSession(r, 'M1', { now: starts[3] + 100e3, minutes: 12.34 }).session.minutes, 12.3);
    // blocks without a measured start fall back to their nominal length
    const o = drive(fresh(), at(6), { n: 2 });
    const nominal = o.rec.blocks.reduce((s, b) => s + HF.catalog.estBlockMs(b.trackId, b.rungParams), 0);
    t.ok(o.session.minutes >= nominal / 60000 && o.session.minutes <= nominal / 60000 + 6.5, 'nominal + capped gaps: ' + o.session.minutes);
  });

  await t.test('commit: the record stores the lures the spec actually has; the model uses the plan setting', () => {
    const rec = fresh();
    const plan = HF.engine.plan(rec, HF.engine.derive(rec, at(1)), { now: at(1), id: 'L1' });
    const r = HF.engine.beginSession(rec, plan, { now: at(1) }).records, d = HF.engine.derive(r, at(1));
    const bp = HF.engine.prepare(plan.slots[1], r, d, { sessionId: 'L1' });
    t.eq([bp.params.n, bp.lureCount], [1, 4], 'the plan asks for 4 position lures at 1-back');
    const c0 = HF.engine.commit(r, bp, { meta: { lureCount: 0, lures: { main: 0 } } }, resultFor(bp, 0.9), { now: at(1), sessionId: 'L1', derived: d });
    t.eq([c0.block.lureCount, c0.block.lurePlan, c0.block.lures], [0, 4, { main: 0 }]);
    const c1 = HF.engine.commit(r, bp, { meta: { lures: { pos: 3, snd: 5 } } }, resultFor(bp, 0.9), { now: at(1), sessionId: 'L1', derived: d });
    t.eq([c1.block.lureCount, c1.block.lures], [4, { pos: 3, snd: 5 }]);
    t.eq(HF.engine.commit(r, bp, null, resultFor(bp, 0.9), { now: at(1), sessionId: 'L1', derived: d }).block.lureCount, 4, 'no spec: the plan value');
    // the model's difficulty follows the plan's setting, so Transform's 6 lures (4 position + 2 identity) are not "6 lures"
    const blk = (extra) => ({ trackId: 'nback.transform', set: 'days', role: 'rated', rung: 2, t: 0, rungParams: { n: 2, onMs: 500, soaMs: 3000, step: 1 }, result: { ba: 0.8, y: 0.6 }, lureMode: 'controlled', ...extra });
    const a = HF.learner.update(HF.learner.create(), blk({ lureCount: 6, lurePlan: 4 })), b = HF.learner.update(HF.learner.create(), blk({ lureCount: 4 }));
    t.near(a.pred, b.pred, 1e-12);
  });

  await t.test('Wang: the level moves only after the day\'s 5th valid block; day accuracy at the end', () => {
    let rec = fresh({ mode: 'protocols' });
    let o = drive(rec, at(5), { protocolIds: ['wang'], ba: 0.95, n: 3 });
    t.ok(o.bps.every(b => b.rung === 0)); t.eq(o.derived.protocols.wang.level, 0);
    o = drive(o.rec, at(5, 15), { protocolIds: ['wang'], ba: 0.95 });
    t.eq(o.plan.slots.length, 2, 'the rest of the day\'s 5');
    t.eq(o.derived.protocols.wang.level, 1);
    const wd = o.events.find(e => e.type === 'wang-day');
    t.ok(wd && wd.acc > 0.8 && wd.levelBefore === 0 && wd.levelAfter === 1);
    t.eq(drive(o.rec, at(5, 18), { protocolIds: ['wang'] }).plan.slots.length, 0, 'done for today');
    o = drive(o.rec, at(6), { protocolIds: ['wang'], ba: 0.95 });
    t.ok(o.bps.every(b => b.rung === 2), 'next day at L1');
  });

  await t.test('contract: real generators and scorers accept every BlockPlan (when loaded)', () => {
    try { loadAllPure(); } catch (e) { /* other modules not ready */ }
    const T = HF.tasks;
    if (!T || !T.nback || !T.nback.gen || !T.relations || !T.relations.gen) { t.ok(true, 'generators not loaded — skipped'); return; }
    const taskApi = { nback: T.nback, relations: T.relations, span: T.span, vsearch: T.vsearch };
    const rec = fresh({ spanOn: true });
    rec.events.push({ id: 'st', t: at(1), type: 'lesson-passed', lessonId: 'lesson.arith' });
    const d = HF.engine.derive(rec, at(1));
    const problems = [];
    for (const id of HF.catalog.ids()) {
      const api = taskApi[HF.catalog.get(id).task];
      if (!api || !api.gen || !api.score) continue;
      for (const [modeId, rung] of [['varied', 0], ['varied', 3], ['stretch', 5], ['free', HF.catalog.maxRung(id)]]) {
        const slot = { slotId: 'k' + rung, index: 0, trackId: id, role: modeId === 'free' ? 'free' : 'rated', modeId, sessionIndex: 9, phase: 'random', glyphs: 'glyphsC', rung };
        const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'C' });
        if (modeId !== 'free') bp.rung = Math.min(rung, HF.catalog.maxRung(id)), bp.params = { ...HF.catalog.params(id, bp.rung), step: bp.params.step };
        let spec, result;
        try {
          spec = api.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode, protocol: bp.protocol, targets: bp.targets == null ? undefined : bp.targets });
          const log = spec.kind === 'stream' ? { responses: [], voided: [], paused: false }
            : spec.kind === 'span' ? { trials: spec.trials.map(tr => ({ i: tr.i, proc: tr.pairs.map(() => ({ resp: null, rt: null })), recall: [], voided: false })), paused: false }
            : { answers: spec.trials.map(tr => ({ i: tr.i, response: null, rt: null, voided: false })), paused: false };
          result = api.score(spec, log);
          const c = HF.engine.commit(rec, bp, spec, result, { now: at(1), sessionId: 'C', derived: d });
          if (!(typeof c.block.result.ba === 'number')) problems.push(id + ': no ba');
        } catch (e) { problems.push(`${id} ${modeId} r${bp.rung} set ${bp.set}: ${e.message}`); }
        if (spec && spec.trackId && spec.trackId !== id) problems.push(id + ': spec.trackId ' + spec.trackId);
      }
    }
    // Protocol plans too
    for (const pid of ['cao', 'wang', 'jaeggi']) {
      const p = HF.engine.plan(rec, d, { now: at(1), id: 'PP', modeId: 'protocols', protocolIds: [pid] });
      const bp = HF.engine.prepare(p.slots[0], rec, d, { sessionId: 'PP' });
      const api = taskApi[HF.catalog.get(bp.trackId).task];
      try {
        const spec = api.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode, protocol: bp.protocol, targets: bp.targets == null ? undefined : bp.targets });
        const res = api.score(spec, { responses: [], voided: [], paused: false });
        HF.engine.commit(rec, bp, spec, res, { now: at(1), sessionId: 'PP', derived: d });
        if (pid === 'wang') {
          const nT = spec.trials.filter(tr => tr.scorable && tr.target.main).length;
          if (nT !== 10) problems.push('wang: ' + nT + ' targets per block (expected 10)');
        }
      } catch (e) { problems.push(pid + ': ' + e.message); }
    }
    for (const [id, rung, want] of [['nback.plain', 0, 0], ['nback.plain', 2, 4], ['nback.transform', 2, 6]]) {
      const slot = { slotId: 'lc' + id + rung, index: 0, trackId: id, role: 'free', modeId: 'free', sessionIndex: 9, phase: 'free', glyphs: 'glyphsC', rung };
      const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'LC' });
      const spec = T.nback.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode });
      const c = HF.engine.commit(rec, bp, spec, T.nback.score(spec, { responses: [], voided: [], paused: false }), { now: at(1), sessionId: 'LC', derived: d });
      if (c.block.lureCount !== want || c.block.lurePlan !== 4) problems.push(`${id} r${rung}: stored lureCount ${c.block.lureCount} (plan ${c.block.lurePlan}), expected ${want}`);
    }
    const top = HF.catalog.maxRung('vs.search'), vs = T.vsearch && T.vsearch.gen ? T.vsearch.gen({ trackId: 'vs.search', rung: top, params: HF.catalog.params('vs.search', top), set: 'tl', seed: 'c' }) : null;
    if (vs && !(vs.params && vs.params.size === 64)) problems.push('vs.search top step is not 64 items');
    t.eq(problems, []);
  });

  await t.test('session.completed = finished slots: interrupted attempts do not count (CB-02)', () => {
    let rec = fresh();
    const plan = HF.engine.plan(rec, HF.engine.derive(rec, at(2)), { now: at(2), id: 'C2' });
    rec = HF.engine.beginSession(rec, plan, { now: at(2) }).records;
    let now = at(2), d = HF.engine.derive(rec, now);
    const play = (slot, interrupted) => {
      const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'C2' });
      const c = HF.engine.commit(rec, bp, null, resultFor(bp, 0.85), { now, sessionId: 'C2', derived: d, interrupted });
      rec = c.records; d = c.derived; now += 90000;
      return c;
    };
    for (let i = 0; i < 6; i++) {
      if (i === 2 || i === 4) t.eq(play(plan.slots[i], true).records.sessions[0].completed, i, 'an interrupted attempt adds nothing');
      play(plan.slots[i], false);
    }
    t.eq([rec.blocks.length, rec.sessions[0].completed, HF.engine.finishedSlots(rec.blocks)], [8, 6, 6]);
    t.eq(rec.blocks.filter(b => b.slotId === 'k2').map(b => b.attempt), [0, 1], 'the retry is attempt 1 of the same slot');
    const end = HF.engine.endSession(rec, 'C2', { now });
    t.eq([end.session.completed, end.session.endedBy, end.session.counted], [6, 'quit', false], '6 of 14 finished < half → not counted (8 blocks would have been)');
    t.eq(end.derived.countedWhy.C2, 'not-qualified');
  });

  await t.test('beginSession stores the plan; resumePlan gives it back for prepare(); endSession removes it (CB-14)', () => {
    let rec = fresh({ spanOn: true });
    rec = drive(rec, at(1), { ba: 0.9 }).rec;
    const d0 = HF.engine.derive(rec, at(2));
    const plan = HF.engine.plan(rec, d0, { now: at(2), id: 'R2' });
    rec = HF.engine.beginSession(rec, plan, { now: at(2) }).records;
    const s = rec.sessions.find(x => x.id === 'R2');
    t.ok(s.plan && s.plan.slots.length === plan.slots.length, 'session.plan stored');
    t.ok(JSON.stringify(s.plan).length < 120 * plan.slots.length + 1500, 'compact: ' + JSON.stringify(s.plan).length + ' chars');
    let d = HF.engine.derive(rec, at(2));
    for (let i = 0; i < 3; i++) {
      const bp = HF.engine.prepare(plan.slots[i], rec, d, { sessionId: 'R2' });
      const c = HF.engine.commit(rec, bp, null, resultFor(bp, 0.9), { now: at(2, 10, 2 * i + 1), sessionId: 'R2', derived: d, interrupted: i === 2 });
      rec = c.records; d = c.derived;
    }
    // settings changed meanwhile: a re-plan would differ, the stored plan does not
    rec = { ...rec, settings: { ...rec.settings, sessionMinutes: 10, balance: { nback: 80, relations: 20, span: 0 } } };
    const rp = HF.engine.resumePlan(rec, 'R2');
    t.ok(rp && rp.plan.resumed, 'resumed');
    t.eq(Object.keys(rp.done).sort(), ['k0', 'k1'], 'done = slots with a finished block (k2 was interrupted)');
    const pick = (x) => ({ slotId: x.slotId, index: x.index, trackId: x.trackId, role: x.role, taskId: x.taskId, set: x.set, lessonId: x.lessonId, unitId: x.unitId,
      purpose: x.purpose, protocol: x.protocol, modeId: x.modeId, sessionIndex: x.sessionIndex, phase: x.phase, glyphs: x.glyphs, strategyCard: x.strategyCard || null, rung: x.rung, unitTask: x.unitTask });
    t.eq(rp.plan.slots.map(pick), plan.slots.map(pick), 'the slots prepare() reads');
    for (const k of ['id', 'modeId', 'requestedMode', 'protocol', 'study', 'sessionIndex', 'phase', 'glyphs', 'estMinutes', 'introduce', 'reflection', 'free', 'notes', 'counts'])
      t.eq(JSON.stringify(rp.plan[k] ?? null), JSON.stringify(plan[k] ?? null), 'plan.' + k);
    const a = HF.engine.prepare(rp.plan.slots[3], rec, d, { sessionId: 'R2' }), b = HF.engine.prepare(plan.slots[3], rec, d, { sessionId: 'R2' });
    t.eq(JSON.stringify(a), JSON.stringify(b), 'same BlockPlan from the stored slot');
    t.eq(HF.engine.resumePlan(rec, 'nope'), null);
    const end = HF.engine.endSession(rec, 'R2', { now: at(2, 11) });
    t.ok(!('plan' in end.session) && !('plan' in end.records.sessions.find(x => x.id === 'R2')), 'removed at the end');
    t.eq(HF.engine.resumePlan(end.records, 'R2'), null, 'an ended session is not resumed');
    const old = { ...rec, sessions: rec.sessions.map(x => (x.id === 'R2' ? { ...x, plan: undefined } : x)) };
    t.eq(HF.engine.resumePlan(old, 'R2'), null, 'sessions begun before plans were stored → null (re-plan as before)');
  });

  await t.test('resumePlan: Free play keeps the versions already played and does not reuse their slots', () => {
    let rec = fresh({ mode: 'free' });
    const plan = HF.engine.plan(rec, HF.engine.derive(rec, at(3)), { now: at(3), id: 'F3' });
    rec = HF.engine.beginSession(rec, plan, { now: at(3) }).records;
    let d = HF.engine.derive(rec, at(3));
    for (const tid of ['nback.plain', 'rel.grid.T1']) {
      const slot = HF.planner.freeSlot(plan, { trackId: tid, rung: 2 });
      const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'F3' });
      const c = HF.engine.commit(rec, bp, null, resultFor(bp, 0.9), { now: at(3, 10, 5), sessionId: 'F3', derived: d });
      rec = c.records; d = c.derived;
    }
    const rp = HF.engine.resumePlan(rec, 'F3');
    t.eq(rp.plan.slots.slice(0, 2).map(s => s.trackId), ['nback.plain', 'rel.grid.T1']);
    t.eq(HF.planner.freeSlot(rp.plan, { trackId: 'nback.plain' }).slotId, 'k2', 'the next free block takes a new slot');
  });
}
