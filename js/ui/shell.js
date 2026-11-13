/* Long-Horizon — app shell (js/ui/shell.js). DOM only, ES2019, MIT licence. Owner: design agent.

   HF.ui.shell.mount(root?) → api        builds the frame once (idempotent) inside root (default document.body):
       .hf-app
         .hf-rail            (phones: display:contents; desktop ≥ 900 px: sticky side column)
           header.hf-header  brand button (data-go="today") + .hf-header__aside slot
           nav.hf-nav        Today, Learn, Lab, Progress, More ▸ sheet (Free play, Settings, About, Chimera Discord)
         main#hf-screen.hf-screen   ← screens render here
         footer.hf-footer    "Built by the Chimera community on Discord · discord.gg/chmr" (Today only)
         #hf-toasts.hf-toasts       (role=status; HF.dom.toast appends here)
   HF.ui.shell.setActive(route)        marks the nav item (aria-current="page"), shows the footer on the `today`
                                       route only, closes the More sheet. Sub-routes map through ALIAS (practice →
                                       learn, session → today …) and prefixes ("lab.visit" → lab); unknown routes
                                       clear the mark. mount() subscribes to HF.router.onChange, so the router keeps
                                       it in sync by itself.
   HF.ui.shell.chrome(visible?)        false hides header, navigation and footer (training blocks); true restores;
                                       no argument returns the current state.
   HF.ui.shell.applySettings(settings) mirrors theme / largeText / leftHanded / reducedMotion / focusMode
                                       onto <html data-theme|data-text|data-hand|data-motion|data-focus>.
   HF.ui.shell.screen()                → the #hf-screen element.   HF.ui.shell.focusScreen() moves focus there.
   HF.ui.shell.NAV, MORE, ALIAS        the route tables (edit before mount if routes change).

   Navigation uses buttons with data-go="route" only (no href="#/…"); HF.router's delegated listener does the
   routing. Without a router (style guide), a click on a nav item calls setActive itself. */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;
  var DISCORD = 'https://discord.gg/chmr';

  var NAV = [
    { route: 'today', label: 'Today', icon: 'today' },
    { route: 'learn', label: 'Learn', icon: 'learn' },
    { route: 'lab', label: 'Lab', icon: 'lab' },
    { route: 'progress', label: 'Progress', icon: 'progress' }
  ];
  var MORE = [
    { route: 'free', label: 'Free play', icon: 'free' },
    { route: 'settings', label: 'Settings', icon: 'settings' },
    { route: 'about', label: 'About', icon: 'about' }
  ];
  var ALIAS = {
    session: 'today', welcome: 'today', home: 'today',
    practice: 'learn', lesson: 'learn', lessons: 'learn', glossary: 'learn', howto: 'learn',
    labvisit: 'lab', study: 'lab',
    history: 'progress', badges: 'progress',
    freeplay: 'free', play: 'free'
  };

  var S = { app: null, rail: null, nav: null, moreBtn: null, sheet: null, footer: null, screen: null, toasts: null, active: null, chrome: true, items: [], routerOff: null };

  function c() { return ui.c || null; }
  function el(tag, attrs, children) {
    if (c()) return c().h(tag, attrs, children);
    var node = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
      if (k === 'class') node.className = attrs[k]; else node.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]));
    }
    (children || []).forEach(function (ch) { if (ch) node.appendChild(typeof ch === 'string' ? doc.createTextNode(ch) : ch); });
    return node;
  }
  function icon(name, cls) { return c() ? c().icon(name, { cls: cls }) : null; }

  function normalize(route) {
    if (!route) return null;
    var r = String(route).replace(/^#?\/?/, '');
    var base = r.split(/[.\/:?]/)[0];
    if (ALIAS[r]) return ALIAS[r];
    if (ALIAS[base]) return ALIAS[base];
    return base;
  }

  function navItem(item) {
    var b = el('button', { type: 'button', 'class': 'hf-nav__item', 'data-go': item.route, 'data-route': item.route }, [
      icon(item.icon),
      el('span', { 'class': 'hf-nav__label' }, [item.label])
    ]);
    S.items.push(b);
    return el('li', null, [b]);
  }
  function moreItem(item) {
    var b = el('button', { type: 'button', 'class': 'hf-nav__link', 'data-go': item.route, 'data-route': item.route }, [
      icon(item.icon),
      el('span', null, [item.label])
    ]);
    S.items.push(b);
    return el('li', null, [b]);
  }

  function openMore(open) {
    if (!S.nav) return;
    var isOpen = open === undefined ? !S.nav.classList.contains('is-more-open') : !!open;
    S.nav.classList.toggle('is-more-open', isOpen);
    if (S.moreBtn) S.moreBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      var first = S.sheet && S.sheet.querySelector('button, a');
      if (first && isPhone()) first.focus();
    }
  }
  function isPhone() {
    try { return !root.matchMedia('(min-width: 56.25em)').matches; } catch (e) { return true; }
  }

  function mount(rootEl, opts) {
    opts = opts || {};
    if (S.app && S.app.isConnected) return api;
    rootEl = rootEl || doc.body;
    S.items = [];

    var brand = el('button', { type: 'button', 'class': 'hf-brand', 'data-go': 'today', 'aria-label': 'Long-Horizon, go to Today' }, [
      c() ? c().mark() : null,
      el('span', { 'class': 'hf-brand__name', 'aria-hidden': 'true' }, ['Long-Horizon'])
    ]);
    var aside = el('div', { 'class': 'hf-header__aside', id: 'hf-header-aside' });
    var header = el('header', { 'class': 'hf-header' }, [brand, aside]);

    var mainList = el('ul', { 'class': 'hf-nav__main' }, NAV.map(navItem));
    S.moreBtn = el('button', { type: 'button', 'class': 'hf-nav__item hf-nav__more', 'aria-expanded': 'false', 'aria-controls': 'hf-nav-sheet' }, [
      icon('more'),
      el('span', { 'class': 'hf-nav__label' }, ['More'])
    ]);
    mainList.appendChild(el('li', { 'class': 'hf-nav__morewrap' }, [S.moreBtn]));

    var community = el('a', { 'class': 'hf-nav__link hf-nav__community', href: DISCORD, target: '_blank', rel: 'noopener' }, [
      icon('people'),
      el('span', null, ['Chimera Discord', el('span', { 'class': 'hf-nav__note' }, ['discord.gg/chmr'])]),
      icon('external', 'hf-nav__ext'),
      el('span', { 'class': 'hf-vh' }, [' (opens in a new tab)'])
    ]);
    S.sheet = el('div', { 'class': 'hf-nav__sheet', id: 'hf-nav-sheet' }, [
      el('ul', { 'class': 'hf-nav__group' }, MORE.map(moreItem)),
      el('ul', { 'class': 'hf-nav__group' }, [el('li', null, [community])])
    ]);
    S.nav = el('nav', { 'class': 'hf-nav', 'aria-label': 'Main' }, [mainList, S.sheet]);

    S.rail = el('div', { 'class': 'hf-rail' }, [header, S.nav]);

    S.screen = doc.getElementById('hf-screen');
    if (S.screen) { S.screen.classList.add('hf-screen'); if (S.screen.tagName !== 'MAIN') S.screen.setAttribute('role', 'main'); }
    else S.screen = el('main', { id: 'hf-screen', 'class': 'hf-screen', tabindex: '-1' });
    if (!S.screen.hasAttribute('tabindex')) S.screen.setAttribute('tabindex', '-1');

    S.footer = el('footer', { 'class': 'hf-footer', hidden: true }, [
      'Built by the Chimera community on Discord · ',
      el('a', { href: DISCORD, target: '_blank', rel: 'noopener' }, ['discord.gg/chmr'])
    ]);

    S.toasts = doc.getElementById('hf-toasts');
    if (!S.toasts) S.toasts = el('div', { id: 'hf-toasts' });
    S.toasts.classList.add('hf-toasts');
    S.toasts.setAttribute('role', 'status');
    S.toasts.setAttribute('aria-live', 'polite');
    S.toasts.setAttribute('aria-atomic', 'false');

    var skip = el('button', { type: 'button', 'class': 'hf-skip' }, ['Skip to content']);
    skip.addEventListener('click', focusScreen);

    S.app = el('div', { 'class': 'hf-app', id: 'hf-app' }, [skip, S.rail, S.screen, S.footer, S.toasts]);
    rootEl.appendChild(S.app);

    S.moreBtn.addEventListener('click', function (e) { e.preventDefault(); openMore(); });
    S.nav.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-go]') : null;
      if (!t) return;
      openMore(false);
      if (!(HF.router && typeof HF.router.go === 'function')) setActive(t.getAttribute('data-go'));
    });
    brand.addEventListener('click', function () {
      if (!(HF.router && typeof HF.router.go === 'function')) setActive('today');
    });
    S.nav.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.nav.classList.contains('is-more-open')) {
        e.stopPropagation();
        openMore(false);
        S.moreBtn.focus();
      }
    });
    doc.addEventListener('pointerdown', function (e) {
      if (!S.nav || !S.nav.classList.contains('is-more-open')) return;
      if (S.sheet.contains(e.target) || S.moreBtn.contains(e.target)) return;
      openMore(false);
    }, true);

    // Follow the router: every navigation marks the nav item (no wiring needed in app.js).
    if (HF.router && typeof HF.router.onChange === 'function' && !S.routerOff) {
      S.routerOff = HF.router.onChange(function (cur) { if (cur && cur.name) setActive(cur.name); });
      if (HF.router.current && HF.router.current.name) setActive(HF.router.current.name);
    }
    if (opts.active) setActive(opts.active);
    return api;
  }

  function setActive(route) {
    var r = normalize(route);
    var base = route ? String(route).replace(/^#?\/?/, '').split(/[.\/:?]/)[0] : '';
    S.active = r;
    var inMore = false;
    S.items.forEach(function (b) {
      var on = b.getAttribute('data-route') === r;
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      if (on && b.classList.contains('hf-nav__link')) inMore = true;
    });
    if (S.moreBtn) {
      S.moreBtn.classList.toggle('is-current', inMore);
      var label = S.moreBtn.querySelector('.hf-nav__label');
      if (inMore) S.moreBtn.setAttribute('aria-label', 'More, current: ' + labelOf(r)); else S.moreBtn.removeAttribute('aria-label');
      if (label) label.textContent = 'More';
    }
    if (S.footer) S.footer.hidden = !(base === 'today' || base === 'home');
    if (S.app) S.app.setAttribute('data-route', r || '');
    openMore(false);
    return r;
  }
  function labelOf(r) {
    var all = NAV.concat(MORE);
    for (var i = 0; i < all.length; i++) if (all[i].route === r) return all[i].label;
    return r;
  }

  function chrome(visible) {
    if (visible === undefined) return S.chrome;
    S.chrome = !!visible;
    if (S.app) S.app.classList.toggle('hf-app--bare', !S.chrome);
    if (S.rail) {
      if (S.chrome) S.rail.removeAttribute('inert'); else S.rail.setAttribute('inert', '');
    }
    openMore(false);
    return S.chrome;
  }

  function applySettings(s) {
    s = s || {};
    var html = doc.documentElement;
    function set(name, v) { if (v === null || v === undefined || v === false || v === '') html.removeAttribute(name); else html.setAttribute(name, String(v)); }
    var theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system';
    set('data-theme', theme);
    set('data-text', s.largeText ? 'large' : null);
    set('data-hand', s.leftHanded ? 'left' : null);
    set('data-motion', s.reducedMotion === true ? 'reduce' : s.reducedMotion === false ? 'full' : null);
    set('data-focus', s.focusMode ? 'on' : null);
  }

  function screen() { return S.screen || doc.getElementById('hf-screen'); }
  function focusScreen() {
    var s = screen();
    if (!s) return;
    try { s.focus({ preventScroll: true }); } catch (e) { s.focus(); }
  }

  var api = {
    mount: mount, setActive: setActive, chrome: chrome, applySettings: applySettings,
    screen: screen, focusScreen: focusScreen, openMore: openMore,
    active: function () { return S.active; },
    NAV: NAV, MORE: MORE, ALIAS: ALIAS, DISCORD: DISCORD
  };
  ui.shell = api;
})(typeof window !== 'undefined' ? window : globalThis);
