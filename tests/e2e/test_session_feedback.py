"""E2E (P1a): debrief events and feedback.

1. Varied (simulated answers, test hook): perfect blocks → the debrief celebrates a level-up (1 s cheer); the
   'track-available' event shows its one-line note; then two rated blocks at chance → the fatigue offer appears;
   "End session now" ends the session as 'fatigue'.
2. Focus mode: the same level-up debrief has no celebration and the summary hides the motivation layer (.hf-mot).
3. Reflection prompt (plan.reflection forced on for the test): the summary asks one question; Save writes a 'note'
   event.
4. Sprint: the rule card shows the strategy card; per-response feedback is on: real key presses flash data-fb on the
   pad ('good' on a match, 'bad' on a non-match), flashes are ≥ 1/3 s apart (J and K pressed together on a Dual
   double match give ONE flash), and the 'bad' ring is a neutral dashed outline (never red).
Run: python3 tests/e2e/test_session_feedback.py
"""
import time

from test_session_lib import (DESKTOP, PHONE, SKIPPED, Check, boot, browser, build_page, finish, go_session, kb,
                              new_page, plan_id, run_main, shot, spec_digest, start_block, wait_phase, wait_trial)

DEBRIEF = """() => ({ celebrate: !!document.querySelector('.hf-debrief--celebrate'),
  cheerVisible: (function () { var c = document.querySelector('.hf-debrief__cheer'); return !!c && getComputedStyle(c).display !== 'none'; })(),
  notes: Array.prototype.map.call(document.querySelectorAll('.hf-play-debrief .hf-notice'), function (n) { return n.textContent.trim(); }),
  line: (document.querySelector('.hf-debrief__line') || {}).textContent })"""

FB_SPY = """() => { window.__fb = [];
  new MutationObserver(function (ms) { ms.forEach(function (m) {
    var v = m.target.getAttribute('data-fb');
    if (v) { var cs = getComputedStyle(m.target); window.__fb.push({ v: v, key: m.target.getAttribute('data-key'), t: performance.now(), style: cs.outlineStyle, color: cs.outlineColor }); }
  }); }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-fb'] }); }"""


def next_phase(page, ph):
    page.wait_for_function("(p) => document.querySelector('.hf-sess').getAttribute('data-phase') !== p", arg=ph, timeout=20000)


def run_fatigue(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10}, debug={'simulate': 'correct', 'countdownStepMs': 40},
             lessons_passed=['lesson.nback', 'lesson.grid'])
        go_session(page, {})
        seen, fatigue = [], None
        for k in range(7):
            wait_phase(page, 'rule', 20000)
            if k == 3:
                page.evaluate("() => { HF.player.debug.simulate = 'none'; }")
            start_block(page)
            wait_phase(page, 'debrief', 20000)
            info = page.evaluate(DEBRIEF)
            seen.append(info)
            if k == 1:
                shot(page, 'feedback-1-levelup')
            if any('Time for a break' in n for n in info['notes']):
                fatigue = k
                shot(page, 'feedback-2-fatigue')
                break
            kb(page).press('Space')
            next_phase(page, 'debrief')
        chk.ok(any(x['celebrate'] and x['cheerVisible'] for x in seen), 'a level-up debrief celebrates %s' % [x['celebrate'] for x in seen])
        notes = [n for x in seen for n in x['notes']]
        chk.ok(any(n.startswith('New: ') and 'is open' in n for n in notes), 'track-available shows a one-line note %s' % notes)
        chk.eq(fatigue, 5, 'fatigue offered after two rated blocks at chance (block 6)')
        if fatigue is not None:
            page.locator('.hf-play-debrief [data-action="end"]').click()
            wait_phase(page, 'summary', 20000)
            pid = plan_id(page)
            sess = page.evaluate("(pid) => HF.store.records.sessions.filter(function (s) { return s.id === pid; })[0]", pid)
            chk.eq(sess['endedBy'], 'fatigue', 'End session now ends the session as fatigue')
    finally:
        ctx.close()
    return con


def run_focus_reflection(b, url, chk):
    ctx, page, con = new_page(b, PHONE, 'light')
    try:
        boot(page, url, settings={'sessionMinutes': 10, 'focusMode': True}, debug={'simulate': 'correct', 'countdownStepMs': 40})
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        page.evaluate('() => { HF.session.current().plan.reflection = true; }')
        cele = []
        for _ in range(40):
            ph = wait_phase(page, ['rule', 'debrief', 'summary'], 20000)
            if ph == 'summary':
                break
            if ph == 'rule':
                start_block(page)
            else:
                cele.append(page.evaluate(DEBRIEF)['celebrate'])
                kb(page).press('Space')
            next_phase(page, ph)
        chk.ok(cele and not any(cele), 'Focus mode: no celebration in any debrief %s' % cele)
        mot = page.evaluate("() => Array.prototype.map.call(document.querySelectorAll('.hf-sess--summary .hf-mot'), function (e) { return getComputedStyle(e).display; })")
        chk.ok(mot and all(d == 'none' for d in mot), 'Focus mode hides the motivation layer on the summary %s' % mot)
        box = page.locator('.hf-sess__reflect textarea')
        chk.ok(box.count() == 1, 'the reflection question is shown')
        box.fill('Grouping the last two items helped.')
        page.locator('.hf-sess__reflect .hf-btn').click()
        page.wait_for_function("() => /Saved/.test(document.querySelector('.hf-sess__reflect [role=status]').textContent)", timeout=5000)
        shot(page, 'feedback-3-reflection', full=True)
        note = page.evaluate("() => HF.store.records.events.filter(function (e) { return e.type === 'note'; }).map(function (e) { return e.text; })")
        chk.eq(note, ['Grouping the last two items helped.'], "Save writes a 'note' event")
    finally:
        ctx.close()
    return con


def run_sprint_flashes(b, url, chk):
    ctx, page, con = new_page(b, DESKTOP, 'dark')
    try:
        boot(page, url, settings={'mode': 'sprint', 'theme': 'dark'}, debug={'timeScale': 0.6, 'countdownStepMs': 100})
        go_session(page, {})
        wait_phase(page, 'rule', 20000)
        strat = page.evaluate("() => { var s = document.querySelector('.hf-play-rule .hf-play__strategy'); return s ? s.textContent : null; }")
        chk.ok(strat and 'Strategy' in strat, 'Sprint: the rule card shows the strategy card %r' % (strat and strat[:80]))
        chk.ok(page.evaluate('() => HF.player.state().bp.feedback.perResponse') is True, 'Sprint: per-response feedback on')
        shot(page, 'feedback-4-sprint-strategy')
        page.evaluate(FB_SPY)
        start_block(page)
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
        dig = spec_digest(page)
        n = page.evaluate('() => HF.player.state().spec.params.n')
        wrong = 0
        for t in dig['trials']:
            st = wait_trial(page, t['i'])
            if st['phase'] != 'run':
                break
            if int(st['trial']) != t['i']:
                continue
            if t['target'] and t['target'].get('main'):
                kb(page).press('j')
            elif t['i'] >= n and wrong < 2 and t['i'] % 3 == 0:
                kb(page).press('j')
                wrong += 1
            if t['i'] == 8:
                shot(page, 'feedback-5-flash')
        wait_phase(page, 'debrief', 60000)
        fb = page.evaluate('() => window.__fb')
        vals = [x['v'] for x in fb]
        chk.ok('good' in vals and 'bad' in vals, 'flashes: good on matches, bad on non-matches %s' % vals)
        gaps = [round(fb[k + 1]['t'] - fb[k]['t']) for k in range(len(fb) - 1)]
        chk.ok(all(g >= 330 for g in gaps), 'flashes at most 3 per second %s' % gaps)
        bad = [x for x in fb if x['v'] == 'bad']
        if bad:
            col = bad[0]['color']
            nums = [int(v) for v in col[col.index('(') + 1:col.index(')')].split(',')[:3]]
            chk.ok(bad[0]['style'] == 'dashed' and not (nums[0] > 150 and nums[0] > nums[1] + 60 and nums[0] > nums[2] + 60),
                   'bad flash is a neutral dashed ring, not red: %s %s' % (bad[0]['style'], col))
        # Dual double match: J and K together → one flash (the limiter)
        page.evaluate("""() => { HF.store.mutate(function (r) { var s = {}; for (var k in r.settings) s[k] = r.settings[k];
          s.perResponseFeedback = true; s.updatedAt = Date.now(); r.settings = s; }); }""")
        page.evaluate('() => HF.router.go("session", { free: { trackId: "nback.dual", rung: 2 } })')
        wait_phase(page, 'rule', 20000)
        page.locator('.hf-play__start').click()
        page.wait_for_function("() => HF.player.phase === 'run'", timeout=20000)
        dig = spec_digest(page)
        both = [t['i'] for t in dig['trials'] if t['target'] and t['target'].get('pos') and t['target'].get('snd')]
        chk.ok(len(both) >= 1, 'Dual block has shared targets %s' % both)
        if both:
            i = both[0]
            wait_trial(page, i)
            page.evaluate('() => { window.__fb = []; }')
            kb(page).down('j')
            kb(page).down('k')
            kb(page).up('j')
            kb(page).up('k')
            page.wait_for_timeout(300)
            fb2 = page.evaluate('() => window.__fb')
            chk.eq(len(fb2), 1, 'J + K together on a double match → one flash (≤ 3 per second) %s' % [(x['v'], x['key']) for x in fb2])
        page.evaluate('() => HF.player.abort("test")')
    finally:
        ctx.close()
    return con


def run():
    chk = Check('session-feedback')
    t0 = time.time()
    url = build_page()
    chk.details['skipped_scripts'] = list(SKIPPED)
    cons = []
    with browser() as b:
        cons.append(run_fatigue(b, url, chk))
        cons.append(run_focus_reflection(b, url, chk))
        cons.append(run_sprint_flashes(b, url, chk))

    class All:
        errors = sum((c.errors for c in cons), [])
        page_errors = sum((c.page_errors for c in cons), [])
    return finish(chk, All, t0)


if __name__ == '__main__':
    run_main(run)
