/* Long-Horizon — what the app can and cannot claim (pure, no DOM). Code MIT; texts CC BY-SA 4.0. Owner: P4.
 * Used by About (P3), the Learn page and the PDF guide. Source: PLAN §6 "Honest claims" and §1; never stronger.
 *
 * HF.content.claims = {
 *   SUMMARY: string                    the one-paragraph honest claim (PLAN §6, in the app and the guide)
 *   HEADLINE: string                   one sentence for tight spaces
 *   CAN: [ { title, text } ]           what training with Long-Horizon can be expected to do
 *   CANNOT: [ { title, text } ]        what it cannot promise or show
 *   PRIVACY: string                    where the data live
 *   NOT_MEDICAL: string
 *   intro, can, cannot, canTitle, cannotTitle, note    aliases in the shape About (P3) reads
 * }
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var content = HF.content || (HF.content = {});

  var api = {
    HEADLINE: 'People get much better at the trained tasks and often at very similar ones; controlled studies mostly find no gain in reasoning or IQ, so Long-Horizon measures transfer instead of promising it.',
    SUMMARY: 'You will get much better at the trained tasks, often better at very similar untrained ones, and maybe slightly better at other memory tasks. Most controlled studies find no effect on IQ or reasoning, and one person’s Lab change cannot show cause.',
    CAN: [
      { title: 'Better at the trained tasks.', text: 'Practice raises your level on the tasks you train, often by a lot. This is the most reliable effect in the research.' },
      { title: 'Often better at very similar tasks.', text: 'Gains often show on the same kind of task with new material, for example n-back with symbols you never trained on (near transfer).' },
      { title: 'Maybe a little better at other memory tasks.', text: 'Effects on other working memory tasks are small when they appear, and several careful studies found none (mid transfer).' },
      { title: 'Measure your own change.', text: 'The optional Lab tests you before and after training on untrained tasks, with two baselines and the retest caveat, so you can see what changed for you.' },
      { title: 'Help the community find out.', text: 'Study mode compares training with an active control. Pooled across enough people, that can show what training causes.' }
    ],
    CANNOT: [
      { title: 'No promise of IQ or reasoning gains.', text: 'With active control groups, studies find about zero transfer to reasoning, IQ tests or school results. Long-Horizon does not claim otherwise.' },
      { title: 'One person’s change cannot show cause.', text: 'Practice with the tests, sleep, mood and expectations all move Lab scores. A change in your own results does not show that training caused it.' },
      { title: 'The two headline studies are small.', text: 'Executive n-back (Cao et al. 2026, 30 students) and Equal Steps (Wang et al. 2025, 57 students) are single studies that have not been repeated. Their tasks are marked experimental.' },
      { title: 'The design is not proof.', text: 'Variety, spacing and training at your edge are choices that theory suggests may help; none is shown to produce transfer.' }
    ],
    PRIVACY: 'Everything stays on this device. Long-Horizon has no account and sends nothing anywhere; your data leave only when you export them.',
    NOT_MEDICAL: 'Long-Horizon is a training and self-measurement tool. It is not a medical device and does not diagnose or treat anything.'
  };
  // the shape js/ui/about.js reads: { intro, can, cannot, canTitle, cannotTitle, note }
  api.intro = api.SUMMARY;
  api.can = api.CAN;
  api.cannot = api.CANNOT;
  api.canTitle = 'What Long-Horizon can do';
  api.cannotTitle = 'What it cannot promise';
  api.note = api.NOT_MEDICAL;
  content.claims = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
