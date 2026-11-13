"""E2E (P1a): the player with a custom flow — a Span block (HF.views.span runs itself as an HF.timing.custom flow).

Checks: Free play { trackId: 'span.op' } starts through the rule card; Escape during the first list opens the
player's pause overlay ONLY (ctx2.onPause is passed, so the view's built-in panel stays hidden: one open dialog);
Resume → 3-2-1 → the view continues (its flow is no longer paused); the on-screen pause button pauses it again
(view.pause); End session → the session summary; the block is committed with interrupted: true; no console errors.
Run: python3 tests/e2e/test_session_span.py
"""
import time

from test_session_lib import (DESKTOP, SKIPPED, Check, boot, browser, build_page, finish, go_session, new_page,
                              plan_id, run_main, session_blocks, shot, start_block, wait_phase)


def run():
    chk = Check('session-span')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    with browser() as b:
        ctx, page, con = new_page(b, DESKTOP, 'light')
        try:
            boot(page, url, settings={'spanOn': True}, debug={'countdownStepMs': 100})
            go_session(page, {'free': {'trackId': 'span.op', 'rung': 0}})
            wait_phase(page, 'rule', 20000)
            chk.eq(page.evaluate('() => HF.player.state().viewKey'), 'span', 'Span block uses HF.views.span')
            shot(page, 'span-1-rule')
            start_block(page)
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
            page.wait_for_timeout(2500)
            shot(page, 'span-2-run')
            page.keyboard.press('Escape')
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
            page.wait_for_timeout(450)
            st = page.evaluate("""() => ({ dialogs: document.querySelectorAll('dialog[open]').length,
              viewPaused: !!document.querySelector('.hf-play .is-paused'),
              builtIn: /This list will not count|Nothing is lost. The next list/.test(document.querySelector('.hf-play').textContent) })""")
            chk.ok(st['dialogs'] == 1 and not st['builtIn'], 'one pause overlay, no built-in Span panel %s' % st)
            chk.ok(st['viewPaused'], 'the Span view is paused')
            shot(page, 'span-3-overlay')
            page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=15000)
            page.wait_for_function("() => !document.querySelector('.hf-play .is-paused')", timeout=10000)
            chk.ok(True, 'Resume → 3-2-1 → the Span flow continues')
            page.wait_for_timeout(1500)
            page.locator('.hf-play__pause').click()
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
            page.wait_for_timeout(450)
            chk.ok(page.evaluate("() => !!document.querySelector('.hf-play .is-paused')"), 'the pause button pauses the Span flow')
            page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='End session').click()
            # the pause menu's End asks first, as the header End button does (Phase 4, UX-06)
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
            page.wait_for_timeout(300)
            page.locator('dialog.hf-modal--confirm[open] .hf-btn--primary').click()
            wait_phase(page, 'summary', 20000)
            bl = session_blocks(page, plan_id(page))
            chk.ok(len(bl) == 1 and bl[0]['trackId'] == 'span.op' and bl[0]['interrupted'], 'the Span block is committed as interrupted %s' % [(x['trackId'], x['interrupted']) for x in bl])
            chk.ok(not page.evaluate('() => HF.timing.active'), 'no flow left running')
        finally:
            ctx.close()
    return finish(chk, con, t0)


if __name__ == '__main__':
    run_main(run)
