/* Long-Horizon — level controller (pure, no DOM). MIT licence.
 *
 * SPEC §6. One rule for every mode except Protocols (protocols.js has the papers' own rules):
 *   rated block: up if BA ≥ U, down if BA < D, else stay (BA = the weaker stream's BA); clamp to the ladder.
 *   Span: up if recall ≥ .80 (Stretch .70) and judgements ≥ .85; down if recall < .60.
 *   Sprint: +2 rungs per up move until the first down move on that track in this session.
 *   Placement: a track with no down move yet moves +2 rungs per up move (until its first down move).
 *   Free play: moves the level only when the block was played at the track's current level.
 *   Mastery Path: capped at the unit's target rung; a unit below the current level never lowers it.
 *   Stretch: moves along allowedRungs (fast half-steps only from 2-back on n-back tracks).
 *   Interrupted (any pause) or more than 20 % voided trials (Span: more than 1 of its 3 lists): no change (reason 'interrupted').
 *   Warm-up, check, assist, tutorial and probe blocks never move a level.
 *
 * API (HF.controller):
 *   next({ trackId, level, rung?, result, modeId, role, interrupted?, sessionState?, trackState? }) → { levelAfter, moved, reason }
 *       rung        = rung actually played (defaults to level)
 *       trackState  = { placing: bool, offset: number (self-correction), capRung: number|null }
 *       sessionState= { downMoved: { [trackId]: true } }   (down moves already made in this session)
 *       moved       = steps along the mode's allowed rungs (−1 … +2); reason ∈ up | up-double | up-placement |
 *                     down | stay | top | bottom | capped | below-level | off-level | interrupted | warmup | check | …
 *   decide(result, trackId, modeId, offset) → +1 | 0 | −1
 *   isInterrupted(result, flag, trackId?) → bool   (a BlockResult or compact result plus the block's paused flag)
 *   blockBad(blockRecord) → bool           (stored block: paused, voided share > voidLimit(trackId), or no score)
 *   voidLimit(trackId) → .2, or .34 for Span (one voided list of three still moves; Phase 4, CA-10)
 *   selfCorrect(offset, meanBA, target) → new offset (±.01 per window of 10, clamped to [−.01, +.05]; Phase 4 CA-02)
 *   fatigue(bas) → bool   (bas = this session's rated BAs in order) two consecutive rated blocks
 *                          ≤ mean(first two) − .15, both after the first two
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var EPS = 1e-9;
  var LEVEL_ROLES = { rated: 1, free: 1 };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  /** Largest voided share a block may have and still move: 20 %; Span 1 of its 3 lists (Phase 4, CA-10 — one late
   *  frame voids a whole list, so 20 % would let a single dropped frame cancel the block). */
  var VOID_MAX = 0.2, SPAN_VOID_MAX = 0.34;
  function voidLimit(trackId) {
    var tr = trackId && HF.catalog && HF.catalog.get(trackId);
    return tr && tr.task === 'span' ? SPAN_VOID_MAX : VOID_MAX;
  }
  function isInterrupted(result, flag, trackId) {
    var r = result || {};
    if (flag || r.interrupted || r.paused) return true;
    if (isNum(r.voidedRatio) && r.voidedRatio > voidLimit(trackId || r.trackId)) return true;
    return !isNum(r.ba);
  }

  /** A stored BlockRecord that must move nothing: paused, too many voided trials (voidLimit), or without a score. */
  function blockBad(b) {
    if (!b) return true;
    if (isNum(b.voidedRatio) && b.voidedRatio > voidLimit(b.trackId)) return true;
    return isInterrupted(b.result, b.interrupted, b.trackId);
  }

  function procAccOf(r) {
    if (r && r.extra && isNum(r.extra.procAcc)) return r.extra.procAcc;
    if (r && isNum(r.procAcc)) return r.procAcc;
    return NaN;
  }

  function decide(result, trackId, modeId, offset) {
    var m = HF.modes.get(modeId), tr = HF.catalog.get(trackId), r = result || {};
    if (tr.scale === 'recall') {
      var recall = r.ba, pa = procAccOf(r), procOk = isNum(pa) ? pa >= m.spanProc - EPS : true;
      if (recall >= m.spanUp - EPS && procOk) return 1;
      if (recall < m.spanDown - EPS) return -1;
      return 0;
    }
    var t = HF.modes.thresholds(modeId === 'protocols' ? 'varied' : modeId, offset || 0);
    if (r.ba >= t.U - EPS) return 1;
    if (r.ba < t.D - EPS) return -1;
    return 0;
  }

  function nearestAllowed(allowed, rung) {
    for (var i = 0; i < allowed.length; i++) if (allowed[i] >= rung) return i;
    return allowed.length - 1;
  }

  function next(a) {
    var c = HF.catalog, trackId = a.trackId, modeId = a.modeId || 'varied';
    var max = c.maxRung(trackId);
    var level = Math.max(0, Math.min(max, Math.round(isNum(a.level) ? a.level : 0)));
    var played = isNum(a.rung) ? Math.max(0, Math.min(max, Math.round(a.rung))) : level;
    var ts = a.trackState || {}, ss = a.sessionState || {};
    function out(levelAfter, moved, reason) { return { levelAfter: levelAfter, moved: moved, reason: reason }; }

    if (!LEVEL_ROLES[a.role]) return out(level, 0, a.role || 'no-move');
    if (isInterrupted(a.result, a.interrupted, trackId)) return out(level, 0, 'interrupted');
    if (a.role === 'free' && played !== level) return out(level, 0, 'off-level');
    var cap = isNum(ts.capRung) ? ts.capRung : null;
    if (cap != null && level > cap) return out(level, 0, 'below-level');

    var allowed = c.allowedRungs(trackId, modeId);
    if (cap != null) allowed = allowed.filter(function (r) { return r <= cap; });
    if (!allowed.length) allowed = [0];
    var idx = nearestAllowed(allowed, played);
    var dir = decide(a.result, trackId, modeId, ts.offset);

    if (dir > 0) {
      var dbl = !!ts.placing || (HF.modes.get(modeId).doubleSteps === 'session' && !(ss.downMoved && ss.downMoved[trackId]));
      var k = dbl ? 2 : 1, j = Math.min(allowed.length - 1, idx + k);
      if (j === idx) return out(allowed[idx], 0, cap != null && allowed[idx] === cap ? 'capped' : 'top');
      return out(allowed[j], j - idx, dbl ? (ts.placing ? 'up-placement' : 'up-double') : 'up');
    }
    if (dir < 0) {
      if (idx === 0) return out(allowed[0], 0, 'bottom');
      return out(allowed[idx - 1], -1, 'down');
    }
    return out(allowed[idx], 0, 'stay');
  }

  function selfCorrect(offset, meanBA, target) {
    var M = HF.modes, o = offset || 0;
    if (!isNum(meanBA) || !isNum(target)) return o;
    if (meanBA > target + M.OFFSET_BAND + EPS) o -= M.OFFSET_STEP;
    else if (meanBA < target - M.OFFSET_BAND - EPS) o += M.OFFSET_STEP;
    o = Math.round(o * 1000) / 1000;
    return Math.max(M.OFFSET_MIN, Math.min(M.OFFSET_MAX, o));
  }

  function fatigue(bas) {
    if (!bas || bas.length < 4) return false;
    var base = (bas[0] + bas[1]) / 2 - 0.15;
    var a = bas[bas.length - 2], b = bas[bas.length - 1];
    return a <= base + EPS && b <= base + EPS;
  }

  var api = { next: next, decide: decide, isInterrupted: isInterrupted, blockBad: blockBad, voidLimit: voidLimit, selfCorrect: selfCorrect, fatigue: fatigue,
    LEVEL_ROLES: LEVEL_ROLES, VOID_MAX: VOID_MAX, SPAN_VOID_MAX: SPAN_VOID_MAX };
  HF.controller = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
