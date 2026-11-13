// Lesson data (js/content/lessons.js): ids match the catalog, every lesson references existing tracks and sets,
// the hand-built sequences carry exactly the labels the real rule kernels give them, the checks can be generated
// and follow PLAN §8, and every explanation the lessons show comes from the task scorer's why[].
import { HF, loadAllPure } from './load.mjs';

loadAllPure();

const L = () => HF.content.lessons;
const NB = () => HF.tasks.nback;

function findItem(setId, name) {
  const set = HF.sets.get(setId);
  if (!set) throw new Error('unknown set ' + setId);
  const it = set.items.find(i => i.text === name || i.expr === name || HF.sets.name(i) === name);
  if (!it) throw new Error(`no item ${name} in ${setId}`);
  return it;
}
/** The same construction as js/ui/lessons.js seqSpec (sound streams use tones here). */
function seqSpec(name) {
  const q = L().SEQ[name];
  if (q.trackId === 'rel.steps') {
    const xs = q.numbers, b = q.back, R = HF.tasks.relations.steps;
    return { kind: 'stream', task: 'relations', trackId: 'rel.steps', set: 'numbers', params: { back: b, maxNumber: 9, onMs: 500, soaMs: 3000 },
      onMs: 500, soaMs: 3000, streams: ['main'], leadIn: b + 1,
      trials: xs.map((x, i) => { const j = R.judge(xs, b, i); return { i, stim: { main: { number: x } }, scorable: j.scorable, target: { main: j.target }, lure: { main: j.scorable && !j.target && j.near ? 'near' : null } }; }) };
  }
  const n = q.n; let trials, streams = ['main'], sets, set = q.set;
  if (q.trackId === 'nback.dual') {
    const snd = HF.sets.get('tones').items;
    streams = ['pos', 'snd']; sets = { pos: 'grid8', snd: 'tones' }; set = 'tones';
    trials = q.pos.map((cell, i) => ({ i, stim: { pos: { cell }, snd: snd[q.snd[i]] }, scorable: i >= n, target: {}, lure: {} }));
  } else if (set === 'sound') {
    set = 'tones'; const its = HF.sets.get('tones').items; sets = { main: set };
    trials = q.snd.map((k, i) => ({ i, stim: { main: its[k] }, scorable: i >= n, target: {}, lure: {} }));
  } else if (q.trackId === 'nback.switch') {
    sets = { main: set, what: set, where: 'grid8' };
    trials = q.items.map((x, i) => ({ i, stim: { main: { what: findItem(set, x[0]), where: { cell: x[1] } } }, cue: i >= n ? x[2] : null, scorable: i >= n, target: {}, lure: {} }));
  } else {
    sets = { main: set };
    trials = q.items.map((x, i) => ({ i, stim: { main: findItem(set, x) }, scorable: i >= n, target: {}, lure: {} }));
  }
  const spec = { kind: 'stream', task: 'nback', trackId: q.trackId, set, params: { n, onMs: 500, soaMs: 3000 }, onMs: 500, soaMs: 3000, streams, leadIn: n, sets, trials, meta: {} };
  const an = NB().analyze(spec);
  trials.forEach((t, i) => streams.forEach(st => { t.target[st] = an[st][i].target; t.lure[st] = an[st][i].lure || null; }));
  return spec;
}
function perfectWhy(spec) {
  const responses = [];
  spec.trials.forEach(t => {
    if (!t.scorable) return;
    if (t.target.main || t.target.pos) responses.push({ key: 'match', trial: t.i, t: t.i * 3000 + 400, rt: 400 });
    if (t.target.snd) responses.push({ key: 'match2', trial: t.i, t: t.i * 3000 + 400, rt: 400 });
  });
  const score = spec.task === 'nback' ? NB().score : HF.tasks.relations.score;
  return score(spec, { responses, voided: [], paused: false });
}

export default async function (t) {
  await t.test('lesson ids and tracks match HF.catalog.LESSONS exactly', () => {
    const cat = HF.catalog.LESSONS;
    t.eq(L().ids().slice().sort(), Object.keys(cat).sort(), 'lesson ids');
    L().LIST.forEach(l => {
      t.eq(l.trackIds, cat[l.id].tracks, l.id + ' tracks');
      t.eq(l.title, cat[l.id].title, l.id + ' title');
      l.trackIds.forEach(id => t.ok(HF.catalog.get(id), 'track exists: ' + id));
      t.ok(l.minutes > 0 && l.summary && l.kind, l.id + ' has minutes, summary, kind');
    });
    HF.catalog.ids().forEach(id => t.eq(L().forTrack(id), HF.catalog.get(id).lessonId, 'forTrack(' + id + ')'));
  });

  await t.test('every lesson except the tier intros has a script with one check and an end page', () => {
    const SEQ = L().SEQ, KNOWN = ['page', 'demo', 'guided', 'timed', 'check', 'end', 'lines-demo', 'lines', 'arrays', 'stream-demo', 'stream-guided', 'span-demo', 'span-guided', 'vs-guided'];
    L().LIST.forEach(l => {
      if (l.kind === 'intro') { t.ok(!L().STEPS[l.id], l.id + ' uses the tier intro'); t.ok(L().TIERS[l.id.slice(-2)], l.id + ' tier text'); return; }
      const steps = L().STEPS[l.id];
      t.ok(Array.isArray(steps) && steps.length >= 3, l.id + ' script');
      t.eq(steps.filter(s => s.type === 'check').length, 1, l.id + ' has one check');
      t.eq(steps[steps.length - 1].type, 'end', l.id + ' ends with an end page');
      t.ok(L().CHECKS[l.id], l.id + ' has check criteria');
      steps.forEach(s => {
        t.ok(KNOWN.indexOf(s.type) >= 0, l.id + ': known step type ' + s.type);
        t.ok(s.title && s.part, l.id + ': step has a title and a part');
        if (s.seq) t.ok(SEQ[s.seq], l.id + ': sequence exists ' + s.seq);
        (s.arrays || []).forEach(a => t.ok(SEQ[a] && SEQ[a].cells, l.id + ': array exists ' + a));
        if (s.type === 'timed') t.ok(s.onMs > 0 && s.soaMs > s.onMs, l.id + ': timed step has timing');
        if (s.figure) t.ok(typeof s.figure === 'string', 'figure name');
      });
    });
  });

  await t.test('n-back basics follows PLAN §8 (N1–N7)', () => {
    const steps = L().STEPS['lesson.nback'];
    const seq = steps.filter(s => s.seq).map(s => [s.type, L().SEQ[s.seq].n]);
    t.eq(seq.slice(0, 4), [['demo', 1], ['guided', 1], ['timed', 1], ['timed', 1]], '1-back demo, guided, slow, normal');
    const slow = steps.find(s => s.seq === 'nb1slow'), normal = steps.find(s => s.seq === 'nb1normal');
    t.ok(slow.soaMs > normal.soaMs && normal.soaMs === 3000 && normal.onMs === 500, 'slow, then the normal pace');
    const g1 = steps.find(s => s.seq === 'nb1guided');
    t.ok(g1.noButton && g1.why.length >= 1, 'temporary NO MATCH button and why? prompts');
    t.eq(g1.tape.map(x => x[1]), ['full', 'frame', 'none'], 'the tape fades: full → frame → none');
    const g2 = steps.find(s => s.seq === 'nb2guided');
    t.ok(g2.probes.length >= 2, '2-back probes "tap the item you compare with"');
    t.ok(Object.keys(g2.callouts).length >= 1, 'a lure is called out');
    const d2 = L().SEQ.nb2demo;
    t.eq(d2.items.slice(0, 4), ['K', 'T', 'K', 'T'], 'the A-B-A-B run');
    t.ok(Object.values(d2.expect.lures).length >= 1, 'the 2-back demo holds a lure');
    const chk = L().CHECKS['lesson.nback'];
    t.eq([chk.trackId, HF.catalog.params(chk.trackId, chk.rung).n, HF.catalog.params(chk.trackId, chk.rung).soaMs, chk.minHits, chk.maxFas],
      ['nback.plain', 2, 3000, 4, 2], 'check: 2-back, standard pace, ≥ 4/6 hits, ≤ 2/14 false presses');
    t.eq(Object.keys(L().MINI).sort(), ['keys', 'nothing', 'timing', 'window'], 'four mini-lessons');
    t.eq(L().CHECKS['lesson.grid'].minHits + '/' + L().CHECKS['lesson.grid'].maxFas, '7/2', 'RI check ≥ 7/10 and ≤ 2/10');
    t.eq(L().TEXT.chimera + L().TEXT.chimeraText, 'Questions or ideas? The Chimera community is on Discord: discord.gg/chmr', 'Chimera line');
    t.eq(L().TEXT.chimeraUrl, 'https://discord.gg/chmr', 'Chimera link');
  });

  await t.test('hand-built sequences carry exactly the labels the rule kernels give them', () => {
    const SEQ = L().SEQ;
    Object.keys(SEQ).forEach(name => {
      const q = SEQ[name];
      if (q.cells) {
        const base = HF.tasks.relations.grid.gen({ trackId: 'rel.grid.T1', rung: 0, set: 'digits', seed: 'x' });
        const sol = HF.tasks.relations.grid.solve(base, { i: 0, stim: { size: 3, cells: q.cells, kept: [] } });
        t.eq(sol.targets[0] || null, q.expect.line, name + ' target line');
        if (q.expect.near) t.eq(sol.near, [q.expect.near], name + ' near-miss line');
        else t.eq(sol.targets.length, 1, name + ' exactly one line');
        t.ok(q.cells.every(c => /^\d{3}$/.test(c)), name + ' cells are 3-digit strings');
        return;
      }
      const spec = seqSpec(name);
      if (q.trackId === 'rel.steps') {
        const targets = spec.trials.filter(x => x.target.main).map(x => x.i);
        const near = spec.trials.filter(x => x.lure.main).map(x => x.i);
        t.eq(targets, q.expect.targets, name + ' targets');
        t.eq(near, q.expect.near, name + ' near misses');
        t.ok(q.numbers.every(x => x >= 1 && x <= 9), name + ' numbers 1–9');
        return;
      }
      const an = NB().analyze(spec);
      spec.streams.forEach(st => t.ok(an[st].every(r => !(r.mask & 32)), name + ' no forbidden twin'));
      if (q.trackId === 'nback.dual') {
        t.eq(spec.trials.filter(x => x.target.pos).map(x => x.i), q.expect.pos, name + ' position targets');
        t.eq(spec.trials.filter(x => x.target.snd).map(x => x.i), q.expect.snd, name + ' sound targets');
        return;
      }
      t.eq(spec.trials.filter(x => x.target.main).map(x => x.i), q.expect.targets, name + ' targets');
      const lures = {}; spec.trials.forEach(x => { if (x.lure.main) lures[x.i] = x.lure.main; });
      t.eq(lures, q.expect.lures, name + ' lures');
      const scorable = spec.trials.filter(x => x.scorable).length, nt = q.expect.targets.length;
      t.ok(nt >= 1 && nt < scorable, name + ' has matches and non-matches');
    });
  });

  await t.test('every explanation a lesson shows comes from the scorer (why[] for every scorable item)', () => {
    Object.keys(L().SEQ).forEach(name => {
      const q = L().SEQ[name];
      if (q.cells) return;
      const spec = seqSpec(name), res = perfectWhy(spec);
      const scorable = spec.trials.filter(x => x.scorable).length * spec.streams.length;
      t.eq(res.why.length, scorable, name + ' why entries');
      res.why.forEach(w => t.ok(/^(Match|Not a match)/.test(w.text) && w.text.length > 12, name + ': ' + w.text));
      t.ok(res.why.every(w => w.outcome === 'hit' || w.outcome === 'cr'), name + ' perfect answers score as hits and correct rejections');
    });
    // the lure call-out in the 2-back guided run is explained as a lure by the scorer
    const spec = seqSpec('nb2guided'), w5 = perfectWhy(spec).why.find(w => w.i === 5);
    t.ok(/one back, not two back/.test(w5.text), 'lure explanation: ' + w5.text);
  });

  await t.test('every check can be generated with the right counts', () => {
    const CH = L().CHECKS;
    Object.keys(CH).forEach(id => {
      const c = CH[id], tr = HF.catalog.get(c.trackId);
      t.ok(tr, id + ' check track');
      const set = c.set === 'sound' ? 'tones' : c.set;
      const opts = { trackId: c.trackId, rung: c.rung, set, seed: 'test/' + id, params: c.params };
      let spec;
      if (tr.task === 'nback') spec = NB().gen(Object.assign({ lureCount: 4, lureMode: 'controlled' }, opts));
      else if (tr.task === 'relations') spec = HF.tasks.relations.gen(opts);
      else if (tr.task === 'span') spec = HF.tasks.span.gen(opts);
      else spec = HF.tasks.vsearch.gen(opts);
      t.ok(spec && spec.trials.length, id + ' generated');
      if (tr.task === 'nback' || c.trackId === 'rel.steps' || c.trackId === 'rel.stream') {
        spec.streams.forEach(st => t.eq(spec.trials.filter(x => x.target[st]).length, 6, id + ' 6 targets in ' + st));
        t.ok(c.minHits <= 6 && c.maxFas >= 0, id + ' criteria fit 6 targets');
      }
      if (spec.kind === 'discrete') t.eq(spec.trials.filter(x => x.answer === 'match').length, 10, id + ' 10 targets');
      if (tr.task === 'span') { t.eq(spec.trials.length * spec.trials[0].setSize, 6, id + ' 6 letters'); t.ok(c.minRecall <= 6 && c.minJudge <= 6, id + ' criteria'); }
      if (c.params && c.params.rule) t.eq(spec.params.rule, c.params.rule, id + ' rule');
    });
  });

  await t.test('tier intros: every tier T2–T8 has a text and a generated example with a target line', () => {
    for (let k = 2; k <= 8; k++) {
      const T = L().TIERS['T' + k];
      t.ok(T && T.tier === k && T.title && T.rule && T.body.length, 'T' + k + ' text');
      const spec = HF.tasks.relations.gen({ trackId: 'rel.grid.T' + k, rung: 0, set: T.set === 'shapes' ? undefined : T.set, seed: 'lesson/tier/T' + k });
      const tr = spec.trials.find(x => x.answer === 'match');
      t.ok(tr, 'T' + k + ' example array');
      const ex = HF.tasks.relations.grid.explain(spec, tr);
      t.ok(ex.line && ex.cells && ex.cells.length >= 3, 'T' + k + ' example line: ' + ex.text);
    }
  });

  await t.test('mini-lesson drills reference sequences of the right kind', () => {
    const M = L().MINI;
    ['nothing', 'window', 'timing'].forEach(k => { t.ok(L().SEQ[M[k].drill.seq], k + ' drill sequence'); t.eq(L().SEQ[M[k].drill.seq].n, 2, k + ' drill is 2-back'); });
    t.ok(M.timing.drill.onMs && M.timing.drill.soaMs, 'the timing drill is timed');
    t.ok(M.keys.drill.rounds >= 2, 'key drill rounds');
    const w = seqSpec('miniWindow');
    t.ok(w.trials.filter(x => x.lure.main).length >= 2, 'the window drill holds lures');
  });
}
