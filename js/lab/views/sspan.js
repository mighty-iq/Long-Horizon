/* Long-Horizon — Lab view kit (HF.labKit) + spatial complex span view (HF.views['lab.sspan']). Browser only, ES2019, MIT.
   Owner: P2 (Lab UI). Notes: docs/dev/lab-ui-notes.md.

   Why the kit lives here: this is the first Lab view file in js/manifest.json, and the manifest is owned by the
   orchestrator. Every other Lab view (and js/ui/labvisit.js) reads HF.labKit at call time, never at load time.

   HF.labKit (K) — shared by the custom Lab views (contracts-ui §1 "custom flows"):
     h(tag, attrs, kids), svg(tag, attrs, kids)     element builders (HF.ui.c.h / svg, else HF.dom.el / svg)
     clear(node), perfNow(), frame() → Promise<rAF ts> (HF.timing.frame), ensureInterval() → Promise<ms>
     keys(fn) → off      window keydown (no repeats, no chords, nothing while a dialog is open); fn(e, t)
     digitOf(e) → 1–9 | null,  letterOf(e) → 'A'–'Z' | null
     session({ kind }) → S   pause / stop / void bookkeeping for one run, on the core custom flow HF.timing.custom
                         (busy + html[data-busy] while it runs; Escape/P, page hidden, pagehide, HF.timing.pause/abort
                         routed to it; first pause start kept, later reasons appended); own listeners only as a fallback.
        S.pause(reason)  the trial in progress is cancelled → it resolves K.VOID; the pause dialog opens on the next
                         task (Resume / Stop the visit). Extra triggers: Escape inside a text field, the Pause button.
        S.resume(), S.stop(), S.ready() → Promise (resolves once not paused), S.trial(fn(ctl)) → Promise<result|VOID|STOP>,
        S.wait(ms) → Promise (cut short by a pause), S.log() → { paused, pauses: [{ start, end, reasons }] }, S.destroy()
     present(S, show, hide, ms) → Promise<{ onset, shown, offset, voided, late, stalls, maxGap } | VOID>   frame-counted
                         display (SPEC-core): show/hide inside rAF, due times from the measured frame interval, so a dropped
                         frame never lengthens the item by more than the drop. Voided when the first paint was late
                         (> 1.5 frames), a freeze > 250 ms happened, or the display ran off its length by more than
                         max(2.5 frames, 10 %). DEVIATION from the stream rule (any gap > 2.5 frames voids): these displays
                         last 1–2.8 s, and one 40-ms hiccup would void most updating trials on ordinary laptops; every
                         gap > 2.5 frames is still counted (stalls, maxGap) in the trial log for a stricter analysis.
     frameUI(root, { title, onPause }) → { el, bar, stage, answer, msg, hint, setProgress(text), clock(...) }
     countdown(frameUI, ms, { warnMs, warnText }) → { start(), stop() }   calm, once-per-second text + bar
     patch(entry, { size, label }) → SVG colour patch with its redundant pattern (HF.lab.PALETTE entries)
     cellGrid(n, { label, cellLabel(i), onPick(i, e) }) → { el, cells, enable(bool), mark(i, cls, on), focus(i) }
                         (arrows move, Enter/Space pick — explicit, since a busy flow cancels Space's native activation)
     waitNext(container, label) → Promise   practice "Next" button: click, Enter or Space
     pauseDialog(S)       Resume / Stop the visit (HF.dom.modal; Escape = Resume)
     VOID, STOP           sentinels returned by S.trial

   HF.views['lab.sspan'].create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }
     spec: lab.sspan TestSpec (js/lab/tests/sspan.js). Per trial: for each pair a symmetry judgement (self-paced,
     procLimitMs cap; F = not symmetric, J = symmetric; touch pads) then one cell of a 4×4 grid shown memMs (frame
     counted); then recall: tap the cells in order (Skip keeps positions, Undo, Done; arrow keys + Space/Enter too).
     log (SPEC §4.4): { trials: [ { i, proc: [ { resp: true|false|null, rt } ], recall: [cell|null…], voided } ],
                        paused, pauses, aborted }
     Pausing voids the trial in progress (the whole set). Practice specs (spec.practice) show feedback after each
     judgement and after recall; scored runs show none.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  HF.views = HF.views || {};

  /* =============================================================== HF.labKit */
  var K = HF.labKit || (HF.labKit = {});
  var VOID = K.VOID || { voided: true, sentinel: 'void' };
  var STOP = K.STOP || { stopped: true, sentinel: 'stop' };
  K.VOID = VOID;
  K.STOP = STOP;

  function C() { return HF.ui && HF.ui.c; }
  function h(tag, attrs, kids) {
    if (C()) return C().h(tag, attrs, kids);
    return HF.dom.el(tag, attrs, kids);
  }
  function svg(tag, attrs, kids) {
    tag = String(tag).replace(/^svg:/, '');   // HF.ui.c.svg always uses the SVG namespace ('text', 'title' are fine)
    if (C()) return C().svg(tag, attrs, kids);
    return HF.dom.svg(tag, attrs, kids);
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function frame() {
    if (HF.timing && typeof HF.timing.frame === 'function') return HF.timing.frame();
    return new Promise(function (r) { root.requestAnimationFrame(r); });
  }
  function ensureInterval() {
    var t = HF.timing;
    if (t && t.interval > 3 && t.interval < 100) return Promise.resolve(t.interval);
    if (t && typeof t.measureFrameInterval === 'function') {
      return t.measureFrameInterval({ frames: 24, maxMs: 1200 }).then(function (ms) { return ms > 3 && ms < 100 ? ms : 1000 / 60; });
    }
    return Promise.resolve(1000 / 60);
  }
  function modalOpen() { return !!(HF.dom && HF.dom.openModals && HF.dom.openModals() > 0); }
  function evTime(e) { return HF.input && HF.input.time ? HF.input.time(e) : perfNow(); }

  function keys(fn) {
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (modalOpen()) return;
      fn(e, evTime(e));
    }
    root.addEventListener('keydown', onKey);
    return function () { root.removeEventListener('keydown', onKey); };
  }
  function digitOf(e) {
    var m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (m) return +m[1];
    if (e.key && /^[1-9]$/.test(e.key)) return +e.key;
    return null;
  }
  function letterOf(e) {
    var m = /^Key([A-Z])$/.exec(e.code || '');
    if (m) return m[1];
    return null;
  }
  function isTyping(e) {
    var t = e && e.target;
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && ['text', 'search', 'number', 'tel', 'email', 'url', 'password'].indexOf((t.type || 'text').toLowerCase()) >= 0);
  }

  /* ---------- pause dialog ---------- */
  /** Opens the dialog on the next task: a pause triggered by the Escape keydown must not open a modal dialog while
      that keydown is still being dispatched, or the browser's own Escape "close request" cancels it at once.
      Returns a handle { isOpen, close(value) } (null without HF.dom.modal). */
  function pauseDialog(S) {
    if (!HF.dom || typeof HF.dom.modal !== 'function') return null;
    var proxy = { isOpen: true, real: null, close: function (v) {
      if (!proxy.isOpen) return;
      if (proxy.real) { proxy.real.close(v); return; }
      proxy.isOpen = false;
      clearTimeout(timer);
    } };
    var timer = setTimeout(function () {
      if (!proxy.isOpen) return;
      proxy.real = openPauseDialog(S, function () { proxy.isOpen = false; });
      if (!proxy.real) proxy.isOpen = false;
    }, 0);
    return proxy;
  }
  function openPauseDialog(S, onGone) {
    var choice = null, handle = null;
    var resumeBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary', 'data-autofocus': '' }, [h('span', { 'class': 'hf-btn__label' }, ['Resume'])]);
    var stopBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--secondary' }, [h('span', { 'class': 'hf-btn__label' }, ['Stop the visit'])]);
    resumeBtn.addEventListener('click', function () { choice = 'resume'; if (handle) handle.close('resume'); });
    stopBtn.addEventListener('click', function () {
      var ask = HF.dom.confirm ? HF.dom.confirm('Tests you finished are saved. The test you are in now will not count, and you can do it again later in this visit’s time window.', { title: 'Stop the visit?', ok: 'Stop', cancel: 'Keep going' }) : Promise.resolve(true);
      ask.then(function (yes) { if (yes) { choice = 'stop'; if (handle) handle.close('stop'); } });
    });
    handle = HF.dom.modal([
      h('p', { 'class': 'hf-modal__text' }, [S.pauseText || 'The item you were on will not count. Take your time.']),
      h('div', { 'class': 'hf-modal__actions' }, [stopBtn, resumeBtn])
    ], {
      title: 'Paused', className: 'hf-modal--lab-pause', initialFocus: resumeBtn,
      onClose: function (v) {
        onGone();
        if (v === 'destroy' || v === 'done') return;
        if ((v || choice) === 'stop') S.stop(); else S.resume();
      }
    });
    return handle;
  }

  /* ---------- session: pause / stop / void ---------- */
  /** One run of a custom Lab view. Backed by the core custom flow (HF.timing.custom) when available: while it runs,
      HF.timing.busy and <html data-busy> are set (saves and toasts wait), the wake lock is held, and Escape/P, page
      hidden, pagehide and HF.timing.pause/resume/abort reach this session; the core keeps the first pause start and
      only appends later reasons. Without the core API (or if another run is active) the session listens itself.
      S.pause(reason) / S.resume() / S.stop() drive the flow; the core calls back into onPause/onResume/onStop. */
  function session(opts) {
    opts = opts || {};
    var S = { paused: false, stopped: false, pauses: [], cur: null, pauseText: opts.pauseText || null, flow: null };
    var waiters = [], offs = [], dlg = null, flowLog = null;
    function flush() { var w = waiters.splice(0); for (var i = 0; i < w.length; i++) w[i](); }

    function onPause(reason) {                     // first pause only (the core appends later reasons itself)
      if (S.stopped) return false;
      if (S.paused) { var p0 = S.pauses[S.pauses.length - 1]; if (p0) p0.reasons.push(reason || 'pause'); return true; }
      S.paused = true;
      S.pauses.push({ start: perfNow(), end: null, reasons: [reason || 'pause'] });
      if (S.cur) S.cur.cancel('pause');
      if (typeof opts.onPause === 'function') { try { opts.onPause(reason); } catch (e) { if (root.console) console.error(e); } }
      if (opts.dialog !== false) dlg = pauseDialog(S);
      return true;
    }
    function onResume() {
      if (!S.paused || S.stopped) return false;
      S.paused = false;
      var p = S.pauses[S.pauses.length - 1];
      if (p && p.end === null) p.end = perfNow();
      dlg = null;
      if (typeof opts.onResume === 'function') { try { opts.onResume(); } catch (e) { if (root.console) console.error(e); } }
      flush();
      return true;
    }
    function onStop() {
      if (S.stopped) return false;
      S.stopped = true;
      if (S.paused) { var p = S.pauses[S.pauses.length - 1]; if (p && p.end === null) p.end = perfNow(); }
      S.paused = false;
      if (S.cur) S.cur.cancel('stop');
      if (dlg && dlg.isOpen) { try { dlg.close('stop'); } catch (e) { /* ignore */ } }
      dlg = null;
      flush();
      return true;
    }

    if (HF.timing && typeof HF.timing.custom === 'function') {
      try {
        S.flow = HF.timing.custom({
          pause: function (info) { onPause(info && info.reason); },
          resume: function () { onResume(); },
          abort: function () { onStop(); }
        }, { kind: opts.kind || 'lab', wakeLock: true });
      } catch (e) { S.flow = null; if (root.console) console.warn('[long-horizon] Lab view runs without HF.timing.custom: ' + (e && e.message)); }
    }

    S.pause = function (reason) {
      if (S.flow && S.flow.active) return S.flow.pause(reason || 'pause');
      return onPause(reason);
    };
    S.resume = function () {
      if (S.flow && S.flow.active) return S.flow.resume();
      return onResume();
    };
    S.stop = function () {
      if (S.flow && S.flow.active) { S.flow.abort('stop'); return true; }
      return onStop();
    };
    S.ready = function () {
      if (!S.paused || S.stopped) return Promise.resolve(!S.stopped);
      return new Promise(function (res) { waiters.push(function () { res(!S.stopped); }); });
    };
    S.trial = function (fn) {
      return new Promise(function (resolve) {
        var finished = false, cleanups = [];
        var ctl = {
          cancelled: null,
          onCancel: function (cb) { cleanups.push(cb); },
          done: function (result) {
            if (finished) return;
            finished = true;
            if (S.cur === ctl) S.cur = null;
            resolve(result);
          },
          cancel: function (reason) {
            if (finished) return;
            ctl.cancelled = reason;
            for (var i = 0; i < cleanups.length; i++) { try { cleanups[i](reason); } catch (e) { if (root.console) console.error(e); } }
            ctl.done(reason === 'stop' ? STOP : VOID);
          }
        };
        S.cur = ctl;
        if (S.stopped) { ctl.done(STOP); return; }
        if (S.paused) { ctl.done(VOID); return; }
        try { fn(ctl); } catch (e) { if (root.console) console.error(e); ctl.done(VOID); }
      });
    };
    S.wait = function (ms) {
      return new Promise(function (res) {
        var t = setTimeout(done, Math.max(0, ms));
        var poll = setInterval(function () { if (S.paused || S.stopped) done(); }, 50);
        function done() { clearTimeout(t); clearInterval(poll); res(); }
      });
    };
    /** ends the core flow (releases busy) and returns { paused, pauses: [{ start, end, reasons }] } (ms from the start) */
    S.log = function () {
      if (S.flow) {
        if (!flowLog) flowLog = S.flow.end();
        if (flowLog) return { paused: !!flowLog.paused, pauses: (flowLog.pauses || []).map(function (p) { return { start: Math.round(p.start), end: p.end === null ? null : Math.round(p.end), reasons: p.reasons.slice() }; }) };
      }
      var t0 = S.t0 || 0;
      return {
        paused: S.pauses.length > 0,
        pauses: S.pauses.map(function (p) { return { start: Math.round(p.start - t0), end: p.end === null ? null : Math.round(p.end - t0), reasons: p.reasons.slice() }; })
      };
    };
    S.t0 = perfNow();
    if (!S.flow) {
      // fallback triggers (the core flow routes these itself)
      if (HF.input && typeof HF.input.on === 'function') {
        offs.push(HF.input.on(function (ev) { if (ev.key === 'pause') S.pause('key'); }));
      }
      var onVis = function () { if (doc.visibilityState === 'hidden') S.pause('hidden'); };
      var onHide = function () { S.pause('pagehide'); };
      doc.addEventListener('visibilitychange', onVis);
      root.addEventListener('pagehide', onHide);
      offs.push(function () { doc.removeEventListener('visibilitychange', onVis); root.removeEventListener('pagehide', onHide); });
    }
    if (S.flow && HF.input && typeof HF.input.on === 'function') {
      // while the flow is busy HF.input cancels Space's native button activation; give it back to the frame's
      // action buttons (Undo, Skip one, Done, Confirm, Next, Pause) — option tiles and cells handle their own keys
      offs.push(HF.input.on(function (ev) {
        if (ev.key !== 'next' || ev.src !== 'key') return;
        var a = doc.activeElement;
        if (a && a.classList && a.classList.contains('hf-btn') && !a.disabled && a.closest && a.closest('.hf-lt')) a.click();
      }));
    }
    // Escape inside a text field never reaches HF.input; handle it here (both modes).
    function onKey(e) {
      if ((e.key === 'Escape' || e.code === 'Escape') && isTyping(e) && !modalOpen()) { e.preventDefault(); S.pause('key'); }
    }
    root.addEventListener('keydown', onKey);
    offs.push(function () { root.removeEventListener('keydown', onKey); });
    S.destroy = function () {
      offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
      if (S.flow && S.flow.active) { try { flowLog = S.flow.end(); } catch (e) { /* ignore */ } }
      if (dlg && dlg.isOpen) { try { dlg.close('destroy'); } catch (e) { /* ignore */ } }
      dlg = null;
    };
    return S;
  }

  /** A "Next" button (practice feedback): resolves on its click, or Enter / Space anywhere. During a custom flow
      HF.input cancels Space's native button activation (busy), so the keys are handled here explicitly. */
  function waitNext(container, label) {
    var btn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary' }, [h('span', { 'class': 'hf-btn__label' }, [label || 'Next'])]);
    container.appendChild(btn);
    try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
    return new Promise(function (resolve) {
      var done = false;
      var off = keys(function (e) {
        if (e.key !== 'Enter' && e.code !== 'Space' && e.key !== ' ') return;
        if (e.target && e.target !== btn && e.target !== doc.body && e.target.closest && e.target.closest('input, textarea, select')) return;
        e.preventDefault();
        go();
      });
      function go() { if (done) return; done = true; off(); btn.disabled = true; resolve(); }
      btn.addEventListener('click', go);
    });
  }

  /* ---------- frame-counted presentation ---------- */
  function present(S, show, hide, ms, interval) {
    interval = interval > 3 ? interval : 1000 / 60;
    var frames = Math.max(1, Math.round(ms / interval));
    return S.trial(function (ctl) {
      var onset = null, shown = null, last = null, late = false, on = false, stalls = 0, maxGap = 0;
      ctl.onCancel(function () { if (on) { try { hide(); } catch (e) { /* ignore */ } on = false; } });
      function step(ts) {
        if (ctl.cancelled) return;
        if (onset === null) {
          show(); on = true; onset = ts; last = ts;
          frame().then(step);
          return;
        }
        if (shown === null) { shown = ts; if (ts - onset > 1.5 * interval) late = true; }
        var gap = ts - last;
        if (gap > maxGap) maxGap = gap;
        if (gap > 2.5 * interval) stalls++;
        last = ts;
        if (ts >= onset + frames * interval - interval / 2) {
          hide(); on = false;
          var off = Math.abs((ts - onset) - frames * interval) > Math.max(2.5 * interval, 0.1 * ms);
          ctl.done({ onset: onset, shown: shown, offset: ts, late: late, stalls: stalls, maxGap: Math.round(maxGap * 10) / 10,
            voided: late || maxGap > 250 || off });
          return;
        }
        frame().then(step);
      }
      frame().then(step);
    });
  }

  /* ---------- the standard test frame ---------- */
  function frameUI(rootEl, o) {
    o = o || {};
    var progress = h('span', { 'class': 'hf-lt__progress' }, [o.progress || '']);
    var title = h('span', { 'class': 'hf-lt__title' }, [o.title || '']);
    var clockSlot = h('span', { 'class': 'hf-lt__clockslot' });
    var pauseBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--quiet hf-btn--sm hf-lt__pause', 'aria-keyshortcuts': 'Escape' }, [
      C() ? C().icon('pause') : null, h('span', { 'class': 'hf-btn__label' }, ['Pause'])
    ]);
    if (typeof o.onPause === 'function') pauseBtn.addEventListener('click', function () { o.onPause('button'); });
    var bar = h('div', { 'class': 'hf-lt__bar' }, [h('span', { 'class': 'hf-lt__where' }, [title, progress]), clockSlot, pauseBtn]);
    var stage = h('div', { 'class': 'hf-lt__stage' });
    var answer = h('div', { 'class': 'hf-lt__answer' });
    var msg = h('p', { 'class': 'hf-lt__msg', role: 'status', 'aria-live': 'polite' });
    var hint = h('p', { 'class': 'hf-lt__hint' });
    var el = h('div', { 'class': 'hf-lt hf-task' + (o.cls ? ' ' + o.cls : ''), 'data-test': o.test || null }, [bar, stage, answer, msg, hint]);
    rootEl.appendChild(el);
    return {
      el: el, bar: bar, stage: stage, answer: answer, msg: msg, hint: hint, clockSlot: clockSlot, pauseBtn: pauseBtn,
      setProgress: function (t) { progress.textContent = t || ''; },
      setTitle: function (t) { title.textContent = t || ''; },
      say: function (t, tone) { msg.textContent = t || ''; if (tone) msg.setAttribute('data-tone', tone); else msg.removeAttribute('data-tone'); },
      setHint: function (t) { hint.textContent = t || ''; }
    };
  }

  /* ---------- calm countdown ---------- */
  function countdown(F, ms, o) {
    o = o || {};
    var txt = h('span', { 'class': 'hf-lt__clock hf-num', 'aria-hidden': 'true' });
    var fill = h('span', { 'class': 'hf-lt__clockfill' });
    var track = h('span', { 'class': 'hf-lt__clockbar', 'aria-hidden': 'true' }, [fill]);
    var sr = h('span', { 'class': 'hf-vh', role: 'status', 'aria-live': 'polite' });
    var wrap = h('span', { 'class': 'hf-lt__countdown' }, [track, txt, sr]);
    clear(F.clockSlot);
    F.clockSlot.appendChild(wrap);
    var timer = null, t0 = 0, warned = false;
    function paint() {
      var left = Math.max(0, ms - (perfNow() - t0));
      var s = Math.ceil(left / 1000);
      txt.textContent = s + ' s';
      fill.style.transform = 'scaleX(' + (left / ms).toFixed(3) + ')';
      if (o.warnMs && !warned && perfNow() - t0 >= o.warnMs) {
        warned = true;
        wrap.classList.add('is-warn');
        sr.textContent = o.warnText || (Math.round((ms - o.warnMs) / 1000) + ' seconds left');
        if (typeof o.onWarn === 'function') o.onWarn();
      }
    }
    return {
      el: wrap,
      start: function (onset) {
        t0 = typeof onset === 'number' ? onset : perfNow();
        warned = false; wrap.classList.remove('is-warn'); sr.textContent = '';
        paint();
        clearInterval(timer);
        timer = setInterval(paint, 250);
      },
      stop: function () { clearInterval(timer); timer = null; },
      remove: function () { clearInterval(timer); timer = null; if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  /* ---------- colour patches (colour + pattern + name) ---------- */
  function lum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    var v = parseInt(m[1], 16), ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(function (x) {
      x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  var PATTERNS = {
    dots: function () {
      var out = [];
      [22, 50, 78].forEach(function (y) { [22, 50, 78].forEach(function (x) { out.push(svg('circle', { cx: x, cy: y, r: 7.5 })); }); });
      return out;
    },
    stripes: function () {
      return [svg('path', { d: 'M-10 30L30 -10M-10 70L70 -10M-10 110L110 -10M30 110L110 30M70 110L110 70', fill: 'none', 'stroke-width': 9 })];
    },
    checks: function () {
      var out = [];
      for (var r = 0; r < 4; r++) for (var c2 = 0; c2 < 4; c2++) if ((r + c2) % 2 === 0) out.push(svg('rect', { x: c2 * 25, y: r * 25, width: 25, height: 25 }));
      return out;
    },
    rings: function () {
      return [svg('circle', { cx: 50, cy: 50, r: 33, fill: 'none', 'stroke-width': 8 }), svg('circle', { cx: 50, cy: 50, r: 14, fill: 'none', 'stroke-width': 8 })];
    },
    waves: function () {
      return [svg('path', { d: 'M0 28q12.5 -14 25 0t25 0t25 0t25 0M0 56q12.5 -14 25 0t25 0t25 0t25 0M0 84q12.5 -14 25 0t25 0t25 0t25 0', fill: 'none', 'stroke-width': 7 })];
    },
    cross: function () {
      return [svg('path', { d: 'M14 14L86 86M86 14L14 86', fill: 'none', 'stroke-width': 11, 'stroke-linecap': 'round' })];
    },
    zigzag: function () {
      return [svg('path', { d: 'M0 38L16 22L33 38L50 22L67 38L83 22L100 38M0 78L16 62L33 78L50 62L67 78L83 62L100 78', fill: 'none', 'stroke-width': 7, 'stroke-linejoin': 'round' })];
    }
  };
  function patch(entry, o) {
    o = o || {};
    entry = entry || { hex: '#999999', pattern: 'dots', name: 'grey' };
    var ink = lum(entry.hex) < 0.18 ? 'rgba(255,255,255,.82)' : 'rgba(0,0,0,.58)';
    var pat = PATTERNS[entry.pattern] ? PATTERNS[entry.pattern]() : [];
    var g = svg('g', { fill: ink, stroke: ink }, pat);
    var node = svg('svg', {
      viewBox: '0 0 100 100', 'class': 'hf-patch' + (o.cls ? ' ' + o.cls : ''), focusable: 'false',
      role: o.label ? 'img' : null, 'aria-label': o.label ? (entry.name + ' with ' + entry.pattern) : null,
      'aria-hidden': o.label ? null : 'true', preserveAspectRatio: 'xMidYMid meet'
    }, [svg('rect', { x: 0, y: 0, width: 100, height: 100, fill: entry.hex }), g, svg('rect', { x: 1.5, y: 1.5, width: 97, height: 97, fill: 'none', 'class': 'hf-patch__edge' })]);
    if (o.size) { node.setAttribute('width', o.size); node.setAttribute('height', o.size); }
    return node;
  }

  /* ---------- cell grid (n × n buttons, roving focus) ---------- */
  function cellGrid(n, o) {
    o = o || {};
    var cells = [], enabled = false, focusIdx = 0;
    var el = h('div', { 'class': 'hf-cg hf-cg--' + n + (o.cls ? ' ' + o.cls : ''), role: 'group', 'aria-label': o.label || 'Grid' });
    el.style.setProperty('--n', String(n));
    for (var i = 0; i < n * n; i++) {
      (function (idx) {
        var b = h('button', { type: 'button', 'class': 'hf-cg__cell', 'data-cell': String(idx), tabindex: '-1',
          'aria-label': o.cellLabel ? o.cellLabel(idx) : ('Row ' + (Math.floor(idx / n) + 1) + ', column ' + (idx % n + 1)) }, [
          h('span', { 'class': 'hf-cg__fill', 'aria-hidden': 'true' }),
          h('span', { 'class': 'hf-cg__tag', 'aria-hidden': 'true' })
        ]);
        b.addEventListener('click', function (e) {
          if (!enabled) return;
          focusIdx = idx; setRoving();
          if (typeof o.onPick === 'function') o.onPick(idx, e);
        });
        cells.push(b);
        el.appendChild(b);
      })(i);
    }
    function setRoving() {
      for (var j = 0; j < cells.length; j++) cells[j].setAttribute('tabindex', enabled && j === focusIdx ? '0' : '-1');
    }
    el.addEventListener('keydown', function (e) {
      if (!enabled) return;
      var r = Math.floor(focusIdx / n), cc = focusIdx % n, nx = focusIdx;
      if (e.key === 'ArrowRight') nx = r * n + Math.min(n - 1, cc + 1);
      else if (e.key === 'ArrowLeft') nx = r * n + Math.max(0, cc - 1);
      else if (e.key === 'ArrowDown') nx = Math.min(n - 1, r + 1) * n + cc;
      else if (e.key === 'ArrowUp') nx = Math.max(0, r - 1) * n + cc;
      else if (e.key === 'Home') nx = 0;
      else if (e.key === 'End') nx = n * n - 1;
      else if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        // explicit, because HF.input cancels Space's native activation while a flow is busy
        var tgt = e.target && e.target.closest ? e.target.closest('[data-cell]') : null;
        if (!tgt) return;
        e.preventDefault();
        tgt.click();
        return;
      }
      else return;
      e.preventDefault();
      focusIdx = nx; setRoving();
      try { cells[nx].focus({ preventScroll: true }); } catch (err) { cells[nx].focus(); }
    });
    return {
      el: el, cells: cells,
      enable: function (on) {
        enabled = !!on;
        el.classList.toggle('is-live', enabled);
        for (var j = 0; j < cells.length; j++) {
          if (enabled) cells[j].removeAttribute('aria-disabled'); else cells[j].setAttribute('aria-disabled', 'true');
        }
        setRoving();
      },
      focus: function (idx) {
        if (typeof idx === 'number') focusIdx = idx;
        setRoving();
        try { cells[focusIdx].focus({ preventScroll: true }); } catch (err) { cells[focusIdx].focus(); }
      },
      mark: function (idx, cls, on) { if (cells[idx]) cells[idx].classList.toggle(cls, on !== false); },
      tag: function (idx, text) { var t = cells[idx] && cells[idx].querySelector('.hf-cg__tag'); if (t) t.textContent = text == null ? '' : String(text); },
      fill: function (idx, node) { var f = cells[idx] && cells[idx].querySelector('.hf-cg__fill'); if (f) { clear(f); if (node) f.appendChild(node); } },
      reset: function () {
        for (var j = 0; j < cells.length; j++) {
          cells[j].className = 'hf-cg__cell';
          clear(cells[j].querySelector('.hf-cg__fill'));
          cells[j].querySelector('.hf-cg__tag').textContent = '';
        }
      }
    };
  }

  /* ---------- HF.timing runs with the Lab pause dialog ---------- */
  /** HF.timing.runDiscrete(spec, view, opts) with the Lab pause dialog wired in: a pause (Escape/P, page hidden, the
      Pause button) voids the trial in progress (core rule) and opens Resume / Stop the visit; Resume →
      HF.timing.resume(), Stop → HF.timing.abort() (log.aborted). Returns Promise<DiscreteLog>. */
  function runDiscrete(spec, view, opts) {
    opts = opts || {};
    var adapter = {
      pauseText: opts.pauseText || null,
      resume: function () { if (HF.timing.paused) HF.timing.resume(); },
      stop: function () { HF.timing.abort('stop'); }
    };
    var user = opts.onPause;
    var o = {};
    Object.keys(opts).forEach(function (key) { o[key] = opts[key]; });
    o.onPause = function (info) {
      if (typeof user === 'function') { try { user(info); } catch (e) { if (root.console) console.error(e); } }
      if (!adapter.open || !adapter.open.isOpen) adapter.open = pauseDialog(adapter);
    };
    var resumeUser = opts.onResume;
    o.onResume = function () { adapter.open = null; if (typeof resumeUser === 'function') resumeUser(); };
    return HF.timing.runDiscrete(spec, view, o).then(function (log) {
      if (adapter.open && adapter.open.isOpen) { try { adapter.open.close('done'); } catch (e) { /* ignore */ } }
      return log;
    });
  }

  K.h = h; K.svg = svg; K.clear = clear; K.runDiscrete = runDiscrete; K.perfNow = perfNow; K.frame = frame; K.ensureInterval = ensureInterval;
  K.keys = keys; K.digitOf = digitOf; K.letterOf = letterOf; K.isTyping = isTyping; K.evTime = evTime;
  K.session = session; K.present = present; K.frameUI = frameUI; K.countdown = countdown; K.patch = patch;
  K.cellGrid = cellGrid; K.pauseDialog = pauseDialog; K.lum = lum; K.waitNext = waitNext;
  // spec.practice is `true` on practice specs, but an ARRAY of tutorial items on scored matrix/series/graph specs
  K.isPractice = function (spec, ctx) { return (spec && spec.practice === true) || (ctx && ctx.practice === true) || false; };
  K.wantsFeedback = function (spec, ctx) { return K.isPractice(spec, ctx) || !!(ctx && ctx.feedback === 'per-response'); };
  K.keyLabel = function (name, fallback) {
    try { var l = HF.input && HF.input.labelFor ? HF.input.labelFor(name) : ''; return l || fallback; } catch (e) { return fallback; }
  };

  /* =============================================================== lab.sspan view */

  function patternSvg(rows) {
    var kids = [svg('rect', { x: 0, y: 0, width: 8, height: 8, 'class': 'hf-ss__bg' })];
    for (var r = 0; r < rows.length; r++) {
      for (var c2 = 0; c2 < rows[r].length; c2++) {
        if (rows[r].charAt(c2) === '1') kids.push(svg('rect', { x: c2, y: r, width: 1.02, height: 1.02, 'class': 'hf-ss__on' }));
      }
    }
    kids.push(svg('line', { x1: 4, y1: -0.3, x2: 4, y2: 8.3, 'class': 'hf-ss__axis' }));
    kids.push(svg('rect', { x: 0, y: 0, width: 8, height: 8, 'class': 'hf-ss__frame' }));
    return svg('svg', { viewBox: '-0.3 -0.3 8.6 8.6', 'class': 'hf-ss__pattern', role: 'img', 'aria-label': 'An 8 by 8 pattern of black and white squares', focusable: 'false' }, kids);
  }

  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var practice = K.isPractice(spec, ctx), feedback = K.wantsFeedback(spec, ctx);
    var S = null, F = null, offs = [], destroyed = false;

    function build() {
      F = frameUI(rootEl, { title: practice ? 'Practice' : (ctx.title || 'Spatial span'), test: 'sspan', cls: 'hf-lt--sspan', onPause: function (r) { if (S) S.pause(r || 'button'); } });
      return F;
    }

    function judgePhase(pair, interval) {
      // returns Promise<{ resp, rt } | VOID | STOP>
      return S.trial(function (ctl) {
        clear(F.stage); clear(F.answer);
        var pat = patternSvg(pair.proc.rows);
        var wrap = h('div', { 'class': 'hf-ss__judge', style: 'visibility:hidden' }, [pat]);
        F.stage.appendChild(wrap);
        var pads = C() ? C().pads({ pads: [
          { id: 'no', label: 'Not symmetric', key: K.keyLabel('no', 'F'), kind: 'no', icon: false },
          { id: 'match', label: 'Symmetric', key: K.keyLabel('match', 'J'), kind: 'yes', icon: false }
        ], fixed: true, size: 'sm', label: 'Is the pattern symmetric?' }) : h('div');
        F.answer.appendChild(h('p', { 'class': 'hf-lt__q' }, ['Is it the same on both sides of the middle line?']));
        F.answer.appendChild(pads);
        F.setHint('F = not symmetric · J = symmetric');
        var onset = null, timer = null, off = null;
        function end(res) {
          clearTimeout(timer); if (off) off(); off = null;
          ctl.done(res);
        }
        ctl.onCancel(function () { clearTimeout(timer); if (off) off(); off = null; });
        off = HF.input.on(function (ev) {
          if (onset === null || (ev.key !== 'match' && ev.key !== 'no')) return;
          if (!(ev.t >= onset)) return;
          end({ resp: ev.key === 'match', rt: Math.round((ev.t - onset) * 10) / 10 });
        });
        frame().then(function (ts) {
          if (ctl.cancelled) return;
          wrap.style.visibility = '';
          onset = ts;
          timer = setTimeout(function () { end({ resp: null, rt: null, timedOut: true }); }, spec.procLimitMs || 6000);
        });
      });
    }

    function memPhase(cell, interval) {
      clear(F.stage); clear(F.answer);
      F.setHint('');
      var g = cellGrid(spec.memGrid || 4, { label: 'Remember this square', cls: 'hf-cg--mem' });
      F.stage.appendChild(g.el);
      F.answer.appendChild(h('p', { 'class': 'hf-lt__q hf-lt__q--soft' }, ['Remember where the square is.']));
      return present(S, function () { g.mark(cell, 'is-lit', true); }, function () { g.mark(cell, 'is-lit', false); }, spec.memMs || 1000, interval);
    }

    function recallPhase(tr) {
      return S.trial(function (ctl) {
        clear(F.stage); clear(F.answer);
        var picks = [];
        var n = spec.memGrid || 4;
        var g = cellGrid(n, { label: 'Tap the squares in the order they appeared', cls: 'hf-cg--recall', onPick: function (idx) { add(idx); } });
        var undoBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--secondary' }, [h('span', { 'class': 'hf-btn__label' }, ['Undo'])]);
        var skipBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--secondary' }, [h('span', { 'class': 'hf-btn__label' }, ['Skip one'])]);
        var doneBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary' }, [h('span', { 'class': 'hf-btn__label' }, ['Done'])]);
        var count = h('p', { 'class': 'hf-lt__q', 'aria-live': 'polite' });
        F.stage.appendChild(g.el);
        F.answer.appendChild(count);
        F.answer.appendChild(h('div', { 'class': 'hf-actions hf-lt__acts' }, [undoBtn, skipBtn, doneBtn]));
        F.setHint('Tap in order, or use the arrow keys and Space. Skip one if you forgot a square; its place stays empty.');
        function paint() {
          g.reset();
          picks.forEach(function (c2, k) { if (c2 !== null) { g.mark(c2, 'is-picked', true); g.tag(c2, k + 1); } });
          count.textContent = 'Square ' + Math.min(picks.length + 1, tr.setSize) + ' of ' + tr.setSize + (picks.length >= tr.setSize ? ' — all chosen. Press Done.' : '');
          undoBtn.disabled = picks.length === 0;
          skipBtn.disabled = picks.length >= tr.setSize;
          doneBtn.disabled = picks.length === 0;
        }
        function add(idx) {
          if (picks.length >= tr.setSize) return;
          if (idx !== null && picks.indexOf(idx) >= 0) return;
          picks.push(idx);
          paint();
          if (picks.length >= tr.setSize) { try { doneBtn.focus({ preventScroll: true }); } catch (e) { doneBtn.focus(); } }
        }
        undoBtn.addEventListener('click', function () { picks.pop(); paint(); g.focus(); });
        skipBtn.addEventListener('click', function () { add(null); });
        doneBtn.addEventListener('click', function () { finish(); });
        // cells are real buttons: Enter / Space activate them natively (click → onPick)
        g.el.addEventListener('keydown', function (e) {
          if (e.key === 'Backspace') { e.preventDefault(); picks.pop(); paint(); }
        });
        function finish() {
          var rec = [];
          for (var k = 0; k < tr.setSize; k++) rec.push(picks[k] === undefined ? null : picks[k]);
          ctl.done({ recall: rec });
        }
        g.enable(true);
        paint();
        g.focus(0);
      });
    }

    function showFeedbackJudge(pair, resp) {
      var ok = resp === pair.proc.symmetric;
      F.say(resp === null ? 'Too slow — that one was ' + (pair.proc.symmetric ? 'symmetric.' : 'not symmetric.')
        : (ok ? 'Right: it is ' + (pair.proc.symmetric ? 'symmetric.' : 'not symmetric.') : 'Not quite: it is ' + (pair.proc.symmetric ? 'symmetric.' : 'not symmetric.')), ok ? 'good' : 'info');
      return S.wait(1100).then(function () { F.say(''); });
    }

    function showFeedbackRecall(tr, rec) {
      clear(F.stage); clear(F.answer);
      var g = cellGrid(spec.memGrid || 4, { label: 'The right order', cls: 'hf-cg--recall' });
      tr.pairs.forEach(function (p, k) { g.mark(p.mem, 'is-answer', true); g.tag(p.mem, k + 1); });
      F.stage.appendChild(g.el);
      var right = tr.pairs.filter(function (p, k) { return rec[k] === p.mem; }).length;
      F.answer.appendChild(h('p', { 'class': 'hf-lt__q' }, [right + ' of ' + tr.setSize + ' in the right place. The numbers show the right order.']));
      var box = h('div', { 'class': 'hf-actions hf-lt__acts' });
      F.answer.appendChild(box);
      return waitNext(box, 'Next');
    }

    function run(ctx2) {
      ctx2 = ctx2 || {};
      build();
      S = session({});
      var out = { trials: [], paused: false, pauses: [], aborted: false };
      var trials = spec.trials || [];
      return ensureInterval().then(function (interval) {
        return new Promise(function (resolve) {
          var k = 0;
          function finish(aborted) {
            var L = S.log();
            out.paused = L.paused; out.pauses = L.pauses; out.aborted = !!aborted;
            S.destroy();
            resolve(out);
          }
          function next() {
            if (destroyed) return finish(true);
            S.ready().then(function (ok) {
              if (!ok || S.stopped) return finish(true);
              if (k >= trials.length) return finish(false);
              var tr = trials[k];
              F.setProgress('Set ' + (k + 1) + ' of ' + trials.length + ' · ' + tr.setSize + ' squares');
              if (typeof ctx2.onProgress === 'function') ctx2.onProgress(k, trials.length);
              var rec = { i: tr.i, proc: [], recall: [], voided: false };
              var p = 0, voided = false;
              function pairStep() {
                if (p >= tr.pairs.length) return recall();
                var pair = tr.pairs[p];
                judgePhase(pair, interval).then(function (res) {
                  if (res === STOP) return finish(true);
                  if (res === VOID) { voided = true; return endTrial(); }
                  rec.proc.push({ resp: res.resp, rt: res.rt });
                  var fb = feedback ? showFeedbackJudge(pair, res.resp) : Promise.resolve();
                  fb.then(function () {
                    clear(F.stage); clear(F.answer);
                    return S.wait(250);
                  }).then(function () {
                    if (S.stopped) return finish(true);
                    if (S.paused) { voided = true; return endTrial(); }
                    return memPhase(pair.mem, interval).then(function (m) {
                      if (m === STOP) return finish(true);
                      if (m === VOID) { voided = true; return endTrial(); }
                      rec.stalls = (rec.stalls || 0) + m.stalls;
                      if (m.voided) rec.late = (rec.late || 0) + 1;
                      clear(F.stage); clear(F.answer);
                      return S.wait(250).then(function () {
                        if (S.paused) { voided = true; return endTrial(); }
                        p++; pairStep();
                      });
                    });
                  });
                });
              }
              function recall() {
                recallPhase(tr).then(function (res) {
                  if (res === STOP) return finish(true);
                  if (res === VOID) { voided = true; return endTrial(); }
                  rec.recall = res.recall;
                  if (feedback) return showFeedbackRecall(tr, res.recall).then(endTrial);
                  endTrial();
                });
              }
              function endTrial() {
                if (voided || rec.late) { rec.voided = true; }
                out.trials.push(rec);
                k++;
                clear(F.stage); clear(F.answer); F.setHint('');
                S.wait(practice ? 300 : 500).then(next);
              }
              pairStep();
            });
          }
          next();
        });
      });
    }

    return {
      run: run,
      destroy: function () {
        destroyed = true;
        offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
        if (S) { S.stop(); S.destroy(); }
        if (F && F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el);
      }
    };
  }

  HF.views['lab.sspan'] = { create: create, patternSvg: patternSvg };
})(typeof window !== 'undefined' ? window : globalThis);
