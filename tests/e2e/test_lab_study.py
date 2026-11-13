"""Study mode e2e (Chromium): templates with what each programme does (Phase 4 SC-01: neutral lines, nothing says
which programme is the comparison), adults-only consent (with the decodable-codes limitation), enrolment event, the
solo random draw after Baseline 2 → only the commitment code in a copy box with the Discord instruction; the programme
appears after "I have posted or noted the code" (SC-04, a study-posted event) → expectation questions → the export
bundle (JSON + CSV; salt hidden before the Post-test, revealed and verifiable after it) → "Leave the study" (QA: confirm
dialog, cancel keeps it; leave → study-leave event, the date left on the screen, in the export and on the Lab home);
the coordinator-code path (bad code refused in plain words, a real code sets the programme at once); coordinator
allocation codes; no horizontal overflow; 0 console errors.
Run: python3 tests/e2e/test_lab_study.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import re

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import OUT_DIR, SEED_JS, open_app, reset_store

OVERFLOW_JS = "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
BASELINES = [{'kind': 'B1', 'daysAgo': 9, 'scores': {'lab.nback': 1.4, 'lab.rel': 0.4, 'lab.sspan': 0.6, 'lab.update': 0.6, 'lab.matrix': 0.5, 'lab.series': 0.5, 'lab.graph': 0.5, 'lab.switch': 150}},
             {'kind': 'B2', 'daysAgo': 5, 'scores': {'lab.nback': 1.6, 'lab.rel': 0.45, 'lab.sspan': 0.62, 'lab.update': 0.62, 'lab.matrix': 0.55, 'lab.series': 0.55, 'lab.graph': 0.55, 'lab.switch': 140}}]


def events(page, t):
    return page.evaluate("(t) => HF.store.records.events.filter((e) => e.type === t)", t)


REVEAL_RE = re.compile(r'control|comparison|matched|untrained|no memory load|same dose|dose', re.I)


def screen_text(page):
    return page.evaluate("document.getElementById('hf-screen').innerText")


def run():
    c = Check('lab-study')
    with browser() as b:
        for (w, h, name) in [(1366, 768, 'desktop'), (390, 844, 'phone')]:
            ctx, page, con = open_app(b, w, h)
            boot = list(con.errors + con.page_errors)
            reset_store(page)
            page.evaluate(SEED_JS, {'visits': BASELINES})
            page.evaluate("HF.router.go('lab')")
            page.wait_for_timeout(200)
            page.locator('#hf-screen button', has_text='Study mode').first.click()
            page.wait_for_timeout(200)
            c.eq(page.evaluate('HF.router.current.name'), 'study', f'{name}: Study mode from the Lab home')
            txt = page.evaluate("document.getElementById('hf-screen').innerText")
            c.ok('18 or older' in txt, f'{name}: adults only')
            c.ok('decoded by anyone' in txt, f'{name}: consent states that coordinator codes can be decoded from the open source')
            c.ok('Programme A' in txt and 'Programme B' in txt, f'{name}: programmes named neutrally')
            c.ok(page.evaluate("!!document.querySelector('[data-chimera] a[href=\"https://discord.gg/chmr\"]')"), f'{name}: Chimera Discord promoted on the Study screen')
            # SC-01: every template's lines are neutral (nothing says which programme is the comparison)
            for tpl_label in ('Long-Horizon study', 'Wang et al. 2025 replication', 'Cao et al. 2026 replication'):
                page.locator('#hf-screen fieldset', has_text='Which study?').first.locator('label', has_text=tpl_label).click()
                page.wait_for_timeout(50)
                arms_txt = page.evaluate("Array.from(document.querySelectorAll('.hf-st-arms')).map((e) => e.innerText).join(' ')")
                c.ok(arms_txt and not REVEAL_RE.search(arms_txt), f'{name}: {tpl_label}: neutral programme lines ({REVEAL_RE.search(arms_txt or "")})')
            c.ok(not REVEAL_RE.search(screen_text(page)), f'{name}: nothing on the screen names a control or comparison programme')
            # template choice (Cao replication) shows what each arm does, incl. the optional one
            arms = page.evaluate("Array.from(document.querySelectorAll('.hf-st-arm')).map((e) => e.getAttribute('data-arm'))")
            c.eq(arms, ['cao-exec', 'cao-trad', 'cao-search'], f'{name}: Cao template lists its three programmes')
            c.ok('day after the one n back' in page.evaluate("document.getElementById('hf-screen').innerText"), f'{name}: what each programme does, in plain words')
            join = page.locator('#hf-screen button', has_text='Join the study')
            c.ok(join.is_disabled(), f'{name}: Join disabled before consent')
            page.locator('label[for=st-adult]').click()
            c.ok(join.is_disabled(), f'{name}: Join still disabled with one box')
            page.locator('label[for=st-agree]').click()
            page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-consent.png'), full_page=True)
            join.click()
            page.wait_for_timeout(200)
            enrol = events(page, 'study-enrol')
            c.ok(len(enrol) == 1 and enrol[0]['template'] == 'cao' and enrol[0]['adult'] is True and enrol[0]['consentAt'], f'{name}: study-enrol event ({enrol})')
            # solo draw
            page.locator('#hf-screen label', has_text='Include Programme C in the draw').click()
            page.locator('#hf-screen button', has_text='Draw my programme').click()
            page.wait_for_selector('dialog.hf-modal[open]')
            page.locator('dialog.hf-modal[open] button', has_text='Draw').click()
            page.wait_for_timeout(300)
            dr = events(page, 'study-draw')
            c.eq(len(dr), 1, f'{name}: one study-draw event')
            if dr:
                d = dr[0]
                c.ok(d['arm'] in ('cao-exec', 'cao-trad', 'cao-search') and sorted(d['arms']) == ['cao-exec', 'cao-search', 'cao-trad'], f'{name}: drawn among the three chosen arms ({d["arm"]})')
                c.ok(page.evaluate("(d) => HF.study.verify(d.arm, d.salt, d.commitment)", d), f'{name}: commitment = SHA-256(arm:salt)')
                box = page.evaluate("document.querySelector('.hf-copy__area').value")
                c.eq(box, d['commitment'], f'{name}: commitment shown in a copy box')
                txt = page.evaluate("document.getElementById('hf-screen').innerText")
                c.ok('Post this code in the Chimera Discord before session 1' in txt, f'{name}: Discord instruction')
                c.ok(page.evaluate("!!document.querySelector('a[href=\"https://discord.gg/chmr\"]')"), f'{name}: Discord link')
                c.ok(d['salt'] not in txt, f'{name}: salt not shown before the Post-test')
                plan_line = page.evaluate("(a) => HF.ui.study.PLAN_TEXT[a]", d['arm'])
                c.ok(plan_line not in txt and 'I have posted or noted the code' in txt, f'{name}: SC-04 code first, the programme not shown yet')
                page.locator('#hf-screen .hf-copy button', has_text='Copy').first.click()
                page.wait_for_timeout(200)
                page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-commitment.png'), full_page=True)
                page.locator('#hf-screen button', has_text='I have posted or noted the code').click()
                page.wait_for_timeout(250)
                po = events(page, 'study-posted')
                c.ok(len(po) == 1 and po[0]['commitment'] == d['commitment'], f'{name}: study-posted event for this commitment ({po})')
                txt = screen_text(page)
                c.ok(plan_line in txt and 'Checked: the code matches your draw.' in txt, f'{name}: the programme is shown after posting')
                c.ok(page.evaluate("document.querySelector('.hf-copy__area').value") == d['commitment'], f'{name}: the code stays on screen')
                c.ok('the one behind the code you posted' in txt and 'was not repeated' not in txt.replace('cannot show that a draw was not repeated', ''), f'{name}: SC-04 wording')
                page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-programme.png'), full_page=True)
                # expectations for B2 (enrolled after B2)
                for item in ('on the memory tests', 'on the reasoning puzzles', 'in everyday concentration'):
                    page.locator('#hf-screen fieldset', has_text=item).first.locator('label', has_text='6').first.click()
                page.locator('#hf-screen button', has_text='Save answers').click()
                page.wait_for_timeout(200)
                ex = events(page, 'study-expect')
                c.ok(len(ex) == 1 and ex[0]['when'] == 'B2' and ex[0]['values'] == {'memory': 6, 'reasoning': 6, 'everyday': 6}, f'{name}: study-expect event ({ex})')
                # export before Post: salt hidden
                page.locator('#hf-screen button', has_text='Prepare the export').click()
                page.wait_for_timeout(300)
                j = json.loads(page.evaluate("document.querySelector('.hf-export .hf-copy__area').value"))
                c.eq(j['study']['commitment'], d['commitment'], f'{name}: export carries the commitment')
                c.ok(j['study']['salt'] is None and j['study']['saltRevealed'] is False, f'{name}: salt not in the export before the Post-test')
                c.eq(j['study']['template'], 'cao', f'{name}: export carries the template')
                page.locator('#hf-screen .hf-export label', has_text='Lab trials (CSV)').click()
                page.wait_for_timeout(100)
                c.ok(page.evaluate("document.querySelector('.hf-export .hf-copy__area').value").startswith('visit_id,kind,test'), f'{name}: CSV trials table')
                c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: no horizontal overflow')
                # after a Post-test the salt is revealed (screen + export) and checks out
                page.evaluate(SEED_JS, {'visits': [{'kind': 'POST', 'daysAgo': 0, 'scores': {'lab.nback': 2.0}}]})
                page.evaluate("HF.router.go('study')")
                page.wait_for_timeout(200)
                c.ok(page.evaluate("!!document.querySelector('.hf-st-code')") and d['salt'] in page.evaluate("document.getElementById('hf-screen').textContent"), f'{name}: salt revealed after the Post-test')
                page.locator('#hf-screen button', has_text='Prepare the export').click()
                page.wait_for_timeout(300)
                j = json.loads(page.evaluate("document.querySelector('.hf-export .hf-copy__area').value"))
                c.ok(j['study']['salt'] == d['salt'] and j['study']['verified'] is True, f'{name}: export reveals the salt after the Post-test and verifies')
                txt = page.evaluate("document.getElementById('hf-screen').innerText")
                c.ok('Questions still to answer' in txt and 'designed to train working memory' in txt, f'{name}: missing Post questions offered')
                page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-after-post.png'), full_page=True)
                # QA: leave the study (confirm dialog; cancel keeps it)
                page.locator('#hf-screen button', has_text='Leave the study').click()
                page.wait_for_selector('dialog.hf-modal[open]')
                dlg = page.evaluate("document.querySelector('dialog.hf-modal[open]').innerText")
                c.ok('training style' in dlg and 'date you left' in dlg, f'{name}: the leave dialog explains what happens')
                page.locator('dialog.hf-modal[open] button', has_text='Stay in the study').click()
                page.wait_for_timeout(200)
                c.eq(events(page, 'study-leave'), [], f'{name}: "Stay in the study" writes nothing')
                page.locator('#hf-screen button', has_text='Leave the study').click()
                page.wait_for_selector('dialog.hf-modal[open]')
                page.locator('dialog.hf-modal[open] button', has_text='Leave the study').click()
                page.wait_for_timeout(300)
                lv = events(page, 'study-leave')
                c.ok(len(lv) == 1 and lv[0]['t'] and lv[0]['id'], f'{name}: study-leave event ({lv})')
                txt = screen_text(page)
                c.ok('You left the study' in txt and 'Leave the study' not in txt and 'Questions still to answer' not in txt, f'{name}: the screen shows the date left, no programme tasks')
                st = page.evaluate("HF.study.state(HF.store.records)")
                c.ok(st['left'] == lv[0]['t'] and st['arm'] == d['arm'], f'{name}: state keeps the arm and the date left')
                dv = page.evaluate("HF.store.derived.study")
                c.ok(dv and dv.get('left') == lv[0]['t'], f'{name}: derive marks the study as left ({dv})')
                page.locator('#hf-screen button', has_text='Prepare the export').click()
                page.wait_for_timeout(300)
                j = json.loads(page.evaluate("document.querySelector('.hf-export .hf-copy__area').value"))
                c.ok(j['study']['leftAt'] and j['study']['arm'] == d['arm'] and j['study']['codePostedAt'], f'{name}: the export shows the date left ({j["study"].get("leftAt")})')
                page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-left.png'), full_page=True)
                page.evaluate("HF.router.go('lab')")
                page.wait_for_timeout(200)
                c.ok('You left the study on' in screen_text(page), f'{name}: the Lab home says the study was left')

            # coordinator-code path
            reset_store(page)
            page.evaluate(SEED_JS, {'visits': BASELINES})
            page.evaluate("HF.router.go('study')")
            page.wait_for_timeout(200)
            page.locator('label[for=st-adult]').click()
            page.locator('label[for=st-agree]').click()
            page.locator('#hf-screen button', has_text='Join the study').click()
            page.wait_for_timeout(200)
            page.fill('#st-code', 'ABC-123')
            page.locator('#hf-screen button', has_text='Use this code').click()
            page.wait_for_timeout(150)
            msg = page.evaluate("document.getElementById('hf-screen').innerText")
            c.ok('One character looks wrong' in msg or 'six letters' in msg, f'{name}: a bad code is refused in plain words')
            code = page.evaluate("HF.study.encodeCode('search', 'participant-7')")
            page.fill('#st-code', '')
            page.locator('#st-code').type(code.lower())
            page.keyboard.press('Enter')
            page.wait_for_timeout(250)
            ce = events(page, 'study-code')
            c.ok(len(ce) == 1 and ce[0]['arm'] == 'search', f'{name}: study-code event sets the programme ({ce})')
            st = page.evaluate("HF.study.state(HF.store.records)")
            c.ok(st['arm'] == 'search' and st['method'] == 'code' and st['armLabel'] == 'Programme B', f'{name}: state from the code ({st["arm"]}, {st["method"]})')
            c.ok(page.evaluate("HF.ui.study.PLAN_TEXT.search") in screen_text(page), f'{name}: a coordinator code shows the programme at once')
            page.screenshot(path=os.path.join(OUT_DIR, f'study-{name}-code.png'), full_page=True)
            # coordinator tools
            page.locator('#hf-screen summary', has_text='For coordinators').click()
            page.fill('#st-alloc-seed', 'our private phrase 42')
            page.fill('#st-alloc-n', '8')
            page.locator('#hf-screen button', has_text='Make codes').click()
            page.wait_for_timeout(200)
            lines = page.evaluate("document.querySelectorAll('.hf-copy__area')[document.querySelectorAll('.hf-copy__area').length - 1].value").split('\n')
            c.ok(lines[0] == 'serial,code,programme' and len(lines) == 9, f'{name}: allocation list with 8 codes')
            ok_codes = page.evaluate("(ls) => ls.slice(1).every((l) => HF.study.decodeCode(l.split(',')[1]).ok)", lines)
            c.ok(ok_codes, f'{name}: every allocation code decodes')
            c.eq(page.evaluate(OVERFLOW_JS), 0, f'{name}: no horizontal overflow (coordinator tools)')
            c.eq([e for e in con.errors + con.page_errors if e not in boot], [], f'{name}: 0 console errors')
            ctx.close()
    res = c.result()
    write_json('lab-study.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
