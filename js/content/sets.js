/* Long-Horizon — stimulus sets, incl. procedural glyph families (pure, no DOM). MIT licence.
 * Owner: n-back agent. Needs HF.rng (js/core/rng.js) loaded first (glyph families make seeded choices).
 *
 * ── API (HF.sets) ──────────────────────────────────────────────────────────────────────────────
 *   get(setId) → Set | null      null for an unknown id, and for 'lettersAudio' when no clips are loaded
 *     Set = { id, kind, items, cyclic, order, label, contentFamily, noun, nouns, names }
 *       kind          'visual' | 'audio' | 'expr' | 'number'
 *       items         [Item], fixed order (the item's index is its position here)
 *       cyclic        true for days, months, clock, compass, ring8
 *       order         cyclic sets: the items in cyclic order (same objects as items); [] otherwise
 *       label         set name for menus, e.g. 'Days of the week'
 *       contentFamily 'spatial' | 'verbal' | 'numeric' | 'symbolic' | 'audio' (learner model)
 *       noun, nouns   'day', 'days' — used by explanations ("the same day as two back")
 *       names         one display name per item ('Tue', 'top left', 'tone 3'); null = no name (glyphs)
 *   ids                          every set id this module defines (lettersAudio included)
 *   list()                       ids available right now
 *   available(setId) → bool      false for unknown ids, and for lettersAudio without window.HF_AUDIO_CLIPS
 *   forTrack(trackId) → [setId]  sets a track may use (available ones only; [] for tracks without sets)
 *   defaultFor(trackId) → setId | null
 *   key(item) → string           identity of an item ('cell:3', 'text:Tue', 'glyph:glyphsC:3', ...)
 *   indexOf(setOrId, item) → int (−1 if absent)
 *   name(item) → string | null   display name for texts (labels of cells, tones, expressions, ...)
 *   step(setOrId, item, k) → Item       cyclic sets: the item k places on (k < 0 = back), wrapping
 *   rulePhrase(setOrId, k) → string     'the day after' | 'two days after' | 'the day before' |
 *                                       'one point clockwise' | ... (for rule cards and explanations)
 *   relPhrase(setOrId, k) → string      the same, ready to put before an item: '… clockwise from'
 *   cellRC(cell) → [row, col]           grid8 / ring8 cell → row and column of the 3×3 grid
 *   prepare(setId) → bool               builds a glyph family now (5–60 ms the first time; cached after),
 *                                       so nothing heavy happens during a stream. gen() calls it.
 *   glyphPath(setId, index) → string    SVG path data, viewBox 0 0 100 100
 *   glyphStyle(setId) → { strokeWidth, fill }   paint: fill ? fill=currentColor, no stroke
 *                                       : fill=none, stroke=currentColor, round caps and joins
 *   glyphSvg(setId, index, sizePx?) → '<svg …>' markup (convenience for views)
 *   shapePath(shapeId) → string         filled path, viewBox 0 0 100 100; shapeSvg(shapeId, sizePx?)
 *   parseExpr(text) → { a, op: '+'|'−', b, value } | null
 *   families                            glyph family info { setId: { label, group, style } }
 *   glyphInfo(setId) → { prims: [[primIndex…] ×8], canon: [string ×8], ink: [number ×8] } (tests)
 *
 * ── Item formats ───────────────────────────────────────────────────────────────────────────────
 *   grid8, ring8   { cell: 0..7 }  outer cells of a 3×3 grid, clockwise from top-left
 *                  (0 TL, 1 T, 2 TR, 3 R, 4 BR, 5 B, 6 BL, 7 L; the centre is never used)
 *   letters        { text: 'C' }   C H K L Q R S T (shown)
 *   digits         { text: '1' }   1–9
 *   days           { text: 'Mon' } Mon…Sun, cyclic (Sun → Mon)
 *   months         { text: 'Jan' } Jan…Dec, cyclic
 *   clock          { text: '1' }   1–12, cyclic (12 → 1)
 *   compass        { text: 'N' }   N NE E SE S SW W NW, cyclic, clockwise
 *   shapes         { shape: 'tri' } circle square tri star cross ring heart moon (filled, nonzero rule; see shapePath)
 *   tones          { tone: 0..7 }  8 synthesized pitches, low → high (HF.audio.tone)
 *   lettersAudio   { clip: 'C' }   spoken letters; only when window.HF_AUDIO_CLIPS holds ≥ 6 (flat map from the core)
 *   glyphsA…H, glyphsLab  { glyph: 'glyphsC', index: 0..7 }
 *   arith          { expr: '3 + 4', value: 7 }  all 72 sums/differences with operands 1–9 and value 1–9
 *                  (8 per value); the minus sign is U+2212
 *   numbers        { number: 1..39 } (Equal Steps)
 *
 * ── Glyph families ─────────────────────────────────────────────────────────────────────────────
 *   Nine families × 8 glyphs, built on first use from a lattice vocabulary, deterministically (the
 *   only randomness is HF.rng seeded with the family id). Each family enumerates every valid glyph,
 *   keeps one per class under its symmetry group (canonical form = smallest sorted list of
 *   primitive indices over the group), keeps the classes whose ink length is near the median
 *   (similar complexity), then picks 8 by greedy max–min distance (distance = fewest primitives
 *   to change, over the group), and draws each in a seeded orientation.
 *     A Runes          4 straight unit strokes on a 3×3 square lattice (orthogonal + diagonal)   D4
 *     B Arcs           4 quarter-circle arcs, one per cell of a 3×3-cell grid, spanning all 3×3 D4
 *     C Triangles      4 unit strokes on a triangular (60°) lattice inside a hexagon              D6
 *     D Dials          centre dot + 4 elements: spokes and 45° ring arcs                          D8
 *     E Constellations 4 dots joined by a 3-segment path (unit, diagonal and knight steps)       D4
 *     F Blocks         the 8 free pentominoes that fit a 3×3 box (filled)                        D4+T
 *     G Curls          smooth curve through 5 lattice points, dot at the start                    D4
 *     H Brackets       3 corner brackets in 3 of the 4 quadrants                                  D4
 *     Lab Combs        a spine with 3 ticks (one crosses the spine)                               D2*
 *   *Combs are all horizontal, so a 90° turn of one can never equal another.
 *   E and G also reject pairs whose point sequences are similar (equal distance ratios), which
 *   covers similarities outside the lattice group. tests/unit/sets-glyphs.test.mjs re-checks every
 *   family independently from the path strings (any rotation, mirror, scale; pixels at 64 px).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var MINUS = '−';
  var NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

  // ───────────────────────────── static sets ─────────────────────────────
  var GRID_NAMES = ['top left', 'top middle', 'top right', 'middle right', 'bottom right', 'bottom middle', 'bottom left', 'middle left'];
  var GRID_RC = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]];
  var LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var SHAPES = ['circle', 'square', 'tri', 'star', 'cross', 'ring', 'heart', 'moon'];
  var SHAPE_NAMES = { circle: 'circle', square: 'square', tri: 'triangle', star: 'star', cross: 'cross', ring: 'ring', heart: 'heart', moon: 'crescent' };
  var GLYPH_IDS = ['glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH', 'glyphsLab'];

  function range(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }

  function mk(id, kind, items, o) {
    var s = {
      id: id, kind: kind, items: items, cyclic: !!o.cyclic, order: o.cyclic ? items.slice() : [],
      label: o.label, contentFamily: o.family, noun: o.noun, nouns: o.nouns || o.noun + 's',
      names: o.names || items.map(function () { return null; })
    };
    if (o.clockwise) s.clockwise = true;
    return s;
  }

  function buildArith() {
    var items = [];
    for (var v = 1; v <= 9; v++) {
      var a, b;
      for (a = 1; a <= 9; a++) { b = v - a; if (b >= 1 && b <= 9) items.push({ expr: a + ' + ' + b, value: v }); }
      for (a = 1; a <= 9; a++) { b = a - v; if (b >= 1 && b <= 9) items.push({ expr: a + ' ' + MINUS + ' ' + b, value: v }); }
    }
    return items;
  }

  var STATIC = {};
  function def(s) { STATIC[s.id] = s; }
  def(mk('grid8', 'visual', range(8, function (i) { return { cell: i }; }),
    { label: 'Grid positions', family: 'spatial', noun: 'position', names: GRID_NAMES.slice() }));
  def(mk('ring8', 'visual', range(8, function (i) { return { cell: i }; }),
    { label: 'Grid ring (clockwise)', family: 'spatial', noun: 'square', names: GRID_NAMES.slice(), cyclic: true, clockwise: true }));
  def(mk('letters', 'visual', LETTERS.map(function (c) { return { text: c }; }),
    { label: 'Letters', family: 'verbal', noun: 'letter', names: LETTERS.slice() }));
  def(mk('digits', 'visual', range(9, function (i) { return { text: String(i + 1) }; }),
    { label: 'Digits', family: 'numeric', noun: 'digit', names: range(9, function (i) { return String(i + 1); }) }));
  def(mk('days', 'visual', DAYS.map(function (d) { return { text: d }; }),
    { label: 'Days of the week', family: 'verbal', noun: 'day', names: DAYS.slice(), cyclic: true }));
  def(mk('months', 'visual', MONTHS.map(function (d) { return { text: d }; }),
    { label: 'Months', family: 'verbal', noun: 'month', names: MONTHS.slice(), cyclic: true }));
  def(mk('clock', 'visual', range(12, function (i) { return { text: String(i + 1) }; }),
    { label: 'Clock hours', family: 'numeric', noun: 'hour', names: range(12, function (i) { return String(i + 1); }), cyclic: true }));
  def(mk('compass', 'visual', COMPASS.map(function (d) { return { text: d }; }),
    { label: 'Compass points', family: 'spatial', noun: 'point', names: COMPASS.slice(), cyclic: true, clockwise: true }));
  def(mk('shapes', 'visual', SHAPES.map(function (s) { return { shape: s }; }),
    { label: 'Shapes', family: 'symbolic', noun: 'shape', names: SHAPES.map(function (s) { return SHAPE_NAMES[s]; }) }));
  def(mk('tones', 'audio', range(8, function (i) { return { tone: i }; }),
    { label: 'Tones', family: 'audio', noun: 'tone', names: range(8, function (i) { return 'tone ' + (i + 1); }) }));
  def(mk('arith', 'expr', buildArith(),
    { label: 'Sums and differences', family: 'numeric', noun: 'sum', names: null }));
  STATIC.arith.names = STATIC.arith.items.map(function (it) { return it.expr; });
  def(mk('numbers', 'number', range(39, function (i) { return { number: i + 1 }; }),
    { label: 'Numbers', family: 'numeric', noun: 'number', names: range(39, function (i) { return String(i + 1); }) }));

  var GLYPH_LABELS = { glyphsA: 'Runes', glyphsB: 'Arcs', glyphsC: 'Triangles', glyphsD: 'Dials', glyphsE: 'Constellations',
    glyphsF: 'Blocks', glyphsG: 'Curls', glyphsH: 'Brackets', glyphsLab: 'Combs (Lab only)' };
  GLYPH_IDS.forEach(function (id) {
    def(mk(id, 'visual', range(8, function (i) { return { glyph: id, index: i }; }),
      { label: 'Glyphs: ' + GLYPH_LABELS[id], family: 'symbolic', noun: 'symbol' }));
  });

  // ───────────────────────────── spoken letters (optional) ─────────────────────────────
  // Core format (assets/audio/letters.js): a flat map window.HF_AUDIO_CLIPS = { C: 'data:audio/mpeg;base64,…',
  // H: …, … }; HF.audio.clip(letter, when) plays one. Also accepted: { letters: { C: … }, order?: [...] } or
  // { ids: [...] }. Flat maps use their single-letter keys (sorted); ≥ 6 letters needed, up to 8 used.
  function clipIds() {
    var c = root.HF_AUDIO_CLIPS;
    if (!c || typeof c !== 'object') return [];
    var ids = [];
    if (Array.isArray(c.order)) ids = c.order.slice();
    else if (Array.isArray(c.ids)) ids = c.ids.slice();
    else if (c.letters && typeof c.letters === 'object') ids = Array.isArray(c.letters) ? c.letters.slice() : Object.keys(c.letters).sort();
    else ids = Object.keys(c).filter(function (k) { return /^[A-Z]$/.test(k); }).sort();
    ids = ids.filter(function (k) { return typeof k === 'string' && k.length > 0; });
    return ids.slice(0, 8);
  }
  var lettersAudioCache = { sig: null, set: null };
  function lettersAudio() {
    var ids = clipIds();
    if (ids.length < 6) return null; // too few distinct sounds for an n-back stream
    var sig = ids.join(',');
    if (lettersAudioCache.sig !== sig) {
      lettersAudioCache.sig = sig;
      lettersAudioCache.set = mk('lettersAudio', 'audio', ids.map(function (k) { return { clip: k }; }),
        { label: 'Spoken letters', family: 'audio', noun: 'letter', names: ids.map(function (k) { return k.charAt(k.length - 1).toUpperCase(); }) });
    }
    return lettersAudioCache.set;
  }

  var IDS = ['grid8', 'ring8', 'letters', 'digits', 'days', 'months', 'clock', 'compass', 'shapes', 'tones', 'lettersAudio']
    .concat(GLYPH_IDS).concat(['arith', 'numbers']);

  function get(setId) {
    if (setId === 'lettersAudio') return lettersAudio();
    return STATIC.hasOwnProperty(setId) ? STATIC[setId] : null;
  }
  function available(setId) { return !!get(setId); }
  function list() { return IDS.filter(available); }
  function setOf(s) { return typeof s === 'string' ? get(s) : s; }

  var TRAINED_GLYPHS = GLYPH_IDS.slice(0, 8);
  var FOR_TRACK = {
    'nback.plain': ['grid8', 'letters', 'digits', 'shapes', 'days', 'months', 'clock', 'compass'].concat(TRAINED_GLYPHS).concat(['tones', 'lettersAudio']),
    'nback.dual': ['tones', 'lettersAudio'],
    'nback.transform': ['days', 'months', 'clock', 'compass', 'ring8'],
    'nback.arith': ['arith'],
    'nback.switch': ['digits', 'shapes'],
    'rel.steps': ['numbers'],
    'lab.nback': ['glyphsLab']
  };
  var DEFAULT_FOR = { 'nback.plain': 'grid8', 'nback.dual': 'tones', 'nback.transform': 'days', 'nback.arith': 'arith',
    'nback.switch': 'digits', 'rel.steps': 'numbers', 'lab.nback': 'glyphsLab' };
  function forTrack(trackId) { return (FOR_TRACK[trackId] || []).filter(available); }
  function defaultFor(trackId) { return DEFAULT_FOR.hasOwnProperty(trackId) ? DEFAULT_FOR[trackId] : null; }

  // ───────────────────────────── item helpers ─────────────────────────────
  function key(it) {
    if (!it || typeof it !== 'object') return String(it);
    if (it.what !== undefined || it.where !== undefined) return 'sw:' + key(it.what) + '@' + key(it.where);
    if (it.glyph !== undefined) return 'glyph:' + it.glyph + ':' + it.index;
    if (it.cell !== undefined) return 'cell:' + it.cell;
    if (it.shape !== undefined) return 'shape:' + it.shape;
    if (it.tone !== undefined) return 'tone:' + it.tone;
    if (it.clip !== undefined) return 'clip:' + it.clip;
    if (it.expr !== undefined) return 'expr:' + it.expr;
    if (it.number !== undefined) return 'number:' + it.number;
    if (it.text !== undefined) return 'text:' + it.text;
    return JSON.stringify(it);
  }
  function indexOf(s, it) {
    s = setOf(s); if (!s) return -1;
    if (!s._index) { // key → index, built once per set (hidden from JSON / enumeration)
      var map = {};
      for (var i = 0; i < s.items.length; i++) map[key(s.items[i])] = i;
      Object.defineProperty(s, '_index', { value: map, enumerable: false });
    }
    var j = s._index[key(it)];
    return j === undefined ? -1 : j;
  }
  function name(it) {
    if (!it || typeof it !== 'object') return null;
    if (it.cell !== undefined) return GRID_NAMES[it.cell] || null;
    if (it.text !== undefined) return it.text;
    if (it.shape !== undefined) return SHAPE_NAMES[it.shape] || it.shape;
    if (it.tone !== undefined) return 'tone ' + (it.tone + 1);
    if (it.clip !== undefined) return String(it.clip).charAt(String(it.clip).length - 1).toUpperCase();
    if (it.expr !== undefined) return it.expr;
    if (it.number !== undefined) return String(it.number);
    return null;
  }
  function step(s, it, k) {
    s = setOf(s);
    if (!s || !s.cyclic) throw new Error('sets.step: not a cyclic set');
    var n = s.order.length, i = indexOf(s, it);
    if (i < 0) throw new Error('sets.step: item not in set');
    return s.order[(((i + k) % n) + n) % n];
  }
  function count(k) { k = Math.abs(k); return NUM_WORDS[k] || String(k); }
  function rulePhrase(s, k) {
    s = setOf(s);
    var noun = s ? s.noun : 'item', nouns = s ? s.nouns : 'items';
    if (s && s.clockwise) return count(k) + ' ' + (Math.abs(k) === 1 ? noun : nouns) + ' ' + (k > 0 ? 'clockwise' : 'anticlockwise');
    if (k === 1) return 'the ' + noun + ' after';
    if (k === -1) return 'the ' + noun + ' before';
    return count(k) + ' ' + nouns + ' ' + (k > 0 ? 'after' : 'before');
  }
  function relPhrase(s, k) { s = setOf(s); return rulePhrase(s, k) + (s && s.clockwise ? ' from' : ''); }
  function cellRC(cell) { return GRID_RC[cell] ? GRID_RC[cell].slice() : null; }
  function parseExpr(text) {
    var m = /^\s*(\d+)\s*([+−-])\s*(\d+)\s*$/.exec(String(text));
    if (!m) return null;
    var a = +m[1], b = +m[3], op = m[2] === '+' ? '+' : MINUS;
    return { a: a, op: op, b: b, value: op === '+' ? a + b : a - b };
  }

  // ───────────────────────────── shapes (filled, 0 0 100 100) ─────────────────────────────
  function f2(x) { var r = Math.round(x * 100) / 100; if (r === 0) r = 0; return String(r); }
  function P(p) { return f2(p[0]) + ' ' + f2(p[1]); }
  function poly(pts) { return 'M' + pts.map(P).join('L') + 'Z'; }
  // exact trig tables (no Math.sin/cos → identical strings on every JS engine)
  var S3 = 0.8660254037844386, R2 = 0.7071067811865476;
  var COS30 = [0, 0.5, S3, 1, S3, 0.5, 0, -0.5, -S3, -1, -S3, -0.5]; // angle −90° + 30°k, k = 0..11
  var SIN30 = [-1, -S3, -0.5, 0, 0.5, S3, 1, S3, 0.5, 0, -0.5, -S3];
  var COS45 = [0, R2, 1, R2, 0, -R2, -1, -R2]; // angle −90° + 45°k
  var SIN45 = [-1, -R2, 0, R2, 1, R2, 0, -R2];
  var COS36 = [0, 0.5877852522924731, 0.9510565162951535, 0.9510565162951535, 0.5877852522924731, 0, -0.5877852522924731, -0.9510565162951535, -0.9510565162951535, -0.5877852522924731];
  var SIN36 = [-1, -0.8090169943749475, -0.30901699437494745, 0.30901699437494745, 0.8090169943749475, 1, 0.8090169943749475, 0.30901699437494745, -0.30901699437494745, -0.8090169943749475];
  function circlePath(cx, cy, r) {
    return 'M' + f2(cx - r) + ' ' + f2(cy) + 'A' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(cx + r) + ' ' + f2(cy) +
      'A' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(cx - r) + ' ' + f2(cy) + 'Z';
  }
  var SHAPE_PATHS = {
    circle: circlePath(50, 50, 36),
    square: poly([[18, 18], [82, 18], [82, 82], [18, 82]]),
    tri: poly([[50, 12], [92, 84], [8, 84]]),
    star: poly(range(10, function (k) { var r = k % 2 ? 18 : 42; return [50 + r * COS36[k], 54 + r * SIN36[k]]; })),
    cross: poly([[37, 12], [63, 12], [63, 37], [88, 37], [88, 63], [63, 63], [63, 88], [37, 88], [37, 63], [12, 63], [12, 37], [37, 37]]),
    // ring: the inner circle runs the other way, so the default nonzero fill leaves a hole
    ring: 'M12 50A38 38 0 1 0 88 50A38 38 0 1 0 12 50ZM31 50A19 19 0 1 1 69 50A19 19 0 1 1 31 50Z',
    heart: 'M50 88C28 72 10 58 10 38C10 22 22 12 34 12C42 12 47 16 50 23C53 16 58 12 66 12C78 12 90 22 90 38C90 58 72 72 50 88Z',
    // crescent: circle (44, 50) r 36 minus circle (60, 42) r 30; the two meet at (48.51, 14.29) and (75.27, 67.81)
    moon: 'M48.51 14.29A36 36 0 1 0 75.27 67.81A30 30 0 1 1 48.51 14.29Z'
  };
  function shapePath(id) { return SHAPE_PATHS[id] || null; }
  function svgWrap(d, style, size) {
    var sz = size ? ' width="' + size + '" height="' + size + '"' : '';
    var paint = style.fill ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="' + style.strokeWidth + '" stroke-linecap="round" stroke-linejoin="round"';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"' + sz + ' aria-hidden="true" focusable="false"><path d="' + d + '" ' + paint + '/></svg>';
  }
  function shapeSvg(id, size) { var d = shapePath(id); return d ? svgWrap(d, { fill: true }, size) : ''; }

  // ───────────────────────────── glyph families ─────────────────────────────
  // A primitive: { t: type, pts: [[x, y], ...] defining points, draw: () → path fragment, len: ink length,
  //   plus family-specific tags }. Symmetries act on coordinates about (50, 50); a primitive's identity is
  // its type + rounded defining points (endpoints unordered; arcs keep their centre apart).
  function rk(p) { return (Math.round(p[0] * 10) / 10) + ',' + (Math.round(p[1] * 10) / 10); }
  function primKey(t, pts) {
    var ks = pts.map(rk);
    if (t === 'arc') return 'arc:' + [ks[0], ks[1]].sort().join('|') + '@' + ks[2];
    return t + ':' + ks.sort().join('|');
  }
  // symmetry groups as coordinate maps about (50, 50); entries [a, b, c, d] → x' = a·dx + b·dy, y' = c·dx + d·dy
  function rotM(c, s) { return [c, -s, s, c]; }
  function refM(c2, s2) { return [c2, s2, s2, -c2]; } // reflection across the line at angle θ (c2 = cos 2θ, s2 = sin 2θ)
  var C60 = 0.5, S60 = S3;
  var GROUPS = {
    D2: [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1]],
    D4: [rotM(1, 0), rotM(0, 1), rotM(-1, 0), rotM(0, -1), refM(1, 0), refM(0, 1), refM(-1, 0), refM(0, -1)],
    D6: [rotM(1, 0), rotM(C60, S60), rotM(-C60, S60), rotM(-1, 0), rotM(-C60, -S60), rotM(C60, -S60),
      refM(1, 0), refM(C60, S60), refM(-C60, S60), refM(-1, 0), refM(-C60, -S60), refM(C60, -S60)],
    D8: [rotM(1, 0), rotM(R2, R2), rotM(0, 1), rotM(-R2, R2), rotM(-1, 0), rotM(-R2, -R2), rotM(0, -1), rotM(R2, -R2),
      refM(1, 0), refM(R2, R2), refM(0, 1), refM(-R2, R2), refM(-1, 0), refM(-R2, -R2), refM(0, -1), refM(R2, -R2)]
  };
  function apply(m, p) { var dx = p[0] - 50, dy = p[1] - 50; return [50 + m[0] * dx + m[1] * dy, 50 + m[2] * dx + m[3] * dy]; }

  function permsFor(prims, group) {
    if (prims.length > 64) throw new Error('glyph family: at most 64 primitives (canonical codes are base 64)');
    var idx = {};
    prims.forEach(function (p, i) { idx[primKey(p.t, p.pts)] = i; });
    return GROUPS[group].map(function (m) {
      return prims.map(function (p) {
        var k = primKey(p.t, p.pts.map(function (q) { return apply(m, q); }));
        if (!idx.hasOwnProperty(k)) throw new Error('glyph family not closed under its group: ' + k);
        return idx[k];
      });
    });
  }
  function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function canonOf(g, perms) { // smallest code of the sorted primitive indices over the group (numbers: no garbage)
    var best = Infinity, k = g.length, buf = [], s, i, j;
    for (s = 0; s < perms.length; s++) {
      for (i = 0; i < k; i++) { // insertion sort of the mapped indices
        var v = perms[s][g[i]];
        for (j = i; j > 0 && buf[j - 1] > v; j--) buf[j] = buf[j - 1];
        buf[j] = v;
      }
      var code = 0;
      for (i = 0; i < k; i++) code = code * 64 + buf[i];
      if (code < best) best = code;
    }
    return best;
  }
  function distance(a, b, perms) { // fewest primitives to change to turn b into a, over the group
    var best = Infinity, inA = {};
    a.forEach(function (i) { inA[i] = true; });
    for (var s = 0; s < perms.length; s++) {
      var shared = 0;
      for (var j = 0; j < b.length; j++) if (inA[perms[s][b[j]]]) shared++;
      var d = a.length + b.length - 2 * shared;
      if (d < best) best = d;
    }
    return best;
  }
  function subsets(n, k, cb) {
    var acc = [];
    (function rec(start) {
      if (acc.length === k) { cb(acc.slice()); return; }
      for (var i = start; i < n; i++) { acc.push(i); rec(i + 1); acc.pop(); }
    })(0);
  }
  var pointIds = {}, nextPointId = 0;
  function endIds(p, ends) { // integer ids of a primitive's joinable points (cached on the primitive)
    if (!p._e) {
      p._e = ends(p).map(function (q) {
        var k = rk(q);
        if (!pointIds.hasOwnProperty(k)) pointIds[k] = nextPointId++;
        return pointIds[k];
      });
    }
    return p._e;
  }
  function connected(g, prims, ends) { // primitives joined through shared points form one piece
    var n = g.length, parent = [], a, b, u;
    for (a = 0; a < n; a++) parent.push(a);
    function find(x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }
    var ids = [];
    for (a = 0; a < n; a++) ids.push(endIds(prims[g[a]], ends));
    for (a = 0; a < n; a++) for (b = a + 1; b < n; b++) {
      for (u = 0; u < ids[a].length; u++) if (ids[b].indexOf(ids[a][u]) >= 0) { parent[find(a)] = find(b); break; }
    }
    var r = find(0);
    for (a = 1; a < n; a++) if (find(a) !== r) return false;
    return true;
  }
  function segCross(p1, p2, p3, p4) { // proper crossing (not touching at endpoints)
    function o(a, b, c) { var v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return v > 1e-9 ? 1 : (v < -1e-9 ? -1 : 0); }
    return o(p3, p4, p1) * o(p3, p4, p2) < 0 && o(p1, p2, p3) * o(p1, p2, p4) < 0;
  }
  function hyp(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
  function lineFrag(a, b) { return 'M' + P(a) + 'L' + P(b); }
  function arcFrag(p, q, c, r) { // the short arc from p to q around centre c
    var cross = (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]);
    return 'M' + P(p) + 'A' + f2(r) + ' ' + f2(r) + ' 0 0 ' + (cross > 0 ? 1 : 0) + ' ' + P(q);
  }
  function linePrim(a, b, tags) {
    var p = { t: 'l', pts: [a, b], len: hyp(a, b) };
    for (var k in tags) if (tags.hasOwnProperty(k)) p[k] = tags[k];
    return p;
  }
  function rebuild(p, m) { // a primitive mapped by a group element (for drawing in a seeded orientation)
    var q = {}; for (var k in p) if (p.hasOwnProperty(k) && k !== '_e') q[k] = p[k];
    q.pts = p.pts.map(function (pt) { return apply(m, pt); });
    return q;
  }
  function drawPrim(p) {
    if (p.t === 'l') return lineFrag(p.pts[0], p.pts[1]);
    if (p.t === 'arc') return arcFrag(p.pts[0], p.pts[1], p.pts[2], p.r);
    if (p.t === 'm') return 'M' + P(p.pts[0]) + 'L' + P(p.pts[1]) + 'L' + P(p.pts[2]);
    if (p.t === 'dot') return circlePath(p.pts[0][0], p.pts[0][1], p.r);
    if (p.t === 'cell') return poly(p.pts);
    return '';
  }

  function catmull(s) { // uniform Catmull–Rom through points s (ends repeated) → [[p1, c1, c2, p2], ...]
    var out = [];
    for (var k = 0; k < s.length - 1; k++) {
      var p0 = s[Math.max(0, k - 1)], p1 = s[k], p2 = s[k + 1], p3 = s[Math.min(s.length - 1, k + 2)];
      out.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
    }
    return out;
  }
  var L3 = [20, 50, 80];
  function lat3(i, j) { return [L3[i], L3[j]]; }

  // Each builder returns { group, prims, glyphs: [[primIndex...]], ink(g), draw(g, m)?, similar(a, b)? }
  var BUILD = {
    glyphsA: function () { // Runes: 4 unit strokes on a 3×3 lattice, 1–3 diagonals, connected, full extent
      var prims = [], i, j;
      for (j = 0; j < 3; j++) for (i = 0; i < 2; i++) prims.push(linePrim(lat3(i, j), lat3(i + 1, j), { diag: 0 }));
      for (j = 0; j < 2; j++) for (i = 0; i < 3; i++) prims.push(linePrim(lat3(i, j), lat3(i, j + 1), { diag: 0 }));
      for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) {
        prims.push(linePrim(lat3(i, j), lat3(i + 1, j + 1), { diag: 1, cell: i + 2 * j }));
        prims.push(linePrim(lat3(i + 1, j), lat3(i, j + 1), { diag: 1, cell: i + 2 * j }));
      }
      var glyphs = [];
      subsets(prims.length, 4, function (g) {
        var cells = {}, nd = 0, x0 = 99, x1 = 0, y0 = 99, y1 = 0;
        for (var k = 0; k < g.length; k++) {
          var p = prims[g[k]];
          if (p.diag) { nd++; if (cells[p.cell]) return; cells[p.cell] = 1; }
          p.pts.forEach(function (q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
        }
        if (nd < 1 || nd > 3 || x0 !== 20 || x1 !== 80 || y0 !== 20 || y1 !== 80) return;
        if (!connected(g, prims, function (p) { return p.pts; })) return;
        glyphs.push(g);
      });
      return { group: 'D4', prims: prims, glyphs: glyphs };
    },
    glyphsB: function () { // Arcs: 4 quarter arcs (r 24), one per cell of a 3×3-cell grid, connected
      var G = [14, 38, 62, 86], prims = [], i, j;
      function q(a, b) { return [G[a], G[b]]; }
      for (j = 0; j < 3; j++) for (i = 0; i < 3; i++) {
        var a = q(i, j), b = q(i + 1, j), c = q(i + 1, j + 1), d = q(i, j + 1);
        [[a, c, b], [a, c, d], [b, d, a], [b, d, c]].forEach(function (t) {
          prims.push({ t: 'arc', pts: t, r: 24, len: Math.PI * 12, cell: i + 3 * j, ci: i, cj: j });
        });
      }
      var glyphs = [];
      subsets(9, 4, function (cells) {
        // the 4 cells must span all 3 columns and all 3 rows: then no glyph is a shifted copy of another
        var ci = cells.map(function (c) { return c % 3; }), cj = cells.map(function (c) { return Math.floor(c / 3); });
        var wi = Math.max.apply(null, ci) - Math.min.apply(null, ci), wj = Math.max.apply(null, cj) - Math.min.apply(null, cj);
        if (wi !== 2 || wj !== 2) return;
        for (var m = 0; m < 256; m++) {
          var g = cells.map(function (c, k) { return c * 4 + ((m >> (2 * k)) & 3); });
          if (connected(g, prims, function (p) { return [p.pts[0], p.pts[1]]; })) glyphs.push(g);
        }
      });
      return { group: 'D4', prims: prims, glyphs: glyphs };
    },
    glyphsC: function () { // Triangles: 4 unit strokes of a hexagon's triangular lattice, connected
      var R = 36, O = [50, 50], prims = [], k;
      function V(k) { return [50 + R * COS30[2 * k], 50 + R * SIN30[2 * k]]; }
      for (k = 0; k < 6; k++) prims.push(linePrim(O, V(k), {}));
      for (k = 0; k < 6; k++) prims.push(linePrim(V(k), V((k + 1) % 6), {}));
      var glyphs = [];
      subsets(prims.length, 4, function (g) { if (connected(g, prims, function (p) { return p.pts; })) glyphs.push(g); });
      return { group: 'D6', prims: prims, glyphs: glyphs };
    },
    glyphsD: function () { // Dials: centre dot + 4 elements (1–3 spokes, 1–3 ring arcs of 45°)
      var prims = [], k;
      function pol(r, k) { return [50 + r * COS45[k % 8], 50 + r * SIN45[k % 8]]; }
      for (k = 0; k < 8; k++) prims.push(linePrim(pol(13, k), pol(40, k), { spoke: 1 }));
      for (k = 0; k < 8; k++) prims.push({ t: 'arc', pts: [pol(40, k), pol(40, k + 1), [50, 50]], r: 40, len: Math.PI * 10, spoke: 0 });
      var glyphs = [];
      subsets(prims.length, 4, function (g) {
        var ns = g.filter(function (i) { return prims[i].spoke; }).length;
        if (ns >= 1 && ns <= 3) glyphs.push(g);
      });
      return { group: 'D8', prims: prims, glyphs: glyphs, extra: circlePath(50, 50, 4), extraPts: diskPts([50, 50], 6) };
    },
    glyphsE: function () { // Constellations: 4 dots on a 3×3 lattice joined by a simple 3-segment path
      var pts = [], prims = [], a, b;
      for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) pts.push([i, j]);
      function gcd(x, y) { return y ? gcd(y, x % y) : x; }
      for (a = 0; a < 9; a++) for (b = a + 1; b < 9; b++) {
        var di = Math.abs(pts[a][0] - pts[b][0]), dj = Math.abs(pts[a][1] - pts[b][1]);
        if (gcd(di, dj) !== 1) continue;
        prims.push(linePrim(lat3(pts[a][0], pts[a][1]), lat3(pts[b][0], pts[b][1]), { a: a, b: b }));
      }
      var glyphs = [], seqs = [];
      subsets(prims.length, 3, function (g) {
        var deg = {}, vs = [];
        g.forEach(function (i) { [prims[i].a, prims[i].b].forEach(function (v) { if (!deg[v]) { deg[v] = 0; vs.push(v); } deg[v]++; }); });
        if (vs.length !== 4) return;
        for (var v = 0; v < 4; v++) if (deg[vs[v]] > 2) return;
        if (!connected(g, prims, function (p) { return p.pts; })) return;
        for (var x = 0; x < 3; x++) for (var y = x + 1; y < 3; y++) if (segCross(prims[g[x]].pts[0], prims[g[x]].pts[1], prims[g[y]].pts[0], prims[g[y]].pts[1])) return;
        var ii = vs.map(function (v) { return pts[v][0]; }), jj = vs.map(function (v) { return pts[v][1]; });
        if (Math.min.apply(null, ii) !== 0 || Math.max.apply(null, ii) !== 2 || Math.min.apply(null, jj) !== 0 || Math.max.apply(null, jj) !== 2) return;
        // order the path's points from an end
        var end = vs.filter(function (v) { return deg[v] === 1; })[0], seq = [end], used = {};
        while (seq.length < 4) {
          for (var e = 0; e < 3; e++) {
            var pr = prims[g[e]], last = seq[seq.length - 1];
            if (used[e]) continue;
            if (pr.a === last) { seq.push(pr.b); used[e] = 1; break; }
            if (pr.b === last) { seq.push(pr.a); used[e] = 1; break; }
          }
        }
        glyphs.push(g); seqs.push(seq.map(function (v) { return lat3(pts[v][0], pts[v][1]); }));
      });
      return {
        group: 'D4', prims: prims, glyphs: glyphs, seqs: seqs, reversible: true,
        samples: function (gi, m) { // strokes + the four dots (the dots dominate how a constellation looks)
          var out = [];
          glyphs[gi].forEach(function (i) { primPts(prims[i]).forEach(function (q) { out.push(apply(m, q)); }); });
          seqs[gi].forEach(function (q) { diskPts(apply(m, q), 7).forEach(function (r) { out.push(r); }); });
          return out;
        },
        dots: function (g, m) { // dots on the four vertices
          var seen = {}, out = '';
          g.forEach(function (i) { prims[i].pts.forEach(function (p) { var q = apply(m, p), k2 = rk(q); if (!seen[k2]) { seen[k2] = 1; out += circlePath(q[0], q[1], 5); } }); });
          return out;
        }
      };
    },
    glyphsF: null, // pentominoes: special builder below
    glyphsG: function () { // Curls: smooth curve through 5 lattice points (king steps), dot at the start
      var pts = [], prims = [], edgeIdx = {}, a, b;
      for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) pts.push([i, j]);
      function adj(x, y) { return Math.max(Math.abs(pts[x][0] - pts[y][0]), Math.abs(pts[x][1] - pts[y][1])) === 1; }
      for (a = 0; a < 9; a++) for (b = a + 1; b < 9; b++) if (adj(a, b)) { edgeIdx[a + '-' + b] = prims.length; prims.push(linePrim(lat3(pts[a][0], pts[a][1]), lat3(pts[b][0], pts[b][1]), { a: a, b: b })); }
      var dot0 = prims.length;
      for (a = 0; a < 9; a++) prims.push({ t: 'dot', pts: [lat3(pts[a][0], pts[a][1])], r: 5, len: 0, v: a });
      var glyphs = [], seqs = [];
      function rec(seq) {
        if (seq.length === 5) {
          var ii = seq.map(function (v) { return pts[v][0]; }), jj = seq.map(function (v) { return pts[v][1]; });
          if (Math.min.apply(null, ii) !== 0 || Math.max.apply(null, ii) !== 2 || Math.min.apply(null, jj) !== 0 || Math.max.apply(null, jj) !== 2) return;
          for (var k = 1; k < 4; k++) {
            var u = [pts[seq[k]][0] - pts[seq[k - 1]][0], pts[seq[k]][1] - pts[seq[k - 1]][1]];
            var w = [pts[seq[k + 1]][0] - pts[seq[k]][0], pts[seq[k + 1]][1] - pts[seq[k]][1]];
            if ((u[0] * w[0] + u[1] * w[1]) / Math.sqrt((u[0] * u[0] + u[1] * u[1]) * (w[0] * w[0] + w[1] * w[1])) < -0.75) return;
          }
          var es = [];
          for (k = 0; k < 4; k++) es.push(edgeIdx[Math.min(seq[k], seq[k + 1]) + '-' + Math.max(seq[k], seq[k + 1])]);
          for (var x = 0; x < 4; x++) for (var y = x + 1; y < 4; y++) if (segCross(prims[es[x]].pts[0], prims[es[x]].pts[1], prims[es[y]].pts[0], prims[es[y]].pts[1])) return;
          glyphs.push(es.concat([dot0 + seq[0]]));
          seqs.push(seq.map(function (v) { return lat3(pts[v][0], pts[v][1]); }));
          return;
        }
        for (var n = 0; n < 9; n++) if (seq.indexOf(n) < 0 && adj(seq[seq.length - 1], n)) rec(seq.concat([n]));
      }
      for (a = 0; a < 9; a++) rec([a]);
      return {
        group: 'D4', prims: prims, glyphs: glyphs, seqs: seqs, reversible: false,
        draw: function (gi, m) {
          var s = seqs[gi].map(function (p) { return apply(m, p); }), d = 'M' + P(s[0]);
          catmull(s).forEach(function (b) { d += 'C' + P(b[1]) + ' ' + P(b[2]) + ' ' + P(b[3]); });
          return d + circlePath(s[0][0], s[0][1], 5);
        },
        samples: function (gi, m) {
          var s = seqs[gi].map(function (p) { return apply(m, p); }), out = diskPts(s[0], 7);
          catmull(s).forEach(function (b) {
            for (var k = 0; k <= 12; k++) {
              var u = k / 12, a0 = (1 - u) * (1 - u) * (1 - u), a1 = 3 * u * (1 - u) * (1 - u), a2 = 3 * u * u * (1 - u), a3 = u * u * u;
              out.push([a0 * b[0][0] + a1 * b[1][0] + a2 * b[2][0] + a3 * b[3][0], a0 * b[0][1] + a1 * b[1][1] + a2 * b[2][1] + a3 * b[3][1]]);
            }
          });
          return out;
        }
      };
    },
    glyphsH: function () { // Brackets: 3 corner brackets in 3 different quadrants
      var cells = [[13, 13], [57, 13], [57, 57], [13, 57]], prims = []; // 30-unit quadrants, 14 apart
      cells.forEach(function (c0, qd) {
        var cs = [[c0[0], c0[1]], [c0[0] + 30, c0[1]], [c0[0] + 30, c0[1] + 30], [c0[0], c0[1] + 30]];
        cs.forEach(function (v, c) {
          var sx = (c === 0 || c === 3) ? 1 : -1, sy = c < 2 ? 1 : -1;
          prims.push({ t: 'm', pts: [[v[0] + 24 * sx, v[1]], v, [v[0], v[1] + 24 * sy]], len: 48, q: qd });
        });
      });
      var glyphs = [];
      subsets(prims.length, 3, function (g) {
        var qs = {}; for (var k = 0; k < 3; k++) { if (qs[prims[g[k]].q]) return; qs[prims[g[k]].q] = 1; }
        glyphs.push(g);
      });
      return { group: 'D4', prims: prims, glyphs: glyphs };
    },
    glyphsLab: function () { // Combs: horizontal spine + 3 ticks at 3 of 5 positions, exactly one crossing the spine
      var xs = [20, 35, 50, 65, 80], prims = [];
      xs.forEach(function (x, pos) {
        prims.push(linePrim([x, 50], [x, 25], { pos: pos, through: 0, slant: 0 }));
        prims.push(linePrim([x, 50], [x, 75], { pos: pos, through: 0, slant: 0 }));
        prims.push(linePrim([x, 25], [x, 75], { pos: pos, through: 1, slant: 0 }));
        prims.push(linePrim([x - 9, 74], [x + 9, 26], { pos: pos, through: 1, slant: 1 }));
        prims.push(linePrim([x - 9, 26], [x + 9, 74], { pos: pos, through: 1, slant: 1 }));
      });
      var glyphs = [];
      subsets(prims.length, 3, function (g) {
        var used = {}, through = 0;
        for (var k = 0; k < 3; k++) { var p = prims[g[k]]; if (used[p.pos]) return; used[p.pos] = 1; through += p.through; }
        if (through !== 1) return;
        for (k = 0; k < 3; k++) { // a slanted tick needs free neighbouring positions (legibility at 64 px)
          var q = prims[g[k]];
          if (q.slant && (used[q.pos - 1] || used[q.pos + 1])) return;
        }
        glyphs.push(g);
      });
      return { group: 'D2', prims: prims, glyphs: glyphs, extra: 'M10 50L90 50', extraLen: 80, extraPts: linePts([10, 50], [90, 50]) };
    }
  };

  // Pentominoes (F): every 5-cell edge-connected shape that fits a 3×3 box, one per class under D4 +
  // translation — exactly the 8 free pentominoes F P T U V W X Z.
  function buildBlocks(rng) {
    var cells = [], classes = {}, list = [];
    for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) cells.push([i, j]);
    var T = [function (i, j) { return [i, j]; }, function (i, j) { return [2 - j, i]; }, function (i, j) { return [2 - i, 2 - j]; },
      function (i, j) { return [j, 2 - i]; }, function (i, j) { return [2 - i, j]; }, function (i, j) { return [i, 2 - j]; },
      function (i, j) { return [j, i]; }, function (i, j) { return [2 - j, 2 - i]; }];
    function norm(cs) {
      var mi = Math.min.apply(null, cs.map(function (c) { return c[0]; })), mj = Math.min.apply(null, cs.map(function (c) { return c[1]; }));
      return cs.map(function (c) { return [c[0] - mi, c[1] - mj]; });
    }
    function keyOf(cs) { return cs.map(function (c) { return c[0] + ',' + c[1]; }).sort().join(';'); }
    subsets(9, 5, function (g) {
      var cs = g.map(function (k) { return cells[k]; });
      var seen = [0], stack = [0];
      while (stack.length) {
        var x = stack.pop();
        for (var y = 0; y < 5; y++) if (seen.indexOf(y) < 0 && Math.abs(cs[x][0] - cs[y][0]) + Math.abs(cs[x][1] - cs[y][1]) === 1) { seen.push(y); stack.push(y); }
      }
      if (seen.length !== 5) return;
      var best = null;
      T.forEach(function (t) { var k = keyOf(norm(cs.map(function (c) { return t(c[0], c[1]); }))); if (best === null || k < best) best = k; });
      if (!classes[best]) { classes[best] = 1; list.push({ canon: best, cells: cs }); }
    });
    var out = rng.shuffle(list).map(function (c) {
      var t = T[rng.int(0, 7)];
      var cs = norm(c.cells.map(function (q) { return t(q[0], q[1]); }));
      var w = Math.max.apply(null, cs.map(function (q) { return q[0]; })) + 1, h = Math.max.apply(null, cs.map(function (q) { return q[1]; })) + 1;
      var s = 22, ox = 50 - w * s / 2, oy = 50 - h * s / 2, o = 0.3; // squares overlap a hair: no seams
      var d = cs.map(function (q) {
        var x = ox + q[0] * s, y = oy + q[1] * s;
        return poly([[x - o, y - o], [x + s + o, y - o], [x + s + o, y + s + o], [x - o, y + s + o]]);
      }).join('');
      return { d: d, canon: c.canon, prims: cs.map(function (q) { return q[0] + 3 * q[1]; }), ink: 5 * s * s };
    });
    return out;
  }

  var FAMILY_INFO = {};
  GLYPH_IDS.forEach(function (id) {
    FAMILY_INFO[id] = { label: GLYPH_LABELS[id], group: id === 'glyphsF' ? 'D4+translation' : null, style: { strokeWidth: 7, fill: false } };
  });
  FAMILY_INFO.glyphsA.group = 'D4'; FAMILY_INFO.glyphsB.group = 'D4'; FAMILY_INFO.glyphsC.group = 'D6';
  FAMILY_INFO.glyphsD.group = 'D8'; FAMILY_INFO.glyphsE.group = 'D4'; FAMILY_INFO.glyphsG.group = 'D4';
  FAMILY_INFO.glyphsH.group = 'D4'; FAMILY_INFO.glyphsLab.group = 'D2';
  FAMILY_INFO.glyphsE.style = { strokeWidth: 5, fill: false };
  FAMILY_INFO.glyphsF.style = { strokeWidth: 0, fill: true };
  FAMILY_INFO.glyphsLab.style = { strokeWidth: 5, fill: false };

  // Similar point sequences (equal ratios of all pairwise distances, optionally reversed) = same shape
  function similarSeq(a, b, reversible) {
    if (a.length !== b.length) return false;
    function ratios(s) {
      var d = [], mx = 0, i, j;
      for (i = 0; i < s.length; i++) for (j = i + 1; j < s.length; j++) { var v = hyp(s[i], s[j]); d.push(v); if (v > mx) mx = v; }
      return d.map(function (v) { return v / mx; });
    }
    var ra = ratios(a);
    function same(rb) { for (var i = 0; i < ra.length; i++) if (Math.abs(ra[i] - rb[i]) > 1e-6) return false; return true; }
    if (same(ratios(b))) return true;
    return !!reversible && same(ratios(b.slice().reverse()));
  }

  // ── coarse ink sets for the selection metric (engine-independent: coordinates snapped before binning) ──
  function snap(x) { return Math.round(x * 1e6) / 1e6; }
  function linePts(a, b) {
    var k = Math.max(1, Math.ceil(hyp(a, b) / 2)), out = [];
    for (var i = 0; i <= k; i++) out.push([a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k]);
    return out;
  }
  function arcPts(p, q, c, r) {
    var a0 = Math.atan2(p[1] - c[1], p[0] - c[0]), d = Math.atan2(q[1] - c[1], q[0] - c[0]) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    var k = Math.max(2, Math.ceil(Math.abs(d) * r / 2)), out = [];
    for (var i = 0; i <= k; i++) { var a = a0 + d * i / k; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
  }
  function diskPts(c, r) { var out = [[c[0], c[1]]]; for (var k = 0; k < 8; k++) out.push([c[0] + r * COS45[k], c[1] + r * SIN45[k]]); return out; }
  function primPts(p) {
    if (!p._s) {
      if (p.t === 'l') p._s = linePts(p.pts[0], p.pts[1]);
      else if (p.t === 'arc') p._s = arcPts(p.pts[0], p.pts[1], p.pts[2], p.r);
      else if (p.t === 'm') p._s = linePts(p.pts[0], p.pts[1]).concat(linePts(p.pts[1], p.pts[2]));
      else if (p.t === 'dot') p._s = diskPts(p.pts[0], p.r + 2);
      else p._s = [];
    }
    return p._s;
  }
  var CELL = 4, NC = 25, WORDS = 20; // 25 × 25 cells of 4 units = 625 bits
  function bitsOf(pts) {
    var b = [], w, i;
    for (w = 0; w < WORDS; w++) b.push(0);
    for (i = 0; i < pts.length; i++) {
      var x = Math.min(NC - 1, Math.max(0, Math.floor(snap(pts[i][0]) / CELL)));
      var y = Math.min(NC - 1, Math.max(0, Math.floor(snap(pts[i][1]) / CELL)));
      var k = y * NC + x;
      b[k >> 5] |= (1 << (k & 31));
    }
    return b;
  }
  function popc(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
  }
  function countBits(a) { var c = 0; for (var w = 0; w < WORDS; w++) c += popc(a[w]); return c; }
  function jacc(a, na, b, nb) { // Jaccard distance |A xor B| / |A or B| from the intersection count
    var both = 0;
    for (var w = 0; w < WORDS; w++) { var v = a[w] & b[w]; if (v) both += popc(v); }
    var u = na + nb - both;
    return u ? (u - both) / u : 0;
  }
  function candPts(fam, c, m) { // sample points of a candidate glyph drawn under group element m
    if (fam.samples) return fam.samples(c.gi, m);
    var out = (fam.extraPts || []).slice();
    for (var i = 0; i < c.g.length; i++) {
      var s = primPts(fam.prims[c.g[i]]);
      for (var j = 0; j < s.length; j++) out.push(apply(m, s[j]));
    }
    return out;
  }

  var glyphCache = {};
  function buildFamily(id) {
    if (glyphCache[id]) return glyphCache[id];
    if (!HF.rng) throw new Error('HF.sets: HF.rng must load before glyph families are built');
    var rng = HF.rng.create('holdfast/glyphs/v1/' + id);   // working-name seed, kept on purpose: it defines the glyphs
    var out;
    if (id === 'glyphsF') {
      var blocks = buildBlocks(rng);
      out = { paths: blocks.map(function (b) { return b.d; }), canon: blocks.map(function (b) { return b.canon; }),
        prims: blocks.map(function (b) { return b.prims; }), ink: blocks.map(function (b) { return b.ink; }) };
      glyphCache[id] = out;
      return out;
    }
    var fam = BUILD[id]();
    var perms = permsFor(fam.prims, fam.group);
    function inkOf(g) { var s = fam.extraLen || 0; g.forEach(function (i) { s += fam.prims[i].len || 0; }); return s; }
    // one representative per symmetry class
    var seen = {}, classes = [];
    fam.glyphs.forEach(function (g, gi) {
      var c = canonOf(g, perms);
      if (seen[c]) return;
      seen[c] = 1;
      classes.push({ g: g, gi: gi, canon: c, ink: inkOf(g) });
    });
    // similar complexity: keep classes whose ink length is within ±15 % of the median (widen if needed)
    var inks = sortNum(classes.map(function (c) { return c.ink; })), med = inks[inks.length >> 1], band = 0.15, pool;
    do {
      pool = classes.filter(function (c) { return Math.abs(c.ink - med) <= band * med + 1e-9; });
      band += 0.05;
    } while (pool.length < 24 && pool.length < classes.length);
    // selection metric: coarse ink overlap (Jaccard distance of 4-unit cells), minimised over the group
    var G = GROUPS[fam.group];
    if (pool.length > 72) pool = rng.shuffle(pool).slice(0, 72);
    pool.forEach(function (c) {
      c.bits = G.map(function (m) { return bitsOf(candPts(fam, c, m)); });
      c.nb = c.bits.map(countBits);
    });
    var P = pool.length, J = [], i, j, s;
    for (i = 0; i < P; i++) J.push(new Array(P));
    for (i = 0; i < P; i++) {
      J[i][i] = 0;
      for (j = i + 1; j < P; j++) {
        var best = 1;
        for (s = 0; s < G.length; s++) { var v = jacc(pool[i].bits[0], pool[i].nb[0], pool[j].bits[s], pool[j].nb[s]); if (v < best) best = v; }
        if (fam.seqs && similarSeq(fam.seqs[pool[i].gi], fam.seqs[pool[j].gi], fam.reversible)) best = 0;
        J[i][j] = J[j][i] = best;
      }
    }
    // greedy max–min from several seeded starts; keep the set with the largest minimum (then sum) distance
    var starts = rng.shuffle(range(P, function (k) { return k; })).slice(0, Math.min(P, 16)), bestSel = null, bestMin = -1, bestSum = -1;
    starts.forEach(function (st) {
      var sel = [st], a, b, k;
      while (sel.length < 8) {
        var bi = -1, bm = -1, bs = -1;
        for (var c = 0; c < P; c++) {
          if (sel.indexOf(c) >= 0) continue;
          var mn = Infinity, sm = 0;
          for (k = 0; k < sel.length; k++) { var d = J[c][sel[k]]; if (d < mn) mn = d; sm += d; }
          if (mn > bm || (mn === bm && sm > bs)) { bm = mn; bs = sm; bi = c; }
        }
        sel.push(bi);
      }
      var mnS = Infinity, smS = 0;
      for (a = 0; a < 8; a++) for (b = a + 1; b < 8; b++) { var e = J[sel[a]][sel[b]]; if (e < mnS) mnS = e; smS += e; }
      if (mnS > bestMin || (mnS === bestMin && smS > bestSum)) { bestMin = mnS; bestSum = smS; bestSel = sel; }
    });
    if (!(bestMin > 0)) throw new Error('glyph family ' + id + ': fewer than 8 distinct glyphs');
    var chosen = bestSel.map(function (k) { return pool[k]; });
    // draw each in a seeded orientation
    out = { paths: [], canon: [], prims: [], ink: [] };
    chosen.forEach(function (cl) {
      var m = G[rng.int(0, G.length - 1)];
      var d;
      if (fam.draw) d = fam.draw(cl.gi, m);
      else d = cl.g.map(function (i) { return drawPrim(rebuild(fam.prims[i], m)); }).join('') + (fam.dots ? fam.dots(cl.g, m) : '');
      if (fam.extra) d = fam.extra + d;
      out.paths.push(d);
      out.canon.push(String(cl.canon));
      out.prims.push(cl.g.slice());
      out.ink.push(cl.ink);
    });
    glyphCache[id] = out;
    return out;
  }

  function isGlyphSet(id) { return GLYPH_IDS.indexOf(id) >= 0; }
  function glyphPath(setId, index) {
    if (!isGlyphSet(setId)) return null;
    var f = buildFamily(setId);
    return f.paths[index] !== undefined ? f.paths[index] : null;
  }
  /** Build a glyph family now (first build ≈ 5–60 ms); no-op for other sets. Call before a stream starts. */
  function prepare(setId) { if (isGlyphSet(setId)) buildFamily(setId); return available(setId); }
  function glyphStyle(setId) { var f = FAMILY_INFO[setId]; return f ? { strokeWidth: f.style.strokeWidth, fill: f.style.fill } : null; }
  function glyphSvg(setId, index, size) { var d = glyphPath(setId, index); return d ? svgWrap(d, glyphStyle(setId), size) : ''; }
  function glyphInfo(setId) {
    if (!isGlyphSet(setId)) return null;
    var f = buildFamily(setId);
    return { prims: f.prims.map(function (p) { return p.slice(); }), canon: f.canon.slice(), ink: f.ink.slice() };
  }

  var api = {
    ids: IDS.slice(), get: get, list: list, available: available, forTrack: forTrack, defaultFor: defaultFor,
    key: key, indexOf: indexOf, name: name, step: step, rulePhrase: rulePhrase, relPhrase: relPhrase, cellRC: cellRC,
    prepare: prepare, glyphPath: glyphPath, glyphStyle: glyphStyle, glyphSvg: glyphSvg, glyphInfo: glyphInfo,
    shapePath: shapePath, shapeSvg: shapeSvg, parseExpr: parseExpr, families: FAMILY_INFO, MINUS: MINUS
  };
  HF.sets = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
