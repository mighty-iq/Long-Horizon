# Everyday screens — notes (P3)

Owner: P3. Files: `js/ui/today.js` (route `today` + `HF.ui.screenKit`), `js/ui/progress.js` (routes `progress`,
`history` + `HF.ui.backup`), `js/ui/settings.js` (`settings`), `js/ui/free.js` (`free`), `js/ui/about.js`
(`about`), `js/ui/share.js` (`HF.ui.share`), `css/screens.css`, `tests/e2e/test_screens_*.py`.
All are DOM-only classic scripts (ES2019) listed in `js/manifest.json`; each registers its route(s) with
`HF.router.register` at load time and also sets `HF.ui.screens[name]`. Every `render` builds from
`HF.store.records` / `HF.store.derived`; every `leave()` drops its store subscription, `HF.input` handler,
timers and audio. Screens re-render after store changes from another tab, an import or a reset
(`screenKit.watch`), never after their own saves (so focus stays put).

## 1. Routes and what they send

| Route | Params read | Goes to |
|---|---|---|
| `today` | `noRedirect` (tests) | `welcome` (replace) while `profile.firstRunDone` is false **and** a `welcome` route exists (deferred to a microtask so the router's title/hash/focus stay right); `session { planId, protocol? }` on Start (click or Space); `session { resume: sessionId }` on Continue; `free` in Free-play mode; `settings { section: 'style' }`; `lab` |
| `progress` | `trackId` (opens that row, picks it in Graphs), `section` (`levels`, `graphs`, `week`, `badges`, `lifetime`, `backup`) | `history`, `free { trackId }` |
| `history` | `trackId` (filter), `sessionId` (opens it, period = all) | — |
| `settings` | `section` (`style`, `session`, `sound`, `keys`, `display`, `data`) | `today` after a reset |
| `free` | `trackId` (preselect) | `session { free: { trackId, rung, pace } }`; in a study (`derived.study` set and not left) no picker: "Free play is off during the study" → `today` (Phase 4, CB-04) |
| `about` | — | external link only |

`free.rung` is **final** (already the fast or standard rung); `free.pace` is `'std' | 'fast'` when that level has
both paces, else `null` (P1a's `freeRung` normalises idempotently, so both agree). `settings.freePace` remembers
the pace. `planId` lets the session re-create exactly the plan Today showed (`HF.engine.plan(…, { id: planId })`
is deterministic for the same records); `resume` asks the session screen to continue an unfinished session.

## 2. Today
- Next-session card = the one feature card: `HF.engine.plan(records, derived, { now, protocolIds? })` — never
  `beginSession`. Title "Session N" (or "Extra practice" when today's counted session is done, or the protocol's
  paper), mode and `estMinutes`, one plain sentence built from the slots (warm-ups, blocks per task, order from
  `plan.phase`, new versions, lesson, strategy tip, reflection), up to 4 level chips (versions with most blocks
  first, then "and N more versions"), the session bar of the plan, and the planner notes that help (`reflection`,
  `new-track`, `free` are hidden because the sentence already says them; `all-introduced` is shown since Phase 3,
  as PLAN §4.4 asks the app to say so — the sentence never did). With several protocols
  due, a "Protocol today" choice re-plans with `protocolIds`.
- An unfinished session (today's latest session with `endedAt` null and blocks left) replaces the card: its
  session bar (played blocks labelled), Continue, and "End it here" (`HF.engine.endSession(…, 'quit')`; it still
  counts when at least half was played — goals.js rule). "Blocks left" and "N of M blocks done" count finished
  slots only (`HF.engine.finishedSlots`: an interrupted attempt of a paused stream is not a block done; Phase 4,
  CB-02 — the attempts used to hide Continue).
- Chips and session-bar labels show what each slot will play: `HF.engine.prepare(slot, records, derived,
  { sessionId: plan.id })` (nothing saved) gives a protocol's start level, a Mastery unit's version and cap and the
  warm-up rung; the version's own level is only the fallback (Phase 4, PQ-06). Labels carry no "(warm-up)": the
  session bar adds it (PQ-08). An open Free-play session reads "Free play in progress · N blocks played" (PQ-05).
- "Measure first" between Baseline 1 and Baseline 2 (`HF.lab.schedule`: B1 done, B2 upcoming / due / overdue; Phase 4,
  PQ-02): the card says "Baseline 2 comes first" with its opening date, "Open the Lab" is the one primary action
  (Space), Start session is secondary and asks first (`HF.dom.confirm`: one counted session makes Baseline 2
  'missed' for good); the side Lab notice for B2 is then not repeated.
- "Session N" vs "Extra practice" follows `plan.counts` (computed by the planner at that moment), not
  `derived.today.canCount`, which the store caches for the day (Phase 4, CA-03: Sprint's 3 h and Stretch's 20 h
  gaps depend on the hour).
- Week card (`.hf-mot`): `weeklyRing` with gain-framed notes, `weeksMet`, and the 20-session programme bar.
- Notices: Lab visit due/overdue from `HF.lab.schedule(...).next` (B1/B2 only for people who chose "Measure first"
  or already started measuring; `notToday` says "pick another day"), backup reminder (`screenKit.backupDue`: never
  exported and ≥ 3 counted sessions, a new multiple of 5 counted sessions since the last export, or a Lab visit
  ended since then), a one-time style hint at counted sessions 3–5 in Varied (PLAN §5), and "Not saved on this
  device" when `HF.store.persistent` is false (Export opens `HF.ui.backup.openModal()`). Since Phase 4 (CA-04/CA-05)
  that notice prints `HF.store.status.message`, which names the cause (`reason` blocked · write-failed · quota ·
  newer; 'newer' adds a Reload button), and `status.nearFull` adds a "Storage nearly full" notice with
  `status.nearFullText` and Export now. The store notifies `{ source: 'status' }` when a running page switches;
  `watch()` redraws Today on every non-local event, so both appear without a reload. Settings › Data
  (`dataSection()`, owner of that part since Phase 4: P1a) shows the same message (+ Reload) and the near-full prompt
  with the size from `status.mainChars`.
- Protocols texts (Phase 4, SC-03): the style line, "Help me choose" and the protocol card say the papers are
  followed "as closely as each paper allows" (Long-Horizon's choices where a paper is silent are listed in the guide),
  never "exactly"; Jaeggi 2008 used spoken consonants, Long-Horizon plays tones unless spoken letters are chosen.

## 3. Progress and History
- Levels: one `<details>` row per open version (name, level in words, `skill ≈` = `levelEqText` = hardest rung
  the learner model predicts at ≥ .80, personal best = `pbs[id].peak`); the row opens on a zone meter
  (`zone.last` vs `zone.D/U`, Mastery qualifying) and facts. Only the most recently played row (or `params.trackId`)
  starts open, which keeps the phone page calm. Versions not open yet sit in one "N versions open later" list with
  `HF.catalog.gateText`. Span shows a one-line note while it is off; visual search appears only once played.
- Graphs (`HF.ui.c.lineChart`), x = training-session number: level after each session (step curve, units per
  family: n-back `n` with .5 = fast; Switch thirds; Equal Steps level 1–12; Grid/Stream step; Span items) and
  block score per session (scored blocks only, 3-session trend, y from 50 %); markers: training-style changes
  (`session.mode`/`protocol`), Transform rule variants (`rungParams.step`), "Tier k+1 opened" on Grid tier k.
  Then the first 15 scored blocks of the three newest versions (`track-intro` events, else `firstAt`) and minutes
  per week (Monday weeks, zeros included). Changing the version rebuilds only the Graphs section.
- Badges (`.hf-mot`): earned ones with date and a "New" chip for `badgesUnseen` (acknowledged with `badge-ack`
  events 1.2 s after the page shows, silently); the not-yet ones are listed, unannounced, behind "N not earned yet"
  (PLAN §7: unannounced until earned; never required).
- History: sessions newest first (15 per page) with filters (version, kind, period) and per block: time, chip,
  role tag, score, move ("Up", "Eases back", "Stays", "–" for warm-ups). "Trials" opens a dialog: the block is
  regenerated from its stored seed and params with `HF.tasks[task].gen` and scored with the task's own `score`
  against the saved log (`HF.store.loadTrials`), so the outcomes are the scorer's (`why[]`). Old blocks without a
  log get a plain note (trial logs are capped to the newest 60 sessions).

## 4. Backup tools (`HF.ui.backup`)
`panel({ reset })`, `openModal()`, `csvBlocks(records)`, `csvSessions(records, derived)`, `summary(importResult)`,
`confirmReset()`. Export backup = `HF.store.exportText()` (it stamps `backups.lastExportAt` through `mutate`) shown in
a copy box plus one download attempt; in a framed opaque-origin page (sandboxed preview) the message says the
download is probably blocked. CSV: one row per block / session (local date and time, counts summed over streams,
`ba_by_stream`, formula-injection guard). Import: file picker or pasted text → `HF.store.importText` → a summary
("Imported: N new records, M updated, trial details for K sessions. Nothing on this device was removed.") and the
schema guard's skipped items. Reset: `HF.dom.confirm` (danger, focus on "Keep my data") → `HF.store.reset()`.

## 5. Settings
Everything saves at once through `screenKit.setSettings` (one LWW write with a new `settings.updatedAt`, then
`HF.ui.shell.applySettings`). Six style cards (line + "Gives up"), Stretch locked until `derived.stretch.open`
with the count; "Help me choose" = PLAN §5's one question (fast → Sprint, carries over → Varied, course → Mastery,
hard → Stretch or Varied while locked, papers → Protocols, self → Free play). Protocols: three switches with the
procedure and the study's limits (at least one stays on) and Cao's version (`caoArm`). Sprint: `sprint.nback`.
Session: length 10–30 with the block estimate, weekly target 3–5 (values above the style's `targetCap` disabled),
balance presets (Span on resets to 40/35/25, off to 50/50), Span (disabled in Study mode), Dual from the start,
Grid tier 8, and the Lab configuration (`labConfig`, shown with a link: the Lab page edits it). Sound: tones / spoken letters (only if `HF.sets.available('lettersAudio')`) / off, volume (live via
`HF.audio.setVolume`), sound check, and the timing test: 16 beats scheduled on the audio clock (mapped with
`HF.audio.atPerf`), taps by pointerdown or Space/Enter on the pad; offset = −(median lag over taps 4–16 within
±375 ms), 0 when |lag| < 40 ms, rounded to 5 ms, clamped ±500 (`audioOffsetMs` is *added* to sound times in
`HF.timing`). Keys: press-to-set with conflicts offering a swap; Tab, Enter, Esc, Backspace, function and modifier
keys refused; Esc always pauses (only the second pause key changes); A/L preset; defaults; the keys object is
replaced and `HF.input.setKeys(null)` clears its cache. Display: per-response flash (style default / on / off;
locked in Stretch and Protocols), Focus mode, theme, large text, left-handed, motion (device / reduce / allow),
levels in Share. Data: storage status and `HF.ui.backup.panel({ reset: true })`.

## 6. Share (`HF.ui.share`)
`text(records?, derived?, { includeLevels?, now? })`: the name line "Training my working memory with Long-Horizon:
hold more steps, keep them straight." (`HEAD`), then "N training sessions so far · M min this week · newest badge: …",
a "Levels: …" line (up to 5 recently played versions, `fullLabel`) only when asked (default
`settings.includeLevelsInShare`), always ending "Free, built by the Chimera community on Discord:
https://discord.gg/chmr" (`LINE`; both lines from the Long-Horizon copy of 13 Nov 2026). No ids, dates or Lab scores. `open(root?)` copies at once (guarded `HF.dom.copyText`) and shows
the text in a copy box with the "Include my levels" switch and the Discord link — in a dialog, or inline in `root`
(replacing an earlier panel there).

## 7. Tests (Chromium only, one browser at a time)
`python3 tests/e2e/test_screens_all.py` runs, in order: `test_screens_common.py` (seed self-check),
`test_screens_render.py` (6 screens × desktop/phone × light/dark with three seeded weeks, a fresh "Measure first"
user, large text + Focus mode), `test_screens_settings.py`, `test_screens_today.py` and `test_screens_srcdoc.py`
(single file built to `out/screens/`, not `dist/`). Seeding plays sessions through the real engine, generators
and scorers in the page. `session` and `welcome` are replaced by recorder routes where only P3's behaviour is
tested. Console errors raised in other owners' files (or parse errors of a file that fails `node --check`) are
reported separately and do not fail these tests. Screenshots and JSON results: `out/screens/`.

## 8. Choices and open points
- Badges not yet earned are listed but collapsed (brief: "earned ones and 'not yet' ones"; PLAN §7: unannounced).
- The engine does not leave Dual or tone sets out when `sound` is `off`; the Sound hint therefore says only that
  they need sound.
- "Continue" relies on the session route honouring `resume`; "Start" sends `planId` so the session matches the
  preview. Both are additive params (contracts-ui §5 lists `free`, `protocol`, `practice`).
