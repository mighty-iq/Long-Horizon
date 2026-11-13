/* Long-Horizon — event-sourced store (browser side; also loads in node with a fake localStorage for tests). MIT licence.
 * Needs HF.util and HF.schema. Uses HF.timing.busy (if loaded) to never save during a stimulus stream,
 * HF.engine.derive (if loaded) for `derived`, and HF.dom.toast / HF.dom.download (if loaded).
 *
 * Keys: <prefix>main (records) and <prefix>trials.<sessionId> (one TrialDoc per session, see schema.js);
 *       prefix = 'long-horizon.v1.' (configure({ prefix }) before load() to change it, e.g. in tests).
 *       <prefix>rescue.<ms> holds an unreadable main copy if one was ever found (never overwritten).
 * Working-name migration (13 Nov 2026): 1.0.0 was released under the working name Holdfast and kept its data under
 *       'holdfast.v1.' (cfg.legacyPrefixes). When <prefix>main is absent and a legacy main exists, load() copies every
 *       legacy key to <prefix> once (copyLegacy), then reads the copy through the normal schema guard. Legacy keys are
 *       never written or deleted; status.legacy says what was copied.
 *
 * HF.store:
 *   configure({ prefix, trialCap = 60, saveDelayMs = 400, legacyPrefixes = ['holdfast.v1.'] })   before load()
 *   load() → records          read + schema guard (migrate); memory mode when storage throws (sandbox)
 *   records                   current records (read-only for callers: change them only inside mutate)
 *   derived                   HF.engine.derive(records, Date.now()) cached until the next change (or a new day);
 *                             {} when the engine is not loaded
 *   persistent                false in memory mode (nothing survives the page; the UI should say "use Export")
 *   status                    { persistent, reason, message, lastSaveAt, saveError, quotaWarned, droppedTrialKeys,
 *                               rescueKey, loadErrors, warnings[], mainChars, nearFull, nearFullText, compactedAt,
 *                               legacy: null | { from, at, main, copied, skipped } (this load copied legacy keys) }
 *                             reason (memory mode, lasting): 'blocked' | 'write-failed' | 'quota' | 'newer'; message =
 *                             the user text for it (MESSAGES). nearFull: main ≥ nearFullChars after compaction, with
 *                             nearFullText (an Export prompt). Changes in a running page notify { source: 'status' }.
 *   mutate(fn, { silent }?)   fn(records) changes records in place or returns a replacement object; bumps rev,
 *                             updatedAt, clears the derived cache, schedules an idle save, notifies subscribers
 *   save()                    schedule an idle save (debounced; never while HF.timing.busy — re-arms until idle)
 *   flush(force?) → bool      save now (block end); if busy and not forced, schedules instead. pagehide and
 *                             hidden pages flush with force.
 *   onChange(cb) → off        cb({ source: 'local'|'remote'|'import'|'reset', rev })
 *   saveTrials(sessionId, blockId, trialLog, { kind: 'training'|'lab' }?)   encoded with HF.schema.encodeTrialLog,
 *                             written in idle time; training keys capped to the newest `trialCap` sessions
 *   loadTrials(sessionId) → { sessionId, kind, updatedAt, blocks: { [blockId]: decoded log } } | null
 *   trialSessionIds() → [sessionId]
 *   exportText({ trials = true, stamp = true }?) → backup JSON text; stamps backups.lastExportAt unless stamp: false
 *   markBackup() → ms        stamps backups.lastExportAt now (a normal mutate), e.g. after Copy/Download/"saved" (CB-01)
 *   download(text?, filename?) → bool (attempted; fails silently in sandboxed previews — show the text as well)
 *   importText(text) → { ok, error, added, updated, trials, migratedFrom, errors }  (schema guard + merge; never drops)
 *   reset() → records         wipes main + trial keys (and the legacy-prefix copies), starts fresh with resetAt = now
 *                             (other tabs drop older data)
 *
 * Two tabs: a `storage` event on main is migrated and merged (union by id, LWW objects); subscribers are told
 * when the other tab brought something new; if this tab holds records the other lacks, it saves the union.
 * Every save re-reads main first and merges if another tab wrote since (never overwrites a newer rev unmerged).
 * While HF.timing.busy, remote merges wait until the stream ends.
 * Quota: on QuotaExceededError the oldest *training* trial keys are removed first (never main, never Lab);
 * a warning is shown once. If main still does not fit: one forced HF.engine.compactRecords(), then lasting memory
 * mode with reason 'quota' (CA-05). From cfg.nearFullChars (2.5 M chars) every save first offers the records to
 * HF.engine.compactRecords(records, now, { force, targetChars }) (guarded; returns records or { records }), then
 * flags status.nearFull. Data written by a newer Long-Horizon (migrate → newer) is never written over: memory mode
 * with reason 'newer' (CA-04). An unreadable main is copied to a rescue key once (CA-07).
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var U = HF.util, S = HF.schema;
  if (!U || !S) throw new Error('store.js needs util.js and schema.js loaded first');

  // nearFullChars: early warning + engine compaction threshold for the main record (CA-05). localStorage holds about
  // 5 M characters per origin (shared by every Pages site of one GitHub account); navigator.storage.estimate()
  // reports the origin's whole quota (IndexedDB, caches), not that limit, so a fixed size is used.
  var cfg = { prefix: 'long-horizon.v1.', legacyPrefixes: ['holdfast.v1.'], trialCap: 60, saveDelayMs: 400, nearFullChars: 2500000 };
  var MESSAGES = {
    blocked: 'This page cannot save to the browser here (for example inside a preview), so progress lasts only while it stays open. Use Export to keep a copy.',
    'write-failed': 'Saving stopped working in this browser, so progress is now kept only while this page is open. Use Export to keep a copy.',
    quota: 'Browser storage for Long-Horizon is full, so new progress is kept only while this page is open. Use Export to keep a copy.',
    newer: 'A newer version of Long-Horizon saved data here, so this tab does not save. Reload this tab to use the newer version.'
  };
  var NEAR_FULL_TEXT = 'Long-Horizon\u2019s saved data is getting large for this browser. Export a backup now so nothing is lost if storage fills up.';
  var loaded = false, records = null, ls = null, persistent = false, lastRaw = null;
  var trialsMem = {}, trialsDirty = {}, trialIndex = {};
  var derivedCache = null, derivedDay = null;
  var subs = [];
  var dirty = false, savePending = false, remotePending = null, remoteTimer = null;
  var listenersOn = false, persistAsked = false, notifying = false, notifyQueue = [];
  var status = freshStatus();
  var warnedOnce = {};
  function freshStatus() {
    return {
      persistent: false, reason: null, message: null, lastSaveAt: null, saveError: null, quotaWarned: false,
      droppedTrialKeys: 0, rescueKey: null, loadErrors: [], warnings: [],
      mainChars: 0, nearFull: false, nearFullText: null, compactedAt: null, legacy: null
    };
  }
  function later(fn, ms) { var h = setTimeout(fn, ms); if (h && typeof h.unref === 'function') h.unref(); return h; }

  function mainKey() { return cfg.prefix + 'main'; }
  function trialPrefix() { return cfg.prefix + 'trials.'; }
  function trialKey(sid) { return trialPrefix() + sid; }
  function isBusy() { return !!(HF.timing && HF.timing.busy); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }

  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }

  function warn(id, text, kind) {
    if (warnedOnce[id]) return;
    warnedOnce[id] = true;
    status.warnings.push({ id: id, text: text, at: Date.now() });
    if (HF.dom && typeof HF.dom.toast === 'function') {
      try { HF.dom.toast(text, { kind: kind || 'warn', timeout: 0 }); } catch (e) { /* ignore */ }
    } else if (typeof console !== 'undefined' && console.warn) console.warn('[long-horizon] ' + text);
  }

  function runIdle(fn) {
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(fn, { timeout: 2000 });
    else later(fn, 0);
  }

  // ---------------------------------------------------------------- storage access
  function probeStorage() {
    var s;
    try {
      s = root.localStorage;
      if (!s) return null;
      s.getItem(mainKey());
    } catch (e) { return null; }
    try {
      var k = cfg.prefix + '__probe';
      s.setItem(k, '1');
      s.removeItem(k);
    } catch (e2) { if (!isQuota(e2)) return null; }
    return s;
  }

  // Lasting memory mode: nothing is written any more in this page; status.message says why (Today shows it).
  function toMemory(reason, e) {
    var was = persistent;
    persistent = false;
    status.persistent = false;
    status.reason = reason;
    status.message = MESSAGES[reason] || MESSAGES['write-failed'];
    if (e) status.saveError = e && e.name ? e.name : String(e);
    dirty = false;
    trialsDirty = {};
    warn('memory-' + reason, status.message);
    if (was && loaded) notify({ source: 'status', reason: reason });
  }

  function rescue(raw, why) {
    var key = cfg.prefix + 'rescue.' + Date.now();
    try { ls.setItem(key, raw); status.rescueKey = key; } catch (e) { status.rescueKey = null; }
    warn('rescue', 'Saved data in this browser could not be read (' + why + '), so Long-Horizon started fresh.' +
      (status.rescueKey ? ' The unreadable copy was kept under ' + key + '.' : ''));
  }

  function indexTrials() {
    trialIndex = {};
    if (!ls) return;
    var pre = trialPrefix();
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(pre) === 0) trialIndex[k.slice(pre.length)] = { key: k, kind: null, updatedAt: null };
      }
    } catch (e) { /* ignore */ }
  }

  function readTrialDoc(sid) {
    if (!ls) return null;
    var raw = null;
    try { raw = ls.getItem(trialKey(sid)); } catch (e) { return null; }
    if (!raw) return null;
    try { return S.guardTrialDoc(JSON.parse(raw), sid); } catch (e2) { return null; }
  }

  function trialMeta(sid) {
    var ent = trialIndex[sid];
    if (!ent) return null;
    if (ent.kind === null) {
      var d = trialsMem[sid] || readTrialDoc(sid);
      ent.kind = d ? d.kind : 'training';
      ent.updatedAt = d ? d.updatedAt : 0;
    }
    return ent;
  }

  /** training trial sessions, oldest first (by session start, else by the doc's updatedAt) */
  function trainingTrialsOldestFirst() {
    var sessT = {}, lab = {}, i;
    var ss = records ? records.sessions : [];
    for (i = 0; i < ss.length; i++) sessT[ss[i].id] = ss[i].startedAt;
    var lv = records ? records.labVisits : [];
    for (i = 0; i < lv.length; i++) lab[lv[i].id] = 1;
    var list = [];
    for (var sid in trialIndex) {
      var ent = trialMeta(sid);
      if (!ent || ent.kind === 'lab' || lab[sid]) continue;
      list.push({ sid: sid, key: ent.key, t: fin(sessT[sid]) ? sessT[sid] : (ent.updatedAt || 0) });
    }
    list.sort(function (a, b) { return a.t - b.t || (a.sid < b.sid ? -1 : (a.sid > b.sid ? 1 : 0)); });
    return list;
  }

  function dropTrialKey(item) {
    try { ls.removeItem(item.key); } catch (e) { /* ignore */ }
    delete trialIndex[item.sid];
    delete trialsMem[item.sid];
    delete trialsDirty[item.sid];
    status.droppedTrialKeys++;
  }

  function dropOldestTrialKey(exceptKey) {
    var list = trainingTrialsOldestFirst();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === exceptKey) continue;
      dropTrialKey(list[i]);
      return true;
    }
    return false;
  }

  function setWithQuota(key, text, isMain) {
    for (var attempt = 0; attempt < 500; attempt++) {
      try { ls.setItem(key, text); return true; }
      catch (e) {
        if (!isQuota(e)) { toMemory('write-failed', e); return false; }
        status.quotaWarned = true;
        if (!dropOldestTrialKey(key)) {
          // main: writeMain() compacts once more, then switches to memory mode (reason 'quota')
          if (!isMain) warn('quota', 'Browser storage is full, so some trial-by-trial details were not kept. Your levels and session summaries are safe. Exporting a backup is a good idea.');
          return false;
        }
        warn('quota', 'Browser storage is full, so the oldest trial-by-trial details were removed. Your levels and session summaries are safe. Exporting a backup is a good idea.');
      }
    }
    return false;
  }

  function enforceTrialCap() {
    var list = trainingTrialsOldestFirst();
    var extra = list.length - cfg.trialCap;
    for (var i = 0; i < extra; i++) dropTrialKey(list[i]);
  }

  // ---------------------------------------------------------------- notify / derived
  function invalidate() { derivedCache = null; derivedDay = null; }

  function notify(evt) {
    if (notifying) { notifyQueue.push(evt); return; }
    notifying = true;
    try {
      var e = evt;
      while (e) {
        var list = subs.slice();
        for (var i = 0; i < list.length; i++) {
          try { list[i](e); } catch (err) { if (typeof console !== 'undefined') console.error(err); }
        }
        e = notifyQueue.shift();
      }
    } finally { notifying = false; }
  }

  function getDerived() {
    ensureLoaded();
    var dk = U.dayKey();
    if (derivedCache && derivedDay === dk) return derivedCache;
    if (!(HF.engine && typeof HF.engine.derive === 'function')) return {};
    try { derivedCache = HF.engine.derive(records, Date.now()) || {}; }
    catch (e) {
      if (typeof console !== 'undefined') console.error('[long-horizon] derive failed', e);
      derivedCache = {};
    }
    derivedDay = dk;
    return derivedCache;
  }

  // ---------------------------------------------------------------- working-name migration (13 Nov 2026)
  // 1.0.0 ran under the working name Holdfast with keys 'holdfast.v1.*'. When this prefix has no main yet and a legacy
  // main exists, every legacy key is copied once to this prefix, in order of value: main, small flags (e.g. the
  // in-app-browser dismissal), Lab trial logs, training trial logs (newest session first), rescue copies. A key that
  // already exists under this prefix is never overwritten; legacy keys are never written or deleted (an older copy of
  // the app keeps working on them). What does not fit (quota) stays behind: trial logs get the usual trial-details
  // warning; if main itself does not fit, nothing else is copied, load() reads the legacy text directly and the next
  // save reports the lasting quota state (memory mode, Export).
  // Returns null (nothing to copy) or { from, at, main, copied, skipped, raw }.
  function copyLegacy() {
    var olds = cfg.legacyPrefixes || [];
    try { if (ls.getItem(mainKey()) !== null) return null; } catch (e) { return null; }
    for (var p = 0; p < olds.length; p++) {
      var old = olds[p], raw = null;
      if (typeof old !== 'string' || !old || old === cfg.prefix) continue;
      try { raw = ls.getItem(old + 'main'); } catch (e1) { return null; }
      if (raw === null) continue;
      var info = { from: old, at: Date.now(), main: false, copied: 0, skipped: 0, raw: raw }, lostTrials = 0;
      info.main = copyItem(old + 'main', mainKey(), raw, info);
      if (!info.main) return info;   // main did not fit: copy nothing else, so saving main has all the room there is
      var rest = legacyKeys(old, raw);
      for (var i = 0; i < rest.length; i++) {
        var before = info.skipped;
        copyItem(rest[i], cfg.prefix + rest[i].slice(old.length), null, info);
        if (info.skipped > before && rest[i].indexOf(old + 'trials.') === 0) lostTrials++;
      }
      if (lostTrials) warn('quota', 'Browser storage is full, so some trial-by-trial details were not kept. Your levels and session summaries are safe. Exporting a backup is a good idea.');
      return info;
    }
    return null;
  }

  function copyItem(from, to, value, info) {
    try {
      if (ls.getItem(to) !== null) return false;   // never overwrite this prefix's data
      if (value === null) value = ls.getItem(from);
      if (value === null) return false;
      ls.setItem(to, value);
      info.copied++;
      return true;
    } catch (e) { info.skipped++; return false; }
  }

  /** legacy keys other than main, most valuable first (see copyLegacy) */
  function legacyKeys(old, raw) {
    var keys = [], lab = {}, start = {}, recs = null, i, k;
    try {
      for (i = 0; i < ls.length; i++) {
        k = ls.key(i);
        if (k && k.indexOf(old) === 0 && k !== old + 'main' && k !== old + '__probe') keys.push(k);
      }
    } catch (e) { /* copy what was listed */ }
    try { recs = JSON.parse(raw); } catch (e2) { recs = null; }
    if (U.isPlainObject(recs)) {
      (Array.isArray(recs.labVisits) ? recs.labVisits : []).forEach(function (v) { if (v && v.id) lab[v.id] = 1; });
      (Array.isArray(recs.sessions) ? recs.sessions : []).forEach(function (s) { if (s && s.id && fin(s.startedAt)) start[s.id] = s.startedAt; });
    }
    var tp = old + 'trials.', rp = old + 'rescue.';
    function rank(key) {   // 0 flags, 1 Lab trial logs, 2 training trial logs, 3 rescue copies
      if (key.indexOf(tp) === 0) return lab[key.slice(tp.length)] ? 1 : 2;
      return key.indexOf(rp) === 0 ? 3 : 0;
    }
    keys.sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 2) {
        var ta = start[a.slice(tp.length)] || 0, tb = start[b.slice(tp.length)] || 0;
        if (ta !== tb) return tb - ta;   // newest session first
      }
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return keys;
  }

  // ---------------------------------------------------------------- load / listeners
  function configure(o) {
    o = o || {};
    if (typeof o.prefix === 'string' && o.prefix) cfg.prefix = o.prefix;
    if (Array.isArray(o.legacyPrefixes)) cfg.legacyPrefixes = o.legacyPrefixes.filter(function (x) { return typeof x === 'string' && x; });
    if (fin(o.trialCap) && o.trialCap >= 1) cfg.trialCap = Math.floor(o.trialCap);
    if (fin(o.saveDelayMs) && o.saveDelayMs >= 0) cfg.saveDelayMs = o.saveDelayMs;
    if (fin(o.nearFullChars) && o.nearFullChars > 0) cfg.nearFullChars = o.nearFullChars;
    return api;
  }

  function load() {
    status = freshStatus();
    warnedOnce = {};
    lastRaw = null;
    dirty = false;
    remotePending = null;
    ls = probeStorage();
    persistent = !!ls;
    status.persistent = persistent;
    status.reason = persistent ? null : 'blocked';
    status.message = persistent ? null : MESSAGES.blocked;
    var res = null, raw = null, newer = false, fromLegacy = false;
    if (persistent) {
      var legacy = copyLegacy();   // working-name migration: once, before the first read of this prefix
      if (legacy) status.legacy = { from: legacy.from, at: legacy.at, main: legacy.main, copied: legacy.copied, skipped: legacy.skipped };
      try { raw = ls.getItem(mainKey()); } catch (e) { raw = null; }
      if (raw === null && legacy && !legacy.main) { raw = legacy.raw; fromLegacy = true; }   // main did not fit: use the legacy text
      if (raw) {
        res = S.migrate(raw);
        if (res.fatal && res.newer) { newer = true; res = null; }   // CA-04: never write over newer data
        else if (res.fatal) { rescue(raw, res.errors[0]); lastRaw = fromLegacy ? null : raw; res = null; }   // CA-07: rescue once
        else { lastRaw = fromLegacy ? null : raw; status.loadErrors = res.errors.slice(0, 20); }
      }
    }
    records = res ? res.records : S.defaultRecords();
    loaded = true;
    trialsMem = {}; trialsDirty = {};
    invalidate();
    if (newer) toMemory('newer');
    if (persistent) {
      indexTrials();
      if (!res || res.errors.length || res.migratedFrom !== null || fromLegacy) scheduleSave();
    }
    attachListeners();
    return records;
  }

  function ensureLoaded() { if (!loaded) load(); }

  function attachListeners() {
    if (listenersOn || typeof root.addEventListener !== 'function') return;
    listenersOn = true;
    root.addEventListener('storage', onStorage);
    root.addEventListener('pagehide', function () { flush(true); });
    if (root.document && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('visibilitychange', function () {
        if (root.document.visibilityState === 'hidden') flush(true);
      });
    }
  }

  function onStorage(e) {
    if (!persistent || !e || !e.key) return;
    try { if (e.storageArea && ls && e.storageArea !== ls) return; } catch (x) { /* ignore */ }
    if (e.key === mainKey()) {
      if (e.newValue === null || e.newValue === undefined) return; // removed (reset); the new value follows
      remotePending = e.newValue;
      processRemoteWhenIdle();
    } else if (e.key.indexOf(trialPrefix()) === 0) {
      var sid = e.key.slice(trialPrefix().length);
      if (e.newValue === null) { delete trialIndex[sid]; }
      else if (!trialIndex[sid]) trialIndex[sid] = { key: e.key, kind: null, updatedAt: null };
      else trialIndex[sid].kind = null;
    }
  }

  function processRemoteWhenIdle() {
    if (remoteTimer) return;
    if (isBusy()) {
      remoteTimer = later(function () { remoteTimer = null; processRemoteWhenIdle(); }, 500);
      return;
    }
    processRemote();
  }

  function processRemote() {
    var raw = remotePending;
    remotePending = null;
    if (raw === null || raw === undefined || raw === lastRaw) return;
    var m = S.migrate(raw);
    if (m.fatal && m.newer) { toMemory('newer'); return; }   // a newer Long-Horizon tab saved: stop writing (CA-04)
    if (m.fatal) return; // a damaged foreign write: the next save rescues it before writing
    var info = {};
    records = S.merge(records, m.records, { info: info });
    lastRaw = raw;
    if (info.aOnly + info.aNewer + info.lwwA > 0) scheduleSave();
    if (info.bOnly + info.bNewer + info.lwwB + info.dropped > 0) {
      invalidate();
      notify({ source: 'remote', rev: records.rev });
    }
  }

  // ---------------------------------------------------------------- save
  function scheduleSave(delay) {
    dirty = true;
    if (savePending) return;
    savePending = true;
    later(function () {
      runIdle(function () {
        savePending = false;
        if (isBusy()) { scheduleSave(500); return; }
        doSave();
      });
    }, delay == null ? cfg.saveDelayMs : delay);
  }

  function writeMain() {
    var cur = null;
    try { cur = ls.getItem(mainKey()); } catch (e) { toMemory('write-failed', e); return false; }
    var changedByOther = false;
    if (cur !== null && cur !== lastRaw) {
      var m = S.migrate(cur);
      if (m.fatal && m.newer) { toMemory('newer'); return false; }   // never write over newer data (CA-04)
      if (m.fatal) { rescue(cur, m.errors[0]); lastRaw = cur; }
      else {
        var info = {};
        records = S.merge(records, m.records, { info: info });
        changedByOther = info.bOnly + info.bNewer + info.lwwB + info.dropped > 0;
      }
    }
    var text = JSON.stringify(records);
    if (text.length >= cfg.nearFullChars && text.length > compactTriedAt * 1.02 && compact(false, text.length)) text = JSON.stringify(records);
    if (!setWithQuota(mainKey(), text, true)) {
      if (!persistent) return false;                     // a non-quota failure already switched to memory mode
      if (compact(true, text.length)) {                  // last resort before giving up: compact, retry once
        text = JSON.stringify(records);
        if (setWithQuota(mainKey(), text, true)) return mainWritten(text, changedByOther);
        if (!persistent) return false;
      }
      status.quotaWarned = true;
      toMemory('quota', { name: 'QuotaExceededError' });
      return false;
    }
    return mainWritten(text, changedByOther);
  }

  /** Compaction hook (CA-05): HF.engine.compactRecords(records, now, opts) shrinks old records (engine-owned).
   *  Accepts a returned records object, { records }, or compaction in place (same object returned). Absent,
   *  null or failing → nothing changes. Returns true when the records got smaller. */
  var compactTriedAt = 0;
  function compact(force, beforeChars) {
    var E = HF.engine;
    if (!E || typeof E.compactRecords !== 'function') return false;
    var before = records, out = null;
    try { out = E.compactRecords(records, Date.now(), { force: !!force, targetChars: Math.floor(cfg.nearFullChars * 0.8) }); }
    catch (e) { if (typeof console !== 'undefined') console.error('[long-horizon] compactRecords failed', e); return false; }
    var next = out && U.isPlainObject(out.records) ? out.records : (out && U.isPlainObject(out) && out.schema !== undefined ? out : null);
    if (!next) { compactTriedAt = beforeChars || 0; return false; }   // nothing to compact
    var size = JSON.stringify(next).length;
    compactTriedAt = size;
    if (next === before && !(beforeChars && size < beforeChars)) return false;   // in place, nothing shrank
    records = next;
    status.compactedAt = Date.now();
    invalidate();
    return true;
  }

  function sizeCheck(chars) {
    status.mainChars = chars;
    var near = chars >= cfg.nearFullChars;
    if (near === status.nearFull) return;
    status.nearFull = near;
    status.nearFullText = near ? NEAR_FULL_TEXT : null;
    if (near) warn('near-full', NEAR_FULL_TEXT);
    notify({ source: 'status', nearFull: near });
  }

  function mainWritten(text, changedByOther) {
    lastRaw = text;
    dirty = false;
    status.lastSaveAt = Date.now();
    status.saveError = null;
    sizeCheck(text.length);
    if (changedByOther) { invalidate(); notify({ source: 'remote', rev: records.rev }); }
    askPersist();
    return true;
  }

  function writeTrials(sid) {
    var doc = trialsMem[sid];
    delete trialsDirty[sid];
    if (!doc) return;
    var stored = readTrialDoc(sid);
    if (stored) doc = trialsMem[sid] = S.mergeTrialDocs(doc, stored);
    if (setWithQuota(trialKey(sid), JSON.stringify(doc), false)) {
      trialIndex[sid] = { key: trialKey(sid), kind: doc.kind, updatedAt: doc.updatedAt };
      enforceTrialCap();
    }
  }

  function doSave() {
    if (!persistent) { dirty = false; trialsDirty = {}; return true; }
    if (dirty && !writeMain()) return false;
    if (!persistent) return false;
    for (var sid in trialsDirty) {
      if (Object.prototype.hasOwnProperty.call(trialsDirty, sid)) writeTrials(sid);
      if (!persistent) return false;
    }
    return true;
  }

  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      var st = root.navigator && root.navigator.storage;
      if (st && typeof st.persisted === 'function' && typeof st.persist === 'function') {
        st.persisted().then(function (p) { return p ? p : st.persist(); }).catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }

  function save() { ensureLoaded(); scheduleSave(); }

  function flush(force) {
    ensureLoaded();
    if (isBusy() && !force) { scheduleSave(500); return false; }
    var anyTrials = false;
    for (var k in trialsDirty) if (Object.prototype.hasOwnProperty.call(trialsDirty, k)) { anyTrials = true; break; }
    if (!dirty && !anyTrials) return true;
    return doSave();
  }

  // ---------------------------------------------------------------- mutate
  function mutate(fn, opts) {
    ensureLoaded();
    var ret = fn(records);
    if (ret && typeof ret === 'object' && ret !== records) records = ret;
    records.rev = (fin(records.rev) ? records.rev : 0) + 1;
    records.updatedAt = Date.now();
    invalidate();
    scheduleSave();
    if (!(opts && opts.silent)) notify({ source: 'local', rev: records.rev });
    return records;
  }

  function onChange(cb) {
    subs.push(cb);
    return function () { var i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
  }

  // ---------------------------------------------------------------- trials
  function saveTrials(sessionId, blockId, trialLog, opts) {
    ensureLoaded();
    sessionId = String(sessionId);
    blockId = String(blockId);
    var kind = opts && opts.kind === 'lab' ? 'lab' : 'training';
    var doc = trialsMem[sessionId];
    if (!doc) doc = { sessionId: sessionId, kind: kind, updatedAt: 0, blocks: {} };
    if (kind === 'lab') doc.kind = 'lab';
    doc.blocks[blockId] = S.encodeTrialLog(trialLog);
    doc.updatedAt = Date.now();
    trialsMem[sessionId] = doc;
    if (persistent) { trialsDirty[sessionId] = true; scheduleSave(); }
    return true;
  }

  function loadTrials(sessionId) {
    ensureLoaded();
    sessionId = String(sessionId);
    var doc = trialsMem[sessionId] || null;
    if (persistent) {
      var stored = readTrialDoc(sessionId);
      doc = doc ? S.mergeTrialDocs(doc, stored) : stored;
    }
    if (!doc) return null;
    var blocks = {};
    for (var b in doc.blocks) if (Object.prototype.hasOwnProperty.call(doc.blocks, b)) blocks[b] = S.decodeTrialLog(doc.blocks[b]);
    return { sessionId: doc.sessionId, kind: doc.kind, updatedAt: doc.updatedAt, blocks: blocks };
  }

  function trialSessionIds() {
    ensureLoaded();
    var ids = {}, k;
    for (k in trialIndex) ids[k] = 1;
    for (k in trialsMem) ids[k] = 1;
    return Object.keys(ids);
  }

  function allTrialDocs() {
    var out = {}, ids = trialSessionIds();
    for (var i = 0; i < ids.length; i++) {
      var sid = ids[i], doc = trialsMem[sid] || null;
      if (persistent) {
        var stored = readTrialDoc(sid);
        doc = doc ? S.mergeTrialDocs(doc, stored) : stored;
      }
      if (doc) out[sid] = doc;
    }
    return out;
  }

  // ---------------------------------------------------------------- export / import / reset
  /** opts.stamp === false: build the text without recording a backup (CB-01; call markBackup() once it is saved) */
  function exportText(opts) {
    ensureLoaded();
    var now = Date.now();
    if (!(opts && opts.stamp === false)) markBackup(now);
    var trials = opts && opts.trials === false ? {} : allTrialDocs();
    return JSON.stringify(S.makeBackup(records, trials, now));
  }

  /** backups.lastExportAt = now (a normal mutate: rev, save, notify) → the time stamped */
  function markBackup(at) {
    ensureLoaded();
    var now = fin(at) ? at : Date.now();
    mutate(function (r) {
      var b = U.clone(r.backups || {});
      b.updatedAt = now;
      b.lastExportAt = now;
      r.backups = b;
    });
    return now;
  }

  function download(text, filename) {
    if (text == null) text = exportText();
    filename = filename || ('long-horizon-backup-' + U.dayKey() + '.json');
    if (HF.dom && typeof HF.dom.download === 'function') return HF.dom.download(filename, text, 'application/json');
    return false;
  }

  function importText(text) {
    ensureLoaded();
    var b = S.readBackup(text);
    if (!b.ok) return { ok: false, error: b.error, added: 0, updated: 0, trials: 0, migratedFrom: null, errors: b.errors || [] };
    var info = {};
    records = S.merge(records, b.records, { ignoreReset: true, info: info });
    records.rev = (fin(records.rev) ? records.rev : 0) + 1;
    records.updatedAt = Date.now();
    var nTrials = 0;
    for (var sid in b.trials) {
      if (!Object.prototype.hasOwnProperty.call(b.trials, sid)) continue;
      var mine = trialsMem[sid] || (persistent ? readTrialDoc(sid) : null);
      trialsMem[sid] = mine ? S.mergeTrialDocs(mine, b.trials[sid]) : b.trials[sid];
      if (persistent) trialsDirty[sid] = true;
      nTrials++;
    }
    dirty = true;
    invalidate();
    if (persistent && !isBusy()) doSave(); else scheduleSave();
    notify({ source: 'import', rev: records.rev });
    return {
      ok: true, error: null, added: info.bOnly, updated: info.bNewer + info.lwwB, trials: nTrials,
      migratedFrom: b.migratedFrom, errors: b.errors
    };
  }

  function reset() {
    ensureLoaded();
    var now = Date.now();
    var fresh = S.defaultRecords(now);
    fresh.resetAt = now;
    fresh.rev = (records && fin(records.rev) ? records.rev : 0) + 1;
    if (persistent) {
      // "Delete everything" also removes the copies kept under the working name (legacy prefixes, see copyLegacy):
      // they are this player's data too, and nothing may come back after a reset.
      var doomed = [mainKey()], pre = trialPrefix();
      var olds = (cfg.legacyPrefixes || []).filter(function (o) { return typeof o === 'string' && o && o !== cfg.prefix; });
      try {
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (!k) continue;
          if (k.indexOf(pre) === 0) doomed.push(k);
          else for (var q = 0; q < olds.length; q++) if (k.indexOf(olds[q]) === 0) { doomed.push(k); break; }
        }
      } catch (e) { /* ignore */ }
      for (var j = 0; j < doomed.length; j++) { try { ls.removeItem(doomed[j]); } catch (e2) { /* ignore */ } }
    }
    trialsMem = {}; trialsDirty = {}; trialIndex = {};
    records = fresh;
    lastRaw = null;
    dirty = true;
    invalidate();
    if (persistent) doSave();
    notify({ source: 'reset', rev: records.rev });
    return records;
  }

  var api = {
    configure: configure, load: load, mutate: mutate, save: save, flush: flush, onChange: onChange,
    saveTrials: saveTrials, loadTrials: loadTrials, trialSessionIds: trialSessionIds,
    exportText: exportText, markBackup: markBackup, download: download, importText: importText, reset: reset,
    keys: { main: mainKey, trials: trialKey }, MESSAGES: MESSAGES, NEAR_FULL_TEXT: NEAR_FULL_TEXT
  };
  Object.defineProperty(api, 'records', { enumerable: true, get: function () { ensureLoaded(); return records; } });
  Object.defineProperty(api, 'derived', { enumerable: true, get: getDerived });
  Object.defineProperty(api, 'persistent', { enumerable: true, get: function () { return persistent; } });
  Object.defineProperty(api, 'status', { enumerable: true, get: function () { return status; } });
  Object.defineProperty(api, 'loaded', { enumerable: true, get: function () { return loaded; } });

  HF.store = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
