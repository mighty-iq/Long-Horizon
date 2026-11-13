/* Long-Horizon — Lab view: spatial memory updating (HF.views['lab.update']). Browser only, ES2019, MIT. Owner: P2.
   Spec: js/lab/tests/update.js. A 3×3 grid; one coloured square at a time (colour + pattern from HF.lab.PALETTE, never
   colour alone) for stepMs (2.0 / 2.4 / 2.8 s by load), then a 0.5 s gap; displays are frame-counted (HF.labKit.present)
   and a late paint or a dropped frame while a square is on screen voids the trial. Then, for each colour (random
   order), "where was it last?": tap a cell or press 1–9 (cells numbered in reading order during the questions).

   create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }
     log: { trials: [ { i, answers: [ { probe: j, response: cell|null, rt } ], voided } ], paused, pauses, aborted }
     Pausing voids the trial in progress. Practice specs show the right last positions after the questions.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  HF.views = HF.views || {};

  function K() { return HF.labKit; }

  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var k = K(), h = k.h;
    var practice = k.isPractice(spec, ctx), feedback = k.wantsFeedback(spec, ctx);
    var S = null, F = null, destroyed = false, offs = [];
    var palette = spec.palette || (HF.lab && HF.lab.PALETTE) || [];
    var gapMs = spec.gapMs != null ? spec.gapMs : 500;
    var n = spec.grid || 3;

    function colourOf(tr, k2) { return palette[tr.colours[k2]] || palette[0]; }

    function run(ctx2) {
      ctx2 = ctx2 || {};
      F = k.frameUI(rootEl, { title: practice ? 'Practice' : (ctx.title || 'Updating'), test: 'update', cls: 'hf-lt--update', onPause: function (r) { if (S) S.pause(r); } });
      S = k.session({});
      var out = { trials: [], paused: false, pauses: [], aborted: false };
      var trials = spec.trials || [];
      return k.ensureInterval().then(function (interval) {
        return new Promise(function (resolve) {
          var idx = 0;
          function finish(aborted) {
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
              var tr = trials[idx];
              F.setProgress('Round ' + (idx + 1) + ' of ' + trials.length + ' · ' + tr.load + ' colours');
              if (typeof ctx2.onProgress === 'function') ctx2.onProgress(idx, trials.length);
              trial(tr, interval).then(function (res) {
                if (res === k.STOP) return finish(true);
                out.trials.push(res === k.VOID ? { i: tr.i, answers: [], voided: true } : res);
                idx++;
                var after = (feedback && res !== k.VOID) ? explain(tr, res) : Promise.resolve();
                after.then(function () { k.clear(F.stage); k.clear(F.answer); return S.wait(600); }).then(next);
              });
            });
          }
          next();
        });
      });
    }

    function trial(tr, interval) {
      k.clear(F.stage); k.clear(F.answer); F.say('');
      var g = k.cellGrid(n, { label: 'Grid of nine squares', cls: 'hf-cg--update' });
      var q = h('div', { 'class': 'hf-up__q' });
      F.stage.appendChild(g.el);
      F.answer.appendChild(q);
      q.appendChild(h('p', { 'class': 'hf-lt__q' }, ['Watch: ' + tr.load + ' colours. Remember where each one is last.']));
      F.setHint('');
      var rec = { i: tr.i, answers: [], voided: false };
      var steps = tr.steps || [];
      var s = 0, bad = false;
      return S.wait(1200).then(function stepLoop() {
        if (S.stopped) return k.STOP;
        if (S.paused) return k.VOID;
        if (s >= steps.length) return probes();
        var st = steps[s];
        var entry = colourOf(tr, st.colour);
        return k.present(S, function () { g.fill(st.cell, k.patch(entry)); g.mark(st.cell, 'is-lit', true); },
          function () { g.fill(st.cell, null); g.mark(st.cell, 'is-lit', false); }, tr.stepMs || 2400, interval)
          .then(function (m) {
            if (m === k.STOP) return k.STOP;
            if (m === k.VOID) return k.VOID;
            if (m.voided) bad = true;
            rec.stalls = (rec.stalls || 0) + (m.stalls || 0);
            return S.wait(gapMs).then(function () { s++; return stepLoop(); });
          });
      });

      function probes() {
        var j = 0;
        g.cells.forEach(function (c, ci) { g.tag(ci, ci + 1); });
        g.el.classList.add('is-numbered');
        function one() {
          if (j >= tr.probes.length) {
            if (bad) rec.voided = true;
            return Promise.resolve(rec);
          }
          var p = tr.probes[j];
          var entry = colourOf(tr, p.colour);
          return S.trial(function (ctl) {
            k.clear(q);
            q.appendChild(h('div', { 'class': 'hf-up__ask' }, [
              k.patch(entry, { cls: 'hf-up__swatch', label: true }),
              h('p', { 'class': 'hf-lt__q' }, ['Where was ', h('strong', null, [entry.name + ' (' + entry.pattern + ')']), ' last?'])
            ]));
            F.setHint('Tap the square, or press 1–9 (numbers shown in the grid). Question ' + (j + 1) + ' of ' + tr.probes.length + '.');
            var onset = null, offKeys = null;
            function pick(cell, tEv) {
              if (onset === null) return;
              cleanup();
              ctl.done({ probe: j, response: cell, rt: Math.round((tEv - onset) * 10) / 10 });
            }
            function cleanup() { if (offKeys) offKeys(); offKeys = null; g.enable(false); g.el.removeEventListener('click', onClick, true); }
            function onClick(e) {
              var b = e.target && e.target.closest ? e.target.closest('[data-cell]') : null;
              if (!b || onset === null) return;
              e.preventDefault(); e.stopPropagation();
              pick(+b.getAttribute('data-cell'), k.evTime(e));
            }
            g.el.addEventListener('click', onClick, true);
            offKeys = k.keys(function (e, tEv) {
              var d = k.digitOf(e);
              if (d && d <= n * n) { e.preventDefault(); pick(d - 1, tEv); }
            });
            ctl.onCancel(cleanup);
            g.enable(true);
            k.frame().then(function (ts) { if (!ctl.cancelled) onset = ts; });
          }).then(function (res) {
            if (res === k.STOP || res === k.VOID) return res;
            rec.answers.push(res);
            j++;
            return one();
          });
        }
        return one();
      }
    }

    function explain(tr, res) {
      k.clear(F.stage); k.clear(F.answer);
      var g = k.cellGrid(n, { label: 'Where each colour was last', cls: 'hf-cg--update' });
      tr.probes.forEach(function (p) { g.fill(p.answer, k.patch(colourOf(tr, p.colour))); });
      F.stage.appendChild(g.el);
      var right = res.answers.filter(function (a) { var p = tr.probes[a.probe]; return p && a.response === p.answer; }).length;
      F.say(right + ' of ' + tr.probes.length + ' right. Here is where each colour was last.', right === tr.probes.length ? 'good' : 'info');
      F.setHint('');
      var row = h('div', { 'class': 'hf-actions hf-lt__acts' });
      F.answer.appendChild(row);
      return k.waitNext(row, 'Next').then(function () { F.say(''); });
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

  HF.views['lab.update'] = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
