/* Long-Horizon — near / mid / far per user (pure, no DOM). MIT licence. PLAN §6, research/04 §1.3.

   HF.lab.levels(records, opts?) → { [labTestId]: { level: 'near'|'mid'|'far', closer: 'near'|'mid'|null, note } }
     for every known Lab test id (HF.lab.IDS plus any other registered test).
   HF.lab.trained(records, opts?) → { nback, grid, stream, steps, switch, span, vsearch } block counts per trained family.
   A family counts as trained with ≥ opts.minBlocks (default 10) blocks whose role is not 'probe' or 'tutorial'.
   Rules (PLAN §6):
   - near: lab.nback for n-back trainees (any nback.* track), lab.rel for Relation Grid trainees (rel.grid.*; Relation
     Stream counts too: same grid and line rules), lab.sspan for Span trainees (same paradigm, other content).
     Equal Steps (rel.steps) has no near probe: for Equal-Steps-only trainees lab.rel is mid, with a note.
   - mid: the other WM tests (lab.sspan, lab.update, lab.bind, and the probes of untrained paradigms) and lab.switch
     (closer: 'near' for Switch trainees, nback.switch).
   - far: lab.matrix, lab.series, lab.graph (closer: 'mid' for relational-integration trainees: grid, stream or steps,
     because RI rules overlap with matrix rules).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var lab = HF.lab || (HF.lab = {});

  var NOT_TRAINING = { probe: true, tutorial: true };

  function familyOf(trackId) {
    var t = String(trackId || ''), f = [];
    if (t.indexOf('nback.') === 0) f.push('nback');
    if (t === 'nback.switch') f.push('switch');
    if (t.indexOf('rel.grid') === 0) f.push('grid');
    if (t === 'rel.stream') f.push('stream');
    if (t === 'rel.steps') f.push('steps');
    if (t.indexOf('span.') === 0) f.push('span');
    if (t === 'vs.search') f.push('vsearch');
    return f;
  }

  function trained(records, opts) {
    var c = { nback: 0, grid: 0, stream: 0, steps: 0, 'switch': 0, span: 0, vsearch: 0 };
    ((records && records.blocks) || []).forEach(function (b) {
      if (!b || NOT_TRAINING[b.role]) return;
      familyOf(b.trackId).forEach(function (f) { c[f]++; });
    });
    return c;
  }

  function levels(records, opts) {
    var lab = HF.lab;
    opts = opts || {};
    var min = opts.minBlocks || 10;
    var c = trained(records);
    var has = function (f) { return c[f] >= min; };
    var ri = has('grid') || has('stream') || has('steps');
    var out = {};
    function set(id, level, closer, note) { out[id] = { level: level, closer: closer || null, note: note }; }

    set('lab.nback', has('nback') ? 'near' : 'mid', null, has('nback')
      ? 'Near: you trained n-back (' + c.nback + ' blocks); this probe uses glyphs you never trained with.'
      : 'Mid: no n-back training logged, so this is an untrained memory task for you.');

    if (has('grid') || has('stream')) {
      set('lab.rel', 'near', null, 'Near: you trained the Relation Grid or Stream (' + (c.grid + c.stream) + ' blocks); this probe uses content you never trained with.');
    } else if (has('steps')) {
      set('lab.rel', 'mid', null, 'Mid: Equal Steps has no near probe yet; the relation probe is a different relational task for you.');
    } else {
      set('lab.rel', 'mid', null, 'Mid: no relational training logged, so this is an untrained memory task for you.');
    }

    set('lab.sspan', has('span') ? 'near' : 'mid', null, has('span')
      ? 'Near: you trained Span (' + c.span + ' blocks); this test uses spatial content you never trained with.'
      : 'Mid: a working-memory task you did not train (storage plus processing).');
    set('lab.update', 'mid', null, 'Mid: a working-memory task you did not train (updating).');
    set('lab.bind', 'mid', null, 'Mid: a working-memory task you did not train (binding).');
    set('lab.switch', 'mid', has('switch') ? 'near' : null, has('switch')
      ? 'Mid, closer to near: you trained the Switch version of n-back (' + c['switch'] + ' blocks).'
      : 'Mid: task switching, not trained.');
    ['lab.matrix', 'lab.series', 'lab.graph'].forEach(function (id) {
      set(id, 'far', ri ? 'mid' : null, ri
        ? 'Far, closer to mid: your relational training uses rules that overlap with this kind of puzzle.'
        : 'Far: a reasoning test, unlike anything you trained.');
    });
    // any other registered test keeps its designed role
    Object.keys(lab.tests || {}).forEach(function (id) {
      if (!out[id]) set(id, lab.tests[id].defaultLevel || 'mid', null, 'Designed role of this test.');
    });
    return out;
  }

  lab.levels = levels;
  lab.trained = trained;
  if (typeof module === 'object' && module.exports) module.exports = levels;
})(typeof window !== 'undefined' ? window : globalThis);
