"""Every just-in-time lesson reaches its check (Dual, Transform, Arithmetic, Switch, Equal Steps, Relation Grid,
Relation Stream, Span, Visual search), answered by the bot with real key presses and clicks; the checks of Grid, Equal
Steps, Stream, Dual, Transform, Visual search and Span (own trial runner) are also run to a pass (lesson-passed written); the tier intros
T2–T8 pass on "Got it". Screenshots: out/learn/lesson-<id>-*.png (desktop light) and a phone/dark set.
Run: python3 tests/e2e/test_learn_lessons.py [lessonId …]
"""
import json
import sys

from helpers import Check, Console, browser, run_main, write_json
from test_learn_bot import OUT_DIR, boot, drive, set_speed, state

LESSONS = ['lesson.dual', 'lesson.transform', 'lesson.arith', 'lesson.switch', 'lesson.steps', 'lesson.grid', 'lesson.stream',
           'lesson.span', 'lesson.vsearch']
RUN_CHECK = {'lesson.grid', 'lesson.steps', 'lesson.stream', 'lesson.dual', 'lesson.transform', 'lesson.vsearch', 'lesson.span'}
OWN_PATH = {'lesson.span'}   # the span check runs through the lesson's own trial runner (the bot cannot drive P1b's keypad)


def at_check(st):
    return st.get('phase') == 'intro' and (st.get('step') or '').startswith('check:') and 'start' in (st.get('choices') or [])


def one_lesson(page, c, lid, tag='desk', run_check=False):
    page.evaluate(f"HF.router.go('learn', {{ lessonId: '{lid}' }})")
    page.wait_for_timeout(300)
    seen = {}
    short = lid.replace('lesson.', '')

    def snap(a, st):
        ph = st.get('phase')
        i = (st.get('trial') or {}).get('i')
        key = None
        if ph in ('guided', 'demo') and i == 3: key = ph
        if st.get('expect') in ('line', 'keypad', 'dual-answer') and st.get('expect') not in seen: key = st.get('expect')
        if key and key not in seen:
            seen[key] = True
            page.screenshot(path=f'{OUT_DIR}/lesson-{short}-{tag}-{key}.png')
    first = state(page)
    page.screenshot(path=f'{OUT_DIR}/lesson-{short}-{tag}-0-intro.png', full_page=True)
    c.ok(first.get('lessonId') == lid, f'{lid}: lesson started')
    drive(page, at_check, mode='pass', max_s=400, on_action=snap)
    page.screenshot(path=f'{OUT_DIR}/lesson-{short}-{tag}-9-check.png', full_page=True)
    c.ok(True, f'{lid}: reached its check')
    if not run_check:
        page.locator('[data-choice="leave"]').click()
        page.wait_for_timeout(400)
        c.eq(page.evaluate('HF.router.current.name'), 'learn', f'{lid}: leaving returns to Learn')
        c.eq(page.evaluate("HF.ui.lessons.active()"), False, f'{lid}: no lesson left running')
        return
    if lid in OWN_PATH:
        page.evaluate('HF.ui.lessons.config.usePlayer = false; HF.ui.lessons.config.useViews = false;')
    try:
        drive(page, lambda s: s.get('phase') == 'end', mode='pass', max_s=400)
    finally:
        page.evaluate('HF.ui.lessons.config.usePlayer = true; HF.ui.lessons.config.useViews = true;')
    st = state(page)
    c.ok((st.get('check') or {}).get('pass') is True, f'{lid}: check passed {json.dumps(st.get("check"))}')
    page.screenshot(path=f'{OUT_DIR}/lesson-{short}-{tag}-10-end.png', full_page=True)
    page.locator('[data-choice="finish"]').click()
    page.wait_for_timeout(400)
    ev = page.evaluate(f"HF.store.records.events.filter(e => e.type === 'lesson-passed' && e.lessonId === '{lid}').length")
    c.eq(ev, 1, f'{lid}: one lesson-passed event')
    c.eq(page.evaluate(f"HF.ui.lessons.list().filter(l => l.id === '{lid}')[0].passed"), True, f'{lid}: listed as passed')


def run(only=None):
    c = Check('learn-lessons')
    with browser() as b:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        page = ctx.new_page()
        con = Console(page)
        boot(page)
        set_speed(page, 0.5)
        for lid in (only or LESSONS):
            try:
                one_lesson(page, c, lid, run_check=lid in RUN_CHECK)
            except Exception as e:  # one broken lesson must not hide the others
                c.ok(False, f'{lid}: crashed: {e!r}'[:400])
                page.screenshot(path=f'{OUT_DIR}/lesson-{lid}-crash.png', full_page=True)
                page.evaluate("HF.ui.lessons.abort(); HF.router.go('learn')")
        if not only:
            # executive gate: passing the Transform lesson opens Transform before Plain reaches 2-back
            c.ok(page.evaluate("!!HF.store.derived.tracks['nback.transform'].available"), 'Transform opened by its lesson check')
            # tier intros: one screen, "Got it" passes
            for k in range(2, 9):
                lid = f'lesson.grid.T{k}'
                page.evaluate(f"HF.router.go('learn', {{ lessonId: '{lid}' }})")
                page.wait_for_timeout(250)
                if k in (2, 5, 6, 7):
                    page.screenshot(path=f'{OUT_DIR}/lesson-tier-T{k}.png', full_page=True)
                txt = page.locator('.hf-lesson').inner_text()
                c.ok('Example' in txt and 'Got it' in txt, f'{lid}: intro with an example')
                page.locator('[data-choice="next"]').click()
                page.wait_for_timeout(300)
                c.eq(page.evaluate(f"HF.store.records.events.filter(e => e.type === 'lesson-passed' && e.lessonId === '{lid}').length"), 1, f'{lid}: passed on Got it')
            c.eq(page.evaluate("HF.store.records.blocks.length"), 0, 'lessons never log training blocks')
        c.eq(con.errors + con.page_errors, [], '0 console errors')
        c.details['console'] = con.summary()
    # phone + dark: three lessons to their first guided step
    with browser() as b:
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', has_touch=True, is_mobile=True)
        page = ctx.new_page()
        con = Console(page)
        boot(page)
        set_speed(page, 0.5)
        page.evaluate("HF.store.mutate(r => { r.settings.theme = 'dark'; })")
        for lid in (['lesson.grid', 'lesson.steps', 'lesson.switch'] if not only else []):
            short = lid.replace('lesson.', '')
            page.evaluate(f"HF.router.go('learn', {{ lessonId: '{lid}' }})")
            page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT_DIR}/lesson-{short}-phone-0-intro.png', full_page=True)
            drive(page, lambda s: s.get('expect') in ('answer', 'line'), mode='pass', max_s=120)
            page.screenshot(path=f'{OUT_DIR}/lesson-{short}-phone-1-play.png')
            ov = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            c.ok(ov <= 0, f'{lid} phone: no horizontal overflow ({ov}px)')
            page.evaluate("HF.ui.lessons.abort(); HF.router.go('learn')")
            page.wait_for_timeout(200)
        c.eq(con.errors + con.page_errors, [], '0 console errors (phone, dark)')
    write_json('lessons.json', c.result())
    return c.result()


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a.startswith('lesson.')]
    run_main(lambda: run(args or None))
