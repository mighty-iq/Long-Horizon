/* Long-Horizon — UI components (js/ui/components.js). DOM only, ES2019, MIT licence. Owner: design agent.
   HF.ui.c.* are plain functions that return DOM nodes (no framework, no global state beyond ids).
   Styling lives in css/app.css; the full reference (props, classes, examples) is docs/dev/design-notes.md
   and the live catalogue is docs/dev/styleguide.html.

   Element creation goes through HF.dom.el when the core has loaded it, else through a local fallback,
   so this file also works on its own. Only plain string attributes and child arrays are passed to el();
   events, styles and properties are applied here afterwards.

   API (all return Node unless noted):
     h(tag, attrs, children)          attrs: strings; false/null skipped; `on` {event: fn}; `style` string|object; `props` {}
     svg(tag, attrs, children)        SVG element
     icon(name, {label, cls})         24px stroke icon; names in ICONS below
     mark({title})                    the Long-Horizon mark (a half sun on the horizon, steps leading out to it)
     kbd(key)                         key cap
     button(label, opts)              opts: variant primary|secondary|quiet|danger, size sm|lg, block, solid, icon, iconAfter,
                                      iconOnly, kbd, go, onClick, id, type, disabled, attrs, cls
     link(label, href, opts)          external link (target=_blank rel=noopener); opts.variant secondary|quiet|plain
     card(opts)                       {title, sub, level, aside, body|children, actions, tone feature|inset|plain, go, onClick, as, id, cls}
     list(items, opts) / listItem(o)  rows: {title, sub, meta, icon, go, href, onClick, chevron}
     details(summary, content, opts)  native <details>
     chip(text, opts) / levelChip(o)  {family nback|relations|span|vsearch|lab, name, level}
     stat(o) / stats(arr)             {label, value, unit, note, hero}
     sessionBar(o)                    {steps:[{label, group, kind warmup|block|lesson|check, state done|current|todo|skipped}], title, now, labels}
     weeklyRing(o)                    {done, target, title, note, size sm}
     zoneMeter(o)                     {title, scores[≤3, oldest first], down, up, min, max, mode zone|mastery, qualify, summary, format}
     badge(o) / badges(arr)           {title, desc, earned, date, glyph, text, tone blue|amber|kelp, secret}
     ruleCard(o), tape(o), keys(rows) {chip, meta, title, rule, example, keys, note, hint, actions}
     debrief(o)                       {index, total, chip, line, score, scoreLabel, next, nextLabel, dir up|same|down,
                                       details, celebrate level|best, cheer, actions, auto}
     lineChart(o)                     {title, desc, series:[{name, points:[{x,y}], slot}], x:{label, format, integer},
                                       y:{label, min, max, format}, markers:[{x, label, kind mode|rule}], smooth, curve, height, summary}
     dotPlot(o)                       {title, desc, rows:[{label, note, band:{lo,hi}, points:[{value, kind}]}], kinds, min, max, format, unit}
     table(o)                         {caption, columns:[{key, label, num}], rows:[{}]}
     empty(o)                         {title, text, action, art sprout|chart|lab|none}
     notice(o)                        {tone info|warn|good|bad, title, text, action, live, slim}
     copyBox(o)                       {label, text, rows, download, mime, hint}
     field(o), toggle(o), segmented(o), select(o)
     pads(o)                          {pads:[{id, label, key, kind yes|no|alt, icon}], mirror, size sm, label}
     fmt.pct(v, digits), fmt.num(v, digits)
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var seq = 0;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function uid(prefix) { seq += 1; return (prefix || 'hf') + '-' + seq.toString(36); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toArr(v) { return v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]; }
  function cx() { var out = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]); return out.join(' '); }

  /* ---------- element creation ---------- */

  function flat(children, out) {
    out = out || [];
    if (children === null || children === undefined || children === false || children === true) return out;
    if (Array.isArray(children)) { for (var i = 0; i < children.length; i++) flat(children[i], out); return out; }
    if (typeof children === 'number') { out.push(String(children)); return out; }
    out.push(children);
    return out;
  }
  function appendKids(node, kids) {
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      node.appendChild(typeof k === 'string' ? doc.createTextNode(k) : k);
    }
  }
  function localEl(tag, attrs, children) {
    var node = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (has(attrs, k)) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') node.className = String(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    appendKids(node, flat(children));
    return node;
  }

  function h(tag, attrs, children) {
    var clean = {}, style = null, props = null, on = null, k;
    if (attrs) for (k in attrs) if (has(attrs, k)) {
      var v = attrs[k];
      if (k === 'on') { on = v; continue; }
      if (k === 'style') { style = v; continue; }
      if (k === 'props') { props = v; continue; }
      if (v === null || v === undefined || v === false) continue;
      clean[k] = v === true ? '' : String(v);
    }
    var kids = flat(children);
    var node = null;
    var f = HF.dom && typeof HF.dom.el === 'function' ? HF.dom.el : null;
    if (f) { try { node = f(tag, clean, kids.slice()); } catch (e) { node = null; } }
    if (!node || node.nodeType !== 1) node = localEl(tag, clean, kids);
    else {
      for (k in clean) if (has(clean, k) && !node.hasAttribute(k)) node.setAttribute(k, clean[k]);
      if (kids.length && !node.firstChild) appendKids(node, kids);
    }
    if (style) {
      if (typeof style === 'string') node.setAttribute('style', style);
      else for (k in style) if (has(style, k) && style[k] !== null && style[k] !== undefined) node.style.setProperty(k, String(style[k]));
    }
    if (props) for (k in props) if (has(props, k)) node[k] = props[k];
    if (on) for (k in on) if (has(on, k) && typeof on[k] === 'function') node.addEventListener(k, on[k]);
    return node;
  }

  function svg(tag, attrs, children) {
    var node = doc.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (has(attrs, k)) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(k, String(v));
    }
    var kids = flat(children);
    for (var i = 0; i < kids.length; i++) node.appendChild(typeof kids[i] === 'string' ? doc.createTextNode(kids[i]) : kids[i]);
    return node;
  }

  /* ---------- formatting ---------- */

  var fmt = {
    pct: function (v, d) {
      if (!isNum(v)) return '–';
      var p = v * 100;
      return (d ? p.toFixed(d) : String(Math.round(p))) + '%';
    },
    num: function (v, d) {
      if (!isNum(v)) return '–';
      if (d === undefined) d = Math.abs(v) >= 100 || v === Math.round(v) ? 0 : Math.abs(v) >= 10 ? 1 : 2;
      var s = v.toFixed(d);
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }
  };

  /* ---------- icons ---------- */

  function P(d) { return ['path', { d: d }]; }
  function C(x, y, r, fill) {
    var a = { cx: x, cy: y, r: r };
    if (fill) { a.fill = 'currentColor'; a.stroke = 'none'; }
    return ['circle', a];
  }
  var ICONS = {
    today: [P('M3 17.5h18'), P('M7 17.5a5 5 0 0 1 10 0'), P('M12 6v2.5M5.6 9.1l1.7 1.7M18.4 9.1l-1.7 1.7'), P('M8.5 21h7')],
    learn: [P('M12 6.6C10.3 5.2 7.7 4.6 4 4.6v13.2c3.7 0 6.3.6 8 2 1.7-1.4 4.3-2 8-2V4.6c-3.7 0-6.3.6-8 2z'), P('M12 6.6v13.2')],
    lab: [P('M9 3.5h6'), P('M10.25 3.5v5.4L5 18.1A2 2 0 0 0 6.75 21h10.5A2 2 0 0 0 19 18.1L13.75 8.9V3.5'), P('M7.4 14.5h9.2')],
    progress: [P('M4 20h16'), P('M5 15.5l4.2-4.2 3.3 2.8L19 7.5'), P('M15 7.5h4v4')],
    more: [C(5.5, 12, 1.7, true), C(12, 12, 1.7, true), C(18.5, 12, 1.7, true)],
    free: [C(12, 12, 8.5), P('M10.2 8.6v6.8l5.4-3.4z')],
    settings: [P('M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3.5M11.5 12H20'), C(15, 7, 2), C(9, 17, 2), C(9.5, 12, 2)],
    about: [C(12, 12, 8.5), P('M12 11v5.2'), C(12, 7.9, 1.05, true)],
    info: [C(12, 12, 8.5), P('M12 11v5.2'), C(12, 7.9, 1.05, true)],
    external: [P('M13.5 4.5h6v6'), P('M19.5 4.5L11 13'), P('M17.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V8a1.5 1.5 0 0 1 1.5-1.5H10')],
    check: [P('M5 12.5l4.5 4.5L19 7.5')],
    close: [P('M6.5 6.5l11 11M17.5 6.5l-11 11')],
    'chev-down': [P('M6 9.5l6 6 6-6')],
    'chev-right': [P('M9.5 6l6 6-6 6')],
    'chev-left': [P('M14.5 6l-6 6 6 6')],
    warn: [P('M12 4.3L21 19.5H3z'), P('M12 10v4.3'), C(12, 16.9, 1.05, true)],
    good: [C(12, 12, 8.5), P('M8.2 12.3l2.6 2.6 5-5.2')],
    bad: [P('M8.4 3.6h7.2l5 5v7.2l-5 5H8.4l-5-5V8.6z'), P('M12 8v5'), C(12, 15.9, 1.05, true)],
    copy: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }], P('M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5')],
    download: [P('M12 4v11'), P('M7.5 10.5L12 15l4.5-4.5'), P('M5 19.5h14')],
    upload: [P('M12 15.5v-11'), P('M7.5 9L12 4.5 16.5 9'), P('M5 19.5h14')],
    pause: [P('M9 5.5v13M15 5.5v13')],
    play: [P('M8 5.5v13l10.5-6.5z')],
    up: [P('M12 19V5.5'), P('M6.5 11L12 5.5 17.5 11')],
    down: [P('M12 5v13.5'), P('M6.5 13L12 18.5 17.5 13')],
    hold: [P('M5 12h14'), P('M15 8l4 4-4 4')],
    star: [P('M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z')],
    sound: [P('M4 9.5h3.5L12 6v12l-4.5-3.5H4z'), P('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11')],
    people: [C(9, 9, 3), P('M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5'), C(16.5, 8.5, 2.5), P('M15.6 13.6c2.4-.3 4.3 1 5 3.9')],
    keyboard: [['rect', { x: 3, y: 6.5, width: 18, height: 11, rx: 2 }], P('M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14h8')],
    tap: [P('M9.5 11.5V5.5a1.5 1.5 0 0 1 3 0v5'), P('M12.5 10.5a1.5 1.5 0 0 1 3 0v1'), P('M15.5 11a1.5 1.5 0 0 1 3 0v3.5c0 3.4-2.4 6-5.8 6h-.6c-1.9 0-3.3-.8-4.4-2.3l-2.7-3.6a1.5 1.5 0 0 1 2.3-1.9l1.7 1.8')],
    lock: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }], P('M8 10.5V8a4 4 0 0 1 8 0v2.5')],
    clock: [C(12, 12, 8.5), P('M12 7.5V12l3 2')],
    flag: [P('M5.5 21V4'), P('M5.5 4.5h11l-2 3.5 2 3.5h-11')],
    compass: [C(12, 12, 8.5), P('M15.5 8.5l-2 5-5 2 2-5z')],
    layers: [P('M12 4l8 4-8 4-8-4z'), P('M4 12l8 4 8-4'), P('M4 16l8 4 8-4')],
    grid: [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }], P('M9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16')],
    cross: [P('M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z')],
    book: [P('M12 6.6C10.3 5.2 7.7 4.6 4 4.6v13.2c3.7 0 6.3.6 8 2 1.7-1.4 4.3-2 8-2V4.6c-3.7 0-6.3.6-8 2z'), P('M12 6.6v13.2'), P('M14.6 11.2l1.6 1.6 2.9-3.2')],
    pen: [P('M15.5 4.5l4 4L9 19l-5 1 1-5z'), P('M13.5 6.5l4 4')],
    'return': [P('M9 7L5 11l4 4'), P('M5 11h9.5a4.5 4.5 0 0 1 0 9H11')],
    baseline: [P('M3.5 19.5h17'), P('M7.5 19.5v-9M16.5 19.5v-9'), P('M5 10.5h5M14 10.5h5')],
    target: [C(12, 12, 8.5), C(12, 12, 4.5), C(12, 12, 1.2, true)],
    refresh: [P('M19.5 12a7.5 7.5 0 1 1-2.2-5.3'), P('M19.5 4.5v4h-4')],
    edit: [P('M15.5 4.5l4 4L9 19l-5 1 1-5z')],
    trash: [P('M4.5 7h15'), P('M9.5 7V4.5h5V7'), P('M6.5 7l1 13h9l1-13')],
    plus: [P('M12 5v14M5 12h14')]
  };

  function icon(name, o) {
    o = o || {};
    var node = svg('svg', {
      viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor',
      'stroke-width': o.stroke || 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'class': cx('hf-icon', o.cls), focusable: 'false',
      'aria-hidden': o.label ? null : 'true', role: o.label ? 'img' : null, 'aria-label': o.label || null
    });
    var parts = ICONS[name] || ICONS.info;
    for (var i = 0; i < parts.length; i++) node.appendChild(svg(parts[i][0], parts[i][1]));
    return node;
  }

  function mark(o) {
    o = o || {};
    var node = svg('svg', {
      viewBox: '0 0 32 32', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'class': cx('hf-mark', o.cls),
      focusable: 'false', 'aria-hidden': o.title ? null : 'true', role: o.title ? 'img' : null, 'aria-label': o.title || null
    }, [
      // the Long-Horizon mark: the horizon line, a half sun resting on it (accent fill, no stroke) and three rungs that
      // lengthen toward the viewer, steps leading out to the horizon
      svg('path', { d: 'M3.5 14.5h25', 'stroke-width': 2.25 }),
      svg('path', { 'class': 'hf-mark__bulb', d: 'M10 14.5a6 6 0 0 1 12 0z' }),
      svg('path', { d: 'M12.5 18.5h7' }),
      svg('path', { d: 'M9.5 22h13' }),
      svg('path', { d: 'M6.5 25.5h19' })
    ]);
    return node;
  }

  function kbd(key, o) {
    o = o || {};
    return h('kbd', { 'class': cx('hf-kbd', o.cls), 'aria-hidden': o.hidden ? 'true' : null }, [String(key)]);
  }

  /* ---------- buttons and links ---------- */

  function button(label, o) {
    o = o || {};
    var variant = o.variant || 'secondary';
    var kids = [];
    if (o.icon) kids.push(icon(o.icon));
    if (o.iconOnly) kids.push(h('span', { 'class': 'hf-vh' }, [label]));
    else kids.push(h('span', { 'class': 'hf-btn__label' }, [label]));
    if (o.iconAfter) kids.push(icon(o.iconAfter));
    if (o.kbd) kids.push(kbd(o.kbd, { hidden: true }));
    var attrs = {
      type: o.type || 'button',
      'class': cx('hf-btn', 'hf-btn--' + variant, o.size && 'hf-btn--' + o.size, o.block && 'hf-btn--block',
        o.solid && 'hf-btn--solid', o.iconOnly && 'hf-btn--icon', o.cls),
      id: o.id || null,
      'data-go': o.go || null,
      'aria-keyshortcuts': o.kbd ? String(o.kbd) : null,
      title: o.iconOnly ? label : (o.title || null),
      disabled: !!o.disabled
    };
    if (o.attrs) for (var k in o.attrs) if (has(o.attrs, k)) attrs[k] = o.attrs[k];
    var node = h('button', attrs, kids);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  function link(label, href, o) {
    o = o || {};
    var variant = o.variant || 'secondary';
    var external = o.external !== false;
    var kids = [h('span', { 'class': 'hf-btn__label' }, [label])];
    if (external) {
      kids.push(icon('external', { cls: 'hf-ext' }));
      kids.push(h('span', { 'class': 'hf-vh' }, [' (opens in a new tab)']));
    }
    var attrs = {
      href: href,
      'class': variant === 'plain' ? cx('hf-link', o.cls) : cx('hf-btn', 'hf-btn--' + variant, o.size && 'hf-btn--' + o.size, o.block && 'hf-btn--block', o.cls),
      target: external ? '_blank' : null,
      rel: external ? 'noopener' : null,
      id: o.id || null
    };
    if (o.attrs) for (var k in o.attrs) if (has(o.attrs, k)) attrs[k] = o.attrs[k];
    return h('a', attrs, kids);
  }

  /* ---------- surfaces ---------- */

  function card(o) {
    o = o || {};
    var lvl = clamp(o.level || 2, 2, 4);
    var head = null;
    if (o.title || o.sub || o.aside) {
      head = h('div', { 'class': 'hf-card__head' }, [
        h('div', { 'class': 'hf-card__titles' }, [
          o.title ? h('h' + lvl, { 'class': 'hf-card__title' }, [o.title]) : null,
          o.sub ? h('p', { 'class': 'hf-card__sub' }, [o.sub]) : null
        ]),
        o.aside || null
      ]);
    }
    var body = o.body !== undefined ? o.body : o.children;
    var clickable = !!(o.go || o.onClick);
    var node = h(clickable ? 'button' : (o.as || 'div'), {
      'class': cx('hf-card', o.tone && 'hf-card--' + o.tone, clickable && 'hf-card--link', o.cls), id: o.id || null,
      type: clickable ? 'button' : null, 'data-go': o.go || null
    }, [
      head,
      body ? h('div', { 'class': 'hf-card__body' }, toArr(body)) : null,
      o.actions && !clickable ? h('div', { 'class': 'hf-card__actions' }, toArr(o.actions)) : null
    ]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  function listItem(o) {
    o = o || {};
    var tag = o.href ? 'a' : (o.go || o.onClick) ? 'button' : 'div';
    var external = !!o.href && o.external !== false;
    var chevron = o.chevron !== undefined ? o.chevron : tag !== 'div';
    var node = h(tag, {
      'class': cx('hf-list__item', o.cls),
      type: tag === 'button' ? 'button' : null,
      'data-go': o.go || null,
      href: o.href || null,
      target: external ? '_blank' : null,
      rel: external ? 'noopener' : null,
      id: o.id || null
    }, [
      o.icon ? h('span', { 'class': 'hf-list__icon', 'aria-hidden': 'true' }, [icon(o.icon)]) : null,
      h('span', { 'class': 'hf-list__text' }, [
        h('span', { 'class': 'hf-list__title' }, [o.title]),
        o.sub ? h('span', { 'class': 'hf-list__sub' }, [o.sub]) : null
      ]),
      o.meta ? h('span', { 'class': 'hf-list__meta' }, [o.meta]) : null,
      chevron ? icon(external ? 'external' : 'chev-right', { cls: 'hf-list__chev' }) : null,
      external ? h('span', { 'class': 'hf-vh' }, [' (opens in a new tab)']) : null
    ]);
    if (o.onClick) node.addEventListener('click', o.onClick);
    return node;
  }

  function list(items, o) {
    o = o || {};
    return h('ul', { 'class': cx('hf-list', o.cls), 'aria-label': o.label || null }, toArr(items).map(function (it) {
      return h('li', null, [it && it.nodeType ? it : listItem(it)]);
    }));
  }

  function details(summary, content, o) {
    o = o || {};
    return h('details', { 'class': cx('hf-details', o.cls), open: !!o.open }, [
      h('summary', null, [summary]),
      h('div', { 'class': 'hf-details__body' }, toArr(content))
    ]);
  }

  function chip(text, o) {
    o = o || {};
    return h('span', { 'class': cx('hf-chip', o.tone && 'hf-chip--' + o.tone, o.cls), title: o.title || null }, [
      o.icon ? icon(o.icon) : null, text
    ]);
  }

  var GLYPH = {
    nback: function () { return svg('rect', { x: 1.5, y: 1.5, width: 11, height: 11, rx: 1.5 }); },
    relations: function () { return svg('path', { d: 'M7 1.2L13 12.6H1z' }); },
    span: function () { return svg('circle', { cx: 7, cy: 7, r: 5.8 }); },
    vsearch: function () { return svg('path', { d: 'M7 .8L13.2 7 7 13.2.8 7z' }); },
    lab: function () { return svg('path', { d: 'M4 1.2h6l3.4 5.8L10 12.8H4L.6 7z' }); }
  };
  function familyGlyph(family, cls) {
    var f = GLYPH[family] ? family : 'nback';
    return svg('svg', { viewBox: '0 0 14 14', 'class': cx(cls || 'hf-chip__glyph', 'hf-glyph--' + f), 'aria-hidden': 'true', focusable: 'false' }, [GLYPH[f]()]);
  }

  function levelChip(o) {
    o = o || {};
    return h('span', { 'class': cx('hf-chip', 'hf-chip--level', o.cls), title: o.title || null }, [
      familyGlyph(o.family),
      o.name ? h('span', { 'class': 'hf-chip__name' }, [o.name]) : null,
      o.level ? h('span', { 'class': 'hf-chip__lvl' }, [o.level]) : null
    ]);
  }

  /* ---------- stats ---------- */

  function stat(o) {
    o = o || {};
    return h('div', { 'class': cx('hf-stat', o.hero && 'hf-stat--hero', o.cls) }, [
      h('span', { 'class': 'hf-stat__label' }, [o.label]),
      h('span', { 'class': 'hf-stat__value' }, [
        isNum(o.value) ? fmt.num(o.value) : String(o.value === undefined || o.value === null ? '–' : o.value),
        o.unit ? h('span', { 'class': 'hf-stat__unit' }, [o.unit]) : null
      ]),
      o.note ? h('span', { 'class': 'hf-stat__note' }, [o.note]) : null
    ]);
  }
  function stats(arr, o) {
    o = o || {};
    return h('div', { 'class': cx('hf-stats', o.cls) }, toArr(arr).map(function (s) { return s && s.nodeType ? s : stat(s); }));
  }

  /* ---------- session bar ---------- */

  var STATE_WORD = { done: 'done', current: 'now', todo: 'to do', skipped: 'skipped' };

  function sessionBar(o) {
    o = o || {};
    var steps = toArr(o.steps);
    var n = steps.length;
    var cur = -1, doneCount = 0, i;
    for (i = 0; i < n; i++) {
      if (steps[i].state === 'current' && cur < 0) cur = i;
      if (steps[i].state === 'done') doneCount += 1;
    }
    var unit = o.unit || 'Block';
    var title = o.title || (cur >= 0 ? unit + ' ' + (cur + 1) + ' of ' + n
      : doneCount === n && n ? 'All ' + n + ' ' + (o.unitPlural || unit.toLowerCase() + 's') + ' done'
        : doneCount + ' of ' + n + ' done');
    var now = o.now !== undefined ? o.now : (cur >= 0 ? steps[cur].label : '');
    var mode = o.labels || (n <= 6 ? 'all' : 'groups');

    var track = h('ol', { 'class': 'hf-sbar__track', 'aria-label': o.label || 'Session progress' }, steps.map(function (s, j) {
      var state = s.state || 'todo';
      var word = (j + 1) + '. ' + (s.label || unit + ' ' + (j + 1)) + (s.kind === 'warmup' ? ' (warm-up)' : '') + ', ' + (STATE_WORD[state] || state);
      return h('li', {
        'class': cx('hf-sbar__seg', 'is-' + state, s.kind === 'warmup' && 'is-warmup'),
        title: word,
        'aria-current': state === 'current' ? 'step' : null
      }, [h('span', { 'class': 'hf-vh' }, [word])]);
    }));
    track.style.setProperty('--n', String(Math.max(1, n)));

    var labels = null;
    if (mode !== 'none' && n) {
      var runs = [];
      for (i = 0; i < n; i++) {
        var key = mode === 'all' ? '#' + i : (steps[i].group || steps[i].label || '');
        if (runs.length && runs[runs.length - 1].key === key) runs[runs.length - 1].len += 1;
        else runs.push({ key: key, start: i, len: 1, text: mode === 'all' ? (steps[i].label || '') : (steps[i].group || steps[i].label || '') });
      }
      labels = h('div', { 'class': 'hf-sbar__labels', 'aria-hidden': 'true' }, runs.filter(function (r) {
        return mode === 'all' || r.len >= 3 || n <= 6;
      }).map(function (r) {
        var isCur = cur >= r.start && cur < r.start + r.len;
        var node = h('span', { 'class': cx('hf-sbar__label', isCur && 'is-current'), title: r.text || null }, [r.text]);
        node.style.gridColumn = (r.start + 1) + ' / span ' + r.len;
        return node;
      }));
      labels.style.setProperty('--n', String(n));
    }

    return h('div', { 'class': cx('hf-sbar', mode === 'all' && 'hf-sbar--steps', o.cls) }, [
      h('div', { 'class': 'hf-sbar__head' }, [
        h('span', { 'class': 'hf-sbar__count' }, [title]),
        now ? h('span', { 'class': 'hf-sbar__now' }, [now]) : null
      ]),
      track,
      labels
    ]);
  }

  /* ---------- weekly ring ---------- */

  function arcPath(cxp, cyp, r, a0, a1) {
    var rad = Math.PI / 180;
    var x0 = cxp + r * Math.cos(a0 * rad), y0 = cyp + r * Math.sin(a0 * rad);
    var x1 = cxp + r * Math.cos(a1 * rad), y1 = cyp + r * Math.sin(a1 * rad);
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }

  function weeklyRing(o) {
    o = o || {};
    var target = clamp(Math.round(o.target || 4), 1, 7);
    var done = Math.max(0, Math.round(o.done || 0));
    var reached = done >= target;
    var extra = Math.max(0, done - target);
    var sw = 11, r = 46, c = 60;
    var parts = [];
    // bezel: one tick per day of the week, a quiet instrument scale
    for (var t = 0; t < 28; t++) {
      var a = (t * 360 / 28 - 90) * Math.PI / 180;
      var major = t % 4 === 0;
      var r0 = 55.5, r1 = major ? 59.5 : 58;
      parts.push(svg('line', {
        'class': cx('hf-ring__tick', major && 'hf-ring__tick--major'),
        x1: (c + r0 * Math.cos(a)).toFixed(2), y1: (c + r0 * Math.sin(a)).toFixed(2),
        x2: (c + r1 * Math.cos(a)).toFixed(2), y2: (c + r1 * Math.sin(a)).toFixed(2)
      }));
    }
    if (target === 1) {
      parts.push(svg('circle', { 'class': done ? 'hf-ring__done' : 'hf-ring__track', cx: c, cy: c, r: r, 'stroke-width': sw }));
    } else {
      var gap = 3.5, seg = 360 / target;
      for (var i = 0; i < target; i++) {
        var a0 = -90 + i * seg + gap / 2, a1 = a0 + seg - gap;
        parts.push(svg('path', { 'class': i < done ? 'hf-ring__done' : 'hf-ring__track', d: arcPath(c, c, r, a0, a1), 'stroke-width': sw }));
      }
    }
    var sentence = done + ' of ' + target + ' sessions this week' + (extra ? ', plus ' + extra + ' extra' : '') + (reached ? '. Weekly target reached.' : '.');
    var dial = h('div', { 'class': 'hf-ring__dial', role: 'img', 'aria-label': sentence }, [
      svg('svg', { viewBox: '0 0 120 120', 'class': 'hf-ring__svg', 'aria-hidden': 'true', focusable: 'false' }, parts),
      h('div', { 'class': 'hf-ring__center', 'aria-hidden': 'true' }, [
        h('span', { 'class': 'hf-ring__num' }, [String(done)]),
        h('span', { 'class': 'hf-ring__of' }, [reached ? icon('check', { cls: 'hf-ring__check', stroke: 2.75 }) : null, 'of ' + target])
      ])
    ]);
    var note = o.note !== undefined ? o.note
      : reached ? (extra ? 'Target reached, with ' + extra + ' extra.' : 'Target reached. Rest days count too.')
        : done === 0 ? 'A fresh week. Any day works.'
          : (target - done) + ' more to reach your target of ' + target + '.';
    var text = o.compact ? null : h('div', { 'class': 'hf-ring__text' }, [
      h('span', { 'class': 'hf-ring__title' }, [o.title || 'This week']),
      note ? h('span', { 'class': 'hf-ring__note' }, [note]) : null
    ]);
    return h('div', { 'class': cx('hf-ring', 'hf-mot', o.size === 'sm' && 'hf-ring--sm', o.cls) }, [dial, text]);
  }

  /* ---------- zone meter ---------- */

  function zoneMeter(o) {
    o = o || {};
    var lo = isNum(o.min) ? o.min : 0.5, hi = isNum(o.max) ? o.max : 1;
    var f = o.format || function (v) { return fmt.pct(v); };
    function pos(v) { return clamp((v - lo) / (hi - lo), 0, 1) * 100; }
    var scores = toArr(o.scores).slice(-3);
    while (scores.length < 3) scores.unshift(null);
    var mastery = o.mode === 'mastery';
    var qual = isNum(o.qualify) ? o.qualify : 0.85;
    var down = isNum(o.down) ? o.down : 0.73, up = isNum(o.up) ? o.up : 0.87;
    var rowNames = o.labels || ['Earlier', 'Previous', 'Latest'];

    var bands = h('div', { 'class': 'hf-zone__layer', 'aria-hidden': 'true' });
    var lines = h('div', { 'class': 'hf-zone__lines', 'aria-hidden': 'true' });
    function band(cls, a, b) {
      var node = h('div', { 'class': 'hf-zone__band hf-zone__band--' + cls });
      node.style.left = a + '%'; node.style.width = Math.max(0, b - a) + '%';
      bands.appendChild(node);
    }
    // Two-line labels sit beside their line, pointing away from each other; near an edge they flip inward.
    function line(v, word, side) {
      var p = pos(v);
      var ln = h('div', { 'class': 'hf-zone__line' }); ln.style.left = p + '%';
      var mk = h('span', { 'class': 'hf-zone__mark hf-zone__mark--' + side }, [h('span', null, [word]), h('b', null, [f(v)])]);
      mk.style.left = p + '%';
      lines.appendChild(ln); lines.appendChild(mk);
    }
    if (mastery) {
      band('down', 0, pos(qual));
      band('up', pos(qual), 100);
      line(qual, 'Counts at', pos(qual) > 72 ? 'left' : 'right');
    } else {
      band('down', 0, pos(down));
      band('hold', pos(down), pos(up));
      band('up', pos(up), 100);
      line(down, 'Step down', pos(down) < 22 ? 'right' : 'left');
      line(up, 'Step up', pos(up) > 75 ? 'left' : 'right');
    }

    var grid = h('div', { 'class': 'hf-zone__grid' }, [bands, lines]);
    var spoken = [];
    var qualCount = 0;
    scores.forEach(function (v, i) {
      var latest = i === 2;
      var lab = h('span', { 'class': cx('hf-zone__rlabel', latest && 'is-latest') }, [rowNames[i]]);
      lab.style.gridRow = String(i + 2);
      grid.appendChild(lab);
      var row = h('div', { 'class': 'hf-zone__row', 'aria-hidden': 'true' });
      row.style.gridRow = String(i + 2);
      if (isNum(v)) {
        var p = pos(v);
        var isQual = mastery && v >= qual;
        if (isQual) qualCount += 1;
        var dot = h('span', { 'class': cx('hf-zone__dot', latest && 'is-latest', isQual && 'is-qual', (v < lo || v > hi) && 'is-clamped') });
        dot.style.left = p + '%';
        var val = h('span', { 'class': cx('hf-zone__val', p > 80 && 'hf-zone__val--left') }, [f(v)]);
        val.style.left = p + '%';
        row.appendChild(dot); row.appendChild(val);
        spoken.push(rowNames[i] + ' ' + f(v));
      } else {
        spoken.push(rowNames[i] + ': no block yet');
      }
      grid.appendChild(row);
    });
    var axis = h('div', { 'class': 'hf-zone__axis', 'aria-hidden': 'true' }, [h('span', null, [f(lo)]), h('span', null, [f(hi)])]);
    axis.children[0].style.left = '0%';
    axis.children[1].style.left = '100%';
    grid.appendChild(axis);

    var summary = o.summary !== undefined ? o.summary
      : mastery ? qualCount + ' of the last 3 count toward the next step'
        : 'Last three blocks';
    var sr = (o.title ? o.title + '. ' : '') + spoken.join(', ') + '. ' +
      (mastery ? 'A block counts at ' + f(qual) + ' or more.' : 'Steps down below ' + f(down) + ', steps up at ' + f(up) + ' or more.');
    return h('figure', { 'class': cx('hf-zone', 'hf-mot', o.cls) }, [
      h('figcaption', { 'class': 'hf-zone__cap' }, [
        o.title ? h('span', { 'class': 'hf-zone__title' }, [o.title]) : null,
        summary ? h('span', { 'class': 'hf-zone__sum' }, [summary]) : null
      ]),
      grid,
      h('p', { 'class': 'hf-vh' }, [sr])
    ]);
  }

  /* ---------- badges ---------- */

  var TEXT_GLYPH = { n3: '3', n5: '5' };
  function medal(o) {
    var parts = [svg('circle', { 'class': 'hf-medal__rim', cx: 28, cy: 28, r: 26 })];
    for (var t = 0; t < 24; t++) {
      var a = t * 15 * Math.PI / 180, major = t % 6 === 0;
      var r0 = major ? 20.6 : 21.8, r1 = 23.6;
      parts.push(svg('line', {
        'class': 'hf-medal__tick',
        x1: (28 + r0 * Math.cos(a)).toFixed(2), y1: (28 + r0 * Math.sin(a)).toFixed(2),
        x2: (28 + r1 * Math.cos(a)).toFixed(2), y2: (28 + r1 * Math.sin(a)).toFixed(2)
      }));
    }
    parts.push(svg('circle', { 'class': 'hf-medal__face', cx: 28, cy: 28, r: 19 }));
    var text = o.text || TEXT_GLYPH[o.glyph];
    if (text) {
      parts.push(svg('text', { 'class': 'hf-medal__text', x: 28, y: 28, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': text.length > 1 ? 15 : 21 }, [text]));
    } else {
      var g = svg('g', { 'class': 'hf-medal__glyph', transform: 'translate(16 16)' });
      var spec = ICONS[o.glyph] || ICONS.star;
      for (var i = 0; i < spec.length; i++) g.appendChild(svg(spec[i][0], spec[i][1]));
      parts.push(g);
    }
    return svg('svg', { viewBox: '0 0 56 56', 'class': 'hf-badge__medal', 'aria-hidden': 'true', focusable: 'false' }, parts);
  }

  function badge(o) {
    o = o || {};
    var earned = !!o.earned;
    var hide = !earned && o.secret;
    return h('div', { 'class': cx('hf-badge', !earned && 'hf-badge--locked', o.tone && o.tone !== 'blue' && 'hf-badge--' + o.tone, o.cls) }, [
      medal(hide ? { glyph: 'lock' } : o),
      h('span', { 'class': 'hf-badge__title' }, [hide ? 'Not yet earned' : o.title]),
      !hide && o.desc ? h('span', { 'class': 'hf-badge__desc' }, [o.desc]) : null,
      h('span', { 'class': 'hf-badge__date' }, [earned ? (o.date ? 'Earned ' + o.date : 'Earned') : (hide ? 'Keep training to find it' : 'Not yet earned')])
    ]);
  }
  function badges(arr, o) {
    o = o || {};
    return h('div', { 'class': cx('hf-badges', 'hf-mot', o.cls) }, toArr(arr).map(function (b) { return b && b.nodeType ? b : badge(b); }));
  }

  /* ---------- rule card ---------- */

  function tape(o) {
    o = o || {};
    var items = toArr(o.items);
    var n = items.length;
    var hasPair = isNum(o.target) && isNum(o.compare);
    var row = h('div', { 'class': 'hf-tape__row', 'aria-hidden': 'true' }, items.map(function (it, i) {
      var t = it && typeof it === 'object' && !it.nodeType ? it.t : it;
      return h('span', {
        'class': cx('hf-tape__cell', i === o.target && 'is-target', i === o.compare && 'is-compare', toArr(o.dim).indexOf(i) >= 0 && 'is-dim')
      }, [t]);
    }));
    row.style.setProperty('--n', String(n));
    var kids = [row];
    if (hasPair) {
      var a = Math.min(o.target, o.compare), b = Math.max(o.target, o.compare);
      var k = b - a + 1;
      var br = h('div', { 'class': 'hf-tape__bracket' });
      br.style.gridColumn = (a + 1) + ' / span ' + k;
      br.style.marginInline = 'calc((100% - ' + (k - 1) + ' * 0.375rem) / ' + (2 * k) + ')';
      var lab = h('div', { 'class': 'hf-tape__label' }, [o.label || '']);
      lab.style.gridColumn = (a + 1) + ' / span ' + k;
      var under = h('div', { 'class': 'hf-tape__row', 'aria-hidden': 'true' }, [br]);
      var under2 = h('div', { 'class': 'hf-tape__row', 'aria-hidden': 'true' }, [lab]);
      under.style.setProperty('--n', String(n));
      under2.style.setProperty('--n', String(n));
      kids.push(under);
      if (o.label) kids.push(under2);
    }
    if (o.caption) kids.push(h('p', { 'class': 'hf-tape__caption' }, [o.caption]));
    else if (o.spoken) kids.push(h('p', { 'class': 'hf-vh' }, [o.spoken]));
    return h('div', { 'class': cx('hf-tape', o.cls) }, kids);
  }

  function keys(rows) {
    return h('ul', { 'class': 'hf-keys' }, toArr(rows).map(function (r) {
      var act;
      if (r.none) act = [h('span', { 'class': 'hf-keys__none' }, [r.text || 'Do nothing'])];
      else act = [
        r.key ? kbd(r.key) : null,
        r.key && r.pad ? h('span', { 'class': 'hf-keys__or' }, ['or tap']) : null,
        r.pad ? h('span', { 'class': cx('hf-keys__pad', r.yes && 'hf-keys__pad--yes') }, [r.pad]) : null
      ];
      return h('li', { 'class': 'hf-keys__row' }, [
        h('span', { 'class': 'hf-keys__do' }, act),
        h('span', { 'class': 'hf-keys__when' }, [r.when ? (/^(when|if|while|after|before|once|as|until)\b/i.test(r.when) ? r.when : 'when ' + r.when) : ''])
      ]);
    }));
  }

  function ruleCard(o) {
    o = o || {};
    var titleId = uid('hf-rule');
    var ex = o.example;
    var exNode = !ex ? null : ex.nodeType ? ex : typeof ex === 'string' ? h('p', { 'class': 'hf-rule__note' }, [ex]) : tape(ex);
    var hint = o.hint === false ? null : h('p', { 'class': 'hf-rule__hint' }, [
      h('span', null, [kbd('Space'), ' start']),
      h('span', null, [kbd('Esc'), ' or ', kbd('P'), ' pause'])
    ]);
    return h('section', { 'class': cx('hf-rule', o.cls), 'aria-labelledby': titleId }, [
      h('div', { 'class': 'hf-rule__top' }, [
        o.chip ? (o.chip.nodeType ? o.chip : levelChip(o.chip)) : null,
        o.meta ? h('span', { 'class': 'hf-rule__meta' }, [o.meta]) : null
      ]),
      h('h2', { 'class': o.title ? 'hf-rule__title' : 'hf-vh', id: titleId }, [o.title || 'Rule for this block']),
      h('p', { 'class': 'hf-rule__text' }, [o.rule]),
      exNode,
      o.keys ? keys(o.keys) : null,
      o.note ? h('p', { 'class': 'hf-rule__note' }, [o.note]) : null,
      (hint || o.actions) ? h('div', { 'class': 'hf-rule__foot' }, [hint, o.actions ? h('div', { 'class': 'hf-actions' }, toArr(o.actions)) : null]) : null
    ]);
  }

  /* ---------- debrief ---------- */

  var DIR = { up: { icon: 'up', word: 'Steps up' }, down: { icon: 'down', word: 'Eases back' }, same: { icon: 'hold', word: 'Stays' } };

  function debrief(o) {
    o = o || {};
    var lineId = uid('hf-db');
    var dir = DIR[o.dir] ? o.dir : null;
    var scoreText = isNum(o.score) ? fmt.pct(o.score) : (o.score || null);
    var det = null;
    if (o.details) {
      var inner = o.details.nodeType ? o.details : dl(o.details);
      det = details(o.detailsLabel || 'Details', inner);
    }
    var count = o.count || (isNum(o.index) && isNum(o.total) ? 'Block ' + o.index + ' of ' + o.total : null);
    var cheerText = o.cheer || (o.celebrate === 'level' ? 'New level reached' : o.celebrate === 'best' ? 'New personal best' : null);
    return h('section', { 'class': cx('hf-debrief', o.celebrate && 'hf-debrief--celebrate', o.cls), 'aria-labelledby': lineId }, [
      (count || o.chip) ? h('div', { 'class': 'hf-debrief__top' }, [
        count ? h('span', { 'class': 'hf-debrief__count' }, [count]) : null,
        o.chip ? (o.chip.nodeType ? o.chip : levelChip(o.chip)) : null
      ]) : null,
      h('h2', { 'class': 'hf-debrief__line', id: lineId }, [o.line]),
      cheerText ? h('p', { 'class': 'hf-debrief__cheer hf-mot' }, [icon('star'), cheerText]) : null,
      (scoreText || o.next) ? h('div', { 'class': 'hf-debrief__facts' }, [
        scoreText ? h('div', { 'class': 'hf-debrief__fact' }, [
          h('span', { 'class': 'hf-debrief__k' }, [o.scoreLabel || 'Block score']),
          h('span', { 'class': 'hf-debrief__score' }, [scoreText])
        ]) : null,
        o.next ? h('div', { 'class': 'hf-debrief__fact' }, [
          h('span', { 'class': 'hf-debrief__k' }, [o.nextLabel || 'Next block']),
          h('span', { 'class': 'hf-debrief__v' }, [
            dir ? h('span', { 'class': 'hf-debrief__dir hf-debrief__dir--' + dir, title: DIR[dir].word }, [icon(DIR[dir].icon), h('span', { 'class': 'hf-vh' }, [DIR[dir].word + ': '])]) : null,
            h('span', null, [o.next])
          ])
        ]) : null
      ]) : null,
      det,
      (o.actions || o.auto) ? h('div', { 'class': 'hf-debrief__actions' }, [
        o.auto ? h('span', { 'class': 'hf-debrief__auto' }, [o.auto]) : h('span'),
        o.actions ? h('div', { 'class': 'hf-actions' }, toArr(o.actions)) : null
      ]) : null
    ]);
  }

  function dl(rows) {
    var kids = [];
    toArr(rows).forEach(function (r) {
      kids.push(h('dt', null, [r.label, r.hint ? h('span', { 'class': 'hf-dl__hint' }, [r.hint]) : null]));
      kids.push(h('dd', null, [r.value === undefined || r.value === null ? '–' : String(r.value)]));
    });
    return h('dl', { 'class': 'hf-dl' }, kids);
  }

  /* ---------- tables ---------- */

  function table(o) {
    o = o || {};
    var cols = toArr(o.columns);
    var tbl = h('table', { 'class': cx('hf-table', o.cls) }, [
      o.caption ? h('caption', null, [o.caption]) : null,
      h('thead', null, [h('tr', null, cols.map(function (c) { return h('th', { scope: 'col', 'class': c.num ? 'n' : null }, [c.label]); }))]),
      h('tbody', null, toArr(o.rows).map(function (r) {
        return h('tr', null, cols.map(function (c, i) {
          var v = r[c.key];
          var text = v === undefined || v === null ? '' : (c.format ? c.format(v, r) : String(v));
          return h(i === 0 && o.rowHeaders !== false ? 'th' : 'td', { scope: i === 0 && o.rowHeaders !== false ? 'row' : null, 'class': c.num ? 'n' : null }, [text]);
        }));
      }))
    ]);
    return h('div', { 'class': 'hf-table-wrap', tabindex: '0', role: 'region', 'aria-label': o.label || o.caption || 'Table' }, [tbl]);
  }

  /* ---------- charts: shared ---------- */

  function niceStep(range, count) {
    if (!(range > 0)) return 1;
    var raw = range / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    return (n >= 7.5 ? 10 : n >= 3.5 ? 5 : n >= 1.5 ? 2 : 1) * mag;
  }
  function ticksFor(lo, hi, count) {
    var st = niceStep(hi - lo, count), out = [];
    var start = Math.ceil(lo / st - 1e-9) * st;
    for (var v = start; v <= hi + st * 1e-9 && out.length < 50; v += st) out.push(+v.toFixed(10));
    return out;
  }
  function rootPx() {
    try { return parseFloat(root.getComputedStyle(doc.documentElement).fontSize) || 16; } catch (e) { return 16; }
  }
  function smoothVals(ys, w) {
    if (!w || w < 2) return ys.slice();
    var half = Math.floor(w / 2), out = [];
    for (var i = 0; i < ys.length; i++) {
      var s = 0, c = 0;
      for (var j = Math.max(0, i - half); j <= Math.min(ys.length - 1, i + half); j++) if (isNum(ys[j])) { s += ys[j]; c += 1; }
      out.push(c ? s / c : null);
    }
    return out;
  }
  function sign(v) { return v < 0 ? -1 : 1; }
  function monotonePath(pts) {
    var n = pts.length, i;
    if (!n) return '';
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    if (n === 1) return d;
    if (n === 2) return d + 'L' + pts[1][0].toFixed(1) + ' ' + pts[1][1].toFixed(1);
    var hs = [], ss = [], m = [];
    for (i = 0; i < n - 1; i++) {
      hs[i] = pts[i + 1][0] - pts[i][0];
      ss[i] = hs[i] ? (pts[i + 1][1] - pts[i][1]) / hs[i] : 0;
    }
    for (i = 1; i < n - 1; i++) {
      var h0 = hs[i - 1], h1 = hs[i], s0 = ss[i - 1], s1 = ss[i];
      var p = (s0 * h1 + s1 * h0) / ((h0 + h1) || 1);
      m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
    }
    m[0] = hs[0] ? (3 * ss[0] - m[1]) / 2 : 0;
    m[n - 1] = hs[n - 2] ? (3 * ss[n - 2] - m[n - 2]) / 2 : 0;
    if (sign(m[0]) !== sign(ss[0]) || Math.abs(m[0]) > 3 * Math.abs(ss[0])) m[0] = ss[0];
    if (sign(m[n - 1]) !== sign(ss[n - 2]) || Math.abs(m[n - 1]) > 3 * Math.abs(ss[n - 2])) m[n - 1] = ss[n - 2];
    for (i = 0; i < n - 1; i++) {
      var dx = hs[i] / 3;
      d += 'C' + (pts[i][0] + dx).toFixed(1) + ' ' + (pts[i][1] + m[i] * dx).toFixed(1) + ' ' +
        (pts[i + 1][0] - dx).toFixed(1) + ' ' + (pts[i + 1][1] - m[i + 1] * dx).toFixed(1) + ' ' +
        pts[i + 1][0].toFixed(1) + ' ' + pts[i + 1][1].toFixed(1);
    }
    return d;
  }
  function stepPath(pts) {
    var d = '';
    for (var i = 0; i < pts.length; i++) {
      if (!i) d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
      else d += 'H' + pts[i][0].toFixed(1) + 'V' + pts[i][1].toFixed(1);
    }
    return d;
  }
  function lineKey(slot) {
    return svg('svg', { viewBox: '0 0 16 12', 'class': 'hf-legend__key', 'aria-hidden': 'true', focusable: 'false' },
      [svg('line', { x1: 1, y1: 6, x2: 15, y2: 6, 'class': 'hf-chart__line hf-s' + slot })]);
  }
  function markerKey(kind) {
    return svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'class': 'hf-legend__mkey', 'aria-hidden': 'true', focusable: 'false' },
      [svg('line', { x1: 8, y1: 6, x2: 8, y2: 16, 'class': 'hf-chart__marker hf-chart__marker--' + kind }), markerGlyph(kind, 8, 5)]);
  }
  function markerGlyph(kind, x, y) {
    if (kind === 'rule') return svg('path', { 'class': 'hf-chart__mglyph', d: 'M' + x + ' ' + (y - 4.5) + 'l4.5 8h-9z' });
    return svg('path', { 'class': 'hf-chart__mglyph', d: 'M' + x + ' ' + (y - 5) + 'l4.5 4.5-4.5 4.5-4.5-4.5z' });
  }
  function tip() { return h('div', { 'class': 'hf-tip', hidden: true, 'aria-hidden': 'true' }); }
  function placeTip(tipEl, plotW, x, y) {
    tipEl.hidden = false;
    var w = tipEl.offsetWidth || 140;
    var left = x + 14;
    if (left + w > plotW) left = Math.max(0, x - 14 - w);
    tipEl.style.left = left + 'px';
    tipEl.style.top = Math.max(0, y) + 'px';
  }

  /* ---------- line chart ---------- */

  function lineChart(o) {
    o = o || {};
    var xo = o.x || {}, yo = o.y || {};
    var xf = xo.format || function (v) { return fmt.num(v); };
    var yf = yo.format || function (v) { return fmt.num(v); };
    var series = toArr(o.series).slice(0, 3).map(function (s, i) {
      var pts = toArr(s.points).filter(function (p) { return p && isNum(p.x) && isNum(p.y); })
        .sort(function (a, b) { return a.x - b.x; });
      var ys = pts.map(function (p) { return p.y; });
      var sm = smoothVals(ys, o.smooth === undefined ? 0 : o.smooth);
      return { name: s.name || 'Series ' + (i + 1), slot: clamp(s.slot || i + 1, 1, 3), pts: pts, sm: sm };
    });
    var markers = toArr(o.markers).filter(function (m) { return m && isNum(m.x); }).sort(function (a, b) { return a.x - b.x; });
    var xsMap = {}, xs = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { if (!xsMap[p.x]) { xsMap[p.x] = 1; xs.push(p.x); } }); });
    xs.sort(function (a, b) { return a - b; });
    var smoothed = o.smooth && o.smooth > 1;

    // 2+ series: the lines also differ by dash pattern (css .hf-chart--multi), not by colour alone (Phase 4, UX-17)
    var fig = h('figure', { 'class': cx('hf-chart', 'hf-chart--line', series.length > 1 && 'hf-chart--multi', o.cls) });
    var head = (o.title || o.desc) ? h('figcaption', { 'class': 'hf-chart__head' }, [
      o.title ? h('span', { 'class': 'hf-chart__title' }, [o.title]) : null,
      o.desc ? h('span', { 'class': 'hf-chart__desc' }, [o.desc]) : null
    ]) : null;
    if (head) fig.appendChild(head);

    var legendItems = [];
    if (series.length > 1) series.forEach(function (s) {
      legendItems.push(h('li', { 'class': 'hf-legend__item' }, [lineKey(s.slot), s.name]));
    });
    var kindsUsed = {};
    markers.forEach(function (m) { kindsUsed[m.kind === 'rule' ? 'rule' : 'mode'] = 1; });
    if (kindsUsed.mode) legendItems.push(h('li', { 'class': 'hf-legend__item' }, [markerKey('mode'), o.modeLabel || 'Training style changed']));
    if (kindsUsed.rule) legendItems.push(h('li', { 'class': 'hf-legend__item' }, [markerKey('rule'), o.ruleLabel || 'Rule or tier changed']));
    if (legendItems.length) fig.appendChild(h('ul', { 'class': 'hf-legend', 'aria-hidden': 'true' }, legendItems));

    var last = series.length && series[0].pts.length ? series[0].pts[series[0].pts.length - 1] : null;
    var summary = o.summary || ((o.title || 'Line chart') + ': ' + xs.length + ' points' +
      (last ? ', latest ' + yf(last.y) + ' at ' + xf(last.x) : '') + '. A table version follows.');
    var plot = h('div', { 'class': 'hf-chart__plot', tabindex: xs.length ? '0' : null, role: 'img', 'aria-label': summary });
    var tipEl = tip();
    fig.appendChild(plot);

    if (!xs.length) {
      plot.appendChild(h('p', { 'class': 'hf-muted hf-small' }, [o.emptyText || 'No data yet.']));
      return fig;
    }

    var state = { idx: -1, W: 0, px: null, py: null, mT: 0, ph: 0, cross: null, hots: [] };

    function draw(W) {
      state.W = W;
      var scale = rootPx() / 16;
      var fs = 12 * scale;
      var H = o.height || Math.round((W < 480 ? 200 : 240) * Math.max(1, scale * 0.95));
      var allY = [];
      series.forEach(function (s) { s.pts.forEach(function (p) { allY.push(p.y); }); });
      var ylo = isNum(yo.min) ? yo.min : Math.min.apply(null, allY);
      var yhi = isNum(yo.max) ? yo.max : Math.max.apply(null, allY);
      if (ylo === yhi) { ylo -= 1; yhi += 1; }
      var yt = ticksFor(ylo, yhi, H < 220 ? 3 : 4);
      if (!isNum(yo.min)) ylo = Math.min(ylo, yt[0]);
      if (!isNum(yo.max)) yhi = Math.max(yhi, yt[yt.length - 1]);
      var x0 = isNum(xo.min) ? xo.min : xs[0], x1 = isNum(xo.max) ? xo.max : xs[xs.length - 1];
      if (x0 === x1) { x0 -= 0.5; x1 += 0.5; }
      var labW = 0;
      yt.forEach(function (t) { labW = Math.max(labW, String(yf(t)).length * fs * 0.62); });
      var endW = 0;
      series.forEach(function (s) {
        var v = s.sm[s.sm.length - 1];
        if (isNum(v)) endW = Math.max(endW, String(yf(v)).length * fs * 0.62 + 12);
      });
      var mL = Math.round(labW + 14), mR = Math.round(Math.max(12, endW)), rowH = fs + 5;
      var mT = markers.length ? Math.round(2 * rowH + 8) : Math.round(fs * 0.6);
      var mB = Math.round(xo.label ? fs * 2 + 20 : fs + 14);
      var pw = Math.max(40, W - mL - mR), ph = Math.max(40, H - mT - mB);
      function px(x) { return mL + (x - x0) / (x1 - x0) * pw; }
      function py(y) { return mT + ph - (y - ylo) / (yhi - ylo) * ph; }
      state.px = px; state.py = py; state.mT = mT; state.ph = ph;

      var parts = [];
      yt.forEach(function (t) {
        if (t < ylo - 1e-9 || t > yhi + 1e-9) return;
        var y = Math.round(py(t)) + 0.5;
        parts.push(svg('line', { 'class': 'hf-chart__grid', x1: mL, x2: mL + pw, y1: y, y2: y }));
        parts.push(svg('text', { x: mL - 8, y: y, dy: '0.32em', 'text-anchor': 'end' }, [String(yf(t))]));
      });
      var by = Math.round(mT + ph) + 0.5;
      parts.push(svg('line', { 'class': 'hf-chart__axis', x1: mL, x2: mL + pw, y1: by, y2: by }));
      var xt = xo.ticks || ticksFor(x0, x1, Math.max(3, Math.floor(pw / (fs * 6))));
      if (xo.integer !== false) xt = xt.filter(function (t) { return Math.abs(t - Math.round(t)) < 1e-9; });
      xt.forEach(function (t) {
        if (t < x0 - 1e-9 || t > x1 + 1e-9) return;
        var x = Math.round(px(t)) + 0.5;
        parts.push(svg('line', { 'class': 'hf-chart__tick', x1: x, x2: x, y1: by, y2: by + 4 }));
        parts.push(svg('text', { x: x, y: by + fs + 6, 'text-anchor': 'middle' }, [String(xf(t))]));
      });
      if (xo.label) parts.push(svg('text', { x: mL + pw / 2, y: H - 3, 'text-anchor': 'middle', 'class': 'hf-chart__xlabel' }, [xo.label]));

      // markers: vertical rules with labels in two rows, no overlaps
      var rowEnd = [-1e9, -1e9];
      markers.forEach(function (m) {
        var kind = m.kind === 'rule' ? 'rule' : 'mode';
        var x = Math.round(px(m.x)) + 0.5;
        parts.push(svg('line', { 'class': 'hf-chart__marker hf-chart__marker--' + kind, x1: x, x2: x, y1: mT - 4, y2: mT + ph }));
        var text = m.label || '';
        var w = text.length * fs * 0.58 + 14;
        var start = clamp(x - 5, 0, Math.max(0, W - w));
        var row = start >= rowEnd[0] + 6 ? 0 : start >= rowEnd[1] + 6 ? 1 : -1;
        var gy = row === 1 ? 4 + rowH * 1.5 : 4 + rowH * 0.5;
        if (row < 0) { parts.push(markerGlyph(kind, x, mT - 9)); return; }
        rowEnd[row] = start + w;
        parts.push(markerGlyph(kind, start + 5, gy));
        parts.push(svg('text', { 'class': 'hf-chart__mlabel', x: start + 13, y: gy, dy: '0.32em' }, [text]));
      });

      series.forEach(function (s) {
        var cls = 'hf-s' + s.slot;
        var raw = s.pts.map(function (p) { return [px(p.x), py(p.y)]; });
        var sm = [];
        s.pts.forEach(function (p, i) { if (isNum(s.sm[i])) sm.push([px(p.x), py(s.sm[i])]); });
        if (smoothed) raw.forEach(function (q) { parts.push(svg('circle', { 'class': 'hf-chart__raw ' + cls, cx: q[0].toFixed(1), cy: q[1].toFixed(1), r: 2.5 })); });
        parts.push(svg('path', { 'class': 'hf-chart__line ' + cls, d: o.curve === 'step' ? stepPath(sm) : o.curve === 'linear' ? 'M' + sm.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L') : monotonePath(sm) }));
        var e = sm[sm.length - 1];
        if (e) {
          parts.push(svg('circle', { 'class': 'hf-chart__end ' + cls, cx: e[0].toFixed(1), cy: e[1].toFixed(1), r: 4.5 }));
          parts.push(svg('text', { 'class': 'hf-chart__endlabel', x: (e[0] + 8).toFixed(1), y: e[1].toFixed(1), dy: '0.32em' }, [String(yf(s.sm[s.sm.length - 1]))]));
        }
      });

      var cross = svg('line', { 'class': 'hf-chart__cross', x1: 0, x2: 0, y1: mT, y2: mT + ph, visibility: 'hidden' });
      parts.push(cross);
      state.cross = cross;
      state.hots = series.map(function (s) {
        var c = svg('circle', { 'class': 'hf-chart__hot hf-s' + s.slot, r: 5, cx: 0, cy: 0, visibility: 'hidden' });
        parts.push(c);
        return c;
      });
      var node = svg('svg', { 'class': 'hf-chart__svg', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' }, parts);
      while (plot.firstChild) plot.removeChild(plot.firstChild);
      plot.appendChild(node);
      plot.appendChild(tipEl);
      if (state.idx >= 0) show(state.idx);
    }

    function show(i) {
      if (!state.px || i < 0 || i >= xs.length) return;
      state.idx = i;
      var x = xs[i], X = state.px(x);
      state.cross.setAttribute('x1', X); state.cross.setAttribute('x2', X);
      state.cross.setAttribute('visibility', 'visible');
      while (tipEl.firstChild) tipEl.removeChild(tipEl.firstChild);
      tipEl.appendChild(h('div', { 'class': 'hf-tip__head' }, [xo.tipLabel ? xo.tipLabel(x) : (xo.label ? xo.label + ' ' : '') + xf(x)]));
      var topY = state.mT + state.ph;
      series.forEach(function (s, k) {
        var j = -1;
        for (var q = 0; q < s.pts.length; q++) if (s.pts[q].x === x) { j = q; break; }
        var hot = state.hots[k];
        if (j < 0 || !isNum(s.sm[j])) { hot.setAttribute('visibility', 'hidden'); return; }
        var Y = state.py(s.sm[j]);
        topY = Math.min(topY, Y);
        hot.setAttribute('cx', X); hot.setAttribute('cy', Y); hot.setAttribute('visibility', 'visible');
        var valText = String(yf(s.pts[j].y));
        tipEl.appendChild(h('div', { 'class': 'hf-tip__row' }, [
          lineKey(s.slot),
          h('span', { 'class': 'hf-tip__val' }, [valText]),
          h('span', { 'class': 'hf-tip__name' }, [series.length > 1 ? s.name : (smoothed ? 'trend ' + yf(s.sm[j]) : (yo.label || ''))])
        ]));
      });
      markers.forEach(function (m) {
        if (m.x === x && m.label) tipEl.appendChild(h('div', { 'class': 'hf-tip__row hf-tip__name' }, [m.label]));
      });
      placeTip(tipEl, state.W, X, Math.max(0, topY - 40));
    }
    function hide() {
      state.idx = -1;
      if (state.cross) state.cross.setAttribute('visibility', 'hidden');
      state.hots.forEach(function (c) { c.setAttribute('visibility', 'hidden'); });
      tipEl.hidden = true;
    }
    plot.addEventListener('pointermove', function (e) {
      if (!state.px) return;
      var rect = plot.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (state.W / (rect.width || state.W));
      var best = 0, bd = Infinity;
      for (var i = 0; i < xs.length; i++) { var d = Math.abs(state.px(xs[i]) - mx); if (d < bd) { bd = d; best = i; } }
      show(best);
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('focus', function () { show(state.idx >= 0 ? state.idx : xs.length - 1); });
    plot.addEventListener('keydown', function (e) {
      var k = e.key, i = state.idx < 0 ? xs.length - 1 : state.idx;
      if (k === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (k === 'ArrowRight') i = Math.min(xs.length - 1, i + 1);
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = xs.length - 1;
      else if (k === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      show(i);
    });

    draw(o.width || 640);
    var lastW = 0;
    if (root.ResizeObserver) {
      var ro = new root.ResizeObserver(function () {
        var w = Math.round(plot.clientWidth || 0);
        if (w > 0 && Math.abs(w - lastW) >= 2) { lastW = w; draw(w); }
      });
      ro.observe(plot);
    }

    // table view: the accessible twin
    var cols = [{ key: 'x', label: xo.label || 'Point', format: function (v) { return String(xf(v)); } }];
    series.forEach(function (s, k) { cols.push({ key: 's' + k, label: s.name, num: true }); });
    if (smoothed) series.forEach(function (s, k) { cols.push({ key: 't' + k, label: (series.length > 1 ? s.name + ' ' : '') + 'trend', num: true }); });
    if (markers.length) cols.push({ key: 'note', label: 'Changes' });
    var rows = xs.map(function (x) {
      var r = { x: x };
      series.forEach(function (s, k) {
        for (var q = 0; q < s.pts.length; q++) if (s.pts[q].x === x) {
          r['s' + k] = String(yf(s.pts[q].y));
          if (smoothed && isNum(s.sm[q])) r['t' + k] = String(yf(s.sm[q]));
        }
      });
      var notes = markers.filter(function (m) { return m.x === x; }).map(function (m) { return m.label; });
      if (notes.length) r.note = notes.join('; ');
      return r;
    });
    fig.appendChild(details(o.tableLabel || 'Show as table', table({ columns: cols, rows: rows, label: (o.title || 'Chart') + ' as a table' }), { cls: 'hf-chart__table' }));
    return fig;
  }

  /* ---------- dot plot ---------- */

  var SHAPES = {
    circle: function () { return svg('circle', { 'class': 'hf-shape', r: 5.5 }); },
    square: function () { return svg('rect', { 'class': 'hf-shape', x: -5, y: -5, width: 10, height: 10, rx: 1.5 }); },
    diamond: function () { return svg('path', { 'class': 'hf-shape', d: 'M0 -6.6L6.6 0 0 6.6-6.6 0z' }); },
    triangle: function () { return svg('path', { 'class': 'hf-shape', d: 'M0 -6.4L6.3 4.9H-6.3z' }); },
    down: function () { return svg('path', { 'class': 'hf-shape', d: 'M0 6.4L6.3 -4.9H-6.3z' }); }
  };
  var DEFAULT_KINDS = [
    { id: 'B1', label: 'Baseline 1', shape: 'circle', tone: 'muted' },
    { id: 'B2', label: 'Baseline 2', shape: 'square', tone: 'muted' },
    { id: 'Q', label: 'Quick check', shape: 'down', tone: 's3' },
    { id: 'POST', label: 'Post-test', shape: 'diamond', tone: 's1' },
    { id: 'FU', label: 'Follow-up', shape: 'triangle', tone: 's2' }
  ];
  function shapeSvg(kind, legend) {
    var sh = SHAPES[kind.shape] ? kind.shape : 'circle';
    return svg('svg', { viewBox: '-7.5 -7.5 15 15', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false', 'class': cx('hf-shape--' + (kind.tone || 's1'), legend && 'hf-legend__shape') }, [SHAPES[sh]()]);
  }

  function dotPlot(o) {
    o = o || {};
    var kinds = toArr(o.kinds).length ? toArr(o.kinds) : DEFAULT_KINDS;
    var kindMap = {};
    kinds.forEach(function (k) { kindMap[k.id] = k; });
    var f = o.format || function (v) { return fmt.num(v); };
    var rows = toArr(o.rows);
    var vals = [];
    rows.forEach(function (r) {
      toArr(r.points).forEach(function (p) { if (isNum(p.value)) vals.push(p.value); });
      if (r.band && isNum(r.band.lo) && isNum(r.band.hi)) { vals.push(r.band.lo); vals.push(r.band.hi); }
    });
    var lo = isNum(o.min) ? o.min : vals.length ? Math.min.apply(null, vals) : 0;
    var hi = isNum(o.max) ? o.max : vals.length ? Math.max.apply(null, vals) : 1;
    if (lo === hi) { lo -= 1; hi += 1; }
    var tk = ticksFor(lo, hi, 4);
    if (!isNum(o.min)) lo = Math.min(lo, tk[0]);
    if (!isNum(o.max)) hi = Math.max(hi, tk[tk.length - 1]);
    tk = tk.filter(function (t) { return t >= lo - 1e-9 && t <= hi + 1e-9; });
    function pos(v) { return clamp((v - lo) / (hi - lo), 0, 1) * 100; }

    var used = {}, anyBand = false;
    rows.forEach(function (r) { toArr(r.points).forEach(function (p) { used[p.kind] = 1; }); if (r.band) anyBand = true; });
    var legend = h('ul', { 'class': 'hf-legend', 'aria-hidden': 'true' }, kinds.filter(function (k) { return used[k.id]; }).map(function (k) {
      return h('li', { 'class': 'hf-legend__item' }, [shapeSvg(k, true), k.label]);
    }).concat(anyBand ? [h('li', { 'class': 'hf-legend__item' }, [h('span', { 'class': 'hf-legend__band' }), o.bandLabel || 'Noise band'])] : []));

    var flatPts = [];
    var gridEl = h('div', { 'class': 'hf-dots__grid' });
    var tipEl = tip();
    rows.forEach(function (r, ri) {
      var track = h('div', { 'class': 'hf-dots__track' });
      tk.forEach(function (t) { var gl = h('span', { 'class': 'hf-dots__gl' }); gl.style.left = pos(t) + '%'; track.appendChild(gl); });
      if (r.band && isNum(r.band.lo) && isNum(r.band.hi)) {
        var b = h('span', { 'class': 'hf-dots__band' });
        b.style.left = pos(r.band.lo) + '%';
        b.style.width = Math.max(0.5, pos(r.band.hi) - pos(r.band.lo)) + '%';
        track.appendChild(b);
      }
      var pts = toArr(r.points).filter(function (p) { return isNum(p.value); });
      var placed = [];
      pts.forEach(function (p) {
        var k = kindMap[p.kind] || { id: p.kind, label: p.kind || 'Value', shape: 'circle', tone: 's1' };
        var x = pos(p.value);
        var near = 0;
        placed.forEach(function (q) { if (Math.abs(q - x) < 3.5) near += 1; });
        placed.push(x);
        var node = h('span', { 'class': 'hf-dots__pt', 'data-i': String(flatPts.length) }, [shapeSvg(k)]);
        node.style.left = x + '%';
        if (near) node.style.marginTop = (near % 2 ? -1.15 : 0.35) + 'rem';
        track.appendChild(node);
        flatPts.push({ node: node, track: track, row: r, kind: k, value: p.value, x: x });
      });
      gridEl.appendChild(h('div', { 'class': 'hf-dots__row' }, [
        h('span', { 'class': 'hf-dots__label' }, [r.label]),
        track,
        r.note ? h('span', { 'class': 'hf-dots__note' }, [r.note]) : null
      ]));
      if (ri === rows.length - 1) {
        var axis = h('div', { 'class': cx('hf-dots__axis', tk.length > 5 && 'hf-dots__axis--dense') }, tk.map(function (t, i) {
          var s = h('span', { 'class': cx(i === 0 && pos(t) < 4 && 'is-first', i === tk.length - 1 && pos(t) > 96 && 'is-last') }, [String(f(t))]);
          s.style.left = pos(t) + '%';
          return s;
        }));
        gridEl.appendChild(h('div', { 'class': 'hf-dots__axisrow' }, [axis]));
      }
    });

    var plot = h('div', { 'class': 'hf-chart__plot', tabindex: flatPts.length ? '0' : null, role: 'img',
      'aria-label': o.summary || ((o.title || 'Dot plot') + '. ' + rows.length + ' rows. A table version follows.') }, [gridEl, tipEl]);
    var cur = -1;
    function show(i) {
      if (i < 0 || i >= flatPts.length) return;
      if (cur >= 0 && flatPts[cur]) flatPts[cur].node.classList.remove('is-hot');
      cur = i;
      var p = flatPts[i];
      p.node.classList.add('is-hot');
      while (tipEl.firstChild) tipEl.removeChild(tipEl.firstChild);
      tipEl.appendChild(h('div', { 'class': 'hf-tip__head' }, [p.row.label]));
      tipEl.appendChild(h('div', { 'class': 'hf-tip__row' }, [h('span', { 'class': 'hf-tip__val' }, [String(f(p.value)) + (o.unit ? ' ' + o.unit : '')]), h('span', { 'class': 'hf-tip__name' }, [p.kind.label])]));
      if (p.row.band) tipEl.appendChild(h('div', { 'class': 'hf-tip__row hf-tip__name' }, [(o.bandLabel || 'Noise band') + ' ' + f(p.row.band.lo) + '–' + f(p.row.band.hi)]));
      var pr = plot.getBoundingClientRect(), nr = p.node.getBoundingClientRect();
      placeTip(tipEl, pr.width, nr.left - pr.left + nr.width / 2, nr.top - pr.top - 8 - (tipEl.offsetHeight || 48));
    }
    function hide() {
      if (cur >= 0 && flatPts[cur]) flatPts[cur].node.classList.remove('is-hot');
      cur = -1; tipEl.hidden = true;
    }
    flatPts.forEach(function (p, i) {
      p.node.addEventListener('pointerenter', function () { show(i); });
      p.node.addEventListener('pointerleave', hide);
    });
    plot.addEventListener('keydown', function (e) {
      var i = cur < 0 ? 0 : cur;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = Math.min(flatPts.length - 1, cur < 0 ? 0 : i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = flatPts.length - 1;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      show(i);
    });
    plot.addEventListener('focus', function () { show(cur >= 0 ? cur : 0); });
    plot.addEventListener('blur', hide);

    var cols = [{ key: 'label', label: o.rowLabel || 'Test' }];
    kinds.forEach(function (k) { if (used[k.id]) cols.push({ key: k.id, label: k.label, num: true }); });
    if (anyBand) cols.push({ key: '_band', label: o.bandLabel || 'Noise band', num: true });
    if (rows.some(function (r) { return r.note; })) cols.push({ key: '_note', label: 'Reading' });
    var trows = rows.map(function (r) {
      var out = { label: r.label };
      toArr(r.points).forEach(function (p) { if (isNum(p.value)) out[p.kind] = String(f(p.value)); });
      if (r.band) out._band = f(r.band.lo) + '–' + f(r.band.hi);
      if (r.note) out._note = r.note;
      return out;
    });

    return h('figure', { 'class': cx('hf-chart', 'hf-dots', o.cls) }, [
      (o.title || o.desc) ? h('figcaption', { 'class': 'hf-chart__head' }, [
        o.title ? h('span', { 'class': 'hf-chart__title' }, [o.title]) : null,
        o.desc ? h('span', { 'class': 'hf-chart__desc' }, [o.desc]) : null
      ]) : null,
      legend,
      plot,
      o.unit ? h('span', { 'class': 'hf-dots__unit' }, [o.unit]) : null,
      details(o.tableLabel || 'Show as table', table({ columns: cols, rows: trows, label: (o.title || 'Results') + ' as a table' }), { cls: 'hf-chart__table' })
    ]);
  }

  /* ---------- empty states, notices ---------- */

  var ARTS = {
    sprout: function () {
      return svg('svg', { viewBox: '0 0 104 64', 'class': 'hf-empty__art', 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
        svg('path', { 'class': 'hf-art-soft', d: 'M6 12c6-3 12-3 18 0s12 3 18 0 12-3 18 0 12 3 18 0 12-3 18 0' }),
        svg('path', { 'class': 'hf-art-soft', d: 'M14 22c6-3 12-3 18 0s12 3 18 0 12-3 18 0 12 3 18 0' }),
        svg('path', { d: 'M52 35v8' }),
        svg('path', { d: 'M52 43c0 2.4-2.8 4-6.4 5.2M52 43c0 2.4 2.8 4 6.4 5.2M52 43v5.2' }),
        svg('circle', { 'class': 'hf-art-accent', cx: 52, cy: 31.4, r: 3.6 }),
        svg('path', { d: 'M8 49.5h88' }),
        svg('path', { 'class': 'hf-art-soft', d: 'M8 57h88' })
      ]);
    },
    chart: function () {
      return svg('svg', { viewBox: '0 0 104 64', 'class': 'hf-empty__art', 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
        svg('path', { d: 'M10 6v48h86' }),
        svg('path', { 'class': 'hf-art-soft', d: 'M10 18h86M10 30h86M10 42h86' }),
        svg('path', { d: 'M16 46c10-2 16-12 26-12s14 6 22 4 14-14 26-18', 'stroke-dasharray': '2 5' }),
        svg('circle', { 'class': 'hf-art-accent', cx: 16, cy: 46, r: 3.2 })
      ]);
    },
    lab: function () {
      return svg('svg', { viewBox: '0 0 104 64', 'class': 'hf-empty__art', 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
        svg('path', { d: 'M44 6h16M46.5 6v14L33 49.5A4 4 0 0 0 36.6 55h30.8a4 4 0 0 0 3.6-5.5L57.5 20V6' }),
        svg('path', { 'class': 'hf-art-soft', d: 'M38.5 40h27' }),
        svg('circle', { 'class': 'hf-art-accent', cx: 52, cy: 47, r: 3 }),
        svg('path', { 'class': 'hf-art-soft', d: 'M8 59h88M16 59v-3M32 59v-3M48 59v-5M64 59v-3M80 59v-3M96 59v-5' })
      ]);
    }
  };

  function empty(o) {
    o = o || {};
    var art = o.art === 'none' ? null : (ARTS[o.art] || ARTS.sprout)();
    return h('div', { 'class': cx('hf-empty', o.cls) }, [
      art,
      h(o.headingLevel ? 'h' + o.headingLevel : 'p', { 'class': 'hf-empty__title' }, [o.title || 'Nothing here yet']),
      o.text ? h('p', { 'class': 'hf-empty__text' }, [o.text]) : null,
      o.action ? h('div', { 'class': 'hf-empty__action hf-actions' }, toArr(o.action)) : null
    ]);
  }

  var NOTICE_ICON = { info: 'info', warn: 'warn', good: 'good', bad: 'bad' };
  function notice(o) {
    o = o || {};
    var tone = NOTICE_ICON[o.tone] ? o.tone : 'info';
    var role = o.live === 'assertive' ? 'alert' : o.live ? 'status' : null;
    return h('div', { 'class': cx('hf-notice', tone !== 'info' && 'hf-notice--' + tone, o.slim && 'hf-notice--slim', o.cls), role: role, id: o.id || null }, [
      icon(NOTICE_ICON[tone], { cls: 'hf-notice__icon' }),
      o.title ? h('p', { 'class': 'hf-notice__title' }, [o.title]) : null,
      o.text ? h('p', { 'class': 'hf-notice__text' }, [o.text]) : null,
      o.action ? h('div', { 'class': 'hf-notice__action' }, toArr(o.action)) : null
    ]);
  }

  /* ---------- copy box ---------- */

  function copyText(text, area) {
    return new Promise(function (resolve) {
      function fallback() {
        var ok = false;
        try {
          area.focus();
          area.select();
          ok = doc.execCommand && doc.execCommand('copy');
        } catch (e) { ok = false; }
        resolve(!!ok);
      }
      try {
        // Check the permissions policy first: sandboxed previews log a console error if writeText is blocked.
        var policyOk = !(HF.dom && typeof HF.dom.allows === 'function') || HF.dom.allows('clipboard-write');
        if (policyOk && root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText && root.isSecureContext !== false) {
          root.navigator.clipboard.writeText(text).then(function () { resolve(true); }, fallback);
        } else fallback();
      } catch (e) { fallback(); }
    });
  }

  function copyBox(o) {
    o = o || {};
    var id = o.id || uid('hf-copy');
    var area = h('textarea', { 'class': 'hf-copy__area', id: id, rows: String(o.rows || 6), readonly: true, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': o.hint ? id + '-hint' : null });
    area.value = o.text || '';
    var status = h('span', { 'class': 'hf-copy__status', role: 'status' });
    function say(ok, msg) {
      while (status.firstChild) status.removeChild(status.firstChild);
      if (ok) status.appendChild(icon('check'));
      status.appendChild(doc.createTextNode(msg));
    }
    var copyBtn = button(o.copyLabel || 'Copy', { variant: 'secondary', icon: 'copy', onClick: function () {
      copyText(area.value, area).then(function (ok) {
        if (ok) say(true, 'Copied');
        else { area.focus(); area.select(); say(false, 'Selected. Press Ctrl+C (⌘C on a Mac), or long-press and choose Copy.'); }
      });
    } });
    var kids = [copyBtn];
    if (o.download) {
      kids.push(button(o.downloadLabel || 'Download', { variant: 'quiet', icon: 'download', onClick: function () {
        try {
          var blob = new root.Blob([area.value], { type: o.mime || 'application/json' });
          var url = root.URL.createObjectURL(blob);
          var a = h('a', { href: url, download: o.download, hidden: true });
          doc.body.appendChild(a);
          a.click();
          setTimeout(function () { root.URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
          say(true, 'Download started');
        } catch (e) { say(false, 'Download blocked here. Copy the text instead.'); }
      } }));
    }
    kids.push(status);
    var node = h('div', { 'class': cx('hf-copy', o.cls) }, [
      h('label', { 'class': 'hf-copy__label', 'for': id }, [o.label || 'Text to copy']),
      o.hint ? h('p', { 'class': 'hf-hint', id: id + '-hint' }, [o.hint]) : null,
      area,
      h('div', { 'class': 'hf-copy__bar' }, kids)
    ]);
    node.setText = function (t) { area.value = t; while (status.firstChild) status.removeChild(status.firstChild); };
    return node;
  }

  /* ---------- forms ---------- */

  function field(o) {
    o = o || {};
    var ctl = o.control;
    var id = (ctl && ctl.id) || o.id || uid('hf-f');
    if (ctl && !ctl.id && ctl.setAttribute) ctl.id = id;
    var hintId = o.hint ? id + '-hint' : null;
    if (ctl && hintId && ctl.setAttribute) ctl.setAttribute('aria-describedby', hintId);
    return h('div', { 'class': cx('hf-field', o.cls) }, [
      h('label', { 'class': 'hf-label', 'for': id }, [o.label]),
      o.hint ? h('p', { 'class': 'hf-hint', id: hintId }, [o.hint]) : null,
      ctl || null
    ]);
  }

  function toggle(o) {
    o = o || {};
    var id = o.id || uid('hf-t');
    var onText = o.onText || 'On', offText = o.offText || 'Off';
    var state = h('span', { 'class': 'hf-toggle__state', 'aria-hidden': 'true' }, [o.checked ? onText : offText]);
    var input = h('input', { type: 'checkbox', role: 'switch', 'class': 'hf-switch', id: id, 'aria-describedby': o.hint ? id + '-hint' : null });
    input.checked = !!o.checked;
    input.addEventListener('change', function () {
      state.textContent = input.checked ? onText : offText;
      if (o.onChange) o.onChange(input.checked, input);
    });
    return h('label', { 'class': cx('hf-toggle', o.cls), 'for': id }, [
      h('span', { 'class': 'hf-toggle__text' }, [
        h('span', { 'class': 'hf-toggle__label' }, [o.label]),
        o.hint ? h('span', { 'class': 'hf-hint', id: id + '-hint' }, [o.hint]) : null
      ]),
      h('span', { 'class': 'hf-toggle__ctl' }, [state, input])
    ]);
  }

  function segmented(o) {
    o = o || {};
    var name = o.name || uid('hf-seg');
    var hintId = o.hint ? name + '-hint' : null;
    var opts = toArr(o.options).map(function (opt) {
      var input = h('input', { type: 'radio', name: name, value: String(opt.value) });
      input.checked = String(opt.value) === String(o.value);
      input.addEventListener('change', function () { if (input.checked && o.onChange) o.onChange(opt.value, input); });
      return h('label', { 'class': 'hf-seg__opt' }, [input, h('span', null, [opt.label])]);
    });
    return h('fieldset', { 'class': cx('hf-seg', o.cls), 'aria-describedby': hintId }, [
      h('legend', { 'class': o.legend ? 'hf-seg__legend' : 'hf-vh' }, [o.legend || 'Choose one']),
      o.hint ? h('p', { 'class': 'hf-hint', id: hintId, style: 'margin-bottom:.5rem' }, [o.hint]) : null,
      h('div', { 'class': 'hf-seg__opts' }, opts)
    ]);
  }

  function select(o) {
    o = o || {};
    var id = o.id || uid('hf-sel');
    var hintId = o.hint ? id + '-hint' : null;
    var sel = h('select', { 'class': 'hf-select', id: id, 'aria-describedby': hintId }, toArr(o.options).map(function (opt) {
      return h('option', { value: String(opt.value) }, [opt.label]);
    }));
    if (o.value !== undefined) sel.value = String(o.value);
    if (o.onChange) sel.addEventListener('change', function () { o.onChange(sel.value, sel); });
    return h('div', { 'class': cx('hf-field', o.cls) }, [
      h('label', { 'class': 'hf-label', 'for': id }, [o.label]),
      o.hint ? h('p', { 'class': 'hf-hint', id: hintId }, [o.hint]) : null,
      h('span', { 'class': 'hf-select-wrap' }, [sel])
    ]);
  }

  /* ---------- response pads ---------- */

  var PAD_ICON = { yes: 'check', no: 'close', alt: 'sound' };
  function pads(o) {
    o = o || {};
    var list = toArr(o.pads);
    return h('div', {
      'class': cx('hf-pads', 'hf-pads--' + list.length, o.mirror && 'hf-pads--mirror', o.fixed && 'hf-pads--fixed', o.size === 'sm' && 'hf-pads--sm', o.cls),
      role: 'group', 'aria-label': o.label || 'Answer buttons'
    }, list.map(function (p) {
      var kind = p.kind || (p.id === 'no' ? 'no' : p.id === 'match2' ? 'alt' : 'yes');
      return h('button', {
        type: 'button',
        'class': cx('hf-pad', 'hf-pad--' + kind, p.cls),
        'data-key': p.id || kind,
        'aria-keyshortcuts': p.key || null,
        id: p.domId || null
      }, [
        p.icon === false ? null : icon(p.icon || PAD_ICON[kind] || 'check'),
        h('span', { 'class': 'hf-pad__label' }, [p.label]),
        p.key ? h('span', { 'class': 'hf-pad__key', 'aria-hidden': 'true' }, [kbd(p.key)]) : null
      ]);
    }));
  }

  ui.c = {
    h: h, svg: svg, icon: icon, ICONS: ICONS, mark: mark, kbd: kbd, uid: uid, fmt: fmt,
    button: button, link: link, card: card, list: list, listItem: listItem, details: details, dl: dl,
    chip: chip, levelChip: levelChip, familyGlyph: familyGlyph,
    stat: stat, stats: stats, sessionBar: sessionBar, weeklyRing: weeklyRing, zoneMeter: zoneMeter,
    badge: badge, badges: badges, ruleCard: ruleCard, tape: tape, keys: keys, debrief: debrief,
    lineChart: lineChart, dotPlot: dotPlot, table: table, empty: empty, notice: notice, copyBox: copyBox,
    copyText: copyText, field: field, toggle: toggle, segmented: segmented, select: select, pads: pads,
    _ticks: ticksFor, _smooth: smoothVals
  };
})(typeof window !== 'undefined' ? window : globalThis);
