/* Long-Horizon — boot. MIT licence.
 *
 * Order: load the store (schema guard; memory mode in sandboxes) → mount HF.ui.shell if present (else the plain
 * main#hf-screen from index.html) → apply settings to <html> → register a placeholder 'today' screen if no real
 * one exists → start the router (the shell's nav follows route changes) → HF.ui.chimera.show() if present (the
 * Chimera Discord pop-up on every launch) → in-app browser notice → service worker (GitHub Pages copy only).
 * The "not saved here" notice for blocked storage is shown by the Today screen.
 *
 * Shell contract accepted: HF.ui.shell.mount(document.body) returning its api (screen() → element), an element,
 * or { main } / { content }; HF.ui.shell.setActive(route) and applySettings(settings) are called when present.
 *
 * Service worker (sw.js, see docs/dev/pwa-notes.md): registered only over https (or http://localhost /
 * 127.0.0.1 for tests), in a top-level page (never in a frame or srcdoc preview), when <link rel="manifest"> is
 * present (index.html; the single-file build drops it and sets window.HF_SINGLE_FILE), never on file://.
 * HF.pwa = { state: 'off'|'pending'|'registered'|'failed', reason, registration, update: null|'ready'|'activating' }.
 * When a new version has been installed in the background, a toast offers "Reload": the waiting worker takes
 * over and the page reloads once (only after that click, so never in the middle of a block).
 *
 * In-app browsers (HF.util.inAppBrowser: Discord, Instagram, Messenger, Facebook, LINE, TikTok, Snapchat, WeChat,
 * Android WebView): a calm notice at the top of the screen ("You're in Discord's built-in browser. Open Long-Horizon
 * in Safari or Chrome so your progress is saved reliably.") with Copy link (clipboard where allowed, else a copy
 * box) and Got it (remembered on this device: localStorage 'long-horizon.v1.iab-dismissed'). It is hidden while a
 * block runs (html[data-busy]) or the shell hides its chrome (.hf-app--bare) and re-placed after route changes.
 * HF.env = { inApp: { id, name } | null, notice: element | undefined }.
 *
 * Every step is guarded so one failing part never blanks the page; errors go to the console.
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  var IAB_KEY = 'long-horizon.v1.iab-dismissed';   // the store copies 1.0.0's key once (js/core/store.js)

  function log(e) { if (root.console) console.error('[long-horizon] boot', e); }
  function isEl(x) { return !!x && x.nodeType === 1; }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* storage blocked: shows again next time */ } }
  function pageUrl() { try { return String(root.location.href).split('#')[0]; } catch (e) { return ''; } }

  function screenEl() {
    var m = doc.getElementById('hf-screen') || doc.getElementById('hf-main');
    if (!m) {
      m = doc.createElement('main');
      m.id = 'hf-screen';
      m.className = 'hf-screen';
      m.setAttribute('tabindex', '-1');
      doc.body.insertBefore(m, doc.body.firstChild);
    }
    return m;
  }

  function mountShell() {
    var shell = HF.ui && HF.ui.shell, out = null;
    try {
      if (shell && typeof shell.mount === 'function') out = shell.mount(doc.body);
      else if (typeof shell === 'function') out = shell(doc.body);
    } catch (e) { log(e); out = null; }
    if (isEl(out)) return out;
    if (out && typeof out.screen === 'function') { try { var s = out.screen(); if (isEl(s)) return s; } catch (e2) { log(e2); } }
    if (out && isEl(out.main)) return out.main;
    if (out && isEl(out.content)) return out.content;
    return screenEl();
  }

  function applySettings() {
    var s = HF.store.records && HF.store.records.settings;
    if (!s) return;
    var shell = HF.ui && HF.ui.shell;
    if (shell && typeof shell.applySettings === 'function') { shell.applySettings(s); return; }
    if (s.theme === 'light' || s.theme === 'dark') doc.documentElement.setAttribute('data-theme', s.theme);
    else doc.documentElement.removeAttribute('data-theme');
  }

  var placeholder = {
    title: 'Today',
    render: function (rootEl) {
      var el = HF.dom.el;
      rootEl.appendChild(el('section', { 'class': 'hf-placeholder' }, [
        el('h1', null, 'Today'),
        el('p', null, 'Long-Horizon is a working memory trainer. The training screens are being built.')
      ]));
    }
  };

  // ---------------------------------------------------------------- in-app browser notice
  function inAppNotice() {
    var ua = (root.navigator && root.navigator.userAgent) || '';
    var hit = HF.util && HF.util.inAppBrowser ? HF.util.inAppBrowser(ua) : null;
    HF.env = { inApp: hit };
    if (!hit || lsGet(IAB_KEY) === '1') return null;
    if (HF.timing && HF.timing.busy) { setTimeout(inAppNotice, 1000); return null; }
    var c = HF.ui && HF.ui.c, el = HF.dom.el;
    var title = hit.name ? 'You’re in ' + hit.name + '’s built-in browser.' : 'You’re in an app’s built-in browser.';
    var text = 'Open Long-Horizon in Safari or Chrome so your progress is saved reliably.';
    var box = el('div', { id: 'hf-iab', 'class': 'hf-iab', role: 'region', 'aria-label': 'Browser notice' });
    var status = el('p', { 'class': 'hf-iab__status', role: 'status' });
    var offRoute = null, copyArea = null;

    function btn(label, variant, icon, onClick) {
      if (c && typeof c.button === 'function') return c.button(label, { variant: variant, icon: icon, onClick: onClick });
      return el('button', { type: 'button', 'class': 'hf-btn hf-btn--' + variant, onclick: onClick }, label);
    }
    function copy() {
      var url = pageUrl();
      HF.dom.copyText(url).then(function (ok) {
        status.textContent = ok ? 'Link copied. Paste it into Safari or Chrome.' : '';
        if (!ok && !copyArea) {
          copyArea = c && typeof c.copyBox === 'function'
            ? c.copyBox({ label: 'Link to Long-Horizon', text: url, rows: 2, hint: 'Copy this link, then open it in Safari or Chrome.' })
            : el('textarea', { 'class': 'hf-input', readonly: true, rows: '2', 'aria-label': 'Link to Long-Horizon' }, url);
          box.appendChild(copyArea);
        }
      });
    }
    function dismiss() {
      lsSet(IAB_KEY, '1');
      if (offRoute) offRoute();
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    var actions = [btn('Copy link', 'secondary', 'copy', copy), btn('Got it', 'quiet', null, dismiss)];
    box.appendChild(c && typeof c.notice === 'function'
      ? c.notice({ tone: 'info', title: title, text: text, action: actions })
      : el('div', { 'class': 'hf-notice' }, [el('p', { 'class': 'hf-notice__title' }, title), el('p', { 'class': 'hf-notice__text' }, text),
        el('div', { 'class': 'hf-notice__action' }, actions)]));
    box.appendChild(status);
    doc.head.appendChild(el('style', { id: 'hf-iab-style' },
      'html[data-busy] #hf-iab, .hf-app--bare #hf-iab { display: none !important; } #hf-iab { margin: 0 0 1rem; }'));

    function place() {
      var r = HF.router && typeof HF.router.root === 'function' ? HF.router.root() : doc.getElementById('hf-screen');
      if (r && r.firstChild !== box) r.insertBefore(box, r.firstChild);
    }
    place();
    if (HF.router && typeof HF.router.onChange === 'function') offRoute = HF.router.onChange(place);
    HF.env.notice = box;
    return box;
  }

  // ---------------------------------------------------------------- service worker (GitHub Pages)
  function swBlocked() {
    try {
      if (root.HF_SINGLE_FILE) return 'single-file';
      var loc = root.location, proto = loc.protocol;
      if (proto === 'file:') return 'file';
      var local = proto === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
      if (proto !== 'https:' && !local) return 'insecure';
      if (root.self !== root.top) return 'frame';
      if (!doc.querySelector('link[rel="manifest"]')) return 'no-manifest';
      if (!('serviceWorker' in root.navigator)) return 'unsupported';
      return null;
    } catch (e) { return 'error'; }
  }

  function watchUpdates(reg) {
    var sw = root.navigator.serviceWorker, offered = false, reloading = false;
    function offer() {
      if (offered || !reg.waiting || !sw.controller) return;
      offered = true;
      HF.pwa.update = 'ready';
      HF.dom.toast('A new version of Long-Horizon is ready.', {
        kind: 'info', timeout: 0,
        action: { label: 'Reload', onClick: function () {
          HF.pwa.update = 'activating';
          if (reg.waiting) reg.waiting.postMessage({ type: 'skip-waiting' });
        } }
      });
    }
    sw.addEventListener('controllerchange', function () {
      if (HF.pwa.update !== 'activating' || reloading) return;
      reloading = true;
      root.location.reload();
    });
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () { if (w.state === 'installed') offer(); });
    });
    offer();
  }

  function registerServiceWorker() {
    var why = swBlocked();
    HF.pwa = { state: why ? 'off' : 'pending', reason: why, registration: null, update: null };
    if (why) return;
    function go() {
      root.navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
        HF.pwa.state = 'registered';
        HF.pwa.registration = reg;
        watchUpdates(reg);
      }, function (err) {
        HF.pwa.state = 'failed';
        HF.pwa.reason = String(err && err.message || err);
      });
    }
    if (doc.readyState === 'complete') setTimeout(go, 0);
    else root.addEventListener('load', function () { setTimeout(go, 0); });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    try { HF.store.load(); } catch (e) { log(e); }
    var main = mountShell();
    try { applySettings(); } catch (e2) { log(e2); }
    try {
      HF.store.onChange(function () { try { applySettings(); } catch (e) { log(e); } });
    } catch (e3) { log(e3); }
    try {
      var shell = HF.ui && HF.ui.shell;
      if (shell && typeof shell.setActive === 'function') {
        HF.router.onChange(function (c) { try { shell.setActive(c.name); } catch (e) { log(e); } });
      }
      HF.router.setRoot(main);
      if (!HF.router.has('today')) HF.router.register('today', placeholder);
      HF.router.start('today');
    } catch (e4) { log(e4); }
    try {
      if (HF.ui && HF.ui.chimera && typeof HF.ui.chimera.show === 'function') HF.ui.chimera.show();
    } catch (e5) { log(e5); }
    try { inAppNotice(); } catch (e6) { log(e6); }
    try { registerServiceWorker(); } catch (e7) { log(e7); }
    HF.booted = true;
  }

  HF.boot = boot;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
