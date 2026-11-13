# Long-Horizon study analysis

Python tools that run **outside the app** on exports that participants send voluntarily. They pool the exports
of **one study template at a time**, build the community calibration file, and run the preregistrable analysis from
`research/04-transfer-lab.md` §17.4. Nothing here is needed to use Long-Horizon.

| File | What it does |
|---|---|
| `analyze.py` | ANCOVA of Post on baseline by arm, Holm correction, TOST equivalence tests, Bayes factors, effect sizes |
| `calibrate.py` | Calibration JSON from pooled Baseline 1 + Baseline 2 data: per test `r`, `sd`, `mean`, `n` (noise bands) |
| `synth.py` | Synthetic exports with known effects, in the app's export format |
| `test_analysis.py` | Checks everything on synthetic data (`python -m unittest test_analysis -v`, about 25 s) |

```sh
pip install -r requirements.txt
python synth.py --out demo/ --n-per-arm 60 --effect near=0.6,mid=0.2,far=0     # try it on fake data
python analyze.py --plan --template default                                     # the plan + fingerprint to post
python analyze.py demo/ --template default --json results.json                  # the analysis
python calibrate.py demo/ --out calibration.json                                # needs ≥ 50 people with B1 + B2
```

## Inputs (what the tools read)

Give files or directories (searched for `*.json` and `*.csv`). Three formats are accepted.

**1. Study exports** (`HF.lab.exportBundle(...).json`, `meta.kind = 'long-horizon-study-export'`; 1.0.0's `'holdfast-study-export'` is read too, written by
`js/lab/export.js`). Fields used:

| Field | Becomes |
|---|---|
| `meta.anonId` | `pid` |
| `study.arm`, `study.template` | `arm`, `template` (participants without an arm are left out of arm comparisons) |
| `visits[].kind` | `kind`: `B1`, `B2`, `Q`, `POST`, `FU` (`X` = extra visits, ignored) |
| `visits[].id`, `.startedAt` (ISO), `.device.class`, `.flags[]` | `visit_id`, `started_at`, `device_class`, `visit_flags` |
| `visits[].tests[testId].score`, `.flags[]`, `.form` | `test`, `score`, `test_flags`, `form` |

**2. Raw app backups** (the main Export in Settings, SPEC §3 records): `profile.anonId`, `labVisits[]` (same
fields; `startedAt` in ms), and the arm from `events[]` of type `study-draw`/`study-code` (or `sessions[].study.arm`).

**3. A pooled long CSV**, one row per participant × visit × test:

| Column | Required | Notes |
|---|---|---|
| `pid` | yes | anonymous participant id |
| `arm` | yes | e.g. `varied`, `search`, `labonly`, `cao-exec`, `cao-trad`, `wang-steps`, `wang-search` |
| `kind` | yes | `B1` `B2` `Q` `POST` `FU` (the alias `visit` is accepted) |
| `test` | yes | `lab.nback` `lab.rel` `lab.sspan` `lab.update` `lab.bind` `lab.matrix` `lab.series` `lab.graph` `lab.switch` |
| `score` | yes | the test's `TestResult.score` |
| `started_at`, `visit_id`, `device_class`, `visit_flags`, `test_flags`, `form`, `template` | no | flags `;`-separated |

The app's own per-participant `csv.visits` has no `pid` or `arm` column: add both when pooling.

**Score direction.** Higher is better for every test except `lab.switch`, whose score is the switch cost in ms
(lower is better). The tools flip its sign when they compute z-scores.

## Rules applied before any test

- **One template at a time.** Each study template (`default`, `cao`, `wang`) is a separately randomised study, so
  exports of different templates are never pooled. The template comes from `study.template` (or, if a file lacks
  it, from the arm id). When the inputs hold several templates, `--template` is required and the others are left
  out (the report lists them); without it the run stops with an error.
- The first visit of each kind per person is kept; repeats and `X` visits are dropped.
- **Baseline** = mean of B1 and B2 (whichever exist), as recommended for the covariate (research/04 §13).
- **z-scores** per test use the pooled Baseline 2 distribution of all arms (randomisation happens after B2), or the
  mean and SD of a calibration file (`--calibration`).
- **Composites** (mean z; for each contrast the same definition for both arms, so the arms are comparable):
  - near = the probes of the paradigms the **treated arm trained**: `lab.nback` for n-back (Varied, both Cao arms),
    `lab.rel` for the Relation Grid and Stream (Varied). Equal Steps (Wang) has no near probe, so the `wang`
    template has no near composite;
  - mid = the other memory tests (`lab.nback`, `lab.rel`, `lab.sspan`, `lab.update`, `lab.bind` minus near);
  - far = `lab.matrix`, `lab.series`, `lab.graph`.
  - A composite needs at least half of the level's tests that occur in the data.
- **Task switching** is analysed on its own in raw ms (lower = better): exploratory in the `default` and `wang`
  templates (switch costs are unreliable; Hedge et al. 2018), the secondary outcome of the `cao` template.
  `--switch-in-mid` adds it to mid instead, as the app's per-user view does (PLAN §6).
- **Missing data (available-case analysis):** each analysis uses everyone with a baseline and the outcome visit;
  dropouts are not imputed, so this is not a full intention-to-treat analysis. Report the flow, dropouts and
  adherence by arm next to the results.
- `--exclude-flags help-used,device-class,device-input` drops visit-tests with these flags (`device-class` and
  `device-input`: the visit was on another kind of device or input than the first one; `help-used`: the person
  reported help). It is a **sensitivity** analysis; the main analysis keeps everyone with data.

## The analysis (`analyze.py`)

Each template has a fixed plan of contrasts and outcomes (`PLANS` in `analyze.py`):

| Template | Contrasts (treated vs control) | Primary (Post) | Secondary | Follow-up | Exploratory |
|---|---|---|---|---|---|
| `default` | **varied vs search**; second control: varied vs labonly (if that arm exists) | far, mid, near composites | every single test except `lab.switch` | the three composites | `lab.switch` |
| `cao` | **cao-exec vs cao-trad** (Cao's key contrast); second control: cao-exec vs cao-search and cao-trad vs cao-search (if that arm exists) | `lab.sspan` (complex span) | `lab.switch` (ms) | `lab.sspan` | near (`lab.nback`), far |
| `wang` | **wang-steps vs wang-search** | `lab.matrix` | none | `lab.matrix` | `lab.series`, `lab.graph`, mid |

The second-control rows repeat the primary outcomes against the other comparison arm. `--control ARM` replaces the
template's contrasts with "every other arm vs ARM" (needed for arms that belong to no template).

For each outcome and contrast, using the two arms' participants:

1. **ANCOVA**: `post ~ arm + baseline` by OLS (Vickers & Altman 2001). It reports:
   - the adjusted difference (z units; ms for `lab.switch`), its SE, t, df, p and 95 % CI;
   - `d_adj` = difference / pooled baseline SD of the outcome;
   - Morris (2008) `d_ppc2`, the effect size used by the meta-analyses.
2. **Holm** correction across **every row of a family**: all its outcomes × all its contrasts. The families are
   primary, second control, secondary, follow-up and exploratory (exploratory rows are not confirmatory). In a
   3-arm design, both second-control contrasts are therefore corrected together.
3. **TOST** equivalence (Lakens, Scheel & Isager 2018). The bounds are ± SESOI × pooled baseline SD (default
   `--sesoi 0.3`). "equiv = yes" means the 90 % CI lies inside the bounds.
4. **Bayes factors**:
   - `BF10`: the JZS Bayes factor of the arm effect from the ANCOVA t, with a Cauchy prior r = √2/2 (Rouder et al.
     2009; as De Simoni & von Bastian 2018). It uses the effective n of the two arms and the residual df. This is a
     standard approximation for the covariate-adjusted effect.
   - `BF10_reg`: a check, the Zellner–Siow regression Bayes factor of `arm + baseline` against `baseline`
     (Liang et al. 2008, prior scale √2/4).
   - BF10 > 3 favours an effect; BF10 < 1/3 favours none.

The output is a text report, plus all numbers with `--json`. Every report ends with a **fingerprint**: the SHA-256
of `analyze.py` and of the options (template, control, SESOI, alpha, visit, exclusions, calibration file), so
anyone can check that the posted plan was the one run.

**Preregister before the first draw.** Run `python analyze.py --plan --template <id> [options]`: it prints the
families above and the fingerprint without any data. Post that output publicly (for example in the Chimera
Discord) together with the hypotheses, the smallest effect of interest and the stopping rule, before anyone draws
an arm. The commitment code only shows that a person's arm was not changed; it does not commit the analysis.

**Do not** (research/04 §14.4):
- split people into "responders" by training gain;
- correlate baseline with gain;
- read within-group change as a training effect;
- report single outcomes without the correction.

**Sample sizes** (research/04 §17.5, ANCOVA, ρ ≈ .8, people per arm):
- about 20–30 to detect near transfer (d ≈ 0.6);
- about 70–100 to show far transfer is below d = 0.3 by TOST;
- 150–200 to detect d = 0.2.

## Calibration (`calibrate.py`)

It pools every template (baselines come before randomisation). For each test it uses the people who have both
baselines, after dropping visits flagged `help-used`, `help`, `device-class` or `device-input` (override with
`--exclude-flags`):

| Field | Meaning |
|---|---|
| `r` | B1–B2 Pearson correlation (retest reliability) |
| `sd`, `mean` | SD and mean of B2 scores |
| `n` | people with both baselines |
| `mean1`, `sd1` | mean and SD of B1 scores |
| `gain` | mean B2 − B1, the first retest gain |
| `practiceN`, `practice` | only with `--practice-arm search` (or another no-training arm): `practiceN` = people of that arm with B2 and Post; `practice` = their mean B2 → Post change, written **only when practiceN ≥ 30**. `HF.lab.compare` uses it for the practice-adjusted RCI under the same rule. |

```json
{ "updatedAt": 1762430000000, "version": "community-2026-11-06", "source": "tools/analysis/calibrate.py 1.1: 64 participants …",
  "tests": { "lab.matrix": { "r": 0.78, "sd": 0.15, "mean": 0.58, "n": 64, "mean1": 0.53, "sd1": 0.16, "gain": 0.05, "higherIsBetter": true } },
  "composites": { "far": { "r": 0.85, "sd": 0.78, "mean": 0.0, "n": 64 } },
  "meta": { "minN": 50, "provisional": false, "excludedFlags": ["help-used", "help", "device-class", "device-input"], "skipped": {}, "practiceMinN": 30 } }
```

The app imports this as `records.calibration` (it reads `tests[id].r/sd/mean/n`, and `practice` when
`practiceN ≥ 30`). The app's change verdict compares the change with measurement noise only; the practice-adjusted
index is shown beside it when available.
Tests below `--min-n` (default 50, PLAN §6) are left out, so the app keeps saying "not yet calibrated". `--force`
keeps them and marks the file provisional. The 95 % change band printed per test is 1.96 · √(2(1 − r)) SD
(Jacobson & Truax 1991).

## Limitations

- The JZS Bayes factor on an ANCOVA t is an approximation; the regression Bayes factor is shown as a check.
- Composites weight tests equally. With enough data, latent change models are better (Kievit et al. 2018).
- Each person's arm comes from their own export: check commitment codes (`study.commitment`, `study.salt`) before
  pooling (see `HF.study.verify`).
- Forms are counterbalanced but not yet equated: form differences add noise until item-level calibration exists
  (research/04 §11.1).
