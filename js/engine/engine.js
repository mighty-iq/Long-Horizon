/* Long-Horizon — engine facade (pure, no DOM). MIT licence.
 *
 * SPEC §3, §6. All functions are pure: they return a NEW records object (arrays copied, unchanged records
 * shared) and never touch the input. The caller (HF.store.mutate) persists it; this module never bumps `rev`.
 *
 * HF.engine = {
 *   derive(records, now) → Derived                                    (derive.js)
 *   plan(records, derived, opts) → SessionPlan                         (planner.js)
 *   prepare(slot, records, derived, sessionState) → BlockPlan          (planner.js)
 *   beginSession(records, plan, { now }) → { records, session }
 *       SessionRecord { id, startedAt, endedAt: null, dayKey, mode, protocol, study, planned, completed: 0, counted: false,
 *                       minutes: 0, endedBy: null, updatedAt, sessionIndex, plan }   + 'track-intro' events for plan.introduce
 *       completed = finished slots: distinct slots with a block played to the end (interrupted attempts do not count;
 *       a block without slotId counts on its own). Kept current by commit and endSession (Phase 4, CB-02).
 *       plan = the planned slots in compact form while the session is open (removed by endSession; Phase 4, CB-14).
 *   resumePlan(records, sessionId) → { plan: SessionPlan, done: { slotId: BlockRecord }, session } | null
 *       the stored plan of an open session, expanded for prepare(); done = slots with a finished block (latest one);
 *       null when the session is unknown, ended, or was begun before plans were stored (then re-plan as before).
 *   commit(records, blockPlan, spec, result, { now, sessionId?, interrupted?, frame?, t?, id?, derived? })
 *       → { records, events: [Event], block: BlockRecord, derived }
 *       BlockRecord = SPEC §3.3 + { slotId, purpose, lurePlan, lures?, lureMode, targets, study, attempt, capRung, endedAt, durationMs }
 *       (lureCount = lures actually generated per stream, from spec.meta.lureCount or spec.meta.lures; lurePlan = the plan's setting)
 *       Event types: level-up | level-down | pb | badge | unit-passed | check-failed | tier-open | track-available |
 *                    fatigue | assist-faded   (each { type, trackId?, ... , reveal: 'now'|'session-end' })
 *       A Mastery check's second block also appends EventRecord 'mastery-check' {unitId, ba, pass, sessionId}.
 *   endSession(records, sessionId, { now, endedBy, minutes? }) → { records, events, derived, session }
 *       session.minutes = opts.minutes, or the blocks' durations plus gaps around them capped at 2 min each
 *       Events: session-counted {counted, reason} | week-goal {count, target} | stretch-valve | protocol-complete {protocol}
 *               | wang-day {acc, levelBefore, levelAfter} | levels-revealed {changes} | badge
 *   compactResult(BlockResult) → BlockResultCompact (SPEC §3.3; adds n = scorable trials)
 *   compactRecords(records, now, { olderThanDays = 90, force, targetChars, keepDays = 7 }?) → { records, compacted, savedChars }
 *       (Phase 4, CA-05) shrinks training blocks older than olderThanDays to the fields derive(), Progress and
 *       History read (MIN_TOP / MIN_EXTRA below), marks them compacted: true and gives them updatedAt = now (newer
 *       than any copy in another tab). With force and targetChars it then also shrinks younger blocks, oldest first,
 *       until the JSON fits targetChars (never the last keepDays days). Blocks of open sessions are never compacted. Values are never changed,
 *       so derive() gives the same levels, model, goals, badges and series. Never touches Study blocks (block.study
 *       or a session with study), Lab probes, lessons, labVisits, sessions or events. Idempotent: compacted blocks
 *       are skipped (no second updatedAt bump); { records: <the input object>, compacted: 0 } when nothing changed.
 *   Stored blocks are slimmed at commit (Phase 4, CA-05): result floats rounded to 4 decimals, null fields left out,
 *   rungParams left out when equal to the catalog's for that rung (Transform's default step 1 ignored) — an absent
 *   field reads as null and absent rungParams as HF.catalog.params(trackId, rung).
 *   newRecords(now) → empty records with default settings
 *   version
 * }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var VERSION = '1.0.0';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function shallow(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function derive(records, now) { return HF.derive.derive(records, now); }

  function newRecords(now) {
    now = isNum(now) ? now : 0;
    return {
      schema: 1, appVersion: VERSION, rev: 0, createdAt: now, updatedAt: now,
      profile: { updatedAt: now, anonId: null, firstRunDone: false, path: null, startedAt: now },
      settings: shallow(HF.derive.DEFAULT_SETTINGS), calibration: null, backups: { updatedAt: now, lastExportAt: null },
      sessions: [], blocks: [], labVisits: [], events: []
    };
  }

  function compactStream(s) {
    if (!s) return null;
    return {
      h: isNum(s.hits) ? s.hits : (s.h || 0), m: isNum(s.misses) ? s.misses : (s.m || 0),
      fa: isNum(s.fas) ? s.fas : (s.fa || 0), cr: isNum(s.crs) ? s.crs : (s.cr || 0),
      lfa: isNum(s.lureFas) ? s.lureFas : (s.lfa || 0), lt: isNum(s.lureTrials) ? s.lureTrials : (s.lt || 0),
      rt: isNum(s.rtMedian) ? Math.round(s.rtMedian) : (isNum(s.rt) ? s.rt : null)
    };
  }
  function compactResult(r) {
    r = r || {};
    var out = { ba: isNum(r.ba) ? r.ba : NaN, baMean: isNum(r.baMean) ? r.baMean : (isNum(r.ba) ? r.ba : NaN), y: isNum(r.y) ? r.y : NaN,
      dprime: isNum(r.dprime) ? r.dprime : null, crit: isNum(r.crit) ? r.crit : null, streams: {}, extra: r.extra || {},
      n: isNum(r.nScorable) ? r.nScorable : (isNum(r.n) ? r.n : null), voidedRatio: isNum(r.voidedRatio) ? r.voidedRatio : 0 };
    var s = r.streams || {};
    Object.keys(s).forEach(function (k) { var c = compactStream(s[k]); if (c) out.streams[k] = c; });
    return out;
  }

  // ---------- record size (Phase 4, CA-05) ----------
  var DAY = 86400000;
  function r4(x) { return isNum(x) && Math.floor(x) !== x ? Math.round(x * 1e4) / 1e4 : x; }
  function absent(v) { return v === null || v === undefined || (typeof v === 'number' && v !== v); }
  /** rungParams equal to the catalog's params for that rung (Transform's default rule offset, step 1, ignored)? */
  function catalogParams(trackId, rung, params) {
    if (!params || typeof params !== 'object') return false;
    var cat = null;
    try { cat = HF.catalog.params(trackId, rung); } catch (e) { return false; }
    if (!cat || typeof cat !== 'object') return false;
    var ka = Object.keys(params).filter(function (k) { return !(k === 'step' && params.step === 1 && trackId === 'nback.transform' && !('step' in cat)); });
    var kb = Object.keys(cat);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < kb.length; i++) if (!Object.prototype.hasOwnProperty.call(params, kb[i]) || params[kb[i]] !== cat[kb[i]]) return false;
    return true;
  }
  function slimValue(v, depth) {
    if (typeof v === 'number') return r4(v);
    if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 2) return v;
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && !absent(v[k])) o[k] = slimValue(v[k], depth + 1);
    return o;
  }
  /** The stored form of a new block: nulls left out, result floats to 4 decimals, catalog rungParams left out. */
  function slimBlock(b) {
    var o = {};
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !absent(b[k])) o[k] = b[k];
    if (o.rungParams && catalogParams(o.trackId, o.rung, o.rungParams)) delete o.rungParams;
    if (isNum(o.voidedRatio)) o.voidedRatio = r4(o.voidedRatio);
    if (o.result) o.result = slimValue(o.result, 0);
    return o;
  }
  // what compactRecords keeps (everything derive(), Progress and History read; values unchanged)
  var MIN_TOP = ['id', 'sessionId', 't', 'trackId', 'set', 'role', 'mode', 'protocol', 'unitId', 'purpose', 'slotId', 'attempt', 'seed',
    'rung', 'rungParams', 'levelBefore', 'levelAfter', 'moved', 'reason', 'interrupted', 'voidedRatio', 'lureCount', 'lurePlan', 'lureMode',
    'capRung', 'targets', 'durationMs', 'study'];
  var MIN_EXTRA = ['procAcc', 'procRtMean', 'procRtSd', 'procLimitNext', 'protocols', 'recall', 'paused'];
  var COMPACT_ROLES = { warmup: 1, rated: 1, assist: 1, free: 1, check: 1, protocol: 1 };
  function minimalBlock(b, now) {
    var o = {};
    MIN_TOP.forEach(function (k) { if (!absent(b[k]) && b[k] !== false) o[k] = b[k]; });
    if (o.rungParams && catalogParams(o.trackId, o.rung, o.rungParams)) delete o.rungParams;
    var r = b.result;
    if (r && typeof r === 'object') {
      var m = {};
      if (!absent(r.ba)) m.ba = r.ba;
      if (isNum(r.y)) m.y = r.y; else if (!absent(r.baMean)) m.baMean = r.baMean;   // the learner's observation
      if (!absent(r.n)) m.n = r.n;
      if (isNum(r.voidedRatio) && r.voidedRatio !== 0) m.voidedRatio = r.voidedRatio;
      if (r.interrupted) m.interrupted = r.interrupted;
      if (r.paused) m.paused = r.paused;
      if (r.streams && typeof r.streams === 'object') {
        m.streams = {};
        Object.keys(r.streams).forEach(function (k) {
          var s = r.streams[k]; if (!s) return;
          var c = {};
          ['h', 'm', 'fa', 'cr', 'hits', 'misses', 'fas', 'crs'].forEach(function (f) { if (!absent(s[f])) c[f] = s[f]; });
          m.streams[k] = c;
        });
      }
      if (r.extra && typeof r.extra === 'object') {
        var ex = {}, any = false;
        MIN_EXTRA.forEach(function (k) { if (!absent(r.extra[k]) && r.extra[k] !== false) { ex[k] = r.extra[k]; any = true; } });
        if (any) m.extra = ex;
      }
      o.result = m;
    }
    o.compacted = true;
    // a newer updatedAt, so a merge with another tab's full copy keeps this one (HF.schema pickNewer); never bumped
    // again because compacted blocks are skipped
    o.updatedAt = Math.max(isNum(now) ? now : 0, isNum(b.updatedAt) ? b.updatedAt + 1 : 0);
    return o;
  }

  function compactRecords(records, now, opts) {
    opts = opts || {};
    records = records || {};
    var t0 = isNum(now) ? now : 0, C = HF.catalog;
    var days = isNum(opts.olderThanDays) && opts.olderThanDays >= 0 ? opts.olderThanDays : 90;
    var keepDays = isNum(opts.keepDays) && opts.keepDays >= 0 ? opts.keepDays : 7;
    var target = isNum(opts.targetChars) && opts.targetChars > 0 ? opts.targetChars : null;
    var study = {}, open = {};
    (records.sessions || []).forEach(function (s) {
      if (!s) return;
      if (s.study) study[s.id] = true;
      if (s.endedAt == null) open[s.id] = true;
    });
    var list = (records.blocks || []).slice(), n = 0, saved = 0;
    function eligible(b) {
      return !!b && !b.compacted && isNum(b.t) && !b.study && !study[b.sessionId] && !open[b.sessionId] && !!COMPACT_ROLES[b.role] && !!C.get(b.trackId);
    }
    function shrink(i) {
      var b = list[i], c = minimalBlock(b, t0), d = JSON.stringify(b).length - JSON.stringify(c).length;
      if (!(d > 0)) return 0;
      list[i] = c; n++; saved += d;
      return d;
    }
    // 1. every eligible block older than olderThanDays
    var cutoff = t0 - days * DAY;
    for (var i = 0; i < list.length; i++) if (eligible(list[i]) && list[i].t < cutoff) shrink(i);
    // 2. force (storage full): younger blocks too, oldest first, until the records fit targetChars — never the last
    //    keepDays days or an open session
    if (opts.force && target) {
      var size = JSON.stringify(records).length - saved;
      if (size > target) {
        var keepFrom = t0 - keepDays * DAY, order = [];
        for (var j = 0; j < list.length; j++) if (eligible(list[j]) && list[j].t < keepFrom) order.push(j);
        order.sort(function (a, b) { return list[a].t - list[b].t || a - b; });
        for (var q = 0; q < order.length && size > target; q++) size -= shrink(order[q]);
      }
    }
    if (!n) return { records: records, compacted: 0, savedChars: 0 };
    var out = shallow(records);
    out.blocks = list;
    return { records: out, compacted: n, savedChars: saved };
  }

  // ---------- sessions: finished slots (CB-02) and stored plans (CB-14) ----------
  function finishedSlots(blocks) {
    var seen = {}, n = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || b.interrupted || !HF.derive.isTrainingBlock(b)) continue;
      var k = b.slotId != null ? 's:' + b.slotId : 'b:' + b.id;
      if (!seen[k]) { seen[k] = true; n++; }
    }
    return n;
  }
  var PLAN_KEYS = ['modeId', 'requestedMode', 'protocol', 'protocolLabel', 'caoArm', 'study', 'sessionIndex', 'phase', 'glyphs', 'estMinutes',
    'introduce', 'reflection', 'free', 'notes', 'counts'];
  var SLOT_KEYS = ['trackId', 'role', 'set', 'lessonId', 'unitId', 'unitTask', 'purpose', 'protocol', 'rung', 'strategyCard'];
  function copy(v) { return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; }
  function storedPlan(plan) {
    var p = {};
    PLAN_KEYS.forEach(function (k) { if (!absent(plan[k])) p[k] = copy(plan[k]); });
    p.slots = (plan.slots || []).map(function (s, i) {
      var o = {};
      if (s.slotId !== 'k' + i) o.slotId = s.slotId;
      SLOT_KEYS.forEach(function (k) {
        if (absent(s[k]) || (k === 'protocol' && s[k] === (plan.protocol || null)) || (k === 'role' && s[k] === 'rated')) return;
        o[k] = copy(s[k]);
      });
      return o;
    });
    return p;
  }
  function resumePlan(records, sessionId) {
    records = records || {};
    var s = (records.sessions || []).filter(function (x) { return x && x.id === sessionId; })[0];
    if (!s || s.endedAt != null || !s.plan || !Array.isArray(s.plan.slots)) return null;
    var sp = s.plan, C = HF.catalog;
    var plan = { id: s.id, modeId: sp.modeId || s.mode || 'varied', requestedMode: sp.requestedMode || sp.modeId || s.mode || 'varied',
      protocol: sp.protocol || null, study: copy(sp.study) || null, sessionIndex: isNum(sp.sessionIndex) ? sp.sessionIndex : s.sessionIndex,
      phase: sp.phase || 'none', glyphs: sp.glyphs || null, slots: [], estMinutes: sp.estMinutes || 0, introduce: copy(sp.introduce) || [],
      reflection: !!sp.reflection, free: !!sp.free, notes: copy(sp.notes) || [], counts: copy(sp.counts) || null, resumed: true };
    if (sp.protocolLabel) plan.protocolLabel = sp.protocolLabel;
    if (sp.caoArm) plan.caoArm = sp.caoArm;
    plan.slots = sp.slots.map(function (o, i) {
      var tid = o.trackId || null, def = tid ? C.get(tid) : null;
      var sl = { slotId: o.slotId || 'k' + i, index: i, trackId: tid, role: o.role || 'rated', taskId: def ? def.task : null,
        set: o.set || null, lessonId: o.lessonId || null, unitId: o.unitId || null, purpose: o.purpose || null,
        protocol: o.protocol !== undefined ? o.protocol : plan.protocol, modeId: plan.modeId, sessionIndex: plan.sessionIndex,
        phase: plan.phase, glyphs: plan.glyphs, strategyCard: copy(o.strategyCard) || null };
      if (o.unitTask) sl.unitTask = o.unitTask;
      if (isNum(o.rung)) sl.rung = o.rung;
      if (plan.study) sl.study = plan.study;
      return sl;
    });
    var done = {}, sb = sessionBlocksOf(records, sessionId);
    sb.forEach(function (b) {
      if (b.interrupted || b.slotId == null || !HF.derive.isTrainingBlock(b)) return;
      if (!done[b.slotId] || b.t >= done[b.slotId].t) done[b.slotId] = b;
    });
    if (plan.free) {
      // Free play picks versions at run time: slots already played (or attempted) keep their version, so
      // planner.freeSlot() does not hand them out again; slots added during the session come back too
      var byId = {};
      plan.slots.forEach(function (sl) { byId[sl.slotId] = sl; });
      sb.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (b) {
        if (b.slotId == null || !C.get(b.trackId)) return;
        var sl = byId[b.slotId];
        if (!sl) {
          sl = { slotId: b.slotId, index: plan.slots.length, trackId: null, role: 'free', taskId: null, set: null, lessonId: null, unitId: null,
            purpose: null, protocol: null, modeId: plan.modeId, sessionIndex: plan.sessionIndex, phase: plan.phase, glyphs: plan.glyphs, strategyCard: null };
          plan.slots.push(sl); byId[b.slotId] = sl;
        }
        if (!sl.trackId) { sl.trackId = b.trackId; sl.taskId = C.get(b.trackId).task; sl.rung = b.rung; sl.set = b.set || null; }
      });
    }
    return { plan: plan, done: done, session: s };
  }

  function sessionBlocksOf(records, sessionId) {
    var out = [], bl = records.blocks || [];
    for (var i = 0; i < bl.length; i++) if (bl[i] && bl[i].sessionId === sessionId) out.push(bl[i]);
    return out;
  }

  function beginSession(records, plan, opts) {
    opts = opts || {};
    var now = isNum(opts.now) ? opts.now : 0, G = HF.goals;
    var existing = (records.sessions || []).filter(function (s) { return s && s.id === plan.id; })[0];
    if (existing) return { records: records, session: existing };
    var session = {
      id: plan.id, startedAt: now, endedAt: null, dayKey: G.dayKey(now), mode: plan.modeId, protocol: plan.protocol || null,
      study: plan.study ? { template: plan.study.template, arm: plan.study.arm } : null, planned: plan.slots.length,
      completed: 0, counted: false, minutes: 0, endedBy: null, updatedAt: now, sessionIndex: plan.sessionIndex,
      plan: storedPlan(plan)
    };
    var out = shallow(records);
    out.sessions = (records.sessions || []).concat([session]);
    var intro = (plan.introduce || []).filter(function (tid) {
      return !(records.events || []).some(function (e) { return e && e.type === 'track-intro' && e.trackId === tid; });
    });
    if (intro.length) {
      out.events = (records.events || []).concat(intro.map(function (tid, i) {
        return { id: 'ev-' + plan.id + '-intro-' + i, t: now, type: 'track-intro', trackId: tid, sessionIndex: plan.sessionIndex };
      }));
    }
    return { records: out, session: session };
  }

  function revealFor(modeId) { var m = HF.modes.get(modeId); return m.feedback && m.feedback.revealAtEnd ? 'session-end' : 'now'; }

  function commit(records, bp, spec, result, opts) {
    opts = opts || {};
    records = records || {};
    var C = HF.catalog, P = HF.protocols, G = HF.goals;
    var now = isNum(opts.now) ? opts.now : 0;
    var t = isNum(opts.t) ? opts.t : (isNum(opts.startedAt) ? opts.startedAt : now);
    var d0 = opts.derived || derive(records, now);
    var sessionId = opts.sessionId || bp.sessionId;
    var trackId = bp.trackId, tr0 = d0.tracks[trackId];
    if (!tr0) throw new Error('engine.commit: unknown track ' + trackId);
    var res = result || {};
    var flag = !!opts.interrupted || !!res.interrupted || !!res.paused;
    var bad = HF.controller.isInterrupted(res, flag, bp.trackId);
    var sb = sessionBlocksOf(records, sessionId);
    var move, levelBefore;

    if (bp.role === 'protocol') {
      levelBefore = bp.rung;
      if (bp.protocol === 'cao') move = P.caoMove(res, bp.rung, flag);
      else if (bp.protocol === 'jaeggi') move = P.jaeggiMove(res, bp.rung, flag);
      else {
        var dk = G.dayKey(t), day = (records.blocks || []).filter(function (b) {
          return b && b.protocol === 'wang' && G.dayKey(b.t) === dk && !HF.controller.blockBad(b);
        });
        if (bad) move = { levelAfter: bp.rung, moved: 0, reason: 'interrupted' };
        else if (day.length + 1 === P.DEF.wang.blocksPerDay) {
          var acc = P.dayAccuracy(day.concat([{ result: compactResult(res) }]));
          move = P.wangDayMove(acc, bp.rung); move.dayAcc = acc;
        } else move = { levelAfter: bp.rung, moved: 0, reason: day.length + 1 > P.DEF.wang.blocksPerDay ? 'extra' : 'day-pending' };
      }
    } else {
      levelBefore = tr0.level;
      var downMoved = {};
      sb.forEach(function (b) { if (isNum(b.moved) && b.moved < 0) downMoved[b.trackId] = true; });
      move = HF.controller.next({
        trackId: trackId, level: tr0.level, rung: bp.rung, result: res, modeId: bp.modeId, role: bp.role, interrupted: flag,
        sessionState: { downMoved: downMoved },
        trackState: { placing: tr0.placing, offset: (tr0.offsets && tr0.offsets[bp.modeId]) || 0, capRung: isNum(bp.capRung) ? bp.capRung : null }
      });
    }

    var cres = compactResult(res);
    // lures actually generated (per stream; Dual/uncontrolled: mean over streams); the plan's setting stays in lurePlan
    var meta = spec && spec.meta, lc = bp.lureCount == null ? null : bp.lureCount, lures = null;
    if (meta && isNum(meta.lureCount)) lc = meta.lureCount;
    if (meta && meta.lures && typeof meta.lures === 'object') {
      lures = {}; var ks = Object.keys(meta.lures), sum = 0, nk = 0;
      ks.forEach(function (k) { if (isNum(meta.lures[k])) { lures[k] = meta.lures[k]; sum += meta.lures[k]; nk++; } });
      if (!(meta && isNum(meta.lureCount)) && nk) lc = Math.round(sum / nk);
      if (!nk) lures = null;
    }
    var block = {
      id: opts.id || ('b-' + sessionId + '-' + bp.slotId + '-' + (bp.attempt || 0)), sessionId: sessionId, t: t, trackId: trackId, set: bp.set,
      role: bp.role, mode: bp.modeId, protocol: bp.protocol || null, unitId: bp.unitId || null, purpose: bp.purpose || null, slotId: bp.slotId,
      seed: spec && typeof spec.seed === 'string' && spec.seed ? spec.seed : bp.seed, rung: bp.rung, rungParams: bp.params,
      lureCount: lc, lurePlan: bp.lureCount == null ? null : bp.lureCount, lureMode: bp.lureMode || 'controlled',
      levelBefore: levelBefore, levelAfter: move.levelAfter, moved: move.moved, reason: move.reason,
      result: cres, interrupted: flag, voidedRatio: isNum(res.voidedRatio) ? res.voidedRatio : 0,
      frame: opts.frame || null, study: bp.study ? bp.study.arm : null, attempt: bp.attempt || 0,
      capRung: isNum(bp.capRung) ? bp.capRung : null, targets: isNum(bp.targets) ? bp.targets : null,
      endedAt: now, durationMs: now > t ? now - t : null
    };
    if (lures) block.lures = lures;
    if (spec && spec.meta && spec.meta.fallback) block.specFallback = spec.meta.fallback;
    block = slimBlock(block);

    var out = shallow(records);
    out.blocks = (records.blocks || []).concat([block]);
    var newEventRecords = [];
    // Mastery check: after the second check block of a unit in this session
    if (bp.purpose === 'check' && bp.unitId && !bad) {
      var checks = sb.filter(function (b) { return b.purpose === 'check' && b.unitId === bp.unitId && !HF.controller.blockBad(b); }).concat([block]);
      var need = HF.modes.get('mastery').checkBlocks;
      if (checks.length === need) {
        var m = 0; checks.forEach(function (b) { m += b.result.ba; }); m /= checks.length;
        newEventRecords.push({ id: 'ev-' + block.id + '-mc', t: t + 1, type: 'mastery-check', unitId: bp.unitId, ba: m, pass: m >= HF.modes.get('mastery').checkPass - 1e-9, sessionId: sessionId });
      }
    }
    if (newEventRecords.length) out.events = (records.events || []).concat(newEventRecords);
    // keep the session record's progress current
    if (records.sessions) {
      out.sessions = records.sessions.map(function (s) {
        if (!s || s.id !== sessionId) return s;
        var c = shallow(s); c.completed = finishedSlots(sb.concat([block])); c.updatedAt = Math.max(now, s.updatedAt || 0); return c;
      });
    }

    var d1 = derive(out, now);
    var ev = [];
    var reveal = revealFor(bp.modeId);
    if (move.moved > 0 || move.moved < 0) {
      ev.push({ type: move.moved > 0 ? 'level-up' : 'level-down', trackId: trackId, protocol: bp.protocol || null, from: levelBefore, to: move.levelAfter,
        fromLabel: C.levelLabel(trackId, levelBefore), toLabel: C.levelLabel(trackId, move.levelAfter), reveal: bp.protocol === 'wang' ? 'session-end' : reveal });
    }
    if (!bp.protocol && tr0.peak >= 0 && d1.tracks[trackId].peak > tr0.peak)
      ev.push({ type: 'pb', kind: 'peak', trackId: trackId, rung: d1.tracks[trackId].peak, label: C.levelLabel(trackId, d1.tracks[trackId].peak), reveal: reveal });
    HF.badges.diff(d0.badges, d1.badges).forEach(function (id) { var bd = HF.badges.get(id); ev.push({ type: 'badge', badgeId: id, label: bd ? bd.label : id, reveal: 'session-end' }); });
    // mastery
    Object.keys(d1.mastery.units).forEach(function (uid) {
      var a = d0.mastery.units[uid], b = d1.mastery.units[uid];
      if (a.status === 'open' && b.status === 'pending-check') ev.push({ type: 'unit-passed', unitId: uid, stage: 'criterion', label: b.label, reveal: 'now' });
      if (b.checks.length > a.checks.length) {
        var last = b.checks[b.checks.length - 1];
        if (last.pass) ev.push({ type: 'unit-passed', unitId: uid, stage: 'check', label: b.label, ba: last.ba, reveal: 'now' });
        else ev.push({ type: 'check-failed', unitId: uid, label: b.label, ba: last.ba, failedChecks: b.failedChecks, movedOn: b.status === 'moved-on', reveal: 'now' });
      }
    });
    // availability
    C.ids().forEach(function (tid) {
      var a0 = d0.tracks[tid], a1 = d1.tracks[tid], tr = C.get(tid);
      var opened = (!a0.available && a1.available) || (tr.tier === 8 && !a0.ladderOpen && a1.ladderOpen);
      if (!opened) return;
      if (tr.tier) ev.push({ type: 'tier-open', trackId: tid, tier: tr.tier, optional: tr.tier === 8 && !a1.available, label: tr.name, reveal: reveal });
      else ev.push({ type: 'track-available', trackId: tid, label: tr.name, reveal: reveal });
    });
    // fatigue: fires once, the first time two consecutive rated blocks fall .15 below the first two
    if (bp.role === 'rated' && !bad) {
      var bas = sb.filter(function (b) { return b.role === 'rated' && !HF.controller.blockBad(b); }).map(function (b) { return b.result.ba; });
      var before = false;
      for (var k = 4; k <= bas.length; k++) if (HF.controller.fatigue(bas.slice(0, k))) { before = true; break; }
      bas.push(cres.ba);
      if (!before && HF.controller.fatigue(bas)) ev.push({ type: 'fatigue', sessionId: sessionId, reveal: 'now' });
    }
    Object.keys((d0.assist && d0.assist.tracks) || {}).forEach(function (tid) {
      var a0 = d0.assist.tracks[tid], a1 = d1.assist.tracks[tid];
      if (a0.active && a1 && !a1.active) ev.push({ type: 'assist-faded', trackId: tid, lessonId: C.get(tid).lessonId, reveal: 'now' });
    });
    return { records: out, events: ev, block: block, derived: d1 };
  }

  /** Active minutes of a session: each block's duration (measured start → commit, capped at twice its nominal
   *  length + 2 min; else the nominal length) plus the gaps around blocks, each gap capped at 2 min, so a session
   *  resumed hours later or left open does not count the time away. */
  var GAP_CAP = 120000;
  function blockMs(b) {
    var C = HF.catalog, nominal = C.estBlockMs(b.trackId, b.rungParams && isNum(b.rungParams.soaMs || b.rungParams.windowMs || b.rungParams.changeMs || b.rungParams.setSize) ? b.rungParams : C.params(b.trackId, b.rung || 0));
    if (!isNum(nominal)) nominal = 90000;
    return isNum(b.durationMs) && b.durationMs > 0 ? Math.min(b.durationMs, 2 * nominal + GAP_CAP) : nominal;
  }
  function sessionMinutes(s0, blocks, now) {
    var bl = blocks.slice().sort(function (a, b) { return a.t - b.t; }), total = 0, prevEnd = s0.startedAt;
    for (var i = 0; i < bl.length; i++) {
      var d = blockMs(bl[i]);
      total += Math.min(Math.max(0, bl[i].t - prevEnd), GAP_CAP) + d;
      prevEnd = Math.max(prevEnd, bl[i].t + d);
    }
    total += Math.min(Math.max(0, now - prevEnd), GAP_CAP);
    return Math.round(total / 6000) / 10;
  }

  function endSession(records, sessionId, opts) {
    opts = opts || {};
    var now = isNum(opts.now) ? opts.now : 0, C = HF.catalog, G = HF.goals;
    var s0 = (records.sessions || []).filter(function (s) { return s && s.id === sessionId; })[0];
    if (!s0) return { records: records, events: [], derived: derive(records, now), session: null };
    var d0 = derive(records, now);
    var sb = sessionBlocksOf(records, sessionId).filter(function (b) { return HF.derive.isTrainingBlock(b); });
    var s1 = shallow(s0);
    s1.completed = finishedSlots(sb);
    s1.endedAt = now; s1.endedBy = opts.endedBy || (s1.completed >= s0.planned ? 'done' : 'quit');
    delete s1.plan;   // the stored plan is only needed while the session is open (CB-14)
    s1.minutes = isNum(opts.minutes) && opts.minutes >= 0 ? Math.round(opts.minutes * 10) / 10 : sessionMinutes(s0, sb, now);
    s1.updatedAt = Math.max(now, s0.updatedAt || 0);
    var out = shallow(records);
    out.sessions = records.sessions.map(function (s) { return s && s.id === sessionId ? s1 : s; });
    var d1 = derive(out, now);
    s1.counted = !!d1.counted[sessionId];
    var ev = [{ type: 'session-counted', counted: s1.counted, reason: d1.countedWhy[sessionId] || null }];
    // the session that brings the week's count exactly to the target (an in-progress session already counts in d0)
    if (s1.counted && d1.week.target > 0 && d1.week.count === d1.week.target && G.weekKey(s0.dayKey || s0.startedAt) === d1.week.weekKey)
      ev.push({ type: 'week-goal', count: d1.week.count, target: d1.week.target });
    if (s0.mode === 'stretch' && d1.stretch.valve.active && d1.stretch.valve.sessions.length && d1.stretch.valve.sessions[d1.stretch.valve.sessions.length - 1].id === sessionId)
      ev.push({ type: 'stretch-valve', text: 'Your last two Stretch sessions averaged under 62 %. Varied or Mastery Path may suit you better for now.' });
    if (s0.protocol === 'cao') {
      var key = sb.length && sb[0].trackId === HF.protocols.DEF.cao.tradTrackId ? 'caoTrad' : 'cao';
      if (!d0.protocols[key].complete && d1.protocols[key].complete) ev.push({ type: 'protocol-complete', protocol: 'cao', followupFrom: d1.protocols[key].followup.from });
    }
    if (s0.protocol === 'wang') {
      var w = d1.protocols.wang;
      if (!d0.protocols.wang.complete && w.complete) ev.push({ type: 'protocol-complete', protocol: 'wang' });
      var today = w.days.length ? w.days[w.days.length - 1] : null;
      if (today && today.complete && today.dayKey === G.dayKey(now)) {
        ev.push({ type: 'wang-day', acc: today.acc, levelBefore: today.level, levelAfter: w.level, label: C.levelLabel('rel.steps', 2 * w.level) });
      }
    }
    if (HF.modes.get(s0.mode).feedback.revealAtEnd) {
      var changes = {};
      sb.forEach(function (b) {
        if (!HF.derive.levelMoving(b)) return;
        var c = changes[b.trackId] || (changes[b.trackId] = { trackId: b.trackId, from: b.levelBefore, to: b.levelAfter });
        c.to = b.levelAfter;
      });
      var list = Object.keys(changes).map(function (k) { var c = changes[k]; c.fromLabel = C.levelLabel(k, c.from); c.toLabel = C.levelLabel(k, c.to); return c; });
      ev.push({ type: 'levels-revealed', changes: list });
    }
    HF.badges.diff(d0.badges, d1.badges).forEach(function (id) { var bd = HF.badges.get(id); ev.push({ type: 'badge', badgeId: id, label: bd ? bd.label : id }); });
    out.sessions = out.sessions.map(function (s) { return s && s.id === sessionId ? s1 : s; });
    return { records: out, events: ev, derived: d1, session: s1 };
  }

  var api = HF.engine || {};
  api.version = VERSION;
  api.derive = derive;
  api.plan = function (records, derived, opts) { return HF.planner.plan(records, derived, opts); };
  api.prepare = function (slot, records, derived, ss) { return HF.planner.prepare(slot, records, derived, ss); };
  api.beginSession = beginSession;
  api.commit = commit;
  api.endSession = endSession;
  api.compactResult = compactResult;
  api.compactRecords = compactRecords;
  api.resumePlan = resumePlan;
  api.finishedSlots = finishedSlots;
  api.newRecords = newRecords;
  HF.engine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
