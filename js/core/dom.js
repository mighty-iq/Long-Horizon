/* Long-Horizon — DOM helpers (browser only). MIT licence. Needs HF.util.
 *
 * HF.dom:
 *   el(tag, attrs?, children?) → Element. attrs: class|className (string or array), style (string or object; '--x'
 *        custom properties allowed), dataset {}, text, html (TRUSTED strings only), on<event>: fn, value/checked/
 *        selected (set as properties), aria-* and data-* (booleans written as "true"/"false"), other attributes
 *        (true → present, false/null/undefined → absent). children: string | number | Node | array (nested) | null.
 *        SVG: tags svg g path circle ellipse rect line polyline polygon tspan defs use symbol clipPath mask pattern
 *        linearGradient radialGradient stop marker foreignObject are created in the SVG namespace; use svg(tag, …)
 *        or the prefix 'svg:' for ambiguous tags ('svg:text', 'svg:title').
 *   svg(tag, attrs?, children?) → SVG element
 *   modal(content, { title, labelledBy, describedBy, label, initialFocus, onClose, dismissible = true,
 *        closeOnBackdrop = false, className }) → handle { dialog, el, body, close(value), closed: Promise<value>, isOpen }
 *        Built on <dialog class="hf-modal"> + .showModal(); content goes into <div class="hf-modal__body">
 *        (content: Node | string | array | function(body, handle)). Focus is trapped (Tab / Shift+Tab cycle),
 *        Escape closes the top dialog only (and never reaches page key handlers), focus returns to the opener.
 *        title → <h2 class="hf-modal__title"> used as the accessible name. Initial focus: opts.initialFocus, else
 *        [data-autofocus], else the first focusable element. A native `autofocus` attribute in the content is turned
 *        into data-autofocus (Chrome blocks native autofocus in sandboxed previews and logs an error).
 *   confirm(text, { ok = 'OK', cancel = 'Cancel', title, danger }) → Promise<boolean>   (never window.confirm)
 *        Buttons: .hf-btn (cancel, left) and .hf-btn.hf-btn--primary (+ .hf-btn--danger); Escape = false.
 *   toast(text, { kind: 'info'|'warn'|'error'|'ok', timeout ms (0 = sticky with a Dismiss button),
 *        action: { label, onClick } (optional button .hf-toast__action; closes the toast) }) → { el, close }
 *        Appended to #hf-toasts (created with role=status if missing). While HF.timing.busy, toasts wait until the
 *        stream ends (nothing may change the page during stimuli). Returns null when queued.
 *   download(filename, text, mime?) → bool (attempted; sandboxed previews silently block downloads)
 *   copyText(text) → Promise<bool> (Clipboard API when allowed, else a hidden textarea + execCommand; focus is
 *        returned to the element that had it)
 *   allows(feature) → bool  (permissions policy check, e.g. 'screen-wake-lock', 'clipboard-write')
 *   openModals() → number; topModal() → handle | null
 *   qs(sel, root?), qsa(sel, root?) → array, clear(node), on(target, type, fn, opts?) → off()
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var U = HF.util;
  var doc = root.document;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_ONLY = {
    svg: 1, g: 1, path: 1, circle: 1, ellipse: 1, rect: 1, line: 1, polyline: 1, polygon: 1, tspan: 1, defs: 1,
    use: 1, symbol: 1, clipPath: 1, mask: 1, pattern: 1, linearGradient: 1, radialGradient: 1, stop: 1, marker: 1,
    foreignObject: 1
  };

  function isNode(x) { return !!x && typeof x === 'object' && typeof x.nodeType === 'number'; }

  function append(node, children) {
    if (children === null || children === undefined || children === false || children === true) return;
    if (Array.isArray(children)) { for (var i = 0; i < children.length; i++) append(node, children[i]); return; }
    if (isNode(children)) { node.appendChild(children); return; }
    node.appendChild(doc.createTextNode(String(children)));
  }

  function setAttrs(node, attrs, isSvg) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      var aria = k.indexOf('aria-') === 0 || k.indexOf('data-') === 0;
      if (v === undefined || v === null || (v === false && !aria)) continue;
      if (k === 'class' || k === 'className') {
        var cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
        if (isSvg) node.setAttribute('class', cls); else node.className = cls;
      } else if (k === 'style') {
        if (typeof v === 'string') node.style.cssText = v;
        else for (var p in v) {
          if (!Object.prototype.hasOwnProperty.call(v, p)) continue;
          if (p.indexOf('--') === 0) node.style.setProperty(p, v[p]); else node.style[p] = v[p];
        }
      } else if (k === 'dataset') {
        for (var d in v) if (Object.prototype.hasOwnProperty.call(v, d)) node.setAttribute('data-' + d.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), String(v[d]));
      } else if (k === 'text') {
        node.textContent = String(v);
      } else if (k === 'html') {
        node.innerHTML = String(v);
      } else if (k.length > 2 && k.slice(0, 2) === 'on' && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate')) {
        node[k] = v;
      } else if (k === 'htmlFor') {
        node.setAttribute('for', String(v));
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }

  function make(tag, attrs, children, forceSvg) {
    var isSvg = !!forceSvg;
    if (tag.indexOf('svg:') === 0) { isSvg = true; tag = tag.slice(4); }
    else if (SVG_ONLY[tag]) isSvg = true;
    var node = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
    if (attrs !== undefined && attrs !== null && (typeof attrs !== 'object' || Array.isArray(attrs) || isNode(attrs))) {
      children = attrs; attrs = null;
    }
    if (attrs) setAttrs(node, attrs, isSvg);
    append(node, children);
    return node;
  }
  function el(tag, attrs, children) { return make(tag, attrs, children, false); }
  function svg(tag, attrs, children) { return make(tag, attrs, children, true); }

  function qs(sel, r) { return (r || doc).querySelector(sel); }
  function qsa(sel, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(sel)); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts || false);
    return function () { target.removeEventListener(type, fn, opts || false); };
  }

  function allows(feature) {
    try {
      var fp = doc.permissionsPolicy || doc.featurePolicy;
      if (fp && typeof fp.allowsFeature === 'function') return !!fp.allowsFeature(feature);
    } catch (e) { return false; }
    return true;
  }

  // ---------------------------------------------------------------- modal
  var FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"]), ' +
    '[contenteditable="true"], audio[controls], video[controls]';
  var stack = [];

  function focusables(container) {
    var list = container.querySelectorAll(FOCUSABLE), out = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.closest('[inert]')) continue;
      if (!n.getClientRects().length) continue;
      out.push(n);
    }
    return out;
  }

  function focusEl(n) {
    if (!n || typeof n.focus !== 'function') return;
    try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); }
  }

  function modal(content, opts) {
    opts = opts || {};
    var opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    var dismissible = opts.dismissible !== false;
    var dlg = el('dialog', { 'class': 'hf-modal' + (opts.className ? ' ' + opts.className : ''), tabindex: '-1' });
    var body = el('div', { 'class': 'hf-modal__body' });
    dlg.appendChild(body);
    var resolveClosed;
    var handle = { dialog: dlg, el: dlg, body: body, isOpen: true, close: close, closed: null };
    handle.closed = new Promise(function (res) { resolveClosed = res; });

    if (opts.title) {
      var tid = U.id('hf-dlg');
      body.appendChild(el('h2', { 'class': 'hf-modal__title', id: tid }, opts.title));
      if (!opts.labelledBy) dlg.setAttribute('aria-labelledby', tid);
    }
    if (opts.labelledBy) dlg.setAttribute('aria-labelledby', opts.labelledBy);
    if (opts.describedBy) dlg.setAttribute('aria-describedby', opts.describedBy);
    if (opts.label && !opts.title && !opts.labelledBy) dlg.setAttribute('aria-label', opts.label);
    if (typeof content === 'function') content(body, handle); else append(body, content);
    // Initial focus is set below. A native autofocus attribute would be blocked (and logged as a console error) by
    // Chrome in cross-origin frames such as sandboxed previews, so it becomes data-autofocus before insertion.
    var auto = dlg.querySelectorAll('[autofocus]');
    for (var ai = 0; ai < auto.length; ai++) { auto[ai].removeAttribute('autofocus'); auto[ai].setAttribute('data-autofocus', ''); }

    function isTop() { return stack[stack.length - 1] === handle; }
    function trap(e) {
      var list = focusables(dlg);
      if (!list.length) { e.preventDefault(); focusEl(dlg); return; }
      var first = list[0], last = list[list.length - 1], a = doc.activeElement;
      if (e.shiftKey) { if (a === first || a === dlg || !dlg.contains(a)) { e.preventDefault(); focusEl(last); } }
      else if (a === last || a === dlg || !dlg.contains(a)) { e.preventDefault(); focusEl(first); }
    }
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        if (dismissible && isTop()) close(undefined);
      } else if (e.key === 'Tab') {
        trap(e);
      }
    });
    dlg.addEventListener('cancel', function (e) {
      e.preventDefault();
      if (dismissible && isTop()) close(undefined);
    });
    dlg.addEventListener('close', function () { if (handle.isOpen) close(dlg.returnValue || undefined); });
    if (opts.closeOnBackdrop) {
      dlg.addEventListener('click', function (e) {
        if (e.target !== dlg || !dismissible) return;
        var r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(undefined);
      });
    }

    doc.body.appendChild(dlg);
    stack.push(handle);
    try { dlg.showModal(); }
    catch (e) { dlg.setAttribute('open', ''); dlg.classList.add('hf-modal--fallback'); }

    var target = null;
    if (opts.initialFocus && opts.initialFocus !== 'none') {
      target = typeof opts.initialFocus === 'string' ? dlg.querySelector(opts.initialFocus) : opts.initialFocus;
    }
    if (!target && opts.initialFocus !== 'none') target = dlg.querySelector('[autofocus], [data-autofocus]') || focusables(dlg)[0];
    focusEl(target || dlg);

    function close(value) {
      if (!handle.isOpen) return;
      handle.isOpen = false;
      var idx = stack.indexOf(handle);
      if (idx >= 0) stack.splice(idx, 1);
      try { if (dlg.open) dlg.close(); } catch (e) { /* ignore */ }
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      if (opener && doc.contains(opener)) focusEl(opener);
      else if (stack.length) focusEl(stack[stack.length - 1].dialog);
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(value); } catch (e2) { if (root.console) console.error(e2); }
      }
      resolveClosed(value);
    }
    return handle;
  }

  function openModals() { return stack.length; }
  function topModal() { return stack.length ? stack[stack.length - 1] : null; }

  function confirmDialog(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var result = false;
      var textId = U.id('hf-dlg-text');
      var okBtn = el('button', { type: 'button', 'class': 'hf-btn hf-btn--primary' + (opts.danger ? ' hf-btn--danger' : '') }, opts.ok || 'OK');
      var cancelBtn = el('button', { type: 'button', 'class': 'hf-btn' }, opts.cancel || 'Cancel');
      modal(function (body, handle) {
        if (text) body.appendChild(el('p', { 'class': 'hf-modal__text', id: textId }, text));
        body.appendChild(el('div', { 'class': 'hf-modal__actions' }, [cancelBtn, okBtn]));
        okBtn.addEventListener('click', function () { result = true; handle.close(true); });
        cancelBtn.addEventListener('click', function () { handle.close(false); });
      }, {
        title: opts.title, label: opts.title ? null : (opts.label || 'Please confirm'),
        describedBy: text ? textId : null, className: 'hf-modal--confirm',
        initialFocus: opts.danger ? cancelBtn : okBtn,
        onClose: function () { resolve(result); }
      });
    });
  }

  // ---------------------------------------------------------------- toast
  var toastQueue = [], toastTimer = null;
  function toastRoot() {
    var c = doc.getElementById('hf-toasts');
    if (!c) {
      c = el('div', { id: 'hf-toasts', 'class': 'hf-toasts', role: 'status', 'aria-live': 'polite' });
      doc.body.appendChild(c);
    }
    return c;
  }
  function drainToasts() {
    toastTimer = null;
    if (HF.timing && HF.timing.busy) { toastTimer = setTimeout(drainToasts, 500); return; }
    var q = toastQueue;
    toastQueue = [];
    for (var i = 0; i < q.length; i++) showToast(q[i][0], q[i][1]);
  }
  function showToast(text, opts) {
    var c = toastRoot();
    var kind = opts.kind || 'info';
    var t = el('div', { 'class': 'hf-toast hf-toast--' + kind, 'data-kind': kind });
    t.appendChild(el('span', { 'class': 'hf-toast__text' }, text));
    var timeout = opts.timeout == null ? Math.min(10000, 4000 + 40 * String(text).length) : opts.timeout;
    function remove() { if (t.parentNode) t.parentNode.removeChild(t); }
    if (opts.action && opts.action.label) {
      t.appendChild(el('button', { type: 'button', 'class': 'hf-btn hf-btn--quiet hf-toast__action', onclick: function () {
        remove();
        if (typeof opts.action.onClick === 'function') opts.action.onClick();
      } }, opts.action.label));
    }
    if (timeout === 0 || opts.dismissible) {
      t.appendChild(el('button', { type: 'button', 'class': 'hf-toast__close', 'aria-label': 'Dismiss', onclick: remove }, '×'));
    }
    c.appendChild(t);
    while (c.children.length > 4) c.removeChild(c.firstChild);
    if (timeout > 0) setTimeout(remove, timeout);
    return { el: t, close: remove };
  }
  function toast(text, opts) {
    opts = opts || {};
    if (HF.timing && HF.timing.busy) {
      toastQueue.push([text, opts]);
      if (!toastTimer) toastTimer = setTimeout(drainToasts, 500);
      return null;
    }
    return showToast(text, opts);
  }

  // ---------------------------------------------------------------- files / clipboard
  function download(filename, text, mime) {
    try {
      var blob = new root.Blob([text], { type: mime || 'application/octet-stream' });
      var url = root.URL.createObjectURL(blob);
      var a = el('a', { href: url, download: filename || 'long-horizon.txt', style: 'display:none' });
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setTimeout(function () { try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 60000);
      return true;
    } catch (e) { return false; }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      function fallback() {
        var ta = null, ok = false;
        var prev = doc.activeElement; // select() moves focus to the helper textarea: give it back afterwards (PQ-07)
        try {
          ta = el('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0' });
          ta.value = String(text);
          var host = topModal() ? topModal().dialog : doc.body;
          host.appendChild(ta);
          ta.select();
          try { ok = !!doc.execCommand('copy'); } catch (e) { ok = false; }
        } catch (e2) { ok = false; }
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
        if (prev && prev !== doc.body && doc.contains(prev)) focusEl(prev);
        resolve(ok);
      }
      try {
        var cb = root.navigator && root.navigator.clipboard;
        if (cb && typeof cb.writeText === 'function' && allows('clipboard-write')) {
          cb.writeText(String(text)).then(function () { resolve(true); }, fallback);
          return;
        }
      } catch (e) { /* fall through */ }
      fallback();
    });
  }

  var api = {
    el: el, svg: svg, qs: qs, qsa: qsa, clear: clear, on: on, allows: allows,
    modal: modal, confirm: confirmDialog, toast: toast, openModals: openModals, topModal: topModal,
    download: download, copyText: copyText
  };
  HF.dom = api;
})(typeof window !== 'undefined' ? window : globalThis);
