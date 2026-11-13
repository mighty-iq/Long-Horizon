# Long-Horizon — core technical contract (stable part; task/mode specs go in SPEC.md, written in Phase 0)

Every module author (me or a subagent) follows this file. Change it only on purpose and note the change in CLAUDE.md §8. Engineering rules with sources: `research/06-technical.md` (44 rules).

## Runtime
- One global namespace `window.HF`. Classic scripts only (no ES modules, no `fetch`/XHR of local files, no file-based Workers; Blob workers are fine; no required service worker). `index.html` loads files in a fixed order: `js/core/*` → `js/engine/*` → `js/tasks/*` → `js/lab/*` → `js/ui/*` → `js/app.js`. Network at runtime: none, except the Discord link the user clicks (and `sw.js` on GitHub Pages only).
- **Pure modules** (no DOM, no timers, deterministic given a seed): `js/core/rng.js`, `js/core/stats.js`, everything in `js/engine/`, every generator and scorer (`js/tasks/*/gen.js`, `js/tasks/*/score.js`, `js/lab/*/gen.js`). They must load in node for tests. Pattern:
  ```js
  (function (root) {
    'use strict';
    var HF = root.HF || (root.HF = {});
    var api = { /* ... */ };
    HF.thing = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
  Node tests load dependencies in order with `require()` into `globalThis` (helper `tests/unit/load.mjs`).
- **ES2019** syntax at most (no `?.`, no `??`, no top-level await). No runtime libraries. Charts are hand-drawn SVG.

## Randomness
- `HF.rng.create(seed)` → generator with `next()` (float in [0,1)), `int(lo, hi)` inclusive, `pick(arr)`, `shuffle(arr)` (copy), `chance(p)`, `weighted(items, weights)`. Algorithm: sfc32 seeded via a string hash (cyrb128). Every block stores its seed so it can be regenerated for checks.

## State and storage (`js/core/store.js`)
- Namespaced localStorage keys: `long-horizon.v1.main` (settings, levels, learner model, block/session summaries, Lab and Study records) and `long-horizon.v1.trials.<sessionId>` (training trial logs, one key per session). Each record has `schema`, an `id`, and the main doc a `rev` counter. *Amended 13 Nov (rename):* 1.0.0 used the working name's prefix; when `long-horizon.v1.main` is absent the store copies those keys once, never writing or deleting them (`copyLegacy` in `js/core/store.js`, `status.legacy`).
- **Append-only records** (sessions, blocks, Lab visits, trials) with unique IDs; settings and levels are last-writer-wins with a timestamp. Two tabs: on a `storage` event, re-read and **merge by ID** (never drop the other tab's records); never overwrite a higher `rev` without merging first.
- `HF.store.state`, `HF.store.save()` (debounced; **never while `HF.timing.busy`**, re-arms until idle; uses `requestIdleCallback` with a `setTimeout` fallback), `HF.store.flush()` (block end, `pagehide`), `HF.store.persistent` (false when storage is blocked → memory mode with a "not saved here — use Export" notice), `HF.store.exportText()`, `HF.store.importText(text)` → `{ok, error, migratedFrom}` with schema guard, migrations and merge, `HF.store.reset()`.
- **Quota:** training trial keys are capped to the most recent ~60 sessions (~10 KB each); on a quota error drop the oldest *training* trial keys first, never Lab/Study records or summaries; warn once and suggest Export. Request `navigator.storage.persist()` where supported. Track `lastBackupAt`.
- **Lasting memory mode (Phase 4, CA-04/05):** whenever nothing can be saved, `HF.store.persistent` is false and `HF.store.status` says why: `reason` ∈ `blocked` (storage unavailable, e.g. a sandboxed preview) · `write-failed` (a write threw) · `quota` (main no longer fits, after the trial logs were dropped and one forced compaction) · `newer` (data written by a newer Long-Horizon: this tab never writes over it, at load, at the re-read before a save, or on a storage event). `status.message` holds the user text for that reason (Today shows it); subscribers get `{ source: 'status', reason }` when a running page switches. Export keeps working.
- **Size:** each save measures main (`status.mainChars`). From `nearFullChars` (2.5 M characters; configure()) the store first calls `HF.engine.compactRecords(records, now, { force, targetChars })` if it exists (it returns records or `{ records }`; compacted records must carry a newer `updatedAt` so they win merges in other tabs), then sets `status.nearFull` + `status.nearFullText` (an Export prompt), warns once and notifies `{ source: 'status', nearFull }`. `navigator.storage.estimate()` is not used: it reports the origin's whole quota, not localStorage's ~5 M-character limit.
- **Backups:** `exportText()` stamps `backups.lastExportAt`; `exportText({ stamp: false })` does not (e.g. to fill a copy box before anything is saved) and `markBackup()` stamps it once the user has copied, downloaded or confirmed (CB-01). Backup files carry `format: 'long-horizon-backup'`; import also accepts 1.0.0's id (`HF.schema.BACKUP_FORMATS`), and study exports `meta.kind: 'long-horizon-study-export'` (`HF.lab.EXPORT_KIND`; tools/analysis also reads 1.0.0's id).
- **Calibration removal** writes a tombstone `{ updatedAt, removed: true, tests: {} }` (not null), so merges keep the removal; readers treat it as no calibration (CB-07).

## Routing and screens (`js/core/router.js`, `js/ui/*`)
- Routes live in memory (`HF.router.go(name, params)`); the URL hash only mirrors the route via `try { history.replaceState(null, '', location.href.split('#')[0] + '#/' + name) } catch (e) {}`. In-app navigation uses elements with `data-go="route"` handled by one delegated click listener — never plain `<a href="#/…">`.
- Screen registry: `HF.ui.screens[name] = { title, render(root, params), leave() }`; `leave()` stops timers and listeners.
- `HF.ui.el(tag, attrs, children)`; `HF.ui.modal(content, {onClose, labelledBy, initialFocus})` built on `<dialog>.showModal()`, focus trap, Escape closes the top modal only, focus returns to the opener; `HF.ui.toast(text)` (role=status). Never `alert/confirm/prompt`.

## Timing (`js/core/timing.js`)
- Stimulus changes are made inside a `requestAnimationFrame` callback; **onset = that callback's timestamp**. The next callback's timestamp is logged as `shown`. Durations are counted in frames from the measured median frame interval (measured at block start); no fades.
- Responses use `event.timeStamp` (same clock as `performance.now()`; fall back to `performance.now()` if invalid); RT = timeStamp − onset. A response belongs to [onset n, onset n+1); first response per window only; ignore `e.repeat`. Keys by `event.code`; response pads act on `pointerdown` (primary pointer); everything else on `click`.
- **Voiding:** a trial is voided if `shown − onset > 1.5 × interval` (late paint) or any frame gap > `2.5 × interval` occurs while its stimulus is displayed. Voided trials are excluded from scoring and never charged. A block with > 20 % voided trials, or with any pause, changes no level and no model (logged, with a timing note). Per block log: median/max frame interval, fps, count of gaps > 2.5 intervals, low-precision flag (timestamps on a 16.67 ms grid).
- `HF.timing.busy` is true during stimulus streams; nothing else (saves, observers, re-renders, logging) runs then.
- Pause: `HF.timing.pause(reason)` keeps the **first** pause start if already paused. Escape or P, `visibilitychange` → hidden, `pagehide`, or AudioContext not running → pause. After a pause a **stream** (n-back, Relation Stream) restarts with a fresh sequence after a 3-2-1 lead-in on a tap; **discrete** trials (RI arrays, Span, Lab items) void only the current trial. Wake lock requested on Start, re-requested on visible, released at the end; failures ignored.
- Use `Date.now()` for calendar logic (days, weeks); `performance.now()` only within a block.

## Audio (`js/core/audio.js`)
- Web Audio only; the AudioContext is created/resumed in the Start click (Space and clicks unlock; Escape/Shift do not). Tones synthesized (oscillator + 5–10 ms gain ramp); clips (if shipped) embedded as base64, decoded into buffers at load (fresh buffer per decode), never during a stream. Sounds scheduled with `start(when)` on the audio clock; `baseLatency`/`outputLatency` logged; auditory RTs flagged "estimated". If audio cannot start, audio stimulus sets say so and the rest of the app works. iOS: set `navigator.audioSession.type = 'playback'` during audio blocks where available, back to `'auto'` after. Never `speechSynthesis` in a timed stream.

## UI conventions
- Mobile first (360 px wide) up to desktop; no horizontal scroll; touch targets ≥ 44 px; `touch-action: manipulation`; `user-select: none` and `-webkit-touch-callout: none` on the task area; `overscroll-behavior: none`; never `user-scalable=no`; no animation during stimulus streams; `prefers-reduced-motion` respected; colour never the only cue (Okabe–Ito palette per theme, plus shape/pattern/label); forced-colours safe stimuli (borders/glyphs); ≤ 3 flashes/s, no saturated red.
- Colours as CSS custom properties on `:root`, light and dark themes (`data-theme`), system default.
- **Default keys (one scheme, shown on every rule card):** J = match / yes / true / present; K = sound match (Dual); F = no (only in tasks that answer every item: RI arrays, Span judgements, visual search); Space = continue; Escape or P = pause. All remappable (preset "A/L" = Brain Workshop style for Dual). Touch: labelled buttons, "No" always on the left.
- Every control reachable by keyboard; menus use native buttons; status messages via `role=status`; no live announcements during a stream.

## Tests
- `tests/unit/*.test.mjs` (node, no deps) — `node tests/unit/run.mjs`.
- `tests/e2e/*.py` (Playwright, **Chromium only**; at most 2 browser sessions at once) — desktop 1366×768 and phone 390×844; also as `srcdoc` of an iframe with `sandbox="allow-scripts"`, with storage blocked, and with `--autoplay-policy=document-user-activation-required`; gestures only through real clicks/keys.
- `tests/sim/*.mjs` (node) — simulated learners per mode; shortcut solvers per generator.
