/* Long-Horizon — Lab view: location–colour binding (HF.views['lab.bind'], Extended configuration). Browser only, ES2019,
   MIT. Owner: P2. Spec: js/lab/tests/bind.js. Colour patches (colour + pattern + name, HF.lab.PALETTE) appear one at a
   time on a 3×3 grid for showMs (1.5 s, frame-counted) with a 0.5 s gap; a late paint or a dropped frame while a patch
   is on screen voids the trial. Then each shown cell is outlined in turn: "which colour was here?" — answer with the
   option buttons (this trial's colours, palette order, each with its pattern and name) or keys 1–n.

   create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }
     log: { trials: [ { i, answers: [ { probe: j, response: paletteIndex|null, rt } ], voided } ], paused, pauses, aborted }
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
    var n = spec.grid || 3, showMs = spec.showMs || 1500, gapMs = spec.gapMs != null ? spec.gapMs : 500;

    function run(ctx2) {
      ctx2 = ctx2 || {};
      F = k.frameUI(rootEl, { title: practice ? 'Practice' : (ctx.title || 'Colour and place'), test: 'bind', cls: 'hf-lt--bind', onPause: function (r) { if (S) S.pause(r); } });
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
              F.setProgress('Round ' + (idx + 1) + ' of ' + trials.length + ' · ' + tr.setSize + ' colours');
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
      var g = k.cellGrid(n, { label: 'Grid of nine squares', cls: 'hf-cg--bind' });
      var q = h('div', { 'class': 'hf-bd__q' });
      F.stage.appendChild(g.el);
      F.answer.appendChild(q);
      q.appendChild(h('p', { 'class': 'hf-lt__q' }, ['Watch: ' + tr.setSize + ' colours, one at a time. Remember which colour was where.']));
      F.setHint('');
      var rec = { i: tr.i, answers: [], voided: false };
      var s = 0, bad = false;
      return S.wait(1200).then(function itemLoop() {
        if (S.stopped) return k.STOP;
        if (S.paused) return k.VOID;
        if (s >= tr.items.length) return probes();
        var it = tr.items[s];
        var entry = palette[it.colour];
        return k.present(S, function () { g.fill(it.cell, k.patch(entry)); g.mark(it.cell, 'is-lit', true); },
          function () { g.fill(it.cell, null); g.mark(it.cell, 'is-lit', false); }, showMs, interval)
          .then(function (m) {
            if (m === k.STOP || m === k.VOID) return m;
            if (m.voided) bad = true;
            rec.stalls = (rec.stalls || 0) + (m.stalls || 0);
            return S.wait(gapMs).then(function () { s++; return itemLoop(); });
          });
      });

      function probes() {
        var j = 0;
        var options = (tr.options || []).slice();
        function one() {
          if (j >= tr.probes.length) { if (bad) rec.voided = true; return Promise.resolve(rec); }
          var p = tr.probes[j];
          return S.trial(function (ctl) {
            k.clear(q);
            g.cells.forEach(function (c, ci) { g.mark(ci, 'is-asked', ci === p.cell); g.tag(ci, ci === p.cell ? '?' : ''); });
            var onset = null, offKeys = null;
            var btns = options.map(function (pi, oi) {
              var entry = palette[pi];
              var b = h('button', { type: 'button', 'class': 'hf-bd__opt', 'data-opt': String(pi) }, [
                h('span', { 'class': 'hf-bd__num', 'aria-hidden': 'true' }, [String(oi + 1)]),
                k.patch(entry),
                h('span', { 'class': 'hf-bd__name' }, [entry.name]),
                h('span', { 'class': 'hf-bd__pat' }, [entry.pattern])
              ]);
              b.addEventListener('click', function (e) { pick(pi, k.evTime(e)); });
              return b;
            });
            q.appendChild(h('p', { 'class': 'hf-lt__q' }, ['Which colour was in the square with the question mark?']));
            q.appendChild(h('div', { 'class': 'hf-bd__opts', role: 'group', 'aria-label': 'Colours' }, btns));
            F.setHint('Tap a colour or press 1–' + options.length + '. Question ' + (j + 1) + ' of ' + tr.probes.length + '.');
            function cleanup() { if (offKeys) offKeys(); offKeys = null; btns.forEach(function (b) { b.disabled = true; }); }
            function pick(pi, tEv) {
              if (onset === null) return;
              cleanup();
              ctl.done({ probe: j, response: pi, rt: Math.round((tEv - onset) * 10) / 10 });
            }
            offKeys = k.keys(function (e, tEv) {
              var d = k.digitOf(e);
              if (d && d <= options.length) { e.preventDefault(); pick(options[d - 1], tEv); }
            });
            ctl.onCancel(cleanup);
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
      var g = k.cellGrid(n, { label: 'Which colour was where', cls: 'hf-cg--bind' });
      tr.items.forEach(function (it) { g.fill(it.cell, k.patch(palette[it.colour])); });
      F.stage.appendChild(g.el);
      var right = res.answers.filter(function (a) { var p = tr.probes[a.probe]; return p && a.response === p.answer; }).length;
      F.say(right + ' of ' + tr.probes.length + ' right. Here is which colour was where.', right === tr.probes.length ? 'good' : 'info');
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

  HF.views['lab.bind'] = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
