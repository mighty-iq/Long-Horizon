"""E2E (Phase 4 texts/UX fix round): the in-app text and UX fixes, each checked the way it failed (Chromium, one
browser, one context at a time). UX-06 (End in the pause menu asks first) is checked in test_session_pause.py.

Session harness (tests/e2e/pages/session-app.html via test_session_lib):
 A. UX-02  rule cards name the pads the block has: visual search Present / Absent, Span True / False; the Span block's
           own pads, group label and question say True / False; the search debrief line says "said Present".
    UX-05  the Relation Stream card's "Do nothing" row reads "until one does" (it read "when until one does").
    UX-11  the Relation Grid card says "Only the last symbol of each cell counts."
    PQ-14  level chips name the version once ("Grid T1 · step 4 of 9", "Stream · step 4 of 6"); no chip repeats its
           name or a Grid tier; HF.player.levelWords gives "Step 4 of 9" on a Grid tier.
    UX-03  the summary's "next session" line follows the reason (today / gap / week / Stretch), with the plan stubbed.
 B. UX-03  real sessions: Varied → "Today's counted sessions are done; … from tomorrow."; Sprint → "… need a gap …".
    UX-09  a 2-back debrief's Details row says "Lures … items that almost fit the rule", not "near misses".
Full app (index.html):
 C. UX-20  at 360 × 640 the rule card's keys end above Start (the Start row is not sticky there; the rule text is
           18 px) and Start can be scrolled clear of the tab bar; at 390 × 844 the Start row stays sticky.
 D. Seeded history (test_screens_common.STANDARD_SEED), desktop light: UX-01 hover, focus and arrow keys on the
           Minutes chart give a "Week of …" readout and no page error; UX-17 the multi-series chart dashes lines 2
           and 3 (legend too), the single-series Minutes chart stays solid; UX-13 no skill estimate in other units;
           UX-07 / UX-12 / UX-15 Settings and Progress wording; UX-18 the selected style card's description uses ink-2;
           SC-03 / SC-10 the Protocols texts; SC-12 the Learn "why" page points to the guide's chapter 13.
 E. Small seed (5 sessions, an export after the 4th), phone 390 × 844: UX-15 "1 session since your last backup";
           UX-14 the style hint does not offer Stretch before it opens; UX-19 the footer's Discord link and the Study
           page's Discord link are at least 44 px tall.
 F. Dark theme: UX-18 the Lab's next-visit row text uses ink-2.
Run: python3 tests/e2e/test_texts_fixes.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib
import time

import test_screens_common as TSC
from helpers import Check, browser, file_url, run_main
from test_session_lib import (DESKTOP, PHONE, SKIPPED, SMALL, boot, build_page, go_session, new_page, wait_phase)

OUT = pathlib.Path(os.environ.get('HF_E2E_OUT_TEXTS', _HF_OUT + '/phase4/texts'))
INK2_LIGHT = 'rgb(61, 85, 98)'      # --hf-ink-2 light #3D5562
INK2_DARK = 'rgb(169, 189, 198)'    # --hf-ink-2 dark #A9BDC6

RULE = """(a) => {
  var host = document.getElementById('hf-test-host');
  if (!host) { host = document.createElement('div'); host.id = 'hf-test-host'; document.getElementById('hf-screen').appendChild(host); }
  while (host.firstChild) host.removeChild(host.firstChild);
  window.__rb = null;
  HF.player.runBlock({ trackId: a.trackId, rung: a.rung, set: a.set, seed: 'tx-' + a.trackId + '-' + a.rung, role: 'probe' },
    { root: host, commit: false, debrief: false }).then(function (r) { window.__rb = r.status; });
  return true;
}"""
CARD = """() => { var card = document.querySelector('.hf-play-rule'); if (!card) return null;
  var q = function (s) { var e = card.querySelector(s); return e ? e.textContent.trim() : null; };
  return { chipName: q('.hf-chip__name'), chipLvl: q('.hf-chip__lvl'), text: card.innerText,
    rows: Array.prototype.map.call(card.querySelectorAll('.hf-keys__row'), function (r) {
      var pad = r.querySelector('.hf-keys__pad'), none = r.querySelector('.hf-keys__none'), when = r.querySelector('.hf-keys__when');
      return { pad: pad ? pad.textContent.trim() : null, none: none ? none.textContent.trim() : null, when: when ? when.textContent.trim() : '' }; }) }; }"""
ABORT = "() => { HF.player.abort('test'); return true; }"


def shot(page, name, full=False):
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / (name + '.png')), full_page=full)


def open_card(page, track, rung, sset):
    page.evaluate(RULE, {'trackId': track, 'rung': rung, 'set': sset})
    page.wait_for_function("() => HF.player.phase === 'rule' && !!document.querySelector('.hf-play-rule .hf-keys')", timeout=15000)
    return page.evaluate(CARD)


def close_card(page):
    page.evaluate(ABORT)
    page.wait_for_function("() => !HF.player.active", timeout=10000)


def play_to_end(page):
    for _ in range(80):
        ph = wait_phase(page, ['rule', 'debrief', 'summary'], 40000)
        if ph == 'summary':
            return True
        page.keyboard.press('Space')
        page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)
    return False


# ---------------------------------------------------------------- A. rule cards, chips, pads, next-session text
def part_cards(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, debug={'countdownStepMs': 40})
        # UX-02: visual search
        c = open_card(page, 'vs.search', 0, 'tl')
        chk.eq([r['pad'] for r in c['rows']], ['Present', 'Absent'], 'UX-02: the search rule card names the Present / Absent pads')
        shot(page, 'texts-A-rule-vsearch')
        close_card(page)
        # UX-02: Span card, then the block's own pads and question
        c = open_card(page, 'span.op', 0, 'letters')
        chk.eq([r['pad'] for r in c['rows']], ['True', 'False'], 'UX-02: the Span rule card names True / False')
        page.locator('.hf-play__start').click()
        page.wait_for_function("() => { var q = document.querySelector('.hf-play .hf-sp__q'); return HF.player.phase === 'run' && !!q; }", timeout=15000)
        sp = page.evaluate("""() => { var g = document.querySelector('.hf-play .hf-pads');
          return { q: document.querySelector('.hf-play .hf-sp__q').textContent, group: g ? g.getAttribute('aria-label') : null,
            pads: Array.prototype.map.call(document.querySelectorAll('.hf-play .hf-pad__label'), function (e) { return e.textContent; }) }; }""")
        chk.eq(sp, {'q': 'True or false?', 'group': 'Answer: false or true', 'pads': ['False', 'True']},
               'UX-02: the Span block asks "True or false?" with False / True pads (No on the left)')
        shot(page, 'texts-A-span-pads')
        close_card(page)
        # UX-02: the search debrief line
        line = page.evaluate("""() => [HF.player.plainLine({ plain: { caught: 9, targets: 10, falsePresses: 2 }, extra: {} }, { trackId: 'vs.search' }),
          HF.player.plainLine({ plain: { caught: 10, targets: 10, falsePresses: 0 }, extra: {} }, { trackId: 'vs.search' })]""")
        chk.ok('said Present twice when there was none' in line[0] and 'never said Present' in line[1] and '"T"' not in ''.join(line),
               'UX-02: the search debrief says "said Present" %s' % line)
        # UX-05 + PQ-14: Relation Stream
        c = open_card(page, 'rel.stream', 3, 'digits')
        none = [r for r in c['rows'] if r['none']]
        chk.ok(none and none[0]['when'].startswith('until one does') and 'when until' not in c['text'],
               'UX-05: the Stream card reads "Do nothing · until one does" %s' % (none and none[0]))
        chk.eq((c['chipName'], c['chipLvl']), ('Stream', 'step 4 of 6'), 'PQ-14: the Stream chip names the version once')
        shot(page, 'texts-A-rule-stream')
        close_card(page)
        # UX-11 + PQ-14: Relation Grid
        c = open_card(page, 'rel.grid.T1', 3, 'digits')
        chk.ok('Only the last symbol of each cell counts.' in c['text'] and 'string' not in c['text'],
               'UX-11: the Grid card speaks of cells, not strings')
        chk.eq((c['chipName'], c['chipLvl']), ('Grid T1', 'step 4 of 9'), 'PQ-14: the Grid chip names the tier once')
        close_card(page)
        # PQ-14: no chip repeats its name; levelWords on a Grid tier
        chips = []
        for track, rung, sset in (('nback.plain', 3, 'letters'), ('nback.switch', 1, 'digits'), ('rel.steps', 3, 'numbers'),
                                  ('rel.grid.T5', 0, 'digits'), ('span.op', 2, 'letters'), ('vs.search', 3, 'tl')):
            c = open_card(page, track, rung, sset)
            chips.append((track, c['chipName'], c['chipLvl']))
            close_card(page)
        bad = [x for x in chips if not x[1] or not x[2] or x[1].lower() in x[2].lower() or 'Tier' in x[2]]
        chk.ok(not bad, 'PQ-14: chips name each version once %s' % chips)
        lw = page.evaluate("() => [HF.player.levelWords('rel.grid.T2', 3), HF.player.levelWords('rel.stream', 1), HF.player.levelWords('nback.plain', 3)]")
        chk.eq(lw, ['Step 4 of 9', 'Step 2 of 6', '2-back, fast pace'], 'PQ-14: levelWords without the tier (version names say it)')
        # UX-03: the next-session line per reason (the plan stubbed; real plans in part B)
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
        wait_phase(page, 'rule', 20000)
        texts = page.evaluate("""(cases) => { var S = HF.session.current(), orig = HF.engine.plan, out = [];
          try { cases.forEach(function (c) {
            HF.engine.plan = function () { return { modeId: c[1], free: false, slots: [{}, {}], estMinutes: 10, notes: [{ code: 'not-counted', reason: c[0], text: 'planner text' }] }; };
            out.push(S.nextText()); }); } finally { HF.engine.plan = orig; }
          return out; }""", [['day-limit', 'varied'], ['day-limit', 'sprint'], ['gap', 'sprint'], ['week-cap', 'stretch'], ['day-limit', 'stretch'], ['gap', 'stretch']])
        want = ["Today's counted sessions are done; the next one counts from tomorrow.",
                "Today's counted sessions are done; the next one counts from tomorrow.",
                'Counted sessions need a gap (Sprint 3 h, Stretch 20 h); a session before then is extra practice.',
                "This week's counted sessions are done; the next one counts from Monday.",
                'Stretch counts sessions at least 20 hours apart; a session before then is extra practice.',
                'Stretch counts sessions at least 20 hours apart; a session before then is extra practice.']
        got = [t.split('. ', 1)[1] if t and '. ' in t else t for t in texts]
        chk.eq(got, want, 'UX-03: the summary says why the next session would not count, per reason')
        # UX-06 (rest in test_session_pause.py): leaving the route while the End confirm is open takes the confirm along
        page.evaluate("() => { HF.player.debug.timeScale = 0.6; }")
        page.keyboard.press('Space')
        page.wait_for_function("() => { var s = HF.player.state(); return s.phase === 'run' && +s.trial >= 2; }", timeout=30000, polling='raf')
        page.keyboard.press('Escape')
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--pause[open]')", timeout=10000)
        page.wait_for_timeout(450)
        page.locator('dialog.hf-modal--pause[open] .hf-btn', has_text='End session').first.click()
        page.wait_for_function("() => !!document.querySelector('dialog.hf-modal--confirm[open]')", timeout=5000)
        page.evaluate("() => HF.router.go('today')")
        page.wait_for_timeout(500)
        left = page.evaluate("() => ({ confirm: !!document.querySelector('dialog.hf-modal--confirm'), pause: !!document.querySelector('dialog.hf-modal--pause'), active: HF.player.active })")
        chk.eq(left, {'confirm': False, 'pause': False, 'active': False}, 'UX-06: leaving the route closes the pause menu and its End confirm')
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- B. real sessions: per-reason line, lure details
def part_sessions(b, url, chk):
    cons = []
    for mode, want in (('varied', "Today's counted sessions are done; the next one counts from tomorrow."),
                       ('sprint', 'Counted sessions need a gap (Sprint 3 h, Stretch 20 h); a session before then is extra practice.')):
        ctx, page, con = new_page(b, DESKTOP, 'light')
        cons.append(con)
        try:
            boot(page, url, settings={'sessionMinutes': 10, 'mode': mode}, debug={'simulate': 'correct', 'countdownStepMs': 30})
            go_session(page)
            ok = play_to_end(page)
            # the summary shows ONE note of the next plan (new version, reflection, Mastery check or not-counted, the
            # first in plan order): when not-counted is that note, its line must match the plan's reason
            st = page.evaluate("""() => { var s = document.querySelector('.hf-sess'), np = HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() + 1000 });
              var shown = (np.notes || []).filter(function (n) { return /^(new-track|reflection|mastery-check|not-counted)$/.test(n.code); })[0];
              return { text: s ? s.innerText : '', reason: np.counts ? np.counts.reason : null, shown: shown ? shown.code : null }; }""")
            want_reason = 'day-limit' if mode == 'varied' else 'gap'
            chk.eq(st['reason'], want_reason, 'UX-03: after a %s session the next one would not count (%s)' % (mode, want_reason))
            if st['shown'] == 'not-counted':
                chk.ok(ok and want in st['text'], 'UX-03: %s session summary: %r' % (mode, want))
            else:
                chk.ok(ok and 'counts from tomorrow' not in st['text'] and 'need a gap' not in st['text'],
                       'UX-03: %s summary shows the plan\'s first note (%s), no not-counted line' % (mode, st['shown']))
            chk.ok(mode == 'varied' or 'from tomorrow' not in st['text'], 'UX-03: %s summary does not say "from tomorrow"' % mode)
            chk.details['summary_' + mode] = {'reason': st['reason'], 'shown': st['shown']}
            shot(page, 'texts-B-summary-' + mode, full=True)
        finally:
            ctx.close()
    # UX-09: a 2-back block's Details row
    ctx, page, con = new_page(b, DESKTOP, 'light')
    cons.append(con)
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 30})
        go_session(page, {'free': {'trackId': 'nback.plain', 'rung': 2}})
        wait_phase(page, 'rule', 20000)
        page.keyboard.press('Space')
        wait_phase(page, 'debrief', 40000)
        det = page.evaluate("""() => { var d = document.querySelector('.hf-play-debrief details'); if (d) d.open = true;
          var lt = (HF.store.records.blocks.slice(-1)[0] || {}).result; return { text: d ? d.innerText : '', lureTrials: lt && lt.streams && lt.streams.main ? lt.streams.main.lureTrials || lt.streams.main.lt : null }; }""")
        chk.ok('Lures' in det['text'] and 'items that almost fit the rule (Glossary: Lure)' in det['text'] and 'near miss' not in det['text'],
               'UX-09: the Details row says "Lures … items that almost fit the rule" %r' % det['text'][:300])
        shot(page, 'texts-B-debrief-lures', full=True)
        page.evaluate("() => HF.router.go('today')")
    finally:
        ctx.close()
    return cons


# ---------------------------------------------------------------- C. rule card on short screens (full app)
FOLD = """() => { var card = document.querySelector('.hf-play-rule'); if (!card) return null;
  var sy = window.scrollY, r = function (e) { if (!e) return null; var b = e.getBoundingClientRect(); return { top: Math.round(b.top + sy), bottom: Math.round(b.bottom + sy) }; };
  var foot = card.querySelector('.hf-rule__foot'), nav = document.querySelector('.hf-nav');
  return { vh: innerHeight, keys: r(card.querySelector('.hf-keys')), start: r(card.querySelector('.hf-play__start')),
    footPos: foot ? getComputedStyle(foot).position : null, font: getComputedStyle(card.querySelector('.hf-rule__text')).fontSize,
    navTop: nav && getComputedStyle(nav).position === 'fixed' ? Math.round(nav.getBoundingClientRect().top) : null }; }"""


def part_fold(b, chk):
    cons = []
    app = file_url('index.html')
    for vp, name in ((SMALL, 'small'), (PHONE, 'phone')):
        ctx, page, con = new_page(b, vp, 'light')
        cons.append(con)
        try:
            boot(page, app, settings={'sessionMinutes': 10}, debug={'countdownStepMs': 40})
            for track, rung in (('rel.grid.T2', 0), ('rel.stream', 3)):
                page.evaluate("() => HF.router.go('today')")
                page.wait_for_timeout(250)
                page.evaluate('(a) => HF.router.go("session", { free: { trackId: a[0], rung: a[1], pace: "normal" } })', [track, rung])
                page.wait_for_function("() => HF.player.phase === 'rule' && !!document.querySelector('.hf-play-rule .hf-play__start')", timeout=20000)
                page.wait_for_timeout(300)
                page.evaluate('() => window.scrollTo(0, 0)')
                f = page.evaluate(FOLD)
                if name == 'small':
                    chk.ok(f['footPos'] == 'static' and f['font'] == '18px' and f['keys']['bottom'] <= f['start']['top'],
                           'UX-20: 360 × 640 %s: the keys come before Start (not under a sticky Start) %s' % (track, f))
                    shot(page, 'texts-C-fold-%s-top' % track.replace('.', '_'))
                    page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
                    page.wait_for_timeout(200)
                    sb = page.evaluate("() => { var e = document.querySelector('.hf-play__start'), n = document.querySelector('.hf-nav'); var b = e.getBoundingClientRect(); return { bottom: Math.round(b.bottom), navTop: n && getComputedStyle(n).position === 'fixed' ? Math.round(n.getBoundingClientRect().top) : innerHeight }; }")
                    chk.ok(sb['bottom'] <= sb['navTop'], 'UX-20: 360 × 640 %s: scrolled down, Start sits above the tab bar %s' % (track, sb))
                    shot(page, 'texts-C-fold-%s-bottom' % track.replace('.', '_'))
                else:
                    chk.ok(f['footPos'] == 'sticky', 'UX-20: 390 × 844 %s: the Start row stays sticky %s' % (track, f))
        finally:
            ctx.close()
    return cons


# ---------------------------------------------------------------- D. seeded history, desktop light
def part_seeded(b, chk):
    ctx, page, con = TSC.new_page(b, TSC.DESKTOP)
    try:
        TSC.boot(page)
        info = TSC.seed(page)
        chk.ok(info['sessions'] >= 10, 'seeded %s' % info)
        TSC.reload(page)
        TSC.go(page, 'progress', wait=900)
        # UX-01: the Minutes chart readout
        n0 = len([i for i in con.items if i['kind'] == 'pageerror'])
        plot = page.locator('.hf-chart--minutes .hf-chart__plot').first
        plot.scroll_into_view_if_needed()
        box = plot.bounding_box()
        page.mouse.move(box['x'] + box['width'] * 0.6, box['y'] + box['height'] * 0.5)
        page.wait_for_timeout(250)
        head1 = page.evaluate("() => { var e = document.querySelector('.hf-chart--minutes .hf-tip__head'); return e ? e.textContent : null; }")
        plot.focus()
        page.keyboard.press('ArrowRight')
        page.keyboard.press('ArrowLeft')
        page.wait_for_timeout(150)
        head2 = page.evaluate("() => { var e = document.querySelector('.hf-chart--minutes .hf-tip:not([hidden]) .hf-tip__head'); return e ? e.textContent : null; }")
        errs = [i['text'] for i in con.items if i['kind'] == 'pageerror'][n0:]
        chk.ok(not errs and head1 and head1.startswith('Week of ') and head2 and head2.startswith('Week of '),
               'UX-01: hover and arrow keys give a "Week of …" readout, no page error (%r, %r, %s)' % (head1, head2, errs[:2]))
        shot(page, 'texts-D-minutes-readout')
        # UX-17: dashes on the multi-series chart only
        dash = page.evaluate("""() => { var st = function (sel) { var e = document.querySelector(sel); return e ? getComputedStyle(e).strokeDasharray : null; };
          var cur = document.querySelector('.hf-chart--curves');
          return { multi: cur ? cur.classList.contains('hf-chart--multi') : null, n: cur ? cur.querySelectorAll('.hf-chart__svg .hf-chart__line').length : 0,
            s1: st('.hf-chart--curves .hf-chart__svg .hf-chart__line.hf-s1'), s2: st('.hf-chart--curves .hf-chart__svg .hf-chart__line.hf-s2'),
            s3: st('.hf-chart--curves .hf-chart__svg .hf-chart__line.hf-s3'), key2: st('.hf-chart--curves .hf-legend__key line.hf-s2'),
            minutes: st('.hf-chart--minutes .hf-chart__svg .hf-chart__line'),
            minutesMulti: document.querySelector('.hf-chart--minutes').classList.contains('hf-chart--multi') }; }""")
        chk.ok(dash['multi'] and dash['n'] >= 2 and dash['s1'] == 'none' and dash['s2'] == '7px, 4px' and dash['key2'] == '7px, 4px'
               and dash['s3'] in (None, '2px, 4px') and dash['minutes'] == 'none' and not dash['minutesMulti'],
               'UX-17: lines 2 and 3 are dashed / dotted (legend too); single-series charts stay solid %s' % dash)
        # UX-13: skill estimates in the level's own unit
        eq = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-trk__sum'), function (s) { return s.innerText.replace(/\\s+/g, ' '); })")
        skills = [x.split('skill', 1)[1].split('Personal best')[0].strip() for x in eq if 'skill' in x]
        bad = [s for s in skills if 'Tier' in s or 'change' in s or ' at ' in s]
        chk.ok(not bad and any(s.startswith('≈ step') for s in skills), 'UX-13: skill estimates in steps, never "Tier … at … s" %s' % (bad or skills))
        chk.details['skills'] = skills
        txt = page.evaluate("() => document.getElementById('hf-screen').innerText")
        chk.ok('Any day of the week counts, so a session can be made up later' in txt and 'missed day' not in txt, 'UX-07: Progress weekly goal without "missed"')
        # UX-18: " · default" on the selected Varied card (the seed ends in Varied)
        TSC.go(page, 'settings', {'section': 'style'}, wait=700)
        dc = page.evaluate("() => { var d = document.querySelector('.hf-mode.is-checked .hf-mode__def'); return d ? getComputedStyle(d).color : null; }")
        chk.eq(dc, INK2_LIGHT, 'UX-18: the selected style card\'s " · default" uses ink-2 (light)')
        # Settings: SC-03 / SC-10 / UX-07 / UX-12 / UX-15
        page.evaluate("""() => HF.store.mutate(function (r) { var s = Object.assign({}, r.settings); s.mode = 'protocols';
          s.protocols = { cao: true, wang: true, jaeggi: true }; s.updatedAt = Date.now(); r.settings = s; })""")
        TSC.go(page, 'settings', {'section': 'style'}, wait=700)
        st = page.evaluate("""() => { var p = document.querySelector('.hf-protos'); var lim = document.querySelectorAll('.hf-protos__limits');
          return { protos: p ? p.innerText : '', limits: Array.prototype.map.call(lim, function (d) { return d.textContent; }).join(' | '),
            all: document.getElementById('hf-screen').innerText }; }""")
        chk.ok('as closely as its paper allows' in st['protos'] and 'choices are listed in the guide' in st['protos'] and 'exactly' not in st['protos'],
               'SC-03: the Protocols box says "as closely as its paper allows", not "exactly as published"')
        chk.ok('Long-Horizon plays tones unless you choose spoken letters under Sound; the paper used spoken consonants.' in st['protos'],
               'SC-03: the Jaeggi protocol says Long-Horizon plays tones unless spoken letters are chosen')
        chk.ok('letters recalled still favoured the executive group (p = .028, post-test and follow-up pooled)' in st['limits'],
               'SC-10: the Cao limits state the follow-up precisely')
        chk.ok('Remember letters or symbols while you check sums.' in st['all'] and 'any day of the week counts' in st['all']
               and '“Last three blocks” meters' in st['all'] and 'missed day' not in st['all'] and 'equations' not in st['all'],
               'UX-07 / UX-12 / UX-15: Settings wording')
        shot(page, 'texts-D-settings-protocols', full=True)
        # SC-12: the source list points to the guide
        TSC.go(page, 'learn', {'page': 'why'}, wait=500)
        why = page.evaluate("() => document.getElementById('hf-screen').textContent")
        chk.ok('The full list, with links, is in the Long-Horizon guide (PDF), chapter 13.' in why and 'ship with Long-Horizon' not in why,
               'SC-12: the Learn "why" page points to the guide\'s chapter 13')
        chk.ok('(p = .028, post-test and follow-up pooled)' in why and 'Long-Horizon calls it Equal Steps' in why and 'spatial complex span' in why
               and 'exactly' not in why, 'SC-03 / SC-10 / SC-11: the research page wording')
        mine = [i for i in con.items if i['kind'] == 'pageerror' or 'long-horizon' in i['text'].lower()]
        chk.ok(not mine, 'D: no page errors %s' % mine[:3])
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- E. small seed, phone
def part_today_phone(b, chk):
    ctx, page, con = TSC.new_page(b, TSC.PHONE)
    try:
        TSC.boot(page)
        info = TSC.seed(page, {'days': 10, 'trainDays': [0, 2, 4, 6, 8], 'modeAt': {}, 'note': False, 'keepLogsFrom': None,
                               'lastExportDaysAgo': 3, 'minutes': 10})
        TSC.reload(page)
        TSC.go(page, 'today', wait=700)
        t = page.evaluate("""() => { var q = function (s) { var e = document.querySelector(s); return e ? e.innerText : null; };
          return { backup: q('.hf-today__backup'), hint: q('.hf-today__hint'), counted: HF.store.derived.sessionsCounted }; }""")
        chk.ok(t['backup'] and 'You have done 1 session since your last backup' in t['backup'],
               'UX-15: "1 session since your last backup" (%r; seed %s)' % (t['backup'], info))
        chk.ok(t['hint'] and 'Stretch opens after 6 counted sessions' in t['hint'] and 'Sprint, Stretch' not in t['hint'],
               'UX-14: the style hint does not offer Stretch before it opens (%r)' % t['hint'])
        foot = page.evaluate("() => { var a = document.querySelector('.hf-footer a'); if (!a || a.closest('[hidden]')) return null; var b = a.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }")
        chk.ok(foot and foot['h'] >= 44, 'UX-19: the footer Discord link is a ≥ 44 px tap target %s' % foot)
        shot(page, 'texts-E-today-phone', full=True)
        TSC.go(page, 'study', wait=600)
        sl = page.evaluate("() => { var a = document.querySelector('[data-chimera] .hf-link'); if (!a) return null; var b = a.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }")
        chk.ok(sl and sl['h'] >= 44, 'UX-19: the Study page\'s Discord link is a ≥ 44 px tap target %s' % sl)
        ov = TSC.overflow(page)
        chk.ok(ov['over'] <= 1, 'Study page: no horizontal overflow at 390 px %s' % ov)
        shot(page, 'texts-E-study-phone', full=True)
        mine = [i for i in con.items if i['kind'] == 'pageerror']
        chk.ok(not mine, 'E: no page errors %s' % mine[:3])
    finally:
        ctx.close()
    return con


# ---------------------------------------------------------------- F. dark Lab schedule
def part_lab_dark(b, chk):
    ctx, page, con = TSC.new_page(b, TSC.DESKTOP, dark=True)
    try:
        TSC.boot(page)
        page.evaluate("""() => HF.store.mutate(function (r) { r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }); })""")
        TSC.go(page, 'lab', wait=700)
        c = page.evaluate("() => { var e = document.querySelector('.hf-lab-sched > li.is-next .hf-lab-sched__what'); return e ? getComputedStyle(e).color : null; }")
        chk.eq(c, INK2_DARK, 'UX-18: the Lab\'s next-visit row text uses ink-2 (dark)')
        shot(page, 'texts-F-lab-dark', full=True)
    finally:
        ctx.close()
    return con


def run():
    chk = Check('texts-fixes')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        for part in (lambda: [part_cards(b, url, chk)], lambda: part_sessions(b, url, chk), lambda: part_fold(b, chk),
                     lambda: [part_seeded(b, chk)], lambda: [part_today_phone(b, chk)], lambda: [part_lab_dark(b, chk)]):
            try:
                cons.extend(part())
            except Exception as e:
                chk.ok(False, 'a part crashed: %s' % str(e)[:400])
    errs = []
    for c in cons:
        errs += [x for x in getattr(c, 'page_errors', [])]
        errs += [i['text'] for i in getattr(c, 'items', []) if i.get('kind') == 'pageerror']
    chk.ok(not errs, 'page errors: %s' % errs[:5])
    chk.details['seconds'] = round(time.time() - t0, 1)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'texts-fixes.json').write_text(json.dumps(chk.result(), indent=2))
    return chk.result()


if __name__ == '__main__':
    run_main(run)
