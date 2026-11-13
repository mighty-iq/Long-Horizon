# Relations family — developer notes

Generators and scorer for **Equal Steps** (`rel.steps`), **Relation Grid** (`rel.grid.T1`–`T8`) and **Relation Stream** (`rel.stream`). Every module is pure: no DOM, no timers, and the output is fixed by `opts`. Each file's header comment is the contract; this page explains the design choices and the measured numbers.

## Files and API

| File | Exports (on `HF.tasks.relations`) |
|---|---|
| `js/tasks/relations/steps.js` | `steps = { gen, params, judge, explain, verify, label, LEVELS }` |
| `js/tasks/relations/grid.js` | `grid = { gen, solve, explain, params, tierOf, content, LINES, VARIANTS, FILLS, RUNGS, TIERS, TN }` |
| `js/tasks/relations/stream.js` | `stream = { gen, solve, explain, judge, nearChange, RUNGS, LINES }` (needs grid.js) |
| `js/tasks/relations/score.js` | `gen(opts)` (dispatch on `trackId`), `score(spec, log)` (dispatch on `spec.kind`) |

Load order is `steps → grid → stream → score`, as already listed in `js/manifest.json`. The dispatcher lives in `score.js`, so all four files must be loaded.

## Equal Steps (Wang et al. 2025)

- **Rule:** the unsigned step is `s_t = |x_t − x_(t−b)|`, and item t is a target iff `s_t = s_(t−1) ≥ 1`. Only this reading fits every tick in Wang's Fig. 1C (3, 6, 9, 8, 7: at 2-back, 7 is ✓ because |7 − 9| = |8 − 6|); see research/09 §3.2. A unit test checks the worked example.
- **Ladder:** rung r → level L = ⌊r/2⌋, odd rungs fast. L0–3 are 1-back up to 9/19/29/39, L4–7 2-back, L8–11 3-back. A block has a lead-in of b + 1 numbers, then 20 scorable numbers with exactly T targets and exactly N near misses (|s_t − s_(t−1)| = 1; N = `opts.lureCount`, 0–6, default 4 — the planner passes 6 in Stretch, amended 12 Nov). No number ever repeats at lag b, so a step of 0 never occurs. `params.nearMisses`, `meta.lures.main`, `meta.lureCount` and `meta.lurePlan` record N.
- **Targets per block:** `opts.targets` (1–(20 − N), default 6) sets T. The Wang protocol passes `targets: 10`: 10 targets, 4 near misses, 6 fillers. Raw accuracy is then symmetric (always-press and never-press both score .50), so Wang's "< .50 → down" rule can fire. The paper does not report its target rate (SPEC §5, amended 6 Nov). `params.targets` and `meta.targets.main` record T.
- **Construction:** a step plan first, then the numbers.
  - Steps are uniform on 1…K with K = ⌊(M − 1)/2⌋, so every step fits from any number. A target copies the previous step, a near miss is ±1, and a filler is at least 2 away.
  - At 2- and 3-back, the b interleaved chains are independent walks.
  - At 1-back, a small dynamic programme picks directions. Targets continue the progression. A target "returns" (6, 9, 6) only where the plan cannot be realised otherwise. With 6 targets that is about 0.5 per block, never more than one. With more than 8 targets the budget is two returns (about 1.4 per block at 10 targets, where runs of equal steps are frequent); a budget of one would push the small-step responder to .598 at L0. Near misses keep the direction, and fillers keep it with p = .95.
- **Wang protocol:** `protocol: 'wang'` uses the same generator and is recorded in `meta.protocol`.
- **Shortcuts** (BA, 2,000 blocks per level and target count; the test asserts ≤ .60):

| responder | 1-back, 6 targets | 1-back, 10 targets | 2-/3-back, 6 or 10 targets |
|---|---|---|---|
| always / never | .500 | .500 | .500 |
| small step (lag-b step ≤ 2) | .503–.537 | .505–.555 | .497–.502 |
| small neighbouring step ≤ 2 | .503–.537 | .505–.555 | .500–.505 |
| familiarity (number seen in the last b + 1) | .539–.548 | .566–.579 | .497–.508 |
| 1-back rule applied at 2/3-back | — | — | .497–.502 |
| within ±1 of the previous step | **.857** | **.800** | .857 / .800 |
| same direction as the last move | .723–.731 | .708–.719 | ≈ .50 |

  With 10 targets, raw accuracy is .50 for always-press and never-press, and .80 for the ±1 responder (Wang moves up only on > .80).

- **±1 responder** (an approximate responder in SPEC §4.6 as amended): it presses on exactly the T targets plus the N near misses, so its BA is (1 + (20 − T − N)/(20 − T))/2 in every block by construction: .857 with 6 targets and 4 near misses (below U .87), .786 with 6 and 6 (Stretch, below its U .80 and the .79 self-correction may set; 12 Nov final check — with 4 near misses it scored .857 there and climbed) and .800 with 10 and 4. Its raw accuracy is .80 with 4 near misses. It is not a shortcut around the comparison; it is a low-precision version of the rule, and the near misses cost it exactly those 4 false alarms. Reaching ≤ .60 with 6 targets would need at least 12 near misses among the 14 non-targets. The test asserts the exact values per block.
- **Inherent 1-back cue:** at 1-back, an unsigned target either continues a progression or returns to the number two back. A return is always a target, so it cannot be used as a lure. Direction alone therefore scores about .73. That is below every mode's up-threshold (Stretch .80), so the cue cannot carry anyone up the ladder; near misses and fillers that keep the direction are its lures. The test guards it at ≤ .80.

## Relation Grid

- **Tiers:** T1 Same; T2 Ascending (rows left→right, columns top→bottom, strict); T3 Different; T4 Same or Different (one per block, from the seed) on rows, columns and diagonals; T5 five-same; T6 two features; T7 4×4 Same or Different; T8 five-different. `params.rule` overrides the rule for T4/T7, and `params.sameFeature` for T6.
- **Five-cell shapes**, cells 0–8 row-major. These are Chuderski 2014's "cross, or a T in any of four rotations" (research/02 §2.4, §7.1).

| id | cells | shape |
|---|---|---|
| `plus` | 1 3 4 5 7 | centre and its 4 neighbours |
| `T-top` | 0 1 2 4 7 | top row + middle column |
| `T-bottom` | 6 7 8 4 1 | bottom row + middle column |
| `T-left` | 0 3 6 4 5 | left column + middle row |
| `T-right` | 2 5 8 4 3 | right column + middle row |

- **Target lines per block:** rows and columns 5 + 5 (Li & Birney); T4 rows 4, columns 4, diagonals 2; T5/T8 plus 2 and T shapes 8.
- **Pressure steps** (cumulative):
  - R1 8 s and R2 5.5 s keep 1–4 strings: identical strings in the same cells, never all cells of the new target line.
  - From R3 every string is replaced.
  - From R5, 6 duplicate distractors: one of the array's relevant symbols appears exactly 6 times in irrelevant positions, and no other irrelevant symbol appears more than twice. Without distractors, no irrelevant symbol appears more than 3 times in a 3×3 grid.
  - From R6, more near-miss lines.
- **Near-miss line** ("all but one element fits"): Same — exactly one cell differs; Different — exactly one repeat; Ascending — two of the three order relations hold; T6 — exactly one of the two relations holds.
- **tn** = target-or-near lines per array. Allowed values, R1–R5 / R6–R9:

| set | Same | Different |
|---|---|---|
| rows/columns | {1} / {2,3} | {4,5} / {6} |
| + diagonals | {1} / {2,3} | {6,7} / {8} |
| five-cell shapes | {1} / {2,3} | {1,2} / {3,4} |
| 4×4 | {1} / {2,3} | {3,4,5} / {7,8} |

  - Ascending: {1,2} / {3,4}. T6: same-feature lines 1 / 2–3 and different-feature lines 1–2 / 2–3.
  - For Different, R1–R5 therefore always shows 1–2 easy all-same lines; from R6 every non-target line is a near miss.
  - Every T2 array holds a strictly descending line, so a direction-blind "any monotone line" responder stays at .50. Without that line it scored .68 at R1–R5.
- **Matched pairs (no shortcut beats chance):**
  - Each block draws 10 keys and builds one target array and one non-target twin from each.
  - A key fixes the multiset of relevant-symbol counts (so the most frequent symbol's count and the number of distinct symbols are identical within a pair) and tn (so the number of lines with a repeat is identical).
  - For 3×3 Same/Different rules, keys come from an exact enumeration of the 21,147 equality patterns of a 3×3 grid (Bell(9)). The key distribution is the overlap `min(P_target, P_nontarget)` of the natural (uniform-random-array) distributions.
  - T2 adds a random order of the symbol classes, and its twin is the same pattern under a random grid symmetry with a fresh order.
  - T6 pairs a "same" pattern with a "different" pattern.
  - T7 plants a line in a random 4×4 array; the twin is made by one swap that turns the line into a near miss, so the multiset stays the same.
  - Measured on 2,000 blocks per tier: pair detector, duplicate counter (max ≥ 3) and every distinct-count threshold (≤ k and ≥ k, k = 2…9) are **.500**. T6 "same feature only" and "different feature only" are also .500.
- **Content variants:** `digits` (0–9; cells are 3-char strings), `letters` (B D F G H K M P R T; strings), `icons` (indices into set `shapes`; **middle** symbol counts), `dots` (numerosity 1–9), `bars` (orientation index 0–7, angle = 22.5° × index clockwise from vertical), `glyphs` (indices 0–7 of `glyphsA`–`H`, from `opts.set`, else from the seed). Non-text cells are `[a, b, c]`; `cell[meta.relevantPos]` is the relevant symbol. For Ascending, icons and glyphs get a per-block random order key; bars, lab and colors use index order. The key is shown on screen via `meta.rule.orderKey`. `colors` (Okabe–Ito index 0–7) is used only when asked for explicitly.
- **Lab variant `lab`:** LOCATION. Each symbol is a small square frame with one dot in one of its 8 outer cells, index 0–7 clockwise from top-left (the grid8 convention).
  - Chosen because no trained Relations variant uses location as the relevant feature; the trained ones are numeric, verbal, shape, numerosity, orientation and novel-glyph content. So the probe tests RI with stimuli never trained in RI. It stays legible at small sizes (8 well-separated positions).
  - Selected by `opts.lab: true`, `variant: 'lab'`, `set: 'lab'` or `set: 'glyphsLab'`.
  - `js/lab/tests/rel-probe.js` calls T1/T3 at rung 1. Checked: two 20-array blocks at 5.5 s; a perfect log scores 1.0.
- **T6 cells:** `{ shape, fill }`. Shapes are indices into `shapes`, or into a glyph family if `glyphs` was requested. The fill is one of `solid | empty | hlines | vlines | dots | checks` (patterns, not colours).
- **Deviation:** T6 cells have no irrelevant positions, so the R5 distractor step does nothing in T6; R6's near-miss step still applies.

## Relation Stream

- **Rungs:** (changeMs, cells) = (2000, 1), (1500, 1), (1000, 1), (1000, 2), (750, 2), (750, 3). `onMs = soaMs = changeMs`; the grid never blanks. `meta.initialMs` (≥ 3 s) suggests a longer first view.
- **Rule:** Same or Different on rows and columns, from the seed (`params.rule` overrides).
- **Block:** trial 0 is the initial grid (no target line), then 30 scorable changes.
  - Exactly 6 designated changes make exactly one target line, through a changed cell. Their lines are 3 rows and 3 columns; they are never consecutive and never changes 1–2.
  - After every other change there is no target line, so a target always disappears at the next change.
  - Changed cells get a different relevant symbol and a fresh string; the other cells are untouched.
- **Lures:** non-target changes are weighted toward near misses (`lure: 'near'`, about 20–24 of the 24 non-targets).
  - Same: the new symbol equals exactly one other cell in one of its lines.
  - Different: one of its lines has its two other cells equal, and the new symbol differs from them.
  - Grid-wide statistics are balanced: Same favours states with a triple somewhere; Different keeps ≥ 3 distinct symbols and favours 4.
- **Shortcuts** (BA, maximum over rungs, 2,000 blocks per rule):
  - Same: any change makes a pair .508; changed symbol unique in a line .499; no pair made .500; duplicate counter .510; distinct ≥ k ≤ .526.
  - Different: any change makes a pair .483; changed symbol unique in a line .572; no pair made .547; distinct ≥ 4 .539; duplicate counter .500.

## Scorer (`score.js`)

- **Streams (Equal Steps, Stream):** press-only signal detection on `main`.
  - A trial counts as pressed if any `'match'` response names it. The RT is `r.rt` if given, else `t − i × soaMs` (nominal onset).
  - Lead-in responses are ignored, and so are `'match2'` responses.
  - A false alarm on a near miss is `'lure-fa'`.
- **Grid:** MATCH on a target = hit; MATCH on a non-target = false alarm (`'lure-fa'` if the array holds a near-miss line). NO or a timeout on a target = miss; NO or a timeout on a non-target = correct rejection. Timeouts are counted in `extra.timeouts`.
- **Voided trials** are excluded from every count. `nScorable` counts the scorable trials that counted, and `voidedRatio = nVoided / all scorable`.
- **`why[]`** covers every counted trial. Its text comes from the same rule functions as the answer key:
  - "Match: 4, 7, 10 — steps of 3 and 3." / "Not a match: the steps were 3 and 4 — close, but not equal."
  - "Row 2: 5, 5, 5 — all the same." / "No line fits. Closest: Column 1: 3, 3, 7 — two the same, one different."
  - Grid entries add `line` and `cells` for highlighting.
- **`extra`** = `{ correct, errors, accuracy, errorsByStream, timeouts?, paused, protocol }`, where correct = hits + correct rejections and errors = misses + false alarms. Wang's daily accuracy sums these over the day's 5 blocks.

## Tests (`tests/unit/rel-*.test.mjs`)

- **Configuration families, 10,000 seeds each:**
  - Equal Steps: each of the 12 levels × {6 targets (default), 10 targets (Wang)}. Pace changes timing only.
  - Grid: each tier, with rungs R1–R9 and the 7 default variants cycled over the seeds.
  - Stream: each rule, with the 6 rungs cycled.
- **Checked on every seed:**
  - exact counts;
  - an independent solver (written from the rule text, not imported) re-derives every target from the stimuli;
  - exactly one target line or none per array/state;
  - no target line outside the designated changes;
  - line kinds;
  - no fallback used.
- **Grid only, every third seed:** formats and alphabets, kept/replaced strings, distractor counts, near-miss densities and twin profiles.
- **Shortcut responders:** 2,000 blocks per family, ≤ .60 (always/never exactly .5).
- **Also covered:** fallback paths, determinism (also after unrelated calls), the dispatcher, and scoring with hand-built logs.
- **Runtime:** about 33 s CPU in total (steps 7, scorer 0.3, stream 7.5, grid 18). The steps, grid and stream loops run in 2 worker threads, so the four files take about 19 s on an idle 2-CPU machine. Wall time grows when other processes compete for the CPUs. Performance: Equal Steps about 0.02 ms per block (1-back with 10 targets about 0.1 ms); Grid 0.06–0.3 ms; Stream about 0.25 ms (CPU, node 22).

## Notes for the view (Phase 2)

- **Rendering per variant:**
  - icons: the middle symbol counts; draw `HF.sets.get('shapes')`.
  - bars: angle = index × 22.5°.
  - lab: a 3×3 mini-frame with a dot in cell index (grid8 order).
  - glyphs: `HF.sets.glyphPath(meta.setId, index)`.
  - T6: shape outline filled with a pattern.
- **Order key:** for Ascending with a non-natural order, show `meta.rule.orderKey` (symbols in increasing order).
- **Highlighting:** `meta.lines` gives every judged line with its label for highlighting.
