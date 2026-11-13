/* Long-Horizon — training session screen, route `session` (js/ui/session.js). Browser only, ES2019, MIT licence. Owner: P1a.
 * docs/dev/contracts-ui.md §5; notes in docs/dev/player-notes.md.
 *
 * Route params: { planId?: id (Today's preview: used as the plan / session id unless that id already exists),
 *                 resume?: sessionId (Today's "Continue": the plan stored on the session at beginSession,
 *                   HF.engine.resumePlan — Phase 4, CB-14; a session begun before that is re-planned from the records
 *                   as they stood at its start, same id, so the planner's seeded choices repeat; the slots that already
 *                   have a full block are skipped; if it cannot be resumed, a new session starts with a note),
 *                 free?: { trackId, rung?, pace?: 'std'|'fast', set? }, protocol?: 'cao'|'wang'|'jaeggi',
 *                 practice?: bool (plays the plan but saves nothing), mode?: modeId, minutes?: 10–30,
 *                 fresh?: true (a new session from the plan as it stands now: Welcome's "Start training now") }
 *   No params at all (e.g. the page was reloaded on #/session): today's open session continues; without one the route
 *   goes to Today (replace) and nothing is recorded (Phase 4, CB-05). A new session always comes with a parameter.
 *   { free } while the plan is not Free play (a study participant: the planner returns the study programme) shows a
 *   note instead of playing programme blocks under the Free-play title (Phase 4, CB-04).
 *   Before a new session begins, any session left open (page closed) is ended with endedBy 'quit' at the time of its
 *   last block, so there is never more than one open session.
 * Flow: HF.engine.plan → HF.engine.beginSession (HF.store.mutate) → for each slot: lesson hook
 *   (HF.ui.lessons.needed / run, skipped when absent) → HF.engine.prepare → HF.player.runBlock (rule card, 3-2-1,
 *   task, commit, debrief) → events → … → HF.engine.endSession → summary.
 *   Free play: HF.planner.freeSlot per block; the debrief offers Next block / Change / Done.
 *   Protocols and Study arms come from the plan (the visual-search control arm runs HF.views.vsearch).
 * Between blocks only: the session bar (HF.ui.c.sessionBar; warm-ups count) and an End session button.
 * Debrief events (player): level-up / pb → 1 s celebration (not in Focus mode; CSS skips it with reduced motion);
 *   tier-open / track-available → one line; fatigue → an offer to end. reveal 'session-end' events (badges, Stretch
 *   levels) are collected and shown on the summary.
 * Summary: blocks and minutes, level changes, Wang's day accuracy, the weekly ring, new badges (acknowledged with
 *   badge-ack events), counted / week-goal notes, the next session in words, the reflection prompt (a 'note'
 *   event) when the plan asks for it, Share to Discord (HF.ui.share.open, if present) and Done → today.
 * leave(): aborts a running block (HF.player.abort: the partial block is committed as interrupted) and a running
 *   lesson, stops every timer and listener, restores the chrome. A session with played blocks stays open (Today
 *   offers Continue / End it here); one without blocks is ended with endedBy 'quit'; Free play is ended with
 *   endedBy 'done' (no plan to come back to: Phase 4, PQ-05).
 * The wrapper .hf-sess carries data-phase = plan | lesson | rule | countdown | run | paused | debrief | pick |
 *   summary | empty (CSS hides the head during countdown / run / paused; tests wait on it).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var screens = ui.screens || (ui.screens = {});
  var doc = root.document;

  var live = null;
  var TASK_NAME = { nback: 'N-back', relations: 'Relations', span: 'Span', vsearch: 'Search' };
  var STRATEGY = {
    'nback-grouping': { title: 'Strategy: keep a short rehearsal list',
      text: 'Say the last few items to yourself as one small group. With each new item, drop the oldest and add the newest, then compare the new item with the first one in your group.' },
    'ri-scan': { title: 'Strategy: scan in a fixed order (untested)',
      text: 'Read only the symbol that counts. Check the rows from top to bottom, then the columns from left to right, and answer as soon as one line fits. This routine has not been tested in studies.' }
  };
  var SHOW_NOTES = { 'stretch-locked': 1, 'not-counted': 1, 'cao-late': 1, 'protocol-complete': 1, 'wang-feedback': 1, assist: 1, 'programme-complete': 1, 'stretch-valve': 1 };
  // the same words as Free play's own screen (js/ui/free.js); they never name the study group
  var FREE_IN_STUDY = 'You are taking part in a study, so your training follows the study programme. Today shows your next session.';
  // End session asks first, from the header between blocks and from the pause menu in a block (Phase 4, UX-06)
  var END_ASK = { text: 'End this session now? The blocks you finished are kept.', ok: 'End session', cancel: 'Keep going', title: 'End the session?' };
  // why the next session would not count (HF.goals.canCountNow reasons; Phase 4, UX-03)
  var NEXT_NOT_COUNTED = {
    'day-limit': 'Today\'s counted sessions are done; the next one counts from tomorrow.',
    gap: 'Counted sessions need a gap (Sprint 3 h, Stretch 20 h); a session before then is extra practice.',
    'week-cap': 'This week\'s counted sessions are done; the next one counts from Monday.',
    // Stretch: one a day AND 20 h apart, so "from tomorrow" can be wrong; the day limit is checked first
    stretch: 'Stretch counts sessions at least 20 hours apart; a session before then is extra practice.'
  };

  // ---------------------------------------------------------------- helpers
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function logErr(e) { if (root.console) console.error('[long-horizon] session', e); }
  function C() { return (HF.ui && HF.ui.c) || null; }
  function h(tag, attrs, kids) {
    var c = C();
    if (c && c.h) return c.h(tag, attrs, kids);
    var e = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (own(attrs, k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false && k !== 'on') e.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]));
    (Array.isArray(kids) ? kids : [kids]).forEach(function (x) { if (x !== null && x !== undefined && x !== false) e.appendChild(typeof x === 'object' ? x : doc.createTextNode(String(x))); });
    return e;
  }
  function button(label, o) {
    var c = C();
    if (c && c.button) return c.button(label, o || {});
    var b = h('button', { type: 'button', 'class': 'hf-btn hf-btn--' + ((o && o.variant) || 'secondary') }, label);
    if (o && o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function focusEl(e) { if (!e) return; try { e.focus({ preventScroll: true }); } catch (x) { try { e.focus(); } catch (y) { /* ignore */ } } }
  function store() { return HF.store; }
  function records() { var st = store(); return st ? st.records : null; }
  function derived() { var st = store(); try { return st ? st.derived : null; } catch (e) { logErr(e); return null; } }
  function settings() { var r = records(); return (r && r.settings) || {}; }
  function trackDef(id) { try { return HF.catalog && HF.catalog.get(id); } catch (e) { return null; } }
  function sessionById(r, id) { return ((r && r.sessions) || []).filter(function (x) { return x && x.id === id; })[0] || null; }
  function isBare(p) { return !p || !(p.free || p.protocol || p.planId || p.resume || p.practice || p.mode || p.minutes || p.fresh); }
  function dayKey(t) { try { return HF.goals && HF.goals.dayKey ? HF.goals.dayKey(t) : new Date(t).toDateString(); } catch (e) { return ''; } }
  /** Finished slots of a session: HF.engine.finishedSlots over its blocks (an interrupted attempt never counts), so
   *  records saved before Phase 4 (CB-02: completed counted attempts) read the same as Today does. */
  function finishedOf(r, s) {
    var bl = ((r && r.blocks) || []).filter(function (b) { return b && b.sessionId === s.id; });
    try { if (HF.engine && typeof HF.engine.finishedSlots === 'function') return HF.engine.finishedSlots(bl); } catch (e) { /* below */ }
    return isNum(s.completed) ? s.completed : bl.length;
  }
  /** Today's latest session if it is still open and has blocks left (the same rule as Today's "Continue"). */
  function openToday(r) {
    var today = dayKey(Date.now()), latest = null;
    ((r && r.sessions) || []).forEach(function (x) { if (x && x.dayKey === today && isNum(x.startedAt) && (!latest || x.startedAt > latest.startedAt)) latest = x; });
    if (!latest || latest.endedAt) return null;
    if (latest.mode !== 'free' && isNum(latest.planned) && finishedOf(r, latest) >= latest.planned) return null;
    return latest;
  }
  function trackName(id) { var t = trackDef(id); return t ? t.name : String(id || ''); }
  function trackShort(id) { var t = trackDef(id); return t ? t.short : String(id || ''); }
  function setChrome(v) { try { if (HF.ui && HF.ui.shell && HF.ui.shell.chrome) HF.ui.shell.chrome(v); } catch (e) { logErr(e); } }
  function keepAwake(v) { try { if (HF.timing && HF.timing.keepAwake) HF.timing.keepAwake(v); } catch (e) { /* ignore */ } }
  function go(route, params) { try { if (HF.router) HF.router.go(route, params || {}); } catch (e) { logErr(e); } }
  function scrollTop() { try { root.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  function levelWords(tid, rung) { return HF.player && HF.player.levelWords ? HF.player.levelWords(tid, rung) : String(rung); }
  function fmtMin(m) {
    if (!(m >= 0.75)) return 'under a minute';
    m = Math.round(m);
    return m === 1 ? '1 minute' : m + ' minutes';
  }

  function strategyFor(id) {
    if (!id) return null;
    var src = HF.content && HF.content.strategy, s = null;
    try {
      if (src && typeof src.get === 'function') s = src.get(id);
      else if (src && src.cards) s = Array.isArray(src.cards) ? src.cards.filter(function (x) { return x && x.id === id; })[0] : src.cards[id];
      else if (src && src[id]) s = src[id];
    } catch (e) { s = null; }
    if (s && typeof s === 'object') {
      var text = s.text || s.body || s.summary || (Array.isArray(s.steps) ? s.steps.join(' ') : '');
      var ev = src && src.EVIDENCE && s.evidence ? src.EVIDENCE[s.evidence] : null;
      if (ev) text += ' (' + ev + (s.source ? ': ' + s.source : '') + '.)';
      if (text) return { title: s.title ? 'Strategy: ' + String(s.title).replace(/^Strategy:\s*/, '') : 'Strategy', text: text };
    }
    return STRATEGY[id] || null;
  }

  /** Free-play choice from route params: pace 'fast'|'std' picks the half-step of the chosen n (n-back, Equal Steps). */
  function freeRung(trackId, rung, pace) {
    var t = trackDef(trackId);
    var max = HF.catalog && HF.catalog.maxRung ? HF.catalog.maxRung(trackId) : 99;
    var lvl = derived() && derived().tracks && derived().tracks[trackId] ? derived().tracks[trackId].level : 0;
    var r = isNum(rung) ? rung : (isNum(lvl) ? lvl : 0);
    if (t && pace && (t.task === 'nback' || trackId === 'rel.steps')) {
      if (trackId === 'nback.switch') { var base3 = r - (r % 3); r = pace === 'fast' ? base3 + 2 : (r % 3 === 2 ? base3 + 1 : r); }
      else { var base2 = r - (r % 2); r = pace === 'fast' ? base2 + 1 : base2; }
    }
    return Math.max(0, Math.min(max, r));
  }

  // ---------------------------------------------------------------- the session object
  function Session(rootEl, params) {
    this.root = rootEl;
    this.params = params || {};
    this.practice = !!this.params.practice;
    this.plan = null;
    this.begun = false;
    this.ended = false;
    this.left = false;
    this.userEnd = false;
    this.played = [];        // { slot, bp, res, label }
    this.events = [];        // every commit event
    this.free = null;        // current free-play choice
    this.labels = [];
    this.slotDone = {};      // slot index → true once it has a full (not interrupted) block
    this.startedAt = Date.now();
    this.offs = [];
  }

  Session.prototype.setPhase = function (ph) {
    this.phase = ph;
    if (this.wrap) this.wrap.setAttribute('data-phase', ph);
    var showHead = ph === 'rule' || ph === 'debrief' || ph === 'lesson' || ph === 'pick';
    if (this.head) this.head.hidden = !showHead;
  };

  Session.prototype.layout = function () {
    var self = this;
    clear(this.root);
    var endBtn = button('End session', { variant: 'quiet', size: 'sm', cls: 'hf-sess__end' });
    endBtn.addEventListener('click', function () { self.askEnd(); });
    this.endBtn = endBtn;
    this.barSlot = h('div', { 'class': 'hf-sess__bar' });
    this.head = h('div', { 'class': 'hf-sess__head' }, [this.barSlot, endBtn]);
    this.notesSlot = h('div', { 'class': 'hf-sess__notes' });
    this.stage = h('div', { 'class': 'hf-sess__stage' });
    this.title = h('h1', { 'class': 'hf-vh', tabindex: '-1' }, this.params.free ? 'Free play' : 'Training session');
    this.wrap = h('div', { 'class': 'hf-page hf-sess', 'data-phase': 'plan' }, [this.title, this.head, this.notesSlot, this.stage]);
    this.root.appendChild(this.wrap);
  };

  Session.prototype.askEnd = function () {
    var self = this;
    if (this.ended || this.left) return;
    var ask = HF.dom && HF.dom.confirm ? HF.dom.confirm(END_ASK.text, { ok: END_ASK.ok, cancel: END_ASK.cancel, title: END_ASK.title }) : Promise.resolve(true);
    ask.then(function (yes) {
      if (!yes || self.ended || self.left) return;
      self.userEnd = true;
      if (HF.player && HF.player.active) HF.player.abort('end');
      else if (self.picking) self.picking('end');
      else {
        // e.g. during a lesson: stop it and end now; the lesson's late result is ignored
        try { if (HF.ui.lessons && HF.ui.lessons.active && HF.ui.lessons.active()) HF.ui.lessons.abort(); } catch (e) { logErr(e); }
        self.finish('quit');
      }
    });
  };

  Session.prototype.makePlan = function () {
    var p = this.params, opts = { now: Date.now() };
    if (p.free) opts.modeId = 'free';
    else if (p.protocol) { opts.modeId = 'protocols'; opts.protocolIds = [p.protocol]; }
    else if (p.mode) opts.modeId = p.mode;
    if (isNum(p.minutes)) opts.minutes = p.minutes;
    // Today's preview id, so the session matches what Today showed — unless that id is already used
    if (p.planId && !sessionById(records(), String(p.planId))) opts.id = String(p.planId);
    return HF.engine.plan(records(), derived(), opts);
  };

  /** Resume an open session (page closed mid-session). Phase 4 (CB-14): the plan stored on the session record at
   *  beginSession (HF.engine.resumePlan), so changed settings cannot turn "Continue" into a different session. A
   *  session begun before that has no stored plan: re-plan it from the records as they stood when it began (same plan
   *  id → the planner's seeded choices repeat). Either way the slots that already have a full block are skipped.
   *  Returns { plan, done: { slotId: block }, session } or null when it cannot be resumed. */
  Session.prototype.resumePlan = function (sid) {
    var r = records(), s0 = sessionById(r, sid);
    if (!s0 || s0.endedAt || !isNum(s0.startedAt)) return null;
    if (HF.engine && typeof HF.engine.resumePlan === 'function') {
      try {
        var stored = HF.engine.resumePlan(r, sid);
        if (stored && stored.plan && stored.plan.id === sid && stored.plan.slots) return { plan: stored.plan, done: stored.done || {}, session: stored.session || s0 };
      } catch (e0) { logErr(e0); }
    }
    var before = {};
    for (var k in r) if (own(r, k)) before[k] = r[k];
    before.blocks = (r.blocks || []).filter(function (b) { return b && b.sessionId !== sid && !(b.t >= s0.startedAt); });
    before.sessions = (r.sessions || []).filter(function (x) { return x && x.id !== sid && !(x.startedAt >= s0.startedAt); });
    before.events = (r.events || []).filter(function (e) { return e && !(e.t >= s0.startedAt) && String(e.id || '').indexOf('ev-' + sid + '-') !== 0; });
    var plan = null;
    try {
      var d0 = HF.engine.derive(before, s0.startedAt);
      var opts = { now: s0.startedAt, id: sid };
      if (s0.mode === 'free') opts.modeId = 'free';
      else if (s0.protocol) { opts.modeId = 'protocols'; opts.protocolIds = [s0.protocol]; }
      else if (s0.mode && !s0.study) opts.modeId = s0.mode;
      plan = HF.engine.plan(before, d0, opts);
    } catch (e) { logErr(e); return null; }
    if (!plan || plan.id !== sid || !plan.slots) return null;
    if (!plan.free && plan.slots.length !== s0.planned) return null;
    var done = {};
    (r.blocks || []).forEach(function (b) { if (b && b.sessionId === sid && !b.interrupted && b.slotId) done[b.slotId] = b; });
    return { plan: plan, done: done, session: s0 };
  };

  /** Nothing to continue on a bare route: go to Today instead (after this render, so the router's title, hash and
   *  focus bookkeeping for `session` finish first; replace, so Back does not return here). */
  Session.prototype.toToday = function () {
    var self = this;
    this.ended = true;
    Promise.resolve().then(function () {
      if (live !== self || self.left) return;
      var cur = HF.router && HF.router.current;
      if (cur && cur.name === 'session') { try { HF.router.go('today', {}, { replace: true }); } catch (e) { logErr(e); } }
    });
  };

  /** End sessions left open by a closed page (never two open sessions); their end time is their last block. */
  Session.prototype.endOpenSessions = function (exceptId) {
    var r = records(), now = Date.now();
    var open = (r.sessions || []).filter(function (x) { return x && !x.endedAt && x.id !== exceptId; });
    open.forEach(function (x) {
      var last = x.startedAt || now;
      (r.blocks || []).forEach(function (b) { if (b && b.sessionId === x.id && isNum(b.t) && b.t + 60000 > last) last = b.t + 60000; });
      try {
        store().mutate(function (rr) { return HF.engine.endSession(rr, x.id, { now: Math.min(now, last), endedBy: 'quit' }).records; });
      } catch (e) { logErr(e); }
    });
    return open.length;
  };

  Session.prototype.start = function () {
    var self = this;
    this.layout();
    var st = store();
    if (st && !st.loaded && typeof st.load === 'function') { try { st.load(); } catch (e) { logErr(e); } }
    if (!st || !HF.engine || !HF.player) { this.renderEmpty('The training engine is not loaded.', []); return; }
    // A bare route (the page was reloaded on #/session) continues today's open session, if there is one; without one
    // it goes to Today and records nothing (Phase 4, CB-05: a reload on the summary started a 0-block session)
    if (!this.practice && isBare(this.params)) {
      var open = openToday(records());
      if (!open) { this.toToday(); return; }
      this.params = { resume: open.id };
    }
    // Today's "Continue": pick the open session up where it stopped
    if (this.params.resume && !this.practice) {
      var rp = this.resumePlan(String(this.params.resume));
      if (rp) {
        this.plan = rp.plan;
        this.begun = true;
        this.resumed = true;
        this.done = rp.done;
        this.startedAt = rp.session.startedAt;
      } else this.resumeLost = true;   // a new session starts: say so (Phase 4, CB-14)
    }
    if (!this.plan) {
      try { this.plan = this.makePlan(); } catch (e) { logErr(e); this.renderEmpty('This session could not be planned.', []); return; }
    }
    var plan = this.plan;
    if (this.params.free && !plan.free) {
      // Free play asked for, but the planner returned another plan (a study runs its own programme): say so instead of
      // playing that plan under the Free-play title (Phase 4, CB-04). Nothing is begun.
      this.renderEmpty(plan.study ? FREE_IN_STUDY : 'Free play cannot start right now. Today shows your next session.', [],
        plan.study ? 'Free play is off during the study' : 'Free play is not available');
      return;
    }
    if (!plan.free && (!plan.slots || !plan.slots.length)) { this.renderEmpty(null, plan.notes || []); return; }
    if (this.params.free && this.params.free.trackId) {
      var f = this.params.free;
      this.free = { trackId: f.trackId, rung: freeRung(f.trackId, f.rung, f.pace), set: f.set || null };
    }
    if (this.resumed) this.prefillResumed();
    if (!this.practice && !this.resumed) {
      try {
        this.endOpenSessions(plan.id);
        st.mutate(function (r) { return HF.engine.beginSession(r, plan, { now: Date.now() }).records; });
        this.begun = true;
      } catch (e2) { logErr(e2); }
    }
    this.showPlanNotes();
    this.loop().catch(function (e) { logErr(e); if (!self.ended && !self.left) self.finish('quit'); });
  };

  /** A resumed session: the slots that already have a full block count as played (bar, summary, numbering). */
  Session.prototype.prefillResumed = function () {
    var self = this, plan = this.plan, done = this.done || {};
    if (plan.free) {
      (records().blocks || []).filter(function (b) { return b && b.sessionId === plan.id && !b.interrupted; })
        .sort(function (a, b) { return a.t - b.t; })
        .forEach(function (b) { self.played.push({ slot: null, bp: null, res: { status: 'done', resumed: true }, label: trackShort(b.trackId) }); });
      return;
    }
    plan.slots.forEach(function (sl, j) {
      var b = done[sl.slotId];
      if (!b) return;
      self.slotDone[j] = true;
      self.labels[j] = trackShort(b.trackId);
      self.played.push({ slot: sl, bp: null, res: { status: 'done', resumed: true }, label: self.labels[j], index: j });
    });
  };

  Session.prototype.showPlanNotes = function () {
    var c = C(), notes = (this.plan.notes || []).filter(function (n) { return n && SHOW_NOTES[n.code] && n.text; }).slice(0, 2);
    if (this.practice) notes.unshift({ text: 'Practice: this session saves nothing.' });
    if (this.resumeLost) notes.unshift({ text: 'The earlier session could not be continued, so a new one starts. Every block you played is kept.' });
    clear(this.notesSlot);
    notes.forEach(function (n) {
      this.notesSlot.appendChild(c && c.notice ? c.notice({ tone: 'info', text: n.text, slim: true }) : h('p', null, n.text));
    }, this);
  };
  Session.prototype.clearNotes = function () { clear(this.notesSlot); };

  Session.prototype.labelOf = function (slot, j) {
    if (this.labels[j]) return this.labels[j];
    return slot && slot.trackId ? trackShort(slot.trackId) : 'Your choice';
  };
  Session.prototype.renderBar = function (cur, doneUpTo) {
    var c = C();
    clear(this.barSlot);
    if (!c || !c.sessionBar || !this.plan) return;
    var self = this, steps;
    if (this.plan.free) {
      steps = this.played.map(function (p) { return { label: p.label, kind: 'block', state: 'done' }; });
      if (cur !== null && cur >= this.played.length) steps.push({ label: this.labels[cur] || 'Next block', kind: 'block', state: 'current' });
      if (!steps.length) return;
    } else {
      steps = this.plan.slots.map(function (s, j) {
        var state = self.slotDone[j] || j <= doneUpTo ? 'done' : (j === cur ? 'current' : 'todo');
        var t = trackDef(s.trackId);
        return { label: self.labelOf(s, j), group: t ? TASK_NAME[t.task] : '', kind: s.role === 'warmup' ? 'warmup' : 'block', state: state };
      });
    }
    var o = { steps: steps, unit: 'Block', labels: steps.length <= 4 ? 'all' : 'groups' };
    if (cur !== null && cur !== undefined && this.nowText) o.now = this.nowText;
    if (this.plan.free) o.title = 'Free play · block ' + (cur !== null && cur !== undefined ? cur + 1 : this.played.length);
    this.barSlot.appendChild(c.sessionBar(o));
  };

  // ---------------------------------------------------------------- the loop
  Session.prototype.loop = async function () {
    var plan = this.plan, self = this;
    for (var i = plan.free ? this.played.length : 0; ; i++) {
      if (this.left || this.ended) return;
      if (this.userEnd) { this.finish('quit'); return; }
      var slot;
      if (plan.free) {
        if (!this.free) {
          var choice = await this.pickFree(i);
          if (this.left || this.ended) return;
          if (this.userEnd) { this.finish('quit'); return; }
          if (!choice) {
            if (!this.played.length) { go(HF.router && HF.router.has && HF.router.has('free') ? 'free' : 'today'); return; }
            this.finish('done');
            return;
          }
          this.free = choice;
        }
        slot = HF.planner.freeSlot(plan, { trackId: this.free.trackId, rung: this.free.rung, set: this.free.set || undefined });
      } else {
        if (i >= plan.slots.length) break;
        if (this.slotDone[i]) continue;
        slot = plan.slots[i];
      }
      // lesson first, when the version needs one
      if (slot.trackId) {
        var lr = await this.lessonHook(slot);
        if (lr === 'abort' || this.left || this.ended) return;
        if (this.userEnd) { this.finish('quit'); return; }
      }
      var bp;
      try { bp = HF.engine.prepare(slot, records(), derived(), { sessionId: plan.id }); }
      catch (e) { logErr(e); continue; }
      this.labels[i] = trackShort(bp.trackId);
      this.nowText = trackShort(bp.trackId) + (bp.role === 'warmup' ? ' · warm-up' : '');
      this.renderBar(i, i - 1);
      var last = !plan.free && i === plan.slots.length - 1;
      var res = await HF.player.runBlock(bp, {
        root: this.stage, sessionId: plan.id, commit: !this.practice, endConfirm: END_ASK,
        meta: bp.role === 'warmup' ? 'Warm-up' : (plan.free ? 'Free play' : null),
        index: plan.free ? null : i + 1, total: plan.free ? null : plan.slots.length,
        strategy: strategyFor(bp.strategyCard),
        continueLabel: plan.free ? 'Next block' : (last ? 'See the summary' : 'Continue'),
        debriefActions: plan.free ? [{ id: 'done', label: 'Done', variant: 'quiet' }, { id: 'change', label: 'Change' }] : null,
        autoContinueMs: plan.free || last ? 0 : 15000,
        onPhase: function (ph) {
          self.setPhase(ph);
          if (ph === 'countdown' || ph === 'run') self.clearNotes();
          if (ph === 'debrief') self.renderBar(null, i);
        }
      });
      if (this.left || this.ended) return;
      this.record(slot, bp, res, i);
      if (res.status === 'quit' || res.action === 'quit' || this.userEnd) { this.finish('quit'); return; }
      if (res.action === 'end') { this.finish('fatigue'); return; }
      if (plan.free) {
        if (res.action === 'done') { this.finish('done'); return; }
        if (res.action === 'change') { this.free = null; continue; }
        if (res.status === 'done' && res.commit && res.commit.block && bp.rung === bp.levelBefore && isNum(res.commit.block.levelAfter)) {
          this.free = { trackId: bp.trackId, rung: res.commit.block.levelAfter, set: this.free.set };
        }
      }
    }
    this.finish(null);
  };

  Session.prototype.record = function (slot, bp, res, i) {
    var label = this.labels[i] || trackShort(bp.trackId);
    // keep only what the bar, the picker and the summary read (not the spec, log, result or commit of every block)
    this.played.push({ slot: slot, bp: { trackId: bp.trackId }, res: { status: res && res.status }, label: label, index: i });
    if (res && res.status === 'done' && !this.plan.free) this.slotDone[i] = true;
    if (res && res.commit && res.commit.events) this.events = this.events.concat(res.commit.events);
  };

  Session.prototype.lessonHook = async function (slot) {
    var L = HF.ui && HF.ui.lessons;
    if (!L || typeof L.needed !== 'function' || typeof L.run !== 'function') return 'none';
    var id = null;
    try { id = L.needed(slot.trackId, records()); } catch (e) { logErr(e); return 'none'; }
    if (!id) return 'none';
    this.setPhase('lesson');
    this.renderBar(null, -1);
    clear(this.stage);
    var box = h('div', { 'class': 'hf-sess__lesson' });
    this.stage.appendChild(box);
    try { await L.run(id, box, { from: 'session' }); } catch (e2) { logErr(e2); }
    setChrome(true);
    if (this.left) return 'abort';
    clear(this.stage);
    return 'done';
  };

  // ---------------------------------------------------------------- Free play picker
  Session.prototype.pickFree = function (i) {
    var self = this, c = C(), d = derived() || {};
    var ids = HF.coach && HF.coach.freeTracks ? HF.coach.freeTracks(d) : (HF.catalog ? HF.catalog.ids() : []);
    if (!ids.length) return Promise.resolve(null);
    var last = this.played.length ? this.played[this.played.length - 1].bp : null;
    var cur = { trackId: last && ids.indexOf(last.trackId) >= 0 ? last.trackId : ids[0], rung: null };
    this.setPhase('pick');
    this.renderBar(i, this.played.length - 1);
    clear(this.stage);
    scrollTop();
    var levelBox = h('div', { 'class': 'hf-sess__pick-level' });
    function levelOptions(tid) {
      var rows = [];
      try { rows = HF.coach && HF.coach.table ? HF.coach.table(d, tid) : []; } catch (e) { rows = []; }
      if (!rows.length && HF.catalog) { for (var r = 0; r <= HF.catalog.maxRung(tid); r++) rows.push({ rung: r, label: HF.catalog.levelLabel(tid, r) }); }
      var lvl = d.tracks && d.tracks[tid] ? d.tracks[tid].level : 0;
      return { lvl: lvl, opts: rows.map(function (x) {
        var t = levelWords(tid, x.rung) || x.label;
        if (x.rung === lvl) t += ' (your level)';
        if (isNum(x.predicted)) t += ' · about ' + Math.round(x.predicted * 100) + '% expected';
        return { value: x.rung, label: t };
      }) };
    }
    function drawLevel() {
      clear(levelBox);
      var lo = levelOptions(cur.trackId);
      cur.rung = isNum(cur.rung) ? cur.rung : lo.lvl;
      if (!lo.opts.some(function (o) { return o.value === cur.rung; })) cur.rung = lo.lvl;
      levelBox.appendChild(c.select({ label: 'Level', hint: 'Only blocks played at your own level can move it.', options: lo.opts, value: cur.rung,
        onChange: function (v) { cur.rung = parseInt(v, 10); } }));
    }
    var verSel = c.select({ label: 'Version', options: ids.map(function (id) { return { value: id, label: trackName(id) }; }), value: cur.trackId,
      onChange: function (v) { cur.trackId = v; cur.rung = null; drawLevel(); } });
    drawLevel();
    var startBtn = button('Start', { variant: 'primary', kbd: 'Space', attrs: { 'data-autofocus': '' } });
    var doneBtn = button(this.played.length ? 'Done' : 'Back', { variant: 'secondary' });
    var card = h('section', { 'class': 'hf-card hf-sess__pick', 'aria-labelledby': 'hf-sess-pick-t' }, [
      h('h2', { 'class': 'hf-h2', id: 'hf-sess-pick-t' }, 'Choose the next block'),
      h('p', { 'class': 'hf-muted hf-small' }, 'Pick any version and level. Free-play blocks always teach the app about you.'),
      verSel, levelBox,
      h('div', { 'class': 'hf-actions hf-actions--stack' }, [doneBtn, startBtn])
    ]);
    this.stage.appendChild(card);
    focusEl(startBtn);
    return new Promise(function (resolve) {
      var off = null, done = false;
      function fin(v) {
        if (done) return;
        done = true;
        self.picking = null;
        if (off) off();
        resolve(v);
      }
      self.picking = function (v) { fin(v === 'end' ? null : v); };
      startBtn.addEventListener('click', function () { fin({ trackId: cur.trackId, rung: cur.rung, set: null }); });
      doneBtn.addEventListener('click', function () { fin(null); });
      off = HF.input && HF.input.on ? HF.input.on(function (ev) {
        if (ev.key === 'next' && !(HF.dom && HF.dom.openModals && HF.dom.openModals())) fin({ trackId: cur.trackId, rung: cur.rung, set: null });
      }) : null;
      self.offs.push(function () { fin(null); });
    });
  };

  // ---------------------------------------------------------------- end and summary
  Session.prototype.finish = function (endedBy) {
    if (this.ended) return;
    this.ended = true;
    var endRes = null, plan = this.plan;
    if (this.begun && !this.practice && plan) {
      try {
        store().mutate(function (r) {
          endRes = HF.engine.endSession(r, plan.id, { now: Date.now(), endedBy: endedBy || undefined });
          return endRes.records;
        });
        if (store().flush) store().flush();
      } catch (e) { logErr(e); }
    }
    keepAwake(false);
    setChrome(true);
    this.renderSummary(endRes, endedBy);
  };

  /** Level changes of this session, from its block records (first levelBefore → last levelAfter per version). Warm-ups
   *  are left out: on a new version theirs is only the first guess, which the warm-up itself may move. start: true
   *  marks a version first played in this session that ended below that guess: its starting level was set, it did not
   *  drop (Phase 4 QA follow-up). */
  Session.prototype.levelChanges = function () {
    var plan = this.plan, map = {}, order = [];
    if (!plan || this.practice) return [];
    var all = records().blocks || [];
    all.filter(function (b) { return b && b.sessionId === plan.id && b.role !== 'warmup' && isNum(b.levelBefore) && isNum(b.levelAfter); })
      .sort(function (a, b) { return a.t - b.t; })
      .forEach(function (b) {
        if (!map[b.trackId]) { map[b.trackId] = { trackId: b.trackId, from: b.levelBefore, to: b.levelAfter }; order.push(b.trackId); }
        else map[b.trackId].to = b.levelAfter;
      });
    function playedBefore(id) {
      return all.some(function (b) { return b && b.trackId === id && b.sessionId !== plan.id && (b.role === 'rated' || b.role === 'free') && !b.interrupted; });
    }
    return order.map(function (k) { var x = map[k]; x.start = x.to < x.from && !playedBefore(k); return x; })
      .filter(function (x) { return x.from !== x.to; });
  };

  Session.prototype.renderSummary = function (endRes, endedBy) {
    var self = this, c = C(), plan = this.plan || {};
    var endEvents = (endRes && endRes.events) || [];
    var d = derived() || {};
    this.setPhase('summary');
    clear(this.root);
    scrollTop();
    var playedOk = this.played.filter(function (p) { return p.res && p.res.status === 'done'; });
    var minutes = endRes && endRes.session && isNum(endRes.session.minutes) ? endRes.session.minutes : (Date.now() - this.startedAt) / 60000;
    var quitEarly = endedBy === 'quit' || endedBy === 'fatigue';
    var kids = [];
    var h1 = h('h1', { 'class': 'hf-h1', tabindex: '-1' }, quitEarly ? 'Session ended' : 'Session done');
    kids.push(h('header', { 'class': 'hf-page__head' }, [h1,
      h('p', { 'class': 'hf-lead' }, playedOk.length
        ? 'You played ' + playedOk.length + (playedOk.length === 1 ? ' block' : ' blocks') + ' in ' + fmtMin(minutes) + '.' + (this.practice ? ' Practice: nothing was saved.' : '')
        : 'No block was finished this time.' + (this.practice ? ' Practice: nothing was saved.' : ''))]));

    // session bar, all states final
    if (c && c.sessionBar && plan.slots && !plan.free && plan.slots.length) {
      var steps = plan.slots.map(function (s, j) {
        return { label: self.labelOf(s, j), kind: s.role === 'warmup' ? 'warmup' : 'block', state: self.slotDone[j] ? 'done' : 'skipped' };
      });
      kids.push(h('section', { 'class': 'hf-section hf-sess__sum-bar' }, c.sessionBar({ steps: steps, unit: 'Block', labels: 'none' })));
    }

    // Wang: the day's accuracy (shown only at the end)
    endEvents.filter(function (e) { return e.type === 'wang-day'; }).forEach(function (e) {
      var moved = e.levelAfter > e.levelBefore ? 'moves up' : (e.levelAfter < e.levelBefore ? 'eases back' : 'stays');
      kids.push(c.notice({ tone: 'info', title: 'Today\'s accuracy: ' + Math.round((e.acc || 0) * 100) + '%',
        text: 'Wang\'s rule looks at the whole day. Your level ' + moved + ': ' + (e.label || '') + '.' }));
    });

    // level changes
    var changes = this.levelChanges();
    if (changes.length) {
      var rows = changes.map(function (ch) {
        var up = ch.to > ch.from;
        if (ch.start) {
          return h('li', { 'class': 'hf-sess__lvl' }, [
            h('span', { 'class': 'hf-sess__lvl-name' }, trackName(ch.trackId)),
            h('span', { 'class': 'hf-sess__lvl-move is-start' }, 'Starting level: ' + levelWords(ch.trackId, ch.to))
          ]);
        }
        return h('li', { 'class': 'hf-sess__lvl' }, [
          h('span', { 'class': 'hf-sess__lvl-name' }, trackName(ch.trackId)),
          h('span', { 'class': 'hf-sess__lvl-move' + (up ? ' is-up' : '') }, [
            c && c.icon ? c.icon(up ? 'up' : 'down') : null,
            levelWords(ch.trackId, ch.from) + ' → ' + levelWords(ch.trackId, ch.to)
          ])
        ]);
      });
      var stretch = endEvents.some(function (e) { return e.type === 'levels-revealed'; });
      kids.push(h('section', { 'class': 'hf-section' }, [
        h('h2', { 'class': 'hf-h2' }, stretch ? 'Levels, revealed now' : 'Levels'),
        h('ul', { 'class': 'hf-sess__lvls' }, rows)
      ]));
    }

    // weekly ring + counted notes
    var counted = endEvents.filter(function (e) { return e.type === 'session-counted'; })[0];
    var weekGoal = endEvents.some(function (e) { return e.type === 'week-goal'; });
    var week = d.week || null;
    if (!this.practice && week && c && c.weeklyRing && isNum(week.target) && week.target > 0) {
      var note = weekGoal ? 'Weekly target reached. Rest days count too.' : undefined;
      kids.push(h('section', { 'class': 'hf-section hf-mot' }, c.weeklyRing({ done: week.count || 0, target: week.target, note: note })));
    }
    if (counted && !this.practice) {
      kids.push(h('p', { 'class': 'hf-small hf-muted' }, counted.counted ? 'This session counts toward your week.'
        : (counted.reason === 'short' || counted.reason === 'too-short' ? 'This session was too short to count toward your week; the blocks still count for your levels.' : 'Extra practice: it does not count toward your week, but every block still counts for your levels.')));
    }
    endEvents.forEach(function (e) {
      if (e.type === 'protocol-complete') kids.push(c.notice({ tone: 'good', title: 'Protocol complete', text: e.protocol === 'cao' ? 'You finished the 6 sessions of Cao\'s protocol. A 10-block check is suggested after about 3 months (offered from day 80).' : 'You finished the protocol. Any training style works from here.' }));
      if (e.type === 'stretch-valve' && e.text) kids.push(c.notice({ tone: 'info', text: e.text }));
    });

    // new badges (collected for the end)
    var seen = {}, newBadges = [];
    var unseen = (d.badgesUnseen || []).map(function (id) { return { type: 'badge', badgeId: id }; });
    this.events.concat(endEvents, unseen).forEach(function (e) {
      if (e.type !== 'badge' || !e.badgeId || seen[e.badgeId]) return;
      seen[e.badgeId] = true;
      var b = HF.badges && HF.badges.get ? HF.badges.get(e.badgeId) : null;
      newBadges.push({ id: e.badgeId, title: (b && b.label) || e.label || e.badgeId, desc: (b && b.text) || '', earned: true, date: 'today' });
    });
    if (newBadges.length && c && c.badges) {
      kids.push(h('section', { 'class': 'hf-section hf-mot' }, [h('h2', { 'class': 'hf-h2' }, newBadges.length === 1 ? 'New badge' : 'New badges'), c.badges(newBadges)]));
      if (!this.practice && !settings().focusMode) {
        try {
          store().mutate(function (r) {
            var t = Date.now();
            var add = newBadges.map(function (b, k) { return { id: 'ev-ack-' + b.id + '-' + t + '-' + k, t: t, type: 'badge-ack', badgeId: b.id }; });
            var out = {}; for (var k in r) if (own(r, k)) out[k] = r[k];
            out.events = (r.events || []).concat(add);
            return out;
          }, { silent: true });
        } catch (e3) { logErr(e3); }
      }
    }

    // reflection (one question)
    if (plan.reflection && !this.practice && playedOk.length) kids.push(this.reflectionBox());

    // next session in words
    var nextText = this.nextText();
    if (nextText) kids.push(h('p', { 'class': 'hf-sess__next' }, nextText));

    // actions
    var shareHolder = h('div', { 'class': 'hf-sess__share' });
    var acts = [];
    if (HF.ui && HF.ui.share && typeof HF.ui.share.open === 'function' && !this.practice) {
      var shareBtn = button('Share to Discord', { variant: 'secondary', icon: 'people' });
      shareBtn.addEventListener('click', function () { try { HF.ui.share.open(shareHolder); } catch (e) { logErr(e); } });
      acts.push(shareBtn);
    }
    var doneBtn = button('Done', { variant: 'primary', kbd: 'Space', attrs: { 'data-autofocus': '' } });
    doneBtn.addEventListener('click', function () { go('today'); });
    acts.push(doneBtn);
    kids.push(h('div', { 'class': 'hf-actions hf-actions--stack hf-sess__acts' }, acts));
    kids.push(shareHolder);

    this.wrap = h('div', { 'class': 'hf-page hf-sess hf-sess--summary', 'data-phase': 'summary' }, kids);
    this.root.appendChild(this.wrap);
    focusEl(h1);
    // Space on the summary = Done (unless typing in the reflection box)
    var off = HF.input && HF.input.on ? HF.input.on(function (ev) {
      if (ev.key === 'next' && !(HF.dom && HF.dom.openModals && HF.dom.openModals())) go('today');
    }) : null;
    if (off) this.offs.push(off);
  };

  Session.prototype.reflectionBox = function () {
    var c = C(), id = 'hf-sess-note-' + Date.now().toString(36);
    var area = h('textarea', { 'class': 'hf-input hf-sess__note', id: id, rows: '3', maxlength: '600', 'aria-describedby': id + '-hint' });
    var status = h('p', { 'class': 'hf-small hf-muted', role: 'status' }, '');
    var save = button('Save note', { variant: 'secondary' });
    save.addEventListener('click', function () {
      var text = String(area.value || '').trim();
      if (!text) { status.textContent = 'Write a line first, or skip it.'; return; }
      try {
        store().mutate(function (r) {
          var t = Date.now();
          var out = {}; for (var k in r) if (own(r, k)) out[k] = r[k];
          out.events = (r.events || []).concat([{ id: 'ev-note-' + t.toString(36), t: t, type: 'note', text: text, kind: 'reflection' }]);
          return out;
        });
        status.textContent = 'Saved. Thank you.';
        save.disabled = true;
        area.readOnly = true;
      } catch (e) { logErr(e); status.textContent = 'Could not save the note here.'; }
    });
    return h('section', { 'class': 'hf-section hf-sess__reflect' }, [
      h('h2', { 'class': 'hf-h2' }, 'One question'),
      h('label', { 'class': 'hf-label', 'for': id }, 'How did you go about the tasks today? Did anything help?'),
      h('p', { 'class': 'hf-hint', id: id + '-hint' }, 'Optional. It stays on this device, in your history.'),
      area, h('div', { 'class': 'hf-actions' }, [save]), status
    ]);
  };

  Session.prototype.nextText = function () {
    if (this.practice) return null;
    try {
      var np = HF.engine.plan(records(), derived(), { now: Date.now() + 1000 });
      if (!np) return null;
      var bits = [];
      if (np.free) return 'Next time: choose any version in Free play.';
      if (np.slots && np.slots.length) bits.push('Next session: ' + np.slots.length + ' blocks, about ' + fmtMin(np.estMinutes || 0) + '.');
      var nn = (np.notes || []).filter(function (n) { return n && (n.code === 'new-track' || n.code === 'reflection' || n.code === 'mastery-check' || n.code === 'not-counted'); })[0];
      if (nn) {
        if (nn.code === 'not-counted') {
          var why = nn.reason !== 'week-cap' && np.modeId === 'stretch' ? 'stretch' : nn.reason;
          bits.push(NEXT_NOT_COUNTED[why] || NEXT_NOT_COUNTED['day-limit']);
        }
        else if (nn.code === 'new-track' && nn.trackId) bits.push('It brings a new version: ' + trackName(nn.trackId) + '.');
        else bits.push(nn.text);
      }
      return bits.join(' ');
    } catch (e) { logErr(e); return null; }
  };

  Session.prototype.renderEmpty = function (text, notes, title) {
    var c = C();
    this.setPhase('empty');
    clear(this.stage);
    var list = (notes || []).map(function (n) { return n && n.text ? n.text : ''; }).filter(Boolean);
    var body = text ? [text].concat(list) : (list.length ? list : ['There is nothing to train in this session.']);
    var back = button('Back to Today', { variant: 'primary', attrs: { 'data-autofocus': '' } });
    back.addEventListener('click', function () { go('today'); });
    title = title || 'No blocks in this session';
    var node = c && c.empty
      ? c.empty({ title: title, text: body.join(' '), action: back, art: 'sprout', headingLevel: 2 })
      : h('div', null, [h('h2', null, title), h('p', null, body.join(' ')), back]);
    this.stage.appendChild(node);
    focusEl(back);
  };

  Session.prototype.leave = function () {
    this.left = true;
    try { if (HF.player && HF.player.active) HF.player.abort('leave'); } catch (e) { logErr(e); }
    try { if (HF.ui.lessons && HF.ui.lessons.active && HF.ui.lessons.active()) HF.ui.lessons.abort(); } catch (e1) { logErr(e1); }
    if (this.picking) { try { this.picking('end'); } catch (e2) { /* ignore */ } }
    // A session with played blocks stays open, so Today can offer "Continue" or "End it here"; one without blocks is
    // ended at once (nothing to continue). Free play has no plan to come back to: leaving it ends it, as Done does
    // (Phase 4, PQ-05: Today showed it as "Session N in progress · 1 of 14 blocks done"). A new session ends any
    // session left open before it begins.
    if (this.begun && !this.ended && !this.practice && this.plan) {
      var plan = this.plan;
      var n = ((records() || {}).blocks || []).filter(function (b) { return b && b.sessionId === plan.id; }).length;
      if (!n || plan.free) {
        this.ended = true;
        try {
          store().mutate(function (r) { return HF.engine.endSession(r, plan.id, { now: Date.now(), endedBy: n ? 'done' : 'quit' }).records; });
          if (store().flush) store().flush();
        } catch (e3) { logErr(e3); }
      }
    }
    this.offs.forEach(function (f) { try { f(); } catch (e4) { /* ignore */ } });
    this.offs = [];
    keepAwake(false);
    setChrome(true);
  };

  // ---------------------------------------------------------------- route
  var screen = {
    title: function (params) { return params && params.free ? 'Free play' : 'Session'; },
    render: function (rootEl, params) {
      if (live) { try { live.leave(); } catch (e) { logErr(e); } }
      live = new Session(rootEl, params || {});
      live.start();
    },
    leave: function () {
      var s = live;
      live = null;
      if (s) s.leave();
    }
  };
  screens.session = screen;
  if (HF.router && typeof HF.router.register === 'function') HF.router.register('session', screen);
  HF.session = { current: function () { return live; }, freeRung: freeRung, strategyFor: strategyFor };
})(typeof window !== 'undefined' ? window : globalThis);
