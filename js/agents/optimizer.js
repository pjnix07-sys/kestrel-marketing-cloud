/* Marketing Cloud - Variant Optimizer agent. Shifts traffic toward the variants that are
   winning on each live campaign's email, SMS and push channels (Thompson sampling with a prior
   from the content score), and pauses clear losers once they have enough sends. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'optimizer';
  var CLICK_GOALS = { engagement: 1, launch: 1 };
  var SMS_OPEN = 0.92;

  function F() { return MC.F; }
  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function chName(ch) { return MC.CH.LABEL[ch] || ch; }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : chName(ch).toLowerCase(); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function money(x) { return MC.fmt.money(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }

  function hookOf(v) {
    var f = (v && v.fields) || {}, key = (MC.copy && MC.copy.HOOK && MC.copy.HOOK[v.channel]) || 'subject';
    var s = String(f[key] || f.subject || f.sms || f.pushTitle || '');
    var prod = MC.copy && typeof MC.copy.productOf === 'function' ? MC.copy.productOf(v.productId) : null;
    var offer = (MC.copy && MC.copy.OFFER_TEXT && MC.copy.OFFER_TEXT[v.offer]) || '';
    // Fill merge fields so the quote reads naturally (the name is dropped, not invented).
    s = s.replace(/\s*\{first_name\}/g, '').replace(/\{product\}/g, prod && prod.name ? prod.name : 'our pick')
      .replace(/\{offer\}/g, offer).replace(/\{link\}/g, '').replace(/^[\s,.:;!-]+/, '').replace(/\s+/g, ' ').trim();
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length > 48) s = s.slice(0, 46).replace(/\s+\S*$/, '') + '…';
    return s;
  }
  function quoteOf(ov) { return ov.hook ? '“' + ov.hook + '”' : 'variant ' + ov.name; }

  // Lifetime Facts per variant and recent sends per channel for one campaign (both cohorts).
  function campaignTotals(world, cid, today) {
    var days = world.metrics.days, f = F(), out = { v: {}, chRecent: {}, chAll: {}, recentDays: 0 };
    for (var i = 0; i < days.length; i++) {
      var e = days[i], cd = e && e.c && e.c[cid];
      if (!cd) continue;
      sortedKeys(cd.v).forEach(function (vid) {
        var x = cd.v[vid], o = out.v[vid] || (out.v[vid] = { sends: 0, clicks: 0, conv: 0, revenue: 0 });
        o.sends += x[f.SENT]; o.clicks += x[f.CLICK]; o.conv += x[f.CONV]; o.revenue += x[f.REV];
      });
      sortedKeys(cd.ch).forEach(function (ch) {
        var x = cd.ch[ch], a = out.chAll[ch] || (out.chAll[ch] = { sends: 0, clicks: 0, conv: 0, revenue: 0 });
        a.sends += x[f.SENT]; a.clicks += x[f.CLICK]; a.conv += x[f.CONV]; a.revenue += x[f.REV];
        if (e.day < today && e.day >= today - 3) out.chRecent[ch] = (out.chRecent[ch] || 0) + x[f.SENT];
      });
    }
    return out;
  }

  // Only variants that are live (or approved) may receive traffic; drafts and unreviewed copy never do.
  function eligible(v) {
    if (v.status !== 'live' && v.status !== 'approved') return false;
    var rs = v.reviewState || v.review;
    if (rs && typeof rs === 'object') rs = rs.state || rs.status;
    return !rs || rs === 'approved';
  }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), C = world.campaigns, out = [];
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var tot = null;
      c.channels.forEach(function (ch) {
        if (MC.CH.OWNED.indexOf(ch) < 0 || (c.channelPaused && c.channelPaused[ch])) return;
        var live = MC.catalog.variantsOf(world, cid, ch).filter(eligible);
        if (live.length < 2) return;
        if (!tot) tot = campaignTotals(world, cid, today);
        var alloc = (c.alloc && c.alloc[ch]) || {};
        var all = tot.chAll[ch] || { sends: 0, clicks: 0, conv: 0, revenue: 0 };
        out.push({
          cid: cid, name: c.name, ch: ch, goal: (c.goal && c.goal.type) || 'revenue',
          endTick: c.endTick,
          recentSends: r4((tot.chRecent[ch] || 0)),
          aov: all.conv > 0 ? r4(all.revenue / all.conv) : null,
          valuePerClick: all.clicks > 0 && all.revenue > 0 ? r4(all.revenue / all.clicks) : null,
          variants: live.slice().sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); }).map(function (v) {
            var s = tot.v[v.id] || { sends: 0, clicks: 0, conv: 0, revenue: 0 };
            var pr = v.predicted || {};
            return { id: v.id, name: v.name, hook: hookOf(v), share: r6(+alloc[v.id] || 0),
              sends: s.sends, clicks: s.clicks, conv: s.conv, revenue: r4(s.revenue),
              pOpen: ch === 'sms' ? SMS_OPEN : (isNum(pr.open) ? r6(pr.open) : 0.2),
              pClick: isNum(pr.click) ? r6(pr.click) : 0.05 };
          })
        });
      });
    });
    return { tick: t, maxShiftPct: (world.guardrails && world.guardrails.maxShiftPct) || 20, units: out };
  }

  function fallbackPrice(world, c) {
    var prods = (world.catalog && world.catalog.products) || [], s = 0;
    for (var i = 0; i < prods.length; i++) { if (c && prods[i].id === c.productFocus) return prods[i].price; s += prods[i].price || 0; }
    return prods.length ? s / prods.length : 100;
  }

  function decide(obs, ctx) {
    var prm = ctx.params, rng = ctx.rng, t = ctx.tick, world = ctx.world;
    var proposals = [], trace = [], rows = [];
    var horizon = 72, horizonDays = horizon / 24;
    var lim = Math.min(prm.maxShift, (obs.maxShiftPct || 20) / 100);
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Looked at ' + obs.units.length + (obs.units.length === 1 ? ' live channel' : ' live channels') + ' with two or more live variants.'
      : 'No live email, SMS or push channel has two or more live variants to compare.' });

    obs.units.forEach(function (u) {
      var clicksGoal = !!CLICK_GOALS[u.goal], vs = u.variants, k = prm.priorStrength;
      var c = world.campaigns.byId[u.cid];
      var metricName = clicksGoal ? 'clicks per send' : 'conversions per send';
      var arms = vs.map(function (v) {
        var phat = clicksGoal ? v.pOpen * v.pClick : v.pOpen * v.pClick * 0.06;
        phat = Math.min(0.999, Math.max(0.0001, phat));
        var succ = clicksGoal ? v.clicks : v.conv, fail = Math.max(0, v.sends - succ);
        var a = 1 + k * phat + succ, b = 1 + k * (1 - phat) + fail;
        return { a: a, b: b, mean: a / (a + b), varr: a * b / ((a + b) * (a + b) * (a + b + 1)), rate: v.sends > 0 ? succ / v.sends : 0 };
      });
      var pBest = MC.models.probBest(arms.map(function (x) { return { a: x.a, b: x.b }; }), rng, prm.draws);
      var lead = 0;
      for (var i = 1; i < vs.length; i++) if (pBest[i] > pBest[lead]) lead = i;
      var totalSends = vs.reduce(function (s, v) { return s + v.sends; }, 0);

      // Value of one success and projected sends over the horizon.
      var val = clicksGoal ? (u.valuePerClick || 2) : (u.aov || fallbackPrice(world, c));
      var daysLeft = Math.max(0, (u.endTick - t) / 24);
      var perDay = u.recentSends / 3;
      var projSends = perDay * Math.min(horizonDays, daysLeft);

      function impactOf(next) {
        var d = 0, v2 = 0;
        vs.forEach(function (v, j) { var dj = (next[v.id] || 0) - v.share; d += dj * arms[j].mean; v2 += dj * dj * arms[j].varr; });
        var delta = d * projSends * val, se = 1.28 * Math.sqrt(v2) * projSends * val;
        return { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(delta - se), hi: Math.round(delta + se),
          horizonDays: horizonDays, confidence: Math.round(pBest[lead] * 100) / 100 };
      }
      function evidence() {
        return [
          { label: 'Sends so far', value: num(totalSends) },
          { label: 'Leader', value: 'Variant ' + vs[lead].name + ' at ' + pct(arms[lead].rate, 2) + ' ' + metricName },
          { label: 'Chance it’s best', value: pct(pBest[lead]) }
        ];
      }
      var runnerUp = -1;
      for (var r = 0; r < vs.length; r++) if (r !== lead && (runnerUp < 0 || pBest[r] > pBest[runnerUp])) runnerUp = r;
      var why = 'Variant ' + vs[lead].name + ' leads at ' + pct(arms[lead].rate, 2) + ' ' + metricName + ' vs ' + pct(arms[runnerUp].rate, 2) +
        ' for variant ' + vs[runnerUp].name + ' after ' + num(totalSends) + ' sends; ' + pct(pBest[lead]) + ' chance it’s best.';
      var row = { campaign: u.name, channel: chName(u.ch), 'chance best': vs.map(function (v, j) { return v.name + ' ' + pct(pBest[j]); }).join(', '), sends: num(totalSends), result: 'No change needed' };
      rows.push(row);

      // 1. Pause a clear loser (only one per channel per run; the rest of the traffic is redistributed pro rata).
      var pauseIdx = -1;
      for (var p = 0; p < vs.length; p++) {
        if (pBest[p] < prm.pauseBelow && vs[p].sends >= prm.minSample && vs.length - 1 >= 2 && p !== lead) {
          if (pauseIdx < 0 || pBest[p] < pBest[pauseIdx] || (pBest[p] === pBest[pauseIdx] && vs[p].sends > vs[pauseIdx].sends)) pauseIdx = p;
        }
      }
      if (pauseIdx >= 0) {
        var pv = vs[pauseIdx], rest = 0, nextP = {};
        vs.forEach(function (v, j) { if (j !== pauseIdx) rest += v.share; });
        vs.forEach(function (v, j) { nextP[v.id] = j === pauseIdx ? 0 : (rest > 0 ? v.share + pv.share * v.share / rest : 1 / (vs.length - 1)); });
        proposals.push({
          kind: 'pause-variant', risk: 'medium', horizon: horizon,
          target: { kind: 'variant', id: pv.id, channel: u.ch },
          title: 'Pause ' + chLower(u.ch) + ' variant ' + pv.name + ' on ' + u.name,
          rationale: 'Variant ' + pv.name + ' converts at ' + pct(arms[pauseIdx].rate, 2) + ' ' + metricName + ' after ' + num(pv.sends) +
            ' sends and has only a ' + pct(pBest[pauseIdx], 1) + ' chance of being best. Its ' + pct(pv.share) + ' share moves to the other variants.',
          evidence: evidence(),
          impact: impactOf(nextP),
          actions: [{ type: 'variant/setStatus', payload: { id: pv.id, status: 'paused' } }],
          diff: vs.map(function (v) { return { label: 'Variant ' + v.name + (v.id === pv.id ? ' (paused)' : '') + ' share', before: pct(v.share), after: pct(nextP[v.id]) }; })
        });
        row.result = 'Pause variant ' + pv.name;
        return;   // the pause already moves traffic on this channel
      }

      // 2. Shift traffic toward the likely winner.
      var target = vs.map(function (v, j) { return Math.max(prm.minShare, pBest[j]); });
      var ts = target.reduce(function (s, x) { return s + x; }, 0);
      target = target.map(function (x) { return x / ts; });
      var oldSum = vs.reduce(function (s, v) { return s + v.share; }, 0);
      var old = vs.map(function (v) { return oldSum > 0 ? v.share / oldSum : 1 / vs.length; });
      var nw = old.map(function (o, j) { var d = target[j] - o; return Math.max(0, o + Math.max(-prm.maxShift, Math.min(prm.maxShift, d))); });
      var ns = nw.reduce(function (s, x) { return s + x; }, 0);
      nw = nw.map(function (x) { return x / ns; });
      var moved = 0;
      nw.forEach(function (x, j) { moved += Math.abs(x - old[j]); });
      moved /= 2;
      if (moved > lim) {   // keep the whole move within the per-run limit
        var sc = lim / moved;
        nw = nw.map(function (x, j) { return old[j] + (x - old[j]) * sc; });
        moved = lim;
      }
      nw = nw.map(function (x) { return Math.round(x * 1e4) / 1e4; });
      var fix = 1 - nw.reduce(function (s, x) { return s + x; }, 0);
      var big = 0;
      nw.forEach(function (x, j) { if (x > nw[big]) big = j; });
      nw[big] = Math.round((nw[big] + fix) * 1e4) / 1e4;
      moved = 0;
      nw.forEach(function (x, j) { moved += Math.abs(x - vs[j].share); });
      moved /= 2;
      if (moved < 0.05) return;
      var vsNext = {};
      vs.forEach(function (v, j) { vsNext[v.id] = nw[j]; });
      if (!(impactOf(vsNext).delta > 0)) {
        row.result = 'Held: the shift would not raise expected revenue yet';
        return;
      }
      row.result = 'Shift ' + pct(moved) + ' of traffic';
      var alloc = {}, nextS = {};
      vs.forEach(function (v, j) { alloc[v.id] = nw[j]; nextS[v.id] = nw[j]; });
      var gain = 0, gi = 0;
      vs.forEach(function (v, j) { if (nw[j] - vs[j].share > gain) { gain = nw[j] - vs[j].share; gi = j; } });
      proposals.push({
        kind: 'traffic-shift', risk: 'low', horizon: horizon,
        target: { kind: 'campaign', id: u.cid, channel: u.ch },
        title: 'Shift ' + pct(moved) + ' of ' + chLower(u.ch) + ' traffic to ' + quoteOf(vs[gi]) + ' on ' + u.name,
        rationale: why,
        evidence: evidence(),
        impact: impactOf(nextS),
        actions: [{ type: 'campaign/setAlloc', payload: { id: u.cid, channel: u.ch, alloc: alloc } }],
        diff: vs.map(function (v, j) { return { label: 'Variant ' + v.name + ' share', before: pct(v.share), after: pct(nw[j]) }; })
      });
    });

    if (rows.length) trace.push({ step: 'decide', text: 'Estimated each variant’s chance of being the best performer from its results so far and its predicted quality.', rows: rows });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' change.' : ' changes.')
      : 'Current traffic splits are already close to the evidence; nothing to change.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Variant Optimizer', short: 'Shifts traffic toward the variants that are winning.', icon: 'split', order: 1,
    cadence: { 'default': 6, min: 1, max: 24, phase: 1 },
    autonomy: { 'default': 'autopilot', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'medium',
    params: {
      draws: { label: 'Estimate precision', type: 'int', 'default': 400, min: 100, max: 2000, step: 100, help: 'How many random draws estimate each variant’s chance of being best. More is steadier but slower.' },
      priorStrength: { label: 'Trust in predicted quality', type: 'int', 'default': 20, min: 0, max: 200, step: 5, help: 'How many sends’ worth of weight the content score gets before real results take over.' },
      minShare: { label: 'Minimum share', type: 'pct', 'default': 0.05, min: 0, max: 0.2, step: 0.01, help: 'Every live variant keeps at least this share of traffic so it can keep learning.' },
      maxShift: { label: 'Max shift per run', type: 'pct', 'default': 0.20, min: 0.05, max: 0.5, step: 0.05, help: 'The most traffic one run may move.' },
      pauseBelow: { label: 'Pause below', type: 'pct', 'default': 0.02, min: 0, max: 0.1, step: 0.01, help: 'Pause a variant whose chance of being best falls below this.' },
      minSample: { label: 'Sends before pausing', type: 'int', 'default': 500, min: 100, max: 5000, step: 100, help: 'A variant needs at least this many sends before it can be paused.' }
    },
    emits: ['campaign/setAlloc', 'variant/setStatus'],
    guardrails: ['minSample', 'maxShift', 'keepOneLive', 'protectDrafts', 'targetFresh', 'holdout'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 25 },
    horizon: 72,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'pause-variant' ? 'medium' : 'low'; }
  });
})();
