/* Long-Horizon — Free-play coach (pure, no DOM). MIT licence.
 *
 * PLAN §5 Free play + Coach / research/03 §5.6. Four suggestions, refreshed after each block:
 *   Edge     for the current version, the rung whose predicted BA is closest to .80
 *   Due      the available version practised longest ago (spacing)
 *   Growing  the version with the largest rise in its skill estimate over its last 10 model updates (learning progress)
 *   New      an available version never tried
 * Every option shows the learner model's predicted BA. The coach never moves a level.
 *
 * API (HF.coach):
 *   suggest(derived, { now, trackId?, freePlay? }) → [{ kind, trackId, rung, label, predicted, why }]
 *   options(derived, trackId, rung?) → [{ rung, label, predicted, current }] for one rung down, the level, one up
 *   table(derived, trackId) → [{ rung, label, predicted }] for every rung
 *   freeTracks(derived) → [trackId] tracks Free play may offer (available, plus Grid T8 once T7 reached step 6)
 */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});
  var DAY = 86400000;
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function freeTracks(d) {
    var out = [];
    HF.catalog.ids().forEach(function (id) {
      var t = d.tracks[id]; if (!t) return;
      if (id === 'vs.search') return;
      if (t.available || (id === 'rel.grid.T8' && t.ladderOpen)) out.push(id);
    });
    return out;
  }
  function pred(d, id, r) { return HF.learner.predictBA(d.model, id, r, null); }
  function item(kind, d, id, r, why) {
    return { kind: kind, trackId: id, rung: r, label: HF.catalog.fullLabel(id, r), predicted: pred(d, id, r), why: why };
  }

  function suggest(d, opts) {
    opts = opts || {};
    var now = isNum(opts.now) ? opts.now : 0, list = freeTracks(d), out = [];
    if (!list.length) return out;
    var played = list.filter(function (id) { return d.tracks[id].blocks > 0; });
    var cur = opts.trackId && list.indexOf(opts.trackId) >= 0 ? opts.trackId : null;
    if (!cur && played.length) cur = played.slice().sort(function (a, b) { return (d.tracks[b].lastPlayedAt || 0) - (d.tracks[a].lastPlayedAt || 0); })[0];
    if (!cur) cur = list[0];
    var target = HF.modes.get('free').coachTarget;
    var er = HF.learner.edgeRung(d.model, cur, target);
    out.push(item('edge', d, cur, er, 'Predicted about ' + Math.round(target * 100) + ' % here: the edge of your ability.'));
    var due = played.filter(function (id) { return id !== cur; }).sort(function (a, b) { return (d.tracks[a].lastPlayedAt || 0) - (d.tracks[b].lastPlayedAt || 0); })[0];
    if (due) {
      var days = Math.floor((now - (d.tracks[due].lastPlayedAt || now)) / DAY);
      out.push(item('due', d, due, d.tracks[due].level, days >= 1 ? 'Not practised for ' + days + (days === 1 ? ' day.' : ' days.') : 'Practised least recently.'));
    }
    var best = null, bestG = 0, shown = {};
    out.forEach(function (x) { shown[x.trackId] = true; });   // one card per version (Phase 4, PQ-09)
    played.forEach(function (id) {
      if (shown[id]) return;
      var g = HF.learner.progress(d.model, id, 10);
      if (isNum(g) && g > bestG + 1e-9) { bestG = g; best = id; }
    });
    if (best) out.push(item('growing', d, best, d.tracks[best].level, 'Your fastest recent progress.'));
    var fresh = list.filter(function (id) { return !d.tracks[id].blocks; })[0];
    if (fresh) out.push(item('new', d, fresh, d.tracks[fresh].level, 'Not tried yet.'));
    return out;
  }

  function options(d, id, rung) {
    var max = HF.catalog.maxRung(id), lvl = d.tracks[id] ? d.tracks[id].level : 0;
    var r0 = isNum(rung) ? rung : lvl, out = [];
    [r0 - 1, r0, r0 + 1].forEach(function (r) {
      if (r < 0 || r > max) return;
      out.push({ rung: r, label: HF.catalog.levelLabel(id, r), predicted: pred(d, id, r), current: r === lvl });
    });
    return out;
  }
  function table(d, id) {
    var out = [];
    for (var r = 0; r <= HF.catalog.maxRung(id); r++) out.push({ rung: r, label: HF.catalog.levelLabel(id, r), predicted: pred(d, id, r) });
    return out;
  }

  var api = { suggest: suggest, options: options, table: table, freeTracks: freeTracks };
  HF.coach = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
