"""The everyday screens inside a sandboxed preview: the single-file build (built here to
out/screens/long-horizon-srcdoc.html, not dist/) in <iframe sandbox="allow-scripts" srcdoc=…>.
Storage is blocked, so the store runs in memory: Today shows "Not saved on this device", every screen renders,
nav and in-page buttons never navigate the frame away, Export fills the copy box, Import works from pasted text,
settings apply, Free play reaches the session route, and there are no console or page errors from P3 code.
Run: python3 tests/e2e/test_screens_srcdoc.py
"""
import html
import subprocess

from helpers import ROOT, Check, browser, run_main
from test_screens_common import OUT, SEED_JS, STANDARD_SEED, ScreenConsole, shot, write_json

ROUTES = ['today', 'progress', 'history', 'settings', 'free', 'about']


def build():
    out = OUT / 'long-horizon-srcdoc.html'
    OUT.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(['node', 'tools/build-single.mjs', '--out', str(out), '--force'], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('build-single failed: ' + r.stderr[-2000:])
    return out


def run():
    c = Check('screens-srcdoc')
    single = build()
    doc = single.read_text()
    host = OUT / 'srcdoc-host-screens.html'
    host.write_text('<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0">'
                    '<iframe id="f" title="Long-Horizon preview" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0" '
                    f'srcdoc="{html.escape(doc, quote=True)}"></iframe></body></html>')
    shots = []
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        page.set_default_timeout(15000)
        con = ScreenConsole(page)
        navs = []
        page.on('framenavigated', lambda f: navs.append(f.url) if f != page.main_frame else None)
        page.goto(host.as_uri())
        page.wait_for_function("document.getElementById('f').contentWindow !== null")
        frame = next(f for f in page.frames if f != page.main_frame)
        frame.wait_for_function('window.HF && HF.booted === true')
        page.wait_for_timeout(400)
        for _ in range(3):
            if frame.evaluate('HF.dom.openModals()'):
                frame.locator('dialog.hf-modal[open]').last.press('Escape')
                page.wait_for_timeout(80)
        c.ok(frame.evaluate('HF.store.persistent') is False, 'memory mode inside the sandbox')
        info = frame.evaluate(SEED_JS, dict(STANDARD_SEED))
        c.ok(info['sessions'] >= 10, f'seeded in memory ({info["sessions"]} sessions)')
        frame.evaluate("HF.router.go('today')")
        page.wait_for_timeout(300)
        c.ok(frame.evaluate("!!document.querySelector('.hf-today__storage')"), 'Today: "Not saved on this device" notice')
        for route in ROUTES:
            # navigate with the real nav buttons where they exist (data-go), else the router
            sel = f".hf-nav [data-go='{route}']"
            if frame.evaluate(f"!!document.querySelector(\"{sel}\") && document.querySelector(\"{sel}\").getClientRects().length > 0"):
                frame.click(sel)
            else:
                frame.evaluate(f"HF.router.go('{route}')")
            page.wait_for_timeout(350)
            c.eq(frame.evaluate('HF.router.current.name'), route, f'srcdoc: {route} active')
            c.ok(frame.evaluate("!!document.querySelector('#hf-screen h1')"), f'srcdoc: {route} rendered')
        shots.append(shot(page, 'srcdoc-about-desktop', full=False))
        # Export in memory: copy box filled, download skipped or attempted without leaving the frame
        frame.evaluate("HF.router.go('progress', { section: 'backup' })")
        page.wait_for_timeout(300)
        frame.click('#hf-export-json')
        page.wait_for_timeout(300)
        val = frame.evaluate("document.querySelector('.hf-backup__box textarea').value")
        c.ok('"long-horizon-backup"' in val, 'srcdoc: Export fills the copy box')
        status = frame.evaluate("document.querySelector('.hf-backup__status').textContent")
        c.ok('copy' in status.lower(), f'srcdoc: export status points to the copy box ({status!r})')
        shots.append(shot(page, 'srcdoc-export-desktop', full=False))
        # Import the same text back (merge, nothing lost)
        frame.evaluate('HF.store.reset()')
        frame.evaluate("HF.router.go('progress', { section: 'backup' })")
        page.wait_for_timeout(300)
        frame.click("#backup summary:has-text('Paste backup text instead')")
        frame.fill('#hf-import-text', val)
        frame.click('#hf-import-paste')
        page.wait_for_timeout(400)
        c.eq(frame.evaluate('HF.store.records.sessions.length'), info['sessions'], 'srcdoc: import restores the sessions in memory')
        # settings apply in memory
        frame.evaluate("HF.router.go('settings', { section: 'display' })")
        page.wait_for_timeout(300)
        frame.click("label.hf-seg__opt:has(input[name='hf-set-theme'][value='dark'])")
        page.wait_for_timeout(150)
        c.eq(frame.evaluate("document.documentElement.getAttribute('data-theme')"), 'dark', 'srcdoc: theme applied')
        # share dialog: clipboard is blocked in the sandbox → copy box with a message
        frame.evaluate("HF.router.go('progress')")
        page.wait_for_timeout(300)
        frame.click('#hf-share-btn')
        page.wait_for_timeout(400)
        c.ok(frame.evaluate("!!document.querySelector('dialog.hf-modal--share[open] textarea')"), 'srcdoc: share dialog with copy box')
        frame.locator('dialog.hf-modal[open]').last.press('Escape')
        # Free play → session (the real session route if registered; only the route change is checked)
        frame.evaluate("""() => { HF.router.register('session', { title: 'Stub session', render(root, p) { window.__sess = JSON.parse(JSON.stringify(p || {}));
          const h = document.createElement('h1'); h.textContent = 'Stub session'; root.appendChild(h); } }); }""")
        frame.evaluate("HF.router.go('free')")
        page.wait_for_timeout(300)
        frame.click('#hf-free-start')
        page.wait_for_timeout(200)
        c.ok(bool(frame.evaluate('window.__sess && window.__sess.free && window.__sess.free.trackId')), 'srcdoc: Free play starts a free block')
        c.ok(all(u.startswith('about:srcdoc') for u in navs), f'the frame never left about:srcdoc ({[u for u in navs if not u.startswith("about:srcdoc")]})')
        c.details['console'] = con.summary()
        c.eq(con.mine(), [], 'srcdoc: no console or page errors from P3 code')
    c.details['shots'] = shots
    write_json('srcdoc.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
