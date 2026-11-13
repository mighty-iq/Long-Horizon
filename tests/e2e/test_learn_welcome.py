"""First run, pass path: welcome → Start training now → the whole n-back lesson (N1–N7) answered with real key
presses → check passed → Chimera line → profile.firstRunDone / path set → route 'session'.
Also checks: tutorial data are never logged as training (no blocks, no trial logs), events = lesson-passed only.
Screenshots of every step type go to out/learn/flow-*.png (desktop, light theme).
Run: python3 tests/e2e/test_learn_welcome.py [--real] [--views | --own]
  --real   real timing (default: timeScale 0.5)
  timed runs: HF.player (default) | --views: HF.timing + HF.views (no player) | --own: HF.timing + the lesson's own view
"""
import json
import sys

from helpers import Check, Console, browser, run_main, write_json
from test_learn_bot import OUT_DIR, boot, drive, set_speed, state


def run(real=False, path='player'):
    tag = path
    c = Check('learn-welcome-' + tag)
    shots = {}
    with browser() as b:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        page = ctx.new_page()
        con = Console(page)
        boot(page)
        if not real:
            set_speed(page, 0.5)
        if path in ('views', 'own'):
            page.evaluate('HF.ui.lessons.config.usePlayer = false')
        if path == 'own':
            page.evaluate('HF.ui.lessons.config.useViews = false')
        page.evaluate("HF.router.go('today')")
        page.wait_for_timeout(500)
        if page.evaluate('HF.router.current.name') != 'welcome':
            page.evaluate("HF.router.go('welcome')")
            page.wait_for_timeout(300)
        c.eq(page.evaluate('HF.router.current.name'), 'welcome', 'first run lands on welcome')
        c.eq(page.evaluate('document.activeElement && document.activeElement.id'), 'hf-welcome-start', 'Start training now has focus')
        txt = page.locator('.hf-welcome').inner_text()
        c.ok('About 50 min now' in txt and '2–7 days later' in txt, 'Measure first shows its time cost')
        page.screenshot(path=f'{OUT_DIR}/flow-{tag}-00-welcome.png')
        page.keyboard.press('Enter')   # the focused default choice
        page.wait_for_timeout(300)

        def snap(a, st):
            key = (st.get('step') or '') + '|' + (st.get('phase') or '') + '|' + str(st.get('expect'))
            name = None
            if st.get('phase') == 'page' and 'What you will see' in (st.get('step') or ''): name = '01-parts'
            elif st.get('phase') == 'demo' and (st.get('trial') or {}).get('i') == 2 and '1-back' in (st.get('step') or ''): name = '02-demo1'
            elif st.get('phase') == 'guided' and (st.get('trial') or {}).get('i') == 3 and 'Your turn: 1-back' in (st.get('step') or ''): name = '03-guided1'
            elif st.get('expect') == 'probe': name = '05-probe'
            elif st.get('phase') == 'demo' and (st.get('trial') or {}).get('i') == 6 and '2-back' in (st.get('step') or ''): name = '04-demo2-lure'
            elif st.get('phase') == 'result' and 'slowly' in (st.get('step') or ''): name = '06-timed-result'
            elif 'check' in (st.get('step') or '').lower() and st.get('expect') == 'choice' and 'start' in (st.get('choices') or []): name = '07-check-intro'
            elif st.get('phase') == 'result' and 'check' in (st.get('step') or '').lower(): name = '08-check-result'
            if name and name not in shots:
                shots[name] = True
                page.screenshot(path=f'{OUT_DIR}/flow-{tag}-{name}.png')

        def done(st):
            return bool(st.get('phase') == 'end')
        acts = drive(page, done, mode='pass', max_s=900, on_action=snap)
        page.screenshot(path=f'{OUT_DIR}/flow-{tag}-09-end.png', full_page=True)
        st = state(page)
        c.ok(st.get('result', {}).get('passed') is True, 'the check was passed: ' + json.dumps(st.get('check')))
        c.eq((st.get('check') or {}).get('path'), path, 'timed runs used the ' + path + ' path')
        c.details['check'] = st.get('check')
        c.details['actions'] = len(acts)
        endtxt = page.locator('.hf-lesson').inner_text()
        c.ok('Questions or ideas? The Chimera community is on Discord' in endtxt, 'Chimera line at the end of the first lesson')
        c.eq(page.locator('.hf-lchimera a[href="https://discord.gg/chmr"]').count(), 1, 'real Discord link')
        page.locator('[data-choice="finish"]').click()
        page.wait_for_timeout(800)
        prof = page.evaluate('HF.store.records.profile')
        c.ok(prof.get('firstRunDone') is True, 'profile.firstRunDone = true')
        c.eq(prof.get('path'), 'train', 'profile.path = train')
        c.eq(page.evaluate('HF.router.current.name'), 'session', 'route: session')
        c.eq(page.evaluate('HF.router.current.params'), {'fresh': True}, 'route params: { fresh: true } (a new session, Phase 4 CB-05)')
        ev = page.evaluate("HF.store.records.events.filter(e => /^lesson|^assist/.test(e.type)).map(e => ({type: e.type, lessonId: e.lessonId || null, trackId: e.trackId || null}))")
        c.eq(ev, [{'type': 'lesson-passed', 'lessonId': 'lesson.nback', 'trackId': None}], 'events: one lesson-passed for lesson.nback')
        c.eq(page.evaluate('HF.store.records.blocks.length'), 0, 'no BlockRecords from the lesson')
        c.eq(page.evaluate('HF.store.trialSessionIds().length'), 0, 'no trial logs from the lesson')
        c.eq(page.evaluate("HF.ui.lessons.needed('nback.plain')"), None, 'needed(nback.plain) → null after the pass')
        c.eq(page.evaluate("HF.ui.lessons.needed('rel.grid.T1')"), 'lesson.grid', 'needed(rel.grid.T1) → lesson.grid')
        c.ok(page.evaluate("!!(HF.store.derived.badges && HF.store.derived.badges['rules-learned'])"), 'derive sees the pass (rules-learned badge)')
        # leave the session screen cleanly before closing
        page.evaluate("HF.router.go('learn')")
        page.wait_for_timeout(300)
        c.eq(con.errors + con.page_errors, [], '0 console errors')
        c.details['console'] = con.summary()
    write_json(f'welcome-{tag}.json', c.result())
    return c.result()


if __name__ == '__main__':
    real = '--real' in sys.argv
    path = 'own' if '--own' in sys.argv else ('views' if '--views' in sys.argv else 'player')
    run_main(lambda: run(real=real, path=path))
