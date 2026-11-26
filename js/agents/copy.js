/* Marketing Cloud - Copy Drafter agent. Watches the leading email, SMS and push variant on each
   live campaign. When the leader's click rate tires, or a test has clearly settled, it writes a fresh
   challenger from the campaign's tone, product and offer, checks it against the brand rules, and
   proposes it as a new variant on a small share of traffic. It never edits copy a person wrote. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'copy';
  var CLICK_GOALS = { engagement: 1, launch: 1 };
  var MIN_WINDOW_SENDS = 100;   // a 3-day window needs this many sends to count as a CTR reading
  var REST_AFTER_NEW = 72;      // hours a channel rests after an agent-written variant went live
  var DUP_DISTANCE = 0.2;
  var SETTLED = 0.9;

  function F() { return MC.F; }
  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 1 : dp); }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function hookKey(ch) { return (MC.copy && MC.copy.HOOK && MC.copy.HOOK[ch]) || 'subject'; }
  function hookOf(v) {
    var s = String(((v && v.fields) || {})[hookKey(v.channel)] || '').replace(/\s+/g, ' ').trim();
    if (s.length > 52) s = s.slice(0, 50).replace(/\s+\S*$/, '') + '\u2026';
    return s;
  }
  function quote(v) { var h = hookOf(v); return h ? '\u201c' + h + '\u201d' : 'variant ' + v.name; }

  /* ---------------- observe ---------------- */
  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), f = F(), C = world.campaigns, units = [];
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var owned = c.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0 && !(c.channelPaused && c.channelPaused[ch]); });
      if (!owned.length) return;
      var startDay = T().dayOf(c.startTick);
      owned.forEach(function (ch) {
        var all = MC.catalog.variantsOf(world, cid, ch);
        var live = all.filter(function (v) { return v.status === 'live'; });
        if (!live.length) return;
        var alloc = (c.alloc && c.alloc[ch]) || {};
        var lastAgentNew = null;
        all.forEach(function (v) { if (v.author === 'agent:copy' && (lastAgentNew === null || v.createdTick > lastAgentNew)) lastAgentNew = v.createdTick; });
        var chTot = { sends: 0, clicks: 0, conv: 0, revenue: 0 }, recent = 0;
        var vrows = live.map(function (v) {
          var o = { id: v.id, name: v.name, share: r6(+alloc[v.id] || 0), sends: 0, clicks: 0, conv: 0, revenue: 0, daily: [],
            score: v.predicted && isNum(v.predicted.score) ? v.predicted.score : 50,
            pOpen: v.predicted && isNum(v.predicted.open) ? r6(v.predicted.open) : 0.2,
            pClick: v.predicted && isNum(v.predicted.click) ? r6(v.predicted.click) : 0.05 };
          return o;
        });
        for (var d = Math.max(startDay, T().DAY0); d < today; d++) {
          var e = world.metrics.days[T().dayIndex(d)], cd = e && e.c && e.c[cid];
          if (!cd) { vrows.forEach(function (o) { o.daily.push([0, 0]); }); continue; }
          var x = cd.ch && cd.ch[ch];
          if (x) {
            chTot.sends += x[f.SENT]; chTot.clicks += x[f.CLICK]; chTot.conv += x[f.CONV]; chTot.revenue += x[f.REV];
            if (d >= today - 3) recent += x[f.SENT];
          }
          vrows.forEach(function (o) {
            var y = cd.v && cd.v[o.id];
            if (y) { o.sends += y[f.SENT]; o.clicks += y[f.CLICK]; o.conv += y[f.CONV]; o.revenue += y[f.REV]; }
            o.daily.push(y ? [y[f.SENT], y[f.CLICK]] : [0, 0]);
          });
        }
        units.push({ cid: cid, name: c.name, ch: ch, goal: (c.goal && c.goal.type) || 'revenue', tone: c.tone, offer: c.offer,
          productFocus: c.productFocus || null, liveCount: live.length, lastAgentNew: lastAgentNew, endTick: c.endTick,
          chTot: { sends: chTot.sends, clicks: chTot.clicks, conv: chTot.conv, revenue: Math.round(chTot.revenue * 100) / 100 },
          recentSends: recent, variants: vrows });
      });
    });
    return { tick: t, units: units, minSample: (world.guardrails && world.guardrails.minSample) || 500 };
  }

  /* ---------------- helpers ---------------- */
  function ctrWindows(daily) {
    // 3-day rolling CTR (clicks per send) for windows with enough sends; returns {last, peak}.
    var last = null, peak = null;
    for (var i = 2; i < daily.length; i++) {
      var s = daily[i][0] + daily[i - 1][0] + daily[i - 2][0], c = daily[i][1] + daily[i - 1][1] + daily[i - 2][1];
      if (s < MIN_WINDOW_SENDS) { if (i === daily.length - 1) last = null; continue; }
      var r = c / s;
      if (peak === null || r > peak) peak = r;
      if (i === daily.length - 1) last = r;
    }
    return { last: last, peak: peak };
  }
  function words(s) { return String(s || '').toLowerCase().replace(/\{[a-z_]+(\|[^}]*)?\}/g, ' ').match(/[a-z0-9%$]+/g) || []; }
  function featVec(v) {
    var ft = MC.copy.features(v);
    return [Math.min(1, ft.len / 80), ft.hasNumber, ft.personal, ft.urgency, ft.question, ft.ctaStrength, ft.image, Math.min(1, ft.grade / 12), ft.caps, ft.toneFit];
  }
  // 0 = identical, 1 = nothing in common: half from the hook's words, half from the content features.
  function distance(a, b) {
    var wa = words(hookOf(a)), wb = words(hookOf(b)), sa = {}, inter = 0, uni = 0;
    wa.forEach(function (w) { sa[w] = 1; });
    var sb = {};
    wb.forEach(function (w) { sb[w] = 1; });
    sortedKeys(sa).forEach(function (w) { uni++; if (sb[w]) inter++; });
    sortedKeys(sb).forEach(function (w) { if (!sa[w]) uni++; });
    var jw = uni ? inter / uni : 1;
    var fa = featVec(a), fb = featVec(b), fd = 0;
    for (var i = 0; i < fa.length; i++) fd += Math.abs(fa[i] - fb[i]);
    return 0.5 * (1 - jw) + 0.5 * (fd / fa.length);
  }
  function productPrice(world, id) {
    var prods = (world.catalog && world.catalog.products) || [], s = 0;
    for (var i = 0; i < prods.length; i++) { if (prods[i].id === id) return prods[i].price; s += prods[i].price || 0; }
    return prods.length ? s / prods.length : 100;
  }
  function nextLetter(world, cid, ch) {
    var used = {};
    MC.catalog.variantsOf(world, cid, ch).forEach(function (v) { used[v.name] = true; });
    for (var i = 0; i < 26; i++) { var L = String.fromCharCode(65 + i); if (!used[L]) return L; }
    return 'Z';
  }

  /* ---------------- decide ---------------- */
  function decide(obs, ctx) {
    var p = ctx.params, rng = ctx.rng, t = ctx.tick, world = ctx.world;
    var trace = [], proposals = [], rows = [];
    var brand = world.guardrails && world.guardrails.brand;
    var share = p.challengerShare, horizonDays = 96 / 24;
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Checked the leading variant on ' + obs.units.length + (obs.units.length === 1 ? ' live channel.' : ' live channels.')
      : 'No live email, SMS or push channel to check.' });

    obs.units.forEach(function (u) {
      var vs = u.variants, clicksGoal = !!CLICK_GOALS[u.goal];
      var row = { campaign: u.name, channel: chLower(u.ch), result: 'No new copy needed' };
      rows.push(row);
      // Leader by chance of being best on conversions per send (the Drafter's own estimate).
      var arms = vs.map(function (v) { return { a: 1 + v.conv, b: 1 + Math.max(0, v.sends - v.conv) }; });
      var pBest = MC.models.probBest(arms, rng, 400);
      var lead = 0;
      for (var i = 1; i < vs.length; i++) if (pBest[i] > pBest[lead]) lead = i;
      var L = vs[lead], w = ctrWindows(L.daily);
      row.leader = 'Variant ' + L.name + ': ' + pct(pBest[lead], 0) + ' chance best' + (w.last !== null ? ', ' + pct(w.last, 2) + ' clicks per send lately' : '');
      var tired = w.last !== null && w.peak !== null && w.peak > 0 && w.last <= (1 - p.decayThreshold) * w.peak;
      var settled = vs.length >= 2 && pBest[lead] >= SETTLED && L.sends >= obs.minSample;
      if (!tired && !settled) return;
      if (u.liveCount >= p.maxVariants) { row.result = 'Already ' + u.liveCount + ' live variants'; return; }
      if (u.lastAgentNew !== null && t - u.lastAgentNew < REST_AFTER_NEW) { row.result = 'Waiting on the last new variant'; return; }
      if (u.endTick - t < 96) { row.result = 'Campaign ends too soon to test'; return; }

      // Write candidates and filter.
      var drafts = MC.copy.generate({ channel: u.ch, tone: u.tone, productId: u.productFocus, offer: u.offer,
        count: Math.min(8, p.candidates), seedKey: 'copy:' + u.cid + ':' + u.ch + ':' + t }, world.meta.seed);
      var existing = MC.catalog.variantsOf(world, u.cid, u.ch).filter(function (v) { return v.status !== 'retired'; });
      var kept = [], drops = 0, dups = 0;
      drafts.forEach(function (d) {
        var fails = MC.copy.check(d, brand).filter(function (r) { return r.status === 'fail'; });
        if (fails.length) { drops++; return; }
        for (var k = 0; k < existing.length; k++) if (distance(d, existing[k]) < DUP_DISTANCE) { dups++; return; }
        kept.push(d);
      });
      if (!kept.length) { row.result = 'No draft passed the brand checks'; return; }
      kept.sort(function (a, b) { return (b.predicted.score - a.predicted.score) || (a.tmpId < b.tmpId ? -1 : 1); });
      var best = kept[0];
      if (best.predicted.score < L.score - 10) { row.result = 'No draft scored close to the leader'; return; }

      // Expected value of giving it `share` of traffic for the horizon.
      var reward = function (x) { return clicksGoal ? x.clicks : x.conv; };
      var rateAvg = u.chTot.sends > 0 ? reward(u.chTot) / u.chTot.sends : 0;
      var openOf = function (o) { return u.ch === 'sms' ? 0.92 : (isNum(o) ? o : 0.2); };
      var qAvg = 0, wsum = 0;
      vs.forEach(function (v) { qAvg += v.share * openOf(v.pOpen) * v.pClick; wsum += v.share; });
      qAvg = wsum > 0 ? qAvg / wsum : openOf(vs[0].pOpen) * vs[0].pClick;
      var bp = best.predicted || {}, q = openOf(bp.open) * (isNum(bp.click) ? bp.click : 0.05);
      var ratio = qAvg > 0 ? q / qAvg : 1;
      if (tired) ratio = Math.max(ratio, 1);       // fresh copy against a tiring leader at least holds the average
      var rateNew = rateAvg * ratio;
      var value = clicksGoal ? (u.chTot.clicks > 0 && u.chTot.revenue > 0 ? u.chTot.revenue / u.chTot.clicks : 2)
        : (u.chTot.conv > 0 ? u.chTot.revenue / u.chTot.conv : productPrice(world, u.productFocus));
      var sendsH = (u.recentSends / 3) * Math.min(horizonDays, Math.max(0, (u.endTick - t) / 24));
      var exp = share * sendsH, delta = exp * (rateNew - rateAvg) * value;
      var sd = Math.sqrt(Math.max(1, exp * Math.max(rateNew, rateAvg))) * value;
      if (!tired && !(rateNew > rateAvg)) { row.result = 'Best draft isn\u2019t predicted to beat the current mix'; return; }

      var letter = nextLetter(world, u.cid, u.ch);
      var variant = { campaignId: u.cid, channel: u.ch, name: letter, fields: best.fields, tone: best.tone, offer: best.offer,
        productId: best.productId, predicted: best.predicted };
      var why = tired
        ? 'The leading ' + chLower(u.ch) + ', ' + quote(world.variants.byId[L.id]) + ', has slipped to ' + pct(w.last, 2) +
          ' clicks per send over the last 3 days from a peak of ' + pct(w.peak, 2) + '.'
        : quote(world.variants.byId[L.id]) + ' has a ' + pct(pBest[lead], 0) + ' chance of being the best ' + chLower(u.ch) +
          ' after ' + num(L.sends) + ' sends, so the test has settled.';
      why += ' A new challenger, ' + quote(variant) + ', starts on ' + pct(share, 0) + ' of traffic (content score ' + Math.round(best.predicted.score) +
        ' vs ' + Math.round(L.score) + ' for the leader).';
      row.result = 'Draft variant ' + letter;
      var diff = [{ label: 'New ' + chLower(u.ch) + ' variant ' + letter, before: '\u2014', after: hookOf(variant) }];
      vs.forEach(function (v) {
        diff.push({ label: 'Variant ' + v.name + ' share', before: pct(v.share, 0), after: pct(v.share * (1 - share), 0) });
      });
      diff.push({ label: 'Variant ' + letter + ' share', before: '0%', after: pct(share, 0) });
      proposals.push({
        kind: 'new-variant', risk: 'medium', horizon: 96,
        target: { kind: 'campaign', id: u.cid, channel: u.ch },
        title: 'Add a fresh ' + chLower(u.ch) + ' challenger to ' + u.name,
        rationale: why,
        evidence: [
          { label: tired ? 'Leader\u2019s click rate, last 3 days' : 'Chance the leader is best', value: tired ? pct(w.last, 2) : pct(pBest[lead], 0) },
          { label: tired ? 'Its peak' : 'Leader\u2019s sends', value: tired ? pct(w.peak, 2) : num(L.sends) },
          { label: 'New copy\u2019s content score', value: String(Math.round(best.predicted.score)) },
          { label: 'Drafts considered', value: drafts.length + (drops ? ', ' + drops + ' failed brand checks' : '') + (dups ? ', ' + dups + ' too similar' : '') }
        ],
        impact: { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(delta - 1.28 * sd), hi: Math.round(delta + 1.28 * sd),
          horizonDays: horizonDays, confidence: tired ? 0.6 : 0.5 },
        actions: [{ type: 'variant/create', payload: { variant: variant, share: share } }],
        diff: diff
      });
    });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' new challenger.' : ' new challengers.')
      : 'Every leader is still fresh or the test is still open, so no new copy this time.', rows: rows.slice(0, 40) });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Copy Drafter', short: 'Writes a fresh challenger when a winner tires or a test has settled.', icon: 'edit', order: 6,
    cadence: { 'default': 48, min: 12, max: 168, phase: 6 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      decayThreshold: { label: 'Tiring threshold', type: 'pct', 'default': 0.15, min: 0.05, max: 0.5, step: 0.05, help: 'Write new copy when the leader\u2019s click rate falls this far below its best 3 days.' },
      candidates: { label: 'Drafts per channel', type: 'int', 'default': 6, min: 2, max: 12, step: 1, help: 'How many drafts to write before picking the best one.' },
      maxVariants: { label: 'Most live variants', type: 'int', 'default': 4, min: 2, max: 6, step: 1, help: 'Stop adding copy once a channel has this many live variants.' },
      challengerShare: { label: 'Challenger share', type: 'pct', 'default': 0.10, min: 0.05, max: 0.25, step: 0.01, help: 'The share of traffic a new variant starts with.' }
    },
    emits: ['variant/create'],
    guardrails: ['brand', 'maxShift', 'protectDrafts', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 0 },
    horizon: 96,
    observe: observe,
    decide: decide,
    risk: function () { return 'medium'; }
  });
})();
