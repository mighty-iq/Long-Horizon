# Long-Horizon: working rules for AI sessions (and humans) on this repo

Long-Horizon is a free, open-source working memory trainer with an optional Lab, built by the Chimera community
on Discord (https://discord.gg/chmr). It runs in the browser from `index.html`, GitHub Pages or the single file
`dist/long-horizon.html`. Read this file first, then `SPEC.md` (build contract: ids, records, ladders, controller,
Lab API), `docs/dev/SPEC-core.md` (runtime, timing, storage, UI conventions) and the `docs/dev/*-notes.md` of the
area you touch. For implementation details SPEC.md wins over SPEC-core, SPEC-core over everything else; the
user-facing behaviour is described in the guide (`docs/guide/guide.html`). The design plan is `docs/dev/PLAN.md`;
the `research/0x` notes that the plan and dev notes cite were working notes and are not in this repository (the
sources are listed in the guide, chapter 13).
The working name was Holdfast (1.0.0); the code namespace `HF` (`window.HF`, `HF_*`, `hf-` classes) comes from it and stays.

## 1. Hard requirements
1. **Chimera stays promoted.** The pop-up on every launch (title "Long-Horizon", "A free working memory trainer, built by the
   Chimera community on Discord. Check it out! …", **Join us on Discord** = a real link to https://discord.gg/chmr with the URL also
   printed as text, **Start training** focused), plus the footer on Today, About, the end of the tutorial, the
   share text, the README's first line, the guide's cover and last page, and Study mode. Never remove them.
2. **Honesty.** Never claim that Long-Horizon raises IQ or makes anyone smarter. Transfer is *measured* in the Lab;
   texts claim only what the evidence supports and state the limits. Say "reached" or "passed", never
   "mastered"; "moved on" when a pool runs out. Every number in a text must match the code and the sources.
3. **No copying.** No GPL, CC BY-NC or AGPL code, texts, formats or sounds (Brain Workshop and others). No items
   from copyrighted tests (Raven, ICAR, WAIS, LSAC…). Papers are re-implemented from their method descriptions in
   our own words; quotes under 15 words, one per source. Never match spoken items against later on-screen text
   (US patent 8,408,915); independent-stream dual n-back is fine.
4. **Licences.** Code MIT (`LICENSE`); texts and guide CC BY-SA 4.0 (`LICENSE-CONTENT`); fonts only under OFL;
   audio only if generated or licence-clean, credited in `NOTICE`.

## 2. Architecture (no build step to run)
- Plain JavaScript (ES2019) as **classic scripts** on one global, `window.HF`. No ES modules, no `fetch` or XHR of
  local files, no runtime libraries, no required service worker: `file://` must keep working.
- **Pure** modules (generators, scorers, engine, Lab, content) have no DOM, use the IIFE pattern and
  `module.exports`, and load in Node 22 for tests. **DOM** modules (store, router, timing, input, audio, UI) run
  only in the browser. Each module's header comment documents what it consumes and produces.
- `js/manifest.json` is **the** load order (`css`, `pure`, `assets`, `dom`). After adding a file, run
  `node tools/sync-index.mjs` (`--check` verifies). Never hand-edit the generated blocks in `index.html`.
- **Data are event-sourced:** `records` (append-only arrays merged by id; settings/profile last-writer-wins)
  are the truth; everything else comes from `HF.engine.derive(records, now)`. Trial logs live in separate keys
  (`long-horizon.v1.trials.<sessionId>`), capped to recent sessions; Lab and Study records are never dropped.
- Generators are deterministic for given options and record their seed; if constraints cannot be met they fall
  back deterministically and say so in `spec.meta`.

## 3. Rules learned the hard way
**Sandboxed previews (srcdoc iframes).** `history.replaceState` throws and `<a href="#/…">` navigates the frame
away: routing lives in memory, the hash only mirrors it inside try/catch, one delegated listener handles
`[data-go]`. Use `<dialog>` and `HF.dom.confirm`, never `alert`/`confirm`/`prompt`. Clipboard, fullscreen and
wake lock are optional and guarded. Downloads and new tabs may be blocked: Export always has a copy box too.

**Storage.** localStorage may be blocked (opaque origin): run from memory and show "not saved here, use
Export". Keys are namespaced `long-horizon.v1.*` (all Pages sites of one GitHub account share an origin). Schema
guard and migrations on every load and import; old or damaged backups import safely. Two tabs: storage events
plus a revision counter, union by id (a two-tab data loss happened in an earlier build).

**Timing-critical stimuli.** During a block nothing else runs: no re-renders, layout reads, saves, logging or
DOM observers. `view.show/hide` only toggle prepared DOM inside rAF callbacks. Onset = the rAF timestamp of the
frame that shows the item; the next frame is logged as `shown`. Durations are counted in frames (60/120/30 Hz).
A dropped frame is never charged to the player: late or stalled trials are voided; a block with > 20 % voided
trials, or with any pause, moves nothing. Save between blocks, in idle time.

**Pause and input.** A second pause while paused keeps the first pause's start. Never leave a trial without
answer controls. Pause automatically when the page is hidden or audio stops. Keys by `event.code`, first
response per window only, key repeats ignored; touch pads act on `pointerdown`. Enter/Space/Escape and touch
always work; focus is trapped in dialogs and Escape closes only the top one.

**Audio.** Web Audio only; unlock the context in the Start click (`HF.audio.unlock()` and
`HF.timing.keepAwake(true)`). Schedule on the audio clock. Never use `speechSynthesis` in a timed stream.
Auditory RTs are "estimated"; levels never move on RT.

**Generators and scoring.** Exact target/lure/filler counts, checked on ≥ 10,000 seeds. A brute-force solver
re-derives every answer. Shortcut responders (always/never press, familiarity, pair detectors, majority vote…)
must score near chance; approximate responders must stay below the mode's step-up threshold (SPEC §4.6).
Feedback and "why?" texts come from the same scorer that grades the answer. Levels move on balanced accuracy
per stream; the weaker stream decides.

**UI.** Nothing but the task during a block. At most one primary (orange) button and one feature card per
screen. Motivation elements sit inside `.hf-mot` so Focus mode hides them; the Lab shows none. No loss framing
("missed", "failed", "streak", red for worse). Colour is never the only cue (Okabe–Ito plus shapes and labels).
Touch: "No" always on the left; `html[data-hand=left]` mirrors. Targets ≥ 44 px; never disable pinch zoom;
≤ 3 flashes per second; respect reduced motion. Keys: J match, K sound match, F no, Space continue, Esc/P pause.

**Shell and tests.** Never `pkill -f pattern` in a command whose own text contains the pattern (`pgrep -f`
matches itself). In Playwright, read state and act in one page call. Only Chromium is tested; at most 2
browsers at once on a small machine, each always closed. Long live runs find bugs short tests miss (a HUD loop
once appeared only at block 5); simulated users over 60 days find scheduler bugs unit tests miss.

## 4. Commands
```
node tests/unit/run.mjs [filter]          # unit tests (filter = part of a file name, e.g. engine- or nback-)
python3 tests/e2e/run_core.py             # core e2e: timing, index, sandboxed srcdoc, two tabs (Chromium)
python3 tests/e2e/test_<name>.py          # any other e2e file on its own
node tests/sim/run.mjs <scenario> [--n 300] [--days 60]   # simulated learners; scenario list in the file
node tests/sim/derive-perf.mjs            # derive() must stay ≤ 50 ms for 5,000 blocks
(cd tools/analysis && python3 -m unittest test_analysis -v)
node tools/sync-index.mjs [--check]       # rewrite index.html script/link blocks from js/manifest.json
node tools/build-single.mjs               # dist/long-horizon.html (everything inlined)
python3 tools/build-pdf.py                # docs/Long-Horizon-Guide.pdf from docs/guide/guide.html
```

## 5. How to work
- Change only what your task owns; record any deviation from SPEC (with the reason) at the top of the module
  and in the matching `docs/dev/*-notes.md`. Product decisions are not yours to change silently.
- Keep context small: search with grep and read line ranges instead of whole large files; delegate
  reading-heavy work, long regression runs and screenshot reviews; run long jobs in the background with output
  to files and read only the tail.
- A failing test is not yet an app bug: check the test first.
- Update `CHANGELOG.md` for user-visible changes and keep the guide and README in step with the code.

## 6. Definition of done
`node --check` on changed files · unit tests pass · generators verified (§3) · e2e play-through of the touched
screens (desktop and phone sizes, both themes, sandboxed srcdoc, storage blocked) · timing test if anything
runs during blocks (500 ms items within ± 1 frame, no long frames from app code) · simulated users if the
engine changed · an independent review for anything large · texts checked against code and sources.

## 7. Release checklist
build → `node --check` → unit tests → e2e (desktop, phone, srcdoc) → timing test → simulated users → reviews →
screenshots → README, CHANGELOG, licences, NOTICE → `node tools/build-single.mjs` → `python3 tools/build-pdf.py`
(check the PDF page by page) → zip with one top-level `long-horizon/` folder → unzip and re-run the e2e tests from
the copy.
