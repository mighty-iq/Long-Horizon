"""Shared helpers for the session / player / n-back view e2e tests (owner: P1a). No tests in this file.

Harness: tests/e2e/pages/session-app.html is generated from js/manifest.json (pure + assets + dom scripts, CSS) but
without the other owners' screens (today, progress, settings, free, about, lab, labvisit, study, welcome, learn) and
the Lab test views, so a half-built screen elsewhere cannot break these tests; app.js still boots the real store,
shell, router (with its placeholder `today`) and the Chimera pop-up. Real views of P1b (relations, span, vsearch),
P4's lessons and P3's share module are loaded when present.

Bot: answers each block from the spec with REAL key presses (Playwright keyboard → trusted keydown events): it waits
until the player shows trial i (data-i on .hf-play) and presses J / K (stream targets) or J / F (discrete arrays).
Speed hooks (test only): HF.player.debug.timeScale (shorter onMs / soaMs / windows), .countdownStepMs, .simulate.
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib
import subprocess
import time

from helpers import ROOT, Check, Console, browser, close_modals, file_url

OUT = pathlib.Path(os.environ.get('HF_E2E_OUT_SESSION', _HF_OUT + '/session'))
PAGE = 'tests/e2e/pages/session-app.html'
SKIP_SCREENS = {'js/ui/today.js', 'js/ui/progress.js', 'js/ui/settings.js', 'js/ui/free.js', 'js/ui/about.js',
                'js/ui/lab.js', 'js/ui/labvisit.js', 'js/ui/study.js', 'js/ui/welcome.js', 'js/ui/learn.js'}
DESKTOP = {'width': 1366, 'height': 768}
PHONE = {'width': 390, 'height': 844}
SMALL = {'width': 360, 'height': 640}


SKIPPED = []   # scripts left out of the harness because `node --check` failed (another owner's work in progress)


def syntax_ok(rel):
    try:
        return subprocess.run(['node', '--check', str(ROOT / rel)], capture_output=True, timeout=30).returncode == 0
    except Exception:
        return True


def build_page(skip_extra=()):
    """Writes the harness page; returns its file:// URL."""
    man = json.loads((ROOT / 'js' / 'manifest.json').read_text())
    skip = set(SKIP_SCREENS) | set(skip_extra)
    css = [c for c in man.get('css', []) if (ROOT / c).exists()]
    scripts = []
    del SKIPPED[:]
    for rel in man.get('pure', []) + man.get('assets', []) + man.get('dom', []):
        if rel in skip or rel.startswith('js/lab/views/') or not (ROOT / rel).exists() or rel in scripts:
            continue
        if not syntax_ok(rel):
            SKIPPED.append(rel)
            continue
        scripts.append(rel)
    up = '../../../'
    html = ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
            '<meta name="color-scheme" content="light dark">', '<title>Long-Horizon · session harness</title>']
    html += ['<link rel="stylesheet" href="%s%s">' % (up, c) for c in css]
    html += ['</head>', '<body>', '<main id="hf-screen" class="hf-screen" tabindex="-1"></main>',
             '<div id="hf-toasts" class="hf-toasts" role="status" aria-live="polite"></div>']
    html += ['<script src="%s%s"></script>' % (up, s) for s in scripts]
    html += ['</body>', '</html>', '']
    (ROOT / PAGE).write_text('\n'.join(html))
    return file_url(PAGE)


def inline_page():
    """The harness as ONE self-contained HTML document (styles and scripts inlined) for srcdoc tests."""
    build_page()
    src = (ROOT / PAGE).read_text()
    out = []
    for line in src.splitlines():
        if line.startswith('<link rel="stylesheet" href="../../../'):
            rel = line.split('href="../../../', 1)[1].split('"', 1)[0]
            out.append('<style>' + (ROOT / rel).read_text().replace('</style', '<\\/style') + '</style>')
        elif line.startswith('<script src="../../../'):
            rel = line.split('src="../../../', 1)[1].split('"', 1)[0]
            out.append('<script>' + (ROOT / rel).read_text().replace('</script', '<\\/script') + '</script>')
        else:
            out.append(line)
    return '\n'.join(out)


def new_page(b, viewport=DESKTOP, theme='light', reduced=False):
    ctx = b.new_context(viewport=viewport, color_scheme=theme, reduced_motion='reduce' if reduced else 'no-preference',
                        device_scale_factor=1, has_touch=viewport['width'] < 600)
    page = ctx.new_page()
    con = Console(page)
    return ctx, page, con


def boot(page, url, settings=None, lessons_passed=True, debug=None, events=None):
    """Loads the harness, closes the Chimera pop-up, seeds settings/events, sets test hooks."""
    page.goto(url)
    page.wait_for_function('() => window.HF && HF.booted === true', timeout=20000)
    close_modals(page)
    page.evaluate("""(a) => {
      HF.store.mutate(function (r) {
        var s = {}; for (var k in r.settings) s[k] = r.settings[k];
        for (var k2 in a.settings) s[k2] = a.settings[k2];
        s.updatedAt = Date.now();
        r.settings = s;
        var ev = (r.events || []).slice();
        var have = {}; ev.forEach(function (e) { if (e && e.id) have[e.id] = 1; });
        var ALL = ['lesson.nback','lesson.dual','lesson.transform','lesson.arith','lesson.switch','lesson.steps','lesson.grid',
           'lesson.stream','lesson.span','lesson.vsearch','lesson.grid.T2','lesson.grid.T3'];
        if (a.lessons && !have['ev-test-lesson-0']) {
          (Array.isArray(a.lessons) ? a.lessons : ALL).forEach(function (id, i) {
            ev.push({ id: 'ev-test-lesson-' + i, t: Date.now() - 1000, type: 'lesson-passed', lessonId: id });
          });
        }
        (a.events || []).forEach(function (e) { if (!have[e.id]) ev.push(e); });
        r.events = ev;
        r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() });
      });
      if (HF.ui && HF.ui.shell && HF.ui.shell.applySettings) HF.ui.shell.applySettings(HF.store.records.settings);
      var d = a.debug || {};
      for (var k3 in d) HF.player.debug[k3] = d[k3];
    }""", {'settings': settings or {}, 'lessons': lessons_passed, 'debug': debug or {}, 'events': events or []})


def go_session(page, params=None):
    """Opens the session route. No params = a new session ({ fresh: true }): the bare route only continues today's open
    session and otherwise goes to Today (Phase 4, CB-05)."""
    page.evaluate('(p) => HF.router.go("session", p)', params or {'fresh': True})


def phase(page):
    return page.evaluate("() => { var s = document.querySelector('.hf-sess'); return s ? s.getAttribute('data-phase') : null; }")


def wait_phase(page, phases, timeout=60000):
    if isinstance(phases, str):
        phases = [phases]
    page.wait_for_function("""(ps) => { var s = document.querySelector('.hf-sess');
      return !!s && ps.indexOf(s.getAttribute('data-phase')) >= 0; }""", arg=list(phases), timeout=timeout)
    return phase(page)


def spec_digest(page):
    return page.evaluate("""() => { var s = HF.player.state(); if (!s.active || !s.spec) return null; var sp = s.spec;
      return { kind: sp.kind, seed: sp.seed, trackId: sp.trackId, streams: sp.streams || null, set: sp.set,
        trials: (sp.trials || []).map(function (t, i) { return { i: t.i !== undefined ? t.i : i, target: t.target || null,
          answer: t.answer || null }; }) }; }""")


def wait_trial(page, i, timeout=30000):
    """Waits until trial i (or a later one) is on screen, or the block left the run phase. Returns the trial shown."""
    page.wait_for_function("""(i) => { var s = HF.player.state();
      if (!s.active || (s.phase !== 'run' && s.phase !== 'countdown')) return true;
      return s.trial !== null && s.trial !== '' && +s.trial >= i; }""", arg=i, timeout=timeout, polling='raf')
    st = page.evaluate('() => { var s = HF.player.state(); return { phase: s.phase, trial: s.trial }; }')
    return st


def kb(page):
    """Keyboard of a Page, or of the page that holds a Frame (sandboxed srcdoc tests)."""
    return page.keyboard if hasattr(page, 'keyboard') else page.page.keyboard


UNEXPECTED_PAUSES = []   # pauses the bot did not ask for (e.g. the audio context stalling on a loaded machine)


def answer_block(page, mode='correct', stop_after=None, timeout=60000, on_trial=None):
    """Plays the running block with real key presses. mode: 'correct' | 'none'. on_trial(i) runs after trial i's keys.
    An unexpected pause is recorded in UNEXPECTED_PAUSES and resumed (a stream then restarts: the new spec is read).
    Returns a summary dict."""
    pressed, dig = 0, None
    for _attempt in range(3):
        page.wait_for_function("() => HF.player.phase === 'run' || HF.player.phase === 'debrief'", timeout=timeout)
        dig = spec_digest(page)
        if not dig:
            return {'pressed': pressed, 'trials': 0}
        paused = False
        for t in dig['trials']:
            if stop_after is not None and t['i'] >= stop_after:
                break
            st = wait_trial(page, t['i'], timeout=timeout)
            if st['phase'] == 'paused':
                paused = True
                break
            if st['phase'] != 'run' or st['trial'] is None or int(st['trial']) != t['i']:
                if st['phase'] != 'run':
                    break
                continue
            keys = []
            if mode == 'correct':
                if dig['kind'] == 'stream':
                    tg = t['target'] or {}
                    if tg.get('main') or tg.get('pos'):
                        keys.append('j')
                    if tg.get('snd'):
                        keys.append('k')
                else:
                    keys.append('j' if t['answer'] == 'match' else 'f')
            for k in keys:
                kb(page).press(k)
                pressed += 1
            if on_trial:
                on_trial(t['i'])
        if not paused:
            break
        UNEXPECTED_PAUSES.append(page.evaluate("() => { var d = document.querySelector('dialog.hf-modal--pause[open]'); return d ? d.textContent.slice(0, 120) : 'paused'; }"))
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
        page.wait_for_timeout(400)
        page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='Resume').click()
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
    return {'pressed': pressed, 'trials': len(dig['trials']) if dig else 0, 'seed': dig and dig['seed'], 'trackId': dig and dig['trackId']}


def start_block(page, how='space'):
    wait_phase(page, 'rule')
    if how == 'click':
        page.locator('.hf-play__start').click()
    elif how == 'enter':
        kb(page).press('Enter')
    else:
        kb(page).press('Space')


def records(page):
    return page.evaluate('() => JSON.parse(JSON.stringify(HF.store.records))')


def session_blocks(page, sid=None):
    return page.evaluate("""(sid) => { var r = HF.store.records; var s = HF.session && HF.session.current() ? HF.session.current().plan : null;
      var id = sid || (s && s.id); return (r.blocks || []).filter(function (b) { return b.sessionId === id; }); }""", sid)


def plan_id(page):
    return page.evaluate('() => { var s = HF.session && HF.session.current(); return s && s.plan ? s.plan.id : null; }')


def shot(page, name, full=False):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / (name + '.png')
    page.screenshot(path=str(path), full_page=full)
    return str(path)


def layout_ok(page):
    """No horizontal overflow; when the task layer is up, the pads sit inside the viewport (no scrolling)."""
    return page.evaluate("""() => {
      var w = window.innerWidth, h = window.innerHeight, out = { overflowX: document.documentElement.scrollWidth > w + 1 };
      var pads = document.querySelector('.hf-play .hf-pads');
      if (pads) { var r = pads.getBoundingClientRect(); out.padsBottom = r.bottom; out.padsInView = r.bottom <= h + 1 && r.top >= 0; }
      var stage = document.querySelector('.hf-play .hf-nb__stage, .hf-play .hf-play__view');
      if (stage && pads) { out.stageAbovePads = stage.getBoundingClientRect().top < pads.getBoundingClientRect().top; }
      return out; }""")


def wait_until(fn, timeout=10.0, step=0.05):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


def errors_of(con):
    return con.errors + con.page_errors


def finish(chk, con, t0):
    errs = errors_of(con)
    chk.ok(not errs, 'console errors: %s' % errs[:5])
    chk.details['seconds'] = round(time.time() - t0, 1)
    return chk.result()


def run_main(fn):
    res = fn()
    print(json.dumps({k: v for k, v in res.items() if k != 'details'}, indent=2))
    if res.get('details'):
        print(json.dumps(res['details'], indent=2, default=str)[:3000])
    raise SystemExit(0 if res['ok'] else 1)
