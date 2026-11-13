// Unit tests for js/core/store.js in node: every "tab" is its own vm context (its own HF), all tabs share one fake
// localStorage area with a byte quota and queued `storage` events. Run: node tests/unit/run.mjs core-store
import { ROOT } from './load.mjs';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const FILES = ['js/core/rng.js', 'js/core/stats.js', 'js/core/util.js', 'js/core/schema.js', 'js/core/store.js'];
const SRC = FILES.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
const plain = x => JSON.parse(JSON.stringify(x)); // bring values from a vm realm into this one
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
// poll for an expected outcome (saves run in chained idle timers, which a loaded machine can delay)
async function waitFor(cond, ms = 3000) { const end = Date.now() + ms; while (!cond() && Date.now() < end) await tick(5); return cond(); }

class Area {
  constructor(quota = Infinity) { this.map = new Map(); this.quota = quota; this.tabs = new Set(); }
  bytes() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
  notify(from, key, oldValue, newValue) {
    for (const tab of this.tabs) if (tab !== from) tab.pending.push({ key, oldValue, newValue, storageArea: tab.ls });
  }
  keys(prefix) { return [...this.map.keys()].filter(k => k.startsWith(prefix)).sort(); }
}

function facade(area, tab) {
  return {
    get length() { return area.map.size; },
    key(i) { const k = [...area.map.keys()][i]; return k === undefined ? null : k; },
    getItem(k) { return area.map.has(k) ? area.map.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      const old = area.map.has(k) ? area.map.get(k) : null;
      const next = area.bytes() - (old === null ? 0 : k.length + old.length) + k.length + v.length;
      if (next > area.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      area.map.set(k, v);
      area.notify(tab, k, old, v);
    },
    removeItem(k) {
      if (!area.map.has(k)) return;
      const old = area.map.get(k);
      area.map.delete(k);
      area.notify(tab, k, old, null);
    }
  };
}

function makeTab(area, { blocked = false, prefix = 'hf.test.', trialCap = 60, engine = null } = {}) {
  const listeners = {};
  const tab = { pending: [], warnings: [], errors: [] };
  const ctx = {
    console: { log() {}, info() {}, warn: m => tab.warnings.push(String(m)), error: (...a) => tab.errors.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, crypto: webcrypto,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}
  };
  if (blocked) {
    Object.defineProperty(ctx, 'localStorage', { get() { const e = new Error('The document is sandboxed'); e.name = 'SecurityError'; throw e; } });
  } else {
    tab.ls = facade(area, tab);
    ctx.localStorage = tab.ls;
  }
  vm.createContext(ctx);
  for (const [f, code] of SRC) vm.runInContext(code, ctx, { filename: f });
  tab.HF = ctx.HF;
  if (engine) ctx.HF.engine = engine;
  tab.store = ctx.HF.store;
  tab.store.configure({ prefix, saveDelayMs: 0, trialCap });
  tab.deliver = () => {
    const evs = tab.pending.splice(0);
    for (const ev of evs) for (const fn of listeners.storage || []) fn(ev);
    return evs.length;
  };
  tab.close = () => area.tabs.delete(tab);
  if (!blocked) area.tabs.add(tab);
  return tab;
}

const note = (id, t = Date.now() - 1000) => r => { r.events.push({ id, t, type: 'note', text: id }); };
const eventIds = recs => plain(recs).events.map(e => e.id).sort();
const stored = (area, key = 'hf.test.main') => JSON.parse(area.map.get(key));

function bigLog(n) {
  const onsets = Array.from({ length: n }, (_, i) => i * 3000.37);
  return { kind: 'stream', onsets, shown: onsets.map(x => x + 16.7), offsets: onsets.map(x => x + 500.1), responses: [], voided: [], paused: false, pad: 'x'.repeat(1200) };
}

export default async function (t) {
  await t.test('memory mode when storage throws (sandbox): everything works in memory', async () => {
    const tab = makeTab(new Area(), { blocked: true });
    tab.store.load();
    t.eq(tab.store.persistent, false);
    t.eq(tab.store.status.reason, 'blocked');
    tab.store.mutate(note('e1'));
    t.eq(eventIds(tab.store.records), ['e1']);
    t.ok(tab.store.flush());
    tab.store.saveTrials('s1', 'b1', { kind: 'stream', onsets: [0, 3000], responses: [] });
    t.eq(plain(tab.store.loadTrials('s1')).blocks.b1.onsets, [0, 3000]);
    const text = tab.store.exportText();
    const other = makeTab(new Area(), { blocked: true });
    other.store.load();
    const res = other.store.importText(text);
    t.ok(res.ok, res.error);
    t.eq(res.added, 1);
    t.eq(res.trials, 1);
    t.eq(eventIds(other.store.records), ['e1']);
    t.ok(plain(other.store.loadTrials('s1')).blocks.b1, 'imported trial log');
    t.eq(tab.errors, []);
  });

  await t.test('first run saves defaults; a reload reads the same records', async () => {
    const area = new Area();
    const a = makeTab(area);
    a.store.load();
    t.ok(a.store.persistent);
    t.ok(await waitFor(() => area.map.has('hf.test.main')), 'saved in idle time');
    const b = makeTab(area);
    b.store.load();
    t.eq(plain(b.store.records).profile.anonId, plain(a.store.records).profile.anonId);
  });

  await t.test('mutate bumps rev, notifies, and saves; flush writes now', () => {
    const area = new Area();
    const a = makeTab(area);
    a.store.load();
    const seen = [];
    a.store.onChange(e => seen.push(plain(e)));
    const rev0 = a.store.records.rev;
    a.store.mutate(note('e1'));
    t.eq(a.store.records.rev, rev0 + 1);
    t.eq(seen.map(e => e.source), ['local']);
    t.ok(a.store.flush());
    t.eq(stored(area).rev, rev0 + 1);
    t.eq(stored(area).events.map(e => e.id), ['e1']);
  });

  await t.test('a save never overwrites another tab\'s write: it merges first', () => {
    const area = new Area();
    const a = makeTab(area), b = makeTab(area);
    a.store.load(); a.store.flush();
    b.store.load();
    a.store.mutate(note('fromA'));
    a.store.flush();
    const seen = [];
    b.store.onChange(e => seen.push(e.source));
    b.store.mutate(note('fromB')); // B has not seen A's write yet
    b.store.flush();
    t.eq(stored(area).events.map(e => e.id).sort(), ['fromA', 'fromB']);
    t.eq(eventIds(b.store.records), ['fromA', 'fromB']);
    t.ok(seen.includes('remote'), 'B told about A\'s data');
    a.deliver();
    t.eq(eventIds(a.store.records), ['fromA', 'fromB']);
  });

  await t.test('storage events merge; a tab with extra records writes the union back', async () => {
    const area = new Area();
    const a = makeTab(area), b = makeTab(area);
    a.store.load(); a.store.flush(); b.store.load();
    a.store.mutate(note('a1')); // unsaved in A
    b.store.mutate(note('b1'));
    b.store.flush();
    const seen = [];
    a.store.onChange(e => seen.push(e.source));
    t.ok(a.deliver() > 0);
    t.eq(seen, ['remote']);
    t.eq(eventIds(a.store.records), ['a1', 'b1']);
    await waitFor(() => stored(area).events.length === 2);
    t.eq(stored(area).events.map(e => e.id).sort(), ['a1', 'b1'], 'union saved');
    b.deliver();
    t.eq(eventIds(b.store.records), ['a1', 'b1']);
    // no ping-pong: once both agree, deliveries change nothing and trigger no writes
    await tick(20);
    a.deliver(); b.deliver();
    await tick(20);
    t.eq(a.pending.length + b.pending.length, 0);
  });

  await t.test('remote merges wait while a block is running (HF.timing.busy)', async () => {
    const area = new Area();
    const a = makeTab(area), b = makeTab(area);
    a.store.load(); a.store.flush(); b.store.load();
    a.HF.timing = { busy: true };
    b.store.mutate(note('b1')); b.store.flush();
    a.deliver();
    t.eq(eventIds(a.store.records), [], 'not merged during the stream');
    a.store.mutate(note('a1'));
    await tick(20);
    t.eq(stored(area).events.map(e => e.id), ['b1'], 'no save during the stream');
    a.HF.timing.busy = false;
    await waitFor(() => stored(area).events.length === 2 && a.store.records.events.length === 2);
    t.eq(eventIds(a.store.records), ['a1', 'b1']);
    t.eq(stored(area).events.map(e => e.id).sort(), ['a1', 'b1']);
  });

  await t.test('unreadable saved data is copied to a rescue key once, then replaced (CA-07)', () => {
    const bad = '{garbage' + 'x'.repeat(2000);
    for (const quota of [Infinity, 2 * (bad.length + 30) + 1500]) {   // the tight quota has room for one copy only
      const area = new Area(quota);
      area.map.set('hf.test.main', bad);
      const a = makeTab(area);
      a.store.load();
      const rk = a.store.status.rescueKey;
      t.ok(rk && area.map.get(rk) === bad, 'rescued');
      t.ok(a.warnings.some(w => /could not be read/.test(w)));
      a.store.mutate(note('e1'));
      t.ok(a.store.flush(), 'saved');
      t.eq(stored(area).events.map(e => e.id), ['e1']);
      t.eq(area.keys('hf.test.rescue.').length, 1, 'one rescue copy, not two');
      t.eq(a.store.status.rescueKey, rk, 'rescue key kept');
      t.eq(area.map.get(rk), bad);
    }
  });

  await t.test('data saved by a newer Long-Horizon is never written over: memory mode, reason newer (CA-04)', () => {
    const newer = JSON.stringify({ schema: 99, sessions: [], events: [{ id: 'theirs', t: 1, type: 'note' }] });
    const area = new Area();
    area.map.set('hf.test.main', newer);
    const a = makeTab(area);
    a.store.load();
    t.eq(a.store.persistent, false);
    t.eq(a.store.status.reason, 'newer');
    t.ok(/newer version of Long-Horizon/.test(a.store.status.message) && /Reload this tab/.test(a.store.status.message), a.store.status.message);
    a.store.mutate(note('mine'));
    a.store.flush();
    t.eq(area.map.get('hf.test.main'), newer, 'untouched at load and after a save');
    t.eq(area.keys('hf.test.rescue.'), [], 'no rescue copy');
    // a newer tab writes while this tab runs: the re-read before the next save stops it
    const area2 = new Area();
    const b = makeTab(area2);
    b.store.load(); b.store.flush();
    const seen = [];
    b.store.onChange(e => seen.push(e.source + ':' + (e.reason || '')));
    area2.map.set('hf.test.main', newer);
    b.store.mutate(note('mine'));
    t.eq(b.store.flush(), false);
    t.eq(area2.map.get('hf.test.main'), newer, 'never overwritten at save');
    t.eq(b.store.status.reason, 'newer');
    t.ok(seen.includes('status:newer'), 'subscribers told');
    // … and through a storage event
    const area3 = new Area();
    const c = makeTab(area3), d = makeTab(area3);
    c.store.load(); c.store.flush(); d.store.load();
    d.ls.setItem('hf.test.main', newer);
    c.deliver();
    t.eq([c.store.persistent, c.store.status.reason], [false, 'newer']);
    c.store.mutate(note('mine')); c.store.flush();
    t.eq(area3.map.get('hf.test.main'), newer);
  });

  await t.test('damaged but usable data is repaired on load and saved back', () => {
    const area = new Area();
    area.map.set('hf.test.main', JSON.stringify({ schema: 1, sessions: [{ id: 's1', startedAt: 5 }, { id: 'x' }], settings: { volume: 'x' } }));
    const a = makeTab(area);
    a.store.load();
    t.eq(plain(a.store.records).sessions.map(s => s.id), ['s1']);
    t.ok(a.store.status.loadErrors.length >= 2);
    a.store.flush();
    t.eq(stored(area).settings.volume, 0.8);
  });

  await t.test('quota: oldest training trial keys go first; main and Lab logs stay; one warning', () => {
    const area = new Area(24000);
    const a = makeTab(area);
    a.store.load();
    a.store.mutate(r => { r.labVisits.push({ id: 'lab1', kind: 'B1', startedAt: 1 }); });
    a.store.saveTrials('lab1', 'x', bigLog(8), { kind: 'lab' });
    a.store.flush();
    for (let i = 1; i <= 20; i++) {
      a.store.mutate(r => { r.sessions.push({ id: 's' + i, startedAt: 1000 + i, dayKey: '2026-11-06' }); });
      a.store.saveTrials('s' + i, 'b1', bigLog(10));
      t.ok(a.store.flush() !== undefined);
    }
    const keys = area.keys('hf.test.trials.');
    t.ok(keys.includes('hf.test.trials.lab1'), 'lab kept');
    t.ok(keys.includes('hf.test.trials.s20') && keys.includes('hf.test.trials.s19'), 'newest kept');
    t.ok(!keys.includes('hf.test.trials.s1'), 'oldest dropped');
    t.ok(a.store.status.droppedTrialKeys > 0);
    t.eq(stored(area).sessions.length, 20, 'main intact');
    t.ok(area.bytes() <= 24000);
    t.eq(a.warnings.filter(w => /storage is full/i.test(w)).length, 1, 'warned once');
    const kept = keys.filter(k => /s\d+$/.test(k)).map(k => +k.split('.s')[1]).sort((x, y) => x - y);
    t.eq(kept, Array.from({ length: kept.length }, (_, i) => 21 - kept.length + i), 'a contiguous newest run');
  });

  await t.test('trial cap keeps the newest N training sessions (Lab logs exempt)', () => {
    const area = new Area();
    const a = makeTab(area, { trialCap: 5 });
    a.store.load();
    a.store.mutate(r => { r.labVisits.push({ id: 'lab1', kind: 'B1', startedAt: 1 }); });
    a.store.saveTrials('lab1', 'x', { onsets: [0] }, { kind: 'lab' });
    for (let i = 1; i <= 8; i++) {
      a.store.mutate(r => { r.sessions.push({ id: 's' + i, startedAt: 1000 + i, dayKey: '2026-11-06' }); });
      a.store.saveTrials('s' + i, 'b1', { onsets: [0, i] });
      a.store.flush();
    }
    t.eq(area.keys('hf.test.trials.'), ['hf.test.trials.lab1', 'hf.test.trials.s4', 'hf.test.trials.s5', 'hf.test.trials.s6', 'hf.test.trials.s7', 'hf.test.trials.s8']);
    t.eq(a.store.trialSessionIds().sort(), ['lab1', 's4', 's5', 's6', 's7', 's8']);
  });

  await t.test('trial logs are stored encoded and decode in another tab', () => {
    const area = new Area();
    const a = makeTab(area);
    a.store.load();
    const log = { kind: 'stream', onsets: [0, 3000.04, 6000.1], shown: [16.7, 3016.71, 6016.7], offsets: [500, 3500, 6500.02], responses: [{ key: 'match', t: 3612.4, trial: 1, rt: 612.36, src: 'key' }], voided: [], paused: false };
    a.store.saveTrials('s1', 'b1', log);
    a.store.flush();
    const raw = JSON.parse(area.map.get('hf.test.trials.s1'));
    t.eq(raw.blocks.b1.v, 1);
    t.eq(raw.kind, 'training');
    const b = makeTab(area);
    b.store.load();
    const back = plain(b.store.loadTrials('s1')).blocks.b1;
    t.eq(back.onsets, [0, 3000, 6000.1]);
    t.eq(back.responses[0].rt, 612.4);
    t.eq(b.store.loadTrials('nope'), null);
  });

  await t.test('export → reset → import restores everything; garbage import is refused', () => {
    const area = new Area();
    const a = makeTab(area);
    a.store.load();
    a.store.mutate(note('e1'));
    a.store.mutate(r => { r.settings = Object.assign({}, r.settings, { volume: 0.3, updatedAt: Date.now() }); });
    a.store.saveTrials('s1', 'b1', { onsets: [0, 1] });
    const text = a.store.exportText();
    t.ok(plain(a.store.records).backups.lastExportAt > 0, 'export stamped');
    a.store.reset();
    t.eq(eventIds(a.store.records), []);
    t.eq(area.keys('hf.test.trials.'), []);
    const res = a.store.importText(text);
    t.ok(res.ok, res.error);
    t.eq(res.added, 1);
    t.eq(eventIds(a.store.records), ['e1']);
    t.eq(plain(a.store.records).settings.volume, 0.3);
    t.ok(area.keys('hf.test.trials.').includes('hf.test.trials.s1'), 'trial logs restored');
    const before = JSON.stringify(plain(a.store.records));
    for (const bad of ['', 'nope', '{"x":1}', '[1,2]']) {
      const r = a.store.importText(bad);
      t.ok(!r.ok && typeof r.error === 'string' && r.error.length > 10, bad);
    }
    t.eq(JSON.stringify(plain(a.store.records)), before, 'unchanged after bad imports');
  });

  await t.test('a reset in one tab is not undone by another tab that still holds the old data', async () => {
    const area = new Area();
    const a = makeTab(area), b = makeTab(area);
    a.store.load(); a.store.mutate(note('old1')); a.store.flush();
    b.store.load(); b.store.mutate(note('old2')); // B has old data, unsaved
    a.store.reset();
    const seen = [];
    b.store.onChange(e => seen.push(e.source));
    b.deliver();
    t.ok(seen.includes('remote'));
    t.eq(eventIds(b.store.records), [], 'old data dropped in B');
    b.store.mutate(note('after', Date.now() + 5));
    b.store.flush();
    t.eq(stored(area).events.map(e => e.id), ['after']);
    a.deliver();
    t.eq(eventIds(a.store.records), ['after']);
  });

  await t.test('quota on main: lasting memory mode, reason quota, after the trial logs went first (CA-05)', () => {
    const area = new Area(9000);
    const a = makeTab(area);
    a.store.load(); a.store.flush();
    a.store.saveTrials('s0', 'b1', bigLog(4)); a.store.flush();
    const seen = [];
    a.store.onChange(e => seen.push(e.source + ':' + (e.reason || '')));
    let i = 0;
    while (a.store.persistent && i < 300) {
      a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1000 + i, type: 'note', text: 'x'.repeat(200) }); });
      a.store.flush();
      i++;
    }
    t.eq(a.store.persistent, false, 'memory mode once main no longer fits');
    t.eq([a.store.status.reason, a.store.status.saveError], ['quota', 'QuotaExceededError']);
    t.ok(/full/.test(a.store.status.message) && /Export/.test(a.store.status.message), a.store.status.message);
    t.ok(seen.includes('status:quota'), 'subscribers told (source status)');
    t.eq(area.keys('hf.test.trials.'), [], 'trial logs were dropped first');
    const kept = area.map.get('hf.test.main');
    a.store.mutate(note('later'));
    a.store.flush();
    t.eq(area.map.get('hf.test.main'), kept, 'nothing written any more');
    t.ok(a.store.exportText().includes('"later"'), 'Export still has everything');
    t.eq(a.warnings.filter(w => /Long-Horizon is full/.test(w)).length, 1, 'one toast; the lasting state is status.message');
  });

  await t.test('main near the size limit: engine compaction before saving, then an early warning (CA-05)', () => {
    let calls = 0;
    const engine = { compactRecords(r, now, opts) {
      calls++;
      t.ok(typeof now === 'number' && opts && opts.targetChars > 0, 'called with (records, now, opts)');
      const out = JSON.parse(JSON.stringify(r));
      let changed = false;
      for (const e of out.events) if (e.text && e.text.length > 5) { e.text = e.text.slice(0, 5); e.updatedAt = now; changed = true; }
      return changed ? { records: out } : null;
    } };
    const area = new Area();
    const a = makeTab(area, { engine });
    a.store.configure({ nearFullChars: 4000 });
    a.store.load(); a.store.flush();
    const seen = [];
    a.store.onChange(e => { if (e.source === 'status') seen.push(e.nearFull); });
    for (let i = 0; i < 12; i++) a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1000 + i, type: 'note', text: 'x'.repeat(400) }); });
    a.store.flush();
    t.ok(calls >= 1, 'compactRecords called above the threshold');
    t.ok(stored(area).events.every(e => e.text.length === 5), 'the compacted records were saved');
    t.ok(a.store.status.compactedAt > 0 && !a.store.status.nearFull && a.store.status.mainChars < 4000, 'back under the threshold');
    for (let i = 12; i < 90; i++) a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1000 + i, type: 'note', text: 'y' }); });
    a.store.flush();
    t.ok(a.store.status.nearFull && a.store.status.mainChars >= 4000, 'near-full flag when compaction cannot help');
    t.ok(/Export a backup/.test(a.store.status.nearFullText), a.store.status.nearFullText);
    t.eq(seen, [true], 'subscribers told once (source status, nearFull true)');
    t.eq(a.warnings.filter(w => /getting large/.test(w)).length, 1, 'warned once');
    t.eq(a.store.persistent, true, 'still saving');
    const bare = makeTab(new Area());
    bare.store.configure({ nearFullChars: 500 });
    bare.store.load(); bare.store.mutate(note('e1'));
    t.ok(bare.store.flush() && bare.store.status.nearFull, 'no engine: no compaction, still the warning');
    const broken = makeTab(new Area(), { engine: { compactRecords() { throw new Error('boom'); } } });
    broken.store.configure({ nearFullChars: 500 });
    broken.store.load(); broken.store.mutate(note('e1'));
    t.ok(broken.store.flush(), 'a failing compactRecords never blocks the save');
    t.ok(broken.errors.some(e => /compactRecords failed/.test(e)), 'and is logged');
  });

  await t.test('compaction in place (same object returned) is saved too (CA-05)', () => {
    const engine = { compactRecords(r) { for (const e of r.events) if (e.text) e.text = e.text.slice(0, 3); return r; } };
    const area = new Area();
    const a = makeTab(area, { engine });
    a.store.configure({ nearFullChars: 2000 });
    a.store.load();
    for (let i = 0; i < 8; i++) a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1 + i, type: 'note', text: 'q'.repeat(300) }); });
    a.store.flush();
    t.ok(stored(area).events.every(e => e.text.length === 3), 'the in-place compaction reached storage');
    t.ok(a.store.status.compactedAt > 0);
  });

  await t.test('quota: one forced compaction can make main fit again (CA-05)', () => {
    let forced = false;
    const engine = { compactRecords(r, now, opts) {
      if (!opts.force) return null;
      forced = true;
      const out = JSON.parse(JSON.stringify(r));
      out.events = out.events.map(e => ({ id: e.id, t: e.t, type: e.type, updatedAt: now }));
      return out;
    } };
    const area = new Area(5000);
    const a = makeTab(area, { engine });
    a.store.load(); a.store.flush();
    for (let i = 0; i < 30; i++) a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1 + i, type: 'note', text: 'z'.repeat(150) }); });
    t.ok(a.store.flush(), 'saved after a forced compaction');
    t.ok(forced && a.store.persistent, 'compaction was forced and the store still saves');
    t.eq(stored(area).events.length, 30);
  });

  await t.test('two tabs: a compacted copy wins the merge, no write ping-pong (CA-05)', async () => {
    const engine = { compactRecords(r, now) {
      const out = JSON.parse(JSON.stringify(r));
      let changed = false;
      for (const e of out.events) if (e.text && e.text.length > 5) { e.text = e.text.slice(0, 5); e.updatedAt = now; changed = true; }
      return changed ? { records: out } : null;
    } };
    const area = new Area();
    const a = makeTab(area, { engine }), b = makeTab(area, { engine });
    a.store.load(); a.store.flush();
    for (let i = 0; i < 10; i++) a.store.mutate(r => { r.events.push({ id: 'e' + i, t: 1000 + i, type: 'note', text: 'x'.repeat(400) }); });
    a.store.flush();
    b.store.load();
    t.ok(plain(b.store.records).events.every(e => e.text.length === 400), 'B holds the long copies');
    a.store.configure({ nearFullChars: 3000 });
    b.store.configure({ nearFullChars: 3000 });
    a.store.mutate(note('n1'));
    a.store.flush();
    t.ok(stored(area).events.filter(e => e.text && e.text.length === 5).length === 10, 'A saved compacted copies');
    let rounds = 0;
    while ((a.pending.length || b.pending.length) && rounds < 20) { a.deliver(); b.deliver(); await tick(20); rounds++; }
    t.ok(rounds < 20, 'no endless writes between the tabs');
    t.ok(plain(b.store.records).events.filter(e => e.id.startsWith('e')).every(e => e.text.length === 5), 'B adopted the compacted copies');
    t.ok(stored(area).events.filter(e => e.id.startsWith('e')).every(e => e.text.length === 5), 'storage keeps them compacted');
  });

  await t.test('exportText({ stamp: false }) leaves the backup time alone; markBackup() records it (CB-01)', () => {
    const a = makeTab(new Area());
    a.store.load();
    const rev0 = a.store.records.rev;
    const text = a.store.exportText({ stamp: false });
    t.ok(text.includes('"long-horizon-backup"'), 'backup text');
    t.eq(plain(a.store.records).backups.lastExportAt, null, 'not stamped');
    t.eq(a.store.records.rev, rev0, 'records unchanged');
    const seen = [];
    a.store.onChange(e => seen.push(e.source));
    const at = a.store.markBackup();
    t.eq(plain(a.store.records).backups.lastExportAt, at);
    t.eq(seen, ['local'], 'a normal change (saved, subscribers told)');
    a.store.exportText();
    t.ok(plain(a.store.records).backups.lastExportAt >= at, 'the default export still stamps');
  });

  await t.test('derived: HF.engine.derive(records, now) cached until the next change; {} without an engine', () => {
    let calls = 0;
    const engine = { derive: (r, now) => ({ events: r.events.length, now, calls: ++calls }) };
    const a = makeTab(new Area(), { engine });
    a.store.load();
    const d1 = a.store.derived, d2 = a.store.derived;
    t.ok(d1 === d2 && calls === 1);
    t.ok(typeof d1.now === 'number' && Math.abs(d1.now - Date.now()) < 5000);
    a.store.mutate(note('e1'));
    t.eq(a.store.derived.events, 1);
    t.eq(calls, 2);
    const bare = makeTab(new Area());
    bare.store.load();
    t.eq(plain(bare.store.derived), {});
    const broken = makeTab(new Area(), { engine: { derive() { throw new Error('boom'); } } });
    broken.store.load();
    t.eq(plain(broken.store.derived), {});
    t.ok(broken.errors.some(e => /derive failed/.test(e)), 'error logged');
  });

  // ---------------------------------------------------------------- working-name migration (13 Nov 2026)
  // 1.0.0 ran under the working name Holdfast with keys holdfast.v1.*; tabs below use the real default prefix.
  await t.test('migration: holdfast.v1.* is copied once to long-horizon.v1.*; legacy keys are never written or deleted', () => {
    const area = legacyArea();
    const before = snapshot(area, OLD);
    const a = makeTab(area, { prefix: null });
    a.store.load();
    t.eq(a.store.keys.main(), NEW + 'main', 'default prefix long-horizon.v1.');
    const L = plain(a.store.status.legacy);
    t.eq([L.from, L.main, L.copied, L.skipped], [OLD, true, 6, 0], 'main, the flag, three trial logs and the rescue copy');
    for (const k of ['main', 'iab-dismissed', 'trials.s1', 'trials.s2', 'trials.lab1', 'rescue.123']) t.eq(area.map.get(NEW + k), area.map.get(OLD + k), k + ' copied as is');
    t.eq(area.map.get('other.app'), 'x', 'other keys untouched');
    t.eq(eventIds(a.store.records), ['e-old'], 'records loaded from the copy');
    t.eq(plain(a.store.records).profile.anonId, 'anon-legacy');
    t.eq(plain(a.store.loadTrials('s1')).blocks.b1.onsets, [0, 3000], 'trial logs readable under the new name');
    t.eq(a.store.trialSessionIds().sort(), ['lab1', 's1', 's2']);
    a.store.mutate(note('e-new'));
    a.store.saveTrials('s3', 'b1', { onsets: [0] });
    a.store.flush();
    t.eq(eventIds(stored(area, NEW + 'main')), ['e-new', 'e-old'], 'saves go to the new name');
    t.eq(snapshot(area, OLD), before, 'legacy keys never written or deleted');
    // one time only: a later load copies nothing, even after an old copy of the app wrote to its keys again
    area.map.set(OLD + 'main', JSON.stringify(Object.assign(JSON.parse(area.map.get(OLD + 'main')), { events: [] })));
    area.map.set(OLD + 'trials.s9', JSON.stringify({ sessionId: 's9', kind: 'training', updatedAt: 1, blocks: {} }));
    const b = makeTab(area, { prefix: null });
    b.store.load();
    t.eq(b.store.status.legacy, null, 'no second copy');
    t.eq(eventIds(b.store.records), ['e-new', 'e-old']);
    t.ok(!area.map.has(NEW + 'trials.s9'), 'later legacy keys are not picked up');
    t.eq(a.errors.concat(b.errors), []);
    t.eq(a.warnings.concat(b.warnings), [], 'no warnings');
  });

  await t.test('migration: reset ("Delete everything") also removes the legacy copies, and nothing comes back', () => {
    const area = legacyArea();
    const a = makeTab(area, { prefix: null });
    a.store.load();
    t.ok(area.map.has(NEW + 'main') && area.map.has(OLD + 'main'), 'copied, legacy kept');
    a.store.reset();
    const oldLeft = [...area.map.keys()].filter(k => k.indexOf(OLD) === 0);
    t.eq(oldLeft, [], 'no holdfast.v1.* key left after reset');
    t.eq(area.map.get('other.app'), 'x', 'other apps\' keys untouched');
    const b = makeTab(area, { prefix: null });
    b.store.load();
    t.eq(b.store.status.legacy, null, 'no copy after reset');
    t.eq(eventIds(b.store.records), [], 'fresh records');
  });

  await t.test('migration: the copy goes through the normal schema guard (repair, rescue, newer); legacy main untouched', async () => {
    const bad = JSON.stringify({ schema: 1, sessions: [{ id: 's1', startedAt: 5 }, { id: 'x' }], settings: { volume: 'x' } });
    const area = new Area();
    area.map.set(OLD + 'main', bad);
    const a = makeTab(area, { prefix: null });
    a.store.load();
    t.eq(plain(a.store.records).sessions.map(s => s.id), ['s1'], 'an invalid session is dropped');
    t.ok(a.store.status.loadErrors.length >= 2, 'guard errors reported');
    t.ok(await waitFor(() => stored(area, NEW + 'main').settings.volume === 0.8), 'the repaired copy is saved under the new name');
    t.eq(area.map.get(OLD + 'main'), bad, 'legacy main untouched');
    const area2 = new Area();
    area2.map.set(OLD + 'main', '{not json');
    const b = makeTab(area2, { prefix: null });
    b.store.load();
    t.ok((b.store.status.rescueKey || '').indexOf(NEW + 'rescue.') === 0, 'unreadable data rescued under the new name');
    t.eq(area2.map.get(OLD + 'main'), '{not json', 'legacy main untouched');
    const area3 = new Area();
    area3.map.set(OLD + 'main', JSON.stringify({ schema: 99, sessions: [] }));
    const c = makeTab(area3, { prefix: null });
    c.store.load();
    t.eq([c.store.persistent, c.store.status.reason], [false, 'newer'], 'data of a newer version: memory mode, never written over');
  });

  await t.test('migration: nothing is copied when long-horizon.v1.main exists; an existing new key is never overwritten', () => {
    const area = legacyArea();
    area.map.set(NEW + 'main', JSON.stringify({ schema: 1, events: [{ id: 'e-mine', t: 5, type: 'note', text: 'mine' }] }));
    const a = makeTab(area, { prefix: null });
    a.store.load();
    t.eq(a.store.status.legacy, null);
    t.eq(eventIds(a.store.records), ['e-mine']);
    t.eq(area.keys(NEW + 'trials.'), [], 'no legacy trial logs copied');
    const area2 = legacyArea();
    area2.map.set(NEW + 'iab-dismissed', '0');
    const b = makeTab(area2, { prefix: null });
    b.store.load();
    t.eq(area2.map.get(NEW + 'iab-dismissed'), '0', 'the existing key is kept');
    t.eq(plain(b.store.status.legacy).copied, 5, 'everything else copied');
    const blocked = makeTab(legacyArea(), { blocked: true, prefix: null });
    blocked.store.load();
    t.eq([blocked.store.persistent, blocked.store.status.legacy], [false, null], 'blocked storage: no copy, memory mode');
  });

  await t.test('migration under quota: main first, then Lab logs, then the newest training logs; one warning', () => {
    const area = legacyArea();
    const size = k => k.length + area.map.get(OLD + k.slice(NEW.length)).length;   // bytes of the copy of an old key
    area.quota = area.bytes() + size(NEW + 'main') + size(NEW + 'iab-dismissed') + size(NEW + 'trials.lab1') + size(NEW + 'trials.s2')
      + (NEW + '__probe').length + 1;   // room for the storage probe only beyond these copies
    const before = snapshot(area, OLD);
    const a = makeTab(area, { prefix: null });
    a.store.load();
    const L = plain(a.store.status.legacy);
    t.eq([L.main, L.copied, L.skipped], [true, 4, 2], 'main, flag, Lab log and newest training log copied; the rest did not fit');
    t.eq(area.keys(NEW).filter(k => k !== NEW + 'main'), [NEW + 'iab-dismissed', NEW + 'trials.lab1', NEW + 'trials.s2'].sort());
    t.eq(a.warnings.filter(w => /trial-by-trial details were not kept/.test(w)).length, 1, 'warned once');
    t.eq(eventIds(a.store.records), ['e-old'], 'records intact');
    t.eq(snapshot(area, OLD), before, 'legacy keys untouched (the rest stays there)');
  });

  await t.test('migration: when main does not fit, records come from the legacy text and the save reports quota', async () => {
    const area = legacyArea();
    area.quota = area.bytes() + (NEW + '__probe').length + 1;   // room for the storage probe only
    const before = snapshot(area, OLD);
    const a = makeTab(area, { prefix: null });
    a.store.load();
    const L = plain(a.store.status.legacy);
    t.eq([L.main, L.copied, L.skipped], [false, 0, 1], 'main did not fit; nothing else was copied');
    t.eq(eventIds(a.store.records), ['e-old'], 'records read from the legacy text');
    t.ok(await waitFor(() => a.store.status.reason === 'quota'), 'the save reports the lasting quota state');
    t.eq(a.store.persistent, false, 'memory mode');
    t.ok(a.store.exportText().includes('"e-old"'), 'Export has the legacy records');
    t.eq(snapshot(area, OLD), before, 'legacy keys untouched');
  });
}

// ---------------------------------------------------------------- migration fixtures (legacy = 1.0.0 under the working name Holdfast)
const NEW = 'long-horizon.v1.', OLD = 'holdfast.v1.';
const snapshot = (area, prefix) => area.keys(prefix).map(k => [k, area.map.get(k)]);
function legacyArea(quota = Infinity) {
  const area = new Area(quota);
  const recs = {
    schema: 1, appVersion: '1.0.0', rev: 7, createdAt: 1000, updatedAt: 9000, resetAt: 0,
    profile: { updatedAt: 1000, anonId: 'anon-legacy', firstRunDone: true, path: 'train', startedAt: 1000 },
    settings: { updatedAt: 0 }, calibration: null, backups: { updatedAt: 0, lastExportAt: null },
    sessions: [{ id: 's1', startedAt: 2000, dayKey: '2026-11-12' }, { id: 's2', startedAt: 5000, dayKey: '2026-11-12' }],
    blocks: [], labVisits: [{ id: 'lab1', kind: 'B1', startedAt: 3000 }],
    events: [{ id: 'e-old', t: 1500, type: 'note', text: 'from 1.0.0' }]
  };
  const doc = (sid, kind, t) => JSON.stringify({ sessionId: sid, kind, updatedAt: t, blocks: { b1: { onsets: [0, 3000], pad: 'p'.repeat(1200) } } });
  area.map.set(OLD + 'main', JSON.stringify(recs));
  area.map.set(OLD + 'trials.s1', doc('s1', 'training', 2100));
  area.map.set(OLD + 'trials.s2', doc('s2', 'training', 5100));
  area.map.set(OLD + 'trials.lab1', doc('lab1', 'lab', 3100));
  area.map.set(OLD + 'iab-dismissed', '1');
  area.map.set(OLD + 'rescue.123', 'garbage from 1.0.0');
  area.map.set('other.app', 'x');
  return area;
}
