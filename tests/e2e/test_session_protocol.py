"""E2E (P1a): Protocols and Study arms come from the plan.

Cao 2026: a full 20-block session. Runtime short-circuit (test hook, documented in docs/dev/player-notes.md):
block 1 is played for real with key presses (HF.player.debug.timeScale = 0.5 → 250 ms items every 1.25 s); blocks
2–20 use HF.player.debug.simulate = 'correct' (the player builds the log every block would get from a perfect
player, without showing the stimuli) — the rule card, countdown, scoring, engine commit and debrief run for every
block. Checks: 20 slots of Transform with days; per-block debrief shows the next level (no score, Cao shows only the
level); every block committed with protocol 'cao'; the level moves per Cao's rule (> 18 correct → up) and each block
starts where the last ended; the session ends 'done'; Cao's protocol state records the session.
Wang 2025: 5 Equal Steps blocks with 10 targets (bp.targets → gen); no per-block feedback; the summary shows the day's
accuracy. Jaeggi 2008: Dual blocks with the level between blocks (1 block, then End session).
Study, control arm (study-enrol + study-draw events): the plan runs visual search through HF.views.vsearch; block 1
answered with real J / F presses.
Run: python3 tests/e2e/test_session_protocol.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, answer_block, boot, browser, build_page, finish,
                              go_session, new_page, plan_id, run_main, session_blocks, shot, start_block, wait_phase)


def debrief_info(page):
    return page.evaluate("""() => ({ line: (document.querySelector('.hf-debrief__line') || {}).textContent,
      score: !!document.querySelector('.hf-debrief__score'),
      keys: Array.prototype.map.call(document.querySelectorAll('.hf-debrief__k'), function (x) { return x.textContent; }),
      next: (document.querySelector('.hf-debrief__v') || {}).textContent || null })""")


def play_through(page, max_steps=200):
    n = 0
    while n < max_steps:
        ph = wait_phase(page, ['rule', 'debrief', 'summary'], 60000)
        if ph == 'summary':
            return True
        if ph == 'rule':
            start_block(page)
        else:
            page.keyboard.press('Space')
        page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=30000)
        n += 1
    return False


def run_cao(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'mode': 'protocols', 'protocols': {'cao': True, 'wang': False, 'jaeggi': False}},
             debug={'timeScale': 0.5, 'countdownStepMs': 150})
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        plan = page.evaluate("() => { var p = HF.session.current().plan; return { n: p.slots.length, protocol: p.protocol, tracks: p.slots.map(function (s) { return s.trackId + '/' + s.set; }).filter(function (v, i, a) { return a.indexOf(v) === i; }) }; }")
        chk.eq(plan['n'], 20, 'Cao: 20 blocks')
        chk.eq(plan['protocol'], 'cao', 'Cao: plan protocol')
        chk.eq(plan['tracks'], ['nback.transform/days'], 'Cao: Transform with days')
        shot(page, 'protocol-cao-1-rule')
        pid = plan_id(page)
        start_block(page)
        answer_block(page)
        wait_phase(page, 'debrief', 60000)
        info = debrief_info(page)
        shot(page, 'protocol-cao-2-debrief')
        chk.ok(not info['score'] and 'Next block' in info['keys'], 'Cao debrief: the next level, no score %s' % info)
        page.evaluate("() => { HF.player.debug.simulate = 'correct'; HF.player.debug.countdownStepMs = 40; }")
        page.keyboard.press('Space')
        chk.ok(play_through(page), 'Cao: reached the summary')
        shot(page, 'protocol-cao-3-summary', full=True)
        blocks = sorted(session_blocks(page, pid), key=lambda x: x['t'])
        chk.eq(len(blocks), 20, 'Cao: 20 blocks committed')
        chk.ok(all(x['protocol'] == 'cao' and not x['interrupted'] for x in blocks), 'Cao: every block is a full Cao block')
        chain = all(blocks[k + 1]['rung'] == blocks[k]['levelAfter'] for k in range(len(blocks) - 1))
        chk.ok(chain, "Cao: each block starts at the previous block's level %s" % [(x['rung'], x['levelAfter']) for x in blocks[:6]])
        ups = [x for x in blocks if x['moved'] > 0]
        chk.ok(len(ups) >= 5, 'Cao: perfect blocks move the level up (%d moves)' % len(ups))
        st = page.evaluate("(pid) => { var s = HF.store.records.sessions.filter(function (x) { return x.id === pid; })[0]; var c = HF.store.derived.protocols.cao; return { endedBy: s.endedBy, sessions: c.sessions.length, last: c.sessions.length ? c.sessions[c.sessions.length - 1].blocks : null }; }", pid)
        chk.eq(st['endedBy'], 'done', 'Cao: session ended done')
        chk.ok(st['sessions'] == 1 and st['last'] == 20, "Cao: protocol state records 1 session of 20 blocks %s" % st)
    finally:
        ctx.close()
    return con


def run_wang_jaeggi_study(b, url, chk):
    ctx, page, con = new_page(b, PHONE, 'light')
    try:
        boot(page, url, settings={'mode': 'protocols', 'protocols': {'cao': False, 'wang': True, 'jaeggi': False}},
             debug={'timeScale': 0.5, 'countdownStepMs': 100})
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        chk.eq(page.evaluate('() => HF.session.current().plan.slots.length'), 5, 'Wang: 5 blocks')
        targets = page.evaluate('() => HF.player.state().bp.targets')
        chk.eq(targets, 10, 'Wang: the BlockPlan asks for 10 targets')
        shot(page, 'protocol-wang-1-rule')
        start_block(page)
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
        chk.eq(page.evaluate('() => HF.player.state().spec.meta.targets.main'), 10, 'Wang: the generated block has 10 targets')
        answer_block(page)
        wait_phase(page, 'debrief', 60000)
        info = debrief_info(page)
        chk.ok(not info['score'] and not info['next'] and info['line'] == 'Block done.', 'Wang debrief: no score, no level %s' % info)
        shot(page, 'protocol-wang-2-debrief')
        page.evaluate("() => { HF.player.debug.simulate = 'correct'; HF.player.debug.countdownStepMs = 40; }")
        page.keyboard.press('Space')
        chk.ok(play_through(page), 'Wang: reached the summary')
        shot(page, 'protocol-wang-3-summary', full=True)
        txt = page.evaluate("() => document.querySelector('.hf-sess--summary').textContent")
        chk.ok("Today's accuracy: 100%" in txt, "Wang summary shows the day's accuracy")

        # Jaeggi: Dual, the level between blocks; one block then End session
        page.evaluate("""() => { HF.store.mutate(function (r) { var s = {}; for (var k in r.settings) s[k] = r.settings[k];
          s.protocols = { cao: false, wang: false, jaeggi: true }; s.updatedAt = Date.now(); r.settings = s; }); }""")
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        tid = page.evaluate('() => HF.player.state().bp.trackId')
        chk.eq(tid, 'nback.dual', 'Jaeggi: Dual n-back')
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        info = debrief_info(page)
        chk.ok('Next block' in info['keys'], 'Jaeggi debrief shows the next level %s' % info)
        page.locator('.hf-sess__end').click()
        page.locator('dialog.hf-modal[open] .hf-btn--primary').click()
        wait_phase(page, 'summary', 20000)
        chk.eq(page.evaluate("() => HF.store.records.sessions.slice(-1)[0].endedBy"), 'quit', 'Jaeggi: End session from the head ends it as quit')

        # Study, control arm → visual search
        page.evaluate("""() => { HF.store.mutate(function (r) { var t = Date.now();
          var s = {}; for (var k in r.settings) s[k] = r.settings[k]; s.mode = 'varied'; s.updatedAt = t; r.settings = s;
          r.events = r.events.concat([{ id: 'ev-test-enrol', t: t - 5000, type: 'study-enrol', template: 'default', consentAt: t - 5000 },
                                      { id: 'ev-test-draw', t: t - 4000, type: 'study-draw', arm: 'control', template: 'default' }]); });
          HF.player.debug.simulate = null; HF.player.debug.countdownStepMs = 100; }""")
        go_session(page, {})
        wait_phase(page, ['rule', 'empty'], 20000)
        tracks = page.evaluate("() => HF.session.current().plan.slots.map(function (s) { return s.trackId; }).filter(function (v, i, a) { return a.indexOf(v) === i; })")
        chk.eq(tracks, ['vs.search'], 'Study control arm: visual search only')
        shot(page, 'study-control-1-rule')
        start_block(page)
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
        chk.eq(page.evaluate('() => HF.player.state().viewKey'), 'vsearch', 'Study control arm: HF.views.vsearch')
        answer_block(page, on_trial=lambda i: shot(page, 'study-control-2-run') if i == 2 else None)
        wait_phase(page, 'debrief', 60000)
        shot(page, 'study-control-3-debrief')
        bl = session_blocks(page, plan_id(page))
        chk.ok(len(bl) == 1 and bl[0]['trackId'] == 'vs.search' and bl[0]['result']['ba'] >= 0.99, 'Study control block committed, perfect J/F answers')
        page.locator('.hf-sess__end').click()
        page.locator('dialog.hf-modal[open] .hf-btn--primary').click()
        wait_phase(page, 'summary', 20000)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-protocol')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_cao(b, url, chk))
        cons.append(run_wang_jaeggi_study(b, url, chk))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
