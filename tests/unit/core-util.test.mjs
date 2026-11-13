// Unit tests for js/core/util.js (pure). Run: node tests/unit/run.mjs core-util
import { HF, ROOT } from './load.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const U = HF.util;

export default async function (t) {
  await t.test('id: unique, prefixed, url-safe', () => {
    const ids = new Set();
    for (let i = 0; i < 20000; i++) ids.add(U.id('s'));
    t.eq(ids.size, 20000);
    const one = U.id('blk');
    t.ok(/^blk-[0-9a-z]+-[0-9a-z]{8,}$/.test(one), one);
    t.ok(/^[0-9a-z]+-[0-9a-z]{8,}$/.test(U.id()), 'no prefix');
  });

  await t.test('dayKey uses local calendar days', () => {
    t.eq(U.dayKey(new Date(2026, 10, 6, 23, 59, 59).getTime()), '2026-11-06');
    t.eq(U.dayKey(new Date(2026, 10, 7, 0, 0, 0).getTime()), '2026-11-07');
    t.eq(U.dayKey(new Date(2026, 0, 1, 0, 0, 1).getTime()), '2026-01-01');
    t.ok(U.isDayKey(U.dayKey()));
  });

  await t.test('isDayKey / parseDayKey reject impossible dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-01', 'x', '', null, 20260101]) t.ok(!U.isDayKey(bad), String(bad));
    t.ok(U.isDayKey('2028-02-29'));
    t.ok(!U.isDayKey('2027-02-29'));
    t.ok(isNaN(U.parseDayKey('2026-02-30')));
    t.eq(U.parseDayKey('2026-11-06'), new Date(2026, 10, 6).getTime());
  });

  await t.test('addDays / daysBetween across months, years, leap days', () => {
    t.eq(U.addDays('2026-12-31', 1), '2027-01-01');
    t.eq(U.addDays('2027-01-01', -1), '2026-12-31');
    t.eq(U.addDays('2028-02-28', 1), '2028-02-29');
    t.eq(U.addDays('2026-11-06', 0), '2026-11-06');
    t.eq(U.addDays('2026-11-06', 365), '2027-11-06');
    t.eq(U.addDays('bad', 1), null);
    t.eq(U.daysBetween('2026-12-31', '2027-01-01'), 1);
    t.eq(U.daysBetween('2028-02-28', '2028-03-01'), 2);
    t.eq(U.daysBetween('2026-11-06', '2026-10-06'), -31);
    t.ok(isNaN(U.daysBetween('x', '2026-01-01')));
  });

  await t.test('weeks start on Monday', () => {
    t.eq(U.weekKey('2026-11-08'), '2026-11-02'); // Sunday → previous Monday
    t.eq(U.weekKey('2026-11-09'), '2026-11-09'); // Monday
    t.eq(U.weekKey('2026-11-06'), '2026-11-02'); // Friday
    t.eq(U.weekKey('2027-01-01'), '2026-12-28'); // across a year
    t.eq(U.dayOfWeek('2026-11-09'), 0);
    t.eq(U.dayOfWeek('2026-11-08'), 6);
    const ms = new Date(2026, 10, 8, 22, 0).getTime();
    t.eq(U.weekKey(ms), '2026-11-02');
    t.eq(U.weekStart(ms), new Date(2026, 10, 2, 0, 0, 0).getTime());
    t.eq(U.startOfDay(ms), new Date(2026, 10, 8).getTime());
  });

  await t.test('calendar helpers are DST-safe in real time zones (child processes)', () => {
    const script = `
      require(${JSON.stringify(path.join(ROOT, 'js/core/util.js'))});
      const U = globalThis.HF.util, out = [];
      const ok = (c, m) => { if (!c) out.push(m); };
      // US 2026: DST starts Sun 8 Mar, ends Sun 1 Nov
      ok(U.addDays('2026-03-07', 1) === '2026-03-08', 'spring add 1');
      ok(U.addDays('2026-03-08', 1) === '2026-03-09', 'spring add 2');
      ok(U.daysBetween('2026-03-07', '2026-03-09') === 2, 'spring between');
      ok(U.addDays('2026-10-31', 2) === '2026-11-02', 'fall add');
      ok(U.weekKey('2026-11-01') === '2026-10-26', 'fall week');
      ok(U.weekKey('2026-03-10') === '2026-03-09', 'spring week');
      ok(U.dayKey(U.parseDayKey('2026-03-08')) === '2026-03-08', 'spring parse');
      ok(U.dayKey(U.parseDayKey('2026-11-01')) === '2026-11-01', 'fall parse');
      let k = '2026-01-01';
      for (let i = 0; i < 730; i++) { const n = U.addDays(k, 1); if (U.daysBetween(k, n) !== 1) out.push('step ' + k); k = n; }
      ok(k === '2028-01-01', 'walk ' + k);
      ok(U.weekStart(new Date(2026, 10, 1, 12).getTime()) === new Date(2026, 9, 26).getTime(), 'weekStart fall');
      // Sao Paulo 2018: DST began at local midnight on 4 Nov (00:00 did not exist)
      if (process.env.TZ === 'America/Sao_Paulo') {
        ok(U.addDays('2018-11-03', 1) === '2018-11-04', 'midnight gap add');
        ok(U.dayKey(U.parseDayKey('2018-11-04')) === '2018-11-04', 'midnight gap parse');
        ok(U.weekKey('2018-11-04') === '2018-10-29', 'midnight gap week');
      }
      process.stdout.write(JSON.stringify(out));
    `;
    for (const tz of ['America/New_York', 'Europe/Bucharest', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'UTC']) {
      const res = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
      t.eq(JSON.parse(res), [], tz);
    }
  });

  await t.test('clone is deep and keeps NaN, Dates and typed arrays', () => {
    const src = { a: [1, { b: NaN }], d: new Date(5), f: new Float32Array([1.5, 2]), u: undefined, n: null, s: 'x' };
    const c = U.clone(src);
    t.ok(c !== src && c.a !== src.a && c.a[1] !== src.a[1]);
    t.ok(Number.isNaN(c.a[1].b));
    t.ok(c.d instanceof Date && c.d !== src.d && c.d.getTime() === 5);
    t.ok(c.f instanceof Float32Array && c.f !== src.f && c.f[0] === 1.5);
    t.ok('u' in c && c.u === undefined);
    c.a[1].b = 3;
    t.ok(Number.isNaN(src.a[1].b), 'source untouched');
  });

  await t.test('deepEqual and stableStringify', () => {
    t.ok(U.deepEqual({ a: [1, 2, { c: NaN }], b: 'x' }, { b: 'x', a: [1, 2, { c: NaN }] }));
    t.ok(!U.deepEqual({ a: 1 }, { a: 1, b: undefined }));
    t.ok(!U.deepEqual([1, 2], [2, 1]));
    t.ok(!U.deepEqual({ a: [] }, { a: {} }));
    t.ok(!U.deepEqual(null, {}));
    t.eq(U.stableStringify({ b: 1, a: [3, { d: 1, c: 2 }] }), '{"a":[3,{"c":2,"d":1}],"b":1}');
    t.eq(U.stableStringify({ x: undefined, y: NaN }), '{"y":null}');
  });

  await t.test('inAppBrowser recognises in-app browsers and leaves real browsers alone', () => {
    const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    const cases = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', null],
      [ios + ' Version/17.5 Safari/604.1', null],
      [android, null],
      [ios + ' Discord/240.0', 'discord'],
      [android.replace('Pixel 8)', 'Pixel 8; wv)') + ' Discord/240.0', 'discord'],
      [ios + ' Instagram 340.0.0.22.109 (iPhone15,2; iOS 17_5; en_US)', 'instagram'],
      [ios + ' [FBAN/FBIOS;FBAV/480.0.0.39.104;FBBV/123]', 'facebook'],
      [ios + ' [FBAN/MessengerForiOS;FBAV/470.0.0.43.105]', 'messenger'],
      [ios + ' Safari Line/14.10.0', 'line'],
      [android.replace('Pixel 8)', 'Pixel 8; wv)') + ' trill_350402 BytedanceWebview/d8a21c6', 'tiktok'],
      [ios + ' Snapchat/13.10.0.40 (like Safari/8618.2.12.10.4)', 'snapchat'],
      [android + ' MicroMessenger/8.0.49', 'wechat'],
      [android.replace('Pixel 8)', 'Pixel 8; wv)'), 'webview']
    ];
    for (const [ua, id] of cases) {
      const hit = U.inAppBrowser(ua);
      t.eq(hit ? hit.id : null, id, ua.slice(-40));
    }
    t.eq(U.inAppBrowser(ios + ' Discord/240.0').name, 'Discord');
    t.eq(U.inAppBrowser(android.replace('Pixel 8)', 'Pixel 8; wv)')).name, null);
    t.eq(U.inAppBrowser(undefined), null);
  });

  await t.test('semverCompare, sortBy, clamp, round, formatting', () => {
    t.eq(U.semverCompare('1.0.0', '1.0.1'), -1);
    t.eq(U.semverCompare('1.10.0', '1.9.9'), 1);
    t.eq(U.semverCompare('2.0', '2.0.0'), 0);
    const s = U.sortBy([{ k: 2, i: 0 }, { k: 1, i: 1 }, { k: 2, i: 2 }, { k: 1, i: 3 }], x => x.k);
    t.eq(s.map(x => x.i), [1, 3, 0, 2]);
    t.eq(U.clamp(5, 0, 3), 3);
    t.eq(U.round(1.23456, 2), 1.23);
    t.eq(U.formatDuration(61000), '1:01');
    t.eq(U.formatDuration(3723000), '1:02:03');
    t.eq(U.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    t.eq(U.plural(1, 'block'), '1 block');
    t.eq(U.plural(3, 'block'), '3 blocks');
    t.ok(typeof U.hashString('abc') === 'string' && U.hashString('abc') === U.hashString('abc') && U.hashString('abc') !== U.hashString('abd'));
    t.ok(typeof HF.VERSION === 'string' && HF.VERSION.length > 0);
  });
}
