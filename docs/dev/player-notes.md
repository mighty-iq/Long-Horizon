# Block player, session screen and n-back views — developer notes (P1a)

Files: `js/ui/player.js` (`HF.player`), `js/ui/session.js` (route `session`, `HF.session`), `js/tasks/nback/view.js`
(`HF.views.nback`), `css/tasks.css`, tests `tests/e2e/test_session_*.py` (+ `test_session_lib.py`), harness pages
`tests/e2e/pages/session-*`. The header comment of each file is the authoritative API; this page records the
decisions. Contracts: `docs/dev/contracts-ui.md` §1–§2, §5.

## 1. HF.player

`runBlock(blockPlan, opts)` → `{ status: 'done'|'quit'|'skipped', spec, log, result, commit: { events, block } | null,
action, attempts }` (no derived snapshot: Phase 4, the session kept one per block, ~90 KB). `runSpec(spec, viewKey,
opts)` → `{ status, spec, log, result, action, attempts }` (no commit, no debrief, no rule card by default;
`chrome: false` leaves the shell alone; `regenerate(k)` supplies the spec after a stream pause; the returned spec is
the one actually played; **`attempts`** = runs of the block, so `attempts − 1` = restarts after a stream pause with
items shown — only the last run's log is returned, so the Lab flags its pauses from this: Phase 4, CB-06). **Lab blocks** (`opts.lab`, or a spec with set `glyphsLab` / `lab`,
variant `lab`, `lab: true` or a `testId`) show no training level, tier or step anywhere (no level chip on the rule
card, the task layer or the debrief; the rule-card title never falls back to the catalog's level title). Also `countdown(root)`, `pauseOverlay(root, opts)`, `abort(reason)`, `state()`, `plainLine`,
`levelWords`, `viewKeyFor`, `keyRows`, `config`, `debug`.

Flow of one block:
1. **Spec** — `HF.tasks[taskId].gen({ trackId, rung, params, set, seed, lureCount, lureMode, protocol, targets })`
   (`targets` = Wang's 10; omitted when null).
2. **Rule card** (`HF.ui.c.ruleCard`): level chip, set name, the catalog's rule with "Press J" turned into the pad
   name ("Press Match", "Press Position / Sound"), a worked example on the tape (Plain and Transform draw real items
   with `HF.views.nback.example`; fillers are chosen so that nothing else in the strip matches at lag n — verified
   for every set, n = 1…7, steps +1/+2/−1), key rows, warm-up note, Sprint strategy card (`HF.content.strategy` when
   present, with its evidence label; built-in fallback text), Start. Start = click/tap, Space (HF.input `next`) or
   Enter; held keys (`e.repeat`) never start. **The Start gesture calls `HF.audio.unlock()` and
   `HF.timing.keepAwake(true)`** (Resume in the pause overlay does too).
3. **Task layer**: `HF.ui.shell.chrome(false)`; `.hf-play` is a fixed full-viewport layer (level chip + pause
   button on top, the view, the pads at the bottom), so the pads are always on screen without scrolling (checked
   at 360×640, 390×844, 1366×768). Phone landscape (`orientation: landscape` and `max-height: 32em`, Phase 4 PQ-12):
   the Relation Grid, Relation Stream and the search field stand at the left at full height with the rule and pads
   beside them (css/views.css); the search field keeps its 360 px minimum and the chip + pause button float at the
   top right (css/tasks.css, `.hf-play[data-view]`). Checked at 844×390. Blocks with sound check that the AudioContext runs (else: "This block needs
   sound" with Turn sound on / Skip this block).
4. **3-2-1** (1 s steps), then the runner: `view.run(ctx2)` (custom: Span) → else `spec.kind === 'stream'` →
   `HF.timing.runStream` → else `runDiscrete`; `view.runOpts` (keys, leadMs) are merged in; `view.sound` is passed
   only when the view defines it (so a silent block can never pause for 'audio'). The player wraps the view to set
   `data-i` (trial on screen) on `.hf-play` inside the same rAF as `show()`.
5. **Score** with the task's scorer, **commit** with `HF.store.mutate(r => HF.engine.commit(...).records)`, then
   `HF.store.saveTrials(sessionId, block.id, log + { seed, attempt, interrupted })` and `HF.store.flush()`.
6. **Debrief** (`HF.ui.c.debrief`) per `blockPlan.feedback`:
   - `summary` → the plain line from `result.plain` ("You caught 5 of 6 matches and pressed once when there was
     none."; Dual per stream; Grid "found … patterns"; search "spotted the T …"; Span "recalled … in the right place"),
     the block score (BA) and details behind a toggle: d′, response bias in words, near misses per stream, median
     RT, items not counted (timing), and **"the ones to look at again"** — up to 6 `result.why` texts (same scorer
     that graded). Without `summary` (Stretch off-blocks, Cao/Jaeggi, Wang): "Block done."
   - `showLevel` → "Your level ↑ 3-back, fast pace" (protocols: "Next block …"); notes for warm-ups, off-level free
     play, capped units. Wang shows nothing (the day's accuracy comes at the end). **Starting level** (Phase 4 QA):
     on a version with no rated block yet, a warm-up whose result moved the learner model's start (the block record
     keeps the old guess) and a first rated block that moves down show "Starting level: …" with no arrow and a note
     ("This warm-up set the starting level for this version." / "Your first block on this version set its starting
     level."), read from the commit's derived state; later drops still show as drops.
   - Events with `reveal: 'now'`: level-up → `celebrate: 'level'`, pb → `'best'` (skipped in Focus mode; the CSS
     drops the animation with reduced motion); tier-open / track-available / unit-passed / check-failed /
     assist-faded → one-line notices; **fatigue** → "Time for a break?" with *End session now* (action `'end'`).
   - Continue (primary, Space/Enter), extra `debriefActions`; optional auto-continue (`autoContinueMs`, the session
     uses 15 s between blocks, never on the last block, in Free play or when a notice is shown; any interaction
     stops it).

**Pause** (Escape/P, the on-screen pause button, page hidden, sound stopped): an `HF.dom.modal` overlay — End
session · How to play (the block's rule and keys, a tip from `HF.content.howto.forTrack`, then *Back to the pause
menu*) · **Resume** (primary, focused). The overlay opens on the next task (`setTimeout 0`): a `<dialog>` shown while
the Escape keydown that paused is still being handled would be cancelled at once by the browser when the key was
not prevented (e.g. during the 3-2-1, outside a running block). Escape on the overlay = Resume, except a held
Escape (auto-repeat) or one within 350 ms of opening. **Resume unlocks audio for the block** (`gesture(B)`: the
block's unlock promise is replaced, so its audio check waits for this resume; with the Start click's old promise it
checked at once, found the context still starting and asked "This block needs sound" again: Phase 4, CB-11).
Escape while *How to play* is shown goes back to the pause menu (focus on Resume), not on to the block (Phase 4,
PQ-13). **Assisted blocks** get `{ tape, highlight }`: n-back views draw the memory tape, the Relation Grid highlights
the symbols that count; the fade note names the aid ("memory tape" / "highlighting") (Phase 4, PQ-03).
**The 3-2-1 pauses when the page is hidden** (`visibilitychange` → hidden, `pagehide`), before the first run and
before a resume: HF.timing has no run to pause then, so the block would start or resume unseen (Phase 4, CB-10). The
overlay then gives the hidden reason; the pause button during a 3-2-1 passes its reason too.
- *Stream*: the run has already stopped. The partial run is committed with `interrupted: true` (its unplayed items
  voided, so nothing moves and the model is not updated). Resume → 3-2-1 → the block restarts with a **fresh
  sequence**: same BlockPlan with `seed + '/r1'` (`/r2` …) and `attempt + k`, so block ids stay unique
  (`b-<session>-<slot>-<attempt>`); the engine stores the played seed. The choices the rule card already showed
  are kept (`params.rule`, `step`, `switchRate`, `sameFeature` from the first spec: a fresh seed must not flip
  Relation Stream's Same ↔ Different), and a view with `reset(spec)` is reset in place (else re-created). A pause
  before the first item reuses the same spec. A spec run through `runSpec` without `regenerate` is regenerated from
  the spec itself with the requested lure setting `meta.lurePlan` (`lureMode` 'uncontrolled' when it is null), not
  `meta.lureCount`, which already includes the version's own lures (Phase 4, CA-08: each restart added lures).
- *Discrete*: the item in progress is voided; Resume → 3-2-1 → `HF.timing.resume()` (then the runner's own 1 s lead).
  The block is committed with `interrupted: true` (a block with any pause moves nothing) and the debrief says so.
- *Custom (Span, an `HF.timing.custom` flow)*: the player passes `ctx2.onPause` (so the view's built-in panel stays
  hidden), ignores `HF.timing.onPause` for custom flows (no double overlay), shows its overlay ("The list in progress
  will not count. Resume starts the next list") and calls `view.resume()` / `view.abort()`; the pause button calls
  `view.pause()`.
- *End session*: the run stops, the partial block is committed as interrupted, `status: 'quit'`.
- `HF.player.abort()` (screen `leave()`): stops the run, commits the partial block synchronously
  (`HF.timing.last`), resolves every pending wait with `'abort'`, restores the chrome.

**Per-response feedback** (only when `feedback.perResponse`, e.g. Sprint or the setting): `view.feedback(outcome,
key)` on each press — streams: `trial.target[stream]`, discrete: `answer === trial.answer`; lead-in presses get none;
at most one flash per 340 ms (J + K together → one flash). `css/tasks.css` overrides the "bad" ring inside
`.hf-task` to a neutral dashed `--hf-ink-3` outline (never red); "good" stays the solid green ring.

## 2. Session screen (`session`)

`plan` (params → `modeId` / `protocolIds` / `minutes`, `planId` → `opts.id`) → `beginSession` → per slot: lesson hook
(`HF.ui.lessons.needed(trackId, records)` → `run(id, box, { from: 'session' })`, skipped when the module is absent)
→ `HF.engine.prepare` → `runBlock` → … → `endSession` → summary. The session bar (`HF.ui.c.sessionBar`, warm-ups
hatched, labels grouped) and *End session* (confirm dialog) show between blocks only (`.hf-sess[data-phase]`).
Study arms and protocols come from the plan (control arm → `vs.search` → `HF.views.vsearch`).

- **Resume** (`{ resume: id }`, and a bare `#/session` after a reload): since Phase 4 (CB-14) the plan stored on the
  session record at `beginSession` (`HF.engine.resumePlan(records, id)` → `{ plan, done, session }`), so a changed
  session length, balance or sound setting cannot turn Continue into a different session. A session begun before
  that has no stored plan: re-plan with the records as they stood at the session start (blocks, sessions and events
  from then on removed; the session's own `track-intro` events too) and `opts.id = sessionId`; the planner's seeded
  choices repeat, so the slots match. Slots with a full block are skipped. When it cannot be resumed (ended,
  unknown, or an old re-plan that no longer matches) a new session starts with the note "The earlier session could
  not be continued, so a new one starts. Every block you played is kept."
- **Finished blocks** (Phase 4, CB-02): an open session has blocks left while its finished slots
  (`HF.engine.finishedSlots`: one per slot, never an interrupted attempt) are fewer than planned; Today's Continue
  card uses the same count, so paused attempts no longer hide Continue.
- **Bare route without an open session** (e.g. a reload on the summary): goes to Today (`replace`, after the render
  so the router's title/hash/focus bookkeeping finishes) and records nothing; a new session always comes with a
  parameter: Today `{ planId }`, Welcome `{ fresh: true }`, Free play `{ free }` (Phase 4, CB-05; it used to begin a
  0-block 'quit' session that showed up in History, CSV and the study export).
- **`{ free }` while the plan is not Free play** (a study participant: the planner returns the study programme for
  every request): an empty state "Free play is off during the study" instead of programme blocks under the
  Free-play title; nothing is begun (Phase 4, CB-04; Free play's own screen says the same).
- `played[]` keeps `{ slot, bp: { trackId }, res: { status }, label, index }` per block, not the whole result
  (spec, log, result, commit): the full results grew the heap by ~90 KB a block (Phase 4 QA).
- **One open session at most**: a new session first ends every open one (`endedBy: 'quit'`, `now` = its last
  block + 60 s, so minutes are not inflated). `leave()` keeps a session with played blocks open (Today offers
  Continue / End it here) and ends one without blocks; a Free-play session is ended (`'done'`) since it has no plan
  to come back to (Phase 4, PQ-05). An open Free-play session (page closed) ignores its placeholder `planned`.
- **Free play** (`{ free: { trackId, rung, pace } }`): `pace` picks the half-step of the chosen n on n-back tracks
  and Equal Steps (`HF.session.freeRung`). Debrief: *Done* (quiet) · *Change* (inline picker: version from
  `HF.coach.freeTracks`, level from `HF.coach.table` with "your level" and the expected score) · **Next block**
  (same version; follows the new level when the block was played at the level).
- `{ practice: true }`: plays the plan with `commit: false`; nothing is saved.
- **Summary**: "You played N blocks in M minutes", the final session bar, level changes from the session's block
  records (first `levelBefore` → last `levelAfter`, warm-ups left out because a new version's warm-up holds only the
  first guess; a version first played in this session that ends below that guess shows "Starting level: …", not a
  drop; Stretch "revealed now"), Wang's day accuracy (`wang-day`),
  weekly ring (`.hf-mot`), counted / week-goal / protocol-complete / stretch-valve notes, new badges
  (`derived.badgesUnseen` ∪ badge events; acknowledged with `badge-ack` events unless Focus mode hides them), the
  reflection question when `plan.reflection` (Save → `{ type: 'note', text, kind: 'reflection' }`), the next session
  in words, *Share to Discord* (`HF.ui.share.open(holder)` when present) and **Done** → `today`.

## 3. HF.views.nback

Every format of `nback-notes.md` §2: grid8/ring8 (3×3, empty centre with a fixation cross), text (letters, digits,
days, months, clock, compass), shapes and glyphs (`HF.sets.shapePath` / `glyphPath` + `glyphStyle`), Arithmetic
expressions, Switch (item inside its cell; cue word + icon, WHAT solid / WHERE dashed, shown from the item's onset
to the next item; lead-in items have no cue), Dual (grid + `HF.audio.tone(index, when)` / `clip(letter, when)`),
audio-only Plain (a sound mark lights while on). `prepare()` writes the coming item into hidden elements during the
blank; `show()`/`hide()` toggle classes only; keyboard presses echo on their pad for 120 ms. Memory tape
(`ctx.assist.tape`): n + 1 small slots, the item n back from the coming one framed (dashed), refreshed in
`prepare()`, newest slot revealed by `show()`.

## 4. Test hooks (never set by the app)

`HF.player.debug.timeScale` (shortens onMs/soaMs/windows of the played copy), `.simulate` (`'correct'` builds the
log a perfect player would produce without showing items; `'none'` never says match; streams and discrete only),
`.countdownStepMs`. Read-only: `HF.player.state()` (phase, spec, bp, trial), `HF.session.current()`, `data-i` on
`.hf-play`, `data-hf-phase` on the player root, `data-phase` on `.hf-sess`.

## 5. Tests (Chromium, one browser at a time, always closed)

`python3 tests/e2e/test_session_<name>.py` — varied (full 10-min session with real key presses + phone/dark
variants), views (every format at 390/360/1366, Transform/Arithmetic/Switch played with real keys), dual (audio
unlocked by a real click under `--autoplay-policy=document-user-activation-required`), pause (stream restart,
discrete resume, quit; phone pause button), free, protocol (Cao 20 blocks: block 1 real, 2–20 simulated; Wang with
10 targets and the day's accuracy; Jaeggi; Study control arm → visual search), resume (planId, Continue after a
reload, one open session), feedback (celebration, Focus mode, notes, fatigue, reflection, Sprint strategy card,
per-response flashes), span (custom flow: one overlay, resume, pause button, End → interrupted), srcdoc (sandboxed
preview, storage blocked), fixes (Phase 4: bare route → Today, page hidden during a 3-2-1, Resume after the sound
stopped, retained results per block, starting levels), screens (Phase 4, on the real `index.html`: Free play in a
study, Welcome's `{ fresh: true }` and its redirect once the first run is done, the Protocols texts, the storage
notices from `HF.store.status`). `python3 tests/e2e/test_session_all.py [names]` runs them in turn and writes
`out/session/summary.json`. The bot resumes a pause it did not ask for (e.g. the audio context stalling on a loaded
machine) and lists it in `unexpected_pauses`. The harness page
(`tests/e2e/pages/session-app.html`, generated) loads the manifest without the other owners' screens and skips any
script that fails `node --check`, listing it in the result's `skipped_scripts`. Screenshots:
`out/session/`.

## 6. Phase 3 integration tests (real `index.html`, one Chromium, always closed)

- `tests/e2e/test_journey.py` (~14 min): a fresh user from first launch through every screen with real keys: pop-up,
  welcome, n-back lesson, 10-minute session 1 (Grid lesson in place), Today, Progress + History trials, Settings
  (Sprint, dark, large text, after a reload), one Free play block, Export → Reset → Import (derived state identical),
  day 2 (warm-up below the level), Study for a trained user (no enrolment) and a study participant (Measure first,
  trimmed Baseline 1 and 2, draw pinned to the control arm, visual-search session). Speed hooks: timeScale 0.5,
  `--real` for real time. Output `out/phase3/journey/`.
- `tests/e2e/test_longrun.py` (~1 h, real time, no hooks): two 25-minute Varied sessions on two days and a Wang day
  with a noisy bot (~85 %); per block the phase order, the controller, ≤ 1 voided trial and the run time; across the
  run DOM nodes, heap, listeners, timers, frames and observers after a CDP-forced GC. Output `out/phase3/longrun.*`.
- `tests/e2e/test_coverage_gaps.py` (debug hooks): Stretch reveal and every-2nd-block summaries, Mastery check on fresh
  material (pass and fail paths) and a due review, sound off without Dual, the all-introduced note.
- `tests/e2e/journey_lib.py`: the Date-only clock shim (per-day init scripts set `window.__hfOffsetMs`; never
  localStorage in an init script on file://: Chromium then shows stale or empty storage after some reloads), the leak
  counters (wrappers around listeners, timers, frames, observers) and a bot / session driver shared by the three.
