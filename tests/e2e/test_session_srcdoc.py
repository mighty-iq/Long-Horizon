"""E2E (P1a): the session flow inside a sandboxed preview: the harness inlined into
<iframe sandbox="allow-scripts" srcdoc=…> (opaque origin → localStorage blocked → the store runs in memory).
Checks: memory mode; a session starts, block 1 is played with real key presses after a real click on Start inside the
frame, the pause overlay works (Escape → Resume), the rest is simulated (test hook), the summary and Done work; the
frame never navigates away (no '#/' link is followed); no console or page errors.
Run: python3 tests/e2e/test_session_srcdoc.py
"""
import html
import time

from test_session_lib import (OUT, SKIPPED, Check, Console, answer_block, browser, close_modals, finish,
                              inline_page, run_main, wait_phase)


def run():
    chk = Check('session-srcdoc')
    t0 = time.time()
    doc = inline_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    OUT.mkdir(parents=True, exist_ok=True)
    host = OUT / 'session-srcdoc-host.html'
    host.write_text('<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0">'
                    '<iframe id="f" title="Long-Horizon preview" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0" '
                    'srcdoc="%s"></iframe></body></html>' % html.escape(doc, quote=True))
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        con = Console(page)
        navs = []
        page.on('framenavigated', lambda f: navs.append(f.url) if f != page.main_frame else None)
        page.goto(host.as_uri())
        page.wait_for_function("document.getElementById('f').contentWindow !== null")
        frame = next(f for f in page.frames if f != page.main_frame)
        frame.wait_for_function('window.HF && HF.booted === true', timeout=30000)
        close_modals(frame)
        navs.clear()
        chk.ok(frame.evaluate('() => HF.store.persistent') is False, 'storage blocked → memory mode')
        frame.evaluate("""() => {
          HF.store.mutate(function (r) { var s = {}; for (var k in r.settings) s[k] = r.settings[k]; s.sessionMinutes = 10; r.settings = s;
            r.events = r.events.concat([{ id: 'ev-t-l1', t: Date.now() - 5000, type: 'lesson-passed', lessonId: 'lesson.nback' },
                                        { id: 'ev-t-l2', t: Date.now() - 5000, type: 'lesson-passed', lessonId: 'lesson.grid' }]); });
          HF.player.debug.timeScale = 0.5; HF.player.debug.countdownStepMs = 150;
          HF.router.go('session', { fresh: true }); }""")
        wait_phase(frame, 'rule', 20000)
        frame.locator('.hf-play__start').click()
        frame.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 3; }", timeout=30000, polling='raf')
        page.keyboard.press('Escape')
        frame.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
        chk.ok(True, 'pause overlay opens inside the frame')
        frame.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
        frame.wait_for_function("() => HF.player.phase === 'run'", timeout=15000)
        chk.ok(frame.evaluate('() => /\\/r1$/.test(HF.player.state().spec.seed)'), 'stream restarted with a fresh seed inside the frame')
        res = answer_block(frame)
        chk.ok(res['pressed'] > 0, 'real key presses reach the sandboxed frame')
        wait_phase(frame, 'debrief', 60000)
        chk.ok(frame.evaluate("() => HF.store.records.blocks.filter(function (b) { return !b.interrupted; })[0].result.ba") >= 0.99, 'block scored in memory mode')
        frame.evaluate("() => { HF.player.debug.simulate = 'correct'; HF.player.debug.countdownStepMs = 40; }")
        for _ in range(40):
            ph = wait_phase(frame, ['rule', 'debrief', 'summary'], 30000)
            if ph == 'summary':
                break
            if ph == 'rule':
                frame.locator('.hf-play__start').click()
            else:
                frame.locator('.hf-play-debrief .hf-btn--primary').click()
            frame.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
        chk.eq(wait_phase(frame, 'summary', 10000), 'summary', 'summary reached in the sandbox')
        page.screenshot(path=str(OUT / 'srcdoc-summary.png'))
        frame.locator('.hf-sess--summary .hf-btn--primary').click()
        frame.wait_for_function("() => HF.router.current.name === 'today'", timeout=10000)
        away = [u for u in navs if not u.startswith('about:srcdoc')]
        chk.eq(away, [], 'the frame never navigated away (hash mirrors on about:srcdoc are fine: %s)' % navs)
        page.close()
    return finish(chk, con, t0)


if __name__ == '__main__':
    run_main(run)
