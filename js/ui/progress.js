/* Long-Horizon — Progress, History and the backup tools (js/ui/progress.js). DOM only, ES2019, MIT licence. Owner: P3.

   Route `progress` { trackId?, section? }: levels per version (level, level-equivalent, personal best, zone meter;
   versions not open yet with how they open), graphs (level and block score per session for one version, with
   training-style and rule changes marked; first blocks on newly introduced versions; minutes per week), the weekly
   goal and the 12 badges (Focus mode hides both), lifetime counters and the backup tools. Viewing the page
   acknowledges new badges ('badge-ack' events). section = 'levels'|'graphs'|'badges'|'lifetime'|'backup' scrolls there.
   Route `history` { trackId?, sessionId? }: every session and block with filters (version, kind, period) and a
   trial-by-trial view per block, rebuilt from the saved trial log (HF.store.loadTrials) by regenerating the block
   from its seed and scoring it with the task's own scorer.

   HF.ui.backup (also used by Today and Settings):
     panel({ reset }) → Element   last backup date; Export backup (JSON: HF.store.exportText, which stamps
                                  backups.lastExportAt) shown in a copy box with a download attempt; blocks and
                                  sessions as CSV; Import from a file or pasted text (HF.store.importText) with a
                                  result summary; with reset: true also the Reset button (HF.dom.confirm, danger).
     openModal() → handle         the panel in a dialog
     csvBlocks(records) → text, csvSessions(records, derived) → text, summary(importResult) → text
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var ui = HF.ui || (HF.ui = {});
  var doc = root.document;
  var DAY = 86400000;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function K() { return ui.screenKit; }
  function c() { return ui.c; }
  function h(t, a, k) { return ui.c.h(t, a, k); }
  function CAT() { return HF.catalog; }
  function byT(a, b) { return (a.t || 0) - (b.t || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  function isTraining(b) {
    if (!b) return false;
    if (HF.derive && HF.derive.isTrainingBlock) return HF.derive.isTrainingBlock(b);
    return b.role !== 'tutorial' && b.role !== 'probe' && !!(CAT() && CAT().get(b.trackId));
  }
  function bad(b) {
    if (HF.controller && HF.controller.blockBad) return HF.controller.blockBad(b);
    return !!(b && (b.interrupted || (isNum(b.voidedRatio) && b.voidedRatio > 0.2)));
  }
  function scored(b) { return isTraining(b) && b.role !== 'warmup' && !bad(b) && !!b.result && isNum(b.result.ba); }

  // ------------------------------------------------------------------ data
  /** Sessions in time order that have at least one training block, their ordinal (1…n) and their blocks. */
  function orderedSessions(r) {
    var blocksBy = {};
    (r.blocks || []).forEach(function (b) {
      if (!isTraining(b)) return;
      (blocksBy[b.sessionId] || (blocksBy[b.sessionId] = [])).push(b);
    });
    Object.keys(blocksBy).forEach(function (k) { blocksBy[k].sort(byT); });
    var list = (r.sessions || []).filter(function (s) { return s && blocksBy[s.id]; })
      .sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
    var ord = {};
    list.forEach(function (s, i) { ord[s.id] = i + 1; });
    return { list: list, ord: ord, blocksBy: blocksBy };
  }

  function levelScale(id) {
    var t = CAT() && CAT().get(id);
    function nb(v) { return round1(v) + '-back'; }
    if (!t) return { value: function (r) { return r + 1; }, fmt: function (v) { return 'step ' + round1(v); }, desc: '' };
    if (id === 'nback.switch') return { value: function (r) { return 1 + Math.floor(r / 3) + (r % 3) / 3; }, fmt: nb,
      desc: 'Between whole steps the cue changes more often, then the pace gets faster.' };
    if (t.task === 'nback') return { value: function (r) { return 1 + r / 2; }, fmt: nb, desc: 'Half steps are the fast pace (one item every 2.5 s).' };
    if (id === 'rel.steps') return { value: function (r) { return 1 + r / 2; }, fmt: function (v) { return 'level ' + round1(v); },
      desc: 'Level 1 is 1-back with numbers up to 9; each level adds a bigger range or one more back. Half steps are the fast pace.' };
    if (t.tier) return { value: function (r) { return r + 1; }, fmt: function (v) { return 'step ' + round1(v); },
      desc: 'Step 1 gives 8 seconds per grid; step 9 gives 2 seconds, with look-alikes.' };
    if (id === 'rel.stream') return { value: function (r) { return r + 1; }, fmt: function (v) { return 'step ' + round1(v); },
      desc: 'Each step changes the cells faster or changes more of them.' };
    if (t.task === 'span') return { value: function (r) { return r + 2; }, fmt: function (v) { return round1(v) + ' items'; },
      desc: 'How many letters or symbols you hold while you check sums.' };
    return { value: function (r) { return r + 1; }, fmt: function (v) { return 'step ' + round1(v); }, desc: '' };
  }

  var STEP_WORD = { 1: 'the next one', 2: 'two after', '-1': 'one before' };

  function trackSeries(r, id, info) {
    var sc = levelScale(id), level = [], ba = [], markers = [], lastStep = null;
    info.list.forEach(function (s) {
      var n = info.ord[s.id];
      var bl = (info.blocksBy[s.id] || []).filter(function (b) { return b.trackId === id; });
      if (!bl.length) return;
      var last = bl[bl.length - 1];
      var lv = isNum(last.levelAfter) ? last.levelAfter : last.rung;
      if (isNum(lv)) level.push({ x: n, y: sc.value(lv) });
      var sum = 0, k = 0;
      bl.forEach(function (b) { if (scored(b)) { sum += b.result.ba; k++; } });
      if (k) ba.push({ x: n, y: sum / k });
      if (id === 'nback.transform') bl.forEach(function (b) {
        var st = b.rungParams && isNum(b.rungParams.step) ? b.rungParams.step : 1;
        if (lastStep !== null && st !== lastStep) markers.push({ x: n, label: 'Rule: ' + (STEP_WORD[st] || (st > 0 ? '+' + st : st)), kind: 'rule' });
        lastStep = st;
      });
    });
    var xs = level.concat(ba).map(function (p) { return p.x; });
    if (xs.length) {
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), prev = null;
      info.list.forEach(function (s) {
        var n = info.ord[s.id], m = s.protocol ? 'protocols' : (s.mode || 'varied');
        if (prev !== null && m !== prev && n > x0 && n <= x1) markers.push({ x: n, label: HF.modes ? HF.modes.label(m) : m, kind: 'mode' });
        prev = m;
      });
      var t = CAT().get(id);
      if (t && t.tier && t.tier < 8) {
        var nextId = 'rel.grid.T' + (t.tier + 1), first = null;
        info.list.some(function (s) {
          var hit = (info.blocksBy[s.id] || []).some(function (b) { return b.trackId === nextId; });
          if (hit) first = info.ord[s.id];
          return hit;
        });
        if (first && first > x0 && first <= x1) markers.push({ x: first, label: 'Tier ' + (t.tier + 1) + ' opened', kind: 'rule' });
      }
    }
    var seen = {};
    markers = markers.filter(function (m) { var k = m.x + m.kind; if (seen[k]) return false; seen[k] = 1; return true; });
    return { level: level, ba: ba, markers: markers, scale: sc };
  }

  function learningCurves(r, d) {
    var intro = {};
    (r.events || []).forEach(function (e) {
      if (e && e.type === 'track-intro' && e.trackId && !(e.trackId in intro)) intro[e.trackId] = e.t;
    });
    var tracks = d.tracks || {};
    Object.keys(tracks).forEach(function (id) { if (isNum(tracks[id].firstAt) && !(id in intro)) intro[id] = tracks[id].firstAt; });
    var ids = Object.keys(intro).filter(function (id) { return CAT() && CAT().get(id); });
    ids.sort(function (a, b) { return intro[b] - intro[a]; });
    var out = [];
    var blocks = (r.blocks || []).filter(scored).sort(byT);
    for (var i = 0; i < ids.length && out.length < 3; i++) {
      var id = ids[i];
      var bl = blocks.filter(function (b) { return b.trackId === id; }).slice(0, 15);
      if (bl.length < 2) continue;
      out.push({ name: K().trackName(id), slot: out.length + 1, points: bl.map(function (b, j) { return { x: j + 1, y: b.result.ba }; }) });
    }
    return out;
  }

  function sessionMinutes(s, blocks) {
    if (isNum(s.minutes) && s.minutes > 0) return s.minutes;
    if (!blocks || !blocks.length) return 0;
    var lo = blocks[0].t, hi = blocks[blocks.length - 1].t;
    return Math.max(1, (hi - lo) / 60000 + 1.5);
  }

  function minutesPerWeek(r, info) {
    var U = HF.util;
    if (!info.list.length || !U || !U.weekKey) return null;
    var sums = {};
    info.list.forEach(function (s) {
      var wk = U.weekKey(s.startedAt);
      sums[wk] = (sums[wk] || 0) + sessionMinutes(s, info.blocksBy[s.id]);
    });
    var first = U.weekKey(info.list[0].startedAt), last = U.weekKey(Date.now());
    var weeks = [], wk = first, guard = 0;
    while (wk <= last && guard++ < 520) { weeks.push(wk); wk = U.addDays(wk, 7); }
    return {
      points: weeks.map(function (w, i) { return { x: i + 1, y: Math.round(sums[w] || 0) }; }),
      label: function (v) { var w = weeks[Math.round(v) - 1]; return w ? K().fmtDate(U.parseDayKey(w)) : ''; }
    };
  }

  // ------------------------------------------------------------------ backup tools
  var B = { lastResult: null, lastResultAt: 0 };

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 10000) / 10000) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csv(cols, rows) {
    var out = [cols.join(',')];
    rows.forEach(function (row) { out.push(cols.map(function (k) { return csvCell(row[k]); }).join(',')); });
    return out.join('\r\n') + '\r\n';
  }
  function localDate(ms) { return isNum(ms) ? K().dayKey(ms) : ''; }
  function localTime(ms) { return isNum(ms) ? K().fmtTime(ms) : ''; }
  function sumStreams(res, key, alt) {
    var s = res && res.streams, n = 0, any = false;
    if (!s) return null;
    Object.keys(s).forEach(function (k) {
      var x = s[k]; if (!x) return;
      var v = isNum(x[key]) ? x[key] : isNum(x[alt]) ? x[alt] : null;
      if (v !== null) { n += v; any = true; }
    });
    return any ? n : null;
  }
  function medianRt(res) {
    var s = res && res.streams, vals = [];
    if (!s) return null;
    Object.keys(s).forEach(function (k) { var x = s[k]; var v = x && (isNum(x.rt) ? x.rt : x.rtMedian); if (isNum(v)) vals.push(v); });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function csvBlocks(r) {
    var C = CAT();
    var cols = ['block_id', 'session_id', 'date', 'time', 'started_at_ms', 'track_id', 'version', 'level', 'set', 'role', 'purpose', 'mode', 'protocol',
      'unit_id', 'rung', 'level_before', 'level_after', 'moved', 'reason', 'ba', 'ba_mean', 'dprime', 'criterion', 'hits', 'misses', 'false_alarms',
      'correct_rejections', 'lure_false_alarms', 'lure_trials', 'rt_median_ms', 'ba_by_stream', 'scorable_trials', 'voided_ratio', 'interrupted',
      'recall', 'judgements', 'fps', 'stalls', 'low_precision', 'seed'];
    var rows = (r.blocks || []).slice().sort(byT).map(function (b) {
      var res = b.result || {}, ex = res.extra || {}, fr = b.frame || {};
      var byStream = res.streams ? Object.keys(res.streams).map(function (k) {
        var x = res.streams[k]; return x && isNum(x.ba) ? k + ':' + round1(x.ba * 1000) / 1000 : null;
      }).filter(Boolean).join(';') : '';
      return {
        block_id: b.id, session_id: b.sessionId, date: localDate(b.t), time: localTime(b.t), started_at_ms: b.t, track_id: b.trackId,
        version: C && C.get(b.trackId) ? C.get(b.trackId).name : '', level: C && C.get(b.trackId) && isNum(b.rung) ? C.levelLabel(b.trackId, b.rung) : '',
        set: b.set, role: b.role, purpose: b.purpose, mode: b.mode, protocol: b.protocol, unit_id: b.unitId, rung: b.rung,
        level_before: b.levelBefore, level_after: b.levelAfter, moved: b.moved, reason: b.reason, ba: res.ba, ba_mean: res.baMean,
        dprime: res.dprime, criterion: res.crit, hits: sumStreams(res, 'h', 'hits'), misses: sumStreams(res, 'm', 'misses'),
        false_alarms: sumStreams(res, 'fa', 'fas'), correct_rejections: sumStreams(res, 'cr', 'crs'), lure_false_alarms: sumStreams(res, 'lfa', 'lureFas'),
        lure_trials: sumStreams(res, 'lt', 'lureTrials'), rt_median_ms: medianRt(res), ba_by_stream: byStream, scorable_trials: res.n,
        voided_ratio: isNum(b.voidedRatio) ? b.voidedRatio : res.voidedRatio, interrupted: !!b.interrupted, recall: ex.recall, judgements: ex.procAcc,
        fps: fr.fps, stalls: fr.stalls, low_precision: fr.lowPrecision, seed: b.seed
      };
    });
    return csv(cols, rows);
  }

  function csvSessions(r, d) {
    d = d || {};
    var counted = d.counted || {};
    var blocksBy = {};
    (r.blocks || []).forEach(function (b) { if (b) blocksBy[b.sessionId] = (blocksBy[b.sessionId] || 0) + 1; });
    var cols = ['session_id', 'date', 'start_time', 'started_at_ms', 'ended_at_ms', 'mode', 'protocol', 'study_template', 'study_arm', 'planned_blocks',
      'completed_blocks', 'blocks_saved', 'minutes', 'ended_by', 'counted', 'session_index'];
    var rows = (r.sessions || []).slice().sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); }).map(function (s) {
      return {
        session_id: s.id, date: localDate(s.startedAt), start_time: localTime(s.startedAt), started_at_ms: s.startedAt, ended_at_ms: s.endedAt,
        mode: s.mode, protocol: s.protocol, study_template: s.study ? s.study.template : null, study_arm: s.study ? s.study.arm : null,
        planned_blocks: s.planned, completed_blocks: s.completed, blocks_saved: blocksBy[s.id] || 0, minutes: s.minutes, ended_by: s.endedBy,
        counted: !!counted[s.id], session_index: s.sessionIndex
      };
    });
    return csv(cols, rows);
  }

  function summary(res) {
    if (!res) return '';
    if (!res.ok) return 'Nothing was imported: ' + (res.error || 'this does not look like a Long-Horizon backup') + '.';
    var bits = [];
    bits.push((res.added || 0) + ' new ' + ((res.added || 0) === 1 ? 'record' : 'records'));
    bits.push((res.updated || 0) + ' updated');
    if (res.trials) bits.push('trial details for ' + res.trials + (res.trials === 1 ? ' session' : ' sessions'));
    var s = 'Imported: ' + bits.join(', ') + '. Nothing on this device was removed.';
    if (res.migratedFrom) s += ' The backup came from an older version and was converted.';
    return s;
  }

  function today() { return K().dayKey(Date.now()); }
  /** A framed page with an opaque origin that is not a local file: a sandboxed preview, where downloads are
   *  usually blocked without any error. (A file:// page also has the origin "null", so the protocol is checked.) */
  function previewLikely() {
    try {
      var framed = root.self !== root.top;
      return framed && String(root.origin) === 'null' && root.location.protocol !== 'file:';
    } catch (e) { return true; }
  }

  function backupPanel(opts) {
    opts = opts || {};
    var Cc = c();
    var r = K().records() || {};
    var lastLine = h('p', { 'class': 'hf-backup__last' });
    function showLast() {
      var rr = K().records() || {};
      var last = rr.backups && rr.backups.lastExportAt;
      clear(lastLine);
      lastLine.appendChild(h('span', { 'class': 'hf-strong' }, ['Last backup: ']));
      var ago = isNum(last) ? K().daysBetween(last, Date.now()) : null;
      lastLine.appendChild(doc.createTextNode(isNum(last) ? K().fmtDate(last, { year: true, time: true }) +
        (ago === 0 ? ' (today)' : ago === 1 ? ' (yesterday)' : ago < 7 ? ' (' + ago + ' days ago)' : '') : 'none yet'));
    }
    showLast();
    var status = h('p', { 'class': 'hf-small hf-backup__status', role: 'status' });
    var box = Cc.copyBox({ label: 'Backup text', rows: 5, text: '', download: 'long-horizon-backup-' + today() + '.json', mime: 'application/json',
      hint: 'If no file downloaded (some previews block downloads), copy this text and save it as a .json file.' });
    var boxWrap = h('div', { 'class': 'hf-backup__box', hidden: true }, [box]);
    var labelEl = box.querySelector('.hf-copy__label');
    function show(label, text, filename, mime) {
      box.setText(text);
      if (labelEl) labelEl.textContent = label;
      boxWrap.hidden = false;
      var ok = false;
      try { ok = HF.dom && HF.dom.download ? HF.dom.download(filename, text, mime) : false; } catch (e) { ok = false; }
      status.textContent = !ok ? 'The download was blocked here. Copy the text below and save it as a file instead.'
        : previewLikely() ? 'This preview probably blocks downloads. If no file appeared, copy the text below and save it as ' + filename + '.'
          : 'Download started: ' + filename + '. The same text is below.';
    }
    var exportBtn = Cc.button('Export backup', { variant: 'secondary', icon: 'download', id: 'hf-export-json', onClick: function () {
      var text = '';
      try { text = HF.store.exportText(); } catch (e) { status.textContent = 'Export failed: ' + (e && e.message ? e.message : e); return; }
      show('Backup text (JSON)', text, 'long-horizon-backup-' + today() + '.json', 'application/json');
      showLast();
    } });
    var csvB = Cc.button('Blocks as CSV', { variant: 'quiet', id: 'hf-export-blocks', onClick: function () {
      show('Blocks (CSV)', csvBlocks(K().records() || {}), 'long-horizon-blocks-' + today() + '.csv', 'text/csv');
    } });
    var csvS = Cc.button('Sessions as CSV', { variant: 'quiet', id: 'hf-export-sessions', onClick: function () {
      show('Sessions (CSV)', csvSessions(K().records() || {}, K().derived()), 'long-horizon-sessions-' + today() + '.csv', 'text/csv');
    } });

    // import
    var result = h('div', { 'class': 'hf-backup__result', 'aria-live': 'polite' });
    function showResult(res) {
      B.lastResult = res; B.lastResultAt = Date.now();
      clear(result);
      var errs = (res && res.errors) || [];
      result.appendChild(Cc.notice({ tone: res && res.ok ? 'good' : 'bad', title: res && res.ok ? 'Backup imported' : 'Not imported', text: summary(res), slim: true }));
      if (errs.length) {
        result.appendChild(Cc.details(errs.length + (errs.length === 1 ? ' item was skipped' : ' items were skipped'),
          h('ul', { 'class': 'hf-small hf-backup__errors' }, errs.slice(0, 20).map(function (e) { return h('li', null, [String(e)]); }))));
      }
      showLast();
    }
    function doImport(text) {
      var res;
      try { res = HF.store.importText(text); } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
      showResult(res);
      return res;
    }
    var file = h('input', { type: 'file', accept: '.json,application/json,text/plain', 'class': 'hf-vh', id: 'hf-import-file', tabindex: '-1', 'aria-hidden': 'true' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var rd = new root.FileReader();
      rd.onload = function () { doImport(String(rd.result || '')); file.value = ''; };
      rd.onerror = function () { showResult({ ok: false, error: 'the file could not be read' }); file.value = ''; };
      try { rd.readAsText(f); } catch (e) { showResult({ ok: false, error: 'the file could not be read' }); }
    });
    var pickBtn = Cc.button('Import a backup file', { variant: 'secondary', icon: 'upload', id: 'hf-import-pick', onClick: function () { file.click(); } });
    var paste = h('textarea', { 'class': 'hf-input hf-backup__paste', id: 'hf-import-text', rows: '4', spellcheck: 'false', autocomplete: 'off',
      placeholder: 'Paste the backup text here' });
    var pasteBtn = Cc.button('Import pasted text', { variant: 'secondary', id: 'hf-import-paste', onClick: function () {
      var t = paste.value.trim();
      if (!t) { showResult({ ok: false, error: 'the box is empty' }); return; }
      var res = doImport(t);
      if (res && res.ok) paste.value = '';
    } });
    if (B.lastResult && Date.now() - B.lastResultAt < 120000) showResult(B.lastResult);

    var kids = [
      lastLine,
      h('p', { 'class': 'hf-soft hf-small' }, ['A backup is one file with your sessions, levels, Lab results and settings. Importing merges it with what is here: nothing is overwritten or removed.']),
      h('div', { 'class': 'hf-actions' }, [exportBtn, csvB, csvS]),
      status,
      boxWrap,
      h('h3', { 'class': 'hf-h3 hf-backup__h' }, ['Import']),
      h('div', { 'class': 'hf-actions' }, [pickBtn, file]),
      Cc.details('Paste backup text instead', [Cc.field({ label: 'Backup text', control: paste }), h('div', { 'class': 'hf-actions' }, [pasteBtn])]),
      result
    ];
    if (opts.reset) {
      kids.push(h('h3', { 'class': 'hf-h3 hf-backup__h' }, ['Start over']));
      kids.push(h('p', { 'class': 'hf-soft hf-small' }, ['Reset deletes every session, level, badge and Lab result on this device, and your settings. It cannot be undone; export a backup first if you might want it back.']));
      kids.push(h('div', { 'class': 'hf-actions' }, [Cc.button('Reset Long-Horizon', { variant: 'danger', icon: 'trash', id: 'hf-reset', onClick: confirmReset })]));
    }
    return h('div', { 'class': 'hf-backup hf-stack' }, kids);
  }

  function confirmReset() {
    var ask = HF.dom && HF.dom.confirm ? HF.dom.confirm('This deletes every session, level, badge, Lab result and setting on this device. Export a backup first if you might want them back.',
      { ok: 'Delete everything', cancel: 'Keep my data', title: 'Reset Long-Horizon?', danger: true }) : Promise.resolve(false);
    return ask.then(function (yes) {
      if (!yes) return false;
      try { HF.store.reset(); } catch (e) { if (root.console) console.error('[long-horizon] reset failed', e); return false; }
      try { if (ui.shell && ui.shell.applySettings) ui.shell.applySettings(HF.store.records.settings); } catch (e2) { /* ignore */ }
      try { if (HF.input && HF.input.setKeys) HF.input.setKeys(null); } catch (e3) { /* ignore */ }
      try { if (HF.dom && HF.dom.toast) HF.dom.toast('Long-Horizon was reset. Everything starts fresh.', { kind: 'ok', timeout: 6000 }); } catch (e4) { /* ignore */ }
      B.lastResult = null;
      if (HF.router) HF.router.go('today', {}, { replace: true });
      return true;
    });
  }

  function openModal() {
    if (!HF.dom || !HF.dom.modal) return null;
    return HF.dom.modal(function (body, hd) {
      body.appendChild(backupPanel({}));
      body.appendChild(h('div', { 'class': 'hf-modal__actions' }, [c().button('Done', { variant: 'secondary', onClick: function () { hd.close(true); } })]));
    }, { title: 'Back up your progress', className: 'hf-modal--backup' });
  }

  ui.backup = { panel: backupPanel, openModal: openModal, csvBlocks: csvBlocks, csvSessions: csvSessions, summary: summary, confirmReset: confirmReset };

  // ------------------------------------------------------------------ Progress screen
  var P = { root: null, off: [], params: {}, graphTrack: null, ackTimer: null, graphs: null };
  var GROUPS = [
    { task: 'nback', title: 'N-back' }, { task: 'relations', title: 'Relations' },
    { task: 'span', title: 'Span' }, { task: 'vsearch', title: 'Visual search' }
  ];

  function glyph(family) {
    var S = c().svg;
    var shape = family === 'relations' ? S('path', { d: 'M7 1.2L13 12.6H1z' })
      : family === 'span' ? S('circle', { cx: 7, cy: 7, r: 5.8 })
        : family === 'vsearch' ? S('path', { d: 'M7 .8L13.2 7 7 13.2.8 7z' })
          : S('rect', { x: 1.5, y: 1.5, width: 11, height: 11, rx: 1.5 });
    return S('svg', { viewBox: '0 0 14 14', 'class': 'hf-trk__glyph hf-glyph--' + family, 'aria-hidden': 'true', focusable: 'false' }, [shape]);
  }

  function bestText(id, pb) {
    if (!pb || !isNum(pb.peak) || pb.peak < 0) return null;
    var txt = K().levelText(id, pb.peak);
    return txt.charAt(0).toLowerCase() === txt.charAt(0) ? txt : txt.charAt(0).toLowerCase() + txt.slice(1);
  }

  function zoneFor(id, tr, d) {
    var Cc = c(), z = tr.zone || {};
    var modeId = d.mode && d.mode.effective;
    if (!z.last || !z.last.length) return h('p', { 'class': 'hf-small hf-muted' }, ['No scored blocks at this level yet.']);
    if (!isNum(z.U) || !isNum(z.D)) return h('p', { 'class': 'hf-small hf-muted' }, ['Protocols move levels by each paper’s own rule, so there are no step lines here.']);
    var span = tr && CAT().get(id) && CAT().get(id).scale === 'recall';
    return Cc.zoneMeter({
      title: span ? 'Last three blocks (recall)' : 'Last three blocks', summary: null, scores: z.last, down: z.D, up: z.U,
      mode: modeId === 'mastery' && z.qualifying ? 'mastery' : 'zone', min: span ? 0 : 0.5, max: 1
    });
  }

  function trackRow(id, tr, d, open) {
    var Cc = c(), t = CAT().get(id), pb = d.pbs && d.pbs[id];
    var best = bestText(id, pb);
    var lvl = K().levelText(id, tr.level);
    var eq = tr.levelEqText && tr.ratedBlocks > 0 ? 'skill ' + tr.levelEqText : null;
    var sum = h('summary', { 'class': 'hf-trk__sum' }, [
      glyph(t.task),
      h('span', { 'class': 'hf-trk__main' }, [
        h('span', { 'class': 'hf-trk__name' }, [t.name]),
        h('span', { 'class': 'hf-trk__level' }, [
          tr.ratedBlocks > 0 || tr.blocks > 0 ? lvl : (tr.placing ? 'Starts at ' + lvl : lvl),
          eq ? h('span', { 'class': 'hf-trk__eq' }, [' · ' + eq]) : null
        ])
      ]),
      best ? h('span', { 'class': 'hf-trk__meta' }, [h('span', { 'class': 'hf-vh' }, ['Personal best: ']), h('span', { 'aria-hidden': 'true' }, ['Best ']), best]) : null,
      Cc.icon('chev-down', { cls: 'hf-trk__chev' })
    ]);
    var facts = [];
    try { facts.push({ label: 'At this level', value: CAT().levelDetail(id, tr.level) }); } catch (e) { /* ignore */ }
    facts.push({ label: 'Blocks played', value: tr.blocks ? tr.blocks + (tr.ratedBlocks !== tr.blocks ? ' (' + tr.ratedBlocks + ' scored)' : '') : 'none yet' });
    if (tr.lastPlayedAt) facts.push({ label: 'Last played', value: K().fmtAgo(tr.lastPlayedAt) });
    if (pb && pb.bestBA && isNum(pb.bestBA[tr.level])) facts.push({ label: 'Best block at this level', value: K().pct(pb.bestBA[tr.level]) });
    if (isNum(tr.predicted)) facts.push({ label: 'Expected score now', value: 'about ' + K().pct(tr.predicted) });
    if (tr.levelEqText && tr.ratedBlocks > 0) facts.push({ label: 'Skill estimate', value: tr.levelEqText });
    var body = h('div', { 'class': 'hf-trk__body' }, [
      zoneFor(id, tr, d),
      Cc.dl(facts),
      h('div', { 'class': 'hf-actions' }, [
        tr.blocks ? Cc.button('Show graph', { variant: 'secondary', size: 'sm', icon: 'progress', onClick: function () { P.graphTrack = id; redrawGraphs(true); } }) : null,
        Cc.button('Free play', { variant: 'quiet', size: 'sm', go: 'free', attrs: { 'data-params': JSON.stringify({ trackId: id }) } })
      ])
    ]);
    return h('details', { 'class': 'hf-trk', open: !!open, 'data-track': id }, [sum, body]);
  }

  function levelsSection(r, d) {
    var sec = K().section({ id: 'levels', title: 'Levels', lead: 'Each version has its own ladder. “Skill ≈” is the hardest level where your history predicts about 80 % correct. Open a row for its last three blocks against the step lines.' });
    var tracks = d.tracks || {};
    var recent = null;
    Object.keys(tracks).forEach(function (id) { if (tracks[id].lastPlayedAt && (!recent || tracks[id].lastPlayedAt > tracks[recent].lastPlayedAt)) recent = id; });
    var want = P.params.trackId && tracks[P.params.trackId] ? P.params.trackId : recent;
    GROUPS.forEach(function (g) {
      var ids = CAT().tracksOfTask(g.task);
      var open = ids.filter(function (id) { return tracks[id] && tracks[id].available; });
      var locked = ids.filter(function (id) { return tracks[id] && !tracks[id].available; });
      if (g.task === 'vsearch') { open = open.filter(function (id) { return tracks[id].blocks > 0; }); locked = []; }
      if (g.task === 'span' && !open.length && !(r.settings && r.settings.spanOn)) {
        sec.appendChild(h('div', { 'class': 'hf-trk-group' }, [
          h('h3', { 'class': 'hf-h3' }, [g.title]),
          h('p', { 'class': 'hf-small hf-muted' }, ['Span (complex span) is off. It is offered after the 20-session programme, or any time you switch it on in Settings.'])
        ]));
        return;
      }
      if (!open.length && !locked.length) return;
      var kids = [h('h3', { 'class': 'hf-h3' }, [g.title])];
      if (open.length) kids.push(h('div', { 'class': 'hf-trk-list' }, open.map(function (id) { return trackRow(id, tracks[id], d, id === want); })));
      if (locked.length) {
        kids.push(c().details(locked.length + (locked.length === 1 ? ' version opens later' : ' versions open later'),
          h('ul', { 'class': 'hf-locked' }, locked.map(function (id) {
            return h('li', { 'class': 'hf-locked__item' }, [
              c().icon('lock', { cls: 'hf-locked__icon' }),
              h('span', null, [h('span', { 'class': 'hf-locked__name' }, [K().trackName(id)]), h('span', { 'class': 'hf-locked__how' }, [CAT().gateText(id)])])
            ]);
          })), { cls: 'hf-locked-wrap' }));
      }
      sec.appendChild(h('div', { 'class': 'hf-trk-group' }, kids));
    });
    return sec;
  }

  function graphsSection(r, d) {
    var Cc = c();
    var sec = K().section({ id: 'graphs', title: 'Graphs' });
    var info = orderedSessions(r);
    if (!info.list.length) {
      sec.appendChild(Cc.empty({ title: 'Graphs start after your first session', text: 'Levels, block scores and minutes per week will appear here.', art: 'chart' }));
      return sec;
    }
    var played = Object.keys(d.tracks || {}).filter(function (id) { return d.tracks[id].blocks > 0; });
    played.sort(function (a, b) { return CAT().ids().indexOf(a) - CAT().ids().indexOf(b); });
    if (!P.graphTrack || played.indexOf(P.graphTrack) < 0) {
      var want = P.params.trackId;
      if (want && played.indexOf(want) >= 0) P.graphTrack = want;
      else {
        var most = null;
        played.forEach(function (id) { if (!most || d.tracks[id].blocks > d.tracks[most].blocks) most = id; });
        P.graphTrack = most;
      }
    }
    if (P.graphTrack) {
      var id = P.graphTrack;
      sec.appendChild(Cc.select({ label: 'Version', id: 'hf-graph-track', value: id, options: played.map(function (x) { return { value: x, label: K().trackName(x) }; }),
        onChange: function (v) { P.graphTrack = v; redrawGraphs(false, 'hf-graph-track'); } }));
      var ser = trackSeries(r, id, info);
      var sc = ser.scale;
      sec.appendChild(Cc.lineChart({
        title: 'Level after each session', desc: sc.desc, cls: 'hf-chart--level',
        series: [{ name: K().trackName(id), points: ser.level, slot: 1 }], curve: 'step',
        x: { label: 'Session', format: function (v) { return String(v); } }, y: { format: sc.fmt },
        markers: ser.markers, summary: 'Level of ' + K().trackName(id) + ' after each session, ' + ser.level.length + ' sessions. A table version follows.',
        emptyText: 'No sessions on this version yet.'
      }));
      var span = CAT().get(id) && CAT().get(id).scale === 'recall';
      var minY = 0.5;
      ser.ba.forEach(function (p) { if (p.y < minY) minY = Math.floor(p.y * 10) / 10; });
      sec.appendChild(Cc.lineChart({
        title: span ? 'Recall per session' : 'Block score per session',
        desc: span ? 'Share of items recalled in order, scored blocks only.' : 'Balanced accuracy (matches caught and non-matches left alone, weighted equally), scored blocks only; the line is a 3-session trend.',
        series: [{ name: 'Score', points: ser.ba, slot: 1 }], smooth: 3, cls: 'hf-chart--ba',
        x: { label: 'Session', format: function (v) { return String(v); } }, y: { min: minY, max: 1, format: function (v) { return K().pct(v); } },
        markers: ser.markers, emptyText: 'No scored blocks on this version yet.'
      }));
    }
    var curves = learningCurves(r, d);
    if (curves.length) {
      var lo = 0.5;
      curves.forEach(function (s) { s.points.forEach(function (p) { if (p.y < lo) lo = Math.floor(p.y * 10) / 10; }); });
      sec.appendChild(Cc.lineChart({
        title: 'First blocks on new versions', desc: 'Scores of the first 15 scored blocks after each of your newest versions was introduced (3-block trend).',
        series: curves, smooth: 3, cls: 'hf-chart--curves',
        x: { label: 'Block on that version', format: function (v) { return String(v); } }, y: { min: lo, max: 1, format: function (v) { return K().pct(v); } }
      }));
    }
    var mw = minutesPerWeek(r, info);
    if (mw && mw.points.length) {
      var top = 0;
      mw.points.forEach(function (p) { if (p.y > top) top = p.y; });
      sec.appendChild(Cc.lineChart({
        title: 'Minutes per week', desc: 'All training sessions, weeks starting on Monday.', cls: 'hf-chart--minutes',
        series: [{ name: 'Minutes', points: mw.points, slot: 3 }], curve: 'linear',
        // the readout head is the axis label + the formatted week ("Week of 3 Nov"); tipLabel must be a function, and
        // the string 'Week of' here threw on every hover, focus and arrow key (Phase 4, UX-01)
        x: { label: 'Week of', format: mw.label }, y: { min: 0, max: Math.max(30, top), format: function (v) { return Math.round(v) + ' min'; } }
      }));
    }
    return sec;
  }

  function weekSection(r, d) {
    var wk = d.week;
    if (!wk) return null;
    var sec = K().section({ id: 'week', title: 'Weekly goal', cls: 'hf-mot' });
    var kids = [c().weeklyRing({ done: wk.count || 0, target: Math.max(1, wk.target || 4), size: 'sm' })];
    var line = (wk.weeksMet > 0 ? 'Target reached in ' + wk.weeksMet + (wk.weeksMet === 1 ? ' week' : ' weeks') + ' so far. ' : '') +
      'Any day of the week counts, so a session can be made up later; each Monday starts fresh.';
    kids.push(h('p', { 'class': 'hf-small hf-soft' }, [line]));
    sec.appendChild(h('div', { 'class': 'hf-progress__week' }, kids));
    return sec;
  }

  function badgesSection(d) {
    var Cc = c(), L = (HF.badges && HF.badges.LIST) || [];
    var earned = d.badges || {}, unseen = d.badgesUnseen || [];
    var got = L.filter(function (b) { return isNum(earned[b.id]); });
    var notYet = L.filter(function (b) { return !isNum(earned[b.id]); });
    var sec = K().section({ id: 'badges', title: 'Badges', cls: 'hf-mot', aside: Cc.chip(got.length + ' of ' + L.length, { tone: got.length ? 'good' : 'outline' }),
      lead: 'Milestones in learning. Never for speed or streaks, and never needed for anything.' });
    function look(b) { return K().BADGES[b.id] || { glyph: 'star', tone: 'blue' }; }
    if (got.length) {
      sec.appendChild(Cc.badges(got.map(function (b) {
        var node = Cc.badge({ title: b.label, desc: b.text, earned: true, date: K().fmtDate(earned[b.id]), glyph: look(b).glyph, tone: look(b).tone });
        node.setAttribute('data-badge', b.id);
        if (unseen.indexOf(b.id) >= 0) { node.classList.add('is-new'); node.appendChild(Cc.chip('New', { tone: 'good', cls: 'hf-badge__new' })); }
        return node;
      })));
    } else {
      sec.appendChild(Cc.empty({ title: 'No badges yet', text: 'The first usually comes with the tutorial check. They appear here as you reach them.', art: 'none' }));
    }
    if (notYet.length) {
      sec.appendChild(Cc.details(notYet.length + ' not earned yet', Cc.badges(notYet.map(function (b) {
        var node = Cc.badge({ title: b.label, desc: b.text, earned: false, glyph: look(b).glyph, tone: look(b).tone });
        node.setAttribute('data-badge', b.id);
        return node;
      })), { cls: 'hf-badges-later' }));
    }
    return sec;
  }

  function lifetimeSection(d) {
    var Cc = c(), k = d.counters || {};
    var sec = K().section({ id: 'lifetime', title: 'Lifetime', lead: 'These counts only ever grow.' });
    var extra = (k.sessions || 0) - (k.sessionsCounted || 0);
    sec.appendChild(Cc.stats([
      { label: 'Sessions', value: k.sessionsCounted || 0, note: extra > 0 ? 'plus ' + extra + ' extra' : null },
      { label: 'Blocks', value: k.blocks || 0 },
      (k.minutes || 0) < 120 ? { label: 'Time training', value: Math.round(k.minutes || 0), unit: 'min' }
        : { label: 'Time training', value: (Math.round((k.minutes || 0) / 6) / 10).toFixed(1), unit: 'h' },
      { label: 'Items answered', value: k.trials || 0 },
      { label: 'Lessons passed', value: k.lessonsPassed || 0 },
      { label: 'Lab visits', value: k.labVisits || 0 }
    ]));
    return sec;
  }

  function ackBadges(d) {
    var unseen = (d.badgesUnseen || []).slice();
    if (!unseen.length || !HF.store || !HF.store.mutate) return;
    if (P.ackTimer) clearTimeout(P.ackTimer);
    P.ackTimer = setTimeout(function () {
      P.ackTimer = null;
      try {
        HF.store.mutate(function (r) {
          var t = Date.now();
          var have = {};
          (r.events || []).forEach(function (e) { if (e && e.type === 'badge-ack') have[e.badgeId] = 1; });
          var add = unseen.filter(function (id) { return !have[id]; }).map(function (id, i) {
            return { id: (HF.util && HF.util.id ? HF.util.id('ev') : 'ev-' + t + '-' + i) + '-ack', t: t, type: 'badge-ack', badgeId: id };
          });
          if (add.length) r.events = (r.events || []).concat(add);
        }, { silent: true });
      } catch (e) { /* ignore */ }
    }, 1200);
  }

  function drawProgress(scrollTo, focusId) {
    var rootEl = P.root;
    if (!rootEl) return;
    var y = root.scrollY || 0;
    clear(rootEl);
    var r = K().records() || {}, d = K().derived(), Cc = c();
    var pg = K().page({ title: 'Progress', lead: 'Levels, graphs and milestones. Everything here stays on this device.', cls: 'hf-progress' });
    pg.head.appendChild(h('div', { 'class': 'hf-actions hf-progress__actions' }, [
      Cc.button('Share to Discord', { variant: 'secondary', icon: 'people', id: 'hf-share-btn', onClick: function () { if (ui.share) ui.share.open(); } }),
      Cc.button('History', { variant: 'quiet', icon: 'clock', go: 'history' })
    ]));
    var node = pg.node;
    try { node.appendChild(levelsSection(r, d)); } catch (e) { if (root.console) console.error(e); }
    try { P.graphs = graphsSection(r, d); node.appendChild(P.graphs); } catch (e2) { P.graphs = null; if (root.console) console.error(e2); }
    var ws = weekSection(r, d); if (ws) node.appendChild(ws);
    node.appendChild(badgesSection(d));
    node.appendChild(lifetimeSection(d));
    var bs = K().section({ id: 'backup', title: 'Backup', lead: null });
    bs.appendChild(backupPanel({}));
    node.appendChild(bs);
    rootEl.appendChild(node);
    ackBadges(d);
    if (scrollTo) {
      var target = doc.getElementById(scrollTo);
      if (target) { try { target.scrollIntoView({ block: 'start' }); } catch (e3) { target.scrollIntoView(); } }
    } else { try { root.scrollTo(0, y); } catch (e4) { /* ignore */ } }
    if (focusId) { var f = doc.getElementById(focusId); if (f) try { f.focus({ preventScroll: true }); } catch (e5) { /* ignore */ } }
  }

  /** Rebuild only the Graphs section (keeps opened rows, scroll position and focus elsewhere). */
  function redrawGraphs(scroll, focusId) {
    if (!P.root || !P.graphs || !P.graphs.parentNode) { drawProgress(scroll ? 'graphs' : null, focusId); return; }
    var fresh;
    try { fresh = graphsSection(K().records() || {}, K().derived()); } catch (e) { if (root.console) console.error(e); return; }
    P.graphs.parentNode.replaceChild(fresh, P.graphs);
    P.graphs = fresh;
    if (scroll) {
      try { fresh.scrollIntoView({ block: 'start' }); } catch (e2) { fresh.scrollIntoView(); }
      var sel = doc.getElementById('hf-graph-track');
      if (sel) try { sel.focus({ preventScroll: true }); } catch (e3) { /* ignore */ }
    }
    if (focusId) { var f = doc.getElementById(focusId); if (f) try { f.focus({ preventScroll: true }); } catch (e4) { /* ignore */ } }
  }

  function cleanupP() {
    P.off.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    P.off = [];
  }

  var progressScreen = {
    title: 'Progress',
    render: function (rootEl, params) {
      cleanupP();
      P.root = rootEl; P.params = params || {};
      if (P.params.trackId) P.graphTrack = P.params.trackId;
      drawProgress(null);
      if (P.params.section) {
        var sid = P.params.section;
        setTimeout(function () {
          var t = doc.getElementById(sid);
          if (t && P.root && P.root.contains(t)) {
            try { t.scrollIntoView({ block: 'start' }); } catch (e) { t.scrollIntoView(); }
            var hd = t.querySelector('h2');
            if (hd) { hd.setAttribute('tabindex', '-1'); try { hd.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
          }
        }, 0);
      }
      P.off.push(K().watch(function (evt) { drawProgress(evt && evt.source === 'import' ? 'backup' : null); }));
    },
    leave: function () {
      cleanupP();
      if (P.ackTimer) { clearTimeout(P.ackTimer); P.ackTimer = null; }
      P.root = null;
      P.graphs = null;   // Phase 3: this section reference kept the whole previous Progress page (≈1,000 nodes) alive
    }
  };

  // ------------------------------------------------------------------ History screen
  var H = { root: null, off: [], version: 'all', kind: 'all', period: '30', shown: 15, openSession: null };
  var KINDS = [
    { value: 'all', label: 'All blocks' }, { value: 'scored', label: 'Scored blocks' }, { value: 'warmup', label: 'Warm-ups' },
    { value: 'free', label: 'Free play' }, { value: 'protocol', label: 'Protocol blocks' }
  ];
  var PERIODS = [{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: 'all', label: 'All time' }];
  var ROLE_TAG = { warmup: 'Warm-up', free: 'Free play', protocol: 'Protocol', check: 'Check', assist: 'Assisted' };
  var PURPOSE_TAG = { check: 'Check', review: 'Review', corrective: 'Extra practice', maintenance: 'Maintenance' };

  function kindMatch(b, kind) {
    if (kind === 'all') return true;
    if (kind === 'warmup') return b.role === 'warmup';
    if (kind === 'free') return b.role === 'free';
    if (kind === 'protocol') return b.role === 'protocol' || !!b.protocol;
    if (kind === 'scored') return b.role !== 'warmup' && !bad(b);
    return true;
  }

  function moveText(b) {
    if (bad(b)) return { word: b.result && b.result.paused ? 'Paused: no change' : 'No change (interrupted)', icon: null, dir: 'none' };
    if (b.role === 'warmup') return { word: '–', sr: 'Warm-up: the level does not move', icon: null, dir: 'none' };
    var m = isNum(b.moved) ? b.moved : 0;
    if (m > 0) return { word: m > 1 ? 'Up ' + m : 'Up', icon: 'up', dir: 'up' };
    if (m < 0) return { word: 'Eases back', icon: 'down', dir: 'down' };
    return { word: 'Stays', icon: null, dir: 'same' };
  }

  function blockRow(b, n) {
    var Cc = c(), res = b.result || {};
    var mv = moveText(b);
    var tag = ROLE_TAG[b.role] || PURPOSE_TAG[b.purpose] || null;
    var score = isNum(res.ba) ? K().pct(res.ba) : '–';
    var span = CAT().get(b.trackId) && CAT().get(b.trackId).scale === 'recall';
    return h('li', { 'class': 'hf-hist__block', 'data-block': b.id }, [
      h('span', { 'class': 'hf-hist__time hf-num' }, [K().fmtTime(b.t)]),
      h('span', { 'class': 'hf-hist__what' }, [K().chip(b.trackId, b.rung), tag ? Cc.chip(tag, { tone: 'outline', cls: 'hf-hist__tag' }) : null]),
      h('span', { 'class': 'hf-hist__score hf-num' }, [h('span', { 'class': 'hf-vh' }, [span ? 'Recall ' : 'Score ']), score]),
      h('span', { 'class': 'hf-hist__move hf-hist__move--' + mv.dir }, mv.sr ? [h('span', { 'aria-hidden': 'true' }, [mv.word]), h('span', { 'class': 'hf-vh' }, [mv.sr])] : [mv.icon ? Cc.icon(mv.icon) : null, mv.word]),
      Cc.button('Trials', { variant: 'quiet', size: 'sm', cls: 'hf-hist__trials', attrs: { 'aria-label': 'Trial details of block ' + n + ', ' + K().trackName(b.trackId) },
        onClick: function () { openTrials(b, n); } })
    ]);
  }

  function sessionItem(s, blocks, d, n, open) {
    var Cc = c();
    var counted = d.counted && d.counted[s.id];
    var modeLabel = s.protocol ? ((HF.protocols && HF.protocols.DEF[s.protocol] ? HF.protocols.DEF[s.protocol].label.split(' · ')[0] : 'Protocol')) : (HF.modes ? HF.modes.label(s.mode) : s.mode);
    var mins = sessionMinutes(s, blocks);
    var sum = h('summary', { 'class': 'hf-hist__sum' }, [
      h('span', { 'class': 'hf-hist__date' }, [K().fmtDate(s.startedAt, { weekday: true, time: true })]),
      h('span', { 'class': 'hf-hist__info' }, [modeLabel + ' · ' + blocks.length + (blocks.length === 1 ? ' block' : ' blocks') + ' · ' + K().fmtMinutes(mins)]),
      counted ? Cc.chip('Counted', { tone: 'good', icon: 'check', cls: 'hf-hist__counted' }) : (s.endedAt ? Cc.chip('Extra', { tone: 'outline', cls: 'hf-hist__counted' }) : Cc.chip('Open', { tone: 'outline', cls: 'hf-hist__counted' })),
      Cc.icon('chev-down', { cls: 'hf-trk__chev' })
    ]);
    var body = blocks.length ? h('ol', { 'class': 'hf-hist__blocks' }, blocks.map(function (b, i) { return blockRow(b, i + 1); }))
      : h('p', { 'class': 'hf-small hf-muted' }, ['No blocks were played in this session.']);
    var det = h('details', { 'class': 'hf-hist__session', open: !!open, 'data-session': s.id }, [sum, h('div', { 'class': 'hf-hist__body' }, [body])]);
    det.addEventListener('toggle', function () { if (det.open) H.openSession = s.id; });
    return det;
  }

  function drawHistory(focusId) {
    var rootEl = H.root;
    if (!rootEl) return;
    var y = root.scrollY || 0;
    clear(rootEl);
    var Cc = c(), r = K().records() || {}, d = K().derived();
    var pg = K().page({ title: 'History', lead: 'Every session and block on this device. Trial-by-trial details are kept for the newest 60 sessions.', cls: 'hf-history' });
    pg.head.appendChild(h('div', { 'class': 'hf-actions' }, [Cc.button('Back to Progress', { variant: 'quiet', icon: 'chev-left', go: 'progress' })]));
    var played = {};
    (r.blocks || []).forEach(function (b) { if (isTraining(b)) played[b.trackId] = 1; });
    var verOpts = [{ value: 'all', label: 'All versions' }].concat(CAT().ids().filter(function (id) { return played[id]; }).map(function (id) { return { value: id, label: K().trackName(id) }; }));
    if (H.version !== 'all' && !played[H.version]) H.version = 'all';
    var filters = h('div', { 'class': 'hf-hist__filters' }, [
      Cc.select({ label: 'Version', id: 'hf-hist-version', options: verOpts, value: H.version, onChange: function (v) { H.version = v; H.shown = 15; drawHistory('hf-hist-version'); } }),
      Cc.select({ label: 'Blocks', id: 'hf-hist-kind', options: KINDS, value: H.kind, onChange: function (v) { H.kind = v; H.shown = 15; drawHistory('hf-hist-kind'); } }),
      Cc.select({ label: 'Period', id: 'hf-hist-period', options: PERIODS, value: H.period, onChange: function (v) { H.period = v; H.shown = 15; drawHistory('hf-hist-period'); } })
    ]);
    pg.node.appendChild(filters);

    var from = H.period === 'all' ? -Infinity : Date.now() - Number(H.period) * DAY;
    var blocksBy = {};
    (r.blocks || []).forEach(function (b) { if (isTraining(b)) (blocksBy[b.sessionId] || (blocksBy[b.sessionId] = [])).push(b); });
    var filtering = H.version !== 'all' || H.kind !== 'all';
    var rows = (r.sessions || []).filter(function (s) { return s && isNum(s.startedAt) && s.startedAt >= from; })
      .sort(function (a, b) { return b.startedAt - a.startedAt; })
      .map(function (s) {
        var bl = (blocksBy[s.id] || []).slice().sort(byT).filter(function (b) {
          return (H.version === 'all' || b.trackId === H.version) && kindMatch(b, H.kind);
        });
        return { s: s, blocks: bl };
      })
      .filter(function (x) { return !filtering || x.blocks.length; });
    var nBlocks = rows.reduce(function (a, x) { return a + x.blocks.length; }, 0);
    pg.node.appendChild(h('p', { 'class': 'hf-small hf-soft hf-hist__count', role: 'status' }, [
      rows.length + (rows.length === 1 ? ' session' : ' sessions') + ', ' + nBlocks + (nBlocks === 1 ? ' block' : ' blocks')
    ]));
    if (!rows.length) {
      pg.node.appendChild(Cc.empty({ title: (r.sessions || []).length ? 'Nothing matches these filters' : 'No sessions yet',
        text: (r.sessions || []).length ? 'Try a longer period or all versions.' : 'Your sessions and blocks will be listed here.', art: 'chart' }));
    } else {
      var list = h('div', { 'class': 'hf-hist__list' });
      rows.slice(0, H.shown).forEach(function (x, i) {
        list.appendChild(sessionItem(x.s, x.blocks, d, i, H.openSession ? H.openSession === x.s.id : i === 0));
      });
      pg.node.appendChild(list);
      if (rows.length > H.shown) {
        pg.node.appendChild(h('div', { 'class': 'hf-actions' }, [Cc.button('Show ' + Math.min(15, rows.length - H.shown) + ' more sessions', {
          variant: 'secondary', id: 'hf-hist-more', onClick: function () { H.shown += 15; drawHistory('hf-hist-more'); } })]));
      }
    }
    pg.node.appendChild(h('p', { 'class': 'hf-small hf-muted' }, ['Lab visits are listed in the Lab. Export everything as CSV from the Backup part of Progress.']));
    rootEl.appendChild(pg.node);
    try { root.scrollTo(0, y); } catch (e) { /* ignore */ }
    if (focusId) {
      var f = doc.getElementById(focusId);
      if (!f && focusId === 'hf-hist-more') f = rootEl.querySelector('.hf-hist__session:last-of-type summary');
      if (f) try { f.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
    }
  }

  // ---------- trial details ----------
  var CELL = ['top left', 'top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left'];
  var OUTCOME = { hit: 'Match caught', miss: 'Match not pressed', fa: 'Pressed, no match', 'lure-fa': 'Pressed on a lure', cr: 'Left alone, correctly' };

  function itemText(it) {
    if (it === null || it === undefined) return '';
    if (typeof it !== 'object') return String(it);
    if (isNum(it.cell)) return CELL[it.cell] || 'cell ' + it.cell;
    if (it.text !== undefined) return String(it.text);
    if (it.expr !== undefined) return String(it.expr);
    if (it.number !== undefined) return String(it.number);
    if (it.shape !== undefined) return String(it.shape);
    if (it.glyph !== undefined) return 'symbol ' + ((it.index || 0) + 1);
    if (isNum(it.tone)) return 'tone ' + (it.tone + 1);
    if (it.letter !== undefined) return 'spoken ' + it.letter;
    if (it.clip !== undefined) return 'spoken ' + it.clip;
    if (it.changed) return 'cells changed: ' + it.changed.length;
    var keys = Object.keys(it).slice(0, 3);
    return keys.map(function (k) { var v = it[k]; return k + ' ' + (typeof v === 'object' ? '…' : v); }).join(', ');
  }
  function stimText(trial) {
    var st = trial && trial.stim;
    if (!st) return '';
    if (st.main !== undefined) return itemText(st.main) + (trial.cue ? ' (' + (trial.cue === 'where' ? 'where' : 'what') + ')' : '');
    if (st.pos !== undefined || st.snd !== undefined) return itemText(st.pos) + ' + ' + itemText(st.snd);
    return itemText(st);
  }

  function trialTable(b, log) {
    var task = CAT().get(b.trackId) ? CAT().get(b.trackId).task : null;
    var T = HF.tasks && HF.tasks[task];
    var spec = null, res = null, why = {}, note = null;
    if (T && T.gen) {
      try {
        spec = T.gen({ trackId: b.trackId, rung: b.rung, params: b.rungParams || CAT().params(b.trackId, b.rung), set: b.set, seed: b.seed,
          lureCount: b.lureCount, lureMode: b.lureMode, protocol: b.protocol || null });
        res = T.score ? T.score(spec, log) : null;
      } catch (e) { spec = null; note = 'The block could not be rebuilt here, so only your answers are listed.'; }
    }
    if (res && res.why) res.why.forEach(function (w) { (why[w.i] || (why[w.i] = [])).push(w); });
    var rows = [], cols;
    var voided = {};
    (log.voided || []).forEach(function (i) { voided[i] = 1; });
    if ((spec && spec.kind === 'stream') || (!spec && log.kind === 'stream')) {
      var resp = {};
      (log.responses || []).forEach(function (x) { (resp[x.trial] || (resp[x.trial] = [])).push(x); });
      var trials = spec ? spec.trials : (log.onsets || []).map(function (o, i) { return { i: i }; });
      cols = [{ key: 'n', label: '#', num: true }, { key: 'item', label: 'Item' }, { key: 'target', label: 'Match?' },
        { key: 'resp', label: 'Your press' }, { key: 'out', label: 'Result' }];
      trials.forEach(function (tr, k) {
        var i = isNum(tr.i) ? tr.i : k;
        var tg = tr.target ? Object.keys(tr.target).filter(function (s) { return tr.target[s]; }) : [];
        var two = spec && spec.streams && spec.streams.length > 1;
        var pr = (resp[i] || []).map(function (x) {
          return (x.key === 'match2' ? 'sound' : two ? 'position' : 'pressed') + (isNum(x.rt) ? ' ' + Math.round(x.rt) + ' ms' : '');
        }).join(', ');
        var ws = (why[i] || []).map(function (w) { return (two && w.stream ? (w.stream === 'snd' ? 'Sound: ' : 'Position: ') : '') + (OUTCOME[w.outcome] || w.outcome); });
        rows.push({
          n: i + 1, item: stimText(tr), target: tr.scorable === false ? 'lead-in' : tg.length ? (two ? tg.map(function (s) { return s === 'snd' ? 'sound' : 'position'; }).join(' + ') : 'yes') : (tr.lure && Object.keys(tr.lure).some(function (s) { return tr.lure[s]; }) ? 'lure' : 'no'),
          resp: pr || '–', out: voided[i] ? 'Not counted (timing)' : ws.join('; ') || (tr.scorable === false ? '' : '–')
        });
      });
    } else if ((spec && spec.kind === 'discrete') || log.kind === 'discrete' || log.answers) {
      cols = [{ key: 'n', label: '#', num: true }, { key: 'answer', label: 'Right answer' }, { key: 'resp', label: 'Your answer' },
        { key: 'rt', label: 'Time', num: true }, { key: 'out', label: 'Result' }];
      (log.answers || []).forEach(function (a, k) {
        var tr = spec && spec.trials ? spec.trials[a.i] : null;
        var right = tr ? tr.answer : null;
        var word = function (x) { return x === 'match' ? 'yes' : x === 'no' ? 'no' : x ? String(x) : 'no answer'; };
        rows.push({ n: (isNum(a.i) ? a.i : k) + 1, answer: right ? word(right) : '–', resp: word(a.response), rt: isNum(a.rt) ? Math.round(a.rt) + ' ms' : '–',
          out: a.voided ? 'Not counted (timing)' : right ? (a.response === right ? 'Correct' : a.response ? 'Not correct' : 'Too slow') : '–' });
      });
    } else if (log.trials) {
      cols = [{ key: 'n', label: 'List', num: true }, { key: 'items', label: 'Items' }, { key: 'recall', label: 'You recalled' }, { key: 'judge', label: 'Judgements right' }];
      log.trials.forEach(function (t, k) {
        var tr = spec && spec.trials ? spec.trials[t.i] : null;
        var items = tr && tr.pairs ? tr.pairs.map(function (p) { return p.mem; }) : [];
        if (tr && tr.order === 'backward') items = items.slice().reverse();
        var judged = (t.proc || []).filter(function (p, j) { return tr && tr.pairs && tr.pairs[j] && p.resp === tr.pairs[j].proc.correct; }).length;
        rows.push({ n: (isNum(t.i) ? t.i : k) + 1, items: items.join(' ') || '–', recall: (t.recall || []).join(' ') || '–',
          judge: tr ? judged + ' of ' + (tr.pairs || []).length : '–' });
      });
    } else {
      return { node: h('p', { 'class': 'hf-small' }, ['This block’s log has no trial rows.']) };
    }
    var kids = [];
    if (note) kids.push(h('p', { 'class': 'hf-small hf-soft' }, [note]));
    if (res && res.plain && isNum(res.plain.targets)) {
      kids.push(h('p', { 'class': 'hf-small' }, ['Caught ' + res.plain.caught + ' of ' + res.plain.targets + ' matches; ' + res.plain.falsePresses + (res.plain.falsePresses === 1 ? ' press' : ' presses') + ' with no match.']));
    }
    kids.push(c().table({ columns: cols, rows: rows, label: 'Trials of this block', rowHeaders: false, cls: 'hf-trials' }));
    return { node: h('div', { 'class': 'hf-stack hf-stack--sm' }, kids) };
  }

  function openTrials(b, n) {
    if (!HF.dom || !HF.dom.modal) return null;
    var content;
    var docT = null;
    try { docT = HF.store.loadTrials(b.sessionId); } catch (e) { docT = null; }
    var log = docT && docT.blocks ? docT.blocks[b.id] : null;
    // fullLabel names the version once ("Relation Grid · Same · step 4 of 9"); name + levelLabel repeated the tier (PQ-14)
    var head = h('p', { 'class': 'hf-small hf-soft' }, [K().fmtDate(b.t, { weekday: true, time: true }) + ' · ' + CAT().fullLabel(b.trackId, b.rung) +
      (b.result && isNum(b.result.ba) ? ' · score ' + K().pct(b.result.ba) : '')]);
    if (!log) {
      content = [head, c().notice({ tone: 'info', slim: true, title: 'No trial details for this block',
        text: 'Long-Horizon keeps trial-by-trial details for the newest 60 sessions (and blocks played in a preview that cannot save are not kept). The block’s totals are still in the history and the CSV export.' })];
    } else {
      var tt;
      try { tt = trialTable(b, log); } catch (e2) { tt = { node: h('p', { 'class': 'hf-small' }, ['The trial details could not be shown.']) }; if (root.console) console.error(e2); }
      content = [head, tt.node];
    }
    return HF.dom.modal(function (body, hd) {
      content.forEach(function (x) { body.appendChild(x); });
      body.appendChild(h('div', { 'class': 'hf-modal__actions' }, [c().button('Close', { variant: 'secondary', onClick: function () { hd.close(true); } })]));
    }, { title: 'Block ' + n + ': trial by trial', className: 'hf-modal--trials' });
  }

  function cleanupH() {
    H.off.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    H.off = [];
  }

  var historyScreen = {
    title: 'History',
    render: function (rootEl, params) {
      cleanupH();
      H.root = rootEl;
      params = params || {};
      if (params.trackId) { H.version = params.trackId; H.shown = 15; }
      if (params.sessionId) { H.openSession = params.sessionId; H.period = 'all'; }
      drawHistory(null);
      H.off.push(K().watch(function () { drawHistory(null); }));
    },
    leave: function () { cleanupH(); H.root = null; }
  };

  ui.screens = ui.screens || {};
  ui.screens.progress = progressScreen;
  ui.screens.history = historyScreen;
  ui.progress = {
    screen: progressScreen, history: historyScreen, orderedSessions: orderedSessions, trackSeries: trackSeries,
    learningCurves: learningCurves, minutesPerWeek: minutesPerWeek, levelScale: levelScale, openTrials: openTrials, trialTable: trialTable
  };
  if (HF.router && HF.router.register) {
    HF.router.register('progress', progressScreen);
    HF.router.register('history', historyScreen);
  }
})(typeof window !== 'undefined' ? window : globalThis);
