"""Full regression: every e2e suite one after another (one Chromium at a time), then the learner simulations.

Usage:  python3 tests/e2e/run_all.py [--skip-sims] [--only name1,name2]
Writes logs and a summary to out/phase3/ (or $LONG_HORIZON_OUT/phase3) and touches
REGRESSION_DONE when finished. Each suite keeps writing its own detailed results under out/<area>/.
"""
import json
import os
_HF_OUT = os.environ.get('LONG_HORIZON_OUT', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'out'))  # test outputs (gitignored)
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('LONG_HORIZON_OUT', _HF_OUT + '')) / 'phase3'
PY = sys.executable

SUITES = [
    ('core', [PY, 'tests/e2e/run_core.py'], 1800),
    ('views', [PY, 'tests/e2e/test_views_all.py'], 3600),
    ('screens', [PY, 'tests/e2e/test_screens_all.py'], 1800),
    ('lab-home', [PY, 'tests/e2e/test_lab_home.py'], 1800),
    ('lab-items', [PY, 'tests/e2e/test_lab_items.py'], 1800),
    ('lab-study', [PY, 'tests/e2e/test_lab_study.py'], 1800),
    ('lab-post', [PY, 'tests/e2e/test_lab_post.py'], 1800),
    ('lab-srcdoc', [PY, 'tests/e2e/test_lab_srcdoc.py'], 1800),
    ('lab-stop', [PY, 'tests/e2e/test_lab_stop.py'], 1800),
    ('lab-minimum', [PY, 'tests/e2e/test_lab_minimum.py'], 3600),
    ('lab-visit', [PY, 'tests/e2e/test_lab_visit.py'], 3600),
    ('learn', [PY, 'tests/e2e/run_learn.py'], 3600),
    ('session', [PY, 'tests/e2e/test_session_all.py'], 5400),
    ('lab-pause', [PY, 'tests/e2e/test_lab_player_pause.py'], 1800),
    ('texts', [PY, 'tests/e2e/test_texts_fixes.py'], 1800),
    ('texts-rename', [PY, 'tests/e2e/test_texts_rename.py'], 1800),
    ('coverage', [PY, 'tests/e2e/test_coverage_gaps.py'], 3600),
    ('journey', [PY, 'tests/e2e/test_journey.py'], 3600),
]
SIMS = [('sims', ['node', 'tests/sim/run.mjs', 'all'], 3600),
        ('derive-perf', ['node', 'tests/sim/derive-perf.mjs'], 600)]


def run(name, cmd, timeout):
    log = OUT / (name + '.log')
    t0 = time.time()
    with open(log, 'w') as fh:
        try:
            p = subprocess.run(cmd, cwd=str(REPO), stdout=fh, stderr=subprocess.STDOUT, timeout=timeout)
            code = p.returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
    secs = round(time.time() - t0, 1)
    tail = log.read_text(errors='replace').strip().splitlines()[-3:]
    return {'name': name, 'ok': code == 0, 'exit': code, 'seconds': secs, 'tail': tail}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    done = OUT / 'REGRESSION_DONE'
    if done.exists():
        done.unlink()
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    plan = [s for s in SUITES if not only or s[0] in only]
    if '--skip-sims' not in sys.argv:
        plan += [s for s in SIMS if not only or s[0] in only]
    results = []
    for name, cmd, timeout in plan:
        r = run(name, cmd, timeout)
        results.append(r)
        print('%-12s %s  (%ss)  %s' % (name, 'PASS' if r['ok'] else 'FAIL', r['seconds'], (r['tail'] or [''])[-1][:120]), flush=True)
        (OUT / 'summary.json').write_text(json.dumps({'ok': all(x['ok'] for x in results), 'results': results}, indent=2))
    summary = {'ok': all(x['ok'] for x in results), 'results': results, 'finishedAt': time.strftime('%Y-%m-%d %H:%M:%S')}
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
    done.write_text(summary['finishedAt'])
    print('ALL: %s (%d suites)' % ('PASS' if summary['ok'] else 'FAIL', len(results)))
    sys.exit(0 if summary['ok'] else 1)


if __name__ == '__main__':
    main()
