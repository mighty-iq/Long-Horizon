// Long-Horizon — simulated learners per mode (node). Usage:
//   node tests/sim/run.mjs <scenario> [--n 300] [--days 60] [--json out.json] [--seed s]
// Scenarios: varied | sprint | stretch | mastery | free | cao | wang | jaeggi | study-default | study-cao | study-wang | all
// Prints PASS/FAIL per check and a summary; exit code 1 if a check fails.
import fs from 'node:fs';
import { loadEngine, runLearner, population, settledBlocks, mean, sd, quant, fmt, DAY, HOUR } from './lib.mjs';

const HF = loadEngine();
const args = process.argv.slice(2);
const scenario = args[0] || 'varied';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const N = +opt('n', 300), DAYS = +opt('days', 60), SEED = opt('seed', 'sim1'), JSON_OUT = opt('json', null);
population('pop-' + SEED);

const C = HF.catalog, G = HF.goals;
const TARGET = { varied: 0.80, sprint: 0.85, stretch: 0.72, mastery: 0.80, free: 0.80 };

function runMany(modeId, extra = {}) {
  const res = [];
  for (let i = 0; i < N; i++) {
    const per = typeof extra === 'function' ? extra(i) : extra;
    res.push(runLearner(HF, { id: `${SEED}-${modeId}-${i}`, modeId, days: DAYS, ...per }));
  }
  return res;
}

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

// ---------- generic checks ----------
function deadEnds(results) {
  const kinds = {};
  for (const r of results) for (const x of r.issues) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  check('no dead ends, throws or invalid block plans', Object.keys(kinds).length === 0, JSON.stringify(kinds));
  // every learner who trained got blocks on every day they started a session
  let sessions = 0, empty = 0;
  for (const r of results) for (const p of r.plans) { sessions++; if (!p.slots) empty++; }
  return { sessions, empty, kinds };
}

function settle(results, modeId, filter, label) {
  const tgt = TARGET[modeId];
  const all = [], byTask = {}, perLearner = [], byTrack = {}, st = {};
  for (const r of results) {
    const bl = settledBlocks(HF, r.records, b => b.mode === modeId && (b.role === 'rated' || b.role === 'free') && (!filter || filter(b)), st);
    const bas = bl.map(b => b.result.ba);
    if (bas.length >= 5) perLearner.push(mean(bas));
    for (const b of bl) {
      all.push(b.result.ba);
      const t = C.get(b.trackId).task; (byTask[t] = byTask[t] || []).push(b.result.ba);
      (byTrack[b.trackId] = byTrack[b.trackId] || []).push(b.result.ba);
    }
  }
  const m = mean(all);
  const tasks = Object.fromEntries(Object.entries(byTask).map(([k, v]) => [k, +fmt(mean(v))]));
  const tracks = Object.fromEntries(Object.entries(byTrack).filter(([, v]) => v.length >= 100).map(([k, v]) => [k, +fmt(mean(v))]));
  const okTasks = Object.values(byTask).every(v => v.length < 200 || Math.abs(mean(v) - tgt) <= 0.03);
  check(`${label || modeId}: settled BA within ±.03 of target ${tgt}`, Math.abs(m - tgt) <= 0.03 && okTasks,
    `mean ${fmt(m)} (n=${all.length} blocks, ${st.ceiling || 0} after a ladder top left out; per learner median ${fmt(quant(perLearner, 0.5))}, IQR ${fmt(quant(perLearner, 0.25))}–${fmt(quant(perLearner, 0.75))}); by task ${JSON.stringify(tasks)}`);
  return { mean: m, n: all.length, ceilingExcluded: st.ceiling || 0, byTask: tasks, byTrack: tracks, perLearnerMedian: quant(perLearner, 0.5) };
}

function caps(results) {
  let bad = [], counted = 0, sessions = 0, extra = 0;
  for (const r of results) {
    const d = HF.engine.derive(r.records, r.records.updatedAt || Date.now());
    const list = d.countedList;
    counted += list.length; sessions += r.records.sessions.length;
    const byDay = {}, byWeek = {};
    for (const s of r.records.sessions) if (s.counted !== !!d.counted[s.id]) bad.push('stored counted flag differs ' + s.id);
    for (let i = 0; i < list.length; i++) {
      const c = list[i], m = HF.modes.get(c.mode);
      byDay[c.dayKey] = (byDay[c.dayKey] || 0) + 1; byWeek[c.weekKey] = (byWeek[c.weekKey] || 0) + 1;
      if (byDay[c.dayKey] > m.perDay) bad.push(`day ${c.dayKey}: ${byDay[c.dayKey]} counted (${c.mode})`);
      if (i > 0 && m.minGapH && c.t - list[i - 1].t < m.minGapH * HOUR) bad.push(`gap ${((c.t - list[i - 1].t) / HOUR).toFixed(1)} h (${c.mode})`);
      if (m.weeklyCap != null && byWeek[c.weekKey] > m.weeklyCap) bad.push(`week ${c.weekKey}: ${byWeek[c.weekKey]} (${c.mode})`);
      if (byWeek[c.weekKey] > 14) bad.push('week > 14');
    }
    extra += r.records.sessions.filter(s => s.endedAt && !s.counted).length;
  }
  check('counting rules and weekly caps respected', bad.length === 0, `${counted} counted of ${sessions} sessions (${extra} not counted)${bad.length ? '; e.g. ' + bad.slice(0, 3).join('; ') : ''}`);
  return { counted, sessions, notCounted: extra, violations: bad.length };
}

function introAndGates(results, modeId) {
  const bad = [];
  const order = HF.planner.INTRO;
  let firstSeen = {};
  for (const r of results) {
    const sessIdx = {}; for (const s of r.records.sessions) sessIdx[s.id] = s.sessionIndex;
    const first = {}, peak = {}, newPerSession = {};
    const lessons = {}; for (const e of r.records.events) if (e.type === 'lesson-passed') lessons[e.lessonId] = Math.min(lessons[e.lessonId] || Infinity, e.t);
    for (const b of r.records.blocks) {
      const tid = b.trackId;
      if (/lab/i.test(b.set || '')) bad.push('lab set used');
      if (C.get(tid).task === 'span') bad.push('span while off');
      if (tid === 'vs.search' && !b.study) bad.push('vs.search outside study');
      if (tid === 'rel.grid.T8') bad.push('T8 without opt-in');
      if (first[tid] == null) {
        first[tid] = b;
        if (!b.protocol) {
          const si = sessIdx[b.sessionId];
          const io = order.find(x => x.trackId === tid);
          if (io && (modeId === 'varied' || modeId === 'stretch') && si < io.s) bad.push(`${tid} first at session ${si} < S${io.s}`);
          // gates
          const tr = C.get(tid);
          if (tr.gate.kind === 'exec' && !((peak['nback.plain'] ?? -1) >= 2 || (lessons[tr.lessonId] ?? Infinity) < b.t)) bad.push(`${tid} before Plain 2-back (peak ${peak['nback.plain']})`);
          if (tr.gate.kind === 'tier' && !((peak[tr.gate.prev] ?? -1) >= tr.gate.at)) bad.push(`${tid} before ${tr.gate.prev} step 6`);
        }
        firstSeen[tid] = (firstSeen[tid] || 0) + 1;
      }
      if (HF.derive.levelMoving(b) && !HF.controller.blockBad(b)) peak[tid] = Math.max(peak[tid] ?? -1, b.levelAfter);
    }
    if (modeId === 'varied' || modeId === 'stretch') {
      for (const e of r.records.events) if (e.type === 'track-intro') { const io = order.find(x => x.trackId === e.trackId); if (io && io.s > 1 && !(e.trackId === 'nback.dual' && r.records.settings.dual)) newPerSession[e.t] = (newPerSession[e.t] || 0) + 1; }
    }
    for (const [sid, n] of Object.entries(newPerSession)) if (n > 1) bad.push(`${n} new versions (order list) in one session`);
    // order: among INTRO tracks introduced, a later one may precede an earlier one only if the earlier was gated at that time
    if (modeId === 'varied' || modeId === 'stretch') {
      const introAt = {}; for (const e of r.records.events) if (e.type === 'track-intro' && introAt[e.trackId] == null) introAt[e.trackId] = e.t;
      const when = id => introAt[id] != null ? introAt[id] : first[id].t;
      const seq = order.filter(x => first[x.trackId]).sort((a, b) => when(a.trackId) - when(b.trackId));
      for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) {
        const a = seq[i], bb = seq[j];
        if (order.indexOf(a) > order.indexOf(bb)) {
          // a was introduced before bb although bb comes first in the order: bb must have been gated or not yet scheduled then
          const tr = C.get(bb.trackId), tA = when(a.trackId);
          const plainPeakAtA = r.records.blocks.filter(x => x.t < tA && x.trackId === 'nback.plain' && HF.derive.levelMoving(x)).reduce((m, x) => Math.max(m, x.levelAfter), -1);
          const gated = (tr.gate.kind === 'exec' && plainPeakAtA < 2) || tr.gate.kind === 'tier' || (bb.trackId === 'nback.dual');
          if (!gated) bad.push(`${a.trackId} before ${bb.trackId}`);
        }
      }
    }
  }
  check('introduction order and gates hold', bad.length === 0, bad.length ? bad.slice(0, 5).join('; ') + ` (${bad.length})` : `first blocks per track: ${JSON.stringify(firstSeen)}`);
  return { violations: bad.length, firstSeen };
}

function soundCheck(results, label) {
  const off = results.filter(r => r.records.settings.sound === 'off');
  if (!off.length) return null;
  let bad = [], blocks = 0, noted = 0, reachedS8 = 0;
  for (const r of off) {
    for (const b of r.records.blocks) {
      blocks++;
      if (b.trackId === 'nback.dual') bad.push('Dual played');
      if (HF.catalog.contentFamily(b.set) === 'audio') bad.push('audio set ' + b.set);
    }
    if (r.records.events.some(e => e.type === 'track-intro' && e.trackId === 'nback.dual')) bad.push('Dual introduced');
    if (r.plans.some(p => p.sessionIndex >= 8 && (p.modeId === 'varied' || p.modeId === 'stretch'))) { reachedS8++; if (r.plans.some(p => p.notes.includes('sound-off'))) noted++; }
  }
  check(`${label}: sound off — no Dual, no audio sets, Dual not introduced, plans say so`, bad.length === 0 && noted === reachedS8,
    `${off.length} learners, ${blocks} blocks${bad.length ? '; ' + [...new Set(bad)].slice(0, 3).join('; ') + ` (${bad.length})` : ''}; 'sound-off' note for ${noted} of ${reachedS8} who reached session 8`);
  return { learners: off.length, blocks, violations: bad.length };
}

function assistCheck(results) {
  const withA = results.filter(r => r.records.events.some(e => e.type === 'assist-start'));
  if (!withA.length) return null;
  let bad = [], assisted = 0, faded = 0, tracks = 0;
  for (const r of withA) {
    const starts = {}; for (const e of r.records.events) if (e.type === 'assist-start' && starts[e.trackId] == null) starts[e.trackId] = e.t;
    for (const tid of Object.keys(starts)) {
      tracks++;
      const ab = r.records.blocks.filter(b => b.trackId === tid && b.t >= starts[tid] && b.role !== 'warmup' && b.role !== 'free');
      let ok = 0, fadedAt = null;
      for (const b of ab) {
        if (fadedAt == null) {
          if (b.role !== 'assist' && b.role !== 'check') bad.push(`${tid}: ${b.role} block before the aid faded`);
          if (b.role === 'assist') { assisted++; if (HF.derive.levelMoving(b) || b.moved) bad.push('assisted block moved a level'); const ms = b.result.streams.main; if (ms && !HF.controller.blockBad(b) && ms.h >= HF.derive.assistBar(b.trackId) && ms.fa <= 2) ok++; }
          if (ok >= 2) fadedAt = b.t;
        } else if (b.role === 'assist' && b.sessionId !== ab.find(x => x.t === fadedAt).sessionId) bad.push(`${tid}: assisted after fading`);
      }
      const ev = r.events.filter(e => e.type === 'assist-faded' && e.trackId === tid).length;
      if ((fadedAt != null) !== (ev === 1)) bad.push(`${tid}: faded ${fadedAt != null}, events ${ev}`);
      if (fadedAt != null) faded++;
    }
    for (const b of r.records.blocks) if (b.role === 'assist' && starts[b.trackId] == null) bad.push('assisted block on a track without a start');
  }
  check('assisted starts: per-track aid, never moves a level, fades after 2 blocks at criterion with one assist-faded {trackId}', bad.length === 0,
    `${withA.length} learners, ${tracks} assisted tracks, ${assisted} assisted blocks, ${faded} faded${bad.length ? '; ' + [...new Set(bad)].slice(0, 3).join('; ') + ` (${bad.length})` : ''}`);
  return { learners: withA.length, tracks, assisted, faded, violations: bad.length };
}

function modelQuality(results) {
  const errs = [], first = [];
  for (const r of results) {
    const seen = {};
    let m = HF.learner.create();
    for (const b of r.records.blocks) {
      if (!HF.learner.updatesModel(b)) continue;
      const u = HF.learner.update(m, b);
      errs.push(u.y - u.pred);
      if (!seen[b.trackId] && b.role !== 'warmup') { seen[b.trackId] = 1; if (Object.keys(seen).length > 1) first.push(Math.abs(u.y - u.pred)); }
    }
  }
  const rmse = Math.sqrt(mean(errs.map(e => e * e)));
  return { rmse, bias: mean(errs), firstBlockMAE: mean(first), n: errs.length };
}

function summary(results) {
  const levels = {}, blocks = [], counted = [];
  for (const r of results) {
    const d = HF.engine.derive(r.records, r.records.updatedAt || Date.now());
    blocks.push(r.records.blocks.length); counted.push(d.sessionsCounted);
    for (const [tid, t] of Object.entries(d.tracks)) if (t.ratedBlocks >= 6) (levels[tid] = levels[tid] || []).push(t.level);
  }
  const lv = Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, `${C.levelLabel(k, Math.round(quant(v, 0.5)))} (n=${v.length})`]));
  return { blocksMedian: quant(blocks, 0.5), countedMedian: quant(counted, 0.5), medianLevel: lv };
}

// ---------- protocol checks ----------
function caoCheck(results, arm = 'exec') {
  const bad = [];
  let sessions = 0, complete = 0, followups = 0;
  for (const r of results) {
    const pb = r.records.blocks.filter(b => b.protocol === 'cao');
    const bySess = [];
    for (const b of pb) { let s = bySess[bySess.length - 1]; if (!s || s.id !== b.sessionId) bySess.push(s = { id: b.sessionId, blocks: [], purpose: b.purpose }); s.blocks.push(b); }
    let prevEnd = null, prevDay = null, nFull = 0, s6start = null;
    for (const s of bySess) {
      const day = G.dayKey(s.blocks[0].t), startN = HF.protocols.nOfRung(s.blocks[0].rung);
      if (s.purpose === 'followup') {
        followups++;
        if (s6start == null) bad.push('follow-up before session 6');
        else if (startN !== s6start) bad.push(`follow-up starts at ${startN}, session 6 started at ${s6start}`);
        if (s.blocks.length > 10) bad.push('follow-up longer than 10 blocks');
        continue;
      }
      sessions++;
      const expect = prevEnd == null ? 1 : Math.max(1, prevEnd - 2);
      if (startN !== expect) bad.push(`session starts at ${startN}, expected ${expect}`);
      if (prevDay && !(day > prevDay)) bad.push('two Cao sessions on one day');
      if (s.blocks.length > 20) bad.push('more than 20 blocks');
      for (let i = 0; i < s.blocks.length; i++) {
        const b = s.blocks[i], c = HF.protocols.counts(b.result), n = HF.protocols.nOfRung(b.rung);
        const nNext = HF.protocols.nOfRung(b.levelAfter);
        let exp = n;
        if (!HF.controller.blockBad(b)) {
          const e20 = c.errors * 20 / c.n;
          if (20 - e20 > 18) exp = Math.min(HF.protocols.MAX_N, n + 1); else if (e20 >= 5) exp = Math.max(1, n - 1);
        }
        if (nNext !== exp) bad.push(`block rule: n ${n}, errors ${c.errors}/${c.n} → ${nNext}, expected ${exp}`);
        if (i > 0 && b.rung !== s.blocks[i - 1].levelAfter) bad.push('block does not start at the previous levelAfter');
        if (b.lureMode !== 'uncontrolled') bad.push('lures controlled');
        if (b.set !== 'days') bad.push('set not days');
        if ((b.rungParams || HF.catalog.params(b.trackId, b.rung)).soaMs !== 3000) bad.push('not standard pace');
      }
      if (s.blocks.length >= 10) { nFull++; if (nFull === 6) s6start = startN; }
      prevEnd = HF.protocols.nOfRung(s.blocks[s.blocks.length - 1].levelAfter); prevDay = day;
    }
    if (nFull >= 6) complete++;
  }
  check(`Cao (${arm}): sessions start at N − 2, rule per block, ≥ 1 day apart, follow-up at session 6's start`, bad.length === 0,
    `${sessions} sessions, ${complete}/${results.length} learners completed 6, ${followups} follow-ups${bad.length ? '; ' + bad.slice(0, 4).join('; ') + ` (${bad.length})` : ''}`);
  const levels = []; for (const r of results) { const d = HF.engine.derive(r.records, r.records.updatedAt || 0); const st = arm === 'trad' ? d.protocols.caoTrad : d.protocols.cao; st.sessions.filter(s => s.purpose === 'train').forEach((s, i) => { (levels[i] = levels[i] || []).push(s.meanN); }); }
  // SC-05: the n-back ceiling (MAX_N) must not hold learners back — at least 99 % never reach it
  const maxN = results.map(r => Math.max(1, ...r.records.blocks.filter(b => b.protocol === 'cao').map(b => Math.max(HF.protocols.nOfRung(b.rung), HF.protocols.nOfRung(b.levelAfter)))));
  const atCap = maxN.filter(n => n >= HF.protocols.MAX_N).length;
  check(`Cao (${arm}): ≥ 99 % of learners never reach the ${HF.protocols.MAX_N}-back ceiling`, atCap <= 0.01 * results.length,
    `${atCap}/${results.length} reached it; highest n per learner: median ${quant(maxN, 0.5)}, 90th ${quant(maxN, 0.9)}, 99th ${fmt(quant(maxN, 0.99), 1)}, max ${Math.max(...maxN)}; ${maxN.filter(n => n >= 9).length} reached 9-back (the old ceiling)`);
  return { sessions, complete, followups, meanNBySession: levels.slice(0, 8).map(v => +fmt(mean(v), 2)), violations: bad.length,
    maxN: { median: quant(maxN, 0.5), p90: quant(maxN, 0.9), p99: quant(maxN, 0.99), max: Math.max(...maxN), atCap, reached9: maxN.filter(n => n >= 9).length } };
}

function wangCheck(results) {
  const bad = [];
  let days = 0, moves = { up: 0, down: 0, stay: 0 }, below = 0, belowFloor = 0, belowStruggling = 0;
  for (const r of results) {
    const pb = r.records.blocks.filter(b => b.protocol === 'wang');
    const byDay = {}; const order = [];
    for (const b of pb) { const k = G.dayKey(b.t); if (!byDay[k]) { byDay[k] = []; order.push(k); } byDay[k].push(b); }
    let level = 0;
    for (const k of order) {
      const bl = byDay[k], valid = bl.filter(b => !HF.controller.blockBad(b));
      for (const b of bl) if (HF.protocols.nOfRung(b.rung) && Math.floor(b.rung / 2) !== level) bad.push(`day ${k}: block at L${b.rung / 2}, day level L${level}`);
      if (valid.length > 5) bad.push('more than 5 valid blocks in a day');
      if (valid.length >= 5) {
        days++;
        const acc = HF.protocols.dayAccuracy(valid.slice(0, 5));
        if (acc < 0.5) { below++; if (level === 0) belowFloor++; if (r.learner.struggleFrom != null) belowStruggling++; }
        const exp = acc > 0.8 ? Math.min(7, level + 1) : (acc < 0.5 ? Math.max(0, level - 1) : level);
        moves[exp > level ? 'up' : exp < level ? 'down' : 'stay']++;
        const got = Math.floor(valid[4].levelAfter / 2);
        if (got !== exp) bad.push(`day ${k}: acc ${fmt(acc)} L${level} → L${got}, expected L${exp}`);
        for (let i = 0; i < 4; i++) if (valid[i].levelAfter !== valid[i].rung) bad.push('level moved inside a day');
        level = exp;
      }
      for (const b of bl) if ((b.rungParams || HF.catalog.params(b.trackId, b.rung)).soaMs !== 3000) bad.push('not standard pace');
    }
  }
  check('Wang: level constant within a day, moves by the day\'s accuracy (> .80 up, < .50 down)', bad.length === 0,
    `${days} complete days, moves ${JSON.stringify(moves)}; days under .50: ${below} (${belowFloor} at L0, ${belowStruggling} during a two-week ability drop)${bad.length ? '; ' + bad.slice(0, 4).join('; ') + ` (${bad.length})` : ''}`);
  return { days, moves, below, belowFloor, belowStruggling, violations: bad.length };
}

function jaeggiCheck(results) {
  const bad = [];
  let sessions = 0;
  for (const r of results) {
    const pb = r.records.blocks.filter(b => b.protocol === 'jaeggi');
    let prevSess = null, prevAfter = null;
    for (const b of pb) {
      const n = HF.protocols.nOfRung(b.rung);
      if (b.sessionId !== prevSess) { sessions++; const exp = prevAfter == null ? 1 : HF.protocols.nOfRung(prevAfter); if (n !== exp) bad.push(`session starts at ${n}, expected ${exp}`); prevSess = b.sessionId; }
      else if (b.rung !== prevAfter) bad.push('block does not continue from previous levelAfter');
      const c = HF.protocols.counts(b.result); let exp = n;
      if (!HF.controller.blockBad(b)) {
        const es = Object.values(c.byStream).map(s => s.errors * 20 / s.n);
        if (es.every(e => e < 3)) exp = Math.min(HF.protocols.MAX_N, n + 1); else if (es.some(e => e > 5)) exp = Math.max(1, n - 1);
      }
      if (HF.protocols.nOfRung(b.levelAfter) !== exp) bad.push('rule mismatch');
      prevAfter = b.levelAfter;
    }
  }
  check('Jaeggi: errors per stream rule; sessions start at the last level', bad.length === 0, `${sessions} sessions${bad.length ? '; ' + bad.slice(0, 4).join('; ') : ''}`);
  return { sessions, violations: bad.length };
}

function valveCheck(results) {
  let fired = 0, shouldFire = 0, mismatch = 0, struggling = 0, firedStruggling = 0;
  for (const r of results) {
    const d = HF.engine.derive(r.records, r.records.updatedAt || 0);
    const ss = r.records.sessions.filter(s => s.mode === 'stretch').sort((a, b) => a.startedAt - b.startedAt);
    let run = 0, expectFire = false;
    for (const s of ss) {
      const bas = r.records.blocks.filter(b => b.sessionId === s.id && b.role === 'rated' && !HF.controller.blockBad(b)).map(b => b.result.ba);
      if (bas.length < 2) continue;
      run = mean(bas) < 0.62 ? run + 1 : 0;
      if (run >= 2) expectFire = true;
    }
    const got = d.stretch.valve.firedAt != null;
    const evFired = r.events.some(e => e.type === 'stretch-valve');
    if (got !== expectFire || evFired !== expectFire) mismatch++;
    if (expectFire) shouldFire++;
    if (got) fired++;
    if (r.learner.struggleFrom != null) { struggling++; if (got) firedStruggling++; }
  }
  check('Stretch safety valve fires exactly when two Stretch sessions in a row average < .62', mismatch === 0 && fired > 0,
    `fired for ${fired} learners (${firedStruggling} of ${struggling} with a 2-week ability drop); mismatches ${mismatch}`);
  return { fired, shouldFire, mismatch, struggling, firedStruggling };
}

function masteryCheck(results) {
  let passed = 0, checksN = 0, failed = 0, reviews = 0, movedOn = 0, bad = [];
  for (const r of results) {
    const d = HF.engine.derive(r.records, r.records.updatedAt || 0);
    for (const u of Object.values(d.mastery.units)) {
      if (u.status === 'passed') passed++;
      if (u.status === 'moved-on') movedOn++;
      checksN += u.checks.length; failed += u.checks.filter(c => !c.pass).length;
      reviews += u.reviews.filter(x => x.doneAt).length;
      if ((u.status === 'passed' || u.status === 'pending-check') && !u.criterionAt) bad.push('passed without criterion ' + u.id);
      for (const c of u.checks) if (u.criterionDay && G.dayKey(c.t) <= u.criterionDay) bad.push('check on the criterion day ' + u.id);
    }
    // levels never exceed the unit cap inside a unit block
    for (const b of r.records.blocks) if (b.purpose === 'unit' && b.capRung != null && b.levelAfter > b.capRung && b.levelBefore <= b.capRung) bad.push('level above unit cap');
  }
  check('Mastery: criterion → delayed check on a later day → pass/corrective; caps hold', bad.length === 0,
    `${passed} units passed, ${movedOn} moved on, ${checksN} checks (${failed} failed), ${reviews} reviews${bad.length ? '; ' + bad.slice(0, 3).join('; ') : ''}`);
  return { passed, movedOn, checks: checksN, failedChecks: failed, reviews };
}

function freeCheck(results) {
  const edge = [], level = [];
  for (const r of results) for (const b of r.records.blocks) {
    if (b.role !== 'free' || HF.controller.blockBad(b)) continue;
    if (b.sim && b.sim.choice && b.sim.choice.kind === 'edge') edge.push(b.result.ba);
  }
  const s = settle(results, 'free', null, 'free (on-level blocks)');
  check('Free: blocks at the coach\'s Edge rung average near .80 (±.05)', Math.abs(mean(edge) - 0.8) <= 0.05, `mean ${fmt(mean(edge))} (n=${edge.length})`);
  return { onLevel: s, edgeMean: mean(edge), edgeN: edge.length };
}

// ---------- scenarios ----------
const report = { scenario, n: N, days: DAYS, seed: SEED, at: new Date().toISOString(), results: {} };
function scenarioMode(modeId, extra, label) {
  const t0 = Date.now();
  const res = runMany(modeId, extra);
  const out = { seconds: (Date.now() - t0) / 1000 };
  out.deadEnds = deadEnds(res);
  const sm = modeId === 'stretch' ? 'stretch' : modeId;
  if (modeId === 'free') out.free = freeCheck(res);
  else if (modeId === 'mastery') {
    // Inside units the level runs under a cap that rises unit by unit, so there is no stationary regime to measure
    // there; the controller's settling is tested where it runs uncapped: maintenance after the path, with a
    // somewhat stronger population (+2 logits) that finishes the path within the 60 days.
    const strong = [];
    for (let i = 0; i < Math.max(30, Math.round(N / 3)); i++) strong.push(runLearner(HF, { id: `${SEED}-mastery-strong-${i}`, modeId: 'mastery', days: DAYS, learnerOpts: { pSecond: 0.1, gBoost: 2, pDay: 0.8 } }));
    out.settle = settle(strong, 'mastery', b => b.purpose === 'maintenance', 'mastery (maintenance after the path, uncapped)');
    const unit = { atCap: [], belowCap: [], all: [] };
    for (const r of res) for (const b of r.records.blocks) {
      if (b.role !== 'rated' || b.purpose !== 'unit' || HF.controller.blockBad(b)) continue;
      unit.all.push(b.result.ba); (b.capRung != null && b.rung >= b.capRung ? unit.atCap : unit.belowCap).push(b.result.ba);
    }
    out.unitBlocks = { all: mean(unit.all), atCap: mean(unit.atCap), belowCap: mean(unit.belowCap), n: unit.all.length };
    console.log(`  mastery unit blocks (main population): all ${fmt(out.unitBlocks.all)} (n=${unit.all.length}), at the unit's target ${fmt(out.unitBlocks.atCap)}, below it ${fmt(out.unitBlocks.belowCap)} — between the controller's .80 and the unit pass level .85`);
    out.mastery = masteryCheck(res);
    out.masteryStrong = masteryCheck(strong);
  }
  else out.settle = settle(res, sm);
  if (modeId === 'stretch') { out.settleVaried = settle(res, 'varied', null, 'stretch learners (Varied phase before Stretch opens)'); out.valve = valveCheck(res); }
  out.caps = caps(res);
  out.sound = soundCheck(res, modeId);
  out.assist = assistCheck(res);
  if (modeId === 'varied' || modeId === 'stretch' || modeId === 'sprint' || modeId === 'mastery') out.intro = introAndGates(res, modeId);
  out.model = modelQuality(res);
  out.summary = summary(res);
  console.log(`  model: RMSE ${fmt(out.model.rmse)}, bias ${fmt(out.model.bias)}, first-block |error| ${fmt(out.model.firstBlockMAE)} · median blocks ${out.summary.blocksMedian}, counted sessions ${out.summary.countedMedian} · ${out.seconds}s`);
  console.log('  median level: ' + JSON.stringify(out.summary.medianLevel));
  report.results[label || modeId] = out;
  return res;
}

const S = scenario;
const soundOff = i => (i % 5 === 4 ? { sound: 'off' } : {});
const assisted = i => (i % 10 === 3 ? [{ id: 'as1', t: Date.UTC(2026, 0, 4, 23), type: 'assist-start', trackId: 'nback.plain' }, { id: 'as2', t: Date.UTC(2026, 0, 4, 23, 1), type: 'assist-start', trackId: 'rel.grid.T1' }] : []);
if (S === 'varied' || S === 'all') scenarioMode('varied', i => ({ settings: soundOff(i), events: assisted(i), learnerOpts: { pSecond: 0.15 } }));
if (S === 'sprint' || S === 'all') scenarioMode('sprint', i => ({ learnerOpts: { pSecond: 0.4 } }));
if (S === 'stretch' || S === 'all') scenarioMode('stretch', i => ({ settings: soundOff(i), learnerOpts: { pSecond: 0.15, pDay: 0.5 + 0.45 * ((i * 7919) % 100) / 100, struggleFrom: i % 4 === 0 ? 30 : null, struggleDrop: 2.0 } }));
if (S === 'mastery' || S === 'all') scenarioMode('mastery', i => ({ settings: soundOff(i), learnerOpts: { pSecond: 0.1 } }));
if (S === 'free' || S === 'all') scenarioMode('free', i => ({ settings: soundOff(i) }));
if (S === 'cao' || S === 'all') {
  const res = runMany('protocols', i => ({ settings: { protocols: { cao: true, wang: false, jaeggi: false } }, days: S === 'cao' ? Math.max(DAYS, 120) : DAYS, learnerOpts: { pDay: 0.5 + 0.4 * (i % 10) / 10 } }));
  report.results.cao = { deadEnds: deadEnds(res), cao: caoCheck(res), caps: caps(res), model: modelQuality(res) };
}
if (S === 'wang' || S === 'all') {
  // a quarter of the learners lose 2.5 logits for two weeks from day 20, so the "< .50 → down" rule is exercised
  const res = runMany('protocols', i => ({ settings: { protocols: { cao: false, wang: true, jaeggi: false } }, learnerOpts: { pSecond: 0.2, struggleFrom: i % 4 === 0 ? 20 : null, struggleDrop: 2.5 } }));
  const w = wangCheck(res);
  check('Wang: the down rule fires when a day falls below chance', w.moves.down > 0, `${w.moves.down} down moves in ${w.days} days`);
  report.results.wang = { deadEnds: deadEnds(res), wang: w, caps: caps(res) };
}
if (S === 'jaeggi' || S === 'all') {
  const res = runMany('protocols', i => ({ settings: { protocols: { cao: false, wang: false, jaeggi: true } } }));
  const off = []; for (let i = 0; i < Math.max(10, Math.round(N / 15)); i++) off.push(runLearner(HF, { id: `${SEED}-jaeggi-off-${i}`, modeId: 'protocols', days: 20, settings: { sound: 'off', protocols: { cao: false, wang: false, jaeggi: true } } }));
  const offBlocks = off.reduce((s, r) => s + r.records.blocks.length, 0), offNoted = off.every(r => r.plans.every(p => p.notes.includes('sound-off')));
  check('Jaeggi with sound off: no session is scheduled and the plan says why', offBlocks === 0 && offNoted && off.every(r => !r.issues.length), `${off.length} learners × 20 days: ${offBlocks} blocks`);
  report.results.jaeggi = { deadEnds: deadEnds(res), jaeggi: jaeggiCheck(res), caps: caps(res) };
}
function study(template, arms) {
  const per = Math.max(10, Math.round(N / arms.length));
  for (const arm of arms) {
    const res = [];
    for (let i = 0; i < per; i++) res.push(runLearner(HF, { id: `${SEED}-study-${template}-${arm}-${i}`, modeId: 'varied', days: DAYS,
      events: [{ id: 'st1', t: Date.UTC(2026, 0, 4), type: 'study-enrol', template }, { id: 'st2', t: Date.UTC(2026, 0, 4, 1), type: 'study-draw', arm }] }));
    const out = { deadEnds: deadEnds(res), caps: caps(res) };
    const tracks = {}; for (const r of res) for (const b of r.records.blocks) tracks[b.trackId] = (tracks[b.trackId] || 0) + 1;
    const allowed = { train: t => !/^span|^vs/.test(t), control: t => t === 'vs.search', labonly: () => false, 'cao-exec': t => t === 'nback.transform', 'cao-trad': t => t === 'nback.plain', 'wang-steps': t => t === 'rel.steps' }[arm];
    const wrong = Object.keys(tracks).filter(t => !allowed(t));
    check(`Study ${template}/${arm}: only the arm's tasks are trained`, wrong.length === 0, JSON.stringify(tracks));
    if (arm === 'control' || arm === 'train') out.settle = settle(res, 'varied', null, `study ${template}/${arm}`);
    if (arm === 'control') {
      const top = C.maxRung('vs.search'), reached = res.filter(r => r.records.blocks.some(b => b.trackId === 'vs.search' && b.levelAfter >= top)).length;
      const finals = res.map(r => HF.engine.derive(r.records, r.records.updatedAt || 0).tracks['vs.search'].level);
      out.headroom = { reachedTop: reached, learners: res.length, finalLevelMedian: quant(finals, 0.5), finalLevelP90: quant(finals, 0.9), top };
      // headroom is reported, not pass/fail: it depends on the ladder (SPEC §5) and on the simulated learning rate
      console.log(`  INFO  Study ${template}/control headroom: ${reached}/${res.length} learners touched step ${top + 1} of ${top + 1} in ${DAYS} days; final level median ${C.levelLabel('vs.search', Math.round(quant(finals, 0.5)))}, 90th percentile ${C.levelLabel('vs.search', Math.round(quant(finals, 0.9)))}`);
    }
    if (arm === 'cao-exec') out.cao = caoCheck(res, 'exec');
    if (arm === 'cao-trad') out.cao = caoCheck(res, 'trad');
    if (arm === 'wang-steps') out.wang = wangCheck(res);
    report.results[`study-${template}-${arm}`] = out;
  }
}
if (S === 'study-default' || S === 'all') study('default', ['train', 'control', 'labonly']);
if (S === 'study-cao' || S === 'all') study('cao', ['cao-exec', 'cao-trad', 'control']);
if (S === 'study-wang' || S === 'all') study('wang', ['wang-steps', 'control']);

if (S === 'weights') {
  // learner-model weight order: research/03 (track 1 … general .2) vs SPEC §6 as written (general 1 … track .2)
  const configs = { research: { general: 0.2, task: 0.35, contentFamily: 0.5, structure: 0.5, track: 1.0 }, specLiteral: { general: 1.0, task: 0.5, contentFamily: 0.5, structure: 0.35, track: 0.2 } };
  const keep = { ...HF.learner.config.weights };
  for (const [name, w] of Object.entries(configs)) {
    HF.learner.config.weights = w;
    const specific = opt('specific', null) != null;
    const res = runMany('varied', i => ({ learnerOpts: specific ? { pSecond: 0.15, gSD: 0.3, trackSD: 0.8 } : { pSecond: 0.15 } }));
    const q = modelQuality(res);
    // placement quality: |first rated BA on a new track − its predicted BA|, and |levelEq − true edge rung| at the end
    const firstErr = [], eqErr = [];
    for (const r of res) {
      const seen = {};
      for (const b of r.records.blocks) if (b.role === 'rated' && !seen[b.trackId] && !HF.controller.blockBad(b)) { seen[b.trackId] = 1; if (b.sim && b.sim.pTrue != null) firstErr.push(Math.abs(b.result.ba - (0.5 + 0.5 * b.sim.pTrue))); }
      const d = HF.engine.derive(r.records, r.records.updatedAt || 0);
      for (const tid of ['nback.plain', 'nback.transform', 'rel.steps', 'rel.grid.T1']) {
        if (!(d.tracks[tid].ratedBlocks > 5)) continue;
        let edge = -1; for (let k = 0; k <= C.maxRung(tid); k++) { const p = 0.5 + 0.5 / (1 + Math.exp(-(r.learner.trueTheta(tid) - r.learner.trueDiff(tid, k)))); if (p >= 0.8) edge = k; }
        eqErr.push(Math.abs(d.tracks[tid].levelEq - edge));
      }
    }
    const placeErr = [];
    for (const r of res) { const seen = {}; for (const b of r.records.blocks) if (b.role === 'rated' && !seen[b.trackId] && !HF.controller.blockBad(b)) { seen[b.trackId] = 1; placeErr.push(b.result.ba); } }
    const out = { rmse: q.rmse, bias: q.bias, firstBlockMAE: q.firstBlockMAE, firstRatedBA: mean(placeErr), firstRatedSD: sd(placeErr), levelEqAbsErrRungs: mean(eqErr), settle: settle(res, 'varied', null, 'varied with ' + name + ' weights') };
    console.log(`weights ${name}: RMSE ${fmt(out.rmse)}, bias ${fmt(out.bias)}, first-block |y−ŷ| ${fmt(out.firstBlockMAE)}, first rated BA on a new track ${fmt(out.firstRatedBA)} ± ${fmt(out.firstRatedSD)}, |levelEq − true edge| ${fmt(out.levelEqAbsErrRungs)} rungs`);
    report.results['weights-' + name] = out;
  }
  HF.learner.config.weights = keep;
}

if (S === 'cao-gap') {
  // Calibration: Transform (days, +1) should sit about one n above Plain at the same rung (Cao 2026 Fig. 4). The
  // same simulated people run both arms of Cao's protocol; truth = catalog for these two tracks.
  population('pop-' + SEED, { exact: ['nback.plain', 'nback.transform'] });
  const per = { exec: [], trad: [] };
  for (const [arm, trackArm] of [['cao-exec', 'exec'], ['cao-trad', 'trad']]) {
    for (let i = 0; i < N; i++) {
      const r = runLearner(HF, { id: `${SEED}-gap-${i}`, modeId: 'varied', days: DAYS, learnerOpts: { pDay: 0.7 },
        events: [{ id: 'st1', t: Date.UTC(2026, 0, 4), type: 'study-enrol', template: 'cao' }, { id: 'st2', t: Date.UTC(2026, 0, 4, 1), type: 'study-draw', arm }] });
      const d = HF.engine.derive(r.records, r.records.updatedAt || 0), st = trackArm === 'trad' ? d.protocols.caoTrad : d.protocols.cao;
      per[trackArm].push(st.sessions.filter(s => s.purpose === 'train').map(s => s.meanN));
    }
  }
  const bySess = k => [0, 1, 2, 3, 4, 5].map(i => mean(per[k].map(v => v[i]).filter(x => x != null)));
  const ex = bySess('exec'), tr = bySess('trad'), gap = tr.map((x, i) => x - ex[i]);
  console.log('  mean n per session  executive ' + ex.map(x => fmt(x, 2)).join(' ') + '  traditional ' + tr.map(x => fmt(x, 2)).join(' '));
  check('Cao arms: traditional ends about one n above executive (session 6 gap 0.7–1.3 n)', gap[5] >= 0.7 && gap[5] <= 1.3, 'gap per session ' + gap.map(x => fmt(x, 2)).join(' '));
  report.results['cao-gap'] = { exec: ex, trad: tr, gap };
  population('pop-' + SEED);
}
if (S === 'extremes') {
  // very strong and very weak learners in every mode: plans must never run dry at the ends of the ladders
  for (const [label, boost] of [['strong', 7], ['weak', -4]]) {
    for (const modeId of ['varied', 'sprint', 'stretch', 'mastery', 'free']) {
      const res = [];
      for (let i = 0; i < Math.max(10, Math.round(N / 10)); i++) res.push(runLearner(HF, { id: `${SEED}-${label}-${modeId}-${i}`, modeId, days: DAYS, learnerOpts: { gBoost: boost, pDay: 0.9 } }));
      const issues = {}; let emptyPlans = 0, sessions = 0, lastBlocks = 0;
      for (const r of res) {
        for (const x of r.issues) issues[x.kind] = (issues[x.kind] || 0) + 1;
        for (const p of r.plans) { sessions++; if (!p.slots) emptyPlans++; }
        const lastDay = Math.max(...r.plans.map(p => p.day));
        lastBlocks += r.plans.filter(p => p.day === lastDay).reduce((s, p) => s + p.slots, 0);
      }
      const d = HF.engine.derive(res[0].records, res[0].records.updatedAt || 0);
      const top = Object.entries(d.tracks).filter(([k, v]) => v.ratedBlocks && v.level >= C.maxRung(k)).map(([k]) => k);
      const notes = new Set(res.flatMap(r => r.plans.flatMap(p => p.notes)));
      check(`${label} learners, ${modeId}: plans keep producing blocks`, Object.keys(issues).length === 0 && emptyPlans === 0 && lastBlocks > 0,
        `${sessions} sessions, ${emptyPlans} empty, issues ${JSON.stringify(issues)}; tracks at the top for learner 0: ${top.length}; notes: ${[...notes].join(',')}`);
      report.results[`extremes-${label}-${modeId}`] = { sessions, emptyPlans, issues, topTracks: top, notes: [...notes] };
    }
  }
}

report.checks = checks;
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (${scenario}, n=${N}, ${DAYS} days)`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
process.exit(failed.length ? 1 : 0);
