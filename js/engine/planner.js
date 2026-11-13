/* Long-Horizon — session planner (pure, no DOM). MIT licence.
 *
 * PLAN §4.4 (variety engine), §5 (session templates, modes), §6 (Study arms); SPEC §6 (planner API).
 *
 * HF.planner.plan(records, derived, { now, modeId?, minutes?, protocolIds?, study?, id? }) → SessionPlan
 *   SessionPlan = { id, modeId (effective), requestedMode, protocol, study, sessionIndex, phase, glyphs, slots: [Slot],
 *                   estMinutes, introduce: [trackId], reflection, free, notes: [{ code, text, ... }],
 *                   counts: { ok, reason: null|'day-limit'|'gap'|'week-cap', waitMs? } }
 *     counts = would a session started at opts.now count toward goals (if it qualifies)? Computed at plan time with
 *     HF.goals.canCountNow, never from the day-cached derived.today.canCount (Phase 4, CA-03); 'not-counted' note follows it.
 *     A study the learner has left (derived.study.left) is ignored: the chosen mode is planned normally.
 *   Slot = { slotId, index, trackId|null (null = chosen at run time in Free play), role, taskId, set|null, lessonId|null,
 *            unitId|null, purpose|null, protocol|null, modeId, sessionIndex, phase, glyphs, strategyCard|null, unitTask? }
 * HF.planner.prepare(slot, records, derived, sessionState) → BlockPlan
 *   sessionState = { sessionId, attempt? }   (blocks already committed in this session are read from records)
 *   BlockPlan = { slotId, sessionId, index, trackId, taskId, role, purpose, unitId, protocol, modeId, study, rung, levelBefore,
 *                 capRung, params, set, seed, lureCount (n-back position lures / Equal Steps near misses: 4, Stretch 6;
 *                 null when uncontrolled), lureMode, targets (Wang 10, else null = generator default 6),
 *                 ruleCard: { title, rule, keys, example }, feedback:
 *                 { perResponse, summary, showLevel, revealAtEnd, dayAccuracyAtEnd }, strategyCard, lessonId, label,
 *                 predicted, attempt, assist, replaced (trackId swapped out, e.g. Dual while sound is off),
 *                 aid: null | 'tape' (n-back: memory tape) | 'highlight' (Relation Grid: what counts is highlighted) }
 *   The 'assist' plan note carries the same aid and says it in words (Phase 4, PQ-03).
 * HF.planner.freeSlot(plan, { trackId, rung?, set? }) → Slot appended to a Free-play plan
 *
 * Templates (PLAN §5): 25 min = per task 1 warm-up + 6 rated (14 blocks); rated blocks scale with the 10–30 min
 * setting (12 · minutes / 25 rated in all) and are split by the task-balance setting (50/50; 40/35/25 with Span on,
 * which also gives "1 + 4 per task, 15 in all"). Protocol sessions follow their papers. Free play is open-ended.
 * Varied: blocked (sessions 1–3) → serial rotation (4–6) → random with ≤ 2 blocks of a version in a row (7+),
 * tasks alternating every 2 blocks in the random phase; introduction order S1 Plain + Grid T1, S2 Transform,
 * S3 Equal Steps, S4 Switch, S6 Arithmetic, S8 Dual, S10 Stream (gates first, at most one new version per session;
 * Grid tiers and Span versions join when they open). Stretch: random from its first session, 6 lures, fast
 * pace from 2-back, newest Grid tier preferred and older tiers capped at step 6. Sprint: blocked, fixed versions
 * (Plain with grid positions or the chosen version; Relation Grid with digit tails), double steps, strategy cards
 * in Sprint sessions 1–3. Mastery: per task a delayed check (2 blocks) and ≤ 1 review when due, then the current
 * unit (or a corrective cycle after a failed check, or maintenance after the last unit).
 * Sets rotate per block (least recently used; default sets in Varied sessions 1–3; fixed in Sprint/Protocols);
 * the glyph family changes every 5 sessions; Lab-only sets are never used. Transform rule variants (two after, one
 * before; params.step) appear only on non-day sets, from the random phase on (Varied 7+, Stretch, Free), after 12 rated
 * Transform blocks; Cao's days always keep +1.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var config = { transformVariants: true, transformSteps: [1, 1, 2, -1], variantAfterBlocks: 12 };
  var INTRO = [
    { trackId: 'nback.plain', s: 1 }, { trackId: 'rel.grid.T1', s: 1 }, { trackId: 'nback.transform', s: 2 },
    { trackId: 'rel.steps', s: 3 }, { trackId: 'nback.switch', s: 4 }, { trackId: 'nback.arith', s: 6 },
    { trackId: 'nback.dual', s: 8 }, { trackId: 'rel.stream', s: 10 }
  ];
  var TASK_ORDER = ['nback', 'relations', 'span'];
  var SPAN_ORDER = ['span.op', 'span.sym', 'span.back'];

  function C() { return HF.catalog; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, dflt) { return isNum(x) ? x : dflt; }

  // ---------- helpers ----------
  function phaseFor(modeId, sessionIndex) {
    if (modeId === 'stretch') return 'random';
    if (modeId !== 'varied') return 'blocked';
    return sessionIndex <= 3 ? 'blocked' : (sessionIndex <= 6 ? 'serial' : 'random');
  }
  function glyphFamily(sessionIndex) {
    var fams = C().GLYPH_FAMILIES;
    return fams[Math.floor(Math.max(0, (sessionIndex || 1) - 1) / 5) % fams.length];
  }
  /** Largest-remainder split of `total` by weights; every positive weight gets ≥ 1 when total allows. */
  function allocate(total, weights) {
    var n = weights.length, out = [], i;
    for (i = 0; i < n; i++) out.push(0);
    if (!n || total <= 0) return out;
    var pos = []; for (i = 0; i < n; i++) if (weights[i] > 0) pos.push(i);
    if (!pos.length) return out;
    var left = total;
    if (total >= pos.length) { pos.forEach(function (j) { out[j] = 1; }); left -= pos.length; }
    var W = 0; pos.forEach(function (j) { W += weights[j]; });
    var raw = pos.map(function (j) { return left * weights[j] / W; });
    var fl = raw.map(Math.floor), given = 0;
    pos.forEach(function (j, k) { out[j] += fl[k]; given += fl[k]; });
    var rem = pos.map(function (j, k) { return { j: j, r: raw[k] - fl[k], w: weights[j] }; }).sort(function (a, b) { return b.r - a.r || b.w - a.w || a.j - b.j; });
    for (var k = 0; given < left; k++, given++) out[rem[k % rem.length].j]++;
    return out;
  }
  function taskCounts(settings, minutes, noSpan) {
    var spanOn = !!settings.spanOn && !noSpan, bal = settings.balance || {};
    var w = { nback: num(bal.nback, 50), relations: num(bal.relations, 50), span: spanOn ? num(bal.span, 0) : 0 };
    if (spanOn && !(w.span > 0)) w = { nback: 40, relations: 35, span: 25 };
    var tasks = TASK_ORDER.filter(function (t) { return w[t] > 0; });
    if (!tasks.length) { tasks = ['nback', 'relations']; w = { nback: 50, relations: 50 }; }
    var total = Math.max(tasks.length, Math.round(12 * minutes / 25));
    var counts = allocate(total, tasks.map(function (t) { return w[t]; }));
    return tasks.map(function (t, i) { return { task: t, rated: counts[i] }; });
  }
  function rngFor(id) { return HF.rng.create('plan:' + id); }
  function newId(now) { return 's' + Math.floor(now).toString(36) + '-' + HF.rng.newSeed().slice(0, 6); }

  function introOrderIndex(id) {
    for (var i = 0; i < INTRO.length; i++) if (INTRO[i].trackId === id) return i;
    var tr = C().get(id);
    if (tr && tr.tier) return 100 + tr.tier;
    var si = SPAN_ORDER.indexOf(id); if (si >= 0) return 200 + si;
    return 300;
  }

  /** Tracks introduced this session (Varied and Stretch). */
  function introductions(d, sessionIndex) {
    var T = d.tracks, out = [], laterIntro = false;
    INTRO.forEach(function (x) {
      if (x.s === 1 && !T[x.trackId].introduced && T[x.trackId].available) out.push(x.trackId);
    });
    for (var i = 0; i < INTRO.length && !laterIntro; i++) {
      var x = INTRO[i];
      if (x.s > 1 && x.s <= sessionIndex && !T[x.trackId].introduced && T[x.trackId].available) { out.push(x.trackId); laterIntro = true; }
    }
    if (d.settings.dual && T['nback.dual'].available && !T['nback.dual'].introduced && out.indexOf('nback.dual') < 0) out.push('nback.dual');
    for (var k = 2; k <= 8; k++) { var id = 'rel.grid.T' + k; if (T[id].available && !T[id].introduced) out.push(id); }
    if (d.settings.spanOn) {
      for (var j = 0; j < SPAN_ORDER.length; j++) {
        var sid = SPAN_ORDER[j];
        if (T[sid].available && !T[sid].introduced) { out.push(sid); break; }
      }
    }
    return out;
  }

  function newestTier(d, pool) {
    var best = null;
    pool.forEach(function (id) { var tr = C().get(id); if (tr.tier && (!best || tr.tier > C().get(best).tier)) best = id; });
    return best;
  }

  /** Weighted pool of a task for Varied/Stretch: [{ trackId, w, cap }]. */
  function poolFor(d, task, introducedNow, modeId) {
    var T = d.tracks, ids = C().tracksOfTask(task).filter(function (id) {
      return T[id].available && (T[id].introduced || introducedNow.indexOf(id) >= 0);
    });
    if (!ids.length) {
      if (task === 'nback') ids = ['nback.plain'];
      else if (task === 'relations') ids = ['rel.grid.T1'];
      else return [];
    }
    var top = newestTier(d, ids);
    return ids.map(function (id) {
      var tr = C().get(id), w = 1, cap = null;
      if (tr.tier) w = id === top ? (modeId === 'stretch' ? 2 : 1) : 0.35;
      if (id === 'rel.stream') { w = 0.5; cap = 1; }
      return { trackId: id, w: w, cap: cap };
    }).sort(function (a, b) { return introOrderIndex(a.trackId) - introOrderIndex(b.trackId); });
  }

  function lessonFor(d, trackId) {
    var tr = C().get(trackId), t = d.tracks[trackId];
    if (!tr || t.blocks > 0) return null;
    if (d.lessons && d.lessons.passed && isNum(d.lessons.passed[tr.lessonId])) return null;
    if (d.assist && d.assist.tracks && d.assist.tracks[trackId]) return null;   // failed twice: assisted blocks instead
    return tr.lessonId;
  }

  function mkSlot(plan, o) {
    var s = {
      slotId: 'k' + plan.slots.length, index: plan.slots.length, trackId: o.trackId || null, role: o.role || 'rated',
      taskId: o.trackId ? C().get(o.trackId).task : (o.taskId || null), set: o.set || null, lessonId: o.lessonId || null,
      unitId: o.unitId || null, purpose: o.purpose || null, protocol: o.protocol || null, modeId: plan.modeId,
      sessionIndex: plan.sessionIndex, phase: plan.phase, glyphs: plan.glyphs, strategyCard: o.strategyCard || null
    };
    if (o.unitTask) s.unitTask = o.unitTask;
    if (isNum(o.rung)) s.rung = o.rung;
    plan.slots.push(s);
    return s;
  }

  // ---------- segment builders ----------
  function capCounts(pool, counts, total) {
    // apply per-session caps (Relation Stream ≤ 1) and give the excess to the uncapped track with most weight
    var extra = 0;
    pool.forEach(function (p, i) { if (p.cap != null && counts[i] > p.cap) { extra += counts[i] - p.cap; counts[i] = p.cap; } });
    if (extra) {
      var best = -1; pool.forEach(function (p, i) { if (p.cap == null && (best < 0 || p.w > pool[best].w)) best = i; });
      if (best >= 0) counts[best] += extra;
    }
    return counts;
  }

  function blockedSequence(pool, rated) {
    var counts = capCounts(pool, allocate(rated, pool.map(function (p) { return p.w; })), rated), seq = [];
    pool.forEach(function (p, i) { for (var k = 0; k < counts[i]; k++) seq.push(p.trackId); });
    return seq;
  }
  function serialSequence(pool, rated) {
    var seq = [], used = {}, i = 0, guard = 0;
    while (seq.length < rated && guard++ < 1000) {
      var p = pool[i % pool.length]; i++;
      if (p.cap != null && (used[p.trackId] || 0) >= p.cap) { if (pool.every(function (q) { return q.cap != null && (used[q.trackId] || 0) >= q.cap; })) break; continue; }
      used[p.trackId] = (used[p.trackId] || 0) + 1; seq.push(p.trackId);
    }
    while (seq.length < rated) seq.push(pool[0].trackId);
    return seq;
  }
  function randomSequence(pool, rated, rng, must) {
    var seq = [], used = {};
    // versions introduced this session come first (they also get the warm-up), then random draws
    (must || []).forEach(function (tid) {
      if (seq.length < rated && pool.some(function (p) { return p.trackId === tid; })) { seq.push(tid); used[tid] = (used[tid] || 0) + 1; }
    });
    for (var i = seq.length; i < rated; i++) {
      var cands = pool.filter(function (p) {
        if (p.cap != null && (used[p.trackId] || 0) >= p.cap) return false;
        var n = seq.length;
        return !(n >= 2 && seq[n - 1] === p.trackId && seq[n - 2] === p.trackId);
      });
      if (!cands.length) cands = pool.filter(function (p) { return p.cap == null; });
      if (!cands.length) cands = pool;
      var pick = rng.weighted(cands, cands.map(function (p) { return p.w; }));
      used[pick.trackId] = (used[pick.trackId] || 0) + 1;
      seq.push(pick.trackId);
    }
    return seq;
  }

  function emitSegment(plan, d, task, seq, opts) {
    if (!seq.length) return;
    opts = opts || {};
    var first = seq[0];
    mkSlot(plan, { trackId: first, role: 'warmup', set: opts.setFor ? opts.setFor(first) : null, lessonId: lessonFor(d, first), strategyCard: opts.card || null });
    var lessonGiven = {}; lessonGiven[first] = true;
    seq.forEach(function (id) {
      var lid = null;
      if (!lessonGiven[id]) { lid = lessonFor(d, id); lessonGiven[id] = true; }
      mkSlot(plan, { trackId: id, role: 'rated', set: opts.setFor ? opts.setFor(id) : null, lessonId: lid, strategyCard: opts.card || null });
    });
  }

  /** estMinutes: per block the learner's measured median duration on that track (derived.tracks[id].blockMs, from
   *  ≥ 3 finished blocks — Grid and search blocks end on the answer, so the catalog estimate can be far off), else the
   *  catalog estimate; plus 15 s for the rule card and debrief. Block counts never depend on it (Phase 4 addendum). */
  function baseInfo(d, plan) {
    plan.estMinutes = Math.round(plan.slots.reduce(function (s, sl) {
      if (!sl.trackId) return s + 1.7;
      var t = d.tracks[sl.trackId], r = sl.role === 'protocol' ? 0 : (t ? t.level : 0);
      var ms = t && isNum(t.blockMs) ? t.blockMs : C().estBlockMs(sl.trackId, C().params(sl.trackId, r));
      return s + (ms + 15000) / 60000;
    }, 0));
    return plan;
  }

  function newPlan(d, id, modeId, requested, extra) {
    var p = { id: id, modeId: modeId, requestedMode: requested, protocol: null, study: null, sessionIndex: d.sessionIndex,
      phase: phaseFor(modeId, d.sessionIndex), glyphs: glyphFamily(d.sessionIndex), slots: [], estMinutes: 0, introduce: [],
      reflection: false, free: false, notes: [] };
    for (var k in (extra || {})) p[k] = extra[k];
    return p;
  }

  /** The 'not-counted' note for a fresh HF.goals.canCountNow() result (plan() adds it; Phase 4, CA-03). */
  function notCountedNote(cc) {
    return { code: 'not-counted', reason: cc.reason, text: cc.reason === 'week-cap' ? 'This week\'s counted sessions are done (Stretch: at most 4 a week). This one is extra practice.' : (cc.reason === 'gap' ? 'Counted sessions need a gap (Sprint 3 h, Stretch 20 h). This one is extra practice.' : 'Today\'s counted sessions are done. This one is extra practice.') };
  }
  var AFTER_COUNTS = { 'programme-complete': 1, 'span-offer': 1, 'stretch-valve': 1, assist: 1 };

  function commonNotes(plan, d) {
    var dual = d.tracks['nback.dual'];
    if (d.soundOff && dual.blockedBy === 'sound' && (dual.introduced || d.settings.dual || (plan.modeId === 'varied' || plan.modeId === 'stretch') && d.sessionIndex >= 8))
      plan.notes.push({ code: 'sound-off', text: 'Sound is off, so Dual n-back and sound-based sets are left out' + (dual.introduced ? '' : ' (Dual joins once sound is on again)') + '.' });
    if (d.programme && d.programme.complete) {
      plan.notes.push({ code: 'programme-complete', text: 'The 20-session programme is complete. Any training style works from here.' });
      if (!d.settings.spanOn) plan.notes.push({ code: 'span-offer', text: 'Span (complex span) is now offered: turn it on in Settings.' });
    }
    if (d.stretch && d.stretch.valve && d.stretch.valve.active && d.mode.requested === 'stretch')
      plan.notes.push({ code: 'stretch-valve', text: 'Your last two Stretch sessions averaged under 62 %. Varied or Mastery Path may suit you better for now.' });
  }

  // ---------- Varied / Stretch ----------
  function mixedPlan(d, id, modeId, requested, minutes, opts) {
    var plan = newPlan(d, id, modeId, requested);
    var intro = introductions(d, d.sessionIndex);
    plan.introduce = intro;
    var counts = taskCounts(d.settings, minutes, opts.noSpan);
    var rng = rngFor(id);
    var segs = counts.map(function (c) {
      var pool = poolFor(d, c.task, intro, modeId);
      var seq;
      if (!pool.length) seq = [];
      else if (plan.phase === 'blocked') seq = blockedSequence(pool, c.rated);
      else if (plan.phase === 'serial') seq = serialSequence(pool, c.rated);
      else seq = randomSequence(pool, c.rated, rng, intro);
      return { task: c.task, seq: seq };
    }).filter(function (s) { return s.seq.length; });
    var setFor = plan.phase === 'blocked' && modeId === 'varied' ? function (tid) { return C().defaultSet(tid); } : null;
    if (plan.phase === 'random') {
      // warm-up of each task at its first appearance; tasks alternate every 2 blocks
      var queues = segs.map(function (s) { return { task: s.task, seq: s.seq.slice(), started: false }; }), qi = 0, guard = 0;
      var lessonGiven = {};
      while (queues.some(function (q) { return q.seq.length; }) && guard++ < 500) {
        var q = queues[qi % queues.length]; qi++;
        if (!q.seq.length) continue;
        if (!q.started) {
          var f = q.seq[0];
          mkSlot(plan, { trackId: f, role: 'warmup', lessonId: lessonFor(d, f) }); lessonGiven[f] = true; q.started = true;
        }
        for (var k = 0; k < 2 && q.seq.length; k++) {
          var tid = q.seq.shift(), lid = null;
          if (!lessonGiven[tid]) { lid = lessonFor(d, tid); lessonGiven[tid] = true; }
          mkSlot(plan, { trackId: tid, role: 'rated', lessonId: lid });
        }
      }
    } else {
      if (d.sessionIndex % 2 === 0) segs.reverse();
      segs.forEach(function (s) { emitSegment(plan, d, s.task, s.seq, { setFor: setFor }); });
    }
    var every = HF.modes.get(modeId).reflectionEvery;
    plan.reflection = !!every && d.sessionIndex % every === 0;
    if (plan.reflection) plan.notes.push({ code: 'reflection', text: 'After this session: one question about how you did the tasks.' });
    intro.forEach(function (tid) { plan.notes.push({ code: 'new-track', trackId: tid, text: 'New today: ' + C().get(tid).name + '.' }); });
    var avail = C().ids().filter(function (tid) { return tid !== 'vs.search' && d.tracks[tid].available; });
    var allIn = avail.length > 0 && avail.every(function (tid) { return d.tracks[tid].introduced || intro.indexOf(tid) >= 0; });
    if (allIn) plan.notes.push({ code: 'all-introduced', text: 'All versions introduced — from now on Long-Horizon keeps mixing them (maintenance).' });
    commonNotes(plan, d);
    return baseInfo(d, plan);
  }

  // ---------- Sprint ----------
  function sprintPlan(d, id, minutes, opts) {
    var plan = newPlan(d, id, 'sprint', 'sprint');
    var sprintNo = 1 + sprintSessions(opts.records);
    var counts = taskCounts(d.settings, minutes, false);
    var T = d.tracks;
    var nb = d.settings.sprint && d.settings.sprint.nback;
    if (!nb || !T[nb] || C().get(nb).task !== 'nback' || !T[nb].available) nb = 'nback.plain';
    var relPool = C().tracksOfTask('relations').filter(function (tid) { return C().get(tid).tier && T[tid].available; });
    var rel = newestTier(d, relPool) || 'rel.grid.T1';
    var fixed = { nback: nb, relations: rel, span: 'span.op' };
    var setOf = function (tid) {
      var list = C().trainingSets(tid);
      if (C().get(tid).tier && list.indexOf('digits') >= 0) return 'digits';
      return C().defaultSet(tid);
    };
    var segs = counts.filter(function (c) { return c.task !== 'span' || T['span.op'].available; });
    if (sprintNo % 2 === 0) segs = segs.slice().reverse();
    segs.forEach(function (c) {
      var tid = fixed[c.task], seq = []; for (var i = 0; i < c.rated; i++) seq.push(tid);
      var card = sprintNo <= HF.modes.get('sprint').strategySessions ? (c.task === 'nback' ? 'nback-grouping' : (c.task === 'relations' ? 'ri-scan' : null)) : null;
      emitSegment(plan, d, c.task, seq, { setFor: setOf, card: card });
    });
    plan.sprintSession = sprintNo;
    plan.introduce = segs.map(function (c) { return fixed[c.task]; }).filter(function (tid) { return !T[tid].introduced; });
    commonNotes(plan, d);
    return baseInfo(d, plan);
  }
  function sprintSessions(records) {
    var n = 0; (records && records.sessions || []).forEach(function (s) { if (s && s.mode === 'sprint') n++; });
    return n;
  }

  // ---------- Mastery Path ----------
  function masteryPlan(d, id, minutes) {
    var plan = newPlan(d, id, 'mastery', 'mastery');
    var counts = taskCounts(d.settings, minutes, false), ms = d.mastery, M = HF.mastery;
    var segs = d.sessionIndex % 2 === 0 ? counts.slice().reverse() : counts;
    segs.forEach(function (c) {
      var task = c.task;
      if (task === 'span') {
        var pool = poolFor(d, 'span', [], 'mastery');
        if (pool.length) emitSegment(plan, d, task, serialSequence(pool, c.rated));
        return;
      }
      var slotsLeft = c.rated, items = [];
      var chk = ms.checkDue[task], rev = ms.reviewDue[task], cur = ms.current[task];
      if (cur && !d.tracks[M.unit(cur).trackId].available) {
        plan.notes.push({ code: 'unit-waiting', unitId: cur, text: ms.units[cur].label + ' opens later: ' + C().gateText(M.unit(cur).trackId) });
        cur = null;
      }
      if (chk) { var u = M.unit(chk); items.push({ trackId: u.trackId, role: 'check', purpose: 'check', unitId: chk }); items.push({ trackId: u.trackId, role: 'check', purpose: 'check', unitId: chk }); }
      if (rev) { var ru = M.unit(rev.unitId); items.push({ trackId: ru.trackId, role: 'check', purpose: 'review', unitId: rev.unitId }); }
      var unitSlots = Math.max(1, slotsLeft - items.length);
      if (cur || chk) {
        var cu = cur ? M.unit(cur) : M.unit(chk);
        for (var i = 0; i < unitSlots; i++) items.push({ trackId: cu.trackId, role: 'rated', purpose: 'unit', unitId: cur || null, unitTask: task });
      } else {
        // path finished for this task: "moved on" to maintenance (Varied-style random)
        var mpool = poolFor(d, task, [], 'varied');
        randomSequence(mpool, unitSlots, rngFor(id + task)).forEach(function (tid) { items.push({ trackId: tid, role: 'rated', purpose: 'maintenance' }); });
        plan.notes.push({ code: 'path-done', task: task, text: 'You have moved on from every ' + (task === 'nback' ? 'n-back' : 'Relations') + ' unit: maintenance practice.' });
      }
      var first = items[0];
      mkSlot(plan, { trackId: first.trackId, role: 'warmup', lessonId: lessonFor(d, first.trackId), unitId: first.unitId, purpose: 'warmup', unitTask: task });
      var given = {}; given[first.trackId] = true;
      items.forEach(function (it) {
        var lid = null; if (!given[it.trackId]) { lid = lessonFor(d, it.trackId); given[it.trackId] = true; }
        mkSlot(plan, { trackId: it.trackId, role: it.role, purpose: it.purpose, unitId: it.unitId, lessonId: lid, unitTask: it.unitTask || task });
      });
      if (chk) plan.notes.push({ code: 'mastery-check', unitId: chk, text: 'Check today: ' + ms.units[chk].label + ' on fresh material (pass at 80 %).' });
      if (rev) plan.notes.push({ code: 'mastery-review', unitId: rev.unitId, text: 'Review today: ' + ms.units[rev.unitId].label + '.' });
    });
    plan.introduce = plan.slots.map(function (s) { return s.trackId; }).filter(function (tid, i, a) { return tid && a.indexOf(tid) === i && !d.tracks[tid].introduced; });
    commonNotes(plan, d);
    return baseInfo(d, plan);
  }

  // ---------- Free play ----------
  function freePlan(d, id, minutes) {
    var plan = newPlan(d, id, 'free', 'free', { free: true, phase: 'free' });
    var n = Math.max(4, Math.round(14 * minutes / 25));
    for (var i = 0; i < n; i++) mkSlot(plan, { trackId: null, role: 'free', taskId: null });
    plan.notes.push({ code: 'free', text: 'Choose a version and level for each block; the coach suggests.' });
    commonNotes(plan, d);
    return baseInfo(d, plan);
  }
  function freeSlot(plan, choice) {
    choice = choice || {};
    var open = null;
    for (var i = 0; i < plan.slots.length; i++) if (!plan.slots[i].trackId && plan.slots[i].role === 'free') { open = plan.slots[i]; break; }
    if (!open) open = mkSlot(plan, { trackId: null, role: 'free' });
    open.trackId = choice.trackId; open.taskId = C().get(choice.trackId).task;
    if (isNum(choice.rung)) open.rung = choice.rung;
    if (choice.set) open.set = choice.set;
    return open;
  }

  // ---------- Protocols ----------
  function protocolState(d, pid, arm) {
    if (pid === 'cao') return arm === 'trad' ? d.protocols.caoTrad : d.protocols.cao;
    return d.protocols[pid];
  }
  function protocolPlan(d, id, ids, opts) {
    var P = HF.protocols, plan = newPlan(d, id, 'protocols', 'protocols', { phase: 'protocol' });
    var arm = opts.caoArm || d.settings.caoArm || 'exec';
    var chosen = null, status = [];
    ids.forEach(function (pid) {
      var st = protocolState(d, pid, arm), du = P.due(pid, st, d.now);
      if (pid === 'jaeggi' && d.soundOff) du = { due: false, reason: 'needs-sound', label: 'Dual n-back needs sound: turn sound on in Settings' };
      status.push({ protocol: pid, due: du });
      if (!chosen && du.due) chosen = { pid: pid, due: du, st: st };
    });
    plan.protocolStatus = status;
    if (!chosen) {
      if (status.some(function (x) { return x.due.reason === 'needs-sound'; })) plan.notes.push({ code: 'sound-off', text: 'Jaeggi\'s dual n-back needs sound: turn sound on in Settings to run it.' });
      plan.notes.push({ code: 'protocol-not-due', text: 'Nothing is due in your protocols today. You can choose another training style.' });
      commonNotes(plan, d);
      return baseInfo(d, plan);
    }
    var pid = chosen.pid, def = P.DEF[pid];
    plan.protocol = pid;
    plan.protocolLabel = chosen.due.label;
    if (pid === 'cao') {
      var trackId = arm === 'trad' ? def.tradTrackId : def.trackId, n = chosen.due.purpose === 'followup' ? def.followupBlocks : def.blocks;
      for (var i = 0; i < n; i++) mkSlot(plan, { trackId: trackId, role: 'protocol', protocol: 'cao', set: 'days', purpose: chosen.due.purpose });
      plan.caoArm = arm;
      if (chosen.due.reason === 'late') plan.notes.push({ code: 'cao-late', text: 'Cao\'s sessions were 1–2 days apart; it has been longer. The protocol continues.' });
      if (chosen.due.complete) plan.notes.push({ code: 'protocol-complete', text: 'Protocol complete (6 sessions). This is an extra session.' });
    } else if (pid === 'wang') {
      for (var j = 0; j < chosen.due.blocksLeft; j++) mkSlot(plan, { trackId: def.trackId, role: 'protocol', protocol: 'wang', set: C().defaultSet(def.trackId), purpose: 'train' });
      plan.notes.push({ code: 'wang-feedback', text: 'Wang\'s protocol shows only the day\'s accuracy, after the last block.' });
    } else {
      var snd = d.settings.sound === 'letters' && C().trainingSets(def.trackId).indexOf('lettersAudio') >= 0 ? 'lettersAudio' : 'tones';
      for (var k = 0; k < def.blocks; k++) mkSlot(plan, { trackId: def.trackId, role: 'protocol', protocol: 'jaeggi', set: snd, purpose: 'train' });
    }
    commonNotes(plan, d);
    return baseInfo(d, plan);
  }

  // ---------- Study arms ----------
  function studyPlan(d, id, study, minutes, opts) {
    var arm = C().studyArmKind(study.arm), plan;   // HF.study arm ids → train / control / … (catalog)
    if (arm === 'labonly') {
      plan = newPlan(d, id, 'varied', 'study', { phase: 'none' });
      plan.notes.push({ code: 'study-labonly', text: 'Your study group does the Lab visits only. Thank you!' });
    } else if (arm === 'train') {
      plan = mixedPlan(d, id, 'varied', 'study', minutes, { noSpan: true });
    } else if (arm === 'cao-exec' || arm === 'cao-trad') {
      plan = protocolPlan(d, id, ['cao'], { caoArm: arm === 'cao-trad' ? 'trad' : 'exec' });
    } else if (arm === 'wang-steps') {
      plan = protocolPlan(d, id, ['wang'], {});
    } else if (arm === 'control') {
      plan = newPlan(d, id, 'varied', 'study', { phase: 'blocked' });
      var n;
      if (study.template === 'cao') n = HF.protocols.DEF.cao.blocks;
      else if (study.template === 'wang') n = HF.protocols.DEF.wang.blocksPerDay;
      else n = 1 + taskCounts(d.settings, minutes, true).reduce(function (s, c) { return s + c.rated; }, 0);
      var seq = []; for (var i = 1; i < n; i++) seq.push('vs.search');
      emitSegment(plan, d, 'vsearch', seq.length ? seq : ['vs.search']);
      plan.introduce = d.tracks['vs.search'].introduced ? [] : ['vs.search'];
      commonNotes(plan, d);
      baseInfo(d, plan);
    } else {
      plan = newPlan(d, id, 'varied', 'study', { phase: 'none' });
      plan.notes.push({ code: 'study-unknown-arm', text: 'Unknown study arm: ' + study.arm });
    }
    plan.study = { template: study.template, arm: study.arm };
    plan.slots.forEach(function (s) { s.study = plan.study; });
    return plan;
  }

  // ---------- plan ----------
  function plan(records, derived, opts) {
    opts = opts || {};
    var now = isNum(opts.now) ? opts.now : (derived && isNum(derived.now) ? derived.now : 0);
    var d = derived || HF.engine.derive(records, now);
    var p = build(records, d, opts, now);
    // "Would this session count?" is computed now, not taken from derived.today (the store caches derived per day, but
    // the Sprint 3 h / Stretch 20 h gaps depend on the hour) — Phase 4, CA-03. The mode is the one the session record
    // will carry (HF.goals.sessionMode: a protocol session counts as 'protocols').
    p.counts = HF.goals.canCountNow(d.countedList || [], now, p.protocol ? 'protocols' : p.modeId);
    if (!p.counts.ok && p.slots.length) {
      var at = p.notes.length;
      for (var i = 0; i < p.notes.length; i++) if (AFTER_COUNTS[p.notes[i].code]) { at = i; break; }
      p.notes.splice(at, 0, notCountedNote(p.counts));
    }
    return p;
  }

  function build(records, d, opts, now) {
    var id = opts.id || newId(now);
    var minutes = Math.max(10, Math.min(30, num(opts.minutes, d.settings.sessionMinutes)));
    var study = opts.study !== undefined ? opts.study : d.study;
    if (study && study.left != null) study = null;   // 'study-leave': plan the chosen mode normally (Phase 4 addendum)
    if (study && study.arm) return studyPlan(d, id, study, minutes, opts);
    if (study && !study.arm) {
      var w = newPlan(d, id, 'varied', 'study', { phase: 'none', study: { template: study.template, arm: null } });
      w.notes.push({ code: 'study-awaiting-arm', text: 'Study mode: training starts once your group is drawn (after Baseline 2).' });
      return w;
    }
    var requested = opts.modeId || d.settings.mode;
    if (!HF.modes.exists(requested)) requested = 'varied';
    if (requested === 'protocols') {
      var ids = opts.protocolIds || HF.protocols.ids.filter(function (p) { return d.settings.protocols && d.settings.protocols[p]; });
      if (!ids.length) ids = ['cao'];
      return protocolPlan(d, id, ids, opts);
    }
    var modeId = requested, lockNote = null;
    if (modeId === 'stretch' && !d.stretch.open) { modeId = 'varied'; lockNote = { code: 'stretch-locked', text: 'Stretch opens after 6 counted sessions; this session runs in Varied.' }; }
    var p;
    if (modeId === 'free') p = freePlan(d, id, minutes);
    else if (modeId === 'mastery') p = masteryPlan(d, id, minutes);
    else if (modeId === 'sprint') p = sprintPlan(d, id, minutes, { records: records });
    else p = mixedPlan(d, id, modeId, requested, minutes, opts);
    if (lockNote) { p.requestedMode = 'stretch'; p.notes.unshift(lockNote); }
    Object.keys((d.assist && d.assist.tracks) || {}).forEach(function (at) {
      if (!d.assist.tracks[at].active) return;
      var any = false;
      p.slots.forEach(function (s) { if (s.trackId === at && s.role === 'rated') { s.role = 'assist'; s.purpose = 'assist'; any = true; } });
      // the aid differs by task (Phase 4, PQ-03): n-back shows the memory tape, the Relation Grid highlights what counts
      var aid = C().get(at).task === 'nback' ? 'tape' : 'highlight';
      if (any) p.notes.push({ code: 'assist', trackId: at, aid: aid, text: C().get(at).name + (aid === 'tape'
        ? ' blocks show the memory tape (the last items, with the one to compare framed) until two blocks reach the check criterion.'
        : ' blocks highlight the symbols that count until two blocks reach the check criterion.') });
    });
    return p;
  }

  // ---------- prepare ----------
  function playedRung(trackId, level, modeId) {
    var allowed = C().allowedRungs(trackId, modeId);
    for (var i = 0; i < allowed.length; i++) if (allowed[i] >= level) return allowed[i];
    return allowed[allowed.length - 1];
  }
  function allowedAtOrBelow(trackId, rung, modeId) {
    var allowed = C().allowedRungs(trackId, modeId), best = allowed[0];
    for (var i = 0; i < allowed.length; i++) if (allowed[i] <= rung) best = allowed[i];
    return best;
  }

  function chooseSet(trackId, d, slot, rng) {
    var list = audible(C().trainingSets(trackId), d, trackId), last = (d.tracks[trackId] && d.tracks[trackId].setLast) || {};
    var fam = slot.glyphs || glyphFamily(slot.sessionIndex);
    function resolve(s) { return s === 'glyphs' ? fam : s; }
    function lastUse(s) {
      if (s !== 'glyphs') return isNum(last[s]) ? last[s] : -1;
      var m = -1; for (var k in last) if (C().normSet(k) === 'glyphs' && last[k] > m) m = last[k]; return m;
    }
    var scored = list.map(function (s, i) { return { s: s, t: lastUse(s), i: i, r: rng.next() }; });
    scored.sort(function (a, b) { return a.t - b.t || a.r - b.r; });
    return resolve(scored[0].s);
  }

  /** With sound off, drop audio sets (Dual itself is never scheduled then). */
  function audible(list, d, trackId) {
    if (!d || !d.soundOff) return list;
    var out = list.filter(function (s) { return C().contentFamily(s) !== 'audio'; });
    return out.length ? out : (C().get(trackId).dualVisual ? list : [C().defaultSet(trackId)]);
  }

  function spanLimit(records, trackId) {
    var bl = records.blocks || [], vals = [];
    for (var i = bl.length - 1; i >= 0 && vals.length < 3; i--) {
      var b = bl[i];
      if (!b || C().get(b.trackId) == null || C().get(b.trackId).task !== 'span') continue;
      var ex = b.result && b.result.extra;
      if (ex && isNum(ex.procRtMean) && isNum(ex.procRtSd)) vals.push(ex.procRtMean + 2.5 * ex.procRtSd);
      else if (ex && isNum(ex.procLimitNext)) vals.push(ex.procLimitNext);
    }
    if (!vals.length) return 4000;
    var m = 0; vals.forEach(function (v) { m += v; }); m /= vals.length;
    return Math.round(Math.max(2500, Math.min(8000, m)));
  }

  function feedbackFor(modeId, settings, protocol, blockNo) {
    if (protocol === 'wang') return { perResponse: false, summary: false, showLevel: false, revealAtEnd: false, dayAccuracyAtEnd: true };
    if (protocol) return { perResponse: false, summary: false, showLevel: true, revealAtEnd: false, dayAccuracyAtEnd: false };
    var m = HF.modes.get(modeId), f = m.feedback;
    var per = f.locked ? f.perResponse : (settings.perResponseFeedback == null ? f.perResponse : !!settings.perResponseFeedback);
    return { perResponse: per, summary: f.summaryEvery === 1 ? true : (blockNo % f.summaryEvery === 0), showLevel: !f.revealAtEnd, revealAtEnd: !!f.revealAtEnd, dayAccuracyAtEnd: false };
  }

  function prepare(slot, records, derived, sessionState) {
    records = records || {};
    var ss = sessionState || {}, d = derived || HF.engine.derive(records, ss.now);
    var sessionId = ss.sessionId || slot.sessionId || 'session';
    var sb = (records.blocks || []).filter(function (b) { return b && b.sessionId === sessionId; });
    var attempt = sb.filter(function (b) { return b.slotId === slot.slotId; }).length + (ss.attempt || 0);
    var modeId = slot.modeId || 'varied', role = slot.role, purpose = slot.purpose || null, unitId = slot.unitId || null;
    var trackId = slot.trackId, capRung = null, protocol = slot.protocol || null, replaced = null;
    if (!trackId) throw new Error('planner.prepare: slot has no trackId (Free play: use freeSlot first)');
    if (d.soundOff && C().get(trackId).dualVisual && role !== 'protocol') { replaced = trackId; trackId = 'nback.plain'; }   // sound turned off mid-session
    var aTrack = d.assist && d.assist.tracks && d.assist.tracks[trackId];
    if (role === 'assist' && !(aTrack && aTrack.active)) { role = 'rated'; purpose = null; }   // the aid has faded
    else if (role === 'rated' && aTrack && aTrack.active) { role = 'assist'; purpose = 'assist'; }
    var seed = sessionId + ':' + slot.slotId + ':' + attempt, rng = HF.rng.create('prep:' + seed);
    var level, rung;

    if (role === 'protocol') {
      var st = protocolState(d, protocol, trackId === HF.protocols.DEF.cao.tradTrackId ? 'trad' : 'exec');
      var pb = sb.filter(function (b) { return b.protocol === protocol && b.trackId === trackId; });
      rung = HF.protocols.nextRung(protocol, st, pb, purpose);
      level = rung;
    } else {
      if (modeId === 'mastery' && purpose !== 'maintenance' && (slot.unitTask || unitId)) {
        var task = slot.unitTask || C().get(trackId).task, ms = d.mastery, M = HF.mastery;
        if (purpose === 'check' || purpose === 'review') {
          var u0 = M.unit(unitId); trackId = u0.trackId; capRung = u0.target;
        } else if (role !== 'warmup') {
          // a failed check earlier in this session → corrective cycle on that unit
          var failed = null;
          (records.events || []).forEach(function (e) {
            if (e && e.type === 'mastery-check' && !e.pass && e.sessionId === sessionId && M.unit(e.unitId) && C().get(M.unit(e.unitId).trackId).task === task) failed = e;
          });
          var planned = unitId && ms.units[unitId], live = { open: 1, 'pending-check': 1, reopened: 1 };
          if (failed && ms.units[failed.unitId].status === 'pending-check') { unitId = failed.unitId; purpose = 'corrective'; }
          else if (planned && live[planned.status]) { purpose = 'unit'; }          // one unit per task per session
          else {
            var nu = ms.current[task] ? ms.units[ms.current[task]] : null;
            // never start a new version mid-session without its lesson
            if (nu && (d.tracks[nu.trackId].blocks > 0 || !lessonFor(d, nu.trackId))) { unitId = nu.id; purpose = 'unit'; }
            else { unitId = null; purpose = 'maintenance'; }
          }
          if (unitId) { var u1 = M.unit(unitId); trackId = u1.trackId; capRung = u1.target; }
          else if (!(d.tracks[trackId].blocks > 0 || !lessonFor(d, trackId))) {
            var mp = poolFor(d, task, [], 'varied').filter(function (p) { return d.tracks[p.trackId].blocks > 0; });
            if (mp.length) trackId = rng.weighted(mp, mp.map(function (p) { return p.w; })).trackId;
          }
        } else if (unitId) { capRung = M.unit(unitId).target; }
      }
      if (modeId === 'stretch' && C().get(trackId).tier && C().get(trackId).tier < 8) {
        var nextTier = 'rel.grid.T' + (C().get(trackId).tier + 1);
        if (d.tracks[nextTier] && d.tracks[nextTier].available) capRung = 5;
      }
      level = d.tracks[trackId].level;
      var base = playedRung(trackId, isNum(capRung) ? Math.min(level, capRung) : level, modeId);
      if (role === 'warmup') rung = allowedAtOrBelow(trackId, Math.max(0, base - C().get(trackId).warmupDrop), modeId);
      else if (role === 'check') rung = capRung;
      else if (role === 'free') rung = isNum(slot.rung) ? Math.max(0, Math.min(C().maxRung(trackId), slot.rung)) : level;
      else if (role === 'assist') rung = trackId === 'nback.plain' ? 2 : level;   // the tutorial check is 2-back
      else if (purpose === 'corrective') {
        var nCorr = sb.filter(function (b) { return b.purpose === 'corrective' && b.unitId === unitId; }).length;
        rung = nCorr < 3 ? Math.max(0, capRung - 1) : capRung;
      } else rung = base;
    }

    var tr = C().get(trackId);
    var params = C().params(trackId, rung);
    var set = slot.set || null;
    if (set && d.soundOff && C().contentFamily(set) === 'audio' && !tr.dualVisual) set = null;
    if (replaced) set = null;
    if (!set) set = (purpose === 'check' || modeId !== 'varied' || slot.phase !== 'blocked') ? chooseSet(trackId, d, slot, rng) : C().defaultSet(trackId);
    if (set === 'glyphs') set = slot.glyphs || glyphFamily(slot.sessionIndex);
    var lureMode = 'controlled', lureCount = null;
    if (protocol) { lureMode = HF.protocols.DEF[protocol].lureMode; lureCount = lureMode === 'uncontrolled' ? null : 4; }
    else if (tr.task === 'nback') {
      // position lures at n±1 (SPEC §5 amended): 4, Stretch 6; the generator adds the version-specific lures and
      // uses none at 1-back (Switch: half the count as uncued lures)
      lureCount = modeId === 'stretch' ? HF.modes.get('stretch').lures : 4;
    } else if (trackId === 'rel.steps') {
      // Equal Steps near misses (the generator's lureCount): 4, Stretch 6, so that "within ±1 of the last step"
      // (BA .857 with 4, .786 with 6) stays below every style's effective U (SPEC §4.6, amended 12 Nov)
      lureCount = modeId === 'stretch' ? HF.modes.get('stretch').lures : 4;
    }
    if (trackId === 'nback.transform') {
      var step = 1;
      if (config.transformVariants && !protocol && set !== 'days' && (modeId === 'stretch' || modeId === 'free' || (modeId === 'varied' && slot.phase === 'random'))
        && d.tracks[trackId].ratedBlocks >= config.variantAfterBlocks) step = rng.pick(config.transformSteps);
      params.step = step;
    }
    if (tr.task === 'span') params.procLimitMs = spanLimit(records, trackId);
    var targets = protocol === 'wang' ? HF.protocols.DEF.wang.targets : null;
    var blockNo = sb.length + 1;
    var bp = {
      slotId: slot.slotId, sessionId: sessionId, index: slot.index, trackId: trackId, taskId: tr.task, role: role, purpose: purpose,
      unitId: unitId, protocol: protocol, modeId: protocol ? 'protocols' : modeId, study: slot.study || null,
      rung: rung, levelBefore: level, capRung: capRung, params: params, set: set, seed: seed,
      lureCount: lureCount, lureMode: lureMode, targets: targets,
      ruleCard: C().ruleCard(trackId, rung, set, { step: params.step }),
      feedback: feedbackFor(modeId, d.settings, protocol, blockNo),
      strategyCard: slot.strategyCard || null, lessonId: slot.lessonId || null,
      label: C().levelLabel(trackId, rung), attempt: attempt, assist: role === 'assist', replaced: replaced,
      aid: role === 'assist' ? (tr.task === 'nback' ? 'tape' : 'highlight') : null   // which memory aid (PQ-03)
    };
    bp.predicted = HF.learner.predictBA(d.model, trackId, rung, set, { lureCount: lureCount, lureMode: lureMode, step: params.step });
    return bp;
  }

  var api = {
    config: config, INTRO: INTRO, plan: plan, prepare: prepare, freeSlot: freeSlot,
    phaseFor: phaseFor, glyphFamily: glyphFamily, allocate: allocate, taskCounts: taskCounts, introductions: introductions,
    poolFor: poolFor, chooseSet: chooseSet, feedbackFor: feedbackFor
  };
  HF.planner = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
