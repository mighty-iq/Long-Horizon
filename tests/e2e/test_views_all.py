"""Runs every task-view e2e test one after another (one Chromium at a time) and writes
out/views/summary.json.
Run: python3 tests/e2e/test_views_all.py [relations|span|vsearch|shots|srcdoc ...]
"""
import sys
import time

import test_views_relations
import test_views_shots
import test_views_span
import test_views_srcdoc
import test_views_vsearch
from test_views_common import write_json

TESTS = {'relations': test_views_relations, 'span': test_views_span, 'vsearch': test_views_vsearch,
         'shots': test_views_shots, 'srcdoc': test_views_srcdoc}


def main():
    names = [n for n in sys.argv[1:] if n in TESTS] or list(TESTS)
    results = []
    for name in names:
        t = time.time()
        try:
            r = TESTS[name].run()
        except Exception as e:  # a crashed test is a failed test; the others still run
            r = {'name': 'views-' + name, 'ok': False, 'passed': 0, 'failures': [f'crashed: {e!r}'], 'details': {}}
        r['seconds'] = round(time.time() - t, 1)
        results.append(r)
        print(f"{r['name']}: {'PASS' if r['ok'] else 'FAIL'} ({r['passed']} checks, {len(r['failures'])} failures, {r['seconds']} s)")
        for f in r['failures']:
            print('   - ' + f)
    summary = {'ok': all(r['ok'] for r in results),
               'tests': [{k: r[k] for k in ('name', 'ok', 'passed', 'failures', 'seconds')} for r in results]}
    write_json('summary.json', summary)
    sys.exit(0 if summary['ok'] else 1)


if __name__ == '__main__':
    main()
