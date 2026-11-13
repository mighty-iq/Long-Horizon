/* Long-Horizon — Learn and Practice screens (routes 'learn', 'practice'; browser only). MIT licence. Owner: P4.
 *
 * learn  params: none                → the Learn home: lessons (with status), practice, help pages, Chimera link
 *               { lessonId }         → plays that lesson in place (a replay once passed: nothing saved), then back
 *               { page: 'howto' | 'strategy' | 'glossary' | 'why' }   → one help page (texts from HF.content.*)
 * practice params: { trackId?, rung? } → untimed self-paced practice of any available version (HF.ui.lessons.practice):
 *               tape on, a No match button, explained feedback; nothing is logged.
 * In-app links use HF.router.go (never href="#/…"); the Discord link is a real external link.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});

  function c() { return ui.c; }
  function h(tag, attrs, kids) { return ui.c.h(tag, attrs, kids); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function content() { return HF.content || {}; }
  function go(name, params) { return function () { HF.router.go(name, params || {}); }; }
  var DISCORD = 'https://discord.gg/chmr';

  function derived() { try { return (HF.store && HF.store.derived) || {}; } catch (e) { return {}; } }
  function trackAvailable(id) {
    var d = derived();
    if (d.tracks && d.tracks[id]) return !!d.tracks[id].available;
    return id === 'nback.plain' || id === 'rel.steps' || id === 'rel.grid.T1';
  }
  function trackLevel(id) { var d = derived(); return d.tracks && d.tracks[id] && typeof d.tracks[id].level === 'number' ? d.tracks[id].level : 0; }

  function backBar() {
    return h('div', { 'class': 'hf-learn__back' }, [c().button('Learn', { variant: 'quiet', icon: 'chev-left', onClick: go('learn') })]);
  }
  function pageHead(title, lead) {
    return h('header', { 'class': 'hf-page__head' }, [h('h1', { 'class': 'hf-h1' }, [title]), lead ? h('p', { 'class': 'hf-lead' }, [lead]) : null]);
  }
  function section(title, kids, o) {
    o = o || {};
    return h('section', { 'class': 'hf-section' + (o.cls ? ' ' + o.cls : ''), id: o.id || null }, [
      h('div', { 'class': 'hf-section__head' }, [h('h2', { 'class': 'hf-h2' }, [title])]),
      h('div', { 'class': 'hf-stack' }, kids)
    ]);
  }

  // ======================================================================== Learn home
  function lessonMeta(l) {
    if (l.passed) return 'Passed';
    var tid = l.trackIds[0];
    if (tid && HF.catalog && HF.catalog.get(tid) && !trackAvailable(tid)) {
      var g = HF.catalog.get(tid).gate;
      if (g && g.kind === 'exec') return 'Passing opens it';
      return 'Not open yet';
    }
    return 'Not yet';
  }
  function lessonRow(l) {
    var sub = l.summary + ' About ' + l.minutes + ' min.';
    var tid = l.trackIds[0], cat = HF.catalog && HF.catalog.get(tid);
    if (!l.passed && cat && !trackAvailable(tid)) sub += cat.gate && cat.gate.kind === 'exec' ? ' Also opens when Plain n-back reaches 2-back.' : ' ' + HF.catalog.gateText(tid);
    var task = cat ? cat.task : '';
    var icon = l.kind === 'tutorial' ? 'book' : ({ nback: 'grid', relations: 'layers', span: 'pen', vsearch: 'target' }[task] || 'learn');
    var row = c().listItem({ title: l.title, sub: sub, meta: lessonMeta(l), icon: icon,
      onClick: go('learn', { lessonId: l.id }) });
    row.setAttribute('data-lesson', l.id);
    if (l.passed) row.classList.add('is-passed');
    return row;
  }
  function renderHome(rootEl) {
    var L = ui.lessons ? ui.lessons.list() : [];
    var tutorial = L.filter(function (l) { return l.kind === 'tutorial'; });
    var lessons = L.filter(function (l) { return l.kind === 'lesson' && l.id !== 'lesson.vsearch'; });
    var tiers = L.filter(function (l) { return l.kind === 'intro'; });
    var vs = L.filter(function (l) { return l.id === 'lesson.vsearch'; });
    var studyArm = derived().study && derived().study.left == null && derived().study.arm;

    var page = h('div', { 'class': 'hf-page hf-learn' }, [
      pageHead('Learn', 'Lessons you play, untimed practice, and plain answers about how Long-Horizon works.'),
      section('The tutorial', [c().list(tutorial.map(lessonRow), { label: 'Tutorial' })]),
      section('Lessons for each task', [
        h('p', { 'class': 'hf-small hf-muted' }, ['Each runs by itself just before a task’s first block. Replay any of them here; a replay saves nothing.']),
        c().list(lessons.concat((HF.catalog && HF.catalog.studyArmKind ? HF.catalog.studyArmKind(studyArm) : studyArm) === 'control' ? vs : []).map(lessonRow), { label: 'Lessons' }),
        c().details('Relation Grid tiers: one-screen intros', [c().list(tiers.map(lessonRow), { label: 'Tier intros' })])
      ]),
      section('Practice', [c().list([
        { title: 'Untimed practice', sub: 'Self-paced, with the memory tape. Nothing is saved or counted.', icon: 'tap', meta: 'Any task', onClick: go('practice') }
      ], { label: 'Practice' })]),
      section('Help', [c().list([
        { title: 'How to play', sub: 'Each task in plain words, with its keys.', icon: 'keyboard', onClick: go('learn', { page: 'howto' }) },
        { title: 'Strategy cards', sub: 'Ways to hold items in mind, marked tested or untested.', icon: 'layers', onClick: go('learn', { page: 'strategy' }) },
        { title: 'Glossary', sub: 'Match, lure, balanced accuracy, d′, noise band and more.', icon: 'book', onClick: go('learn', { page: 'glossary' }) },
        { title: 'Why Long-Horizon works this way', sub: 'The research behind the design, with its limits.', icon: 'info', onClick: go('learn', { page: 'why' }) },
        { title: 'Chimera Discord', sub: 'Questions or ideas? Share progress and join community studies.', icon: 'people', href: DISCORD }
      ], { label: 'Help' })])
    ]);
    rootEl.appendChild(page);
  }

  // ======================================================================== help pages
  function renderHowto(rootEl) {
    var H = content().howto;
    var kids = [backBar(), pageHead('How to play', 'Every task in plain words. The same key scheme everywhere.')];
    kids.push(section(H.INTRO.title, H.INTRO.body.map(function (p) { return h('p', { 'class': 'hf-prose' }, [p]); })
      .concat([c().keys(H.KEYS.map(function (k) { return { key: k.key, pad: k.pad, when: k.when, yes: k.key === 'J' }; }))])));
    var tasks = H.TASKS.map(function (t) {
      var body = [
        h('p', { 'class': 'hf-prose' }, [h('strong', null, ['Goal: ']), t.goal]),
        t.horizon ? h('p', { 'class': 'hf-prose hf-howto__horizon' }, [t.horizon]) : null,
        h('p', { 'class': 'hf-prose' }, [h('strong', null, ['What you see: ']), t.see]),
        c().keys(t.press.map(function (p) { return p.none ? { none: true, when: p.when } : { key: p.key, pad: p.pad, yes: p.key === 'J' || p.key === 'K', when: p.when }; })),
        h('ul', { 'class': 'hf-ltips' }, t.tips.map(function (x) { return h('li', null, [x]); }))
      ];
      if (t.experimental) body.push(c().notice({ tone: 'info', slim: true, text: 'Experimental' + (t.source ? ': based on ' + t.source + ', a single small study' : ': our design, not taken from a study') + '.' }));
      var d = c().details(t.title, body);
      d.setAttribute('data-task', t.id);
      return d;
    });
    kids.push(section('The tasks', tasks));
    rootEl.appendChild(h('div', { 'class': 'hf-page hf-learn hf-learn--howto' }, kids));
  }
  function renderStrategy(rootEl) {
    var S = content().strategy;
    var cards = S.CARDS.map(function (cd) {
      var chip = c().chip(S.EVIDENCE[cd.evidence], { tone: cd.evidence === 'tested' ? 'good' : 'outline', icon: cd.evidence === 'tested' ? 'check' : 'info' });
      var tracks = cd.trackIds.map(function (id) { var t = HF.catalog && HF.catalog.get(id); return t ? t.short : id; })
        .filter(function (x, i, a) { return a.indexOf(x) === i; });
      var node = c().card({ title: cd.title, sub: (cd.source ? cd.source + ' · ' : '') + 'For: ' + shortList(tracks), aside: chip, level: 2, body: [
        h('ol', { 'class': 'hf-lsteps' }, cd.steps.map(function (s) { return h('li', null, [s]); })),
        h('p', { 'class': 'hf-small' }, [h('strong', null, ['Example: ']), cd.example]),
        h('p', { 'class': 'hf-small hf-muted' }, [cd.note])
      ] });
      node.setAttribute('data-card', cd.id);
      return node;
    });
    rootEl.appendChild(h('div', { 'class': 'hf-page hf-learn' }, [backBar(),
      pageHead('Strategy cards', 'Ways to hold items in mind. Only the first was tested in a study; the rest are our suggestions. Strategies you find yourself work too.'),
      h('div', { 'class': 'hf-stack hf-stack--lg' }, cards)]));
  }
  function shortList(arr) {
    if (arr.length > 4) return arr.slice(0, 3).join(', ') + ' and more';
    return arr.join(', ');
  }
  function renderGlossary(rootEl) {
    var G = content().glossary;
    var dl = h('dl', { 'class': 'hf-lgloss' }, []);
    G.TERMS.forEach(function (t) {
      dl.appendChild(h('dt', { id: 'g-' + t.id, 'class': 'hf-lgloss__term' }, [t.term]));
      var dd = h('dd', { 'class': 'hf-lgloss__def' }, [t.text]);
      if (t.see && t.see.length) {
        dd.appendChild(h('span', { 'class': 'hf-lgloss__see' }, [' See also: ' + t.see.map(function (id) { var x = G.get(id); return x ? x.term : id; }).join(', ') + '.']));
      }
      dl.appendChild(dd);
    });
    rootEl.appendChild(h('div', { 'class': 'hf-page hf-learn' }, [backBar(), pageHead('Glossary', 'The words Long-Horizon uses, in plain English.'), dl]));
  }
  function renderWhy(rootEl) {
    var R = content().research, CL = content().claims;
    var kids = [backBar(), pageHead(R.TITLE, R.LEAD)];
    R.SECTIONS.forEach(function (s) {
      var body = [];
      (s.body || []).forEach(function (p) { body.push(h('p', { 'class': 'hf-prose' }, [p])); });
      if (s.points) body.push(h('ul', { 'class': 'hf-lpoints' }, s.points.map(function (p) { return h('li', null, [p]); })));
      if (s.table) body.push(c().table({ caption: s.table.caption, columns: s.table.columns, rows: s.table.rows, rowHeaders: true }));
      if (s.so) body.push(c().notice({ tone: 'info', title: 'What Long-Horizon does', text: s.so }));
      if (s.id === 'lab' && HF.router && typeof HF.router.has === 'function' && HF.router.has('lab')) {
        body.push(h('div', { 'class': 'hf-actions' }, [c().button('Open the Lab', { variant: 'secondary', id: 'hf-why-lab', onClick: go('lab') })]));
      }
      kids.push(section(s.title, body, { id: 'why-' + s.id }));
    });
    kids.push(section('What Long-Horizon can and cannot claim', [
      h('p', { 'class': 'hf-prose hf-strong' }, [CL.SUMMARY]),
      h('div', { 'class': 'hf-split' }, [
        h('div', { 'class': 'hf-stack hf-stack--sm' }, [h('h3', { 'class': 'hf-h3' }, ['Can']), h('ul', { 'class': 'hf-lpoints' }, CL.CAN.map(function (x) { return h('li', null, [h('strong', null, [x.title + ' ']), x.text]); }))]),
        h('div', { 'class': 'hf-stack hf-stack--sm' }, [h('h3', { 'class': 'hf-h3' }, ['Cannot']), h('ul', { 'class': 'hf-lpoints' }, CL.CANNOT.map(function (x) { return h('li', null, [h('strong', null, [x.title + ' ']), x.text]); }))])
      ])
    ], { id: 'why-claims' }));
    kids.push(section('Limits of this summary', [h('ul', { 'class': 'hf-lpoints' }, R.LIMITS.map(function (x) { return h('li', null, [x]); })),
      c().details('Sources named on this page', [h('ul', { 'class': 'hf-lrefs' }, R.REFERENCES.map(function (r) { return h('li', null, [r.full]); })),
        // the research notes are not in the repository; the guide's reference chapter is (Phase 4, SC-12)
        h('p', { 'class': 'hf-small hf-muted' }, ['The full list, with links, is in the Long-Horizon guide (PDF), chapter 13.'])])]));
    rootEl.appendChild(h('div', { 'class': 'hf-page hf-learn hf-learn--why' }, kids));
  }

  // ======================================================================== lesson in place
  function renderLesson(rootEl, lessonId) {
    var host = h('div', { 'class': 'hf-learn__lesson' });
    rootEl.appendChild(host);
    ui.lessons.run(lessonId, host, { from: 'learn', finishLabel: 'Back to Learn' }).then(function (res) {
      if (!host.isConnected) return;
      if (res && res.error && HF.dom && HF.dom.toast) HF.dom.toast('The lesson stopped because of an error. Please try again.', { kind: 'warn' });
      HF.router.go('learn', {}, { replace: true });
    });
  }

  // ======================================================================== practice
  var PRACTICE_TRACKS = ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch', 'rel.steps',
    'rel.grid.T1', 'rel.grid.T2', 'rel.grid.T3', 'rel.grid.T4', 'rel.grid.T5', 'rel.grid.T6', 'rel.grid.T7', 'rel.grid.T8', 'rel.stream',
    'span.op', 'span.sym', 'span.back', 'vs.search'];
  function levelOptions(id) {
    var t = HF.catalog.get(id), out = [];
    if (!t) return out;
    if (t.task === 'nback') {
      var step = id === 'nback.switch' ? 3 : 2;
      for (var n = 1; n <= 5; n++) out.push({ value: String(step * (n - 1)), label: n + '-back' });
    } else if (id === 'rel.steps') {
      for (var L = 0; L < 12; L++) out.push({ value: String(2 * L), label: HF.catalog.levelLabel(id, 2 * L).replace(/^Equal Steps · /, '') });
    } else {
      var max = HF.catalog.maxRung(id);
      // a Grid version's name already says its tier: "Step 4 of 9", not "Tier 1 · step 4 of 9" (Phase 4, PQ-14)
      for (var r = 0; r <= max; r++) out.push({ value: String(r), label: t.tier ? 'Step ' + (r + 1) + ' of 9' : HF.catalog.levelLabel(id, r) });
    }
    return out;
  }
  function defaultRung(id) {
    var lv = trackLevel(id), opts = levelOptions(id), best = opts.length ? opts[0].value : '0';
    opts.forEach(function (o) { if (+o.value <= lv) best = o.value; });
    return best;
  }
  function renderPractice(rootEl, params) {
    params = params || {};
    var avail = PRACTICE_TRACKS.filter(function (id) { return HF.catalog && HF.catalog.get(id) && trackAvailable(id); });
    if (!avail.length) avail = ['nback.plain'];
    var state = { trackId: avail.indexOf(params.trackId) >= 0 ? params.trackId : avail[0] };
    state.rung = params.rung !== undefined ? String(params.rung) : defaultRung(state.trackId);
    state.tape = true;

    var area = h('div', { 'class': 'hf-learn__practice' });
    var controls = h('div', { 'class': 'hf-lpractice__controls' });
    var page = h('div', { 'class': 'hf-page hf-learn hf-learn--practice' }, [
      backBar(),
      pageHead('Untimed practice', 'Nothing moves until you answer, the memory tape stays on, and every answer is explained. Nothing here is saved or counted.'),
      controls, area
    ]);
    rootEl.appendChild(page);

    function paintControls() {
      clear(controls);
      var trackSel = c().select({ label: 'Task', value: state.trackId, options: avail.map(function (id) { return { value: id, label: HF.catalog.get(id).name }; }),
        onChange: function (v) { state.trackId = v; state.rung = defaultRung(v); paintControls(); } });
      var lvlSel = c().select({ label: 'Level', value: state.rung, options: levelOptions(state.trackId), onChange: function (v) { state.rung = v; } });
      trackSel.setAttribute('data-ctl', 'track'); lvlSel.setAttribute('data-ctl', 'level');
      var tid = state.trackId, t = HF.catalog.get(tid);
      var tape = (t.task === 'nback' || tid === 'rel.steps') ? c().toggle({ label: 'Memory tape', checked: state.tape, onChange: function (v) { state.tape = v; } }) : null;
      var start = c().button('Start', { variant: 'primary', kbd: 'Space', id: 'hf-practice-start', onClick: startRound });
      controls.appendChild(h('div', { 'class': 'hf-lpractice__row' }, [trackSel, lvlSel, tape]));
      controls.appendChild(h('div', { 'class': 'hf-actions' }, [start]));
      var how = content().howto && content().howto.forTrack(tid);
      if (how) controls.appendChild(h('p', { 'class': 'hf-small hf-muted' }, [how.goal]));
    }
    function startRound() {
      if (HF.audio && HF.audio.unlock && HF.catalog.get(state.trackId).task === 'nback') { try { HF.audio.unlock(); } catch (e) { /* ignore */ } }
      controls.hidden = true;
      clear(area);
      var host = h('div', { 'class': 'hf-lpractice__board' });
      area.appendChild(host);
      ui.lessons.practice(host, { trackId: state.trackId, rung: +state.rung, tape: state.tape }).then(function (res) {
        if (!area.isConnected) return;
        clear(area);
        if (!res || res.quit) { controls.hidden = false; return; }
        area.appendChild(c().notice({ tone: 'good', title: 'Round done', live: true,
          text: res.total ? 'You answered ' + res.right + ' of ' + res.total + ' correctly. Nothing was saved.' : 'Nothing was saved.' }));
        var again = c().button('Another round', { variant: 'primary', kbd: 'Space', id: 'hf-practice-again', onClick: startRound });
        var change = c().button('Change task or level', { variant: 'secondary', onClick: function () { clear(area); controls.hidden = false; paintControls(); } });
        area.appendChild(h('div', { 'class': 'hf-actions' }, [change, again]));
        try { again.focus(); } catch (e) { /* ignore */ }
      });
    }
    paintControls();
  }

  // ======================================================================== routes
  var learnScreen = {
    title: function (p) {
      if (p && p.lessonId && content().lessons) { var l = content().lessons.get(p.lessonId); if (l) return l.title; }
      var T = { howto: 'How to play', strategy: 'Strategy cards', glossary: 'Glossary', why: 'Why Long-Horizon works this way' };
      return (p && T[p.page]) || 'Learn';
    },
    render: function (rootEl, params) {
      params = params || {};
      clear(rootEl);
      if (params.lessonId && ui.lessons && content().lessons && content().lessons.get(params.lessonId)) { renderLesson(rootEl, params.lessonId); return; }
      if (params.page === 'howto') renderHowto(rootEl);
      else if (params.page === 'strategy') renderStrategy(rootEl);
      else if (params.page === 'glossary') renderGlossary(rootEl);
      else if (params.page === 'why') renderWhy(rootEl);
      else renderHome(rootEl);
    },
    leave: function () { if (ui.lessons && ui.lessons.active()) ui.lessons.abort(); }
  };
  var practiceScreen = {
    title: 'Untimed practice',
    render: function (rootEl, params) { clear(rootEl); renderPractice(rootEl, params); },
    leave: function () { if (ui.lessons && ui.lessons.active()) ui.lessons.abort(); }
  };
  ui.learn = { renderHome: renderHome, renderPractice: renderPractice };
  if (HF.router && HF.router.register) { HF.router.register('learn', learnScreen); HF.router.register('practice', practiceScreen); }
  else { ui.screens = ui.screens || {}; ui.screens.learn = learnScreen; ui.screens.practice = practiceScreen; }
})(typeof window !== 'undefined' ? window : globalThis);
