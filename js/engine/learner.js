/* Long-Horizon — shared learner model (pure, no DOM). MIT licence.
 *
 * SPEC §6 / research/03 §6: an Elo-style online approximation of a Rasch model with hierarchical,
 * cross-classified skills (Pelánek 2016; Pelánek et al. 2017), adapted to block outcomes.
 *   θ_eff(track, set) = θ_general + θ_task + mean(θ_contentFamily) + θ_structure + θ_track
 *   ŷ = logistic(θ_eff − difficulty(track, rung)),  predicted BA = .5 + .5 ŷ   (Span: predicted recall = ŷ)
 *   after each model-updating block: θ_c += w_c · K · (y − ŷ) for every component c
 *   K = max(.15, 1 / (1 + .05 · nTrackBlocks)), nTrackBlocks decayed by exp(−days off / 60) before each update.
 * Observation y = result.y (mean over streams of max(0, hit rate − false-alarm rate)); Span uses recall.
 * Blocks that update the model: warmup, rated, free, check, protocol — never tutorial, assist or probe,
 * never interrupted ones or ones with more than 20 % voided trials.
 *
 * Weights (SPEC §6 as amended 6 Nov, = research/03 §6.4): track 1, structure .5, contentFamily .5, task .35,
 * general .2. The first SPEC draft listed the same numbers in the reverse component order; the simulations compare
 * both (docs/dev/sim-report.md §4). HF.learner.config.weights changes them.
 *
 * API (HF.learner):
 *   create() → model { theta: {key: θ}, n: {trackId: n}, lastT: {trackId: ms}, total, hist: {trackId: [θ_eff]}, resid: {task: [e]} }
 *   keys(trackId, setId) → [[componentKey, weight]]
 *   thetaEff(model, trackId, setId) → θ
 *   predict(model, trackId, rung, setId?, adj?) → ŷ in (0,1)
 *   predictBA(model, trackId, rung, setId?, adj?) → predicted BA (Span: recall)
 *   observation(block) → y | NaN
 *   updatesModel(block) → bool
 *   update(model, block) → { pred, y, e } (mutates model; block = BlockRecord)
 *   replay(blocks) → model (blocks in time order)
 *   levelEquivalent(model, trackId, setId?) → highest rung with predicted BA ≥ .80 (−1 if none)
 *   levelEquivalentText(model, trackId) → "≈ 3.5-back" | "≈ 2-back up to 19" | "≈ step 4 of 9" (Grid) | "≈ step 2 of 6"
 *        (Stream) | "below step 1" …, in the unit of the level shown beside it (Phase 4, UX-13)
 *   placement(model, trackId, target, modeId?, setId?) → start rung (one below the prediction, 0 without history)
 *   edgeRung(model, trackId, target?, setId?, modeId?) → rung whose predicted BA is closest to target
 *   progress(model, trackId, k?) → rise of θ_eff over the track's last k (10) updates (NaN if too few)
 *   meanResidual(model, task) → mean residual of the last 30 updates (calibration monitor)
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  var config = {
    weights: { general: 0.2, task: 0.35, contentFamily: 0.5, structure: 0.5, track: 1.0 },
    kMin: 0.15, kBeta: 0.05, decayDays: 60, eqTarget: 0.80, histLen: 12, residLen: 30
  };
  var DAY = 86400000;
  var MODEL_ROLES = { warmup: 1, rated: 1, free: 1, check: 1, protocol: 1 };

  function cat() { return HF.catalog; }
  function logistic(x) { return 1 / (1 + Math.exp(-x)); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function create() { return { theta: {}, n: {}, lastT: {}, total: 0, hist: {}, resid: {} }; }

  // Component keys per (track, set) are cached: { shared: ['g'?, 't:…', 's:…', 'v:…'], fam: ['f:…'] }.
  var KEYS = {};
  function keyInfo(trackId, setId) {
    var byTrack = KEYS[trackId] || (KEYS[trackId] = {}), sk = setId || '', k = byTrack[sk];
    if (k) return k;
    var tr = cat().get(trackId), fams = cat().familiesFor(trackId, setId);
    k = { general: !tr.noGeneral, task: 't:' + tr.task, struct: 's:' + tr.structure, track: 'v:' + trackId, fam: fams.map(function (f) { return 'f:' + f; }) };
    byTrack[sk] = k;
    return k;
  }

  function keys(trackId, setId) {
    var k = keyInfo(trackId, setId), w = config.weights, out = [];
    if (k.general) out.push(['g', w.general]);
    out.push([k.task, w.task]);
    for (var i = 0; i < k.fam.length; i++) out.push([k.fam[i], w.contentFamily / k.fam.length]);
    out.push([k.struct, w.structure]);
    out.push([k.track, w.track]);
    return out;
  }

  function th(model, key) { var v = model.theta[key]; return v === undefined ? 0 : v; }

  function thetaEff(model, trackId, setId) {
    var k = keyInfo(trackId, setId), T = model.theta, x = 0, v;
    if (k.general) { v = T.g; if (v !== undefined) x += v; }
    v = T[k.task]; if (v !== undefined) x += v;
    var f = 0;
    for (var i = 0; i < k.fam.length; i++) { v = T[k.fam[i]]; if (v !== undefined) f += v; }
    x += f / k.fam.length;
    v = T[k.struct]; if (v !== undefined) x += v;
    v = T[k.track]; if (v !== undefined) x += v;
    return x;
  }

  function predict(model, trackId, rung, setId, adj) {
    return logistic(thetaEff(model, trackId, setId) - cat().difficulty(trackId, rung, adj));
  }
  function predictBA(model, trackId, rung, setId, adj) {
    var y = predict(model, trackId, rung, setId, adj);
    return cat().get(trackId).scale === 'recall' ? y : 0.5 + 0.5 * y;
  }

  function observation(block) {
    var r = block && block.result; if (!r) return NaN;
    var tr = cat().get(block.trackId); if (!tr) return NaN;
    if (tr.scale === 'recall') return isNum(r.ba) ? Math.max(0, Math.min(1, r.ba)) : NaN;
    if (isNum(r.y)) return Math.max(0, Math.min(1, r.y));
    if (isNum(r.baMean)) return Math.max(0, 2 * r.baMean - 1);
    if (isNum(r.ba)) return Math.max(0, 2 * r.ba - 1);
    return NaN;
  }

  function updatesModel(block) {
    if (!block || !MODEL_ROLES[block.role]) return false;
    if (block.interrupted) return false;
    if (isNum(block.voidedRatio) && block.voidedRatio > (HF.controller ? HF.controller.voidLimit(block.trackId) : 0.2)) return false;
    if (!cat().get(block.trackId)) return false;
    return isNum(observation(block));
  }

  function update(model, block) {
    var trackId = block.trackId, t = isNum(block.t) ? block.t : 0;
    var y = observation(block);
    var adj = { lureCount: block.lurePlan != null ? block.lurePlan : block.lureCount, lureMode: block.lureMode, step: block.rungParams && block.rungParams.step };
    var yhat = predict(model, trackId, block.rung, block.set, adj);
    var e = y - yhat;
    var n = model.n[trackId] || 0, last = model.lastT[trackId];
    if (isNum(last) && t > last) n = n * Math.exp(-((t - last) / DAY) / config.decayDays);
    var K = Math.max(config.kMin, 1 / (1 + config.kBeta * n));
    var k = keyInfo(trackId, block.set), w = config.weights, T = model.theta, step = K * e;
    if (k.general) T.g = th(model, 'g') + w.general * step;
    T[k.task] = th(model, k.task) + w.task * step;
    for (var i = 0; i < k.fam.length; i++) T[k.fam[i]] = th(model, k.fam[i]) + (w.contentFamily / k.fam.length) * step;
    T[k.struct] = th(model, k.struct) + w.structure * step;
    T[k.track] = th(model, k.track) + w.track * step;
    model.n[trackId] = n + 1;
    model.lastT[trackId] = Math.max(t, isNum(last) ? last : t);
    model.total++;
    var h = model.hist[trackId] || (model.hist[trackId] = []);
    h.push(thetaEff(model, trackId, null));
    if (h.length > config.histLen) h.shift();
    var task = cat().get(trackId).task;
    var rs = model.resid[task] || (model.resid[task] = []);
    rs.push(e); if (rs.length > config.residLen) rs.shift();
    return { pred: yhat, y: y, e: e, K: K };
  }

  function replay(blocks) {
    var m = create();
    for (var i = 0; i < (blocks || []).length; i++) if (updatesModel(blocks[i])) update(m, blocks[i]);
    return m;
  }

  function scanRungs(trackId, modeId) {
    var c = cat();
    return modeId ? c.allowedRungs(trackId, modeId) : (function () { var a = []; for (var r = 0; r <= c.maxRung(trackId); r++) a.push(r); return a; })();
  }

  function levelEquivalent(model, trackId, setId) {
    var best = -1, max = cat().maxRung(trackId);
    for (var r = 0; r <= max; r++) if (predictBA(model, trackId, r, setId) >= config.eqTarget) best = r;
    return best;
  }

  function levelEquivalentText(model, trackId, setId, rungEq) {
    var c = cat(), tr = c.get(trackId), r = typeof rungEq === 'number' ? rungEq : levelEquivalent(model, trackId, setId);
    // in the unit of the level shown beside it (Progress: "Step 4 of 9 · skill ≈ step 3 of 9"; Phase 4, UX-13)
    if (r < 0) return 'below ' + (tr.tier || trackId === 'rel.stream' ? 'step 1' : c.levelLabel(trackId, 0));
    var p = c.params(trackId, r);
    if (tr.task === 'nback' && trackId !== 'nback.switch') return '≈ ' + (p.n + (r % 2 ? 0.5 : 0)) + '-back';
    if (trackId === 'nback.switch') return '≈ ' + (p.n + (r % 3) / 3).toFixed(1).replace(/\.0$/, '') + '-back';
    if (trackId === 'rel.steps') return '≈ ' + p.back + '-back up to ' + p.maxNumber;
    if (tr.tier) return '≈ step ' + (r + 1) + ' of 9';
    if (trackId === 'rel.stream') return '≈ step ' + (r + 1) + ' of 6';
    if (tr.task === 'span') return '≈ ' + p.setSize + ' items';
    return '≈ ' + c.levelLabel(trackId, r);
  }

  /** Start rung for a track with no rated blocks: one rung below the highest rung predicted at ≥ target; 0 without any history. */
  function placement(model, trackId, target, modeId, setId) {
    if (!model || !model.total) return 0;
    var rungs = scanRungs(trackId, modeId), tr = cat().get(trackId);
    var tgt = target;
    if (tr.scale === 'recall') { var m = HF.modes ? HF.modes.get(modeId || 'varied') : null; tgt = m ? (m.spanUp + m.spanDown) / 2 : 0.7; }
    var idx = -1;
    for (var i = 0; i < rungs.length; i++) if (predictBA(model, trackId, rungs[i], setId) >= tgt) idx = i;
    idx = idx - 1;
    if (idx < 0) return rungs[0];
    return rungs[idx];
  }

  function edgeRung(model, trackId, target, setId, modeId) {
    var tgt = target == null ? 0.80 : target, rungs = scanRungs(trackId, modeId), best = rungs[0], bestD = Infinity;
    for (var i = 0; i < rungs.length; i++) {
      var d = Math.abs(predictBA(model, trackId, rungs[i], setId) - tgt);
      if (d < bestD - 1e-12) { bestD = d; best = rungs[i]; }
    }
    return best;
  }

  function progress(model, trackId, k) {
    var h = model && model.hist[trackId]; k = k || 10;
    if (!h || h.length < 3) return NaN;
    var from = Math.max(0, h.length - 1 - k);
    return h[h.length - 1] - h[from];
  }

  function meanResidual(model, task) {
    var rs = model && model.resid[task]; if (!rs || !rs.length) return NaN;
    var s = 0; for (var i = 0; i < rs.length; i++) s += rs[i]; return s / rs.length;
  }

  var api = {
    config: config,
    create: create,
    keys: keys,
    thetaEff: thetaEff,
    predict: predict,
    predictBA: predictBA,
    observation: observation,
    updatesModel: updatesModel,
    update: update,
    replay: replay,
    levelEquivalent: levelEquivalent,
    levelEquivalentText: levelEquivalentText,
    placement: placement,
    edgeRung: edgeRung,
    progress: progress,
    meanResidual: meanResidual
  };
  HF.learner = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
