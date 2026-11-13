/* Long-Horizon — Mastery Path (pure, no DOM). MIT licence.
 *
 * PLAN §5 Mastery Path and research/03 §5.5:
 *   - Units = (version, target level) on a fixed path. n-back and Relations units run in parallel
 *     ("each session works on 1 unit per task"), each task in path order.
 *   - Inside a unit the normal controller runs (U .87 / D .73, SPEC §6) capped at the target rung.
 *   - Criterion: 2 of the last 3 rated unit blocks at the target rung with BA ≥ .87 on n-back and Equal Steps units
 *     (above the .857 approximate-responder bound, SPEC §4.6; Phase 4) or ≥ .85 on Relation Grid units → "pending check".
 *   - Check: in a later session on a later day, 2 blocks at the target on fresh material; mean BA ≥ .80
 *     passes (event 'mastery-check' {unitId, ba, pass}, written by HF.engine.commit). A failed check is
 *     followed, in the same session, by a corrective cycle (half the remaining blocks one rung below the
 *     target, then at the target) and a retest next session. After 3 failed checks: "moved on" (flagged).
 *   - Reviews: one block 2, 7 and 21 days after the pass (gaps 2 + 5 + 14 days from the previous review),
 *     at most one per task per session; a review BA < .75 reopens the unit for one session.
 *   - Units show "passed", never "mastered". After a task's last unit: "moved on" to maintenance.
 * The PATH below follows PLAN §5 up to "Grid Diagonals" (u13); u14–u24 continue the same alternation (our design).
 *
 * API (HF.mastery):
 *   PATH, unit(id), unitsOfTask(task), unitLabel(u)
 *   state(unitBlocks, events, now, { skipTracks?, endedSessions? }) → MasteryState   (skipTracks: units on these tracks are
 *       passed over for now; endedSessions: { sessionId: true } — a reopened unit closes when its serving session has ended)
 *       unitBlocks = training BlockRecords that carry a unitId (time order); events = EventRecords (time order)
 *       MasteryState = { units: { id: UnitState }, current: { nback, relations }, checkDue: { nback, relations },
 *                        reviewDue: { nback: {unitId, k}|null, relations }, done: { nback, relations }, passedCount }
 *       UnitState = { id, trackId, task, target, label, status: 'open'|'pending-check'|'passed'|'moved-on'|'reopened',
 *                     criterionAt, criterionDay, passedAt, passDay, failedChecks, lastCheckDay, checks: [{t, ba, pass}],
 *                     reviews: [{k, dueDay, doneAt, ba}], qualifying: [bool…≤3], flagged }
 *   criterionMet(bas, trackId) → bool   (2 of the last 3 ≥ HF.modes.unitPassFor(trackId))
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var PATH = [
    { id: 'u01', trackId: 'nback.plain', target: 2 },
    { id: 'u02', trackId: 'rel.grid.T1', target: 5 },
    { id: 'u03', trackId: 'nback.transform', target: 2 },
    { id: 'u04', trackId: 'rel.steps', target: 2 },
    { id: 'u05', trackId: 'nback.plain', target: 4 },
    { id: 'u06', trackId: 'rel.grid.T2', target: 5 },
    { id: 'u07', trackId: 'rel.steps', target: 8 },
    { id: 'u08', trackId: 'nback.dual', target: 2 },
    { id: 'u09', trackId: 'rel.grid.T3', target: 5 },
    { id: 'u10', trackId: 'nback.arith', target: 2 },
    { id: 'u11', trackId: 'nback.switch', target: 3 },
    { id: 'u12', trackId: 'nback.plain', target: 6 },
    { id: 'u13', trackId: 'rel.grid.T4', target: 5 },
    { id: 'u14', trackId: 'nback.transform', target: 4 },
    { id: 'u15', trackId: 'rel.steps', target: 10 },
    { id: 'u16', trackId: 'nback.dual', target: 4 },
    { id: 'u17', trackId: 'rel.grid.T5', target: 5 },
    { id: 'u18', trackId: 'nback.arith', target: 4 },
    { id: 'u19', trackId: 'rel.grid.T6', target: 5 },
    { id: 'u20', trackId: 'nback.switch', target: 6 },
    { id: 'u21', trackId: 'rel.steps', target: 14 },
    { id: 'u22', trackId: 'nback.plain', target: 8 },
    { id: 'u23', trackId: 'rel.grid.T7', target: 5 },
    { id: 'u24', trackId: 'nback.transform', target: 6 }
  ];
  var BY_ID = {};
  PATH.forEach(function (u, i) { u.index = i; BY_ID[u.id] = u; });

  function M() { return HF.modes.get('mastery'); }
  function G() { return HF.goals; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function task(u) { return HF.catalog.get(u.trackId).task; }
  function unitLabel(u) {
    var c = HF.catalog, tr = c.get(u.trackId);
    if (tr.tier) return tr.name + ' to step ' + (u.target + 1);
    if (u.trackId === 'rel.steps') return tr.name + ' · ' + c.levelLabel(u.trackId, u.target);   // "Equal Steps · 1-back up to 19"
    return tr.short + ' ' + c.levelLabel(u.trackId, u.target);
  }
  function unitsOfTask(t) { return PATH.filter(function (u) { return task(u) === t; }); }

  function criterionMet(bas, trackId) {
    var m = M(), bar = HF.modes.unitPassFor(trackId), last = bas.slice(-m.unitWindow), k = 0;
    for (var i = 0; i < last.length; i++) if (last[i] >= bar - 1e-9) k++;
    return k >= m.unitNeed;
  }

  function blank(u) {
    return { id: u.id, trackId: u.trackId, task: task(u), target: u.target, label: unitLabel(u), status: 'open',
      criterionAt: null, criterionDay: null, passedAt: null, passDay: null, failedChecks: 0, lastCheckDay: null,
      checks: [], reviews: [], qualifying: [], flagged: false, reopenedAt: null, reopenSession: null, reopenServe: null, _bas: [] };
  }

  function valid(b) { return !HF.controller.blockBad(b); }

  function closeReopen(us) { us.status = us.flagged ? 'moved-on' : 'passed'; us.reopenedAt = null; us.reopenSession = null; us.reopenServe = null; }

  function state(unitBlocks, events, now, opts) {
    var m = M(), units = {}, today = G().dayKey(now), skip = (opts && opts.skipTracks) || {}, ended = (opts && opts.endedSessions) || {};
    PATH.forEach(function (u) { units[u.id] = blank(u); });
    // merge blocks and mastery-check events in time order
    var items = [];
    (unitBlocks || []).forEach(function (b) { if (b && units[b.unitId]) items.push({ t: b.t, b: b }); });
    (events || []).forEach(function (e) { if (e && e.type === 'mastery-check' && units[e.unitId]) items.push({ t: e.t, e: e }); });
    items.sort(function (a, b) { return a.t - b.t || (a.e ? 1 : 0) - (b.e ? 1 : 0); });

    items.forEach(function (it) {
      var b = it.b, e = it.e;
      if (e) {
        var u = units[e.unitId], day = G().dayKey(e.t);
        u.checks.push({ t: e.t, ba: e.ba, pass: !!e.pass });
        u.lastCheckDay = day;
        if (u.status === 'passed' || u.status === 'moved-on' || u.status === 'reopened') return;
        if (e.pass) { u.status = 'passed'; u.passedAt = e.t; u.passDay = day; }
        else {
          u.failedChecks++;
          if (u.failedChecks >= m.maxFailedChecks) { u.status = 'moved-on'; u.flagged = true; u.passedAt = e.t; u.passDay = day; }
          else u.status = 'pending-check';
        }
        return;
      }
      var us = units[b.unitId];
      if (!valid(b)) return;
      // "reopened for one session" (Phase 4, CA-01): the first later session that plays the unit serves it in full;
      // any block of the unit from a session after that one (a review, too) finds it closed again
      if (us.status === 'reopened' && us.reopenServe != null && b.sessionId !== us.reopenServe && b.sessionId !== us.reopenSession) closeReopen(us);
      if (b.purpose === 'review') {
        if (us.status !== 'passed' && us.status !== 'moved-on') return;
        var k = us.reviews.length;
        if (k >= m.reviewGaps.length) return;
        us.reviews.push({ k: k, doneAt: b.t, ba: b.result.ba });
        if (b.result.ba < m.reviewReopen - 1e-9) { us.status = 'reopened'; us.reopenedAt = b.t; us.reopenSession = b.sessionId; }
        return;
      }
      if (b.purpose === 'check') return;
      if (b.role !== 'rated') return;
      if (us.status === 'reopened') {
        // the serving session: its unit blocks keep the unit open (closed after the loop once that session has ended)
        if (b.sessionId !== us.reopenSession && us.reopenServe == null) us.reopenServe = b.sessionId;
        return;
      }
      if (b.rung === us.target && b.purpose !== 'corrective') {
        us._bas.push(b.result.ba);
        if (us._bas.length > m.unitWindow) us._bas.shift();
        if (us.status === 'open' && criterionMet(us._bas, us.trackId)) { us.status = 'pending-check'; us.criterionAt = b.t; us.criterionDay = G().dayKey(b.t); }
      }
    });

    PATH.forEach(function (u) { var s = units[u.id]; if (s.status === 'reopened' && s.reopenServe != null && ended[s.reopenServe]) closeReopen(s); });

    // review schedule + derived fields
    var passedCount = 0;
    PATH.forEach(function (u) {
      var s = units[u.id];
      var bar = HF.modes.unitPassFor(s.trackId);
      s.qualifying = s._bas.map(function (x) { return x >= bar - 1e-9; });
      delete s._bas;
      if (s.status === 'passed' || s.status === 'moved-on' || s.status === 'reopened') {
        if (s.status !== 'moved-on') passedCount++;
        var prevDay = s.passDay;
        var sched = [];
        for (var k = 0; k < m.reviewGaps.length; k++) {
          var r = s.reviews[k];
          var dueDay = G().addDays(prevDay, m.reviewGaps[k]);
          sched.push({ k: k, dueDay: dueDay, doneAt: r ? r.doneAt : null, ba: r ? r.ba : null });
          if (!r) break;
          prevDay = G().dayKey(r.doneAt);
        }
        s.reviews = sched;
      }
    });

    var current = {}, checkDue = {}, reviewDue = {}, done = {};
    ['nback', 'relations'].forEach(function (t) {
      var list = unitsOfTask(t);
      var reopened = null, open = null, chk = null, rev = null;
      for (var i = 0; i < list.length; i++) {
        var s = units[list[i].id];
        if (skip[s.trackId]) continue;   // e.g. Dual while sound is off: the path goes on with the next unit
        if (s.status === 'reopened' && !reopened) reopened = s.id;
        if (s.status === 'open' && !open) open = s.id;
        if (s.status === 'pending-check' && !chk) {
          var ref = s.lastCheckDay && s.lastCheckDay > (s.criterionDay || '') ? s.lastCheckDay : s.criterionDay;
          if (ref && ref < today) chk = s.id;
        }
        if ((s.status === 'passed' || s.status === 'moved-on') && s.reviews.length) {
          var nxt = s.reviews[s.reviews.length - 1];
          if (!nxt.doneAt && nxt.dueDay <= today && (!rev || nxt.dueDay < rev.dueDay)) rev = { unitId: s.id, k: nxt.k, dueDay: nxt.dueDay };
        }
      }
      current[t] = reopened || open;
      checkDue[t] = chk;
      reviewDue[t] = rev;
      done[t] = !open && !reopened && list.every(function (u) { var st = units[u.id].status; return st === 'passed' || st === 'moved-on'; });
    });

    return { units: units, current: current, checkDue: checkDue, reviewDue: reviewDue, done: done, passedCount: passedCount };
  }

  var api = { PATH: PATH, unit: function (id) { return BY_ID[id] || null; }, unitsOfTask: unitsOfTask, unitLabel: unitLabel, state: state, criterionMet: criterionMet };
  HF.mastery = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
