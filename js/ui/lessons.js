/* Long-Horizon — lessons: the tutorial, just-in-time lessons, untimed practice (browser only). MIT licence. Owner: P4.
 *
 * HF.ui.lessons (contracts-ui §3):
 *   needed(trackId, records?) → lessonId | null   the lesson to run before a track's first block: its catalog lesson,
 *                                                 unless passed, or failed twice (then the assisted path or plain
 *                                                 training takes over), or the n-back assist path is on
 *   run(lessonId, root, opts?) → Promise<{ passed, assisted, quit? }>
 *        opts: { replay (no events; default = already passed), from: 'welcome'|'session'|'learn', onStep(info) }
 *        Writes EventRecords via HF.store.mutate (never during a timed run):
 *          lesson-passed { lessonId }   lesson-failed { lessonId }   (one per failed check)
 *          assist-start { trackId }     after the second failed check of lesson.nback ('nback.plain') or lesson.grid
 *                                       ('rel.grid.T1', only if no other assist is active); derive turns that track's
 *                                       rated blocks into assisted ones until 2 reach criterion ('assist-faded')
 *        Tutorial data are never logged as training: no BlockRecords, no trial logs, no engine commit.
 *   list() → [ { id, title, trackIds, minutes, kind, summary, passed, failed } ]
 *   practice(root, { trackId, rung?, set? }) → Promise   untimed self-paced practice (tape on, nothing saved)
 *   abort() → bool       stops the active lesson/practice (route leave); its promise resolves { passed: false, quit: true }
 *   active() → bool
 *   config: { usePlayer: true, useViews: true }   timed runs: HF.player → HF.timing + HF.views[key] → own view
 *   _state() → { lessonId, step, phase, trial, expect, probe, line, ... }   (e2e tests read it)
 *
 * Self-paced steps use the guided runner below; every feedback text comes from the task scorer's why[] for that trial
 * (HF.tasks.nback.score / HF.tasks.relations.score / HF.tasks.span.score / HF.tasks.vsearch.score), i.e. from the same
 * rule that grades. Timed steps and checks use HF.player.runBlock/runSpec (commit: false) when present, else
 * HF.timing.runStream/runDiscrete with HF.views[key], else with this file's own minimal view.
 * Texts and scripts live in js/content/lessons.js (HF.content.lessons).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;

  var CANCEL = { cancelled: true };
  var config = { usePlayer: true, useViews: true, timeScale: 1 };   // timeScale: e2e test hook only (core path)
  var STATE = {};
  var activeCtx = null;

  function C() { return HF.content.lessons; }
  function c() { return ui.c; }
  function h(tag, attrs, kids) { return ui.c.h(tag, attrs, kids); }
  function S(tag, attrs, kids) { return ui.c.svg(tag, attrs, kids); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function log(e) { if (root.console && e !== CANCEL) console.error('[long-horizon] lessons', e); }
  function setState(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) STATE[k] = o[k]; }
  function keyLabel(name, dflt) {
    try { if (HF.input && HF.input.labelFor) { var l = HF.input.labelFor(name); if (l) return l; } } catch (e) { /* ignore */ }
    return dflt;
  }
  function focusEl(el) {
    if (!el) return;
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* ignore */ } }
  }
  function scrollTop(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > (root.innerHeight || 800) * 0.5) el.scrollIntoView({ block: 'start' });
    } catch (e) { /* ignore */ }
  }

  /** Scroll as little as needed so an element (the answer controls) is fully visible above a phone's tab bar. */
  function reveal(el) {
    try {
      if (!el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect(), vh = root.innerHeight || 800;
      var rem = parseFloat(root.getComputedStyle(doc.documentElement).fontSize) || 16;
      var bar = (root.innerWidth || 1000) < 900 && (!ui.shell || !ui.shell.chrome || ui.shell.chrome()) ? 4.75 * rem : 0.5 * rem;
      var over = r.bottom - (vh - bar);
      if (over > 0) root.scrollBy(0, Math.min(over, Math.max(0, r.top - 8)));
    } catch (e) { /* layout not available */ }
  }

  // ======================================================================== records and events
  function records() { return (HF.store && HF.store.records) || { events: [] }; }
  function lessonStatus(lessonId, recs) {
    var ev = (recs || records()).events || [], passed = null, failed = 0, assistStart = null, tr = assistTrackFor(lessonId);
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i]; if (!e) continue;
      if (e.type === 'lesson-passed' && e.lessonId === lessonId && passed === null) passed = e.t;
      else if (e.type === 'lesson-failed' && e.lessonId === lessonId) failed++;
      // assistance is per track (the engine keeps one per track): only this lesson's own track counts
      else if (e.type === 'assist-start' && tr && (e.trackId || 'nback.plain') === tr) assistStart = e;
    }
    return { passed: passed, failed: failed, assistStart: assistStart };
  }
  function assistTrackFor(lessonId) {
    return lessonId === 'lesson.nback' ? 'nback.plain' : (lessonId === 'lesson.grid' ? 'rel.grid.T1' : null);
  }
  function assistActive() {
    try { var d = HF.store && HF.store.derived; return !!(d && d.assist && d.assist.active); } catch (e) { return false; }
  }
  function addEvent(type, payload) {
    if (!HF.store || typeof HF.store.mutate !== 'function') return null;
    var ev = { id: (HF.util && HF.util.id) ? HF.util.id('e') : 'e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), t: Date.now(), type: type };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) ev[k] = payload[k];
    try {
      HF.store.mutate(function (r) { if (!Array.isArray(r.events)) r.events = []; r.events.push(ev); });
      if (HF.store.flush) HF.store.flush();
    } catch (e) { log(e); }
    return ev;
  }

  function needed(trackId, recs) {
    var tr = HF.catalog && HF.catalog.get(trackId);
    var id = tr ? tr.lessonId : (C() ? C().forTrack(trackId) : null);
    if (!id || !C().get(id)) return null;
    var st = lessonStatus(id, recs);
    if (st.passed !== null) return null;
    if (st.failed >= 2) return null;                                   // assisted path or plain training takes over
    if (id === 'lesson.nback' && st.assistStart && (st.assistStart.trackId || 'nback.plain') === 'nback.plain') return null;
    return id;
  }

  function list() {
    var recs = records();
    return C().LIST.map(function (l) {
      var st = lessonStatus(l.id, recs);
      return { id: l.id, title: l.title, trackIds: l.trackIds.slice(), minutes: l.minutes, kind: l.kind, summary: l.summary,
        passed: st.passed !== null, failed: st.failed };
    });
  }

  // ======================================================================== sets and items
  function soundSet() {
    var s = (records().settings || {}).sound;
    try { if (s === 'letters' && HF.sets.available('lettersAudio')) return 'lettersAudio'; } catch (e) { /* ignore */ }
    return 'tones';
  }
  function findItem(setId, name) {
    var set = HF.sets.get(setId);
    if (!set) throw new Error('lessons: unknown set ' + setId);
    for (var i = 0; i < set.items.length; i++) {
      var it = set.items[i];
      if (it.text === name || it.expr === name || HF.sets.name(it) === name || String(it.number) === String(name)) return it;
    }
    throw new Error('lessons: no item "' + name + '" in ' + setId);
  }
  function itemName(it) {
    if (!it) return '';
    if (it.what) return HF.sets.name(it.what) + ' ' + (HF.sets.name(it.where) || '');
    var n = null;
    try { n = HF.sets.name(it); } catch (e) { n = null; }
    if (n !== null && n !== undefined) return String(n);
    if (it.text) return it.text;
    if (it.expr) return it.expr;
    if (isNum(it.number)) return String(it.number);
    return '';
  }

  // ======================================================================== rendering
  function cellRC(cell) {
    if (HF.sets && HF.sets.cellRC) return HF.sets.cellRC(cell);
    return [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]][cell] || [1, 1];
  }
  function shapeId(it) { return it.shape; }
  function shapeSvg(id, cls) {
    var p = HF.sets.shapePath(id);
    return S('svg', { viewBox: '0 0 100 100', 'class': cls || 'hf-lshape', 'aria-hidden': 'true', focusable: 'false' }, [S('path', { d: p, fill: 'currentColor' })]);
  }
  function glyphSvg(setId, index, cls) {
    var st = HF.sets.glyphStyle(setId) || {}, d = HF.sets.glyphPath(setId, index);
    var attrs = st.fill ? { d: d, fill: 'currentColor' } : { d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': st.strokeWidth || 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    return S('svg', { viewBox: '0 0 100 100', 'class': cls || 'hf-lshape', 'aria-hidden': 'true', focusable: 'false' }, [S('path', attrs)]);
  }
  /** 3×3 grid with the centre left empty; `cell` filled, or `symbol` (node factory) drawn inside it. */
  function gridSvg(cell, o) {
    o = o || {};
    var kids = [];
    for (var r = 0; r < 3; r++) for (var col = 0; col < 3; col++) {
      kids.push(S('rect', { x: col * 30 + 2, y: r * 30 + 2, width: 26, height: 26, rx: 4,
        'class': 'hf-lgrid__cell' + (r === 1 && col === 1 ? ' is-centre' : '') }));
    }
    if (isNum(cell)) {
      var rc = cellRC(cell);
      if (o.symbol) {
        kids.push(S('rect', { x: rc[1] * 30 + 2, y: rc[0] * 30 + 2, width: 26, height: 26, rx: 4, 'class': 'hf-lgrid__hold' }));
        kids.push(o.symbol(rc[1] * 30 + 15, rc[0] * 30 + 15));
      } else {
        kids.push(S('rect', { x: rc[1] * 30 + 4, y: rc[0] * 30 + 4, width: 22, height: 22, rx: 3, 'class': 'hf-lgrid__on' }));
      }
    }
    return S('svg', { viewBox: '0 0 90 90', 'class': 'hf-lgrid' + (o.cls ? ' ' + o.cls : ''), 'aria-hidden': 'true', focusable: 'false' }, kids);
  }
  function toneSvg(k) {
    var kids = [S('line', { x1: 6, y1: 4, x2: 6, y2: 36, 'class': 'hf-ltone__axis' })];
    for (var i = 0; i < 8; i++) kids.push(S('line', { x1: 10, y1: 36 - i * 4.4, x2: 34, y2: 36 - i * 4.4, 'class': 'hf-ltone__rung' }));
    kids.push(S('circle', { cx: 22, cy: 36 - k * 4.4, r: 3.6, 'class': 'hf-ltone__dot' }));
    return S('svg', { viewBox: '0 0 40 40', 'class': 'hf-ltone', 'aria-hidden': 'true', focusable: 'false' }, kids);
  }
  function switchSymbol(what) {
    return function (x, y) {
      if (what.shape) {
        var p = HF.sets.shapePath(what.shape);
        return S('g', { transform: 'translate(' + (x - 10) + ',' + (y - 10) + ') scale(0.2)' }, [S('path', { d: p, 'class': 'hf-lgrid__sym' })]);
      }
      return S('text', { x: x, y: y + 6.5, 'text-anchor': 'middle', 'class': 'hf-lgrid__txt' }, [String(what.text)]);
    };
  }

  /** Big stage node for one item. size: 'stage' | 'mini'. */
  function itemNode(it, size, extra) {
    extra = extra || {};
    var mini = size === 'mini';
    if (!it) return h('span', { 'class': 'hf-litem hf-litem--empty' }, []);
    if (it.what) {   // Switch: symbol in a place, cue above (stage only)
      if (mini) {     // tape: the symbol large, its place as a small grid underneath
        var sym = it.what.shape ? shapeSvg(it.what.shape, 'hf-lshape hf-lshape--tiny') : h('span', { 'class': 'hf-litem__sym' }, [String(it.what.text)]);
        return h('span', { 'class': 'hf-litem hf-litem--sw' }, [sym, gridSvg(it.where.cell, { cls: 'hf-lgrid--mini hf-lgrid--where' })]);
      }
      var g = gridSvg(it.where.cell, { symbol: switchSymbol(it.what), cls: '' });
      return h('span', { 'class': 'hf-litem hf-litem--switch' }, [
        extra.cue ? h('span', { 'class': 'hf-lcue hf-lcue--' + extra.cue }, [extra.cue === 'where' ? 'WHERE' : 'WHAT']) : h('span', { 'class': 'hf-lcue hf-lcue--none' }, [' ']),
        g
      ]);
    }
    if (isNum(it.cell)) return h('span', { 'class': 'hf-litem hf-litem--grid' }, [gridSvg(it.cell, { cls: mini ? 'hf-lgrid--mini' : '' })]);
    if (isNum(it.tone)) {
      if (mini) return h('span', { 'class': 'hf-litem hf-litem--tone' }, [toneSvg(it.tone), h('span', { 'class': 'hf-litem__sub' }, [String(it.tone + 1)])]);
      return h('span', { 'class': 'hf-litem hf-litem--sound' }, [c().icon('sound'), h('span', { 'class': 'hf-litem__sub' }, ['Listen'])]);
    }
    if (it.clip) {
      if (mini) return h('span', { 'class': 'hf-litem hf-litem--text' }, ['“' + it.clip + '”']);
      return h('span', { 'class': 'hf-litem hf-litem--sound' }, [c().icon('sound'), h('span', { 'class': 'hf-litem__sub' }, ['Listen'])]);
    }
    if (it.shape) return h('span', { 'class': 'hf-litem hf-litem--shape' }, [shapeSvg(it.shape)]);
    if (it.glyph) return h('span', { 'class': 'hf-litem hf-litem--shape' }, [glyphSvg(it.glyph, it.index)]);
    if (it.expr) return h('span', { 'class': 'hf-litem hf-litem--expr' }, [it.expr]);
    if (isNum(it.number)) return h('span', { 'class': 'hf-litem hf-litem--num' }, [String(it.number)]);
    return h('span', { 'class': 'hf-litem hf-litem--text' }, [String(it.text)]);
  }

  // Relation Grid / Stream cells -----------------------------------------------------------------
  var FILL_IDS = {};
  function fillPattern(fill, uid) {
    // patterns, not colours (T6); drawn with currentColor
    var id = 'hf-lfill-' + fill + '-' + uid;
    FILL_IDS[fill] = id;
    var kids;
    if (fill === 'hlines') kids = [S('rect', { x: 0, y: 0, width: 8, height: 3, fill: 'currentColor' })];
    else if (fill === 'vlines') kids = [S('rect', { x: 0, y: 0, width: 3, height: 8, fill: 'currentColor' })];
    else if (fill === 'dots') kids = [S('circle', { cx: 4, cy: 4, r: 1.8, fill: 'currentColor' })];
    else if (fill === 'checks') kids = [S('rect', { x: 0, y: 0, width: 4, height: 4, fill: 'currentColor' }), S('rect', { x: 4, y: 4, width: 4, height: 4, fill: 'currentColor' })];
    else return null;
    return S('pattern', { id: id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' }, kids);
  }
  var uidSeq = 0;
  function t6Svg(cellObj, shapeSet) {
    var uid = (++uidSeq).toString(36);
    var shape = (HF.sets.get(shapeSet || 'shapes') || HF.sets.get('shapes')).items[cellObj.shape];
    var d = shape && shape.shape ? HF.sets.shapePath(shape.shape) : (shape && shape.glyph ? HF.sets.glyphPath(shape.glyph, shape.index) : HF.sets.shapePath('circle'));
    var defs = [], fill = cellObj.fill, pat = fillPattern(fill, uid);
    if (pat) defs.push(pat);
    var paint = fill === 'solid' ? 'currentColor' : (fill === 'empty' ? 'none' : 'url(#' + 'hf-lfill-' + fill + '-' + uid + ')');
    return S('svg', { viewBox: '-6 -6 112 112', 'class': 'hf-lshape hf-lshape--t6', 'aria-hidden': 'true', focusable: 'false' }, [
      defs.length ? S('defs', null, defs) : null,
      S('path', { d: d, fill: paint, stroke: 'currentColor', 'stroke-width': 6, 'stroke-linejoin': 'round' })
    ]);
  }
  function symNode(v, sym, meta) {
    if (v === 'icons') return shapeSvg(HF.sets.get('shapes').items[sym].shape, 'hf-lsym');
    if (v === 'dots') {
      var kids = [], n = +sym;
      for (var i = 0; i < n; i++) kids.push(S('circle', { cx: 12 + (i % 3) * 38, cy: 12 + Math.floor(i / 3) * 38, r: 9, fill: 'currentColor' }));
      return S('svg', { viewBox: '0 0 100 100', 'class': 'hf-lsym', 'aria-hidden': 'true' }, kids);
    }
    if (v === 'bars') return S('svg', { viewBox: '0 0 100 100', 'class': 'hf-lsym', 'aria-hidden': 'true' },
      [S('rect', { x: 44, y: 8, width: 12, height: 84, rx: 6, fill: 'currentColor', transform: 'rotate(' + (sym * 22.5) + ' 50 50)' })]);
    if (v === 'glyphs') return glyphSvg(meta.setId, sym, 'hf-lsym');
    if (v === 'lab') {
      var rc = cellRC(sym);
      return S('svg', { viewBox: '0 0 30 30', 'class': 'hf-lsym', 'aria-hidden': 'true' }, [
        S('rect', { x: 1.5, y: 1.5, width: 27, height: 27, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
        S('circle', { cx: 5 + rc[1] * 10, cy: 5 + rc[0] * 10, r: 3.2, fill: 'currentColor' })]);
    }
    return h('span', null, [String(sym)]);
  }
  /** One cell of a Relation Grid array: a 3-symbol string (text) or [a, b, c]; relevant position highlighted. */
  function arrayCell(cell, meta, o) {
    o = o || {};
    if (cell && typeof cell === 'object' && !Array.isArray(cell) && cell.fill) return h('span', { 'class': 'hf-lacell hf-lacell--t6' }, [t6Svg(cell, meta.setId)]);
    var pos = isNum(meta.relevantPos) ? meta.relevantPos : 2, kids = [];
    for (var k = 0; k < 3; k++) {
      var sym = typeof cell === 'string' ? cell.charAt(k) : cell[k];
      var node = typeof cell === 'string' ? String(sym) : symNode(meta.variant, sym, meta);
      kids.push(h('span', { 'class': 'hf-lacell__s' + (k === pos ? ' is-key' : '') }, [node]));
    }
    return h('span', { 'class': 'hf-lacell' + (o.highlight ? ' is-hl' : '') + (typeof cell === 'string' ? '' : ' hf-lacell--sym') }, kids);
  }
  /** Generator rule texts say MATCH / AND; on screen they read in sentence case, as in the task view. */
  function ruleWords(t) { return String(t || '').replace(/\bMATCH\b/g, 'Match').replace(/\bAND\b/g, 'and'); }
  function viewGrid() { return !!(config.useViews && HF.views && HF.views.relations && typeof HF.views.relations.renderGrid === 'function'); }
  /** Array node: { cells, size }; o: { spec, highlight, lineCells: [i], nearCells, changed: [i] }. Drawn with the Relations
   *  view's own static renderer when it is loaded (the same look as in training), else with this file's renderer. */
  function arrayNode(stim, meta, o) {
    o = o || {};
    if (viewGrid() && !o.own) {
      try {
        var spec0 = o.spec || { meta: meta, params: {}, set: meta && meta.setId };
        var box = HF.views.relations.renderGrid(null, spec0, { stim: { cells: stim.cells || stim.grid } }, { highlight: !!o.highlight, mark: o.lineCells || null });
        var vcells = box.querySelectorAll('.hf-rg__cell');
        (o.nearCells || []).forEach(function (i) { if (vcells[i]) vcells[i].classList.add('is-near'); });
        (o.changed || []).forEach(function (i) { if (vcells[i]) vcells[i].classList.add('is-changed'); });
        box.classList.add('hf-larray-v');
        box.setAttribute('role', 'img');
        box.setAttribute('aria-label', o.label || 'Grid of ' + ((meta && meta.size) || 3) + ' by ' + ((meta && meta.size) || 3) + ' cells');
        return box;
      } catch (e) { log(e); }
    }
    var size = stim.size || (stim.cells.length === 16 ? 4 : 3), cells = stim.cells || stim.grid;
    var mark = {}, near = {}, ch = {};
    (o.lineCells || []).forEach(function (i) { mark[i] = true; });
    (o.nearCells || []).forEach(function (i) { near[i] = true; });
    (o.changed || []).forEach(function (i) { ch[i] = true; });
    var grid = h('div', { 'class': 'hf-larray hf-larray--' + size + (o.highlight ? ' is-hl' : ''), role: 'img',
      'aria-label': o.label || 'Grid of ' + size + ' by ' + size + ' cells' });
    cells.forEach(function (cell, i) {
      var node = arrayCell(cell, meta, o);
      node.className += (mark[i] ? ' is-line' : '') + (near[i] ? ' is-near' : '') + (ch[i] ? ' is-changed' : '');
      grid.appendChild(node);
    });
    return grid;
  }

  // Visual search display ------------------------------------------------------------------------
  function vsNode(stim, o) {
    o = o || {};
    var kids = [];
    stim.items.forEach(function (it, k) {
      var d = it.kind === 'T' ? 'M-3.2 -3.2 H3.2 M0 -3.2 V3.2' : 'M-2.6 -3.2 V3.2 H2.6';
      kids.push(S('path', { d: d, transform: 'translate(' + it.x + ' ' + it.y + ') rotate(' + it.rot + ')',
        'class': 'hf-lvs__item' + (o.showT && it.kind === 'T' ? ' is-t' : ''), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'square' }));
      if (o.showT && it.kind === 'T') kids.push(S('circle', { cx: it.x, cy: it.y, r: 6, 'class': 'hf-lvs__ring', fill: 'none' }));
    });
    return S('svg', { viewBox: '0 0 100 100', 'class': 'hf-lvs', role: 'img', 'aria-label': 'Display of ' + stim.items.length + ' letters' }, kids);
  }

  // ======================================================================== spec builders
  function nbackScore(spec, logx) { return HF.tasks.nback.score(spec, logx); }
  function relScore(spec, logx) { return HF.tasks.relations.score(spec, logx); }
  function scorerFor(spec) {
    if (spec.task === 'nback') return nbackScore;
    if (spec.task === 'relations') return relScore;
    if (spec.task === 'span') return HF.tasks.span.score;
    if (spec.task === 'vsearch') return HF.tasks.vsearch.score;
    throw new Error('lessons: no scorer for ' + spec.task);
  }
  function labelNback(spec) {
    var an = HF.tasks.nback.analyze(spec);
    spec.trials.forEach(function (tr, i) {
      spec.streams.forEach(function (st) { tr.target[st] = !!an[st][i].target; tr.lure[st] = an[st][i].lure || null; });
    });
    return spec;
  }
  /** Build a stream BlockSpec from a hand-built sequence in HF.content.lessons.SEQ. */
  function seqSpec(name, timing) {
    var q = C().SEQ[name];
    if (!q) throw new Error('lessons: unknown sequence ' + name);
    timing = timing || {};
    var onMs = timing.onMs || 500, soaMs = timing.soaMs || 3000;
    if (q.trackId === 'rel.steps') {
      var xs = q.numbers, b = q.back, R = HF.tasks.relations.steps;
      return { kind: 'stream', task: 'relations', trackId: 'rel.steps', seed: 'lesson/' + name, set: 'numbers', rung: 0,
        params: { level: 0, back: b, maxNumber: q.maxNumber || 9, maxStep: 4, pace: 'std', onMs: onMs, soaMs: soaMs }, onMs: onMs, soaMs: soaMs,
        streams: ['main'], leadIn: b + 1, lesson: name,
        trials: xs.map(function (x, i) {
          var j = R.judge(xs, b, i);
          return { i: i, stim: { main: { number: x } }, scorable: j.scorable, target: { main: !!j.target }, lure: { main: j.scorable && !j.target && j.near ? 'near' : null } };
        }),
        meta: { rule: { id: 'equal-steps', back: b, maxNumber: q.maxNumber || 9, unsigned: true } } };
    }
    var n = q.n, trials = [], streams, sets, set = q.set;
    if (q.trackId === 'nback.dual') {
      var snd = soundSet(), sItems = HF.sets.get(snd).items;
      streams = ['pos', 'snd']; sets = { pos: 'grid8', snd: snd }; set = snd;
      q.pos.forEach(function (cell, i) {
        trials.push({ i: i, stim: { pos: { cell: cell }, snd: sItems[q.snd[i] % sItems.length] }, scorable: i >= n, target: { pos: false, snd: false }, lure: { pos: null, snd: null } });
      });
    } else {
      streams = ['main'];
      if (set === 'sound') { set = soundSet(); var its = HF.sets.get(set).items; q.snd.forEach(function (k, i) { trials.push(mkTrial(i, its[k % its.length])); }); }
      else if (q.trackId === 'nback.switch') {
        q.items.forEach(function (x, i) {
          var tr = mkTrial(i, { what: findItem(q.set, x[0]), where: { cell: x[1] } });
          tr.cue = i >= n ? x[2] : null;
          trials.push(tr);
        });
      } else q.items.forEach(function (x, i) { trials.push(mkTrial(i, findItem(set, x))); });
      sets = q.trackId === 'nback.switch' ? { main: set, what: set, where: 'grid8' } : { main: set };
    }
    function mkTrial(i, it) { return { i: i, stim: { main: it }, scorable: i >= n, target: { main: false }, lure: { main: null } }; }
    var spec = { kind: 'stream', task: 'nback', trackId: q.trackId, seed: 'lesson/' + name, set: set, rung: 0,
      params: { n: n, onMs: onMs, soaMs: soaMs }, onMs: onMs, soaMs: soaMs, streams: streams, leadIn: n, sets: sets, trials: trials,
      meta: { n: n, lesson: name }, lesson: name };
    return labelNback(spec);
  }
  function genSpec(o) {
    var tr = HF.catalog.get(o.trackId), task = tr.task;
    var opts = { trackId: o.trackId, rung: o.rung || 0, seed: o.seed, set: o.set };
    if (o.params) opts.params = o.params;
    if (task === 'nback') { opts.lureCount = 4; opts.lureMode = 'controlled'; if (opts.set === 'sound') opts.set = soundSet(); }
    if (task === 'nback') return HF.tasks.nback.gen(opts);
    if (task === 'relations') return HF.tasks.relations.gen(opts);
    if (task === 'span') return HF.tasks.span.gen(opts);
    if (task === 'vsearch') return HF.tasks.vsearch.gen(opts);
    throw new Error('lessons: cannot generate ' + o.trackId);
  }
  function selfLog(spec, answers) {
    // answers: { i: { match: bool, match2: bool } } → a press-only log the scorer understands
    var responses = [];
    Object.keys(answers).forEach(function (k) {
      var i = +k, a = answers[k], t = i * (spec.soaMs || 3000) + 400;
      if (a.match) responses.push({ key: 'match', trial: i, t: t, rt: 400 });
      if (a.match2) responses.push({ key: 'match2', trial: i, t: t, rt: 400 });
    });
    return { responses: responses, voided: [], paused: false };
  }
  function whyAt(spec, answers, i) {
    var res = scorerFor(spec)(spec, selfLog(spec, answers));
    return res.why.filter(function (w) { return w.i === i; });
  }
  function perfectWhy(spec) {
    var ans = {};
    spec.trials.forEach(function (tr) { if (!tr.scorable) return; var a = {}; if (tr.target.main || tr.target.pos) a.match = true; if (tr.target.snd) a.match2 = true; ans[tr.i] = a; });
    return scorerFor(spec)(spec, selfLog(spec, ans)).why;
  }

  // ======================================================================== lesson context: cancellation and waits
  function Ctx(rootEl, lessonId, opts) {
    this.root = rootEl; this.lessonId = lessonId; this.opts = opts || {};
    this.cancelled = false; this.waiters = []; this.timers = []; this.running = false;
  }
  Ctx.prototype.alive = function () { return !this.cancelled && !!this.root && this.root.isConnected !== false; };
  Ctx.prototype.check = function () { if (!this.alive()) throw CANCEL; };
  Ctx.prototype.abort = function () {
    if (this.cancelled) return;
    this.cancelled = true;
    var w = this.waiters.slice(); this.waiters = [];
    w.forEach(function (f) { try { f(); } catch (e) { log(e); } });
    this.timers.forEach(function (t) { clearTimeout(t); }); this.timers = [];
    if (this.running && HF.timing && HF.timing.abort) { try { HF.timing.abort('lesson-left'); } catch (e) { log(e); } }
    if (HF.audio && HF.audio.stopAll) { try { HF.audio.stopAll(); } catch (e) { /* ignore */ } }
    restoreChrome();
    // inside a session the player owns the session-long wake lock; elsewhere the lesson releases what it took
    if (this.opts.from !== 'session' && HF.timing && HF.timing.keepAwake) { try { HF.timing.keepAwake(false); } catch (e) { /* ignore */ } }
  };
  Ctx.prototype.later = function (fn, ms) {
    var self = this, t = setTimeout(function () { var i = self.timers.indexOf(t); if (i >= 0) self.timers.splice(i, 1); if (self.alive()) fn(); }, ms);
    this.timers.push(t); return t;
  };
  Ctx.prototype.sleep = function (ms) { var self = this; return waitFor(this, function (done) { self.later(done, ms); }); };

  /** A promise that resolves when setup calls done(value); rejected with CANCEL when the lesson is left. */
  function waitFor(ctx, setup) {
    return new Promise(function (resolve, reject) {
      if (!ctx.alive()) { reject(CANCEL); return; }
      var finished = false, offs = [];
      function cleanup() {
        offs.forEach(function (f) { try { f(); } catch (e) { log(e); } }); offs = [];
        var i = ctx.waiters.indexOf(cancel); if (i >= 0) ctx.waiters.splice(i, 1);
      }
      function done(v) { if (finished) return; finished = true; cleanup(); resolve(v); }
      function cancel() { if (finished) return; finished = true; cleanup(); reject(CANCEL); }
      ctx.waiters.push(cancel);
      try { setup(done, function (off) { if (typeof off === 'function') offs.push(off); }); }
      catch (e) { finished = true; cleanup(); reject(e); }
    });
  }
  function onInput(fn) { return HF.input && HF.input.on ? HF.input.on(fn) : function () {}; }
  function listen(el, type, fn, o) { el.addEventListener(type, fn, o); return function () { el.removeEventListener(type, fn, o); }; }

  var chromeHidden = false;
  function hideChrome() { try { if (ui.shell && ui.shell.chrome) { ui.shell.chrome(false); chromeHidden = true; } } catch (e) { log(e); } }
  function restoreChrome() { if (!chromeHidden) return; chromeHidden = false; try { ui.shell.chrome(true); } catch (e) { log(e); } }

  // ======================================================================== the lesson frame
  function partsOf(steps) {
    var parts = [], seen = {};
    steps.forEach(function (s) { if (s.part && !seen[s.part]) { seen[s.part] = true; parts.push({ part: s.part, label: s.title }); } });
    return parts;
  }
  function Frame(ctx, lesson, steps, opts) {
    var self = this;
    this.ctx = ctx; this.parts = partsOf(steps);
    this.kicker = h('p', { 'class': 'hf-lesson__kicker' }, [lesson.kind === 'tutorial' ? 'Tutorial' : (lesson.kind === 'intro' ? 'New tier' : 'Lesson'), ' · ', lesson.title]);
    this.bar = h('div', { 'class': 'hf-lesson__bar' });
    this.body = h('section', { 'class': 'hf-lesson__body', 'aria-label': lesson.title });
    this.el = h('div', { 'class': 'hf-page hf-lesson', 'data-lesson': lesson.id }, [
      h('header', { 'class': 'hf-lesson__head' }, [
        h('h1', { 'class': 'hf-vh' }, [lesson.title]),
        this.kicker, this.bar
      ]),
      opts && opts.replay ? h('p', { 'class': 'hf-lesson__replay hf-small hf-muted' }, [C().TEXT.replayNote]) : null,
      this.body
    ]);
    clear(ctx.root);
    ctx.root.appendChild(this.el);
    // Space on a non-interactive element must not scroll the page while the lesson handles it as "Next"
    this.offKey = listen(this.el, 'keydown', function (e) {
      if ((e.code === 'Space' || e.key === ' ') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test((e.target && e.target.tagName) || '')) e.preventDefault();
    });
    ctx.waiters.push(function () { self.offKey(); });
  }
  Frame.prototype.setPart = function (step) {
    var parts = this.parts, cur = -1;
    for (var i = 0; i < parts.length; i++) if (parts[i].part === step.part) cur = i;
    clear(this.bar);
    if (parts.length > 1 && cur >= 0) {
      this.bar.appendChild(c().sessionBar({
        steps: parts.map(function (p, j) { return { label: p.label, state: j < cur ? 'done' : (j === cur ? 'current' : 'todo') }; }),
        unit: 'Part', labels: 'none', now: step.title, label: 'Lesson progress'
      }));
    }
  };
  Frame.prototype.page = function (step, o) {
    o = o || {};
    clear(this.body);
    this.el.classList.remove('is-running');
    if (step) this.setPart(step);
    var head = h('h2', { 'class': 'hf-h2 hf-lesson__title', tabindex: '-1' }, [o.title || (step && step.title) || '']);
    this.body.appendChild(head);
    var lead = o.lead !== undefined ? o.lead : (step && step.lead);
    if (lead) this.body.appendChild(h('p', { 'class': 'hf-lead hf-lesson__lead' }, [lead]));
    var content = h('div', { 'class': 'hf-lesson__content hf-stack' });
    this.body.appendChild(content);
    this.actions = h('div', { 'class': 'hf-actions hf-lesson__actions' });
    this.body.appendChild(this.actions);
    scrollTop(this.el);
    focusEl(head);
    setState({ step: step ? step.type + ':' + step.title : (o.title || ''), phase: o.phase || (step && (step.type === 'timed' || step.type === 'check' ? 'intro' : step.type)) || 'page', expect: null });
    return content;
  };
  Frame.prototype.running = function (on) { this.el.classList.toggle('is-running', !!on); };

  /** Buttons at the bottom of a step; the one with kbd 'Space' also answers HF.input 'next'. Resolves the chosen id. */
  function choose(ctx, into, choices) {
    return waitFor(ctx, function (done, add) {
      clear(into);
      var primary = null;
      choices.forEach(function (ch) {
        if (!ch) return;
        var b = c().button(ch.label, { variant: ch.variant || 'secondary', kbd: ch.kbd || null, icon: ch.icon || null,
          onClick: function () { if (ch.sync) { try { ch.sync(); } catch (e) { log(e); } } done(ch.id); } });
        b.setAttribute('data-choice', ch.id);
        into.appendChild(b);
        if (ch.kbd === 'Space') primary = ch;
      });
      if (primary) add(onInput(function (ev) {
        if (ev.key !== 'next') return;
        if (primary.sync) { try { primary.sync(); } catch (e) { log(e); } }   // inside the keydown: audio unlock needs the gesture
        done(primary.id);
      }));
      setState({ expect: 'choice', choices: choices.filter(Boolean).map(function (x) { return x.id; }) });
    });
  }
  function leaveChoice(ctx) { return ctx.opts.noLeave ? null : { id: 'leave', label: C().TEXT.leave, variant: 'quiet' }; }
  async function nextOrLeave(ctx, frame, label) {
    var id = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'next', label: label || 'Next', variant: 'primary', kbd: 'Space' }]);
    if (id === 'leave') throw CANCEL;
    return id;
  }

  // ======================================================================== memory tape
  function nounOf(spec) {
    if (spec.trackId === 'rel.steps') return 'number';
    if (spec.trackId === 'nback.switch') return 'item';
    var set = HF.sets.get(spec.set);
    if (set && set.kind === 'audio') return 'sound';
    return (set && set.noun) || 'item';
  }
  function compareOf(spec) { return spec.params && isNum(spec.params.n) ? spec.params.n : 1; }

  /** Tape for one stream. o: { stream, mode: full|frame|none, hints, values, probe(j)→fn, reveal: j, caption } */
  function tapeRow(spec, i, o) {
    var st = o.stream || 'main', n = compareOf(spec), cols = Math.max(4, n + 3), from = i - cols + 1;
    var mode = o.mode || 'full', cells = [], extra = [];
    var cmp = i - n >= 0 && spec.trials[i].scorable !== false ? i - n : -1;
    for (var k = 0; k < cols; k++) {
      var j = from + k, tr = j >= 0 ? spec.trials[j] : null;
      if (!tr) { cells.push(h('span', { 'class': 'hf-tape__cell hf-ltape__gap', 'aria-hidden': 'true' }, [])); extra.push(null); continue; }
      var it = tr.stim[st];
      var blank = mode === 'frame' && j !== i && j !== cmp;
      var cls = 'hf-tape__cell hf-ltape__cell' + (j === i ? ' is-target hf-ltape__now' : '') + (j === cmp ? ' is-compare' : '') + (blank ? ' is-blank' : '') + (o.reveal === j ? ' is-reveal' : '');
      var inner = blank ? [] : [itemNode(it, 'mini')];
      var node;
      if (o.probe && j < i && !blank) {
        node = h('button', { type: 'button', 'class': cls + ' hf-ltape__btn', 'data-tape': String(j), 'aria-label': 'Tape item ' + (k + 1) + ': ' + itemName(it) }, inner);
        node.addEventListener('click', o.probe(j));
      } else node = h('span', { 'class': cls, 'data-tape': String(j) }, inner);
      cells.push(node);
      var sub = null;
      if (o.values && it && it.expr && !blank) sub = '= ' + it.value;
      if (o.hints && j === cmp && it && !blank) {
        var set = HF.sets.get((spec.sets && spec.sets.main) || spec.set), step = spec.params.step || 1;
        try { sub = '→ ' + itemName(HF.sets.step(set, it, step)); } catch (e) { sub = null; }
      }
      extra.push(sub);
    }
    var row = h('div', { 'class': 'hf-tape__row hf-ltape__row' }, cells);
    row.style.setProperty('--n', String(cols));
    var kids = [row];
    if (extra.some(function (x) { return !!x; })) {
      var subRow = h('div', { 'class': 'hf-tape__row hf-ltape__subs', 'aria-hidden': 'true' }, extra.map(function (x) { return h('span', { 'class': 'hf-ltape__sub' }, [x || '']); }));
      subRow.style.setProperty('--n', String(cols));
      kids.push(subRow);
    }
    if (cmp >= 0 && mode !== 'none') {
      var a = cmp - from, b = i - from, span = b - a + 1;
      var br = h('div', { 'class': 'hf-tape__bracket' });
      br.style.gridColumn = (a + 1) + ' / span ' + span;
      var lab = h('div', { 'class': 'hf-tape__label' }, [n === 1 ? '1 back' : n + ' back']);
      lab.style.gridColumn = (a + 1) + ' / span ' + span;
      var r1 = h('div', { 'class': 'hf-tape__row', 'aria-hidden': 'true' }, [br]), r2 = h('div', { 'class': 'hf-tape__row', 'aria-hidden': 'true' }, [lab]);
      r1.style.setProperty('--n', String(cols)); r2.style.setProperty('--n', String(cols));
      kids.push(r1, r2);
    }
    if (o.caption) kids.unshift(h('p', { 'class': 'hf-ltape__cap' }, [o.caption]));
    return h('div', { 'class': 'hf-tape hf-ltape' + (mode === 'frame' ? ' is-frame' : '') }, kids);
  }
  /** Equal Steps tape: numbers, the steps between them (support), and the two jumps as arcs (2-back). */
  function stepsTape(spec, i, o) {
    var b = spec.params.back, xs = spec.trials.map(function (t) { return t.stim.main.number; });
    var cols = Math.max(5, b + 4), from = i - cols + 1, cells = [], subs = [];
    for (var k = 0; k < cols; k++) {
      var j = from + k;
      if (j < 0) { cells.push(h('span', { 'class': 'hf-tape__cell hf-ltape__gap', 'aria-hidden': 'true' }, [])); continue; }
      cells.push(h('span', { 'class': 'hf-tape__cell hf-ltape__cell' + (j === i ? ' is-target hf-ltape__now' : ''), 'data-tape': String(j) }, [String(xs[j])]));
    }
    var row = h('div', { 'class': 'hf-tape__row hf-ltape__row' }, cells);
    row.style.setProperty('--n', String(cols));
    var kids = [];
    if (o.arcs && b >= 2 && i >= b + 1) {
      [[i - 1 - b, i - 1], [i - b, i]].forEach(function (pr, idx) {
        var a = pr[0] - from, z = pr[1] - from;
        if (a < 0) return;
        var arc = h('div', { 'class': 'hf-ltape__arc' + (idx === 1 ? ' is-now' : '') }, [h('span', null, [String(Math.abs(xs[pr[1]] - xs[pr[0]]))])]);
        arc.style.gridColumn = (a + 1) + ' / ' + (z + 2);
        var r = h('div', { 'class': 'hf-tape__row hf-ltape__arcs', 'aria-hidden': 'true' }, [arc]);
        r.style.setProperty('--n', String(cols));
        kids.push(r);
      });
    }
    kids.push(row);
    if (o.steps && b === 1) {
      var sr = [];
      for (var k2 = 1; k2 < cols; k2++) {
        var j2 = from + k2;
        if (j2 - 1 < 0) continue;
        var lab = h('span', { 'class': 'hf-ltape__step' + (j2 === i ? ' is-now' : '') }, [String(Math.abs(xs[j2] - xs[j2 - 1]))]);
        lab.style.gridColumn = k2 + ' / span 2';
        lab.style.gridRow = '1';          // overlapping spans must share one row
        sr.push(lab);
      }
      var srow = h('div', { 'class': 'hf-tape__row hf-ltape__steps', 'aria-hidden': 'true' }, sr);
      srow.style.setProperty('--n', String(cols));
      kids.push(srow);
    }
    return h('div', { 'class': 'hf-tape hf-ltape hf-ltape--steps' }, kids);
  }
  function tapeFor(spec, i, o) {
    if (o.mode === 'none') return h('p', { 'class': 'hf-ltape__off hf-small hf-muted' }, ['Tape off']);
    if (spec.trackId === 'rel.steps') return stepsTape(spec, i, o);
    if (spec.streams.length > 1) {
      return h('div', { 'class': 'hf-ltape--dual hf-stack hf-stack--sm' }, spec.streams.map(function (st) {
        var oo = {}; for (var k in o) oo[k] = o[k];
        oo.stream = st; oo.caption = st === 'pos' ? 'Place' : 'Sound';
        if (o.probe) oo.probe = null;
        return tapeRow(spec, i, oo);
      }));
    }
    return tapeRow(spec, i, o);
  }
  function scheduleAt(list, i, dflt) {
    var v = dflt;
    (list || []).forEach(function (p) { if (i >= p[0]) v = p[1]; });
    return v;
  }

  // ======================================================================== audio for self-paced steps
  function playItem(spec, tr) {
    if (!HF.audio) return;
    try {
      spec.streams.forEach(function (st) {
        var it = tr.stim[st];
        if (it && isNum(it.tone)) HF.audio.tone(it.tone);
        else if (it && it.clip) HF.audio.clip(it.clip);
      });
    } catch (e) { log(e); }
  }
  function hasSound(spec) {
    if (!spec || spec.kind !== 'stream' || !spec.streams) return false;
    return spec.trials.some(function (tr) { return spec.streams.some(function (st) { var it = tr.stim[st]; return it && (isNum(it.tone) || it.clip); }); });
  }

  // ======================================================================== guided stream runner (self-paced / demo)
  function feedbackNode(entries, spec) {
    var good = entries.every(function (w) { return w.outcome === 'hit' || w.outcome === 'cr'; });
    var dual = !!(spec.streams && spec.streams.length > 1), H = C().TEXT.headline;
    var kids = entries.map(function (w) {
      var label = dual ? (w.stream === 'pos' ? 'Position: ' : 'Sound: ') : '';
      return h('p', { 'class': 'hf-lpanel__line' }, [h('strong', null, [label + (H[w.outcome] || '')]), ' ', w.text]);
    });
    return h('div', { 'class': 'hf-lpanel__box hf-lpanel__box--' + (good ? 'good' : 'note'), 'data-outcome': entries.map(function (w) { return w.outcome; }).join(' ') }, [
      c().icon(good ? 'good' : 'info', { cls: 'hf-lpanel__icon' }), h('div', { 'class': 'hf-lpanel__text' }, kids)
    ]);
  }
  function msgNode(text, tone) {
    return h('div', { 'class': 'hf-lpanel__box hf-lpanel__box--' + (tone || 'plain') }, [
      tone === 'warn' ? c().icon('warn', { cls: 'hf-lpanel__icon' }) : (tone === 'good' ? c().icon('good', { cls: 'hf-lpanel__icon' }) : c().icon('info', { cls: 'hf-lpanel__icon' })),
      h('div', { 'class': 'hf-lpanel__text' }, [h('p', { 'class': 'hf-lpanel__line' }, [text])])
    ]);
  }
  function Board(host, o) {
    o = o || {};
    this.note = h('p', { 'class': 'hf-lboard__note', hidden: true });
    this.stage = h('div', { 'class': 'hf-lstage', 'aria-hidden': 'true' });
    this.sr = h('p', { 'class': 'hf-vh', 'aria-live': 'polite' });
    this.tape = h('div', { 'class': 'hf-lboard__tape' });
    this.panel = h('div', { 'class': 'hf-lpanel', 'aria-live': 'polite' });
    this.controls = h('div', { 'class': 'hf-lboard__controls' });
    this.el = h('div', { 'class': 'hf-lboard hf-task' + (o.cls ? ' ' + o.cls : ''), tabindex: '-1' },
      [this.note, this.stage, this.sr, this.tape, this.panel, this.controls]);
    host.appendChild(this.el);
  }
  Board.prototype.say = function (node) { clear(this.panel); if (node) this.panel.appendChild(node); };
  Board.prototype.setNote = function (text) { this.note.textContent = text || ''; this.note.hidden = !text; };

  function answerPads(dual, o) {
    o = o || {};
    if (dual) return c().pads({ pads: [{ id: 'match', label: 'Position', key: keyLabel('match', 'J'), icon: 'grid' }, { id: 'match2', label: 'Sound', key: keyLabel('match2', 'K'), icon: 'sound' }], label: 'Answer' });
    return c().pads({ pads: [{ id: 'no', label: o.noLabel || 'No match', key: keyLabel('no', 'F') }, { id: 'match', label: o.yesLabel || 'Match', key: keyLabel('match', 'J') }], label: 'Answer' });
  }

  /** Wait for an answer: single stream → 'match' | 'no'; dual → { match, match2 } after Check. */
  function getAnswer(ctx, board, dual, o) {
    return waitFor(ctx, function (done, add) {
      clear(board.controls);
      var pads = answerPads(dual, o);
      board.controls.appendChild(pads);
      if (!dual) {
        add(onInput(function (ev) { if (ev.key === 'match' || ev.key === 'no') done(ev.key); }));
        setState({ expect: 'answer' });
        reveal(board.controls);
        return;
      }
      var sel = { match: false, match2: false };
      var padEls = pads.querySelectorAll('[data-key]');
      function paint() { Array.prototype.forEach.call(padEls, function (p) { var k = p.getAttribute('data-key'); p.setAttribute('aria-pressed', sel[k] ? 'true' : 'false'); p.classList.toggle('is-on', !!sel[k]); }); }
      paint();
      var check = c().button('Check', { variant: 'primary', kbd: 'Space', onClick: function () { done({ match: sel.match, match2: sel.match2 }); } });
      check.setAttribute('data-choice', 'check');
      board.controls.appendChild(h('div', { 'class': 'hf-actions hf-lboard__check' }, [check]));
      add(onInput(function (ev) {
        if (ev.key === 'match' || ev.key === 'match2') { sel[ev.key] = !sel[ev.key]; paint(); }
        else if (ev.key === 'next') done({ match: sel.match, match2: sel.match2 });
      }));
      setState({ expect: 'dual-answer' });
      reveal(board.controls);
    });
  }
  function nextButton(ctx, board, label) {
    return waitFor(ctx, function (done, add) {
      clear(board.controls);
      var b = c().button(label || 'Next', { variant: 'primary', kbd: 'Space', onClick: function () { done('next'); } });
      b.setAttribute('data-choice', 'next');
      board.controls.appendChild(h('div', { 'class': 'hf-actions hf-lboard__next' }, [b]));
      add(onInput(function (ev) { if (ev.key === 'next') done('next'); }));
      setState({ expect: 'next' });
      reveal(board.controls);
    });
  }
  /** "Tap the item you compare with" — resolves true when the right tape item was tapped first. */
  function probeTape(ctx, board, spec, i, mode, prompt, extraOpts) {
    var n = compareOf(spec), want = i - n;
    return waitFor(ctx, function (done) {
      board.say(msgNode(prompt, 'plain'));
      var o = { mode: mode, probe: function (j) { return function () { done(j === want); }; } };
      if (extraOpts) for (var k in extraOpts) o[k] = extraOpts[k];
      clear(board.tape); board.tape.appendChild(tapeFor(spec, i, o));
      clear(board.controls);
      setState({ expect: 'probe', probe: want });
    });
  }

  async function guidedStream(ctx, host, spec, step, o) {
    o = o || {};
    var T = C().TEXT, n = compareOf(spec), dual = spec.streams.length > 1, noun = nounOf(spec);
    var board = new Board(host, { cls: 'hf-lboard--' + (spec.trackId === 'rel.steps' ? 'steps' : 'nback') });
    var answers = {}, results = [], demoWhy = o.demo ? perfectWhy(spec) : null;
    var show = step.show || {}, lastMode = null, sound = hasSound(spec);
    if (spec.trackId === 'rel.steps') n = spec.params.back;
    for (var i = 0; i < spec.trials.length; i++) {
      ctx.check();
      var tr = spec.trials[i], mode = o.demo ? 'full' : scheduleAt(step.tape, i, 'full');
      var support = step.support ? scheduleAt(step.support, i, false) : true;
      var topts = { mode: mode, hints: !!show.hints && support, values: (!!show.values || (step.support && /^ar/.test(step.seq || ''))) && support,
        steps: (!!show.steps || spec.trackId === 'rel.steps') && support && !show.arcs, arcs: !!show.arcs };
      if (step.support && spec.trackId === 'nback.transform') topts.hints = support;
      if (step.support && spec.trackId === 'nback.arith') topts.values = support;
      if (lastMode && mode !== lastMode) board.setNote(mode === 'frame' ? T.tapeFrame : (mode === 'none' ? T.tapeNone : ''));
      else if (i > 0 && lastMode === mode) board.setNote('');
      lastMode = mode;
      clear(board.stage);
      var stim = dual ? tr.stim.pos : tr.stim.main;
      board.stage.appendChild(itemNode(stim, 'stage', { cue: tr.cue }));
      if (dual) board.stage.appendChild(h('span', { 'class': 'hf-lstage__sound' }, [c().icon('sound')]));
      board.stage.setAttribute('data-trial', String(i));
      board.sr.textContent = (spec.trackId === 'rel.steps' ? 'Number ' : 'Item ') + (i + 1) + ' of ' + spec.trials.length + ': ' + (dual ? itemName(tr.stim.pos) + ', ' + itemName(tr.stim.snd) : itemName(stim)) + (tr.cue ? ', cue ' + tr.cue.toUpperCase() : '');
      clear(board.tape); board.tape.appendChild(tapeFor(spec, i, topts));
      if (sound) playItem(spec, tr);
      setState({ trial: { i: i, scorable: !!tr.scorable, target: tr.target, cue: tr.cue || null, n: n }, expect: null });
      focusEl(board.el);
      var note = step.notes && step.notes[i];

      if (!tr.scorable) {
        board.say(msgNode(T.leadInN(spec.trackId === 'rel.steps' ? n + 1 : n), 'plain'));
        await waitNext(ctx, board, sound, spec, tr);
        continue;
      }
      if (o.demo) {
        var ws = demoWhy.filter(function (w) { return w.i === i; });
        var act = dual ? (tr.target.pos && tr.target.snd ? T.action.pressBoth : (tr.target.pos ? T.action.pressPos : (tr.target.snd ? T.action.pressSnd : T.action.none)))
          : (tr.target.main ? T.action.press : T.action.none);
        var kids = ws.map(function (w) { return h('p', { 'class': 'hf-lpanel__line' }, [w.text]); });
        kids.push(h('p', { 'class': 'hf-lpanel__line hf-lpanel__act' }, [h('strong', null, [act])]));
        if (note) kids.push(h('p', { 'class': 'hf-lpanel__line hf-lpanel__note' }, [note]));
        board.say(h('div', { 'class': 'hf-lpanel__box hf-lpanel__box--' + ((tr.target.main || tr.target.pos || tr.target.snd) ? 'good' : 'plain'), 'data-outcome': (tr.target.main || tr.target.pos || tr.target.snd) ? 'target' : 'none' }, [
          c().icon((tr.target.main || tr.target.pos || tr.target.snd) ? 'check' : 'info', { cls: 'hf-lpanel__icon' }), h('div', { 'class': 'hf-lpanel__text' }, kids)]));
        await waitNext(ctx, board, sound, spec, tr);
        continue;
      }
      var call = step.callouts && step.callouts[i];
      var canTap = mode === 'full' && !dual && spec.trackId !== 'rel.steps';
      if (step.probes && step.probes.indexOf(i) >= 0 && canTap) {
        var okP = await probeTape(ctx, board, spec, i, mode, T.askProbe(n, noun));
        clear(board.tape); board.tape.appendChild(tapeFor(spec, i, { mode: mode, reveal: i - n, hints: topts.hints, values: topts.values }));
        board.say(msgNode(okP ? T.probeRight(n) : T.probeWrong(n), okP ? 'good' : 'plain'));
        if (call) board.panel.appendChild(msgNode(call, 'warn'));
      } else board.say(call ? msgNode(call, 'warn') : (note ? msgNode(note, 'plain') : msgNode(dual ? 'Mark what matches one back, then Check.' : T.askAnswer, 'plain')));
      var ans = await getAnswer(ctx, board, dual);
      answers[i] = dual ? ans : { match: ans === 'match' };
      var entries = whyAt(spec, answers, i);
      results.push(entries);
      if (step.why && step.why.indexOf(i) >= 0 && canTap) {
        var okW = await probeTape(ctx, board, spec, i, mode, T.askWhy(noun));
        clear(board.tape); board.tape.appendChild(tapeFor(spec, i, { mode: mode, reveal: i - n, hints: topts.hints, values: topts.values }));
        board.say(msgNode(okW ? T.probeRight(n) : T.probeWrong(n), okW ? 'good' : 'plain'));
        board.panel.appendChild(feedbackNode(entries, spec));
      } else board.say(feedbackNode(entries, spec));
      setState({ last: entries.map(function (w) { return w.outcome; }) });
      await waitNext(ctx, board, sound, spec, tr);
    }
    // summary
    var right = 0, total = 0;
    results.forEach(function (es) { es.forEach(function (w) { total++; if (w.outcome === 'hit' || w.outcome === 'cr') right++; }); });
    board.el.parentNode.removeChild(board.el);
    return { right: right, total: total };
  }
  function waitNext(ctx, board, sound, spec, tr) {
    if (!sound) return nextButton(ctx, board);
    return waitFor(ctx, function (done, add) {
      clear(board.controls);
      var again = c().button(C().TEXT.replay, { variant: 'secondary', icon: 'sound', onClick: function () { playItem(spec, tr); } });
      var b = c().button('Next', { variant: 'primary', kbd: 'Space', onClick: function () { done('next'); } });
      b.setAttribute('data-choice', 'next');
      board.controls.appendChild(h('div', { 'class': 'hf-actions hf-lboard__next' }, [again, b]));
      add(onInput(function (ev) { if (ev.key === 'next') done('next'); }));
      setState({ expect: 'next' });
      reveal(board.controls);
    });
  }

  // ======================================================================== Relation Grid, Stream, visual search
  function lineCellsOf(meta, lineId) {
    var ls = (meta && meta.lines) || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].id === lineId) return ls[i].cells.slice();
    return null;
  }
  /** A T1 lesson spec from hand-built arrays (SEQ names); answers come from the rule itself (grid.solve). */
  function handGridSpec(names, seed) {
    var base = genSpec({ trackId: 'rel.grid.T1', rung: 0, set: 'digits', seed: seed || 'lesson/grid/base' }), G = HF.tasks.relations.grid;
    var spec = {}; for (var k in base) spec[k] = base[k];
    spec.windowMs = 600000; spec.lesson = true;
    spec.trials = names.map(function (nm, i) {
      var q = C().SEQ[nm];
      var tr = { i: i, stim: { size: 3, cells: q.cells.slice(), kept: [] }, answer: 'no', meta: { line: null, lineCells: null, near: 0, key: null, twin: null, distractor: null } };
      var sol = G.solve(spec, tr);
      tr.answer = sol.targets.length ? 'match' : 'no';
      tr.meta.line = sol.targets[0] || null;
      tr.meta.lineCells = lineCellsOf(spec.meta, tr.meta.line);
      tr.meta.near = sol.near.length;
      return tr;
    });
    return spec;
  }
  /** Keep nT target and nO other trials of a generated discrete block, in their order, renumbered from 0. */
  function pickTrials(spec, nT, nO) {
    var out = [], t = 0, o = 0;
    spec.trials.forEach(function (tr) {
      var isT = tr.answer === 'match';
      if (isT && t < nT) { t++; out.push(tr); } else if (!isT && o < nO) { o++; out.push(tr); }
    });
    var s = {}; for (var k in spec) s[k] = spec[k];
    s.trials = out.map(function (tr, i) { var x = {}; for (var k2 in tr) x[k2] = tr[k2]; x.i = i; return x; });
    return s;
  }
  function discreteWhy(spec, answers, i) {
    var res = scorerFor(spec)(spec, { answers: answers, paused: false });
    return res.why.filter(function (w) { return w.i === i; });
  }
  function stageArray(board, spec, tr, o) {
    clear(board.stage);
    board.stage.setAttribute('data-trial', String(tr.i));
    if (spec.task === 'vsearch') board.stage.appendChild(vsNode(tr.stim, { showT: o && o.showT }));
    else { var oo = {}; for (var k in (o || {})) oo[k] = o[k]; oo.spec = spec; board.stage.appendChild(arrayNode(tr.stim, spec.meta, oo)); }
  }
  async function guidedArrays(ctx, host, spec, o) {
    o = o || {};
    var vs = spec.task === 'vsearch', T = C().TEXT;
    var board = new Board(host, { cls: vs ? 'hf-lboard--vs' : 'hf-lboard--grid' });
    var answers = [], right = 0;
    for (var i = 0; i < spec.trials.length; i++) {
      ctx.check();
      var tr = spec.trials[i];
      stageArray(board, spec, tr, { highlight: o.highlight });
      board.sr.textContent = (vs ? 'Display ' : 'Grid ') + (i + 1) + ' of ' + spec.trials.length + '.';
      clear(board.tape);
      setState({ trial: { i: i, answer: tr.answer, scorable: true }, expect: null });
      focusEl(board.el);
      if (o.demo) {
        var w0 = discreteWhy(spec, [{ i: tr.i, response: tr.answer, rt: 1000 }], tr.i)[0];
        stageArray(board, spec, tr, { highlight: o.highlight, lineCells: w0 && w0.line ? w0.cells : null, nearCells: w0 && !w0.line ? w0.cells : null, showT: vs });
        board.say(h('div', { 'class': 'hf-lpanel__box hf-lpanel__box--' + (tr.answer === 'match' ? 'good' : 'plain'), 'data-outcome': tr.answer }, [
          c().icon(tr.answer === 'match' ? 'check' : 'info', { cls: 'hf-lpanel__icon' }),
          h('div', { 'class': 'hf-lpanel__text' }, [h('p', { 'class': 'hf-lpanel__line' }, [w0 ? w0.text : '']),
            h('p', { 'class': 'hf-lpanel__line hf-lpanel__act' }, [h('strong', null, [tr.answer === 'match' ? T.action.yes : T.action.no])])])]));
        await nextButton(ctx, board);
        continue;
      }
      board.say(msgNode(vs ? 'Is there a T?' : 'Match or No?', 'plain'));
      var a = await getAnswer(ctx, board, false, vs ? { noLabel: 'Absent', yesLabel: 'Present' } : { noLabel: 'No', yesLabel: 'Match' });
      answers.push({ i: tr.i, response: a === 'match' ? 'match' : 'no', rt: 1000 });
      var ws = discreteWhy(spec, answers, tr.i), w = ws[0];
      if (w && (w.outcome === 'hit' || w.outcome === 'cr')) right++;
      stageArray(board, spec, tr, { highlight: o.highlight, lineCells: w && w.line ? w.cells : null, nearCells: w && !w.line ? w.cells : null, showT: vs });
      board.say(feedbackNode(ws, spec));
      setState({ last: ws.map(function (x) { return x.outcome; }) });
      await nextButton(ctx, board);
    }
    board.el.parentNode.removeChild(board.el);
    return { right: right, total: o.demo ? 0 : spec.trials.length };
  }
  /** "Tap the line": each array has one target line; the learner taps its row or column label. */
  async function linesExercise(ctx, host, spec) {
    var board = new Board(host, { cls: 'hf-lboard--grid' }), G = HF.tasks.relations.grid, right = 0;
    for (var i = 0; i < spec.trials.length; i++) {
      ctx.check();
      var tr = spec.trials[i], want = G.solve(spec, tr).targets[0];
      board.sr.textContent = 'Grid ' + (i + 1) + ' of ' + spec.trials.length + '.';
      board.say(msgNode('Tap the row or column whose last digits are all the same.', 'plain'));
      clear(board.controls);
      var picked = await waitFor(ctx, function (done) {
        clear(board.stage);
        board.stage.setAttribute('data-trial', String(i));
        board.stage.appendChild(lineChooser(spec, tr, function (id) { done(id); }));
        setState({ trial: { i: i, answer: tr.answer }, expect: 'line', line: want });
      });
      var ok = picked === want;
      if (ok) right++;
      var w = discreteWhy(spec, [{ i: tr.i, response: 'match', rt: 1000 }], tr.i)[0];
      clear(board.stage);
      board.stage.appendChild(arrayNode(tr.stim, spec.meta, { spec: spec, highlight: true, lineCells: lineCellsOf(spec.meta, want) }));
      board.say(feedbackNode([{ outcome: ok ? 'hit' : 'miss', text: (ok ? '' : 'Not that one. ') + (w ? w.text : ''), stream: 'main' }], spec));
      setState({ last: [ok ? 'hit' : 'miss'] });
      await nextButton(ctx, board);
    }
    board.el.parentNode.removeChild(board.el);
    return { right: right, total: spec.trials.length };
  }
  function lineChooser(spec, tr, pick) {
    function vbtn(id, label, short) {
      var b = h('button', { type: 'button', 'class': 'hf-llines__btn', 'data-line': id, 'aria-label': label }, [short]);
      b.addEventListener('click', function () { pick(id); });
      return b;
    }
    if (viewGrid()) {
      var cols = h('div', { 'class': 'hf-llines__cols' }), rows = h('div', { 'class': 'hf-llines__rows' });
      for (var cc = 1; cc <= 3; cc++) cols.appendChild(vbtn('col' + cc, 'Column ' + cc, 'Col ' + cc));
      for (var rr = 1; rr <= 3; rr++) rows.appendChild(vbtn('row' + rr, 'Row ' + rr, 'Row ' + rr));
      return h('div', { 'class': 'hf-llines hf-llines--v' }, [h('span', { 'class': 'hf-llines__corner', 'aria-hidden': 'true' }, []), cols, rows,
        arrayNode(tr.stim, spec.meta, { spec: spec, highlight: true })]);
    }
    var wrap = h('div', { 'class': 'hf-llines' });
    wrap.appendChild(h('span', { 'class': 'hf-llines__corner', 'aria-hidden': 'true' }, []));
    function btn(id, label, short) {
      var b = h('button', { type: 'button', 'class': 'hf-llines__btn', 'data-line': id, 'aria-label': label }, [short]);
      b.addEventListener('click', function () { pick(id); });
      return b;
    }
    for (var col = 1; col <= 3; col++) wrap.appendChild(btn('col' + col, 'Column ' + col, 'Col ' + col));
    var arr = arrayNode(tr.stim, spec.meta, { highlight: true, own: true });
    var cells = Array.prototype.slice.call(arr.children);
    for (var r = 1; r <= 3; r++) {
      wrap.appendChild(btn('row' + r, 'Row ' + r, 'Row ' + r));
      for (var k = 0; k < 3; k++) { var cell = cells[(r - 1) * 3 + k]; cell.classList.add('hf-llines__cell'); wrap.appendChild(cell); }
    }
    return wrap;
  }

  // Relation Stream: the grid stays; one cell changes per step
  async function guidedRstream(ctx, host, spec, from, to, o) {
    o = o || {};
    var board = new Board(host, { cls: 'hf-lboard--grid' }), T = C().TEXT, answers = {}, right = 0, total = 0;
    var demoWhy = o.demo ? perfectWhy(spec) : null;
    for (var i = from; i < to; i++) {
      ctx.check();
      var tr = spec.trials[i];
      clear(board.stage);
      board.stage.setAttribute('data-trial', String(i));
      board.stage.appendChild(arrayNode({ size: 3, cells: tr.stim.main.grid }, spec.meta, { spec: spec, highlight: true, changed: tr.stim.main.changed }));
      board.sr.textContent = i === 0 ? 'The starting grid.' : 'Change ' + i + '.';
      setState({ trial: { i: i, scorable: !!tr.scorable, target: tr.target }, expect: null });
      focusEl(board.el);
      if (!tr.scorable) {
        var same = !(spec.meta && spec.meta.rule && spec.meta.rule.id === 'different');
        board.say(msgNode('This is the starting grid. No row or column is all ' + (same ? 'the same' : 'different') + ' yet.', 'plain'));
        await nextButton(ctx, board); continue;
      }
      if (o.demo) {
        var w0 = demoWhy.filter(function (w) { return w.i === i; })[0];
        if (tr.target.main && tr.line) { clear(board.stage); board.stage.appendChild(arrayNode({ size: 3, cells: tr.stim.main.grid }, spec.meta, { spec: spec, highlight: true, changed: tr.stim.main.changed, lineCells: lineCellsOf(spec.meta, tr.line) })); }
        board.say(h('div', { 'class': 'hf-lpanel__box hf-lpanel__box--' + (tr.target.main ? 'good' : 'plain'), 'data-outcome': tr.target.main ? 'target' : 'none' }, [
          c().icon(tr.target.main ? 'check' : 'info', { cls: 'hf-lpanel__icon' }),
          h('div', { 'class': 'hf-lpanel__text' }, [h('p', { 'class': 'hf-lpanel__line' }, [w0 ? w0.text : '']),
            h('p', { 'class': 'hf-lpanel__line hf-lpanel__act' }, [h('strong', null, [tr.target.main ? T.action.press : T.action.none])])])]));
        await nextButton(ctx, board);
        if (o.stopAfterTarget && tr.target.main) break;
        continue;
      }
      board.say(msgNode('Match, or nothing yet?', 'plain'));
      var a = await getAnswer(ctx, board, false, { noLabel: 'Nothing yet', yesLabel: 'Match' });
      answers[i] = { match: a === 'match' };
      var ws = whyAt(spec, answers, i);
      total++; if (ws[0] && (ws[0].outcome === 'hit' || ws[0].outcome === 'cr')) right++;
      if (tr.target.main && tr.line) { clear(board.stage); board.stage.appendChild(arrayNode({ size: 3, cells: tr.stim.main.grid }, spec.meta, { spec: spec, highlight: true, changed: tr.stim.main.changed, lineCells: lineCellsOf(spec.meta, tr.line) })); }
      board.say(feedbackNode(ws, spec));
      setState({ last: ws.map(function (x) { return x.outcome; }) });
      await nextButton(ctx, board);
    }
    board.el.parentNode.removeChild(board.el);
    return { right: right, total: total };
  }

  // ======================================================================== Span: one trial, self-paced or timed
  function spanOne(spec, tr) { var s = {}; for (var k in spec) s[k] = spec[k]; s.trials = [tr]; return s; }
  function keypad(ctx, board, tr, o) {
    o = o || {};
    return waitFor(ctx, function (done, add) {
      var chosen = [];
      var shown = h('p', { 'class': 'hf-lkeypad__shown', 'aria-live': 'polite' }, [' ']);
      function paint() { shown.textContent = chosen.length ? chosen.join(' ') : ' '; }
      var keys = tr.recallKeypad.map(function (sym) {
        var b = h('button', { type: 'button', 'class': 'hf-lkeypad__key' + (o.hint && o.hint.indexOf(sym) >= 0 ? ' is-hint' : ''), 'data-sym': sym }, [sym]);
        b.addEventListener('click', function () { if (chosen.length < tr.setSize) { chosen.push(sym); paint(); } });
        return b;
      });
      var clearB = c().button('Clear', { variant: 'quiet', onClick: function () { chosen = []; paint(); } });
      var doneB = c().button('Done', { variant: 'primary', kbd: 'Space', onClick: function () { done(chosen.slice()); } });
      doneB.setAttribute('data-choice', 'done');
      clear(board.controls);
      board.controls.appendChild(h('div', { 'class': 'hf-lkeypad' }, [shown, h('div', { 'class': 'hf-lkeypad__grid', role: 'group', 'aria-label': 'Keypad' }, keys),
        h('div', { 'class': 'hf-actions' }, [clearB, doneB])]));
      add(onInput(function (ev) { if (ev.key === 'next') done(chosen.slice()); }));
      reveal(board.controls);
      setState({ expect: 'keypad', want: tr.order === 'backward' ? tr.pairs.map(function (p) { return p.mem; }).reverse() : tr.pairs.map(function (p) { return p.mem; }) });
    });
  }
  function judge(ctx, board, limitMs) {
    return waitFor(ctx, function (done, add) {
      clear(board.controls);
      board.controls.appendChild(c().pads({ pads: [{ id: 'no', label: 'False', key: keyLabel('no', 'F') }, { id: 'match', label: 'True', key: keyLabel('match', 'J') }], label: 'Is the sum right?' }));
      var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
      add(onInput(function (ev) {
        if (ev.key === 'match' || ev.key === 'no') done({ resp: ev.key === 'match', rt: Math.max(0, Math.round((ev.t || t0) - t0)) });
      }));
      if (limitMs) { var t = setTimeout(function () { done({ resp: null, rt: null }); }, limitMs); add(function () { clearTimeout(t); }); }
      else reveal(board.controls);
      setState({ expect: 'judge' });
    });
  }
  /** One span trial. o: { demo, timed }. Returns the trial log (SPEC §4.4). */
  async function spanTrial(ctx, host, spec, tr, o) {
    o = o || {};
    var board = new Board(host, { cls: 'hf-lboard--span' }), S1 = spanOne(spec, tr), entry = { i: tr.i, proc: [], recall: [], voided: false };
    var memName = spec.trackId === 'span.sym' ? 'symbol' : 'letter';
    for (var k = 0; k < tr.pairs.length; k++) {
      ctx.check();
      var p = tr.pairs[k], truth = HF.tasks.span.solve(p.proc);
      clear(board.stage);
      board.stage.appendChild(h('span', { 'class': 'hf-litem hf-litem--expr' }, [p.proc.text]));
      board.stage.setAttribute('data-trial', tr.i + '.' + k);
      board.sr.textContent = 'Sum ' + (k + 1) + ': ' + p.proc.text;
      setState({ trial: { i: tr.i, pair: k, truth: truth }, expect: null });
      focusEl(board.el);
      if (o.demo) {
        board.say(msgNode(truth ? p.proc.text + ' is right: answer True (J).' : p.proc.text + ' is wrong: answer False (F).', truth ? 'good' : 'plain'));
        await nextButton(ctx, board);
        entry.proc.push({ resp: truth, rt: 1500 });
      } else {
        board.say(o.timed ? null : msgNode('Is the sum right?', 'plain'));
        var j = await judge(ctx, board, o.timed ? (spec.procLimitMs || 4000) : 0);
        entry.proc.push(j);
        if (!o.timed) {
          var future = tr.pairs.slice(k + 1).map(function (q) { return { resp: HF.tasks.span.solve(q.proc), rt: 1000 }; });
          var ws = HF.tasks.span.score(S1, { trials: [{ i: tr.i, proc: entry.proc.concat(future), recall: [], voided: false }] })
            .why.filter(function (w) { return w.stream === 'proc' && w.text.indexOf(p.proc.text) === 0; });
          var okJ = j.resp === truth;
          board.say(okJ ? msgNode('Right.', 'good') : feedbackNode(ws.length ? ws : [{ outcome: 'fa', text: p.proc.text + (truth ? ' is right.' : ' is wrong.'), stream: 'proc' }], spec));
          await nextButton(ctx, board);
        }
      }
      // the item to remember
      clear(board.stage);
      board.stage.appendChild(h('span', { 'class': 'hf-litem hf-litem--mem' }, [p.mem]));
      board.sr.textContent = 'Remember: ' + p.mem;
      setState({ trial: { i: tr.i, pair: k, mem: p.mem }, expect: o.timed ? null : 'next' });
      if (o.timed) { clear(board.controls); board.say(null); await ctx.sleep(spec.memMs || 1000); }
      else { board.say(msgNode('Remember this ' + memName + '.', 'plain')); await nextButton(ctx, board); }
    }
    clear(board.stage);
    var want = tr.order === 'backward' ? tr.pairs.map(function (q) { return q.mem; }).reverse() : tr.pairs.map(function (q) { return q.mem; });
    board.stage.appendChild(h('span', { 'class': 'hf-litem hf-litem--ask' }, [tr.order === 'backward' ? 'In reverse order?' : 'In order?']));
    board.say(msgNode(o.demo ? 'Now tap ' + want.join(', then ') + ', and Done.' : 'Tap the ' + memName + 's ' + (tr.order === 'backward' ? 'in reverse order' : 'in the order you saw them') + ', then Done.', 'plain'));
    entry.recall = await keypad(ctx, board, tr, { hint: o.demo ? want : null });
    var res = HF.tasks.span.score(S1, { trials: [entry] });
    if (!o.timed) {
      var rec = res.why.filter(function (w) { return w.stream === 'recall'; });
      board.say(feedbackNode(rec.length ? rec : [{ outcome: 'hit', text: '', stream: 'recall' }], spec));
      setState({ last: rec.map(function (w) { return w.outcome; }) });
      await nextButton(ctx, board);
    }
    board.el.parentNode.removeChild(board.el);
    return entry;
  }

  // ======================================================================== timed runs
  function viewKeyFor(spec) { return spec.task === 'nback' ? 'nback' : spec.task; }
  function startGesture(withSound) {
    // must run inside the click / keydown that starts a timed run (audio unlock and wake lock need the gesture)
    try { if (HF.timing && HF.timing.keepAwake) HF.timing.keepAwake(true); } catch (e) { log(e); }
    if (withSound && HF.audio && HF.audio.unlock) { try { HF.audio.unlock(); } catch (e2) { log(e2); } }
  }
  /** Counts keydowns that are not part of the block's key map while a block presents stimuli ("wrong key"). */
  function rawKeyCounter(spec) {
    var box = { n: 0, codes: [] };
    if (!root.addEventListener) return { box: box, off: function () {} };
    var ok = [];
    ['match', 'pause'].concat(spec.streams && spec.streams.length > 1 ? ['match2'] : []).concat(spec.kind === 'discrete' || spec.task === 'span' ? ['no'] : []).forEach(function (k) {
      try { ok = ok.concat(HF.input.codesFor(k)); } catch (e) { /* ignore */ }
    });
    var IGNORE = /^(Shift|Control|Alt|Meta|CapsLock|Tab|Fn|OS)/;
    function onKey(e) {
      if (!(HF.timing && HF.timing.busy) || e.repeat || IGNORE.test(e.code || e.key || '')) return;
      if (ok.indexOf(e.code) >= 0) return;
      box.n++; box.codes.push(e.code || e.key);
    }
    root.addEventListener('keydown', onKey, true);
    return { box: box, off: function () { root.removeEventListener('keydown', onKey, true); } };
  }

  /** This file's own minimal view (contracts-ui §1 shape), used only when HF.views[key] is missing. */
  function ownView(host, spec, vctx) {
    var discrete = spec.kind === 'discrete', persistent = spec.kind === 'stream' && !(spec.onMs < spec.soaMs);
    var stage = h('div', { 'class': 'hf-lstage hf-lstage--run' + (discrete ? ' hf-lstage--array' : ''), 'aria-hidden': 'true' });
    var fix = h('span', { 'class': 'hf-lstage__fix' }, ['+']);
    stage.appendChild(fix);
    var nodes = spec.trials.map(function (tr) {
      var node;
      if (spec.task === 'vsearch') node = vsNode(tr.stim);
      else if (discrete) node = arrayNode(tr.stim, spec.meta, { own: true, highlight: vctx.assist && vctx.assist.highlight });
      else if (spec.trackId === 'rel.stream') node = arrayNode({ size: 3, cells: tr.stim.main.grid }, spec.meta, { own: true });
      else if (spec.streams.length > 1) node = itemNode(tr.stim.pos, 'stage');
      else node = itemNode(tr.stim.main, 'stage', { cue: tr.cue });
      var wrap = h('div', { 'class': 'hf-lstage__item', hidden: true, 'data-trial': String(tr.i) }, [node]);
      stage.appendChild(wrap);
      return wrap;
    });
    var J = keyLabel('match', 'J'), F = keyLabel('no', 'F'), K = keyLabel('match2', 'K');
    var padSpec = discrete ? (spec.task === 'vsearch' ? [{ id: 'no', label: 'Absent', key: F }, { id: 'match', label: 'Present', key: J }] : [{ id: 'no', label: 'No', key: F }, { id: 'match', label: 'Match', key: J }])
      : (spec.streams.length > 1 ? [{ id: 'match', label: 'Position', key: J, icon: 'grid' }, { id: 'match2', label: 'Sound', key: K, icon: 'sound' }] : [{ id: 'match', label: 'Match', key: J }]);
    var pads = c().pads({ pads: padSpec, label: 'Answer' });
    var el = h('div', { 'class': 'hf-lrun hf-task' }, [stage, pads]);
    host.appendChild(el);
    var cur = null, fbT = null;
    return {
      prepare: function () {},
      show: function (tr) { fix.hidden = true; var n = nodes[spec.trials.indexOf(tr)]; if (n) { n.hidden = false; cur = n; } },
      hide: function (tr) { var n = nodes[spec.trials.indexOf(tr)]; if (n) n.hidden = true; if (!persistent) fix.hidden = false; },
      sound: function (tr, when) {
        if (when === null || when === undefined || !HF.audio) return;
        var it = tr.stim.snd || tr.stim.main;
        try { if (it && isNum(it.tone)) HF.audio.tone(it.tone, when); else if (it && it.clip) HF.audio.clip(it.clip, when); } catch (e) { log(e); }
      },
      feedback: function (outcome, key) {
        var p = pads.querySelector('[data-key="' + (key || 'match') + '"]');
        if (!p) return;
        p.setAttribute('data-fb', outcome === 'good' ? 'good' : 'bad');
        clearTimeout(fbT); fbT = setTimeout(function () { p.removeAttribute('data-fb'); }, 300);
      },
      pads: Array.prototype.slice.call(pads.querySelectorAll('.hf-pad')),
      destroy: function () { clearTimeout(fbT); if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }
  function makeView(host, spec, vctx) {
    var key = viewKeyFor(spec), V = HF.views && HF.views[key];
    if (config.useViews && V && typeof V.create === 'function') {
      try { return { view: V.create(host, spec, vctx), own: false }; } catch (e) { log(e); clear(host); }
    }
    return { view: ownView(host, spec, vctx), own: true };
  }
  function countdown(ctx, host) {
    return waitFor(ctx, function (done, add) {
      var num = h('span', { 'class': 'hf-lcount__n' }, ['3']);
      var el = h('div', { 'class': 'hf-lcount', role: 'status', 'aria-live': 'assertive' }, [num, h('span', { 'class': 'hf-lcount__hint hf-small hf-muted' }, ['Esc or P pauses'])]);
      host.appendChild(el);
      var k = 3, t = setInterval(function () { k--; if (k <= 0) done(); else num.textContent = String(k); }, 650);
      add(function () { clearInterval(t); if (el.parentNode) el.parentNode.removeChild(el); });
      setState({ expect: 'countdown' });
    });
  }
  function pauseOverlay(host, onResume, onLeave) {
    var el = h('div', { 'class': 'hf-lpause', role: 'dialog', 'aria-label': 'Paused' }, [
      h('h2', { 'class': 'hf-h2' }, ['Paused']),
      h('p', null, ['Take your time. The item on screen when you paused does not count.']),
      h('div', { 'class': 'hf-actions' }, [
        c().button('Leave the lesson', { variant: 'quiet', onClick: function () { onLeave(); } }),
        c().button('Resume', { variant: 'primary', kbd: 'Space', onClick: function () { onResume(); } })
      ])
    ]);
    host.appendChild(el);
    var b = el.querySelector('.hf-btn--primary'); if (b) focusEl(b);
    setState({ expect: 'paused' });
    return function () { if (el.parentNode) el.parentNode.removeChild(el); };
  }

  function scaled(spec, k) {
    var s = {}; for (var key in spec) s[key] = spec[key];
    ['onMs', 'soaMs', 'windowMs', 'procLimitMs', 'memMs'].forEach(function (f) { if (isNum(s[f])) s[f] = Math.max(80, Math.round(s[f] * k)); });
    if (s.trials) s.trials = s.trials.map(function (t) { if (!isNum(t.windowMs)) return t; var x = {}; for (var q in t) x[q] = t[q]; x.windowMs = Math.round(t.windowMs * k); return x; });
    return s;
  }
  /** Runs a spec at its own pace. → { status: 'done'|'quit', spec, log, result, wrongKeys, path } */
  async function timedRun(ctx, frame, spec, o) {
    o = o || {};
    var key = viewKeyFor(spec), withSound = spec.kind === 'stream' && hasSound(spec);
    var vctx = { assist: o.assist || {}, feedback: o.feedback || 'none', hand: (records().settings || {}).leftHanded ? 'left' : 'right',
      keys: HF.input && HF.input.keys ? HF.input.keys() : null, sound: withSound, lab: false };
    var counter = rawKeyCounter(spec), attempt = 0;
    frame.running(true); hideChrome();
    setState({ phase: 'timed', expect: null, run: { trackId: spec.trackId, kind: spec.kind } });
    try {
      // 1. the block player (P1a), when present: runSpec = no commit, no debrief (contracts-ui §2)
      if (config.usePlayer && HF.player && typeof HF.player.runSpec === 'function' && HF.views && HF.views[key]) {
        var host0 = frame.body; clear(host0);
        var playerHost = h('div', { 'class': 'hf-lplayer' });
        host0.appendChild(playerHost);
        var popts = { root: playerHost, ruleCard: false, countdown: true, feedback: vctx.feedback, assist: o.assist || null, lab: false,
          debrief: false, allowQuit: true, endLabel: C().TEXT.leave, score: scorerFor(spec),
          regenerate: function (k) { return o.regen ? o.regen(k) : spec; } };
        ctx.running = true;
        var pr;
        try { pr = await HF.player.runSpec(spec, key, popts); }
        finally { ctx.running = false; }
        ctx.check();
        if (!pr || pr.status !== 'done' || !pr.log) return { status: 'quit', spec: spec, path: 'player' };
        var sp = pr.spec || spec;
        return { status: 'done', spec: sp, log: pr.log, result: pr.result || scorerFor(sp)(sp, pr.log), wrongKeys: counter.box.n, path: 'player' };
      }
      // 2. the core runners with HF.views[key] (or this file's own view)
      if (config.timeScale > 0 && config.timeScale !== 1) spec = scaled(spec, config.timeScale);
      for (;;) {
        ctx.check();
        var host = frame.body; clear(host);
        await countdown(ctx, host);
        if (spec.task === 'span' && !(config.useViews && HF.views && HF.views.span)) {
          // no span view: this file's own trial runner, with the time limit on the sums and 1 s per item
          var ents = [];
          for (var ti = 0; ti < spec.trials.length; ti++) ents.push(await spanTrial(ctx, host, spec, spec.trials[ti], { timed: true }));
          var slog = { trials: ents, paused: false };
          return { status: 'done', spec: spec, log: slog, result: HF.tasks.span.score(spec, slog), wrongKeys: counter.box.n, path: 'own' };
        }
        var mv = makeView(host, spec, vctx), view = mv.view, logx;
        var offPause = null;
        var ropts = {
          onResponse: function (resp, tr) {
            if (vctx.feedback !== 'per-response' || !view.feedback) return;
            var good;
            if (spec.kind === 'discrete') good = (tr.answer === 'match') === (resp.response === 'match');
            else { var st = resp.key === 'match2' ? 'snd' : (spec.streams.length > 1 ? 'pos' : 'main'); good = !!(tr.target && tr.target[st]); }
            try { view.feedback(good ? 'good' : 'bad', resp.key || resp.response); } catch (e) { log(e); }
          },
          onPause: function () {
            if (spec.kind !== 'discrete') return;
            offPause = pauseOverlay(host, function () { if (offPause) offPause(); offPause = null; HF.timing.resume(); },
              function () { if (offPause) offPause(); offPause = null; HF.timing.abort('lesson-left'); });
          }
        };
        if (withSound && view.sound) ropts.sound = function (tr, when) { view.sound(tr, when); };
        ctx.running = true;
        try {
          if (spec.task === 'span' && typeof view.run === 'function') logx = await view.run({ timing: HF.timing, input: HF.input, onProgress: function () {} });
          else if (spec.kind === 'discrete') logx = await HF.timing.runDiscrete(spec, view, ropts);
          else logx = await HF.timing.runStream(spec, view, ropts);
        } finally {
          ctx.running = false;
          if (offPause) offPause();
          try { view.destroy(); } catch (e) { log(e); }
        }
        ctx.check();
        if (logx && logx.aborted) return { status: 'quit', spec: spec, path: mv.own ? 'own' : 'views' };
        if (logx && logx.paused && spec.kind === 'stream') {
          clear(host);
          var pp = h('div', { 'class': 'hf-lpause' }, [h('h2', { 'class': 'hf-h2' }, ['Paused']),
            h('p', null, ['The run stopped. It starts again from the beginning when you are ready.'])]);
          host.appendChild(pp);
          var acts = h('div', { 'class': 'hf-actions' }); pp.appendChild(acts);
          restoreChrome();
          var ch = await choose(ctx, acts, [{ id: 'leave', label: C().TEXT.leave, variant: 'quiet' }, { id: 'again', label: 'Start again', variant: 'primary', kbd: 'Space' }]);
          if (ch === 'leave') return { status: 'quit', spec: spec, path: mv.own ? 'own' : 'views' };
          hideChrome();
          attempt++;
          if (o.regen) spec = o.regen(attempt);
          continue;
        }
        return { status: 'done', spec: spec, log: logx, result: scorerFor(spec)(spec, logx), wrongKeys: counter.box.n, path: mv.own ? 'own' : 'views' };
      }
    } finally {
      counter.off();
      frame.running(false);
      restoreChrome();
      try { if (ctx.opts.from !== 'session' && HF.timing && HF.timing.keepAwake) HF.timing.keepAwake(false); } catch (e) { log(e); }
    }
  }

  // ---- run summaries (plain words; explanations from why[]) --------------------------------------
  function streamName(st) { return st === 'pos' ? 'Position' : (st === 'snd' ? 'Sound' : ''); }
  function summaryLine(spec, result) {
    var T = C().TEXT, s = result.streams || {};
    if (spec.task === 'span') {
      var x = result.extra || {};
      return 'You recalled ' + x.itemsCorrect + ' of ' + x.itemsTotal + ' items in place and got ' + (result.plain.nonTargets - result.plain.falsePresses) + ' of ' + result.plain.nonTargets + ' sums right.';
    }
    if (spec.kind === 'discrete') {
      var m = s.main, what = spec.task === 'vsearch' ? 'Ts' : 'grids with a line';
      return 'You found ' + m.hits + ' of ' + (m.hits + m.misses) + ' ' + what + ' and said ' + (spec.task === 'vsearch' ? 'Present' : 'Match') + ' ' +
        (m.fas === 0 ? 'never' : (m.fas === 1 ? 'once' : m.fas + ' times')) + ' when there was none.';
    }
    if (spec.streams.length > 1) return spec.streams.map(function (st) { var q = s[st]; return streamName(st) + ': ' + q.hits + ' of ' + (q.hits + q.misses) + ' caught, ' + q.fas + (q.fas === 1 ? ' false press.' : ' false presses.'); }).join(' ');
    var p = result.plain;
    return T.timedSummary(p.caught, p.targets, p.falsePresses);
  }
  function errorList(spec, result, filter, max) {
    var errs = (result.why || []).filter(function (w) { return filter ? filter(w) : (w.outcome === 'miss' || w.outcome === 'fa' || w.outcome === 'lure-fa'); }).slice(0, max || 4);
    if (!errs.length) return null;
    return h('ul', { 'class': 'hf-lerrors' }, errs.map(function (w) {
      var tr = spec.trials[w.i], label;
      if (spec.task === 'span') label = w.stream === 'recall' ? 'List ' + (w.i + 1) : 'Sum';
      else if (spec.kind === 'discrete') label = (spec.task === 'vsearch' ? 'Display ' : 'Grid ') + (w.i + 1);
      else if (spec.trackId === 'rel.stream') label = 'Change ' + w.i;
      else label = (streamName(w.stream) ? streamName(w.stream) + ' ' : '') + '#' + (w.i + 1) + (tr ? ' · ' + itemName(w.stream === 'snd' ? tr.stim.snd : (w.stream === 'pos' ? tr.stim.pos : tr.stim.main)) : '');
      return h('li', { 'class': 'hf-lerrors__item', 'data-outcome': w.outcome }, [h('span', { 'class': 'hf-lerrors__k' }, [label]), h('span', { 'class': 'hf-lerrors__v' }, [w.text])]);
    }));
  }

  // ======================================================================== figures for explanation pages
  function legend(items) {
    return h('ol', { 'class': 'hf-llegend' }, items.map(function (t, i) {
      return h('li', { 'class': 'hf-llegend__item' }, [h('span', { 'class': 'hf-lmark', 'aria-hidden': 'true' }, [String(i + 1)]), h('span', null, [t])]);
    }));
  }
  function marked(n, node) { return h('div', { 'class': 'hf-lfig__part' }, [h('span', { 'class': 'hf-lmark hf-lmark--on', 'aria-hidden': 'true' }, [String(n)]), node]); }
  function figure(name) {
    var J = keyLabel('match', 'J');
    if (name === 'nback-parts') {
      var spec = seqSpec('nb1demo');
      return h('figure', { 'class': 'hf-lfig hf-lfig--parts' }, [
        h('div', { 'class': 'hf-lfig__mock', 'aria-hidden': 'true' }, [
          marked(1, h('div', { 'class': 'hf-lstage hf-lstage--mini' }, [itemNode(spec.trials[2].stim.main, 'stage')])),
          marked(2, tapeRow(spec, 2, { mode: 'full' })),
          marked(3, c().pads({ pads: [{ id: 'match', label: 'Match', key: J }], size: 'sm', cls: 'hf-lfig__pads' }))
        ]),
        h('figcaption', null, [legend([
          'The item. Each one shows for half a second, then the screen waits for the next.',
          'The memory tape: the last few items, with a frame on the one to compare with. You only see it in lessons and practice.',
          'Match: press ' + J + ' or tap it when the item matches. When it does not, do nothing. Esc or P pauses at any time.'
        ])])
      ]);
    }
    if (name === 'dual-parts') {
      return h('figure', { 'class': 'hf-lfig hf-lfig--parts' }, [
        h('div', { 'class': 'hf-lfig__mock', 'aria-hidden': 'true' }, [
          marked(1, h('div', { 'class': 'hf-lstage hf-lstage--mini' }, [itemNode({ cell: 2 }, 'stage'), h('span', { 'class': 'hf-lstage__sound' }, [c().icon('sound')])])),
          marked(2, c().pads({ pads: [{ id: 'match', label: 'Position', key: J, icon: 'grid' }, { id: 'match2', label: 'Sound', key: keyLabel('match2', 'K'), icon: 'sound' }], size: 'sm', cls: 'hf-lfig__pads' }))
        ]),
        h('figcaption', null, [legend(['A square in the grid and a sound arrive together.', 'Position (' + J + ') and Sound (' + keyLabel('match2', 'K') + ') each answer for their own stream.'])])
      ]);
    }
    if (name === 'switch-cue') {
      return h('figure', { 'class': 'hf-lfig hf-lfig--row' }, [
        h('div', { 'class': 'hf-lstage hf-lstage--mini', 'aria-hidden': 'true' }, [itemNode({ what: { text: '7' }, where: { cell: 0 } }, 'stage', { cue: 'where' })]),
        h('figcaption', { 'class': 'hf-small' }, ['WHERE: compare the place with n back (top left). The digit does not matter.'])
      ]);
    }
    if (name === 'steps-example') {
      var st = seqSpec('st1demo');
      return h('figure', { 'class': 'hf-lfig' }, [stepsTape(st, 2, { steps: true }), h('figcaption', { 'class': 'hf-small' }, ['3, 6, 9: two steps of 3, so 9 is a match.'])]);
    }
    if (name === 'grid-parts') {
      var g = handGridSpec(['gridRow']);
      return h('figure', { 'class': 'hf-lfig hf-lfig--row' }, [
        h('div', { 'class': 'hf-lstage hf-lstage--mini hf-lstage--array', 'aria-hidden': 'true' }, [arrayNode(g.trials[0].stim, g.meta, { spec: g, highlight: true, lineCells: [3, 4, 5] })]),
        h('figcaption', null, [legend(['Each cell is a short group of symbols, such as 625.', 'Only its last symbol counts: here 5. It is highlighted in lessons only.', 'Row 2 ends 5, 5, 5: all the same, so the answer is Match.'])])
      ]);
    }
    if (name === 'stream-parts') {
      var g2 = handGridSpec(['gridNear']);
      return h('figure', { 'class': 'hf-lfig hf-lfig--row' }, [
        h('div', { 'class': 'hf-lstage hf-lstage--mini hf-lstage--array', 'aria-hidden': 'true' }, [arrayNode(g2.trials[0].stim, g2.meta, { spec: g2, highlight: true, changed: [5] })]),
        h('figcaption', { 'class': 'hf-small' }, ['The outlined cell just changed. A new line can only appear through it.'])
      ]);
    }
    if (name === 'span-parts') {
      return h('figure', { 'class': 'hf-lfig' }, [h('div', { 'class': 'hf-lspanfig', 'aria-hidden': 'true' }, [
        h('span', { 'class': 'hf-lspanfig__box' }, ['7 − 3 = 4']), h('span', { 'class': 'hf-lspanfig__arrow' }, ['→']),
        h('span', { 'class': 'hf-lspanfig__box hf-lspanfig__box--mem' }, ['F']), h('span', { 'class': 'hf-lspanfig__arrow' }, ['→']),
        h('span', { 'class': 'hf-lspanfig__box' }, ['2 + 5 = 8']), h('span', { 'class': 'hf-lspanfig__arrow' }, ['→']),
        h('span', { 'class': 'hf-lspanfig__box hf-lspanfig__box--mem' }, ['K']), h('span', { 'class': 'hf-lspanfig__arrow' }, ['→']),
        h('span', { 'class': 'hf-lspanfig__box' }, ['F K'])]),
        h('figcaption', { 'class': 'hf-small' }, ['True, remember F; false, remember K; then tap F, K.'])]);
    }
    if (name === 'vsearch-parts') {
      var vs = genSpec({ trackId: 'vs.search', rung: 0, seed: 'lesson/vsearch/fig' }), tr = null;
      vs.trials.forEach(function (t) { if (!tr && t.answer === 'match') tr = t; });
      return h('figure', { 'class': 'hf-lfig hf-lfig--row' }, [h('div', { 'class': 'hf-lstage hf-lstage--mini hf-lstage--vs', 'aria-hidden': 'true' }, [vsNode(tr.stim, { showT: true })]),
        h('figcaption', { 'class': 'hf-small' }, ['The ringed letter is a T: a bar with a crossbar centred on it. An L has its bar at the end.'])]);
    }
    if (name === 'timeline') {
      return h('figure', { 'class': 'hf-lfig' }, [h('div', { 'class': 'hf-ltimeline', 'aria-hidden': 'true' }, [
        h('span', { 'class': 'hf-ltimeline__on' }, ['letter']), h('span', { 'class': 'hf-ltimeline__wait' }, ['still time to press']), h('span', { 'class': 'hf-ltimeline__next' }, ['next'])]),
        h('figcaption', { 'class': 'hf-small' }, ['0 s: the letter appears. 0.5 s: it goes. Until 3 s: a press still counts for it. Then the next letter.'])]);
    }
    return null;
  }

  // ======================================================================== step handlers
  async function pageStep(ctx, frame, step) {
    var content = frame.page(step);
    (step.body || []).forEach(function (p) { content.appendChild(h('p', { 'class': 'hf-prose' }, [p])); });
    var fig = step.figure ? figure(step.figure) : null;
    if (fig) content.appendChild(fig);
    if (step.note) content.appendChild(c().notice({ tone: 'info', text: step.note, slim: true }));
    var choices = [leaveChoice(ctx)];
    if (step.skipToCheck) choices.push({ id: 'skip', label: 'I know n-back: skip to the check', variant: 'quiet' });
    choices.push({ id: 'next', label: 'Next', variant: 'primary', kbd: 'Space' });
    var id = await choose(ctx, frame.actions, choices);
    if (id === 'leave') throw CANCEL;
    return id;
  }
  async function streamStep(ctx, frame, step, demo) {
    var spec = seqSpec(step.seq, { onMs: step.onMs, soaMs: step.soaMs });
    var content = frame.page(step);
    if (step.noButton && !demo) content.appendChild(c().notice({ tone: 'info', text: C().TEXT.noButtonNote, slim: true }));
    if (step.sound) {
      // sound needs a gesture before the first item
      var id0 = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'start', label: 'Start with sound', variant: 'primary', kbd: 'Space', icon: 'sound',
        sync: function () { if (HF.audio && HF.audio.unlock) HF.audio.unlock(); } }]);
      if (id0 === 'leave') throw CANCEL;
      clear(frame.actions);
    }
    setState({ phase: demo ? 'demo' : 'guided', seq: step.seq });
    var out = await guidedStream(ctx, content, spec, step, { demo: demo });
    if (!demo && out.total) content.appendChild(c().notice({ tone: 'good', title: 'Done', text: 'You answered ' + out.right + ' of ' + out.total + ' correctly.', slim: true }));
    else content.appendChild(h('p', { 'class': 'hf-small hf-muted' }, ['End of the example.']));
    await nextOrLeave(ctx, frame);
  }
  function startRuleCard(spec, step, title) {
    var J = keyLabel('match', 'J');
    var keysRows = spec.kind === 'discrete'
      ? [{ key: J, pad: spec.task === 'vsearch' ? 'Present' : 'Match', yes: true, when: spec.task === 'vsearch' ? 'there is a T' : 'a line fits the rule' },
        { key: keyLabel('no', 'F'), pad: spec.task === 'vsearch' ? 'Absent' : 'No', when: spec.task === 'vsearch' ? 'there is none' : 'no line fits' }]
      : (spec.task === 'span' ? [{ key: J, pad: 'True', yes: true, when: 'the sum is right' }, { key: keyLabel('no', 'F'), pad: 'False', when: 'it is wrong' }]
        : (spec.streams && spec.streams.length > 1 ? [{ key: J, pad: 'Position', yes: true, when: 'the place matches' }, { key: keyLabel('match2', 'K'), pad: 'Sound', yes: true, when: 'the sound matches' }, { none: true, when: 'neither matches' }]
          : [{ key: J, pad: 'Match', yes: true, when: 'it matches' }, { none: true, when: 'it does not. Doing nothing is an answer.' }]));
    var rule = step.rule;
    if (!rule) { try { rule = HF.catalog.ruleCard(spec.trackId, spec.rung || 0, spec.set).rule; } catch (e) { rule = ''; } }
    return c().ruleCard({ title: title || step.title, rule: rule, keys: keysRows, note: step.passText || null, hint: false });
  }
  async function timedStep(ctx, frame, step) {
    var spec = seqSpec(step.seq, { onMs: step.onMs, soaMs: step.soaMs });
    for (;;) {
      var content = frame.page(step);
      content.appendChild(startRuleCard(spec, step, step.title));
      var withSound = hasSound(spec);
      var id = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'start', label: 'Start', variant: 'primary', kbd: 'Space', sync: function () { startGesture(withSound); } }]);
      if (id === 'leave') throw CANCEL;
      var r = await timedRun(ctx, frame, spec, { feedback: step.feedback || 'none' });
      if (r.status === 'quit') throw CANCEL;
      var c2 = frame.page(step, { title: step.title + ': how it went', lead: summaryLine(r.spec, r.result), phase: 'result' });
      var errs = errorList(r.spec, r.result);
      if (errs) { c2.appendChild(h('p', { 'class': 'hf-strong' }, ['What happened on the ones that went wrong:'])); c2.appendChild(errs); }
      else c2.appendChild(c().notice({ tone: 'good', text: 'No mistakes at all.', slim: true }));
      setState({ result: { caught: r.result.plain.caught, targets: r.result.plain.targets, falsePresses: r.result.plain.falsePresses } });
      var again = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'again', label: 'Try again', variant: 'secondary' }, { id: 'next', label: 'Next', variant: 'primary', kbd: 'Space' }]);
      if (again === 'leave') throw CANCEL;
      if (again === 'next') return r;
    }
  }

  // ---- checks -------------------------------------------------------------------------------------
  function checkSpec(lessonId, attempt) {
    var chk = C().CHECKS[lessonId];
    var seed = 'lesson/' + lessonId + '/check/' + Date.now().toString(36) + '/' + attempt;
    return genSpec({ trackId: chk.trackId, rung: chk.rung, set: chk.set, seed: seed, params: chk.params });
  }
  function judgeCheck(lessonId, run) {
    var chk = C().CHECKS[lessonId], res = run.result;
    if (res.voidedRatio > 0.2) return { interrupted: true };
    if (run.spec.task === 'span') {
      var x = res.extra || {}, judged = res.plain.nonTargets - res.plain.falsePresses;
      return { pass: x.itemsCorrect >= chk.minRecall && judged >= chk.minJudge, recall: x.itemsCorrect, judged: judged };
    }
    var streams = Object.keys(res.streams || {});
    var ok = streams.length > 0 && streams.every(function (st) { var s = res.streams[st]; return s.hits >= chk.minHits && s.fas <= chk.maxFas; });
    var m = res.streams[streams[0]];
    return { pass: ok, hits: m.hits, fas: m.fas, targets: m.hits + m.misses };
  }
  /** Why a failed n-back check went wrong → one of the four mini-lessons. */
  function analyse(run) {
    var res = run.result, s = res.streams.main, spec = run.spec, pressed = {}, late = 0, lateIdx = [];
    (run.log && run.log.responses || []).forEach(function (r) { if (r.key === 'match') pressed[r.trial] = r; });
    Object.keys(pressed).forEach(function (k) {
      var j = +k, r = pressed[k], tr = spec.trials[j], prev = spec.trials[j - 1];
      if (!tr || !prev || !prev.scorable) return;
      if (isNum(r.rt) && r.rt < 450 && !tr.target.main && prev.target.main && !pressed[j - 1]) { late++; lateIdx.push(j); }
    });
    var lureFa = s.lureFas || 0, plainFa = s.fas - lureFa, route;
    if ((run.wrongKeys || 0) >= 2) route = 'keys';
    else if (late >= 2 && late * 2 >= s.fas) route = 'timing';     // lateness must explain most of the false presses
    else if (lureFa >= 2 && lureFa >= plainFa) route = 'window';
    else if (s.fas > 2) route = 'nothing';
    else route = 'window';
    return { route: route, late: late, lateIdx: lateIdx, lureFa: lureFa, plainFa: plainFa, wrongKeys: run.wrongKeys || 0, hits: s.hits, fas: s.fas };
  }
  async function runCheckOnce(ctx, frame, lessonId, step, st) {
    var chk = C().CHECKS[lessonId];
    st.attempt++;
    var spec = checkSpec(lessonId, st.attempt);
    var content = frame.page(step, { lead: step.lead });
    content.appendChild(startRuleCard(spec, { title: chk.label, passText: chk.pass }, step.title + ': ' + chk.label));
    if (spec.task === 'nback' && spec.streams.length === 1 && lessonId === 'lesson.nback') {
      content.appendChild(c().tape({ items: ['K', 'T', 'K', 'R'], compare: 0, target: 2, label: '2 back: same letter', spoken: 'Example: K, T, K. The second K matches the letter two back.' }));
    }
    var withSound = hasSound(spec);
    var id = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'start', label: 'Start the check', variant: 'primary', kbd: 'Space', sync: function () { startGesture(withSound); } }]);
    if (id === 'leave') throw CANCEL;
    var run2 = await timedRun(ctx, frame, spec, { feedback: 'none', regen: function (k) { return checkSpec(lessonId, st.attempt + '.' + k); } });
    if (run2.status === 'quit') return { quit: true };
    var v = judgeCheck(lessonId, run2);
    v.run = run2;
    setState({ check: { pass: !!v.pass, interrupted: !!v.interrupted, hits: v.hits, fas: v.fas, attempt: st.attempt, path: run2.path } });
    return v;
  }
  function passSentence(lessonId) { var p = C().CHECKS[lessonId].pass; return 'To pass: ' + p.charAt(0).toLowerCase() + p.slice(1); }
  async function checkLoop(ctx, frame, step, st, steps) {
    var lessonId = ctx.lessonId;
    for (;;) {
      var v = await runCheckOnce(ctx, frame, lessonId, step, st);
      if (v.quit) throw CANCEL;
      if (v.interrupted) {
        frame.page(step, { title: 'The check was interrupted', lead: 'Too many items could not be shown on time (the device was busy). This does not count. Please run it again.', phase: 'result' });
        var a0 = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'again', label: 'Run it again', variant: 'primary', kbd: 'Space' }]);
        if (a0 === 'leave') throw CANCEL;
        continue;
      }
      var res = v.run.result, spec = v.run.spec;
      if (v.pass) {
        st.passed = true;
        if (!ctx.replay) addEvent('lesson-passed', { lessonId: lessonId });
        var cp = frame.page(step, { title: 'Check passed', lead: summaryLine(spec, res), phase: 'result' });
        cp.appendChild(c().notice({ tone: 'good', title: 'That passes the check.', text: C().CHECKS[lessonId].pass, slim: true }));
        var eL = errorList(spec, res, null, 3);
        if (eL) { cp.appendChild(h('details', { 'class': 'hf-details' }, [h('summary', null, ['The ones that went wrong']), h('div', { 'class': 'hf-details__body' }, [eL])])); }
        await nextOrLeave(ctx, frame, 'Continue');
        return;
      }
      // not passed
      if (!ctx.replay) { addEvent('lesson-failed', { lessonId: lessonId }); st.fails++; }
      var info = lessonId === 'lesson.nback' ? analyse(v.run) : null;
      setState({ analysis: info });
      if (!ctx.replay && st.fails >= 2) {
        // one assisted start per track: a later replay that is not passed must not restart (or reset) the assisted blocks
        var prevA = lessonStatus(lessonId).assistStart, aTrack = lessonId === 'lesson.nback' ? 'nback.plain' : (lessonId === 'lesson.grid' ? 'rel.grid.T1' : null);
        if (aTrack && !(prevA && (prevA.trackId || 'nback.plain') === aTrack)) {
          addEvent('assist-start', { trackId: aTrack });
          st.assisted = true;
        } else if (aTrack && prevA && (prevA.trackId || 'nback.plain') === aTrack) st.assisted = true;
        var cf = frame.page(step, { title: 'Not passed this time', lead: summaryLine(spec, res), phase: 'result' });
        cf.appendChild(h('p', { 'class': 'hf-prose' }, [passSentence(lessonId)]));
        var e2 = errorList(spec, res, null, 4);
        if (e2) { cf.appendChild(h('p', { 'class': 'hf-strong' }, ['What happened:'])); cf.appendChild(e2); }
        await nextOrLeave(ctx, frame, 'Continue');
        return;
      }
      var cr = frame.page(step, { title: 'Not passed yet', lead: summaryLine(spec, res), phase: 'result' });
      cr.appendChild(h('p', { 'class': 'hf-prose' }, [passSentence(lessonId)]));
      if (info) {
        var M = C().MINI[info.route];
        cr.appendChild(c().notice({ tone: 'info', title: 'One thing to look at: ' + M.title, text: M.lead }));
        var a1 = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'mini', label: 'Show me', variant: 'primary', kbd: 'Space' }]);
        if (a1 === 'leave') throw CANCEL;
        await miniLesson(ctx, frame, info.route, v.run, info);
        continue;
      }
      var e3 = errorList(spec, res, null, 4);
      if (e3) { cr.appendChild(h('p', { 'class': 'hf-strong' }, ['What happened:'])); cr.appendChild(e3); }
      var gIdx = -1;
      steps.forEach(function (s2, k) { if (s2.type === 'guided' || s2.type === 'arrays' || s2.type === 'stream-guided' || s2.type === 'span-guided' || s2.type === 'vs-guided') gIdx = k; });
      var a2 = await choose(ctx, frame.actions, [leaveChoice(ctx), gIdx >= 0 ? { id: 'practise', label: 'Practise once more', variant: 'secondary' } : null,
        { id: 'again', label: 'Try the check again', variant: 'primary', kbd: 'Space' }]);
      if (a2 === 'leave') throw CANCEL;
      if (a2 === 'practise') await runStep(ctx, frame, steps[gIdx], st, steps);
    }
  }

  // ---- mini-lessons (after a failed n-back check) --------------------------------------------------
  async function miniLesson(ctx, frame, routeId, run, info) {
    var M = C().MINI[routeId], mstep = { type: 'mini', part: 6, title: M.title, lead: M.lead };
    var content = frame.page(mstep, { phase: 'mini' });
    setState({ mini: routeId });
    M.body.forEach(function (p) { content.appendChild(h('p', { 'class': 'hf-prose' }, [p])); });
    var J = keyLabel('match', 'J');
    if (routeId === 'keys') content.appendChild(c().keys([{ key: J, pad: 'Match', yes: true, when: 'the letter matches 2 back' }, { none: true, when: 'it does not' }, { key: 'Esc', when: 'you need a pause (P works too)' }]));
    if (routeId === 'timing') content.appendChild(figure('timeline'));
    if (M.fromCheck && run) {
      var filter = routeId === 'nothing' ? function (w) { return w.outcome === 'fa' || w.outcome === 'lure-fa'; }
        : (routeId === 'window' ? function (w) { return w.outcome === 'lure-fa' || w.outcome === 'miss'; }
          : function (w) { return info && info.lateIdx.indexOf(w.i) >= 0; });
      var ex = errorList(run.spec, run.result, filter, 2);
      if (ex) { content.appendChild(h('p', { 'class': 'hf-strong' }, [M.fromCheck])); content.appendChild(ex); }
    }
    await nextOrLeave(ctx, frame, 'Practise');
    var d = M.drill;
    if (routeId === 'keys') await keyDrill(ctx, frame, mstep, d);
    else if (d.onMs) await timedStep(ctx, frame, { type: 'timed', part: 6, title: d.title, lead: d.lead, seq: d.seq, onMs: d.onMs, soaMs: d.soaMs, feedback: d.feedback, rule: d.rule });
    else await streamStep(ctx, frame, { type: 'guided', part: 6, title: d.title, lead: d.lead, seq: d.seq, tape: d.tape, noButton: d.noButton, probes: d.probes }, false);
  }
  async function keyDrill(ctx, frame, mstep, d) {
    var content = frame.page({ type: 'mini', part: 6, title: d.title, lead: d.lead }, { phase: 'keys' });
    var board = new Board(content, { cls: 'hf-lboard--keys' });
    for (var k = 0; k < d.rounds; k++) {
      board.say(msgNode('Round ' + (k + 1) + ' of ' + d.rounds + ': press the Match key now.', 'plain'));
      clear(board.controls);
      board.controls.appendChild(c().pads({ pads: [{ id: 'match', label: 'Match', key: keyLabel('match', 'J') }], label: 'Answer' }));
      focusEl(board.el);
      var got = await waitFor(ctx, function (done, add) {
        add(onInput(function (ev) { if (ev.key === 'match') done({ ok: true }); }));
        add(listen(root, 'keydown', function (e) {
          if (e.repeat || /^(Shift|Control|Alt|Meta|Tab|CapsLock)/.test(e.code || '')) return;
          var codes = []; try { codes = HF.input.codesFor('match'); } catch (x) { /* ignore */ }
          if (codes.indexOf(e.code) < 0) done({ ok: false, code: e.code });
        }, true));
        setState({ expect: 'match-key' });
      });
      board.say(got.ok ? msgNode('Yes: that is the Match key.', 'good') : msgNode('That was ' + (HF.input.codeLabel ? HF.input.codeLabel(got.code) : got.code) + '. The Match key is ' + keyLabel('match', 'J') + '.', 'plain'));
      if (!got.ok) k--;
      await ctx.sleep(700);
    }
    board.el.parentNode.removeChild(board.el);
    content.appendChild(c().notice({ tone: 'good', text: 'Keep a finger resting on ' + keyLabel('match', 'J') + ' during blocks.', slim: true }));
    await nextOrLeave(ctx, frame, 'Back to the check');
  }

  // ---- other step types ----------------------------------------------------------------------------
  async function arraysStep(ctx, frame, step) {
    var g = step.gen || {};
    var base = genSpec({ trackId: 'rel.grid.T1', rung: g.rung || 0, set: 'digits', seed: 'lesson/grid/' + step.mode + '/' + Date.now().toString(36) });
    var spec = pickTrials(base, g.targets || 3, g.others || 3);
    if (step.mode === 'guided') {
      var content = frame.page(step);
      var out = await guidedArrays(ctx, content, spec, { highlight: true });
      content.appendChild(c().notice({ tone: 'good', title: 'Done', text: 'You answered ' + out.right + ' of ' + out.total + ' correctly.', slim: true }));
      await nextOrLeave(ctx, frame);
      return;
    }
    await timedSpecStep(ctx, frame, step, spec);
  }
  async function timedSpecStep(ctx, frame, step, spec) {
    for (;;) {
      var content = frame.page(step);
      content.appendChild(startRuleCard(spec, step, step.title));
      var id = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'start', label: 'Start', variant: 'primary', kbd: 'Space', sync: function () { startGesture(false); } }]);
      if (id === 'leave') throw CANCEL;
      var r = await timedRun(ctx, frame, spec, { feedback: 'per-response' });
      if (r.status === 'quit') throw CANCEL;
      var c2 = frame.page(step, { title: step.title + ': how it went', lead: summaryLine(r.spec, r.result), phase: 'result' });
      var errs = errorList(r.spec, r.result);
      if (errs) { c2.appendChild(h('p', { 'class': 'hf-strong' }, ['What happened on the ones that went wrong:'])); c2.appendChild(errs); }
      var again = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'again', label: 'Try again', variant: 'secondary' }, { id: 'next', label: 'Next', variant: 'primary', kbd: 'Space' }]);
      if (again === 'leave') throw CANCEL;
      if (again === 'next') return;
    }
  }
  function streamLessonSpec() {
    // a generated Relation Stream block (rule: same); pick a seed whose first target comes early enough to show
    for (var k = 0; k < 40; k++) {
      var s = genSpec({ trackId: 'rel.stream', rung: 0, set: 'digits', seed: 'lesson/stream/' + k, params: { rule: 'same' } });
      var first = -1; s.trials.forEach(function (t) { if (first < 0 && t.target.main) first = t.i; });
      var later = s.trials.filter(function (t) { return t.target.main && t.i > first + 1 && t.i <= first + 11; }).length;
      if (first >= 3 && first <= 8 && later >= 2) return { spec: s, first: first };
    }
    var s0 = genSpec({ trackId: 'rel.stream', rung: 0, set: 'digits', seed: 'lesson/stream/0', params: { rule: 'same' } });
    var f0 = 1; s0.trials.forEach(function (t) { if (f0 === 1 && t.target.main) f0 = t.i; });
    return { spec: s0, first: f0 };
  }
  async function tierStep(ctx, frame, lessonId) {
    var key = lessonId.slice(-2), t = C().TIERS[key], step = { type: 'tier', part: 1, title: t.title, lead: t.rule };
    var spec = genSpec({ trackId: 'rel.grid.' + key, rung: 0, set: t.set === 'shapes' ? undefined : t.set, seed: 'lesson/tier/' + key });
    var tr = null; spec.trials.forEach(function (x) { if (!tr && x.answer === 'match') tr = x; });
    var content = frame.page(step);
    t.body.forEach(function (p) { content.appendChild(h('p', { 'class': 'hf-prose' }, [p])); });
    if (spec.meta.rule && spec.meta.rule.text) content.appendChild(c().notice({ tone: 'info', title: 'This block\u2019s rule', text: ruleWords(spec.meta.rule.text), slim: true }));
    if (tr) {
      var w = discreteWhy(spec, [{ i: tr.i, response: 'match', rt: 1000 }], tr.i)[0];
      var fig = h('figure', { 'class': 'hf-lfig hf-lfig--row' }, [
        h('div', { 'class': 'hf-lstage hf-lstage--mini hf-lstage--array' + (spec.meta.size === 4 ? ' hf-lstage--4' : ''), 'aria-hidden': 'true' }, [
          arrayNode(tr.stim, spec.meta, { spec: spec, highlight: true, lineCells: w && w.cells })]),
        h('figcaption', null, [h('p', { 'class': 'hf-strong' }, ['Example']), h('p', null, [w ? w.text : '']),
          spec.meta.rule.orderKey ? h('p', { 'class': 'hf-small' }, ['Order key: ' + spec.meta.rule.orderKey.join(' < ')]) : null])
      ]);
      content.appendChild(fig);
    }
    var id = await choose(ctx, frame.actions, [leaveChoice(ctx), { id: 'next', label: 'Got it', variant: 'primary', kbd: 'Space' }]);
    if (id === 'leave') throw CANCEL;
  }
  async function endStep(ctx, frame, step, st) {
    var E = C().END, lessonId = ctx.lessonId, page;
    if (ctx.replay) page = st.passed ? E.replay : E.replay;
    else if (lessonId === 'lesson.nback') page = st.passed ? E.nbackPassed : (st.assisted ? E.nbackAssisted : E.notYet);
    else if (lessonId === 'lesson.grid' && st.assisted) page = E.assistedGrid;
    else page = st.passed ? E.passed : E.notYet;
    var content = frame.page(step, { title: page.title, lead: null, phase: 'end' });
    page.body.forEach(function (p) { content.appendChild(h('p', { 'class': 'hf-prose' }, [p])); });
    if (lessonId === 'lesson.nback') {
      var T = C().TEXT;
      content.appendChild(h('div', { 'class': 'hf-notice hf-lchimera' }, [
        c().icon('people', { cls: 'hf-notice__icon' }),
        h('p', { 'class': 'hf-notice__text' }, [T.chimera, h('a', { href: T.chimeraUrl, target: '_blank', rel: 'noopener', 'class': 'hf-link' }, [T.chimeraText]),
          h('span', { 'class': 'hf-vh' }, [' (opens in a new tab)'])])
      ]));
    }
    setState({ phase: 'end', result: { passed: st.passed, assisted: st.assisted } });
    await choose(ctx, frame.actions, [{ id: 'finish', label: ctx.opts.finishLabel || (ctx.opts.from === 'session' ? 'Continue' : 'Finish'), variant: 'primary', kbd: 'Space' }]);
  }

  // ======================================================================== the interpreter
  async function runStep(ctx, frame, step, st, steps) {
    ctx.check();
    if (ctx.opts.onStep) { try { ctx.opts.onStep({ lessonId: ctx.lessonId, type: step.type, title: step.title }); } catch (e) { log(e); } }
    switch (step.type) {
      case 'page': return pageStep(ctx, frame, step);
      case 'demo': return streamStep(ctx, frame, step, true);
      case 'guided': return streamStep(ctx, frame, step, false);
      case 'timed': return timedStep(ctx, frame, step);
      case 'lines-demo': {
        var c1 = frame.page(step);
        await guidedArrays(ctx, c1, handGridSpec(step.arrays), { demo: true, highlight: true });
        c1.appendChild(h('p', { 'class': 'hf-small hf-muted' }, ['End of the examples.']));
        return nextOrLeave(ctx, frame);
      }
      case 'lines': {
        var c2 = frame.page(step);
        var o2 = await linesExercise(ctx, c2, handGridSpec(step.arrays));
        c2.appendChild(c().notice({ tone: 'good', title: 'Done', text: 'You found ' + o2.right + ' of ' + o2.total + ' lines.', slim: true }));
        return nextOrLeave(ctx, frame);
      }
      case 'arrays': return arraysStep(ctx, frame, step);
      case 'stream-demo': case 'stream-guided': {
        if (!st.stream) st.stream = streamLessonSpec();
        var sp = st.stream, c3 = frame.page(step), demo = step.type === 'stream-demo';
        var out = demo ? await guidedRstream(ctx, c3, sp.spec, 0, Math.min(sp.spec.trials.length, sp.first + 1), { demo: true, stopAfterTarget: true })
          : await guidedRstream(ctx, c3, sp.spec, sp.first + 1, Math.min(sp.spec.trials.length, sp.first + 11), {});
        if (!demo) c3.appendChild(c().notice({ tone: 'good', title: 'Done', text: 'You answered ' + out.right + ' of ' + out.total + ' correctly.', slim: true }));
        return nextOrLeave(ctx, frame);
      }
      case 'span-demo': case 'span-guided': {
        var c4 = frame.page(step), spec4;
        if (step.type === 'span-demo') {
          spec4 = genSpec({ trackId: 'span.op', rung: 0, seed: 'lesson/span/demo' });
          var tr4 = spec4.trials[0];
          tr4 = { i: 0, setSize: 2, order: 'forward', recallKeypad: tr4.recallKeypad, pairs: [
            { proc: { text: '7 − 3 = 4', a: 7, b: 3, op: '-', shown: 4, value: 4, correct: true }, mem: 'F' },
            { proc: { text: '2 + 5 = 8', a: 2, b: 5, op: '+', shown: 8, value: 7, correct: false }, mem: 'K' }] };
          await spanTrial(ctx, c4, spec4, tr4, { demo: true });
        } else {
          spec4 = genSpec({ trackId: 'span.op', rung: 0, seed: 'lesson/span/guided/' + Date.now().toString(36) });
          await spanTrial(ctx, c4, spec4, spec4.trials[0], {});
        }
        return nextOrLeave(ctx, frame);
      }
      case 'vs-guided': {
        var c5 = frame.page(step);
        var vs = pickTrials(genSpec({ trackId: 'vs.search', rung: 0, seed: 'lesson/vsearch/' + Date.now().toString(36) }), 2, 2);
        var o5 = await guidedArrays(ctx, c5, vs, {});
        c5.appendChild(c().notice({ tone: 'good', title: 'Done', text: 'You answered ' + o5.right + ' of ' + o5.total + ' correctly.', slim: true }));
        return nextOrLeave(ctx, frame);
      }
      case 'tier': return tierStep(ctx, frame, ctx.lessonId);
      case 'check': return checkLoop(ctx, frame, step, st, steps);
      case 'end': return endStep(ctx, frame, step, st);
      default: return null;
    }
  }
  async function play(ctx) {
    var id = ctx.lessonId, lesson = C().get(id);
    var steps = C().STEPS[id] || (lesson.kind === 'intro' ? [{ type: 'tier', part: 1, title: C().TIERS[id.slice(-2)].title }] : []);
    var frame = new Frame(ctx, lesson, steps, { replay: ctx.replay });
    var st = { attempt: 0, fails: ctx.replay ? 0 : lessonStatus(id).failed, passed: false, assisted: false };
    setState({ lessonId: id, replay: ctx.replay });
    for (var si = 0; si < steps.length; si++) {
      var step = steps[si];
      var r = await runStep(ctx, frame, step, st, steps);
      if (r === 'skip') { for (var k = si + 1; k < steps.length; k++) if (steps[k].type === 'check') { si = k - 1; break; } }
      if (step.type === 'tier') { st.passed = true; if (!ctx.replay) addEvent('lesson-passed', { lessonId: id }); }
    }
    return { passed: st.passed, assisted: st.assisted };
  }

  // ======================================================================== public API
  function run(lessonId, rootEl, opts) {
    opts = opts || {};
    if (!C() || !C().get(lessonId) || !rootEl) return Promise.resolve({ passed: false, assisted: false, error: 'unknown lesson' });
    if (activeCtx) activeCtx.abort();
    var ctx = new Ctx(rootEl, lessonId, opts);
    ctx.replay = opts.replay !== undefined ? !!opts.replay : lessonStatus(lessonId).passed !== null;
    activeCtx = ctx;
    STATE = { lessonId: lessonId, replay: ctx.replay, from: opts.from || null };
    return play(ctx).then(function (r) { return r; }, function (e) {
      if (e !== CANCEL) { log(e); return { passed: false, assisted: false, quit: true, error: String(e && e.message || e) }; }
      return { passed: false, assisted: false, quit: true };
    }).then(function (r) {
      if (activeCtx === ctx) activeCtx = null;
      ctx.abort();
      STATE.done = r;
      return r;
    });
  }
  function abort() { if (!activeCtx) return false; var x = activeCtx; activeCtx = null; x.abort(); return true; }

  /** The rule of a practice block in one line (the block's own rule for Relations), plus the order key if any. */
  function ruleBanner(spec) {
    var text = null, key = null;
    try {
      if (spec.task === 'relations' && spec.trackId !== 'rel.steps' && spec.meta && spec.meta.rule) { text = spec.meta.rule.text; key = spec.meta.rule.orderKey || null; }
      else text = HF.catalog.ruleCard(spec.trackId, spec.rung || 0, spec.set, { step: spec.params && spec.params.step }).rule;
    } catch (e) { text = null; }
    if (!text) return null;
    var kids = [c().notice({ tone: 'info', title: 'Rule', text: ruleWords(text), slim: true })];
    if (key && key.length) {
      var row = [h('span', { 'class': 'hf-small hf-strong' }, ['Order, lowest first: '])];
      var isSym = ['icons', 'dots', 'bars', 'glyphs', 'lab'].indexOf(spec.meta.variant) >= 0;
      key.forEach(function (sym, i) {
        if (i) row.push(h('span', { 'class': 'hf-lorder__lt', 'aria-hidden': 'true' }, ['<']));
        var cell = h('span', { 'class': 'hf-lorder__sym' }, [isSym && !viewGrid() ? symNode(spec.meta.variant, sym, spec.meta) : String(sym)]);
        if (isSym && viewGrid() && HF.views.relations.symbolHTML) { try { cell.innerHTML = HF.views.relations.symbolHTML(spec, sym); } catch (e) { log(e); } }
        row.push(cell);
      });
      kids.push(h('p', { 'class': 'hf-lorder' }, row));
    }
    return h('div', { 'class': 'hf-stack hf-stack--sm hf-lpractice__rule' }, kids);
  }

  /** Untimed self-paced practice: one generated block of the chosen track; nothing is saved. → { right, total } */
  function practice(rootEl, o) {
    o = o || {};
    if (activeCtx) activeCtx.abort();
    var ctx = new Ctx(rootEl, 'practice', { noLeave: true });
    activeCtx = ctx;
    STATE = { lessonId: 'practice', trackId: o.trackId };
    var p = (async function () {
      var tr = HF.catalog.get(o.trackId), seed = 'practice/' + o.trackId + '/' + Date.now().toString(36);
      var spec = genSpec({ trackId: o.trackId, rung: o.rung || 0, set: o.set || undefined, seed: seed });
      var banner = ruleBanner(spec);
      if (banner) rootEl.appendChild(banner);
      if (tr.task === 'relations' && tr.tier) return guidedArrays(ctx, rootEl, spec, { highlight: o.highlight !== false });
      if (tr.task === 'vsearch') return guidedArrays(ctx, rootEl, spec, {});
      if (o.trackId === 'rel.stream') return guidedRstream(ctx, rootEl, spec, 0, spec.trials.length, {});
      if (tr.task === 'span') {
        var right = 0;
        for (var k = 0; k < spec.trials.length; k++) {
          var e = await spanTrial(ctx, rootEl, spec, spec.trials[k], {});
          var r1 = HF.tasks.span.score(spanOne(spec, spec.trials[k]), { trials: [e] });
          if (r1.extra.perfectTrials === 1) right++;
        }
        return { right: right, total: spec.trials.length };
      }
      var step = { tape: [[0, o.tape === false ? 'none' : 'full']], noButton: true, support: [[0, o.tape !== false]],
        show: { hints: o.trackId === 'nback.transform', values: o.trackId === 'nback.arith', steps: o.trackId === 'rel.steps' && spec.params.back === 1, arcs: o.trackId === 'rel.steps' && spec.params.back > 1 } };
      if (hasSound(spec)) {
        var go = h('div', { 'class': 'hf-actions' });
        rootEl.appendChild(go);
        await choose(ctx, go, [{ id: 'start', label: 'Start with sound', variant: 'primary', kbd: 'Space', icon: 'sound', sync: function () { if (HF.audio && HF.audio.unlock) HF.audio.unlock(); } }]);
        if (go.parentNode) go.parentNode.removeChild(go);
      }
      return guidedStream(ctx, rootEl, spec, step, {});
    })();
    return p.then(function (r) { return r; }, function (e) { if (e !== CANCEL) log(e); return { quit: true }; })
      .then(function (r) { if (activeCtx === ctx) activeCtx = null; ctx.abort(); return r; });
  }

  ui.lessons = {
    needed: needed, run: run, list: list, practice: practice, abort: abort,
    active: function () { return !!activeCtx; },
    config: config,
    status: lessonStatus,
    _state: function () { return STATE; },
    _internal: { seqSpec: seqSpec, genSpec: genSpec, handGridSpec: handGridSpec, analyse: analyse, judgeCheck: judgeCheck, itemNode: itemNode,
      arrayNode: arrayNode, tapeRow: tapeRow, stepsTape: stepsTape, vsNode: vsNode, figure: figure, perfectWhy: perfectWhy, whyAt: whyAt }
  };
})(typeof window !== 'undefined' ? window : globalThis);
