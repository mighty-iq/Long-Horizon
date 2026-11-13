"""(d) Two tabs on the same origin (local python3 -m http.server on a free port) share localStorage: records written
in either tab are merged, never dropped; storage events reach the other tab and its subscribers; a tab whose save
races another tab's write merges before writing; both tabs converge to the same records.
Run: python3 tests/e2e/test_core_tabs.py
"""
from helpers import Check, Console, browser, close_modals, http_server, run_main, write_json

ADD = "id => { HF.store.mutate(r => { r.events.push({ id, t: Date.now(), type: 'note', text: id }); }); return true; }"
IDS = "() => HF.store.records.events.map(e => e.id).sort()"
STORED = "() => { const m = JSON.parse(localStorage.getItem('long-horizon.v1.main')); return m.events.map(e => e.id).sort(); }"


def run():
    c = Check('core-tabs')
    with http_server() as base, browser() as b:
        ctx = b.new_context(viewport={'width': 1000, 'height': 700})
        a = ctx.new_page()
        con_a = Console(a)
        a.goto(base + '/index.html')
        a.wait_for_function('window.HF && HF.booted === true')
        a.evaluate('() => { localStorage.clear(); return true; }')
        a.reload()
        a.wait_for_function('window.HF && HF.booted === true')
        close_modals(a)
        a.evaluate('HF.store.flush()')
        bb = ctx.new_page()
        con_b = Console(bb)
        bb.goto(base + '/index.html')
        bb.wait_for_function('window.HF && HF.booted === true')
        close_modals(bb)
        c.ok(a.evaluate('HF.store.persistent') and bb.evaluate('HF.store.persistent'), 'both tabs persistent (http origin)')
        c.eq(a.evaluate('HF.store.records.profile.anonId'), bb.evaluate('HF.store.records.profile.anonId'), 'same profile in both tabs')
        for p in (a, bb):
            p.evaluate("() => { window.changes = []; HF.store.onChange(e => changes.push(e.source)); return true; }")

        # 1. A writes; B hears it through the storage event
        a.evaluate(ADD, 'a1')
        a.evaluate('HF.store.flush()')
        bb.wait_for_function("HF.store.records.events.some(e => e.id === 'a1')", timeout=5000)
        c.ok('remote' in bb.evaluate('changes'), 'B subscribers told (source remote)')

        # 2. B has an unsaved record while A saves another: B's save merges first, nothing is lost
        bb.evaluate(ADD, 'b1')
        a.evaluate(ADD, 'a2')
        a.evaluate('HF.store.flush()')
        bb.evaluate('HF.store.flush()')
        a.wait_for_function("HF.store.records.events.some(e => e.id === 'b1')", timeout=5000)
        bb.wait_for_function("HF.store.records.events.some(e => e.id === 'a2')", timeout=5000)
        c.eq(a.evaluate(STORED), ['a1', 'a2', 'b1'], 'storage holds the union')

        # 3. both tabs add without saving, then both save (in either order)
        a.evaluate(ADD, 'x')
        bb.evaluate(ADD, 'y')
        bb.evaluate('HF.store.flush()')
        a.evaluate('HF.store.flush()')
        a.wait_for_function("HF.store.records.events.length === 5", timeout=5000)
        bb.wait_for_function("HF.store.records.events.length === 5", timeout=5000)
        expect = ['a1', 'a2', 'b1', 'x', 'y']
        c.eq(a.evaluate(IDS), expect, 'tab A converged')
        c.eq(bb.evaluate(IDS), expect, 'tab B converged')
        c.eq(a.evaluate(STORED), expect, 'storage converged')

        # 4. last-writer-wins settings: the newer change wins in both tabs
        a.evaluate("() => { HF.store.mutate(r => { r.settings = Object.assign({}, r.settings, { volume: 0.2, updatedAt: Date.now() }); }); HF.store.flush(); return true; }")
        a.wait_for_timeout(30)
        bb.evaluate("() => { HF.store.mutate(r => { r.settings = Object.assign({}, r.settings, { volume: 0.6, updatedAt: Date.now() }); }); HF.store.flush(); return true; }")
        a.wait_for_function('HF.store.records.settings.volume === 0.6', timeout=5000)
        c.eq(bb.evaluate('HF.store.records.settings.volume'), 0.6, 'newer settings win (B)')

        # 5. a fresh third tab reads everything
        cpage = ctx.new_page()
        con_c = Console(cpage)
        cpage.goto(base + '/index.html')
        cpage.wait_for_function('window.HF && HF.booted === true')
        c.eq(cpage.evaluate(IDS), expect, 'a new tab loads the merged records')
        a.wait_for_timeout(300)
        errs = con_a.errors + con_a.page_errors + con_b.errors + con_b.page_errors + con_c.errors + con_c.page_errors
        c.details['console'] = {'a': con_a.summary(), 'b': con_b.summary(), 'c': con_c.summary()}
        c.eq(errs, [], 'no console or page errors in any tab')
        c.details['revs'] = {'a': a.evaluate('HF.store.records.rev'), 'b': bb.evaluate('HF.store.records.rev')}
        ctx.close()
    write_json('tabs.json', c.result())
    return c.result()


if __name__ == '__main__':
    run_main(run)
