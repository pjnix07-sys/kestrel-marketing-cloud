/* Kestrel Marketing Cloud - MC.models: predictive models on visible profile attributes.
   Propensity (logistic, batch GD), churn, LTV, best channel/hour, Holt forecasts with
   prediction intervals, goal probability, EWMA anomalies, saturating response curves,
   Thompson P(best) and attribution roll-ups. Pure functions of their inputs; no clock,
   no Math.random. Columnar profile scores are written in place followed by a rev bump. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var M = MC.models = MC.models || {};

  var NF = 8;
  var Z80 = 1.2815515655446004, Z95 = 1.959963984540054;
  var FEATURE_LABELS = ['Baseline', 'Days since last order', 'Number of orders', 'Lifetime spend',
    'Engagement rate', 'Site visits (30 days)', 'Top category affinity', 'Tenure'];
  M.NF = NF;
  M.FEATURE_LABELS = FEATURE_LABELS;

  function sig(x) {
    if (x >= 0) { var e = Math.exp(-x); return 1 / (1 + e); }
    var f = Math.exp(x); return f / (1 + f);
  }
  function NEVER() { return (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999; }
  function curDay(world) { return Math.floor(world.meta.tick / 24); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function bump(world) {
    var keys = Array.prototype.slice.call(arguments, 1);
    if (MC.util && typeof MC.util.bump === 'function') { MC.util.bump.apply(null, [world].concat(keys)); return; }
    world.rev = world.rev || {};
    keys.forEach(function (k) { world.rev[k] = (world.rev[k] || 0) + 1; });
  }

  /* ---------------- per-profile features ---------------- */
  function engRateOf(P, i) {
    var s = 0, oc = 0, b = i * 9;
    for (var c = 0; c < 3; c++) { s += P.eng[b + c * 3]; oc += P.eng[b + c * 3 + 1] + P.eng[b + c * 3 + 2]; }
    return oc / (s + 5);
  }
  function recencyOf(P, i, d) {
    var lo = P.lastOrder[i];
    if (lo === NEVER()) return 365;
    var r = d - lo;
    return r < 0 ? 0 : (r > 365 ? 365 : r);
  }
  function maxAffOf(P, i) {
    var m = 0, b = i * 5;
    for (var k = 0; k < 5; k++) if (P.aff[b + k] > m) m = P.aff[b + k];
    return m;
  }
  M.engRate = function (world, i) { return engRateOf(world.profiles, i); };
  M.recency = function (world, i, d) { return recencyOf(world.profiles, i, d === undefined ? curDay(world) : d); };

  // x = [1, recency/90, ln(1+orders), ln(1+spend)/6, engRate, visits30/10, max aff, tenure/365]
  function fillFeatures(P, i, d, out, off) {
    out[off] = 1;
    out[off + 1] = recencyOf(P, i, d) / 90;
    out[off + 2] = Math.log(1 + P.orders[i]);
    out[off + 3] = Math.log(1 + Math.max(0, P.spend[i])) / 6;
    out[off + 4] = engRateOf(P, i);
    out[off + 5] = P.visits30[i] / 10;
    out[off + 6] = maxAffOf(P, i);
    out[off + 7] = Math.max(0, P.tenure[i]) / 365;
  }
  M.featuresOf = function (world, i, d) {
    var out = new Array(NF);
    fillFeatures(world.profiles, i, d === undefined ? curDay(world) : d, out, 0);
    return out;
  };
  M.featureMatrix = function (world, d) {
    var P = world.profiles, X = new Float32Array(P.n * NF);
    if (d === undefined) d = curDay(world);
    for (var i = 0; i < P.n; i++) fillFeatures(P, i, d, X, i * NF);
    return X;
  };

  /* ---------------- logistic regression (batch GD, L2 on non-intercept) ---------------- */
  M.fitLogistic = function (X, y, n, coef0, iters, lr, l2) {
    var w = new Float64Array(NF), g = new Float64Array(NF), k, i;
    if (coef0) for (k = 0; k < NF; k++) w[k] = +coef0[k] || 0;
    lr = lr === undefined ? 0.5 : lr; l2 = l2 === undefined ? 1e-3 : l2;
    if (!(n > 0)) return w;
    for (var it = 0; it < iters; it++) {
      for (k = 0; k < NF; k++) g[k] = 0;
      for (i = 0; i < n; i++) {
        var o = i * NF, z = 0;
        for (k = 0; k < NF; k++) z += w[k] * X[o + k];
        var e = sig(z) - y[i];
        for (k = 0; k < NF; k++) g[k] += e * X[o + k];
      }
      for (k = 0; k < NF; k++) w[k] -= lr * (g[k] / n + (k > 0 ? l2 * w[k] : 0));
    }
    return w;
  };

  // With warmCoef: weekly refit (15 iterations) on modelState.snap with label "ordered after snapDay",
  // then snap = current features and snapDay = today. Without: cold fit (60 iterations from zeros)
  // on the same snapshot/label. Returns the coefficient array (also stored on modelState.coef).
  M.fitPropensity = function (world, warmCoef) {
    var P = world.profiles, ms = world.modelState, n = P.n, d = curDay(world);
    if (!ms || !ms.snap || ms.snap.length !== n * NF) {
      ms = world.modelState = { coef: new Float64Array(NF), snap: M.featureMatrix(world, d), snapDay: d };
      return ms.coef;
    }
    var y = new Uint8Array(n), NV = NEVER();
    for (var i = 0; i < n; i++) y[i] = (P.lastOrder[i] !== NV && P.lastOrder[i] > ms.snapDay) ? 1 : 0;
    var coef = warmCoef ? M.fitLogistic(ms.snap, y, n, warmCoef, 15, 0.5, 1e-3)
      : M.fitLogistic(ms.snap, y, n, null, 60, 0.5, 1e-3);
    ms.coef = coef;
    if (warmCoef) { ms.snap = M.featureMatrix(world, d); ms.snapDay = d; }
    return coef;
  };

  /* ---------------- daily rescoring ---------------- */
  function smoothHist(P, i, out) {
    var b = i * 24, tot = 0;
    for (var h = 0; h < 24; h++) {
      var a = P.openHr[b + ((h + 23) % 24)], c = P.openHr[b + h], e = P.openHr[b + ((h + 1) % 24)];
      out[h] = 0.25 * a + 0.5 * c + 0.25 * e; tot += c;
    }
    return tot;
  }

  M.scoreProfiles = function (world) {
    var P = world.profiles, n = P.n, d = curDay(world);
    var coef = (world.modelState && world.modelState.coef) || new Float64Array(NF);
    var BIT = [1, 2, 4], i, c, h;
    var sumS = [0, 0, 0], sumC = [0, 0, 0];
    for (i = 0; i < n; i++) for (c = 0; c < 3; c++) { sumS[c] += P.eng[i * 9 + c * 3]; sumC[c] += P.eng[i * 9 + c * 3 + 2]; }
    var mC = [0, 1, 2].map(function (k) { return sumS[k] > 0 ? sumC[k] / sumS[k] : 0; });
    var G = new Float64Array(24), sm = new Float64Array(24), x = new Float64Array(NF), needFallback = new Uint8Array(n);
    var expo = 30 / 7;
    for (i = 0; i < n; i++) {
      fillFeatures(P, i, d, x, 0);
      var z = 0;
      for (var k = 0; k < NF; k++) z += coef[k] * x[k];
      var p7 = sig(z);
      P.prop[i] = 1 - Math.pow(1 - p7, expo);
      var rec = x[1] * 90, er = x[4];
      var churn = sig(-2.2 + 1.6 * rec / 90 - 0.5 * Math.log(1 + P.orders[i]) - 1.8 * er);
      P.churn[i] = churn;
      P.ltv[i] = P.orders[i] > 0 ? P.orders[i] * 365 / Math.max(P.tenure[i], 90) * P.aov[i] * (1 - churn) : 0;
      // best channel: Beta-smoothed click rate among consented owned channels
      var best = 255, bestV = -1;
      for (c = 0; c < 3; c++) {
        if (!(P.consent[i] & BIT[c]) || (P.unsub[i] & BIT[c])) continue;
        var v = (P.eng[i * 9 + c * 3 + 2] + 20 * mC[c]) / (P.eng[i * 9 + c * 3] + 20);
        if (v > bestV) { bestV = v; best = c; }
      }
      P.bestCh[i] = best;
      // best hour
      var opens = smoothHist(P, i, sm);
      var bh = 0;
      for (h = 0; h < 24; h++) { G[h] += sm[h]; if (sm[h] > sm[bh]) bh = h; }
      if (opens < 3) needFallback[i] = 1; else P.bestHr[i] = bh;
    }
    var gm = 0;
    for (h = 1; h < 24; h++) if (G[h] > G[gm]) gm = h;
    // clip LTV to the p99 of the current scores
    var sorted = Float32Array.from(P.ltv).sort();
    var cap = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.99 * (sorted.length - 1)))] : 0;
    for (i = 0; i < n; i++) {
      if (P.ltv[i] > cap) P.ltv[i] = cap;
      if (needFallback[i]) P.bestHr[i] = gm;
    }
    world._ltvStats = null;
    bump(world, 'profiles');
    return { globalBestHr: gm, ltvCap: cap };
  };

  /* ---------------- explanations ---------------- */
  function ltvStats(world) {
    var P = world.profiles, key = (world.rev ? world.rev.profiles : 0) + '|' + P.n;
    if (world._ltvStats && world._ltvStats.key === key) return world._ltvStats;
    var n = 0, r = 0, a = 0, kp = 0;
    for (var i = 0; i < P.n; i++) {
      if (!(P.orders[i] > 0)) continue;
      n++; r += P.orders[i] * 365 / Math.max(P.tenure[i], 90); a += P.aov[i]; kp += 1 - P.churn[i];
    }
    var s = { key: key, rate: n ? r / n : 0, aov: n ? a / n : 0, keep: n ? kp / n : 0 };
    world._ltvStats = s;
    return s;
  }

  function r1(x) { return Math.round(x * 10) / 10; }
  function money(x) { return (MC.fmt && MC.fmt.money) ? MC.fmt.money(x) : '$' + Math.round(x); }

  M.explain = function (world, i, which) {
    var P = world.profiles, d = curDay(world);
    if (!(i >= 0 && i < P.n)) return [];
    var x = M.featuresOf(world, i, d);
    var rec = Math.round(x[1] * 90), er = x[4];
    if (which === 'churn') {
      return [
        { label: 'Baseline', delta: -2.2 },
        { label: 'Days since last order (' + (P.lastOrder[i] === NEVER() ? 'never ordered' : rec) + ')', delta: 1.6 * rec / 90 },
        { label: 'Orders (' + P.orders[i] + ')', delta: -0.5 * Math.log(1 + P.orders[i]) },
        { label: 'Engagement rate (' + Math.round(er * 100) + '%)', delta: -1.8 * er }
      ];
    }
    if (which === 'ltv') {
      var s = ltvStats(world);
      var rate = P.orders[i] * 365 / Math.max(P.tenure[i], 90), aov = P.aov[i], keep = 1 - P.churn[i];
      var raw = rate * aov * keep;
      var rows = [
        { label: 'Orders per year (' + r1(rate) + ' vs ' + r1(s.rate) + ' typical)', delta: (rate - s.rate) * s.aov * s.keep },
        { label: 'Average order (' + money(aov) + ' vs ' + money(s.aov) + ')', delta: rate * (aov - s.aov) * s.keep },
        { label: 'Retention (' + Math.round(keep * 100) + '% vs ' + Math.round(s.keep * 100) + '%)', delta: rate * aov * (keep - s.keep) }
      ];
      if (Math.abs(P.ltv[i] - raw) > 0.5) rows.push({ label: 'Capped at the top 1% of scores', delta: P.ltv[i] - raw });
      return rows;
    }
    var coef = (world.modelState && world.modelState.coef) || new Float64Array(NF);
    var vals = ['', P.lastOrder[i] === NEVER() ? 'never ordered' : String(rec), String(P.orders[i]), money(P.spend[i]),
      Math.round(er * 100) + '%', String(P.visits30[i]), r1(x[6]).toFixed(1), Math.round(P.tenure[i]) + ' days'];
    return FEATURE_LABELS.map(function (lb, k) {
      return { label: k === 0 ? lb : lb + ' (' + vals[k] + ')', delta: coef[k] * x[k] };
    });
  };

  // σ(−7 + .55·F + .8·[sent7_ch ≥ freqCap[ch]−1] − 1.2·engRate)
  M.unsubRisk = function (world, i, ch) {
    var P = world.profiles, ci = MC.CH.IDX[ch];
    if (!(ci >= 0 && ci < 3)) return 0;
    var s7 = 0, b = i * 21 + ci * 7;
    for (var k = 0; k < 7; k++) s7 += P.sent7[b + k];
    var cap = (world.guardrails && world.guardrails.freqCap && world.guardrails.freqCap[ch]) || 4;
    return sig(-7 + 0.55 * P.fatigue[i] + (s7 >= cap - 1 ? 0.8 : 0) - 1.2 * engRateOf(P, i));
  };

  /* ---------------- Holt with weekly indices ---------------- */
  function holtRun(z, a, b, keepFitted) {
    var n = z.length, l = z[0], bt = 0, m = Math.min(7, n - 1), sse = 0, fitted = keepFitted ? [z[0]] : null;
    if (m > 0) bt = (z[m] - z[0]) / m;
    for (var t = 1; t < n; t++) {
      var pred = l + bt, e = z[t] - pred;
      sse += e * e;
      if (fitted) fitted.push(pred);
      var ln = a * z[t] + (1 - a) * pred;
      bt = b * (ln - l) + (1 - b) * bt;
      l = ln;
    }
    return { l: l, b: bt, sse: sse, fitted: fitted };
  }

  // holt(series, {alpha, beta, season:7, h}) -> {fitted, forecast:[{mean,sd,var,lo80,hi80,lo95,hi95}], sigma, alpha, beta, level, trend, indices}
  // Phase of the weekly index is position mod season (series[0] is phase 0); forecast k continues it.
  M.holt = function (series, opt) {
    opt = opt || {};
    var m = opt.season === undefined ? 7 : Math.max(1, opt.season | 0);
    var H = opt.h === undefined ? 7 : Math.max(0, opt.h | 0);
    var y = [], i, k;
    for (i = 0; i < (series ? series.length : 0); i++) {
      var v = series[i]; if (v && typeof v === 'object') v = v.value;
      y.push(fin(v) ? v : 0);
    }
    var n = y.length;
    if (n === 0) {
      var zero = [];
      for (k = 0; k < H; k++) zero.push({ mean: 0, sd: 0, 'var': 0, lo80: 0, hi80: 0, lo95: 0, hi95: 0 });
      return { fitted: [], forecast: zero, sigma: 0, alpha: null, beta: null, level: 0, trend: 0, indices: [] };
    }
    // weekly (seasonal) indices: phase mean / overall mean, normalized to average 1
    var I = [];
    for (k = 0; k < m; k++) I.push(1);
    if (m > 1 && n >= 2 * m) {
      var tot = 0; for (i = 0; i < n; i++) tot += y[i];
      var mu = tot / n;
      if (mu > 0) {
        var ps = [], pc = [];
        for (k = 0; k < m; k++) { ps.push(0); pc.push(0); }
        for (i = 0; i < n; i++) { ps[i % m] += y[i]; pc[i % m]++; }
        var avg = 0;
        for (k = 0; k < m; k++) { I[k] = Math.min(5, Math.max(0.2, (ps[k] / pc[k]) / mu)); avg += I[k]; }
        avg /= m;
        for (k = 0; k < m; k++) I[k] /= avg;
      }
    }
    var z = y.map(function (v, t) { return v / I[t % m]; });
    var bestA = opt.alpha, bestB = opt.beta, best = null;
    if (n >= 3 && !(fin(bestA) && fin(bestB))) {
      for (var ai = 1; ai <= 9; ai++) for (var bi = 1; bi <= 9; bi++) {
        var r = holtRun(z, ai / 10, bi / 10, false);
        if (!best || r.sse < best.sse - 1e-12) { best = r; bestA = ai / 10; bestB = bi / 10; }
      }
    }
    if (!fin(bestA)) bestA = 0.5;
    if (!fin(bestB)) bestB = 0.1;
    var run = holtRun(z, bestA, bestB, true);
    var s2 = n >= 3 ? run.sse / Math.max(1, n - 2) : 0;
    if (n < 3) { var mm = 0; for (i = 0; i < n; i++) mm += z[i]; mm /= n; run.l = mm; run.b = 0; for (i = 0; i < n; i++) s2 += (z[i] - mm) * (z[i] - mm); s2 = n > 1 ? s2 / (n - 1) : Math.abs(mm); }
    var forecast = [], acc = 0;
    for (k = 1; k <= H; k++) {
      if (k > 1) { var q = bestA * (1 + (k - 1) * bestB); acc += q * q; }
      var Ik = I[(n - 1 + k) % m];
      var mean = (run.l + k * run.b) * Ik;
      var vr = s2 * (1 + acc) * Ik * Ik, sd = Math.sqrt(vr);
      forecast.push({ mean: mean, sd: sd, 'var': vr, lo80: mean - Z80 * sd, hi80: mean + Z80 * sd, lo95: mean - Z95 * sd, hi95: mean + Z95 * sd });
    }
    return {
      fitted: run.fitted.map(function (v, t) { return v * I[t % m]; }), forecast: forecast,
      sigma: Math.sqrt(s2), alpha: bestA, beta: bestB, level: run.l, trend: run.b, indices: I
    };
  };

  function ptVar(p) {
    if (fin(p['var'])) return Math.max(0, p['var']);
    if (fin(p.sd)) return p.sd * p.sd;
    if (fin(p.hi80) && fin(p.lo80)) { var s = (p.hi80 - p.lo80) / (2 * Z80); return s * s; }
    if (fin(p.hi95) && fin(p.lo95)) { var t = (p.hi95 - p.lo95) / (2 * Z95); return t * t; }
    return 0;
  }
  // Φ((actual + Σmean − goal) / sqrt(ΣVar))
  M.goalProbability = function (actualToDate, forecastPts, goal) {
    var sm = 0, sv = 0, pts = forecastPts || [];
    for (var i = 0; i < pts.length; i++) { var p = pts[i]; if (!p) continue; sm += fin(p.mean) ? p.mean : 0; sv += ptVar(p); }
    var gap = (+actualToDate || 0) + sm - (+goal || 0);
    if (!(sv > 0)) return gap >= 0 ? 1 : 0;
    var z = gap / Math.sqrt(sv);
    return MC.util && MC.util.normCdf ? MC.util.normCdf(z) : sig(1.702 * z);
  };

  /* ---------------- EWMA anomalies ---------------- */
  // Returns every point from index minN on: {i, value, expected, sd, z, flag}. flag = |z| >= z.
  M.ewma = function (series, opt) {
    opt = opt || {};
    var lam = fin(opt.lambda) ? opt.lambda : 0.2, zc = fin(opt.z) ? opt.z : 3, minN = fin(opt.minN) ? Math.max(2, opt.minN | 0) : 7;
    var y = (series || []).map(function (v) { if (v && typeof v === 'object') v = v.value; return fin(v) ? v : 0; });
    var out = [];
    if (y.length <= minN) return out;
    var mu = 0, s2 = 0, i;
    for (i = 0; i < minN; i++) mu += y[i];
    mu /= minN;
    for (i = 0; i < minN; i++) s2 += (y[i] - mu) * (y[i] - mu);
    s2 /= (minN - 1);
    for (i = minN; i < y.length; i++) {
      var floor = 0.02 * Math.abs(mu);
      var sd = Math.sqrt(Math.max(s2, floor * floor, 1e-12));
      var z = (y[i] - mu) / sd;
      out.push({ i: i, value: y[i], expected: mu, sd: sd, z: z, flag: Math.abs(z) >= zc });
      var r = y[i] - mu;
      mu += lam * r;
      s2 = lam * r * r + (1 - lam) * s2;
    }
    return out;
  };

  /* ---------------- saturating response curves ---------------- */
  // R(s) = A·(1 − e^{−s/B}). Grid over B (20 log-spaced, 0.2×–5× mean spend), A by least squares,
  // best r². r² < 0.3 (or < 3 points) falls back to B = 2·meanSpend, A = meanRevenue/(1 − e^{−0.5}).
  M.fitResponse = function (points) {
    var pts = (points || []).filter(function (p) { return p && fin(p.spend) && fin(p.revenue) && p.spend > 0; });
    var n = pts.length, i;
    if (!n) return { A: 0, B: 1, r2: 0, sd: 0, n: 0, prior: true, meanSpend: 0, meanRevenue: 0 };
    var ms = 0, mr = 0;
    for (i = 0; i < n; i++) { ms += pts[i].spend; mr += pts[i].revenue; }
    ms /= n; mr /= n;
    var sst = 0;
    for (i = 0; i < n; i++) sst += (pts[i].revenue - mr) * (pts[i].revenue - mr);
    var best = null;
    for (var k = 0; k < 20; k++) {
      var B = ms * 0.2 * Math.pow(25, k / 19), sgg = 0, srg = 0;
      for (i = 0; i < n; i++) { var g = 1 - Math.exp(-pts[i].spend / B); sgg += g * g; srg += pts[i].revenue * g; }
      if (!(sgg > 0)) continue;
      var A = Math.max(0, srg / sgg), sse = 0;
      for (i = 0; i < n; i++) { var e = pts[i].revenue - A * (1 - Math.exp(-pts[i].spend / B)); sse += e * e; }
      var r2 = sst > 0 ? 1 - sse / sst : 0;
      if (!best || r2 > best.r2 + 1e-12) best = { A: A, B: B, r2: r2, sse: sse };
    }
    if (best && best.r2 >= 0.3 && n >= 3) {
      return { A: best.A, B: best.B, r2: best.r2, sd: Math.sqrt(best.sse / Math.max(1, n - 1)), n: n, prior: false, meanSpend: ms, meanRevenue: mr };
    }
    var Bp = 2 * ms, Ap = mr / (1 - Math.exp(-0.5)), sse2 = 0;
    for (i = 0; i < n; i++) { var e2 = pts[i].revenue - Ap * (1 - Math.exp(-pts[i].spend / Bp)); sse2 += e2 * e2; }
    return { A: Ap, B: Bp, r2: best ? best.r2 : 0, sd: Math.sqrt(sse2 / Math.max(1, n - 1)), n: n, prior: true, meanSpend: ms, meanRevenue: mr };
  };
  M.response = function (c, s) {
    if (!c || !(c.B > 0)) return 0;
    return c.A * (1 - Math.exp(-Math.max(0, s) / c.B));
  };
  M.marginal = function (c, s) {
    if (!c || !(c.B > 0)) return 0;
    return (c.A / c.B) * Math.exp(-Math.max(0, s) / c.B);
  };

  /* ---------------- Thompson P(best) ---------------- */
  // arms [{a,b}] (Beta parameters); each round samples every arm and counts the argmax (ties → lowest index).
  M.probBest = function (arms, rng, draws) {
    var k = arms ? arms.length : 0;
    if (!k) return [];
    if (k === 1) return [1];
    draws = Math.max(1, (draws | 0) || 400);
    var r = rng || MC.rng.fork(MC.SEED, 'models', 'probBest');
    var wins = new Array(k), j, best, bv, x;
    for (j = 0; j < k; j++) wins[j] = 0;
    for (var d = 0; d < draws; d++) {
      best = 0; bv = -1;
      for (j = 0; j < k; j++) {
        x = r.beta(Math.max(1e-3, +arms[j].a || 0), Math.max(1e-3, +arms[j].b || 0));
        if (x > bv) { bv = x; best = j; }
      }
      wins[best]++;
    }
    return wins.map(function (w) { return w / draws; });
  };

  /* ---------------- attribution roll-up ---------------- */
  // {model:'last'|'linear', fromDay, toDay, campaignIds} -> {byChannel:{[ch]:$}, byCampaign:{[cid]:{[ch]:$}}, total}
  M.attribution = function (world, opt) {
    opt = opt || {};
    var key = opt.model === 'linear' ? 'attrLin' : 'attrLast';
    var days = (world.metrics && world.metrics.days) || [];
    var D0 = MC.time ? MC.time.DAY0 : -60, today = curDay(world);
    var from = fin(opt.fromDay) ? opt.fromDay : D0, to = fin(opt.toDay) ? opt.toDay : today;
    var ids = opt.campaignIds && opt.campaignIds.length ? opt.campaignIds : null;
    var byChannel = {}, byCampaign = {}, total = 0;
    for (var d = Math.max(from, D0); d <= to; d++) {
      var e = days[d - D0];
      if (!e || !e.c) continue;
      var cids = ids || Object.keys(e.c).sort();
      for (var j = 0; j < cids.length; j++) {
        var cd = e.c[cids[j]];
        if (!cd || !cd[key]) continue;
        var chs = Object.keys(cd[key]).sort();
        for (var q = 0; q < chs.length; q++) {
          var v = +cd[key][chs[q]] || 0;
          if (!v) continue;
          byChannel[chs[q]] = (byChannel[chs[q]] || 0) + v;
          var bc = byCampaign[cids[j]] || (byCampaign[cids[j]] = {});
          bc[chs[q]] = (bc[chs[q]] || 0) + v;
          total += v;
        }
      }
    }
    return { byChannel: byChannel, byCampaign: byCampaign, total: total, model: opt.model === 'linear' ? 'linear' : 'last' };
  };
})();
