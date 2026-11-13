"""Lab pause / restart / stop e2e (Chromium), with the internal probe runner and built-in views (testHooks.engine =
'builtin', items trimmed): Escape during the scored n-back stream stops it, the Lab pause dialog explains that the
block restarts with new shapes, Resume (the tap) → 3-2-1 → a fresh probe block (saved spec replaced,
result.restarts = 1); later, Escape during the spatial span (a custom view) and "Stop the visit" (confirmed)
keeps the finished tests, records closeout.stoppedDuring and the flags 'stopped-early' + 'paused', goes through the
close-out and ends on "Visit stopped"; the next visit plan offers the rest. 0 console errors in the Lab flow.
Run: python3 tests/e2e/test_lab_stop.py
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import Driver, OUT_DIR, open_app, reset_store


def run():
    c = Check('lab-stop')
    with browser() as b:
        ctx, page, con = open_app(b, 1366, 768)
        boot = list(con.errors + con.page_errors)
        reset_store(page)
        page.evaluate("HF.ui.labvisit.testHooks.trim = 1; HF.ui.labvisit.testHooks.engine = 'builtin';")
        page.evaluate("HF.router.go('labvisit', { kind: 'B1', config: 'standard', part: 'A' })")
        page.wait_for_timeout(300)
        d = Driver(page, c, [], prefix='stop', accuracy=1.0)
        s = d.run(max_s=120, stop_at=lambda s: s.get('cur') == 'lab.nback' and s.get('phase') == 'scored' and s.get('timing') == 'running' and s.get('trial') is not None)
        c.ok(s.get('timing') == 'running', 'scored n-back stream running')
        seed0 = page.evaluate("HF.ui.labvisit.current().spec.blocks[0].seed")
        page.keyboard.press('Escape')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=5000)
        txt = page.evaluate("document.querySelector('dialog.hf-modal[open]').innerText")
        c.ok('Paused' in txt and 'start again' in txt, f'stream pause dialog explains the restart ({txt[:80]!r})')
        page.screenshot(path=os.path.join(OUT_DIR, 'stop-stream-paused.png'))
        runs0 = page.evaluate('window.__labRuns || 0')
        page.locator('dialog.hf-modal[open] button', has_text='Resume').click()
        page.wait_for_function('(n) => (window.__labRuns || 0) > n && HF.timing.state === "running"', arg=runs0, timeout=8000)
        c.ok(True, 'Resume (the tap) → 3-2-1 → the block runs again')
        seed1 = page.evaluate("HF.ui.labvisit.current().spec.blocks[0].seed")
        c.ok(seed1 != seed0 and '/x1' in seed1, f'a fresh probe block replaces the paused one ({seed0} → {seed1})')
        # play on until the spatial span (custom view) shows its first pattern, then stop the visit
        s = d.run(max_s=180, stop_at=lambda s: s.get('test') == 'sspan' and s.get('phase') == 'scored' and (s.get('sspan') or {}).get('phase') == 'judge')
        c.eq(s.get('test'), 'sspan', 'reached the scored spatial span')
        page.keyboard.press('Escape')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=5000)
        page.locator('dialog.hf-modal[open] button', has_text='Stop the visit').click()
        page.wait_for_timeout(200)
        c.eq(page.evaluate("HF.dom.openModals()"), 2, 'Stop asks to confirm (second dialog)')
        page.screenshot(path=os.path.join(OUT_DIR, 'stop-confirm.png'))
        page.locator('dialog.hf-modal[open] button', has_text='Stop').last.click()
        page.wait_for_timeout(400)
        c.eq(page.evaluate("HF.dom.openModals()"), 0, 'dialogs closed after Stop')
        s = d.run(max_s=60)
        c.eq(s.get('h1'), 'Visit stopped', 'close-out, then "Visit stopped"')
        page.screenshot(path=os.path.join(OUT_DIR, 'stop-done.png'))
        rec = page.evaluate("""() => { const v = HF.store.records.labVisits[HF.store.records.labVisits.length - 1];
          return { tests: Object.keys(v.tests).sort(), flags: v.flags, closeout: v.closeout, ended: !!v.endedAt,
                   restarts: v.tests['lab.nback'] && v.tests['lab.nback'].restarts }; }""")
        c.details['record'] = rec
        c.eq(rec['tests'], ['lab.nback', 'lab.rel'], 'finished tests kept')
        c.ok('stopped-early' in rec['flags'] and 'paused' in rec['flags'], f'flags stopped-early + paused ({rec["flags"]})')
        c.eq(rec['closeout'].get('stoppedDuring'), 'lab.sspan', 'closeout.stoppedDuring names the stopped test')
        c.eq(rec['restarts'], 1, 'n-back result records one restart')
        doc = page.evaluate("""() => { const v = HF.store.records.labVisits[HF.store.records.labVisits.length - 1];
          const d = HF.store.loadTrials(v.id); const e = d && d.blocks['lab.nback']; return e ? { hasSpec: !!e.spec, seed: e.spec && e.spec.blocks[0].seed } : null; }""")
        c.ok(doc and doc['hasSpec'] and '/x1' in (doc['seed'] or ''), f'saved trial log carries the replaced block ({doc})')
        nxt = page.evaluate("() => { const s = HF.lab.schedule(HF.store.records, null, Date.now()); return s.next && { kind: s.next.kind, tests: s.next.tests }; }")
        c.ok(nxt and nxt['kind'] == 'B1' and 'lab.sspan' in nxt['tests'] and 'lab.nback' not in nxt['tests'], f'the rest of Baseline 1 is offered next ({nxt})')
        c.eq([e for e in con.errors + con.page_errors if e not in boot], [], '0 console errors in the Lab flow')
        ctx.close()
    res = c.result()
    write_json('lab-stop.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
