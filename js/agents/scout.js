/* Kestrel Marketing Cloud - Segment Scout agent. Looks at the people campaigns reached recently, finds
   simple rules (one or two conditions on visible attributes) whose members bought far more often than
   average, and proposes them as new segments, or as an addition to a live campaign's audience. It never
   edits a segment or audience a person wrote: new rules arrive as new segments. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'scout';
  var MAX_CANDIDATES = 400;
  var EXPAND_TOP = 8;
  var MIN_CELL = 30;            // smallest labelled group worth scoring while searching
  var JACCARD_MAX = 0.8;
  // Recency, propensity and churn are rescored from the very orders the label counts, so they would
  // only rediscover "people who just ordered"; the search uses attributes that don't move with an order.
  var DECILE_ATTRS = ['age', 'tenureDays', 'ltv'];
  var CAT_ATTRS = ['region', 'tier', 'topCategory'];
  var HOUR_BANDS = [[6, 11, 'morning'], [12, 17, 'afternoon'], [18, 23, 'evening']];

  function T() { return MC.time; }
  function S() { return MC.segments; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 1 : dp); }
  function chName(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function cmpStr(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /* ---------------- labels: who was reached, who bought ---------------- */
  // label[i]: 0 = not reached in the lookback, 1 = reached and didn't buy, 2 = reached and bought.
  function labelsOf(world, t, lookbackDays) {
    var P = world.profiles, n = P.n, d = T().dayOf(t), from = t - lookbackDays * 24;
    var NEVER = (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999;
    var lab = new Uint8Array(n), touched = 0, bought = 0;
    for (var i = 0; i < n; i++) {
      var hit = false, b = i * 8;
      for (var s = 0; s < 8; s++) {
        if (P.touchC[b + s] >= 0 && P.touchT[b + s] >= from && P.touchT[b + s] <= t) { hit = true; break; }
      }
      if (!hit) continue;
      touched++;
      var lo = P.lastOrder[i];
      if (lo !== NEVER && lo >= d - lookbackDays) { lab[i] = 2; bought++; } else lab[i] = 1;
    }
    return { lab: lab, touched: touched, bought: bought };
  }

  function observe(world, ctx) {
    var p = ctx.params, t = ctx.tick;
    var L = labelsOf(world, t, p.lookbackDays);
    var segs = (world.segments.order || []).map(function (id) {
      var s = world.segments.byId[id];
      return s ? { id: id, ver: s.ver } : null;
    }).filter(Boolean);
    var open = [];
    ((world.proposals && world.proposals.open) || []).forEach(function (pid) {
      var pr = world.proposals.byId[pid];
      if (!pr || pr.agentId !== ID || pr.status !== 'pending') return;
      (pr.actions || []).forEach(function (a) {
        if (a.type === 'segment/create' && a.payload && a.payload.segment) open.push({ id: pid, rule: a.payload.segment.rule });
      });
    });
    var live = (world.campaigns.order || []).filter(function (cid) {
      var c = world.campaigns.byId[cid];
      return c && c.status === 'live';
    });
    return { tick: t, day: T().dayOf(t), lookbackDays: p.lookbackDays, labels: L.lab, touched: L.touched, bought: L.bought,
      segments: segs, open: open, live: live };
  }

  /* ---------------- candidate conditions ---------------- */
  function roundFor(key, v) {
    if (key === 'prop' || key === 'churn') return Math.round(v * 100) / 100;
    if (key === 'ltv') return Math.max(10, Math.round(v / 10) * 10);
    return Math.round(v);
  }
  function columnOf(world, key) {
    var P = world.profiles, n = P.n, out = new Float64Array(n), i;
    var NEVER = (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999, d = T().dayOf(world.meta.tick);
    if (key === 'lastOrderDays') { for (i = 0; i < n; i++) out[i] = P.lastOrder[i] === NEVER ? NaN : d - P.lastOrder[i]; return out; }
    var col = { age: P.age, tenureDays: P.tenure, prop: P.prop, churn: P.churn, ltv: P.ltv }[key];
    for (i = 0; i < n; i++) out[i] = col[i];
    return out;
  }
  function deciles(world, key) {
    var col = columnOf(world, key), arr = [];
    for (var i = 0; i < col.length; i++) if (isNum(col[i])) arr.push(col[i]);
    arr.sort(function (a, b) { return a - b; });
    var out = [];
    if (!arr.length) return out;
    for (var q = 1; q <= 9; q++) {
      var v = roundFor(key, arr[Math.floor(q / 10 * (arr.length - 1))]);
      if (out.indexOf(v) < 0 && v > arr[0]) out.push(v);
    }
    return out;
  }
  function candidates(world) {
    var out = [], A = S().attr;
    CAT_ATTRS.forEach(function (key) {
      var a = A(key);
      ((a && a.values) || []).forEach(function (v) { out.push({ attr: key, cmp: 'in', value: [v.value] }); });
    });
    ['email', 'sms', 'push'].forEach(function (ch) { out.push({ attr: 'bestCh', cmp: 'in', value: [ch] }); });
    HOUR_BANDS.forEach(function (b) { out.push({ attr: 'bestHr', cmp: 'between', value: [b[0], b[1]] }); });
    out.push({ attr: 'canSms', cmp: 'is', value: true }, { attr: 'canPush', cmp: 'is', value: true });
    DECILE_ATTRS.forEach(function (key) {
      deciles(world, key).forEach(function (v) {
        out.push({ attr: key, cmp: 'gte', value: v });
        out.push({ attr: key, cmp: 'lt', value: v });
      });
    });
    return out.slice(0, MAX_CANDIDATES);
  }
  function condKey(c) { return c.attr + ':' + c.cmp + ':' + (Array.isArray(c.value) ? c.value.join(',') : String(c.value)); }
  function ruleOf(conds) { return { op: 'all', items: conds.map(function (c) { return { attr: c.attr, cmp: c.cmp, value: Array.isArray(c.value) ? c.value.slice() : c.value }; }) }; }

  /* ---------------- scoring ---------------- */
  function scoreBits(bits, lab, base) {
    var n = 0, k = 0;
    for (var i = 0; i < lab.length; i++) if (lab[i] && bits[i]) { n++; if (lab[i] === 2) k++; }
    var rate = n ? k / n : 0, lift = base > 0 ? rate / base : 0;
    return { n: n, k: k, rate: rate, lift: lift, score: lift > 1 ? lift * Math.sqrt(n) : 0 };
  }
  function andBits(a, b) {
    var out = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] & b[i];
    return out;
  }
  function count(bits) { var c = 0; for (var i = 0; i < bits.length; i++) c += bits[i]; return c; }
  function jaccard(a, b) {
    var inter = 0, uni = 0;
    for (var i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
    return uni ? inter / uni : 0;
  }
  function byScore(a, b) { return (b.score - a.score) || (b.n - a.n) || cmpStr(a.key, b.key); }

  function lapsedShare(world, bits) {
    var P = world.profiles, d = T().dayOf(world.meta.tick), n = 0, l = 0;
    var NEVER = (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999;
    for (var i = 0; i < P.n; i++) if (bits[i]) { n++; if (P.lastOrder[i] === NEVER || d - P.lastOrder[i] > 120) l++; }
    return n ? l / n : 0;
  }
  function reachable(world, i, ch) {
    var P = world.profiles, bit = MC.CH.BIT[ch];
    return (P.consent[i] & bit) !== 0 && (P.unsub[i] & bit) === 0;
  }

  // Best live campaign to add this rule's members to, or null.
  function retargetFor(world, rule, bits, p, t) {
    var best = null, lapsed = null;
    (world.campaigns.order || []).forEach(function (cid) {
      var c = world.campaigns.byId[cid];
      if (!c || c.status !== 'live' || c.endTick - t < 72) return;
      if ((c.include || []).length >= 3) return;
      var primary = c.channels[0];
      if (MC.CH.OWNED.indexOf(primary) < 0) return;
      if (c.goal && c.goal.type === 'reactivation') {
        if (lapsed === null) lapsed = lapsedShare(world, bits);
        if (lapsed < 0.5) return;
      }
      var aud = S().audienceOf(world, c), n = 0, r = 0, fresh = 0;
      for (var i = 0; i < bits.length; i++) {
        if (!bits[i]) continue;
        n++;
        var ok = reachable(world, i, primary);
        if (ok) r++;
        if (!aud[i] && ok) fresh++;
      }
      if (!n || r / n < 0.5 || fresh < Math.max(75, p.minSupport / 2)) return;
      if (!best || fresh > best.fresh || (fresh === best.fresh && cid < best.c.id)) best = { c: c, fresh: fresh, reach: r / n, members: n };
    });
    return best;
  }

  function decide(obs, ctx) {
    var world = ctx.world, p = ctx.params, t = ctx.tick, trace = [], proposals = [];
    var lab = obs.labels, base = obs.touched ? obs.bought / obs.touched : 0;
    trace.push({ step: 'observe', text: 'Looked at the ' + num(obs.touched) + ' customers your campaigns reached in the last ' + obs.lookbackDays +
      ' days. ' + num(obs.bought) + ' of them ordered (' + pct(base) + ').' });
    if (obs.touched < p.minSupport || obs.bought < 10 || !(base > 0)) {
      trace.push({ step: 'decide', text: 'Not enough recent orders to compare groups yet, so no new segments this time.' });
      return { proposals: [], insights: [], trace: trace };
    }

    // depth 1
    var conds = candidates(world), singles = [];
    conds.forEach(function (c) {
      var bits;
      try { bits = S().evaluate(world, { op: 'all', items: [c] }).bits; } catch (e) { return; }
      var s = scoreBits(bits, lab, base);
      if (s.n < MIN_CELL || s.n > 0.9 * obs.touched) return;
      singles.push({ conds: [c], key: condKey(c), attrs: [c.attr], bits: bits, n: s.n, k: s.k, rate: s.rate, lift: s.lift, score: s.score });
    });
    singles.sort(byScore);
    var all = singles.slice(), frontier = singles.filter(function (x) { return x.score > 0; }).slice(0, EXPAND_TOP), pairs = 0;

    // depth 2..maxDepth: extend the best rules by one more condition on a different attribute
    for (var depth = 2; depth <= p.maxDepth; depth++) {
      var next = [];
      frontier.forEach(function (r) {
        singles.forEach(function (s1) {
          var c = s1.conds[0];
          if (r.attrs.indexOf(c.attr) >= 0) return;
          var bits = andBits(r.bits, s1.bits), s = scoreBits(bits, lab, base);
          pairs++;
          if (s.n < MIN_CELL) return;
          var cs = r.conds.concat([c]);
          var key = cs.map(condKey).sort().join('&');
          next.push({ conds: cs, key: key, attrs: r.attrs.concat([c.attr]), bits: bits, n: s.n, k: s.k, rate: s.rate, lift: s.lift, score: s.score });
        });
      });
      next.sort(byScore);
      var seen = {};
      next = next.filter(function (x) { if (seen[x.key]) return false; seen[x.key] = true; return true; });
      all = all.concat(next);
      frontier = next.filter(function (x) { return x.score > 0; }).slice(0, EXPAND_TOP);
    }
    all.sort(byScore);
    trace.push({ step: 'decide', text: 'Tested ' + num(singles.length) + ' single conditions' + (pairs ? ' and ' + num(pairs) + ' combinations' : '') +
      ' against the ' + pct(base) + ' average.',
      rows: all.slice(0, 10).map(function (x) {
        return { rule: S().describe(ruleOf(x.conds)), people: x.n, ordered: x.k, rate: pct(x.rate), lift: MC.fmt.ratio(x.lift) };
      }) });

    // keep, dedupe against existing segments, open proposals and each other
    var existing = obs.segments.map(function (s) { return { name: (world.segments.byId[s.id] || {}).name || s.id, bits: S().members(world, s.id) }; })
      .filter(function (x) { return x.bits; });
    obs.open.forEach(function (o) {
      try { existing.push({ name: 'an open suggestion', bits: S().evaluate(world, o.rule).bits }); } catch (e) { /* skip */ }
    });
    var picks = [], dropped = [];
    for (var i = 0; i < all.length && picks.length < p.topK; i++) {
      var x = all[i];
      if (x.lift < p.minLift || x.n < p.minSupport) continue;
      var clash = null;
      for (var j = 0; j < existing.length && !clash; j++) if (jaccard(x.bits, existing[j].bits) > JACCARD_MAX) clash = existing[j].name;
      for (var q = 0; q < picks.length && !clash; q++) if (jaccard(x.bits, picks[q].bits) > JACCARD_MAX) clash = 'another suggestion';
      if (clash) { if (dropped.length < 10) dropped.push({ rule: S().describe(ruleOf(x.conds)), result: 'Skipped: almost the same people as ' + clash }); continue; }
      picks.push(x);
    }
    if (dropped.length) trace.push({ step: 'decide', text: 'Skipped rules that mostly repeat an existing segment.', rows: dropped });
    if (!picks.length) {
      trace.push({ step: 'decide', text: 'No group cleared ' + MC.fmt.ratio(p.minLift) + ' the average with at least ' + num(p.minSupport) + ' people, so nothing to suggest.' });
      return { proposals: [], insights: [], trace: trace };
    }

    var names = {};
    (world.segments.order || []).forEach(function (id) { var s = world.segments.byId[id]; if (s) names[s.name.toLowerCase()] = true; });
    picks.forEach(function (x, idx) {
      var rule = ruleOf(x.conds), name = S().nameFor(rule);
      for (var c2 = x.conds.length - 1; c2 >= 0 && names[name.toLowerCase()]; c2--) {
        var lbl = S().condLabel(x.conds[c2]);
        name = (name + ', ' + lbl.charAt(0).toLowerCase() + lbl.slice(1)).slice(0, 60);
      }
      if (names[name.toLowerCase()]) name = (name + ' (new)').slice(0, 60);
      names[name.toLowerCase()] = true;
      var size = count(x.bits), desc = S().describe(rule);
      var wl = MC.util.wilson(x.k, x.n, 1.28);
      var impact = { metric: 'order rate vs average', delta: x.rate - base, lo: wl[0] - base, hi: wl[1] - base, unit: 'pp', horizonDays: 0,
        confidence: x.lift >= 2 ? 'high' : 'medium' };
      var why = num(x.k) + ' of the ' + num(x.n) + ' reached in the last ' + obs.lookbackDays + ' days ordered (' + pct(x.rate) + '), ' +
        MC.fmt.ratio(x.lift) + ' the ' + pct(base) + ' average.';
      var evidence = [
        { label: 'Ordered after contact', value: pct(x.rate) },
        { label: 'Average', value: pct(base) },
        { label: 'People in the segment', value: num(size) }
      ];
      var segment = { name: name, rule: rule };
      var ret = idx === 0 ? retargetFor(world, rule, x.bits, p, t) : null;
      if (ret) {
        var c = ret.c;
        proposals.push({
          kind: 'retarget', target: { kind: 'campaign', id: c.id },
          title: 'Add “' + name + '” to the ' + c.name + ' audience',
          rationale: why + ' ' + num(ret.fresh) + ' of them can get ' + chName(c.channels[0]) + ' and aren’t in ' + c.name + ' yet. ' +
            'The campaign’s own audience stays as it is; this adds a new segment alongside it.',
          evidence: evidence.concat([{ label: 'New people for the campaign', value: num(ret.fresh) }]),
          impact: { metric: 'extra orders', delta: ret.fresh * x.rate, lo: ret.fresh * wl[0], hi: ret.fresh * wl[1], unit: '#', horizonDays: 0,
            confidence: impact.confidence },
          risk: 'high', mustQueue: true, horizon: 0,
          actions: [
            { type: 'segment/create', payload: { segment: segment, tmpId: '$1' } },
            { type: 'campaign/include', payload: { id: c.id, segmentId: '$1', on: true } }
          ],
          diff: [
            { label: 'New segment', before: '—', after: name },
            { label: 'Rule', before: '—', after: desc },
            { label: c.name + ' audience', before: ((world.segments.byId[c.segmentId] || {}).name || 'Its segment'), after: ((world.segments.byId[c.segmentId] || {}).name || 'Its segment') + ' + ' + name }
          ]
        });
        return;
      }
      proposals.push({
        kind: 'new-segment', target: { kind: 'segment', id: 'rule-' + MC.util.digest(rule) },
        title: 'New segment: ' + name,
        rationale: why + ' Saving it as a segment lets you target or exclude them; nothing else changes.',
        evidence: evidence, impact: impact, risk: 'low', horizon: 0,
        actions: [{ type: 'segment/create', payload: { segment: segment } }],
        diff: [
          { label: 'New segment', before: '—', after: name },
          { label: 'Rule', before: '—', after: desc },
          { label: 'People', before: '—', after: num(size) }
        ]
      });
    });
    trace.push({ step: 'decide', text: 'Suggesting ' + proposals.length + (proposals.length === 1 ? ' segment.' : ' segments.'),
      rows: proposals.map(function (pr) { return { proposal: pr.title }; }) });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Segment Scout', short: 'Finds pockets of customers who respond far better than average.', icon: 'target', order: 7,
    cadence: { 'default': 48, min: 24, max: 168, phase: 8 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      lookbackDays: { label: 'Look back', type: 'int', 'default': 14, min: 7, max: 45, step: 1, help: 'How many days of recent contacts and orders to learn from.' },
      minSupport: { label: 'Minimum people', type: 'int', 'default': 150, min: 50, max: 1000, step: 10, help: 'A suggested segment needs at least this many recently reached people.' },
      minLift: { label: 'Minimum lift', type: 'float', 'default': 1.3, min: 1.1, max: 3, step: 0.1, help: 'How many times the average order rate a group needs before it is suggested.' },
      maxDepth: { label: 'Conditions per rule', type: 'int', 'default': 2, min: 1, max: 3, step: 1, help: 'The most conditions a suggested rule may combine. Fewer is easier to read.' },
      topK: { label: 'Suggestions per run', type: 'int', 'default': 2, min: 1, max: 5, step: 1, help: 'The most new segments suggested at once.' }
    },
    emits: ['segment/create', 'campaign/include'],
    guardrails: ['minSample', 'consent', 'protectDrafts'],
    notifyDefault: 'changes',
    materiality: { metric: 'order rate', min: 0 },
    horizon: 0,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'retarget' ? 'high' : 'low'; }
  });
})();
