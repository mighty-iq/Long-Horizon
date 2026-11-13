"""Phase 3 long live run (Chromium, desktop 1366×768, REAL time: no timeScale, real 3-2-1, real stimulus timing).

A bot plays, with real key presses answering from the spec at about 85 % accuracy (random misses, false presses on
non-targets and lures, wrong or missing answers on discrete items, jittered response times):
  day 1  one full 25-minute Varied session from Today (session 1)
  day 2  one full 25-minute Varied session from Today (session 2; Transform is introduced)
         → Today shows 2 counted sessions; Progress and History show them
  day 3  a Wang et al. 2025 protocol day: 5 Equal Steps blocks; the debriefs show no score or level, only the day's
         accuracy at the end (and the level follows Wang's day rule)
Per block: rule card → countdown → stimulus → debrief (HF.player.phase log); level move vs the mode's U / D;
≤ 1 voided trial (trial log + frame stats); the block ends within its expected time + 30 s.
Across the run (after a forced GC at every debrief, via CDP): DOM nodes, JS heap, live listeners by target class,
pending timeouts, live intervals, pending animation frames and live observers (init-script wrappers, see
journey_lib.INIT_JS) must stay bounded; start / middle / end values are reported.
Days are simulated with the Date-only clock shim (journey_lib); block timing is never touched.
Progress → out/phase3/longrun.log; result → out/phase3/longrun.json.
Run (about an hour): python3 tests/e2e/test_longrun.py [--seed N] [--only-wang]
"""
import datetime
import json
import random
import statistics
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

from helpers import CHROMIUM_ARGS, Check, Console, file_url
import journey_lib as J

LOG = J.OUT3 / 'longrun.log'
START = J.local(2026, 11, 16, 9, 0)          # Monday 09:00 local (simulated)
SEED = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 20261116
VOIDS_JS = r"""([sid, bid]) => { const doc = HF.store.loadTrials(sid); const L = doc && doc.blocks ? doc.blocks[bid] : null;
  if (!L) return null;
  const v = Array.isArray(L.voided) ? L.voided.length : (L.answers ? L.answers.filter((a) => a.voided).length : null);
  return { voided: v, n: L.n || (L.answers ? L.answers.length : null), presented: L.presented, frame: L.frame || null,
    flags: L.flags || null, paused: !!L.paused }; }"""
SEED_USER_JS = J.SEED_USER_JS


def log_line(text):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a') as fh:
        fh.write(time.strftime('%H:%M:%S ') + text + '\n')


def slope(values):
    """Least-squares slope per step (None for < 3 values)."""
    ys = [v for v in values if isinstance(v, (int, float))]
    n = len(ys)
    if n < 3:
        return None
    mx, my = (n - 1) / 2.0, sum(ys) / n
    num = sum((i - mx) * (y - my) for i, y in enumerate(ys))
    den = sum((i - mx) ** 2 for i in range(n))
    return num / den if den else 0.0


class LongRun:
    def __init__(self):
        self.c = Check('longrun')
        self.rng = random.Random(SEED)
        self.entries = []
        self.metrics = []
        self.today_metrics = []
        self.client = None

    def boot(self, page):
        J.wait_booted(page)
        st = J.close_popup(page)
        page.evaluate(J.PHASE_LOG_JS)
        self.c.ok(st is not None and st.get('focused') == 'Start training', 'pop-up on launch, Start training focused')
        return st

    def measure(self, page, label):
        m = J.cdp_metrics(page, self.client, gc=True)
        m['label'] = label
        return m

    def on_debrief(self, page, tag):
        def cb(entry):
            c = self.c
            b = entry['block'] or {}
            tagk = '%s #%d %s/%s' % (tag, entry['k'], b.get('trackId'), b.get('role'))
            c.ok(not entry['stuck'], '%s: ended within expected + 30 s (%d ms vs %d)' % (tagk, entry['elapsedMs'], entry['expectedMs']))
            c.ok(entry['elapsedMs'] <= entry['expectedMs'] + 30000, '%s: run time %d ms ≤ expected %d + 30000' % (tagk, entry['elapsedMs'], entry['expectedMs']))
            c.eq(entry['phases'][:3], ['countdown', 'run', 'debrief'], '%s: rule card → countdown → stimulus → debrief' % tagk)
            c.ok(sum((entry['bot'].get('outcomes') or {}).values()) > 0, '%s: stimuli shown and answered' % tagk)
            if not b.get('protocol'):
                msg = J.controller_check(entry)
                c.ok(msg is None, '%s: level move follows the controller: %s' % (tagk, msg))
            v = page.evaluate(VOIDS_JS, [entry['sessionId'], b.get('id')]) if b.get('id') else None
            entry['voids'] = v
            c.ok(v is not None and v['voided'] is not None and v['voided'] <= 1, '%s: at most 1 voided trial (%s)' % (tagk, v and v['voided']))
            m = self.measure(page, tagk)
            entry['metrics'] = m
            self.metrics.append(m)
            db = entry['debrief'] or {}
            if b.get('protocol') == 'wang':
                c.ok(not db.get('score') and not db.get('dir'), '%s: Wang debrief shows no score and no level' % tagk)
                c.eq(db.get('line'), 'Block done.', '%s: Wang debrief says only "Block done."' % tagk)
            fr = b.get('frame') or {}
            L = (m.get('leak') or {}).get('listeners') or {}
            log_line('%s %-24s rung %s→lvl %s→%s moved %s BA %s | %5.1fs/%5.1fs | void %s | frame max %s stalls %s | nodes %s heap %.1fMB | lst w%s d%s c%s x%s o%s | to %s iv %s raf %s obs %s' % (
                tag, '#%d %s/%s' % (entry['k'], b.get('trackId'), b.get('role')), b.get('rung'), b.get('levelBefore'), b.get('levelAfter'),
                b.get('moved'), None if b.get('ba') is None else round(b['ba'], 3), entry['elapsedMs'] / 1000.0, entry['expectedMs'] / 1000.0,
                v and v['voided'], fr.get('maxMs'), fr.get('stalls'), m.get('nodes'), (m.get('heapUsed') or 0) / 1e6,
                L.get('window'), L.get('document'), L.get('connected'), L.get('detached'), L.get('other'),
                (m.get('leak') or {}).get('timeouts'), (m.get('leak') or {}).get('intervals'), (m.get('leak') or {}).get('rafs'),
                (m.get('leak') or {}).get('observers')))
            self.entries.append(entry)
        return cb

    def leave(self, entry):
        """How the bot leaves a debrief: usually Space after 1–3 s; every 4th quiet debrief waits for auto-continue."""
        db = entry.get('debrief') or {}
        if db.get('auto') and entry['k'] % 4 == 0:
            return 'auto'
        time.sleep(self.rng.uniform(1.0, 3.0))
        return ['space', 'space', 'enter', 'click'][entry['k'] % 4]

    def play_today_session(self, page, tag):
        J.nav(page, 'today')
        page.wait_for_timeout(500)
        self.today_metrics.append(self.measure(page, 'today-before-' + tag))
        card = page.evaluate("""() => { const k = document.querySelector('#hf-today-start'); const card = k && k.closest('.hf-card');
          return card ? { title: (card.querySelector('.hf-card__title') || {}).textContent, sub: (card.querySelector('.hf-card__sub') || {}).textContent } : null; }""")
        self.c.ok(card is not None, '%s: Today offers a session (%s)' % (tag, card))
        log_line('%s: Today card %s' % (tag, card))
        page.click('#hf-today-start')
        J.wait_sess_phase(page, ['rule', 'lesson'], timeout=20000)
        plan = page.evaluate("() => { const p = HF.session.current().plan; return { id: p.id, n: p.slots.length, mode: p.modeId, protocol: p.protocol, tracks: p.slots.map((s) => s.trackId + ':' + s.role) }; }")
        log_line('%s: plan %s' % (tag, json.dumps(plan)))
        bot = J.Bot(page, mode='noisy', seed=self.rng.randint(1, 10 ** 9), hit=0.85, fa=0.08, lure_fa=0.25, disc=0.85, no_resp=0.03,
                    rt=(380, 900), rt_disc=(550, 1400), scale=1.0)
        t0 = time.time()
        res = J.play_session(page, bot, on_debrief=self.on_debrief(page, tag), leave_debrief=self.leave, slack_ms=30000)
        res['plan'] = plan
        res['seconds'] = round(time.time() - t0)
        res['unexpectedPauses'] = bot.unexpected_pauses
        self.c.eq(len(res['blocks']), plan['n'], '%s: every planned block was played' % tag)
        self.c.eq(bot.unexpected_pauses, [], '%s: no pause the bot did not ask for' % tag)
        J.wait_sess_phase(page, 'summary', timeout=60000)
        summ = page.evaluate("""() => { const s = document.querySelector('.hf-sess--summary');
          return { h1: (s.querySelector('h1') || {}).textContent, lead: (s.querySelector('.hf-lead') || {}).textContent,
            notices: Array.from(s.querySelectorAll('.hf-notice')).map((n) => n.textContent.trim()),
            levels: Array.from(s.querySelectorAll('.hf-sess__lvl')).map((n) => n.textContent.trim()) }; }""")
        res['summary'] = summ
        sess = page.evaluate('(sid) => HF.store.records.sessions.filter((s) => s.id === sid)[0]', res['sessionId'])
        res['session'] = sess
        self.c.ok(sess and sess.get('endedBy') == 'done' and sess.get('completed') == sess.get('planned'), '%s: session ended done, all blocks (%s)' % (tag, sess and {k: sess.get(k) for k in ('endedBy', 'completed', 'planned', 'minutes', 'counted')}))
        log_line('%s: summary %s | %ss' % (tag, json.dumps(summ)[:400], res['seconds']))
        page.locator('.hf-sess__acts .hf-btn--primary').click()
        page.wait_for_function("() => HF.router.current && HF.router.current.name === 'today'", timeout=10000)
        page.wait_for_timeout(500)
        self.today_metrics.append(self.measure(page, 'today-after-' + tag))
        return res

    def wang_day(self, page, res_holder):
        J.nav(page, 'settings')
        page.click('#hf-mode-protocols')
        page.wait_for_timeout(250)
        on = page.evaluate('() => HF.store.records.settings.protocols')
        if on.get('cao'):
            page.click("label[for='hf-proto-cao']")
            page.wait_for_timeout(200)
        if on.get('jaeggi'):
            page.click("label[for='hf-proto-jaeggi']")
            page.wait_for_timeout(200)
        prot = page.evaluate('() => HF.store.records.settings.protocols')
        self.c.ok(prot.get('wang') and not prot.get('cao') and not prot.get('jaeggi'), 'Settings: Protocols with Wang only (%s)' % prot)
        res = self.play_today_session(page, 'wang')
        res_holder['wang'] = res
        blocks = [e['block'] for e in res['blocks']]
        self.c.eq(len(blocks), 5, 'Wang day: 5 blocks')
        self.c.ok(all(b and b['trackId'] == 'rel.steps' and b.get('protocol') == 'wang' for b in blocks), 'Wang day: every block is Equal Steps under the wang protocol')
        acc = page.evaluate("""(sid) => { const bs = HF.store.records.blocks.filter((b) => b.sessionId === sid);
          let c = 0, n = 0; bs.forEach((b) => { const ss = b.result && b.result.streams ? b.result.streams : {};
            Object.keys(ss).forEach((k) => { const s = ss[k]; c += (s.h || 0) + (s.cr || 0); n += (s.h || 0) + (s.m || 0) + (s.fa || 0) + (s.cr || 0); }); });
          const lv = bs.map((b) => [b.levelBefore, b.levelAfter]);
          return { correct: c, n, acc: n ? c / n : null, levels: lv }; }""", res['sessionId'])
        res['acc'] = acc
        notes = res['summary']['notices']
        acc_note = [n for n in notes if n.startswith("Today's accuracy")]
        self.c.ok(len(acc_note) == 1, 'Wang day: the summary shows the day\'s accuracy (%s)' % notes)
        if acc_note and acc.get('acc') is not None:
            want = '%d%%' % round(acc['acc'] * 100)
            self.c.ok(want in acc_note[0], 'Wang day: shown accuracy %s matches the blocks (%s)' % (acc_note[0][:40], want))
            first, last = acc['levels'][0][0], acc['levels'][-1][1]
            L = first // 2                                   # Wang levels L0–L7 sit on rungs 2L (standard pace)
            expL = L + 1 if acc['acc'] > 0.80 else (L - 1 if acc['acc'] < 0.50 else L)
            exp = 2 * max(0, min(expL, 7))
            self.c.eq(last, exp, 'Wang day: the level follows the day rule (acc %.3f, rung %s)' % (acc['acc'], first))
            mid_moves = [lv for lv in acc['levels'][:-1] if lv[0] != lv[1]]
            self.c.eq(mid_moves, [], 'Wang day: no level move before the 5th block')

    OLD_ANALYSIS = ('DOM nodes', 'JS heap', 'listeners on', 'listeners kept', 'at most 2 live intervals', 'pending timeouts',
                    'pending animation frames', 'live observers', 'no metrics collected')

    def analyse(self):
        """Per page load (each simulated day reloads the page, so values restart): start / middle / end, the least-squares
        slope per block and, for the heap, the median block-to-block change (robust to one-time allocations such as a
        task's first block). Bounds: no steady growth of DOM nodes, heap, listeners, timers, frames or observers."""
        c = self.c
        out = {'groups': {}}
        ms = list(self.metrics)
        if not ms:
            c.ok(False, 'no metrics collected')
            return out
        if all(m.get('nodes') is None for m in ms):          # CDP DOM counters unavailable: count the document's elements
            for m in ms:
                m['nodes'] = m.get('domInDoc')
            out['nodesSource'] = 'document elements (CDP Memory.getDOMCounters unavailable)'
        groups = {}
        for m in ms:
            groups.setdefault((m.get('label') or '?').split(' ')[0], []).append(m)

        def val(m, key, sub=None):
            if sub is None:
                return m.get(key)
            lk = m.get('leak') or {}
            return lk.get(key) if sub == 'leak' else (lk.get('listeners') or {}).get(key)

        def sme(vals):
            vals = [v for v in vals if v is not None]
            if not vals:
                return None
            d = [b - a for a, b in zip(vals, vals[1:])]
            return {'start': vals[0], 'middle': vals[len(vals) // 2], 'end': vals[-1], 'min': min(vals), 'max': max(vals),
                    'slopePerBlock': slope(vals), 'medianDelta': statistics.median(d) if d else 0}
        for g, gm in groups.items():
            G = {'blocks': len(gm)}
            for key in ('nodes', 'heapUsed', 'domInDoc', 'jsEventListeners'):
                G[key] = sme([val(m, key) for m in gm])
            G['listeners'] = {k: sme([val(m, k, 'L') for m in gm]) for k in ('window', 'document', 'connected', 'detached', 'other', 'once', 'total')}
            for key in ('timeouts', 'intervals', 'rafs', 'observers'):
                G[key] = sme([val(m, key, 'leak') for m in gm])
            out['groups'][g] = G
            if len(gm) < 3:
                continue
            n_s, h_s = G['nodes'], G['heapUsed']
            c.ok(n_s['slopePerBlock'] < 40 and n_s['end'] <= n_s['start'] * 1.5 + 500,
                 '%s: DOM nodes after GC stay bounded (start %s, middle %s, end %s, slope %.1f/block)' % (g, n_s['start'], n_s['middle'], n_s['end'], n_s['slopePerBlock']))
            if h_s:
                c.ok(h_s['medianDelta'] < 150000 and h_s['end'] <= h_s['start'] * 1.6 + 3e6,
                     '%s: JS heap after GC stays bounded (start %.2f MB, middle %.2f, end %.2f; median %.0f KB/block, slope %.0f KB/block)' % (
                         g, h_s['start'] / 1e6, h_s['middle'] / 1e6, h_s['end'] / 1e6, h_s['medianDelta'] / 1e3, h_s['slopePerBlock'] / 1e3))
            for k in ('window', 'document', 'other'):
                s2 = G['listeners'][k]
                c.ok(s2['max'] - s2['min'] <= 3, '%s: listeners on %s stay flat between blocks (%s–%s)' % (g, k, s2['min'], s2['max']))
            s2 = G['listeners']['connected']
            c.ok(abs(s2['slopePerBlock']) < 2 and s2['max'] - s2['min'] <= 25, '%s: listeners on connected nodes do not grow (%s–%s, slope %.2f)' % (g, s2['min'], s2['max'], s2['slopePerBlock']))
            s2 = G['listeners']['detached']
            c.ok(s2['max'] <= 30 and s2['slopePerBlock'] < 1, '%s: listeners kept alive on detached nodes stay small (%s–%s)' % (g, s2['min'], s2['max']))
            c.ok(G['intervals']['max'] <= 2, '%s: at most 2 live intervals at any debrief (max %s)' % (g, G['intervals']['max']))
            c.ok(G['timeouts']['max'] <= 12 and G['timeouts']['slopePerBlock'] < 0.5, '%s: pending timeouts bounded (%s–%s)' % (g, G['timeouts']['min'], G['timeouts']['max']))
            c.ok(G['rafs']['max'] <= 2, '%s: pending animation frames bounded (max %s)' % (g, G['rafs']['max']))
            c.ok(G['observers']['max'] - G['observers']['min'] <= 1, '%s: live observers flat (%s–%s)' % (g, G['observers']['min'], G['observers']['max']))
        frames = [((e.get('block') or {}).get('frame') or {}) for e in self.entries]
        out['frame'] = {'maxMs': max([f.get('maxMs') or 0 for f in frames] or [0]), 'stalls': sum([f.get('stalls') or 0 for f in frames]),
                        'fps': sorted(set([f.get('fps') for f in frames if f.get('fps')])),
                        'medianMs': sorted(set([f.get('medianMs') for f in frames if f.get('medianMs')]))[:6],
                        'voided': [((e.get('voids') or {}).get('voided')) for e in self.entries]}
        out['blocks'] = len(self.entries)
        out['today'] = [{k: m.get(k) for k in ('label', 'nodes', 'heapUsed', 'domInDoc')} for m in self.today_metrics]
        return out

    def reanalyse(self, path):
        """--analyse PATH: re-evaluate a saved run with this analysis (the live per-block checks are kept)."""
        d = json.loads(open(path).read())
        det = d.get('details') or {}
        self.metrics = det.get('metrics') or []
        self.entries = det.get('entries') or []
        self.today_metrics = (det.get('analysis') or {}).get('today') or []
        self.c.passed = d.get('passed', 0)
        self.c.failures = [f for f in d.get('failures', []) if not f.startswith(self.OLD_ANALYSIS) and ': DOM nodes' not in f
                           and ': JS heap' not in f and ': listeners' not in f and ': at most 2' not in f and ': pending' not in f
                           and ': live observers' not in f]
        self.c.details = det
        an = self.analyse()
        self.c.details['analysis'] = an
        res = self.c.result()
        J.write_json('longrun.json', res)
        log_line('re-analysed %s: %s, %d failures' % (path, 'PASS' if res['ok'] else 'FAIL', len(res['failures'])))
        for f in res['failures'][:30]:
            log_line('  - ' + f[:300])
        for g, G in an.get('groups', {}).items():
            log_line('group %s: %s' % (g, json.dumps({k: G[k] for k in ('blocks', 'nodes', 'heapUsed')}, default=str)[:600]))
        return res

    def run(self):
        t0 = time.time()
        LOG.write_text('')
        log_line('long run start, seed %s' % SEED)
        holder = {}
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=CHROMIUM_ARGS + ['--enable-precise-memory-info'])
            try:
                ctx = J.new_context(b, start_local=START)
                page = ctx.new_page()
                con = Console(page)
                self.client = ctx.new_cdp_session(page)
                page.goto(file_url('index.html'))
                self.boot(page)
                page.evaluate(SEED_USER_JS)
                try:
                    if '--only-wang' not in sys.argv:
                        holder['s1'] = self.play_today_session(page, 'day1')
                        J.set_day(page, START + datetime.timedelta(days=1))
                        page.reload()
                        self.boot(page)
                        holder['s2'] = self.play_today_session(page, 'day2')
                        # Today and Progress show the two counted sessions
                        J.nav(page, 'today')
                        page.wait_for_timeout(400)
                        ring = page.evaluate("() => { const r = document.querySelector('.hf-today__week .hf-ring__dial'); return r ? r.getAttribute('aria-label') : null; }")
                        prog = page.evaluate("() => (document.querySelector('.hf-prog__text') || {}).textContent || null")
                        self.c.ok(ring is not None and ring.startswith('2 of '), 'Today: the weekly ring shows 2 sessions (%s)' % ring)
                        self.c.ok(prog is not None and 'Programme: 2 of 20' in prog, 'Today: programme 2 of 20 (%s)' % prog)
                        self.c.eq(page.evaluate('() => HF.store.derived.sessionsCounted'), 2, 'two counted sessions')
                        page.screenshot(path=str(J.OUT3 / 'longrun-today.png'), full_page=True)
                        J.nav(page, 'progress')
                        page.wait_for_timeout(500)
                        st = page.evaluate("""() => { const g = (l) => { const s = Array.from(document.querySelectorAll('#lifetime .hf-stat')).filter((x) => (x.querySelector('.hf-stat__label') || {}).textContent === l)[0];
                          return s ? s.querySelector('.hf-stat__value').textContent : null; }; return { sessions: g('Sessions'), blocks: g('Blocks') }; }""")
                        nb = len(holder['s1']['blocks']) + len(holder['s2']['blocks'])
                        self.c.eq(st, {'sessions': '2', 'blocks': str(nb)}, 'Progress: lifetime shows 2 sessions and every block')
                        page.screenshot(path=str(J.OUT3 / 'longrun-progress.png'), full_page=True)
                        page.locator('#hf-screen .hf-btn', has_text='History').first.click()
                        page.wait_for_timeout(500)
                        hs = page.evaluate("() => document.querySelectorAll('.hf-hist__session').length")
                        self.c.eq(hs, 2, 'History lists the 2 sessions')
                        J.set_day(page, START + datetime.timedelta(days=2))
                        page.reload()
                        self.boot(page)
                    self.wang_day(page, holder)
                except Exception as e:
                    self.c.ok(False, 'exception: %s' % str(e)[:300])
                    self.c.details['traceback'] = traceback.format_exc()[-3000:]
                    log_line('EXCEPTION ' + traceback.format_exc()[-1500:])
                    try:
                        page.screenshot(path=str(J.OUT3 / 'longrun-exception.png'), full_page=True)
                    except Exception:
                        pass
                self.c.eq(con.errors + con.page_errors, [], '0 console errors in the whole run')
                self.c.details['console'] = con.summary()
                ctx.close()
            finally:
                b.close()
        an = self.analyse()
        self.c.details['analysis'] = an
        self.c.details['sessions'] = {k: {kk: v.get(kk) for kk in ('plan', 'seconds', 'summary', 'session', 'acc', 'unexpectedPauses', 'lessons')} for k, v in holder.items()}
        self.c.details['entries'] = [{k: e.get(k) for k in ('k', 'block', 'bot', 'debrief', 'phases', 'elapsedMs', 'expectedMs', 'voids', 'stuck')} for e in self.entries]
        self.c.details['metrics'] = self.metrics
        self.c.details['seconds'] = round(time.time() - t0)
        res = self.c.result()
        J.write_json('longrun.json', res)
        log_line('done: %s, %d checks, %d failures, %ss' % ('PASS' if res['ok'] else 'FAIL', res['passed'], len(res['failures']), self.c.details['seconds']))
        for f in res['failures'][:30]:
            log_line('  - ' + f[:300])
        log_line('analysis: ' + json.dumps({k: v for k, v in an.items() if k not in ('today',)}, default=str)[:3000])
        return res


if __name__ == '__main__':
    if '--analyse' in sys.argv:
        r = LongRun().reanalyse(sys.argv[sys.argv.index('--analyse') + 1])
    else:
        r = LongRun().run()
    print(json.dumps({k: v for k, v in r.items() if k != 'details'}, indent=2)[:4000])
    sys.exit(0 if r['ok'] else 1)
