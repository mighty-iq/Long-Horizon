"""(b) index.html from file:// loads with 0 console errors; core DOM layer checks with real keys and clicks:
modal focus trap / Escape closes the top dialog only / focus returns to the opener; confirm(); toast; in-memory
router (data-go and stray #/ links never navigate); logical keys and pads; audio unlock in a real click
(tones + decoded letter clips); store persistent on file://.
Run: python3 tests/e2e/test_core_index.py
"""
from helpers import Check, Console, browser, close_modals, file_url, run_main, write_json


def run():
    c = Check('core-index')
    with browser() as b:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        page = ctx.new_page()
        con = Console(page)
        url = file_url('index.html')
        page.goto(url)
        page.wait_for_function('window.HF && HF.booted === true', timeout=10000)
        page.wait_for_timeout(500)
        c.eq(con.errors + con.page_errors, [], 'index.html loads with no console or page errors')
        c.details['boot_console'] = con.summary()
        c.ok(page.evaluate('HF.store.persistent') is True, 'store persistent on file://')
        c.eq(page.evaluate('HF.pwa.state + ":" + HF.pwa.reason'), 'off:file', 'no service worker on file://')
        c.eq(page.evaluate('HF.env.inApp'), None, 'desktop Chrome is not an in-app browser')
        start = page.evaluate("HF.router.current && HF.router.current.name")
        c.ok(bool(start) and page.evaluate('n => HF.router.has(n)', start), f'router started on a registered route ({start})')
        c.details['start_route'] = start
        c.ok(page.evaluate("!!document.querySelector('#hf-screen h1')"), 'a screen rendered into #hf-screen')
        c.eq(page.evaluate("document.querySelectorAll('#hf-toasts').length"), 1, 'exactly one #hf-toasts')
        c.eq(page.evaluate("document.querySelectorAll('#hf-screen').length"), 1, 'exactly one #hf-screen')
        c.details['launch_modals'] = page.evaluate('HF.dom.openModals()')
        close_modals(page)

        # ---------- modal: focus trap, nested Escape, focus return ----------
        page.evaluate("""() => {
          const b = HF.dom.el('button', { id: 'opener', type: 'button' }, 'Open');
          document.getElementById('hf-screen').appendChild(b);
          b.addEventListener('click', () => {
            window.m1 = HF.dom.modal([HF.dom.el('p', null, 'First'), HF.dom.el('button', { id: 'm1a', type: 'button' }, 'A'),
              HF.dom.el('button', { id: 'm1b', type: 'button', onclick: () => {
                window.m2 = HF.dom.modal(HF.dom.el('button', { id: 'm2a', type: 'button' }, 'Inner'), { title: 'Second' });
              } }, 'Open second')], { title: 'First dialog' });
          });
        }""")
        page.click('#opener')
        c.eq(page.evaluate('document.activeElement.id'), 'm1a', 'initial focus inside the dialog')
        ids = []
        for _ in range(5):
            page.keyboard.press('Tab')
            ids.append(page.evaluate('document.activeElement.id'))
        c.ok(all(i in ('m1a', 'm1b') for i in ids), f'Tab stays inside the dialog: {ids}')
        page.keyboard.press('Shift+Tab')
        c.ok(page.evaluate('document.activeElement.id') in ('m1a', 'm1b'), 'Shift+Tab stays inside')
        page.click('#m1b')
        c.eq(page.evaluate('HF.dom.openModals()'), 2, 'nested dialog open')
        c.eq(page.evaluate('document.activeElement.id'), 'm2a', 'focus in the nested dialog')
        events = page.evaluate("() => { window.keyLog = []; HF.input.on(e => keyLog.push(e.key)); return true; }")
        page.keyboard.press('Escape')
        c.eq(page.evaluate('HF.dom.openModals()'), 1, 'Escape closes the top dialog only')
        c.eq(page.evaluate('document.activeElement.id'), 'm1b', 'focus back on the nested opener')
        page.keyboard.press('Escape')
        c.eq(page.evaluate('HF.dom.openModals()'), 0, 'second Escape closes the first dialog')
        c.eq(page.evaluate('document.activeElement.id'), 'opener', 'focus returned to the opener')
        c.eq(page.evaluate('keyLog'), [], 'Escape in dialogs never reaches the key handlers')
        c.eq(page.evaluate("document.querySelectorAll('dialog').length"), 0, 'closed dialogs removed')

        # ---------- initial focus: data-autofocus wins; a native autofocus attribute is converted ----------
        page.evaluate("""() => { window.m3 = HF.dom.modal([HF.dom.el('button', { id: 'af1', type: 'button' }, 'first'),
          HF.dom.el('button', { id: 'af2', type: 'button', 'data-autofocus': '' }, 'second')], { title: 'Focus' }); return true; }""")
        c.eq(page.evaluate('document.activeElement.id'), 'af2', 'data-autofocus gets initial focus')
        page.keyboard.press('Escape')
        page.evaluate("""() => { window.m4 = HF.dom.modal([HF.dom.el('button', { id: 'nf1', type: 'button' }, 'first'),
          HF.dom.el('button', { id: 'nf2', type: 'button', autofocus: true }, 'second')], { title: 'Native' }); return true; }""")
        c.eq(page.evaluate('document.activeElement.id'), 'nf2', 'native autofocus element still gets initial focus')
        c.ok(page.evaluate("!document.querySelector('dialog [autofocus]') && !!document.querySelector('#nf2[data-autofocus]')"), 'native autofocus converted to data-autofocus')
        page.keyboard.press('Escape')
        c.eq(page.evaluate('HF.dom.openModals()'), 0, 'focus-test dialogs closed')

        # ---------- confirm ----------
        page.evaluate("() => { window.cf = HF.dom.confirm('Delete everything?', { ok: 'Delete', danger: true, title: 'Reset' }); return true; }")
        c.eq(page.evaluate('document.activeElement.textContent'), 'Cancel', 'danger confirm focuses Cancel')
        page.keyboard.press('Escape')
        c.ok(page.evaluate('cf') is False, 'Escape → false')
        page.evaluate("() => { window.cf = HF.dom.confirm('Continue?'); return true; }")
        page.click('dialog.hf-modal .hf-btn--primary')
        c.ok(page.evaluate('cf') is True, 'OK → true')
        c.ok(page.evaluate("typeof window.confirm === 'function'"), 'window.confirm untouched (never called)')

        # ---------- PQ-01: a [data-autofocus] control keeps its place in the Tab order and its focus ring ----------
        welcome_af = page.evaluate("(() => { const b = document.querySelector('#hf-screen [data-autofocus]'); return b ? [b.tagName, b.getAttribute('tabindex')] : null; })()")
        c.details['start_screen_autofocus'] = welcome_af
        if welcome_af and welcome_af[0] in ('BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'):
            c.ok(welcome_af[1] != '-1', f'start screen: the autofocus control is not taken out of the Tab order ({welcome_af})')
        page.evaluate("""() => { HF.router.register('afprobe', { title: 'AF', render: root => {
            root.appendChild(HF.dom.el('h1', null, 'Autofocus probe'));
            root.appendChild(HF.dom.el('button', { id: 'af-first', type: 'button' }, 'First'));
            root.appendChild(HF.dom.el('button', { id: 'af-go', type: 'button', 'data-autofocus': '' }, 'Go'));
            root.appendChild(HF.dom.el('button', { id: 'af-last', type: 'button' }, 'Last')); } });
          HF.router.register('h1probe', { title: 'H1', render: root => root.appendChild(HF.dom.el('h1', { id: 'h1p' }, 'Heading probe')) });
          HF.router.go('afprobe'); return true; }""")
        c.eq(page.evaluate('document.activeElement.id'), 'af-go', 'router focuses the [data-autofocus] button')
        c.eq(page.evaluate("document.getElementById('af-go').getAttribute('tabindex')"), None, 'no tabindex added to a button')
        page.keyboard.press('Tab')
        c.eq(page.evaluate('document.activeElement.id'), 'af-last', 'Tab moves on from it')
        page.keyboard.press('Shift+Tab')
        c.eq(page.evaluate('document.activeElement.id'), 'af-go', 'Tab order comes back to it')
        ring = page.evaluate("(() => { const s = getComputedStyle(document.getElementById('af-go')); return [s.outlineStyle, s.outlineWidth]; })()")
        c.ok(ring[0] != 'none' and ring[1] not in ('0px', ''), f'visible focus ring on the button: {ring}')
        page.evaluate("HF.router.go('h1probe')")
        c.eq(page.evaluate("[document.activeElement.id, document.activeElement.getAttribute('tabindex')]"), ['h1p', '-1'], 'a heading still gets tabindex -1')

        # ---------- PQ-07: the execCommand copy fallback gives focus back ----------
        page.evaluate("() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined }); return true; }")
        page.evaluate("""() => { window.m5 = HF.dom.modal([HF.dom.el('p', null, 'Share'),
          HF.dom.el('button', { id: 'cp-done', type: 'button', 'data-autofocus': '' }, 'Done')], { title: 'Copy probe' }); return true; }""")
        c.eq(page.evaluate('document.activeElement.id'), 'cp-done', 'dialog control focused before the copy')
        res = page.evaluate("HF.dom.copyText('hello').then(ok => ({ ok: ok, id: document.activeElement.id }))")
        c.eq(res['id'], 'cp-done', f'focus stays on the dialog control after the fallback copy ({res})')
        page.keyboard.press('Escape')
        page.evaluate("() => { const b = HF.dom.el('button', { id: 'cp-page', type: 'button' }, 'Copy'); document.getElementById('hf-screen').appendChild(b); b.focus(); return true; }")
        res = page.evaluate("HF.dom.copyText('again').then(ok => ({ ok: ok, id: document.activeElement.id }))")
        c.eq(res['id'], 'cp-page', 'focus stays on a page control after the fallback copy')
        page.evaluate("() => { delete navigator.clipboard; return true; }")

        # ---------- toast ----------
        page.evaluate("HF.dom.toast('Saved', { timeout: 2000 })")
        c.ok(page.evaluate("[...document.querySelectorAll('#hf-toasts .hf-toast')].some(t => t.textContent.includes('Saved'))"), 'toast shown in #hf-toasts')
        c.eq(page.evaluate("document.getElementById('hf-toasts').getAttribute('role')"), 'status', '#hf-toasts has role=status')

        # ---------- router ----------
        page.evaluate("""() => {
          HF.router.register('probe', { title: 'Probe', render: (root, p) => root.appendChild(HF.dom.el('h1', { id: 'probe-h' }, 'Probe ' + (p.x || ''))) , leave: () => { window.left = (window.left || 0) + 1; } });
          HF.router.register('probe2', { title: 'Probe 2', render: root => root.appendChild(HF.dom.el('h1', { id: 'probe2-h' }, 'Probe 2')) });
          const s = document.getElementById('hf-screen');
          s.appendChild(HF.dom.el('button', { id: 'go-probe', type: 'button', 'data-go': 'probe', 'data-params': '{"x":"7"}' }, 'probe'));
        }""")
        page.click('#go-probe')
        c.eq(page.evaluate("document.getElementById('probe-h') && document.getElementById('probe-h').textContent"), 'Probe 7', 'data-go renders the route with params')
        c.eq(page.evaluate('document.title'), 'Probe · Long-Horizon', 'document title set')
        c.eq(page.evaluate('document.activeElement.id'), 'probe-h', 'focus moves to the screen heading')
        c.ok(page.url.endswith('#/probe'), 'hash mirrors the route on file://')
        page.evaluate("document.getElementById('hf-screen').appendChild(HF.dom.el('a', { id: 'hash-link', href: '#/probe2' }, 'probe 2'))")
        page.click('#hash-link')
        c.eq(page.evaluate('HF.router.current.name'), 'probe2', 'a stray #/ link is routed in memory')
        c.eq(page.evaluate('window.left'), 1, 'leave() called on the old screen')
        c.ok(page.evaluate('HF.router.back()') is True and page.evaluate('HF.router.current.name') == 'probe', 'back() returns to the previous route')
        page.evaluate("HF.router.go('today')")

        # ---------- input ----------
        close_modals(page)
        page.evaluate("() => { window.keyLog = []; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; }")
        page.keyboard.press('j')
        page.keyboard.press('k')
        page.keyboard.press('f')
        page.keyboard.press('Space')
        page.evaluate("document.getElementById('hf-screen').appendChild(HF.dom.el('button', { type: 'button', 'data-key': 'match', id: 'pad' }, 'Match'))")
        page.click('#pad')
        c.eq(page.evaluate('keyLog'), ['match', 'match2', 'no', 'next', 'match'], 'logical keys from J K F Space and a pad')
        c.eq(page.evaluate("HF.input.labelFor('match')"), 'J', 'key label for rule cards')

        # ---------- audio: unlock in a real click ----------
        c.eq(page.evaluate('HF.audio.state()'), 'none', 'no AudioContext before a gesture')
        page.evaluate("""() => { const b = HF.dom.el('button', { id: 'start', type: 'button' }, 'Start');
          b.addEventListener('click', () => { window.unl = HF.audio.unlock(); });
          document.getElementById('hf-screen').appendChild(b); }""")
        page.click('#start')
        unl = page.evaluate('unl')
        c.ok(unl['ok'] and unl['state'] == 'running', f'audio running after the click: {unl}')
        c.eq(unl['clips'], 8 if page.evaluate('HF.audio.hasClips()') else 0, 'letter clips decoded at unlock')
        c.eq(sorted(page.evaluate('HF.audio.clipIds()')), ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'], 'clips C H K L Q R S T')
        tone = page.evaluate('HF.audio.tone(3, HF.audio.now() + 0.05)')
        c.ok(tone and abs(tone['freq'] - 493.88) < 0.1, f'tone 3 = B4 493.9 Hz: {tone}')
        clip = page.evaluate("HF.audio.clip('Q', HF.audio.now() + 0.05)")
        c.ok(clip and 0.3 < clip['duration'] < 0.7, f'clip Q schedulable: {clip}')
        c.ok(page.evaluate('typeof HF.audio.atPerf(performance.now() + 100)') == 'number', 'perf → audio clock mapping')
        lat = page.evaluate('HF.audio.latency()')
        c.ok(lat['state'] == 'running' and lat['sampleRate'] > 0, f'latency report: {lat}')
        c.details['audio'] = {'unlock': unl, 'tone': tone, 'clip': clip, 'latency': lat}

        page.wait_for_timeout(300)
        c.details['console'] = con.summary()
        c.eq(con.errors + con.page_errors, [], 'no console or page errors after the checks')
        ctx.close()
    write_json('index.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
