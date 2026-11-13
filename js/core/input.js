/* Long-Horizon — logical input keys from keyboard and touch pads (browser only). MIT licence.
 *
 * Logical keys: match, match2, no, pause, next. Physical keys come from settings.keys (event.code values, so any
 * keyboard layout works): defaults match KeyJ, match2 KeyK, no KeyF, pause [Escape, KeyP], next Space.
 * Mapping source, in order: setKeys() override → HF.store.records.settings.keys (once the store is loaded) →
 * HF.schema defaults.
 *
 * Keyboard: keydown on window (bubble phase, so an open <dialog> can stop Escape first). Ignored: e.repeat, keys
 * already held (own set, cleared on keyup/blur/hidden), Ctrl/Meta/Alt chords, typing in form fields, any key while
 * a modal dialog is open, and `next` (Space) when focus is on a button/link (the native click handles it).
 * While a block runs (HF.timing.busy), mapped keys get preventDefault (no scrolling, no button activation).
 * Touch/mouse pads: elements with data-key="match|match2|no" act on pointerdown of ANY pointer (left button for a
 * mouse), so two thumbs on two pads at once both count (Dual). Pads are tracked per pointerId: a pointerdown on a pad
 * that another pointer still holds is ignored; each pad keeps class "is-down" until the last pointer holding it
 * goes up (pointerup / pointercancel, released per pointer). Keyboard-generated clicks on a pad (Enter on a focused
 * pad, switch access) also count, with src 'kbd'. Disabled / aria-disabled pads are ignored.
 * Timestamps: event.timeStamp (same clock as performance.now()); invalid values fall back to performance.now().
 *
 * HF.input:
 *   on(fn) → off()     fn({ key, t, src: 'key'|'touch'|'mouse'|'pen'|'kbd', code, el? }) for every logical input
 *   setKeys(keys|null) override the mapping (null = back to settings)
 *   keys() → mapping in use;  keyFor(code) → logical key | null;  codesFor(key) → [codes]
 *   labelFor(key) → 'J' (display label of the first code; uses the real layout where the browser tells it)
 *   codeLabel(code) → 'J' | 'Space' | 'Esc' | '←' …
 *   time(event) → validated timestamp
 *   held() → number of keys currently held
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  var LOGICAL = ['match', 'match2', 'no', 'pause', 'next'];
  var PAD_KEYS = { match: 1, match2: 1, no: 1 };
  var FALLBACK_KEYS = { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' };
  var subs = [], heldKeys = {}, override = null, mapSrc = null, mapCache = null, layout = null;
  var downPads = {}; // pointerId → pad held by that pointer (several fingers at once: Dual two-thumb presses, CA-06)

  function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }

  function time(e) {
    var now = perfNow();
    var t = e && e.timeStamp;
    if (typeof t !== 'number' || !isFinite(t) || t <= 0 || t > now + 5 || t < now - 10000) return now;
    return t;
  }

  function currentKeys() {
    if (override) return override;
    var st = HF.store;
    var s = st && st.loaded && st.records && st.records.settings;
    if (s && s.keys) return s.keys;
    return (HF.schema && HF.schema.SETTINGS_DEFAULTS && HF.schema.SETTINGS_DEFAULTS.keys) || FALLBACK_KEYS;
  }

  function codeMap() {
    var k = currentKeys();
    if (k === mapSrc && mapCache) return mapCache;
    var m = {};
    for (var i = 0; i < LOGICAL.length; i++) {
      var name = LOGICAL[i], v = k[name];
      if (!v) continue;
      var codes = Array.isArray(v) ? v : [v];
      for (var j = 0; j < codes.length; j++) if (!m[codes[j]]) m[codes[j]] = name;
    }
    mapSrc = k; mapCache = m;
    return m;
  }

  function keyFor(code) { return codeMap()[code] || null; }
  function codesFor(name) {
    var v = currentKeys()[name];
    return v ? (Array.isArray(v) ? v.slice() : [v]) : [];
  }

  var NAMED = {
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[',
    BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', ShiftLeft: 'Shift', ShiftRight: 'Shift'
  };
  function codeLabel(code) {
    if (!code) return '';
    if (layout && typeof layout.get === 'function') {
      var l = layout.get(code);
      if (l && l.length === 1 && l !== ' ') return l.toUpperCase();
    }
    if (NAMED[code]) return NAMED[code];
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code);
    if (m) return 'Num ' + m[1];
    return code;
  }
  function labelFor(name) { var c = codesFor(name); return c.length ? codeLabel(c[0]) : ''; }

  function emit(ev) {
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (err) { if (root.console) console.error(err); }
    }
  }
  function on(fn) {
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

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
  function isInteractive(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT' || tag === 'SELECT' ||
      tag === 'TEXTAREA' || t.getAttribute('role') === 'button';
  }
  function modalOpen() { return !!(HF.dom && HF.dom.openModals && HF.dom.openModals() > 0); }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var code = e.code;
    if (!code) return;
    var name = codeMap()[code];
    if (!name) return;
    var running = !!(HF.timing && HF.timing.busy);
    if (e.repeat || heldKeys[code]) { if (running) e.preventDefault(); return; }
    if (isEditable(e.target) || modalOpen()) return;
    if (name === 'next' && !running && isInteractive(e.target)) return;
    heldKeys[code] = true;
    if (running) e.preventDefault();
    emit({ key: name, t: time(e), src: 'key', code: code });
  }
  function onKeyUp(e) { if (e.code) delete heldKeys[e.code]; }
  function clearHeld() { heldKeys = {}; releaseAll(); }

  function padOf(target) {
    var pad = target && target.closest ? target.closest('[data-key]') : null;
    if (!pad) return null;
    var name = pad.getAttribute('data-key');
    if (!PAD_KEYS[name]) return null;
    if (pad.disabled || pad.getAttribute('aria-disabled') === 'true') return null;
    return pad;
  }
  function padHeld(pad) {
    for (var id in downPads) if (Object.prototype.hasOwnProperty.call(downPads, id) && downPads[id] === pad) return true;
    return false;
  }
  function releasePointer(e) {
    var id = e ? e.pointerId : undefined;
    var pad = downPads[id];
    if (!pad) return;
    delete downPads[id];
    if (!padHeld(pad)) pad.classList.remove('is-down');
  }
  function releaseAll() {
    for (var id in downPads) if (Object.prototype.hasOwnProperty.call(downPads, id)) downPads[id].classList.remove('is-down');
    downPads = {};
  }
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var pad = padOf(e.target);
    if (!pad) return;
    e.preventDefault();
    if (padHeld(pad)) return;               // this pad is already held by another pointer: one press per pad
    if (downPads[e.pointerId]) releasePointer(e); // a stale entry (its pointerup was never seen)
    downPads[e.pointerId] = pad;
    pad.classList.add('is-down');
    emit({ key: pad.getAttribute('data-key'), t: time(e), src: e.pointerType || 'touch', code: null, el: pad });
  }
  function onPadClick(e) {
    if (e.detail !== 0) return; // pointer clicks were handled on pointerdown
    var pad = padOf(e.target);
    if (!pad) return;
    emit({ key: pad.getAttribute('data-key'), t: perfNow(), src: 'kbd', code: null, el: pad });
  }

  function setKeys(keys) { override = keys || null; mapSrc = null; mapCache = null; }

  function readLayout() {
    try {
      var kb = root.navigator && root.navigator.keyboard;
      if (!kb || typeof kb.getLayoutMap !== 'function') return;
      if (HF.dom && HF.dom.allows && !HF.dom.allows('keyboard-map')) return;
      kb.getLayoutMap().then(function (m) { layout = m; }, function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  if (doc && typeof root.addEventListener === 'function') {
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('blur', clearHeld);
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') clearHeld(); });
    doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    doc.addEventListener('pointerup', releasePointer, true);
    doc.addEventListener('pointercancel', releasePointer, true);
    doc.addEventListener('click', onPadClick, true);
    readLayout();
  }

  HF.input = {
    on: on, setKeys: setKeys, keys: currentKeys, keyFor: keyFor, codesFor: codesFor,
    labelFor: labelFor, codeLabel: codeLabel, time: time,
    held: function () { return Object.keys(heldKeys).length; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
