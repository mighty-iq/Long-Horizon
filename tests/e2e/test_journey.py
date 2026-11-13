"""Phase 3 cross-screen journey (Chromium, desktop 1366×768): a fresh user from first launch, real key presses
answering from the spec wherever a task is played, on the REAL index.html.

  1  Chimera pop-up on launch: Start training focused, Join link = https://discord.gg/chmr (new tab, URL printed)
  2  Welcome → Start training now (focused)        3  the n-back lesson, passed by the bot
  4  the session length is set to 10 min in Settings (the empty session the lesson opened is left, not counted)
  5  Session 1 (Varied, 10 min, from Today): every block played; debriefs, level moves (checked against the mode's
     U / D), the Grid lesson in place, the summary incl. the "Share to Discord" text (ends with discord.gg/chmr)
  6  Today: weekly ring at 1, next-session card      7  Progress: levels, lifetime blocks, History → Trials dialog
  8  Settings: Sprint, dark theme, large text; all persist after a reload
  9  one Free play block                             10 Export (download) → Reset (confirm) → Import the file →
     derived state identical (HF.engine.derive at a fixed time), trial logs and settings restored
  11 Day 2 (clock shim, see journey_lib): Today shows Session 2; it starts with a warm-up below the level; played
  12 Study mode for this (already trained) user: no dead end (enrolment must not be offered without baselines)
  13 Study participant (a fresh browser profile, days 3–5): Study → enrol (default template) → Measure first →
     lesson → Baseline 1 (trimmed via HF.ui.labvisit.testHooks.trim) → 2 days later Baseline 2 (trimmed) → draw
     (HF.rng.newSeed pinned to a seed that draws the control arm) → commitment code shown → the control-arm session
     plays visual-search blocks.
0 console errors throughout. Screenshots: out/phase3/journey/. Result: journey.json there.

Time: the clock shim moves Date only (journey_lib.INIT_JS); block timing stays real. Speed hooks (test only, as in
test_session_varied.py): HF.player.debug.timeScale = 0.5 and countdownStepMs = 250, lessons at timeScale 0.5;
`--real` plays at real speed.
Run: python3 tests/e2e/test_journey.py [--real] [--from N]
"""
import datetime
import json
import sys
import time
import traceback

from helpers import Check, Console, browser, file_url
import journey_lib as J

SHOTS = J.OUT3 / 'journey'
START = J.local(2026, 11, 16, 10, 0)          # a Monday, 10:00 local (simulated)
REAL = '--real' in sys.argv
SPEED = 1.0 if REAL else 0.5
DISCORD = 'https://discord.gg/chmr'

DERIVE_FIXED_JS = """(t) => JSON.stringify(HF.engine.derive(HF.store.records, t))"""
COUNTS_JS = """() => ({ sessions: HF.store.records.sessions.length, blocks: HF.store.records.blocks.length,
  events: HF.store.records.events.length, labVisits: (HF.store.records.labVisits || []).length,
  trials: HF.store.trialSessionIds().slice().sort(), settings: (({ mode, theme, largeText, sessionMinutes }) => ({ mode, theme, largeText, sessionMinutes }))(HF.store.records.settings),
  firstRunDone: HF.store.records.profile.firstRunDone, anonId: HF.store.records.profile.anonId })"""


class Journey:
    def __init__(self):
        self.c = Check('journey')
        self.steps = []
        self.shots = []
        self.cons = []
        self.blocks = []
        SHOTS.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ utilities
    def shot(self, page, name, full=False):
        p = SHOTS / (name + '.png')
        try:
            page.screenshot(path=str(p), full_page=full)
            self.shots.append(p.name)
        except Exception as e:
            self.c.details.setdefault('shot_errors', []).append('%s: %s' % (name, str(e)[:80]))
        return str(p)

    def speed(self, page):
        page.evaluate("""(s) => { HF.player.debug.timeScale = s; HF.player.debug.countdownStepMs = s < 1 ? 250 : null;
          if (HF.ui.lessons && HF.ui.lessons.config) HF.ui.lessons.config.timeScale = s; return true; }""", SPEED)

    def step(self, name, fn, *a):
        t0 = time.time()
        n0 = len(self.c.failures)
        ok = True
        try:
            fn(*a)
        except Exception as e:
            ok = False
            self.c.ok(False, '%s: exception %s' % (name, ('%s' % e)[:300]))
            self.c.details.setdefault('tracebacks', {})[name] = traceback.format_exc()[-2000:]
        self.steps.append({'step': name, 'seconds': round(time.time() - t0, 1), 'ok': ok and len(self.c.failures) == n0,
                           'newFailures': self.c.failures[n0:]})
        print('[journey] %-28s %s (%.0fs)' % (name, 'ok' if self.steps[-1]['ok'] else 'FAIL', time.time() - t0), flush=True)
        for f in self.c.failures[n0:]:
            print('    - ' + f[:400], flush=True)
        if name in self.c.details.get('tracebacks', {}):
            print('    ' + self.c.details['tracebacks'][name][-700:].replace('\n', '\n    '), flush=True)
        return ok

    def boot(self, page):
        J.wait_booted(page)
        st = J.close_popup(page)
        page.evaluate(J.PHASE_LOG_JS)
        self.speed(page)
        return st

    def reload(self, page):
        page.reload()
        st = self.boot(page)
        self.c.ok(st is not None, 'the Chimera pop-up shows again after a reload (every launch)')
        if st:
            self.c.eq(st['focused'], 'Start training', 'after a reload: Start training has focus')
        return st

    def debrief_check(self, entry, label):
        c = self.c
        b, db, rule = entry['block'] or {}, entry['debrief'] or {}, entry['rule'] or {}
        tag = '%s block %d (%s %s)' % (label, entry['k'], b.get('trackId'), b.get('role'))
        c.ok(not entry['stuck'], '%s: ended within its expected time + 30 s' % tag)
        c.eq(entry['phases'][:3], ['countdown', 'run', 'debrief'], '%s: rule card → countdown → stimulus → debrief' % tag)
        c.ok((entry['bot'].get('outcomes') or {}), '%s: items were shown and answered' % tag)
        c.ok(b.get('trackId') == rule.get('trackId'), '%s: the committed block is the one the rule card announced' % tag)
        msg = J.controller_check(entry)
        c.ok(msg is None, '%s: level move follows the controller (%s)' % (tag, msg))
        # A version's first block sets its starting level: the debrief says "Starting level" with no arrow (Phase 4, PQ-04).
        starting = any('set the starting level' in n or 'set its starting level' in n for n in db.get('notices') or [])
        if b.get('role') in ('rated', 'warmup', 'free') and not b.get('protocol'):
            if starting:
                c.eq(db.get('dir'), None, '%s: a new version shows its starting level, not a move' % tag)
            else:
                want = 'up' if (b.get('moved') or 0) > 0 else ('down' if (b.get('moved') or 0) < 0 else 'same')
                c.eq(db.get('dir'), want, '%s: debrief direction matches the level move' % tag)
        if b.get('role') == 'warmup':
            c.ok(starting or any('Warm-ups never change your level' in n for n in db.get('notices') or []), '%s: warm-up note in the debrief' % tag)
            c.ok(any('Warm-up' in n for n in rule.get('notes') or []), '%s: warm-up note on the rule card' % tag)
        if db.get('score') and b.get('ba') is not None:
            c.ok(str(int(round(b['ba'] * 100))) in db['score'].replace(' ', '').replace(' ', ''), '%s: debrief score %s = BA %.2f' % (tag, db['score'], b['ba']))
        fr = b.get('frame') or {}
        vr = b.get('voidedRatio') or 0
        self.blocks.append({'phase': label, 'trackId': b.get('trackId'), 'role': b.get('role'), 'rung': b.get('rung'),
                            'levelBefore': b.get('levelBefore'), 'levelAfter': b.get('levelAfter'), 'moved': b.get('moved'),
                            'reason': b.get('reason'), 'ba': b.get('ba'), 'voidedRatio': vr, 'frame': fr,
                            'elapsedMs': entry['elapsedMs'], 'expectedMs': entry['expectedMs'], 'dir': db.get('dir')})

    # ------------------------------------------------------------------ steps
    def s01_popup(self, page):
        page.goto(file_url('index.html'))
        J.wait_booted(page)
        page.wait_for_selector('dialog.hf-modal--chimera[open]', timeout=8000)
        page.wait_for_timeout(200)
        st = J.popup_state(page)
        c = self.c
        c.ok(st is not None, 'the Chimera pop-up shows on first launch')
        self.shot(page, '01-chimera-popup')
        if st:
            c.ok('Chimera community on Discord' in (st['text'] or ''), 'pop-up text names the Chimera community on Discord')
            c.eq(st['href'], DISCORD, 'Join link goes to https://discord.gg/chmr')
            c.eq(st['target'], '_blank', 'Join link opens a new tab')
            c.ok('noopener' in (st['rel'] or ''), 'Join link has rel=noopener')
            c.ok('Join us on Discord' in (st['joinText'] or ''), 'Join link reads "Join us on Discord"')
            c.ok('discord.gg/chmr' in (st['urlText'] or ''), 'the address is printed as text too')
            c.eq(st['focused'], 'Start training', 'Start training has focus')
            c.ok(st['focusedInDialog'], 'focus is inside the dialog')
        page.keyboard.press('Enter')
        page.wait_for_function("() => !document.querySelector('dialog.hf-modal--chimera[open]')", timeout=5000)
        page.evaluate(J.PHASE_LOG_JS)
        self.speed(page)
        self.c.details['sim_start'] = page.evaluate('() => new Date().toString()')

    def s02_welcome(self, page):
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'welcome'", timeout=8000)
        try:
            page.wait_for_function("() => document.activeElement && document.activeElement.id === 'hf-welcome-start'", timeout=3000)
        except Exception:
            pass
        self.c.eq(page.evaluate('() => document.activeElement && document.activeElement.id'), 'hf-welcome-start', 'Welcome: Start training now has focus')
        self.shot(page, '02-welcome')
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)

    def s03_lesson(self, page):
        tlb = J.lesson_driver()
        page.evaluate(tlb.HOOK_JS)
        acts = tlb.drive(page, lambda st: st.get('phase') == 'end', mode='pass', max_s=1200)
        st = tlb.state(page) or {}
        self.c.ok((st.get('result') or {}).get('passed') is True, 'the n-back lesson check was passed by the bot')
        self.c.details['lesson_actions'] = len(acts)
        txt = page.locator('.hf-lesson').inner_text()
        self.c.ok('Chimera community is on Discord' in txt, 'Chimera line at the end of the lesson')
        self.shot(page, '03-lesson-end', full=True)
        page.locator('[data-choice="finish"]').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'session'", timeout=10000)
        prof = page.evaluate('() => HF.store.records.profile')
        self.c.ok(prof.get('firstRunDone') is True and prof.get('path') == 'train', 'profile: firstRunDone, path train')

    def s04_length(self, page):
        J.wait_sess_phase(page, ['rule', 'lesson', 'empty'], timeout=20000)
        n25 = page.evaluate('() => HF.session.current().plan.slots.length')
        self.c.details['session_default_slots'] = n25
        self.shot(page, '04-session-default-length')
        self.c.ok(page.evaluate('() => HF.ui.shell.chrome()') is True, 'navigation visible on the first rule card')
        J.nav(page, 'settings')
        page.select_option('#hf-set-minutes', '10')
        page.wait_for_timeout(250)
        self.c.eq(page.evaluate('() => HF.store.records.settings.sessionMinutes'), 10, 'session length set to 10 min')
        self.shot(page, '05-settings-10min')
        sess = page.evaluate('() => HF.store.records.sessions.map((s) => ({ endedBy: s.endedBy, completed: s.completed, counted: s.counted }))')
        self.c.ok(len(sess) == 1 and sess[0]['endedBy'] == 'quit' and sess[0]['completed'] == 0 and not sess[0]['counted'],
                  'the session left before its first block is ended, not counted (%s)' % sess)
        J.nav(page, 'today')
        card = page.evaluate("""() => { const k = document.querySelector('#hf-today-start'); const card = k && k.closest('.hf-card');
          return k ? { title: (card.querySelector('.hf-card__title') || {}).textContent || '', text: card.textContent } : null; }""")
        self.c.ok(card is not None, 'Today: next-session card with Start')
        if card:
            self.c.ok('Session 1' in card['title'], 'Today: the card is Session 1 (%s)' % card['title'])
            self.c.details['today_s1_card'] = card['text'][:300]
            self.c.ok('7 blocks' in card['text'], 'Today: the card shows the 7 blocks of a 10-minute session')
        self.shot(page, '06-today-session1')
        page.click('#hf-today-start')
        J.wait_sess_phase(page, ['rule', 'lesson'], timeout=20000)
        self.c.eq(page.evaluate('() => HF.session.current().plan.slots.length'), 7, '10-minute Varied session 1 has 7 blocks')

    def s05_session1(self, page):
        bot = J.Bot(page, mode='correct', seed=11, rt=(200, 450), rt_disc=(350, 700), scale=SPEED)
        first = {}

        def on_debrief(e):
            self.debrief_check(e, 's1')
            if not first:
                first['x'] = 1
                self.shot(page, '07-s1-first-debrief')
                page.locator('.hf-play-debrief details > summary').first.click()
                page.wait_for_timeout(200)
                self.shot(page, '07b-s1-debrief-details')
        # the first debrief: its details were opened (focus on <summary>), so leave it with a click on Continue
        res = J.play_session(page, bot, on_debrief=on_debrief, slack_ms=30000,
                             leave_debrief=lambda e: 'click' if e['k'] == 1 else ['space', 'enter'][e['k'] % 2])
        sid = res['sessionId']
        self.c.details['s1'] = {'lessons': res['lessons'], 'n': len(res['blocks'])}
        self.c.eq(len(res['blocks']), 7, 'session 1: 7 blocks played')
        self.c.ok(len(res['lessons']) >= 1, 'session 1: the Relation Grid lesson ran in place (%s)' % res['lessons'])
        self.summary_checks(page, sid, 's1')

    def summary_checks(self, page, sid, tag, share=True):
        J.wait_sess_phase(page, 'summary', timeout=30000)
        sm = page.evaluate("""() => { const s = document.querySelector('.hf-sess--summary');
          return { h1: (s.querySelector('h1') || {}).textContent, lead: (s.querySelector('.hf-lead') || {}).textContent,
            levels: Array.from(s.querySelectorAll('.hf-sess__lvl')).map((l) => l.textContent.trim()),
            ring: (s.querySelector('.hf-ring__dial') || { getAttribute() { return null; } }).getAttribute('aria-label'),
            notes: Array.from(s.querySelectorAll('.hf-notice, .hf-small')).map((n) => n.textContent.trim()).slice(0, 8),
            primaries: s.querySelectorAll('.hf-btn--primary').length }; }""")
        self.c.details['%s_summary' % tag] = sm
        self.c.eq(sm['h1'], 'Session done', '%s summary heading' % tag)
        rec = page.evaluate("""(sid) => { const s = HF.store.records.sessions.filter((x) => x.id === sid)[0];
          const bs = HF.store.records.blocks.filter((b) => b.sessionId === sid).sort((a, b) => a.t - b.t);
          const ch = {}; bs.forEach((b) => { if (!(b.trackId in ch)) ch[b.trackId] = [b.levelBefore, b.levelAfter]; else ch[b.trackId][1] = b.levelAfter; });
          return { s, ch, words: Object.keys(ch).filter((k) => ch[k][0] !== ch[k][1]).map((k) => HF.player.levelWords(k, ch[k][1])) }; }""", sid)
        s = rec['s'] or {}
        self.c.ok(s.get('endedBy') == 'done' and s.get('completed') == s.get('planned'), '%s: session ended done with every block (%s/%s)' % (tag, s.get('completed'), s.get('planned')))
        self.c.eq(len(sm['levels']), len(rec['words']), '%s: the summary lists each level change' % tag)
        self.c.ok(all(any(w in l for l in sm['levels']) for w in rec['words']), '%s: summary levels match the block records (%s vs %s)' % (tag, rec['words'], sm['levels']))
        self.c.eq(sm['primaries'], 1, '%s: one primary button on the summary' % tag)
        if share:
            btn = page.locator('.hf-sess--summary .hf-btn', has_text='Share to Discord')
            self.c.ok(btn.count() == 1, '%s: Share to Discord on the summary' % tag)
            if btn.count():
                btn.click()
                page.wait_for_function("() => !!document.querySelector('.hf-sess__share .hf-share')", timeout=10000)
                txt = page.evaluate("() => { const t = document.querySelector('.hf-sess__share textarea'); return t ? t.value : null; }")
                self.c.ok(bool(txt) and txt.strip().endswith('discord.gg/chmr'), '%s: share text ends with discord.gg/chmr (%r)' % (tag, (txt or '')[-60:]))
                self.c.details['%s_share' % tag] = txt
                self.c.ok(page.evaluate("() => !!document.querySelector('.hf-sess__share a[href=\"https://discord.gg/chmr\"]')"), '%s: share panel links to the Discord' % tag)
        self.shot(page, '08-%s-summary' % tag, full=True)
        page.locator('.hf-sess__acts .hf-btn--primary').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'today'", timeout=10000)
        self.c.ok(page.evaluate('() => HF.ui.shell.chrome()') is True, '%s: chrome visible again after the session' % tag)
        return s

    def ring(self, page):
        return page.evaluate("() => { const r = document.querySelector('.hf-today__week .hf-ring__dial'); return r ? r.getAttribute('aria-label') : null; }")

    def s06_today(self, page):
        page.wait_for_timeout(300)
        ring = self.ring(page)
        self.c.ok(ring is not None and ring.startswith('1 of '), 'Today: weekly ring at 1 (%s)' % ring)
        card = page.evaluate("""() => { const k = document.querySelector('#hf-today-start'); const card = k && k.closest('.hf-card');
          return card ? (card.querySelector('.hf-card__title') || {}).textContent : null; }""")
        self.c.ok(card is not None, 'Today: next-session card after session 1 (%s)' % card)
        self.c.details['today_after_s1_card'] = card
        self.c.eq(page.evaluate('() => HF.store.derived.sessionsCounted'), 1, 'one counted session')
        self.c.ok(page.evaluate("() => !!document.querySelector('.hf-footer a[href=\"https://discord.gg/chmr\"], .hf-footer [href*=\"discord.gg/chmr\"]')"), 'Today: Chimera footer link')
        self.shot(page, '09-today-after-s1', full=True)

    def s07_progress(self, page):
        J.nav(page, 'progress')
        page.wait_for_timeout(400)
        lv = page.evaluate("""() => Array.from(document.querySelectorAll('details.hf-trk')).map((t) => ({ id: t.getAttribute('data-track'),
          name: (t.querySelector('.hf-trk__name') || {}).textContent, level: (t.querySelector('.hf-trk__level') || {}).textContent }))""")
        d = page.evaluate("""() => { const d = HF.store.derived; return { plain: HF.ui.screenKit && HF.ui.screenKit.levelText ? HF.ui.screenKit.levelText('nback.plain', d.tracks['nback.plain'].level) : null,
          grid: HF.ui.screenKit && HF.ui.screenKit.levelText ? HF.ui.screenKit.levelText('rel.grid.T1', d.tracks['rel.grid.T1'].level) : null,
          blocks: d.counters.blocks, names: { plain: HF.catalog.get('nback.plain').name, grid: HF.catalog.get('rel.grid.T1').name } }; }""")
        self.c.details['progress_levels'] = lv
        for key, tid in (('plain', 'nback.plain'), ('grid', 'rel.grid.T1')):
            row = [x for x in lv if x['id'] == tid]
            self.c.ok(row and d[key] and d[key] in row[0]['level'], 'Progress: %s row shows its level (%s / %s)' % (key, row[:1], d[key]))
        blocks_stat = page.evaluate("""() => { const st = Array.from(document.querySelectorAll('#lifetime .hf-stat')).filter((s) => (s.querySelector('.hf-stat__label') || {}).textContent === 'Blocks')[0];
          return st ? st.querySelector('.hf-stat__value').textContent : null; }""")
        self.c.eq(blocks_stat, str(d['blocks']), 'Progress: lifetime blocks = %s' % d['blocks'])
        self.c.eq(d['blocks'], 7, 'seven blocks so far')
        self.shot(page, '10-progress', full=True)
        page.locator('#hf-screen .hf-btn', has_text='History').first.click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'history'", timeout=8000)
        page.wait_for_timeout(300)
        n = page.evaluate("() => document.querySelectorAll('.hf-hist__session').length")
        self.c.ok(n >= 1, 'History lists the session (%d)' % n)
        if not page.evaluate("() => !!document.querySelector('.hf-hist__session[open]')"):
            page.locator('.hf-hist__session summary').first.click()
        nb = page.evaluate("() => document.querySelectorAll('.hf-hist__session[open] .hf-hist__block').length")
        self.c.eq(nb, 7, 'History: the session shows its 7 blocks')
        page.locator('.hf-hist__session[open] .hf-hist__trials').nth(2).click()
        page.wait_for_selector('dialog.hf-modal--trials[open]', timeout=5000)
        page.wait_for_timeout(300)
        rows = page.evaluate("() => document.querySelectorAll('dialog.hf-modal--trials tbody tr').length")
        txt = page.evaluate("() => document.querySelector('dialog.hf-modal--trials').textContent")
        self.c.ok(rows >= 10, 'History: the Trials dialog lists the trials (%d rows)' % rows)
        self.c.ok(any(w in txt for w in ('Match caught', 'Left alone, correctly', 'Correct', 'Not correct', 'found')), 'Trials: outcomes from the scorer')
        self.shot(page, '11-history-trials')
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)
        self.c.eq(page.evaluate('() => HF.dom.openModals()'), 0, 'Escape closes the Trials dialog')

    def s08_settings(self, page):
        J.nav(page, 'settings')
        page.click('#hf-mode-sprint')
        page.wait_for_timeout(200)
        page.click("label.hf-seg__opt:has(input[name='hf-set-theme'][value='dark'])")
        page.wait_for_timeout(150)
        page.click("label[for='hf-set-large']")
        page.wait_for_timeout(250)
        s = page.evaluate("() => { const s = HF.store.records.settings; return { mode: s.mode, theme: s.theme, largeText: s.largeText, html: [document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-text')] }; }")
        self.c.eq([s['mode'], s['theme'], s['largeText']], ['sprint', 'dark', True], 'Settings: Sprint, dark, large text saved')
        self.c.eq(s['html'], ['dark', 'large'], 'Settings applied to <html> at once')
        self.shot(page, '12-settings-sprint-dark-large', full=True)
        self.reload(page)
        J.nav(page, 'settings')
        s2 = page.evaluate("""() => { const s = HF.store.records.settings; return { mode: s.mode, theme: s.theme, largeText: s.largeText,
          html: [document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-text')],
          radio: (document.querySelector('#hf-mode-sprint') || {}).checked, large: (document.querySelector('#hf-set-large') || {}).checked }; }""")
        self.c.eq([s2['mode'], s2['theme'], s2['largeText']], ['sprint', 'dark', True], 'after a reload: Sprint, dark, large text kept')
        self.c.eq(s2['html'], ['dark', 'large'], 'after a reload: <html> dark + large')
        self.c.ok(s2['radio'] is True and s2['large'] is True, 'after a reload: the Settings controls show the saved values')
        self.shot(page, '13-settings-after-reload')

    def s09_free(self, page):
        J.nav(page, 'free')
        page.select_option('#hf-free-track', 'nback.plain')
        page.wait_for_timeout(200)
        choice = page.evaluate("() => (document.querySelector('.hf-free__choice') || {}).textContent")
        self.shot(page, '14-free-play')
        page.click('#hf-free-start')
        J.wait_sess_phase(page, 'rule', timeout=20000)
        bp = page.evaluate('() => { const b = HF.player.state().bp; return { trackId: b.trackId, rung: b.rung, role: b.role, level: HF.store.derived.tracks[b.trackId].level }; }')
        self.c.ok(bp['trackId'] == 'nback.plain' and bp['role'] == 'free', 'Free play: Plain n-back block, role free (%s, %s)' % (bp, choice))
        rule = page.evaluate(J.RULE_JS)
        J.phase_log(page, clear=True)
        page.keyboard.press('Space')
        bot = J.Bot(page, mode='correct', seed=12, rt=(200, 450), scale=SPEED)
        t0 = time.time()
        summ = bot.play_block()
        page.wait_for_function("() => HF.player.phase === 'debrief'", timeout=int(J.expected_block_ms(summ) + 30000))
        sid = page.evaluate('() => HF.session.current().plan.id')
        entry = {'k': 1, 'rule': rule, 'bot': summ, 'debrief': page.evaluate(J.DEBRIEF_JS), 'block': page.evaluate(J.LAST_BLOCK_JS, sid),
                 'phases': [p[0] for p in J.phase_log(page)], 'elapsedMs': int((time.time() - t0) * 1000), 'expectedMs': J.expected_block_ms(summ), 'stuck': False}
        self.debrief_check(entry, 'free')
        acts = page.evaluate("() => Array.from(document.querySelectorAll('.hf-play-debrief [data-action]')).map((b) => b.getAttribute('data-action'))")
        self.c.ok('done' in acts and 'change' in acts, 'Free play debrief offers Done and Change (%s)' % acts)
        self.shot(page, '15-free-debrief')
        page.locator('.hf-play-debrief [data-action="done"]').click()
        J.wait_sess_phase(page, 'summary', timeout=20000)
        lead = page.evaluate("() => document.querySelector('.hf-sess--summary .hf-lead').textContent")
        self.c.ok(lead.startswith('You played 1 block'), 'Free play summary: 1 block (%r)' % lead)
        page.locator('.hf-sess__acts .hf-btn--primary').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'today'", timeout=10000)
        self.c.ok((self.ring(page) or '').startswith('1 of '), 'Free play does not add a counted session (ring still at 1)')

    def s10_backup(self, page):
        J.nav(page, 'settings')
        page.locator('#hf-export-json').scroll_into_view_if_needed()
        path = SHOTS / 'long-horizon-backup.json'
        dl_name = None
        try:
            with page.expect_download(timeout=6000) as dl:
                page.click('#hf-export-json')
            dl_name = dl.value.suggested_filename
            dl.value.save_as(str(path))
        except Exception as e:
            self.c.details['download_error'] = str(e)[:200]
        page.wait_for_timeout(300)
        text = page.evaluate("() => { const t = document.querySelector('.hf-backup__box textarea'); return t ? t.value : null; }")
        self.c.ok(bool(dl_name) and dl_name.startswith('long-horizon-backup-') and dl_name.endswith('.json'), 'Export downloads long-horizon-backup-*.json (%s)' % dl_name)
        self.c.ok(bool(text) and json.loads(text).get('format') == 'long-horizon-backup', 'Export also shows the backup in a copy box')
        if not path.exists() and text:
            path.write_text(text)
        T = page.evaluate('() => Date.now()')
        before = page.evaluate(DERIVE_FIXED_JS, T)
        cnt0 = page.evaluate(COUNTS_JS)
        self.shot(page, '16-export')
        page.click('#hf-reset')
        page.wait_for_selector('dialog.hf-modal[open]', timeout=5000)
        self.c.eq(page.evaluate('() => document.activeElement && document.activeElement.textContent'), 'Keep my data', 'Reset asks first; the safe choice has focus')
        self.shot(page, '17-reset-confirm')
        page.locator('dialog.hf-modal[open] button', has_text='Delete everything').click()
        page.wait_for_timeout(500)
        cnt1 = page.evaluate(COUNTS_JS)
        self.c.ok(cnt1['sessions'] == 0 and cnt1['blocks'] == 0 and not cnt1['trials'] and cnt1['firstRunDone'] is False, 'Reset: everything deleted (%s)' % {k: cnt1[k] for k in ('sessions', 'blocks', 'events')})
        self.c.eq(J.route(page), 'welcome', 'after Reset: back to the welcome screen')
        self.shot(page, '18-after-reset')
        J.nav(page, 'settings')
        page.locator('#hf-import-pick').scroll_into_view_if_needed()
        page.set_input_files('#hf-import-file', str(path))
        page.wait_for_function("() => /Backup imported|Not imported/.test((document.querySelector('.hf-backup__result') || {}).textContent || '')", timeout=10000)
        res = page.evaluate("() => document.querySelector('.hf-backup__result').textContent")
        self.c.ok('Backup imported' in res, 'Import from the downloaded file (%s)' % res[:100])
        page.wait_for_timeout(400)
        after = page.evaluate(DERIVE_FIXED_JS, T)
        cnt2 = page.evaluate(COUNTS_JS)
        same = before == after
        if not same:
            a, b2 = json.loads(before), json.loads(after)
            diff = [k for k in sorted(set(a) | set(b2)) if json.dumps(a.get(k), sort_keys=True) != json.dumps(b2.get(k), sort_keys=True)]
            self.c.details['derive_diff_keys'] = diff
        self.c.ok(same, 'Import → derived state identical to before the Reset (HF.engine.derive at a fixed time)')
        self.c.eq({k: cnt2[k] for k in ('sessions', 'blocks', 'events', 'trials', 'settings', 'anonId')},
                  {k: cnt0[k] for k in ('sessions', 'blocks', 'events', 'trials', 'settings', 'anonId')}, 'Import restored records, trial logs, settings and the anonymous id')
        self.shot(page, '19-after-import', full=True)
        J.nav(page, 'today')
        self.c.ok((self.ring(page) or '').startswith('1 of '), 'Today after the import: ring at 1 again')

    def s11_day2(self, page):
        J.set_day(page, START + datetime.timedelta(days=1))
        self.reload(page)
        self.c.ok(page.evaluate('() => new Date().getDate()') == (START + datetime.timedelta(days=1)).day, 'clock shim: the page lives on day 2')
        if J.route(page) != 'today':
            J.nav(page, 'today')
        page.wait_for_timeout(300)
        card = page.evaluate("""() => { const k = document.querySelector('#hf-today-start'); const card = k && k.closest('.hf-card');
          return card ? { title: (card.querySelector('.hf-card__title') || {}).textContent, text: card.textContent } : null; }""")
        self.c.ok(card is not None and 'Session 2' in card['title'], 'Day 2: Today shows Session 2 (%s)' % (card and card['title']))
        self.shot(page, '20-day2-today', full=True)
        page.click('#hf-today-start')
        J.wait_sess_phase(page, ['rule', 'lesson'], timeout=20000)
        first = {}
        bot = J.Bot(page, mode='correct', seed=13, rt=(200, 450), rt_disc=(350, 700), scale=SPEED)

        def on_rule(info):
            if not first:
                first.update(info)
                self.shot(page, '21-day2-first-rule')

        res = J.play_session(page, bot, on_rule=on_rule, on_debrief=lambda e: self.debrief_check(e, 's2'))
        self.c.details['s2_first_rule'] = first
        self.c.ok(first.get('role') == 'warmup', 'Day 2: session 2 starts with a warm-up (%s)' % first.get('role'))
        self.c.ok(first.get('rung') is not None and first.get('trackLevel') is not None and first['rung'] < first['trackLevel'],
                  'Day 2: the warm-up is below the level (rung %s < level %s)' % (first.get('rung'), first.get('trackLevel')))
        self.c.ok(any('Warm-up' in n for n in first.get('notes') or []), 'Day 2: the rule card says it is a warm-up')
        self.c.ok(page.evaluate("() => HF.session.current().plan.modeId") == 'sprint', 'Day 2: the session runs in Sprint')
        self.summary_checks(page, res['sessionId'], 's2', share=False)
        self.c.ok((self.ring(page) or '').startswith('2 of '), 'Day 2: the weekly ring moves to 2 (%s)' % self.ring(page))
        self.c.eq(page.evaluate('() => HF.store.derived.sessionsCounted'), 2, 'two counted sessions')

    def s12_study_trained(self, page):
        J.nav(page, 'lab')
        page.locator('#hf-screen [data-go="study"], #hf-screen button', has_text='Study mode').first.click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'study'", timeout=8000)
        page.wait_for_timeout(300)
        info = page.evaluate("""() => { const sch = HF.lab.schedule(HF.store.records, HF.store.derived, Date.now());
          const b1 = sch.plan.filter((e) => e.kind === 'B1')[0];
          const join = Array.from(document.querySelectorAll('#hf-screen button')).some((b) => /Join the study/.test(b.textContent));
          return { path: sch.path, b1: b1 && b1.status, join, text: document.getElementById('hf-screen').innerText.slice(0, 8000) }; }""")
        self.c.details['study_trained_user'] = {k: info[k] for k in ('path', 'b1', 'join')}
        self.shot(page, '22-study-trained-user', full=True)
        self.c.ok(not (info['join'] and info['b1'] == 'skipped'),
                  'Study mode, already-trained user: enrolment is not offered while the baselines it needs cannot be taken (path %s, B1 %s, Join %s)' % (info['path'], info['b1'], info['join']))
        if not info['join']:
            self.c.ok('Baseline 1 and Baseline 2 come before any training' in info['text'] and 'carries on' in info['text'],
                      'Study mode, already-trained user: the screen says why and that training carries on')
        plan = page.evaluate("() => HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() }).slots.length")
        self.c.ok(plan > 0, 'Study mode, already-trained user: training is still planned (%d blocks)' % plan)

    def s13_study_participant(self, b):
        start = START + datetime.timedelta(days=2)
        ctx = J.new_context(b, start_local=start)
        page = ctx.new_page()
        con = Console(page)
        self.cons.append(con)
        try:
            page.goto(file_url('index.html'))
            st = self.boot(page)
            self.c.ok(st is not None and st['focused'] == 'Start training', 'participant: pop-up with Start training focused')
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'welcome'", timeout=8000)
            # Study mode first
            J.nav(page, 'lab')
            page.locator('#hf-screen [data-go="study"], #hf-screen button', has_text='Study mode').first.click()
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'study'", timeout=8000)
            page.wait_for_timeout(200)
            self.c.ok(page.evaluate("() => !!document.querySelector('[data-chimera] a[href=\"https://discord.gg/chmr\"]')"), 'Study screen promotes the Chimera Discord')
            sel = page.evaluate("() => (document.querySelector('input[name=st-template]:checked') || {}).value")
            self.c.eq(sel, 'default', 'Study: the default template is preselected')
            page.locator('label[for=st-adult]').click()
            page.locator('label[for=st-agree]').click()
            self.shot(page, '23-study-consent', full=True)
            page.locator('#hf-screen button', has_text='Join the study').click()
            page.wait_for_timeout(300)
            enrol = page.evaluate("() => HF.store.records.events.filter((e) => e.type === 'study-enrol')")
            self.c.ok(len(enrol) == 1 and enrol[0]['template'] == 'default', 'participant: study-enrol (default template)')
            # first run: Measure first → lesson → Baseline 1 (Today hands over to Welcome until the first run is done)
            J.nav(page, 'today', expect=['welcome'])
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'welcome'", timeout=8000)
            page.click('#hf-welcome-measure')
            page.wait_for_timeout(300)
            tlb = J.lesson_driver()
            page.evaluate(tlb.HOOK_JS)
            tlb.drive(page, lambda s: s.get('phase') == 'end', mode='pass', max_s=1200)
            page.locator('[data-choice="finish"]').click()
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'labvisit'", timeout=10000)
            self.lab_visit(page, 'B1')
            sch = page.evaluate("() => HF.lab.schedule(HF.store.records, null, Date.now()).plan.map((e) => [e.kind, e.status])")
            self.c.eq(sch[:2], [['B1', 'done'], ['B2', 'upcoming']], 'after Baseline 1: B1 done, B2 upcoming')
            # two days later: Baseline 2
            J.set_day(page, start + datetime.timedelta(days=2))
            self.reload(page)
            if J.route(page) != 'today':
                J.nav(page, 'today')
            page.wait_for_timeout(300)
            lab_note = page.evaluate("() => { const n = document.querySelector('.hf-today__lab'); return n ? n.textContent : null; }")
            self.c.ok(lab_note is not None and 'Baseline 2' in lab_note, 'Today reminds of Baseline 2 (%s)' % (lab_note or '')[:80])
            self.shot(page, '26-participant-today-b2-due', full=True)
            page.locator('.hf-today__lab .hf-btn', has_text='Open the Lab').click()
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'lab'", timeout=8000)
            page.wait_for_timeout(300)
            page.locator('#hf-screen .hf-btn--primary').first.click()
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'labvisit'", timeout=8000)
            self.lab_visit(page, 'B2')
            ex = page.evaluate("() => HF.store.records.events.filter((e) => e.type === 'study-expect').map((e) => e.when)")
            self.c.ok('B2' in ex, 'Baseline 2 check-in saved the study expectations (%s)' % ex)
            # draw
            J.nav(page, 'lab')
            page.locator('#hf-screen [data-go="study"], #hf-screen button', has_text='Study mode').first.click()
            page.wait_for_function("() => HF.router.current && HF.router.current.name === 'study'", timeout=8000)
            page.wait_for_timeout(300)
            seed = page.evaluate("""() => { for (let i = 0; i < 500; i++) { const s = 'journey-draw-' + i;
                if (HF.study.draw(s, { template: 'default', arms: ['varied', 'search'] }).arm === 'search') { window.__origNewSeed = HF.rng.newSeed; HF.rng.newSeed = () => s; return s; } }
              return null; }""")
            self.c.ok(seed is not None, 'test hook: a draw seed for the control arm was found')
            page.locator('#hf-screen button', has_text='Draw my programme').click()
            page.wait_for_selector('dialog.hf-modal[open]', timeout=5000)
            page.locator('dialog.hf-modal[open] button', has_text='Draw').click()
            page.wait_for_timeout(400)
            page.evaluate('() => { if (window.__origNewSeed) HF.rng.newSeed = window.__origNewSeed; }')
            dr = page.evaluate("() => HF.store.records.events.filter((e) => e.type === 'study-draw')")
            self.c.ok(len(dr) == 1 and dr[0]['arm'] == 'search', 'participant: drawn into the control programme')
            if dr:
                box = page.evaluate("() => { const a = document.querySelector('.hf-copy__area'); return a ? a.value : null; }")
                self.c.eq(box, dr[0]['commitment'], 'the commitment code is shown in a copy box')
                self.c.ok(page.evaluate('(d) => HF.study.verify(d.arm, d.salt, d.commitment)', dr[0]), 'the commitment verifies (SHA-256 of arm:salt)')
                txt = page.evaluate("() => document.getElementById('hf-screen').innerText")
                self.c.ok('Post this code in the Chimera Discord before session 1' in txt, 'Discord instruction next to the code')
                self.c.ok(dr[0]['salt'] not in txt, 'the salt stays hidden before the Post-test')
            self.shot(page, '27-study-commitment', full=True)
            # the control-arm session (10 minutes)
            J.nav(page, 'settings')
            page.select_option('#hf-set-minutes', '10')
            page.wait_for_timeout(200)
            J.nav(page, 'today')
            page.wait_for_timeout(300)
            self.shot(page, '28-participant-today-control', full=True)
            page.click('#hf-today-start')
            J.wait_sess_phase(page, ['rule', 'lesson'], timeout=20000)
            plan = page.evaluate("() => { const p = HF.session.current().plan; return { study: p.study, tracks: p.slots.map((s) => s.trackId), n: p.slots.length }; }")
            self.c.ok(plan['study'] and plan['study']['arm'] == 'search', 'the session runs the control arm (%s)' % plan['study'])
            self.c.ok(plan['n'] >= 2 and all(t == 'vs.search' for t in plan['tracks']), 'the control-arm plan is visual search only (%s)' % plan['tracks'])
            bot = J.Bot(page, mode='correct', seed=14, rt_disc=(350, 650), scale=SPEED)
            shots = {}

            def on_trial_rule(info):
                if not shots:
                    shots['r'] = self.shot(page, '29-control-rule')
            res = J.play_session(page, bot, on_rule=on_trial_rule, on_debrief=lambda e: self.debrief_check(e, 'control'))
            self.c.ok(len(res['lessons']) >= 1, 'the visual-search lesson ran in place before the first block (%s)' % res['lessons'])
            self.c.eq(len(res['blocks']), plan['n'], 'every control block was played')
            self.c.ok(all((e['block'] or {}).get('trackId') == 'vs.search' for e in res['blocks']), 'every committed block is visual search')
            self.summary_checks(page, res['sessionId'], 'control')
            errs = con.errors + con.page_errors
            self.c.eq(errs, [], 'participant: 0 console errors')
        finally:
            ctx.close()

    def lab_visit(self, page, kind):
        import test_lab_visit as TLV
        page.evaluate(TLV.WRAP_JS)
        page.evaluate('() => { HF.ui.labvisit.testHooks.trim = 1; }')
        shots = []
        d = TLV.Driver(page, self.c, shots, prefix='journey-' + kind, accuracy=1.0)
        t0 = time.time()
        s = d.run(max_s=900)
        self.c.ok(bool(s.get('h1')) and 'saved' in s['h1'], '%s: the visit finished on its done screen (%s)' % (kind, s.get('h1')))
        rec = page.evaluate("""(k) => { const v = HF.store.records.labVisits.filter((x) => x.kind === k); const x = v[v.length - 1];
          return x ? { tests: Object.keys(x.tests).sort(), ended: !!x.endedAt, config: x.config } : null; }""", kind)
        self.c.ok(rec and rec['ended'] and len(rec['tests']) >= 4, '%s: visit record saved with its tests (%s)' % (kind, rec))
        self.c.details['visit_' + kind] = {'seconds': round(time.time() - t0), 'record': rec}
        self.shot(page, '24-%s-done' % kind)
        page.evaluate('() => { HF.ui.labvisit.testHooks.trim = 0; }')

    # ------------------------------------------------------------------ run
    def run(self):
        t0 = time.time()
        start_from = int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 1
        with browser() as b:
            ctx = J.new_context(b, start_local=START)
            page = ctx.new_page()
            con = Console(page)
            self.cons.append(con)
            try:
                steps = [('01 chimera pop-up', self.s01_popup), ('02 welcome', self.s02_welcome), ('03 n-back lesson', self.s03_lesson),
                         ('04 session length 10', self.s04_length), ('05 session 1', self.s05_session1), ('06 today', self.s06_today),
                         ('07 progress + history', self.s07_progress), ('08 settings', self.s08_settings), ('09 free play', self.s09_free),
                         ('10 export reset import', self.s10_backup), ('11 day 2', self.s11_day2), ('12 study (trained)', self.s12_study_trained)]
                for i, (name, fn) in enumerate(steps, 1):
                    if i < start_from:
                        continue
                    ok = self.step(name, fn, page)
                    if not ok and i <= 5:
                        break
                self.c.eq(con.errors + con.page_errors, [], 'main journey: 0 console errors')
            finally:
                ctx.close()
            self.step('13 study participant', self.s13_study_participant, b)
        self.c.details['steps'] = self.steps
        self.c.details['blocks'] = self.blocks
        self.c.details['shots'] = self.shots
        self.c.details['seconds'] = round(time.time() - t0)
        self.c.details['console'] = [c.summary() for c in self.cons]
        res = self.c.result()
        J.write_json('journey.json', res, sub='journey')
        return res


def run():
    return Journey().run()


if __name__ == '__main__':
    r = run()
    print(json.dumps({k: v for k, v in r.items() if k != 'details'}, indent=2))
    print(json.dumps(r['details'].get('steps'), indent=1)[:3000])
    sys.exit(0 if r['ok'] else 1)
