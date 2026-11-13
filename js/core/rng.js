/* Long-Horizon — seeded random numbers (pure). sfc32 seeded from a cyrb128 string hash.
   Every block stores its seed, so any sequence can be regenerated and checked. MIT licence. */
(function (root) {
  'use strict';
  var HF = root.HF || (root.HF = {});

  function cyrb128(str) {
    var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (var i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ (b >>> 9);
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  /** create(seed) → generator. Same seed string → same sequence on every engine. */
  function create(seed) {
    var seedStr = String(seed);
    var h = cyrb128(seedStr);
    var next = sfc32(h[0], h[1], h[2], h[3]);
    for (var w = 0; w < 15; w++) next(); // discard the first outputs
    var r = {
      seed: seedStr,
      next: next,
      /** integer in [lo, hi], both inclusive */
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) {
        if (!arr || !arr.length) throw new Error('rng.pick: empty array');
        return arr[Math.floor(next() * arr.length)];
      },
      /** returns a shuffled copy (Fisher–Yates) */
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      },
      /** k distinct elements, random order */
      sample: function (arr, k) {
        if (k > arr.length) throw new Error('rng.sample: k > length');
        return r.shuffle(arr).slice(0, k);
      },
      chance: function (p) { return next() < p; },
      weighted: function (items, weights) {
        var total = 0, i;
        for (i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
        if (total <= 0) return r.pick(items);
        var x = next() * total;
        for (i = 0; i < items.length; i++) {
          x -= Math.max(0, weights[i]);
          if (x < 0) return items[i];
        }
        return items[items.length - 1];
      },
      /** an independent generator derived from this seed and a label */
      fork: function (label) { return create(seedStr + '/' + label); }
    };
    return r;
  }

  /** A fresh, non-deterministic seed string for a new block (logged with the block). */
  function newSeed() {
    var a, b;
    try {
      var buf = new Uint32Array(2);
      (root.crypto || globalThis.crypto).getRandomValues(buf);
      a = buf[0]; b = buf[1];
    } catch (e) {
      a = Math.floor(Math.random() * 4294967296);
      b = (Date.now() >>> 0) ^ Math.floor(Math.random() * 4294967296);
    }
    return a.toString(36) + b.toString(36);
  }

  var api = { create: create, newSeed: newSeed, hash: cyrb128 };
  HF.rng = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
