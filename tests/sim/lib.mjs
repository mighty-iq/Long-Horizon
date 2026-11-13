// Long-Horizon — simulation library (node). Simulated learners play sessions through the real engine:
// HF.engine.plan → beginSession → prepare → (simulated block result) → commit → endSession.
// No generator or DOM code is used: block results are drawn from each learner's true ability versus the
// rung's true difficulty (signal detection with a response bias, binomial counts, HF.stats.sdt scoring).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const DAY = 86400000, HOUR = 3600000, MIN = 60000;

export const ENGINE_FILES = ['js/core/rng.js', 'js/core/stats.js', 'js/engine/catalog.js', 'js/engine/modes.js', 'js/engine/learner.js',
  'js/engine/controller.js', 'js/engine/protocols.js', 'js/engine/mastery.js', 'js/engine/goals.js', 'js/engine/badges.js',
  'js/engine/coach.js', 'js/engine/derive.js', 'js/engine/planner.js', 'js/engine/engine.js'];

export function loadEngine() {
  for (const f of ENGINE_FILES) require(path.join(ROOT, f));
  return globalThis.HF;
}

const HFG = () => globalThis.HF;

// ---------- small random helpers on top of HF.rng ----------
function normal(r) { let u = 0, v = 0; while (u === 0) u = r.next(); while (v === 0) v = r.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function binom(r, n, p) { let k = 0; for (let i = 0; i < n; i++) if (r.next() < p) k++; return k; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const logistic = x => 1 / (1 + Math.exp(-x));

// Population-level truth about the tasks: the catalog's difficulties are only approximately right.
let POP = null;
export function population(seed = 'pop-1', opts = {}) {
  const HF = HFG(), r = HF.rng.create(seed), C = HF.catalog;
  const bias = {}, scale = {};
  for (const id of C.ids()) { bias[id] = 0.35 * normal(r); scale[id] = clamp(1 + 0.15 * normal(r), 0.7, 1.35); }
  for (const id of opts.exact || []) { bias[id] = 0; scale[id] = 1; }   // truth = catalog for these tracks
  POP = { bias, scale };
  return POP;
}

/** A simulated learner with a latent ability per track that grows with practice and decays over breaks. */
export function makeLearner(id, opts = {}) {
  const HF = HFG(), C = HF.catalog, r = HF.rng.create('learner:' + id);
  const pop = POP || population();
  const g = (opts.gSD != null ? opts.gSD : 0.7) * normal(r) + (opts.gBoost || 0);
  const taskOff = {}, trackOff = {}, gainTrack = {}, lastPractice = {};
  for (const t of C.TASKS) taskOff[t] = 0.3 * normal(r);
  for (const tid of C.ids()) trackOff[tid] = (opts.trackSD != null ? opts.trackSD : 0.3) * normal(r);
  const gainTask = {}; let gainGen = 0;
  const L = {
    id, r,
    eta: Math.exp(Math.log(0.045) + 0.45 * normal(r)),
    asym: clamp(2.5 + 0.6 * normal(r), 1.2, 4),
    bias: clamp(0.25 + 0.25 * normal(r), -0.4, 0.9),
    pDay: opts.pDay != null ? opts.pDay : 0.35 + 0.55 * r.next(),
    pSecond: opts.pSecond != null ? opts.pSecond : 0.08,
    minutes: opts.minutes || [10, 15, 20, 25, 25, 25, 30][r.int(0, 6)],
    weeklyTarget: r.int(3, 5),
    quitP: 0.05, badP: 0.04, interruptP: 0.03,
    struggleFrom: opts.struggleFrom != null ? opts.struggleFrom : null, struggleDrop: opts.struggleDrop || 0,
    breakLeft: 0, dayForm: 0, day: 0,
    trueTheta(trackId, set) {
      const tr = C.get(trackId);
      let th = g + taskOff[tr.task] + trackOff[trackId] + (gainTrack[trackId] || 0) + 0.25 * (gainTask[tr.task] || 0) + 0.08 * gainGen;
      if (tr.task === 'vsearch') th = 0.5 * g + taskOff.vsearch + trackOff[trackId] + (gainTrack[trackId] || 0);
      if (L.struggleFrom != null && L.day >= L.struggleFrom && L.day < L.struggleFrom + 14) th -= L.struggleDrop;
      return th + L.dayForm;
    },
    trueDiff(trackId, rung, adj) {
      const d0 = C.difficulty(trackId, 0), d = C.difficulty(trackId, rung, adj);
      return d0 + pop.bias[trackId] + pop.scale[trackId] * (d - d0);
    },
    newDay(day) {
      // decay of gains on tracks not practised (≈ 0.4 % per day), day-to-day form
      const days = day - L.day; L.day = day;
      if (days > 0) for (const k of Object.keys(gainTrack)) gainTrack[k] *= Math.pow(0.996, days);
      L.dayForm = 0.2 * normal(r);
    },
    trainsToday() {
      if (L.breakLeft > 0) { L.breakLeft--; return false; }
      if (r.next() < 0.015) { L.breakLeft = r.int(5, 20); return false; }
      return r.next() < L.pDay;
    },
    /** BlockResult in the scorers' shape (SPEC §4.5) for the given BlockPlan. */
    play(bp) {
      const tr = C.get(bp.trackId);
      let th = L.trueTheta(bp.trackId, bp.set) + 0.15 * normal(r);
      const bad = r.next() < L.badP; if (bad) th -= 1.5;
      const dTrue = L.trueDiff(bp.trackId, bp.rung, { lureCount: bp.lureCount, lureMode: bp.lureMode, step: bp.params && bp.params.step });
      const p = logistic(th - dTrue);
      const interrupted = r.next() < L.interruptP;
      if (tr.scale === 'recall') {
        const recall = clamp(p + 0.08 * normal(r), 0, 1), procAcc = clamp(0.92 + 0.04 * normal(r), 0.5, 1);
        const res = { trackId: bp.trackId, kind: 'span', ba: recall, baMean: recall, y: recall, dprime: null, crit: null, streams: {},
          nScorable: 3 * (bp.params.setSize || 2), nVoided: 0, voidedRatio: 0, extra: { recall, procAcc } };
        if (interrupted) res.paused = true;
        L._last = { p, dTrue, th };
        return res;
      }
      const baTrue = 0.5 + 0.5 * p;
      const dp = 2 * HF.stats.normInv(clamp(baTrue, 0.5001, 0.9999));
      let streams;
      const vsN = tr.task === 'vsearch' ? (bp.params && bp.params.trials) || 20 : 0;   // visual search: params.trials displays, half present
      const counts = vsN ? [vsN / 2, vsN / 2] : tr.blockKind === 'discrete' ? [10, 10] : (bp.trackId === 'rel.stream' ? [6, 24] : (bp.targets ? [bp.targets, 20 - bp.targets] : [6, 14]));
      const one = (dprime) => {
        const H = HF.stats.normCdf(dprime / 2 - L.bias), F = HF.stats.normCdf(-dprime / 2 - L.bias);
        const h = binom(r, counts[0], H), fa = binom(r, counts[1], F);
        const s = HF.stats.sdt(h, counts[0] - h, fa, counts[1] - fa);
        return { hits: h, misses: counts[0] - h, fas: fa, crs: counts[1] - fa, lureFas: 0, lureTrials: bp.lureCount || 0, hitRate: s.hitRate, faRate: s.faRate, ba: s.ba, dprime: s.dprime, criterion: s.criterion, rtMedian: 600, y: s.y };
      };
      if (tr.dualVisual) {
        const dpSnd = 2 * HF.stats.normInv(clamp(0.5 + 0.5 * logistic(th - 0.3 - dTrue), 0.5001, 0.9999));
        streams = { pos: one(dp), snd: one(dpSnd) };
      } else streams = { main: one(dp) };
      const ks = Object.keys(streams), bas = ks.map(k => streams[k].ba);
      const res = {
        trackId: bp.trackId, kind: tr.blockKind, ba: Math.min(...bas), baMean: bas.reduce((a, b) => a + b, 0) / bas.length,
        y: ks.reduce((a, k) => a + streams[k].y, 0) / ks.length, dprime: ks.reduce((a, k) => a + streams[k].dprime, 0) / ks.length,
        crit: ks.reduce((a, k) => a + streams[k].criterion, 0) / ks.length, streams, nScorable: counts[0] + counts[1], nVoided: 0, voidedRatio: 0, extra: {}
      };
      if (interrupted) { if (r.next() < 0.5) res.paused = true; else { res.voidedRatio = 0.3; res.nVoided = 6; } }
      L._last = { p, dTrue, th, baTrue };
      return res;
    },
    /** practice effect of one block (warm-ups count as practice too) */
    learn(bp, res) {
      const tr = C.get(bp.trackId);
      if (res.paused) return;
      const ba = tr.scale === 'recall' ? 0.5 + 0.5 * res.ba : res.ba;
      const challenge = 0.5 + 0.5 * Math.exp(-Math.pow((ba - 0.8) / 0.12, 2));
      const have = gainTrack[bp.trackId] || 0, head = Math.max(0, 1 - have / L.asym);
      // practice per block: a visual-search block of 40 displays counts as two blocks of 20 (Phase 4, SC-02)
      const dose = tr.task === 'vsearch' ? ((bp.params && bp.params.trials) || 20) / 20 : 1;
      const dlt = L.eta * head * challenge * dose;
      gainTrack[bp.trackId] = have + dlt;
      gainTask[tr.task] = (gainTask[tr.task] || 0) + dlt * 0.5 * Math.max(0, 1 - (gainTask[tr.task] || 0) / L.asym);
      gainGen += dlt * 0.1;
      lastPractice[bp.trackId] = L.day;
    }
  };
  return L;
}

/** Free-play chooser: mostly stays at the current level (like a self-paced learner), sometimes follows the coach. */
function freeChoice(HF, L, d, now) {
  const r = L.r, sug = HF.coach.suggest(d, { now, trackId: L._freeTrack });
  const tracks = HF.coach.freeTracks(d).filter(id => d.tracks[id].introduced || id === 'nback.plain' || id === 'rel.grid.T1');
  const pick = r.next();
  let trackId = L._freeTrack && tracks.includes(L._freeTrack) ? L._freeTrack : tracks[r.int(0, tracks.length - 1)];
  let rung = d.tracks[trackId].level, kind = 'level';
  if (pick < 0.15) { const e = sug.find(s => s.kind === 'edge'); if (e) { trackId = e.trackId; rung = e.rung; kind = 'edge'; } }
  else if (pick < 0.25) { rung = Math.max(0, rung - 1); kind = 'easier'; }
  else if (pick < 0.30) { rung = Math.min(HF.catalog.maxRung(trackId), rung + 1); kind = 'harder'; }
  else if (pick < 0.40) { const s = sug.find(x => x.kind === 'due' || x.kind === 'new' || x.kind === 'growing'); if (s) { trackId = s.trackId; rung = d.tracks[trackId].level; kind = s.kind; } }
  if (r.next() < 0.3) L._freeTrack = trackId; // stay on a version for a while
  return { trackId, rung, kind };
}

/** Plays one session; returns { records, plan, issues, events, endedBy }. */
export function runSession(HF, rec, L, now, opts = {}) {
  const issues = [];
  let d = HF.engine.derive(rec, now);
  const id = `${L.id}-s${(rec.sessions || []).length + 1}`;
  let plan;
  try { plan = HF.engine.plan(rec, d, { now, id, protocolIds: opts.protocolIds }); }
  catch (e) { issues.push({ kind: 'plan-throw', msg: e.message }); return { records: rec, plan: null, issues, events: [] }; }
  if (!plan.slots.length) {
    const ok = plan.notes.some(n => /protocol-not-due|study-labonly|study-awaiting/.test(n.code));
    if (!ok) issues.push({ kind: 'dead-end', msg: 'empty plan', notes: plan.notes.map(n => n.code) });
    return { records: rec, plan, issues, events: [] };
  }
  ({ records: rec } = HF.engine.beginSession(rec, plan, { now }));
  d = HF.engine.derive(rec, now);
  const allEvents = [];
  let endedBy = 'done';
  const quitAt = L.r.next() < L.quitP ? L.r.int(1, plan.slots.length - 1) : Infinity;
  for (let i = 0; i < plan.slots.length; i++) {
    if (i >= quitAt) { endedBy = 'quit'; break; }
    let slot = plan.slots[i];
    let choice = null;
    if (!slot.trackId) { choice = freeChoice(HF, L, d, now); slot = HF.planner.freeSlot(plan, choice); }
    let bp;
    try { bp = HF.engine.prepare(slot, rec, d, { sessionId: plan.id }); }
    catch (e) { issues.push({ kind: 'prepare-throw', msg: e.message, slot }); break; }
    // validity checks
    const C = HF.catalog;
    if (!C.get(bp.trackId)) issues.push({ kind: 'bad-track', bp });
    if (!(bp.rung >= 0 && bp.rung <= C.maxRung(bp.trackId) && Number.isInteger(bp.rung))) issues.push({ kind: 'bad-rung', trackId: bp.trackId, rung: bp.rung });
    if (/lab/i.test(bp.set || '')) issues.push({ kind: 'lab-set', set: bp.set });
    if (!bp.ruleCard || !bp.ruleCard.rule) issues.push({ kind: 'no-rule-card', trackId: bp.trackId });
    const exp = C.params(bp.trackId, bp.rung);
    for (const k of Object.keys(exp)) if (bp.params[k] !== exp[k]) issues.push({ kind: 'params-mismatch', trackId: bp.trackId, key: k });
    if (bp.lessonId && !(d.lessons.passed[bp.lessonId])) {
      rec = { ...rec, events: rec.events.concat([{ id: `${plan.id}-L${i}`, t: now, type: 'lesson-passed', lessonId: bp.lessonId }]) };
      d = HF.engine.derive(rec, now);
    }
    const res = L.play(bp);
    const extraMeta = { choice, pTrue: L._last ? L._last.p : null };
    let c;
    try { c = HF.engine.commit(rec, bp, null, res, { now, sessionId: plan.id, derived: d }); }
    catch (e) { issues.push({ kind: 'commit-throw', msg: e.message, stack: e.stack }); break; }
    c.block.sim = extraMeta;
    rec = c.records; d = c.derived;
    L.learn(bp, res);
    for (const e of c.events) allEvents.push({ ...e, t: now, slot: i });
    now += HF.catalog.estBlockMs(bp.trackId, bp.params) + 15000;
    if (c.events.some(e => e.type === 'fatigue') && L.r.next() < 0.5) { endedBy = 'fatigue'; break; }
  }
  const end = HF.engine.endSession(rec, plan.id, { now, endedBy });
  rec = end.records;
  for (const e of end.events) allEvents.push({ ...e, t: now, end: true });
  return { records: rec, plan, issues, events: allEvents, endedBy, endAt: now };
}

/** Runs one learner for `days` days. */
export function runLearner(HF, { id, modeId, days = 60, start = Date.UTC(2026, 0, 5, 0, 0), settings = {}, learnerOpts = {}, protocolIds, events = [], switchToStretch = false }) {
  const L = makeLearner(id, learnerOpts);
  let rec = HF.engine.newRecords(start);
  rec.settings = { ...rec.settings, ...settings, mode: modeId, weeklyTarget: L.weeklyTarget, sessionMinutes: L.minutes };
  // the tutorial is passed, except for learners who start assisted (they failed the check twice)
  const assistedStart = events.some(e => e.type === 'assist-start');
  const tut = assistedStart
    ? [{ id: id + '-f1', t: start - 3 * HOUR, type: 'lesson-failed', lessonId: 'lesson.nback' }, { id: id + '-f2', t: start - 2 * HOUR, type: 'lesson-failed', lessonId: 'lesson.nback' }]
    : [{ id: id + '-tut', t: start, type: 'lesson-passed', lessonId: 'lesson.nback' }];
  rec.events = tut.concat(events);
  const issues = [], allEvents = [], plans = [];
  for (let day = 0; day < days; day++) {
    L.newDay(day);
    if (!L.trainsToday()) continue;
    let t = start + day * DAY + Math.round((8 + 13 * L.r.next()) * HOUR);
    const tries = 1 + (L.r.next() < L.pSecond ? 1 : 0) + (L.r.next() < L.pSecond / 3 ? 1 : 0);
    for (let k = 0; k < tries; k++) {
      const out = runSession(HF, rec, L, t, { protocolIds });
      rec = out.records;
      issues.push(...out.issues.map(x => ({ ...x, day })));
      allEvents.push(...out.events.map(e => ({ ...e, day })));
      if (out.plan) plans.push({ day, id: out.plan.id, modeId: out.plan.modeId, requested: out.plan.requestedMode, phase: out.plan.phase, sessionIndex: out.plan.sessionIndex, slots: out.plan.slots.length, introduce: out.plan.introduce, notes: out.plan.notes.map(n => n.code), protocol: out.plan.protocol });
      t = (out.endAt || t) + Math.round((0.5 + 5 * L.r.next()) * HOUR);
      if (t > start + (day + 1) * DAY - HOUR) break;
    }
    if (switchToStretch && rec.settings.mode !== 'stretch') {
      const d = HF.engine.derive(rec, t);
      if (d.stretch.open) rec = { ...rec, settings: { ...rec.settings, mode: 'stretch' } };
    }
  }
  return { records: rec, learner: L, issues, events: allEvents, plans };
}

// ---------- analysis helpers ----------
export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
export function sd(a) { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
export function quant(a, q) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); }
export const fmt = (x, d = 3) => (typeof x === 'number' && isFinite(x)) ? x.toFixed(d) : String(x);

/** Rated blocks after each track's placement phase (first down move), not interrupted, and away from the ladder's
 *  ends: blocks at the bottom/top step or a Mastery/Stretch cap cannot move both ways, and once a track has reached
 *  its top step the blocks just below it are "rebounds" off the ceiling (biased upward), so a track's blocks after
 *  its first visit to the top are left out too (counted in `stats.ceiling`). */
export function settledBlocks(HF, records, filter = () => true, stats) {
  const out = [], seenDown = {}, hitTop = {};
  for (const b of records.blocks) {
    if (!filter(b)) continue;
    const lm = HF.derive.levelMoving(b);
    if (!lm) continue;
    if (HF.controller.blockBad(b)) continue;
    const settled = !!seenDown[b.trackId];
    if (b.moved < 0) seenDown[b.trackId] = true;
    const allowed = HF.catalog.allowedRungs(b.trackId, b.mode), top = allowed[allowed.length - 1];
    const ceil = b.capRung != null ? Math.min(b.capRung, top) : top;
    const wasTop = hitTop[b.trackId + (b.capRung != null ? '@' + b.capRung : '')];
    if (b.rung >= ceil || b.levelAfter >= ceil) hitTop[b.trackId + (b.capRung != null ? '@' + b.capRung : '')] = true;
    if (!settled) continue;
    if (b.rung <= allowed[0] || b.rung >= ceil) continue;
    if (/below-level/.test(b.reason)) continue;
    if (wasTop) { if (stats) stats.ceiling = (stats.ceiling || 0) + 1; continue; }
    out.push(b);
  }
  return out;
}
