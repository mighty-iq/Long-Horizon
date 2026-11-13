"""Runs the Learn/lesson e2e tests one after another (one Chromium at a time) and writes out/learn/summary.json.
Run: python3 tests/e2e/run_learn.py [bot|welcome|own|views|fail|lessons|screens ...]
"""
import json
import sys
import time

import test_learn_bot
import test_learn_fail
import test_learn_lessons
import test_learn_screens
import test_learn_welcome
from test_learn_bot import write_json

TESTS = {
    'bot': lambda: test_learn_bot.run(),
    'welcome': lambda: test_learn_welcome.run(path='player'),
    'views': lambda: test_learn_welcome.run(path='views'),
    'own': lambda: test_learn_welcome.run(path='own'),
    'fail': lambda: test_learn_fail.run(),
    'lessons': lambda: test_learn_lessons.run(),
    'screens': lambda: test_learn_screens.run(),
}


def main():
    names = [n for n in sys.argv[1:] if n in TESTS] or list(TESTS)
    results = []
    for name in names:
        t = time.time()
        try:
            r = TESTS[name]()
        except Exception as e:  # a crashed test is a failed test; the others still run
            r = {'name': 'learn-' + name, 'ok': False, 'passed': 0, 'failures': [f'crashed: {e!r}'], 'details': {}}
        r['seconds'] = round(time.time() - t, 1)
        results.append(r)
        print(f"{r['name']}: {'PASS' if r['ok'] else 'FAIL'} ({r['passed']} checks, {len(r['failures'])} failures, {r['seconds']} s)", flush=True)
        for f in r['failures']:
            print('   - ' + f, flush=True)
    summary = {'ok': all(r['ok'] for r in results),
               'tests': [{k: r[k] for k in ('name', 'ok', 'passed', 'failures', 'seconds')} for r in results]}
    write_json('summary.json', summary)
    print(json.dumps({'ok': summary['ok'], 'checks': sum(r['passed'] for r in results)}))
    sys.exit(0 if summary['ok'] else 1)


if __name__ == '__main__':
    main()
