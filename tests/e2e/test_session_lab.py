"""E2E (P1a): HF.player.runSpec as the Lab uses it, and pause-by-Escape at every stage.

1. Lab n-back probe block (set glyphsLab) through runSpec with a rule card and chrome: false: no training level chip
   or tier/step text on the rule card or the task layer; the shell chrome stays as it was; Escape mid-run pauses;
   Resume uses opts.regenerate(k); the block is played to the end with real key presses; the returned spec is the
   one actually played; the result is scored; attempts = 2 (one restart; Phase 4, CB-06).
2. Lab relation probe block (variant 'lab') through runSpec: no chip, no "step … of 9" anywhere.
3. Escape during the 3-2-1 countdown (not busy, so the browser does not prevent Escape): the overlay opens on the
   next task and STAYS open; Resume → countdown → run.
Run: python3 tests/e2e/test_session_lab.py
"""
import time

from test_session_lib import (DESKTOP, SKIPPED, Check, answer_block, boot, browser, build_page, finish, go_session,
                              new_page, run_main, shot, start_block, wait_phase)

NO_LEVEL = """() => { var t = document.body.innerText;
  return { chips: document.querySelectorAll('.hf-chip--level').length, step: /step \\d+ of 9|Tier \\d|\\d-back/.test(t) }; }"""


def run():
    chk = Check('session-lab')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    with browser() as b:
        ctx, page, con = new_page(b, DESKTOP, 'light')
        try:
            boot(page, url, debug={'countdownStepMs': 150, 'timeScale': 0.5})
            # 1. n-back probe block
            page.evaluate("""() => {
              var spec = HF.lab.tests['lab.nback'].gen({ form: 'A' }).blocks[0];
              var host = document.createElement('div'); host.id = 'hf-lab-host'; document.getElementById('hf-screen').appendChild(host);
              window.__regen = 0; window.__res = null;
              HF.player.runSpec(spec, 'nback', { root: host, ruleCard: true, chrome: false,
                regenerate: function (k) { window.__regen = k; var s = HF.tasks.nback.gen({ trackId: spec.trackId, rung: spec.rung, params: spec.params,
                  set: spec.set, seed: 'lab-test/r' + k, lureCount: 4, lab: true }); return s; } })
                .then(function (r) { window.__res = { status: r.status, seed: r.spec && r.spec.seed, ba: r.result ? r.result.ba : null, attempts: r.attempts }; });
            }""")
            page.wait_for_function("() => HF.player.phase === 'rule'", timeout=10000)
            nl = page.evaluate(NO_LEVEL)
            chk.ok(nl['chips'] == 0 and not nl['step'], 'Lab rule card: no level chip, no level text %s' % nl)
            shot(page, 'lab-1-rule')
            page.locator('.hf-play__start').click()
            page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 3; }", timeout=20000, polling='raf')
            nl = page.evaluate(NO_LEVEL)
            chk.ok(nl['chips'] == 0 and not nl['step'], 'Lab task layer: no level chip, no level text %s' % nl)
            chk.ok(page.evaluate('() => HF.ui.shell.chrome()') is True, 'runSpec with chrome: false leaves the chrome alone')
            shot(page, 'lab-2-run')
            page.keyboard.press('Escape')
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
            page.wait_for_timeout(600)
            chk.ok(page.evaluate("() => !!document.querySelector('dialog.hf-modal--pause[open]')"), 'Escape mid-run: the overlay stays open')
            page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=15000)
            chk.eq(page.evaluate('() => window.__regen'), 1, 'Resume after a stream pause calls opts.regenerate(1)')
            chk.eq(page.evaluate('() => HF.player.state().spec.seed'), 'lab-test/r1', 'the regenerated spec is played')
            answer_block(page)
            page.wait_for_function('() => window.__res !== null', timeout=60000)
            res = page.evaluate('() => window.__res')
            chk.ok(res['status'] == 'done' and res['seed'] == 'lab-test/r1' and res['ba'] is not None and res['ba'] >= 0.99,
                   'runSpec returns the spec actually played, scored %s' % res)
            chk.eq(res.get('attempts'), 2, 'runSpec returns attempts: 2 after one stream restart (Phase 4, CB-06)')
            # 2. relation probe block
            page.evaluate("""() => {
              var spec = HF.lab.tests['lab.rel'].gen({ form: 'A' }).blocks[0];
              window.__res = null;
              HF.player.runSpec(spec, 'relations', { root: document.getElementById('hf-lab-host'), ruleCard: true })
                .then(function (r) { window.__res = { status: r.status }; });
            }""")
            page.wait_for_function("() => HF.player.phase === 'rule'", timeout=10000)
            nl = page.evaluate(NO_LEVEL)
            chk.ok(nl['chips'] == 0 and not nl['step'], 'Lab relation probe rule card: no level chip, no tier/step text %s' % nl)
            page.locator('.hf-play__start').click()
            page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 1; }", timeout=20000, polling='raf')
            nl = page.evaluate(NO_LEVEL)
            chk.ok(nl['chips'] == 0 and not nl['step'], 'Lab relation probe: no level chip, no tier/step text %s' % nl)
            shot(page, 'lab-3-rel-probe')
            page.evaluate('() => HF.player.abort("test")')
            page.wait_for_function('() => window.__res !== null', timeout=10000)
            # 3. Escape during the countdown of a training block
            page.evaluate('() => { HF.player.debug.countdownStepMs = 1200; }')
            go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
            start_block(page)
            page.wait_for_function("() => HF.player.phase === 'countdown'", timeout=10000)
            page.wait_for_timeout(300)
            page.keyboard.press('Escape')
            page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
            page.wait_for_timeout(700)
            chk.ok(page.evaluate("() => !!document.querySelector('dialog.hf-modal--pause[open]')"), 'Escape during the 3-2-1: the overlay opens and stays open')
            page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
            page.wait_for_function("() => HF.player.phase === 'countdown'", timeout=5000)
            page.evaluate('() => { HF.player.debug.countdownStepMs = 150; }')
            page.wait_for_function("() => HF.player.phase === 'run'", timeout=15000)
            chk.ok(True, 'Resume from the countdown pause → countdown → run')
            page.evaluate('() => HF.player.abort("test")')
        finally:
            ctx.close()
    return finish(chk, con, t0)


if __name__ == '__main__':
    run_main(run)
