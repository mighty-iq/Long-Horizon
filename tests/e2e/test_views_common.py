"""Shared helpers for the task-view e2e tests (test_views_*.py): Relations, Span, visual search.

Rules: Chromium only, ONE browser at a time, always closed (helpers.browser). Real key presses on desktop
configurations, real taps on the pads in phone configurations (touch context). Outputs: out/views/.
The page is tests/e2e/pages/views.html (VH harness: mount → run → result).
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib

from helpers import Check, Console, browser, file_url  # noqa: F401  (re-exported for the test files)

OUT = pathlib.Path(os.environ.get('HF_VIEWS_OUT', _HF_OUT + '/views'))

CONFIGS = [
    {'name': 'desktop-light', 'viewport': {'width': 1366, 'height': 768}, 'theme': 'light', 'touch': False, 'script': 'perfect'},
    {'name': 'desktop-dark', 'viewport': {'width': 1366, 'height': 768}, 'theme': 'dark', 'touch': False, 'script': 'imperfect'},
    {'name': 'phone-light', 'viewport': {'width': 390, 'height': 844}, 'theme': 'light', 'touch': True, 'script': 'imperfect'},
    {'name': 'phone-dark', 'viewport': {'width': 390, 'height': 844}, 'theme': 'dark', 'touch': True, 'script': 'perfect'},
]

KEY_OF = {'match': 'j', 'no': 'f', 'match2': 'k'}


def write_json(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2, default=str))
    return OUT / name


def open_page(b, cfg, query=''):
    """New context + page for one configuration; returns (context, page, console)."""
    ctx = b.new_context(viewport=cfg['viewport'], has_touch=cfg['touch'], is_mobile=cfg['touch'],
                        device_scale_factor=1)
    page = ctx.new_page()
    con = Console(page)
    q = 'theme=' + cfg['theme'] + (('&' + query) if query else '')
    page.goto(file_url('tests/e2e/pages/views.html') + '?' + q)
    page.wait_for_function('window.VH && window.HF && HF.views && HF.views.relations && HF.views.span && HF.views.vsearch')
    return ctx, page, con


def press(page, cfg, key):
    """One real answer: a key press on desktop, a tap on the pad (pointer events) on phones."""
    if cfg['touch']:
        page.tap('.hf-v__pads [data-key="%s"]' % key)
    else:
        page.keyboard.press(KEY_OF[key])


def wait_on(page, i, timeout=15000):
    """Wait until trial i is on screen (VH.on is set by the wrapped view.show)."""
    page.wait_for_function('i => VH.on === i', arg=i, timeout=timeout)


def wait_off(page, i, timeout=15000):
    page.wait_for_function('i => VH.on !== i', arg=i, timeout=timeout)


def ours(loaf, min_ms=30):
    """Long animation frames in which Long-Horizon scripts (/js/) ran for at least min_ms."""
    out = []
    for e in loaf or []:
        if sum(s['dur'] for s in e.get('scripts', []) if '/js/' in (s.get('src') or '')) >= min_ms:
            out.append(e)
    return out


def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def stream_expect(summary, pressed, voided):
    """Expected press-only SDT counts for a stream block, from the spec summary, the pressed trials and the voids."""
    voided = set(voided)
    targets = [i for i in summary['targets'] if i not in voided]
    non = [i for i in summary['nonTargets'] if i not in voided]
    lures = set(summary['lures'])
    pressed = set(pressed)
    return {
        'hits': sum(1 for i in targets if i in pressed),
        'misses': sum(1 for i in targets if i not in pressed),
        'fas': sum(1 for i in non if i in pressed),
        'crs': sum(1 for i in non if i not in pressed),
        'lureFas': sum(1 for i in non if i in pressed and i in lures),
    }


def layout_ok(c, page, label):
    """No page scrolling: the view, stimulus and pads fit the viewport (vertical and horizontal)."""
    lay = page.evaluate('VH.layout()')
    c.ok(lay['scrollH'] <= lay['clientH'] + 1, f"{label}: fits without vertical scrolling ({lay['scrollH']} > {lay['clientH']})")
    c.ok(lay['docScrollW'] <= lay['vw'] + 1, f"{label}: no horizontal overflow ({lay['docScrollW']} > {lay['vw']})")
    if lay.get('pads'):
        c.ok(lay['pads']['bottom'] <= lay['vh'] + 1, f"{label}: pads fully on screen (bottom {lay['pads']['bottom']:.0f} > {lay['vh']})")
    return lay
