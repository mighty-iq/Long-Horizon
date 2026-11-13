"""Span view (complex span with its own run() flow) in four configurations (desktop 1366×768 and phone 390×844, light
and dark), with real key presses / typing on desktop and real taps on phones. Checks:
- the judgement → memorandum → recall flow, scripted perfect and imperfect answers (a wrong judgement, a timeout, a
  recall error, Skip, Delete) and HF.tasks.span.score's recall / judgement accuracy for them (voided lists excluded);
- frame accuracy: memoranda last memMs ± 1 frame; a judgement ends at the answer (next frame) or after exactly the
  personal limit; the run is an HF.timing.custom flow: busy + <html data-busy> from start to end, off while paused;
- typing in recall (letters incl. F, J, K and P are symbols there, not answers or pause);
- pause: Escape during a judgement and page-hidden during recall void that list, the built-in panel resumes with the
  NEXT list; HF.timing.pause/resume/abort reach a running list and HF.timing.onPause subscribers are told; a delegated
  pause (ctx2.onPause) leaves the UI to the caller; abort marks the rest not presented;
- layout fits without scrolling; 0 console errors.
Run: python3 tests/e2e/test_views_span.py [config ...]
"""
from helpers import run_main
from test_views_common import CONFIGS, Check, browser, close, layout_ok, open_page, ours, press, write_json

SETUP = {
    'desktop-light': {'trackId': 'span.op', 'rung': 1, 'feedback': 'per-response', 'recall': 'type'},
    'desktop-dark': {'trackId': 'span.back', 'rung': 0, 'feedback': 'none', 'recall': 'type'},
    'phone-light': {'trackId': 'span.sym', 'rung': 0, 'feedback': 'per-response', 'recall': 'tap'},
    'phone-dark': {'trackId': 'span.op', 'rung': 0, 'feedback': 'none', 'recall': 'tap'},
}

STATE_JS = """() => {
  if (VH.finished) return { t: 'end' };
  const s = VH.spanNow();
  return (s.t === 'judge' || s.t === 'recall') ? s : null;
}"""


def next_state(page, last_key, timeout=20000):
    """Wait for the next actionable screen (a judgement not yet answered, a recall, or the end)."""
    page.wait_for_function("""k => {
      if (VH.finished) return true;
      const s = VH.spanNow();
      if (s.t === 'recall') return k !== 'recall:' + s.list;
      if (s.t === 'judge') return k !== 'judge:' + s.list + ':' + s.k;
      return false;
    }""", arg=last_key, timeout=timeout)
    return page.evaluate(STATE_JS)


def enter_recall(page, cfg, mode, seq, keypad_typing_ok):
    """seq: list of symbols or None (Skip) or 'DEL'."""
    for s in seq:
        if s is None:
            page.click('.hf-sp__act[data-act="skip"]') if not cfg['touch'] else page.tap('.hf-sp__act[data-act="skip"]')
        elif s == 'DEL':
            if mode == 'type':
                page.keyboard.press('Backspace')
            else:
                page.tap('.hf-sp__act[data-act="del"]')
        elif mode == 'type' and keypad_typing_ok:
            page.keyboard.type(s)
        elif cfg['touch']:
            page.tap('.hf-sp__key[data-sym="%s"]' % s)
        else:
            page.click('.hf-sp__key[data-sym="%s"]' % s)
    if mode == 'type':
        page.keyboard.press('Enter')
    elif cfg['touch']:
        page.tap('.hf-sp__act[data-act="done"]')
    else:
        page.click('.hf-sp__act[data-act="done"]')


def play(c, page, cfg, s, script, label):
    """Play a whole block. script(list, kind, st) → action. Returns (result, entered, answers, checks)."""
    entered, answers, busy_seen = {}, {}, {'judge': None, 'recall': None}
    last = ''
    for _ in range(200):
        st = next_state(page, last)
        if st['t'] == 'end':
            break
        if st['t'] == 'judge':
            last = 'judge:%d:%d' % (st['list'], st['k'])
            if busy_seen['judge'] is None:
                busy_seen['judge'] = page.evaluate("HF.timing.busy === true && document.documentElement.hasAttribute('data-busy')")
            a = script(st['list'], 'judge', st)
            answers[(st['list'], st['k'])] = a
            if a is not None:
                press(page, cfg, 'match' if a else 'no')
        else:
            last = 'recall:%d' % st['list']
            if busy_seen['recall'] is None:
                busy_seen['recall'] = page.evaluate("HF.timing.busy === true && HF.timing.state === 'running' && HF.timing.active === true")
                layout_ok(c, page, label + ' recall')
            seq = script(st['list'], 'recall', st)
            entered[st['list']] = seq
            enter_recall(page, cfg, SETUP[cfg['name']]['recall'], seq, s.get('typing', True))
    res = page.evaluate('VH.result()')
    return res, entered, answers, busy_seen


def final_recall(seq):
    out = []
    for s in seq:
        if s == 'DEL':
            out.pop()
        else:
            out.append(s)
    return out


def check_block(c, label, s, res, entered, answers, setsize):
    log, sc = res['log'], res['score']
    c.ok(res['scoreError'] is None, f"{label}: scorer ran ({res['scoreError']})")
    voided = {t['i'] for t in log['trials'] if t['voided']}
    items = ok = jn = jr = 0
    for L in s['lists']:
        i = L['i']
        if i in voided:
            continue
        got = final_recall(entered.get(i, []))
        c.eq([x for x in log['trials'][i]['recall']], got, f'{label}: list {i} recall logged as entered')
        exp = L['expected']
        items += len(exp)
        ok += sum(1 for k in range(len(exp)) if k < len(got) and got[k] == exp[k])
        for k, truth in enumerate(L['truth']):
            a = answers.get((i, k))
            jn += 1
            jr += 1 if a is not None and a == truth else 0
            c.eq(log['trials'][i]['proc'][k]['resp'], a, f'{label}: list {i} judgement {k} logged')
    c.ok(close(sc['extra']['recall'], ok / items if items else 0, 1e-9), f"{label}: recall score {sc['extra']['recall']} = {ok}/{items}")
    c.ok(close(sc['extra']['procAcc'], jr / jn if jn else 0, 1e-9), f"{label}: judgement accuracy {sc['extra']['procAcc']} = {jr}/{jn}")
    c.eq(sc['ba'], sc['extra']['recall'], f'{label}: controller value = recall proportion')
    c.eq(sc['nVoided'], len(voided), f'{label}: scorer excludes voided lists')
    # frame accuracy
    iv = log['interval']
    # offsets are frame (vsync) timestamps: an answer handled just before a frame can carry a later event timestamp than
    # that frame, so the hide may be logged up to one frame "before" the RT
    bad_mem, bad_judge = [], []
    for t in log['trials']:
        if t['voided']:
            continue
        for k, m in enumerate(t['mem']):
            if not close(m['offset'] - m['onset'], s['memMs'], iv + 0.05):
                bad_mem.append((t['i'], k, round(m['offset'] - m['onset'], 2)))
        for k, p in enumerate(t['proc']):
            dur = p['offset'] - p['onset']
            if p['resp'] is None:
                if not close(dur, s['procLimitMs'], iv + 0.05):
                    bad_judge.append((t['i'], k, 'timeout', round(dur, 2)))
            elif not (p['rt'] - iv - 0.5 <= dur <= p['rt'] + max(3 * iv, iv + (log['frame']['maxMs'] or 0)) + 1):
                bad_judge.append((t['i'], k, round(p['rt'], 1), round(dur, 2)))
    c.ok(not bad_mem, f'{label}: memoranda last {s["memMs"]} ms ± 1 frame ({bad_mem[:4]})')
    c.ok(not bad_judge, f'{label}: judgements end at the answer or after exactly the limit ({bad_judge[:4]})')
    c.ok(res['busyAfter'] is False and res['busyAttrAfter'] is False, f'{label}: busy cleared at the end')
    mine = ours(res['loaf'])
    c.ok(not mine, f'{label}: no long animation frame with ≥ 30 ms in Long-Horizon scripts ({len(mine)})')
    return {'recall': sc['extra']['recall'], 'procAcc': sc['extra']['procAcc'], 'voided': sorted(voided),
            'interval': iv, 'frame': log['frame'], 'flags': log['flags']}


def main_block(c, page, cfg, det):
    st = SETUP[cfg['name']]
    label = cfg['name'] + ' ' + st['trackId']
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': st['trackId'], 'rung': st['rung'], 'seed': 'views/span/' + cfg['name']},
                                           'patch': {'procLimitMs': 2500}, 'ctx': {'feedback': st['feedback']}})
    s['typing'] = st['trackId'] != 'span.sym'
    lists = {L['i']: L for L in s['lists']}
    keypad = page.evaluate('VH.spec.trials[0].recallKeypad')
    imperfect = cfg['script'] == 'imperfect'

    def script(i, kind, state):
        L = lists[i]
        if kind == 'judge':
            truth = L['truth'][state['k']]
            if imperfect and i == 0 and state['k'] == 0:
                return not truth                      # a wrong judgement
            if imperfect and i == 1 and state['k'] == 1:
                return None                           # no answer: times out at the personal limit
            return truth
        exp = list(L['expected'])
        if not imperfect:
            if i == 0 and s['typing']:
                wrong = next(x for x in keypad if x not in exp)
                return [exp[0], wrong, 'DEL'] + exp[1:]   # a correction with Delete / Backspace
            return exp
        if i == 0:
            return [exp[0], None] + exp[2:]            # Skip keeps the place: 1 lost, the rest in place
        if i == 2:
            return [exp[1], exp[0]] + exp[2:]          # order swapped: those two out of place
        return exp

    page.evaluate('VH.run({})')
    res, entered, answers, busy = play(c, page, cfg, s, script, label)
    c.ok(busy['judge'] is True, f'{label}: busy + <html data-busy> during judgements')
    c.ok(busy['recall'] is True, f'{label}: the HF.timing flow stays active (busy) through recall')
    det[label] = check_block(c, label, s, res, entered, answers, s['lists'][0])
    if st['feedback'] == 'per-response':
        c.ok(len([p for p in res['progress'] if p['phase'] == 'done']) == 3, f'{label}: progress reported per list')


def typing_p_check(c, page, cfg, det):
    """Letters typed in recall are symbols there: F/J/K are not answers and P does not pause."""
    label = cfg['name'] + ' recall typing'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.op', 'rung': 0, 'seed': 'views/span/typing'}, 'patch': {'procLimitMs': 2500}})
    page.evaluate('VH.run({})')
    last = ''
    while True:
        st = next_state(page, last)
        if st['t'] == 'judge':
            last = 'judge:%d:%d' % (st['list'], st['k'])
            press(page, cfg, 'match' if st['correct'] else 'no')
            continue
        break
    page.keyboard.type('pj')
    slots = page.evaluate("Array.from(document.querySelectorAll('.hf-sp__slot')).map(e => e.textContent)")
    c.eq(slots[:2], ['P', 'J'], f'{label}: P and J typed into the answer')
    c.eq(page.evaluate('VH.view.state()'), 'recall', f'{label}: P did not pause')
    page.keyboard.press('Escape')
    c.eq(page.evaluate('VH.view.state()'), 'paused', f'{label}: Escape pauses during recall')
    c.ok(page.evaluate("!document.querySelector('.hf-sp__macts').hidden"), f'{label}: built-in pause panel shown')
    page.click('.hf-sp__msg [data-act="end"]')
    res = page.evaluate('VH.result()')
    log = res['log']
    c.ok(log['aborted'] is True, f'{label}: End block aborts')
    c.eq([t['voidReason'] for t in log['trials']], ['pause', 'not-presented', 'not-presented'], f'{label}: paused list voided, the rest not presented')
    c.ok(res['busyAfter'] is False, f'{label}: busy cleared after abort')
    det[label] = {'voidReasons': [t['voidReason'] for t in log['trials']]}


def pause_judge(c, page, cfg, det):
    """Escape (desktop) / page hidden (phone) during a judgement voids the list; Resume continues with the next one."""
    label = cfg['name'] + ' pause in judgement'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.op', 'rung': 0, 'seed': 'views/span/pause'}, 'patch': {'procLimitMs': 3000}})
    page.evaluate('VH.run({})')
    st = next_state(page, '')
    c.eq((st['t'], st['list']), ('judge', 0), f'{label}: first judgement on screen')
    if cfg['touch']:
        page.evaluate('VH.fakeHidden()')
    else:
        page.keyboard.press('Escape')
    page.wait_for_function("VH.view.state() === 'paused'")
    if cfg['touch']:
        page.evaluate('VH.fakeVisible()')
    c.ok(page.evaluate("document.querySelector('.hf-sp__judge').classList.contains('is-hid')"), f'{label}: judgement hidden while paused')
    c.ok(page.evaluate('HF.timing.busy') is False, f'{label}: busy off while paused')
    c.ok(page.evaluate("document.activeElement && document.activeElement.getAttribute('data-act') === 'resume'"), f'{label}: Resume has focus')
    if cfg['touch']:
        page.tap('.hf-sp__msg [data-act="resume"]')
    else:
        page.keyboard.press('Space')          # Space on the focused Resume button
    lists = {L['i']: L for L in s['lists']}

    def script(i, kind, state):
        if kind == 'judge':
            return lists[i]['truth'][state['k']]
        return list(lists[i]['expected'])
    res, entered, answers, busy = play(c, page, cfg, s, script, label)
    log = res['log']
    c.eq([t['voided'] for t in log['trials']], [True, False, False], f'{label}: only the paused list is voided')
    c.eq(log['trials'][0]['voidReason'], 'pause', f'{label}: void reason pause')
    c.ok(len(log['pauses']) == 1 and log['pauses'][0]['end'] is not None, f'{label}: one pause logged with its end')
    sc = res['score']
    c.eq((sc['nScorable'], sc['nVoided'], sc['extra']['recall'], sc['extra']['procAcc']), (2, 1, 1.0, 1.0), f'{label}: scorer counts the two played lists')
    det[label] = {'pauses': log['pauses']}


def timing_api(c, page, cfg, det):
    """HF.timing.pause/resume/abort reach a running Span list (the player's own controls); onPause subscribers are told."""
    label = cfg['name'] + ' HF.timing controls'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.op', 'rung': 0, 'seed': 'views/span/api'}, 'patch': {'procLimitMs': 3000}})
    page.evaluate("() => { window.__pz = []; if (window.__offPz) window.__offPz(); window.__offPz = HF.timing.onPause(i => window.__pz.push(i)); }")
    page.evaluate('VH.run({})')
    st = next_state(page, '')
    c.ok(page.evaluate("HF.timing.active === true && HF.timing.state === 'running'"), f'{label}: the list runs as an HF.timing flow')
    c.ok(page.evaluate("HF.timing.pause('player')") is True, f'{label}: HF.timing.pause() reaches the list')
    c.eq(page.evaluate('VH.view.state()'), 'paused', f'{label}: view paused')
    c.ok(page.evaluate("HF.timing.pause('again')") is True, f'{label}: a second pause is accepted')
    pz = page.evaluate('window.__pz')
    c.ok(len(pz) == 1 and pz[0]['kind'] == 'span' and pz[0]['reason'] == 'player', f'{label}: onPause subscribers told once ({pz})')
    c.ok(page.evaluate("HF.timing.busy === false && !document.documentElement.hasAttribute('data-busy')"), f'{label}: busy off while paused')
    c.ok(page.evaluate("!document.querySelector('.hf-sp__macts').hidden"), f'{label}: built-in panel shown')
    c.ok(page.evaluate('HF.timing.resume()') is True, f'{label}: HF.timing.resume() resumes')
    lists = {L['i']: L for L in s['lists']}

    def script(i, kind, state):
        if kind == 'judge':
            return lists[i]['truth'][state['k']]
        return list(lists[i]['expected'])
    res, entered, answers, busy = play(c, page, cfg, s, script, label)
    log = res['log']
    c.eq([t['voided'] for t in log['trials']], [True, False, False], f'{label}: the paused list is voided, the next two played')
    c.ok(len(log['pauses']) == 1 and log['pauses'][0]['reasons'] == ['player', 'again'] and log['pauses'][0]['end'] is not None,
         f"{label}: one pause, first start kept, reasons appended ({log['pauses']})")
    c.eq((res['score']['extra']['recall'], res['score']['nVoided']), (1.0, 1), f'{label}: scorer counts the two played lists')
    c.ok(res['busyAfter'] is False and page.evaluate('HF.timing.active') is False, f'{label}: flow ended with the block')
    # HF.timing.abort() ends the block: the list on screen and the rest are voided
    page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.op', 'rung': 0, 'seed': 'views/span/api2'}, 'patch': {'procLimitMs': 3000}})
    page.evaluate('VH.run({})')
    next_state(page, '')
    c.ok(page.evaluate("HF.timing.abort('player-end')") is True, f'{label}: HF.timing.abort() reaches the list')
    res = page.evaluate('VH.result()')
    log = res['log']
    c.ok(log['aborted'] is True and log['abortReason'] == 'player-end', f"{label}: log aborted ({log['abortReason']})")
    c.eq([t['voidReason'] for t in log['trials']], ['abort', 'not-presented', 'not-presented'], f'{label}: list on screen and the rest voided')
    c.ok(res['busyAfter'] is False and page.evaluate('HF.timing.active') is False, f'{label}: flow ended after abort')
    page.evaluate('() => { if (window.__offPz) window.__offPz(); window.__offPz = null; }')
    det[label] = {'pauses': log['pauses']}


def pause_recall_delegated(c, page, cfg, det):
    """ctx2.onPause given: no built-in panel; the caller resumes with view.resume(). Page hidden during recall."""
    label = cfg['name'] + ' delegated pause in recall'
    s = page.evaluate('o => VH.mount(o)', {'gen': {'trackId': 'span.back', 'rung': 0, 'seed': 'views/span/deleg'}, 'patch': {'procLimitMs': 3000}})
    page.evaluate('VH.run({ delegatePause: true })')
    last = ''
    while True:
        st = next_state(page, last)
        if st['t'] == 'judge':
            last = 'judge:%d:%d' % (st['list'], st['k'])
            press(page, cfg, 'match' if st['correct'] else 'no')
            continue
        break
    c.eq((st['t'], st['list']), ('recall', 0), f'{label}: recall of list 1 on screen')
    page.evaluate('VH.fakeHidden()')
    page.evaluate('VH.fakeVisible()')
    info = page.evaluate('VH.pauseInfo')
    c.ok(info and info['reason'] == 'hidden' and info['voided'] is True, f'{label}: caller told about the pause ({info})')
    c.ok(page.evaluate("document.querySelector('.hf-sp__msg').hidden"), f'{label}: no built-in panel when the caller handles pauses')
    c.ok(page.evaluate('VH.view.resume()') is True, f'{label}: view.resume() resumes')
    lists = {L['i']: L for L in s['lists']}

    def script(i, kind, state):
        if kind == 'judge':
            return lists[i]['truth'][state['k']]
        return list(lists[i]['expected'])
    res, entered, answers, busy = play(c, page, cfg, s, script, label)
    log = res['log']
    c.eq([t['voided'] for t in log['trials']], [True, False, False], f'{label}: the list paused in recall is voided')
    c.eq(res['score']['extra']['recall'], 1.0, f'{label}: the two played lists recalled in reverse score 1.0')
    det[label] = {'pause': log['pauses']}


def run(only=None):
    c = Check('views-span')
    det = c.details
    with browser() as b:
        for cfg in CONFIGS:
            if only and cfg['name'] not in only:
                continue
            ctx, page, con = open_page(b, cfg)
            try:
                main_block(c, page, cfg, det)
                if cfg['name'] == 'desktop-light':
                    typing_p_check(c, page, cfg, det)
                if cfg['name'] in ('desktop-light', 'phone-dark'):
                    pause_judge(c, page, cfg, det)
                if cfg['name'] in ('desktop-dark', 'phone-light'):
                    pause_recall_delegated(c, page, cfg, det)
                if cfg['name'] in ('desktop-dark', 'phone-dark'):
                    timing_api(c, page, cfg, det)
            except Exception as e:
                c.ok(False, f"{cfg['name']}: crashed: {e!r}")
            finally:
                errs = con.summary()
                c.eq(errs['errors'] + errs['page_errors'], [], f"{cfg['name']}: 0 console errors")
                ctx.close()
    write_json('span.json', c.result())
    return c.result()


if __name__ == '__main__':
    import sys
    run_main(lambda: run(sys.argv[1:] or None))
