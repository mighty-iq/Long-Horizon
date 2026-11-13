"""Lab item views e2e (Chromium): matrix, graph and series answering with real keys and taps, and pause / resume
during a discrete test: by Escape, by a hidden page, by Escape inside the answer field; the item in progress is
voided, the run continues, a second pause reason keeps the first pause; the core custom flow (HF.timing.custom) sets
busy / html[data-busy] while items run and releases it when paused and at the end. Views are mounted straight from HF.views['lab.*'] with the real generated specs (first items only);
the logs they return are scored with the tests' own scorers.
Run: python3 tests/e2e/test_lab_items.py
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, browser, run_main, write_json
from test_lab_visit import OUT_DIR, open_app

MOUNT_JS = r"""([id, n, form, phone]) => {
  const screen = document.getElementById('hf-screen');
  while (screen.firstChild) screen.removeChild(screen.firstChild);
  const t = HF.lab.tests[id];
  const spec = t.gen({ form: form || 'A' });
  spec.trials = spec.trials.slice(0, n);
  const host = document.createElement('div');
  host.id = 'item-host';
  screen.appendChild(host);
  window.__spec = spec;
  window.__log = null;
  window.__view = HF.views[id].create(host, spec, { feedback: 'none', title: t.label });
  window.__view.run({ timing: HF.timing, input: HF.input }).then((log) => { window.__log = log; });
  return spec.trials.map((x) => x.answer);
}"""


def wait_ready(page, sel, timeout=8000):
    page.wait_for_function(f"""() => {{ const w = document.querySelector('{sel}'); return !!w && w.style.visibility !== 'hidden'; }}""", timeout=timeout)


def item_index(page, word):
    return page.evaluate(f"""() => {{ const p = document.querySelector('.hf-lt__progress'); const m = /{word} (\\d+) of/.exec(p ? p.textContent : ''); return m ? +m[1] : null; }}""")


def wait_index(page, word, k, timeout=8000):
    page.wait_for_function(f"""() => {{ const p = document.querySelector('.hf-lt__progress'); const m = /{word} (\\d+) of/.exec(p ? p.textContent : '');
      const w = document.querySelector('.hf-mx__wrap, .hf-sr, .hf-gm'); return m && +m[1] === {k} && !!w && w.style.visibility !== 'hidden'; }}""", timeout=timeout)


def finish(page, timeout=10000):
    page.wait_for_function('window.__log !== null', timeout=timeout)
    return page.evaluate('window.__log')


def run():
    c = Check('lab-items')
    with browser() as b:
        for (w, h, name) in [(1366, 768, 'desktop'), (390, 844, 'phone')]:
            ctx, page, con = open_app(b, w, h)
            # ---------------- matrix: keys, taps, confirm, double tap ----------------
            answers = page.evaluate(MOUNT_JS, ['lab.matrix', 3, 'A', name == 'phone'])
            wait_index(page, 'Puzzle', 1)
            page.screenshot(path=os.path.join(OUT_DIR, f'items-{name}-matrix.png'))
            ov = page.evaluate("() => { const r = document.querySelector('.hf-mx__opts').getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }")
            c.ok(ov['bottom'] <= ov['vh'] + 1, f'{name}: matrix options fit in the viewport ({ov})')
            c.eq(ov['sw'], 0, f'{name}: matrix no horizontal overflow')
            page.keyboard.press('Digit3')
            c.eq(page.evaluate("document.querySelector('.hf-mx__opt[data-opt=\"2\"]').getAttribute('aria-pressed')"), 'true', f'{name}: key 3 selects option 3')
            page.keyboard.press('Enter')
            wait_index(page, 'Puzzle', 2)
            page.locator('.hf-mx__opt[data-opt="4"]').click()
            page.locator('.hf-mx__confirm').click()
            wait_index(page, 'Puzzle', 3)
            page.keyboard.press('Digit1')
            page.locator('.hf-mx__opt[data-opt="5"]').click()
            page.locator('.hf-mx__opt[data-opt="5"]').click()
            log = finish(page)
            resp = [a['response'] for a in log['answers']]
            c.eq(resp, [2, 4, 5], f'{name}: matrix responses from key, tap+Confirm, double tap')
            c.ok(all(a['rt'] and a['rt'] > 0 and not a['timedOut'] and not a['voided'] for a in log['answers']), f'{name}: matrix RTs logged, nothing voided')
            sc = page.evaluate("HF.lab.tests['lab.matrix'].score(window.__spec, window.__log)")
            c.eq(sc['sub']['n'], 3, f'{name}: matrix scorer reads the log')
            exp_correct = sum(1 for r, a in zip(resp, answers) if r == a)
            c.eq(sc['sub']['correct'], exp_correct, f'{name}: matrix scorer counts the right answers')

            # ---------------- series: accepted formats, refusal of a bad format ----------------
            answers = page.evaluate(MOUNT_JS, ['lab.series', 3, 'A', name == 'phone'])
            kinds = page.evaluate("window.__spec.trials.map((t) => t.stim.kind)")
            wait_index(page, 'Series', 1)
            page.screenshot(path=os.path.join(OUT_DIR, f'items-{name}-series.png'))
            for k in range(3):
                wait_index(page, 'Series', k + 1)
                ans = str(answers[k])
                if kinds[k] == 'number':
                    page.keyboard.type('-' + ans)
                    page.keyboard.press('Enter')
                    page.wait_for_timeout(150)
                    msg = page.evaluate("document.querySelector('.hf-lt__msg').textContent")
                    c.ok('whole number' in msg, f'{name}: a negative number is refused with a hint ({msg})')
                    c.eq(item_index(page, 'Series'), k + 1, f'{name}: refused answer is not sent')
                    page.fill('.hf-sr__input', '')
                    page.keyboard.type(' 00' + ans + '.0 ')
                else:
                    page.keyboard.type(ans.lower() + '.')
                page.keyboard.press('Enter')
            log = finish(page)
            sc = page.evaluate("HF.lab.tests['lab.series'].score(window.__spec, window.__log)")
            c.eq(sc['sub']['correct'], 3, f'{name}: series accepts " 007.0 " style numbers and lower-case letters (score {sc["scoreLabel"]})')

            # ---------------- graph: letters, taps, change before Confirm ----------------
            answers = page.evaluate(MOUNT_JS, ['lab.graph', 3, 'A', name == 'phone'])
            wait_index(page, 'Item', 1)
            page.screenshot(path=os.path.join(OUT_DIR, f'items-{name}-graph.png'))
            gfit = page.evaluate("() => { const r = document.querySelector('.hf-gm__controls').getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight }; }")
            c.ok(gfit['bottom'] <= gfit['vh'] + 1, f'{name}: graph controls fit in the viewport ({gfit})')
            letters = page.evaluate("""() => window.__spec.trials.map((t) => { const ord = HF.views['lab.graph'].readingOrder(t.stim.right.nodes);
              const L = 'ABCDEFGHJK', m = {}; ord.forEach((n, j) => { m[n.id] = L[j]; }); return t.answer.map((id) => m[id]); })""")
            for L in letters[0]:
                page.keyboard.press('Key' + L)
            page.keyboard.press('Enter')
            wait_index(page, 'Item', 2)
            for nid in answers[1]:
                page.locator(f'.hf-gm__svg--right [data-node="{nid}"]').click()
            page.locator('.hf-gm__controls .hf-btn--primary').click()
            wait_index(page, 'Item', 3)
            wrong = [n for n in page.evaluate("window.__spec.trials[2].stim.right.nodes.map((n) => n.id)") if n not in answers[2]][0]
            page.locator(f'.hf-gm__svg--right [data-node="{wrong}"]').click()   # 1 → wrong dot
            page.locator(f'.hf-gm__svg--right [data-node="{answers[2][1]}"]').click()   # 2 → right dot
            page.locator('.hf-gm__chip--1').click()   # back to mark 1
            page.locator(f'.hf-gm__svg--right [data-node="{answers[2][0]}"]').click()   # 1 → right dot
            chips = page.evaluate("Array.from(document.querySelectorAll('.hf-gm__chipval')).map((e) => e.textContent)")
            c.eq(chips, letters[2], f'{name}: graph choices can be changed before Confirm')
            page.screenshot(path=os.path.join(OUT_DIR, f'items-{name}-graph-picked.png'))
            page.keyboard.press('Enter')
            log = finish(page)
            c.eq([a['response'] for a in log['answers']], answers, f'{name}: graph responses are the right-hand node ids')
            sc = page.evaluate("HF.lab.tests['lab.graph'].score(window.__spec, window.__log)")
            c.eq(sc['score'], 1, f'{name}: graph scorer: all 3 right')

            # ---------------- pause and resume during a discrete test (matrix) ----------------
            answers = page.evaluate(MOUNT_JS, ['lab.matrix', 4, 'B', name == 'phone'])
            wait_index(page, 'Puzzle', 1)
            page.keyboard.press('Digit2')
            page.keyboard.press('Enter')
            wait_index(page, 'Puzzle', 2)
            page.keyboard.press('Digit4')       # chosen, not confirmed
            busy = page.evaluate("[HF.timing.busy, document.documentElement.hasAttribute('data-busy'), HF.timing.state]")
            c.eq(busy, [True, True, 'running'], f'{name}: the custom flow (HF.timing.custom) marks the page busy while an item runs')
            page.keyboard.press('Escape')       # pause: the item in progress is voided
            page.wait_for_selector('dialog.hf-modal[open]')
            c.eq(page.evaluate("document.querySelector('dialog.hf-modal[open] .hf-modal__title').textContent"), 'Paused', f'{name}: pause dialog opens on Escape')
            # a second pause reason (page hidden) while paused keeps the first pause
            page.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
              document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; }""")
            page.screenshot(path=os.path.join(OUT_DIR, f'items-{name}-paused.png'))
            c.eq(page.evaluate("[HF.timing.busy, HF.timing.state]"), [False, 'paused'], f'{name}: not busy while paused')
            page.locator('dialog.hf-modal[open] button', has_text='Resume').click()
            wait_index(page, 'Puzzle', 3)
            page.keyboard.press('Digit1')
            page.keyboard.press('Enter')
            wait_index(page, 'Puzzle', 4)
            page.keyboard.press('Digit8')
            page.keyboard.press('Enter')
            log = finish(page)
            c.eq([a['i'] for a in log['answers']], [0, 1, 2, 3], f'{name}: every item logged once after the pause')
            c.eq([bool(a.get('voided')) for a in log['answers']], [False, True, False, False], f'{name}: only the paused item is voided')
            c.ok(log['paused'] and len(log['pauses']) == 1 and log['pauses'][0]['reasons'] == ['key', 'hidden'], f'{name}: one pause, second reason appended ({log["pauses"]})')
            c.ok(log['pauses'][0]['end'] is not None and log['pauses'][0]['end'] >= log['pauses'][0]['start'], f'{name}: pause has an end')
            sc = page.evaluate("HF.lab.tests['lab.matrix'].score(window.__spec, window.__log)")
            c.eq(sc['sub']['voided'], 1, f'{name}: scorer excludes the voided item')
            c.eq(page.evaluate("[HF.timing.busy, HF.timing.state, document.documentElement.hasAttribute('data-busy')]"), [False, 'idle', False], f'{name}: busy released when the test ends')

            # ---------------- pause by a hidden page, and by Escape inside a text field (series) ----------------
            answers = page.evaluate(MOUNT_JS, ['lab.series', 3, 'B', name == 'phone'])
            wait_index(page, 'Series', 1)
            page.keyboard.type('12')
            page.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
              document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; }""")
            page.wait_for_selector('dialog.hf-modal[open]')
            c.ok(True, f'{name}: a hidden page pauses the test')
            page.locator('dialog.hf-modal[open] button', has_text='Resume').click()
            wait_index(page, 'Series', 2)
            page.locator('.hf-sr__input').click()
            page.keyboard.type('3')
            page.keyboard.press('Escape')       # inside the text field: HF.input ignores it, the session pauses
            page.wait_for_selector('dialog.hf-modal[open]')
            c.ok(True, f'{name}: Escape inside the answer field pauses')
            page.keyboard.press('Escape')       # Escape in the dialog = Resume
            wait_index(page, 'Series', 3)
            kinds = page.evaluate("window.__spec.trials.map((t) => t.stim.kind)")
            page.keyboard.type(str(answers[2]).lower() if kinds[2] == 'letter' else str(answers[2]))
            page.keyboard.press('Enter')
            log = finish(page)
            c.eq([bool(a.get('voided')) for a in log['answers']], [True, True, False], f'{name}: both paused items voided, the third answered')
            c.eq([p['reasons'][0] for p in log['pauses']], ['hidden', 'key'], f'{name}: pause reasons hidden, then key ({log["pauses"]})')
            c.eq(con.errors + con.page_errors, [], f'{name}: 0 console errors')
            ctx.close()
    res = c.result()
    write_json('lab-items.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
