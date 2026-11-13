/* Long-Horizon — Lab schedule (pure, no DOM). MIT licence. PLAN §6 "Schedule", research/04 §13.

   HF.lab.schedule(records, derived?, now?) → {
     path: 'measure' | 'no-baseline',           // no-baseline = training started before any B1 result
     programme: { sessions, quickBefore|null, unit, template },   // default 20 / 11; study templates may change it
     counted: <counted sessions so far>,
     plan: [ { kind, status, dueFrom, dueTo, part?, waitingFor?, form } ],   // B1, B2, Q (if the programme has one), POST, FU
     next: null | { kind, status, dueFrom, dueTo, part: 'A'|'B'|null, config, tests: [labTestId], form,
                    notToday: bool, waitingFor? },
     visits: [ { id, kind, config, form, startedAt, endedAt, hour, device, tests: [ids], flags: [...] } ],
     formFor(kind) → 'A'|'B'|'C'|'D',  seedFor(kind, testId) → string,  testsFor(kind, config?) → [ids],
     reasoningLeft: 0…4, canStartExtra: true, trainedToday: bool }
   status ∈ done | partial (some tests, can no longer be finished) | due | overdue | upcoming (window not open yet)
            | waiting (a condition such as "after session 10" is not met) | missed | skipped (not part of this path).
   `derived` is accepted for the SPEC signature but not needed: counted sessions come from records.sessions[].counted.
   `now` defaults to Date.now(). Days are local calendar days.

   Rules
   - B1 any time before training; its two sittings (part A memory, part B reasoning & control) should be ≤ 3 days apart.
   - B2 2–7 days after B1 is complete (from the start of B1's last day + 2 days to the end of that day + 7 days), before
     training; it stays offered (overdue) until the first counted session, then it is missed.
   - Q (quick check) when exactly quickBefore − 1 sessions are counted (default: after session 10, before session 11);
     missed once session quickBefore is counted. Study templates cao and wang have no Q (as in the papers).
   - POST from the day after session N (N = programme sessions, default 20) to the end of the 3rd day after it.
   - FU 8–12 weeks after POST (days 56–84).
   - Lab-only study arm (no training): Q and POST follow the calendar instead, at 4 sessions a week from B2
     (Q: days 17–21 after B2; POST: days 36–38 after B2 for 20 sessions).
   - Reasoning tests (part B) only at B1, B2, POST and FU and at most 4 times in all; Q is 'quick'; extra visits 'X' are
     memory-only (part A of the user's config).
   - The Lab comes before training on a training day: next.notToday is true when a session was started today.
   - Forms: B1, B2, POST, FU take the user's Latin-square row (HF.lab.formOrder(anonId)); Q uses B2's form with fresh
     sequences (seed variant 'Q1'); X visits rotate through the row with variant 'X<n>'.
   - Visit flags (added to the visit's own flags): 'device-class' / 'device-input' (differs from the first visit, normally
     B1), 'time-of-day' (start hour more than 3 h from the first visit's, circular), 'after-training' (a session was
     started earlier the same local day), 'outside-window' (B2, POST, FU taken outside their window).
   No-baseline path: B1, B2 and Q are 'skipped'; POST and FU are still offered after the programme; extra visits are
   allowed any time. HF.lab.compare then reports 'no-baseline'.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var lab = HF.lab || (HF.lab = {});

  var DAY = 86400000;
  var DEFAULT_PROGRAMME = { sessions: 20, quickBefore: 11, unit: 'session', template: null };

  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ms, n) { var d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
  function endOfDay(ms) { return addDays(startOfDay(ms), 1) - 1; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localHour(ms) { var d = new Date(ms); return d.getHours() + d.getMinutes() / 60; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function programmeOf(records) {
    var st = HF.study && typeof HF.study.state === 'function' ? HF.study.state(records) : null;
    if (st && st.left) return { prog: DEFAULT_PROGRAMME, study: null };   // left the study: back to the ordinary Lab calendar
    if (!st || !HF.study.templates[st.template]) return { prog: DEFAULT_PROGRAMME, study: st };
    var p = HF.study.templates[st.template].programme;
    return { prog: { sessions: p.sessions, quickBefore: p.quickBefore, unit: p.unit, template: st.template }, study: st };
  }

  function schedule(records, derived, now) {
    var lab = HF.lab; // resolved at call time (load order independent)
    records = records || {};
    now = isNum(now) ? now : Date.now();
    var settings = records.settings || {};
    var defConfig = lab.CONFIGS && lab.CONFIGS[settings.labConfig] ? settings.labConfig : 'standard';
    var square = lab.formOrder(records.profile && records.profile.anonId);
    var FULL = lab.FULL_KINDS;

    var raw = (records.labVisits || []).filter(function (v) { return v && v.kind && isNum(v.startedAt); })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    var byKind = {};
    raw.forEach(function (v) { (byKind[v.kind] = byKind[v.kind] || []).push(v); });

    var allSessions = (records.sessions || []).filter(function (s) { return s && isNum(s.startedAt); })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    var sessions = allSessions.filter(function (s) { return s.counted; });
    var counted = sessions.length;
    var todayKey = dayKey(now);
    var trainedToday = allSessions.some(function (s) { return (s.dayKey || dayKey(s.startedAt)) === todayKey; });

    var po = programmeOf(records), prog = po.prog;
    var labOnly = !!(po.study && po.study.armKind === 'lab-only');

    // which kinds already used reasoning tests (part B)
    var reasoningKinds = [];
    raw.forEach(function (v) {
      var hasB = Object.keys(v.tests || {}).some(function (id) { return lab.partOf(id) === 'B'; });
      if (hasB && reasoningKinds.indexOf(v.kind) < 0) reasoningKinds.push(v.kind);
    });
    var xCount = (byKind.X || []).length;

    function testsFor(kind, config) {
      config = config || defConfig;
      if (kind === 'Q') return lab.visitTests('quick');
      if (kind === 'X') return lab.visitTests(config, { reasoning: false });
      var allow = FULL.indexOf(kind) >= 0 && (reasoningKinds.indexOf(kind) >= 0 || reasoningKinds.length < 4);
      return lab.visitTests(config, { reasoning: allow });
    }

    function formFor(kind) {
      var recs = byKind[kind];
      if (kind !== 'X' && recs && recs.length && lab.FORMS.indexOf(recs[0].form) >= 0) return recs[0].form;
      var idx = FULL.indexOf(kind);
      if (idx >= 0) return square[idx];
      if (kind === 'Q') return square[1];
      if (kind === 'X') return square[xCount % 4];
      return square[0];
    }

    function seedFor(kind, testId) {
      var variant = kind === 'Q' ? 'Q1' : (kind === 'X' ? 'X' + (xCount + 1) : '');
      return lab.formSeed(testId, formFor(kind), variant);
    }

    // merge the records of one kind (two sittings = two records); records without any test result (aborted) are ignored
    function merge(kind) {
      var recs = (byKind[kind] || []).filter(function (r) { return Object.keys(r.tests || {}).length > 0; });
      if (!recs.length) return null;
      var tests = {}, ends = [];
      recs.forEach(function (r) {
        Object.keys(r.tests || {}).forEach(function (id) { tests[id] = r.tests[id]; });
        ends.push(isNum(r.endedAt) ? r.endedAt : r.startedAt);
      });
      var config = recs[0].config || defConfig;
      var need = testsFor(kind, config);
      var have = need.filter(function (id) { return tests[id]; });
      var needA = need.filter(function (id) { return lab.partOf(id) === 'A'; });
      var needB = need.filter(function (id) { return lab.partOf(id) === 'B'; });
      var doneA = needA.every(function (id) { return tests[id]; });
      var doneB = needB.every(function (id) { return tests[id]; });
      return {
        kind: kind, recs: recs, tests: tests, config: config, startedAt: recs[0].startedAt,
        endedAt: Math.max.apply(null, ends), complete: have.length === need.length, doneA: doneA, doneB: doneB,
        pendingPart: have.length === need.length ? null : (doneA ? 'B' : 'A')
      };
    }

    function windowStatus(dueFrom, dueTo) {
      if (isNum(dueFrom) && now < dueFrom) return 'upcoming';
      if (!isNum(dueTo) || now <= dueTo) return 'due';
      return 'overdue';
    }

    var M = {};
    ['B1', 'B2', 'Q', 'POST', 'FU'].forEach(function (k) { M[k] = merge(k); });
    var noBaseline = !M.B1 && counted >= 1;
    var path = noBaseline ? 'no-baseline' : 'measure';
    var plan = [], windows = {};

    function entry(kind, status, extra) {
      var e = { kind: kind, status: status, dueFrom: null, dueTo: null, form: formFor(kind) };
      Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
      plan.push(e);
      return e;
    }

    // B1
    if (noBaseline) entry('B1', 'skipped');
    else if (M.B1 && M.B1.complete) entry('B1', 'done', { doneAt: M.B1.endedAt });
    else if (M.B1) {
      var b1To = endOfDay(addDays(M.B1.startedAt, 3));
      entry('B1', counted >= 1 ? 'partial' : (now > b1To ? 'overdue' : 'due'), { part: M.B1.pendingPart, dueFrom: M.B1.endedAt, dueTo: b1To });
    } else entry('B1', 'due');

    // B2
    var b2Ref = null;
    if (noBaseline) entry('B2', 'skipped');
    else if (M.B2 && M.B2.complete) entry('B2', 'done', { doneAt: M.B2.endedAt });
    else if (!M.B1 || (!M.B1.complete && counted < 1)) entry('B2', 'waiting', { waitingFor: { visit: 'B1' } });
    else {
      var ref = M.B1.endedAt;
      var from = addDays(startOfDay(ref), 2), to = endOfDay(addDays(ref, 7));
      windows.B2 = [from, to];
      if (counted >= 1) entry('B2', M.B2 ? 'partial' : 'missed', { dueFrom: from, dueTo: to });
      else entry('B2', windowStatus(from, to), { dueFrom: from, dueTo: to, part: M.B2 ? M.B2.pendingPart : null });
    }
    if (M.B2 && M.B2.complete) {
      b2Ref = M.B2.endedAt;
      // window of a finished B2, for its 'outside-window' flag
      if (M.B1) windows.B2 = [addDays(startOfDay(M.B1.endedAt), 2), endOfDay(addDays(M.B1.endedAt, 7))];
    }

    // Q
    if (prog.quickBefore) {
      var qb = prog.quickBefore;
      if (noBaseline) entry('Q', 'skipped');
      else if (M.Q && M.Q.complete) entry('Q', 'done', { doneAt: M.Q.endedAt });
      else if (labOnly) {
        if (!b2Ref) entry('Q', 'waiting', { waitingFor: { visit: 'B2' } });
        else {
          var qd = Math.floor((qb - 1) * 7 / 4);
          var qf = addDays(startOfDay(b2Ref), qd), qt = endOfDay(addDays(b2Ref, qd + 4));
          entry('Q', windowStatus(qf, qt), { dueFrom: qf, dueTo: qt });
        }
      } else if (counted >= qb) entry('Q', M.Q ? 'partial' : 'missed');
      else if (counted === qb - 1) {
        var s10 = sessions[qb - 2];
        entry('Q', 'due', { dueFrom: isNum(s10.endedAt) ? s10.endedAt : s10.startedAt, dueTo: null, beforeSession: qb });
      } else entry('Q', 'waiting', { waitingFor: { sessions: qb - 1, done: counted } });
    }

    // POST
    var postFrom = null, postTo = null;
    if (labOnly && b2Ref) {
      var pd = Math.ceil(prog.sessions * 7 / 4);
      postFrom = addDays(startOfDay(b2Ref), pd + 1); postTo = endOfDay(addDays(b2Ref, pd + 3));
    } else if (!labOnly && counted >= prog.sessions) {
      var sN = sessions[prog.sessions - 1], refN = isNum(sN.endedAt) ? sN.endedAt : sN.startedAt;
      postFrom = addDays(startOfDay(refN), 1); postTo = endOfDay(addDays(refN, 3));
    }
    if (isNum(postFrom)) windows.POST = [postFrom, postTo];
    if (M.POST && M.POST.complete) entry('POST', 'done', { doneAt: M.POST.endedAt, dueFrom: postFrom, dueTo: postTo });
    else if (!isNum(postFrom)) {
      entry('POST', 'waiting', labOnly ? { waitingFor: { visit: 'B2' } } : { waitingFor: { sessions: prog.sessions, done: counted } });
    } else entry('POST', windowStatus(postFrom, postTo), { dueFrom: postFrom, dueTo: postTo, part: M.POST ? M.POST.pendingPart : null });

    // FU
    if (M.FU && M.FU.complete) {
      if (M.POST) windows.FU = [addDays(startOfDay(M.POST.endedAt), 56), endOfDay(addDays(M.POST.endedAt, 84))];
      entry('FU', 'done', { doneAt: M.FU.endedAt });
    } else if (!M.POST) entry('FU', 'waiting', { waitingFor: { visit: 'POST' } });
    else {
      var fFrom = addDays(startOfDay(M.POST.endedAt), 56), fTo = endOfDay(addDays(M.POST.endedAt, 84));
      windows.FU = [fFrom, fTo];
      entry('FU', windowStatus(fFrom, fTo), { dueFrom: fFrom, dueTo: fTo, part: M.FU ? M.FU.pendingPart : null });
    }

    // next visit
    var next = null;
    for (var k = 0; k < plan.length; k++) {
      var e = plan[k];
      if (['due', 'overdue', 'upcoming', 'waiting'].indexOf(e.status) < 0) continue;
      var m = M[e.kind];
      var config = m ? m.config : (e.kind === 'Q' ? 'quick' : defConfig);
      var tests = testsFor(e.kind, m ? m.config : defConfig);
      if (m) tests = tests.filter(function (id) { return !m.tests[id]; });
      if (e.part) tests = tests.filter(function (id) { return lab.partOf(id) === e.part; });
      next = {
        kind: e.kind, status: e.status, dueFrom: e.dueFrom, dueTo: e.dueTo, part: e.part || null,
        config: config, tests: tests, form: e.form, notToday: trainedToday && e.status !== 'waiting'
      };
      if (e.waitingFor) next.waitingFor = e.waitingFor;
      if (e.beforeSession) next.beforeSession = e.beforeSession;
      break;
    }

    // visit list with computed flags
    var refVisit = (byKind.B1 && byKind.B1[0]) || raw[0] || null;
    function hourOf(v) { return isNum(v.hour) ? v.hour : localHour(v.startedAt); }
    var visits = raw.map(function (v) {
      var flags = (v.flags || []).slice();
      function add(f) { if (flags.indexOf(f) < 0) flags.push(f); }
      if (refVisit && v !== refVisit) {
        var d0 = refVisit.device || {}, d1 = v.device || {};
        if (d0.class && d1.class && d0.class !== d1.class) add('device-class');
        if (d0.input && d1.input && d0.input !== d1.input) add('device-input');
        var dh = Math.abs(hourOf(v) - hourOf(refVisit));
        if (Math.min(dh, 24 - dh) > 3) add('time-of-day');
      }
      var vk = dayKey(v.startedAt);
      if (allSessions.some(function (s) { return (s.dayKey || dayKey(s.startedAt)) === vk && s.startedAt < v.startedAt; })) add('after-training');
      var w = windows[v.kind];
      if (w && (v.startedAt < w[0] || v.startedAt > w[1])) add('outside-window');
      return {
        id: v.id, kind: v.kind, config: v.config || null, form: v.form || null, startedAt: v.startedAt,
        endedAt: isNum(v.endedAt) ? v.endedAt : null, hour: hourOf(v), device: v.device || null,
        tests: Object.keys(v.tests || {}), flags: flags
      };
    });

    return {
      path: path, programme: prog, counted: counted, plan: plan, next: next, visits: visits,
      formFor: formFor, seedFor: seedFor, testsFor: testsFor,
      reasoningLeft: Math.max(0, 4 - reasoningKinds.length), canStartExtra: true, trainedToday: trainedToday
    };
  }

  lab.schedule = schedule;
  lab._date = { startOfDay: startOfDay, addDays: addDays, endOfDay: endOfDay, dayKey: dayKey, DAY: DAY };
  if (typeof module === 'object' && module.exports) module.exports = schedule;
})(typeof window !== 'undefined' ? window : globalThis);
