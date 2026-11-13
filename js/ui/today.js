/* Long-Horizon — Today (home) screen + the small shared kit of the everyday screens (js/ui/today.js).
   DOM only, ES2019, MIT licence. Owner: P3.

   Route `today` (no params). Redirects to `welcome` (P4) while records.profile.firstRunDone is false, but only
   when a `welcome` route is registered; otherwise Today shows as usual.
   Shows: the next-session card built from HF.engine.plan (nothing is started here) or, when a session from today
   is still open, its session bar with Continue; the weekly ring and the 20-session programme (Focus mode hides
   both); a Lab reminder (HF.lab.schedule); a backup reminder after milestones; the "not saved here" notice when
   storage is blocked. Start → HF.router.go('session', { planId, protocol? }); Continue → go('session',
   { resume: sessionId }); Free-play mode → go('free'). Space starts (HF.input 'next').

   HF.ui.screenKit (shared by today/progress/settings/free/about; everything is looked up at call time):
     records(), derived(), now()
     fmtDate(ms, { weekday, year, time }), fmtTime(ms), fmtAgo(ms), fmtMinutes(min), pct(v), dayKey(ms)
     family(trackId), chipName(trackId), chipLevel(trackId, rung), chip(trackId, rung), trackName(trackId)
     setSettings(patch | fn(settingsCopy)) → settings   (LWW: bumps settings.updatedAt; applies to <html>)
     watch(fn, { local }) → off   (fn after store changes from other tabs, imports and resets; local too if asked)
     page({ title, lead, cls }) → { node, head }, section({ id, title, lead, aside, cls }) → section element
     MODES { id: { label, line, gives } }, HELP (the "Help me choose" question), BADGES { id: { glyph, tone } },
     labKind(kind) → 'Baseline 1' …, labDue(records, derived, now) → reminder | null, backupDue(records, derived)
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;
  var DAY = 86400000;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function c() { return ui.c; }
  function h(tag, attrs, kids) { return ui.c.h(tag, attrs, kids); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clone(o) {
    if (HF.util && HF.util.clone) return HF.util.clone(o);
    return JSON.parse(JSON.stringify(o));
  }

  // ------------------------------------------------------------------ kit
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function records() { try { return (HF.store && HF.store.records) || null; } catch (e) { return null; } }
  function derived() {
    try {
      var d = HF.store && HF.store.derived;
      if (d && d.tracks) return d;
      var r = records();
      if (r && HF.engine && HF.engine.derive) return HF.engine.derive(r, Date.now());
    } catch (e) { if (root.console) console.error('[long-horizon] derive failed', e); }
    return {};
  }
  function now() { return Date.now(); }
  function dayKey(ms) {
    if (HF.util && HF.util.dayKey) return HF.util.dayKey(ms);
    var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtTime(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtDate(ms, o) {
    if (!isNum(ms)) return '–';
    o = o || {};
    var d = new Date(ms), s = d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (o.weekday) s = DAYS[(d.getDay() + 6) % 7] + ' ' + s;
    if (o.year || d.getFullYear() !== new Date().getFullYear()) s += ' ' + d.getFullYear();
    if (o.time) s += ', ' + fmtTime(ms);
    return s;
  }
  function fmtLongDate(ms) {
    var d = new Date(ms);
    return DAYS_LONG[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MONTHS_LONG[d.getMonth()];
  }
  function daysBetween(a, b) {
    var da = new Date(a), db = new Date(b);
    var x = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate()), y = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
    return Math.round((y - x) / DAY);
  }
  function fmtAgo(ms) {
    if (!isNum(ms)) return 'never';
    var n = daysBetween(ms, Date.now());
    if (n <= 0) return 'today, ' + fmtTime(ms);
    if (n === 1) return 'yesterday';
    if (n < 7) return n + ' days ago';
    return fmtDate(ms);
  }
  function fmtMinutes(m) {
    m = Math.round(m || 0);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + pad2(m % 60) + ' min';
  }
  function pct(v) { return isNum(v) ? Math.round(v * 100) + '%' : '–'; }

  function cat() { return HF.catalog; }
  function family(trackId) { var t = cat() && cat().get(trackId); return t ? t.task : 'nback'; }
  function trackName(trackId) { var t = cat() && cat().get(trackId); return t ? t.name : String(trackId); }
  function chipName(trackId) {
    var t = cat() && cat().get(trackId);
    if (!t) return String(trackId);
    if (t.tier) return 'Grid';
    if (trackId === 'rel.stream') return 'Stream';
    if (trackId === 'vs.search') return 'Search';
    return t.short || t.name;
  }
  // Short tier names for chips, where the version is only called "Grid".
  var TIER_SHORT = { 1: 'Same', 2: 'Ascending', 3: 'Different', 4: 'Diagonals', 5: 'Five same', 6: 'Two features', 7: '4×4', 8: 'Five different' };
  /** Level in words for a place that already names the version ("Step 4 of 9", "3-back · fast", "2-back up to 19"). */
  function levelText(trackId, rung) {
    var C = cat(), t = C && C.get(trackId);
    if (!t || !isNum(rung)) return '';
    var lbl = C.levelLabel(trackId, rung);
    if (trackId === 'rel.steps') return lbl.replace(/^Equal Steps · /, '');
    if (t.tier) return 'Step ' + (rung + 1) + ' of 9';
    if (trackId === 'rel.stream') return lbl.replace(/^Stream · step/, 'Step');
    return lbl;
  }
  /** Level in words for a chip whose name is short ("Grid" → "Same, step 4"). */
  function chipLevel(trackId, rung) {
    var t = cat() && cat().get(trackId);
    if (!t || !isNum(rung)) return '';
    if (t.tier) return (TIER_SHORT[t.tier] || 'Tier ' + t.tier) + ', step ' + (rung + 1);
    if (trackId === 'rel.stream') return 'step ' + (rung + 1) + ' of 6';
    return levelText(trackId, rung);
  }
  function chip(trackId, rung, o) {
    return c().levelChip({ family: family(trackId), name: chipName(trackId), level: chipLevel(trackId, rung), title: (o && o.title) || null });
  }

  function setSettings(patch) {
    var out = null;
    HF.store.mutate(function (r) {
      var s = clone(r.settings || {});
      if (typeof patch === 'function') patch(s);
      else for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
      s.updatedAt = Date.now();
      r.settings = s;
      out = s;
    });
    try { if (ui.shell && ui.shell.applySettings) ui.shell.applySettings(out); } catch (e) { /* ignore */ }
    return out;
  }

  function watch(fn, o) {
    if (!HF.store || !HF.store.onChange) return function () {};
    var timer = null;
    var off = HF.store.onChange(function (evt) {
      if (evt && evt.source === 'local' && !(o && o.local)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; try { fn(evt); } catch (e) { if (root.console) console.error(e); } }, 80);
    });
    return function () { if (timer) clearTimeout(timer); timer = null; off(); };
  }

  function page(o) {
    o = o || {};
    var head = h('header', { 'class': 'hf-page__head' }, [
      h('h1', { 'class': 'hf-h1' }, [o.title || '']),
      o.lead ? h('p', { 'class': 'hf-lead' }, [o.lead]) : null
    ]);
    var node = h('div', { 'class': 'hf-page' + (o.cls ? ' ' + o.cls : '') }, [head]);
    return { node: node, head: head };
  }
  function section(o) {
    o = o || {};
    var kids = [h('div', { 'class': 'hf-section__head' }, [
      h('h2', { 'class': 'hf-h2', id: o.id ? o.id + '-title' : null }, [o.title || '']),
      o.aside || null
    ])];
    if (o.lead) kids.push(h('p', { 'class': 'hf-soft hf-section__lead' }, [o.lead]));
    return h('section', { 'class': 'hf-section' + (o.cls ? ' ' + o.cls : ''), id: o.id || null, 'aria-labelledby': o.id ? o.id + '-title' : null }, kids);
  }

  // The six training styles in plain words (PLAN §5 table): what each does and what it gives up.
  var MODES = {
    varied: { label: 'Varied', line: 'Mixes versions and materials, starting simple and widening step by step. Aims at about 80 % correct.',
      gives: 'Early gains come a little slower, and mixing has not been tested inside working-memory training itself.' },
    protocols: { label: 'Protocols', line: 'Runs a published study’s training (Cao 2026, Wang 2025 or Jaeggi 2008) as closely as each paper allows; where a paper is silent, Long-Horizon’s choices are listed in the guide.',
      gives: 'Only what each paper trained, with its own rules; Cao’s sessions take about 30 minutes. Jaeggi 2008 used spoken consonants: Long-Horizon plays tones unless you choose spoken letters in Settings.' },
    sprint: { label: 'Sprint', line: 'One fixed version per task, double steps and strategy tips. Aims at about 85 % correct.',
      gives: 'The gains are mostly on the trained tasks themselves.' },
    stretch: { label: 'Stretch', line: 'Harder kinds of difficulty, more look-alike items and less feedback. Aims at about 72 % correct.',
      gives: 'Slower learning per session and harder to keep up; at most 4 sessions a week.' },
    mastery: { label: 'Mastery Path', line: 'A fixed path of units: pass one, then a check on a later day, then spaced reviews.',
      gives: 'Less variety, and each step takes longer.' },
    free: { label: 'Free play', line: 'You pick the version, level and pace for every block; a coach suggests.',
      gives: 'People tend to pick easy, repetitive practice.' }
  };
  var HELP = {
    question: 'What matters most to you right now?',
    answers: [
      { id: 'fast', label: 'Getting good at these tasks quickly', mode: 'sprint',
        why: 'Sprint uses fixed versions, double steps and strategy tips: the fastest way up the levels of the trained tasks.' },
      { id: 'transfer', label: 'The best chance that it carries over', mode: 'varied',
        why: 'Varied mixes versions and materials on purpose, which is what the research on transfer favours. No style has been shown to raise reasoning; the Lab lets you check your own case.' },
      { id: 'course', label: 'A structured course with checks', mode: 'mastery',
        why: 'Mastery Path gives you clear units, a check on a later day and spaced reviews.' },
      { id: 'hard', label: 'A hard challenge', mode: 'stretch',
        why: 'Stretch makes the tasks harder in new ways and shows less feedback.' },
      { id: 'papers', label: 'Following the published studies', mode: 'protocols',
        why: 'Protocols runs Cao 2026, Wang 2025 or Jaeggi 2008 as closely as each paper allows (where a paper is silent, Long-Horizon’s choices are listed in the guide), with their limits.' },
      { id: 'self', label: 'Choosing for myself', mode: 'free',
        why: 'Free play lets you pick every block; the coach shows what to expect.' }
    ]
  };
  var BADGES = {
    'rules-learned': { glyph: 'book', tone: 'blue' }, 'nback-3': { glyph: 'n3', tone: 'blue' }, 'nback-5': { glyph: 'n5', tone: 'blue' },
    'exec-all': { glyph: 'layers', tone: 'blue' }, 'rel-different': { glyph: 'grid', tone: 'kelp' }, 'rel-five': { glyph: 'cross', tone: 'kelp' },
    explorer: { glyph: 'compass', tone: 'kelp' }, baselines: { glyph: 'baseline', tone: 'amber' }, 'post-test': { glyph: 'flag', tone: 'amber' },
    'follow-up': { glyph: 'clock', tone: 'amber' }, comeback: { glyph: 'return', tone: 'kelp' }, reflective: { glyph: 'pen', tone: 'blue' }
  };
  var LAB_KIND = { B1: 'Baseline 1', B2: 'Baseline 2', Q: 'Quick check', POST: 'Post-test', FU: 'Follow-up', X: 'Extra visit' };
  function labKind(k) { return LAB_KIND[k] || String(k || 'Lab visit'); }

  /** The Lab visit to mention on Today, or null. B1/B2 only for people who chose "Measure first" (or began it). */
  function labDue(r, d, t) {
    if (!HF.lab || typeof HF.lab.schedule !== 'function' || !r) return null;
    var sch;
    try { sch = HF.lab.schedule(r, d, t); } catch (e) { return null; }
    var nx = sch && sch.next;
    if (!nx || !(nx.status === 'due' || nx.status === 'overdue')) return null;
    var visits = (r.labVisits || []).length;
    var path = r.profile && r.profile.path;
    if ((nx.kind === 'B1' || nx.kind === 'B2') && path !== 'measure' && !visits) return null;
    var minutes = null;
    try { minutes = HF.lab.visitMinutes(nx.config, nx.part ? { part: nx.part } : undefined); } catch (e2) { minutes = null; }
    return { kind: nx.kind, label: labKind(nx.kind), status: nx.status, part: nx.part || null, minutes: minutes, notToday: !!nx.notToday, dueTo: nx.dueTo || null };
  }

  /** Backup reminder after milestones (every 5 counted sessions), after a Lab visit, or at 3 sessions with none yet. */
  function backupDue(r, d) {
    if (!r) return null;
    var last = r.backups && isNum(r.backups.lastExportAt) ? r.backups.lastExportAt : null;
    var list = (d && d.countedList) || [];
    var n = list.length;
    var since = list.filter(function (x) { return !last || (isNum(x.t) && x.t > last); }).length;
    var labSince = (r.labVisits || []).filter(function (v) { return v && isNum(v.endedAt) && (!last || v.endedAt > last); }).length;
    if (labSince) return { reason: 'lab', since: since, last: last };
    if (!n) return null;
    if (!last) return n >= 3 ? { reason: 'first', since: since, last: null } : null;
    if (Math.floor(n / 5) > Math.floor((n - since) / 5)) return { reason: 'milestone', since: since, last: last };
    return null;
  }

  ui.screenKit = {
    records: records, derived: derived, now: now, dayKey: dayKey,
    fmtDate: fmtDate, fmtLongDate: fmtLongDate, fmtTime: fmtTime, fmtAgo: fmtAgo, fmtMinutes: fmtMinutes, pct: pct, daysBetween: daysBetween,
    family: family, trackName: trackName, chipName: chipName, chipLevel: chipLevel, levelText: levelText, chip: chip,
    setSettings: setSettings, watch: watch, page: page, section: section, clone: clone,
    MODES: MODES, HELP: HELP, BADGES: BADGES, labKind: labKind, labDue: labDue, backupDue: backupDue,
    MONTHS: MONTHS
  };

  // ------------------------------------------------------------------ Today
  var S = { root: null, off: [], plan: null, protocol: null, hideStyleHint: false, startBtn: null };

  var TASK_WORD = { nback: 'n-back', relations: 'relation', span: 'span', vsearch: 'visual search' };
  // Planner notes already said in the plain-words line, or too technical for the home screen.
  var HIDE_NOTE = { 'new-track': 1, free: 1, reflection: 1 };   // 'all-introduced' is shown (PLAN §4.4: the app says so)
  var NOTE_TEXT = { 'programme-complete': 'The 20-session programme is complete. Any training style works from here.' };
  var GROUP = { nback: 'N-back', relations: 'Relations', span: 'Span', vsearch: 'Search' };

  function taskOf(slot) { return slot.taskId || (slot.trackId ? family(slot.trackId) : null); }
  function numberWord(n) { return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n); }
  function joinAnd(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function describePlan(plan, d) {
    var slots = plan.slots || [];
    if (!slots.length) return '';
    if (plan.free) return 'Free play: choose the version, level and pace of each block. The coach suggests where to go.';
    if (plan.protocol) {
      var def = HF.protocols && HF.protocols.DEF && HF.protocols.DEF[plan.protocol];
      var what = plan.protocol === 'wang' ? 'Equal Steps' : plan.protocol === 'cao' ? (plan.caoArm === 'trad' ? 'traditional n-back with the days of the week' : 'executive n-back with the days of the week') : 'dual n-back';
      var tones = plan.protocol === 'jaeggi' && slots[0].set !== 'lettersAudio'
        ? ' The paper used spoken consonants; Long-Horizon plays tones unless you choose spoken letters in Settings.' : '';
      return slots.length + ' blocks of ' + what + ', following ' + (def ? def.label.split(' · ')[0] : 'the paper') + ' as closely as the paper allows.' + tones;
    }
    var warm = 0, count = {}, order = [], lesson = 0, checks = 0, reviews = 0;
    slots.forEach(function (s) {
      if (s.role === 'warmup') { warm++; return; }
      var t = taskOf(s);
      if (!t) return;
      if (!count[t]) { count[t] = 0; order.push(t); }
      count[t]++;
      if (s.purpose === 'check') checks++;
      if (s.purpose === 'review') reviews++;
    });
    slots.forEach(function (s) { if (s.lessonId) lesson++; });
    var parts = order.map(function (t) { return count[t] + ' ' + TASK_WORD[t] + (count[t] === 1 ? ' block' : ' blocks'); });
    var how = plan.phase === 'blocked' ? 'one version at a time' : plan.phase === 'serial' ? 'with versions taking turns'
      : plan.phase === 'random' ? 'in a mixed order' : '';
    var first = warm ? (warm === 1 ? 'A warm-up' : 'A warm-up for each task') + ', then ' : '';
    var line = first + (first ? joinAnd(parts) : joinAnd(parts).replace(/^./, function (x) { return x.toUpperCase(); })) + (how ? ', ' + how : '') + '.';
    var extra = [];
    if (checks) extra.push('It includes a check on a unit you passed earlier.');
    if (reviews) extra.push('It includes a short review.');
    if (plan.introduce && plan.introduce.length) {
      extra.push('New today: ' + joinAnd(plan.introduce.map(trackName)) + (lesson ? '. A short lesson comes first.' : '.'));
    } else if (lesson) extra.push('A short lesson comes first.');
    if (slots.some(function (s) { return s.strategyCard; })) extra.push('A strategy tip comes before the first blocks.');
    if (plan.reflection) extra.push('One short reflection question at the end.');
    return [line].concat(extra).join(' ');
  }

  /** What each slot will play as things stand (Phase 4, PQ-06): HF.engine.prepare knows a protocol's start level, a
   *  Mastery unit's version and cap and the warm-up rung, which the version's own level does not. Nothing is saved;
   *  the version's level is the fallback. */
  function slotPlays(plan, r, d) {
    return (plan.slots || []).map(function (s) {
      var tr = s.trackId && d.tracks ? d.tracks[s.trackId] : null;
      var out = { trackId: s.trackId || null, rung: tr ? tr.level : null };
      if (!s.trackId || !HF.engine || typeof HF.engine.prepare !== 'function') return out;
      try {
        var bp = HF.engine.prepare(s, r, d, { sessionId: plan.id });
        if (bp && bp.trackId && isNum(bp.rung)) { out.trackId = bp.trackId; out.rung = bp.rung; }
      } catch (e) { /* the version's level */ }
      return out;
    });
  }

  function planSteps(plan, d, plays) {
    return (plan.slots || []).map(function (s, i) {
      var p = (plays && plays[i]) || { trackId: s.trackId, rung: s.trackId && d.tracks && d.tracks[s.trackId] ? d.tracks[s.trackId].level : null };
      var t = p.trackId;
      var label = t ? chipName(t) + (isNum(p.rung) && s.role !== 'warmup' ? ' ' + chipLevel(t, p.rung) : '') : 'Block ' + (i + 1);
      var kind = s.role === 'warmup' ? 'warmup' : s.lessonId ? 'lesson' : s.purpose === 'check' ? 'check' : 'block';
      var task = taskOf(s);
      // no "(warm-up)" here: the session bar adds it to warm-up steps itself (Phase 4, PQ-08)
      return { label: label, group: s.role === 'warmup' ? 'Warm-up' : (GROUP[task] || 'Blocks'), kind: kind, state: 'todo' };
    });
  }

  /** Versions in the plan with the level each starts at, the ones with most blocks first (ties keep their order of
   *  appearance). */
  function distinctTracks(plan, plays) {
    var n = {}, rung = {}, out = [];
    (plan.slots || []).forEach(function (s, i) {
      var p = (plays && plays[i]) || { trackId: s.trackId, rung: null };
      if (!p.trackId) return;
      if (!(p.trackId in n)) { n[p.trackId] = 0; out.push(p.trackId); }
      n[p.trackId] += s.role === 'warmup' ? 0.5 : 1;
      if (s.role !== 'warmup' && !(p.trackId in rung) && isNum(p.rung)) rung[p.trackId] = p.rung;
    });
    return out.map(function (id, i) { return { id: id, n: n[id], i: i, rung: id in rung ? rung[id] : null }; })
      .sort(function (a, b) { return b.n - a.n || a.i - b.i; });
  }

  /** "Measure first" between Baseline 1 and Baseline 2 (Phase 4, PQ-02): Baseline 2 must come before the first
   *  counted session (one counted session makes it 'missed' for good), so Today leads to the Lab first. Returns the
   *  schedule's B2 entry ({ status: upcoming | due | overdue, dueFrom, dueTo }) or null. */
  function baselineGate(r, d) {
    if (!r || !HF.lab || typeof HF.lab.schedule !== 'function') return null;
    if (!((r.profile && r.profile.path === 'measure') || (r.labVisits || []).length)) return null;
    var sch = null;
    try { sch = HF.lab.schedule(r, d, Date.now()); } catch (e) { return null; }
    var b1 = null, b2 = null;
    ((sch && sch.plan) || []).forEach(function (p) { if (p.kind === 'B1') b1 = p; else if (p.kind === 'B2') b2 = p; });
    if (!b1 || b1.status !== 'done' || !b2) return null;
    return { upcoming: 1, due: 1, overdue: 1 }[b2.status] ? b2 : null;
  }
  function gateText(b2) {
    var when = b2.status === 'upcoming' && isNum(b2.dueFrom) ? 'It opens on ' + fmtDate(b2.dueFrom, { weekday: true }) + ', 2 to 7 days after Baseline 1.'
      : b2.status === 'due' && isNum(b2.dueTo) ? 'It is open now, until ' + fmtDate(b2.dueTo, { weekday: true }) + '.'
        : 'Its window has passed, but it still counts until your first training session.';
    return when + ' Take it before you train: once a session counts, Baseline 2 can no longer be taken.';
  }

  /** A session's blocks in time order, and its finished blocks: one per slot, never an interrupted attempt (a paused
   *  stream's partial run). Their count is the engine's session.completed (HF.engine.finishedSlots), recounted here so
   *  records saved before Phase 4 (CB-02: completed counted attempts) read the same. */
  function sessionBlocks(r, s) {
    var blocks = (r.blocks || []).filter(function (b) { return b && b.sessionId === s.id; }).sort(function (a, b) { return a.t - b.t; });
    var seen = {}, fin = blocks.filter(function (b) {
      if (b.interrupted) return false;
      var k = b.slotId ? 'slot:' + b.slotId : 'id:' + b.id;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    var n = fin.length;
    try { if (HF.engine && typeof HF.engine.finishedSlots === 'function') n = HF.engine.finishedSlots(blocks); } catch (e) { /* the local count */ }
    return { all: blocks, finished: fin, done: n };
  }

  /** Today's latest session when it was left unfinished (page closed mid-session); older open ones are stale. */
  function openSession(r) {
    var today = dayKey(Date.now()), latest = null;
    (r.sessions || []).forEach(function (s) {
      if (s && s.dayKey === today && isNum(s.startedAt) && (!latest || s.startedAt > latest.startedAt)) latest = s;
    });
    if (!latest || latest.endedAt) return null;
    if (latest.mode !== 'free' && isNum(latest.planned) && sessionBlocks(r, latest).done >= latest.planned) return null;
    return latest;
  }

  function start(params) {
    if (!HF.router) return;
    HF.router.go('session', params || {});
  }

  function cleanup() {
    S.off.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    S.off = [];
    S.startBtn = null;
  }

  function sessionCard(r, d) {
    var C = c();
    var open = openSession(r);
    if (open) return openSessionCard(r, d, open);
    var plan = null, t = Date.now();
    try {
      plan = HF.engine.plan(r, d, { now: t, protocolIds: S.protocol ? [S.protocol] : undefined });
    } catch (e) {
      if (root.console) console.error('[long-horizon] plan failed', e);
    }
    S.plan = plan;
    if (!plan) {
      return C.card({ tone: 'feature', level: 2, title: 'Next session', body: [h('p', { 'class': 'hf-soft' }, ['The next session could not be prepared. Try Free play, or reload the page.'])],
        actions: [C.button('Free play', { variant: 'secondary', go: 'free' })] });
    }
    var modeLabel = (HF.modes && HF.modes.label(plan.modeId)) || 'Varied';
    // computed by the planner now (Phase 4, CA-03): derived.today is cached for the day, but Sprint's 3 h and
    // Stretch's 20 h gaps depend on the hour
    var canCount = plan.counts ? plan.counts.ok !== false : (d.today && d.today.canCount ? d.today.canCount.ok !== false : true);
    var title, sub, body = [], actions = [];
    var notes = (plan.notes || []).filter(function (n) { return n && n.text && !HIDE_NOTE[n.code]; })
      .map(function (n) { return NOTE_TEXT[n.code] ? { code: n.code, text: NOTE_TEXT[n.code] } : n; });

    if (plan.free) {
      title = 'Free play';
      sub = 'You choose each block';
      body.push(h('p', { 'class': 'hf-soft' }, [describePlan(plan, d)]));
      var btn = C.button('Choose a block', { variant: 'primary', size: 'lg', kbd: 'Space', go: 'free' });
      S.startBtn = btn;
      actions.push(btn);
    } else if (!plan.slots || !plan.slots.length) {
      title = plan.protocol || plan.modeId === 'protocols' ? 'Protocols' : 'Next session';
      sub = modeLabel + ' training';
      if (!notes.length) body.push(h('p', { 'class': 'hf-soft' }, ['Nothing is planned for today.']));
      if ((plan.notes || []).some(function (n) { return /study/.test(n.code || ''); })) actions.push(C.button('Open the Lab', { variant: 'secondary', go: 'lab' }));
      else actions.push(C.button('Free play', { variant: 'secondary', go: 'free' }));
    } else {
      if (plan.protocol) {
        var def = HF.protocols && HF.protocols.DEF[plan.protocol];
        title = def ? def.label.split(' · ')[0] : 'Protocol';
        sub = (plan.protocolLabel ? plan.protocolLabel + ' · ' : '') + 'about ' + plan.estMinutes + ' minutes';
      } else {
        title = canCount ? 'Session ' + plan.sessionIndex : 'Extra practice';
        sub = modeLabel + ' training · about ' + plan.estMinutes + ' minutes';
      }
      var gate = baselineGate(r, d);
      S.gateShown = !!gate;
      if (gate) body.push(C.notice({ tone: 'info', title: 'Baseline 2 comes first', text: gateText(gate), cls: 'hf-today__b2' }));
      body.push(h('p', { 'class': 'hf-soft hf-today__what' }, [describePlan(plan, d)]));
      var plays = slotPlays(plan, r, d);
      var ids = distinctTracks(plan, plays);
      var lvl = function (x) { var tr = d.tracks && d.tracks[x.id]; return isNum(x.rung) ? x.rung : (tr ? tr.level : 0); };
      if (ids.length) {
        var shown = ids.slice(0, 4), rest = ids.slice(4);
        var chips = shown.map(function (x) {
          var node = chip(x.id, lvl(x));
          node.setAttribute('role', 'listitem');
          return node;
        });
        if (rest.length) {
          chips.push(h('span', { 'class': 'hf-today__more', role: 'listitem', title: rest.map(function (x) { return trackName(x.id); }).join(', ') }, [
            'and ' + rest.length + ' more ' + (rest.length === 1 ? 'version' : 'versions'),
            h('span', { 'class': 'hf-vh' }, [': ' + rest.map(function (x) { return chipName(x.id) + ' ' + chipLevel(x.id, lvl(x)); }).join(', ')])
          ]));
        }
        body.push(h('div', { 'class': 'hf-row hf-today__chips', role: 'list', 'aria-label': 'Versions and levels in this session' }, chips));
      }
      var steps = planSteps(plan, d, plays);
      body.push(C.sessionBar({ steps: steps, title: steps.length + ' blocks', now: 'Not started', labels: steps.length <= 6 ? 'all' : 'groups', label: 'Blocks in this session' }));
      if (plan.protocolStatus && plan.protocolStatus.filter(function (p) { return p.due && p.due.due; }).length > 1) {
        var opts = plan.protocolStatus.filter(function (p) { return p.due && p.due.due; }).map(function (p) {
          var def2 = HF.protocols.DEF[p.protocol];
          return { value: p.protocol, label: def2 ? def2.label.split(' · ')[0].replace(' et al.', '') : p.protocol };
        });
        body.push(C.segmented({ legend: 'Protocol today', name: 'hf-today-proto', options: opts, value: plan.protocol,
          onChange: function (v) { S.protocol = v; draw(); } }));
      }
      var params = { planId: plan.id };
      if (plan.protocol) params.protocol = plan.protocol;
      if (gate) {
        // the Lab is the one primary action; training first asks (PQ-02)
        var labBtn = C.button('Open the Lab', { variant: 'primary', size: 'lg', kbd: 'Space', go: 'lab', id: 'hf-today-lab' });
        var anyway = C.button('Start session', { variant: 'secondary', id: 'hf-today-start', onClick: function () {
          var ask = HF.dom && HF.dom.confirm ? HF.dom.confirm('Training now means Baseline 2 can no longer be taken. Start the session anyway?',
            { ok: 'Start session', cancel: 'Not now', title: 'Baseline 2 comes first' }) : Promise.resolve(true);
          ask.then(function (yes) { if (yes) start(params); });
        } });
        S.startBtn = labBtn;
        actions.push(labBtn, anyway);
      } else {
        var startBtn = C.button('Start session', { variant: 'primary', size: 'lg', kbd: 'Space', id: 'hf-today-start', onClick: function () { start(params); } });
        S.startBtn = startBtn;
        actions.push(startBtn);
      }
    }
    if (notes.length) {
      body.push(h('ul', { 'class': 'hf-today__notes' }, notes.map(function (n) { return h('li', null, [n.text]); })));
    }
    actions.push(C.button('Change training style', { variant: 'quiet', go: 'settings', attrs: { 'data-params': '{"section":"style"}' } }));
    return C.card({ tone: 'feature', level: 2, title: title, sub: sub, body: body, actions: actions, cls: 'hf-today__panel', id: 'hf-today-panel' });
  }

  function openSessionCard(r, d, s) {
    var C = c();
    // finished slots only: an interrupted attempt is not a block done (Phase 4, CB-02)
    var sb = sessionBlocks(r, s), blocks = sb.finished;
    var done = sb.done;
    // Free play has no plan: its placeholder slots are not "blocks left" (Phase 4, PQ-05)
    var free = s.mode === 'free';
    var total = free ? done : Math.max(isNum(s.planned) ? s.planned : done + 1, done + 1);
    var steps = [];
    for (var i = 0; i < total; i++) {
      var b = blocks[i];
      var label = b ? chipName(b.trackId) + ' ' + chipLevel(b.trackId, b.rung) : 'Block ' + (i + 1);
      steps.push({ label: label, group: b ? (b.role === 'warmup' ? 'Warm-up' : GROUP[family(b.trackId)] || 'Blocks') : '',
        kind: b && b.role === 'warmup' ? 'warmup' : 'block', state: i < done ? 'done' : i === done ? 'current' : 'todo' });
    }
    var modeLabel = (HF.modes && HF.modes.label(s.mode)) || '';
    var params = { resume: s.id };
    var cont = C.button(free ? 'Continue free play' : 'Continue session', { variant: 'primary', size: 'lg', kbd: 'Space', id: 'hf-today-continue', onClick: function () { start(params); } });
    S.startBtn = cont;
    var endBtn = C.button('End it here', { variant: 'quiet', onClick: function () { endOpen(s.id); } });
    var body = [h('p', { 'class': 'hf-soft' }, [free
      ? done + (done === 1 ? ' block' : ' blocks') + ' played. Continue to choose the next one, or end it here.'
      : done + ' of ' + total + ' blocks done. Pick up where you left off; the next block starts with its rule card.'])];
    if (steps.length) body.push(C.sessionBar({ steps: steps, now: '', label: 'Blocks in this session' }));
    return C.card({
      tone: 'feature', level: 2, title: free ? 'Free play in progress' : (isNum(s.sessionIndex) ? 'Session ' + s.sessionIndex : 'Session') + ' in progress',
      sub: (modeLabel && !free ? modeLabel + ' training · ' : '') + 'started ' + fmtTime(s.startedAt),
      body: body, actions: [cont, endBtn], cls: 'hf-today__panel', id: 'hf-today-panel'
    });
  }

  function endOpen(id) {
    var events = [];
    try {
      HF.store.mutate(function (r) {
        // End at the last block (+60 s), not now: a session left open for hours must not inflate its minutes.
        var lastT = 0;
        (r.blocks || []).forEach(function (b) { if (b.sessionId === id && b.t > lastT) lastT = b.t; });
        var endAt = lastT ? Math.min(Date.now(), lastT + 60000) : Date.now();
        var out = HF.engine.endSession(r, id, { now: endAt, endedBy: 'quit' });
        events = out.events || [];
        return out.records;
      });
    } catch (e) { if (root.console) console.error('[long-horizon] endSession failed', e); }
    var counted = events.some(function (e) { return e.type === 'session-counted' && e.counted; });
    try {
      HF.dom.toast(counted ? 'Session ended. It counts toward this week.' : 'Session ended. Every block you played is saved.', { kind: 'ok', timeout: 5000 });
    } catch (e2) { /* ignore */ }
    draw();
  }

  function weekCard(r, d) {
    var C = c();
    var wk = d.week;
    if (!wk) return null;
    var note;
    if (wk.paused && wk.target === 0) note = 'Your goal is paused this week. Rest well.';
    else if (wk.count === 0 && wk.freshStart) note = 'A fresh week. Any day works.';
    var kids = [C.weeklyRing({ done: wk.count || 0, target: Math.max(1, wk.target || 4), note: note })];
    if (wk.weeksMet > 0) kids.push(h('p', { 'class': 'hf-small hf-muted' }, ['Weekly target reached in ' + wk.weeksMet + (wk.weeksMet === 1 ? ' week' : ' weeks') + ' so far.']));
    var pr = d.programme;
    if (pr && isNum(pr.done) && pr.of) {
      var cells = [];
      for (var i = 0; i < pr.of; i++) cells.push(h('span', { 'class': 'hf-prog__cell' + (i < pr.done ? ' is-done' : '') }));
      kids.push(h('div', { 'class': 'hf-prog' }, [
        h('p', { 'class': 'hf-prog__text' }, [pr.complete ? 'Programme complete: ' + pr.of + ' sessions. Keep going in any style.' : 'Programme: ' + Math.min(pr.done, pr.of) + ' of ' + pr.of + ' sessions']),
        h('div', { 'class': 'hf-prog__bar', role: 'img', 'aria-label': Math.min(pr.done, pr.of) + ' of ' + pr.of + ' programme sessions done' }, cells)
      ]));
    }
    return C.card({ body: kids, cls: 'hf-mot hf-today__week' });
  }

  function notices(r, d) {
    var C = c(), out = [];
    var lab = labDue(r, d, Date.now());
    if (lab && lab.kind === 'B2' && S.gateShown) lab = null;   // the session card already leads to Baseline 2 (PQ-02)
    if (lab) {
      var full = { B1: 1, B2: 1, POST: 1, FU: 1 }[lab.kind];
      var mins = !lab.minutes ? ''
        : lab.part ? 'Next sitting: ' + (lab.part === 'A' ? 'the memory tests' : 'the reasoning and control tests') + ', about ' + lab.minutes + ' minutes. '
          : 'About ' + lab.minutes + ' minutes' + (full ? ', in two sittings if you like (memory, then reasoning and control)' : '') + '. ';
      var when = lab.notToday ? 'You have trained today, so pick another day: Lab visits go before training.' : 'Pick a quiet time of day you can repeat.';
      out.push(C.notice({ tone: 'info', title: lab.label + (lab.status === 'overdue' ? ' is still open' : ' is due'), text: mins + when,
        action: [C.button('Open the Lab', { variant: 'secondary', size: 'sm', go: 'lab' })], cls: 'hf-today__lab' }));
    }
    var bk = backupDue(r, d);
    if (bk) {
      var txt = bk.reason === 'lab' ? 'You finished a Lab visit since your last backup. Lab results cannot be repeated, so keep a copy.'
        : bk.last ? 'You have done ' + bk.since + (bk.since === 1 ? ' session' : ' sessions') + ' since your last backup on ' + fmtDate(bk.last) + '.'
          : 'Your progress lives only in this browser. A backup file keeps it safe if the browser data is cleared.';
      out.push(C.notice({ tone: 'info', title: 'Time for a backup', text: txt,
        action: [C.button('Back up now', { variant: 'secondary', size: 'sm', icon: 'download', onClick: function () {
          if (ui.backup && ui.backup.openModal) ui.backup.openModal(); else HF.router.go('progress', { section: 'backup' });
        } })], cls: 'hf-today__backup' }));
    }
    var sc = isNum(d.sessionsCounted) ? d.sessionsCounted : 0;
    var mode = r.settings && r.settings.mode;
    if (!S.hideStyleHint && sc >= 3 && sc <= 5 && mode === 'varied' && !lab) {
      out.push(C.notice({ tone: 'info', slim: true, title: 'Other training styles', text: 'You have a few sessions behind you. Sprint, Mastery Path and the published Protocols are there if you want them (Stretch opens after 6 counted sessions); levels carry over.',
        action: [C.button('See training styles', { variant: 'secondary', size: 'sm', go: 'settings', attrs: { 'data-params': '{"section":"style"}' } }),
          C.button('Not now', { variant: 'quiet', size: 'sm', onClick: function () { S.hideStyleHint = true; draw(); } })], cls: 'hf-today__hint' }));
    }
    return out;
  }

  function openBackup() { if (ui.backup && ui.backup.openModal) ui.backup.openModal(); else HF.router.go('progress', { section: 'backup' }); }
  function reloadPage() { try { root.location.reload(); } catch (e) { /* ignore */ } }

  /** Storage state (HF.store.status, Phase 4 CA-04/CA-05): memory mode with the store's own words for the cause
   *  (blocked | write-failed | quota | newer; 'newer' also offers Reload), and the "nearly full" Export prompt. The
   *  store notifies { source: 'status' } when either changes in a running page, and watch() redraws Today on it. */
  function storageNotices() {
    var C = c(), out = [];
    var st = HF.store && HF.store.status ? HF.store.status : {};
    if (HF.store && HF.store.persistent === false) {
      var acts = [C.button('Export now', { variant: 'secondary', size: 'sm', icon: 'download', onClick: openBackup })];
      if (st.reason === 'newer') acts.unshift(C.button('Reload', { variant: 'secondary', size: 'sm', id: 'hf-today-reload', onClick: reloadPage }));
      out.push(C.notice({ tone: 'warn', title: 'Not saved on this device',
        text: st.message || 'This page cannot save to the browser here (for example inside a preview), so progress lasts only while it stays open. Use Export to keep a copy.',
        action: acts, cls: 'hf-today__storage' }));
    } else if (st.saveError) {
      out.push(C.notice({ tone: 'warn', title: 'Saving failed', text: 'The browser refused to save the latest changes (' + st.saveError + '). Export a copy to be safe.',
        action: [C.button('Export now', { variant: 'secondary', size: 'sm', onClick: openBackup })] }));
    }
    if (st.nearFull && !(HF.store && HF.store.persistent === false)) {
      out.push(C.notice({ tone: 'warn', title: 'Storage nearly full', text: st.nearFullText || 'Long-Horizon’s saved data is getting large for this browser. Export a backup now.',
        action: [C.button('Export now', { variant: 'secondary', size: 'sm', icon: 'download', onClick: openBackup })], cls: 'hf-today__nearfull' }));
    }
    return out;
  }

  function draw() {
    var rootEl = S.root;
    if (!rootEl) return;
    var keepFocus = doc.activeElement && rootEl.contains(doc.activeElement) ? doc.activeElement.id : null;
    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
    S.startBtn = null;
    S.gateShown = false;
    var r = records() || {}, d = derived();
    var p = page({ title: 'Today', lead: fmtLongDate(Date.now()), cls: 'hf-today' });
    storageNotices().forEach(function (n) { p.node.appendChild(n); });
    p.node.appendChild(sessionCard(r, d));
    var side = [weekCard(r, d)].concat(notices(r, d)).filter(Boolean);
    if (side.length) p.node.appendChild(h('div', { 'class': 'hf-today__row' }, side));
    rootEl.appendChild(p.node);
    if (keepFocus) { var f = doc.getElementById(keepFocus); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  var screen = {
    title: 'Today',
    render: function (rootEl, params) {
      cleanup();
      S.root = rootEl;
      var r = records();
      if (r && r.profile && !r.profile.firstRunDone && HF.router && HF.router.has('welcome') && !(params && params.noRedirect)) {
        // Redirect after this render finishes, so the router's own bookkeeping (title, hash, focus) stays consistent.
        Promise.resolve().then(function () {
          var cur = HF.router.current;
          if (cur && cur.name === 'today') HF.router.go('welcome', {}, { replace: true });
        });
        return;
      }
      draw();
      S.off.push(watch(draw));
      if (HF.input && HF.input.on) {
        S.off.push(HF.input.on(function (ev) {
          if (ev.key !== 'next' || !S.startBtn || !doc.body.contains(S.startBtn)) return;
          if (HF.dom && HF.dom.openModals && HF.dom.openModals()) return;
          S.startBtn.click();
        }));
      }
    },
    leave: function () { cleanup(); S.root = null; }
  };

  ui.screens = ui.screens || {};
  ui.screens.today = screen;
  ui.today = { describePlan: describePlan, openSession: openSession, screen: screen };
  if (HF.router && HF.router.register) HF.router.register('today', screen);
})(typeof window !== 'undefined' ? window : globalThis);
