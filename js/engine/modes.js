/* Long-Horizon — training modes (pure, no DOM). MIT licence.
 *
 * The six modes of PLAN §5 with the numbers of SPEC §6. A mode is data: thresholds, schedule kind,
 * feedback defaults and session limits. The controller, planner and goals read it from here.
 *
 * API (HF.modes):
 *   ids → ['varied','protocols','sprint','stretch','mastery','free']
 *   get(modeId) → ModeDef (unknown ids fall back to 'varied'):
 *     { id, label, U, D, target,            // rated-block thresholds and the self-correction target (BA)
 *       spanUp, spanDown, spanProc,         // Span: up if recall ≥ spanUp and procAcc ≥ spanProc, down if recall < spanDown
 *       schedule: 'ramp'|'protocol'|'blocked-fixed'|'random'|'units'|'free',
 *       perDay, minGapH,                    // counted sessions per local day, and the minimum gap between counted sessions (h)
 *       weeklyCap,                          // hard cap on counted sessions per week (Stretch 4), else null
 *       targetCap,                          // the weekly target (3–5) is clamped to this
 *       doubleSteps: 'session'|null,        // Sprint: +2 rungs per up move until the first down move in the session
 *       lures,                              // lures per stream from 2-back (Stretch 6)
 *       opensAfter,                         // counted sessions needed before the mode opens (Stretch 6)
 *       feedback: { perResponse, locked, summaryEvery, revealAtEnd },
 *       strategySessions, reflectionEvery, ... }
 *   thresholds(modeId, offset) → { U, D }   offset = self-correction offset (both thresholds move together)
 *   target(modeId) → self-correction target BA
 *   OFFSET_STEP, OFFSET_MAX, OFFSET_MIN (−.01), OFFSET_EVERY, OFFSET_BAND
 *   unitPassFor(trackId) → Mastery unit pass bar: .87 on n-back and Equal Steps units, .85 on Relation Grid units
 *   label(modeId)
 *
 * Numbers: SPEC §6 (U/D, targets, Span thresholds, self-correction ±.01 per 10 blocks, clamp ±.05),
 * PLAN §5 (Sprint ≤ 2/day ≥ 3 h apart, Stretch after 6 sessions, ≥ 20 h apart, ≤ 4/week, valve .62 × 2,
 * Mastery 2 of 3 ≥ .85, check ≥ .80, reviews 2/7/21 d, move on after 3 failed checks).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var FB_STD = { perResponse: false, locked: false, summaryEvery: 1, revealAtEnd: false };

  var MODES = {
    varied: {
      id: 'varied', label: 'Varied', U: 0.87, D: 0.73, target: 0.80, schedule: 'ramp',
      perDay: 1, minGapH: 0, weeklyCap: null, targetCap: 5, doubleSteps: null, lures: 4, opensAfter: 0,
      feedback: FB_STD, strategySessions: 0, reflectionEvery: 3,
      blurb: 'Interleaved versions with a gentle ramp; aims at about 80 % correct.'
    },
    protocols: {
      id: 'protocols', label: 'Protocols', U: null, D: null, target: null, schedule: 'protocol',
      perDay: 1, minGapH: 0, weeklyCap: null, targetCap: 5, doubleSteps: null, lures: null, opensAfter: 0,
      feedback: { perResponse: false, locked: true, summaryEvery: 1, revealAtEnd: false }, strategySessions: 0, reflectionEvery: 0,
      blurb: 'Runs the published procedures as closely as each paper allows (Cao 2026, Wang 2025, Jaeggi 2008).'
    },
    sprint: {
      id: 'sprint', label: 'Sprint', U: 0.92, D: 0.78, target: 0.85, schedule: 'blocked-fixed',
      perDay: 2, minGapH: 3, weeklyCap: null, targetCap: 5, doubleSteps: 'session', lures: 4, opensAfter: 0,
      feedback: { perResponse: true, locked: false, summaryEvery: 1, revealAtEnd: false }, strategySessions: 3, reflectionEvery: 0,
      blurb: 'Fixed versions, double steps, strategy cards; fastest gains on the trained tasks.'
    },
    stretch: {
      id: 'stretch', label: 'Stretch', U: 0.80, D: 0.64, target: 0.72, schedule: 'random',
      perDay: 1, minGapH: 20, weeklyCap: 4, targetCap: 4, doubleSteps: null, lures: 6, opensAfter: 6,
      feedback: { perResponse: false, locked: true, summaryEvery: 2, revealAtEnd: true }, strategySessions: 0, reflectionEvery: 3,
      valveBA: 0.62, valveSessions: 2,
      blurb: 'Harder kinds of difficulty and less feedback; aims at about 72 % correct.'
    },
    mastery: {
      id: 'mastery', label: 'Mastery Path', U: 0.87, D: 0.73, target: 0.80, schedule: 'units',
      perDay: 1, minGapH: 0, weeklyCap: null, targetCap: 5, doubleSteps: null, lures: 4, opensAfter: 0,
      feedback: FB_STD, strategySessions: 0, reflectionEvery: 0,
      unitPass: 0.85, unitPassLures: 0.87, unitWindow: 3, unitNeed: 2, checkPass: 0.80, checkBlocks: 2, reviewGaps: [2, 5, 14], reviewDays: [2, 7, 21],
      reviewReopen: 0.75, maxFailedChecks: 3,
      blurb: 'A fixed path of units with delayed checks and spaced reviews.'
    },
    free: {
      id: 'free', label: 'Free play', U: 0.87, D: 0.73, target: 0.80, schedule: 'free',
      perDay: 1, minGapH: 0, weeklyCap: null, targetCap: 5, doubleSteps: null, lures: 4, opensAfter: 0,
      feedback: FB_STD, strategySessions: 0, reflectionEvery: 0, coachTarget: 0.80,
      blurb: 'You choose version, level and pace; the coach suggests.'
    }
  };
  var IDS = ['varied', 'protocols', 'sprint', 'stretch', 'mastery', 'free'];
  // Span thresholds (SPEC §6): up if recall ≥ .80 (Stretch ≥ .70) and judgements ≥ .85; down if recall < .60.
  IDS.forEach(function (id) {
    var m = MODES[id];
    m.spanUp = id === 'stretch' ? 0.70 : 0.80; m.spanDown = 0.60; m.spanProc = 0.85;
  });

  // Self-correction offsets move U and D together by ±.01 per 10 rated blocks, clamped to [OFFSET_MIN, OFFSET_MAX].
  // OFFSET_MIN = −.01 (Phase 4, CA-02): U must stay above the approximate-responder bound of SPEC §4.6 — .857 with
  // 4 lures (Varied, Mastery, Free U ≥ .86; Sprint ≥ .91) and .786 with Stretch's 6 lures (U ≥ .79).
  var OFFSET_STEP = 0.01, OFFSET_MAX = 0.05, OFFSET_MIN = -0.01, OFFSET_EVERY = 10, OFFSET_BAND = 0.03;

  function get(id) { return MODES[id] || MODES.varied; }
  /* Mastery unit pass bar (Phase 4): units on tracks with lures or near misses (n-back, Equal Steps) need ≥ .87,
     because an approximate responder (familiarity / ±1) scores .857 there with 4 lures (SPEC §4.6); Relation Grid
     units keep PLAN's .85 (no lure strategy beats chance there, and its BA moves in steps of .05). */
  function unitPassFor(trackId) {
    var m = MODES.mastery, tr = HF.catalog && HF.catalog.get(trackId);
    return tr && (tr.task === 'nback' || trackId === 'rel.steps') ? m.unitPassLures : m.unitPass;
  }
  function thresholds(id, offset) {
    var m = get(id); var o = offset || 0;
    if (m.U == null) return { U: null, D: null };
    return { U: m.U + o, D: m.D + o };
  }

  var api = {
    ids: IDS.slice(),
    get: get,
    exists: function (id) { return !!MODES[id]; },
    thresholds: thresholds,
    target: function (id) { return get(id).target; },
    unitPassFor: unitPassFor,
    label: function (id) { return get(id).label; },
    OFFSET_STEP: OFFSET_STEP, OFFSET_MAX: OFFSET_MAX, OFFSET_MIN: OFFSET_MIN, OFFSET_EVERY: OFFSET_EVERY, OFFSET_BAND: OFFSET_BAND
  };
  HF.modes = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
