/* Marketing Cloud - MC.util (hashing, canonical form, math helpers) and MC.fmt
   (locale-independent formatters). No Date, Intl or Math.random anywhere in this file. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var U = MC.util = MC.util || {};
  var fmt = MC.fmt = MC.fmt || {};

  /* ---------------- hashing ---------------- */
  U.fnv1a = function (str, h) {
    var s = String(str);
    h = (h === undefined ? 0x811c9dc5 : h) >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  U.fnvBytes = function (arr, h) {
    h = (h === undefined ? 0x811c9dc5 : h) >>> 0;
    var b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (var i = 0; i < b.length; i++) {
      h ^= b[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  U.hex8 = function (u32) {
    var s = (u32 >>> 0).toString(16);
    return '00000000'.slice(s.length) + s;
  };

  function isTyped(v) {
    return ArrayBuffer.isView(v) && !(v instanceof DataView);
  }
  U.isTyped = isTyped;

  function canonNum(x) {
    if (x !== x) return '"NaN"';
    if (x === Infinity) return '"Inf"';
    if (x === -Infinity) return '"-Inf"';
    if (Number.isInteger(x)) return String(x === 0 ? 0 : x);
    var s = x.toPrecision(12);
    var e = '';
    var k = s.indexOf('e');
    if (k >= 0) { e = s.slice(k); s = s.slice(0, k); }
    if (s.indexOf('.') >= 0) {
      s = s.replace(/0+$/, '');
      if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    }
    return s + e;
  }

  function canon(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') return canonNum(v);
    if (t === 'string') return JSON.stringify(v);
    if (t === 'function') return 'null';
    if (isTyped(v)) return JSON.stringify('#' + U.hex8(U.fnvBytes(v)) + ':' + v.length);
    if (Array.isArray(v)) {
      var out = new Array(v.length);
      for (var i = 0; i < v.length; i++) out[i] = canon(v[i]);
      return '[' + out.join(',') + ']';
    }
    var keys = Object.keys(v).sort();
    var parts = [];
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      if (key.charAt(0) === '_') continue;
      var val = v[key];
      if (val === undefined || typeof val === 'function') continue;
      parts.push(JSON.stringify(key) + ':' + canon(val));
    }
    return '{' + parts.join(',') + '}';
  }
  U.canon = canon;
  U.digest = function (v) { return U.hex8(U.fnv1a(canon(v))); };

  /* ---------------- timing (UI text and _ms fields only) ---------------- */
  U.now = function () {
    return (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : 0;
  };

  /* ---------------- math ---------------- */
  U.clamp = function (x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.sigmoid = function (x) {
    if (x >= 0) { var z = Math.exp(-x); return 1 / (1 + z); }
    var e = Math.exp(x); return e / (1 + e);
  };
  U.logit = function (p) {
    var q = U.clamp(p, 1e-9, 1 - 1e-9);
    return Math.log(q / (1 - q));
  };
  U.round = function (x, dp) {
    var m = Math.pow(10, dp || 0);
    return Math.round(x * m) / m;
  };
  U.sum = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; };
  U.mean = function (a) { return a.length ? U.sum(a) / a.length : 0; };
  U.sd = function (a) {
    if (a.length < 2) return 0;
    var m = U.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  };
  U.quantile = function (sorted, q) {
    if (!sorted.length) return 0;
    var pos = (sorted.length - 1) * U.clamp(q, 0, 1);
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  U.argmax = function (a) {
    var best = -1, bv = -Infinity;
    for (var i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; best = i; }
    return best;
  };

  // Stable sort; ties broken by .id (string compare), then by original index.
  U.stableSort = function (arr, cmp) {
    var idx = arr.map(function (v, i) { return { v: v, i: i }; });
    idx.sort(function (a, b) {
      var c = cmp(a.v, b.v);
      if (c) return c;
      var ia = a.v && a.v.id, ib = b.v && b.v.id;
      if (ia !== undefined && ib !== undefined && ia !== ib) return String(ia) < String(ib) ? -1 : 1;
      return a.i - b.i;
    });
    return idx.map(function (x) { return x.v; });
  };

  U.shallowEqual = function (a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return U.arrayEqual(a, b);
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !Object.is(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  };
  U.arrayEqual = function (a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  };
  U.deepEqual = function (a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return canon(a) === canon(b);
  };
  // Deep copy of plain JSON-like data (typed arrays are copied, functions dropped).
  U.clone = function (v) {
    if (v === null || typeof v !== 'object') return v;
    if (isTyped(v)) return v.slice();
    if (Array.isArray(v)) return v.map(U.clone);
    var o = {};
    Object.keys(v).forEach(function (k) { if (typeof v[k] !== 'function') o[k] = U.clone(v[k]); });
    return o;
  };

  // Abramowitz-Stegun 7.1.26
  U.normCdf = function (z) {
    var x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  };

  U.wilson = function (k, n, z) {
    if (z === undefined) z = 1.96;
    if (!n) return [0, 0];
    var p = k / n, z2 = z * z;
    var den = 1 + z2 / n;
    var c = (p + z2 / (2 * n)) / den;
    var h = z * Math.sqrt(Math.max(0, p * (1 - p) / n + z2 / (4 * n * n))) / den;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  };

  // Single-slot memo keyed by keyFn(args) (default: canon of args).
  U.memo = function (fn, keyFn) {
    var lastKey, lastVal, has = false;
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var key = keyFn ? keyFn.apply(null, args) : canon(args);
      if (has && key === lastKey) return lastVal;
      lastVal = fn.apply(null, args); lastKey = key; has = true;
      return lastVal;
    };
  };

  // world.rev[k]++ on the GIVEN world (sim/models/runtime/reducers).
  U.bump = function (world) {
    if (!world) return;
    if (!world.rev) world.rev = { profiles: 0, metrics: 0, enroll: 0, segCounts: 0 };
    for (var i = 1; i < arguments.length; i++) {
      var k = arguments[i];
      world.rev[k] = (world.rev[k] || 0) + 1;
    }
  };

  /* ---------------- formatters (locale-independent) ---------------- */
  var MID = ' · ';
  var DASH = '–';
  var MINUS = '-';

  function bad(n) { return n === null || n === undefined || typeof n !== 'number' || n !== n; }

  function groupInt(s) {
    // s: digits only
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i && (s.length - i) % 3 === 0) out += ',';
      out += s.charAt(i);
    }
    return out;
  }

  // Fixed decimals with thousands separators, no sign.
  function fixedAbs(a, dp) {
    var s = a.toFixed(dp);
    var k = s.indexOf('.');
    var ip = k >= 0 ? s.slice(0, k) : s;
    var fp = k >= 0 ? s.slice(k) : '';
    return groupInt(ip) + fp;
  }

  function trimZeros(s) {
    if (s.indexOf('.') < 0) return s;
    s = s.replace(/0+$/, '');
    return s.charAt(s.length - 1) === '.' ? s.slice(0, -1) : s;
  }

  // Compact body for |n|: 950 -> "950", 12400 -> "12.4k", 412000 -> "412k", 1.86e6 -> "1.86M"
  function compactAbs(a) {
    if (a >= 1e9) return trimZeros((a / 1e9).toFixed(a >= 1e11 ? 0 : 1)) + 'B';
    if (a >= 1e6) return trimZeros((a / 1e6).toFixed(a >= 1e8 ? 0 : (a >= 1e7 ? 1 : 2))) + 'M';
    if (a >= 1e3) {
      var k = a / 1e3;
      if (k >= 999.5) return trimZeros((a / 1e6).toFixed(2)) + 'M';
      return trimZeros(k.toFixed(k >= 100 ? 0 : 1)) + 'k';
    }
    return String(Math.round(a));
  }

  fmt.money = function (n, o) {
    if (bad(n)) return '—';
    o = o || {};
    var neg = n < 0 && Math.abs(n) >= (o.cents ? 0.005 : 0.5);
    var a = Math.abs(n);
    var body = o.compact ? compactAbs(a) : fixedAbs(a, o.cents ? 2 : 0);
    var sign = neg ? MINUS : (o.sign && n > 0 ? '+' : '');
    return sign + '$' + body;
  };

  fmt.num = function (n, o) {
    if (bad(n)) return '—';
    o = o || {};
    var dp = o.dp || 0;
    var a = Math.abs(n);
    var neg = n < 0 && a >= 0.5 * Math.pow(10, -dp);
    var body = o.compact ? compactAbs(a) : fixedAbs(a, dp);
    return (neg ? MINUS : (o.sign && n > 0 ? '+' : '')) + body;
  };

  fmt.pct = function (p, dp) {
    if (bad(p)) return '—';
    if (dp === undefined) dp = 1;
    var v = p * 100;
    var s = Math.abs(v).toFixed(dp);
    var neg = v < 0 && Number(s) !== 0;
    return (neg ? MINUS : '') + s + '%';
  };

  fmt.pp = function (d) {
    if (bad(d)) return '—';
    var v = d * 100;
    var s = Math.abs(v).toFixed(1);
    var z = Number(s) === 0;
    return (z ? '' : (v > 0 ? '+' : MINUS)) + s + ' pp';
  };

  fmt.delta = function (r, dp) {
    if (bad(r)) return '—';
    if (dp === undefined) dp = 1;
    var v = r * 100;
    var s = Math.abs(v).toFixed(dp);
    var z = Number(s) === 0;
    return (z ? '' : (v > 0 ? '+' : MINUS)) + s + '%';
  };

  fmt.ratio = function (x, dp) {
    if (bad(x)) return '—';
    if (!isFinite(x)) return '—';
    return x.toFixed(dp === undefined ? 1 : dp) + '×';
  };

  fmt.range = function (lo, hi, f) {
    f = f || function (v) { return fmt.money(v, { compact: true }); };
    return f(lo) + DASH + f(hi);
  };

  /* ---------------- sim-time formatters (MC.time looked up at call time) ---------------- */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function cal(day) {
    if (MC.time && typeof MC.time.calendar === 'function') return MC.time.calendar(day);
    return { y: 2026, m: 11, d: 7 + day, dow: ((day + 6) % 7 + 7) % 7 };
  }
  function dayOf(t) { return Math.floor(t / 24); }
  function hourOf(t) { return ((t % 24) + 24) % 24; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  fmt.dayLabel = function (day) {          // "Sat, Nov 7"
    var c = cal(day);
    return DOW[c.dow] + ', ' + MON[c.m - 1] + ' ' + c.d;
  };
  fmt.dayShort = function (day) {          // "Nov 7"
    var c = cal(day);
    return MON[c.m - 1] + ' ' + c.d;
  };
  fmt.date = function (tick) { return bad(tick) ? '—' : fmt.dayLabel(dayOf(tick)); };
  fmt.time = function (tick) { return bad(tick) ? '—' : pad2(hourOf(tick)) + ':00'; };
  fmt.stamp = function (tick) { return bad(tick) ? '—' : fmt.dayShort(dayOf(tick)) + MID + fmt.time(tick); };
  fmt.clock = function (tick) { return bad(tick) ? '—' : fmt.date(tick) + MID + fmt.time(tick); };

  fmt.rel = function (fromTick, nowTick) {
    if (bad(fromTick) || bad(nowTick)) return '—';
    var d = nowTick - fromTick;
    var a = Math.abs(d);
    if (a === 0) return 'just now';
    var body = a < 24 ? a + 'h' : Math.floor(a / 24) + 'd';
    return d > 0 ? body + ' ago' : 'in ' + body;
  };

  fmt.hour = function (h) {
    if (bad(h)) return '—';
    var x = ((Math.round(h) % 24) + 24) % 24;
    var h12 = x % 12 === 0 ? 12 : x % 12;
    return h12 + (x < 12 ? ' am' : ' pm');
  };

})();
