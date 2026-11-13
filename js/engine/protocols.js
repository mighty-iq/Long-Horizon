/* Long-Horizon — published protocols (pure, no DOM). MIT licence.
 *
 * SPEC §6 / PLAN §4.1, §4.2a, research/08 (Cao 2026), research/09 (Wang 2025), research/01 §4.1 (Jaeggi 2008).
 * Each protocol has its own controller and session plan and ignores the mode thresholds.
 *
 *  cao    track nback.transform (days, +1 rule; Study arm 'cao-trad' uses nback.plain with days), uncontrolled
 *         lures, standard pace, rung = 2(n − 1). 20 blocks per session. After each block, over the 20 scorable
 *         items: correct (hits + correct rejections) > 18 → n + 1; errors (misses + false alarms) ≥ 5 → n − 1;
 *         else stay. Session 1 starts at 1-back; each later session at max(1, n reached at the end of the last
 *         session − 2) (Fellman et al. 2020's N-2 principle as used by Cao). Six sessions at least one calendar
 *         day apart (1–2 days recommended), then "protocol complete" (may continue). Follow-up check: 10 blocks
 *         starting at session 6's start level, offered ≥ 80 days after session 6.
 *  wang   track rel.steps, standard pace, levels L0–L7 (rung = 2L). 5 blocks of 20 scorable items a day. After
 *         the day's 5th valid block: raw accuracy over its 100 items > .80 → L + 1; < .50 → L − 1; else stay.
 *         Only the day's accuracy is shown, after the last block. 30 days. Blocks have 10 targets, 4 near misses and 6
 *         fillers per 20 items (SPEC §5 amended: never pressing then scores .50, so "< .50 → down" can fire).
 *  jaeggi track nback.dual, uncontrolled lures, standard pace, 20 blocks per session; errors per stream =
 *         misses + false alarms; fewer than 3 in both streams → n + 1; more than 5 in either → n − 1; else stay.
 *         Session 1 starts at 1-back; later sessions at the last level. Open-ended (20 sessions suggested).
 *
 * Choices where the papers are silent (also in docs/dev/engine-notes.md): "the level a session ended at" =
 * the level earned by its last block (levelAfter); a Cao/Jaeggi session counts toward the protocol when at
 * least 10 of its blocks were played; with voided trials the error counts are scaled to 20 items; paused
 * blocks move nothing (as everywhere); Wang counts only non-interrupted blocks toward a day's 5.
 *
 * API (HF.protocols):
 *   ids, DEF[id]
 *   counts(result) → { correct, errors, n, byStream: { s: { errors, n } } }
 *   caoMove(result, rung, trackId?) / jaeggiMove(result, rung) → { levelAfter, moved, reason }   (moved in n steps)
 *   wangDayMove(acc, rung) → { levelAfter, moved, reason }
 *   dayAccuracy(blocks) → raw accuracy over the blocks (hits + CR) / items
 *   state(protoBlocks, now) → { cao, caoTrad, wang, jaeggi }   (protoBlocks = BlockRecords with a protocol, time order)
 *   nextRung(id, st, sessionBlocks, purpose) → rung for the next block of this session
 *   due(id, st, now) → { due, reason, label, ... }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var EPS = 1e-9, DAY = 86400000;

  var DEF = {
    cao: { id: 'cao', label: 'Cao et al. 2026 · executive n-back', trackId: 'nback.transform', tradTrackId: 'nback.plain', set: 'days', step: 1,
      blocks: 20, sessions: 6, minGapDays: 1, maxGapDays: 2, followupBlocks: 10, followupAfterDays: 80, lureMode: 'uncontrolled', nMinus: 2, minBlocksForSession: 10 },
    wang: { id: 'wang', label: 'Wang et al. 2025 · Equal Steps', trackId: 'rel.steps', set: 'numbers', blocksPerDay: 5, days: 30, maxLevel: 7, up: 0.80, down: 0.50, lureMode: 'controlled',
      targets: 10 },   // SPEC §5 (amended 6 Nov): 10 targets, 4 near misses, 6 fillers per 20, so raw accuracy is symmetric
    jaeggi: { id: 'jaeggi', label: 'Jaeggi et al. 2008 · dual n-back', trackId: 'nback.dual', set: 'tones', blocks: 20, upErr: 3, downErr: 5, lureMode: 'uncontrolled',
      suggestedSessions: 20, minBlocksForSession: 10 }
  };
  var MAX_N = 16;   // = the n-back ladders' top (catalog, SPEC §5 amended 12 Nov: Phase 4 SC-05)

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function G() { return HF.goals; }

  function streamCounts(s) {
    if (!s) return null;
    var h = s.h != null ? s.h : s.hits, m = s.m != null ? s.m : s.misses, fa = s.fa != null ? s.fa : s.fas, cr = s.cr != null ? s.cr : s.crs;
    if (!isNum(h) || !isNum(m) || !isNum(fa) || !isNum(cr)) return null;
    return { h: h, m: m, fa: fa, cr: cr };
  }
  function counts(result) {
    var r = result || {}, streams = r.streams || {}, byStream = {}, correct = 0, errors = 0, n = 0, any = false;
    Object.keys(streams).forEach(function (k) {
      var c = streamCounts(streams[k]); if (!c) return;
      any = true;
      var e = c.m + c.fa, nn = c.h + c.m + c.fa + c.cr;
      byStream[k] = { errors: e, n: nn };
      correct += c.h + c.cr; errors += e; n += nn;
    });
    if (!any && r.extra && r.extra.protocols) {
      var p = r.extra.protocols;
      return { correct: p.correct, errors: p.errors, n: (p.correct || 0) + (p.errors || 0), byStream: {} };
    }
    return { correct: correct, errors: errors, n: n, byStream: byStream };
  }

  function nOfRung(rung) { return 1 + Math.floor(rung / 2); }
  function rungOfN(n) { return 2 * (Math.max(1, Math.min(MAX_N, n)) - 1); }

  function interrupted(result, flag) { return HF.controller.isInterrupted(result, flag); }

  function caoMove(result, rung, flag) {
    var n = nOfRung(rung);
    if (interrupted(result, flag)) return { levelAfter: rungOfN(n), moved: 0, reason: 'interrupted' };
    var c = counts(result);
    if (!(c.n > 0)) return { levelAfter: rungOfN(n), moved: 0, reason: 'no-data' };
    var main = c.byStream.main || { errors: c.errors, n: c.n };
    var e20 = main.errors * 20 / main.n, correct20 = 20 - e20;
    if (correct20 > 18 + EPS) return n < MAX_N ? { levelAfter: rungOfN(n + 1), moved: 1, reason: 'up' } : { levelAfter: rungOfN(n), moved: 0, reason: 'top' };
    if (e20 >= 5 - EPS) return n > 1 ? { levelAfter: rungOfN(n - 1), moved: -1, reason: 'down' } : { levelAfter: rungOfN(1), moved: 0, reason: 'bottom' };
    return { levelAfter: rungOfN(n), moved: 0, reason: 'stay' };
  }

  function jaeggiMove(result, rung, flag) {
    var n = nOfRung(rung);
    if (interrupted(result, flag)) return { levelAfter: rungOfN(n), moved: 0, reason: 'interrupted' };
    var c = counts(result), keys = Object.keys(c.byStream);
    if (!keys.length) return { levelAfter: rungOfN(n), moved: 0, reason: 'no-data' };
    var allFew = true, anyMany = false;
    keys.forEach(function (k) {
      var s = c.byStream[k], e20 = s.n > 0 ? s.errors * 20 / s.n : 0;
      if (!(e20 < DEF.jaeggi.upErr - EPS)) allFew = false;
      if (e20 > DEF.jaeggi.downErr + EPS) anyMany = true;
    });
    if (allFew) return n < MAX_N ? { levelAfter: rungOfN(n + 1), moved: 1, reason: 'up' } : { levelAfter: rungOfN(n), moved: 0, reason: 'top' };
    if (anyMany) return n > 1 ? { levelAfter: rungOfN(n - 1), moved: -1, reason: 'down' } : { levelAfter: rungOfN(1), moved: 0, reason: 'bottom' };
    return { levelAfter: rungOfN(n), moved: 0, reason: 'stay' };
  }

  function dayAccuracy(blocks) {
    var c = 0, n = 0;
    (blocks || []).forEach(function (b) { var k = counts(b.result); c += k.correct; n += k.n; });
    return n > 0 ? c / n : NaN;
  }
  function wangDayMove(acc, rung) {
    var L = Math.floor(rung / 2);
    if (!isNum(acc)) return { levelAfter: 2 * L, moved: 0, reason: 'no-data' };
    if (acc > DEF.wang.up + EPS) return L < DEF.wang.maxLevel ? { levelAfter: 2 * (L + 1), moved: 1, reason: 'up' } : { levelAfter: 2 * L, moved: 0, reason: 'top' };
    if (acc < DEF.wang.down - EPS) return L > 0 ? { levelAfter: 2 * (L - 1), moved: -1, reason: 'down' } : { levelAfter: 0, moved: 0, reason: 'bottom' };
    return { levelAfter: 2 * L, moved: 0, reason: 'stay' };
  }

  // ---------- state ----------
  function sessionsOf(blocks) {
    var map = {}, order = [];
    blocks.forEach(function (b) {
      var s = map[b.sessionId];
      if (!s) { s = map[b.sessionId] = { sessionId: b.sessionId, t: b.t, dayKey: G().dayKey(b.t), blocks: [], purpose: b.purpose === 'followup' ? 'followup' : 'train' }; order.push(s); }
      s.blocks.push(b);
    });
    order.forEach(function (s) {
      s.n = s.blocks.length;
      s.startRung = s.blocks[0].rung;
      s.startN = nOfRung(s.blocks[0].rung);
      var last = s.blocks[s.blocks.length - 1];
      s.endRung = isNum(last.levelAfter) ? last.levelAfter : last.rung;
      s.endN = nOfRung(s.endRung);
      s.meanN = s.blocks.reduce(function (a, b) { return a + nOfRung(b.rung); }, 0) / s.blocks.length;
    });
    return order;
  }

  function caoState(blocks, now) {
    var d = DEF.cao, sess = sessionsOf(blocks), train = sess.filter(function (s) { return s.purpose === 'train'; });
    var full = train.filter(function (s) { return s.n >= d.minBlocksForSession; });
    var last = train.length ? train[train.length - 1] : null;
    var nextStartN = last ? Math.max(1, last.endN - d.nMinus) : 1;
    var s6 = full.length >= d.sessions ? full[d.sessions - 1] : null;
    var fu = sess.filter(function (s) { return s.purpose === 'followup'; });
    var fuDone = fu.some(function (s) { return s.n >= d.followupBlocks; });
    var today = G().dayKey(now);
    var fuFrom = s6 ? G().addDays(s6.dayKey, d.followupAfterDays) : null;
    return {
      sessions: sess.map(function (s) { return { sessionId: s.sessionId, dayKey: s.dayKey, t: s.t, purpose: s.purpose, blocks: s.n, startN: s.startN, endN: s.endN, meanN: s.meanN }; }),
      sessionsDone: full.length,
      complete: full.length >= d.sessions,
      lastDayKey: last ? last.dayKey : null,
      lastEndN: last ? last.endN : null,
      nextStartN: nextStartN,
      playedToday: train.some(function (s) { return s.dayKey === today; }) || fu.some(function (s) { return s.dayKey === today; }),
      followup: { from: fuFrom, startN: s6 ? s6.startN : null, done: fuDone, due: !!(s6 && !fuDone && today >= fuFrom) }
    };
  }

  function wangState(blocks, now) {
    var d = DEF.wang, days = {}, order = [];
    blocks.forEach(function (b) {
      var k = G().dayKey(b.t);
      var day = days[k];
      if (!day) { day = days[k] = { dayKey: k, valid: [], all: 0, levelBefore: b.levelBefore != null ? b.levelBefore : b.rung }; order.push(day); }
      day.all++;
      if (!HF.controller.blockBad(b)) day.valid.push(b);
    });
    var level = 0, lastBlock = blocks.length ? blocks[blocks.length - 1] : null;
    if (lastBlock) level = isNum(lastBlock.levelAfter) ? lastBlock.levelAfter : lastBlock.rung;
    var done = order.filter(function (x) { return x.valid.length >= d.blocksPerDay; });
    var today = G().dayKey(now), td = days[today];
    return {
      days: order.map(function (x) {
        var five = x.valid.slice(0, d.blocksPerDay);
        return { dayKey: x.dayKey, blocks: x.valid.length, complete: x.valid.length >= d.blocksPerDay, acc: five.length >= d.blocksPerDay ? dayAccuracy(five) : NaN, level: Math.floor(x.levelBefore / 2) };
      }),
      level: Math.floor(level / 2), rung: 2 * Math.floor(level / 2),
      daysDone: done.length, complete: done.length >= d.days,
      blocksToday: td ? td.valid.length : 0,
      todayAcc: td && td.valid.length >= d.blocksPerDay ? dayAccuracy(td.valid.slice(0, d.blocksPerDay)) : NaN
    };
  }

  function jaeggiState(blocks, now) {
    var d = DEF.jaeggi, sess = sessionsOf(blocks), full = sess.filter(function (s) { return s.n >= d.minBlocksForSession; });
    var last = sess.length ? sess[sess.length - 1] : null, today = G().dayKey(now);
    return {
      sessions: sess.map(function (s) { return { sessionId: s.sessionId, dayKey: s.dayKey, t: s.t, blocks: s.n, startN: s.startN, endN: s.endN, meanN: s.meanN }; }),
      sessionsDone: full.length,
      level: last ? last.endRung : 0, levelN: last ? last.endN : 1,
      nextStartN: last ? last.endN : 1,
      playedToday: sess.some(function (s) { return s.dayKey === today; })
    };
  }

  function state(protoBlocks, now) {
    var by = { cao: [], caoTrad: [], wang: [], jaeggi: [] };
    (protoBlocks || []).forEach(function (b) {
      if (b.protocol === 'cao') (b.trackId === DEF.cao.tradTrackId ? by.caoTrad : by.cao).push(b);
      else if (b.protocol === 'wang') by.wang.push(b);
      else if (b.protocol === 'jaeggi') by.jaeggi.push(b);
    });
    return { cao: caoState(by.cao, now), caoTrad: caoState(by.caoTrad, now), wang: wangState(by.wang, now), jaeggi: jaeggiState(by.jaeggi, now) };
  }

  /** Rung of the next block. st = the protocol's state (cao / caoTrad / wang / jaeggi); sessionBlocks = this session's blocks of the protocol. */
  function nextRung(id, st, sessionBlocks, purpose) {
    var sb = sessionBlocks || [];
    if (id === 'wang') return st ? st.rung : 0;
    if (sb.length) { var b = sb[sb.length - 1]; return isNum(b.levelAfter) ? b.levelAfter : b.rung; }
    if (id === 'cao') {
      if (purpose === 'followup' && st && st.followup && st.followup.startN) return rungOfN(st.followup.startN);
      return rungOfN(st ? st.nextStartN : 1);
    }
    if (id === 'jaeggi') return rungOfN(st ? st.nextStartN : 1);
    return 0;
  }

  /** Is a session of this protocol due now? st = derived.protocols[...] entry. */
  function due(id, st, now) {
    var today = G().dayKey(now);
    if (id === 'cao') {
      var d = DEF.cao;
      if (st.followup && st.followup.due) return { due: true, reason: 'followup', purpose: 'followup', label: 'Follow-up check (10 blocks)' };
      if (st.playedToday) return { due: false, reason: 'played-today', next: G().addDays(today, 1) };
      var late = st.lastDayKey && st.sessionsDone > 0 && st.sessionsDone < d.sessions && G().dayDiff(st.lastDayKey, today) > d.maxGapDays;
      if (st.complete) return { due: true, reason: 'continue', purpose: 'train', label: 'Protocol complete — extra session', complete: true, followupFrom: st.followup.from };
      return { due: true, reason: late ? 'late' : 'session', purpose: 'train', label: 'Session ' + (st.sessionsDone + 1) + ' of ' + d.sessions, sessionNo: st.sessionsDone + 1 };
    }
    if (id === 'wang') {
      var w = DEF.wang;
      if (st.blocksToday >= w.blocksPerDay) return { due: false, reason: 'done-today', next: G().addDays(today, 1), todayAcc: st.todayAcc };
      return { due: true, reason: st.complete ? 'continue' : 'day', purpose: 'train', label: 'Day ' + Math.min(w.days, st.daysDone + 1) + ' of ' + w.days, blocksLeft: w.blocksPerDay - st.blocksToday, complete: st.complete };
    }
    if (id === 'jaeggi') {
      if (st.playedToday) return { due: false, reason: 'played-today', next: G().addDays(today, 1) };
      return { due: true, reason: 'session', purpose: 'train', label: 'Session ' + (st.sessionsDone + 1) + ' (about ' + DEF.jaeggi.suggestedSessions + ' suggested)' };
    }
    return { due: false, reason: 'unknown' };
  }

  var api = {
    ids: ['cao', 'wang', 'jaeggi'], DEF: DEF, MAX_N: MAX_N,
    counts: counts, caoMove: caoMove, jaeggiMove: jaeggiMove, wangDayMove: wangDayMove, dayAccuracy: dayAccuracy,
    state: state, nextRung: nextRung, due: due, nOfRung: nOfRung, rungOfN: rungOfN, _DAY: DAY
  };
  HF.protocols = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
