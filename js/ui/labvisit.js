/* Long-Horizon — Lab visit flow (route 'labvisit'). Browser only, ES2019 (async/await), MIT. Owner: P2 (Lab UI).
   Notes: docs/dev/lab-ui-notes.md. Spec: PLAN §6, research/04 §12–19, SPEC §3.4, contracts-ui §1–2.

   Route params: { kind: 'B1'|'B2'|'Q'|'POST'|'FU'|'X' (default: the schedule's next visit),
                   config: 'standard'|'minimum'|'quick'|'extended' (default: this kind's earlier config, Q → 'quick',
                   else settings.labConfig), part: 'A'|'B'|null (null = whatever is still to do, memory first) }
   Flow (one sitting = one LabVisitRecord; a visit may take two sittings, Part A memory and Part B reasoning, inside
   its window — HF.lab.schedule merges them):
     device + time-of-day check (with the flags this visit will carry) → check-in (sleep, alertness, place, and at
     B1/B2/POST the expectation item; study participants get HF.study.questions.expect at B2/POST as study-expect events)
     → the record is created → for each test: plain instructions → the fixed practice items (feedback allowed) →
     the scored run (no feedback; chrome hidden) → TestResult saved at once (HF.store.mutate + saveTrials + flush) →
     a short break → (after Part A, a choice: Part B now or later) → close-out (effort, help used → flag 'help-used',
     strategies, interruptions; study at POST: the blinding guess as a study-blind event) → at POST: the required export
     step (backup copy box + download, with the reason) → done.
   The export step fills its box with HF.store.exportText({ stamp: false }); HF.store.markBackup() stamps the backup only
   on Copy, Download or "I have saved it" (CB-01). The visit holds HF.timing.keepAwake(true) from the "Start the tests"
   click to the done screen or leaving the route (CB-15). Study questions and the study export appear only while the
   participant is in a study they have not left (HF.study.state(records).left == null).
   Pausing: Escape / P / Pause button / page hidden. Discrete tests void the item in progress and resume; a paused
   n-back stream restarts its block with a fresh sequence (derived seed) after a 3-2-1; every restart counts in
   result.restarts and flags the visit 'paused', also when the player restarts the block itself (CB-06: its attempt
   count, or the calls of `regenerate`). "Stop the visit" keeps the tests
   already finished (the record stays; flag 'stopped-early'; the remaining tests are offered next time).
   Probes: lab.nback and lab.rel run each block through HF.player.runSpec(blockSpec, 'nback'|'relations', opts) when the
   player and the view exist (P1a / P1b); otherwise an internal fallback runs them on HF.timing.runStream /
   HF.timing.runDiscrete with HF.views.nback / HF.views.relations if present, else with minimal built-in views.

   Saved per test: records.labVisits[i].tests[testId] = TestResult (+ frame: { fps, medianMs, maxMs, stalls }),
   trial log: HF.store.saveTrials(visitId, testId, { log, form, seed, spec? (only when a block was replaced) }, { kind: 'lab' }).
   HF.ui.labvisit = { TEST_COPY, labLogs(records) → { [visitId]: { [testId]: { log, spec? } } } (for HF.lab.exportBundle),
                      detectDevice(), runNbackProbe, runRelProbe }
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  var ui = HF.ui || (HF.ui = {});

  var KIND_NAME = { B1: 'Baseline 1', B2: 'Baseline 2', Q: 'Quick check', POST: 'Post-test', FU: 'Follow-up', X: 'Extra memory check' };
  var PART_NAME = { A: 'Part A · memory', B: 'Part B · reasoning and control' };

  var TEST_COPY = {
    'lab.nback': {
      name: 'N-back probe', practice: 'one short 2-back block with feedback',
      what: 'Shapes you have never trained with appear one at a time, every 3 seconds. Press Match when a shape is the same as the one 2 before. Two of the four blocks ask for 3 back instead; each block tells you which.',
      how: ['Press only for a match. When it is not a match, do nothing.', 'Some shapes repeat 1 or 3 steps back. In a 2-back block those are not matches.', 'There are 4 blocks of about a minute each, with a short break between them.'],
      keys: [['J', 'or tap Match: the shape matches']]
    },
    'lab.rel': {
      name: 'Relation probe', practice: '4 practice grids for each rule, with feedback',
      what: 'A 3 × 3 grid of cells appears. Each cell shows three small squares with a dot in one of eight places. Only the last square of each cell (the right-hand one) counts. Decide whether any row or column fits the rule.',
      how: ['First rule (20 grids): Same. A row or column fits when its three last squares have the dot in the same place.', 'Second rule (20 grids): Different. A row or column fits when its three last squares have the dot in three different places.', 'You have 5.5 seconds per grid. Half of the grids have a row or column that fits.'],
      keys: [['J', 'or tap Yes: a row or column fits'], ['F', 'or tap No: none fits']]
    },
    'lab.sspan': {
      name: 'Spatial span', practice: '2 short practice sets with feedback',
      what: 'Two jobs at once. First decide whether a pattern is the same on both sides of its middle line. Then a square lights up in a 4 × 4 grid: remember where. After 2 to 5 of these, tap the squares in the order they lit up.',
      how: ['Judge each pattern quickly; you have up to 6 seconds.', 'Keep the squares in order. If you forget one, use Skip one so the rest stay in their places.', 'There are 12 sets.'],
      keys: [['J', 'or tap Symmetric'], ['F', 'or tap Not symmetric']]
    },
    'lab.update': {
      name: 'Updating', practice: 'one short practice round with feedback',
      what: 'Coloured squares appear one at a time on a 3 × 3 grid. Each colour moves from place to place. At the end, show where each colour was last.',
      how: ['Each colour also has its own pattern and name, so you never need to rely on colour alone.', 'Keep track of the latest place of every colour; earlier places do not matter.', 'There are 10 rounds with 2 to 4 colours.'],
      keys: [['1–9', 'or tap the square (1 = top left, 9 = bottom right)']]
    },
    'lab.bind': {
      name: 'Colour and place', practice: '2 short practice rounds with feedback',
      what: 'Colours appear one at a time, each in its own square of a 3 × 3 grid. Then one square at a time is marked: which colour was there?',
      how: ['Each colour has a pattern and a name as well.', 'There are 14 rounds with 2 to 6 colours.'],
      keys: [['1–6', 'or tap the colour']]
    },
    'lab.matrix': {
      name: 'Puzzles', practice: 'the same 4 worked examples at every visit',
      what: 'Each puzzle is a 3 × 3 grid of shapes with the bottom-right cell missing. Every feature (shape, size, fill, turn, number, position) follows its own rule along the rows or down the columns. Choose the option that fits every rule.',
      how: ['A feature can stay the same, change in equal steps, or show three different values once in every row or column.', 'You have 45 seconds per puzzle; a quiet countdown shows the time.', 'There are 20 puzzles; two of them are very easy checks.'],
      keys: [['1–8', 'or tap an option'], ['Enter', 'or Confirm: send your answer']]
    },
    'lab.series': {
      name: 'Series', practice: '2 practice series with feedback',
      what: 'Each row is a series of numbers or letters that follows a rule. Type the next one.',
      how: ['Numbers are whole numbers, 0 or more. Letters are A to Z; upper or lower case is fine.', 'You have 60 seconds per series. There are 14.'],
      keys: [['Enter', 'send your answer'], ['Esc', 'pause']]
    },
    'lab.graph': {
      name: 'Graph mapping', practice: '2 practice items with feedback',
      what: 'Two drawings show the same network of arrows, drawn differently. On the left, two dots are marked 1 (ring) and 2 (square). Find the dots on the right that play the same part: tap the match for 1, then the match for 2.',
      how: ['Count the arrows going in and out of each marked dot, then look at its neighbours.', 'You have 24 seconds per item; a note appears when 5 seconds are left. There are 17 items; one is a very easy check.'],
      keys: [['A–F', 'or tap a dot'], ['1 / 2', 'choose which mark to place'], ['Enter', 'or Confirm']]
    },
    'lab.switch': {
      name: 'Task switching', practice: 'a few practice trials before each part, with feedback',
      what: 'A digit appears inside a frame. The frame and its word tell you which question to answer: LOW · HIGH in a square — is it lower or higher than 5? ODD · EVEN in a diamond — is it odd or even?',
      how: ['Left (F) means LOW or ODD. Right (J) means HIGH or EVEN.', 'First one question at a time, then both mixed. Be fast and accurate.', 'This test is exploratory: its scores are known to be noisy.'],
      keys: [['F', 'or the left button: LOW / ODD'], ['J', 'or the right button: HIGH / EVEN']]
    }
  };

  /* ------------------------------------------------------------ small helpers */
  function C() { return ui.c; }
  function h(tag, attrs, kids) { return C() ? C().h(tag, attrs, kids) : HF.dom.el(tag, attrs, kids); }
  function K() { return HF.labKit; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dateText(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1); }
  }
  function uid(p) { return HF.util && HF.util.id ? HF.util.id(p) : p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function chrome(on) { try { if (ui.shell && typeof ui.shell.chrome === 'function') ui.shell.chrome(on); } catch (e) { /* ignore */ } }
  /** CB-15: the visit holds the session wake lock from "Start the tests" to the done screen (or leaving); the player
      releases its own session lock after each runSpec, so the visit asks again after every player run (v.awake). */
  function awake(v, on) {
    if (v) v.awake = !!on;
    try { if (HF.timing && typeof HF.timing.keepAwake === 'function') HF.timing.keepAwake(!!on); } catch (e) { /* ignore */ }
  }
  function stayAwake(v) { if (v && v.awake && alive(v)) awake(v, true); }
  /** the participant's study, unless they left it (HF.study.state(...).left): left studies ask no study questions */
  function activeStudy(recs) {
    var st = HF.study && HF.study.state ? HF.study.state(recs) : null;
    return st && !st.left ? st : null;
  }
  function focusEl(n) { if (!n) return; try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
  function btn(label, o) {
    o = o || {};
    if (C()) return C().button(label, o);
    var b = h('button', { type: 'button', 'class': 'hf-btn hf-btn--' + (o.variant || 'secondary') }, [label]);
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function testName(id) { return (TEST_COPY[id] && TEST_COPY[id].name) || (HF.lab.tests[id] && HF.lab.tests[id].label) || id; }
  function minutesOf(id) { return HF.lab.minutesOf ? HF.lab.minutesOf(id) : 5; }
  function hourOf(ms) { var d = new Date(ms); return d.getHours() + d.getMinutes() / 60; }
  function circ(a, b) { var d = Math.abs(a - b); return Math.min(d, 24 - d); }

  function detectDevice() {
    var mm = function (q) { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (e) { return false; } };
    var coarse = mm('(pointer: coarse)');
    var sw = root.screen ? Math.min(root.screen.width || 0, root.screen.height || 0) : 0;
    var cls = coarse ? (sw >= 600 ? 'tablet' : 'phone') : 'desktop';
    return { 'class': cls, input: coarse ? 'touch' : 'keyboard' };
  }

  /** button press → Promise; Space/Enter also press it when focus is not on another control */
  function waitFor(button, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var off = null;
      function go(e) { if (off) off(); off = null; button.removeEventListener('click', go); resolve(e); }
      button.addEventListener('click', go);
      if (o.keys !== false && K()) {
        off = K().keys(function (e) {
          if (e.code !== 'Space' && e.key !== 'Enter') return;
          var t = e.target;
          if (t && t !== doc.body && t !== button && t.closest && t.closest('button, a, input, select, textarea, summary, [role="button"]')) return;
          e.preventDefault();
          go(e);
        });
      }
      V && V.offs.push(function () { if (off) off(); button.removeEventListener('click', go); });
    });
  }
  function waitAny(buttons) {
    return new Promise(function (resolve) {
      buttons.forEach(function (b, i) { b.addEventListener('click', function () { resolve(i); }); });
    });
  }

  /* ------------------------------------------------------------ visit state */
  var V = null;
  function alive(v) { return !!v && V === v && !v.left; }

  function findRec(records, id) {
    var list = records.labVisits || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function doneTests(records, kind) {
    var out = {};
    if (kind === 'X') return out;
    (records.labVisits || []).forEach(function (v) {
      if (!v || v.kind !== kind) return;
      Object.keys(v.tests || {}).forEach(function (id) { out[id] = true; });
    });
    return out;
  }

  function planVisit(params) {
    var recs = HF.store.records, now = Date.now();
    var sched = HF.lab.schedule(recs, HF.store.derived, now);
    var kind = params.kind || (sched.next && sched.next.kind) || 'X';
    if ((HF.lab.KINDS || []).indexOf(kind) < 0) kind = 'X';
    var prev = (recs.labVisits || []).filter(function (v) { return v && v.kind === kind && v.config && kind !== 'X'; });
    var settings = recs.settings || {};
    var config = params.config || (prev.length ? prev[0].config : null) || (kind === 'Q' ? 'quick' : (settings.labConfig || 'standard'));
    if (!HF.lab.CONFIGS[config]) config = 'standard';
    var done = doneTests(recs, kind);
    var all = sched.testsFor(kind, config);
    var tests = all.filter(function (id) { return !done[id]; });
    if (params.part === 'A' || params.part === 'B') tests = tests.filter(function (id) { return HF.lab.partOf(id) === params.part; });
    var missing = tests.filter(function (id) { return !HF.lab.tests[id]; });
    tests = tests.filter(function (id) { return !!HF.lab.tests[id]; });
    // memory first, then reasoning and control
    tests.sort(function (a, b) { return (HF.lab.partOf(a) === 'A' ? 0 : 1) - (HF.lab.partOf(b) === 'A' ? 0 : 1) || all.indexOf(a) - all.indexOf(b); });
    var seeds = {};
    tests.forEach(function (id) { seeds[id] = sched.seedFor(kind, id); });
    var entry = null;
    (sched.plan || []).forEach(function (e) { if (e.kind === kind) entry = e; });
    return { kind: kind, config: config, tests: tests, all: all, missing: missing, form: sched.formFor(kind), seeds: seeds, sched: sched, entry: entry };
  }

  /** the reference visit for device / time-of-day comparison: first B1, else the first visit */
  function refVisit(records) {
    var vs = (records.labVisits || []).filter(function (v) { return v && typeof v.startedAt === 'number' && Object.keys(v.tests || {}).length; })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    for (var i = 0; i < vs.length; i++) if (vs[i].kind === 'B1') return vs[i];
    return vs[0] || null;
  }

  /* ------------------------------------------------------------ rendering helpers */
  function header(v, title, lead) {
    clear(v.head);
    v.head.appendChild(h('h1', { 'class': 'hf-h1', tabindex: '-1' }, [title]));
    if (lead) v.head.appendChild(h('p', { 'class': 'hf-lead' }, [lead]));
  }
  function stepList(v) {
    clear(v.steps);
    v.tests.forEach(function (id, i) {
      var state = v.results[id] ? 'is-done' : (i === v.cur ? 'is-now' : '');
      v.steps.appendChild(h('li', { 'class': state, 'aria-current': i === v.cur ? 'step' : null }, [testName(id)]));
    });
    v.steps.hidden = v.tests.length < 2;
  }
  function body(v) { clear(v.body); return v.body; }
  function focusHead(v) { var h1 = v.head.querySelector('h1'); if (h1) focusEl(h1); try { root.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  function setBare(v, bare) {
    v.bare = !!bare;
    chrome(!bare);
    v.head.hidden = !!bare;
    v.steps.hidden = !!bare || v.tests.length < 2;
    v.el.classList.toggle('hf-lv--bare', !!bare);
  }

  /* ------------------------------------------------------------ step: device and time */
  async function stepDevice(v) {
    var recs = HF.store.records, now = Date.now();
    var dev = detectDevice();
    var ref = refVisit(recs);
    var sched = v.plan.sched;
    header(v, KIND_NAME[v.kind] + (v.partLabel ? ' · ' + v.partLabel : ''), 'Before you start: a quick check of the device and the time of day.');
    var b = body(v);
    var notes = [];
    if (ref) {
      var rd = ref.device || {};
      if (rd['class'] && rd['class'] !== dev['class']) notes.push({ tone: 'warn', title: 'Different kind of device', text: 'Your first visit was on a ' + rd['class'] + '; this looks like a ' + dev['class'] + '. Scores can shift with the device, so this visit will be marked. If you can, use the same kind of device each time.' });
      if (rd.input && rd.input !== dev.input) notes.push({ tone: 'warn', title: 'Different way of answering', text: 'Your first visit used ' + (rd.input === 'touch' ? 'touch' : 'a keyboard') + '; this one looks like ' + (dev.input === 'touch' ? 'touch' : 'a keyboard') + '. The visit will be marked.' });
      var refHour = typeof ref.hour === 'number' ? ref.hour : hourOf(ref.startedAt);
      if (circ(refHour, hourOf(now)) > 3) notes.push({ tone: 'warn', title: 'Different time of day', text: 'Your first visit started at ' + hhmm(ref.startedAt) + '; it is ' + hhmm(now) + ' now, more than 3 hours apart. Alertness changes over the day, so this visit will be marked. You can still go on.' });
    }
    if (sched.trainedToday && v.kind !== 'X') notes.push({ tone: 'warn', title: 'You trained earlier today', text: 'Lab visits should come before training on the same day, so tiredness and practice do not colour the scores. Best: come back on a day before you train. You can still go on; the visit will be marked.' });
    var e = v.plan.entry;
    if (e && e.status === 'upcoming' && e.dueFrom) notes.push({ tone: 'info', title: 'A little early', text: 'This visit is due from ' + dateText(e.dueFrom) + '. Taking it now marks it as outside its window.' });
    if (e && e.status === 'overdue') notes.push({ tone: 'info', title: 'A little late', text: 'The window for this visit has passed. You can still take it; it will be marked as outside its window.' });
    if (!notes.length) notes.push({ tone: 'good', title: ref ? 'Matches your first visit' : 'Your first visit', text: ref ? 'Same kind of device and a similar time of day. Good.' : 'The device and the time are recorded, so later visits can match them. Pick a time of day you can repeat.' });

    var clsSeg = C().segmented({ legend: 'This device is a', name: 'lv-dev', value: dev['class'],
      options: [{ value: 'phone', label: 'Phone' }, { value: 'tablet', label: 'Tablet' }, { value: 'desktop', label: 'Computer' }],
      onChange: function (val) { dev['class'] = val; } });
    var inSeg = C().segmented({ legend: 'I will answer with', name: 'lv-in', value: dev.input,
      options: [{ value: 'keyboard', label: 'Keyboard or mouse' }, { value: 'touch', label: 'Touch' }],
      onChange: function (val) { dev.input = val; } });
    var go = btn('Continue', { variant: 'primary', kbd: 'Space' });
    var back = btn('Back to the Lab', { variant: 'quiet', go: 'lab' });
    b.appendChild(h('div', { 'class': 'hf-lv__form' }, [
      h('div', { 'class': 'hf-lv__facts' }, notes.map(function (n) { return C().notice({ tone: n.tone, title: n.title, text: n.text }); })),
      h('p', { 'class': 'hf-soft' }, ['Now: ' + dateText(now) + ', ' + hhmm(now) + '. About ' + v.minutes + ' minutes for this sitting. Find a quiet place, silence notifications, and keep the window in front.']),
      clsSeg, inSeg,
      h('div', { 'class': 'hf-actions' }, [back, go])
    ]));
    focusHead(v);
    await waitFor(go);
    v.device = dev;
  }

  /* ------------------------------------------------------------ step: check-in */
  function scale(legend, name, lo, hi, loLabel, hiLabel, value, onChange) {
    var opts = [];
    for (var i = lo; i <= hi; i++) opts.push({ value: i, label: String(i) });
    var seg = C().segmented({ legend: legend, name: name, options: opts, value: value, onChange: onChange });
    seg.classList.add('hf-lv__scale');
    return h('div', { 'class': 'hf-stack hf-stack--sm' }, [seg, h('div', { 'class': 'hf-lv__ends', 'aria-hidden': 'true' }, [h('span', null, [lo + ' = ' + loLabel]), h('span', null, [hi + ' = ' + hiLabel])])]);
  }

  async function stepCheckin(v) {
    var recs = HF.store.records;
    var st = activeStudy(recs);
    var ans = { sleepHours: null, alertness: null, place: null, trainedToday: !!v.plan.sched.trainedToday, expect: null };
    header(v, 'Check-in', 'A few quick questions. They help read your results correctly; there are no right answers.');
    var b = body(v);
    var sleepSel = C().select({ label: 'How long did you sleep last night?', value: '',
      options: [{ value: '', label: 'Choose…' }, { value: '4', label: 'Less than 5 hours' }, { value: '5', label: 'About 5 hours' }, { value: '6', label: 'About 6 hours' },
        { value: '7', label: 'About 7 hours' }, { value: '8', label: 'About 8 hours' }, { value: '9', label: '9 hours or more' }],
      onChange: function (val) { ans.sleepHours = val === '' ? null : +val; } });
    var alert = scale('How alert do you feel right now?', 'lv-alert', 1, 5, 'very tired', 'very alert', null, function (val) { ans.alertness = +val; });
    var place = C().segmented({ legend: 'Where are you doing this?', name: 'lv-place', options: [
      { value: 'quiet', label: 'Quiet, on my own' }, { value: 'some', label: 'Some distractions' }, { value: 'busy', label: 'Noisy or busy' }],
      onChange: function (val) { ans.place = val; } });
    var kids = [sleepSel, alert, place];
    var studyExpect = st && (v.kind === 'B2' || v.kind === 'POST') && HF.study.questions;
    var expVals = {};
    if (studyExpect) {
      var q = HF.study.questions.expect;
      kids.push(h('p', { 'class': 'hf-strong' }, [q.prompt]));
      q.items.forEach(function (it) {
        kids.push(scale(it.text, 'lv-ex-' + it.id, q.scale.min, q.scale.max, q.scale.minLabel, q.scale.maxLabel, null, function (val) { expVals[it.id] = +val; }));
      });
    } else if (v.kind === 'B1' || v.kind === 'B2' || v.kind === 'POST') {
      kids.push(scale(v.kind === 'POST' ? 'How much do you think your training changed your results on these tests?' : 'How much do you expect training to improve your results on these tests?', 'lv-expect', 0, 10, 'not at all', 'a great deal', null, function (val) { ans.expect = +val; }));
    }
    kids.push(h('p', { 'class': 'hf-small hf-muted' }, [ans.trainedToday ? 'Long-Horizon says you trained earlier today; that is noted with this visit.' : 'No training logged today. Good: the Lab should come before training on a training day.']));
    var go = btn('Start the tests', { variant: 'primary' });
    go.addEventListener('click', function () { if (alive(v)) awake(v, true); });   // CB-15: inside the click
    kids.push(h('div', { 'class': 'hf-actions' }, [go]));
    b.appendChild(h('div', { 'class': 'hf-lv__form' }, kids));
    focusHead(v);
    await waitFor(go, { keys: false });
    v.checkin = ans;
    if (studyExpect && Object.keys(expVals).length) {
      HF.store.mutate(function (r) {
        r.events = r.events || [];
        r.events.push({ id: uid('ev'), t: Date.now(), type: 'study-expect', when: v.kind, values: expVals });
      });
      v.checkin.studyExpect = expVals;
    }
  }

  /* ------------------------------------------------------------ the visit record */
  function createRecord(v) {
    var now = Date.now();
    v.recId = uid('lv');
    var rec = {
      id: v.recId, kind: v.kind, config: v.config, form: v.form, startedAt: now, endedAt: null, updatedAt: now,
      part: v.partsInSitting.join(''), device: v.device, hour: Math.round(hourOf(now) * 100) / 100,
      checkin: v.checkin || {}, closeout: {}, tests: {}, flags: [], appVersion: HF.VERSION || null
    };
    // a test of this kind that an earlier sitting stopped in the middle is a retake
    var stopped = (HF.store.records.labVisits || []).filter(function (x) { return x && x.kind === v.kind && v.kind !== 'X' && x.closeout && x.closeout.stoppedDuring; })
      .map(function (x) { return x.closeout.stoppedDuring; });
    v.retakes = stopped;
    HF.store.mutate(function (r) { r.labVisits = r.labVisits || []; r.labVisits.push(rec); });
    HF.store.flush();
  }

  function addFlag(v, f) {
    HF.store.mutate(function (r) {
      var rec = findRec(r, v.recId);
      if (!rec) return;
      rec.flags = rec.flags || [];
      if (rec.flags.indexOf(f) < 0) rec.flags.push(f);
      rec.updatedAt = Date.now();
    });
  }

  function frameSummary(log) {
    var frames = [];
    if (!log) return null;
    if (log.frame) frames.push(log.frame);
    (log.blocks || []).forEach(function (b) { if (b && b.frame) frames.push(b.frame); });
    if (!frames.length) return null;
    var fps = frames.map(function (f) { return f.fps; }).filter(function (x) { return typeof x === 'number'; });
    var med = frames.map(function (f) { return f.medianMs; }).filter(function (x) { return typeof x === 'number'; });
    return {
      fps: fps.length ? Math.round(fps.reduce(function (a, c) { return a + c; }, 0) / fps.length * 10) / 10 : null,
      medianMs: med.length ? Math.round(med.reduce(function (a, c) { return a + c; }, 0) / med.length * 1000) / 1000 : null,
      maxMs: Math.max.apply(null, frames.map(function (f) { return f.maxMs || 0; })),
      stalls: frames.reduce(function (a, f) { return a + (f.stalls || 0); }, 0),
      lowPrecision: frames.some(function (f) { return f.lowPrecision; })
    };
  }

  function saveTest(v, id, spec, log, result, extra) {
    extra = extra || {};
    var fr = frameSummary(log);
    if (fr) result.frame = fr;
    if (extra.restarts) result.restarts = extra.restarts;
    if (v.retakes && v.retakes.indexOf(id) >= 0) { result.flags = (result.flags || []).slice(); if (result.flags.indexOf('retake') < 0) result.flags.push('retake'); }
    HF.store.mutate(function (r) {
      var rec = findRec(r, v.recId);
      if (!rec) return;
      rec.tests = rec.tests || {};
      rec.tests[id] = result;
      rec.updatedAt = Date.now();
      var pausedAny = !!(log && (log.paused || (log.blocks || []).some(function (b) { return b && b.paused; }))) || !!extra.restarts;
      if (pausedAny) { rec.flags = rec.flags || []; if (rec.flags.indexOf('paused') < 0) rec.flags.push('paused'); }
      // attention checks: 2 or more failed across the visit's tests flag the visit (research/04 §19)
      var failed = 0;
      Object.keys(rec.tests).forEach(function (t) {
        var s = rec.tests[t] && rec.tests[t].sub;
        if (s && s.checks && typeof s.checks.failed === 'number') failed += s.checks.failed;
      });
      if (failed >= 2) { rec.flags = rec.flags || []; if (rec.flags.indexOf('attention') < 0) rec.flags.push('attention'); }
    });
    var trialDoc = { log: log, form: spec.form || v.form, seed: spec.seed || null, testId: id };
    if (extra.specChanged) trialDoc.spec = spec;
    try { HF.store.saveTrials(v.recId, id, trialDoc, { kind: 'lab' }); } catch (e) { if (root.console) console.error(e); }
    HF.store.flush();
    v.results[id] = result;
  }

  /* ------------------------------------------------------------ probes: shared bits */
  function countdown321(host) {
    if (HF.player && typeof HF.player.countdown === 'function') {
      try { return Promise.resolve(HF.player.countdown(host)); } catch (e) { /* fall through */ }
    }
    var n = h('div', { 'class': 'hf-lv-count', 'aria-live': 'off' }, ['3']);
    host.appendChild(n);
    return sleep(600).then(function () { n.textContent = '2'; return sleep(600); })
      .then(function () { n.textContent = '1'; return sleep(600); })
      .then(function () { if (n.parentNode) n.parentNode.removeChild(n); });
  }

  /** the pause dialog for a stopped stream; resolves 'resume' | 'stop' */
  function askAfterStreamPause() {
    return new Promise(function (resolve) {
      var adapter = { pauseText: 'This block will start again from the beginning with new shapes.', resume: function () { resolve('resume'); }, stop: function () { resolve('stop'); } };
      var d = K().pauseDialog(adapter);
      if (!d) resolve('resume');
    });
  }

  function ruleCard(host, o) {
    // o: { title, rule, keys: [[key, text]], button }
    var go = btn(o.button || 'Start', { variant: 'primary', kbd: 'Space' });
    var card = h('div', { 'class': 'hf-lv__intro hf-lv__rule' }, [
      h('h2', { 'class': 'hf-h2' }, [o.title]),
      h('p', { 'class': 'hf-lead' }, [o.rule]),
      o.note ? h('p', { 'class': 'hf-soft' }, [o.note]) : null,
      o.keys ? h('p', { 'class': 'hf-lv__keys' }, o.keys.map(function (k) { return h('span', null, [C().kbd(k[0]), ' ' + k[1]]); })) : null,
      h('div', { 'class': 'hf-actions' }, [go])
    ]);
    host.appendChild(card);
    focusEl(go);
    return waitFor(go).then(function () { if (card.parentNode) card.parentNode.removeChild(card); });
  }

  /* ---- minimal fallback views (only while HF.views.nback / HF.views.relations are missing) ---- */
  function glyphView(host, spec, ctx) {
    var k = K();
    var path = k.svg('path', { d: '', 'stroke-width': 5 });
    var box = h('div', { 'class': 'hf-lp__glyph' }, [k.svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' }, [path])]);
    var pads = C().pads({ pads: [{ id: 'match', label: 'Match', key: k.keyLabel('match', 'J') }], label: 'Answer' });
    var wrap = h('div', { 'class': 'hf-lp hf-task' }, [box, pads]);
    host.appendChild(wrap);
    var style = HF.sets && HF.sets.glyphStyle ? HF.sets.glyphStyle(spec.set || 'glyphsLab') : null;
    if (style && style.strokeWidth) path.setAttribute('stroke-width', style.strokeWidth);
    var fbTimer = null;
    return {
      pads: [pads.querySelector('[data-key]')],
      prepare: function (t) {
        var it = t.stim && t.stim.main;
        path.setAttribute('d', it && HF.sets && HF.sets.glyphPath ? (HF.sets.glyphPath(it.glyph || spec.set, it.index) || '') : '');
      },
      show: function () { box.classList.add('is-on'); },
      hide: function () { box.classList.remove('is-on'); },
      feedback: function (outcome) {
        var p = pads.querySelector('[data-key]');
        if (!p) return;
        p.setAttribute('data-fb', outcome);
        clearTimeout(fbTimer);
        fbTimer = setTimeout(function () { p.removeAttribute('data-fb'); }, 330);
      },
      destroy: function () { clearTimeout(fbTimer); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  var G8 = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  function locSym(idx) {
    var k = K(), p = G8[idx] || [1, 1];
    return k.svg('svg', { viewBox: '0 0 30 30', 'class': 'hf-lr__sym', 'aria-hidden': 'true', focusable: 'false' }, [
      k.svg('rect', { x: 1, y: 1, width: 28, height: 28, rx: 2 }),
      k.svg('circle', { cx: p[0] * 9.33 + 5.67, cy: p[1] * 9.33 + 5.67, r: 3.6 })
    ]);
  }
  function relView(host, spec, ctx) {
    var gridEl = h('div', { 'class': 'hf-lr', role: 'img', 'aria-label': 'A 3 by 3 grid; each cell holds three small squares with a dot' });
    var cells = [];
    for (var i = 0; i < 9; i++) { var c = h('div', { 'class': 'hf-lr__cell' }); cells.push(c); gridEl.appendChild(c); }
    var pads = C().pads({ pads: [{ id: 'no', label: 'No', key: K().keyLabel('no', 'F') }, { id: 'match', label: 'Yes', key: K().keyLabel('match', 'J') }], label: 'Does a row or column fit?' });
    var wrap = h('div', { 'class': 'hf-lp hf-task' }, [gridEl, pads]);
    host.appendChild(wrap);
    return {
      pads: Array.prototype.slice.call(pads.querySelectorAll('[data-key]')),
      prepare: function (t) {
        var cs = (t.stim && t.stim.cells) || [];
        for (var j = 0; j < 9; j++) {
          clear(cells[j]);
          var s3 = Array.isArray(cs[j]) ? cs[j] : String(cs[j] || '').split('');
          for (var q = 0; q < s3.length; q++) cells[j].appendChild(locSym(+s3[q]));
        }
      },
      show: function () { gridEl.classList.add('is-on'); },
      hide: function () { gridEl.classList.remove('is-on'); },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  function makeView(key, host, spec, ctx) {
    var reg = HF.views && HF.views[key];
    if (hooks.engine !== 'builtin' && reg && typeof reg.create === 'function') {
      try { return { view: reg.create(host, spec, ctx), builtin: false }; } catch (e) { if (root.console) console.error('[long-horizon] view ' + key + ' failed; using the Lab fallback', e); }
    }
    return { view: key === 'nback' ? glyphView(host, spec, ctx) : relView(host, spec, ctx), builtin: true };
  }
  function playerReady(key) {
    if (hooks.engine === 'fallback' || hooks.engine === 'builtin') return false;
    return !!(HF.player && typeof HF.player.runSpec === 'function' && HF.views && HF.views[key] && typeof HF.views[key].create === 'function');
  }
  function playerOpts(host, o, extra) {
    var out = { root: host, ruleCard: false, countdown: true, feedback: o.feedback ? 'per-response' : 'none', debrief: false, commit: false,
      allowQuit: true, lab: true, chrome: false, endLabel: 'Stop the visit' };
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /** runs one stream block; resolves { log, status: 'done'|'paused'|'quit', spec?, restarts? } */
  function runStreamBlock(v, host, bs, o) {
    var ctx = { assist: {}, feedback: o.feedback ? 'per-response' : 'none', hand: 'right', lab: true, sound: false };
    if (playerReady('nback')) {
      v.engine = v.engine || {};
      v.engine.nback = 'player';
      // CB-06: after a pause the player restarts the block itself (o.regenerate(k) → a fresh probe block) and returns
      // only the last attempt's log; its attempt count (res.attempts) gives the restarts. Until runSpec passes it on,
      // the calls of regenerate are counted (one per restart).
      var regenCalls = 0, regen = o.regenerate ? function (k) { regenCalls++; return o.regenerate(k); } : null;
      return HF.player.runSpec(bs, 'nback', playerOpts(host, o, { regenerate: regen })).then(function (res) {
        res = res || {};
        stayAwake(v);
        var log = res.log || {};
        var restarts = typeof res.attempts === 'number' && res.attempts >= 1 ? res.attempts - 1 : regenCalls;
        if (res.status === 'quit') return { log: log, status: 'quit', restarts: restarts };
        return { log: log, status: log.paused ? 'paused' : 'done', spec: res.spec && res.spec !== bs ? res.spec : null, restarts: restarts };
      });
    }
    v.engine = v.engine || {};
    v.engine.nback = 'fallback';
    var mv = makeView('nback', host, bs, ctx);
    if (mv.builtin) v.engine.nback = 'builtin';
    var view = mv.view;
    v.current = view;
    var tgt = {};
    bs.trials.forEach(function (t) { tgt[t.i] = !!(t.target && t.target.main); });
    return countdown321(host).then(function () {
      if (!alive(v)) return { log: { paused: false, aborted: true }, status: 'quit' };
      return HF.timing.runStream(bs, view, {
        keys: ['match'], leadMs: 400,
        onResponse: o.feedback && typeof view.feedback === 'function' ? function (resp, t) { view.feedback(tgt[t.i] ? 'good' : 'bad'); } : null
      });
    }).then(function (log) {
      try { if (view && typeof view.destroy === 'function') view.destroy(); } catch (e) { /* ignore */ }
      v.current = null;
      if (log.aborted) return { log: log, status: 'quit' };
      return { log: log, status: log.paused ? 'paused' : 'done' };
    });
  }

  function nbackSummary(bs, log) {
    var press = {};
    (log.responses || []).forEach(function (r) { if (r.key === 'match') press[r.trial] = true; });
    var hits = 0, targets = 0, fa = 0;
    bs.trials.forEach(function (t) {
      if (!t.scorable) return;
      var isT = !!(t.target && t.target.main);
      if (isT) { targets++; if (press[t.i]) hits++; } else if (press[t.i]) fa++;
    });
    return 'You caught ' + hits + ' of ' + targets + ' matches' + (fa ? ' and pressed ' + fa + ' time' + (fa === 1 ? '' : 's') + ' when there was no match.' : ', with no presses on non-matches.');
  }

  /** lab.nback (or its practice spec): blocks in sequence with short breaks. Resolves { log, spec, restarts, aborted } */
  async function runNbackProbe(v, host, spec, o) {
    o = o || {};
    var logs = [], restarts = 0, specChanged = false;
    for (var b = 0; b < spec.blocks.length; b++) {
      var bs = spec.blocks[b];
      var n = bs.n || (bs.params && bs.params.n) || (spec.meta && spec.meta.order && spec.meta.order[b]) || 2;
      clear(host);
      await ruleCard(host, {
        title: o.feedback ? 'Practice: ' + n + '-back' : 'Block ' + (b + 1) + ' of ' + spec.blocks.length + ': ' + n + '-back',
        rule: 'Press Match when the shape is the same as the one ' + n + ' before. Do nothing otherwise.',
        note: o.feedback ? 'The Match button flashes: a solid ring for a right press, a dashed ring for a press on a non-match.' : (b > 0 ? 'Take a breath. The block starts with a 3-2-1.' : null),
        keys: [[K().keyLabel('match', 'J'), 'or tap Match'], ['Esc', 'pause']],
        button: 'Start block'
      });
      if (!alive(v)) return { aborted: true };
      var res;
      // after a stream pause the player (or the fallback below) restarts the block with a fresh probe block:
      // same blueprint (6 targets + 4 controlled lures), derived seed
      var regen = (function (bIdx) {
        return function (k) {
          try {
            var t = HF.lab.tests['lab.nback'];
            var alt = o.feedback ? t.practice({ seed: spec.seed + '/x' + k }) : t.gen({ form: spec.form, seed: spec.seed + '/x' + k });
            var nb = alt.blocks[o.feedback ? 0 : bIdx];
            if (spec.trimmed && nb) nb.trials = nb.trials.slice(0, spec.blocks[bIdx].trials.length);
            return nb || spec.blocks[bIdx];
          } catch (e) { return spec.blocks[bIdx]; }
        };
      })(b);
      for (;;) {
        clear(host);
        res = await runStreamBlock(v, host, bs, { feedback: o.feedback, regenerate: regen });
        if (!alive(v)) return { aborted: true };
        if (res.restarts) restarts += res.restarts;   // CB-06: restarts done inside the player
        if (res.status === 'paused') {
          var choice = await askAfterStreamPause();
          if (choice === 'stop') return { aborted: true, log: { blocks: logs }, spec: spec, restarts: restarts };
          restarts++;
          var alt = regen(restarts);
          if (alt && alt !== bs) { spec.blocks[b] = alt; bs = alt; specChanged = true; }
          continue;
        }
        break;
      }
      if (res.status === 'quit') return { aborted: true, log: { blocks: logs }, spec: spec, restarts: restarts };
      if (res.spec) { spec.blocks[b] = res.spec; specChanged = true; }
      logs[b] = res.log;
      if (o.feedback) {
        clear(host);
        host.appendChild(h('p', { 'class': 'hf-lead hf-lv__count' }, [nbackSummary(bs, res.log)]));
        await sleep(400);
      }
    }
    return { log: { blocks: logs }, spec: spec, restarts: restarts, specChanged: specChanged, aborted: false };
  }

  /** lab.rel (or its practice spec): Same block, then Different block. Resolves { log, aborted } */
  async function runRelProbe(v, host, spec, o) {
    o = o || {};
    var logs = [];
    var RULE = {
      same: 'Press Yes when a row or a column has its three last squares with the dot in the SAME place. Otherwise press No.',
      different: 'Press Yes when a row or a column has its three last squares with the dot in three DIFFERENT places. Otherwise press No.'
    };
    for (var b = 0; b < spec.blocks.length; b++) {
      var bs = spec.blocks[b];
      var rule = bs.rule || (b === 0 ? 'same' : 'different');
      clear(host);
      await ruleCard(host, {
        title: (o.feedback ? 'Practice: ' : 'Rule ' + (b + 1) + ' of ' + spec.blocks.length + ': ') + (rule === 'same' ? 'Same' : 'Different'),
        rule: RULE[rule] || '',
        note: 'Only the last (right-hand) square in each cell counts. ' + (o.feedback ? 'You will see whether you were right after each grid.' : 'You have 5.5 seconds per grid.'),
        keys: [[K().keyLabel('match', 'J'), 'or tap Yes'], [K().keyLabel('no', 'F'), 'or tap No'], ['Esc', 'pause']],
        button: 'Start'
      });
      if (!alive(v)) return { aborted: true };
      clear(host);
      var log;
      var ctx = { assist: {}, feedback: o.feedback ? 'per-response' : 'none', hand: 'right', lab: true };
      if (playerReady('relations')) {
        v.engine = v.engine || {};
        v.engine.rel = 'player';
        var res = await HF.player.runSpec(bs, 'relations', playerOpts(host, o));
        res = res || {};
        if (!alive(v)) return { aborted: true };
        stayAwake(v);
        if (res.status === 'quit') return { aborted: true, log: { blocks: logs } };
        log = res.log;
      } else {
        v.engine = v.engine || {};
        v.engine.rel = 'fallback';
        var mv = makeView('relations', host, bs, ctx);
        if (mv.builtin) v.engine.rel = 'builtin';
        var fb = h('p', { 'class': 'hf-lt__msg', 'aria-live': 'polite' });
        host.appendChild(fb);
        v.current = mv.view;
        await countdown321(host);
        if (!alive(v)) return { aborted: true };
        var explainFn = HF.tasks && HF.tasks.relations && HF.tasks.relations.grid && HF.tasks.relations.grid.explain;
        log = await K().runDiscrete(bs, mv.view, {
          keys: ['match', 'no'], leadMs: 500,
          onAnswer: o.feedback ? function (ans, t) {
            var ok = ans.response === t.answer;
            var why = '';
            try { why = explainFn ? explainFn(bs, t).text : ''; } catch (e) { why = ''; }
            fb.textContent = (ans.response == null ? 'Too slow. ' : (ok ? 'Right. ' : 'Not quite. ')) + why;
            fb.setAttribute('data-tone', ok ? 'good' : 'info');
            return 1700;
          } : null
        });
        try { if (mv.view && typeof mv.view.destroy === 'function') mv.view.destroy(); } catch (e) { /* ignore */ }
        v.current = null;
        if (log.aborted) return { aborted: true, log: { blocks: logs } };
      }
      logs[b] = log;
    }
    return { log: { blocks: logs }, aborted: false };
  }

  /* ------------------------------------------------------------ custom views */
  function runView(v, host, key, spec, ctx) {
    var reg = HF.views && HF.views[key];
    if (!reg || typeof reg.create !== 'function') return Promise.reject(new Error('Lab view ' + key + ' is missing'));
    var view = reg.create(host, spec, ctx || {});
    v.current = view;
    return view.run({ timing: HF.timing, input: HF.input }).then(function (log) {
      try { view.destroy(); } catch (e) { /* ignore */ }
      v.current = null;
      return log;
    });
  }

  /* ------------------------------------------------------------ one test */
  function introScreen(v, id, idx) {
    var copy = TEST_COPY[id] || { name: testName(id), what: '', how: [], keys: [] };
    var t = HF.lab.tests[id];
    header(v, copy.name, 'Test ' + (idx + 1) + ' of ' + v.tests.length + ' · about ' + minutesOf(id) + ' minutes, practice included');
    stepList(v);
    var b = body(v);
    var hasPractice = id !== 'lab.switch';
    var go = btn(hasPractice ? 'Start practice' : 'Start', { variant: 'primary', kbd: 'Space' });
    var kids = [h('p', { 'class': 'hf-lead' }, [copy.what])];
    if (copy.how && copy.how.length) kids.push(h('ul', { 'class': 'hf-lv__how' }, copy.how.map(function (s) { return h('li', null, [s]); })));
    if (id === 'lab.matrix') {
      var rt = (t && typeof t.tutorial === 'function') ? t.tutorial().ruleTypes : null;
      if (rt && rt.length) kids.push(C().details('The three kinds of rule', h('ul', { 'class': 'hf-lv__how' }, rt.map(function (s) { return h('li', null, [s]); }))));
    }
    if (copy.keys && copy.keys.length) kids.push(h('p', { 'class': 'hf-lv__keys' }, copy.keys.concat([['Esc', 'pause']]).map(function (k) { return h('span', null, [C().kbd(k[0]), ' ' + k[1]]); })));
    kids.push(h('p', { 'class': 'hf-soft' }, [hasPractice ? 'First: ' + copy.practice + '. The same instructions and practice come at every visit.' : 'Each part starts with ' + copy.practice + '.']));
    kids.push(h('div', { 'class': 'hf-actions' }, [go]));
    b.appendChild(h('div', { 'class': 'hf-lv__intro' }, kids));
    focusHead(v);
    return waitFor(go);
  }

  function readyScreen(v, id) {
    header(v, testName(id), 'Practice done.');
    var b = body(v);
    var go = btn('Start the test', { variant: 'primary', kbd: 'Space' });
    var again = btn('Practise again', { variant: 'secondary' });
    b.appendChild(h('div', { 'class': 'hf-lv__intro' }, [
      h('p', { 'class': 'hf-lead' }, ['Now the real test. There is no feedback from here on: just do your best and keep going.']),
      h('div', { 'class': 'hf-actions' }, [again, go])
    ]));
    focusHead(v);
    focusEl(go);
    return Promise.race([waitFor(go).then(function () { return 'go'; }), new Promise(function (r) { again.addEventListener('click', function () { r('again'); }); })]);
  }

  /* e2e only: HF.ui.labvisit.testHooks.trim = n keeps n items per test (n-back: one block) so tests stay short.
     Never set by the app; a trimmed spec carries spec.trimmed and its result the flag 'trimmed'. */
  // engine (e2e only): 'auto' = HF.player.runSpec when present; 'fallback' = the internal runner with HF.views.*;
  // 'builtin' = the internal runner with the built-in minimal views
  var hooks = { trim: 0, engine: 'auto' };
  function trimSpec(id, spec) {
    var n = hooks.trim;
    if (!n || !spec) return spec;
    function fewest(list, key) {
      return list.map(function (t, i) { return { t: t, i: i, k: key(t) }; }).sort(function (a, b) { return a.k - b.k || a.i - b.i; })
        .slice(0, n).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.t; });
    }
    spec.trimmed = n;
    if (spec.kind === 'stream-set') {
      spec.blocks = spec.blocks.slice(0, 1).map(function (bs) { var c = {}; Object.keys(bs).forEach(function (k) { c[k] = bs[k]; }); c.trials = bs.trials.slice(0, (bs.leadIn || 2) + n + 2); return c; });
      if (spec.meta && spec.meta.order) spec.meta.order = spec.meta.order.slice(0, 1);
    } else if (spec.kind === 'discrete-set') {
      spec.blocks = spec.blocks.map(function (bs) { var c = {}; Object.keys(bs).forEach(function (k) { c[k] = bs[k]; }); c.trials = bs.trials.slice(0, n); return c; });
    } else if (id === 'lab.update') spec.trials = fewest(spec.trials, function (t) { return t.steps.length; });
    else if (id === 'lab.bind' || id === 'lab.sspan') spec.trials = fewest(spec.trials, function (t) { return t.setSize; });
    else if (id === 'lab.switch') {
      var per = {};
      spec.trials = spec.trials.filter(function (t) { per[t.block] = (per[t.block] || 0) + 1; return per[t.block] <= Math.max(n, 3); });
      (spec.blocks || []).forEach(function (b) { b.practice = (b.practice || []).slice(0, 2); });
    } else if (Array.isArray(spec.trials)) spec.trials = spec.trials.slice(0, n);
    return spec;
  }

  async function runPractice(v, id, host) {
    var t = HF.lab.tests[id];
    var spec = t.practice ? trimSpec(id, t.practice({})) : null;
    if (!spec) return { aborted: false };
    v.phase = 'practice'; v.spec = spec;
    if (id === 'lab.nback') return runNbackProbe(v, host, spec, { feedback: true });
    if (id === 'lab.rel') return runRelProbe(v, host, spec, { feedback: true });
    var log = await runView(v, host, id, spec, { practice: true, feedback: 'per-response', title: 'Practice' });
    return { log: log, aborted: !!log.aborted };
  }

  async function runScored(v, id, host) {
    var t = HF.lab.tests[id];
    var spec = trimSpec(id, t.gen({ form: v.form, seed: v.plan.seeds[id] }));
    v.phase = 'scored'; v.spec = spec;
    if (id === 'lab.nback') {
      var r = await runNbackProbe(v, host, spec, {});
      return { spec: r.spec || spec, log: r.log, aborted: r.aborted, restarts: r.restarts, specChanged: r.specChanged };
    }
    if (id === 'lab.rel') {
      var r2 = await runRelProbe(v, host, spec, {});
      return { spec: spec, log: r2.log, aborted: r2.aborted };
    }
    var log = await runView(v, host, id, spec, { feedback: 'none', title: testName(id) });
    return { spec: spec, log: log, aborted: !!log.aborted };
  }

  async function doTest(v, id, idx) {
    v.cur = idx;
    await introScreen(v, id, idx);
    if (!alive(v)) return 'left';
    var host = body(v);
    var stage = h('div', { 'class': 'hf-lv__stage' });
    host.appendChild(stage);
    if (id !== 'lab.switch') {
      for (;;) {
        setBare(v, true);
        clear(stage);
        var p = await runPractice(v, id, stage);
        setBare(v, false);
        if (!alive(v)) return 'left';
        if (p.aborted) return 'stopped';
        var choice = await readyScreen(v, id);
        if (!alive(v)) return 'left';
        if (choice === 'go') break;
        host = body(v); stage = h('div', { 'class': 'hf-lv__stage' }); host.appendChild(stage);
      }
      host = body(v); stage = h('div', { 'class': 'hf-lv__stage' }); host.appendChild(stage);
    }
    setBare(v, true);
    clear(stage);
    var res = await runScored(v, id, stage);
    setBare(v, false);
    if (!alive(v)) return 'left';
    if (res.aborted) return 'stopped';
    var result = HF.lab.tests[id].score(res.spec, res.log);
    if (res.spec.trimmed) { result.flags = (result.flags || []).concat(['trimmed']); }
    saveTest(v, id, res.spec, res.log, result, { restarts: res.restarts, specChanged: res.specChanged || !!res.spec.trimmed });
    return 'done';
  }

  /* ------------------------------------------------------------ between tests and parts */
  function breakScreen(v, doneId, nextId) {
    header(v, 'Saved: ' + testName(doneId), 'Take a short break if you like. Stand up, look away from the screen.');
    stepList(v);
    var b = body(v);
    var go = btn('Continue', { variant: 'primary', kbd: 'Space' });
    b.appendChild(h('div', { 'class': 'hf-lv__break' }, [
      h('p', null, ['Next: ', h('strong', null, [testName(nextId)]), ' (about ' + minutesOf(nextId) + ' minutes).']),
      h('div', { 'class': 'hf-actions' }, [go])
    ]));
    focusHead(v);
    return waitFor(go);
  }

  function partBreak(v) {
    var mins = v.tests.filter(function (id) { return HF.lab.partOf(id) === 'B'; }).reduce(function (a, id) { return a + minutesOf(id); }, 0) + 2;
    var due = v.kind === 'B1' ? 'within 3 days' : 'inside this visit’s window';
    header(v, 'Part A is done', 'Memory tests saved.');
    stepList(v);
    var b = body(v);
    var now = btn('Start Part B now', { variant: 'primary' });
    var later = btn('Do Part B later', { variant: 'secondary' });
    b.appendChild(h('div', { 'class': 'hf-lv__break' }, [
      h('p', { 'class': 'hf-lead' }, ['Part B (reasoning and control) takes about ' + mins + ' minutes. You can do it now after a break, or later ' + due + '. The Lab page will offer it.']),
      h('div', { 'class': 'hf-actions' }, [later, now])
    ]));
    focusHead(v);
    return waitAny([later, now]).then(function (i) { return i === 1 ? 'now' : 'later'; });
  }

  /* ------------------------------------------------------------ close-out */
  async function stepCloseout(v, stoppedDuring) {
    var recs = HF.store.records;
    var st = activeStudy(recs);
    var reasoning = v.didParts.indexOf('B') >= 0;
    var ans = { effort: null, help: null, helpText: '', strategies: [], strategyText: '', interrupted: null };
    header(v, 'Close-out', 'Last questions. Honest answers make your results easier to read; they never change a score.');
    stepList(v);
    var b = body(v);
    var kids = [];
    kids.push(scale('How hard did you try?', 'lv-effort', 1, 5, 'not much', 'my very best', null, function (val) { ans.effort = +val; }));
    kids.push(C().segmented({ legend: 'Did you write anything down, use notes, or get help from anyone?', name: 'lv-help',
      hint: 'Either answer is fine. A yes only marks the visit so it is read with care.',
      options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], onChange: function (val) { ans.help = val; } }));
    kids.push(C().segmented({ legend: 'Were you interrupted during the tests?', name: 'lv-int',
      options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], onChange: function (val) { ans.interrupted = val; } }));
    var STRATS = [
      ['say', 'I said items to myself'], ['group', 'I grouped items together'], ['picture', 'I made up a picture or story'],
      ['fingers', 'I counted or pointed on my fingers'], ['gut', 'I mostly went with my gut'], ['none', 'No particular strategy']
    ];
    var boxes = STRATS.map(function (s) {
      var cb = h('input', { type: 'checkbox', value: s[0] });
      cb.addEventListener('change', function () {
        var i = ans.strategies.indexOf(s[0]);
        if (cb.checked && i < 0) ans.strategies.push(s[0]);
        if (!cb.checked && i >= 0) ans.strategies.splice(i, 1);
      });
      return h('label', null, [cb, h('span', null, [s[1]])]);
    });
    kids.push(h('fieldset', { 'class': 'hf-seg hf-lv__check' }, [h('legend', { 'class': 'hf-seg__legend' }, ['Did you use a strategy? Tick any that fit.'])].concat(boxes)));
    var txt = h('textarea', { 'class': 'hf-lv__text', rows: '3', maxlength: '500', id: 'lv-strat' });
    txt.addEventListener('input', function () { ans.strategyText = txt.value.slice(0, 500); });
    kids.push(C().field({ label: reasoning ? 'Anything else about how you solved them? (optional)' : 'Anything else? (optional)', hint: 'Please do not type your name or other personal details.', control: txt }));
    var blindVals = null;
    if (st && v.kind === 'POST' && st.armKind && st.armKind !== 'lab-only') {
      var opts = HF.study.blindOptions(st.template);
      kids.push(C().segmented({ legend: HF.study.questions.blind.prompt, name: 'lv-blind',
        hint: 'Your best guess. It is used only to compare what people expected from the programmes.',
        options: opts.map(function (o) { return { value: o.id, label: o.label }; }), onChange: function (val) { blindVals = val; } }));
    }
    var go = btn('Save and finish', { variant: 'primary' });
    kids.push(h('div', { 'class': 'hf-actions' }, [go]));
    b.appendChild(h('div', { 'class': 'hf-lv__form' }, kids));
    focusHead(v);
    await waitFor(go, { keys: false });
    var flags = [];
    if (ans.help === 'yes') flags.push('help-used');
    if (ans.interrupted === 'yes') flags.push('interrupted-reported');
    if (stoppedDuring) { flags.push('stopped-early'); flags.push('paused'); }   // a stop always comes from the pause dialog
    var closeout = { effort: ans.effort, help: ans.help, interrupted: ans.interrupted, strategies: ans.strategies.slice(), strategyText: ans.strategyText || '' };
    if (stoppedDuring) closeout.stoppedDuring = stoppedDuring;
    HF.store.mutate(function (r) {
      var rec = findRec(r, v.recId);
      if (rec) {
        rec.closeout = closeout;
        rec.endedAt = Date.now();
        rec.updatedAt = rec.endedAt;
        rec.flags = rec.flags || [];
        flags.forEach(function (f) { if (rec.flags.indexOf(f) < 0) rec.flags.push(f); });
      }
      if (blindVals) {
        r.events = r.events || [];
        r.events.push({ id: uid('ev'), t: Date.now(), type: 'study-blind', guess: blindVals, visit: v.recId });
      }
    });
    HF.store.flush();
  }

  /* ------------------------------------------------------------ export at POST */
  async function stepExport(v) {
    header(v, 'Save a copy now', 'This step is needed after the Post-test.');
    stepList(v);
    var b = body(v);
    var text = '';
    // CB-01: fill the box without stamping a backup; backups.lastExportAt is stamped (HF.store.markBackup) only on Copy,
    // Download or "I have saved it", so leaving this step unsaved keeps the backup reminder
    try { text = HF.store.exportText({ stamp: false }); } catch (e) { text = ''; }
    function markBackup() { try { if (typeof HF.store.markBackup === 'function') HF.store.markBackup(); } catch (e) { /* ignore */ } }
    var fname = 'long-horizon-backup-' + (HF.util && HF.util.dayKey ? HF.util.dayKey(Date.now()) : 'today') + '.json';
    var box = C().copyBox({ label: 'Your Long-Horizon data (training and Lab)', text: text, rows: 5, download: fname, mime: 'application/json',
      hint: 'Copy it into a note or file you keep, or download it.' });
    var go = btn('I have saved it', { variant: 'primary', disabled: true });
    var saved = h('div', { 'class': 'hf-lv__check' }, [h('label', { 'for': 'lv-saved' }, [h('input', { type: 'checkbox', id: 'lv-saved' }), h('span', null, ['I saved the file somewhere safe.'])])]);
    function enable() { go.disabled = false; }
    box.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('button')) { markBackup(); enable(); } });
    go.addEventListener('click', function () { if (!go.disabled) markBackup(); });
    saved.querySelector('input').addEventListener('change', function (e) { if (e.target.checked) enable(); else go.disabled = true; });
    var kids = [
      h('p', { 'class': 'hf-lead' }, ['Your results live only in this browser. Browsers can clear that storage — for example when site data is cleared, or on some phones after weeks without use.']),
      h('p', null, ['You need this file for your Follow-up in 8–12 weeks: if this browser has lost your data by then, you can import the file and carry on. It also lets you share your results with a study, if you join one.']),
      box,
      C().notice({ tone: 'info', slim: true, text: 'In some previews, downloads and copying are blocked. If nothing happens, select the text in the box and copy it by hand.' }),
      saved
    ];
    var st = activeStudy(HF.store.records);
    if (st && ui.lab && typeof ui.lab.exportPanel === 'function') {
      var slot = h('div', { 'class': 'hf-stack' });
      kids.push(h('h2', { 'class': 'hf-h2' }, ['For your study']));
      kids.push(slot);
      ui.lab.exportPanel(slot, { study: true, compact: true });   // CB-13: the study fields (age band, hand, browser)
    }
    kids.push(h('div', { 'class': 'hf-actions' }, [go]));
    b.appendChild(h('div', { 'class': 'hf-lv__form hf-export' }, kids));
    focusHead(v);
    await waitFor(go, { keys: false });
  }

  /* ------------------------------------------------------------ done */
  function doneText(kind) {
    switch (kind) {
      case 'B1': return 'Baseline 1 is saved. The first time anyone does these tests includes some getting used to them, so Baseline 2, in 2–7 days and before your first training session, becomes your reference.';
      case 'B2': return 'Baseline 2 is saved. It is your reference: later visits are compared with it.';
      case 'Q': return 'Quick check saved. Improvement on similar untrained tasks usually shows up first. If none shows after about 10 sessions, broader effects are unlikely. Scores also rise from repeating tests.';
      case 'POST': return 'Post-test saved. Your results are on the Lab page, with what they can and cannot show.';
      case 'FU': return 'Follow-up saved. That completes the Lab programme. Thank you for measuring honestly.';
      default: return 'Extra memory check saved. It shows as extra dots on the Lab page.';
    }
  }

  function stepDone(v, stopped) {
    awake(v, false);   // CB-15: the visit is over
    header(v, stopped ? 'Visit stopped' : (KIND_NAME[v.kind] + (v.didParts.length === 1 && v.allParts.length > 1 ? ' · Part ' + v.didParts[0] : '') + ' saved'), null);
    stepList(v);
    var b = body(v);
    var kids = [];
    if (stopped) kids.push(C().notice({ tone: 'info', title: 'What was finished is saved', text: 'The Lab page offers the rest of this visit. The test you stopped will start again from its practice.' }));
    else kids.push(h('p', { 'class': 'hf-lead' }, [doneText(v.kind)]));
    var ids = Object.keys(v.results);
    if (ids.length) {
      kids.push(h('h2', { 'class': 'hf-h2' }, ['This sitting']));
      kids.push(C().list(ids.map(function (id) {
        var r = v.results[id];
        var fl = (r.flags || []).filter(function (f) { return f !== 'exploratory'; });
        return { title: testName(id), sub: r.scoreLabel || '', meta: fl.length ? 'marked: ' + fl.join(', ') : null, chevron: false };
      }), { label: 'Scores from this sitting' }));
      kids.push(h('p', { 'class': 'hf-small hf-muted' }, ['Scores are in each test’s own units. The Lab page shows them across visits; one visit alone says little.']));
    }
    var left = planVisit({ kind: v.kind, config: v.config });
    if (!stopped && left.tests.length && v.kind !== 'X') {
      var partsLeft = {};
      left.tests.forEach(function (id) { partsLeft[HF.lab.partOf(id)] = true; });
      kids.push(C().notice({ tone: 'info', title: 'Still to do for ' + KIND_NAME[v.kind], text: (partsLeft.B && !partsLeft.A ? 'Part B (reasoning and control)' : 'The remaining tests') + ' — the Lab page will offer ' + (left.tests.length === 1 ? 'it' : 'them') + (v.kind === 'B1' ? '. Try to finish within 3 days.' : ' while the window is open.') }));
    }
    var st = activeStudy(HF.store.records);
    if (!stopped && v.kind === 'B2' && st && !st.arm && !left.tests.length) {
      kids.push(C().notice({ tone: 'info', title: 'Next: your study programme', text: 'Baseline 2 is complete, so you can draw your programme now.', action: btn('Open Study mode', { variant: 'secondary', go: 'study' }) }));
    }
    kids.push(h('div', { 'class': 'hf-actions' }, [btn('Back to the Lab', { variant: 'primary', go: 'lab' })]));
    b.appendChild(h('div', { 'class': 'hf-lv__form' }, kids));
    focusHead(v);
  }

  function nothingToDo(v) {
    header(v, KIND_NAME[v.kind], null);
    var b = body(v);
    b.appendChild(h('div', { 'class': 'hf-lv__form' }, [
      C().notice({ tone: 'good', title: 'Nothing left to do here', text: v.plan.missing.length ? 'Some tests of this visit are not available in this version: ' + v.plan.missing.join(', ') + '.' : 'Every test of this visit is already saved.' }),
      h('div', { 'class': 'hf-actions' }, [btn('Back to the Lab', { variant: 'primary', go: 'lab' })])
    ]));
    focusHead(v);
  }

  /* ------------------------------------------------------------ the flow */
  async function flow(v) {
    try {
      if (!v.tests.length) { nothingToDo(v); return; }
      await stepDevice(v);
      if (!alive(v)) return;
      await stepCheckin(v);
      if (!alive(v)) return;
      createRecord(v);
      var stopped = null;
      for (var i = 0; i < v.tests.length; i++) {
        var id = v.tests[i];
        var part = HF.lab.partOf(id);
        if (part === 'B' && v.didParts.indexOf('A') >= 0 && v.didParts.indexOf('B') < 0 && v.tests.some(function (x) { return HF.lab.partOf(x) === 'A'; })) {
          var choice = await partBreak(v);
          if (!alive(v)) return;
          if (choice === 'later') { v.tests = v.tests.slice(0, i); break; }
        } else if (i > 0) {
          await breakScreen(v, v.tests[i - 1], id);
          if (!alive(v)) return;
        }
        if (v.didParts.indexOf(part) < 0) v.didParts.push(part);
        var out = await doTest(v, id, i);
        if (out === 'left' || !alive(v)) return;
        if (out === 'stopped') { stopped = id; break; }
      }
      v.cur = -1;
      if (!Object.keys(v.results).length && stopped) {
        // nothing finished: close the empty record quietly (the schedule ignores records without results)
        HF.store.mutate(function (r) {
          var rec = findRec(r, v.recId);
          if (rec) { rec.endedAt = Date.now(); rec.updatedAt = rec.endedAt; rec.closeout = { stoppedDuring: stopped }; rec.flags = (rec.flags || []).concat(['stopped-early', 'paused']); }
        });
        HF.store.flush();
        stepDone(v, true);
        return;
      }
      await stepCloseout(v, stopped);
      if (!alive(v)) return;
      if (v.kind === 'POST' && !stopped) {
        await stepExport(v);
        if (!alive(v)) return;
      }
      stepDone(v, !!stopped);
    } catch (e) {
      if (root.console) console.error('[long-horizon] Lab visit', e);
      if (!alive(v)) return;
      awake(v, false);
      setBare(v, false);
      var b = body(v);
      b.appendChild(C().notice({ tone: 'warn', title: 'Something went wrong', text: 'Tests you finished are saved. Please go back to the Lab and start the visit again. (' + (e && e.message ? e.message : e) + ')',
        action: btn('Back to the Lab', { variant: 'secondary', go: 'lab' }) }));
    }
  }

  function render(rootEl, params) {
    params = params || {};
    if (V) leave();
    var plan = planVisit(params);
    var parts = [];
    plan.tests.forEach(function (id) { var p = HF.lab.partOf(id); if (parts.indexOf(p) < 0) parts.push(p); });
    var allParts = [];
    plan.all.forEach(function (id) { var p = HF.lab.partOf(id); if (allParts.indexOf(p) < 0) allParts.push(p); });
    var mins = plan.tests.reduce(function (a, id) { return a + minutesOf(id); }, 0) + 2;
    var v = {
      params: params, plan: plan, kind: plan.kind, config: plan.config, form: plan.form, tests: plan.tests.slice(),
      partsInSitting: parts, allParts: allParts, didParts: [], results: {}, cur: -1, offs: [], left: false, minutes: mins,
      partLabel: parts.length === 1 && allParts.length > 1 ? PART_NAME[parts[0]] : ''
    };
    v.head = h('header', { 'class': 'hf-page__head' });
    v.steps = h('ol', { 'class': 'hf-lv__steps', 'aria-label': 'Tests in this sitting' });
    v.body = h('div', { 'class': 'hf-lv__body' });
    v.el = h('div', { 'class': 'hf-lv' }, [v.head, v.steps, v.body]);
    rootEl.appendChild(v.el);
    V = v;
    stepList(v);
    flow(v);
  }

  function leave() {
    var v = V;
    V = null;
    if (!v) return;
    v.left = true;
    v.offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    try { if (v.current && typeof v.current.destroy === 'function') v.current.destroy(); } catch (e) { /* ignore */ }
    try { if (HF.player && HF.player.active && typeof HF.player.abort === 'function') HF.player.abort('leave'); } catch (e1) { /* ignore */ }
    try { if (HF.timing && HF.timing.active) HF.timing.abort('leave'); } catch (e2) { /* ignore */ }
    try { if (HF.dom && HF.dom.openModals && HF.dom.openModals() > 0) { var t = HF.dom.topModal(); if (t && t.dialog && /lab-pause/.test(t.dialog.className)) t.close('stop'); } } catch (e3) { /* ignore */ }
    if (v.awake) awake(v, false);   // CB-15
    chrome(true);
  }

  /** Lab trial logs for HF.lab.exportBundle: { [visitId]: { [testId]: { log, spec? } } } */
  function labLogs(records) {
    var out = {};
    ((records && records.labVisits) || []).forEach(function (v) {
      if (!v || !v.id) return;
      var doc2 = null;
      try { doc2 = HF.store.loadTrials(v.id); } catch (e) { doc2 = null; }
      if (!doc2 || !doc2.blocks) return;
      Object.keys(doc2.blocks).forEach(function (tid) {
        var entry = doc2.blocks[tid];
        if (!entry) return;
        var log = entry.log !== undefined ? entry.log : entry;
        (out[v.id] = out[v.id] || {})[tid] = entry.spec ? { log: log, spec: entry.spec } : { log: log };
      });
    });
    return out;
  }

  var screen = {
    title: function (p) { return (p && KIND_NAME[p.kind]) || 'Lab visit'; },
    render: render,
    leave: leave
  };
  ui.labvisit = { TEST_COPY: TEST_COPY, KIND_NAME: KIND_NAME, labLogs: labLogs, detectDevice: detectDevice, planVisit: planVisit,
    runNbackProbe: runNbackProbe, runRelProbe: runRelProbe, current: function () { return V; }, testHooks: hooks };
  if (HF.router && typeof HF.router.register === 'function') HF.router.register('labvisit', screen);
  ui.screens = ui.screens || {};
  ui.screens.labvisit = screen;
})(typeof window !== 'undefined' ? window : globalThis);
