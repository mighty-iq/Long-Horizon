"""E2E (P1a): pause, stream restart, discrete resume, quitting mid-session (desktop keyboard + phone touch).

1. Stream (Plain n-back): Escape at trial 4 → the pause overlay (Resume / How to play / End session); How to play
   shows the rule and Back returns; Resume → 3-2-1 → the block restarts with a fresh sequence (seed + '/r1'); the
   partial run is committed with interrupted: true (nothing moves); the restarted block is played correctly and
   counts (attempt 1, not interrupted).
2. Discrete (Relation Grid): Escape mid-block → overlay → Resume → 3-2-1 → the same block continues with the next
   array; it is committed with interrupted: true, the level does not move, the debrief says why.
3. Quit: Escape during the next block → End session → a confirm asks first (Phase 4, UX-06: as the header End
   button does); Escape closes only the confirm (the pause menu stays, focus back on End); End → "End session" in
   the confirm → the summary says "Session ended"; the session record has endedBy 'quit'; the partial block is
   committed as interrupted.
4. Phone (touch): the on-screen pause button opens the overlay; End session from there (and its confirm);
   HF.timing.pause('hidden') shows the "page was hidden" reason.
Run: python3 tests/e2e/test_session_pause.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, answer_block, boot, browser, build_page, finish,
                              go_session, new_page, plan_id, run_main, session_blocks, shot, start_block, wait_phase)

OVERLAY = "() => { var d = document.querySelector('dialog.hf-modal--pause[open]'); return d ? { text: d.textContent, buttons: Array.prototype.map.call(d.querySelectorAll('.hf-play__pause-main .hf-modal__actions .hf-btn'), function (b) { return b.textContent.trim(); }) } : null; }"


def wait_overlay(page, timeout=10000):
    page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=timeout)
    page.wait_for_timeout(450)          # let the dialog's entry animation finish before screenshots
    return page.evaluate(OVERLAY)


def click_in_overlay(page, label):
    page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text=label).first.click()


CONFIRM = """() => { var d = document.querySelector('dialog.hf-modal--confirm[open]');
  return d ? { text: d.innerText, buttons: Array.prototype.map.call(d.querySelectorAll('.hf-btn'), function (b) { return b.textContent.trim(); }) } : null; }"""


def confirm_end(page, tap=False):
    """End session in the pause menu asks first (Phase 4, UX-06): answer the confirm with its primary button."""
    page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
    page.wait_for_timeout(300)
    btn = page.locator('dialog.hf-modal--confirm[open] .hf-btn--primary')
    if tap:
        btn.tap()
    else:
        btn.click()


def run_desktop(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'timeScale': 0.6, 'countdownStepMs': 200})
        go_session(page, {})
        pid = None
        # ---- 1. stream pause → restart with a fresh seed
        start_block(page)
        pid = plan_id(page)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 4; }", timeout=30000, polling='raf')
        seed0 = page.evaluate('() => HF.player.state().spec.seed')
        page.keyboard.press('Escape')
        ov = wait_overlay(page)
        shot(page, 'pause-desktop-1-overlay')
        chk.ok(ov and ov['buttons'][-1] == 'Resume' and 'How to play' in ov['buttons'] and 'End session' in ov['buttons'],
               'overlay offers End session, How to play, Resume (primary last) %s' % (ov and ov['buttons']))
        chk.ok(ov and 'new items' in ov['text'], 'overlay explains that a stream restarts with new items')
        chk.eq(page.evaluate("() => document.querySelector('.hf-sess').getAttribute('data-phase')"), 'paused', 'session phase is paused')
        chk.ok(page.evaluate('() => !document.documentElement.hasAttribute("data-busy")'), 'html[data-busy] cleared while paused')
        click_in_overlay(page, 'How to play')
        page.wait_for_function("() => { var d = document.querySelector('dialog.hf-modal--pause[open] .hf-play__pause-help'); return d && !d.hidden; }", timeout=5000)
        shot(page, 'pause-desktop-2-howto')
        help_text = page.evaluate("() => document.querySelector('dialog.hf-modal--pause[open] .hf-play__pause-help').textContent")
        chk.ok('Press Match' in help_text, 'How to play shows the block rule')
        click_in_overlay(page, 'Back to the pause menu')
        click_in_overlay(page, 'Resume')
        page.wait_for_function("() => HF.player.phase === 'countdown'", timeout=5000)
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=10000)
        seed1 = page.evaluate('() => HF.player.state().spec.seed')
        chk.eq(seed1, seed0 + '/r1', 'the stream restarted with a fresh seed')
        blocks = session_blocks(page, pid)
        chk.ok(len(blocks) == 1 and blocks[0]['interrupted'] and blocks[0]['moved'] == 0, 'partial run committed as interrupted, nothing moved %s' % [(x['id'], x['interrupted'], x['moved']) for x in blocks])
        answer_block(page)
        wait_phase(page, 'debrief', 60000)
        blocks = session_blocks(page, pid)
        chk.eq(len(blocks), 2, 'restarted block committed too')
        if len(blocks) == 2:
            chk.ok(not blocks[1]['interrupted'] and blocks[1]['attempt'] == 1 and blocks[1]['seed'].endswith('/r1') and blocks[1]['result']['ba'] >= 0.99,
                   'restarted block counts (attempt 1, its own seed, BA 1.0): %s' % {k: blocks[1][k] for k in ('id', 'attempt', 'seed', 'interrupted')})
        page.keyboard.press('Space')
        # ---- 2. discrete pause → resume (run the remaining n-back blocks with simulated answers to reach the Grid)
        page.evaluate("() => { HF.player.debug.simulate = 'correct'; }")
        while True:
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 60000)
            tid = page.evaluate('() => { var s = HF.player.state(); return s.bp ? s.bp.trackId : null; }')
            if ph == 'rule' and tid and tid.startswith('rel.grid'):
                break
            if ph == 'summary':
                chk.ok(False, 'reached the summary before a Grid block')
                return con
            page.keyboard.press('Space')
            page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
        page.evaluate("() => { HF.player.debug.simulate = null; }")
        start_block(page)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 3; }", timeout=30000, polling='raf')
        grid_seed = page.evaluate('() => HF.player.state().spec.seed')
        page.keyboard.press('Escape')
        ov = wait_overlay(page)
        chk.ok(ov and 'next item' in ov['text'], 'discrete overlay: continues with the next item')
        shot(page, 'pause-desktop-3-overlay-grid')
        click_in_overlay(page, 'Resume')
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=10000)
        chk.eq(page.evaluate('() => HF.player.state().spec.seed'), grid_seed, 'discrete block resumed with the same arrays')
        answer_block(page)
        wait_phase(page, 'debrief', 60000)
        shot(page, 'pause-desktop-4-debrief-interrupted')
        gb = [x for x in session_blocks(page, pid) if x['trackId'].startswith('rel.grid')][-1]
        chk.ok(gb['interrupted'] and gb['moved'] == 0 and gb['levelAfter'] == gb['levelBefore'], 'paused Grid block committed as interrupted, level unchanged')
        line = page.evaluate("() => document.querySelector('.hf-debrief__line').textContent")
        chk.ok('pause' in line, 'debrief explains the pause: %r' % line)
        page.keyboard.press('Space')
        # ---- 3. quit mid-block
        start_block(page)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=30000, polling='raf')
        page.keyboard.press('Escape')
        wait_overlay(page)
        click_in_overlay(page, 'End session')
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
        page.wait_for_timeout(300)
        cf = page.evaluate(CONFIRM)
        chk.ok(cf and 'End the session?' in cf['text'] and 'blocks you finished are kept' in cf['text'] and cf['buttons'] == ['Keep going', 'End session'],
               'UX-06: End in the pause menu asks first, with the header button\'s words %s' % cf)
        chk.eq(page.evaluate("() => HF.player.phase"), 'paused', 'UX-06: nothing ends while the confirm is open')
        shot(page, 'pause-desktop-5a-end-confirm')
        page.keyboard.press('Escape')
        page.wait_for_function("() => !document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
        page.wait_for_timeout(200)
        st = page.evaluate("""() => ({ pause: !!document.querySelector('dialog.hf-modal--pause[open]'), phase: HF.player.phase,
          focus: document.activeElement ? document.activeElement.textContent.trim() : null })""")
        chk.ok(st['pause'] and st['phase'] == 'paused' and st['focus'] == 'End session',
               'UX-06: Escape closes only the confirm; the pause menu stays, focus back on End %s' % st)
        click_in_overlay(page, 'End session')
        confirm_end(page)
        wait_phase(page, 'summary', 20000)
        shot(page, 'pause-desktop-5-summary-quit', full=True)
        h1 = page.evaluate("() => document.querySelector('.hf-sess--summary h1').textContent")
        chk.eq(h1, 'Session ended', 'summary heading after quitting')
        sess = page.evaluate("(pid) => HF.store.records.sessions.filter(function (s) { return s.id === pid; })[0]", pid)
        chk.eq(sess['endedBy'], 'quit', 'session record endedBy quit')
        last = session_blocks(page, pid)[-1]
        chk.ok(last['interrupted'] and last['moved'] == 0, 'the quit block is committed as interrupted')
        chk.ok(page.evaluate('() => HF.ui.shell.chrome()') is True, 'chrome restored after quitting')
        chk.ok(not page.evaluate('() => HF.timing.active'), 'no run left active')
    finally:
        ctx.close()
    return con


def run_phone(b, url, chk):
    ctx, page, con = new_page(b, PHONE, 'dark')
    try:
        boot(page, url, settings={'theme': 'dark'}, debug={'timeScale': 0.6, 'countdownStepMs': 200})
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
        wait_phase(page, 'rule', 20000)
        page.locator('.hf-play__start').tap()
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=30000, polling='raf')
        page.evaluate("() => HF.timing.pause('hidden')")
        ov = wait_overlay(page)
        chk.ok(ov and 'page was hidden' in ov['text'], 'phone: hidden-page reason shown')
        shot(page, 'pause-phone-1-overlay-hidden')
        click_in_overlay(page, 'Resume')
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=30000, polling='raf')
        page.locator('.hf-play__pause').tap()
        ov = wait_overlay(page)
        chk.ok(ov is not None, 'phone: the on-screen pause button opens the overlay')
        click_in_overlay(page, 'End session')
        confirm_end(page, tap=True)
        wait_phase(page, 'summary', 20000)
        shot(page, 'pause-phone-2-summary', full=True)
        pid = plan_id(page)
        bl = session_blocks(page, pid)
        chk.ok(len(bl) == 2 and all(x['interrupted'] for x in bl), 'phone: both stopped runs committed as interrupted (%d)' % len(bl))
    finally:
        ctx.close()
    return con


def run_stream_rule(b, url, chk):
    """A paused Relation Stream restarts with the SAME rule (only the seed changes) in the same view (view.reset)."""
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'timeScale': 0.6, 'countdownStepMs': 100})
        for seed_try in range(3):
            go_session(page, {'free': {'trackId': 'rel.stream', 'rung': 0}})
            wait_phase(page, 'rule', 20000)
            start_block(page)
            page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=30000, polling='raf')
            before = page.evaluate("() => { var s = HF.player.state(); var v = document.querySelector('.hf-play .hf-v'); if (v) v.__hfTag = 'same-view'; return { seed: s.spec.seed, rule: s.spec.params.rule, meta: s.spec.meta.rule.id }; }")
            page.keyboard.press('Escape')
            wait_overlay(page)
            click_in_overlay(page, 'Resume')
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=15000)
            after = page.evaluate("() => { var s = HF.player.state(); var v = document.querySelector('.hf-play .hf-v'); return { seed: s.spec.seed, rule: s.spec.params.rule, meta: s.spec.meta.rule.id, tag: v ? v.__hfTag || null : null }; }")
            chk.eq(after['seed'], before['seed'] + '/r1', 'Relation Stream restart: fresh seed')
            chk.ok(after['rule'] == before['rule'] and after['meta'] == before['meta'], 'Relation Stream restart keeps the rule %s → %s' % (before, after))
            chk.eq(after['tag'], 'same-view', 'Relation Stream restart reuses the view (view.reset)')
            page.evaluate('() => HF.player.abort("test")')
            break
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-pause')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_desktop(b, url, chk))
        cons.append(run_phone(b, url, chk))
        cons.append(run_stream_rule(b, url, chk))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
