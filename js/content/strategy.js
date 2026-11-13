/* Long-Horizon — strategy cards (pure, no DOM). Code MIT; texts CC BY-SA 4.0. Owner: P4.
 *
 * HF.content.strategy = {
 *   CARDS: [ { id, title, trackIds, evidence: 'tested'|'untested', source, steps: [text], example, note } ]
 *   get(id) → card | null          ids used by the planner: 'nback-grouping' (Sprint n-back), 'ri-scan' (Sprint relations)
 *   forTrack(trackId) → [card]
 *   EVIDENCE: { tested, untested }  the short labels shown on each card
 * }
 * Evidence (research/03 §3.2; PLAN §1.4): teaching a strategy speeds early n-back gains, but the edge fades within
 * weeks, and strategies people find themselves predict their gains. Laine et al. 2018 (116 adults, one session):
 * the grouping strategy reached higher n-back levels and better 3-back on untrained material; 2-back did not differ;
 * nothing carried over to other memory tasks. Every other card is our suggestion and says so.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});

  var EVIDENCE = {
    tested: 'Tested in a study',
    untested: 'Untested: our suggestion'
  };

  var CARDS = [
    { id: 'nback-grouping', title: 'Group and compare', evidence: 'tested', source: 'Laine et al. 2018',
      trackIds: ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch'],
      steps: [
        'Hold the last n items as one small group, like a short row.',
        'As the next items arrive, line them up under that row in your mind and compare them in order: first with first, second with second.',
        'Once a new row is complete, let the old one go and keep the new one.'
      ],
      example: '2-back with K, T, then K, R: the first K lines up under K (match), R under T (no match). Then K, R becomes the row to compare with.',
      note: 'In one session, people taught this strategy reached higher n-back levels than people who were not (Laine et al. 2018). The head start faded within weeks in a longer study (Fellman et al. 2020), and it did not carry over to other memory tasks. Strategies people work out for themselves also predicted their gains, so adapt it freely.' },
    { id: 'nback-distance', title: 'Familiar is not enough', evidence: 'untested', source: null,
      trackIds: ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch'],
      steps: [
        'When an item feels familiar, pause before pressing.',
        'Ask where it was: exactly n back, or one closer or further?',
        'Press only for exactly n back.'
      ],
      example: 'At 2-back, R after R feels familiar but matches one back: not a match.',
      note: 'Long-Horizon places lures one step closer and one step further than n, so familiarity alone scores poorly. This card turns that design into a habit; no study has tested it as a strategy.' },
    { id: 'ri-scan', title: 'Scan rows, then columns', evidence: 'untested', source: null,
      trackIds: ['rel.grid.T1', 'rel.grid.T2', 'rel.grid.T3', 'rel.grid.T4', 'rel.grid.T5', 'rel.grid.T6', 'rel.grid.T7', 'rel.grid.T8', 'rel.stream'],
      steps: [
        'Look only at the symbol that counts in each cell (the last one, or the middle one for icons).',
        'Read the rows top to bottom, then the columns left to right, the same way every time.',
        'For each line, check the rule once: all the same? going up? all different? Then move on.'
      ],
      example: 'Row 1: 3, 5, 0. Row 2: 5, 5, 5, a line. Answer Match.',
      note: 'A fixed routine keeps you from checking the same line twice. We found no study of strategies for this task, so treat it as a starting point.' },
    { id: 'transform-shift', title: 'Store the shifted item', evidence: 'untested', source: null,
      trackIds: ['nback.transform'],
      steps: [
        'When a day appears, think of the day after it straight away.',
        'Keep that shifted day in mind instead of the one you saw.',
        'Then it is plain n-back: does the new day equal the stored one?'
      ],
      example: 'See Tue, keep Wed. Two items later Wed appears: a match.',
      note: 'Our suggestion. It moves the extra step to the moment the item appears, when you have time.' },
    { id: 'arith-answer', title: 'Keep the answer, drop the sum', evidence: 'untested', source: null,
      trackIds: ['nback.arith'],
      steps: ['Work out each sum as soon as it appears.', 'Keep only the answer.', 'Compare answers, never the look of the sums.'],
      example: '3 + 4: keep 7. 9 − 2: also 7, a match at 1-back.',
      note: 'Our suggestion; untested.' },
    { id: 'switch-cue', title: 'Cue first, then compare', evidence: 'untested', source: null,
      trackIds: ['nback.switch'],
      steps: ['Read WHAT or WHERE before anything else.', 'Keep both the symbol and its place for every item, since the next cue may ask for either.', 'Compare only the cued feature.'],
      example: 'WHERE: a 5 in the same place as the 7 before it is a match at 1-back.',
      note: 'Our suggestion; untested.' },
    { id: 'steps-say', title: 'Name the step', evidence: 'untested', source: null,
      trackIds: ['rel.steps'],
      steps: ['As each number appears, name the step from the number it is compared with: "up 3", "down 1".', 'Keep only the last step in mind.', 'Press when the new step has the same size.'],
      example: '3, 6, 9: "3", then "3", a match.',
      note: 'Our suggestion; untested.' }
  ];

  function get(id) { for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i]; return null; }
  function forTrack(trackId) { return CARDS.filter(function (c) { return c.trackIds.indexOf(trackId) >= 0; }); }

  var api = { CARDS: CARDS, EVIDENCE: EVIDENCE, get: get, forTrack: forTrack };
  content.strategy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
