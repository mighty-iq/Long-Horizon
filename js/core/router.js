/* Long-Horizon — in-memory router (browser only). MIT licence.
 *
 * Routes live in memory. The URL hash only MIRRORS the route, inside try/catch (sandboxed srcdoc previews throw on
 * history.replaceState with a '#/…' URL, and clicking <a href="#/…"> there would navigate the frame away).
 * In-app links: any element with data-go="route" (optional data-params='{"k":"v"}' JSON) — one delegated click
 * listener handles them. Stray <a href="#…"> links are intercepted too (never followed).
 *
 * Screen = { title: string | fn(params), render(root, params), leave()? }  (also looked up in HF.ui.screens[name])
 *
 * HF.router:
 *   register(name, screen) → router;  has(name);  get(name)
 *   go(name, params?, { replace, focus = true, scroll = true }?) → bool
 *        calls the current screen's leave(), clears the root, render(root, params), sets document.title,
 *        mirrors '#/name', moves focus to the screen's h1 (or [data-autofocus]) for screen readers, notifies.
 *        Unknown names fall back to `fallback` ('today'). A render error is logged and shown in the root.
 *   back() → bool   (in-memory back stack, max 30)
 *   start(defaultName?) → bool  (reads a '#/name' hash if it names a registered route)
 *   setRoot(el), root() → element screens render into (default #hf-screen, else #hf-main, #hf-app, body)
 *   current → { name, params } | null;  onChange(cb) → off;  fallback (string, default 'today')
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var doc = root.document;
  var routes = {}, rootEl = null, current = null, backStack = [], subs = [];

  function get(name) {
    return routes[name] || (HF.ui && HF.ui.screens && HF.ui.screens[name]) || null;
  }
  function has(name) { return !!get(name); }
  function register(name, screen) { routes[name] = screen; return api; }
  function setRoot(el) { rootEl = el || null; }
  function getRoot() {
    return rootEl || doc.getElementById('hf-screen') || doc.getElementById('hf-main') || doc.getElementById('hf-app') || doc.body;
  }
  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function mirror(name) {
    try {
      var base = String(root.location.href).split('#')[0];
      root.history.replaceState(null, '', base + '#/' + name);
    } catch (e) { /* sandboxed preview: the hash is optional */ }
  }

  // Controls keep their place in the Tab order and their focus ring: tabindex="-1" (and css/app.css's no-outline
  // rule for it) is only for programmatic targets such as headings (PQ-01).
  function nativelyFocusable(el) {
    var t = el.tagName;
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/.test(t)) return true;
    if ((t === 'A' || t === 'AREA') && el.hasAttribute('href')) return true;
    return !!el.isContentEditable;
  }

  function focusScreen(target) {
    var h = target.querySelector('[data-autofocus]') || target.querySelector('h1');
    if (!h) return;
    if (!h.hasAttribute('tabindex') && !nativelyFocusable(h)) h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  function notify(c) {
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](c); } catch (e) { if (root.console) console.error(e); }
    }
  }

  function go(name, params, opts) {
    opts = opts || {};
    name = String(name == null ? '' : name).replace(/^#?\/?/, '');
    var screen = get(name);
    if (!screen) {
      if (name !== api.fallback && get(api.fallback)) { name = api.fallback; screen = get(name); }
      else return false;
    }
    if (current && current.screen && typeof current.screen.leave === 'function') {
      try { current.screen.leave(); } catch (e) { if (root.console) console.error(e); }
    }
    if (!opts.replace && current) {
      backStack.push({ name: current.name, params: current.params });
      if (backStack.length > 30) backStack.shift();
    }
    var target = getRoot();
    clearNode(target);
    current = { name: name, params: params || {}, screen: screen };
    try {
      screen.render(target, current.params);
    } catch (e) {
      if (root.console) console.error('[long-horizon] screen "' + name + '" failed to render', e);
      var box = doc.createElement('div');
      box.className = 'hf-error';
      box.setAttribute('role', 'alert');
      box.textContent = 'This screen could not be shown. Please go back and try again.';
      target.appendChild(box);
    }
    var t = screen.title;
    if (typeof t === 'function') { try { t = t(current.params); } catch (e2) { t = ''; } }
    try { doc.title = t ? t + ' · Long-Horizon' : 'Long-Horizon · working memory trainer'; } catch (e3) { /* ignore */ }
    mirror(name);
    if (opts.scroll !== false) { try { root.scrollTo(0, 0); } catch (e4) { /* ignore */ } }
    if (opts.focus !== false) focusScreen(target);
    notify({ name: current.name, params: current.params });
    return true;
  }

  function back() {
    var prev = backStack.pop();
    if (!prev) return go(api.fallback, {}, { replace: true });
    return go(prev.name, prev.params, { replace: true });
  }

  function start(defaultName) {
    if (defaultName) api.fallback = defaultName;
    var h = '';
    try { h = String(root.location.hash || '').replace(/^#\/?/, '').split('?')[0]; } catch (e) { h = ''; }
    return go(h && has(h) ? h : api.fallback, {}, { replace: true });
  }

  function onChange(cb) {
    subs.push(cb);
    return function () { var i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
  }

  function parseParams(node) {
    var raw = node.getAttribute('data-params');
    if (!raw) return {};
    try { var p = JSON.parse(raw); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }

  function onClick(e) {
    if (e.defaultPrevented) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    var t = e.target && e.target.closest ? e.target.closest('[data-go], a[href^="#"]') : null;
    if (!t) return;
    if (t.hasAttribute('data-go')) {
      if (t.disabled || t.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      e.preventDefault();
      go(t.getAttribute('data-go'), parseParams(t));
      return;
    }
    var href = t.getAttribute('href') || '#';
    e.preventDefault();
    if (href.indexOf('#/') === 0) { go(href.slice(2).split('?')[0]); return; }
    if (href.length > 1) {
      var target = null;
      try { target = doc.getElementById(decodeURIComponent(href.slice(1))); } catch (e2) { target = null; }
      if (target) {
        try { target.scrollIntoView({ block: 'start' }); } catch (e3) { target.scrollIntoView(); }
        if (!target.hasAttribute('tabindex') && !nativelyFocusable(target)) target.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch (e4) { /* ignore */ }
      }
    }
  }

  function onHash() {
    var h = '';
    try { h = String(root.location.hash || '').replace(/^#\/?/, '').split('?')[0]; } catch (e) { return; }
    if (h && (!current || current.name !== h) && has(h)) go(h);
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('click', onClick);
    root.addEventListener('hashchange', onHash);
  }

  var api = {
    register: register, has: has, get: get, go: go, back: back, start: start,
    setRoot: setRoot, root: getRoot, onChange: onChange, fallback: 'today'
  };
  Object.defineProperty(api, 'current', {
    enumerable: true,
    get: function () { return current ? { name: current.name, params: current.params } : null; }
  });
  HF.router = api;
})(typeof window !== 'undefined' ? window : globalThis);
