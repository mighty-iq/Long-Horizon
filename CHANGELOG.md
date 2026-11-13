# Changelog

All notable changes to Long-Horizon are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 — 2026-11-13

First public release, built by and for the Chimera community on Discord
([discord.gg/chmr](https://discord.gg/chmr)): a free, open-source working memory trainer with six training
styles, the tasks of two recent papers run as closely as each paper allows, an optional Lab that measures
transfer on tests you never train, and a Study mode for community experiments with an active control.

Renamed from the working name Holdfast before release; old backups and saved progress carry over.

### What is in it

- **N-back:** Plain (grid positions, consonants, digits, days, months, clock hours, compass points, shapes,
  glyph families, tones) and Dual (position and sound as two independent streams). Items show for 500 ms, one
  every 3.0 s (2.5 s at the fast half-step); blocks of 20 + n items with 6 matches per stream; 4 lures from
  2-back (6 in Stretch); levels up to 16-back.
- **Executive n-back** (experimental): **Transform** uses Cao et al.'s 2026 task (days of the week, press for
  "the day after" the day n back), with months, clock hours, compass points and a ring of squares later;
  **Arithmetic** (compare answers, not sums) and **Switch** (a cue says whether *what* or *where* counts, up to
  9-back), each with its own lures.
- **Relations** (experimental): **Equal Steps**, Long-Horizon's name for the number-stream task of Wang, Sun & Xiao
  2025 (1-, 2- and 3-back, numbers up to 9, 19, 29 or 39); the **Relation Grid** (tiers T1 Same to T8 Five
  different, each with steps from 8.0 s to 2.0 s per grid); the **Relation Stream**.
- **Span** (opt-in, off during the 20-session programme): operation, symbol and backward complex span.
- **Six training styles** sharing one learner record: Varied (default), Sprint, Stretch, Mastery Path,
  Protocols and Free play + Coach. Protocols runs Cao 2026, Wang 2025 and Jaeggi 2008 as closely as each paper
  allows and lists Long-Horizon's choices where a paper is silent (Jaeggi used spoken consonants; Long-Horizon plays
  tones unless you choose spoken letters).
- **Levels** move on balanced accuracy per stream (the weaker stream decides), with warm-ups, fast placement,
  self-correcting thresholds that can lower the step-up bar by at most one point, a fatigue notice, and no
  change after paused or badly timed blocks. Mastery Path units pass at 87 % (n-back, Equal Steps) or 85 %
  (Relation Grid).
- **The Lab** (optional): generated, solver-checked tests that are never trained, in Part A · memory (about
  25 min) and Part B · reasoning and control (about 27 min); Standard, Minimum, Quick check and Extended
  configurations; Baseline 1 and 2, a Quick check, a Post-test and a Follow-up; near, mid and far set from each
  person's training; change verdicts only after community calibration (at least 50 people); no IQ scores.
- **Study mode:** templates "Long-Horizon study (20 sessions)", "Cao et al. 2026 replication (6 sessions)" and
  "Wang et al. 2025 replication (30 days)"; an adaptive visual-search active control whose sessions take about
  as long as training; consent, expectation and blinding questions; commitment and coordinator codes.
- **Analysis tools** (`tools/analysis/`, Python): one study template per run (templates are never pooled), a
  fixed outcome plan per template (Long-Horizon study: near, mid and far composites; Cao: complex span, executive vs
  traditional; Wang: matrices), near composites from trained paradigms only, ANCOVA, Holm correction across
  whole families, equivalence tests, Bayes factors, a SHA-256 fingerprint and `--plan` for preregistration;
  the calibration file; synthetic exports for rehearsal.
- **Learning:** a 6-minute n-back tutorial with letters on a fading memory tape and a check block; short lessons
  before each new version (executive and Dual checks at 1-back); How to play, a glossary and strategy cards.
- **Progress, kept quiet:** nothing on screen during a block but the task; plain-language debriefs; levels,
  "Last three blocks" meters, personal bests, graphs, full history; 12 milestone badges; weekly goals instead of
  daily streaks; Focus mode; Share to Discord.
- **Platform:** runs from `index.html` on disk, from GitHub Pages (installable and offline there), as the single
  file `dist/long-horizon.html`, and inside sandboxed previews; no account, data stay on the device; export (file and
  copy box, JSON and CSV) and merging import; frame-accurate timing; tones by default and optional spoken
  letters made with Flite (see `NOTICE`); keyboard-only use, remappable keys, large touch targets, left-handed
  layout, large text, two themes, reduced motion, colour never the only cue.
- **Documentation:** this repository's `README.md`, the illustrated guide (`docs/Long-Horizon-Guide.pdf`, source in
  `docs/guide/`), developer notes in `docs/dev/`, `LICENSE` (MIT), `LICENSE-CONTENT` (CC BY-SA 4.0) and `NOTICE`.

### Fixed and changed since the 6 November release candidate

**Training and levels**
- n-back levels go up to 16-back (was 9-back), also in Cao's and Jaeggi's protocols; Switch stops at 9-back.
- Pressing on anything seen in the last few items (familiarity instead of the rule) can no longer lift a level
  after a few easy blocks, nor pass a Mastery Path n-back or Equal Steps unit (they now pass at 87 %).
- Stretch: Equal Steps blocks have 6 near misses (a step one bigger or smaller) instead of 4, so pressing whenever
  the step is roughly the same can no longer climb the Stretch ladder.
- Mastery Path: a unit that a review reopens is practised for the whole next session, not for one block.
- Span: one list of three cut short by a dropped frame no longer cancels the block's level change.
- Memory aid on the Relation Grid: assisted blocks really highlight the symbols that count, the aid fades only
  after blocks that find 7 of the 10 lines (also when a display was skipped for a timing hiccup), and the note
  when it fades names it.
- Restarted blocks of the executive n-back versions keep the planned number of lures.

**Sessions and pausing**
- Reloading on a finished session's summary goes to Today instead of starting, and recording, an empty session.
- "Continue session": a paused and replayed block counts once, and a session resumes with the blocks planned when
  it began, even after a settings change.
- Hiding the page during the 3-2-1 countdown pauses the block instead of letting it start unseen.
- After the sound stops mid-block, Resume turns it back on with the block.
- Pause menu: "End session" asks first, like the End button between blocks; Escape on "How to play" goes back to
  the menu.
- Counted sessions: the session summary says why the next session would not count (today's sessions done,
  Sprint's 3-hour gap, Stretch's 20 hours or its 4 a week), and the "extra practice" note follows the time you
  start.
- Debriefs and summaries show a new version's first placement as "Starting level", not as a drop.
- Today's preview shows the level each block will actually play, and its time estimate uses how long your own
  blocks have taken once there are a few of each version.
- Free play: leaving it through the menu ends it; the coach no longer suggests the same version twice; study
  participants see that their training follows the study programme.
- "Measure first": after Baseline 1, Today says Baseline 2 comes first and when it opens, and asks before a
  training session that would make Baseline 2 impossible.

**Lab, Study mode and analysis**
- Study mode: every programme is described in the same neutral words, and no screen says which one is the
  comparison; the visual-search programme's blocks have 40 displays (was 20), so both programmes take about the
  same time per session, and its ladder has two harder top steps (64 symbols with 1.5 s and 1.0 s).
- Study mode: after a solo draw the app shows the commitment code first and the programme once you have posted
  or noted it, and the texts say what the code can show; a coordinator's code also sets the study's schedule.
- Study mode: you can leave a study; your data stay, your study file records the date, and training follows your
  own training style again.
- Lab: verdict texts say that the noise band is measurement noise only; the retest-gain line beside a verdict
  needs a calibration estimate from at least 30 people who did not train; removing a calibration file stays
  removed.
- Lab: pauses in the n-back probe are always recorded, the screen stays awake for the whole visit, the backup
  reminder after the Post-test is no longer silenced by leaving the save step, and the Post-test study export asks
  for the same optional details as Study mode.
- Analysis: one template per run, fixed per-template outcome plans, Holm across whole families, a fingerprint and
  `--plan` (see "What is in it").

**Saving and data**
- When browser storage is full, or a newer version of Long-Horizon saved data in this browser, the app stops saving
  and says "Not saved on this device" and why, on Today and in Settings › Data (Export keeps working); a newer
  version's data are never overwritten, and a damaged save is copied aside only once.
- Saved data take less space (about a quarter less per block; blocks older than 90 days about half once storage
  gets large; levels, history and charts stay the same; Lab and Study records are never trimmed), and the app
  suggests an Export before storage fills up.
- A long session no longer keeps every block's full result in memory.
- GitHub Pages: two copies of Long-Horizon on one account no longer delete each other's offline files.
- Exports: CSV cells that start with "-" are guarded; negative numbers stay numbers.
- Reopening the welcome page after the first run (for example after an import) goes to Today.

**Screens, phones and accessibility**
- Phones held sideways: the Relation Grid, Relation Stream and visual search use the screen's height, with the rule
  and answer buttons beside them.
- Small screens (700 px tall or less): the rule card's example and keys are no longer hidden under Start.
- Touch: two thumbs on two pads at the same moment (Dual n-back) now both count.
- Charts with several lines also differ by dash pattern; the "Minutes per week" chart shows its readout again on
  hover, focus and the arrow keys.
- Contrast of the selected training style (light theme) and the Lab's next-visit row (dark theme); the Chimera
  Discord links in the footer and on the Study page are 44 px tap targets.

**Texts**
- Protocols say "as closely as the paper allows" (not "exactly"); Settings, About and "Why Long-Horizon works this
  way" state Cao's follow-up precisely (operation span score and switch cost no longer differed; letters recalled
  still favoured the executive group, p = .028, post-test and follow-up pooled), call Equal Steps Long-Horizon's name
  for Wang's number-stream task, offer Cao's follow-up after about 3 months (from day 80), and point to the
  guide's chapter 13 for the full source list.
- Rule cards name the block's buttons: visual search "Present" / "Absent", Span's sum check "True" / "False" (was
  "Right" / "Wrong"); Relation Grid examples use the symbols in play; the Relation Stream card reads "Do nothing
  until one does".
- One name, "lure", for items that almost fit the rule (the debrief details also described the executive
  versions' lures wrongly); no "missed" in the Lab or the weekly goal; "training style", never "mode"; Relation
  Grid "cells"; Free play's pace "Normal" / "Fast"; Progress gives the skill estimate in the level's unit ("step 3
  of 9") and no longer repeats tier or version names; "1 session since your last backup".

### Known limitations

- Tested in Chromium only. Firefox and Safari rely on feature detection; please report problems.
- Lab change verdicts need community calibration first (at least 50 people with both baselines); until then each
  test says "not yet calibrated".
- The visual-search control's ladder can top out: in 60-day simulations, 8 % of control learners reached its top
  step in the Long-Horizon study, 11 % in the Cao template and 3 % in the Wang template. Another step may be needed
  after pilots.
- The spoken letters have not yet been checked by ear; tones are the default.
- The timed tasks are not accessible with a screen reader (menus, results and settings are).
- Commitment codes can be decoded by anyone who reads the source; keeping the programme hidden relies on fair play.
- Executive n-back and the Relations tasks rest on small, unreplicated studies and are labelled experimental;
  thresholds and step sizes are design choices checked with simulated learners until community pilots refine them.
