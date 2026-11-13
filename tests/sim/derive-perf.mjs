// Long-Horizon — derive() timing (node): node tests/sim/derive-perf.mjs [--blocks 5000]
// Builds a realistic history by playing one simulated learner through the real engine (Varied, 60 days),
// then tiles it in time (fresh ids, +61 days per copy) until it holds at least the requested number of blocks.
import { loadEngine, runLearner, population, DAY } from './lib.mjs';

const HF = loadEngine();
population('pop-perf');
const args = process.argv.slice(2);
const want = +(args[args.indexOf('--blocks') + 1] || 5000) || 5000;

export function tiledRecords(HF, want) {
  const base = runLearner(HF, { id: 'perf', modeId: 'varied', days: 60, learnerOpts: { pDay: 0.9, pSecond: 0.3 } }).records;
  const rec = { ...base, sessions: [], blocks: [], events: [], labVisits: [] };
  for (let k = 0; rec.blocks.length < want; k++) {
    const dt = k * 61 * DAY, sfx = k ? '~' + k : '';
    rec.sessions.push(...base.sessions.map(s => ({ ...s, id: s.id + sfx, startedAt: s.startedAt + dt, endedAt: s.endedAt && s.endedAt + dt, dayKey: HF.goals.dayKey(s.startedAt + dt) })));
    rec.blocks.push(...base.blocks.map(b => ({ ...b, id: b.id + sfx, sessionId: b.sessionId + sfx, t: b.t + dt })));
    rec.events.push(...base.events.map(e => ({ ...e, id: e.id + sfx, t: e.t + dt })));
  }
  rec.blocks = rec.blocks.slice(0, want);
  return rec;
}

const rec = tiledRecords(HF, want);
const now = rec.blocks[rec.blocks.length - 1].t + DAY;
for (let i = 0; i < 5; i++) HF.engine.derive(rec, now); // warm up the JIT
const times = [];
for (let i = 0; i < 20; i++) { const t0 = performance.now(); HF.engine.derive(rec, now); times.push(performance.now() - t0); }
times.sort((a, b) => a - b);
const med = times[10], max = times[19];
console.log(`derive: ${rec.blocks.length} blocks, ${rec.sessions.length} sessions → median ${med.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
// cold first call in a fresh shuffled order (records merged from two tabs are not sorted)
const shuffled = { ...rec, blocks: rec.blocks.slice().reverse() };
const t1 = performance.now(); HF.engine.derive(shuffled, now); const cold = performance.now() - t1;
console.log(`derive on unsorted blocks: ${cold.toFixed(1)} ms`);
if (med > 50) { console.log('FAIL  derive slower than 50 ms'); process.exit(1); }
console.log('PASS  derive ≤ 50 ms for ' + rec.blocks.length + ' blocks');
