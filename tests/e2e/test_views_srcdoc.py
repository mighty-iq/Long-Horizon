"""The task views inside a sandboxed preview: the views harness (tests/e2e/pages/views.html) with every script and
stylesheet inlined, as the srcdoc of an <iframe sandbox="allow-scripts"> (opaque origin, no storage, no same-origin
access). Plays a Relation Grid block, a Relation Stream block, a Span block and a visual-search block with real clicks on
the pads and the keypad inside the frame, checks the scorers' results, and expects 0 console errors.
Run: python3 tests/e2e/test_views_srcdoc.py
"""
import html
import re

from helpers import ROOT, Check, Console, browser, run_main
from test_views_common import OUT, write_json


def inline_page():
    src = (ROOT / 'tests' / 'e2e' / 'pages' / 'views.html').read_text()
    base = ROOT / 'tests' / 'e2e' / 'pages'

    def css(m):
        return '<style>\n' + (base / m.group(1)).resolve().read_text() + '\n</style>'

    def js(m):
        code = (base / m.group(1)).resolve().read_text().replace('</script', '<\\/script')
        return '<script>\n' + code + '\n</script>'
    src = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, src)
    src = re.sub(r'<script src="([^"]+)"></script>', js, src)
    return src


def run():
    c = Check('views-srcdoc')
    doc = inline_page()
    c.ok('<script src=' not in doc and 'href="../' not in doc, 'harness fully inlined')
    OUT.mkdir(parents=True, exist_ok=True)
    host = OUT / 'srcdoc-views-host.html'
    host.write_text('<!doctype html><html><head><meta charset="utf-8"><title>host</title></head><body style="margin:0">'
                    '<iframe id="f" title="Long-Horizon views preview" sandbox="allow-scripts" style="width:100vw;height:100vh;border:0" '
                    f'srcdoc="{html.escape(doc, quote=True)}"></iframe></body></html>')
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        page.set_default_timeout(15000)
        con = Console(page)
        page.goto(host.as_uri())
        page.wait_for_function("document.getElementById('f').contentWindow !== null")
        frame = next(f for f in page.frames if f != page.main_frame)
        frame.wait_for_function('window.VH && window.HF && HF.views && HF.views.span')
        c.ok(frame.evaluate("(() => { try { return !!window.localStorage && false; } catch (e) { return 'blocked'; } })()") == 'blocked',
             'storage is blocked in the sandboxed frame (opaque origin)')

        # Relation Grid: answer every array by clicking the pads
        s = frame.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.grid.T3', 'rung': 4, 'seed': 'srcdoc/grid'}})
        frame.evaluate('VH.run({ feedback: true })')
        for i, a in enumerate(s['answers']):
            frame.wait_for_function('i => VH.on === i', arg=i)
            frame.click('.hf-v__pads [data-key="%s"]' % a)
        res = frame.evaluate('VH.result()')
        voided = sum(1 for x in res['log']['answers'] if x['voided'])
        c.ok(res['score']['ba'] == 1.0 or voided, f"grid: all arrays answered right by clicks (BA {res['score']['ba']}, voided {voided})")
        c.ok(all(x['src'] == 'mouse' for x in res['log']['answers'] if x['response']), 'grid: pad clicks arrive as pointer input')

        # Relation Stream: click MATCH on every target change (fast pace)
        s = frame.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.stream', 'rung': 2, 'seed': 'srcdoc/stream', 'params': {'changeMs': 600}}})
        frame.evaluate('VH.run({})')
        for i in s['targets']:
            frame.wait_for_function('i => VH.on === i', arg=i)
            frame.click('.hf-v__pads [data-key="match"]')
        res = frame.evaluate('VH.result()')
        st = res['score']['streams']['main']
        c.eq((st['hits'] + st['misses'] == len([i for i in s['targets'] if i not in res['log']['voided']]), st['fas']), (True, 0),
             'stream: every target clicked, no false alarms')
        c.eq(st['misses'], 0, 'stream: no target missed')

        # Span: judgements by pad clicks, recall on the keypad
        s = frame.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.sym', 'rung': 0, 'seed': 'srcdoc/span'}, 'patch': {'procLimitMs': 3000}})
        frame.evaluate('VH.run({})')
        last = ''
        for _ in range(60):
            frame.wait_for_function("""k => { if (VH.finished) return true; const s = VH.spanNow();
                if (s.t === 'recall') return k !== 'recall:' + s.list; if (s.t === 'judge') return k !== 'judge:' + s.list + ':' + s.k; return false; }""", arg=last)
            if frame.evaluate('VH.finished'):
                break
            stt = frame.evaluate('VH.spanNow()')
            if stt['t'] == 'judge':
                last = 'judge:%d:%d' % (stt['list'], stt['k'])
                frame.click('.hf-v__pads [data-key="%s"]' % ('match' if stt['correct'] else 'no'))
            else:
                last = 'recall:%d' % stt['list']
                for sym in stt['expected']:
                    frame.click('.hf-sp__key[data-sym="%s"]' % sym)
                frame.click('.hf-sp__act[data-act="done"]')
        res = frame.evaluate('VH.result()')
        ex = res['score']['extra']
        c.eq((ex['recall'], ex['procAcc']), (1.0, 1.0), 'span: perfect recall and judgements by clicks')
        c.ok(res['busyAfter'] is False, 'span: busy cleared')

        # visual search
        s = frame.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'vs.search', 'rung': 13, 'seed': 'srcdoc/vs'}})
        frame.evaluate('VH.run({})')
        for i, a in enumerate(s['answers']):
            frame.wait_for_function('i => VH.on === i', arg=i)
            frame.click('.hf-v__pads [data-key="%s"]' % a)
        res = frame.evaluate('VH.result()')
        voided = sum(1 for x in res['log']['answers'] if x['voided'])
        c.ok(res['score']['ba'] == 1.0 or voided, f"visual search: all displays answered right (BA {res['score']['ba']})")
        page.screenshot(path=str(OUT / 'srcdoc-vsearch-desktop.png'))
        errs = con.summary()
        c.eq(errs['errors'] + errs['page_errors'], [], '0 console errors in the sandboxed frame')
    write_json('srcdoc.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
