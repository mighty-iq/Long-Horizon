/* Long-Horizon — Study mode (route 'study'). Browser only, ES2019, MIT. Owner: P2 (Lab UI). Notes: docs/dev/lab-ui-notes.md.
   PLAN §6 "Study mode", research/04 §17–18, SPEC §3.5. Everything is stored as events (HF.store.mutate):
     study-enrol { template, consentAt, adult: true }      after the plain-language consent (adults only)
     study-draw  { arm, salt, commitment, template, arms } solo random draw after Baseline 2 (HF.study.draw with a fresh
                                                           HF.rng.newSeed()); the commitment code is shown to post in the
                                                           Chimera Discord before session 1; the salt is revealed in the
                                                           export (and here) once a Post-test exists
     study-code  { code, template, arm }                   coordinator code (HF.study.decodeCode), after Baseline 2
     study-expect { when: 'B2'|'POST', values }            expectations (asked in the visit check-in; here if missed)
     study-blind { guess }                                 blinding guess at Post (asked in the close-out; here if missed)
     study-posted { commitment }                           SC-04: after a solo draw only the commitment code is shown;
                                                           the programme appears once the participant says the code is
                                                           posted or noted (or once a Post-test exists)
     study-leave {}                                        "Leave the study" (confirm dialog): HF.engine.derive sets
                                                           study.left, so training follows the chosen mode again; the
                                                           screen then shows the date left and the study file only
   Screen: templates with what each programme does (SC-01: one neutral activity line per arm, the same style for every
   arm, nothing about which arm is the comparison); consent incl. HF.study.limitations (codes are decodable from the
   open source); assignment (draw or code); the commitment copy box; questionnaires still to answer; the export bundle
   (HF.ui.lab.exportPanel → HF.lab.exportBundle, JSON + CSV, copy box + download); leaving the study; coordinator tools
   (allocation codes). The app never compares arms; results are pooled outside the app (tools/analysis).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var DISCORD = 'https://discord.gg/chmr';

  // SC-01 (PLAN §6): participants see one neutral activity line per arm, in the same style for every arm — what you do,
  // never which arm is expected to work or which is the comparison. The schedule (sessions or days) is in TEMPLATE_TEXT
  // because it is the same for every arm. Scientific framing (active control, doses) is for coordinators (the guide).
  var PLAN_TEXT = {
    varied: 'N-back and relation tasks: notice when an item matches the one a few steps back, and spot relations between items.',
    search: 'Visual search: say whether a T is among rotated Ls.',
    labonly: 'Lab visits only: no training sessions during the study; the full programme opens afterwards.',
    'cao-exec': 'Days n-back: days of the week appear one by one; press when a day is the day after the one n back.',
    'cao-trad': 'Days n-back: days of the week appear one by one; press when a day is the same as the one n back.',
    'cao-search': 'Visual search: say whether a T is among rotated Ls.',
    'wang-steps': 'Equal Steps: numbers appear one by one; press when two steps are equal.',
    'wang-search': 'Visual search: say whether a T is among rotated Ls.'
  };
  var TEMPLATE_TEXT = {
    'default': 'Compares two attention-and-memory programmes over 20 sessions.',
    cao: 'A replication of Cao et al. (2026): compares two n-back programmes over 6 sessions, with an optional third programme.',
    wang: 'A replication of Wang et al. (2025): compares two attention-and-memory programmes over 30 days.'
  };

  function C() { return ui.c; }
  function h(tag, attrs, kids) { return C().h(tag, attrs, kids); }
  function btn(label, o) { return C().button(label, o || {}); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function uid(p) { return HF.util && HF.util.id ? HF.util.id(p) : p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function dateText(ms) {
    if (typeof ms !== 'number') return '';
    try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return String(new Date(ms)); }
  }
  function addEvent(ev) {
    ev.id = uid('ev');
    ev.t = Date.now();
    HF.store.mutate(function (r) { r.events = r.events || []; r.events.push(ev); });
    HF.store.flush();
    return ev;
  }
  function labState(recs) {
    var sched = HF.lab.schedule(recs, HF.store.derived, Date.now());
    var b2 = null, post = null;
    (sched.plan || []).forEach(function (e) { if (e.kind === 'B2') b2 = e; if (e.kind === 'POST') post = e; });
    // Baselines are taken before any training: once training has started without them (schedule path 'no-baseline',
    // or Baseline 2 missed), this browser can no longer supply them, so enrolling here would only pause training.
    var b1 = null; (sched.plan || []).forEach(function (e) { if (e.kind === 'B1') b1 = e; });
    var noBaselines = sched.path === 'no-baseline' || !!(b1 && (b1.status === 'skipped' || b1.status === 'partial')) || !!(b2 && (b2.status === 'missed' || b2.status === 'skipped' || b2.status === 'partial'));
    return { sched: sched, noBaselines: noBaselines, b2done: !!(b2 && b2.status === 'done'), postDone: (recs.labVisits || []).some(function (v) { return v && v.kind === 'POST' && Object.keys(v.tests || {}).length; }) };
  }

  var S = { root: null };

  function rerender() {
    if (!S.root) return;
    var rootEl = S.root;
    clear(rootEl);
    render(rootEl, S.params || {});
  }

  /* ------------------------------------------------------------ sections */
  function templatesBlock(selected, onPick) {
    var T = HF.study.templates, order = HF.study.TEMPLATE_ORDER || Object.keys(T);
    var seg = C().segmented({ legend: 'Which study?', name: 'st-template', value: selected,
      hint: 'Your coordinator tells you which one. On your own, the first is the usual choice.',
      options: order.map(function (id) { return { value: id, label: T[id].title }; }), onChange: onPick });
    var arms = h('div', { 'class': 'hf-st-arms' });
    function paint(id) {
      clear(arms);
      var t = T[id];
      arms.appendChild(h('p', { 'class': 'hf-soft' }, [TEMPLATE_TEXT[id] || '']));
      t.arms.forEach(function (a) {
        arms.appendChild(h('div', { 'class': 'hf-st-arm', 'data-arm': a.id }, [
          h('span', { 'class': 'hf-st-arm__name' }, [a.label + (a.optional ? ' (optional)' : '')]),
          h('span', { 'class': 'hf-st-arm__what' }, [PLAN_TEXT[a.id] || a.description])
        ]));
      });
      arms.appendChild(h('p', { 'class': 'hf-small hf-muted' }, ['Inside the app every programme is shown the same way, as "Programme A, B or C", with the same screens, about the same session length, and the same goals and badges. Nobody is blind to what they practise; the Post-test asks for your guess about the programmes only to compare what people expected.']));
    }
    paint(selected);
    return { el: h('div', { 'class': 'hf-stack' }, [seg, arms]), paint: paint };
  }

  function consentBlock(templateId, onEnrol) {
    var adult = h('input', { type: 'checkbox', id: 'st-adult' });
    var agree = h('input', { type: 'checkbox', id: 'st-agree' });
    var go = btn('Join the study', { variant: 'primary', disabled: true });
    function upd() { go.disabled = !(adult.checked && agree.checked); }
    adult.addEventListener('change', upd);
    agree.addEventListener('change', upd);
    go.addEventListener('click', function () { if (!go.disabled) onEnrol(); });
    var lim = (HF.study.limitations || []).map(function (s) { return h('li', null, [s]); });
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-consent-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'st-consent-h' }, ['Before you join']),
      h('ul', { 'class': 'hf-st-consent' }, [
        h('li', null, ['Adults only: you must be 18 or older.']),
        h('li', null, ['What is collected: your Lab results, your training log and your answers to a few questions. Everything stays on this device.']),
        h('li', null, ['Sharing is your choice: at the end you export a file and send it to the coordinator yourself. It carries a random ID, never your name or e-mail.']),
        h('li', null, ['You can stop at any time without giving a reason; just stop, or tell your coordinator.']),
        h('li', null, ['This is a community experiment, not medical care. Long-Horizon is not a medical device and makes no health claims; neither programme is expected to raise IQ.'])
      ].concat(lim)),
      h('div', { 'class': 'hf-lv__check' }, [
        h('label', { 'for': 'st-adult' }, [adult, h('span', null, ['I am 18 or older.'])]),
        h('label', { 'for': 'st-agree' }, [agree, h('span', null, ['I have read the points above and want to take part.'])])
      ]),
      h('div', { 'class': 'hf-actions' }, [go])
    ]);
  }

  function trainedBlock() {
    return h('section', { 'class': 'hf-section hf-st-trained', 'aria-labelledby': 'st-trained-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'st-trained-h' }, ['Before you join']),
      C().notice({ tone: 'info', title: 'This browser has training already',
        text: 'A study starts everyone from the same point: Baseline 1 and Baseline 2 come before any training. Training has already started here, so this browser cannot take part. To join, use a browser or device where Long-Horizon has not been used yet, and ask your coordinator first. Your training here carries on as before.' })
    ]);
  }

  function assignmentBlock(st, ls) {
    var T = HF.study.templates[st.template] || HF.study.templates['default'];
    var sec = h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-assign-h' }, [h('h2', { 'class': 'hf-h2', id: 'st-assign-h' }, ['Your programme'])]);
    if (!ls.b2done && ls.noBaselines) {
      sec.appendChild(C().notice({ tone: 'info', title: 'The baselines can no longer be taken here',
        text: 'Training started before Baseline 1 and Baseline 2 were both done, so this browser cannot supply the baselines a study needs. Ask your coordinator how to go on.' }));
      return sec;
    }
    if (!ls.b2done) {
      sec.appendChild(C().notice({ tone: 'info', title: 'After Baseline 2', text: 'Your programme is decided once Baseline 1 and Baseline 2 are done, so that knowing it cannot colour your baselines. Do both baselines first (the Lab page shows when).',
        action: btn('Open the Lab', { variant: 'secondary', go: 'lab' }) }));
      return sec;
    }
    // solo draw
    var optional = T.arms.filter(function (a) { return a.optional; });
    var chosenArms = T.defaultArms.slice();
    var drawBox = h('div', { 'class': 'hf-stack' }, [
      h('h3', { 'class': 'hf-h3' }, ['On your own: a random draw']),
      h('p', { 'class': 'hf-soft' }, ['The app draws your programme at random and first shows only a commitment code. Post the code in the Chimera Discord before session 1 (or note it somewhere others can see it later); then the app shows your programme. After the Post-test, your export reveals the secret behind the code, so anyone can check that the programme you followed is the one behind the code you posted.'])
    ]);
    optional.forEach(function (a) {
      drawBox.appendChild(C().toggle({ label: 'Include ' + a.label + ' in the draw', hint: PLAN_TEXT[a.id] || a.description, checked: false, onChange: function (on) {
        var i = chosenArms.indexOf(a.id);
        if (on && i < 0) chosenArms.push(a.id);
        if (!on && i >= 0) chosenArms.splice(i, 1);
      } }));
    });
    var drawBtn = btn('Draw my programme', { variant: 'primary' });
    drawBtn.addEventListener('click', function () {
      HF.dom.confirm('The draw happens once. Your commitment code appears next; your programme is shown after you have posted or noted the code.', { title: 'Draw now?', ok: 'Draw', cancel: 'Not yet' }).then(function (yes) {
        if (!yes) return;
        var seed = HF.rng && HF.rng.newSeed ? HF.rng.newSeed() : String(Date.now()) + Math.random();
        var d = HF.study.draw(seed, { template: T.id, arms: chosenArms });
        addEvent({ type: 'study-draw', arm: d.arm, salt: d.salt, commitment: d.commitment, template: d.template, arms: d.arms });
        rerender();
      });
    });
    drawBox.appendChild(h('div', { 'class': 'hf-actions' }, [drawBtn]));
    sec.appendChild(drawBox);
    // coordinator code
    var input = h('input', { type: 'text', 'class': 'hf-input hf-st-codein', id: 'st-code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', placeholder: 'ABC-123' });
    var msg = h('div', { 'aria-live': 'polite' });
    var useBtn = btn('Use this code', { variant: 'secondary' });
    function useCode() {
      clear(msg);
      var res = HF.study.decodeCode(input.value);
      if (!res.ok) {
        var why = { format: 'A code has six letters or digits, like ABC-123.', checksum: 'One character looks wrong; please check the code.', version: 'This code is for another version of Long-Horizon.', 'unknown-arm': 'This code does not name a programme.' };
        msg.appendChild(C().notice({ tone: 'warn', slim: true, text: why[res.error] || 'This code is not valid.' }));
        return;
      }
      addEvent({ type: 'study-code', code: res.code, template: res.template, arm: res.arm });
      rerender();
    }
    useBtn.addEventListener('click', useCode);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useCode(); } });
    sec.appendChild(h('div', { 'class': 'hf-stack' }, [
      h('h3', { 'class': 'hf-h3' }, ['With a coordinator: enter your code']),
      h('p', { 'class': 'hf-soft' }, ['Coordinators give out codes after you show them a finished Baseline 2. The code tells the app your programme.']),
      C().field({ label: 'Coordinator code', control: input }),
      h('div', { 'class': 'hf-actions' }, [useBtn]), msg
    ]));
    return sec;
  }

  function programmeBlock(st, ls) {
    var info = HF.study.armInfo(st.arm);
    var arm = info ? info.arm : null;
    var kids = [h('h2', { 'class': 'hf-h2', id: 'st-prog-h' }, ['Your programme'])];
    // SC-04: after a solo draw the commitment code comes first; the programme is shown once the participant says the
    // code is posted or noted (a 'study-posted' event), so the code goes out before anyone sees the programme
    if (st.method === 'draw' && st.draw && !st.postedAt && !ls.postDone) {
      kids.push(h('p', { 'class': 'hf-soft' }, ['Your programme has been drawn. Before you see it, post this commitment code, or note it somewhere others can see it later. After the Post-test, your export reveals the secret behind the code, which shows that the programme you followed is the one behind the code you posted.']));
      kids.push(C().copyBox({ label: 'Your commitment code', text: st.draw.commitment, rows: 2,
        hint: 'Post this code in the Chimera Discord before session 1, for example in the study thread.' }));
      kids.push(h('div', { 'class': 'hf-actions' }, [C().link('Open the Chimera Discord', DISCORD, { variant: 'secondary' })]));
      var posted = btn('I have posted or noted the code', { variant: 'primary' });
      posted.addEventListener('click', function () { addEvent({ type: 'study-posted', commitment: st.draw.commitment }); rerender(); });
      kids.push(h('div', { 'class': 'hf-actions', 'data-st-posted': '' }, [posted]));
      return h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-prog-h' }, kids);
    }
    kids.push(C().card({ title: (arm ? arm.label : st.arm), sub: HF.study.templates[st.template] ? HF.study.templates[st.template].title : '', level: 3,
      body: [h('p', null, [arm ? (PLAN_TEXT[arm.id] || arm.description) : '']),
        h('p', { 'class': 'hf-small hf-muted' }, [arm && arm.kind === 'lab-only' ? 'Keep doing the Lab visits on time; training opens when the study ends.' : 'Your training sessions on the Today screen follow this programme.'])] }));
    if (st.method === 'draw' && st.draw) {
      kids.push(C().copyBox({ label: 'Your commitment code', text: st.draw.commitment, rows: 2,
        hint: 'Post this code in the Chimera Discord before session 1, for example in the study thread. After the Post-test, your export reveals the secret behind it, which shows that the programme you followed is the one behind the code you posted.' }));
      kids.push(h('div', { 'class': 'hf-actions' }, [C().link('Open the Chimera Discord', DISCORD, { variant: 'secondary' })]));
      kids.push(h('p', { 'class': 'hf-small hf-muted', 'data-verified': st.verified ? 'yes' : 'no' }, [st.verified ? 'Checked: the code matches your draw.' : 'The code could not be checked against your draw.']));
      if (ls.postDone) {
        kids.push(C().details('The secret behind your code (revealed after the Post-test)', h('div', { 'class': 'hf-stack hf-stack--sm' }, [
          h('p', { 'class': 'hf-small' }, ['Programme id: ', h('code', null, [st.draw.arm])]),
          h('p', { 'class': 'hf-small' }, ['Secret (salt): ', h('code', { 'class': 'hf-st-code' }, [st.draw.salt])]),
          h('p', { 'class': 'hf-small hf-muted' }, ['Anyone can check: the SHA-256 of "' + st.draw.arm + ':' + '" followed by the secret equals the posted code. Your export file includes it.'])
        ])));
      }
    } else if (st.method === 'code' && st.code) {
      kids.push(h('p', { 'class': 'hf-soft' }, ['Set by your coordinator’s code ', h('code', { 'class': 'hf-st-code' }, [st.code.code]), ' on ' + dateText(st.code.t) + '.']));
    }
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-prog-h' }, kids);
  }

  function questionsBlock(st, ls) {
    var need = [];
    var hasB2 = st.expect.some(function (e) { return e.when === 'B2'; }), hasPost = st.expect.some(function (e) { return e.when === 'POST'; });
    if (ls.b2done && !hasB2) need.push('B2');
    if (ls.postDone && !hasPost) need.push('POST');
    var needBlind = ls.postDone && !st.blind.length && st.armKind && st.armKind !== 'lab-only';
    if (!need.length && !needBlind) return null;
    var sec = h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-q-h' }, [h('h2', { 'class': 'hf-h2', id: 'st-q-h' }, ['Questions still to answer'])]);
    var q = HF.study.questions;
    need.forEach(function (when) {
      var vals = {};
      var kids = [h('h3', { 'class': 'hf-h3' }, [(when === 'B2' ? 'Baseline 2' : 'Post-test') + ': expectations']), h('p', { 'class': 'hf-soft' }, [q.expect.prompt])];
      q.expect.items.forEach(function (it) {
        var opts = [];
        for (var i = q.expect.scale.min; i <= q.expect.scale.max; i++) opts.push({ value: i, label: String(i) });
        var seg = C().segmented({ legend: it.text, name: 'st-ex-' + when + '-' + it.id, options: opts, onChange: function (v) { vals[it.id] = +v; } });
        seg.classList.add('hf-lv__scale');
        kids.push(seg);
        kids.push(h('div', { 'class': 'hf-lv__ends', 'aria-hidden': 'true' }, [h('span', null, [q.expect.scale.min + ' = ' + q.expect.scale.minLabel]), h('span', null, [q.expect.scale.max + ' = ' + q.expect.scale.maxLabel])]));
      });
      var save = btn('Save answers', { variant: 'secondary' });
      save.addEventListener('click', function () { addEvent({ type: 'study-expect', when: when, values: vals, late: true }); rerender(); });
      kids.push(h('div', { 'class': 'hf-actions' }, [save]));
      sec.appendChild(h('div', { 'class': 'hf-stack' }, kids));
    });
    if (needBlind) {
      var guess = null;
      var seg = C().segmented({ legend: q.blind.prompt, name: 'st-blind', options: HF.study.blindOptions(st.template).map(function (o) { return { value: o.id, label: o.label }; }), onChange: function (v) { guess = v; } });
      var save2 = btn('Save my guess', { variant: 'secondary' });
      save2.addEventListener('click', function () { if (!guess) return; addEvent({ type: 'study-blind', guess: guess, late: true }); rerender(); });
      sec.appendChild(h('div', { 'class': 'hf-stack' }, [seg, h('div', { 'class': 'hf-actions' }, [save2])]));
    }
    return sec;
  }

  /** QA (Phase 4): a participant can leave. Writes { type: 'study-leave' }; HF.engine.derive then sets study.left and
      the planner follows the chosen training style again. Records stay (the export shows the date left). */
  function leaveStudyBlock() {
    var go = btn('Leave the study', { variant: 'quiet' });
    go.addEventListener('click', function () {
      HF.dom.confirm('Your study programme ends here: from now on your training follows the training style you choose in Settings, as before you joined, and the Lab visits no longer ask the study questions. What was recorded so far stays on this device, and your study file keeps it with the date you left, so you can still send it to your coordinator. You cannot rejoin this study from this browser.',
        { title: 'Leave the study?', ok: 'Leave the study', cancel: 'Stay in the study', danger: true }).then(function (yes) {
        if (!yes) return;
        addEvent({ type: 'study-leave' });
        rerender();
      });
    });
    return h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-leave-h' }, [
      h('h2', { 'class': 'hf-h2', id: 'st-leave-h' }, ['Leaving the study']),
      h('p', { 'class': 'hf-soft' }, ['You can stop at any time without giving a reason. Leaving ends your study programme on this device; your training then follows the training style you choose, as before you joined.']),
      h('div', { 'class': 'hf-actions' }, [go])
    ]);
  }

  function coordinatorBlock() {
    var T = HF.study.templates, order = HF.study.TEMPLATE_ORDER || Object.keys(T);
    var tpl = order[0];
    var seedIn = h('input', { type: 'text', 'class': 'hf-input', id: 'st-alloc-seed', autocomplete: 'off', spellcheck: 'false', placeholder: 'a secret phrase only you know' });
    var nIn = h('input', { type: 'number', 'class': 'hf-input', id: 'st-alloc-n', min: '2', max: '400', value: '24', inputmode: 'numeric' });
    var out = h('div');
    var make = btn('Make codes', { variant: 'secondary' });
    make.addEventListener('click', function () {
      clear(out);
      var seed = seedIn.value.trim();
      if (seed.length < 8) { out.appendChild(C().notice({ tone: 'warn', slim: true, text: 'Use a secret phrase of at least 8 characters, and keep it private.' })); return; }
      var n = Math.max(2, Math.min(400, parseInt(nIn.value, 10) || 24));
      var list = HF.study.allocation({ seed: seed, template: tpl, n: n });
      var lines = ['serial,code,programme'].concat(list.map(function (x) { var a = HF.study.armInfo(x.arm); return x.serial + ',' + x.code + ',' + (a ? a.arm.label : x.arm); }));
      out.appendChild(C().copyBox({ label: 'Allocation list (keep it private)', text: lines.join('\n'), rows: 6, download: 'long-horizon-allocation-' + tpl + '.csv', mime: 'text/csv',
        hint: 'Give codes in serial order, each only after the participant shows a finished Baseline 2.' }));
    });
    var seg = C().segmented({ legend: 'Study', name: 'st-alloc-tpl', value: tpl, options: order.map(function (id) { return { value: id, label: T[id].title }; }), onChange: function (v) { tpl = v; } });
    return C().details('For coordinators: make allocation codes', h('div', { 'class': 'hf-stack' }, [
      h('p', { 'class': 'hf-small hf-soft' }, ['Codes come in shuffled blocks, so the groups stay balanced. Remember: anyone who reads Long-Horizon’s open source can decode a code, so hand them out only after a finished Baseline 2.']),
      seg, C().field({ label: 'Secret phrase', control: seedIn }), C().field({ label: 'How many participants', control: nIn }),
      h('div', { 'class': 'hf-actions' }, [make]), out
    ]));
  }

  /* ------------------------------------------------------------ render */
  function render(rootEl, params) {
    S.root = rootEl;
    S.params = params || {};
    var recs = HF.store.records;
    var st = HF.study.state(recs);
    var ls = labState(recs);
    var page = h('div', { 'class': 'hf-page hf-study' });
    page.appendChild(h('header', { 'class': 'hf-page__head' }, [
      h('h1', { 'class': 'hf-h1' }, ['Study mode']),
      h('p', { 'class': 'hf-lead' }, ['Community experiments that compare two programmes. Optional, adults only. Your data stay on your device until you choose to send your export file.'])
    ]));
    page.appendChild(h('p', { 'class': 'hf-soft', 'data-chimera': '' }, [
      'Community studies are organised in the Chimera community on Discord, where Long-Horizon was built: ',
      C().link('discord.gg/chmr', DISCORD, { variant: 'plain' }), '.'
    ]));
    var back = btn('Back to the Lab', { variant: 'quiet', icon: 'chev-left', go: 'lab' });
    page.appendChild(h('div', { 'class': 'hf-actions' }, [back]));

    if (!st) {
      page.appendChild(h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-how-h' }, [
        h('h2', { 'class': 'hf-h2', id: 'st-how-h' }, ['How a study works']),
        h('ol', { 'class': 'hf-st-consent' }, [
          h('li', null, ['Baseline 1 and Baseline 2 in the Lab, 2–7 days apart, before any training.']),
          h('li', null, ['Then your programme is decided at random: by a draw in the app, or by a code from a coordinator.']),
          h('li', null, ['You follow that programme, then take the Post-test and, 8–12 weeks later, the Follow-up.']),
          h('li', null, ['You export your file and send it to the coordinator, who pools everyone’s files (the app never compares groups).'])
        ]),
        h('p', { 'class': 'hf-small hf-muted' }, ['In plain numbers: about 20–30 people per programme can test effects on similar tasks; showing that effects on reasoning are smaller than a small effect needs about 70–100 per programme.'])
      ]));
      var selected = S.params.template && HF.study.templates[S.params.template] ? S.params.template : 'default';
      var tb = templatesBlock(selected, function (v) { selected = v; tb.paint(v); });
      page.appendChild(h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-tpl-h' }, [h('h2', { 'class': 'hf-h2', id: 'st-tpl-h' }, ['The studies']), tb.el]));
      if (ls.noBaselines) page.appendChild(trainedBlock());
      else page.appendChild(consentBlock(selected, function () {
        addEvent({ type: 'study-enrol', template: selected, consentAt: Date.now(), adult: true });
        rerender();
      }));
    } else {
      var T = HF.study.templates[st.template] || {};
      if (st.left) {
        page.appendChild(C().notice({ tone: 'info', title: 'You left the study', text: 'You left ' + (T.title || st.template) + ' on ' + dateText(st.left) + '. Your training follows the training style you choose in Settings, as before you joined. What was recorded until then stays on this device, and your study file below keeps it with the date you left.' }));
      } else {
        page.appendChild(C().notice({ tone: 'good', title: 'You joined: ' + (T.title || st.template), text: 'Joined on ' + dateText(st.enrolledAt) + '. ' + (st.arm ? '' : (ls.b2done ? 'Your programme can be set now.' : (ls.noBaselines ? '' : 'Next: Baseline 1 and Baseline 2 in the Lab.'))) }));
        if (st.arm) page.appendChild(programmeBlock(st, ls));
        else page.appendChild(assignmentBlock(st, ls));
        var qb = questionsBlock(st, ls);
        if (qb) page.appendChild(qb);
      }
      var slot = h('div');
      page.appendChild(h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-exp-h' }, [
        h('h2', { 'class': 'hf-h2', id: 'st-exp-h' }, ['Your study file']),
        h('p', { 'class': 'hf-soft' }, [st.left ? 'Your coordinator may still ask for this file. It includes your Lab visits, your training log and your answers, and the date you left.' : 'Send this file to your coordinator after the Post-test, and again after the Follow-up. It includes your Lab visits, your training log and your answers.']),
        slot
      ]));
      ui.lab.exportPanel(slot, { study: true });
      page.appendChild(h('section', { 'class': 'hf-section', 'aria-labelledby': 'st-lim-h' }, [
        h('h2', { 'class': 'hf-h2', id: 'st-lim-h' }, ['Limits of this design']),
        h('ul', { 'class': 'hf-st-consent' }, (HF.study.limitations || []).map(function (s) { return h('li', null, [s]); }))
      ]));
      if (!st.left) page.appendChild(leaveStudyBlock());
    }
    page.appendChild(h('section', { 'class': 'hf-section' }, [coordinatorBlock()]));
    rootEl.appendChild(page);
  }

  function leave() { S.root = null; }

  var screen = { title: 'Study mode', render: render, leave: leave };
  ui.study = { PLAN_TEXT: PLAN_TEXT, TEMPLATE_TEXT: TEMPLATE_TEXT };
  ui.screens = ui.screens || {};
  ui.screens.study = screen;
  if (HF.router && typeof HF.router.register === 'function') HF.router.register('study', screen);
})(typeof window !== 'undefined' ? window : globalThis);
