// Engine: session planner — templates, ramp, introduction order, modes, protocols, Study arms, BlockPlans.
import { HF, loadAllPure } from './load.mjs';
import { loadEngine } from '../sim/lib.mjs';
import { drive, resultFor } from './engine-derive.test.mjs';
loadEngine();

const at = (d, h = 10, m = 0) => new Date(2026, 0, d, h, m).getTime();
const fresh = (settings) => { const r = HF.engine.newRecords(at(1)); r.settings = { ...r.settings, ...(settings || {}) }; r.events.push({ id: 'tut', t: at(1, 9), type: 'lesson-passed', lessonId: 'lesson.nback' }); return r; };
const planOf = (rec, now, o = {}) => HF.engine.plan(rec, HF.engine.derive(rec, now), { now, id: o.id || 'P', ...o });
const tracksOf = (p) => p.slots.map(s => s.trackId);

export default async function (t) {
  const P = HF.planner;

  await t.test('planner: session 1 (Varied, 25 min) = per task 1 warm-up + 6 rated, blocked, Plain + Grid T1', () => {
    const p = planOf(fresh(), at(1));
    t.eq([p.modeId, p.phase, p.slots.length, p.sessionIndex], ['varied', 'blocked', 14, 1]);
    t.eq(p.slots.map(s => s.role).filter(r => r === 'warmup').length, 2);
    t.eq([...new Set(tracksOf(p))], ['nback.plain', 'rel.grid.T1']);
    t.eq(p.introduce, ['nback.plain', 'rel.grid.T1']);
    t.eq(p.slots[0].role, 'warmup'); t.eq(p.slots[7].role, 'warmup');
    t.eq(p.slots[7].lessonId, 'lesson.grid'); t.eq(p.slots[0].lessonId, null, 'tutorial already passed');
    t.ok(p.estMinutes >= 18 && p.estMinutes <= 30, 'estimate ' + p.estMinutes);
  });

  await t.test('planner: block counts scale with minutes and balance; Span on gives 40/35/25 (15 blocks)', () => {
    t.eq(planOf(fresh(), at(1), { minutes: 10 }).slots.length, 7);
    t.eq(planOf(fresh(), at(1), { minutes: 30 }).slots.length, 16);
    t.eq(P.taskCounts({ balance: { nback: 50, relations: 50, span: 0 } }, 25, false), [{ task: 'nback', rated: 6 }, { task: 'relations', rated: 6 }]);
    t.eq(P.taskCounts({ balance: { nback: 70, relations: 30 } }, 25, false), [{ task: 'nback', rated: 8 }, { task: 'relations', rated: 4 }]);
    t.eq(P.taskCounts({ spanOn: true, balance: { nback: 50, relations: 50, span: 0 } }, 25, false), [{ task: 'nback', rated: 5 }, { task: 'relations', rated: 4 }, { task: 'span', rated: 3 }]);
    const p = planOf(fresh({ spanOn: true }), at(1));
    t.eq(p.slots.length, 15);
    t.ok(tracksOf(p).includes('span.op'));
    t.eq(P.allocate(5, [1, 1, 0.35]), [2, 2, 1]);
    t.eq(P.allocate(2, [1, 1, 1]), [1, 1, 0]);
  });

  await t.test('planner: ramp blocked (1–3) → serial (4–6) → random (7+) with ≤ 2 of a version in a row', () => {
    t.eq([1, 3, 4, 6, 7, 30].map(i => P.phaseFor('varied', i)), ['blocked', 'blocked', 'serial', 'serial', 'random', 'random']);
    t.eq(P.phaseFor('stretch', 1), 'random'); t.eq(P.phaseFor('sprint', 9), 'blocked');
    let rec = fresh();
    for (let k = 0; k < 8; k++) rec = drive(rec, at(1 + k), { ba: 0.88 }).rec;
    const p = planOf(rec, at(10));
    t.eq(p.phase, 'random');
    const rated = p.slots.filter(s => s.role === 'rated').map(s => s.trackId);
    for (let i = 2; i < rated.length; i++) t.ok(!(rated[i] === rated[i - 1] && rated[i] === rated[i - 2]), 'three in a row: ' + rated.join(' '));
    t.ok(p.slots.filter(s => s.trackId === 'rel.stream').length <= 1);
    // tasks alternate in pairs in the random phase
    const tasks = p.slots.map(s => s.taskId);
    t.ok(tasks.slice(0, 3).filter(x => x === 'nback').length >= 1 && tasks.slice(2, 6).includes('relations'));
  });

  await t.test('planner: introduction order with gates (Transform needs Plain 2-back), one new version per session', () => {
    let rec = fresh();
    rec = drive(rec, at(1), { ba: (bp) => bp.trackId === 'nback.plain' ? 0.6 : 0.85 }).rec;   // Plain stays at 1-back
    let p = planOf(rec, at(2));
    t.eq(p.sessionIndex, 2);
    t.ok(!tracksOf(p).includes('nback.transform'), 'gated');
    rec = fresh(); rec = drive(rec, at(1), { ba: 0.92 }).rec;
    p = planOf(rec, at(2));
    t.ok(p.introduce.includes('nback.transform'));
    t.eq(p.introduce.filter(id => ['nback.transform', 'rel.steps', 'nback.switch', 'nback.arith', 'nback.dual', 'rel.stream'].includes(id)).length, 1);
    const firstT = p.slots.find(s => s.trackId === 'nback.transform');
    t.eq(firstT.lessonId, 'lesson.transform');
    t.ok(p.notes.some(n => n.code === 'new-track'));
  });

  await t.test('planner: Sprint uses fixed versions and sets, strategy cards in Sprint sessions 1–3', () => {
    const rec = fresh({ mode: 'sprint' });
    const p = planOf(rec, at(1));
    t.eq([...new Set(tracksOf(p))], ['nback.plain', 'rel.grid.T1']);
    t.ok(p.slots.every(s => s.set === (s.trackId === 'nback.plain' ? 'grid8' : 'digits')));
    t.ok(p.slots.every(s => s.strategyCard));
    const d = HF.engine.derive(rec, at(1));
    const bp = HF.engine.prepare(p.slots[1], rec, d, { sessionId: 'P' });
    t.eq(bp.feedback.perResponse, true);
  });

  await t.test('planner: Stretch is locked until 6 counted sessions; then random with 6 lures and fast pace', () => {
    let rec = fresh({ mode: 'stretch' });
    let p = planOf(rec, at(1));
    t.eq([p.modeId, p.requestedMode, p.notes[0].code], ['varied', 'stretch', 'stretch-locked']);
    for (let k = 0; k < 6; k++) rec = drive(rec, at(1 + k), { ba: 0.9, minutes: 10 }).rec;
    p = planOf(rec, at(8));
    t.eq([p.modeId, p.phase], ['stretch', 'random']);
    const d = HF.engine.derive(rec, at(8));
    const slot = p.slots.find(s => s.trackId === 'nback.plain' && s.role === 'rated');
    const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'P' });
    t.ok(bp.params.n < 2 || bp.params.soaMs === 2500, 'fast pace from 2-back');
    if (bp.params.n >= 2) t.eq(bp.lureCount, 6);
    t.eq([bp.feedback.perResponse, bp.feedback.showLevel, bp.feedback.revealAtEnd], [false, false, true]);
  });

  await t.test('planner: Protocols — Cao 20 / Wang 5 / Jaeggi 20 blocks; nothing due → empty plan with a note', () => {
    const rec = fresh({ mode: 'protocols' });
    let p = planOf(rec, at(1), { protocolIds: ['cao'] });
    t.eq([p.protocol, p.slots.length, p.slots[0].trackId, p.slots[0].set, p.slots[0].role], ['cao', 20, 'nback.transform', 'days', 'protocol']);
    const d = HF.engine.derive(rec, at(1));
    const bp = HF.engine.prepare(p.slots[0], rec, d, { sessionId: 'P' });
    t.eq([bp.rung, bp.lureMode, bp.lureCount, bp.params.soaMs, bp.params.step], [0, 'uncontrolled', null, 3000, 1]);
    p = planOf(rec, at(1), { protocolIds: ['wang'] });
    t.eq([p.protocol, p.slots.length, p.slots[0].trackId], ['wang', 5, 'rel.steps']);
    const wbp = HF.engine.prepare(p.slots[0], rec, d, { sessionId: 'P' });
    t.eq([wbp.feedback.dayAccuracyAtEnd, wbp.targets], [true, 10]);
    t.eq(bp.targets, null, 'Cao keeps the generator default');
    p = planOf(rec, at(1), { protocolIds: ['jaeggi'] });
    t.eq([p.protocol, p.slots.length, p.slots[0].trackId, p.slots[0].set], ['jaeggi', 20, 'nback.dual', 'tones']);
    const done = drive(rec, at(1), { modeId: 'protocols', protocolIds: ['cao'], ba: 0.9 }).rec;
    p = planOf(done, at(1, 20), { protocolIds: ['cao'] });
    t.eq([p.slots.length, p.notes[0].code], [0, 'protocol-not-due']);
    p = planOf(done, at(2), { protocolIds: ['cao'] });
    t.eq(p.slots.length, 20);
  });

  await t.test('planner: Study arms — train without Span, control = visual search with the same dose, labonly empty', () => {
    const st = (template, arm) => { const r = fresh({ spanOn: true }); r.events.push({ id: 's1', t: at(1), type: 'study-enrol', template }, { id: 's2', t: at(1), type: 'study-draw', arm }); return r; };
    let p = planOf(st('default', 'train'), at(1));
    t.ok(!tracksOf(p).some(x => /^span|^vs/.test(x))); t.eq(p.study.arm, 'train');
    p = planOf(st('default', 'control'), at(1));
    t.eq([new Set(tracksOf(p)).size, p.slots[0].trackId, p.slots.length], [1, 'vs.search', 13]);
    p = planOf(st('cao', 'control'), at(1)); t.eq(p.slots.length, 20);
    p = planOf(st('wang', 'control'), at(1)); t.eq(p.slots.length, 5);
    p = planOf(st('default', 'labonly'), at(1)); t.eq([p.slots.length, p.notes[0].code], [0, 'study-labonly']);
    p = planOf(st('cao', 'cao-trad'), at(1)); t.eq([p.protocol, p.slots[0].trackId], ['cao', 'nback.plain']);
    p = planOf(st('wang', 'wang-steps'), at(1)); t.eq(p.protocol, 'wang');
    const r = fresh(); r.events.push({ id: 's1', t: at(1), type: 'study-enrol', template: 'default' });
    p = planOf(r, at(1)); t.eq([p.slots.length, p.notes[0].code], [0, 'study-awaiting-arm']);
  });

  await t.test('planner: Study arms as HF.study names them (the draw / coordinator codes) plan the right programme', () => {
    // Phase 3: the Study screen records HF.study arm ids (varied, search, cao-search, wang-search); the planner must
    // read them as train / control (it used to answer "Unknown study arm").
    const st = (template, arm) => { const r = fresh({ spanOn: true }); r.events.push({ id: 's1', t: at(1), type: 'study-enrol', template }, { id: 's2', t: at(1), type: 'study-draw', arm, template }); return r; };
    let p = planOf(st('default', 'varied'), at(1));
    t.ok(p.slots.length > 0 && !tracksOf(p).some(x => /^span|^vs/.test(x)), 'varied = the training arm');
    t.eq(p.study.arm, 'varied', 'the session keeps the drawn arm id');
    p = planOf(st('default', 'search'), at(1));
    t.eq([new Set(tracksOf(p)).size, p.slots[0].trackId, p.slots.length], [1, 'vs.search', 13]);
    p = planOf(st('cao', 'cao-search'), at(1)); t.eq([p.slots.length, p.slots[0].trackId], [20, 'vs.search']);
    p = planOf(st('wang', 'wang-search'), at(1)); t.eq([p.slots.length, p.slots[0].trackId], [5, 'vs.search']);
    t.ok(!p.notes.some(n => n.code === 'study-unknown-arm'));
    const d = HF.engine.derive(st('default', 'search'), at(1));
    t.eq(d.tracks['vs.search'].available, true, 'visual search opens for the search arm');
    t.eq(HF.engine.derive(st('default', 'varied'), at(1)).tracks['vs.search'].available, false, 'not for the training arm');
  });

  await t.test('planner: Free play slots are chosen at run time', () => {
    const rec = fresh({ mode: 'free' });
    const p = planOf(rec, at(1));
    t.ok(p.free && p.slots.every(s => s.trackId === null && s.role === 'free'));
    const s = P.freeSlot(p, { trackId: 'rel.steps', rung: 3, set: 'numbers' });
    const bp = HF.engine.prepare(s, rec, HF.engine.derive(rec, at(1)), { sessionId: 'P' });
    t.eq([bp.trackId, bp.rung, bp.set, bp.role], ['rel.steps', 3, 'numbers', 'free']);
    t.throws(() => HF.engine.prepare({ slotId: 'x', trackId: null, role: 'free' }, rec, HF.engine.derive(rec, at(1)), {}));
  });

  await t.test('prepare: seeds are unique per slot and attempt; warm-up 2 rungs down; lures; glyph family; no Lab sets', () => {
    let rec = fresh();
    rec = drive(rec, at(1), { ba: 0.95 }).rec;
    const d = HF.engine.derive(rec, at(2));
    const p = planOf(rec, at(2), { id: 'Q' });
    const seeds = new Set(p.slots.map(s => HF.engine.prepare(s, rec, d, { sessionId: 'Q' }).seed));
    t.eq(seeds.size, p.slots.length);
    t.ok(HF.engine.prepare(p.slots[0], rec, d, { sessionId: 'Q', attempt: 1 }).seed !== HF.engine.prepare(p.slots[0], rec, d, { sessionId: 'Q' }).seed);
    const w = p.slots.find(s => s.role === 'warmup' && s.trackId === 'nback.plain');
    const bpw = HF.engine.prepare(w, rec, d, { sessionId: 'Q' });
    t.eq(bpw.rung, Math.max(0, d.tracks['nback.plain'].level - 2));
    const bpr = HF.engine.prepare(p.slots.find(s => s.role === 'rated' && s.trackId === 'nback.plain'), rec, d, { sessionId: 'Q' });
    t.eq(bpr.rung, d.tracks['nback.plain'].level);
    t.eq(bpr.lureCount, 4, 'position lures; the generator uses none at 1-back');
    t.ok(bpr.ruleCard.title.startsWith('Plain n-back'));
    t.eq(P.glyphFamily(1), 'glyphsA'); t.eq(P.glyphFamily(6), 'glyphsB'); t.eq(P.glyphFamily(41), 'glyphsA');
    const sets = new Set();
    for (let i = 0; i < 60; i++) sets.add(P.chooseSet('nback.plain', d, { sessionIndex: 7, glyphs: 'glyphsB' }, HF.rng.create('x' + i)));
    t.ok(!sets.has('glyphsLab') && !sets.has('glyphs'));
    t.ok([...sets].every(s => !/^glyphs/.test(s) || s === 'glyphsB'), [...sets].join(','));
  });

  await t.test('planner: sound off — no Dual, no audio sets, Dual kept out of the introductions, notes say so', () => {
    let rec = fresh({ sound: 'off', dual: true });
    let d = HF.engine.derive(rec, at(1));
    t.eq([d.soundOff, d.tracks['nback.dual'].available, d.tracks['nback.dual'].blockedBy], [true, false, 'sound']);
    let p = planOf(rec, at(1));
    t.ok(!tracksOf(p).includes('nback.dual') && p.notes.some(n => n.code === 'sound-off'));
    const sets = [];
    for (let k = 0; k < 9; k++) { const o = drive(rec, at(1 + k), { ba: 0.9 }); rec = o.rec; o.bps.forEach(b => sets.push([b.trackId, b.set])); }
    t.ok(sets.every(([tid, s]) => tid !== 'nback.dual' && HF.catalog.contentFamily(s) !== 'audio'), 'no Dual, no tones');
    p = planOf(rec, at(12));
    t.ok(p.sessionIndex >= 9 && !p.introduce.includes('nback.dual') && p.notes.some(n => n.code === 'sound-off'));
    const on = { ...rec, settings: { ...rec.settings, sound: 'tones' } };
    t.ok(planOf(on, at(12)).introduce.includes('nback.dual'), 'Dual joins once sound is on');
    d = HF.engine.derive(rec, at(12));
    const bp = HF.engine.prepare({ slotId: 'z', trackId: 'nback.dual', role: 'rated', modeId: 'varied', sessionIndex: 9, phase: 'random', glyphs: 'glyphsB' }, rec, d, { sessionId: 'Z' });
    t.eq([bp.trackId, bp.replaced, HF.catalog.contentFamily(bp.set) !== 'audio'], ['nback.plain', 'nback.dual', true]);
    const pj = planOf(fresh({ sound: 'off', mode: 'protocols' }), at(1), { protocolIds: ['jaeggi'] });
    t.eq([pj.slots.length, pj.notes.map(n => n.code)], [0, ['sound-off', 'protocol-not-due']]);
    const ps = planOf(fresh({ sound: 'off', mode: 'sprint', sprint: { nback: 'nback.dual' } }), at(1));
    t.ok(!tracksOf(ps).includes('nback.dual') && tracksOf(ps).includes('nback.plain'));
    // Mastery passes over Dual units while sound is off
    const M = HF.mastery, ev = [], bl = [];
    ['u01', 'u03', 'u05'].forEach((u, i) => { const un = M.unit(u); bl.push({ id: u + 'a', sessionId: 's' + i, t: at(2, 10, i), trackId: un.trackId, role: 'rated', unitId: u, purpose: 'unit', rung: un.target, result: { ba: 0.9 } }, { id: u + 'b', sessionId: 's' + i, t: at(2, 10, i + 10), trackId: un.trackId, role: 'rated', unitId: u, purpose: 'unit', rung: un.target, result: { ba: 0.9 } }); ev.push({ type: 'mastery-check', t: at(3, 10, i), unitId: u, ba: 0.9, pass: true }); });
    t.eq(M.state(bl, ev, at(4)).current.nback, 'u08');
    t.eq(M.state(bl, ev, at(4), { skipTracks: { 'nback.dual': true } }).current.nback, 'u10');
  });

  await t.test('planner: one "all-introduced" note once every available version has been introduced', () => {
    let rec = fresh();
    const ALL = 'All versions introduced — from now on Long-Horizon keeps mixing them (maintenance).';
    let sawEarly = false;
    for (let k = 0; k < 12; k++) {
      const p = planOf(rec, at(1 + k));
      const notes = p.notes.filter(n => n.code === 'all-introduced');
      t.ok(notes.length <= 1, 'at most once per plan');
      if (k < 3 && notes.length) sawEarly = true;
      if (notes.length) t.eq(notes[0].text, ALL);
      rec = drive(rec, at(1 + k), { ba: 0.95 }).rec;
    }
    t.eq(sawEarly, false);
    const d = HF.engine.derive(rec, at(20)), p = planOf(rec, at(20));
    const avail = HF.catalog.ids().filter(id => id !== 'vs.search' && d.tracks[id].available);
    t.ok(avail.every(id => d.tracks[id].introduced || p.introduce.includes(id)), 'all available versions introduced by session 13');
    t.eq(p.notes.filter(n => n.code === 'all-introduced').length, 1);
  });

  await t.test('planner: Mastery plans the current unit per task, then checks and reviews when due', () => {
    let rec = fresh({ mode: 'mastery' });
    let p = planOf(rec, at(1));
    t.eq(p.slots.filter(s => s.role === 'rated').map(s => s.unitId).filter((x, i, a) => a.indexOf(x) === i), ['u01', 'u02']);
    rec = drive(rec, at(1), { ba: 0.95 }).rec;
    const d = HF.engine.derive(rec, at(2));
    t.eq(d.mastery.units.u01.status, 'pending-check');
    p = planOf(rec, at(2));
    t.eq(p.slots.filter(s => s.purpose === 'check').length, 4, 'two checks per task');
    const out = drive(rec, at(2), { ba: 0.95 });
    t.ok(out.events.some(e => e.type === 'unit-passed' && e.stage === 'check'));
    t.eq(out.derived.mastery.units.u01.status, 'passed');
  });

  await t.test('planner: plan.counts is computed at plan time, not from a day-cached derived (CA-03)', () => {
    let rec = fresh({ mode: 'sprint' });
    const out = drive(rec, at(5, 8), { ba: 0.85, minutes: 10 });
    rec = out.rec;
    t.ok(HF.engine.derive(rec, out.now).counted[out.plan.id], 'the 08:00 Sprint session counted');
    const cached = HF.engine.derive(rec, out.now + 60000);           // what a store caches for the rest of the day
    t.eq(cached.today.canCount.reason, 'gap');
    let p = HF.engine.plan(rec, cached, { now: at(5, 12), id: 'P2' });
    t.eq(p.counts, { ok: true, reason: null }, 'at 12:00 the 3 h gap has passed');
    t.ok(!p.notes.some(n => n.code === 'not-counted'), 'no stale "extra practice" note');
    p = HF.engine.plan(rec, cached, { now: out.now + 3600000, id: 'P3' });
    t.eq([p.counts.ok, p.counts.reason], [false, 'gap']);
    t.ok(p.counts.waitMs > 0 && p.counts.waitMs <= 2 * 3600000, 'waitMs ' + p.counts.waitMs);
    t.eq(p.notes.filter(n => n.code === 'not-counted').map(n => n.reason), ['gap']);
    // a second counted Sprint session later that day reaches the day limit (2)
    rec = drive(rec, at(5, 13), { ba: 0.85, minutes: 10, id: 'S2' }).rec;
    p = HF.engine.plan(rec, HF.engine.derive(rec, at(5, 9)), { now: at(5, 18), id: 'P4' });
    t.eq([p.counts.ok, p.counts.reason], [false, 'day-limit']);
    p = HF.engine.plan(rec, HF.engine.derive(rec, at(5, 18)), { now: at(5, 18), id: 'P5', modeId: 'protocols', protocolIds: ['cao'] });
    t.eq([p.protocol, p.counts.reason], ['cao', 'day-limit'], 'the day limit spans modes, as in HF.goals.countSessions');
    p = HF.engine.plan(rec, HF.engine.derive(rec, at(5, 18)), { now: at(6, 9), id: 'P6', modeId: 'protocols', protocolIds: ['cao'] });
    t.eq(p.counts.ok, true, 'next morning, even with yesterday\'s derived');
  });

  await t.test('derive/planner: a coordinator code sets the template; study-leave returns to normal planning (CB-03, addendum)', () => {
    loadAllPure();
    if (!HF.study || !HF.study.encodeCode) { t.ok(true, 'HF.study not loaded'); return; }
    const S = HF.study;
    const coded = (arm, extra = []) => { const r = fresh({ spanOn: true }); r.events.push({ id: 's1', t: at(1), type: 'study-enrol', template: 'default' }, { id: 's2', t: at(1, 11), type: 'study-code', code: S.encodeCode(arm, 'x1') }, ...extra); return r; };
    let d = HF.engine.derive(coded('cao-search'), at(2));
    t.eq([d.study.template, d.study.arm], ['cao', 'cao-search'], 'template from the code, not from the enrolment');
    t.eq(planOf(coded('cao-search'), at(2)).slots.length, 20, 'the Cao control arm (20 search blocks)');
    d = HF.engine.derive(coded('wang-search'), at(2));
    t.eq(d.study.template, 'wang');
    t.eq(HF.engine.derive(coded('search'), at(2)).study.template, 'default');
    // leaving: the arm is ignored from then on, records stay, vs.search closes again
    const left = coded('search', [{ id: 's3', t: at(3), type: 'study-leave' }]);
    d = HF.engine.derive(left, at(4));
    t.eq([d.study.arm, d.study.left], ['search', at(3)], 'derived.study keeps the arm and says when the learner left');
    t.eq(d.tracks['vs.search'].available, false);
    t.ok(d.tracks['span.op'].available !== false || !d.settings.spanOn, 'Span gate no longer held by the study');
    const p = planOf(left, at(4));
    t.eq([p.study, p.modeId, p.requestedMode], [null, 'varied', 'varied']);
    t.ok(p.slots.length > 0 && !tracksOf(p).includes('vs.search'), 'plans the chosen mode normally');
    t.eq(planOf(coded('search'), at(4)).slots[0].trackId, 'vs.search', 'before leaving: the control arm');
    t.eq(left.events.length, 4, 'records untouched');
  });

  await t.test('planner: estMinutes uses the measured median block duration per track (≥ 3 finished blocks; addendum 3)', () => {
    let rec = fresh();
    const p1 = planOf(rec, at(1), { id: 'D1' });
    rec = HF.engine.beginSession(rec, p1, { now: at(1) }).records;
    let now = at(1), d = HF.engine.derive(rec, now);
    for (const slot of p1.slots) {
      const bp = HF.engine.prepare(slot, rec, d, { sessionId: 'D1' }), dur = bp.taskId === 'relations' ? 20000 : 70000;
      const c = HF.engine.commit(rec, bp, null, resultFor(bp, 0.85), { t: now, now: now + dur, sessionId: 'D1', derived: d });
      rec = c.records; d = c.derived; now += dur + 10000;
    }
    rec = HF.engine.endSession(rec, 'D1', { now }).records;
    const d2 = HF.engine.derive(rec, at(2));
    t.eq([d2.tracks['rel.grid.T1'].blockMs, d2.tracks['nback.plain'].blockMs, d2.tracks['nback.transform'].blockMs], [20000, 70000, null]);
    const p2 = planOf(rec, at(2), { id: 'D2' });
    const want = Math.round(p2.slots.reduce((s, sl) => {
      const tr = d2.tracks[sl.trackId];
      return s + ((tr.blockMs ?? HF.catalog.estBlockMs(sl.trackId, HF.catalog.params(sl.trackId, tr.level))) + 15000) / 60000;
    }, 0));
    t.eq(p2.estMinutes, want);
    const catalogOnly = Math.round(p2.slots.reduce((s, sl) => s + (HF.catalog.estBlockMs(sl.trackId, HF.catalog.params(sl.trackId, d2.tracks[sl.trackId].level)) + 15000) / 60000, 0));
    t.ok(p2.estMinutes !== catalogOnly, `measured ${p2.estMinutes} min, catalog ${catalogOnly} min`);
    const sameRecNoDur = { ...rec, blocks: rec.blocks.map(b => ({ ...b, durationMs: undefined })) };
    t.eq(planOf(sameRecNoDur, at(2), { id: 'D2' }).slots.length, p2.slots.length, 'block counts do not depend on it');
  });

  await t.test('coach: one card per version — Growing never repeats Edge or Due (PQ-09)', () => {
    let rec = fresh({ mode: 'free' });
    for (let k = 0; k < 6; k++) rec = drive(rec, at(1 + k), { ba: (bp) => (bp.trackId === 'nback.plain' ? 0.95 : 0.8) }).rec;
    const d = HF.engine.derive(rec, at(9));
    for (const trackId of [undefined, 'nback.plain', 'rel.grid.T1']) {
      const s = HF.coach.suggest(d, { now: at(9), trackId });
      const ids = s.map(x => x.trackId);
      t.eq(ids.length, new Set(ids).size, 'distinct versions: ' + s.map(x => x.kind + ':' + x.trackId).join(', '));
    }
  });

  await t.test('assist note and BlockPlan.aid name the aid of the task (PQ-03); Grid examples speak the set (PQ-11)', () => {
    const rec = fresh();
    rec.events = rec.events.filter(e => e.type !== 'lesson-passed').concat([{ id: 'a1', t: at(1, 9, 6), type: 'assist-start', trackId: 'nback.plain' },
      { id: 'a2', t: at(1, 9, 7), type: 'assist-start', trackId: 'rel.grid.T1' }]);
    const p = planOf(rec, at(1));
    const notes = Object.fromEntries(p.notes.filter(n => n.code === 'assist').map(n => [n.trackId, n]));
    t.eq([notes['nback.plain'].aid, notes['rel.grid.T1'].aid], ['tape', 'highlight']);
    t.ok(/memory tape/.test(notes['nback.plain'].text) && /highlight/.test(notes['rel.grid.T1'].text) && !/tape/.test(notes['rel.grid.T1'].text));
    const d = HF.engine.derive(rec, at(1));
    const g = p.slots.find(s => s.trackId === 'rel.grid.T1' && s.role === 'assist');
    t.eq(HF.engine.prepare(g, rec, d, { sessionId: 'P' }).aid, 'highlight');
    const C = HF.catalog;
    t.eq(C.ruleCard('rel.grid.T1', 0, 'digits').example, 'a row whose last digits are 7, 7, 7 → yes');
    t.eq(C.ruleCard('rel.grid.T1', 0, 'letters').example, 'a row whose last letters are K, K, K → yes');
    t.eq(C.ruleCard('rel.grid.T1', 0, 'shapes').example, 'a row whose middle icons are all the same → yes');
    t.eq(C.ruleCard('rel.grid.T2', 0, 'bars').example, 'a column whose last bars follow the order in the key → yes');
    for (const id of C.ids().filter(x => C.get(x).tier)) for (const s of ['shapes', 'dots', 'bars', 'glyphsC']) {
      const ex = C.ruleCard(id, 0, s).example;
      t.ok(!/\d, \d| ends? /.test(ex.replace(/^SAME: /, '')) || id === 'rel.grid.T6', id + ' ' + s + ': ' + ex);
    }
  });
}
