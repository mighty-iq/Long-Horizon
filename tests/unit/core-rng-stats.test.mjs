import { HF } from './load.mjs';

export default async function (t) {
  await t.test('rng is deterministic per seed', () => {
    const a = HF.rng.create('abc'), b = HF.rng.create('abc'), c = HF.rng.create('abd');
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    const sc = Array.from({ length: 20 }, () => c.next());
    t.eq(sa, sb); t.ok(JSON.stringify(sa) !== JSON.stringify(sc));
    t.ok(sa.every(x => x >= 0 && x < 1));
  });
  await t.test('rng.int covers range inclusively and is roughly uniform', () => {
    const r = HF.rng.create('u'); const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) counts[r.int(0, 5)]++;
    t.ok(counts.every(c => c > 9000 && c < 11000), JSON.stringify(counts));
  });
  await t.test('shuffle is a permutation and sample is distinct', () => {
    const r = HF.rng.create('s'); const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const sh = r.shuffle(arr); t.eq(sh.slice().sort(), arr); t.eq(arr, [1, 2, 3, 4, 5, 6, 7, 8]);
    const sm = r.sample(arr, 5); t.eq(new Set(sm).size, 5);
  });
  await t.test('fork gives independent deterministic streams', () => {
    const a = HF.rng.create('x').fork('k'), b = HF.rng.create('x').fork('k');
    t.eq(a.next(), b.next());
  });
  await t.test('newSeed returns distinct strings', () => {
    const s = new Set(Array.from({ length: 50 }, () => HF.rng.newSeed())); t.eq(s.size, 50);
  });
  await t.test('normInv inverts normCdf', () => {
    for (const z of [-2.5, -1, 0, 0.5, 1.96]) t.near(HF.stats.normInv(HF.stats.normCdf(z)), z, 2e-3);
  });
  await t.test('sdt: perfect block, never-press, always-press', () => {
    const p = HF.stats.sdt(6, 0, 0, 14); t.eq(p.ba, 1); t.ok(p.dprime > 2.5);
    const never = HF.stats.sdt(0, 6, 0, 14); t.eq(never.ba, 0.5); t.near(never.y, 0, 1e-12);
    const always = HF.stats.sdt(6, 0, 14, 0); t.eq(always.ba, 0.5); t.near(always.y, 0, 1e-12);
    t.ok(Math.abs(never.dprime) < 1.5 && Math.abs(always.dprime) < 1.5);
  });
  await t.test('rci matches Jacobson–Truax', () => {
    // sd 10, r .8 → SEM = 10*sqrt(.2) = 4.472; Sdiff = 6.325; change 12.4 → 1.96
    t.near(HF.stats.rci(50, 62.4, 10, 0.8), 1.96, 0.01);
  });
  await t.test('median, sd, slope, ema', () => {
    t.eq(HF.stats.median([3, 1, 2]), 2); t.near(HF.stats.sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 1e-3);
    t.near(HF.stats.slope([1, 3, 5, 7]), 2, 1e-12); t.eq(HF.stats.ema([1, 1, 1], 0.5), [1, 1, 1]);
  });
}
