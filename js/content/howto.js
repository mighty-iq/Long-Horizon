/* Long-Horizon — "How to play": plain text per task (pure, no DOM). Code MIT; texts CC BY-SA 4.0. Owner: P4.
 *
 * HF.content.howto = {
 *   INTRO: { title, body: [paragraph] }                    what a session looks like, keys, pausing
 *   TASKS: [ { id, title, trackIds, goal, horizon?, see, press: [ { key, pad, when } ], tips: [text], experimental?, source? } ]
 *            horizon = one line tying the task to the name Long-Horizon (what you hold; Long-Horizon copy, 13 Nov 2026)
 *   KEYS: [ { key, pad, when } ]                            the one key scheme (shown on the How to play page)
 *   get(id) → task | null;  forTrack(trackId) → task | null  (e.g. for the pause menu's "How to play")
 *   text(trackId) → plain multi-line string (goal, see, keys, tips) for places that cannot render structure
 * }
 * Keys follow the single scheme of SPEC-core: J = match / yes / true / present, K = sound match (Dual),
 * F = no (only where every item needs an answer), Space = continue, Esc or P = pause.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});

  var INTRO = {
    title: 'How a session works',
    body: [
      'A session is about 14 short blocks (usually 15 to 25 minutes), each about a minute long. Before every block a rule card shows the task, your level and the keys. Press Space or tap Start when you are ready.',
      'During a block only the task is on screen: no score, no timer. Afterwards a short note says how it went and what comes next. Your level moves up when a block goes well and back down when it was too hard.',
      'Press Esc or P to pause at any time. A paused block is never counted against you; it restarts fresh.'
    ]
  };

  var KEYS = [
    { key: 'J', pad: 'Match', when: 'the item matches (also Yes, True, Present)' },
    { key: 'K', pad: 'Sound', when: 'the sound matches, in Dual n-back' },
    { key: 'F', pad: 'No', when: 'there is no match, in tasks that need an answer for every item' },
    { key: 'Space', pad: 'Start', when: 'you are ready to start or continue' },
    { key: 'Esc', pad: 'Pause', when: 'you need a break (P works too)' }
  ];

  var TASKS = [
    { id: 'nback.plain', title: 'Plain n-back', trackIds: ['nback.plain'],
      goal: 'Say whether each item is the same as the one n steps back.',
      horizon: 'Here n is your horizon: you keep the last n items in mind and update them with every new one.',
      see: 'Items appear one at a time: a square in a grid, letters, digits, shapes, days and more. Each shows for half a second; a new one comes every 3 seconds (2.5 at the fast pace).',
      press: [{ key: 'J', pad: 'Match', when: 'the item is the same as the one n steps back' }, { none: true, when: 'it is not: doing nothing is the answer' }],
      tips: ['Lures are placed one step closer or further than n. If an item feels familiar, check the distance before you press.',
        'Try grouping: hold the last n items as one small set and compare item by item (see Strategy cards).'] },
    { id: 'nback.dual', title: 'Dual n-back', trackIds: ['nback.dual'],
      goal: 'Track two streams at once: where the square is, and what you hear.',
      horizon: 'Here n is your horizon: you keep the last n items in mind and update them with every new one.',
      see: 'A square in a 3×3 grid and a sound (a tone, or a spoken letter if you chose letters in Settings) come together.',
      press: [{ key: 'J', pad: 'Position', when: 'the square is in the same place as n steps back' },
        { key: 'K', pad: 'Sound', when: 'the sound is the same as n steps back' }, { none: true, when: 'neither matches' }],
      tips: ['Both can match at once: then press both.', 'Your block score is the weaker of the two streams, so give both your attention.',
        'Bluetooth headphones add a delay; Settings has a sound offset if you need it.'] },
    { id: 'nback.transform', title: 'Transform n-back', trackIds: ['nback.transform'], experimental: true, source: 'Cao et al. 2026',
      goal: 'Say whether each day is the day after the day n steps back.',
      horizon: 'You don’t just hold the steps, you work on them: each one changes by a rule before you compare.',
      see: 'Days of the week as words (other blocks use months, clock hours, compass points or a ring of squares). The rule card says how far to shift.',
      press: [{ key: 'J', pad: 'Match', when: 'the item is the day after the one n steps back' }, { none: true, when: 'it is not' }],
      tips: ['The same day is never a match: the rule asks for the day after.', 'Sunday wraps around to Monday.',
        'It can help to store each day already shifted: see "Mon", keep "Tue".'] },
    { id: 'nback.arith', title: 'Arithmetic n-back', trackIds: ['nback.arith'], experimental: true,
      goal: 'Say whether each sum has the same answer as the sum n steps back.',
      horizon: 'You don’t just hold the steps, you work on them: each one changes by a rule before you compare.',
      see: 'Small sums such as 3 + 4 or 9 − 2, with answers from 1 to 9.',
      press: [{ key: 'J', pad: 'Match', when: 'the answer is the same as n steps back' }, { none: true, when: 'it is not' }],
      tips: ['Matching sums always look different; only the answers count.', 'Some lures start with the same number but give another answer.',
        'Keep the answers, not the sums.'] },
    { id: 'nback.switch', title: 'Switch n-back', trackIds: ['nback.switch'], experimental: true,
      goal: 'Follow the cue: compare either the symbol or its place with n steps back.',
      horizon: 'You don’t just hold the steps, you work on them: the cue says which feature to compare.',
      see: 'A digit or shape in one place of a grid, with WHAT or WHERE above it.',
      press: [{ key: 'J', pad: 'Match', when: 'the cued feature is the same as n steps back' }, { none: true, when: 'it is not' }],
      tips: ['Read the cue first, every time: it can change from one item to the next.', 'The other feature may match: that is a lure, not a match.'] },
    { id: 'rel.steps', title: 'Equal Steps', trackIds: ['rel.steps'], experimental: true, source: 'Wang et al. 2025',
      goal: 'Spot the moment the step between numbers repeats.',
      horizon: 'You hold several items and the relation between them at once.',
      see: 'Numbers one at a time. At 1-back, compare the step from the last number with the step before it. At 2-back and 3-back, compare jumps between numbers further apart.',
      press: [{ key: 'J', pad: 'Match', when: 'the step is the same size as the one before it' }, { none: true, when: 'it is not' }],
      tips: ['Up or down does not matter: 9, 8, 7 has two steps of 1.', 'Lures differ by one: steps of 3 and 4 are not equal.'] },
    { id: 'rel.grid', title: 'Relation Grid', trackIds: ['rel.grid.T1', 'rel.grid.T2', 'rel.grid.T3', 'rel.grid.T4', 'rel.grid.T5', 'rel.grid.T6', 'rel.grid.T7', 'rel.grid.T8'], experimental: true,
      goal: 'Decide whether a row or column follows the rule.',
      horizon: 'You hold several items and the relation between them at once.',
      see: 'A 3×3 grid; each cell holds a short group of symbols. Only the last symbol in each cell counts (the middle one for icons). Tiers change the rule: same, ascending, different, diagonals, five-cell shapes, two features, a 4×4 grid.',
      press: [{ key: 'J', pad: 'Match', when: 'a line follows the rule' }, { key: 'F', pad: 'No', when: 'no line does' }],
      tips: ['Every grid has exactly one line that fits, or none.', 'Scan the rows, then the columns, the same way every time (see Strategy cards).',
        'Within a tier, the steps give less time and add look-alike symbols.'] },
    { id: 'rel.stream', title: 'Relation Stream', trackIds: ['rel.stream'], experimental: true,
      goal: 'Press as soon as a line with the pattern appears.',
      horizon: 'You hold several items and the relation between them at once.',
      see: 'The same kind of grid stays on screen while one cell (later two or three) changes every couple of seconds.',
      press: [{ key: 'J', pad: 'Match', when: 'a row or column now follows the rule' }, { none: true, when: 'nothing has appeared yet' }],
      tips: ['A new line can only appear through the cell that just changed: look there first.', 'The rule card says whether the block wants all the same or all different.'] },
    { id: 'span', title: 'Complex span', trackIds: ['span.op', 'span.sym', 'span.back'],
      goal: 'Remember a short list while you check sums.',
      horizon: 'You hold a list while you do something else in between.',
      see: 'A sum appears: is it right? Then a letter (or symbol) shows for one second. After a few pairs, a keypad asks for the list.',
      press: [{ key: 'J', pad: 'True', when: 'the sum is right' }, { key: 'F', pad: 'False', when: 'it is wrong' }],
      tips: ['Keep the sums accurate: your level only goes up when at least 85 % of them are right.',
        'Backward span asks for the list in reverse order.'] },
    { id: 'vs.search', title: 'Visual search', trackIds: ['vs.search'],
      goal: 'Say whether a T is hidden among the Ls.',
      see: 'A scatter of Ls and sometimes one T, each turned a different way.',
      press: [{ key: 'J', pad: 'Present', when: 'there is a T' }, { key: 'F', pad: 'Absent', when: 'there is none' }],
      tips: ['Answer before the display goes; it moves on as soon as you answer.'] }
  ];

  function get(id) { for (var i = 0; i < TASKS.length; i++) if (TASKS[i].id === id) return TASKS[i]; return null; }
  function forTrack(trackId) {
    for (var i = 0; i < TASKS.length; i++) if (TASKS[i].trackIds.indexOf(trackId) >= 0) return TASKS[i];
    return null;
  }
  function keyLine(p) { return p.none ? 'Do nothing when ' + p.when.replace(/^it is not: /, 'there is no match: ').replace(/^it is not$/, 'there is no match') : p.key + ' or tap ' + p.pad + ' when ' + p.when; }
  function text(trackId) {
    var t = forTrack(trackId);
    if (!t) return '';
    var lines = [t.title, t.goal].concat(t.horizon ? [t.horizon] : [], [t.see]);
    t.press.forEach(function (p) { lines.push('• ' + keyLine(p) + '.'); });
    t.tips.forEach(function (x) { lines.push('Tip: ' + x); });
    return lines.join('\n');
  }

  var api = { INTRO: INTRO, KEYS: KEYS, TASKS: TASKS, get: get, forTrack: forTrack, text: text, keyLine: keyLine };
  content.howto = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
