/* Long-Horizon — lesson data and texts (pure, no DOM). Code MIT; texts CC BY-SA 4.0. Owner: P4 (learn/lessons).
 *
 * Read by js/ui/lessons.js (the lesson runner) and tests/unit/content-*.test.mjs. Nothing here touches the DOM.
 *
 * HF.content.lessons = {
 *   LIST: [ { id, title, trackIds, minutes, kind: 'tutorial'|'lesson'|'intro', summary } ]   ids = HF.catalog.LESSONS
 *   get(id) → lesson | null;  forTrack(trackId) → lessonId | null;  ids() → [id]
 *   CHECKS[lessonId] = { trackId, rung, set, params?, minHits, maxFas, perStream?, minRecall?, minJudge?, label, pass }
 *   STEPS[lessonId]  = [ Step ]  — the script the runner plays, in order
 *   SEQ[name]        = hand-built sequence with its expected labels (verified against the real rule kernels by
 *                      tests/unit/content-lessons.test.mjs)
 *   MINI[routeId]    = the four mini-lessons a failed n-back check routes to: nothing | window | keys | timing
 *   TIERS['T2'…'T8'] = one-screen intros for the Relation Grid tiers
 *   TEXT             = shared phrases (headlines, buttons, end pages, the Chimera line)
 * }
 *
 * Step types (fields beyond { type, part, title, lead }):
 *   page    body: [paragraph] (the first page's second paragraph ties the task to the name: what you hold, Long-Horizon
 *           copy of 13 Nov 2026; same lines as HF.content.howto horizon), figure?: 'nback-parts'|'dual-parts'|'switch-cue'|'steps-example'|'grid-parts'|
 *           'stream-parts'|'span-parts'|'vsearch-parts'|'timeline'|'keymap', skipToCheck?: true, note?
 *   demo    seq: name — a worked example stepped through with Next; explanations come from the scorer's why[]
 *           notes?: { trialIndex: text } extra lesson notes; show?: { steps, arcs, hints, values } supports
 *   guided  seq: name — self-paced, nothing moves until you answer; tape: [[fromIndex, 'full'|'frame'|'none'], …];
 *           noButton: true (the temporary No match button); probes / why: [trialIndex] ("tap the item you compare
 *           with" before / after the answer); callouts: { trialIndex: text } (before the answer);
 *           support: [[fromIndex, bool]] (steps under numbers, values under sums, hints under the frame)
 *   timed   seq: name — runs at its own pace (HF.timing); onMs, soaMs; feedback 'per-response'|'none'
 *   check   the lesson's check block (CHECKS[lessonId]); a failed n-back check routes to MINI
 *   lines   grid: "tap the line" exercise; arrays: [name]
 *   arrays  grid: guided or timed arrays drawn from a generated block (gen: { rung, pick: { targets, others } })
 *   tier    the one-screen tier intro (TIERS)
 *   end     the closing page (passed / assisted / not yet)
 *
 * Sequences: n-back { trackId, set, n, items: [...], expect: { targets: [i], lures: { i: label } } }
 *   items are display names (letters 'K', days 'Tue', sums '3 + 4' with U+2212 for minus); Switch items are
 *   [what, cell, cue]; Dual has pos: [cell] and snd: [index into the sound set]; Equal Steps { back, numbers };
 *   grid arrays are 9 three-digit strings (the last digit counts) with expect { line } or { near }.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});
  var M = '−'; // the minus sign used by the arithmetic set

  var LIST = [
    { id: 'lesson.nback', title: 'N-back basics', trackIds: ['nback.plain'], minutes: 6, kind: 'tutorial',
      summary: 'The first lesson: how n-back works, played step by step, then a short check.' },
    { id: 'lesson.dual', title: 'Dual n-back', trackIds: ['nback.dual'], minutes: 3, kind: 'lesson',
      summary: 'Two streams at once: a square that moves and a sound that changes.' },
    { id: 'lesson.transform', title: 'Transform: the day after', trackIds: ['nback.transform'], minutes: 3, kind: 'lesson',
      summary: 'Compare with the day after the one n back.' },
    { id: 'lesson.arith', title: 'Arithmetic: compare answers', trackIds: ['nback.arith'], minutes: 3, kind: 'lesson',
      summary: 'Work out each sum and compare the answers, not the sums.' },
    { id: 'lesson.switch', title: 'Switch: follow the cue', trackIds: ['nback.switch'], minutes: 3, kind: 'lesson',
      summary: 'A cue says whether the symbol or its place counts.' },
    { id: 'lesson.steps', title: 'Equal Steps', trackIds: ['rel.steps'], minutes: 3, kind: 'lesson',
      summary: 'Spot the moment the step between numbers repeats.' },
    { id: 'lesson.grid', title: 'Relation Grid', trackIds: ['rel.grid.T1'], minutes: 4, kind: 'lesson',
      summary: 'Find the row or column whose last symbols follow the rule.' },
    { id: 'lesson.grid.T2', title: 'Relation Grid · Ascending', trackIds: ['rel.grid.T2'], minutes: 1, kind: 'intro',
      summary: 'A line whose symbols go up in order.' },
    { id: 'lesson.grid.T3', title: 'Relation Grid · Different', trackIds: ['rel.grid.T3'], minutes: 1, kind: 'intro',
      summary: 'A line whose symbols are all different.' },
    { id: 'lesson.grid.T4', title: 'Relation Grid · Same or different, with diagonals', trackIds: ['rel.grid.T4'], minutes: 1, kind: 'intro',
      summary: 'The rule changes per block, and diagonals count.' },
    { id: 'lesson.grid.T5', title: 'Relation Grid · Five the same', trackIds: ['rel.grid.T5'], minutes: 1, kind: 'intro',
      summary: 'Five cells in a plus or a T shape.' },
    { id: 'lesson.grid.T6', title: 'Relation Grid · Two features', trackIds: ['rel.grid.T6'], minutes: 1, kind: 'intro',
      summary: 'Shape and fill: one must match, the other must all differ.' },
    { id: 'lesson.grid.T7', title: 'Relation Grid · 4×4 grid', trackIds: ['rel.grid.T7'], minutes: 1, kind: 'intro',
      summary: 'A bigger grid with lines of four.' },
    { id: 'lesson.grid.T8', title: 'Relation Grid · Five different', trackIds: ['rel.grid.T8'], minutes: 1, kind: 'intro',
      summary: 'Five cells in a plus or a T, all different.' },
    { id: 'lesson.stream', title: 'Relation Stream', trackIds: ['rel.stream'], minutes: 3, kind: 'lesson',
      summary: 'The grid changes one cell at a time; press when a line appears.' },
    { id: 'lesson.span', title: 'Complex span', trackIds: ['span.op', 'span.sym', 'span.back'], minutes: 3, kind: 'lesson',
      summary: 'Check sums while you remember a short list.' },
    { id: 'lesson.vsearch', title: 'Visual search', trackIds: ['vs.search'], minutes: 2, kind: 'lesson',
      summary: 'Is there a T among the Ls?' }
  ];

  // ---------------------------------------------------------------- checks
  var CHECKS = {
    'lesson.nback': { trackId: 'nback.plain', rung: 2, set: 'letters', minHits: 4, maxFas: 2,
      label: '2-back at the normal pace', pass: 'Catch at least 4 of the 6 matches and press no more than twice when there is no match.' },
    'lesson.dual': { trackId: 'nback.dual', rung: 0, set: 'sound', minHits: 4, maxFas: 2, perStream: true,
      label: '1-back, both streams', pass: 'In each stream, catch at least 4 of the 6 matches and press no more than twice when there is none.' },
    'lesson.transform': { trackId: 'nback.transform', rung: 0, set: 'days', minHits: 4, maxFas: 2,
      label: '1-back with days', pass: 'Catch at least 4 of the 6 matches and press no more than twice when there is no match.' },
    'lesson.arith': { trackId: 'nback.arith', rung: 0, set: 'arith', minHits: 4, maxFas: 2,
      label: '1-back with sums', pass: 'Catch at least 4 of the 6 matches and press no more than twice when there is no match.' },
    'lesson.switch': { trackId: 'nback.switch', rung: 0, set: 'digits', minHits: 4, maxFas: 2,
      label: '1-back with a cue', pass: 'Catch at least 4 of the 6 matches and press no more than twice when there is no match.' },
    'lesson.steps': { trackId: 'rel.steps', rung: 0, set: 'numbers', minHits: 4, maxFas: 2,
      label: '1-back, numbers up to 9', pass: 'Catch at least 4 of the 6 equal steps and press no more than twice when the steps differ.' },
    'lesson.grid': { trackId: 'rel.grid.T1', rung: 1, set: 'digits', minHits: 7, maxFas: 2,
      label: 'Same, 5.5 s per grid', pass: 'Find at least 7 of the 10 grids with a line and say Match no more than twice when there is none.' },
    'lesson.stream': { trackId: 'rel.stream', rung: 0, set: 'digits', params: { rule: 'same' }, minHits: 4, maxFas: 3,
      label: 'one change every 2 s', pass: 'Catch at least 4 of the 6 lines and press no more than 3 times when there is none.' },
    'lesson.span': { trackId: 'span.op', rung: 0, set: 'letters12', minRecall: 4, minJudge: 5,
      label: '3 lists of 2 letters', pass: 'Recall at least 4 of the 6 letters in their place and get at least 5 of the 6 sums right.' },
    'lesson.vsearch': { trackId: 'vs.search', rung: 0, set: 'tl', minHits: 7, maxFas: 2,
      label: '8 symbols, 3 s each', pass: 'Find at least 7 of the 10 Ts and say Present on no more than 2 displays without one.' }
  };

  // ---------------------------------------------------------------- hand-built sequences (verified by unit tests)
  function L(s) { return s.split(' '); }
  var SEQ = {
    // n-back basics
    nb1demo: { trackId: 'nback.plain', set: 'letters', n: 1, items: L('C K K T K S S'), expect: { targets: [2, 6], lures: {} } },
    nb1guided: { trackId: 'nback.plain', set: 'letters', n: 1, items: L('L R R S C C T C Q Q H'), expect: { targets: [2, 5, 9], lures: {} } },
    nb1slow: { trackId: 'nback.plain', set: 'letters', n: 1, items: L('K H H Q T L L S C C'), expect: { targets: [2, 6, 9], lures: {} } },
    nb1normal: { trackId: 'nback.plain', set: 'letters', n: 1, items: L('R S S T C K K H Q L L'), expect: { targets: [2, 6, 10], lures: {} } },
    nb2demo: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('K T K T S R R H L H'), expect: { targets: [2, 3, 9], lures: { 6: 'n-1' } } },
    nb2guided: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('S L Q L C C H C T K T Q K Q'),
      expect: { targets: [3, 7, 10, 13], lures: { 5: 'n-1', 12: 'n+1' } } },
    nb2slow: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('H R H S Q S T T L T C L'),
      expect: { targets: [2, 5, 9], lures: { 7: 'n-1', 11: 'n+1' } } },
    miniNothing: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('C T R S R K L Q H Q S'), expect: { targets: [4, 9], lures: {} } },
    miniWindow: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('T H H K L K S L S R C R'),
      expect: { targets: [5, 8, 11], lures: { 2: 'n-1', 7: 'n+1' } } },
    miniTiming: { trackId: 'nback.plain', set: 'letters', n: 2, items: L('Q K Q L S L T H C H K C'),
      expect: { targets: [2, 5, 9], lures: { 11: 'n+1' } } },
    // Dual: positions are grid cells 0–7; sounds are indexes into the sound set (tones or spoken letters)
    duSound: { trackId: 'nback.plain', set: 'sound', n: 1, snd: [2, 5, 5, 1, 6, 6, 3, 0, 0, 4], expect: { targets: [2, 5, 8], lures: {} } },
    duBoth: { trackId: 'nback.dual', set: 'sound', n: 1, pos: [0, 0, 4, 2, 2, 6, 1, 1, 5, 3], snd: [3, 7, 7, 1, 1, 4, 2, 6, 6, 0],
      expect: { pos: [1, 4, 7], snd: [2, 4, 8] } },
    // Transform (Cao et al. 2026: the day after)
    tf1demo: { trackId: 'nback.transform', set: 'days', n: 1, items: L('Mon Tue Fri Sat Sat Wed Sun Mon'), expect: { targets: [1, 3, 7], lures: {} } },
    tf2demo: { trackId: 'nback.transform', set: 'days', n: 2, items: L('Tue Sat Wed Mon Fri'), expect: { targets: [2], lures: {} } },
    tf1guided: { trackId: 'nback.transform', set: 'days', n: 1, items: L('Thu Fri Mon Tue Tue Sat Sun Wed Fri Sat'),
      expect: { targets: [1, 3, 6, 9], lures: {} } },
    // Arithmetic
    ar1demo: { trackId: 'nback.arith', set: 'arith', n: 1, items: ['3 + 4', '9 ' + M + ' 2', '5 + 1', '5 ' + M + ' 1', '8 ' + M + ' 4', '2 + 2'],
      expect: { targets: [1, 4, 5], lures: {} } },
    ar1guided: { trackId: 'nback.arith', set: 'arith', n: 1,
      items: ['4 + 4', '9 ' + M + ' 1', '2 + 5', '6 ' + M + ' 3', '1 + 2', '7 + 1', '9 ' + M + ' 7', '1 + 1', '4 ' + M + ' 2', '3 + 3'],
      expect: { targets: [1, 4, 7, 8], lures: {} } },
    // Switch: [what, cell, cue]; cells 0–7 clockwise from the top left
    sw1demo: { trackId: 'nback.switch', set: 'digits', n: 1,
      items: [['7', 0, null], ['5', 0, 'where'], ['5', 4, 'what'], ['5', 3, 'where'], ['2', 3, 'where'], ['8', 1, 'what']],
      expect: { targets: [1, 2, 4], lures: { 3: 'uncued' } } },
    sw1guided: { trackId: 'nback.switch', set: 'digits', n: 1,
      items: [['3', 2, null], ['3', 6, 'what'], ['9', 6, 'where'], ['9', 0, 'where'], ['4', 1, 'where'], ['7', 5, 'what'],
        ['7', 3, 'what'], ['2', 3, 'what'], ['6', 3, 'where'], ['8', 4, 'what']],
      expect: { targets: [1, 2, 6, 8], lures: { 3: 'uncued', 7: 'uncued' } } },
    // Equal Steps (Wang et al. 2025)
    st1demo: { trackId: 'rel.steps', back: 1, maxNumber: 9, numbers: [3, 6, 9, 8, 7, 4, 1], expect: { targets: [2, 4, 6], near: [] } },
    st1guided: { trackId: 'rel.steps', back: 1, maxNumber: 9, numbers: [2, 5, 8, 6, 4, 7, 3, 6, 9, 8], expect: { targets: [2, 4, 8], near: [3, 5, 6, 7] } },
    st2demo: { trackId: 'rel.steps', back: 2, maxNumber: 9, numbers: [3, 6, 9, 8, 7], expect: { targets: [4], near: [] } },
    // Relation Grid: nine three-digit strings, row by row; the last digit of each counts (rule: Same)
    gridRow: { cells: ['473', '817', '290', '625', '345', '905', '718', '562', '133'], expect: { line: 'row2' } },
    gridCol: { cells: ['128', '904', '357', '641', '274', '815', '239', '664', '082'], expect: { line: 'col2' } },
    gridNear: { cells: ['536', '187', '420', '912', '642', '378', '205', '893', '711'], expect: { line: null, near: 'row2' } },
    gridTap1: { cells: ['902', '461', '385', '127', '648', '903', '244', '614', '094'], expect: { line: 'row3' } },
    gridTap2: { cells: ['356', '871', '402', '816', '249', '517', '936', '603', '128'], expect: { line: 'col1' } },
    gridTap3: { cells: ['720', '593', '467', '148', '236', '817', '905', '371', '267'], expect: { line: 'col3' } }
  };

  // ---------------------------------------------------------------- shared phrases
  var TEXT = {
    headline: { hit: 'Correct.', cr: 'Correct.', miss: 'Not quite.', fa: 'Not quite.', 'lure-fa': 'Not quite: a lure.' },
    action: { press: 'Press J or tap Match.', none: 'Do nothing.', pressBoth: 'Press J and K.', pressPos: 'Press J (position).',
      pressSnd: 'Press K (sound).', yes: 'Answer Match (J).', no: 'Answer No (F).' },
    leadIn: 'Nothing to compare with yet. Just keep it in mind.',
    leadInN: function (n) { return n === 1 ? 'Nothing to compare with yet. Just keep it in mind.' : 'Nothing to compare with yet: a match needs ' + n + ' items before it. Keep it in mind.'; },
    askAnswer: 'Match or not?',
    askProbe: function (n, noun) { return 'Which ' + noun + ' do you compare this one with? Tap it on the tape.'; },
    askWhy: function (noun) { return 'Why? Tap the ' + noun + ' you compared it with.'; },
    probeRight: function (n) { return n === 1 ? 'Yes: the one just before.' : 'Yes: the one ' + n + ' back.'; },
    probeWrong: function (n) { return n === 1 ? 'Not that one. Compare with the one just before (now framed).' : 'Not that one. Count back ' + n + ': the framed one.'; },
    tapeFrame: 'The tape now shows only the item to compare with.',
    tapeNone: 'The tape is gone. Keep the last items in your head.',
    noButtonNote: 'The No match button is only for this practice. In real blocks you simply do nothing.',
    replay: 'Hear again',
    timedSummary: function (caught, targets, fp) {
      var s = 'You caught ' + caught + ' of ' + targets + (targets === 1 ? ' match' : ' matches');
      s += fp === 0 ? ' and never pressed when there was none.' : (fp === 1 ? ' and pressed once when there was none.' : ' and pressed ' + fp + ' times when there was none.');
      return s;
    },
    chimera: 'Questions or ideas? The Chimera community is on Discord: ',
    chimeraUrl: 'https://discord.gg/chmr',
    chimeraText: 'discord.gg/chmr',
    leave: 'Leave the lesson',
    replayNote: 'This is a replay: nothing is saved.',
    notSaved: 'Lessons and practice are never saved as training.'
  };

  // ---------------------------------------------------------------- lesson scripts
  var STEPS = {};

  STEPS['lesson.nback'] = [
    { type: 'page', part: 1, title: 'What you will see', figure: 'nback-parts', skipToCheck: true,
      lead: 'N-back is a memory game. Letters appear one at a time. For each new letter you decide one thing: does it match the letter a set number of steps back?',
      body: [
        'The number of steps is the n in n-back. You start with 1-back: compare each letter with the one just before it. Later you will try 2-back.',
        'That n is your horizon: you keep the last n items in mind and update them with every new one.',
        'This lesson takes about 6 minutes. Everything before the final check goes at your own speed.'
      ] },
    { type: 'demo', part: 2, title: '1-back, step by step', seq: 'nb1demo',
      lead: 'Watch an example. Each new letter is compared with the one just before it, which is framed on the memory tape.',
      notes: { 4: 'K appeared earlier, but not one back. Only the letter just before counts.' } },
    { type: 'guided', part: 3, title: 'Your turn: 1-back', seq: 'nb1guided', noButton: true,
      lead: 'Nothing moves until you answer. Press J or tap Match for a match; press F or tap No match when it is not one.',
      tape: [[0, 'full'], [5, 'frame'], [8, 'none']], why: [2, 4] },
    { type: 'timed', part: 4, title: 'On their own, slowly', seq: 'nb1slow', onMs: 1000, soaMs: 4000, feedback: 'per-response',
      lead: 'Now the letters move on by themselves: one every 4 seconds. The No match button is gone. When a letter does not match, simply do nothing.',
      rule: 'Press J or tap Match when the letter is the same as the one just before. Otherwise, do nothing.' },
    { type: 'timed', part: 4, title: 'The normal pace', seq: 'nb1normal', onMs: 500, soaMs: 3000, feedback: 'per-response',
      lead: 'The same, at the pace of real blocks: each letter shows for half a second, and a new one comes every 3 seconds.',
      rule: 'Press J or tap Match when the letter is the same as the one just before. Otherwise, do nothing.' },
    { type: 'demo', part: 5, title: '2-back: the frame moves', seq: 'nb2demo',
      lead: 'In 2-back you compare each letter with the one two steps back. With every new letter, the frame on the tape moves on by one.',
      notes: {
        2: 'K, T, K: the K two back matches.',
        3: 'K, T, K, T: a run like this gives a match on every letter from the third on.',
        6: 'R matches the letter just before it. At 2-back that is a lure: it almost fits the rule, but it is not a match.'
      } },
    { type: 'guided', part: 5, title: 'Your turn: 2-back', seq: 'nb2guided', noButton: true,
      lead: 'Take your time. Before some answers you will be asked which letter to compare with.',
      tape: [[0, 'full'], [7, 'frame'], [11, 'none']], probes: [3, 4, 6],
      callouts: { 5: 'Careful: this letter matches the one just before it. Does it match two back?', 12: 'Careful: this letter was on screen three steps ago. Does it match two back?' } },
    { type: 'timed', part: 5, title: '2-back, slowly', seq: 'nb2slow', onMs: 500, soaMs: 4000, feedback: 'per-response',
      lead: 'One last practice before the check: 2-back, a letter every 4 seconds, no tape.',
      rule: 'Press J or tap Match when the letter is the same as the one 2 steps back. Otherwise, do nothing.' },
    { type: 'check', part: 6, title: 'The check',
      lead: 'One full block at 2-back and the normal pace: 22 letters, about a minute. No tape this time.' },
    { type: 'end', part: 7, title: 'Done' }
  ];

  STEPS['lesson.dual'] = [
    { type: 'page', part: 1, title: 'Two streams at once', figure: 'dual-parts',
      lead: 'In Dual n-back a square moves around a grid and, at the same moment, you hear a sound. Each stream is compared with its own past.',
      body: [
        'Press J (or tap Position) when the square is in the same place as n back. Press K (or tap Sound) when the sound is the same as n back. Sometimes both match: then press both.',
        'Dual needs sound. Turn the volume up before you start.'
      ] },
    { type: 'guided', part: 2, title: 'The sounds alone', seq: 'duSound', noButton: true, sound: true,
      lead: 'First only the sounds, at 1-back. The name of each sound is printed on the tape for now, so you can check your ears.',
      tape: [[0, 'full'], [5, 'frame'], [8, 'none']] },
    { type: 'guided', part: 3, title: 'Both together', seq: 'duBoth', sound: true,
      lead: 'Now both streams at 1-back. Mark what matches: Position (J), Sound (K), both or neither. Then press Space or tap Check.',
      tape: [[0, 'full'], [6, 'none']] },
    { type: 'check', part: 4, title: 'The dual check', lead: 'One block at 1-back with both streams at the normal pace. No tape.' },
    { type: 'end', part: 5, title: 'Done' }
  ];

  STEPS['lesson.transform'] = [
    { type: 'page', part: 1, title: 'A new rule: the day after',
      lead: 'In Transform the items are days of the week. A match is not the same day: it is the day after the day n back.',
      body: [
        'At 1-back: Mon, then Tue is a match, because Tuesday is the day after Monday. Mon, then Mon is not a match: it is the same day, and the rule asks for the day after.',
        'You don’t just hold the steps, you work on them: each one changes by a rule before you compare.',
        'Sunday wraps around to Monday. This version follows Cao et al. 2026; it is marked experimental because that study was small and has not been repeated yet.'
      ] },
    { type: 'demo', part: 2, title: '1-back, step by step', seq: 'tf1demo', show: { hints: true },
      lead: 'Under the framed day, the tape shows which day would be a match.' },
    { type: 'demo', part: 2, title: 'The same rule at 2-back', seq: 'tf2demo', show: { hints: true },
      lead: 'At 2-back you shift the day two steps back by one, then compare.' },
    { type: 'guided', part: 3, title: 'Your turn', seq: 'tf1guided', noButton: true,
      lead: 'Nothing moves until you answer. The hint under the frame disappears halfway through.',
      tape: [[0, 'full'], [6, 'frame']], support: [[0, true], [5, false]] },
    { type: 'check', part: 4, title: 'The check', lead: 'One block at 1-back with days, at the normal pace. No tape and no hints.' },
    { type: 'end', part: 5, title: 'Done' }
  ];

  STEPS['lesson.arith'] = [
    { type: 'page', part: 1, title: 'Compare answers, not sums',
      lead: 'In Arithmetic each item is a small sum, such as 3 + 4. Work it out and keep the answer. A match is a sum with the same answer as the one n back.',
      body: [
        'The sums themselves always look different: 3 + 4 and 9 ' + M + ' 2 are a match at 1-back, because both make 7.',
        'You don’t just hold the steps, you work on them: each one changes by a rule before you compare.',
        'Watch for lures that look alike: 5 + 1 and 5 ' + M + ' 1 start the same way but make 6 and 4.'
      ] },
    { type: 'demo', part: 2, title: 'Step by step', seq: 'ar1demo', show: { values: true },
      lead: 'The tape shows each answer under its sum.' },
    { type: 'guided', part: 3, title: 'Your turn', seq: 'ar1guided', noButton: true,
      lead: 'Nothing moves until you answer. The answers on the tape disappear halfway through.',
      tape: [[0, 'full'], [6, 'frame']], support: [[0, true], [5, false]] },
    { type: 'check', part: 4, title: 'The check', lead: 'One block at 1-back with sums, at the normal pace. No tape.' },
    { type: 'end', part: 5, title: 'Done' }
  ];

  STEPS['lesson.switch'] = [
    { type: 'page', part: 1, title: 'The cue says what counts', figure: 'switch-cue',
      lead: 'In Switch each item is a digit in a place on a grid. A cue above it says WHAT or WHERE.',
      body: [
        'WHAT: compare the digit with the digit n back and ignore its place. WHERE: compare the place with the place n back and ignore the digit.',
        'You don’t just hold the steps, you work on them: the cue says which feature to compare.',
        'The cue can change from one item to the next, so read it every time.'
      ] },
    { type: 'demo', part: 2, title: 'Step by step', seq: 'sw1demo', lead: 'Each item is compared with the one just before it, using the feature the cue names.' },
    { type: 'guided', part: 3, title: 'Your turn', seq: 'sw1guided', noButton: true,
      lead: 'Read the cue, then compare that feature with the item just before. Nothing moves until you answer.',
      tape: [[0, 'full'], [6, 'none']] },
    { type: 'check', part: 4, title: 'The check', lead: 'One block at 1-back with the cue, at the normal pace. No tape.' },
    { type: 'end', part: 5, title: 'Done' }
  ];

  STEPS['lesson.steps'] = [
    { type: 'page', part: 1, title: 'Equal steps', figure: 'steps-example',
      lead: 'Numbers appear one at a time. A match is a number whose step from the last number is the same size as the step before it.',
      body: [
        '3, 6, 9: the steps are 3 and 3, so 9 is a match. Up or down does not matter: 9, 8, 7 has steps of 1 and 1, so 7 is a match too.',
        'You hold several items and the relation between them at once.',
        'This task follows Wang et al. 2025. It is marked experimental: the study was small, and its reasoning test did not improve more than in the control group.'
      ] },
    { type: 'demo', part: 2, title: 'Step by step', seq: 'st1demo', show: { steps: true },
      lead: 'The tape writes each step between the numbers.' },
    { type: 'guided', part: 3, title: 'Your turn', seq: 'st1guided', noButton: true,
      lead: 'Nothing moves until you answer. The steps under the numbers disappear halfway through.',
      tape: [[0, 'full']], support: [[0, true], [6, false]] },
    { type: 'demo', part: 4, title: 'Later: 2-back', seq: 'st2demo', show: { arcs: true },
      lead: 'Higher levels compare jumps two numbers apart. The arcs show the two jumps: 6 to 8 and 9 to 7 are both 2, so 7 is a match.' },
    { type: 'check', part: 5, title: 'The check', lead: 'One block at 1-back with numbers up to 9, at the normal pace. No tape.' },
    { type: 'end', part: 6, title: 'Done' }
  ];

  STEPS['lesson.grid'] = [
    { type: 'page', part: 1, title: 'The grid', figure: 'grid-parts',
      lead: 'Each screen shows a 3×3 grid. Each cell holds a short group of symbols; only its last symbol counts, the rest is there to distract you.',
      body: [
        'Your question: is there a row or a column whose last symbols follow the rule? In this first tier the rule is SAME: all three equal.',
        'You hold several items and the relation between them at once.',
        'Every grid has either exactly one such line or none. Answer Match (J) or No (F) before the grid goes.'
      ] },
    { type: 'lines-demo', part: 2, title: 'Worked examples', arrays: ['gridRow', 'gridCol', 'gridNear'],
      lead: 'The last symbols are highlighted. Step through three grids.' },
    { type: 'lines', part: 3, title: 'Tap the line', arrays: ['gridTap1', 'gridTap2', 'gridTap3'],
      lead: 'Each grid below has one line where the last symbols are all the same. Tap its row or column label.' },
    { type: 'arrays', part: 4, title: 'Your turn, at your own speed', mode: 'guided', gen: { rung: 0, targets: 3, others: 3 },
      lead: 'Match or No? Nothing moves until you answer. The last symbols stay highlighted.' },
    { type: 'arrays', part: 4, title: 'Now with a time limit', mode: 'timed', gen: { rung: 0, targets: 3, others: 3 },
      lead: 'Six grids, 8 seconds each, no highlight. Answer before each grid goes.' },
    { type: 'check', part: 5, title: 'The check', lead: 'Twenty grids at step 2: 5.5 seconds each.' },
    { type: 'end', part: 6, title: 'Done' }
  ];

  STEPS['lesson.stream'] = [
    { type: 'page', part: 1, title: 'One cell at a time', figure: 'stream-parts',
      lead: 'Relation Stream uses the same kind of grid, but it stays on screen. Every couple of seconds one cell changes.',
      body: [
        'Press J or tap Match as soon as a row or column shows the pattern, for example three equal last symbols. You have until the next change.',
        'You hold several items and the relation between them at once.',
        'Some blocks ask for all the same, others for all different: the card before each block says which.'
      ] },
    { type: 'stream-demo', part: 2, title: 'Step by step', lead: 'The changed cell is outlined. Step through until a line appears.' },
    { type: 'stream-guided', part: 3, title: 'Your turn', lead: 'After each change: Match, or Next when nothing has appeared. Nothing moves until you answer.' },
    { type: 'check', part: 4, title: 'The check', lead: 'One block: 30 changes, one every 2 seconds. Rule: all the same.' },
    { type: 'end', part: 5, title: 'Done' }
  ];

  STEPS['lesson.span'] = [
    { type: 'page', part: 1, title: 'Remember while you check', figure: 'span-parts',
      lead: 'Complex span mixes two jobs. A sum appears: say whether it is right. Then a letter appears: remember it. This repeats, and at the end you tap the letters in order.',
      body: [
        'True: press J or tap True. False: press F or tap False. Then the letter shows for one second.',
        'You hold a list while you do something else in between.',
        'Backward span asks for the letters in reverse order; Symbol span uses symbols instead of letters.'
      ] },
    { type: 'span-demo', part: 2, title: 'A worked list', lead: 'Two sums, two letters, then the keypad.' },
    { type: 'span-guided', part: 3, title: 'Your turn', lead: 'At your own speed: check each sum, remember each letter, then tap the letters in order.' },
    { type: 'page', part: 4, title: 'Keep the maths accurate',
      lead: 'The sums are not a side task. Your level only goes up when at least 85 % of your sum answers are right.',
      body: ['Rushing the sums to rehearse the letters makes the task easier than it should be. Answer each sum carefully, then take in the letter.'] },
    { type: 'check', part: 5, title: 'The check', lead: 'Three lists of two letters, with a time limit on each sum.' },
    { type: 'end', part: 6, title: 'Done' }
  ];

  STEPS['lesson.vsearch'] = [
    { type: 'page', part: 1, title: 'Find the T', figure: 'vsearch-parts',
      lead: 'Each display shows a scatter of letters turned in different directions. Most are Ls. Is there a T among them?',
      body: ['Press J or tap Present if you find a T. Press F or tap Absent if there is none. Answer before the display goes; it moves on at once when you answer.'] },
    { type: 'vs-guided', part: 2, title: 'Your turn', lead: 'Four displays at your own speed.' },
    { type: 'check', part: 3, title: 'The check', lead: 'Twenty displays of 8 symbols, 3 seconds each.' },
    { type: 'end', part: 4, title: 'Done' }
  ];

  // ---------------------------------------------------------------- mini-lessons after a failed n-back check
  var MINI = {
    nothing: { title: 'Doing nothing is an answer',
      lead: 'Most letters, about 2 in every 3, are not matches. For those, the right answer is to do nothing.',
      body: ['A press "just in case" counts as a false press, and false presses lower the score as much as matches that slip by. If you are not sure, it is fine to let a letter pass.'],
      fromCheck: 'From your check:',
      drill: { seq: 'miniNothing', title: 'Practice: hold back', tape: [[0, 'frame']], noButton: true,
        lead: 'Only two of these letters are matches. Answer No match for all the others.' } },
    window: { title: 'The moving window',
      lead: 'At 2-back the letter to compare with is always exactly two steps back. With each new letter, that spot moves on by one.',
      body: ['Letters that match one step back or three steps back are lures. They feel familiar because they were on screen recently, but they are not matches. Before you press, check the distance: exactly two.'],
      fromCheck: 'From your check:',
      drill: { seq: 'miniWindow', title: 'Practice: watch the distance', tape: [[0, 'full'], [6, 'frame']], noButton: true, probes: [5, 7],
        lead: 'The frame shows the letter two back. Two lures are hidden in this list.' } },
    keys: { title: 'The key map',
      lead: 'Only one key counts in n-back: J, or a tap on Match. Other keys do nothing during a block.',
      body: ['Keep a finger resting on J. When there is no match, keep your hands still. Esc or P pauses if you need a break.'],
      drill: { title: 'Practice: find the key', rounds: 3, lead: 'Press the Match key (J) now, or tap Match.' } },
    timing: { title: 'Timing',
      lead: 'Each letter shows for half a second. You can still press until the next letter appears, 3 seconds in all.',
      body: ['A press made after the next letter has appeared counts for the new letter, not the old one. Press as soon as you see a match; there is no need to wait.'],
      fromCheck: 'From your check:',
      drill: { seq: 'miniTiming', title: 'Practice: press on time', onMs: 500, soaMs: 4000, feedback: 'per-response',
        lead: '2-back, a letter every 4 seconds. Press while the letter is on screen or soon after.',
        rule: 'Press J or tap Match when the letter is the same as the one 2 steps back. Otherwise, do nothing.' } }
  };

  // ---------------------------------------------------------------- Relation Grid tier intros
  var TIERS = {
    T2: { tier: 2, title: 'New tier: Ascending', rule: 'Look for a row or column whose last symbols go up in order: left to right in a row, top to bottom in a column.',
      body: ['A line that goes down does not count. With symbols that have no natural order, a key at the top shows the order.'], set: 'digits' },
    T3: { tier: 3, title: 'New tier: Different', rule: 'Look for a row or column whose last symbols are all different.',
      body: ['Lines with two equal symbols are close, but they do not count.'], set: 'digits' },
    T4: { tier: 4, title: 'New tier: Same or different, with diagonals', rule: 'The rule at the top of each block says SAME or DIFFERENT. Lines now include the two diagonals.',
      body: ['Read the rule before the first grid: it stays the same for the whole block.'], set: 'digits' },
    T5: { tier: 5, title: 'New tier: Five the same', rule: 'Look for five cells whose last symbols are all the same, in the shape of a plus or a T (any way up).',
      body: ['Rows and columns alone no longer count: the five cells must form the shape.'], set: 'digits' },
    T6: { tier: 6, title: 'New tier: Two features', rule: 'Each cell is one symbol with a shape and a fill. The rule at the top says which feature must be the same along a line, and which must all differ.',
      body: ['For example: same shape, all different fills. A line where only one of the two holds is not a match.'], set: 'shapes' },
    T7: { tier: 7, title: 'New tier: 4×4 grid', rule: 'The grid grows to 4×4. The rule at the top says SAME or DIFFERENT, and a line has four cells.',
      body: ['Diagonals do not count in this tier: only rows and columns.'], set: 'digits' },
    T8: { tier: 8, title: 'New tier: Five different', rule: 'Look for five cells in a plus or a T shape whose last symbols are all different.',
      body: ['This optional tier is very hard. It is fine to stay on earlier tiers.'], set: 'digits' }
  };

  // ---------------------------------------------------------------- end pages
  var END = {
    nbackPassed: { title: 'You passed the check',
      body: ['In training the items change: squares in a grid, letters, digits, shapes and more. The rule stays the same: compare with the item n steps back.',
        'Each session mixes n-back with other tasks. Before every block a card shows the rule, and new kinds of task get a short lesson the first time they appear.',
        'Your level adapts as you go: up when a block goes well, back down when it is too hard. Aim for steady effort, not perfect blocks.'] },
    nbackAssisted: { title: 'Let’s train with the tape on',
      body: ['The check is hard at first, and many people need more than one try. That is normal.',
        'Your first n-back blocks will run at 2-back with the memory tape switched on. Once two blocks reach the check level (4 of 6 matches, at most 2 extra presses), the tape goes away.'] },
    passed: { title: 'Lesson passed', body: ['This task now starts at an easy level and adapts to you. You can replay this lesson any time in Learn.'] },
    notYet: { title: 'Not yet, and that is fine',
      body: ['Training starts at an easy level and adapts to you, so you can go ahead. You can replay this lesson any time in Learn.'] },
    assistedGrid: { title: 'Let’s start with help',
      body: ['Your first Relation Grid blocks will highlight the symbols that count. The help goes away once two blocks reach the check level.'] },
    replay: { title: 'Replay finished', body: ['Nothing from a replay is saved.'] }
  };

  function get(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return null; }
  function forTrack(trackId) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].trackIds.indexOf(trackId) >= 0) return LIST[i].id;
    return null;
  }
  function ids() { return LIST.map(function (l) { return l.id; }); }

  var api = { LIST: LIST, CHECKS: CHECKS, SEQ: SEQ, STEPS: STEPS, MINI: MINI, TIERS: TIERS, END: END, TEXT: TEXT,
    get: get, forTrack: forTrack, ids: ids, MINUS: M };
  content.lessons = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
