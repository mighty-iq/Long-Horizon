"""Shared driver for the lesson e2e tests (P4) + a quick sanity run of untimed practice.

The bot reads HF.ui.lessons._state() and answers with REAL key presses and clicks (Playwright keyboard/mouse):
  expect 'choice'      → clicks [data-choice=…] by priority (next, start, mini, again, finish, done, check)
  expect 'next'        → presses Space (focus is on the board) or clicks Next
  expect 'answer'      → J or F from the trial's target label (mode 'pass'), the opposite (mode 'fail')
  expect 'dual-answer' → J / K toggles, then Space
  expect 'probe'       → clicks the tape item n back;  'line' → clicks the right row/column label
  expect 'judge'       → J/F (span sums);  'keypad' → clicks the letters in order, then Done;  'match-key' → J
Timed runs: install_hooks() wraps HF.timing.runStream/runDiscrete so every view.show(trial) records the trial on
window.__hfShow (works for HF.player's views and the lesson's own view); the bot presses J/K/F on each new trial.
Run: python3 tests/e2e/test_learn_bot.py
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import time

import pathlib

import helpers
from helpers import Check, Console, browser, close_modals, file_url, run_main, write_json

OUT_DIR = os.environ.get('HF_LEARN_OUT', _HF_OUT + '/learn')
helpers.OUT = pathlib.Path(OUT_DIR)   # write_json() of the learn tests goes to out/learn

HOOK_JS = r"""
(() => {
  if (window.__hfHooked) return true;
  window.__hfHooked = true; window.__hfShow = null; window.__hfSeq = 0;
  function wrap(spec, view, kind) {
    const show = view.show;
    view.show = function (t) {
      window.__hfSeq += 1;
      window.__hfShow = { seq: window.__hfSeq, i: t.i, kind, target: t.target || null, answer: t.answer || null,
        scorable: t.scorable !== false, streams: spec.streams || null, task: spec.task, trackId: spec.trackId };
      return show ? show.apply(this, arguments) : undefined;
    };
  }
  const rs = HF.timing.runStream, rd = HF.timing.runDiscrete;
  HF.timing.runStream = function (spec, view, opts) { wrap(spec, view, 'stream'); return rs.call(HF.timing, spec, view, opts); };
  HF.timing.runDiscrete = function (spec, view, opts) { wrap(spec, view, 'discrete'); return rd.call(HF.timing, spec, view, opts); };
  return true;
})()
"""

PRIORITY = ['next', 'start', 'mini', 'again', 'finish', 'done', 'check']


def boot(page, url=None, fresh=True, prefix=None):
    """Open index.html with a clean store (own key prefix per test), close the Chimera pop-up, install hooks."""
    page.goto(url or file_url('index.html'))
    page.wait_for_function('window.HF && HF.booted === true', timeout=20000)
    if fresh:
        page.evaluate('() => { try { HF.store.reset(); } catch (e) {} return true; }')
    page.wait_for_timeout(300)
    close_modals(page)
    page.evaluate(HOOK_JS)


def set_speed(page, scale=0.5):
    page.evaluate(f"""() => {{
      if (HF.player && HF.player.debug) HF.player.debug.timeScale = {scale};
      if (HF.ui.lessons && HF.ui.lessons.config) HF.ui.lessons.config.timeScale = {scale};
      return true; }}""")


def state(page):
    return page.evaluate('() => HF.ui.lessons ? JSON.parse(JSON.stringify(HF.ui.lessons._state())) : null')


def click_choice(page, cid):
    loc = page.locator(f'[data-choice="{cid}"]').last
    loc.scroll_into_view_if_needed(timeout=2000)
    loc.click(timeout=3000)


def timed_bot(page, mode, max_s=240):
    """Answers a timed run until the lesson leaves its timed phase. mode: pass | fail | lure (press on lures only)."""
    last = None
    t0 = time.time()
    pressed = 0
    while time.time() - t0 < max_s:
        info = page.evaluate("""() => ({ show: window.__hfShow, st: HF.ui.lessons._state(), busy: !!(HF.timing && HF.timing.busy),
                                         pphase: HF.player ? HF.player.phase : null })""")
        st = info['st'] or {}
        if st.get('expect') in ('judge', 'keypad'):      # the lesson's own span runner asks directly
            return pressed
        if (st.get('phase') != 'timed' or st.get('expect') == 'choice') and not info['busy'] and info['pphase'] in (None, 'idle'):
            return pressed
        sh = info['show']
        if sh and sh['seq'] != last:
            last = sh['seq']
            keys = []
            if sh['kind'] == 'discrete':
                ans = sh.get('answer')
                want = 'j' if ans == 'match' else 'f'
                if mode == 'fail':
                    want = 'f' if ans == 'match' else 'j'
                keys = [want]
            elif sh.get('scorable'):
                tg = sh.get('target') or {}
                if mode == 'pass':
                    if tg.get('main') or tg.get('pos'):
                        keys.append('j')
                    if tg.get('snd'):
                        keys.append('k')
                elif mode == 'fail':
                    if not (tg.get('main') or tg.get('pos')):
                        keys.append('j')
            for k in keys:
                page.wait_for_timeout(120)
                page.keyboard.press(k)
                pressed += 1
        page.wait_for_timeout(35)
    raise RuntimeError('timed run did not finish')


def act(page, st, mode='pass', log=None):
    """One bot action for the current lesson state. Returns a short label."""
    ex = st.get('expect')
    tr = st.get('trial') or {}
    if ex not in ('choice', 'judge', 'keypad') and (st.get('phase') == 'timed' or ex == 'countdown'):
        n = timed_bot(page, mode if mode in ('pass', 'fail') else 'pass')
        return f'timed:{n}'
    if ex == 'choice':
        ch = st.get('choices') or []
        for cid in PRIORITY:
            if cid in ch:
                click_choice(page, cid)
                return 'choice:' + cid
        raise RuntimeError('no known choice in ' + json.dumps(ch))
    if ex == 'next':
        if (log is not None and len(log) % 3 == 0):
            click_choice(page, 'next')
        else:
            page.keyboard.press('Space')
        return 'next'
    if ex == 'answer':
        tg = tr.get('target') or {}
        is_t = bool(tg.get('main')) if 'answer' not in tr else tr.get('answer') == 'match'
        if mode == 'fail':
            is_t = not is_t
        page.keyboard.press('j' if is_t else 'f')
        return 'answer:' + ('j' if is_t else 'f')
    if ex == 'dual-answer':
        tg = tr.get('target') or {}
        if tg.get('pos'):
            page.keyboard.press('j')
        if tg.get('snd'):
            page.keyboard.press('k')
        page.wait_for_timeout(60)
        click_choice(page, 'check')
        return 'dual'
    if ex == 'probe':
        page.locator(f'button[data-tape="{st.get("probe")}"]').first.click()
        return 'probe'
    if ex == 'line':
        page.locator(f'[data-line="{st.get("line")}"]').first.click()
        return 'line'
    if ex == 'judge':
        page.keyboard.press('j' if tr.get('truth') else 'f')
        return 'judge'
    if ex == 'keypad':
        for sym in st.get('want') or []:
            page.locator(f'[data-sym="{sym}"]').first.click()
        click_choice(page, 'done')
        return 'keypad'
    if ex == 'match-key':
        page.keyboard.press('j')
        return 'matchkey'
    if ex == 'paused':
        page.get_by_role('button', name='Resume').click()
        return 'resume'
    return 'wait'


def drive(page, until, mode='pass', max_actions=600, max_s=900, on_action=None):
    """Acts until until(state) is true. Returns the list of actions."""
    log = []
    t0 = time.time()
    while len(log) < max_actions and time.time() - t0 < max_s:
        st = state(page) or {}
        if until(st):
            return log
        before = json.dumps([st.get('step'), st.get('expect'), (st.get('trial') or {}).get('i'), st.get('phase')])
        a = act(page, st, mode, log)
        log.append(a)
        if on_action:
            on_action(a, st)
        # wait until the state moves on
        for _ in range(80):
            page.wait_for_timeout(25)
            st2 = state(page) or {}
            after = json.dumps([st2.get('step'), st2.get('expect'), (st2.get('trial') or {}).get('i'), st2.get('phase')])
            if after != before or until(st2) or a == 'wait':
                break
    raise RuntimeError(f'drive: not done after {len(log)} actions; last state {json.dumps(state(page))[:400]}')


def run():
    """Sanity: untimed practice of Plain n-back, answered by the bot with real keys; nothing is written to records."""
    c = Check('learn-bot-practice')
    with browser() as b:
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        page = ctx.new_page()
        con = Console(page)
        boot(page)
        ev0 = page.evaluate('HF.store.records.events.length')
        page.evaluate("HF.router.go('practice', { trackId: 'nback.plain', rung: 2 })")
        page.wait_for_timeout(300)
        page.click('#hf-practice-start')
        acts = drive(page, lambda s: 'done' in json.dumps(s.get('done', '')) or page.locator('#hf-practice-again').count() > 0, max_actions=200)
        c.ok(page.locator('#hf-practice-again').count() == 1, 'practice round finished')
        c.ok(sum(1 for a in acts if a.startswith('answer')) >= 20, f'answered every item ({len(acts)} actions)')
        txt = page.locator('.hf-learn__practice').inner_text()
        c.ok('22 of 22 correctly' in txt or '20 of 20 correctly' in txt, 'all practice answers correct: ' + txt[:120])
        c.eq(page.evaluate('HF.store.records.events.length'), ev0, 'practice writes no events')
        c.eq(page.evaluate('HF.store.records.blocks.length'), 0, 'practice writes no blocks')
        c.eq(con.errors + con.page_errors, [], '0 console errors')
    write_json('bot.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
