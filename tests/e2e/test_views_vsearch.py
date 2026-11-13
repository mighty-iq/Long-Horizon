"""Visual-search view (T among rotated Ls) through HF.timing.runDiscrete in four configurations (desktop 1366×768 and
phone 390×844, light and dark), with real key presses (desktop) and taps on the pads (phone). Checks:
- scripted perfect / imperfect answers (wrong answers and a timeout) → HF.tasks.vsearch.score counts and timeouts;
- an array ends at the answer or after exactly its window; displays painted in their frame;
- the field is ≥ spec.field.minFieldPx (360) CSS px wide, so items ≥ 25 px and strokes ≥ 3 px, also on a 360 px phone;
  set sizes 8 … 64; the fixation cross shows only between displays; layout fits without scrolling;
- pause voids only the display on screen and the block resumes; 0 console errors.
Run: python3 tests/e2e/test_views_vsearch.py [config ...]
"""
from helpers import run_main
from test_views_common import CONFIGS, Check, browser, close, layout_ok, open_page, ours, press, wait_off, wait_on, write_json

RUNG = {'desktop-light': 12, 'desktop-dark': 17, 'phone-light': 16, 'phone-dark': 0}

GEOM_JS = """() => {
  const f = VH.view.el.querySelector('.hf-vs'), r = f.getBoundingClientRect();
  const items = VH.view.el.querySelector('.hf-vs__items'), fix = VH.view.el.querySelector('.hf-vs__fix');
  const p = items.querySelector('path');
  return { w: r.width, h: r.height, left: r.left, right: r.right, vw: innerWidth,
           itemsVis: getComputedStyle(items).visibility, fixVis: getComputedStyle(fix).visibility,
           stroke: p ? parseFloat(getComputedStyle(p).strokeWidth) : null, n: items.children.length,
           minFieldPx: VH.spec.field.minFieldPx };
}"""


def geometry_checks(c, page, label):
    g = page.evaluate(GEOM_JS)
    unit = g['w'] / 100.0
    c.ok(g['w'] >= g['minFieldPx'] - 0.5, f"{label}: field ≥ {g['minFieldPx']} CSS px wide ({g['w']:.1f})")
    c.ok(7 * unit >= 25, f'{label}: items ≥ 25 px across ({7 * unit:.1f})')
    c.ok((g['stroke'] or 0) * unit >= 3, f"{label}: strokes ≥ 3 px ({(g['stroke'] or 0) * unit:.2f})")
    c.ok(g['left'] >= -0.5 and g['right'] <= g['vw'] + 0.5, f"{label}: field inside the screen ({g['left']:.1f}–{g['right']:.1f})")
    return g


def block(c, page, cfg, det):
    label = cfg['name'] + ' vsearch'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'vs.search', 'rung': RUNG[cfg['name']], 'seed': 'views/vs/' + cfg['name']}})
    layout_ok(c, page, label)
    answers = s['answers']
    script = list(answers)
    timeout_i = None
    if cfg['script'] == 'imperfect':
        p_idx = [i for i, a in enumerate(answers) if a == 'match']
        a_idx = [i for i, a in enumerate(answers) if a == 'no']
        script[p_idx[0]] = 'no'
        script[a_idx[0]] = 'match'
        timeout_i = p_idx[1]
        script[timeout_i] = None
    page.evaluate('VH.run({ feedback: true })')
    geo_on = geo_off = None
    for i, a in enumerate(script):
        wait_on(page, i)
        if geo_on is None:
            geo_on = geometry_checks(c, page, label)
            c.ok(geo_on['itemsVis'] == 'visible' and geo_on['fixVis'] == 'hidden', f'{label}: items shown, fixation hidden during a display')
            c.eq(geo_on['n'], page.evaluate('VH.spec.params.size'), f'{label}: every item drawn')
        if a is None:
            wait_off(page, i, timeout=8000)
        else:
            press(page, cfg, a)
        if geo_off is None and i == 2:
            wait_off(page, i)
            geo_off = page.evaluate(GEOM_JS)
            c.ok(geo_off['itemsVis'] == 'hidden' and geo_off['fixVis'] == 'visible', f'{label}: fixation cross between displays, items hidden')
    res = page.evaluate('VH.result()')
    log, sc = res['log'], res['score']
    c.ok(res['scoreError'] is None, f"{label}: scorer ran ({res['scoreError']})")
    voided = {a['i'] for a in log['answers'] if a['voided']}
    c.eq([a['response'] for a in log['answers']], script, f'{label}: every answer recorded on its display')
    exp = {'hits': 0, 'misses': 0, 'fas': 0, 'crs': 0}
    for i, a in enumerate(script):
        if i in voided:
            continue
        if answers[i] == 'match':
            exp['hits' if a == 'match' else 'misses'] += 1
        else:
            exp['crs' if a == 'no' else 'fas'] += 1
    c.eq({k: sc['streams']['main'][k] for k in exp}, exp, f'{label}: score counts ({cfg["script"]})')
    if timeout_i is not None and timeout_i not in voided:
        c.eq(sc['extra']['timeouts'], {'present': 1, 'absent': 0}, f'{label}: the timeout counted as a miss on a present display')
    if cfg['script'] == 'perfect' and not voided:
        c.eq(sc['ba'], 1.0, f'{label}: perfect script scores BA 1.0')
    iv = log['interval']
    late = [i for i in range(20) if log['shown'][i] - log['onsets'][i] > 1.5 * iv]
    c.ok(len(late) <= 2, f'{label}: displays painted in the frame they were shown ({late})')
    win = s['windowMs']
    ends, bad_end = [], []
    # the item hides on the first frame after the answer is handled; a frame stalled by the machine after an answer
    # is not flagged by the runner (nothing is charged), so allow the block's longest frame on top of 3 frames
    lag = max(3 * iv, iv + (log['frame']['maxMs'] or 0)) + 1
    for i, a in enumerate(log['answers']):
        dur = log['offsets'][i] - log['onsets'][i]
        if a['response'] is None and not a['voided']:
            ends.append(close(dur, win, iv + 0.05))
            if not ends[-1]:
                bad_end.append((i, None, round(dur, 1)))
        elif a['response'] is not None:
            ends.append(a['rt'] - iv - 0.5 <= dur <= a['rt'] + lag)   # frame timestamps may precede the event's
            if not ends[-1]:
                bad_end.append((i, a['rt'], round(dur, 1)))
    c.ok(all(ends), f'{label}: a display ends at the answer (next frame) or after exactly its window {bad_end}')
    c.ok(res['busyAfter'] is False and res['busyAttrAfter'] is False, f'{label}: busy cleared at the end')
    mine = ours(res['loaf'])
    c.ok(not mine, f'{label}: no long animation frame with ≥ 30 ms in Long-Horizon scripts ({len(mine)})')
    det[label] = {'ba': sc['ba'], 'voided': sorted(voided), 'late': late, 'size': s.get('n'), 'fieldPx': geo_on and round(geo_on['w'], 1)}


def pause_block(c, page, cfg, det):
    label = cfg['name'] + ' vsearch pause'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'vs.search', 'rung': 6, 'seed': 'views/vs/pause'}})
    page.evaluate('VH.run({})')
    for i in range(2):
        wait_on(page, i)
        press(page, cfg, s['answers'][i])
    wait_on(page, 2)
    if cfg['touch']:
        page.evaluate('VH.fakeHidden()')
    else:
        page.keyboard.press('Escape')
    page.wait_for_function("HF.timing.state === 'paused'")
    if cfg['touch']:
        page.evaluate('VH.fakeVisible()')
    c.ok(page.evaluate("document.querySelector('.hf-vs').classList.contains('is-off')"), f'{label}: display hidden while paused')
    page.evaluate('HF.timing.resume()')
    for i in range(3, 20):
        wait_on(page, i)
        press(page, cfg, s['answers'][i])
    res = page.evaluate('VH.result()')
    log, sc = res['log'], res['score']
    c.ok(log['answers'][2]['voided'], f'{label}: the display on screen at the pause is voided')
    c.eq((sc['nScorable'], sc['nVoided'], sc['ba']), (19, 1, 1.0), f'{label}: the rest scores normally')
    det[label] = {'pauses': log['pauses']}


def small_phone(c, b, det):
    """360 × 640: the field takes the full width (360 px), pads stay on screen."""
    cfg = {'name': 'phone-360', 'viewport': {'width': 360, 'height': 640}, 'theme': 'light', 'touch': True}
    ctx, page, con = open_page(b, cfg)
    try:
        for rung in (0, 12, 17):
            page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'vs.search', 'rung': rung, 'seed': 'views/vs/360'}})
            page.evaluate('VH.still(0)')
            label = f'phone-360 vsearch r{rung}'
            layout_ok(c, page, label)
            g = geometry_checks(c, page, label)
            det[label] = {'fieldPx': round(g['w'], 1)}
    finally:
        errs = con.summary()
        c.eq(errs['errors'] + errs['page_errors'], [], 'phone-360: 0 console errors')
        ctx.close()


def run(only=None):
    c = Check('views-vsearch')
    det = c.details
    with browser() as b:
        for cfg in CONFIGS:
            if only and cfg['name'] not in only:
                continue
            ctx, page, con = open_page(b, cfg)
            try:
                block(c, page, cfg, det)
                if cfg['name'] in ('desktop-light', 'phone-dark'):
                    pause_block(c, page, cfg, det)
            except Exception as e:
                c.ok(False, f"{cfg['name']}: crashed: {e!r}")
            finally:
                errs = con.summary()
                c.eq(errs['errors'] + errs['page_errors'], [], f"{cfg['name']}: 0 console errors")
                ctx.close()
        if not only:
            small_phone(c, b, det)
    write_json('vsearch.json', c.result())
    return c.result()


if __name__ == '__main__':
    import sys
    run_main(lambda: run(sys.argv[1:] or None))
