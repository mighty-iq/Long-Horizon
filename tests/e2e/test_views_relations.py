"""Relations views (Equal Steps, Relation Grid, Relation Stream) through the real HF.timing runners, with real key
presses (desktop) and taps on the pads (phone), in four configurations (desktop 1366×768 and phone 390×844, light and
dark). Each configuration plays a scripted block per view (perfect or imperfect) and checks:
- responses land on the intended trials and HF.tasks.relations.score gives the expected counts (voided trials excluded);
- frame accuracy as in the core timing test: items last onMs ± 1 frame, SOA ± 1 frame, no late paint or stall on a
  displayed item (machine noise tolerated up to 10 %), no long animation frame with ≥ 30 ms in Long-Horizon scripts;
- busy and <html data-busy> cleared at the end; per-response flash (data-fb) shown; layout fits without scrolling;
- Stream: only the changed cells swap layers; the first grid stays up ≥ meta.initialMs (runOpts.leadMs);
- pauses: a stream pause voids the trial in progress and stops at once; a discrete pause voids only the current array
  and the block resumes; 0 console errors.
Run: python3 tests/e2e/test_views_relations.py
"""
from helpers import run_main
from test_views_common import (CONFIGS, Check, browser, close, layout_ok, open_page, ours, press, stream_expect,
                               wait_off, wait_on, write_json)

STEPS_RUNG = {'desktop-light': 2, 'desktop-dark': 8, 'phone-light': 4, 'phone-dark': 17}
GRID = {
    'desktop-light': {'trackId': 'rel.grid.T1', 'rung': 2, 'variant': 'digits'},
    'desktop-dark': {'trackId': 'rel.grid.T2', 'rung': 5, 'variant': 'glyphs', 'set': 'glyphsD'},
    'phone-light': {'trackId': 'rel.grid.T6', 'rung': 6},
    'phone-dark': {'trackId': 'rel.grid.T7', 'rung': 3, 'variant': 'letters'},
}
STREAM_RUNG = {'desktop-light': 0, 'desktop-dark': 3, 'phone-light': 5, 'phone-dark': 1}


def timing_checks(c, label, log, on_ms, soa_ms, persistent=False, first=0):
    iv = log['interval']
    tol = iv + 0.05
    flagged = set(log['flags']['late']) | set(log['flags']['stall'])
    n = log['presented']
    on, off = log['onsets'], log['offsets']
    bad_dur, bad_soa = [], []
    for i in range(first, n):
        if i in flagged or (i + 1) in flagged:
            continue
        if not persistent and not close(off[i] - on[i], on_ms, tol):
            bad_dur.append((i, round(off[i] - on[i], 2)))
        if i + 1 < n and not close(on[i + 1] - on[i], soa_ms, tol):
            bad_soa.append((i, round(on[i + 1] - on[i], 2)))
    if not persistent:
        c.ok(not bad_dur, f'{label}: every item lasts {on_ms} ms ± 1 frame (off: {bad_dur[:5]})')
    c.ok(not bad_soa, f'{label}: SOA {soa_ms} ms ± 1 frame (off: {bad_soa[:5]})')
    c.ok(len(flagged) <= max(1, n // 10), f'{label}: late/stall flags only from machine noise (≤ 10 %): {sorted(flagged)}')
    c.eq(log['onFrames'], 0 if persistent else round(on_ms / iv), f'{label}: on-time counted in frames')
    c.eq(log['soaFrames'], round(soa_ms / iv), f'{label}: SOA counted in frames')
    return {'interval': iv, 'flagged': sorted(flagged), 'fps': log['frame']['fps'], 'maxMs': log['frame']['maxMs'],
            'stalls': log['frame']['stalls']}


def common_after(c, label, res):
    c.ok(res['scoreError'] is None, f"{label}: scorer ran ({res['scoreError']})")
    c.ok(res['busyAfter'] is False and res['busyAttrAfter'] is False, f'{label}: busy and <html data-busy> cleared at the end')
    mine = ours(res['loaf'])
    c.ok(not mine, f'{label}: no long animation frame with ≥ 30 ms in Long-Horizon scripts ({len(mine)})')


def noisy(log, res):
    """Too many late/stall flags, none caused by Long-Horizon scripts → the machine (shared, often loaded): retry."""
    flagged = set(log['flags']['late']) | set(log['flags']['stall'])
    return len(flagged) > max(1, log['presented'] // 10) and not ours(res['loaf'])


def steps_block(c, page, cfg, det):
    label = cfg['name'] + ' steps'
    attempts = []
    for attempt in range(3):   # as the core timing test: repeat only when the machine, not our code, stalled frames
        s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.steps', 'rung': STEPS_RUNG[cfg['name']],
                                                       'seed': 'views/steps/' + cfg['name'], 'params': {'onMs': 500, 'soaMs': 900}}})
        pressed = list(s['targets'])
        if cfg['script'] == 'imperfect':
            pressed = s['targets'][1:] + s['lures'][:2]
        pressed.sort()
        page.evaluate('VH.run({ feedback: true })')
        busy = page.evaluate('HF.timing.busy')
        flash = None
        for i in pressed:
            wait_on(page, i)
            press(page, cfg, 'match')
            if flash is None:
                flash = page.evaluate("document.querySelector('.hf-v__pads [data-key=match]').getAttribute('data-fb')")
        res = page.evaluate('VH.result()')
        attempts.append({'flagged': sorted(set(res['log']['flags']['late']) | set(res['log']['flags']['stall'])),
                         'maxMs': res['log']['frame']['maxMs']})
        if not noisy(res['log'], res):
            break
    log, sc = res['log'], res['score']
    c.ok(busy is True, f'{label}: busy while the stream runs')
    c.eq(log['presented'], s['n'], f'{label}: all items presented')
    c.eq(sorted(r['trial'] for r in log['responses']), pressed, f'{label}: each press lands on its intended item')
    exp = stream_expect(s, pressed, log['voided'])
    got = {k: sc['streams']['main'][k] for k in exp}
    c.eq(got, exp, f'{label}: score counts ({cfg["script"]})')
    if cfg['script'] == 'perfect' and not log['voided']:
        c.eq(sc['ba'], 1.0, f'{label}: perfect script scores BA 1.0')
    c.ok(flash in ('good', 'bad'), f'{label}: per-response flash on the pad (data-fb = {flash})')
    det[label] = {'timing': timing_checks(c, label, log, 500, 900), 'ba': sc['ba'], 'voided': log['voided'], 'attempts': attempts}
    common_after(c, label, res)


def grid_block(c, page, cfg, det):
    g = dict(GRID[cfg['name']])
    label = cfg['name'] + ' grid ' + g['trackId'][-2:]
    g.update({'seed': 'views/grid/' + cfg['name'], 'params': {'windowMs': 2500}})
    s = page.evaluate('o => VH.mount(o)', {'gen': g})
    layout_ok(c, page, label)
    answers = s['answers']
    script = list(answers)
    timeout_i = None
    if cfg['script'] == 'imperfect':
        t_idx = [i for i, a in enumerate(answers) if a == 'match']
        n_idx = [i for i, a in enumerate(answers) if a == 'no']
        for i in t_idx[:2] + n_idx[:2]:
            script[i] = 'no' if answers[i] == 'match' else 'match'
        timeout_i = n_idx[2]
        script[timeout_i] = None
    page.evaluate('VH.run({ feedback: true })')
    for i, a in enumerate(script):
        wait_on(page, i)
        if a is None:
            wait_off(page, i, timeout=8000)
        else:
            press(page, cfg, a)
    res = page.evaluate('VH.result()')
    log, sc = res['log'], res['score']
    voided = {a['i'] for a in log['answers'] if a['voided']}
    c.eq([a['response'] for a in log['answers']], script, f'{label}: every answer recorded on its array')
    exp = {'hits': 0, 'misses': 0, 'fas': 0, 'crs': 0}
    for i, a in enumerate(script):
        if i in voided:
            continue
        if answers[i] == 'match':
            exp['hits' if a == 'match' else 'misses'] += 1
        else:
            exp['fas' if a == 'match' else 'crs'] += 1
    c.eq({k: sc['streams']['main'][k] for k in exp}, exp, f'{label}: score counts ({cfg["script"]})')
    c.eq(sc['extra'].get('timeouts', 0), 0 if timeout_i is None or timeout_i in voided else 1, f'{label}: timeouts counted')
    if cfg['script'] == 'perfect' and not voided:
        c.eq(sc['ba'], 1.0, f'{label}: perfect script scores BA 1.0')
    iv = log['interval']
    late = [i for i in range(20) if log['shown'][i] - log['onsets'][i] > 1.5 * iv]
    c.ok(len(late) <= 2, f'{label}: arrays painted in the frame they were shown ({late})')
    ends, bad_end = [], []
    # the array hides on the first frame after the answer is handled; a frame stalled by the machine after an answer
    # is not flagged by the runner (nothing is charged), so allow the block's longest frame on top of 3 frames
    lag = max(3 * iv, iv + (log['frame']['maxMs'] or 0)) + 1
    for i, a in enumerate(log['answers']):
        dur = log['offsets'][i] - log['onsets'][i]
        if a['response'] is None and not a['voided']:
            ends.append(close(dur, 2500, iv + 0.05))
            if not ends[-1]:
                bad_end.append((i, None, round(dur, 1)))
        elif a['response'] is not None:
            ends.append(a['rt'] - iv - 0.5 <= dur <= a['rt'] + lag)   # frame timestamps may precede the event's
            if not ends[-1]:
                bad_end.append((i, a['rt'], round(dur, 1)))
    c.ok(all(ends), f'{label}: an array ends at the answer (next frame) or after exactly its window {bad_end}')
    shown = [f['t'] for f in res['fb'] if f['ok']]
    gaps = [b2 - a2 for a2, b2 in zip(shown, shown[1:])]
    c.ok(len(shown) >= 3 and all(g >= 333 for g in gaps), f'{label}: feedback flashes shown, never more than 3 per second ({len(shown)} of {len(res["fb"])}, min gap {min(gaps) if gaps else None})')
    det[label] = {'ba': sc['ba'], 'voided': sorted(voided), 'late': late, 'interval': iv}
    common_after(c, label, res)


def stream_once(page, cfg, pressed):
    page.evaluate('VH.run({ feedback: false })')
    seen = []
    for i in pressed:
        wait_on(page, i)
        press(page, cfg, 'match')
        if len(seen) < 3 and page.evaluate("VH.spec.meta.variant === 'digits' || VH.spec.meta.variant === 'letters'"):
            seen.append(page.evaluate("""i => {
                const vis = Array.from(VH.view.el.querySelectorAll('.hf-rg__cell')).map(c => c.querySelector('.hf-rg__in:not(.is-hid)').textContent);
                return { i, ok: VH.on !== i || JSON.stringify(vis) === JSON.stringify(VH.spec.trials[i].stim.main.grid) };
            }""", i))
    return page.evaluate('VH.result()'), seen


def stream_block(c, page, cfg, det):
    label = cfg['name'] + ' stream'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.stream', 'rung': STREAM_RUNG[cfg['name']],
                                                   'seed': 'views/stream/' + cfg['name'], 'params': {'changeMs': 600}}})
    layout_ok(c, page, label)
    c.eq(s['runOpts']['leadMs'], max(500, s['initialMs'] - s['soaMs']), f'{label}: runOpts.leadMs = initialMs − soaMs')
    pressed = list(s['targets'])
    if cfg['script'] == 'imperfect':
        pressed = s['targets'][:-1] + s['lures'][:2]
    pressed.sort()
    attempts = []
    for attempt in range(3):   # repeat only when the machine, not our code, stalled frames (as the core timing test)
        if attempt:
            page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.stream', 'rung': STREAM_RUNG[cfg['name']],
                                                       'seed': 'views/stream/' + cfg['name'], 'params': {'changeMs': 600}}})
        res, seen = stream_once(page, cfg, pressed)
        attempts.append({'flagged': sorted(set(res['log']['flags']['late']) | set(res['log']['flags']['stall'])),
                         'maxMs': res['log']['frame']['maxMs']})
        if not noisy(res['log'], res):
            break
    first_visible = page.evaluate('VH.firstVisible')
    log, sc = res['log'], res['score']
    c.eq(log['presented'], s['n'], f'{label}: all changes presented')
    c.eq(sorted(r['trial'] for r in log['responses']), pressed, f'{label}: each press lands on its intended change')
    exp = stream_expect(s, pressed, log['voided'])
    c.eq({k: sc['streams']['main'][k] for k in exp}, exp, f'{label}: score counts ({cfg["script"]})')
    if cfg['script'] == 'perfect' and not log['voided']:
        c.eq(sc['ba'], 1.0, f'{label}: perfect script scores BA 1.0')
    c.ok(all(x['ok'] for x in seen), f'{label}: the visible cells show the current state during the run ({seen})')
    first_view = log['t0'] + log['onsets'][1] - first_visible if first_visible else None
    c.ok(first_view is not None and first_view >= s['initialMs'] - 2 * log['interval'],
         f"{label}: first grid up ≥ initialMs {s['initialMs']} (got {first_view and round(first_view)})")
    det[label] = {'timing': timing_checks(c, label, log, s['onMs'], s['soaMs'], persistent=True, first=1),
                  'ba': sc['ba'], 'voided': log['voided'], 'firstViewMs': first_view and round(first_view), 'attempts': attempts}
    common_after(c, label, res)


def swap_audit(c, page, det):
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.stream', 'rung': 5, 'seed': 'views/swap'}})
    audit = page.evaluate('VH.swapAudit(12)')
    states = page.evaluate('VH.spec.trials.slice(0, 13).map(t => t.stim.main)')
    c.eq(audit[0]['swapped'], list(range(9)), 'stream: the first grid fills every cell')
    c.eq(audit[0]['swappedInPrepare'], list(range(9)), 'stream: prepare(trial 0) reveals the first grid (lead-in view)')
    ok_changed = all(sorted(a['swapped']) == sorted(st['changed']) for a, st in zip(audit[1:], states[1:]))
    c.ok(ok_changed, 'stream: each change swaps exactly the changed cells (3 per change at this rung)')
    c.ok(all(not a['swappedInPrepare'] for a in audit[1:]), 'stream: prepare() of later changes keeps the screen as it is')
    c.ok(all(a['texts'] == st['grid'] for a, st in zip(audit, states)), 'stream: visible layers read the generator state')
    c.ok(all(not a['off'] for a in audit), 'stream: the grid never blanks between changes')
    det['swap'] = {'changed': [st['changed'] for st in states[1:6]], 'swapped': [a['swapped'] for a in audit[1:6]], 'n': s['n']}


def static_render(c, page, det):
    """HF.views.relations.renderGrid (lessons, examples): a visible static grid with the trial's strings and marks."""
    r = page.evaluate("""() => {
      const spec = HF.tasks.relations.gen({ trackId: 'rel.grid.T1', rung: 0, seed: 'views/static' });
      const t = spec.trials.find(x => x.answer === 'match');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const box = HF.views.relations.renderGrid(host, spec, t, { highlight: true, mark: t.meta.lineCells });
      const cells = Array.from(box.querySelectorAll('.hf-rg__cell'));
      const out = { n: cells.length, texts: cells.map(c => c.textContent), want: t.stim.cells,
        marked: cells.map((c, i) => c.classList.contains('is-mark') ? i : -1).filter(i => i >= 0), line: t.meta.lineCells,
        visible: getComputedStyle(box.querySelector('.hf-rg__in')).visibility, hl: box.querySelector('.hf-rg').classList.contains('hf-rg--hl'),
        sym: HF.views.relations.symbolHTML(HF.tasks.relations.gen({ trackId: 'rel.grid.T2', rung: 0, seed: 's', variant: 'bars' }), 3) };
      host.remove();
      return out;
    }""")
    c.eq((r['n'], r['texts']), (9, r['want']), 'renderGrid: the trial\'s strings in 9 cells')
    c.eq(r['marked'], sorted(r['line']), 'renderGrid: the target line is marked')
    c.ok(r['visible'] == 'visible' and r['hl'], 'renderGrid: shown at once, with the tutorial highlight')
    c.ok('<svg' in r['sym'] and 'rotate(67.5' in r['sym'], 'symbolHTML: a bar at 3 × 22.5°')
    det['static'] = {'marked': r['marked']}


def pause_checks(c, page, cfg, det):
    label = cfg['name'] + ' pause'
    # stream: Escape (desktop) / page hidden (phone) stops at once and voids the item in progress
    page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.steps', 'rung': 2, 'seed': 'views/pause', 'params': {'onMs': 400, 'soaMs': 700}}})
    page.evaluate('VH.run({})')
    wait_on(page, 4)
    if cfg['touch']:
        page.evaluate('VH.fakeHidden()')
    else:
        page.keyboard.press('Escape')
    res = page.evaluate('VH.result()')
    if cfg['touch']:
        page.evaluate('VH.fakeVisible()')
    log = res['log']
    reason = 'hidden' if cfg['touch'] else 'key'
    c.ok(log['paused'] and log['pause']['reason'] == reason, f'{label}: Equal Steps returns paused ({reason})')
    c.ok(log['presented'] - 1 in log['voided'] and log['presented'] <= 6, f"{label}: the item in progress is voided ({log['voided']}, presented {log['presented']})")
    c.ok(page.evaluate("Array.from(document.querySelectorAll('.hf-es__v')).every(e => e.classList.contains('is-hid'))"), f'{label}: number hidden while paused')
    c.ok(res['busyAfter'] is False, f'{label}: busy cleared after a stream pause')
    # discrete: the current array is voided, the block resumes with HF.timing.resume()
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'rel.grid.T3', 'rung': 3, 'seed': 'views/pause-grid'}})
    page.evaluate('VH.run({})')
    for i in range(3):
        wait_on(page, i)
        press(page, cfg, s['answers'][i])
    wait_on(page, 3)
    if cfg['touch']:
        page.evaluate('VH.fakeHidden()')
    else:
        page.keyboard.press('p')
    page.wait_for_function("HF.timing.state === 'paused'")
    hidden = page.evaluate("document.querySelector('.hf-rg').classList.contains('is-off')")
    if cfg['touch']:
        page.evaluate('VH.fakeVisible()')
    c.ok(hidden, f'{label}: the array is hidden while paused')
    c.ok(page.evaluate('HF.timing.busy') is False, f'{label}: busy off while paused')
    page.evaluate('HF.timing.resume()')
    for i in range(4, 20):
        wait_on(page, i)
        press(page, cfg, s['answers'][i])
    res = page.evaluate('VH.result()')
    log, sc = res['log'], res['score']
    c.ok(log['answers'][3]['voided'] and log['answers'][3]['response'] is None, f'{label}: the array on screen at the pause is voided')
    c.eq(sum(1 for a in log['answers'] if a['voided']), 1, f'{label}: only that array is voided')
    c.ok(log['paused'] and len(log['pauses']) == 1, f'{label}: the pause is logged')
    c.eq((sc['nScorable'], sc['nVoided']), (19, 1), f'{label}: scorer excludes the voided array')
    c.eq(sc['ba'], 1.0, f'{label}: the other 19 arrays score as answered')
    det[label] = {'pauses': log['pauses']}


def run(only=None):
    c = Check('views-relations')
    det = c.details
    with browser() as b:
        for cfg in CONFIGS:
            if only and cfg['name'] not in only:
                continue
            ctx, page, con = open_page(b, cfg)
            try:
                steps_block(c, page, cfg, det)
                grid_block(c, page, cfg, det)
                stream_block(c, page, cfg, det)
                if cfg['name'] == 'desktop-light':
                    swap_audit(c, page, det)
                    static_render(c, page, det)
                if cfg['name'] in ('desktop-light', 'phone-dark'):
                    pause_checks(c, page, cfg, det)
            except Exception as e:  # a crash in one configuration is a failure; the others still run
                c.ok(False, f"{cfg['name']}: crashed: {e!r}")
            finally:
                errs = con.summary()
                c.eq(errs['errors'] + errs['page_errors'], [], f"{cfg['name']}: 0 console errors")
                ctx.close()
    write_json('relations.json', c.result())
    return c.result()


if __name__ == '__main__':
    import sys
    run_main(lambda: run(sys.argv[1:] or None))
