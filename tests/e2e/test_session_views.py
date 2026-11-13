"""E2E (P1a): the n-back views through the real player (HF.player.runSpec + HF.timing + HF.views.nback).

1. Every item format is shown with a long on-time (2.4 s of a 3 s SOA, so a screenshot catches the item): grid8,
   letters, digits, shapes, glyphs, days, months, clock, compass, ring8 (Transform), Arithmetic, Switch (digits and
   shapes: cue word + icon), the memory tape (assist), audio-only tones. Checks per format: the item is visible
   while on, the stage sits above the pads, the pads are inside the viewport, no horizontal overflow, and Switch
   shows its cue word with an icon. Phone 390×844 light (all), 360×640 (densest), desktop 1366×768 dark (some).
2. Transform, Arithmetic and Switch blocks are played with REAL key presses answering from the spec → BA 1.0.
Run: python3 tests/e2e/test_session_views.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, SMALL, Check, answer_block, boot, browser, build_page, finish,
                              layout_ok, new_page, run_main, shot)

FORMATS = [
    ('plain-grid8', 'nback.plain', 2, 'grid8', {}),
    ('plain-letters', 'nback.plain', 2, 'letters', {}),
    ('plain-digits', 'nback.plain', 2, 'digits', {}),
    ('plain-shapes', 'nback.plain', 2, 'shapes', {}),
    ('plain-glyphsC', 'nback.plain', 2, 'glyphsC', {}),
    ('plain-glyphsF', 'nback.plain', 2, 'glyphsF', {}),
    ('transform-days', 'nback.transform', 2, 'days', {}),
    ('transform-months', 'nback.transform', 2, 'months', {}),
    ('transform-clock', 'nback.transform', 2, 'clock', {}),
    ('transform-compass', 'nback.transform', 2, 'compass', {}),
    ('transform-ring8', 'nback.transform', 2, 'ring8', {}),
    ('arith', 'nback.arith', 2, 'arith', {}),
    ('switch-digits', 'nback.switch', 3, 'digits', {}),
    ('switch-shapes', 'nback.switch', 3, 'shapes', {}),
    ('tape-letters', 'nback.plain', 2, 'letters', {'tape': True}),
    ('tape-grid8', 'nback.plain', 2, 'grid8', {'tape': True}),
    ('tape-switch', 'nback.switch', 3, 'digits', {'tape': True}),
]
DENSE = {'switch-digits', 'tape-letters', 'tape-switch', 'arith', 'transform-months'}
DARK = {'plain-grid8', 'transform-days', 'arith', 'switch-shapes', 'tape-letters', 'plain-glyphsC'}

START = """(a) => {
  var spec = HF.tasks.nback.gen({ trackId: a.trackId, rung: a.rung, set: a.set, seed: 'view-' + a.name });
  if (a.slow) { spec.onMs = 2200; spec.soaMs = 2600; }
  var host = document.getElementById('hf-test-host');
  if (!host) { host = document.createElement('div'); host.id = 'hf-test-host'; document.getElementById('hf-screen').appendChild(host); }
  window.__res = null;
  HF.player.runSpec(spec, 'nback', { root: host, assist: { tape: !!a.tape }, ruleCard: !!a.ruleCard })
    .then(function (r) {
      var lg = r.log || {}, on = [], soa = [];
      for (var i = 0; i < (lg.presented || 0); i++) {
        if (lg.offsets && lg.onsets && lg.offsets[i] != null && lg.onsets[i] != null) on.push(lg.offsets[i] - lg.onsets[i]);
        if (lg.onsets && i > 0 && lg.onsets[i] != null && lg.onsets[i - 1] != null) soa.push(lg.onsets[i] - lg.onsets[i - 1]);
      }
      function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[b.length >> 1] : null; }
      window.__res = { status: r.status, ba: r.result ? r.result.ba : null, seed: r.spec && r.spec.seed,
        timing: { interval: lg.interval, onMedian: med(on), onMin: on.length ? Math.min.apply(null, on) : null, onMax: on.length ? Math.max.apply(null, on) : null,
          soaMedian: med(soa), voided: (lg.voided || []).length, stalls: lg.frame ? lg.frame.stalls : null, n: lg.presented } };
    });
  return spec.trials.length;
}"""

ITEM_STATE = """() => {
  var nb = document.querySelector('.hf-play .hf-nb');
  if (!nb) return null;
  var on = nb.querySelector('.hf-nb__cell.is-on, .hf-nb__card.is-on');
  var vis = null;
  if (on) { var inner = on.querySelector('.hf-nb__in, .hf-nb__item'); vis = !inner || getComputedStyle(inner).visibility === 'visible'; }
  var cue = nb.querySelector('.hf-nb__cueword.is-on');
  return { fmt: nb.getAttribute('data-fmt'), on: !!on, visible: vis,
    cue: cue ? { word: cue.textContent.trim(), icon: !!cue.querySelector('svg') } : null,
    slots: nb.querySelectorAll('.hf-nb__slot').length, compare: nb.querySelectorAll('.hf-nb__slot.is-compare').length,
    pads: nb.querySelectorAll('.hf-pad').length };
}"""


def show_format(page, chk, tag, fmt):
    name, tid, rung, sset, extra = fmt
    page.evaluate(START, {'name': name, 'trackId': tid, 'rung': rung, 'set': sset, 'tape': extra.get('tape', False), 'slow': True})
    page.wait_for_function("""() => { var s = HF.player.state(); return s.active && s.phase === 'run' && +s.trial >= 3 &&
        !!document.querySelector('.hf-play .hf-nb__cell.is-on, .hf-play .hf-nb__card.is-on'); }""", timeout=30000, polling='raf')
    st = page.evaluate(ITEM_STATE)
    path = shot(page, 'views-%s-%s' % (tag, name))
    lay = layout_ok(page)
    chk.ok(st and st['on'] and st['visible'], '%s %s: item visible while on (%s)' % (tag, name, st))
    chk.ok(not lay['overflowX'], '%s %s: no horizontal overflow' % (tag, name))
    chk.ok(lay.get('padsInView') is True and lay.get('stageAbovePads') is True, '%s %s: stage above pads, pads in view %s' % (tag, name, lay))
    if tid == 'nback.switch':
        chk.ok(bool(st['cue']) and st['cue']['icon'] and st['cue']['word'] in ('WHAT', 'WHERE'), '%s %s: cue word + icon %s' % (tag, name, st['cue']))
    if extra.get('tape'):
        n = page.evaluate('() => HF.player.state().spec.params.n')
        chk.eq(st['slots'], n + 1, '%s %s: tape shows n + 1 slots' % (tag, name))
        chk.eq(st['compare'], 1, '%s %s: one framed slot (n back)' % (tag, name))
    page.evaluate('() => HF.player.abort("test")')
    page.wait_for_function('() => !HF.player.active', timeout=5000)
    return path


def play_format(page, chk, name, tid, rung, sset):
    page.evaluate(START, {'name': name, 'trackId': tid, 'rung': rung, 'set': sset, 'tape': False, 'slow': False})
    res = answer_block(page)
    page.wait_for_function('() => window.__res !== null', timeout=60000)
    out = page.evaluate('() => window.__res')
    chk.eq(out['status'], 'done', '%s: block finished' % name)
    tm = out.get('timing') or {}
    chk.details.setdefault('timing', {})[name] = tm
    want_on = page.evaluate('(t) => Math.round(HF.catalog.params(t, 2).onMs * HF.player.debug.timeScale)', tid)
    iv = tm.get('interval') or 16.7
    # loose on a shared machine (the orchestrator re-runs precise timing on an idle one): median within 1.5 frames
    chk.ok(tm.get('onMedian') is not None and abs(tm['onMedian'] - want_on) <= 1.5 * iv, '%s: median on-time %s ms ≈ %s ms' % (name, tm.get('onMedian'), want_on))
    chk.ok((tm.get('voided') or 0) <= 2, '%s: at most 2 voided items (%s)' % (name, tm.get('voided')))
    chk.ok(out['ba'] is not None and out['ba'] >= 0.99, '%s: real key presses from the spec score BA 1.0 (got %s, %d presses)' % (name, out['ba'], res['pressed']))


def run():
    chk = Check('session-views')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        # phone, light: every format
        ctx, page, con = new_page(b, PHONE, 'light')
        cons.append(con)
        boot(page, url, debug={'countdownStepMs': 60})
        for f in FORMATS:
            show_format(page, chk, 'phone', f)
        # audio-only Plain (tones): Start click on the rule card unlocks audio; the sound mark lights while on
        page.evaluate(START, {'name': 'plain-tones', 'trackId': 'nback.plain', 'rung': 2, 'set': 'tones', 'tape': False, 'slow': True, 'ruleCard': True})
        page.wait_for_function("() => HF.player.phase === 'rule'", timeout=10000)
        page.locator('.hf-play__start').click()
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 3 && !!document.querySelector('.hf-nb__card.is-on'); }", timeout=30000, polling='raf')
        chk.eq(page.evaluate('() => HF.audio.state()'), 'running', 'tones: audio unlocked by the Start click')
        shot(page, 'views-phone-plain-tones')
        page.evaluate('() => HF.player.abort("test")')
        ctx.close()

        # 360 × 640: the densest formats
        ctx, page, con = new_page(b, SMALL, 'light')
        cons.append(con)
        boot(page, url, debug={'countdownStepMs': 60})
        for f in FORMATS:
            if f[0] in DENSE:
                show_format(page, chk, 'small', f)
        ctx.close()

        # desktop, dark
        ctx, page, con = new_page(b, DESKTOP, 'dark')
        cons.append(con)
        boot(page, url, settings={'theme': 'dark'}, debug={'countdownStepMs': 60})
        for f in FORMATS:
            if f[0] in DARK:
                show_format(page, chk, 'desktop-dark', f)
        ctx.close()

        # Transform / Arithmetic / Switch played with real key presses (shortened timing, test hook)
        ctx, page, con = new_page(b, DESKTOP, 'light')
        cons.append(con)
        boot(page, url, debug={'countdownStepMs': 150, 'timeScale': 0.5})
        for name, tid, rung, sset in (('play-transform', 'nback.transform', 2, 'days'), ('play-arith', 'nback.arith', 2, 'arith'),
                                      ('play-switch', 'nback.switch', 3, 'shapes'), ('play-transform-compass', 'nback.transform', 4, 'compass')):
            play_format(page, chk, name, tid, rung, sset)
        ctx.close()

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
