/* Long-Horizon — visual search view: is there a T among rotated Ls? (browser only). MIT licence.
 * Uses HF.views.kit (js/tasks/relations/view.js, loaded first). Runner: HF.timing.runDiscrete(spec, view, view.runOpts).
 *
 * HF.views.vsearch.create(root, spec, ctx) → view                  (docs/dev/contracts-ui.md §1, SPEC §4.3)
 *   A square field (spec.field: 100 × 100 units, items 7 units across, centres from the generator; 8 × 8 or 10 × 10
 *   invisible grid) drawn as ONE SVG whose viewBox is exactly the field, so the 100 units span the whole box. The box
 *   is never narrower than spec.field.minFieldPx (360 CSS px; full-bleed on a 360 px phone), hence items ≥ 25 px and
 *   strokes of 1 unit ≥ 3.6 px; larger screens get up to 38rem (or what the height allows).
 *   Every item is a T or an offset L filling the 7-unit item box (two strokes of equal length; the L's upright stands
 *   1.1 units in from the end of its foot, so its junction is not a plain corner) at rotation 0/90/180/270. A small
 *   fixation cross shows in the blank between displays and never together with the items.
 *   Pads: "Absent" (no, F, left) and "Present" (match, J). No countdown.
 *   view = { kind: 'discrete', type: 'vsearch', trackId, spec, el, pads, runOpts: { keys: ['match', 'no'] },
 *            prepare(trial) (writes the items' markup into the hidden layer), show(trial), hide(trial) (class
 *            toggles only), feedback(outcome, key?), reset(spec), destroy() }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var views = HF.views || (HF.views = {});

  // item shapes in field units, centred on 0,0, stroke 1 unit (1/7 of the item): each drawing fills the generator's
  // 7-unit item box (±3.5 including the stroke), so items are 25.2 px at the 360 px minimum field.
  // T: bar 7 + upright 6.5; L: foot 7 + upright 6.5, the upright 1.1 units in from the foot's end (offset L).
  var T_PATH = 'M-3.5 -3H3.5M0 -3V3.5';
  var L_PATH = 'M-2.4 -3.5V3M-3.5 3H3.5';

  function kitOf() {
    if (!views.kit) throw new Error('HF.views.vsearch needs js/tasks/relations/view.js (HF.views.kit) loaded first');
    return views.kit;
  }
  function num(x) { return Math.round(Number(x) * 100) / 100; }

  function itemsMarkup(stim) {
    var items = (stim && stim.items) || [], s = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      s += '<path d="' + (it.kind === 'T' ? T_PATH : L_PATH) + '" transform="translate(' + num(it.x) + ' ' + num(it.y) + ')' +
        (it.rot ? ' rotate(' + num(it.rot) + ')' : '') + '"/>';
    }
    return s;
  }

  function create(root, spec, ctx) {
    if (!root || !spec) throw new Error('HF.views.vsearch.create(root, spec, ctx): root and spec are required');
    var kit = kitOf(), el = kit.el;
    ctx = ctx || {};
    var v = { kind: 'discrete', type: 'vsearch', trackId: spec.trackId || 'vs.search', spec: spec, ctx: ctx, root: root,
      pads: [], runOpts: { keys: ['match', 'no'] } };
    v.el = el('div', 'hf-task hf-v hf-v--vs', { role: 'group', 'aria-label': 'Visual search' });
    var stage = el('div', 'hf-v__stage', { 'aria-hidden': 'true' });
    var field = el('div', 'hf-vs is-off');
    var layer = null;
    function buildField(sp) {
      var f = sp.field || { w: 100, h: 100 };
      var w = f.w > 0 ? f.w : 100, h = f.h > 0 ? f.h : 100;
      field.style.setProperty('--hf-vs-min', (f.minFieldPx > 0 ? f.minFieldPx : 360) + 'px');
      field.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
        '<g class="hf-vs__fix"><path d="M' + (w / 2 - 2.5) + ' ' + (h / 2) + 'h5M' + (w / 2) + ' ' + (h / 2 - 2.5) + 'v5"/></g>' +
        '<g class="hf-vs__items"></g></svg>';
      layer = field.querySelector('.hf-vs__items');
    }
    buildField(spec);
    stage.appendChild(field);
    v.el.appendChild(stage);
    var P = kit.pads(ctx, [{ id: 'no', label: 'Absent' }, { id: 'match', label: 'Present' }], 'Answer: T absent or present');
    var padsBox = el('div', 'hf-v__pads');
    padsBox.appendChild(P.el);
    v.el.appendChild(padsBox);
    v.pads = P.pads;
    var fb = kit.feedback(P.byKey, 'match');
    var echoOff = kit.pressEcho(P.byKey, fb.pressed);
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(v.el);

    v.prepare = function (trial) { layer.innerHTML = itemsMarkup(trial && trial.stim); };
    v.show = function () { field.classList.remove('is-off'); };
    v.hide = function () { field.classList.add('is-off'); };
    v.feedback = function (outcome, key) { return fb(outcome, key); };
    v.reset = function (sp) { v.spec = sp; v.trackId = sp.trackId || 'vs.search'; field.classList.add('is-off'); buildField(sp); };
    v.destroy = function () {
      fb.cancel();
      echoOff();
      if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
      v.pads = [];
    };
    return v;
  }

  views.vsearch = { create: create, itemsMarkup: itemsMarkup };
})(typeof window !== 'undefined' ? window : globalThis);
