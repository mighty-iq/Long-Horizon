/* Long-Horizon — Relations views: Equal Steps, Relation Grid T1–T8, Relation Stream (browser only). MIT licence.
 * Needs HF.sets (shapes, glyph paths); uses HF.ui.c.pads when present (design system), HF.input for key labels.
 *
 * HF.views.relations.create(root, spec, ctx) → view          (docs/dev/contracts-ui.md §1; dispatch on spec.trackId)
 *   'rel.steps'         one large number at a time + one MATCH pad. ctx.assist.steps (tutorial only): under the
 *                       number, the last few numbers with the step under each (step = |x − the number b back|);
 *                       the number the new one is compared with is dashed, the last step is bold.
 *   'rel.grid.T1'…'T8'  rule line (spec.meta.rule.text) above a 3×3 grid (4×4 in T7) of 3-symbol strings; the order
 *                       key for Ascending when spec.meta.rule.orderKey is set (icons, bars, glyphs, lab, colours);
 *                       NO (F, left) and MATCH (J) pads. No countdown. ctx.assist.highlight (tutorial only) dims the
 *                       two irrelevant symbols of every string (spec.meta.relevantPos stays full strength, underlined).
 *                       Variants: digits, letters (text) · icons (HF.sets shapes) · dots (canonical 3×3 layouts) ·
 *                       bars (22.5° × index clockwise from vertical) · glyphs (HF.sets.glyphPath) · lab (a frame with
 *                       one dot in a grid8 cell) · colors (opt-in: Okabe–Ito swatch + a pattern per colour).
 *                       T6 cells { shape, fill }: the shape's outline filled with a pattern (solid, empty, hlines,
 *                       vlines, dots, checks); glyph families: the glyph on a patterned tile.
 *   'rel.stream'        the same grid, persistent (the rule line above, one MATCH pad). Each cell has two prepared
 *                       layers: prepare(trial) writes the cells that differ from what is shown into the hidden layer,
 *                       show(trial) swaps only those layers. prepare(trial 0) also reveals the first grid, so it stays
 *                       up during the runner's lead-in: pass view.runOpts (leadMs = meta.initialMs − soaMs, ≥ 500) to
 *                       HF.timing.runStream and the first view lasts meta.initialMs.
 *   view = { kind: 'stream'|'discrete', type: 'steps'|'grid'|'stream', trackId, spec, el, pads,
 *            runOpts: { keys, leadMs? }, prepare(trial), show(trial), hide(trial), feedback(outcome, key?),
 *            mark(cells|null) (grid/stream: frame cells, e.g. the target line in a lesson; not during runs),
 *            reset(spec) (new spec in the same view, e.g. a stream restarted with a fresh seed), destroy() }
 *   prepare() builds markup from cached strings into hidden elements (in a timer, during the blank); show() and
 *   hide() only toggle classes that change visibility, never layout, and read nothing.
 *   feedback(outcome 'good'|'bad', key?) sets data-fb on the pad (key, else the last pad pressed, else MATCH) for
 *   300 ms, at most 3 per second. Keyboard presses also press the pad visually (.is-down, 120 ms).
 *
 * HF.views.relations.renderGrid(el, spec, trial, { highlight, mark }) → element   static grid for lessons/examples
 * HF.views.relations.symbolHTML(spec, value) → markup of one symbol (order keys, examples)
 *
 * HF.views.kit — small helpers shared with js/tasks/span/view.js and js/tasks/vsearch/view.js (this file loads first):
 *   el(tag, cls, attrs, text), esc(s), uid(prefix), perfNow(), keyLabel(ctx, key),
 *   pads(ctx, [{ id: 'no'|'match'|'match2', label, kind?, icon? }], groupLabel) → { el, pads: [button], byKey },
 *   feedback(byKey, fallbackKey) → fn(outcome, key?) with fn.cancel(),
 *   pressEcho(byKey) → off()   (keyboard presses show .is-down on the matching pad for 120 ms)
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var views = HF.views || (HF.views = {});
  var doc = root.document;

  // ================================================================ shared kit
  var kit = views.kit || (views.kit = (function () {
    var seq = 0;
    var DEF_KEYS = { match: 'J', no: 'F', match2: 'K' };
    function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
    function uid(p) { seq++; return (p || 'hfv') + seq; }
    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
      });
    }
    function el(tag, cls, attrs, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (attrs) {
        for (var k in attrs) {
          if (!attrs.hasOwnProperty(k)) continue;
          var v = attrs[k];
          if (v === null || v === undefined || v === false) continue;
          e.setAttribute(k, v === true ? '' : String(v));
        }
      }
      if (text !== undefined && text !== null) e.textContent = String(text);
      return e;
    }
    function keyLabel(ctx, key) {
      var k = ctx && ctx.keys;
      if (k && typeof k === 'object' && k[key]) return String(k[key]);
      if (HF.input && typeof HF.input.labelFor === 'function') {
        var l = HF.input.labelFor(key);
        if (l) return l;
      }
      return DEF_KEYS[key] || '';
    }
    function fallbackPads(o) {
      var wrap = el('div', 'hf-pads hf-pads--' + o.pads.length + (o.mirror ? ' hf-pads--mirror' : ''),
        { role: 'group', 'aria-label': o.label });
      for (var i = 0; i < o.pads.length; i++) {
        var p = o.pads[i];
        var kind = p.kind || (p.id === 'no' ? 'no' : (p.id === 'match2' ? 'alt' : 'yes'));
        var b = el('button', 'hf-pad hf-pad--' + kind, { type: 'button', 'data-key': p.id, 'aria-keyshortcuts': p.key || null });
        b.appendChild(el('span', 'hf-pad__label', null, p.label));
        if (p.key) {
          var kk = el('span', 'hf-pad__key', { 'aria-hidden': 'true' });
          kk.appendChild(el('kbd', 'hf-kbd', null, p.key));
          b.appendChild(kk);
        }
        wrap.appendChild(b);
      }
      return wrap;
    }
    function pads(ctx, list, groupLabel) {
      ctx = ctx || {};
      var o = { label: groupLabel || 'Answer buttons', mirror: ctx.hand === 'left', pads: [] };
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        o.pads.push({ id: p.id, label: p.label, key: keyLabel(ctx, p.id), kind: p.kind, icon: p.icon });
      }
      var wrap = (HF.ui && HF.ui.c && typeof HF.ui.c.pads === 'function') ? HF.ui.c.pads(o) : fallbackPads(o);
      var arr = Array.prototype.slice.call(wrap.querySelectorAll('[data-key]')), by = {};
      for (var j = 0; j < arr.length; j++) by[arr[j].getAttribute('data-key')] = arr[j];
      return { el: wrap, pads: arr, byKey: by };
    }
    function feedback(byKey, fallbackKey) {
      var last = -1e9, timer = 0, cur = null, lastKey = null;
      function clear() { if (cur) cur.removeAttribute('data-fb'); cur = null; }
      var fn = function (outcome, key) {
        if (outcome !== 'good' && outcome !== 'bad') return false;
        var now = perfNow();
        if (now - last < 340) return false;                       // never more than 3 flashes per second
        var pad = byKey[key] || byKey[lastKey] || byKey[fallbackKey];
        if (!pad) return false;
        clear();
        pad.setAttribute('data-fb', outcome);
        cur = pad;
        last = now;
        clearTimeout(timer);
        timer = setTimeout(clear, 300);
        return true;
      };
      fn.pressed = function (key) { if (byKey[key]) lastKey = key; };
      fn.cancel = function () { clearTimeout(timer); clear(); };
      return fn;
    }
    function pressEcho(byKey, onKey) {
      if (!HF.input || typeof HF.input.on !== 'function') return function () {};
      var timers = [];
      var off = HF.input.on(function (ev) {
        var pad = byKey[ev.key];
        if (!pad) return;
        if (onKey) onKey(ev.key);
        if (ev.src !== 'key') return;                               // pointer presses: HF.input sets .is-down itself
        pad.classList.add('is-down');
        timers.push(setTimeout(function () { pad.classList.remove('is-down'); }, 120));
      });
      return function () { off(); for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; };
    }
    return { el: el, esc: esc, uid: uid, perfNow: perfNow, keyLabel: keyLabel, pads: pads, feedback: feedback,
      pressEcho: pressEcho, DEF_KEYS: DEF_KEYS };
  })());

  var el = kit.el, esc = kit.esc;

  // ================================================================ symbols
  var COLORS = ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'];
  var COLOR_NAMES = ['black', 'orange', 'sky blue', 'bluish green', 'yellow', 'blue', 'vermillion', 'reddish purple'];
  // dots: canonical layouts on a 3×3 lattice (cells 0–8 row-major), one per numerosity
  var DOTS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    7: [0, 2, 3, 4, 5, 6, 8], 8: [0, 1, 2, 3, 5, 6, 7, 8], 9: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  // grid8 cells (0 TL, 1 T, 2 TR, 3 R, 4 BR, 5 B, 6 BL, 7 L) → [column, row]
  var GRID8 = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  var FILLS = ['solid', 'empty', 'hlines', 'vlines', 'dots', 'checks'];

  function svgOpen() { return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">'; }

  function shapePathAt(index) {
    var set = HF.sets && HF.sets.get ? HF.sets.get('shapes') : null;
    var item = set && set.items[index];
    var id = item ? item.shape : 'circle';
    return (HF.sets && HF.sets.shapePath && HF.sets.shapePath(id)) || 'M14 50A36 36 0 1 0 86 50A36 36 0 1 0 14 50Z';
  }
  function glyphMarkup(setId, index, extraCls) {
    var d = HF.sets && HF.sets.glyphPath ? HF.sets.glyphPath(setId, index) : null;
    var st = (HF.sets && HF.sets.glyphStyle && HF.sets.glyphStyle(setId)) || { strokeWidth: 7, fill: false };
    if (!d) return '';
    if (st.fill) return '<path d="' + d + '" fill="currentColor"' + (extraCls ? ' class="' + extraCls + '"' : '') + '/>';
    return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + st.strokeWidth +
      '" stroke-linecap="round" stroke-linejoin="round"' + (extraCls ? ' class="' + extraCls + '"' : '') + '/>';
  }

  /** Renderer for one spec's content variant: sym(value, pos) → wrapped markup (cached), two(cell) for T6. */
  function renderer(spec, ids) {
    var m = spec.meta || {}, p = spec.params || {};
    var variant = m.variant || p.variant || 'digits';
    var setId = m.setId || spec.set || null;
    var tier = m.tier || null;
    var two = tier === 'T6' || !!(m.rule && m.rule.base === 'two-feature');
    var text = variant === 'digits' || variant === 'letters';
    var cache = {};

    function inner(v) {
      var i = Number(v), s, k;
      switch (variant) {
        case 'icons':
          return svgOpen() + '<path d="' + shapePathAt(i) + '" fill="currentColor"/></svg>';
        case 'dots':
          s = svgOpen();
          var lay = DOTS[i] || DOTS[1];
          for (k = 0; k < lay.length; k++) {
            s += '<circle cx="' + (20 + (lay[k] % 3) * 30) + '" cy="' + (20 + Math.floor(lay[k] / 3) * 30) + '" r="11" fill="currentColor"/>';
          }
          return s + '</svg>';
        case 'bars':
          return svgOpen() + '<line x1="50" y1="9" x2="50" y2="91" stroke="currentColor" stroke-width="15" stroke-linecap="round" transform="rotate(' +
            (22.5 * i) + ' 50 50)"/></svg>';
        case 'glyphs':
          return svgOpen() + glyphMarkup(setId, i) + '</svg>';
        case 'lab':
          var at = GRID8[i] || GRID8[0];
          return svgOpen() + '<rect x="6" y="6" width="88" height="88" rx="12" fill="none" stroke="currentColor" stroke-width="7"/>' +
            '<circle cx="' + (25 + at[0] * 25) + '" cy="' + (25 + at[1] * 25) + '" r="11.5" fill="currentColor"/></svg>';
        case 'colors':
          return '';
        default:
          return esc(v);
      }
    }
    function sym(v, pos) {
      var key = v + '|' + pos;
      if (cache[key]) return cache[key];
      var out;
      if (text) out = '<span class="hf-sym hf-sym--t" data-p="' + pos + '">' + esc(v) + '</span>';
      else if (variant === 'colors') {
        var c = Number(v) & 7;
        out = '<span class="hf-sym hf-sym--c hf-col-' + c + '" data-p="' + pos + '" style="--hf-col:' + COLORS[c] + '"></span>';
      } else out = '<span class="hf-sym hf-sym--g" data-p="' + pos + '">' + inner(v) + '</span>';
      cache[key] = out;
      return out;
    }
    function twoSym(cell) {
      var key = 'two|' + cell.shape + '|' + cell.fill;
      if (cache[key]) return cache[key];
      var fill = FILLS.indexOf(cell.fill) >= 0 ? cell.fill : 'solid';
      var paint = fill === 'solid' ? 'currentColor' : (fill === 'empty' ? 'none' : 'url(#' + ids.pat + fill + ')');
      var s = svgOpen();
      if (variant === 'glyphs' && setId) {
        // glyph family: the fill is a patterned tile behind the glyph; the glyph keeps a halo for contrast
        s += '<rect x="4" y="4" width="92" height="92" rx="18" fill="' + paint + '" fill-opacity="0.55" stroke="currentColor" stroke-width="3.5"/>';
        var halo = glyphMarkup(setId, cell.shape, 'hf-halo');
        s += halo + glyphMarkup(setId, cell.shape);
      } else {
        s += '<path d="' + shapePathAt(cell.shape) + '" fill="' + paint + '" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>';
      }
      s += '</svg>';
      cache[key] = '<span class="hf-sym hf-sym--g hf-sym--two" data-fill="' + fill + '">' + s + '</span>';
      return cache[key];
    }
    function cellHTML(cell) {
      if (two) return '<span class="hf-rg__one">' + twoSym(cell || {}) + '</span>';
      var out = '<span class="hf-rg__str">';
      if (text) { var str = String(cell == null ? '' : cell); for (var q = 0; q < str.length; q++) out += sym(str.charAt(q), q); }
      else if (cell && cell.length) { for (var r = 0; r < cell.length; r++) out += sym(cell[r], r); }
      return out + '</span>';
    }
    function keyOf(cell) {
      if (cell == null) return '';
      if (typeof cell === 'string') return cell;
      if (cell.length !== undefined) return Array.prototype.join.call(cell, ',');
      return cell.shape + '/' + cell.fill;
    }
    return { variant: variant, setId: setId, text: text, two: two, relPos: m.relevantPos, sym: sym, twoSym: twoSym,
      cellHTML: cellHTML, keyOf: keyOf, colorName: function (i) { return COLOR_NAMES[i & 7]; } };
  }

  function patternDefs(prefix) {
    var svg = '<svg class="hf-v__defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
      '<pattern id="' + prefix + 'hlines" patternUnits="userSpaceOnUse" width="12" height="12"><rect width="12" height="5" fill="currentColor"/></pattern>' +
      '<pattern id="' + prefix + 'vlines" patternUnits="userSpaceOnUse" width="12" height="12"><rect width="5" height="12" fill="currentColor"/></pattern>' +
      '<pattern id="' + prefix + 'dots" patternUnits="userSpaceOnUse" width="14" height="14"><circle cx="7" cy="7" r="3.4" fill="currentColor"/></pattern>' +
      '<pattern id="' + prefix + 'checks" patternUnits="userSpaceOnUse" width="20" height="20"><rect width="10" height="10" fill="currentColor"/><rect x="10" y="10" width="10" height="10" fill="currentColor"/></pattern>' +
      '</defs></svg>';
    var holder = el('div');
    holder.innerHTML = svg;
    return holder.firstChild;
  }

  // ================================================================ grid surface
  function surface(n, layers) {
    var g = el('div', 'hf-rg hf-rg--' + n + ' is-off'), cells = [], ins = [];
    for (var c = 0; c < n * n; c++) {
      var cell = el('div', 'hf-rg__cell', { 'data-c': c });
      var a = el('span', 'hf-rg__in');
      cell.appendChild(a);
      var row = [a];
      if (layers === 2) { var b = el('span', 'hf-rg__in is-hid'); cell.appendChild(b); row.push(b); }
      g.appendChild(cell);
      cells.push(cell);
      ins.push(row);
    }
    return { el: g, cells: cells, ins: ins, n: n };
  }

  function ruleText(spec) {
    var t = spec.meta && spec.meta.rule && spec.meta.rule.text;
    if (!t) return '';
    // the pads say "Match" and "No"; sentence case on screen (design rule: no all-caps)
    return esc(String(t)).replace(/\bMATCH\b/g, 'Match').replace(/\bAND\b/g, '<strong>and</strong>');
  }

  function headFor(spec, R, opts) {
    var head = el('div', 'hf-v__head');
    var rt = ruleText(spec);
    if (rt) { var p = el('p', 'hf-v__rule'); p.innerHTML = rt; head.appendChild(p); }
    var key = spec.meta && spec.meta.rule && spec.meta.rule.orderKey;
    if (key && key.length && !(opts && opts.noKey)) {
      var box = el('div', 'hf-v__key', { role: 'group', 'aria-label': 'Order key, lowest first' });
      box.appendChild(el('span', 'hf-v__keylabel', null, 'Order (1 = lowest)'));
      var ol = '<ol class="hf-v__keylist">';
      for (var i = 0; i < key.length; i++) {
        var name = R.variant === 'colors' ? R.colorName(key[i]) : String(i + 1);
        ol += '<li aria-label="' + esc(name) + '">' + R.sym(key[i], 'k').replace(' data-p="k"', '') +
          '<span class="hf-v__rank" aria-hidden="true">' + (i + 1) + '</span></li>';
      }
      ol += '</ol>';
      var holder = el('div', 'hf-v__keybox');
      holder.innerHTML = ol;
      box.appendChild(holder.firstChild);
      head.appendChild(box);
    }
    return head;
  }

  // ================================================================ base view
  function trackType(spec) {
    var id = String(spec && spec.trackId || '');
    if (id === 'rel.steps') return 'steps';
    if (id === 'rel.stream') return 'stream';
    if (/^rel\.grid\.T[1-8]$/.test(id)) return 'grid';
    // tolerate specs without a trackId (hand-built lesson examples)
    var t0 = spec && spec.trials && spec.trials[0];
    if (spec && spec.kind === 'discrete') return 'grid';
    if (t0 && t0.stim && t0.stim.main && t0.stim.main.grid) return 'stream';
    return 'steps';
  }

  function base(root, spec, ctx, type, label) {
    ctx = ctx || {};
    var v = {
      type: type, kind: type === 'grid' ? 'discrete' : 'stream', trackId: spec.trackId, spec: spec, ctx: ctx,
      root: root, pads: [], runOpts: { keys: type === 'grid' ? ['match', 'no'] : ['match'] }
    };
    v.ids = { pat: kit.uid('hfv') + '-' };
    v.el = el('div', 'hf-task hf-v hf-v--' + type, { role: 'group', 'aria-label': label });
    v.el.appendChild(patternDefs(v.ids.pat));
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(v.el);
    return v;
  }

  function attachPads(v, list, groupLabel) {
    var P = kit.pads(v.ctx, list, groupLabel);
    var box = el('div', 'hf-v__pads');
    box.appendChild(P.el);
    v.el.appendChild(box);
    v.pads = P.pads;
    v.byKey = P.byKey;
    var fb = kit.feedback(P.byKey, 'match');
    v._fb = fb;
    v._echoOff = kit.pressEcho(P.byKey, fb.pressed);
    v.feedback = function (outcome, key) { return fb(outcome, key); };
  }

  function destroyBase(v) {
    if (v._fb) v._fb.cancel();
    if (v._echoOff) v._echoOff();
    v._echoOff = null;
    if (v.el && v.el.parentNode) v.el.parentNode.removeChild(v.el);
    v.pads = [];
  }

  function markCells(surf, cells) {
    for (var c = 0; c < surf.cells.length; c++) surf.cells[c].classList.remove('is-mark');
    if (!cells) return;
    for (var i = 0; i < cells.length; i++) if (surf.cells[cells[i]]) surf.cells[cells[i]].classList.add('is-mark');
  }

  // ================================================================ Relation Grid (discrete)
  function gridView(root, spec, ctx) {
    var v = base(root, spec, ctx, 'grid', 'Relation Grid');
    var R, surf, stage;
    function build(sp) {
      v.spec = sp;
      v.trackId = sp.trackId;
      R = renderer(sp, v.ids);
      var n = (sp.meta && sp.meta.size) || (sp.trials && sp.trials[0] && sp.trials[0].stim && sp.trials[0].stim.size) || 3;
      if (v.head) v.el.removeChild(v.head);
      if (stage) v.el.removeChild(stage);
      v.head = headFor(sp, R);
      stage = el('div', 'hf-v__stage', { 'aria-hidden': 'true' });
      surf = surface(n, 1);
      if (R.two) surf.el.classList.add('hf-rg--two');
      if (v.ctx.assist && v.ctx.assist.highlight && !R.two && R.relPos != null) {
        surf.el.classList.add('hf-rg--hl');
        surf.el.setAttribute('data-rel', R.relPos);
      }
      surf.el.setAttribute('data-variant', R.variant);
      stage.appendChild(surf.el);
      var padsBox = v.el.querySelector('.hf-v__pads');
      v.el.insertBefore(v.head, padsBox);
      v.el.insertBefore(stage, padsBox);
      v.el.classList.toggle('has-key', !!(sp.meta && sp.meta.rule && sp.meta.rule.orderKey));
      v.surface = surf;
    }
    attachPads(v, [{ id: 'no', label: 'No' }, { id: 'match', label: 'Match' }], 'Answer: No or Match');
    build(spec);
    v.prepare = function (trial) {
      var cells = trial && trial.stim && trial.stim.cells;
      if (!cells) return;
      for (var c = 0; c < surf.ins.length; c++) surf.ins[c][0].innerHTML = R.cellHTML(cells[c]);
    };
    v.show = function () { surf.el.classList.remove('is-off'); };
    v.hide = function () { surf.el.classList.add('is-off'); };
    v.mark = function (cells) { markCells(surf, cells); };
    v.reset = function (sp) { build(sp); };
    v.destroy = function () { destroyBase(v); };
    return v;
  }

  // ================================================================ Relation Stream (persistent grid)
  function streamView(root, spec, ctx) {
    var v = base(root, spec, ctx, 'stream', 'Relation Stream');
    var R, surf, stage, vis, shownKey, nextKey, pending;
    function build(sp) {
      v.spec = sp;
      v.trackId = sp.trackId;
      R = renderer(sp, v.ids);
      if (v.head) v.el.removeChild(v.head);
      if (stage) v.el.removeChild(stage);
      v.head = headFor(sp, R);
      stage = el('div', 'hf-v__stage', { 'aria-hidden': 'true' });
      surf = surface(3, 2);
      surf.el.setAttribute('data-variant', R.variant);
      if (v.ctx.assist && v.ctx.assist.highlight && R.relPos != null) {
        surf.el.classList.add('hf-rg--hl');
        surf.el.setAttribute('data-rel', R.relPos);
      }
      stage.appendChild(surf.el);
      var padsBox = v.el.querySelector('.hf-v__pads');
      v.el.insertBefore(v.head, padsBox);
      v.el.insertBefore(stage, padsBox);
      vis = []; shownKey = []; nextKey = []; pending = [];
      for (var c = 0; c < 9; c++) { vis.push(0); shownKey.push(null); nextKey.push(null); }
      v.surface = surf;
      var soa = sp.soaMs || (sp.params && sp.params.changeMs) || 1000;
      var init = (sp.meta && sp.meta.initialMs) || 0;
      v.runOpts = { keys: ['match'], leadMs: Math.max(500, Math.round(init - soa)) };
    }
    attachPads(v, [{ id: 'match', label: 'Match' }], 'Answer: Match');
    build(spec);
    function swap() {
      for (var j = 0; j < pending.length; j++) {
        var c = pending[j], a = surf.ins[c][vis[c]], b = surf.ins[c][1 - vis[c]];
        a.classList.add('is-hid');
        b.classList.remove('is-hid');
        vis[c] = 1 - vis[c];
        shownKey[c] = nextKey[c];
      }
      pending = [];
    }
    v.prepare = function (trial) {
      var g = trial && trial.stim && trial.stim.main && trial.stim.main.grid;
      if (!g) return;
      pending = [];
      for (var c = 0; c < 9; c++) {
        var k = R.keyOf(g[c]);
        if (k === shownKey[c]) continue;
        surf.ins[c][1 - vis[c]].innerHTML = R.cellHTML(g[c]);
        nextKey[c] = k;
        pending.push(c);
      }
      if (trial.i === 0 && v.ctx.revealFirst !== false) {   // the first grid is up during the lead-in (see header)
        swap();
        surf.el.classList.remove('is-off');
      }
    };
    v.show = function () {
      swap();
      surf.el.classList.remove('is-off');
    };
    v.hide = function () { surf.el.classList.add('is-off'); };
    v.mark = function (cells) { markCells(surf, cells); };
    v.reset = function (sp) { build(sp); };
    v.destroy = function () { destroyBase(v); };
    return v;
  }

  // ================================================================ Equal Steps (number stream)
  function stepsView(root, spec, ctx) {
    var v = base(root, spec, ctx, 'steps', 'Equal Steps');
    var assist = !!(v.ctx.assist && v.ctx.assist.steps);
    var stage = el('div', 'hf-v__stage', { 'aria-hidden': 'true' });
    var wrap = el('div', 'hf-es');
    var num = el('div', 'hf-es__num');
    var nb = [el('span', 'hf-es__v is-hid'), el('span', 'hf-es__v is-hid')];
    num.appendChild(nb[0]);
    num.appendChild(nb[1]);
    wrap.appendChild(num);
    var tb = null;
    if (assist) {
      var tape = el('div', 'hf-es__tape');
      tb = [el('div', 'hf-es__tbuf'), el('div', 'hf-es__tbuf is-hid')];
      tape.appendChild(tb[0]);
      tape.appendChild(tb[1]);
      wrap.appendChild(tape);
    }
    stage.appendChild(wrap);
    v.el.appendChild(stage);
    attachPads(v, [{ id: 'match', label: 'Match' }], 'Answer: Match');
    var back = 1, hist = [], cur = 0, pend = -1;
    function setSpec(sp) {
      v.spec = sp;
      v.trackId = sp.trackId;
      back = (sp.params && sp.params.back) || (sp.meta && sp.meta.rule && sp.meta.rule.back) || 1;
      hist = [];
    }
    setSpec(spec);
    function tapeHTML(t) {
      var from = Math.max(0, t - (back + 2)), out = '<ol class="hf-es__list">';
      for (var j = from; j < t; j++) {
        if (hist[j] === undefined) continue;
        var step = j >= back && hist[j - back] !== undefined ? Math.abs(hist[j] - hist[j - back]) : null;
        var cls = 'hf-es__item' + (j === t - back ? ' is-partner' : '') + (j === t - 1 ? ' is-last' : '');
        out += '<li class="' + cls + '"><span class="hf-es__n">' + hist[j] + '</span><span class="hf-es__s">' +
          (step === null ? '&#8203;' : 'step ' + step) + '</span></li>';
      }
      return out + '</ol>';
    }
    v.prepare = function (trial) {
      var n = trial && trial.stim && trial.stim.main ? trial.stim.main.number : null;
      if (n === null || n === undefined) return;
      if (trial.i === 0) hist = [];
      hist[trial.i] = n;
      var k = 1 - cur;
      nb[k].textContent = String(n);
      if (tb) tb[k].innerHTML = tapeHTML(trial.i);
      pend = k;
    };
    v.show = function () {
      if (pend >= 0) {
        nb[cur].classList.add('is-hid');
        if (tb) { tb[cur].classList.add('is-hid'); tb[pend].classList.remove('is-hid'); }
        cur = pend;
        pend = -1;
      }
      nb[cur].classList.remove('is-hid');
    };
    v.hide = function () { nb[cur].classList.add('is-hid'); };
    v.mark = function () {};
    v.reset = function (sp) { setSpec(sp); };
    v.destroy = function () { destroyBase(v); };
    return v;
  }

  // ================================================================ module API
  function create(root, spec, ctx) {
    if (!root || !spec) throw new Error('HF.views.relations.create(root, spec, ctx): root and spec are required');
    var type = trackType(spec);
    if (type === 'grid') return gridView(root, spec, ctx);
    if (type === 'stream') return streamView(root, spec, ctx);
    return stepsView(root, spec, ctx);
  }

  /** Static grid for lessons and examples: el gets a grid (and its pattern defs) showing trial's cells. */
  function renderGrid(host, spec, trial, opts) {
    opts = opts || {};
    var ids = { pat: kit.uid('hfg') + '-' };
    var R = renderer(spec, ids);
    var cells = trial && trial.stim && (trial.stim.cells || (trial.stim.main && trial.stim.main.grid));
    var n = (spec.meta && spec.meta.size) || (cells && cells.length === 16 ? 4 : 3);
    var surf = surface(n, 1);
    surf.el.classList.remove('is-off');
    surf.el.classList.add('hf-rg--static');
    if (R.two) surf.el.classList.add('hf-rg--two');
    surf.el.setAttribute('data-variant', R.variant);
    if (opts.highlight && !R.two && R.relPos != null) { surf.el.classList.add('hf-rg--hl'); surf.el.setAttribute('data-rel', R.relPos); }
    if (cells) for (var c = 0; c < surf.ins.length; c++) surf.ins[c][0].innerHTML = R.cellHTML(cells[c]);
    if (opts.mark) markCells(surf, opts.mark);
    var box = el('div', 'hf-v hf-v--static');
    box.appendChild(patternDefs(ids.pat));
    box.appendChild(surf.el);
    if (host) host.appendChild(box);
    return box;
  }

  function symbolHTML(spec, value) { return renderer(spec, { pat: 'hfs-' }).sym(value, 'k').replace(' data-p="k"', ''); }

  views.relations = { create: create, renderGrid: renderGrid, symbolHTML: symbolHTML, _renderer: renderer };
})(typeof window !== 'undefined' ? window : globalThis);
