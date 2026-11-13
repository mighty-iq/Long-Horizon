"""Runs every P1a session e2e test one after another (one Chromium at a time) and writes
out/session/summary.json.
Run: python3 tests/e2e/test_session_all.py [varied views dual pause free protocol resume feedback span lab srcdoc fixes screens]
"""
import json
import sys
import time
import traceback

import test_session_dual
import test_session_feedback
import test_session_fixes
import test_session_free
import test_session_lab
import test_session_pause
import test_session_protocol
import test_session_resume
import test_session_screens
import test_session_span
import test_session_srcdoc
import test_session_varied
import test_session_views
from test_session_lib import OUT

TESTS = {'varied': test_session_varied, 'views': test_session_views, 'dual': test_session_dual, 'pause': test_session_pause,
         'free': test_session_free, 'protocol': test_session_protocol, 'resume': test_session_resume,
         'feedback': test_session_feedback, 'span': test_session_span, 'lab': test_session_lab, 'srcdoc': test_session_srcdoc,
         'fixes': test_session_fixes, 'screens': test_session_screens}


def main():
    names = [n for n in sys.argv[1:] if n in TESTS] or list(TESTS)
    results = []
    for name in names:
        t = time.time()
        try:
            r = TESTS[name].run()
        except Exception as e:  # a crashed test is a failed test; the others still run
            r = {'name': 'session-' + name, 'ok': False, 'passed': 0, 'failures': ['crashed: %r' % e], 'details': {}}
            print(traceback.format_exc()[-2500:], flush=True)
        r['seconds'] = round(time.time() - t, 1)
        results.append(r)
        print('%s: %s (%d checks, %d failures, %s s)' % (r['name'], 'PASS' if r['ok'] else 'FAIL', r['passed'], len(r['failures']), r['seconds']), flush=True)
        for f in r['failures']:
            print('   - ' + f, flush=True)
    summary = {'ok': all(r['ok'] for r in results),
               'checks': sum(r['passed'] for r in results),
               'tests': [{k: r.get(k) for k in ('name', 'ok', 'passed', 'failures', 'seconds')} for r in results],
               'skipped_scripts': sorted({s for r in results for s in (r.get('details') or {}).get('skipped_scripts', [])}),
               'unexpected_pauses': __import__('test_session_lib').UNEXPECTED_PAUSES}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
    print('ALL: %s, %d checks' % ('PASS' if summary['ok'] else 'FAIL', summary['checks']))
    sys.exit(0 if summary['ok'] else 1)


if __name__ == '__main__':
    main()
