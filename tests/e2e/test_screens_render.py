"""Every everyday screen renders (Today, Progress, History, Settings, Free play, About) at desktop 1366×768 and
phone 390×844, light and dark, with three weeks of seeded training and as a brand-new user: h1 present, no
horizontal overflow, graphs/badges/zone meters/coach cards present, 0 console errors from P3 code.
Screenshots: out/screens/<route>-<desktop|phone>-<light|dark>.png (+ fresh-*).
Run: python3 tests/e2e/test_screens_render.py
"""
from helpers import Check, browser, run_main
from test_screens_common import (DESKTOP, PHONE, boot, go, new_page, overflow, reload, seed, shot, write_json)

ROUTES = ['today', 'progress', 'history', 'settings', 'free', 'about']


def check_screen(c, page, route, tag):
    h1 = page.evaluate("(document.querySelector('#hf-screen h1') || {}).textContent || ''")
    c.ok(bool(h1.strip()), f'{tag} {route}: h1 present ({h1!r})')
    c.eq(page.evaluate('HF.router.current && HF.router.current.name'), route, f'{tag} {route}: route active')
    ov = overflow(page)
    c.ok(ov['over'] <= 1, f'{tag} {route}: no horizontal overflow ({ov})')
    c.ok(page.evaluate("!document.querySelector('#hf-screen .hf-error')"), f'{tag} {route}: no render error box')


def run():
    c = Check('screens-render')
    shots = []
    with browser() as b:
        # ---------- a brand-new user who chose "Measure first" (Lab reminder, empty states) ----------
        ctx, page, con = new_page(b, PHONE)
        boot(page)
        page.evaluate("""() => HF.store.mutate(r => { r.profile = Object.assign({}, r.profile, { firstRunDone: true, path: 'measure', updatedAt: Date.now() }); })""")
        for route in ['today', 'progress', 'history', 'free']:
            go(page, route, wait=450)
            check_screen(c, page, route, 'fresh')
            shots.append(shot(page, f'fresh-{route}-phone-light'))
        go(page, 'today')
        c.ok(page.evaluate("document.querySelector('#hf-today-panel .hf-card__title').textContent") == 'Session 1', 'fresh Today: Session 1 card')
        c.ok(page.evaluate("!!document.querySelector('.hf-today__lab')"), 'fresh Today (Measure first): Baseline 1 reminder')
        c.ok(page.evaluate("document.querySelector('.hf-today__lab').textContent.includes('Baseline 1')"), 'reminder names Baseline 1')
        c.ok(page.evaluate("!!document.querySelector('#hf-today-start')"), 'fresh Today: Start button')
        go(page, 'progress')
        c.ok(page.evaluate("document.querySelectorAll('#hf-screen .hf-empty').length") >= 2, 'fresh Progress: empty states for graphs and badges')
        c.details['fresh_console'] = con.summary()
        c.eq(con.mine(), [], 'fresh user: no console errors from P3 code')
        ctx.close()

        # ---------- three weeks of training, 2 viewports × 2 themes ----------
        for vp_name, vp in (('desktop', DESKTOP), ('phone', PHONE)):
            for dark in (False, True):
                tag = f'{vp_name}-{"dark" if dark else "light"}'
                ctx, page, con = new_page(b, vp, dark=dark)
                boot(page)
                info = seed(page)
                reload(page)
                c.details.setdefault('seed', info)
                for route in ROUTES:
                    go(page, route, wait=500)
                    check_screen(c, page, route, tag)
                    if route == 'today':
                        c.ok(page.evaluate("!!document.querySelector('#hf-today-panel .hf-sbar')"), f'{tag} today: session bar')
                        c.ok(page.evaluate("!!document.querySelector('.hf-today__week .hf-ring')"), f'{tag} today: weekly ring')
                        c.ok(page.evaluate("!!document.querySelector('.hf-prog__bar')"), f'{tag} today: programme bar')
                    if route == 'progress':
                        n_charts = page.evaluate("document.querySelectorAll('#hf-screen .hf-chart svg').length")
                        c.ok(n_charts >= 3, f'{tag} progress: {n_charts} charts drawn')
                        c.ok(page.evaluate("document.querySelectorAll('#hf-screen .hf-chart__marker, #hf-screen [class*=\"marker\"]').length") >= 1, f'{tag} progress: style/rule change markers')
                        earned = page.evaluate("Object.keys(HF.store.derived.badges).length")
                        shown = page.evaluate("document.querySelectorAll('#badges > .hf-badges .hf-badge:not(.hf-badge--locked)').length")
                        c.eq(shown, earned, f'{tag} progress: every earned badge shown')
                        c.eq(page.evaluate("document.querySelectorAll('#badges .hf-badge').length"), 12, f'{tag} progress: all 12 badges present (earned + not yet)')
                        c.ok(page.evaluate("!!document.querySelector('.hf-trk[open] .hf-zone')"), f'{tag} progress: zone meter in the open version row')
                        c.ok(page.evaluate("document.querySelectorAll('.hf-locked__item').length") >= 1, f'{tag} progress: locked versions with how they open')
                        c.ok(page.evaluate("document.querySelectorAll('#lifetime .hf-stat').length") == 6, f'{tag} progress: lifetime counters')
                    if route == 'history':
                        c.ok(page.evaluate("document.querySelectorAll('.hf-hist__session').length") >= 3, f'{tag} history: sessions listed')
                    if route == 'free':
                        c.ok(page.evaluate("document.querySelectorAll('.hf-coach__card').length") >= 2, f'{tag} free: coach cards')
                    if route == 'about':
                        a = page.evaluate("(() => { const a = document.querySelector('#hf-about-discord'); return a ? [a.href, a.target, a.rel] : null; })()")
                        c.eq(a, ['https://discord.gg/chmr', '_blank', 'noopener'], f'{tag} about: real Discord link')
                        c.ok(page.evaluate("document.querySelector('.hf-about__url').textContent.includes('https://discord.gg/chmr')"), f'{tag} about: URL printed')
                    shots.append(shot(page, f'{route}-{tag}'))
                # a closer look at the top of Progress on the phone (the most crowded screen)
                if vp_name == 'phone':
                    go(page, 'progress', wait=500)
                    shots.append(shot(page, f'progress-top-{tag}', full=False))
                c.details[f'console_{tag}'] = con.summary()
                c.eq(con.mine(), [], f'{tag}: no console or page errors from P3 code')
                ctx.close()
        # ---------- phone with large text and Focus mode: no overflow, motivation layer hidden ----------
        ctx, page, con = new_page(b, PHONE)
        boot(page)
        seed(page)
        reload(page)
        page.evaluate("HF.ui.screenKit.setSettings({ largeText: true, focusMode: true })")
        for route in ROUTES:
            go(page, route, wait=450)
            check_screen(c, page, route, 'phone-large-focus')
            vis = page.evaluate("[...document.querySelectorAll('#hf-screen .hf-mot')].filter(e => e.getClientRects().length > 0).length")
            c.eq(vis, 0, f'focus mode: no motivation-layer element visible on {route}')
        go(page, 'progress', wait=450)
        shots.append(shot(page, 'progress-phone-large-focus'))
        go(page, 'today', wait=450)
        shots.append(shot(page, 'today-phone-large-focus'))
        c.eq(con.mine(), [], 'large text + focus mode: no console errors from P3 code')
        ctx.close()
    c.details['shots'] = shots
    write_json('render.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
