#!/usr/bin/env python3
"""Tests for the Long-Horizon study analysis on synthetic data with known effects.
Run: python -m unittest test_analysis -v   (or: python -m pytest test_analysis.py). MIT licence."""
import contextlib
import io
import json
import math
import os
import shutil
import tempfile
import unittest

import numpy as np
import pandas as pd

import analyze
import calibrate
import synth

try:
    import pingouin
except ImportError:          # optional: only the cross-checks need it
    pingouin = None


def run(n_per_arm, effects, seed, **kw):
    ex = synth.make_dataset(n_per_arm=n_per_arm, effects=effects, seed=seed)
    long = synth.to_long(ex)
    return ex, long, analyze.run_analysis(long, **kw)


def row(res, family, outcome):
    return next(r for r in res[family] if r['outcome'] == outcome)


class TestFormats(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='hf-analysis-')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_synthetic_export_matches_the_app_export(self):
        ex = synth.make_dataset(n_per_arm=2, seed=5)
        e = ex[0]
        self.assertEqual(e['meta']['kind'], 'long-horizon-study-export')
        self.assertEqual(e['meta']['exportSchema'], 1)
        for key in ('meta', 'study', 'visits', 'labTrials', 'scores', 'training', 'questionnaires', 'notes'):
            self.assertIn(key, e)
        v = e['visits'][0]
        for key in ('id', 'kind', 'config', 'form', 'startedAt', 'device', 'flags', 'tests'):
            self.assertIn(key, v)
        t = v['tests']['lab.matrix']
        self.assertEqual(sorted(t), sorted(['score', 'scoreLabel', 'sub', 'flags', 'form', 'seed', 'version']))

    def test_json_and_pooled_csv_give_the_same_results(self):
        ex = synth.make_dataset(n_per_arm=40, seed=11)
        synth.write_exports(ex, self.dir)
        csv = os.path.join(self.dir, 'pooled.csv')
        synth.to_long(ex).to_csv(csv, index=False)
        a = analyze.run_analysis(analyze.load_inputs([self.dir + '/']).query('test == test'))
        b = analyze.run_analysis(analyze.load_inputs([csv]))
        # the directory also contains the CSV: rows are duplicated, and first_visits removes the duplicates
        for fam in ('primary', 'secondary'):
            for ra, rb in zip(a[fam], b[fam]):
                self.assertAlmostEqual(ra['estimate'], rb['estimate'], places=10)
                self.assertAlmostEqual(ra['p'], rb['p'], places=10)

    def test_exports_made_by_1_0_0_are_read(self):
        """1.0.0 (working name Holdfast) wrote meta.kind 'holdfast-study-export': same layout, same results."""
        self.assertEqual(analyze.EXPORT_KINDS, ('long-horizon-study-export', 'holdfast-study-export'))
        ex = synth.make_dataset(n_per_arm=12, seed=7)
        new_dir, old_dir = os.path.join(self.dir, 'new'), os.path.join(self.dir, 'old')
        synth.write_exports(ex, new_dir)
        for e in ex:
            e['meta']['kind'] = 'holdfast-study-export'
        synth.write_exports(ex, old_dir)
        a = analyze.load_inputs([new_dir + '/'])
        b = analyze.load_inputs([old_dir + '/'])
        self.assertEqual(len(a), len(b))
        self.assertGreater(len(b), 0)
        cols = ['pid', 'arm', 'kind', 'test', 'score']
        pd.testing.assert_frame_equal(a[cols].sort_values(cols).reset_index(drop=True), b[cols].sort_values(cols).reset_index(drop=True))

    def test_raw_app_backup_is_read(self):
        rec = {'schema': 1, 'profile': {'anonId': 'raw1'},
               'events': [{'id': 'e1', 't': 1, 'type': 'study-draw', 'arm': 'varied', 'template': 'default'}],
               'labVisits': [{'id': 'v1', 'kind': 'B1', 'form': 'A', 'startedAt': 1762400000000, 'device': {'class': 'desktop'},
                              'flags': [], 'tests': {'lab.matrix': {'score': 0.5, 'flags': []}}},
                             {'id': 'v2', 'kind': 'B2', 'form': 'B', 'startedAt': 1762800000000, 'device': {'class': 'desktop'},
                              'flags': ['help-used'], 'tests': {'lab.matrix': {'score': 0.6, 'flags': []}}}]}
        path = os.path.join(self.dir, 'backup.json')
        with open(path, 'w') as fh:
            json.dump(rec, fh)
        long = analyze.load_inputs([path])
        self.assertEqual(list(long['pid'].unique()), ['raw1'])
        self.assertEqual(list(long['arm'].unique()), ['varied'])
        self.assertEqual(sorted(long['kind']), ['B1', 'B2'])
        self.assertEqual(len(analyze.first_visits(long, ['help-used'])), 1, 'flagged visit excluded on request')

    def test_csv_needs_the_documented_columns(self):
        bad = os.path.join(self.dir, 'bad.csv')
        pd.DataFrame({'pid': ['a'], 'score': [1]}).to_csv(bad, index=False)
        with self.assertRaises(ValueError):
            analyze.load_inputs([bad])


class TestStatistics(unittest.TestCase):
    def test_holm(self):
        np.testing.assert_allclose(analyze.holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])
        np.testing.assert_allclose(analyze.holm([0.5, 0.001]), [0.5, 0.002])
        self.assertTrue(np.isnan(analyze.holm([np.nan, 0.01])[0]))

    def test_tost_against_definition_and_pingouin(self):
        rng = np.random.default_rng(1)
        x, y = rng.normal(0.05, 1, 200), rng.normal(0, 1, 220)
        nx, ny = len(x), len(y)
        sp = math.sqrt(((nx - 1) * x.var(ddof=1) + (ny - 1) * y.var(ddof=1)) / (nx + ny - 2))
        se = sp * math.sqrt(1 / nx + 1 / ny)
        r = analyze.tost(x.mean() - y.mean(), se, nx + ny - 2, 0.3)
        self.assertTrue(r['equivalent'])
        self.assertLessEqual(r['ci90'][0], x.mean() - y.mean())
        if pingouin is not None:
            pg = pingouin.tost(x, y, bound=0.3)
            self.assertAlmostEqual(r['p'], float(pg['pval'].iloc[0]), places=8)

    def test_jzs_bayes_factor_against_pingouin(self):
        cases = [(0.5, 30, 30), (2.1, 25, 31), (-3.5, 60, 55), (4.8, 120, 118), (0.0, 200, 200)]
        for t, n1, n2 in cases:
            mine = analyze.jzs_bf10(t, n1, n2)
            if pingouin is not None:
                ref = float(pingouin.bayesfactor_ttest(t, n1, n2, r=0.707))
                self.assertAlmostEqual(mine / ref, 1.0, delta=0.01, msg=str((t, n1, n2, mine, ref)))
        self.assertLess(analyze.jzs_bf10(0.0, 200, 200), 1 / 3)
        self.assertGreater(analyze.jzs_bf10(5.0, 100, 100), 100)

    def test_regression_bayes_factor_behaves(self):
        lo = math.exp(analyze.zs_regression_bf(200, 1, 0.001))
        hi = math.exp(analyze.zs_regression_bf(200, 1, 0.2))
        self.assertLess(lo, 1 / 3)
        self.assertGreater(hi, 1e6)

    def test_morris_dppc2(self):
        d = pd.DataFrame({'arm': ['t'] * 3 + ['c'] * 3, 'baseline': [0, 1, 2, 0, 1, 2], 'post': [1, 2, 3, 0, 1, 2]})
        cp = 1 - 3 / (4 * 4 - 1)
        self.assertAlmostEqual(analyze.morris_dppc2(d, 'arm', 't', 'c'), cp * 1.0 / 1.0)


class TestKnownEffects(unittest.TestCase):
    def test_detects_a_known_far_effect(self):
        _, _, res = run(150, {'near': 0.6, 'mid': 0.3, 'far': 0.6}, seed=21)
        far = row(res, 'primary', 'far')
        self.assertEqual(res['control'], 'search')
        self.assertLess(far['p'], 0.001)
        self.assertLess(far['p_holm'], 0.01)
        self.assertAlmostEqual(far['estimate'], 0.6, delta=0.15)      # z units of each test's B2 SD
        self.assertGreater(far['bf10'], 100)
        self.assertFalse(far['tost']['equivalent'])
        near = row(res, 'primary', 'near')
        self.assertAlmostEqual(near['estimate'], 0.6, delta=0.15)
        fu = row(res, 'followup', 'far')
        self.assertAlmostEqual(fu['estimate'], 0.3, delta=0.15, msg='half the effect remains at FU')

    def test_null_far_effect_is_declared_equivalent(self):
        # a single null sample can give |t| near 2 (BF10 ~ 0.4 even at n = 1,200 per arm), so judge five samples
        fars, nears = [], []
        for seed in (33, 34, 35, 36, 37):
            _, _, res = run(300, {'near': 0.6, 'mid': 0.0, 'far': 0.0}, seed=seed)
            fars.append(row(res, 'primary', 'far'))
            nears.append(row(res, 'primary', 'near'))
        self.assertTrue(all(f['tost']['equivalent'] for f in fars), 'TOST at d = 0.3 in every sample')
        self.assertLess(float(np.median([f['bf10'] for f in fars])), 1 / 3)
        self.assertLess(float(np.median([f['bf10_regression'] for f in fars])), 1 / 3)
        self.assertLess(abs(float(np.mean([f['estimate'] for f in fars]))), 0.05)
        self.assertGreaterEqual(sum(f['p'] > 0.05 for f in fars), 4)
        self.assertTrue(all(n['p_holm'] < 1e-6 for n in nears), 'the real near effect is found alongside')

    def test_type_one_error_is_controlled(self):
        hits = 0
        for seed in range(40):
            _, _, res = run(40, {'near': 0.0, 'mid': 0.0, 'far': 0.0}, seed=1000 + seed)
            hits += any(r['p_holm'] < 0.05 for r in res['primary'])
        self.assertLessEqual(hits, 6, 'family-wise false positives in 40 null studies: %d' % hits)

    def test_switch_is_exploratory_and_lower_is_better(self):
        _, long, res = run(150, {'near': 0.0, 'mid': 0.8, 'far': 0.0}, seed=44)
        sw = row(res, 'exploratory', 'lab.switch')
        self.assertLess(sw['estimate'], 0, 'training lowers the switch cost (ms)')
        self.assertNotIn('lab.switch', [r['outcome'] for r in res['secondary']])
        res2 = analyze.run_analysis(long, switch_in_mid=True)
        self.assertIn('lab.switch', res2['levels']['mid'])
        z = analyze.standardize(analyze.first_visits(long))[0]
        post = z[(z['test'] == 'lab.switch') & (z['kind'] == 'POST')]
        self.assertGreater(post.groupby('arm')['z'].mean()['varied'], post.groupby('arm')['z'].mean()['search'],
                           'sign flipped: +z = better')

    def test_exclusions_are_a_sensitivity_analysis(self):
        _, long, res = run(60, {'near': 0.5, 'mid': 0.0, 'far': 0.0}, seed=55)
        res_x = analyze.run_analysis(long, exclude_flags=['help-used'])
        n = sum(row(res, 'primary', 'near')['n'].values())
        n_x = sum(row(res_x, 'primary', 'near')['n'].values())
        self.assertLessEqual(n_x, n)
        self.assertEqual(res_x['exclude_flags'], ['help-used'])


class TestCalibration(unittest.TestCase):
    def test_recovers_reliability_and_spread(self):
        ex = synth.make_dataset(n_per_arm=600, seed=66, effects={'near': 0, 'mid': 0, 'far': 0})
        cal = calibrate.calibrate(synth.to_long(ex), min_n=50)
        for test, (lvl, mean, sd, r, hib, unit) in synth.TESTS.items():
            got = cal['tests'][test]
            self.assertAlmostEqual(got['r'], r, delta=0.06, msg=test)
            self.assertAlmostEqual(got['sd'] / sd, 1.0, delta=0.08, msg=test)
            exp_gain = 0.28 * sd * (1 if hib else -1)
            self.assertAlmostEqual(got['gain'], exp_gain, delta=0.25 * sd, msg=test)
            self.assertGreaterEqual(got['n'], 1000)
            self.assertEqual(got['higherIsBetter'], hib)
        self.assertEqual(sorted(cal), ['composites', 'meta', 'source', 'tests', 'updatedAt', 'version'])
        self.assertIn('far', cal['composites'])
        self.assertGreater(cal['composites']['far']['r'], cal['tests']['lab.graph']['r'], 'composites are more reliable')

    def test_minimum_n_and_provisional_files(self):
        long = synth.to_long(synth.make_dataset(n_per_arm=10, seed=77))
        self.assertEqual(calibrate.calibrate(long, min_n=50)['tests'], {})
        cal = calibrate.calibrate(long, min_n=50, force=True)
        self.assertTrue(cal['meta']['provisional'])
        self.assertTrue(all(t.get('provisional') for t in cal['tests'].values()))

    def test_practice_estimate_from_a_no_training_arm(self):
        long = synth.to_long(synth.make_dataset(n_per_arm=400, seed=88, effects={'near': 0.6, 'mid': 0, 'far': 0}))
        cal = calibrate.calibrate(long, practice_arm='search')
        sd = synth.TESTS['lab.matrix'][2]
        self.assertAlmostEqual(cal['tests']['lab.matrix']['practice'], (0.45 - 0.28) * sd, delta=0.06 * sd)

    def test_calibration_file_feeds_the_analysis(self):
        long = synth.to_long(synth.make_dataset(n_per_arm=80, seed=99))
        cal = calibrate.calibrate(long, min_n=50)
        res = analyze.run_analysis(long, calibration=cal)
        self.assertEqual(res['reference']['lab.matrix']['source'], 'calibration')


class TestCommandLine(unittest.TestCase):
    def test_cli_round_trip(self):
        d = tempfile.mkdtemp(prefix='hf-cli-')
        try:
            quiet = contextlib.redirect_stdout(io.StringIO())
            quiet.__enter__()
            self.assertEqual(synth.main(['--out', d, '--n-per-arm', '60', '--seed', '3']), 0)
            out = os.path.join(d, 'res.json')
            self.assertEqual(analyze.main([d, '--json', out]), 0)
            with open(out) as fh:
                res = json.load(fh)
            self.assertEqual([r['outcome'] for r in res['primary']], ['far', 'mid', 'near'])
            calp = os.path.join(d, 'cal.json')
            self.assertEqual(calibrate.main([d, '--out', calp]), 0)
            self.assertEqual(calibrate.main([d, '--out', calp, '--min-n', '1000']), 2)
        finally:
            quiet.__exit__(None, None, None)
            shutil.rmtree(d, ignore_errors=True)


def cao_data(n=80, seed=7, arms=('cao-exec', 'cao-trad', 'cao-search')):
    eff = {'cao-exec': {'lab.sspan': 0.8, 'near': 0.5}, 'cao-trad': {'near': 0.5}}
    return synth.make_dataset(n_per_arm=n, arms=arms, effects=eff, seed=seed)


class TestTemplates(unittest.TestCase):
    """SC-06: one template at a time; Cao's key contrast is executive vs traditional."""

    def test_mixed_templates_are_refused(self):
        a = synth.to_long(synth.make_dataset(n_per_arm=20, seed=1))
        b = synth.to_long(cao_data(n=20, seed=2))
        b['pid'] = 'cao-' + b['pid']
        pooled = pd.concat([a, b], ignore_index=True)
        with self.assertRaises(ValueError) as cm:
            analyze.run_analysis(pooled)
        self.assertIn('several study templates', str(cm.exception))
        res = analyze.run_analysis(pooled, template='cao')
        self.assertEqual(res['template'], 'cao')
        self.assertEqual(res['ignored_templates'], {'default': 40})
        self.assertEqual(res['arms'], ['cao-exec', 'cao-search', 'cao-trad'])
        with self.assertRaises(ValueError):
            analyze.run_analysis(pooled, template='wang')
        d = tempfile.mkdtemp(prefix='hf-mix-')
        try:
            pooled.to_csv(os.path.join(d, 'pooled.csv'), index=False)
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(analyze.main([d]), 2)
            self.assertIn('--template', err.getvalue())
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_template_is_inferred_from_arm_ids(self):
        long = synth.to_long(cao_data(n=20)).drop(columns=['template'])
        self.assertEqual(analyze.run_analysis(long)['template'], 'cao')
        clash = synth.to_long(synth.make_dataset(n_per_arm=10, seed=3))
        clash.loc[clash['arm'] == 'varied', 'template'] = 'cao'
        with self.assertRaises(ValueError):
            analyze.run_analysis(clash)

    def test_unknown_arms_need_an_explicit_control(self):
        long = synth.to_long(synth.make_dataset(n_per_arm=30, seed=4))
        long['arm'] = long['arm'].map({'varied': 'arm-x', 'search': 'arm-y'})
        long['template'] = None
        with self.assertRaises(ValueError):
            analyze.run_analysis(long)
        res = analyze.run_analysis(long, control='arm-y')
        self.assertEqual([(c['arm'], c['control']) for c in res['contrasts']], [('arm-x', 'arm-y')])

    def test_cao_contrasts_and_known_effect(self):
        res = analyze.run_analysis(synth.to_long(cao_data()))
        self.assertEqual([(c['arm'], c['control'], c['role']) for c in res['contrasts']],
                         [('cao-exec', 'cao-trad', 'primary'), ('cao-exec', 'cao-search', 'second control'),
                          ('cao-trad', 'cao-search', 'second control')])
        p = res['primary']
        self.assertEqual([(r['outcome'], r['arm'], r['control']) for r in p], [('lab.sspan', 'cao-exec', 'cao-trad')])
        self.assertAlmostEqual(p[0]['estimate'], 0.8, delta=0.25)
        self.assertLess(p[0]['p'], 0.001)
        sc = {(r['arm'], r['control']): r for r in res['second_control']}
        self.assertLess(sc[('cao-exec', 'cao-search')]['p'], 0.001)
        self.assertAlmostEqual(sc[('cao-trad', 'cao-search')]['estimate'], 0.0, delta=0.25)

    def test_cao_without_its_optional_search_arm(self):
        res = analyze.run_analysis(synth.to_long(cao_data(n=40, arms=('cao-exec', 'cao-trad'))))
        self.assertEqual(len(res['primary']), 1)
        self.assertEqual(res['second_control'], [])
        self.assertEqual(res['control'], 'cao-trad')


class TestOutcomeSets(unittest.TestCase):
    """SC-07: outcome sets per template; near composites only from paradigms the treated arm trained."""

    def test_default_template_keeps_far_mid_near(self):
        _, _, res = run(60, {'near': 0.5, 'mid': 0.0, 'far': 0.0}, seed=8)
        self.assertEqual(res['template'], 'default')
        self.assertEqual([r['outcome'] for r in res['primary']], ['far', 'mid', 'near'])
        self.assertEqual(res['levels']['near'], ['lab.nback', 'lab.rel'])
        self.assertEqual(res['levels']['mid'], ['lab.sspan', 'lab.update', 'lab.bind'])
        self.assertEqual([r['outcome'] for r in res['exploratory']], ['lab.switch'])

    def test_cao_outcomes(self):
        res = analyze.run_analysis(synth.to_long(cao_data(n=50)))
        self.assertEqual([r['outcome'] for r in res['primary']], ['lab.sspan'])
        self.assertEqual([r['outcome'] for r in res['secondary']], ['lab.switch'])
        self.assertEqual(res['secondary'][0]['unit'], 'ms')
        near = next(r for r in res['exploratory'] if r['outcome'] == 'near')
        self.assertEqual(near['tests'], ['lab.nback'], 'Cao arms trained n-back only: no relation probe in near')
        self.assertEqual(res['levels_by_arm']['cao-exec']['near'], ['lab.nback'])
        self.assertIn('lab.rel', res['levels_by_arm']['cao-exec']['mid'])

    def test_wang_outcomes(self):
        ex = synth.make_dataset(n_per_arm=50, arms=('wang-steps', 'wang-search'), effects={'wang-steps': {'lab.matrix': 0.6}}, seed=9)
        res = analyze.run_analysis(synth.to_long(ex))
        self.assertEqual(res['template'], 'wang')
        self.assertEqual([(r['outcome'], r['arm'], r['control']) for r in res['primary']], [('lab.matrix', 'wang-steps', 'wang-search')])
        self.assertLess(res['primary'][0]['p'], 0.01)
        self.assertEqual(res['levels_by_arm']['wang-steps']['near'], [], 'Equal Steps has no near probe')
        self.assertNotIn('near', [r['outcome'] for fam in ('primary', 'secondary', 'exploratory') for r in res[fam]])
        mid = next(r for r in res['exploratory'] if r['outcome'] == 'mid')
        self.assertIn('lab.nback', mid['tests'])
        self.assertEqual(res['followup'][0]['outcome'], 'lab.matrix')

    def test_holm_spans_the_whole_family(self):
        res = analyze.run_analysis(synth.to_long(cao_data(n=40)))
        rows = res['second_control']
        self.assertEqual(len(rows), 2)
        np.testing.assert_allclose([r['p_holm'] for r in rows], analyze.holm([r['p'] for r in rows]))
        self.assertTrue(all('Holm across all 2 rows' in r['family'] for r in rows))


class TestFingerprint(unittest.TestCase):
    """SC-14: the report carries SHA-256 fingerprints of analyze.py and the options; --plan prints them up front."""

    def test_report_prints_the_code_and_options_hashes(self):
        import hashlib
        _, _, res = run(30, {'near': 0, 'mid': 0, 'far': 0}, seed=10)
        with open(analyze.__file__, 'rb') as fh:
            code = hashlib.sha256(fh.read()).hexdigest()
        self.assertEqual(res['fingerprint']['analyze_py_sha256'], code)
        text = analyze.format_report(res)
        self.assertIn('analyze.py sha256 ' + code, text)
        self.assertIn('Available-case', text)
        long = synth.to_long(synth.make_dataset(n_per_arm=30, seed=10))
        other = analyze.run_analysis(long, sesoi=0.2)
        self.assertNotEqual(other['fingerprint']['options_sha256'], res['fingerprint']['options_sha256'])
        self.assertEqual(other['fingerprint']['analyze_py_sha256'], code)

    def test_plan_mode_needs_no_data(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(analyze.main(['--plan', '--template', 'cao']), 0)
        text = out.getvalue()
        self.assertIn('lab.sspan at POST; contrasts: cao-exec vs cao-trad', text)
        self.assertIn('before the first draw', text)
        self.assertRegex(text, r'analyze\.py sha256 [0-9a-f]{64}')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            analyze.main(['--plan'])


class TestPracticeGate(unittest.TestCase):
    """SC-08: the practice (retest-gain) estimate is written only from >= 30 people who did not train."""

    def test_practice_needs_30_people(self):
        small = synth.to_long(synth.make_dataset(n_per_arm=60, arms=('varied', 'search', 'labonly'), seed=12, dropout=0, fu_missing=0))
        keep = small[(small['arm'] != 'labonly') | small['pid'].isin(sorted(small.loc[small['arm'] == 'labonly', 'pid'].unique())[:20])]
        cal = calibrate.calibrate(keep, min_n=50, practice_arm='labonly')
        t = cal['tests']['lab.matrix']
        self.assertLess(t['practiceN'], calibrate.PRACTICE_MIN_N)
        self.assertNotIn('practice', t)
        cal2 = calibrate.calibrate(small, min_n=50, practice_arm='labonly')
        self.assertGreaterEqual(cal2['tests']['lab.matrix']['practiceN'], 30)
        self.assertIn('practice', cal2['tests']['lab.matrix'])
        self.assertEqual(cal2['meta']['practiceMinN'], 30)


if __name__ == '__main__':
    unittest.main(verbosity=2)
