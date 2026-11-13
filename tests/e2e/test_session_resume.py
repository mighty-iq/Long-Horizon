"""E2E (P1a): Today's two session params, and never two open sessions.

1. { planId }: the session uses Today's preview id as its plan / session id.
2. { resume: sessionId } (Today's "Continue"): 2 of 7 blocks played, the page reloads mid-session; the reload lands on
   #/session and the bare route continues today's open session by itself; then Today's explicit { resume } does
   too: same id, the bar starts at block 3, the next slot is k2, the remaining 5 blocks play, the session ends 'done'
   with 7 blocks and no duplicate slot.
3. Leaving the session screen after a played block keeps the session open (Today offers Continue / End it here);
   a NEW session ({ planId }) ends it first (endedBy 'quit', end time = its last block): one open session at most.
4. Edge cases: resume of an unknown id starts a fresh session; a planId that is already used is not reused.
Blocks are simulated (HF.player.debug.simulate = 'correct', test hook): this test is about the session flow.
Run: python3 tests/e2e/test_session_resume.py
"""
import time

from test_session_lib import (DESKTOP, SKIPPED, Check, boot, browser, build_page, close_modals, finish, go_session,
                              new_page, plan_id, run_main, session_blocks, shot, start_block, wait_phase)

DEBUG = "() => { HF.player.debug.simulate = 'correct'; HF.player.debug.countdownStepMs = 40; }"


def play_blocks(page, k):
    for _ in range(k):
        wait_phase(page, 'rule', 20000)
        start_block(page)
        wait_phase(page, 'debrief', 30000)
        page.keyboard.press('Space')
        page.wait_for_function("() => document.querySelector('.hf-sess').getAttribute('data-phase') !== 'debrief'", timeout=20000)


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
    page.evaluate(DEBUG)


def sessions(page):
    return page.evaluate("() => HF.store.records.sessions.map(function (s) { return { id: s.id, endedAt: s.endedAt, endedBy: s.endedBy, completed: s.completed, planned: s.planned, startedAt: s.startedAt }; })")


def run():
    chk = Check('session-resume')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    with browser() as b:
        ctx, page, con = new_page(b, DESKTOP, 'light')
        try:
            boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 40})
            chk.ok(page.evaluate('() => HF.store.persistent'), 'storage is persistent in this harness (file://)')
            # 1. planId
            go_session(page, {'planId': 'stest-plan-1'})
            wait_phase(page, 'rule', 20000)
            chk.eq(plan_id(page), 'stest-plan-1', "planId becomes the plan's id")
            s = [x for x in sessions(page) if x['id'] == 'stest-plan-1']
            chk.ok(len(s) == 1 and s[0]['endedAt'] is None, 'the session record uses that id and is open')
            # 2. two blocks, then the page closes mid-session
            play_blocks(page, 2)
            wait_phase(page, 'rule', 20000)
            reload(page)
            s = [x for x in sessions(page) if x['id'] == 'stest-plan-1'][0]
            chk.ok(s['endedAt'] is None and s['completed'] == 2, 'after the reload the session is still open with 2 blocks %s' % s)
            wait_phase(page, 'rule', 20000)
            auto = page.evaluate("() => { var S = HF.session.current(); return S ? { resumed: !!S.resumed, id: S.plan.id, slot: HF.player.state().bp.slotId } : null; }")
            chk.ok(auto and auto['resumed'] and auto['id'] == 'stest-plan-1' and auto['slot'] == 'k2', 'the reload on #/session continued the open session %s' % auto)
            go_session(page, {'resume': 'stest-plan-1'})
            wait_phase(page, 'rule', 20000)
            st = page.evaluate("""() => { var S = HF.session.current(); return { resumed: !!S.resumed, id: S.plan.id,
              slot: HF.player.state().bp.slotId, count: (document.querySelector('.hf-sbar__count') || {}).textContent }; }""")
            chk.ok(st['resumed'] and st['id'] == 'stest-plan-1', 'resumed the same session %s' % st)
            chk.eq(st['slot'], 'k2', 'the next block is the third slot')
            chk.eq(st['count'], 'Block 3 of 7', 'the bar picks up at block 3')
            shot(page, 'resume-1-rule')
            chk.ok(play_to_end(page), 'resumed session reached the summary')
            shot(page, 'resume-2-summary', full=True)
            bl = session_blocks(page, 'stest-plan-1')
            slots = [x['slotId'] for x in bl]
            chk.eq(len(bl), 7, 'seven blocks in the resumed session')
            chk.eq(len(set(slots)), 7, 'no slot played twice %s' % slots)
            s = [x for x in sessions(page) if x['id'] == 'stest-plan-1'][0]
            chk.ok(s['endedBy'] == 'done' and s['completed'] == 7, 'resumed session ended done with 7 blocks %s' % s)
            lead = page.evaluate("() => document.querySelector('.hf-sess--summary .hf-lead').textContent")
            chk.ok(lead.startswith('You played 7 blocks'), 'summary counts the blocks played before the reload too: %r' % lead)
            # 3. leaving after a played block keeps the session open; a new session ends it first
            go_session(page, {'planId': 'stest-plan-2'})
            wait_phase(page, 'rule', 20000)
            stale = plan_id(page)
            play_blocks(page, 1)
            page.evaluate('() => HF.router.go("today")')
            open_ = [x for x in sessions(page) if x['id'] == stale][0]
            chk.ok(open_['endedAt'] is None and open_['completed'] == 1, 'leaving after a played block keeps the session open %s' % open_)
            go_session(page, {'planId': 'stest-plan-3'})
            wait_phase(page, 'rule', 20000)
            fresh = plan_id(page)
            chk.eq(fresh, 'stest-plan-3', 'the new session uses its planId')
            ss = sessions(page)
            old = [x for x in ss if x['id'] == stale][0]
            chk.ok(old['endedBy'] == 'quit' and old['endedAt'] is not None, 'the stale session was ended as quit %s' % old)
            chk.ok(old['endedAt'] - old['startedAt'] <= 5 * 60000, 'its end time is its last block, not now')
            chk.eq([x['id'] for x in ss if x['endedAt'] is None], [fresh], 'exactly one open session: the new one')
            # 4. edge cases
            go_session(page, {'resume': 'no-such-session'})
            wait_phase(page, 'rule', 20000)
            pid = plan_id(page)
            chk.ok(pid not in ('no-such-session', fresh), 'resume of an unknown id starts a fresh session')
            chk.eq([x['id'] for x in sessions(page) if x['endedAt'] is None], [pid], 'still one open session (the previous one had no blocks: ended on leave)')
            go_session(page, {'planId': 'stest-plan-1'})
            wait_phase(page, 'rule', 20000)
            chk.ok(plan_id(page) != 'stest-plan-1', 'a planId that is already used is not reused')
        finally:
            ctx.close()
    return finish(chk, con, t0)


if __name__ == '__main__':
    run_main(run)
