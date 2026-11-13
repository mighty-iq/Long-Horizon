# Lab A, study machinery, Span and visual search — developer notes

Owner: lab-A agent (Phase 1). Everything here is pure JavaScript (no DOM), ES2019, MIT.
Sources: SPEC.md §4–§7, PLAN.md §4.3 and §6, research/04-transfer-lab.md §11–19.

## Files and load order

Pure modules, in this order (after `js/core/*`, the task generators and the engine):

```
js/tasks/span/gen.js, js/tasks/span/score.js
js/tasks/vsearch/gen.js, js/tasks/vsearch/score.js
js/lab/index.js                      ← must come before every js/lab/tests/*.js
js/lab/tests/nback-probe.js, rel-probe.js, sspan.js, update.js, bind.js
js/lab/tests/matrix.js, series.js, graph.js, switch.js   (lab-B agent)
js/lab/schedule.js, levels.js, compare.js, study.js, export.js
```

The probes call `HF.tasks.nback.gen` and `HF.tasks.relations.gen` only inside `gen()`, so they load without them.

## Registry (`HF.lab`)

`HF.lab.register(test)` validates and stores a test. Required: `id` ('lab.…'), `label`, `paradigm`, `minutes` (> 0),
`defaultLevel` ('near' | 'mid' | 'far'), `gen({ form, seed })`, `score(spec, log)`. Optional: `part` ('A' memory, 'B'
reasoning and control; defaults from the id), `practice({ seed })`, `rows(spec, log)` (export rows), `higherIsBetter`
(default true; a cost score sets false so composites and the UI read the direction right), `version` (default 1).

`gen({ form })` uses the fixed form seed `holdfast/lab/v1/<testId>/<form>`; `gen({ form, seed })` uses the given seed
(quick checks and extra visits pass a variant such as `…/<form>/Q1`). `defaultLevel` is the designed role for the default
programme; `HF.lab.levels(records)` gives the level for one user.

Configurations (`visitTests`): standard = n-back probe, relation probe, spatial span, updating | matrices, series, Graph
Mapping, task switching; extended = standard + binding (after updating); minimum = n-back, relation, span | matrices,
series; quick = n-back, relation. `visitMinutes`: 52 (25 + 27), 57, 36, 12 — a 1-min check-in per sitting plus a 1-min
close-out after the reasoning sitting.

Forms: four forms A–D per test from one blueprint. The order of forms over B1, B2, POST, FU is a row of a balanced 4×4
Latin square (Williams design: A B D C / B C A D / C D B A / D A C B), chosen by `cyrb128(anonId) mod 4`. Q reuses B2's
form letter with fresh sequences (variant `Q1`); extra visits rotate through the row with variant `X<n>`.

## Test specs and logs (short)

| Test | TestSpec | Log | Score |
|---|---|---|---|
| `lab.nback` | `{ kind: 'stream-set', blocks: [4 stream BlockSpecs, n = 2,3,2,3], press: 'match' }` | `{ blocks: [StreamLog ×4] }` (SPEC §4.2; optional `onsets`) | mean d′ over blocks (log-linear) |
| `lab.rel` | `{ kind: 'discrete-set', blocks: [Same (T1), Different (T3)] }`, each 20 arrays, 10 targets, rung 1 (5.5 s) | `{ blocks: [DiscreteLog ×2] }` (SPEC §4.3) | hit rate − false-alarm rate |
| `lab.sspan` | `{ kind: 'span', procLimitMs: 6000, memMs: 1000, trials: [{ setSize, pairs: [{ proc: { rows: [8×'0/1'], symmetric }, mem: cell 0–15 }] }] }` | SPEC §4.4 log (`recall` = cells) | partial-credit unit score; `sub.procAcc`, flag `proc-floor` < .80 |
| `lab.update` | `{ kind: 'update', trials: [{ load, stepMs, colours, positions, steps: [{ colour, cell }], probes: [{ colour, answer }] }] }` | `{ trials: [{ i, answers: [{ probe, response: cell, rt }], voided }] }` | proportion of colours placed (30) |
| `lab.bind` | `{ kind: 'bind', showMs: 1500, gapMs: 500, trials: [{ setSize, items: [{ cell, colour }], probes: [{ cell, answer }], options }] }` | same shape as updating (`response` = palette index) | proportion of probes right (58) |

Every TestResult: `{ testId, score, scoreLabel, sub, flags, form, seed, version }`. Flags: `interrupted` (> 10 % of
items voided, or paused), `incomplete` (a block or trial log missing), `too-fast` (n-back: ≥ 10 % of presses under
150 ms), `proc-floor` (span judgements < 80 %). Cells are row-major. Colours come from `HF.lab.PALETTE`: seven Okabe–Ito
colours, each with a pattern name (dots, stripes, checks, rings, waves, cross, zigzag) that the view must draw too.

Blueprints: span set sizes 2,2,2,3,3,3,4,4,4,5,5,5 (42 judgements, exactly 21 symmetric); updating positions per colour
[2,3] [3,3] [3,4] [2,2,3] [2,3,3] [3,3,3] [2,3,4] [2,2,2,3] [2,2,3,3] [2,3,3,3] (30 colours, 81 appearances, 2.0/2.4/2.8 s
by load + 0.5 s gap); binding set sizes 2,2,3,3,3,4,4,4,5,5,5,6,6,6 (58 probes). Forms shuffle the order and the surface.

Symmetry patterns: the left half is random with 24–40 black cells in all; an asymmetric pattern takes 2–3 moves, each
turning one cell of a black mirror pair white and one cell of a white pair black. The black-cell count and its parity
are therefore identical for both kinds, so density cannot answer the question (tested).

## Schedule, levels, compare

- `schedule(records, derived, now)`: B1 → B2 (2–7 days after B1 is complete; missed once training starts) → Q (after
  session quickBefore − 1, before session quickBefore) → POST (day 1–3 after the programme's last session) → FU (days
  56–84 after POST). Default programme 20 sessions with Q before 11; Study templates: cao 6 sessions, no Q; wang 30 days,
  no Q; the Lab-only arm follows the calendar from B2 (4 sessions a week). Reasoning tests only at B1, B2, POST, FU, at most
  4 times; X visits are memory-only. `next.notToday` when a session was started today (the Lab comes first on a training
  day). Visit flags: `device-class`, `device-input`, `time-of-day` (> 3 h from the first visit, circular),
  `after-training`, `outside-window`. No-baseline path (training started before any B1): B1/B2/Q skipped, POST and FU still
  offered, extra visits any time.
- `levels(records)`: a family counts as trained with ≥ 10 blocks that are not `tutorial` or `probe`. Relation Stream
  counts with the Grid for the relation probe (same grid and line rules). Equal Steps alone → relation probe is mid with
  the note "Equal Steps has no near probe yet".
- `compare(records)`: reference B2; latest = most recent visit after B2. Calibration usable only with 0 ≤ r < 1, sd > 0
  and n ≥ 50. `band` = 1.96 · sd · √(2(1 − r)). Optional `calibration.tests[id].practice` adds a practice-adjusted RCI.
  `composites(records)` = mean z per level from calibration means and SDs.

## Study

`HF.study.draw(seed, { template, arms })` → arm, 128-bit salt, commitment = SHA-256(arm + ':' + salt) (pure JS SHA-256,
FIPS test vectors and node:crypto cross-checks in the tests). `verify` recomputes it. Coordinator codes `XXX-XXX`:
Crockford base32, 5 payload characters (version bit, template, XOR-masked arm index, 20-bit tag from the coordinator's
secret) + 1 Luhn mod-32 check character, which catches every single-character error and about 90+ % of adjacent swaps.
**The codes can be decoded by anyone who reads this source** (`decodeCode` needs no secret), so allocation concealment is
procedural only: coordinators issue a code after the participant shows a finished Baseline 2. `HF.study.limitations`
holds this text for the README and consent screen. `allocation({ seed, template, n })` gives permuted blocks (4 for two
arms, 6 for three) with codes. Expectation (B2, POST; three 0–10 items) and blinding (POST) questions are data in
`HF.study.questions`. `HF.study.state(records)` reads enrolment, draw, code and answers from events.

## Export

`HF.lab.exportBundle(records, { labLogs, now, appVersion, revealSalt, includeUA, … })` → `{ json, csv, filename }`.
`labLogs[visitId][testId] = { log, spec? }`; without `spec` the spec is regenerated from the stored form + seed. The salt
is included once a POST visit exists (or with `revealSalt`). CSV strings: `visits` (visit × test, check-in and close-out
flattened), `trials` (Lab trials, from each test's `rows`), `blocks`, `sessions`. RFC 4180 quoting and a `'` guard on cells
that start with = + @.

## Span and visual search training

Span: `span.op` letters F H J K L N P Q R S T Y, `span.sym` symbols # % & @ $ ? ! * § ¶ £ ¥, `span.back` letters recalled in
reverse. 3 trials of set size rung + 2. Exactly half of the 3 × setSize equations are true; false ones show the result
± 1 or ± 2 (half each) inside the range a true equation can show; no equation repeats in a block. A parity check alone
scores about .75, below the .85 judgement criterion. Score: recall = items in serial position / items (ba), procAcc =
right judgements / judgements (no answer = wrong). `procLimitFrom(rts)` = mean + 2.5 SD (1.5–10 s; 4 s until measured).

Visual search: ladder r 0–17 → set size 8, 12, 16, 24, 32, 40, 48, 56, 64 (two rungs each), window 3,000 ms on even
rungs and 2,000 ms on odd ones (SPEC §5 as amended). 40 displays in training blocks (20 in the lesson check), exactly half with a T among rotated Ls. Items sit on an
invisible grid over a 100 × 100 field: 8 × 8 (cell 12.5, jitter ± 2) up to 48 items, 10 × 10 (cell 10, jitter ± 1) for
56 and 64, so no grid is more than 75 % full and layouts stay irregular. Item size is 7 units at every set size, so boxes
never overlap (gap ≥ 1.5 units on the 8 × 8 grid, ≥ 1 unit on the 10 × 10 grid) and difficulty comes from the number of
items, not smaller drawings. **Legibility assumption:** the view draws the field at least 360 CSS px wide, so an item is
≥ 25 px (≈ 1° at 35 cm) with ≥ 3.6 px between items, and strokes should be ≥ 3 px (`spec.field` carries `minFieldPx`,
`itemPx`, `minGap`). Every item is rotated independently. A timeout is an error (miss on a present display, counted with
false alarms on an absent one; `extra.timeouts` splits it). The debrief names the T's row and column in the display's own
grid.

## Deviations from the brief / SPEC

- n-back probe: research/04 §19's two "press now" catch frames per block are left out (an extra frame inside a stream
  changes what "n back" means); too-fast presses and the close-out honesty item cover attention.
- n-back probe: a block where the training generator falls back (`meta.fallback`) or misses 6 targets + 4 lures is
  replaced by the block of the next derived seed (`seed/r1`, …), so all forms keep 6 targets + 4 controlled lures. An
  early version of the generator fell back on about 5 % of 2-back `glyphsLab` blocks; the current one on none of 1,000.
- Relation probe: calls `HF.tasks.relations.gen` (dispatcher by trackId) and falls back to
  `HF.tasks.relations.grid.gen` while no dispatcher exists. The tests check the real `lab` variant: 20 arrays, 10 targets
  split 5 rows / 5 columns, 5.5 s, and an independent line solver on 20,000 arrays.
- Relation probe: a timeout counts as "no target found" (Chuderski's monitoring logic); the visual-search scorer counts
  it as an error instead, because the search window is part of its difficulty ladder.
- `compare` verdict is `null` (not in the SPEC enum) when B2 exists and the test is calibrated but nothing was retested yet.
- `schedule` takes the programme length from the Study template (cao 6, wang 30) and adds the Lab-only arm's calendar.
- `HF.study.draw(seed, opts)` takes an optional `{ template, arms }`; the SPEC shows `draw(seed)` (= default template).
