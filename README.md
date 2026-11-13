[Built by the Chimera community on Discord — discord.gg/chmr](https://discord.gg/chmr): share your progress, suggest features and join community studies.

# Long-Horizon

**A free, open-source working memory trainer with a built-in lab.**
*Hold more in mind. Keep it straight.*

**Play it:** [mighty-iq.github.io/Long-Horizon](https://mighty-iq.github.io/Long-Horizon/) · **Guide (PDF):** [docs/Long-Horizon-Guide.pdf](docs/Long-Horizon-Guide.pdf)

## Why the name

In AI, a long-horizon task takes many steps in a row, and models are now rated by how long a task they can carry
through ([Kwa et al. 2025](https://arxiv.org/abs/2503.14499)). Working memory is the same capacity in people:
keeping a plan and its pieces intact while you work through it. In n-back the n is your horizon, in Equal Steps it
is how far back you compare, and in the relation grid it is how many symbols you relate at once. Training pushes it
further, and the Lab measures whether a longer horizon carries over to reasoning.

## What it is

Long-Horizon trains working memory with short blocks of n-back and relational-integration tasks, including the tasks
of two recent papers, run as closely as each paper allows: Cao et al.'s 2026 *executive n-back* and the
number-stream task of Wang, Sun & Xiao (2025), which Long-Horizon calls *Equal Steps*. Six training styles share one
learner record, because the research disagrees about the best way to practise. An optional Lab measures near, mid
and far transfer with generated tests you never train on, and Study mode lets the community run controlled
experiments. It runs in your browser, with no account; your data stay with you.

**Read the guide:** [`docs/Long-Horizon-Guide.pdf`](docs/Long-Horizon-Guide.pdf), an illustrated A4 guide with
clickable links (HTML source in [`docs/guide/guide.html`](docs/guide/guide.html)).

## What the evidence says (honestly)

Working memory is closely tied to reasoning: in a study of 131 people, the latent correlations with reasoning
(between the underlying abilities, not single test scores) were about .8 for a working memory factor and about .9
for a relational-integration factor (Oberauer et al. 2008). Whether training it raises reasoning is the open
question: Long-Horizon builds its strongest bets on it and measures the result in the Lab, for you and, pooled, for
the community. What the studies say so far:

- You will get much better at the trained tasks, often better at very similar untrained ones, and maybe
  slightly better at other memory tasks.
- Controlled studies with active control groups find about zero transfer to reasoning, IQ tests or school
  results. **Long-Horizon does not claim to raise IQ.** It measures transfer instead of promising it, and one
  person's Lab change cannot show cause.
- The two headline tasks rest on single small studies. Cao et al. 2026 compared 15 people per group with no
  untrained control; the executive group's operation-span advantage was significant at the post-test, and at the
  3-month follow-up the groups no longer differed on the span score. Wang et al. 2025 (29 vs 28 students) found
  no behavioural reasoning gain over its control; its reasoning claim rests on EEG alone. Both tasks are labelled
  *experimental*.

Chapter 10 of the guide explains the research plainly, with sources and limits.

## Features

- **N-back:** Plain (one stream, many kinds of item) and Dual (position + sound, two independent streams). Items
  show for 500 ms, one every 3 s (2.5 s at the fast pace); lures from 2-back; levels by n and pace, up to
  16-back. Sounds are tones by default; spoken letters are an experimental option that has not yet been checked
  by ear.
- **Executive n-back** (experimental): **Transform** uses Cao et al.'s task (days of the week; press for the day
  *after* the day n back), plus our own **Arithmetic** and **Switch** versions (Switch goes up to 9-back).
- **Relations** (experimental): **Equal Steps**, Wang et al.'s number-stream task (press when the step between
  numbers repeats), the **Relation Grid** (8 rule tiers × 9 pressure steps) and the **Relation Stream**.
- **Span** (opt-in, off during the 20-session programme): operation, symbol and backward complex span.
- **Variety by design:** fresh seeded sequences, blocked → serial → random schedules, new versions introduced
  one at a time, glyph sets that change every 5 sessions, a rule card before every block.
- **Six training styles:** Varied (default), Sprint, Stretch, Mastery Path, Protocols and Free play + Coach.
  Protocols runs published procedures as closely as each paper allows, and lists Long-Horizon's choices where a paper
  is silent: Cao 2026 (and its traditional arm), Wang 2025, and Jaeggi 2008 dual n-back (tones unless you choose
  spoken letters; the paper used spoken consonants). Switching styles never loses progress.
- **The Lab** (optional): memory and reasoning tests that are generated, solver-checked and never trained;
  two baselines, a Quick check, a Post-test and a Follow-up; near/mid/far set from each person's training;
  change verdicts only after community calibration; no IQ scores.
- **Study mode:** an adaptive visual-search active control with session lengths matched to training, the same
  neutral wording for every programme, templates for replicating both papers, commitment codes, a way to leave
  a study, and Python analysis tools.
- **Quiet motivation:** nothing on screen during a block but the task; plain debriefs; levels, "Last three
  blocks" meters, weekly goals (no daily streaks), 12 milestone badges, graphs, full history; Focus mode hides
  it all.
- **Learn by playing:** a 6-minute n-back tutorial with letters on a fading "memory tape", short lessons before
  each new version (executive and Dual checks at 1-back), How to play, a glossary and strategy cards.
- **Accessible:** keyboard-only use, remappable keys, large touch targets, left-handed layout, large text, light
  and dark themes, reduced motion, colour never the only cue, screen-reader labels outside the timed tasks.

## Quick start

**On a computer:** download or clone this repository (the release zip unpacks to one `long-horizon/` folder) and
double-click `index.html` in it (keep the folder together), or use
[`dist/long-horizon.html`](dist/long-horizon.html), the whole app in one file that you can keep anywhere. Both work
offline in a current browser; nothing to install.

**On a phone:** phones need a web address. Put the `long-horizon/` folder on GitHub as a repository, then choose
**Settings → Pages → Build and deployment → Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
A minute later the app is at `https://<your-account>.github.io/<repository>/`; open it in Safari (iPhone, iPad) or
Chrome (Android) and add it to your Home Screen. On Pages, Long-Horizon can be installed and works offline.

**First run:** the Chimera pop-up → *Start training now* (default) or *Measure first* → the n-back lesson
(about 6 minutes) → session 1, which finds your level quickly.

| Key | Touch | Meaning |
|---|---|---|
| **J** | Match (Position in Dual) | the item matches (also *Present* in visual search, *True* in Span's sums) |
| **K** | Sound | the sound matches (Dual n-back) |
| **F** | No | no match (*Absent*, *False*), in tasks that ask for an answer on every item |
| **Space** | Start | start or continue |
| **Esc** or **P** | Pause | pause; a paused block never counts against you |

## Phones

- **Avoid in-app browsers.** A link tapped inside Discord or another app may open in that app's own browser,
  which may keep its storage separately. Open Long-Horizon in Safari or Chrome; the app shows a notice when it can
  tell that it is running in an in-app browser.
- **Back up.** Safari may delete a site's data after 7 days of browser use without a visit. Export from
  Progress now and then; Long-Horizon reminds you after milestones and shows the date of your last backup.
- For the sound tasks, turn the sound up and the iPhone's silent switch off, and use the sound check in Settings.
  Bluetooth headphones add delay; use Settings → Sound → Sound timing → Measure my delay.

## Privacy

No account, no analytics, no ads. Everything stays in your browser's storage on your device. Your data leave
the device only when you export them yourself (a file or a copyable text). When saved data grow large, Long-Horizon
asks you to export a backup; when it cannot save (storage blocked, storage full, or a newer version open in
another tab), it says "Not saved on this device" and why. Study participants choose whether to send their export
to a study coordinator; exports carry a random anonymous ID, not your name. Clearing your browser's data deletes
Long-Horizon's data, so keep an export.

## The Lab and community studies

The Lab is optional. **Part A · memory** (about 25 min) and **Part B · reasoning and control** (about 27 min) use
tests that are generated for each visit and never trained. The schedule is Baseline 1 and Baseline 2 (2–7 days
apart), a Quick check before session 11, a Post-test after session 20 and a Follow-up 8–12 weeks later. Scores
show as dots per visit; change verdicts ("above the noise band", "below the noise band") appear only once a test
has been **calibrated** by the community (at least 50 people with both baselines, pooled with
`tools/analysis/calibrate.py`). The usual retest gain is not subtracted from a verdict, so it does not prove that
training caused the change.

**Study mode** compares two programmes over the same schedule, screens, debriefs and goals, described to
participants in the same neutral words. Templates: **Long-Horizon study (20 sessions)** (training vs visual search),
**Cao et al. 2026 replication (6 sessions)** (executive vs traditional n-back, optionally with a visual-search
group) and **Wang et al. 2025 replication (30 days)** (Equal Steps vs visual search). Solo participants draw their
programme after Baseline 2: the app first shows only a commitment code to post in the Chimera Discord, and shows
the programme once they confirm it is posted or noted. Coordinators can issue codes instead. **Leave the study**
keeps the data and records the date. **Limitation:** the codes can be decoded by anyone who reads this source, so
keeping the programme hidden depends on everyone playing fair.

Rough sample sizes per group: about 20–30 to test near transfer; about 70–100 to show that far transfer is
smaller than d = 0.3; 150–200 to detect d = 0.2. The analysis tools in [`tools/analysis/`](tools/analysis/)
(Python: pandas, statsmodels, scipy) analyse one study template per run, with a fixed outcome plan per template:
ANCOVA, Holm correction across each family, equivalence tests, Bayes factors and a fingerprint of the code and
options. Post the plan before the first draw:

```sh
pip install -r tools/analysis/requirements.txt
python tools/analysis/analyze.py --plan --template default          # the plan + fingerprint to post
python tools/analysis/analyze.py exports/ --template default --json results.json
```

Coordinate studies in the [Chimera Discord](https://discord.gg/chmr).

## What is in this repository

```
long-horizon/
├── index.html              the app; its <link>/<script> blocks are generated from js/manifest.json
├── css/                    design system (app.css) and screen/task styles
├── js/
│   ├── manifest.json       THE load order: css, pure (no DOM, also loaded by node tests), assets, dom
│   ├── core/               rng, stats, util, schema, store, router, dom, timing, input, audio
│   ├── content/            stimulus sets and the in-app texts (lessons, glossary, how-to, claims, research)
│   ├── tasks/              nback/, relations/, span/, vsearch/: generators, scorers, views
│   ├── engine/             catalog, controller, learner model, modes (styles), planner, protocols, mastery, coach, goals, badges
│   ├── lab/                Lab tests, schedule, near/mid/far levels, compare, study, export, views
│   ├── ui/                 shell, Chimera pop-up, components, screens, session player
│   └── app.js              boot
├── assets/audio/           letters.js: optional spoken letters (credits in NOTICE)
├── sw.js, manifest.webmanifest   GitHub Pages only: install and offline
├── dist/long-horizon.html  the single-file build
├── docs/                   Long-Horizon-Guide.pdf, guide/ (HTML source, screenshots), dev/ (plan, contracts, notes)
├── tools/                  sync-index.mjs, build-single.mjs, build-pdf.py, analysis/ (Python)
├── tests/                  unit/ (node), e2e/ (Playwright, Python, Chromium), sim/ (simulated learners)
├── .github/workflows/      tests.yml (continuous integration)
└── SPEC.md                 the build contract (ids, records, ladders, controller, Lab API)
```

**No build step to run.** The app is plain JavaScript (ES2019) loaded as classic `<script>` files that share one
global, `window.HF` (named after the working name, Holdfast): no ES modules, no fetching of local files, no runtime
libraries. That is why `index.html` works from `file://`, on GitHub Pages and inside sandboxed previews. Pure
modules (generators, scorers, the engine, the Lab) have no DOM and run in Node for tests; DOM modules run only in
the browser. Data are event-sourced: append-only records, merged by id across tabs and imports, from which
everything else is derived.

## Tests and builds

Requirements: Node 22 for the unit tests, simulations and build tools; Python 3.9+ with Playwright for the e2e
tests and the PDF (`pip install playwright pypdf fonttools && python3 -m playwright install chromium`; fonttools
lets the PDF embed compact TrueType fonts, and poppler-utils adds the PDF's layout checks).

```sh
node tests/unit/run.mjs                    # all unit tests; add a filter such as engine- or nback-
python3 tests/e2e/run_core.py              # core e2e: timing, index, sandboxed preview, two tabs
python3 tests/e2e/test_lab_home.py         # any other e2e file runs on its own (one Chromium each)
node tests/sim/run.mjs varied --n 300 --days 60
                                           # simulated learners: varied | sprint | stretch | mastery | free |
                                           #   cao | wang | jaeggi | study-default | study-cao | study-wang | all
node tests/sim/derive-perf.mjs             # speed of the derive step on 5,000 blocks
(cd tools/analysis && python3 -m unittest test_analysis -v)

node tools/sync-index.mjs                  # after adding a file to js/manifest.json (--check to verify)
node tools/build-single.mjs                # → dist/long-horizon.html, everything inlined
python3 tools/build-pdf.py                 # → docs/Long-Horizon-Guide.pdf from docs/guide/guide.html
python3 docs/guide/make_shots.py           # → the guide's screenshots, from the real app with synthetic data
```

**Continuous integration:** [`.github/workflows/tests.yml`](.github/workflows/tests.yml) runs on every push and
pull request: `sync-index --check`, `node --check` on all JavaScript, the unit tests and the analysis tests
(after `pip install -r tools/analysis/requirements.txt`). The browser tests in `tests/e2e` run locally only.

Developer notes: [`SPEC.md`](SPEC.md), [`docs/dev/SPEC-core.md`](docs/dev/SPEC-core.md), the design plan
[`docs/dev/PLAN.md`](docs/dev/PLAN.md) and the `docs/dev/*-notes.md` files. The working rules for contributors,
including AI assistants, are in [`CLAUDE.md`](CLAUDE.md).

## Contributing

Ideas, bug reports and study plans are welcome in the [Chimera Discord](https://discord.gg/chmr) and as issues
or pull requests here. A few rules keep Long-Horizon trustworthy:

- **Claims match the evidence and the code.** No IQ promises; numbers in texts must match what the code does.
- **No copied material.** No GPL, CC BY-NC or AGPL code or assets (for example Brain Workshop's), and no items
  from copyrighted tests (Raven, ICAR, WAIS…). Re-implement papers from their method descriptions.
- **Generators are verified:** exact counts, a brute-force solver, and shortcut strategies that score near
  chance.
- **Timing is sacred:** nothing heavy runs while a block is on screen.
- Tests pass, and user-visible changes go into [`CHANGELOG.md`](CHANGELOG.md) and the guide.

## Licences

- **Code:** MIT, see [`LICENSE`](LICENSE).
- **Texts and the guide:** CC BY-SA 4.0, see [`LICENSE-CONTENT`](LICENSE-CONTENT).
- **Third-party material and credits:** see [`NOTICE`](NOTICE) (the optional spoken letters were synthesised
  with Flite, Carnegie Mellon University, voice cmu_us_slt).

## Credits

Built by the **Chimera community on Discord** ([discord.gg/chmr](https://discord.gg/chmr)): share your
progress, suggest features and join community studies.

The tasks re-implement procedures from published research, above all Cao, Zhang, Zhang, Zhang & Zhang (2026,
*Psychonomic Bulletin & Review*, [doi:10.3758/s13423-025-02773-8](https://doi.org/10.3758/s13423-025-02773-8))
and Wang, Sun & Xiao (2025, *Brain Topography*,
[doi:10.1007/s10548-024-01099-3](https://doi.org/10.1007/s10548-024-01099-3)); the full reference list is in
the guide, chapter 13. Spoken letters: Flite (CMU). Colours: the Okabe–Ito palette.
