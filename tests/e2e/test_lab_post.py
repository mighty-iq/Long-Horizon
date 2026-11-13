"""Post-test export prompt e2e (Chromium): with Baseline 1 + 2 and 20 counted sessions, the Lab home offers the
Post-test; a study participant takes it (Minimum configuration, items trimmed for speed), answers the blinding
guess in the close-out, and must then pass the export step: the reason in plain words (Follow-up, browser storage),
a copy box with the full backup (importable JSON incl. this Post-test) and a Download; "I have saved it" stays
disabled until Copy or Download is used; the study export panel is offered with the study fields (CB-13: age band,
writing hand, browser details). Phase 4 CB-01: backups.lastExportAt is NOT stamped when the step opens, only by
Download (desktop) or by "I have saved it" after the "I saved the file" box (phone). CB-15: the visit holds the
session wake lock (HF.timing.keepAwake) from "Start the tests" through the player runs to the done screen, which
releases it. 0 console errors in the Lab flow.
Run: python3 tests/e2e/test_lab_post.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import Driver, OUT_DIR, SEED_JS, open_app, reset_store

STUDY_JS = r"""() => {
  const d = HF.study.draw('e2e-post-seed', { template: 'default' });
  HF.store.mutate((r) => {
    r.events = r.events || [];
    r.events.push({ id: 'ev-enrol', t: Date.now() - 40 * 86400000, type: 'study-enrol', template: 'default', consentAt: Date.now() - 40 * 86400000, adult: true });
    r.events.push({ id: 'ev-draw', t: Date.now() - 39 * 86400000, type: 'study-draw', arm: d.arm, salt: d.salt, commitment: d.commitment, template: 'default', arms: d.arms });
  });
  HF.store.flush();
  return d.arm;
}"""

# records every HF.timing.keepAwake(on) call (CB-15) with the screen heading at that moment
AWAKE_JS = r"""() => {
  if (window.__awakeWrapped) return true;
  window.__awakeWrapped = true;
  window.__awake = [];
  const orig = HF.timing.keepAwake;
  HF.timing.keepAwake = function (on) {
    const h1 = document.querySelector('#hf-screen h1');
    window.__awake.push({ on: !!on, h1: h1 ? h1.textContent.trim() : null });
    return orig.apply(this, arguments);
  };
  return true;
}"""
STAMP_JS = "() => (HF.store.records.backups && HF.store.records.backups.lastExportAt) || null"


def run():
    c = Check('lab-post')
    with browser() as b:
        for (w, h, name) in [(1366, 768, 'desktop'), (390, 844, 'phone')]:
            ctx, page, con = open_app(b, w, h)
            boot = list(con.errors + con.page_errors)
            reset_store(page)
            page.evaluate(SEED_JS, {'visits': [
                {'kind': 'B1', 'daysAgo': 44, 'config': 'minimum', 'scores': {'lab.nback': 1.3, 'lab.rel': 0.4, 'lab.sspan': 0.6, 'lab.matrix': 0.5, 'lab.series': 0.5}},
                {'kind': 'B2', 'daysAgo': 40, 'config': 'minimum', 'scores': {'lab.nback': 1.5, 'lab.rel': 0.45, 'lab.sspan': 0.62, 'lab.matrix': 0.52, 'lab.series': 0.55}}],
                'sessions': 20, 'sessionsFromDaysAgo': 17})
            arm = page.evaluate(STUDY_JS)
            page.evaluate("() => { HF.store.mutate((r) => { r.settings.labConfig = 'minimum'; r.settings.updatedAt = Date.now(); }); }")
            page.evaluate("HF.ui.labvisit.testHooks.trim = 1")
            page.evaluate(AWAKE_JS)
            page.evaluate("HF.router.go('lab')")
            page.wait_for_timeout(250)
            c.eq(page.evaluate("document.querySelector('[data-next-kind]').getAttribute('data-next-kind')"), 'POST', f'{name}: Lab home offers the Post-test')
            page.locator('#hf-screen button', has_text='Start Post-test').click()
            page.wait_for_timeout(200)
            d = Driver(page, c, [], prefix=f'post-{name}', accuracy=1.0)
            s = d.run(max_s=300, stop_at=lambda s: s.get('h1') == 'Save a copy now')
            c.eq(s.get('h1'), 'Save a copy now', f'{name}: the export step follows the Post-test close-out')
            blind = page.evaluate("HF.store.records.events.filter((e) => e.type === 'study-blind')")
            c.ok(len(blind) == 1 and blind[0]['guess'], f'{name}: blinding guess saved as a study-blind event ({blind})')
            txt = page.evaluate("document.getElementById('hf-screen').innerText")
            c.ok('Follow-up' in txt and 'clear' in txt, f'{name}: the reason is given in plain words')
            c.ok('For your study' in txt, f'{name}: study export offered to a participant')
            c.ok('Age band (optional)' in txt and 'Writing hand (optional)' in txt and 'Include browser details' in txt, f'{name}: CB-13 the Post-test study export has the study fields')
            c.eq(page.evaluate(STAMP_JS), None, f'{name}: CB-01 opening the export step stamps no backup')
            aw = page.evaluate("window.__awake")
            first_on = next((k for k, a in enumerate(aw) if a['on'] and a['h1'] == 'Check-in'), None)
            c.ok(first_on is not None, f'{name}: CB-15 keepAwake(true) in the "Start the tests" click')
            c.ok(aw and aw[-1]['on'] is True, f'{name}: CB-15 still awake at the export step, after the player runs ({aw[-4:]})')
            c.ok(any(not a['on'] for a in aw[first_on or 0:]), f'{name}: (the player released its own lock in between, so the visit asked again)')
            go = page.locator('#hf-screen button', has_text='I have saved it')
            c.ok(go.is_disabled(), f'{name}: cannot continue before saving')
            backup = page.evaluate("document.querySelector('.hf-copy__area').value")
            try:
                json.loads(backup)
                c.ok('POST' in backup and 'labVisits' in backup, f'{name}: the copy box holds the full backup incl. this Post-test')
            except Exception as e:  # noqa: BLE001
                c.ok(False, f'{name}: backup is JSON ({e})')
            imp = page.evaluate("(t) => { const r = HF.store.importText(t); return { ok: r.ok, error: r.error || null }; }", backup)
            c.ok(imp['ok'], f'{name}: the backup imports back cleanly ({imp})')
            page.screenshot(path=os.path.join(OUT_DIR, f'post-{name}-export.png'), full_page=True)
            c.eq(page.evaluate(STAMP_JS), None, f'{name}: CB-01 still no backup stamp after reading and importing the box')
            if name == 'desktop':
                with page.expect_download() as dl:
                    page.locator('#hf-screen .hf-copy button', has_text='Download').first.click()
                c.ok(dl.value.suggested_filename.startswith('long-horizon-backup-') and dl.value.suggested_filename.endswith('.json'), f'{name}: download offered ({dl.value.suggested_filename})')
                page.wait_for_timeout(150)
                c.ok(not go.is_disabled(), f'{name}: Download enables the continue button')
                c.ok(page.evaluate(STAMP_JS), f'{name}: CB-01 Download stamps the backup')
            else:
                page.locator('#lv-saved').check()
                page.wait_for_timeout(100)
                c.ok(not go.is_disabled(), f'{name}: the "I saved the file" box enables the continue button')
                c.eq(page.evaluate(STAMP_JS), None, f'{name}: CB-01 ticking the box alone stamps nothing yet')
            go.click()
            page.wait_for_timeout(250)
            h1 = page.evaluate("document.querySelector('#hf-screen h1').textContent")
            c.ok(h1.endswith('saved'), f'{name}: done screen after the export ({h1})')
            c.ok(page.evaluate(STAMP_JS), f'{name}: backups.lastExportAt stamped once saved')
            aw = page.evaluate("window.__awake")
            c.ok(aw and aw[-1]['on'] is False, f'{name}: CB-15 the done screen releases the wake lock ({aw[-2:]})')
            rec = page.evaluate("HF.store.records.labVisits.filter((v) => v.kind === 'POST').map((v) => Object.keys(v.tests).sort())")
            c.eq(rec, [['lab.matrix', 'lab.nback', 'lab.rel', 'lab.series', 'lab.sspan']], f'{name}: Post-test record with the Minimum tests')
            sched = page.evaluate("() => HF.lab.schedule(HF.store.records, null, Date.now()).plan.map((e) => [e.kind, e.status])")
            c.ok(['POST', 'done'] in sched and any(k == 'FU' and st == 'upcoming' for k, st in sched), f'{name}: Post-test done, Follow-up upcoming ({sched})')
            page.locator('#hf-screen button', has_text='Back to the Lab').click()
            page.wait_for_timeout(250)
            page.screenshot(path=os.path.join(OUT_DIR, f'post-{name}-lab-after.png'), full_page=True)
            c.eq([e for e in con.errors + con.page_errors if e not in boot], [], f'{name}: 0 console errors in the Lab flow')
            c.details[f'{name}-arm'] = arm
            ctx.close()
    res = c.result()
    write_json('lab-post.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
