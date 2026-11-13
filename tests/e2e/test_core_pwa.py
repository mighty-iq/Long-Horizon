"""(e) The GitHub Pages copy as an installable offline app, served by a local http server (127.0.0.1 counts as a
secure origin). The site is staged into a temporary folder under out/core so the update check can change sw.js
without touching the repo.
Checks: sw.js registers from index.html and takes control; one versioned cache holds every precached file;
offline, a reload and a fresh navigation to './' still boot with 0 errors; a new sw.js version installs in the
background, the "Reload" toast activates it and the old cache is deleted, and so is this scope's cache from 1.0.0
(working name: 'holdfast:<scope>:…'), while other deployments' caches stay; the single-file build never registers.
Run: python3 tests/e2e/test_core_pwa.py
"""
import re
import shutil
import subprocess
import tempfile
import pathlib

from helpers import OUT, ROOT, Check, Console, browser, close_modals, http_server, run_main, write_json


def stage():
    subprocess.run(['node', 'tools/sync-index.mjs'], cwd=ROOT, check=True, capture_output=True)
    subprocess.run(['node', 'tools/build-single.mjs'], cwd=ROOT, check=True, capture_output=True)
    OUT.mkdir(parents=True, exist_ok=True)
    site = pathlib.Path(tempfile.mkdtemp(prefix='pwa-site-', dir=OUT))
    for name in ('index.html', 'sw.js', 'manifest.webmanifest'):
        shutil.copy2(ROOT / name, site / name)
    for d in ('css', 'js', 'assets', 'dist'):
        shutil.copytree(ROOT / d, site / d)
    return site


def booted(page):
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)


def run():
    c = Check('core-pwa')
    site = stage()
    sw_text = (site / 'sw.js').read_text()
    version = re.search(r"var VERSION = '([^']+)';", sw_text).group(1)
    precache = re.findall(r"^\s+'([^']+)',?$", sw_text.split('// hf:sw:end')[0], re.M)
    c.details['version'], c.details['precache_count'] = version, len(precache)
    try:
        with http_server(site) as base, browser() as b:
            ctx = b.new_context(viewport={'width': 1000, 'height': 760})
            page = ctx.new_page()
            con = Console(page)
            page.goto(base + '/index.html')
            booted(page)
            page.wait_for_function("HF.pwa && HF.pwa.state === 'registered'", timeout=20000)
            page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=60000)
            c.ok(True, 'sw.js registered and controls the page')
            prefix = 'long-horizon:' + base + '/:'
            keys = page.evaluate('caches.keys()')
            c.eq(keys, [prefix + version], 'one versioned cache named after the deployment scope')
            n = page.evaluate('k => caches.open(k).then(c => c.keys()).then(r => r.length)', keys[0]) if keys else 0
            c.ok(n >= len(precache), f'every file precached ({n} of {len(precache)})')
            c.eq(con.errors + con.page_errors, [], 'online: no console or page errors')

            ctx.set_offline(True)
            page.reload()
            booted(page)
            c.ok(page.evaluate("!!document.querySelector('#hf-screen h1, #hf-screen h2')"), 'offline reload boots and renders a screen')
            page.goto(base + '/')
            booted(page)
            c.ok(page.evaluate("!!document.querySelector('#hf-screen h1, #hf-screen h2')"), "offline navigation to './' boots")
            c.eq(con.errors + con.page_errors, [], 'offline: no console or page errors')
            ctx.set_offline(False)

            other = 'long-horizon:' + base + '/other-copy/:abc123'   # another deployment on the same origin (CB-09)
            legacy = 'holdfast:' + base + '/:a900a5dea25d'            # this deployment's cache from 1.0.0 (working name)
            legacy_other = 'holdfast:' + base + '/other-copy/:old1'   # another deployment's 1.0.0 cache
            for k in (other, legacy, legacy_other):
                page.evaluate("k => caches.open(k).then(c => c.put('/other-copy/x', new Response('x'))).then(() => true)", k)
            (site / 'sw.js').write_text(sw_text.replace(f"var VERSION = '{version}';", f"var VERSION = '{version}-next';"))
            page.evaluate('() => HF.pwa.registration.update().then(() => true)')
            page.wait_for_function("HF.pwa.update === 'ready' && !!document.querySelector('#hf-toasts .hf-toast__action')", timeout=60000)
            c.ok(True, 'a new version installs in the background and a Reload toast appears')
            close_modals(page)
            with page.expect_navigation(timeout=30000):
                page.click('#hf-toasts .hf-toast__action')
            booted(page)
            page.wait_for_function("caches.keys().then(k => k.length === 3)", timeout=20000)
            c.eq(sorted(page.evaluate('caches.keys()')), sorted([prefix + version + '-next', other, legacy_other]),
                 "the new version took over; its old cache and this scope's 1.0.0 'holdfast:' cache are gone; other deployments' caches are kept")
            c.eq(con.errors + con.page_errors, [], 'update: no console or page errors')
            c.details['console'] = con.summary()
            ctx.close()

            ctx2 = b.new_context()
            p2 = ctx2.new_page()
            con2 = Console(p2)
            p2.goto(base + '/dist/long-horizon.html')
            booted(p2)
            p2.wait_for_timeout(500)
            c.eq(p2.evaluate('HF.pwa.reason'), 'single-file', 'the single-file build does not register')
            c.eq(p2.evaluate('navigator.serviceWorker.getRegistrations().then(r => r.length)'), 0, 'no registration from the single file')
            c.eq(con2.errors + con2.page_errors, [], 'single file over http: no console or page errors')
            ctx2.close()
    finally:
        shutil.rmtree(site, ignore_errors=True)
    write_json('pwa.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
