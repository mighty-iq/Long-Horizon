"""Lab visit e2e (Chromium): a full Quick-check visit driven with real key presses and clicks.

Seeds Baseline 1 + 2 and 10 counted sessions, so the Lab home offers the Quick check; clicks Start, goes through the
device check and check-in, then the n-back probe (practice block + 4 scored blocks, real time) and the relation probe
(practice + 40 arrays), the close-out, and checks the saved LabVisitRecord, the trial logs, the results dot plots
and 0 console errors. Answers come from the visible trial (test instrumentation wraps HF.timing's view.show to read
the trial being shown); every answer is a real key press.

This file also holds the shared driver used by the other test_lab_*.py files.
Run: python3 tests/e2e/test_lab_visit.py      (about 7 minutes: the n-back probe runs in real time)
"""
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import re
import time

os.environ.setdefault('HF_E2E_OUT', _HF_OUT + '/lab-ui')
from helpers import Check, Console, browser, close_modals, file_url, run_main, write_json

OUT_DIR = os.environ.get('HF_LAB_OUT', _HF_OUT + '/lab-ui')
os.makedirs(OUT_DIR, exist_ok=True)

WRAP_JS = r"""() => {
  if (window.__labWrapped) return true;
  window.__labWrapped = true;
  const wrap = (name) => {
    const orig = HF.timing[name];
    HF.timing[name] = function (spec, view, opts) {
      const show = view && view.show, hide = view && view.hide;
      if (view) {
        view.show = function (t) {
          window.__labTrial = { i: t.i, answer: t.answer === undefined ? null : t.answer,
            target: t.target ? !!t.target.main : null, digit: t.stim && t.stim.digit, task: t.stim && t.stim.task, kind: name };
          window.__labOn = true;
          return show ? show.call(view, t) : undefined;
        };
        view.hide = function (t) { window.__labOn = false; return hide ? hide.call(view, t) : undefined; };
      }
      window.__labRuns = (window.__labRuns || 0) + 1;
      return orig.call(HF.timing, spec, view, opts).then((log) => { window.__labOn = false; window.__labTrial = null; return log; });
    };
  };
  wrap('runStream'); wrap('runDiscrete');
  return true;
}"""

PROBE_JS = r"""() => {
  const vis = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const q = (s, r) => (r || document).querySelector(s);
  const v = HF.ui.labvisit && HF.ui.labvisit.current ? HF.ui.labvisit.current() : null;
  const h1 = q('#hf-screen h1');
  const dlg = document.querySelector('dialog.hf-modal[open]');
  const lt = q('#hf-screen .hf-lt');
  const label = (b) => ((b.querySelector('.hf-btn__label') || b).textContent || '').trim();
  const out = {
    route: HF.router.current ? HF.router.current.name : null,
    h1: h1 && vis(h1) ? h1.textContent.trim() : null,
    dialog: dlg ? ((dlg.querySelector('.hf-modal__title') || dlg).textContent || '').trim().slice(0, 60) : null,
    buttons: Array.from(document.querySelectorAll('#hf-screen button')).filter((b) => vis(b) && !b.disabled).map(label).slice(0, 24),
    test: lt ? lt.getAttribute('data-test') : null,
    progress: lt ? (lt.querySelector('.hf-lt__progress') || {}).textContent || '' : '',
    hint: lt ? (lt.querySelector('.hf-lt__hint') || {}).textContent || '' : '',
    phase: v ? v.phase : null,
    timing: HF.timing.state,
    trial: window.__labTrial || null,
    on: !!window.__labOn,
    cur: v ? v.tests[v.cur] || null : null,
    stopped: false,
  };
  if (out.test === 'matrix') {
    const w = q('.hf-mx__wrap');
    out.ready = !!w && w.style.visibility !== 'hidden' && !q('.hf-mx__opt[disabled]') && !q('.hf-lt__explain');
  } else if (out.test === 'series') {
    const w = q('.hf-sr'); const inp = q('.hf-sr__input');
    out.ready = !!w && w.style.visibility !== 'hidden' && !!inp && !inp.disabled;
  } else if (out.test === 'graph') {
    const w = q('.hf-gm');
    out.ready = !!w && w.style.visibility !== 'hidden' && !q('.hf-lt__explain');
  } else if (out.test === 'sspan') {
    const pat = q('.hf-ss__judge');
    if (pat && pat.style.visibility !== 'hidden') {
      const on = new Set(Array.from(pat.querySelectorAll('.hf-ss__on')).map((r) => r.getAttribute('x') + ',' + r.getAttribute('y')));
      let sym = true;
      on.forEach((k) => { const [x, y] = k.split(',').map(Number); if (!on.has((7 - x) + ',' + y)) sym = false; });
      out.sspan = { phase: 'judge', symmetric: sym, key: Array.from(on).sort().join('|') };
    } else if (q('.hf-cg--recall.is-live')) out.sspan = { phase: 'recall' };
    else out.sspan = { phase: 'other' };
  } else if (out.test === 'update' || out.test === 'bind') {
    out.asking = out.test === 'update' ? !!q('.hf-up__ask') && !!q('.hf-cg.is-live') : !!q('.hf-bd__opts') && !q('.hf-bd__opt[disabled]');
  } else if (out.test === 'switch') {
    out.intro = !!q('.hf-sw__intro');
  }
  return out;
}"""

DONE_RE = re.compile(r'(saved|Visit stopped)$')


def num(text, word):
    m = re.search(word + r' (\d+) of (\d+)', text or '')
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


class Driver:
    """Plays a Lab visit with real keys and clicks. `accuracy` = share of items answered right (rest wrong)."""

    def __init__(self, page, check, shots=None, prefix='visit', accuracy=1.0, log=None):
        self.page, self.c, self.shots, self.prefix = page, check, shots, prefix
        self.accuracy, self.done_keys, self.seen_tests = accuracy, set(), []
        self.log = log if log is not None else []
        self.n = 0
        self.shot_names = set()

    def ev(self, js, *a):
        return self.page.evaluate(js, *a)

    def shot(self, name):
        if self.shots is None or name in self.shot_names:
            return
        self.shot_names.add(name)
        p = os.path.join(OUT_DIR, f'{self.prefix}-{name}.png')
        self.page.screenshot(path=p)
        self.shots.append(p)

    def right(self):
        self.n += 1
        if self.accuracy >= 1:
            return True
        return (self.n * 0.6180339887) % 1 < self.accuracy

    def click_button(self, label):
        loc = self.page.locator('#hf-screen button:visible', has_text=label).first
        loc.click()

    def key(self, k):
        self.page.keyboard.press(k)

    def spec_trial(self, idx):
        return self.ev('(i) => { const v = HF.ui.labvisit.current(); const s = v && v.spec; return s && s.trials ? s.trials[i] : null; }', idx)

    def checkin(self):
        p = self.page
        p.select_option('#hf-screen select', '7')
        p.locator('#hf-screen fieldset', has_text='How alert').locator('label', has_text='4').first.click()
        p.locator('#hf-screen label', has_text='Quiet, on my own').click()
        for leg in ('How much do you expect', 'How much do you think', 'on the memory tests', 'on the reasoning puzzles', 'in everyday concentration'):
            fs = p.locator('#hf-screen fieldset', has_text=leg)
            if fs.count():
                fs.first.locator('label', has_text='5').first.click()
        self.shot('checkin')
        self.click_button('Start the tests')

    def closeout(self, help_used=False):
        p = self.page
        p.locator('#hf-screen fieldset', has_text='How hard did you try').locator('label', has_text='4').first.click()
        p.locator('#hf-screen fieldset', has_text='write anything down').locator('label', has_text='Yes' if help_used else 'No').first.click()
        p.locator('#hf-screen fieldset', has_text='interrupted').locator('label', has_text='No').first.click()
        p.locator('#hf-screen label', has_text='I grouped items together').click()
        p.fill('#lv-strat', 'Grouped the shapes in pairs.')
        blind = p.locator('#hf-screen fieldset', has_text='designed to train working memory')
        if blind.count():
            blind.first.locator('label', has_text='Programme A').first.click()
        self.shot('closeout')
        self.click_button('Save and finish')

    def act_custom(self, s):
        """custom Lab views; returns True when it acted"""
        t, ph = s['test'], s['phase']
        if t == 'matrix' and s.get('ready'):
            k, _ = num(s['progress'], 'Example' if ph == 'practice' else 'Puzzle')
            tag = ('matrix', ph, k)
            if k is None or tag in self.done_keys:
                return False
            tr = self.spec_trial(k - 1)
            ans = tr['answer'] if self.right() else (tr['answer'] + 1) % 8
            self.key(f'Digit{ans + 1}')
            self.page.wait_for_timeout(60)
            self.shot(f'matrix-{ph}')
            self.key('Enter')
            self.done_keys.add(tag)
            self.log.append(('matrix', ph, k, ans))
            return True
        if t == 'series' and s.get('ready'):
            k, _ = num(s['progress'], 'Example' if ph == 'practice' else 'Series')
            tag = ('series', ph, k)
            if k is None or tag in self.done_keys:
                return False
            tr = self.spec_trial(k - 1)
            ans = str(tr['answer'])
            typed = (ans.lower() if tr['stim']['kind'] == 'letter' else '0' + ans) if self.right() else ('Q' if tr['stim']['kind'] == 'letter' else str(int(ans) + 1))
            self.page.keyboard.type(typed)
            self.shot(f'series-{ph}')
            self.key('Enter')
            self.done_keys.add(tag)
            self.log.append(('series', ph, k, typed))
            return True
        if t == 'graph' and s.get('ready'):
            k, _ = num(s['progress'], 'Example' if ph == 'practice' else 'Item')
            tag = ('graph', ph, k)
            if k is None or tag in self.done_keys:
                return False
            letters = self.ev("""(i) => { const v = HF.ui.labvisit.current(); const t = v.spec.trials[i];
              const ord = HF.views['lab.graph'].readingOrder(t.stim.right.nodes); const L = 'ABCDEFGHJK'; const m = {};
              ord.forEach((n, j) => { m[n.id] = L[j]; }); return t.answer.map((id) => m[id]); }""", k - 1)
            if not self.right():
                letters = list(reversed(letters))
            for L in letters:
                self.key(f'Key{L}')
                self.page.wait_for_timeout(40)
            self.shot(f'graph-{ph}')
            self.key('Enter')
            self.done_keys.add(tag)
            self.log.append(('graph', ph, k, letters))
            return True
        if t == 'sspan' and s.get('sspan'):
            sp = s['sspan']
            if sp['phase'] == 'judge':
                tag = ('sspan-j', ph, s['progress'], sp['key'])
                if tag in self.done_keys:
                    return False
                self.shot(f'sspan-judge-{ph}')
                ok = self.right()
                self.key('KeyJ' if (sp['symmetric'] == ok) else 'KeyF')
                self.done_keys.add(tag)
                return True
            if sp['phase'] == 'recall':
                k, _ = num(s['progress'], 'Set')
                tag = ('sspan-r', ph, k)
                if k is None or tag in self.done_keys:
                    return False
                tr = self.spec_trial(k - 1)
                cells = [p['mem'] for p in tr['pairs']]
                if not self.right():
                    cells = list(reversed(cells))
                for cell in cells:
                    self.page.locator(f'.hf-cg--recall [data-cell="{cell}"]').click()
                self.shot(f'sspan-recall-{ph}')
                self.click_button('Done')
                self.done_keys.add(tag)
                return True
            return False
        if t in ('update', 'bind') and s.get('asking'):
            k, _ = num(s['progress'], 'Round')
            j, _ = num(s['hint'], 'Question')
            tag = (t, ph, k, j)
            if k is None or j is None or tag in self.done_keys:
                return False
            tr = self.spec_trial(k - 1)
            p = tr['probes'][j - 1]
            if t == 'update':
                key = p['answer'] + 1 if self.right() else (p['answer'] + 1) % 9 + 1
            else:
                opts = tr['options']
                key = opts.index(p['answer']) + 1 if self.right() else (opts.index(p['answer']) + 1) % len(opts) + 1
            self.shot(f'{t}-probe-{ph}')
            self.key(f'Digit{key}')
            self.done_keys.add(tag)
            return True
        if t == 'switch' and s.get('intro'):
            tag = ('switch-intro', s['progress'], tuple(s['buttons']), len(self.log))
            self.shot('switch-intro')
            self.page.wait_for_timeout(150)
            self.key('Space')
            self.log.append(('switch-intro', s['progress']))
            self.page.wait_for_timeout(250)
            return True
        return False

    def act_timed(self, s):
        tr = s.get('trial')
        if not tr or s['timing'] != 'running':
            return False
        tag = ('timed', s.get('cur'), s.get('phase'), tr['kind'], tr['i'], tr.get('digit'), tr.get('answer'), tr.get('target'), self.ev('window.__labRuns || 0'))
        if tag in self.done_keys:
            return False
        if tr['kind'] == 'runStream':
            self.done_keys.add(tag)
            if tr['target'] and self.right():
                self.page.wait_for_timeout(150)
                self.key('KeyJ')
                return True
            return False
        if not s['on']:
            return False
        self.done_keys.add(tag)
        ans = tr['answer']
        if not self.right():
            ans = 'no' if ans == 'match' else 'match'
        self.page.wait_for_timeout(120)
        self.key('KeyJ' if ans == 'match' else 'KeyF')
        if s.get('test') == 'switch':
            self.shot('switch-trial')
        elif s.get('cur') == 'lab.rel':
            self.shot('rel-array')
        elif s.get('cur') == 'lab.nback':
            self.shot('nback-stream')
        return True

    def run(self, max_s=900, stop_at=None, on_state=None):
        """drive until the done screen (or stop_at(state) is true); returns the last state"""
        t_end = time.time() + max_s
        last_h1, idle = None, 0
        while time.time() < t_end:
            s = self.ev(PROBE_JS)
            if on_state:
                on_state(s)
            if stop_at and stop_at(s):
                return s
            if s['route'] != 'labvisit':
                return s
            if s['dialog']:
                self.c.ok(False, f'unexpected dialog: {s["dialog"]}')
                return s
            h1 = s['h1']
            if h1 and DONE_RE.search(h1):
                self.shot('done')
                return s
            acted = False
            btns = s['buttons']
            if s['test'] or s['timing'] != 'idle':
                acted = self.act_timed(s) or self.act_custom(s)
                if not acted and 'Next' in btns and s['test']:
                    self.page.wait_for_timeout(80)
                    self.key('Enter')
                    acted = True
            elif 'Start block' in btns or ('Start' in btns and h1 is None):
                self.shot(f'rule-{s["cur"]}')
                self.key('Space')
                acted = True
            elif h1 == 'Check-in':
                self.checkin()
                acted = True
            elif h1 == 'Close-out':
                self.closeout()
                acted = True
            elif h1 == 'Save a copy now':
                self.shot('export')
                self.click_button('Download') if 'Download' in btns else self.page.locator('#lv-saved').check()
                self.page.wait_for_timeout(200)
                self.click_button('I have saved it')
                acted = True
            elif h1 == 'Part A is done':
                self.shot('partbreak')
                self.click_button('Start Part B now')
                acted = True
            elif 'Start practice' in btns or 'Start the test' in btns or ('Continue' in btns and h1) or ('Start' in btns and h1):
                if h1 != last_h1:
                    self.shot('step-' + re.sub(r'[^a-z0-9]+', '-', (h1 or 'x').lower()).strip('-'))
                if 'Continue' in btns and 'Back to the Lab' in btns:
                    self.click_button('Continue')
                else:
                    self.key('Space')
                acted = True
            last_h1 = h1
            if acted:
                idle = 0
                self.page.wait_for_timeout(120)
            else:
                idle += 1
                self.page.wait_for_timeout(70)
        self.c.ok(False, 'visit did not finish in time')
        return self.ev(PROBE_JS)


SEED_JS = r"""(opts) => {
  const now = Date.now(), DAY = 86400000;
  const mkRes = (id, score) => ({ testId: id, score, scoreLabel: 'seeded ' + score, sub: {}, flags: [], form: 'A', seed: 'seed', version: 1 });
  HF.store.mutate((r) => {
    r.profile = r.profile || {}; r.profile.anonId = r.profile.anonId || 'e2e-anon'; r.profile.firstRunDone = true; r.profile.updatedAt = now;
    r.labVisits = r.labVisits || []; r.sessions = r.sessions || [];
    (opts.visits || []).forEach((v, k) => {
      const tests = {};
      Object.keys(v.scores).forEach((id) => { tests[id] = mkRes(id, v.scores[id]); });
      const t = now - v.daysAgo * DAY;
      r.labVisits.push({ id: 'seed-' + v.kind + '-' + k, kind: v.kind, config: v.config || 'standard', form: v.form || 'A', startedAt: t, endedAt: t + 3000000,
        updatedAt: t, device: { class: 'desktop', input: 'keyboard' }, hour: new Date(t).getHours(), checkin: { sleepHours: v.sleep || 7 }, closeout: {}, tests, flags: v.flags || [] });
    });
    for (let i = 0; i < (opts.sessions || 0); i++) {
      const t = now - (opts.sessionsFromDaysAgo || 20) * DAY + i * DAY * 0.8;
      const d = new Date(t);
      const dk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      r.sessions.push({ id: 'seed-s' + i, startedAt: t, endedAt: t + 1500000, dayKey: dk, mode: 'varied', protocol: null, study: null, planned: 12, completed: 12, counted: true, minutes: 25, endedBy: 'done' });
    }
  });
  HF.store.flush();
  return HF.store.records.labVisits.length;
}"""


def open_app(b, w, h, route='lab', theme=None, color_scheme='light'):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=color_scheme, accept_downloads=True)
    page = ctx.new_page()
    con = Console(page)
    page.goto(file_url('index.html') + '#/' + route)
    page.wait_for_function('window.HF && HF.booted === true', timeout=15000)
    page.wait_for_timeout(300)
    close_modals(page)
    if theme:
        page.evaluate("(t) => { HF.store.mutate((r) => { r.settings.theme = t; r.settings.updatedAt = Date.now(); }); }", theme)
        page.wait_for_timeout(100)
    page.evaluate(WRAP_JS)
    return ctx, page, con


def reset_store(page):
    page.evaluate('() => { HF.store.reset(); HF.store.flush(); }')
    page.wait_for_timeout(100)
    close_modals(page)


def run():
    c = Check('lab-visit-quick')
    shots = []
    with browser() as b:
        ctx, page, con = open_app(b, 1366, 768)
        reset_store(page)
        n = page.evaluate(SEED_JS, {'visits': [
            {'kind': 'B1', 'daysAgo': 16, 'scores': {'lab.nback': 1.4, 'lab.rel': 0.42}},
            {'kind': 'B2', 'daysAgo': 12, 'scores': {'lab.nback': 1.7, 'lab.rel': 0.5}}],
            'sessions': 10, 'sessionsFromDaysAgo': 10})
        c.eq(n, 2, 'seeded two baseline visits')
        page.evaluate("HF.router.go('lab')")
        page.wait_for_timeout(300)
        c.eq(page.evaluate("document.querySelector('[data-next-kind]') && document.querySelector('[data-next-kind]').getAttribute('data-next-kind')"), 'Q', 'Lab home offers the Quick check after session 10')
        page.screenshot(path=os.path.join(OUT_DIR, 'quick-00-lab-home.png'))
        page.locator('#hf-screen button', has_text='Start Quick check').click()
        page.wait_for_timeout(200)
        c.eq(page.evaluate('HF.router.current.name'), 'labvisit', 'Start opens the visit flow')
        d = Driver(page, c, shots, prefix='quick', accuracy=0.85)
        t0 = time.time()
        s = d.run(max_s=840)
        c.details['visit_seconds'] = round(time.time() - t0)
        c.ok(s.get('h1') and 'saved' in s['h1'], f'visit finished on the done screen: {s.get("h1")}')
        rec = page.evaluate("""() => { const v = HF.store.records.labVisits.filter((x) => x.kind === 'Q');
          return v.map((x) => ({ id: x.id, config: x.config, form: x.form, tests: Object.keys(x.tests), ended: !!x.endedAt, device: x.device,
            checkin: x.checkin, closeout: x.closeout, flags: x.flags,
            scores: Object.fromEntries(Object.entries(x.tests).map(([k, r]) => [k, [r.score, r.scoreLabel, r.flags, r.frame ? r.frame.fps : null]])) })); }""")
        c.details['records'] = rec
        c.eq(len(rec), 1, 'one Quick-check record saved')
        if rec:
            r = rec[0]
            c.eq(sorted(r['tests']), ['lab.nback', 'lab.rel'], 'both probes saved')
            c.ok(r['ended'], 'record has endedAt')
            c.eq(r['config'], 'quick', 'config quick')
            c.ok(r['checkin'].get('sleepHours') == 7 and r['checkin'].get('alertness') == 4, f'check-in saved: {r["checkin"]}')
            c.ok(r['closeout'].get('effort') == 4 and r['closeout'].get('help') == 'no', f'close-out saved: {r["closeout"]}')
            nb = r['scores'].get('lab.nback')
            c.ok(nb and isinstance(nb[0], (int, float)) and nb[0] > 0.5, f'n-back probe scored from real presses (d′ > 0.5): {nb}')
            rl = r['scores'].get('lab.rel')
            c.ok(rl and isinstance(rl[0], (int, float)) and rl[0] > 0.3, f'relation probe scored (hit − FA > 0.3): {rl}')
            logs = page.evaluate("(id) => { const d = HF.store.loadTrials(id); return d ? Object.fromEntries(Object.entries(d.blocks).map(([k, e]) => [k, { blocks: (e.log && e.log.blocks || []).length, responses: (e.log && e.log.blocks || []).reduce((a, b) => a + ((b.responses || b.answers || []).filter((x) => x.response !== null).length), 0), kind: d.kind }])) : null; }", r['id'])
            c.details['trial_logs'] = logs
            c.ok(logs and logs.get('lab.nback', {}).get('blocks') == 4 and logs['lab.nback']['responses'] > 10, f'n-back trial log: 4 blocks with presses ({logs})')
            c.ok(logs and logs.get('lab.rel', {}).get('blocks') == 2, 'relation probe trial log: 2 blocks')
            c.ok(logs and logs.get('lab.nback', {}).get('kind') == 'lab', 'trial logs stored as kind lab')
        page.locator('#hf-screen button', has_text='Back to the Lab').click()
        page.wait_for_timeout(300)
        c.eq(page.evaluate('HF.router.current.name'), 'lab', 'back on the Lab home')
        pts = page.evaluate("document.querySelectorAll('.hf-dots__pt').length")
        c.ok(pts >= 6, f'dot plots show B1, B2 and Q points ({pts})')
        notes = page.evaluate("Array.from(document.querySelectorAll('.hf-dots__note')).map((n) => n.textContent)")
        c.ok(any('Not yet calibrated' in x for x in notes), f'uncalibrated verdict text shown: {notes}')
        c.ok(page.evaluate("!!document.querySelector('[data-caveat=retest]')"), 'retest caveat shown')
        page.screenshot(path=os.path.join(OUT_DIR, 'quick-99-lab-results.png'), full_page=True)
        c.details['engines'] = page.evaluate("(() => ({ player: !!(HF.player && HF.player.runSpec), nbackView: !!(HF.views && HF.views.nback), relView: !!(HF.views && HF.views.relations) }))()")
        c.eq(con.errors + con.page_errors, [], '0 console errors')
        c.details['console'] = con.summary()
        c.details['shots'] = shots
        ctx.close()
    res = c.result()
    write_json('lab-visit-quick.json', res)
    return res


if __name__ == '__main__':
    run_main(run)
