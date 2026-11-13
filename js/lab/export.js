/* Long-Horizon — study export bundle (pure, no DOM). MIT licence. research/04 §18.

   HF.lab.exportBundle(records, opts?) → { json, csv: { visits, trials, blocks, sessions }, filename }
     opts = { labLogs?: { [visitId]: { [labTestId]: { log, spec? } } }   Lab trial logs saved by the Lab UI
              (spec optional: without it the spec is regenerated from the result's form + seed, HF.lab.tests[id].gen),
              now?, appVersion?, revealSalt?: bool (default: true once a POST visit exists),
              includeUA?: bool, userAgent?, screen?: { w, h, dpr }, ageBand?, handedness?, audio? }
   json = {
     meta: { exportSchema: 1, kind: 'long-horizon-study-export', appVersion, exportedAt (ISO), tzOffsetMin, anonId, ageBand,
             handedness, device (latest visit), screen, userAgent (only with includeUA), audio,
             blueprints: { [labTestId]: version }, blueprint: 'v1', formSeedHash (SHA-256 of the form-seed table) },
     study: null | { template, arm, armLabel, mode: 'solo'|'community'|null, method, enrolledAt, drawAt, commitment,
                     salt (null until revealed), saltRevealed, verified, codeHash (SHA-256 of the normalised code), codeOk,
                     codePostedAt (ISO: when the participant confirmed posting or noting the commitment code, or null),
                     leftAt (ISO: when the participant left the study — a 'study-leave' event — or null) },
     visits: [ { id, kind, config, form, startedAt, endedAt, date, localTime, hour, device, checkin, closeout,
                 flags (own + schedule flags), tests: { [id]: { score, scoreLabel, sub, flags, form, seed, version, frame? } } } ],
     labTrials: [ { visit_id, kind, test, …test-specific columns (HF.lab.tests[id].rows) } ],
     scores: { compare: HF.lab.compare(records), composites: HF.lab.composites(records), levels: HF.lab.levels(records),
               calibration: { version, source, tests used } | null (also null for a removal tombstone { removed: true }) },
     training: { sessions: [...], blocks: [...], setsUsed: [setId…], labSetsTrained: bool, counted, adherence },
     questionnaires: { expectations: [...], blinding: [...], notes: [...] },
     notes: [ 'trials missing for …' ] }
   csv.visits   one row per visit × test (check-in and close-out answers flattened as checkin_* / closeout_*);
   csv.trials   one row per Lab trial or item; csv.blocks one row per training block; csv.sessions one row per session.
   CSV: RFC 4180 quoting, header row, booleans true/false, objects as JSON; text cells starting with = + - @ tab or CR get
   a leading ' (spreadsheet formula guard; CB-08: a '-' only when the text is not a plain number such as "-3", so negative
   numbers stay numbers; number values are never guarded).
*/
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var lab = HF.lab || (HF.lab = {});
  var LAB_SETS = ['glyphsLab', 'lab'];
  // tools/analysis also reads the 1.0.0 id 'holdfast-study-export' (working name Holdfast; same layout)
  var EXPORT_KIND = 'long-horizon-study-export';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function iso(ms) { return isNum(ms) ? new Date(ms).toISOString() : null; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(ms) { if (!isNum(ms)) return null; var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(ms) { if (!isNum(ms)) return null; var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  var NEG_NUMBER = /^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function cell(v) {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+@\t\r]/.test(s) || (s.charAt(0) === '-' && !NEG_NUMBER.test(s))) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows, first) {
    var cols = (first || []).slice();
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    var lines = [cols.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (k) { return cell(r[k]); }).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  function flatten(prefix, obj, into) {
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      into[prefix + k] = Array.isArray(v) ? v.join(';') : v;
    });
    return into;
  }

  function genericRows(spec, log) {
    var out = [];
    function discrete(trials, L, block) {
      var ans = {};
      ((L && L.answers) || []).forEach(function (a) { if (a && a.i != null && !ans[a.i]) ans[a.i] = a; });
      trials.forEach(function (t) {
        var a = ans[t.i] || {};
        out.push({ block: block, trial: t.i, correct_answer: t.answer != null ? t.answer : null,
          response: a.response == null ? null : a.response, rt: isNum(a.rt) ? Math.round(a.rt) : null,
          correct: t.answer != null && a.response != null ? String(a.response) === String(t.answer) : null, voided: !!a.voided });
      });
    }
    if (spec && Array.isArray(spec.blocks)) spec.blocks.forEach(function (b, k) { if (Array.isArray(b.trials)) discrete(b.trials, log && log.blocks && log.blocks[k], k + 1); });
    else if (spec && Array.isArray(spec.trials)) discrete(spec.trials, log, 1);
    return out;
  }

  function formSeedTable() {
    var lab = HF.lab;
    var ids = Object.keys(lab.tests || {}).sort(), table = {};
    ids.forEach(function (id) { table[id] = lab.FORMS.map(function (f) { return lab.formSeed(id, f); }); });
    return table;
  }

  function exportBundle(records, opts) {
    var lab = HF.lab; // resolved at call time
    records = records || {};
    opts = opts || {};
    var now = isNum(opts.now) ? opts.now : Date.now();
    var profile = records.profile || {};
    var sha = HF.study && HF.study.sha256;
    var notes = [];

    var sched = typeof lab.schedule === 'function' ? lab.schedule(records, null, now) : null;
    var flagsById = {};
    if (sched) sched.visits.forEach(function (v) { flagsById[v.id] = v.flags; });

    var raw = (records.labVisits || []).filter(function (v) { return v && isNum(v.startedAt); })
      .slice().sort(function (a, b) { return a.startedAt - b.startedAt; });
    var latestVisit = raw.length ? raw[raw.length - 1] : null;
    var hasPost = raw.some(function (v) { return v.kind === 'POST'; });

    // meta
    var blueprints = {};
    Object.keys(lab.tests || {}).sort().forEach(function (id) { blueprints[id] = lab.tests[id].version || 1; });
    var meta = {
      exportSchema: 1, kind: EXPORT_KIND, appVersion: opts.appVersion || records.appVersion || null,
      exportedAt: iso(now), tzOffsetMin: -new Date(now).getTimezoneOffset(), anonId: profile.anonId || null,
      ageBand: opts.ageBand || null, handedness: opts.handedness || null,
      device: latestVisit && latestVisit.device ? latestVisit.device : null, screen: opts.screen || null,
      userAgent: opts.includeUA ? (opts.userAgent || null) : null, audio: opts.audio == null ? null : opts.audio,
      blueprint: lab.BLUEPRINT || 'v1', blueprints: blueprints,
      formSeedHash: sha ? sha(JSON.stringify(formSeedTable())) : null
    };

    // study
    var st = HF.study && typeof HF.study.state === 'function' ? HF.study.state(records) : null;
    var study = null;
    if (st) {
      var reveal = opts.revealSalt != null ? !!opts.revealSalt : hasPost;
      study = {
        template: st.template, arm: st.arm, armLabel: st.armLabel,
        mode: st.method === 'code' ? 'community' : (st.method === 'draw' ? 'solo' : null), method: st.method,
        enrolledAt: iso(st.enrolledAt), drawAt: st.draw ? iso(st.draw.t) : null,
        commitment: st.draw ? st.draw.commitment : null, salt: st.draw && reveal ? st.draw.salt : null,
        saltRevealed: !!(st.draw && reveal), verified: st.verified,
        codeHash: st.code && sha ? sha(String(st.code.code || '').toUpperCase().replace(/[\s-]/g, '')) : null, codeOk: st.codeOk,
        codePostedAt: iso(st.postedAt), leftAt: iso(st.left)
      };
    }

    // visits + trials
    var labLogs = opts.labLogs || {};
    var visits = [], trialRows = [], visitRows = [];
    raw.forEach(function (v) {
      var tests = {};
      Object.keys(v.tests || {}).forEach(function (id) {
        var r = v.tests[id] || {};
        tests[id] = { score: r.score == null ? null : r.score, scoreLabel: r.scoreLabel || null, sub: r.sub || {}, flags: r.flags || [],
          form: r.form || v.form || null, seed: r.seed || null, version: r.version || 1 };
        if (r.frame) tests[id].frame = r.frame;
      });
      var flags = flagsById[v.id] || (v.flags || []);
      visits.push({ id: v.id, kind: v.kind, config: v.config || null, form: v.form || null, startedAt: iso(v.startedAt),
        endedAt: iso(v.endedAt), date: localDate(v.startedAt), localTime: localTime(v.startedAt),
        hour: isNum(v.hour) ? v.hour : null, device: v.device || null, checkin: v.checkin || {}, closeout: v.closeout || {},
        flags: flags, tests: tests });

      var base = { visit_id: v.id, kind: v.kind, config: v.config || null, form: v.form || null, started_at: iso(v.startedAt),
        local_date: localDate(v.startedAt), local_time: localTime(v.startedAt),
        device_class: v.device ? v.device['class'] : null, device_input: v.device ? v.device.input : null,
        visit_flags: flags.join(';') };
      var ids = Object.keys(tests);
      if (!ids.length) visitRows.push(flatten('closeout_', v.closeout, flatten('checkin_', v.checkin, Object.assign({}, base, { test: null }))));
      ids.forEach(function (id) {
        var t = tests[id];
        var row = Object.assign({}, base, { test: id, score: t.score, score_label: t.scoreLabel, test_flags: t.flags.join(';'),
          test_form: t.form, seed: t.seed, version: t.version });
        visitRows.push(flatten('closeout_', v.closeout, flatten('checkin_', v.checkin, row)));

        var entry = labLogs[v.id] && labLogs[v.id][id];
        if (!entry || !entry.log) { notes.push('no trial log for ' + v.kind + ' ' + id); return; }
        var def = lab.tests && lab.tests[id], spec = entry.spec || null;
        if (!spec && def) {
          try { spec = def.gen({ form: t.form || 'A', seed: t.seed || undefined }); }
          catch (e) { notes.push('could not regenerate ' + id + ' for ' + v.kind + ': ' + (e && e.message)); return; }
        }
        if (!spec) { notes.push('no spec for ' + id); return; }
        var rows;
        try { rows = def && def.rows ? def.rows(spec, entry.log) : genericRows(spec, entry.log); }
        catch (e2) { notes.push('rows failed for ' + id + ': ' + (e2 && e2.message)); return; }
        rows.forEach(function (r) { trialRows.push(Object.assign({ visit_id: v.id, kind: v.kind, test: id }, r)); });
      });
    });

    // scores
    var cal = records.calibration && !records.calibration.removed ? records.calibration : null, used = null;   // CB-07 tombstone = none
    if (cal && cal.tests) {
      used = {};
      Object.keys(cal.tests).forEach(function (id) { var c = cal.tests[id]; used[id] = { r: c.r, sd: c.sd, mean: c.mean, n: c.n, practice: c.practice == null ? null : c.practice }; });
    }
    var scores = {
      compare: typeof lab.compare === 'function' ? lab.compare(records) : null,
      composites: typeof lab.composites === 'function' ? lab.composites(records) : null,
      levels: typeof lab.levels === 'function' ? lab.levels(records) : null,
      calibration: cal ? { version: cal.version || null, source: cal.source || null, updatedAt: iso(cal.updatedAt), tests: used } : null
    };

    // training
    var sessions = (records.sessions || []).slice().sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
    var blocks = (records.blocks || []).slice().sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    var sessionRows = sessions.map(function (s) {
      return { id: s.id, started_at: iso(s.startedAt), ended_at: iso(s.endedAt), day: s.dayKey || localDate(s.startedAt),
        mode: s.mode || null, protocol: s.protocol || null, study_template: s.study ? s.study.template : null,
        study_arm: s.study ? s.study.arm : null, planned: s.planned, completed: s.completed, counted: !!s.counted,
        minutes: s.minutes, ended_by: s.endedBy || null };
    });
    var setsUsed = [];
    var blockRows = blocks.map(function (b) {
      var r = b.result || {};
      if (b.set && setsUsed.indexOf(b.set) < 0) setsUsed.push(b.set);
      return { id: b.id, session_id: b.sessionId, t: iso(b.t), track: b.trackId, set: b.set || null, role: b.role || null,
        mode: b.mode || null, protocol: b.protocol || null, unit: b.unitId || null, seed: b.seed || null, rung: b.rung,
        level_before: b.levelBefore, level_after: b.levelAfter, moved: b.moved, reason: b.reason || null,
        ba: r.ba, ba_mean: r.baMean, y: r.y, dprime: r.dprime, crit: r.crit, interrupted: !!b.interrupted,
        voided_ratio: b.voidedRatio, fps: b.frame ? b.frame.fps : null, stalls: b.frame ? b.frame.stalls : null };
    });
    var counted = sessions.filter(function (s) { return s.counted; }).length;
    var training = {
      sessions: sessionRows, blocks: blockRows, setsUsed: setsUsed.sort(),
      labSetsTrained: setsUsed.some(function (s) { return LAB_SETS.indexOf(s) >= 0; }),
      counted: counted,
      adherence: { counted: counted, programme: sched ? sched.programme.sessions : null,
        proportion: sched && sched.programme.sessions ? Math.min(1, counted / sched.programme.sessions) : null }
    };

    // questionnaires
    var ev = records.events || [];
    var questionnaires = {
      expectations: ev.filter(function (e) { return e && e.type === 'study-expect'; }).map(function (e) { return { t: iso(e.t), when: e.when, values: e.values }; }),
      blinding: ev.filter(function (e) { return e && e.type === 'study-blind'; }).map(function (e) { return { t: iso(e.t), guess: e.guess }; }),
      notes: ev.filter(function (e) { return e && e.type === 'note'; }).map(function (e) { return { t: iso(e.t), text: e.text }; })
    };

    var json = { meta: meta, study: study, visits: visits, labTrials: trialRows, scores: scores, training: training,
      questionnaires: questionnaires, notes: notes };
    var csv = {
      visits: toCsv(visitRows, ['visit_id', 'kind', 'config', 'form', 'started_at', 'local_date', 'local_time', 'device_class', 'device_input', 'visit_flags', 'test', 'score', 'score_label', 'test_flags']),
      trials: toCsv(trialRows, ['visit_id', 'kind', 'test']),
      blocks: toCsv(blockRows, ['id', 'session_id', 't', 'track', 'set', 'role']),
      sessions: toCsv(sessionRows, ['id', 'started_at', 'ended_at', 'day'])
    };
    var filename = 'long-horizon-study-' + String(profile.anonId || 'anon').replace(/[^A-Za-z0-9_-]/g, '') + '-' + (localDate(now) || 'date') + '.json';
    return { json: json, csv: csv, filename: filename };
  }

  lab.exportBundle = exportBundle;
  lab.EXPORT_KIND = EXPORT_KIND;
  lab.toCsv = toCsv;
  if (typeof module === 'object' && module.exports) module.exports = exportBundle;
})(typeof window !== 'undefined' ? window : globalThis);
