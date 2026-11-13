"""Runs every everyday-screen e2e test one after another (one Chromium at a time) and writes
out/screens/summary.json.
Run: python3 tests/e2e/test_screens_all.py [common|render|settings|today|srcdoc ...]
"""
import json
import sys
import time

import test_screens_common
import test_screens_render
import test_screens_settings
import test_screens_srcdoc
import test_screens_today
from test_screens_common import write_json

TESTS = {'common': test_screens_common, 'render': test_screens_render, 'settings': test_screens_settings,
         'today': test_screens_today, 'srcdoc': test_screens_srcdoc}


def run():
    names = [n for n in sys.argv[1:] if n in TESTS] or list(TESTS)
    results = []
    for name in names:
        t = time.time()
        try:
            r = TESTS[name].run()
        except Exception as e:  # a crashed test is a failed test; the others still run
            r = {'name': 'screens-' + name, 'ok': False, 'passed': 0, 'failures': [f'crashed: {e!r}'], 'details': {}}
        r['seconds'] = round(time.time() - t, 1)
        results.append(r)
        print(f"{r['name']}: {'PASS' if r['ok'] else 'FAIL'} ({r['passed']} checks, {len(r['failures'])} failures, {r['seconds']} s)")
        for f in r['failures']:
            print('   - ' + f)
        foreign = (r.get('details') or {}).get('console', {}).get('foreign') if isinstance((r.get('details') or {}).get('console'), dict) else None
        if foreign:
            print('   (errors from other owners’ files: ' + json.dumps(foreign)[:300] + ')')
    summary = {'ok': all(r['ok'] for r in results), 'checks': sum(r['passed'] for r in results),
               'tests': [{k: r[k] for k in ('name', 'ok', 'passed', 'failures', 'seconds')} for r in results]}
    write_json('summary.json', summary)
    return summary


if __name__ == '__main__':
    s = run()
    sys.exit(0 if s['ok'] else 1)
