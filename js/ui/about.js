/* Long-Horizon — About screen (js/ui/about.js). DOM only, ES2019, MIT licence. Owner: P3.

   Route `about`. Sections: the Chimera community (HF.ui.chimera.art() + TEXT, a real link to https://discord.gg/chmr
   with target=_blank rel=noopener, and the address printed as text for previews that block new tabs); why the name
   (TAGLINE + WHY_NAME, the Long-Horizon copy of 13 Nov 2026); what Long-Horizon
   can and cannot claim (HF.content.claims from P4 when present, a short fallback otherwise); privacy (everything
   stays on this device); credits; licences (MIT code, CC BY-SA 4.0 texts, NOTICE for the Flite voice); version.

   HF.content.claims may be: a string, an array of strings or { title, text } items, { can: [...], cannot: [...] },
   { intro, sections: [{ title, text | items }] }, a DOM node, a function returning any of these, or an object with
   render(container). Anything else falls back to the built-in text.
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});

  var DISCORD = 'https://discord.gg/chmr';
  function K() { return ui.screenKit; }
  function c() { return ui.c; }
  function h(t, a, k) { return ui.c.h(t, a, k); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  var FALLBACK = {
    can: [
      'Train the tasks it contains: several kinds of n-back, relational integration (Equal Steps and the Relation Grid) and, if you switch it on, complex span. People reliably get better at the tasks they practise.',
      'Run two published training procedures as closely as each paper allows (Cao et al. 2026; Wang et al. 2025), plus the dual n-back of Jaeggi et al. 2008; where a paper is silent, Long-Horizon’s choices are listed in the guide.',
      'Measure in its optional Lab, against your own baseline, whether gains show up on tasks you did not train.'
    ],
    cannot: [
      'Promise to raise your IQ or make you smarter. Studies with active control groups find little or no carry-over from working-memory training to reasoning.',
      'Tell whether a change in your Lab scores is more than ordinary retest noise until enough people have taken part to calibrate the tests.',
      'Diagnose or treat anything. Long-Horizon is a training and self-measurement tool, not a medical device.'
    ]
  };

  // Why the name (Long-Horizon copy, 13 Nov 2026): the AI term, working memory as the human version, the horizon per task
  var TAGLINE = 'Hold more in mind. Keep it straight.';
  var WHY_NAME = 'In AI, a long-horizon task takes many steps in a row, and models are now rated by how long a task they can carry through. Working memory is the same capacity in people: keeping a plan and its pieces intact while you work through it. In n-back the n is your horizon, in Equal Steps it is how far back you compare, and in the relation grid it is how many symbols you relate at once. Training pushes it further, and the Lab measures whether a longer horizon carries over to reasoning.';

  function para(text) { return h('p', null, [String(text)]); }
  function bullet(items) {
    return h('ul', { 'class': 'hf-about__list' }, items.map(function (x) {
      if (x && typeof x === 'object' && !x.nodeType) return h('li', null, [x.title ? h('b', null, [String(x.title) + ' ']) : null, String(x.text || '')]);
      return h('li', null, [x && x.nodeType ? x : String(x)]);
    }));
  }
  function canCannot(cl) {
    var kids = [];
    if (cl.intro) kids.push(para(cl.intro));
    if (cl.can && cl.can.length) { kids.push(h('h3', { 'class': 'hf-h3' }, [cl.canTitle || 'Long-Horizon can'])); kids.push(bullet(cl.can)); }
    if (cl.cannot && cl.cannot.length) { kids.push(h('h3', { 'class': 'hf-h3' }, [cl.cannotTitle || 'Long-Horizon cannot'])); kids.push(bullet(cl.cannot)); }
    if (cl.note) kids.push(h('p', { 'class': 'hf-small hf-soft' }, [cl.note]));
    return kids;
  }

  function claimsContent() {
    var box = h('div', { 'class': 'hf-prose hf-about__claims' });
    var cl = HF.content && HF.content.claims;
    try {
      if (typeof cl === 'function') cl = cl();
      if (cl && typeof cl.render === 'function') { cl.render(box); if (box.childNodes.length) return box; }
      else if (cl && cl.nodeType) { box.appendChild(cl); return box; }
      else if (typeof cl === 'string' && cl.trim()) { cl.split(/\n{2,}/).forEach(function (p) { box.appendChild(para(p)); }); return box; }
      else if (Array.isArray(cl) && cl.length) { box.appendChild(bullet(cl)); return box; }
      else if (cl && (cl.can || cl.cannot)) { canCannot(cl).forEach(function (n) { box.appendChild(n); }); return box; }
      else if (cl && Array.isArray(cl.sections)) {
        if (cl.intro) box.appendChild(para(cl.intro));
        cl.sections.forEach(function (s) {
          if (s.title) box.appendChild(h('h3', { 'class': 'hf-h3' }, [s.title]));
          if (s.text) String(s.text).split(/\n{2,}/).forEach(function (p) { box.appendChild(para(p)); });
          if (s.items) box.appendChild(bullet(s.items));
        });
        if (box.childNodes.length) return box;
      } else if (cl && cl.text) { String(cl.text).split(/\n{2,}/).forEach(function (p) { box.appendChild(para(p)); }); return box; }
    } catch (e) { if (root.console) console.error('[long-horizon] claims text failed', e); }
    while (box.firstChild) box.removeChild(box.firstChild);
    canCannot(FALLBACK).forEach(function (n) { box.appendChild(n); });
    return box;
  }

  function chimeraSection() {
    var Cc = c(), ch = ui.chimera || {};
    var sec = K().section({ id: 'chimera', title: 'The Chimera community' });
    var art = null;
    try { art = ch.art ? ch.art() : null; } catch (e) { art = null; }
    sec.appendChild(h('div', { 'class': 'hf-about__chimera' }, [
      art ? h('div', { 'class': 'hf-about__art', 'aria-hidden': 'true' }, [art]) : null,
      h('div', { 'class': 'hf-about__chimera-text' }, [
        h('p', { 'class': 'hf-about__lead' }, ['Long-Horizon was built by the Chimera community on Discord, check it out! Share progress, suggest features and join community studies.']),
        h('div', { 'class': 'hf-actions' }, [Cc.link('Join us on Discord', ch.URL || DISCORD, { variant: 'primary', id: 'hf-about-discord' })]),
        h('p', { 'class': 'hf-small hf-about__url' }, ['Or type ', h('b', null, [ch.URL || DISCORD]), ' in your browser. Previews sometimes block new tabs; the address always works.'])
      ])
    ]));
    return sec;
  }

  function nameSection() {
    var sec = K().section({ id: 'why-name', title: 'Why Long-Horizon?' });
    sec.appendChild(h('div', { 'class': 'hf-prose hf-about__name' }, [h('p', { 'class': 'hf-about__tagline' }, [TAGLINE]), para(WHY_NAME)]));
    return sec;
  }

  function claimsSection() {
    var sec = K().section({ id: 'claims', title: 'What Long-Horizon can and cannot claim' });
    sec.appendChild(claimsContent());
    return sec;
  }

  function privacySection() {
    var sec = K().section({ id: 'privacy', title: 'Privacy' });
    var persistent = !(HF.store && HF.store.persistent === false);
    sec.appendChild(h('div', { 'class': 'hf-prose' }, [
      para('Everything stays on this device. Long-Horizon has no server, no account, no tracking, no analytics and no ads; it sends nothing anywhere.'),
      para(persistent ? 'Your sessions, levels and Lab results are kept in this browser’s storage. Clearing the browser’s site data deletes them, so export a backup now and then (Progress, Backup).'
        : 'Here the browser blocks storage, so nothing is kept after this page closes. Export a backup to keep your progress.'),
      para('Sharing is always your choice: Share to Discord only copies a short text for you to paste, and Lab exports for community studies are files you send yourself.')
    ]));
    return sec;
  }

  function creditsSection() {
    var sec = K().section({ id: 'credits', title: 'Credits' });
    sec.appendChild(bullet([
      { title: 'Built by', text: 'the Chimera community on Discord.' },
      { title: 'Training procedures', text: 'from Cao et al. (2026, Psychonomic Bulletin & Review), Wang, Sun and Xiao (2025, Brain Topography) and Jaeggi et al. (2008, PNAS), rebuilt in our own words and code.' },
      { title: 'Lab tests', text: 'generated item by item: no items from published intelligence tests are used.' },
      { title: 'Colours', text: 'the Okabe–Ito palette, chosen to stay distinct with colour-vision differences; shapes and words always back them up.' },
      { title: 'Spoken letters', text: 'synthesized with Flite’s cmu_us_slt voice (Carnegie Mellon University).' },
      { title: 'Fonts', text: 'your device’s own system fonts; none are bundled.' }
    ]));
    return sec;
  }

  function licencesSection() {
    var sec = K().section({ id: 'licences', title: 'Licences' });
    sec.appendChild(bullet([
      { title: 'Code:', text: 'MIT licence (the LICENSE file).' },
      { title: 'Texts and the guide:', text: 'Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0, the LICENSE-CONTENT file).' },
      { title: 'Third-party parts:', text: 'listed in the NOTICE file. The spoken-letter clips come from the Flite speech synthesizer’s cmu_us_slt voice, under Carnegie Mellon University’s BSD-style licence.' },
      { title: 'Not used:', text: 'no code from Brain Workshop or other GPL projects.' }
    ]));
    return sec;
  }

  function versionSection() {
    var Cc = c();
    var r = K().records() || {};
    var sec = K().section({ id: 'version', title: 'Version' });
    sec.appendChild(Cc.dl([
      { label: 'Long-Horizon', value: HF.VERSION || '1.0.0' },
      { label: 'Data format', value: 'schema ' + (isNum(r.schema) ? r.schema : 1) + (r.appVersion ? ', saved by ' + r.appVersion : '') },
      { label: 'Data started', value: isNum(r.createdAt) ? K().fmtDate(r.createdAt, { year: true }) : '–' },
      { label: 'Storage', value: HF.store && HF.store.persistent === false ? 'memory only (not saved here)' : 'this browser’s local storage' }
    ]));
    return sec;
  }

  var screen = {
    title: 'About',
    render: function (rootEl) {
      var pg = K().page({ title: 'About Long-Horizon', lead: 'A free working memory trainer with an optional Lab that measures transfer. Version ' + (HF.VERSION || '1.0.0') + '.', cls: 'hf-about' });
      [chimeraSection(), nameSection(), claimsSection(), privacySection(), creditsSection(), licencesSection(), versionSection()].forEach(function (s) { pg.node.appendChild(s); });
      rootEl.appendChild(pg.node);
    },
    leave: function () {}
  };

  ui.screens = ui.screens || {};
  ui.screens.about = screen;
  ui.about = { screen: screen, FALLBACK: FALLBACK, claimsContent: claimsContent, TAGLINE: TAGLINE, WHY_NAME: WHY_NAME };
  if (HF.router && HF.router.register) HF.router.register('about', screen);
})(typeof window !== 'undefined' ? window : globalThis);
