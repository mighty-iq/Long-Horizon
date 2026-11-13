"""Screenshots of the task views for review: every Relation Grid variant and tier, Equal Steps (plain and assisted),
Relation Stream, the Span phases (judgement, memorandum, recall, between lists, pause) and visual search (set sizes 8, 48,
56 and 64), on phone 390×844 and desktop 1366×768 in light and dark, plus a 360×640 phone and the left-handed mirror.
Each shot also checks that nothing scrolls. Files: out/views/<name>.png (+ review/ sheets).
Run: python3 tests/e2e/test_views_shots.py
"""
from helpers import run_main
from test_views_common import OUT, Check, browser, layout_ok, open_page, write_json

PHONE = {'viewport': {'width': 390, 'height': 844}, 'touch': True}
DESK = {'viewport': {'width': 1366, 'height': 768}, 'touch': False}
SMALL = {'viewport': {'width': 360, 'height': 640}, 'touch': True}

VARIANTS = ['digits', 'letters', 'icons', 'dots', 'bars', 'glyphs', 'lab', 'colors']
KEY_VARIANTS = ['icons', 'bars', 'glyphs', 'lab', 'colors']


def grid(tier, rung=4, variant=None, set_=None, seed=None, ctx=None):
    g = {'trackId': 'rel.grid.' + tier, 'rung': rung, 'seed': seed or ('shots/' + tier + '/' + (variant or set_ or 'd'))}
    if variant:
        g['variant'] = variant
    if set_:
        g['set'] = set_
    return {'gen': g, 'ctx': ctx or {}}


def shot(c, page, name, mount, still=0, mark=None, shots=None):
    page.evaluate('o => VH.mount(o)', mount)
    page.evaluate('([i, m]) => VH.still(i, { mark: m })', [still, mark])
    page.wait_for_timeout(40)
    layout_ok(c, page, name)
    path = OUT / (name + '.png')
    page.screenshot(path=str(path))
    if shots is not None:
        shots.append(str(path))


def grid_set(c, page, suffix, shots, full):
    if full:
        for v in VARIANTS:
            shot(c, page, f'grid-T1-{v}-{suffix}', grid('T1', variant=v), shots=shots)
        shot(c, page, f'grid-T1-glyphsF-{suffix}', grid('T1', set_='glyphsF'), shots=shots)
        for t in ('T2', 'T3', 'T4', 'T5', 'T7', 'T8'):
            shot(c, page, f'grid-{t}-digits-{suffix}', grid(t), shots=shots)
        for v in KEY_VARIANTS:
            shot(c, page, f'grid-T2-{v}-{suffix}', grid('T2', variant=v), shots=shots)
        shot(c, page, f'grid-T6-icons-{suffix}', grid('T6', rung=6), shots=shots)
        shot(c, page, f'grid-T6-glyphsB-{suffix}', grid('T6', set_='glyphsB', rung=6), shots=shots)
        shot(c, page, f'grid-T6-glyphsF-{suffix}', grid('T6', set_='glyphsF', rung=6), shots=shots)
        shot(c, page, f'grid-T7-letters-{suffix}', grid('T7', variant='letters'), shots=shots)
        shot(c, page, f'grid-T1-assist-highlight-{suffix}', grid('T1', variant='icons', ctx={'assist': {'highlight': True}}), shots=shots)
        # a lesson-style mark on the target line of the first target array
        page.evaluate('o => VH.mount(o)', grid('T1', variant='digits', seed='shots/mark'))
        i, cells = page.evaluate("(() => { const t = VH.spec.trials.find(x => x.answer === 'match'); return [t.i, t.meta.lineCells]; })()")
        shot(c, page, f'grid-T1-mark-line-{suffix}', grid('T1', variant='digits', seed='shots/mark'), still=i, mark=cells, shots=shots)
    else:
        shot(c, page, f'grid-T1-digits-{suffix}', grid('T1', variant='digits'), shots=shots)
        shot(c, page, f'grid-T2-glyphs-{suffix}', grid('T2', variant='glyphs'), shots=shots)
        shot(c, page, f'grid-T2-icons-{suffix}', grid('T2', variant='icons'), shots=shots)
        shot(c, page, f'grid-T5-dots-{suffix}', grid('T5', variant='dots'), shots=shots)
        shot(c, page, f'grid-T6-icons-{suffix}', grid('T6', rung=6), shots=shots)
        shot(c, page, f'grid-T7-digits-{suffix}', grid('T7'), shots=shots)


def others(c, page, suffix, shots):
    shot(c, page, f'steps-{suffix}', {'gen': {'trackId': 'rel.steps', 'rung': 6, 'seed': 'shots/steps'}}, still=5, shots=shots)
    shot(c, page, f'steps-assist-1back-{suffix}', {'gen': {'trackId': 'rel.steps', 'rung': 2, 'seed': 'shots/steps'}, 'ctx': {'assist': {'steps': True}}}, still=6, shots=shots)
    shot(c, page, f'steps-assist-2back-{suffix}', {'gen': {'trackId': 'rel.steps', 'rung': 10, 'seed': 'shots/steps2'}, 'ctx': {'assist': {'steps': True}}}, still=7, shots=shots)
    shot(c, page, f'stream-digits-{suffix}', {'gen': {'trackId': 'rel.stream', 'rung': 3, 'seed': 'shots/stream'}}, still=5, shots=shots)
    shot(c, page, f'stream-icons-{suffix}', {'gen': {'trackId': 'rel.stream', 'rung': 0, 'seed': 'shots/stream', 'variant': 'icons'}}, still=3, shots=shots)
    for rung in (0, 12, 14, 17):
        size = [8, 12, 16, 24, 32, 40, 48, 56, 64][rung // 2]
        shot(c, page, f'vsearch-{size}-{suffix}', {'gen': {'trackId': 'vs.search', 'rung': rung, 'seed': 'shots/vs/%d' % rung}},
             still=page.evaluate("r => HF.tasks.vsearch.gen({ trackId: 'vs.search', rung: r, seed: 'shots/vs/' + r }).trials.findIndex(t => t.answer === 'match')", rung),
             shots=shots)


def span_phases(c, page, cfg, suffix, shots):
    """Drive one span run to each phase and photograph it."""
    page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.op', 'rung': 3, 'seed': 'shots/span'}, 'ctx': {'feedback': 'per-response'},
                                       'patch': {'procLimitMs': 6000}})
    page.evaluate('VH.run({})')

    def snap(name):
        p = OUT / (name + '.png')
        page.screenshot(path=str(p))
        shots.append(str(p))

    def answer(st):
        if cfg['touch']:
            page.tap('.hf-v__pads [data-key="%s"]' % ('match' if st['correct'] else 'no'))
        else:
            page.keyboard.press('j' if st['correct'] else 'f')

    # wait until the shown equation is matched to the spec (k known): under CPU load the panel can show a frame early
    page.wait_for_function("(() => { const s = VH.spanNow(); return s.t === 'judge' && s.k !== undefined; })()")
    snap(f'span-judgement-{suffix}')
    layout_ok(c, page, f'span judgement {suffix}')
    answer(page.evaluate('VH.spanNow()'))
    page.wait_for_function("VH.spanNow().t === 'mem'")
    snap(f'span-memorandum-{suffix}')
    done_k = {0}
    while True:
        page.wait_for_function("(() => { const s = VH.spanNow(); return s.t === 'recall' || (s.t === 'judge' && s.k !== undefined); })()")
        st = page.evaluate('VH.spanNow()')
        if st['t'] == 'recall':
            break
        if st['t'] != 'judge' or 'k' not in st:   # moved on between the two page calls: look again
            continue
        if st['k'] in done_k:
            page.wait_for_function("k => VH.spanNow().k !== k", arg=st['k'])
            continue
        done_k.add(st['k'])
        answer(st)
    exp = st['expected']
    for s in exp[:3]:
        if cfg['touch']:
            page.tap('.hf-sp__key[data-sym="%s"]' % s)
        else:
            page.click('.hf-sp__key[data-sym="%s"]' % s)
    snap(f'span-recall-{suffix}')
    layout_ok(c, page, f'span recall {suffix}')
    for s in exp[3:]:
        page.click('.hf-sp__key[data-sym="%s"]' % s) if not cfg['touch'] else page.tap('.hf-sp__key[data-sym="%s"]' % s)
    page.click('.hf-sp__act[data-act="done"]') if not cfg['touch'] else page.tap('.hf-sp__act[data-act="done"]')
    page.wait_for_function("VH.spanNow().t === 'msg'")
    snap(f'span-between-{suffix}')
    page.wait_for_function("VH.spanNow().t === 'judge'")
    page.evaluate("VH.view.pause('key')")
    page.wait_for_function("VH.spanNow().t === 'msg' && VH.spanNow().paused")
    snap(f'span-pause-{suffix}')
    page.evaluate('VH.view.abort()')
    page.evaluate('VH.result()')


def run():
    c = Check('views-shots')
    shots = []
    configs = [
        ('phone-light', dict(PHONE, theme='light', name='phone-light'), True),
        ('phone-dark', dict(PHONE, theme='dark', name='phone-dark'), False),
        ('desktop-light', dict(DESK, theme='light', name='desktop-light'), False),
        ('desktop-dark', dict(DESK, theme='dark', name='desktop-dark'), False),
    ]
    with browser() as b:
        for suffix, cfg, full in configs:
            ctx, page, con = open_page(b, cfg)
            try:
                grid_set(c, page, suffix, shots, full)
                others(c, page, suffix, shots)
                span_phases(c, page, cfg, suffix, shots)
            except Exception as e:
                c.ok(False, f'{suffix}: crashed: {e!r}')
            finally:
                errs = con.summary()
                c.eq(errs['errors'] + errs['page_errors'], [], f'{suffix}: 0 console errors')
                ctx.close()
        # small phone and left-handed mirror
        for suffix, cfg, q in (('phone360', dict(SMALL, theme='light', name='phone360'), ''),
                               ('phone-lefthand', dict(PHONE, theme='light', name='phone-lefthand'), 'hand=left')):
            ctx, page, con = open_page(b, cfg, q)
            try:
                if suffix == 'phone360':
                    for v in ('glyphs', 'icons', 'colors'):
                        shot(c, page, f'grid-T2-{v}-{suffix}', grid('T2', variant=v), shots=shots)
                    shot(c, page, f'grid-T7-digits-{suffix}', grid('T7'), shots=shots)
                    shot(c, page, f'grid-T6-icons-{suffix}', grid('T6', rung=6), shots=shots)
                    shot(c, page, f'vsearch-64-{suffix}', {'gen': {'trackId': 'vs.search', 'rung': 16, 'seed': 'shots/vs/360'}}, shots=shots)
                    shot(c, page, f'steps-assist-3back-{suffix}', {'gen': {'trackId': 'rel.steps', 'rung': 18, 'seed': 'shots/steps3'}, 'ctx': {'assist': {'steps': True}}}, still=9, shots=shots)
                    span_phases(c, page, cfg, suffix, shots)
                else:
                    shot(c, page, f'grid-T1-digits-{suffix}', grid('T1'), shots=shots)
                    shot(c, page, f'vsearch-48-{suffix}', {'gen': {'trackId': 'vs.search', 'rung': 12, 'seed': 'shots/vs/l'}}, shots=shots)
                    mirrored = page.evaluate("(() => { const p = Array.from(document.querySelectorAll('.hf-v__pads [data-key]')); const r = p.map(x => [x.dataset.key, x.getBoundingClientRect().left]); r.sort((a, b) => a[1] - b[1]); return r.map(x => x[0]); })()")
                    c.eq(mirrored, ['no', 'match'], 'left hand: "No" stays on the left with two pads')
            except Exception as e:
                c.ok(False, f'{suffix}: crashed: {e!r}')
            finally:
                errs = con.summary()
                c.eq(errs['errors'] + errs['page_errors'], [], f'{suffix}: 0 console errors')
                ctx.close()
    c.details['shots'] = shots
    write_json('shots.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
