/* Long-Horizon — first-run welcome (route 'welcome'; browser only). MIT licence. Owner: P4.
 *
 * Flow (PLAN §3, §8): the Chimera pop-up has already shown (app.js) → a short welcome → the choice
 *   Start training now (default, focused)  |  Measure first (time cost shown: HF.lab.visitMinutes(settings.labConfig
 *   || 'standard') rounded to 5 min, "about 50 min" with the standard set, now and again 2–7 days later, before session 1)
 * → the n-back lesson (HF.ui.lessons.run('lesson.nback'), skipped if it was already passed)
 * → HF.store.mutate: profile.firstRunDone = true, profile.path = 'train' | 'measure', profile.updatedAt
 * → HF.router.go('session', { fresh: true }) or HF.router.go('labvisit', { kind: 'B1' }) (P2's Lab visit; it offers the
 *   visit length choice itself; the Lab home route is 'lab'). The bare `session` route only continues an open session
 *   and otherwise goes to Today, so the first session asks for a new one explicitly (Phase 4, CB-05).
 * Once profile.firstRunDone is set (e.g. a reload on #/welcome after an import), the route goes to Today (replace).
 * Leaving the lesson half-way offers: start it again, or skip it for now (it then runs before the first n-back block,
 * because HF.ui.lessons.needed('nback.plain') still returns 'lesson.nback').
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});

  var running = false;

  function h(tag, attrs, kids) { return ui.c.h(tag, attrs, kids); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  function finish(path) {
    var now = Date.now();
    try {
      HF.store.mutate(function (r) {
        if (!r.profile) r.profile = {};
        r.profile.firstRunDone = true;
        r.profile.path = path === 'measure' ? 'measure' : 'train';
        if (!r.profile.startedAt) r.profile.startedAt = now;
        r.profile.updatedAt = now;
      });
      if (HF.store.flush) HF.store.flush();
    } catch (e) { if (root.console) console.error('[long-horizon] welcome', e); }
    if (path === 'measure') HF.router.go('labvisit', { kind: 'B1' });
    else HF.router.go('session', { fresh: true });
  }

  function firstRunDone() {
    try { var r = HF.store && HF.store.records; return !!(r && r.profile && r.profile.firstRunDone); } catch (e) { return false; }
  }

  // Minutes of one baseline visit, from the Lab's own test list (standard set: 52 → "about 50").
  function labMinutes() {
    try {
      var s = HF.store && HF.store.records && HF.store.records.settings;
      var m = HF.lab && typeof HF.lab.visitMinutes === 'function' ? HF.lab.visitMinutes((s && s.labConfig) || 'standard') : 0;
      if (m > 0) return Math.max(5, Math.round(m / 5) * 5);
    } catch (e) { /* the Lab is optional: fall through */ }
    return 50;
  }

  function lessonPassed() {
    try { var st = ui.lessons && ui.lessons.status ? ui.lessons.status('lesson.nback') : null; return !!(st && st.passed !== null); } catch (e) { return false; }
  }

  function startLesson(rootEl, path) {
    if (!ui.lessons || typeof ui.lessons.run !== 'function' || lessonPassed()) { finish(path); return; }
    running = true;
    ui.lessons.run('lesson.nback', rootEl, { from: 'welcome', finishLabel: path === 'measure' ? 'Go to Baseline 1' : 'Start my first session' })
      .then(function (res) {
        running = false;
        if (!rootEl.isConnected) return;
        if (res && res.quit) { renderPaused(rootEl, path); return; }
        finish(path);
      });
  }

  function option(o) {
    return h('div', { 'class': 'hf-welcome__opt' + (o.main ? ' is-main' : ''), 'data-path': o.path }, [
      h('h3', { 'class': 'hf-h3 hf-welcome__opt-title' }, [o.title]),
      h('p', { 'class': 'hf-welcome__opt-text' }, [o.text]),
      o.time ? h('p', { 'class': 'hf-welcome__time' }, [ui.c.icon('clock'), h('span', null, [o.time])]) : null,
      h('div', { 'class': 'hf-actions' }, [o.button])
    ]);
  }

  function render(rootEl) {
    clear(rootEl);
    var c = ui.c;
    var start = c.button('Start training now', { variant: 'primary', size: 'lg', id: 'hf-welcome-start', attrs: { 'data-autofocus': '' },
      onClick: function () { startLesson(rootEl, 'train'); } });
    var measure = c.button('Measure first', { variant: 'secondary', id: 'hf-welcome-measure', onClick: function () { startLesson(rootEl, 'measure'); } });
    var page = h('div', { 'class': 'hf-page hf-welcome' }, [
      h('header', { 'class': 'hf-page__head' }, [
        // the descriptor next to the name, the tagline, one line on the name (Long-Horizon copy, 13 Nov), the session size
        h('p', { 'class': 'hf-welcome__kicker' }, ['Working memory trainer']),
        h('h1', { 'class': 'hf-h1' }, ['Hello, and welcome to ', h('span', { 'class': 'hf-welcome__name' }, ['Long-Horizon'])]),   // one term: never split at the hyphen
        h('p', { 'class': 'hf-welcome__tagline' }, ['Hold more in mind. Keep it straight.']),
        h('p', { 'class': 'hf-lead' }, ['Your horizon is how many steps you can hold in mind and still work with. This trainer stretches it, one step at a time. A session is about 14 short blocks, usually 15 to 25 minutes; three to five a week is plenty.'])
      ]),
      h('ul', { 'class': 'hf-welcome__facts' }, [
        h('li', null, [c.icon('book'), h('span', null, ['A 6-minute lesson teaches the game first. You play it; nothing to read up on.'])]),
        h('li', null, [c.icon('target'), h('span', null, ['The tasks adapt to you: harder when a block goes well, easier when it does not.'])]),
        h('li', null, [c.icon('lock'), h('span', null, ['Everything stays on this device. No account, nothing sent anywhere.'])])
      ]),
      h('section', { 'class': 'hf-section hf-welcome__choice', 'aria-labelledby': 'hf-welcome-q' }, [
        h('h2', { 'class': 'hf-h2', id: 'hf-welcome-q' }, ['How would you like to start?']),
        h('div', { 'class': 'hf-split hf-welcome__opts' }, [
          option({ path: 'train', main: true, title: 'Start training now', button: start,
            text: 'The lesson comes first, then your first session. You can still use the Lab later; those visits are marked “no baseline”.' }),
          option({ path: 'measure', title: 'Measure first', button: measure,
            text: 'Take the Lab’s memory and reasoning tests before you train, so you can see what changes. The lesson still comes first.',
            time: 'About ' + labMinutes() + ' min now, and about the same again 2–7 days later, before your first session.' })
        ])
      ]),
      h('p', { 'class': 'hf-small hf-muted hf-welcome__note' }, ['Does a longer horizon carry over to reasoning? Most controlled studies so far found no gain in IQ or reasoning, so Long-Horizon measures it for you in the Lab instead of promising it.'])
    ]);
    rootEl.appendChild(page);
  }

  function renderPaused(rootEl, path) {
    clear(rootEl);
    var c = ui.c;
    rootEl.appendChild(h('div', { 'class': 'hf-page hf-welcome' }, [
      h('header', { 'class': 'hf-page__head' }, [
        h('h1', { 'class': 'hf-h1', tabindex: '-1' }, ['The lesson is on hold']),
        h('p', { 'class': 'hf-lead' }, ['You can start it again now, or skip it for the moment. If you skip it, it runs just before your first n-back block.'])
      ]),
      h('div', { 'class': 'hf-actions' }, [
        c.button('Skip for now', { variant: 'secondary', id: 'hf-welcome-skip', onClick: function () { finish(path); } }),
        c.button('Start the lesson again', { variant: 'primary', id: 'hf-welcome-again', attrs: { 'data-autofocus': '' }, onClick: function () { startLesson(rootEl, path); } })
      ])
    ]));
    var b = rootEl.querySelector('[data-autofocus]');
    if (b) { try { b.focus(); } catch (e) { /* ignore */ } }
  }

  var screen = {
    title: 'Welcome',
    render: function (rootEl) {
      running = false;
      if (firstRunDone() && HF.router && HF.router.has && HF.router.has('today')) {
        // the first run is over (e.g. reload on #/welcome after Reset → Import): Today, after this render so the router's
        // own bookkeeping (title, hash, focus) finishes first — as Today does for its redirect the other way
        Promise.resolve().then(function () {
          var cur = HF.router.current;
          if (cur && cur.name === 'welcome') HF.router.go('today', {}, { replace: true });
        });
        return;
      }
      render(rootEl);
    },
    leave: function () { if (running && ui.lessons) ui.lessons.abort(); running = false; }
  };
  ui.welcome = { render: render, finish: finish };
  if (HF.router && HF.router.register) HF.router.register('welcome', screen);
  else { ui.screens = ui.screens || {}; ui.screens.welcome = screen; }
})(typeof window !== 'undefined' ? window : globalThis);
