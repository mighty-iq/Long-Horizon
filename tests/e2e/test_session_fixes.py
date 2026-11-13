"""E2E (P1a, Phase 4 fix round): the session-screen and player fixes, each checked the way it failed.

1. CB-05  the bare route (a reload on #/session) with no open session goes to Today (replace, hash #/today) and
          records nothing; { fresh: true } starts a session; a reload on its summary goes to Today again.
2. CB-10  the page is hidden during the 3-2-1 before a block: the pause overlay ("page was hidden") opens and the
          block does not start; Resume → 3-2-1 → the block runs once. Hidden during the 3-2-1 before a discrete
          resume: paused again and HF.timing stays paused; Resume → the run continues.
3. CB-11  the audio context stops mid-block (Dual with tones): "The sound stopped" overlay → Resume (a real click)
          → no "This block needs sound" step; the context runs again and the block restarts.
4. QA (a) the session keeps only slim results per block (no spec, log, result or derived snapshot): after a forced
          GC (CDP) no earlier block's result or commit snapshot is alive (WeakRefs); the median heap growth per block
          is reported (records and trial logs grow by design; the first Relations block allocates its view once).
5. QA (c) starting levels: a warm-up that moves a new version's start and a first rated block that moves down show
          "Starting level" (no arrow) in the debrief; a later drop still shows; the summary says "Starting level: …"
          for the new version instead of a drop.
6. CB-14  Continue after the session length changed in Settings resumes the stored plan (same id, same slots, the
          bar at block 3 of 7); a resume that cannot happen says so before the new session.
7. CA-08  a Transform spec restarted through runSpec (no regenerate given) keeps its lure count (meta.lurePlan).
PQ round (play-through review):
8. PQ-13  Escape on the pause overlay's "How to play" page goes back to the pause menu; the block stays paused.
9. PQ-03  an assisted Relation Grid block highlights the symbols that count (.hf-rg--hl) and its fade note speaks
          of highlighting, not of the memory tape.
10. PQ-05 leaving Free play through the navigation ends the session ('done'), so Today has nothing "in progress".
11. PQ-12 phone landscape (844 × 390): the Grid and Stream use the height (≥ 280 px square, rule ≤ 2 lines, pads
          beside it); the search field keeps ≥ 360 px, inside the screen, clear of the pads and the top bar.
CB-06 (runSpec returns attempts) is checked in test_session_lab.py.
Blocks are simulated where the test is about the flow (HF.player.debug.simulate, a test hook).
Run: python3 tests/e2e/test_session_fixes.py
"""
import time

from helpers import Console
from test_session_lib import (DESKTOP, SKIPPED, Check, boot, browser, build_page, close_modals, go_session, new_page,
                              plan_id, run_main, session_blocks, shot, start_block, wait_phase)

OVERLAY_TEXT = "() => { var d = document.querySelector('dialog.hf-modal--pause[open]'); return d ? d.textContent : null; }"
HIDE = """() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
  document.dispatchEvent(new Event('visibilitychange')); }"""
SHOW = "() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }"
AC_SPY = """(() => { var AC = window.AudioContext; if (!AC) return; window.__acs = [];
  window.AudioContext = class extends AC { constructor(o) { super(o); window.__acs.push(this); } }; })();"""
STATE = """() => ({ phase: HF.player.phase, active: !!HF.timing.active, timingPaused: !!HF.timing.paused,
  overlay: (function () { var d = document.querySelector('dialog.hf-modal--pause[open]'); return d ? d.textContent : null; })() })"""
DEBRIEF = """() => { var n = document.querySelector('.hf-play-debrief'); if (!n) return null;
  var facts = Array.prototype.map.call(n.querySelectorAll('.hf-debrief__fact'), function (f) {
    var k = f.querySelector('.hf-debrief__k'), d = f.querySelector('.hf-debrief__dir');
    return { k: k ? k.textContent : '', text: f.textContent, dir: d ? d.className.replace(/.*hf-debrief__dir--/, '') : null }; });
  var lvl = facts.filter(function (f) { return f.k === 'Your level' || f.k === 'Starting level'; })[0] || null;
  return { level: lvl, notes: Array.prototype.map.call(n.querySelectorAll('.hf-notice'), function (x) { return x.textContent.trim(); }) }; }"""
SUMMARY_ROWS = """() => Array.prototype.map.call(document.querySelectorAll('.hf-sess--summary .hf-sess__lvl'), function (li) {
  var mv = li.querySelector('.hf-sess__lvl-move');
  return { name: li.querySelector('.hf-sess__lvl-name').textContent, text: mv.textContent, up: mv.classList.contains('is-up'),
    icon: !!mv.querySelector('svg') }; })"""


def route_is(page, name, timeout=8000):
    try:
        page.wait_for_function("(n) => HF.router.current && HF.router.current.name === n", arg=name, timeout=timeout)
        return True
    except Exception:
        return False


def sessions(page):
    return page.evaluate("() => HF.store.records.sessions.map(function (s) { return { id: s.id, endedAt: s.endedAt || null, endedBy: s.endedBy || null }; })")


def play_to_end(page):
    for _ in range(60):
        ph = wait_phase(page, ['rule', 'debrief', 'summary'], 30000)
        if ph == 'summary':
            return True
        if ph == 'rule':
            start_block(page)
        else:
            page.keyboard.press('Space')
        page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
    return False


def reload(page):
    page.reload()
    page.wait_for_function('() => window.HF && HF.booted === true', timeout=20000)
    close_modals(page)


def overlay_open(page, timeout=10000):
    page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=timeout)
    page.wait_for_timeout(450)          # the dialog's entry animation; an early click can miss
    return page.evaluate(OVERLAY_TEXT)


def click_overlay(page, label):
    page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text=label).first.click()
    if label == 'End session':
        # End in the pause menu asks first, as the header End button does (Phase 4, UX-06)
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
        page.wait_for_timeout(300)
        page.locator('dialog.hf-modal--confirm[open] .hf-btn--primary').click()


# ---------------------------------------------------------------- 1. CB-05
def part_bare(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 40})
        n0 = len(sessions(page))
        page.evaluate('() => HF.router.go("session", {})')
        chk.ok(route_is(page, 'today'), 'CB-05: the bare session route without an open session goes to Today (%s)' % page.evaluate('() => HF.router.current && HF.router.current.name'))
        chk.eq(page.evaluate('() => location.hash'), '#/today', 'CB-05: the hash mirrors Today, not #/session')
        chk.eq(len(sessions(page)), n0, 'CB-05: nothing recorded (no new session)')
        go_session(page)                                        # { fresh: true }
        wait_phase(page, 'rule', 20000)
        sid = plan_id(page)
        s = [x for x in sessions(page) if x['id'] == sid]
        chk.ok(len(s) == 1 and s[0]['endedAt'] is None, 'CB-05: { fresh: true } starts and records a session')
        chk.ok(play_to_end(page), 'the fresh session plays to its summary')
        n1 = len(sessions(page))
        chk.eq(page.evaluate('() => location.hash'), '#/session', 'the summary is on #/session')
        reload(page)
        chk.ok(route_is(page, 'today'), 'CB-05: a reload on the summary goes to Today (%s)' % page.evaluate('() => HF.router.current && HF.router.current.name'))
        page.wait_for_timeout(300)
        ss = sessions(page)
        chk.eq(len(ss), n1, 'CB-05: the reload recorded no new session')
        chk.eq([x['id'] for x in ss if x['endedAt'] is None], [], 'CB-05: no session left open')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 2. CB-10
def part_hidden(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'countdownStepMs': 700, 'timeScale': 0.6})
        # a) hidden during the 3-2-1 before the block
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
        start_block(page)
        page.wait_for_function("() => HF.player.phase === 'countdown'", timeout=10000)
        page.evaluate(HIDE)
        page.wait_for_timeout(2700)                             # longer than the whole 3-2-1
        st = page.evaluate(STATE)
        chk.ok(st['phase'] == 'paused' and not st['active'], 'CB-10: hidden during the 3-2-1 → paused, the block did not start %s' % {k: st[k] for k in ('phase', 'active')})
        chk.ok(bool(st['overlay']) and 'page was hidden' in st['overlay'], 'CB-10: the overlay says the page was hidden')
        if st['overlay']:
            shot(page, 'fixes-cb10-countdown-hidden')
            page.evaluate(SHOW)
            page.wait_for_timeout(450)
            page.evaluate("() => { HF.player.debug.simulate = 'correct'; }")
            click_overlay(page, 'Resume')
            page.wait_for_function("() => HF.player.phase === 'debrief'", timeout=20000)
            bl = session_blocks(page)
            chk.ok(len(bl) == 1 and not bl[0]['interrupted'], 'CB-10: after Resume the block ran once and counts (%s)' % [(x['attempt'], x['interrupted']) for x in bl])
        page.evaluate("() => { HF.player.debug.simulate = null; }")
        if page.evaluate('() => document.visibilityState') == 'hidden':
            page.evaluate(SHOW)
        # b) hidden during the 3-2-1 before a discrete resume (Relation Grid)
        go_session(page, {'free': {'trackId': 'rel.grid.T1', 'rung': 1}})
        start_block(page)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && s.trial !== null && s.trial !== ''; }", timeout=20000, polling='raf')
        page.wait_for_timeout(300)
        page.keyboard.press('Escape')
        overlay_open(page)
        click_overlay(page, 'Resume')
        page.wait_for_function("() => HF.player.phase === 'countdown'", timeout=5000)
        page.evaluate(HIDE)
        page.wait_for_timeout(2700)
        st = page.evaluate(STATE)
        chk.ok(st['phase'] == 'paused' and st['timingPaused'], 'CB-10: hidden during the 3-2-1 before a resume → paused again, the run stays paused %s' % {k: st[k] for k in ('phase', 'timingPaused')})
        chk.ok(bool(st['overlay']) and 'page was hidden' in st['overlay'], 'CB-10: that overlay says the page was hidden too')
        page.evaluate(SHOW)
        if st['overlay']:
            page.wait_for_timeout(450)
            click_overlay(page, 'Resume')
            try:
                page.wait_for_function("() => HF.player.phase === 'run' && !HF.timing.paused", timeout=10000)
                chk.ok(True, 'CB-10: Resume → 3-2-1 → the discrete run continues')
            except Exception:
                chk.ok(False, 'CB-10: Resume → 3-2-1 → the discrete run continues %s' % page.evaluate(STATE))
        page.keyboard.press('Escape')
        overlay_open(page)
        click_overlay(page, 'End session')
        wait_phase(page, 'summary', 20000)
        bl = session_blocks(page)
        chk.ok(len(bl) == 1 and bl[0]['interrupted'], 'the paused discrete block is committed once, as interrupted')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 3. CB-11
def part_audio(b, url, chk):
    ctx = b.new_context(viewport=DESKTOP, color_scheme='light', device_scale_factor=1)
    ctx.add_init_script(AC_SPY)
    page = ctx.new_page()
    con = Console(page)
    try:
        boot(page, url, settings={'sound': 'tones'}, debug={'timeScale': 0.6, 'countdownStepMs': 200})
        go_session(page, {'free': {'trackId': 'nback.dual', 'rung': 2, 'set': 'tones'}})
        wait_phase(page, 'rule', 20000)
        page.locator('.hf-play__start').click()                 # the real gesture that unlocks audio
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=20000, polling='raf')
        chk.eq(page.evaluate('() => HF.audio.state()'), 'running', 'CB-11: audio runs during the block')
        page.evaluate('() => window.__acs[window.__acs.length - 1].suspend()')
        ov = overlay_open(page)
        chk.ok(bool(ov) and 'sound stopped' in ov, 'CB-11: the overlay says the sound stopped')
        click_overlay(page, 'Resume')                           # a real click
        seen_notice, reached, t_end = False, False, time.time() + 5
        while time.time() < t_end:
            st = page.evaluate("() => ({ notice: !!document.querySelector('.hf-play__audio'), phase: HF.player.phase })")
            seen_notice = seen_notice or st['notice']
            if st['phase'] == 'run':
                reached = True
                break
            time.sleep(0.04)
        if seen_notice:
            shot(page, 'fixes-cb11-needs-sound')
        chk.ok(not seen_notice, 'CB-11: no "This block needs sound" step after Resume')
        chk.ok(reached, 'CB-11: the block restarts and runs after Resume')
        chk.eq(page.evaluate('() => HF.audio.state()'), 'running', 'CB-11: the audio context runs again')
        page.evaluate('() => HF.router.go("today")')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 4. QA (a)
def part_heap(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 25}, debug={'simulate': 'correct', 'countdownStepMs': 30})
        client = ctx.new_cdp_session(page)

        def heap():
            client.send('HeapProfiler.collectGarbage')
            client.send('HeapProfiler.collectGarbage')
            return client.send('Runtime.getHeapUsage').get('usedSize')

        # WeakRefs to every commit's derived snapshot and every block result: after a forced GC only the newest may live
        page.evaluate("""() => { window.__refs = { derived: [], results: [] };
          var Cm = HF.engine.commit;
          HF.engine.commit = function () { var c = Cm.apply(this, arguments); if (c && c.derived) window.__refs.derived.push(new WeakRef(c.derived)); return c; };
          var R = HF.player.runBlock;
          HF.player.runBlock = function () { return R.apply(this, arguments).then(function (res) { if (res) window.__refs.results.push(new WeakRef(res)); return res; }); };
          return true; }""")
        alive = """() => { var o = {}; Object.keys(window.__refs).forEach(function (k) {
          o[k] = [window.__refs[k].filter(function (w) { return !!w.deref(); }).length, window.__refs[k].length]; }); return o; }"""
        go_session(page)
        heaps, played, info, refs = [], 0, None, None
        for _ in range(60):
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 30000)
            if ph == 'summary':
                break
            if ph == 'rule':
                start_block(page)
            else:
                played += 1
                page.keyboard.press('Space')
                page.wait_for_function("() => document.querySelector('.hf-sess').getAttribute('data-phase') !== 'debrief'", timeout=20000)
                heaps.append(heap())                            # after the block's result reached the session
                if played == 12:
                    refs = page.evaluate(alive)
                    info = page.evaluate("""() => { var S = HF.session.current();
                      return { keys: S.played.map(function (p) { return Object.keys(p.res).join(','); }),
                        playedChars: JSON.stringify(S.played.map(function (p) { return { bp: p.bp, res: p.res, label: p.label }; })).length,
                        derivedChars: JSON.stringify(HF.store.derived).length }; }""")
                continue
            page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
        chk.ok(info and set(info['keys']) == {'status'}, 'QA (a): played[] keeps only the status of each result %s' % (info and sorted(set(info['keys']))))
        chk.ok(info and info['playedChars'] < 3000, 'QA (a): 12 played entries are small (%s characters as JSON)' % (info and info['playedChars']))
        chk.ok(refs and refs['derived'][0] <= 1 and refs['derived'][1] >= 12, 'QA (a): commit derived snapshots alive after GC: %s (alive, made)' % (refs and refs['derived']))
        chk.ok(refs and refs['results'][0] <= 1 and refs['results'][1] >= 12, 'QA (a): block results alive after GC: %s (alive, made)' % (refs and refs['results']))
        deltas = sorted(heaps[k] - heaps[k - 1] for k in range(2, len(heaps)))
        med = deltas[len(deltas) // 2] if deltas else None
        chk.details['heap'] = {'afterEachBlock': heaps, 'medianDeltaPerBlock': med, 'derivedSnapshotChars': info and info['derivedChars']}
        chk.ok(med is not None and med < 120000, 'QA (a): heap after GC, median growth per block %.1f KB (records and trial logs grow; < 120 KB)' % ((med or 0) / 1000.0))
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 5. QA (c)
def part_start(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'countdownStepMs': 30})
        go_session(page)
        wait_phase(page, 'rule', 20000)
        slots = page.evaluate("() => HF.session.current().plan.slots.map(function (s) { return s.trackId + '/' + s.role; })")
        chk.details['slots'] = slots
        want = ['nback.plain/warmup', 'nback.plain/rated', 'nback.plain/rated', 'nback.plain/rated', 'rel.grid.T1/warmup', 'rel.grid.T1/rated', 'rel.grid.T1/rated']
        chk.eq(slots, want, 'QA (c): the 10-minute first session has the expected slots')
        seq = ['correct', 'none', 'none', 'none', 'none', 'correct', 'correct']
        deb = []
        for k, mode in enumerate(seq):
            wait_phase(page, 'rule', 20000)
            page.evaluate('(m) => { HF.player.debug.simulate = m; }', mode)
            start_block(page)
            wait_phase(page, 'debrief', 30000)
            d = page.evaluate(DEBRIEF)
            blk = page.evaluate("(k) => { var b = HF.store.records.blocks.filter(function (x) { return x.sessionId === HF.session.current().plan.id; }); b = b[b.length - 1]; var t = HF.store.derived.tracks[b.trackId];" +
                                " return { lb: b.levelBefore, la: b.levelAfter, moved: b.moved, role: b.role, level: t.level, rated: t.ratedBlocks }; }", k)
            deb.append({'debrief': d, 'block': blk})
            if k in (0, 1):
                shot(page, 'fixes-qac-debrief-%d' % k)
            if k < len(seq) - 1:
                page.keyboard.press('Space')
                page.wait_for_function("() => document.querySelector('.hf-sess').getAttribute('data-phase') !== 'debrief'", timeout=20000)
        chk.details['debriefs'] = deb

        def lv(k):
            return (deb[k]['debrief'] or {}).get('level') or {}

        def notes(k):
            return ' | '.join((deb[k]['debrief'] or {}).get('notes') or [])
        b0, b1, b4 = deb[0]['block'], deb[1]['block'], deb[4]['block']
        chk.ok(b0['level'] != b0['la'] and b0['rated'] == 0, 'QA (c) setup: the warm-up moved the new version\'s start (%s)' % b0)
        chk.ok(lv(0).get('k') == 'Starting level' and lv(0).get('dir') is None, 'QA (c): warm-up debrief shows "Starting level", no arrow %s' % lv(0))
        chk.ok('This warm-up set the starting level' in notes(0) and 'never change your level' not in notes(0), 'QA (c): the warm-up note says it set the start (%s)' % notes(0))
        chk.ok(b1['moved'] < 0 and b1['rated'] == 1, 'QA (c) setup: the first rated block moved down (%s)' % b1)
        chk.ok(lv(1).get('k') == 'Starting level' and lv(1).get('dir') is None, 'QA (c): first rated block down → "Starting level", no down arrow %s' % lv(1))
        chk.ok('first block on this version set its starting level' in notes(1), 'QA (c): its note says so (%s)' % notes(1))
        chk.ok(lv(2).get('k') == 'Your level' and lv(2).get('dir') == 'down', 'QA (c): a later drop still shows as a drop %s' % lv(2))
        if b4['level'] != b4['la']:
            chk.ok(lv(4).get('k') == 'Starting level', 'QA (c): the Grid warm-up that moved its start shows "Starting level" %s' % lv(4))
        page.keyboard.press('Space')
        wait_phase(page, 'summary', 20000)
        rows = page.evaluate(SUMMARY_ROWS)
        chk.details['summary_rows'] = rows
        shot(page, 'fixes-qac-summary', full=True)
        nb = [r for r in rows if r['name'] == 'Plain n-back']
        chk.ok(len(nb) == 1 and nb[0]['text'].startswith('Starting level') and not nb[0]['icon'], 'QA (c): summary: the new n-back version shows its starting level, not a drop %s' % nb)
        chk.ok(not [r for r in rows if r['icon'] and not r['up']], 'QA (c): no drop rows in the summary %s' % rows)
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 6. CB-14
def part_resume(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 30})
        go_session(page)
        wait_phase(page, 'rule', 20000)
        sid = plan_id(page)
        n_slots = page.evaluate('() => HF.session.current().plan.slots.length')
        for _ in range(2):
            wait_phase(page, 'rule', 20000)
            start_block(page)
            wait_phase(page, 'debrief', 30000)
            page.keyboard.press('Space')
            page.wait_for_function("() => document.querySelector('.hf-sess').getAttribute('data-phase') !== 'debrief'", timeout=20000)
        wait_phase(page, 'rule', 20000)
        page.evaluate('() => HF.router.go("today")')             # leave: the session stays open
        page.evaluate("""() => HF.store.mutate(function (r) { var s = Object.assign({}, r.settings); s.sessionMinutes = 20;
          s.balance = { nback: 70, relations: 30, span: 0 }; s.updatedAt = Date.now(); r.settings = s; })""")
        go_session(page, {'resume': sid})
        wait_phase(page, 'rule', 20000)
        st = page.evaluate("""() => { var S = HF.session.current(); return { resumed: !!S.resumed, id: S.plan.id, n: S.plan.slots.length,
          slot: HF.player.state().bp.slotId, count: (document.querySelector('.hf-sbar__count') || {}).textContent || '' }; }""")
        chk.ok(st['resumed'] and st['id'] == sid, 'CB-14: Continue after a settings change resumes the same session %s' % st)
        chk.eq(st['n'], n_slots, 'CB-14: the stored plan keeps its slots (%d), whatever the new session length' % n_slots)
        chk.eq(st['slot'], 'k2', 'CB-14: the next block is the third slot')
        chk.ok(st['count'].startswith('Block 3 of %d' % n_slots), 'CB-14: the bar picks up at block 3 (%r)' % st['count'])
        go_session(page, {'resume': 'no-such-session'})
        wait_phase(page, 'rule', 20000)
        notes = page.evaluate("() => document.querySelector('.hf-sess__notes').innerText")
        chk.ok('could not be continued' in notes, 'CB-14: a resume that cannot happen says so (%r)' % notes[:120])
        page.evaluate('() => HF.router.go("today")')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 7. CA-08
def part_regen(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'countdownStepMs': 60, 'timeScale': 0.5})
        first = page.evaluate("""() => { var spec = HF.tasks.nback.gen({ trackId: 'nback.transform', rung: 2, seed: 'ca08', lureCount: 4, lureMode: 'controlled' });
          var host = document.createElement('div'); host.id = 'hf-ca08-host'; document.getElementById('hf-screen').appendChild(host);
          window.__ca08 = null;
          HF.player.runSpec(spec, 'nback', { root: host, ruleCard: true }).then(function (r) { window.__ca08 = { status: r.status, attempts: r.attempts }; });
          return { lureCount: spec.meta.lureCount, lurePlan: spec.meta.lurePlan, seed: spec.seed }; }""")
        page.wait_for_function("() => HF.player.phase === 'rule'", timeout=10000)
        page.locator('.hf-play__start').click()
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=20000, polling='raf')
        page.keyboard.press('Escape')
        overlay_open(page)
        click_overlay(page, 'Resume')
        page.wait_for_function("() => HF.player.phase === 'countdown' || HF.player.phase === 'run'", timeout=10000)
        again = page.evaluate('() => { var m = HF.player.state().spec.meta; return { lureCount: m.lureCount, lurePlan: m.lurePlan, seed: HF.player.state().spec.seed }; }')
        chk.ok(again['seed'] != first['seed'], 'CA-08: the restart plays a fresh sequence (%s → %s)' % (first['seed'], again['seed']))
        chk.eq([again['lureCount'], again['lurePlan']], [first['lureCount'], first['lurePlan']], 'CA-08: the restarted Transform block keeps its lures (lureCount, lurePlan)')
        page.evaluate('() => HF.player.abort("test")')
        page.wait_for_function('() => window.__ca08 !== null', timeout=10000)
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 8. PQ-13
def part_help_escape(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'countdownStepMs': 60, 'timeScale': 0.6})
        go_session(page, {'free': {'trackId': 'rel.grid.T1', 'rung': 1}})
        start_block(page)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && s.trial !== null && s.trial !== ''; }", timeout=20000, polling='raf')
        page.keyboard.press('Escape')
        overlay_open(page)
        click_overlay(page, 'How to play')
        page.wait_for_function("() => { var d = document.querySelector('dialog.hf-modal--pause[open] .hf-play__pause-help'); return d && !d.hidden; }", timeout=5000)
        page.wait_for_timeout(400)
        page.keyboard.press('Escape')
        page.wait_for_timeout(500)
        st = page.evaluate("""() => { var d = document.querySelector('dialog.hf-modal--pause[open]');
          return { open: !!d, help: d ? !d.querySelector('.hf-play__pause-help').hidden : null, main: d ? !d.querySelector('.hf-play__pause-main').hidden : null,
            phase: HF.player.phase, focus: document.activeElement ? document.activeElement.textContent.trim() : '' }; }""")
        chk.ok(st['open'] and st['main'] and not st['help'] and st['phase'] == 'paused',
               'PQ-13: Escape on "How to play" goes back to the pause menu, still paused %s' % st)
        chk.eq(st['focus'], 'Resume', 'PQ-13: focus returns to Resume')
        page.keyboard.press('Escape')                           # now Escape = Resume
        page.wait_for_function("() => HF.player.phase === 'countdown' || HF.player.phase === 'run'", timeout=10000)
        chk.ok(True, 'PQ-13: Escape on the pause menu still resumes')
        page.evaluate('() => HF.router.go("today")')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 9. PQ-03
def part_assist(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        t = int(time.time() * 1000)
        boot(page, url, settings={'sessionMinutes': 25}, debug={'simulate': 'correct', 'countdownStepMs': 30},
             events=[{'id': 'ev-pq03-assist', 't': t, 'type': 'assist-start', 'trackId': 'rel.grid.T1'}])
        chk.ok(page.evaluate("() => !!(HF.store.derived.assist.tracks['rel.grid.T1'] || {}).active"), 'PQ-03 setup: the Grid aid is active')
        go_session(page)
        hl, notes, seen_assist = None, [], 0
        for _ in range(40):
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 30000)
            if ph == 'summary':
                break
            if ph == 'rule':
                role = page.evaluate('() => HF.player.state().bp.role')
                if role == 'assist' and hl is None:
                    # the first assisted Grid block runs for real: the highlight is on the grid
                    page.evaluate("() => { HF.player.debug.simulate = null; }")
                    start_block(page)
                    page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && s.trial !== null && s.trial !== ''; }", timeout=20000, polling='raf')
                    hl = page.evaluate("() => { var g = document.querySelector('.hf-play .hf-rg'); return g ? { hl: g.classList.contains('hf-rg--hl'), rel: g.getAttribute('data-rel') } : null; }")
                    shot(page, 'fixes-pq03-assist-grid')
                    page.keyboard.press('Escape')
                    overlay_open(page)
                    page.evaluate("() => { HF.player.debug.simulate = 'correct'; }")
                    click_overlay(page, 'End session')
                    wait_phase(page, 'summary', 20000)
                    go_session(page)                            # a new session: two assisted blocks at criterion fade the aid
                    continue
                if role == 'assist':
                    seen_assist += 1
                start_block(page)
            else:
                notes += page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-play-debrief .hf-notice'), function (n) { return n.textContent.trim(); })")
                page.keyboard.press('Space')
            page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
        chk.ok(hl and hl['hl'], 'PQ-03: the assisted Grid block highlights the symbols that count %s' % hl)
        faded = [n for n in notes if 'is now off' in n]
        chk.ok(seen_assist >= 2 and faded and 'highlighting' in faded[0] and 'memory tape' not in faded[0],
               'PQ-03: the fade note speaks of highlighting (%s, %d assisted blocks)' % (faded, seen_assist))
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 10. PQ-05
def part_free_leave(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'simulate': 'correct', 'countdownStepMs': 30})
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        sid = plan_id(page)
        page.evaluate('() => HF.router.go("today")')            # through the navigation, not Done
        page.wait_for_timeout(300)
        s = [x for x in sessions(page) if x['id'] == sid]
        chk.ok(len(s) == 1 and s[0]['endedAt'] and s[0]['endedBy'] == 'done', 'PQ-05: leaving Free play ends its session as done %s' % s)
        chk.eq([x['id'] for x in sessions(page) if not x['endedAt']], [], 'PQ-05: nothing left "in progress"')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- 11. PQ-12
LAND = """() => { var q = function (s) { return document.querySelector(s); }, R = function (e) { if (!e) return null; var r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  var rule = q('.hf-play .hf-v__rule'), lh = rule ? parseFloat(getComputedStyle(rule).lineHeight) : 0;
  return { vw: innerWidth, vh: innerHeight, stim: R(q('.hf-play .hf-rg, .hf-play .hf-vs')), rule: R(rule), lines: rule && lh ? Math.round(rule.getBoundingClientRect().height / lh) : null,
    pads: R(q('.hf-play .hf-pads')), top: R(q('.hf-play__top')), scroll: q('.hf-play').scrollHeight - q('.hf-play').clientHeight }; }"""


def overlaps(a, b):
    return a and b and a['l'] < b['r'] - 1 and b['l'] < a['r'] - 1 and a['t'] < b['b'] - 1 and b['t'] < a['b'] - 1


def part_landscape(b, url, chk):
    ctx, page, con = new_page(b, {'width': 844, 'height': 390}, 'light')
    try:
        boot(page, url, debug={'countdownStepMs': 30})
        for tid, rung in (('rel.grid.T1', 3), ('rel.stream', 0), ('vs.search', 4)):
            go_session(page, {'free': {'trackId': tid, 'rung': rung}})
            start_block(page, 'click')
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
            page.wait_for_timeout(600)
            m = page.evaluate(LAND)
            chk.details.setdefault('landscape', {})[tid] = m
            inside = m['stim'] and m['stim']['t'] >= -0.5 and m['stim']['b'] <= m['vh'] + 0.5 and m['pads']['b'] <= m['vh'] + 0.5
            clear = not overlaps(m['stim'], m['pads']) and not overlaps(m['stim'], m['top'])
            if tid == 'vs.search':
                chk.ok(m['stim']['w'] >= 359.5 and inside and clear, 'PQ-12 vs.search: the field keeps ≥ 360 px, inside the screen, clear of pads and top bar %s' % m['stim'])
            else:
                chk.ok(m['stim']['w'] >= 280 and abs(m['stim']['w'] - m['stim']['h']) < 2 and inside and clear,
                       'PQ-12 %s: the square uses the height (%d × %d), pads beside it, nothing overlaps' % (tid, m['stim']['w'], m['stim']['h']))
                chk.ok(m['lines'] is not None and m['lines'] <= 2, 'PQ-12 %s: the rule takes %s line(s)' % (tid, m['lines']))
            chk.ok(m['scroll'] <= 1, 'PQ-12 %s: no scrolling (%s px)' % (tid, m['scroll']))
            shot(page, 'fixes-pq12-landscape-' + tid)
            page.evaluate('() => HF.router.go("today")')
            page.wait_for_timeout(200)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-fixes')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        for part in (part_bare, part_hidden, part_audio, part_heap, part_start, part_resume, part_regen,
                     part_help_escape, part_assist, part_free_leave, part_landscape):
            try:
                cons.append(part(b, url, chk))
            except Exception as e:
                chk.ok(False, '%s crashed: %s' % (part.__name__, str(e)[:300]))
    errs = [e for c in cons for e in (c.errors + c.page_errors)]
    chk.ok(not errs, 'console errors: %s' % errs[:5])
    chk.details['seconds'] = round(time.time() - t0, 1)
    return chk.result()


if __name__ == '__main__':
    run_main(run)
