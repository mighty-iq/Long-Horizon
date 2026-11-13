/* Long-Horizon — calendar, counted sessions and weekly goals (pure, no DOM). MIT licence.
 *
 * PLAN §5 schedule rules and §7 weekly goals:
 *   - One counted session per local calendar day; Sprint counts up to 2 a day, at least 3 h apart.
 *   - Stretch: at least 20 h between counted sessions and at most 4 counted sessions a week.
 *   - A session qualifies when it ended as 'done' or 'fatigue', or when at least half of its planned blocks
 *     were played (stopping early is a partial session, never a failure).
 *   - Weekly target 3–5 (default 4), clamped to the mode's cap (Stretch ≤ 4); weeks start on Monday.
 *   - A missed day can be made up later in the same week (still one per day); goal pauses
 *     (events 'goal-pause' {from, to}, local day keys or ms, inclusive) remove days from the week and
 *     scale the target down; each Monday is a fresh start; nothing in this data frames a loss
 *     (no streak that breaks, no "missed" counts) — `weeksMet` only ever grows.
 *
 * API (HF.goals):
 *   dayKey(ms) → 'YYYY-MM-DD' (local)      parseDay(key) → ms at local midnight
 *   addDays(key, k) → key                  dayDiff(a, b) → whole days from a to b
 *   dow(key) → 0 = Monday … 6 = Sunday     weekKey(ms|key) → key of that week's Monday
 *   qualifies(session, nBlocks) → bool
 *   countSessions(sessions, blocksPerSession) → { counted: {id: true}, list: [{ id, t, dayKey, weekKey, mode }], why: {id: reason} }
 *        sessions are SessionRecords; blocksPerSession = { sessionId: number of training blocks }
 *   pausedDaySet(events) → { dayKey: true }
 *   canCountNow(list, now, modeId) → { ok, reason }   would a session started now count (if it qualifies)?
 *   week(list, { now, settings, modeId, events }) → WeekState:
 *        { weekKey, target, baseTarget, count, days: [{ dayKey, dow, counted, paused, today, past }], paused,
 *          pausedDays, remaining, daysLeft, reachable, met, freshStart, weeksMet, totalCounted }
 *   weeklyTarget(settings, modeId) → number (3–5, clamped to the mode cap)
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var DAY = 86400000, HOUR = 3600000;
  var TRAIN_ROLES = { warmup: 1, rated: 1, free: 1, check: 1, protocol: 1, assist: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parts(k) { var p = String(k).split('-'); return [+p[0], +p[1] - 1, +p[2]]; }
  function parseDay(k) { var p = parts(k); return new Date(p[0], p[1], p[2]).getTime(); }
  function addDays(k, n) { var p = parts(k); return dayKey(new Date(p[0], p[1], p[2] + n).getTime()); }
  function dayDiff(a, b) { return Math.round((parseDay(b) - parseDay(a)) / DAY); }
  function dow(k) { var p = parts(k); return (new Date(p[0], p[1], p[2]).getDay() + 6) % 7; }
  function weekKey(x) { var k = typeof x === 'string' ? x : dayKey(x); return addDays(k, -dow(k)); }
  function toKey(x) { return typeof x === 'number' ? dayKey(x) : (typeof x === 'string' ? x.slice(0, 10) : null); }

  function qualifies(s, nBlocks) {
    if (!s || !(nBlocks > 0)) return false;
    if (s.endedBy === 'done' || s.endedBy === 'fatigue') return true;
    var planned = s.planned > 0 ? s.planned : 0;
    return planned > 0 && nBlocks >= Math.ceil(planned / 2);
  }

  function sessionMode(s) { return s.protocol ? 'protocols' : (s.mode || 'varied'); }

  function countSessions(sessions, blocksPerSession) {
    var bps = blocksPerSession || {};
    var list = (sessions || []).filter(function (s) { return s && s.id && typeof s.startedAt === 'number'; })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1); });
    var counted = {}, out = [], why = {};
    var perDayCount = {}, perWeekCount = {}, last = null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!qualifies(s, bps[s.id] || 0)) { why[s.id] = 'not-qualified'; continue; }
      var mode = HF.modes.get(sessionMode(s)), dk = s.dayKey || dayKey(s.startedAt), wk = weekKey(dk);
      var nDay = perDayCount[dk] || 0, nWeek = perWeekCount[wk] || 0;
      if (nDay >= mode.perDay) { why[s.id] = 'day-limit'; continue; }
      if (last && mode.minGapH > 0 && s.startedAt - last.t < mode.minGapH * HOUR) { why[s.id] = 'gap'; continue; }
      if (mode.weeklyCap != null && nWeek >= mode.weeklyCap) { why[s.id] = 'week-cap'; continue; }
      counted[s.id] = true; why[s.id] = 'counted';
      perDayCount[dk] = nDay + 1; perWeekCount[wk] = nWeek + 1;
      last = { id: s.id, t: s.startedAt, dayKey: dk, weekKey: wk, mode: mode.id };
      out.push(last);
    }
    return { counted: counted, list: out, why: why };
  }

  function canCountNow(list, now, modeId) {
    var mode = HF.modes.get(modeId), dk = dayKey(now), wk = weekKey(dk);
    var nDay = 0, nWeek = 0, last = null;
    for (var i = 0; i < (list || []).length; i++) {
      var c = list[i];
      if (c.dayKey === dk) nDay++;
      if (c.weekKey === wk) nWeek++;
      if (!last || c.t > last.t) last = c;
    }
    if (nDay >= mode.perDay) return { ok: false, reason: 'day-limit' };
    if (last && mode.minGapH > 0 && now - last.t < mode.minGapH * HOUR) return { ok: false, reason: 'gap', waitMs: mode.minGapH * HOUR - (now - last.t) };
    if (mode.weeklyCap != null && nWeek >= mode.weeklyCap) return { ok: false, reason: 'week-cap' };
    return { ok: true, reason: null };
  }

  function pausedDaySet(events) {
    var set = {};
    (events || []).forEach(function (e) {
      if (!e || e.type !== 'goal-pause') return;
      var a = toKey(e.from), b = toKey(e.to != null ? e.to : e.from);
      if (!a || !b) return;
      if (dayDiff(a, b) < 0) { var t = a; a = b; b = t; }
      var n = Math.min(400, dayDiff(a, b));
      for (var i = 0; i <= n; i++) set[addDays(a, i)] = true;
    });
    return set;
  }

  function weeklyTarget(settings, modeId) {
    var t = settings && typeof settings.weeklyTarget === 'number' ? Math.round(settings.weeklyTarget) : 4;
    t = Math.max(3, Math.min(5, t));
    return Math.min(t, HF.modes.get(modeId).targetCap);
  }

  function week(list, ctx) {
    ctx = ctx || {};
    var now = ctx.now, modeId = ctx.modeId || (ctx.settings && ctx.settings.mode) || 'varied', mode = HF.modes.get(modeId);
    var today = dayKey(now), wk = weekKey(today), paused = pausedDaySet(ctx.events);
    var base = weeklyTarget(ctx.settings, modeId);
    var byDay = {}, byWeek = {};
    (list || []).forEach(function (c) { byDay[c.dayKey] = (byDay[c.dayKey] || 0) + 1; byWeek[c.weekKey] = (byWeek[c.weekKey] || 0) + 1; });
    var days = [], pausedN = 0;
    for (var i = 0; i < 7; i++) {
      var k = addDays(wk, i);
      var p = !!paused[k];
      if (p) pausedN++;
      days.push({ dayKey: k, dow: i, counted: byDay[k] || 0, paused: p, today: k === today, past: k < today });
    }
    var active = 7 - pausedN;
    var target = active >= 7 ? base : Math.round(base * active / 7);
    var count = byWeek[wk] || 0;
    var capLeft = mode.weeklyCap != null ? Math.max(0, mode.weeklyCap - count) : Infinity;
    var slots = 0, daysLeft = 0;
    for (var j = 0; j < 7; j++) {
      var d = days[j];
      if (d.past || d.paused) continue;
      var free = Math.max(0, mode.perDay - d.counted);
      if (free > 0) { daysLeft++; slots += free; }
    }
    slots = Math.min(slots, capLeft);
    var remaining = Math.max(0, target - count);
    // weeks met so far (cumulative; never decreases). Uses today's target setting for past weeks.
    var weeksMet = 0;
    Object.keys(byWeek).forEach(function (w) {
      var pn = 0; for (var q = 0; q < 7; q++) if (paused[addDays(w, q)]) pn++;
      var tg = pn === 0 ? base : Math.round(base * (7 - pn) / 7);
      if (tg > 0 && byWeek[w] >= tg) weeksMet++;
    });
    return {
      weekKey: wk, target: target, baseTarget: base, count: count, days: days,
      paused: !!paused[today], pausedDays: pausedN, remaining: remaining, daysLeft: daysLeft,
      reachable: remaining <= slots, met: target > 0 && count >= target,
      freshStart: dow(today) === 0 && count === 0, weeksMet: weeksMet, totalCounted: (list || []).length
    };
  }

  var api = {
    dayKey: dayKey, parseDay: parseDay, addDays: addDays, dayDiff: dayDiff, dow: dow, weekKey: weekKey,
    qualifies: qualifies, countSessions: countSessions, canCountNow: canCountNow, pausedDaySet: pausedDaySet,
    week: week, weeklyTarget: weeklyTarget, TRAIN_ROLES: TRAIN_ROLES
  };
  HF.goals = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
