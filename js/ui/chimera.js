/* Long-Horizon — Chimera community pop-up (js/ui/chimera.js). DOM only, ES2019, MIT licence. Owner: design agent.

   HF.ui.chimera.show(opts?) → Promise<boolean>
       Opens once per page load (later calls resolve false at once). Never opens while HF.timing.busy.
       Uses HF.dom.modal when the core provides it (class "hf-modal", body ".hf-modal__body"), otherwise its
       own <dialog class="hf-modal">. "Start training" has initial focus, so Enter or Escape closes it.
       "Join us on Discord" is a real <a href="https://discord.gg/chmr" target="_blank" rel="noopener">;
       the address is also printed as selectable text for previews that block new tabs.
       Resolves true when the pop-up closes. opts: { title, onClose(), returnFocus: Element }.
   HF.ui.chimera.isOpen() → boolean.   HF.ui.chimera.art() → the horizon SVG (also used by About; the guide has the same art as docs/guide/assets/horizon.svg).
   HF.ui.chimera.TEXT, URL, URL_TEXT — the exact strings. */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var TEXT = 'A free working memory trainer, built by the Chimera community on Discord. Check it out! Share progress, suggest features and join community studies.';
  var URL = 'https://discord.gg/chmr';
  var URL_TEXT = 'discord.gg/chmr';

  var shown = false;
  var openDialog = null;

  function h(tag, attrs, children) {
    if (ui.c && ui.c.h) return ui.c.h(tag, attrs, children);
    var node = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
      if (k === 'class') node.className = attrs[k]; else node.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]));
    }
    (children || []).forEach(function (ch) { if (ch) node.appendChild(typeof ch === 'string' ? doc.createTextNode(ch) : ch); });
    return node;
  }
  function s(tag, attrs) {
    var node = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    return node;
  }
  function icon(name) { return ui.c && ui.c.icon ? ui.c.icon(name) : null; }

  /* Phase 3 fix: the screen under the pop-up may be drawn or replaced while the pop-up is open (first launch: Today
     hands over to Welcome), so the opener is gone or is <body>. Give focus to the screen's default control
     ([data-autofocus], else its h1), as the router does, so Enter / Space go on from there (Start training now). */
  function focusScreenDefault() {
    var scr = doc.getElementById('hf-screen');
    var t = scr && (scr.querySelector('[data-autofocus]') || scr.querySelector('h1'));
    if (!t) return;
    if (!t.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (e) { try { t.focus(); } catch (e2) { /* ignore */ } }
  }

  /* The horizon (the app's mark in wide form, same as the guide's cover art): a horizon line counted in steps (the
     ticks), a half sun resting on it, and rungs that lengthen toward the viewer, leading out to the horizon. */
  function art() {
    var W = 480, H = 150, y = 80;
    var node = s('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMax slice', 'class': 'hf-chimera__art', 'aria-hidden': 'true', focusable: 'false' });
    node.appendChild(s('path', { 'class': 'h-glow', d: 'M196 ' + y + 'a44 44 0 0 1 88 0z' }));
    node.appendChild(s('path', { 'class': 'h-sun', d: 'M210 ' + y + 'a30 30 0 0 1 60 0z' }));
    node.appendChild(s('path', { 'class': 'h-line', d: 'M0 ' + y + 'H' + W }));
    var minor = '', major = '';
    for (var x = 8; x < W; x += 16) {
      if (x > 216 && x < 264) continue;                          // no ticks under the sun
      if (Math.abs(x - 240) === 88 || Math.abs(x - 240) === 168) major += 'M' + x + ' ' + (y + 0.75) + 'v6';   // 72, 152, 328, 408
      else minor += 'M' + x + ' ' + (y + 0.75) + 'v3';
    }
    node.appendChild(s('path', { 'class': 'h-tick', d: minor }));
    node.appendChild(s('path', { 'class': 'h-tick h-tick--major', d: major }));
    node.appendChild(s('path', { 'class': 'h-path', d: 'M232 ' + (y + 1) + 'L96 ' + H + 'M248 ' + (y + 1) + 'L384 ' + H }));
    node.appendChild(s('path', { 'class': 'h-rung h-rung--1', d: 'M208.7 92H271.3' }));
    node.appendChild(s('path', { 'class': 'h-rung h-rung--2', d: 'M177.6 108H302.4' }));
    node.appendChild(s('path', { 'class': 'h-rung h-rung--3', d: 'M134.9 130H345.1' }));
    return node;
  }

  function content(opts, onStart) {
    var titleId = 'hf-chimera-title';
    var start = h('button', { type: 'button', 'class': 'hf-btn hf-btn--primary hf-btn--lg hf-btn--block', 'data-autofocus': '' }, ['Start training']);
    start.addEventListener('click', onStart);
    var join = h('a', { 'class': 'hf-btn hf-btn--secondary hf-btn--lg hf-btn--block', href: URL, target: '_blank', rel: 'noopener' }, [
      h('span', null, ['Join us on Discord']),
      icon('external'),
      h('span', { 'class': 'hf-vh' }, [' (opens in a new tab)'])
    ]);
    var node = h('div', { 'class': 'hf-chimera' }, [
      art(),
      h('div', { 'class': 'hf-chimera__body' }, [
        h('h2', { 'class': 'hf-chimera__title', id: titleId }, [opts.title || 'Long-Horizon']),
        h('p', { 'class': 'hf-chimera__text', id: 'hf-chimera-text' }, [TEXT]),
        h('div', { 'class': 'hf-chimera__actions' }, [
          h('div', { 'class': 'hf-chimera__join' }, [
            join,
            h('p', { 'class': 'hf-chimera__url' }, ['Or type ', h('b', null, [URL_TEXT]), ' in your browser.'])
          ]),
          start
        ])
      ])
    ]);
    return { node: node, start: start, titleId: titleId };
  }

  function show(opts) {
    opts = opts || {};
    if (shown) return Promise.resolve(false);
    if (HF.timing && HF.timing.busy) return Promise.resolve(false);
    shown = true;
    return new Promise(function (resolve) {
      var finished = false;
      var opener = opts.returnFocus || doc.activeElement;
      var handle = null, dlg = null, scrim = null;

      function finish() {
        if (finished) return;
        finished = true;
        openDialog = null;
        if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (dlg && dlg.getAttribute('data-hf-own') === '1' && dlg.parentNode) dlg.parentNode.removeChild(dlg);
        if (opener && opener.focus && opener !== doc.body && opener.isConnected) { try { opener.focus(); } catch (e) { /* ignore */ } }
        else focusScreenDefault();
        if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) { /* ignore */ } }
        resolve(true);
      }
      function close() {
        if (handle && typeof handle.close === 'function') { try { handle.close(); } catch (e) { /* fall through */ } }
        if (dlg && dlg.open && typeof dlg.close === 'function') { try { dlg.close(); } catch (e) { /* ignore */ } }
        if (dlg && dlg.hasAttribute('open') && typeof dlg.close !== 'function') dlg.removeAttribute('open');
        finish();
      }

      var parts = content(opts, function () { close(); });

      if (HF.dom && typeof HF.dom.modal === 'function') {
        try {
          handle = HF.dom.modal(parts.node, { labelledBy: parts.titleId, initialFocus: parts.start, onClose: finish, dismissible: true });
        } catch (e) { handle = null; }
        dlg = handle && handle.nodeName === 'DIALOG' ? handle : (parts.node.closest ? parts.node.closest('dialog') : null);
        if (dlg) {
          dlg.classList.add('hf-modal', 'hf-modal--chimera');
          if (!dlg.getAttribute('aria-labelledby')) dlg.setAttribute('aria-labelledby', parts.titleId);
          dlg.setAttribute('aria-describedby', 'hf-chimera-text');
          dlg.addEventListener('close', finish);
          openDialog = dlg;
          setTimeout(function () { if (!finished && doc.activeElement !== parts.start) parts.start.focus(); }, 0);
          return;
        }
      }

      // Own dialog (no core, or the core modal failed)
      dlg = h('dialog', { 'class': 'hf-modal hf-modal--chimera', 'aria-labelledby': parts.titleId, 'aria-describedby': 'hf-chimera-text', 'data-hf-own': '1' }, [
        h('div', { 'class': 'hf-modal__body' }, [parts.node])
      ]);
      doc.body.appendChild(dlg);
      dlg.addEventListener('close', finish);
      dlg.addEventListener('cancel', function () { /* Escape closes: let the dialog close itself */ });
      openDialog = dlg;
      if (typeof dlg.showModal === 'function') {
        try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
      } else {
        dlg.setAttribute('open', '');
        dlg.classList.add('hf-modal--polyfill');
        scrim = h('div', { 'class': 'hf-modal-scrim' });
        doc.body.insertBefore(scrim, dlg);
        dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
      }
      parts.start.focus();
    });
  }

  ui.chimera = {
    show: show,
    isOpen: function () { return !!openDialog; },
    art: art,
    TEXT: TEXT, URL: URL, URL_TEXT: URL_TEXT,
    _reset: function () { shown = false; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
