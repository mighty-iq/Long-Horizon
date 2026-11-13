// Study mode: SHA-256 test vectors, commitment draw/verify, coordinator codes with check character, allocation,
// questions as data, study state from events.
import { createHash } from 'node:crypto';
import { HF, load } from './load.mjs';

load('js/lab/study.js');

const nodeSha = s => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

export default async function (t) {
  const S = HF.study;

  await t.test('SHA-256 test vectors (FIPS 180-4)', () => {
    t.eq(S.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    t.eq(S.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    t.eq(S.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    t.eq(S.sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  await t.test('SHA-256 agrees with node:crypto on padding edges and UTF-8 text', () => {
    const samples = ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'varied:0123abcd',
      'Programme A – ü ß 漢字 🙂', '\u0000ÿ', 'x'.repeat(1000)];
    for (let k = 0; k < 200; k++) samples.push(Array.from({ length: k }, (_, j) => String.fromCharCode(32 + ((k * 7 + j * 13) % 95))).join(''));
    for (const s of samples) t.eq(S.sha256(s), nodeSha(s), JSON.stringify(s.slice(0, 20)));
  });

  await t.test('draw: deterministic, commitment = sha256(arm:salt), verify, balanced arms', () => {
    const d = S.draw('seed-1'), d2 = S.draw('seed-1');
    t.eq(d, d2);
    t.ok(/^[0-9a-f]{32}$/.test(d.salt), d.salt);
    t.eq(d.commitment, nodeSha(d.arm + ':' + d.salt));
    t.ok(S.verify(d.arm, d.salt, d.commitment)); t.ok(S.verify(d.arm, d.salt, ' ' + d.commitment.toUpperCase() + ' '));
    const other = d.arm === 'varied' ? 'search' : 'varied';
    t.ok(!S.verify(other, d.salt, d.commitment)); t.ok(!S.verify(d.arm, d.salt + '0', d.commitment)); t.ok(!S.verify(null, 'a', 'b'));
    const counts = {};
    for (let k = 0; k < 2000; k++) { const x = S.draw('k' + k); counts[x.arm] = (counts[x.arm] || 0) + 1; }
    t.eq(Object.keys(counts).sort(), ['search', 'varied']);
    t.ok(counts.varied > 900 && counts.varied < 1100, JSON.stringify(counts));
    const three = S.draw('z', { template: 'cao', arms: ['cao-exec', 'cao-trad', 'cao-search'] });
    t.eq([three.template, three.arms.length], ['cao', 3]);
    t.throws(() => S.draw('z', { template: 'wang', arms: ['varied'] }));
    t.eq(S.draw('w', { template: 'wang' }).arms, ['wang-steps', 'wang-search']);
  });

  await t.test('templates: neutral labels, matched descriptions, programmes', () => {
    for (const id of ['default', 'cao', 'wang']) {
      const tpl = S.templates[id];
      t.ok(tpl.framing.includes('attention-and-memory'), id);
      const desc = new Set(tpl.arms.filter(a => a.kind !== 'lab-only').map(a => a.description));
      t.eq(desc.size, 1, id + ': matched descriptions');
      t.ok(tpl.arms.every(a => /^Programme [ABC]$/.test(a.label)), id + ': neutral labels');
      t.ok(tpl.defaultArms.every(a => tpl.arms.some(x => x.id === a && !x.optional)));
    }
    t.eq([S.templates.default.programme.sessions, S.templates.cao.programme.sessions, S.templates.wang.programme.sessions], [20, 6, 30]);
    t.eq(S.templates.cao.arms.find(a => a.id === 'cao-trad').plan.tracks, ['nback.plain']);
    t.eq(S.armInfo('wang-search').template, 'wang'); t.eq(S.armInfo('nope'), null);
  });

  await t.test('coordinator codes: round trip for every arm, format, normalisation, different secrets differ', () => {
    const arms = [];
    for (const id of S.TEMPLATE_ORDER) for (const a of S.templates[id].arms) arms.push([id, a.id]);
    const codes = new Set();
    for (const [tpl, arm] of arms) for (let k = 0; k < 300; k++) {
      const c = S.encodeCode(arm, 'P' + k);
      if (!/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/.test(c)) throw new Error('format ' + c);
      const d = S.decodeCode(c);
      if (!d.ok || d.arm !== arm || d.template !== tpl) throw new Error('round trip ' + c + ' ' + JSON.stringify(d));
      codes.add(c);
    }
    t.ok(codes.size > arms.length * 300 * 0.99, 'codes differ between participants: ' + codes.size);
    const c = S.encodeCode('cao-exec', 'P017');
    t.eq(S.decodeCode(c.toLowerCase().replace('-', ' ')).arm, 'cao-exec');
    t.eq(S.encodeCode('cao-exec', 'P017'), c);
    t.eq(S.decodeCode(c.replace(/0/g, 'O').replace(/1/g, 'l')).ok, true, 'O/0 and l/1 are read alike');
    t.eq(S.decodeCode('').error, 'format'); t.eq(S.decodeCode('ABCD-EFGH').error, 'format'); t.eq(S.decodeCode('UUU-UUU').error, 'format');
    t.throws(() => S.encodeCode('no-such-arm', 'x'));
  });

  await t.test('check character catches every single-character error and most adjacent swaps', () => {
    const A = S.CODE_ALPHABET;
    let swaps = 0, swapCaught = 0;
    for (let k = 0; k < 40; k++) {
      const code = S.encodeCode(k % 2 ? 'search' : 'wang-steps', 's' + k).replace('-', '');
      for (let p = 0; p < 6; p++) for (const ch of A) {
        if (ch === code[p]) continue;
        const bad = code.slice(0, p) + ch + code.slice(p + 1);
        if (S.decodeCode(bad).ok) throw new Error('undetected substitution ' + code + ' → ' + bad);
      }
      for (let p = 0; p < 5; p++) {
        if (code[p] === code[p + 1]) continue;
        swaps++;
        const sw = code.slice(0, p) + code[p + 1] + code[p] + code.slice(p + 2);
        if (!S.decodeCode(sw).ok) swapCaught++;
      }
    }
    t.ok(swapCaught / swaps >= 0.9, 'adjacent swaps caught ' + swapCaught + '/' + swaps);
  });

  await t.test('allocation: permuted blocks are balanced and codes decode to the listed arm', () => {
    const list = S.allocation({ seed: 'study-7', template: 'default', n: 40 });
    t.eq(list.length, 40);
    for (let b = 0; b < 10; b++) {
      const blk = list.slice(4 * b, 4 * b + 4).map(x => x.arm);
      t.eq(blk.filter(a => a === 'varied').length, 2, 'block ' + b);
    }
    t.ok(list.every(x => S.decodeCode(x.code).arm === x.arm));
    t.eq(list.map(x => x.serial), Array.from({ length: 40 }, (_, k) => k + 1));
    const three = S.allocation({ seed: 's', template: 'cao', arms: ['cao-exec', 'cao-trad', 'cao-search'], n: 12 });
    for (let b = 0; b < 2; b++) t.eq(three.slice(6 * b, 6 * b + 6).map(x => x.arm).sort(), ['cao-exec', 'cao-exec', 'cao-search', 'cao-search', 'cao-trad', 'cao-trad']);
    t.eq(S.allocation({ seed: 'study-7', template: 'default', n: 40 }), list);
    t.throws(() => S.allocation({ seed: 'x', arms: ['varied', 'search'], blockSize: 3 }));
  });

  await t.test('questions as data, blinding options, stated limitations', () => {
    const q = S.questions;
    t.eq(q.expect.when, ['B2', 'POST']); t.eq(q.expect.items.map(x => x.id), ['memory', 'reasoning', 'everyday']);
    t.eq([q.expect.scale.min, q.expect.scale.max], [0, 10]); t.eq(q.blind.when, ['POST']);
    t.eq(q.expect.event, 'study-expect'); t.eq(q.blind.event, 'study-blind');
    t.eq(S.blindOptions('default'), [{ id: 'varied', label: 'Programme A' }, { id: 'search', label: 'Programme B' }, { id: 'unsure', label: 'I can’t tell' }]);
    t.eq(S.blindOptions('default', ['varied', 'search', 'labonly']).length, 3, 'the Lab-only arm is not a programme to guess');
    t.ok(S.limitations[0].includes('decoded') && S.limitations[0].includes('open source'));
  });

  await t.test('state(records): enrolment, draw verified, a later code wins', () => {
    t.eq(S.state({ events: [] }), null);
    const d = S.draw('st', { template: 'wang' });
    const ev = [{ id: 1, t: 10, type: 'study-enrol', template: 'wang', consentAt: 9 },
      { id: 2, t: 11, type: 'study-draw', arm: d.arm, salt: d.salt, commitment: d.commitment },
      { id: 3, t: 12, type: 'study-expect', when: 'B2', values: { memory: 5, reasoning: 3, everyday: 4 } }];
    let st = S.state({ events: ev });
    t.eq([st.template, st.arm, st.method, st.verified, st.enrolledAt, st.expect.length], ['wang', d.arm, 'draw', true, 9, 1]);
    t.eq(st.armKind, d.arm === 'wang-steps' ? 'training' : 'control');
    st = S.state({ events: ev.concat([{ id: 4, t: 13, type: 'study-code', code: S.encodeCode('cao-trad', 'p1') }]) });
    t.eq([st.template, st.arm, st.method, st.codeOk], ['cao', 'cao-trad', 'code', true]);
    st = S.state({ events: [{ id: 5, t: 1, type: 'study-draw', arm: 'varied', salt: 's', commitment: 'bad' }] });
    t.eq([st.arm, st.verified], ['varied', false]);
  });
}
