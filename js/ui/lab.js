/* Long-Horizon — Lab home (route 'lab'). Browser only, ES2019, MIT. Owner: P2 (Lab UI). Notes: docs/dev/lab-ui-notes.md.
   Shows, in plain words: what the Lab is and can / cannot show (no IQ claims; one person's change cannot show cause);
   the next visit with its time cost and window (HF.lab.schedule); the visit plan B1 → B2 → Quick check → Post →
   Follow-up with one-line explanations; results per test across visits as dot plots (HF.ui.c.dotPlot) grouped as
   near / mid / far for this user (HF.lab.levels, incl. "closer to …" notes) with the verdict from HF.lab.compare
   (above / inside / below the noise band, "not yet calibrated" + the typical retest gain, or "no baseline"), always
   with the retest caveat; data-quality notes per visit; the configuration choice with minutes up front
   (settings.labConfig via HF.store.mutate); Study mode entry; calibration import (file picker + paste →
   records.calibration; "Remove" writes the tombstone { updatedAt, removed: true, tests: {} }, read as "no calibration",
   so the removal wins merges with other tabs and older backups — CB-07); Lab data export. No rewards, badges, rings or
   celebrations anywhere in the Lab.

   Also exports HF.ui.lab = {
     exportPanel(root, { study?: bool, compact?: bool }) → renders the HF.lab.exportBundle UI (JSON + 4 CSV tables as a
       copy box + download; optional age band / handedness / browser details for studies),
     parseCalibration(text) → { ok, calibration?, error?, used: [ids], low: [ids] },
     verdictText(row, testId), FLAG_TEXT, KIND_NAME, testName(id) }
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  var ui = HF.ui || (HF.ui = {});

  var KIND_NAME = { B1: 'Baseline 1', B2: 'Baseline 2', Q: 'Quick check', POST: 'Post-test', FU: 'Follow-up', X: 'Extra memory check' };
  var KIND_WHAT = {
    B1: 'Your first measurement, before any training.',
    B2: 'The same tests again, 2–7 days later and still before training. Scores usually rise the second time from practice alone, so Baseline 2 is your reference.',
    Q: 'The two memory probes after session 10, about 12 minutes.',
    POST: 'The full visit again, 1–3 days after your last programme session.',
    FU: '8–12 weeks after the Post-test, to see what lasts.'
  };
  var CONFIG_TEXT = {
    standard: { label: 'Standard', what: 'memory and reasoning, in two sittings' },
    minimum: { label: 'Minimum', what: 'the five most important tests' },
    quick: { label: 'Quick', what: 'the two memory probes only' },
    extended: { label: 'Extended', what: 'Standard plus a colour-and-place test (for studies)' }
  };
  var LEVEL_TEXT = {
    near: { title: 'Near', what: 'The same kind of task as your training, with material you never trained on.' },
    mid: { title: 'Mid', what: 'Other working-memory tasks you did not train.' },
    far: { title: 'Far', what: 'Reasoning tasks unlike anything you trained.' }
  };
  var FLAG_TEXT = {
    'device-class': 'a different kind of device than your first visit', 'device-input': 'a different way of answering',
    'time-of-day': 'more than 3 hours from your first visit’s time of day', 'after-training': 'taken after training on the same day',
    'outside-window': 'outside its time window', 'help-used': 'notes or help were used', paused: 'paused during a test',
    'stopped-early': 'stopped early', attention: 'two or more very easy check items were not answered correctly',
    'interrupted-reported': 'interruptions reported', 'short-sleep': 'short sleep (5 hours or less)',
    interrupted: 'interrupted (paused, or many items did not count)', 'too-fast': 'some answers were very fast',
    'check-failed': 'an easy check item was not answered correctly', 'proc-floor': 'pattern judgements under 80 % right',
    'many-voided': 'many items did not count (display hiccups)', incomplete: 'not all items were done',
    'low-accuracy': 'low accuracy', 'many-timeouts': 'many answers too slow', anticipations: 'many answers before the digit could be read',
    'insufficient-data': 'too few usable trials for a score', retake: 'taken again after a stop'
  };
  var UNIT = {
    'lab.nback': 'dprime', 'lab.rel': 'hmf', 'lab.switch': 'ms',
    'lab.sspan': 'prop', 'lab.update': 'prop', 'lab.bind': 'prop', 'lab.matrix': 'prop', 'lab.series': 'prop', 'lab.graph': 'prop'
  };
  var UNIT_TEXT = {
    prop: 'Proportion right',
    dprime: 'd′: how well matches are told apart from non-matches (higher is better)',
    hmf: 'Hits minus false presses (higher is better)',
    ms: 'Switch cost in milliseconds (lower is better; exploratory)'
  };

  function C() { return ui.c; }
  function h(tag, attrs, kids) { return C().h(tag, attrs, kids); }
  function btn(label, o) { return C().button(label, o || {}); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function dateText(ms) {
    if (!isNum(ms)) return '';
    try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1); }
  }
  function uid(p) { return HF.util && HF.util.id ? HF.util.id(p) : p + '-' + Date.now().toString(36); }
  function testName(id) {
    var c = ui.labvisit && ui.labvisit.TEST_COPY && ui.labvisit.TEST_COPY[id];
    return (c && c.name) || (HF.lab.tests[id] && HF.lab.tests[id].label) || id;
  }

  /* ------------------------------------------------------------ verdicts */
  // SC-08 (wording from the analysis fixer): the band is measurement noise only (±1.96 Sdiff around Baseline 2); the
  // usual retest gain is NOT subtracted. HF.lab.compare gives rciPractice only when the calibration's practice estimate
  // comes from at least 30 people who did not train (practiceN ≥ HF.lab.PRACTICE_MIN_N).
  function verdictText(row, id) {
    if (!row) return '';
    var hib = row.higherIsBetter !== false;
    var adj = '';
    if (isNum(row.rciPractice)) adj = ' After subtracting the average retest gain of at least 30 people who did not train: ' + (row.rciPractice > 1.96 ? (row.verdict === 'above' ? 'still above.' : 'above.') : row.rciPractice < -1.96 ? 'below.' : 'inside.');
    switch (row.verdict) {
      case 'above': return (hib ? 'Above the noise band: a larger rise than measurement noise alone explains; the usual retest gain is not subtracted.' : 'Above the noise band: a larger cost than at Baseline 2, beyond measurement noise (lower is better here).') + adj;
      case 'below': return (hib ? 'Below the noise band: a larger drop than measurement noise alone explains.' : 'Below the noise band: a smaller cost than at Baseline 2, beyond measurement noise (lower is better here).') + adj;
      case 'inside': return 'Inside the noise band: not distinguishable from normal variation.' + adj;
      case 'uncalibrated': return row.latest != null ? 'Not yet calibrated: no change verdict yet.' : 'Not yet calibrated.';
      case 'no-baseline': return 'No Baseline 2, so no change verdict: scores only.';
      default: return 'Band ready; no visit after Baseline 2 yet.';
    }
  }

  /* ------------------------------------------------------------ calibration */
  function parseCalibration(text) {
    var data;
    try { data = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { ok: false, error: 'This is not a calibration file (it is not valid JSON).' }; }
    if (!data || typeof data !== 'object' || !data.tests || typeof data.tests !== 'object') return { ok: false, error: 'This file has no "tests" section, so it is not a Long-Horizon calibration file.' };
    var tests = {}, used = [], low = [];
    Object.keys(data.tests).forEach(function (id) {
      var t = data.tests[id];
      if (!/^lab\./.test(id) || !t || typeof t !== 'object') return;
      if (!isNum(t.r) || !isNum(t.sd) || !isNum(t.n)) return;
      var o = { r: t.r, sd: t.sd, mean: isNum(t.mean) ? t.mean : null, n: t.n };
      if (isNum(t.practice)) o.practice = t.practice;
      if (isNum(t.practiceN)) o.practiceN = t.practiceN;   // compare.js uses practice only when practiceN ≥ 30 (SC-08)
      if (isNum(t.gain)) o.gain = t.gain;
      if (t.provisional) o.provisional = true;
      tests[id] = o;
      if (t.n >= (HF.lab.CALIBRATION_MIN_N || 50) && t.r >= 0 && t.r < 1 && t.sd > 0) used.push(id); else low.push(id);
    });
    if (!Object.keys(tests).length) return { ok: false, error: 'No usable test entries (each needs r, sd and n).' };
    var cal = {
      updatedAt: Date.now(),
      version: typeof data.version === 'string' ? data.version.slice(0, 80) : 'imported',
      source: typeof data.source === 'string' ? data.source.slice(0, 300) : 'imported file',
      tests: tests
    };
    if (data.meta && isNum(data.meta.participants)) cal.participants = data.meta.participants;
    return { ok: true, calibration: cal, used: used, low: low };
  }

  /* ------------------------------------------------------------ export panel */
  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      try {
        var r = new root.FileReader();
        r.onload = function () { resolve(String(r.result || '')); };
        r.onerror = function () { reject(r.error || new Error('read failed')); };
        r.readAsText(file);
      } catch (e) { reject(e); }
    });
  }

  function exportPanel(host, opts) {
    opts = opts || {};
    clear(host);
    var state = { format: 'json', ageBand: '', handedness: '', includeUA: false, bundle: null };
    var out = h('div', { 'class': 'hf-export' });
    var prep = btn(opts.compact ? 'Prepare the study export' : 'Prepare the export', { variant: 'secondary', icon: 'download' });
    var extra = [];
    if (opts.study) {
      extra.push(C().select({ label: 'Age band (optional)', value: '', options: [{ value: '', label: 'Prefer not to say' }, { value: '18-24', label: '18–24' }, { value: '25-34', label: '25–34' },
        { value: '35-44', label: '35–44' }, { value: '45-54', label: '45–54' }, { value: '55-64', label: '55–64' }, { value: '65+', label: '65 or over' }],
        onChange: function (v) { state.ageBand = v; state.bundle = null; } }));
      extra.push(C().select({ label: 'Writing hand (optional)', value: '', options: [{ value: '', label: 'Prefer not to say' }, { value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }, { value: 'both', label: 'Both' }],
        onChange: function (v) { state.handedness = v; state.bundle = null; } }));
      extra.push(C().toggle({ label: 'Include browser details', hint: 'The browser’s name and version help spot device effects. Off by default.', checked: false,
        onChange: function (on) { state.includeUA = on; state.bundle = null; } }));
    }
    function build() {
      var recs = HF.store.records;
      var labLogs = ui.labvisit && ui.labvisit.labLogs ? ui.labvisit.labLogs(recs) : {};
      var scr = root.screen ? { w: root.screen.width, h: root.screen.height, dpr: root.devicePixelRatio || 1 } : null;
      return HF.lab.exportBundle(recs, {
        labLogs: labLogs, appVersion: HF.VERSION || null, ageBand: state.ageBand || null, handedness: state.handedness || null,
        includeUA: state.includeUA, userAgent: root.navigator ? root.navigator.userAgent : null, screen: scr,
        audio: HF.audio && HF.audio.state ? HF.audio.state() !== 'unavailable' : null
      });
    }
    function show() {
      clear(out);
      var b = state.bundle;
      if (!b) return;
      var base = b.filename.replace(/\.json$/, '');
      var F = {
        json: { text: JSON.stringify(b.json, null, 1), name: b.filename, mime: 'application/json', label: 'Everything (JSON)' },
        visits: { text: b.csv.visits, name: base + '-visits.csv', mime: 'text/csv', label: 'Lab visits (CSV)' },
        trials: { text: b.csv.trials, name: base + '-lab-trials.csv', mime: 'text/csv', label: 'Lab trials (CSV)' },
        blocks: { text: b.csv.blocks, name: base + '-training-blocks.csv', mime: 'text/csv', label: 'Training blocks (CSV)' },
        sessions: { text: b.csv.sessions, name: base + '-sessions.csv', mime: 'text/csv', label: 'Training sessions (CSV)' }
      };
      var seg = C().segmented({ legend: 'Format', name: 'hf-exp-fmt-' + uid('x'), value: state.format,
        options: Object.keys(F).map(function (k) { return { value: k, label: F[k].label }; }),
        onChange: function (v) { state.format = v; show(); } });
      var f = F[state.format] || F.json;
      out.appendChild(seg);
      out.appendChild(C().copyBox({ label: f.label, text: f.text, rows: 6, download: f.name, mime: f.mime,
        hint: 'The JSON holds everything; the CSV tables are the same data for spreadsheets. ' + (b.json.notes && b.json.notes.length ? 'Notes: ' + b.json.notes.slice(0, 3).join('; ') + '.' : '') }));
      if (b.json.study && b.json.study.commitment) {
        out.appendChild(C().notice({ tone: 'info', slim: true, text: b.json.study.saltRevealed ? 'The export reveals your draw’s secret (salt), so anyone can check that your posted commitment code matches your programme.' : 'The secret behind your commitment code stays hidden until the Post-test.' }));
      }
    }
    prep.addEventListener('click', function () {
      try { state.bundle = build(); } catch (e) {
        if (root.console) console.error(e);
        clear(out); out.appendChild(C().notice({ tone: 'warn', title: 'Export failed', text: String(e && e.message || e) }));
        return;
      }
      show();
    });
    host.appendChild(h('div', { 'class': 'hf-stack' }, [
      h('p', { 'class': 'hf-soft hf-small' }, ['The file holds no names or e-mail addresses: a random ID, your scores, the dates and times of visits and sessions, your check-in answers and anything you typed in a close-out. Share it only if you want to.'])
    ].concat(extra).concat([h('div', { 'class': 'hf-actions' }, [prep]), out])));
    return { el: host, build: build };
  }

  /* ------------------------------------------------------------ sections */
  var S = { root: null, offs: [] };

  function statusChip(status) {
    var map = { done: 'Done', partial: 'Part done', due: 'Due now', overdue: 'Window passed', upcoming: 'Coming up', waiting: 'Later', missed: 'Left out', skipped: 'Not on your path' };
    return h('span', { 'class': 'hf-lab-status hf-lab-status--' + status }, [status === 'done' ? C().icon('check') : null, map[status] || status]);
  }
  function whenText(e, sched) {
    var w = e.waitingFor || {};
    switch (e.status) {
      case 'done': return 'Done ' + dateText(e.doneAt);
      case 'due': return e.dueTo ? 'Open until ' + dateText(e.dueTo) : (e.beforeSession ? 'Before session ' + e.beforeSession : 'Open now');
      case 'overdue': return 'The window closed ' + dateText(e.dueTo) + '; you can still take it (it will be marked)';
      case 'upcoming': return 'From ' + dateText(e.dueFrom) + ' to ' + dateText(e.dueTo);
      case 'waiting':
        if (w.visit) return 'After ' + KIND_NAME[w.visit];
        if (isNum(w.sessions)) return 'After ' + (sched.programme.unit === 'day' ? 'day ' : 'session ') + w.sessions + ' (' + (w.done || 0) + ' done so far)';
        return 'Later';
      case 'missed': return 'Training started before it, so it is left out';
      case 'partial': return 'Partly done; it can no longer be finished';
      case 'skipped': return 'Not on your path: you started training before Baseline 1';
      default: return '';
    }
  }

  function nextCard(sched, recs) {
    var next = sched.next;
    var cfg = (recs.settings && recs.settings.labConfig) || 'standard';
    if (!next) {
      return C().card({ tone: 'feature', title: 'All visits done', sub: 'Thank you for measuring honestly.',
        body: [h('p', null, ['You can still run an extra memory check at any time; it shows as extra dots below.'])],
        actions: [btn('Start an extra memory check', { variant: 'primary', go: 'labvisit', attrs: { 'data-params': JSON.stringify({ kind: 'X' }) } })] });
    }
    var kind = next.kind, name = KIND_NAME[kind];
    var tests = next.tests || [];
    var mA = 0, mB = 0;
    tests.forEach(function (id) { if (HF.lab.partOf(id) === 'A') mA += HF.lab.minutesOf(id); else mB += HF.lab.minutesOf(id); });
    var parts = [];
    if (mA) parts.push('Part A, memory: about ' + (mA + 1) + ' min');
    if (mB) parts.push('Part B, reasoning and control: about ' + (mB + 2) + ' min');
    var total = (mA ? mA + 1 : 0) + (mB ? mB + 2 : 0);
    var sub = next.part ? 'Continue with ' + (next.part === 'B' ? 'Part B · reasoning and control' : 'Part A · memory') : (KIND_WHAT[kind] || '');
    var body = [];
    body.push(h('p', { 'class': 'hf-lab-card__time' }, ['About ' + total + ' minutes' + (parts.length > 1 ? ' in two sittings: ' + parts.join('; ') + '.' : (parts.length ? ' (' + parts[0].replace(/^Part [AB], /, '') + ').' : '.'))]));
    var w = whenText(next, sched);
    if (w) body.push(h('p', { 'class': 'hf-soft' }, [w + '.']));
    if (parts.length > 1 && !next.part) body.push(h('p', { 'class': 'hf-small' }, ['Part A comes first. You can stop after it and do Part B later' + (kind === 'B1' ? ', within 3 days.' : ' while the window is open.')]));
    var actions = [];
    var params = { kind: kind, config: next.config };
    if (next.part) params.part = next.part;
    var startLabel = next.part ? 'Start Part ' + next.part : 'Start ' + name;
    if (next.status === 'due' || next.status === 'overdue') {
      if (next.notToday) body.push(h('p', { 'class': 'hf-small' }, ['You trained today. Lab visits belong before training on a training day; if you can, come back on a day before you train.']));
      actions.push(btn(startLabel, { variant: next.notToday ? 'secondary' : 'primary', go: 'labvisit', attrs: { 'data-params': JSON.stringify(params) } }));
    } else if (next.status === 'upcoming') {
      actions.push(btn('Start early (it will be marked)', { variant: 'quiet', go: 'labvisit', attrs: { 'data-params': JSON.stringify(params) } }));
    } else if (next.status === 'waiting') {
      actions.push(btn('Extra memory check', { variant: 'secondary', go: 'labvisit', attrs: { 'data-params': JSON.stringify({ kind: 'X' }) } }));
    }
    var card = C().card({ tone: 'feature', title: 'Next: ' + name, sub: sub, body: body, actions: actions.length ? actions : null });
    card.setAttribute('data-next-kind', kind);
    return card;
  }

  function scheduleList(sched) {
    var items = (sched.plan || []).map(function (e) {
      var isNext = sched.next && sched.next.kind === e.kind;
      return h('li', { 'class': (isNext ? 'is-next ' : '') + (e.status === 'done' ? 'is-done' : ''), 'data-kind': e.kind }, [
        h('span', { 'class': 'hf-lab-sched__kind', 'aria-hidden': 'true' }, [e.kind === 'POST' ? 'P' : e.kind]),
        h('div', { 'class': 'hf-lab-sched__head' }, [h('span', { 'class': 'hf-lab-sched__name' }, [KIND_NAME[e.kind]]), statusChip(e.status), h('span', { 'class': 'hf-lab-sched__when' }, [whenText(e, sched)])]),
        h('p', { 'class': 'hf-lab-sched__what' }, [KIND_WHAT[e.kind] || ''])
      ]);
    });
    return h('ol', { 'class': 'hf-lab-sched', 'aria-label': 'Your Lab visits' }, items);
  }

  function axisFor(unit, values) {
    var lo, hi, fmt;
    if (unit === 'prop') { lo = 0; hi = 1; fmt = function (x) { return C().fmt.pct(x); }; }
    else if (unit === 'dprime') {
      lo = Math.min(0, Math.floor(Math.min.apply(null, values.concat([0])) - 0.25)); hi = Math.max(4, Math.ceil(Math.max.apply(null, values.concat([0])) + 0.25));
      fmt = function (x) { return C().fmt.num(x, 1); };
    } else if (unit === 'hmf') {
      lo = Math.min(0, Math.floor((Math.min.apply(null, values.concat([0])) - 0.05) * 10) / 10); hi = 1;
      fmt = function (x) { return C().fmt.num(x, 1); };
    } else {
      lo = Math.min(0, Math.floor(Math.min.apply(null, values.concat([0])) / 50) * 50); hi = Math.max(200, Math.ceil(Math.max.apply(null, values.concat([0])) / 50) * 50);
      fmt = function (x) { return Math.round(x) + ' ms'; };
    }
    return { min: lo, max: hi, format: fmt };
  }

  function resultsSection(recs, sched) {
    var vs = HF.lab.visitScores(recs);
    var cmp = HF.lab.compare(recs);
    var lv = HF.lab.levels(recs);
    var hasX = vs.some(function (v) { return v.kind === 'X'; });
    var kinds = [
      { id: 'B1', label: 'Baseline 1', shape: 'circle', tone: 'muted' },
      { id: 'B2', label: 'Baseline 2', shape: 'square', tone: 'muted' },
      { id: 'Q', label: hasX ? 'Quick or extra check' : 'Quick check', shape: 'down', tone: 's3' },
      { id: 'POST', label: 'Post-test', shape: 'diamond', tone: 's1' },
      { id: 'FU', label: 'Follow-up', shape: 'triangle', tone: 's2' }
    ];
    var ids = [];
    vs.forEach(function (v) { Object.keys(v.scores).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    var order = HF.lab.IDS || [];
    ids.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var sec = h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-res-h' }, [
      h('div', { 'class': 'hf-section__head' }, [h('h2', { 'class': 'hf-h2', id: 'lab-res-h' }, ['Your results'])])
    ]);
    if (!ids.length) {
      sec.appendChild(C().empty({ art: 'lab', title: 'No results yet', text: 'After your first visit, each test shows one dot per visit here, grouped as near, mid and far.' }));
      return sec;
    }
    var anyUncal = false;
    ['near', 'mid', 'far'].forEach(function (level) {
      var inLevel = ids.filter(function (id) { return (lv[id] && lv[id].level) === level; });
      if (!inLevel.length) return;
      var box = h('div', { 'class': 'hf-lab-level', 'data-level': level }, [
        h('div', { 'class': 'hf-lab-level__head' }, [h('h3', { 'class': 'hf-h3' }, [LEVEL_TEXT[level].title]), h('span', { 'class': 'hf-soft hf-small' }, [LEVEL_TEXT[level].what])])
      ]);
      var groups = {};
      inLevel.forEach(function (id) { var u = UNIT[id] || 'prop'; (groups[u] = groups[u] || []).push(id); });
      Object.keys(groups).forEach(function (u) {
        var gIds = groups[u], values = [];
        var rows = gIds.map(function (id) {
          var row = cmp[id] || {};
          if (row.verdict === 'uncalibrated') anyUncal = true;
          var pts = [];
          vs.forEach(function (v) { if (isNum(v.scores[id])) { pts.push({ value: v.scores[id], kind: v.kind === 'X' ? 'Q' : v.kind }); values.push(v.scores[id]); } });
          var band = null;
          if (isNum(row.band) && isNum(row.b2)) { band = { lo: row.b2 - row.band, hi: row.b2 + row.band }; values.push(band.lo, band.hi); }
          var note = verdictText(row, id);
          if (lv[id] && lv[id].closer) note = 'Closer to ' + lv[id].closer + '. ' + note;
          return { label: testName(id), note: note, band: band, points: pts };
        });
        var ax = axisFor(u, values);
        box.appendChild(C().dotPlot({ title: UNIT_TEXT[u], rows: rows, kinds: kinds, min: ax.min, max: ax.max, format: ax.format, bandLabel: 'Noise band', rowLabel: 'Test',
          summary: UNIT_TEXT[u] + ': ' + rows.map(function (r) { return r.label + ', ' + r.points.length + ' visits, ' + r.note; }).join(' ') }));
      });
      box.appendChild(h('ul', { 'class': 'hf-lab-notes' }, inLevel.map(function (id) {
        return h('li', null, [h('strong', null, [testName(id) + ': ']), (lv[id] && lv[id].note) || '']);
      })));
      sec.appendChild(box);
    });
    sec.appendChild(h('p', { 'class': 'hf-lab-caveat', 'data-caveat': 'retest' }, ['Scores also rise with repeated testing: people who do not train typically improve somewhat too. One person’s results cannot show what caused a change; practice, sleep, mood, device and expectations all matter. Most controlled studies find no effect of memory training on reasoning tests.']));
    if (anyUncal) {
      sec.appendChild(C().notice({ tone: 'info', title: 'Not yet calibrated', text: 'The community has not yet pooled enough Baseline 1 and 2 results (at least 50 people per test) to say how much a score moves by chance, so there is no noise band and no verdict yet. Until then, read changes with care: in published studies, memory-test scores rise by about a quarter of a standard deviation from the first to the second time, and keep rising a little until about the fourth time, even with new items (Scharfen, Jansen & Holling, 2018). Your Post-test is your third time or later.' }));
    }
    if (sched.path === 'no-baseline') {
      sec.appendChild(C().notice({ tone: 'info', title: 'No baseline', text: 'You started training before Baseline 1, so the Lab shows your scores without a change verdict. Post-test and Follow-up are still offered after your programme.' }));
    }
    // composites (only with calibration)
    var comp = HF.lab.composites(recs).filter(function (c) { return isNum(c.near) || isNum(c.mid) || isNum(c.far); });
    var how = [h('p', null, ['Each dot is one visit. The grey band, once calibrated, shows how far a score usually moves between two visits without any real change: 1.96 times the standard error of the difference, from the retest reliability and spread of at least 50 people (the reliable change index of Jacobson & Truax, 1991). Above or below the band means a larger change than measurement noise alone explains; the usual gain from retaking the tests is not subtracted, so it is not proof that training caused the change.']),
      h('p', null, ['Near, mid and far follow your own training log: a test is near when you trained the same kind of task with other material.'])];
    if (comp.length) {
      how.push(C().table({ caption: 'Composite scores (mean standard score per level)', columns: [
        { key: 'kind', label: 'Visit' }, { key: 'near', label: 'Near', num: true }, { key: 'mid', label: 'Mid', num: true }, { key: 'far', label: 'Far', num: true }],
        rows: comp.map(function (c) { return { kind: KIND_NAME[c.kind] || c.kind, near: isNum(c.near) ? c.near.toFixed(2) : '–', mid: isNum(c.mid) ? c.mid.toFixed(2) : '–', far: isNum(c.far) ? c.far.toFixed(2) : '–' }; }) }));
    }
    sec.appendChild(C().details('How to read these results', how));
    // data-quality notes
    var notes = [];
    (sched.visits || []).forEach(function (v) {
      var raw = null;
      (recs.labVisits || []).forEach(function (r) { if (r.id === v.id) raw = r; });
      var fl = (v.flags || []).slice();
      if (raw && raw.checkin && isNum(raw.checkin.sleepHours) && raw.checkin.sleepHours <= 5) fl.push('short-sleep');
      var tf = [];
      if (raw) Object.keys(raw.tests || {}).forEach(function (t) {
        ((raw.tests[t] && raw.tests[t].flags) || []).forEach(function (f) { if (f !== 'exploratory' && FLAG_TEXT[f]) tf.push(testName(t) + ': ' + FLAG_TEXT[f]); });
      });
      var words = fl.filter(function (f) { return FLAG_TEXT[f]; }).map(function (f) { return FLAG_TEXT[f]; });
      if (words.length || tf.length) notes.push({ v: v, words: words.concat(tf) });
    });
    if (notes.length) {
      sec.appendChild(C().details('Notes about some visits (' + notes.length + ')', h('ul', { 'class': 'hf-lab-notes' }, notes.map(function (n) {
        return h('li', null, [h('strong', null, [KIND_NAME[n.v.kind] + ', ' + dateText(n.v.startedAt) + ': ']), n.words.join('; ') + '.']);
      }))));
    }
    return sec;
  }

  function configSection(recs, sched) {
    var cur = (recs.settings && recs.settings.labConfig) || 'standard';
    var started = (recs.labVisits || []).some(function (v) { return v && Object.keys(v.tests || {}).length; });
    function total(cfg) {
      var full = HF.lab.visitMinutes(cfg), q = HF.lab.visitMinutes('quick');
      var n = sched.programme && sched.programme.quickBefore ? 1 : 0;
      return Math.round((4 * full + n * q) / 6) / 10;
    }
    var opts = ['standard', 'minimum', 'quick', 'extended'].map(function (cfg) {
      var m = HF.lab.visitMinutes(cfg);
      return { value: cfg, label: CONFIG_TEXT[cfg].label + ' · about ' + m + ' min: ' + CONFIG_TEXT[cfg].what };
    });
    var note = h('p', { 'class': 'hf-lab-cfgnote' });
    function paintNote(cfg) {
      note.textContent = 'With ' + CONFIG_TEXT[cfg].label + ', four full visits' + (sched.programme && sched.programme.quickBefore ? ' and a Quick check' : '') + ' come to about ' + total(cfg) + ' hours over about four months.' +
        (started ? ' Visits already taken keep their own choice; keep one choice for all visits so they can be compared.' : '');
    }
    var seg = C().segmented({ legend: 'How long a visit takes', name: 'lab-config', value: cur, options: opts, cls: 'hf-lab-config',
      hint: 'Shorter visits measure fewer things, and their results are less reliable.',
      onChange: function (val) {
        HF.store.mutate(function (r) { r.settings = r.settings || {}; r.settings.labConfig = val; r.settings.updatedAt = Date.now(); });
        paintNote(val);
      } });
    seg.classList.add('hf-lab-config');
    paintNote(cur);
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-cfg-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'lab-cfg-h' }, ['Visit length']), seg, note
    ]);
  }

  function claimsSection() {
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-what-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'lab-what-h' }, ['What the Lab can and cannot tell you']),
      h('ul', { 'class': 'hf-lab-claims' }, [
        h('li', null, ['You will get better at the tasks you train. The Lab checks whether that carries over to tasks you never practise.']),
        h('li', null, ['Every Lab item is generated and checked by a solver; Lab material is never used in training.']),
        h('li', null, ['It shows your own scores per visit. There is no IQ score, no ranking and no comparison with other people.']),
        h('li', null, ['Most controlled studies find no effect of memory training on IQ or reasoning tests. Long-Horizon does not claim to make anyone smarter.']),
        h('li', null, ['One person’s change cannot show what caused it: retesting, sleep, mood, device and expectations all move scores. For causes, a group study with a comparison programme is needed (Study mode).'])
      ]),
      C().details('More about the tests', h('div', { 'class': 'hf-prose hf-small' }, [
        h('p', null, ['Part A (memory): an n-back probe with shapes you never train with, a relation probe, a spatial span test and an updating test. Part B (reasoning and control): generated 3 × 3 puzzles, number and letter series, graph mapping (Jastrzębski et al., 2023) and a digit task-switching test after Cao et al. (2026). Extended adds a colour-and-place test.']),
        h('p', null, ['Four parallel versions of every test are built from one blueprint and given in a balanced order, so you never see the same items twice in a row. Reasoning tests run only four times in all, because they are the most sensitive to practice.']),
        h('p', null, ['Every test starts with the same instructions and practice at every visit; only practice items give feedback.'])
      ]))
    ]);
  }

  function calibrationSection(recs) {
    // CB-07: a removal is a tombstone { updatedAt, removed: true, tests: {} } (it wins merges, unlike null) = no calibration
    var cal = recs.calibration && !recs.calibration.removed ? recs.calibration : null;
    var sec = h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-cal-h' }, [h('h2', { 'class': 'hf-h2', id: 'lab-cal-h' }, ['Noise bands'])]);
    var status = h('div', { 'class': 'hf-stack hf-stack--sm', 'data-cal-status': cal ? 'loaded' : 'none' });
    function paint(c) {
      clear(status);
      if (c && c.removed) c = null;
      status.setAttribute('data-cal-status', c ? 'loaded' : 'none');
      if (!c || !c.tests) {
        status.appendChild(h('p', { 'class': 'hf-soft' }, ['Not yet calibrated. When at least 50 people have done both baselines, the community publishes a calibration file (made with tools/analysis/calibrate.py). Import it here, or get it with a new Long-Horizon release.']));
        return;
      }
      var ids = Object.keys(c.tests), usable = ids.filter(function (id) { var t = c.tests[id]; return t.n >= 50 && t.r >= 0 && t.r < 1 && t.sd > 0; });
      status.appendChild(C().notice({ tone: 'good', slim: true, title: 'Calibration ' + (c.version || ''), text: usable.length + ' of ' + ids.length + ' tests have a noise band (' + usable.map(testName).join(', ') + ').' + (ids.length > usable.length ? ' The others need more people first.' : '') + (c.source ? ' Source: ' + c.source : '') }));
      var rm = btn('Remove calibration', { variant: 'quiet', size: 'sm' });
      rm.addEventListener('click', function () {
        HF.dom.confirm('Results will say "not yet calibrated" again until you import a file.', { title: 'Remove the calibration?', ok: 'Remove', cancel: 'Keep' }).then(function (yes) {
          if (!yes) return;
          HF.store.mutate(function (r) { r.calibration = { updatedAt: Date.now(), removed: true, tests: {} }; });
          paint(null);
          if (S.root) setTimeout(function () { refreshResults(); }, 0);
        });
      });
      status.appendChild(h('div', { 'class': 'hf-actions' }, [rm]));
    }
    paint(cal);
    sec.appendChild(status);
    var msg = h('div', { 'aria-live': 'polite' });
    var file = h('input', { type: 'file', accept: '.json,application/json', 'class': 'hf-lab-file', id: 'lab-cal-file' });
    var paste = h('textarea', { 'class': 'hf-lab-paste hf-input', id: 'lab-cal-paste', rows: '4', spellcheck: 'false', placeholder: '{ "version": "community-…", "tests": { … } }' });
    var imp = btn('Import pasted text', { variant: 'secondary' });
    function apply(text) {
      clear(msg);
      var res = parseCalibration(text);
      if (!res.ok) { msg.appendChild(C().notice({ tone: 'warn', slim: true, text: res.error })); return; }
      HF.store.mutate(function (r) { r.calibration = res.calibration; });
      paint(res.calibration);
      msg.appendChild(C().notice({ tone: 'good', slim: true, live: true, text: 'Imported. ' + res.used.length + ' test' + (res.used.length === 1 ? '' : 's') + ' now show a noise band.' + (res.low.length ? ' ' + res.low.length + ' entr' + (res.low.length === 1 ? 'y is' : 'ies are') + ' below 50 people and stay "not yet calibrated".' : '') }));
      if (S.root) setTimeout(function () { refreshResults(); }, 0);
    }
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      readAsText(f).then(apply, function () { clear(msg); msg.appendChild(C().notice({ tone: 'warn', slim: true, text: 'This file could not be read.' })); });
    });
    imp.addEventListener('click', function () { apply(paste.value); });
    sec.appendChild(C().details('Import a calibration file', h('div', { 'class': 'hf-stack' }, [
      C().field({ label: 'Choose the file', control: file }),
      C().field({ label: 'Or paste its text', control: paste }),
      h('div', { 'class': 'hf-actions' }, [imp]), msg
    ])));
    return sec;
  }

  function studySection(recs) {
    var st = HF.study && HF.study.state ? HF.study.state(recs) : null;
    var sub = st ? (st.left ? 'You left the study on ' + dateText(st.left) + '. Your study file is still there.' : st.arm ? 'You are in a study: ' + (st.armLabel || 'programme set') + '.' : 'You joined a study; your programme is not set yet.') : 'Join or run a community experiment: two programmes, random assignment, pooled analysis.';
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-study-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'lab-study-h' }, ['Study mode']),
      C().list([{ title: 'Study mode', sub: sub, icon: 'people', go: 'study' }], { label: 'Study mode' })
    ]);
  }

  function exportSection() {
    var slot = h('div');
    var d = C().details('Export your Lab data (JSON or CSV)', slot);
    d.addEventListener('toggle', function () { if (d.open && !slot.firstChild) exportPanel(slot, {}); });
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-exp-h' }, [h('h2', { 'class': 'hf-h2', id: 'lab-exp-h' }, ['Your data']),
      h('p', { 'class': 'hf-soft' }, ['A full backup of everything (to restore it later) is under Progress or Settings. Here you can export the Lab part for analysis.']), d]);
  }

  var resultsSlot = null;
  function refreshResults() {
    if (!resultsSlot) return;
    var recs = HF.store.records, sched = HF.lab.schedule(recs, HF.store.derived, Date.now());
    var fresh = resultsSection(recs, sched);
    resultsSlot.parentNode.replaceChild(fresh, resultsSlot);
    resultsSlot = fresh;
  }

  function render(rootEl) {
    S.root = rootEl;
    var recs = HF.store.records;
    var sched = HF.lab.schedule(recs, HF.store.derived, Date.now());
    var hasVisits = (recs.labVisits || []).some(function (v) { return v && Object.keys(v.tests || {}).length; });
    var page = h('div', { 'class': 'hf-page hf-lab' });
    page.appendChild(h('header', { 'class': 'hf-page__head' }, [
      h('h1', { 'class': 'hf-h1' }, ['Lab']),
      h('p', { 'class': 'hf-lead' }, ['Optional. Measure your memory and reasoning on tests you never train on, before, during and after your training, and see what carries over.'])
    ]));
    if (HF.store.persistent === false) {
      // the store says why (status.reason: blocked | write-failed | quota | newer); 'newer' asks to reload this tab
      var stMsg = HF.store.status && HF.store.status.message;
      page.appendChild(C().notice({ tone: 'warn', title: 'Not saved on this device', text: stMsg || 'This page cannot save to the browser here, so Lab results last only while it stays open. Use the export below to keep a copy.' }));
    }
    page.appendChild(nextCard(sched, recs));
    if (!hasVisits) {
      page.appendChild(claimsSection());
      page.appendChild(configSection(recs, sched));
    }
    page.appendChild(h('section', { 'class': 'hf-section', 'aria-labelledby': 'lab-plan-h' }, [h('h2', { 'class': 'hf-h2', id: 'lab-plan-h' }, ['Your visits']), scheduleList(sched),
      h('p', { 'class': 'hf-small hf-muted' }, ['An extra memory check can be taken at any time; it uses only the memory tests.'])]));
    resultsSlot = resultsSection(recs, sched);
    page.appendChild(resultsSlot);
    if (hasVisits) {
      page.appendChild(claimsSection());
      page.appendChild(configSection(recs, sched));
    }
    page.appendChild(studySection(recs));
    page.appendChild(calibrationSection(recs));
    page.appendChild(exportSection());
    rootEl.appendChild(page);
  }

  function leave() {
    S.offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    S.root = null;
    resultsSlot = null;
  }

  var screen = { title: 'Lab', render: render, leave: leave };
  ui.lab = { exportPanel: exportPanel, parseCalibration: parseCalibration, verdictText: verdictText, FLAG_TEXT: FLAG_TEXT, KIND_NAME: KIND_NAME, testName: testName };
  ui.screens = ui.screens || {};
  ui.screens.lab = screen;
  if (HF.router && typeof HF.router.register === 'function') HF.router.register('lab', screen);
})(typeof window !== 'undefined' ? window : globalThis);
