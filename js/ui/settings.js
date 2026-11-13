/* Long-Horizon — Settings screen (js/ui/settings.js). DOM only, ES2019, MIT licence. Owner: P3.

   Route `settings` { section? }  section ∈ style | session | sound | keys | display | data (scrolls there).
   Every control saves at once through HF.ui.screenKit.setSettings (one LWW write of records.settings with a new
   updatedAt) and display settings are applied with HF.ui.shell.applySettings. Covers every key of SPEC §3.1:
     style    mode (six styles, one line each + what each gives up; "Help me choose" asks one question; Stretch locked
              until derived.stretch.open), protocols {cao, wang, jaeggi} + caoArm (Protocols), sprint.nback (Sprint)
     session  sessionMinutes 10–30, weeklyTarget 3–5 (clamped to the style's cap), balance presets, spanOn, dual, gridT8
     sound    sound tones|letters (only if HF.sets.available('lettersAudio'))|off, volume, sound check (HF.audio.soundCheck),
              audioOffsetMs measured by tapping along to 16 beats (offset = −median lag, clamped ±500 ms)
     keys     keys.match/match2/no/pause[1]/next remapped by pressing a key (conflicts offer a swap; Tab, Enter, Esc,
              function and modifier keys are refused), A/L preset (Brain Workshop style), defaults
     display  perResponseFeedback (null = the style's default; locked in Stretch and Protocols), focusMode, theme,
              largeText, leftHanded, reducedMotion (null = follow the device), includeLevelsInShare
     data     storage status (memory mode in HF.store.status.message's words, Reload when reason 'newer'; the
              status.nearFull Export prompt: Phase 4, CA-04/CA-05), HF.ui.backup.panel({ reset: true }) (export, CSV,
              import, reset with HF.dom.confirm)
   labConfig is shown under Session with a link to the Lab (which edits it); freePace is set by Free play.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function K() { return ui.screenKit; }
  function c() { return ui.c; }
  function h(t, a, k) { return ui.c.h(t, a, k); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  var S = { root: null, off: [], help: null, helpOpen: false, capture: null, capListener: null, keyMsg: null, tap: null, checkMsg: null };
  var SECTIONS = [
    { id: 'style', label: 'Training style' }, { id: 'session', label: 'Session' }, { id: 'sound', label: 'Sound' },
    { id: 'keys', label: 'Keys' }, { id: 'display', label: 'Display' }, { id: 'data', label: 'Data' }
  ];
  var MODE_ORDER = ['varied', 'sprint', 'stretch', 'mastery', 'protocols', 'free'];

  function settings() {
    var r = K().records();
    var s = (r && r.settings) || {};
    if (HF.derive && HF.derive.normalizeSettings) { try { return HF.derive.normalizeSettings(s); } catch (e) { /* fall through */ } }
    return s;
  }
  function save(patch, redraw) {
    var out = K().setSettings(patch);
    if (redraw) draw(redraw === true ? null : redraw);
    return out;
  }

  // ------------------------------------------------------------------ Training style
  var PROTOCOLS = [
    { id: 'cao', title: 'Cao et al. 2026: executive n-back',
      what: 'The days of the week, one every 3 seconds; press when the day shown is the day after the one n back. 20 blocks (about 30 minutes) per session, 6 sessions 1 to 2 days apart; each session starts 2 levels below where the last one ended.',
      limits: '30 students, 15 per group, and no untrained control group. Complex span improved only in the executive group; the switching advantage was marginal; matrices and Stroop improved in both groups alike. At the 3-month follow-up the operation span score and the switch cost no longer differed between the groups, while letters recalled still favoured the executive group (p = .028, post-test and follow-up pooled).' },
    { id: 'wang', title: 'Wang et al. 2025: Equal Steps',
      what: 'A stream of numbers; press when the step between numbers repeats (1-back, then 2-back). 5 blocks of 20 a day for 30 days. The level moves once a day from that day’s accuracy, which is the only score you see.',
      limits: '29 trained students against 28 who did a quiz. On the only reasoning test (matrices, close to ceiling) both groups improved equally; the reasoning claim rests on brain-wave (EEG) changes alone.' },
    { id: 'jaeggi', title: 'Jaeggi et al. 2008: dual n-back',
      what: 'A square on a grid and a sound at the same time, each tracked n back. 20 blocks per session; up after fewer than 3 mistakes per stream, down after more than 5. About 20 sessions are suggested. Long-Horizon plays tones unless you choose spoken letters under Sound; the paper used spoken consonants.',
      limits: 'Small groups compared with no-contact controls, and short timed reasoning tests. Later trials with active control groups mostly found no reasoning gains.' }
  ];

  function modeCard(id, s, d) {
    var Cc = c(), info = K().MODES[id], checked = s.mode === id;
    var locked = id === 'stretch' && !(d.stretch && d.stretch.open);
    var input = h('input', { type: 'radio', name: 'hf-mode', value: id, id: 'hf-mode-' + id, 'class': 'hf-mode__radio', disabled: locked,
      'aria-describedby': 'hf-mode-' + id + '-d' });
    input.checked = checked;
    input.addEventListener('change', function () {
      if (!input.checked) return;
      save({ mode: id }, 'hf-mode-' + id);
      announce('Training style: ' + info.label + '.');
    });
    var counted = isNum(d.sessionsCounted) ? d.sessionsCounted : 0;
    var lockNote = locked ? h('span', { 'class': 'hf-mode__lock' }, [Cc.icon('lock'), 'Opens after 6 counted sessions (you have ' + counted + ').']) : null;
    return h('label', { 'class': 'hf-mode' + (checked ? ' is-checked' : '') + (locked ? ' is-locked' : ''), 'for': 'hf-mode-' + id }, [
      input,
      h('span', { 'class': 'hf-mode__text', id: 'hf-mode-' + id + '-d' }, [
        h('span', { 'class': 'hf-mode__title' }, [info.label, id === 'varied' ? h('span', { 'class': 'hf-mode__def' }, [' · default']) : null]),
        h('span', { 'class': 'hf-mode__line' }, [info.line]),
        h('span', { 'class': 'hf-mode__gives' }, [h('b', null, ['Gives up: ']), info.gives]),
        lockNote
      ])
    ]);
  }

  function helpBox(s, d) {
    var Cc = c(), HELP = K().HELP;
    var out = h('div', { 'class': 'hf-help', id: 'hf-help' });
    var result = h('div', { 'class': 'hf-help__result', 'aria-live': 'polite' });
    var seg = Cc.segmented({ legend: HELP.question, name: 'hf-help-q', value: S.help || '',
      options: HELP.answers.map(function (a) { return { value: a.id, label: a.label }; }),
      onChange: function (v) { S.help = v; showResult(); } });
    seg.classList.add('hf-help__q');
    function showResult() {
      clear(result);
      var a = null;
      HELP.answers.forEach(function (x) { if (x.id === S.help) a = x; });
      if (!a) return;
      var mode = a.mode, why = a.why;
      if (mode === 'stretch' && !(d.stretch && d.stretch.open)) {
        mode = 'varied';
        why = 'Stretch opens after 6 counted sessions. Until then Varied keeps the challenge near the edge of what you can do; switch to Stretch when it opens.';
      }
      var info = K().MODES[mode];
      var same = s.mode === mode;
      result.appendChild(Cc.notice({ tone: 'info', title: 'Suggested: ' + info.label, text: why,
        action: same ? [h('span', { 'class': 'hf-small hf-strong' }, ['This is your style already.'])]
          : [Cc.button('Use ' + info.label, { variant: 'secondary', size: 'sm', id: 'hf-help-use', onClick: function () {
            save({ mode: mode }, 'hf-mode-' + mode);
            announce('Training style: ' + info.label + '.');
          } })] }));
    }
    out.appendChild(seg);
    out.appendChild(result);
    showResult();
    return out;
  }

  function protocolsBox(s) {
    var Cc = c(), on = s.protocols || {};
    var box = h('div', { 'class': 'hf-protos' }, [h('h3', { 'class': 'hf-h3' }, ['Which protocols']),
      h('p', { 'class': 'hf-small hf-soft' }, ['Each runs as closely as its paper allows (where a paper is silent, Long-Horizon’s choices are listed in the guide). With several on, Today offers the one that is due, and you can pick another. They train what each paper trained; none has been shown to raise reasoning.'])]);
    var msg = h('p', { 'class': 'hf-small hf-protos__msg', role: 'status' });
    PROTOCOLS.forEach(function (p) {
      var cb = Cc.toggle({ label: p.title, checked: !!on[p.id], id: 'hf-proto-' + p.id, hint: p.what, onChange: function (val, input) {
        var cur = settings().protocols || {};
        var next = { cao: !!cur.cao, wang: !!cur.wang, jaeggi: !!cur.jaeggi };
        next[p.id] = !!val;
        if (!next.cao && !next.wang && !next.jaeggi) { input.checked = true; input.dispatchEvent(new root.Event('change')); msg.textContent = 'Keep at least one protocol on.'; return; }
        msg.textContent = '';
        save(function (st) { st.protocols = next; });
      } });
      var kids = [cb, Cc.details('What the study found, and its limits', h('p', { 'class': 'hf-small' }, [p.limits]), { cls: 'hf-protos__limits' })];
      if (p.id === 'cao') {
        kids.push(Cc.segmented({ legend: 'Cao version', name: 'hf-cao-arm', value: s.caoArm === 'trad' ? 'trad' : 'exec',
          options: [{ value: 'exec', label: 'Executive: the day after' }, { value: 'trad', label: 'Traditional: the same day' }],
          onChange: function (v) { save({ caoArm: v }); } }));
      }
      box.appendChild(h('div', { 'class': 'hf-protos__item' }, kids));
    });
    box.appendChild(msg);
    return box;
  }

  function sprintBox(s, d) {
    var Cc = c(), C = HF.catalog;
    var ids = ['nback.plain', 'nback.transform', 'nback.arith', 'nback.switch'].filter(function (id) {
      return id === 'nback.plain' || (d.tracks && d.tracks[id] && d.tracks[id].available);
    });
    var cur = (s.sprint && s.sprint.nback) || 'nback.plain';
    return h('div', { 'class': 'hf-sprint' }, [Cc.select({
      label: 'Sprint’s n-back version', id: 'hf-sprint-nback', value: cur,
      hint: 'Sprint keeps one version per task so practice adds up fast. Executive versions appear here once they are open.',
      options: ids.map(function (id) { return { value: id, label: C.get(id).name + (id === 'nback.plain' ? ' (grid positions)' : '') }; }),
      onChange: function (v) { save(function (st) { st.sprint = { nback: v }; }); }
    })]);
  }

  function styleSection(s, d) {
    var Cc = c();
    var sec = K().section({ id: 'style', title: 'Training style', lead: 'Your levels and history carry over whichever style you choose; you can switch at any time.' });
    var fs = h('fieldset', { 'class': 'hf-modes' }, [h('legend', { 'class': 'hf-vh' }, ['Training style'])].concat(MODE_ORDER.map(function (id) { return modeCard(id, s, d); })));
    sec.appendChild(fs);
    var helpBtn = Cc.button(S.helpOpen ? 'Hide the question' : 'Help me choose', { variant: 'secondary', icon: 'compass', id: 'hf-help-btn',
      attrs: { 'aria-expanded': S.helpOpen ? 'true' : 'false', 'aria-controls': 'hf-help' },
      onClick: function () { S.helpOpen = !S.helpOpen; draw('hf-help-btn'); } });
    sec.appendChild(h('div', { 'class': 'hf-actions' }, [helpBtn]));
    if (S.helpOpen) sec.appendChild(helpBox(s, d));
    if (s.mode === 'protocols') sec.appendChild(protocolsBox(s));
    if (s.mode === 'sprint') sec.appendChild(sprintBox(s, d));
    return sec;
  }

  // ------------------------------------------------------------------ Session
  var BAL2 = [{ id: 'even', label: 'Even (50 / 50)', v: [50, 50, 0] }, { id: 'nb', label: 'More n-back (65 / 35)', v: [65, 35, 0] },
    { id: 'rel', label: 'More relations (35 / 65)', v: [35, 65, 0] }];
  var BAL3 = [{ id: 'even', label: 'Even (40 / 35 / 25)', v: [40, 35, 25] }, { id: 'nb', label: 'More n-back (50 / 30 / 20)', v: [50, 30, 20] },
    { id: 'rel', label: 'More relations (30 / 50 / 20)', v: [30, 50, 20] }, { id: 'span', label: 'More span (30 / 30 / 40)', v: [30, 30, 40] }];

  function blocksFor(min, spanOn) {
    var rated = Math.max(1, Math.round(12 * min / 25));
    return rated + (spanOn ? 3 : 2);
  }

  function sessionSection(s, d) {
    var Cc = c();
    var sec = K().section({ id: 'session', title: 'Session' });
    var mins = [10, 15, 20, 25, 30];
    var cur = isNum(s.sessionMinutes) ? s.sessionMinutes : 25;
    if (mins.indexOf(cur) < 0) mins.push(cur), mins.sort(function (a, b) { return a - b; });
    sec.appendChild(Cc.select({ label: 'Session length', id: 'hf-set-minutes', value: cur,
      hint: 'Protocols keep each paper’s own session length.',
      options: mins.map(function (m) { return { value: m, label: m + ' minutes (about ' + blocksFor(m, s.spanOn) + ' blocks)' }; }),
      onChange: function (v) { save({ sessionMinutes: Number(v) }); } }));

    var cap = HF.modes ? HF.modes.get(s.mode).targetCap : 5;
    var target = isNum(s.weeklyTarget) ? Math.max(3, Math.min(5, Math.round(s.weeklyTarget))) : 4;
    var seg = Cc.segmented({ legend: 'Weekly target', name: 'hf-set-target', value: target,
      hint: 'Sessions a week. Rest days are part of the plan; any day of the week counts, so a session can be made up later in the same week.',
      options: [3, 4, 5].map(function (n) { return { value: n, label: n + ' sessions' }; }),
      onChange: function (v) { save({ weeklyTarget: Number(v) }); } });
    seg.querySelectorAll('input').forEach(function (inp) { if (Number(inp.value) > cap) { inp.disabled = true; inp.closest('label').classList.add('is-disabled'); } });
    sec.appendChild(seg);
    if (target > cap) sec.appendChild(h('p', { 'class': 'hf-small hf-soft' }, [K().MODES[s.mode].label + ' counts at most ' + cap + ' sessions a week, so your target is ' + cap + ' while you use it.']));

    var bal = s.balance || { nback: 50, relations: 50, span: 0 };
    var list = s.spanOn ? BAL3 : BAL2;
    var match = null;
    list.forEach(function (p) {
      if (p.v[0] === bal.nback && p.v[1] === bal.relations && (!s.spanOn || p.v[2] === bal.span)) match = p.id;
    });
    var opts = list.map(function (p) { return { value: p.id, label: p.label }; });
    if (!match) {
      opts.push({ value: 'custom', label: 'Custom (' + [bal.nback, bal.relations].concat(s.spanOn ? [bal.span] : []).join(' / ') + ')' });
      match = 'custom';
    }
    sec.appendChild(Cc.segmented({ legend: 'Task balance', name: 'hf-set-balance', value: match,
      hint: s.spanOn ? 'Share of blocks for n-back / relations / span.' : 'Share of blocks for n-back / relations.',
      options: opts, onChange: function (v) {
        var p = null; list.forEach(function (x) { if (x.id === v) p = x; });
        if (p) save(function (st) { st.balance = { nback: p.v[0], relations: p.v[1], span: p.v[2] }; });
      } }));

    var inStudy = !!(d.study && d.study.left == null);   // a participant who left the study trains normally (Phase 4)
    var pr = d.programme || { done: 0, of: 20 };
    var spanHint = inStudy ? 'Not used in Study mode, so both programmes train the same kinds of task.'
      : 'Remember letters or symbols while you check sums. It stays off by default during the 20-session programme (you are at ' + Math.min(pr.done || 0, pr.of || 20) + ' of ' + (pr.of || 20) + ') so the Lab can test whether training carries over to it.';
    var spanT = Cc.toggle({ label: 'Span (complex span)', id: 'hf-set-span', checked: !!s.spanOn, hint: spanHint, onChange: function (val) {
      save(function (st) { st.spanOn = !!val; st.balance = val ? { nback: 40, relations: 35, span: 25 } : { nback: 50, relations: 50, span: 0 }; }, 'hf-set-span');
    } });
    if (inStudy) spanT.querySelector('input').disabled = true;
    sec.appendChild(spanT);
    sec.appendChild(Cc.toggle({ label: 'Dual n-back from the start', id: 'hf-set-dual', checked: !!s.dual,
      hint: 'Position and sound together (needs sound). Otherwise Dual joins around session 8.',
      onChange: function (val) { save({ dual: !!val }); } }));
    sec.appendChild(Cc.toggle({ label: 'Relation Grid tier 8 (five different)', id: 'hf-set-t8', checked: !!s.gridT8,
      hint: 'Optional and very hard. It only matters once tier 7 reaches step 6.',
      onChange: function (val) { save({ gridT8: !!val }); } }));
    // settings.labConfig is edited on the Lab page (P2); shown here so every setting has a place.
    var cfg = s.labConfig || 'standard';
    var LAB_CFG = { standard: 'Standard', extended: 'Extended', minimum: 'Minimum', quick: 'Quick' };
    var labMin = null;
    try { labMin = HF.lab && HF.lab.visitMinutes ? HF.lab.visitMinutes(cfg) : null; } catch (e) { labMin = null; }
    sec.appendChild(h('div', { 'class': 'hf-row hf-row--between hf-set__lab' }, [
      h('p', { 'class': 'hf-small' }, [h('span', { 'class': 'hf-strong' }, ['Lab visits: ']), (LAB_CFG[cfg] || cfg) + (isNum(labMin) ? ', about ' + labMin + ' minutes each' : '') + '.']),
      Cc.button('Change in the Lab', { variant: 'quiet', size: 'sm', go: 'lab' })
    ]));
    return sec;
  }

  // ------------------------------------------------------------------ Sound
  function lettersAvailable() {
    try { return !!(HF.sets && HF.sets.available && HF.sets.available('lettersAudio')); } catch (e) { return false; }
  }

  function offsetText(ms) {
    ms = Math.round(ms || 0);
    if (!ms) return 'On time (0 ms). Change it only if sounds seem late, for example with Bluetooth headphones.';
    if (ms < 0) return 'Sounds play ' + (-ms) + ' ms early, to make up for a delay in your speakers or headphones.';
    return 'Sounds play ' + ms + ' ms late.';
  }

  function soundSection(s) {
    var Cc = c();
    var sec = K().section({ id: 'sound', title: 'Sound' });
    var letters = lettersAvailable();
    var opts = [{ value: 'tones', label: 'Tones' }];
    if (letters) opts.push({ value: 'letters', label: 'Spoken letters' });
    opts.push({ value: 'off', label: 'Off' });
    var val = s.sound === 'letters' && !letters ? 'tones' : (s.sound || 'tones');
    sec.appendChild(Cc.segmented({ legend: 'Sounds', name: 'hf-set-sound', value: val,
      hint: (letters ? 'Spoken letters are short synthesized clips (Flite’s cmu_us_slt voice). ' : '') + 'Dual n-back and the tone sets need sound, so keep it on while you train them.',
      options: opts, onChange: function (v) { save({ sound: v }); } }));

    var vol = Math.round((isNum(s.volume) ? s.volume : 0.8) * 100);
    var out = h('output', { 'class': 'hf-set__val hf-num', 'for': 'hf-set-volume' }, [vol + '%']);
    var range = h('input', { type: 'range', 'class': 'hf-range', id: 'hf-set-volume', min: '0', max: '100', step: '5', value: String(vol), 'aria-valuetext': vol + '%' });
    range.value = String(vol);
    range.addEventListener('input', function () {
      out.textContent = range.value + '%';
      range.setAttribute('aria-valuetext', range.value + '%');
      try { if (HF.audio && HF.audio.setVolume) HF.audio.setVolume(Number(range.value) / 100); } catch (e) { /* ignore */ }
    });
    range.addEventListener('change', function () { save({ volume: Number(range.value) / 100 }); });
    var fld = Cc.field({ label: 'Volume', control: range });
    fld.querySelector('label').appendChild(out);
    sec.appendChild(fld);

    var checkMsg = h('p', { 'class': 'hf-small hf-set__check', role: 'status' }, [S.checkMsg || '']);
    var checkBtn = Cc.button('Play a sound check', { variant: 'secondary', icon: 'sound', id: 'hf-sound-check', onClick: function () {
      if (!HF.audio || !HF.audio.soundCheck) { checkMsg.textContent = 'Sound is not available in this browser.'; return; }
      checkMsg.textContent = 'Playing…';
      var useLetters = settings().sound === 'letters' && letters;
      HF.audio.soundCheck({ letters: useLetters }).then(function (res) {
        var lat = res && res.latency && isNum(res.latency.outputMs) ? ' The browser reports an output delay of ' + Math.round(res.latency.outputMs + (res.latency.baseMs || 0)) + ' ms.' : '';
        S.checkMsg = res && res.ok ? 'You should hear three ' + (useLetters ? 'letters' : 'tones') + ' now.' + lat + ' ' + (res.hint || '') : 'Sound could not start here. ' + ((res && res.hint) || '');
        checkMsg.textContent = S.checkMsg;
      }, function () { checkMsg.textContent = 'Sound could not start here.'; });
    } });
    sec.appendChild(h('div', { 'class': 'hf-stack hf-stack--sm' }, [h('div', { 'class': 'hf-actions' }, [checkBtn]), checkMsg]));

    var offNow = isNum(s.audioOffsetMs) ? s.audioOffsetMs : 0;
    var offBox = h('div', { 'class': 'hf-offset', id: 'hf-offset' }, [
      h('h3', { 'class': 'hf-h3' }, ['Sound timing']),
      h('p', { 'class': 'hf-small', id: 'hf-offset-now' }, [offsetText(offNow)]),
      h('div', { 'class': 'hf-actions' }, [
        Cc.button(S.tap ? 'Close the timing test' : 'Measure my delay', { variant: 'secondary', icon: 'clock', id: 'hf-offset-measure', attrs: { 'aria-expanded': S.tap ? 'true' : 'false' },
          onClick: function () { if (S.tap) stopTap(); else S.tap = { stage: 'ready' }; draw('hf-offset-measure'); } }),
        offNow ? Cc.button('Reset to 0', { variant: 'quiet', id: 'hf-offset-reset', onClick: function () { save({ audioOffsetMs: 0 }, 'hf-offset-measure'); } }) : null
      ])
    ]);
    if (S.tap) offBox.appendChild(tapPanel());
    sec.appendChild(offBox);
    return sec;
  }

  // ---------- tap-along timing test ----------
  var TAP_N = 16, TAP_GAP = 750, TAP_LEAD = 1500, TAP_SKIP = 3;

  function stopTap() {
    var t = S.tap;
    if (t) {
      (t.timers || []).forEach(function (x) { clearTimeout(x); clearInterval(x); });
      if (t.stage === 'running') { try { if (HF.audio && HF.audio.stopAll) HF.audio.stopAll(); } catch (e) { /* ignore */ } }
    }
    S.tap = null;
  }

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }

  function tapResult(t) {
    var diffs = [];
    t.taps.forEach(function (tp) {
      var best = -1, bd = Infinity;
      t.beats.forEach(function (b, j) { var x = Math.abs(tp - b); if (x < bd) { bd = x; best = j; } });
      if (best >= TAP_SKIP && bd < TAP_GAP / 2) diffs.push(tp - t.beats[best]);
    });
    if (diffs.length < 6) return { ok: false, n: diffs.length };
    var m = median(diffs);
    var spread = median(diffs.map(function (x) { return Math.abs(x - m); }));
    var offset = Math.abs(m) < 40 ? 0 : -Math.round(m / 5) * 5;
    offset = Math.max(-500, Math.min(500, offset));
    return { ok: true, n: diffs.length, lag: Math.round(m), spread: Math.round(spread), offset: offset };
  }

  function tapPanel() {
    var Cc = c(), t = S.tap;
    var box = h('div', { 'class': 'hf-tapbox', id: 'hf-tapbox' });
    var status = h('p', { 'class': 'hf-small hf-tapbox__status', role: 'status', id: 'hf-tap-status' });
    if (t.stage === 'ready' || t.stage === 'error') {
      box.appendChild(h('p', { 'class': 'hf-small' }, ['You will hear ' + TAP_N + ' beats. Tap the big button (or press Space on it) along with each beat, as in time as you can. The first few beats are for getting into the rhythm. Use the headphones or speakers you train with.']));
      if (t.stage === 'error') status.textContent = t.msg || 'Sound could not start here.';
      var startBtn = Cc.button('Start the beats', { variant: 'secondary', icon: 'play', id: 'hf-tap-start', onClick: function () { beginTap(); } });
      box.appendChild(h('div', { 'class': 'hf-actions' }, [startBtn]));
      box.appendChild(status);
      return box;
    }
    if (t.stage === 'running') {
      var pad = h('button', { type: 'button', 'class': 'hf-tap', id: 'hf-tap-pad' }, [h('span', { 'class': 'hf-tap__label' }, ['Tap']), h('span', { 'class': 'hf-tap__hint' }, ['on each beat'])]);
      pad.addEventListener('pointerdown', function (e) {
        if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        record(e);
      });
      pad.addEventListener('keydown', function (e) {
        if (e.repeat) return;
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); record(e); }
      });
      pad.addEventListener('click', function (e) { e.preventDefault(); });
      t.pad = pad;
      t.status = status;
      status.textContent = 'Get ready…';
      box.appendChild(pad);
      box.appendChild(status);
      box.appendChild(h('div', { 'class': 'hf-actions' }, [Cc.button('Stop', { variant: 'quiet', id: 'hf-tap-stop', onClick: function () { stopTap(); S.tap = { stage: 'ready' }; draw('hf-tap-start'); } })]));
      return box;
    }
    // done
    var res = t.result;
    if (!res.ok) {
      box.appendChild(Cc.notice({ tone: 'info', slim: true, title: 'Not enough taps', text: 'Only ' + res.n + ' taps landed near a beat. Try again and tap along with every beat.' }));
    } else {
      var lagText = res.lag >= 0 ? 'Your taps came ' + res.lag + ' ms after the beats' : 'Your taps came ' + (-res.lag) + ' ms before the beats';
      var advice = res.offset === 0 ? 'That is close enough: no offset is needed.' : 'Long-Horizon can play sounds ' + Math.abs(res.offset) + ' ms ' + (res.offset < 0 ? 'earlier' : 'later') + ' to make up for it.';
      box.appendChild(Cc.notice({ tone: 'good', slim: true, title: 'Measured', text: lagText + ' (typical spread ' + res.spread + ' ms, ' + res.n + ' taps). ' + advice }));
    }
    var acts = [];
    if (res.ok) acts.push(Cc.button('Use ' + (res.offset > 0 ? '+' : res.offset < 0 ? '−' : '') + Math.abs(res.offset) + ' ms', { variant: 'secondary', id: 'hf-tap-use', onClick: function () {
      var off = res.offset;
      stopTap();
      save({ audioOffsetMs: off }, 'hf-offset-measure');
      announce('Sound timing saved: ' + off + ' ms.');
    } }));
    acts.push(Cc.button('Try again', { variant: 'quiet', id: 'hf-tap-again', onClick: function () { stopTap(); S.tap = { stage: 'ready' }; draw('hf-tap-start'); } }));
    box.appendChild(h('div', { 'class': 'hf-actions' }, acts));
    return box;
  }

  function record(e) {
    var t = S.tap;
    if (!t || t.stage !== 'running') return;
    var ts = HF.input && HF.input.time ? HF.input.time(e) : (e.timeStamp || root.performance.now());
    t.taps.push(ts);
    if (t.pad) { t.pad.classList.add('is-down'); setTimeout(function () { if (t.pad) t.pad.classList.remove('is-down'); }, 90); }
  }

  function beginTap() {
    var t = { stage: 'running', taps: [], beats: [], timers: [] };
    if (!HF.audio || !HF.audio.unlock) { S.tap = { stage: 'error', msg: 'Sound is not available in this browser.' }; draw('hf-tap-start'); return; }
    var p = HF.audio.unlock();
    S.tap = t;
    p.then(function (res) {
      if (S.tap !== t) return;
      if (!res || !res.ok) { S.tap = { stage: 'error', msg: 'Sound could not start here. ' + (HF.audio.HINT || '') }; draw('hf-tap-start'); return; }
      var perf0 = root.performance.now();
      var a0 = HF.audio.atPerf ? HF.audio.atPerf(perf0) : null;
      if (!isNum(a0)) a0 = HF.audio.now();
      for (var k = 0; k < TAP_N; k++) {
        var dt = TAP_LEAD + k * TAP_GAP;
        HF.audio.tone(k % 4 === 0 ? 0 : 2, a0 + dt / 1000, { durationMs: 110, rampMs: 5, gain: 0.55 });
        t.beats.push(perf0 + dt);
      }
      draw('hf-tap-pad');
      var tick = setInterval(function () {
        if (S.tap !== t || !t.status) return;
        var nowP = root.performance.now();
        var k2 = Math.floor((nowP - perf0 - TAP_LEAD) / TAP_GAP) + 1;
        t.status.textContent = k2 < 1 ? 'Get ready…' : 'Beat ' + Math.min(TAP_N, k2) + ' of ' + TAP_N;
      }, 200);
      t.timers.push(tick);
      t.timers.push(setTimeout(function () {
        if (S.tap !== t) return;
        clearInterval(tick);
        t.result = tapResult(t);
        t.stage = 'done';
        draw('hf-tap-use');
      }, TAP_LEAD + TAP_N * TAP_GAP + 700));
    }, function () { if (S.tap === t) { S.tap = { stage: 'error', msg: 'Sound could not start here.' }; draw('hf-tap-start'); } });
  }

  // ------------------------------------------------------------------ Keys
  var KEY_ROWS = [
    { key: 'match', label: 'Match / yes', hint: 'Press when the item matches.' },
    { key: 'match2', label: 'Sound match', hint: 'Dual n-back: the sound matches.' },
    { key: 'no', label: 'No', hint: 'Only in tasks that ask for an answer on every item.' },
    { key: 'pause', label: 'Pause', hint: 'Esc always pauses as well.' },
    { key: 'next', label: 'Continue', hint: 'Starts the next block from its rule card.' }
  ];
  var RESERVED = { Tab: 'Tab moves between buttons', Enter: 'Enter presses buttons', NumpadEnter: 'Enter presses buttons', Escape: 'Esc is kept for pausing and closing',
    Backspace: 'Backspace is kept for the browser', CapsLock: 'Caps Lock cannot be used', ContextMenu: 'That key opens menus' };
  var MODIFIER = { ShiftLeft: 1, ShiftRight: 1, ControlLeft: 1, ControlRight: 1, AltLeft: 1, AltRight: 1, MetaLeft: 1, MetaRight: 1, OSLeft: 1, OSRight: 1, Fn: 1 };
  var CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,30}$/;

  function defaults() {
    var d = HF.schema && HF.schema.SETTINGS_DEFAULTS && HF.schema.SETTINGS_DEFAULTS.keys;
    return K().clone(d || { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' });
  }
  function keysNow() { var s = settings(); return K().clone(s.keys || defaults()); }
  function codesOf(keys, name) { var v = keys[name]; return v ? (Array.isArray(v) ? v.slice() : [v]) : []; }
  function editable(keys, name) {
    var codes = codesOf(keys, name);
    if (name === 'pause') return codes.filter(function (x) { return x !== 'Escape'; })[0] || null;
    return codes[0] || null;
  }
  function label(code) { return HF.input && HF.input.codeLabel ? HF.input.codeLabel(code) : String(code || '').replace(/^Key/, ''); }
  function ownerOf(keys, code, except) {
    for (var i = 0; i < KEY_ROWS.length; i++) {
      var n = KEY_ROWS[i].key;
      if (n === except) continue;
      if (codesOf(keys, n).indexOf(code) >= 0) return n;
    }
    return null;
  }
  function rowLabel(name) { for (var i = 0; i < KEY_ROWS.length; i++) if (KEY_ROWS[i].key === name) return KEY_ROWS[i].label; return name; }
  function setCode(keys, name, code) {
    if (name === 'pause') keys.pause = code ? ['Escape', code] : ['Escape'];
    else keys[name] = code;
  }
  function saveKeys(keys, focusId) {
    save(function (st) { st.keys = keys; });
    try { if (HF.input && HF.input.setKeys) HF.input.setKeys(null); } catch (e) { /* ignore */ }
    draw(focusId || null);
  }

  function stopCapture() {
    if (S.capListener) { doc.removeEventListener('keydown', S.capListener, true); S.capListener = null; }
    S.capture = null;
  }

  function startCapture(name) {
    stopCapture();
    S.capture = name;
    S.keyMsg = null;
    S.capListener = function (e) {
      if (!S.capture) return;
      if (HF.dom && HF.dom.openModals && HF.dom.openModals()) return;
      if (MODIFIER[e.code] || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { stopCapture(); S.keyMsg = { tone: 'info', text: 'Nothing changed.' }; draw('hf-key-' + name); return; }
      if (RESERVED[e.code] || /^F\d{1,2}$/.test(e.code)) {
        S.keyMsg = { tone: 'info', text: (RESERVED[e.code] || 'Function keys are kept for the browser') + '. Press another key, or Esc to cancel.' };
        draw('hf-key-' + name + '-wait');
        return;
      }
      if (!CODE_RE.test(e.code || '')) { S.keyMsg = { tone: 'info', text: 'That key cannot be used. Press another key, or Esc to cancel.' }; draw('hf-key-' + name + '-wait'); return; }
      var keys = keysNow();
      var mine = editable(keys, name);
      var owner = ownerOf(keys, e.code, name);
      stopCapture();
      if (owner) {
        S.keyMsg = { tone: 'warn', text: label(e.code) + ' is already used for ' + rowLabel(owner) + '.', swap: { name: name, code: e.code, owner: owner, prev: mine } };
        draw('hf-key-swap');
        return;
      }
      setCode(keys, name, e.code);
      S.keyMsg = { tone: 'good', text: rowLabel(name) + ' is now ' + label(e.code) + '.' };
      saveKeys(keys, 'hf-key-' + name);
    };
    doc.addEventListener('keydown', S.capListener, true);
    draw('hf-key-' + name + '-wait');
  }

  function keysSection(s) {
    var Cc = c();
    var sec = K().section({ id: 'keys', title: 'Keys', lead: 'On a keyboard. Touch screens use the big answer buttons instead (No is always on the left).' });
    var keys = K().clone(s.keys || defaults());
    var rows = KEY_ROWS.map(function (row) {
      var code = editable(keys, row.key);
      var waiting = S.capture === row.key;
      var shown = row.key === 'pause' ? [Cc.kbd('Esc'), h('span', { 'class': 'hf-keys2__or' }, ['or']), code ? Cc.kbd(label(code)) : null] : [code ? Cc.kbd(label(code)) : h('span', { 'class': 'hf-muted' }, ['none'])];
      return h('li', { 'class': 'hf-keys2__row' + (waiting ? ' is-waiting' : ''), 'data-key': row.key }, [
        h('span', { 'class': 'hf-keys2__text' }, [h('span', { 'class': 'hf-keys2__label' }, [row.label]), h('span', { 'class': 'hf-hint' }, [row.hint])]),
        h('span', { 'class': 'hf-keys2__cap', 'aria-label': 'Current key' }, shown),
        waiting ? h('span', { 'class': 'hf-keys2__wait', role: 'status', tabindex: '-1', id: 'hf-key-' + row.key + '-wait' }, ['Press a key… (Esc cancels)'])
          : Cc.button('Change', { variant: 'quiet', size: 'sm', id: 'hf-key-' + row.key, attrs: { 'aria-label': 'Change the key for ' + row.label }, onClick: function () { startCapture(row.key); } })
      ]);
    });
    sec.appendChild(h('ul', { 'class': 'hf-keys2' }, rows));
    if (S.keyMsg) {
      var m = S.keyMsg, acts = null;
      if (m.swap) {
        acts = [Cc.button('Swap them', { variant: 'secondary', size: 'sm', id: 'hf-key-swap', onClick: function () {
          var k2 = keysNow();
          var sw = m.swap;
          if (sw.owner === 'pause') {
            k2.pause = ['Escape'].concat(sw.prev ? [sw.prev] : []);
          } else setCode(k2, sw.owner, sw.prev || null);
          setCode(k2, sw.name, sw.code);
          S.keyMsg = { tone: 'good', text: rowLabel(sw.name) + ' is now ' + label(sw.code) + ' and ' + rowLabel(sw.owner) + ' is ' + (sw.prev ? label(sw.prev) : 'Esc only') + '.' };
          saveKeys(k2, 'hf-key-' + sw.name);
        } }), Cc.button('Choose another key', { variant: 'quiet', size: 'sm', onClick: function () { startCapture(m.swap.name); } })];
      }
      sec.appendChild(Cc.notice({ tone: m.tone === 'warn' ? 'warn' : m.tone === 'good' ? 'good' : 'info', slim: true, text: m.text, action: acts, live: true, cls: 'hf-keys2__msg' }));
    }
    sec.appendChild(h('div', { 'class': 'hf-actions' }, [
      Cc.button('Use A and L (Brain Workshop)', { variant: 'secondary', size: 'sm', id: 'hf-key-al', onClick: function () {
        stopCapture();
        var k2 = keysNow();
        k2.match = 'KeyA'; k2.match2 = 'KeyL';
        if (k2.no === 'KeyA' || k2.no === 'KeyL') k2.no = 'KeyF';
        if (codesOf(k2, 'pause').some(function (x) { return x === 'KeyA' || x === 'KeyL'; })) k2.pause = ['Escape', 'KeyP'];
        if (k2.next === 'KeyA' || k2.next === 'KeyL') k2.next = 'Space';
        S.keyMsg = { tone: 'good', text: 'A is now Match (position) and L is Sound match, as in Brain Workshop. No stays on ' + label(k2.no) + '.' };
        saveKeys(k2, 'hf-key-al');
      } }),
      Cc.button('Restore default keys', { variant: 'quiet', size: 'sm', id: 'hf-key-default', onClick: function () {
        stopCapture();
        S.keyMsg = { tone: 'good', text: 'Default keys restored: J match, K sound match, F no.' };
        saveKeys(defaults(), 'hf-key-default');
      } })
    ]));
    return sec;
  }

  // ------------------------------------------------------------------ Display
  function displaySection(s, d) {
    var Cc = c();
    var sec = K().section({ id: 'display', title: 'Display and feedback' });
    var mode = HF.modes ? HF.modes.get(s.mode) : null;
    var fb = mode && mode.feedback ? mode.feedback : { perResponse: false, locked: false };
    var val = s.perResponseFeedback === true ? 'on' : s.perResponseFeedback === false ? 'off' : 'default';
    var seg = Cc.segmented({ legend: 'Flash after each press', name: 'hf-set-fb', value: fb.locked ? 'default' : val,
      hint: fb.locked ? (s.mode === 'stretch' ? 'Stretch keeps this off: less feedback is part of the style.' : 'Protocols show feedback as each paper did.')
        : 'A short green ring for a right press, a dashed ring otherwise. Never red, at most 3 a second.',
      options: [{ value: 'default', label: 'Style default (' + (fb.perResponse ? 'on' : 'off') + ')' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      onChange: function (v) { save({ perResponseFeedback: v === 'on' ? true : v === 'off' ? false : null }); } });
    if (fb.locked) seg.querySelectorAll('input').forEach(function (i) { i.disabled = true; });
    sec.appendChild(seg);
    sec.appendChild(Cc.toggle({ label: 'Focus mode', id: 'hf-set-focus', checked: !!s.focusMode,
      hint: 'Hides the weekly ring, badges, the “Last three blocks” meters and celebrations. Levels, graphs and history stay.',
      onChange: function (v) { save({ focusMode: !!v }); } }));
    sec.appendChild(Cc.segmented({ legend: 'Theme', name: 'hf-set-theme', value: s.theme || 'system',
      options: [{ value: 'system', label: 'Same as device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: function (v) { save({ theme: v }); } }));
    sec.appendChild(Cc.toggle({ label: 'Large text', id: 'hf-set-large', checked: !!s.largeText, hint: 'Makes all text and buttons about 20 % bigger.',
      onChange: function (v) { save({ largeText: !!v }); } }));
    sec.appendChild(Cc.toggle({ label: 'Left-handed layout', id: 'hf-set-hand', checked: !!s.leftHanded,
      hint: 'Mirrors the answer buttons for the left hand. No always stays on the left.',
      onChange: function (v) { save({ leftHanded: !!v }); } }));
    var rm = s.reducedMotion === true ? 'reduce' : s.reducedMotion === false ? 'full' : 'system';
    sec.appendChild(Cc.segmented({ legend: 'Motion', name: 'hf-set-motion', value: rm,
      hint: 'Training blocks never animate; this covers the screens around them.',
      options: [{ value: 'system', label: 'Same as device' }, { value: 'reduce', label: 'Reduce' }, { value: 'full', label: 'Allow' }],
      onChange: function (v) { save({ reducedMotion: v === 'reduce' ? true : v === 'full' ? false : null }); } }));
    sec.appendChild(Cc.toggle({ label: 'Include my levels when I share', id: 'hf-set-sharelevels', checked: !!s.includeLevelsInShare,
      hint: 'Share to Discord copies sessions, minutes and your newest badge; levels only with this on.',
      onChange: function (v) { save({ includeLevelsInShare: !!v }); } }));
    return sec;
  }

  // ------------------------------------------------------------------ Data
  function dataSection() {
    var Cc = c();
    var sec = K().section({ id: 'data', title: 'Data', lead: 'Everything stays in this browser on this device. Nothing is sent anywhere.' });
    var st = HF.store && HF.store.status ? HF.store.status : {};
    var memory = !!(HF.store && HF.store.persistent === false);
    if (memory) {
      // the store's own words for the cause: blocked | write-failed | quota | newer (Phase 4, CA-04/CA-05)
      sec.appendChild(Cc.notice({ tone: 'warn', title: 'Not saved on this device',
        text: st.message || 'This page cannot use the browser’s storage here (for example inside a preview), so everything is lost when it closes. Export a backup to keep it.',
        action: st.reason === 'newer' ? [Cc.button('Reload', { variant: 'secondary', size: 'sm', id: 'hf-set-reload', onClick: function () { try { root.location.reload(); } catch (e) { /* ignore */ } } })] : null }));
    } else {
      sec.appendChild(h('p', { 'class': 'hf-small' }, ['Saved in this browser’s storage' + (st.lastSaveAt ? ', last saved ' + K().fmtTime(st.lastSaveAt) : '') + '.']));
    }
    if (st.nearFull && !memory) {
      var size = !(isNum(st.mainChars) && st.mainChars > 0) ? ''
        : ' Saved data: about ' + (st.mainChars >= 1e6 ? (Math.round(st.mainChars / 1e5) / 10) + ' million' : Math.max(1, Math.round(st.mainChars / 1000)) + ' thousand') + ' characters.';
      sec.appendChild(Cc.notice({ tone: 'warn', title: 'Storage nearly full', text: (st.nearFullText || 'Long-Horizon’s saved data is getting large for this browser. Export a backup now.') + size, cls: 'hf-set__nearfull',
        action: [Cc.button('Export now', { variant: 'secondary', size: 'sm', icon: 'download', onClick: function () { if (ui.backup && ui.backup.openModal) ui.backup.openModal(); } })] }));
    }
    if (st.quotaWarned) sec.appendChild(Cc.notice({ tone: 'warn', slim: true, text: 'Storage is nearly full, so the oldest trial-by-trial details were removed. Totals, levels and Lab results are kept. Export a backup to keep everything.' }));
    if (ui.backup && ui.backup.panel) sec.appendChild(ui.backup.panel({ reset: true }));
    return sec;
  }

  // ------------------------------------------------------------------ screen
  var live = null;
  function announce(text) { if (live) { live.textContent = ''; setTimeout(function () { if (live) live.textContent = text; }, 30); } }

  function jumpNav() {
    var Cc = c();
    return h('nav', { 'class': 'hf-jump', 'aria-label': 'Settings sections' }, [h('ul', { 'class': 'hf-jump__list' }, SECTIONS.map(function (x) {
      return h('li', null, [Cc.button(x.label, { variant: 'quiet', size: 'sm', cls: 'hf-jump__btn', onClick: function () { jump(x.id); } })]);
    }))]);
  }
  function jump(id) {
    var t = doc.getElementById(id);
    if (!t) return;
    try { t.scrollIntoView({ block: 'start' }); } catch (e) { t.scrollIntoView(); }
    var hd = t.querySelector('h2');
    if (hd) { hd.setAttribute('tabindex', '-1'); try { hd.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
  }

  function draw(focusId) {
    var rootEl = S.root;
    if (!rootEl) return;
    var y = root.scrollY || 0;
    var active = doc.activeElement && rootEl.contains(doc.activeElement) ? doc.activeElement.id : null;
    clear(rootEl);
    var s = settings(), d = K().derived();
    var pg = K().page({ title: 'Settings', lead: 'Changes save at once, on this device only.', cls: 'hf-settings' });
    live = h('p', { 'class': 'hf-vh', role: 'status', 'aria-live': 'polite' });
    pg.head.appendChild(live);
    pg.head.appendChild(jumpNav());
    [styleSection(s, d), sessionSection(s, d), soundSection(s), keysSection(s), displaySection(s, d), dataSection()].forEach(function (sec) { pg.node.appendChild(sec); });
    rootEl.appendChild(pg.node);
    try { root.scrollTo(0, y); } catch (e) { /* ignore */ }
    var want = focusId || active;
    if (want) {
      var f = doc.getElementById(want);
      if (f) try { f.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
    }
  }

  function cleanup() {
    S.off.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    S.off = [];
    stopCapture();
    stopTap();
  }

  var screen = {
    title: 'Settings',
    render: function (rootEl, params) {
      cleanup();
      S.root = rootEl;
      S.keyMsg = null; S.checkMsg = null;
      draw(null);
      var sec = params && params.section;
      if (sec) setTimeout(function () { if (S.root) jump(sec); }, 0);
      S.off.push(K().watch(function (evt) {
        if (S.capture || (S.tap && S.tap.stage === 'running')) return;
        draw(null);
        if (evt && evt.source === 'import') jump('data');
      }));
    },
    leave: function () { cleanup(); S.root = null; S.helpOpen = false; S.help = null; live = null; }
  };

  ui.screens = ui.screens || {};
  ui.screens.settings = screen;
  ui.settings = { screen: screen, PROTOCOLS: PROTOCOLS, tapResult: tapResult, KEY_ROWS: KEY_ROWS };
  if (HF.router && HF.router.register) HF.router.register('settings', screen);
})(typeof window !== 'undefined' ? window : globalThis);
