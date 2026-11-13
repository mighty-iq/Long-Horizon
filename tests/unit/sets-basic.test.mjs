// HF.sets: required sets, shapes, cyclic orders, track mapping, spoken-letter gating, item helpers.
import { HF, load, ROOT } from './load.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
load('js/content/sets.js');

const REQUIRED = ['grid8', 'ring8', 'letters', 'digits', 'days', 'months', 'clock', 'compass', 'shapes', 'tones',
  'glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH', 'glyphsLab'];
const FAMILIES = ['spatial', 'verbal', 'numeric', 'symbolic', 'audio'];
const NBACK = ['nback.plain', 'nback.dual', 'nback.transform', 'nback.arith', 'nback.switch'];
const MINUS = '−';

export default async function (t) {
  const S = HF.sets;

  await t.test('sets: every required set exists with the documented shape', () => {
    for (const id of REQUIRED.concat(['arith', 'numbers'])) {
      const s = S.get(id);
      t.ok(s, 'missing ' + id);
      t.eq(s.id, id);
      t.ok(['visual', 'audio', 'expr', 'number'].includes(s.kind), id + ' kind');
      t.ok(FAMILIES.includes(s.contentFamily), id + ' family');
      t.ok(typeof s.label === 'string' && s.label.length > 2, id + ' label');
      t.ok(typeof s.noun === 'string' && typeof s.nouns === 'string', id + ' noun');
      t.ok(Array.isArray(s.items) && s.items.length >= 7, id + ' items');
      t.eq(s.names.length, s.items.length, id + ' names');
      t.ok(S.available(id));
      const keys = new Set(s.items.map(S.key));
      t.eq(keys.size, s.items.length, id + ' keys unique');
      s.items.forEach((it, i) => t.eq(S.indexOf(id, it), i, id + ' indexOf'));
      if (s.cyclic) t.eq(s.order.map(S.key), s.items.map(S.key), id + ' order'); else t.eq(s.order, [], id + ' order empty');
    }
    t.eq(S.get('nope'), null);
    t.ok(!S.available('nope'));
  });

  await t.test('sets: contents match SPEC §2.2', () => {
    t.eq(S.get('grid8').items, [0, 1, 2, 3, 4, 5, 6, 7].map(c => ({ cell: c })));
    t.eq(S.get('ring8').items, S.get('grid8').items);
    t.ok(S.get('ring8').cyclic && !S.get('grid8').cyclic);
    t.eq(S.get('letters').items.map(x => x.text).join(''), 'CHKLQRST');
    t.eq(S.get('digits').items.map(x => x.text).join(''), '123456789');
    t.eq(S.get('days').items.map(x => x.text), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    t.eq(S.get('months').items.length, 12);
    t.eq(S.get('clock').items.map(x => x.text), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    t.eq(S.get('compass').items.map(x => x.text), ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    t.eq(S.get('shapes').items.length, 8);
    for (const it of S.get('shapes').items) t.ok(/^M[\d .MLACZ-]+$/.test(S.shapePath(it.shape)), 'shape path ' + it.shape);
    t.eq(S.get('tones').items, [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ tone: i })));
    t.eq(S.get('tones').kind, 'audio');
    for (const id of ['days', 'months', 'clock', 'compass', 'ring8']) t.ok(S.get(id).cyclic, id + ' cyclic');
    for (const id of ['letters', 'digits', 'shapes', 'tones', 'glyphsA']) t.ok(!S.get(id).cyclic, id + ' not cyclic');
    for (const g of REQUIRED.filter(x => x.startsWith('glyphs'))) {
      t.eq(S.get(g).items, [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ glyph: g, index: i })));
      t.eq(S.get(g).contentFamily, 'symbolic');
    }
    t.eq(S.get('grid8').contentFamily, 'spatial');
    t.eq(S.get('letters').contentFamily, 'verbal');
    t.eq(S.get('digits').contentFamily, 'numeric');
    t.eq(S.get('tones').contentFamily, 'audio');
  });

  await t.test('sets: arith holds every a ± b with operands 1–9 and value 1–9, true minus sign', () => {
    const items = S.get('arith').items;
    t.eq(items.length, 72);
    const perValue = {};
    for (const it of items) {
      const m = /^([1-9]) ([+−]) ([1-9])$/.exec(it.expr);
      t.ok(m, 'format ' + it.expr);
      const v = m[2] === '+' ? +m[1] + +m[3] : +m[1] - +m[3];
      t.eq(it.value, v, it.expr);
      t.ok(v >= 1 && v <= 9);
      t.ok(!it.expr.includes('-'), 'ASCII hyphen in ' + it.expr);
      perValue[v] = (perValue[v] || 0) + 1;
    }
    t.eq(Object.values(perValue), [8, 8, 8, 8, 8, 8, 8, 8, 8]);
    t.eq(S.parseExpr('9 ' + MINUS + ' 2'), { a: 9, op: MINUS, b: 2, value: 7 });
    t.eq(S.parseExpr('3 + 4').value, 7);
    t.eq(S.parseExpr('x'), null);
    t.eq(S.get('arith').kind, 'expr');
  });

  await t.test('sets: cyclic steps wrap and rule phrases read naturally', () => {
    t.eq(S.step('days', { text: 'Sun' }, 1), { text: 'Mon' });
    t.eq(S.step('days', { text: 'Mon' }, -1), { text: 'Sun' });
    t.eq(S.step('days', { text: 'Sat' }, 2), { text: 'Mon' });
    t.eq(S.step('clock', { text: '12' }, 1), { text: '1' });
    t.eq(S.step('months', { text: 'Dec' }, 1), { text: 'Jan' });
    t.eq(S.step('compass', { text: 'NW' }, 1), { text: 'N' });
    t.eq(S.step('ring8', { cell: 7 }, 1), { cell: 0 });
    t.throws(() => S.step('letters', { text: 'C' }, 1));
    t.eq(S.rulePhrase('days', 1), 'the day after');
    t.eq(S.rulePhrase('days', 2), 'two days after');
    t.eq(S.rulePhrase('days', -1), 'the day before');
    t.eq(S.rulePhrase('compass', 1), 'one point clockwise');
    t.eq(S.relPhrase('compass', -1), 'one point anticlockwise from');
    t.eq(S.relPhrase('days', 1), 'the day after');
    t.eq(S.rulePhrase('clock', 1), 'the hour after');
  });

  await t.test('sets: forTrack / defaultFor cover every n-back track; Lab glyphs never trained', () => {
    for (const tr of NBACK) {
      const list = S.forTrack(tr), d = S.defaultFor(tr);
      t.ok(list.length >= 1, tr);
      t.ok(list.includes(d), tr + ' default in list');
      t.ok(!list.includes('glyphsLab'), tr + ' must not train glyphsLab');
      for (const id of list) t.ok(S.available(id), id);
    }
    t.eq(S.defaultFor('nback.transform'), 'days');
    t.eq(S.defaultFor('nback.plain'), 'grid8');
    t.eq(S.defaultFor('nback.dual'), 'tones');
    t.eq(S.defaultFor('nback.arith'), 'arith');
    t.eq(S.defaultFor('nback.switch'), 'digits');
    t.ok(S.forTrack('nback.transform').every(id => S.get(id).cyclic));
    t.ok(S.forTrack('nback.dual').every(id => S.get(id).kind === 'audio'));
    t.eq(S.forTrack('nback.switch'), ['digits', 'shapes']);
    for (const g of ['glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH']) t.ok(S.forTrack('nback.plain').includes(g), g);
    t.eq(S.forTrack('lab.nback'), ['glyphsLab']);
    t.eq(S.forTrack('rel.grid.T1'), []);
    t.eq(S.defaultFor('vs.search'), null);
  });

  await t.test('sets: lettersAudio exists only while window.HF_AUDIO_CLIPS provides letters', () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'HF_AUDIO_CLIPS'), saved = globalThis.HF_AUDIO_CLIPS;
    try {
      delete globalThis.HF_AUDIO_CLIPS;
      t.ok(!S.available('lettersAudio')); t.eq(S.get('lettersAudio'), null);
      t.ok(!S.forTrack('nback.dual').includes('lettersAudio'));
      t.ok(!S.list().includes('lettersAudio'));
      globalThis.HF_AUDIO_CLIPS = { letters: { F: 'a', H: 'b', J: 'c', K: 'd', L: 'e', M: 'f', Q: 'g', R: 'h' } };
      t.ok(S.available('lettersAudio'));
      const s = S.get('lettersAudio');
      t.eq(s.kind, 'audio'); t.eq(s.contentFamily, 'audio');
      t.eq(s.items, ['F', 'H', 'J', 'K', 'L', 'M', 'Q', 'R'].map(c => ({ clip: c })));
      t.ok(S.forTrack('nback.dual').includes('lettersAudio'));
      t.ok(S.forTrack('nback.plain').includes('lettersAudio'));
      t.eq(S.name({ clip: 'Q' }), 'Q');
      globalThis.HF_AUDIO_CLIPS = { order: ['K', 'F', 'R', 'H', 'L', 'Q'], letters: {} };
      t.eq(S.get('lettersAudio').items.map(x => x.clip), ['K', 'F', 'R', 'H', 'L', 'Q']);
      globalThis.HF_AUDIO_CLIPS = { letters: { F: 1, H: 2 } }; // too few for a stream
      t.ok(!S.available('lettersAudio'));
      // the core's flat format: { C: 'data:audio/mpeg;base64,…', H: …, … } (HF.audio.clip takes the letter)
      globalThis.HF_AUDIO_CLIPS = { C: 'data:a', H: 'data:b', K: 'data:c', L: 'data:d', Q: 'data:e', R: 'data:f', S: 'data:g', T: 'data:h' };
      t.ok(S.available('lettersAudio'));
      t.eq(S.get('lettersAudio').items, ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'].map(c => ({ clip: c })));
      t.ok(S.forTrack('nback.dual').includes('lettersAudio'));
      globalThis.HF_AUDIO_CLIPS = { C: 'x', H: 'x', K: 'x', L: 'x', Q: 'x' }; // 5 letters: not enough
      t.ok(!S.available('lettersAudio'));
      globalThis.HF_AUDIO_CLIPS = { C: 'x', H: 'x', K: 'x', L: 'x', Q: 'x', R: 'x', version: 2 }; // non-letter keys ignored
      t.eq(S.get('lettersAudio').items.map(x => x.clip), ['C', 'H', 'K', 'L', 'Q', 'R']);
      // the file the core ships
      const file = ROOT + '/assets/audio/letters.js';
      if (fs.existsSync(file)) {
        const ctx = { window: {} };
        vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
        globalThis.HF_AUDIO_CLIPS = ctx.window.HF_AUDIO_CLIPS || ctx.HF_AUDIO_CLIPS;
        const la = S.get('lettersAudio');
        t.ok(la && la.items.length >= 6, 'shipped letters.js gives a lettersAudio set');
        t.ok(la.items.every(it => typeof globalThis.HF_AUDIO_CLIPS[it.clip] === 'string'), 'clip ids are the file\'s keys');
      }
    } finally {
      if (had) globalThis.HF_AUDIO_CLIPS = saved; else delete globalThis.HF_AUDIO_CLIPS;
    }
  });

  await t.test('sets: names and cells for texts', () => {
    t.eq(S.name({ cell: 0 }), 'top left');
    t.eq(S.name({ cell: 3 }), 'middle right');
    t.eq(S.name({ text: 'Tue' }), 'Tue');
    t.eq(S.name({ shape: 'tri' }), 'triangle');
    t.eq(S.name({ tone: 2 }), 'tone 3');
    t.eq(S.name({ glyph: 'glyphsA', index: 1 }), null);
    t.eq(S.cellRC(4), [2, 2]);
    t.eq(S.cellRC(7), [1, 0]);
    t.eq(S.key({ what: { text: '7' }, where: { cell: 3 } }), 'sw:text:7@cell:3');
  });
}
