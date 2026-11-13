# Long-Horizon — build contract (SPEC.md)

Read in this order: `docs/dev/PLAN.md` (v3: what and why), `SPEC-core.md` (runtime, timing, storage, UI conventions — copied into this repo as `docs/dev/SPEC-core.md`), then this file (interfaces). For implementation details this file wins over SPEC-core, and SPEC-core wins over PLAN; for product decisions PLAN wins. If you must deviate, write the deviation and the reason at the top of your module and in your final report.

Repo root: this folder (`long-horizon/` in the release). Global namespace `window.HF`. ES2019. Classic scripts. MIT code.

---

## 1. Layout, load order, ownership

```
index.html                 app page (script tags generated from js/manifest.json by tools/sync-index.mjs)
css/app.css                design system + shell + screens        (design agent)
css/tasks.css              stimulus and response-pad styles        (player agent, Phase 2)
js/manifest.json           {"pure":[...], "dom":[...]} — THE load order; node tests load "pure"
js/core/                   rng, stats (done), util, schema, store, router, dom, timing, input, audio
js/content/sets.js         stimulus sets incl. procedural glyph families (n-back agent)
js/content/*.js            texts: lessons, glossary, how-to, strategy cards, claims (Phase 2)
js/tasks/nback/            gen.js, score.js (Phase 1), view.js (Phase 2)
js/tasks/relations/        steps.js, grid.js, stream.js, score.js (Phase 1), view.js (Phase 2)
js/tasks/span/             gen.js, score.js (Phase 1, lab agent), view.js (Phase 2)
js/tasks/vsearch/          gen.js, score.js (Phase 1, lab agent), view.js (Phase 2)
js/engine/                 catalog, controller, learner, modes, planner, protocols, mastery, goals, badges, coach, derive
js/lab/                    tests/*.js (gen+score per Lab test), visit.js, schedule.js, compare.js, study.js
js/ui/                     shell, chimera pop-up, components (design agent); screens + player + views (Phase 2)
js/app.js                  boot (core agent: skeleton; Phase 3: final)
assets/audio/              optional letter clips (audio spike)
tools/                     sync-index.mjs, build-single.mjs, (later) build-pdf, screenshots
tools/analysis/            Python study analysis (lab agent)
tests/unit/*.test.mjs      node tests (run: node tests/unit/run.mjs)
tests/sim/*.mjs            simulations (engine agent)
tests/e2e/*.py             Playwright, Chromium only, ≤ 2 browsers at once in the whole session
docs/dev/                  SPEC-core.md copy, notes, style guide page
```

**Ownership rule:** an agent edits only files it owns (its brief lists them). `js/manifest.json` and `tests/unit/load.mjs` are owned by me (the orchestrator): to add a module, say so in your final report with its exact path and whether it is pure or dom; for your own tests you may load your files directly with `load('js/...')` from `tests/unit/load.mjs`.

Pure modules use the IIFE pattern in SPEC-core and `module.exports`. Node 22 is available. Each pure module documents, in a header comment, the exact shapes it produces and consumes.

---

## 2. Identifiers

### 2.1 Tasks, tracks, structures
A **track** is anything with its own ladder and level. Track ids are fixed:

| trackId | task | structure | family (process) | blockKind | keys | experimental |
|---|---|---|---|---|---|---|
| `nback.plain` | nback | identity | updating | stream | match | no |
| `nback.dual` | nback | identity-dual | updating | stream | match, match2 | no |
| `nback.transform` | nback | transform | manipulation | stream | match | yes |
| `nback.arith` | nback | arith | manipulation | stream | match | yes |
| `nback.switch` | nback | switch | switching | stream | match | yes |
| `rel.steps` | relations | steps | relational | stream | match | yes |
| `rel.grid.T1` … `rel.grid.T8` | relations | grid-T1 … grid-T8 | relational | discrete | match, no | yes |
| `rel.stream` | relations | rstream | relational | stream | match | yes |
| `span.op` | span | span-forward | storage | span | match (=true), no (=false), keypad | no |
| `span.sym` | span | span-forward | storage | span | same | no |
| `span.back` | span | span-backward | storage | span | same | no |
| `vs.search` | vsearch | search | control | discrete | match (=present), no (=absent) | no |

Key names are logical: `match` (default `KeyJ`), `match2` (`KeyK`), `no` (`KeyF`); the input module maps physical keys and touch buttons to them.

### 2.2 Stimulus sets (`js/content/sets.js`, n-back agent)
`HF.sets.get(setId) → { id, kind: 'visual'|'audio'|'expr'|'number', items: [...], cyclic: bool, order: [...] (cyclic sets), label, contentFamily }`.
`contentFamily` ∈ `spatial | verbal | numeric | symbolic | audio` (used by the learner model).
Required set ids: `grid8` (the 8 outer cells of a 3×3 grid, indices 0–7 clockwise from top-left; centre cell unused), `ring8` (same cells as a cyclic order, for Transform), `letters` (8 consonants: C H K L Q R S T, shown), `digits` (1–9), `days` (Mon…Sun, cyclic), `months` (Jan…Dec, cyclic), `clock` (1–12, cyclic), `compass` (N NE E SE S SW W NW, cyclic), `shapes` (8 simple shapes), `tones` (8 pitches, audio), `lettersAudio` (only if clips exist), `glyphsA` … `glyphsH` (8 procedural glyph families × 8 glyphs, SVG path data, deterministic), `glyphsLab` (reserved for the Lab, never trained).
`HF.sets.forTrack(trackId) → [setId...]` (sets a track may use) and `HF.sets.defaultFor(trackId)`.
Glyphs: `HF.sets.glyphPath(setId, index) → SVG path string in a 0 0 100 100 viewBox`; the 8 glyphs of a family must be pairwise distinct (no rotation/mirror duplicates) and of similar visual complexity.

### 2.3 Lab test ids
`lab.nback` (n-back probe, glyphsLab), `lab.rel` (relation probe, Lab-only variant), `lab.sspan` (spatial complex span), `lab.update` (spatial memory updating), `lab.switch` (task switching), `lab.matrix` (generated 3×3 matrices), `lab.series` (number/letter series), `lab.graph` (Graph Mapping), `lab.bind` (location–colour binding, Extended only).

---

## 3. Persisted data (event-sourced)

The source of truth is a set of **records**; everything else is **derived** by `HF.engine.derive(records, now)`. This makes two-tab merges and imports safe: union records by id, then re-derive.

```js
records = {
  schema: 1, appVersion: '1.0.0', rev: 0, createdAt: <ms>, updatedAt: <ms>,
  profile:  { updatedAt, anonId, firstRunDone, path: 'train'|'measure'|null, startedAt },     // last-writer-wins (LWW)
  settings: { updatedAt, ...see §3.1 },                                                       // LWW
  calibration: { updatedAt, version, source, tests: { [labTestId]: { r, sd, mean, n[, practice, practiceN] } } } | { updatedAt, removed: true, tests: {} } | null, // LWW; the removed form is a tombstone so a merge keeps the removal (Phase 4 CB-07)
  backups:  { updatedAt, lastExportAt },                                                      // LWW
  sessions: [ SessionRecord ],     // append-only, union by id
  blocks:   [ BlockRecord ],       // append-only, union by id (summaries, kept for ever)
  labVisits:[ LabVisitRecord ],    // append-only
  events:   [ EventRecord ],       // append-only: lessons passed, overrides, goal pauses, study events, notes, badges acknowledged
}
// trial-level logs live in separate keys: long-horizon.v1.trials.<sessionId> → { sessionId, blocks: { [blockId]: TrialLog } }
```
Merge = for each array, union by `id` (identical ids are the same record; keep the one with the larger `updatedAt` if present); for LWW objects keep the larger `updatedAt`. Records are never deleted except by Reset.

### 3.1 settings (defaults)
```js
{ mode: 'varied', sessionMinutes: 25, weeklyTarget: 4, balance: { nback: 50, relations: 50, span: 0 }, spanOn: false,
  sound: 'tones', volume: 0.8, audioOffsetMs: 0,
  keys: { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' },
  perResponseFeedback: null /* null = mode default */, focusMode: false, theme: 'system', largeText: false,
  leftHanded: false, reducedMotion: null /* null = system */, protocols: { cao: true, wang: true, jaeggi: false },
  includeLevelsInShare: false, labConfig: 'standard', dual: false /* Dual chosen by the user */,
  freePace: 'std' }
```

### 3.2 SessionRecord
`{ id, startedAt, endedAt|null, dayKey: 'YYYY-MM-DD' (local), mode, protocol: null|'cao'|'wang'|'jaeggi', study: null|{template, arm}, planned: <n blocks>, completed: <n>, counted: bool, minutes, endedBy: 'done'|'quit'|'fatigue', plan?: <stored SessionPlan> }`
*Amended 12 Nov (Phase 4):* `completed` = finished slots (distinct slotIds with a block whose `interrupted` is false; interrupted attempts never count; `HF.engine.finishedSlots(blocks)`; CB-02). `plan` is stored by `beginSession` and deleted by `endSession`; `HF.engine.resumePlan(records, sessionId)` resumes from it (CB-14).

### 3.3 BlockRecord
```js
{ id, sessionId, t: <start ms>, trackId, set, role: 'warmup'|'rated'|'protocol'|'free'|'check'|'assist'|'tutorial'|'probe',
  mode, protocol: null|'cao'|'wang'|'jaeggi', unitId: null|string, seed, rung: <index>, rungParams: {...},
  levelBefore, levelAfter, moved: -2..+2, reason: string,
  result: BlockResultCompact, interrupted: bool, voidedRatio, frame: { fps, medianMs, maxMs, stalls, lowPrecision } }
```
`BlockResultCompact` = `{ ba, baMean, y, dprime, crit, streams: { [streamId]: { h, m, fa, cr, lfa, lt, rt } }, extra: {...} }` (h/m/fa/cr counts, lfa = lure false alarms, lt = lure trials, rt = median hit RT ms).
*Amended 12 Nov (Phase 4, CA-05):* commit leaves out null fields (absent = null), rounds result decimals to 4 places and omits `rungParams` when equal to `HF.catalog.params(trackId, rung)` (read `b.rungParams || HF.catalog.params(b.trackId, b.rung)`). `HF.engine.compactRecords(records, now, opts)` turns old training blocks into a minimal form (`compacted: true`, `updatedAt` bumped once; never Study, Lab, lesson or probe blocks or open sessions); the store calls it above its size threshold.

### 3.4 LabVisitRecord
`{ id, kind: 'B1'|'B2'|'Q'|'POST'|'FU'|'X', config: 'standard'|'minimum'|'quick'|'extended', form: 'A'|'B'|'C'|'D', startedAt, endedAt, device: { class: 'desktop'|'phone'|'tablet', input: 'keyboard'|'touch' }, hour, checkin: {...}, closeout: {...}, tests: { [labTestId]: TestResult } , flags: [...] }`

### 3.5 EventRecord
`{ id, t, type, ...payload }`. Types: `lesson-passed {lessonId}`, `lesson-failed {lessonId}`, `override {trackId, level}`, `goal-pause {from, to}`, `note {text}`, `study-enrol {template, consentAt}`, `study-draw {arm, salt, commitment}`, `study-code {code}`, `study-expect {when, values}`, `study-blind {guess}`, `track-intro {trackId, sessionIndex}`, `mastery-check {unitId, ba, pass}`; *added in Phase 4:* `study-posted {commitment}` (the participant confirmed the code was posted or noted before the programme was shown; SC-04) and `study-leave {}` (derived `study.left = t`; the planner then ignores the arm; records stay).

---

## 4. Generators and scorers (pure, Phase 1)

### 4.1 Common call shape
```js
HF.tasks.<task>.gen(opts) → BlockSpec
opts = { trackId, rung: <index>, params: <rung params from the catalog>, set: <setId>, seed: <string>,
         lureCount?: <int>, lureMode?: 'controlled'|'uncontrolled', protocol?: null|'cao'|'wang'|'jaeggi', lab?: bool }
HF.tasks.<task>.score(spec, log) → BlockResult
```
Generators are deterministic for a given `opts`. They must never produce an impossible block; if constraints cannot be met after a bounded number of attempts (e.g. 200), fall back deterministically and record `spec.meta.fallback`.

### 4.2 Stream BlockSpec (n-back family, Equal Steps, Relation Stream)
```js
{ kind: 'stream', task, trackId, seed, set, rung, params, onMs, soaMs,
  streams: ['main'] | ['pos', 'snd'],
  leadIn: <items before the first scorable one>,
  trials: [ { i, stim: { main: Item } | { pos: Item, snd: Item }, cue?: 'what'|'where',
              scorable: bool, target: { [stream]: bool }, lure: { [stream]: null|string } } ],
  meta: { targets: { [stream]: 6 }, lures: { [stream]: k }, rule: {...}, solverChecked: true, lurePlan: <requested lureCount 0–6>|null } }
  // lurePlan (Phase 4, CA-08): the requested count (null = uncontrolled); regenerate with { lureCount: meta.lurePlan, lureMode: meta.lurePlan == null ? 'uncontrolled' : 'controlled' }
```
Item formats (each module documents its own): `{ cell: 0..7 }`, `{ text: 'Tue' }`, `{ glyph: 'glyphsC', index: 3 }`, `{ shape: 'tri' }`, `{ tone: 0..7 }`, `{ expr: '3 + 4', value: 7 }`, `{ number: 23 }`, `{ grid: [9 strings] }` (Relation Stream full state) plus `{ changed: [cell indices] }`.

Stream log (from the player): `{ responses: [ { key: 'match'|'match2', t: <ms from block start>, trial: <window index i> } ], voided: [i...], paused: bool }` — the player assigns each response to the window [onset_i, onset_{i+1}) and keeps only the first response per key per window.

### 4.3 Discrete BlockSpec (Relation Grid arrays, visual search, most Lab tests)
`{ kind: 'discrete', task, trackId, seed, set, rung, params, windowMs, itiMs, trials: [ { i, stim: {...}, answer: 'match'|'no', meta: {...} } ] }`
Log: `{ answers: [ { i, response: 'match'|'no'|null, rt: <ms>|null, voided: bool } ], paused: bool }`.

### 4.4 Span BlockSpec
`{ kind: 'span', task: 'span', trackId, seed, set, rung, params: { setSize }, procLimitMs, trials: [ { i, setSize, pairs: [ { proc: { text: '7 − 3 = 4', correct: true }, mem: 'F' } ], recallKeypad: [12 symbols], order: 'forward'|'backward' } ] }`
Log: `{ trials: [ { i, proc: [ { resp: true|false|null, rt } ], recall: ['F', 'K', ...], voided: bool } ], paused: bool }`.

### 4.5 BlockResult (all tasks)
```js
{ trackId, kind, ba,          // value the controller uses: the MINIMUM stream BA (Span: recall proportion)
  baMean, y,                  // y = mean over streams of max(0, hitRate − faRate) — the learner-model observation, in [0,1]
  dprime, crit,               // means over streams (log-linear corrected)
  streams: { [stream]: { hits, misses, fas, crs, lureFas, lureTrials, hitRate, faRate, ba, dprime, criterion, rtMedian } },
  nScorable, nVoided, voidedRatio,
  plain: { caught, targets, falsePresses, nonTargets },   // summed over streams, for the plain-language debrief
  why: [ { i, stream, outcome: 'hit'|'miss'|'fa'|'cr'|'lure-fa', text } ],   // per-trial explanations FROM THE SAME RULE (used by tutorial feedback)
  extra: {} }                  // task-specific (span: { recall, procAcc }, protocols: { correct, errors, errorsByStream })
```
Voided trials are excluded from every count. Use `HF.stats.sdt` for rates, d′ and BA.

### 4.6 Required checks (every generator)
- Exact counts: targets, lures, fillers as specified, for at least 10,000 seeds per configuration family.
- A brute-force **solver** re-derives every trial's target status from the stimuli alone and must agree with `target`.
- **Shortcut solvers** score near chance: BA ≤ 0.60 averaged over 2,000 blocks (always-press, never-press, and the task-specific ones in PLAN §13).
- **Approximate responders** (amended 6 Nov): a familiarity responder (presses on any item seen in the last n+1) or a near-miss responder (Equal Steps: presses when the step is within ±1) still does the task, only imprecisely; with 4 lures among 14 non-targets it scores BA = (1 + 10/14)/2 ≈ .857, which is below every mode's step-up threshold (U ≥ .87; Stretch uses 6 lures → ≈ .786 < .80). Tests assert this bound (BA < U of the mode that uses that lure count) instead of ≤ .60. *Amended 12 Nov (Phase 4, CA-02):* the bound must hold for the *effective* thresholds too: self-correction may lower U by at most .01 (offsets clamped to [−.01, +.05], so U ≥ .86 > .857 and Stretch U ≥ .79 > .786), and a Mastery unit on an n-back or Equal Steps track passes at .87 (Grid units keep .85: Grid BA moves in steps of .05 and has no lure bound). `tests/unit/engine-shortcuts.test.mjs` plays a familiarity responder through the real generator, scorer and engine. *Amended 12 Nov (final check):* Equal Steps had 4 near misses in every style, so in Stretch the ±1 responder scored .857 ≥ U .80 and climbed to the top step; its near-miss count is now the generator's `lureCount` (4, Stretch 6 → .786), and engine-shortcuts plays it too. Relation Grid and Relation Stream need no change: their "all but one element fits" responders score .50 (Grid, every tier and step: matched pairs) and ≤ .58 (Stream).
- Tests in `tests/unit/<area>-*.test.mjs`; keep total runtime of your tests under 60 s.

---

## 5. Ladders (exact)

Std pace = `{ onMs: 500, soaMs: 3000 }`; fast pace = `{ onMs: 500, soaMs: 2500 }`.

- `nback.plain`, `nback.dual`, `nback.transform`, `nback.arith`: rung r = 0…31 → `n = 1 + floor(r / 2)` (up to 16-back; *amended 12 Nov, Phase 4 SC-05*: was r = 0…17, 9-back, which held back Cao's traditional arm — session-6 mean ≈ 8.4-back, SD ≈ 2.9; protocols use the same ceiling, `HF.protocols.MAX_N = 16`), pace = r odd ? fast : std. Block = `20 + n` items, `leadIn = n`, 6 targets per stream. Lures per stream: 0 if n = 1, else `lureCount` (default 4; Stretch 6) position lures at n±1 (for Transform/Arith/Switch these are rule-related), PLUS for the Executive versions their specific lures: Transform 2 identity, Arithmetic 2 look-alikes, Switch 3 uncued (amended 6 Nov). In Dual, exactly 2 of each stream's 6 targets coincide (same trial). Level label: `"3-back"` / `"3-back · fast"`.
- `nback.switch`: r = 0…26 → `n = 1 + floor(r / 3)`, sub = r mod 3: 0 → std, switch rate .25; 1 → std, .50; 2 → fast, .50. Lures: 3 uncued-feature matches + 1 cued match at n±1 (from n = 2; at n = 1: 2 uncued-feature matches only).
- `rel.steps` (Equal Steps): level L = 0…11 = (back, maxNumber): L0 (1, 9), L1 (1, 19), L2 (1, 29), L3 (1, 39), L4 (2, 9), L5 (2, 19), L6 (2, 29), L7 (2, 39), L8–L11 = 3-back with 9/19/29/39 (beyond Wang). Rung r = 0…23 → L = floor(r / 2), pace = r odd ? fast : std. Numbers 1…maxNumber. Rule (unsigned): back b → target at t iff `|x_t − x_{t−b}| = |x_{t−1} − x_{t−1−b}|`. `leadIn = b + 1`, then 20 scorable items with 6 targets and 4 near misses (`|x_t − x_{t−b}|` differs from the comparison step by exactly 1; *amended 12 Nov*: the near-miss count is `lureCount`, 4 by default and 6 in Stretch, see §4.6). Steps must be ≥ 1 (no repeated number at lag b on target trials). Wang protocol uses levels L0–L7 at std pace (rung = 2L) and `targets: 10` per 20 scorable items (10 targets, 4 near misses, 6 fillers) so that raw accuracy is symmetric and Wang's "< .50 → down" rule can fire (the paper does not report its target rate; amended 6 Nov).
- `rel.grid.T1…T8`: rung r = 0…8 = R1…R9 (PLAN §4.2 table): R1 8000 ms keep 1–4; R2 5500 keep; R3 5500 replace; R4 4500; R5 4500 + 6 duplicate distractors; R6 4500 + near-miss lines; R7 3500; R8 2750; R9 2000. Effects are cumulative (R6 has replace + distractors + near-miss). 20 arrays per block, 10 with exactly one target line. `itiMs` 100. The next tier becomes available when the current tier's level reaches r = 5 (R6). T8 is optional (only if the user turns it on, or Free play).
- `rel.stream`: r = 0…5 → `{ changeMs, cells }`: (2000, 1), (1500, 1), (1000, 1), (1000, 2), (750, 2), (750, 3). Block = 30 changes after a full initial grid; 6 target appearances; press when a target line appears (window = until the next change).
- `span.*`: r = 0…7 → setSize = r + 2. 3 trials per block. Proc limit = personal (mean + 2.5 SD of practice; default 4000 ms until measured).
- `vs.search`: r = 0…17 → size = [8, 12, 16, 24, 32, 40, 48, 56, 64][floor(r / 2)], window = r odd ? 2000 : 3000 ms; r = 18, 19 → 64 items with 1500 and 1000 ms (*amended 12 Nov, Phase 4*: with 40-display blocks more simulated controls touched the old top step in 60 days — Cao 22 → 25 %, Wang 9 → 11 % — so two shorter deadlines were added; difficulty +.25 for 2 s, then +.5 logits per halving of the window); 40 trials, half target-present (amended 6 Nov: more headroom; *amended 12 Nov, Phase 4 SC-02*: 40 instead of 20 displays, so a search block lasts about as long as a training block and the Study control is matched in time — estimated minutes per session: default 18.4 vs Varied 17.6, Cao 28.2 vs 28.4 (exec) / 30.4 (trad), Wang 7.1 vs 6.8; same block counts as before). Estimated block time = trials × (½ window + 500 ms blank).

Level-equivalent text and a `difficulty(trackId, rung)` in logits come from `HF.catalog` (engine agent), roughly 1 logit per n for n-back tracks.

---

## 6. Controller, modes, protocols (pure, engine agent)

```js
HF.controller.next({ trackId, level, result, modeId, role, sessionState, trackState }) → { levelAfter, moved, reason }
```
- Rated block: up one rung if `result.ba ≥ U`, down one if `< D`, else stay; clamp to the ladder. Span: up if recall ≥ .80 and procAcc ≥ .85 (Stretch ≥ .70), down if recall < .60.
- Mode U/D: varied .87/.73 · sprint .92/.78 (+2 rungs per up move until the first down move in this session) · stretch .80/.64 · mastery .87/.73 toward the unit target · free .87/.73, and only when the block was played at the track's current level.
- Self-correction: every 10 rated blocks on a track, mean BA vs mode target (varied .80, sprint .85, stretch .72, mastery .80, free .80): above target + .03 → U and D −.01; below target − .03 → +.01; offsets clamped to ±.05; stored per track and mode (derived from blocks). *Amended 12 Nov (Phase 4, CA-02):* clamped to [−.01, +.05], so the effective U stays above the approximate-responder bound of §4.6.
- Warm-up (first block of each task in a session): level − 2 rungs for n-back tracks, Equal Steps and the Grid; − 1 for Relation Stream, Span, visual search; never below 0. Updates the learner model, never the level.
- Placement: a track with no rated blocks starts one rung below the model's prediction for the mode target (or 0) and moves +2 rungs per up move until its first down move.
- Interrupted (any pause) or `voidedRatio > .20`: no level change and no model update (`reason: 'interrupted'`). *Amended 12 Nov (Phase 4, CA-10):* Span blocks have only 3 lists and a late frame voids a whole list, so one voided list of three is allowed (`HF.controller.voidLimit`: .34 for Span, .20 otherwise); a pause still moves nothing.
- Fatigue event: two consecutive rated blocks with BA ≤ (mean of the session's first two rated blocks) − .15.

Protocols (`js/engine/protocols.js`), each with its own controller and session plan; they ignore the mode U/D:
- **cao**: track `nback.transform` (days, +1), `lureMode: 'uncontrolled'`, std pace, rung = 2(n − 1). 20 blocks per session. After each block, over the 20 scorable items: correct (hits + correct rejections) > 18 → n + 1; errors ≥ 5 → n − 1; else stay. Session 1 starts at 1-back; each later session starts at max(1, lastEndN − 2). Six sessions, at least one calendar day apart; then "protocol complete" (may continue). Follow-up check: 10 blocks starting at session 6's start level, offered ≥ 80 days after session 6. A "traditional" arm (`nback.plain` with `days`, same rules) exists for Study mode.
- **wang**: track `rel.steps`, std pace, levels L0–L7. 5 blocks of 20 scorable items per day. After the day's 5 blocks: raw accuracy over the 100 items > .80 → L + 1; < .50 → L − 1; else stay. Feedback: only the day's accuracy after the last block. 30 days.
- **jaeggi**: track `nback.dual` (grid8 + tones or letters), `lureMode: 'uncontrolled'`, std pace, 20 blocks per session; errors per stream = misses + false alarms; fewer than 3 in both streams → n + 1; more than 5 in either → n − 1; else stay. Session 1 starts at 1-back; later sessions at the last level.

Planner:
```js
HF.planner.plan(records, derived, { now, modeId, minutes, protocolIds, study }) → SessionPlan
SessionPlan = { id, modeId, protocol, slots: [ { slotId, trackId|null (null = chosen at run time in Free play), role, taskId, set, lessonId|null, unitId|null } ], estMinutes, notes: [...] }
HF.planner.prepare(slot, records, derived, sessionState) → BlockPlan { trackId, role, rung, params, set, seed, lureCount, lureMode, ruleCard: { title, rule, keys, example } }
HF.engine.commit(records, blockPlan, spec, result, { now, sessionId, interrupted, frame }) → { records, events: [ { type: 'level-up'|'level-down'|'pb'|'badge'|'unit-passed'|'tier-open'|'track-available'|'fatigue'|'assist-faded', ... } ] }
```
- Session templates, introduction order, ramp, caps and the Mastery path: PLAN §4.4 and §5 (exact numbers there). *Amended 12 Nov (Phase 4):* a unit that a review reopens stays open for the whole next session that plays it and closes when that session ends (CA-01); Mastery unit pass = 2 of the last 3 rated unit blocks ≥ .87 on n-back and Equal Steps units, ≥ .85 on Grid units (`HF.modes.unitPassFor`, CA-02); an assisted block reaches the lesson-check bar by track (Grid 7 of 10 targets, else 4 of 6; CA-09).
- *Amended 12 Nov (Phase 4):* `SessionPlan.counts = { ok, reason: null|'day-limit'|'gap'|'week-cap', waitMs? }` is computed at plan time from `opts.now` (`HF.goals.canCountNow`; CA-03) and drives the 'not-counted' note. `estMinutes` uses the learner's median measured block duration per track (`derived.tracks[id].blockMs`, ≥ 3 finished blocks) before the catalog estimate; block counts do not depend on it. `beginSession` stores the plan on the session record (`session.plan`, removed by `endSession`); `HF.engine.resumePlan(records, sessionId) → { plan, done, session } | null` resumes an open session from it (CB-14). `session.completed` = finished slots (slots with a block that was not interrupted; CB-02). An event `study-leave {}` sets `derived.study.left` and from then on the planner ignores the arm; a `study-code` sets the template from the code (CB-03).
- `HF.engine.derive(records, now)` returns `{ tracks: { [trackId]: { level, peak, available, introduced, ratedBlocks, lastPlayedAt, offsets } }, model, counters, pbs, week: { target, count, days, paused }, badges: { [id]: earnedAt }, mastery, protocols: { cao, wang, jaeggi }, lab: { status } , sessionsCounted }` and must be fast (≤ 50 ms for 5,000 blocks).
- *Amended 12 Nov (Phase 4, CA-05):* commit stores slim BlockRecords (fields that would be null are left out, result floats rounded to 4 decimals, `rungParams` left out when equal to `HF.catalog.params(trackId, rung)`), and `HF.engine.compactRecords(records, now, { olderThanDays = 90, force, targetChars, keepDays = 7 }) → { records, compacted, savedChars }` shrinks older training blocks to what derive, Progress and History read (`compacted: true`, `updatedAt` bumped once); derive gives identical results; Study blocks, Lab records, lessons, probes and open sessions are never touched. (SPEC §3.3 needs the matching note: an absent field reads as null.)

Learner model (`js/engine/learner.js`): components track / structure / contentFamily / task / general with update weights 1 / .5 / .5 / .35 / .2 (amended 6 Nov to research/03 §6.4's order; sim RMSE .213 vs .224); prediction `ŷ = logistic(Σθ − difficulty(track, rung))`, predicted BA = .5 + .5 ŷ; update each θ += w · K · (y − ŷ), K = max(.15, 1 / (1 + .05 · nTrackBlocks)), with nTrackBlocks decayed for days off. `HF.learner.levelEquivalent(model, trackId)` → highest rung with predicted BA ≥ .80. Recomputed by replaying blocks in `derive`.

---

## 7. Lab (pure parts, lab agent) — specs in `research/04-transfer-lab.md` §11–19 and PLAN §6
```js
HF.lab.tests[labTestId] = { id, label, paradigm, minutes, defaultLevel: 'near'|'mid'|'far',
  gen({ form: 'A'|'B'|'C'|'D', seed }) → TestSpec, score(spec, log) → TestResult { score, scoreLabel, sub: {...}, flags: [...] } }
HF.lab.visitTests(config) → [labTestId]   // standard, minimum, quick, extended
HF.lab.schedule(records, derived, now) → { next: { kind, dueFrom, dueTo } | null, visits: [...], formFor(kind) }
HF.lab.levels(records) → { [labTestId]: { level, note } }       // near/mid/far per user (PLAN §6)
HF.lab.compare(records) → { [labTestId]: { b2, latest, change, rci, verdict: 'above'|'inside'|'below'|'uncalibrated'|'no-baseline' } }
HF.study = { templates, draw(seed) → { arm, salt, commitment }, verify(arm, salt, commitment), encodeCode(arm, secret), decodeCode(code) }
```
TestSpec/log formats are the lab agent's to define and document; discrete tests should reuse §4.3 where possible.

---

## 8. DOM layer (core agent, Phase 0) — summary; details in SPEC-core
- `HF.dom.el(tag, attrs, children)`, `HF.dom.modal(content, { labelledBy, initialFocus, onClose, dismissible })` on `<dialog class="hf-modal">` (body in `.hf-modal__body`), `HF.dom.toast(text)` into `#hf-toasts` (role=status), `HF.dom.confirm(text, { ok, cancel }) → Promise<bool>` (never `window.confirm`).
- `HF.router.go(route, params)`, `HF.router.register(route, screen)`, routes in memory, hash mirror in try/catch, one delegated listener for `[data-go]`.
- `HF.store.load()` (*13 Nov, rename:* first copies 1.0.0's working-name keys once when the new main key is absent; see `js/core/store.js`), `.records`, `.derived` (getter, cached), `.mutate(fn)` (apply a change to records, bump rev, schedule save, re-derive), `.flush()`, `.persistent`, `.status` (`reason`: 'blocked'|'write-failed'|'quota'|'newer', `message`, `nearFull`, `nearFullText`, `mainChars`; events `{ source: 'status' }`), `.exportText({ stamp })` (`stamp: false` leaves `backups.lastExportAt` alone), `.markBackup()`, `.importText(text) → { ok, error, added }`, `.reset()`, `.onChange(cb)`, `.saveTrials(sessionId, blockId, trialLog)`, `.loadTrials(sessionId)`.
- `HF.timing`: `measureFrameInterval() → Promise<ms>`, `frame() → Promise<ts>`, `runStream(spec, view, opts) → Promise<StreamLog>`, `runDiscrete(spec, view, opts) → Promise<DiscreteLog>`, `pause(reason)`, `resume()`, `busy`, frame statistics; `HF.input` (logical keys, touch pads, timestamps).
- `HF.audio`: `unlock()`, `tone(index, when)`, `clip(id, when)`, `now()`, `latency()`, `soundCheck()`.
- View contract used by the runners: `view.show(trial)` and `view.hide(trial)` are called inside rAF callbacks and must only toggle prepared DOM (no layout reads, no allocations beyond trivial); `view.prepare(trial)` is called during the previous item's blank interval.

---

## 9. Definition of done for a Phase 1 module
1. `node --check` passes; loads in node with no DOM.
2. Header comment documents inputs and outputs.
3. Unit tests in `tests/unit/` pass (`node tests/unit/run.mjs <prefix>`), including §4.6 checks.
4. No GPL/BY-NC/AGPL code; no copyrighted test items; paper rules implemented from their descriptions.
5. Final report (≤ 40 lines): files, exported API, deviations from this SPEC with reasons, test results, open issues, and the manifest entries to add.
