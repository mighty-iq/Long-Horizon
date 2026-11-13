"""E2E (P1a): a Dual n-back block with audio, in Free play.

Chromium runs with --autoplay-policy=document-user-activation-required (tests/e2e/helpers.py), so the AudioContext
can only start inside a real user gesture: the test clicks Start with a real mouse click. Checks: the context is
'running' after the click; one tone is scheduled per item on the audio clock (HF.audio.tone wrapped to count calls,
the real function still plays); POSITION (J) and SOUND (K) presses answer both streams from the spec; both streams
score BA 1.0; the debrief speaks of positions and sounds; the block is committed (role 'free'); desktop + phone.
Run: python3 tests/e2e/test_session_dual.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, answer_block, boot, browser, build_page, finish,
                              go_session, layout_ok, new_page, plan_id, run_main, session_blocks, shot, wait_phase)

SPY = """() => {
  window.__tones = []; window.__clips = [];
  var t = HF.audio.tone, c = HF.audio.clip;
  HF.audio.tone = function (i, when, o) { var r = t.apply(HF.audio, arguments); window.__tones.push({ i: i, when: when, ok: !!r }); return r; };
  HF.audio.clip = function (id, when, o) { var r = c.apply(HF.audio, arguments); window.__clips.push({ id: id, when: when, ok: !!r }); return r; };
}"""


def run_case(b, url, chk, viewport, theme, tag, sound_set):
    ctx, page, con = new_page(b, viewport, theme)
    try:
        boot(page, url, settings={'theme': theme}, debug={'timeScale': 0.6, 'countdownStepMs': 200})
        page.evaluate(SPY)
        chk.ok(page.evaluate('() => HF.audio.state()') in ('none', 'suspended'), '%s: audio not running before the gesture' % tag)
        if sound_set == 'lettersAudio' and not page.evaluate("() => HF.sets.available('lettersAudio')"):
            sound_set = 'tones'
        chk.details.setdefault('sets', {})[tag] = sound_set
        go_session(page, {'free': {'trackId': 'nback.dual', 'rung': 2, 'set': sound_set}})
        wait_phase(page, 'rule', 20000)
        shot(page, 'dual-%s-1-rule' % tag)
        keys = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-play-rule .hf-keys__pad'), function (x) { return x.textContent; })")
        chk.ok('Position' in keys and 'Sound' in keys, '%s: rule card names the Position and Sound pads %s' % (tag, keys))
        page.locator('.hf-play__start').click()                     # real gesture
        page.wait_for_function("() => HF.player.phase === 'countdown' || HF.player.phase === 'run'", timeout=10000)
        chk.eq(page.evaluate('() => HF.audio.state()'), 'running', '%s: AudioContext running after the Start click' % tag)
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=20000, polling='raf')
        pads = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-play .hf-pad'), function (p) { return p.getAttribute('data-key') + ':' + p.textContent.trim(); })")
        chk.ok(len(pads) == 2 and pads[0].startswith('match:') and 'Position' in pads[0] and pads[1].startswith('match2:') and 'Sound' in pads[1], '%s: POSITION (J) + SOUND (K) pads %s' % (tag, pads))
        lay = layout_ok(page)
        chk.ok(lay.get('padsInView') is True and not lay['overflowX'], '%s: pads in view, no overflow %s' % (tag, lay))
        shot(page, 'dual-%s-2-run' % tag)
        res = answer_block(page)
        wait_phase(page, 'debrief', 60000)
        shot(page, 'dual-%s-3-debrief' % tag)
        n_items = res['trials']
        chk.eq(page.evaluate('() => HF.store.records.blocks.slice(-1)[0].set'), sound_set, '%s: block played with %s' % (tag, sound_set))
        sounds = page.evaluate('() => window.__tones.concat(window.__clips)')
        chk.eq(len(sounds), n_items, '%s: one sound (%s) scheduled per item' % (tag, sound_set))
        chk.ok(all(t['ok'] and t['when'] is not None for t in sounds), '%s: every sound scheduled on the audio clock (clips decoded)' % tag)
        line = page.evaluate("() => (document.querySelector('.hf-debrief__line') || {}).textContent")
        chk.ok(line and line.startswith('Positions: you caught 6 of 6. Sounds: 6 of 6.'), '%s: debrief line %r' % (tag, line))
        blocks = session_blocks(page, plan_id(page))
        chk.eq(len(blocks), 1, '%s: the block was committed' % tag)
        if blocks:
            bl = blocks[0]
            chk.eq(bl['role'], 'free', '%s: free-play role' % tag)
            chk.eq(bl['trackId'], 'nback.dual', '%s: Dual track' % tag)
            st = bl['result']['streams']
            chk.ok(st['pos']['h'] == 6 and st['snd']['h'] == 6 and st['pos']['fa'] == 0 and st['snd']['fa'] == 0, '%s: both streams perfect %s' % (tag, st))
            chk.ok(bl['result']['ba'] >= 0.99, '%s: block BA 1.0' % tag)
        page.locator('.hf-play-debrief [data-action="done"]').click()
        wait_phase(page, 'summary', 20000)
        chk.eq(page.evaluate("() => HF.store.records.sessions.slice(-1)[0].endedBy"), 'done', '%s: Done ends the free session as done' % tag)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-dual')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_case(b, url, chk, DESKTOP, 'light', 'desktop-light', 'tones'))
        cons.append(run_case(b, url, chk, PHONE, 'dark', 'phone-dark', 'lettersAudio'))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
