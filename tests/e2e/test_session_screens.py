"""E2E (P1a, Phase 4 fix round) on the real index.html: Today, Free play, Welcome and Settings › Data fixes.

1. CB-04  a study participant (arm drawn, or enrolled and waiting for the draw): Free play says training follows the
          study programme instead of showing the picker (no group named); the session route with { free } shows the
          same note and records nothing; after 'study-leave' the picker is back.
2. CB-05 / QA (b)  Welcome's "Start training now" asks for a new session explicitly (session { fresh: true }) and one
          begins; once the first run is done, the welcome route (and a reload on #/welcome) goes to Today.
3. SC-03 / SC-09  Protocols texts say "as closely as each paper allows" (Today's card, the style line, Help me
          choose) and Jaeggi's tones note; Cao's completion note says "about 3 months (offered from day 80)".
4. CA-04 / CA-05  storage state: memory mode prints HF.store.status.message on Today and in Settings › Data (blocked;
          'newer' and 'write-failed' switching in a running page, with Reload for 'newer'); status.nearFull shows
          the Export prompt (Today and Settings, live through the store's 'status' event).
5. CB-02 / CA-03  Today's Continue card counts finished blocks, not paused attempts (1 played + 2 interrupted
          attempts → "1 of N", Continue offered); the "Extra practice" title follows the plan's fresh counts, not
          the day-cached derived value. Settings: a participant who left the study can turn Span on again.
PQ round (play-through review):
6. PQ-02  "Measure first" after Baseline 1: Today says "Baseline 2 comes first" with its date, "Open the Lab" is the
          primary action, and Start session asks first (Not now keeps Today; Start session starts).
7. PQ-05 / PQ-08 / PQ-06  an open Free-play session shows as "Free play in progress · N blocks played" (no "of 14");
          session-bar labels say "(warm-up)" once; the protocol card's chips show what the protocol will play (its
          start level via HF.engine.prepare), not the Varied level.
Run: python3 tests/e2e/test_session_screens.py
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import json
import time

from helpers import Check, Console, browser, close_modals, file_url, run_main

DESKTOP = {'width': 1366, 'height': 768}
PHONE = {'width': 390, 'height': 844}
ALL_LESSONS = ['lesson.nback', 'lesson.dual', 'lesson.transform', 'lesson.arith', 'lesson.switch', 'lesson.steps', 'lesson.grid',
               'lesson.stream', 'lesson.span', 'lesson.vsearch', 'lesson.grid.T2', 'lesson.grid.T3']
BLOCK_STORAGE = """(() => {
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); } catch (e) {}
})();"""
SEED = """(o) => { var t = Date.now();
  HF.store.mutate(function (r) {
    r.profile = Object.assign({}, r.profile, { firstRunDone: o.firstRunDone !== false, updatedAt: t });
    var s = Object.assign({}, r.settings, o.settings || {}); s.updatedAt = t; r.settings = s;
    var ev = (r.events || []).slice();
    (o.lessons || []).forEach(function (id, i) { ev.push({ id: 'ev-tss-l' + i, t: t - 9000, type: 'lesson-passed', lessonId: id }); });
    (o.events || []).forEach(function (e) { ev.push(e); });
    r.events = ev;
  });
  if (HF.ui.shell && HF.ui.shell.applySettings) HF.ui.shell.applySettings(HF.store.records.settings);
  if (HF.store.flush) HF.store.flush();
  return true; }"""
TOUCH = """() => { HF.store.mutate(function (r) { var s = Object.assign({}, r.settings); s.volume = s.volume === 0.7 ? 0.75 : 0.7; s.updatedAt = Date.now(); r.settings = s; });
  HF.store.flush(); return { persistent: HF.store.persistent, reason: HF.store.status.reason, message: HF.store.status.message,
    nearFull: HF.store.status.nearFull, nearFullText: HF.store.status.nearFullText, chars: HF.store.status.mainChars }; }"""


def study_events(arm, leave=False):
    t = int(time.time() * 1000) - 60000
    ev = [{'id': 'ev-tss-enrol', 't': t, 'type': 'study-enrol', 'template': 'default', 'consentAt': t, 'adult': True}]
    if arm:
        ev.append({'id': 'ev-tss-draw', 't': t + 1000, 'type': 'study-draw', 'arm': arm, 'salt': 'x', 'commitment': 'y', 'template': 'default', 'arms': ['varied', 'search']})
    if leave:
        ev.append({'id': 'ev-tss-leave', 't': t + 2000, 'type': 'study-leave'})
    return ev


def new_ctx(b, viewport=DESKTOP, init_js=None):
    ctx = b.new_context(viewport=viewport, device_scale_factor=1, has_touch=viewport['width'] < 600)
    if init_js:
        ctx.add_init_script(init_js)
    page = ctx.new_page()
    return ctx, page, Console(page)


def boot(page, hash_=''):
    page.goto(file_url('index.html') + hash_)
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(250)
    close_modals(page)


def go(page, route, params=None, wait=350):
    page.evaluate('([r, p]) => HF.router.go(r, p || {})', [route, params or {}])
    page.wait_for_timeout(wait)


def route(page):
    return page.evaluate('() => HF.router.current && HF.router.current.name')


def route_is(page, name, timeout=6000):
    try:
        page.wait_for_function('(n) => HF.router.current && HF.router.current.name === n', arg=name, timeout=timeout)
        return True
    except Exception:
        return False


def screen_text(page):
    return page.evaluate("() => document.getElementById('hf-screen').innerText")


def n_sessions(page):
    return page.evaluate('() => HF.store.records.sessions.length')


# ---------------------------------------------------------------- 1. CB-04
def part_free_study(b, chk):
    cons = []
    for arm, tag in (('search', 'arm drawn'), (None, 'waiting for the draw')):
        ctx, page, con = new_ctx(b)
        cons.append(con)
        try:
            boot(page)
            page.evaluate(SEED, {'lessons': ALL_LESSONS, 'events': study_events(arm)})
            go(page, 'free')
            txt = screen_text(page)
            chk.ok('Free play is off during the study' in txt and 'follows the study programme' in txt, 'CB-04 (%s): Free play says training follows the study programme' % tag)
            chk.eq(page.evaluate("() => [!!document.getElementById('hf-free-start'), !!document.getElementById('hf-free-track')]"), [False, False], 'CB-04 (%s): no picker, no Start' % tag)
            low = txt.lower()
            chk.ok('search' not in low and 'control' not in low, 'CB-04 (%s): the note names no study group' % tag)
            if arm:
                page.screenshot(path=_HF_OUT + '/session/fixes-cb04-free-study.png', full_page=True)
            n0 = n_sessions(page)
            go(page, 'session', {'free': {'trackId': 'nback.plain', 'rung': 0}}, wait=600)
            st = page.evaluate("() => { var s = document.querySelector('.hf-sess'); return { phase: s && s.getAttribute('data-phase'), text: s ? s.innerText : '', player: !!HF.player.active }; }")
            chk.ok(st['phase'] == 'empty' and 'Free play is off during the study' in st['text'] and not st['player'],
                   'CB-04 (%s): the session route with { free } shows the note and plays nothing %s' % (tag, {k: st[k] for k in ('phase', 'player')}))
            chk.eq(n_sessions(page), n0, 'CB-04 (%s): nothing recorded' % tag)
            if arm:
                page.click('.hf-sess .hf-btn--primary')         # Back to Today
                chk.ok(route_is(page, 'today'), 'CB-04: the note leads back to Today')
        finally:
            ctx.close()
    # after leaving the study, Free play is back
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS, 'events': study_events('search', leave=True)})
        go(page, 'free')
        chk.ok(page.evaluate("() => !!document.getElementById('hf-free-start')"), 'CB-04: after study-leave the Free-play picker is back')
    finally:
        ctx.close()
    return cons


# ---------------------------------------------------------------- 2. CB-05 / QA (b)
def part_welcome(b, chk):
    ctx, page, con = new_ctx(b)
    try:
        boot(page)
        chk.ok(route_is(page, 'welcome'), 'first launch lands on Welcome (%s)' % route(page))
        page.evaluate(SEED, {'firstRunDone': False, 'lessons': ['lesson.nback']})   # lesson passed: Start goes straight on
        go(page, 'welcome')
        n0 = n_sessions(page)
        page.click('#hf-welcome-start')
        chk.ok(route_is(page, 'session'), 'Welcome: Start training now → session')
        cur = page.evaluate('() => HF.router.current.params')
        chk.eq(cur, {'fresh': True}, 'CB-05: Welcome asks for a new session explicitly')
        try:
            page.wait_for_function("() => { var s = document.querySelector('.hf-sess'); return s && ['rule', 'lesson'].indexOf(s.getAttribute('data-phase')) >= 0; }", timeout=15000)
            ok = True
        except Exception:
            ok = False
        chk.ok(ok and n_sessions(page) == n0 + 1, 'CB-05: the first session begins (rule card) and is recorded')
        chk.ok(page.evaluate('() => HF.store.records.profile.firstRunDone') is True, 'profile.firstRunDone set')
        # QA (b): the first run is done → the welcome route goes to Today
        go(page, 'welcome', wait=500)
        chk.ok(route_is(page, 'today'), 'QA (b): welcome after the first run → Today (%s)' % route(page))
        chk.eq(page.evaluate('() => location.hash'), '#/today', 'QA (b): the hash mirrors Today')
        page.evaluate("() => history.replaceState(null, '', location.href.split('#')[0] + '#/welcome')")
        page.reload()
        page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
        page.wait_for_timeout(300)
        close_modals(page)
        chk.ok(route_is(page, 'today'), 'QA (b): a reload on #/welcome with the first run done → Today (%s)' % route(page))
        chk.ok(page.evaluate("() => !document.querySelector('.hf-welcome')"), 'QA (b): no welcome page is shown')
    finally:
        ctx.close()
    return [con]


# ---------------------------------------------------------------- 3. SC-03 / SC-09
def part_texts(b, chk):
    ctx, page, con = new_ctx(b)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS, 'settings': {'mode': 'protocols', 'protocols': {'cao': False, 'wang': False, 'jaeggi': True}, 'sound': 'tones'}})
        go(page, 'today')
        panel = page.evaluate("() => { var p = document.getElementById('hf-today-panel'); return p ? p.innerText : ''; }")
        chk.ok('as closely as the paper allows' in panel and 'exactly' not in panel, 'SC-03: Today\'s protocol card says "as closely as the paper allows" (%r)' % panel[:160])
        chk.ok('spoken consonants' in panel and 'tones unless you choose spoken letters' in panel, 'SC-03: Jaeggi with tones says the paper used spoken consonants')
        kit = page.evaluate("() => { var K = HF.ui.screenKit; var a = K.HELP.answers.filter(function (x) { return x.id === 'papers'; })[0]; return { line: K.MODES.protocols.line, gives: K.MODES.protocols.gives, label: a.label, why: a.why }; }")
        chk.ok('as closely as each paper allows' in kit['line'] and 'listed in the guide' in kit['line'] and 'exactly' not in kit['line'], 'SC-03: the Protocols style line %r' % kit['line'])
        chk.ok('spoken consonants' in kit['gives'] and 'tones unless you choose spoken letters' in kit['gives'], 'SC-03: the Protocols "gives up" line has the Jaeggi tones note')
        chk.ok('exactly' not in kit['label'] and 'as published' not in kit['why'] and 'as closely as each paper allows' in kit['why'], 'SC-03: Help me choose: %r / %r' % (kit['label'], kit['why']))
        go(page, 'settings', {'section': 'style'})
        st = screen_text(page)
        chk.ok('as closely as each paper allows' in st, 'SC-03: Settings shows the new Protocols line')
        # SC-09: the summary note when Cao's protocol is complete (rendered through the session's own summary)
        go(page, 'session', {'fresh': True}, wait=800)
        txt = page.evaluate("""() => { var S = HF.session.current(); if (!S) return null;
          S.renderSummary({ events: [{ type: 'protocol-complete', protocol: 'cao' }], session: { minutes: 30 } }, null);
          return document.querySelector('.hf-sess--summary').innerText; }""")
        chk.ok(txt and 'after about 3 months (offered from day 80)' in txt, 'SC-09: Cao completion note says "about 3 months (offered from day 80)"')
        go(page, 'today')
    finally:
        ctx.close()
    return [con]


# ---------------------------------------------------------------- 4. CA-04 / CA-05
def part_storage(b, chk):
    cons = []
    # a) blocked (sandboxed preview): the store's own message on Today and in Settings › Data
    ctx, page, con = new_ctx(b, PHONE, BLOCK_STORAGE)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        go(page, 'today')
        s = page.evaluate('() => ({ persistent: HF.store.persistent, reason: HF.store.status.reason, message: HF.store.status.message })')
        note = page.evaluate("() => { var n = document.querySelector('.hf-today__storage'); return n ? n.innerText : null; }")
        chk.ok(s['persistent'] is False and s['reason'] == 'blocked', 'CA-04: storage blocked → memory mode, reason blocked')
        chk.ok(note and 'Not saved on this device' in note and s['message'] in note, 'CA-04: Today prints HF.store.status.message (blocked)')
        chk.eq(page.evaluate("() => !!document.getElementById('hf-today-reload')"), False, 'CA-04: no Reload button for blocked storage')
        go(page, 'settings', {'section': 'data'})
        dt = page.evaluate("() => document.getElementById('data').innerText")
        chk.ok('Not saved on this device' in dt and s['message'] in dt, 'CA-04: Settings › Data prints the same message')
    finally:
        ctx.close()
    # b) a newer Long-Horizon wrote here while this page runs → memory mode 'newer', Today switches live, Reload offered
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        go(page, 'today')
        chk.eq(page.evaluate("() => !!document.querySelector('.hf-today__storage')"), False, 'storage fine: no storage notice')
        s = page.evaluate("""() => { var k = HF.store.keys.main(); var r = JSON.parse(localStorage.getItem(k)); r.schema = 99; localStorage.setItem(k, JSON.stringify(r)); return true; }""")
        s = page.evaluate(TOUCH)
        chk.ok(s['persistent'] is False and s['reason'] == 'newer', 'CA-04: newer data in storage → memory mode, reason newer %s' % {k: s[k] for k in ('persistent', 'reason')})
        try:
            page.wait_for_selector('.hf-today__storage', timeout=3000)
            live = True
        except Exception:
            live = False
        chk.ok(live, 'CA-04: the store\'s status event redraws Today (no reload needed)')
        note = page.evaluate("() => { var n = document.querySelector('.hf-today__storage'); return n ? n.innerText : ''; }")
        chk.ok(s['message'] and s['message'] in note and 'Reload this tab' in note, 'CA-04: Today prints the newer-version message')
        chk.ok(page.evaluate("() => !!document.getElementById('hf-today-reload')"), 'CA-04: Today offers Reload for newer data')
        page.screenshot(path=_HF_OUT + '/session/fixes-ca04-newer-today.png', full_page=False)
        go(page, 'settings', {'section': 'data'})
        dt = page.evaluate("() => document.getElementById('data').innerText")
        chk.ok(s['message'] in dt and page.evaluate("() => !!document.getElementById('hf-set-reload')"), 'CA-04: Settings › Data prints it with Reload')
    finally:
        ctx.close()
    # c) a write fails in a running page → memory mode 'write-failed' (no Reload)
    ctx, page, con = new_ctx(b)
    con.ignore = ('test write failure',)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        go(page, 'today')
        page.evaluate("() => { Storage.prototype.setItem = function () { throw new Error('test write failure'); }; return true; }")
        s = page.evaluate(TOUCH)
        chk.ok(s['persistent'] is False and s['reason'] == 'write-failed', 'CA-05: a failing write → memory mode, reason write-failed %s' % {k: s[k] for k in ('persistent', 'reason')})
        try:
            page.wait_for_selector('.hf-today__storage', timeout=3000)
            note = page.evaluate("() => document.querySelector('.hf-today__storage').innerText")
        except Exception:
            note = ''
        chk.ok(s['message'] and s['message'] in note, 'CA-05: Today switches live and prints the write-failed message')
        chk.eq(page.evaluate("() => !!document.getElementById('hf-today-reload')"), False, 'CA-05: no Reload for a failed write')
    finally:
        ctx.close()
    # d) main record near full → the Export prompt, live in Settings › Data and on Today
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        go(page, 'settings', {'section': 'data'})
        chk.eq(page.evaluate("() => !!document.querySelector('.hf-set__nearfull')"), False, 'not near full: no prompt')
        page.evaluate('() => { HF.store.configure({ nearFullChars: 500 }); return true; }')
        s = page.evaluate(TOUCH)
        chk.ok(s['persistent'] is True and s['nearFull'] is True, 'CA-05: status.nearFull after a save above the threshold %s' % {k: s[k] for k in ('nearFull', 'chars')})
        try:
            page.wait_for_selector('.hf-set__nearfull', timeout=3000)
            live = True
        except Exception:
            live = False
        chk.ok(live, 'CA-05: the status event redraws Settings › Data')
        txt = page.evaluate("() => { var n = document.querySelector('.hf-set__nearfull'); return n ? n.innerText : ''; }")
        chk.ok(s['nearFullText'] and s['nearFullText'] in txt and 'Saved data: about' in txt, 'CA-05: Settings prints nearFullText and the size (%r)' % txt[-80:])
        close_modals(page)
        page.click('.hf-set__nearfull .hf-btn')
        try:
            page.wait_for_selector('dialog.hf-modal--backup[open]', timeout=3000)
            dlg = True
        except Exception:
            dlg = False
        chk.ok(dlg, 'CA-05: Export now opens the backup dialog')
        close_modals(page)
        go(page, 'today')
        txt = page.evaluate("() => { var n = document.querySelector('.hf-today__nearfull'); return n ? n.innerText : ''; }")
        chk.ok(s['nearFullText'] in txt and 'Export now' in txt, 'CA-05: Today shows the near-full Export prompt')
        page.screenshot(path=_HF_OUT + '/session/fixes-ca05-nearfull-today.png', full_page=False)
    finally:
        ctx.close()
    return cons


# ---------------------------------------------------------------- 5. CB-02 / CA-03 / study-leave in Settings
OPEN_WITH_PAUSES = """() => {
  let rec = HF.store.records, now = Date.now();
  let d = HF.engine.derive(rec, now);
  const plan = HF.engine.plan(rec, d, { now });
  rec = HF.engine.beginSession(rec, plan, { now }).records;
  d = HF.engine.derive(rec, now);
  const play = (k, attempt, interrupted, t) => {
    const bp = Object.assign({}, HF.engine.prepare(plan.slots[k], rec, d, { sessionId: plan.id }), { attempt: attempt });
    const T = HF.tasks[bp.taskId];
    const spec = T.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed + '/a' + attempt, lureCount: bp.lureCount, lureMode: bp.lureMode });
    const log = spec.kind === 'discrete' ? { answers: spec.trials.map(x => ({ i: x.i, response: x.answer, rt: 900, voided: false })), paused: interrupted }
      : { responses: spec.trials.filter(x => x.scorable && x.target && x.target.main).map(x => ({ key: 'match', trial: x.i, t: x.i * 3000 + 500, rt: 500 })), voided: [], paused: interrupted };
    const c = HF.engine.commit(rec, bp, spec, T.score(spec, log), { now: t, sessionId: plan.id, t: t - 30000, interrupted: interrupted });
    rec = c.records; d = c.derived;
  };
  play(0, 0, false, now + 60000);
  play(1, 0, true, now + 120000);
  play(1, 1, true, now + 180000);
  HF.store.mutate(() => rec);
  const s = rec.sessions.find(x => x.id === plan.id);
  return { id: plan.id, planned: plan.slots.length, completed: s.completed, blocks: rec.blocks.filter(b => b.sessionId === plan.id).length };
}"""


def part_today(b, chk):
    ctx, page, con = new_ctx(b)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        info = page.evaluate(OPEN_WITH_PAUSES)
        chk.ok(info['blocks'] == 3, 'CB-02 setup: 1 finished block + 2 interrupted attempts %s' % info)
        go(page, 'today')
        card = page.evaluate("""() => { var p = document.getElementById('hf-today-panel'); return p ? { title: (p.querySelector('.hf-card__title') || {}).textContent || '',
          text: p.innerText, done: p.querySelectorAll('.hf-sbar__seg.is-done').length, cont: !!document.getElementById('hf-today-continue') } : null; }""")
        chk.ok(card and 'in progress' in card['title'] and card['cont'], 'CB-02: Today still offers Continue (%s)' % (card and card['title']))
        chk.ok(card and ('1 of %d blocks done' % info['planned']) in card['text'] and card['done'] == 1,
               'CB-02: the card counts 1 finished block, not the paused attempts (%s)' % (card and {'done': card['done'], 'text': card['text'][:120]}))
        chk.eq(info['completed'], 1, 'CB-02: session.completed = finished slots (engine)')
        page.click('#hf-today-continue')
        try:
            page.wait_for_function("() => { var s = document.querySelector('.hf-sess'); return s && s.getAttribute('data-phase') === 'rule'; }", timeout=15000)
            st = page.evaluate("() => ({ resumed: !!HF.session.current().resumed, id: HF.session.current().plan.id, slot: HF.player.state().bp.slotId })")
        except Exception:
            st = None
        chk.ok(st and st['resumed'] and st['id'] == info['id'] and st['slot'] == 'k1', 'CB-02: Continue resumes at the paused slot (%s)' % st)
        go(page, 'today')
        page.evaluate("(id) => { HF.store.mutate(function (r) { return HF.engine.endSession(r, id, { now: Date.now(), endedBy: 'quit' }).records; }); return true; }", info['id'])
        # CA-03: the title follows plan.counts (computed at plan time), not derived.today (cached for the day)
        page.evaluate("""() => { window.__P = HF.engine.plan; window.__force = null;
          HF.engine.plan = function () { var p = window.__P.apply(this, arguments); if (window.__force) p.counts = window.__force; return p; }; return true; }""")
        page.evaluate("() => { window.__force = { ok: false, reason: 'gap' }; HF.router.go('today'); }")
        page.wait_for_timeout(300)
        t1 = page.evaluate("() => (document.querySelector('#hf-today-panel .hf-card__title') || {}).textContent || ''")
        page.evaluate("() => { window.__force = { ok: true, reason: null }; var d = HF.store.derived; if (d.today) d.today.canCount = { ok: false, reason: 'gap' }; HF.router.go('today'); }")
        page.wait_for_timeout(300)
        t2 = page.evaluate("() => (document.querySelector('#hf-today-panel .hf-card__title') || {}).textContent || ''")
        chk.eq(t1, 'Extra practice', 'CA-03: plan.counts not ok → "Extra practice"')
        chk.ok(t2.startswith('Session '), 'CA-03: plan.counts ok → "Session N", even when the cached derived says no (%r)' % t2)
        page.evaluate('() => { HF.engine.plan = window.__P; return true; }')
        # Settings: Span is off-limits only while in the study
        page.evaluate(SEED, {'events': study_events('varied')})
        go(page, 'settings', {'section': 'session'})
        dis1 = page.evaluate("() => { var i = document.querySelector('#hf-set-span input') || document.getElementById('hf-set-span'); return i ? !!i.disabled : null; }")
        page.evaluate("() => { HF.store.mutate(function (r) { r.events = r.events.concat([{ id: 'ev-tss-leave2', t: Date.now(), type: 'study-leave' }]); }); return true; }")
        go(page, 'settings', {'section': 'session'})
        dis2 = page.evaluate("() => { var i = document.querySelector('#hf-set-span input') || document.getElementById('hf-set-span'); return i ? !!i.disabled : null; }")
        chk.eq([dis1, dis2], [True, False], 'Settings: Span locked in the study, open again after leaving it')
    finally:
        ctx.close()
    return [con]


# ---------------------------------------------------------------- 6./7. PQ-02, PQ-05, PQ-06, PQ-08
B1_DONE = """() => { var t = Date.now() - 2 * 3600000;
  var ids = HF.lab.visitTests('standard', { reasoning: true }), tests = {};
  ids.forEach(function (id) { tests[id] = { score: 1 }; });
  HF.store.mutate(function (r) {
    r.profile = Object.assign({}, r.profile, { firstRunDone: true, path: 'measure', updatedAt: Date.now() });
    r.labVisits = (r.labVisits || []).concat([{ id: 'lv-tss-b1', kind: 'B1', config: 'standard', form: 'A', startedAt: t - 3600000, endedAt: t, tests: tests, flags: [] }]);
  });
  var sch = HF.lab.schedule(HF.store.records, null, Date.now());
  return sch.plan.filter(function (p) { return p.kind === 'B1' || p.kind === 'B2'; }).map(function (p) { return p.kind + ':' + p.status; }); }"""
OPEN_FREE = """() => {
  let rec = HF.store.records, now = Date.now();
  let d = HF.engine.derive(rec, now);
  const plan = HF.engine.plan(rec, d, { now, modeId: 'free' });
  rec = HF.engine.beginSession(rec, plan, { now }).records;
  d = HF.engine.derive(rec, now);
  const slot = HF.planner.freeSlot(plan, { trackId: 'nback.plain', rung: 2 });
  const bp = HF.engine.prepare(slot, rec, d, { sessionId: plan.id });
  const T = HF.tasks[bp.taskId];
  const spec = T.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode });
  const log = { responses: spec.trials.filter(x => x.scorable && x.target && x.target.main).map(x => ({ key: 'match', trial: x.i, t: x.i * 3000 + 500, rt: 500 })), voided: [], paused: false };
  rec = HF.engine.commit(rec, bp, spec, T.score(spec, log), { now: now + 60000, sessionId: plan.id, t: now }).records;
  HF.store.mutate(() => rec);
  return { id: plan.id, planned: rec.sessions.find(x => x.id === plan.id).planned };
}"""


def part_pq(b, chk):
    cons = []
    # PQ-02: "Measure first", Baseline 1 done, Baseline 2 not yet
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        st = page.evaluate(B1_DONE)
        chk.ok('B1:done' in st and any(x.startswith('B2:') and x.split(':')[1] in ('upcoming', 'due', 'overdue') for x in st), 'PQ-02 setup: %s' % st)
        go(page, 'today')
        card = page.evaluate("""() => { var p = document.getElementById('hf-today-panel'); if (!p) return null;
          var n = p.querySelector('.hf-today__b2'), prim = p.querySelectorAll('.hf-btn--primary');
          return { note: n ? n.innerText : '', prim: Array.prototype.map.call(prim, function (x) { return x.id || x.textContent.trim(); }),
            start: !!document.getElementById('hf-today-start'), labNotices: document.querySelectorAll('.hf-today__lab').length }; }""")
        chk.ok(card and 'Baseline 2 comes first' in card['note'] and 'It opens on' in card['note'], 'PQ-02: Today says Baseline 2 comes first, with its date (%r)' % (card and card['note'][:140]))
        chk.eq(card and card['prim'], ['hf-today-lab'], 'PQ-02: "Open the Lab" is the one primary action')
        chk.eq(card and card['labNotices'], 0, 'PQ-02: no second Lab notice beside the card')
        page.screenshot(path=_HF_OUT + '/session/fixes-pq02-today-b2.png', full_page=True)
        page.click('#hf-today-start')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=3000)
        dlg = page.evaluate("() => document.querySelector('dialog.hf-modal[open]').innerText")
        chk.ok('Baseline 2 can no longer be taken' in dlg, 'PQ-02: Start session asks first (%r)' % dlg[:120])
        page.locator('dialog.hf-modal[open] .hf-btn', has_text='Not now').click()
        page.wait_for_timeout(300)
        chk.ok(route(page) == 'today' and n_sessions(page) == 0, 'PQ-02: Not now keeps Today, nothing starts')
        page.click('#hf-today-start')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=3000)
        page.locator('dialog.hf-modal[open] .hf-btn--primary').click()
        chk.ok(route_is(page, 'session'), 'PQ-02: confirming starts the session')
        go(page, 'today')
    finally:
        ctx.close()
    # PQ-05: an open Free-play session (page closed mid-way) is shown honestly
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        info = page.evaluate(OPEN_FREE)
        go(page, 'today')
        card = page.evaluate("""() => { var p = document.getElementById('hf-today-panel'); return p ? { title: (p.querySelector('.hf-card__title') || {}).textContent || '',
          text: p.innerText, segs: p.querySelectorAll('.hf-sbar__seg').length } : null; }""")
        chk.ok(card and card['title'] == 'Free play in progress' and '1 block played' in card['text'] and (' of %d' % info['planned']) not in card['text'],
               'PQ-05: an open Free-play session shows "Free play in progress · 1 block played", no "of %d" (%s)' % (info['planned'], card and card['text'][:120]))
        chk.eq(card and card['segs'], 1, 'PQ-05: its bar shows the played block only')
    finally:
        ctx.close()
    # PQ-08 + PQ-06: labels and chips of the next-session card
    ctx, page, con = new_ctx(b)
    cons.append(con)
    try:
        boot(page)
        t = int(time.time() * 1000) - 60000
        page.evaluate(SEED, {'lessons': ALL_LESSONS})
        go(page, 'today')
        titles = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('#hf-today-panel .hf-sbar__seg'), function (s) { return s.getAttribute('title') || ''; })")
        warm = [x for x in titles if 'warm-up' in x]
        chk.ok(warm and all(x.count('(warm-up)') == 1 for x in warm), 'PQ-08: "(warm-up)" once per warm-up step %s' % warm[:2])
        # PQ-06: a high Varied level on Transform; Cao's protocol starts lower: the chip shows what Cao will play
        page.evaluate(SEED, {'events': [{'id': 'ev-tss-ovr', 't': t, 'type': 'override', 'trackId': 'nback.transform', 'level': 8}],
                             'settings': {'mode': 'protocols', 'protocols': {'cao': True, 'wang': False, 'jaeggi': False}}})
        go(page, 'today')
        info = page.evaluate("""() => { var r = HF.store.records, d = HF.store.derived, plan = HF.engine.plan(r, d, { now: Date.now() });
          var bp = HF.engine.prepare(plan.slots[0], r, d, { sessionId: plan.id });
          var chips = Array.prototype.map.call(document.querySelectorAll('#hf-today-panel .hf-today__chips [role=listitem]'), function (x) { return x.textContent.trim(); });
          return { protocol: plan.protocol, track: bp.trackId, plays: HF.catalog.levelLabel(bp.trackId, bp.rung), varied: HF.catalog.levelLabel('nback.transform', d.tracks['nback.transform'].level),
            chipLevel: HF.ui.screenKit.chipLevel(bp.trackId, bp.rung), variedChip: HF.ui.screenKit.chipLevel('nback.transform', d.tracks['nback.transform'].level), chips: chips }; }""")
        chk.ok(info['protocol'] == 'cao' and info['plays'] != info['varied'], 'PQ-06 setup: Cao plays %s, the Varied level is %s' % (info['plays'], info['varied']))
        chk.ok(info['chips'] and info['chipLevel'] in info['chips'][0] and info['variedChip'] not in info['chips'][0],
               'PQ-06: the chip shows what the protocol will play (%s), not the Varied level (%s)' % (info['chips'], info['variedChip']))
    finally:
        ctx.close()
    return cons


def run():
    chk = Check('session-screens')
    t0 = time.time()
    cons = []
    with browser() as b:
        for part in (part_free_study, part_welcome, part_texts, part_storage, part_today, part_pq):
            try:
                cons += part(b, chk)
            except Exception as e:
                chk.ok(False, '%s crashed: %s' % (part.__name__, str(e)[:300]))
    errs = [e for c in cons for e in (c.errors + c.page_errors)]
    chk.ok(not errs, 'console errors: %s' % errs[:5])
    chk.details['seconds'] = round(time.time() - t0, 1)
    return chk.result()


if __name__ == '__main__':
    run_main(run)
