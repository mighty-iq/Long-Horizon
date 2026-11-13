"""E2E (P1a): Free play — route params { free: { trackId, rung, pace } } → HF.planner.freeSlot, debrief with
Next block / Change / Done, the inline picker (version + level), the summary. Desktop light (real key presses on the
first block) and phone dark (picker layout).
Run: python3 tests/e2e/test_session_free.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, answer_block, boot, browser, build_page, finish,
                              go_session, layout_ok, new_page, plan_id, run_main, session_blocks, shot, start_block,
                              wait_phase)


def debrief_actions(page):
    return page.evaluate("""() => Array.prototype.map.call(document.querySelectorAll('.hf-play-debrief .hf-debrief__actions .hf-btn'),
      function (b) { return (b.getAttribute('data-action') || (b.classList.contains('hf-btn--primary') ? 'primary' : '?')) + ':' + b.textContent.trim(); })""")


def run_desktop(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'timeScale': 0.5, 'countdownStepMs': 150})
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2, 'pace': 'fast'}})
        wait_phase(page, 'rule', 20000)
        bp = page.evaluate('() => { var b = HF.player.state().bp; return { trackId: b.trackId, rung: b.rung, role: b.role }; }')
        chk.eq(bp, {'trackId': 'nback.plain', 'rung': 3, 'role': 'free'}, 'free params: Plain, 2-back at the fast pace (rung 3), role free')
        shot(page, 'free-desktop-1-rule')
        start_block(page)
        answer_block(page)
        wait_phase(page, 'debrief', 60000)
        acts = debrief_actions(page)
        chk.ok(acts == ['done:Done', 'change:Change', 'primary:Next blockSpace'] or acts == ['done:Done', 'change:Change', 'primary:Next block'],
               'debrief offers Done, Change and Next block (primary) %s' % acts)
        shot(page, 'free-desktop-2-debrief')
        pid = plan_id(page)
        page.keyboard.press('Space')                                   # Next block
        wait_phase(page, 'rule', 20000)
        chk.eq(page.evaluate('() => HF.player.state().bp.trackId'), 'nback.plain', 'Next block keeps the version')
        page.evaluate("() => { HF.player.debug.simulate = 'correct'; }")
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        page.locator('.hf-play-debrief [data-action="change"]').click()
        wait_phase(page, 'pick', 20000)
        shot(page, 'free-desktop-3-picker')
        opts = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-sess__pick select')[0].options, function (o) { return o.value; })")
        chk.ok('nback.transform' in opts and 'nback.dual' in opts and 'rel.grid.T1' in opts and 'vs.search' not in opts, 'picker lists the available versions (no search) %s' % opts)
        page.locator('.hf-sess__pick select').first.select_option('nback.transform')
        lv = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-sess__pick select')[1].options, function (o) { return o.textContent; })")
        chk.ok(any('your level' in x for x in lv), 'level list marks your level %s' % lv[:3])
        page.locator('.hf-sess__pick select').nth(1).select_option('2')
        page.locator('.hf-sess__pick .hf-btn--primary').click()
        wait_phase(page, 'rule', 20000)
        bp2 = page.evaluate('() => { var b = HF.player.state().bp; return { trackId: b.trackId, rung: b.rung }; }')
        chk.eq(bp2, {'trackId': 'nback.transform', 'rung': 2}, 'Change → Transform 2-back from the picker')
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        page.locator('.hf-play-debrief [data-action="done"]').click()
        wait_phase(page, 'summary', 20000)
        shot(page, 'free-desktop-4-summary', full=True)
        blocks = session_blocks(page, pid)
        chk.eq(len(blocks), 3, 'three free-play blocks committed')
        chk.ok(all(x['role'] == 'free' for x in blocks), 'all blocks have role free')
        sess = page.evaluate("(pid) => HF.store.records.sessions.filter(function (s) { return s.id === pid; })[0]", pid)
        chk.eq(sess['endedBy'], 'done', 'Done ends the free session as done')
        lead = page.evaluate("() => document.querySelector('.hf-sess--summary .hf-lead').textContent")
        chk.ok(lead.startswith('You played 3 blocks'), 'summary counts the blocks: %r' % lead)
    finally:
        ctx.close()
    return con


def run_phone(b, url, chk):
    ctx, page, con = new_page(b, PHONE, 'dark')
    try:
        boot(page, url, settings={'theme': 'dark'}, debug={'simulate': 'correct', 'countdownStepMs': 60})
        go_session(page, {'free': {'trackId': 'rel.grid.T1', 'rung': 1}})
        wait_phase(page, 'rule', 20000)
        shot(page, 'free-phone-1-rule')
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        shot(page, 'free-phone-2-debrief')
        page.locator('.hf-play-debrief [data-action="change"]').click()
        wait_phase(page, 'pick', 20000)
        shot(page, 'free-phone-3-picker')
        chk.ok(not layout_ok(page)['overflowX'], 'phone picker: no horizontal overflow')
        page.locator('.hf-sess__pick .hf-btn', has_text='Done').click()
        wait_phase(page, 'summary', 20000)
        chk.eq(page.evaluate("() => document.querySelector('.hf-sess--summary h1').textContent"), 'Session done', 'phone: picker Done → summary')
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-free')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_desktop(b, url, chk))
        cons.append(run_phone(b, url, chk))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
