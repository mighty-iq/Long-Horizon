"""Today, Free play, Share, History and storage flows with real clicks and keys (Chromium):
- Today redirects to `welcome` while the first run is not done (only when a welcome route exists) and shows
  itself when it does not; Start (click and Space) goes to `session` with the previewed plan id; an unfinished
  session from today shows its session bar with Continue (→ session { resume }) and "End it here";
- Free play: a coach card fills the picker; the level and pace pickers change the rung; Start goes to
  `session` with { free: { trackId, rung, pace } };
- Share: HF.ui.share.text() content and Chimera line, levels only when asked; the Share dialog (clipboard
  attempt + copy box) and its "Include my levels" switch;
- History: filters, the trial-by-trial dialog rebuilt from the saved trial log;
- storage blocked (localStorage throws): the "not saved here" notice and Export still work;
- Progress acknowledges new badges (badge-ack events).
Other owners' routes (`session`, `welcome`) are replaced by recorders so only P3's behaviour is tested.
Run: python3 tests/e2e/test_screens_today.py
"""
from helpers import Check, browser, run_main
from test_screens_common import (DESKTOP, PHONE, boot, go, new_page, reload, seed, shot, stub_routes, write_json)

BLOCK_STORAGE = """(() => {
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); } catch (e) {}
})();"""

OPEN_SESSION_JS = """() => {
  let rec = HF.store.records, now = Date.now();
  let d = HF.engine.derive(rec, now);
  const plan = HF.engine.plan(rec, d, { now });
  rec = HF.engine.beginSession(rec, plan, { now }).records;
  d = HF.engine.derive(rec, now);
  for (let k = 0; k < 3; k++) {
    const bp = HF.engine.prepare(plan.slots[k], rec, d, { sessionId: plan.id });
    const T = HF.tasks[bp.taskId];
    const spec = T.gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed, lureCount: bp.lureCount, lureMode: bp.lureMode });
    const log = spec.kind === 'discrete' ? { answers: spec.trials.map(t => ({ i: t.i, response: t.answer, rt: 900, voided: false })), paused: false }
      : { responses: spec.trials.filter(t => t.scorable && t.target && t.target.main).map(t => ({ key: 'match', trial: t.i, t: t.i * 3000 + 500, rt: 500 })), voided: [], paused: false };
    const c = HF.engine.commit(rec, bp, spec, T.score(spec, log), { now: now + k * 60000, sessionId: plan.id, t: now + k * 60000, derived: d });
    rec = c.records; d = c.derived;
  }
  HF.store.mutate(() => rec);
  return { id: plan.id, planned: plan.slots.length };
}"""


def route_log(page):
    return page.evaluate('window.__routeLog || []')


def run():
    c = Check('screens-today')
    shots = []
    with browser() as b:
        # ---------- first run: redirect to welcome, guard without it ----------
        ctx, page, con = new_page(b, DESKTOP)
        boot(page)
        page.evaluate("HF.store.mutate(r => { r.profile = Object.assign({}, r.profile, { firstRunDone: false, updatedAt: Date.now() }); })")
        stub_routes(page, ['welcome', 'session'])
        go(page, 'today')
        c.eq(page.evaluate('HF.router.current.name'), 'welcome', 'first run not done → Today redirects to welcome')
        c.eq(page.evaluate("location.hash"), '#/welcome', 'the hash mirrors welcome (no stale #/today)')
        page.evaluate("() => { window.__has = HF.router.has; HF.router.has = n => n === 'welcome' ? false : window.__has(n); }")
        go(page, 'today')
        c.eq(page.evaluate('HF.router.current.name'), 'today', 'no welcome route → Today shows')
        c.ok(page.evaluate("!!document.querySelector('#hf-today-start')"), 'Today: Start button for session 1')
        page.evaluate("() => { HF.router.has = window.__has; }")
        page.evaluate("HF.store.mutate(r => { r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }); })")
        go(page, 'today')
        c.eq(page.evaluate('HF.router.current.name'), 'today', 'first run done → Today stays')
        plan_id = page.evaluate("HF.ui.today && document.querySelector('#hf-today-start') ? true : false")
        page.click('#hf-today-start')
        page.wait_for_timeout(200)
        log = route_log(page)
        c.ok(log and log[-1]['name'] == 'session' and isinstance(log[-1]['params'].get('planId'), str), f'Start → session with the plan id ({log[-1] if log else None})')
        go(page, 'today')
        page.evaluate("document.activeElement && document.activeElement.blur()")
        n_before = len(route_log(page))
        page.keyboard.press('Space')
        page.wait_for_timeout(200)
        log = route_log(page)
        c.ok(len(log) == n_before + 1 and log[-1]['name'] == 'session', 'Space starts the session from Today')
        c.eq(con.mine(), [], 'first-run flows: no console errors from P3 code')
        ctx.close()

        # ---------- seeded user ----------
        ctx, page, con = new_page(b, DESKTOP)
        boot(page)
        seed(page)
        reload(page)
        stub_routes(page, ['session', 'welcome'])

        # Share
        t = page.evaluate("HF.ui.share.text(HF.store.records, HF.store.derived, { includeLevels: false })")
        c.ok(t.startswith('Training my working memory with Long-Horizon: hold more steps, keep them straight.\n'), 'share text starts with the name line')
        c.ok(t.endswith('Free, built by the Chimera community on Discord: https://discord.gg/chmr'), 'share text ends with the Chimera line')
        c.ok('training sessions so far' in t and 'min this week' in t, f'share text: sessions and minutes ({t.splitlines()[0]!r})')
        c.ok('newest badge:' in t, 'share text: newest badge')
        c.ok('Levels:' not in t, 'share text: no levels unless asked')
        t2 = page.evaluate("HF.ui.share.text(HF.store.records, HF.store.derived, { includeLevels: true })")
        c.ok('Levels:' in t2 and '-back' in t2, 'share text with levels')
        c.ok(not any(x in t2.replace('https://discord.gg/chmr', '') for x in ('anonId', 'u-', 'http')), 'share text has no ids or other links')
        go(page, 'progress')
        page.click('#hf-share-btn')
        page.wait_for_selector('dialog.hf-modal--share[open]', timeout=3000)
        page.wait_for_timeout(300)
        box = page.evaluate("document.querySelector('dialog.hf-modal--share textarea').value")
        c.eq(box, t, 'share dialog shows the same text (levels off by default)')
        status = page.evaluate("document.querySelector('.hf-share__status').textContent")
        c.ok(status.startswith('Copied') or 'Copy the text below' in status, f'clipboard attempted, outcome said ({status!r})')
        c.eq(page.evaluate("[...document.querySelectorAll('dialog.hf-modal--share a')].map(a => [a.href, a.target, a.rel])[0]"), ['https://discord.gg/chmr', '_blank', 'noopener'], 'share dialog links to the Chimera Discord')
        page.click("dialog.hf-modal--share label.hf-toggle")
        page.wait_for_timeout(150)
        c.ok('Levels:' in page.evaluate("document.querySelector('dialog.hf-modal--share textarea').value"), 'switching levels on updates the text')
        c.eq(page.evaluate('HF.store.records.settings.includeLevelsInShare'), True, 'the choice is saved')
        shots.append(shot(page, 'share-dialog-desktop-light', full=False))
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        c.eq(page.evaluate('HF.dom.openModals()'), 0, 'Escape closes the share dialog')

        # badge acknowledgement
        page.wait_for_timeout(1400)
        c.eq(page.evaluate('HF.store.derived.badgesUnseen.length'), 0, 'viewing Progress acknowledges new badges')

        # Free play
        go(page, 'free')
        card = page.evaluate("(() => { const k = document.querySelector('.hf-coach__card'); return k ? k.getAttribute('aria-label') : null; })()")
        c.ok(bool(card), f'coach card present ({card})')
        page.click('.hf-coach__card >> nth=0')
        page.wait_for_timeout(200)
        chosen = page.evaluate("document.querySelector('#hf-free-track').value")
        c.ok(chosen and chosen.split('.')[0] in ('nback', 'rel', 'span'), f'coach card filled the version picker ({chosen})')
        page.select_option('#hf-free-track', 'nback.plain')
        page.wait_for_timeout(200)
        page.select_option('#hf-free-level', '2')
        page.wait_for_timeout(150)
        if page.evaluate("!!document.querySelector('input[name=hf-free-pace]')"):
            page.click("label.hf-seg__opt:has(input[name='hf-free-pace'][value='fast'])")
            page.wait_for_timeout(150)
        c.ok('3-back · fast' in page.evaluate("document.querySelector('.hf-free__choice').textContent"), 'level 3-back + fast pace chosen')
        page.click('#hf-free-start')
        page.wait_for_timeout(200)
        log = route_log(page)
        c.eq(log[-1], {'name': 'session', 'params': {'free': {'trackId': 'nback.plain', 'rung': 5, 'pace': 'fast'}}}, 'Free play → session { free: { trackId, rung, pace } }')
        c.eq(page.evaluate('HF.store.records.settings.freePace'), 'fast', 'pace remembered in settings.freePace')
        go(page, 'free', {'trackId': 'rel.grid.T1'})
        c.eq(page.evaluate("document.querySelector('#hf-free-track').value"), 'rel.grid.T1', 'Free play opens on the version asked for')
        c.ok(page.evaluate("!document.querySelector('input[name=hf-free-pace]')"), 'no pace choice for the Relation Grid')
        page.click('#hf-free-start')
        page.wait_for_timeout(200)
        p = route_log(page)[-1]['params']['free']
        c.ok(p['trackId'] == 'rel.grid.T1' and p['pace'] is None and isinstance(p['rung'], int), f'grid free block: pace null ({p})')

        # History: filters + trial dialog
        go(page, 'history')
        n_all = page.evaluate("document.querySelectorAll('.hf-hist__session').length")
        page.select_option('#hf-hist-period', 'all')
        page.wait_for_timeout(200)
        page.select_option('#hf-hist-kind', 'warmup')
        page.wait_for_timeout(200)
        roles = page.evaluate("[...document.querySelectorAll('.hf-hist__block')].length")
        c.ok(roles >= 1 and roles <= n_all * 3, f'warm-up filter lists only warm-ups ({roles})')
        c.ok(page.evaluate("document.activeElement && document.activeElement.id") == 'hf-hist-kind', 'focus stays on the filter after redraw')
        page.select_option('#hf-hist-kind', 'all')
        page.wait_for_timeout(200)
        page.click('.hf-hist__session[open] .hf-hist__trials >> nth=1')
        page.wait_for_selector('dialog.hf-modal--trials[open]', timeout=3000)
        rows = page.evaluate("document.querySelectorAll('dialog.hf-modal--trials tbody tr').length")
        txt = page.evaluate("document.querySelector('dialog.hf-modal--trials').textContent")
        c.ok(rows >= 10, f'trial dialog lists the trials ({rows} rows)')
        c.ok(any(w in txt for w in ('Match caught', 'Left alone, correctly', 'Correct', 'Not correct')), 'trial dialog shows outcomes from the scorer')
        page.wait_for_timeout(400)
        shots.append(shot(page, 'history-trials-desktop-light', full=False))
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        # an old session without trial logs
        page.click('.hf-hist__session:last-of-type summary')
        page.wait_for_timeout(150)
        page.click('.hf-hist__session:last-of-type .hf-hist__trials >> nth=0')
        page.wait_for_selector('dialog.hf-modal--trials[open]', timeout=3000)
        c.ok('No trial details for this block' in page.evaluate("document.querySelector('dialog.hf-modal--trials').textContent"), 'old block without a log: a plain note')
        page.keyboard.press('Escape')

        # Today: an unfinished session from today → Continue / End it here
        info = page.evaluate(OPEN_SESSION_JS)
        go(page, 'today')
        c.ok(page.evaluate("document.querySelector('#hf-today-panel .hf-card__title').textContent.includes('in progress')"), 'open session shown as in progress')
        c.eq(page.evaluate("document.querySelectorAll('#hf-today-panel .hf-sbar__seg.is-done').length"), 3, 'its session bar shows 3 blocks done')
        shots.append(shot(page, 'today-open-session-desktop-light', full=False))
        page.click('#hf-today-continue')
        page.wait_for_timeout(200)
        c.eq(route_log(page)[-1], {'name': 'session', 'params': {'resume': info['id']}}, 'Continue → session { resume: id }')
        go(page, 'today')
        page.click("#hf-today-panel button:has-text('End it here')")
        page.wait_for_timeout(300)
        c.ok(page.evaluate(f"!!HF.store.records.sessions.find(s => s.id === '{info['id']}').endedAt"), 'End it here ends the session')
        c.ok(page.evaluate("!!document.querySelector('#hf-today-start')"), 'Today then shows the next session')
        c.details['console_seeded'] = con.summary()
        c.eq(con.mine(), [], 'seeded flows: no console errors from P3 code')
        ctx.close()

        # ---------- storage blocked ----------
        ctx, page, con = new_page(b, PHONE, init_js=BLOCK_STORAGE)
        boot(page)
        c.eq(page.evaluate('HF.store.persistent'), False, 'storage blocked → memory mode')
        page.evaluate("HF.store.mutate(r => { r.profile = Object.assign({}, r.profile, { firstRunDone: true, updatedAt: Date.now() }); })")
        go(page, 'today')
        c.ok(page.evaluate("!!document.querySelector('.hf-today__storage')"), 'Today: "Not saved on this device" notice')
        shots.append(shot(page, 'today-storage-blocked-phone-light', full=False))
        page.click('.hf-today__storage button')
        page.wait_for_selector('dialog.hf-modal--backup[open]', timeout=3000)
        page.click('dialog.hf-modal--backup #hf-export-json')
        page.wait_for_timeout(200)
        val = page.evaluate("document.querySelector('dialog.hf-modal--backup .hf-backup__box textarea').value")
        c.ok(val.startswith('{') and 'long-horizon-backup' in val, 'Export works in memory mode (copy box filled)')
        shots.append(shot(page, 'backup-dialog-phone-light', full=False))
        page.keyboard.press('Escape')
        go(page, 'about')
        c.ok('not saved here' in page.evaluate("document.querySelector('#version').textContent"), 'About: storage shown as memory only')
        c.eq(con.mine(), [], 'storage blocked: no console errors from P3 code')
        ctx.close()
    c.details['shots'] = shots
    write_json('today.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
