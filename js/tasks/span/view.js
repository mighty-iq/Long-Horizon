/* Long-Horizon — complex span view with its own run() flow (browser only). MIT licence.
 * Uses HF.views.kit (js/tasks/relations/view.js, loaded first), HF.timing.custom (the block's flow: frame(), busy, pause
 * routing), HF.timing.measureFrameInterval/frameStats, HF.input (logical keys), HF.tasks.span.expected (same comparison
 * as the scorer, for the optional per-list line).
 *
 * HF.views.span.create(root, spec, ctx) → view                     (docs/dev/contracts-ui.md §1, SPEC §4.4)
 *   view = { kind: 'custom', type: 'span', trackId, spec, el, pads, run(ctx2) → Promise<log>,
 *            pause(reason) → bool, resume() → bool, abort() → bool (= the flow's; HF.timing.pause/resume/abort do the
 *            same while a list runs), state() → 'lead'|'timed'|'recall'|'between'|'paused'|'done', feedback(outcome,
 *            key?), destroy(),
 *            prepare/show/hide (no-ops: this view runs itself) }
 *   ctx  = { feedback: 'none'|'per-response', hand, keys, assist } (as every view)
 *   ctx2 = { timing = HF.timing, input = HF.input, onProgress({ done, total, phase }),
 *            onPause({ kind: 'span', reason, at, voided }) (optional: the caller shows its own pause UI and calls
 *            view.resume() or view.abort(); without it the view shows a small built-in pause panel) }
 *
 * One list (trial) = setSize × [ judgement → 250 ms blank → memorandum (spec.memMs, 1 s) → 250 ms blank ], then
 * recall. Between lists a 1.2 s "List 2 of 3" screen (plus, with per-response feedback, the last list's result).
 * - Judgement: "7 − 3 = 4", "True or false?"; J / right pad "True", F / left pad "False" (Phase 4, UX-02); self-paced
 *   up to spec.procLimitMs (the personal limit), no countdown shown; no answer = null (an error for the scorer).
 * - Onsets are flow.frame() (= HF.timing.frame()) timestamps (the frame in which the item is made visible); the next
 *   frame is logged as `shown`; durations are counted in frames of the interval measured at the start. RT =
 *   event.timeStamp − onset (presses before the onset are ignored). Only class toggles happen in frames; text is
 *   written into the hidden panel during the preceding blank (a timer).
 * - Recall: untimed keypad of the 12 symbols (spec trial.recallKeypad) in a fixed order, plus Skip (keeps a position
 *   blank, as in the automated OSPAN), Delete and Done. Keyboard: type the letter/symbol, Backspace, Enter. Entries
 *   beyond setSize are ignored. span.back says "in reverse order: the last one first". Typed letters (incl. F, J, K, P)
 *   are caught in the capture phase, so they are symbols there, not answers or pause; Space on a focused key presses it.
 * - The run is an HF.timing.custom flow (kind 'span') from run() to the log: busy + <html data-busy> (off while paused),
 *   wake lock, and every pause source — Escape/P, page hidden, pagehide, HF.timing.pause/resume/abort, view.pause/
 *   resume/abort, the built-in panel — goes through it; HF.timing.onPause subscribers are told. The list in progress
 *   (any phase up to Done) is voided; after resume a 1 s lead, then the NEXT list. A second pause keeps the first
 *   start (the core appends the reason).
 * - Voiding (never charge a dropped frame to the player): pause; a memorandum painted late (shown − onset >
 *   1.5 frames) or whose on-time differs from memMs by > 1.5 frames; a judgement that timed out after a late paint or
 *   a frame gap > 2.5 intervals while it was displayed. Flags are logged either way.
 *
 * Log (SPEC §4.4 + core-style extras; times in ms from t0 = the first judgement onset, 0.01 ms):
 *   { kind: 'span', trials: [ { i, setSize, proc: [ { resp: true|false|null, rt, src, onset, shown, offset, late,
 *       stall } ], mem: [ { onset, shown, offset, late, stall } ], recall: ['F', null, …], recallRts: [ms from the
 *       keypad onset], recallMs, voided, voidReason: null|'pause'|'late'|'stall'|'abort'|'not-presented' } ],
 *     paused, pauses: [ { start, end, reasons, during } ] (from the flow), aborted, abortReason, n, presented,
 *     procLimitMs, memMs, interval,
 *     frame: { fps, medianMs, maxMs, stalls, lowPrecision }, flags: { late: [i], stall: [i] }, startedAt, t0 }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var views = HF.views || (HF.views = {});
  var doc = root.document;

  var GAP_MS = 250, BETWEEN_MS = 1200, RESUME_MS = 1000, LEAD_MS = 600;

  function kitOf() {
    if (!views.kit) throw new Error('HF.views.span needs js/tasks/relations/view.js (HF.views.kit) loaded first');
    return views.kit;
  }
  function r2(x) { return typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : null; }
  function isEditable(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var type = (t.getAttribute('type') || 'text').toLowerCase();
      return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].indexOf(type) < 0;
    }
    return !!t.isContentEditable;
  }
  function expectedOf(trial) {
    if (HF.tasks && HF.tasks.span && typeof HF.tasks.span.expected === 'function') return HF.tasks.span.expected(trial);
    var mem = trial.pairs.map(function (p) { return p.mem; });
    return trial.order === 'backward' ? mem.slice().reverse() : mem;
  }

  function create(root, spec, ctx) {
    if (!root || !spec) throw new Error('HF.views.span.create(root, spec, ctx): root and spec are required');
    var kit = kitOf(), el = kit.el;
    ctx = ctx || {};
    var noun = spec.set === 'symbols12' ? 'symbols' : 'letters';
    var v = { kind: 'custom', type: 'span', trackId: spec.trackId, spec: spec, ctx: ctx, root: root, pads: [],
      prepare: function () {}, show: function () {}, hide: function () {} };

    // ---------------------------------------------------------------- DOM
    v.el = el('div', 'hf-task hf-v hf-v--span', { role: 'group', 'aria-label': 'Complex span' });
    var head = el('div', 'hf-v__head');
    var status = el('p', 'hf-sp__status', null, '');
    head.appendChild(status);
    var stage = el('div', 'hf-v__stage');
    var timed = el('div', 'hf-sp__timed', { 'aria-hidden': 'true' });
    var judge = el('div', 'hf-sp__judge is-hid');
    var eq = el('p', 'hf-sp__eq', null, '');
    judge.appendChild(eq);
    judge.appendChild(el('p', 'hf-sp__q', null, 'True or false?'));
    var mem = el('div', 'hf-sp__mem is-hid');
    var memv = el('span', 'hf-sp__memv', null, '');
    mem.appendChild(memv);
    timed.appendChild(judge);
    timed.appendChild(mem);
    stage.appendChild(timed);

    var recall = el('div', 'hf-sp__recall', { hidden: true });
    var rtitle = el('p', 'hf-sp__rtitle', { tabindex: '-1' }, '');
    var slots = el('ol', 'hf-sp__slots', { 'aria-label': 'Your answer' });
    var keys = el('div', 'hf-sp__keys', { role: 'group', 'aria-label': noun === 'letters' ? 'Letters' : 'Symbols' });
    var acts = el('div', 'hf-sp__acts');
    var bSkip = el('button', 'hf-btn hf-sp__act', { type: 'button', 'data-act': 'skip', 'aria-label': 'Skip: leave this place blank' }, 'Skip');
    var bDel = el('button', 'hf-btn hf-sp__act', { type: 'button', 'data-act': 'del', 'aria-keyshortcuts': 'Backspace' }, 'Delete');
    var bDone = el('button', 'hf-btn hf-btn--primary hf-sp__act', { type: 'button', 'data-act': 'done', 'aria-keyshortcuts': 'Enter' }, 'Done');
    acts.appendChild(bSkip);
    acts.appendChild(bDel);
    acts.appendChild(bDone);
    recall.appendChild(rtitle);
    recall.appendChild(slots);
    recall.appendChild(keys);
    recall.appendChild(acts);
    stage.appendChild(recall);

    var msg = el('div', 'hf-sp__msg', { hidden: true });
    var msgTitle = el('p', 'hf-sp__mtitle', { tabindex: '-1' }, '');
    var msgText = el('p', 'hf-sp__mtext', null, '');
    var msgActs = el('div', 'hf-sp__macts hf-actions', { hidden: true });
    var bEnd = el('button', 'hf-btn', { type: 'button', 'data-act': 'end' }, 'End block');
    var bResume = el('button', 'hf-btn hf-btn--primary', { type: 'button', 'data-act': 'resume' }, 'Resume');
    msgActs.appendChild(bEnd);
    msgActs.appendChild(bResume);
    msg.appendChild(msgTitle);
    msg.appendChild(msgText);
    msg.appendChild(msgActs);
    stage.appendChild(msg);

    v.el.appendChild(head);
    v.el.appendChild(stage);
    // the names the rule card, How to play and the lesson teach (Phase 4, UX-02)
    var P = kit.pads(ctx, [{ id: 'no', label: 'False' }, { id: 'match', label: 'True' }], 'Answer: false or true');
    var padsBox = el('div', 'hf-v__pads');
    padsBox.appendChild(P.el);
    v.el.appendChild(padsBox);
    v.pads = P.pads;
    var fb = kit.feedback(P.byKey, 'match');
    var echoOff = kit.pressEcho(P.byKey, fb.pressed);
    v.feedback = function (outcome, key) { return fb(outcome, key); };
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(v.el);

    function setMsg(title, text, withActions) {
      msgTitle.textContent = title || '';
      msgText.textContent = text || '';
      msgText.hidden = !text;
      msgActs.hidden = !withActions;
      msg.hidden = false;
    }
    function hideMsg() { msg.hidden = true; msgActs.hidden = true; }

    // ---------------------------------------------------------------- runner state
    var R = null;           // the active run (one at a time)

    function Runner(ctx2, resolve) {
      var timing = ctx2.timing || HF.timing, input = ctx2.input || HF.input;
      var trials = spec.trials || [], n = trials.length;
      var limit = spec.procLimitMs > 0 ? spec.procLimitMs : 4000;
      var memMs = spec.memMs > 0 ? spec.memMs : 1000;
      var feedbackOn = ctx.feedback === 'per-response';
      var self = this;
      var flow = null;        // HF.timing.custom(...) — owns busy, wake lock, Escape/P, page hidden, HF.timing.pause/resume/abort
      var iv = 1000 / 60, deltas = [], lastTs = null, looping = false, loopGen = 0;
      var phase = 'lead', ti = 0, steps = [], si = -1, cur = null, tl = null, timer = 0;
      var entries = [], entryRts = [], recallOnset = 0, startedAt = Date.now(), t0 = null;
      var pauseDuring = [], inTrialAtPause = false, presented = 0;
      var out = [];           // finished trial logs (absolute times until finish)
      var offs = [];

      function perf() { return kit.perfNow(); }
      function progress(ph) {
        if (typeof ctx2.onProgress === 'function') {
          try { ctx2.onProgress({ done: ti, total: n, phase: ph }); } catch (e) { if (root.console) console.error(e); }
        }
      }
      function frames(ms) { return Math.max(1, Math.round(ms / iv)); }
      function after(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }

      // ---- frame loop (flow.frame() = HF.timing.frame()) ----
      function loop() {
        if (!looping) return;
        var gen = loopGen;
        flow.frame().then(function (ts) {
          if (!looping || gen !== loopGen) return;
          onFrame(ts);
          loop();
        });
      }
      function startLoop() { if (looping) return; looping = true; loopGen++; lastTs = null; loop(); }
      function stopLoop() { looping = false; loopGen++; }

      function onFrame(ts) {
        if (lastTs !== null) {
          var d = ts - lastTs;
          deltas.push(d);
          if (d > 2.5 * iv && cur && cur.displayed && !(cur.t === 'judge' && cur.answered)) cur.stall = true;
        }
        lastTs = ts;
        if (cur && cur.needShown) {
          cur.shown = ts;
          if (ts - cur.onset > 1.5 * iv) cur.late = true;
          cur.needShown = false;
        }
        if (phase !== 'timed') return;
        var half = iv / 2;
        if (!cur) { nextStep(ts); return; }
        if (cur.t === 'judge') { if (cur.answered || ts >= cur.due - half) { endJudge(ts); nextStep(ts); } }
        else if (cur.t === 'mem') { if (ts >= cur.due - half) { endMem(ts); nextStep(ts); } }
        else if (ts >= cur.due - half) nextStep(ts);
      }

      function stepsFor(trial) {
        var list = [{ t: 'gap', ms: GAP_MS }];   // a short blank first: the panel switch is laid out before item 1
        for (var k = 0; k < trial.pairs.length; k++) {
          list.push({ t: 'judge', k: k }, { t: 'gap', ms: GAP_MS }, { t: 'mem', k: k }, { t: 'gap', ms: GAP_MS });
        }
        return list;
      }
      function prepareStep(st) {
        if (!st || st.t === 'gap') return;
        var pair = trials[ti].pairs[st.k];
        if (st.t === 'judge') eq.textContent = pair.proc.text;
        else if (st.t === 'mem') memv.textContent = String(pair.mem);
      }
      function prepareAhead() {
        for (var j = si + 1; j < steps.length; j++) if (steps[j].t !== 'gap') { prepareStep(steps[j]); return; }
      }
      function nextStep(ts) {
        si++;
        if (si >= steps.length) { cur = null; enterRecall(); return; }
        var st = steps[si];
        if (st.t === 'judge') {
          judge.classList.remove('is-hid');
          cur = { t: 'judge', k: st.k, onset: ts, shown: null, needShown: true, displayed: true, late: false, stall: false,
            due: ts + frames(limit) * iv, answered: null };
          if (t0 === null) t0 = ts;
        } else if (st.t === 'mem') {
          mem.classList.remove('is-hid');
          cur = { t: 'mem', k: st.k, onset: ts, shown: null, needShown: true, displayed: true, late: false, stall: false,
            due: ts + frames(memMs) * iv };
        } else {
          cur = { t: 'gap', due: ts + frames(st.ms) * iv, displayed: false };
          setTimeout(function () { if (R === self && phase === 'timed') prepareAhead(); }, 0);
        }
      }
      function endJudge(ts) {
        judge.classList.add('is-hid');
        var a = cur.answered;
        tl.proc[cur.k] = { resp: a ? a.resp : null, rt: a ? a.rt : null, src: a ? a.src : null, onset: cur.onset,
          shown: cur.shown, offset: ts, late: cur.late, stall: cur.stall };
        if (!a && (cur.late || cur.stall)) voidTrial(cur.late ? 'late' : 'stall');
        cur.displayed = false;
      }
      function endMem(ts) {
        mem.classList.add('is-hid');
        var on = ts - cur.onset;
        tl.mem[cur.k] = { onset: cur.onset, shown: cur.shown, offset: ts, late: cur.late, stall: cur.stall };
        if (cur.late) voidTrial('late');
        else if (Math.abs(on - memMs) > 1.5 * iv) voidTrial('stall');
        cur.displayed = false;
      }
      function voidTrial(reason) { if (tl && !tl.voided) { tl.voided = true; tl.voidReason = reason; } }

      // ---- lists ----
      function beginTrial() {
        if (phase === 'done' || phase === 'paused') return;
        var trial = trials[ti];
        hideMsg();
        v.el.classList.remove('is-recall');
        recall.hidden = true;
        timed.hidden = false;
        status.textContent = 'List ' + (ti + 1) + ' of ' + n;
        tl = { i: trial.i !== undefined ? trial.i : ti, setSize: trial.setSize || trial.pairs.length, proc: [], mem: [],
          recall: [], recallRts: [], recallMs: null, voided: false, voidReason: null };
        presented = Math.max(presented, ti + 1);
        steps = stepsFor(trial);
        si = -1;
        cur = null;
        prepareAhead();
        phase = 'timed';
        progress('list');
        startLoop();
      }

      function enterRecall() {
        stopLoop();
        phase = 'recall';
        var trial = trials[ti];
        entries = [];
        entryRts = [];
        timed.hidden = true;
        rtitle.textContent = trial.order === 'backward'
          ? 'Tap the ' + noun + ' in reverse order: the last one first.'
          : 'Tap the ' + noun + ' in the order you saw them.';
        buildKeypad(trial);
        drawSlots();
        v.el.classList.add('is-recall');
        recall.hidden = false;
        recallOnset = perf();
        try { rtitle.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        progress('recall');
      }

      var keypadFor = null;
      function buildKeypad(trial) {
        var symbols = trial.recallKeypad || [];
        var sig = symbols.join('');
        if (keypadFor === sig) return;
        keypadFor = sig;
        while (keys.firstChild) keys.removeChild(keys.firstChild);
        for (var i = 0; i < symbols.length; i++) {
          keys.appendChild(el('button', 'hf-sp__key', { type: 'button', 'data-sym': symbols[i] }, symbols[i]));
        }
      }
      function drawSlots() {
        var size = tl.setSize, html = '';
        for (var i = 0; i < size; i++) {
          var has = i < entries.length, sy = has ? entries[i] : null;
          var cls = 'hf-sp__slot' + (has ? ' is-full' : '') + (has && sy === null ? ' is-blank' : '') + (i === entries.length ? ' is-next' : '');
          var txt = has ? (sy === null ? '–' : kit.esc(sy)) : '';
          var lab = 'Place ' + (i + 1) + ': ' + (has ? (sy === null ? 'blank' : kit.esc(sy)) : 'empty');
          html += '<li class="' + cls + '" aria-label="' + lab + '">' + txt + '</li>';
        }
        slots.innerHTML = html;
      }
      function add(sym) {
        if (phase !== 'recall' || entries.length >= tl.setSize) return;
        entries.push(sym);
        entryRts.push(r2(perf() - recallOnset));
        drawSlots();
      }
      function del() {
        if (phase !== 'recall' || !entries.length) return;
        entries.pop();
        entryRts.pop();
        drawSlots();
      }
      function done() {
        if (phase !== 'recall') return;
        tl.recall = entries.slice();
        tl.recallRts = entryRts.slice();
        tl.recallMs = r2(perf() - recallOnset);
        out.push(tl);
        var last = tl;
        tl = null;
        recall.hidden = true;
        v.el.classList.remove('is-recall');
        ti++;
        progress('done');
        if (ti >= n) { finish(false); return; }
        between(last);
      }
      function between(last) {
        phase = 'between';
        timed.hidden = true;
        var text = '';
        if (feedbackOn && last && !last.voided) {
          var trial = trials[ti - 1], want = expectedOf(trial), inPlace = 0, right = 0;
          for (var k = 0; k < want.length; k++) if (last.recall[k] !== undefined && last.recall[k] === want[k]) inPlace++;
          for (var j = 0; j < trial.pairs.length; j++) {
            var pr = last.proc[j];
            if (pr && pr.resp === !!trial.pairs[j].proc.correct) right++;
          }
          text = inPlace + ' of ' + want.length + ' in the right place · sums: ' + right + ' of ' + trial.pairs.length + ' right';
        }
        status.textContent = 'List ' + (ti + 1) + ' of ' + n;
        setMsg('List ' + (ti + 1) + ' of ' + n, text, false);
        after(BETWEEN_MS, beginTrial);
      }

      // ---- recall keyboard (capture phase: typed letters F/J/K/P never reach HF.input as answers or pause, and
      //      Space on a focused keypad button stays a native press although the block is busy) ----
      function symFromKey(k) {
        var list = trials[ti] && trials[ti].recallKeypad;
        if (!list) return null;
        for (var i = 0; i < list.length; i++) {
          var sy = String(list[i]);
          if (sy === k || (sy.length === 1 && sy.toLowerCase() === k.toLowerCase())) return sy;
        }
        return null;
      }
      function onKeyCapture(e) {
        if (phase !== 'recall' || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
        if (HF.dom && HF.dom.openModals && HF.dom.openModals() > 0) return;
        var k = e.key, tg = e.target && e.target.tagName;
        if (e.code === 'Space' || k === ' ') {
          if (tg === 'BUTTON' && recall.contains(e.target)) e.stopImmediatePropagation();
          return;
        }
        if (k === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) del(); return; }
        if (k === 'Enter') {
          if (tg === 'BUTTON' || tg === 'A') return;     // the focused button's own click handles it
          e.preventDefault(); e.stopImmediatePropagation();
          if (!e.repeat) done();
          return;
        }
        if (k && k.length === 1) {
          var sy = symFromKey(k);
          if (sy === null) return;
          e.preventDefault(); e.stopImmediatePropagation();
          if (!e.repeat) add(sy);
        }
      }
      // a mouse/touch press must not move focus to the keypad, or Enter would re-press that key instead of Done
      // (keyboard users still Tab to the keys and press them with Enter or Space)
      function onRecallMouseDown(e) {
        var t = e.target && e.target.closest ? e.target.closest('button') : null;
        if (t && recall.contains(t)) e.preventDefault();
      }
      function onRecallClick(e) {
        var t = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!t || !recall.contains(t)) return;
        var sy = t.getAttribute('data-sym');
        if (sy !== null) { add(sy); return; }
        var act = t.getAttribute('data-act');
        if (act === 'skip') add(null);
        else if (act === 'del') del();
        else if (act === 'done') done();
      }
      function onMsgClick(e) {
        var t = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!t) return;
        var act = t.getAttribute('data-act');
        if (act === 'resume') self.resume();
        else if (act === 'end') self.abort('end');
      }

      // ---- answers (Escape/P, page hidden and pagehide reach onFlowPause through HF.timing.custom) ----
      function onInput(ev) {
        if (phase !== 'timed' || !cur || cur.t !== 'judge' || cur.answered) return;
        if (ev.key !== 'match' && ev.key !== 'no') return;
        if (!(ev.t >= cur.onset)) return;
        cur.answered = { resp: ev.key === 'match', rt: r2(ev.t - cur.onset), src: ev.src || null };
        if (feedbackOn) {
          var right = !!trials[ti].pairs[cur.k].proc.correct === cur.answered.resp;
          fb(right ? 'good' : 'bad', ev.key);
        }
      }

      // ---- flow handlers: called by the core once per paused period (a second pause only appends a reason) ----
      function onFlowPause(info) {
        if (phase === 'done' || phase === 'paused') return;
        var was = phase;
        stopLoop();
        clearTimeout(timer);
        inTrialAtPause = was === 'timed' || was === 'recall';
        if (inTrialAtPause && tl) {
          if (cur && cur.t === 'judge' && cur.displayed) {
            tl.proc[cur.k] = { resp: null, rt: null, src: null, onset: cur.onset, shown: cur.shown, offset: perf(), late: cur.late, stall: cur.stall };
          }
          voidTrial('pause');
          out.push(tl);
          tl = null;
        }
        cur = null;
        judge.classList.add('is-hid');
        mem.classList.add('is-hid');
        recall.hidden = true;
        timed.hidden = true;
        v.el.classList.remove('is-recall');
        v.el.classList.add('is-paused');
        phase = 'paused';
        pauseDuring.push(was);
        var reason = (info && info.reason) || 'pause';
        var mine = { kind: 'span', reason: reason, at: t0 === null ? null : r2(perf() - t0), voided: inTrialAtPause };
        if (typeof ctx2.onPause === 'function') {
          hideMsg();
          try { ctx2.onPause(mine); } catch (e) { if (root.console) console.error(e); }
        } else {
          setMsg('Paused', inTrialAtPause ? 'This list will not count. The next list starts when you continue.'
            : 'Nothing is lost. The next list starts when you continue.', true);
          try { bResume.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
        }
      }
      function onFlowResume() {
        if (phase !== 'paused') return;
        v.el.classList.remove('is-paused');
        if (inTrialAtPause) ti++;
        inTrialAtPause = false;
        phase = 'between';
        if (ti >= n) { finish(false); return; }
        status.textContent = 'List ' + (ti + 1) + ' of ' + n;
        setMsg('Get ready', 'List ' + (ti + 1) + ' of ' + n, false);
        after(RESUME_MS, beginTrial);
      }
      function onFlowAbort() {
        if (phase === 'done') return;
        stopLoop();
        clearTimeout(timer);
        if (tl) { voidTrial('abort'); out.push(tl); tl = null; ti++; }
        else if (inTrialAtPause) ti++;
        inTrialAtPause = false;
        phase = 'aborting';
        // the core ends the flow right after this handler returns; build the log once it has
        Promise.resolve().then(function () { finish(true); });
      }

      this.pause = function (reason) { return flow ? flow.pause(reason || 'pause') : false; };
      this.resume = function () { return flow ? flow.resume() : false; };
      this.abort = function (reason) { return flow ? flow.abort(reason || 'abort') : false; };

      function finish(isAbort) {
        if (phase === 'done') return;
        phase = 'done';
        stopLoop();
        clearTimeout(timer);
        var fl = flow ? flow.end() : null;          // idempotent; releases busy, keys and the wake lock
        for (var i = 0; i < offs.length; i++) offs[i]();
        offs = [];
        judge.classList.add('is-hid');
        mem.classList.add('is-hid');
        recall.hidden = true;
        v.el.classList.remove('is-recall');
        v.el.classList.remove('is-paused');
        if (isAbort) {
          for (var j = ti; j < n; j++) {
            var tr = trials[j];
            out.push({ i: tr.i !== undefined ? tr.i : j, setSize: tr.setSize || tr.pairs.length, proc: [], mem: [], recall: [],
              recallRts: [], recallMs: null, voided: true, voidReason: 'not-presented' });
          }
          setMsg('Block ended', '', false);
        } else hideMsg();
        var base = t0 !== null ? t0 : (fl ? fl.t0 : 0);
        function rel(x) { return typeof x === 'number' ? r2(x - base) : null; }
        var late = [], stall = [];
        var trialsOut = out.map(function (t) {
          var anyLate = false, anyStall = false;
          var proc = t.proc.map(function (p) {
            if (!p) return { resp: null, rt: null, src: null, onset: null, shown: null, offset: null, late: false, stall: false };
            anyLate = anyLate || p.late; anyStall = anyStall || p.stall;
            return { resp: p.resp, rt: p.rt, src: p.src, onset: rel(p.onset), shown: rel(p.shown), offset: rel(p.offset), late: !!p.late, stall: !!p.stall };
          });
          var memo = t.mem.map(function (m) {
            if (!m) return { onset: null, shown: null, offset: null, late: false, stall: false };
            anyLate = anyLate || m.late; anyStall = anyStall || m.stall;
            return { onset: rel(m.onset), shown: rel(m.shown), offset: rel(m.offset), late: !!m.late, stall: !!m.stall };
          });
          if (anyLate) late.push(t.i);
          if (anyStall) stall.push(t.i);
          return { i: t.i, setSize: t.setSize, proc: proc, mem: memo, recall: t.recall, recallRts: t.recallRts,
            recallMs: t.recallMs, voided: !!t.voided, voidReason: t.voidReason || null };
        });
        trialsOut.sort(function (a, b) { return a.i - b.i; });
        var stats = timing && typeof timing.frameStats === 'function'
          ? timing.frameStats(deltas, iv, timing.lowPrecision)
          : { fps: null, medianMs: null, maxMs: null, stalls: 0, lowPrecision: false };
        // pauses come from the flow (first start kept, reasons appended), moved to this log's time base
        var pz = ((fl && fl.pauses) || []).map(function (p, k) {
          return { start: r2(fl.t0 + p.start - base), end: p.end === null ? null : r2(fl.t0 + p.end - base), reasons: p.reasons,
            during: pauseDuring[k] || null };
        });
        var log = {
          kind: 'span', trials: trialsOut, paused: pz.length > 0, pauses: pz, aborted: !!isAbort,
          abortReason: fl && fl.abortReason || null, n: n, presented: presented, procLimitMs: limit, memMs: memMs,
          interval: r2(iv), frame: stats, flags: { late: late, stall: stall }, startedAt: startedAt,
          t0: t0 === null ? null : r2(t0)
        };
        R = null;
        resolve(log);
      }

      this.start = function () {
        if (!timing || typeof timing.custom !== 'function') throw new Error('HF.views.span needs HF.timing.custom (js/core/timing.js)');
        flow = timing.custom({ pause: onFlowPause, resume: onFlowResume, abort: onFlowAbort }, { kind: 'span' });  // throws if a block runs
        offs.push(input && input.on ? input.on(onInput) : function () {});
        root.addEventListener('keydown', onKeyCapture, true);
        recall.addEventListener('click', onRecallClick);
        recall.addEventListener('mousedown', onRecallMouseDown);
        msg.addEventListener('click', onMsgClick);
        offs.push(function () {
          root.removeEventListener('keydown', onKeyCapture, true);
          recall.removeEventListener('click', onRecallClick);
          recall.removeEventListener('mousedown', onRecallMouseDown);
          msg.removeEventListener('click', onMsgClick);
        });
        if (!n) { finish(false); return; }
        status.textContent = 'List 1 of ' + n;
        setMsg('List 1 of ' + n, '', false);
        timed.hidden = true;
        var t = perf();
        var measured = typeof timing.measureFrameInterval === 'function'
          ? timing.measureFrameInterval({ frames: 30 }) : Promise.resolve(1000 / 60);
        measured.then(function (ms) {
          iv = ms > 0 ? ms : 1000 / 60;
          var wait = Math.max(0, LEAD_MS - (perf() - t));
          if (phase === 'lead') after(wait, function () { if (phase === 'lead') beginTrial(); });
        });
      };
      this.state = function () { return phase === 'aborting' ? 'done' : phase; };
    }

    // ---------------------------------------------------------------- public API
    v.run = function (ctx2) {
      if (R) return Promise.reject(new Error('HF.views.span: a run is already active'));
      return new Promise(function (resolve, reject) {
        var r = new Runner(ctx2 || {}, resolve);
        R = r;
        try { r.start(); } catch (e) { R = null; reject(e); }
      });
    };
    v.pause = function (reason) { return R ? R.pause(reason || 'pause') : false; };
    v.resume = function () { return R ? R.resume() : false; };
    v.abort = function () { return R ? R.abort('abort') : false; };
    v.state = function () { return R ? R.state() : 'idle'; };
    v.destroy = function () {
      if (R) R.abort('destroy');
      fb.cancel();
      echoOff();
      if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
      v.pads = [];
    };
    return v;
  }

  views.span = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
