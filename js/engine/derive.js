/* Long-Horizon — derive the whole training state from the records (pure, no DOM). MIT licence.
 *
 * SPEC §3: records are the source of truth; everything here is recomputed by replaying them, so two-tab
 * merges and imports stay consistent. Must take ≤ 50 ms for 5,000 blocks (tests/sim/derive-perf.mjs).
 *
 * HF.engine.derive(records, now) → Derived
 *   {
 *     now, settings (defaults merged), mode: { requested, effective },
 *     tracks: { [trackId]: {
 *        level, levelLabel, peak (−1 = never moved), peakLabel, available, ladderOpen, introduced,
 *        ratedBlocks, blocks, lastPlayedAt, firstAt, placing, offsets: { modeId: offset }, offset,
 *        zone: { last: [ba ≤ 3, oldest first], U, D, target, qualifying? }, levelEq, levelEqText, predicted, setLast: { setId: t },
 *        blockMs: median measured duration of the track's last ≤ 20 finished blocks (≥ 3 needed, else null; Phase 4) } },
 *     model,                                  // HF.learner model replayed from the blocks
 *     counters: { sessions, sessionsCounted, blocks, minutes, trials, labVisits, lessonsPassed },
 *     pbs: { [trackId]: { peak, peakAt, peakLabel, bestBA: { rung: ba } } },
 *     week,                                   // HF.goals.week(...)
 *     today: { dayKey, weekKey, canCount: { ok, reason } },
 *     badges: { [badgeId]: earnedAt }, badgesUnseen: [badgeId],
 *     mastery,                                // HF.mastery.state(...)
 *     protocols: { cao, caoTrad, wang, jaeggi },  // HF.protocols.state(...)
 *     lab: { status: { B1, B2, Q, POST, FU, X: endedAt|null, visits, lastVisitAt, baselinesDone } },
 *     sessionsCounted, sessionIndex (= counted + 1), counted: { [sessionId]: true }, countedList,
 *     programme: { done, of: 20, complete },
 *     stretch: { open, valve: { active, sessions: [{ id, mean }], firedAt } },
 *     study: null | { template, arm, enrolledAt, drawnAt, left },   (template: a 'study-code' event's code decides it; left: t of
 *       a 'study-leave' event or null — once set, the planner ignores the arm and vs.search/Span gates revert)
 *     assist: { active (any track), trackId, atCriterion, needed: 2, tracks: { [trackId]: { start, atCriterion, active } } },
 *     soundOff: bool (settings.sound === 'off': Dual and audio sets are not scheduled; tracks['nback.dual'].blockedBy = 'sound'), lessons: { passed: {lessonId: t}, failed: {lessonId: n} },
 *     modelBlocks, sessionBlocks: { sessionId: n }
 *   }
 * Also: HF.derive.normalizeSettings(settings), HF.derive.DEFAULT_SETTINGS, HF.derive.isTrainingBlock(b),
 *       HF.derive.levelMoving(b), HF.derive.sortByT(arr).
 *
 * Optional settings read by the engine (not in SPEC §3.1): gridT8 (bool, opt into Relation Grid T8),
 * sprint: { nback: trackId } (Sprint's fixed n-back version), caoArm: 'exec'|'trad'.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var DAY = 86400000;

  var DEFAULT_SETTINGS = {
    mode: 'varied', sessionMinutes: 25, weeklyTarget: 4, balance: { nback: 50, relations: 50, span: 0 }, spanOn: false,
    sound: 'tones', volume: 0.8, audioOffsetMs: 0,
    keys: { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' },
    perResponseFeedback: null, focusMode: false, theme: 'system', largeText: false,
    leftHanded: false, reducedMotion: null, protocols: { cao: true, wang: true, jaeggi: false },
    includeLevelsInShare: false, labConfig: 'standard', dual: false, freePace: 'std',
    gridT8: false, sprint: { nback: 'nback.plain' }, caoArm: 'exec'
  };
  var NEST = ['balance', 'keys', 'protocols', 'sprint'];

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  function normalizeSettings(s) {
    var out = copy(DEFAULT_SETTINGS);
    NEST.forEach(function (k) { out[k] = copy(DEFAULT_SETTINGS[k]); });
    if (s && typeof s === 'object') {
      for (var k in s) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
        if (NEST.indexOf(k) >= 0 && s[k] && typeof s[k] === 'object') { var src = s[k]; for (var j in src) if (Object.prototype.hasOwnProperty.call(src, j)) out[k][j] = src[j]; }
        else out[k] = s[k];
      }
    }
    if (!HF.modes.exists(out.mode)) out.mode = 'varied';
    out.sessionMinutes = Math.max(10, Math.min(30, isNum(out.sessionMinutes) ? out.sessionMinutes : 25));
    return out;
  }

  function sortByT(arr) {
    arr = arr || [];
    var sorted = true;
    for (var i = 1; i < arr.length; i++) {
      var a = arr[i - 1], b = arr[i];
      if (!a || !b || a.t > b.t) { sorted = false; break; }
    }
    if (sorted) return arr;
    return arr.filter(function (x) { return x && isNum(x.t); }).slice().sort(function (a, b) { return a.t - b.t || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
  }

  var NON_TRAINING = { tutorial: 1, probe: 1 };
  function isTrainingBlock(b) { return !!b && !NON_TRAINING[b.role] && !!HF.catalog.get(b.trackId); }
  function interrupted(b) { return HF.controller.blockBad(b); }
  /** Finished slots per session (CB-02): distinct slots with a training block that was not interrupted; a block
   *  without slotId counts on its own. (A separate pass keeps derive's main loop small and fast.) */
  function finishedSlotsPerSession(blocks) {
    var per = {}, seen = {};
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (!b || b.interrupted || !isTrainingBlock(b)) continue;
      var s = seen[b.sessionId] || (seen[b.sessionId] = {}), k = b.slotId != null ? b.slotId : '#' + b.id;
      if (s[k] !== 1) { s[k] = 1; per[b.sessionId] = (per[b.sessionId] || 0) + 1; }
    }
    return per;
  }
  function medianOf(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  /** Hits an assisted block needs (the lesson check): Relation Grid 7 of 10 targets, every other version 4 of 6. */
  function assistBar(trackId) { var tr = HF.catalog.get(trackId); return tr && tr.tier ? 7 : 4; }
  function levelMoving(b) {
    if (b.protocol) return false;
    if (b.role === 'rated') return true;
    return b.role === 'free' && b.reason !== 'off-level' && b.rung === b.levelBefore;
  }
  function nItems(b) {
    var r = b.result || {};
    if (isNum(r.n)) return r.n;
    var s = r.streams, n = 0;
    if (s) for (var k in s) { var x = s[k]; if (x) { n = (x.h || 0) + (x.m || 0) + (x.fa || 0) + (x.cr || 0); break; } }
    return n;
  }
  /** A coordinator code → { arm, template|null } (template from the code itself: Phase 4, CB-03), or null. */
  function decodeStudyCode(code) {
    try {
      if (HF.study && typeof HF.study.decodeCode === 'function') {
        var r = HF.study.decodeCode(code);
        if (typeof r === 'string') return { arm: r, template: null };
        if (r && r.arm) return { arm: r.arm, template: r.template || null };
      }
    } catch (e) { /* undecodable */ }
    return null;
  }

  function derive(records, now) {
    records = records || {};
    var C = HF.catalog, L = HF.learner, G = HF.goals;
    now = isNum(now) ? now : (isNum(records.updatedAt) ? records.updatedAt : 0);
    var settings = normalizeSettings(records.settings);
    var ids = C.ids();
    var blocks = sortByT(records.blocks);
    var events = sortByT(records.events);

    // ---- events ----
    var lessonPassed = {}, lessonFailed = {}, intro = {}, overrides = [], firstNoteAt = null, study = null, acked = {}, assistStart = {}, failAt = {};
    for (var ei = 0; ei < events.length; ei++) {
      var e = events[ei]; if (!e) continue;
      switch (e.type) {
        case 'lesson-passed': if (e.lessonId && !isNum(lessonPassed[e.lessonId])) lessonPassed[e.lessonId] = e.t; break;
        case 'lesson-failed': if (e.lessonId) { lessonFailed[e.lessonId] = (lessonFailed[e.lessonId] || 0) + 1; if (lessonFailed[e.lessonId] === 2) failAt[e.lessonId] = e.t; } break;
        case 'track-intro': if (e.trackId && !isNum(intro[e.trackId])) intro[e.trackId] = e.t; break;
        case 'override': if (C.get(e.trackId) && isNum(e.level)) overrides.push(e); break;
        case 'note': if (firstNoteAt == null && e.text && String(e.text).trim()) firstNoteAt = e.t; break;
        case 'study-enrol': study = { template: e.template || 'default', arm: null, enrolledAt: e.t, drawnAt: null, left: null }; break;
        case 'study-draw': if (!study) study = { template: e.template || 'default', arm: null, enrolledAt: e.t, drawnAt: null, left: null }; if (e.arm) { study.arm = e.arm; study.drawnAt = e.t; } break;
        case 'study-code': {
          var sc = decodeStudyCode(e.code);
          if (sc) {
            if (!study) study = { template: 'default', arm: null, enrolledAt: e.t, drawnAt: null, left: null };
            if (sc.template) study.template = sc.template;   // the coordinator's code decides the template
            study.arm = sc.arm; study.drawnAt = e.t;
          }
          break;
        }
        case 'study-leave': if (study && study.left == null) study.left = e.t; break;   // records stay; a new 'study-enrol' starts afresh
        case 'badge-ack': if (e.badgeId) acked[e.badgeId] = true; break;
        case 'assist-start': { var at0 = C.get(e.trackId) ? e.trackId : 'nback.plain'; if (!assistStart[at0]) assistStart[at0] = e.t; break; }
        default: break;
      }
    }

    // ---- assisted starts per track: 'assist-start {trackId}' events, or (older data) two failed lesson checks ----
    [['lesson.nback', 'nback.plain'], ['lesson.grid', 'rel.grid.T1']].forEach(function (lt) {
      if (!assistStart[lt[1]] && isNum(failAt[lt[0]]) && !(isNum(lessonPassed[lt[0]]) && lessonPassed[lt[0]] < failAt[lt[0]])) assistStart[lt[1]] = failAt[lt[0]];
    });
    var assistOk = {};

    // ---- replay blocks ----
    var T = {};
    ids.forEach(function (id) {
      T[id] = { level: null, peak: -1, peakAt: null, ratedBlocks: 0, blocks: 0, lastPlayedAt: null, firstAt: null, placing: true,
        recent: [], offsets: {}, offAcc: {}, setLast: {}, reach: {}, bestBA: {}, protoPeak: -1, durs: [] };
    });
    var model = L.create();
    var oi = 0;
    function applyOverrides(upTo) {
      while (oi < overrides.length && overrides[oi].t <= upTo) {
        var o = overrides[oi++], st = T[o.trackId];
        st.level = Math.max(0, Math.min(C.maxRung(o.trackId), Math.round(o.level))); st.placing = false;
      }
    }
    var perSession = {}, protoBlocks = [], unitBlocks = [], setFirst = {}, nReach = {}, firstBlock = {};
    var prevTrainT = null, comebackAt = null, minutesMs = 0, trials = 0, trainingBlocks = 0, modelBlocks = 0;
    var sessionRated = {};

    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (!isTrainingBlock(b)) continue;
      applyOverrides(b.t);
      var id = b.trackId, st = T[id], tr = C.get(id);
      trainingBlocks++;
      perSession[b.sessionId] = (perSession[b.sessionId] || 0) + 1;
      trials += nItems(b);
      var est = C.estBlockMs(id, b.rungParams && isNum(b.rungParams.soaMs || b.rungParams.windowMs || b.rungParams.changeMs || b.rungParams.setSize) ? b.rungParams : C.params(id, b.rung || 0));
      if (isNum(est)) minutesMs += isNum(b.durationMs) && b.durationMs > 0 ? Math.min(b.durationMs, 2 * est + 120000) : est;
      st.blocks++;
      if (!b.interrupted && isNum(b.durationMs) && b.durationMs > 0) { st.durs.push(b.durationMs); if (st.durs.length > 20) st.durs.shift(); }
      if (!isNum(st.firstAt)) { st.firstAt = b.t; firstBlock[id] = b.t; }
      st.lastPlayedAt = b.t;
      if (b.set) {
        st.setLast[b.set] = b.t;
        var ns = C.normSet(b.set);
        if (!isNum(setFirst[ns])) setFirst[ns] = b.t;
      }
      if (prevTrainT != null && b.t - prevTrainT >= 14 * DAY && comebackAt == null) comebackAt = b.t;
      prevTrainT = b.t;
      if (b.role === 'assist') {
        var ms = b.result && b.result.streams && (b.result.streams.main || b.result.streams[Object.keys(b.result.streams)[0]]);
        // the lesson checks' criterion: n-back ≥ 4 of 6 targets, Grid ≥ 7 of 10; at most 2 false presses. The bar
        // follows the track, not the counted targets (a voided target must not lower a Grid bar to 4: CA-09)
        if (ms && !interrupted(b) && ms.h >= assistBar(id) && ms.fa <= 2 && (!isNum(assistStart[id]) || b.t >= assistStart[id])) assistOk[id] = (assistOk[id] || 0) + 1;
        continue;
      }
      if (L.updatesModel(b)) { L.update(model, b); modelBlocks++; }
      var bad = interrupted(b);
      if (b.protocol) {
        protoBlocks.push(b);
        if (!bad && isNum(b.levelAfter)) {
          if (b.levelAfter > st.protoPeak) st.protoPeak = b.levelAfter;
          if (tr.task === 'nback') {
            var pn = C.nOf(id, b.levelAfter);
            for (var q = 1; q <= pn; q++) if (!isNum(nReach[q])) nReach[q] = b.t;
          }
        }
        continue;
      }
      if (b.unitId) unitBlocks.push(b);
      if (!levelMoving(b) || bad || !isNum(b.levelAfter)) continue;
      var wasPlacing = st.placing;
      st.level = b.levelAfter;
      st.ratedBlocks++;
      if ((isNum(b.moved) && b.moved < 0) || (isNum(b.levelBefore) && b.levelAfter < b.levelBefore && b.reason === 'down')) st.placing = false;
      if (b.levelAfter > st.peak) {
        for (var rr = Math.max(0, st.peak + 1); rr <= b.levelAfter; rr++) st.reach[rr] = b.t;
        st.peak = b.levelAfter; st.peakAt = b.t;
      }
      if (tr.task === 'nback') {
        var nn = C.nOf(id, b.levelAfter);
        for (var q2 = 1; q2 <= nn; q2++) if (!isNum(nReach[q2])) nReach[q2] = b.t;
      }
      var ba = b.result.ba;
      st.recent.push(ba); if (st.recent.length > 3) st.recent.shift();
      if (b.role === 'rated') {
        if (!isNum(st.bestBA[b.rung]) || ba > st.bestBA[b.rung]) st.bestBA[b.rung] = ba;
        (sessionRated[b.sessionId] || (sessionRated[b.sessionId] = [])).push(ba);
      }
      // self-correction (SPEC §6): every 10 rated blocks per track and mode, outside placement, free to move
      if (tr.scale !== 'recall' && !wasPlacing && b.reason !== 'capped' && b.reason !== 'below-level' && b.reason !== 'top' && b.reason !== 'bottom') {
        var mid = b.mode || 'varied', tgt = HF.modes.target(mid === 'protocols' ? 'varied' : mid);
        if (isNum(tgt)) {
          var acc = st.offAcc[mid] || (st.offAcc[mid] = { n: 0, sum: 0 });
          acc.n++; acc.sum += ba;
          if (acc.n >= HF.modes.OFFSET_EVERY) {
            st.offsets[mid] = HF.controller.selfCorrect(st.offsets[mid] || 0, acc.sum / acc.n, tgt);
            acc.n = 0; acc.sum = 0;
          }
        }
      }
    }
    applyOverrides(Infinity);

    // ---- sessions, counting, week ----
    var sessions = records.sessions || [];
    var counting = G.countSessions(sessions, finishedSlotsPerSession(blocks));   // "half of the planned blocks" = finished slots
    var sessionsCounted = counting.list.length;
    var stretchOpen = sessionsCounted >= HF.modes.get('stretch').opensAfter;
    var effMode = settings.mode === 'stretch' && !stretchOpen ? 'varied' : settings.mode;
    var week = G.week(counting.list, { now: now, settings: settings, modeId: settings.mode, events: events });

    // ---- study ----
    if (study && study.arm === 'labonly') { /* no training */ }

    // ---- availability ----
    var peak = {}, protocolPeak = {};
    ids.forEach(function (id2) { peak[id2] = T[id2].peak; protocolPeak[id2] = T[id2].protoPeak; });
    var activeStudy = study && study.left == null ? study : null;   // after 'study-leave' the study no longer gates anything
    var gctx = { peak: peak, protocolPeak: protocolPeak, lessons: lessonPassed, settings: settings, study: activeStudy };
    var inStudy = !!(activeStudy && activeStudy.arm), soundOff = settings.sound === 'off';

    // ---- per-track output ----
    var tracks = {}, pbs = {};
    var modeDef = HF.modes.get(effMode);
    ids.forEach(function (id3) {
      var s = T[id3], tr3 = C.get(id3);
      var available = C.gateOpen(id3, gctx), blockedBy = null;
      if (tr3.task === 'span' && inStudy) available = false;
      if (soundOff && tr3.dualVisual) { blockedBy = available ? 'sound' : null; available = false; }
      var level = s.level;
      if (!isNum(level)) level = L.placement(model, id3, modeDef.target || 0.8, effMode === 'protocols' ? 'varied' : effMode, null);
      var off = s.offsets[effMode] || 0, leq = L.levelEquivalent(model, id3);
      var th = HF.modes.thresholds(effMode === 'protocols' ? 'varied' : effMode, off);
      tracks[id3] = {
        level: level, levelLabel: C.levelLabel(id3, level), peak: s.peak, peakLabel: s.peak >= 0 ? C.levelLabel(id3, s.peak) : null,
        available: available, blockedBy: blockedBy, ladderOpen: C.ladderGateOpen(id3, gctx), introduced: isNum(intro[id3]) || s.blocks > 0,
        ratedBlocks: s.ratedBlocks, blocks: s.blocks, lastPlayedAt: s.lastPlayedAt, firstAt: s.firstAt, placing: s.placing,
        offsets: s.offsets, offset: off,
        zone: { last: s.recent.slice(), U: tr3.scale === 'recall' ? modeDef.spanUp : th.U, D: tr3.scale === 'recall' ? modeDef.spanDown : th.D, target: modeDef.target },
        levelEq: leq, levelEqText: L.levelEquivalentText(model, id3, null, leq),
        predicted: L.predictBA(model, id3, level, null), setLast: s.setLast, reach: s.reach,
        blockMs: s.durs.length >= 3 ? medianOf(s.durs) : null
      };
      if (s.blocks > 0) pbs[id3] = { peak: s.peak, peakAt: s.peakAt, peakLabel: tracks[id3].peakLabel, bestBA: s.bestBA };
    });

    // ---- mastery, protocols ----
    var endedSessions = {};
    for (var es = 0; es < sessions.length; es++) if (sessions[es] && sessions[es].endedAt != null) endedSessions[sessions[es].id] = true;
    var mastery = HF.mastery.state(unitBlocks, events, now, { skipTracks: soundOff ? { 'nback.dual': true } : null, endedSessions: endedSessions });
    if (effMode === 'mastery') ['nback', 'relations'].forEach(function (task) {
      var u = mastery.current[task] && mastery.units[mastery.current[task]];
      if (u && tracks[u.trackId]) tracks[u.trackId].zone.qualifying = u.qualifying.slice();
    });
    var protocols = HF.protocols.state(protoBlocks, now);

    // ---- Stretch safety valve ----
    var valve = { active: false, sessions: [], firedAt: null };
    var stretchSessions = sessions.filter(function (s) { return s && s.mode === 'stretch' && !s.protocol && sessionRated[s.id] && sessionRated[s.id].length >= 2; })
      .sort(function (a, b) { return a.startedAt - b.startedAt; });
    var run = 0, sv = HF.modes.get('stretch');
    stretchSessions.forEach(function (s) {
      var arr = sessionRated[s.id], m = 0; for (var i = 0; i < arr.length; i++) m += arr[i]; m /= arr.length;
      valve.sessions.push({ id: s.id, mean: m });
      run = m < sv.valveBA ? run + 1 : 0;
      if (run >= sv.valveSessions && valve.firedAt == null) valve.firedAt = s.startedAt;
      valve.active = run >= sv.valveSessions;
    });
    if (valve.sessions.length > 6) valve.sessions = valve.sessions.slice(-6);

    // ---- Lab status ----
    var lab = { B1: null, B2: null, Q: null, POST: null, FU: null, X: null, visits: 0, lastVisitAt: null, baselinesDone: false };
    (records.labVisits || []).forEach(function (v) {
      if (!v) return;
      var end = isNum(v.endedAt) ? v.endedAt : null;
      if (end != null) { lab.visits++; if (lab[v.kind] === null || lab[v.kind] === undefined || end < lab[v.kind]) lab[v.kind] = end; }
      var t = end != null ? end : v.startedAt;
      if (isNum(t) && (lab.lastVisitAt == null || t > lab.lastVisitAt)) lab.lastVisitAt = t;
    });
    lab.baselinesDone = isNum(lab.B1) && isNum(lab.B2);

    // ---- badges ----
    var explorerSets = [];
    HF.badges.EXPLORER_TRACKS.forEach(function (id4) { C.trainingSets(id4).forEach(function (s) { if (explorerSets.indexOf(s) < 0) explorerSets.push(s); }); });
    var reach = {}; ids.forEach(function (id5) { reach[id5] = T[id5].reach; });
    var badges = HF.badges.compute({
      lessonPassed: lessonPassed, nReach: nReach, firstBlock: firstBlock, reach: reach, setFirst: setFirst, explorerSets: explorerSets,
      labEnded: { B1: lab.B1, B2: lab.B2, POST: lab.POST, FU: lab.FU }, comebackAt: comebackAt, firstNoteAt: firstNoteAt
    });

    // ---- assist, per track: from its start until 2 assisted blocks reach the check criterion (or its lesson is passed) ----
    var assist = { active: false, trackId: null, atCriterion: 0, needed: 2, tracks: {} };
    Object.keys(assistStart).forEach(function (tid) {
      var lid = C.get(tid).lessonId, passedAfter = isNum(lessonPassed[lid]) && lessonPassed[lid] >= assistStart[tid];
      var a = { start: assistStart[tid], atCriterion: assistOk[tid] || 0, active: false };
      a.active = a.atCriterion < 2 && !passedAfter;
      assist.tracks[tid] = a;
      if (a.active && !assist.active) { assist.active = true; assist.trackId = tid; assist.atCriterion = a.atCriterion; }
    });

    var sessionsWithBlocks = 0; for (var sk in perSession) if (perSession[sk] > 0) sessionsWithBlocks++;
    return {
      now: now, settings: settings, mode: { requested: settings.mode, effective: effMode },
      tracks: tracks, model: model,
      counters: { sessions: sessionsWithBlocks, sessionsCounted: sessionsCounted, blocks: trainingBlocks, minutes: Math.round(minutesMs / 60000),
        trials: trials, labVisits: lab.visits, lessonsPassed: Object.keys(lessonPassed).length },
      pbs: pbs, week: week,
      today: { dayKey: G.dayKey(now), weekKey: G.weekKey(now), canCount: G.canCountNow(counting.list, now, effMode) },
      badges: badges, badgesUnseen: Object.keys(badges).filter(function (k) { return !acked[k]; }),
      mastery: mastery, protocols: protocols, lab: { status: lab },
      sessionsCounted: sessionsCounted, sessionIndex: sessionsCounted + 1, counted: counting.counted, countedList: counting.list, countedWhy: counting.why,
      programme: { done: Math.min(20, sessionsCounted), of: 20, complete: sessionsCounted >= 20 },
      stretch: { open: stretchOpen, valve: valve },
      study: study, assist: assist, soundOff: soundOff, lessons: { passed: lessonPassed, failed: lessonFailed },
      modelBlocks: modelBlocks, sessionBlocks: perSession
    };
  }

  var api = { derive: derive, normalizeSettings: normalizeSettings, DEFAULT_SETTINGS: DEFAULT_SETTINGS, isTrainingBlock: isTrainingBlock, levelMoving: levelMoving, sortByT: sortByT,
    assistBar: assistBar };
  HF.derive = api;
  (HF.engine || (HF.engine = {})).derive = derive;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
