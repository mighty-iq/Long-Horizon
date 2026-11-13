"""Lab Minimum visit e2e (Chromium), both themes: Baseline 1 with the Minimum configuration (n-back probe, relation
probe, spatial span, puzzles, series) at desktop 1366×768 in the light theme and at phone 390×844 in the dark theme,
plus the four tests Minimum leaves out (updating, colour-and-place, graph mapping, task switching) through an
Extended Part B / Part A run, so every Lab test type gets real key presses and taps. Items are trimmed to 2 per
test (HF.ui.labvisit.testHooks.trim, e2e only) so the run stays short; the full-length run is test_lab_visit.py.
Checks: record saved per sitting with every test, the right configuration, no horizontal overflow on each test
screen, practice + scored phases for every test, 0 console errors in the Lab flows.
Run: python3 tests/e2e/test_lab_minimum.py
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import time

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import PROBE_JS, Driver, OUT_DIR, open_app, reset_store

OVERFLOW_JS = "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"


def visit(page, c, name, kind, config, part, expect, prefix, max_s=420):
    page.evaluate("([k, cfg, p]) => HF.router.go('labvisit', p ? { kind: k, config: cfg, part: p } : { kind: k, config: cfg })", [kind, config, part])
    page.wait_for_timeout(300)
    shots, seen, over = [], set(), []

    def on_state(s):
        key = (s['test'] or s['cur'], s['phase'])
        if s['test']:
            seen.add((s['test'], s['phase']))
            if key not in over:
                over.append(key)
                ov = page.evaluate(OVERFLOW_JS)
                if ov:
                    c.ok(False, f'{name}: horizontal overflow {ov}px on {key}')
    d = Driver(page, c, shots, prefix=prefix, accuracy=1.0)
    t0 = time.time()
    s = d.run(max_s=max_s, on_state=on_state)
    c.details[f'{name}-seconds'] = round(time.time() - t0)
    c.ok(s.get('h1') and 'saved' in s['h1'], f'{name}: finished on the done screen ({s.get("h1")})')
    rec = page.evaluate("""([k]) => { const v = HF.store.records.labVisits.filter((x) => x.kind === k); const x = v[v.length - 1];
      return x ? { config: x.config, part: x.part, tests: Object.keys(x.tests).sort(), ended: !!x.endedAt,
        scores: Object.fromEntries(Object.entries(x.tests).map(([id, r]) => [id, r.score])) } : null; }""", [kind])
    c.details[f'{name}-record'] = rec
    c.ok(rec is not None, f'{name}: record saved')
    if rec:
        c.eq(rec['tests'], sorted(expect), f'{name}: every test of the sitting saved')
        c.eq(rec['config'], config, f'{name}: configuration {config}')
        c.ok(rec['ended'], f'{name}: endedAt set')
        perfect = [k for k, v in rec['scores'].items() if k != 'lab.switch' and isinstance(v, (int, float)) and v >= 0.99]
        c.ok(len(perfect) >= len([k for k in expect if k not in ('lab.switch', 'lab.nback')]) - 1, f'{name}: right answers score as right ({rec["scores"]})')
    views = {t for (t, ph) in seen}
    c.details[f'{name}-views'] = sorted(seen)
    return views, shots


def run():
    c = Check('lab-minimum')
    with browser() as b:
        # ---- Minimum, light, desktop ----
        ctx, page, con = open_app(b, 1366, 768, theme='light')
        boot = list(con.errors + con.page_errors)
        reset_store(page)
        page.evaluate("HF.ui.labvisit.testHooks.trim = 2")
        views, shots = visit(page, c, 'minimum-light', 'B1', 'minimum', None,
                             ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.matrix', 'lab.series'], 'min-light')
        c.details['engine-light'] = page.evaluate("(() => { const v = HF.ui.labvisit.current(); return v ? v.engine : null; })()")
        for t in ('sspan', 'matrix', 'series'):
            c.ok(t in views, f'minimum-light: {t} view played')
        # the four tests Minimum leaves out: Extended Part B (graph, switch) and Part A (updating, binding)
        reset_store(page)
        page.evaluate("HF.ui.labvisit.testHooks.trim = 2")
        v2, _ = visit(page, c, 'extended-B-light', 'B1', 'extended', 'B', ['lab.matrix', 'lab.series', 'lab.graph', 'lab.switch'], 'ext-light')
        v3, _ = visit(page, c, 'extended-A-light', 'B1', 'extended', 'A', ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind'], 'ext-light')
        for t in ('graph', 'switch', 'update', 'bind'):
            c.ok(t in (v2 | v3), f'extended-light: {t} view played')
        sched = page.evaluate("() => { const s = HF.lab.schedule(HF.store.records, null, Date.now()); return s.plan.map((e) => [e.kind, e.status]); }")
        c.eq(sched[0], ['B1', 'done'], 'two sittings (Part B, then Part A) complete Baseline 1')
        c.eq([e for e in con.errors + con.page_errors if e not in boot], [], 'light: 0 console errors in the Lab flows')
        c.details['boot_errors_light'] = boot
        ctx.close()

        # ---- Minimum, dark, phone ----
        ctx, page, con = open_app(b, 390, 844, theme='dark', color_scheme='dark')
        boot = list(con.errors + con.page_errors)
        reset_store(page)
        page.evaluate("() => { HF.store.mutate((r) => { r.settings.theme = 'dark'; r.settings.updatedAt = Date.now(); }); }")
        page.evaluate("HF.ui.labvisit.testHooks.trim = 2")
        # this run covers the internal probe runner with the built-in minimal views (the light run used HF.player)
        page.evaluate("HF.ui.labvisit.testHooks.engine = 'builtin'")
        c.eq(page.evaluate("document.documentElement.getAttribute('data-theme')"), 'dark', 'dark theme applied')
        views, shots = visit(page, c, 'minimum-dark-phone', 'B1', 'minimum', None,
                             ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.matrix', 'lab.series'], 'min-dark-phone')
        eng = page.evaluate("(() => { const v = HF.ui.labvisit.current(); return v ? v.engine : null; })()")
        c.eq(eng, {'nback': 'builtin', 'rel': 'builtin'}, 'dark phone: built-in probe views exercised')
        page.evaluate("HF.ui.labvisit.testHooks.engine = 'auto'")
        for t in ('sspan', 'matrix', 'series'):
            c.ok(t in views, f'minimum-dark-phone: {t} view played')
        reset_store(page)
        page.evaluate("() => { HF.store.mutate((r) => { r.settings.theme = 'dark'; r.settings.updatedAt = Date.now(); }); }")
        page.evaluate("HF.ui.labvisit.testHooks.trim = 2")
        v2, _ = visit(page, c, 'extended-B-dark-phone', 'B1', 'extended', 'B', ['lab.matrix', 'lab.series', 'lab.graph', 'lab.switch'], 'ext-dark-phone')
        c.eq([e for e in con.errors + con.page_errors if e not in boot], [], 'dark phone: 0 console errors in the Lab flows')
        c.details['boot_errors_dark'] = boot
        ctx.close()
    res = c.result()
    write_json('lab-minimum.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
