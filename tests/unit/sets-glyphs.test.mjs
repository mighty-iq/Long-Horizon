// Glyph families, checked independently of the generator: everything below works from the SVG path strings
// (own parser + rasterizer), not from the generator's lattice data.
//   • 9 families × 8 glyphs, valid paths inside the 0 0 100 100 viewBox, deterministic across processes
//   • pairwise distinct under ANY rotation, mirror, scale and translation (chamfer distance after normalising;
//     the detector itself is validated on rotated/mirrored/scaled copies)
//   • easy to tell apart at 64 px: pixel difference ≥ threshold under all 8 square symmetries
//   • similar complexity within a family (ink at 64 px); families separable by simple visual features
// HF_VERBOSE=1 prints the measured margins.
import { HF, load, ROOT } from './load.mjs';
import { execFileSync } from 'node:child_process';
load('js/content/sets.js');

const FAMS = ['glyphsA', 'glyphsB', 'glyphsC', 'glyphsD', 'glyphsE', 'glyphsF', 'glyphsG', 'glyphsH', 'glyphsLab'];
const VERBOSE = !!process.env.HF_VERBOSE;
const PX = 64;

// ── SVG path parsing (absolute M L A C Z, as produced by sets.js) ──
function parsePath(d) {
  const toks = d.match(/[MLACZ]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cmd = null, cur = null, pos = [0, 0], start = [0, 0];
  const subs = [], num = () => { const v = parseFloat(toks[i++]); if (!isFinite(v)) throw new Error('bad number in ' + d); return v; };
  while (i < toks.length) {
    if (/^[MLACZ]$/.test(toks[i])) {
      cmd = toks[i++];
      if (cmd === 'Z') { if (!cur) throw new Error('Z before M'); cur.segs.push({ t: 'L', from: pos, to: start, close: true }); cur.closed = true; pos = start; continue; }
    }
    if (cmd === 'M') { const p = [num(), num()]; cur = { segs: [], closed: false }; subs.push(cur); pos = start = p; cmd = 'L'; continue; }
    if (!cur) throw new Error('path must start with M');
    if (cmd === 'L') { const p = [num(), num()]; cur.segs.push({ t: 'L', from: pos, to: p }); pos = p; }
    else if (cmd === 'A') { const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), p = [num(), num()]; cur.segs.push({ t: 'A', from: pos, to: p, rx, ry, rot, large, sweep }); pos = p; }
    else if (cmd === 'C') { const c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()]; cur.segs.push({ t: 'C', from: pos, c1, c2, to: p }); pos = p; }
    else throw new Error('unexpected token ' + toks[i]);
  }
  return subs;
}
function arcPts(s, step) { // SVG endpoint → centre parameterisation (SVG 1.1 F.6.5)
  let [x1, y1] = s.from, [x2, y2] = s.to, rx = Math.abs(s.rx), ry = Math.abs(s.ry);
  const ph = s.rot * Math.PI / 180, cp = Math.cos(ph), sp = Math.sin(ph), dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cp * dx + sp * dy, yp = -sp * dx + cp * dy, lam = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const nu = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, de = rx * rx * yp * yp + ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, nu / de)); if (s.large === s.sweep) co = -co;
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx, cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI; else if (s.sweep && dt < 0) dt += 2 * Math.PI;
  const k = Math.max(2, Math.ceil(Math.abs(dt) * Math.max(rx, ry) / step)), out = [];
  for (let j = 0; j <= k; j++) { const a = th + dt * j / k; out.push([cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp]); }
  return { pts: out, r: Math.max(rx, ry), sweepAbs: Math.abs(dt) };
}
function bezPts(s, step) {
  const P = [s.from, s.c1, s.c2, s.to], approx = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) + Math.hypot(s.c1[0] - s.from[0], s.c1[1] - s.from[1]) + Math.hypot(s.to[0] - s.c2[0], s.to[1] - s.c2[1]);
  const k = Math.max(4, Math.ceil(approx / step)), out = [];
  for (let j = 0; j <= k; j++) {
    const u = j / k, a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, c = 3 * u * u * (1 - u), e = u ** 3;
    out.push([a * P[0][0] + b * P[1][0] + c * P[2][0] + e * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + e * P[3][1]]);
  }
  return out;
}
// polylines with per-piece kind: 'line', 'curve', 'dot' (a full circle of radius ≤ 6)
function geometry(d, step = 1.5) {
  const subs = parsePath(d), pieces = [];
  let dots = 0;
  for (const sp of subs) {
    const arcs = sp.segs.filter(s => s.t === 'A').map(s => arcPts(s, step));
    const isDot = sp.closed && sp.segs.every(s => s.t === 'A' || s.close) && arcs.length && arcs.every(a => a.r <= 6) && Math.abs(arcs.reduce((x, a) => x + a.sweepAbs, 0) - 2 * Math.PI) < 1e-3;
    if (isDot) dots++;
    let ai = 0;
    for (const s of sp.segs) {
      if (s.t === 'L') { if (Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) > 1e-9) pieces.push({ kind: isDot ? 'dot' : 'line', pts: [s.from, s.to], close: !!s.close }); }
      else if (s.t === 'A') pieces.push({ kind: isDot ? 'dot' : 'curve', pts: arcs[ai++].pts });
      else pieces.push({ kind: 'curve', pts: bezPts(s, step) });
    }
  }
  return { subs, pieces, dots };
}
const segLen = p => { let L = 0; for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]); return L; };
function inkPoints(pieces, step = 1.5) { // points every `step` units along all strokes
  const out = [];
  for (const p of pieces) for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1], b = p.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    if (i === p.pts.length - 1) out.push(b.slice());
  }
  return out;
}
// ── rasterising at 64 px ──
function rasterize(d, style) {
  const g = geometry(d, 1), bm = new Uint8Array(PX * PX), sc = 100 / PX;
  if (style.fill) { // polygons from sampled outlines (arcs and curves included)
    const polys = g.subs.map(sp => {
      const out = [];
      for (const x of sp.segs) {
        if (x.t === 'L') out.push(x.from);
        else if (x.t === 'A') out.push(...arcPts(x, 1).pts.slice(0, -1));
        else out.push(...bezPts(x, 1).slice(0, -1));
      }
      return out;
    });
    for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) { // SVG's default nonzero winding rule
      const px = (x + 0.5) * sc, py = (y + 0.5) * sc;
      let wind = 0;
      for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[j], [xj, yj] = poly[i];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) wind += yj > yi ? 1 : -1;
      }
      if (wind !== 0) bm[y * PX + x] = 1;
    }
    return { bm, geo: g };
  }
  const segs = [];
  for (const p of g.pieces) for (let i = 1; i < p.pts.length; i++) segs.push([p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]]);
  const r2 = (style.strokeWidth / 2) ** 2;
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
    const px = (x + 0.5) * sc, py = (y + 0.5) * sc;
    for (const [ax, ay, bx, by] of segs) {
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const u = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      const dx = ax + u * vx - px, dy = ay + u * vy - py;
      if (dx * dx + dy * dy <= r2) { bm[y * PX + x] = 1; break; }
    }
  }
  return { bm, geo: g };
}
const D4 = [(x, y) => [x, y], (x, y) => [PX - 1 - y, x], (x, y) => [PX - 1 - x, PX - 1 - y], (x, y) => [y, PX - 1 - x],
  (x, y) => [PX - 1 - x, y], (x, y) => [x, PX - 1 - y], (x, y) => [y, x], (x, y) => [PX - 1 - y, PX - 1 - x]];
function pixelDistance(a, b) { // min over the 8 square symmetries of |A xor T(B)| / |A or T(B)|
  let best = 1;
  for (const T of D4) {
    let x = 0, u = 0;
    for (let yy = 0; yy < PX; yy++) for (let xx = 0; xx < PX; xx++) {
      const [tx, ty] = T(xx, yy), va = a[ty * PX + tx], vb = b[yy * PX + xx];
      if (va || vb) { u++; if (va !== vb) x++; }
    }
    best = Math.min(best, u ? x / u : 0);
  }
  return best;
}
function components(bm) {
  const seen = new Uint8Array(PX * PX); let n = 0;
  for (let s = 0; s < PX * PX; s++) {
    if (!bm[s] || seen[s]) continue;
    n++; const st = [s]; seen[s] = 1;
    while (st.length) {
      const c = st.pop(), x = c % PX, y = (c / PX) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= PX || Y >= PX) continue;
        const k = Y * PX + X; if (bm[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
  }
  return n;
}
// ── similarity-invariant shape distance (chamfer, after centring and scaling to unit RMS radius) ──
const G = 88, R = 2.4;
function normalise(pts) {
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  let s = 0; for (const p of pts) s += (p[0] - cx) ** 2 + (p[1] - cy) ** 2; s = Math.sqrt(s / pts.length);
  return pts.map(p => [(p[0] - cx) / s, (p[1] - cy) / s]);
}
function field(pts) {
  const f = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -R + (i + 0.5) * 2 * R / G, y = -R + (j + 0.5) * 2 * R / G; let m = Infinity;
    for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < m) m = d; }
    f[j * G + i] = Math.sqrt(m);
  }
  return f;
}
function look(f, x, y) {
  const i = Math.floor((x + R) * G / (2 * R)), j = Math.floor((y + R) * G / (2 * R));
  if (i < 0 || j < 0 || i >= G || j >= G) return 1;
  return f[j * G + i];
}
function shapeDistance(A, B) { // A, B: { pts (normalised), f (field) } → min over rotation (2°) × mirror of the symmetric mean distance
  let best = Infinity;
  for (let mir = 0; mir < 2; mir++) for (let deg = 0; deg < 360; deg += 2) {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    let fw = 0, bw = 0;
    for (const [x0, y] of A.pts) { const x = mir ? -x0 : x0; fw += look(B.f, c * x - s * y, s * x + c * y); }
    for (const [x, y] of B.pts) { const ix = c * x + s * y, iy = -s * x + c * y; bw += look(A.f, mir ? -ix : ix, iy); }
    const v = Math.max(fw / A.pts.length, bw / B.pts.length);
    if (v < best) best = v;
  }
  return best;
}

export default async function (t) {
  const S = HF.sets, data = {};
  for (const id of FAMS) {
    const style = S.glyphStyle(id), glyphs = [];
    for (let i = 0; i < 8; i++) {
      const d = S.glyphPath(id, i), r = rasterize(d, style);
      const pts = style.fill ? (() => { const o = []; for (let k = 0; k < PX * PX; k++) if (r.bm[k]) o.push([(k % PX + 0.5) * 100 / PX, ((k / PX) | 0) * 100 / PX]); return o; })() : inkPoints(r.geo.pieces);
      const np = normalise(pts);
      glyphs.push({ d, bm: r.bm, geo: r.geo, ink: r.bm.reduce((a, b) => a + b, 0), shape: { pts: np, f: field(np) } });
    }
    data[id] = { style, glyphs };
  }

  await t.test('glyphs: 9 families × 8 valid paths inside the viewBox; out-of-range indices give null', () => {
    for (const id of FAMS) {
      t.eq(data[id].glyphs.length, 8);
      for (const g of data[id].glyphs) {
        t.ok(/^M/.test(g.d) && g.d.length < 2000, id + ' path');
        const sw = data[id].style.fill ? 0 : data[id].style.strokeWidth / 2;
        for (const p of g.geo.pieces) for (const [x, y] of p.pts) t.ok(x - sw >= 2 && x + sw <= 98 && y - sw >= 2 && y + sw <= 98, id + ' point inside the box: ' + x + ',' + y);
        t.ok(g.ink > 120, id + ' visible ink');
      }
      t.eq(new Set(data[id].glyphs.map(g => g.d)).size, 8, id + ' distinct strings');
      t.eq(S.glyphPath(id, 8), null);
      t.ok(S.glyphSvg(id, 0, 64).startsWith('<svg'), id + ' svg');
    }
    t.eq(S.glyphPath('letters', 0), null);
  });

  await t.test('glyphs: deterministic across processes', () => {
    const here = FAMS.map(id => [0, 1, 2, 3, 4, 5, 6, 7].map(i => S.glyphPath(id, i)).join('|')).join('#');
    const code = `require(${JSON.stringify(ROOT + '/js/core/rng.js')});require(${JSON.stringify(ROOT + '/js/content/sets.js')});` +
      `const S=globalThis.HF.sets;process.stdout.write(${JSON.stringify(FAMS)}.map(id=>[0,1,2,3,4,5,6,7].map(i=>S.glyphPath(id,i)).join('|')).join('#'));`;
    const other = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    t.ok(other === here, 'glyph paths differ between processes');
  });

  await t.test('glyphs: canonical forms (generator side) are pairwise distinct', () => {
    for (const id of FAMS) {
      const info = S.glyphInfo(id);
      t.eq(new Set(info.canon).size, 8, id);
    }
  });

  await t.test('glyphs: the shape-distance detector finds rotated, mirrored and scaled copies', () => {
    for (const id of FAMS) {
      const g = data[id].glyphs[3], ang = 37 * Math.PI / 180;
      const moved = g.shape.pts.map(([x, y]) => [-(Math.cos(ang) * x - Math.sin(ang) * y) * 1.7 + 0.3, (Math.sin(ang) * x + Math.cos(ang) * y) * 1.7 - 0.2]);
      const np = normalise(moved), copy = { pts: np, f: field(np) };
      t.ok(shapeDistance(g.shape, copy) < 0.03, id + ' copy not detected: ' + shapeDistance(g.shape, copy));
    }
  });

  const margins = {};
  await t.test('glyphs: pairwise distinct under any rotation, mirror and scale (shape distance ≥ 0.05; copies < 0.03)', () => {
    for (const id of FAMS) {
      let min = Infinity, pair = null;
      const gl = data[id].glyphs;
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
        const d = shapeDistance(gl[a].shape, gl[b].shape);
        if (d < min) { min = d; pair = [a, b]; }
      }
      margins[id] = { shape: min, shapePair: pair };
    }
    const bad = FAMS.filter(id => margins[id].shape < 0.05);
    t.ok(!bad.length, bad.map(id => `${id}: glyphs ${margins[id].shapePair} too similar (shape distance ${margins[id].shape.toFixed(3)})`).join('; '));
  });

  await t.test('glyphs: easy to tell apart at 64 px (≥ 30 % of the ink differs under all square symmetries)', () => {
    for (const id of FAMS) {
      let min = 1, pair = null;
      const gl = data[id].glyphs;
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
        const d = pixelDistance(gl[a].bm, gl[b].bm);
        if (d < min) { min = d; pair = [a, b]; }
      }
      margins[id].pixel = min; margins[id].pixelPair = pair;
    }
    const bad = FAMS.filter(id => margins[id].pixel < 0.30);
    t.ok(!bad.length, bad.map(id => `${id}: glyphs ${margins[id].pixelPair} differ by only ${(margins[id].pixel * 100).toFixed(0)} % of their ink at 64 px`).join('; '));
  });

  await t.test('glyphs: similar complexity within each family (ink at 64 px within ×1.5)', () => {
    for (const id of FAMS) {
      const ink = data[id].glyphs.map(g => g.ink), r = Math.max(...ink) / Math.min(...ink);
      margins[id].inkRatio = r;
      t.ok(r <= 1.5, id + ' ink ratio ' + r.toFixed(2));
    }
  });

  await t.test('glyphs: families look different (each has its own visual vocabulary)', () => {
    // signature = paint | curve type | dots | straight-line angle class | pieces | long horizontal spine
    const sig = (id, g) => {
      const ps = g.geo.pieces, has = k => ps.some(p => p.kind === k);
      const curves = g.geo.subs.some(sp => sp.segs.some(x => x.t === 'C')) ? 'bezier' : (has('curve') ? 'arc' : 'none');
      let d45 = false, d60 = false, longH = false;
      for (const p of ps) if (p.kind === 'line' && !p.close) {
        const a = (Math.atan2(p.pts[1][1] - p.pts[0][1], p.pts[1][0] - p.pts[0][0]) * 180 / Math.PI + 180) % 180, L = segLen(p);
        if (Math.abs(a - 45) < 3 || Math.abs(a - 135) < 3) d45 = true;
        if ([30, 60, 120, 150].some(x => Math.abs(a - x) < 3)) d60 = true;
        if ((a < 3 || a > 177) && L >= 60) longH = true;
      }
      const lines = curves === 'none' && g.geo.dots === 0 ? (d45 ? 'd45' : d60 ? 'd60' : 'hv') : '-';
      return [data[id].style.fill ? 'fill' : 'stroke', data[id].style.fill ? '-' : curves, g.geo.dots, data[id].style.fill ? '-' : lines,
        components(g.bm) > 1 ? 'pieces' : 'one', longH ? 'spine' : '-'].join('|');
    };
    const famSig = {};
    for (const id of FAMS) {
      const sigs = new Set(data[id].glyphs.map(g => sig(id, g)));
      if (VERBOSE) console.log('  ' + id.padEnd(10), [...sigs].join(' / '));
      t.eq(sigs.size, 1, id + ' glyphs do not share one vocabulary: ' + [...sigs].join(' / '));
      famSig[id] = [...sigs][0];
    }
    t.eq(new Set(Object.values(famSig)).size, FAMS.length, 'two families share a vocabulary: ' + JSON.stringify(famSig));
  });

  await t.test('glyphs: the 8 filled shapes have distinct outlines (shape distance ≥ 0.05) and differ at 64 px', () => {
    const names = S.get('shapes').items.map(it => it.shape);
    const sh = names.map(nm => {
      const d = S.shapePath(nm), bm = rasterize(d, { fill: true }).bm, np = normalise(inkPoints(geometry(d, 1).pieces, 1));
      return { bm, ink: bm.reduce((a, x) => a + x, 0), shape: { pts: np, f: field(np) } };
    });
    for (const x of sh) t.ok(x.ink > 500, 'shape ink');
    let minS = Infinity, minP = 1, ps = '', pp = '';
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const ds = shapeDistance(sh[a].shape, sh[b].shape), dp = pixelDistance(sh[a].bm, sh[b].bm);
      if (ds < minS) { minS = ds; ps = names[a] + '/' + names[b]; }
      if (dp < minP) { minP = dp; pp = names[a] + '/' + names[b]; }
    }
    if (VERBOSE) console.log('  shapes: min outline distance', ps, minS.toFixed(3), '· min pixel difference', pp, minP.toFixed(3));
    t.ok(minS >= 0.05, 'shape outlines too alike: ' + ps + ' ' + minS.toFixed(3));
    t.ok(minP >= 0.15, 'shapes too alike at 64 px: ' + pp + ' ' + minP.toFixed(3));
  });

  if (VERBOSE) for (const id of FAMS) { const m = margins[id] || {}; console.log('  ' + id.padEnd(10), 'shape', (m.shape || 0).toFixed(3), 'pixel', (m.pixel || 0).toFixed(3), 'ink ratio', (m.inkRatio || 0).toFixed(2)); }
}
