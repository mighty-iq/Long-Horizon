# Lab UI and Study mode — developer notes

Owner: P2 (Phase 2). Browser-only, ES2019 classic scripts, MIT. Built on the design system (`docs/dev/design-notes.md`),
the core (`js/core/*`), the Lab registry and pure modules (`docs/dev/lab-a-notes.md`, `docs/dev/lab-items.md`) and the
UI contracts (`docs/dev/contracts-ui.md`).

## Files and routes

| File | What |
|---|---|
| `js/ui/lab.js` | route `lab` (Lab home) + `HF.ui.lab` (export panel, calibration parser, verdict texts) |
| `js/ui/labvisit.js` | route `labvisit {kind, config, part}` (visit flow) + `HF.ui.labvisit` (probe runners, `labLogs`) |
| `js/ui/study.js` | route `study` (Study mode) + `HF.ui.study` (plain texts of the templates and programmes) |
| `js/lab/views/sspan.js` | `HF.labKit` (shared kit, see below) + `HF.views['lab.sspan']` |
| `js/lab/views/{update,bind,matrix,series,graph,switch}.js` | `HF.views['lab.update' …]` |
| `css/lab.css` | everything above (tokens from `css/app.css` only) |
| `tests/e2e/test_lab_*.py` | e2e: `visit` (full Quick check, real time, also the shared driver), `minimum`, `home`, `items`, `study`, `post` |

`HF.labKit` lives in `sspan.js` because that is the first Lab view in `js/manifest.json`; every user reads it at call
time, never at load time. (If the manifest owner prefers, it can move to its own `js/lab/views/kit.js` loaded first.)

## Lab home (`lab`)

Order: plain lead → the next visit (the screen's one feature card and one primary button: Start, or Start Part B; none
while waiting) → what the Lab can and cannot tell you (no IQ; one person's change cannot show cause; for causes, a
group study) → visit length (`settings.labConfig`: Standard 52 · Minimum 36 · Quick 12 · Extended 57 min, from
`HF.lab.visitMinutes`, plus the total over the programme) → the visit plan (B1, B2, Quick check, Post, Follow-up with
status, window and one-line explanation, from `HF.lab.schedule`) → results → Study mode → noise bands (calibration) →
Lab data export. Before the first visit the claims and the length choice come before the plan; after it, below the
results.

Results: one block per level (`HF.lab.levels`: near / mid / far for this user, with each test's note and "closer to …"),
inside it one `HF.ui.c.dotPlot` per score unit (proportion 0–100 %, n-back d′, relation hits − false alarms, switch cost in
ms — lower is better). Points by visit kind (B1 ●, B2 ■, Quick/extra ▼, Post ◆, Follow-up ▲; X visits share the Quick
marker). The band (B2 ± `compare.band`) is drawn only when calibrated. Row note = verdict:
above / inside / below the noise band (with the direction for cost scores), "Not yet calibrated", "No Baseline 2 …
scores only", or "Band ready; no visit after Baseline 2 yet" (`verdict: null`). Phase 4 SC-08 (wording from the
analysis fixer): the band is measurement noise only, so "above" reads "a larger rise than measurement noise alone
explains; the usual retest gain is not subtracted"; the extra line "After subtracting the average retest gain of at
least 30 people who did not train: still above / inside / below" appears only when `compare` gives `rciPractice`
(calibration `practice` with `practiceN` ≥ 30, `HF.lab.PRACTICE_MIN_N`). Always followed by the retest caveat; when any test is uncalibrated, the typical
retest gain (≈ ¼ SD from the first to the second test, rising to about the 4th; Scharfen, Jansen & Holling 2018);
on the no-baseline path a "No baseline" notice. Composite scores (only with calibration) and an RCI explanation sit
behind "How to read these results". Data-quality notes per visit (schedule flags + own flags + short sleep + test flags)
behind a disclosure.

Calibration import: file picker or paste → `HF.ui.lab.parseCalibration(text)` (accepts `tools/analysis/calibrate.py`
output; keeps `lab.*` entries with numeric r, sd, n, plus `practice`, `practiceN`, `gain`, `provisional`; tests below
n = 50 stay "not yet calibrated" in `HF.lab.compare`) → `records.calibration = { updatedAt, version, source, tests }`
via `HF.store.mutate`. Remove with a confirm dialog: it writes the tombstone `{ updatedAt: now, removed: true, tests: {} }`
(CB-07; `null` lost last-writer-wins merges, so another tab or an older backup brought the calibration back). The Lab,
`HF.lab.compare` (no tests) and `HF.lab.exportBundle` (`scores.calibration: null`) read it as "no calibration"; the
results re-render at once.

Memory mode: when `HF.store.persistent === false` the Lab's warning prints `HF.store.status.message` (reason
`blocked` · `write-failed` · `quota` · `newer`, the last asking to reload the tab; SPEC-core "State and storage").

## Visit flow (`labvisit`)

Params `{ kind, config, part }` — defaults: the schedule's next visit; this kind's earlier config, else `quick` for Q,
else `settings.labConfig`; part `A` | `B` | null (= what is still to do, memory first). Tests already saved for this
kind are skipped (merged sittings), so "continue later" works without extra state.

1. **Device and time**: detected class (phone/tablet/desktop) and input (touch/keyboard), editable; compared with the
   first visit (first B1, else the first visit): different device class or input, start > 3 h apart (circular), trained
   earlier today, early or late for the window → notices that say the visit will be marked. The flags themselves come
   from `HF.lab.schedule` (computed, not stored).
2. **Check-in**: sleep (hours), alertness 1–5, place (quiet / some distractions / busy); at B1/B2/POST one expectation
   item 0–10 — or, for enrolled study participants at B2/POST, the three `HF.study.questions.expect` items, also saved
   as a `study-expect` event; trained-today noted from the records.
3. The **LabVisitRecord** is created now: `{ id, kind, config, form, startedAt, endedAt: null, updatedAt, part ('A', 'B',
   'AB'), device, hour, checkin, closeout: {}, tests: {}, flags: [], appVersion }` (SPEC §3.4 + `updatedAt` for merges,
   `part`, `appVersion`).
4. **Each test**: instructions (`TEST_COPY`; matrix rule types behind a disclosure) → the test's fixed `practice()` items
   with feedback (switch: practice before each of its blocks, inside the view) → "Practice again" or "Start the test" →
   the scored run with the chrome hidden (`HF.ui.shell.chrome(false)`), no feedback → `test.score(spec, log)` → saved at
   once: `rec.tests[id] = result` (+ `frame` summary, `restarts`), visit flags `paused` and `attention` (≥ 2 failed
   check items across tests), trial log via `HF.store.saveTrials(visitId, testId, { log, form, seed, spec? }, { kind: 'lab' })`
   (spec only when a block was replaced), then `HF.store.flush()` before the next screen.
5. Between tests a short break screen; after the last memory test, if reasoning tests follow: **Part B now or later**.
6. **Close-out**: effort 1–5; notes or help (yes → flag `help-used`, the name `tools/analysis` excludes); interrupted
   (yes → `interrupted-reported`); strategy checklist + optional text (warned not to type personal details); at POST,
   for study participants (not the Lab-only arm), the blinding guess → `study-blind` event. Sets `endedAt`.
7. **POST only: export step** (required): reason in plain words (browser storage can be cleared; needed for the
   Follow-up; for studies), a copy box + Download with `HF.store.exportText({ stamp: false })` (the importable backup,
   Lab trial logs included; CB-01: filling the box stamps nothing); "I have saved it" is enabled only after Copy or
   Download (or the "I saved the file" box). `HF.store.markBackup()` stamps `backups.lastExportAt` on Copy, Download or
   "I have saved it" only, so leaving the step unsaved keeps the backup reminder. Study participants (not after
   leaving the study) also get the study export panel with the study fields (`{ study: true, compact: true }`, CB-13).
8. **Done**: what this visit means (B1: Baseline 2 is the reference; Q: the "similar tasks first" gate text from
   research/04 §16 with the retest note; …), this sitting's score labels (no judgement), what is still to do, and after
   B2 for an enrolled participant without a programme: "draw your programme".

**Stop the visit** (pause dialog): finished tests stay saved; the record gets `closeout.stoppedDuring` and the flag
`stopped-early`; a later sitting that retakes that test flags its result `retake`. Leaving the route aborts any run,
destroys the view and restores the chrome.

**Wake lock (CB-15):** `HF.timing.keepAwake(true)` in the "Start the tests" click; `keepAwake(false)` on the done
screen, on an error and in `leave()`. The player releases its own session lock at the end of every `runSpec` without
a `sessionId`, so the visit asks again after each player run (`v.awake`). Custom views hold the run-level lock of
`HF.timing.custom` in addition. **Study questions** (B2/POST expectations, the blinding guess, the study export at
POST, "draw your programme" after B2) appear only while `HF.study.state(records).left` is null.

### Probes

`runNbackProbe` / `runRelProbe` run a set spec block by block with a rule card before each ("Block 2 of 4: 3-back").
When `HF.player.runSpec` and the view (`HF.views.nback` / `HF.views.relations`) exist, each block goes through
`runSpec(blockSpec, key, { root, ruleCard: false, countdown: true, feedback, lab: true, chrome: false, debrief: false,
commit: false, regenerate })`; `regenerate(k)` returns a fresh **probe** block (same 6 targets + 4 controlled lures,
seed `…/x<k>`), and the returned (played) spec replaces the block in the saved spec. Otherwise an internal fallback
runs: 3-2-1 → `HF.timing.runStream` (n-back) / `HF.timing.runDiscrete` (relations) with `HF.views.*` when present, else
two minimal built-in views (a glyph from `HF.sets.glyphPath('glyphsLab', i)` with a Match pad; a 3×3 grid of
three-square cells with a dot at the grid8 position, No/Yes pads). A paused n-back block restarts from its rule card
with a fresh probe block after "Resume"; a paused relation array is voided and the block resumes (core rule).
Through the player the restart happens inside `runSpec` (its own pause menu → Resume → `regenerate(k)`); CB-06: the
Lab counts it from `res.attempts − 1` (or, until `runSpec` passes `attempts` on, the calls of `regenerate`), adds it to
`result.restarts` and so flags the visit `paused`, as the fallback runner always did.
Practice: n-back flashes the Match pad (solid ring right, dashed ring for a press on a non-match) and summarises
hits and false presses; relations show "Right / Not quite" + the grid's own explanation
(`HF.tasks.relations.grid.explain`). `HF.ui.labvisit.testHooks = { trim: 0, engine: 'auto' }` (e2e only: `trim` keeps n
items per test and flags results `trimmed`; `engine: 'fallback'` forces the internal runner with `HF.views.*`,
`'builtin'` the internal runner with the built-in views; `HF.ui.labvisit.current().engine` says what ran).
The Lab never shows training levels: `css/lab.css` hides `.hf-chip--level` inside the visit stage as a safety net
for views/players that do not yet honour `lab: true`.

## Views (`HF.views['lab.*']`, contracts-ui §1, custom flows)

`create(root, spec, ctx) → { run(ctx2) → Promise<log>, destroy() }`; `ctx.practice` / `spec.practice === true` turns on
feedback (note: scored matrix/series/graph specs carry an ARRAY `spec.practice` of tutorial items — not a flag).
Logs match each test's scorer (`docs/dev/lab-items.md`, `docs/dev/lab-a-notes.md`) plus `paused`, `pauses`, `aborted`.

| View | Answering (keyboard / touch) | Timing |
|---|---|---|
| matrix | 1–8 or tap to choose, Enter / Space / Confirm / second tap to send | 45 s countdown (tutorial 2 min) |
| series | type, Enter / Confirm; `normalize()` refuses unreadable input with a hint; Esc pauses | 60 s countdown |
| graph | letters A–F (reading order) or tap; 1/2 choose the mark; Backspace clears; Enter / Confirm | 24 s, "5 seconds left" at 19 s |
| switch | F / J or the two fixed pads (LOW·ODD left, HIGH·EVEN right) | core `runDiscrete`, fixation 100 + blank 50 ms; cue colours `--hf-lab-cue-a/-b` (blue → sky blue in dark) |
| sspan | F / J or pads (judgement, 6 s cap); recall: tap or arrows + Space/Enter, Skip one, Undo, Done | mem 1 s frame-counted |
| update | 1–9 or tap the cell (numbers shown during questions) | steps 2.0–2.8 s + 0.5 s gap |
| bind | 1–n or tap the colour (swatch + name + pattern) | 1.5 s + 0.5 s gap |

Matrices: shapes from `shapePath(type)` with `translate(x y) rotate(rot) scale(r/45) translate(-50 -50)`, a 3 %-of-cell
stroke; patterned fills are a clipped, unrotated `userSpaceOnUse` pattern rect (patterns never turn with the shape);
B/W only via `--hf-ink`. Graph: arrows drawn rim to rim with filled heads; marks 1 = ring, 2 = square, numbers inside;
right-hand letters with a halo. Colour patches (update/bind): Okabe–Ito colour + pattern (dots, stripes, checks, rings,
waves, cross, zigzag) + name; pattern ink switches to white on the dark blue only.

### HF.labKit (in `sspan.js`)

`session()` — one run of a custom view, backed by the core custom flow `HF.timing.custom(handlers, { kind: 'lab' })`:
while it runs `HF.timing.busy` and `html[data-busy]` are set (saves, toasts and CSS motion wait; released while paused
and when `S.log()` ends the flow), the wake lock is held, and Escape/P, page hidden, pagehide and
`HF.timing.pause/resume/abort` reach the session; the core keeps the first pause start and appends later reasons.
The view adds Escape inside a text field (HF.input ignores fields) and the Pause button. On pause the trial in progress
is cancelled → `VOID`; dialog Resume / Stop the visit (Stop asks to confirm; Stop → `flow.abort('stop')`). Without
`HF.timing.custom` (or if another run is active) the session listens to the same triggers itself.
While busy, `HF.input` cancels the native Space activation of focused buttons; the kit gives it back explicitly:
`cellGrid` cells (Enter/Space → click), `waitNext()` (practice "Next": click, Enter or Space) and the frame's
`.hf-btn` action buttons (Space via HF.input 'next' → click). Option tiles handle their own keys (digits, Enter). The dialog opens on the
next task (`setTimeout 0`): opened inside the Escape keydown, the browser's own Escape "close request" would cancel the
new modal at once (seen in testing) — worth knowing for any pause overlay. `present()` —
frame-counted timed displays (onset = rAF timestamp via `HF.timing.frame()`); `runDiscrete()` — `HF.timing.runDiscrete`
with the same pause dialog (Resume → `HF.timing.resume()`, Stop → `HF.timing.abort()`); `frameUI`, `countdown`, `patch`,
`cellGrid` (roving focus, arrows, Enter/Space), `waitNext`, `keys`, `digitOf`, `letterOf`, `ensureInterval`.

**Deviation (documented in `present()`):** the stream rule "any frame gap > 2.5 intervals voids the item" is meant for
500 ms stream items. Lab displays last 1–2.8 s and an updating trial shows ~9 of them, so one 40 ms hiccup would void most
trials on ordinary laptops. A timed Lab display voids its trial when the first paint was late (> 1.5 frames), a freeze
exceeded 250 ms, or the display ran off its length by more than max(2.5 frames, 10 %). Every gap > 2.5 frames is still
counted per trial (`stalls`, and `maxGap` per display) so an analysis can apply the strict rule. Response windows of
self-paced items (matrix, series, graph, judgements, probes) are not voided by frame gaps.

## Study mode (`study`)

Always: a line that community studies are organised in the Chimera Discord (link). Not enrolled: how a study works, sample sizes in plain numbers, the three templates (`HF.study.templates`) with what
each programme does (`HF.ui.study.PLAN_TEXT`; inside the app they stay "Programme A/B/C"). Phase 4 SC-01 (PLAN §6):
everything a participant sees describes every arm the same way — one neutral activity line per arm ("Visual search:
say whether a T is among rotated Ls."), template titles with the study and its length only ("Long-Horizon study (20
sessions)"), template lines without "control", "comparison", "matched", "untrained", "no memory load" or doses; the
scientific framing stays in the guide's coordinator part. TODO(SC-02): "the same session length" (ARM_TEXT and the
chooser note) holds once the engine makes the control time-matched; the lead confirms the wording. Adults-only consent with
`HF.study.limitations` (codes decodable from the open source; nobody is blind to what they practise). Join →
`study-enrol { template, consentAt, adult: true }`. Phase 3: when the baselines can no longer be taken here (training
started before Baseline 1: schedule path `no-baseline`, or B1/B2 partial, missed or skipped) the consent block is
replaced by a note ("This browser has training already … your training here carries on"); enrolling there used to
pause training for good (plans wait for a draw after a Baseline 2 the Lab no longer offers). An enrolled participant
in that state sees the same reason instead of "Do both baselines first".
Enrolled, no programme: before B2 — "after Baseline 2"; after B2 — solo draw (optional arms by toggle; confirm dialog)
→ `study-draw { arm, salt, commitment, template, arms }` with `HF.study.draw(HF.rng.newSeed(), …)`; or a coordinator
code → `HF.study.decodeCode` (errors in plain words) → `study-code { code, template, arm }`.
Solo draw, Phase 4 SC-04: the commitment `sha256(arm:salt)` shows only that the programme followed is the one behind
the posted code; it cannot show that a draw was not repeated before posting. So the screen first shows only the code
(copy box, "Post this code in the Chimera Discord before session 1", the Discord link) and "I have posted or noted
the code" → `study-posted { commitment }` (`HF.study.state(...).postedAt`, export `study.codePostedAt`); then the
programme card. The gate is a nudge: the arm is in the records and the planner uses it from the draw on. After a
Post-test the programme shows anyway. Coordinator codes show the programme at once.
Programme set: the card, the commitment in a copy box, "Checked: the code matches your draw" (`HF.study.verify`);
after a Post-test the salt is shown (and revealed in the export by `HF.lab.exportBundle`). Missing questionnaires
(B2/POST expectations, POST blinding guess) can be answered here (`late: true`). Export:
`HF.ui.lab.exportPanel(slot, { study: true })` — JSON + four CSV tables as a copy box + Download, optional age band /
writing hand / browser details. **Leaving** (Phase 4, QA): "Leave the study" (confirm dialog, danger style, focus on
"Stay in the study") → `study-leave {}`; `HF.engine.derive` sets `study.left` and the planner follows the chosen
training style again; `HF.study.state(...).left` = the first leave after the latest enrolment (as derive). The screen
then shows "You left the study" with the date, the study file (export `study.leftAt`) and the limits only; the Lab
home's study line says so; Lab visits stop asking study questions. No re-joining from that browser. Coordinator tools
(behind a disclosure): `HF.study.allocation` → CSV of serial, code, programme.

## Tests

`python3 tests/e2e/test_lab_<name>.py` (`visit`, `minimum`, `home`, `items`, `study`, `post`, `srcdoc`, `stop`,
`player_pause` — `srcdoc` builds `dist/long-horizon.html` and runs the Lab in a sandboxed srcdoc frame; `items` covers pause
by key, by a hidden page and by Escape in a text field, and the busy flag; `stop` covers a paused stream restart and
Stop the visit; `player_pause` the same restart inside the player (CB-06) and the visit's wake lock (CB-15); `home`
also the calibration tombstone and the memory-mode message; `study` the code-first draw and leaving; `post` the
backup stamp only on saving) — Chromium only, one browser per file, always closed. Unit: `tests/unit/labui-fix.test.mjs`
(CSV guard, tombstone, study state/export for posted and leave, neutral texts, verdict wording). Outputs and screenshots in
`out/lab-ui/`. `test_lab_visit.py` holds the shared `Driver` (plays any visit with real keys and
clicks; answers come from the visible trial: a test-only wrapper of `HF.timing.runStream/runDiscrete` reads the trial
being shown, custom views are read from their DOM and the current spec, `HF.ui.labvisit.current().spec`).
Console errors raised before the Lab flows start (another module failing at boot) are reported separately in the JSON
(`boot_errors_*`); the 0-errors checks cover the Lab flows.

## Open points

- The probes use `HF.player.runSpec` / `HF.views.nback|relations` as soon as they exist; their views should hide
  training chrome (level chip "Grid T1 · step 2 of 9", tier text) when `ctx.lab` / `opts.lab` is true.
- `tools/analysis/calibrate.py` excludes `help-used`, `device-class` and `device-input` by default — the flag names
  the schedule and the visit flow write.
- After "Leave the study", `HF.lab.schedule` still takes the programme length from the study template until
  `programmeOf` ignores a left study (requested from its owner, Phase 4).
- Saves happen only between tests (`flush()` before the next screen); during a custom flow the store waits anyway.
