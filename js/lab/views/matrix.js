/* Long-Horizon — Lab view: generated 3×3 matrices (HF.views['lab.matrix']). Browser only, ES2019, MIT. Owner: P2.
   Uses HF.labKit (js/lab/views/sspan.js) and the vector description from js/lab/tests/matrix.js:
   each shape is HF.lab.tests['lab.matrix'].shapePath(type) drawn with
   transform="translate(x y) rotate(rot) scale(r/45) translate(-50 -50)" in a 0 0 100 100 cell.
   Fills none | solid | lines | dots | grid are black-and-white; patterned fills are a clipped, unrotated pattern rect
   (patterns never rotate with the shape), with a stroke of 3 % of the cell. No colour anywhere in this test.

   create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }
     Answer: tap an option or press 1–8 to choose, then Confirm (Enter or Space, or tap the chosen option again).
     45 s per puzzle (spec.windowMs; 2 min per tutorial item) with a calm countdown; at the cap the item ends:
     { response: chosen index | null, timedOut: true } (scored as wrong, research/04).
     log (SPEC §4.3): { answers: [ { i, response: 0–7 | null, rt, voided, timedOut } ], paused, pauses, aborted }
     Practice specs (the rule tutorial) show the rule sentences (trial.explain) after each answer.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  HF.views = HF.views || {};
  var seq = 0;

  function K() { return HF.labKit; }
  function test() { return HF.lab && HF.lab.tests && HF.lab.tests['lab.matrix']; }
  function shapePath(type) {
    var t = test();
    if (t && typeof t.shapePath === 'function') return t.shapePath(type);
    return 'M50 5A45 45 0 1 1 49.99 5Z';
  }

  /** shared pattern definitions (one per document) */
  function ensureDefs() {
    var doc = root.document;
    if (doc.getElementById('hf-mx-defs')) return;
    var S = K().svg;
    var defs = S('defs', null, [
      S('pattern', { id: 'hf-mx-lines', patternUnits: 'userSpaceOnUse', width: 5, height: 5 }, [
        S('path', { d: 'M-1 1L1 -1M0 5L5 0M4 6L6 4', 'class': 'hf-mx-inkline', 'stroke-width': 1.4 })
      ]),
      S('pattern', { id: 'hf-mx-dots', patternUnits: 'userSpaceOnUse', width: 5, height: 5 }, [
        S('circle', { cx: 2.5, cy: 2.5, r: 1.15, 'class': 'hf-mx-inkfill' })
      ]),
      S('pattern', { id: 'hf-mx-grid', patternUnits: 'userSpaceOnUse', width: 5, height: 5 }, [
        S('path', { d: 'M0 0.5H5M0.5 0V5', 'class': 'hf-mx-inkline', 'stroke-width': 1.1 })
      ])
    ]);
    var holder = S('svg', { id: 'hf-mx-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false', style: 'position:absolute;width:0;height:0;overflow:hidden' }, [defs]);
    doc.body.appendChild(holder);
  }

  function drawCell(cell, o) {
    o = o || {};
    var S = K().svg, kids = [];
    (cell && cell.shapes || []).forEach(function (s) {
      var r = s.r > 0 ? s.r : 20;
      var tf = 'translate(' + s.x + ' ' + s.y + ') rotate(' + (s.rot || 0) + ') scale(' + (r / 45) + ') translate(-50 -50)';
      var d = shapePath(s.type);
      var sw = (3 * 45 / r).toFixed(2);
      if (s.fill === 'lines' || s.fill === 'dots' || s.fill === 'grid') {
        var id = 'hf-mxc-' + (++seq);
        kids.push(S('clipPath', { id: id }, [S('path', { d: d, transform: tf })]));
        kids.push(S('rect', { x: 0, y: 0, width: 100, height: 100, fill: 'url(#hf-mx-' + s.fill + ')', 'clip-path': 'url(#' + id + ')' }));
        kids.push(S('path', { d: d, transform: tf, 'class': 'hf-mx-shape', fill: 'none', 'stroke-width': sw }));
      } else {
        kids.push(S('path', { d: d, transform: tf, 'class': 'hf-mx-shape' + (s.fill === 'solid' ? ' is-solid' : ''), 'stroke-width': sw }));
      }
    });
    return S('svg', { viewBox: '0 0 100 100', 'class': 'hf-mx__svg', 'aria-hidden': 'true', focusable: 'false' }, kids);
  }

  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var k = K(), h = k.h;
    var practice = k.isPractice(spec, ctx), feedback = k.wantsFeedback(spec, ctx);
    var S = null, F = null, destroyed = false, offs = [];

    function run(ctx2) {
      ctx2 = ctx2 || {};
      ensureDefs();
      F = k.frameUI(rootEl, { title: practice ? 'Rule tutorial' : (ctx.title || 'Puzzles'), test: 'matrix', cls: 'hf-lt--matrix', onPause: function (r) { if (S) S.pause(r); } });
      S = k.session({});
      var trials = spec.trials || [];
      var out = { answers: [], paused: false, pauses: [], aborted: false };
      var clock = k.countdown(F, practice ? (spec.windowMs || 120000) : (spec.windowMs || 45000));
      return k.ensureInterval().then(function () {
        return new Promise(function (resolve) {
          var idx = 0;
          function finish(aborted) {
            clock.remove();
            var L = S.log();
            out.paused = L.paused; out.pauses = L.pauses; out.aborted = !!aborted;
            S.destroy();
            resolve(out);
          }
          function next() {
            if (destroyed) return finish(true);
            S.ready().then(function (ok) {
              if (!ok) return finish(true);
              if (idx >= trials.length) return finish(false);
              var t = trials[idx];
              F.setProgress((practice ? 'Example ' : 'Puzzle ') + (idx + 1) + ' of ' + trials.length);
              if (typeof ctx2.onProgress === 'function') ctx2.onProgress(idx, trials.length);
              item(t).then(function (res) {
                if (res === k.STOP) return finish(true);
                if (res === k.VOID) out.answers.push({ i: t.i, response: null, rt: null, voided: true });
                else out.answers.push(res);
                idx++;
                var after = (feedback && res !== k.VOID) ? explain(t, res) : Promise.resolve();
                after.then(function () { return S.wait(spec.itiMs != null ? spec.itiMs : 500); }).then(next);
              });
            });
          }
          next();
        });
      });

      function item(t) {
        return S.trial(function (ctl) {
          k.clear(F.stage); k.clear(F.answer); F.say('');
          var cells = t.stim.cells || [];
          var grid = h('div', { 'class': 'hf-mx', role: 'img', 'aria-label': 'Puzzle: a 3 by 3 grid of shapes; the bottom-right cell is missing' });
          for (var c = 0; c < 9; c++) {
            if (c < 8) grid.appendChild(h('div', { 'class': 'hf-mx__cell' }, [drawCell(cells[c])]));
            else grid.appendChild(h('div', { 'class': 'hf-mx__cell hf-mx__cell--blank', 'aria-hidden': 'true' }, [h('span', null, ['?'])]));
          }
          var chosen = null, onset = null, timer = null, offKeys = null;
          var opts = (t.stim.options || []).map(function (o, j) {
            var b = h('button', { type: 'button', 'class': 'hf-mx__opt', 'aria-pressed': 'false', 'aria-label': 'Option ' + (j + 1), 'data-opt': String(j) }, [
              h('span', { 'class': 'hf-mx__num', 'aria-hidden': 'true' }, [String(j + 1)]),
              drawCell(o)
            ]);
            b.addEventListener('click', function (e) {
              if (onset === null) return;
              if (chosen === j) { confirm(k.evTime(e)); return; }
              choose(j);
            });
            return b;
          });
          var optGrid = h('div', { 'class': 'hf-mx__opts', role: 'group', 'aria-label': 'Answer options 1 to 8' }, opts);
          var confirmBtn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary hf-mx__confirm', disabled: true }, [
            h('span', { 'class': 'hf-btn__label' }, ['Confirm']), h('kbd', { 'class': 'hf-kbd', 'aria-hidden': 'true' }, ['Enter'])
          ]);
          confirmBtn.addEventListener('click', function (e) { confirm(k.evTime(e)); });
          var wrap = h('div', { 'class': 'hf-mx__wrap', style: 'visibility:hidden' }, [grid, h('div', { 'class': 'hf-mx__side' }, [optGrid, h('div', { 'class': 'hf-mx__acts' }, [confirmBtn])])]);
          F.stage.appendChild(wrap);
          F.setHint('Press 1–8 or tap an option, then Confirm.');

          function choose(j) {
            chosen = j;
            opts.forEach(function (b, q) { b.setAttribute('aria-pressed', q === j ? 'true' : 'false'); b.classList.toggle('is-chosen', q === j); });
            confirmBtn.disabled = false;
          }
          function cleanup() { clearTimeout(timer); if (offKeys) offKeys(); offKeys = null; clock.stop(); }
          function confirm(tEv) {
            if (chosen === null || onset === null) return;
            cleanup();
            ctl.done({ i: t.i, response: chosen, rt: Math.round((tEv - onset) * 10) / 10, voided: false, timedOut: false });
          }
          ctl.onCancel(cleanup);
          offKeys = k.keys(function (e, tEv) {
            if (onset === null) return;
            var d = k.digitOf(e);
            if (d && d <= opts.length) { e.preventDefault(); choose(d - 1); try { opts[d - 1].focus({ preventScroll: true }); } catch (er) { /* ignore */ } return; }
            if (e.key === 'Enter' || e.code === 'Space') {
              if (e.target && e.target.tagName === 'BUTTON' && e.target !== confirmBtn && !e.target.hasAttribute('data-opt')) return;
              e.preventDefault();
              confirm(tEv);
            }
          });
          k.frame().then(function (ts) {
            if (ctl.cancelled) return;
            wrap.style.visibility = '';
            onset = ts;
            clock.start(ts);
            timer = setTimeout(function () {
              cleanup();
              ctl.done({ i: t.i, response: chosen, rt: null, voided: false, timedOut: true });
            }, practice ? (spec.windowMs || 120000) : (spec.windowMs || 45000));
          });
        });
      }

      function explain(t, res) {
        var right = res.response === t.answer && !res.timedOut;
        var opts = F.stage.querySelectorAll('.hf-mx__opt');
        for (var j = 0; j < opts.length; j++) {
          opts[j].disabled = true;
          if (j === t.answer) opts[j].classList.add('is-answer');
        }
        var lines = (t.explain || []).slice();
        F.say(res.timedOut ? 'Time is up. The answer is option ' + (t.answer + 1) + '.' : (right ? 'Right: option ' + (t.answer + 1) + '.' : 'Not quite: the answer is option ' + (t.answer + 1) + '.'), right ? 'good' : 'info');
        var box = h('div', { 'class': 'hf-lt__explain' }, [
          lines.length ? h('ul', { 'class': 'hf-lt__why' }, lines.map(function (s2) { return h('li', null, [s2]); })) : null
        ]);
        var acts = F.stage.querySelector('.hf-mx__acts');
        if (acts) { k.clear(acts); acts.appendChild(box); } else F.answer.appendChild(box);
        var row = h('div', { 'class': 'hf-actions' });
        box.appendChild(row);
        return k.waitNext(row, 'Next');
      }
    }

    return {
      run: run,
      destroy: function () {
        destroyed = true;
        offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
        if (S) { S.stop(); S.destroy(); }
        if (F && F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el);
      }
    };
  }

  HF.views['lab.matrix'] = { create: create, drawCell: drawCell, ensureDefs: ensureDefs };
})(typeof window !== 'undefined' ? window : globalThis);
