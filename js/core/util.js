/* Long-Horizon — small pure helpers. MIT licence.
 *
 * No DOM, no timers. Loads in node (tests) and in the browser (classic script).
 *
 * Exports HF.util:
 *   id(prefix?)            → 'p-lq3k5x0a-4f9k2z1' : time-sortable, unique across tabs (time + 31 random bits + counter)
 *   now()                  → Date.now() (one place to stub in tests)
 *   Calendar (LOCAL time, never UTC; DST-safe because dates are built from Y/M/D components at noon):
 *     dayKey(ms?)          → 'YYYY-MM-DD' of the local day containing ms (default now)
 *     isDayKey(s)          → true for a real calendar date in that format
 *     parseDayKey(key)     → ms of local midnight of that day (NaN if invalid)
 *     addDays(key, n)      → dayKey n calendar days later (n may be negative)
 *     daysBetween(a, b)    → whole calendar days from a to b (b − a; negative if b is earlier)
 *     dayOfWeek(key|ms)    → 0 = Monday … 6 = Sunday
 *     weekKey(key|ms)      → dayKey of the Monday that starts the week (weeks start on Monday)
 *     weekStart(ms?)       → ms of local midnight of that Monday
 *     startOfDay(ms?)      → ms of local midnight of that day
 *   Data:
 *     clone(x)             → deep copy of JSON-like data (plain objects, arrays, Dates, typed arrays); keeps NaN/undefined
 *     deepEqual(a, b)      → structural equality for JSON-like data (NaN equals NaN)
 *     stableStringify(x)   → JSON with object keys sorted (canonical form for tie-breaks and fingerprints)
 *     isPlainObject(x), clamp(x, lo, hi), round(x, dp), range(n), pad2(n), sortBy(arr, fn) (stable copy)
 *     semverCompare(a, b)  → -1 | 0 | 1
 *     hashString(s)        → short base-36 hash (cyrb128 via HF.rng when loaded, FNV-1a otherwise)
 *   Text:
 *     escapeHtml(s), formatDuration(ms) → 'm:ss' (or 'h:mm:ss'), plural(n, one, many)
 *   Environment:
 *     inAppBrowser(userAgent) → { id, name } | null   Discord, Instagram, Messenger, Facebook (FBAN/FBAV), LINE,
 *        TikTok (BytedanceWebview), Snapchat, WeChat, or a generic Android WebView ('; wv)', name null)
 *
 * Also sets HF.VERSION (app version string) if nothing set it before.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  if (!HF.VERSION) HF.VERSION = '1.0.0';

  var DAY_MS = 86400000;

  // ---------- ids ----------
  var counter = 0;
  function rand31() {
    try {
      var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (c && c.getRandomValues) {
        var buf = new Uint32Array(1);
        c.getRandomValues(buf);
        return buf[0] >>> 1;
      }
    } catch (e) { /* fall through */ }
    return Math.floor(Math.random() * 2147483648);
  }
  function id(prefix) {
    counter = (counter + 1) % 1296;
    var t = Date.now().toString(36);
    var r = rand31().toString(36);
    while (r.length < 6) r = '0' + r;
    var c = counter.toString(36);
    if (c.length < 2) c = '0' + c;
    return (prefix ? prefix + '-' : '') + t + '-' + r + c;
  }

  function now() { return Date.now(); }

  // ---------- calendar (local) ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function dayKey(ms) { return keyOf(new Date(ms == null ? Date.now() : ms)); }

  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function parts(key) {
    var m = typeof key === 'string' ? DAY_RE.exec(key) : null;
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }
  function isDayKey(s) { return !!parts(s); }
  function parseDayKey(key) {
    var p = parts(key);
    if (!p) return NaN;
    return new Date(p.y, p.m - 1, p.d, 0, 0, 0, 0).getTime();
  }
  function noonOf(keyOrMs) {
    if (typeof keyOrMs === 'string') {
      var p = parts(keyOrMs);
      if (!p) return null;
      return new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
    }
    var d = new Date(keyOrMs == null ? Date.now() : keyOrMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }
  function addDays(key, n) {
    var p = parts(key);
    if (!p) return null;
    return keyOf(new Date(p.y, p.m - 1, p.d + (n | 0), 12, 0, 0, 0));
  }
  function daysBetween(a, b) {
    var pa = parts(a), pb = parts(b);
    if (!pa || !pb) return NaN;
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS);
  }
  function dayOfWeek(keyOrMs) {
    var d = noonOf(keyOrMs);
    if (!d) return NaN;
    return (d.getDay() + 6) % 7;
  }
  function weekKey(keyOrMs) {
    var d = noonOf(keyOrMs);
    if (!d) return null;
    var off = (d.getDay() + 6) % 7;
    return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - off, 12, 0, 0, 0));
  }
  function weekStart(ms) { return parseDayKey(weekKey(ms == null ? Date.now() : ms)); }
  function startOfDay(ms) {
    var d = new Date(ms == null ? Date.now() : ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }

  // ---------- data ----------
  // realm-independent: a plain object's prototype is null or a root prototype (Object.prototype of any realm)
  function isPlainObject(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
    var p = Object.getPrototypeOf(x);
    return p === null || Object.getPrototypeOf(p) === null;
  }
  function clone(x) {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) {
      var a = new Array(x.length);
      for (var i = 0; i < x.length; i++) a[i] = clone(x[i]);
      return a;
    }
    if (x instanceof Date) return new Date(x.getTime());
    if (ArrayBuffer.isView(x) && typeof x.slice === 'function') return x.slice();
    if (!isPlainObject(x)) return x;
    var o = {};
    for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = clone(x[k]);
    return o;
  }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b; // NaN
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    var aa = Array.isArray(a), ba = Array.isArray(b);
    if (aa !== ba) return false;
    var i;
    if (aa) {
      if (a.length !== b.length) return false;
      for (i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }
  function stableStringify(x) {
    if (x === undefined) return 'null';
    if (x === null || typeof x !== 'object') {
      if (typeof x === 'number' && !isFinite(x)) return 'null';
      return JSON.stringify(x);
    }
    if (Array.isArray(x)) {
      var parts1 = [];
      for (var i = 0; i < x.length; i++) parts1.push(stableStringify(x[i]));
      return '[' + parts1.join(',') + ']';
    }
    var keys = Object.keys(x).sort(), out = [];
    for (var j = 0; j < keys.length; j++) {
      if (x[keys[j]] === undefined || typeof x[keys[j]] === 'function') continue;
      out.push(JSON.stringify(keys[j]) + ':' + stableStringify(x[keys[j]]));
    }
    return '{' + out.join(',') + '}';
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function round(x, dp) { var f = Math.pow(10, dp || 0); return Math.round(x * f) / f; }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function sortBy(arr, fn) {
    return arr.map(function (x, i) { return { x: x, k: fn(x), i: i }; })
      .sort(function (p, q) { return p.k < q.k ? -1 : (p.k > q.k ? 1 : p.i - q.i); })
      .map(function (p) { return p.x; });
  }
  function semverCompare(a, b) {
    var pa = String(a || '0').split(/[.+-]/), pb = String(b || '0').split(/[.+-]/);
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = pa[i] === undefined ? '0' : pa[i], y = pb[i] === undefined ? '0' : pb[i];
      var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { if (+x !== +y) return +x < +y ? -1 : 1; }
      else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  function hashString(s) {
    s = String(s);
    if (HF.rng && HF.rng.hash) {
      var h = HF.rng.hash(s);
      return h[0].toString(36) + h[1].toString(36);
    }
    var x = 2166136261;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(36);
  }

  // ---------- text ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }
  function formatDuration(ms) {
    if (!(ms >= 0)) ms = 0;
    var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---------- environment ----------
  // In-app browsers (their storage may be separate from the real browser's, or wiped). Specific apps first;
  // '; wv)' is a generic Android WebView. name null = unknown app.
  var IN_APP = [
    { id: 'discord', name: 'Discord', re: /\bDiscord\b/i },
    { id: 'instagram', name: 'Instagram', re: /\bInstagram\b/i },
    { id: 'messenger', name: 'Messenger', re: /\bMessenger(ForiOS|Lite)?\b|FB_IAB\/MESSENGER/i },
    { id: 'facebook', name: 'Facebook', re: /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b/ },
    { id: 'line', name: 'LINE', re: /\bLine\/\d/ },
    { id: 'tiktok', name: 'TikTok', re: /BytedanceWebview|musical_ly|\bTikTok\b|\btrill_\d/i },
    { id: 'snapchat', name: 'Snapchat', re: /\bSnapchat\b/i },
    { id: 'wechat', name: 'WeChat', re: /MicroMessenger/i },
    { id: 'webview', name: null, re: /;\s*wv\)/ }
  ];
  function inAppBrowser(ua) {
    ua = String(ua || '');
    for (var i = 0; i < IN_APP.length; i++) if (IN_APP[i].re.test(ua)) return { id: IN_APP[i].id, name: IN_APP[i].name };
    return null;
  }

  var api = {
    DAY_MS: DAY_MS,
    id: id, now: now,
    dayKey: dayKey, isDayKey: isDayKey, parseDayKey: parseDayKey, addDays: addDays, daysBetween: daysBetween,
    dayOfWeek: dayOfWeek, weekKey: weekKey, weekStart: weekStart, startOfDay: startOfDay,
    isPlainObject: isPlainObject, clone: clone, deepEqual: deepEqual, stableStringify: stableStringify,
    clamp: clamp, round: round, range: range, pad2: pad2, sortBy: sortBy, semverCompare: semverCompare,
    hashString: hashString, escapeHtml: escapeHtml, formatDuration: formatDuration, plural: plural,
    inAppBrowser: inAppBrowser
  };
  HF.util = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
