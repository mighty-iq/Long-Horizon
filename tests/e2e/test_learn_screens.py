"""Learn, help pages, practice, welcome (both choices) — desktop 1366×768 and phone 390×844, light and dark;
no horizontal overflow, no hash links, real Discord link, 0 console errors; Measure first → labvisit {kind: 'B1'};
leaving a lesson half-way offers restart / skip; the sandboxed srcdoc build runs a lesson without navigating away.
Screenshots: out/learn/screen-*.png
Run: python3 tests/e2e/test_learn_screens.py
"""
import html
import json
import pathlib
import subprocess

from helpers import ROOT, Check, Console, browser, close_modals, run_main, write_json
from test_learn_bot import OUT_DIR, act, boot, drive, state

PAGES = [('home', "HF.router.go('learn')"), ('howto', "HF.router.go('learn', { page: 'howto' })"),
         ('strategy', "HF.router.go('learn', { page: 'strategy' })"), ('glossary', "HF.router.go('learn', { page: 'glossary' })"),
         ('why', "HF.router.go('learn', { page: 'why' })"), ('practice', "HF.router.go('practice')"), ('welcome', "HF.router.go('welcome')")]


def overflow(page):
    return page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')


def sweep(c, page, tag):
    for name, js in PAGES:
        page.evaluate(js)
        page.wait_for_timeout(250)
        page.screenshot(path=f'{OUT_DIR}/screen-{name}-{tag}.png', full_page=True)
        c.ok(overflow(page) <= 0, f'{tag} {name}: no horizontal overflow ({overflow(page)} px)')
        bad = page.evaluate("[...document.querySelectorAll('#hf-screen a[href^=\"#\"]')].map(a => a.getAttribute('href'))")
        c.eq(bad, [], f'{tag} {name}: no hash links')
        small = page.evaluate("""() => [...document.querySelectorAll('#hf-screen button, #hf-screen a[href], #hf-screen select, #hf-screen summary')]
            .filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect()).filter(r => r.height < 43.5 && r.width > 0).length""")
        c.ok(small == 0 or tag.startswith('desk'), f'{tag} {name}: touch targets ≥ 44 px ({small} smaller)')


def run():
    c = Check('learn-screens')
    for vp, tag, scheme in (({'width': 1366, 'height': 768}, 'desk-light', 'light'), ({'width': 1366, 'height': 768}, 'desk-dark', 'dark'),
                            ({'width': 390, 'height': 844}, 'phone-light', 'light'), ({'width': 390, 'height': 844}, 'phone-dark', 'dark')):
        with browser() as b:
            phone = vp['width'] < 600
            ctx = b.new_context(viewport=vp, color_scheme=scheme, has_touch=phone, is_mobile=phone)
            page = ctx.new_page()
            con = Console(page)
            boot(page)
            sweep(c, page, tag)
            if tag.startswith('phone'):
                # the tutorial on a phone: first page, a guided item with the tape, the check card
                page.evaluate("HF.router.go('learn', { lessonId: 'lesson.nback' })")
                page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT_DIR}/screen-tutorial-1-{tag}.png', full_page=True)
                c.ok(overflow(page) <= 0, f'{tag} tutorial page 1: no horizontal overflow')
                drive(page, lambda s: s.get('phase') == 'guided' and (s.get('trial') or {}).get('i') == 3, max_s=90)
                page.screenshot(path=f'{OUT_DIR}/screen-tutorial-2-{tag}.png')
                c.ok(overflow(page) <= 0, f'{tag} tutorial guided: no horizontal overflow')
                pads = page.evaluate("[...document.querySelectorAll('.hf-lboard .hf-pad')].map(p => Math.round(p.getBoundingClientRect().height))")
                c.ok(len(pads) == 2 and min(pads) >= 44, f'{tag}: answer pads ≥ 44 px {pads}')
                page.evaluate("HF.ui.lessons.abort(); HF.router.go('learn')")
                page.wait_for_timeout(200)
            if tag == 'desk-light':
                # Learn home content and navigation
                page.evaluate("HF.router.go('learn')")
                page.wait_for_timeout(200)
                txt = page.locator('#hf-screen').inner_text()
                for s in ('The tutorial', 'Lessons for each task', 'Practice', 'Help', 'How to play', 'Strategy cards', 'Glossary', 'Why Long-Horizon works this way'):
                    c.ok(s in txt, 'Learn home shows ' + s)
                c.eq(page.locator('#hf-screen a[href="https://discord.gg/chmr"]').count(), 1, 'Discord link on Learn')
                page.get_by_text('Glossary', exact=True).click()
                page.wait_for_timeout(200)
                c.eq(page.evaluate('HF.router.current.params.page'), 'glossary', 'row opens the glossary')
                g = page.locator('.hf-lgloss').inner_text()
                for term in ('Match', 'Lure', 'False press', 'Level', 'Tier', 'Step', 'Balanced accuracy', 'd′', 'Near transfer', 'Mid transfer', 'Far transfer', 'Noise band'):
                    c.ok(term in g, 'glossary term ' + term)
                page.locator('.hf-learn__back button').click()
                page.wait_for_timeout(200)
                c.ok(page.evaluate("!HF.router.current.params || !HF.router.current.params.page"), 'back to the Learn home')
                page.evaluate("HF.router.go('learn', { page: 'strategy' })")
                page.wait_for_timeout(200)
                c.ok('Tested in a study' in page.locator('[data-card="nback-grouping"]').inner_text(), 'grouping card marked tested')
                c.ok('Untested' in page.locator('[data-card="ri-scan"]').inner_text(), 'RI scanning card marked untested')
                page.evaluate("HF.router.go('learn', { page: 'why' })")
                page.wait_for_timeout(200)
                why = page.locator('#hf-screen').inner_text()
                c.ok('Cao et al. 2026' in why and 'Wang' in why and 'no untrained control group' in why, 'research page cites Cao and Wang honestly')
                c.ok('What Long-Horizon can and cannot claim' in why and 'cannot show cause' in why, 'claims on the research page')
                c.eq(page.locator('#hf-why-lab').count(), 1, 'research page links to the Lab')
                page.click('#hf-why-lab')
                page.wait_for_timeout(250)
                c.eq(page.evaluate('HF.router.current.name'), 'lab', 'Open the Lab goes to the Lab home')
                page.evaluate("HF.router.go('learn', { page: 'howto' })")
                page.wait_for_timeout(200)
                c.ok(page.locator('details[data-task]').count() >= 10, 'How to play lists every task')
                # practice: another task, a few real answers, then leave — nothing saved
                page.evaluate("HF.router.go('practice')")
                page.wait_for_timeout(200)
                page.select_option('[data-ctl="track"] select', 'rel.steps')
                page.click('#hf-practice-start')
                page.wait_for_timeout(300)
                for _ in range(8):          # a few real answers (J/F) and Next presses
                    act(page, state(page), 'pass', [])
                    page.wait_for_timeout(120)
                page.screenshot(path=f'{OUT_DIR}/screen-practice-steps-{tag}.png')
                c.ok(page.locator('.hf-ltape--steps').count() == 1, 'Equal Steps practice shows the steps tape')
                page.evaluate("HF.router.go('learn')")
                page.wait_for_timeout(200)
                c.eq(page.evaluate('HF.ui.lessons.active()'), False, 'leaving practice stops it')
                c.eq(page.evaluate("HF.store.records.events.filter(e => /^lesson|^assist/.test(e.type)).length"), 0, 'practice writes nothing')
                # welcome: Measure first, leave the lesson half-way, skip for now → labvisit B1
                page.evaluate("HF.router.go('welcome')")
                page.wait_for_timeout(200)
                page.click('#hf-welcome-measure')
                page.wait_for_timeout(300)
                c.eq(state(page).get('lessonId'), 'lesson.nback', 'Measure first: the n-back lesson comes first')
                page.locator('[data-choice="leave"]').click()
                page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT_DIR}/screen-welcome-onhold-{tag}.png')
                c.ok(page.locator('#hf-welcome-skip').count() == 1 and page.locator('#hf-welcome-again').count() == 1, 'on hold: restart or skip')
                page.click('#hf-welcome-skip')
                page.wait_for_timeout(500)
                prof = page.evaluate('HF.store.records.profile')
                c.ok(prof.get('firstRunDone') is True and prof.get('path') == 'measure', 'profile: firstRunDone, path measure')
                cur = page.evaluate('HF.router.current')
                c.eq(cur['name'], 'labvisit', 'route after Measure first: ' + json.dumps(cur)[:120])
                c.eq((cur.get('params') or {}).get('kind'), 'B1', 'labvisit kind B1')
                page.screenshot(path=f'{OUT_DIR}/screen-welcome-labvisit-{tag}.png', full_page=True)
                c.ok('Baseline 1' in page.locator('#hf-screen').inner_text(), 'the Lab visit screen shows Baseline 1')
                c.eq(page.evaluate("HF.ui.lessons.needed('nback.plain')"), 'lesson.nback', 'the skipped lesson still runs before the first n-back block')
                page.evaluate("HF.router.go('learn')")
                page.wait_for_timeout(300)
            c.eq(con.errors + con.page_errors, [], f'{tag}: 0 console errors')
            c.details[tag] = con.summary()
    # sandboxed srcdoc: the single-file build runs a lesson without navigating away
    subprocess.run(['node', 'tools/build-single.mjs'], cwd=ROOT, capture_output=True, text=True, check=True)
    doc = (ROOT / 'dist' / 'long-horizon.html').read_text()
    hostf = pathlib.Path(OUT_DIR) / 'srcdoc-host.html'
    hostf.parent.mkdir(parents=True, exist_ok=True)
    hostf.write_text('<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0">'
                     '<iframe id="f" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0" '
                     f'srcdoc="{html.escape(doc, quote=True)}"></iframe></body></html>')
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        con = Console(page)
        navs = []
        page.on('framenavigated', lambda f: navs.append(f.url) if f != page.main_frame else None)
        page.goto(hostf.as_uri())
        frame = None
        for _ in range(100):
            frames = [f for f in page.frames if f != page.main_frame]
            if frames:
                frame = frames[0]
                break
            page.wait_for_timeout(50)
        frame.wait_for_function('window.HF && HF.booted === true', timeout=20000)
        page.wait_for_timeout(300)
        close_modals(frame)
        n0 = len(navs)
        frame.evaluate("HF.router.go('learn')")
        frame.wait_for_timeout(200)
        frame.locator('[data-lesson="lesson.nback"]').click()
        frame.wait_for_timeout(300)
        for _ in range(6):
            frame.locator('[data-choice="next"]').last.click()
            frame.wait_for_timeout(150)
        st = frame.evaluate('JSON.parse(JSON.stringify(HF.ui.lessons._state()))')
        c.ok(st.get('lessonId') == 'lesson.nback' and st.get('phase') in ('demo', 'guided'), 'srcdoc: the lesson runs ' + json.dumps(st)[:160])
        c.ok(all(u.split('#')[0] == 'about:srcdoc' for u in navs), 'srcdoc: the frame never left its document: ' + json.dumps(navs[n0:]))
        frame.evaluate("HF.router.go('learn', { page: 'why' })")
        frame.wait_for_timeout(200)
        c.ok('Why Long-Horizon works this way' in frame.locator('#hf-screen').inner_text(), 'srcdoc: help pages render')
        c.eq(con.errors + con.page_errors, [], 'srcdoc: 0 console errors')
    write_json('screens.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
