/* Long-Horizon — Study mode, pure parts (no DOM, no crypto.subtle). MIT licence.
   PLAN §6 "Study mode", research/04 §17.

   HF.study.templates[id] = { id, title, framing, programme: { sessions, quickBefore|null, unit }, arms: [Arm], defaultArms }
     Arm = { id (unique across templates), label: 'Programme A'|'B'|'C' (neutral), kind: 'training'|'control'|'lab-only',
             optional: bool, description (identical matched text for every arm), plan: { mode, protocol, tracks, minutes?, dose? } }
     default: Long-Horizon Varied (n-back + Relations, Span off) vs adaptive visual search (+ optional Lab-only arm).
     cao:     executive n-back vs traditional n-back on Cao's protocol (6 sessions) (+ optional visual search).
     wang:    Equal Steps on Wang's protocol (30 days) vs adaptive visual search with the same number of blocks.
     Visual-search blocks have 40 displays (~70 s), so control sessions take about as long as training sessions
     (planner estimates, Phase 4: default 17.6 vs 18.4 min, Cao 28.4/30.4 vs 28.2, Wang 6.8 vs 7.1).
     Titles name the study and its length only, and every arm is described the same way, so participant-facing screens
     never say which arm is the control (SC-01, PLAN §6); the scientific framing is for coordinators (guide).
   HF.study.sha256(string) → 64 lowercase hex chars (UTF-8 input; FIPS 180-4; pure JS).
   HF.study.draw(seed, opts?) → { template, arms, arm, salt, commitment }
     opts = { template: 'default'|'cao'|'wang', arms?: [armId…] (default: the template's non-optional arms) }.
     Deterministic for a seed: the app passes a fresh HF.rng.newSeed() (crypto.getRandomValues) and stores the result as a
     'study-draw' event. salt = 32 hex chars; commitment = sha256(arm + ':' + salt). The commitment can be posted (e.g. in
     the Chimera Discord) before session 1; the export reveals the salt later, so anyone can check that the programme
     followed is the one behind the posted code. It cannot show that a draw was not repeated before the code was posted
     (SC-04); the Study screen therefore shows the code first and the programme only after a 'study-posted' event.
   HF.study.verify(arm, salt, commitment) → bool.
   HF.study.encodeCode(armId, secret) → 'XXX-XXX' coordinator code (Crockford base32: 5 payload characters + 1 Luhn mod-32
     check character). Payload = version bit, template, arm index (XOR-masked) and a 20-bit tag derived from `secret`
     (e.g. the participant's serial), so codes for the same arm look different.
   HF.study.decodeCode(code) → { ok: true, template, arm, tag } | { ok: false, error: 'format'|'checksum'|'version'|'unknown-arm' }.
     Case-insensitive; '-' and spaces ignored; O → 0, I/L → 1.
     LIMITATION (also in HF.study.limitations; must appear in the README and the consent text): anyone who reads this open
     source can decode a code, so allocation concealment is procedural only — coordinators issue a code only after the
     participant shows a finished Baseline 2.
   HF.study.allocation({ seed, template, arms?, n, blockSize? }) → [ { serial, arm, code } ] permuted blocks
     (default block size 2 × number of arms: 4 for two arms, 6 for three), for coordinators.
   HF.study.questions = { expect: {…}, blind: {…} } (data; event types study-expect / study-blind, SPEC §3.5);
   HF.study.blindOptions(templateId, armIds?) → [ { id, label } ] incl. 'unsure'.
   HF.study.armInfo(armId) → { template, arm } | null.
   HF.study.state(records) → null | { template, arm, armKind, armLabel, method: 'draw'|'code'|null, enrolledAt, draw, code,
     codeOk, verified (commitment check of the draw), expect: [events], blind: [events], postedAt, left } — the latest of a
     draw and a code wins. postedAt = t of a 'study-posted { commitment }' event for the current draw's commitment (the
     participant confirmed posting or noting the code), else null. left = t of the first 'study-leave' event after the
     latest enrolment, else null (as in HF.engine.derive: a new 'study-enrol' starts afresh); a left study keeps its
     template, arm and answers for the export, but nothing should gate on it any more.
   DEVIATION (SPEC §3.5 event list): adds 'study-posted { commitment }' (SC-04) and reads 'study-leave {}' (QA: leaving a
     study); both are plain events, ignored by older builds.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  /* ---------- SHA-256 ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(input) {
    var bytes = utf8(String(input));
    var len = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hiBits = Math.floor(len / 0x20000000), loBits = (len * 8) >>> 0;
    bytes.push((hiBits >>> 24) & 255, (hiBits >>> 16) & 255, (hiBits >>> 8) & 255, hiBits & 255,
      (loBits >>> 24) & 255, (loBits >>> 16) & 255, (loBits >>> 8) & 255, loBits & 255);
    var Hh = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      var t;
      for (t = 0; t < 16; t++) {
        var p = off + 4 * t;
        W[t] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
      }
      for (t = 16; t < 64; t++) {
        var x = W[t - 15], y = W[t - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = Hh[0], b = Hh[1], c = Hh[2], d = Hh[3], e = Hh[4], f = Hh[5], g = Hh[6], h = Hh[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      Hh[0] = (Hh[0] + a) | 0; Hh[1] = (Hh[1] + b) | 0; Hh[2] = (Hh[2] + c) | 0; Hh[3] = (Hh[3] + d) | 0;
      Hh[4] = (Hh[4] + e) | 0; Hh[5] = (Hh[5] + f) | 0; Hh[6] = (Hh[6] + g) | 0; Hh[7] = (Hh[7] + h) | 0;
    }
    return Hh.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ---------- templates ---------- */
  var FRAMING = 'Two attention-and-memory programmes are being compared.';
  var ARM_TEXT = 'One of the attention-and-memory programmes in this study. Both programmes adapt to you and use about the same session length, the same schedule, screens, debriefs, goals and badges.';
  var LAB_ONLY_TEXT = 'Lab visits only: no training sessions until the study ends, then the full programme.';

  function arm(id, label, kind, plan, optional) {
    return { id: id, label: label, kind: kind, optional: !!optional, plan: plan, description: kind === 'lab-only' ? LAB_ONLY_TEXT : ARM_TEXT };
  }

  var templates = {
    'default': {
      id: 'default', title: 'Long-Horizon study (20 sessions)', framing: FRAMING,
      programme: { sessions: 20, quickBefore: 11, unit: 'session' },
      arms: [
        arm('varied', 'Programme A', 'training', { mode: 'varied', protocol: null, tracks: ['nback.*', 'rel.*'], span: false }),
        arm('search', 'Programme B', 'control', { mode: 'varied', protocol: null, tracks: ['vs.search'], span: false }),
        arm('labonly', 'Programme C', 'lab-only', { mode: null, protocol: null, tracks: [] }, true)
      ],
      defaultArms: ['varied', 'search']
    },
    cao: {
      id: 'cao', title: 'Cao et al. 2026 replication (6 sessions)', framing: FRAMING,
      programme: { sessions: 6, quickBefore: null, unit: 'session', minGapDays: 1 },
      arms: [
        arm('cao-exec', 'Programme A', 'training', { mode: 'protocols', protocol: 'cao', tracks: ['nback.transform'], set: 'days' }),
        arm('cao-trad', 'Programme B', 'training', { mode: 'protocols', protocol: 'cao', tracks: ['nback.plain'], set: 'days', arm: 'traditional' }),
        arm('cao-search', 'Programme C', 'control', { mode: 'protocols', protocol: null, tracks: ['vs.search'], minutes: 30, dose: '20 blocks of 40 searches per session, 6 sessions' }, true)
      ],
      defaultArms: ['cao-exec', 'cao-trad']
    },
    wang: {
      id: 'wang', title: 'Wang et al. 2025 replication (30 days)', framing: FRAMING,
      programme: { sessions: 30, quickBefore: null, unit: 'day' },
      arms: [
        arm('wang-steps', 'Programme A', 'training', { mode: 'protocols', protocol: 'wang', tracks: ['rel.steps'] }),
        arm('wang-search', 'Programme B', 'control', { mode: 'protocols', protocol: null, tracks: ['vs.search'], dose: '5 blocks of 40 searches per day, 30 days' })
      ],
      defaultArms: ['wang-steps', 'wang-search']
    }
  };
  var TEMPLATE_ORDER = ['default', 'cao', 'wang'];

  function armInfo(armId) {
    for (var k = 0; k < TEMPLATE_ORDER.length; k++) {
      var t = templates[TEMPLATE_ORDER[k]];
      for (var j = 0; j < t.arms.length; j++) if (t.arms[j].id === armId) return { template: t, arm: t.arms[j], index: j, tIndex: k };
    }
    return null;
  }

  /* ---------- solo draw with a commitment ---------- */
  function hex32(rng) { return ('00000000' + Math.floor(rng.next() * 4294967296).toString(16)).slice(-8); }

  function draw(seed, opts) {
    opts = opts || {};
    var t = templates[opts.template] || templates['default'];
    var arms = (opts.arms && opts.arms.length ? opts.arms : t.defaultArms).slice();
    arms.forEach(function (a) {
      var info = armInfo(a);
      if (!info || info.template.id !== t.id) throw new Error('HF.study.draw: arm ' + a + ' is not in template ' + t.id);
    });
    // 'holdfast/study/…' seeds keep the working name on purpose: draws, codes and allocations must stay verifiable
    var r = HF.rng.create('holdfast/study/draw/' + String(seed));
    var chosen = r.pick(arms);
    var sr = r.fork('salt');
    var salt = hex32(sr) + hex32(sr) + hex32(sr) + hex32(sr);
    return { template: t.id, arms: arms, arm: chosen, salt: salt, commitment: sha256(chosen + ':' + salt) };
  }

  function verify(armId, salt, commitment) {
    if (typeof armId !== 'string' || typeof salt !== 'string' || typeof commitment !== 'string') return false;
    return sha256(armId + ':' + salt) === commitment.trim().toLowerCase();
  }

  /* ---------- coordinator codes ---------- */
  var ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

  function luhnSum(str, startFactor) {
    var factor = startFactor, sum = 0;
    for (var i = str.length - 1; i >= 0; i--) {
      var addend = factor * ALPHA.indexOf(str.charAt(i));
      factor = factor === 2 ? 1 : 2;
      sum += Math.floor(addend / 32) + (addend % 32);
    }
    return sum;
  }
  function checkChar(payload) { return ALPHA.charAt((32 - (luhnSum(payload, 2) % 32)) % 32); }
  function checkOk(full) { return luhnSum(full, 1) % 32 === 0; }

  function tagOf(secret) { return HF.rng.hash('holdfast/study/code/' + String(secret == null ? '' : secret))[0] & 0xFFFFF; }
  function maskOf(tag) { return (tag ^ (tag >>> 5) ^ (tag >>> 11) ^ (tag >>> 17)) & 3; }

  function encodeCode(armId, secret) {
    var info = armInfo(armId);
    if (!info) throw new Error('HF.study.encodeCode: unknown arm ' + armId);
    var tag = tagOf(secret);
    var v = (1 << 24) + (info.tIndex << 22) + (((info.index ^ maskOf(tag)) & 3) << 20) + tag;
    var payload = '';
    for (var k = 4; k >= 0; k--) payload += ALPHA.charAt(Math.floor(v / Math.pow(32, k)) % 32);
    var full = payload + checkChar(payload);
    return full.slice(0, 3) + '-' + full.slice(3);
  }

  function normalize(code) {
    return String(code == null ? '' : code).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  }

  function decodeCode(code) {
    var s = normalize(code);
    if (s.length !== 6) return { ok: false, error: 'format' };
    for (var i = 0; i < s.length; i++) if (ALPHA.indexOf(s.charAt(i)) < 0) return { ok: false, error: 'format' };
    if (!checkOk(s)) return { ok: false, error: 'checksum' };
    var v = 0;
    for (var k = 0; k < 5; k++) v = v * 32 + ALPHA.indexOf(s.charAt(k));
    if (Math.floor(v / (1 << 24)) !== 1) return { ok: false, error: 'version' };
    var tIndex = (v >>> 22) & 3, armBits = (v >>> 20) & 3, tag = v & 0xFFFFF;
    var t = templates[TEMPLATE_ORDER[tIndex]];
    var a = t && t.arms[armBits ^ maskOf(tag)];
    if (!a) return { ok: false, error: 'unknown-arm' };
    return { ok: true, template: t.id, arm: a.id, tag: tag, code: s.slice(0, 3) + '-' + s.slice(3) };
  }

  function allocation(opts) {
    opts = opts || {};
    var t = templates[opts.template] || templates['default'];
    var arms = (opts.arms && opts.arms.length ? opts.arms : t.defaultArms).slice();
    var size = opts.blockSize || 2 * arms.length;
    if (size % arms.length) throw new Error('HF.study.allocation: block size must be a multiple of the number of arms');
    var r = HF.rng.create('holdfast/study/alloc/' + String(opts.seed));
    var out = [], n = opts.n || size;
    while (out.length < n) {
      var block = [];
      for (var j = 0; j < size; j++) block.push(arms[j % arms.length]);
      r.shuffle(block).forEach(function (a) {
        if (out.length < n) {
          var serial = out.length + 1;
          out.push({ serial: serial, arm: a, code: encodeCode(a, String(opts.seed) + '/' + serial) });
        }
      });
    }
    return out;
  }

  /* ---------- questions (data) ---------- */
  var questions = {
    expect: {
      id: 'expect', event: 'study-expect', when: ['B2', 'POST'],
      prompt: 'How much do you expect your results to improve…',
      scale: { min: 0, max: 10, minLabel: 'not at all', maxLabel: 'a great deal' },
      items: [
        { id: 'memory', text: '…on the memory tests?' },
        { id: 'reasoning', text: '…on the reasoning puzzles?' },
        { id: 'everyday', text: '…in everyday concentration?' }
      ]
    },
    blind: {
      id: 'blind', event: 'study-blind', when: ['POST'],
      prompt: 'Which programme do you think was designed to train working memory?',
      unsure: { id: 'unsure', label: 'I can’t tell' }
    }
  };

  function blindOptions(templateId, armIds) {
    var t = templates[templateId] || templates['default'];
    var ids = armIds && armIds.length ? armIds : t.defaultArms;
    var opts = t.arms.filter(function (a) { return ids.indexOf(a.id) >= 0 && a.kind !== 'lab-only'; })
      .map(function (a) { return { id: a.id, label: a.label }; });
    opts.push({ id: questions.blind.unsure.id, label: questions.blind.unsure.label });
    return opts;
  }

  /** study status from records.events (SPEC §3.5): enrolment, the latest draw or code, questionnaire answers */
  function state(records) {
    var ev = ((records && records.events) || []).filter(function (e) { return e && typeof e.type === 'string'; })
      .slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    var enrol = null, drawEv = null, codeEv = null, leaveEv = null, expect = [], blind = [], posted = [];
    ev.forEach(function (e) {
      if (e.type === 'study-enrol') { enrol = e; leaveEv = null; }
      else if (e.type === 'study-draw') drawEv = e;
      else if (e.type === 'study-code') codeEv = e;
      else if (e.type === 'study-expect') expect.push(e);
      else if (e.type === 'study-blind') blind.push(e);
      else if (e.type === 'study-posted') posted.push(e);
      else if (e.type === 'study-leave') { if (!leaveEv && (enrol || drawEv || codeEv)) leaveEv = e; }
    });
    if (!enrol && !drawEv && !codeEv) return null;
    var template = enrol && templates[enrol.template] ? enrol.template : 'default', arm = null, method = null, decoded = null;
    if (codeEv) decoded = decodeCode(codeEv.code);
    var useCode = decoded && decoded.ok && (!drawEv || (codeEv.t || 0) >= (drawEv.t || 0));
    if (useCode) { arm = decoded.arm; template = decoded.template; method = 'code'; }
    else if (drawEv && armInfo(drawEv.arm)) { arm = drawEv.arm; template = armInfo(drawEv.arm).template.id; method = 'draw'; }
    var info = arm ? armInfo(arm) : null;
    var postedEv = null;
    if (drawEv) posted.forEach(function (p) { if (!postedEv && p.commitment === drawEv.commitment) postedEv = p; });
    return {
      template: template, arm: arm, armKind: info ? info.arm.kind : null, armLabel: info ? info.arm.label : null, method: method,
      enrolledAt: enrol ? (enrol.consentAt || enrol.t || null) : null, draw: drawEv, code: codeEv, codeOk: decoded ? decoded.ok : null,
      verified: drawEv ? verify(drawEv.arm, drawEv.salt, drawEv.commitment) : null, expect: expect, blind: blind,
      postedAt: postedEv ? (postedEv.t || null) : null, left: leaveEv ? (leaveEv.t || null) : null
    };
  }

  var limitations = [
    'Coordinator codes can be decoded by anyone who reads Long-Horizon’s open source code. Allocation concealment is therefore procedural, not cryptographic: a coordinator issues a code only after the participant shows a finished Baseline 2.',
    'The commitment code shows that the programme you followed is the one behind the code you posted. It cannot show that a draw was not repeated before the code was posted, and it does not hide your programme from you: nobody in these studies is blind to which programme they do.'
  ];

  var api = {
    templates: templates, TEMPLATE_ORDER: TEMPLATE_ORDER, sha256: sha256, draw: draw, verify: verify,
    encodeCode: encodeCode, decodeCode: decodeCode, allocation: allocation, armInfo: function (id) {
      var x = armInfo(id); return x ? { template: x.template.id, arm: x.arm } : null;
    },
    questions: questions, blindOptions: blindOptions, limitations: limitations, state: state, CODE_ALPHABET: ALPHA
  };
  HF.study = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
