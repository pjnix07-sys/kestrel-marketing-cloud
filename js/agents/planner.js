/* Kestrel Marketing Cloud - Campaign Planner agent and MC.planner. Turns a brief into a full plan the
   marketer can accept section by section: audience (ranked by expected value), channels and budget
   (equal-marginal split on response curves), journey, content, forecast and preflight checks. The
   same planner drafts an event campaign once a week when a holiday is coming up with nothing planned.
   It only ever creates drafts; nothing sends until a person schedules the campaign. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var PL = MC.planner = MC.planner || {};

  var ID = 'planner';
  var GOALS = ['revenue', 'conversions', 'reactivation', 'engagement', 'launch'];
  var LAPSED_DAYS = 120;
  var SEND_HOUR = { email: 10, sms: 12, push: 18 };
  var MIN_SHARE = 0.10;               // every selected channel keeps at least 10% of the budget
  var BUDGET_STEPS = 100;
  var DAY_SD = 0.25;                  // day-to-day spread of the forecast
  var MODEL_SD = 0.15;                // shared uncertainty in the channel returns
  var HISTORY_WEIGHT = 2000;          // $ of prior spend the ROAS table is worth against observed history
  var EVENT_WINDOW_MAX_DAYS = 7;      // a campaign this short that spans an event counts as covering it
  var Z80 = 1.2816;

  // Goal weights for expected value: active buyers vs lapsed (no order in 120+ days) members.
  PL.GOAL_WEIGHT = {
    revenue: { active: 1.0, lapsed: 0.5 },
    conversions: { active: 1.0, lapsed: 0.6 },
    reactivation: { active: 0.15, lapsed: 1.6 },
    engagement: { active: 1.0, lapsed: 0.8 },
    launch: { active: 1.1, lapsed: 0.5 }
  };
  // Starting return on spend by goal and channel ($ revenue per $1), blended with the account's history.
  PL.PRIOR_ROAS = {
    revenue: { email: 28, sms: 14, push: 22, social: 3.0, web: 2.4 },
    conversions: { email: 24, sms: 13, push: 20, social: 2.8, web: 2.2 },
    reactivation: { email: 18, sms: 12, push: 10, social: 2.2, web: 1.8 },
    engagement: { email: 20, sms: 8, push: 18, social: 2.4, web: 2.0 },
    launch: { email: 26, sms: 12, push: 22, social: 3.2, web: 2.6 }
  };
  var GOAL_LABEL = { revenue: 'Revenue', conversions: 'Conversions', reactivation: 'Win-backs', engagement: 'Clicks', launch: 'Launch orders' };

  /* ---------------- small helpers ---------------- */
  function F() { return MC.F; }
  function T() { return MC.time; }
  function U() { return MC.util; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }
  function money(x) { return MC.fmt.money(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function chName(ch) { return MC.CH.LABEL[ch] || ch; }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : chName(ch).toLowerCase(); }
  function listJoin(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function NEVER() { return (MC.data && MC.data.NEVER !== undefined) ? MC.data.NEVER : -9999; }
  function defaultParams() { return { lookaheadDays: 21, minSegmentSize: 300, variantsPerChannel: 3 }; }
  function paramsOf(world, opts) {
    var p = defaultParams(), a = world.agents && world.agents.byId && world.agents.byId[ID];
    if (a && a.params) sortedKeys(a.params).forEach(function (k) { p[k] = a.params[k]; });
    if (opts && opts.params) sortedKeys(opts.params).forEach(function (k) { p[k] = opts.params[k]; });
    return p;
  }
  function products(world) { return (world.catalog && world.catalog.products) || (MC.data && MC.data.PRODUCTS) || []; }
  function productById(world, id) { var ps = products(world); for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i]; return null; }
  function meanPrice(world) { var ps = products(world), s = 0; ps.forEach(function (x) { s += x.price || 0; }); return ps.length ? s / ps.length : 100; }
  function reachableBit(P, i, bit) { return (P.consent[i] & bit) !== 0 && (P.unsub[i] & bit) === 0; }

  /* ---------------- brief ---------------- */
  function normBrief(world, b) {
    b = b || {};
    var today = T().dayOf(world.meta.tick);
    var goal = b.goal || {}, type = GOALS.indexOf(goal.type) >= 0 ? goal.type : 'revenue';
    var chs = [];
    (Array.isArray(b.channels) ? b.channels : []).forEach(function (ch) { if (MC.CH.ALL.indexOf(ch) >= 0 && chs.indexOf(ch) < 0) chs.push(ch); });
    chs.sort(function (a, c) { return MC.CH.IDX[a] - MC.CH.IDX[c]; });
    if (!chs.length) chs = ['email', 'push', 'social'];
    var start = isNum(b.startDay) ? Math.round(b.startDay) : today + 2;
    var end = isNum(b.endDay) ? Math.round(b.endDay) : start + 13;
    if (end < start) end = start;
    var seg = typeof b.segmentId === 'string' && world.segments.byId[b.segmentId] ? b.segmentId : null;
    var prod = typeof b.productFocus === 'string' && productById(world, b.productFocus) ? b.productFocus : null;
    var tones = (MC.copy && MC.copy.TONES) || ['practical', 'adventurous', 'warm', 'urgent'];
    var offers = (MC.copy && MC.copy.OFFERS) || ['none', 'freeship', 'pct15', 'pct25', 'gift'];
    return {
      name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim().slice(0, 80) : 'New campaign',
      goal: { type: type, target: isNum(goal.target) && goal.target > 0 ? goal.target : null },
      productFocus: prod, segmentId: seg,
      budget: isNum(b.budget) && b.budget > 0 ? Math.round(b.budget) : 5000,
      startDay: start, endDay: end, channels: chs,
      tone: tones.indexOf(b.tone) >= 0 ? b.tone : 'practical',
      offer: offers.indexOf(b.offer) >= 0 ? b.offer : 'none',
      notes: typeof b.notes === 'string' ? b.notes : '',
      eventDay: isNum(b.eventDay) ? b.eventDay : null
    };
  }
  function ticksOf(world, br) {
    var now = world.meta.tick;
    var start = Math.max(T().tickOf(br.startDay, 9), now + 1);
    var end = Math.max(start + 24, T().tickOf(br.endDay + 1, 0));
    return { start: start, end: end, days: (end - start) / 24 };
  }
  function regenRng(world, digest, section, n) { return MC.rng.fork(world.meta.seed, 'planner', digest, section, n); }

  /* ---------------- percentiles over visible columns ---------------- */
  function column(world, key) {
    var P = world.profiles, n = P.n, out = [], d = T().dayOf(world.meta.tick), i;
    if (key === 'lastOrderDays') { for (i = 0; i < n; i++) if (P.lastOrder[i] !== NEVER()) out.push(d - P.lastOrder[i]); }
    else if (key === 'engRate') { for (i = 0; i < n; i++) out.push(MC.models.engRate(world, i)); }
    else { var col = { prop: P.prop, churn: P.churn, ltv: P.ltv, visits30: P.visits30 }[key]; for (i = 0; i < n; i++) out.push(col[i]); }
    out.sort(function (a, b) { return a - b; });
    return out;
  }
  function q(world, key, p) {
    var c = column(world, key);
    if (!c.length) return 0;
    var v = c[Math.min(c.length - 1, Math.floor(p * (c.length - 1)))];
    if (key === 'prop' || key === 'churn' || key === 'engRate') return Math.round(v * 100) / 100;
    if (key === 'ltv') return Math.max(10, Math.round(v / 10) * 10);
    return Math.max(1, Math.round(v));
  }
  function Cn(attr, cmp, value) { return { attr: attr, cmp: cmp, value: value }; }

  // Three audience templates per goal, built from today's distributions.
  function goalTemplates(world, br) {
    var g = br.goal.type, prod = br.productFocus && productById(world, br.productFocus);
    var catAttr = prod ? { hike: 'affHike', camp: 'affCamp', climb: 'affClimb', run: 'affRun', apparel: 'affApparel' }[prod.cat] : null;
    var catLabel = null;
    if (prod && MC.data && MC.data.CATEGORIES) MC.data.CATEGORIES.forEach(function (c) { if ((c.id || c) === prod.cat) catLabel = c.label || c.id; });
    var likely = { name: 'Likely buyers', rule: { op: 'all', items: [Cn('prop', 'gte', q(world, 'prop', 0.75))] } };
    var fans = catAttr
      ? { name: (catLabel || 'Category') + ' fans', rule: { op: 'all', items: [Cn(catAttr, 'gte', 0.4)] } }
      : { name: 'High predicted value', rule: { op: 'all', items: [Cn('ltv', 'gte', q(world, 'ltv', 0.75))] } };
    var browsers = { name: 'Browsing but not buying', rule: { op: 'all', items: [Cn('visits30', 'gte', q(world, 'visits30', 0.7)), Cn('lastOrderDays', 'gt', 30)] } };
    if (g === 'reactivation') {
      return [
        { name: 'Lapsed and slipping away', rule: { op: 'all', items: [Cn('lastOrderDays', 'gt', LAPSED_DAYS), Cn('churn', 'gte', q(world, 'churn', 0.5))] } },
        { name: 'Lapsed high-value customers', rule: { op: 'all', items: [Cn('lastOrderDays', 'between', [90, 365]), Cn('ltv', 'gte', q(world, 'ltv', 0.5))] } },
        { name: 'Lapsed but still opening', rule: { op: 'all', items: [Cn('lastOrderDays', 'gt', 180), Cn('engRate', 'gte', q(world, 'engRate', 0.5))] } }
      ];
    }
    if (g === 'engagement') {
      return [
        { name: 'Most engaged readers', rule: { op: 'all', items: [Cn('engRate', 'gte', q(world, 'engRate', 0.75))] } },
        { name: 'New customers (90 days)', rule: { op: 'all', items: [Cn('tenureDays', 'lt', 90)] } },
        browsers
      ];
    }
    if (g === 'conversions') {
      return [likely, fans, { name: 'Recent repeat buyers', rule: { op: 'all', items: [Cn('orders', 'gte', 2), Cn('lastOrderDays', 'lt', 90)] } }];
    }
    return [likely, fans, browsers];
  }

  /* ---------------- section 1: audience ---------------- */
  function audienceStats(world, bits, br) {
    var P = world.profiles, d = T().dayOf(world.meta.tick), n = 0, reach = 0, primary = 0, sumProp = 0, sumAov = 0, buyers = 0, lapsed = 0;
    var bitsAny = 0, pBit = MC.CH.BIT[br.channels[0]];
    br.channels.forEach(function (ch) { bitsAny |= MC.CH.BIT[ch]; });
    for (var i = 0; i < P.n; i++) {
      if (!bits[i]) continue;
      n++;
      if ((P.consent[i] & bitsAny & ~P.unsub[i]) !== 0) reach++;
      if (reachableBit(P, i, pBit)) primary++;
      sumProp += P.prop[i];
      if (P.orders[i] > 0 && P.aov[i] > 0) { sumAov += P.aov[i]; buyers++; }
      if (P.lastOrder[i] === NEVER() || d - P.lastOrder[i] > LAPSED_DAYS) lapsed++;
    }
    var prod = br.productFocus && productById(world, br.productFocus);
    var aov = buyers ? sumAov / buyers : (prod ? prod.price : meanPrice(world));
    return { size: n, reach: reach, primaryPct: n ? primary / n : 0, meanProp: n ? sumProp / n : 0, aov: aov, lapsedShare: n ? lapsed / n : 0 };
  }
  function buildAudience(world, br, params, regenN) {
    var opts = [], gw = PL.GOAL_WEIGHT[br.goal.type] || PL.GOAL_WEIGHT.revenue;
    function add(segmentId, segment, name, bits, source) {
      var s = audienceStats(world, bits, br);
      if (s.size < params.minSegmentSize && segmentId !== br.segmentId) return;
      var w = gw.active * (1 - s.lapsedShare) + gw.lapsed * s.lapsedShare;
      var ev = s.reach * s.meanProp * s.aov * w;
      var o = { segmentId: segmentId, name: name, size: s.size, reach: s.reach, meanProp: r4(s.meanProp), aov: r2(s.aov),
        primaryReach: r4(s.primaryPct), lapsedShare: r4(s.lapsedShare), goalWeight: r4(w), ev: Math.round(ev), source: source, bits: bits };
      if (segment) o.segment = segment;
      o.why = num(s.size) + ' people, ' + pct(s.primaryPct) + ' reachable by ' + chLower(br.channels[0]) + '. Average ' + pct(s.meanProp) +
        ' chance to buy in 30 days at about ' + money(s.aov) + ' an order' + (s.lapsedShare >= 0.5 ? '; mostly lapsed customers' : '') + '.';
      opts.push(o);
    }
    (world.segments.order || []).forEach(function (sid) {
      var s = world.segments.byId[sid], bits = MC.segments.members(world, sid);
      if (s && bits) add(sid, null, s.name, bits, 'segment');
    });
    goalTemplates(world, br).forEach(function (tp) {
      var bits;
      try { bits = MC.segments.evaluate(world, tp.rule).bits; } catch (e) { return; }
      add(null, { name: tp.name, rule: tp.rule }, tp.name, bits, 'suggested');
    });
    // Options that fail the 50% consent rule on the primary channel sink below those that pass.
    opts.sort(function (a, b) {
      var fa = a.primaryReach >= 0.5 ? 0 : 1, fb = b.primaryReach >= 0.5 ? 0 : 1;
      return (fa - fb) || (b.ev - a.ev) || (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
    });
    var top = [];
    if (br.segmentId) opts.forEach(function (o) { if (o.segmentId === br.segmentId) top.push(o); });
    opts.forEach(function (o) { if (top.length < 3 && top.indexOf(o) < 0) top.push(o); });
    var chosen = top.length ? (regenN || 0) % top.length : 0;
    top.forEach(function (o, k) {
      if (k === 0 && br.segmentId && o.segmentId === br.segmentId) o.why = 'Your pick. ' + o.why;
      else if (k === 0) o.why = 'Highest expected value. ' + o.why;
    });
    var bitsChosen = top[chosen] ? top[chosen].bits : null;
    top.forEach(function (o) { delete o.bits; });
    return { options: top, chosen: chosen, bits: bitsChosen };
  }

  /* ---------------- section 2: channels & budget ---------------- */
  function historyRoas(world, goal) {
    var f = F(), out = {};
    (world.campaigns.order || []).forEach(function (cid) {
      var c = world.campaigns.byId[cid];
      if (!c || !c.goal || c.goal.type !== goal) return;
      for (var i = 0; i < world.metrics.days.length; i++) {
        var cd = world.metrics.days[i].c && world.metrics.days[i].c[cid];
        if (!cd || !cd.ch) continue;
        sortedKeys(cd.ch).forEach(function (ch) {
          var x = cd.ch[ch], o = out[ch] || (out[ch] = { cost: 0, rev: 0 });
          o.cost += x[f.COST]; o.rev += x[f.REV];
        });
      }
    });
    return out;
  }
  function curveFor(ch, roas, br, tk, audienceReach) {
    var per = br.budget / tk.days / br.channels.length;
    var B;
    if (MC.CH.OWNED.indexOf(ch) >= 0) {
      var unit = (MC.sim && MC.sim.CONST && MC.sim.CONST.unitCost && MC.sim.CONST.unitCost[ch]) || 0.03;
      B = Math.max(5, audienceReach * 0.35 * unit);            // what reaching the audience about every third day costs
    } else B = Math.max(20, 0.9 * per);
    var A = roas * B / (1 - Math.exp(-1));                       // average return at spend B equals the table ROAS
    return { A: A, B: B };
  }
  function buildBudget(world, br, tk, aud, rng, regenN) {
    var hist = historyRoas(world, br.goal.type), prior = PL.PRIOR_ROAS[br.goal.type] || PL.PRIOR_ROAS.revenue;
    var P = world.profiles, curves = {}, roas = {}, chs = br.channels;
    chs.forEach(function (ch) {
      var h = hist[ch] || { cost: 0, rev: 0 };
      var r = (prior[ch] * HISTORY_WEIGHT + h.rev) / (HISTORY_WEIGHT + h.cost);
      if (regenN > 0) r *= Math.exp(rng.normal(0, 0.2));
      roas[ch] = r;
      var reach = 0, bit = MC.CH.BIT[ch];
      if (aud.bits) for (var i = 0; i < P.n; i++) if (aud.bits[i] && reachableBit(P, i, bit)) reach++;
      curves[ch] = curveFor(ch, r, br, tk, reach);
    });
    var total = br.budget, days = tk.days, alloc = {};
    var floor = MIN_SHARE * total, left = total - floor * chs.length;
    chs.forEach(function (ch) { alloc[ch] = floor; });
    if (left < 0) { chs.forEach(function (ch) { alloc[ch] = total / chs.length; }); left = 0; }
    var step = left / BUDGET_STEPS;
    for (var s = 0; s < BUDGET_STEPS && step > 0; s++) {
      var best = null, bm = -1;
      chs.forEach(function (ch) {
        var m = MC.models.marginal(curves[ch], alloc[ch] / days);
        if (m > bm + 1e-12) { bm = m; best = ch; }
      });
      alloc[best] += step;
    }
    // Round to $10 and keep the total exact.
    var byChannel = {}, sum = 0, big = chs[0];
    chs.forEach(function (ch) { byChannel[ch] = Math.round(alloc[ch] / 10) * 10; sum += byChannel[ch]; if (alloc[ch] > alloc[big]) big = ch; });
    byChannel[big] += total - sum;
    var why = chs.map(function (ch) {
      var daily = byChannel[ch] / days;
      return { ch: ch, roas: r2(MC.models.response(curves[ch], daily) / Math.max(1e-9, daily)), marginal: r2(MC.models.marginal(curves[ch], daily)),
        daily: r2(daily), share: r4(byChannel[ch] / total) };
    });
    return { byChannel: byChannel, total: total, why: why, curves: curves };
  }

  /* ---------------- section 3: journey ---------------- */
  function waitLabel(h) { return 'Wait ' + (h % 24 === 0 ? (h / 24) + (h === 24 ? ' day' : ' days') : h + ' hours'); }
  function buildJourney(world, br, regenN) {
    var steps = (MC.data && typeof MC.data.journeyTemplate === 'function')
      ? U().clone(MC.data.journeyTemplate(br.goal.type, br.channels))
      : [{ id: 's1', type: 'entry', label: 'Audience enters', next: 's2' }, { id: 's2', type: 'exit', label: 'Exit' }];
    var scale = [1, 0.5, 1.5, 2][(regenN || 0) % 4];
    if (scale !== 1) steps.forEach(function (s) {
      if (s.type !== 'wait') return;
      s.waitH = Math.max(12, Math.min(720, Math.round(s.waitH * scale / 12) * 12));
      s.label = waitLabel(s.waitH);
    });
    var sends = steps.filter(function (s) { return s.type === 'send'; }).length;
    var waits = steps.filter(function (s) { return s.type === 'wait'; }).map(function (s) { return s.waitH; });
    return { steps: steps, summary: sends + (sends === 1 ? ' message' : ' messages') + (waits.length ? ' with waits of ' + waits.map(function (h) { return h % 24 === 0 ? (h / 24) + 'd' : h + 'h'; }).join(', ') : '') };
  }

  /* ---------------- section 4: content ---------------- */
  function buildContent(world, br, digest, params, regenN) {
    var brand = world.guardrails && world.guardrails.brand, variants = [], alloc = {}, k = 0;
    br.channels.forEach(function (ch) {
      var count = MC.CH.OWNED.indexOf(ch) >= 0 ? Math.max(1, Math.min(8, params.variantsPerChannel | 0)) : 2;
      var drafts = MC.copy.generate({ channel: ch, tone: br.tone, productId: br.productFocus, offer: br.offer, count: count,
        seedKey: 'planner:' + digest + ':' + ch + ':' + (regenN || 0) }, world.meta.seed);
      drafts = drafts.map(function (d) {
        var fixed = typeof MC.copy.fixAll === 'function' ? MC.copy.fixAll(d, brand) : d;
        var s = MC.copy.score(fixed);
        return { channel: ch, name: d.name, fields: fixed.fields, tone: d.tone, offer: d.offer, productId: d.productId,
          predicted: { score: s.score, open: s.predOpen, click: s.predClick } };
      });
      // Best predicted copy gets the largest opening share.
      var order = drafts.map(function (d, i) { return i; }).sort(function (a, b) { return (drafts[b].predicted.score - drafts[a].predicted.score) || (a - b); });
      var shares = drafts.length >= 3 ? [0.5, 0.3, 0.2] : (drafts.length === 2 ? [0.5, 0.5] : [1]);
      var a = {};
      drafts.forEach(function (d, i) {
        d.tmpId = '$v' + (k + i);
        var rank = order.indexOf(i);
        a[d.tmpId] = rank < shares.length ? shares[rank] : 0;
      });
      var tot = 0;
      sortedKeys(a).forEach(function (id) { tot += a[id]; });
      sortedKeys(a).forEach(function (id) { a[id] = r4(a[id] / tot); });
      alloc[ch] = a;
      k += drafts.length;
      drafts.forEach(function (d) { variants.push(d); });
    });
    return { variants: variants, alloc: alloc };
  }

  /* ---------------- section 5: forecast ---------------- */
  function weekdayIndex(world) {
    var f = F(), today = T().dayOf(world.meta.tick), s = [0, 0, 0, 0, 0, 0, 0], c = [0, 0, 0, 0, 0, 0, 0], tot = 0, n = 0;
    for (var d = Math.max(T().DAY0, today - 56); d < today; d++) {
      var e = world.metrics.days[T().dayIndex(d)];
      if (!e || !e.tot) continue;
      var w = T().dowOfDay ? T().dowOfDay(d) : (((d + 6) % 7) + 7) % 7;
      s[w] += e.tot[f.REV]; c[w]++; tot += e.tot[f.REV]; n++;
    }
    var mean = n ? tot / n : 0;
    return s.map(function (x, w) { return mean > 0 && c[w] ? Math.max(0.5, Math.min(1.8, (x / c[w]) / mean)) : 1; });
  }
  function goalScale(world, br, aud) {
    var opt = aud.options[aud.chosen], aov = opt ? opt.aov : meanPrice(world);
    var g = br.goal.type;
    if (g === 'revenue') return 1;
    if (g === 'engagement') return 1 / 2;
    if (g === 'reactivation') return (opt ? Math.max(0.05, opt.lapsedShare) : 0.5) / Math.max(1, aov);
    return 1 / Math.max(1, aov);
  }
  function buildForecast(world, br, tk, bud, aud) {
    var idx = weekdayIndex(world), daily = [], mean = 0, vday = 0;
    var perDay = 0;
    br.channels.forEach(function (ch) { perDay += MC.models.response(bud.curves[ch], bud.byChannel[ch] / tk.days); });
    var firstDay = T().dayOf(tk.start), lastDay = T().dayOf(tk.end - 1);
    for (var d = firstDay; d <= lastDay; d++) {
      var from = Math.max(tk.start, T().tickOf(d, 0)), to = Math.min(tk.end, T().tickOf(d + 1, 0)), frac = (to - from) / 24;
      if (frac <= 0) continue;
      var w = T().dowOfDay ? T().dowOfDay(d) : (((d + 6) % 7) + 7) % 7;
      var m = perDay * frac * idx[w], sd = DAY_SD * m;
      mean += m; vday += sd * sd;
      daily.push({ day: d, mean: Math.round(m), lo: Math.round(Math.max(0, m - Z80 * sd)), hi: Math.round(m + Z80 * sd) });
    }
    var sdTot = Math.sqrt(vday + (MODEL_SD * mean) * (MODEL_SD * mean));
    var k = goalScale(world, br, aud), gm = mean * k, gsd = sdTot * k;
    var target = br.goal.target;
    return { metric: 'revenue', mean: Math.round(mean), lo: Math.round(Math.max(0, mean - Z80 * sdTot)), hi: Math.round(mean + Z80 * sdTot), daily: daily,
      goal: { type: br.goal.type, label: GOAL_LABEL[br.goal.type], mean: Math.round(gm), lo: Math.round(Math.max(0, gm - Z80 * gsd)), hi: Math.round(gm + Z80 * gsd),
        target: target, p: target ? r4(U().normCdf((gm - target) / Math.max(1e-9, gsd))) : null } };
  }
  function niceTarget(x) {
    if (x >= 10000) return Math.max(1000, Math.round(x / 1000) * 1000);
    if (x >= 1000) return Math.round(x / 100) * 100;
    if (x >= 100) return Math.round(x / 10) * 10;
    return Math.max(1, Math.round(x));
  }

  /* ---------------- the whole plan ---------------- */
  function briefText(br, audName) {
    if (br.notes && br.notes.trim()) return br.notes.trim();
    var chs = br.channels.map(chLower);
    return (GOAL_LABEL[br.goal.type] || 'Revenue') + ' campaign for ' + audName + ' on ' + listJoin(chs) + ', ' + money(br.budget) + ' over ' +
      (br.endDay - br.startDay + 1) + (br.endDay === br.startDay ? ' day.' : ' days.');
  }

  // plan(world, brief, regen?, opts?) -> plan (see §10.9). Pure: never mutates the world.
  PL.plan = function (world, brief, regen, opts) {
    opts = opts || {};
    regen = regen || {};
    var params = paramsOf(world, opts), trace = [];
    var br = normBrief(world, brief);
    var digest = U().digest(br);
    var tk = ticksOf(world, br);
    function rn(sec) { return isNum(regen[sec]) ? Math.max(0, Math.floor(regen[sec])) : 0; }
    trace.push({ step: 'observe', text: 'Read the brief: ' + (GOAL_LABEL[br.goal.type] || 'Revenue').toLowerCase() + ' goal, ' + money(br.budget) + ' over ' +
      r2(tk.days) + ' days on ' + listJoin(br.channels.map(chLower)) + '.' });

    var aud = buildAudience(world, br, params, rn('audience'));
    var chosen = aud.options[aud.chosen] || null;
    trace.push({ step: 'decide', text: 'Ranked ' + aud.options.length + ' audiences by expected value (people reachable × chance to buy × order value × goal fit).',
      rows: aud.options.map(function (o) { return { audience: o.name, people: o.size, reachable: o.reach, value: money(o.ev) }; }) });

    var bud = buildBudget(world, br, tk, aud, regenRng(world, digest, 'budget', rn('budget')), rn('budget'));
    trace.push({ step: 'decide', text: 'Split the budget so the next dollar on each channel returns about the same, with at least 10% per channel.',
      rows: bud.why.map(function (w) { return { channel: chName(w.ch), budget: money(bud.byChannel[w.ch]), 'return per $1': '$' + w.roas.toFixed(2), 'next $1 returns': '$' + w.marginal.toFixed(2) }; }) });

    var jr = buildJourney(world, br, rn('journey'));
    var ct = buildContent(world, br, digest, params, rn('content'));
    trace.push({ step: 'decide', text: 'Built the journey (' + jr.summary + ') and wrote ' + ct.variants.length + ' variants from the tone, product and offer.' });

    var fc = buildForecast(world, br, tk, bud, aud);
    var target = br.goal.target || niceTarget(fc.goal.mean);
    if (!br.goal.target) {
      fc.goal.target = target;
      fc.goal.p = r4(U().normCdf((fc.goal.mean - target) / Math.max(1e-9, (fc.goal.hi - fc.goal.mean) / Z80)));
    }
    trace.push({ step: 'decide', text: 'Forecast ' + money(fc.lo) + '–' + money(fc.hi) + ' in revenue' +
      (fc.goal.p !== null ? ', a ' + pct(fc.goal.p) + ' chance of reaching the goal.' : '.') });

    var sendHour = {};
    br.channels.forEach(function (ch) { if (SEND_HOUR[ch] !== undefined) sendHour[ch] = SEND_HOUR[ch]; });
    var campaign = {
      name: br.name, goal: { type: br.goal.type, target: target }, startTick: tk.start, endTick: tk.end,
      segmentId: chosen && chosen.segmentId ? chosen.segmentId : (chosen ? '$1' : null),
      suppress: [], include: [], channels: br.channels.slice(), productFocus: br.productFocus, tone: br.tone, offer: br.offer,
      budget: { total: br.budget, byChannel: bud.byChannel }, alloc: ct.alloc, sendHour: sendHour,
      journey: { steps: jr.steps }, brief: briefText(br, chosen ? chosen.name : 'your audience'), eventDay: br.eventDay
    };
    var payload = opts.draftId ? { id: opts.draftId, campaign: campaign, variants: ct.variants } : { campaign: campaign, variants: ct.variants };
    if (chosen && !chosen.segmentId) payload.segment = { name: chosen.segment.name, rule: U().clone(chosen.segment.rule) };

    var like = U().clone(campaign);
    if (opts.draftId) like.id = opts.draftId;
    if (like.segmentId === '$1') like.segmentId = null;
    var items = (MC.guardrails && typeof MC.guardrails.preflight === 'function')
      ? MC.guardrails.preflight(world, like, { variants: ct.variants, segment: payload.segment || null }) : [];
    var fails = items.filter(function (x) { return x.status === 'fail'; }).length, warns = items.filter(function (x) { return x.status === 'warn'; }).length;
    trace.push({ step: 'guardrails', text: fails ? fails + (fails === 1 ? ' preflight check needs' : ' preflight checks need') + ' attention before this can be scheduled.'
      : (warns ? 'Preflight passes with ' + warns + (warns === 1 ? ' warning.' : ' warnings.') : 'Every preflight check passes.'),
      rows: items.map(function (x) { return { check: x.label, result: x.status === 'pass' ? 'Pass' : (x.status === 'warn' ? 'Warning' : 'Fix needed'), detail: x.detail }; }) });

    return {
      briefDigest: digest, brief: br, startTick: tk.start, endTick: tk.end,
      sections: {
        audience: { options: aud.options, chosen: aud.chosen },
        budget: { byChannel: bud.byChannel, total: bud.total, why: bud.why },
        journey: { steps: jr.steps, summary: jr.summary },
        content: { variants: ct.variants, alloc: ct.alloc },
        forecast: { mean: fc.mean, lo: fc.lo, hi: fc.hi, daily: fc.daily, metric: fc.metric, goal: fc.goal },
        preflight: { items: items, fails: fails, warns: warns }
      },
      toReview: fails + warns,
      payload: payload,
      trace: trace
    };
  };

  /* ---------------- weekly run: event drafts ---------------- */
  var EVENT_BRIEF = {
    'Thanksgiving': { name: 'Thanksgiving weekend thank-you', tone: 'warm', offer: 'freeship' },
    'Black Friday': { name: 'Black Friday doorbusters', tone: 'urgent', offer: 'pct25' },
    'Cyber Monday': { name: 'Cyber Monday follow-up', tone: 'urgent', offer: 'pct15' }
  };
  // An event is covered by a campaign tied to it (eventDay), an event campaign whose dates span it,
  // a short campaign (a week or less) whose dates span it, or a pending planner draft for it.
  function coverage(world, e) {
    var C = world.campaigns;
    for (var i = 0; i < (C.order || []).length; i++) {
      var c = C.byId[C.order[i]];
      if (!c || c.status === 'completed') continue;
      if (c.eventDay === e.day) return c.name;
      var inside = T().dayOf(c.startTick) <= e.day && e.day < T().dayOf(c.endTick);
      if (inside && (c.eventDay !== null && c.eventDay !== undefined || (c.endTick - c.startTick) <= EVENT_WINDOW_MAX_DAYS * 24)) return c.name;
    }
    var open = (world.proposals && world.proposals.open) || [];
    for (var k = 0; k < open.length; k++) {
      var p = world.proposals.byId[open[k]];
      if (p && p.status === 'pending' && p.agentId === ID && p.target && p.target.kind === 'event' && p.target.id === 'event-' + e.day) return 'a draft waiting for review';
    }
    return null;
  }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), look = ctx.params.lookaheadDays, events = [];
    (T().EVENTS || []).forEach(function (e) {
      if (e.day < today || e.day > today + look) return;
      events.push({ day: e.day, label: e.label, coveredBy: coverage(world, e), startOk: T().tickOf(e.day - 1, 9) > t });
    });
    return { tick: t, day: today, lookaheadDays: look, events: events };
  }

  function decide(obs, ctx) {
    var world = ctx.world, p = ctx.params, t = ctx.tick, trace = [], proposals = [];
    trace.push({ step: 'observe', text: obs.events.length
      ? 'Looked ' + obs.lookaheadDays + ' days ahead: ' + listJoin(obs.events.map(function (e) { return e.label + ' (' + MC.fmt.dayShort(e.day) + ')'; })) + '.'
      : 'No holidays in the next ' + obs.lookaheadDays + ' days.',
      rows: obs.events.map(function (e) { return { event: e.label, day: MC.fmt.dayLabel(e.day), covered: e.coveredBy ? 'Yes: ' + e.coveredBy : 'Nothing planned' }; }) });
    var open = obs.events.filter(function (e) { return !e.coveredBy && e.startOk; });
    if (!open.length) {
      trace.push({ step: 'decide', text: 'Every upcoming holiday already has a campaign, so no new draft this week.' });
      return { proposals: [], insights: [], trace: trace };
    }
    var e = open[0], spec = EVENT_BRIEF[e.label] || { name: e.label + ' campaign', tone: 'urgent', offer: 'pct15' };
    var cap = (world.guardrails && world.guardrails.maxDailySpend) || 2500;
    var startDay = e.day - 1, endDay = e.day + 1;
    var days = (T().tickOf(endDay + 1, 0) - T().tickOf(startDay, 9)) / 24;
    var budget = Math.max(500, Math.min(6000, Math.floor(cap * 0.8 * days / 100) * 100));
    var brief = { name: spec.name, goal: { type: 'revenue', target: null }, productFocus: null, segmentId: null, budget: budget,
      startDay: startDay, endDay: endDay, channels: ['email', 'sms', 'push', 'social'], tone: spec.tone, offer: spec.offer,
      notes: 'A short ' + e.label + ' push drafted by the Campaign Planner. Review the audience, offer and budget before scheduling.',
      eventDay: e.day };
    var plan = PL.plan(world, brief, {}, { params: p });
    var aud = plan.sections.audience.options[plan.sections.audience.chosen];
    var fc = plan.sections.forecast, pre = plan.sections.preflight;
    plan.trace.forEach(function (s) { trace.push(s); });
    var daysOut = e.day - obs.day;
    proposals.push({
      kind: 'campaign-draft', risk: 'low', horizon: 0,
      target: { kind: 'event', id: 'event-' + e.day },
      title: 'Draft: ' + spec.name + ' for ' + (aud ? aud.name.charAt(0).toLowerCase() + aud.name.slice(1) : 'your best customers'),
      rationale: e.label + ' is ' + daysOut + (daysOut === 1 ? ' day' : ' days') + ' away and nothing is planned for it. ' +
        'This draft reaches ' + (aud ? aud.name + ' (' + num(aud.size) + ' people)' : 'your audience') + ' on ' + listJoin(brief.channels.map(chLower)) + ' with ' +
        money(budget) + ' over ' + Math.round(days) + ' days. It arrives as a draft; nothing sends until you schedule it.',
      evidence: [
        { label: 'Expected revenue', value: money(fc.lo) + '–' + money(fc.hi) },
        { label: 'Audience', value: aud ? aud.name + ', ' + num(aud.size) + ' people' : '—' },
        { label: 'Preflight', value: pre.fails ? pre.fails + ' to fix' : (pre.warns ? pre.warns + ' warnings' : 'All checks pass') }
      ],
      impact: { metric: 'campaign revenue', unit: '$', delta: fc.mean, lo: fc.lo, hi: fc.hi, horizonDays: r2(days), confidence: 0.5 },
      actions: [{ type: 'campaign/create', payload: plan.payload }],
      diff: [
        { label: 'Campaign', before: '—', after: spec.name + ' (draft)' },
        { label: 'Dates', before: '—', after: MC.fmt.stamp(plan.startTick) + ' – ' + MC.fmt.dayLabel(endDay) },
        { label: 'Audience', before: '—', after: aud ? aud.name : '—' },
        { label: 'Budget', before: '—', after: listJoin(brief.channels.map(function (ch) { return chName(ch) + ' ' + money(plan.sections.budget.byChannel[ch]); })) }
      ]
    });
    trace.push({ step: 'decide', text: 'Drafted a ' + e.label + ' campaign for review.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  // preview(input = {brief, regen, draftId?}, ctx) -> {proposals:[], trace, plan}
  function preview(input, ctx) {
    input = input || {};
    var plan = PL.plan(ctx.world, input.brief, input.regen || {}, { draftId: input.draftId || null, params: ctx.params });
    return { proposals: [], trace: plan.trace, plan: plan };
  }

  MC.runtime.register({
    id: ID, name: 'Campaign Planner', short: 'Turns a brief into a full plan you can edit section by section.', icon: 'flag', order: 8,
    cadence: { 'default': 168, min: 24, max: 168, phase: 58 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest'] },
    autopilotMaxRisk: 'low',
    params: {
      lookaheadDays: { label: 'Look ahead', type: 'int', 'default': 21, min: 7, max: 60, step: 1, help: 'How far ahead to look for holidays with nothing planned.' },
      minSegmentSize: { label: 'Smallest audience', type: 'int', 'default': 300, min: 50, max: 3000, step: 50, help: 'Audiences smaller than this aren’t suggested.' },
      variantsPerChannel: { label: 'Variants per channel', type: 'int', 'default': 3, min: 1, max: 6, step: 1, help: 'How many email, SMS and push variants a plan starts with.' }
    },
    emits: ['campaign/create'],
    guardrails: ['consent', 'quietHours', 'budgetCap', 'brand'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 0 },
    horizon: 0,
    observe: observe,
    decide: decide,
    preview: preview,
    risk: function () { return 'low'; }
  });
})();
