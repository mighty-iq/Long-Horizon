"""Lab pause through the player (Chromium), Phase 4 CB-06 + CB-15: a Quick check (n-back + relation probes, items
trimmed) with the default engine, so each probe block runs in HF.player.runSpec. Escape during the scored n-back stream
→ the player's own pause menu → Resume → the player restarts the block with a fresh probe block (regenerate, seed
'/x1') → the visit finishes. The saved n-back result must record restarts = 1 and the visit the flag 'paused' (before
the fix the player's internal restart was invisible to the Lab). The wake lock (HF.timing.keepAwake) is held from
"Start the tests" to the done screen even though the player releases its own lock after each run, and leaving the
route in the middle of a visit releases it. 0 console errors in the Lab flow.
Run: python3 tests/e2e/test_lab_player_pause.py
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import Driver, OUT_DIR, open_app, reset_store
from test_lab_post import AWAKE_JS


def run():
    c = Check('lab-player-pause')
    with browser() as b:
        ctx, page, con = open_app(b, 1366, 768)
        boot = list(con.errors + con.page_errors)
        reset_store(page)
        page.evaluate("HF.ui.labvisit.testHooks.trim = 1; HF.ui.labvisit.testHooks.engine = 'auto';")
        page.evaluate(AWAKE_JS)
        page.evaluate("HF.router.go('labvisit', { kind: 'Q', config: 'quick' })")
        page.wait_for_timeout(300)
        d = Driver(page, c, [], prefix='ppause', accuracy=1.0)
        s = d.run(max_s=120, stop_at=lambda s: s.get('cur') == 'lab.nback' and s.get('phase') == 'scored' and s.get('timing') == 'running' and s.get('trial') is not None)
        c.ok(s.get('timing') == 'running', 'scored n-back stream running')
        c.eq(page.evaluate("(HF.ui.labvisit.current().engine || {}).nback"), 'player', 'the n-back probe runs in HF.player.runSpec')
        aw = page.evaluate("window.__awake")
        c.ok(any(a['on'] and a['h1'] == 'Check-in' for a in aw), 'CB-15: keepAwake(true) in the "Start the tests" click')
        seed0 = page.evaluate("HF.ui.labvisit.current().spec.blocks[0].seed")
        runs0 = page.evaluate('window.__labRuns || 0')
        page.keyboard.press('Escape')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=5000)
        txt = page.evaluate("document.querySelector('dialog.hf-modal[open]').innerText")
        c.ok('again with new items' in txt, f'the player pause menu says the block starts again ({txt[:80]!r})')
        page.screenshot(path=os.path.join(OUT_DIR, 'ppause-menu.png'))
        page.locator('dialog.hf-modal[open] button', has_text='Resume').click()
        page.wait_for_function('(n) => (window.__labRuns || 0) > n && HF.timing.state === "running"', arg=runs0, timeout=10000)
        c.ok(True, 'Resume → 3-2-1 → the block runs again')
        # play on to the close-out: the visit must still hold the wake lock after the player runs
        s = d.run(max_s=180, stop_at=lambda s: s.get('h1') == 'Close-out')
        c.eq(s.get('h1'), 'Close-out', 'reached the close-out')
        aw = page.evaluate("window.__awake")
        c.ok(aw[-1]['on'] is True and any(not a['on'] for a in aw), f'CB-15: awake again after each player run ({aw[-3:]})')
        s = d.run(max_s=60)
        c.eq(s.get('h1'), 'Quick check saved', 'done screen')
        c.ok(page.evaluate("window.__awake[window.__awake.length - 1].on") is False, 'CB-15: the done screen releases the wake lock')
        rec = page.evaluate("""() => { const v = HF.store.records.labVisits[HF.store.records.labVisits.length - 1];
          return { kind: v.kind, tests: Object.keys(v.tests).sort(), flags: v.flags, restarts: v.tests['lab.nback'] && v.tests['lab.nback'].restarts }; }""")
        c.details['record'] = rec
        c.eq(rec['tests'], ['lab.nback', 'lab.rel'], 'both probes saved')
        c.eq(rec['restarts'], 1, 'CB-06: the n-back result records the restart done inside the player')
        c.ok('paused' in rec['flags'], f'CB-06: the visit is flagged paused ({rec["flags"]})')
        doc = page.evaluate("""() => { const v = HF.store.records.labVisits[HF.store.records.labVisits.length - 1];
          const d = HF.store.loadTrials(v.id); const e = d && d.blocks['lab.nback']; return e ? { hasSpec: !!e.spec, seed: e.spec && e.spec.blocks[0].seed } : null; }""")
        c.ok(doc and doc['hasSpec'] and doc['seed'] != seed0 and '/x1' in (doc['seed'] or ''), f'the saved spec carries the replaced block ({seed0} → {doc})')
        # leaving the route in the middle of a visit releases the wake lock
        page.evaluate("HF.router.go('labvisit', { kind: 'X' })")
        page.wait_for_timeout(300)
        s = d.run(max_s=60, stop_at=lambda s: s.get('cur') is not None)
        c.ok(s.get('cur') is not None, f'a new visit reached its first test ({s.get("cur")})')
        c.ok(page.evaluate("window.__awake[window.__awake.length - 1].on") is True, 'a new visit: awake after "Start the tests"')
        page.evaluate("HF.router.go('lab')")
        page.wait_for_timeout(300)
        c.ok(page.evaluate("window.__awake[window.__awake.length - 1].on") is False, 'CB-15: leaving the visit releases the wake lock')
        c.eq([e for e in con.errors + con.page_errors if e not in boot], [], '0 console errors in the Lab flow')
        ctx.close()
    res = c.result()
    write_json('lab-player-pause.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
