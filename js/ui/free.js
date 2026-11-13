/* Long-Horizon — Free play with the coach (js/ui/free.js). DOM only, ES2019, MIT licence. Owner: P3.

   Route `free` { trackId? }. Coach cards from HF.coach.suggest(derived, { now, trackId, freePlay: true })
   (Edge / Due / Growing / New, each with the learner model's predicted score); a picker for any version Free play
   may offer (HF.coach.freeTracks), its level and, where the ladder has one, its pace (standard 3 s / fast 2.5 s per
   item); the predicted score of the choice (HF.coach.table). Picking a coach card fills the picker.
   Start → HF.router.go('session', { free: { trackId, rung, pace } }) where rung is FINAL (already the fast or
   standard rung) and pace ('std' | 'fast' | null when the ladder has no pace) is informational; settings.freePace
   remembers the last pace. A free block moves a level only when it is played at that level (engine rule).
   In a study (derived.study set and not left: the planner then returns the study programme for every request) the
   screen says that training follows the programme instead of showing the picker (Phase 4, CB-04).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function K() { return ui.screenKit; }
  function c() { return ui.c; }
  function h(t, a, k) { return ui.c.h(t, a, k); }
  function CAT() { return HF.catalog; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  var S = { root: null, off: [], trackId: null, group: null, pace: 'std', params: {} };
  var KIND = { edge: 'At your edge', due: 'Due for practice', growing: 'Growing fastest', 'new': 'New to try' };
  var KIND_ICON = { edge: 'target', due: 'clock', growing: 'up', 'new': 'plus' };
  var TASK_TITLE = { nback: 'N-back', relations: 'Relations', span: 'Span', vsearch: 'Visual search' };

  /** Level groups of a ladder: same level, standard and fast pace together. */
  function groups(trackId) {
    var C = CAT(), out = [], byLabel = {};
    var n = C.rungCount(trackId);
    for (var r = 0; r < n; r++) {
      var lbl = K().levelText(trackId, r);
      var fast = / · fast$/.test(lbl);
      var base = lbl.replace(/ · fast$/, '');
      var g = byLabel[base];
      if (!g) { g = byLabel[base] = { label: base, std: null, fast: null, index: out.length }; out.push(g); }
      if (fast) g.fast = r; else g.std = r;
    }
    return out;
  }
  function groupOf(gs, rung) {
    for (var i = 0; i < gs.length; i++) if (gs[i].std === rung || gs[i].fast === rung) return i;
    return 0;
  }
  function rungOf(g, pace) {
    if (pace === 'fast' && g.fast !== null) return g.fast;
    if (g.std !== null) return g.std;
    return g.fast;
  }
  function hasPace(gs) { return gs.some(function (g) { return g.fast !== null && g.std !== null; }); }

  function predictions(d, trackId) {
    var out = {};
    try { (HF.coach.table(d, trackId) || []).forEach(function (x) { out[x.rung] = x.predicted; }); } catch (e) { /* ignore */ }
    return out;
  }

  function freeTracks(d) {
    try { return HF.coach.freeTracks(d) || []; } catch (e) { return []; }
  }

  function select(trackId, rung, d) {
    S.trackId = trackId;
    var gs = groups(trackId);
    var tr = d.tracks && d.tracks[trackId];
    var r = isNum(rung) ? rung : (tr ? tr.level : 0);
    S.group = groupOf(gs, r);
    var g = gs[S.group];
    if (g.fast === r && g.std !== null) S.pace = 'fast';
    else if (g.std === r && g.fast !== null) S.pace = 'std';
  }

  function coachSection(d, tracks) {
    var Cc = c();
    var sec = K().section({ id: 'coach', title: 'The coach suggests', lead: 'Expected scores come from your own history. The coach aims at about 80 % correct: hard enough to learn, easy enough to keep going.' });
    var recent = null;
    tracks.forEach(function (id) { var t = d.tracks[id]; if (t && t.lastPlayedAt && (!recent || t.lastPlayedAt > d.tracks[recent].lastPlayedAt)) recent = id; });
    var sug = [];
    try { sug = HF.coach.suggest(d, { now: Date.now(), trackId: recent || undefined, freePlay: true }) || []; } catch (e) { sug = []; }
    sug = sug.filter(function (s) { return s && s.trackId && tracks.indexOf(s.trackId) >= 0; });
    if (!sug.length) {
      sec.appendChild(Cc.empty({ title: 'No suggestions yet', text: 'Play a few blocks and the coach will point you to your edge, to versions due for practice, and to new ones.', art: 'none' }));
      return sec;
    }
    sec.appendChild(h('div', { 'class': 'hf-coach' }, sug.map(function (s) {
      var card = Cc.card({
        cls: 'hf-coach__card', level: 3, title: K().trackName(s.trackId),
        sub: K().levelText(s.trackId, s.rung),
        aside: Cc.chip(KIND[s.kind] || s.kind, { tone: s.kind === 'edge' ? 'blue' : 'outline', icon: KIND_ICON[s.kind] }),
        body: [
          h('p', { 'class': 'hf-coach__pred' }, [h('span', { 'class': 'hf-coach__num hf-num' }, [isNum(s.predicted) ? 'about ' + K().pct(s.predicted) : '–']), ' expected']),
          s.why ? h('p', { 'class': 'hf-small hf-soft' }, [s.why]) : null
        ],
        onClick: function () {
          select(s.trackId, s.rung, d);
          draw('hf-free-start');
          var pick = doc.getElementById('choose');
          if (pick) { try { pick.scrollIntoView({ block: 'start' }); } catch (e2) { pick.scrollIntoView(); } }
        }
      });
      card.setAttribute('data-kind', s.kind);
      card.setAttribute('aria-label', (KIND[s.kind] || s.kind) + ': ' + K().trackName(s.trackId) + ', ' + K().levelText(s.trackId, s.rung) + ', about ' + K().pct(s.predicted) + ' expected. Pick this block.');
      return card;
    })));
    return sec;
  }

  /** c.field() wires label and hint to the select itself; the select then gets the design's arrow wrapper. */
  function selectField(label, hint, sel) {
    var f = c().field({ label: label, hint: hint || null, control: sel });
    var wrap = h('span', { 'class': 'hf-select-wrap' });
    sel.parentNode.replaceChild(wrap, sel);
    wrap.appendChild(sel);
    return f;
  }

  function versionSelect(tracks) {
    var byTask = {};
    tracks.forEach(function (id) { var t = CAT().get(id); (byTask[t.task] || (byTask[t.task] = [])).push(id); });
    var sel = h('select', { 'class': 'hf-select', id: 'hf-free-track' });
    ['nback', 'relations', 'span', 'vsearch'].forEach(function (task) {
      if (!byTask[task]) return;
      var og = h('optgroup', { label: TASK_TITLE[task] });
      byTask[task].forEach(function (id) { og.appendChild(h('option', { value: id }, [K().trackName(id)])); });
      sel.appendChild(og);
    });
    sel.value = S.trackId;
    return sel;
  }

  function chooseSection(d, tracks) {
    var Cc = c();
    var sec = K().section({ id: 'choose', title: 'Choose a block' });
    var id = S.trackId, tr = d.tracks[id], gs = groups(id), pred = predictions(d, id);
    var vsel = versionSelect(tracks);
    vsel.addEventListener('change', function () { select(vsel.value, null, d); draw('hf-free-track'); });
    sec.appendChild(selectField('Version', null, vsel));

    var pace = hasPace(gs) ? S.pace : null;
    var lsel = h('select', { 'class': 'hf-select', id: 'hf-free-level' }, gs.map(function (g, i) {
      var r = rungOf(g, pace);
      var mine = tr && (g.std === tr.level || g.fast === tr.level);
      return h('option', { value: String(i) }, [g.label + (isNum(pred[r]) ? ' — about ' + K().pct(pred[r]) : '') + (mine ? ' (your level)' : '')]);
    }));
    lsel.value = String(S.group);
    lsel.addEventListener('change', function () { S.group = Number(lsel.value); draw('hf-free-level'); });
    sec.appendChild(selectField('Level', 'With the expected score for each level.', lsel));

    var g = gs[S.group] || gs[0];
    if (g.fast !== null && g.std !== null) {
      var info = CAT().params(id, g.std), infoF = CAT().params(id, g.fast);
      sec.appendChild(Cc.segmented({ legend: 'Pace', name: 'hf-free-pace', value: S.pace,
        options: [{ value: 'std', label: 'Normal (one item every ' + (info.soaMs / 1000) + ' s)' }, { value: 'fast', label: 'Fast (every ' + (infoF.soaMs / 1000) + ' s)' }],
        onChange: function (v) { S.pace = v; draw('hf-free-start'); } }));
    }
    var rung = rungOf(g, pace);
    var atLevel = tr && rung === tr.level;
    var p = pred[rung];
    var lessonNeeded = false;
    try { lessonNeeded = !!(ui.lessons && ui.lessons.needed && ui.lessons.needed(id, K().records())); } catch (e) { lessonNeeded = false; }
    var lines = [
      h('p', { 'class': 'hf-free__choice' }, [h('span', { 'class': 'hf-strong' }, [CAT().fullLabel(id, rung)])]),
      h('p', { 'class': 'hf-small' }, [isNum(p) ? 'Expected score about ' + K().pct(p) + '. ' : '', atLevel ? 'This is your level, so the block can move it.' : 'Your level is ' + K().levelText(id, tr ? tr.level : 0) + ', so this block counts as practice and leaves the level as it is.']),
      lessonNeeded || (tr && !tr.blocks) ? h('p', { 'class': 'hf-small hf-soft' }, ['New to you: a short lesson comes first.']) : null
    ];
    var start = Cc.button('Start free play', { variant: 'primary', size: 'lg', id: 'hf-free-start', kbd: 'Space', onClick: function () {
      var pc = g.fast !== null && g.std !== null ? S.pace : null;
      var s = (K().records() || {}).settings || {};
      if (pc && s.freePace !== pc) { try { K().setSettings({ freePace: pc }); } catch (e2) { /* ignore */ } }
      HF.router.go('session', { free: { trackId: id, rung: rung, pace: pc } });
    } });
    sec.appendChild(Cc.card({ tone: 'inset', cls: 'hf-free__summary', body: lines, actions: [start] }));
    return sec;
  }

  function draw(focusId) {
    var rootEl = S.root;
    if (!rootEl) return;
    var y = root.scrollY || 0;
    clear(rootEl);
    var d = K().derived();
    var inStudy = !!(d.study && d.study.left == null);
    var pg = K().page({ title: 'Free play', lead: inStudy ? null : 'Pick any open version, level and pace. A block moves your level only when you play at your own level; every block still counts as practice.', cls: 'hf-free' });
    if (inStudy) {
      // the same words as the session screen (js/ui/session.js); they never name the study group
      pg.node.appendChild(c().empty({ headingLevel: 2, title: 'Free play is off during the study', text: 'You are taking part in a study, so your training follows the study programme. Today shows your next session.',
        action: [c().button('Go to Today', { variant: 'primary', go: 'today', id: 'hf-free-today' })] }));
      rootEl.appendChild(pg.node);
      return;
    }
    var tracks = (d.tracks ? freeTracks(d) : []).filter(function (id) { return CAT().get(id); });
    if (!tracks.length) {
      pg.node.appendChild(c().empty({ title: 'Nothing to play yet', text: 'Finish the tutorial first; then every open version is here.', action: [c().button('Go to Learn', { variant: 'secondary', go: 'learn' })] }));
      rootEl.appendChild(pg.node);
      return;
    }
    if (!S.trackId || tracks.indexOf(S.trackId) < 0) {
      var want = S.params.trackId && tracks.indexOf(S.params.trackId) >= 0 ? S.params.trackId : null;
      if (!want) {
        tracks.forEach(function (id) { var t = d.tracks[id]; if (t.lastPlayedAt && (!want || t.lastPlayedAt > d.tracks[want].lastPlayedAt)) want = id; });
      }
      select(want || tracks[0], null, d);
      var fp = ((K().records() || {}).settings || {}).freePace;
      var gs = groups(S.trackId);
      if (fp === 'fast' && gs[S.group] && gs[S.group].fast !== null) S.pace = 'fast';
    }
    pg.node.appendChild(coachSection(d, tracks));
    pg.node.appendChild(chooseSection(d, tracks));
    var locked = Object.keys(d.tracks || {}).filter(function (id) { return tracks.indexOf(id) < 0 && CAT().get(id) && CAT().get(id).task !== 'vsearch'; }).length;
    if (locked) pg.node.appendChild(h('p', { 'class': 'hf-small hf-muted' }, [locked + (locked === 1 ? ' version is' : ' versions are') + ' not open yet. Progress shows how each one opens.']));
    rootEl.appendChild(pg.node);
    try { root.scrollTo(0, y); } catch (e) { /* ignore */ }
    if (focusId) { var f = doc.getElementById(focusId); if (f) try { f.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
  }

  function cleanup() {
    S.off.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    S.off = [];
  }

  var screen = {
    title: 'Free play',
    render: function (rootEl, params) {
      cleanup();
      S.root = rootEl;
      S.params = params || {};
      if (S.params.trackId) S.trackId = null;
      draw(null);
      S.off.push(K().watch(function () { draw(null); }));
      if (HF.input && HF.input.on) {
        S.off.push(HF.input.on(function (ev) {
          if (ev.key !== 'next') return;
          if (HF.dom && HF.dom.openModals && HF.dom.openModals()) return;
          var b = doc.getElementById('hf-free-start');
          if (b && S.root && S.root.contains(b)) b.click();
        }));
      }
    },
    leave: function () { cleanup(); S.root = null; }
  };

  ui.screens = ui.screens || {};
  ui.screens.free = screen;
  ui.free = { screen: screen, groups: groups };
  if (HF.router && HF.router.register) HF.router.register('free', screen);
})(typeof window !== 'undefined' ? window : globalThis);
