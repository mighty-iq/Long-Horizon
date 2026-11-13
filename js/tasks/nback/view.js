/* Long-Horizon — n-back views (js/tasks/nback/view.js). Browser only, ES2019, MIT licence. Owner: P1a.
 * Needs HF.sets (cellRC, shapePath, glyphPath, glyphStyle, get, step, name, relPhrase); uses HF.ui.c (pads, icons)
 * and HF.input (key labels, keyboard press echo) when present; HF.audio for sound items.
 *
 * HF.views.nback.create(root, spec, ctx) → view                    docs/dev/contracts-ui.md §1
 *   Item formats (spec from HF.tasks.nback.gen):
 *     grid8 / ring8   a 3×3 grid with an empty centre (a fixation cross); the item lights one outer cell
 *     text            letters, digits, days, months, clock hours, compass points: one large word in a card
 *     shapes, glyphs  drawn from HF.sets.shapePath / glyphPath (+ glyphStyle) in the card
 *     arith           the expression ("9 − 2") in the card
 *     tones, lettersAudio   (Plain, audio only) a sound mark lights while the sound plays
 *     Switch          the item (digit or shape) inside its cell of the grid; the cue WHAT / WHERE above it as a word
 *                     plus an icon, from the item's onset until the next item (no cue on lead-in items)
 *     Dual            pos → the grid, snd → view.sound() (HF.audio.tone(index, when) or HF.audio.clip(letter, when))
 *   Pads: one MATCH pad (J), or POSITION (J) + SOUND (K) for Dual, with labels and key hints (HF.ui.c.pads).
 *   ctx = { assist: { tape }, feedback, hand, keys: { match, match2 }, sound, lab }
 *   ctx.assist.tape — the memory tape: the last n + 1 items small, a dashed frame on the item n back from the coming
 *     one ("2 back" under it). prepare() refreshes it in the blank interval; show() reveals its newest slot.
 *   view = { kind: 'stream', el, pads, needsAudio, prepare(trial), show(trial), hide(trial),
 *            sound(trial, when) (only for specs with sound), feedback(outcome 'good'|'bad', key?), destroy() }
 *   prepare() writes the coming item into hidden elements (runs in a timer during the blank); show() and hide() only
 *   toggle classes (visibility and colour), read nothing and never animate. data-i on the view element = the trial
 *   on screen (tests). Keyboard presses echo on their pad (.is-down for 120 ms); feedback() sets data-fb on the pad
 *   for 260 ms (the player limits it to ≤ 3 per second; colours in css/tasks.css are green / neutral, never red).
 *
 * HF.views.nback.item(setId, item, { mini }) → Node     one item drawn as in the task (rule cards, lessons, tape)
 * HF.views.nback.example(spec | { trackId, set, n, step }) → { items: [Node|'…'], compare: 0, target, label,
 *                                caption } | null      a worked example for the rule card's tape (Plain, Transform)
 * HF.views.nback.formatOf(setId) → 'grid'|'text'|'expr'|'shape'|'glyph'|'audio'
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var views = HF.views || (HF.views = {});
  var doc = root.document;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DEF_KEYS = { match: 'J', match2: 'K', no: 'F' };
  var FB_MS = 260, ECHO_MS = 120;

  // ---------------------------------------------------------------- small DOM helpers
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function append(e, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) { for (var i = 0; i < kids.length; i++) append(e, kids[i]); return; }
    e.appendChild(typeof kids === 'object' ? kids : doc.createTextNode(String(kids)));
  }
  function el(tag, cls, attrs, kids) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) {
      if (!own(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      e.setAttribute(k, v === true ? '' : String(v));
    }
    append(e, kids);
    return e;
  }
  function sv(tag, attrs) {
    var e = doc.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (own(attrs, k) && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
    return e;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function icon(name, cls) {
    if (HF.ui && HF.ui.c && typeof HF.ui.c.icon === 'function') return HF.ui.c.icon(name, { cls: cls });
    return el('span', cls);
  }
  function keyLabel(ctx, key) {
    var k = ctx && ctx.keys && ctx.keys[key];
    if (k) return k;
    try { var l = HF.input && HF.input.labelFor ? HF.input.labelFor(key) : ''; if (l) return l; } catch (e) { /* ignore */ }
    return DEF_KEYS[key] || '';
  }
  function setOf(id) { try { return HF.sets && HF.sets.get ? HF.sets.get(id) : null; } catch (e) { return null; } }

  // ---------------------------------------------------------------- item renderers
  function formatOf(setId) {
    setId = setId || '';
    if (setId === 'grid8' || setId === 'ring8') return 'grid';
    if (setId === 'arith') return 'expr';
    if (setId === 'tones' || setId === 'lettersAudio') return 'audio';
    if (setId === 'shapes') return 'shape';
    if (/^glyphs/.test(setId)) return 'glyph';
    return 'text';
  }
  function svgBox(cls) { return sv('svg', { viewBox: '0 0 100 100', 'class': cls || 'hf-nb__svg', 'aria-hidden': 'true', focusable: 'false' }); }
  function shapeNode(shape, cls) {
    var s = svgBox(cls);
    var d = HF.sets && HF.sets.shapePath ? HF.sets.shapePath(shape) : '';
    s.appendChild(sv('path', { d: d, fill: 'currentColor' }));
    return s;
  }
  function glyphNode(setId, index, cls) {
    var s = svgBox(cls);
    var st = (HF.sets && HF.sets.glyphStyle && HF.sets.glyphStyle(setId)) || {};
    var p = sv('path', { d: HF.sets && HF.sets.glyphPath ? HF.sets.glyphPath(setId, index) : '' });
    if (st.fill) p.setAttribute('fill', 'currentColor');
    else {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', String(st.strokeWidth || 7));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    }
    s.appendChild(p);
    return s;
  }
  /** A small 3×3 grid (SVG) with one outer cell filled; `inner` (an item node) is drawn beside it by the caller. */
  function miniGrid(cell) {
    var s = sv('svg', { viewBox: '0 0 30 30', 'class': 'hf-nb__mini-grid', 'aria-hidden': 'true', focusable: 'false' });
    var on = cell === null || cell === undefined ? null : rc(cell);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
      var lit = on && on[0] === r && on[1] === c;
      s.appendChild(sv('rect', {
        x: c * 10 + 1, y: r * 10 + 1, width: 8, height: 8, rx: 1.5,
        'class': lit ? 'hf-nb__mini-on' : (r === 1 && c === 1 ? 'hf-nb__mini-mid' : 'hf-nb__mini-off')
      }));
    }
    return s;
  }
  function rc(cell) {
    if (HF.sets && HF.sets.cellRC) return HF.sets.cellRC(cell);
    return [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]][cell] || [0, 0];
  }
  function audioMark(num) {
    return el('span', 'hf-nb__aud', null, [icon('sound', 'hf-nb__aud-icon'), num ? el('span', 'hf-nb__aud-num', null, String(num)) : null]);
  }
  function clipNumber(id) {
    var S = setOf('lettersAudio');
    if (!S || !S.items) return null;
    for (var i = 0; i < S.items.length; i++) if (S.items[i].clip === id) return i + 1;
    return null;
  }
  /** One item as a node. opts.mini → the small form used on the tape and in examples. */
  function item(setId, it, opts) {
    opts = opts || {};
    if (!it) return el('span', 'hf-nb__blank');
    if (it.what && it.where) {
      return el('span', 'hf-nb__sw', null, [item(null, it.what, { mini: true }), miniGrid(it.where.cell)]);
    }
    if (it.cell !== undefined && it.cell !== null) return opts.mini ? miniGrid(it.cell) : miniGrid(it.cell);
    if (it.shape) return shapeNode(it.shape, opts.mini ? 'hf-nb__svg hf-nb__svg--mini' : 'hf-nb__svg');
    if (it.glyph) return glyphNode(it.glyph, it.index, opts.mini ? 'hf-nb__svg hf-nb__svg--mini' : 'hf-nb__svg');
    if (it.expr) return el('span', 'hf-nb__expr', null, it.expr);
    if (it.tone !== undefined && it.tone !== null) return opts.mini ? audioMark(it.tone + 1) : icon('sound', 'hf-nb__aud-icon');
    if (it.clip) return opts.mini ? audioMark(clipNumber(it.clip)) : icon('sound', 'hf-nb__aud-icon');
    if (it.number !== undefined) return el('span', 'hf-nb__txt', null, String(it.number));
    return el('span', 'hf-nb__txt', null, it.text !== undefined && it.text !== null ? String(it.text) : '');
  }
  /** Cue icons for Switch: WHAT = three small shapes, WHERE = a grid with one marked cell. */
  function cueIcon(kind) {
    var s = sv('svg', { viewBox: '0 0 24 24', 'class': 'hf-nb__cue-icon', 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'what') {
      s.appendChild(sv('circle', { cx: 6.5, cy: 7, r: 3.5, fill: 'currentColor' }));
      s.appendChild(sv('path', { d: 'M17.5 3.5l4 7h-8z', fill: 'currentColor' }));
      s.appendChild(sv('rect', { x: 8.5, y: 13.5, width: 7, height: 7, rx: 1, fill: 'currentColor' }));
    } else {
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
        s.appendChild(sv('rect', { x: 2 + c * 7, y: 2 + r * 7, width: 6, height: 6, rx: 1,
          fill: r === 0 && c === 2 ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 1.25 }));
      }
    }
    return s;
  }

  // ---------------------------------------------------------------- pads
  function makePads(ctx, defs) {
    var node;
    if (HF.ui && HF.ui.c && typeof HF.ui.c.pads === 'function') {
      node = HF.ui.c.pads({ pads: defs, label: 'Answer buttons' });
    } else {
      node = el('div', 'hf-pads hf-pads--' + defs.length, { role: 'group', 'aria-label': 'Answer buttons' }, defs.map(function (p) {
        return el('button', 'hf-pad hf-pad--' + (p.id === 'match2' ? 'alt' : 'yes'), { type: 'button', 'data-key': p.id, 'aria-keyshortcuts': p.key || null },
          [el('span', 'hf-pad__label', null, p.label), p.key ? el('span', 'hf-pad__key', { 'aria-hidden': 'true' }, el('kbd', 'hf-kbd', null, p.key)) : null]);
      }));
    }
    var list = Array.prototype.slice.call(node.querySelectorAll('[data-key]'));
    var byKey = {};
    list.forEach(function (b) { byKey[b.getAttribute('data-key')] = b; });
    return { el: node, pads: list, byKey: byKey };
  }

  // ---------------------------------------------------------------- view
  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var trials = (spec && spec.trials) || [];
    var streams = (spec && spec.streams) || ['main'];
    var dual = streams.length > 1;
    var sets = (spec && spec.sets) || {};
    var first = trials[0] && trials[0].stim ? trials[0].stim : {};
    var isSwitch = !!(first.main && first.main.where);
    var mainSet = dual ? (sets.pos || 'grid8') : (sets.main || spec.set);
    var whatSet = isSwitch ? (sets.what || spec.set) : null;
    var fmt = isSwitch ? 'switch' : (dual ? 'grid' : formatOf(mainSet));
    var gridLike = fmt === 'grid' || fmt === 'switch';
    var needsAudio = dual || fmt === 'audio';
    var n = (spec.params && spec.params.n) || (spec.meta && spec.meta.n) || spec.leadIn || 1;
    var tapeOn = !!(ctx.assist && ctx.assist.tape);
    var timers = [], destroyed = false;

    var wrap = el('div', 'hf-nb', { 'data-fmt': fmt, 'data-set': mainSet || null, 'data-dual': dual ? 'true' : null, 'data-tape': tapeOn ? 'true' : null });

    // cue (Switch)
    var cueEl = null, cueWords = {}, cueOn = null, cueNext = null;
    if (isSwitch) {
      cueEl = el('div', 'hf-nb__cue', { 'aria-hidden': 'true' });
      ['what', 'where'].forEach(function (k) {
        var w = el('span', 'hf-nb__cueword', { 'data-cue': k }, [cueIcon(k), el('span', 'hf-nb__cuetext', null, k === 'what' ? 'WHAT' : 'WHERE')]);
        cueWords[k] = w;
        cueEl.appendChild(w);
      });
    }

    // stage
    var stage = el('div', 'hf-nb__stage', { 'aria-hidden': 'true' });
    var cells = [], card = null, itemEl = null;
    if (gridLike) {
      var grid = el('div', 'hf-nb__grid');
      for (var c = 0; c < 8; c++) {
        var p = rc(c);
        var cell = el('div', 'hf-nb__cell', { 'data-cell': c });
        cell.style.gridRow = String(p[0] + 1);
        cell.style.gridColumn = String(p[1] + 1);
        var inner = el('span', 'hf-nb__in');
        cell.appendChild(inner);
        grid.appendChild(cell);
        cells.push({ el: cell, inner: inner });
      }
      var mid = el('div', 'hf-nb__cell hf-nb__cell--mid', null, el('span', 'hf-nb__fix'));
      mid.style.gridRow = '2';
      mid.style.gridColumn = '2';
      grid.appendChild(mid);
      stage.appendChild(grid);
    } else {
      itemEl = el('div', 'hf-nb__item');
      card = el('div', 'hf-nb__card', { 'data-fmt': fmt }, itemEl);
      if (fmt === 'audio') itemEl.appendChild(icon('sound', 'hf-nb__aud-icon'));
      stage.appendChild(card);
    }

    // memory tape
    var tape = null, slots = [], tapeNext = null;
    if (tapeOn) {
      tape = el('div', 'hf-nb__tape', { 'aria-hidden': 'true' });
      var row = el('div', 'hf-nb__slots');
      for (var k = 0; k <= n; k++) {
        var s = el('div', 'hf-nb__slot' + (k === 0 ? ' is-compare' : '') + (k === n ? ' is-next' : ''));
        slots.push(s);
        row.appendChild(s);
      }
      row.style.setProperty('--n', String(n + 1));
      tapeNext = slots[n];
      tape.appendChild(row);
      tape.appendChild(el('div', 'hf-nb__tapelabel', null, [el('span', 'hf-nb__tapetag', null, (n === 1 ? '1 back' : n + ' back')), el('span', 'hf-nb__tapehint', null, 'compare the new item with the framed one')]));
    }

    // pads
    var padDefs = dual
      ? [{ id: 'match', label: 'Position', key: keyLabel(ctx, 'match'), icon: 'grid' }, { id: 'match2', label: 'Sound', key: keyLabel(ctx, 'match2'), icon: 'sound' }]
      : [{ id: 'match', label: 'Match', key: keyLabel(ctx, 'match') }];
    var P = makePads(ctx, padDefs);
    var padsWrap = el('div', 'hf-nb__pads', null, P.el);

    append(wrap, [cueEl, stage, tape, padsWrap]);
    rootEl.appendChild(wrap);

    // ------------------------------------------------ prepare / show / hide
    var preparedI = null, nextCell = null, onCell = null, usedInner = null, onCard = false;

    function stimOf(trial) { return (trial && trial.stim) || {}; }
    function prepare(trial) {
      if (!trial || destroyed) return;
      var st = stimOf(trial);
      nextCell = null;
      if (fmt === 'switch') {
        var it = st.main || {};
        var target = it.where ? cells[it.where.cell] : null;
        if (usedInner && (!target || usedInner !== target.inner)) clear(usedInner);
        if (target) {
          clear(target.inner);
          target.inner.appendChild(item(whatSet, it.what));
          usedInner = target.inner;
          nextCell = target.el;
        }
        cueNext = trial.cue ? cueWords[trial.cue] || null : null;
      } else if (gridLike) {
        var pos = dual ? st.pos : st.main;
        nextCell = pos && cells[pos.cell] ? cells[pos.cell].el : null;
      } else if (fmt !== 'audio') {
        clear(itemEl);
        itemEl.appendChild(item(mainSet, st.main));
      }
      if (tape) updateTape(trial.i);
      preparedI = trial.i;
    }
    function show(trial) {
      if (destroyed || !trial) return;
      if (preparedI !== trial.i) prepare(trial);
      if (nextCell) { nextCell.classList.add('is-on'); onCell = nextCell; }
      if (card) { card.classList.add('is-on'); onCard = true; }
      if (cueEl) {
        if (cueOn && cueOn !== cueNext) cueOn.classList.remove('is-on');
        if (cueNext) cueNext.classList.add('is-on');
        cueOn = cueNext;
      }
      if (tapeNext) tapeNext.classList.add('is-on');
      wrap.setAttribute('data-i', String(trial.i));
    }
    function hide() {
      if (destroyed) return;
      if (onCell) { onCell.classList.remove('is-on'); onCell = null; }
      if (card && onCard) { card.classList.remove('is-on'); onCard = false; }
    }
    function updateTape(i) {
      for (var k2 = 0; k2 <= n; k2++) {
        var idx = i - n + k2, slot = slots[k2];
        clear(slot);
        var has = idx >= 0 && trials[idx];
        if (has) slot.appendChild(miniOf(trials[idx]));
        slot.classList.toggle('is-empty', !has);
      }
      if (tapeNext) tapeNext.classList.remove('is-on');
    }
    function miniOf(trial) {
      var st = stimOf(trial);
      if (dual) return el('span', 'hf-nb__dualmini', null, [item('grid8', st.pos, { mini: true }), item(sets.snd, st.snd, { mini: true })]);
      return item(mainSet, st.main, { mini: true });
    }

    // ------------------------------------------------ sound
    function sound(trial, when) {
      if (destroyed || when === null || when === undefined || !HF.audio) return;
      var st = stimOf(trial), it = dual ? st.snd : st.main;
      if (!it) return;
      try {
        if (it.clip) HF.audio.clip(it.clip, when);
        else if (it.tone !== undefined && it.tone !== null) HF.audio.tone(it.tone, when);
      } catch (e) { if (root.console) console.error(e); }
    }

    // ------------------------------------------------ feedback and press echo
    function later(fn, ms) { var h = setTimeout(function () { var j = timers.indexOf(h); if (j >= 0) timers.splice(j, 1); fn(); }, ms); timers.push(h); return h; }
    var fbTimers = {};
    function feedback(outcome, key) {
      if (destroyed) return;
      var pad = P.byKey[key || 'match'] || P.pads[0];
      if (!pad) return;
      var k = pad.getAttribute('data-key');
      pad.setAttribute('data-fb', outcome === 'good' ? 'good' : 'bad');
      if (fbTimers[k]) clearTimeout(fbTimers[k]);
      fbTimers[k] = later(function () { fbTimers[k] = null; pad.removeAttribute('data-fb'); }, FB_MS);
    }
    var echoTimers = {};
    var offEcho = HF.input && HF.input.on ? HF.input.on(function (ev) {
      if (destroyed || ev.src !== 'key') return;
      var pad = P.byKey[ev.key];
      if (!pad) return;
      pad.classList.add('is-down');
      if (echoTimers[ev.key]) clearTimeout(echoTimers[ev.key]);
      echoTimers[ev.key] = later(function () { echoTimers[ev.key] = null; pad.classList.remove('is-down'); }, ECHO_MS);
    }) : null;

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      timers.forEach(function (h) { clearTimeout(h); });
      timers = [];
      if (offEcho) offEcho();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    var view = {
      kind: 'stream', type: fmt, el: wrap, pads: P.pads, needsAudio: needsAudio, spec: spec,
      prepare: prepare, show: show, hide: hide, feedback: feedback, destroy: destroy
    };
    if (needsAudio) view.sound = sound;
    return view;
  }

  // ---------------------------------------------------------------- rule-card example
  function example(o) {
    o = o || {};
    var tid = o.trackId;
    if (tid !== 'nback.plain' && tid !== 'nback.transform') return null;
    var setId = (o.sets && o.sets.main) || o.set;
    var S = setOf(setId);
    if (!S || S.kind === 'audio' || !S.items || S.items.length < 3) return null;
    var n = (o.params && o.params.n) || o.n || 2;
    var step = (o.params && o.params.step) || o.step || 1;
    var tf = tid === 'nback.transform';
    var a0 = tf && setId === 'days' ? 1 : 0;
    var firstIt = S.items[a0];
    var lastIt = tf ? (HF.sets.step ? HF.sets.step(S, firstIt, step) : S.items[(a0 + step) % S.items.length]) : firstIt;
    var key = HF.sets.key ? HF.sets.key : function (x) { return JSON.stringify(x); };
    var others = S.items.filter(function (x) { return key(x) !== key(firstIt) && key(x) !== key(lastIt); });
    function rel(x, y) { return tf ? key(HF.sets.step(S, x, step)) === key(y) : key(x) === key(y); }
    // Layout: [lead filler for 1-back] A [n − 1 fillers] B [a trailing filler], so the tape reads like a stream
    // (K, T, K, R). Fillers are chosen so that nothing else in the strip matches at lag n, and nothing repeats.
    var compressed = n > 4;
    var lead = n === 1 ? 1 : 0, mid = compressed ? 2 : n - 1;
    var seq = [], fixed = {};
    for (var p = 0; p < lead; p++) seq.push(null);
    var ai = seq.length; seq.push(firstIt); fixed[ai] = 1;
    for (var q = 0; q < mid; q++) seq.push(null);
    if (compressed) seq.push('…');
    var target = seq.length; seq.push(lastIt); fixed[target] = 1;
    if (seq.length < 5) seq.push(null);
    var lag = compressed ? -1 : n, pick = 0;
    for (var j = 0; j < seq.length; j++) {
      if (seq[j] !== null) continue;
      var chosen = null;
      for (var t = 0; t < others.length && !chosen; t++) {
        var cand = others[(pick + t) % others.length], ok = true;
        if (j > 0 && seq[j - 1] && seq[j - 1] !== '…' && key(seq[j - 1]) === key(cand)) ok = false;
        if (ok && lag > 0 && j - lag >= 0 && seq[j - lag] && seq[j - lag] !== '…' && rel(seq[j - lag], cand)) ok = false;
        if (ok && lag > 0 && j + lag < seq.length && fixed[j + lag] && rel(cand, seq[j + lag])) ok = false;
        if (ok) { chosen = cand; pick = (pick + t + 2) % others.length; }
      }
      seq[j] = chosen || others[j % others.length];
    }
    var nodes = seq.map(function (x) { return x === '…' ? '…' : item(setId, x, { mini: true }); });
    function nm(x) { var v = HF.sets.name ? HF.sets.name(x) : null; return v === null || v === undefined ? null : String(v); }
    var back = n === 1 ? '1 back' : n + ' back';
    var label, caption;
    if (tf) {
      var phrase = HF.sets.rulePhrase ? HF.sets.rulePhrase(S, step) : 'the next one';
      label = n === 1 ? back : back + ': ' + phrase;
      var rel = HF.sets.relPhrase ? HF.sets.relPhrase(S, step) : phrase;
      caption = nm(lastIt) && nm(firstIt) ? 'Press: ' + nm(lastIt) + ' is ' + rel + ' ' + nm(firstIt) + ', ' + back + '.' : 'Press: it follows the rule from ' + back + '.';
    } else {
      label = n === 1 ? back : back + ': same ' + (S.noun || 'item');
      caption = nm(firstIt) ? 'Press: ' + nm(firstIt) + ' was ' + back + '.' : 'Press: the same ' + (S.noun || 'item') + ' was ' + back + '.';
    }
    return { items: nodes, seq: seq, compare: ai, target: target, label: label, caption: caption, dim: seq.length > target + 1 ? [target + 1] : [] };
  }

  views.nback = { create: create, item: item, example: example, formatOf: formatOf, miniGrid: miniGrid };
})(typeof window !== 'undefined' ? window : globalThis);
