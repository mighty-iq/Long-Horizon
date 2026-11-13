"""Shared helpers for the Phase 3 cross-screen journey (test_journey.py) and the long live run (test_longrun.py).

They drive the REAL app page (index.html over file://) with real key presses and clicks. Test instrumentation, all
installed by an init script before the app's own scripts run; none of it changes what the app does:
  1. Clock shim: `Date` / `Date.now()` run `offset` ms ahead of the real clock. The offset is window.__hfOffsetMs,
     set by a one-line init script per simulated day (the last one added wins) and read lazily by the shim.
     performance.now(), requestAnimationFrame and timers are untouched, so block timing is real. A later day =
     set_day() between sessions, then reload the page. (Not localStorage: on file:// an init script touching
     localStorage makes Chromium show the page stale or empty storage after some reloads.)
  2. Leak counters (window.__hfLeak.snapshot()): wrappers around EventTarget add/removeEventListener, setTimeout /
     clearTimeout, setInterval / clearInterval, requestAnimationFrame / cancelAnimationFrame and the observe /
     disconnect of Mutation/Resize/IntersectionObservers count live listeners (by target: window, document,
     connected node, detached node, other), pending timeouts, live intervals, pending frames and live observers.
  3. After boot, install_phase_log(): an accessor on HF.player.phase logs every phase change with its time.
Bot: answers blocks from the spec with real keys (Playwright keyboard → trusted keydowns). mode 'correct' answers
every item right; mode 'noisy' misses targets, presses on non-targets / lures and gives wrong or no answers on
discrete items at the given rates, with jittered response times inside the response window.
"""
import datetime
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib
import random
import time

from helpers import ROOT, Console, file_url

OUT3 = pathlib.Path(os.environ.get('HF_PHASE3_OUT', _HF_OUT + '/phase3'))
DAY_MS = 86400000

INIT_JS = r"""
(() => {
  if (window.__hfLeak) return;
  // ---------- 1. clock shim (Date only) ----------
  // The offset is read lazily from window.__hfOffsetMs, which small per-day init scripts (added after this one,
  // so they run later but still before the page's scripts) set. Never touch localStorage here: on file:// pages
  // an init script that reads or writes localStorage at document start makes Chromium hand the page a stale or
  // empty storage area after some reloads (measured: 11 of 25 reloads lost data; 0 of 25 without it).
  const RealDate = Date;
  const off = () => (typeof window.__hfOffsetMs === 'number' && isFinite(window.__hfOffsetMs) ? window.__hfOffsetMs : 0);
  function FakeDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + off()).toString();
    if (args.length === 0) return new RealDate(RealDate.now() + off());
    return new RealDate(...args);
  }
  FakeDate.now = function () { return RealDate.now() + off(); };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  window.Date = FakeDate;
  window.__hfDate = {
    get offset() { return off(); },
    set(ms) { window.__hfOffsetMs = ms; },
    real() { return RealDate.now(); }
  };
  // ---------- 2. leak counters ----------
  const W = window;
  const oST = W.setTimeout, oCT = W.clearTimeout, oSI = W.setInterval, oCI = W.clearInterval;
  const oRAF = W.requestAnimationFrame, oCAF = W.cancelAnimationFrame;
  const timeouts = new Map(), intervals = new Map(), rafs = new Set();
  const C = { tSet: 0, tFired: 0, tCleared: 0, iSet: 0, iCleared: 0, lAdd: 0, lRemove: 0, rSet: 0 };
  W.setTimeout = function (fn, ms, ...rest) {
    if (typeof fn !== 'function') return oST.call(W, fn, ms, ...rest);
    let id = 0;
    const wrapped = function () { timeouts.delete(id); C.tFired++; return fn.apply(this, arguments); };
    id = oST.call(W, wrapped, ms, ...rest);
    timeouts.set(id, ms); C.tSet++;
    return id;
  };
  W.clearTimeout = function (id) { if (timeouts.delete(id)) C.tCleared++; if (intervals.delete(id)) C.iCleared++; return oCT.call(W, id); };
  W.setInterval = function (fn, ms, ...rest) { const id = oSI.call(W, fn, ms, ...rest); intervals.set(id, ms); C.iSet++; return id; };
  W.clearInterval = function (id) { if (intervals.delete(id)) C.iCleared++; if (timeouts.delete(id)) C.tCleared++; return oCI.call(W, id); };
  W.requestAnimationFrame = function (cb) {
    let id = 0;
    id = oRAF.call(W, function (ts) { rafs.delete(id); return cb(ts); });
    rafs.add(id); C.rSet++;
    return id;
  };
  W.cancelAnimationFrame = function (id) { rafs.delete(id); return oCAF.call(W, id); };
  const ET = EventTarget.prototype, oAdd = ET.addEventListener, oRem = ET.removeEventListener;
  const reg = new WeakMap(), targets = new Set();
  const capOf = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  ET.addEventListener = function (type, fn, opts) {
    const r = oAdd.call(this, type, fn, opts);
    if (fn == null) return r;
    try {
      const cap = capOf(opts), once = !!(opts && typeof opts === 'object' && opts.once);
      let arr = reg.get(this);
      if (!arr) { arr = []; reg.set(this, arr); targets.add(new WeakRef(this)); }
      if (!arr.some((e) => e.type === type && e.fn === fn && e.cap === cap)) {
        const e = { type, fn, cap, once };
        arr.push(e); C.lAdd++;
        const sig = opts && typeof opts === 'object' && opts.signal;
        if (sig && typeof sig.addEventListener === 'function') {
          oAdd.call(sig, 'abort', () => { const i = arr.indexOf(e); if (i >= 0) { arr.splice(i, 1); C.lRemove++; } }, { once: true });
        }
      }
    } catch (err) { /* never break the app */ }
    return r;
  };
  ET.removeEventListener = function (type, fn, opts) {
    const r = oRem.call(this, type, fn, opts);
    try {
      const arr = reg.get(this);
      if (arr) {
        const cap = capOf(opts);
        const i = arr.findIndex((e) => e.type === type && e.fn === fn && e.cap === cap);
        if (i >= 0) { arr.splice(i, 1); C.lRemove++; }
      }
    } catch (err) { /* ignore */ }
    return r;
  };
  const observing = new Set();
  ['MutationObserver', 'ResizeObserver', 'IntersectionObserver'].forEach((name) => {
    const K = W[name];
    if (!K || !K.prototype) return;
    const oObs = K.prototype.observe, oDis = K.prototype.disconnect;
    K.prototype.observe = function () { if (!this.__hfRef) { this.__hfRef = new WeakRef(this); } observing.add(this.__hfRef); this.__hfKind = name; return oObs.apply(this, arguments); };
    K.prototype.disconnect = function () { if (this.__hfRef) observing.delete(this.__hfRef); return oDis.apply(this, arguments); };
  });
  function snapshot() {
    const L = { window: 0, document: 0, connected: 0, detached: 0, other: 0, once: 0, total: 0, targets: 0 };
    const byType = {};
    for (const wr of Array.from(targets)) {
      const t = wr.deref();
      if (!t) { targets.delete(wr); continue; }
      const arr = reg.get(t);
      if (!arr || !arr.length) continue;
      L.targets++;
      let cls = 'other';
      if (t === window) cls = 'window';
      else if (t === document) cls = 'document';
      else if (typeof Node !== 'undefined' && t instanceof Node) cls = t.isConnected ? 'connected' : 'detached';
      for (const e of arr) {
        if (e.once) { L.once++; continue; }
        L[cls]++; L.total++;
        if (cls !== 'connected') { const k = cls + ':' + e.type; byType[k] = (byType[k] || 0) + 1; }
      }
    }
    let obs = 0;
    for (const wr of Array.from(observing)) { if (wr.deref()) obs++; else observing.delete(wr); }
    return { listeners: L, byType, timeouts: timeouts.size, intervals: intervals.size, rafs: rafs.size, observers: obs,
             intervalMs: Array.from(intervals.values()), timeoutMs: Array.from(timeouts.values()).sort((a, b) => (b || 0) - (a || 0)).slice(0, 12),
             counters: Object.assign({}, C) };
  }
  window.__hfLeak = { snapshot };
})();
"""

PHASE_LOG_JS = r"""() => {
  const P = HF.player;
  if (!P || P.__phHooked) return !!P;
  let ph = P.phase;
  window.__phLog = [];
  Object.defineProperty(P, 'phase', { configurable: true, enumerable: true,
    get() { return ph; },
    set(v) { if (v !== ph) window.__phLog.push([v, Math.round(performance.now())]); ph = v; } });
  P.__phHooked = true;
  return true;
}"""

DIGEST_JS = r"""() => { const s = HF.player.state(); if (!s.active || !s.spec) return null; const sp = s.spec;
  const bp = s.bp || {};
  return { kind: sp.kind, seed: sp.seed, trackId: sp.trackId, task: sp.task, streams: sp.streams || null, set: sp.set,
    onMs: sp.onMs || null, soaMs: sp.soaMs || null, windowMs: sp.windowMs || null, itiMs: sp.itiMs || null,
    leadIn: sp.leadIn || 0, attempt: s.attempt || 0, role: bp.role || null, rung: bp.rung, levelBefore: bp.levelBefore,
    protocol: bp.protocol || null, slotId: bp.slotId || null,
    trials: (sp.trials || []).map((t, i) => ({ i: t.i !== undefined ? t.i : i, target: t.target || null,
      lure: t.lure || null, answer: t.answer || null, scorable: t.scorable !== false,
      win: t.windowMs || null })) }; }"""

DEBRIEF_JS = r"""() => {
  const q = (s) => document.querySelector(s);
  const db = q('.hf-play-debrief');
  if (!db) return null;
  const dirEl = db.querySelector('.hf-debrief__dir');
  let dir = null;
  if (dirEl) { const m = /hf-debrief__dir--(\w+)/.exec(dirEl.className); dir = m ? m[1] : null; }
  const txt = (el) => (el ? el.textContent.trim() : null);
  return { count: txt(db.querySelector('.hf-debrief__count')), line: txt(db.querySelector('.hf-debrief__line')),
    score: txt(db.querySelector('.hf-debrief__score')), next: txt(db.querySelector('.hf-debrief__v')), dir,
    notices: Array.from(db.querySelectorAll('.hf-notice')).map((n) => n.textContent.trim()),
    auto: txt(db.querySelector('.hf-debrief__auto')), celebrate: !!db.querySelector('.hf-debrief--celebrate'),
    details: !!db.querySelector('details'), buttons: Array.from(db.querySelectorAll('.hf-btn')).map((b) => b.textContent.trim()) };
}"""

LAST_BLOCK_JS = r"""(sid) => { const bs = (HF.store.records.blocks || []).filter((b) => b.sessionId === sid);
  if (!bs.length) return null; const b = bs[bs.length - 1];
  return { id: b.id, trackId: b.trackId, role: b.role, rung: b.rung, levelBefore: b.levelBefore, levelAfter: b.levelAfter,
    moved: b.moved, reason: b.reason, ba: b.result ? b.result.ba : null, interrupted: !!b.interrupted,
    voidedRatio: b.voidedRatio, frame: b.frame || null, mode: b.mode, protocol: b.protocol || null, n: bs.length,
    set: b.set, purpose: b.purpose || null, unitId: b.unitId || null }; }"""

SESS_PHASE_JS = "() => { const s = document.querySelector('.hf-sess'); return s ? s.getAttribute('data-phase') : null; }"

# A user past the first run with every lesson passed (tests that are about blocks, not lessons).
SEED_USER_JS = r"""(settings) => {
  HF.store.mutate((r) => {
    const t = Date.now();
    r.profile = Object.assign({}, r.profile, { firstRunDone: true, path: (r.profile && r.profile.path) || 'train',
      startedAt: (r.profile && r.profile.startedAt) || t, updatedAt: t });
    const ALL = ['lesson.nback', 'lesson.dual', 'lesson.transform', 'lesson.arith', 'lesson.switch', 'lesson.steps', 'lesson.grid',
      'lesson.stream', 'lesson.span', 'lesson.vsearch', 'lesson.grid.T2', 'lesson.grid.T3', 'lesson.grid.T4', 'lesson.grid.T5',
      'lesson.grid.T6', 'lesson.grid.T7', 'lesson.grid.T8'];
    const have = {}; (r.events || []).forEach((e) => { if (e && e.type === 'lesson-passed') have[e.lessonId] = 1; });
    r.events = (r.events || []).concat(ALL.filter((id) => !have[id]).map((id, i) => ({ id: 'seed-lesson-' + id, t: t - 1000, type: 'lesson-passed', lessonId: id })));
    if (settings) { const s = Object.assign({}, r.settings, settings); s.updatedAt = t; r.settings = s; }
  });
  HF.store.flush(true);
  if (HF.ui && HF.ui.shell && HF.ui.shell.applySettings) HF.ui.shell.applySettings(HF.store.records.settings);
  return HF.store.records.events.length;
}"""


def offset_for(local_dt):
    """Offset (ms) that makes the page's Date.now() show local_dt (naive local time) right now."""
    target = time.mktime(local_dt.timetuple()) * 1000.0
    return int(round(target - time.time() * 1000.0))


def set_day(page, local_dt):
    """Moves the page's clock so that 'now' is local_dt: at once in this document and, through a new init script, in
    every later load of the context (callers reload the page afterwards)."""
    off = offset_for(local_dt)
    page.context.add_init_script('window.__hfOffsetMs = %d;' % off)
    page.evaluate('(ms) => { window.__hfOffsetMs = ms; }', off)
    return off


def sim_now(page):
    return page.evaluate('() => Date.now()')


def new_context(b, viewport=None, theme='light', accept_downloads=True, start_local=None):
    """A context with the init script; when start_local is given, the clock starts there."""
    ctx = b.new_context(viewport=viewport or {'width': 1366, 'height': 768}, color_scheme=theme,
                        accept_downloads=accept_downloads, device_scale_factor=1)
    ctx.add_init_script(INIT_JS)
    if start_local is not None:
        ctx.add_init_script('window.__hfOffsetMs = %d;' % offset_for(start_local))
    return ctx


def wait_booted(page, timeout=20000):
    page.wait_for_function('() => window.HF && HF.booted === true', timeout=timeout)


def popup_state(page):
    return page.evaluate("""() => { const d = document.querySelector('dialog.hf-modal--chimera[open]');
      if (!d) return null; const a = d.querySelector('a[href]'); const ae = document.activeElement;
      return { title: (d.querySelector('.hf-chimera__title') || {}).textContent || null,
        text: (d.querySelector('.hf-chimera__text') || {}).textContent || null,
        href: a ? a.getAttribute('href') : null, target: a ? a.getAttribute('target') : null, rel: a ? a.getAttribute('rel') : null,
        joinText: a ? a.textContent.trim() : null, urlText: (d.querySelector('.hf-chimera__url') || {}).textContent || null,
        focused: ae ? ae.textContent.trim() : null, focusedInDialog: !!(ae && d.contains(ae)) }; }""")


def close_popup(page, timeout=5000):
    """Closes the Chimera pop-up with Enter on its focused Start training button. Returns the pop-up state seen."""
    try:   # wait_for_function, not wait_for_selector: an unused ElementHandle would keep the closed dialog alive
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--chimera[open]')", timeout=timeout)
    except Exception:
        return None
    page.wait_for_timeout(120)
    st = popup_state(page)
    page.keyboard.press('Enter')
    page.wait_for_function("() => !document.querySelector('dialog.hf-modal--chimera[open]')", timeout=5000)
    return st


def install_phase_log(page):
    return page.evaluate(PHASE_LOG_JS)


def phase_log(page, clear=False):
    return page.evaluate('(c) => { const l = (window.__phLog || []).slice(); if (c) window.__phLog = []; return l; }', clear)


def nav(page, route, params_check=True, expect=None):
    """Clicks the shell navigation (opening More when needed); falls back to the router if no button is visible.
    Waits until the route is `route` (or one of `expect`, e.g. Today handing over to Welcome on a first run)."""
    sel = '.hf-nav [data-go="%s"]' % route
    loc = page.locator(sel).first
    clicked = False
    if loc.count():
        if not loc.is_visible():
            more = page.locator('.hf-nav__more').first
            if more.count() and more.is_visible():
                more.click()
                page.wait_for_timeout(150)
        if loc.is_visible():
            loc.click()
            clicked = True
    if not clicked:
        page.evaluate('(r) => HF.router.go(r)', route)
    if params_check:
        page.wait_for_function('(rs) => HF.router.current && rs.indexOf(HF.router.current.name) >= 0', arg=[route] + list(expect or []), timeout=10000)
    page.wait_for_timeout(250)
    return clicked


def route(page):
    return page.evaluate('() => HF.router.current ? HF.router.current.name : null')


def sess_phase(page):
    return page.evaluate(SESS_PHASE_JS)


def wait_sess_phase(page, phases, timeout=60000):
    if isinstance(phases, str):
        phases = [phases]
    page.wait_for_function("""(ps) => { const s = document.querySelector('.hf-sess');
      return !!s && ps.indexOf(s.getAttribute('data-phase')) >= 0; }""", arg=list(phases), timeout=timeout)
    return sess_phase(page)


def cdp_metrics(page, client, gc=True):
    """Heap and DOM counters after a forced garbage collection (CDP), plus the in-page leak snapshot."""
    out = {}
    try:
        if gc:
            client.send('HeapProfiler.collectGarbage')
        hu = client.send('Runtime.getHeapUsage')
        out['heapUsed'] = hu.get('usedSize')
        out['heapTotal'] = hu.get('totalSize')
    except Exception as e:
        out['heapErr'] = str(e)[:120]
    try:
        dc = client.send('Memory.getDOMCounters')
        out['nodes'] = dc.get('nodes')
        out['documents'] = dc.get('documents')
        out['jsEventListeners'] = dc.get('jsEventListeners')
    except Exception as e:
        out['domErr'] = str(e)[:120]
    out['domInDoc'] = page.evaluate('() => document.getElementsByTagName("*").length')
    try:
        out['perfMemory'] = page.evaluate('() => performance.memory ? performance.memory.usedJSHeapSize : null')
    except Exception:
        out['perfMemory'] = None
    out['leak'] = page.evaluate('() => window.__hfLeak ? window.__hfLeak.snapshot() : null')
    return out


class Bot:
    """Answers the running block from its spec with real key presses.

    mode 'correct': every scorable stream target gets its key(s), nothing else; discrete items get the right key.
    mode 'noisy':   stream targets are pressed with p=hit, plain non-targets with p=fa, lures with p=lure_fa;
                    discrete items: right with p=disc, else wrong, and no answer at all with p=no_resp.
    Response times are drawn inside the response window (rt for streams, rt_disc for discrete items), scaled by
    the play speed (scale) so they stay inside shortened windows too.
    """

    def __init__(self, page, mode='correct', seed=1, hit=0.85, fa=0.08, lure_fa=0.25, disc=0.85, no_resp=0.03,
                 rt=(380, 820), rt_disc=(520, 1250), scale=1.0, log=None):
        self.page, self.mode, self.rng = page, mode, random.Random(seed)
        self.hit, self.fa, self.lure_fa, self.disc, self.no_resp = hit, fa, lure_fa, disc, no_resp
        self.rt, self.rt_disc, self.scale = rt, rt_disc, scale
        self.log = log if log is not None else []
        self.unexpected_pauses = []

    def _rt(self, lo_hi, window_ms):
        lo, hi = lo_hi
        v = self.rng.uniform(lo, hi) * self.scale
        if window_ms:
            v = min(v, max(60, 0.6 * window_ms - 60))
        return int(v)

    def wait_trial(self, i, timeout=60000):
        self.page.wait_for_function("""(i) => { const s = HF.player.state();
          if (!s.active || (s.phase !== 'run' && s.phase !== 'countdown')) return true;
          return s.trial !== null && s.trial !== '' && +s.trial >= i; }""", arg=i, timeout=timeout, polling='raf')
        return self.page.evaluate('() => { const s = HF.player.state(); return { phase: s.phase, trial: s.trial }; }')

    def keys_for(self, dig, t):
        """(keys to press, outcome label) for trial t."""
        if dig['kind'] == 'stream':
            if not t['scorable']:
                return [], 'leadin'
            tg, lu = t['target'] or {}, t['lure'] or {}
            keys, outs = [], []
            for stream in (dig['streams'] or ['main']):
                key = 'k' if stream == 'snd' else 'j'
                is_t = bool(tg.get(stream))
                if self.mode == 'correct':
                    press = is_t
                else:
                    if is_t:
                        press = self.rng.random() < self.hit
                    elif lu.get(stream):
                        press = self.rng.random() < self.lure_fa
                    else:
                        press = self.rng.random() < self.fa
                if press:
                    keys.append(key)
                outs.append(('hit' if press else 'miss') if is_t else ('fa' if press else 'cr'))
            return keys, '/'.join(outs)
        right = 'j' if t['answer'] == 'match' else 'f'
        if self.mode == 'correct':
            return [right], 'right'
        r = self.rng.random()
        if r < self.no_resp:
            return [], 'none'
        if r < self.no_resp + (1 - self.disc):
            return ['f' if right == 'j' else 'j'], 'wrong'
        return [right], 'right'

    def play_block(self, on_trial=None, timeout=90000):
        """Plays the block that is starting (countdown or run). Returns a summary dict."""
        page = self.page
        summary = {'pressed': 0, 'outcomes': {}, 'restarts': 0, 'trackId': None, 'kind': None}
        for attempt in range(4):
            page.wait_for_function("() => HF.player.phase === 'run' || HF.player.phase === 'debrief' || HF.player.phase === 'idle'",
                                   timeout=timeout)
            dig = page.evaluate(DIGEST_JS)
            if not dig or page.evaluate('() => HF.player.phase') != 'run':
                break
            summary.update({'trackId': dig['trackId'], 'kind': dig['kind'], 'n': len(dig['trials']), 'seed': dig['seed'],
                            'soaMs': dig['soaMs'], 'windowMs': dig['windowMs'], 'itiMs': dig['itiMs'],
                            'role': dig['role'], 'rung': dig['rung'], 'levelBefore': dig['levelBefore']})
            paused = False
            for t in dig['trials']:
                st = self.wait_trial(t['i'], timeout=timeout)
                if st['phase'] == 'paused':
                    paused = True
                    break
                if st['phase'] != 'run':
                    break
                if st['trial'] is None or int(st['trial']) != t['i']:
                    continue
                keys, outcome = self.keys_for(dig, t)
                summary['outcomes'][outcome] = summary['outcomes'].get(outcome, 0) + 1
                if keys:
                    win = t.get('win') or dig['windowMs'] or dig['soaMs']
                    rt = self._rt(self.rt if dig['kind'] == 'stream' else self.rt_disc, win)
                    if rt > 0:
                        page.wait_for_timeout(rt)
                    for k in keys:
                        page.keyboard.press(k)
                        summary['pressed'] += 1
                if on_trial:
                    on_trial(t['i'], dig)
            if not paused:
                break
            # a pause the bot did not ask for (e.g. the audio context stalled): note it and resume
            self.unexpected_pauses.append(page.evaluate("""() => { const d = document.querySelector('dialog.hf-modal--pause[open]');
              return d ? d.textContent.slice(0, 120) : 'paused'; }"""))
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
            page.wait_for_timeout(400)
            page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
            summary['restarts'] += 1
        return summary


def expected_block_ms(summary, countdown_ms=3000, lead_ms=1000):
    """Upper estimate of the run time of a block from its spec (items × SOA, or items × (window + ITI))."""
    n = summary.get('n') or 0
    if summary.get('kind') == 'stream':
        return countdown_ms + lead_ms + n * (summary.get('soaMs') or 3000)
    return countdown_ms + lead_ms + n * ((summary.get('windowMs') or 3000) + (summary.get('itiMs') or 100))


def lesson_driver():
    """test_learn_bot's lesson driver (imported lazily: it re-points helpers.OUT at import)."""
    import test_learn_bot as tlb
    return tlb


def drive_lesson(page, timeout_s=900):
    """Plays a lesson that a session runs in place, until the session leaves its 'lesson' phase."""
    tlb = lesson_driver()
    page.evaluate(tlb.HOOK_JS)

    def until(_st):
        return page.evaluate(SESS_PHASE_JS) != 'lesson'
    return tlb.drive(page, until, mode='pass', max_s=timeout_s)


RULE_JS = r"""() => { const r = document.querySelector('.hf-sess .hf-rule') || document.querySelector('.hf-rule');
  const s = HF.player.state(); const bp = s.bp || {};
  return { title: r ? ((r.querySelector('h2, .hf-rule__title') || {}).textContent || '').trim() : null,
    notes: r ? Array.from(r.querySelectorAll('.hf-rule__note')).map((n) => n.textContent.trim()) : [],
    levelChip: r ? ((r.querySelector('.hf-chip--level') || {}).textContent || null) : null,
    trackId: bp.trackId || null, role: bp.role || null, rung: bp.rung, levelBefore: bp.levelBefore, set: bp.set || null,
    protocol: bp.protocol || null, purpose: bp.purpose || null, unitId: bp.unitId || null, study: bp.study || null,
    strategy: !!(r && r.textContent.indexOf('Strategy') >= 0),
    trackLevel: bp.trackId && HF.store.derived.tracks[bp.trackId] ? HF.store.derived.tracks[bp.trackId].level : null,
    modeId: bp.modeId || null,
    offset: (() => { const tr = bp.trackId && HF.store.derived.tracks[bp.trackId]; const m = bp.modeId === 'protocols' ? 'varied' : bp.modeId;
      return tr && tr.offsets && m ? (tr.offsets[m] || 0) : 0; })(),
    ...(() => { const m = bp.modeId === 'protocols' ? null : bp.modeId; if (!m || !HF.modes || !HF.modes.get(m) || HF.modes.get(m).U == null) return { U: null, D: null };
      const tr = HF.store.derived.tracks[bp.trackId]; const o = tr && tr.offsets ? (tr.offsets[m] || 0) : 0;
      return { U: HF.modes.get(m).U + o, D: HF.modes.get(m).D + o }; })() }; }"""


def play_session(page, bot, start_how=('space', 'enter', 'click'), on_rule=None, on_debrief=None, leave_debrief=None,
                 max_blocks=80, slack_ms=30000, lesson_timeout_s=900, log=None):
    """Plays the session screen that is showing until its summary (or an empty plan). Returns the list of blocks.

    on_rule(info) runs on each rule card before Start; on_debrief(entry) after the debrief is read (entry holds the
    rule card, the bot summary, the debrief, the committed block record, the phase log and timings);
    leave_debrief(entry) → 'space' | 'enter' | 'click' | 'auto' decides how the debrief is left (default Space)."""
    out = []
    lessons = []
    sid = page.evaluate('() => { const s = HF.session && HF.session.current(); return s && s.plan ? s.plan.id : null; }')
    k = 0
    while len(out) < max_blocks:
        ph = wait_sess_phase(page, ['lesson', 'rule', 'debrief', 'summary', 'empty', 'pick'], timeout=120000)
        if ph in ('summary', 'empty', 'pick'):
            break
        if ph == 'lesson':
            t0 = time.time()
            acts = drive_lesson(page, timeout_s=lesson_timeout_s)
            lessons.append({'seconds': round(time.time() - t0, 1), 'actions': len(acts)})
            continue
        if ph == 'debrief':          # a debrief we did not open (should not happen): leave it
            page.keyboard.press('Space')
            page.wait_for_timeout(300)
            continue
        # rule card
        page.wait_for_function("() => HF.player.phase === 'rule'", timeout=20000)
        if sid is None:
            sid = page.evaluate('() => { const s = HF.session && HF.session.current(); return s && s.plan ? s.plan.id : null; }')
        rule = page.evaluate(RULE_JS)
        if on_rule:
            on_rule(rule)
        phase_log(page, clear=True)
        how = start_how[k % len(start_how)]
        k += 1
        t_start = time.time()
        if how == 'click':
            page.locator('.hf-play__start').first.click()
        elif how == 'enter':
            page.keyboard.press('Enter')
        else:
            page.keyboard.press('Space')
        summ = bot.play_block()
        exp_ms = expected_block_ms(summ)
        stuck = False
        try:
            page.wait_for_function("() => HF.player.phase === 'debrief' || HF.player.phase === 'idle'",
                                   timeout=max(20000, int(exp_ms + slack_ms - (time.time() - t_start) * 1000)))
        except Exception:
            stuck = True
        t_end = time.time()
        db = page.evaluate(DEBRIEF_JS) if not stuck else None
        rec = page.evaluate(LAST_BLOCK_JS, sid)
        plog = phase_log(page)
        entry = {'k': k, 'rule': rule, 'bot': summ, 'debrief': db, 'block': rec, 'phases': [p[0] for p in plog],
                 'phaseTimes': plog, 'elapsedMs': int((t_end - t_start) * 1000), 'expectedMs': exp_ms, 'stuck': stuck,
                 'sessionId': sid}
        if log is not None:
            log(entry)
        if on_debrief:
            on_debrief(entry)
        out.append(entry)
        if stuck:
            break
        how2 = leave_debrief(entry) if leave_debrief else 'space'
        if how2 == 'auto':
            page.wait_for_function("() => HF.player.phase !== 'debrief'", timeout=40000)
        elif how2 == 'click':
            page.locator('.hf-play-debrief .hf-btn--primary').first.click()
        elif how2 == 'enter':
            page.keyboard.press('Enter')
        else:
            page.keyboard.press('Space')
        page.wait_for_function("() => { const s = document.querySelector('.hf-sess'); return !s || s.getAttribute('data-phase') !== 'debrief'; }",
                               timeout=40000)
    return {'blocks': out, 'lessons': lessons, 'sessionId': sid}


def controller_check(entry, U=None, D=None):
    """Independent check of a committed block's level move against the mode thresholds U / D as they stood before
    the block (the zone's U / D include the self-correction offset). Returns None when consistent, else a message."""
    b = entry.get('block') or {}
    if not b:
        return 'no block record'
    rule = entry.get('rule') or {}
    U = U if U is not None else rule.get('U')
    D = D if D is not None else rule.get('D')
    role, ba, moved = b.get('role'), b.get('ba'), b.get('moved') or 0
    if role in ('warmup', 'check', 'assist', 'tutorial', 'probe'):
        return None if moved == 0 and b.get('levelAfter') == b.get('levelBefore') else 'a %s block moved the level (%s)' % (role, b)
    if b.get('interrupted') or (b.get('voidedRatio') or 0) > 0.2 or ba is None:
        return None if moved == 0 else 'an interrupted / voided block moved the level (%s)' % b
    if role not in ('rated', 'free') or b.get('protocol'):
        return None
    reason = b.get('reason')
    if reason == 'off-level':
        return None if moved == 0 else 'an off-level free block moved the level (%s)' % b
    if reason in ('capped', 'below-level'):
        return None if moved <= 0 or reason == 'capped' else 'unexpected move %s' % b
    if U is None or D is None:
        return 'no thresholds recorded for %s' % b.get('trackId')
    if ba >= U - 1e-9:
        ok = moved >= 1 or reason in ('top',)
    elif ba < D - 1e-9:
        ok = moved <= -1 or reason in ('bottom',)
    else:
        ok = moved == 0
    return None if ok else 'BA %.3f with U %.3f / D %.3f but moved %s (%s)' % (ba, U, D, moved, reason)


def write_json(name, data, sub=None):
    d = OUT3 / sub if sub else OUT3
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(json.dumps(data, indent=2, default=str))
    return p


def now_s():
    return time.time()


def local(y, m, d, hh=10, mm=0):
    return datetime.datetime(y, m, d, hh, mm, 0)
