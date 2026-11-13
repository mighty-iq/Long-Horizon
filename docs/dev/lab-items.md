# Lab B — reasoning and control tests: item formats (developer notes)

Owner: lab-B agent (Phase 1). Pure JavaScript (no DOM), ES2019, MIT. Sources: SPEC.md §4.3, §4.6, §7, §9;
PLAN.md §6; research/04-transfer-lab.md §10–19; research/08 (Cao's digit switch task).
Python analysis: `tools/analysis/README.md`.

| Test id | File | Part | Level | Minutes | Score | Direction |
|---|---|---|---|---|---|---|
| `lab.matrix` | `js/lab/tests/matrix.js` | B | far | 9 | proportion correct of 18 | higher better |
| `lab.series` | `js/lab/tests/series.js` | B | far | 6 | proportion correct of 14 | higher better |
| `lab.graph` | `js/lab/tests/graph.js` | B | far | 5 | proportion of 16 items with both nodes right | higher better |
| `lab.switch` | `js/lab/tests/switch.js` | B | mid | 5 | switch cost, ms (**exploratory**) | **lower** better |

Lab B total with check-in and close-out: `HF.lab.visitMinutes('standard', { part: 'B' })` = 27 (PLAN §6).

## Shared conventions

- **Registration.** Each file ends with
  `if (HF.lab && HF.lab.register) HF.lab.register(test); else (HF.labPending = HF.labPending || []).push(test);`.
  It also exports the test for node (`module.exports`). Load after `js/lab/index.js`; the manifest already does.
  `index.js` does not yet drain `HF.labPending`, so a test queued there stays unregistered.
- **Test object.** It has:
  - the registry fields `{ id, label, paradigm, part: 'B', minutes, defaultLevel, version: 1, higherIsBetter, unit, exploratory }`;
  - the functions `gen`, `score`, `rows`, `practice`, `formSeed(form)`;
  - test-specific helpers (solvers, shortcut pickers, constants).
- **`gen({ form, seed })`.**
  - With no `seed`, it uses the fixed release seed `HF.lab.formSeed(id, form)` = `holdfast/lab/v1/<id>/<form>`, and
    `spec.release = true`. **Real visits should pass no seed**, so community data stay comparable item by item.
  - Any other seed gives a fresh instance of the same blueprint (`release: false`).
  - `form: 'P'` returns `practice()`.
  - Generation is deterministic; on 200+ failed draws an item falls back to a hand-made valid item and
    `spec.meta.fallback` lists it. No fallback happened in 10,000 items per generator.
- **`practice()`** returns an unscored TestSpec (`form: 'P'`, `practice: true`), identical at every visit
  (research/04 §12: same instructions and practice every time). Feedback is allowed on practice items only.
- **Spec shape** = SPEC §4.3 discrete, extended:
  `{ kind: 'discrete', task: 'lab', testId, trackId, form, seed, release, version, blueprint, set, rung: null, params,
  windowMs, itiMs, tooFastMs, instructions, practice, trials: [ { i, stim, answer, meta, check? } ], meta }`.
- **Log** = SPEC §4.3: `{ answers: [ { i, response, rt, voided, timedOut? } ], paused }`. `response` is a
  test-specific type (see below); `null` or `timedOut: true` counts as a timeout. A voided trial is excluded from every
  count. A trial missing from the log counts as "not administered" and sets the flag `incomplete`.
- **TestResult** = the registry's shared shape `{ testId, score, scoreLabel, sub, flags, form, seed, version }` plus
  `higherIsBetter`, `unit` (and `exploratory` for switching). Timeouts are wrong.
- **Common flags:**

  | Flag | Raised when |
  |---|---|
  | `incomplete` | items missing from the log |
  | `many-voided` | > 10 % of items voided (research/04 §19) |
  | `too-fast` | ≥ 3 answers under `tooFastMs` |
  | `check-failed` | an attention-check item was wrong (matrices, Graph Mapping) |

  The visit flags itself when 2 or more checks fail across its tests (research/04 §19); that is the visit module's job.
- **`rows(spec, log)`** gives one flat export row per trial (`js/lab/export.js` adds `visit_id`, `kind` and `test`).
  Common columns: `test, form, blueprint, seed, i, template, answer, response, correct, rt, timedOut, voided`.
  Test-specific columns are listed under each test.
- **No colour-only cues anywhere.** Matrices use no colour at all. The switch cue is colour + word + frame shape.

## lab.matrix — generated 3×3 figural matrices

Sandia/RAVEN-style rules (Matzen et al. 2010; the matrix type Wang et al. 2025 used) with I-RAVEN-style
attribute-bisection options (Hu et al. 2021). The generator, items and shapes are our own: no Raven, ICAR, OMIB or
MaRs items (research/04 §10).

**Trial.** The spec holds 20 trials: 18 scored items, plus 2 attention checks after items 6 and 12 (every cell
identical; research/04 §19). `windowMs` 45,000 (timeout = wrong), `tooFastMs` 2,000. Each trial is
`{ i, check, stim: { layout, cells: [8 Cell], options: [8 Cell] }, answer: 0–7, meta }`.
- **Cells** are row-major; the 9th (bottom-right) is the blank.
- **Cell** = `{ shapes: [ { type, fill, x, y, r, rot } ] }`. `x`, `y` are the centre and `r` the radius in a 0–100
  cell box; `rot` is degrees clockwise.
- **Drawing.** Draw `test.shapePath(type)` (0 0 100 100 box, radius ≈ 45) with
  `transform="translate(x y) rotate(rot) scale(r/45) translate(-50 -50)"`. Use a stroke of about 3 % of the cell, and
  scale the stroke with `vector-effect: non-scaling-stroke` or as above.
- **Fills** `none | solid | lines | dots | grid` are black-and-white patterns. Keep the pattern period around 4 px in
  screen space, and do not rotate patterns with the shape.
- **Answering.** Show the options in 2 rows of 4 (desktop) or 4 rows of 2 (phone). Keys 1–8 plus taps; the response
  is the option index 0–7.

**Rules.** A component's attributes are `type`, `size` (4 steps), `fill` (5), `orient` (8 × 45°), `count` (1–4) and
`pos` (4 corners). Each attribute follows exactly one rule:

| Rule | Variant | Meaning |
|---|---|---|
| constant | — | the same in all cells |
| `prog` (steps) | `same` | equal steps along every row (or down every column); all rows identical |
| `prog` | `shift` | the same step, but each row starts elsewhere, so copying from above fails |
| `dist3` (set of three) | `same` | three values once each per row (or column); rows identical |
| `dist3` | `latin` | every row **and** column holds the three values |

`count` and `pos` never both vary.

**Layouts.**
- `one`: one large shape.
- `grid`: 2×2 corner slots, or die-like layouts for counts 1–4.
- `pair`: two independent components, left and right (two "elements").

**Perceptual constraints.** Each is enforced by rejection and checked on 10,000 items in the tests:
- Orientation only varies on shapes without rotational symmetry.
- Fill is judged only where its pattern is visible: interior width × r / 45 ≥ 14 % of the cell.
- Size never varies in a component whose shape type varies, because a diamond and a disc of equal radius do not look
  equally big.

**Blueprint `matrix-1`** (identical for forms A–D; ordered easy to hard):

| Items | Varying rules | Layouts | Distractors |
|---|---|---|---|
| 1–3 | 1 (`same` variants) | one, one, grid | far (non-adjacent values) |
| 4–6 | 2 (`same` variants) | one, one, grid | far |
| 7–9 | 3 (item 7 adds a `latin`, item 9 a `shift` rule) | one, pair, grid | far |
| 10–12 | 3 (one `shift` + one `latin` each) | one, pair, grid | near (one step = minimal difference, Zorowitz 2024) |
| 13–18 | 4 (two to four `shift`/`latin`) | pair, pair, grid, grid, pair, pair | near |

Directions: with ≥ 2 directional rules, both rows and columns are used (Sandia style). Answer positions are
balanced: each of 0–7 is used 2–3 times per form.

**Distractors (attribute bisection).** The 8 options are the product of value sets on the split attributes:
- 2 × 2 × 2 on 3 attributes, or 4 × 2 on 2 attributes for 1–2-rule items;
- one combination is the answer; each distractor breaks 1–3 rules.

Because every value appears in exactly half (or a quarter) of the options, no answer-only heuristic has a signal: the
options form a symmetric product structure.

Alternative values come from the matrix itself where possible, so "pick the option whose features all occur in the
matrix" also fails. `far` items take values ≥ 2 steps away; `near` items take adjacent values (minimal-difference
distractors).

**Solver** (`test.solve(item)`). It works from the drawn shapes only: it perceives type, fill, size, canonical
orientation, count and position, and never reads the generator's rules.
- For every attribute it fits every hypothesis of the rule family to the 8 visible cells: constant per row or column,
  equal steps along rows or columns, set of three along rows or columns.
- All fitting hypotheses must predict one value.
- Exactly one option must match every prediction, and all 8 options must look different.

**Tutorial** (`practice()`, also in `spec.practice`, `spec.instructions` and `spec.ruleTypes`). It is the same at
every visit (research/04 §11.2). Four worked examples:
1. size steps;
2. a set of three shapes (Latin);
3. number steps + fill set;
4. position + rotation steps.

Each has `explain: [sentences]` generated from the item's own rules (`test.explain`).

**Score.** `sub` = `{ correct, n, nItems, timeouts, voided, missing, tooFast, medianRtCorrect, byRules: { '1'..'4': { correct, n } }, checks: { n, failed } }`.
**Rows** add `nRules, layout, elements, plaus, rules` (slot:rule:variant:dir).

## lab.series — number and letter series (typed answer)

**Families** (our implementation; ANSIG-style operators after Loe et al. 2018; letter series after Simon & Kotovsky 1963):

| Blueprint `series-1` | Item | Family | Example (one draw) |
|---|---|---|---|
| 1 | number | `arith` constant step | 48, 41, 34, 27, 20 → 13 |
| 2 | letter | `lskip` constant skip | O, M, K, I, G → E |
| 3 | letter | `lrep` each letter twice | E, E, F, F, G, G → H |
| 4 | number | `geom` × 2, × 3 or ÷ 2 | 1, 3, 9, 27, 81 → 243 |
| 5 | number | `second` growing differences | 9, 10, 12, 15, 19, 24 → 30 |
| 6 | letter | `linterleave` two series | D, Y, E, X, F, W → G |
| 7 | number | `twostep` +p, −q | 26, 20, 27, 21, 28, 22, 29 → 23 |
| 8 | letter | `lgrow` growing skips | A, B, D, G, K, P → V |
| 9 | number | `interleave` two series | 40, 10, 42, 16, 44, 22, 46 → 28 |
| 10 | letter | `ltwostep` +p, −q | C, E, D, F, E, G, F → H |
| 11 | number | `fib` sum of the two before | 7, 6, 13, 19, 32, 51 → 83 |
| 12 | number | `mulAdd` × m then + c | 2, 8, 16, 22, 44, 50, 100 → 106 |
| 13 | letter | `linterleave2` unequal steps | A, V, D, T, G, R, J → P |
| 14 | number | `cycle3` three-step cycle | 38, 47, 50, 48, 57, 60, 58, 67 → 70 |

There are 8 number and 6 letter items. `windowMs` 60,000, `tooFastMs` 1,500. Numbers run 0–999, answers are never
negative (phone keypads), and letters run A–Z with no wrap-around.

**Trial** = `{ i, stim: { kind: 'number'|'letter', terms: [string], display: '…, ?' }, answer: canonical string, meta: { template, family, nShown, answerValue, params } }`.
Practice: `2, 4, 6, 8 → 10` and `B, D, F, H → J`.

**Accepted answers** (`test.normalize(kind, raw)`, the same function the view should use to validate before
submitting):
1. Unicode NFKC, so full-width digits and letters are accepted.
2. All whitespace removed, then trailing `. , ; : ! ? ' "` stripped.
3. Then by kind:
   - **number:** an optional leading `+`, then digits, then an optional `.0…` → canonical decimal (`007` → `7`,
     `12.0` → `12`). A minus sign is never accepted.
   - **letter:** exactly one letter A–Z, any case → upper case.
4. Anything else → `null`, which counts as wrong (`sub.invalid`).

View: `inputmode="numeric"` for numbers, a text field for letters; submit with Enter; the response is the typed string.

**Solver** (`test.solve`). It fits every family whose parameters the shown terms over-determine (at least one extra
term):
- arithmetic, geometric, constant second difference;
- period-2 and period-3 difference cycles;
- two interleaved arithmetic series;
- Fibonacci and Fibonacci + c;
- x → m·x + c, alternating × m / + c;
- pairs in equal steps.

All fits must predict one next term, and it must equal the answer.

Families other than constant steps also reject any draw that a cheap guess solves: repeat the last difference, repeat
the last term, the last ratio, or the term two back.

**Rows** add `kind, family, terms, responseCanonical`. `sub.byKind` gives number and letter accuracy separately.

## lab.graph — Graph Mapping

Re-implemented from Jastrzębski, Ociepka & Chuderski (2023). Two drawings of the same directed graph; find, in the
right graph, the nodes that correspond to the **two** marked nodes of the left graph (marks 1 and 2, as in the
paper; the format also accepts one). `windowMs` 24,000 with a warning at `warnMs` 19,000; `tooFastMs` 1,500.

**Trial.** `{ i, check, stim, answer: [rightIdFor1, rightIdFor2], meta: { n, m, ttype, targetTypes, autSize, crossL, crossR } }`.

`stim` = `{ nodeR: 7, left: { nodes: [{ id, x, y }], edges: [[from, to]], targets: [{ node, mark }] }, right: { nodes, edges } }`.
- Coordinates are in a 0–100 box per graph.
- Draw arrows from rim to rim with a visible head.
- Mark the targets with the number **and** an outline shape (ring for 1, square for 2), never colour alone.
- The view asks for the match of 1, then of 2. A choice may be changed until the item is submitted.
- Keyboard: number the right nodes 1–n in reading order and let the user type them.
- The response is `[rightId|null, rightId|null]`.

**Generation:**
- **Graph:** weakly connected, no loops and no two-way pairs.
- **Targets:** each target must be fixed by every automorphism, so its image is unique.
  - direct target: its (in, out) degree pair is unique in the graph;
  - indirect target: it shares that pair and must be told apart through its neighbours.
- **Drawings:** each uses a jittered 3×3 grid. Every edge clears every other node by ≥ 12 units, and crossings stay
  within the template's bounds.
- **No visual shortcut:** the right drawing is never a rotated or mirrored copy of the left one under any isomorphism.
- **Check item:** one item, identical drawings, after item 8.
- **Practice:** 2 fixed items.

**Blueprint `graph-1`:**

| Items | Nodes | Edges | Target types |
|---|---|---|---|
| 1–4 | 4 | 3–5 | direct (item 4 mixed) |
| 5–8 | 5 | 4–6 | direct → mixed → indirect |
| 9–12 | 5–6 | 5–7 | mixed / indirect |
| 13–16 | 6 | 6–7 | indirect, up to 3 crossings on the right |

**Solver.** All isomorphisms left → right are found by backtracking with degree-pair pruning. Each target must have
exactly one image, equal to the answer.

**Score.** The proportion of items with both nodes right. `sub` adds partial credit: `targetsCorrect / targetsN`.
Nodes placed before a timeout still count there, but the item is wrong.

**Rows** add `n, m, ttype, crossR, targetsCorrect`.

## lab.switch — cued digit task switching (exploratory)

This is Cao et al.'s (2026) switching outcome (the digit task after Tayeb & Lavidor 2016), rebuilt from the
description.

**Stimuli and keys.** Digits 1–9 without 5. **F (left, logical `no`) = LOW / ODD; J (right, logical `match`) =
HIGH / EVEN.** Answers use the logical keys, so `HF.timing.runDiscrete` logs can be scored as they are; `left`/`right`
and `KeyF`/`KeyJ` are also accepted.

**Cues** (`spec.cues`, `test.CUES`):

| Task | Word | Frame | Colour token |
|---|---|---|---|
| magnitude | LOW · HIGH | square | `cueA` (Okabe–Ito blue) |
| parity | ODD · EVEN | diamond | `cueB` (Okabe–Ito orange) |

Show the word above the digit, inside the frame. Touch buttons: left "LOW / ODD", right "HIGH / EVEN".

**Timing** (Cao): fixation 100 ms → digit until the response (max `windowMs` 3,000) → blank 50 ms (`itiMs` 150).

**Blocks** (`spec.blocks[k] = { id, kind, task, from, to, instructions, practice: [Trial] }`):
- **pure magnitude**: 16 trials (each digit twice);
- **pure parity**: 16 trials. The order is counterbalanced by form: A and C start with magnitude, B and D with parity.
- **mixed**: 49 trials. The first is followed by 24 switches and 24 repeats; runs are ≤ 4; each digit appears 3
  times per transition type, so congruency is balanced; no digit repeats immediately.

Total: 81 scored trials. **Run each block's `practice` (4, 4, 8 trials, with feedback) right before the block.**
`practice()` gives all 16 at once for runners that cannot interleave.

**Trial** = `{ i, block, stim: { digit, task }, answer: 'no'|'match', meta: { trialType: 'first'|'pure'|'repeat'|'switch', congruent, side } }`.
`test.check(spec)` re-derives every key, trial type and balance from digit + cue alone.

**Score rules:**
- RT uses medians of correct trials. Excluded: each block's first trial, trials right after an error or timeout,
  RT < 200 ms (anticipations), and voided trials.
- Error rates use every answered or timed-out trial except each block's first.
- Costs:
  - `switchCostRt` = median(switch) − median(repeat);
  - `mixingCostRt` = median(repeat) − median(pure);
  - the same two costs on error rates.
- `score` = `switchCostRt` in ms. It is `null` if a condition has fewer than 5 usable trials (flag `insufficient-data`).
- **`sub.pureMedianRt` (also `sub.speedCheck`) is the speed check** that flags motivation or device effects across
  visits.

**Flags:**
- always `exploratory`;
- `low-accuracy` (< 70 %);
- `many-timeouts` (> 10 %);
- `anticipations` (> 5 % under 200 ms);
- `incomplete`, `many-voided`, `insufficient-data`.

**Rows** add `block, task, digit, trialType, congruent, rtUsed, excluded` (the reason).

## Verification (tests/unit/lab-b-*.test.mjs, ≈ 9–13 s; `node tests/unit/run.mjs lab-b`)

- **lab.matrix:**
  - 10,000 items (all templates incl. checks and tutorial): the solver finds exactly one fitting option, no
    fallbacks, and every constraint above holds.
  - Answer-only pickers on the scored pool (7,830 items), at chance 12.5 %:

    | Picker | Hit rate |
    |---|---|
    | majority vote | 12.4 % |
    | odd-one-out | 12.6 % |
    | centroid | 11.9 % |
    | numeric odd/centroid | 13.0 / 12.5 % |
    | context presence (uses the matrix, not answer-only) | 16.0 % |

  - Forms A–D: identical blueprint features at every position, and simulated solvers differ by < 0.02.
  - The scorer passes hand-built logs.
- **lab.series:**
  - 10,000 items have one answer across all families, with no fallbacks; each family's hand-made fallback is valid.
  - "Repeat the last difference" solves only the constant-step families: 2 of 14 items per form (14.3 %), and 0 % of
    all other families. Repeat-last-term, two-back and last-ratio solve none.
  - The format table and scoring pass hand-built tests.
- **lab.graph:**
  - 10,000 items have unique images for both marks.
  - Drawings are checked for clearance, crossings, no loops or double edges, and no congruent copies (1,500 items).
  - Guessing the same position scores 20.2 % against 20.0 % chance. A same-degree guess is right on 100 % of direct
    targets (by definition) and 48.5 % of indirect ones.
- **lab.switch:** 10,000 sequences pass `check`. Scoring is exact on noise-free logs (switch 150 / mixing 100 ms) and
  handles errors, post-error trials, anticipations, timeouts, missing blocks and the flags.
- **Registry:** a test checks that all four files queue in `HF.labPending` without the registry, register with it,
  and return the shared result fields.
- **Change verdicts** (`js/lab/compare.js`, `tests/unit/lab-b-compare.test.mjs`): the verdict compares the change with
  measurement noise only (±1.96 S_diff around B2); `rciPractice` subtracts the average retest gain of people who did
  not train, only when the calibration has `practice` from `practiceN ≥ 30` of them (SC-08).

## Deviations from the brief or research/04 (and why)

- **Graph Mapping marks two nodes per item**, as in the paper and research/04 §12.2 B3, not one. One target among 4–6
  nodes gives a 17–25 % guessing rate; two give 3–8 %. The format supports one target if wanted (`targets` and
  `answer` are arrays).
- **Attention checks** are 2 trivial matrices and 1 trivial graph (research/04 §19). They are added to the 18 / 16
  scored items and are not scored.
- **Distractor scheme:** research/04 §11.1 said "each distractor violates exactly one rule". That lets a majority vote
  find the answer (the RAVEN flaw), so the I-RAVEN-style bisection from the brief is used instead: each distractor
  breaks 1–3 rules.
- **Task switching** is kept out of the Python composites. It is exploratory in the `default` and `wang` study
  analyses and the secondary outcome of the `cao` analysis (Cao et al. 2026 used it). The app's per-user mid
  composite includes it (`HF.lab.levels`); `analyze.py --switch-in-mid` matches the app. Since the Phase 4 fixes
  (SC-06/07) the analysis runs one study template at a time, with a fixed outcome plan per template
  (`tools/analysis/README.md`).
