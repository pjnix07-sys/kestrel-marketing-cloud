/* Marketing Cloud - MC.sim: the hourly simulation step for the Fernway Outfitters sample
   world (synthetic data). Journey engine for owned channels, paid-media response curves, organic
   orders, attribution, the day roll, go-live enrollment and the hidden "latent truth" that agents
   never see. Columnar data is mutated in place and followed by a rev bump; entity changes go
   through MC.catalog.apply with origin 'sim'. Every random draw comes from a keyed MC.rng fork. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var SIM = MC.sim = MC.sim || {};

  var assign = Object.assign;

  /* ======================= constants (§5.2, §10.7) ======================= */
  var CONST = {
    pd: { email: 0.985, sms: 0.97, push: 0.93 },             // delivery probability
    a: { email: -1.25, push: -2.1 },                          // open intercepts
    smsOpen: 0.92,                                            // sms "open" (read) probability
    b: { email: -2.0, sms: -2.6, push: -2.3 },                // click-given-open intercepts
    engW: 1.4, hourW: 0.9, fatW: 0.35, affW: 0.6, cfW: 0.4,
    convBase: -2.6, convP0: 0.9, priceSensW: 0.5, convMax: 0.95,
    unsubBase: 0.0012, unsubFat: 1.6,
    unitCost: { email: 0.03, sms: 0.045, push: 0.01 },
    offerLift: { none: 0, freeship: 0.15, pct15: 0.30, pct25: 0.45, gift: 0.10 },
    discount: { none: 0, freeship: 0, pct15: 0.15, pct25: 0.25, gift: 0 },
    revSd: 0.35,
    seasonWeekend: 0.08, seasonPeak: 0.55, seasonPeakDay: 20, seasonWidth: 6,
    fatigueDecay: 0.8, hoursDecay: 0.9,
    capCampaign: 600, capGlobal: 1500, maxTransitions: 16,
    sendWindow: 3, ctlSendHour: 10,
    cpm: { social: 9, web: 6 }, ctrPaid: { social: 0.008, web: 0.004 },
    roas: { social: [2.2, 3.8], web: [1.6, 3.2] }, curveB: [0.6, 1.6],
    organic: { base: -5.9, p0: 0.9, aff: 0.6, recency: -0.004 },
    visits: { base: 0.05, eng: 0.15 },
    attrWindow: 168, reactDays: 120,
    latentSd: 0.25, latentW: 0.8,
    affFloor: 0.02, cfFloor: 0.05
  };
  SIM.CONST = CONST;

  var HOUR_SHAPE = (function () {
    var w = [1, 1, 1, 1, 1, 2, 3, 4, 5, 5, 5, 6, 6, 5, 5, 5, 6, 7, 8, 8, 7, 5, 3, 2];
    var a = new Float64Array(24);
    for (var i = 0; i < 24; i++) a[i] = w[i] / 102;
    return a;
  })();
  SIM.HOUR_SHAPE = HOUR_SHAPE;
  var HOUR_CUM = (function () { var a = new Float64Array(25); for (var i = 0; i < 24; i++) a[i + 1] = a[i] + HOUR_SHAPE[i]; return a; })();

  /* ======================= small helpers ======================= */
  function U() { return MC.util; }
  function T() { return MC.time; }
  function F() { return MC.F; }
  function CH() { return MC.CH; }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function NEVER() { return (MC.data && typeof MC.data.NEVER === 'number') ? MC.data.NEVER : -9999; }
  function newFact() { return new Float64Array(10); }
  function seedOf(world) { return world.meta.seed; }
  function camp(world, id) { return world.campaigns && world.campaigns.byId[id]; }

  function dcirc(a, b) { var d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); }

  SIM.season = function (d) {
    var dw = T().dowOfDay(d);
    var weekend = (dw === 0 || dw === 6) ? 1 : 0;
    var x = d - CONST.seasonPeakDay;
    return 1 + CONST.seasonWeekend * weekend + CONST.seasonPeak * Math.exp(-(x * x) / CONST.seasonWidth);
  };

  // Product lookup per catalog object: price, category index, top product per category, mean price.
  var prodCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function prodInfo(world) {
    var cat = world.catalog || { categories: [], products: [] };
    if (prodCache && prodCache.has(cat)) return prodCache.get(cat);
    var cats = cat.categories || [];
    var catIdx = {};
    cats.forEach(function (c, i) { catIdx[typeof c === 'string' ? c : c.id] = i; });
    var byId = {}, top = [], sum = 0, n = 0;
    (cat.products || []).forEach(function (p) {
      var ci = typeof p.cat === 'number' ? p.cat : (catIdx[p.cat] !== undefined ? catIdx[p.cat] : 0);
      var price = +p.price || 0;
      byId[p.id] = { id: p.id, price: price, ci: ci };
      if (top[ci] === undefined) top[ci] = p.id;
      sum += price; n++;
    });
    var info = { byId: byId, top: top, mean: n ? sum / n : 100, nCat: Math.max(1, cats.length || 5) };
    if (prodCache) prodCache.set(cat, info);
    return info;
  }
  SIM._prodInfo = prodInfo;

  function topProductOf(world, i) {
    var pi = prodInfo(world);
    var c = world.profiles.cat ? world.profiles.cat[i] : 0;
    var id = pi.top[c] !== undefined ? pi.top[c] : pi.top[0];
    return id !== undefined ? pi.byId[id] : null;
  }
  // product = variant.productId || campaign.productFocus || top product of the profile's top category
  function productFor(world, v, c, i) {
    var pi = prodInfo(world);
    var id = (v && v.productId) || (c && c.productFocus) || null;
    if (id && pi.byId[id]) return pi.byId[id];
    return topProductOf(world, i) || { id: null, price: pi.mean, ci: 0 };
  }

  // Copy features per variant object (spam term); cached by object identity (entities are immutable).
  var featCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function spamOf(v) {
    if (featCache && featCache.has(v)) return featCache.get(v);
    var s = 0;
    try {
      if (MC.copy && typeof MC.copy.features === 'function') {
        var f = MC.copy.features(v) || {};
        s = 0.6 * (f.caps ? 1 : 0) + 0.3 * (f.urgency ? 1 : 0);
      }
    } catch (e) { s = 0; }
    if (featCache) featCache.set(v, s);
    return s;
  }

  function latentOf(world, v) {
    var L = world.latent && world.latent.variants && world.latent.variants[v.id];
    if (L) return L;
    L = SIM.latentFor(world, v);
    if (world.latent) {
      if (!world.latent.variants) world.latent.variants = {};
      world.latent.variants[v.id] = L;
    }
    return L;
  }

  /* ======================= latent truth ======================= */
  // qo/qc from the copy model plus seeded noise; qv is pure noise. Same fork for every recompute.
  SIM.latentFor = function (world, variant) {
    var rng = MC.rng.fork(seedOf(world), 'variant', variant.id);
    var eo = rng.normal(0, CONST.latentSd), ec = rng.normal(0, CONST.latentSd), ev = rng.normal(0, CONST.latentSd);
    var qo = eo, qc = ec;
    try {
      if (MC.copy && typeof MC.copy.score === 'function') {
        var s = MC.copy.score(variant) || {};
        var B = MC.copy.BANK_STATS || { meanO: 0, meanC: 0 };
        if (isFinite(s.logitO)) qo = CONST.latentW * (s.logitO - (B.meanO || 0)) + eo;
        if (isFinite(s.logitC)) qc = CONST.latentW * (s.logitC - (B.meanC || 0)) + ec;
      }
    } catch (e) { /* noise only */ }
    return { qo: qo, qc: qc, qv: ev };
  };

  /* ======================= content blocks: latent effects (docs/CONTENT.md "Simulation truth") =======================
     Each block has seeded noise (world.latent.blocks[id]) and an effect that depends on its angle tag, the channel, the day
     (urgency pays only near a real deadline; gifting rises after Dec 1) and how many times the same person has already been
     sent it (reuse fatigue). A variant's quality is its text-model quality (qo, qc, qv) plus the sum of its pinned blocks'
     effects, so editing a block never changes a live variant's sends until it is published again. No extra random draws. */
  var KIND_W = {
    headline: { o: 1.0, c: 0.6, v: 0.2 }, body: { o: 0.3, c: 0.6, v: 0.2 }, offer: { o: 0.1, c: 0.5, v: 0.6 }, cta: { o: 0, c: 0.7, v: 0.1 },
    image: { o: 0.25, c: 0.5, v: 0.1 }, product: { o: 0, c: 0.3, v: 0.4 }, claim: { o: 0, c: 0.1, v: 0.4 }, signoff: { o: 0, c: 0, v: 0.05 }
  };
  var ANGLE_K = { headline: 1, body: 0.5 };                                    // only wording carries an angle
  var HALF_LIFE = { headline: 2, body: 3, offer: 6, cta: 5, image: 3, product: 8, claim: 10, signoff: 20 };   // exposures
  var TIRED_MAX = { headline: 0.35, body: 0.2, offer: 0.1, cta: 0.1, image: 0.25, product: 0.05, claim: 0.05, signoff: 0.02 };
  var BLOCK_SD = 0.10, GIFT_DAY = 24, URGENCY_WINDOW = 6;                      // Dec 1 is sim day 24
  var ANGLE_BASE = {   // [open, click, convert] logit effect by channel (sms opens are fixed, so only clicks move there)
    'trail-season': { email: [0.34, 0.26, 0.05], push: [0.30, 0.22, 0.04], sms: [0, 0.03, 0], social: [0, 0.12, 0], web: [0, 0.10, 0] },
    warmth: { email: [0.10, 0.10, 0.08], push: [0.05, 0.05, 0.04], sms: [0, 0.12, 0.08], social: [0, 0.08, 0.04], web: [0, 0.08, 0.04] },
    utility: { email: [0.06, 0.08, 0.03], push: [0.04, 0.06, 0.02], sms: [0, 0.06, 0.03], social: [0, 0.05, 0], web: [0, 0.05, 0] }
  };
  var GIFT_GAIN = { email: [0.32, 0.28, 0.30], push: [0.28, 0.24, 0.25], sms: [0, 0.30, 0.30], social: [0, 0.20, 0.12], web: [0, 0.20, 0.12] };
  var GIFT_OFF = [-0.10, -0.08, -0.04];
  var URG_BASE = { email: [-0.06, -0.04, 0], push: [-0.06, -0.04, 0], sms: [0, -0.02, 0], social: [0, -0.02, 0], web: [0, -0.02, 0] };
  var URG_GAIN = { email: [0.45, 0.30, 0.10], push: [0.40, 0.28, 0.10], sms: [0, 0.12, 0.08], social: [0, 0.20, 0.05], web: [0, 0.20, 0.05] };
  var URG_NO_DEADLINE = [-0.15, -0.12, -0.05];   // urgency with nothing behind it reads as pressure
  var ZERO3 = [0, 0, 0];
  var GTAB = {};   // fatigue retention by kind: 0.5^(exposures / half-life)
  Object.keys(HALF_LIFE).forEach(function (k) { var a = []; for (var n = 0; n < 16; n++) a.push(Math.pow(0.5, n / HALF_LIFE[k])); GTAB[k] = a; });

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  // Angle effect [o, c, v] on a channel on sim day d; daysLeft is null when the campaign has no real deadline.
  function angleFx(angle, ch, d, daysLeft) {
    if (angle === 'urgency') {
      if (daysLeft === null) return URG_NO_DEADLINE;
      var r = clamp01(1 - daysLeft / URGENCY_WINDOW), b = URG_BASE[ch] || ZERO3, g = URG_GAIN[ch] || ZERO3;
      return [b[0] + g[0] * r, b[1] + g[1] * r, b[2] + g[2] * r];
    }
    if (angle === 'gifting') {
      var ramp = clamp01((d - GIFT_DAY + 1) / 10), gg = GIFT_GAIN[ch] || ZERO3;
      return [GIFT_OFF[0] * (1 - ramp) + gg[0] * ramp, GIFT_OFF[1] * (1 - ramp) + gg[1] * ramp, GIFT_OFF[2] * (1 - ramp) + gg[2] * ramp];
    }
    var t = ANGLE_BASE[angle];
    return (t && t[ch]) || ZERO3;
  }
  SIM.angleFx = angleFx;

  // The block's seeded noise (its own hidden truth); same fork every time.
  SIM.latentForBlock = function (world, block) {
    var id = typeof block === 'string' ? block : block.id;
    var rng = MC.rng.fork(seedOf(world), 'block', id);
    return { o: rng.normal(0, BLOCK_SD), c: rng.normal(0, BLOCK_SD), v: rng.normal(0, BLOCK_SD) };
  };
  function blockNoise(world, id) {
    var L = world.latent || (world.latent = { profiles: null, variants: {}, curves: {} });
    var B = L.blocks || (L.blocks = {});
    return B[id] || (B[id] = SIM.latentForBlock(world, id));
  }
  // Static [o, c, v] effect of one pinned block for a channel on a day (no fatigue): what a fresh person would see.
  SIM.blockEffect = function (world, blockId, ver, ch, d, daysLeft) {
    var C = world.content, blk = C && C.blocks.byId[blockId];
    if (!blk) return [0, 0, 0];
    var tags = (MC.content ? MC.content.blockAt(blk, ver) : blk).tags || {}, W = KIND_W[blk.kind] || KIND_W.signoff;
    var N = blockNoise(world, blockId), ak = ANGLE_K[blk.kind] || 0, af = ak ? angleFx(tags.angle, ch, d, daysLeft) : ZERO3;
    return [W.o * (N.o + ak * af[0]), W.c * (N.c + ak * af[1]), W.v * (N.v + ak * af[2])];
  };

  function expOf(world, id) {
    var C = world.content, n = world.profiles.n;
    var E = C.exp || (C.exp = {});
    return E[id] && E[id].length === n ? E[id] : (E[id] = new Uint8Array(n));
  }
  // Send plan for a content-linked variant on a day: block effects and ledger rows, cached per variant per day.
  function contentPlan(world, v, d, owned) {
    var C = world.content;
    if (!C || !v.blocks || !v.blocks.length) return null;
    var cache = world._cplan || (world._cplan = { day: null, byV: {} });
    if (cache.day !== d) { cache.day = d; cache.byV = {}; }
    var pl = cache.byV[v.id];
    if (pl && pl.v === v) return pl;
    var c = camp(world, v.campaignId), ch = v.channel, dl = null;
    if (c && ((c.offer && c.offer !== 'none') || (c.eventDay !== undefined && c.eventDay !== null))) dl = c.endTick;
    var daysLeft = dl === null ? null : Math.max(0, (dl - (d * 24 + 12)) / 24);
    pl = { v: v, ch: ch, n: 0, ids: [], eo: [], ec: [], ev: [], to: [], tc: [], tv: [], g: [], exp: [], ki: [], perf: [], fat: [], sumC: 0 };
    var P = C.perf || (C.perf = {}), day = owned ? (P[d] || (P[d] = {})) : null, F = C.fat || (C.fat = {});
    v.blocks.forEach(function (b) {
      var blk = C.blocks.byId[b.id];
      if (!blk) return;
      var fx = SIM.blockEffect(world, b.id, b.ver, ch, d, daysLeft), W = KIND_W[blk.kind] || KIND_W.signoff, T = TIRED_MAX[blk.kind] || 0;
      pl.ids.push(b.id); pl.eo.push(fx[0]); pl.ec.push(fx[1]); pl.ev.push(fx[2]);
      pl.to.push(T * W.o); pl.tc.push(T * W.c); pl.tv.push(T * W.v);
      pl.g.push(GTAB[blk.kind] || GTAB.signoff); pl.exp.push(null); pl.ki.push(0); pl.sumC += fx[1];
      if (owned) {
        var pb = day[b.id] || (day[b.id] = {});
        pl.perf.push(pb[ch] || (pb[ch] = [0, 0, 0, 0, 0, 0]));
        var fb = F[b.id] || (F[b.id] = {});
        pl.fat.push(fb[ch] || (fb[ch] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
      }
    });
    pl.n = pl.ids.length;
    cache.byV[v.id] = pl;
    return pl;
  }
  // Logit shifts for profile i: each block's effect decays with the exposures that person has had, plus a tiredness penalty.
  function planFx(world, pl, i, out) {
    var dO = 0, dC = 0, dV = 0;
    for (var j = 0; j < pl.n; j++) {
      var a = pl.exp[j] || (pl.exp[j] = expOf(world, pl.ids[j])), k = a[i];
      pl.ki[j] = k > 5 ? 5 : k;
      var g = pl.g[j][k > 15 ? 15 : k], h = 1 - g;
      dO += pl.eo[j] * g - pl.to[j] * h; dC += pl.ec[j] * g - pl.tc[j] * h; dV += pl.ev[j] * g - pl.tv[j] * h;
    }
    out.o = dO; out.c = dC; out.v = dV;
    return out;
  }
  // col: 0 sent, 1 delivered, 2 open, 3 click, 4 convert, 5 revenue (ledger rows per block, day and channel; fat rows by exposure index)
  function planLog(pl, col, amt) {
    for (var j = 0; j < pl.n; j++) {
      pl.perf[j][col] += amt;
      if (col >= 1 && col <= 4) pl.fat[j][pl.ki[j]][col - 1] += amt;
    }
  }
  function planExposed(pl, i) { for (var j = 0; j < pl.n; j++) { var a = pl.exp[j]; if (a[i] < 255) a[i]++; } }
  SIM._contentPlan = contentPlan;

  function daysTotal(c) { return Math.max(1, (c.endTick - c.startTick) / 24); }

  // Latent paid response curves R(S) = A·(1 − e^{−S/B}) per paid channel. Writes and returns the map.
  SIM.curvesFor = function (world, c) {
    var out = {};
    if (!c || !Array.isArray(c.channels)) return out;
    CH().PAID.forEach(function (ch) {
      if (c.channels.indexOf(ch) < 0) return;
      var rng = MC.rng.fork(seedOf(world), 'curve', c.id, ch);
      var rr = CONST.roas[ch];
      var roas = rng.range(rr[0], rr[1]);
      var bf = rng.range(CONST.curveB[0], CONST.curveB[1]);
      var by = (c.budget && c.budget.byChannel && c.budget.byChannel[ch]) || 0;
      var planned = by / daysTotal(c);
      var B = planned > 0 ? bf * planned : 100;
      var A = planned > 0 ? roas * planned / (1 - Math.exp(-planned / B)) : 0;
      out[c.id + '|' + ch] = { A: A, B: B };
    });
    if (world.latent) {
      if (!world.latent.curves) world.latent.curves = {};
      sortedKeys(out).forEach(function (k) { world.latent.curves[k] = out[k]; });
    }
    return out;
  };

  /* ======================= metrics helpers ======================= */
  function dayEntry(world, d) {
    var days = world.metrics.days, idx = T().dayIndex(d);
    if (idx < 0) return null;
    while (days.length <= idx) {
      var dd = T().DAY0 + days.length;
      days.push({ day: dd, tot: newFact(), org: newFact(), c: {} });
    }
    return days[idx];
  }
  SIM._dayEntry = dayEntry;

  function campDay(e, cid) {
    var cd = e.c[cid];
    if (!cd) {
      cd = { tot: newFact(), trt: {}, ctl: {}, ch: {}, v: {}, attrLast: {}, attrLin: {}, steps: {} };
      e.c[cid] = cd;
    }
    return cd;
  }
  function fact(o, k) { var f = o[k]; if (!f) { f = newFact(); o[k] = f; } return f; }
  function stepRow(cd, sid) { var r = cd.steps[sid]; if (!r) { r = [0, 0, 0]; cd.steps[sid] = r; } return r; }

  function hoursOf(world, cid, ch) {
    var H = world.metrics.hours || (world.metrics.hours = {});
    var hc = H[cid] || (H[cid] = {});
    return hc[ch] || (hc[ch] = new Float64Array(48));
  }

  // Cost booked on days before d for a campaign channel.
  function spentBefore(world, cid, ch, d) {
    var days = world.metrics.days, k = F().COST, s = 0;
    var end = Math.min(days.length, T().dayIndex(d));
    for (var i = 0; i < end; i++) {
      var cd = days[i].c && days[i].c[cid];
      var f = cd && cd.ch && cd.ch[ch];
      if (f) s += f[k];
    }
    return s;
  }

  // Remaining channel budget spread over the remaining days (ignores pause; used for the shared quota).
  function budgetRaw(world, c, ch, d) {
    var by = (c.budget && c.budget.byChannel && c.budget.byChannel[ch]) || 0;
    if (!(by > 0)) return 0;
    var daysLeft = T().dayOf(c.endTick - 1) - d + 1;
    return Math.max(0, by - spentBefore(world, c.id, ch, d)) / Math.max(1, daysLeft);
  }

  SIM.dailyBudget = function (world, cid, ch, d) {
    var c = camp(world, cid);
    if (!c || c.status !== 'live') return 0;
    if (c.channelPaused && c.channelPaused[ch]) return 0;
    if (d === undefined || d === null) d = T().dayOf(world.meta.tick);
    return budgetRaw(world, c, ch, d);
  };

  /* ======================= audiences & enrollment ======================= */
  function segBits(world, segId, cache) {
    if (cache && cache[segId]) return cache[segId];
    var s = world.segments && world.segments.byId[segId];
    if (!s) return null;
    var b = null;
    try {
      if (MC.segments && typeof MC.segments.evaluate === 'function') b = MC.segments.evaluate(world, s.rule).bits;
      else if (MC.segments && typeof MC.segments.members === 'function') b = MC.segments.members(world, segId);
    } catch (e) { b = null; }
    if (cache && b) cache[segId] = b;
    return b;
  }

  // segmentId ∪ include − suppress, evaluated now.
  function audienceBits(world, c, cache) {
    var n = world.profiles.n, out = new Uint8Array(n), i, k, b;
    var inc = [c.segmentId].concat(c.include || []);
    for (k = 0; k < inc.length; k++) {
      if (!inc[k]) continue;
      b = segBits(world, inc[k], cache);
      if (b) for (i = 0; i < n; i++) if (b[i]) out[i] = 1;
    }
    var sup = c.suppress || [];
    for (k = 0; k < sup.length; k++) {
      b = segBits(world, sup[k], cache);
      if (b) for (i = 0; i < n; i++) if (b[i]) out[i] = 0;
    }
    return out;
  }
  SIM.audienceBits = audienceBits;

  function ensureEnroll(world, cid) {
    if (!world.enroll) world.enroll = {};
    var E = world.enroll[cid];
    if (!E) {
      var n = world.profiles.n;
      E = { step: new Int16Array(n), due: new Int32Array(n), ctl: new Uint8Array(n), flags: new Uint8Array(n),
        rev: new Float32Array(n), all: new Float32Array(n), order: new Int32Array(0), entered: 0, exited: 0 };
      E.step.fill(-1);
      world.enroll[cid] = E;
    }
    return E;
  }

  function entryIndex(c) {
    var steps = (c.journey && c.journey.steps) || [];
    for (var k = 0; k < steps.length; k++) if (steps[k].type === 'entry') return k;
    return 0;
  }

  // Universal holdout: a fixed share of profiles (stable hash of the profile id) that no campaign messages on owned
  // channels. They still see organic and paid. The flag array is cached on the world under a "_" key (not digested).
  function universalHoldoutBits(world) {
    var P = world.profiles, n = P.n, pct = (world.meta && typeof world.meta.universalHoldoutPct === 'number') ? world.meta.universalHoldoutPct : 5;
    var u = world._uh;
    if (u && u.n === n && u.pct === pct && u.id === P.id) return u.bits;
    var bits = new Uint8Array(n), fnv = U().fnv1a;
    for (var i = 0; i < n; i++) bits[i] = (fnv(P.id[i] + '|uh') % 100) < pct ? 1 : 0;
    world._uh = { n: n, pct: pct, id: P.id, bits: bits };
    return bits;
  }
  SIM.universalHoldoutBits = universalHoldoutBits;
  SIM.inUniversalHoldout = function (world, i) { return universalHoldoutBits(world)[i] === 1; };

  function holdoutOf(world, c) {
    if (typeof c.holdoutPct === 'number') return c.holdoutPct;
    return (world.guardrails && typeof world.guardrails.holdoutPct === 'number') ? world.guardrails.holdoutPct : 10;
  }

  // Adds audience members with step === -1; returns the number enrolled.
  function enrollNew(world, c, tick, cache) {
    var P = world.profiles, n = P.n;
    var E = ensureEnroll(world, c.id);
    var bits = audienceBits(world, c, cache);
    var entry = entryIndex(c), hold = holdoutOf(world, c), fnv = U().fnv1a, count = 0;
    for (var i = 0; i < n; i++) {
      if (!bits[i] || E.step[i] !== -1) continue;
      E.step[i] = entry; E.due[i] = tick;
      E.ctl[i] = (fnv(P.id[i] + '|' + c.id) % 100) < hold ? 1 : 0;
      count++;
    }
    E.entered += count;
    return count;
  }

  // Active members (step >= 0) by propensity descending, ties by index.
  function buildOrder(world, cid) {
    var E = world.enroll && world.enroll[cid];
    if (!E) return;
    var prop = world.profiles.prop, idx = [];
    for (var i = 0; i < E.step.length; i++) if (E.step[i] >= 0) idx.push(i);
    idx.sort(function (a, b) { var d = (prop ? prop[b] - prop[a] : 0); return d !== 0 ? d : a - b; });
    E.order = Int32Array.from(idx);
    E._ads = null;
  }

  SIM.enroll = function (world, cid, tick) {
    var c = camp(world, cid);
    if (!c) return 0;
    if (tick === undefined || tick === null) tick = world.meta.tick;
    var count = enrollNew(world, c, tick);
    buildOrder(world, cid);
    U().bump(world, 'enroll');
    return count;
  };

  /* ======================= sampling tables ======================= */
  // Ads table: treatment members with ads consent, weighted by propensity.
  function adsTable(world, cid) {
    var E = world.enroll && world.enroll[cid];
    if (!E) return null;
    if (E._ads) return E._ads;
    var P = world.profiles, bit = CH().BIT.social, n = E.step.length;
    var idx = [], w = [];
    for (var i = 0; i < n; i++) {
      if (E.step[i] === -1 || E.ctl[i]) continue;
      if (!(P.consent[i] & bit) || (P.unsub[i] & bit)) continue;
      idx.push(i); w.push(Math.max(1e-4, P.prop ? P.prop[i] : 0.05));
    }
    var cum = new Float64Array(idx.length), s = 0;
    for (var k = 0; k < idx.length; k++) { s += w[k]; cum[k] = s; }
    E._ads = { idx: Int32Array.from(idx), cum: cum, total: s };
    return E._ads;
  }

  function pickCum(tab, u) {
    var x = u * tab.total, lo = 0, hi = tab.cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (tab.cum[mid] > x) hi = mid; else lo = mid + 1; }
    return lo;
  }

  function recencyOf(world, i, d) {
    var lo = world.profiles.lastOrder[i];
    if (lo === NEVER()) return 365;
    return Math.min(365, Math.max(0, d - lo));
  }

  // Organic daily hazard table η_i, cached per day under a "_" key (excluded from digests).
  function organicTable(world, d) {
    var o = world._organic;
    if (o && o.day === d && o.cum.length === world.profiles.n) return o;
    var P = world.profiles, L = world.latent && world.latent.profiles, n = P.n, K = CONST.organic;
    var cum = new Float64Array(n), s = 0;
    for (var i = 0; i < n; i++) {
      var maxAff = 0;
      for (var c = 0; c < 5; c++) { var a = P.aff[i * 5 + c]; if (a > maxAff) maxAff = a; }
      var p0 = L && L.p0 ? L.p0[i] : 0;
      s += sig(K.base + K.p0 * p0 + K.aff * maxAff + K.recency * recencyOf(world, i, d));
      cum[i] = s;
    }
    o = { day: d, cum: cum, total: s };
    world._organic = o;
    return o;
  }

  /* ======================= profile events ======================= */
  function allIndex(world, cid) {
    var all = world.campaigns.all || world.campaigns.order;
    return all.indexOf(cid);
  }

  function pushTouch(world, i, allIdx, ci, t) {
    var P = world.profiles, slot = P.tPtr[i] % 8, k = i * 8 + slot;
    P.touchC[k] = allIdx; P.touchCh[k] = ci; P.touchT[k] = t;
    P.tPtr[i] = (slot + 1) % 8;
  }

  // Credits revenue over the touch ring: last touch (100%) and linear (equal shares) within 168 ticks.
  function attribute(world, i, rev, t, e) {
    if (!(rev > 0)) return;
    var P = world.profiles, all = world.campaigns.all || world.campaigns.order;
    var hits = [], last = -1, lastT = -Infinity, chs = CH().ALL;
    // Walk the ring oldest -> newest so that on equal ticks the most recently written touch wins.
    var start = P.tPtr[i] % 8;
    for (var j = 0; j < 8; j++) {
      var k = i * 8 + ((start + j) % 8), c = P.touchC[k];
      if (c < 0 || c >= all.length) continue;
      var tt = P.touchT[k];
      if (t - tt > CONST.attrWindow || tt > t) continue;
      hits.push(k);
      if (tt >= lastT) { lastT = tt; last = k; }
    }
    if (!hits.length) return;
    var cdL = campDay(e, all[P.touchC[last]]), chL = chs[P.touchCh[last]] || 'email';
    cdL.attrLast[chL] = (cdL.attrLast[chL] || 0) + rev;
    var share = rev / hits.length;
    for (var h = 0; h < hits.length; h++) {
      var cd = campDay(e, all[P.touchC[hits[h]]]), ch = chs[P.touchCh[hits[h]]] || 'email';
      cd.attrLin[ch] = (cd.attrLin[ch] || 0) + share;
    }
  }

  // Books an order on the profile; returns 1 when it reactivates a lapsed customer.
  function bookOrder(world, i, rev, d) {
    var P = world.profiles, prev = P.lastOrder[i];
    var react = (prev === NEVER() || prev <= d - CONST.reactDays) ? 1 : 0;
    P.lastOrder[i] = d;
    if (P.orders[i] < 65535) P.orders[i] += 1;
    P.spend[i] += rev;
    P.aov[i] = P.orders[i] > 0 ? P.spend[i] / P.orders[i] : rev;
    // "Purchased" decisions in every journey the profile is in.
    var en = world.enroll || {}, ord = world.campaigns.order;
    for (var k = 0; k < ord.length; k++) {
      var E = en[ord[k]];
      if (!E || E.step[i] === -1) continue;
      E.flags[i] |= 4;
      var cc = world.campaigns.byId[ord[k]];
      if (E.all && cc && (cc.status === 'live' || cc.status === 'paused')) E.all[i] += rev;   // everything this person spent while the campaign ran
    }
    return react;
  }

  function add(list, k, v) { for (var j = 0; j < list.length; j++) list[j][k] += v; }

  /* ======================= journey engine (owned channels) ======================= */
  var stepIdxCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function stepIndex(steps) {
    if (stepIdxCache && stepIdxCache.has(steps)) return stepIdxCache.get(steps);
    var m = {};
    for (var k = 0; k < steps.length; k++) m[steps[k].id] = k;
    if (stepIdxCache) stepIdxCache.set(steps, m);
    return m;
  }

  var SKIP = 0, WAIT = 1, SENT = 2;
  var CPQ = { o: 0, c: 0, v: 0 };   // scratch for planFx
  var OWNED_NAMES = ['email', 'sms', 'push'];

  function ownedCampaign(world, c, t, h, d, G) {
    var E = world.enroll && world.enroll[c.id];
    var steps = c.journey && c.journey.steps;
    if (!E || !E.order.length || !steps || !steps.length) return;
    var sidx = stepIndex(steps);
    var P = world.profiles, LP = (world.latent && world.latent.profiles) || {}, g = world.guardrails || {};
    var f = F(), chIdx = CH().IDX, BIT = CH().BIT;
    var e = dayEntry(world, d), cd = campDay(e, c.id), allIdx = allIndex(world, c.id);
    var uh = universalHoldoutBits(world);
    var quiet = g.quiet || { start: 21, end: 8, channels: ['sms', 'push'] };
    var freqCap = g.freqCap || { email: 4, sms: 2, push: 5 };
    var ctlPol = c.ctl || {};
    var pol = [
      { alloc: c.alloc || {}, sendHour: c.sendHour || {}, paused: c.channelPaused || {} },
      { alloc: ctlPol.alloc || {}, sendHour: ctlPol.sendHour || {}, paused: ctlPol.channelPaused || {} }
    ];
    var elig = [{}, {}], quota = {}, rng = null, sentHere = 0, seasonD = SIM.season(d);
    var slot7 = ((d % 7) + 7) % 7;
    var nextDay = T().tickOf(d + 1, 0);

    function eligible(k, ch) {
      if (elig[k][ch] !== undefined) return elig[k][ch];
      var a = pol[k].alloc[ch] || {}, vs = [], ws = [];
      sortedKeys(a).forEach(function (vid) {
        var v = world.variants.byId[vid];
        if (!v || v.channel !== ch || !(a[vid] > 0)) return;
        if ((k ? v.ctlStatus : v.status) !== 'live') return;
        vs.push(v); ws.push(a[vid]);
      });
      elig[k][ch] = vs.length ? { vs: vs, ws: ws } : null;
      return elig[k][ch];
    }
    function quotaLeft(ch) {
      if (quota[ch] === undefined) {
        var q = Math.floor(budgetRaw(world, c, ch, d) / CONST.unitCost[ch] + 1e-9);
        quota[ch] = q - (cd.ch[ch] ? cd.ch[ch][f.SENT] : 0);
      }
      return quota[ch];
    }
    function quietFor(ch) { return (quiet.channels || []).indexOf(ch) >= 0; }
    // The one hour a profile may receive an adaptive send (clamped out of quiet hours for sms/push).
    function adaptiveHour(i, ch) {
      var bh = P.bestHr ? P.bestHr[i] % 24 : CONST.ctlSendHour;
      if (quietFor(ch) && T().inQuiet(bh, quiet)) bh = bh < 12 ? quiet.end : (quiet.start + 23) % 24;
      return bh;
    }
    function hourOk(hr, i, ch, k) {
      if (quietFor(ch) && T().inQuiet(hr, quiet)) return false;
      var sh = pol[k].sendHour[ch];
      if (sh === 'adaptive') return hr === adaptiveHour(i, ch);
      if (typeof sh !== 'number') sh = CONST.ctlSendHour;
      return ((hr - sh + 24) % 24) < CONST.sendWindow;
    }
    function nextOk(i, ch, k) {
      for (var j = 1; j <= 48; j++) if (hourOk((h + j) % 24, i, ch, k)) return t + j;
      return t + 24;
    }

    function trySend(i, s, k) {
      var ch = s.channel, ci = chIdx[ch], bit = BIT[ch];
      if (OWNED_NAMES.indexOf(ch) < 0 || c.channels.indexOf(ch) < 0 || pol[k].paused[ch]) return SKIP;
      if (uh[i]) return SKIP;
      var el = eligible(k, ch);
      if (!el) return SKIP;
      if (!(P.consent[i] & bit) || (P.unsub[i] & bit)) return SKIP;
      var sup = P.supUntil[i * 3 + ci];
      if (!k && sup > t) { E.due[i] = sup; return WAIT; }
      var base7 = i * 21 + ci * 7, s7 = 0;
      for (var q = 0; q < 7; q++) s7 += P.sent7[base7 + q];
      if (s7 >= (freqCap[ch] || 99)) { E.due[i] = nextDay; return WAIT; }
      if (!hourOk(h, i, ch, k)) { E.due[i] = nextOk(i, ch, k); return WAIT; }
      if (quotaLeft(ch) <= 0) { E.due[i] = nextDay; return WAIT; }

      if (!rng) rng = MC.rng.fork(seedOf(world), 'sim', c.id, t);
      var vi = rng.weighted(el.ws), v = el.vs[vi < 0 ? 0 : vi];
      var Lv = latentOf(world, v);
      var CPL = v.messageId ? contentPlan(world, v, d, true) : null, dq = null;
      if (CPL) { dq = planFx(world, CPL, i, CPQ); planLog(CPL, 0, 1); }
      var facts = [cd.tot, fact(cd.ch, ch), fact(k ? cd.ctl : cd.trt, ch), fact(cd.v, v.id), e.tot];
      var cost = CONST.unitCost[ch], Fi = P.fatigue[i];
      add(facts, f.SENT, 1); add(facts, f.COST, cost);
      stepRow(cd, s.id)[0]++;
      var hrs = hoursOf(world, c.id, ch);
      hrs[h] += 1;
      if (P.sent7[base7 + slot7] < 255) P.sent7[base7 + slot7]++;
      var eb = i * 9 + ci * 3;
      if (P.eng[eb] < 65535) P.eng[eb]++;
      quota[ch]--; sentHere++; G.left--;

      if (rng.float() < CONST.pd[ch]) {
        add(facts, f.DELIV, 1);
        if (CPL) planLog(CPL, 1, 1);
        pushTouch(world, i, allIdx, ci, t);
        var ph = LP.ph ? LP.ph[i] : 12, engI = LP.eng ? LP.eng[i] : 0;
        var dc = dcirc(h, ph), hourFit = Math.exp(-(dc * dc) / 8);
        var pOpen = ch === 'sms' ? CONST.smsOpen
          : sig(CONST.a[ch] + CONST.engW * engI + Lv.qo + (dq ? dq.o : 0) + CONST.hourW * (hourFit - 0.5) - CONST.fatW * Fi);
        if (rng.float() < pOpen) {
          add(facts, f.OPEN, 1);
          if (CPL) planLog(CPL, 2, 1);
          hrs[24 + h] += 1;
          if (P.openHr[i * 24 + h] < 255) P.openHr[i * 24 + h]++;
          if (P.eng[eb + 1] < 65535) P.eng[eb + 1]++;
          E.flags[i] |= 1;
          var prod = productFor(world, v, c, i);
          var aff = Math.max(CONST.affFloor, P.aff[i * 5 + prod.ci] || 0);
          var cf = Math.max(CONST.cfFloor, LP.cf ? LP.cf[i * 5 + ci] : 0.5);
          var pClick = sig(CONST.b[ch] + Lv.qc + (dq ? dq.c : 0) + CONST.affW * Math.log(5 * aff) + CONST.cfW * Math.log(cf));
          if (rng.float() < pClick) {
            add(facts, f.CLICK, 1);
            if (CPL) planLog(CPL, 3, 1);
            if (P.eng[eb + 2] < 65535) P.eng[eb + 2]++;
            E.flags[i] |= 2;
            var offer = v.offer || c.offer || 'none';
            var p0 = LP.p0 ? LP.p0[i] : 0, ps = LP.priceSens ? LP.priceSens[i] : 0;
            var pConv = Math.min(CONST.convMax, sig(CONST.convBase + CONST.convP0 * p0 + Lv.qv + (dq ? dq.v : 0) + (CONST.offerLift[offer] || 0) -
              CONST.priceSensW * ps * (offer === 'none' ? 1 : 0)) * seasonD);
            if (rng.float() < pConv) {
              var rev = prod.price * rng.lognormal(0, CONST.revSd) * (1 - (CONST.discount[offer] || 0));
              var react = bookOrder(world, i, rev, d);
              add(facts, f.CONV, 1); add(facts, f.REV, rev); add(facts, f.REACT, react);
              if (CPL) { planLog(CPL, 4, 1); planLog(CPL, 5, rev); }
              E.rev[i] += rev;
              attribute(world, i, rev, t, e);
            }
          }
        }
        if (CPL) planExposed(CPL, i);
        if (rng.float() < CONST.unsubBase * (1 + CONST.unsubFat * Fi) * (1 + spamOf(v))) {
          P.unsub[i] |= bit;
          add(facts, f.UNSUB, 1);
        }
      }
      P.fatigue[i] = Fi + 1;
      return SENT;
    }

    // Moves profile i to the step with id `id`; a missing target exits the journey.
    function go(i, id) {
      var k = (id === undefined || id === null) ? undefined : sidx[id];
      if (k === undefined) { E.step[i] = -2; E.exited++; return false; }
      E.step[i] = k;
      return true;
    }

    function decide(i, s) {
      var r = s.rule || {}, yes = false, target;
      if (r.kind === 'bestChannel') {
        var b = P.bestCh ? P.bestCh[i] : 255;
        var name = OWNED_NAMES[b];
        target = (name && s.branches && s.branches[name]) || null;
        yes = !!target;
        if (!target) target = s.no;
      } else {
        if (r.kind === 'opened') yes = !!(E.flags[i] & 1);
        else if (r.kind === 'clicked') yes = !!(E.flags[i] & 2);
        else if (r.kind === 'purchased') yes = !!(E.flags[i] & 4);
        else if (r.kind === 'consent') { var bt = BIT[r.value] || 0; yes = !!(P.consent[i] & bt) && !(P.unsub[i] & bt); }
        else if (r.kind === 'propensityAbove') yes = (P.prop ? P.prop[i] : 0) > (+r.value || 0);
        target = yes ? s.yes : s.no;
      }
      stepRow(cd, s.id)[yes ? 1 : 2]++;
      return target;
    }

    var order = E.order, step = E.step, due = E.due, ctl = E.ctl, maxTr = CONST.maxTransitions;
    for (var oi = 0; oi < order.length; oi++) {
      if (sentHere >= CONST.capCampaign || G.left <= 0) break;
      var i = order[oi];
      if (step[i] < 0 || due[i] > t) continue;
      var k = ctl[i] ? 1 : 0, tr = 0;
      for (;;) {
        if (tr >= maxTr) { due[i] = t + 1; break; }
        tr++;
        var s = steps[step[i]];
        if (!s) { step[i] = -2; E.exited++; break; }
        if (s.type === 'entry') { if (!go(i, s.next)) break; }
        else if (s.type === 'wait') { if (!go(i, s.next)) break; due[i] = t + Math.max(1, s.waitH | 0); break; }
        else if (s.type === 'exit') { step[i] = -2; E.exited++; break; }
        else if (s.type === 'decide') { if (!go(i, decide(i, s))) break; }
        else if (s.type === 'send') {
          if (sentHere >= CONST.capCampaign || G.left <= 0) break;   // cap: stays due, retried next tick
          var res = trySend(i, s, k);
          if (res === WAIT) break;
          if (!go(i, s.next)) break;
        } else { step[i] = -2; E.exited++; break; }
      }
    }
  }

  /* ======================= paid channels ======================= */
  function campaignAov(world, c) {
    var pi = prodInfo(world);
    if (c.productFocus && pi.byId[c.productFocus]) return pi.byId[c.productFocus].price || pi.mean;
    return pi.mean || 100;
  }

  // Day-to-day spend variation on paid channels: a weekday effect (index 0 is Sunday), a slow channel drift and auction noise,
  // all deterministic per campaign, channel and day, so spend differs from the even plan and marginal
  // returns can be compared. The remaining budget is re-spread each day, so totals still land on plan.
  var PAID_DOW = { social: [1.10, 0.92, 0.95, 1.00, 1.00, 1.08, 1.18], web: [0.88, 1.12, 1.08, 1.04, 1.00, 0.96, 0.84] };
  function paidDayFactor(world, c, ch, d) {
    var dow = T().dowOfDay(d);
    var wk = (PAID_DOW[ch] || PAID_DOW.social)[dow];
    var rng = MC.rng.fork(seedOf(world), 'paidDay', c.id, ch, d);
    var noise = 0.6 + 0.8 * rng.float();
    var drift = 1 + 0.15 * Math.sin((d + (ch === 'web' ? 2 : 0)) * 0.9 + (c.id.length + ch.length));
    // Auction spend also follows seasonal demand, which keeps spend and revenue moving together.
    return Math.max(0.4, Math.min(1.9, wk * noise * drift * Math.pow(SIM.season(d) / 1.1, 0.8)));
  }

  function paidCampaign(world, c, t, h, d) {
    var f = F(), e = dayEntry(world, d), cd = campDay(e, c.id), allIdx = allIndex(world, c.id);
    CH().PAID.forEach(function (ch) {
      if (c.channels.indexOf(ch) < 0 || (c.channelPaused && c.channelPaused[ch])) return;
      var S = SIM.dailyBudget(world, c.id, ch, d);
      if (!(S > 0)) return;
      S = Math.min(S * paidDayFactor(world, c, ch, d), S * Math.max(1, T().dayOf(c.endTick - 1) - d + 1));
      var key = c.id + '|' + ch;
      var curve = (world.latent && world.latent.curves && world.latent.curves[key]) || SIM.curvesFor(world, c)[key];
      if (!curve) return;
      var spend = S * HOUR_SHAPE[h];
      var rng = MC.rng.fork(seedOf(world), 'paid', c.id, ch, t);

      var a = (c.alloc && c.alloc[ch]) || {}, vs = [], ws = [], qsum = 0, liveN = 0;
      MC.catalog.variantsOf(world, c.id, ch).forEach(function (v) {
        if (v.status !== 'live') return;
        var pplan = v.messageId ? contentPlan(world, v, d, false) : null;
        qsum += latentOf(world, v).qc + (pplan ? pplan.sumC : 0); liveN++;
        if (a[v.id] > 0) { vs.push(v); ws.push(a[v.id]); }
      });
      var creativeQ = liveN ? Math.exp(qsum / liveN) : 1;
      var aov = campaignAov(world, c);
      var R = curve.B > 0 ? curve.A * (1 - Math.exp(-S / curve.B)) : 0;
      var lam = R * creativeQ * SIM.season(d) * HOUR_SHAPE[h] / Math.max(1, aov);
      var impr = spend / CONST.cpm[ch] * 1000;
      var clicks = rng.binomial(Math.round(impr), CONST.ctrPaid[ch]);
      // Auction demand is steadier than a pure Poisson count: orders are spread through the day by systematic
      // sampling from a per-day offset, so the daily total tracks spend (within one order) rather than jittering.
      var lamDay = lam / HOUR_SHAPE[h], u0 = MC.rng.fork(seedOf(world), 'paidOrd', c.id, ch, d).float();
      var conv = Math.floor(u0 + lamDay * HOUR_CUM[h + 1]) - Math.floor(u0 + lamDay * HOUR_CUM[h]);
      var chF = fact(cd.ch, ch), facts = [cd.tot, chF, e.tot];
      add(facts, f.COST, spend); add(facts, f.IMPR, impr); add(facts, f.CLICK, clicks);
      var wsum = 0, j;
      for (j = 0; j < ws.length; j++) wsum += ws[j];
      for (j = 0; j < vs.length; j++) {
        var vf = fact(cd.v, vs[j].id), sh = ws[j] / wsum;
        vf[f.COST] += spend * sh; vf[f.IMPR] += impr * sh; vf[f.CLICK] += clicks * sh;
      }
      if (!conv) return;
      var tab = adsTable(world, c.id), E = world.enroll && world.enroll[c.id];
      for (var n = 0; n < conv; n++) {
        var vi = vs.length ? rng.weighted(ws) : -1, v = vi >= 0 ? vs[vi] : null;
        var offer = (v && v.offer) || c.offer || 'none', disc = 1 - (CONST.discount[offer] || 0);
        var rev, react = 0;
        if (tab && tab.total > 0) {
          var i = tab.idx[pickCum(tab, rng.float())];
          var prod = productFor(world, v, c, i);
          rev = prod.price * rng.lognormal(0, CONST.revSd * 0.5) * disc;
          pushTouch(world, i, allIdx, CH().IDX[ch], t);
          react = bookOrder(world, i, rev, d);
          if (E) E.rev[i] += rev;
          attribute(world, i, rev, t, e);
        } else {
          rev = aov * rng.lognormal(0, CONST.revSd * 0.5) * disc;
        }
        var cf = v ? [cd.tot, chF, e.tot, fact(cd.v, v.id)] : facts;
        add(cf, f.CONV, 1); add(cf, f.REV, rev); add(cf, f.REACT, react);
      }
    });
  }

  /* ======================= organic orders ======================= */
  function organic(world, t, h, d) {
    var tab = organicTable(world, d);
    if (!(tab.total > 0)) return 0;
    var rng = MC.rng.fork(seedOf(world), 'organic', t);
    var nOrd = rng.poisson(tab.total * SIM.season(d) * HOUR_SHAPE[h]);
    if (!nOrd) return 0;
    var f = F(), e = dayEntry(world, d), pi = prodInfo(world);
    for (var k = 0; k < nOrd; k++) {
      var i = pickCum(tab, rng.float());
      var prod = topProductOf(world, i);
      var rev = (prod ? prod.price : pi.mean) * rng.lognormal(0, CONST.revSd);
      var react = bookOrder(world, i, rev, d);
      var facts = [e.org, e.tot];
      add(facts, f.CONV, 1); add(facts, f.REV, rev); add(facts, f.REACT, react);
      attribute(world, i, rev, t, e);
    }
    return nOrd;
  }

  /* ======================= status transitions ======================= */
  var GOAL_IDX = { revenue: 'REV', conversions: 'CONV', reactivation: 'REACT', engagement: 'CLICK', launch: 'CONV' };
  function goalValue(world, c) {
    var k = F()[GOAL_IDX[c.goal && c.goal.type] || 'REV'], days = world.metrics.days, s = 0;
    for (var i = 0; i < days.length; i++) { var cd = days[i].c && days[i].c[c.id]; if (cd) s += cd.tot[k]; }
    return s;
  }
  SIM.goalValue = goalValue;

  function campaignOfProposal(world, p) {
    var tg = p.target || {};
    if (tg.kind === 'campaign') return tg.id;
    if (tg.kind === 'variant') { var v = world.variants.byId[tg.id]; return v ? v.campaignId : null; }
    var acts = p.actions || [];
    for (var j = 0; j < acts.length; j++) {
      var pl = acts[j].payload || {};
      if (pl.variant && pl.variant.campaignId) return pl.variant.campaignId;
      if (typeof pl.campaignId === 'string') return pl.campaignId;
      if (typeof pl.id === 'string' && /^c-/.test(pl.id) && acts[j].type.indexOf('campaign/') === 0) return pl.id;
    }
    return null;
  }
  SIM.campaignOfProposal = campaignOfProposal;

  function statusStep(world, t, d) {
    var order = world.campaigns.order.slice(), feed = MC.catalog.addFeed;
    order.forEach(function (cid) {
      var c = camp(world, cid);
      if (!c) return;
      if (c.status === 'scheduled' && c.startTick <= t) {
        var r = MC.catalog.apply(world, { type: 'campaign/setStatus', payload: { id: cid, status: 'live' } }, { origin: 'sim', tick: t });
        if (r.ok) {
          var E = world.enroll && world.enroll[cid];
          feed(world, { tick: t, kind: 'campaign', entity: { kind: 'campaign', id: cid }, tone: 'good',
            text: c.name + ' went live with ' + MC.fmt.num(E ? E.entered : 0) + ' people in its journey' });
        }
      } else if ((c.status === 'live' || c.status === 'paused') && c.endTick <= t) {
        var r2 = MC.catalog.apply(world, { type: 'campaign/setStatus', payload: { id: cid, status: 'completed' } }, { origin: 'sim', tick: t });
        if (r2.ok) {
          var tgt = c.goal && c.goal.target > 0 ? c.goal.target : 0;
          var pct = tgt ? goalValue(world, c) / tgt : 0;
          feed(world, { tick: t, kind: 'campaign', entity: { kind: 'campaign', id: cid }, tone: pct >= 1 ? 'good' : (pct >= 0.85 ? 'neutral' : 'warn'),
            text: c.name + ' completed at ' + MC.fmt.pct(pct, 0) + ' of goal' });
        }
      }
    });
    // Pending proposals whose campaign is now completed or removed expire.
    var open = (world.proposals && world.proposals.open) || [];
    open.slice().forEach(function (pid) {
      var p = world.proposals.byId[pid];
      if (!p || p.status !== 'pending') return;
      var cid = campaignOfProposal(world, p);
      if (!cid) return;
      var c = camp(world, cid);
      if (c && c.status !== 'completed') return;
      var reason = c ? 'Expired: the campaign has ended.' : 'Expired: the campaign was deleted.';
      if (MC.runtime && typeof MC.runtime.expire === 'function') MC.runtime.expire(world, pid, reason, t);
      else MC.catalog.closeProposal(world, p, { status: 'expired', reason: reason, decidedTick: t });
    });
  }

  /* ======================= day roll (§10.6 step 2) ======================= */
  SIM.dayRoll = function (world, d) {
    var P = world.profiles, n = P.n, i, k;
    // 1. metrics entry for the new day (+ entries for running campaigns)
    var e = dayEntry(world, d);
    world.campaigns.order.forEach(function (cid) {
      var c = camp(world, cid);
      if (c && (c.status === 'live' || c.status === 'paused')) campDay(e, cid);
    });
    // 2. fatigue decay
    for (i = 0; i < n; i++) P.fatigue[i] *= CONST.fatigueDecay;
    // 3. clear today's 7-day send slot
    var slot = ((d % 7) + 7) % 7;
    for (i = 0; i < n; i++) { var b = i * 21 + slot; P.sent7[b] = 0; P.sent7[b + 7] = 0; P.sent7[b + 14] = 0; }
    // 4. hour histograms decay
    var H = world.metrics.hours || {};
    sortedKeys(H).forEach(function (cid) {
      sortedKeys(H[cid]).forEach(function (ch) { var a = H[cid][ch]; for (var j = 0; j < a.length; j++) a[j] *= CONST.hoursDecay; });
    });
    // 5. visits30
    var rng = MC.rng.fork(seedOf(world), 'day', d), LP = (world.latent && world.latent.profiles) || {};
    for (i = 0; i < n; i++) {
      var lam = CONST.visits.base + CONST.visits.eng * sig(LP.eng ? LP.eng[i] : 0);
      P.visits30[i] = Math.min(255, Math.round(P.visits30[i] * 29 / 30 + rng.poisson(lam)));
    }
    // 6. rescoring (weekly warm refit on Mondays)
    var M = MC.models || {};
    try {
      if (T().dowOfDay(d) === 1 && typeof M.fitPropensity === 'function') {
        var ms = world.modelState || {};
        var coef = M.fitPropensity(world, ms.coef);
        if (coef && coef.length && ms.coef && coef !== ms.coef) for (k = 0; k < ms.coef.length && k < coef.length; k++) ms.coef[k] = coef[k];
      }
      if (typeof M.scoreProfiles === 'function') M.scoreProfiles(world);
    } catch (err) { if (window.console) console.error(err); }
    // 7. segment recounts (no ver change: counts are not authored fields)
    var cache = {};
    if (world.segments && world.segments.order.length && MC.segments && typeof MC.segments.evaluate === 'function') {
      var ss = world.segments, byId = assign({}, ss.byId);
      ss.order.forEach(function (id) {
        var s = byId[id];
        if (!s) return;
        var r;
        try { r = MC.segments.evaluate(world, s.rule); } catch (err) { r = null; }
        if (!r) return;
        cache[id] = r.bits;
        var hist = (s.countHist || []).concat([r.count]);
        if (hist.length > 8) hist = hist.slice(hist.length - 8);
        byId[id] = assign({}, s, { count: r.count, countDay: d, countHist: hist });
      });
      world.segments = assign({}, ss, { byId: byId });
      U().bump(world, 'segCounts');
    }
    // 8–9. dynamic entry and daily re-ordering
    var t0 = T().tickOf(d, 0);
    world.campaigns.order.forEach(function (cid) {
      var c = camp(world, cid);
      if (!c) return;
      if (c.status === 'live') enrollNew(world, c, t0, cache);
      if (c.status === 'live' || c.status === 'paused') buildOrder(world, cid);
    });
    // 10. organic hazard table (ads tables were reset by buildOrder and rebuild lazily)
    world._organic = null;
    organicTable(world, d);
    U().bump(world, 'metrics', 'profiles', 'enroll');
  };

  /* ======================= hourly step (§10.6 steps 3–7) ======================= */
  SIM.step = function (world, t) {
    if (t === undefined || t === null) t = world.meta.tick;
    var h = T().hourOf(t), d = T().dayOf(t);
    var e = dayEntry(world, d);
    statusStep(world, t, d);
    var live = [];
    world.campaigns.order.forEach(function (cid) {
      var c = camp(world, cid);
      if (!c) return;
      if (c.status === 'live' || c.status === 'paused') campDay(e, cid);
      if (c.status === 'live') live.push(c);
    });
    var G = { left: CONST.capGlobal };
    var conv0 = e.tot[F().CONV];
    for (var k = 0; k < live.length; k++) ownedCampaign(world, live[k], t, h, d, G);
    for (k = 0; k < live.length; k++) paidCampaign(world, live[k], t, h, d);
    organic(world, t, h, d);
    U().bump(world, 'metrics', 'profiles', 'enroll');
    return { sends: CONST.capGlobal - G.left, events: e.tot[F().CONV] - conv0 };
  };
})();
