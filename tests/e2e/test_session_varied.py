"""E2E (P1a): a full short Varied session (10 min → 7 blocks) played with REAL key presses that answer correctly from
the spec; levels move, every block is committed, the session ends 'done', the summary shows; then the same screens
on phone / dark / desktop-dark (simulated answers, test hook) with layout checks and screenshots.

Run: python3 tests/e2e/test_session_varied.py      (Chromium, one browser, always closed)
Speed hooks (test only): HF.player.debug.timeScale = 0.5 (SOA 1.5 s) and countdownStepMs = 250 in the real run.
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, answer_block, boot, browser, build_page, errors_of,
                              finish, go_session, layout_ok, new_page, plan_id, run_main, session_blocks, shot,
                              start_block, wait_phase)


def leave_debrief(page, click=False):
    if click:
        page.locator('.hf-play-debrief .hf-btn--primary').click()
    else:
        page.keyboard.press('Space')
    page.wait_for_function("() => { var s = document.querySelector('.hf-sess'); return s && s.getAttribute('data-phase') !== 'debrief'; }", timeout=20000)


def run_real(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'timeScale': 0.5, 'countdownStepMs': 250})
        go_session(page, {})
        ph = wait_phase(page, ['rule', 'empty', 'lesson'], 20000)
        chk.eq(ph, 'rule', 'session opens on the first rule card')
        pid = plan_id(page)
        planned = page.evaluate('() => HF.session.current().plan.slots.length')
        roles = page.evaluate('() => HF.session.current().plan.slots.map(function (s) { return s.trackId + ":" + s.role; })')
        chk.eq(planned, 7, '10-minute Varied session 1 has 7 blocks')
        chk.details['plan'] = roles
        shot(page, 'varied-desktop-light-1-rule')
        lay = layout_ok(page)
        chk.ok(not lay['overflowX'], 'rule card: no horizontal overflow')
        played = 0
        shots = {}
        while True:
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 180000)
            if ph == 'summary':
                break
            if ph == 'rule':
                start_block(page, how=['space', 'enter', 'click'][played % 3])
                tid = page.evaluate('() => HF.player.state().bp.trackId')

                def on_trial(i, tid=tid):
                    if i == 4 and tid not in shots:
                        shots[tid] = shot(page, 'varied-desktop-light-run-' + tid.replace('.', '-'))
                        lay2 = layout_ok(page)
                        chk.ok(lay2.get('padsInView') is not False, 'pads inside the viewport while %s runs: %s' % (tid, lay2))
                res = answer_block(page, on_trial=on_trial)
                played += 1
                chk.ok(res['pressed'] > 0, 'block %d answered with key presses (%s)' % (played, res.get('trackId')))
                continue
            if played == 1:
                shot(page, 'varied-desktop-light-2-debrief')
                page.locator('.hf-debrief details > summary').first.click()
                shot(page, 'varied-desktop-light-3-debrief-details')
            if played == 5:
                shot(page, 'varied-desktop-light-4-debrief-grid')
            leave_debrief(page, click=(played == 1))
        shot(page, 'varied-desktop-light-5-summary', full=True)
        blocks = session_blocks(page, pid)
        chk.eq(len(blocks), planned, 'every block was committed')
        chk.ok(all(b2['result']['ba'] >= 0.99 for b2 in blocks), 'correct answers score BA 1.0: %s' % [b2['result']['ba'] for b2 in blocks])
        chk.ok(not any(b2['interrupted'] for b2 in blocks), 'no block flagged interrupted')
        moved = [b2 for b2 in blocks if b2['role'] == 'rated' and b2['moved'] > 0]
        chk.ok(len(moved) >= 3, 'levels moved up on rated blocks (%d moves)' % len(moved))
        st = page.evaluate("""(pid) => { var s = HF.store.records.sessions.filter(function (x) { return x.id === pid; })[0];
          var d = HF.store.derived; return { endedBy: s.endedBy, completed: s.completed, planned: s.planned,
          plain: d.tracks['nback.plain'].level, grid: d.tracks['rel.grid.T1'].level }; }""", pid)
        chk.details['session'] = st
        chk.eq(st['endedBy'], 'done', 'session ended as done')
        chk.eq(st['completed'], planned, 'session record counts every block')
        chk.ok(st['plain'] > 0 and st['grid'] > 0, 'Plain and Grid levels rose: %s' % st)
        summ = page.evaluate("""() => ({ h1: (document.querySelector('.hf-sess--summary h1') || {}).textContent,
          ring: !!document.querySelector('.hf-sess--summary .hf-ring'), levels: document.querySelectorAll('.hf-sess__lvl').length,
          done: !!Array.prototype.filter.call(document.querySelectorAll('.hf-sess--summary .hf-btn--primary'), function (x) { return /Done/.test(x.textContent); }).length,
          primaries: document.querySelectorAll('.hf-sess--summary .hf-btn--primary').length })""")
        chk.details['summary'] = summ
        chk.eq(summ['h1'], 'Session done', 'summary heading')
        chk.ok(summ['ring'], 'summary shows the weekly ring')
        chk.ok(summ['levels'] >= 2, 'summary lists the level changes')
        chk.eq(summ['primaries'], 1, 'one primary button on the summary')
        share = page.locator('.hf-sess--summary .hf-btn', has_text='Share to Discord')
        if share.count():
            share.click()
            page.wait_for_function("() => !!document.querySelector('.hf-sess__share .hf-share')", timeout=10000)
            txt = page.evaluate("() => { var t = document.querySelector('.hf-sess__share textarea'); return t ? t.value : document.querySelector('.hf-sess__share').textContent; }")
            chk.ok('discord.gg/chmr' in txt, 'Share to Discord shows the share text with discord.gg/chmr')
            shot(page, 'varied-desktop-light-6-share', full=True)
        else:
            chk.details['share'] = 'HF.ui.share not loaded'
        page.locator('.hf-sess__acts .hf-btn--primary').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'today'", timeout=10000)
        chk.ok(page.evaluate('() => HF.ui.shell.chrome()') is True, 'chrome visible again after the session')
        chk.details['real_errors'] = errors_of(con)
    finally:
        ctx.close()
    return con


def run_variant(b, url, chk, viewport, theme, tag):
    ctx, page, con = new_page(b, viewport, theme)
    try:
        boot(page, url, settings={'sessionMinutes': 10, 'theme': theme}, debug={'simulate': 'correct', 'countdownStepMs': 60})
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        shot(page, 'varied-%s-1-rule' % tag)
        lay = layout_ok(page)
        chk.ok(not lay['overflowX'], '%s rule card: no horizontal overflow' % tag)
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        shot(page, 'varied-%s-2-debrief' % tag)
        chk.ok(not layout_ok(page)['overflowX'], '%s debrief: no horizontal overflow' % tag)
        n = 0
        while True:
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 60000)
            if ph == 'summary':
                break
            if ph == 'rule':
                start_block(page)
                page.wait_for_function("() => { var s = document.querySelector('.hf-sess'); return s && s.getAttribute('data-phase') !== 'rule'; }", timeout=20000)
            else:
                leave_debrief(page)
            n += 1
            if n > 40:
                chk.ok(False, '%s: session did not finish' % tag)
                break
        shot(page, 'varied-%s-3-summary' % tag, full=True)
        chk.ok(not layout_ok(page)['overflowX'], '%s summary: no horizontal overflow' % tag)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-varied')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_real(b, url, chk))
        for vp, theme, tag in ((PHONE, 'light', 'phone-light'), (PHONE, 'dark', 'phone-dark'), (DESKTOP, 'dark', 'desktop-dark')):
            cons.append(run_variant(b, url, chk, vp, theme, tag))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
