"""(g) Working-name migration in a real browser. Version 1.0.0 ran under the working name Holdfast and kept its data under
localStorage keys holdfast.v1.*; the first launch of Long-Horizon copies them once to long-horizon.v1.* (js/core/store.js,
copyLegacy) and never writes or deletes the old keys. Served over http (a stable origin).
Setup: the app plays three synthetic sessions through the real engine (test_screens_common.SEED_JS) and saves them;
on a static page of the same origin (no app code running) every long-horizon.v1.* key is moved to holdfast.v1.*, so
the browser holds exactly what 1.0.0 would have left (main, trial logs, the in-app-browser flag).
Checks: the launch copies every legacy key as it is; sessions, blocks, events, counted sessions and trial logs come
through; Today renders (no welcome: the first run was done) with 0 errors; new saves go to the new keys only; a reload
copies nothing again; the legacy keys are byte-identical at the end.
Run: python3 tests/e2e/test_core_migrate.py
"""
from helpers import Check, Console, browser, close_modals, http_server, run_main, write_json
from test_screens_common import seed

NEW, OLD = 'long-horizon.v1.', 'holdfast.v1.'
STATE = """() => ({ s: HF.store.records.sessions.length, b: HF.store.records.blocks.length,
  e: HF.store.records.events.map(x => x.id).sort(), counted: HF.store.derived.sessionsCounted,
  trials: HF.store.trialSessionIds().sort(), anon: HF.store.records.profile.anonId })"""
KEYS = "p => Object.keys(localStorage).filter(k => k.indexOf(p) === 0).sort().map(k => [k, localStorage.getItem(k)])"
TO_LEGACY = """([from, to]) => {
  const keys = Object.keys(localStorage).filter(k => k.indexOf(from) === 0);
  keys.forEach(k => { localStorage.setItem(to + k.slice(from.length), localStorage.getItem(k)); localStorage.removeItem(k); });
  return keys.length;
}"""


def booted(page):
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(300)
    close_modals(page)


def run():
    c = Check('core-migrate')
    with http_server() as base, browser() as b:
        ctx = b.new_context(viewport={'width': 1000, 'height': 760})
        page = ctx.new_page()
        con = Console(page)
        page.goto(base + '/index.html')
        booted(page)
        page.evaluate('() => { localStorage.clear(); return true; }')
        seeded = seed(page, {'days': 6, 'trainDays': [0, 2, 4], 'keepLogsFrom': 2, 'modeAt': {}, 'note': True, 'lastExportDaysAgo': None})
        page.evaluate("() => { localStorage.setItem('long-horizon.v1.iab-dismissed', '1'); HF.store.flush(true); return true; }")
        before = page.evaluate(STATE)
        c.ok(before['s'] == 3 and before['b'] > 10 and len(before['trials']) >= 1, f'1.0.0 data seeded through the engine ({seeded})')

        # turn this browser's data into what 1.0.0 left behind, on a page where no app code runs
        page.goto(base + '/js/manifest.json')   # plain JSON: shown as text, no app code
        moved = page.evaluate(TO_LEGACY, [NEW, OLD])
        legacy = page.evaluate(KEYS, OLD)
        c.ok(moved >= 3 and page.evaluate(KEYS, NEW) == [], f'only holdfast.v1.* keys before the launch ({moved} keys)')

        page.goto(base + '/index.html')
        booted(page)
        st = page.evaluate('HF.store.status.legacy')
        c.ok(bool(st) and st['from'] == OLD and st['main'] is True and st['copied'] == len(legacy) and st['skipped'] == 0,
             f'first launch copied every legacy key once ({st})')
        after = page.evaluate(STATE)
        c.eq({k: v for k, v in after.items() if k != 'anon'}, {k: v for k, v in before.items() if k != 'anon'},
             'sessions, blocks, events, counted sessions and trial logs came through')
        c.ok(after['anon'] == before['anon'] or (before['anon'] is None and bool(after['anon'])),
             'profile kept (the schema guard gives a copy without an anonId one, as on any load)')
        new = dict(page.evaluate(KEYS, NEW))
        c.ok(all(new.get(NEW + k[len(OLD):]) == v for k, v in legacy if not k.endswith('.main')), 'trial logs and flags copied as they are')
        c.eq(page.evaluate('HF.router.current && HF.router.current.name'), 'today', 'Today, not the welcome (the first run was done in 1.0.0)')
        c.ok(page.evaluate("!!document.querySelector('#hf-screen h1, #hf-screen h2')"), 'Today renders on the copied data')
        c.ok(page.evaluate("HF.store.persistent && !HF.store.status.reason"), 'saving normally (no memory mode)')

        page.evaluate("() => { HF.store.mutate(r => { r.events.push({ id: 'after-rename', t: Date.now(), type: 'note', text: 'x' }); }); HF.store.flush(true); return true; }")
        c.ok('"after-rename"' in page.evaluate(f"localStorage.getItem('{NEW}main')"), 'new saves go to long-horizon.v1.main')
        c.eq(page.evaluate(KEYS, OLD), legacy, 'legacy keys untouched after the launch and a save')

        page.reload()
        booted(page)
        c.eq(page.evaluate('HF.store.status.legacy'), None, 'a reload copies nothing again')
        c.ok('after-rename' in page.evaluate(STATE)['e'], 'the reload reads the new keys')
        c.eq(page.evaluate(KEYS, OLD), legacy, 'legacy keys still byte-identical')
        c.eq(con.errors + con.page_errors, [], 'no console or page errors')
        c.details = {'seeded': seeded, 'legacy_keys': [k for k, _ in legacy], 'status': st, 'console': con.summary()}
        ctx.close()
    write_json('migrate.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
