/* Marketing Cloud - MC.affinity: what each audience and each person responds to (docs/CONSISTENCY.md section 3).
   Hidden truth (sim): every person has a stable taste multiplier per content angle, derived from their attributes plus seeded
   noise (world.latent.profiles.taste, Float32Array n*5, mean about 1). The simulator multiplies an angle's channel effect by it.
   Observable record (this module reads it, never the taste): the response ledger world.content.led = {exp, clk, ord} Uint8Arrays
   indexed (person * 5 + angle) * 3 + channel (email, sms, push), plus per-block per-person world.content.exp|clk|ord|last.
   Everything returned here is estimated from the ledger with 95% intervals; "enough" is false when the data is too thin. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var A = MC.affinity = MC.affinity || {};

  A.ANGLES = ['trail-season', 'warmth', 'gifting', 'utility', 'urgency'];
  A.ANGLE_LABEL = { 'trail-season': 'Trail season', warmth: 'Warmth and comfort', gifting: 'Gifting', utility: 'Practical', urgency: 'Urgency with a deadline' };
  A.OWNED = ['email', 'sms', 'push'];
  var NA = 5, NC = 3, Z95 = 1.96, TASTE_K = 1.2, TASTE_MIN = -1, TASTE_MAX = 3.5;
  // Offsets so the people who actually receive each angle in the seeded campaigns average taste 1 (calibrated against the sample world's sends).
  var TASTE_OFFSET = [0.25, -0.42, 0, -0.31, -0.04];   // taste = 1 + K z (z standardised): mean about 1, and some people actively dislike an angle
  var HALF_LIFE = { headline: 2, body: 3, offer: 6, cta: 5, image: 3, product: 8, claim: 10, signoff: 20 };
  var RANKED_KINDS = ['headline', 'body', 'offer', 'cta', 'image'];
  A.angleIndex = function (angle) { return A.ANGLES.indexOf(angle === 'practical' ? 'utility' : angle); };
  A.labelOf = function (angle) { return A.ANGLE_LABEL[angle] || angle; };
  A.phraseOf = function (angle) { return { 'trail-season': 'trail-season', warmth: 'warmth', gifting: 'gifting', utility: 'practical', urgency: 'urgency' }[angle] || angle; };

  /* ---------------- hidden taste (sim truth) ---------------- */
  // Called once when the world is generated (after history, so tiers and last orders are final). Deterministic: own rng fork.
  A.makeTaste = function (world, seed) {
    var P = world.profiles, n = P.n, L = world.latent.profiles, NV = (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999;
    var rng = MC.rng.fork(seed === undefined ? world.meta.seed : seed, 'taste'), raw = new Float64Array(n * NA), i, a;
    for (i = 0; i < n; i++) {
      var b = i * 5, lapsed = (P.lastOrder[i] === NV || (0 - P.lastOrder[i]) > 120) ? 1 : 0;
      var affH = P.aff[b], affC = P.aff[b + 1], affR = P.aff[b + 3], affA = P.aff[b + 4], ps = L && L.priceSens ? L.priceSens[i] : 0.5;
      raw[i * NA] = 2.2 * affR + 1.2 * affH + (P.cat[i] === 3 ? 0.6 : 0);
      raw[i * NA + 1] = 0.9 * lapsed + 1.0 * affH * lapsed + 0.012 * (P.age[i] - 39) + 0.8 * affA;
      raw[i * NA + 2] = (P.orders[i] >= 4 ? 0.8 : 0) + (P.aov[i] >= 120 ? 0.8 : 0) + 0.04 * Math.min(P.orders[i], 8);
      raw[i * NA + 3] = 0.5 * P.tier[i] + 1.8 * affC + (P.tenure[i] > 1000 ? 0.5 : 0);
      raw[i * NA + 4] = (P.age[i] < 32 ? 0.9 : 0) + (P.tenure[i] < 365 ? 0.7 : 0) - 0.4 * P.tier[i] + 0.4 * ps;
      for (a = 0; a < NA; a++) raw[i * NA + a] += rng.normal(0, 0.45);
    }
    // Standardise over the people campaigns message, counting a person once per campaign that includes them (so the typical send, not
    // the typical customer, has mean taste 1 and "trail-season beats the rest" still holds on average).
    var rec = new Float64Array(n), nrec = 0;
    (world.campaigns && world.campaigns.order || []).forEach(function (cid) {
      var cc = world.campaigns.byId[cid], sg = world.segments && world.segments.byId[cc.segmentId];
      if (!sg || cc.status === 'completed') return;
      var bits = MC.segments.evaluate(world, sg.rule).bits;
      for (var q = 0; q < n; q++) if (bits[q]) rec[q] += 1;
    });
    for (i = 0; i < n; i++) nrec += rec[i];
    if (!nrec) { for (i = 0; i < n; i++) rec[i] = 1; nrec = n; }
    var taste = new Float32Array(n * NA);
    for (a = 0; a < NA; a++) {
      var s = 0, s2 = 0;
      for (i = 0; i < n; i++) { if (!rec[i]) continue; var x = raw[i * NA + a]; s += rec[i] * x; s2 += rec[i] * x * x; }
      var mu = s / nrec, sd = Math.sqrt(Math.max(1e-9, s2 / nrec - mu * mu));
      for (i = 0; i < n; i++) taste[i * NA + a] = Math.max(TASTE_MIN, Math.min(TASTE_MAX, 1 + TASTE_OFFSET[a] + TASTE_K * (raw[i * NA + a] - mu) / sd));
    }
    L.taste = taste;
    return taste;
  };
  // Hidden truth; for the simulator and tests only (views and agents read the ledger through this module).
  A.tasteOf = function (world) {
    var L = world.latent && world.latent.profiles;
    if (!L) return null;
    if (!L.taste || L.taste.length !== world.profiles.n * NA) A.makeTaste(world);
    return L.taste;
  };

  /* ---------------- ledger access ---------------- */
  // Response measure: responses (opens + clicks; SMS opens are not recorded) over expected responses, where "expected" is what an average
  // recipient of the same variant produced. Message quality, channel and send mix cancel, and what is left is how this group responds to
  // an angle compared with how everyone responds to those same messages.
  function ledger(w) { return (w.content && w.content.led) || null; }
  // Per-tick read model: variant rates and each person's expected responses per angle (Float32Array n*5).
  function readModel(w) {
    var cache = w._affRead, C = w.content;
    if (cache && cache.tick === w.meta.tick && cache.C === C) return cache;
    var n = w.profiles.n, vl = (C && C.vled) || {}, vr = (C && C.vrate) || {}, ids = Object.keys(vl).sort(), X = new Float32Array(n * NA), vs = [];
    ids.forEach(function (id) {
      var v = vl[id], r = vr[id] || [0, 0, 0], rate = r[0] > 0 ? (r[1] + r[2]) / r[0] : 0;
      if (v.angle < 0 || v.exp.length !== n) return;
      vs.push({ id: id, v: v, rate: rate });
      for (var i = 0; i < n; i++) { var e = v.exp[i]; if (e) X[i * NA + v.angle] += e * rate; }
    });
    cache = w._affRead = { tick: w.meta.tick, C: C, X: X, vs: vs };
    return cache;
  }
  // lift of group 1 vs group 0, each as responses k and expected responses x; 95% interval from the response counts.
  function oeRatio(k1, x1, k0, x0, n1) {
    var out = { k1: k1, x1: x1, k0: k0, x0: x0, n1: n1, lift: null, lo: null, hi: null };
    if (!(k1 > 0) || !(k0 > 0) || !(x1 > 0) || !(x0 > 0)) return out;
    var lr = Math.log((k1 / x1) / (k0 / x0)), se = Math.sqrt(1 / k1 + 1 / k0);
    out.lift = Math.exp(lr) - 1; out.lo = Math.exp(lr - Z95 * se) - 1; out.hi = Math.exp(lr + Z95 * se) - 1;
    return out;
  }

  // Per-angle sums over the people for whom pred(i) is true: {E, K, C, O, X} (deliveries, responses, clicks, orders, expected responses).
  function sums(w, pred) {
    var led = ledger(w), n = w.profiles.n, S = { E: [0, 0, 0, 0, 0], K: [0, 0, 0, 0, 0], C: [0, 0, 0, 0, 0], O: [0, 0, 0, 0, 0], X: [0, 0, 0, 0, 0] }, i, a;
    if (!led) return S;
    var X = readModel(w).X;
    for (i = 0; i < n; i++) {
      if (!pred(i)) continue;
      for (a = 0; a < NA; a++) {
        var j = i * NA + a, e = led.exp[j];
        if (!e) continue;
        S.E[a] += e; S.K[a] += led.clk[j] + led.opn[j]; S.C[a] += led.clk[j]; S.O[a] += led.ord[j]; S.X[a] += X[j];
      }
    }
    return S;
  }
  function angleRows(S) {
    var rows = [], a, tn = 0, tk = 0, tc = 0, to = 0, tx = 0;
    for (a = 0; a < NA; a++) { tn += S.E[a]; tk += S.K[a]; tc += S.C[a]; to += S.O[a]; tx += S.X[a]; }
    for (a = 0; a < NA; a++) {
      var r = oeRatio(S.K[a], S.X[a], tk - S.K[a], tx - S.X[a], S.E[a]);
      var enough = r.k1 >= 30 && r.k0 >= 30 && S.E[a] >= 150 && r.lift !== null;
      rows.push({ angle: A.ANGLES[a], label: A.labelOf(A.ANGLES[a]), lift: r.lift, lo: r.lo, hi: r.hi, n: S.E[a], responses: S.K[a], clicks: S.C[a], orders: S.O[a],
        rate: S.E[a] ? S.K[a] / S.E[a] : 0, enough: enough, clear: enough && (r.lo > 0 || r.hi < 0),
        reason: enough ? null : (S.E[a] < 150 ? 'Only sent to this audience ' + S.E[a] + ' times so far.' : (tk - S.K[a] < 30 ? 'This audience hasn’t been sent other angles to compare with.' : 'Too few responses to call.')) });
    }
    rows.totals = { n: tn, responses: tk, clicks: tc, orders: to };
    return rows;
  }

  /* ---------------- blocks for an audience ---------------- */
  function blockStats(w, bits) {
    var C = w.content, n = w.profiles.n, out = {}, rm = readModel(w);
    if (!C || !C.blocks) return [];
    rm.vs.forEach(function (e) {
      var v = e.v, k = 0, c = 0, o = 0, d = 0;
      for (var i = 0; i < n; i++) {
        if (!bits[i] || !v.exp[i]) continue;
        d += v.exp[i]; k += v.opn[i] + v.clk[i]; c += v.clk[i]; o += v.ord[i];
      }
      if (!d) return;
      v.blocks.forEach(function (id) {
        var b = out[id] || (out[id] = { exposures: 0, responses: 0, clicks: 0, orders: 0, expected: 0 });
        b.exposures += d; b.responses += k; b.clicks += c; b.orders += o; b.expected += d * e.rate;
      });
    });
    var list = [];
    C.blocks.order.forEach(function (id) {
      var blk = C.blocks.byId[id], b = out[id], ex = C.exp && C.exp[id];
      if (!blk || !b || !ex) return;
      var seen = 0, tired = 0, tot = 0, hl = HALF_LIFE[blk.kind] || 5;
      for (var i = 0; i < n; i++) { if (!bits[i] || !ex[i]) continue; seen++; tot += ex[i]; if (ex[i] >= hl) tired++; }
      list.push({ blockId: id, kind: blk.kind, angle: (blk.tags && blk.tags.angle) || null, text: MC.content ? MC.content.textOf(blk) : '',
        seen: seen, exposures: b.exposures, responses: b.responses, clicks: b.clicks, orders: b.orders, expected: b.expected, meanExp: seen ? tot / seen : 0, tiredN: tired, hl: hl });
    });
    return list;
  }

  /* ---------------- forSegment ---------------- */
  // -> { id, members, exposures, responses, clicks, orders, angles:[{angle,label,lift,lo,hi,n,responses,clicks,orders,rate,enough,clear,reason}],
  //      best, topBlocks, tiredBlocks, basis }
  // lift (a fraction, 0.2 = 20% more): how much more this audience responds to content with the angle than to its other angles, each read
  // against how everyone responded to the same messages; 95% interval. enough=false means too little data to say (reason says why).
  // topBlocks: [{blockId,kind,angle,text,lift,lo,hi,n,seen,clicks,orders,enough,clear}] (same method against blocks of the same kind).
  // tiredBlocks: [{blockId,kind,angle,text,n,tiredPct,meanExposures,retention}] (share of this audience past the block's half-life).
  A.forSegment = function (w, segId) {
    var bits = w.segments && w.segments.byId[segId] ? MC.segments.members(w, segId) : null;
    var empty = { id: segId, members: 0, exposures: 0, angles: [], best: null, topBlocks: [], tiredBlocks: [], basis: 'No data yet.' };
    if (!bits) return empty;
    var cache = w._affCache || (w._affCache = { tick: -1, seg: {} });
    if (cache.tick !== w.meta.tick) { cache.tick = w.meta.tick; cache.seg = {}; }
    var hit = cache.seg[segId];
    if (hit && hit.bits === bits) return hit.out;
    var S = sums(w, function (i) { return bits[i] === 1; }), rows = angleRows(S), members = 0, i;
    for (i = 0; i < bits.length; i++) members += bits[i];
    var angles = rows.slice().sort(function (a, b) { return ((b.enough ? 1 : 0) - (a.enough ? 1 : 0)) || ((b.lift === null ? -9 : b.lift) - (a.lift === null ? -9 : a.lift)); });
    var best = null;
    angles.forEach(function (r) { if (!best && r.enough && r.lo > 0) best = r.angle; });
    var bs = blockStats(w, bits), byKind = {}, top = [], tired = [];
    bs.forEach(function (b) { var g = byKind[b.kind] || (byKind[b.kind] = { k: 0, x: 0 }); g.k += b.responses; g.x += b.expected; });
    bs.forEach(function (b) {
      if (RANKED_KINDS.indexOf(b.kind) >= 0 && b.exposures >= 150) {
        var g = byKind[b.kind], r = oeRatio(b.responses, b.expected, g.k - b.responses, g.x - b.expected, b.exposures);
        if (r.lift !== null && b.responses >= 30 && g.k - b.responses >= 30) {
          top.push({ blockId: b.blockId, kind: b.kind, angle: b.angle, text: b.text, lift: r.lift, lo: r.lo, hi: r.hi, n: b.exposures, seen: b.seen,
            clicks: b.clicks, orders: b.orders, enough: true, clear: r.lo > 0 || r.hi < 0 });
        }
      }
      if (b.seen >= 30 && b.tiredN / b.seen >= 0.25) {
        tired.push({ blockId: b.blockId, kind: b.kind, angle: b.angle, text: b.text, n: b.seen, tiredPct: b.tiredN / b.seen,
          meanExposures: b.meanExp, retention: Math.pow(0.5, b.meanExp / b.hl) });
      }
    });
    top.sort(function (a, b) { return (b.lo - a.lo) || (a.blockId < b.blockId ? -1 : 1); });
    tired.sort(function (a, b) { return (b.tiredPct * b.n - a.tiredPct * a.n) || (a.blockId < b.blockId ? -1 : 1); });
    var out = { id: segId, members: members, exposures: rows.totals.n, responses: rows.totals.responses, clicks: rows.totals.clicks, orders: rows.totals.orders, angles: angles, best: best,
      topBlocks: top.filter(function (b) { return b.lift > 0; }).slice(0, 5), tiredBlocks: tired.slice(0, 5),
      basis: 'Opens and clicks on content with the angle against this audience’s other angles, each compared with how everyone responded to the same messages; 95% interval.' };
    cache.seg[segId] = { bits: bits, out: out };
    return out;
  };

  /* ---------------- forProfile ---------------- */
  // -> { history:[{blockId, kind, angle, text, seen, clicked, ordered, lastDay, lastTick}], fatigue:[{blockId, kind, exposures, tired, retention}],
  //      bestAngle: angle id | null, angles:[{angle,label,seen,clicked,ordered,score,cellLift}], basis }
  // bestAngle is predicted from this person's own responses blended with what people like them respond to (never the hidden taste).
  A.forProfile = function (w, idx) {
    var C = w.content, out = { history: [], fatigue: [], bestAngle: null, angles: [], basis: '' };
    if (!C || !C.blocks || idx === null || idx === undefined || idx < 0 || idx >= w.profiles.n) return out;
    var vl = C.vled || {}, vids = Object.keys(vl).sort();
    C.blocks.order.forEach(function (id) {
      var blk = C.blocks.byId[id], ex = C.exp && C.exp[id];
      if (!blk || !ex || !ex[idx]) return;
      var hl = HALF_LIFE[blk.kind] || 5, clk = 0, ord = 0, last = -32768;
      vids.forEach(function (vid) {
        var v = vl[vid];
        if (v.blocks.indexOf(id) < 0 || !v.exp[idx]) return;
        clk += v.clk[idx]; ord += v.ord[idx]; if (v.last[idx] > last) last = v.last[idx];
      });
      var has = last > -30000;
      out.history.push({ blockId: id, kind: blk.kind, angle: (blk.tags && blk.tags.angle) || null, text: MC.content ? MC.content.textOf(blk) : '',
        seen: ex[idx], clicked: clk, ordered: ord, lastDay: has ? last : null, lastTick: has ? last * 24 : null });
      out.fatigue.push({ blockId: id, kind: blk.kind, exposures: ex[idx], tired: ex[idx] >= hl, retention: Math.pow(0.5, ex[idx] / hl) });
    });
    out.history.sort(function (a, b) { return ((b.lastTick === null ? -1e9 : b.lastTick) - (a.lastTick === null ? -1e9 : a.lastTick)) || (a.blockId < b.blockId ? -1 : 1); });
    out.fatigue.sort(function (a, b) { return (b.exposures - a.exposures) || (a.blockId < b.blockId ? -1 : 1); });
    var led = ledger(w), model = cellModel(w), c = model && model.cells[model.cellIdx[idx]];
    A.ANGLES.forEach(function (ang, a) {
      var seen = led ? led.exp[idx * NA + a] : 0, clk = led ? led.clk[idx * NA + a] : 0, ord = led ? led.ord[idx * NA + a] : 0;
      out.angles.push({ angle: ang, label: A.labelOf(ang), seen: seen, clicked: clk, ordered: ord, score: personScore(w, model, idx, a), cellLift: c && c.lift[a] !== null ? c.lift[a] : null });
    });
    var bestI = -1, bestS = 0.05;   // a best angle needs a clearly positive predicted response
    out.angles.forEach(function (r, a) { if (r.score !== null && r.score > bestS) { bestS = r.score; bestI = a; } });
    out.bestAngle = bestI >= 0 ? A.ANGLES[bestI] : null;
    out.basis = bestI >= 0 ? 'Predicted from this person’s own responses and from people with the same buying pattern.' : 'Not enough responses yet to call a best angle.';
    return out;
  };

  /* ---------------- respondsTo (segment attribute) ---------------- */
  // Observable cell: top category x lapsed x gift-buyer x member tier. People in the same cell share a prior; own clicks refine it.
  function cellOf(w, i) {
    var P = w.profiles, NV = (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999, day = Math.floor(w.meta.tick / 24);
    var lapsed = (P.lastOrder[i] === NV || day - P.lastOrder[i] > 120) ? 1 : 0, giver = (P.orders[i] >= 4 || P.aov[i] >= 120) ? 1 : 0, mem = P.tier[i] >= 2 ? 1 : 0;
    return (((P.cat[i] * 2 + lapsed) * 2 + giver) * 2 + mem);
  }
  // Per-cell, per-angle lift from the ledger (observed over expected clicks), cached on the world per tick.
  function cellModel(w) {
    var led = ledger(w);
    if (!led) return null;
    var cache = w._affCells;
    if (cache && cache.tick === w.meta.tick && cache.led === led) return cache.model;
    var n = w.profiles.n, NCELL = 40, cells = [], i, a;
    for (i = 0; i < NCELL; i++) { var z = []; for (a = 0; a < NA; a++) z.push([0, 0, 0]); cells.push({ S: z, lift: [], score: [], n: [] }); }
    var cellIdx = new Uint8Array(n), X = readModel(w).X;
    for (i = 0; i < n; i++) {
      var ci = cellOf(w, i); cellIdx[i] = ci;
      for (a = 0; a < NA; a++) { var j = i * NA + a, e = led.exp[j]; if (!e) continue; var t = cells[ci].S[a]; t[0] += e; t[1] += led.clk[j] + led.opn[j]; t[2] += X[j]; }
    }
    cells.forEach(function (cell) {
      var tk = 0, tx = 0;
      for (a = 0; a < NA; a++) { tk += cell.S[a][1]; tx += cell.S[a][2]; }
      for (a = 0; a < NA; a++) {
        var r = oeRatio(cell.S[a][1], cell.S[a][2], tk - cell.S[a][1], tx - cell.S[a][2], cell.S[a][0]);
        // shrink the log-lift toward "no difference" by how little evidence the cell has (about 40 responses to trust it)
        var wt = (r.k1 + r.k0) / (r.k1 + r.k0 + 80);
        cell.lift.push(r.lift); cell.n.push(cell.S[a][0]);
        cell.score.push(r.lift === null ? null : wt * Math.log(1 + Math.max(-0.9, r.lift)));
      }
    });
    var model = { cells: cells, cellIdx: cellIdx };
    w._affCells = { tick: w.meta.tick, led: led, model: model };
    return model;
  }
  // Predicted log response to the angle (against the person's other angles): the cell prior plus the person's own clicks against
  // what the same messages normally get. null when nobody like them has been sent the angle yet.
  function personScore(w, model, i, a) {
    if (!model) return null;
    var prior = model.cells[model.cellIdx[i]].score[a];
    if (prior === null) return null;
    var led = ledger(w), j = i * NA + a, own = 0;
    if (led.exp[j] > 0) { var x = readModel(w).X[j]; own = Math.max(-3, Math.min(3, (led.clk[j] + led.opn[j] - x) / Math.sqrt(x + 0.5))); }
    return prior + 0.12 * own;
  }
  var RESP_MIN = 0.1;
  // Uint8Array bitset of people who respond to the angle: predicted relative response above the threshold. Cached per tick.
  A.respondsBits = function (w, angle) {
    var a = A.angleIndex(angle), n = w.profiles.n, bits = new Uint8Array(n);
    if (a < 0) return bits;
    var model = cellModel(w);
    if (!model) return bits;
    var cache = w._affResp || (w._affResp = { tick: -1, by: {} });
    if (cache.tick !== w.meta.tick) { cache.tick = w.meta.tick; cache.by = {}; }
    if (cache.by[a]) return cache.by[a];
    for (var i = 0; i < n; i++) { var s = personScore(w, model, i, a); if (s !== null && s >= RESP_MIN) bits[i] = 1; }
    cache.by[a] = bits;
    return bits;
  };
  A.RESPONDS_MIN = RESP_MIN;
})();
