"""(a) Timing harness in headless Chromium: HF.timing.runStream with a dummy view, 20 items at 500 ms on / 3000 ms SOA.
Every item must last 500 ms ± 1 frame, no voided trials, no stalls, no long animation frames during the block.
Also: response windows and first-response-per-key, key repeat, touch/mouse pads, stream pauses (key, hidden,
pagehide, Escape), and discrete runs (answer on key/pad, timeout, pause voids only the current trial, a second
pause keeps the first start, resume continues).
Run: python3 tests/e2e/test_core_timing.py
"""
import os
import statistics

from helpers import Check, Console, browser, file_url, run_main, write_json


def rel_close(a, b, tol):
    return abs(a - b) <= tol


def run():
    c = Check('core-timing')
    with browser() as b:
        page = b.new_page(viewport={'width': 1366, 'height': 768})
        con = Console(page)
        page.goto(file_url('tests/e2e/pages/timing.html'))
        page.wait_for_function('window.harness && window.HF && HF.timing && HF.input')

        # ---------------- (a) 20 items, 500 ms on, 3000 ms SOA ----------------
        # Items must last 500 ms ± 1 frame on EVERY attempt. "Stalls caused by our code" = a long animation frame
        # (PerformanceObserver 'long-animation-frame') in which our scripts (/js/…) ran ≥ 30 ms. Frame gaps with no
        # such entry are the machine (this box is shared and often overloaded); they must still never touch a
        # displayed item (flags.stall / flags.late stay empty). If our scripts are blamed — wall-clock attribution can
        # be inflated by CPU starvation — the run is repeated, at most 3 attempts; every attempt is reported.
        attempts = []
        for attempt in range(3):
            page.evaluate('harness.startStream({ n: 20, onMs: 500, soaMs: 3000 })')
            busy_during = page.evaluate('HF.timing.busy')
            attr_during = page.evaluate("document.documentElement.hasAttribute('data-busy')")
            res = page.evaluate('harness.result()')
            attr_after = page.evaluate("document.documentElement.hasAttribute('data-busy')")
            log = res['log']
            iv = log['interval']
            dur = [off - on for on, off in zip(log['onsets'], log['offsets'])]
            soa = [b2 - a2 for a2, b2 in zip(log['onsets'], log['onsets'][1:])]
            paint = [s2 - o for o, s2 in zip(log['onsets'], log['shown'])]
            ours = [e for e in res['loaf'] if sum(x['dur'] for x in e['scripts'] if '/js/' in (x['src'] or '')) >= 30]
            info = {
                'attempt': attempt + 1, 'interval_ms': iv, 'fps': log['frame']['fps'], 'frame_median_ms': log['frame']['medianMs'],
                'frame_max_ms': log['frame']['maxMs'], 'gaps_over_2_5_frames': log['frame']['stalls'],
                'duration_ms': {'min': round(min(dur), 3), 'max': round(max(dur), 3), 'mean': round(statistics.mean(dur), 3)},
                'soa_ms': {'min': round(min(soa), 3), 'max': round(max(soa), 3), 'mean': round(statistics.mean(soa), 3)},
                'paint_delay_ms': {'min': round(min(paint), 3), 'max': round(max(paint), 3)},
                'voided': log['voided'], 'stall_flags': log['flags']['stall'], 'late_flags': log['flags']['late'],
                'loaf_supported': res['loafSupported'], 'loaf_in_block': len(res['loaf']), 'loaf_ours': len(ours),
                'loaf_entries': res['loaf'], 'low_precision': log['frame']['lowPrecision'],
                'load_avg_1min': round(os.getloadavg()[0], 2), 'cpus': os.cpu_count(),
            }
            attempts.append(info)
            write_json(f'timing-stream20-attempt{attempt + 1}.json', {'result': info, 'log': log})
            c.ok(busy_during is True, f'attempt {attempt + 1}: busy during the stream')
            c.ok(attr_during is True and attr_after is False, f'attempt {attempt + 1}: <html data-busy> mirrors busy (during {attr_during}, after {attr_after})')
            c.eq(log['presented'], 20, f'attempt {attempt + 1}: all 20 items presented')
            c.ok(all(rel_close(d, 500, iv + 0.01) for d in dur), f'attempt {attempt + 1}: each item lasts 500 ms ± 1 frame (got {min(dur):.2f}–{max(dur):.2f})')
            c.ok(all(rel_close(x, 3000, iv + 0.01) for x in soa), f'attempt {attempt + 1}: SOA 3000 ms ± 1 frame (got {min(soa):.2f}–{max(soa):.2f})')
            c.eq(log['voided'], [], f'attempt {attempt + 1}: no voided trials')
            c.eq(log['flags']['stall'] + log['flags']['late'], [], f'attempt {attempt + 1}: no displayed item hit by a stall or a late paint')
            c.eq(log['onFrames'], round(500 / iv), 'on-time counted in frames')
            c.eq(log['soaFrames'], round(3000 / iv), 'SOA counted in frames')
            c.ok(res['busyAfter'] is False, 'busy cleared at the end')
            if not ours:
                break
        c.ok(not attempts[-1]['loaf_ours'], f"no stall caused by our code (long animation frames with ≥ 30 ms in /js/: {[a['loaf_ours'] for a in attempts]})")
        c.ok(attempts[-1]['loaf_supported'], 'long-animation-frame observer available in this Chromium')
        c.details['stream20'] = dict(attempts[-1], attempts=len(attempts),
                                     all_attempts=[{k: v for k, v in a.items() if k != 'loaf_entries'} for a in attempts])

        # ---------------- response windows, first response per key, repeats, pads ----------------
        page.evaluate('harness.startStream({ n: 8, onMs: 200, soaMs: 900, two: true, opts: { leadMs: 300 } })')
        page.wait_for_function('harness.shown >= 1')
        page.keyboard.press('j')
        page.wait_for_timeout(120)
        page.keyboard.press('j')          # same window → ignored
        page.keyboard.press('k')          # match2 → kept
        page.keyboard.press('f')          # 'no' is not a stream key → ignored
        page.wait_for_function('harness.shown >= 3')
        page.keyboard.down('j')
        page.wait_for_timeout(40)
        page.keyboard.down('j')           # auto-repeat (repeat: true) → ignored
        page.wait_for_timeout(40)
        page.keyboard.up('j')
        page.wait_for_function('harness.shown >= 5')
        page.click('[data-key="match"]')  # pad acts on pointerdown
        res = page.evaluate('harness.result()')
        log = res['log']
        on, iv = log['onsets'], log['interval']
        windows_ok = True
        for r in log['responses']:
            j = r['trial']
            end = on[j + 1] if j + 1 < len(on) else on[j] + 900 + iv
            windows_ok &= on[j] <= r['t'] < end and rel_close(r['rt'], r['t'] - on[j], 0.02)
        c.ok(windows_ok, 'every response lies in [onset_i, onset_i+1) and rt = t − onset_i')
        pairs = [(r['trial'], r['key']) for r in log['responses']]
        c.eq(len(pairs), len(set(pairs)), 'first response per key per window only')
        keys = sorted(r['key'] for r in log['responses'])
        c.eq(keys, ['match', 'match', 'match', 'match2'], 'J, K, held J (once), pad; F ignored')
        c.ok(any(r['src'] == 'mouse' for r in log['responses']), 'pad response recorded with src mouse')
        c.ok(sum(1 for r in log['responses'] if r['src'] == 'key') == 3, 'three keyboard responses')
        c.details['responses'] = log['responses']

        # ---------------- stream pauses ----------------
        for how, reason in (('key-p', 'key'), ('escape', 'key'), ('hidden', 'hidden'), ('pagehide', 'pagehide')):
            page.evaluate('harness.startStream({ n: 10, onMs: 200, soaMs: 700, opts: { leadMs: 300 } })')
            page.wait_for_function('harness.shown >= 2')
            if how == 'key-p':
                page.keyboard.press('p')
            elif how == 'escape':
                page.keyboard.press('Escape')
            elif how == 'hidden':
                page.evaluate('harness.fakeHidden()')
            else:
                page.evaluate('harness.pagehide()')
            res = page.evaluate('harness.result()')
            log = res['log']
            if how == 'hidden':
                page.evaluate('harness.fakeVisible()')
            c.ok(log['paused'] and log['pause']['reason'] == reason, f'{how}: stream returns paused (reason {reason})')
            c.ok(log['presented'] < 10, f'{how}: stopped at once')
            c.ok((log['presented'] - 1) in log['voided'], f'{how}: the trial in progress is voided')
            c.eq(page.evaluate("getComputedStyle(document.getElementById('stim')).visibility"), 'hidden', f'{how}: stimulus hidden')
            c.ok(res['busyAfter'] is False, f'{how}: busy cleared')
        c.ok(page.evaluate("HF.timing.pause('again')") is False, 'pause with no run is a no-op')

        # ---------------- a main-thread stall while an item is displayed voids that item ----------------
        page.evaluate('harness.startStream({ n: 4, onMs: 400, soaMs: 900, opts: { leadMs: 300 } })')
        page.wait_for_function('harness.shown >= 1')
        page.evaluate('() => { const t = performance.now(); while (performance.now() - t < 120) {} return true; }')
        res = page.evaluate('harness.result()')
        log = res['log']
        c.ok(1 in log['voided'] and 1 in log['flags']['stall'], f'stall during item 1 voids it: voided {log["voided"]}, flags {log["flags"]}')
        c.ok(log['frame']['stalls'] >= 1 and log['frame']['maxMs'] >= 60, f'stall counted in frame stats: {log["frame"]}')
        c.ok(0 not in log['voided'] and 3 not in log['voided'], 'other items not voided')
        c.details['stall'] = {'voided': log['voided'], 'flags': log['flags'], 'frame': log['frame']}

        # ---------------- persistent display (onMs null: each item stays until the next) ----------------
        page.evaluate('harness.startStream({ n: 5, onMs: null, soaMs: 500, opts: { leadMs: 300 } })')
        res = page.evaluate('harness.result()')
        log = res['log']
        iv = log['interval']
        dur = [off - on for on, off in zip(log['onsets'], log['offsets'])]
        c.ok(all(rel_close(d, 500, iv + 0.01) for d in dur), f'persistent items last one SOA (500 ± 1 frame): {dur}')
        c.ok(all(rel_close(log['offsets'][i], log['onsets'][i + 1], 0.01) for i in range(4)), 'each item is replaced in the frame the next appears')
        c.eq(log['voided'], [], 'persistent: nothing voided')

        # ---------------- discrete displayMs: the item hides early, the answer window stays open ----------------
        page.evaluate('harness.startDiscrete({ n: 2, windowMs: 1500, itiMs: 100, opts: { leadMs: 300 } })')
        page.wait_for_function('harness.shown === 0')
        c.ok(page.evaluate('HF.timing.abort()') is True, 'abort() ends a running block')
        res = page.evaluate('harness.result()')
        c.ok(res['log']['aborted'] is True and res['log']['answers'][0]['voided'] is True and res['busyAfter'] is False,
             'aborted log: current trial voided, busy cleared')
        # Phase 3: the run is repeated (at most 3 times) only when a frame problem the runner recorded (late first
        # paint / stall while the item was up) voided item 1 — that voiding is correct behaviour on a busy machine.
        # A clean run must still show the timeout; a voided item without a recorded frame flag fails at once.
        dm_attempts, log = [], None
        for _attempt in range(3):
            page.evaluate("""() => {
              const spec = { kind: 'discrete', windowMs: 1500, itiMs: 100, displayMs: 300,
                trials: [{ i: 0, stim: { text: 'C' } }, { i: 1, stim: { text: 'H' } }] };
              const stim = document.getElementById('stim');
              const view = { prepare: t => { stim.textContent = t.stim.text; }, show: t => { stim.style.visibility = 'visible'; harness.shown = t.i; },
                             hide: t => { stim.style.visibility = 'hidden'; harness.hidden = t.i; } };
              harness.shown = -1; harness.hidden = -1;
              harness.pending = HF.timing.runDiscrete(spec, view, { leadMs: 300 }).then(log => ({ log }));
              return true; }""")
            page.wait_for_function('harness.shown === 0')
            page.wait_for_function('harness.hidden === 0', timeout=3000)
            page.wait_for_timeout(250)
            page.keyboard.press('j')
            page.wait_for_function('harness.shown === 1')
            res = page.evaluate('harness.result()')
            log = res['log']
            a1 = log['answers'][1]
            frame_flag = 1 in (log['flags'].get('late') or []) or 1 in (log['flags'].get('stall') or [])
            dm_attempts.append({'a1': a1, 'flags': log['flags'], 'frame': log['frame']})
            if a1['voided'] and frame_flag:
                continue
            break
        c.details['displayMs_attempts'] = dm_attempts
        iv = log['interval']
        c.ok(rel_close(log['offsets'][0] - log['onsets'][0], 300, iv + 0.01), f"displayMs hides the item at 300 ms: {log['offsets'][0] - log['onsets'][0]}")
        c.ok(log['answers'][0]['response'] == 'match' and log['answers'][0]['rt'] > 300, 'answer accepted after the item was hidden')
        c.ok(all(not x['a1']['voided'] or 1 in (x['flags'].get('late') or []) + (x['flags'].get('stall') or []) for x in dm_attempts),
             f'an item is voided only for a recorded frame problem: {dm_attempts}')
        c.ok(log['answers'][1]['response'] is None and not log['answers'][1]['voided'], f'unanswered item times out ({len(dm_attempts)} run(s))')

        # ---------------- discrete run ----------------
        page.evaluate('harness.startDiscrete({ n: 6, windowMs: 1500, itiMs: 150, opts: { leadMs: 300, resumeLeadMs: 300 } })')
        page.wait_for_function('harness.shown === 0')
        page.wait_for_timeout(250)
        page.keyboard.press('j')                        # trial 0: match
        page.wait_for_function('harness.shown === 1')
        page.wait_for_timeout(250)
        page.click('[data-key="no"]')                   # trial 1: no (pad)
        page.wait_for_function('harness.shown === 2')
        page.wait_for_timeout(200)
        page.keyboard.press('p')                        # pause during trial 2
        page.wait_for_timeout(250)
        second_at = page.evaluate('performance.now()')
        page.keyboard.press('Escape')                   # second pause keeps the first start
        c.eq(page.evaluate('HF.timing.state'), 'paused', 'discrete: paused state')
        c.ok(page.evaluate('HF.timing.busy') is False, 'discrete: not busy while paused')
        c.ok(page.evaluate("document.documentElement.hasAttribute('data-busy')") is False, 'discrete: no data-busy while paused')
        page.wait_for_timeout(500)
        c.eq(page.evaluate('harness.shown'), 2, 'discrete: nothing shown while paused')
        c.ok(page.evaluate('HF.timing.resume()') is True, 'resume() continues the run')
        c.ok(page.evaluate("document.documentElement.hasAttribute('data-busy')") is True, 'discrete: data-busy back after resume')
        page.wait_for_function('harness.shown === 3')   # trial 3: no answer → times out
        page.wait_for_function('harness.shown === 4', timeout=5000)
        page.wait_for_timeout(200)
        page.keyboard.press('j')
        page.wait_for_function('harness.shown === 5')
        page.wait_for_timeout(200)
        page.keyboard.press('f')
        res = page.evaluate('harness.result()')
        log = res['log']
        a = log['answers']
        iv = log['interval']
        c.eq([x['response'] for x in a], ['match', 'no', None, None, 'match', 'no'], 'discrete responses')
        c.eq([x['voided'] for x in a], [False, False, True, False, False, False], 'only the paused trial is voided')
        c.eq(a[1]['src'], 'mouse', 'pad answer src')
        c.ok(all(x['rt'] is None or 150 < x['rt'] < 1500 for x in a), 'discrete RTs in range')
        c.ok(log['offsets'][0] - log['onsets'][0] < 1500 - iv, 'a response ends the trial early')
        c.ok(rel_close(log['offsets'][3] - log['onsets'][3], 1500, iv + 0.01), 'no response: the window times out at 1500 ms ± 1 frame')
        c.eq(len(log['pauses']), 1, 'one pause entry for two pause requests')
        if log['pauses']:
            p = log['pauses'][0]
            c.eq(p['reasons'], ['key', 'key'], 'second pause reason appended')
            c.ok(p['start'] + log['t0'] < second_at - 100, 'pause start is the FIRST pause')
            c.ok(p['end'] is not None and p['end'] > p['start'] + 500, 'pause end recorded at resume')
        c.ok(log['paused'] is True and log['aborted'] is False, 'discrete log flags')
        c.details['discrete'] = {'answers': a, 'pauses': log['pauses'], 'interval': iv}

        # ---------------- two fingers at once (CA-06): both pads count; pads are released per pointer ----------------
        cdp = page.context.new_cdp_session(page)

        def centre(sel):
            bx = page.locator(sel).bounding_box()
            return {'x': bx['x'] + bx['width'] / 2, 'y': bx['y'] + bx['height'] / 2}
        pa, pb = centre('[data-key="match"]'), centre('[data-key="match2"]')
        page.evaluate("() => { window.inLog = []; HF.input.on(e => inLog.push(e.key + ':' + e.src)); return true; }")
        page.evaluate('harness.startStream({ n: 4, onMs: 300, soaMs: 1500, two: true, opts: { leadMs: 300 } })')
        page.wait_for_function('harness.shown >= 1')
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [dict(pa, id=1)]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [dict(pa, id=1), dict(pb, id=2)]})
        held = page.evaluate("[...document.querySelectorAll('.pad.is-down')].map(p => p.dataset.key).sort()")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        released = page.evaluate("document.querySelectorAll('.pad.is-down').length")
        res = page.evaluate('harness.result()')
        log = res['log']
        c.eq(sorted(page.evaluate('inLog')), ['match2:touch', 'match:touch'], 'two simultaneous touches both reach HF.input')
        c.eq(held, ['match', 'match2'], 'both pads shown as pressed')
        c.eq(released, 0, 'both pads released when the fingers lift')
        pairs = sorted((r['trial'], r['key'], r['src']) for r in log['responses'])
        c.ok(len(pairs) == 2 and pairs[0][0] == pairs[1][0] and {p[1] for p in pairs} == {'match', 'match2'},
             f'Dual: both presses recorded in the same window: {pairs}')
        cdp.detach()
        # per-pointer bookkeeping with synthetic pointer events: a second finger on a pad already held is ignored,
        # and lifting one finger releases only its pad
        steps = page.evaluate("""() => {
          const log = [], off = HF.input.on(e => log.push(e.key));
          const pad = k => document.querySelector('[data-key="' + k + '"]');
          const ev = (type, k, id, primary) => pad(k).dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: primary,
            pointerType: 'touch', bubbles: true, cancelable: true, button: 0 }));
          const down = () => [...document.querySelectorAll('.pad.is-down')].map(p => p.dataset.key).sort().join(',');
          ev('pointerdown', 'match', 11, true); ev('pointerdown', 'match2', 12, false); ev('pointerdown', 'match', 13, false);
          const a = down(); ev('pointerup', 'match2', 12, false); const b = down();
          ev('pointerup', 'match', 13, false); const c2 = down(); ev('pointercancel', 'match', 11, true); const d = down();
          off(); return { log, a, b, c: c2, d };
        }""")
        c.eq(steps['log'], ['match', 'match2'], 'a pointerdown on a pad another finger holds is ignored')
        c.eq([steps['a'], steps['b'], steps['c'], steps['d']], ['match,match2', 'match', 'match', ''],
             'released per pointer (pointerup / pointercancel)')

        # ---------------- custom flows (HF.timing.custom): Span view.run(), Lab tests ----------------
        page.evaluate('harness.startCustom()')
        st = page.evaluate('harness.flowState()')
        c.ok(st['busy'] and st['attr'] and st['state'] == 'running', f'custom: busy + data-busy while running: {st}')
        refused = page.evaluate("() => HF.timing.runStream({ onMs: 50, soaMs: 100, trials: [{ i: 0, stim: { main: { text: 'C' } } }] }).then(() => 'ran', e => e.message)")
        c.ok('already running' in refused, f'custom: other runs refused while a flow is active ({refused})')
        n_infos = page.evaluate('harness.pauseInfos.length')
        page.keyboard.press('p')
        st = page.evaluate('harness.flowState()')
        c.ok(st['state'] == 'paused' and not st['busy'] and not st['attr'], f'custom: P pauses; busy and data-busy off: {st}')
        c.eq(st['events'], ['pause:key'], 'custom: the flow pause handler is called once')
        c.eq(page.evaluate('harness.pauseInfos.length'), n_infos + 1, 'custom: onPause subscribers notified')
        page.keyboard.press('Escape')
        c.eq(page.evaluate('harness.flowState().events'), ['pause:key'], 'custom: a second pause does not call the flow again')
        c.ok(page.evaluate('HF.timing.resume()') is True, 'custom: HF.timing.resume reaches the flow')
        st = page.evaluate('harness.flowState()')
        c.ok(st['state'] == 'running' and st['busy'] and st['attr'] and st['events'][-1] == 'resume', f'custom: resumed, data-busy back: {st}')
        page.evaluate('harness.fakeHidden()')
        c.eq(page.evaluate('harness.flowState().events')[-1], 'pause:hidden', 'custom: a hidden page pauses the flow')
        page.evaluate('harness.fakeVisible()')
        c.ok(page.evaluate('harness.flow.resume()') is True, 'custom: flow.resume()')
        page.evaluate('harness.pagehide()')
        c.eq(page.evaluate('harness.flowState().events')[-1], 'pause:pagehide', 'custom: pagehide pauses the flow')
        c.ok(page.evaluate("HF.timing.abort('quit')") is True, 'custom: HF.timing.abort reaches the flow')
        st = page.evaluate('harness.flowState()')
        c.ok(st['state'] == 'done' and not st['active'] and not st['busy'] and not st['attr'] and st['timingState'] == 'idle', f'custom: abort ends the flow: {st}')
        c.eq(st['events'][-1], 'abort:quit', 'custom: the abort handler is called')
        flog = page.evaluate('harness.flow.end()')
        c.ok(flog['aborted'] and flog['abortReason'] == 'quit' and len(flog['pauses']) == 3, f'custom: log after abort (end() idempotent): {flog}')
        if flog['pauses']:
            c.eq(flog['pauses'][0]['reasons'], ['key', 'key'], 'custom: the second pause keeps the first start (reason appended)')
            c.ok(all(x['end'] is not None and x['end'] >= x['start'] for x in flog['pauses']), 'custom: pause ends recorded')
        page.evaluate('harness.startCustom()')
        flog = page.evaluate('harness.flow.end()')
        c.ok(not flog['aborted'] and not flog['paused'], 'custom: plain end() log')
        c.ok(not page.evaluate('HF.timing.busy') and not page.evaluate("document.documentElement.hasAttribute('data-busy')"), 'custom: end() releases busy and data-busy')
        c.ok(page.evaluate("harness.flow.pause('late')") is False, 'custom: pause after end is a no-op')
        page.evaluate('harness.startCustom({ audio: true })')
        page.wait_for_function('harness.flowState().events.length > 0', timeout=3000)
        c.eq(page.evaluate('harness.flowState().events'), ['pause:audio'], 'custom: an audio flow pauses when audio is not running')
        page.evaluate('harness.flow.end()')
        c.ok(page.evaluate('HF.timing.active') is False, 'custom: nothing left active')

        c.details['console'] = con.summary()
        c.eq(con.errors + con.page_errors, [], 'no console or page errors')
    write_json('timing.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
