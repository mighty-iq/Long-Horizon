/* Long-Horizon — "Why Long-Horizon works this way": a plain research summary with its limits (pure, no DOM).
 * Code MIT; texts CC BY-SA 4.0. Owner: P4. Every number comes from PLAN §1 (and §0's headline), which summarises
 * research/00-digest.md and the full texts in research/08 (Cao 2026) and research/09 (Wang 2025).
 *
 * HF.content.research = {
 *   TITLE, LEAD,
 *   SECTIONS: [ { id, title, body: [paragraph], points?: [text], table?: { caption, columns: [{ key, label }], rows: [{…}] },
 *                 so?: text (what Long-Horizon does about it) } ],
 *   LIMITS: [text],
 *   REFERENCES: [ { short, full } ]  short citations used in the texts above (full list with DOIs: the guide, chapter
 *                                   13 References; the app points there, Phase 4 SC-12)
 * }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});

  var SECTIONS = [
    { id: 'headline', title: 'The short version',
      body: ['People get much better at the trained tasks and often at very similar untrained ones. Controlled studies mostly find no gain in reasoning or IQ, so Long-Horizon measures transfer instead of promising it.'] },

    { id: 'cao', title: 'Executive n-back (Cao et al. 2026)',
      body: [
        'Classic n-back with one extra operation: the items are days of the week, and you press when the day shown is the day after the day n back. The traditional version presses for the same day.',
        'The study trained 30 students, 15 per group, executive against traditional n-back, over 6 sessions. There was no untrained control group, and the study was not preregistered.'
      ],
      points: [
        'Operation span (a complex span task) improved in the executive group only (p = .005, ηp² = .25).',
        'Switch costs fell in both groups; the executive group’s advantage was marginal (p = .069).',
        'Stroop and Raven’s matrices improved in both groups, with no difference between them.',
        'At the 3-month follow-up (27 people), the operation span score and the switch cost no longer differed between the groups; letters recalled still favoured the executive group (p = .028, post-test and follow-up pooled).'
      ],
      so: 'A small, interesting, unreplicated result. Long-Horizon’s Transform version uses Cao’s task, and the Protocols style runs their procedure as closely as the paper allows (where it is silent, Long-Horizon’s choices are listed in the guide). The Lab measures the same two abilities with its own tests (a spatial complex span; task switching, exploratory).' },

    { id: 'ri', title: 'Relational integration (Wang et al. 2025 and others)',
      body: [
        'Relational integration means seeing a relation across several items at once. As a measure it is strong: a relational-integration factor correlated about .9 with reasoning at the latent level (Oberauer et al. 2008, 131 people).',
        'As training, the record is weak. Trained groups improved on the trained task, transfer to other content was weak, and no study found transfer to reasoning.',
        'Wang, Sun and Xiao 2025 trained 29 students on a number-stream task (Long-Horizon calls it Equal Steps), 5 blocks a day for 30 days; 28 students did a quiz instead. On the only reasoning test, a set of matrices close to ceiling, both groups improved equally. The reasoning claim in the title rests on EEG changes alone.'
      ],
      so: 'Long-Horizon includes Equal Steps as closely as Wang’s paper allows (where it is silent, Long-Horizon’s choices are listed in the guide), plus the grid task from the measurement research, labels both experimental, and lets the Lab measure what happens. It also trains switching, one of the two facets that did transfer in a head-to-head study (von Bastian & Oberauer 2013), and offers complex span as an option.' },

    { id: 'transfer', title: 'How transfer behaves',
      body: ['The further a test is from what you trained, the smaller the effect. What predicts near and mid transfer is shared structure between the trained and the tested task (Gathercole et al. 2019).'],
      table: {
        caption: 'Typical effects of working memory training',
        columns: [{ key: 'kind', label: 'Kind' }, { key: 'effect', label: 'Effect' }, { key: 'source', label: 'Sources' }],
        rows: [
          { kind: 'Trained task', effect: 'Large (g ≈ .9, in older adults)', source: 'Sala et al. 2019' },
          { kind: 'Near: same kind of task, new material', effect: 'Medium (untrained n-back g = .62)', source: 'Soveri et al. 2017' },
          { kind: 'Mid: other working memory tasks', effect: 'Small (g ≈ .2–.3); several well-run studies found none', source: 'Melby-Lervåg et al. 2016' },
          { kind: 'Far: reasoning, IQ, school', effect: 'About zero with active controls (g .01–.06)', source: 'Au et al. 2015; Sala & Gobet 2020' }
        ]
      },
      so: 'No tool can promise mid or far transfer today. Long-Horizon makes choices that theory suggests may help, trains several different processes, and measures the result.' },

    { id: 'progression', title: 'Why the training changes as you go',
      points: [
        'Training at your moving edge beats a fixed easy level for gains on the trained and very similar tasks (Holmes 2009 and others).',
        'Blocks are scored by balanced accuracy, not raw accuracy: one study found accuracy rising while the ability to tell items apart fell (Himi 2023).',
        'New tasks start narrow and then mix. Mixing beat blocked practice in a meta-analysis (g = .42, about .29 after correcting for bias), mostly in category learning (Brunmair & Richter 2019), and variety slows early learning but helps later use (Raviv et al. 2022). No working memory training study has tested mixing yet.',
        'Sessions are spread out. In children, 20 sessions over 20 days gave a reasoning gain while the same 20 packed into fewer days did not (Wang, Zhou & Shah 2014; one-tailed p = .038). Meta-analyses find no dose effect, so more is not automatically better.',
        'Strategy tips are offered, not imposed: teaching a strategy speeds early n-back gains, but the edge fades within weeks, and strategies people find themselves predict their gains (Laine et al. 2018; Fellman et al. 2020).',
        'There are six training styles because the research frameworks really do conflict: fastest gains on the trained task against the best chance of transfer, about 85 % success against harder practice.'
      ] },

    { id: 'motivation', title: 'Why the game stays quiet during blocks',
      points: [
        'Gamified cognitive training felt more motivating (g = .72), but its cognitive outcomes were not shown to improve (g = .27, not significant; Vermeir et al. 2020).',
        'In a preliminary study with 107 children, a score visible during play reduced n-back gains (Katz et al. 2014).',
        'Badges plus leaderboards lowered motivation (Hanus & Fox 2015), and broken streaks cut engagement (Silverman & Barasch 2023).'
      ],
      so: 'Nothing but the task is on screen during a block. Between blocks you get a plain note; across weeks, levels, weekly goals and milestone badges. No leaderboards, no daily streaks, and Focus mode hides all of it.' },

    { id: 'lab', title: 'Why there is a Lab',
      points: [
        'Expectations matter: a placebo framing alone raised a matrices score by d ≈ .5 within an hour (Foroughi et al. 2016).',
        'Taking a test again raises the score even without training. Two baselines a few days apart make the second one a fair reference.',
        'A change verdict needs to know how much a score moves by chance, so Long-Horizon shows verdicts only for tests the community has calibrated.'
      ],
      so: 'The Lab uses generated tests you never train on, shows no rewards, and states the retest caveat next to every result.' },

    { id: 'tutorial', title: 'Why lessons are played, not read',
      body: ['In-context help beat an up-front manual for complex games (Andersen et al. 2012); guided discovery with feedback beat both lecturing and unassisted discovery (Alfieri et al. 2011); worked examples work best when the support fades (Renkl & Atkinson). So each lesson shows an example, lets you try at your own pace with a memory tape, takes the tape away, and ends with a short check you can skip to.'] }
  ];

  var LIMITS = [
    'The two studies behind the headline tasks are small and have not been repeated.',
    'The 85 % success target comes from theory (Wilson et al. 2019) and is untested in working memory training.',
    'The evidence on lesson design comes from learning research in general, not from studies of n-back tutorials.',
    'Your own Lab results describe one person at a few moments. Practice, sleep, mood and hope all move them.'
  ];

  var REFERENCES = [
    { short: 'Cao et al. 2026', full: 'Cao, Zhang, Zhang, Zhang & Zhang (2026). Broad and sustained transfer effects of executive n-back working memory training. Psychonomic Bulletin & Review, 33, 36.' },
    { short: 'Wang et al. 2025', full: 'Wang, Sun & Xiao (2025). Relational integration training modulated the frontoparietal network for fluid intelligence: an EEG microstates study. Brain Topography, 38, 24.' },
    { short: 'Oberauer et al. 2008', full: 'Oberauer, Süß, Wilhelm & Wittmann (2008). Which working memory functions predict intelligence? Intelligence.' },
    { short: 'von Bastian & Oberauer 2013', full: 'von Bastian & Oberauer (2013). Distinct transfer effects of training different facets of working memory capacity. Journal of Memory and Language.' },
    { short: 'Gathercole et al. 2019', full: 'Gathercole, Dunning, Holmes & Norris (2019). Working memory training involves learning new skills. Journal of Memory and Language.' },
    { short: 'Sala et al. 2019', full: 'Sala, Aksayli, Tatlidil, Gondo & Gobet (2019). Working memory training does not enhance older adults’ cognitive skills: a comprehensive meta-analysis. Intelligence, 77, 101386.' },
    { short: 'Soveri et al. 2017', full: 'Soveri, Antfolk, Karlsson, Salo & Laine (2017). Working memory training revisited. Psychonomic Bulletin & Review.' },
    { short: 'Melby-Lervåg et al. 2016', full: 'Melby-Lervåg, Redick & Hulme (2016). Working memory training does not improve performance on measures of intelligence or other measures of far transfer. Perspectives on Psychological Science.' },
    { short: 'Au et al. 2015', full: 'Au, Sheehan, Tsai, Duncan, Buschkuehl & Jaeggi (2015). Improving fluid intelligence with training on working memory: a meta-analysis. Psychonomic Bulletin & Review.' },
    { short: 'Sala & Gobet 2020', full: 'Sala & Gobet (2020). Working memory training in typically developing children: a multilevel meta-analysis. Psychonomic Bulletin & Review.' },
    { short: 'Laine et al. 2018', full: 'Laine, Fellman, Waris & Nyman (2018). The early effects of external and internal strategies on working memory updating training. Scientific Reports.' },
    { short: 'Fellman et al. 2020', full: 'Fellman et al. (2020). The role of strategy use in working memory training outcomes. Journal of Memory and Language.' },
    { short: 'Brunmair & Richter 2019', full: 'Brunmair & Richter (2019). Similarity matters: a meta-analysis of interleaved learning and its moderators. Psychological Bulletin, 145, 1029\u20131052.' },
    { short: 'Foroughi et al. 2016', full: 'Foroughi, Monfort, Paczynski, McKnight & Greenwood (2016). Placebo effects in cognitive training. PNAS.' },
    { short: 'Vermeir et al. 2020', full: 'Vermeir, White, Johnson, Crombez & Van Ryckeghem (2020). The effects of gamification on computerized cognitive training: systematic review and meta-analysis. JMIR Serious Games.' },
    { short: 'Katz et al. 2014', full: 'Katz, Jaeggi, Buschkuehl, Stegman & Shah (2014). Differential effect of motivational features on training improvements in school-based cognitive training. Frontiers in Human Neuroscience.' }
  ];

  var api = {
    TITLE: 'Why Long-Horizon works this way',
    LEAD: 'A plain summary of the research behind the design, with its limits. Long-Horizon claims only what this evidence supports.',
    SECTIONS: SECTIONS, LIMITS: LIMITS, REFERENCES: REFERENCES
  };
  content.research = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
