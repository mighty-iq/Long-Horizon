// SC-08: the practice (retest-gain) correction applies only with practiceN ≥ 30 people who did not train, and the
// verdict itself never subtracts it (it compares the change with measurement noise only).
import { HF, load } from './load.mjs';

for (const f of ['js/lab/index.js', 'js/lab/levels.js', 'js/lab/compare.js']) load(f);

const T0 = new Date(2026, 0, 5, 10).getTime(), DAY = 86400000;
function v(id, kind, day, score) {
  return { id, kind, config: 'standard', form: 'A', startedAt: T0 + day * DAY, endedAt: T0 + day * DAY + 3e6,
           tests: { 'lab.matrix': { score, flags: [] } }, flags: [] };
}
function cmp(cal) {
  const records = { profile: { anonId: 'a' }, settings: {}, sessions: [], blocks: [], events: [],
                    labVisits: [v('b1', 'B1', 0, 0.50), v('b2', 'B2', 4, 0.52), v('p', 'POST', 40, 0.72)],
                    calibration: { version: 't', source: 'unit', tests: { 'lab.matrix': cal } } };
  return HF.lab.compare(records)['lab.matrix'];
}
const BASE = { r: 0.8, sd: 0.15, mean: 0.55, n: 80 };

export default async function (t) {
  await t.test('compare: practice correction needs practiceN ≥ 30 (same rule as calibrate.py)', () => {
    t.eq(HF.lab.PRACTICE_MIN_N, 30);
    const sdiff = 0.15 * Math.sqrt(2 * 0.2), change = 0.72 - 0.52;
    t.eq(cmp(Object.assign({}, BASE, { practice: 0.03 })).rciPractice, null, 'practice without practiceN is ignored');
    t.eq(cmp(Object.assign({}, BASE, { practice: 0.03, practiceN: 29 })).rciPractice, null, '29 people are too few');
    t.near(cmp(Object.assign({}, BASE, { practice: 0.03, practiceN: 30 })).rciPractice, (change - 0.03) / sdiff, 1e-9);
    t.eq(cmp(Object.assign({}, BASE, { practiceN: 45 })).rciPractice, null, 'practiceN alone gives no correction');
  });

  await t.test('compare: the verdict compares the change with measurement noise only', () => {
    const sdiff = 0.15 * Math.sqrt(2 * 0.2), change = 0.72 - 0.52;
    for (const cal of [BASE, Object.assign({}, BASE, { practice: 0.15, practiceN: 60 })]) {
      const row = cmp(cal);
      t.near(row.rci, change / sdiff, 1e-9);
      t.eq(row.verdict, row.rci > 1.96 ? 'above' : row.rci < -1.96 ? 'below' : 'inside', 'verdict from the plain RCI');
    }
    const row = cmp(Object.assign({}, BASE, { practice: 0.15, practiceN: 60 }));
    t.eq(row.verdict, 'above');
    t.ok(row.rciPractice < 1.96, 'the same change can be inside the band once the average retest gain is subtracted');
  });
}
