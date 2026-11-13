# Engine notes (js/engine/)

Pure JavaScript, no DOM, no timers, deterministic for given records and `now`. Every module documents its exact
inputs and outputs in its header comment; this page explains how they fit together and records the choices made
where SPEC.md, PLAN.md and the papers leave room. Simulation results are in `sim-report.md`.

## 1. Modules and load order

| File | Global | Job |
|---|---|---|
| `catalog.js` | `HF.catalog` | 19 tracks: ladders (SPEC §5), labels, difficulty (logits), sets, gates, lessons, rule cards |
| `modes.js` | `HF.modes` | the six modes as data: U/D, targets, caps, feedback, schedule kind |
| `learner.js` | `HF.learner` | hierarchical Elo learner model, predicted BA, level-equivalents, placement |
| `controller.js` | `HF.controller` | one level rule for every mode; self-correction; fatigue; `blockBad` |
| `protocols.js` | `HF.protocols` | Cao 2026, Wang 2025, Jaeggi 2008: block/day rules, state, due logic |
| `mastery.js` | `HF.mastery` | Mastery Path units, criterion, delayed checks, corrective cycle, reviews |
| `goals.js` | `HF.goals` | local days and weeks, counted sessions, weekly ring |
| `badges.js` | `HF.badges` | the 12 milestone badges from derived facts |
| `coach.js` | `HF.coach` | Edge / Due / Growing / New suggestions and predicted BA per rung |
| `derive.js` | `HF.derive`, `HF.engine.derive` | replays the records into the whole training state |
| `planner.js` | `HF.planner` | session plans (templates, ramp, introductions, modes, protocols, Study arms) and BlockPlans |
| `engine.js` | `HF.engine` | facade: `derive`, `plan`, `prepare`, `beginSession`, `commit`, `endSession`, `newRecords` |

Modules refer to each other only at call time, so the load order in `js/manifest.json` (catalog … engine) is all
they need. They use `HF.rng` and `HF.stats` and, only if present at run time, `HF.sets.forTrack/defaultFor/get`
and `HF.study.decodeCode`.

## 2. How the UI drives a session

```js
var d = HF.engine.derive(records, Date.now());                     // HF.store.derived does this
var plan = HF.engine.plan(records, d, { now: Date.now() });        // modeId/minutes default to settings
records = HF.engine.beginSession(records, plan, { now }).records;  // SessionRecord + 'track-intro' events
for each slot of plan.slots (Free play: slot = HF.planner.freeSlot(plan, { trackId, rung, set })):
  var bp = HF.engine.prepare(slot, records, d, { sessionId: plan.id });   // run bp.lessonId first if set
  var spec = HF.tasks[bp.taskId].gen({ trackId: bp.trackId, rung: bp.rung, params: bp.params, set: bp.set, seed: bp.seed,
                                      lureCount: bp.lureCount, lureMode: bp.lureMode, protocol: bp.protocol,
                                      targets: bp.targets == null ? undefined : bp.targets });   // Wang: 10
  …play (rule card = bp.ruleCard, feedback = bp.feedback, strategy card = bp.strategyCard, tape if bp.assist)…
  var result = HF.tasks[bp.taskId].score(spec, log);
  var c = HF.engine.commit(records, bp, spec, result, { now, sessionId: plan.id, t: blockStart, interrupted, frame });
  records = c.records; d = c.derived;   // c.events → debrief (respect e.reveal: 'now' | 'session-end')
var end = HF.engine.endSession(records, plan.id, { now, endedBy: 'done' | 'quit' | 'fatigue' });
// page closed mid-session → var rp = HF.engine.resumePlan(records, sessionId)  // { plan, done: { slotId: block }, session } | null
```

Phase 4 (12 Nov) additions the UI and store use: `plan.counts = { ok, reason, waitMs? }` (would this session count,
computed at `opts.now`; the 'not-counted' note follows it), `HF.engine.resumePlan` (the plan stored on the open
session record; null for sessions begun before 12 Nov → re-plan as before), `session.completed` = finished slots,
`HF.engine.compactRecords(records, now, opts)` (store, near the storage limit), `derived.study.left` and
`derived.tracks[id].blockMs` (median measured block duration).

`bp.taskId` is `nback | relations | span | vsearch`; Relations has one `gen/score` for all its tracks. All engine
functions return new records objects and never mutate their input; they never bump `rev` (the store does).
A slot that is replayed after a pause gets a fresh seed: pass `{ attempt: k }` in the session state or simply
commit the interrupted block first (its seed is then `…:1`). If the player regenerates a stream itself
(`seed + '/r1'`), `commit` stores `spec.seed`, the seed actually played. Free play has no separate pace: on
n-back tracks and Equal Steps the odd rungs are the fast pace (`catalog.levelLabel` says "· fast").

Events from `commit`: `level-up`, `level-down`, `pb` (new peak level), `badge`, `unit-passed` (`stage:
'criterion'|'check'`), `check-failed`, `tier-open` (Grid tier; T8 with `optional`), `track-available`,
`fatigue` (once per session), `assist-faded {trackId}`. From `endSession`: `session-counted`, `week-goal`, `stretch-valve`,
`protocol-complete`, `wang-day` (the day's accuracy), `levels-revealed` (Stretch), `badge`.

What the screens read from `derive` (all plain data):

| Screen element | Field |
|---|---|
| Today: next session, "block 4 of 14", estimate, notes | `HF.engine.plan(...)`: `slots.length`, `estMinutes`, `notes[].text`, `introduce`, `counts` |
| Today: "Continue", "6 of 14 blocks done" | `session.completed` (finished slots), `HF.engine.resumePlan(records, id)` |
| Weekly ring, make-up, fresh start, pause | `week` (`target`, `count`, `days[]`, `remaining`, `daysLeft`, `reachable`, `freshStart`, `paused`, `weeksMet`) |
| Programme milestones (every 5 sessions) | `programme.done` of 20, `sessionsCounted` |
| Levels per version, level-equivalents | `tracks[id].levelLabel`, `catalog.fullLabel(id, level)`, `tracks[id].levelEqText`, `tracks[id].peakLabel` |
| Zone meter | `tracks[id].zone` (`last` ≤ 3 BAs vs `D`/`U`; Mastery: `qualifying`) |
| Lifetime counters, personal bests | `counters`, `pbs[id]` (`peak`, `bestBA` per rung) |
| Badges (show only earned; mark new) | `badges` (id → earnedAt), `badgesUnseen`; texts in `HF.badges.LIST` |
| Availability, "opens when …" | `tracks[id].available`, `catalog.gateText(id)` |
| Free play + coach | `HF.coach.suggest(d, { now, trackId })`, `HF.coach.options(d, id)` (predicted BA per rung) |
| Mastery Path | `mastery.units[id]` (`label`, `status`: open / pending-check / passed / moved-on / reopened), `current`, `checkDue`, `reviewDue` |
| Protocols | `protocols.cao / caoTrad / wang / jaeggi` (sessions, levels, follow-up date), `HF.protocols.due(id, st, now)` |
| Stretch lock and safety valve | `stretch.open`, `stretch.valve.active` |

## 3. Records written by the engine

- **SessionRecord** (SPEC §3.2) plus `updatedAt`, `sessionIndex` and, while open, `plan` (the planned slots in compact
  form: plan fields plus per slot only what `prepare` cannot derive; `endSession` deletes it). `completed` = finished
  slots (distinct slots with a block that was not interrupted; a retried slot counts once, an interrupted attempt
  never) and is kept current by `commit`; the goals' "half of the planned blocks" uses the same count;
  `endedAt`, `endedBy`, `minutes` and `counted` are set by `endSession`. `minutes` = `opts.minutes` if given, else
  active time: each block's measured duration (`t` → commit; capped at twice its nominal length + 2 min; nominal
  length when unmeasured) plus the gaps before, between and after blocks, each capped at 2 min — a session resumed
  hours later or left open does not count the time away. `derive` recomputes `counted` from the
  rules below, so the stored flag is a convenience, not the source of truth.
- **BlockRecord** (SPEC §3.3) plus `slotId`, `purpose` (`unit|corrective|check|review|maintenance|followup|train|
  warmup|assist`), `lurePlan` (the plan's position-lure setting, 4 / Stretch 6), `lures` (per stream, from the
  spec), `lureMode`, `targets`, `study` (arm), `attempt`, `capRung`, `endedAt` (commit time), `durationMs`
  (`t` → commit when the player passes the block start as `t`). `lureCount` is the number of lures the spec
  actually has per stream (`spec.meta.lureCount`, else the mean of `spec.meta.lures`; e.g. 0 at 1-back, 6 for
  Transform = 4 position + 2 identity); the learner model's difficulty uses `lurePlan`. The compact result adds `n`
  (scorable trials) and `voidedRatio`. Block ids are `b-<sessionId>-<slotId>-<attempt>`.
  Stored blocks are slim (Phase 4, CA-05): fields that would be null are left out (absent = null), result floats are
  rounded to 4 decimals, `rungParams` is left out when it equals `HF.catalog.params(trackId, rung)` (Transform's
  default `step: 1` ignored) — readers use `b.rungParams || HF.catalog.params(b.trackId, b.rung)`. A ladder change must
  therefore keep the params of existing rungs (or migrate blocks without `rungParams`). About 1,050 → see the
  sim report for sizes. `compactRecords` later trims training blocks older than 90 days to `MIN_TOP`/`MIN_EXTRA`
  (engine.js) with `compacted: true` and a one-time `updatedAt` bump (merges keep the compacted copy); exports print
  blanks for what it drops (frame, endedAt, lures, dprime, crit, baMean when y exists, stream rt/lfa/lt, most of extra).
- **EventRecords**: `track-intro {trackId, sessionIndex}` (beginSession) and `mastery-check {unitId, ba, pass,
  sessionId}` (commit, after a unit's second check block). `derive` also reads `lesson-passed/failed`, `override`,
  `note`, `goal-pause`, `study-enrol/draw/code/leave` and `badge-ack {badgeId}` (for `badgesUnseen`).
- Optional settings read by the engine (kept by `HF.schema` as unknown keys): `gridT8` (opt into Grid T8),
  `sprint: { nback: trackId }` (Sprint's n-back version), `caoArm: 'exec'|'trad'`.

## 4. Rules as implemented (numbers from SPEC §5–§6 and PLAN §4.4, §5, §7)

**Controller.** Rated block: up if BA ≥ U, down if BA < D (weaker stream decides). Sprint +2 rungs per up move
until the track's first down move in the session; placement +2 until the track's first down move ever. Span: up
if recall ≥ .80 (Stretch .70) and judgements ≥ .85, down if recall < .60. Paused, > 20 % voided or unscored
blocks move nothing and do not update the model (Span: more than 1 of its 3 lists voided — `controller.voidLimit`,
Phase 4 CA-10). Free play moves a level only when played at that level.
Self-correction: per track and mode, every 10 rated blocks outside placement and away from the ladder's ends,
the mean BA vs the mode target (.80/.85/.72/.80/.80) shifts U and D together by ±.01, clamped to [−.01, +.05]
(Phase 4, CA-02: a lower U would let a familiarity responder, BA ≈ .857 with 4 lures / .786 with 6, climb).
Fatigue: two consecutive rated blocks ≤ mean of the session's first two rated blocks − .15 (fires once).

**Warm-up** (first block of each task in a session): level − 2 rungs (n-back, Equal Steps, Grid), − 1 (Stream,
Span, search), never below 0. Updates the model, never the level. Free play has no automatic warm-ups.

**Placement.** A track with no level-moving block sits at one rung below the highest rung the model predicts at
≥ the mode target (0 when the model has no data at all); its level is recomputed until its first rated block.

**Session template.** `round(12 · minutes / 25)` rated blocks (10–30 min) split by the balance setting with
largest remainders (every task with weight > 0 gets ≥ 1), plus one warm-up per task: 25 min = 14 blocks;
Span on = 40/35/25 → 5 + 4 + 3 rated + 3 warm-ups = 15. `plan.estMinutes` (Phase 4 addendum) sums per block the
learner's median measured duration on that track (`tracks[id].blockMs`, last ≤ 20 finished blocks, ≥ 3 needed) or
else the catalog estimate, + 15 s each. Block counts deliberately do not follow measured time (Grid and search blocks
end on the answer, so a fast player's "25-minute" session can take 12–15 min); making counts time-based would change
the programme's dose and the Study arms' block matching, so it is left as a product decision.

**Varied** — ramp by session index (counted sessions + 1): 1–3 blocked (each version in one run), 4–6 serial
rotation, 7+ random with ≤ 2 blocks of a version in a row and tasks alternating every 2 blocks. Introduction order
S1 Plain + Grid T1, S2 Transform, S3 Equal Steps, S4 Switch, S6 Arithmetic, S8 Dual, S10 Stream; gates first, at
most one new version from this list per session (the S1 pair excepted; if one is gated the next eligible one goes
first), Dual at once when `settings.dual` (and sound is on), Grid tiers and Span versions join when they open. A new version gets
its lesson on its first slot and, in the random phase, the task's warm-up and first rated block. Weights: n-back
versions 1 each; Equal Steps 1; newest Grid tier 1 (Stretch 2), older tiers .35; Stream .5 and ≤ 1 block.

**Lures.** `lureCount` is the number of position lures at n±1 (SPEC §5 amended): 4, Stretch 6, on every n-back
version and at every n; the generator adds the version-specific lures (Transform 2 identity, Arithmetic 2
look-alikes, Switch 3 uncued) and uses none at 1-back (Switch: half the count as uncued lures). For Equal Steps
`lureCount` is the number of near misses (step ±1): 4, Stretch 6 (12 Nov, final check: with 4 the "within ±1"
responder scores .857 ≥ Stretch's U .80/.79; with 6 it scores .786); protocols keep 4. The difficulty model adds
0.1 logit per lure above 4 on both. Grid and Stream need no count: their "all but one element fits" responders
score .50 (Grid, matched pairs, every tier and step) and ≤ .58 (Stream) — `out/phase4/engine/approx-check.mjs`.

**Stretch** — opens after 6 counted sessions (before that the plan runs Varied with a note); random from its
first session; 6 position lures (Switch too); "earlier fast pace" = n-back tracks use only their fast
half-steps from 2-back (`catalog.allowedRungs`), so a level on a standard-pace rung is played one half-step up;
a Grid tier whose next tier is open is capped at step 6 ("next tier at a longer window instead of a shorter time
on the current tier"); summary feedback every 2nd block, no per-response feedback, level changes revealed at the
session end; safety valve when two Stretch sessions in a row average < .62.

**Sprint** — blocked, Plain with grid positions (or `settings.sprint.nback`) and the newest Grid tier with digit
tails; double steps; strategy cards in Sprint sessions 1–3; per-response feedback on.

**Mastery Path** — `mastery.js` header. n-back and Relations units progress in parallel, each in path order;
unit pass = 2 of the last 3 rated unit blocks ≥ .87 on n-back and Equal Steps units, ≥ .85 on Grid units
(`HF.modes.unitPassFor`; Phase 4 CA-02, above the familiarity bound .857); a review below .75 reopens the unit for
the whole next session that plays it (closed when that session ends or another session plays it; CA-01);
the next unit may start while the previous one waits for its delayed check; checks run on a later day than the
criterion (or than a failed check); after a failed check, the session's remaining unit blocks are corrective
(3 one rung below the target, then at the target); reviews 2 → 7 → 21 days after the pass (gaps 2, 5, 14 from
the previous review), ≤ 1 per task per session. A new unit never starts mid-session on a version without its
lesson. After a task's last unit: maintenance (Varied-style random).

**Protocols** — `protocols.js` header. Wang's BlockPlans carry `targets: 10` (10 targets, 4 near misses, 6 fillers
per 20 scorable items; SPEC §5 amended) so that never pressing scores .50 and "< .50 → down" can fire; other
BlockPlans leave `targets` null (generator default 6). Choices where the papers are silent: "level the session ended at" =
levelAfter of its last block; a Cao/Jaeggi session counts toward the protocol when ≥ 10 blocks were played;
error counts are scaled to 20 items when trials were voided; paused blocks move nothing; Wang counts only valid
blocks toward a day's 5 and moves the level on the 5th; Cao "1–2 days apart" = at least one calendar day, with
a note when the gap exceeds 2 days; Jaeggi is open-ended (20 sessions suggested), one per day.
With several protocols switched on, the plan picks the first one due in the order cao, wang, jaeggi;
`plan.protocolStatus` lists them all so the UI can offer a choice (`protocolIds`).

**Study arms** (`derive.study` from `study-enrol` + `study-draw`/`study-code`): train = Varied without Span;
control = visual search with the same block count as the template (default: 1 + all rated blocks of a Varied
session; cao: 20; wang: 5) and, since Phase 4 (SC-02), 40 displays per block so it also matches in time (estimated
minutes per session from 20–30 simulated learners per arm: default search 18.4 vs Varied 17.6; Cao search 28.2 vs
exec 28.4 / trad 30.4; Wang search 7.1 vs Equal Steps 6.8; `out/phase4/engine/dose-time.mjs`); labonly = no training; cao-exec / cao-trad = Cao on Transform / Plain-with-days;
wang-steps = Wang. Before the arm is drawn the plan is empty with a note. The events carry HF.study's arm ids
(varied, search, labonly, cao-exec, cao-trad, cao-search, wang-steps, wang-search); `HF.catalog.studyArmKind(arm)`
maps them onto the planner's names (varied → train; search, cao-search, wang-search → control) for the plan and the
visual-search gate, and the plan keeps the drawn id (`plan.study.arm`, so sessions and blocks record it). Phase 3
fix: before it, a real draw or coordinator code planned nothing ("Unknown study arm"). A `study-code` event takes
its template from the code (`HF.study.decodeCode(code).template`; Phase 4 CB-03). A `study-leave` event sets
`derived.study.left`; from then on the study gates nothing and the planner plans the chosen mode (records intact).

**Counted sessions** (`goals.js`): a session qualifies when it ended `done` or `fatigue` or finished at least half
of its planned slots (Phase 4 CB-02: interrupted attempts do not count); the first qualifying session of a local day counts (Sprint: 2, ≥ 3 h apart); Stretch
needs ≥ 20 h since the previous counted session and counts ≤ 4 a week. Weekly target 3–5 clamped to the mode cap
(Stretch 4); goal pauses scale the week's target by the share of days not paused; `weeksMet` only grows.

**Sets.** `catalog.trainingSets(trackId)` = `HF.sets.forTrack` when loaded (else the catalog list); glyph
families collapse to `glyphs`, resolved to the family of the session (`glyphsA…H`, changing every 5 sessions);
Lab-only sets are never returned. Varied sessions 1–3 use default sets; otherwise each block takes the least
recently used set of its track (seeded tie-break). Sprint and protocols use fixed sets. Transform rule variants
(`params.step` ∈ {+1, +2, −1}) appear only on non-day sets from the random phase on, after 12 rated Transform
blocks (`HF.planner.config.transformVariants`); Cao's days always keep +1.

## 5. Learner model

SPEC §6 formula: θ_eff = θ_general + θ_task + mean θ_family + θ_structure + θ_track; ŷ = logistic(θ_eff − d);
predicted BA = .5 + .5 ŷ (Span: predicted recall = ŷ); K = max(.15, 1/(1 + .05 n_track)), n_track decayed by
exp(−days/60). Difficulty bases (logits, our design): Plain −2.2, Dual −1.4, Transform −1.2, Arithmetic −1.0
(+0.5 per rung = 1 per n; ±0.1 per position lure away from 4; −0.1 uncontrolled lures); Transform (days, +1) is
thus exactly one n harder than Plain at the same rung, as Cao 2026 Fig. 4 shows (executive ≈ 1 level below
traditional), and its "two after" / "one before" variants add 0.25; Switch −1.5 + n − 1 + 0.3 per sub-step;
Equal Steps −1.3 + 1.6 per extra back + 0.4 per number range + 0.2 fast; Grid tiers −2.0 … −0.3, T8 +0.6, plus
0 … 3.0 over R1–R9; Stream −1.0 … +1.2; Span −2.0 (Backward −1.6) + 0.55 per item; visual search −2.5 + 1.6 per
doubling of the display (8 … 64 symbols) + 0.25 for the 2 s window, + .5 per further halving of the window
(1.5 s ≈ +.46, 1 s +.75: the two top steps added 12 Nov; −2.5 … +3.05 over its 20 steps). n-back ladders run to
16-back since 12 Nov (r = 0…31, the same 0.5 logit per half-step).
With θ = 0 the model predicts Plain 1-back .95, 2-back .89, 3-back .78.

**Update weights** (SPEC §6 as amended 6 Nov): track 1, structure .5, family .5, task .35, general .2 —
research/03 §6.4's order. The first SPEC draft listed the numbers in the reverse order; the simulations
(sim-report §4) found the same controller behaviour either way and better predictions with this order.
`HF.learner.config.weights` switches it.

## 6. Other decisions worth knowing

- Labels (Phase 4, PQ-14): `catalog.levelLabel` never contains the version's name ("3-back · fast", "2-back up to
  29", "Tier 2 · step 4 of 9", "Step 2 of 6", "40 items · 2.0 s"); `fullLabel` and Mastery unit labels add the name
  once. The coach gives one card per version (Growing skips versions already suggested; PQ-09). Grid rule-card
  examples use the set's own symbols (PQ-11). Assisted BlockPlans carry `aid: 'tape'|'highlight'` (PQ-03).

- Badges: `exec-all` = Transform, Arithmetic and Switch each played at least once (they all unlock together at
  Plain 2-back, so "unlocked" alone would be trivial); `rel-different` / `rel-five` = Grid T3 / T5 opened;
  `explorer` = the eight core versions played and every training set of those versions used once (glyph
  families count as one); `rules-learned` = `lesson-passed` for `lesson.nback`; `comeback` = a training block
  ≥ 14 days after the previous one; `nback-3/5` also count protocol levels.
- `pb` events only for a new peak level on a track (best BA per rung is in `derived.pbs` for the Progress page).
- Mastery uses SPEC §6's U .87 / D .73 inside units (research/03 suggested .92/.78; PLAN's ".85" is the unit pass).
- Zone meter: last three rated BAs of the track against the current mode's U/D (offset included); in Mastery
  mode also `qualifying` (which of the unit's last three blocks at the target were ≥ .85).
- **Assisted blocks, per track.** `derive.assist.tracks = { [trackId]: { start, atCriterion, active } }` (plus
  `assist.active` = any track, kept for lessons.js). A track starts at its first `assist-start {trackId}` event
  (contracts-ui §3; the lessons write it after two failed checks: `nback.plain`, `rel.grid.T1`), or — older data —
  at the second `lesson-failed` of `lesson.nback` / `lesson.grid` without a pass. Plain n-back and the Grid can be
  assisted at the same time. While a track is active, `plan` and `prepare` turn its rated slots into `assist`
  blocks (Plain: 2-back, memory aid on; outside the model and the levels; its lesson is not offered again); each
  track fades on its own after two assisted blocks at the check criterion (n-back ≥ 4 of 6 targets, Grid ≥ 7 of 10,
  ≤ 2 false presses; the bar follows the track, `HF.derive.assistBar`, not the scorable count — Phase 4 CA-09) or when its lesson is passed later, with one `assist-faded {trackId}` event from `commit`;
  that track's remaining slots are then prepared as normal rated blocks. A later `assist-start` for the same
  track does not restart it.
- **Sound off** (`settings.sound === 'off'`, `derive.soundOff`): `tracks['nback.dual'].available` is false with
  `blockedBy: 'sound'`, so Dual is never scheduled (pools, introductions incl. `settings.dual`, Sprint's version,
  Free play's list, the coach); audio sets (`tones`, `lettersAudio`) are never chosen for any track; Jaeggi's
  protocol is not offered (note `sound-off`); the Mastery Path passes over Dual units for now and returns to them
  when sound is on; a Dual slot prepared after sound was switched off mid-session is played as Plain n-back
  (`bp.replaced = 'nback.dual'`). Varied/Stretch plans carry a `sound-off` note once Dual is introduced, chosen in
  Settings, or due (session 8+).
- **"All introduced"** note (Varied, Stretch): when every version available to the user (any track with
  `available`, visual search excluded) has been introduced or is introduced in this plan, the plan carries
  exactly one `{ code: 'all-introduced', text: 'All versions introduced — from now on Long-Horizon keeps mixing them
  (maintenance).' }`.
- Span's processing time limit (`params.procLimitMs`): mean + 2.5 SD from the last span blocks' `extra.procRtMean`
  / `extra.procRtSd` (or `extra.procLimitNext`), clamped 2.5–8 s; 4,000 ms until measured.

## 7. Tests

- `node tests/unit/run.mjs engine-` — 7 files, about 3 s, including a contract test that feeds BlockPlans of every
  track (and the three protocols) through the real generators and scorers when they are loaded.
- `node tests/sim/run.mjs <scenario> [--n 300] [--days 60] [--json out.json]` — simulated learners (see
  sim-report.md); `node tests/sim/derive-perf.mjs` — derive timing on 5,000 blocks.
