# Simulation report (engine)

Simulated learners play through the real engine (`HF.engine.plan → beginSession → prepare → commit →
endSession`) to check what unit tests cannot: that every controller settles at its target, that no plan runs dry,
that versions open in order and only behind their gates, that the counting rules and caps hold over weeks, and
that the published protocols behave as their papers say. Run with
`node tests/sim/run.mjs <scenario> --n 300 [--days 60] [--json out.json]`; scenarios: varied, sprint, stretch,
mastery, free, cao, wang, jaeggi, study-default, study-cao, study-wang, weights, extremes, cao-gap.
`node tests/sim/summarize.mjs <dir>` turns the JSON files into the tables below.

## 1. The simulated learners (tests/sim/lib.mjs)

- **Truth is not the model.** Each learner has a latent ability per version: general (SD .7) + task (SD .3) +
  version (SD .3). Each version's true difficulty is the catalog's difficulty with a population-wide bias
  (SD .35 logits) and a stretched or squeezed spacing (×1 ± .15), so the catalog is deliberately "wrong".
- **Learning.** Every played block (warm-ups too) adds η × headroom × challenge to that version's skill
  (η log-normal around .045 logits per block; asymptote 2.5 ± .6 logits; challenge peaks at BA ≈ .80), half of it
  to the task and a tenth to general skill. Unpractised gains fade ≈ 0.4 % a day.
- **Days.** Each learner trains on a day with probability .35–.95, takes breaks of 5–20 days (1.5 % a day),
  sometimes tries a second (or third) session the same day, picks a session length of 10–30 min and a weekly
  target of 3–5. Day-to-day form varies (SD .2 logits).
- **Blocks.** Signal detection with a response bias (c ≈ .25 ± .25): d′ from the true BA, hit and false-alarm rates
  from d′ and c, binomial counts (6 targets + 14 non-targets per stream; Grid 10 + 10; Stream 6 + 24), scored
  with `HF.stats.sdt`. Dual's sound stream is .3 logits weaker. 4 % of blocks are bad (−1.5 logits), 3 % are
  paused or > 20 % voided, 5 % of sessions are abandoned part-way, and half of the learners stop when the
  fatigue event fires. Free-play learners mostly stay at their level, sometimes take the coach's Edge, Due, New
  or Growing suggestion, or go one rung easier or harder.

## 2. Checks

| Check | How |
|---|---|
| Controller settles within ±.03 of the target | mean BA of rated blocks after each track's placement phase (its first down move), excluding blocks at either end of the ladder or at a cap, and a track's blocks after its first visit to the top step (rebounds off a ceiling are biased upward). Pooled and per task (≥ 200 blocks). Mastery: in maintenance after the path, where the controller runs uncapped (an extra 100 learners at +2 logits finish the path within 60 days); a first run that measured unit blocks failed (.827) because inside units the level climbs under caps that rise unit by unit (up moves outnumbered down moves 2.4 : 1) — a transient, not a settled state |
| No dead ends | no plan without blocks (except "protocol not due", Lab-only arm, arm not yet drawn), no throw, every rung inside its ladder, params equal to the catalog's, never a Lab-only set; `extremes` adds very strong and very weak learners in every mode |
| Introduction order and gates | first block on a version not before its session (S1…S10); at most one new version from the order list per session (`track-intro` events); Executive versions only after Plain 2-back (or their lesson), Grid tiers only after the previous tier's step 6, Stream after T3 opened, T8 never without opt-in, Span never while off, visual search only in Study |
| Counting rules and caps | ≤ 1 counted session a local day (Sprint 2, ≥ 3 h apart), Stretch ≥ 20 h apart and ≤ 4 a week, the stored `counted` flag equals derive's |
| Stretch safety valve | fires exactly when two Stretch sessions in a row average < .62 (a quarter of the Stretch learners lose 2 logits for two weeks from day 30) |
| Cao | session 1 at 1-back, each later session at max(1, end − 2), ≤ one session a day, every block follows > 18 correct / ≥ 5 errors, uncontrolled lures, days, standard pace, follow-up of ≤ 10 blocks at session 6's start level (120-day run) |
| Wang | the level is constant within a day and moves after the day's 5th valid block by its raw accuracy (> .80 up, < .50 down), standard pace |
| Jaeggi | errors per stream (< 3 both → up, > 5 either → down); each session starts at the last level |
| Study arms | only the arm's tasks are trained; controls settle like Varied |

## 3. Results

### Phase 4 re-run (12 Nov 2026)

`node tests/sim/run.mjs all --json …` (seed `sim1`, 300 learners per mode, Study arms 100–150 each, 60 days; Cao
120 days) after the Phase 4 engine fixes: **74 of 74 checks passed** (3 new: the n-back ceiling in Cao's protocol and in both Study Cao arms). Log and
JSON: `wm-trainer/out/phase4/engine/sim-all.{log,json}`. What changed in the engine and why it could move these
numbers: self-correction offsets clamped to [−.01, +.05] and Mastery n-back / Equal Steps units passing at .87
(approximate-responder bound), a reopened Mastery unit kept for the whole next session, counted sessions judged by
finished slots, visual-search blocks of 40 displays with two more top steps, n-back ladders to 16-back, one coach
card per version.

| Mode (target) | 6 Nov | 12 Nov |
|---|---|---|
| Varied (.80) | .805 | **.805** (n-back .799 · Relations .812) |
| Sprint (.85) | .843 | **.843** |
| Stretch (.72) | .722 | **.723** |
| Mastery (.80), uncapped maintenance | .809 | **.812** |
| Free play (.80) | .798 | **.798** |
| Study train / search controls (.80) | .804 / .809–.810 | **.804 / .801** (all three templates) |

Mastery Path (main population): 3,552 units passed (6 Nov 3,593), 74 moved on (69), 4,678 delayed checks (1,100
failed; 4,772 / 1,156), 8,675 reviews (8,695); strong learners 2,280 / 18 / 2,534 (249) / 6,143. The first version
of the reopen fix lost reviews (6,156): while replaying blocks a reopened unit stayed open until its next *rated*
block, so its next review was ignored and planned again; any later-session block now closes it first.

Cao ceiling (new check, SC-05, ceiling now 16-back): nobody reaches it — Cao protocol 0/300 over 120 days (highest n reached: max 8), Study executive arm 0/100 (max 7), traditional arm 0/100 (median 7, 90th percentile 8, max 9); 4 of those 100 reached 9-back, i.e. would have sat at the old ceiling (4 % > the 1 % allowed). On Cao's own session-6 figures (8.4 ± 2.9) 0.4 % would reach 16-back. Visual-search controls touching the top step within 60 days (20-step ladder,
40 displays): default 8 of 100, Cao 11 of 100, Wang 5 of 150 (6 Nov, 18 steps, 20 displays: 17, 22 and 9 of 100; with 40 displays on the 18-step ladder it was 17, 25 and 11 %, hence the two shorter-deadline steps). Controls settle at .801. Estimated minutes
per full session (catalog estimates + 15 s per block; 20 learners per arm, `out/phase4/engine/dose-time.mjs`):
default Varied 17.6 vs search 18.4; Cao executive 28.4, traditional 30.4 vs search 28.2; Wang Equal Steps 6.8 vs
search 7.1 (before: search about half). **derive**: 10.8 ms median for 5,000 blocks on a machine shared with browser tests (Phase 3: 8.4 ms; a same-machine A/B against the pre-Phase-4 code differs by about 1 ms, within the noise).

Final check (12 Nov): Equal Steps blocks in Stretch now have 6 near misses (the ±1 responder had scored .857 there and
climbed to the top step); the difficulty model prices each near miss above 4 at 0.1 logit, as for n-back lures.
Re-run: Stretch settles at **.722** (n-back .719 · Relations .731; valve 51 learners, 0 mismatches; 7/7), and the
other modes are unchanged (Varied .805, Sprint .843, Mastery .812, Free .798) in the final `all` run
(`out/phase4/engine/sim-all-final.log`).

Record size (real generators and scorers, 30 days of Varied; `out/phase4/engine/size-check.mjs`): 1,053 chars per
block before, 788 with commit-time slimming (−25 %), 486 after `compactRecords` (−54 %); main grows ≈ 11.3 K chars a
daily session (was 14.9 K) and ≈ 7.1 K once compacted, so 5 M characters last ≈ 1.5 years of daily training
instead of ≈ 0.85.

Run of 6 Nov 2026 (seed `sim1`): 300 learners per mode and protocol over 60 days (Cao 120 days, to reach the
follow-up), Study arms 100 learners each; **74 of 74 checks passed**. Follow-up runs after the 6 Nov amendments
(Wang 300 learners, Study arms 100 each, Cao calibration 150 people × 2 arms, Varied/Stretch rechecks 150): every
check passed; search-ladder headroom is reported rather than checked. Raw JSON and logs: `wm-trainer/out/sim/`.

**Controllers** (settled rated blocks, as defined in §2):

| Mode (target) | Settled BA | Blocks | n-back · Relations | Per-learner median (IQR) | Per version |
|---|---|---|---|---|---|
| Varied (.80) | **.805** | 76,152 | .799 · .812 | .806 (.798–.812) | .789 Dual … .829 Grid T3 |
| Sprint (.85) | **.843** | 111,432 | .845 · .838 | .843 (.838–.846) | .834 Grid T7 … .854 Grid T3 |
| Stretch (.72) | **.722** | 65,272 | .719 · .730 | .723 (.718–.728) | .712 Dual … .765 Grid T3 (see §5) |
| Mastery (.80), uncapped maintenance | **.809** | 6,058 | .806 · .820 | .809 (.803–.819) | 100 learners at +2 logits |
| Varied / Stretch rechecks after the 6 Nov changes (150 learners) | .804 / .722 | 38,091 / 30,872 | .798 · .811 / .718 · .730 | .805 / .723 | Stretch valve 24 of 24 eligible, 0 mismatches |
| Free play (.80), blocks at the level | **.798** | 62,452 | .796 · .815 | .798 (.795–.802) | coach's Edge rung: .815 (17,929 blocks) |
| Study train / visual-search controls (.80) | .804 / .809–.810 | 22,953 / 5,421–6,684 | — | — | — |

Stretch learners also settle at .806 in Varied before Stretch opens. Mastery unit blocks (main population, 77,697
blocks) average .821 — .818 at the unit's target, .823 below it — i.e. between the controller's .80 and the unit
pass level .85: inside a unit the level runs under a cap that rises unit by unit, so there is no stationary regime
there, and the controller's settling is measured where it runs uncapped.

**Schedules, caps, gates and protocols:**

| Check | Result |
|---|---|
| Dead ends | none in any scenario: 0 empty plans, 0 throws, every rung and parameter valid, no Lab-only set; very strong (+7 logits) and very weak (−4) learners keep getting full sessions in every mode (Mastery reaches "path done" → maintenance) |
| Introduction order and gates | no violation in Varied, Sprint, Stretch or Mastery (e.g. Varied: all 300 learners got Plain, Grid T1, Transform, Equal Steps, Switch, Arithmetic; Dual 299, Stream and later tiers as their gates opened) |
| Counting rules and caps | 0 violations; counted / started sessions: Varied 9,158 / 10,939, Sprint 11,913 / 14,398 (2 a day, ≥ 3 h apart), Stretch 8,484 / 13,052 (≥ 20 h apart, ≤ 4 a week) |
| Stretch safety valve | fired for 44 learners, exactly those with two Stretch sessions in a row under .62 (all 44 from the 75 given a two-week ability drop), 0 mismatches |
| Mastery Path | 3,561 units passed, 74 "moved on" after 3 failed checks, 4,756 delayed checks (1,172 failed → corrective), 8,530 reviews; no check on the criterion day, no level above a unit cap |
| Cao (300 × 120 days) | every session started at max(1, end − 2), every block followed > 18 correct / ≥ 5 errors, ≤ one session a day; 300/300 completed six sessions; follow-ups started at session 6's level. Mean n per session 1.5, 1.8, 2.1, 2.4, 2.5, 2.7 (executive) vs 2.5, 3.1, 3.5, 3.8, 4.1, 4.3 (traditional arm): the paper's one-level gap between arms appears, at lower absolute levels than its participants reached |
| Wang (10 targets per 20 items, follow-up run) | 8,176 complete days; level constant within each day and moved by the day's accuracy: 1,890 up, 6,247 stay, **39 down**. Every day under .50 came from the quarter of learners given a two-week 2.5-logit ability drop (0 for the others; weak learners at −2 logits fell under .50 on 0.2 % of days, all at L0 where there is no lower level). With 10 of 20 targets raw accuracy equals BA, so "< .50" means below chance. Before the change (6 targets) never pressing scored .70 and the rule never fired (0 down) |
| Jaeggi | 9,516 sessions; every block followed the per-stream error rule; every session started at the last level |
| Study arms | each arm trained only its own tasks (train: no Span; control: visual search only; Lab-only: nothing; Cao arms: Transform / Plain-with-days; Wang: Equal Steps) |
| Cao arms, calibration (follow-up `cao-gap`: 150 people play both arms, truth = catalog for Plain and Transform) | traditional above executive by 0.79, 0.84, 0.93, 0.96, 0.95, 0.98 n in sessions 1–6 (mean n 1.9 → 3.4 executive, 2.7 → 4.3 traditional): the paper's ≈ one-level gap. Absolute levels depend on the simulated learning rate and are not compared |
| Visual-search control, 18-step ladder (follow-up) | blocks after a learner first reached the top: 1.5–12 % (old 12-step ladder: 57–72 %); final level median 40 items · 3 s (step 11 of 18), 90th percentile 56 items · 2 s (step 16); 9, 17 and 22 of 100 learners touched step 18 within 60 days in the Wang, default and Cao templates (5, 13 and 20 search blocks a session). Controls settle at .799–.802 |

**Learner model** (y = max(0, 2·BA − 1) per block): RMSE .19–.22, mean residual +.010 to +.014 (slightly
pessimistic), first block on a new version |error| .16–.22. **derive**: 7.7 ms median for 5,000 blocks
(14.4 ms for 10,000) on this machine; 8.7 ms when the blocks arrive unsorted.

## 4. What the simulations changed

No controller constant was changed: with SPEC §6's thresholds and self-correction every mode settles inside
±.03 of its target. The runs found these problems, now fixed:

1. **Voided blocks counted as valid in stored-block checks.** A block's `voidedRatio` sits on the BlockRecord,
   not in its compact result, so code that re-read stored blocks treated > 20 %-voided blocks as valid. Wang's
   day logic then counted a voided 5th block as the day's last and never moved the level (48 errors in 560
   simulated days); the Cao/Jaeggi checks showed the same. Fix: `HF.controller.blockBad(block)` used wherever
   stored blocks are judged, and `voidedRatio` copied into the compact result.
2. **A version introduced in the random phase could go unplayed.** In random-order sessions a newly introduced
   version could draw no block (or the session was abandoned first) and then appear after a later version
   (Stretch run: Dual played before Arithmetic). Fix: in the random phase a version introduced that session takes
   the task's warm-up and first rated block; the order check now uses the `track-intro` events.
3. **Learner-model weights** (deviation from SPEC §6 as written, see engine-notes §5). Varied, 60 learners each:

   | weights (general/task/family/structure/track) | RMSE of y | first block on a new version, abs. error | level-equivalent vs true 80 % rung |
   |---|---|---|---|
   | research/03: .2 / .35 / .5 / .5 / 1 | .213 | .184 | 0.96 rungs |
   | SPEC literal: 1 / .5 / .5 / .35 / .2 | .217 | .184 | 1.00 rungs |
   | research/03, version-specific skills (general SD .3, version SD .8) | .217 | .194 | 0.99 rungs |
   | SPEC literal, version-specific skills | .224 | .204 | 1.12 rungs |

   Controller behaviour is the same either way (settled BA .806 vs .804); prediction is better with research/03's
   order, clearly so when skills are version-specific, so the engine keeps it.

4. **Follow-ups of 6 Nov (orchestrator; SPEC amended):** Wang's BlockPlans pass `targets: 10`; visual search has
   18 steps up to 64 symbols (difficulty −2.5 + 1.6 per doubling of the display + 0.25 for the 2 s window);
   `lureCount` now means position lures on every n-back version at every n (the generator adds the
   version-specific ones); Transform's "two after" / "one before" variants add 0.25 logits. Transform (days, +1)
   already sat exactly one n above Plain in the catalog; the earlier Cao arms differed by 1.4–1.5 n only because
   the simulated population's truth for these two tracks is deliberately off the catalog (+1.44 logits at rung 4),
   so the calibration run ties the truth to the catalog for them.

5. **Follow-ups of 6 Nov, second round (UI requests):** assisted blocks are tracked per version (Plain and the Grid
   can be assisted together, each fading on its own with `assist-faded {trackId}`); with sound off, Dual and audio
   sets are never scheduled and plans say so; plans carry one "all versions introduced" note once every available
   version is in. Re-run with 300 learners per mode, every 5th with sound off and, in Varied, every 10th starting
   with Plain + Grid T1 assisted: Varied .805, Stretch .723, Mastery (maintenance) .809, Free .798 — unchanged;
   sound-off learners (60 per mode, 105,573 blocks) never got Dual, an audio set or a Dual introduction, and every
   Varied/Stretch sound-off learner who reached session 8 saw the note; Jaeggi with sound off scheduled nothing
   (20 learners × 20 days) and said why; 30 assisted learners had 60 assisted versions, 289 assisted blocks, all 60
   faded with exactly one event each and no assisted block moved a level. The simulation found one planner bug
   here: an assisted version was still offered its (failed) lesson on its first block; it no longer is.

6. **Phase 4 (12 Nov):** the Mastery run caught a bug in the first version of the "reopened for one session" fix:
   replaying the blocks, a reopened unit stayed open until its next rated block, so its next review was ignored
   and planned again (reviews counted fell from 8,695 to 6,156 while review blocks rose). Any block of the unit from
   a session after the serving one now closes it first; reviews are back at 8,675.

Fixed outside the simulations (unit tests): Equal Steps' difficulty was not monotone (the fast half-step outweighed
the next number range); the week-goal event compared against a state in which the running session already counted.

## 5. Observations and open issues

- **Wang's down rule** (6 Nov: 10 targets per 20 items) now fires, but only on days below chance; learners who
  climb by "> .80" rarely get there (one step harder costs about .05–.10 BA), so it acts as a safety net after a
  bad patch rather than as a regular step down.
- **Relations settle slightly above target** (Varied .812 vs n-back .799): Grid tiers are played less often once a
  newer tier opens, and learners improve between visits; self-correction keeps the task inside the band. In
  Stretch one tier (T3, .765) sits above the band on its own: a tier is newest only until the next one opens,
  after which Stretch caps it at step 6, so its uncapped life is mostly the climb.
- **Mastery Path** works at about .82 inside units (main population) and at .88–.92 for strong learners who
  outrun the caps; this is the unit structure (PLAN's ".85 inside a unit"), not the controller.
- **The coach's Edge** (predicted .80) realises .815: the model is slightly pessimistic (mean residual ≈ +.01).
- **Visual-search control** (updated 12 Nov): with 40 displays a block and two shorter deadlines on top (64 symbols
  at 1.5 s and 1 s; 20 steps) 5–11 % of simulated controls touch the top within 60 days (was 9–22 % with 18 steps).
  The simulated learning rate for search is a guess (practice per block now scales with the number of displays);
  pilots should check it.
- **Cao levels:** simulated learners climb more slowly than Cao's participants (session 6 mean n ≈ 3 vs ≈ 6.7):
  that reflects the simulated learning rate; the between-arm gap (≈ one n) matches the paper.
- The settle measure leaves out a version's blocks after it first reached the top of its ladder (rebounds off a
  ceiling are biased upward, e.g. Free play's Grid T1 at 9 steps); the number left out is in each check's detail.
