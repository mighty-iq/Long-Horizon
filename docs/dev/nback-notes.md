# N-back family and stimulus sets: developer notes

Owner: the n-back agent (Phase 1). Code: `js/content/sets.js`, `js/tasks/nback/gen.js`, `js/tasks/nback/score.js` (all pure, ES2019, already in `js/manifest.json` → `pure`, in that order). Tests: `tests/unit/sets-basic`, `sets-glyphs`, `nback-gen`, `nback-score`, `nback-shortcuts` (`node tests/unit/run.mjs nback-` / `sets-`; `HF_VERBOSE=1` prints the measured margins). The header comment of each file is the authoritative interface; this page explains the decisions and records the measurements.

## 1. Interfaces at a glance

- **`HF.sets`**
  - Lookup: `get(id)`, `ids`, `list()`, `available(id)`, `forTrack(trackId)`, `defaultFor(trackId)`.
  - Item helpers: `key(item)`, `indexOf(set, item)`, `name(item)`, `cellRC(cell)`, `parseExpr(text)`.
  - Cyclic sets: `step(set, item, k)`, `rulePhrase(set, k)` (e.g. "the day after"), `relPhrase(set, k)` (e.g. "one point clockwise from").
  - Glyphs: `prepare(id)` (builds a glyph family; `gen` calls it), `glyphPath(id, i)`, `glyphStyle(id)`, `glyphSvg(id, i, px)`, `glyphInfo(id)`, `families`.
  - Shapes: `shapePath(shape)`, `shapeSvg(shape, px)`.
- **`HF.tasks.nback`**
  - `gen(opts)` and `score(spec, log)`.
  - `explain(spec, stream, i)`: one trial's "why" text.
  - `ladder(trackId, rung)`: SPEC §5.
  - `analyze(spec)`: labels re-derived from the stimuli.
  - Shared constants: `maskAt`, `BITS`, `LURE_NAMES`, `STRUCTURES`, `words(n)`.
- **Views.**
  - Paint a glyph with `glyphStyle`: `fill` → `fill=currentColor`; otherwise `fill=none`, `stroke=currentColor`, the given width, round caps and joins.
  - Shapes are filled paths and use the default nonzero rule; the ring's hole depends on it.
  - Call `HF.sets.prepare(set)` before a stream. The first build of a glyph family takes 5–100 ms; after that every call is a cached lookup.

## 2. Item formats (`stim.<stream>`)

| Version | Item |
|---|---|
| Plain | the set's item: `{cell}` · `{text}` · `{shape}` · `{glyph, index}` · `{tone}` · `{clip}` |
| Dual | `pos: {cell: 0..7}` (grid8) and `snd: {tone: 0..7}` or `{clip: 'F'}` (lettersAudio) |
| Transform | `{text: 'Tue'}` (days, months, clock, compass) or `{cell}` (ring8) |
| Arithmetic | `{expr: '9 − 2', value: 7}`: `a + b` or `a − b` (U+2212), operands 1–9, value 1–9; 72 expressions, 8 per value |
| Switch | `{what: {text: '7'} or {shape: 'tri'}, where: {cell: 3}}`; `trial.cue` is `'what'`/`'where'` on scorable trials and `null` in the lead-in |

Grid cells are numbered 0–7 clockwise from the top-left (0 TL, 1 T, 2 TR, 3 R, 4 BR, 5 B, 6 BL, 7 L). Names: 'top left', 'top middle', … 'middle left'.

## 3. Sets

- **Required (SPEC §2.2).**
  - `grid8`, `ring8` (cyclic, clockwise), `letters` (C H K L Q R S T), `digits` (1–9).
  - Cyclic: `days` (Mon…Sun), `months`, `clock` (1–12), `compass` (N…NW, clockwise).
  - `shapes`, `tones` (8, audio), `lettersAudio` (only with clips), `glyphsA`–`glyphsH`, `glyphsLab`.
- **Added.**
  - `arith`, the expression set for `nback.arith` (kind `expr`).
  - `numbers` (1–39, kind `number`). It gives `rel.steps` a set id and a content family for the learner model; the relations module may ignore it.
- **Content families.**
  - spatial: grid8, ring8, compass.
  - verbal: letters, days, months.
  - numeric: digits, clock, arith, numbers.
  - symbolic: shapes and all glyph families.
  - audio: tones, lettersAudio.
- **`forTrack` / `defaultFor`.**

  | Track | Sets | Default |
  |---|---|---|
  | Plain | grid8, letters, digits, shapes, days, months, clock, compass, glyphsA–H, tones (+ lettersAudio) | grid8 |
  | Dual (sound stream) | tones (+ lettersAudio) | tones |
  | Transform | days, months, clock, compass, ring8 | days |
  | Arithmetic | arith | arith |
  | Switch | digits, shapes | digits |
  | `rel.steps` | numbers | numbers |
  | `lab.nback` | glyphsLab | glyphsLab |

  `glyphsLab` is never offered to a training track. `gen` accepts it only with `lab: true`, which is what the Lab probe does.
- **Spoken letters.**
  - The core ships a flat map in `assets/audio/letters.js`: `window.HF_AUDIO_CLIPS = { C: 'data:audio/mpeg;base64,…', H: …, … }`. `HF.audio.clip(letter, when)` plays one.
  - A nested `{ letters: { C: … }, order?: [...] }` or `{ ids: [...] }` also works.
  - Flat maps use their single-letter keys, sorted. At most 8 letters are used; fewer than 6 means "not available". Items are `{clip: 'C'}`. A test loads the shipped file itself.
  - Availability is checked at call time, so the clip file may load after `sets.js`.
- **Shapes.**
  - The set: circle, square, triangle, star, cross, **ring**, heart, crescent.
  - A hexagon was dropped: as filled silhouettes, circle and hexagon differ by only 7 % of their pixels.
  - A diamond was dropped: it is a rotated square, which the distinctness rule forbids.

### Glyph families

Each family has a lattice vocabulary. The generator does the following:

1. Enumerates every valid glyph.
2. Keeps one glyph per symmetry class. The canonical form is the smallest code of the sorted primitive indices over the family's group.
3. Keeps the classes whose ink length is within ±15 % of the median (similar complexity).
4. Picks 8 by multi-start greedy max–min on a coarse ink-overlap distance: Jaccard over 4-unit cells, minimised over the group. This counts dots and shared ink, which a primitive count misses.
5. Draws each glyph in a seeded orientation.

The only randomness is `HF.rng` seeded with `holdfast/glyphs/v1/<id>`. Coordinates are snapped before binning, so the selection does not depend on the JS engine's trig. Changing anything in the generator changes the glyphs, so bump `v1` if old logs must stay comparable.

| Family | Vocabulary | Group | Min shape distance¹ | Min pixel difference at 64 px² | Ink ratio |
|---|---|---|---|---|---|
| A Runes | 4 straight unit strokes, square lattice, 1–3 diagonals | D4 | 0.201 | 0.455 | 1.13 |
| B Arcs | 4 quarter arcs, one per cell, spanning all 3×3 cells | D4 | 0.089 | 0.554 | 1.06 |
| C Triangles | 4 unit strokes of a hexagonal (60°) lattice | D6 | 0.157 | 0.397 | 1.04 |
| D Dials | centre dot + spokes and 45° ring arcs (4) | D8 | 0.165 | 0.498 | 1.12 |
| E Constellations | 4 dots joined by a 3-step path (unit, diagonal, knight) | D4 | 0.107 | 0.474 | 1.18 |
| F Blocks | the 8 pentominoes that fit 3×3 (filled) | D4 + translation | 0.061 | 0.333 | 1.00 |
| G Curls | smooth curve through 5 lattice points, start dot | D4 | 0.138 | 0.618 | 1.18 |
| H Brackets | 3 corner brackets in 3 of 4 quadrants | D4 | 0.152 | 0.499 | 1.01 |
| Lab Combs | horizontal spine + 3 ticks, one crossing | D2 | 0.104 | 0.366 | 1.08 |

¹ Independent check (`sets-glyphs.test.mjs`). The test parses the path strings, normalises position and scale, and takes the chamfer distance minimised over every rotation (2° steps) and mirror. Exact copies score < 0.03; the test requires ≥ 0.05.
² Share of the inked pixels that differ, minimised over the 8 square symmetries. The test requires ≥ 0.30, i.e. at least one whole stroke of 3–4, or one cell of 5.

**Families look different.** Each family has its own vocabulary signature, checked by the test: fill, curve type, dot count, line-angle class, pieces, and long spine. All 8 glyphs of a family share it, and no two families share one.

## 4. Generator (`gen.js`)

### Ladder and options

- **Ladder (SPEC §5).**
  - Plain, Dual, Transform, Arithmetic: n = 1 + floor(r / 2); odd rungs are fast. The catalog's ladders reach 16-back
    (r = 0…31; SPEC §5 amended 12 Nov, Phase 4 SC-05) and the generator accepts n = 1–16 (was 1–12).
  - Switch: n = 1 + floor(r / 3), with sub-steps 0 (std, 25 % switches), 1 (std, 50 %), 2 (fast, 50 %); its ladder stays at 9-back.
  - `opts.params` (n, onMs, soaMs, step, switchRate) overrides the ladder.
  - n = 10–16 checked on 12 Nov with the test suite's `checkBlock` (independent solver, exact counts, clean fillers,
    runs): 2,000 seeds per version per n, all sets, lureCount 0/4/6, every 7th uncontrolled — 70,000 blocks, 0 problems,
    0 fallbacks, at most 3 plans per block. Rule texts read "11 back" etc. above ten; the rule-card tape compresses
    from n = 5 and the memory aid is only used at 2-back.
- **Block.** 20 + n items, lead-in = n, 6 targets per stream with at most 2 in a row. Dual: 2 shared targets + 4 + 4.
- **`lureMode`.** Defaults to `'uncontrolled'` for the cao and jaeggi protocols, `'controlled'` otherwise.
- **`meta.lurePlan`** (Phase 4, CA-08): the requested `lureCount` (after the 0–6 clamp) when lures were controlled,
  else null. `meta.lureCount` already includes the version-specific lures (Transform/Arithmetic 6, Switch 7 at
  lureCount 4), so a block regenerated from a spec must pass `{ lureCount: meta.lurePlan, lureMode: meta.lurePlan ==
  null ? 'uncontrolled' : 'controlled' }`, not `meta.lureCount`.

### Rules and lures

Lure mixes follow SPEC §5 as amended on 6 Nov. Each stream gets `lureCount` position lures at n±1, split evenly between n−1 and n+1 (default 4, Stretch 6, capped at 6). In the Executive versions these lures are rule-related, and the version-specific lures come on top of them. 1-back has no lures, except Switch, which has round(lureCount / 2) uncued lures.

| Version | Target | Lures from 2-back: lureCount 4 (Stretch 6) |
|---|---|---|
| Plain / Dual | same item n back | 2 `n-1` + 2 `n+1` = 4 (6) |
| Transform | item = order[(index(n back) + step) mod len]; step +1 by default (+2, −1 via `params.step`) | 2 `rule-n-1` + 2 `rule-n+1`, plus 2 `same` (identity with n back) = 6 (8) |
| Arithmetic | same value as n back, different expression | 2 `value-n-1` + 2 `value-n+1`, plus 2 `lookalike` (same first operand, other value) = 6 (8) |
| Switch | cued feature = that feature n back | 2 `cued-n-1` + 2 `cued-n+1`, plus 3 `uncued` = 7 (9) |

- **Controlled mode is exact.**
  - Every lure matches exactly one lure type.
  - Fillers match nothing at n−1, n or n+1. That means no rule match at those lags, plus no identity at n (Transform), no look-alike (Arithmetic), and no uncued match at n (Switch).
  - Targets match only at lag n. Switch targets also differ in the uncued feature, so the cue always matters.
- **Uncontrolled mode.**
  - Exactly 6 targets; the other items are random but never a target.
  - Lures that occur anyway are labelled. Several types on one trial are joined with `+`.
- **Repeats.**
  - Immediate repeats appear only where the rule needs them: Plain 1-back targets, and Plain 2-back n−1 lures (controlled).
  - Arithmetic never repeats an expression within n + 1 items. So the same expression never appears at lag n, and no target shares its first operand with the item n back.
- **1-back.** Two consecutive targets (A A A) are allowed. Fillers still avoid lag 2.

### Method

1. **Plan.** Switch cues first. Then 6 target positions (Switch: 2–4 on each cue). Then lures, placed one by one; each placement is kept only if the plan stays structurally possible. The check is a union–find with offsets over the equalities and inequalities the categories imply, per feature channel. A greedy placement that blocks itself is retried up to 12 times with fresh orders.
2. **Search.** A depth-first search over values, left to right. Each position's match mask (`maskAt`) must equal its planned category exactly. The search also uses early checks between equality classes, restricted domains for forced categories, and a lazy Fisher–Yates draw.
3. **Re-plan** after 600 nodes, up to 400 plans. After that comes an uncontrolled fallback (`meta.fallback`). Over 100,000 test blocks (all versions; n = 1, 2, 3, 5; lureCount 4 and 6; the new mixes) plans averaged 1.11 per block, the worst block needed 21, and the fallback was never triggered. The tightest case is Dual at 2-back with 6 lures (mean 3.3 plans). That is why lureCount is capped at 6: with 8, Dual at 2-back fell back once in 500 blocks.
4. **Self-check.** `analyze()` re-derives every label from the stimuli and must agree before `meta.solverChecked` is set.

Speed: 0.02–0.6 ms per block in node, in every version and mode, n = 1–9.

## 5. Scorer (`score.js`)

- **Keys and responses.**
  - Keys: `match` → `main` / `pos`, `match2` → `snd`.
  - Only the first response per key per trial window counts.
  - Lead-in presses are ignored and counted in `extra.leadInPresses`.
- **RT.** `r.rt` if given, otherwise `r.t − log.onsets[i]`, otherwise `r.t − i × soaMs`.
- **Voided trials.** They are excluded everywhere.
  - `nScorable` = 20; `nVoided` counts voided scorable trials; `voidedRatio` = their ratio.
  - A voided item does not void the trial n later that compares with it.
- **Aggregates.**
  - `ba` = the weakest stream's BA; `baMean` = the mean BA.
  - `y` = mean over streams of max(0, H − FA).
  - d′ and criterion come from `HF.stats.sdt` (log-linear correction).
  - `plain` sums over streams.
- **`extra`.**
  - `correct` and `errors` over the scorable items (Cao: > 18 correct → up, ≥ 5 errors → down).
  - `errorsByStream` (Jaeggi) and `correctByStream`, `scored`, `leadInPresses`, `paused`.
- **`why[]`.**
  - One entry per counted trial and stream, from the same kernel (`maskAt`) that labelled the block.
  - Whether a text says "Match" or "Not a match" always follows the spec's target label.
  - Examples (tested verbatim):
    - "Match: Wed is the day after Tue, two back."
    - "Not a match: Sat is the same day as two back — the rule is the day after."
    - "Not a match: two back was Wed, so a match would be Thu."
    - "Not a match: 6 + 2 starts like 6 − 1 (two back) but equals 8, not 5."
    - "Not a match: the position matches one back, but the cue is WHAT and the digit differs."

## 6. Verification (`node tests/unit/run.mjs nback-` and `sets-`: 47 tests)

- **Generator.**
  - 10,000 seeds per version over n = 1, 2, 3, 5 (Plain over all its sets; Transform over 5 sets and steps +1, +2, −1; Switch over digits and shapes, all switch rates; Dual with tones). Result: 0 problems.
  - The checks:
    - exact target, lure and lure-mix counts;
    - an independent solver (its own rules, orders and expression parser) agrees with every label;
    - no accidental targets;
    - fillers are clean and targets are pure;
    - at most 2 targets in a row;
    - repeats only where allowed;
    - item formats are valid;
    - Dual has exactly 2 shared targets;
    - Switch has the exact switch count and targets on both cues.
  - Also checked:
    - Uncontrolled mode: 1,000 per version. Lure totals for each version at lureCount 4 and 6, and the cap at 6.
    - lureCount 6 and 0, and n = 6–9.
    - Dual with spoken letters, determinism, ladder, options and fallbacks.
  - A mutation run (9 corrupted blocks) confirmed that the checker catches every kind of corruption.
- **Shortcut responders.** Controlled blocks, real scorer, mean BA at n = 2 / 3 / 5. lureCount 4: 2,000 blocks per version; lureCount 6: 1,000. The lure mixes are the amended ones.

| Responder (bound) | Plain | Dual | Transform | Arithmetic | Switch |
|---|---|---|---|---|---|
| always-press, never-press (≤ .60) | .500 | .500 | .500 | .500 | .500 |
| familiarity: item seen in the last n + 1, 4 lures (Plain/Dual < .87; Executive ≤ .60) | .857 / .857 / .769 | .857 / .857 / .746 | .431 / .429 / .450 | .500 (never presses) | .490 / .483 / .485 |
| same, 6 lures (Plain/Dual < .80; Executive ≤ .60) | .786 / .786 / .722 | .786 / .786 / .704 | .427 / .434 / .462 | .500 | .485 / .474 / .474 |
| Transform "its next item seen" (≤ .60) | – | – | .444 / .452 / .462 (6 lures: .435 / .457 / .458) | – | – |
| rule-aware familiarity, 4 lures (< .87) | = above | = above | .857 / .816 / .736 | .857 / .849 / .781 | .857 / .836 / .757 |
| rule-aware familiarity, 6 lures (< .80) | = above | = above | .786 / .760 / .691 | .786 / .782 / .735 | .786 / .771 / .709 |
| same first operand (≤ .60) | – | – | – | .429 at every n from 2-back | – |
| ignore the cue, what / where (≤ .73) | – | – | – | – | .693–.717 (4 lures), .691–.702 (6 lures) |

What "rule-aware" means for each executive version:
- Transform: the item is the rule step of one of the last n + 1 items.
- Arithmetic: the value was seen.
- Switch: the cued feature was seen.

At 2-back every position-blind familiarity responder scores exactly 1 − lureCount/28, because the version-specific lures never fool it. At 1-back it scores 1: with no lures, familiarity is the rule itself.

Uncontrolled blocks (Cao, Jaeggi), rule-aware familiarity at n = 1 / 2 / 3 / 5: Transform .952 / .908 / .859 / .772 and Dual .936 / .928 / .868 / .762.

- **Runtime.** All five files take about 16 s of CPU and about 17 s of wall time at low load.

## 7. Deviations and open issues

1. **The familiarity bounds follow SPEC §4.6 and §5 as amended on 6 Nov.** All of them are met.
   - Plain/Dual familiarity, and rule-aware familiarity in the Executive versions: < .87 with 4 lures and < .80 with 6, from 2-back.
   - Executive literal familiarity: ≤ .60. Switch "ignore the cue": ≤ .73. Always-press, never-press and "same first operand": ≤ .60.
   - Fillers match nothing at n−1, n or n+1, so a position-blind responder errs only on the lures it falls for: exactly 1 − lureCount/28 at 2-back, and lower at higher n.
   - The test pins that value exactly, so a regression fails.
2. **The Executive lure mixes changed on 6 Nov** (orchestrator's decision, SPEC §5): lureCount rule-related lures at n±1, plus Transform 2 identity, Arithmetic 2 look-alikes, Switch 3 uncued. Before, only 2, 2 and 1 of the 4 lures were rule-related, and rule-aware familiarity scored .929, .929 and .964 at 2-back.
3. **Switch: ignoring the cue scores about .70.** That is under the .73 bound and below Varied's down-threshold, so a cue-ignorer cannot hold a level. Getting it to ≤ .60 would need 8 or more uncued lures.
4. **Not shipped: the "notes" Transform variant** from PLAN §4.1. SPEC lists `tones` as a non-cyclic audio set. A cyclic tone set can be added later.
5. **Uncontrolled mode also avoids immediate repeats**, per the brief's general rule. So Jaeggi 2-back blocks never contain n−1 lures made by repetition; accidental n+1 lures still occur.
6. **Additions beyond SPEC:**
   - sets `arith` and `numbers`;
   - helpers `prepare`, `glyphStyle`, `glyphSvg`, `shapePath`, `shapeSvg`, `rulePhrase`, `relPhrase`, `step`, `explain`, `analyze`;
   - spec fields `spec.sets` (per-stream set ids) and `meta.lureTypes`, `meta.rule`, `meta.switches`, `meta.cueCounts`, `meta.attempts`, `meta.setFallback` / `stepFallback`.
7. **First build of a glyph family takes 5–100 ms in node** (allow about 3× on a phone). Build it between blocks with `prepare` (`gen` already does).
