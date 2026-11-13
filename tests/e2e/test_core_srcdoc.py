"""(c) The single-file build (dist/long-horizon.html) inside a host page with <iframe sandbox="allow-scripts" srcdoc=…>:
the app boots, storage is blocked so the store runs in memory mode (persistent = false, a notice is shown), records,
export and import work in memory, in-app links (data-go, stray #/ links, in-page anchors) never navigate the frame
away, audio unlocks with a click inside the frame, and there are no console or page errors.
Run: python3 tests/e2e/test_core_srcdoc.py
"""
import html
import subprocess

from helpers import OUT, ROOT, Check, Console, browser, run_main, write_json


def build():
    subprocess.run(['node', 'tools/sync-index.mjs'], cwd=ROOT, capture_output=True, text=True, check=True)
    r = subprocess.run(['node', 'tools/build-single.mjs'], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('build-single failed: ' + r.stderr[-2000:])
    return r.stdout.strip().splitlines()[-1]


def run():
    c = Check('core-srcdoc')
    c.details['build'] = build()
    doc = (ROOT / 'dist' / 'long-horizon.html').read_text()
    OUT.mkdir(parents=True, exist_ok=True)
    host = OUT / 'srcdoc-host.html'
    host.write_text('<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0">'
                    '<iframe id="f" title="Long-Horizon preview" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0" '
                    f'srcdoc="{html.escape(doc, quote=True)}"></iframe></body></html>')
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        page.set_default_timeout(10000)
        con = Console(page)
        navs = []
        page.on('framenavigated', lambda f: navs.append(f.url) if f != page.main_frame else None)
        page.goto(host.as_uri())
        page.wait_for_function("document.getElementById('f').contentWindow !== null")
        frame = next(f for f in page.frames if f != page.main_frame)
        frame.wait_for_function('window.HF && HF.booted === true')
        page.wait_for_timeout(400)
        c.eq(con.errors + con.page_errors, [], 'boots with no console or page errors')
        c.details['boot_console'] = con.summary()
        c.eq(frame.evaluate('self.origin'), 'null', 'opaque sandboxed origin')
        c.ok(frame.evaluate('HF.store.persistent') is False, 'memory mode (persistent = false)')
        c.eq(frame.evaluate('HF.store.status.reason'), 'blocked', 'reason: storage blocked')
        c.eq(frame.evaluate('HF.pwa.state + ":" + HF.pwa.reason'), 'off:single-file', 'no service worker from the single file')
        c.ok(frame.evaluate("!!document.querySelector('#hf-screen h1')"), 'a screen rendered')
        c.details['launch_modals'] = frame.evaluate('HF.dom.openModals()')
        if c.details['launch_modals']:
            frame.locator('dialog.hf-modal[open]').last.press('Escape')
            c.eq(frame.evaluate('HF.dom.openModals()'), 0, 'launch dialog closes with Escape')

        frame.evaluate("() => { HF.store.mutate(r => { r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }); }); HF.router.go('today'); return true; }")
        c.ok(frame.evaluate("/cannot save|Not saved on this device/.test(document.getElementById('hf-screen').textContent)"), 'Today shows the not-saved notice')

        # ---- records, export, import in memory ----
        n0 = frame.evaluate('HF.store.records.events.length')
        frame.evaluate("HF.store.mutate(r => { r.events.push({ id: 'e-mem', t: Date.now(), type: 'note', text: 'hi' }); })")
        c.eq(frame.evaluate('HF.store.records.events.length'), n0 + 1, 'mutate works in memory')
        c.ok(frame.evaluate('HF.store.flush()') is True, 'flush is a no-op success in memory mode')
        text = frame.evaluate('HF.store.exportText()')
        c.ok('"long-horizon-backup"' in text and 'e-mem' in text, 'exportText returns the backup text')
        frame.evaluate('HF.store.reset()')
        c.eq(frame.evaluate('HF.store.records.events.length'), 0, 'reset in memory')
        res = frame.evaluate('t => HF.store.importText(t)', text)
        c.ok(res['ok'] and res['added'] >= 1, f'importText merges back: {res}')
        c.ok(frame.evaluate("HF.store.records.events.some(e => e.id === 'e-mem')"), 'record restored')

        # ---- links never navigate the frame away ----
        frame.evaluate("""() => {
          const el = HF.dom.el, s = el('div', { id: 'probe-links', style: 'position:fixed;top:0;right:0;z-index:5;background:#fff' });
          document.body.appendChild(s);
          s.appendChild(el('a', { id: 'l-hash', href: '#/today' }, 'hash route'));
          s.appendChild(el('a', { id: 'l-anchor', href: '#anchor-target' }, 'anchor'));
          s.appendChild(el('button', { id: 'l-go', type: 'button', 'data-go': 'today' }, 'go'));
          s.appendChild(el('p', { id: 'anchor-target' }, 'target'));
          s.appendChild(el('button', { id: 'dl', type: 'button', onclick: () => { window.dlRes = HF.store.download(); } }, 'export'));
          s.appendChild(el('button', { id: 'cp', type: 'button', onclick: () => { HF.dom.copyText('x').then(v => { window.cpRes = v; }); } }, 'copy'));
          s.appendChild(el('button', { id: 'snd', type: 'button', onclick: () => { HF.audio.unlock().then(v => { window.sndRes = v; }); } }, 'sound'));
        }""")
        for sel in ('#l-hash', '#l-anchor', '#l-go'):
            frame.click(sel)
            page.wait_for_timeout(150)
            c.ok(frame.evaluate('!!(window.HF && HF.booted)'), f'{sel}: app still present')
        c.ok(all(u.startswith('about:srcdoc') for u in navs), f'frame never left about:srcdoc: {navs}')
        nav_buttons = frame.evaluate("[...document.querySelectorAll('[data-go]')].map(b => b.getAttribute('data-go'))")
        c.details['shell_routes'] = nav_buttons
        for route in sorted(set(nav_buttons))[:8]:
            frame.evaluate('r => HF.router.go(r)', route)
            c.ok(frame.evaluate('!!(window.HF && HF.booted)'), f'route {route}: app still present')

        # ---- download, clipboard and audio in the sandbox ----
        frame.click('#dl')
        page.wait_for_timeout(300)
        c.details['download_attempted'] = frame.evaluate('window.dlRes')
        frame.click('#cp')
        page.wait_for_timeout(300)
        c.details['copy_result'] = frame.evaluate('window.cpRes')
        frame.click('#snd')
        frame.wait_for_function('window.sndRes !== undefined')
        snd = frame.evaluate('window.sndRes')
        c.ok(snd['ok'] and snd['state'] == 'running', f'audio unlocks with a click inside the sandbox: {snd}')
        c.eq(snd['clips'], 8, 'letter clips decoded inside the sandbox')
        c.ok(all(u.startswith('about:srcdoc') for u in navs), 'still on about:srcdoc after export/copy/audio')
        page.wait_for_timeout(300)
        c.details['console'] = con.summary()
        c.eq(con.errors + con.page_errors, [], 'no console or page errors')
    write_json('srcdoc.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
