"""Runs the core e2e tests one after another (one Chromium at a time) and writes out/core/summary.json.
Run: python3 tests/e2e/run_core.py [timing|index|srcdoc|tabs|pwa|iab|migrate ...]
"""
import json
import sys
import time

import test_core_iab
import test_core_index
import test_core_migrate
import test_core_pwa
import test_core_srcdoc
import test_core_tabs
import test_core_timing
from helpers import write_json

TESTS = {'timing': test_core_timing, 'index': test_core_index, 'srcdoc': test_core_srcdoc, 'tabs': test_core_tabs,
         'pwa': test_core_pwa, 'iab': test_core_iab, 'migrate': test_core_migrate}


def main():
    names = [n for n in sys.argv[1:] if n in TESTS] or list(TESTS)
    results = []
    for name in names:
        t = time.time()
        try:
            r = TESTS[name].run()
        except Exception as e:  # a crashed test is a failed test, the others still run
            r = {'name': 'core-' + name, 'ok': False, 'passed': 0, 'failures': [f'crashed: {e!r}'], 'details': {}}
        r['seconds'] = round(time.time() - t, 1)
        results.append(r)
        print(f"{r['name']}: {'PASS' if r['ok'] else 'FAIL'} ({r['passed']} checks, {len(r['failures'])} failures, {r['seconds']} s)")
        for f in r['failures']:
            print('   - ' + f)
    timing = next((r['details'].get('stream20') for r in results if r['name'] == 'core-timing'), None)
    summary = {'ok': all(r['ok'] for r in results),
               'tests': [{k: r[k] for k in ('name', 'ok', 'passed', 'failures', 'seconds')} for r in results],
               'timing': timing}
    write_json('summary.json', summary)
    if timing:
        print("timing:", json.dumps({k: timing.get(k) for k in ("interval_ms", "duration_ms", "soa_ms", "gaps_over_2_5_frames", "loaf_in_block", "loaf_ours", "attempts", "load_avg_1min")}))
    sys.exit(0 if summary['ok'] else 1)


if __name__ == '__main__':
    main()
