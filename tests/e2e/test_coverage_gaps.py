"""Phase 3 coverage gaps (Chromium, desktop 1366×768, real index.html, real Settings/Today/session screens).

  stretch     6 counted sessions seeded through the real engine → Stretch opens in Settings → a 10-minute Stretch
              session: no debrief shows a level; a summary (score) only on every 2nd block; the levels are revealed
              on the session summary ("Levels, revealed now", engine event levels-revealed).
  mastery     Mastery Path from scratch: day 1 reaches the criterion on Plain 2-back (pending check); day 2 the
              session carries 2 check blocks on fresh material (a set not used for the unit's training) → pass path
              (mastery-check pass, unit passed) and, from the same day-1 backup imported into a fresh profile, the
              fail path (mastery-check fail → corrective blocks one rung below the target); 2 days after the pass a
              review block is due.
  sound-off   Dual chosen in Settings, then sound Off: Dual is not offered (plan, Free play list, derived) and Today
              shows the planner's sound-off note.
  all-intro   many sessions seeded → the plan carries the 'all-introduced' note → Today shows it.
Debug hooks (test only): HF.player.debug.simulate ('correct' / 'none' answers without showing items) and
countdownStepMs; days through the Date-only clock shim (journey_lib). Result: out/phase3/coverage.json.
Run: python3 tests/e2e/test_coverage_gaps.py [stretch,mastery,sound,intro]
"""
import datetime
import json
import sys
import time
import traceback

from helpers import Check, Console, browser, file_url
import journey_lib as J
from test_screens_common import SEED_JS

START = J.local(2026, 11, 23, 9, 0)        # a Monday (simulated)
SHOTS = J.OUT3 / 'coverage'


class Gaps:
    def __init__(self):
        self.c = Check('coverage-gaps')
        self.cons = []
        SHOTS.mkdir(parents=True, exist_ok=True)

    def shot(self, page, name, full=True):
        page.screenshot(path=str(SHOTS / (name + '.png')), full_page=full)

    def open(self, b, start=START):
        ctx = J.new_context(b, start_local=start)
        page = ctx.new_page()
        con = Console(page)
        self.cons.append(con)
        page.goto(file_url('index.html'))
        J.wait_booted(page)
        J.close_popup(page)
        page.evaluate(J.PHASE_LOG_JS)
        return ctx, page

    def fast(self, page, simulate='correct'):
        page.evaluate("(s) => { HF.player.debug.simulate = s; HF.player.debug.countdownStepMs = 60; return true; }", simulate)

    def reload(self, page):
        page.reload()
        J.wait_booted(page)
        J.close_popup(page)
        page.evaluate(J.PHASE_LOG_JS)

    def start_today(self, page):
        J.nav(page, 'today')
        page.wait_for_timeout(300)
        page.click('#hf-today-start')
        J.wait_sess_phase(page, ['rule', 'lesson'], timeout=20000)
        return page.evaluate("""() => { const p = HF.session.current().plan; return { id: p.id, mode: p.modeId, notes: p.notes,
          slots: p.slots.map((s) => ({ trackId: s.trackId, role: s.role, purpose: s.purpose || null, unitId: s.unitId || null })) }; }""")

    def play(self, page, on_rule=None, simulate='correct'):
        self.fast(page, simulate)
        bot = J.Bot(page, mode='correct', scale=0.3)
        return J.play_session(page, bot, on_rule=on_rule, slack_ms=60000)

    def finish_summary(self, page):
        J.wait_sess_phase(page, 'summary', timeout=30000)
        s = page.evaluate("""() => { const s = document.querySelector('.hf-sess--summary');
          return { h1: (s.querySelector('h1') || {}).textContent, h2: Array.from(s.querySelectorAll('h2')).map((x) => x.textContent),
            levels: Array.from(s.querySelectorAll('.hf-sess__lvl')).map((x) => x.textContent.trim()),
            notices: Array.from(s.querySelectorAll('.hf-notice')).map((n) => n.textContent.trim()) }; }""")
        page.locator('.hf-sess__acts .hf-btn--primary').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'today'", timeout=10000)
        return s

    # ------------------------------------------------------------------ Stretch
    def stretch(self, b):
        c = self.c
        ctx, page = self.open(b)
        try:
            seeded = page.evaluate(SEED_JS, {'days': 10, 'trainDays': [0, 1, 2, 3, 4, 5, 6, 8], 'minutes': 20, 'skill': 0.6, 'gain': 0.03})
            c.details['stretch_seed'] = seeded
            page.evaluate(J.SEED_USER_JS, None)
            c.ok(seeded['counted'] >= 6, 'stretch: ≥ 6 counted sessions seeded (%s)' % seeded['counted'])
            c.ok(page.evaluate('() => HF.store.derived.stretch.open') is True, 'stretch: Stretch is open after 6 counted sessions')
            J.nav(page, 'settings')
            c.ok(page.evaluate("() => !document.querySelector('#hf-mode-stretch').disabled"), 'stretch: the Stretch card is enabled in Settings')
            page.click('#hf-mode-stretch')
            page.select_option('#hf-set-minutes', '10')
            page.wait_for_timeout(200)
            c.eq(page.evaluate('() => HF.store.records.settings.mode'), 'stretch', 'stretch: mode saved')
            plan = self.start_today(page)
            c.eq(plan['mode'], 'stretch', 'stretch: the session runs in Stretch')
            res = self.play(page)
            dbs = [(e['k'], e['debrief'] or {}, e['block'] or {}) for e in res['blocks']]
            c.details['stretch_debriefs'] = [{'k': k, 'line': d.get('line'), 'score': d.get('score'), 'dir': d.get('dir'), 'next': d.get('next'),
                                              'moved': bk.get('moved'), 'role': bk.get('role')} for k, d, bk in dbs]
            c.ok(all(not d.get('dir') and not d.get('next') for _, d, _ in dbs), 'stretch: no debrief shows a level or a level direction')
            pattern = [bool(d.get('score')) for _, d, _ in dbs]
            want = [(i + 1) % 2 == 0 for i in range(len(dbs))]
            c.eq(pattern, want, 'stretch: a block summary (score) on every 2nd block only')
            c.ok(all(d.get('line') == 'Block done.' for (k, d, _) in dbs if k % 2 == 1), 'stretch: the other blocks say only "Block done."')
            moved = [bk for _, _, bk in dbs if (bk.get('moved') or 0) != 0]
            c.ok(len(moved) >= 1, 'stretch: levels did move during the session (%d moves)' % len(moved))
            s = self.finish_summary(page)
            c.details['stretch_summary'] = s
            c.ok('Levels, revealed now' in s['h2'], 'stretch: the summary reveals the levels ("Levels, revealed now")')
            c.ok(len(s['levels']) >= 1, 'stretch: the revealed level changes are listed (%s)' % s['levels'])
            self.shot(page, 'stretch-today')
        finally:
            ctx.close()

    # ------------------------------------------------------------------ Mastery Path
    def mastery_day1(self, page):
        c = self.c
        page.evaluate(J.SEED_USER_JS, {'mode': 'mastery', 'sessionMinutes': 25})
        J.nav(page, 'settings')
        c.ok(page.evaluate("() => document.querySelector('#hf-mode-mastery').checked"), 'mastery: Mastery Path chosen')
        plan = self.start_today(page)
        c.eq(plan['mode'], 'mastery', 'mastery: day 1 plan in Mastery Path')
        c.ok(any(s['unitId'] == 'u01' for s in plan['slots']), 'mastery: day 1 works on unit u01 (Plain 2-back)')
        res = self.play(page)
        self.finish_summary(page)
        st = page.evaluate("() => { const u = HF.store.derived.mastery.units.u01; return { status: u.status, criterionAt: u.criterionAt, sets: HF.store.records.blocks.filter((b) => b.unitId === 'u01').map((b) => b.set) }; }")
        c.details['mastery_day1'] = st
        c.eq(st['status'], 'pending-check', 'mastery: day 1 reaches the criterion on u01 → pending check')
        return st

    def mastery(self, b):
        c = self.c
        ctx, page = self.open(b)
        backup = None
        try:
            d1 = self.mastery_day1(page)
            backup = page.evaluate('() => HF.store.exportText()')
            # -------- same day: no check yet (checks run on a later day)
            plan_same = page.evaluate("() => HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() }).slots.filter((s) => s.purpose === 'check' && s.unitId === 'u01').length")
            c.eq(plan_same, 0, 'mastery: no check on the day the criterion was reached')
            # -------- day 2: pass path
            J.set_day(page, START + datetime.timedelta(days=1))
            self.reload(page)
            J.nav(page, 'today')
            page.wait_for_timeout(300)
            c.ok('Check today' in page.evaluate("() => document.getElementById('hf-screen').innerText"), 'mastery: Today announces the check ("Check today: … on fresh material")')
            self.shot(page, 'mastery-day2-today')
            plan = self.start_today(page)
            checks = [s for s in plan['slots'] if s['purpose'] == 'check' and s['unitId'] == 'u01']
            c.eq(len(checks), 2, 'mastery: day 2 carries 2 check blocks for u01 (%s)' % checks)
            seen = {}

            def on_rule(info):
                if info.get('purpose') == 'check' and info.get('unitId') == 'u01':
                    seen.setdefault('sets', []).append(info.get('set'))
            self.play(page, on_rule=on_rule)
            self.finish_summary(page)
            st = page.evaluate("""() => { const u = HF.store.derived.mastery.units.u01;
              return { status: u.status, passedAt: u.passedAt, checks: u.checks, ev: HF.store.records.events.filter((e) => e.type === 'mastery-check' && e.unitId === 'u01') }; }""")
            c.details['mastery_pass'] = {'state': st, 'check_sets': seen.get('sets'), 'train_sets': d1['sets']}
            c.eq(st['status'], 'passed', 'mastery pass path: u01 passed after the check')
            c.ok(len(st['ev']) == 1 and st['ev'][0]['pass'] is True and st['ev'][0]['unitId'] == 'u01', 'mastery pass path: one mastery-check event, pass')
            # "fresh material" = the least recently used set of the track (planner chooseSet) with a new seed: a set the
            # unit never trained on while one is left, else at least not the most recent training material
            all_sets = page.evaluate("() => HF.catalog.trainingSets('nback.plain').map((x) => HF.catalog.normSet(x))")
            norm = lambda x: 'glyphs' if str(x).startswith('glyphs') else x
            unused = [x for x in all_sets if x not in [norm(y) for y in d1['sets']]]
            chk_sets = [norm(x) for x in (seen.get('sets') or [])]
            if unused:
                ok_fresh = bool(chk_sets) and all(x not in [norm(y) for y in d1['sets']] for x in chk_sets)
            else:
                ok_fresh = bool(chk_sets) and all(x != norm(d1['sets'][-1]) for x in chk_sets)
            c.ok(ok_fresh, 'mastery: the check runs on fresh material (check sets %s; training sets %s; never used %s)' % (seen.get('sets'), d1['sets'], unused))
            # -------- review: 2 days after the pass
            J.set_day(page, START + datetime.timedelta(days=3))
            self.reload(page)
            p3 = page.evaluate("""() => { const p = HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() });
              return { review: p.slots.filter((s) => s.purpose === 'review').map((s) => s.unitId), notes: p.notes.map((n) => n.code), due: HF.store.derived.mastery.reviewDue }; }""")
            c.details['mastery_review'] = p3
            c.ok('u01' in p3['review'], 'mastery: 2 days after the pass a review block of u01 is due (%s)' % p3)
            J.nav(page, 'today')
            page.wait_for_timeout(300)
            c.ok('Review today' in page.evaluate("() => document.getElementById('hf-screen').innerText"), 'mastery: Today announces the review')
            self.shot(page, 'mastery-day4-review')
        finally:
            ctx.close()
        # -------- fail path, from the day-1 backup in a fresh profile
        ctx, page = self.open(b, start=START)
        try:
            res = page.evaluate('(t) => HF.store.importText(t)', backup)
            c.ok(res.get('ok'), 'mastery fail path: day-1 backup imported')
            J.set_day(page, START + datetime.timedelta(days=1))
            self.reload(page)
            plan = self.start_today(page)
            seen = {'roles': []}

            def on_rule2(info):
                seen['roles'].append((info.get('purpose'), info.get('rung'), info.get('trackId')))
                sim = 'none' if info.get('purpose') == 'check' else 'correct'
                page.evaluate('(s) => { HF.player.debug.simulate = s; }', sim)
            self.play(page, on_rule=on_rule2)
            self.finish_summary(page)
            st = page.evaluate("""() => { const u = HF.store.derived.mastery.units.u01;
              const bs = HF.store.records.blocks.filter((b) => b.unitId === 'u01' && b.purpose === 'corrective').map((b) => b.rung);
              return { status: u.status, failed: u.failedChecks, corrective: bs, ev: HF.store.records.events.filter((e) => e.type === 'mastery-check' && e.unitId === 'u01') }; }""")
            c.details['mastery_fail'] = {'state': st, 'roles': seen['roles']}
            c.ok(len(st['ev']) == 1 and st['ev'][0]['pass'] is False, 'mastery fail path: one mastery-check event, not passed')
            c.eq(st['status'], 'pending-check', 'mastery fail path: the unit waits for a retest')
            c.ok(len(st['corrective']) >= 1 and all(r == 1 for r in st['corrective'][:3]), 'mastery fail path: corrective blocks one rung below the target (%s)' % st['corrective'])
            J.set_day(page, START + datetime.timedelta(days=2))
            self.reload(page)
            n = page.evaluate("() => HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() }).slots.filter((s) => s.purpose === 'check' && s.unitId === 'u01').length")
            c.eq(n, 2, 'mastery fail path: a retest is planned the next day')
        finally:
            ctx.close()

    # ------------------------------------------------------------------ Sound off
    def sound(self, b):
        c = self.c
        ctx, page = self.open(b)
        try:
            page.evaluate(J.SEED_USER_JS, None)
            J.nav(page, 'settings')
            page.click("label[for='hf-set-dual']")
            page.wait_for_timeout(200)
            c.ok(page.evaluate('() => HF.store.records.settings.dual') is True, 'sound: Dual chosen from the start')
            p_on = page.evaluate("() => HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() }).slots.map((s) => s.trackId)")
            c.ok('nback.dual' in p_on, 'sound on: the plan includes Dual (%s)' % sorted(set(p_on)))
            page.click("label.hf-seg__opt:has(input[name='hf-set-sound'][value='off'])")
            page.wait_for_timeout(250)
            c.eq(page.evaluate('() => HF.store.records.settings.sound'), 'off', 'sound: Off saved')
            d = page.evaluate("() => { const t = HF.store.derived.tracks['nback.dual']; return { available: t.available, blockedBy: t.blockedBy || null, soundOff: HF.store.derived.soundOff }; }")
            c.ok(d['available'] is False and d['blockedBy'] == 'sound' and d['soundOff'] is True, 'sound off: Dual not available (blocked by sound) (%s)' % d)
            p = page.evaluate("""() => { const p = HF.engine.plan(HF.store.records, HF.store.derived, { now: Date.now() });
              return { tracks: p.slots.map((s) => s.trackId), sets: p.slots.map((s) => s.set || null), notes: p.notes }; }""")
            c.ok('nback.dual' not in p['tracks'], 'sound off: the plan leaves Dual out')
            c.ok(any(n.get('code') == 'sound-off' for n in p['notes']), 'sound off: the plan carries the sound-off note')
            self.shot(page, 'sound-settings')
            J.nav(page, 'today')
            page.wait_for_timeout(300)
            note = [n for n in p['notes'] if n.get('code') == 'sound-off']
            body = page.evaluate("() => document.getElementById('hf-screen').innerText")
            c.ok(note and note[0]['text'][:40] in body, 'sound off: Today shows the note (%s)' % (note and note[0]['text']))
            self.shot(page, 'sound-today')
            J.nav(page, 'free')
            opts = page.evaluate("() => Array.from(document.querySelectorAll('#hf-free-track option')).map((o) => o.value)")
            c.ok('nback.dual' not in opts and 'nback.plain' in opts, 'sound off: Free play does not offer Dual (%s)' % opts)
            plan = self.start_today(page)
            c.ok(all(s['trackId'] != 'nback.dual' for s in plan['slots']), 'sound off: the session has no Dual block')
            sets = []
            res = self.play(page, on_rule=lambda i: sets.append((i.get('trackId'), i.get('set'))))
            c.ok(all(s not in ('tones', 'lettersAudio') for _, s in sets), 'sound off: no sound-based set is played (%s)' % sets)
            self.finish_summary(page)
        finally:
            ctx.close()

    # ------------------------------------------------------------------ All versions introduced
    def intro(self, b):
        c = self.c
        ctx, page = self.open(b)
        try:
            seeded = page.evaluate(SEED_JS, {'days': 26, 'trainDays': list(range(0, 26, 2)) + [25], 'minutes': 25, 'skill': 1.2, 'gain': 0.05})
            c.details['intro_seed'] = seeded
            page.evaluate(J.SEED_USER_JS, None)
            p = page.evaluate("""() => { const d = HF.store.derived; const p = HF.engine.plan(HF.store.records, d, { now: Date.now() });
              const avail = Object.keys(d.tracks).filter((k) => d.tracks[k].available && k !== 'vs.search');
              return { notes: p.notes, introduce: p.introduce || [], notIntro: avail.filter((k) => !d.tracks[k].introduced), sessionIndex: p.sessionIndex }; }""")
            c.details['intro_plan'] = p
            note = [n for n in p['notes'] if n.get('code') == 'all-introduced']
            c.ok(len(note) == 1, 'all-intro: the plan carries exactly one all-introduced note (not introduced yet: %s)' % p['notIntro'])
            J.nav(page, 'today')
            page.wait_for_timeout(300)
            body = page.evaluate("() => document.getElementById('hf-screen').innerText")
            c.ok(bool(note) and 'All versions introduced' in body, 'all-intro: Today says that all versions are introduced')
            self.shot(page, 'all-introduced-today')
        finally:
            ctx.close()

    def run(self):
        t0 = time.time()
        which = sys.argv[1].split(',') if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else ['stretch', 'mastery', 'sound', 'intro']
        with browser() as b:
            for name in which:
                t1 = time.time()
                n0 = len(self.c.failures)
                try:
                    getattr(self, name)(b)
                except Exception as e:
                    self.c.ok(False, '%s: exception %s' % (name, str(e)[:300]))
                    self.c.details.setdefault('tracebacks', {})[name] = traceback.format_exc()[-2000:]
                print('[coverage] %-8s %s (%.0fs)' % (name, 'ok' if len(self.c.failures) == n0 else 'FAIL', time.time() - t1), flush=True)
        errs = sum([c.errors + c.page_errors for c in self.cons], [])
        self.c.eq(errs, [], '0 console errors')
        self.c.details['seconds'] = round(time.time() - t0)
        res = self.c.result()
        J.write_json('coverage.json', res)
        return res


if __name__ == '__main__':
    r = Gaps().run()
    print(json.dumps({k: v for k, v in r.items() if k != 'details'}, indent=2)[:4000])
    sys.exit(0 if r['ok'] else 1)
