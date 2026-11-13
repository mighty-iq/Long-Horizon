/* Long-Horizon — Share to Discord (js/ui/share.js). DOM only (text() is pure), ES2019, MIT licence. Owner: P3.

   HF.ui.share.text(records?, derived?, { includeLevels }?) → string
       A short, plain summary for the Chimera Discord: the name line (HEAD: "Training my working memory with
       Long-Horizon: hold more steps, keep them straight."), counted sessions so far, minutes this week, the newest badge
       and (only when includeLevels is true, default = settings.includeLevelsInShare) the current level of up to five
       recently played versions. Always ends with the Chimera line (LINE: "Free, built by the Chimera community on
       Discord: https://discord.gg/chmr"). Both lines are the Long-Horizon copy of 13 Nov 2026.
       Nothing identifying is included (no ids, no dates of birth, no Lab scores).
   HF.ui.share.open(root?) → Promise<{ copied: bool, text: string, modal: handle|null }>
       Tries the clipboard at once (guarded: the Clipboard API, else a hidden textarea + execCommand; both can be
       blocked in sandboxed previews) and shows the text in a copy box so it can always be copied by hand.
       Without `root` the panel opens in a dialog (HF.dom.modal); with a `root` element it is rendered inline there
       (replacing a panel an earlier call put there).
       The panel has an "Include my levels" switch (saved as settings.includeLevelsInShare) and the Discord link.
   HF.ui.share.panel(opts?) → Element   the same panel without opening anything (used by open()).
   HF.ui.share.DISCORD_URL, DISCORD_TEXT, HEAD, LINE
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});

  var DISCORD_URL = 'https://discord.gg/chmr';
  var DISCORD_TEXT = 'discord.gg/chmr';
  var HEAD = 'Training my working memory with Long-Horizon: hold more steps, keep them straight.';
  var LINE = 'Free, built by the Chimera community on Discord: ' + DISCORD_URL;
  var DAY = 86400000;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function plural(n, one, many) { return n === 1 ? one : many; }

  function curRecords() { try { return HF.store && HF.store.records; } catch (e) { return null; } }
  function curDerived(records) {
    try {
      if (HF.store && records === HF.store.records) {
        var d = HF.store.derived;
        if (d && d.counters) return d;
      }
      if (HF.engine && HF.engine.derive) return HF.engine.derive(records, Date.now());
    } catch (e) { /* fall through */ }
    return {};
  }

  function weekStartMs(now) {
    try {
      if (HF.util && HF.util.weekStart) return HF.util.weekStart(now);
    } catch (e) { /* ignore */ }
    var d = new Date(now);
    var dow = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
  }

  /** Minutes trained this week (Monday start): ended sessions use their minutes; open ones use their blocks. */
  function minutesThisWeek(records, now) {
    var from = weekStartMs(now), total = 0;
    var blocksBySession = null;
    (records.sessions || []).forEach(function (s) {
      if (!s || !isNum(s.startedAt) || s.startedAt < from || s.startedAt > now + DAY) return;
      if (isNum(s.minutes) && s.minutes > 0) { total += s.minutes; return; }
      if (s.endedAt) return;
      if (!blocksBySession) {
        blocksBySession = {};
        (records.blocks || []).forEach(function (b) {
          if (!b || !b.sessionId) return;
          var x = blocksBySession[b.sessionId] || (blocksBySession[b.sessionId] = { lo: Infinity, hi: -Infinity });
          if (isNum(b.t)) { x.lo = Math.min(x.lo, b.t); x.hi = Math.max(x.hi, b.t); }
        });
      }
      var x = blocksBySession[s.id];
      if (x && x.hi >= x.lo) total += Math.max(1, (x.hi - x.lo) / 60000 + 1.5);
    });
    return Math.round(total);
  }

  function newestBadge(derived) {
    var b = derived && derived.badges, best = null, bestT = -Infinity;
    if (!b) return null;
    Object.keys(b).forEach(function (id) { if (isNum(b[id]) && b[id] >= bestT) { bestT = b[id]; best = id; } });
    if (!best) return null;
    var def = HF.badges && HF.badges.get ? HF.badges.get(best) : null;
    return def ? def.label : null;
  }

  function levelBits(derived) {
    var C = HF.catalog, tracks = derived && derived.tracks;
    if (!C || !tracks) return [];
    var list = Object.keys(tracks).filter(function (id) {
      var t = tracks[id];
      return t && t.available && (t.ratedBlocks > 0 || t.blocks > 0) && C.get(id);
    });
    list.sort(function (a, b) { return (tracks[b].lastPlayedAt || 0) - (tracks[a].lastPlayedAt || 0); });
    return list.slice(0, 5).map(function (id) {
      try { return C.fullLabel(id, tracks[id].level); } catch (e) { return null; }
    }).filter(Boolean);
  }

  function text(records, derived, opts) {
    records = records || curRecords() || {};
    derived = derived || curDerived(records);
    opts = opts || {};
    var settings = records.settings || {};
    var includeLevels = opts.includeLevels !== undefined ? !!opts.includeLevels : !!settings.includeLevelsInShare;
    var now = isNum(opts.now) ? opts.now : Date.now();
    var counters = derived.counters || {};
    var sessions = isNum(counters.sessionsCounted) ? counters.sessionsCounted : (isNum(derived.sessionsCounted) ? derived.sessionsCounted : 0);
    var minutes = minutesThisWeek(records, now);
    var bits = [];
    bits.push(sessions + ' training ' + plural(sessions, 'session', 'sessions') + ' so far');
    bits.push(minutes + ' min this week');
    var badge = newestBadge(derived);
    if (badge) bits.push('newest badge: ' + badge);
    var lines = [HEAD, bits.join(' · ')];
    if (includeLevels) {
      var lv = levelBits(derived);
      if (lv.length) lines.push('Levels: ' + lv.join('; '));
    }
    lines.push(LINE);
    return lines.join('\n');
  }

  function c() { return ui.c; }

  function panel(opts) {
    opts = opts || {};
    var C = c();
    var records = curRecords() || {};
    var include = !!(records.settings && records.settings.includeLevelsInShare);
    var box = C.copyBox({
      label: 'Text to share', rows: 5, text: text(records, null, { includeLevels: include }),
      hint: 'Paste it in the Chimera Discord. Levels are left out unless you switch them on.'
    });
    box.classList.add('hf-share__box');
    var sw = C.toggle({
      label: 'Include my levels', checked: include,
      onChange: function (on) {
        include = on;
        try {
          HF.store.mutate(function (r) {
            var s = HF.util && HF.util.clone ? HF.util.clone(r.settings || {}) : JSON.parse(JSON.stringify(r.settings || {}));
            s.includeLevelsInShare = !!on;
            s.updatedAt = Date.now();
            r.settings = s;
          });
        } catch (e) { /* memory only: the text still updates */ }
        box.setText(text(HF.store.records, null, { includeLevels: on }));
      }
    });
    var status = C.h('p', { 'class': 'hf-share__status hf-small', role: 'status' });
    var node = C.h('div', { 'class': 'hf-share hf-stack' }, [
      status,
      box,
      sw,
      C.h('div', { 'class': 'hf-share__discord hf-row' }, [
        C.link('Open the Chimera Discord', DISCORD_URL, { variant: 'secondary' }),
        C.h('span', { 'class': 'hf-small hf-muted' }, ['or type ', C.h('b', null, [DISCORD_TEXT]), ' in your browser'])
      ])
    ]);
    node.getText = function () { return box.querySelector('textarea').value; };
    node.setStatus = function (msg) { status.textContent = msg || ''; };
    return node;
  }

  function open(rootEl) {
    var C = c();
    if (!C) return Promise.resolve({ copied: false, text: text(), modal: null });
    var p = panel();
    var t = p.getText();
    var handle = null;
    if (rootEl && rootEl.nodeType === 1) {
      var old = rootEl.querySelector('.hf-share');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      rootEl.appendChild(p);
    } else if (HF.dom && HF.dom.modal) {
      handle = HF.dom.modal(function (body, h) {
        body.appendChild(p);
        body.appendChild(C.h('div', { 'class': 'hf-modal__actions' }, [
          C.button('Done', { variant: 'secondary', attrs: { 'data-autofocus': '' }, onClick: function () { h.close(true); } })
        ]));
      }, { title: 'Share to Discord', className: 'hf-modal--share' });
    } else {
      (HF.router && HF.router.root ? HF.router.root() : root.document.body).appendChild(p);
    }
    var copy = HF.dom && HF.dom.copyText ? HF.dom.copyText(t) : Promise.resolve(false);
    return copy.then(function (ok) { return !!ok; }, function () { return false; }).then(function (ok) {
      p.setStatus(ok ? 'Copied. Paste it in the Chimera Discord.' : 'Copy the text below (the browser blocked automatic copying here).');
      return { copied: ok, text: t, modal: handle };
    });
  }

  ui.share = {
    text: text, open: open, panel: panel, minutesThisWeek: minutesThisWeek, newestBadge: newestBadge,
    DISCORD_URL: DISCORD_URL, DISCORD_TEXT: DISCORD_TEXT, HEAD: HEAD, LINE: LINE
  };
})(typeof window !== 'undefined' ? window : globalThis);
