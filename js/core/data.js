/* Marketing Cloud - MC.data: the synthetic Fernway Outfitters sample world (sample data only).
   Taxonomy, journey templates, 6,000 profiles with a hidden latent truth, 60 days of aggregate history
   (organic orders and the completed Fall Trail Running Sale), model fit and scores, nine seeded
   segments, six seeded campaigns with generated variants, and agent entities. Pure function of the
   seed: every draw comes from an MC.rng fork keyed by a stable string. No clock, no Math.random. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var D = MC.data = MC.data || {};

  /* ---------------- taxonomy (§10.10) ---------------- */
  D.NEVER = -9999;
  D.CATEGORIES = [
    { id: 'hike', label: 'Hiking' }, { id: 'camp', label: 'Camping' }, { id: 'climb', label: 'Climbing' },
    { id: 'run', label: 'Trail running' }, { id: 'apparel', label: 'Apparel' }
  ];
  D.TIERS = [
    { id: 'base', label: 'Base', code: 0 }, { id: 'trailhead', label: 'Trailhead', code: 1 },
    { id: 'summit', label: 'Summit', code: 2 }, { id: 'peak', label: 'Peak', code: 3 }
  ];
  D.REGIONS = [
    { id: 'pnw', label: 'Pacific Northwest', states: ['WA', 'OR', 'ID'] },
    { id: 'west', label: 'West', states: ['CA', 'NV', 'AZ', 'UT'] },
    { id: 'mountain', label: 'Mountain', states: ['CO', 'MT', 'WY', 'NM'] },
    { id: 'midwest', label: 'Midwest', states: ['IL', 'MN', 'MI', 'WI', 'OH'] },
    { id: 'south', label: 'South', states: ['TX', 'GA', 'NC', 'TN', 'FL'] },
    { id: 'northeast', label: 'Northeast', states: ['NY', 'MA', 'VT', 'PA', 'ME'] }
  ];
  D.STATES = [];
  D.REGIONS.forEach(function (r) { r.states.forEach(function (s) { D.STATES.push(s); }); });
  D.CHANNELS = ['email', 'sms', 'push', 'social', 'web'];
  // Each category's first product is its "top product".
  D.PRODUCTS = [
    { id: 'p-trail-boot', name: 'Ridgeline Trail Boot', cat: 'hike', price: 159, margin: 0.46 },
    { id: 'p-day-pack', name: 'Switchback 28L Daypack', cat: 'hike', price: 119, margin: 0.5 },
    { id: 'p-trek-poles', name: 'Talus Carbon Trekking Poles', cat: 'hike', price: 99, margin: 0.52 },
    { id: 'p-water-filter', name: 'Creekside Water Filter', cat: 'hike', price: 45, margin: 0.55 },
    { id: 'p-hike-socks', name: 'Merino Hiking Socks 3-Pack', cat: 'hike', price: 36, margin: 0.6 },
    { id: 'p-camp-stove', name: 'Basecamp Two-Burner Stove', cat: 'camp', price: 89, margin: 0.42 },
    { id: 'p-tent-3p', name: 'Hollow Pine 3P Tent', cat: 'camp', price: 349, margin: 0.38 },
    { id: 'p-sleep-bag', name: 'Ember 20° Sleeping Bag', cat: 'camp', price: 219, margin: 0.44 },
    { id: 'p-camp-chair', name: 'Fireside Camp Chair', cat: 'camp', price: 69, margin: 0.5 },
    { id: 'p-lantern', name: 'Glowworm Camp Lantern', cat: 'camp', price: 39, margin: 0.56 },
    { id: 'p-harness', name: 'Granite Line Harness', cat: 'climb', price: 79, margin: 0.45 },
    { id: 'p-climb-shoe', name: 'Edgework Climbing Shoe', cat: 'climb', price: 149, margin: 0.43 },
    { id: 'p-rope', name: 'Dyno 9.8 Rope 60m', cat: 'climb', price: 229, margin: 0.36 },
    { id: 'p-chalk-bag', name: 'Crux Chalk Bag', cat: 'climb', price: 25, margin: 0.62 },
    { id: 'p-trail-shoe', name: 'Fernway Trail Runner', cat: 'run', price: 139, margin: 0.44 },
    { id: 'p-run-vest', name: 'Ridge Run Hydration Vest', cat: 'run', price: 109, margin: 0.48 },
    { id: 'p-wind-shell', name: 'Featherlight Wind Shell', cat: 'run', price: 99, margin: 0.5 },
    { id: 'p-headlamp', name: 'Nightline Headlamp', cat: 'run', price: 49, margin: 0.55 },
    { id: 'p-run-tights', name: 'Switchback Running Tights', cat: 'run', price: 79, margin: 0.52 },
    { id: 'p-insulated-jacket', name: 'Summit Insulated Jacket', cat: 'apparel', price: 189, margin: 0.47 },
    { id: 'p-grid-fleece', name: 'Alder Grid Fleece', cat: 'apparel', price: 89, margin: 0.5 },
    { id: 'p-base-layer', name: 'Merino Base Layer Crew', cat: 'apparel', price: 75, margin: 0.52 },
    { id: 'p-rain-shell', name: 'Stormline Rain Shell', cat: 'apparel', price: 169, margin: 0.45 },
    { id: 'p-beanie', name: 'Trailhead Beanie', cat: 'apparel', price: 29, margin: 0.6 }
  ];

  /* ---------------- journey templates (§10.7) ---------------- */
  var CH_LABEL = { email: 'Email', sms: 'SMS', push: 'Push' };
  function entry(next) { return { id: 's1', type: 'entry', label: 'Audience enters', next: next }; }
  function send(id, ch, label, next) { return { id: id, type: 'send', label: label || ('Send ' + CH_LABEL[ch].toLowerCase().replace('sms', 'SMS')), channel: ch, next: next }; }
  function wait(id, h, next) { return { id: id, type: 'wait', label: 'Wait ' + (h % 24 === 0 ? (h / 24) + (h === 24 ? ' day' : ' days') : h + ' hours'), waitH: h, next: next }; }
  function decide(id, kind, label, yes, no) { return { id: id, type: 'decide', label: label, rule: { kind: kind }, yes: yes, no: no }; }
  function exit(id) { return { id: id, type: 'exit', label: 'Exit' }; }

  // journeyTemplate(goalType, channels) -> Step[] (ids s1…; spliced steps keep the other ids stable)
  D.journeyTemplate = function (goalType, channels) {
    var chs = Array.isArray(channels) ? channels : [];
    var owned = ['email', 'sms', 'push'].filter(function (c) { return chs.indexOf(c) >= 0; });
    if (!owned.length) return [entry('s2'), exit('s2')];
    function has(c) { return owned.indexOf(c) >= 0; }
    var P = has('email') ? 'email' : owned[0];
    var PL = CH_LABEL[P] === 'SMS' ? 'SMS' : CH_LABEL[P].toLowerCase();
    if (goalType === 'reactivation') {
      var nudge = has('sms') ? 'sms' : (has('push') ? 'push' : null);
      var s = [entry('s2'), send('s2', P, 'Welcome-back ' + PL), wait('s3', 72, 's4'),
        decide('s4', 'opened', 'Opened?', 's5', nudge ? 's7' : 's8'), wait('s5', 24, 's6'),
        send('s6', P, 'Offer reminder ' + PL, 's8')];
      if (nudge) s.push(send('s7', nudge, null, 's8'));
      s.push(wait('s8', 96, 's9'), decide('s9', 'purchased', 'Purchased?', 's11', 's10'),
        send('s10', P, 'Last chance ' + PL, 's11'), exit('s11'));
      s[1].next = 's3';
      return s;
    }
    if (goalType === 'engagement') {
      var e = [entry('s2'), send('s2', P, null, 's3'), wait('s3', 72, 's4'),
        decide('s4', 'clicked', 'Clicked?', 's6', has('push') ? 's5' : 's6')];
      if (has('push')) e.push(send('s5', 'push', null, 's6'));
      e.push(exit('s6'));
      return e;
    }
    // revenue, launch, conversions (and anything unknown)
    var follow = has('sms') ? 'sms' : P;
    var r = [entry('s2'), send('s2', P, null, 's3'), wait('s3', 48, 's4'),
      decide('s4', 'opened', 'Opened?', has('push') ? 's5' : 's7', 's6')];
    if (has('push')) r.push(send('s5', 'push', null, 's7'));
    r.push(send('s6', follow, follow === P ? 'Second ' + PL : null, 's7'), wait('s7', 72, 's8'),
      decide('s8', 'purchased', 'Purchased?', 's10', 's9'), send('s9', P, 'Last call ' + PL, 's10'), exit('s10'));
    return r;
  };

  /* ---------------- generation constants (≈, tuned to the §5.3 calibration targets) ---------------- */
  var N_PROFILES = 6000, DAY0 = -60;
  var FIRST = ['Maya', 'Liam', 'Ava', 'Noah', 'Sofia', 'Ethan', 'Isla', 'Mateo', 'Chloe', 'Owen', 'Priya', 'Lucas', 'Zoe',
    'Elijah', 'Nora', 'Caleb', 'Aria', 'Jonah', 'Leah', 'Miles', 'Hana', 'Diego', 'Ruby', 'Theo', 'Amara', 'Felix', 'Iris',
    'Ravi', 'Juniper', 'Wes', 'Elena', 'Kai', 'Tessa', 'Arjun', 'Willa', 'Rowan', 'Mei', 'Silas', 'Nina', 'Ezra', 'Lena',
    'Marcus', 'Quinn', 'Jada', 'Hugo', 'Clara', 'Sam', 'Ines', 'Dev', 'Paige', 'Omar', 'Greta', 'Tomas', 'Ivy', 'Reid',
    'Naomi', 'Cole', 'Yara', 'Finn', 'Lucia', 'Emmett', 'Sana', 'Jasper', 'Maren', 'Andre', 'Lila', 'Grant', 'Esme'];
  var INITIALS = 'ABCDEFGHJKLMNOPRSTVWY';
  var REGION_W = [0.2, 0.22, 0.14, 0.16, 0.13, 0.15];
  var CAT_W = [                    // hike, camp, climb, run, apparel by region
    [0.28, 0.18, 0.12, 0.15, 0.27], [0.22, 0.2, 0.14, 0.26, 0.18], [0.26, 0.2, 0.2, 0.14, 0.2],
    [0.18, 0.28, 0.08, 0.16, 0.3], [0.2, 0.32, 0.08, 0.22, 0.18], [0.22, 0.18, 0.1, 0.18, 0.32]];
  var CONSENT_P = { email: 0.9, sms: 0.34, push: 0.44, ads: 0.72 };
  var UNSUB_P = [0.03, 0.04, 0.03];
  var LIFETIME_RATE = [1.0, 0.25, 0.5];            // sends per week per owned channel (last 2 years)
  var OPEN_A = [-1.25, null, -2.1], CLICK_B = [-2.0, -2.6, -2.3];
  var ORG = { base: -5.9, p0: 0.9, aff: 0.6, rec: -0.004 };
  var TIER_SPEND = [250, 700, 1500];               // Trailhead, Summit, Peak thresholds (lifetime $)

  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function U() { return MC.util; }
  function pad5(i) { var s = String(i); while (s.length < 5) s = '0' + s; return 'P-' + s; }
  function newFact() { return new Float64Array(10); }
  function catIndex(id) { for (var k = 0; k < D.CATEGORIES.length; k++) if (D.CATEGORIES[k].id === id) return k; return 0; }
  function topPrices() {
    var out = [];
    D.CATEGORIES.forEach(function (c) { for (var j = 0; j < D.PRODUCTS.length; j++) if (D.PRODUCTS[j].cat === c.id) { out.push(D.PRODUCTS[j].price); return; } });
    return out;
  }
  function productById(id) { for (var j = 0; j < D.PRODUCTS.length; j++) if (D.PRODUCTS[j].id === id) return D.PRODUCTS[j]; return null; }
  function season(d) {
    if (MC.sim && typeof MC.sim.season === 'function') return MC.sim.season(d);
    var dw = MC.time.dowOfDay(d), x = d - 20;
    return 1 + 0.08 * (dw === 0 || dw === 6 ? 1 : 0) + 0.55 * Math.exp(-(x * x) / 6);
  }

  /* ---------------- phase 1: profiles + latent truth ---------------- */
  function makeProfiles(world, seed) {
    var n = N_PROFILES, rng = MC.rng.fork(seed, 'data', 'profiles');
    var P = {
      n: n, id: new Array(n), name: new Array(n), state: new Uint8Array(n), region: new Uint8Array(n), age: new Uint8Array(n),
      tenure: new Int16Array(n), tier: new Uint8Array(n), cat: new Uint8Array(n), aff: new Float32Array(n * 5),
      orders: new Uint16Array(n), spend: new Float32Array(n), aov: new Float32Array(n), lastOrder: new Int16Array(n),
      visits30: new Uint8Array(n), consent: new Uint8Array(n), unsub: new Uint8Array(n), fatigue: new Float32Array(n),
      sent7: new Uint8Array(n * 21), supUntil: new Int32Array(n * 3), eng: new Uint16Array(n * 9), openHr: new Uint8Array(n * 24),
      touchC: new Int16Array(n * 8), touchCh: new Uint8Array(n * 8), touchT: new Int32Array(n * 8), tPtr: new Uint8Array(n),
      prop: new Float32Array(n), churn: new Float32Array(n), ltv: new Float32Array(n), bestCh: new Uint8Array(n), bestHr: new Uint8Array(n)
    };
    P.touchC.fill(-1);
    var L = { p0: new Float32Array(n), eng: new Float32Array(n), cf: new Float32Array(n * 5), ph: new Uint8Array(n), priceSens: new Float32Array(n) };
    var stateBase = [], acc = 0;
    D.REGIONS.forEach(function (r) { stateBase.push(acc); acc += r.states.length; });
    var CF_MU = [0, -0.1, -0.2, 0, -0.2], BIT = [1, 2, 4], prices = topPrices();
    var base = new Float64Array(n);            // organic hazard logit without recency (kept for history)
    for (var i = 0; i < n; i++) {
      P.id[i] = pad5(i);
      P.name[i] = FIRST[rng.int(FIRST.length)] + ' ' + INITIALS.charAt(rng.int(INITIALS.length)) + '.';
      var r = rng.weighted(REGION_W); if (r < 0) r = 0;
      P.region[i] = r;
      P.state[i] = stateBase[r] + rng.int(D.REGIONS[r].states.length);
      P.age[i] = Math.max(18, Math.min(79, Math.round(rng.normal(39, 12))));
      P.tenure[i] = rng.float() < 0.09 ? rng.int(90) : Math.min(3000, 90 + Math.floor(-Math.log(rng.open()) * 600));
      // affinities: low base, one strong top category, sometimes a secondary interest
      var top = rng.weighted(CAT_W[r]); if (top < 0) top = 0;
      var k, ab = i * 5, topA = rng.range(0.45, 0.95);
      for (k = 0; k < 5; k++) P.aff[ab + k] = rng.range(0.02, 0.22);
      P.aff[ab + top] = topA;
      if (rng.float() < 0.55) {
        var sec = (top + 1 + rng.int(4)) % 5;
        P.aff[ab + sec] = Math.min(topA - 0.05, rng.range(0.3, 0.65));
      }
      P.cat[i] = top;
      // latent truth (hidden from agents and views)
      L.p0[i] = rng.normal(0, 1);
      L.eng[i] = rng.normal(0, 0.8);
      var u = rng.float(), ph = u < 0.6 ? rng.normal(19.5, 1.6) : (u < 0.85 ? rng.normal(7.5, 1.2) : rng.normal(12.5, 1.5));
      L.ph[i] = ((Math.round(ph) % 24) + 24) % 24;
      L.priceSens[i] = rng.float();
      for (k = 0; k < 5; k++) L.cf[i * 5 + k] = Math.exp(rng.normal(CF_MU[k], 0.35));
      // consent and historic unsubscribes
      var c = 0;
      if (rng.float() < CONSENT_P.email) c |= 1;
      if (rng.float() < CONSENT_P.sms + (L.p0[i] > 0 ? 0.06 : -0.06)) c |= 2;
      if (rng.float() < CONSENT_P.push + (L.eng[i] > 0 ? 0.06 : -0.06)) c |= 4;
      if (rng.float() < CONSENT_P.ads) c |= 8;
      P.consent[i] = c;
      for (k = 0; k < 3; k++) if ((c & BIT[k]) && rng.float() < UNSUB_P[k]) P.unsub[i] |= BIT[k];
      // lifetime engagement counters (last two years of Fernway newsletters and alerts)
      var weeks = Math.min(104, P.tenure[i] / 7), maxAff = topA, opensAll = 0;
      for (k = 0; k < 3; k++) {
        if (!(c & BIT[k])) continue;
        var sent = rng.poisson(weeks * LIFETIME_RATE[k] * ((P.unsub[i] & BIT[k]) ? 0.5 : 1));
        var pO = k === 1 ? 0.92 : sig(OPEN_A[k] + 1.4 * L.eng[i]);
        var opens = rng.binomial(sent, pO);
        var pC = sig(CLICK_B[k] - 0.3 + 0.6 * Math.log(5 * (0.5 * maxAff + 0.1)) + 0.4 * Math.log(L.cf[i * 5 + k]));
        var clicks = rng.binomial(opens, pC);
        P.eng[i * 9 + k * 3] = Math.min(65535, sent);
        P.eng[i * 9 + k * 3 + 1] = Math.min(65535, opens);
        P.eng[i * 9 + k * 3 + 2] = Math.min(65535, clicks);
        if (k !== 1) opensAll += opens;
      }
      // open-hour histogram centred on the preferred hour
      var draws = Math.min(opensAll, 24);
      for (k = 0; k < draws; k++) {
        var hh = rng.float() < 0.2 ? rng.int(24) : ((Math.round(L.ph[i] + rng.normal(0, 1.8)) % 24) + 24) % 24;
        if (P.openHr[i * 24 + hh] < 255) P.openHr[i * 24 + hh]++;
      }
      P.visits30[i] = Math.min(255, rng.poisson(30 * (0.05 + 0.15 * sig(L.eng[i]))));
      P.fatigue[i] = (c & 1) ? Math.round(rng.range(0, 1.2) * 100) / 100 : 0;
      // purchase history before day -60
      base[i] = ORG.base + ORG.p0 * L.p0[i] + ORG.aff * maxAff;
      var yearly = 365 * sig(base[i] + ORG.rec * 120);
      var price = prices[top];
      P.lastOrder[i] = D.NEVER;
      if (P.tenure[i] > 60) {
        var years = Math.min(5, (P.tenure[i] - 60) / 365);
        var ord = rng.poisson(yearly * years);
        if (ord > 0) {
          var gap = Math.floor(-Math.log(rng.open()) * 365 / Math.max(0.25, yearly));
          P.lastOrder[i] = -61 - Math.min(gap, Math.max(0, P.tenure[i] - 61), 900);
          P.orders[i] = Math.min(65535, ord);
          P.spend[i] = ord * price * rng.lognormal(0.06, 0.35 / Math.sqrt(ord));
          P.aov[i] = P.spend[i] / ord;
        }
      }
    }
    world.profiles = P;
    world.latent.profiles = L;
    world._gen = { base: base, prices: prices };
  }

  /* ---------------- phase 2: 60 days of aggregate history ---------------- */
  function bookOrder(P, i, rev, d) {
    var prev = P.lastOrder[i];
    var react = (prev === D.NEVER || prev <= d - 120) ? 1 : 0;
    if (prev === D.NEVER || d > prev) P.lastOrder[i] = d;
    if (P.orders[i] < 65535) P.orders[i] += 1;
    P.spend[i] += rev;
    P.aov[i] = P.spend[i] / P.orders[i];
    return react;
  }
  function campDay(e, cid) {
    var cd = e.c[cid];
    if (!cd) { cd = { tot: newFact(), trt: {}, ctl: {}, ch: {}, v: {}, attrLast: {}, attrLin: {}, steps: {} }; e.c[cid] = cd; }
    return cd;
  }
  function fact(o, k) { var f = o[k]; if (!f) { f = newFact(); o[k] = f; } return f; }
  function addTo(list, k, v) { for (var j = 0; j < list.length; j++) list[j][k] += v; }

  // Weighted pick over a cumulative table.
  function pickCum(cum, total, u) {
    var x = u * total, lo = 0, hi = cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
    return lo;
  }

  // The completed Fall Trail Running Sale (c-trs): days -40..-20, email + social ads, B beats A.
  var TRS = { id: 'c-trs', start: -40, end: -19, emailBudget: 500, socialBudget: 3500, price: 139, discount: 0.15,
    alloc: [0.5, 0.3, 0.2], clickMul: [1.0, 1.32, 0.88], pOpen: 0.23, pClick: 0.105, pConv: 0.075, socialSplit: [0.45, 0.55] };

  function trsSetup(world, seed, members) {
    var P = world.profiles, F = MC.F, days = world.metrics.days, n = P.n;
    var E = { step: new Int16Array(n), due: new Int32Array(n), ctl: new Uint8Array(n), flags: new Uint8Array(n),
      rev: new Float32Array(n), order: new Int32Array(0), entered: 0, exited: 0 };
    E.step.fill(-1);
    var emailable = [], adsW = [], adsIdx = [], fnv = U().fnv1a, i;
    for (var m = 0; m < members.length; m++) {
      i = members[m];
      E.step[i] = -2; E.ctl[i] = (fnv(P.id[i] + '|' + TRS.id) % 100) < 10 ? 1 : 0;
      if ((P.consent[i] & 1) && !(P.unsub[i] & 1)) emailable.push(i);
      if ((P.consent[i] & 8) && !E.ctl[i]) { adsIdx.push(i); adsW.push(Math.exp(world.latent.profiles.p0[i])); }
    }
    E.entered = E.exited = members.length;
    var adsCum = new Float64Array(adsIdx.length), adsTot = 0;
    for (var a = 0; a < adsIdx.length; a++) { adsTot += adsW[a]; adsCum[a] = adsTot; }
    var c = world.campaigns.byId[TRS.id];
    var curve = (MC.sim && typeof MC.sim.curvesFor === 'function') ? MC.sim.curvesFor(world, c)[TRS.id + '|social'] : null;
    var nDays = TRS.end - TRS.start, quota = Math.floor(TRS.emailBudget / nDays / 0.03);
    var N = emailable.length, pending = 0, buyers = 0, opened = 0;
    var waves = {}; waves[TRS.start] = ['s2', N];
    var vids = ['v-trs-email-a', 'v-trs-email-b', 'v-trs-email-c'], svids = ['v-trs-social-a', 'v-trs-social-b'];
    var queue = [];
    world.enroll[TRS.id] = E;
    // Returns the per-day step; makeHistory calls it inside the organic day loop so order dates stay monotonic.
    return function (d) {
      if (d < TRS.start || d >= TRS.end) return;
      var rng = MC.rng.fork(seed, 'data', 'trs', d), e = days[d - DAY0], cd = campDay(e, TRS.id);
      // journey waves: day 0 first email, +2 days second email for non-openers, +5 days last call
      if (waves[d]) queue.push({ step: waves[d][0], left: waves[d][1] });
      var cap = quota, sentToday = 0;
      while (queue.length && cap > 0) {
        var q = queue[0], k = Math.min(q.left, cap);
        q.left -= k; cap -= k; sentToday += k;
        cd.steps[q.step] = cd.steps[q.step] || [0, 0, 0];
        cd.steps[q.step][0] += k;
        if (q.left <= 0) queue.shift();
      }
      if (sentToday > 0) {
        var leftS = sentToday, leftW = 1, dayOpens = 0;
        for (var v = 0; v < 3; v++) {
          var nv = v === 2 ? leftS : rng.binomial(leftS, TRS.alloc[v] / leftW);
          leftS -= nv; leftW -= TRS.alloc[v];
          var nCtl = rng.binomial(nv, 0.1);
          [[nv - nCtl, 'trt'], [nCtl, 'ctl']].forEach(function (cell) {
            var sent = cell[0]; if (!sent) return;
            var deliv = rng.binomial(sent, 0.985), op = rng.binomial(deliv, TRS.pOpen);
            var cl = rng.binomial(op, Math.min(0.9, TRS.pClick * TRS.clickMul[v])), cv = rng.binomial(cl, TRS.pConv);
            var un = rng.binomial(deliv, 0.0016), rev = 0;
            for (var b = 0; b < cv; b++) {
              var r = TRS.price * rng.lognormal(0, 0.35) * (1 - TRS.discount);
              rev += r;
              var who = emailable[rng.int(emailable.length)];
              var react = bookOrder(P, who, r, d);
              E.rev[who] += r; E.flags[who] |= 7;
              e.tot[F.REACT] += react; cd.tot[F.REACT] += react;
            }
            dayOpens += op; buyers += cv;
            var cells = [cd.tot, fact(cd.ch, 'email'), fact(cell[1] === 'ctl' ? cd.ctl : cd.trt, 'email'), fact(cd.v, vids[v]), e.tot];
            addTo(cells, F.SENT, sent); addTo(cells, F.DELIV, deliv); addTo(cells, F.OPEN, op); addTo(cells, F.CLICK, cl);
            addTo(cells, F.CONV, cv); addTo(cells, F.REV, rev); addTo(cells, F.UNSUB, un); addTo(cells, F.COST, sent * 0.03);
            cd.attrLast.email = (cd.attrLast.email || 0) + rev;
            cd.attrLin.email = (cd.attrLin.email || 0) + rev;
          });
        }
        if (d === TRS.start || d === TRS.start + 1) opened += dayOpens;
      }
      if (d === TRS.start + 1) {
        var non = Math.max(0, N - opened);
        waves[TRS.start + 2] = ['s6', non];
        campDay(days[TRS.start + 2 - DAY0], TRS.id).steps.s4 = [0, Math.min(N, opened), non];
      }
      if (d === TRS.start + 4) {
        var nb = Math.max(0, N - buyers);
        waves[TRS.start + 5] = ['s9', nb];
        campDay(days[TRS.start + 5 - DAY0], TRS.id).steps.s8 = [0, N - nb, nb];
      }
      // social ads
      var S = TRS.socialBudget / nDays;
      if (curve && S > 0) {
        var R = curve.A * (1 - Math.exp(-S / curve.B));
        var conv = rng.poisson(R * season(d) / TRS.price);
        var impr = S / 9 * 1000, clicks = rng.binomial(Math.round(impr), 0.008);
        var chF = fact(cd.ch, 'social'), fa = fact(cd.v, svids[0]), fb = fact(cd.v, svids[1]);
        addTo([cd.tot, chF, e.tot], F.COST, S); addTo([cd.tot, chF, e.tot], F.IMPR, impr); addTo([cd.tot, chF, e.tot], F.CLICK, clicks);
        fa[F.COST] += S * 0.5; fb[F.COST] += S * 0.5; fa[F.IMPR] += impr * 0.5; fb[F.IMPR] += impr * 0.5;
        fa[F.CLICK] += Math.round(clicks * 0.45); fb[F.CLICK] += clicks - Math.round(clicks * 0.45);
        for (var x = 0; x < conv; x++) {
          var rv = TRS.price * rng.lognormal(0, 0.35) * (1 - TRS.discount), react2 = 0;
          if (adsIdx.length) {
            var w = adsIdx[pickCum(adsCum, adsTot, rng.float())];
            react2 = bookOrder(P, w, rv, d); E.rev[w] += rv; E.flags[w] |= 4;
          }
          var vf = rng.float() < TRS.socialSplit[1] ? fb : fa;
          addTo([cd.tot, chF, e.tot, vf], F.CONV, 1); addTo([cd.tot, chF, e.tot, vf], F.REV, rv); addTo([cd.tot, chF, e.tot, vf], F.REACT, react2);
          cd.attrLast.social = (cd.attrLast.social || 0) + rv;
          cd.attrLin.social = (cd.attrLin.social || 0) + rv;
        }
      }
    };
  }

  function organicDay(world, seed, d, recCache) {
    var P = world.profiles, n = P.n, base = world._gen.base, prices = world._gen.prices, F = MC.F;
    var cum = recCache.cum, s = 0;
    for (var i = 0; i < n; i++) {
      var lo = P.lastOrder[i], rec = lo === D.NEVER ? 365 : Math.min(365, Math.max(0, d - lo));
      s += sig(base[i] + ORG.rec * rec);
      cum[i] = s;
    }
    var rng = MC.rng.fork(seed, 'data', 'organic', d), e = world.metrics.days[d - DAY0];
    var orders = rng.poisson(s * season(d));
    for (var k = 0; k < orders; k++) {
      var j = pickCum(cum, s, rng.float());
      var rev = prices[P.cat[j]] * rng.lognormal(0, 0.35);
      var react = bookOrder(P, j, rev, d);
      e.org[F.CONV] += 1; e.org[F.REV] += rev; e.org[F.REACT] += react;
      e.tot[F.CONV] += 1; e.tot[F.REV] += rev; e.tot[F.REACT] += react;
    }
  }

  function makeHistory(world, seed) {
    var P = world.profiles, n = P.n, F = MC.F;
    for (var d = DAY0; d <= 0; d++) world.metrics.days.push({ day: d, tot: newFact(), org: newFact(), c: {} });
    // customers who joined during the history window placed their first order on signup day
    var rng = MC.rng.fork(seed, 'data', 'joiners'), i;
    for (i = 0; i < n; i++) {
      if (P.tenure[i] > 60 || P.tenure[i] < 1 || rng.float() > 0.6) continue;
      var jd = -P.tenure[i], rev = world._gen.prices[P.cat[i]] * rng.lognormal(0, 0.35);
      bookOrder(P, i, rev, jd);
      var e = world.metrics.days[jd - DAY0];
      e.org[F.CONV] += 1; e.org[F.REV] += rev; e.org[F.REACT] += 1;
      e.tot[F.CONV] += 1; e.tot[F.REV] += rev; e.tot[F.REACT] += 1;
    }
    var runners = MC.segments.evaluate(world, D.SEGMENTS_SEED.filter(function (s) { return s.id === 's-runners'; })[0].rule).bits;
    var members = [];
    for (i = 0; i < n; i++) if (runners[i]) members.push(i);
    var cache = { cum: new Float64Array(n) }, trsStep = trsSetup(world, seed, members);
    for (var d2 = DAY0; d2 < 0; d2++) {
      // propensity training snapshot: features as of day -8, label = ordered in days -7..-1
      if (d2 === -7) world.modelState.snap = MC.models.featureMatrix(world, -8);
      organicDay(world, seed, d2, cache);
      trsStep(d2);
    }
    // tiers from lifetime spend
    for (i = 0; i < n; i++) {
      var sp = P.spend[i];
      P.tier[i] = sp >= TIER_SPEND[2] ? 3 : (sp >= TIER_SPEND[1] ? 2 : (sp >= TIER_SPEND[0] ? 1 : 0));
    }
    U().bump(world, 'profiles', 'metrics');
  }

  /* ---------------- seeded segments and campaigns (§10.10) ---------------- */
  function C(attr, cmp, value) { return { attr: attr, cmp: cmp, value: value }; }
  D.SEGMENTS_SEED = [
    { id: 's-layer', name: 'Cold-weather shoppers', rule: { op: 'all', items: [C('affApparel', 'gte', 0.3), C('region', 'in', ['pnw', 'mountain', 'midwest', 'northeast'])] } },
    { id: 's-lapsed', name: 'Lapsed hikers 120d+', rule: { op: 'all', items: [C('lastOrderDays', 'gt', 120), C('affHike', 'gte', 0.3)] } },
    { id: 's-campers', name: 'Car campers', rule: { op: 'all', items: [C('affCamp', 'gte', 0.35)] } },
    { id: 's-loyal', name: 'Summit & Peak members', rule: { op: 'all', items: [C('tier', 'in', ['summit', 'peak'])] } },
    { id: 's-runners', name: 'Trail runners', rule: { op: 'all', items: [C('affRun', 'gte', 0.35)] } },
    { id: 's-gift', name: 'Gift givers', rule: { op: 'any', items: [C('orders', 'gte', 4), C('aov', 'gte', 120)] } },
    { id: 's-pnw', name: 'Pacific Northwest', rule: { op: 'all', items: [C('region', 'in', ['pnw'])] } },
    { id: 's-highltv', name: 'High predicted LTV', rule: { op: 'all', items: [C('ltv', 'gte', 480)] } },
    { id: 's-new', name: 'New customers (90 days)', rule: { op: 'all', items: [C('tenureDays', 'lt', 90)] } }
  ];
  function tk(d, h) { return d * 24 + (h || 0); }
  D.CAMPAIGNS_SEED = [
    { id: 'c-wll', name: 'Winter Layering Launch', status: 'live', goal: { type: 'revenue', target: 38000 }, start: 0, end: tk(21), segmentId: 's-layer',
      channels: ['email', 'push', 'social', 'web'], tone: 'adventurous', offer: 'none', productFocus: 'p-insulated-jacket',
      budget: { email: 900, push: 300, social: 4400, web: 3400 }, sendHour: { email: 9, push: 18 }, created: tk(-12, 10), eventDay: null,
      brief: 'Launch the winter layering collection to cold-weather shoppers before the first frost, led by the Summit Insulated Jacket. Social ads build reach while email and push convert.' },
    { id: 'c-lhw', name: 'Lapsed Hiker Win-back', status: 'live', goal: { type: 'reactivation', target: 75 }, start: 0, end: tk(26), segmentId: 's-lapsed',
      channels: ['email', 'sms', 'social'], tone: 'warm', offer: 'pct15', productFocus: 'p-trail-boot',
      budget: { email: 400, sms: 900, social: 4700 }, sendHour: { email: 10, sms: 12 }, created: tk(-10, 14), eventDay: null,
      program: { trigger: 'No order in 120 days', exit: 'Places an order', reentryDays: 90 },
      brief: 'Win back hikers who haven’t ordered in over 120 days with 15% off the Ridgeline Trail Boot. A text nudges anyone who skips the first email.' },
    { id: 'c-cks', name: 'Camp Kitchen Bundle', status: 'scheduled', goal: { type: 'conversions', target: 195 }, start: 10, end: tk(14), segmentId: 's-campers',
      channels: ['email', 'push', 'social'], tone: 'practical', offer: 'freeship', productFocus: 'p-camp-stove',
      budget: { email: 300, push: 100, social: 3800 }, sendHour: { email: 10, push: 17 }, created: tk(-6, 11), eventDay: null,
      brief: 'Bundle the Basecamp stove with camp kitchen add-ons for car campers. Free shipping removes the last objection before winter trips.' },
    { id: 'c-bfe', name: 'Black Friday Early Access', status: 'scheduled', goal: { type: 'revenue', target: 48000 }, start: tk(17), end: tk(21), segmentId: 's-loyal',
      channels: ['email', 'sms', 'push', 'social', 'web'], tone: 'urgent', offer: 'pct25', productFocus: null,
      budget: { email: 400, sms: 800, push: 100, social: 4800, web: 3500 }, sendHour: { email: 8, sms: 11, push: 19 }, created: tk(-4, 16), eventDay: 20,
      brief: 'Give Summit and Peak members first access to Black Friday pricing: 25% off sitewide on every channel for four days.' },
    { id: 'c-hgg', name: 'Holiday Gift Guide', status: 'draft', goal: { type: 'revenue', target: 30000 }, start: tk(25, 9), end: tk(46), segmentId: 's-gift',
      channels: ['email', 'push', 'web'], tone: 'warm', offer: 'gift', productFocus: null,
      budget: { email: 600, push: 200, web: 7200 }, sendHour: { email: 10, push: 18 }, created: tk(-1, 15), eventDay: null,
      brief: 'A holiday gift guide for customers who order often or spend big, with a free gift on every order through mid-December.' },
    { id: 'c-trs', name: 'Fall Trail Running Sale', status: 'completed', goal: { type: 'conversions', target: 150 }, start: tk(-40), end: tk(-19), segmentId: 's-runners',
      channels: ['email', 'social'], tone: 'practical', offer: 'pct15', productFocus: 'p-trail-shoe',
      budget: { email: 500, social: 3500 }, sendHour: { email: 10 }, created: tk(-47, 10), eventDay: null,
      brief: 'Fall sale on trail running shoes and kit for the trail runners segment, 15% off for three weeks in October.' }
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function makeSegments(world) {
    var byId = {}, order = [];
    D.SEGMENTS_SEED.forEach(function (s) {
      byId[s.id] = { id: s.id, name: s.name, rule: clone(s.rule), author: 'user', createdTick: -24 * 30, ver: 1,
        count: 0, countDay: 0, countHist: [], updatedBy: 'user', updatedTick: -24 * 30 };
      order.push(s.id);
    });
    world.segments = { byId: byId, order: order };
  }

  function makeCampaigns(world, seed) {
    var cById = {}, vById = {}, order = [];
    D.CAMPAIGNS_SEED.forEach(function (s) {
      var vStatus = s.status === 'draft' ? 'draft' : (s.status === 'completed' ? 'retired' : 'live');
      var alloc = {}, total = 0, byChannel = {};
      s.channels.forEach(function (ch) {
        byChannel[ch] = s.budget[ch] || 0; total += byChannel[ch];
        var paid = MC.CH.PAID.indexOf(ch) >= 0, count = paid ? 2 : 3, shares = paid ? [0.5, 0.5] : [0.5, 0.3, 0.2];
        var drafts = MC.copy.generate({ channel: ch, tone: s.tone, productId: s.productFocus, offer: s.offer, count: count,
          seedKey: 'seed:' + s.id + ':' + ch }, seed);
        alloc[ch] = {};
        drafts.forEach(function (dr, k) {
          var letter = String.fromCharCode(97 + k);
          var vid = 'v-' + s.id.slice(2) + '-' + ch + '-' + letter;
          vById[vid] = { id: vid, campaignId: s.id, channel: ch, name: dr.name, status: vStatus, ctlStatus: vStatus, ver: 1, author: 'user',
            fields: dr.fields, tone: dr.tone, offer: dr.offer, productId: dr.productId, createdTick: s.created,
            predicted: { score: dr.predicted.score, open: dr.predicted.open, click: dr.predicted.click }, updatedBy: 'user', updatedTick: s.created };
          alloc[ch][vid] = shares[k];
        });
      });
      var sendHour = {};
      MC.CH.OWNED.forEach(function (ch) { if (s.channels.indexOf(ch) >= 0) sendHour[ch] = s.sendHour[ch] !== undefined ? s.sendHour[ch] : 10; });
      cById[s.id] = {
        id: s.id, name: s.name, status: s.status, ver: 1, goal: clone(s.goal), startTick: s.start, endTick: s.end,
        segmentId: s.segmentId, suppress: [], include: [], channels: s.channels.slice(), productFocus: s.productFocus,
        tone: s.tone, offer: s.offer, budget: { total: total, byChannel: byChannel }, alloc: alloc, sendHour: sendHour,
        channelPaused: {}, journey: { steps: D.journeyTemplate(s.goal.type, s.channels) }, holdoutPct: 10, createdBy: 'user',
        brief: s.brief, program: s.program ? clone(s.program) : undefined, createdTick: s.created, eventDay: s.eventDay, updatedBy: 'user', updatedTick: s.created,
        ctl: { alloc: clone(alloc), sendHour: clone(sendHour), channelPaused: {} }
      };
      order.push(s.id);
    });
    world.campaigns = { byId: cById, order: order, all: order.slice() };
    world.variants = { byId: vById };
  }

  var AGENT_FALLBACK = [['optimizer', 'autopilot', 6], ['sendtime', 'autopilot', 24], ['pacer', 'suggest', 24], ['guard', 'autopilot', 12],
    ['analyst', 'suggest', 6], ['copy', 'suggest', 48], ['scout', 'suggest', 48], ['planner', 'suggest', 168]];
  function makeAgents(world) {
    var byId = {}, order = [];
    var defs = (MC.runtime && typeof MC.runtime.defs === 'function') ? MC.runtime.defs() : [];
    var stats = function () { return { runs: 0, proposed: 0, applied: 0, auto: 0, rejected: 0, undone: 0, expired: 0, superseded: 0, expected: 0, realized: 0 }; };
    defs.forEach(function (def) {
      var a = typeof MC.runtime.newAgentEntity === 'function' ? MC.runtime.newAgentEntity(def) : null;
      if (!a) return;
      a.cooldowns = {}; a.stats = stats();
      byId[def.id] = a; order.push(def.id);
    });
    AGENT_FALLBACK.forEach(function (r) {
      if (byId[r[0]]) return;
      byId[r[0]] = { id: r[0], status: 'active', autonomy: r[1], cadence: r[2], params: {}, lastRunTick: null, runRequested: false,
        cooldowns: {}, ver: 1, stats: stats() };
      order.push(r[0]);
    });
    world.agents = { byId: byId, order: order };
  }

  /* ---------------- assembly ---------------- */
  // Calibrated so November lands at about 90-95% of goal with agents Off (§5.3, §10.10 calibration).
  // Separate November and December targets (keyed 'YYYY-MM'). November: about 93% of goal with agents off;
  // December needs the Holiday Gift Guide to launch and the season to hold, so it is a stretch without agents.
  D.MONTH_GOAL = { byMonth: {
    '2026-11': { revenue: 222000, conversions: 1620, roas: 4.0, unsubRate: 0.003 },
    '2026-12': { revenue: 126000, conversions: 860, roas: 3.6, unsubRate: 0.003 }
  } };

  function skeleton(seed) {
    return {
      meta: { seed: seed, tick: 0, tenant: 'Fernway Outfitters', sample: true, day0: DAY0, monthGoal: clone(D.MONTH_GOAL) },
      modelState: { coef: new Float64Array(8), snap: null, snapDay: -8 },
      seq: 0,
      rev: { profiles: 0, metrics: 0, enroll: 0, segCounts: 0 },
      catalog: { categories: D.CATEGORIES.map(function (c) { return { id: c.id, label: c.label }; }), products: D.PRODUCTS.map(function (p) { return clone(p); }) },
      profiles: null,
      latent: { profiles: null, variants: {}, curves: {} },
      segments: { byId: {}, order: [] },
      campaigns: { byId: {}, order: [], all: [] },
      variants: { byId: {} },
      enroll: {},
      metrics: { days: [], hours: {} },
      agents: { byId: {}, order: [] },
      proposals: { byId: {}, order: [], open: [] },
      feed: [], insights: [],
      audit: { entries: [], head: '00000000' },
      guardrails: {
        freqCap: { email: 4, sms: 2, push: 5 }, quiet: { start: 21, end: 8, channels: ['sms', 'push'] },
        maxShiftPct: 20, minSample: 500, maxDailySpend: 2500, holdoutPct: 10, protectDrafts: true,
        brand: { banned: ['cheap', 'guaranteed', 'act now', '!!!'], smsOptOut: true, maxSubject: 60, maxGrade: 8, noAllCaps: true }
      },
      log: []
    };
  }

  function phaseProfiles(st) {
    var w = st.world = skeleton(st.seed);
    makeProfiles(w, st.seed);
    makeSegments(w);
    makeCampaigns(w, st.seed);
  }
  function phaseHistory(st) { makeHistory(st.world, st.seed); }
  function phaseScores(st) {
    var w = st.world, F = MC.F;
    // c-trs goal: calibrated so the completed sale closed at about 92% of its target
    var conv = 0;
    w.metrics.days.forEach(function (e) { var cd = e.c['c-trs']; if (cd) conv += cd.tot[F.CONV]; });
    var trs = w.campaigns.byId['c-trs'];
    if (conv > 0) {
      var byId = Object.assign({}, w.campaigns.byId);
      byId['c-trs'] = Object.assign({}, trs, { goal: { type: trs.goal.type, target: Math.max(20, Math.round(conv / 0.92 / 5) * 5) } });
      w.campaigns = Object.assign({}, w.campaigns, { byId: byId });
    }
    // propensity fit (60 iterations from zeros on the day -8 snapshot) and day-0 scores
    w._segCols = null; w._segCache = null;
    var coef = MC.models.fitPropensity(w);
    if (coef && coef !== w.modelState.coef) w.modelState.coef = Float64Array.from(coef);
    MC.models.scoreProfiles(w);
    // segment counts at day 0
    var sById = {};
    w.segments.order.forEach(function (id) {
      var s = w.segments.byId[id], r = MC.segments.evaluate(w, s.rule);
      sById[id] = Object.assign({}, s, { count: r.count, countDay: 0, countHist: [r.count] });
    });
    w.segments = { byId: sById, order: w.segments.order.slice() };
    U().bump(w, 'segCounts');
    // hidden truth for variants and paid curves
    Object.keys(w.variants.byId).sort().forEach(function (vid) { w.latent.variants[vid] = MC.sim.latentFor(w, w.variants.byId[vid]); });
    w.campaigns.order.forEach(function (cid) { MC.sim.curvesFor(w, w.campaigns.byId[cid]); });
    // live campaigns enroll at t = 0; today's metrics entry carries their day records
    var today = w.metrics.days[0 - DAY0];
    w.campaigns.order.forEach(function (cid) {
      var c = w.campaigns.byId[cid];
      if (c.status !== 'live') return;
      MC.sim.enroll(w, cid, 0);
      campDay(today, cid);
    });
    makeAgents(w);
    var rank = {};
    AGENT_FALLBACK.forEach(function (r, k) { rank[r[0]] = k; });
    w.agents.order.sort(function (a, b) { return ((rank[a] === undefined ? 99 : rank[a]) - (rank[b] === undefined ? 99 : rank[b])) || (a < b ? -1 : 1); });
    delete w._gen;
    w._segCache = null;
    U().bump(w, 'profiles', 'metrics', 'enroll');
  }

  var PHASES = [['profiles', phaseProfiles], ['history', phaseHistory], ['scores', phaseScores]];

  // generateSteps(seed) -> { next() -> { done, phase, world? } }: one phase per call; phase names the NEXT phase.
  D.generateSteps = function (seed) {
    var st = { seed: seed === undefined || seed === null ? MC.SEED : seed, world: null }, k = 0;
    return {
      next: function () {
        if (k >= PHASES.length) return { done: true, phase: 'scores', world: st.world };
        PHASES[k][1](st);
        k++;
        if (k >= PHASES.length) return { done: true, phase: 'scores', world: st.world };
        return { done: false, phase: PHASES[k][0] };
      }
    };
  };

  // generate(seed) -> World at tick 0 (no tick processed, no agent run).
  D.generate = function (seed) {
    var it = D.generateSteps(seed), r = null, guard = 0;
    do { r = it.next(); } while (!r.done && ++guard < 10);
    return r.world;
  };
})();
