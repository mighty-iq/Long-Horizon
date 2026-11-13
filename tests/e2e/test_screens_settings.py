"""Settings and data flows with real clicks and keys (Chromium, desktop 1366×768 and phone 390×844):
- every kind of setting persists across a reload and is applied to <html> (theme, large text, focus mode …);
- Stretch locked for a new user, with the reason; "Help me choose" suggests and switches a style;
- key remapping: capture, conflict → swap, reserved keys refused, Escape cancels, A/L preset, defaults;
  HF.input maps the new key to the logical key;
- the tap-along timing test runs and can save an offset;
- reset: Cancel keeps the data, confirm wipes it;
- export → import round trip (JSON via the paste box and the file picker), CSV of blocks and sessions,
  backups.lastExportAt stamped, a bad import is refused with a message.
Run: python3 tests/e2e/test_screens_settings.py
"""
import json
import time

from helpers import Check, browser, run_main
from test_screens_common import (DESKTOP, PHONE, boot, go, new_page, reload, seed, shot, stub_routes, write_json)


def seg(page, name, value):
    page.click(f"label.hf-seg__opt:has(input[name='{name}'][value='{value}'])")
    page.wait_for_timeout(120)


def settings_of(page):
    return page.evaluate('HF.store.records.settings')


def run():
    c = Check('screens-settings')
    shots = []
    with browser() as b:
        # ---------- a new user: Stretch locked, Help me choose ----------
        ctx, page, con = new_page(b, DESKTOP)
        boot(page)
        go(page, 'settings', {'section': 'style'})
        c.ok(page.evaluate("document.querySelector('#hf-mode-stretch').disabled"), 'new user: Stretch is locked')
        c.ok(page.evaluate("document.querySelector('.hf-mode.is-locked').textContent.includes('Opens after 6 counted sessions')"), 'Stretch shows why it is locked')
        page.click('#hf-help-btn')
        page.wait_for_timeout(150)
        seg(page, 'hf-help-q', 'hard')
        txt = page.evaluate("document.querySelector('.hf-help__result').textContent")
        c.ok('Suggested: Varied' in txt and 'Stretch opens after 6' in txt, f'locked Stretch → Varied suggested with the reason ({txt[:80]!r})')
        seg(page, 'hf-help-q', 'fast')
        page.click('#hf-help-use')
        page.wait_for_timeout(200)
        c.eq(settings_of(page)['mode'], 'sprint', 'Help me choose → Use Sprint switches the style')
        c.ok(page.evaluate("document.querySelector('#hf-mode-sprint').checked"), 'Sprint card checked after the switch')
        c.ok(page.evaluate("!!document.querySelector('#hf-sprint-nback')"), 'Sprint shows its n-back version choice')
        shots.append(shot(page, 'settings-help-desktop-light'))
        c.eq(con.mine(), [], 'new user settings: no console errors from P3 code')
        ctx.close()

        # ---------- seeded user: every setting persists ----------
        ctx, page, con = new_page(b, DESKTOP)
        boot(page)
        seed(page)
        reload(page)
        go(page, 'settings')
        page.click('#hf-mode-protocols')
        page.wait_for_timeout(200)
        c.ok(page.evaluate("document.querySelectorAll('.hf-protos__item').length") == 3, 'Protocols: Cao, Wang and Jaeggi described')
        c.ok(page.evaluate("document.querySelector('.hf-protos').textContent.includes('no untrained control group')"), 'Protocols: Cao limits stated')
        page.click("label[for='hf-proto-jaeggi']")
        seg(page, 'hf-cao-arm', 'trad')
        page.click("label[for='hf-proto-cao']")
        page.click("label[for='hf-proto-wang']")
        page.wait_for_timeout(150)
        pr = settings_of(page)['protocols']
        c.eq(pr, {'cao': False, 'wang': False, 'jaeggi': True}, 'protocol switches saved')
        page.click("label[for='hf-proto-jaeggi']")
        page.wait_for_timeout(150)
        c.eq(settings_of(page)['protocols']['jaeggi'], True, 'the last protocol cannot be switched off')
        c.ok('Keep at least one protocol on' in page.evaluate("document.querySelector('.hf-protos__msg').textContent"), 'message when trying to switch off the last protocol')
        page.click('#hf-mode-varied')
        page.wait_for_timeout(150)
        page.select_option('#hf-set-minutes', '15')
        seg(page, 'hf-set-target', '5')
        seg(page, 'hf-set-balance', 'nb')
        page.click("label[for='hf-set-span']")
        page.wait_for_timeout(150)
        c.ok(page.evaluate("document.querySelectorAll('input[name=hf-set-balance]').length") == 4, 'Span on → three-way balance presets')
        page.click("label[for='hf-set-dual']")
        seg(page, 'hf-set-sound', 'off')
        page.evaluate("""() => { const r = document.querySelector('#hf-set-volume'); r.value = '40';
          r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }""")
        seg(page, 'hf-set-fb', 'on')
        page.click("label[for='hf-set-focus']")
        seg(page, 'hf-set-theme', 'dark')
        page.click("label[for='hf-set-large']")
        page.click("label[for='hf-set-hand']")
        seg(page, 'hf-set-motion', 'reduce')
        page.click("label[for='hf-set-sharelevels']")
        page.wait_for_timeout(700)
        page.evaluate('HF.store.flush(true)')
        reload(page)
        s = settings_of(page)
        want = {'mode': 'varied', 'sessionMinutes': 15, 'weeklyTarget': 5, 'spanOn': True, 'dual': True, 'sound': 'off', 'volume': 0.4,
                'perResponseFeedback': True, 'focusMode': True, 'theme': 'dark', 'largeText': True, 'leftHanded': True,
                'reducedMotion': True, 'includeLevelsInShare': True, 'caoArm': 'trad'}
        for k, v in want.items():
            c.eq(s.get(k), v, f'after reload: settings.{k}')
        c.eq(s['balance'], {'nback': 40, 'relations': 35, 'span': 25}, 'after reload: balance with Span on')
        html = page.evaluate("['data-theme','data-text','data-hand','data-motion','data-focus'].map(a => document.documentElement.getAttribute(a))")
        c.eq(html, ['dark', 'large', 'left', 'reduce', 'on'], 'display settings applied to <html> after reload')
        go(page, 'settings')
        c.ok(page.evaluate("document.querySelector('#hf-set-large').checked && document.querySelector('#hf-set-focus').checked"), 'toggles show the saved state')
        c.eq(page.evaluate("document.querySelector('input[name=hf-set-theme]:checked').value"), 'dark', 'theme control shows the saved state')
        shots.append(shot(page, 'settings-changed-desktop-dark'))
        # Stretch caps the weekly target at 4
        page.click('#hf-mode-stretch')
        page.wait_for_timeout(200)
        c.ok(page.evaluate("document.querySelector('input[name=hf-set-target][value=\"5\"]').disabled"), 'Stretch: 5 sessions a week disabled')
        c.ok(page.evaluate("document.querySelector('#session').textContent.includes('at most 4 sessions a week')"), 'Stretch: cap explained')
        c.ok(page.evaluate("[...document.querySelectorAll('input[name=hf-set-fb]')].every(i => i.disabled)"), 'Stretch: feedback setting locked')
        page.click('#hf-mode-varied')
        page.wait_for_timeout(150)
        # back to light, normal text, no focus mode for the rest
        page.evaluate("HF.ui.screenKit.setSettings({ theme: 'light', largeText: false, focusMode: false, leftHanded: false, reducedMotion: null })")

        # ---------- keys ----------
        go(page, 'settings', {'section': 'keys'})
        page.click('#hf-key-match')
        page.wait_for_timeout(100)
        c.ok(page.evaluate("!!document.querySelector('#hf-key-match-wait')"), 'Change → waiting for a key')
        page.keyboard.press('a')
        page.wait_for_timeout(150)
        c.eq(settings_of(page)['keys']['match'], 'KeyA', 'match remapped to A')
        c.eq(page.evaluate("HF.input.keyFor('KeyA')"), 'match', 'HF.input maps A to match')
        c.eq(page.evaluate("HF.input.keyFor('KeyJ')"), None, 'J no longer mapped')
        page.evaluate("() => { window.__k = []; window.__offK = HF.input.on(e => __k.push(e.key)); document.activeElement && document.activeElement.blur(); }")
        page.keyboard.press('a')
        page.wait_for_timeout(50)
        c.eq(page.evaluate('window.__k'), ['match'], 'pressing A gives a logical match')
        page.evaluate('window.__offK()')
        page.click('#hf-key-match2')
        page.keyboard.press('a')
        page.wait_for_timeout(150)
        c.ok(page.evaluate("!!document.querySelector('#hf-key-swap')"), 'conflict: offered a swap')
        c.ok('already used for Match' in page.evaluate("document.querySelector('.hf-keys2__msg').textContent"), 'conflict named')
        page.click('#hf-key-swap')
        page.wait_for_timeout(150)
        k = settings_of(page)['keys']
        c.eq([k['match'], k['match2']], ['KeyK', 'KeyA'], 'swap: match K, sound match A')
        page.click('#hf-key-no')
        page.keyboard.press('Tab')
        page.wait_for_timeout(120)
        c.ok('Tab moves between buttons' in page.evaluate("document.querySelector('.hf-keys2__msg').textContent"), 'Tab refused with a reason')
        c.ok(page.evaluate("!!document.querySelector('#hf-key-no-wait')"), 'still waiting after a refused key')
        page.keyboard.press('F5')
        page.wait_for_timeout(120)
        c.ok(page.evaluate("!!document.querySelector('#hf-key-no-wait')"), 'function key refused (page not reloaded)')
        page.keyboard.press('Escape')
        page.wait_for_timeout(120)
        c.eq(settings_of(page)['keys']['no'], 'KeyF', 'Escape cancels, No stays F')
        page.click('#hf-key-pause')
        page.keyboard.press('q')
        page.wait_for_timeout(120)
        c.eq(settings_of(page)['keys']['pause'], ['Escape', 'KeyQ'], 'pause: Esc kept, second key Q')
        page.click('#hf-key-al')
        page.wait_for_timeout(120)
        k = settings_of(page)['keys']
        c.eq([k['match'], k['match2'], k['no']], ['KeyA', 'KeyL', 'KeyF'], 'A/L preset (Brain Workshop)')
        shots.append(shot(page, 'settings-keys-desktop-light', full=False))
        page.click('#hf-key-default')
        page.wait_for_timeout(120)
        k = settings_of(page)['keys']
        c.eq([k['match'], k['match2'], k['no'], k['pause'], k['next']], ['KeyJ', 'KeyK', 'KeyF', ['Escape', 'KeyP'], 'Space'], 'defaults restored')

        # ---------- tap-along timing test ----------
        go(page, 'settings', {'section': 'sound'})
        page.click('#hf-offset-measure')
        page.wait_for_timeout(100)
        page.click('#hf-tap-start')
        try:
            page.wait_for_selector('#hf-tap-pad', timeout=4000)
            ok_pad = True
        except Exception:
            ok_pad = False
        c.ok(ok_pad, 'tap test: the tap pad appears after Start (audio unlocked in the click)')
        if ok_pad:
            page.focus('#hf-tap-pad')
            t0 = time.time()
            # beats at 1.5 s + k × 0.75 s after the unlock; tap a little late on each
            for kbeat in range(16):
                target = t0 + 1.5 + kbeat * 0.75 + 0.05
                dt = target - time.time()
                if dt > 0:
                    time.sleep(dt)
                page.keyboard.press('Space')
            page.wait_for_selector('#hf-tap-again', timeout=6000)
            measured = page.evaluate("!!document.querySelector('#hf-tap-use')")
            c.details['tap_result'] = page.evaluate("document.querySelector('#hf-tapbox').textContent")
            c.ok(measured or 'Not enough taps' in c.details['tap_result'], 'tap test ends with a result')
            if measured:
                page.click('#hf-tap-use')
                page.wait_for_timeout(150)
                off = settings_of(page)['audioOffsetMs']
                c.ok(-500 <= off <= 500, f'offset saved within ±500 ms ({off})')
                page.evaluate("HF.ui.screenKit.setSettings({ audioOffsetMs: 0 })")

        # ---------- export → import round trip ----------
        before = page.evaluate("({ s: HF.store.records.sessions.length, b: HF.store.records.blocks.length, e: HF.store.records.events.length, tr: HF.store.trialSessionIds().length })")
        go(page, 'progress', {'section': 'backup'})
        page.wait_for_timeout(200)
        t_before = time.time() * 1000
        dl_name = None
        try:
            with page.expect_download(timeout=4000) as dl:
                page.click('#hf-export-json')
            dl_name = dl.value.suggested_filename
        except Exception:
            pass
        page.wait_for_timeout(150)
        c.ok(bool(dl_name) and dl_name.startswith('long-horizon-backup-') and dl_name.endswith('.json'), f'export downloads a .json file ({dl_name})')
        text = page.evaluate("document.querySelector('.hf-backup__box textarea').value")
        data = json.loads(text)
        c.eq(data.get('format'), 'long-horizon-backup', 'export is a Long-Horizon backup')
        c.eq(len(data['records']['sessions']), before['s'], 'export holds every session')
        c.ok(len(data.get('trials') or {}) >= 1, 'export holds trial logs')
        last = page.evaluate('HF.store.records.backups.lastExportAt')
        c.ok(last and last >= t_before - 1000, 'backups.lastExportAt stamped by the export')
        c.ok('none yet' not in page.evaluate("document.querySelector('.hf-backup__last').textContent"), 'last backup date shown')
        page.click('#hf-export-blocks')
        page.wait_for_timeout(100)
        csv_b = page.evaluate("document.querySelector('.hf-backup__box textarea').value")
        lines = [ln for ln in csv_b.splitlines() if ln]
        c.ok(lines[0].startswith('block_id,session_id,date,time'), 'blocks CSV header')
        c.eq(len(lines) - 1, before['b'], 'blocks CSV: one row per block')
        page.click('#hf-export-sessions')
        page.wait_for_timeout(100)
        csv_s = page.evaluate("document.querySelector('.hf-backup__box textarea').value")
        lines_s = [ln for ln in csv_s.splitlines() if ln]
        c.ok(lines_s[0].startswith('session_id,date,start_time'), 'sessions CSV header')
        c.eq(len(lines_s) - 1, before['s'], 'sessions CSV: one row per session')
        # wipe, then import the pasted text
        page.evaluate('HF.store.reset()')
        page.wait_for_timeout(100)
        go(page, 'progress', {'section': 'backup'})
        c.eq(page.evaluate('HF.store.records.sessions.length'), 0, 'reset emptied the store')
        page.click("#backup summary:has-text('Paste backup text instead')")
        page.fill('#hf-import-text', 'this is not a backup')
        page.click('#hf-import-paste')
        page.wait_for_timeout(150)
        c.ok('Not imported' in page.evaluate("document.querySelector('.hf-backup__result').textContent"), 'bad text refused with a message')
        page.fill('#hf-import-text', text)
        page.click('#hf-import-paste')
        page.wait_for_timeout(400)
        after = page.evaluate("({ s: HF.store.records.sessions.length, b: HF.store.records.blocks.length, e: HF.store.records.events.length, tr: HF.store.trialSessionIds().length })")
        c.eq([after['s'], after['b']], [before['s'], before['b']], 'import restored every session and block')
        c.ok(after['tr'] >= before['tr'], 'import restored the trial logs')
        res_txt = page.evaluate("(document.querySelector('.hf-backup__result') || {}).textContent || ''")
        c.ok('Backup imported' in res_txt and 'new records' in res_txt, f'import summary shown ({res_txt[:90]!r})')
        shots.append(shot(page, 'progress-backup-desktop-light', full=False))
        # the same file again through the file picker: nothing new, nothing lost
        page.set_input_files('#hf-import-file', files=[{'name': 'long-horizon-backup.json', 'mimeType': 'application/json', 'buffer': text.encode('utf-8')}])
        page.wait_for_timeout(500)
        res2 = page.evaluate("(document.querySelector('.hf-backup__result') || {}).textContent || ''")
        c.ok('Backup imported' in res2 and '0 new records' in res2, f'file import of the same backup adds nothing ({res2[:80]!r})')
        c.eq(page.evaluate('HF.store.records.sessions.length'), before['s'], 'file import keeps the sessions')
        # the same data as a backup file from 1.0.0 (working name Holdfast: format id 'holdfast-backup') is accepted too
        old = json.loads(text)
        old.update({'format': 'holdfast-backup', 'app': 'Holdfast', 'appVersion': '1.0.0'})
        page.evaluate("document.querySelector('.hf-backup__result') && (document.querySelector('.hf-backup__result').textContent = '')")
        page.set_input_files('#hf-import-file', files=[{'name': 'holdfast-backup-2026-11-12.json', 'mimeType': 'application/json', 'buffer': json.dumps(old).encode('utf-8')}])
        page.wait_for_timeout(500)
        res3 = page.evaluate("(document.querySelector('.hf-backup__result') || {}).textContent || ''")
        c.ok('Backup imported' in res3 and '0 new records' in res3, f'a 1.0.0 backup file (holdfast-backup) imports; same data adds nothing ({res3[:80]!r})')
        c.eq(page.evaluate('HF.store.records.sessions.length'), before['s'], '1.0.0 file import keeps the sessions')

        # ---------- reset with confirm ----------
        stub_routes(page, ['welcome'])
        go(page, 'settings', {'section': 'data'})
        page.click('#hf-reset')
        page.wait_for_timeout(150)
        c.eq(page.evaluate('HF.dom.openModals()'), 1, 'reset asks first')
        c.eq(page.evaluate('document.activeElement.textContent'), 'Keep my data', 'the safe choice has focus')
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        c.eq(page.evaluate('HF.store.records.sessions.length'), before['s'], 'Escape / Keep my data: nothing deleted')
        page.click('#hf-reset')
        page.wait_for_timeout(150)
        page.click("dialog.hf-modal[open] button:has-text('Delete everything')")
        page.wait_for_timeout(400)
        c.eq(page.evaluate('HF.store.records.sessions.length'), 0, 'confirm: sessions deleted')
        c.eq(page.evaluate('HF.store.records.profile.firstRunDone'), False, 'confirm: first run starts again')
        c.ok(page.evaluate('HF.router.current.name') in ('welcome', 'today'), 'after reset: back to the start')
        c.details['console'] = con.summary()
        c.eq(con.mine(), [], 'settings flows: no console errors from P3 code')
        ctx.close()

        # ---------- phone: settings screen usable at 390 px ----------
        ctx, page, con = new_page(b, PHONE)
        boot(page)
        seed(page)
        reload(page)
        go(page, 'settings', {'section': 'keys'})
        page.click('#hf-key-match')
        page.wait_for_timeout(100)
        shots.append(shot(page, 'settings-keys-capture-phone-light', full=False))
        page.keyboard.press('Escape')
        go(page, 'settings', {'section': 'sound'})
        page.click('#hf-offset-measure')
        page.wait_for_timeout(100)
        shots.append(shot(page, 'settings-sound-phone-light', full=False))
        c.eq(con.mine(), [], 'phone settings: no console errors from P3 code')
        ctx.close()
    c.details['shots'] = shots
    write_json('settings.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
