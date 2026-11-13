# Long-Horizon design system — notes for screen builders

Owner: design agent. Files: `css/app.css`, `js/ui/components.js`, `js/ui/shell.js`, `js/ui/chimera.js`,
`docs/dev/styleguide.html` (live catalogue). Screenshots: `out/design/`
(`sg-*.png` full pages, `review/*` one image per section, `chimera-*`, `more-sheet-*`, `app-*`).

Open the style guide from disk: `docs/dev/styleguide.html`. URL options: `?theme=light|dark`, `?split=1` (light and
dark side by side), `?chimera=1`, `?more=1`, `?bare=1`, `?route=settings`, `?text=large`, `?hand=left`, `?core=1`
(loads `js/core/util.js` + `dom.js`, so components run on the real `HF.dom.el`).

## 1. Direction

A calm instrument for training working memory. The name Long-Horizon is the AI term for tasks of many steps in a
row: working memory is how many steps you can hold in mind and still work with. The mark is a half sun on the horizon
with steps leading out to it. (The kelp art of the Chimera pop-up and the sea-ink palette come from the working name
Holdfast, a kelp's anchor; they stay.)
- **Sea-ink neutrals** (fog page, white surfaces, deep blue ink), **one orange "go" key per screen**
  (Okabe–Ito orange; the Start/Continue/Resume button), blue for selection, focus and progress.
- **Graduated scales are the motif**: the ruler under the Today panel, the bezel on the weekly ring, the
  step lines of the zone meter. Use it nowhere else; everything around it stays quiet.
- Hairlines, no drop shadows on cards. Radius grows with hierarchy: controls 8, tiles 12, cards 18, the
  instrument panel and dialogs 24. Shadows only on floating layers (dialogs, toasts, the More sheet, tooltips).
- System fonts only (no embedded font). Left-aligned layouts. Sentence case everywhere; no ALL-CAPS labels,
  no arrows appended to buttons, no exclamation marks except the fixed Chimera sentence.
- **No loss framing.** Never red for "worse", never "missed", "streak", "failed"; down-steps are neutral grey
  ("Eases back"). Say "reached" or "passed", never "mastered".

## 2. Tokens (CSS custom properties)

Themes: `<html data-theme="system|light|dark">` (system = `prefers-color-scheme`). Any element with
`data-theme="light|dark"` re-themes its subtree. All text pairs ≥ 4.5:1, marks ≥ 3:1 (audited in both themes).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--hf-bg` | #EEF2F1 | #0B1D29 | page |
| `--hf-surface` | #FBFCFC | #12293A | cards, rail, tab bar |
| `--hf-raised` | #FFFFFF | #183347 | inputs, pads, popovers |
| `--hf-sunken` | #E3EAE9 | #08161F | wells, empty tracks, inset cards |
| `--hf-line` / `--hf-line-strong` | #CFD9D9 / #6F848C | #24404F / #6F8C9A | hairlines / control borders (≥ 3:1) |
| `--hf-ink` / `-2` / `-3` | #0F2A3A / #3D5562 / #566B76 | #E4EDF0 / #A9BDC6 / #8DA4AF | text / secondary / muted |
| `--hf-accent` (+`-hover`, `-press`), `--hf-on-accent` | #E69F00, ink | #E69F00, #0B1D29 | the one primary button |
| `--hf-link`, `--hf-focus`, `--hf-sel`, `--hf-on-sel` | #0072B2, white | #56B4E9, #0B1D29 | links, focus ring, selection, done |
| `--hf-sel-ink` | #00669F | #7CC4EE | selected text on a blue tint |
| `--hf-track` | #D3E2EA | #21425A | unfilled progress |
| `--hf-good` / `-text` | #009E73 / #00785A | #2BB58C | success, earned, "counts" |
| `--hf-warn` / `-text` | #B07A00 / #8A5C00 | #E69F00 | warnings |
| `--hf-bad` / `-text` / `-fill` | #D55E00 / #B34A00 / #A84300 | #E06A1B / #F08A4B / #F08A4B | danger only (data loss) |
| `--hf-tint-blue|good|warn|bad` | rgba tints | rgba tints | notice and chip backgrounds |
| `--hf-deep`, `--hf-on-deep(-2)`, `--hf-deep-line` | #0F2A3A … | #183347 … | instrument panel, Chimera art |
| `--hf-s1` `--hf-s2` `--hf-s3` | #0072B2 #D55E00 #009E73 | #3A92CC #E06A1B #009E73 | chart series, fixed order |
| `--hf-s-muted` | #6F848C | #6F8C9A | de-emphasised marks (baselines) |

Chart slots passed the dataviz validator (lightness band, chroma, CVD ΔE ≥ 8 all-pairs, normal-vision ≥ 15,
3:1 contrast) in both themes. Never more than 3 coloured series; identity also by legend/shape/label.

Type (Bringhurst scale): `--hf-t-xs` 12 · `-sm` 14 · `-md` 16 · `-lg` 18 · `-xl` 21 · `-2xl` 24 · `-3xl` 36 ·
`-4xl` 48 (in rem). Weights 400 / 600 / 700. Big standalone numbers use proportional figures; tables, axes and
counters in rows use `.hf-num` (tabular). Measure ≤ `--hf-measure` (38rem ≈ 70 ch).

Spacing `--hf-sp-1…8` = 4, 8, 12, 16, 24, 32, 48, 64 px. Radius `--hf-r-xs|sm|md|lg|xl|pill` = 4, 8, 12, 18, 24,
999. `--hf-hit` = 2.75rem (44 px, grows with large text). `--hf-dur` 160 ms (0 with reduced motion).

### Settings hooks on `<html>` (set by `HF.ui.shell.applySettings(settings)`)
- `data-theme` system|light|dark · `data-text="large"` (root 120 %; everything is in rem) ·
  `data-hand="left"` (mirrors pads) · `data-motion="reduce|full"` (null = follow the OS) ·
  `data-focus="on"` (Focus mode: hides every `.hf-mot` element).
- `data-busy` — **set it while a timed stream runs** (`HF.timing.busy`): it switches off every CSS animation and
  transition in the app so nothing moves but the stimulus. (Request to the core owner: toggle it in `timing.js`
  where `api.busy` changes; until then the player sets it.)
- Motivation-layer pieces carry `.hf-mot` (weekly ring, zone meter, badges, debrief celebration). Wrap any other
  rings/badge strips/goal widgets you build in `.hf-mot` so Focus mode hides them. The Lab never shows them.

## 3. Layout rules

- Breakpoints: **37.5em (600 px)** two-column content, side-by-side actions; **56.25em (900 px)** desktop shell.
- Phone: one column, 16 px gutters (safe-area aware), bottom tabs (64 px + safe area). Desktop: 15rem side rail,
  content column left-aligned, `max-width: var(--hf-content)` (46rem) via `.hf-page`.
- Screen skeleton:
  ```html
  <div class="hf-page">
    <header class="hf-page__head"><h1 class="hf-h1">Progress</h1><p class="hf-lead">…</p></header>
    <section class="hf-section"><div class="hf-section__head"><h2 class="hf-h2">Levels</h2>…</div> … </section>
  </div>
  ```
  The router focuses the screen's `h1` after navigation; `[tabindex="-1"]` targets get no focus ring.
- Groupings: `.hf-stack` (column, `--hf-gap`, modifiers `--sm|--lg|--xl`), `.hf-row` (wrapping row, `--between`,
  `--end`, `--top`, `--nowrap`), `.hf-grid` (auto-fill, `--hf-min`), `.hf-split` (2 columns ≥ 600 px),
  `.hf-actions` (+ `--end`, `--stack` = full-width column on phones with the primary **last**, i.e. at the bottom).
- Use **sections and lists** for structure; use cards only for a self-contained summary or choice. At most one
  `tone: 'feature'` card (the instrument panel) per screen, and one `variant: 'primary'` button.
- Text helpers: `.hf-h1 .hf-h2 .hf-h3 .hf-lead .hf-prose .hf-small .hf-xs .hf-muted .hf-soft .hf-strong .hf-num .hf-vh`
  (visually hidden), `.hf-divider`, `.hf-ruler` (the graduated strip), `.hf-kbd`.
- Task area: wrap stimulus + pads in `.hf-task` (no text selection, no callout, `touch-action: manipulation`).
- Never `href="#/…"`; navigation = `data-go="route"` (optional `data-params='{"k":"v"}'`, handled by HF.router).

## 4. Shell — `HF.ui.shell` (js/ui/shell.js)

- `mount(root = body, { active })` → api. Idempotent. Builds `.hf-app` > `.hf-rail` (header + `nav.hf-nav`) +
  `main#hf-screen.hf-screen` + `footer.hf-footer` + `#hf-toasts.hf-toasts` (reuses the elements from index.html).
  Subscribes to `HF.router.onChange`, so navigation marks the nav by itself.
- Nav: phone tabs **Today, Learn, Lab, Progress, More**; More opens a sheet with **Free play (`free`), Settings,
  About** and the Chimera Discord link. Desktop rail shows all of them. Escape or an outside tap closes the sheet.
- `setActive(route)` — marks `aria-current="page"`; aliases: session/welcome → Today, practice/lesson → Learn,
  labvisit/study → Lab, history → Progress; prefixes (`lab.visit`) map to the base. The footer
  "Built by the Chimera community on Discord · discord.gg/chmr" shows on the `today` route only.
- `chrome(false)` hides header, nav and footer (and makes them `inert`) for training blocks; `chrome(true)`
  restores; `chrome()` returns the state. Toasts drop to the bottom edge while bare.
- `applySettings(settings)` (SPEC §3.1 keys), `screen()`, `focusScreen()`, `openMore(bool)`, `active()`,
  `NAV`/`MORE`/`ALIAS` tables, `DISCORD`. Header slot for screen buttons: `#hf-header-aside`.

## 5. Chimera pop-up — `HF.ui.chimera` (js/ui/chimera.js)

`show({ title, onClose, returnFocus }) → Promise<boolean>`: once per page load (later calls resolve `false`), never
while `HF.timing.busy`. Uses `HF.dom.modal` (falls back to its own `<dialog class="hf-modal hf-modal--chimera">`).
Kelp-forest art, title "Welcome to Long-Horizon", the exact sentence `HF.ui.chimera.TEXT`, **Join us on Discord** =
`<a href="https://discord.gg/chmr" target="_blank" rel="noopener">`, the address printed as selectable text,
**Start training** focused (Enter or Escape closes). Phones: a bottom sheet. `art()` returns the SVG for reuse
(About, tutorial end). Do not show it over a lesson or block (app.js calls it at boot).

## 6. Components — `HF.ui.c` (js/ui/components.js)

All return DOM nodes. Strings are inserted as text (never HTML). Options marked * are required.

- **h(tag, attrs, children)** — element builder on top of `HF.dom.el` (works without it). attrs: strings;
  `false/null` skipped, `true` → empty attribute; plus `on: {click: fn}`, `style: 'css' | {prop: value}`,
  `props: {value: …}`. **svg(tag, attrs, children)**. **icon(name, {label, cls, stroke})** — 24 px stroke icons:
  today learn lab progress more free settings about info external check close chev-down chev-right chev-left warn
  good bad copy download upload pause play up down hold star sound people keyboard tap lock clock flag compass
  layers grid cross book pen return baseline target refresh edit trash plus. **mark()** — the Long-Horizon mark (horizon line, half sun in the accent, three rungs lengthening toward the viewer).
  **kbd(key)**. **fmt.pct(v, digits)** (0.86 → "86%"), **fmt.num(v, digits)** (thousands separators).
- **button(label\*, {variant: primary|secondary (default)|quiet|danger, size: sm|lg, block, solid, icon, iconAfter,
  iconOnly, kbd: 'Space', go, onClick, id, type, disabled, title, attrs, cls})**. `kbd` shows a key cap (hidden on
  touch screens) and sets `aria-keyshortcuts`. A bare `class="hf-btn"` looks like secondary;
  `.hf-btn--primary.hf-btn--danger` (used by `HF.dom.confirm({danger})`) is solid vermillion.
- **link(label\*, href\*, {variant: secondary|quiet|plain|primary, external = true, size, block, id, attrs})** —
  external links get `target=_blank rel=noopener`, an external icon and "(opens in a new tab)" for screen readers.
- **card({title, sub, level 2–4, aside, body|children, actions, tone: feature|inset|plain, go, onClick, as, id, cls})**.
  `tone: 'feature'` = the instrument panel (deep ink in light theme, tokens re-themed inside, ruler at the
  bottom; on phones its primary button goes full width). `go`/`onClick` make the whole card a button.
- **list(items, {label})**, **listItem({title\*, sub, meta, icon, go | href | onClick, chevron, external})** — rows
  for Learn, More, history. `href` rows are external links.
- **details(summary, content, {open})** — native disclosure (`.hf-details`). **dl([{label, value, hint}])**.
- **table({caption, columns: [{key, label, num, format(v,row)}], rows, label, rowHeaders = true})** — inside a
  focusable scroll box; numbers right-aligned and tabular.
- **chip(text, {tone: blue|good|warn|outline, icon})**; **levelChip({family: nback|relations|span|vsearch|lab,
  name, level, title})** — shape per family (square, triangle, circle, diamond, hexagon) + words.
- **stat({label\*, value\*, unit, note, hero})**, **stats([...])** — 2 per row on phones, auto-fit on desktop.
- **sessionBar({steps\*: [{label, group, kind: warmup|block|lesson|check, state: done|current|todo|skipped}], title,
  now, labels: auto|all|groups|none, unit = 'Block', label})** — "Block 4 of 14" + current label; one segment per
  step (done blue, current taller and orange, warm-up hatched); group labels when a run spans ≥ 3 steps
  (`all` labels every step, default when ≤ 6 steps). Each step is read out as "4. Plain 3-back, now".
- **weeklyRing({done\*, target\* (1–7), title = 'This week', note, size: 'sm', compact})** — segments per target
  session; counts up, a check when reached, extras only in the note. Default notes are gain-framed.
- **zoneMeter({title, scores: [≤3, oldest first], down, up, min = .5, max = 1, mode: zone|mastery, qualify = .85,
  summary, labels = ['Earlier','Previous','Latest'], format})** — bands below/between/above the lines, two-line
  line labels that flip inward near the edges, value tags, screen-reader sentence.
- **badge({title\*, desc, earned, date ('3 Nov'), glyph (icon name or n3/n5), text, tone: blue|amber|kelp, secret})**,
  **badges([...])** — not-yet-earned tiles are dashed; `secret` hides title and description.
- **ruleCard({chip (levelChip opts | node), meta: 'Block 4 of 14', title, rule\*, example, keys, note, hint, actions})**
  - `example`: `tape({items: ['K','T','K','R'], compare: 0, target: 2, label: '2 back: same letter', dim: [3],
    caption | spoken})` — compared item dashed, target framed, bracket between them. A string or node also works.
  - `keys`: `[{key: 'J', pad: 'Match', yes: true, when: 'the letter matches 2 back'}, {none: true, when: '…'}]`
    → a row "J or tap Match" + "when the letter matches 2 back" ("when" is added if missing). `hint: false` hides
    the Space/Esc line.
- **debrief({index, total | count, chip, line\*, celebrate: level|best, cheer, score (0–1 or text), scoreLabel,
  next, nextLabel, dir: up|same|down, details: [{label, value, hint}] | node, detailsLabel, actions, auto})** —
  plain line first (it is the region's heading), score and next level in words, details behind a toggle. The
  celebration is one 1 s pulse, skipped with reduced motion and hidden in Focus mode. Don't give the countdown
  (`auto`) a live role.
- **lineChart({title, desc, series\*: [{name, points: [{x, y}], slot 1–3}] (≤ 3), x: {label, format, integer = true,
  min, max, ticks, tipLabel}, y: {label, min, max, format}, markers: [{x, label, kind: mode|rule}], smooth (window,
  e.g. 3), curve: monotone|step|linear, height, summary, emptyText})** — real-pixel SVG redrawn on resize; raw points
  under the trend; dashed rule = training style changed, dotted = rule/tier changed; legend for ≥ 2 series;
  hover crosshair + tooltip, keyboard (focus, ←/→, Home/End, Esc); **"Show as table"** twin always present.
  Use `curve: 'step'` and no smoothing for levels; `smooth: 3` for block scores.
- **dotPlot({title, desc, rows\*: [{label, note, band: {lo, hi}, points: [{value, kind}]}], kinds, min, max, format,
  unit, bandLabel = 'Noise band'})** — default kinds B1 ● / B2 ■ (muted), Q ▼ (s3), POST ◆ (s1), FU ▲ (s2);
  percentage layout (no resize work), near points offset vertically, tooltips on hover and arrow keys, table twin.
  Draw a band only when the test is calibrated; otherwise put "Not yet calibrated" in `note`.
- **empty({title, text, action, art: sprout|chart|lab|none, headingLevel})** — say what will appear, offer a step.
- **notice({tone: info|warn|good|bad, title, text, action, live: true|'assertive', slim})** — icon shape differs per
  tone. Storage blocked: `notice({tone: 'warn', title: 'Not saved on this device', text: '… Use Export to keep a
  copy.', action: button('Export now', …)})`.
- **copyBox({label, text, rows, hint, download: 'long-horizon-backup.json', mime})** — read-only textarea + Copy (falls
  back to select + "Press Ctrl+C") + optional Download; `node.setText(t)`. **copyText(text, textarea)** → Promise.
- Forms: **field({label, hint, control})** (wires `for` and `aria-describedby`), **toggle({label, hint, checked,
  onChange(bool)})** (checkbox `role=switch` + On/Off word), **segmented({legend, name, options: [{value, label}],
  value, onChange, hint})** (radio group), **select({label, hint, options, value, onChange})**. Inputs:
  `class="hf-input"`, ranges `class="hf-range"`.
- **pads({pads\*: [{id: match|match2|no, label, key, kind: yes|no|alt, icon (name | false)}], mirror, fixed, size: 'sm',
  label})** → `div.hf-pads > button.hf-pad[data-key]`. "No" (`kind: 'no'`) is always on the left; left-handed
  (`html[data-hand=left]` or `mirror`) swaps the other pads; `fixed` opts out. Pads have no transitions; the
  player may set `.is-down` and `data-fb="good|bad"` (solid green ring / dashed vermillion ring; ≤ 3 per second).
  Typical sets: n-back `[{id:'match', label:'Match', key:'J'}]`; Dual `[{id:'match', label:'Position', key:'J',
  icon:'grid'}, {id:'match2', label:'Sound', key:'K'}]`; arrays `[{id:'no', label:'No', key:'F'}, {id:'match',
  label:'Match', key:'J'}]`.

## 7. Overlays (HF.dom)

- `HF.dom.modal` → `<dialog class="hf-modal">` with `.hf-modal__body`; inside use `.hf-modal__title`,
  `.hf-modal__text`, `.hf-modal__actions` (primary last). Phones (< 600 px): a bottom sheet with stacked actions.
  `.hf-modal--fallback` / `--polyfill` cover browsers without `showModal`.
- `HF.dom.toast(text, {kind})` → `#hf-toasts > .hf-toast.hf-toast--info|warn|error|ok` (ink bubble, kind as a side
  bar, `.hf-toast__close` is 44 px). Toasts sit above the tab bar on phones, bottom-right on desktop.

## 8. Accessibility checks run (Chromium, 1366×768 and 390×844, light and dark)

Contrast audit of every rendered text node (0 below 4.5:1, or 3:1 for large text), no horizontal overflow at 360,
390 (also with large text) and 1366 px, touch targets ≥ 44 px, forced-colours render, reduced motion, keyboard:
pop-up focus/Enter/Escape and trapped Tab, More sheet Escape, chart crosshair by arrow keys, tables present,
0 console errors with and without the core. (the screenshot script used during the build is not part of the repo; `docs/guide/make_shots.py` and the e2e tests take screenshots now)
(screenshots + overflow + contrast; add `'&core=1'` as a second argument to load the core), `interact.py` (31
keyboard/touch/ARIA checks) and `app_check.py` (index.html boot with the pop-up). Chromium only, one browser.
