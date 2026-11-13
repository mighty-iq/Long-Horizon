/* Long-Horizon — statistics helpers (pure). MIT licence. */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function nums(arr) { return (arr || []).filter(isNum); }

  function sum(arr) { var s = 0; arr = nums(arr); for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function mean(arr) { arr = nums(arr); return arr.length ? sum(arr) / arr.length : NaN; }
  function variance(arr) {
    arr = nums(arr); if (arr.length < 2) return NaN;
    var m = mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return s / (arr.length - 1);
  }
  function sd(arr) { return Math.sqrt(variance(arr)); }
  function quantile(arr, q) {
    arr = nums(arr).slice().sort(function (a, b) { return a - b; });
    if (!arr.length) return NaN;
    var pos = (arr.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  }
  function median(arr) { return quantile(arr, 0.5); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function logistic(x) { return 1 / (1 + Math.exp(-x)); }
  function logit(p) { p = clamp(p, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); }

  /* Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf) */
  function normCdf(z) {
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  /* Inverse standard normal CDF (Acklam's rational approximation, |rel err| < 1.2e-9) */
  function normInv(p) {
    if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /**
   * Signal-detection summary for one stream.
   * hits/misses over targets; fas/crs over non-targets.
   * d′ and criterion use the log-linear correction (Hautus 1995): (count + 0.5) / (n + 1).
   * Balanced accuracy (BA) uses raw rates: (hitRate + crRate) / 2.
   * If a stream has no targets, BA = crRate; if no non-targets, BA = hitRate.
   */
  function sdt(hits, misses, fas, crs) {
    var nT = hits + misses, nN = fas + crs;
    var hitRate = nT ? hits / nT : NaN;
    var faRate = nN ? fas / nN : NaN;
    var crRate = nN ? crs / nN : NaN;
    var ba;
    if (nT && nN) ba = (hitRate + crRate) / 2;
    else if (nT) ba = hitRate;
    else if (nN) ba = crRate;
    else ba = NaN;
    var hC = (hits + 0.5) / (nT + 1), fC = (fas + 0.5) / (nN + 1);
    var zH = normInv(hC), zF = normInv(fC);
    return {
      hits: hits, misses: misses, fas: fas, crs: crs, nTargets: nT, nNonTargets: nN,
      hitRate: hitRate, faRate: faRate, crRate: crRate, ba: ba,
      dprime: zH - zF, criterion: -0.5 * (zH + zF),
      y: isNum(hitRate) && isNum(faRate) ? Math.max(0, hitRate - faRate) : (isNum(ba) ? Math.max(0, 2 * ba - 1) : NaN)
    };
  }

  /** Jacobson & Truax reliable change index. sd = baseline SD, r = test–retest reliability. */
  function rci(x1, x2, sdBase, r) {
    if (!isNum(x1) || !isNum(x2) || !(sdBase > 0) || !(r < 1)) return NaN;
    var sem = sdBase * Math.sqrt(1 - r);
    var sdiff = Math.sqrt(2 * sem * sem);
    return (x2 - x1) / sdiff;
  }

  /** Least-squares slope of y on x (x defaults to 0..n-1). */
  function slope(ys, xs) {
    var n = ys.length; if (n < 2) return NaN;
    xs = xs || ys.map(function (_, i) { return i; });
    var mx = mean(xs), my = mean(ys), num = 0, den = 0;
    for (var i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    return den ? num / den : NaN;
  }

  /** Exponential moving average series (alpha in (0,1]). */
  function ema(ys, alpha) {
    var out = [], m = NaN;
    for (var i = 0; i < ys.length; i++) {
      if (!isNum(ys[i])) { out.push(m); continue; }
      m = isNum(m) ? alpha * ys[i] + (1 - alpha) * m : ys[i];
      out.push(m);
    }
    return out;
  }

  function zscore(x, m, s) { return s > 0 ? (x - m) / s : NaN; }
  function round(x, dp) { var f = Math.pow(10, dp || 0); return Math.round(x * f) / f; }

  var api = {
    isNum: isNum, sum: sum, mean: mean, variance: variance, sd: sd, quantile: quantile, median: median,
    clamp: clamp, logistic: logistic, logit: logit, normCdf: normCdf, normInv: normInv,
    sdt: sdt, rci: rci, slope: slope, ema: ema, zscore: zscore, round: round
  };
  HF.stats = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
