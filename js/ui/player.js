/* Long-Horizon — block player (js/ui/player.js). Browser only, ES2019, MIT licence. Owner: P1a.
 * docs/dev/contracts-ui.md §2; design and decisions in docs/dev/player-notes.md.
 *
 * One block: rule card → Start (Space, Enter or a tap; HF.audio.unlock() and HF.timing.keepAwake(true) run inside
 * that gesture) → 3-2-1 → the task with the chrome hidden (HF.timing.runStream / runDiscrete / view.run) → score →
 * HF.engine.commit through HF.store.mutate + HF.store.saveTrials → debrief (per blockPlan.feedback).
 * Pause (Esc / P / the pause button / page hidden / sound stopped) opens an overlay: Resume, How to play, End session.
 *   stream    the run stops at once; the partial run is committed with interrupted: true (nothing moves) and, on
 *             Resume, the block restarts after a 3-2-1 with a fresh sequence (seed + '/r1', '/r2' …);
 *   discrete  the item in progress is voided; Resume → 3-2-1 → HF.timing.resume(); the block is committed with
 *             interrupted: true (a block with a pause moves nothing);
 *   End       the run stops; the partial block is committed with interrupted: true; status 'quit'.
 *
 * HF.player.runBlock(blockPlan, opts) → Promise<{ status: 'done'|'quit'|'skipped', spec, log, result,
 *                                                  commit: null|{ events, block }, action, attempts }>
 *   blockPlan  HF.engine.prepare(...) output, or hand-built { trackId, rung, set, seed, role, params?, lureCount?,
 *              lureMode?, protocol?, ruleCard?, feedback?, assist? }
 *   opts { root*, ruleCard = true, countdown = true, feedback ('none'|'per-response'; default from
 *          blockPlan.feedback.perResponse), assist ({ tape, highlight } default both = blockPlan.assist), commit = true,
 *          debrief = true, allowQuit = true, sessionId, meta (rule-card corner text), note (extra rule-card line),
 *          strategy ({ title, text } | Node), index, total (debrief "Block 4 of 14"), continueLabel = 'Continue',
 *          debriefActions [{ id, label }], autoContinueMs = 0, onPhase(phase, info), endLabel = 'End session',
 *          endConfirm ({ text, ok, cancel, title }: End in the pause overlay asks with HF.dom.confirm first; Phase 4,
 *          UX-06; also accepted by runSpec) }
 *   status 'quit': End in the pause overlay (confirmed), or HF.player.abort(). action: the debrief button ('continue',
 *   'end' from the fatigue offer, or an id of debriefActions).
 * HF.player.runSpec(spec, viewKey, opts) → Promise<{ status, spec, log, result, action, attempts }>   Lab tests,
 *   probes, lessons: no commit, no debrief by default. opts { root*, ruleCard = false | true | { title, rule, keys,
 *   example, note }, countdown = true, score(spec, log), regenerate(k) → spec (after a stream pause; default: the
 *   task's generator with seed + '/r' + k when spec.task has one, else the same spec), feedback, assist, lab,
 *   chrome = true, debrief = false, onPhase }. Without a rule card there is no Start gesture: call HF.audio.unlock()
 *   in your own Start click when the spec has sound. The returned spec is the one actually played; attempts = runs of
 *   the block, so attempts − 1 = restarts after a stream pause (only the last run's log is returned; Phase 4, CB-06).
 * HF.player.countdown(root, { from = 3, stepMs = 1000, block }?) → Promise<'done'|'pause'|'abort'>   (a block's own
 *   3-2-1, before its run and before a resume, also resolves 'pause' when the page is hidden: Phase 4, CB-10)
 * HF.player.pauseOverlay(root, { reason, kind, onResume, onHelp, onEnd, help: Node, endLabel, endConfirm, allowEnd,
 *   block }) → { close(), el }    (HF.dom.modal; Escape = Resume; Resume unlocks audio for opts.block: Phase 4, CB-11;
 *   with endConfirm, End asks first and Escape closes only that confirm: UX-06)
 * HF.player.abort(reason?) → bool   stops whatever the player is doing (screens call it in leave()); a partial block
 *   is committed with interrupted: true at once; the pending runBlock resolves with status 'quit'.
 * HF.player.active, HF.player.phase ('idle'|'rule'|'countdown'|'run'|'paused'|'debrief'); opts.root gets
 *   data-hf-phase, the task element .hf-play gets data-i (trial on screen) for tests.
 * HF.player.plainLine(result, spec) → plain sentence; HF.player.levelWords(trackId, rung) → "3-back, fast pace"
 *   ("Step 4 of 9" on a Relation Grid tier, whose version name already says the tier: PQ-14);
 * HF.player.viewKeyFor(taskId | blockPlan) → 'nback' | 'relations' | 'span' | 'vsearch'
 * HF.player.horizonCheer(events, trackId) → 'Your horizon grew: now 4-back.' | '… now 5 items.' | null: the debrief's
 *   celebration line when a level-up raises n (n-back) or the list length (Span); otherwise "New level reached".
 * HF.player.config { countdownStepMs, feedbackGapMs, audioWaitMs }
 * HF.player.debug { timeScale: 1, simulate: null | 'correct' | 'none', countdownStepMs: null }   TEST HOOKS ONLY:
 *   timeScale shortens onMs/soaMs/windows of the played copy; simulate 'correct' answers every item from the spec
 *   without presenting it, 'none' never says match (BA .5); streams and discrete blocks only (custom view.run blocks
 *   always run). The app never sets them.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;

  var config = { countdownStepMs: 1000, feedbackGapMs: 340, audioWaitMs: 1500 };
  var debug = { timeScale: 1, simulate: null, countdownStepMs: null };
  var DEF_KEYS = { match: 'J', match2: 'K', no: 'F', next: 'Space' };
  var VIEW_OF = { nback: 'nback', relations: 'relations', span: 'span', vsearch: 'vsearch' };
  var FAMILY_OF = { nback: 'nback', relations: 'relations', span: 'span', vsearch: 'vsearch' };

  var current = null;      // the block in progress (one at a time)

  // ---------------------------------------------------------------- helpers
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function assign(dst) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (own(s, k)) dst[k] = s[k];
    }
    return dst;
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function perfNow() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function logErr(e) { if (root.console) console.error('[long-horizon] player', e); }
  function C() { return (HF.ui && HF.ui.c) || null; }
  function h(tag, attrs, kids) {
    var c = C();
    if (c && c.h) return c.h(tag, attrs, kids);
    var e = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (own(attrs, k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false && k !== 'on') e.setAttribute(k === 'className' ? 'class' : k, attrs[k] === true ? '' : String(attrs[k]));
    if (attrs && attrs.on) for (var ev in attrs.on) if (own(attrs.on, ev)) e.addEventListener(ev, attrs.on[ev]);
    (Array.isArray(kids) ? kids : [kids]).forEach(function (x) {
      if (x === null || x === undefined || x === false) return;
      e.appendChild(typeof x === 'object' ? x : doc.createTextNode(String(x)));
    });
    return e;
  }
  function button(label, o) {
    o = o || {};
    var c = C();
    if (c && c.button) return c.button(label, o);
    var b = h('button', { type: 'button', 'class': 'hf-btn hf-btn--' + (o.variant || 'secondary') }, label);
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function settings() {
    var st = HF.store;
    var r = st && st.loaded ? st.records : null;
    return (r && r.settings) || {};
  }
  function focusMode() { return !!settings().focusMode; }
  function keyLabel(k) {
    try { var l = HF.input && HF.input.labelFor ? HF.input.labelFor(k) : ''; if (l) return l; } catch (e) { /* ignore */ }
    return DEF_KEYS[k] || '';
  }
  function trackDef(id) { try { return HF.catalog && HF.catalog.get ? HF.catalog.get(id) : null; } catch (e) { return null; } }
  function taskOf(trackId) {
    var t = trackDef(trackId);
    if (t) return t.task;
    var p = String(trackId || '').split('.')[0];
    return p === 'rel' ? 'relations' : (p === 'vs' ? 'vsearch' : p);
  }
  function viewKeyFor(x) {
    var t = typeof x === 'string' ? x : (x && (x.taskId || taskOf(x.trackId)));
    return VIEW_OF[t] || t;
  }
  function setChrome(v) { try { if (HF.ui && HF.ui.shell && typeof HF.ui.shell.chrome === 'function') HF.ui.shell.chrome(v); } catch (e) { logErr(e); } }
  function focusEl(e) { if (!e) return; try { e.focus({ preventScroll: true }); } catch (x) { try { e.focus(); } catch (y) { /* ignore */ } } }
  function scrollTop() { try { root.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  function modalOpen() { return !!(HF.dom && HF.dom.openModals && HF.dom.openModals() > 0); }
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  function isControl(t) { return !!(t && t.closest && t.closest('button, a, summary, select, input, textarea, [role="button"]')); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function audioRunning() { try { return !!(HF.audio && HF.audio.state && HF.audio.state() === 'running'); } catch (e) { return false; } }
  function gesture(B) {
    try { if (HF.audio && HF.audio.unlock) { var p = HF.audio.unlock(); if (B) B.unlockP = p; } } catch (e) { logErr(e); }
    try { if (HF.timing && HF.timing.keepAwake) HF.timing.keepAwake(true); } catch (e2) { logErr(e2); }
  }
  function times(k) { return k === 1 ? 'once' : (k === 2 ? 'twice' : k + ' times'); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ---------------------------------------------------------------- cancellable waits
  // A run owns a list of pending waits; abort() resolves every one of them with 'abort'.
  function newRun() { return { aborted: false, waiters: [] }; }
  function wait(run, setup) {
    return new Promise(function (resolve) {
      var done = false, cleanup = null;
      var w = { cancel: function () { fin('abort'); } };
      function fin(v) {
        if (done) return;
        done = true;
        var i = run.waiters.indexOf(w);
        if (i >= 0) run.waiters.splice(i, 1);
        if (cleanup) { try { cleanup(); } catch (e) { logErr(e); } }
        resolve(v);
      }
      run.waiters.push(w);
      if (run.aborted) { fin('abort'); return; }
      var c0 = null;
      try { c0 = setup(fin); } catch (e) { logErr(e); fin('abort'); return; }
      if (done) { if (c0) { try { c0(); } catch (e2) { logErr(e2); } } }
      else cleanup = c0 || null;
    });
  }

  // ---------------------------------------------------------------- words
  function levelWords(trackId, rung) {
    if (!HF.catalog || !isNum(rung)) return '';
    var s = '';
    try { s = HF.catalog.levelLabel(trackId, rung); } catch (e) { return ''; }
    // every caller shows the version's name beside it, and a Grid version's name already says its tier: "Step 4 of 9",
    // not "Tier 1, step 4 of 9" (Phase 4, PQ-14; the same words as Today's levelText)
    s = s.replace(/^Tier \d+ · step /, 'Step ');
    return s.replace(/ · fast$/, ', fast pace').replace(/ · /g, ', ');
  }
  function nounsFor(spec) {
    var tid = (spec && spec.trackId) || '';
    if (tid === 'rel.steps') return 'equal steps';
    if (tid === 'rel.stream') return 'patterns';
    if (/^rel\.grid/.test(tid)) return 'patterns';
    if (tid === 'vs.search') return 'displays with a T';
    return 'matches';
  }
  /** The debrief's plain sentence, from result.plain (and result.streams for Dual). */
  function plainLine(r, spec) {
    if (!r) return 'Block done.';
    spec = spec || {};
    var p = r.plain, ex = r.extra || {}, tid = spec.trackId || r.trackId || '';
    if (spec.kind === 'span' || /^span\./.test(tid)) {
      if (!p) return 'Block done.';
      var mem = /^span\.op/.test(tid) ? 'letters' : 'items';
      var judged = isNum(p.nonTargets) ? p.nonTargets : 0, wrong = isNum(p.falsePresses) ? p.falsePresses : 0;
      return 'You recalled ' + p.caught + ' of ' + p.targets + ' ' + mem + ' in the right place' +
        (judged ? ', and judged ' + (judged - wrong) + ' of ' + judged + ' sums right.' : '.');
    }
    if (!p) return 'Block done.';
    var st = r.streams || {};
    if (st.pos && st.snd) {
      var fpd = (st.pos.fas || 0) + (st.snd.fas || 0);
      return 'Positions: you caught ' + st.pos.hits + ' of ' + (st.pos.hits + st.pos.misses) + '. Sounds: ' + st.snd.hits + ' of ' +
        (st.snd.hits + st.snd.misses) + '. ' + (fpd ? 'Extra presses: ' + fpd + '.' : 'No extra presses.');
    }
    var fp = p.falsePresses || 0;
    if (tid === 'vs.search') {
      var tvs = ex.timeouts && isNum(ex.timeouts.present) ? ex.timeouts.present + (ex.timeouts.absent || 0) : 0;
      return 'You spotted the T in ' + p.caught + ' of ' + p.targets + ' displays that had one' +
        (fp ? ' and said Present ' + times(fp) + ' when there was none.' : ', and never said Present when there was none.') +
        (tvs ? ' Time ran out on ' + tvs + '.' : '');
    }
    if (/^rel\.grid/.test(tid) || spec.kind === 'discrete') {
      var to = isNum(ex.timeouts) ? ex.timeouts : 0;
      return 'You found ' + p.caught + ' of ' + p.targets + ' ' + nounsFor(spec) +
        (fp ? ' and said Match ' + times(fp) + ' when there was none.' : ' and never said Match when there was none.') +
        (to ? ' Time ran out on ' + to + '.' : '');
    }
    return 'You caught ' + p.caught + ' of ' + p.targets + ' ' + nounsFor(spec) +
      (fp ? ' and pressed ' + times(fp) + ' when there was none.' : ' with no extra presses.');
  }
  function biasWords(c) {
    if (!isNum(c)) return '–';
    var w = c < -0.25 ? 'leans towards pressing' : (c > 0.25 ? 'leans towards waiting' : 'balanced');
    return (Math.round(c * 100) / 100).toFixed(2) + ' (' + w + ')';
  }

  // ---------------------------------------------------------------- spec helpers
  function genFor(task) { var T = HF.tasks && HF.tasks[task]; return T && typeof T.gen === 'function' ? T : null; }
  function genSpec(bp, seed, keep) {
    var task = bp.taskId || taskOf(bp.trackId), T = genFor(task);
    if (!T) throw new Error('no generator for ' + task);
    var o = { trackId: bp.trackId, rung: bp.rung, seed: seed };
    if (bp.params) o.params = assign({}, bp.params);
    if (keep && Object.keys(keep).length) {
      var base = o.params;
      if (!base) { try { base = HF.catalog && HF.catalog.params ? HF.catalog.params(bp.trackId, bp.rung) : {}; } catch (e) { base = {}; } }
      o.params = assign({}, base, keep);
    }
    if (bp.set) o.set = bp.set;
    if (isNum(bp.lureCount)) o.lureCount = bp.lureCount;
    if (bp.lureMode) o.lureMode = bp.lureMode;
    if (bp.protocol) o.protocol = bp.protocol;
    if (isNum(bp.targets)) o.targets = bp.targets;          // Wang-protocol Equal Steps: 10 (else the generator's 6)
    if (bp.lab) o.lab = true;
    return T.gen(o);
  }
  function regenFromSpec(spec, k, lab) {
    var T = genFor(spec.task);
    if (!T || !spec.trackId) return spec;
    var m = spec.meta || {};
    var o = { trackId: spec.trackId, rung: spec.rung, params: spec.params ? assign({}, spec.params) : undefined, set: spec.set,
      seed: String(spec.seed || 'spec') + '/r' + k };
    if (own(m, 'lurePlan')) {
      // the requested lure setting, not the lures generated (meta.lureCount adds the version's own lures, so a restart
      // got more lures each time: Phase 4, CA-08)
      if (isNum(m.lurePlan)) { o.lureCount = m.lurePlan; o.lureMode = 'controlled'; } else o.lureMode = 'uncontrolled';
    } else {
      if (isNum(m.lureCount)) o.lureCount = m.lureCount;
      if (m.lureMode) o.lureMode = m.lureMode;
    }
    if (m.protocol) o.protocol = m.protocol;
    if (m.targets && isNum(m.targets.main) && m.targets.main !== 6) o.targets = m.targets.main;
    if (lab || spec.set === 'glyphsLab' || spec.set === 'lab') o.lab = true;
    try { return T.gen(o); } catch (e) { logErr(e); return spec; }
  }
  /** The choices a fresh seed must not change on a restart (the rule card already showed them): rule, Transform step,
   *  Switch rate, two-feature choice. Only the seed (the item sequence) changes. */
  function keepParams(spec) {
    var p = (spec && spec.params) || {}, out = {};
    ['rule', 'sameFeature', 'step', 'switchRate'].forEach(function (k) { if (p[k] !== undefined && p[k] !== null) out[k] = p[k]; });
    return out;
  }
  function restartSpec(B) {
    var o = B.o;
    if (typeof o.regenerate === 'function') return o.regenerate(B.attempt) || B.spec;
    if (B.bp && B.bp.trackId && !o._specOnly) {
      try { return genSpec(B.bp, String(B.bp.seed || B.spec.seed) + '/r' + B.attempt, keepParams(B.spec)); }
      catch (e) { logErr(e); return B.spec; }
    }
    return regenFromSpec(B.spec, B.attempt, o.lab);
  }

  /** Copy of the spec with timings multiplied by debug.timeScale (test hook). */
  function scaled(spec) {
    var k = debug.timeScale;
    if (!(k > 0) || k === 1 || !spec) return spec;
    var F = ['onMs', 'soaMs', 'windowMs', 'itiMs', 'displayMs', 'procLimitMs', 'memMs'];
    function sc(o) { var u = assign({}, o); F.forEach(function (f) { if (isNum(u[f]) && u[f] > 0) u[f] = Math.max(60, Math.round(u[f] * k)); }); return u; }
    var s = sc(spec);
    if (Array.isArray(spec.trials)) s.trials = spec.trials.map(function (t) { return t && (t.windowMs != null || t.itiMs != null || t.displayMs != null) ? sc(t) : t; });
    return s;
  }
  function simulateLog(spec, mode) {
    if (!spec || !Array.isArray(spec.trials)) return null;
    var none = mode === 'none';
    var n = spec.trials.length, now = Date.now();
    if (spec.kind === 'stream') {
      var soa = spec.soaMs || 1000, streams = spec.streams || ['main'], responses = [], onsets = [];
      spec.trials.forEach(function (t, i) {
        onsets.push(i * soa);
        if (!none) streams.forEach(function (st) {
          if (t.target && t.target[st]) responses.push({ key: st === 'snd' ? 'match2' : 'match', t: i * soa + 450, trial: i, rt: 450, src: 'sim' });
        });
      });
      return { kind: 'stream', responses: responses, voided: [], paused: false, pause: null, aborted: false, n: n, presented: n,
        onsets: onsets, interval: 16.67, frame: null, flags: { late: [], stall: [] }, simulated: true, startedAt: now };
    }
    if (spec.kind === 'discrete') {
      return { kind: 'discrete', paused: false, pauses: [], aborted: false, n: n, presented: n, simulated: true, startedAt: now,
        answers: spec.trials.map(function (t, i) { return { i: t.i !== undefined ? t.i : i, response: none ? 'no' : (t.answer || null), rt: 700, voided: false, src: 'sim' }; }) };
    }
    return null;
  }
  /** A stopped run: items never shown are voided so the stored result counts only what was played. */
  function partialLog(log, spec) {
    if (!log || !spec || !Array.isArray(spec.trials)) return log;
    var n = spec.trials.length, pres = isNum(log.presented) ? log.presented : 0;
    if (Array.isArray(log.answers)) {
      return assign({}, log, { answers: log.answers.map(function (a, i) { return i >= pres ? assign({}, a, { voided: true, response: null, rt: null }) : a; }) });
    }
    var v = (log.voided || []).slice();
    for (var i = pres; i < n; i++) if (v.indexOf(i) < 0) v.push(i);
    return assign({}, log, { voided: v });
  }
  function scoreWith(B, spec, log) {
    try {
      if (typeof B.o.score === 'function') return B.o.score(spec, log);
      var T = HF.tasks && HF.tasks[spec.task || B.task];
      if (T && typeof T.score === 'function') return T.score(spec, log);
      var L = HF.lab && HF.lab.tests && HF.lab.tests[spec.testId || spec.task];
      if (L && typeof L.score === 'function') return L.score(spec, log);
    } catch (e) { logErr(e); }
    return null;
  }

  // ---------------------------------------------------------------- phases
  function phase(B, name, info) {
    B.phase = name;
    api.phase = name;
    try { if (B.o.root && B.o.root.setAttribute) B.o.root.setAttribute('data-hf-phase', name); } catch (e) { /* ignore */ }
    if (typeof B.o.onPhase === 'function') { try { B.o.onPhase(name, info || {}); } catch (e2) { logErr(e2); } }
  }

  // ---------------------------------------------------------------- rule card
  function padWords(text, trackId) {
    if (!text) return text;
    if (trackId === 'nback.dual') return text.replace(/\bPress J\b/g, 'Press Position').replace(/\bPress K\b/g, 'Press Sound');
    return text.replace(/\bPress J\b/g, 'Press Match').replace(/\bPress F\b/g, 'Press No');
  }
  function keyRows(trackId, spec) {
    var t = trackDef(trackId) || {}, task = t.task || spec.task;
    var n = (spec.params && spec.params.n) || (spec.meta && spec.meta.n) || null;
    var back = n ? (n === 1 ? '1 back' : n + ' back') : '';
    var S = HF.sets && HF.sets.get && spec.set ? HF.sets.get((spec.sets && spec.sets.main) || spec.set) : null;
    var none = { none: true, text: 'Do nothing', when: 'when it does not match. Doing nothing is an answer.' };
    if (trackId === 'nback.dual') {
      return [{ key: keyLabel('match'), pad: 'Position', yes: true, when: 'the place matches ' + back },
        { key: keyLabel('match2'), pad: 'Sound', yes: true, when: 'the sound matches ' + back },
        { none: true, text: 'Do nothing', when: 'when neither matches. Doing nothing is an answer.' }];
    }
    var w = null;
    if (trackId === 'nback.plain') w = 'the ' + ((S && S.noun) || 'item') + ' matches ' + back;
    else if (trackId === 'nback.transform') {
      var step = (spec.params && spec.params.step) || 1;
      var phrase = S && HF.sets.relPhrase ? HF.sets.relPhrase(S, step) : 'the next one after';
      w = 'it is ' + phrase + ' the one ' + back;
    } else if (trackId === 'nback.arith') w = 'the answer equals the answer ' + back;
    else if (trackId === 'nback.switch') w = 'the cued feature matches ' + back;
    else if (trackId === 'rel.steps') { w = 'the two steps are the same size'; none.when = 'when they differ. Doing nothing is an answer.'; }
    else if (trackId === 'rel.stream') { w = 'a row or column fits the rule'; none.when = 'until one does. Doing nothing is an answer.'; }
    if (w) return [{ key: keyLabel('match'), pad: 'Match', yes: true, when: w }, none];
    // the pads' own names (vsearch view: Absent / Present; span view: False / True) (Phase 4, UX-02)
    if (task === 'vsearch') return [{ key: keyLabel('match'), pad: 'Present', yes: true, when: 'there is a T' }, { key: keyLabel('no'), pad: 'Absent', when: 'there is no T' }];
    if (task === 'span') return [{ key: keyLabel('match'), pad: 'True', yes: true, when: 'the sum is right' }, { key: keyLabel('no'), pad: 'False', when: 'the sum is wrong' }];
    if (task === 'relations' || (t.keys && t.keys.indexOf('no') >= 0)) {
      return [{ key: keyLabel('match'), pad: 'Match', yes: true, when: 'one line fits the rule' }, { key: keyLabel('no'), pad: 'No', when: 'no line fits' }];
    }
    return [{ key: keyLabel('match'), pad: 'Match', yes: true, when: 'it matches' }, none];
  }
  function ruleData(B) {
    var bp = B.bp, spec = B.spec || {};
    if (B.o.ruleCard && typeof B.o.ruleCard === 'object') return B.o.ruleCard;
    var rc = bp && bp.ruleCard;
    if (!rc && HF.catalog && HF.catalog.ruleCard && (bp.trackId || spec.trackId)) {
      try { rc = HF.catalog.ruleCard(bp.trackId || spec.trackId, isNum(bp.rung) ? bp.rung : spec.rung, bp.set || spec.set, { step: spec.params && spec.params.step }); } catch (e) { rc = null; }
    }
    if (!rc) rc = { title: '', rule: (spec.meta && spec.meta.rule && spec.meta.rule.text) || 'Answer as the rule says.' };
    return rc;
  }
  function exampleNode(B, rc) {
    var V = HF.views && HF.views[B.viewKey];
    var tid = B.bp.trackId || B.spec.trackId;
    if (V && typeof V.example === 'function') {
      try {
        var ex = V.example({ trackId: tid, set: B.spec.set, sets: B.spec.sets, params: B.spec.params });
        if (ex && C() && C().tape) return C().tape(ex);
      } catch (e) { logErr(e); }
    }
    return rc.example || null;
  }
  /** Lab probes (runSpec with opts.lab, or a Lab spec) show no training level, tier or step anywhere. */
  function isLab(B) {
    var sp = B.spec || {}, m = sp.meta || {};
    return !!(B.o.lab || (B.bp && B.bp.lab) || sp.lab || m.lab || sp.testId || sp.set === 'glyphsLab' || sp.set === 'lab' || m.variant === 'lab');
  }
  function chipFor(B) {
    if (isLab(B)) return null;
    var tid = B.bp.trackId || B.spec.trackId, t = trackDef(tid);
    var rung = isNum(B.bp.rung) ? B.bp.rung : B.spec.rung;
    // "Grid T1 · step 4 of 9", "Stream · step 4 of 6": the name once, lower case after it as in Today's chips (PQ-14)
    return { family: FAMILY_OF[t ? t.task : B.task] || 'nback', name: t ? t.short : (B.spec.testId || ''), level: isNum(rung) && t ? levelWords(tid, rung).replace(/^Equal Steps, /, '').replace(/^Step /, 'step ') : '' };
  }
  function setLabel(B) {
    var s = (B.spec.sets && (B.spec.sets.pos ? null : B.spec.sets.main)) || B.spec.set;
    var S = s && HF.sets && HF.sets.get ? HF.sets.get(s) : null;
    if (B.spec.sets && B.spec.sets.pos) {
      var snd = HF.sets && HF.sets.get ? HF.sets.get(B.spec.sets.snd) : null;
      return 'Grid positions + ' + ((snd && snd.label) || 'sounds').toLowerCase();
    }
    return S ? S.label : '';
  }
  function strategyNode(st) {
    if (!st) return null;
    if (st.nodeType) return st;
    var c = C();
    if (c && c.notice) return c.notice({ tone: 'info', title: st.title || 'Strategy', text: st.text || '' , cls: 'hf-play__strategy' });
    return h('p', { 'class': 'hf-rule__note' }, (st.title ? st.title + ': ' : '') + (st.text || ''));
  }
  function helpNode(B) {
    var rc = ruleData(B), c = C(), tid = B.bp.trackId || B.spec.trackId;
    var kids = [h('p', { 'class': 'hf-modal__text hf-play__help-rule' }, padWords(rc.rule, tid))];
    var ex = rc.example && typeof rc.example === 'string' ? rc.example : null;
    if (ex) kids.push(h('p', { 'class': 'hf-rule__note' }, 'Example: ' + ex));
    if (c && c.keys) kids.push(c.keys(keyRows(tid, B.spec)));
    var how = null;
    try { how = HF.content && HF.content.howto && typeof HF.content.howto.forTrack === 'function' ? HF.content.howto.forTrack(tid) : null; } catch (e) { how = null; }
    if (how && how.tips && how.tips[0]) kids.push(h('p', { 'class': 'hf-rule__note' }, 'Tip: ' + how.tips[0]));
    return h('div', { 'class': 'hf-play__help' }, kids);
  }

  function showRuleCard(B) {
    var o = B.o, c = C(), rc = ruleData(B), tid = B.bp.trackId || B.spec.trackId;
    var root0 = o.root;
    clear(root0);
    scrollTop();
    var startBtn = button('Start', { variant: 'primary', kbd: 'Space', attrs: { 'data-autofocus': '' }, cls: 'hf-play__start' });
    var notes = [];
    if (o.note) notes.push(o.note);
    if (B.bp.role === 'warmup') notes.push('Warm-up: a little below your level. It never changes your level.');
    var card;
    if (c && c.ruleCard) {
      card = c.ruleCard({
        chip: chipFor(B), meta: o.meta || null, title: setLabel(B) || (isLab(B) ? '' : rc.title) || '',
        rule: padWords(rc.rule, tid), example: exampleNode(B, rc), keys: keyRows(tid, B.spec),
        note: notes.join(' ') || null, actions: [startBtn]
      });
    } else {
      card = h('section', { 'class': 'hf-rule' }, [h('h2', null, rc.title || ''), h('p', null, padWords(rc.rule, tid)), startBtn]);
    }
    var sn = strategyNode(o.strategy);
    if (sn) {
      var foot = card.querySelector('.hf-rule__foot');
      if (foot) card.insertBefore(sn, foot); else card.appendChild(sn);
    }
    var wrapEl = h('div', { 'class': 'hf-play-rule' }, card);
    root0.appendChild(wrapEl);
    focusEl(startBtn);
    return wait(B.run, function (fin) {
      function go() { gesture(B); fin('start'); }
      function onIn(ev) { if (ev.key === 'next' && !modalOpen()) go(); }
      function onKey(e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.repeat) { e.preventDefault(); return; }   // a held key must not start
        if (e.key !== 'Enter' || modalOpen() || isTyping(e.target) || isControl(e.target)) return;
        e.preventDefault();
        go();
      }
      startBtn.addEventListener('click', go);
      var off = HF.input && HF.input.on ? HF.input.on(onIn) : null;
      root.addEventListener('keydown', onKey, true);
      return function () {
        startBtn.removeEventListener('click', go);
        if (off) off();
        root.removeEventListener('keydown', onKey, true);
      };
    });
  }

  // ---------------------------------------------------------------- task stage
  function mountStage(B) {
    var o = B.o, View = HF.views && HF.views[B.viewKey];
    unmountStage(B);
    clear(o.root);
    scrollTop();
    var c = C();
    var chipO = c && c.levelChip && B.bp && (B.bp.trackId || B.spec.trackId) ? chipFor(B) : null;
    var chip = chipO ? c.levelChip(chipO) : null;
    var pauseBtn = button('Pause', { variant: 'quiet', icon: 'pause', iconOnly: true, cls: 'hf-play__pause', attrs: { 'aria-keyshortcuts': 'Escape' } });
    pauseBtn.addEventListener('click', function () { requestPause(B, 'button'); });
    var el = h('div', { 'class': 'hf-play hf-task', 'data-view': B.viewKey, tabindex: '-1', role: 'region', 'aria-label': 'Task' }, [
      h('div', { 'class': 'hf-play__top' }, [h('div', { 'class': 'hf-play__label' }, chip), pauseBtn]),
      h('div', { 'class': 'hf-play__view' }),
      h('div', { 'class': 'hf-play__count', 'aria-hidden': 'true' }),
      h('p', { 'class': 'hf-vh', role: 'status' }, '')
    ]);
    o.root.appendChild(el);
    var viewRoot = el.querySelector('.hf-play__view');
    var ctx = {
      assist: o.assist || {}, feedback: o.feedback === 'per-response' ? 'per-response' : 'none',
      hand: settings().leftHanded ? 'left' : 'right',
      keys: { match: keyLabel('match'), match2: keyLabel('match2'), no: keyLabel('no') },
      sound: settings().sound !== 'off', lab: !!o.lab
    };
    var view = View.create(viewRoot, B.spec, ctx);
    B.stage = { el: el, viewRoot: viewRoot, view: view, status: el.querySelector('[role="status"]') };
    B.needsAudio = !!(view && (typeof view.sound === 'function' || view.needsAudio));
    focusEl(el);
    return B.stage;
  }
  function unmountStage(B) {
    if (!B.stage) return;
    try { if (B.stage.view && typeof B.stage.view.destroy === 'function') B.stage.view.destroy(); } catch (e) { logErr(e); }
    if (B.stage.el && B.stage.el.parentNode) B.stage.el.parentNode.removeChild(B.stage.el);
    B.stage = null;
  }
  function wrapView(B, view) {
    var mark = B.stage.el;
    return {
      prepare: function (t) { if (typeof view.prepare === 'function') view.prepare(t); },
      show: function (t) { if (typeof view.show === 'function') view.show(t); if (t) mark.setAttribute('data-i', String(t.i !== undefined ? t.i : '')); },
      hide: function (t) { if (typeof view.hide === 'function') view.hide(t); }
    };
  }
  function requestPause(B, reason) {
    if (B.countdownPause) { B.countdownPause(reason); return; }
    if (B.custom && typeof B.custom.pause === 'function') { B.custom.pause(reason || 'button'); return; }
    if (HF.timing && HF.timing.active) HF.timing.pause(reason || 'button');
  }

  // ---------------------------------------------------------------- countdown
  function countdown(rootEl, opts) {
    opts = opts || {};
    var B = opts.block || null, run = opts.run || (B && B.run) || newRun();
    var step = debug.countdownStepMs || opts.stepMs || config.countdownStepMs;
    var host = rootEl && rootEl.querySelector ? rootEl.querySelector('.hf-play__count') : null, made = false;
    if (!host) {
      host = h('div', { 'class': 'hf-countdown', 'aria-hidden': 'true' });
      if (rootEl) rootEl.appendChild(host);
      made = true;
    }
    return wait(run, function (fin) {
      var k = opts.from || 3, timer = null;
      function tick() {
        if (k <= 0) { fin('done'); return; }
        host.textContent = String(k);
        host.classList.add('is-on');
        k--;
        timer = setTimeout(tick, step);
      }
      function pause(why) { if (B) B.countdownReason = why || 'key'; fin('pause'); }
      function onIn(ev) { if (ev.key === 'pause') pause('key'); }
      // A block's 3-2-1 (before its run and before a resume) pauses when the page is hidden, so the block never
      // starts or resumes unseen; HF.timing has no run to pause during a countdown (Phase 4, CB-10).
      function onVis() { if (doc.visibilityState === 'hidden') pause('hidden'); }
      function onHide() { pause('pagehide'); }
      var off = HF.input && HF.input.on ? HF.input.on(onIn) : null;
      if (B) {
        B.countdownReason = null;
        B.countdownPause = function (why) { pause(why); };
        doc.addEventListener('visibilitychange', onVis);
        root.addEventListener('pagehide', onHide);
      }
      if (B && doc.visibilityState === 'hidden') pause('hidden');
      else tick();
      return function () {
        clearTimeout(timer);
        if (off) off();
        if (B) {
          B.countdownPause = null;
          doc.removeEventListener('visibilitychange', onVis);
          root.removeEventListener('pagehide', onHide);
        }
        host.textContent = '';
        host.classList.remove('is-on');
        if (made && host.parentNode) host.parentNode.removeChild(host);
      };
    });
  }

  // ---------------------------------------------------------------- pause overlay
  var REASON_TEXT = {
    hidden: 'The page was hidden, so the block paused.',
    pagehide: 'The page was hidden, so the block paused.',
    audio: 'The sound stopped, so the block paused.'
  };
  function pauseOverlay(rootEl, opts) {
    opts = opts || {};
    var c = C(), handle = null, closed = false, opened = perfNow();
    var reasonText = REASON_TEXT[opts.reason] || 'Take a moment. Nothing is lost.';
    var after = opts.kind === 'stream' || opts.kind === 'countdown'
      ? 'Resume starts this block again with new items, after a 3-2-1.'
      : opts.kind === 'span' ? 'The list in progress will not count. Resume starts the next list, after a 3-2-1.'
        : (opts.kind === 'discrete' ? 'Resume continues with the next item, after a 3-2-1.' : 'Resume continues after a 3-2-1.');
    var resumeBtn = button('Resume', { variant: 'primary', attrs: { 'data-autofocus': '' } });
    var helpBtn = button('How to play', { variant: 'secondary' });
    var endBtn = opts.allowEnd === false ? null : button(opts.endLabel || 'End session', { variant: 'quiet' });
    var main = h('div', { 'class': 'hf-play__pause-main' }, [
      h('p', { 'class': 'hf-modal__text' }, reasonText + ' ' + after),
      opts.reason === 'audio' && HF.audio && HF.audio.HINT ? h('p', { 'class': 'hf-modal__text hf-small' }, HF.audio.HINT) : null,
      h('div', { 'class': 'hf-modal__actions' }, [endBtn, helpBtn, resumeBtn])
    ]);
    var backBtn = button('Back to the pause menu', { variant: 'secondary' });
    var helpBox = h('div', { 'class': 'hf-play__pause-help', hidden: true }, [
      opts.help || h('p', { 'class': 'hf-modal__text' }, 'Answer as the rule card says.'),
      h('div', { 'class': 'hf-modal__actions' }, [backBtn])
    ]);
    function done(kind) {
      if (closed) return;
      closed = true;
      if (api._overlay === out) api._overlay = null;
      if (handle) handle.close(kind);
      var fn = kind === 'end' ? opts.onEnd : opts.onResume;
      if (typeof fn === 'function') { try { fn(); } catch (e) { logErr(e); } }
    }
    // The block's unlock promise is replaced, so its audio check waits for this resume (Phase 4, CB-11: with the old
    // Start-click promise it checked at once, found the context still starting and asked for sound again).
    resumeBtn.addEventListener('click', function () { gesture(opts.block || null); done('resume'); });
    // opts.endConfirm { text, ok, cancel, title }: ask first, as the session's own End button does (Phase 4, UX-06). The
    // confirm stacks on this dialog: Escape or "Keep going" closes only the confirm and focus returns to End.
    var asking = false, askHandle = null;
    function dropAsk() {   // the overlay closed from outside (e.g. the route changed): the confirm goes with it
      if (askHandle && askHandle.isOpen) { try { askHandle.close(false); } catch (e) { logErr(e); } }
      askHandle = null;
    }
    if (endBtn) endBtn.addEventListener('click', function () {
      var ec = opts.endConfirm;
      if (!ec || !(HF.dom && typeof HF.dom.confirm === 'function')) { done('end'); return; }
      if (asking || closed) return;
      asking = true;
      HF.dom.confirm(ec.text || null, { ok: ec.ok, cancel: ec.cancel, title: ec.title }).then(function (yes) {
        asking = false; askHandle = null;
        if (yes) done('end');
      }, function () { asking = false; askHandle = null; });
      askHandle = HF.dom.topModal ? HF.dom.topModal() : null;   // the confirm just opened on top
    });
    helpBtn.addEventListener('click', function () {
      if (typeof opts.onHelp === 'function') { try { opts.onHelp(); } catch (e) { logErr(e); } return; }
      main.hidden = true; helpBox.hidden = false; focusEl(backBtn);
    });
    backBtn.addEventListener('click', function () { helpBox.hidden = true; main.hidden = false; focusEl(resumeBtn); });
    if (HF.dom && typeof HF.dom.modal === 'function') {
      handle = HF.dom.modal([main, helpBox], {
        title: 'Paused', className: 'hf-modal--pause', initialFocus: resumeBtn,
        onClose: function (v) {
          if (closed) return;
          // Escape (or the dialog closing by itself) = Resume
          gesture(opts.block || null);
          done(v === 'end' ? 'end' : 'resume');
        }
      });
      // A held Escape (auto-repeat) or one that arrives right after opening must not resume at once. On "How to play",
      // Escape goes back to the pause menu instead of on to the block (Phase 4, PQ-13).
      handle.dialog.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        if (e.repeat || perfNow() - opened < 350) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (!helpBox.hidden) { e.preventDefault(); e.stopImmediatePropagation(); helpBox.hidden = true; main.hidden = false; focusEl(resumeBtn); }
      }, true);
    } else {
      // no HF.dom (should not happen in the app): an inline panel
      handle = { el: h('div', { 'class': 'hf-play__pause-inline', role: 'dialog', 'aria-label': 'Paused' }, [h('h2', null, 'Paused'), main, helpBox]),
        close: function () { if (handle.el.parentNode) handle.el.parentNode.removeChild(handle.el); } };
      (rootEl || doc.body).appendChild(handle.el);
      focusEl(resumeBtn);
    }
    var out = {
      el: handle && (handle.dialog || handle.el),
      close: function () { if (closed) return; closed = true; dropAsk(); if (handle) handle.close('closed'); if (api._overlay === out) api._overlay = null; }
    };
    api._overlay = out;
    return out;
  }
  function pauseDecision(B, info) {
    return wait(B.run, function (fin) {
      phase(B, 'paused', info);
      // Opened on the next task: a <dialog> shown while the Escape keydown that paused is still being handled would
      // be cancelled at once by the browser's own Escape handling (it is not prevented outside a running block).
      var ov = null, closed = false;
      var timer = setTimeout(function () {
        if (closed) return;
        ov = pauseOverlay(B.stage ? B.stage.el : B.o.root, {
          reason: info && info.reason, kind: info && info.kind, help: helpNode(B), endLabel: B.o.endLabel,
          endConfirm: B.o.endConfirm || null, allowEnd: B.o.allowQuit !== false, block: B,
          onResume: function () { fin('resume'); }, onEnd: function () { fin('end'); }
        });
      }, 0);
      return function () { closed = true; clearTimeout(timer); if (ov) ov.close(); };
    });
  }

  // ---------------------------------------------------------------- audio check
  function ensureAudio(B) {
    var p = B.unlockP || (HF.audio && HF.audio.unlock ? HF.audio.unlock() : null);
    var waitP = p ? Promise.race([Promise.resolve(p).catch(function () { return null; }), delay(config.audioWaitMs)]) : Promise.resolve();
    return waitP.then(function () {
      if (audioRunning()) return 'ok';
      var c = C(), box = B.stage ? B.stage.viewRoot : B.o.root;
      return wait(B.run, function (fin) {
        var retry = button('Turn sound on', { variant: 'primary' });
        var skip = button('Skip this block', { variant: 'secondary' });
        var n0 = c && c.notice ? c.notice({ tone: 'warn', title: 'This block needs sound', text: (HF.audio && HF.audio.HINT) || 'Turn the sound on and try again.', action: [skip, retry] })
          : h('div', { 'class': 'hf-notice' }, ['This block needs sound.', skip, retry]);
        var holder = h('div', { 'class': 'hf-play__audio' }, n0);
        box.appendChild(holder);
        focusEl(retry);
        retry.addEventListener('click', function () {
          var pp = null;
          try { pp = HF.audio.unlock(); } catch (e) { pp = null; }
          Promise.race([Promise.resolve(pp).catch(function () { return null; }), delay(config.audioWaitMs)]).then(function () {
            if (audioRunning()) fin('ok');
          });
        });
        skip.addEventListener('click', function () { fin('skip'); });
        return function () { if (holder.parentNode) holder.parentNode.removeChild(holder); };
      });
    });
  }

  // ---------------------------------------------------------------- one run of the stimuli
  function runOnce(B) {
    var spec = B.spec, view = B.stage.view, o = B.o;
    var fbOn = o.feedback === 'per-response' && typeof view.feedback === 'function';
    var lastFb = -1e9;
    function flash(outcome, key) {
      var t = perfNow();
      if (t - lastFb < config.feedbackGapMs) return;
      lastFb = t;
      try { view.feedback(outcome, key); } catch (e) { logErr(e); }
    }
    var coreCtl = {
      resume: function () { if (HF.timing && HF.timing.paused) HF.timing.resume(); },
      abort: function () { if (HF.timing && HF.timing.active) HF.timing.abort('end'); }
    };
    var offPause = HF.timing && HF.timing.onPause ? HF.timing.onPause(function (info) {
      if (B.aborted || B.custom) return;
      if (info.kind === 'stream') { B.streamPause = info; return; }
      if (B.pausing) return;
      B.pausing = true;
      setTimeout(function () { pauseFlow(B, info, coreCtl); }, 0);
    }) : null;
    var p;
    var sim = debug.simulate ? simulateLog(spec, debug.simulate) : null;
    if (sim) {
      p = delay(30).then(function () { return sim; });
    } else if (typeof view.run === 'function') {
      // custom flow (Span): the view runs itself, reports pauses through onPause and resumes / aborts on request
      B.custom = view;
      var viewCtl = {
        resume: function () { if (typeof view.resume === 'function') view.resume(); },
        abort: function () { if (typeof view.abort === 'function') view.abort(); else if (HF.timing && HF.timing.active) HF.timing.abort('end'); }
      };
      p = Promise.resolve(view.run({
        timing: HF.timing, input: HF.input, spec: spec, feedback: fbOn ? flash : null, onProgress: function () { /* reserved */ },
        onPause: function (info) {
          if (B.aborted || B.pausing) return;
          B.pausing = true;
          setTimeout(function () { pauseFlow(B, assign({ kind: 'custom' }, info || {}), viewCtl); }, 0);
        }
      }));
    } else {
      var played = scaled(spec);
      var ro = assign({}, view.runOpts || {});
      if (spec.kind === 'stream') {
        if (!ro.keys) ro.keys = spec.streams && spec.streams.length > 1 ? ['match', 'match2'] : ['match'];
        if (typeof view.sound === 'function') ro.sound = function (t, when) { view.sound(t, when); };
        if (fbOn) ro.onResponse = function (resp, trial) {
          if (!trial || trial.scorable === false) return;
          var st = resp.key === 'match2' ? 'snd' : (spec.streams && spec.streams.length > 1 ? 'pos' : (spec.streams ? spec.streams[0] : 'main'));
          flash(trial.target && trial.target[st] ? 'good' : 'bad', resp.key);
        };
        if (isNum(ro.leadMs) && debug.timeScale !== 1 && debug.timeScale > 0) ro.leadMs = Math.max(500, Math.round(ro.leadMs * debug.timeScale));
        p = HF.timing.runStream(played, wrapView(B, view), ro);
      } else {
        if (!ro.keys) ro.keys = ['match', 'no'];
        if (fbOn) ro.onResponse = function (ans, trial) {
          if (!trial || !trial.answer) return;
          flash(ans.response === trial.answer ? 'good' : 'bad', ans.response);
        };
        p = HF.timing.runDiscrete(played, wrapView(B, view), ro);
      }
    }
    return Promise.resolve(p).then(function (log) {
      if (offPause) offPause();
      B.custom = null;
      return log;
    }, function (e) {
      if (offPause) offPause();
      B.custom = null;
      throw e;
    });
  }
  /** Discrete and custom runs stay paused in place: overlay → Resume → 3-2-1 → ctl.resume(), or End → ctl.abort(). */
  function pauseFlow(B, info, ctl) {
    if (B.aborted) { B.pausing = false; return; }
    pauseDecision(B, info).then(function (d) {
      if (d === 'abort') { B.pausing = false; return; }
      if (d === 'end') { B.pausing = false; B.ended = true; ctl.abort(); return; }
      phase(B, 'countdown');
      countdown(B.stage ? B.stage.el : B.o.root, { block: B }).then(function (r) {
        if (r === 'done') { B.pausing = false; phase(B, 'run'); ctl.resume(); }
        else if (r === 'pause') pauseFlow(B, { kind: info.kind || 'discrete', reason: B.countdownReason || 'key' }, ctl);
        else B.pausing = false;
      });
    });
  }

  // ---------------------------------------------------------------- commit
  function bpForAttempt(B) {
    if (!B.attempt) return B.bp;
    return assign({}, B.bp, { seed: B.spec.seed, attempt: (B.bp.attempt || 0) + B.attempt });
  }
  function doCommit(B, spec, log, result, interrupted) {
    if (!B.o.commit || !B.bp || !HF.engine || !HF.store || typeof HF.store.mutate !== 'function') return null;
    var bp = bpForAttempt(B), c = null;
    var sid = B.o.sessionId || bp.sessionId || 'session';
    try {
      HF.store.mutate(function (r) {
        c = HF.engine.commit(r, bp, spec, result, {
          now: Date.now(), sessionId: sid, t: B.startedAt || Date.now(), interrupted: !!interrupted,
          frame: log && log.frame ? log.frame : null
        });
        return c.records;
      });
    } catch (e) { logErr(e); return null; }
    try {
      if (log && c && c.block) HF.store.saveTrials(sid, c.block.id, assign({}, log, { seed: spec.seed, attempt: bp.attempt || 0, interrupted: !!interrupted }), { kind: 'training' });
    } catch (e2) { logErr(e2); }
    try { if (typeof HF.store.flush === 'function') HF.store.flush(); } catch (e3) { logErr(e3); }
    return c;
  }
  /** A stopped run (paused stream, End, leave): committed once with interrupted: true when items were shown. */
  function commitPartial(B, log) {
    if (!log || B.partials.indexOf(log) >= 0) return null;
    B.partials.push(log);
    if (!(log.presented > 0)) return null;
    var pl = partialLog(log, B.spec);
    var result = scoreWith(B, B.spec, pl);
    var c = doCommit(B, B.spec, pl, result, true);
    if (c) B.partialCommits.push(c);
    return c;
  }

  // ---------------------------------------------------------------- debrief
  // "Your horizon grew" (Long-Horizon copy, 13 Nov 2026): when a level-up raises n (n-back family; not a pace or cue
  // half-step) or the list length (Span), the celebration line names the new horizon instead of "New level reached".
  function horizonCheer(events, trackId) {
    var t = trackDef(trackId);
    if (!t || (t.task !== 'nback' && t.task !== 'span') || !HF.catalog || !HF.catalog.params) return null;
    for (var i = 0; i < (events || []).length; i++) {
      var e = events[i];
      if (!e || e.type !== 'level-up' || e.trackId !== trackId || (e.reveal && e.reveal !== 'now') || !isNum(e.from) || !isNum(e.to)) continue;
      try {
        var a = HF.catalog.params(trackId, e.from), b = HF.catalog.params(trackId, e.to);
        if (t.task === 'nback' && b.n > a.n) return 'Your horizon grew: now ' + b.n + '-back.';
        if (t.task === 'span' && b.setSize > a.setSize) return 'Your horizon grew: now ' + b.setSize + ' items.';
      } catch (x) { return null; }
    }
    return null;
  }
  function eventNotes(events, trackId) {
    var out = [];
    (events || []).forEach(function (e) {
      if (!e || (e.reveal && e.reveal !== 'now')) return;
      if (e.type === 'tier-open') out.push('New: ' + e.label + ' is open' + (e.optional ? ' (optional, very hard: turn it on in Settings)' : '') + ' — a short lesson comes first.');
      else if (e.type === 'track-available') out.push('New: ' + e.label + ' is open — a short lesson comes first.');
      else if (e.type === 'unit-passed') out.push(e.stage === 'check' ? 'Check passed: ' + e.label + '.' : 'Unit passed: ' + e.label + '. A check on fresh items comes in a later session.');
      else if (e.type === 'check-failed') out.push(e.movedOn ? 'You have moved on from ' + e.label + '.' : 'Check not passed yet: ' + e.label + '. A short practice cycle comes next.');
      else if (e.type === 'assist-faded') out.push(taskOf(e.trackId || trackId) === 'nback' ? 'The memory tape is now off: you reached the check twice with it.'
        : 'The highlighting is now off: you reached the check twice with it.');
    });
    return out;
  }
  function detailsNode(B, result, log) {
    var c = C(), rows = [], r = result || {}, st = r.streams || {}, keys = Object.keys(st);
    var names = { main: '', pos: 'Positions', snd: 'Sounds', proc: 'Sums' };
    function nm(k, label) { return names[k] ? names[k] + ': ' + label : cap(label); }
    if (isNum(r.dprime)) rows.push({ label: 'Sensitivity (d′)', value: (Math.round(r.dprime * 100) / 100).toFixed(2), hint: 'higher = better at telling matches from the rest' });
    if (isNum(r.crit)) rows.push({ label: 'Response bias', value: biasWords(r.crit), hint: 'near 0 is balanced' });
    keys.forEach(function (k) {
      var s = st[k] || {};
      if (keys.length > 1 && isNum(s.ba)) rows.push({ label: nm(k, 'score'), value: Math.round(s.ba * 100) + '%' });
      // one name for these items everywhere: "lure" (the executive versions' lures are not all one step off; UX-09)
      if (isNum(s.lureTrials) && s.lureTrials > 0) rows.push({ label: nm(k, 'lures'), value: 'pressed on ' + (s.lureFas || 0) + ' of ' + s.lureTrials, hint: 'items that almost fit the rule (Glossary: Lure)' });
      if (isNum(s.rtMedian)) rows.push({ label: nm(k, 'reaction time'), value: Math.round(s.rtMedian) + ' ms', hint: 'median, on matches' });
    });
    if (r.extra && isNum(r.extra.leadInPresses) && r.extra.leadInPresses > 0) rows.push({ label: 'Presses before the first possible match', value: String(r.extra.leadInPresses) });
    if (isNum(r.nVoided) && r.nVoided > 0) rows.push({ label: 'Items not counted', value: String(r.nVoided), hint: 'the screen or the page hiccupped; never charged to you' });
    if (log && log.simulated) rows.push({ label: 'Note', value: 'simulated answers (test mode)' });
    var dl = c && c.dl ? c.dl(rows) : h('div', null, rows.map(function (x) { return x.label + ': ' + x.value; }).join(' · '));
    var why = (r.why || []).filter(function (w) { return w && w.outcome !== 'hit' && w.outcome !== 'cr'; }).slice(0, 6);
    var list = why.length ? h('div', { 'class': 'hf-play__why' }, [
      h('p', { 'class': 'hf-play__why-title' }, why.length === 1 ? 'The one to look at again' : 'The ones to look at again'),
      h('ul', { 'class': 'hf-play__why-list' }, why.map(function (w) { return h('li', null, w.text); }))
    ]) : null;
    return h('div', { 'class': 'hf-play__details' }, [dl, list]);
  }
  /** The starting level of a version with no rated block before this one, when this block set it: a warm-up whose
   *  result moved the learner model's start (the block record still holds the old guess), or a first rated block that
   *  moved down. null otherwise. From the derived state after the commit. */
  function startLevel(block, cm) {
    var tr = cm && cm.derived && cm.derived.tracks ? cm.derived.tracks[block.trackId] : null;
    if (!tr || !isNum(tr.level) || block.protocol) return null;
    if (block.role === 'warmup') return tr.ratedBlocks === 0 && tr.level !== block.levelAfter ? tr.level : null;
    return isNum(block.moved) && block.moved < 0 && tr.ratedBlocks === 1 ? tr.level : null;
  }
  function showDebrief(B, info) {
    var o = B.o, c = C(), bp = B.bp, spec = B.spec, r = info.result, cm = info.commit;
    var fb = (bp && bp.feedback) || { summary: true, showLevel: true };
    var events = cm ? cm.events || [] : [];
    var tid = bp.trackId || spec.trackId;
    var block = cm ? cm.block : null;
    var interrupted = !!info.interrupted;
    var showSummary = fb.summary !== false;
    var line;
    if (interrupted) line = 'This block had a pause, so it does not change your level.';
    else if (showSummary) line = plainLine(r, spec);
    else line = 'Block done.';
    var count = isNum(o.index) && isNum(o.total) ? (bp.role === 'warmup' ? 'Warm-up · ' : '') + 'Block ' + o.index + ' of ' + o.total : (bp.role === 'warmup' ? 'Warm-up' : null);
    var next = null, nextLabel = null, dir = null, notes = [];
    var startAt = block && !interrupted ? startLevel(block, cm) : null;
    if (block && fb.showLevel !== false && !bp.protocol && startAt !== null) {
      // a new version's starting level, not a drop (Phase 4 QA follow-up)
      nextLabel = 'Starting level';
      next = levelWords(tid, startAt);
      notes.push(block.role === 'warmup' ? 'This warm-up set the starting level for this version.' : 'Your first block on this version set its starting level.');
    } else if (block && fb.showLevel !== false && !bp.protocol) {
      nextLabel = 'Your level';
      next = levelWords(tid, block.levelAfter);
      dir = block.moved > 0 ? 'up' : (block.moved < 0 ? 'down' : 'same');
      if (bp.role === 'warmup' && !interrupted) notes.push('Warm-ups never change your level.');
      else if (block.reason === 'off-level') notes.push('Played away from your level, so your level stays where it was.');
      else if (block.reason === 'capped') notes.push('This unit stops at its target level.');
    } else if (block && bp.protocol && fb.showLevel !== false) {
      nextLabel = 'Next block';
      next = levelWords(tid, block.levelAfter);
      dir = block.moved > 0 ? 'up' : (block.moved < 0 ? 'down' : 'same');
    }
    var celebrate = null;
    if (!interrupted && !focusMode()) {
      if (events.some(function (e) { return e.type === 'level-up' && e.trackId === tid && (!e.reveal || e.reveal === 'now'); })) celebrate = 'level';
      else if (events.some(function (e) { return e.type === 'pb' && (!e.reveal || e.reveal === 'now'); })) celebrate = 'best';
    }
    notes = notes.concat(eventNotes(events, tid));
    var fatigue = events.some(function (e) { return e.type === 'fatigue'; });
    var root0 = o.root;
    clear(root0);
    scrollTop();
    var contBtn = button(o.continueLabel || 'Continue', { variant: 'primary', kbd: 'Space', attrs: { 'data-autofocus': '' } });
    var extra = (o.debriefActions || []).map(function (a) {
      var b = button(a.label, { variant: a.variant || 'secondary', cls: 'hf-play__act' });
      b.setAttribute('data-action', a.id);
      return b;
    });
    var auto = isNum(o.autoContinueMs) && o.autoContinueMs > 0 && !fatigue && !notes.length ? o.autoContinueMs : 0;
    var autoText = auto ? 'Next block in ' + Math.round(auto / 1000) + ' s' : null;
    var node;
    var showScore = showSummary && !interrupted && r && isNum(r.ba);
    if (c && c.debrief) {
      node = c.debrief({
        count: count, chip: chipFor(B), line: line, celebrate: celebrate, cheer: celebrate === 'level' ? horizonCheer(events, tid) : null,
        score: showScore ? r.ba : null, scoreLabel: 'Block score', next: next, nextLabel: nextLabel, dir: dir,
        details: showSummary && r && !interrupted ? detailsNode(B, r, info.log) : null, detailsLabel: 'Details',
        actions: extra.concat([contBtn]), auto: autoText
      });
    } else {
      node = h('section', { 'class': 'hf-debrief' }, [h('h2', null, line), next ? h('p', null, (nextLabel || '') + ': ' + next) : null, h('div', null, extra.concat([contBtn]))]);
    }
    var extras = [];
    notes.forEach(function (t) { extras.push(c && c.notice ? c.notice({ tone: 'info', text: t, slim: true }) : h('p', null, t)); });
    var endBtn = null;
    if (fatigue) {
      endBtn = button('End session now', { variant: 'secondary' });
      endBtn.setAttribute('data-action', 'end');
      extras.push(c && c.notice
        ? c.notice({ tone: 'info', title: 'Time for a break?', text: 'Your last two blocks were well below how you started. Stopping here is fine: everything so far is kept.', action: endBtn })
        : h('div', null, ['Time for a break?', endBtn]));
    }
    if (extras.length) {
      var factsAt = node.querySelector('.hf-debrief__details, details, .hf-debrief__actions');
      extras.forEach(function (x) { if (factsAt && factsAt.parentNode === node) node.insertBefore(x, factsAt); else node.appendChild(x); });
    }
    root0.appendChild(h('div', { 'class': 'hf-play-debrief' }, node));
    focusEl(contBtn);
    var autoEl = node.querySelector('.hf-debrief__auto');
    return wait(B.run, function (fin) {
      var left = auto, iv = null;
      function stopAuto() { if (iv) { clearInterval(iv); iv = null; } if (autoEl) autoEl.textContent = ''; }
      if (auto) {
        iv = setInterval(function () {
          if (modalOpen()) return;                 // e.g. "End the session?" is open: wait
          left -= 1000;
          if (left <= 0) { stopAuto(); fin('continue'); return; }
          if (autoEl) autoEl.textContent = 'Next block in ' + Math.round(left / 1000) + ' s';
        }, 1000);
      }
      function onCont() { fin('continue'); }
      function onAct(e) { var a = e.currentTarget.getAttribute('data-action'); fin(a || 'continue'); }
      function onIn(ev) { if (ev.key === 'next' && !modalOpen()) fin('continue'); }
      function onKey(e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.repeat) { e.preventDefault(); return; }
        if (e.key !== 'Enter' || modalOpen() || isTyping(e.target) || isControl(e.target)) { if (auto && e.key !== 'Enter' && e.key !== ' ') stopAuto(); return; }
        e.preventDefault();
        fin('continue');
      }
      function onPointer(e) { if (e.target !== contBtn && !contBtn.contains(e.target)) stopAuto(); }
      contBtn.addEventListener('click', onCont);
      var acts = extra.slice();
      if (endBtn) acts.push(endBtn);
      acts.forEach(function (b) { b.addEventListener('click', onAct); });
      var off = HF.input && HF.input.on ? HF.input.on(onIn) : null;
      root.addEventListener('keydown', onKey, true);
      node.addEventListener('pointerdown', onPointer);
      var det = node.querySelector('details');
      if (det) det.addEventListener('toggle', stopAuto);
      return function () {
        stopAuto();
        contBtn.removeEventListener('click', onCont);
        acts.forEach(function (b) { b.removeEventListener('click', onAct); });
        if (off) off();
        root.removeEventListener('keydown', onKey, true);
        node.removeEventListener('pointerdown', onPointer);
        if (det) det.removeEventListener('toggle', stopAuto);
      };
    });
  }

  // ---------------------------------------------------------------- the block flow
  function newBlock(bp, spec, o, viewKey) {
    return {
      bp: bp || {}, spec: spec, o: o, viewKey: viewKey, task: (bp && (bp.taskId || taskOf(bp.trackId))) || (spec && spec.task),
      run: newRun(), attempt: 0, stage: null, phase: 'idle', aborted: false, ended: false, partials: [], partialCommits: [],
      pendingPartial: null, streamPause: null, pausing: false, countdownPause: null, countdownReason: null, unlockP: null,
      startedAt: null, custom: null
    };
  }
  function result(B, status, extra) {
    return assign({ status: status, spec: B.spec, log: B.log || null, result: B.result || null, commit: null, action: null,
      attempts: B.attempt + 1, aborted: !!B.aborted }, extra || {});
  }
  function unavailable(B, text) {
    var c = C(), root0 = B.o.root;
    clear(root0);
    var cont = button('Continue', { variant: 'primary', attrs: { 'data-autofocus': '' } });
    root0.appendChild(h('div', { 'class': 'hf-play-rule' }, c && c.notice ? c.notice({ tone: 'warn', title: 'Skipped', text: text, action: cont }) : h('p', null, [text, cont])));
    focusEl(cont);
    return wait(B.run, function (fin) {
      function go() { fin('continue'); }
      cont.addEventListener('click', go);
      return function () { cont.removeEventListener('click', go); };
    }).then(function () { return result(B, 'skipped'); });
  }

  async function play(B) {
    var o = B.o;
    var View = HF.views && HF.views[B.viewKey];
    if (!View || typeof View.create !== 'function') return unavailable(B, 'This task cannot be shown in this version of the app.');
    if (!B.spec) {
      try { B.spec = genSpec(B.bp, B.bp.seed || ('block-' + Date.now())); }
      catch (e) { logErr(e); return unavailable(B, 'This block could not be prepared.'); }
    }
    // 1. rule card (its Start click/key is the gesture that unlocks audio)
    if (o.ruleCard !== false) {
      phase(B, 'rule');
      var go = await showRuleCard(B);
      if (go !== 'start') return result(B, 'quit');
    }
    // 2. the task, restarted after a stream pause
    if (o.chrome !== false) setChrome(false);
    var log = null;
    mountStage(B);
    for (;;) {
      if (B.needsAudio && !debug.simulate) {
        var a = await ensureAudio(B);
        if (a === 'skip') { unmountStage(B); return result(B, 'skipped'); }
        if (a === 'abort') return result(B, 'quit');
      }
      if (o.countdown !== false) {
        var cd;
        for (;;) {
          phase(B, 'countdown');
          cd = await countdown(B.stage.el, { block: B });
          if (cd !== 'pause') break;
          var d0 = await pauseDecision(B, { kind: 'countdown', reason: B.countdownReason || 'key' });
          if (d0 !== 'resume') { cd = d0; break; }
        }
        if (cd !== 'done') return result(B, 'quit');
      }
      phase(B, 'run');
      B.startedAt = Date.now();
      B.streamPause = null;
      log = await runOnce(B);
      if (B.aborted) {
        // a custom flow (Span) resolves its aborted log only now; core runs were committed inside abort()
        if (log && log.kind !== 'stream' && log.kind !== 'discrete' && !o._specOnly) commitPartial(B, log);
        return result(B, 'quit');
      }
      if (log && log.aborted) {
        commitPartial(B, log);
        return result(B, 'quit', { log: log });
      }
      if (log && log.paused && log.kind === 'stream') {
        B.pendingPartial = log;
        var info = B.streamPause || { kind: 'stream', reason: log.pause ? log.pause.reason : 'pause' };
        var d = await pauseDecision(B, info);
        if (d === 'abort') return result(B, 'quit');
        commitPartial(B, log);
        B.pendingPartial = null;
        if (d === 'end') return result(B, 'quit', { log: log });
        if (log.presented > 0) {
          B.attempt += 1;
          var next = restartSpec(B);
          if (next !== B.spec) {
            B.spec = next;
            var v0 = B.stage && B.stage.view;
            if (v0 && typeof v0.reset === 'function') {
              try { v0.reset(next); B.stage.el.removeAttribute('data-i'); } catch (e) { logErr(e); mountStage(B); }
            } else mountStage(B);
          }
        }
        continue;
      }
      break;
    }
    B.log = log;
    unmountStage(B);
    if (o.chrome !== false) setChrome(true);
    // 3. score and commit
    var interrupted = !!(log && log.paused);
    B.result = scoreWith(B, B.spec, log);
    var cm = o._specOnly ? null : doCommit(B, B.spec, log, B.result, interrupted);
    // 4. debrief
    var action = 'continue';
    if (o.debrief !== false) {
      phase(B, 'debrief');
      action = await showDebrief(B, { result: B.result, commit: cm, log: log, interrupted: interrupted });
      if (action === 'abort') action = 'quit';
    }
    // only what callers use: a derived snapshot per block kept by the session grew the heap by ~90 KB a block (Phase 4)
    return result(B, 'done', { commit: cm ? { events: cm.events || [], block: cm.block } : null, action: action, interrupted: interrupted });
  }

  function start(B) {
    if (current && current !== B) {
      // one block at a time: a stale block (e.g. a screen that did not call abort) is stopped first
      abort('replaced');
    }
    current = B;
    api.active = true;
    var keep = !!B.o.sessionId;
    function finish(res) {
      if (current === B) { current = null; api.active = false; api.phase = 'idle'; }
      if (B.o.chrome !== false) setChrome(true);
      unmountStage(B);
      if (!keep) { try { if (HF.timing && HF.timing.keepAwake) HF.timing.keepAwake(false); } catch (e) { /* ignore */ } }
      try { if (B.o.root && B.o.root.setAttribute) B.o.root.setAttribute('data-hf-phase', 'idle'); } catch (e2) { /* ignore */ }
      return res;
    }
    return play(B).then(finish, function (e) {
      logErr(e);
      finish(null);
      return result(B, 'quit', { error: String(e && e.message || e) });
    });
  }

  // ---------------------------------------------------------------- public API
  function runBlock(bp, opts) {
    var o = assign({ ruleCard: true, countdown: true, commit: true, debrief: true, allowQuit: true }, opts || {});
    if (!o.root) return Promise.reject(new Error('HF.player.runBlock: opts.root is required'));
    bp = bp || {};
    if (o.feedback === undefined || o.feedback === null) o.feedback = bp.feedback && bp.feedback.perResponse ? 'per-response' : 'none';
    // the aid of an assisted block: n-back views draw the memory tape, the Relation Grid highlights the symbols that
    // count (Phase 4, PQ-03: the Grid got { tape } only, so nothing was highlighted); each view ignores the other
    if (!o.assist) o.assist = { tape: !!bp.assist, highlight: !!bp.assist };
    return start(newBlock(bp, null, o, viewKeyFor(bp)));
  }
  function runSpec(spec, viewKey, opts) {
    var o = assign({ ruleCard: false, countdown: true, commit: false, debrief: false, allowQuit: true, endLabel: 'Stop' }, opts || {});
    if (!o.root) return Promise.reject(new Error('HF.player.runSpec: opts.root is required'));
    o._specOnly = true;
    o.commit = false;
    if (!o.feedback) o.feedback = 'none';
    var bp = { trackId: spec && spec.trackId, rung: spec && spec.rung, set: spec && spec.set, seed: spec && spec.seed, role: 'probe' };
    var B = newBlock(bp, spec, o, viewKey || viewKeyFor(spec && spec.task));
    return start(B).then(function (res) {
      return { status: res.status, spec: res.spec, log: res.log, result: res.result, action: res.action, attempts: res.attempts };
    });
  }
  function abort(reason) {
    var B = current;
    if (!B) return false;
    B.aborted = true;
    B.run.aborted = true;
    try {
      if (B.custom) {
        if (typeof B.custom.abort === 'function') B.custom.abort();
      } else if (HF.timing && HF.timing.active) {
        HF.timing.abort(reason || 'leave');
        var last = HF.timing.last;
        if (last && !B.o._specOnly) commitPartial(B, last);
      } else if (B.pendingPartial && !B.o._specOnly) commitPartial(B, B.pendingPartial);
    } catch (e) { logErr(e); }
    B.run.waiters.slice().forEach(function (w) { w.cancel(); });
    if (api._overlay) { try { api._overlay.close(); } catch (e2) { /* ignore */ } api._overlay = null; }
    current = null;
    api.active = false;
    api.phase = 'idle';
    unmountStage(B);
    if (B.o.chrome !== false) setChrome(true);
    return true;
  }

  /** Read-only snapshot for tests and debugging: the block in progress. */
  function state() {
    var B = current;
    if (!B) return { active: false, phase: 'idle' };
    return { active: true, phase: B.phase, spec: B.spec, bp: B.bp, attempt: B.attempt, viewKey: B.viewKey,
      trial: B.stage && B.stage.el ? B.stage.el.getAttribute('data-i') : null };
  }

  var api = {
    state: state,
    runBlock: runBlock, runSpec: runSpec, countdown: countdown, pauseOverlay: pauseOverlay, abort: abort,
    plainLine: plainLine, levelWords: levelWords, viewKeyFor: viewKeyFor, keyRows: keyRows, horizonCheer: horizonCheer,
    config: config, debug: debug, active: false, phase: 'idle', _overlay: null,
    _simulateLog: simulateLog, _partialLog: partialLog
  };
  HF.player = api;
})(typeof window !== 'undefined' ? window : globalThis);
