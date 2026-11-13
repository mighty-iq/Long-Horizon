/* Long-Horizon — track catalog (pure, no DOM). MIT licence.
 *
 * Every trainable track of SPEC §2.1 with its exact ladder (SPEC §5), level labels in plain words,
 * a difficulty in logits for the learner model, its stimulus sets (by id), its gate, its lesson and
 * its rule card. Other modules refer to tracks and sets by id only; nothing here depends on the
 * task generators or the sets module at load time.
 *
 * API (HF.catalog):
 *   ids() → [trackId]                         all 19 track ids, in display order
 *   get(trackId) → TrackDef | null            { id, task, structure, family, blockKind, keys, experimental,
 *                                               name, short, sets: [setId], defaultSet, optionalSets,
 *                                               lessonId, gate, tier?, warmupDrop, scale: 'ba'|'recall' }
 *   tracksOfTask(task) → [trackId]            task ∈ nback | relations | span | vsearch
 *   rungCount(trackId), maxRung(trackId)
 *   params(trackId, rung) → fresh copy of the rung params (rung is clamped):
 *       n-back plain/dual/transform/arith: { n, onMs, soaMs }
 *       nback.switch:                      { n, onMs, soaMs, switchRate }
 *       rel.steps:                         { level, back, maxNumber, onMs, soaMs }
 *       rel.grid.T1…T8:                    { windowMs, keep, distractors, nearMiss, tier, rule, lines, gridSize, itiMs, arrays, targets, step }
 *       rel.stream:                        { changeMs, cells, changes, targets, rule }
 *       span.*:                            { setSize, trials }
 *       vs.search:                         { size, windowMs, trials }
 *   nOf(trackId, rung) → n (n-back family, Equal Steps "back"), else null
 *   rungForN(trackId, n) → standard-pace rung with that n (protocols: rung = 2(n − 1))
 *   levelLabel(trackId, rung) → "3-back · fast" | "2-back up to 29" | "Tier 2 · step 4 of 9" | "Step 2 of 6" …
 *       (never repeats the version name: Equal Steps and Stream dropped theirs in Phase 4, PQ-14; fullLabel adds it)
 *   fullLabel(trackId, rung) → "Plain n-back · 3-back · fast", "Relation Grid · Same · step 4 of 9" (no repeated words)
 *   levelDetail(trackId, rung) → longer plain description ("Ascending · 4.5 s per grid · 6 distractors")
 *   difficulty(trackId, rung, adj?) → logits (1 logit per n on n-back tracks; Transform (days, +1) is one n harder than
 *       Plain at the same rung, Cao 2026 Fig. 4); adj = { lureCount, lureMode, step }
 *   allowedRungs(trackId, modeId) → rungs the mode may use (Stretch skips the standard-pace half-steps from 2-back)
 *   contentFamily(setId) → spatial | verbal | numeric | symbolic | audio
 *   familiesFor(trackId, setId) → [family]    (Dual = position + sound → two families)
 *   gateOpen(trackId, ctx) → bool             ctx = { peak: {trackId: rung}, lessons: {lessonId: true}, settings, protocolPeak: {trackId: rung} }
 *   gateText(trackId) → plain words for "opens when …"
 *   ruleCard(trackId, rung, setId, opts?) → { title, rule, keys, example }   opts = { step } (Transform rule offset)
 *   estBlockMs(trackId, params) → rough duration of one block (without debrief)
 *   trainingSets(trackId) → [setId] usable in training (HF.sets.forTrack when loaded; glyph families → 'glyphs'; never Lab-only)
 *   defaultSet(trackId) → setId;  normSet(setId) → setId with glyph families collapsed to 'glyphs'
 *   LESSONS: { lessonId: { id, title, tracks: [trackId] } }
 *   GLYPH_FAMILIES: ['glyphsA' … 'glyphsH'], LAB_ONLY_SETS: ['glyphsLab']
 *
 * Set ids follow SPEC §2.2. 'glyphs' in a set list is a placeholder for the glyph family active this
 * session (the planner resolves it; families refresh every 5 sessions). Arithmetic items, Equal Steps
 * numbers and the visual-search display have no fixed id in SPEC §2.2; the ids used here ('arith',
 * 'numbers', 'tl') are fallbacks — at run time the planner prefers HF.sets.forTrack(trackId) when it exists.
 *
 * Design values (not from SPEC): base difficulties per track, Relation Grid rule names/lines, the
 * Transform rule variants (+2, −1 on non-day sets), rule-card texts. Documented in docs/dev/engine-notes.md.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var STD = { onMs: 500, soaMs: 3000 };
  var FAST = { onMs: 500, soaMs: 2500 };

  function assign(dst) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i]; if (!s) continue;
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) dst[k] = s[k];
    }
    return dst;
  }
  function clampInt(x, lo, hi) { x = Math.round(+x); if (!(x === x)) x = lo; return x < lo ? lo : (x > hi ? hi : x); }

  // ---------- ladders (SPEC §5, exact) ----------
  // n-back plain/dual/transform/arith reach 16-back (r = 0…31; SPEC §5 amended 12 Nov, Phase 4 SC-05: 9-back held
  // back Cao's traditional arm, whose session-6 mean was ≈ 8.4-back, SD ≈ 2.9)
  var NBACK_MAX_N = 16;
  function nbackLadder() {
    var out = [];
    for (var r = 0; r <= 2 * NBACK_MAX_N - 1; r++) out.push(assign({ n: 1 + Math.floor(r / 2) }, r % 2 ? FAST : STD));
    return out;
  }
  function switchLadder() {
    var out = [];
    for (var r = 0; r <= 26; r++) {
      var sub = r % 3;
      out.push(assign({ n: 1 + Math.floor(r / 3) }, sub === 2 ? FAST : STD, { switchRate: sub === 0 ? 0.25 : 0.5 }));
    }
    return out;
  }
  var STEPS_LEVELS = [[1, 9], [1, 19], [1, 29], [1, 39], [2, 9], [2, 19], [2, 29], [2, 39], [3, 9], [3, 19], [3, 29], [3, 39]];
  function stepsLadder() {
    var out = [];
    for (var r = 0; r <= 23; r++) {
      var L = Math.floor(r / 2);
      out.push(assign({ level: L, back: STEPS_LEVELS[L][0], maxNumber: STEPS_LEVELS[L][1] }, r % 2 ? FAST : STD));
    }
    return out;
  }
  // Relation Grid pressure steps R1…R9 (PLAN §4.2). Effects are cumulative from the step that adds them.
  var GRID_STEPS = [
    { windowMs: 8000, keep: true, distractors: 0, nearMiss: false },
    { windowMs: 5500, keep: true, distractors: 0, nearMiss: false },
    { windowMs: 5500, keep: false, distractors: 0, nearMiss: false },
    { windowMs: 4500, keep: false, distractors: 0, nearMiss: false },
    { windowMs: 4500, keep: false, distractors: 6, nearMiss: false },
    { windowMs: 4500, keep: false, distractors: 6, nearMiss: true },
    { windowMs: 3500, keep: false, distractors: 6, nearMiss: true },
    { windowMs: 2750, keep: false, distractors: 6, nearMiss: true },
    { windowMs: 2000, keep: false, distractors: 6, nearMiss: true }
  ];
  var TIERS = {
    1: { rule: 'same', lines: 'rows-cols', gridSize: 3, label: 'Same' },
    2: { rule: 'ascending', lines: 'rows-cols', gridSize: 3, label: 'Ascending' },
    3: { rule: 'different', lines: 'rows-cols', gridSize: 3, label: 'Different' },
    4: { rule: 'same-or-different', lines: 'rows-cols-diags', gridSize: 3, label: 'Same or different, with diagonals' },
    5: { rule: 'five-same', lines: 'cross', gridSize: 3, label: 'Five the same' },
    6: { rule: 'two-features', lines: 'rows-cols', gridSize: 3, label: 'Two features' },
    7: { rule: 'same-or-different-4x4', lines: 'rows-cols', gridSize: 4, label: '4×4 grid' },
    8: { rule: 'five-different', lines: 'cross', gridSize: 3, label: 'Five different' }
  };
  function gridLadder(tier) {
    var t = TIERS[tier], out = [];
    for (var r = 0; r < GRID_STEPS.length; r++) {
      out.push(assign({}, GRID_STEPS[r], { tier: tier, rule: t.rule, lines: t.lines, gridSize: t.gridSize, itiMs: 100, arrays: 20, targets: 10, step: r + 1 }));
    }
    return out;
  }
  var STREAM_STEPS = [[2000, 1], [1500, 1], [1000, 1], [1000, 2], [750, 2], [750, 3]];
  function streamLadder() {
    return STREAM_STEPS.map(function (s) { return { changeMs: s[0], cells: s[1], changes: 30, targets: 6, rule: 'same' }; });
  }
  function spanLadder() { var out = []; for (var r = 0; r <= 7; r++) out.push({ setSize: r + 2, trials: 3 }); return out; }
  var VS_SIZES = [8, 12, 16, 24, 32, 40, 48, 56, 64];   // SPEC §5 as amended 6 Nov (r = 0…17)
  // 40 displays per block (SPEC §5 amended 12 Nov, Phase 4 SC-02): a search block then lasts about as long as a
  // training block, so the Study control is matched in time as well as in blocks
  var VS_TRIALS = 40, VS_ITI_MS = 500;
  // two shorter deadlines on top (r = 18, 19: 64 items · 1.5 s, 1.0 s; SPEC §5 amended 12 Nov): with 40-display
  // blocks the share of simulated controls touching the old top step within 60 days rose (Cao 22 → 25 %, Wang 9 → 11 %)
  var VS_TOP_WINDOWS = [1500, 1000];
  function vsLadder() {
    var out = [];
    for (var r = 0; r <= 17; r++) out.push({ size: VS_SIZES[Math.floor(r / 2)], windowMs: r % 2 ? 2000 : 3000, trials: VS_TRIALS });
    VS_TOP_WINDOWS.forEach(function (w) { out.push({ size: 64, windowMs: w, trials: VS_TRIALS }); });
    return out;
  }
  /** Difficulty of a search deadline (logits): 3 s 0, 2 s .25, then +.5 per halving (1.5 s ≈ .46, 1 s .75). */
  function vsWindowCost(w) { return w >= 3000 ? 0 : (w >= 2000 ? 0.25 : 0.25 + 0.5 * Math.log(2000 / w) / Math.LN2); }

  // ---------- content families of the sets ----------
  var FAMILY = {
    grid8: 'spatial', ring8: 'spatial', compass: 'spatial',
    letters: 'verbal', days: 'verbal', months: 'verbal',
    digits: 'numeric', clock: 'numeric', numbers: 'numeric', arith: 'numeric', sums: 'numeric', dots: 'numeric', bars: 'spatial',
    shapes: 'symbolic', tl: 'symbolic',
    tones: 'audio', lettersAudio: 'audio'
  };
  var GLYPH_FAMILIES = ['glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH'];
  GLYPH_FAMILIES.forEach(function (g) { FAMILY[g] = 'symbolic'; });
  FAMILY.glyphs = 'symbolic'; FAMILY.glyphsLab = 'symbolic';

  // ---------- lessons ----------
  var LESSONS = {
    'lesson.nback': { id: 'lesson.nback', title: 'N-back basics', tracks: ['nback.plain'] },
    'lesson.dual': { id: 'lesson.dual', title: 'Dual n-back', tracks: ['nback.dual'] },
    'lesson.transform': { id: 'lesson.transform', title: 'Transform: the day after', tracks: ['nback.transform'] },
    'lesson.arith': { id: 'lesson.arith', title: 'Arithmetic: compare answers', tracks: ['nback.arith'] },
    'lesson.switch': { id: 'lesson.switch', title: 'Switch: follow the cue', tracks: ['nback.switch'] },
    'lesson.steps': { id: 'lesson.steps', title: 'Equal Steps', tracks: ['rel.steps'] },
    'lesson.grid': { id: 'lesson.grid', title: 'Relation Grid', tracks: ['rel.grid.T1'] },
    'lesson.stream': { id: 'lesson.stream', title: 'Relation Stream', tracks: ['rel.stream'] },
    'lesson.span': { id: 'lesson.span', title: 'Complex span', tracks: ['span.op', 'span.sym', 'span.back'] },
    'lesson.vsearch': { id: 'lesson.vsearch', title: 'Visual search', tracks: ['vs.search'] }
  };
  for (var tt = 2; tt <= 8; tt++) LESSONS['lesson.grid.T' + tt] = { id: 'lesson.grid.T' + tt, title: 'Relation Grid · ' + TIERS[tt].label, tracks: ['rel.grid.T' + tt] };

  // ---------- tracks ----------
  var NBACK_DIFF = { 'nback.plain': -2.2, 'nback.dual': -1.4, 'nback.transform': -1.2, 'nback.arith': -1.0 };
  var GRID_BASE = { 1: -2.0, 2: -1.6, 3: -1.3, 4: -1.0, 5: -0.7, 6: -0.5, 7: -0.3, 8: 0.6 };
  var GRID_STEP_D = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.15, 2.55, 3.0];
  var STREAM_D = [0, 0.4, 0.8, 1.3, 1.7, 2.2];

  var DEFS = [];
  function def(o) { DEFS.push(o); return o; }
  def({ id: 'nback.plain', task: 'nback', structure: 'identity', family: 'updating', blockKind: 'stream', keys: ['match'], experimental: false,
    name: 'Plain n-back', short: 'Plain', ladder: nbackLadder(), sets: ['grid8', 'letters', 'digits', 'shapes', 'days', 'tones', 'glyphs', 'lettersAudio'],
    optionalSets: ['lettersAudio'], defaultSet: 'grid8', lessonId: 'lesson.nback', gate: { kind: 'open' }, warmupDrop: 2 });
  def({ id: 'nback.dual', task: 'nback', structure: 'identity-dual', family: 'updating', blockKind: 'stream', keys: ['match', 'match2'], experimental: false,
    name: 'Dual n-back', short: 'Dual', ladder: nbackLadder(), sets: ['tones', 'lettersAudio'], optionalSets: ['lettersAudio'], defaultSet: 'tones',
    lessonId: 'lesson.dual', gate: { kind: 'open' }, warmupDrop: 2, dualVisual: 'grid8' });
  def({ id: 'nback.transform', task: 'nback', structure: 'transform', family: 'manipulation', blockKind: 'stream', keys: ['match'], experimental: true,
    name: 'Transform n-back', short: 'Transform', ladder: nbackLadder(), sets: ['days', 'months', 'clock', 'compass', 'ring8'], optionalSets: [], defaultSet: 'days',
    lessonId: 'lesson.transform', gate: { kind: 'exec' }, warmupDrop: 2 });
  def({ id: 'nback.arith', task: 'nback', structure: 'arith', family: 'manipulation', blockKind: 'stream', keys: ['match'], experimental: true,
    name: 'Arithmetic n-back', short: 'Arithmetic', ladder: nbackLadder(), sets: ['arith'], optionalSets: [], defaultSet: 'arith',
    lessonId: 'lesson.arith', gate: { kind: 'exec' }, warmupDrop: 2 });
  def({ id: 'nback.switch', task: 'nback', structure: 'switch', family: 'switching', blockKind: 'stream', keys: ['match'], experimental: true,
    name: 'Switch n-back', short: 'Switch', ladder: switchLadder(), sets: ['digits', 'shapes'], optionalSets: [], defaultSet: 'digits',
    lessonId: 'lesson.switch', gate: { kind: 'exec' }, warmupDrop: 2 });
  def({ id: 'rel.steps', task: 'relations', structure: 'steps', family: 'relational', blockKind: 'stream', keys: ['match'], experimental: true,
    name: 'Equal Steps', short: 'Equal Steps', ladder: stepsLadder(), sets: ['numbers'], optionalSets: [], defaultSet: 'numbers',
    lessonId: 'lesson.steps', gate: { kind: 'open' }, warmupDrop: 2 });
  for (var k = 1; k <= 8; k++) {
    def({ id: 'rel.grid.T' + k, task: 'relations', structure: 'grid-T' + k, family: 'relational', blockKind: 'discrete', keys: ['match', 'no'], experimental: true,
      name: 'Relation Grid · ' + TIERS[k].label, short: 'Grid T' + k, ladder: gridLadder(k), tier: k,
      sets: ['digits', 'letters', 'shapes', 'dots', 'bars', 'glyphs'], optionalSets: [], defaultSet: 'digits',
      lessonId: k === 1 ? 'lesson.grid' : 'lesson.grid.T' + k,
      gate: k === 1 ? { kind: 'open' } : { kind: 'tier', prev: 'rel.grid.T' + (k - 1), at: 5, optIn: k === 8 ? 'gridT8' : null }, warmupDrop: 2 });
  }
  def({ id: 'rel.stream', task: 'relations', structure: 'rstream', family: 'relational', blockKind: 'stream', keys: ['match'], experimental: true,
    name: 'Relation Stream', short: 'Stream', ladder: streamLadder(), sets: ['digits', 'letters', 'shapes', 'dots', 'bars', 'glyphs'], optionalSets: [], defaultSet: 'digits',
    lessonId: 'lesson.stream', gate: { kind: 'tier', prev: 'rel.grid.T2', at: 5 }, warmupDrop: 1, maxPerSession: 1 });
  def({ id: 'span.op', task: 'span', structure: 'span-forward', family: 'storage', blockKind: 'span', keys: ['match', 'no', 'keypad'], experimental: false,
    name: 'Operation span', short: 'Op span', ladder: spanLadder(), sets: ['letters'], optionalSets: [], defaultSet: 'letters',
    lessonId: 'lesson.span', gate: { kind: 'setting', key: 'spanOn' }, warmupDrop: 1, scale: 'recall' });
  def({ id: 'span.sym', task: 'span', structure: 'span-forward', family: 'storage', blockKind: 'span', keys: ['match', 'no', 'keypad'], experimental: false,
    name: 'Symbol span', short: 'Symbol span', ladder: spanLadder(), sets: ['shapes', 'digits'], optionalSets: [], defaultSet: 'shapes',
    lessonId: 'lesson.span', gate: { kind: 'setting', key: 'spanOn' }, warmupDrop: 1, scale: 'recall' });
  def({ id: 'span.back', task: 'span', structure: 'span-backward', family: 'storage', blockKind: 'span', keys: ['match', 'no', 'keypad'], experimental: false,
    name: 'Backward span', short: 'Backward span', ladder: spanLadder(), sets: ['letters', 'digits'], optionalSets: [], defaultSet: 'letters',
    lessonId: 'lesson.span', gate: { kind: 'setting', key: 'spanOn' }, warmupDrop: 1, scale: 'recall' });
  def({ id: 'vs.search', task: 'vsearch', structure: 'search', family: 'control', blockKind: 'discrete', keys: ['match', 'no'], experimental: false,
    name: 'Visual search', short: 'Search', ladder: vsLadder(), sets: ['tl'], optionalSets: [], defaultSet: 'tl',
    lessonId: 'lesson.vsearch', gate: { kind: 'study' }, warmupDrop: 1, noGeneral: true });

  var BY_ID = {};
  DEFS.forEach(function (d) { if (!d.scale) d.scale = 'ba'; BY_ID[d.id] = d; });
  var IDS = DEFS.map(function (d) { return d.id; });

  function get(id) { return BY_ID[id] || null; }
  function must(id) { var d = BY_ID[id]; if (!d) throw new Error('catalog: unknown track ' + id); return d; }
  function rungCount(id) { return must(id).ladder.length; }
  function maxRung(id) { return must(id).ladder.length - 1; }
  function params(id, rung) { var d = must(id); return assign({}, d.ladder[clampInt(rung, 0, d.ladder.length - 1)]); }
  function tracksOfTask(task) { return IDS.filter(function (id) { return BY_ID[id].task === task; }); }
  function isNback(id) { return !!BY_ID[id] && BY_ID[id].task === 'nback'; }

  function nOf(id, rung) {
    var d = must(id), p = d.ladder[clampInt(rung, 0, d.ladder.length - 1)];
    if (p.n != null) return p.n;
    if (p.back != null) return p.back;
    return null;
  }
  function rungForN(id, n) {
    var d = must(id); n = Math.max(1, Math.round(n));
    if (id === 'nback.switch') return clampInt(3 * (n - 1), 0, d.ladder.length - 1);
    if (d.task === 'nback') return clampInt(2 * (n - 1), 0, d.ladder.length - 1);
    return null;
  }

  // ---------- difficulty (logits) ----------
  function difficulty(id, rung, adj) {
    var d = must(id), r = clampInt(rung, 0, d.ladder.length - 1), p = d.ladder[r], x;
    if (id === 'nback.switch') x = -1.5 + (p.n - 1) + [0, 0.3, 0.6][r % 3];
    else if (d.task === 'nback') x = NBACK_DIFF[id] + 0.5 * r;                     // 1 logit per n, half per pace step
    else if (id === 'rel.steps') x = -1.3 + 1.6 * (p.back - 1) + 0.4 * (p.maxNumber - 9) / 10 + (r % 2 ? 0.2 : 0);   // range +0.4, fast +0.2, each extra back +1.6
    else if (d.tier) x = GRID_BASE[d.tier] + GRID_STEP_D[r];
    else if (id === 'rel.stream') x = -1.0 + STREAM_D[r];
    else if (id === 'span.back') x = -1.6 + 0.55 * r;
    else if (d.task === 'span') x = -2.0 + 0.55 * r;
    else x = -2.5 + 1.6 * Math.log(p.size / 8) / Math.LN2 + vsWindowCost(p.windowMs);   // vs.search: 1.6 per doubling of the display, 2 s window +0.25
    if (adj) {
      if (adj.lureMode === 'uncontrolled') x -= 0.1;
      else if (adj.lureCount != null && ((d.task === 'nback' && p.n >= 2) || id === 'rel.steps')) x += 0.1 * (adj.lureCount - 4);   // Equal Steps: near misses
      if (id === 'nback.transform' && adj.step != null && adj.step !== 1) x += 0.25;    // "two after" / "one before" variants
    }
    return x;
  }

  // Stretch: "earlier fast pace" — from 2-back up, n-back tracks use only their fast half-step
  // (Switch: only its fast 50 % sub-step). Every other mode uses the whole ladder.
  function allowedRungs(id, modeId) {
    var d = must(id), out = [];
    for (var r = 0; r < d.ladder.length; r++) {
      if (modeId === 'stretch' && d.task === 'nback') {
        var p = d.ladder[r];
        if (p.n >= 2) {
          if (id === 'nback.switch' ? r % 3 !== 2 : r % 2 !== 1) continue;
        }
      }
      out.push(r);
    }
    return out;
  }

  // ---------- families, gates ----------
  function contentFamily(setId) {
    if (!setId) return 'symbolic';
    if (FAMILY[setId]) return FAMILY[setId];
    try {
      if (HF.sets && typeof HF.sets.get === 'function') { var s = HF.sets.get(setId); if (s && s.contentFamily) return s.contentFamily; }
    } catch (e) { /* unknown set */ }
    if (/^glyphs/.test(setId)) return 'symbolic';
    return 'symbolic';
  }
  function familiesFor(id, setId) {
    var d = must(id), s = setId || d.defaultSet;
    if (d.dualVisual) return [contentFamily(d.dualVisual), contentFamily(s)];
    return [contentFamily(s)];
  }

  /** ctx = { peak: {trackId: rung}, protocolPeak: {trackId: rung}, lessons: {lessonId: true}, settings: {...}, study: {arm} } */
  function gateOpen(id, ctx) {
    var d = must(id), g = d.gate; ctx = ctx || {};
    var peak = ctx.peak || {}, lessons = ctx.lessons || {}, settings = ctx.settings || {}, pp = ctx.protocolPeak || {};
    function pk(t) { var a = peak[t], b = pp[t]; a = a == null ? -1 : a; b = b == null ? -1 : b; return Math.max(a, b); }
    switch (g.kind) {
      case 'open': return true;
      case 'exec': return pk('nback.plain') >= 2 || !!lessons[d.lessonId];
      case 'tier': return (peak[g.prev] != null ? peak[g.prev] : -1) >= g.at && (!g.optIn || settings[g.optIn] === true);
      case 'setting': return settings[g.key] === true;
      case 'study': return !!(ctx.study && studyArmKind(ctx.study.arm) === 'control');
      default: return false;
    }
  }
  /* Study arms. HF.study (the solo draw and coordinator codes) names the arms varied / search / labonly / cao-exec /
     cao-trad / cao-search / wang-steps / wang-search; the planner runs train / control / labonly / cao-exec / cao-trad /
     wang-steps. studyArmKind() maps the first names onto the second; planner names pass through unchanged.
     (Phase 3 fix: a drawn 'varied' or 'search' arm used to plan nothing: "Unknown study arm".) */
  var STUDY_ARM = { varied: 'train', search: 'control', 'cao-search': 'control', 'wang-search': 'control', 'lab-only': 'labonly' };
  function studyArmKind(arm) { return arm ? (Object.prototype.hasOwnProperty.call(STUDY_ARM, arm) ? STUDY_ARM[arm] : arm) : null; }
  /** Gate ignoring an opt-in (Free play may offer T8 once T7 reached R6). */
  function ladderGateOpen(id, ctx) {
    var d = must(id);
    if (d.gate.kind === 'tier') { var peak = (ctx && ctx.peak) || {}; return (peak[d.gate.prev] != null ? peak[d.gate.prev] : -1) >= d.gate.at; }
    return gateOpen(id, ctx);
  }
  function gateText(id) {
    var d = must(id), g = d.gate;
    if (g.kind === 'open') return 'Available from the start.';
    if (g.kind === 'exec') return 'Opens when Plain n-back reaches 2-back, or when you pass its short lesson.';
    if (g.kind === 'tier') {
      var prev = BY_ID[g.prev];
      var s = 'Opens when ' + prev.name + ' reaches step 6 (4.5 s with distractors).';
      if (g.optIn) s += ' Optional: turn it on in Settings (very hard).';
      return s;
    }
    if (g.kind === 'setting') return 'Turn Span on in Settings to use it.';
    if (g.kind === 'study') return 'Used only in Study mode.';
    return '';
  }

  // ---------- labels ----------
  function fmtSec(ms) { var s = ms / 1000; var t = s % 1 === 0 ? s.toFixed(1) : String(Math.round(s * 100) / 100); return t + ' s'; }
  function levelLabel(id, rung) {
    var d = must(id), r = clampInt(rung, 0, d.ladder.length - 1), p = d.ladder[r];
    if (id === 'nback.switch') {
      var sub = r % 3;
      return p.n + '-back · ' + (sub === 0 ? 'cue changes 1 in 4' : 'cue changes 1 in 2') + (sub === 2 ? ' · fast' : '');
    }
    if (d.task === 'nback') return p.n + '-back' + (r % 2 ? ' · fast' : '');
    if (id === 'rel.steps') return p.back + '-back up to ' + p.maxNumber + (r % 2 ? ' · fast' : '');
    if (d.tier) return 'Tier ' + d.tier + ' · step ' + (r + 1) + ' of 9';
    if (id === 'rel.stream') return 'Step ' + (r + 1) + ' of 6';
    if (d.task === 'span') return p.setSize + ' items';
    return p.size + ' items · ' + fmtSec(p.windowMs);
  }
  /** Version name + level without repeating words: "Plain n-back · 3-back · fast", "Equal Steps · 2-back up to 29",
   *  "Relation Grid · Same · step 4 of 9", "Relation Stream · step 2 of 6". */
  function fullLabel(id, rung) {
    var d = must(id), r = clampInt(rung, 0, d.ladder.length - 1), lbl = levelLabel(id, r);
    if (d.tier) return d.name + ' · step ' + (r + 1) + ' of 9';
    if (id === 'rel.stream') return d.name + ' · step ' + (r + 1) + ' of 6';
    return d.name + ' · ' + lbl;
  }
  function levelDetail(id, rung) {
    var d = must(id), r = clampInt(rung, 0, d.ladder.length - 1), p = d.ladder[r];
    if (d.task === 'nback') return 'one item every ' + fmtSec(p.soaMs) + (p.switchRate ? ', the cue changes on ' + (p.switchRate === 0.25 ? 'about 1 item in 4' : 'about 1 item in 2') : '');
    if (id === 'rel.steps') return 'numbers 1–' + p.maxNumber + ', one every ' + fmtSec(p.soaMs);
    if (d.tier) {
      var bits = [TIERS[d.tier].label, fmtSec(p.windowMs) + ' per grid'];
      bits.push(p.keep ? 'some cells kept from the last grid' : 'all cells new');
      if (p.distractors) bits.push(p.distractors + ' look-alike symbols');
      if (p.nearMiss) bits.push('lure lines');
      return bits.join(' · ');
    }
    if (id === 'rel.stream') return p.cells + (p.cells === 1 ? ' cell changes' : ' cells change') + ' every ' + fmtSec(p.changeMs);
    if (d.task === 'span') return p.setSize + ' items to remember per list, ' + p.trials + ' lists';
    return p.size + ' symbols, ' + fmtSec(p.windowMs) + ' to answer';
  }

  // ---------- rule cards ----------
  var TOKENS = {
    grid8: ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'],
    ring8: ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'],
    letters: ['K', 'R', 'S', 'H', 'T', 'L', 'Q', 'C'],
    lettersAudio: ['"K"', '"R"', '"S"', '"H"', '"T"', '"L"', '"Q"', '"C"'],
    digits: ['3', '8', '5', '1', '7', '2', '9', '4'],
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    clock: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    shapes: ['circle', 'star', 'triangle', 'square', 'cross', 'diamond', 'ring', 'arrow'],
    tones: ['low tone', 'high tone', 'middle tone', 'deep tone', 'bright tone', 'soft tone', 'sharp tone', 'round tone'],
    glyphs: ['symbol A', 'symbol B', 'symbol C', 'symbol D', 'symbol E', 'symbol F', 'symbol G', 'symbol H']
  };
  var NOUN = { grid8: 'square', ring8: 'square', letters: 'letter', lettersAudio: 'spoken letter', digits: 'digit', days: 'day', months: 'month',
    clock: 'hour', compass: 'direction', shapes: 'shape', tones: 'tone', glyphs: 'symbol', sums: 'sum', arith: 'sum', numbers: 'number', dots: 'dot group', bars: 'bar' };
  function tokensFor(setId) { if (TOKENS[setId]) return TOKENS[setId]; if (/^glyphs/.test(setId || '')) return TOKENS.glyphs; return TOKENS.letters; }
  function nounFor(setId) { if (NOUN[setId]) return NOUN[setId]; if (/^glyphs/.test(setId || '')) return 'symbol'; return 'item'; }
  function stepsBack(n) { return n === 1 ? 'the one just before' : 'the one ' + n + ' steps back'; }
  function seqExample(tokens, n, last) {
    // a, fillers…, last  (shortened with "…" for large n)
    var a = tokens[0], seq = [a];
    var fill = [];
    for (var i = 1; i < n; i++) fill.push(tokens[1 + ((i - 1) % (tokens.length - 1))]);
    if (fill.length > 3) fill = [fill[0], fill[1], '…'];
    seq = seq.concat(fill); seq.push(last);
    return seq.join(', ');
  }
  var CYCLIC_RULE = {
    days: { 1: 'the day after', 2: 'two days after', '-1': 'the day before', wrap: 'Sunday wraps to Monday.' },
    months: { 1: 'the month after', 2: 'two months after', '-1': 'the month before', wrap: 'December wraps to January.' },
    clock: { 1: 'one hour later', 2: 'two hours later', '-1': 'one hour earlier', wrap: '12 wraps to 1.' },
    compass: { 1: 'one step clockwise from', 2: 'two steps clockwise from', '-1': 'one step anticlockwise from', wrap: 'NW wraps to N.' },
    ring8: { 1: 'one cell clockwise from', 2: 'two cells clockwise from', '-1': 'one cell anticlockwise from', wrap: 'The ring wraps around.' }
  };
  function cyc(tokens, i, step) { var L = tokens.length; return tokens[((i + step) % L + L) % L]; }

  function ruleCard(id, rung, setId, opts) {
    var d = must(id), r = clampInt(rung, 0, d.ladder.length - 1), p = d.ladder[r];
    setId = setId || d.defaultSet; opts = opts || {};
    var title = fullLabel(id, r);
    var tokens = tokensFor(setId), noun = nounFor(setId), n = p.n, rule, keys, example;
    if (id === 'nback.plain') {
      rule = setId === 'grid8' ? 'Press J when the square is in the same place as ' + stepsBack(n) + '.'
        : 'Press J when the ' + noun + ' is the same as ' + stepsBack(n) + '.';
      keys = 'J = match · no press = no match';
      example = seqExample(tokens, n, tokens[0]) + ' → press (' + tokens[0] + ' was ' + (n === 1 ? 'just before' : n + ' back') + ')';
    } else if (id === 'nback.dual') {
      rule = 'Press J when the square\'s place matches ' + stepsBack(n) + '. Press K when the sound matches ' + stepsBack(n) + '. Sometimes both match.';
      keys = 'J = place match · K = sound match · no press = no match';
      var tk = tokensFor(setId);
      example = 'places ' + seqExample(TOKENS.grid8, n, TOKENS.grid8[0]) + ' → J;  sounds ' + seqExample(tk, n, tk[0]) + ' → K';
    } else if (id === 'nback.transform') {
      var step = opts.step || 1, cr = CYCLIC_RULE[setId] || CYCLIC_RULE.days, word = cr[String(step)] || cr[1];
      rule = 'Press J when the ' + noun + ' is ' + word + ' ' + stepsBack(n) + '. ' + cr.wrap;
      var a = setId === 'days' ? 1 : 0, first = tokens[a];
      var ex = [first], fills = [];
      for (var i = 1; i < n; i++) fills.push(tokens[(a + 3 + 2 * i) % tokens.length]);
      if (fills.length > 3) fills = [fills[0], fills[1], '…'];
      ex = ex.concat(fills); ex.push(cyc(tokens, a, step));
      example = ex.join(', ') + ' → press (' + cyc(tokens, a, step) + ' is ' + word + ' ' + first + ')';
      keys = 'J = match · no press = no match';
    } else if (id === 'nback.arith') {
      rule = 'Press J when the answer is the same as the answer ' + (n === 1 ? 'just before' : n + ' steps back') + '. The sums themselves always look different.';
      keys = 'J = same answer · no press = different';
      example = n === 1 ? '3 + 4, 9 − 2 → press (both make 7)' : '3 + 4, ' + (n > 2 ? '9 − 1, …, ' : '9 − 1, ') + '5 + 2 → press (both make 7)';
    } else if (id === 'nback.switch') {
      var what = setId === 'shapes' ? 'shape' : 'digit';
      rule = 'A cue says WHAT or WHERE. Press J when that feature (the ' + what + ', or its place) matches the item ' + (n === 1 ? 'just before' : n + ' steps back') + '. Ignore the other feature.';
      keys = 'J = match on the cued feature · no press = no match';
      example = 'WHERE: ' + (setId === 'shapes' ? 'star' : '7') + ' top-left, ' + (n > 1 ? (setId === 'shapes' ? 'circle' : '2') + ' right, ' : '') + (setId === 'shapes' ? 'ring' : '5') + ' top-left → press (same place)';
    } else if (id === 'rel.steps') {
      var b = p.back;
      if (b === 1) {
        rule = 'Press J when the step from the last number is the same size as the step before it (up or down does not matter). Numbers go up to ' + p.maxNumber + '.';
        example = '3, 6, 9 → press (steps of 3 and 3);  9, 8, 7 → press (1 and 1)';
      } else if (b === 2) {
        rule = 'Press J when the jump from the number 2 back is the same size as the jump just before it. Numbers go up to ' + p.maxNumber + '.';
        example = '3, 6, 9, 8, 7 → press on 7 (9 to 7 is 2; 6 to 8 is 2)';
      } else {
        rule = 'Press J when the jump from the number 3 back is the same size as the jump just before it. Numbers go up to ' + p.maxNumber + '.';
        example = '2, 5, 4, 6, 9 → press on 9 (5 to 9 is 4; 2 to 6 is 4)';
      }
      keys = 'J = equal steps · no press = not equal';
    } else if (d.tier) {
      var t = d.tier, NOUNS = { digits: 'last digits', letters: 'last letters', shapes: 'middle icons', dots: 'last dot groups', bars: 'last bars' };
      var what = NOUNS[setId] || 'last symbols', keyed = setId === 'shapes' || setId === 'bars' || /^glyphs/.test(setId || '');
      var line = 'a row or column';
      var tail = setId === 'shapes' ? 'Only the middle icon of each cell counts.' : 'Only the last symbol of each cell counts.';
      var five = 'a five-cell shape (a plus, or a T in any rotation)';
      // examples in the set's own terms (Phase 4, PQ-11): digits and letters show values, other sets say it in words
      var ex = function (where, digits, letters, words) {
        return where + ' whose ' + what + ' ' + (setId === 'digits' ? 'are ' + digits : (setId === 'letters' ? 'are ' + letters : words)) + ' → yes';
      };
      if (t === 1) { rule = 'Is there ' + line + ' whose ' + what + ' are all the same?'; example = ex('a row', '7, 7, 7', 'K, K, K', 'are all the same'); }
      else if (t === 2) { rule = 'Is there ' + line + ' whose ' + what + ' go up in order (left to right, or top to bottom)?' + (keyed ? ' The order is shown in the key.' : ''); example = ex('a column', '3, 4, 5', 'D, F, G', keyed ? 'follow the order in the key' : 'go up in order'); }
      else if (t === 3) { rule = 'Is there ' + line + ' whose ' + what + ' are all different?'; example = ex('a row', '2, 9, 5', 'B, R, K', 'are all different'); }
      else if (t === 4) { rule = 'The rule at the top says SAME or DIFFERENT. Is there a row, column or diagonal that follows it?'; example = 'SAME: ' + ex('a diagonal', '4, 4, 4', 'M, M, M', 'are all the same'); }
      else if (t === 5) { rule = 'Is there ' + five + ' whose ' + what + ' are all the same?'; example = ex('a plus', '6, 6, 6, 6, 6', 'R, R, R, R, R', 'are all the same'); }
      else if (t === 6) { rule = 'Each cell is one symbol with a shape and a fill. The rule at the top says which feature must be the same along a row or column and which must all differ.'; example = 'same shape, all different fills: three triangles — empty, striped, solid → yes'; tail = ''; }
      else if (t === 7) { rule = 'A 4×4 grid. The rule at the top says SAME or DIFFERENT. Is there a row or column of four that follows it?'; example = 'SAME: ' + ex('a row of four', '8, 8, 8, 8', 'T, T, T, T', 'are all the same'); }
      else { rule = 'Is there ' + five + ' whose ' + what + ' are all different?'; example = ex('a T', '1, 4, 7, 2, 9', 'B, D, K, R, W', 'are all different'); }
      rule += (tail ? ' ' + tail : '') + ' You have ' + fmtSec(p.windowMs) + ' per grid.';
      keys = 'J = yes, there is one · F = no';
    } else if (id === 'rel.stream') {
      rule = 'One cell changes at a time. Press J as soon as a row or column of three shows the same symbol. You have until the next change.';
      keys = 'J = pattern appeared · no press = nothing yet';
      example = 'the top row becomes 4, 4, 4 → press';
    } else if (d.task === 'span') {
      var mem = id === 'span.op' ? 'letter' : (setId === 'digits' ? 'digit' : 'symbol');
      rule = 'Check each sum: is it right? Then remember the ' + mem + ' that follows. At the end, tap the ' + mem + 's ' + (id === 'span.back' ? 'in reverse order' : 'in the order shown') + '. ' + p.setSize + ' per list.';
      keys = 'J = true · F = false · then the keypad';
      example = '7 − 3 = 4 (J), F;  2 + 5 = 8 (F), K → recall ' + (id === 'span.back' ? 'K, F' : 'F, K');
    } else {
      rule = 'Is there a T among the Ls? Answer as soon as you know. ' + p.size + ' symbols, ' + fmtSec(p.windowMs) + ' per display.';
      keys = 'J = T present · F = no T';
      example = 'eleven rotated Ls and one T → J';
    }
    return { title: title, rule: rule, keys: keys, example: example };
  }

  // ---------- run-time set lists ----------
  function setExists(s) { try { return !!(HF.sets && typeof HF.sets.get === 'function' && HF.sets.get(s)); } catch (e) { return false; } }
  function normSet(s) { return (s === 'glyphs' || /^glyphs[A-H]$/.test(s)) ? 'glyphs' : s; }
  /** Sets a track may use in training: HF.sets.forTrack(trackId) when the sets module is loaded, else this
   *  catalog's list (optional sets only if they exist). Glyph families collapse into the 'glyphs' placeholder;
   *  Lab-only sets are never returned. Dual returns its sound-stream sets only (positions are always grid8). */
  function trainingSets(id) {
    var d = must(id), list = null, out = [];
    try { if (HF.sets && typeof HF.sets.forTrack === 'function') list = HF.sets.forTrack(id); } catch (e) { list = null; }
    if (!list || !list.length) list = d.sets.filter(function (s) { return d.optionalSets.indexOf(s) < 0 || setExists(s); });
    list.forEach(function (s) {
      if (!s || s === 'glyphsLab' || /lab/i.test(s)) return;
      if (d.dualVisual && contentFamily(s) !== 'audio') return;
      s = normSet(s);
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out.length ? out : [d.defaultSet];
  }
  function defaultSet(id) {
    var d = must(id), list = trainingSets(id), s = null;
    try { if (HF.sets && typeof HF.sets.defaultFor === 'function') s = HF.sets.defaultFor(id); } catch (e) { s = null; }
    if (s && list.indexOf(normSet(s)) >= 0) return normSet(s);
    return list.indexOf(d.defaultSet) >= 0 ? d.defaultSet : list[0];
  }

  // ---------- block duration estimates ----------
  function estBlockMs(id, p) {
    var d = must(id); p = p || d.ladder[0];
    if (d.task === 'nback') return (20 + p.n) * p.soaMs;
    if (id === 'rel.steps') return (21 + p.back) * p.soaMs;
    if (d.tier) return 20 * (0.6 * p.windowMs + 100);
    if (id === 'rel.stream') return 2000 + 30 * p.changeMs;
    if (d.task === 'span') return 3 * (p.setSize * 3500 + 8000);
    return (p.trials || 20) * (0.5 * p.windowMs + VS_ITI_MS);   // vs.search: half the window to answer + the 500 ms blank
  }

  var api = {
    ids: function () { return IDS.slice(); },
    get: get,
    tracksOfTask: tracksOfTask,
    isNback: isNback,
    rungCount: rungCount,
    maxRung: maxRung,
    params: params,
    nOf: nOf,
    rungForN: rungForN,
    levelLabel: levelLabel,
    fullLabel: fullLabel,
    levelDetail: levelDetail,
    difficulty: difficulty,
    allowedRungs: allowedRungs,
    contentFamily: contentFamily,
    familiesFor: familiesFor,
    gateOpen: gateOpen,
    studyArmKind: studyArmKind,
    ladderGateOpen: ladderGateOpen,
    gateText: gateText,
    ruleCard: ruleCard,
    estBlockMs: estBlockMs,
    trainingSets: trainingSets,
    defaultSet: defaultSet,
    normSet: normSet,
    TIERS: TIERS,
    LESSONS: LESSONS,
    GLYPH_FAMILIES: GLYPH_FAMILIES.slice(),
    LAB_ONLY_SETS: ['glyphsLab'],
    TASKS: ['nback', 'relations', 'span', 'vsearch']
  };
  HF.catalog = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
