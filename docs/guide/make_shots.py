#!/usr/bin/env python3
"""Long-Horizon guide: take the screenshots that docs/guide/guide.html uses, from the real app with seeded data.

    python3 docs/guide/make_shots.py [name ...]

Writes docs/guide/assets/shots/<name>.png: light theme, reduced motion, deviceScaleFactor 2, phone 390×844 or
desktop 1366×768 as each figure needs (data-size in guide.html), then reduces each PNG to 256 colours (Pillow) so
it stays small. One headless Chromium, always closed. Seeding plays synthetic sessions through the real engine
(tests/e2e/test_screens_common.SEED_JS) and adds Lab visits (tests/e2e/test_lab_visit.SEED_JS); running blocks are
captured with the player's test hooks (HF.player.debug: longer items, simulated answers). Nothing personal is shown:
the data are synthetic. MIT licence.
"""
import os
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = ROOT / 'docs' / 'guide' / 'assets' / 'shots'
sys.path.insert(0, str(ROOT / 'tests' / 'e2e'))
os.environ.setdefault('HF_E2E_OUT', '/tmp/long-horizon-shots-e2e')      # the e2e helpers' own outputs (unused here)

from helpers import browser, close_modals, file_url        # noqa: E402
import test_screens_common as tsc                          # noqa: E402  SEED_JS (training history)
import test_lab_visit as tlv                               # noqa: E402  SEED_JS (Lab visits)
import test_learn_bot as tlb                               # noqa: E402  lesson driver

PHONE = {'width': 390, 'height': 844}
DESKTOP = {'width': 1366, 'height': 768}
ALL_LESSONS = ['lesson.nback', 'lesson.dual', 'lesson.transform', 'lesson.arith', 'lesson.switch', 'lesson.steps',
               'lesson.grid', 'lesson.grid.T2', 'lesson.grid.T3', 'lesson.grid.T4', 'lesson.grid.T5', 'lesson.grid.T6',
               'lesson.grid.T7', 'lesson.grid.T8', 'lesson.stream', 'lesson.span', 'lesson.vsearch']
URL = file_url('index.html')


# ---------------------------------------------------------------- helpers
def new_page(b, viewport):
    ctx = b.new_context(viewport=viewport, device_scale_factor=2, color_scheme='light', reduced_motion='reduce',
                        has_touch=viewport['width'] < 600, is_mobile=False)
    return ctx, ctx.new_page()


def boot(page, close=True):
    page.goto(URL)
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(400)
    if close:
        close_modals(page)


def reload(page, close=True):
    page.reload()
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(500)
    if close:
        close_modals(page)


def go(page, route, params=None, wait=700):
    page.evaluate('([r, p]) => HF.router.go(r, p || {})', [route, params or {}])
    page.wait_for_timeout(wait)


def lessons_passed(page, extra=None):
    """Marks every lesson passed (so sessions do not stop for one) and the first run done."""
    page.evaluate("""([ids, extra]) => {
      HF.store.mutate((r) => {
        const have = {}; (r.events || []).forEach((e) => { have[e.id] = 1; });
        const ev = (r.events || []).slice();
        ids.forEach((id, i) => { if (!have['shots-lesson-' + i]) ev.push({ id: 'shots-lesson-' + i, t: Date.now() - 5000, type: 'lesson-passed', lessonId: id }); });
        r.events = ev;
        r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }, extra || {});
      });
      HF.store.flush(true);
      return true;
    }""", [ALL_LESSONS, extra or {}])


def debug(page, **kw):
    page.evaluate('(d) => { Object.keys(d).forEach((k) => { HF.player.debug[k] = d[k]; }); return true; }', kw)


def save(page, name, clip=None):
    SHOTS.mkdir(parents=True, exist_ok=True)
    raw = SHOTS / (name + '.raw.png')
    page.screenshot(path=str(raw), full_page=False, clip=clip, animations='disabled', caret='hide')
    out = SHOTS / (name + '.png')
    try:
        from PIL import Image
        img = Image.open(raw).convert('RGB')
        q = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        q.save(out, optimize=True)
        raw.unlink()
    except Exception as e:   # Pillow missing: keep the full-colour PNG
        print(f'  note: {name}: not quantized ({e!r})')
        os.replace(raw, out)
    size = out.stat().st_size // 1024
    print(f'  {name}.png  {size} KB')
    return out


def wait_phase(page, phases, timeout=30000):
    phases = [phases] if isinstance(phases, str) else list(phases)
    page.wait_for_function('(ps) => ps.indexOf(HF.player.phase) >= 0', arg=phases, timeout=timeout)


def seeded(b, viewport, opts=None):
    """A user with three weeks of history (13 sessions) at the default session length (25 minutes = 14 blocks)."""
    ctx, page = new_page(b, viewport)
    boot(page)
    # 22 days back puts the last of the 13 training days at least a day ago, so Today offers session 14
    tsc.seed(page, dict({'minutes': 25, 'days': 22}, **(opts or {})))
    lessons_passed(page)
    reload(page)
    return ctx, page


# ---------------------------------------------------------------- the shots
def shot_today_phone(b):
    ctx, page = seeded(b, PHONE)
    try:
        go(page, 'today', wait=900)
        save(page, 'today-phone')
    finally:
        ctx.close()


def shot_chimera_popup(b):
    ctx, page = seeded(b, PHONE)
    try:
        reload(page, close=False)
        page.wait_for_function("() => !!document.querySelector('dialog[open] .hf-chimera')", timeout=10000)
        page.wait_for_timeout(500)
        save(page, 'chimera-popup')
    finally:
        ctx.close()


def shot_session_nback(b):
    ctx, page = seeded(b, PHONE)
    try:
        debug(page, timeScale=3, countdownStepMs=250)
        go(page, 'session', {'free': {'trackId': 'nback.dual', 'rung': 2, 'set': 'tones'}}, wait=500)
        wait_phase(page, 'rule')
        page.locator('.hf-play__start').click()                                   # real gesture: unlocks audio
        page.wait_for_function("""() => { const s = HF.player.state(); return s.phase === 'run' && +s.trial >= 3 &&
            !!document.querySelector('.hf-play .hf-nb__cell.is-on'); }""", timeout=60000, polling='raf')
        page.wait_for_timeout(120)
        save(page, 'session-nback')
    finally:
        ctx.close()


def shot_session_grid(b):
    ctx, page = seeded(b, PHONE)
    try:
        debug(page, timeScale=2, countdownStepMs=250)
        go(page, 'session', {'free': {'trackId': 'rel.grid.T1', 'rung': 0, 'set': 'digits'}}, wait=500)
        wait_phase(page, 'rule')
        page.locator('.hf-play__start').click()
        page.wait_for_function("""() => { const s = HF.player.state(); return s.phase === 'run' && +s.trial >= 1 &&
            !!document.querySelector('.hf-play .hf-rg__cell'); }""", timeout=60000, polling='raf')
        page.wait_for_timeout(400)
        save(page, 'session-grid')
    finally:
        ctx.close()


def shot_tutorial_tape(b):
    ctx, page = new_page(b, PHONE)
    try:
        boot(page)
        page.evaluate('() => { HF.store.reset(); HF.store.flush(true); return true; }')
        reload(page)
        page.evaluate("HF.router.go('learn', { lessonId: 'lesson.nback' })")
        page.wait_for_timeout(600)
        page.evaluate(tlb.HOOK_JS)
        tlb.set_speed(page, 0.35)

        def until(st):
            tr = st.get('trial') or {}
            return st.get('step') == 'guided:Your turn: 2-back' and tr.get('i') == 5 and st.get('expect') == 'answer'
        tlb.drive(page, until, mode='pass', max_s=600)
        page.wait_for_timeout(500)
        save(page, 'tutorial-tape')
    finally:
        ctx.close()


def shot_settings_styles(b):
    ctx, page = seeded(b, PHONE)
    try:
        go(page, 'settings', {'section': 'style'}, wait=1000)
        save(page, 'settings-styles')
    finally:
        ctx.close()


CARD_CLIP = """(re) => {
  const h = [...document.querySelectorAll('h1,h2,h3')].find((e) => new RegExp(re).test(e.textContent.trim()));
  let el = h;
  while (el && el !== document.body) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
    el = el.parentElement;
  }
  const r = (el && el !== document.body ? el : h).getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top - 14), width: window.innerWidth, height: Math.min(window.innerHeight, r.height + 28) };
}"""


def shot_lab_home(b):
    """Lab home for someone who chose Measure first, cropped to the dark "Next: Baseline 1" card (readable when small)."""
    ctx, page = new_page(b, PHONE)
    try:
        boot(page)
        page.evaluate('() => { HF.store.reset(); HF.store.flush(true); return true; }')
        lessons_passed(page, {'path': 'measure'})
        reload(page)
        go(page, 'lab', wait=900)
        clip = page.evaluate(CARD_CLIP, '^Next: ')
        save(page, 'lab-home', clip=clip)
    finally:
        ctx.close()


LAB_VISITS = [
    {'kind': 'B1', 'daysAgo': 29, 'scores': {'lab.nback': 1.2, 'lab.rel': 0.40, 'lab.sspan': 0.55, 'lab.update': 0.6, 'lab.matrix': 0.44, 'lab.series': 0.5, 'lab.graph': 0.5, 'lab.switch': 160}},
    {'kind': 'B2', 'daysAgo': 25, 'scores': {'lab.nback': 1.5, 'lab.rel': 0.46, 'lab.sspan': 0.6, 'lab.update': 0.63, 'lab.matrix': 0.5, 'lab.series': 0.57, 'lab.graph': 0.56, 'lab.switch': 140}},
    {'kind': 'Q', 'daysAgo': 3, 'config': 'quick', 'scores': {'lab.nback': 2.1, 'lab.rel': 0.55}},
]


RESULTS_CLIP = """() => {
  const all = [...document.querySelectorAll('h1,h2,h3,h4,p,div')];
  const head = all.find((e) => /^Your results$/.test(e.textContent.trim()));
  const note = all.find((e) => /^N-back probe:/.test(e.textContent.trim()));
  let col = head;
  while (col.parentElement && col.getBoundingClientRect().width < 600) col = col.parentElement;
  const c = col.getBoundingClientRect(), h = head.getBoundingClientRect();
  const top = Math.max(0, h.top - 14), bottom = note ? note.getBoundingClientRect().top - 10 : top + 495;
  return { x: Math.max(0, c.left - 16), y: top, width: Math.min(window.innerWidth, c.width + 32), height: bottom - top };
}"""


def shot_lab_results(b):
    """Lab results on a computer, cropped to the results column's Near group, so the dot plots stay readable in print."""
    ctx, page = seeded(b, DESKTOP)
    try:
        page.evaluate(tlv.SEED_JS, {'visits': LAB_VISITS, 'sessions': 0})
        reload(page)
        go(page, 'lab', wait=900)
        page.evaluate("""() => { const el = document.querySelector('.hf-lab-level') || document.querySelector('.hf-dots');
          const sec = el && (el.closest('section') || el);
          if (sec) sec.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); return !!sec; }""")
        page.wait_for_timeout(500)
        clip = page.evaluate(RESULTS_CLIP)
        print('  clip', {k: round(v) for k, v in clip.items()}, flush=True)
        save(page, 'lab-results', clip=clip)
    finally:
        ctx.close()


def sess_phase(page, phases, timeout=60000):
    """Waits for the session screen's phase (.hf-sess[data-phase]: rule, debrief, summary, empty, lesson)."""
    page.wait_for_function("""(ps) => { const s = document.querySelector('.hf-sess');
      return !!s && ps.indexOf(s.getAttribute('data-phase')) >= 0; }""", arg=list(phases), timeout=timeout)
    return page.evaluate("() => document.querySelector('.hf-sess').getAttribute('data-phase')")


def play_like_a_person(page):
    """Answers the running n-back block like a good, imperfect player: the second match of the first stream is missed
    and two non-matches get a press (balanced accuracy about .85: no level change in Varied, so no celebration)."""
    page.wait_for_function("() => { const s = HF.player.state(); return s.phase === 'run' && !!s.spec; }", timeout=30000)
    info = page.evaluate("""() => { const sp = HF.player.state().spec; return { streams: sp.streams || ['main'],
        targets: sp.trials.map(function (t) { return t.target || {}; }) }; }""")
    streams, targets = info['streams'], info['targets']
    first = streams[0]
    tg = [i for i, t in enumerate(targets) if t.get(first)]
    skip = tg[1] if len(tg) > 1 else None
    nont = [i for i, t in enumerate(targets) if i >= 3 and not any(t.get(x) for x in streams)]
    extra = {nont[len(nont) // 3], nont[(2 * len(nont)) // 3]} if len(nont) >= 3 else set()
    plan = {}
    for i, t in enumerate(targets):
        keys = ['KeyK' if x == 'snd' else 'KeyJ' for x in streams if t.get(x) and not (x == first and i == skip)]
        if i in extra:
            keys.append('KeyJ')
        if keys:
            plan[i] = keys
    done = set()
    t_end = time.time() + 240
    while time.time() < t_end:
        st = page.evaluate("() => { const s = HF.player.state(); return { phase: s.phase, i: s.trial }; }")
        if st['phase'] not in ('run', 'countdown', 'paused'):
            break
        i = st['i']
        if i not in (None, ''):
            i = int(i)
            if i in plan and i not in done:
                page.wait_for_timeout(150)
                for k in plan[i]:
                    page.keyboard.press(k)
                done.add(i)
        page.wait_for_timeout(30)
    return {'planned': len(plan), 'pressed': len(done), 'missed': skip, 'extra': sorted(extra)}


def shot_debrief(b):
    ctx, page = seeded(b, PHONE)
    try:
        debug(page, simulate='correct', countdownStepMs=60)
        go(page, 'session', {'fresh': True}, wait=800)
        k = 0
        while k < 20:
            ph = sess_phase(page, ['rule', 'debrief', 'summary'], timeout=60000)
            if ph == 'summary':
                raise RuntimeError('session ended before a rated n-back block')
            if ph == 'debrief':
                page.locator('.hf-play-debrief .hf-btn--primary').first.click()
                page.wait_for_timeout(300)
                continue
            bp = page.evaluate("() => { const s = HF.player.state(); const bp = s.bp || {}; return { trackId: bp.trackId || '', role: bp.role || '' }; }")
            k += 1
            if k >= 4 and bp['trackId'].startswith('nback.') and bp['role'] == 'rated':
                debug(page, simulate=None, timeScale=0.5, countdownStepMs=250)
                page.locator('.hf-play__start').click()                           # a real gesture: unlocks audio
                print('  played', bp['trackId'], play_like_a_person(page), flush=True)
                sess_phase(page, ['debrief'], timeout=60000)
                page.wait_for_timeout(900)
                save(page, 'debrief')
                return
            page.locator('.hf-play__start').click()
            sess_phase(page, ['debrief'], timeout=60000)
        raise RuntimeError('no rated n-back block found')
    finally:
        ctx.close()


def shot_progress(b):
    ctx, page = seeded(b, PHONE)
    try:
        go(page, 'progress', wait=1200)
        page.evaluate("() => { const d = document.querySelector('details.hf-trk'); if (d) d.open = true; return !!d; }")
        page.wait_for_timeout(500)
        save(page, 'progress')
    finally:
        ctx.close()


SHOTS_ALL = {
    'today-phone': shot_today_phone, 'chimera-popup': shot_chimera_popup, 'session-nback': shot_session_nback,
    'tutorial-tape': shot_tutorial_tape, 'session-grid': shot_session_grid, 'settings-styles': shot_settings_styles,
    'lab-home': shot_lab_home, 'lab-results': shot_lab_results, 'debrief': shot_debrief, 'progress': shot_progress,
}


def main():
    names = [n for n in sys.argv[1:] if n in SHOTS_ALL] or list(SHOTS_ALL)
    t0 = time.time()
    failed = []
    with browser() as b:
        for n in names:
            print(n, flush=True)
            try:
                SHOTS_ALL[n](b)
            except Exception as e:
                failed.append(n)
                print(f'  FAILED: {e!r}'[:600], flush=True)
    print(f'done in {time.time() - t0:.0f} s; failed: {failed or "none"}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
