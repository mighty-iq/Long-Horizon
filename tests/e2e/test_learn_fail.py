"""Failing path: welcome → skip to the check → two failed checks (real key presses on every non-match) →
error routing to a mini-lesson in between → assisted start (lesson-failed ×2 + assist-start {trackId: 'nback.plain'})
→ derive turns Plain rated slots into assisted blocks. Also: the four error routes from synthetic runs
(many false presses → nothing, lures → window, wrong keys → keys, late presses → timing).
Run: python3 tests/e2e/test_learn_fail.py
"""
import json

from helpers import Check, Console, browser, run_main, write_json
from test_learn_bot import OUT_DIR, boot, drive, set_speed, state

ROUTES_JS = r"""
() => {
  const I = HF.ui.lessons._internal;
  const spec = I.genSpec({ trackId: 'nback.plain', rung: 2, set: 'letters', seed: 'route-test' });
  const T = spec.trials;
  const mk = (responses, wrongKeys) => {
    const log = { responses, voided: [], paused: false };
    return { spec, log, result: HF.tasks.nback.score(spec, log), wrongKeys: wrongKeys || 0 };
  };
  const press = (i, rt) => ({ key: 'match', trial: i, t: i * 3000 + (rt || 600), rt: rt || 600 });
  const targets = T.filter(t => t.scorable && t.target.main).map(t => t.i);
  const lures = T.filter(t => t.scorable && !t.target.main && t.lure.main).map(t => t.i);
  const fillers = T.filter(t => t.scorable && !t.target.main && !t.lure.main).map(t => t.i);
  const out = {};
  out.nothing = I.analyse(mk(targets.slice(0, 3).map(i => press(i)).concat(fillers.slice(0, 4).map(i => press(i))))).route;
  out.window = I.analyse(mk(targets.slice(0, 4).map(i => press(i)).concat(lures.map(i => press(i))))).route;
  out.keys = I.analyse(mk(targets.slice(0, 2).map(i => press(i)), 4)).route;
  const late = targets.filter(i => i + 1 < T.length && !T[i + 1].target.main).slice(0, 3).map(i => press(i + 1, 180));
  out.timing = I.analyse(mk(late)).route;
  out.counts = { targets: targets.length, lures: lures.length, fillers: fillers.length };
  return out;
}
"""


def run():
    c = Check('learn-fail-assist')
    with browser() as b:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        page = ctx.new_page()
        con = Console(page)
        boot(page)
        set_speed(page, 0.5)
        routes = page.evaluate(ROUTES_JS)
        c.details['routes'] = routes
        for k in ('nothing', 'window', 'keys', 'timing'):
            c.eq(routes[k], k, 'error route ' + k)
        page.evaluate("HF.router.go('welcome')")
        page.wait_for_timeout(300)
        page.click('#hf-welcome-start')
        page.wait_for_timeout(300)
        page.locator('[data-choice="skip"]').click()     # "I know n-back: skip to the check"
        page.wait_for_timeout(300)
        shots = {}

        def snap(a, st):
            for name, cond in (('fail-01-routed', st.get('phase') == 'result' and 'Show me' in page.locator('.hf-lesson__body').inner_text()),
                               ('fail-02-mini', st.get('phase') == 'mini'),
                               ('fail-03-drill', st.get('phase') == 'guided' and st.get('mini'))):
                if cond and name not in shots:
                    shots[name] = True
                    page.screenshot(path=f'{OUT_DIR}/{name}.png', full_page=True)
        # first check: press J on every non-match → many false presses
        drive(page, lambda s: s.get('phase') == 'result', mode='fail', max_s=300)
        st = state(page)
        c.eq((st.get('check') or {}).get('pass'), False, 'first check not passed')
        c.eq((st.get('analysis') or {}).get('route'), 'nothing', 'routed to "doing nothing is an answer"')
        page.screenshot(path=f'{OUT_DIR}/fail-01-routed.png', full_page=True)
        shots['fail-01-routed'] = True
        evs = page.evaluate("HF.store.records.events.filter(e => e.type === 'lesson-failed').length")
        c.eq(evs, 1, 'one lesson-failed event after the first check')
        drive(page, lambda s: s.get('phase') == 'mini', mode='fail', max_s=60)
        page.screenshot(path=f'{OUT_DIR}/fail-02-mini.png', full_page=True)
        shots['fail-02-mini'] = True
        mini_txt = page.locator('.hf-lesson__body').inner_text()
        c.ok('Doing nothing is an answer' in mini_txt, 'mini-lesson title shown')
        c.ok('From your check:' in mini_txt, 'mini-lesson shows the learner’s own errors')
        # through the drill and the second check (fail again) to the end page
        drive(page, lambda s: s.get('phase') == 'end', mode='fail', max_s=600, on_action=snap)
        page.screenshot(path=f'{OUT_DIR}/fail-04-assisted-end.png', full_page=True)
        st = state(page)
        c.ok((st.get('result') or {}).get('assisted') is True, 'assisted start: ' + json.dumps(st.get('result')))
        end_txt = page.locator('.hf-lesson__body').inner_text()
        c.ok('tape on' in end_txt and '4 of 6' in end_txt, 'end page explains the assisted start')
        c.ok('discord.gg/chmr' in end_txt, 'Chimera line on the assisted end page too')
        ev = page.evaluate("HF.store.records.events.filter(e => /^lesson|^assist/.test(e.type)).map(e => [e.type, e.lessonId || e.trackId])")
        c.eq(ev, [['lesson-failed', 'lesson.nback'], ['lesson-failed', 'lesson.nback'], ['assist-start', 'nback.plain']], 'events: 2 × lesson-failed, assist-start')
        d = page.evaluate("JSON.parse(JSON.stringify(HF.store.derived.assist))")
        c.ok(d.get('active') is True and d.get('trackId') == 'nback.plain' and d.get('needed') == 2, 'derive: assist active for nback.plain ' + json.dumps(d))
        c.eq(page.evaluate("HF.ui.lessons.needed('nback.plain')"), None, 'the lesson is not forced again (the assisted path takes over)')
        page.locator('[data-choice="finish"]').click()
        page.wait_for_timeout(600)
        c.eq(page.evaluate('HF.store.records.profile.firstRunDone'), True, 'first run done after the assisted start')
        plan = page.evaluate("""() => { const r = HF.store.records, d = HF.store.derived; const p = HF.engine.plan(r, d, { now: Date.now() });
                                return { roles: p.slots.filter(s => s.trackId === 'nback.plain').map(s => s.role), notes: (p.notes || []).map(n => n.code) }; }""")
        c.details['plan'] = plan
        c.ok('assist' in plan['roles'], 'the next plan holds assisted Plain blocks: ' + json.dumps(plan))
        c.eq(page.evaluate('HF.store.records.blocks.length'), 0, 'no training blocks were logged by the lesson')
        page.evaluate("HF.router.go('learn')")
        page.wait_for_timeout(300)
        c.eq(con.errors + con.page_errors, [], '0 console errors')
    write_json('fail.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
