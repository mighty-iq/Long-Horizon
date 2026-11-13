# Welcome, Learn, lessons and texts: developer notes (P4)

Owner: P4. Files: `js/ui/welcome.js` (route `welcome`), `js/ui/learn.js` (routes `learn`, `practice`),
`js/ui/lessons.js` (`HF.ui.lessons`), `js/content/{lessons,glossary,howto,strategy,claims,research}.js`
(`HF.content.*`, pure), `css/learn.css`, `tests/unit/content-*.test.mjs`, `tests/e2e/test_learn_*.py`.
The header comment of each file is the authoritative interface; this page explains the design.

## 1. APIs

- Routes: `welcome` (Start training now → lesson → `session`; Measure first → lesson → `labvisit { kind: 'B1' }`,
  P2's visit screen, which offers the visit length; the time shown on the card is `HF.lab.visitMinutes(settings.labConfig
  || 'standard')` rounded to 5 min), `learn` (`{}` | `{ lessonId }` | `{ page: howto | strategy | glossary | why }`; the
  research page's Lab section has an "Open the Lab" button to `lab`), `practice`.
- `HF.ui.lessons` (contracts-ui §3)
  - `needed(trackId, records?) → lessonId | null`: the track's catalog lesson unless it was passed, or failed twice
    (then the assisted path or plain training takes over), or an `assist-start` for `nback.plain` exists.
  - `run(lessonId, root, { replay?, from?, finishLabel?, onStep? }) → Promise<{ passed, assisted, quit? }>`.
    A lesson that was already passed runs as a replay: nothing is written. `quit: true` = the learner left (or the
    route changed); `error` is set only after an unexpected exception (logged, never rethrown).
  - `list() → [{ id, title, trackIds, minutes, kind, summary, passed, failed }]`; `status(lessonId)`.
  - `practice(root, { trackId, rung, set?, tape? }) → Promise<{ right, total } | { quit }>`: one self-paced block.
  - `abort()`, `active()`; `config = { usePlayer, useViews, timeScale }` (timeScale is an e2e hook for the core
    path; the player has its own `HF.player.debug.timeScale`); `_state()` for e2e; `_internal` for tests.
- `HF.content.lessons`: `LIST`, `CHECKS`, `STEPS`, `SEQ`, `MINI`, `TIERS`, `END`, `TEXT`, `get`, `forTrack`, `ids`.
- `HF.content.howto`: `INTRO`, `KEYS`, `TASKS`, `get`, `forTrack(trackId)`, `text(trackId)` (plain string, e.g. for
  a pause overlay's "How to play").
- `HF.content.strategy`: `CARDS`, `EVIDENCE`, `get(id)`, `forTrack`. Ids used by the Sprint planner:
  `nback-grouping` (Laine et al. 2018, tested) and `ri-scan` (untested).
- `HF.content.glossary`: `TERMS`, `get(id)`, `find(word)` (term or alias, case-insensitive), `ids()`.
- `HF.content.claims`: `SUMMARY` (PLAN §6 verbatim), `HEADLINE`, `CAN`, `CANNOT`, `PRIVACY`, `NOT_MEDICAL`, plus
  the aliases About reads (`intro`, `can`, `cannot`, `canTitle`, `cannotTitle`, `note`).
- `HF.content.research`: `TITLE`, `LEAD`, `SECTIONS` (body, points, table, "What Long-Horizon does"), `LIMITS`,
  `REFERENCES`. Every number comes from PLAN §1; `content-texts.test.mjs` holds the whitelist.

## 2. Events written (SPEC §3.5 shapes, via HF.store.mutate, never during a timed run)

| when | event |
|---|---|
| a check is passed (or a tier intro is acknowledged) | `lesson-passed { lessonId }` |
| a check is not passed | `lesson-failed { lessonId }` (one per failed check) |
| the second failed check of `lesson.nback` | `assist-start { trackId: 'nback.plain' }` |
| the second failed check of `lesson.grid`, if no other assist is active | `assist-start { trackId: 'rel.grid.T1' }` |
| first run finished (welcome) | profile `firstRunDone: true`, `path: 'train'|'measure'`, `updatedAt` (LWW) |

Lesson ids are exactly `HF.catalog.LESSONS`. Replays write nothing. Tutorial data are never training: no
BlockRecords, no trial logs, no `HF.engine.commit` (the player's `runSpec` forces `commit: false`). Derive turns the
assisted track's rated slots into `assist` blocks and fades them after 2 at criterion (`assist-faded`).

## 3. How a lesson runs

`STEPS[lessonId]` is a script of steps that `lessons.js` interprets: `page` (text + figure), `demo` (worked example,
stepped with Next), `guided` (self-paced), `timed`, `check`, `end`, and the task-specific `lines-demo`, `lines`
("tap the line"), `arrays`, `stream-demo`, `stream-guided`, `span-demo`, `span-guided`, `vs-guided`, `tier`.

- **Self-paced steps** use the guided runner: the item on a stage, the memory tape (`full` → `frame` → `none` per
  step schedule), a temporary No match button, "why?" prompts and "tap the item you compare with" probes (tape
  items become buttons; the right one is n back), call-outs before lures. Supports: Transform hints (the day that
  would match, under the frame), Arithmetic answers under the sums, Equal Steps steps under the numbers and the
  two 2-back jumps as arcs.
- **Feedback text comes from the scorer.** After each answer the runner scores the whole sequence with a
  press-only log of the answers so far (`HF.tasks.nback.score` / `relations.score` / `span.score` /
  `vsearch.score`) and shows the `why[]` entry of that trial; only the one-word headline ("Correct." / "Not quite.")
  is lesson text. Demos show the `why[]` of a perfect log.
- **Relation Grid / Stream arrays** in lessons, tier intros and practice are drawn with
  `HF.views.relations.renderGrid` (P1b) when it is loaded, so they look exactly like training; the target line is
  marked with its `mark` option, near-miss and changed cells get `.is-near` / `.is-changed` (learn.css); order keys
  use `symbolHTML`. Without the view (or with `config.useViews = false`) the lesson's own renderer is used.
- **Hand-built sequences** (`SEQ`) are labelled by the real kernels at run time (`HF.tasks.nback.analyze`,
  `relations.steps.judge`, `relations.grid.solve`); the unit tests check the labels equal `expect`.
- **Timed steps and checks** (`timedRun`): `HF.player.runSpec(spec, viewKey, { ruleCard: false, commit: false,
  debrief: false, score, regenerate, endLabel })` when the player and the view exist; otherwise
  `HF.timing.runStream/runDiscrete` with `HF.views[key]`; otherwise this file's own minimal view (and own span
  runner). The Start button's click/keydown runs `HF.audio.unlock()` and `HF.timing.keepAwake(true)` synchronously.
  `regenerate` keeps hand-built sequences (the player would otherwise regenerate them from the task generator)
  and gives checks a fresh seed after a pause. A stream pause in the core path offers "Start again" / "Leave".

## 4. Checks and routing

| lesson | check | pass |
|---|---|---|
| n-back basics | Plain 2-back, letters, 500/3000 ms, 20 + 2 items, 4 controlled lures | ≥ 4 of 6 hits and ≤ 2 of 14 false presses (PLAN §8) |
| Dual | 1-back, both streams, tones (or spoken letters when chosen) | the same, in each stream |
| Transform, Arithmetic, Switch | 1-back at the normal pace (days / sums / digits with a cue) | ≥ 4 of 6, ≤ 2 |
| Equal Steps | level 1 (1-back, numbers to 9), normal pace | ≥ 4 of 6, ≤ 2 |
| Relation Grid | T1 Same, step 2 (5.5 s), 20 arrays | ≥ 7 of 10 found, ≤ 2 of 10 false MATCH (PLAN §8) |
| Relation Stream | rung 0 (2 s per change), rule Same, 30 changes | ≥ 4 of 6, ≤ 3 of 24 |
| Span | Operation span, 3 lists of 2, time limit on the sums | ≥ 4 of 6 letters in place, ≥ 5 of 6 sums right |
| Visual search | 8 symbols, 3 s, 20 displays | ≥ 7 of 10 found, ≤ 2 wrong on absent displays |

A check with > 20 % voided items does not count (run it again). `assist-start` is written at most once per track (a later replay that is not passed does not restart the assisted
blocks). A failed n-back check routes to one mini-lesson
(`analyse()`): ≥ 2 keydowns outside the key map during the block → **keys**; ≥ 2 presses < 450 ms after an
unpressed match that explain at least half of the false presses → **timing**; ≥ 2 lure false alarms making up at
least half of the false presses → **window**; > 2 false presses → **nothing** ("doing nothing is an answer");
otherwise (matches slipped by) → **window**. Each mini-lesson shows the learner's own errors (scorer texts) and a
drill. After the second failed check: `assist-start`, the assisted end page, `{ passed: false, assisted: true }`.
Other lessons offer "Practise once more" (the last guided step) and a retry; after two failures training simply
goes on (it starts easy and adapts), and the lesson stays in Learn.

## 5. Decisions and deviations

1. **Letters in the n-back tutorial.** Letters make the tape and the scorer's texts easiest to read ("two back
   was C"); the end page says the same rule applies to squares, digits and shapes. Session 1 uses grid positions.
2. **Executive checks at 1-back.** PLAN §4.1 lets a lesson check open an Executive version before Plain 2-back;
   the check asks for the rule, not for 2-back capacity, so it runs at 1-back (Cao's protocol also starts there).
3. **Two extra steps in N4/N5:** a slow timed 2-back run before the check ("2-back, slowly") so the check is not
   the first timed 2-back; and "why?" prompts implemented as "tap the item you compared it with".
4. **Visual search gets a lesson** because the catalog names `lesson.vsearch` for `vs.search`; it is neutral, as
   Study mode requires.
5. **`assist-start` for the grid** is written only when no other assist is active, because derive keeps one
   `assistStart` (the latest).
6. Tutorial runs never commit; `HF.player.runSpec` is used instead of `runBlock` (the player's own header lists
   lessons as a `runSpec` use) so the lesson knows the exact spec it played and can keep hand-built sequences.

## 6. Tests

- `node tests/unit/run.mjs content-` (17 tests): lesson ids/tracks = catalog, scripts reference existing
  sequences and arrays, every hand-built sequence's labels equal the kernels', every scorable item has a scorer
  explanation, checks generate with exact counts, tier intros have examples, banned words, hash links, IQ only in
  negative claims, research numbers from PLAN §1, glossary coverage, How to play per track, strategy ids, claims.
- `python3 tests/e2e/run_learn.py` runs, one Chromium at a time: `test_learn_bot.py` (practice sanity),
  `test_learn_welcome.py` (first run, pass path, `--views` / `--own` for the fallback paths), `test_learn_fail.py`
  (two failed checks → assisted start; the four routes), `test_learn_lessons.py` (each lesson reaches its check;
  seven checks run to a pass: Dual, Transform, Equal Steps, Grid, Stream, Visual search, and Span through the
  lesson's own trial runner because the bot cannot drive P1b's keypad; tier intros; phone/dark),
  `test_learn_screens.py` (Learn, help pages, practice, welcome both choices, both themes, both sizes, srcdoc).
  Screenshots in `out/learn/`; results in `out/learn/summary.json`.
