/* Long-Horizon — frame-accurate stimulus runners (browser only). MIT licence.
 * Uses HF.input (responses, pause key) and, when present, HF.audio (sound scheduling, audio-state pause).
 *
 * Method (SPEC-core "Timing"):
 * - Every stimulus change happens inside a requestAnimationFrame callback; onset = that callback's timestamp;
 *   the next callback's timestamp is logged as `shown`. Durations are counted in FRAMES of the interval measured
 *   during the lead-in (median rAF delta, ≥ 20 frames): an item stays for round(onMs / interval) frames, and each
 *   change fires on the first frame whose timestamp reaches (due − interval/2), so a dropped frame never shifts
 *   later items. No fades, no layout reads; view.prepare(next) runs in a timer during the blank interval.
 * - Responses: HF.input events, timestamped with event.timeStamp. A response belongs to the window
 *   [onset_i, onset_i+1) that contains its timestamp (so a press made just before an onset but handled after it is
 *   credited to the earlier item); only the first response per key per window is kept; RT = t − onset_i.
 * - Voiding: a trial is voided when shown − onset > 1.5 × interval (late paint) or when a frame gap
 *   > 2.5 × interval happens while its stimulus is displayed (discrete: displayed and not yet answered).
 *   Voided trials are listed so the scorer excludes them; they are never charged to the player.
 * - HF.timing.busy is true while a block presents stimuli (store saves and toasts wait for it); <html data-busy>
 *   mirrors it (present while busy) so CSS can freeze all motion during stimulus streams.
 * - Pause: HF.timing.pause(reason) — Escape/P (input), page hidden, pagehide, audio context not running (audio
 *   blocks). A STREAM stops at once and resolves { paused: true, … } (the trial in progress is voided); the
 *   caller restarts with a fresh sequence after its 3-2-1 lead-in. A DISCRETE block voids only the trial in
 *   progress, waits for HF.timing.resume(), then continues with the next trial after `resumeLeadMs`.
 *   A second pause while paused keeps the first pause start (its reason is appended).
 * - Wake lock (optional, guarded): held while a run is active or while keepAwake(true); re-requested when the
 *   page becomes visible again; failures are ignored (sandbox, headless, power saving).
 *
 * View contract: view.prepare(trial) (during the previous blank), view.show(trial), view.hide(trial) — show/hide run
 * inside rAF callbacks and must only toggle prepared DOM. Missing methods are treated as no-ops.
 *
 * HF.timing:
 *   busy, state ('idle'|'running'|'paused'), active (a run exists), paused, interval (last measured ms),
 *   lowPrecision (true if performance.now() ticks ≥ 10 ms, e.g. Firefox resistFingerprinting), last (last log)
 *   measureFrameInterval({ frames = 30 }?) → Promise<ms>;  frame() → Promise<rAF timestamp>
 *   runStream(spec, view, opts?) → Promise<StreamLog>
 *     spec: { onMs, soaMs, trials: [...], streams? } — onMs ≥ soaMs (or null) = the item stays until the next one
 *     opts: { keys (default ['match'] or ['match','match2'] for 2 streams), interval (skip measuring), leadMs = 500,
 *             sound(trial, audioWhen) (called one frame before the onset frame, so the sound is scheduled on the
 *             audio clock to coincide with the item's first visible frame; audioWhen is null if audio is not running),
 *             audioOffsetMs (added to the sound time; default settings.audioOffsetMs), onResponse(resp, trial),
 *             onPause(info), wakeLock = true }
 *     StreamLog: { kind: 'stream', responses: [{ key, t (ms from the first onset), trial, rt, src }],
 *       voided: [i], paused, pause: null|{ at, reason }, aborted, n, presented, onsets, shown, offsets (ms from the
 *       first onset, 0.01 ms), interval, onFrames, soaFrames, frame: { fps, medianMs, maxMs, stalls, lowPrecision },
 *       flags: { late: [i], stall: [i] }, audio: null|{ baseMs, outputMs }, startedAt (Date.now()), t0 (perf time) }
 *   runDiscrete(spec, view, opts?) → Promise<DiscreteLog>
 *     spec: { windowMs, itiMs = 0, displayMs? (hide the stimulus earlier but keep the response window open),
 *             trials: [{ i, … , windowMs?, itiMs?, displayMs? }] }
 *     opts: { keys = ['match','no'], endOnResponse = true, interval, leadMs = 500, resumeLeadMs = 1000,
 *             onResponse(answer, trial), onAnswer(answer, trial) → extra ms to wait before the next ITI,
 *             onPause(info), onResume(), wakeLock = true }
 *     DiscreteLog: { kind: 'discrete', answers: [{ i, response: 'match'|'no'|null, rt, voided, src }], paused,
 *       pauses: [{ start, end, reasons }], aborted, n, presented, onsets, shown, offsets, interval, frame, flags,
 *       startedAt, t0 }
 *   custom(handlers, opts?) → flow      for flows that run their own trial logic (Span view.run(), Lab tests such
 *     as matrix/series/graph/sspan/update/bind) but need the same block behaviour. While the flow is active:
 *     busy + <html data-busy> (off while paused), wake lock held, and Escape/P (HF.input), page hidden, pagehide,
 *     audio context not running (opts.audio) and HF.timing.pause/resume/abort all reach the flow. A second pause
 *     while paused keeps the first pause start (its reason is appended; handlers.pause is NOT called again).
 *     handlers (all optional, called by the core): pause({ kind, reason, at }) — stop timers, hide/void what is on
 *       screen, show the pause UI; resume({ kind, pausedMs, reasons }) — restart (fresh lead-in);
 *       abort({ kind, reason }) — stop; the flow is already ended when it returns.
 *     opts: { kind = 'custom', audio = false (pause with reason 'audio' if audio is not running, also at start),
 *             wakeLock = true, onPause(info) }
 *     flow: { end() → log (idempotent; releases busy, keys, wake lock), pause(reason), resume(), abort(reason),
 *             frame() → Promise<rAF ts>, now() → performance.now(), time(event) → validated timestamp,
 *             state ('running'|'paused'|'done'), paused, active }
 *     log: { kind, paused, pauses: [{ start, end, reasons }] (ms from the flow start), aborted, abortReason,
 *            startedAt (Date.now()), t0 (perf time), durationMs }
 *     Throws if another run or flow is active (end it first). onPause subscribers are told as for other runs.
 *   pause(reason) → bool;  resume() → bool;  abort(reason) → bool (ends the run; log.aborted = true)
 *   onPause(cb) → off      cb({ kind, reason, at })
 *   keepAwake(bool)        session-level wake lock (the player holds it from Start to the end of a session)
 *   frameStats(deltas, interval, lowPrecision) → { fps, medianMs, maxMs, stalls, lowPrecision }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;

  var rafFn = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (cb) { return setTimeout(function () { cb(perfNow()); }, 16); };
  var cafFn = root.cancelAnimationFrame ? root.cancelAnimationFrame.bind(root) : function (id) { clearTimeout(id); };
  function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function r2(x) { return x === null || !isFinite(x) ? null : Math.round(x * 100) / 100; }
  function median(a) {
    if (!a.length) return NaN;
    var s = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function saneInterval(x) { return x >= 3 && x <= 100 ? x : 1000 / 60; }
  function noop() {}

  var api = { busy: false, state: 'idle', interval: null, lowPrecision: null, last: null, usesAudio: false };
  var run = null;          // controller of the active run: { kind, pause(reason), resume(), abort(reason) }
  var pauseSubs = [];

  // Every change of `busy` goes through here: <html data-busy> mirrors it (css/app.css freezes all CSS motion
  // while a block presents stimuli). Set at run start, i.e. during the lead-in, never between stimulus frames.
  function setBusy(b) {
    api.busy = !!b;
    var el = doc && doc.documentElement;
    if (!el) return;
    try { if (b) el.setAttribute('data-busy', ''); else el.removeAttribute('data-busy'); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- helpers
  function detectLowPrecision() {
    var last = perfNow(), steps = [], deadline = Date.now() + 60;
    while (steps.length < 3 && Date.now() < deadline) {
      var t = perfNow();
      if (t !== last) { steps.push(t - last); last = t; }
    }
    if (steps.length < 2) return true;
    var full = steps.slice(1);
    return Math.min.apply(null, full) >= 10;
  }

  function frameStats(deltas, interval, lowPrecision) {
    var arr = Array.prototype.slice.call(deltas || []);
    if (!arr.length) return { fps: null, medianMs: null, maxMs: null, stalls: 0, lowPrecision: !!lowPrecision };
    var med = median(arr), max = 0, stalls = 0, lim = 2.5 * (interval || med);
    for (var i = 0; i < arr.length; i++) { if (arr[i] > max) max = arr[i]; if (arr[i] > lim) stalls++; }
    return {
      fps: Math.round(10000 / med) / 10, medianMs: Math.round(med * 1000) / 1000, maxMs: Math.round(max * 10) / 10,
      stalls: stalls, lowPrecision: !!lowPrecision
    };
  }

  function measureFrameInterval(opts) {
    opts = opts || {};
    var want = opts.frames || 30;
    return new Promise(function (resolve) {
      var ts = [], done = false;
      var guard = setTimeout(finish, opts.maxMs || 1500);
      function step(t) {
        if (done) return;
        ts.push(t);
        if (ts.length > want) finish(); else rafFn(step);
      }
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(guard);
        var d = [];
        for (var i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        var med = d.length >= 5 ? saneInterval(median(d)) : 1000 / 60;
        api.interval = med;
        if (api.lowPrecision === null) api.lowPrecision = detectLowPrecision();
        resolve(med);
      }
      rafFn(step);
    });
  }

  function frame() { return new Promise(function (resolve) { rafFn(resolve); }); }

  function emitPause(info, opts) {
    var list = pauseSubs.slice();
    for (var i = 0; i < list.length; i++) { try { list[i](info); } catch (e) { if (root.console) console.error(e); } }
    if (opts && typeof opts.onPause === 'function') { try { opts.onPause(info); } catch (e2) { if (root.console) console.error(e2); } }
  }

  function viewFns(view) {
    view = view || {};
    return {
      prepare: typeof view.prepare === 'function' ? view.prepare.bind(view) : noop,
      show: typeof view.show === 'function' ? view.show.bind(view) : noop,
      hide: typeof view.hide === 'function' ? view.hide.bind(view) : noop
    };
  }

  function nanArray(n) { var a = new Float64Array(n); for (var i = 0; i < n; i++) a[i] = NaN; return a; }
  function relList(arr, n, t0) { var out = new Array(n); for (var i = 0; i < n; i++) out[i] = isFinite(arr[i]) ? r2(arr[i] - t0) : null; return out; }
  function flagList(f, n) { var out = []; for (var i = 0; i < n; i++) if (f[i]) out.push(i); return out; }

  // ---------------------------------------------------------------- wake lock
  var wake = { sentinel: null, pending: false, session: false, run: false };
  function wantWake() { return wake.session || wake.run; }
  function syncWake() {
    var nav = root.navigator;
    if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') return;
    if (wantWake()) {
      if (wake.sentinel || wake.pending || !doc || doc.visibilityState !== 'visible') return;
      if (HF.dom && HF.dom.allows && !HF.dom.allows('screen-wake-lock')) return;
      wake.pending = true;
      try {
        nav.wakeLock.request('screen').then(function (s) {
          wake.pending = false;
          wake.sentinel = s;
          s.addEventListener('release', function () { if (wake.sentinel === s) wake.sentinel = null; });
          if (!wantWake()) syncWake();
        }, function () { wake.pending = false; });
      } catch (e) { wake.pending = false; }
    } else if (wake.sentinel) {
      var s2 = wake.sentinel;
      wake.sentinel = null;
      try { s2.release().catch(noop); } catch (e3) { /* ignore */ }
    }
  }
  function keepAwake(on) { wake.session = !!on; syncWake(); }

  // ---------------------------------------------------------------- audio helpers
  function audioRunning() { return !!(HF.audio && HF.audio.state && HF.audio.state() === 'running'); }
  function audioWhen(perfMs) { return HF.audio && HF.audio.atPerf ? HF.audio.atPerf(perfMs) : null; }
  function settingsOffset() {
    var st = HF.store;
    var s = st && st.loaded && st.records && st.records.settings;
    return s && typeof s.audioOffsetMs === 'number' ? s.audioOffsetMs : 0;
  }

  function beginRun(ctrl, opts) {
    run = ctrl;
    setBusy(true);
    api.state = 'running';
    wake.run = opts.wakeLock !== false;
    syncWake();
  }
  function endRun(log) {
    run = null;
    setBusy(false);
    api.state = 'idle';
    api.usesAudio = false;
    api.last = log;
    wake.run = false;
    syncWake();
  }

  // ---------------------------------------------------------------- stream runner
  function runStream(spec, view, opts) {
    opts = opts || {};
    if (run) return Promise.reject(new Error('HF.timing: a block is already running'));
    var trials = spec && spec.trials;
    if (!trials || !trials.length) return Promise.reject(new Error('HF.timing.runStream: spec has no trials'));
    if (!(spec.soaMs > 0)) return Promise.reject(new Error('HF.timing.runStream: spec.soaMs must be > 0'));
    if (api.lowPrecision === null) api.lowPrecision = detectLowPrecision();
    var v = viewFns(view);

    return new Promise(function (resolve) {
      var n = trials.length;
      var keys = opts.keys || (spec.streams && spec.streams.length > 1 ? ['match', 'match2'] : ['match']);
      var nk = keys.length;
      var persistent = !(spec.onMs > 0) || spec.onMs >= spec.soaMs;
      var sound = typeof opts.sound === 'function' ? opts.sound : null;
      var offsetMs = typeof opts.audioOffsetMs === 'number' ? opts.audioOffsetMs : settingsOffset();
      var fixed = opts.interval > 0;
      var interval = fixed ? opts.interval : 0;
      var leadMs = opts.leadMs != null ? Math.max(0, opts.leadMs) : 500;
      var onFrames = 0, soaFrames = 0;
      var onsets = nanArray(n), shown = nanArray(n), offsets = nanArray(n);
      var voidF = new Uint8Array(n), lateF = new Uint8Array(n), stallF = new Uint8Array(n), prepared = new Uint8Array(n);
      var got = new Uint8Array(n * nk);
      var responses = [];
      var maxFrames = Math.ceil((leadMs + 2000 + n * spec.soaMs) / 4) + 600;
      var deltas = new Float32Array(maxFrames), nd = 0, measure = [];
      var cur = -1, displaying = -1, phase = 'lead', startTs = null, lastTs = null, needShown = -1, soundFor = -1;
      var offDue = 0, nextDue = 0, rafId = 0, active = true, startedAt = Date.now();
      var pauseInfo = null, aborted = false, failure = null;

      api.usesAudio = !!sound;
      if (sound && HF.audio && HF.audio.session) HF.audio.session(true);

      function safe(fn, trial) {
        try { fn(trial); return true; }
        catch (e) { failure = e; if (root.console) console.error('[long-horizon] view error', e); stop('error'); return false; }
      }
      function playSound(k, photonPerf) {
        soundFor = k;
        var when = audioRunning() ? audioWhen(photonPerf + offsetMs) : null;
        try { sound(trials[k], when); } catch (e) { if (root.console) console.error(e); }
      }
      function schedulePrepare(k) {
        if (k >= n || prepared[k]) return;
        setTimeout(function () {
          if (!active || prepared[k]) return;
          prepared[k] = 1;
          try { v.prepare(trials[k]); } catch (e) { if (root.console) console.error(e); }
        }, 0);
      }

      function onInput(ev) {
        if (!active) return;
        if (ev.key === 'pause') { api.pause('key'); return; }
        var ki = keys.indexOf(ev.key);
        if (ki < 0 || cur < 0) return;
        var t = ev.t, j = cur;
        while (j >= 0 && onsets[j] > t) j--;
        if (j < 0) return;
        var slot = j * nk + ki;
        if (got[slot]) return;
        got[slot] = 1;
        var resp = { key: ev.key, t: r2(t - onsets[0]), trial: j, rt: r2(t - onsets[j]), src: ev.src };
        responses.push(resp);
        if (opts.onResponse) { try { opts.onResponse(resp, trials[j]); } catch (e) { if (root.console) console.error(e); } }
      }
      var offInput = HF.input && HF.input.on ? HF.input.on(onInput) : noop;

      function tick(ts) {
        if (!active) return;
        if (lastTs !== null) {
          var d = ts - lastTs;
          if (phase === 'lead') { if (!fixed) measure.push(d); }
          else {
            if (nd < maxFrames) deltas[nd++] = d;
            if (d > 2.5 * interval && displaying >= 0) { stallF[displaying] = 1; voidF[displaying] = 1; }
          }
        }
        lastTs = ts;
        if (needShown >= 0) {
          shown[needShown] = ts;
          if (ts - onsets[needShown] > 1.5 * interval) { lateF[needShown] = 1; voidF[needShown] = 1; }
          needShown = -1;
        }
        if (sound && phase !== 'lead' && !audioRunning()) { api.pause('audio'); return; }

        if (phase === 'lead') {
          if (startTs === null) startTs = ts;
          var el = ts - startTs;
          var enough = fixed || measure.length >= 20 || (el > 2000 && measure.length >= 5);
          if (!(enough && el >= leadMs)) { rafId = rafFn(tick); return; }
          if (!fixed) interval = saneInterval(median(measure));
          api.interval = interval;
          onFrames = persistent ? 0 : Math.max(1, Math.round(spec.onMs / interval));
          soaFrames = Math.max(persistent ? 1 : onFrames + 1, Math.round(spec.soaMs / interval));
          nextDue = ts + 2 * interval;
          phase = 'off';
          if (sound && !audioRunning()) { api.pause('audio'); return; }
        }
        var half = interval / 2;
        if (phase === 'on' && !persistent && ts >= offDue - half) {
          if (!safe(v.hide, trials[cur])) return;
          offsets[cur] = ts;
          displaying = -1;
          phase = 'off';
          schedulePrepare(cur + 1);
        }
        if (phase === 'off' || (persistent && phase === 'on')) {
          if (ts >= nextDue - half) {
            if (cur + 1 >= n) { stop(null, ts); return; }
            if (persistent && cur >= 0) {
              if (!safe(v.hide, trials[cur])) return;
              offsets[cur] = ts;
            }
            cur++;
            if (!prepared[cur]) { prepared[cur] = 1; if (!safe(v.prepare, trials[cur])) return; }
            if (!safe(v.show, trials[cur])) return;
            onsets[cur] = ts;
            needShown = cur;
            displaying = cur;
            phase = 'on';
            offDue = ts + onFrames * interval;
            nextDue = ts + soaFrames * interval;
            if (sound && soundFor < cur) playSound(cur, ts + interval);
            if (persistent) schedulePrepare(cur + 1);
          } else if (sound && cur + 1 < n && soundFor < cur + 1 && ts + interval >= nextDue - half) {
            playSound(cur + 1, ts + 2 * interval);
          }
        }
        rafId = rafFn(tick);
      }

      function stop(reason, ts) {
        if (!active) return;
        active = false;
        cafFn(rafId);
        offInput();
        var now = ts != null ? ts : perfNow();
        if (reason) {
          if (cur >= 0) voidF[cur] = 1;
          if (displaying >= 0) { try { v.hide(trials[displaying]); } catch (e) { /* ignore */ } offsets[displaying] = now; }
          if (HF.audio && HF.audio.stopAll) HF.audio.stopAll();
          if (reason === 'abort' || reason === 'error') aborted = true;
          else pauseInfo = { at: cur >= 0 ? r2(now - onsets[0]) : null, reason: reason };
        } else if (displaying >= 0) {
          try { v.hide(trials[displaying]); } catch (e2) { /* ignore */ }
          offsets[displaying] = now;
        }
        displaying = -1;
        if (sound && HF.audio && HF.audio.session) HF.audio.session(false);
        var presented = cur + 1;
        var t0 = presented ? onsets[0] : now;
        var voided = flagList(voidF, presented);
        var log = {
          kind: 'stream', responses: responses, voided: voided, paused: !!pauseInfo, pause: pauseInfo, aborted: aborted,
          n: n, presented: presented,
          onsets: relList(onsets, presented, t0), shown: relList(shown, presented, t0), offsets: relList(offsets, presented, t0),
          interval: r2(interval), onFrames: onFrames, soaFrames: soaFrames,
          frame: frameStats(deltas.subarray(0, nd), interval, api.lowPrecision),
          flags: { late: flagList(lateF, presented), stall: flagList(stallF, presented) },
          audio: sound && HF.audio && HF.audio.latency ? HF.audio.latency() : null,
          startedAt: startedAt, t0: r2(t0)
        };
        if (failure) log.error = String(failure && failure.message || failure);
        endRun(log);
        if (pauseInfo) emitPause({ kind: 'stream', reason: pauseInfo.reason, at: pauseInfo.at }, opts);
        resolve(log);
      }

      beginRun({
        kind: 'stream',
        pause: function (reason) { if (!active) return false; stop(reason || 'pause'); return true; },
        resume: function () { return false; },
        abort: function () { if (!active) return false; stop('abort'); return true; }
      }, opts);
      prepared[0] = 1;
      if (!safe(v.prepare, trials[0])) return;
      rafId = rafFn(tick);
    });
  }

  // ---------------------------------------------------------------- discrete runner
  function runDiscrete(spec, view, opts) {
    opts = opts || {};
    if (run) return Promise.reject(new Error('HF.timing: a block is already running'));
    var trials = spec && spec.trials;
    if (!trials || !trials.length) return Promise.reject(new Error('HF.timing.runDiscrete: spec has no trials'));
    if (api.lowPrecision === null) api.lowPrecision = detectLowPrecision();
    var v = viewFns(view);

    return new Promise(function (resolve) {
      var n = trials.length;
      var keys = opts.keys || ['match', 'no'];
      var endOnResponse = opts.endOnResponse !== false;
      var fixed = opts.interval > 0;
      var interval = fixed ? opts.interval : 0;
      var leadMs = opts.leadMs != null ? Math.max(0, opts.leadMs) : 500;
      var resumeLeadMs = opts.resumeLeadMs != null ? Math.max(0, opts.resumeLeadMs) : 1000;
      var onsets = nanArray(n), shown = nanArray(n), offsets = nanArray(n);
      var voidF = new Uint8Array(n), lateF = new Uint8Array(n), stallF = new Uint8Array(n), prepared = new Uint8Array(n);
      var answers = new Array(n);
      for (var a = 0; a < n; a++) answers[a] = { i: trials[a] && trials[a].i !== undefined ? trials[a].i : a, response: null, rt: null, voided: false, src: null };
      var maxMs = 0;
      for (var b = 0; b < n; b++) maxMs += (trials[b].windowMs || spec.windowMs || 3000) + (trials[b].itiMs != null ? trials[b].itiMs : (spec.itiMs || 0)) + 300;
      var maxFrames = Math.ceil((maxMs + leadMs + 5000) / 4) + 600;
      var deltas = new Float32Array(maxFrames), nd = 0, measure = [];
      var k = 0, phase = 'lead', startTs = null, lastTs = null, needShown = -1, displaying = -1;
      var due = 0, winDue = 0, dispDue = 0, answered = false, presented = 0;
      var rafId = 0, state = 'running', startedAt = Date.now(), aborted = false, failure = null;
      var pauses = [], t0 = null;

      function itiOf(t) { return t.itiMs != null ? t.itiMs : (spec.itiMs || 0); }
      function winOf(t) { return t.windowMs || spec.windowMs || 3000; }
      function dispOf(t) { var d = t.displayMs != null ? t.displayMs : spec.displayMs; return d > 0 ? d : 0; }
      function safe(fn, trial) {
        try { fn(trial); return true; }
        catch (e) { failure = e; if (root.console) console.error('[long-horizon] view error', e); finish('error'); return false; }
      }
      function schedulePrepare(j) {
        if (j >= n || prepared[j]) return;
        setTimeout(function () {
          if (state === 'done' || prepared[j]) return;
          prepared[j] = 1;
          try { v.prepare(trials[j]); } catch (e) { if (root.console) console.error(e); }
        }, 0);
      }

      function onInput(ev) {
        if (ev.key === 'pause') { if (state === 'running' || state === 'paused') api.pause('key'); return; }
        if (state !== 'running' || phase !== 'on' || answered) return;
        if (keys.indexOf(ev.key) < 0) return;
        if (!(ev.t >= onsets[k])) return;
        var ans = answers[k];
        ans.response = ev.key;
        ans.rt = r2(ev.t - onsets[k]);
        ans.src = ev.src;
        answered = true;
        if (opts.onResponse) { try { opts.onResponse(ans, trials[k]); } catch (e) { if (root.console) console.error(e); } }
      }
      var offInput = HF.input && HF.input.on ? HF.input.on(onInput) : noop;

      function endTrial(ts) {
        if (displaying >= 0) {
          if (!safe(v.hide, trials[k])) return false;
          displaying = -1;
        }
        if (!isFinite(offsets[k])) offsets[k] = ts;
        var extra = 0;
        if (opts.onAnswer) {
          try { extra = +opts.onAnswer(answers[k], trials[k]) || 0; } catch (e) { if (root.console) console.error(e); }
        }
        k++;
        answered = false;
        phase = 'iti';
        if (k >= n) { due = ts + Math.max(0, extra); phase = 'tail'; return true; }
        due = ts + Math.max(0, extra) + Math.round(itiOf(trials[k]) / interval) * interval;
        schedulePrepare(k);
        return true;
      }

      function tick(ts) {
        if (state !== 'running') return;
        if (lastTs !== null) {
          var d = ts - lastTs;
          if (phase === 'lead') { if (!fixed) measure.push(d); }
          else {
            if (nd < maxFrames) deltas[nd++] = d;
            if (d > 2.5 * interval && displaying >= 0 && !answered) { stallF[k] = 1; voidF[k] = 1; answers[k].voided = true; }
          }
        }
        lastTs = ts;
        if (needShown >= 0) {
          shown[needShown] = ts;
          if (ts - onsets[needShown] > 1.5 * interval) { lateF[needShown] = 1; voidF[needShown] = 1; answers[needShown].voided = true; }
          needShown = -1;
        }
        if (phase === 'lead') {
          if (startTs === null) startTs = ts;
          var el = ts - startTs;
          var enough = fixed || measure.length >= 20 || (el > 2000 && measure.length >= 5);
          if (!(enough && el >= leadMs)) { rafId = rafFn(tick); return; }
          if (!fixed) interval = saneInterval(median(measure));
          api.interval = interval;
          due = ts + Math.max(1, Math.round(itiOf(trials[k]) / interval)) * interval;
          phase = 'iti';
        } else if (phase === 'resume') {
          due = ts + Math.max(1, Math.round((resumeLeadMs + itiOf(trials[k])) / interval)) * interval;
          phase = 'iti';
        }
        var half = interval / 2;
        if (phase === 'tail') { if (ts >= due - half) { finish(null, ts); return; } }
        else if (phase === 'iti') {
          if (ts >= due - half) {
            if (!prepared[k]) { prepared[k] = 1; if (!safe(v.prepare, trials[k])) return; }
            if (!safe(v.show, trials[k])) return;
            onsets[k] = ts;
            if (t0 === null) t0 = ts;
            needShown = k;
            displaying = k;
            presented = k + 1;
            phase = 'on';
            answered = false;
            winDue = ts + Math.max(1, Math.round(winOf(trials[k]) / interval)) * interval;
            var dm = dispOf(trials[k]);
            dispDue = dm ? ts + Math.max(1, Math.round(dm / interval)) * interval : 0;
          }
        } else if (phase === 'on') {
          if (answered && endOnResponse) { if (!endTrial(ts)) return; }
          else {
            if (dispDue && displaying >= 0 && ts >= dispDue - half) {
              if (!safe(v.hide, trials[k])) return;
              displaying = -1;
              offsets[k] = ts;
            }
            if (ts >= winDue - half) { if (!endTrial(ts)) return; }
          }
        }
        rafId = rafFn(tick);
      }

      function pauseRun(reason) {
        if (state === 'paused') { pauses[pauses.length - 1].reasons.push(reason); return true; }
        if (state !== 'running') return false;
        state = 'paused';
        cafFn(rafId);
        var now = perfNow();
        if (phase === 'on') {
          if (!answered) {
            voidF[k] = 1;
            answers[k].voided = true;
            answers[k].response = null;
            answers[k].rt = null;
          }
          if (displaying >= 0) { try { v.hide(trials[k]); } catch (e) { /* ignore */ } displaying = -1; }
          if (!isFinite(offsets[k])) offsets[k] = now;
          k++;
          answered = false;
          if (k < n) schedulePrepare(k);
        }
        needShown = -1;
        phase = startTs === null || (phase === 'lead') ? 'lead' : 'resume';
        if (phase === 'lead') { startTs = null; }
        lastTs = null;
        pauses.push({ start: now, end: null, reasons: [reason] });
        setBusy(false);
        api.state = 'paused';
        if (HF.audio && HF.audio.stopAll) HF.audio.stopAll();
        emitPause({ kind: 'discrete', reason: reason, at: t0 === null ? null : r2(now - t0) }, opts);
        return true;
      }
      function resumeRun() {
        if (state !== 'paused') return false;
        pauses[pauses.length - 1].end = perfNow();
        state = 'running';
        setBusy(true);
        api.state = 'running';
        syncWake();
        if (opts.onResume) { try { opts.onResume(); } catch (e) { if (root.console) console.error(e); } }
        if (k >= n) { finish(null, perfNow()); return true; }
        rafId = rafFn(tick);
        return true;
      }

      function finish(reason, ts) {
        if (state === 'done') return;
        var wasPaused = state === 'paused';
        state = 'done';
        cafFn(rafId);
        offInput();
        var now = ts != null ? ts : perfNow();
        if (reason) {
          aborted = true;
          if (displaying >= 0 && k < n) {
            try { v.hide(trials[k]); } catch (e) { /* ignore */ }
            if (!answered) { voidF[k] = 1; answers[k].voided = true; answers[k].response = null; answers[k].rt = null; }
            if (!isFinite(offsets[k])) offsets[k] = now;
          }
          if (HF.audio && HF.audio.stopAll) HF.audio.stopAll();
        }
        if (wasPaused && pauses.length && pauses[pauses.length - 1].end === null) pauses[pauses.length - 1].end = now;
        displaying = -1;
        var base = t0 !== null ? t0 : now;
        var log = {
          kind: 'discrete', answers: answers, paused: pauses.length > 0,
          pauses: pauses.map(function (p) { return { start: r2(p.start - base), end: p.end === null ? null : r2(p.end - base), reasons: p.reasons }; }),
          aborted: aborted, n: n, presented: presented,
          onsets: relList(onsets, n, base), shown: relList(shown, n, base), offsets: relList(offsets, n, base),
          interval: r2(interval), frame: frameStats(deltas.subarray(0, nd), interval, api.lowPrecision),
          flags: { late: flagList(lateF, n), stall: flagList(stallF, n) },
          startedAt: startedAt, t0: r2(base)
        };
        if (failure) log.error = String(failure && failure.message || failure);
        endRun(log);
        resolve(log);
      }

      beginRun({
        kind: 'discrete',
        pause: function (reason) { return pauseRun(reason || 'pause'); },
        resume: resumeRun,
        abort: function () { if (state === 'done') return false; finish('abort'); return true; }
      }, opts);
      prepared[0] = 1;
      if (!safe(v.prepare, trials[0])) return;
      rafId = rafFn(tick);
    });
  }

  // ---------------------------------------------------------------- custom flows
  function custom(handlers, opts) {
    handlers = handlers || {};
    opts = opts || {};
    if (run) throw new Error('HF.timing: a block is already running');
    var kind = opts.kind || 'custom';
    var state = 'running', t0 = perfNow(), startedAt = Date.now(), pauses = [], log = null;
    var offInput = HF.input && HF.input.on ? HF.input.on(function (ev) { if (ev.key === 'pause' && state !== 'done') api.pause('key'); }) : noop;

    function call(name, info) {
      if (typeof handlers[name] !== 'function') return;
      try { handlers[name](info); } catch (e) { if (root.console) console.error('[long-horizon] custom flow ' + name + ' failed', e); }
    }
    function pauseFlow(reason) {
      if (state === 'paused') { pauses[pauses.length - 1].reasons.push(reason); return true; }
      if (state !== 'running') return false;
      state = 'paused';
      var now = perfNow();
      pauses.push({ start: now, end: null, reasons: [reason] });
      setBusy(false);
      api.state = 'paused';
      if (HF.audio && HF.audio.stopAll) HF.audio.stopAll();
      var info = { kind: kind, reason: reason, at: r2(now - t0) };
      call('pause', info);
      emitPause(info, opts);
      return true;
    }
    function resumeFlow() {
      if (state !== 'paused') return false;
      var p = pauses[pauses.length - 1], now = perfNow();
      p.end = now;
      state = 'running';
      setBusy(true);
      api.state = 'running';
      syncWake();
      call('resume', { kind: kind, pausedMs: r2(now - p.start), reasons: p.reasons.slice() });
      return true;
    }
    function endFlow(abortReason) {
      if (state === 'done') return log;
      var now = perfNow();
      if (state === 'paused') pauses[pauses.length - 1].end = now;
      state = 'done';
      offInput();
      if (abortReason && HF.audio && HF.audio.stopAll) HF.audio.stopAll();
      log = {
        kind: kind, paused: pauses.length > 0, aborted: !!abortReason, abortReason: abortReason || null,
        pauses: pauses.map(function (p) { return { start: r2(p.start - t0), end: p.end === null ? null : r2(p.end - t0), reasons: p.reasons.slice() }; }),
        startedAt: startedAt, t0: r2(t0), durationMs: r2(now - t0)
      };
      endRun(log);
      return log;
    }
    function abortFlow(reason) {
      if (state === 'done') return false;
      reason = reason || 'abort';
      call('abort', { kind: kind, reason: reason });
      endFlow(reason);
      return true;
    }

    beginRun({ kind: kind, pause: pauseFlow, resume: resumeFlow, abort: abortFlow }, opts);
    api.usesAudio = !!opts.audio; // audio.js pauses busy audio runs when the context stops running
    if (opts.audio) setTimeout(function () { if (state === 'running' && !audioRunning()) pauseFlow('audio'); }, 0);

    var flow = {
      kind: kind,
      end: function () { return endFlow(null); },
      pause: function (reason) { return pauseFlow(reason || 'pause'); },
      resume: resumeFlow,
      abort: function (reason) { return abortFlow(reason); },
      frame: frame,
      now: perfNow,
      time: function (e) { return HF.input && HF.input.time ? HF.input.time(e) : perfNow(); }
    };
    Object.defineProperty(flow, 'state', { enumerable: true, get: function () { return state; } });
    Object.defineProperty(flow, 'paused', { enumerable: true, get: function () { return state === 'paused'; } });
    Object.defineProperty(flow, 'active', { enumerable: true, get: function () { return state !== 'done'; } });
    return flow;
  }

  // ---------------------------------------------------------------- control
  function pause(reason) { return run ? run.pause(reason || 'pause') : false; }
  function resume() { return run ? run.resume() : false; }
  function abort(reason) { return run ? run.abort(reason || 'abort') : false; }
  function onPause(cb) {
    pauseSubs.push(cb);
    return function () { var i = pauseSubs.indexOf(cb); if (i >= 0) pauseSubs.splice(i, 1); };
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') pause('hidden');
      else syncWake();
    });
    root.addEventListener('pagehide', function () { pause('pagehide'); });
  }

  api.measureFrameInterval = measureFrameInterval;
  api.frame = frame;
  api.runStream = runStream;
  api.runDiscrete = runDiscrete;
  api.custom = custom;
  api.pause = pause;
  api.resume = resume;
  api.abort = abort;
  api.onPause = onPause;
  api.keepAwake = keepAwake;
  api.frameStats = frameStats;
  Object.defineProperty(api, 'active', { enumerable: true, get: function () { return !!run; } });
  Object.defineProperty(api, 'paused', { enumerable: true, get: function () { return api.state === 'paused'; } });
  HF.timing = api;
})(typeof window !== 'undefined' ? window : globalThis);
