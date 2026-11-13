"""Lab home e2e (Chromium): renders at desktop 1366×768 and phone 390×844, light and dark; plain claims, the visit
plan, configuration minutes, results as near/mid/far dot plots with verdicts (uncalibrated → calibration import by
paste → noise bands and above/inside verdicts), data-quality notes, Study entry, export panel (JSON + CSV), no
horizontal overflow, no gamification, 0 console errors. Phase 4: SC-08 verdicts say "measurement noise alone" and that
the retest gain is not subtracted; the practice-corrected line needs practiceN ≥ 30 (kept by the import);
CB-07 "Remove calibration" writes the tombstone and the results go back to "not yet calibrated"; with storage blocked
the memory-mode notice prints HF.store.status.message.
Run: python3 tests/e2e/test_lab_home.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, Console, browser, close_modals, file_url, run_main, write_json
from test_lab_visit import OUT_DIR, SEED_JS, open_app, reset_store

CAL = {
    'updatedAt': 1762430000000, 'version': 'community-e2e', 'source': 'e2e fixture: 64 participants',
    'tests': {
        'lab.nback': {'r': 0.7, 'sd': 0.5, 'mean': 1.6, 'n': 64},
        'lab.rel': {'r': 0.6, 'sd': 0.15, 'mean': 0.5, 'n': 64, 'practice': 0.01, 'practiceN': 12},
        'lab.sspan': {'r': 0.8, 'sd': 0.1, 'mean': 0.62, 'n': 64},
        'lab.matrix': {'r': 0.78, 'sd': 0.15, 'mean': 0.55, 'n': 64, 'practice': 0.03, 'practiceN': 40},
        'lab.series': {'r': 0.7, 'sd': 0.15, 'mean': 0.6, 'n': 30}
    }
}
BLOCK_STORAGE_JS = """Object.defineProperty(window, 'localStorage', { configurable: true,
  get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });"""

SCORES = [
    {'kind': 'B1', 'daysAgo': 60, 'sleep': 5, 'scores': {'lab.nback': 1.2, 'lab.rel': 0.40, 'lab.sspan': 0.55, 'lab.update': 0.6, 'lab.matrix': 0.44, 'lab.series': 0.5, 'lab.graph': 0.5, 'lab.switch': 160}},
    {'kind': 'B2', 'daysAgo': 55, 'scores': {'lab.nback': 1.5, 'lab.rel': 0.46, 'lab.sspan': 0.6, 'lab.update': 0.63, 'lab.matrix': 0.5, 'lab.series': 0.57, 'lab.graph': 0.56, 'lab.switch': 140}},
    {'kind': 'Q', 'daysAgo': 30, 'config': 'quick', 'scores': {'lab.nback': 2.1, 'lab.rel': 0.55}},
    {'kind': 'POST', 'daysAgo': 2, 'flags': ['help-used'], 'scores': {'lab.nback': 2.6, 'lab.rel': 0.5, 'lab.sspan': 0.66, 'lab.update': 0.7, 'lab.matrix': 0.52, 'lab.series': 0.6, 'lab.graph': 0.62, 'lab.switch': 120}}
]

OVERFLOW_JS = "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
GAMI_JS = "() => document.querySelectorAll('#hf-screen .hf-ring, #hf-screen .hf-badge, #hf-screen .hf-zone, #hf-screen .hf-mot, #hf-screen .hf-celebrate').length"


def run():
    c = Check('lab-home')
    with browser() as b:
        for (w, h, name, scheme) in [(1366, 768, 'desktop-light', 'light'), (390, 844, 'phone-light', 'light'), (1366, 768, 'desktop-dark', 'dark'), (390, 844, 'phone-dark', 'dark')]:
            ctx, page, con = open_app(b, w, h, color_scheme=scheme)
            reset_store(page)
            page.evaluate("HF.router.go('lab')")
            page.wait_for_timeout(250)
            # fresh state
            c.eq(page.evaluate("document.querySelector('#hf-screen h1').textContent"), 'Lab', f'{name}: h1')
            c.eq(page.evaluate("document.querySelector('[data-next-kind]').getAttribute('data-next-kind')"), 'B1', f'{name}: next visit is Baseline 1')
            txt = page.evaluate("document.getElementById('hf-screen').innerText")
            c.ok('About 52 minutes' in txt, f'{name}: minutes shown up front')
            c.ok('does not claim to make anyone smarter' in txt and 'cannot show what caused' in txt, f'{name}: honest claims shown')
            c.ok('IQ' in txt and 'raise IQ' not in txt.replace('no effect of memory training on IQ', ''), f'{name}: no IQ promise')
            for cfg, mins in (('Standard', '52'), ('Minimum', '36'), ('Quick', '12'), ('Extended', '57')):
                c.ok(f'{cfg} · about {mins} min' in txt, f'{name}: config {cfg} shows {mins} min')
            c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: no horizontal overflow (fresh)')
            c.eq(page.evaluate(GAMI_JS), 0, f'{name}: no gamification elements')
            primaries = page.evaluate("document.querySelectorAll('#hf-screen .hf-btn--primary').length")
            c.ok(primaries <= 1, f'{name}: at most one primary button ({primaries})')
            features = page.evaluate("document.querySelectorAll('#hf-screen .hf-card--feature').length")
            c.ok(features <= 1, f'{name}: at most one feature card ({features})')
            page.screenshot(path=os.path.join(OUT_DIR, f'home-{name}-fresh.png'), full_page=True)
            if name == 'desktop-light':
                # configuration choice with real clicks
                page.locator('#hf-screen label', has_text='Minimum · about 36 min').click()
                page.wait_for_timeout(100)
                c.eq(page.evaluate('HF.store.records.settings.labConfig'), 'minimum', 'config change saved')
                page.evaluate("HF.router.go('lab')")
                page.wait_for_timeout(200)
                c.ok('36 minutes' in page.evaluate("document.querySelector('[data-next-kind]').innerText") or 'About 36' in page.evaluate("document.querySelector('[data-next-kind]').innerText"),
                     'next-visit card follows the chosen configuration')
                page.locator('#hf-screen label', has_text='Standard · about 52 min').click()
            # with results
            page.evaluate(SEED_JS, {'visits': SCORES, 'sessions': 20, 'sessionsFromDaysAgo': 50})
            page.evaluate("HF.router.go('lab')")
            page.wait_for_timeout(300)
            levels = page.evaluate("Array.from(document.querySelectorAll('.hf-lab-level')).map((e) => e.getAttribute('data-level'))")
            c.eq(levels, ['mid', 'far'], f'{name}: untrained user → probes are mid, reasoning far ({levels})')
            notes = page.evaluate("Array.from(document.querySelectorAll('.hf-dots__note')).map((n) => n.textContent)")
            c.ok(notes and all('Not yet calibrated' in n for n in notes), f'{name}: every test uncalibrated before import')
            c.ok(page.evaluate("document.getElementById('hf-screen').innerText.includes('quarter of a standard deviation')"), f'{name}: typical retest gain text')
            c.ok(page.evaluate("!!document.querySelector('[data-caveat=retest]')"), f'{name}: retest caveat')
            plots = page.evaluate("document.querySelectorAll('.hf-dots').length")
            c.ok(plots >= 4, f'{name}: dot plots per level and unit ({plots})')
            c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: no horizontal overflow (results)')
            page.screenshot(path=os.path.join(OUT_DIR, f'home-{name}-results.png'), full_page=True)
            if name in ('desktop-light', 'phone-dark'):
                # calibration import by paste (real typing into the textarea is slow; fill = real input events)
                page.locator('#hf-screen summary', has_text='Import a calibration file').click()
                page.fill('#lab-cal-paste', json.dumps(CAL))
                page.locator('#hf-screen button', has_text='Import pasted text').click()
                page.wait_for_timeout(300)
                cal = page.evaluate("HF.store.records.calibration && Object.keys(HF.store.records.calibration.tests).sort()")
                c.eq(cal, ['lab.matrix', 'lab.nback', 'lab.rel', 'lab.series', 'lab.sspan'], f'{name}: calibration stored')
                notes = page.evaluate("Array.from(document.querySelectorAll('.hf-dots__note')).map((n) => n.textContent)")
                c.details[f'{name}-notes'] = notes
                c.ok(any('Above the noise band' in n for n in notes), f'{name}: an above-the-band verdict after import')
                c.ok(any('Inside the noise band' in n for n in notes), f'{name}: an inside-the-band verdict after import')
                c.ok(any('Not yet calibrated' in n for n in notes), f'{name}: tests below n = 50 stay uncalibrated')
                c.ok(page.evaluate("document.querySelectorAll('.hf-dots__band').length") >= 3, f'{name}: noise bands drawn')
                above = [n for n in notes if 'Above the noise band' in n]
                c.ok(above and all('measurement noise' in n for n in above) and not any('retesting usually gives' in n for n in notes), f'{name}: SC-08 verdicts say measurement noise ({above[:1]})')
                c.ok(any('the usual retest gain is not subtracted' in n for n in above), f'{name}: SC-08 the retest gain is not subtracted')
                adj = [n for n in notes if 'After subtracting the average retest gain of at least 30 people who did not train' in n]
                c.eq(len(adj), 1, f'{name}: practice-corrected line only where practiceN ≥ 30 (matrix 40, not relations 12)')
                c.eq(page.evaluate("HF.store.records.calibration.tests['lab.matrix'].practiceN"), 40, f'{name}: the import keeps practiceN')
                page.locator('#hf-screen summary', has_text='Notes about some visits').click()
                vtxt = page.evaluate("document.getElementById('hf-screen').innerText")
                c.ok('notes or help were used' in vtxt and 'short sleep' in vtxt, f'{name}: data-quality notes per visit')
                # bad paste
                page.fill('#lab-cal-paste', '{"nope": 1}')
                page.locator('#hf-screen button', has_text='Import pasted text').click()
                page.wait_for_timeout(150)
                c.ok('no "tests" section' in page.evaluate("document.getElementById('hf-screen').innerText"), f'{name}: a bad file is refused in plain words')
                page.screenshot(path=os.path.join(OUT_DIR, f'home-{name}-calibrated.png'), full_page=True)
                # export panel
                page.locator('#hf-screen summary', has_text='Export your Lab data').click()
                page.locator('#hf-screen button', has_text='Prepare the export').click()
                page.wait_for_timeout(300)
                exp = page.evaluate("JSON.parse(document.querySelector('.hf-export .hf-copy__area').value)")
                c.eq(exp['meta']['kind'], 'long-horizon-study-export', f'{name}: export JSON built')
                c.eq(len(exp['visits']), 4, f'{name}: export holds the 4 visits')
                page.locator('#hf-screen .hf-export label', has_text='Lab visits (CSV)').click()
                page.wait_for_timeout(100)
                csv = page.evaluate("document.querySelector('.hf-export .hf-copy__area').value")
                c.ok(csv.startswith('visit_id,kind,config'), f'{name}: CSV visits table')
                c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: no horizontal overflow (export)')
                page.screenshot(path=os.path.join(OUT_DIR, f'home-{name}-export.png'), full_page=True)
                # CB-07: Remove writes a tombstone (wins merges); the results go back to "not yet calibrated" at once
                page.locator('#hf-screen button', has_text='Remove calibration').click()
                page.wait_for_selector('dialog.hf-modal[open]')
                page.locator('dialog.hf-modal[open] button', has_text='Remove').click()
                page.wait_for_timeout(300)
                calr = page.evaluate("HF.store.records.calibration")
                c.ok(calr and calr.get('removed') is True and calr.get('tests') == {} and calr.get('updatedAt'), f'{name}: CB-07 removal is a tombstone ({calr})')
                notes = page.evaluate("Array.from(document.querySelectorAll('.hf-dots__note')).map((n) => n.textContent)")
                c.ok(notes and all('Not yet calibrated' in n for n in notes), f'{name}: results back to "not yet calibrated" after removal')
                c.eq(page.evaluate("document.querySelector('[data-cal-status]').getAttribute('data-cal-status')"), 'none', f'{name}: calibration status none')
                old = dict(CAL)
                merged = page.evaluate("(cal) => { const a = HF.schema.defaultRecords(); a.calibration = cal; return HF.schema.merge(a, HF.store.records).calibration; }", old)
                c.ok(merged and merged.get('removed') is True, f'{name}: CB-07 an older calibration (other tab, old backup) does not undo the removal')
                page.evaluate("HF.router.go('lab')")
                page.wait_for_timeout(250)
                c.eq(page.evaluate("document.querySelector('[data-cal-status]').getAttribute('data-cal-status')"), 'none', f'{name}: still none after a re-render')
                exp2 = None
                page.locator('#hf-screen summary', has_text='Export your Lab data').click()
                page.locator('#hf-screen button', has_text='Prepare the export').click()
                page.wait_for_timeout(300)
                exp2 = page.evaluate("JSON.parse(document.querySelector('.hf-export .hf-copy__area').value)")
                c.eq(exp2['scores']['calibration'], None, f'{name}: CB-07 the export reads the tombstone as no calibration')
            # study entry
            page.locator('#hf-screen button', has_text='Study mode').first.click()
            page.wait_for_timeout(200)
            c.eq(page.evaluate('HF.router.current.name'), 'study', f'{name}: Study mode opens')
            c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: study page has no horizontal overflow')
            page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-intro.png'), full_page=True)
            c.eq(con.errors + con.page_errors, [], f'{name}: 0 console errors')
            ctx.close()
        # storage blocked → memory mode: the Lab notice prints the store's own message (status.reason 'blocked')
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        ctx.add_init_script(BLOCK_STORAGE_JS)
        page = ctx.new_page()
        con = Console(page)
        page.goto(file_url('index.html') + '#/lab')
        page.wait_for_function('window.HF && HF.booted === true', timeout=15000)
        page.wait_for_timeout(300)
        close_modals(page)
        page.evaluate("HF.router.go('lab')")
        page.wait_for_timeout(250)
        st = page.evaluate("({ persistent: HF.store.persistent, reason: HF.store.status && HF.store.status.reason, message: HF.store.status && HF.store.status.message })")
        c.ok(st['persistent'] is False and st['reason'] == 'blocked' and st['message'], f'memory mode with a reason ({st})')
        txt = page.evaluate("document.getElementById('hf-screen').innerText")
        c.ok('Not saved on this device' in txt and st['message'] and st['message'] in txt, 'the Lab memory-mode notice prints HF.store.status.message')
        page.screenshot(path=os.path.join(OUT_DIR, 'home-memory-mode.png'), full_page=True)
        ctx.close()
    res = c.result()
    write_json('lab-home.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
