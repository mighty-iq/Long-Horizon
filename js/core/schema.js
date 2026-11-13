/* Long-Horizon — persisted data: defaults, schema guard + migrations, merge, backups, compact trial logs (pure).
 * MIT licence. Needs HF.util (js/core/util.js) loaded first.
 *
 * calibration may be a removal tombstone { updatedAt, removed: true, tests: {} } (CB-07): readers treat it as
 * "no calibration"; unlike null it wins last-writer-wins merges against older calibrations, so a removal
 * survives other tabs and older backups.
 *
 * Records (SPEC §3), schema 1:
 *   { schema: 1, appVersion, rev, createdAt, updatedAt, resetAt,
 *     profile, settings, calibration|null, backups,            ← last-writer-wins objects (by .updatedAt)
 *     sessions[], blocks[], labVisits[], events[] }            ← append-only, union by id
 *   DEVIATION (small, additive): `resetAt` (ms, 0 = never reset). merge() drops, from a side whose resetAt is older,
 *   the records dated before the newer reset, so a Reset in one tab is not undone by another tab's next save.
 *   Imports pass { ignoreReset: true } so restoring a backup after a Reset still works.
 *   Unknown top-level keys and unknown fields inside records are kept as they are (forward compatible).
 *
 * Exports HF.schema:
 *   SCHEMA (=1), SETTINGS_DEFAULTS, ARRAYS ({ name: { time, req } }), LWW (names)
 *   defaultSettings() → fresh copy of SPEC §3.1 defaults (+ updatedAt: 0)
 *   defaultRecords(now?, anonId?) → fresh records (LWW objects carry updatedAt 0, so any real change wins a merge)
 *   migrate(input, { now }?) → { records, migratedFrom: null|<old schema>, errors: [string], fatal: bool,
 *        newer?: true, schemaFound? }  (newer = data written by a newer Long-Horizon: never write over it)
 *        input: records object or JSON text. Never throws, never mutates input (valid items are shared by reference).
 *        Schema guard: wrong types → defaults; list items without an id or required fields are dropped (listed in
 *        errors); duplicate ids are merged; sessions get a dayKey from startedAt if missing; settings are typed
 *        against the defaults (known numeric settings clamped). fatal = unusable input (not an object, invalid or
 *        newer schema); records is then a fresh default set and the caller must not overwrite the stored copy.
 *        Required fields: sessions {id, startedAt}, blocks {id, sessionId, trackId, t}, labVisits {id, kind,
 *        startedAt}, events {id, type, t} (times: finite ms inside the Date range).
 *   merge(a, b, { ignoreReset, info }?) → merged records (new object; a and b untouched). Arrays: union by id; for
 *        the same id with different content pickNewer() decides (updatedAt, then endedAt, then completed, then more
 *        fields, then a canonical-text comparison) — symmetric, so merge(a,b) and merge(b,a) have equal content.
 *        LWW objects: larger updatedAt wins (ties: canonical text). rev = max, createdAt = min, updatedAt = max.
 *        Arrays come out sorted by (time, id). opts.info (object) receives counts:
 *        { aOnly, bOnly, aNewer, bNewer, same, lwwA, lwwB, dropped } — aOnly/aNewer/lwwA > 0 means a holds data
 *        b lacks; bOnly/bNewer/lwwB > 0 means b brought something new.
 *   pickNewer(x, y) → x or y (see merge)
 *   makeBackup(records, trialDocs, now?) → { format: 'long-horizon-backup' (BACKUP_FORMAT), formatVersion: 1, app,
 *        appVersion, exportedAt, records, trials: { [sessionId]: TrialDoc } }
 *   readBackup(textOrObject) → { ok, error, records, trials, migratedFrom, errors }  (also accepts bare records, and
 *        the 1.0.0 format id 'holdfast-backup' from the working name Holdfast: BACKUP_FORMATS)
 *   Trial docs (one storage key per session): TrialDoc = { sessionId, kind: 'training'|'lab', updatedAt,
 *        blocks: { [blockId]: EncodedTrialLog } }
 *   guardTrialDoc(doc, sessionId?) → TrialDoc | null;  mergeTrialDocs(a, b) → TrialDoc (union of blocks, a wins ties)
 *   encodeTrialLog(log) → EncodedTrialLog;  decodeTrialLog(enc) → log
 *        Lossless except timing values, which are rounded to 0.1 ms. Bulky parts are compacted:
 *          onsets  → 'o'  delta-coded integers in 0.1 ms
 *          shown, offsets → 'sh', 'of' integers in 0.1 ms relative to the onset of the same trial (null if missing)
 *          responses (stream log rows {trial, key, rt, src, t}) → 'r' rows [trial, key, rt, src, t]
 *          answers (discrete log rows {i, response, rt, voided, src}) → 'a' rows [i, response, rt, voided, src]
 *          (key/response/src stored as small integers when they are known names, else as text)
 *        Every other field is kept as is under 'x'. A value that is not a log object is stored as { v: 1, x: value }.
 *        decodeTrialLog of a value without v (an old, plain log) returns it unchanged.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var U = HF.util;
  if (!U) throw new Error('schema.js needs js/core/util.js loaded first');

  var SCHEMA = 1;

  var SETTINGS_DEFAULTS = {
    mode: 'varied', sessionMinutes: 25, weeklyTarget: 4, balance: { nback: 50, relations: 50, span: 0 }, spanOn: false,
    sound: 'tones', volume: 0.8, audioOffsetMs: 0,
    keys: { match: 'KeyJ', match2: 'KeyK', no: 'KeyF', pause: ['Escape', 'KeyP'], next: 'Space' },
    perResponseFeedback: null, focusMode: false, theme: 'system', largeText: false,
    leftHanded: false, reducedMotion: null, protocols: { cao: true, wang: true, jaeggi: false },
    includeLevelsInShare: false, labConfig: 'standard', dual: false, freePace: 'std'
  };
  // settings whose default is null but which hold a boolean once chosen
  var NULLABLE_BOOL = { perResponseFeedback: 1, reducedMotion: 1 };
  // numeric settings: [lo, hi]
  var NUM_RANGE = { sessionMinutes: [5, 120], weeklyTarget: [1, 7], volume: [0, 1], audioOffsetMs: [-500, 500] };

  // required fields per list: 'time' = a finite ms value inside the Date range (|t| ≤ 8.64e15)
  var ARRAYS = {
    sessions: { time: 'startedAt', req: { startedAt: 'time' } },
    blocks: { time: 't', req: { sessionId: 'string', trackId: 'string', t: 'time' } },
    labVisits: { time: 'startedAt', req: { kind: 'string', startedAt: 'time' } },
    events: { time: 't', req: { type: 'string', t: 'time' } }
  };
  var ARRAY_NAMES = ['sessions', 'blocks', 'labVisits', 'events'];
  var LWW = ['profile', 'settings', 'calibration', 'backups'];
  var TOP = ['schema', 'appVersion', 'rev', 'createdAt', 'updatedAt', 'resetAt'].concat(LWW, ARRAY_NAMES);

  // schema n → n + 1. Schema 1 is the first; add steps here when the format changes.
  var MIGRATIONS = {};

  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function isTime(x) { return fin(x) && Math.abs(x) <= 8.64e15; }
  function shallow(o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; }

  function defaultSettings() {
    var s = U.clone(SETTINGS_DEFAULTS);
    s.updatedAt = 0;
    return s;
  }

  function defaultRecords(now, anonId) {
    now = fin(now) ? now : Date.now();
    return {
      schema: SCHEMA, appVersion: HF.VERSION || '1.0.0', rev: 0, createdAt: now, updatedAt: now, resetAt: 0,
      profile: { updatedAt: 0, anonId: anonId || U.id('u'), firstRunDone: false, path: null, startedAt: null },
      settings: defaultSettings(),
      calibration: null,
      backups: { updatedAt: 0, lastExportAt: null },
      sessions: [], blocks: [], labVisits: [], events: []
    };
  }

  // ---------------------------------------------------------------- guard
  function looksLikeRecords(r) {
    if (!U.isPlainObject(r)) return false;
    for (var i = 0; i < ARRAY_NAMES.length; i++) if (Array.isArray(r[ARRAY_NAMES[i]])) return true;
    return U.isPlainObject(r.settings) || U.isPlainObject(r.profile);
  }

  function guardSettings(s, err) {
    var out = defaultSettings();
    if (s === undefined) return out;
    if (!U.isPlainObject(s)) { err('settings: not an object; defaults used'); return out; }
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      var v = s[k];
      if (k === 'updatedAt') { out.updatedAt = fin(v) ? v : 0; continue; }
      if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, k)) {
        if (v !== undefined && typeof v !== 'function') out[k] = v; // unknown setting: keep
        continue;
      }
      var d = SETTINGS_DEFAULTS[k];
      if (k === 'keys') { out.keys = guardKeys(v, err); continue; }
      if (NULLABLE_BOOL[k]) {
        if (v === null || typeof v === 'boolean') out[k] = v; else err('settings.' + k + ': invalid; default used');
        continue;
      }
      if (U.isPlainObject(d)) {
        if (!U.isPlainObject(v)) { err('settings.' + k + ': not an object; default used'); continue; }
        for (var kk in v) {
          if (!Object.prototype.hasOwnProperty.call(v, kk)) continue;
          var dv = d[kk];
          if (dv === undefined) { out[k][kk] = v[kk]; continue; }
          if (typeof v[kk] === typeof dv && (typeof dv !== 'number' || fin(v[kk]))) {
            out[k][kk] = k === 'balance' ? U.clamp(v[kk], 0, 100) : v[kk];
          } else err('settings.' + k + '.' + kk + ': invalid; default used');
        }
        continue;
      }
      if (typeof v !== typeof d || (typeof d === 'number' && !fin(v))) { err('settings.' + k + ': invalid; default used'); continue; }
      if (NUM_RANGE[k]) v = U.clamp(v, NUM_RANGE[k][0], NUM_RANGE[k][1]);
      out[k] = v;
    }
    return out;
  }

  var CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,30}$/;
  function guardKeys(v, err) {
    var out = U.clone(SETTINGS_DEFAULTS.keys);
    if (!U.isPlainObject(v)) { err('settings.keys: not an object; defaults used'); return out; }
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var x = v[k];
      var ok = (typeof x === 'string' && CODE_RE.test(x)) ||
        (Array.isArray(x) && x.length > 0 && x.every(function (c) { return typeof c === 'string' && CODE_RE.test(c); }));
      if (ok) out[k] = Array.isArray(x) ? x.slice() : x;
      else err('settings.keys.' + k + ': invalid; default used');
    }
    return out;
  }

  function guardProfile(p, err) {
    var out = { updatedAt: 0, anonId: null, firstRunDone: false, path: null, startedAt: null };
    if (p !== undefined && !U.isPlainObject(p)) err('profile: not an object; defaults used');
    if (U.isPlainObject(p)) {
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && !(k in out) && p[k] !== undefined) out[k] = p[k];
      out.updatedAt = fin(p.updatedAt) ? p.updatedAt : 0;
      out.anonId = typeof p.anonId === 'string' && p.anonId ? p.anonId : null;
      out.firstRunDone = typeof p.firstRunDone === 'boolean' ? p.firstRunDone : !!p.firstRunDone;
      out.path = p.path === 'train' || p.path === 'measure' ? p.path : null;
      out.startedAt = fin(p.startedAt) ? p.startedAt : null;
    }
    if (!out.anonId) out.anonId = U.id('u');
    return out;
  }

  function guardBackups(b, err) {
    var out = { updatedAt: 0, lastExportAt: null };
    if (b !== undefined && !U.isPlainObject(b)) err('backups: not an object; defaults used');
    if (U.isPlainObject(b)) {
      for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !(k in out) && b[k] !== undefined) out[k] = b[k];
      out.updatedAt = fin(b.updatedAt) ? b.updatedAt : 0;
      out.lastExportAt = fin(b.lastExportAt) ? b.lastExportAt : null;
    }
    return out;
  }

  function guardCalibration(c, err) {
    if (c === null || c === undefined) return null;
    if (!U.isPlainObject(c)) { err('calibration: not an object; dropped'); return null; }
    var out = shallow(c);
    out.updatedAt = fin(c.updatedAt) ? c.updatedAt : 0;
    if (!U.isPlainObject(c.tests)) out.tests = {};
    // removal tombstone (CB-07): kept as an object so last-writer-wins merges keep the removal
    if (c.removed) { out.removed = true; out.tests = {}; }
    return out;
  }

  function guardArray(name, arr, err) {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr)) { err(name + ': not a list; emptied'); return []; }
    var spec = ARRAYS[name], out = [], index = Object.create(null);
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (!U.isPlainObject(x)) { err(name + '[' + i + ']: not an object; dropped'); continue; }
      var idv = x.id;
      if (fin(idv)) idv = String(idv);
      if (typeof idv !== 'string' || !idv) { err(name + '[' + i + ']: no id; dropped'); continue; }
      var bad = null;
      for (var f in spec.req) {
        var v = x[f];
        if (spec.req[f] === 'time' ? !isTime(v) : (typeof v !== 'string' || !v)) { bad = f; break; }
      }
      if (bad) { err(name + '[' + i + '] (' + idv + '): missing or invalid ' + bad + '; dropped'); continue; }
      var item = x;
      if (idv !== x.id) { item = shallow(x); item.id = idv; }
      if (name === 'sessions' && !U.isDayKey(item.dayKey)) {
        if (item === x) item = shallow(x);
        item.dayKey = U.dayKey(item.startedAt);
      }
      if (index[idv] !== undefined) {
        out[index[idv]] = pickNewer(out[index[idv]], item);
        err(name + ': duplicate id ' + idv + '; merged');
        continue;
      }
      index[idv] = out.length;
      out.push(item);
    }
    return out;
  }

  function guard(r, err, now) {
    var out = {};
    out.schema = SCHEMA;
    out.appVersion = typeof r.appVersion === 'string' && r.appVersion ? r.appVersion : (HF.VERSION || '1.0.0');
    if (fin(r.rev) && r.rev >= 0) out.rev = Math.floor(r.rev);
    else { if (r.rev !== undefined) err('rev: invalid; set to 0'); out.rev = 0; }
    out.createdAt = fin(r.createdAt) ? r.createdAt : now;
    out.updatedAt = fin(r.updatedAt) ? r.updatedAt : out.createdAt;
    out.resetAt = fin(r.resetAt) && r.resetAt >= 0 ? r.resetAt : 0;
    out.profile = guardProfile(r.profile, err);
    out.settings = guardSettings(r.settings, err);
    out.calibration = guardCalibration(r.calibration, err);
    out.backups = guardBackups(r.backups, err);
    for (var i = 0; i < ARRAY_NAMES.length; i++) out[ARRAY_NAMES[i]] = guardArray(ARRAY_NAMES[i], r[ARRAY_NAMES[i]], err);
    for (var k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k) || TOP.indexOf(k) >= 0) continue;
      if (r[k] !== undefined && typeof r[k] !== 'function') out[k] = r[k];
    }
    return out;
  }

  function migrate(input, opts) {
    opts = opts || {};
    var now = fin(opts.now) ? opts.now : Date.now();
    var errors = [];
    function err(msg) {
      if (errors.length < 100) errors.push(msg);
      else if (errors.length === 100) errors.push('… more problems not listed');
    }
    function fatal(msg) { return { records: defaultRecords(now), migratedFrom: null, errors: [msg], fatal: true }; }
    var r = input;
    if (typeof r === 'string') {
      try { r = JSON.parse(r); } catch (e) { return fatal('not valid JSON'); }
    }
    if (!U.isPlainObject(r)) return fatal('not a Long-Horizon records object');
    var from = r.schema;
    if (from === undefined || from === null) {
      if (!looksLikeRecords(r)) return fatal('not Long-Horizon records (no schema field)');
      err('schema missing; read as schema ' + SCHEMA);
      from = SCHEMA;
    }
    if (!fin(from) || from < 0 || Math.floor(from) !== from) return fatal('invalid schema value');
    if (from > SCHEMA) {
      var nf = fatal('made by a newer version of Long-Horizon (data schema ' + from + '); update the app first');
      nf.newer = true;            // the caller must never write over it (store: memory mode, reason 'newer')
      nf.schemaFound = from;
      return nf;
    }
    var migratedFrom = null;
    while (from < SCHEMA) {
      var step = MIGRATIONS[from];
      if (!step) return fatal('no migration from schema ' + from);
      try { r = step(U.clone(r), err); } catch (e) { return fatal('migration from schema ' + from + ' failed'); }
      if (migratedFrom === null) migratedFrom = input && input.schema !== undefined ? input.schema : from;
      from++;
    }
    return { records: guard(r, err, now), migratedFrom: migratedFrom, errors: errors, fatal: false };
  }

  // ---------------------------------------------------------------- merge
  function pickNewer(x, y) {
    if (x === y) return x;
    var ux = fin(x.updatedAt), uy = fin(y.updatedAt);
    if (ux && uy && x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
    if (ux !== uy) return ux ? x : y;
    var hx = fin(x.endedAt), hy = fin(y.endedAt);
    if (hx !== hy) return hx ? x : y;
    if (hx && hy && x.endedAt !== y.endedAt) return x.endedAt > y.endedAt ? x : y;
    var cx = fin(x.completed) ? x.completed : -1, cy = fin(y.completed) ? y.completed : -1;
    if (cx !== cy) return cx > cy ? x : y;
    var kx = Object.keys(x).length, ky = Object.keys(y).length;
    if (kx !== ky) return kx > ky ? x : y;
    var sx = U.stableStringify(x), sy = U.stableStringify(y);
    if (sx === sy) return x;
    return sx > sy ? x : y;
  }

  function lwwPick(va, vb) {
    if (va === vb) return va;
    if (va === null || va === undefined) return vb === undefined ? null : vb;
    if (vb === null || vb === undefined) return va;
    var ua = fin(va.updatedAt) ? va.updatedAt : 0, ub = fin(vb.updatedAt) ? vb.updatedAt : 0;
    if (ua !== ub) return ua > ub ? va : vb;
    var sa = U.stableStringify(va), sb = U.stableStringify(vb);
    if (sa === sb) return va;
    return sa > sb ? va : vb;
  }

  function timeOf(name, x) { var t = x[ARRAYS[name].time]; return fin(t) ? t : 0; }

  function merge(a, b, opts) {
    opts = opts || {};
    var info = opts.info || {};
    info.aOnly = 0; info.bOnly = 0; info.aNewer = 0; info.bNewer = 0; info.same = 0; info.lwwA = 0; info.lwwB = 0; info.dropped = 0;
    if (!a) a = b;
    if (!b) b = a;
    var ra = fin(a.resetAt) ? a.resetAt : 0, rb = fin(b.resetAt) ? b.resetAt : 0;
    var R = opts.ignoreReset ? ra : Math.max(ra, rb);
    var aStale = !opts.ignoreReset && ra < R, bStale = !opts.ignoreReset && rb < R;
    var out = {
      schema: SCHEMA,
      appVersion: U.semverCompare(a.appVersion, b.appVersion) >= 0 ? a.appVersion : b.appVersion,
      rev: Math.max(fin(a.rev) ? a.rev : 0, fin(b.rev) ? b.rev : 0),
      createdAt: Math.min(fin(a.createdAt) ? a.createdAt : Infinity, fin(b.createdAt) ? b.createdAt : Infinity),
      updatedAt: Math.max(fin(a.updatedAt) ? a.updatedAt : 0, fin(b.updatedAt) ? b.updatedAt : 0),
      resetAt: R
    };
    if (!fin(out.createdAt)) out.createdAt = out.updatedAt;
    var i, k;
    for (i = 0; i < LWW.length; i++) {
      k = LWW[i];
      var va = a[k], vb = b[k];
      if (aStale && va && !(fin(va.updatedAt) && va.updatedAt >= R)) va = undefined;
      if (bStale && vb && !(fin(vb.updatedAt) && vb.updatedAt >= R)) vb = undefined;
      var pick = lwwPick(va, vb);
      if (pick === undefined || (pick === null && k !== 'calibration')) {
        pick = k === 'calibration' ? null : (k === 'settings' ? defaultSettings() : (a[k] || b[k]));
      }
      out[k] = pick;
      if (va !== vb && !U.deepEqual(va === undefined ? null : va, vb === undefined ? null : vb)) {
        if (pick === va) info.lwwA++; else if (pick === vb) info.lwwB++;
      }
    }
    for (i = 0; i < ARRAY_NAMES.length; i++) {
      var name = ARRAY_NAMES[i];
      var map = Object.create(null), order = [];
      var la = Array.isArray(a[name]) ? a[name] : [], lb = Array.isArray(b[name]) ? b[name] : [];
      var x, j;
      for (j = 0; j < la.length; j++) {
        x = la[j];
        if (!x || x.id === undefined) continue;
        if (aStale && timeOf(name, x) < R) { info.dropped++; continue; }
        if (map[x.id] === undefined) { map[x.id] = { v: x, inA: true, inB: false }; order.push(x.id); }
        else map[x.id].v = pickNewer(map[x.id].v, x);
      }
      for (j = 0; j < lb.length; j++) {
        x = lb[j];
        if (!x || x.id === undefined) continue;
        if (bStale && timeOf(name, x) < R) { info.dropped++; continue; }
        var m = map[x.id];
        if (m === undefined) { map[x.id] = { v: x, inA: false, inB: true }; order.push(x.id); info.bOnly++; continue; }
        if (m.inB) { m.v = pickNewer(m.v, x); continue; }
        m.inB = true;
        if (m.v === x || U.deepEqual(m.v, x)) { info.same++; continue; }
        var p = pickNewer(m.v, x);
        if (p === x) { info.bNewer++; m.v = x; } else info.aNewer++;
      }
      var list = [];
      for (j = 0; j < order.length; j++) {
        var e = map[order[j]];
        if (e.inA && !e.inB) info.aOnly++;
        list.push(e.v);
      }
      list.sort(function (p1, p2) {
        var t1 = timeOf(name, p1), t2 = timeOf(name, p2);
        if (t1 !== t2) return t1 - t2;
        var s1 = String(p1.id), s2 = String(p2.id);
        return s1 < s2 ? -1 : (s1 > s2 ? 1 : 0);
      });
      out[name] = list;
    }
    var extra = Object.create(null);
    for (k in a) if (TOP.indexOf(k) < 0 && Object.prototype.hasOwnProperty.call(a, k)) extra[k] = 1;
    for (k in b) if (TOP.indexOf(k) < 0 && Object.prototype.hasOwnProperty.call(b, k)) extra[k] = 1;
    for (k in extra) {
      if (!(k in b)) out[k] = a[k];
      else if (!(k in a)) out[k] = b[k];
      else {
        var s1x = U.stableStringify(a[k]), s2x = U.stableStringify(b[k]);
        out[k] = s1x >= s2x ? a[k] : b[k];
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- backups
  // BACKUP_FORMAT is written; readBackup also accepts the 1.0.0 id from the working name Holdfast (same layout).
  var BACKUP_FORMAT = 'long-horizon-backup', BACKUP_FORMATS = [BACKUP_FORMAT, 'holdfast-backup'];
  function makeBackup(records, trialDocs, now) {
    return {
      format: BACKUP_FORMAT, formatVersion: 1, app: 'Long-Horizon', appVersion: HF.VERSION || '1.0.0',
      exportedAt: fin(now) ? now : Date.now(),
      records: records,
      trials: trialDocs || {}
    };
  }

  function readBackup(input) {
    var obj = input;
    if (typeof obj === 'string') {
      var text = obj.replace(/^﻿/, '').trim();
      if (!text) return { ok: false, error: 'The backup text is empty.' };
      try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'This is not a Long-Horizon backup (the text is not valid JSON).' }; }
    }
    if (!U.isPlainObject(obj)) return { ok: false, error: 'This is not a Long-Horizon backup.' };
    var recs, trials = {};
    if (BACKUP_FORMATS.indexOf(obj.format) >= 0) {
      if (fin(obj.formatVersion) && obj.formatVersion > 1) return { ok: false, error: 'This backup was made by a newer version of Long-Horizon. Update the app first.' };
      recs = obj.records;
      if (U.isPlainObject(obj.trials)) trials = obj.trials;
    } else if (obj.schema !== undefined || looksLikeRecords(obj)) {
      recs = obj;
    } else return { ok: false, error: 'This is not a Long-Horizon backup.' };
    var m = migrate(recs);
    if (m.fatal) return { ok: false, error: 'This backup cannot be used: ' + m.errors[0] + '.', errors: m.errors };
    var outTrials = {};
    for (var sid in trials) {
      if (!Object.prototype.hasOwnProperty.call(trials, sid)) continue;
      var d = guardTrialDoc(trials[sid], sid);
      if (d) outTrials[d.sessionId] = d; else m.errors.push('trials.' + sid + ': invalid; skipped');
    }
    return { ok: true, error: null, records: m.records, trials: outTrials, migratedFrom: m.migratedFrom, errors: m.errors };
  }

  function guardTrialDoc(doc, sessionId) {
    if (!U.isPlainObject(doc)) return null;
    var sid = typeof doc.sessionId === 'string' && doc.sessionId ? doc.sessionId : sessionId;
    if (typeof sid !== 'string' || !sid) return null;
    if (!U.isPlainObject(doc.blocks)) return null;
    return { sessionId: sid, kind: doc.kind === 'lab' ? 'lab' : 'training', updatedAt: fin(doc.updatedAt) ? doc.updatedAt : 0, blocks: doc.blocks };
  }

  function mergeTrialDocs(a, b) {
    if (!a) return b;
    if (!b) return a;
    var blocks = {}, k;
    for (k in b.blocks) if (Object.prototype.hasOwnProperty.call(b.blocks, k)) blocks[k] = b.blocks[k];
    for (k in a.blocks) if (Object.prototype.hasOwnProperty.call(a.blocks, k)) blocks[k] = a.blocks[k];
    return {
      sessionId: a.sessionId, kind: a.kind === 'lab' || b.kind === 'lab' ? 'lab' : 'training',
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0), blocks: blocks
    };
  }

  // ---------------------------------------------------------------- trial-log codec
  var KEY_NAMES = ['match', 'match2', 'no', 'next', 'pause'];
  var SRC_NAMES = ['key', 'touch', 'mouse', 'pen', 'kbd', 'other'];
  var RESP_NAMES = [null, 'match', 'no', 'match2'];

  function isNumOrNull(x) { return x === null || fin(x); }
  function numArray(a) { if (!Array.isArray(a)) return false; for (var i = 0; i < a.length; i++) if (!isNumOrNull(a[i])) return false; return true; }
  function q10(x) { return Math.round(x * 10); }
  function r10(n) { return Math.round(n) / 10; }

  function encDelta(arr) {
    var out = new Array(arr.length), prev = 0, seen = false;
    for (var i = 0; i < arr.length; i++) {
      if (!fin(arr[i])) { out[i] = null; continue; }
      var q = q10(arr[i]);
      out[i] = seen ? q - prev : q;
      prev = q; seen = true;
    }
    return out;
  }
  function decDelta(arr) {
    var out = new Array(arr.length), prev = 0, seen = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === null || arr[i] === undefined) { out[i] = null; continue; }
      var q = seen ? prev + arr[i] : arr[i];
      out[i] = r10(q); prev = q; seen = true;
    }
    return out;
  }
  function encRel(arr, base) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) out[i] = fin(arr[i]) && fin(base[i]) ? q10(arr[i]) - q10(base[i]) : (fin(arr[i]) ? 'a' + q10(arr[i]) : null);
    return out;
  }
  function decRel(arr, baseQ) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (v === null || v === undefined) out[i] = null;
      else if (typeof v === 'string') out[i] = r10(+v.slice(1));
      else out[i] = baseQ[i] === null || baseQ[i] === undefined ? null : r10(baseQ[i] + v);
    }
    return out;
  }
  function enumEnc(v, names) {
    if (v === undefined) return null;
    var i = names.indexOf(v);
    return i >= 0 ? i : (v === null ? null : String(v));
  }
  function enumDec(v, names) {
    if (typeof v === 'number') return names[v] === undefined ? null : names[v];
    return v === undefined ? null : v;
  }
  function tnum(x) { return fin(x) ? q10(x) : null; }
  function tdec(x) { return fin(x) ? r10(x) : null; }

  var RESP_COLS = ['trial', 'key', 'rt', 'src', 't'];
  var ANS_COLS = ['i', 'response', 'rt', 'voided', 'src'];

  function rowsEncodable(rows, cols) {
    if (!Array.isArray(rows)) return false;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!U.isPlainObject(r)) return false;
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k) && cols.indexOf(k) < 0) return false;
    }
    return true;
  }

  function encodeTrialLog(log) {
    if (!U.isPlainObject(log)) return { v: 1, x: log };
    var out = { v: 1 }, x = {}, hasX = false, k;
    var onsets = numArray(log.onsets) ? log.onsets : null;
    if (onsets) out.o = encDelta(onsets);
    for (k in log) {
      if (!Object.prototype.hasOwnProperty.call(log, k)) continue;
      var v = log[k];
      if (k === 'onsets' && onsets) continue;
      if ((k === 'shown' || k === 'offsets') && onsets && numArray(v) && v.length <= onsets.length) {
        out[k === 'shown' ? 'sh' : 'of'] = encRel(v, onsets);
        continue;
      }
      if (k === 'responses' && rowsEncodable(v, RESP_COLS)) {
        out.r = v.map(function (r) { return [r.trial === undefined ? null : r.trial, enumEnc(r.key, KEY_NAMES), tnum(r.rt), enumEnc(r.src, SRC_NAMES), tnum(r.t)]; });
        continue;
      }
      if (k === 'answers' && rowsEncodable(v, ANS_COLS)) {
        out.a = v.map(function (r) { return [r.i === undefined ? null : r.i, enumEnc(r.response, RESP_NAMES), tnum(r.rt), r.voided ? 1 : 0, enumEnc(r.src, SRC_NAMES)]; });
        continue;
      }
      if (v !== undefined) { x[k] = v; hasX = true; }
    }
    if (hasX) out.x = x;
    return out;
  }

  function decodeTrialLog(enc) {
    if (!U.isPlainObject(enc) || enc.v === undefined) return enc;
    if (enc.v !== 1) return { error: 'unknown trial-log version ' + enc.v, raw: enc };
    if (!U.isPlainObject(enc.x) && enc.x !== undefined && enc.o === undefined && enc.r === undefined && enc.a === undefined) return enc.x;
    var log = {}, k;
    if (U.isPlainObject(enc.x)) for (k in enc.x) if (Object.prototype.hasOwnProperty.call(enc.x, k)) log[k] = enc.x[k];
    var baseQ = null;
    if (Array.isArray(enc.o)) {
      log.onsets = decDelta(enc.o);
      baseQ = log.onsets.map(function (t) { return t === null ? null : q10(t); });
    }
    if (Array.isArray(enc.sh)) log.shown = decRel(enc.sh, baseQ || []);
    if (Array.isArray(enc.of)) log.offsets = decRel(enc.of, baseQ || []);
    if (Array.isArray(enc.r)) {
      log.responses = enc.r.map(function (row) {
        return { trial: row[0], key: enumDec(row[1], KEY_NAMES), rt: tdec(row[2]), src: enumDec(row[3], SRC_NAMES), t: tdec(row[4]) };
      });
    }
    if (Array.isArray(enc.a)) {
      log.answers = enc.a.map(function (row) {
        return { i: row[0], response: enumDec(row[1], RESP_NAMES), rt: tdec(row[2]), voided: row[3] === 1, src: enumDec(row[4], SRC_NAMES) };
      });
    }
    return log;
  }

  var api = {
    SCHEMA: SCHEMA, SETTINGS_DEFAULTS: SETTINGS_DEFAULTS, ARRAYS: ARRAYS, ARRAY_NAMES: ARRAY_NAMES, LWW: LWW,
    defaultSettings: defaultSettings, defaultRecords: defaultRecords,
    migrate: migrate, merge: merge, pickNewer: pickNewer,
    makeBackup: makeBackup, readBackup: readBackup, BACKUP_FORMAT: BACKUP_FORMAT, BACKUP_FORMATS: BACKUP_FORMATS,
    guardTrialDoc: guardTrialDoc, mergeTrialDocs: mergeTrialDocs,
    encodeTrialLog: encodeTrialLog, decodeTrialLog: decodeTrialLog
  };
  HF.schema = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
