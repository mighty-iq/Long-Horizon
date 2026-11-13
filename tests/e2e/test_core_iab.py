"""(f) In-app browser notice with spoofed user agents: Discord on iOS shows "You're in Discord's built-in browser…"
at the top of the screen; it survives route changes, hides while a block runs, Copy link copies or shows a copy
box with the link, Got it removes it and is remembered on this device; a generic Android WebView gets the
"an app's built-in browser" wording; desktop Chrome sees nothing.
Run: python3 tests/e2e/test_core_iab.py
"""
from helpers import Check, Console, browser, close_modals, file_url, run_main, write_json

UA_DISCORD = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
              'Mobile/15E148 Discord/240.0')
UA_WEBVIEW = ('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 '
              'Chrome/130.0.0.0 Mobile Safari/537.36')
PHONE = {'width': 390, 'height': 844}


def open_app(b, ua=None):
    ctx = b.new_context(user_agent=ua, viewport=PHONE) if ua else b.new_context(viewport=PHONE)
    page = ctx.new_page()
    con = Console(page)
    page.goto(file_url('index.html'))
    page.wait_for_function('window.HF && HF.booted === true', timeout=15000)
    close_modals(page)
    return ctx, page, con


def run():
    c = Check('core-iab')
    with browser() as b:
        ctx, page, con = open_app(b, UA_DISCORD)
        c.eq(page.evaluate('HF.env && HF.env.inApp && HF.env.inApp.id'), 'discord', 'Discord detected from the user agent')
        box = page.locator('#hf-iab')
        c.ok(box.count() == 1 and box.is_visible(), 'notice shown')
        text = box.inner_text() if box.count() else ''
        c.ok('You’re in Discord’s built-in browser.' in text, f'names the app: {text[:80]!r}')
        c.ok('Open Long-Horizon in Safari or Chrome so your progress is saved reliably.' in text, 'says what to do')
        c.ok(page.evaluate("document.getElementById('hf-iab').parentNode === HF.router.root()"), 'sits at the top of the screen')
        page.evaluate('HF.router.go(HF.router.current.name)')
        c.eq(page.locator('#hf-iab').count(), 1, 'still there after a route change')
        page.evaluate('() => { window.__flow = HF.timing.custom({}); return true; }')
        c.eq(page.evaluate("getComputedStyle(document.getElementById('hf-iab')).display"), 'none', 'hidden while a block runs')
        page.evaluate('() => { window.__flow.end(); return true; }')
        c.ok(page.evaluate("getComputedStyle(document.getElementById('hf-iab')).display") != 'none', 'back after the block')
        page.locator('#hf-iab button', has_text='Copy link').click()
        page.wait_for_function("(document.querySelector('#hf-iab .hf-iab__status') || {}).textContent || document.querySelector('#hf-iab textarea')", timeout=5000)
        status = page.evaluate("document.querySelector('#hf-iab .hf-iab__status').textContent")
        area = page.evaluate("(document.querySelector('#hf-iab textarea') || {}).value || null")
        url = page.evaluate("location.href.split('#')[0]")
        c.ok('Link copied' in status or area == url, f'Copy link: copied ({status!r}) or a copy box with the link ({area!r})')
        c.details['copy'] = {'status': status, 'box': area}
        page.locator('#hf-iab button', has_text='Got it').click()
        c.eq(page.locator('#hf-iab').count(), 0, 'Got it removes the notice')
        c.eq(page.evaluate("localStorage.getItem('long-horizon.v1.iab-dismissed')"), '1', 'dismissal remembered')
        page.reload()
        page.wait_for_function('window.HF && HF.booted === true')
        c.eq(page.locator('#hf-iab').count(), 0, 'not shown again on this device')
        c.eq(con.errors + con.page_errors, [], 'no console or page errors (Discord UA)')
        c.details['console'] = con.summary()
        ctx.close()

        ctx, page, con = open_app(b, UA_WEBVIEW)
        c.eq(page.evaluate('HF.env.inApp.id'), 'webview', 'generic Android WebView detected')
        c.ok('You’re in an app’s built-in browser.' in page.locator('#hf-iab').inner_text(), 'generic wording for an unknown app')
        page.evaluate('() => { HF.dom.copyText = () => Promise.resolve(false); return true; }')  # clipboard refused
        page.locator('#hf-iab button', has_text='Copy link').click()
        page.wait_for_function("!!document.querySelector('#hf-iab textarea')", timeout=5000)
        c.eq(page.evaluate("document.querySelector('#hf-iab textarea').value"), page.evaluate("location.href.split('#')[0]"),
             'clipboard refused: a copy box with the link appears')
        c.eq(con.errors + con.page_errors, [], 'no console or page errors (WebView UA)')
        ctx.close()

        ctx, page, con = open_app(b)
        c.eq(page.evaluate('HF.env.inApp'), None, 'a normal browser is not flagged')
        c.eq(page.locator('#hf-iab').count(), 0, 'no notice in a normal browser')
        ctx.close()
    write_json('iab.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
