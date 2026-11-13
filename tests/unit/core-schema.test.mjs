// Unit tests for js/core/schema.js (pure). Run: node tests/unit/run.mjs core-schema
import { HF } from './load.mjs';

const S = HF.schema, U = HF.util;
const ARR = S.ARRAY_NAMES;

// ---------- helpers ----------
function validRecords(r) {
  const errs = [];
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  if (r.schema !== S.SCHEMA) errs.push('schema');
  if (!(Number.isInteger(r.rev) && r.rev >= 0)) errs.push('rev');
  for (const k of ['createdAt', 'updatedAt', 'resetAt']) if (!fin(r[k])) errs.push(k);
  for (const k of ['profile', 'settings', 'backups']) if (!U.isPlainObject(r[k]) || !fin(r[k].updatedAt)) errs.push(k);
  if (!(r.calibration === null || (U.isPlainObject(r.calibration) && fin(r.calibration.updatedAt)))) errs.push('calibration');
  if (typeof r.profile.anonId !== 'string' || !r.profile.anonId) errs.push('anonId');
  const d = S.SETTINGS_DEFAULTS;
  for (const k of Object.keys(d)) {
    const v = r.settings[k];
    if (d[k] === null) { if (!(v === null || typeof v === 'boolean')) errs.push('settings.' + k); continue; }
    if (k === 'keys') { for (const kk of Object.keys(d.keys)) if (!(typeof v[kk] === 'string' || Array.isArray(v[kk]))) errs.push('keys.' + kk); continue; }
    if (typeof v !== typeof d[k]) errs.push('settings.' + k);
  }
  for (const name of ARR) {
    if (!Array.isArray(r[name])) { errs.push(name); continue; }
    const ids = new Set();
    for (const x of r[name]) {
      if (!U.isPlainObject(x) || typeof x.id !== 'string' || !x.id) { errs.push(name + ' item'); continue; }
      if (ids.has(x.id)) errs.push(name + ' dup ' + x.id);
      ids.add(x.id);
      for (const [f, ty] of Object.entries(S.ARRAYS[name].req)) {
        if (ty === 'time' ? !(fin(x[f]) && Math.abs(x[f]) <= 8.64e15) : (typeof x[f] !== 'string' || !x[f])) errs.push(name + '.' + f);
      }
      if (name === 'sessions' && !U.isDayKey(x.dayKey)) errs.push('dayKey');
    }
  }
  return errs;
}

function randomRecords(r) {
  const rec = S.defaultRecords(1000 + r.int(0, 999), 'u-' + r.int(1, 4));
  rec.rev = r.int(0, 50);
  rec.updatedAt = r.int(2000, 5000);
  rec.settings.updatedAt = r.int(0, 3) * 1000;
  rec.settings.volume = r.int(0, 10) / 10;
  rec.profile.updatedAt = r.int(0, 3) * 1000;
  if (r.chance(0.3)) rec.calibration = { updatedAt: r.int(1, 4) * 100, version: 1, source: 'x', tests: {} };
  const nS = r.int(0, 6);
  for (let i = 0; i < nS; i++) {
    const id = 's' + r.int(1, 8);
    if (rec.sessions.some(x => x.id === id)) continue;
    const s = { id, startedAt: 10000 + r.int(0, 100) * 1000, dayKey: '2026-11-0' + r.int(1, 9), mode: 'varied', completed: r.int(0, 10), endedAt: r.chance(0.5) ? 20000 + r.int(0, 100) : null };
    if (r.chance(0.5)) s.updatedAt = r.int(1, 5) * 1000;
    rec.sessions.push(s);
  }
  const nB = r.int(0, 12);
  for (let i = 0; i < nB; i++) {
    const id = 'b' + r.int(1, 30);
    if (rec.blocks.some(x => x.id === id)) continue;
    rec.blocks.push({ id, sessionId: 's' + r.int(1, 8), trackId: r.pick(['nback.plain', 'rel.steps']), t: r.int(0, 1e6), result: { ba: r.int(0, 100) / 100 } });
  }
  const nE = r.int(0, 6);
  for (let i = 0; i < nE; i++) {
    const id = 'e' + r.int(1, 20);
    if (rec.events.some(x => x.id === id)) continue;
    rec.events.push({ id, t: r.int(0, 1e6), type: 'note', text: 'n' + r.int(1, 3) });
  }
  if (r.chance(0.4)) rec.labVisits.push({ id: 'v' + r.int(1, 3), kind: 'B1', startedAt: r.int(0, 1e6), tests: {} });
  if (r.chance(0.2)) rec.extraThing = { v: r.int(1, 3) };
  return S.migrate(rec).records;
}

function damage(r, value, depth = 0) {
  const junk = () => r.pick([null, 0, -1, 1e308, 'x', '', true, [], {}, [1, 'a', null], { id: 5 }, { id: '' }]);
  if (depth > 4) return value;
  if (Array.isArray(value)) {
    const out = value.map(v => (r.chance(0.15) ? junk() : damage(r, v, depth + 1)));
    if (r.chance(0.3)) out.push(junk());
    if (r.chance(0.2) && out.length) out.push(out[0]);
    return out;
  }
  if (U.isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (r.chance(0.1)) continue;
      out[k] = r.chance(0.12) ? junk() : damage(r, v, depth + 1);
    }
    if (r.chance(0.1)) out['junk' + r.int(1, 9)] = junk();
    return out;
  }
  return value;
}

function approxEqual(a, b, tol, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > tol) throw new Error(`${path}: ${a} vs ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) throw new Error(`${path}: array mismatch`);
    a.forEach((x, i) => approxEqual(x, b[i], tol, `${path}[${i}]`));
    return;
  }
  if (U.isPlainObject(a) && U.isPlainObject(b)) {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} vs ${kb}`);
    ka.forEach(k => approxEqual(a[k], b[k], tol, `${path}.${k}`));
    return;
  }
  if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

function streamLog(r, n = 23) {
  let t = 0;
  const onsets = [], shown = [], offsets = [];
  for (let i = 0; i < n; i++) {
    onsets.push(+t.toFixed(2));
    shown.push(+(t + 16.67 + r.next()).toFixed(2));
    offsets.push(+(t + 500 + r.next() * 2).toFixed(2));
    t += 3000 + r.next() * 3;
  }
  const responses = [];
  for (let i = 0; i < 8; i++) {
    const trial = r.int(0, n - 1), rt = +(300 + r.next() * 900).toFixed(2);
    responses.push({ key: r.chance(0.8) ? 'match' : 'match2', t: +(onsets[trial] + rt).toFixed(2), trial, rt, src: r.pick(['key', 'touch', 'mouse']) });
  }
  return {
    kind: 'stream', responses, voided: [3], paused: false, pause: null, aborted: false, n, presented: n, onsets, shown, offsets,
    interval: 16.67, onFrames: 30, soaFrames: 180, frame: { fps: 60, medianMs: 16.667, maxMs: 17.2, stalls: 0, lowPrecision: false },
    flags: { late: [], stall: [] }, audio: null, startedAt: 1762430000000, t0: 12345.67
  };
}

function discreteLog(r, n = 20) {
  const onsets = [], shown = [], offsets = [], answers = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    onsets.push(+t.toFixed(2));
    shown.push(+(t + 16.7).toFixed(2));
    const rt = r.chance(0.9) ? +(500 + r.next() * 4000).toFixed(2) : null;
    offsets.push(+(t + (rt || 8000) + 16.7).toFixed(2));
    answers.push({ i, response: rt === null ? null : r.pick(['match', 'no']), rt, voided: r.chance(0.05), src: rt === null ? null : 'key' });
    t += (rt || 8000) + 120;
  }
  return { kind: 'discrete', answers, paused: true, pauses: [{ start: 1000, end: 4000, reasons: ['key', 'hidden'] }], aborted: false, n, presented: n, onsets, shown, offsets, interval: 16.67, frame: { fps: 60, medianMs: 16.667, maxMs: 33.4, stalls: 0, lowPrecision: false }, flags: { late: [], stall: [] }, startedAt: 1762430000000, t0: 99.5 };
}

export default async function (t) {
  await t.test('defaultRecords matches SPEC §3 / §3.1', () => {
    const r = S.defaultRecords(5000, 'u-1');
    t.eq(r.schema, 1);
    t.eq([r.rev, r.createdAt, r.updatedAt, r.resetAt], [0, 5000, 5000, 0]);
    t.eq(r.profile, { updatedAt: 0, anonId: 'u-1', firstRunDone: false, path: null, startedAt: null });
    t.eq(r.calibration, null);
    t.eq(r.backups, { updatedAt: 0, lastExportAt: null });
    for (const a of ARR) t.eq(r[a], []);
    const s = Object.assign({}, r.settings); delete s.updatedAt;
    t.eq(s, {
      mode: 'varied', sessionMinutes: 25, weeklyTarget: 4, balance: { nback: 50, relations: 50, span: 0 }, spanOn: false,
      sound: 'tones', volume: 0.8, audioOffsetMs: 0,
      keys: { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' },
      perResponseFeedback: null, focusMode: false, theme: 'system', largeText: false,
      leftHanded: false, reducedMotion: null, protocols: { cao: true, wang: true, jaeggi: false },
      includeLevelsInShare: false, labConfig: 'standard', dual: false, freePace: 'std'
    });
    t.eq(r.settings.updatedAt, 0);
    t.ok(S.defaultRecords().profile.anonId !== S.defaultRecords().profile.anonId, 'fresh anon ids');
    t.eq(validRecords(r), []);
  });

  await t.test('migrate keeps valid records unchanged, accepts JSON text, never mutates input', () => {
    const rr = HF.rng.create('m1');
    for (let i = 0; i < 50; i++) {
      const rec = randomRecords(rr);
      const before = U.stableStringify(rec);
      const m = S.migrate(rec);
      t.eq(m.errors, [], 'errors');
      t.eq(m.fatal, false);
      t.eq(m.migratedFrom, null);
      t.ok(U.deepEqual(m.records, rec), 'unchanged');
      t.eq(U.stableStringify(rec), before, 'input untouched');
      t.ok(U.deepEqual(S.migrate(JSON.stringify(rec)).records, JSON.parse(JSON.stringify(rec))), 'from text');
    }
  });

  await t.test('schema guard: unusable input is fatal and gives fresh records', () => {
    for (const bad of [null, undefined, 42, 'garbage', '{', '[]', [], {}, { foo: 1 }, { schema: 2 }, { schema: 'x' }, { schema: 1.5 }, { schema: -1 }, true]) {
      const m = S.migrate(bad);
      t.ok(m.fatal, JSON.stringify(bad));
      t.eq(validRecords(m.records), []);
      t.ok(m.errors.length === 1 && typeof m.errors[0] === 'string');
    }
    t.ok(/newer version/.test(S.migrate({ schema: 7, sessions: [] }).errors[0]));
  });

  await t.test('schema guard repairs damaged records and lists what it dropped', () => {
    const m = S.migrate({
      schema: 1, rev: -3, createdAt: 'x',
      profile: 'nope',
      settings: { volume: 'loud', keys: { match: 5, match2: 'KeyL', pause: [] }, balance: { nback: 500, relations: 'x', extra: 1 }, theme: 'dark', sessionMinutes: 1000, reducedMotion: true, perResponseFeedback: 'yes', futureSetting: { a: 1 } },
      sessions: [{ id: 7, startedAt: 1762430000000 }, { id: 's2' }, null, 'x', { id: 's3', startedAt: 5, dayKey: '2026-99-99' }],
      blocks: [{ id: 'b1' }, { id: 'b2', sessionId: 's', trackId: 'nback.plain', t: 5 }, { id: 'b2', sessionId: 's', trackId: 'nback.plain', t: 5, updatedAt: 9 }],
      events: [{ id: 'e1', t: NaN, type: 'note' }, { id: 'e2', t: 1, type: 'note' }],
      labVisits: 'oops', calibration: 3, custom: [1, 2]
    });
    t.eq(m.fatal, false);
    const r = m.records;
    t.eq(validRecords(r), []);
    t.eq(r.rev, 0);
    t.eq(r.sessions.map(s => s.id), ['7', 's3']);
    t.eq(r.sessions[0].dayKey, U.dayKey(1762430000000));
    t.eq(r.sessions[1].dayKey, U.dayKey(5));
    t.eq(r.blocks.length, 1);
    t.eq(r.blocks[0].updatedAt, 9, 'duplicate merged to the newer copy');
    t.eq(r.events.map(e => e.id), ['e2']);
    t.eq(r.labVisits, []);
    t.eq(r.calibration, null);
    t.eq(r.settings.volume, 0.8);
    t.eq(r.settings.keys.match, 'KeyJ');
    t.eq(r.settings.keys.match2, 'KeyL');
    t.eq(r.settings.keys.pause, ['Escape', 'KeyP']);
    t.eq(r.settings.balance, { nback: 100, relations: 50, span: 0, extra: 1 });
    t.eq(r.settings.theme, 'dark');
    t.eq(r.settings.sessionMinutes, 120);
    t.eq(r.settings.reducedMotion, true);
    t.eq(r.settings.perResponseFeedback, null);
    t.eq(r.settings.futureSetting, { a: 1 }, 'unknown settings kept');
    t.eq(r.custom, [1, 2], 'unknown top-level keys kept');
    t.ok(m.errors.length >= 10, m.errors.length + ' errors');
    t.ok(m.errors.some(e => /blocks\[0\].*trackId|blocks\[0\].*sessionId/.test(e)));
  });

  await t.test('schema guard fuzz: 2,000 damaged copies never throw and always come out valid and stable', () => {
    const rr = HF.rng.create('fuzz');
    for (let i = 0; i < 2000; i++) {
      const base = randomRecords(rr);
      const bad = damage(rr, JSON.parse(JSON.stringify(base)));
      let m;
      try { m = S.migrate(bad); } catch (e) { throw new Error('threw on case ' + i + ': ' + e.message); }
      const errs = validRecords(m.records);
      if (errs.length) throw new Error('case ' + i + ': ' + errs.join(', '));
      const again = S.migrate(m.records);
      if (again.errors.length) throw new Error('case ' + i + ' not stable: ' + again.errors[0]);
    }
  });

  await t.test('merge: union by id, never drops, LWW by updatedAt, counts', () => {
    const a = S.defaultRecords(1000, 'u-a'), b = S.defaultRecords(2000, 'u-b');
    a.rev = 4; b.rev = 9;
    a.sessions.push({ id: 's1', startedAt: 10, dayKey: '2026-11-01', endedAt: null, completed: 2 }, { id: 's2', startedAt: 20, dayKey: '2026-11-01', endedAt: null, completed: 1 });
    b.sessions.push({ id: 's2', startedAt: 20, dayKey: '2026-11-01', endedAt: 99, completed: 6 }, { id: 's3', startedAt: 30, dayKey: '2026-11-02', endedAt: 5, completed: 6 });
    a.settings.updatedAt = 50; a.settings.volume = 0.3;
    b.settings.updatedAt = 40; b.settings.volume = 0.6;
    b.profile.updatedAt = 7; b.profile.firstRunDone = true;
    const info = {};
    const m = S.merge(a, b, { info });
    t.eq(m.sessions.map(s => s.id), ['s1', 's2', 's3']);
    t.eq(m.sessions[1].endedAt, 99, 'ended copy wins');
    t.eq(m.settings.volume, 0.3);
    t.eq(m.profile.firstRunDone, true);
    t.eq(m.profile.anonId, 'u-b');
    t.eq([m.rev, m.createdAt, m.updatedAt], [9, 1000, 2000]);
    t.eq([info.aOnly, info.bOnly, info.aNewer, info.bNewer, info.lwwA, info.lwwB], [1, 1, 0, 1, 1, 1]);
    t.ok(a.sessions.length === 2 && b.sessions.length === 2, 'inputs untouched');
  });

  await t.test('merge is commutative, associative and idempotent; keeps every id (300 random triples)', () => {
    const rr = HF.rng.create('merge-props');
    for (let i = 0; i < 300; i++) {
      const a = randomRecords(rr), b = randomRecords(rr), c = randomRecords(rr);
      const ab = S.merge(a, b), ba = S.merge(b, a);
      t.eq(U.stableStringify(ab), U.stableStringify(ba), 'commutative #' + i);
      t.eq(U.stableStringify(S.merge(ab, c)), U.stableStringify(S.merge(a, S.merge(b, c))), 'associative #' + i);
      t.eq(U.stableStringify(S.merge(ab, ab)), U.stableStringify(ab), 'idempotent #' + i);
      t.eq(U.stableStringify(S.merge(ab, a)), U.stableStringify(ab), 'absorbs #' + i);
      for (const name of ARR) {
        const ids = new Set([...a[name], ...b[name]].map(x => x.id));
        t.eq(ab[name].map(x => x.id).sort(), [...ids].sort(), name + ' ids #' + i);
      }
      t.eq(validRecords(ab), []);
    }
  });

  await t.test('pickNewer order: updatedAt, then endedAt, then completed, then more fields', () => {
    const P = S.pickNewer;
    t.eq(P({ id: 1, updatedAt: 5 }, { id: 1, updatedAt: 9 }).updatedAt, 9);
    t.eq(P({ id: 1, updatedAt: 5, endedAt: 1 }, { id: 1, endedAt: 99 }).updatedAt, 5);
    t.eq(P({ id: 1, endedAt: null }, { id: 1, endedAt: 3 }).endedAt, 3);
    t.eq(P({ id: 1, completed: 2 }, { id: 1, completed: 5 }).completed, 5);
    t.eq(Object.keys(P({ id: 1 }, { id: 1, x: 2 })).length, 2);
    const x = { id: 1, a: 'p' }, y = { id: 1, a: 'q' };
    t.ok(P(x, y) === P(y, x), 'symmetric tie-break');
  });

  await t.test('reset: a newer reset drops older records of a stale copy; imports can ignore it', () => {
    const stale = S.defaultRecords(100, 'u-old');
    stale.settings.updatedAt = 500; stale.settings.volume = 0.1;
    stale.events.push({ id: 'old', t: 500, type: 'note' }, { id: 'new', t: 5000, type: 'note' });
    const fresh = S.defaultRecords(1000, 'u-new');
    fresh.resetAt = 1000;
    const info = {};
    const m = S.merge(fresh, stale, { info });
    t.eq(m.events.map(e => e.id), ['new']);
    t.eq(m.settings.volume, 0.8, 'stale settings dropped');
    t.eq(m.profile.anonId, 'u-new');
    t.eq(m.resetAt, 1000);
    t.eq(info.dropped, 1);
    t.eq(U.stableStringify(S.merge(stale, fresh)), U.stableStringify(m), 'symmetric');
    const imp = S.merge(fresh, stale, { ignoreReset: true });
    t.eq(imp.events.map(e => e.id), ['old', 'new']);
    t.eq(imp.resetAt, 1000);
  });

  await t.test('migrate flags data from a newer Long-Horizon (never to be overwritten)', () => {
    const m = S.migrate({ schema: 7, sessions: [] });
    t.ok(m.fatal && m.newer === true && m.schemaFound === 7);
    t.ok(!S.migrate('{garbage').newer && !S.migrate({ schema: 'x' }).newer, 'other fatal cases are not "newer"');
  });

  await t.test('calibration removal tombstone survives the guard and wins merges against older data (CB-07)', () => {
    const tomb = { updatedAt: 500, removed: true, tests: {} };
    const calOld = { updatedAt: 100, version: 1, source: 'file', tests: { 'lab.matrix': { r: 0.8, sd: 3, mean: 10, n: 60 } } };
    const calNew = Object.assign({}, calOld, { updatedAt: 900 });
    const withCal = c => S.migrate(Object.assign(S.defaultRecords(1, 'u'), { calibration: c })).records;
    t.eq(withCal({ updatedAt: 500, removed: 1, tests: { x: 1 } }).calibration, tomb, 'normalised');
    t.eq(withCal(tomb).calibration, tomb, 'kept as is');
    t.eq(S.merge(withCal(tomb), withCal(calOld)).calibration, tomb, 'tombstone beats an older calibration');
    t.eq(S.merge(withCal(calOld), withCal(tomb)).calibration, tomb, 'in either order');
    t.eq(S.merge(withCal(tomb), withCal(null)).calibration, tomb, 'tombstone beats null');
    t.eq(S.merge(withCal(null), withCal(tomb)).calibration, tomb);
    t.eq(S.merge(withCal(tomb), withCal(calNew)).calibration, calNew, 'a newer calibration replaces the tombstone');
    t.eq(S.readBackup(JSON.stringify(withCal(tomb))).records.calibration, tomb, 'survives a backup round trip');
  });

  await t.test('backups: round trip, bare records, friendly errors', () => {
    const rr = HF.rng.create('bk');
    const rec = randomRecords(rr);
    const trials = { s1: { sessionId: 's1', kind: 'training', updatedAt: 5, blocks: { b1: S.encodeTrialLog(streamLog(rr)) } } };
    const text = JSON.stringify(S.makeBackup(rec, trials, 123));
    const back = S.readBackup(text);
    t.ok(back.ok, back.error);
    t.ok(U.deepEqual(back.records, rec));
    t.ok(U.deepEqual(back.trials, trials));
    t.ok(S.readBackup(JSON.stringify(rec)).ok, 'bare records');
    t.ok(S.readBackup('﻿' + text).ok, 'BOM');
    t.eq([JSON.parse(text).format, JSON.parse(text).app], ['long-horizon-backup', 'Long-Horizon'], 'written with the Long-Horizon format id');
    for (const [bad, re] of [['', /empty/], ['{', /not valid JSON/], ['[]', /not a Long-Horizon/], ['{"a":1}', /not a Long-Horizon/],
      ['{"format":"long-horizon-backup","formatVersion":2}', /newer/], ['{"format":"holdfast-backup","formatVersion":2}', /newer/],
      ['{"format":"other-backup","formatVersion":1,"records":{}}', /not a Long-Horizon/], [JSON.stringify({ schema: 9, sessions: [] }), /newer version/]]) {
      const res = S.readBackup(bad);
      t.ok(!res.ok && re.test(res.error), bad + ' → ' + res.error);
    }
    const mixed = S.readBackup({ format: 'long-horizon-backup', formatVersion: 1, records: rec, trials: { ok: { blocks: {} }, bad: 3, alsoBad: { blocks: 2 } } });
    t.ok(mixed.ok);
    t.eq(Object.keys(mixed.trials), ['ok']);
    t.eq(mixed.trials.ok.sessionId, 'ok');
    t.ok(mixed.errors.some(e => /trials\.bad/.test(e)));
  });

  await t.test('backups made by 1.0.0 under the working name (format "holdfast-backup") still import', () => {
    const rr = HF.rng.create('bk-legacy');
    const rec = randomRecords(rr);
    const trials = { s1: { sessionId: 's1', kind: 'training', updatedAt: 5, blocks: { b1: S.encodeTrialLog(streamLog(rr)) } } };
    const old = { format: 'holdfast-backup', formatVersion: 1, app: 'Holdfast', appVersion: '1.0.0', exportedAt: 123, records: rec, trials };
    t.eq(S.BACKUP_FORMAT, 'long-horizon-backup');
    t.eq(S.BACKUP_FORMATS, ['long-horizon-backup', 'holdfast-backup']);
    const back = S.readBackup(JSON.stringify(old));
    t.ok(back.ok, back.error);
    t.ok(U.deepEqual(back.records, rec), 'records come back');
    t.ok(U.deepEqual(back.trials, trials), 'trial logs come back');
    t.ok(S.readBackup(old).ok, 'as an object too');
  });

  await t.test('trial docs merge by block id', () => {
    const a = { sessionId: 's', kind: 'training', updatedAt: 1, blocks: { b1: { v: 1, x: 1 }, b2: { v: 1, x: 2 } } };
    const b = { sessionId: 's', kind: 'lab', updatedAt: 5, blocks: { b2: { v: 1, x: 9 }, b3: { v: 1, x: 3 } } };
    const m = S.mergeTrialDocs(a, b);
    t.eq(Object.keys(m.blocks).sort(), ['b1', 'b2', 'b3']);
    t.eq(m.blocks.b2.x, 2, 'local copy wins');
    t.eq([m.kind, m.updatedAt], ['lab', 5]);
    t.eq(S.guardTrialDoc(null), null);
    t.eq(S.guardTrialDoc({ blocks: {} }, 'sid').sessionId, 'sid');
  });

  await t.test('trial-log codec: stream and discrete logs round-trip within 0.1 ms and shrink', () => {
    const rr = HF.rng.create('codec');
    let raw = 0, enc = 0;
    for (let i = 0; i < 200; i++) {
      const log = streamLog(rr, rr.int(21, 30));
      const e = S.encodeTrialLog(log);
      approxEqual(S.decodeTrialLog(JSON.parse(JSON.stringify(e))), log, 0.0501);
      raw += JSON.stringify(log).length; enc += JSON.stringify(e).length;
      const d = discreteLog(rr);
      approxEqual(S.decodeTrialLog(JSON.parse(JSON.stringify(S.encodeTrialLog(d)))), d, 0.0501);
    }
    t.ok(enc / raw < 0.75, 'ratio ' + (enc / raw).toFixed(2));
    t.ok(enc / 200 < 1200, 'bytes per stream block ' + Math.round(enc / 200));
  });

  await t.test('trial-log codec keeps anything it does not know exactly', () => {
    const span = { trials: [{ i: 0, proc: [{ resp: true, rt: 1234.5 }, { resp: null, rt: null }], recall: ['F', 'K'], voided: false }], paused: false };
    t.eq(S.decodeTrialLog(JSON.parse(JSON.stringify(S.encodeTrialLog(span)))), span);
    for (const v of [42, 'x', null, [1, 2], { onsets: 'nope' }, { responses: [{ trial: 1, key: 'match', rt: 5, src: 'key', t: 5, extra: 1 }] }]) {
      t.eq(S.decodeTrialLog(JSON.parse(JSON.stringify(S.encodeTrialLog(v)))), v);
    }
    const odd = { onsets: [0, 3000], responses: [{ trial: 0, key: 'weird', rt: 1, src: 'gamepad', t: 1 }], shown: [16.7, null] };
    approxEqual(S.decodeTrialLog(S.encodeTrialLog(odd)), odd, 0.0501);
    const plain = { kind: 'stream', responses: [] };
    t.ok(S.decodeTrialLog(plain) === plain, 'plain (unencoded) logs pass through');
    t.ok(/unknown trial-log version/.test(S.decodeTrialLog({ v: 2 }).error));
  });
}
