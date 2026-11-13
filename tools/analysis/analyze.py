#!/usr/bin/env python3
"""Long-Horizon study analysis: pooled exports of ONE study template -> its preregistrable analysis (research/04 §17.4).

  One template at a time: exports of several templates (separately randomised studies) are never pooled; --template
    picks one and is required when a folder holds several. Each template has its own contrasts and outcome plan
    (PLANS below): default = Varied vs visual search on the far, mid and near composites; cao = executive vs
    traditional n-back on complex span (switching secondary; visual search a second control); wang = Equal Steps vs
    visual search on matrices. Near composites use only the paradigms the treated arm trained.
  ANCOVA of Post on baseline (mean of Baseline 1 and 2) for each contrast (the two arms' participants), per outcome
  Holm correction across every row of a family (all its outcomes x contrasts)
  TOST equivalence tests against a smallest effect of interest (default d = 0.3, Lakens et al. 2018)
  Bayes factors: JZS (Cauchy prior r = sqrt(2)/2) on the ANCOVA t of the arm effect (Rouder et al. 2009), plus a
    Zellner-Siow regression Bayes factor of "arm + baseline" vs "baseline" (Liang et al. 2008) as a check
  Effect sizes: adjusted difference / pooled baseline SD, and Morris (2008) d_ppc2
  Available-case analysis: everyone with a baseline and the outcome visit (no imputation).
  Every report prints a SHA-256 fingerprint of this file and the options; post the plan (--plan) and its
  fingerprint before the first draw.

Input: app study exports (long-horizon-study-export JSON, js/lab/export.js; 1.0.0's 'holdfast-study-export', from the
working name Holdfast, is read too), raw app backups (records with labVisits),
or a pooled long CSV (pid, arm, kind, test, score, ...). Directories are searched for *.json and *.csv.
See README.md for the columns and the rules. Never split by training gain or correlate baseline with gain
(research/04 §14.4).

Usage: python analyze.py INPUT... [--template default|cao|wang] [--control ARM] [--sesoi 0.3] [--alpha 0.05]
                         [--visit POST] [--calibration calib.json] [--exclude-flags help-used,...] [--switch-in-mid]
                         [--json out.json]
       python analyze.py --plan --template cao [options]        print the plan and its fingerprint (no data needed)
MIT licence.
"""
import argparse
import glob
import hashlib
import json
import math
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats, integrate, optimize

VERSION = '1.1'
# Study export ids (js/lab/export.js): the current one first, then 1.0.0's from the working name Holdfast (same layout).
EXPORT_KINDS = ('long-horizon-study-export', 'holdfast-study-export')
LEVELS = {                                   # the app's default levels (Varied trains n-back and relations)
    'near': ['lab.nback', 'lab.rel'],
    'mid': ['lab.sspan', 'lab.update', 'lab.bind'],
    'far': ['lab.matrix', 'lab.series', 'lab.graph'],
}
EXPLORATORY = ['lab.switch']                 # switch costs are unreliable (Hedge et al. 2018): reported apart
LOWER_IS_BETTER = {'lab.switch'}
WM_TESTS = ['lab.nback', 'lab.rel', 'lab.sspan', 'lab.update', 'lab.bind']
FAR_TESTS = ['lab.matrix', 'lab.series', 'lab.graph']
# Study templates (js/lab/study.js; arm ids are unique across templates) and what each training arm practises.
ARM_TEMPLATE = {'varied': 'default', 'search': 'default', 'labonly': 'default',
                'cao-exec': 'cao', 'cao-trad': 'cao', 'cao-search': 'cao',
                'wang-steps': 'wang', 'wang-search': 'wang'}
TRAINS = {'varied': ['nback', 'relations'], 'cao-exec': ['nback'], 'cao-trad': ['nback'], 'wang-steps': ['steps'],
          'search': [], 'labonly': [], 'cao-search': [], 'wang-search': []}
NEAR_PROBE = {'nback': 'lab.nback', 'relations': 'lab.rel', 'span': 'lab.sspan'}   # Equal Steps has no near probe yet
# Outcome plan per template. Contrasts are (treated, control, role); 'primary' contrasts carry the confirmatory tests,
# 'second control' contrasts repeat the primary outcomes against another comparison arm.
PLANS = {
    'default': {'title': 'Long-Horizon (Varied) vs visual search',
                'contrasts': [('varied', 'search', 'primary'), ('varied', 'labonly', 'second control')],
                'primary': ['far', 'mid', 'near'], 'secondary': ['tests'], 'followup': ['far', 'mid', 'near'],
                'exploratory': ['lab.switch']},
    'cao': {'title': 'Cao et al. 2026 replication: executive vs traditional n-back (visual search = second control)',
            'contrasts': [('cao-exec', 'cao-trad', 'primary'), ('cao-exec', 'cao-search', 'second control'),
                          ('cao-trad', 'cao-search', 'second control')],
            'primary': ['lab.sspan'], 'secondary': ['lab.switch'], 'followup': ['lab.sspan'],
            'exploratory': ['near', 'far']},
    'wang': {'title': 'Wang et al. 2025 replication: Equal Steps vs visual search',
             'contrasts': [('wang-steps', 'wang-search', 'primary')],
             'primary': ['lab.matrix'], 'secondary': [], 'followup': ['lab.matrix'],
             'exploratory': ['lab.series', 'lab.graph', 'mid']},
}
COMPOSITES = ('near', 'mid', 'far')
KINDS = ['B1', 'B2', 'Q', 'POST', 'FU', 'X']
LONG_COLUMNS = ['pid', 'arm', 'template', 'kind', 'visit_id', 'started_at', 'device_class', 'visit_flags', 'test',
                'score', 'test_flags', 'form']


# --------------------------------------------------------------------------------------------- loading
def _flags(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ''
    if isinstance(x, (list, tuple)):
        return ';'.join(str(v) for v in x)
    return str(x)


def _rows_from_export(doc, source):
    """long-horizon-study-export (js/lab/export.js; EXPORT_KINDS)."""
    meta = doc.get('meta') or {}
    study = doc.get('study') or {}
    pid = meta.get('anonId') or os.path.basename(source)
    rows = []
    for v in doc.get('visits') or []:
        dev = v.get('device') or {}
        for test, r in (v.get('tests') or {}).items():
            r = r or {}
            rows.append({'pid': pid, 'arm': study.get('arm'), 'template': study.get('template'), 'kind': v.get('kind'),
                         'visit_id': v.get('id'), 'started_at': v.get('startedAt'), 'device_class': dev.get('class'),
                         'visit_flags': _flags(v.get('flags')), 'test': test, 'score': r.get('score'),
                         'test_flags': _flags(r.get('flags')), 'form': r.get('form') or v.get('form')})
    return rows


def _rows_from_records(doc, source):
    """Raw app backup (SPEC §3 records): profile.anonId, labVisits[], arm from study events or sessions."""
    rec = doc.get('records') if isinstance(doc.get('records'), dict) else doc
    pid = (rec.get('profile') or {}).get('anonId') or os.path.basename(source)
    arm, template = None, None
    for e in rec.get('events') or []:
        if e.get('type') in ('study-draw', 'study-code') and e.get('arm'):
            arm, template = e.get('arm'), e.get('template', template)
        if e.get('type') == 'study-enrol' and e.get('template'):
            template = e.get('template')
    if arm is None:
        for s in rec.get('sessions') or []:
            if s.get('study') and s['study'].get('arm'):
                arm, template = s['study']['arm'], s['study'].get('template', template)
    rows = []
    for v in rec.get('labVisits') or []:
        dev = v.get('device') or {}
        started = v.get('startedAt')
        if isinstance(started, (int, float)):
            started = pd.Timestamp(started, unit='ms', tz='UTC').isoformat()
        for test, r in (v.get('tests') or {}).items():
            r = r or {}
            rows.append({'pid': pid, 'arm': arm, 'template': template, 'kind': v.get('kind'), 'visit_id': v.get('id'),
                         'started_at': started, 'device_class': dev.get('class'), 'visit_flags': _flags(v.get('flags')),
                         'test': test, 'score': r.get('score'), 'test_flags': _flags(r.get('flags')), 'form': r.get('form') or v.get('form')})
    return rows


def _expand(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            out += sorted(glob.glob(os.path.join(p, '**', '*.json'), recursive=True))
            out += sorted(glob.glob(os.path.join(p, '**', '*.csv'), recursive=True))
        else:
            out.append(p)
    return out


def load_inputs(paths):
    """Returns the long table: one row per participant x visit x test (columns LONG_COLUMNS)."""
    rows, frames = [], []
    for path in _expand(paths):
        if path.lower().endswith('.csv'):
            df = pd.read_csv(path)
            if 'kind' not in df.columns and 'visit' in df.columns:
                df = df.rename(columns={'visit': 'kind'})
            missing = [c for c in ('pid', 'arm', 'kind', 'test', 'score') if c not in df.columns]
            if missing:
                raise ValueError('%s: missing columns %s (pooled CSV needs pid, arm, kind, test, score)' % (path, missing))
            frames.append(df)
            continue
        with open(path, encoding='utf-8') as fh:
            doc = json.load(fh)
        docs = doc if isinstance(doc, list) else [doc]
        for d in docs:
            if (d.get('meta') or {}).get('kind') in EXPORT_KINDS or 'visits' in d:
                rows += _rows_from_export(d, path)
            elif 'labVisits' in d or 'records' in d:
                rows += _rows_from_records(d, path)
    if rows:
        frames.append(pd.DataFrame(rows))
    if not frames:
        raise ValueError('no input rows found in %s' % (paths,))
    long = pd.concat(frames, ignore_index=True)
    for c in LONG_COLUMNS:
        if c not in long.columns:
            long[c] = None
    long['score'] = pd.to_numeric(long['score'], errors='coerce')
    long['pid'] = long['pid'].astype(str)
    long['arm'] = long['arm'].astype(object).where(long['arm'].notna(), None)
    for c in ('visit_flags', 'test_flags'):
        long[c] = long[c].fillna('').astype(str)
    return long[LONG_COLUMNS + [c for c in long.columns if c not in LONG_COLUMNS]]


def first_visits(long, exclude_flags=()):
    """Keeps the earliest visit of each kind per participant (repeats and 'X' visits dropped), drops missing scores
    and, if asked, visit-tests carrying any of exclude_flags (visit or test flags)."""
    df = long[long['kind'].isin(['B1', 'B2', 'Q', 'POST', 'FU'])].copy()
    df = df[df['score'].notna()]
    if exclude_flags:
        bad = set(exclude_flags)
        hit = df.apply(lambda r: bool(bad & set(filter(None, (r['visit_flags'] + ';' + r['test_flags']).split(';')))), axis=1)
        df = df[~hit]
    df['_t'] = pd.to_datetime(df['started_at'], errors='coerce', utc=True)
    df = df.sort_values(['pid', 'kind', '_t'])
    first_id = df.groupby(['pid', 'kind'])['visit_id'].transform('first')
    df = df[(df['visit_id'] == first_id) | df['visit_id'].isna()]
    return df.drop(columns=['_t']).drop_duplicates(['pid', 'kind', 'test'])


# --------------------------------------------------------------------------------------------- statistics
def holm(pvals):
    """Holm (1979) step-down adjusted p-values, in the input order (NaN stays NaN)."""
    p = np.asarray(pvals, dtype=float)
    out = np.full(p.shape, np.nan)
    idx = [i for i in np.argsort(p) if not np.isnan(p[i])]
    m, running = len(idx), 0.0
    for rank, i in enumerate(idx):
        running = max(running, min(1.0, (m - rank) * p[i]))
        out[i] = running
    return out


def tost(estimate, se, df, delta, alpha=0.05):
    """Two one-sided t tests of |effect| < delta for an estimate with standard error se and df degrees of freedom."""
    t_lo = (estimate + delta) / se
    t_hi = (estimate - delta) / se
    p_lo = stats.t.sf(t_lo, df)
    p_hi = stats.t.cdf(t_hi, df)
    q = stats.t.ppf(1 - alpha, df)
    return {'delta': delta, 'p_lower': float(p_lo), 'p_upper': float(p_hi), 'p': float(max(p_lo, p_hi)),
            'ci90': [float(estimate - q * se), float(estimate + q * se)], 'equivalent': bool(max(p_lo, p_hi) < alpha)}


def _log_integral(logf, lo=-40.0, hi=40.0):
    """log of the integral over g in (0, inf) of exp(logf(g)), computed on u = log g with a max shift."""
    def h(u):
        return logf(math.exp(u)) + u
    grid = np.linspace(lo, hi, 801)
    vals = np.array([h(u) for u in grid])
    k = int(np.nanargmax(vals))
    res = optimize.minimize_scalar(lambda u: -h(u), bounds=(grid[max(k - 1, 0)], grid[min(k + 1, len(grid) - 1)]), method='bounded')
    m = max(-res.fun, vals[k])
    val, _ = integrate.quad(lambda u: math.exp(h(u) - m), lo, hi, points=[res.x], limit=400)
    return m + math.log(val)


def jzs_bf10(t, n1, n2=None, r=math.sqrt(2) / 2, df=None):
    """JZS Bayes factor (Rouder et al. 2009) for a t statistic; Cauchy prior on delta with scale r.
    Two-sample: effective n = n1 n2 / (n1 + n2), df = n1 + n2 - 2 unless given (ANCOVA: n - 3)."""
    if n2 is None:
        N, nu = float(n1), float(df if df is not None else n1 - 1)
    else:
        N, nu = n1 * n2 / float(n1 + n2), float(df if df is not None else n1 + n2 - 2)
    t2 = float(t) ** 2

    def logf(g):
        a = 1.0 + N * g * r * r
        return (-0.5 * math.log(a) - (nu + 1) / 2 * math.log1p(t2 / (a * nu))
                - 0.5 * math.log(2 * math.pi) - 1.5 * math.log(g) - 1.0 / (2 * g))
    log_den = -(nu + 1) / 2 * math.log1p(t2 / nu)
    return math.exp(_log_integral(logf) - log_den)


def zs_regression_bf(n, p, r2, rscale=math.sqrt(2) / 4):
    """Zellner-Siow Bayes factor of a linear model with p predictors against the intercept-only model
    (Liang et al. 2008; the R^2 form used by BayesFactor's linearReg.R2stat). Returns log BF."""
    a, b = 0.5, n * rscale ** 2 / 2.0

    def logf(g):
        return ((n - 1 - p) / 2.0 * math.log1p(g) - (n - 1) / 2.0 * math.log1p(g * (1 - r2))
                + a * math.log(b) - math.lgamma(a) - (a + 1) * math.log(g) - b / g)
    return _log_integral(logf)


def pooled_sd(values, groups):
    num, den = 0.0, 0
    for g in pd.unique(groups):
        v = values[groups == g]
        if len(v) > 1:
            num += (len(v) - 1) * np.var(v, ddof=1)
            den += len(v) - 1
    return math.sqrt(num / den) if den else float('nan')


def ancova(data, arm_col, treat, control, y='post', x='baseline', sesoi=0.3, alpha=0.05):
    """ANCOVA for one contrast: OLS of post on baseline + a treated-arm dummy, fitted on the two arms' participants.
    Returns None when either arm has fewer than 2 people with both baseline and outcome."""
    import statsmodels.api as sm
    d = data[[arm_col, y, x]].dropna()
    d = d[d[arm_col].isin([treat, control])]
    n1, n0 = int((d[arm_col] == treat).sum()), int((d[arm_col] == control).sum())
    if n1 < 2 or n0 < 2:
        return None
    X = pd.DataFrame({'const': 1.0, 'baseline': d[x].astype(float), 'arm': (d[arm_col] == treat).astype(float)})
    fit = sm.OLS(d[y].astype(float), X).fit()
    sd_pre = pooled_sd(d[x].values, d[arm_col].values)
    b, se, tval, p = float(fit.params['arm']), float(fit.bse['arm']), float(fit.tvalues['arm']), float(fit.pvalues['arm'])
    ci = fit.conf_int(alpha)
    res = {
        'arm': treat, 'control': control, 'n': {treat: n1, control: n0}, 'estimate': b, 'se': se, 't': tval,
        'df': float(fit.df_resid), 'p': p, 'ci95': [float(ci.loc['arm', 0]), float(ci.loc['arm', 1])], 'sd_baseline': sd_pre,
        'd_adjusted': b / sd_pre if sd_pre > 0 else float('nan'),
        'd_ppc2': morris_dppc2(d, arm_col, treat, control, y, x),
        'means': {g: {'baseline': float(d.loc[d[arm_col] == g, x].mean()), 'post': float(d.loc[d[arm_col] == g, y].mean())} for g in (treat, control)},
        'tost': tost(b, se, fit.df_resid, sesoi * sd_pre, alpha) if sd_pre > 0 else None,
        'bf10': jzs_bf10(tval, n1, n0, df=fit.df_resid),
    }
    try:   # regression BF: (arm + baseline) vs (baseline)
        r2_full = fit.rsquared
        r2_base = sm.OLS(d[y].astype(float), X[['const', 'baseline']]).fit().rsquared
        res['bf10_regression'] = math.exp(zs_regression_bf(len(d), 2, r2_full) - zs_regression_bf(len(d), 1, r2_base))
    except (ValueError, OverflowError, ZeroDivisionError):
        res['bf10_regression'] = None
    return res


def morris_dppc2(d, arm_col, treat, control, y='post', x='baseline'):
    """Morris (2008) d_ppc2: (pre-post change difference) / pooled pre-test SD, with the small-sample correction."""
    t, c = d[d[arm_col] == treat], d[d[arm_col] == control]
    nt, nc = len(t), len(c)
    if nt < 2 or nc < 2:
        return float('nan')
    sd_pre = math.sqrt(((nt - 1) * t[x].var(ddof=1) + (nc - 1) * c[x].var(ddof=1)) / (nt + nc - 2))
    cp = 1 - 3.0 / (4 * (nt + nc - 2) - 1)
    return cp * ((t[y].mean() - t[x].mean()) - (c[y].mean() - c[x].mean())) / sd_pre


# --------------------------------------------------------------------------------------------- pipeline
def row_templates(df):
    """Template of every row: the export's study.template, else inferred from the arm id. A clash is a data error."""
    out, clash = [], set()
    tpls = df['template'] if 'template' in df.columns else [None] * len(df)
    for tpl, arm in zip(tpls, df['arm']):
        t = tpl if isinstance(tpl, str) and tpl else None
        inferred = ARM_TEMPLATE.get(arm)
        if t and inferred and t != inferred:
            clash.add('%s in %s' % (arm, t))
        out.append(t or inferred or 'custom')
    if clash:
        raise ValueError('arm and template disagree in the data: %s' % ', '.join(sorted(clash)))
    return out


def select_template(df, template=None):
    """Keeps the participants of one template. Several templates and no choice -> ValueError: separately randomised
    studies are never pooled. Returns (rows, template, {other template: participants left out})."""
    df = df.copy()
    df['template'] = row_templates(df) if len(df) else []
    counts = {k: int(v) for k, v in df.groupby('template')['pid'].nunique().items()}
    listing = ', '.join('%s (%d people)' % kv for kv in sorted(counts.items()))
    if template:
        if template not in counts:
            raise ValueError('no participants of template %r in the data (found: %s)' % (template, listing or 'none'))
        return df[df['template'] == template], template, {k: v for k, v in counts.items() if k != template}
    if len(counts) > 1:
        raise ValueError('the data hold several study templates: %s. They were randomised separately and must not be '
                         'pooled: run once per template with --template %s.' % (listing, '|'.join(sorted(counts))))
    return df, (next(iter(counts)) if counts else 'custom'), {}


def template_arms(template):
    out = []
    for c in PLANS[template]['contrasts']:
        for a in c[:2]:
            if a not in out:
                out.append(a)
    return sorted(out)


def contrasts_for(template, arms, control=None):
    """The template's (treated, control, role) contrasts whose arms are in the data; --control overrides them."""
    if control:
        if control not in arms:
            raise ValueError('--control %r is not an arm in the data (%s)' % (control, ', '.join(arms)))
        return [(a, control, 'primary') for a in arms if a != control]
    plan = PLANS.get(template)
    if plan is None:
        raise ValueError('arms %s belong to no known template: name the control arm with --control' % ', '.join(arms))
    return [c for c in plan['contrasts'] if c[0] in arms and c[1] in arms]


def levels_for(treat, switch_in_mid=False):
    """Composite membership for one treated arm: near = the probes of the paradigms that arm trained (none for
    Equal Steps), mid = the other memory tests, far = the reasoning tests."""
    trained = TRAINS.get(treat)
    near = list(LEVELS['near']) if trained is None else [NEAR_PROBE[k] for k in trained if k in NEAR_PROBE]
    mid = [t for t in WM_TESTS if t not in near] + (['lab.switch'] if switch_in_mid else [])
    return {'near': near, 'mid': mid, 'far': list(FAR_TESTS)}


def fingerprint(options):
    """SHA-256 of this file and of the options: post it with the plan before the first draw."""
    with open(os.path.abspath(__file__), 'rb') as fh:
        code = hashlib.sha256(fh.read()).hexdigest()
    opts = json.dumps(options, sort_keys=True, separators=(',', ':'), default=str)
    return {'analyze_py_sha256': code, 'options': options, 'options_sha256': hashlib.sha256(opts.encode('utf-8')).hexdigest(),
            'combined_sha256': hashlib.sha256((code + opts).encode('utf-8')).hexdigest()}


def _options(template, control, sesoi, alpha, visit, calibration, exclude_flags, switch_in_mid):
    cal = None
    if calibration:
        cal = hashlib.sha256(json.dumps(calibration, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    return {'template': template, 'control': control, 'sesoi': sesoi, 'alpha': alpha, 'visit': visit,
            'calibration_sha256': cal, 'exclude_flags': sorted(exclude_flags), 'switch_in_mid': bool(switch_in_mid)}


def describe_plan(template, contrasts, visit='POST', switch_in_mid=False):
    """The families that will be tested (also printed by --plan, before any data exist)."""
    plan = PLANS.get(template, PLANS['default'])
    prim = [c for c in contrasts if c[2] == 'primary']
    second = [c for c in contrasts if c[2] != 'primary']
    sec = list(plan['secondary'])
    expl = [o for o in plan['exploratory'] if not (o == 'lab.switch' and switch_in_mid)]
    if 'tests' in sec:
        sec = ['every single test' + ('' if switch_in_mid else ' except lab.switch')]
    fams = [('primary', plan['primary'], prim, visit), ('second_control', plan['primary'], second, visit),
            ('secondary', sec, prim, visit), ('followup', plan['followup'], prim, 'FU'), ('exploratory', expl, prim, visit)]
    return [{'family': f, 'outcomes': o, 'contrasts': ['%s vs %s' % (c[0], c[1]) for c in cs], 'visit': v}
            for f, o, cs, v in fams if o and cs]


def standardize(df, calibration=None):
    """z per test against the pooled Baseline 2 distribution (or a calibration file's mean/sd); lower-is-better
    tests are sign-flipped so that +z always means better."""
    ref = {}
    cal = (calibration or {}).get('tests') or {}
    for test, g in df.groupby('test'):
        if test in cal and cal[test].get('sd'):
            ref[test] = (float(cal[test]['mean']), float(cal[test]['sd']), 'calibration')
        else:
            b2 = g.loc[g['kind'] == 'B2', 'score']
            base = b2 if len(b2) >= 3 else g.loc[g['kind'].isin(['B1', 'B2']), 'score']
            ref[test] = (float(base.mean()), float(base.std(ddof=1)), 'pooled B2' if len(b2) >= 3 else 'pooled baseline')
    df = df.copy()
    df['z'] = [((s - ref[t][0]) / ref[t][1]) * (-1 if t in LOWER_IS_BETTER else 1) if ref[t][1] > 0 else np.nan
               for s, t in zip(df['score'], df['test'])]
    return df, ref


def composite_table(zdf, levels, min_share=0.5):
    """Mean z per participant x visit x level; a composite needs at least min_share of the level's tests that occur
    in the data (e.g. mid without lab.bind in Standard visits)."""
    cols_out = ['pid', 'arm', 'kind', 'outcome', 'value', 'k']
    if zdf.empty:
        return pd.DataFrame(columns=cols_out)
    piv = zdf.pivot_table(index=['pid', 'arm', 'kind'], columns='test', values='z', aggfunc='first')
    parts = []
    for lvl, tests in levels.items():
        cols = [t for t in tests if t in piv.columns]
        if not cols:
            continue
        sub = piv[cols]
        k = sub.notna().sum(axis=1)
        ok = k >= max(1, math.ceil(min_share * len(cols)))
        part = pd.DataFrame({'value': sub.mean(axis=1, skipna=True)[ok], 'k': k[ok]}).reset_index()
        part['outcome'] = lvl
        parts.append(part)
    return pd.concat(parts, ignore_index=True)[cols_out] if parts else pd.DataFrame(columns=cols_out)


def outcome_frame(values, outcome, visit):
    """Wide frame (pid, arm, baseline, post) for one outcome: baseline = mean of B1 and B2 (whichever exist)."""
    v = values[values['outcome'] == outcome]
    if v.empty:
        return pd.DataFrame(columns=['pid', 'arm', 'baseline', 'post'])
    w = v.pivot_table(index=['pid', 'arm'], columns='kind', values='value', aggfunc='first').reset_index()
    base_cols = [c for c in ('B1', 'B2') if c in w.columns]
    w['baseline'] = w[base_cols].mean(axis=1, skipna=True) if base_cols else np.nan
    w['post'] = w[visit] if visit in w.columns else np.nan
    return w[['pid', 'arm', 'baseline', 'post']]


def run_analysis(long, control=None, sesoi=0.3, alpha=0.05, visit='POST', calibration=None, exclude_flags=(),
                 switch_in_mid=False, template=None):
    df = first_visits(long, exclude_flags)
    df = df[df['arm'].notna()]
    df, template, ignored = select_template(df, template)
    arms = sorted(df['arm'].unique())
    contrasts = contrasts_for(template, arms, control)
    plan = PLANS.get(template, PLANS['default'])
    zdf, ref = standardize(df, calibration)
    tests_present = sorted(set(df['test']))
    single = zdf.rename(columns={'test': 'outcome', 'z': 'value'})[['pid', 'arm', 'kind', 'outcome', 'value']]
    raw = df.rename(columns={'test': 'outcome', 'score': 'value'})[['pid', 'arm', 'kind', 'outcome', 'value']]
    cache, notes = {}, []

    def values_for(outcome, lv):
        if outcome in COMPOSITES:
            tests = tuple(t for t in lv[outcome] if t in tests_present)
            if not tests:
                return None, []
            if tests not in cache:
                cache[tests] = composite_table(zdf, {outcome: list(tests)})
            v = cache[tests]
            return v[v['outcome'] == outcome] if not v.empty else v, list(tests)
        if outcome not in tests_present:
            return None, []
        if outcome in LOWER_IS_BETTER and not switch_in_mid:
            return raw[raw['outcome'] == outcome], [outcome]
        return single[single['outcome'] == outcome], [outcome]

    def expand(outcomes):
        out = []
        for o in outcomes:
            if o == 'tests':
                out += [t for t in tests_present if t not in EXPLORATORY or switch_in_mid]
            else:
                out.append(o)
        return out

    def fam(name, outcomes, cons, at):
        """ANCOVA per outcome x contrast at visit `at`; Holm across every row of the family."""
        rows = []
        for treat, ctrl, role in cons:
            lv = levels_for(treat, switch_in_mid)
            for o in expand(outcomes):
                vals, tests = values_for(o, lv)
                if vals is None or vals.empty:
                    notes.append('%s: %s for %s vs %s not available (no %s)' % (name, o, treat, ctrl,
                                 'trained paradigm with a near probe' if o == 'near' else 'data'))
                    continue
                r = ancova(outcome_frame(vals, o, at), 'arm', treat, ctrl, sesoi=sesoi, alpha=alpha)
                if r is None:
                    notes.append('%s: %s for %s vs %s skipped (fewer than 2 people per arm at %s)' % (name, o, treat, ctrl, at))
                    continue
                r.update({'outcome': o, 'visit': at, 'role': role, 'tests': tests,
                          'unit': 'ms' if (o in LOWER_IS_BETTER and not switch_in_mid) else 'z'})
                rows.append(r)
        seen = []
        for r in rows:
            if r['outcome'] not in seen:
                seen.append(r['outcome'])
        holm_text = 'Holm across all %d rows of this family' % len(rows) if len(rows) > 1 else 'a single test, no correction needed'
        label = '%s: %s at %s; %s' % (name, ', '.join(seen), at, holm_text)
        for r, ph in zip(rows, holm([r['p'] for r in rows])):
            r['p_holm'] = float(ph)
            r['family'] = label
        return rows

    prim = [c for c in contrasts if c[2] == 'primary']
    second = [c for c in contrasts if c[2] != 'primary']
    if template in PLANS and not control and not prim:
        notes.append('the primary contrast %s vs %s is not in the data (arms present: %s)'
                     % (plan['contrasts'][0][0], plan['contrasts'][0][1], ', '.join(arms)))
    primary = fam('primary', plan['primary'], prim, visit)
    second_control = fam('second control', plan['primary'], second, visit)
    secondary = fam('secondary', plan['secondary'], prim, visit)
    exploratory = fam('exploratory', [o for o in plan['exploratory'] if not (o == 'lab.switch' and switch_in_mid)], prim, visit)
    followup = fam('follow-up', plan['followup'], prim, 'FU') if visit == 'POST' and (df['kind'] == 'FU').any() else []
    n_by_arm = df.groupby('arm')['pid'].nunique().to_dict()
    n_post = df[df['kind'] == visit].groupby('arm')['pid'].nunique().to_dict()
    opts = _options(template, control, sesoi, alpha, visit, calibration, exclude_flags, switch_in_mid)
    first = prim[0] if prim else (contrasts[0] if contrasts else (None, None, None))
    return {
        'version': VERSION, 'template': template, 'plan_title': plan['title'] if template in PLANS else 'custom arms (--control)',
        'contrasts': [{'arm': c[0], 'control': c[1], 'role': c[2]} for c in contrasts],
        'control': first[1], 'arms': arms, 'visit': visit, 'sesoi_d': sesoi, 'alpha': alpha,
        'exclude_flags': list(exclude_flags), 'levels': levels_for(first[0], switch_in_mid) if first[0] else {},
        'levels_by_arm': {c[0]: levels_for(c[0], switch_in_mid) for c in contrasts},
        'plan': describe_plan(template, contrasts, visit, switch_in_mid),
        'reference': {t: {'mean': m, 'sd': s, 'source': src} for t, (m, s, src) in ref.items()},
        'n_participants': {k: int(v) for k, v in n_by_arm.items()}, 'n_with_outcome_visit': {k: int(v) for k, v in n_post.items()},
        'ignored_templates': ignored, 'notes': notes, 'fingerprint': fingerprint(opts),
        'primary': primary, 'second_control': second_control, 'secondary': secondary, 'exploratory': exploratory,
        'followup': followup,
    }


def _fmt(x, nd=3):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return 'NA'
    if isinstance(x, float) and (abs(x) >= 1e4 or (0 < abs(x) < 1e-3)):
        return '%.2e' % x
    return ('%.' + str(nd) + 'f') % x


def _fingerprint_lines(fp):
    return ['analysis fingerprint: analyze.py sha256 %s' % fp['analyze_py_sha256'],
            '  options %s' % json.dumps(fp['options'], sort_keys=True),
            '  options sha256 %s  |  combined sha256 %s' % (fp['options_sha256'], fp['combined_sha256'])]


def format_plan(template, plan_rows, fp, title=None):
    lines = ['Long-Horizon analysis plan %s  |  template: %s%s' % (VERSION, template, ('  (' + title + ')') if title else '')]
    for f in plan_rows:
        lines.append('  %-15s %s at %s; contrasts: %s; Holm across all rows of the family'
                     % (f['family'], ', '.join(f['outcomes']), f['visit'], '; '.join(f['contrasts'])))
    lines += _fingerprint_lines(fp)
    lines.append('Post this plan and the fingerprint publicly (e.g. in the Chimera Discord) before the first draw.')
    return '\n'.join(lines)


def format_report(res):
    lines = ['Long-Horizon study analysis %s  |  template: %s (%s)  |  outcome visit: %s  |  SESOI d = %s  |  alpha = %s'
             % (res['version'], res['template'], res['plan_title'], res['visit'], res['sesoi_d'], res['alpha']),
             'contrasts: %s' % '; '.join('%s vs %s (%s)' % (c['arm'], c['control'], c['role']) for c in res['contrasts']),
             'participants per arm: %s; with the outcome visit: %s' % (res['n_participants'], res['n_with_outcome_visit'])]
    if res['ignored_templates']:
        lines.append('left out (other templates, analyse them separately): %s' % res['ignored_templates'])
    if res['exclude_flags']:
        lines.append('excluded visit-tests flagged: %s (sensitivity analysis)' % ', '.join(res['exclude_flags']))
    for arm, lv in sorted(res['levels_by_arm'].items()):
        lines.append('composites for %s: near %s | mid %s | far %s' % (arm, lv['near'] or '(none: no trained paradigm with a near probe)', lv['mid'], lv['far']))
    head = '%-12s %-10s %-11s %6s %8s %7s %8s %8s %8s %18s %9s %6s %9s %9s'
    for key in ('primary', 'second_control', 'secondary', 'followup', 'exploratory'):
        rows = res[key]
        if not rows:
            continue
        lines += ['', rows[0]['family'],
                  head % ('outcome', 'arm', 'vs', 'n', 'diff', 'd_adj', 'd_ppc2', 'p', 'p_holm', '95% CI', 'TOST p', 'equiv', 'BF10', 'BF10_reg')]
        for r in rows:
            tp = r['tost']['p'] if r['tost'] else None
            eq = ('yes' if r['tost']['equivalent'] else 'no') if r['tost'] else 'NA'
            lines.append(head % (r['outcome'], r['arm'], r['control'], sum(r['n'].values()), _fmt(r['estimate']), _fmt(r['d_adjusted'], 2),
                                 _fmt(r['d_ppc2'], 2), _fmt(r['p'], 4), _fmt(r.get('p_holm'), 4),
                                 '[%s, %s]' % (_fmt(r['ci95'][0]), _fmt(r['ci95'][1])), _fmt(tp, 4), eq, _fmt(r['bf10'], 2),
                                 _fmt(r['bf10_regression'], 2)))
    if res['notes']:
        lines += [''] + ['note: ' + n for n in res['notes']]
    lines += [''] + _fingerprint_lines(res['fingerprint'])
    lines += ['', 'Reading: diff = adjusted Post difference (arm - vs) in z units of the pooled Baseline 2 SD (raw ms for',
              'lab.switch, where lower is better); TOST bounds = +/- SESOI x pooled baseline SD; BF10 > 3 favours an effect,',
              '< 1/3 favours none. Available-case analysis: everyone with a baseline and the outcome visit, no imputation.',
              'The plan and the fingerprint above should have been posted before the first draw (analyze.py --plan).',
              'One study cannot show transfer on its own; report flow, adherence and dropouts by arm (CONSORT).']
    return '\n'.join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description='Long-Horizon preregistrable study analysis (ANCOVA, Holm, TOST, Bayes factors).')
    ap.add_argument('inputs', nargs='*', help='export JSON files, raw backups, pooled CSV files or directories')
    ap.add_argument('--template', default=None, choices=sorted(PLANS),
                    help='study template to analyse; required when the inputs hold several (they are never pooled)')
    ap.add_argument('--plan', action='store_true', help='print the analysis plan and its fingerprint, then stop (no data needed)')
    ap.add_argument('--control', default=None, help="override the template's contrasts: every other arm vs this arm")
    ap.add_argument('--sesoi', type=float, default=0.3, help='smallest effect of interest in d units (TOST bounds)')
    ap.add_argument('--alpha', type=float, default=0.05)
    ap.add_argument('--visit', default='POST', choices=['POST', 'FU', 'Q'], help='outcome visit')
    ap.add_argument('--calibration', default=None, help='calibration JSON (calibrate.py) for the z reference')
    ap.add_argument('--exclude-flags', default='', help='comma-separated visit/test flags to exclude (sensitivity analysis)')
    ap.add_argument('--switch-in-mid', action='store_true', help='count task switching in the mid composite (default: exploratory only)')
    ap.add_argument('--json', default=None, help='write all results as JSON here')
    a = ap.parse_args(argv)
    cal = None
    if a.calibration:
        with open(a.calibration, encoding='utf-8') as fh:
            cal = json.load(fh)
    flags = [f for f in a.exclude_flags.split(',') if f]
    if a.plan:
        if not a.template:
            ap.error('--plan needs --template')
        plan = PLANS[a.template]
        try:
            cons = contrasts_for(a.template, template_arms(a.template), a.control)
        except ValueError as e:
            ap.error(str(e))
        fp = fingerprint(_options(a.template, a.control, a.sesoi, a.alpha, a.visit, cal, flags, a.switch_in_mid))
        print(format_plan(a.template, describe_plan(a.template, cons, a.visit, a.switch_in_mid), fp, plan['title']))
        return 0
    if not a.inputs:
        ap.error('give export files or folders (or --plan --template ID)')
    long = load_inputs(a.inputs)
    try:
        res = run_analysis(long, a.control, a.sesoi, a.alpha, a.visit, cal, flags, a.switch_in_mid, a.template)
    except ValueError as e:
        print('analyze.py: %s' % e, file=sys.stderr)
        return 2
    print(format_report(res))
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump(res, fh, indent=1, default=float)
    return 0


if __name__ == '__main__':
    sys.exit(main())
