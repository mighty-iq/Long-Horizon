"""E2E (rename, 13 Nov 2026): the app is called Long-Horizon (working name Holdfast) and says why, in the places the copy
brief (briefs/long-horizon-copy.md) names. Chromium, one browser, one context at a time.

 A. First launch, fresh storage, phone 390 x 844 light: the Chimera pop-up ("Long-Horizon", the fixed sentence
    with the new name, real Discord link, URL as text, Start training focused); index.html's <title>, the screen title
    "… · Long-Horizon"; the header brand (name, label, the horizon mark: exact geometry, accent half sun); Welcome:
    descriptor, h1, tagline, the horizon line; no horizontal overflow; the tutorial's first page says n is your horizon.
 B. Desktop, dark: About has "Why Long-Horizon?" (tagline + the explanation), the version row; Learn: the Glossary's
    Horizon entry, How to play's tie-in lines; the share text's first and last lines.
 C. HF.player.horizonCheer on its own (n rises / pace half-step / Switch / Span / not revealed / other tasks), then a
    real Varied session (session harness, simulated correct answers): every debrief after a level-up shows "Your
    horizon grew: now N-back." exactly when n rose, else "New level reached".
Run: python3 tests/e2e/test_texts_rename.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib
import time

import test_screens_common as TSC
import test_session_lib as TSL
from helpers import ROOT, Check, browser, close_modals, file_url, run_main

OUT = pathlib.Path(_HF_OUT) / 'rename'
TAGLINE = 'Hold more in mind. Keep it straight.'
LINE = 'Your horizon is how many steps you can hold in mind and still work with. This trainer stretches it, one step at a time.'
WHY = ('In AI, a long-horizon task takes many steps in a row, and models are now rated by how long a task they can car'
       'ry through. Working memory is the same capacity in people: keeping a plan and its pieces intact while you work'
       ' through it. In n-back the n is your horizon, in Equal Steps it is how far back you compare, and in the relati'
       'on grid it is how many symbols you relate at once. Training pushes it further, and the Lab measures whether a '
       'longer horizon carries over to reasoning.')
MARK = ['M3.5 14.5h25', 'M10 14.5a6 6 0 0 1 12 0z', 'M12.5 18.5h7', 'M9.5 22h13', 'M6.5 25.5h19']


def shot(page, name, full=False):
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / (name + '.png')), full_page=full)


# ---------------------------------------------------------------- A. first launch on a phone
def part_first_launch(b, chk):
    ctx, page, con = TSC.new_page(b, TSC.PHONE)
    try:
        page.goto(file_url('index.html'))
        page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal[open] .hf-chimera')", timeout=10000)
        pop = page.evaluate("""() => { var d = document.querySelector('dialog.hf-modal[open]'), a = d.querySelector('a[href]');
          return { title: d.querySelector('.hf-chimera__title').textContent, text: d.querySelector('.hf-chimera__text').textContent,
            href: a.href, target: a.target, url: (d.querySelector('.hf-chimera__url') || {}).textContent || '',
            focus: document.activeElement ? document.activeElement.textContent.trim() : '' }; }""")
        chk.eq(pop['title'], 'Long-Horizon', 'pop-up title')
        chk.eq(pop['text'], 'A free working memory trainer, built by the Chimera community on Discord. Check it out! Share progress, suggest features and join community studies.', 'pop-up sentence')
        chk.ok(pop['href'] == 'https://discord.gg/chmr' and pop['target'] == '_blank' and 'discord.gg/chmr' in pop['url'], 'pop-up: real Discord link, URL printed')
        chk.eq(pop['focus'], 'Start training', 'pop-up: Start training focused')
        shot(page, 'rename-A-popup-phone')
        close_modals(page)
        page.wait_for_timeout(300)
        chk.ok('<title>Long-Horizon · working memory trainer</title>' in (ROOT / 'index.html').read_text(), 'index.html <title>')
        chk.eq(page.evaluate('document.title'), 'Welcome · Long-Horizon', 'screen title "… · Long-Horizon"')
        brand = page.evaluate("""() => { var b = document.querySelector('.hf-brand'), m = b && b.querySelector('svg.hf-mark');
          var bulb = m && m.querySelector('.hf-mark__bulb');
          return { name: (b.querySelector('.hf-brand__name') || {}).textContent, label: b.getAttribute('aria-label'),
            paths: m ? Array.prototype.map.call(m.querySelectorAll('path'), function (p) { return p.getAttribute('d'); }) : [],
            bulbFill: bulb ? getComputedStyle(bulb).fill : null, bulbStroke: bulb ? getComputedStyle(bulb).stroke : null,
            box: m ? m.getAttribute('viewBox') : null }; }""")
        chk.eq([brand['name'], brand['label']], ['Long-Horizon', 'Long-Horizon, go to Today'], 'header brand name and label')
        chk.eq(brand['paths'], MARK, 'header mark: horizon line, half sun, three rungs (exact geometry)')
        chk.ok(brand['box'] == '0 0 32 32' and brand['bulbFill'] not in (None, 'none', 'rgba(0, 0, 0, 0)') and brand['bulbStroke'] == 'none',
               'the half sun is filled with the accent, no stroke (%s)' % brand['bulbFill'])
        wel = page.evaluate("""() => { var w = document.querySelector('.hf-welcome'); var q = function (s) { var e = w.querySelector(s); return e ? e.textContent : null; };
          return { kicker: q('.hf-welcome__kicker'), h1: q('h1'), tagline: q('.hf-welcome__tagline'), lead: q('.hf-lead') }; }""")
        chk.eq([wel['kicker'], wel['h1'], wel['tagline']], ['Working memory trainer', 'Hello, and welcome to Long-Horizon', TAGLINE], 'Welcome: descriptor, name, tagline')
        chk.ok((wel['lead'] or '').startswith(LINE + ' A session is about 14 short blocks'), 'Welcome: the horizon line, then the session size')
        ov = TSC.overflow(page)
        chk.ok(ov['over'] <= 1, 'Welcome on a phone: no horizontal overflow %s' % ov)
        shot(page, 'rename-A-welcome-phone', full=True)
        page.evaluate("() => { HF.ui.lessons && HF.ui.lessons.config && (HF.ui.lessons.config.useViews = false); return true; }")
        page.click('#hf-welcome-start')
        page.wait_for_function("() => /What you will see/.test((document.getElementById('hf-screen') || {}).textContent || '')", timeout=15000)
        txt = page.evaluate("() => document.getElementById('hf-screen').textContent")
        chk.ok('That n is your horizon: you keep the last n items in mind and update them with every new one.' in txt, 'tutorial, first page: n is your horizon')
        shot(page, 'rename-A-tutorial-phone', full=True)
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- B. About, Learn, share (desktop, dark)
def part_about_learn(b, chk):
    ctx, page, con = TSC.new_page(b, TSC.DESKTOP, dark=True)
    try:
        TSC.boot(page)
        page.evaluate("""() => HF.store.mutate(function (r) { r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }); })""")
        TSC.go(page, 'about', wait=600)
        ab = page.evaluate("""() => { var sec = document.getElementById('why-name');
          return { title: document.title, h: sec ? (sec.querySelector('h2') || {}).textContent : null,
            tag: sec ? (sec.querySelector('.hf-about__tagline') || {}).textContent : null, text: sec ? sec.textContent : '',
            order: Array.prototype.map.call(document.querySelectorAll('#hf-screen h2'), function (h) { return h.textContent; }),
            page: document.getElementById('hf-screen').textContent }; }""")
        chk.eq(ab['h'], 'Why Long-Horizon?', 'About: "Why Long-Horizon?" section')
        chk.ok(ab['tag'] == TAGLINE and WHY in ab['text'], 'About: tagline and the explanation, word for word')
        chk.ok(ab['order'][:2] == ['The Chimera community', 'Why Long-Horizon?'], 'About: Chimera first, then the name (%s)' % ab['order'][:3])
        chk.ok('About Long-Horizon' in ab['page'] and ab['title'] == 'About · Long-Horizon', 'About: page title and document title')
        shot(page, 'rename-B-about-dark', full=True)
        TSC.go(page, 'learn', {'page': 'glossary'}, wait=500)
        g = page.evaluate("""() => { var dt = document.getElementById('g-horizon'); return dt ? [dt.textContent, dt.nextElementSibling.textContent] : null; }""")
        chk.ok(bool(g) and g[0] == 'Horizon' and g[1].startswith('How many steps you can hold in mind and still work with. In n-back and Equal Steps'),
               'Glossary: Horizon %r' % (g,))
        TSC.go(page, 'learn', {'page': 'howto'}, wait=500)
        how = page.evaluate("""() => { var o = {}; document.querySelectorAll('details[data-task]').forEach(function (d) {
          var p = d.querySelector('.hf-howto__horizon'); o[d.getAttribute('data-task')] = p ? p.textContent : null; }); return o; }""")
        chk.eq(how.get('nback.plain'), 'Here n is your horizon: you keep the last n items in mind and update them with every new one.', 'How to play: Plain n-back')
        chk.eq(how.get('nback.transform'), 'You don’t just hold the steps, you work on them: each one changes by a rule before you compare.', 'How to play: Transform')
        chk.eq(how.get('rel.grid'), 'You hold several items and the relation between them at once.', 'How to play: Relation Grid')
        chk.eq(how.get('span'), 'You hold a list while you do something else in between.', 'How to play: Complex span')
        chk.eq(how.get('vs.search'), None, 'How to play: no tie-in for the control task')
        t = page.evaluate('HF.ui.share.text(HF.store.records, HF.store.derived, { includeLevels: false })').split('\n')
        chk.eq([t[0], t[-1]], ['Training my working memory with Long-Horizon: hold more steps, keep them straight.',
                               'Free, built by the Chimera community on Discord: https://discord.gg/chmr'], 'share text: first and last lines')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- C. "Your horizon grew"
CHEER = """() => { var f = HF.player.horizonCheer, up = function (tid, a, b, x) { return [Object.assign({ type: 'level-up', trackId: tid, from: a, to: b }, x || {})]; };
  return [f(up('nback.plain', 3, 4), 'nback.plain'), f(up('nback.plain', 2, 3), 'nback.plain'), f(up('nback.dual', 1, 4), 'nback.dual'),
    f(up('nback.switch', 2, 3), 'nback.switch'), f(up('span.op', 1, 2), 'span.op'), f(up('nback.plain', 3, 4, { reveal: 'session-end' }), 'nback.plain'),
    f(up('rel.steps', 1, 3), 'rel.steps'), f([{ type: 'level-down', trackId: 'nback.plain', from: 4, to: 3 }], 'nback.plain'), f(up('nback.plain', 3, 4), 'nback.dual')]; }"""
DEBRIEF = """() => { var d = document.querySelector('.hf-play-debrief') || document.querySelector('.hf-debrief'); if (!d) return null;
  var ch = d.querySelector('.hf-debrief__cheer'), b = HF.store.records.blocks.slice(-1)[0] || {};
  var p0 = b.levelBefore != null ? HF.catalog.params(b.trackId, b.levelBefore) : {}, p1 = b.levelAfter != null ? HF.catalog.params(b.trackId, b.levelAfter) : {};
  return { cheer: ch ? ch.textContent.trim() : null, track: b.trackId, task: (HF.catalog.get(b.trackId) || {}).task, from: b.levelBefore,
    to: b.levelAfter, moved: b.moved, n0: p0.n, n1: p1.n, role: b.role }; }"""


def part_cheer(b, chk):
    url = TSL.build_page()
    ctx, page, con = TSL.new_page(b, TSL.DESKTOP, 'light')
    seen = []
    try:
        TSL.boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 30})
        chk.eq(page.evaluate(CHEER), ['Your horizon grew: now 3-back.', None, 'Your horizon grew: now 3-back.', 'Your horizon grew: now 2-back.',
                                      'Your horizon grew: now 4 items.', None, None, None, None], 'horizonCheer: n or list length rose, revealed now, this track')
        TSL.go_session(page)
        for _ in range(80):
            ph = TSL.wait_phase(page, ['rule', 'debrief', 'summary'], 40000)
            if ph == 'summary':
                break
            if ph == 'debrief':
                d = page.evaluate(DEBRIEF)
                if d and d['moved'] and d['moved'] > 0:
                    seen.append(d)
            page.keyboard.press('Space')
            page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
        grew = [d for d in seen if d['task'] == 'nback' and d['n1'] > d['n0']]
        for d in seen:
            want = ('Your horizon grew: now %d-back.' % d['n1']) if d in grew else 'New level reached'
            chk.eq(d['cheer'], want, 'debrief after a level-up of %s (%s -> %s)' % (d['track'], d['from'], d['to']))
        chk.ok(len(grew) >= 1, 'the session had at least one n-back level-up that raised n (%d level-ups, %d grew)' % (len(seen), len(grew)))
        chk.details['level_ups'] = seen
        shot(page, 'rename-C-summary', full=True)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('texts-rename')
    t0 = time.time()
    cons = []
    with browser() as b:
        for part in (lambda: part_first_launch(b, chk), lambda: part_about_learn(b, chk), lambda: part_cheer(b, chk)):
            try:
                cons.append(part())
            except Exception as e:
                chk.ok(False, 'a part crashed: %s' % str(e)[:400])
    errs = []
    for c in cons:
        errs += list(getattr(c, 'page_errors', []))
        errs += [i['text'] for i in getattr(c, 'items', []) if i.get('kind') in ('pageerror', 'console')]
        errs += list(getattr(c, 'errors', []))
    chk.ok(not errs, 'console and page errors: %s' % errs[:5])
    chk.details['seconds'] = round(time.time() - t0, 1)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'texts-rename.json').write_text(json.dumps(chk.result(), indent=2))
    return chk.result()


if __name__ == '__main__':
    run_main(run)
