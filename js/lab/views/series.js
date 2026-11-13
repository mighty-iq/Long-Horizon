/* Long-Horizon — Lab view: number and letter series (HF.views['lab.series']). Browser only, ES2019, MIT. Owner: P2.
   Uses HF.labKit (js/lab/views/sspan.js) and HF.lab.tests['lab.series'].normalize(kind, raw) — the scorer's own
   format rules — to check a typed answer before it is sent: numbers are whole numbers of 0 or more (full-width digits,
   "007", "12.0" accepted), letters are one letter A–Z in either case. An answer the rules cannot read is not sent;
   a short hint says what to type instead. At the 60 s cap whatever is typed is sent with timedOut: true (wrong).

   create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }
     log (SPEC §4.3): { answers: [ { i, response: typed text | null, rt (to the Enter/Confirm), voided, timedOut } ],
                        paused, pauses, aborted }
     Practice specs show the rule (trial.explain) after each answer. Escape in the text field pauses (HF.labKit).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  HF.views = HF.views || {};

  function K() { return HF.labKit; }
  function normalize(kind, raw) {
    var t = HF.lab && HF.lab.tests && HF.lab.tests['lab.series'];
    if (t && typeof t.normalize === 'function') return t.normalize(kind, raw);
    var s = String(raw == null ? '' : raw).replace(/\s+/g, '');
    if (kind === 'number') return /^\+?\d+$/.test(s) ? String(parseInt(s, 10)) : null;
    return /^[A-Za-z]$/.test(s) ? s.toUpperCase() : null;
  }

  function create(rootEl, spec, ctx) {
    ctx = ctx || {};
    var k = K(), h = k.h;
    var practice = k.isPractice(spec, ctx), feedback = k.wantsFeedback(spec, ctx);
    var S = null, F = null, destroyed = false, offs = [];
    var windowMs = spec.windowMs || 60000;

    function run(ctx2) {
      ctx2 = ctx2 || {};
      F = k.frameUI(rootEl, { title: practice ? 'Practice' : (ctx.title || 'Series'), test: 'series', cls: 'hf-lt--series', onPause: function (r) { if (S) S.pause(r); } });
      S = k.session({});
      var trials = spec.trials || [];
      var out = { answers: [], paused: false, pauses: [], aborted: false };
      var clock = k.countdown(F, windowMs);
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
            F.setProgress((practice ? 'Example ' : 'Series ') + (idx + 1) + ' of ' + trials.length);
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

      function item(t) {
        return S.trial(function (ctl) {
          k.clear(F.stage); k.clear(F.answer); F.say('');
          var kind = t.stim.kind === 'letter' ? 'letter' : 'number';
          var terms = (t.stim.terms || []).slice();
          var line = h('p', { 'class': 'hf-sr__terms', 'aria-label': 'Series: ' + terms.join(', ') + ', then what?' }, terms.map(function (x) {
            return h('span', { 'class': 'hf-sr__term' }, [String(x)]);
          }).concat([h('span', { 'class': 'hf-sr__term hf-sr__term--q', 'aria-hidden': 'true' }, ['?'])]));
          var id = 'hf-sr-in-' + t.i;
          var input = h('input', {
            id: id, type: 'text', 'class': 'hf-input hf-sr__input', autocomplete: 'off', autocapitalize: kind === 'letter' ? 'characters' : 'off',
            autocorrect: 'off', spellcheck: 'false', inputmode: kind === 'number' ? 'numeric' : 'text', enterkeyhint: 'done',
            maxlength: kind === 'number' ? '8' : '3', 'aria-describedby': id + '-hint'
          });
          var label = h('label', { 'class': 'hf-label', 'for': id }, [kind === 'number' ? 'Next number' : 'Next letter']);
          var hint = h('p', { 'class': 'hf-hint', id: id + '-hint' }, [kind === 'number' ? 'A whole number, 0 or more.' : 'One letter, A to Z.']);
          var send = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary' }, [h('span', { 'class': 'hf-btn__label' }, ['Confirm']), h('kbd', { 'class': 'hf-kbd', 'aria-hidden': 'true' }, ['Enter'])]);
          var form = h('div', { 'class': 'hf-sr__form' }, [h('div', { 'class': 'hf-field' }, [label, hint, h('div', { 'class': 'hf-sr__row' }, [input, send])])]);
          var wrap = h('div', { 'class': 'hf-sr', style: 'visibility:hidden' }, [line, form]);
          F.stage.appendChild(wrap);
          F.setHint('Type your answer and press Enter. Esc pauses.');
          var onset = null, timer = null;
          function cleanup() { clearTimeout(timer); clock.stop(); }
          ctl.onCancel(cleanup);
          function submit(tEv) {
            if (onset === null) return;
            var raw = input.value;
            if (normalize(kind, raw) === null) {
              F.say(raw.replace(/\s+/g, '') === '' ? 'Type an answer first.' : (kind === 'number' ? 'Type a whole number, like 12.' : 'Type one letter, like K.'), 'info');
              try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
              return;
            }
            cleanup();
            ctl.done({ i: t.i, response: raw, rt: Math.round((tEv - onset) * 10) / 10, voided: false, timedOut: false });
          }
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submit(k.evTime(e)); }
          });
          input.addEventListener('input', function () { F.say(''); });
          send.addEventListener('click', function (e) { submit(k.evTime(e)); });
          k.frame().then(function (ts) {
            if (ctl.cancelled) return;
            wrap.style.visibility = '';
            onset = ts;
            clock.start(ts);
            try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
            timer = setTimeout(function () {
              cleanup();
              var raw = input.value;
              ctl.done({ i: t.i, response: raw.replace(/\s+/g, '') === '' ? null : raw, rt: null, voided: false, timedOut: true });
            }, windowMs);
          });
        });
      }

      function explain(t, res) {
        var given = res.response == null ? null : normalize(t.stim.kind === 'letter' ? 'letter' : 'number', res.response);
        var right = !res.timedOut && given === String(t.answer);
        var inp = F.stage.querySelector('input');
        if (inp) inp.disabled = true;
        F.say(res.timedOut ? 'Time is up. The answer is ' + t.answer + '.' : (right ? 'Right: ' + t.answer + '.' : 'Not quite: the answer is ' + t.answer + '.'), right ? 'good' : 'info');
        var row = h('div', { 'class': 'hf-actions' });
        F.answer.appendChild(h('div', { 'class': 'hf-lt__explain' }, [
          t.explain ? h('p', { 'class': 'hf-lt__why1' }, [t.explain]) : null, row
        ]));
        var send = F.stage.querySelector('.hf-sr__row .hf-btn');
        if (send) send.disabled = true;
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

  HF.views['lab.series'] = { create: create, normalize: normalize };
})(typeof window !== 'undefined' ? window : globalThis);
