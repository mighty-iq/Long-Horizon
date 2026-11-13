# UI contracts (Phase 2) — views, player, lessons, share, routes

Owned by the orchestrator. Phase 2 agents implement and consume exactly these shapes. If you need a change, put it in your final report; do not silently diverge.

## 1. Views (`HF.views[key]`)
Keys: `nback` (P1a), `relations` (P1b: dispatches on `spec.trackId` → steps / grid / stream), `span` (P1b), `vsearch` (P1b), and Lab tests `lab.sspan`, `lab.update`, `lab.bind`, `lab.matrix`, `lab.series`, `lab.graph`, `lab.switch` (P2). The Lab probes `lab.nback` and `lab.rel` reuse `nback` and `relations`.

```js
HF.views[key].create(root, spec, ctx) → view
// root: an empty element the view fills (stimulus area + response pads)
// ctx:  { assist: { tape?: bool, highlight?: bool, steps?: bool }, feedback: 'none'|'per-response',
//         hand: 'right'|'left', keys: HF.input labels, sound: bool, lab: bool }
view.prepare(trial)   // called during the previous blank interval (timer, not rAF): build/patch DOM off-screen
view.show(trial)      // inside rAF: reveal the prepared item — toggle classes/visibility only
view.hide(trial)      // inside rAF: conceal (streams) — toggle only
view.sound(trial, audioWhen)   // optional, streams with audio: schedule HF.audio.tone/clip at audioWhen (may be null → no sound)
view.feedback(outcome)         // optional per-response flash: outcome 'good'|'bad' → data-fb on the pad, ≤ 3/s, never red
view.pads             // array of pad elements (data-key="match|match2|no"), for HF.input touch handling
view.destroy()        // remove listeners and DOM
// Custom flows (span, matrix, series, graph, sspan, update, bind) may instead provide:
view.run(ctx2) → Promise<log>   // ctx2: { timing: HF.timing, input: HF.input, onProgress } — must use HF.timing.frame()
                                 // for onsets, event.timeStamp for RTs, honour HF.timing pause (void the current item)
```
Runners: streams → `HF.timing.runStream(spec, view, opts)`; discrete → `HF.timing.runDiscrete(spec, view, opts)`; custom → `view.run(ctx2)`. Logs must match SPEC §4 (+ the core supersets) so `score(spec, log)` works unchanged.

## 2. Player (`HF.player`, P1a)
```js
HF.player.runBlock(blockPlan, opts) → Promise<{ status: 'done'|'quit', spec, log, result, commit: null|{ events } }>
// blockPlan: from HF.planner.prepare(...) — or hand-built for lessons/practice:
//   { trackId, rung, params, set, seed, lureCount?, lureMode?, protocol?, role: 'rated'|'warmup'|'tutorial'|'assist'|'free'|'probe', ruleCard? }
// opts: { root, ruleCard: true, countdown: true, feedback: 'none'|'per-response', assist: {...},
//         commit: true (false for lessons/practice/Lab), debrief: true, allowQuit: true, sessionId }
HF.player.runSpec(spec, viewKey, opts) → Promise<{ status, log, result }>   // Lab tests & probes: no engine commit, no debrief by default
HF.player.countdown(root) → Promise                                        // the 3-2-1 lead-in (reusable)
HF.player.pauseOverlay(root, { onResume, onHelp, onEnd })                   // reusable pause UI
```
Rules: the player calls `HF.audio.unlock()` and `HF.timing.keepAwake(true)` in the Start gesture; hides chrome (`HF.ui.shell.chrome(false)`) during blocks; a paused stream restarts with a fresh seed (`seed + '/r1'` …) after the countdown; a paused discrete block resumes with `HF.timing.resume()`.

## 3. Lessons (`HF.ui.lessons`, P4)
```js
HF.ui.lessons.needed(trackId, records) → lessonId|null      // first lesson required before a track's first block
HF.ui.lessons.run(lessonId, root) → Promise<{ passed: bool, assisted: bool }>
HF.ui.lessons.list() → [{ id, title, trackIds, minutes }]
```
The session screen calls `needed` before preparing each slot; if a lesson is needed it runs it in place, then continues. Lessons write `lesson-passed` / `lesson-failed` events (SPEC §3.5) and, after two failed checks, an `assist-start {trackId}` event; the engine fades assistance after 2 assisted blocks at criterion (`assist-faded`).

## 4. Share (`HF.ui.share`, P3)
`HF.ui.share.text(records, derived, { includeLevels }) → string` and `HF.ui.share.open(root?)` (copy box + clipboard). The session end summary shows a "Share to Discord" button calling `open()`.

## 5. Routes and owners
| route | params | owner |
|---|---|---|
| `today` | — | P3 |
| `welcome` | — | P4 (first run) |
| `session` | `{ free?: { trackId, rung, pace }, protocol?: id, practice?: bool }` | P1a |
| `learn`, `practice` | `{ lessonId? }` | P4 |
| `lab` | — | P2 |
| `labvisit` | `{ kind, config }` | P2 |
| `study` | — | P2 |
| `progress`, `history` | `{ trackId? }` | P3 |
| `free` | — | P3 |
| `settings` | `{ section? }` | P3 |
| `about` | — | P3 |
`js/app.js` (core skeleton; final wiring in Phase 3): boots the store, mounts the shell, shows the Chimera pop-up, then routes to `welcome` if `!profile.firstRunDone`, else `today`.

## 6. Engine events → UI
`HF.engine.commit` returns events: `level-up`, `level-down`, `pb`, `badge`, `unit-passed`, `tier-open`, `track-available`, `fatigue`, `assist-faded`. The debrief shows level changes in words; `level-up`/`pb` get the 1 s celebration (not in Focus mode, not with reduced motion); `badge` events are collected and revealed on the end summary; `fatigue` offers to end the session; `tier-open`/`track-available` show a one-line note ("New: Equal Steps is open — a short lesson comes first").
