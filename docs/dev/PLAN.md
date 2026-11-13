> **About this file.** This is the design plan (v3, 30 Oct 2026) written before the build, kept for contributors as the record of *what* was decided and *why* (written under the working name Holdfast). It was addressed to the community member who commissioned Holdfast for the Chimera Discord, hence "you". What was actually built is described by `SPEC.md` (with dated amendments) and the code; where they differ, SPEC.md and the code win, and the reasons are in `docs/dev/*-notes.md`. The research notes the plan cites (`research/01–09`) are not part of this repository; the sources are listed in the guide (chapter 13, `docs/Long-Horizon-Guide.pdf`).

# Holdfast — plan for a working memory trainer and lab (v3)

**Status:** plan only, v3 (30 Oct 2026). v2 was revised after an independent review (32 issues fixed); v3 aligns the tasks with the full texts of the two papers you sent (Cao et al. 2026; Wang, Sun & Xiao 2025). Nothing is built yet; the build starts when you say go.
**Name:** *Holdfast* (confirmed): the clamp that holds work steady on a bench, which is what working memory does for thinking. A PC game shares the name, in a different field.
**For:** the Chimera community on Discord (https://discord.gg/chmr).
**Research behind it:** seven research passes plus full-text extractions of the two papers; notes with citations and verification tags are in `research/01–09` (about 6,000 lines), condensed in `research/00-digest.md`. Unverified points are marked there, and every number here comes from those notes.

---

## 0. In one paragraph

Holdfast trains the two tasks you asked for, including the exact versions from the two papers. **Executive N-Back** is Cao et al. 2026's task (press when the day shown is the day *after* the day n back), with switching and arithmetic layers on top of classic n-back. **Relations** (relational integration) is Wang et al. 2025's **Equal Steps** number stream, plus the grid task the measurement research uses. A third facet, **Span** (storage plus processing), is opt-in. Variety is built in (stimulus sets, versions, rule tiers, kinds of difficulty), starting narrow and then interleaved. **Six progression modes** share one learner record, because the research frameworks really do conflict: fastest gain on the trained task vs best chance of transfer, gating vs free practice, about 85 % success vs harder. One of them, **Protocols**, runs the two papers' procedures exactly. An optional built-in **Lab** measures near, mid and far transfer with untrained, generated tests. A **Study mode** with an active control lets the community run a real experiment, including replications of both papers. Progress shows through quiet, informative gamification (levels, bars, weekly goals, milestone badges, graphs, full logs) that never appears during a block. Beginners learn by playing a guided tutorial whose supports fade, and a **Chimera pop-up** greets every launch. It runs from one HTML file on a computer, from GitHub Pages on phones (installable, works offline), and inside sandboxed previews; data stay on the device.

**The honest headline:** people get much better at the trained tasks and often at very similar untrained ones. Controlled studies mostly find no gain in reasoning or IQ, so Holdfast measures transfer instead of promising it.

---

## 1. What the research says, and what it changes

### 1.1 Executive n-back (Cao et al. 2026, full text read)
- **What it is:** classic n-back with one added operation. The items are the 7 days of the week, shown as words. You press when the day shown is the day **after** the day n back (2-back: Tue, Sat, **Wed**). The traditional version presses when it is the **same** day. The idea comes from León-Domínguez et al. 2015 (*Behav Brain Res* 292:167–173), an imaging study that added a manipulation demand to n-back with days of the week.
- **Protocol:**
  - Each day shows for 500 ms, then a 2.5 s fixation cross.
  - Blocks of 20 + n items with 6 targets; you press only on targets.
  - 20 blocks per 30-minute session, starting at 1-back in session 1.
  - Within a session, n goes up after more than 18 correct and down after 5 or more errors. By our reading this counts the 20 scored items.
  - Each new session starts 2 levels below where the last one ended (their "N-2 principle", after Fellman et al. 2020).
  - 6 sessions, 1–2 days apart.
  - Not reported: the response key, lures, feedback, and whether Sunday wraps to Monday.
- **Study:** 30 students, 15 per group, executive vs traditional n-back. There was no untrained control group. Not preregistered; data on OSF.
- **Results:**
  - Operation span improved in the executive group only (group × time p = .005, ηp² = .25).
  - Switch costs fell in both groups; the executive group's advantage was marginal (p = .069).
  - Stroop and Raven's matrices improved in both groups with no group difference; the authors suggest practice from the pre-test.
  - At the 3-month follow-up (27 people) nothing had declined significantly, but the groups no longer differed significantly on operation span or switch cost.
  - The executive group trained about one level lower (about 6.7-back vs 8.4-back by session 6).
- **Context:** a 2026 meta-analysis (Fu et al., 55 studies, N = 3,492) found that updating training transfers slightly to span tasks (g = 0.18) but span training does not transfer to updating (0.05). The difference is marginal (p = .073).
- **So:** a small, interesting, unreplicated result.
  - Holdfast's **Transform** version *is* Cao's executive n-back: same items, rule, timing and block structure.
  - The **Protocols** mode runs Cao's procedure exactly, so the community can test it.
  - The Lab measures both of Cao's main outcomes, complex span and task switching.
  - Study mode can compare executive with traditional n-back as Cao did, adding the active control Cao lacked.

### 1.2 Relational integration and the facets of working memory
- **As a measure RI is strong.**
  - A relational-integration factor correlated about .9 with reasoning at the latent level (Oberauer et al. 2008, N = 131).
  - A relation-monitoring task explained reasoning beyond complex span, short-term memory and antisaccade (Chuderski 2014, N = 243; Bateman et al. 2019, N = 100).
- **As training the record is weak.**
  - RI-trained groups improved on the trained task: within a combined programme the RI task gained net d ≈ .8, yet showed no transfer to a kinship RI task (von Bastian et al. 2013, N = 123).
  - Transfer to other RI content was weak. Hilbert et al. 2017 (N = 216) found verbal ↔ numerical transfer within the same task type only.
  - No study found transfer to reasoning (Lange & Süß 2015; Hilbert 2017; Himi et al. 2023, N = 171). Binding training gave Bayesian evidence *for* no transfer (De Simoni & von Bastian 2018).
  - **Wang, Sun & Xiao 2025** (*Brain Topography*, 29 vs 28 students; full text read) trained a number stream, Equal Steps: press when the step between numbers repeats, at 1- and 2-back, 5 blocks of 20 trials a day for 30 days. The control group did a quiz. On the only reasoning test (Sandia matrices, near ceiling) both groups improved equally, with no group × time effect on accuracy or speed. The reasoning claim in the title rests on EEG microstate changes alone.
- **Head-to-head comparison:** the only trial that compared the facets with an active control is von Bastian & Oberauer 2013 (4 weeks; details from the abstract only).
  - Storage-and-processing (complex span) training transferred to working memory and reasoning.
  - Supervision (switching) training transferred to task shifting and reasoning.
  - RI training showed no comparable transfer.
  - Effects lasted 6 months. Later facet studies did not find RI → reasoning either.
- **So:** RI is trained because it sits at the heart of reasoning and is a skill worth having. Holdfast includes Wang's Equal Steps exactly, plus the grid task from the measurement research, and labels both experimental; the Lab measures transfer. Holdfast also covers the two facets that transferred in von Bastian & Oberauer 2013: switching (the Switch version) and, opt-in, storage-and-processing (Span, §4.3).
- **Design lessons kept:**
  - Adapt on **balanced accuracy** (hits and correct rejections weighted equally), never raw accuracy. Himi 2023 found accuracy rising while sensitivity fell.
  - Keep unpressured learning steps: time pressure blocks relational learning (Chuderski 2016).
  - Never use 12 duplicate distractors, because they cue the target; 6 are fine.

### 1.3 Transfer in general
| Kind | Effect | Sources |
|---|---|---|
| Trained task | large (g ≈ .9, in older adults) | Sala et al. 2019 |
| Near: same paradigm, new stimuli | medium (untrained n-back g = .62) | Soveri et al. 2017; Gathercole et al. 2019 |
| Mid: other WM paradigms | small (g ≈ .2–.3); several well-run nulls | Melby-Lervåg et al. 2016; Rodas 2024; De Simoni & von Bastian 2018 |
| Far: reasoning, IQ, school | about zero with active controls (g .01–.06) | Au et al. 2015 (.06 active vs .44 passive); Melby-Lervåg 2016; Sala & Gobet 2020; Watrin et al. 2022 (2 years) |

- **What drives near and mid transfer** is shared structure between trained and tested tasks: d .54–.90 when they share a paradigm vs about .11–.35 without (Gathercole et al. 2019).
  - Even within complex span, transfer across content domains was small (d ≈ .12, not significant).
  - n-back training and complex-span training did not transfer to each other (Holmes et al. 2019, 48 adults).
  - Dose, adaptivity, and single vs dual n-back made no difference.
- **Pahor, Seitz & Jaeggi 2022 (3 RCTs):** within people, matrix-reasoning gains went with gains on an untrained n-back, a correlational mediation. The preregistered, actively controlled RCT 3 (N = 189) showed no overall reasoning effect.
- **Expectations matter:** a placebo framing alone raised a matrices score by d ≈ .5 within an hour (Foroughi et al. 2016).
- **So:** no tool can *ensure* mid or far transfer today. Holdfast makes choices that theory suggests *may* help near and mid transfer (breadth of processes, variety, spacing, training at the edge); none is shown to. The Lab then measures what actually happened.

### 1.4 Progression and practice
- **Adaptive difficulty:** training at the moving edge beats a fixed easy level, and a fixed level at one's own pretest average, for trained and near gains (Holmes 2009; Brehmer 2012; Lilienthal 2013; Karbach 2015). In one study, self-chosen or randomly varied difficulty matched adaptive training, and no group transferred (von Bastian & Eschen 2016).
- **Target success rate:** theory suggests about 85 % for two-choice tasks learned by gradient descent (Wilson et al. 2019); this is untested in WM training. In one large field study of adaptive practice, learners rated difficulty "about right" at 60–70 % success (Pelánek 2017).
- **Interleaving and variability:**
  - Interleaving beat blocking, g = .42 (about .29 after bias correction). This comes mostly from category learning and reverses for word learning (Brunmair & Richter 2019).
  - In motor learning, a blocked → serial → random ramp beat both pure schedules (Porter & Magill 2010).
  - Variability slows early learning and helps generalisation, so novices should start narrow (Raviv, Lupyan & Green 2022).
  - No WM training study has tested interleaving.
- **Spacing:** in children, 20 sessions over 20 days gave a reasoning gain, while the same 20 over 2–10 days did not (Wang, Zhou & Shah 2014; one-tailed p = .038). Meta-analyses show no dose-response.
- **Strategies:** teaching a strategy speeds early n-back gains, but the edge fades within weeks; strategies people find themselves predict their gains (Laine et al. 2018; Fellman et al. 2020).
- **Desirable difficulties** are *kinds* of difficulty (spacing, interleaving, variation, less feedback), not an accuracy number, and they help only if the learner can cope (Bjork & Bjork 2020).

### 1.5 Motivation and gamification
- Gamified cognitive training felt more motivating (g = .72), but cognitive outcomes were not shown to improve (g = .27, not significant; Vermeir et al. 2020).
- In a preliminary study with 107 children, a score visible during play reduced n-back gains (Katz et al. 2014).
- A richly themed n-back gave bigger in-game gains and no transfer advantage (Mohammed et al. 2017). Themed stimuli worsened the data (Lumsden et al. 2016).
- Badges plus leaderboards lowered motivation (Hanus & Fox 2015). Broken streaks cut engagement, and streaks that can be repaired soften this (Silverman & Barasch 2023). Effort rises near a goal, and a head start helps (Kivetz et al. 2006; Nunes & Drèze 2006).
- **So:**
  - Nothing on screen during a block except the task.
  - Plain-language debriefs between blocks.
  - Honest progress bars, levels and weekly goals.
  - Badges only for learning milestones.
  - No leaderboards and no abstract points.
  - A Focus mode that hides the whole layer.

### 1.6 Tutorials
- Tutorials paid off for complex games, and in-context help beat an up-front manual (Andersen et al. 2012).
- Discovery with scaffolds and feedback beat both lecturing and unassisted discovery (Alfieri et al. 2011).
- Worked examples work best followed by fading supports (Renkl & Atkinson). Experienced users need a skip path.
- **So:** a hybrid play-to-learn tutorial, plus just-in-time cards, plus a plain-text "How to play" page and a glossary.

### 1.7 Existing tools
- **Worth adopting:**
  - per-stream scoring (hits, false alarms, d′, reaction time);
  - a Jaeggi-style preset and manual level override;
  - lures that grow with n, and many stimulus sets;
  - pace and trial settings, key rebinding, and an audio offset for Bluetooth;
  - local-first with no account;
  - CSV/JSON export with merge import, graphs, and a transfer page.
- **Common frustrations:** boredom, slow pacing, plateaus at 4–5-back, levels bouncing, confusing rules (testers could not learn a relational n-back game), cluttered counters, scoring bugs, paywalls, no baseline, and inflated IQ marketing.
- **Gaps Holdfast fills:** executive n-back and RI under an open licence, an honest transfer battery, and research-grade logs.
- **Licences and a patent:**
  - No code, text, formats or sounds from Brain Workshop (GPL) or from the CC BY-NC and AGPL tools. Papers are re-implemented from their method descriptions, in our own words.
  - Posit Science's US patent 8,408,915 covers spoken syllables plus delayed on-screen text groups at an n-back offset. Holdfast never matches spoken items against later on-screen text. Independent-stream dual n-back is long-standing prior art.

---

## 2. Design principles
1. **Train at the edge, score honestly.** Balanced accuracy per stream drives levels; d′, response bias and reaction time are logged.
2. **Breadth of process.** Holdfast trains updating, manipulation, switching and relational integration, with storage-and-processing as an opt-in. Transfer follows shared structure, not surface features.
3. **Narrow first, then vary.** Blocked practice while something is new, then rotation, then random interleaving.
4. **Spaced, modest dose.** About 25 min, at most one counted session a day, 3–5 a week (default 4), with a 20-session reference programme.
5. **Measure, never promise.** Untrained Lab tests, two baselines, community-calibrated noise bands, and an active-control study option. No IQ numbers, ever.
6. **Quiet blocks, informative breaks.**
7. **Autonomy with guidance.** You choose the mode, goals and focus; a coach suggests.
8. **Learn by doing,** with supports that fade.
9. **Lab-grade data.** Trial logs with seeds, protocol versions and timing diagnostics, an open schema, and exports.
10. **Works where people are.** One offline file on computers, GitHub Pages on phones, sandboxed previews. No account; nothing leaves the device unless you export it.

---

## 3. The app at a glance

| Screen | What it does |
|---|---|
| **Chimera pop-up** | Every launch: built by the Chimera community on Discord, with a Join button. |
| **Today (home)** | Next session card with its progress bar, the weekly ring, current training style, Lab reminders, Start/Continue. |
| **Session** | Rule card → block → short debrief → next block; pause menu with help. |
| **Learn** | Tutorial and lesson replays, untimed practice, "How to play", strategy cards, glossary, and "Why Holdfast works this way" (the research, plainly). |
| **Lab** | Baselines, checks, post-test and follow-up; results; Study mode. |
| **Progress** | Levels, personal bests, zone meters, graphs, badges, weekly goals, full history, export/import, last backup date. |
| **Free play** | Any available version at any level, with the coach. |
| **Settings** | Training style, session length, weekly target, task balance, Span on/off, sound, keys, feedback, Focus mode, theme, accessibility, data. |
| **About** | Chimera, credits, licences, and what the app can and cannot claim. |

**First run.**
1. Chimera pop-up.
2. Welcome: **Start training now** (default) or **Measure first** (opt-in). Measure first shows its time cost: about 50 minutes now and 50 minutes again 2–7 days later, before session 1.
3. Tutorial: the n-back lesson (about 6 min). Lessons for the other tasks run just before each one's first block.
4. Session 1 places you quickly: blocks move two levels at a time until your first step down.

- **Measure-first path:** pop-up → tutorial → Baseline 1 → 2–7 days → Baseline 2 → session 1.
- **Start-now users** can still use the Lab. Their visits are labelled "no baseline" and show scores without a change verdict.

---

## 4. Training tasks

### 4.1 N-Back (classic and Executive)
A stream of items, two streams in Dual. For each item, decide whether it matches the item *n* steps back, after whatever operation the version asks for. Press MATCH when it does; doing nothing means "no match".

**Common parameters:**
- **Timing:** each item shows for 500 ms, one every 3.0 s (Jaeggi 2008). A fast pace of 2.5 s is a half-step of its own.
- **Block:** 20 + n items. The first n cannot be targets, so 20 are scored per stream: 6 targets and 14 non-targets.
- **Lures:** from 2-back up, 4 of the 14 non-targets are lures, i.e. matches at n−1 or n+1 (Laine et al. 2018). No lures at 1-back; 6 lures in Stretch. The Executive versions add their own lures on top (table below), so that a lax strategy (checking the rule against any recent item instead of exactly n back) stays below every step-up threshold.
- **Dual:** 2 of each stream's 6 targets coincide (Jaeggi 2008).
- **Scores per stream:** hits, misses, false alarms, lure false alarms, d′, response bias, **balanced accuracy** (BA = mean of hit rate and correct-rejection rate), and median hit RT.

**Versions** (each keeps its own level). Every count is exact and solver-checked. Fillers match nothing at n−1, n or n+1 under the version's rule.

| Group | Version | Items | Target | Lures (from 2-back) | Basis |
|---|---|---|---|---|---|
| Classic n-back | **Plain** | one stream: grid positions, consonants, digits, days, shapes, glyphs… | same item as n back | 4 × same item at n−1 or n+1 | standard |
| Classic n-back | **Dual** | position + sound, independent streams | as Plain, per stream; 2 of 6 targets shared | 4 per stream | Jaeggi 2008 |
| **Executive n-back** (experimental) | **Transform** | default: the 7 days of the week as words (Cao 2026). Variants: months, clock hours, compass points, notes, the outer ring of the grid | the item is the next one after the item n back ("the day after"). Variants use other fixed rules (two after, one before), always shown on the rule card | 4 next-day matches at n±1 (6 in Stretch) + 2 identity lures (the same day as n back, i.e. the traditional match) | **Cao et al. 2026** exactly (days, +1 rule, timing, block structure); variants are ours |
| Executive | **Arithmetic** | a small sum or difference ("3 + 4", result 1–9) | its result equals the result n back, written differently (never the same expression) | 4 result matches at n±1 (6 in Stretch) + 2 look-alikes (same first number as n back, different result) | our design (processing + updating) |
| Executive | **Switch** | an item with two features: *what* (digit or shape) and *where* (grid position) | a cue above the item (WHAT / WHERE) says which feature to compare with the item n back | 4 cued matches at n±1 (6 in Stretch) + 3 matches on the uncued feature | the switching facet (von Bastian & Oberauer 2013) and Cao's switching outcome |

- **Stimulus sets:** grid positions, consonants (shown, or spoken if a clean voice is available, §11), digits, days, months, clock hours, compass points, shapes, synthesized tones, and abstract glyph sets refreshed every 5 sessions. Colour-based sets are opt-in, using Okabe–Ito colours with redundant patterns. One glyph set is reserved for the Lab and never trained.
- **Ladder:** the level is n plus pace. Each n has two half-steps (standard, then fast). Switch adds a switch-rate step at each n (25 % then 50 % cue changes). There is no ceiling; the display stops at 9-back.
- **Availability:** Plain from the start. Dual from the start by choice. The three Executive versions open as soon as Plain reaches 2-back (usually in session 1 or 2), or straight away for anyone who passes that version's short lesson check.
- **Cao's protocol** (used by the Protocols mode, with no unlock gate):
  - Transform with days and the +1 rule, 500 ms + 2.5 s.
  - 20 + n items with 6 targets; press only on targets.
  - 20 blocks per session (about 30 min).
  - Up after more than 18 of 20 correct, down after 5 or more errors.
  - Each session starts 2 levels below where the last one ended (never below 1-back).
  - 6 sessions, 1–2 days apart, then a 10-block check after 3 months.
  - The week wraps (Sunday → Monday). Lures are not controlled, as in the paper.
  - The traditional arm (Plain with days) is available for comparisons.

### 4.2 Relations (relational integration)
Three paradigms train the same process: hold several items and judge a relation between them.
- **Equal Steps** (Wang et al. 2025): a number stream (§4.2a).
- **Relation Grid** (the measurement literature): arrays (below).
- **Relation Stream** (Oberauer's monitoring form): a changing grid (below).

**Relation Grid.** A 3×3 grid of short symbol strings. Only one position in each string counts: the last symbol, or the middle icon in the icon variant. Decide whether any line satisfies the rule shown at the top, and answer MATCH or NO MATCH (Chuderski 2014; Bateman 2019; Li & Birney 2026).

- **Arrays:**
  - An array ends at your answer or when its window runs out; a 0.1 s blank follows.
  - Half the arrays contain exactly one target line (rows and columns equally often); none has two.
  - The generator matches global statistics (the most frequent symbol's count, the number of distinct symbols) between target and non-target arrays, so no shortcut beats chance (§13).
- **Tiers** (rule × configuration), each with its own pressure step:

| Tier | Rule · lines |
|---|---|
| T1 | Same · rows and columns |
| T2 | Ascending (direction stated) · rows and columns |
| T3 | Different · rows and columns |
| T4 | Same or Different (one rule per block) · rows, columns and diagonals |
| T5 | Five-same · 5-cell cross |
| T6 | Two features (e.g. same shape AND all-different fill) · rows and columns |
| T7 | 4×4 grid, same/different on 4-cell lines (the ceiling, at the ~4-element limit of relational complexity) |
| T8 | Five-different · cross. Optional: very hard; average hits − false alarms was .18 even at 5.5 s (Chuderski 2014) |

- **Pressure steps within every tier:**

| Step | Window | Change |
|---|---|---|
| R1 | 8.0 s | 1–4 strings kept from the previous array (learning step) |
| R2 | 5.5 s | strings kept (Chuderski) |
| R3 | 5.5 s | all strings replaced (Bateman) |
| R4 | 4.5 s | — |
| R5 | 4.5 s | + 6 duplicate distractor symbols in irrelevant positions (Bateman; Li & Birney) |
| R6 | 4.5 s | + near-miss lines (2 of 3 elements fit) |
| R7 | 3.5 s | — |
| R8 | 2.75 s | — |
| R9 | 2.0 s | floor |

- **Opening tiers:** the next tier opens when you reach R6 in the current one, i.e. you met criterion at 4.5 s with distractors. A new tier starts at R1 with fast placement. Every tier keeps its own step, and earlier tiers keep appearing in Varied and Stretch, so pressure is a separate axis and nobody hits a dead end.
- **Relation Stream** (Oberauer's original monitoring form): one cell changes at a time, and you press MATCH when a target line appears. Steps: 2.0 s with 1 cell changing → 1.5 → 1.0 → 1.0 s with 2 cells → 0.75 s with 2 → 0.75 s with 3 (Himi 2023). It opens with T3 and runs at most one block per session.
- **Variants (same process, different content):** digit tails, letter tails, icon middles, numerosity (dots), orientation (bars), and novel glyphs with an on-screen order key. Colour variants are opt-in. One variant is reserved for the Lab.
- No per-trial rule switching: that would train a different facet.

#### 4.2a Equal Steps (Wang et al. 2025)
- **Task:** numbers appear one at a time.
  - **1-back:** press when the step from the previous number equals the step before it (3, 6, **9**: steps of 3 and 3).
  - **2-back:** press when the jump from the number two back equals the previous such jump.
  - Step size counts, not direction. This is the only reading that fits every mark in the paper's worked example; the paper's text is ambiguous.
- **Levels (Wang):** 1-back, then 2-back, each with numbers up to 9, 19, 29 and 39: 8 levels, in an order of our choosing. Beyond the paper, a fast pace and 3-back give headroom.
- **Our settings where the paper is silent:**
  - 500 ms per number + 2.5 s, as in the n-back family;
  - n + 1 lead-in numbers, then 20 scored with 6 targets;
  - 4 near misses (the step is off by one);
  - press only on targets.
- **Wang's protocol** (Protocols mode):
  - 5 blocks of 20 a day for 30 days;
  - the level moves by the day's accuracy: above .8 up, below .5 down;
  - the only feedback is the day's accuracy at the end.
- Opens in session 3 in Varied (§4.4) and has its own lesson (§8).

### 4.3 Span (storage + processing): opt-in facet
- **Task:** complex span. A quick judgement alternates with an item to remember; after 2–9 pairs, you recall the items in order on a keypad.
- **Versions:**
  - **Operation span:** is "7 − 3 = 4" right? Then a letter.
  - **Symbol span:** the same, with symbols or digits to remember.
  - **Backward:** recall in reverse order (manipulation).
- **Timing:** the judgement is self-paced up to a personal limit, the mean + 2.5 SD of your practice times, as in the automated operation span (Unsworth et al. 2005). Each item shows for 1 s; recall is untimed.
- **Scoring:** the proportion recalled in the right position (partial credit). Judgement accuracy must stay ≥ 85 % or the block cannot move up.
- **Adapting:** set size goes up at ≥ 80 % recall and down below 60 %, starting at 3 (von Bastian & Eschen 2016).
- **Content** is verbal and numeric only. The Lab's span test is spatial, and cross-domain transfer of span training is small (Gathercole et al. 2019).
- **Default:** off during the 20-session programme, so the Lab can test whether n-back and RI transfer to complex span (Cao's headline outcome). It is offered after the programme, or any time you turn it on, and is never part of Study mode.
- **Why include it:** in the only facet-comparison trial, storage-and-processing training transferred to working memory and reasoning (von Bastian & Oberauer 2013; a single study, abstract-level detail).

### 4.4 Variety and interleaving engine
- Every block is a fresh sequence from a logged seed; no exact sequence or array repeats.
- **Schedule ramp (Varied):**
  - sessions 1–3 blocked: each version in one stretch of consecutive blocks;
  - sessions 4–6: serial rotation;
  - session 7 on: random order, with at most 2 blocks of a version in a row.
- **Introduction order (Varied and Stretch):**
  - S1: Plain + Relation Grid T1;
  - S2: + Transform (Cao's executive n-back, once available);
  - S3: + Equal Steps (Wang);
  - S4: + Switch;
  - S6: + Arithmetic;
  - S8: + Dual;
  - S10: + Relation Stream.
  - Relation Grid tiers and Equal Steps levels open by their own ladders, and glyph sets refresh every 5 sessions.
  - Availability gates come first, then the mode's schedule; in Free play, anything available can be chosen.
- **When everything has been introduced,** the app says so ("all versions introduced: maintenance") and keeps interleaving. Ladders never dead-end: top steps stay available, and the coach suggests other versions or Stretch.
- A **rule card** opens every block: version, rule, keys and a one-line example. It guards against confusion when tasks are mixed.
- The first blocks on any new version are logged as a **learning curve**, a learning-to-learn measure (Kattner 2017).

---

## 5. Progression: six modes, one learner record

**Shared rules (every task, every mode except Protocols, which follows each paper's own rules):**
- **Score:** balanced accuracy per stream. With two streams, the weaker one decides the level. Span uses recall proportion (§4.3).
- **Controller:** after each rated block, move up one step if BA ≥ U, down one if BA < D, otherwise stay.
- **Self-correction:** every 10 rated blocks on a version, U and D shift if real BA drifts more than 3 points from the mode's target (fixed-step rules miss their nominal targets: García-Pérez 1998).
- **Warm-up:** the first block of each task in a session runs below the current level: one n lower for n-back (never below 1-back), two steps lower for the Relation Grid (never below R1), one level lower for Equal Steps, one item fewer for Span (never below 2). It updates the learner model but not the level.
- **Placement:** a version with no history starts one step below the learner model's prediction, or at the bottom if there is none. It then moves two steps at a time until the first step down.
- **Interrupted blocks:** a block with any pause, or with more than 20 % voided trials (§11), moves nothing (no level change, no model update) and is logged.
- **Fatigue:** if BA falls .15 or more below the session's first two rated blocks for two blocks in a row, the app suggests stopping.
- **Switching modes** never loses anything: levels belong to versions, and the learner model is shared.

| Mode | Target BA (U / D) | How it runs | Evidence it rests on | What it gives up |
|---|---|---|---|---|
| **Varied** (default) | .80 (.87 / .73) | ramp and introduction order (§4.4); a reflection prompt every 3rd session; strategy cards on request | interleaving and variability (Brunmair & Richter 2019; Porter & Magill 2010; Raviv 2022); breadth of routines (Gathercole 2019) | slower early gains; untested inside WM training |
| **Protocols** | each paper's own rule | runs the published procedures exactly: **Cao 2026** executive n-back (and its traditional arm), **Wang 2025** Equal Steps, and **Jaeggi 2008** dual n-back (up with fewer than 3 errors per stream, down with more than 5). You pick one or more; each keeps its paper's block counts, schedule, adaptive rule and feedback; the Lab and Study mode can be attached | the papers themselves | only what each paper trained; Cao's sessions are long (30 min) |
| **Sprint** | .85 (.92 / .78) | double steps until the first step down, every session; blocked; one fixed version per task chosen at the start (default Plain with grid positions; an Executive version by choice) and RI with digit tails; strategy cards before blocks in sessions 1–3 (the n-back grouping strategy from Laine 2018; an RI scanning routine, untested); per-response feedback on; up to 2 sessions a day ≥ 3 h apart | strategy instruction (Laine 2018); blocked practice for fast acquisition | labelled "trained-task gains" |
| **Stretch** | .72 (.80 / .64) | opens after 6 sessions; random interleaving; harder *kinds* of difficulty (6 lures, earlier fast pace, next RI tier at a longer window); summary every 2nd block, level changes revealed at session end; ≥ 20 h between counted sessions, ≤ 4 a week; suggests Varied or Mastery Path if session BA stays under .62 for 2 sessions | desirable difficulties (Bjork & Bjork 2020); training above one's level (Lilienthal 2013) | the learning-rate optimum; more dropout |
| **Mastery Path** | .85 inside a unit | units = (version, target level) on a fixed path (below); pass when 2 of the last 3 blocks reach BA ≥ .85 at the target; next session, a check on fresh material must reach .80 or a corrective cycle follows; reviews at 2, 7 and 21 days; units show "passed", never "mastered"; you may move on after 3 failed checks | mastery learning (Kulik 1990: +.52 SD on aligned tests) | variety and time |
| **Free play + Coach** | (coach aims at .80) | you pick version, level and pace for each block and see the predicted BA; the coach suggests *Edge* (predicted .80), *Due* (not practised lately), *Growing* (fastest recent progress) and *New*; free-play blocks always update the learner model, but move a version's level only when played at that level | autonomy (self-determination theory); self-chosen difficulty matched adaptive (von Bastian & Eschen 2016) | people tend to pick easy, massed practice |

- **Mastery Path order:** Plain 2-back → Grid Same to R6 → Transform 2-back → Equal Steps (1-back, up to 19) → Plain 3-back → Grid Ascending to R6 → Equal Steps (2-back, up to 9) → Dual 2-back → Grid Different to R6 → Arithmetic 2-back → Switch 2-back → Plain 4-back → Grid Diagonals → … After the last unit: "moved on" to Varied-style maintenance.
- **Choosing a mode:** new users start in Varied. "Help me choose" asks one question (what matters most: getting good at these tasks fast, the best chance it carries over, a structured course, a hard challenge, following the papers exactly, or choosing myself). Training style sits in Settings; the home screen suggests a look after session 3.
- **Where the frameworks conflict, and which mode takes which side:**
  - mastery gating (Mastery Path) vs free practice (Free play);
  - blocked (Protocols, Sprint) vs interleaved (Varied, Stretch);
  - about 85 % (Sprint, Mastery Path) or each paper's own rule (Protocols) vs about 80 % (Varied) vs about 72 % (Stretch);
  - strategy instruction (Sprint) vs discovery with prompts (Varied);
  - fixed stimuli (Sprint) vs varied stimuli (Varied);
  - intense (Sprint) vs strictly spaced (Stretch).
- **Learner model (shared):**
  - An Elo/Rasch rating split into general skill + task + content family + structure + version. Item difficulty = base + about 1 logit per step.
  - After each rated block, every part moves by its weight × step × (observed − predicted). The step shrinks with experience and grows back after days off.
  - It drives placement, the coach, predicted BA, and **level-equivalents** ("n-back ≈ 3.5-back", "Relations: tier 2 at 4.0 s").
  - There is no abstract score, and the model never overrides a mode's controller.

**Session template** (default 25 min; block counts scale with the 10–30 min setting):

| Mode | Order | Blocks at 25 min |
|---|---|---|
| Varied | ramp (§4.4) | per task: 1 warm-up + 6 rated (14 in all) |
| Protocols | as in each paper: Cao 20 n-back blocks (about 30 min), Wang 5 Equal Steps blocks (about 6 min), Jaeggi 20 dual blocks | per paper |
| Sprint | blocked, fixed versions | 1 + 6 per task |
| Stretch | random | 1 + 6 per task |
| Mastery Path | current units + due reviews | 1 + 6 per task |
| Free play | your choice | — |

- **Block lengths:** an n-back block takes about 70 s plus a short debrief. An RI block takes 1–2 min (arrays end at the answer). A Relation Stream block takes about 2 min.
- **With Span on:** 1 + 4 blocks per task (15 in all).
- **Task balance** setting: default 50/50 n-back/RI; 40/35/25 with Span.
- "Block 4 of 14" counts every block, warm-ups included.

**Feedback by mode** (the mode default wins unless you change the setting, except in Stretch):

| Mode | During a block | After a block | Level changes |
|---|---|---|---|
| Varied, Mastery Path, Free play | nothing (a per-response flash only if you turn it on) | debrief | shown after each block |
| Sprint | per-response flash (on by default; can be turned off) | debrief | shown after each block |
| Stretch | nothing (cannot be turned on: reduced feedback *is* the mode) | summary every 2nd block | revealed at session end |
| Protocols | as in the paper | Wang: only the day's accuracy, at the end; Cao and Jaeggi: the level between blocks | as in the paper |

**Schedule rules:**
- One counted session per calendar day. Sprint counts up to 2, at least 3 h apart.
- Weekly target 3–5 (default 4), clamped to the mode's cap (Stretch at most 4).
- The programme is 20 counted sessions. After that, any mode works as maintenance, and Span is offered.

---

## 6. The Lab: measuring transfer honestly

The Lab is optional, offered at first run ("Measure first") and any time after.
- Everything is generated; Raven and ICAR items cannot be used. Every item is solver-checked.
- Lab stimulus sets are never trained. Where a Lab test shares a paradigm with training, it counts as near transfer.
- The Lab shows no rewards.
- Two Lab tests mirror the papers' outcomes. The task-switching test uses Cao's digit design (odd/even vs higher/lower than 5), and the generated matrices are of the Sandia type that Wang used. The complex span is spatial rather than Cao's letter-based operation span, because letters can be written down at home.
- Full spec: `research/04-transfer-lab.md` §11–19 (blueprints, solver checks, distractor scheme, form order, attention checks, too-fast flags, interruption rules, an honesty item).

| Part | Tests | Minutes |
|---|---|---|
| **Lab A — Memory** | check-in (sleep, alertness, expectations); **n-back probe**: Lab-only glyphs, 2- and 3-back in ABAB order, 4 blocks of 6 targets + 4 lures, MATCH key as in training, scored by d′; **relation probe**: Lab-only variant, same and different rules, 40 arrays; **spatial complex span**: symmetry judgements + grid locations, 12 trials at loads 2–5, partial credit; **spatial memory updating**: 10 trials | ≈ 25 |
| **Lab B — Reasoning and control** | check-in; **generated 3×3 matrices**: 18 items, 8 options, 1–4 rules, 45 s cap, the same rule tutorial at every visit; **number and letter series**: 14 typed items; **Graph Mapping**: 16 items (Jastrzębski et al. 2023); **task switching**: digits, with a cue saying odd/even or low/high, pure blocks then a mixed block, scored by switch and mixing costs. Its pure blocks double as the speed check that flags motivation or device effects. It is exploratory, because switch costs are known to be unreliable. Close-out: effort, help used, strategy | ≈ 27 |
| **Quick check** | check-in + n-back probe + relation probe | ≈ 12 |
| **Extended** (for studies) | Standard + location–colour binding | +5 |
| **Minimum** | check-ins and close-out + n-back probe, relation probe, span, matrices, series | ≈ 36 |

**Near, mid and far** are set per user from the training log:
- **near:** the n-back probe for n-back trainees, the relation probe for Relation Grid trainees, and the spatial span for Span trainees (same paradigm, other content). Equal Steps has no near probe yet;
- **mid:** the other WM tests (span, updating, binding), and task switching (closer to near for Switch trainees);
- **far:** matrices, series and Graph Mapping (closer to mid for RI trainees, because the RI rules overlap with matrix rules).
- Composites are means of standardised scores per level.

**Schedule (Measure-first path):**
- Baseline 1 → Baseline 2 2–7 days later, both before training. The first retest gain is the largest, so Baseline 2 is your reference.
- Quick check before session 11.
- Post 1–3 days after session 20.
- Follow-up 8–12 weeks later.
- **Rules:**
  - Reasoning tests run only 4 times.
  - On a training day, the Lab comes before the day's first session.
  - Visits on a different device class or at a different time of day are flagged.
  - Four parallel forms are built from one blueprint and counterbalanced.

**What you see:**
- Your scores per visit, as dots.
- **Change verdicts** (above, inside or below a noise band, from the reliable change index of Jacobson & Truax 1991) appear only once a test is **calibrated**.
  - Calibration needs at least 50 people with both baselines. The community then publishes a calibration file with each test's retest reliability and spread, computed by `tools/analysis`; you import it, or it ships in a release.
  - Until then, each test says "not yet calibrated" and shows the typical retest gain from the literature as text.
- Always with the retest caveat. No IQ scores, no percentiles. One person's change cannot show cause.
- **Time is shown up front:** Standard ≈ 52 min per full visit, in two sittings; about 3.7 h over about 4 months. Minimum and Quick check are offered for that reason.
- **At Post** the app asks you to export ("you need this file for your Follow-up if the browser clears its storage"). The Follow-up can run from an imported file.

**Study mode** (optional, for community experiments):
- **Arms:** Holdfast training (Varied, n-back + RI, Span off) vs **adaptive visual search**, optionally with a Lab-only arm. Both arms get the same session length, schedule, screens, debriefs, goals and badges. Both are described the same way: "two attention-and-memory programmes are being compared".
- **Study templates:**
  1. Holdfast (Varied) vs visual search: the default.
  2. **Cao replication:** executive vs traditional n-back on Cao's protocol, with an optional visual-search arm (the untrained control Cao lacked).
  3. **Wang replication:** Equal Steps on Wang's protocol vs adaptive visual search, an active and dose-matched control (Wang's quiz control was neither).
- **The visual-search control:**
  - Is a T present among rotated Ls? Press F for absent, J for present.
  - Set size (8, 12, 16, 24, 32, 48) and display limit adapt with the same U/D rule.
  - Blocks of 20 searches take about 1–1.5 min. There is no memory load.
  - Control participants get the full programme afterwards.
- **Assignment:**
  - Solo users draw an arm after Baseline 2 and get a **commitment code** to post in Discord before session 1. The export later reveals the salt, so anyone can check the arm was not re-drawn.
  - Coordinators issue arm codes only after a participant shows a finished Baseline 2.
  - **Limitation,** stated in the README and the consent text: the codes can be decoded from the open source, so concealment is procedural only.
- **Questions:** expectations at Baseline 2 and Post; a blinding guess at Post. Adults only, plain-language consent, a random anonymous ID.
- **Analysis:** `tools/analysis/` (Python with pandas, statsmodels, scipy and pingouin; runs outside the app; tested on synthetic data) pools exports and runs a preregistrable analysis: ANCOVA of Post on baseline, Holm correction, equivalence tests and Bayes factors. It also builds the calibration file.
- **Sample sizes, in plain words:** about 20–30 people per arm can test near transfer; about 70–100 per arm can show that far transfer is smaller than d = 0.3; detecting d = 0.2 needs 150–200 per arm.

**Honest claims (in the app and the guide):** you will get much better at the trained tasks, often better at very similar untrained ones, and maybe slightly better at other memory tasks. Most controlled studies find no effect on IQ or reasoning, and one person's Lab change cannot show cause.

---

## 7. Progress, logs and the sense of achievement
- **During a block:** only the task.
- **Debrief after each block** (auto-continues, skippable):
  - Plain words first: "You caught 5 of 6 matches and pressed once when there was none."
  - Then the block score, the next level in words, and "block 4 of 14".
  - d′, response bias, lures and reaction time sit behind "details".
  - A one-second celebration only for a level-up or a personal best.
- **Bars:**
  - the session bar (the warm-up already counts);
  - the weekly ring toward your target;
  - programme milestones every 5 sessions;
  - per version, a **zone meter**: the last three blocks against the step-down and step-up lines. Mastery Path shows qualifying blocks among the last 3.
- **Levels:** the real ladder per version, plus level-equivalents and personal bests per version.
- **Lifetime counters** that never reset: sessions, blocks, minutes, trials.
- **12 badges**, unannounced until earned:
  - Rules learned;
  - 3-back reached;
  - 5-back reached;
  - All three executive layers unlocked;
  - Relations: Different tier;
  - Relations: five-cell patterns;
  - Explorer: every stimulus set and variant tried;
  - Both baselines done;
  - Post-test done;
  - Follow-up done;
  - Comeback: back after 14+ days away;
  - Reflective: wrote a strategy note.
  - Never for speed, volume or streaks, and never required for anything.
- **Weekly goals instead of daily streaks:** your own target, rest days built in, a missed session can be made up later in the week (one per day), a planned-break pause, a fresh start each Monday, and no loss messages.
- **Graphs:** level and BA per session (smoothed, with mode and rule changes marked), learning curves for each new version, minutes per week, Lab results.
- **History:** every session, block and trial, filterable; CSV/JSON export; import that merges.
- **Focus mode** hides the whole layer. The Lab never shows it.
- **Share to Discord:** copies a short summary (sessions, minutes, newest badge; levels only if you tick "include my levels") ending with discord.gg/chmr.
- **Backups:** a reminder after milestones, and the last backup date on Progress.

---

## 8. Tutorial and help
**Choice: a hybrid play-to-learn tutorial** (§1.6). It is the first thing after the pop-up and can be skipped by passing the check straight away.

**N-back lesson (about 6 min):**
1. The parts of the screen, named.
2. A worked 1-back example, with a "memory tape" of recent items and a frame on the item one back.
3. Self-paced 1-back with a temporary NO MATCH button, explained feedback and "why?" prompts. The tape shrinks to the frame only, then disappears.
4. Slow, then normal pace. NO MATCH goes away: doing nothing is now the answer.
5. 2-back. The frame moves two back; a lure is called out; an A-B-A-B run; probes ask "tap the item you compare with".
6. **Check block:** 2-back, single stream, standard pace. Pass = at least 4 of 6 matches caught and at most 2 false presses out of 14.
7. **Errors route to mini-lessons:**
   - many false presses → "doing nothing is an answer";
   - false presses on lures → the moving window;
   - wrong key → the key map;
   - late presses → timing.
   - After two failed checks, training starts with the tape visible. The tape fades after 2 assisted blocks at criterion. Assisted blocks are flagged and kept out of statistics.

**Other lessons:**
- **Dual** (the first time it is chosen): the sound stream alone, with letters printed on the tape at first; then both streams at 1-back; then a dual check.
- **Executive** versions (just in time): one worked example and a short guided run each.
  - Transform: "compare with the day after the one two back".
  - Arithmetic: "compare answers, not sums".
  - Switch: "the cue says which feature counts".
- **Relation Grid** (about 4 min, just before its first block):
  - the grid's parts, with the relevant symbol highlighted;
  - worked examples: a row, a column, a near miss;
  - "tap the line with the pattern";
  - slow arrays, then standard timing;
  - a check block: at least 7 of 10 targets found and at most 2 false MATCHes on 10 non-targets.
  - Each new tier gets a short lesson the first time it appears.
- **Equal Steps** (just before its first block):
  - a worked example (3, 6, **9**: two steps of 3);
  - 1-back with the steps written under the numbers, then without;
  - 2-back, introduced with the two jumps drawn as arcs;
  - a check block.
- **Span** (when turned on): one worked trial, the keypad, and "keep the maths accurate".
- All feedback and "why?" explanations come from the **same scorer** that grades the answers. Tutorial data are never logged as training.

**After the tutorial:**
- a rule card before every block;
- just-in-time cards for 3-back and up, each version and each tier;
- help and lesson replay in the pause menu;
- untimed practice (self-paced, tape on) in Learn;
- a plain-text "How to play" page;
- a glossary: match, lure, false press, level, tier, step, balanced accuracy, d′, near/mid/far, noise band.
- The Chimera pop-up never appears over a lesson or a running block.

---

## 9. Chimera promotion
- **Pop-up on every launch,** once per page load, before Today:
  - Text: *"Holdfast was built by the Chimera community on Discord, check it out! Share progress, suggest features and join community studies."*
  - **Join us on Discord** opens https://discord.gg/chmr in a new tab. The URL is also shown as text, for previews that block new tabs.
  - **Start training** has focus, so Enter or Escape closes the pop-up.
- **Permanent places:** a footer on Today, About, the end of the tutorial, the Share text, the README's first line, the PDF's cover and last page, and Study mode ("coordinate studies in the Chimera Discord").

---

## 10. Settings and accessibility
- **Settings:**
  - training style, session length (10–30 min, default 25), weekly target (3–5), task balance, Span on/off;
  - sound (tones, spoken letters if available, or off), volume, sound check, audio offset;
  - keys: remappable, with a Brain Workshop-style A/L preset;
  - per-response feedback, Focus mode, theme (system, light, dark), large text, left-handed layout, reduced motion;
  - data: export, import, reset, last backup.
- **Default keys** (one scheme across tasks, shown on every rule card):
  - **J = match** (yes, true, present);
  - **K = sound match** in Dual;
  - **F = no** (only in tasks that ask for an answer on every item: Relation Grid arrays, Span judgements, the visual-search control);
  - Space continues; Escape or P pauses.
  - On touch screens: big labelled buttons, with "No" always on the left.
- **Accessibility:**
  - keyboard-only use everywhere; touch targets ≥ 44 px; pinch zoom never disabled;
  - colour never the only cue: shapes, patterns and labels too, with Okabe–Ito colours per theme;
  - text contrast ≥ 4.5:1, and forced-colours mode keeps stimuli visible;
  - at most 3 flashes per second, never saturated red, reduced motion respected;
  - screen-reader labels and status messages in menus and results;
  - the timed stream itself is not claimed as screen-reader accessible; untimed practice and an audio-only stimulus set are offered instead;
  - the block pauses when the page is hidden.

---

## 11. Engineering
- **Stack:**
  - Plain JavaScript (ES2019) as classic scripts on one global, with no runtime libraries.
  - No build step is needed to run: `index.html` works from disk (`file://`) and on GitHub Pages.
  - `tools/build-single.mjs` inlines everything into `holdfast.html`.
  - Contract: `SPEC-core.md`; the full `SPEC.md` (data schema, per-version generator tables, module interfaces) is written in Phase 0.
- **Timing** (`research/06-technical.md`, 44 rules; Pronk et al. 2020; Bridges et al. 2020):
  - **Onset** is the timestamp of the `requestAnimationFrame` callback in which the item is shown. The next frame's timestamp is logged as "shown". RT = the input event's timestamp − onset, on the same clock.
  - Durations are counted in frames from the measured frame interval, so 60, 120 and 30 Hz screens all work. No fades.
  - A response belongs to the window from its item's onset to the next onset; only the first response counts, and key repeats are ignored. Keys use `event.code` (any keyboard layout); touch buttons act on `pointerdown`.
  - Levels move on accuracy measures only. RT is compared only within one person on one device, because devices add a constant 50–110 ms.
  - During a block nothing else runs: no re-renders, layout reads, saves or logging. Saves happen between blocks, in idle time.
  - **Voiding:** a trial is voided when its paint came more than 1.5 frame intervals late, or when a frame gap longer than 2.5 intervals hit its display. Voided trials are never charged to the player. A block with more than 20 % voided trials moves nothing and shows a timing note. Frame rate and stalls are logged per block, and coarse 16.7 ms timestamps flag a session as low-precision.
  - **Pause** (Escape or P, a hidden page, or stopped audio): a stream restarts after the pause with a fresh sequence and a 3-2-1 lead-in. Discrete trials void only the current trial. A second pause keeps the first pause's start. A screen wake lock keeps phones awake during blocks.
- **Audio:**
  - Web Audio only; the audio context starts in the Start tap.
  - **Tones** are synthesized (oscillator with a 5–10 ms ramp) and always available.
  - **Spoken letters** ship only if a Phase 0 spike can generate a licence-clean set here: Flite's CMU voices; Piper's LJSpeech voice (its download host is blocked here); or community-recorded clips under CC BY-SA dropped into `assets/audio/`, which the build embeds. Letters are chosen to sound distinct, avoiding the rhyming B, C, D, G, P, T, V set, and the guide says what shipped.
  - The browser's speech synthesis is never used in a timed stream.
  - Sounds are scheduled on the audio clock and output latency is logged; auditory RTs are marked "estimated".
  - A sound check and an audio offset (for Bluetooth) are provided. On iPhones the silent switch is handled where the browser allows, and the sound check says so otherwise.
- **Storage:**
  - localStorage under namespaced keys: all of a GitHub user's Pages share one origin, and Chromium shares one area among all local files.
  - **Main state** (settings, levels, model, summaries, Lab and Study records) is kept separate from **training trial logs**, which use one key per session.
  - Records are append-only with IDs and are merged across tabs on storage events; settings follow last-writer-wins. This avoids Warrant's two-tab data loss.
  - Training trial logs are capped to the most recent ~60 sessions (about 10 KB each). Lab and Study records are never dropped.
  - A quota error shows a warning and suggests Export. Persistent storage is requested where supported.
  - Schema guard and migrations on every load and import.
  - When storage is blocked (sandboxed previews), the app runs from memory with a "not saved here, use Export" notice.
  - Export = a file download **and** a copyable text box. Import = a file picker.
- **Phones:**
  - GitHub Pages is the phone path. There, a manifest and a service worker make Holdfast installable and offline; `file://` ignores both.
  - In-app browsers (Discord's, for example) are detected where possible, with a suggestion to open in Safari or Chrome, because their storage may be separate.
- **Sandbox-safe:**
  - routing in memory (the URL hash mirrors it only where allowed; never plain `#/` links);
  - `<dialog>` instead of alert/confirm;
  - clipboard, fullscreen and wake lock optional and guarded;
  - the Discord link is a real link, with the URL printed as text.
- **Repo layout:**
  - App: `index.html`, `css/`, `js/core|engine|tasks|lab|ui/`, `assets/` (glyph data, optional audio).
  - Docs: `docs/` (guide PDF and its HTML source).
  - Tools: `tools/` (build-single, build-pdf, screenshots, `analysis/`).
  - Tests: `tests/unit|e2e|sim/`.
  - Pages only: `sw.js` + `manifest.webmanifest`.
  - Licences and notes: `README.md`, `LICENSE` (MIT, code), `LICENSE-CONTENT` (CC BY-SA 4.0, texts and guide), `NOTICE` (third-party credits, voices), `CHANGELOG.md`, `CLAUDE.md` (operating rules for future sessions).

---

## 12. Deliverables
1. **`holdfast.zip`:** one top-level `holdfast/` folder, ready for GitHub. Open `index.html`, or turn on GitHub Pages (main branch, root).
2. **`Holdfast-Guide.pdf`:** about 20 pages with clickable links, also in `docs/`.
   1. Cover (Chimera link)
   2. What Holdfast is, in one page
   3. Quick start (computer and phone)
   4. N-Back and Executive N-Back (with screenshots)
   5. Relations: Equal Steps, the grid and the stream
   6. Span (opt-in)
   7. Variety and interleaving
   8. The six training styles (including Protocols), and why there are six
   9. The Lab and Study mode
   10. Progress, badges and goals
   11. The research, plainly, with its limits
   12. Your data and privacy
   13. FAQ and troubleshooting (sound, timing, phones, backups)
   14. References
   15. Credits, licences, Chimera
3. **`holdfast.html`:** the single-file build. Double-click it and it works offline.
4. **Optional:** a private live preview page you can share.

---

## 13. Verification bar (before anything ships)
- **Generators:**
  - exact target, lure and filler counts in every n-back version;
  - exactly one target line or none in every RI array;
  - every Span list, matrix, series, graph and switching sequence solver-checked;
  - at least 10,000 seeds per generator.
- **Shortcut solvers score at chance on every pool:**
  - n-back: always-press, never-press, a familiarity responder;
  - Relation Grid: pair detector, duplicate counter, distinct-count heuristic;
  - Equal Steps: press on any small step, press when a step is within ±1 of the last one;
  - matrices: majority vote over the options, odd-one-out;
  - series: repeat the last difference.
  - Global statistics are matched between target and non-target arrays.
- **Progression:**
  - 300 simulated learners per mode, with realistic learning curves, breaks and lapses;
  - every controller settles within 3 points of its target BA;
  - no dead ends, and the introduction order and gates are followed;
  - weekly caps are respected.
- **Timing:**
  - in headless Chromium, every 500 ms item lasts 500 ms ± 1 frame, with no long animation frames during items (the bare browser measures 499.9–500.1 ms, so any deviation is our code);
  - the voiding logic is tested with injected stalls;
  - RT is checked with real key and pointer events;
  - audio is tested under the autoplay policy that real browsers use.
- **Play-through tests (Playwright, at most 2 browsers at once):**
  - both first-run paths, the tutorial, every mode, every version, the Lab, Study mode and the pop-up;
  - both themes, phone and desktop sizes, the sandboxed preview, blocked storage;
  - two tabs (no lost blocks);
  - storage quota exhausted (Lab records kept);
  - export → import → Follow-up;
  - pause and hide during a block;
  - the in-app-browser banner;
  - the service worker, on a local http server.
- **Long runs:** a simulated 60-day user per mode in the real app.
- **Independent reviews** by agents that did not build it: code, play-through QA, science and claims vs code, texts.
- **Final checks:** screenshots reviewed on desktop and phone; the PDF checked page by page; the zip unpacked and retested from the copy.
- **Limit:** only Chromium can be installed here (Firefox and WebKit downloads are blocked). Firefox and Safari rely on careful feature detection and a community check.

---

## 14. How the build will run (when you say go)
Each phase ends with its tests passing, and `CLAUDE.md` updated and mirrored to the project.

| Phase | Work | Who |
|---|---|---|
| 0 | Repo skeleton, `SPEC.md`, stubs, build tools; spikes for spoken-letter clips and the timing harness | me |
| 1 | Pure engines in parallel: n-back generators and scoring; Relations generators and scoring (Equal Steps, Grid, Stream); Span; learner model, controllers, modes and planner, with simulations; Lab generators (matrices, series, Graph Mapping, span, updating, binding, task switching, visual search) | 4 subagents |
| 2 | Interface: design system and shell (with the pop-up) first, then the session player, Lab player, progress screens and tutorial | 1 design agent, then 3 subagents |
| 3 | Integration, timing tests, play-through tests, long simulated runs | me + test agents |
| 4 | Independent reviews and fixes | 4 reviewers, then fixes |
| 5 | Guide PDF, README, CHANGELOG, NOTICE, screenshots, single file, zip, checks from the unzipped copy, delivery, build log in the project | me + 1 docs agent |

---

## 15. Risks and honest limits
- **Evidence:** executive n-back rests on one small study (15 per group, no untrained control, group differences gone by follow-up). RI training has mostly null transfer results, and Wang 2025 shows no behavioural reasoning gain over its control. Both are labelled experimental, and far transfer cannot be promised.
- **Constants:** every threshold and step size is a design choice until simulated, and then piloted.
- **Lab calibration:** noise bands need about 50 people with both baselines; the community study is how to get there.
- **Lab length:** about 3.7 h over 4 months for the Standard schedule, hence Minimum and Quick check.
- **Devices:**
  - Phones should use GitHub Pages.
  - Safari clears site data after 7 days without a visit, hence the export prompts.
  - Bluetooth audio lags, hence the offset setting and "estimated" auditory RTs.
  - Only Chromium is tested here.
- **Audio:** spoken letters may not be possible to generate here, in which case tones are the fallback, or community recordings later.
- **Name:** collides with a PC game title.
- **Scope:** a large build, roughly 15–20 thousand lines with tests. It runs in phases, with `CLAUDE.md` carrying the state across context compactions.

---

## 16. Decisions I made (change any of them)
1. **Name:** Holdfast (confirmed).
2. **Chimera pop-up** at every launch, as you asked.
3. **The two papers' tasks, exactly:** Executive N-Back = Cao et al. 2026 (Transform with days and the +1 rule), plus our Switch and Arithmetic layers. Relations = Wang et al. 2025's Equal Steps, plus the grid and stream tasks from the measurement research. Where the papers are silent (keys, lures, Equal Steps timing), the choices are ours and marked as such.
4. **n-back default:** single-stream; Dual by choice. The Protocols mode runs Cao 2026, Wang 2025 and Jaeggi 2008 as published.
5. **Training style:** Varied is the default; the other five are one tap away.
6. **First run:** "Start training now" is the default, and "Measure first" is opt-in.
7. **Span:** opt-in, and off during the 20-session programme.
8. **Lab:** Standard configuration, with Minimum and Quick check offered. Study mode is included. Noise bands only after community calibration.
9. **Auditory stream:** synthesized tones, unless a licence-clean voice can be generated.
10. **Language:** English only in version 1.
11. **Licences:** code MIT; texts and guide CC BY-SA 4.0.

---

## 17. Key references (full list with DOIs in `research/`)
- Cao, Zhang, Zhang, Zhang & Zhang (2026). *Psychonomic Bulletin & Review* 33, art. 36. doi:10.3758/s13423-025-02773-8
- León-Domínguez, Martín-Rodríguez & León-Carrión (2015). *Behavioural Brain Research* 292, 167–173. doi:10.1016/j.bbr.2015.06.002
- von Bastian & Oberauer (2013). *Journal of Memory and Language* 69(1), 36–58. doi:10.1016/j.jml.2013.02.002
- von Bastian, Langer, Jäncke & Oberauer (2013). *Memory & Cognition* 41(4), 611–624. doi:10.3758/s13421-012-0280-7
- Chuderski (2014). *Memory & Cognition* 42, 448–463. doi:10.3758/s13421-013-0366-x
- Oberauer, Süß, Wilhelm & Wittmann (2008). *Intelligence* 36(6), 641–652. doi:10.1016/j.intell.2008.01.007
- Bateman, Thompson & Birney (2019). *Memory & Cognition* 47(8), 1457–1468. doi:10.3758/s13421-019-00952-2
- Himi, Stadler, von Bastian, Bühner & Hilbert (2023). *Journal of Experimental Psychology: General* 152(5), 1305–1333. doi:10.1037/xge0001328
- Wang, Sun & Xiao (2025). *Brain Topography* 38(2), 24. doi:10.1007/s10548-024-01099-3
- De Simoni & von Bastian (2018). *Journal of Experimental Psychology: General* 147(6), 829–858. doi:10.1037/xge0000453
- Jaeggi, Buschkuehl, Jonides & Perrig (2008). *PNAS* 105(19), 6829–6833. doi:10.1073/pnas.0801268105
- Laine, Fellman, Waris & Nyman (2018). *Scientific Reports* 8, 4045. doi:10.1038/s41598-018-22396-5
- Soveri, Antfolk, Karlsson, Salo & Laine (2017). *Psychonomic Bulletin & Review* 24(4), 1077–1096. doi:10.3758/s13423-016-1217-0
- Au, Sheehan, Tsai, Duncan, Buschkuehl & Jaeggi (2015). *Psychonomic Bulletin & Review* 22(2), 366–377
- Melby-Lervåg, Redick & Hulme (2016). *Perspectives on Psychological Science* 11(4), 512–534. doi:10.1177/1745691616635612
- Pahor, Seitz & Jaeggi (2022). *Nature Human Behaviour* 6, 1243–1256. doi:10.1038/s41562-022-01384-w
- Gathercole, Dunning, Holmes & Norris (2019). *Journal of Memory and Language* 105, 19–42
- Holmes, Woolgar, Hampshire & Gathercole (2019). *Frontiers in Psychology* 10, 1103
- Fu, Zhou, Yuan & Cai (2026). *Psychonomic Bulletin & Review*. doi:10.3758/s13423-026-02994-5
- von Bastian & Eschen (2016). *Psychological Research* 80, 181–194. doi:10.1007/s00426-015-0655-z
- Unsworth, Heitz, Schrock & Engle (2005). *Behavior Research Methods* 37(3), 498–505. doi:10.3758/BF03192720
- Jastrzębski, Ociepka & Chuderski (2023). *Behavior Research Methods* 55(1), 448–460. doi:10.3758/s13428-022-01846-z
- Wilson, Shenhav, Straccia & Cohen (2019). *Nature Communications* 10, 4646. doi:10.1038/s41467-019-12552-4
- Raviv, Lupyan & Green (2022). *Trends in Cognitive Sciences* 26(6), 462–483. doi:10.1016/j.tics.2022.03.007
- Wang, Zhou & Shah (2014). *Frontiers in Human Neuroscience* 8, 217. doi:10.3389/fnhum.2014.00217
- Katz, Jaeggi, Buschkuehl, Stegman & Shah (2014). *Frontiers in Human Neuroscience* 8, 242. doi:10.3389/fnhum.2014.00242
- Vermeir, White, Johnson, Crombez & Van Ryckeghem (2020). *JMIR Serious Games* 8(3), e18644
- Alfieri, Brooks, Aldrich & Tenenbaum (2011). *Journal of Educational Psychology* 103(1), 1–18. doi:10.1037/a0021017
- Jacobson & Truax (1991). *Journal of Consulting and Clinical Psychology* 59(1), 12–19. doi:10.1037/0022-006X.59.1.12
