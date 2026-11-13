/* Long-Horizon — Lab view: cued digit task switching (HF.views['lab.switch']). Browser only, ES2019, MIT. Owner: P2.
   Spec: js/lab/tests/switch.js (Cao et al. 2026's outcome task, exploratory). Each block runs on the core discrete
   runner (HF.timing.runDiscrete: rAF onsets, event.timeStamp RTs, voiding, pause) with this view's prepare/show/hide.
   Cue = colour + word + frame shape (never colour alone): LOW · HIGH in a square (Okabe–Ito blue), ODD · EVEN in a
   diamond (Okabe–Ito orange). Keys: F (left, logical 'no') = LOW / ODD, J (right, 'match') = HIGH / EVEN; touch pads
   in the same places (fixed: not mirrored for left-handed players, the mapping is spatial). Timing (Cao): fixation
   100 ms → digit until the answer (max 3 s) → blank 50 ms (itiMs 150 = blank 50 + fixation 100).

   Flow per block (spec.blocks[k]): its instructions → its practice trials (block.practice, with feedback) → the scored
   trials spec.trials[from…to] (no feedback). Practice-only specs (spec.practice) run every block with feedback.
   create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy(), prepare/show/hide (runner view) }
   log (SPEC §4.3): { answers: [ { i, response: 'no'|'match'|null, rt, voided, timedOut } ] (81, all blocks),
                      paused, pauses, aborted, frame, blocks: [ { id, n, paused } ] }
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  HF.views = HF.views || {};

  function K() { return HF.labKit; }

  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var k = K(), h = k.h;
    var practiceOnly = k.isPractice(spec, ctx);
    var F = null, destroyed = false, offs = [], fixTimer = null;
    var cues = spec.cues || {};
    var params = spec.params || {};
    var blankMs = params.blankMs != null ? params.blankMs : 50;

    // prepared stimulus
    var stim = null, frameEl = null, wordEl = null, digitEl = null, fixEl = null, fbEl = null, pads = null;

    function buildStage() {
      k.clear(F.stage); k.clear(F.answer);
      frameEl = h('div', { 'class': 'hf-sw__frame' });
      wordEl = h('span', { 'class': 'hf-sw__word' });
      digitEl = h('span', { 'class': 'hf-sw__digit hf-num' });
      fixEl = h('span', { 'class': 'hf-sw__fix', 'aria-hidden': 'true' }, ['+']);
      fbEl = h('p', { 'class': 'hf-sw__fb', 'aria-live': 'polite' });
      stim = h('div', { 'class': 'hf-sw__stim', 'data-show': 'fix' }, [frameEl, h('div', { 'class': 'hf-sw__inner' }, [wordEl, digitEl]), fixEl]);
      F.stage.appendChild(h('div', { 'class': 'hf-sw' }, [stim, fbEl]));
      var C = HF.ui && HF.ui.c;
      var left = (cues.magnitude && cues.magnitude.left || 'LOW') + ' / ' + (cues.parity && cues.parity.left || 'ODD');
      var right = (cues.magnitude && cues.magnitude.right || 'HIGH') + ' / ' + (cues.parity && cues.parity.right || 'EVEN');
      pads = C ? C.pads({ pads: [
        { id: 'no', label: left, key: k.keyLabel('no', 'F'), kind: 'no', icon: false },
        { id: 'match', label: right, key: k.keyLabel('match', 'J'), kind: 'yes', icon: false }
      ], fixed: true, label: 'Answer: left or right' }) : h('div');
      pads.classList.add('hf-sw__pads');
      F.answer.appendChild(pads);
      F.setHint('F (left) = LOW or ODD · J (right) = HIGH or EVEN');
    }

    // ---- runner view (called by HF.timing.runDiscrete) ----
    var view = {
      prepare: function (t) {
        var cue = cues[t.stim.task] || {};
        stim.setAttribute('data-task', t.stim.task);
        stim.setAttribute('data-frame', cue.frame || (t.stim.task === 'parity' ? 'diamond' : 'square'));
        // the cue colour comes from css/lab.css (--hf-lab-cue-a / -b, theme-aware); spec cue.color is the light value
        wordEl.textContent = cue.word || (t.stim.task === 'parity' ? 'ODD · EVEN' : 'LOW · HIGH');
        digitEl.textContent = String(t.stim.digit);
      },
      show: function () {
        clearTimeout(fixTimer);
        stim.setAttribute('data-show', 'stim');
      },
      hide: function () {
        stim.setAttribute('data-show', 'blank');
        clearTimeout(fixTimer);
        fixTimer = setTimeout(function () { if (stim.getAttribute('data-show') === 'blank') stim.setAttribute('data-show', 'fix'); }, blankMs);
      }
    };

    function waitGo(label) {
      // a short instruction card with a Start button; Space/Enter also start
      return new Promise(function (resolve) {
        var btn = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary', 'data-autofocus': '' }, [h('span', { 'class': 'hf-btn__label' }, [label || 'Start']), h('kbd', { 'class': 'hf-kbd', 'aria-hidden': 'true' }, ['Space'])]);
        F.answer.appendChild(h('div', { 'class': 'hf-actions hf-sw__go' }, [btn]));
        try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
        var off = k.keys(function (e) { if ((e.code === 'Space' || e.key === 'Enter') && e.target !== btn) { e.preventDefault(); go(); } });
        offs.push(off);
        function go() { off(); btn.disabled = true; resolve(); }
        btn.addEventListener('click', go);
      });
    }

    function intro(block, withPractice) {
      k.clear(F.stage); k.clear(F.answer); F.say(''); F.setHint('');
      var cue = block.task ? cues[block.task] : null;
      var kids = [h('p', { 'class': 'hf-sw__instr' }, [block.instructions || ''])];
      if (cue) kids.unshift(h('div', { 'class': 'hf-sw__mini', 'data-frame': cue.frame, 'data-task': block.task }, [h('span', null, [cue.word])]));
      else {
        kids.unshift(h('div', { 'class': 'hf-sw__minis' }, ['magnitude', 'parity'].map(function (task) {
          var c2 = cues[task] || {};
          return h('div', { 'class': 'hf-sw__mini', 'data-frame': c2.frame, 'data-task': task }, [h('span', null, [c2.word])]);
        })));
      }
      kids.push(h('p', { 'class': 'hf-sw__instr hf-soft' }, [withPractice ? 'First a few practice trials with feedback.' : 'No feedback from here on. Answer as fast as you can without mistakes.']));
      F.stage.appendChild(h('div', { 'class': 'hf-sw__intro' }, kids));
      return waitGo(withPractice ? 'Start practice' : 'Start');
    }

    function runTrials(trials, feedback, blockId) {
      buildStage();
      var sub = {};
      Object.keys(spec).forEach(function (key) { if (key !== 'trials' && key !== 'blocks' && key !== 'practice') sub[key] = spec[key]; });
      sub.trials = trials;
      return k.runDiscrete(sub, view, {
        keys: ['match', 'no'], leadMs: 700, resumeLeadMs: 1000,
        onAnswer: feedback ? function (ans, t) {
          var ok = ans.response === t.answer;
          var digit = t.stim.digit, task = t.stim.task;
          var fact = task === 'parity' ? (digit % 2 ? digit + ' is odd' : digit + ' is even') : (digit < 5 ? digit + ' is lower than 5' : digit + ' is higher than 5');
          var key = t.answer === 'no' ? 'F (left)' : 'J (right)';
          fbEl.textContent = ans.response == null ? 'Too slow: ' + fact + ', so ' + key + '.' : (ok ? 'Right.' : 'Not quite: ' + fact + ', so ' + key + '.');
          fbEl.setAttribute('data-tone', ok ? 'good' : 'info');
          return ok ? 450 : 1500;
        } : null,
        onResume: function () { if (fbEl) fbEl.textContent = ''; }
      }).then(function (log) {
        if (fbEl) fbEl.textContent = '';
        log.blockId = blockId;
        return log;
      });
    }

    function run(ctx2) {
      ctx2 = ctx2 || {};
      F = k.frameUI(rootEl, { title: practiceOnly ? 'Practice' : (ctx.title || 'Task switching'), test: 'switch', cls: 'hf-lt--switch', onPause: function () { if (HF.timing.active) HF.timing.pause('button'); } });
      var blocks = spec.blocks || [{ id: 'all', kind: 'mixed', task: null, from: 0, to: (spec.trials || []).length - 1, instructions: '', practice: [] }];
      var out = { answers: [], paused: false, pauses: [], aborted: false, blocks: [], frame: null };
      var b = 0;
      return new Promise(function (resolve) {
        function finish(aborted) {
          out.aborted = !!aborted;
          clearTimeout(fixTimer);
          resolve(out);
        }
        function nextBlock() {
          if (destroyed) return finish(true);
          if (b >= blocks.length) return finish(false);
          var block = blocks[b];
          var scored = (spec.trials || []).filter(function (t) { return t.block === block.id || (t.i >= block.from && t.i <= block.to && !t.block); });
          if (!scored.length && block.from != null) scored = (spec.trials || []).slice(block.from, block.to + 1);
          var prac = practiceOnly ? [] : (block.practice || []);
          F.setProgress('Part ' + (b + 1) + ' of ' + blocks.length);
          if (typeof ctx2.onProgress === 'function') ctx2.onProgress(b, blocks.length);
          intro(block, prac.length > 0 || practiceOnly).then(function () {
            if (destroyed) return finish(true);
            return (prac.length ? runTrials(prac, true, block.id + '-practice') : Promise.resolve(null));
          }).then(function (plog) {
            if (destroyed) return finish(true);
            if (plog && plog.aborted) return finish(true);
            if (plog) {
              out.practice = out.practice || [];
              out.practice.push({ block: block.id, answers: plog.answers });
              return intro({ task: block.task, instructions: 'Practice done. Now the real ' + (block.kind === 'mixed' ? 'mixed part' : 'part') + '.' }, false)
                .then(function () { return runTrials(scored, practiceOnly, block.id); });
            }
            return runTrials(scored, practiceOnly, block.id);
          }).then(function (log) {
            if (!log) return;
            Array.prototype.push.apply(out.answers, log.answers.map(function (a) {
              return { i: a.i, response: a.response, rt: a.rt, voided: !!a.voided, timedOut: a.response == null && !a.voided };
            }));
            if (log.paused) out.paused = true;
            (log.pauses || []).forEach(function (p) { out.pauses.push({ block: block.id, start: p.start, end: p.end, reasons: p.reasons }); });
            out.blocks.push({ id: block.id, n: log.answers.length, paused: !!log.paused, frame: log.frame || null });
            out.frame = log.frame || out.frame;
            if (log.aborted) return finish(true);
            b++;
            nextBlock();
          });
        }
        nextBlock();
      });
    }

    return {
      run: run, prepare: view.prepare, show: view.show, hide: view.hide,
      destroy: function () {
        destroyed = true;
        clearTimeout(fixTimer);
        offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
        if (HF.timing && HF.timing.active) HF.timing.abort('destroy');
        if (F && F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el);
      }
    };
  }

  HF.views['lab.switch'] = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
