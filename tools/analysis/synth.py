#!/usr/bin/env python3
"""Synthetic Long-Horizon study exports with KNOWN effects, for testing analyze.py and calibrate.py.

Writes one JSON file per participant in the format of js/lab/export.js (kind 'long-horizon-study-export'),
plus an optional pooled long CSV (one row per participant x visit x test).

Model (all in units of each test's between-person SD):
  latent abilities per level (near, mid, far) ~ MVN(0, rho_levels), rho = 0.5 off-diagonal
  true score of a test   T = 0.75 * ability[level] + sqrt(1 - 0.75^2) * specific
  observed at a visit    z = sqrt(r) * T + sqrt(1 - r) * noise + practice[visit] + effect
  score                  mean + sd * z      (lower-is-better tests: mean - sd * z, so "better" is always +z)
  so the B1-B2 correlation of a test is r (its retest reliability) and its SD is sd.
  practice: B1 0, B2 .28, Q .40, POST .45, FU .50 (Scharfen et al. 2018 orders of magnitude).
  effect: the arm's effect for the test (or its level) at POST; half of it at FU; 0 before training.

Usage:
  python synth.py --out DIR [--n-per-arm 60] [--arms varied,search] [--treated varied]
                  [--effect near=0.6,mid=0.2,far=0.0] [--seed 1] [--csv pooled.csv] [--dropout 0.05]
MIT licence.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys

import numpy as np
import pandas as pd

# id: (level, mean, sd, retest r, higher is better, kind of score)
TESTS = {
    'lab.nback':  ('near', 2.00, 0.80, 0.70, True, 'dprime'),
    'lab.rel':    ('near', 0.55, 0.15, 0.70, True, 'hit-fa'),
    'lab.sspan':  ('mid', 0.62, 0.12, 0.75, True, 'proportion'),
    'lab.update': ('mid', 0.70, 0.11, 0.70, True, 'proportion'),
    'lab.matrix': ('far', 0.55, 0.15, 0.78, True, 'proportion'),
    'lab.series': ('far', 0.60, 0.15, 0.73, True, 'proportion'),
    'lab.graph':  ('far', 0.58, 0.15, 0.69, True, 'proportion'),
    'lab.switch': ('mid', 180.0, 70.0, 0.45, False, 'ms'),
}
PRACTICE = {'B1': 0.0, 'B2': 0.28, 'Q': 0.40, 'POST': 0.45, 'FU': 0.50}
VISIT_DAY = {'B1': 0, 'B2': 4, 'Q': 22, 'POST': 40, 'FU': 110}
QUICK = ['lab.nback', 'lab.rel']
TEMPLATE_OF = {'varied': 'default', 'search': 'default', 'labonly': 'default',
               'cao-exec': 'cao', 'cao-trad': 'cao', 'cao-search': 'cao', 'wang-steps': 'wang', 'wang-search': 'wang'}
LABELS = 'ABC'
LATIN = [['A', 'B', 'D', 'C'], ['B', 'C', 'A', 'D'], ['C', 'D', 'B', 'A'], ['D', 'A', 'C', 'B']]


def parse_effects(text):
    out = {'near': 0.0, 'mid': 0.0, 'far': 0.0}
    for part in (text or '').split(','):
        if part.strip():
            k, v = part.split('=')
            out[k.strip()] = float(v)
    return out


def make_dataset(n_per_arm=60, arms=('varied', 'search'), treated=('varied',), effects=None, seed=1,
                 dropout=0.05, fu_missing=0.10, help_rate=0.03, tests=None):
    """Returns a list of export dicts (one per participant). effects: {'near','mid','far'} in SD units,
    or {arm: {...}} for arm-specific effects; inside an arm's dict a test id (e.g. 'lab.sspan') overrides its level."""
    rng = np.random.default_rng(seed)
    tests = tests or TESTS
    effects = effects if effects is not None else {'near': 0.6, 'mid': 0.2, 'far': 0.0}
    per_arm = effects if all(isinstance(v, dict) for v in effects.values()) else {a: effects for a in treated}
    cov = np.full((3, 3), 0.5) + np.eye(3) * 0.5
    start = dt.datetime(2026, 11, 1, 9, 0, tzinfo=dt.timezone.utc)
    out = []
    pid = 0
    for arm in arms:
        for _ in range(n_per_arm):
            pid += 1
            ability = dict(zip(['near', 'mid', 'far'], rng.multivariate_normal(np.zeros(3), cov)))
            true = {t: 0.75 * ability[spec[0]] + math.sqrt(1 - 0.75 ** 2) * rng.normal() for t, spec in tests.items()}
            device = 'phone' if rng.random() < 0.3 else 'desktop'
            kinds = ['B1', 'B2', 'Q', 'POST', 'FU']
            if rng.random() < dropout:
                kinds = ['B1', 'B2', 'Q'] if rng.random() < 0.5 else ['B1', 'B2']
            elif rng.random() < fu_missing:
                kinds = ['B1', 'B2', 'Q', 'POST']
            forms = LATIN[pid % 4]
            visits = []
            for kind in kinds:
                eff_lvl = per_arm.get(arm, {})
                when = start + dt.timedelta(days=VISIT_DAY[kind] + int(rng.integers(0, 3)), minutes=int(rng.integers(0, 120)))
                flags = []
                help_used = bool(rng.random() < help_rate)
                if help_used:
                    flags.append('help-used')
                tset = QUICK if kind == 'Q' else list(tests)
                vt = {}
                for t in tset:
                    level, mean, sd, r, hib, unit = tests[t]
                    full = eff_lvl.get(t, eff_lvl.get(level, 0.0))       # a test id overrides its level
                    eff = full if kind == 'POST' else (full / 2 if kind == 'FU' else 0.0)
                    z = math.sqrt(r) * true[t] + math.sqrt(1 - r) * rng.normal() + PRACTICE[kind] + eff
                    score = mean + sd * z if hib else mean - sd * z
                    if unit == 'proportion' or unit == 'hit-fa':
                        score = min(1.0, max(0.0 if unit == 'proportion' else -1.0, score))
                    form = forms[['B1', 'B2', 'POST', 'FU'].index(kind)] if kind in ('B1', 'B2', 'POST', 'FU') else 'A'
                    vt[t] = {'score': round(float(score), 4), 'scoreLabel': None, 'sub': {}, 'flags': ['exploratory'] if t == 'lab.switch' else [],
                             'form': form, 'seed': 'holdfast/lab/v1/%s/%s' % (t, form), 'version': 1}   # the app's form seeds (js/lab/index.js)
                visits.append({
                    'id': 'p%04d-%s' % (pid, kind), 'kind': kind, 'config': 'quick' if kind == 'Q' else 'standard',
                    'form': vt[tset[0]]['form'], 'startedAt': when.isoformat().replace('+00:00', 'Z'),
                    'endedAt': (when + dt.timedelta(minutes=55)).isoformat().replace('+00:00', 'Z'),
                    'date': when.date().isoformat(), 'localTime': when.strftime('%H:%M'), 'hour': when.hour,
                    'device': {'class': device, 'input': 'touch' if device == 'phone' else 'keyboard'},
                    'checkin': {'sleep': round(float(rng.normal(7, 1)), 1), 'alertness': int(rng.integers(2, 6))},
                    'closeout': {'help': help_used, 'effort': int(rng.integers(3, 6))},
                    'flags': flags, 'tests': vt})
            arm_label = 'Programme ' + LABELS[list(arms).index(arm) % 3]
            out.append({
                'meta': {'exportSchema': 1, 'kind': 'long-horizon-study-export', 'appVersion': 'synthetic', 'synthetic': True,
                         'exportedAt': start.isoformat().replace('+00:00', 'Z'), 'tzOffsetMin': 0, 'anonId': 'syn%05d' % pid,
                         'blueprint': 'v1', 'blueprints': {t: 1 for t in tests}},
                'study': {'template': TEMPLATE_OF.get(arm, 'default'), 'arm': arm, 'armLabel': arm_label, 'mode': 'community',
                          'method': 'code', 'commitment': None, 'salt': None, 'saltRevealed': False, 'verified': None},
                'visits': visits, 'labTrials': [], 'scores': {},
                'training': {'sessions': [], 'blocks': [], 'counted': int(rng.integers(15, 21)) if 'POST' in kinds else int(rng.integers(3, 12))},
                'questionnaires': {}, 'notes': []})
    return out


def to_long(exports):
    """Flat long table (pid, arm, kind, test, score, ...), the pooled-CSV input format of analyze.py."""
    rows = []
    for e in exports:
        for v in e['visits']:
            for t, r in v['tests'].items():
                rows.append({'pid': e['meta']['anonId'], 'arm': e['study']['arm'], 'template': e['study']['template'],
                             'kind': v['kind'], 'visit_id': v['id'], 'started_at': v['startedAt'], 'device_class': v['device']['class'],
                             'visit_flags': ';'.join(v['flags']), 'test': t, 'score': r['score'], 'test_flags': ';'.join(r['flags']),
                             'form': r['form']})
    return pd.DataFrame(rows)


def write_exports(exports, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for e in exports:
        name = 'long-horizon-study-%s.json' % e['meta']['anonId']
        with open(os.path.join(out_dir, name), 'w', encoding='utf-8') as fh:
            json.dump(e, fh, indent=1)
    return len(exports)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True, help='directory for the per-participant JSON exports')
    ap.add_argument('--n-per-arm', type=int, default=60)
    ap.add_argument('--arms', default='varied,search')
    ap.add_argument('--treated', default='varied', help='arms that receive the effect (comma-separated)')
    ap.add_argument('--effect', default='near=0.6,mid=0.2,far=0.0', help='SD units at Post, e.g. near=0.6,mid=0.2,far=0')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--dropout', type=float, default=0.05)
    ap.add_argument('--csv', default=None, help='also write a pooled long CSV here')
    a = ap.parse_args(argv)
    ex = make_dataset(a.n_per_arm, a.arms.split(','), a.treated.split(','), parse_effects(a.effect), a.seed, a.dropout)
    n = write_exports(ex, a.out)
    if a.csv:
        to_long(ex).to_csv(a.csv, index=False)
    print('wrote %d synthetic exports to %s%s' % (n, a.out, (' and ' + a.csv) if a.csv else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
