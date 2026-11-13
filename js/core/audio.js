/* Long-Horizon — Web Audio: tones, optional spoken-letter clips, scheduling, sound check (browser only). MIT licence.
 *
 * - The AudioContext is created and resumed inside a user gesture: call HF.audio.unlock() from the Start click
 *   (Space/click/tap unlock; Escape and Shift do not). Nothing audio-related runs at page load.
 * - Tones: 8 distinct pitches (no two share a pitch class, so no octave look-alikes), triangle wave,
 *   400 ms with 8 ms linear on/off ramps (no clicks). Index 0–7 → Hz in HF.audio.TONES_HZ.
 * - Clips: window.HF_AUDIO_CLIPS = { C: 'data:audio/mpeg;base64,…', … } (assets/audio/letters.js, optional) are
 *   decoded at unlock (a fresh ArrayBuffer per decode, since decodeAudioData detaches it); leading silence is
 *   measured and skipped with start(when, offset). Never decoded during a stream.
 * - Sounds are scheduled on the audio clock with start(when). atPerf(perfMs) maps a performance.now() time to the
 *   audio clock via getOutputTimestamp() (falls back to currentTime − base/output latency).
 * - latency() reports baseLatency/outputLatency (ms) for the block log; auditory RTs are "estimated" (SPEC-core).
 * - iOS: session(true) sets navigator.audioSession.type = 'playback' (plays with the silent switch on) during
 *   audio blocks; session(false) restores 'auto'. Feature-detected and guarded.
 * - If the context stops running during an audio block, HF.timing pauses the block (it polls state()).
 * - speechSynthesis is never used here.
 *
 * HF.audio:
 *   unlock() → Promise<{ ok, state, clips: <decoded count>, latency }>   (call inside a click/keydown handler)
 *   state() → 'none'|'suspended'|'running'|'interrupted'|'closed'|'unsupported'
 *   tone(index, when?, { durationMs = 400, rampMs = 8, gain = 0.5, type = 'triangle' }?) → { when, freq, duration } | null
 *   clip(id, when?, { gain = 1 }?) → { when, duration } | null       (null if that clip is not decoded)
 *   hasClips() → bool (clip data shipped);  clipIds() → [decoded ids]
 *   now() → audio clock seconds;  atPerf(perfMs) → audio time | null;  latency() → { baseMs, outputMs, sampleRate, state }
 *   stopAll() (stops every scheduled/playing sound);  setVolume(0..1) (default: settings.volume)
 *   session(on);  onState(cb) → off;  soundCheck({ letters }?) → Promise<{ ok, state, latency, clips, hint }>
 *   TONES_HZ, HINT
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var SEMITONES = [0, 2, 5, 7, 9, 13, 16, 18];
  var BASE_HZ = 329.63; // E4; the set spans E4 … A#5
  var TONES_HZ = SEMITONES.map(function (s) { return Math.round(BASE_HZ * Math.pow(2, s / 12) * 100) / 100; });
  var HINT = 'No sound? Turn the volume up, check the silent switch on an iPhone, and note that Bluetooth headphones add a delay.';

  var ctx = null, master = null, buffers = {}, leads = {}, decodeP = null, active = [], stateSubs = [], vol = null;

  function AC() { return root.AudioContext || root.webkitAudioContext || null; }
  function state() { return ctx ? ctx.state : (AC() ? 'none' : 'unsupported'); }
  function settingsVolume() {
    var st = HF.store;
    var s = st && st.loaded && st.records && st.records.settings;
    return s && typeof s.volume === 'number' ? s.volume : 0.8;
  }
  function applyVolume() {
    if (!master) return;
    var v = vol !== null ? vol : settingsVolume();
    v = v < 0 ? 0 : (v > 1 ? 1 : v);
    if (master.gain.value !== v) master.gain.value = v;
  }
  function setVolume(v) { vol = typeof v === 'number' && isFinite(v) ? v : null; applyVolume(); }

  function create() {
    if (ctx) return ctx;
    var C = AC();
    if (!C) return null;
    try { ctx = new C({ latencyHint: 'interactive' }); }
    catch (e) { try { ctx = new C(); } catch (e2) { ctx = null; return null; } }
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
    ctx.onstatechange = function () {
      var list = stateSubs.slice();
      for (var i = 0; i < list.length; i++) { try { list[i](ctx.state); } catch (e) { if (root.console) console.error(e); } }
      if (ctx.state !== 'running' && HF.timing && HF.timing.busy && HF.timing.usesAudio) HF.timing.pause('audio');
    };
    return ctx;
  }

  function decodeOne(dataUri) {
    var s = String(dataUri), comma = s.indexOf(',');
    var b64 = comma >= 0 ? s.slice(comma + 1) : s;
    var bin = root.atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var ab = bytes.buffer; // fresh buffer for this decode
    return new Promise(function (resolve, reject) {
      try {
        var p = ctx.decodeAudioData(ab, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  function leadingSilence(buf) {
    var d = buf.getChannelData(0), peak = 0, i;
    for (i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; }
    var thr = Math.max(0.005, peak * 0.05);
    for (i = 0; i < d.length; i++) if (Math.abs(d[i]) > thr) break;
    var sec = i / buf.sampleRate - 0.002;
    return sec > 0 && sec < buf.duration ? sec : 0;
  }

  function decodeClips() {
    if (decodeP) return decodeP;
    var src = root.HF_AUDIO_CLIPS;
    if (!src || typeof src !== 'object' || !ctx) { decodeP = Promise.resolve(0); return decodeP; }
    var ids = Object.keys(src);
    decodeP = Promise.all(ids.map(function (id) {
      var p;
      try { p = decodeOne(src[id]); } catch (e) { return null; }
      return p.then(function (buf) { buffers[id] = buf; leads[id] = leadingSilence(buf); }, function () { /* skip a bad clip */ });
    })).then(function () { return Object.keys(buffers).length; });
    return decodeP;
  }

  function latency() {
    if (!ctx) return { baseMs: null, outputMs: null, sampleRate: null, state: state() };
    return {
      baseMs: typeof ctx.baseLatency === 'number' ? Math.round(ctx.baseLatency * 10000) / 10 : null,
      outputMs: typeof ctx.outputLatency === 'number' ? Math.round(ctx.outputLatency * 10000) / 10 : null,
      sampleRate: ctx.sampleRate, state: ctx.state
    };
  }

  function unlock() {
    var c = create();
    if (!c) return Promise.resolve({ ok: false, state: state(), clips: 0, latency: latency() });
    try {
      var b = c.createBuffer(1, 1, c.sampleRate), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) { /* ignore */ }
    var p;
    try { p = c.state === 'running' ? null : c.resume(); } catch (e2) { p = null; }
    return Promise.resolve(p).catch(function () { /* ignore */ })
      .then(function () { return decodeClips(); })
      .then(function (count) { return { ok: c.state === 'running', state: c.state, clips: count || 0, latency: latency() }; });
  }

  function track(src, nodes) {
    active.push(src);
    src.onended = function () {
      var i = active.indexOf(src);
      if (i >= 0) active.splice(i, 1);
      for (var j = 0; j < nodes.length; j++) { try { nodes[j].disconnect(); } catch (e) { /* ignore */ } }
      try { src.disconnect(); } catch (e2) { /* ignore */ }
    };
  }

  function startTime(when) {
    var t = typeof when === 'number' && isFinite(when) ? when : 0;
    return t > ctx.currentTime ? t : ctx.currentTime;
  }

  function tone(index, when, opts) {
    if (!ctx || ctx.state === 'closed') return null;
    opts = opts || {};
    applyVolume();
    var f = TONES_HZ[((index % 8) + 8) % 8];
    var dur = (opts.durationMs || 400) / 1000, ramp = (opts.rampMs || 8) / 1000, gain = opts.gain != null ? opts.gain : 0.5;
    if (ramp * 2 > dur) ramp = dur / 2;
    var t = startTime(when);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = opts.type || 'triangle';
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + ramp);
    g.gain.setValueAtTime(gain, t + dur - ramp);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    track(osc, [g]);
    return { when: t, freq: f, duration: dur };
  }

  function clip(id, when, opts) {
    if (!ctx || ctx.state === 'closed') return null;
    var buf = buffers[id];
    if (!buf) return null;
    applyVolume();
    var t = startTime(when), off = leads[id] || 0;
    var s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    g.gain.value = opts && opts.gain != null ? opts.gain : 1;
    s.connect(g);
    g.connect(master);
    s.start(t, off);
    track(s, [g]);
    return { when: t, duration: buf.duration - off };
  }

  function stopAll() {
    var list = active.slice();
    active = [];
    for (var i = 0; i < list.length; i++) { try { list[i].stop(); } catch (e) { /* ignore */ } }
  }

  function atPerf(perfMs) {
    if (!ctx || ctx.state !== 'running') return null;
    var ts = null;
    try { ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null; } catch (e) { ts = null; }
    if (ts && ts.performanceTime > 0 && isFinite(ts.contextTime)) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    var lat = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    return ctx.currentTime + (perfMs - root.performance.now()) / 1000 - lat;
  }

  function session(on) {
    try {
      var nav = root.navigator;
      if (nav && 'audioSession' in nav && nav.audioSession) nav.audioSession.type = on ? 'playback' : 'auto';
    } catch (e) { /* ignore */ }
  }

  function onState(cb) {
    stateSubs.push(cb);
    return function () { var i = stateSubs.indexOf(cb); if (i >= 0) stateSubs.splice(i, 1); };
  }

  function soundCheck(opts) {
    var useLetters = !!(opts && opts.letters);
    return unlock().then(function (res) {
      if (!res.ok) return { ok: false, state: res.state, latency: latency(), clips: res.clips, hint: HINT };
      var t = ctx.currentTime + 0.1;
      if (useLetters && buffers.C && buffers.H && buffers.K) {
        clip('C', t); clip('H', t + 0.7); clip('K', t + 1.4);
      } else {
        tone(0, t); tone(3, t + 0.5); tone(6, t + 1.0);
      }
      return { ok: true, state: ctx.state, latency: latency(), clips: res.clips, hint: HINT };
    });
  }

  HF.audio = {
    TONES_HZ: TONES_HZ, HINT: HINT,
    unlock: unlock, state: state, tone: tone, clip: clip, now: function () { return ctx ? ctx.currentTime : 0; },
    atPerf: atPerf, latency: latency, stopAll: stopAll, setVolume: setVolume, session: session, onState: onState,
    soundCheck: soundCheck,
    hasClips: function () { var c = root.HF_AUDIO_CLIPS; return !!(c && typeof c === 'object' && Object.keys(c).length); },
    clipIds: function () { return Object.keys(buffers); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
