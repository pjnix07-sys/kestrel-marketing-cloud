/* Marketing Cloud - MC.rng: seeded sfc32 generators and keyed forks.
   Every random draw in the simulation, agents and data generation comes from here. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var R = MC.rng = MC.rng || {};

  var TWO32 = 4294967296;
  var TWO_PI = 2 * Math.PI;

  function Rng(seed) {
    var s = seed >>> 0;
    var st = new Array(4);
    for (var i = 0; i < 4; i++) {
      // splitmix32
      s = (s + 0x9e3779b9) | 0;
      var z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      z ^= z >>> 16;
      st[i] = z >>> 0;
    }
    this.a = st[0]; this.b = st[1]; this.c = st[2]; this.d = st[3];
    this.seed = seed >>> 0;
    for (var w = 0; w < 12; w++) this.next();
  }

  var P = Rng.prototype;

  // sfc32 -> uint32
  P.next = function () {
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0;
    return t >>> 0;
  };

  // [0, 1)
  P.float = function () { return this.next() / TWO32; };
  // (0, 1): never exactly 0 (safe for logs)
  P.open = function () { return (this.next() + 0.5) / TWO32; };
  // integer in [0, n)
  P.int = function (n) { return Math.floor(this.float() * n); };
  // float in [a, b)
  P.range = function (a, b) { return a + (b - a) * this.float(); };

  // Box-Muller, two fresh draws per call (no cached spare).
  P.normal = function (mu, sd) {
    var u1 = this.open(), u2 = this.float();
    var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
    return (mu || 0) + (sd === undefined ? 1 : sd) * z;
  };

  // Marsaglia-Tsang; k < 1 via the boost gamma(k+1)·U^(1/k).
  P.gamma = function (k) {
    if (!(k > 0)) return 0;
    if (k < 1) {
      var g = this.gamma(k + 1);
      return g * Math.pow(this.open(), 1 / k);
    }
    var d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (var it = 0; it < 1000; it++) {
      var x = this.normal(0, 1);
      var v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      var u = this.open();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return d;
  };

  P.beta = function (a, b) {
    var x = this.gamma(a), y = this.gamma(b);
    var s = x + y;
    return s > 0 ? x / s : 0.5;
  };

  P.bernoulli = function (p) { return this.float() < p; };

  P.binomial = function (n, p) {
    n = Math.max(0, Math.floor(n));
    if (n === 0 || !(p > 0)) return 0;
    if (p >= 1) return n;
    if (n <= 40) {
      var k = 0;
      for (var i = 0; i < n; i++) if (this.float() < p) k++;
      return k;
    }
    var x = Math.round(this.normal(n * p, Math.sqrt(n * p * (1 - p))));
    return x < 0 ? 0 : (x > n ? n : x);
  };

  P.poisson = function (lam) {
    if (!(lam > 0)) return 0;
    if (lam <= 30) {
      var L = Math.exp(-lam), k = 0, p = 1;
      do { k++; p *= this.float(); } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(this.normal(lam, Math.sqrt(lam))));
  };

  P.lognormal = function (mu, sd) { return Math.exp(this.normal(mu, sd)); };

  P.pick = function (arr) { return arr.length ? arr[this.int(arr.length)] : undefined; };

  // Index drawn proportional to non-negative weights; -1 when every weight is <= 0.
  // Always consumes exactly one draw.
  P.weighted = function (ws) {
    var total = 0, i;
    for (i = 0; i < ws.length; i++) if (ws[i] > 0) total += ws[i];
    var u = this.float();
    if (!(total > 0)) return -1;
    var x = u * total, acc = 0, last = -1;
    for (i = 0; i < ws.length; i++) {
      if (!(ws[i] > 0)) continue;
      acc += ws[i]; last = i;
      if (x < acc) return i;
    }
    return last;
  };

  // Fisher-Yates on a copy.
  P.shuffle = function (arr) {
    var a = Array.prototype.slice.call(arr);
    for (var i = a.length - 1; i > 0; i--) {
      var j = this.int(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  // k distinct indices from [0, n) (partial Fisher-Yates), in draw order.
  P.sampleIdx = function (n, k) {
    n = Math.max(0, Math.floor(n));
    k = Math.max(0, Math.min(n, Math.floor(k)));
    var pool = new Int32Array(n);
    for (var i = 0; i < n; i++) pool[i] = i;
    var out = new Int32Array(k);
    for (var j = 0; j < k; j++) {
      var r = j + this.int(n - j);
      var t = pool[j]; pool[j] = pool[r]; pool[r] = t;
      out[j] = pool[j];
    }
    return out;
  };

  R.Rng = Rng;
  R.create = function (seed) { return new Rng(seed); };

  // fork(seed, ...keys) = create((seed ^ fnv1a(keys.map(String).join('|'))) >>> 0)
  R.fork = function (seed) {
    var keys = Array.prototype.slice.call(arguments, 1).map(String).join('|');
    var h = MC.util.fnv1a(keys);
    return new Rng(((seed >>> 0) ^ h) >>> 0);
  };
})();
