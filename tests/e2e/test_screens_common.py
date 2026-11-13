"""Shared helpers for the everyday-screen e2e tests (Today, Progress, History, Settings, Free play, About, Share).

Seeding: SEED_JS runs inside the page and plays synthetic sessions through the REAL engine, generators and scorers
(HF.engine.plan → beginSession → prepare → HF.tasks[task].gen → simulated responses → score → commit → endSession),
spread over three weeks, with a style change (Varied → Sprint → Varied) so the graphs show markers, a strategy
note (Reflective badge) and trial logs for the newest sessions (History drill-down). The records replace the
store's records (HF.store.mutate) and are flushed to localStorage, so a reload boots with them.

Rules (CLAUDE.md): Chromium only, at most one browser open at a time, always closed (helpers.browser()).
Run on its own: python3 tests/e2e/test_screens_common.py  (checks that seeding works and boots cleanly)
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import pathlib

from helpers import Check, browser, close_modals, file_url, run_main

OUT = pathlib.Path(os.environ.get('HF_SCREENS_OUT', _HF_OUT + '/screens'))
DESKTOP = {'width': 1366, 'height': 768}
PHONE = {'width': 390, 'height': 844}
MY_FILES = ('ui/today.js', 'ui/progress.js', 'ui/settings.js', 'ui/free.js', 'ui/about.js', 'ui/share.js')

SEED_JS = r"""
(o) => {
  const DAY = 86400000, HOUR = 3600000;
  const now = Date.now();
  const start = now - o.days * DAY;
  let s = o.rngSeed || 987654321;
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const logistic = x => 1 / (1 + Math.exp(-x));
  let rec = HF.engine.newRecords(start);
  rec.profile = Object.assign({}, rec.profile, { firstRunDone: true, path: o.path || 'train', startedAt: start, updatedAt: start + 1 });
  rec.settings = Object.assign({}, rec.settings, { weeklyTarget: 4, sessionMinutes: o.minutes || 20, updatedAt: start + 1 });
  rec.events = (rec.events || []).concat([{ id: 'seed-tut', t: start + 60000, type: 'lesson-passed', lessonId: 'lesson.nback' }]);
  const theta = {}; let general = 0; const logs = [];
  const days = o.trainDays || [];
  for (const day of days) {
    if (o.modeAt && o.modeAt[day]) rec = Object.assign({}, rec, { settings: Object.assign({}, rec.settings, { mode: o.modeAt[day], updatedAt: start + day * DAY }) });
    let t = start + day * DAY + Math.round((16 + 3 * rnd()) * HOUR);
    if (t > now - 2 * HOUR) t = now - 2 * HOUR;
    let d = HF.engine.derive(rec, t);
    const plan = HF.engine.plan(rec, d, { now: t });
    if (!plan.slots.length) continue;
    rec = HF.engine.beginSession(rec, plan, { now: t }).records;
    d = HF.engine.derive(rec, t);
    for (let k = 0; k < plan.slots.length; k++) {
      const slot = plan.slots[k];
      if (!slot.trackId) continue;
      const bp = HF.engine.prepare(slot, rec, d, { sessionId: plan.id });
      if (bp.lessonId && !((d.lessons && d.lessons.passed) || {})[bp.lessonId]) {
        rec = Object.assign({}, rec, { events: rec.events.concat([{ id: 'seed-L-' + plan.id + '-' + k, t, type: 'lesson-passed', lessonId: bp.lessonId }]) });
        d = HF.engine.derive(rec, t);
      }
      const T = HF.tasks[bp.taskId];
      const spec = T.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed,
                           lureCount: bp.lureCount, lureMode: bp.lureMode, protocol: bp.protocol });
      const th = (theta[bp.trackId] || 0) + general + (o.skill == null ? 0.6 : o.skill);
      const diff = HF.catalog.difficulty(bp.trackId, bp.rung, { lureCount: bp.lureCount, lureMode: bp.lureMode });
      const p = logistic(th - diff + 0.8 * (rnd() - 0.5));
      let log;
      if (spec.kind === 'discrete') {
        log = { kind: 'discrete', paused: false, n: spec.trials.length, presented: spec.trials.length,
          answers: spec.trials.map(tr => { const ok = rnd() < 0.5 + 0.5 * p; return { i: tr.i, response: ok ? tr.answer : (tr.answer === 'match' ? 'no' : 'match'), rt: Math.round(900 + 900 * rnd()), voided: false, src: 'key' }; }) };
      } else {
        const responses = [], soa = spec.soaMs || 3000;
        spec.trials.forEach(tr => {
          if (!tr.scorable) return;
          (spec.streams || ['main']).forEach(st => {
            const target = tr.target && tr.target[st], lure = tr.lure && tr.lure[st];
            const pr = target ? p : (lure ? (1 - p) * 0.8 : (1 - p) * 0.25);
            if (rnd() < pr) { const rt = Math.round(420 + 380 * rnd()); responses.push({ key: st === 'snd' ? 'match2' : 'match', t: tr.i * soa + rt, trial: tr.i, rt, src: 'key' }); }
          });
        });
        log = { kind: 'stream', responses, voided: [], paused: false, n: spec.trials.length, presented: spec.trials.length };
      }
      const result = T.score(spec, log);
      const c = HF.engine.commit(rec, bp, spec, result, { now: t, sessionId: plan.id, t, derived: d });
      rec = c.records; d = c.derived;
      theta[bp.trackId] = (theta[bp.trackId] || 0) + (o.gain == null ? 0.035 : o.gain);
      general += 0.004;
      if (o.keepLogsFrom != null && day >= o.keepLogsFrom) logs.push([plan.id, c.block.id, log]);
      t += HF.catalog.estBlockMs(bp.trackId, bp.params) + 12000;
    }
    rec = HF.engine.endSession(rec, plan.id, { now: Math.min(t, now - 60000), endedBy: 'done' }).records;
  }
  if (o.mode) rec = Object.assign({}, rec, { settings: Object.assign({}, rec.settings, { mode: o.mode, updatedAt: now - HOUR }) });
  if (o.note) rec = Object.assign({}, rec, { events: rec.events.concat([{ id: 'seed-note', t: now - 3 * DAY, type: 'note', text: 'Grouping the items in pairs helps at 3-back.' }]) });
  if (o.lastExportDaysAgo != null) rec = Object.assign({}, rec, { backups: { updatedAt: now - o.lastExportDaysAgo * DAY, lastExportAt: now - o.lastExportDaysAgo * DAY } });
  HF.store.mutate(() => rec);
  logs.forEach(([sid, bid, log]) => HF.store.saveTrials(sid, bid, log, { kind: 'training' }));
  HF.store.flush(true);
  const dd = HF.store.derived;
  return { sessions: rec.sessions.length, blocks: rec.blocks.length, events: rec.events.length, logs: logs.length,
           counted: dd.sessionsCounted, badges: Object.keys(dd.badges || {}) };
}
"""

# 3 weeks, ~4 sessions a week; Sprint for a stretch in the middle (style-change markers on the graphs).
STANDARD_SEED = {
    'days': 21, 'trainDays': [0, 1, 3, 5, 7, 8, 10, 12, 14, 15, 17, 18, 20], 'minutes': 20,
    'modeAt': {'7': 'sprint', '12': 'varied'}, 'note': True, 'keepLogsFrom': 17, 'lastExportDaysAgo': 12,
    'skill': 0.0, 'gain': 0.02,
}


class ScreenConsole:
    """Console errors / warnings and uncaught page errors, with the script that raised them when known.
    `mine()` = errors from P3 files or without a source; `foreign()` = errors raised in other owners' files."""

    def __init__(self, page, ignore=()):
        self.items = []
        self.warnings = []
        self.ignore = tuple(ignore)
        page.on('console', self._on_console)
        page.on('pageerror', self._on_error)

    def _on_console(self, msg):
        text = msg.text
        if any(s in text for s in self.ignore):
            return
        if msg.type == 'error':
            loc = ''
            try:
                loc = (msg.location or {}).get('url', '') or ''
            except Exception:
                loc = ''
            self.items.append({'kind': 'console', 'text': text, 'where': loc})
        elif msg.type == 'warning':
            self.warnings.append(text)

    def _on_error(self, err):
        stack = ''
        try:
            stack = err.stack or ''
        except Exception:
            stack = ''
        self.items.append({'kind': 'pageerror', 'text': str(err), 'where': stack})

    broken = None  # scripts that do not parse (computed once per process)

    @classmethod
    def _foreign(cls, item):
        where = item.get('where') or ''
        if any(f in where for f in MY_FILES):
            return False
        if not where:
            # A parse error in a script has no stack. Blame it on a file that fails `node --check` when that file
            # belongs to another owner (an agent mid-edit), never on P3 files, which are checked here too.
            if item.get('kind') == 'pageerror' and ('Unexpected' in item.get('text', '') or 'SyntaxError' in item.get('text', '')):
                if cls.broken is None:
                    cls.broken = syntax_broken_files()
                return bool(cls.broken) and not any(any(f in b for f in MY_FILES) for b in cls.broken)
            return False
        return '/js/' in where or '/tests/' in where or where.startswith('file:')

    def mine(self):
        return [i for i in self.items if not self._foreign(i)]

    def foreign(self):
        return [i for i in self.items if self._foreign(i)]

    def summary(self):
        return {'mine': self.mine(), 'foreign': self.foreign(), 'warnings': self.warnings,
                'broken_scripts': ScreenConsole.broken or []}


def syntax_broken_files():
    """Scripts listed in index.html that do not parse (other owners' files mid-edit show up here)."""
    import re
    import subprocess
    root = pathlib.Path(__file__).resolve().parents[2]
    html = (root / 'index.html').read_text()
    bad = []
    for src in re.findall(r'<script src="([^"]+)"', html):
        p = root / src
        if p.exists():
            r = subprocess.run(['node', '--check', str(p)], capture_output=True, text=True)
            if r.returncode != 0:
                bad.append(src)
    return bad


def new_page(b, viewport=DESKTOP, dark=False, init_js=None):
    ctx = b.new_context(viewport=viewport, color_scheme='dark' if dark else 'light',
                        device_scale_factor=1, has_touch=viewport['width'] < 600, is_mobile=False)
    if init_js:
        ctx.add_init_script(init_js)
    page = ctx.new_page()
    con = ScreenConsole(page)
    return ctx, page, con


def boot(page, url=None):
    page.goto(url or file_url('index.html'))
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(250)
    close_modals(page)


def seed(page, opts=None):
    o = dict(STANDARD_SEED)
    if opts:
        o.update(opts)
    return page.evaluate(SEED_JS, o)


def reload(page):
    page.reload()
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    page.wait_for_timeout(250)
    close_modals(page)


def go(page, route, params=None, wait=350):
    page.evaluate('([r, p]) => HF.router.go(r, p || {})', [route, params or {}])
    page.wait_for_timeout(wait)


def stub_routes(page, names=('session',)):
    """Replace routes owned by other agents with recorders, so a test checks only what P3 asks for."""
    page.evaluate("""(names) => {
      window.__routeLog = window.__routeLog || [];
      names.forEach(n => HF.router.register(n, { title: 'Stub ' + n, render(root, p) {
        window.__routeLog.push({ name: n, params: JSON.parse(JSON.stringify(p || {})) });
        const h = document.createElement('h1'); h.textContent = 'Stub ' + n; root.appendChild(h);
      } }));
      return true;
    }""", list(names))


def overflow(page):
    """Horizontal overflow of the document (px) and the widest offending element inside the screen."""
    return page.evaluate("""() => {
      const de = document.documentElement;
      const over = de.scrollWidth - de.clientWidth;
      let worst = null;
      if (over > 1) {
        const W = de.clientWidth;
        document.querySelectorAll('#hf-screen *').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.right > W + 1 && (!worst || r.right > worst.right)) worst = { tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 80), right: Math.round(r.right) };
        });
      }
      return { over, worst };
    }""")


def shot(page, name, full=True):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / (name + '.png')
    page.screenshot(path=str(path), full_page=full)
    return str(path)


def write_json(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2))
    return OUT / name


def run():
    """Self-check: the seed plays through the engine and the app boots with it."""
    c = Check('screens-common')
    with browser() as b:
        ctx, page, con = new_page(b)
        boot(page)
        info = seed(page)
        c.details['seed'] = info
        c.ok(info['sessions'] >= 10 and info['blocks'] >= 100, f'seeded sessions/blocks: {info}')
        c.ok(info['logs'] > 10, 'trial logs saved for the newest sessions')
        reload(page)
        c.eq(page.evaluate('HF.store.records.sessions.length'), info['sessions'], 'sessions survive a reload')
        c.eq(con.mine(), [], 'no console or page errors from P3 code')
        c.details['console'] = con.summary()
        ctx.close()
    return c.result()


if __name__ == '__main__':
    run_main(run)
