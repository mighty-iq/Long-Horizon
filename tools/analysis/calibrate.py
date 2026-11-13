#!/usr/bin/env python3
"""Build the Long-Horizon calibration file from pooled Baseline 1 and Baseline 2 data (PLAN §6, research/04 §14.2).

For every Lab test with at least --min-n people who have both baselines (default 50):
  r     test-retest correlation of B1 and B2 (Pearson)          -> noise band: SEM = sd * sqrt(1 - r)
  sd    SD of B2 scores (the individual's reference visit)
  mean  mean of B2 scores
  n     people with both baselines
plus mean1/sd1 (B1), gain (mean B2 - B1, the first retest gain) and, with --practice-arm, practiceN = people of that
no-training arm with B2 and Post, and practice = their mean B2 -> Post change, written only when practiceN >= 30
(HF.lab.compare uses it for the practice-adjusted RCI under the same rule; fewer people give too noisy an estimate).
Composites (near/mid/far, mean z against B2) get the same fields under "composites".

The output can be imported by the app as records.calibration = { updatedAt, version, source, tests }.
Tests below --min-n are left out (the app then keeps saying "not yet calibrated") unless --force, which keeps
them and marks the file and those tests provisional.

Usage: python calibrate.py INPUT... [--out calibration.json] [--min-n 50] [--force]
                           [--exclude-flags help-used,device-class,device-input] [--practice-arm search] [--version LABEL]
MIT licence.
"""
import argparse
import datetime as dt
import json
import math
import sys

import numpy as np

import analyze

DEFAULT_EXCLUDE = ('help-used', 'help', 'device-class', 'device-input')
PRACTICE_MIN_N = 30              # same rule in js/lab/compare.js (PRACTICE_MIN_N)


def _stats(b1, b2):
    n = len(b1)
    r = float(np.corrcoef(b1, b2)[0, 1]) if n >= 3 and np.std(b1) > 0 and np.std(b2) > 0 else float('nan')
    return {'r': round(r, 4), 'sd': round(float(np.std(b2, ddof=1)), 6), 'mean': round(float(np.mean(b2)), 6), 'n': int(n),
            'mean1': round(float(np.mean(b1)), 6), 'sd1': round(float(np.std(b1, ddof=1)), 6),
            'gain': round(float(np.mean(b2) - np.mean(b1)), 6)}


def calibrate(long, min_n=50, force=False, exclude_flags=DEFAULT_EXCLUDE, practice_arm=None, version=None, now=None):
    df = analyze.first_visits(long, exclude_flags)
    tests, composites, skipped = {}, {}, {}
    wide = df.pivot_table(index=['pid', 'test'], columns='kind', values='score', aggfunc='first').reset_index()
    arm_of = df.groupby('pid')['arm'].first().to_dict()
    for test, g in wide.groupby('test'):
        if 'B1' not in g.columns or 'B2' not in g.columns:
            continue
        both = g.dropna(subset=['B1', 'B2'])
        n = len(both)
        if n < 3:
            continue
        st = _stats(both['B1'].values.astype(float), both['B2'].values.astype(float))
        st['higherIsBetter'] = test not in analyze.LOWER_IS_BETTER
        if practice_arm:
            ref = g[g['pid'].map(arm_of) == practice_arm]
            ref = ref.dropna(subset=['B2', 'POST']) if 'POST' in ref.columns else ref.iloc[0:0]
            st['practiceN'] = int(len(ref))
            if len(ref) >= PRACTICE_MIN_N:
                st['practice'] = round(float((ref['POST'] - ref['B2']).mean()), 6)
        if n < min_n:
            if not force:
                skipped[test] = n
                continue
            st['provisional'] = True
        tests[test] = st
    # composites: z against B2 of each test, mean per level
    zdf, _ = analyze.standardize(df)
    comp = analyze.composite_table(zdf, analyze.LEVELS)
    if not comp.empty:
        cw = comp.pivot_table(index=['pid', 'outcome'], columns='kind', values='value', aggfunc='first').reset_index()
        for lvl, g in cw.groupby('outcome'):
            if 'B1' in g.columns and 'B2' in g.columns:
                both = g.dropna(subset=['B1', 'B2'])
                if len(both) >= (3 if force else min_n):
                    composites[lvl] = _stats(both['B1'].values.astype(float), both['B2'].values.astype(float))
    n_people = int(df[df['kind'].isin(['B1', 'B2'])].groupby('pid')['kind'].nunique().eq(2).sum())
    now = now or dt.datetime.now(dt.timezone.utc)
    provisional = any(t.get('provisional') for t in tests.values())
    return {
        'updatedAt': int(now.timestamp() * 1000),
        'version': version or ('community-' + now.date().isoformat()),
        'source': 'tools/analysis/calibrate.py %s: %d participants with Baseline 1 and 2; r = B1-B2 Pearson, sd/mean = B2%s'
                  % (analyze.VERSION, n_people, ' (PROVISIONAL: some tests below n = %d)' % min_n if provisional else ''),
        'tests': tests,
        'composites': composites,
        'meta': {'minN': min_n, 'provisional': provisional, 'excludedFlags': list(exclude_flags), 'skipped': skipped,
                 'practiceArm': practice_arm, 'practiceMinN': PRACTICE_MIN_N, 'participants': n_people},
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description='Build the Long-Horizon calibration JSON from pooled B1 + B2 data.')
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out', default='calibration.json')
    ap.add_argument('--min-n', type=int, default=50)
    ap.add_argument('--force', action='store_true', help='keep tests below --min-n, marked provisional')
    ap.add_argument('--exclude-flags', default=','.join(DEFAULT_EXCLUDE))
    ap.add_argument('--practice-arm', default=None, help='no-training arm for the practice (retest) estimate, e.g. search')
    ap.add_argument('--version', default=None)
    a = ap.parse_args(argv)
    long = analyze.load_inputs(a.inputs)
    cal = calibrate(long, a.min_n, a.force, [f for f in a.exclude_flags.split(',') if f], a.practice_arm, a.version)
    if not cal['tests']:
        print('No test has %d people with both baselines yet (%s). Nothing written; use --force for a provisional file.'
              % (a.min_n, ', '.join('%s n=%d' % kv for kv in sorted(cal['meta']['skipped'].items())) or 'no data'))
        return 2
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(cal, fh, indent=1)
    for t, s in sorted(cal['tests'].items()):
        band = 1.96 * math.sqrt(2 * (1 - s['r'])) if s['r'] == s['r'] and s['r'] < 1 else float('nan')
        print('%-11s n=%4d  r=%.2f  sd=%.4g  mean=%.4g  gain=%+.3g  95%% change band = %.2f SD%s'
              % (t, s['n'], s['r'], s['sd'], s['mean'], s['gain'], band, '  PROVISIONAL' if s.get('provisional') else ''))
    if cal['meta']['skipped']:
        print('left out (n < %d): %s' % (a.min_n, cal['meta']['skipped']))
    print('wrote %s' % a.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
