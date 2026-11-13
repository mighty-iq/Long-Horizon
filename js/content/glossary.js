/* Long-Horizon — glossary (pure, no DOM). Code MIT; texts CC BY-SA 4.0. Owner: P4 (learn/lessons).
 *
 * HF.content.glossary = {
 *   TERMS: [ { id, term, aka: [other spellings], text, see: [id] } ]   in reading order (basics first)
 *   get(id) → term | null
 *   find(word) → term | null      case-insensitive match on term or aka ('false presses' → false press)
 *   ids() → [id]
 * }
 * Every term the lessons, How to play and the research page rely on is defined here (tested in
 * tests/unit/content-glossary.test.mjs). Plain words first; numbers only where they help.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});

  var TERMS = [
    { id: 'working-memory', term: 'Working memory', aka: [],
      text: 'Holding a few things in mind for a short time while you work with them: keeping a phone number in your head while you dial, or comparing what you see now with what you saw a moment ago.' },
    { id: 'n-back', term: 'N-back', aka: ['1-back', '2-back', '3-back'],
      text: 'A task where items come one at a time and you say whether each one matches the item n steps back. In 2-back you compare each item with the one two steps before it.' },
    { id: 'horizon', term: 'Horizon', aka: ['horizons', 'your horizon'],
      text: 'How many steps you can hold in mind and still work with. In n-back and Equal Steps it is how far back you compare (the n); in the relation grid, how many symbols you relate at once; in a complex span, the length of the list.',
      see: ['n-back', 'complex-span'] },
    { id: 'match', term: 'Match', aka: ['matches', 'target', 'targets'],
      text: 'An item that fits the rule, for example the same letter as two back in 2-back. In an n-back block, 6 of the 20 counted items are matches.', see: ['false-press', 'lure'] },
    { id: 'lure', term: 'Lure', aka: ['lures', 'trap', 'traps', 'near miss', 'near misses', 'near match'],
      text: 'An item that almost fits the rule, a trap. In 2-back, a letter that matches one or three steps back is a lure; in Equal Steps, a step that is one bigger or smaller; in Switch, a match on the feature that was not cued. Lures make familiarity alone a poor guide.' },
    { id: 'false-press', term: 'False press', aka: ['false presses', 'false alarm', 'false alarms', 'false match', 'false matches'],
      text: 'Pressing Match when the item is not a match. False presses count against the score as much as matches that slip by, so doing nothing is the right answer for most items.' },
    { id: 'block', term: 'Block', aka: ['blocks'],
      text: 'One short run of a task, usually about a minute: in n-back, 20 counted items plus the first n, which only set things up.' },
    { id: 'session', term: 'Session', aka: ['sessions'],
      text: 'A training sitting of about 14 short blocks (usually 15 to 25 minutes), with short breaks between them. One session per day counts toward your weekly goal (two in the Sprint style).' },
    { id: 'warm-up', term: 'Warm-up', aka: ['warm-ups'],
      text: 'The first block of each task in a session, played a little below your level. It helps Long-Horizon estimate your form; it never changes your level.' },
    { id: 'rule-card', term: 'Rule card', aka: ['rule cards'],
      text: 'The card shown before every block: the task, the level, the rule in one sentence, an example and the keys.' },
    { id: 'memory-tape', term: 'Memory tape', aka: ['tape'],
      text: 'A strip that shows the last few items, with a frame on the item to compare with. It appears in lessons, untimed practice and assisted blocks, and fades away as you learn.' },
    { id: 'level', term: 'Level', aka: ['levels'],
      text: 'How hard a task is set for you, such as 3-back at the fast pace. After each block your level goes up when you did well, back down when it was too hard, or stays.' },
    { id: 'pace', term: 'Pace', aka: ['fast pace', 'normal pace', 'standard pace'],
      text: 'How quickly items come. At the normal pace a new item comes every 3 seconds; at the fast pace every 2.5 seconds. Each n has a normal and a fast half-step.' },
    { id: 'tier', term: 'Tier', aka: ['tiers'],
      text: 'One of the eight kinds of pattern in the Relation Grid, from Same (Tier 1) to Five different (Tier 8). The next tier opens when you reach step 6 of the current one.' },
    { id: 'step', term: 'Step', aka: ['steps'],
      text: 'In the Relation Grid, one of the nine difficulty steps within a tier: less time per grid, then look-alike symbols and lure lines (lines that almost fit). In Equal Steps, the difference between two numbers.' },
    { id: 'balanced-accuracy', term: 'Balanced accuracy', aka: ['block score', 'score'],
      text: 'The block score Long-Horizon uses: the average of two shares, the matches you caught and the non-matches you correctly left alone. Pressing on everything or on nothing scores 50 %, so only real discrimination raises it.' },
    { id: 'd-prime', term: 'd′ (d-prime)', aka: ['d′', "d'", 'd-prime', 'dprime', 'sensitivity'],
      text: 'A measure from signal detection theory of how well you tell matches from non-matches, separate from how readily you press. 0 means guessing; higher is better. Shown under Details after a block.' },
    { id: 'response-bias', term: 'Response bias', aka: ['bias', 'criterion'],
      text: 'Your tendency to press or to hold back, apart from how well you tell items apart. A strong bias either way lowers balanced accuracy.' },
    { id: 'updating', term: 'Updating', aka: [],
      text: 'Replacing what you hold in mind as new information arrives. N-back trains it: every new item pushes the oldest one out.' },
    { id: 'relational-integration', term: 'Relational integration', aka: ['relations'],
      text: 'Seeing a relation that holds across several items at once, such as three symbols in a row being equal, or two steps being the same size. Long-Horizon trains it with Equal Steps, the Relation Grid and the Relation Stream.' },
    { id: 'complex-span', term: 'Complex span', aka: ['span'],
      text: 'A task that mixes remembering a list with a second job between the items, such as checking sums. Optional in Long-Horizon (Settings).' },
    { id: 'transfer', term: 'Transfer', aka: [],
      text: 'Getting better at something you did not train, because of training on something else. Long-Horizon sorts it into near, mid and far.', see: ['near-transfer', 'mid-transfer', 'far-transfer'] },
    { id: 'near-transfer', term: 'Near transfer', aka: ['near'],
      text: 'Improvement on the same kind of task with new material, such as n-back with symbols you never trained on. Studies usually find a medium effect.' },
    { id: 'mid-transfer', term: 'Mid transfer', aka: ['mid'],
      text: 'Improvement on other working memory tasks with a different structure, such as complex span after n-back training. Studies usually find small effects, and several careful studies found none.' },
    { id: 'far-transfer', term: 'Far transfer', aka: ['far'],
      text: 'Improvement on different abilities such as reasoning or IQ tests. With active control groups, studies find about zero. Long-Horizon measures it in the Lab instead of promising it.' },
    { id: 'baseline', term: 'Baseline', aka: ['baselines'],
      text: 'A Lab visit before training starts. Long-Horizon suggests two, a few days apart, because scores rise on the second try even without training.' },
    { id: 'retest-gain', term: 'Retest gain', aka: ['practice effect'],
      text: 'The improvement that comes from taking a test again, with no training at all. It is largest on the second try, which is why the second baseline is the reference.' },
    { id: 'noise-band', term: 'Noise band', aka: ['noise bands'],
      text: 'The range a score can move by chance between two visits. A change inside the band is not reliable. Long-Horizon draws bands only after the community has calibrated a test: at least 50 people with both baselines.' },
    { id: 'active-control', term: 'Active control', aka: ['control group'],
      text: 'A comparison group that also trains, on something that should not matter (in Long-Horizon’s Study mode: visual search). It separates the effect of the training from the effects of effort, practice and hope.' },
    { id: 'lab', term: 'Lab', aka: [],
      text: 'Long-Horizon’s optional set of untrained tests. It measures memory, reasoning and task switching before and after training, with no rewards and no feedback.' }
  ];

  function norm(s) { return String(s || '').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim(); }
  var BY = {}, WORD = {};
  TERMS.forEach(function (t) {
    BY[t.id] = t;
    WORD[norm(t.term)] = t;
    (t.aka || []).forEach(function (a) { if (!WORD[norm(a)]) WORD[norm(a)] = t; });
  });

  var api = {
    TERMS: TERMS,
    get: function (id) { return BY[id] || null; },
    find: function (word) { return WORD[norm(word)] || null; },
    ids: function () { return TERMS.map(function (t) { return t.id; }); }
  };
  content.glossary = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
