/* Long-Horizon — the 12 milestone badges (pure, no DOM). MIT licence.
 *
 * PLAN §7: unannounced until earned; never for speed, volume or streaks; never required for anything.
 * earnedAt is always derived from the records (blocks, events, Lab visits), so imports and two-tab merges
 * agree. derive.js builds the `facts` object below in one pass over the records.
 *
 *   rules-learned  Rules learned                 first 'lesson-passed' of the n-back lesson (lesson.nback)
 *   nback-3        3-back reached                first n-back level of 3-back or more (any version, incl. protocols)
 *   nback-5        5-back reached                same, 5-back
 *   exec-all       All three executive versions  Transform, Arithmetic and Switch each played at least once
 *   rel-different  Relations: Different tier     Relation Grid T3 opened (T2 reached step 6)
 *   rel-five       Relations: five-cell patterns Relation Grid T5 opened (T4 reached step 6)
 *   explorer       Explorer                      every core version (Plain, Dual, Transform, Arithmetic, Switch, Equal
 *                                                Steps, Grid, Stream) and every training set of those versions tried
 *   baselines      Both baselines done           Lab visits B1 and B2 finished
 *   post-test      Post-test done                Lab visit POST finished
 *   follow-up      Follow-up done                Lab visit FU finished
 *   comeback       Comeback                      a training session after 14+ days without one
 *   reflective     Reflective                    a strategy note written ('note' event with text)
 *
 * API (HF.badges):
 *   LIST: [{ id, label, text }]   ids()
 *   compute(facts) → { [badgeId]: earnedAt }   (only earned badges)
 *       facts = { lessonPassed: {lessonId: t}, nReach: {n: t}, firstBlock: {trackId: t}, reach: {trackId: {rung: t}},
 *                 setFirst: {setId: t}, explorerSets: [setId], labEnded: {kind: t}, comebackAt: t|null, firstNoteAt: t|null }
 *   diff(before, after) → [badgeId] newly earned
 *   EXPLORER_TRACKS
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var LIST = [
    { id: 'rules-learned', label: 'Rules learned', text: 'You passed the n-back check in the tutorial.' },
    { id: 'nback-3', label: '3-back reached', text: 'An n-back version reached 3-back.' },
    { id: 'nback-5', label: '5-back reached', text: 'An n-back version reached 5-back.' },
    { id: 'exec-all', label: 'All three executive versions', text: 'You have played Transform, Arithmetic and Switch.' },
    { id: 'rel-different', label: 'Relations: Different tier', text: 'The Relation Grid\'s Different tier is open.' },
    { id: 'rel-five', label: 'Relations: five-cell patterns', text: 'The Relation Grid\'s Five the same tier is open.' },
    { id: 'explorer', label: 'Explorer', text: 'You have tried every version and every kind of item.' },
    { id: 'baselines', label: 'Both baselines done', text: 'Baseline 1 and Baseline 2 are finished.' },
    { id: 'post-test', label: 'Post-test done', text: 'Your Post-test is finished.' },
    { id: 'follow-up', label: 'Follow-up done', text: 'Your Follow-up is finished.' },
    { id: 'comeback', label: 'Comeback', text: 'You came back after 14 or more days away.' },
    { id: 'reflective', label: 'Reflective', text: 'You wrote a strategy note.' }
  ];
  var EXPLORER_TRACKS = ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch', 'rel.steps', 'rel.grid.T1', 'rel.stream'];
  var TUTORIAL_LESSONS = ['lesson.nback', 'tutorial', 'tutorial.nback'];

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function minT(a, b) { return !isNum(a) ? b : (!isNum(b) ? a : Math.min(a, b)); }

  function compute(f) {
    f = f || {};
    var out = {};
    var lp = f.lessonPassed || {}, t = null;
    TUTORIAL_LESSONS.forEach(function (id) { t = minT(t, lp[id]); });
    if (isNum(t)) out['rules-learned'] = t;
    var nr = f.nReach || {};
    if (isNum(nr[3])) out['nback-3'] = nr[3];
    if (isNum(nr[5])) out['nback-5'] = nr[5];
    var fb = f.firstBlock || {};
    if (isNum(fb['nback.transform']) && isNum(fb['nback.arith']) && isNum(fb['nback.switch']))
      out['exec-all'] = Math.max(fb['nback.transform'], fb['nback.arith'], fb['nback.switch']);
    var reach = f.reach || {};
    var t2 = reach['rel.grid.T2'] && reach['rel.grid.T2'][5], t4 = reach['rel.grid.T4'] && reach['rel.grid.T4'][5];
    if (isNum(t2)) out['rel-different'] = t2;
    if (isNum(t4)) out['rel-five'] = t4;
    var ok = true, last = -Infinity;
    EXPLORER_TRACKS.forEach(function (id) { if (!isNum(fb[id])) ok = false; else last = Math.max(last, fb[id]); });
    var sf = f.setFirst || {};
    (f.explorerSets || []).forEach(function (s) { if (!isNum(sf[s])) ok = false; else last = Math.max(last, sf[s]); });
    if (ok && isFinite(last)) out.explorer = last;
    var le = f.labEnded || {};
    if (isNum(le.B1) && isNum(le.B2)) out.baselines = Math.max(le.B1, le.B2);
    if (isNum(le.POST)) out['post-test'] = le.POST;
    if (isNum(le.FU)) out['follow-up'] = le.FU;
    if (isNum(f.comebackAt)) out.comeback = f.comebackAt;
    if (isNum(f.firstNoteAt)) out.reflective = f.firstNoteAt;
    return out;
  }

  function diff(before, after) {
    var b = before || {}, out = [];
    Object.keys(after || {}).forEach(function (id) { if (!isNum(b[id])) out.push(id); });
    return out;
  }

  var api = {
    LIST: LIST, EXPLORER_TRACKS: EXPLORER_TRACKS, TUTORIAL_LESSONS: TUTORIAL_LESSONS,
    ids: function () { return LIST.map(function (x) { return x.id; }); },
    get: function (id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; },
    compute: compute, diff: diff
  };
  HF.badges = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
