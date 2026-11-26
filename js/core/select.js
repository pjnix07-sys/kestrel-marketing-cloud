/* Marketing Cloud - MC.select: memoized derived selectors shared by every view.
   Each selector is keyed on the world, the relevant world.rev counters / slice references and its
   arguments, so repeated calls inside one tick return the same object (safe for useSelect). */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var SEL = MC.select = MC.select || {};
  var assign = Object.assign;

  /* ---------------- memo ---------------- */
  var caches = {};
  function depsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  function memo(name, deps, key, compute) {
    var c = caches[name] || (caches[name] = { keys: [], map: {} });
    var e = c.map[key];
    if (e && depsEqual(e.deps, deps)) return e.value;
    var v = compute();
    if (!e) {
      c.keys.push(key);
      if (c.keys.length > 64) delete c.map[c.keys.shift()];
    }
    c.map[key] = { deps: deps, value: v };
    return v;
  }
  function argKey(o) { return o === undefined ? '' : MC.util.canon(o); }
  SEL._clear = function () { caches = {}; };

  /* ---------------- shared helpers ---------------- */
  var EMPTY = [];
  var FIDX = { revenue: 'REV', conversions: 'CONV', clicks: 'CLICK', sends: 'SENT', sent: 'SENT', opens: 'OPEN',
    delivered: 'DELIV', cost: 'COST', spend: 'COST', unsubs: 'UNSUB', impressions: 'IMPR', react: 'REACT', reactivations: 'REACT' };
  var RATIO = { roas: ['REV', 'COST'], ctr: ['CLICK', 'SENT'], openRate: ['OPEN', 'DELIV'], convRate: ['CONV', 'SENT'], unsubRate: ['UNSUB', 'DELIV'] };
  var GOAL_METRIC = { revenue: 'REV', conversions: 'CONV', reactivation: 'REACT', engagement: 'CLICK', launch: 'CONV' };
  var GOAL_METRIC_NAME = { revenue: 'revenue', conversions: 'conversions', reactivation: 'react', engagement: 'clicks', launch: 'conversions' };
  var Z80 = 1.2816, Z95 = 1.96;

  function F() { return MC.F; }
  function rv(w, k) { return w.rev ? w.rev[k] : 0; }
  function today(w) { return Math.floor(w.meta.tick / 24); }
  function DAY0() { return MC.time.DAY0; }
  function entry(w, d) { var i = d - DAY0(); return (i >= 0 && w.metrics && w.metrics.days) ? w.metrics.days[i] : undefined; }
  function newFact() { return new Float64Array(10); }
  function add(out, src) { if (src) for (var i = 0; i < 10; i++) out[i] += src[i]; }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function camp(w, id) { return w.campaigns.byId[id]; }
  function agentDef(id) {
    try { return (MC.runtime && typeof MC.runtime.def === 'function') ? MC.runtime.def(id) : null; } catch (e) { return null; }
  }
  function agentName(id) { var d = agentDef(id); return (d && d.name) || id; }

  function metricValue(fact, metric) {
    var r = RATIO[metric];
    if (r) { var den = fact[F()[r[1]]]; return den > 0 ? fact[F()[r[0]]] / den : 0; }
    return fact[F()[FIDX[metric] || 'REV']];
  }

  // Aggregate one day under a filter. Unfiltered totals use day.tot (organic + campaigns + paid);
  // any campaign/channel filter (and ROAS) sums campaign entries.
  function aggDay(w, d, f, out) {
    var e = entry(w, d);
    if (!e) return out;
    var ids = f.campaignIds && f.campaignIds.length ? f.campaignIds : null;
    var ch = f.channel && f.channel !== 'all' ? f.channel : null;
    if (!ids && !ch && f.metric !== 'roas' && !f.campaignsOnly) { add(out, e.tot); return out; }
    var list = ids || sortedKeys(e.c);
    for (var i = 0; i < list.length; i++) {
      var cd = e.c && e.c[list[i]];
      if (!cd) continue;
      add(out, ch ? (cd.ch && cd.ch[ch]) : cd.tot);
    }
    return out;
  }

  function resolveRange(w, f) {
    var t = today(w);
    var to = f.toDay !== undefined && f.toDay !== null ? f.toDay : t;
    var from;
    if (f.fromDay !== undefined && f.fromDay !== null) from = f.fromDay;
    else if (f.range === 'all') from = 0;
    else if (typeof f.range === 'number') from = to - f.range + 1;
    else from = to - 29;
    return { from: Math.max(DAY0(), from), to: Math.min(to, t) };
  }

  function aggRange(w, f, from, to) {
    var out = newFact();
    for (var d = from; d <= to; d++) aggDay(w, d, f, out);
    return out;
  }

  // Complete-day values from `from` through yesterday.
  function completeValues(w, f, from) {
    var t = today(w), vals = [];
    for (var d = Math.max(DAY0(), from); d < t; d++) vals.push(metricValue(aggDay(w, d, f, newFact()), f.metric));
    return vals;
  }

  function holtForecast(values, h) {
    if (!(MC.models && typeof MC.models.holt === 'function') || values.length < 7 || h <= 0) return null;
    try { var r = MC.models.holt(values, { season: 7, h: h }); return r && r.forecast ? r : null; }
    catch (e) { return null; }
  }
  // Flat mean forecast from the last 14 complete days (used for month projections when Holt is
  // unavailable or there are fewer than 7 days).
  function meanForecast(values, h) {
    if (!values.length || h <= 0) return null;
    var tail = values.slice(-14), m = MC.util.mean(tail), sd = Math.max(MC.util.sd(tail), Math.sqrt(Math.max(0, m)));
    var out = [];
    for (var k = 0; k < h; k++) out.push({ mean: m, lo80: m - Z80 * sd, hi80: m + Z80 * sd, lo95: m - Z95 * sd, hi95: m + Z95 * sd });
    return { forecast: out, sigma: sd, fallback: true };
  }
  function ptSd(pt) {
    if (pt.hi80 !== undefined && pt.lo80 !== undefined) return Math.max(0, (pt.hi80 - pt.lo80) / (2 * Z80));
    if (pt.hi95 !== undefined && pt.lo95 !== undefined) return Math.max(0, (pt.hi95 - pt.lo95) / (2 * Z95));
    return 0;
  }
  function goalProb(actual, pts, goal, sumMean, sumVar) {
    if (pts && MC.models && typeof MC.models.goalProbability === 'function') {
      try { return MC.models.goalProbability(actual, pts, goal); } catch (e) { /* fallback below */ }
    }
    if (!(sumVar > 0)) return actual + sumMean >= goal ? 1 : 0;
    return MC.util.normCdf((actual + sumMean - goal) / Math.sqrt(sumVar));
  }
  function nonNeg(metric) { return !RATIO[metric] || metric === 'roas'; }

  // Month goals: world.meta.monthGoal is either one flat object ({revenue, conversions, roas, unsubRate}) or
  // a map of those keyed by month ('2026-11', '11', 'nov', 'november', or under .byMonth / .months).
  var MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function isGoalObj(o) { return !!o && typeof o === 'object' && (typeof o.revenue === 'number' || typeof o.conversions === 'number'); }
  function monthGoalObj(w, m) {
    var g = w.meta && w.meta.monthGoal;
    if (!g) return {};
    if (isGoalObj(g)) return g;
    var src = g.byMonth || g.months || g;
    var mm = m.m, name = MONTH_NAMES[mm - 1], keys = [m.y + '-' + (mm < 10 ? '0' : '') + mm, String(mm), (mm < 10 ? '0' : '') + mm,
      name, name.slice(0, 3), name.charAt(0).toUpperCase() + name.slice(1), m.label, m.y + '-' + mm];
    for (var i = 0; i < keys.length; i++) if (isGoalObj(src[keys[i]])) return src[keys[i]];
    return {};
  }
  function monthSpan(w, monthKey) {
    var t = today(w);
    if (monthKey === undefined || monthKey === null) return MC.time.monthOf(t);
    var day = typeof monthKey === 'number' ? monthKey : MC.time.dayOfYmd(String(monthKey).length === 7 ? monthKey + '-01' : String(monthKey));
    return day === null || day === undefined ? MC.time.monthOf(t) : MC.time.monthOf(day);
  }
  function monthKeyOf(m) { return m.y + '-' + (m.m < 10 ? '0' : '') + m.m; }
  var MIN_DAYS = 7;   // days of month data before a goal probability or pacing status is shown
  function completeDaysIn(w, m) {
    var t = today(w), from = Math.max(m.fromDay, DAY0()), to = Math.min(m.toDay + 1, t);
    return Math.max(0, to - from);
  }

  function targetCampaignId(w, p) {
    var t = p && p.target;
    if (t) {
      if (t.kind === 'campaign') return t.id;
      if (t.kind === 'variant') { var v = w.variants.byId[t.id]; if (v) return v.campaignId; }
    }
    var acts = (p && p.actions) || EMPTY;
    for (var i = 0; i < acts.length; i++) {
      var pl = acts[i].payload || {};
      if (pl.id && w.campaigns.byId[pl.id]) return pl.id;
      if (pl.campaignId && w.campaigns.byId[pl.campaignId]) return pl.campaignId;
      if (pl.variant && pl.variant.campaignId) return pl.variant.campaignId;
      if (pl.id && w.variants.byId[pl.id]) return w.variants.byId[pl.id].campaignId;
    }
    return null;
  }
  SEL.targetCampaignId = targetCampaignId;

  function isApplied(p) { return p.appliedTick !== undefined && p.appliedTick !== null && (p.status === 'applied' || p.status === 'auto' || p.status === 'undone'); }

  /* ---------------- series & forecast ---------------- */
  SEL.series = function (w, f) {
    f = f || {};
    return memo('series', [w, rv(w, 'metrics'), w.meta.tick], argKey(f), function () {
      var r = resolveRange(w, f), t = today(w), out = [];
      for (var d = r.from; d <= r.to; d++) {
        var pt = { day: d, value: metricValue(aggDay(w, d, f, newFact()), f.metric || 'revenue') };
        if (d === t) pt.partial = true;
        out.push(pt);
      }
      return out;
    });
  };

  function forecastPoints(fc, startDay, metric) {
    if (!fc) return [];
    return fc.forecast.map(function (p, k) {
      var o = { day: startDay + k, mean: p.mean, lo80: p.lo80, hi80: p.hi80, lo95: p.lo95, hi95: p.hi95 };
      if (nonNeg(metric)) { o.mean = Math.max(0, o.mean); o.lo80 = Math.max(0, o.lo80); o.lo95 = Math.max(0, o.lo95); }
      return o;
    });
  }

  function monthForecast(w, metric) {
    var t = today(w);
    return memo('monthForecast', [w, t, w.metrics.days.length, w.meta.monthGoal], metric, function () {
      var f = { metric: metric };
      var m = MC.time.monthOf(t);
      var hist = completeValues(w, f, DAY0());
      var h = m.toDay - t + 1;
      var fc = holtForecast(hist, h) || meanForecast(hist, h);
      var actual = [], actualToDate = 0;
      for (var d = Math.max(m.fromDay, DAY0()); d < t; d++) {
        var v = metricValue(aggDay(w, d, f, newFact()), metric);
        actual.push({ day: d, value: v }); actualToDate += v;
      }
      var raw = fc ? fc.forecast : [];
      var points = forecastPoints(fc, t, metric);
      var sumMean = 0, sumVar = 0, cumPts = [], cumActual = [], run = 0;
      actual.forEach(function (a) { run += a.value; cumActual.push({ day: a.day, value: run }); });
      raw.forEach(function (p, k) {
        var sd = ptSd(p);
        sumMean += points[k].mean; sumVar += sd * sd;
        var s = Math.sqrt(sumVar), mu = actualToDate + sumMean;
        cumPts.push({ day: t + k, mean: mu, lo80: Math.max(actualToDate, mu - Z80 * s), hi80: mu + Z80 * s, lo95: Math.max(actualToDate, mu - Z95 * s), hi95: mu + Z95 * s });
      });
      var sdT = Math.sqrt(sumVar), mean = actualToDate + sumMean;
      var goalKey = metric === 'conversions' ? 'conversions' : 'revenue';
      var goal = monthGoalObj(w, m)[goalKey];
      var early = completeDaysIn(w, m) < MIN_DAYS;
      var projected = { mean: mean, lo80: Math.max(actualToDate, mean - Z80 * sdT), hi80: mean + Z80 * sdT,
        lo95: Math.max(actualToDate, mean - Z95 * sdT), hi95: mean + Z95 * sdT };
      return {
        actual: actual, points: points,
        cumulative: { actualToDate: actualToDate, projected: projected, actual: cumActual, points: cumPts },
        goal: goal, early: early,
        p: early ? null : (fc && goal ? goalProb(actualToDate, raw, goal, sumMean, sumVar) : (goal ? goalProb(actualToDate, null, goal, sumMean, sumVar) : undefined)),
        month: { label: m.label, name: m.name, fromDay: m.fromDay, toDay: m.toDay }, today: t, ready: !!fc && !fc.fallback
      };
    });
  }

  SEL.forecast = function (w, f) {
    f = f || {};
    var metric = f.metric || 'revenue';
    if (f.month) return monthForecast(w, metric);
    var t = today(w);
    return memo('forecast', [w, t, w.metrics.days.length], argKey(f), function () {
      var r = resolveRange(w, f);
      var start = DAY0();
      if (f.campaignIds && f.campaignIds.length) {
        var first = Infinity;
        f.campaignIds.forEach(function (id) { var c = camp(w, id); if (c) first = Math.min(first, Math.floor(c.startTick / 24)); });
        if (first !== Infinity) start = Math.max(start, first);
      }
      var hist = completeValues(w, f, start);
      var fc = holtForecast(hist, f.h || 14);
      var actual = [];
      for (var d = r.from; d < t; d++) actual.push({ day: d, value: metricValue(aggDay(w, d, f, newFact()), metric) });
      var out = { actual: actual, points: forecastPoints(fc, t, metric), ready: !!fc };
      if (f.campaignIds && f.campaignIds.length === 1) {
        var c = camp(w, f.campaignIds[0]);
        if (c && GOAL_METRIC_NAME[c.goal.type] === metric) {
          var days = Math.max(1, Math.round((c.endTick - c.startTick) / 24));
          out.goal = c.goal.target / days;
          out.goalTarget = c.goal.target;
        }
      }
      return out;
    });
  };

  /* ---------------- KPIs ---------------- */
  function weekDelta(w, f) {
    var t = today(w);
    var a = metricValue(aggRange(w, f, Math.max(DAY0(), t - 7), t - 1), f.metric);
    var b = metricValue(aggRange(w, f, Math.max(DAY0(), t - 14), t - 8), f.metric);
    return b > 0 ? (a - b) / b : null;
  }
  function spark(w, f) {
    var t = today(w), out = [];
    for (var d = Math.max(DAY0(), t - 14); d < t; d++) out.push(metricValue(aggDay(w, d, f, newFact()), f.metric));
    return out;
  }
  function pStatus(p) { return p === undefined || p === null ? 'early' : (p >= 0.7 ? 'on' : (p >= 0.4 ? 'risk' : 'off')); }
  function goalStatus(p) { return p >= 0.8 ? 'ahead' : (p >= 0.4 ? 'on' : 'behind'); }
  var EARLY_NOTE = 'Goal tracking starts after a week of results.';

  // One month's goal and pace. Current month: target, actual to date, what the plan expects by now (the share of
  // the target a month that lands on it would already have), the gap, and the chance of finishing at or above target.
  SEL.goalFor = function (w, monthKey) {
    var t = today(w), m = monthSpan(w, monthKey), key = monthKeyOf(m);
    return memo('goalFor', [w, rv(w, 'metrics'), w.meta.tick, w.meta.monthGoal], key, function () {
      var target = monthGoalObj(w, m).revenue;
      if (typeof target !== 'number') target = null;
      var from = Math.max(m.fromDay, DAY0()), to = Math.min(m.toDay, t);
      var actual = to >= from ? metricValue(aggRange(w, { metric: 'revenue' }, from, to), 'revenue') : 0;
      var elapsed = completeDaysIn(w, m), out = { key: key, label: m.name + ' ' + m.y, target: target, actual: actual, expectedByNow: null,
        delta: null, status: 'early', p: null, days: { elapsed: elapsed, total: m.days }, note: null };
      if (t > m.toDay) {            // finished month
        out.expectedByNow = target; out.delta = target === null ? null : actual - target; out.p = target === null ? null : (actual >= target ? 1 : 0);
        out.status = target === null ? 'early' : goalStatus(out.p); out.days.elapsed = m.days;
        return out;
      }
      var linear = target === null ? null : target * MC.util.clamp((w.meta.tick / 24 - m.fromDay) / m.days, 0, 1);
      out.expectedByNow = linear;
      if (elapsed < MIN_DAYS || target === null) { out.note = EARLY_NOTE; out.delta = linear === null ? null : actual - linear; return out; }
      var mf = monthForecast(w, 'revenue'), proj = mf.cumulative.projected.mean;
      out.p = typeof mf.p === 'number' ? mf.p : null;
      if (proj > 0 && actual > 0) out.expectedByNow = Math.min(target, target * actual / proj);
      out.delta = actual - out.expectedByNow;
      out.status = out.p === null ? 'early' : goalStatus(out.p);
      return out;
    });
  };

  SEL.kpis = function (w) {
    return memo('kpis', [w, rv(w, 'metrics'), w.meta.tick, w.meta.monthGoal], '', function () {
      var t = today(w), m = MC.time.monthOf(t), goal = monthGoalObj(w, m), early = completeDaysIn(w, m) < MIN_DAYS;
      function tile(metric, goalKey) {
        var f = { metric: metric };
        var mf = monthForecast(w, metric);
        var value = metricValue(aggRange(w, f, Math.max(m.fromDay, DAY0()), t), metric);
        return {
          value: value, goal: goal[goalKey],
          projected: { mean: mf.cumulative.projected.mean, lo80: mf.cumulative.projected.lo80, hi80: mf.cumulative.projected.hi80 },
          p: early ? null : mf.p, status: early ? 'early' : pStatus(mf.p), early: early, delta7: weekDelta(w, f), spark14: spark(w, f)
        };
      }
      var rf = { metric: 'roas', campaignsOnly: true };
      var rFact = aggRange(w, rf, Math.max(m.fromDay, DAY0()), t);
      var roasV = rFact[F().COST] > 0 ? rFact[F().REV] / rFact[F().COST] : null;
      var roasT = goal.roas;
      var uf = { metric: 'unsubRate' };
      var uFact = aggRange(w, uf, Math.max(m.fromDay, DAY0()), t);
      var uV = uFact[F().DELIV] > 0 ? uFact[F().UNSUB] / uFact[F().DELIV] : null;
      var uT = goal.unsubRate;
      var uEarly = early || !(uFact[F().DELIV] >= 1000);
      return {
        month: { label: m.label, name: m.name, fromDay: m.fromDay, toDay: m.toDay }, early: early, earlyNote: early ? EARLY_NOTE : null,
        revenue: tile('revenue', 'revenue'),
        conversions: tile('conversions', 'conversions'),
        roas: { value: roasV, target: roasT, delta7: weekDelta(w, rf), spark14: spark(w, rf),
          status: roasV === null || early ? 'early' : (roasV >= roasT ? 'on' : (roasV >= 0.85 * roasT ? 'risk' : 'off')) },
        unsubRate: { value: uV, target: uT, delta7: weekDelta(w, uf), spark14: spark(w, uf),
          status: uV === null || uEarly ? 'early' : (uV <= uT ? 'on' : (uV <= 1.3 * uT ? 'risk' : 'off')) }
      };
    });
  };

  /* ---------------- campaigns ---------------- */
  // Sums of c[cid].tot over every day, plus per-channel and per-day goal values.
  function campaignTotals(w, cid) {
    return memo('campaignTotals', [w, rv(w, 'metrics')], cid, function () {
      var tot = newFact(), ch = {}, days = w.metrics.days;
      for (var i = 0; i < days.length; i++) {
        var cd = days[i].c && days[i].c[cid];
        if (!cd) continue;
        add(tot, cd.tot);
        sortedKeys(cd.ch).forEach(function (k) { if (!ch[k]) ch[k] = newFact(); add(ch[k], cd.ch[k]); });
      }
      return { tot: tot, ch: ch };
    });
  }

  function dayValue(w, d, cid, idx) {
    var e = entry(w, d), cd = e && e.c && e.c[cid];
    return cd && cd.tot ? cd.tot[idx] : 0;
  }

  SEL.campaignGoal = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('campaignGoal', [w, rv(w, 'metrics'), c, w.meta.tick], cid, function () {
      var t = today(w), idx = F()[GOAL_METRIC[c.goal.type] || 'REV'];
      var target = c.goal.target;
      var valueAll = campaignTotals(w, cid).tot[idx];
      var startDay = Math.max(DAY0(), Math.floor(c.startTick / 24));
      var lastDay = Math.floor((c.endTick - 1) / 24);
      var complete = [];
      for (var d = startDay; d < t && d <= lastDay; d++) complete.push(dayValue(w, d, cid, idx));
      var todayVal = (t >= startDay && t <= lastDay) ? dayValue(w, t, cid, idx) : 0;
      var actualToDate = valueAll - todayVal;
      var daysLeft = (c.status === 'completed') ? 0 : Math.max(0, lastDay - Math.max(t, startDay) + 1);
      var out = { type: c.goal.type, target: target, value: valueAll, metric: GOAL_METRIC_NAME[c.goal.type], outlookPct: null, p: null, projected: null, daysLeft: daysLeft,
        elapsedDays: complete.length, early: c.status !== 'completed' && complete.length < 3 };
      if (daysLeft === 0) {
        out.outlookPct = target > 0 ? valueAll / target : null;
        out.p = valueAll >= target ? 1 : 0;
        out.projected = valueAll;
        return out;
      }
      var sumMean = 0, sumVar = 0, pts = null;
      var fc = holtForecast(complete, daysLeft);
      if (fc) {
        pts = fc.forecast;
        pts.forEach(function (p) { var sd = ptSd(p); sumMean += Math.max(0, p.mean); sumVar += sd * sd; });
      } else if (complete.length >= 3) {
        var md = MC.util.mean(complete), sdd = MC.util.sd(complete);
        sumMean = md * daysLeft; sumVar = daysLeft * Math.max(sdd * sdd, md);
      } else {
        return out;   // not started: no outlook yet
      }
      out.projected = actualToDate + sumMean;
      out.outlookPct = target > 0 ? out.projected / target : null;
      out.p = goalProb(actualToDate, pts, target, sumMean, sumVar);
      return out;
    });
  };

  // Applied changes (autopilot or approved) in the last `hours` hours, filtered. Same window as agentActivity.
  function changes24h(w, filterFn) {
    var t = w.meta.tick, n = 0, order = w.proposals.order;
    for (var i = 0; i < order.length; i++) {
      var p = w.proposals.byId[order[i]];
      if (!p || (p.status !== 'applied' && p.status !== 'auto') || !(p.appliedTick > t - 24)) continue;
      if (filterFn(p)) n++;
    }
    return n;
  }

  // Applied, proposed and waiting agent work over a recent window, in total and per agent.
  SEL.agentActivity = function (w, o) {
    o = o || {};
    var hours = o.hours > 0 ? o.hours : 24;
    return memo('agentActivity', [w, w.proposals, w.agents, w.meta.tick], String(hours), function () {
      var t = w.meta.tick, from = t - hours, by = {}, applied = 0, proposed = 0, pending = 0;
      function slot(id) { return by[id] || (by[id] = { applied: 0, proposed: 0, lastTick: null }); }
      (w.agents && w.agents.order || EMPTY).forEach(function (id) { slot(id); });
      w.proposals.order.forEach(function (id) {
        var p = w.proposals.byId[id];
        if (!p) return;
        var a = slot(p.agentId);
        if (p.status === 'pending') pending++;
        if (p.tick > from) { proposed++; a.proposed++; if (a.lastTick === null || p.tick > a.lastTick) a.lastTick = p.tick; }
        if ((p.status === 'applied' || p.status === 'auto') && p.appliedTick > from) {
          applied++; a.applied++;
          if (a.lastTick === null || p.appliedTick > a.lastTick) a.lastTick = p.appliedTick;
        }
      });
      return { applied: applied, proposed: proposed, pending: pending, byAgent: by };
    });
  };

  SEL.campaignRows = function (w) {
    return memo('campaignRows', [w, rv(w, 'metrics'), w.campaigns, w.proposals, w.variants, w.meta.tick], '', function () {
      var t = today(w);
      return w.campaigns.order.map(function (cid) {
        var c = camp(w, cid), g = SEL.campaignGoal(w, cid);
        var idx = F()[GOAL_METRIC[c.goal.type] || 'REV'];
        var sp = [];
        for (var d = Math.max(DAY0(), t - 14); d < t; d++) sp.push(dayValue(w, d, cid, idx));
        return {
          id: cid, name: c.name, status: c.status, channels: c.channels, startTick: c.startTick, endTick: c.endTick,
          spend: campaignTotals(w, cid).tot[F().COST], budget: c.budget.total,
          goal: { type: g.type, target: g.target, value: g.value, outlookPct: g.outlookPct, p: g.p, early: g.early, status: SEL.campaignPacing(w, cid).status },
          agentChanges24h: changes24h(w, function (p) { return targetCampaignId(w, p) === cid; }),
          spark14: sp
        };
      });
    });
  };

  SEL.campaignStats = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('campaignStats', [w, rv(w, 'metrics'), c, w.meta.tick], cid, function () {
      var T = campaignTotals(w, cid), f = F(), t = today(w);
      var spentByCh = {}, dailyByCh = {};
      c.channels.forEach(function (ch) {
        spentByCh[ch] = T.ch[ch] ? T.ch[ch][f.COST] : 0;
        var db = 0;
        if (MC.sim && typeof MC.sim.dailyBudget === 'function') { try { db = MC.sim.dailyBudget(w, cid, ch, t); } catch (e) { db = 0; } }
        dailyByCh[ch] = db;
      });
      var cost = T.tot[f.COST];
      var span = Math.max(1, c.endTick - c.startTick);
      var elapsed = MC.util.clamp((w.meta.tick - c.startTick) / span, 0, 1);
      var expected = c.budget.total * elapsed;
      var g = SEL.campaignGoal(w, cid);
      return {
        revenue: T.tot[f.REV], conv: T.tot[f.CONV], clicks: T.tot[f.CLICK], sends: T.tot[f.SENT], opens: T.tot[f.OPEN],
        cost: cost, react: T.tot[f.REACT], unsubs: T.tot[f.UNSUB], impressions: T.tot[f.IMPR],
        roas: cost > 0 ? T.tot[f.REV] / cost : null,
        spentByCh: spentByCh, budgetByCh: c.budget.byChannel, dailyBudgetByCh: dailyByCh,
        pace: expected > 0 ? cost / expected : null, daysLeft: g ? g.daysLeft : 0, goal: g
      };
    });
  };

  /* ---------------- campaign pacing, lift, load, collisions ---------------- */
  function goalMoney(c, v) {
    var type = c.goal.type;
    if (type === 'revenue') return MC.fmt.money(v, { compact: true });
    return MC.fmt.num(v, { compact: true }) + (type === 'reactivation' ? ' reactivations' : (type === 'engagement' ? ' clicks' : ' conversions'));
  }
  // The one pacing calculation. Outlook %, status and the "expected by now" figure all derive from campaignGoal's
  // projection, so Outlook, Insight Analyst and the campaign cards agree: outlook % = actual / expectedByNow.
  SEL.campaignPacing = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('campaignPacing', [w, rv(w, 'metrics'), c, w.meta.tick], cid, function () {
      var g = SEL.campaignGoal(w, cid), target = g.target, actual = g.value;
      var span = Math.max(1, c.endTick - c.startTick);
      var linear = target * MC.util.clamp((w.meta.tick - c.startTick) / span, 0, 1);
      var out = { target: target, actual: actual, expectedByNow: linear, delta: actual - linear, status: 'early', recoverNote: null };
      if (c.status === 'draft' || c.status === 'scheduled') { out.expectedByNow = 0; out.delta = 0; return out; }
      if (g.early || g.projected === null || !(g.projected > 0) || !(target > 0)) return out;
      var ratio = g.projected / target;
      out.expectedByNow = Math.min(target, target * actual / g.projected);
      out.delta = actual - out.expectedByNow;
      out.status = ratio >= 1.05 ? 'ahead' : (ratio >= 0.9 ? 'on' : 'behind');
      if (out.status === 'behind' && g.daysLeft > 0) {
        var gap = target - g.projected;
        out.recoverNote = 'On track to finish about ' + goalMoney(c, gap) + ' short. Closing that takes about ' + goalMoney(c, gap / g.daysLeft) +
          ' more a day for the last ' + g.daysLeft + (g.daysLeft === 1 ? ' day.' : ' days.');
      }
      return out;
    });
  };

  // Revenue per person: people the campaign enrolled vs the held-out control group. Mean difference with a 95%
  // interval from the per-person sample variance (log-ratio delta method).
  SEL.campaignLift = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('campaignLift', [w, rv(w, 'enroll'), rv(w, 'metrics'), c, w.meta.tick], cid, function () {
      var E = w.enroll && w.enroll[cid];
      var out = { ready: false, metric: 'revenue per person', treated: null, control: null, liftPct: null, lo: null, hi: null, nTreated: 0, nControl: 0, note: '' };
      if (!E || !E.step) { out.note = c.status === 'draft' || c.status === 'scheduled' ? 'Starts when the campaign goes live.' : 'No results yet.'; return out; }
      var n = [0, 0], s1 = [0, 0], s2 = [0, 0], buyers = [0, 0];
      for (var i = 0; i < E.step.length; i++) {
        if (E.step[i] === -1) continue;
        var k = E.ctl[i] ? 1 : 0, r = E.rev[i];
        n[k]++; s1[k] += r; s2[k] += r * r; if (r > 0) buyers[k]++;
      }
      out.nTreated = n[0]; out.nControl = n[1];
      if (n[1] < 100) { out.note = 'The control group has ' + n[1] + ' people so far. Lift shows once it reaches 100.'; return out; }
      var mt = s1[0] / n[0], mc = s1[1] / n[1];
      out.treated = mt; out.control = mc;
      if (buyers[1] < 3) { out.note = 'Only ' + buyers[1] + (buyers[1] === 1 ? ' person' : ' people') + ' in the control group ' + (buyers[1] === 1 ? 'has' : 'have') + ' bought so far. Lift needs at least 3.'; return out; }
      var vt = Math.max(0, s2[0] / n[0] - mt * mt) / n[0], vc = Math.max(0, s2[1] / n[1] - mc * mc) / n[1];
      var lr = Math.log(mt > 0 ? mt / mc : 1e-9), se = Math.sqrt(vt / (mt * mt || 1) + vc / (mc * mc));
      out.liftPct = mt / mc - 1;
      out.lo = mt > 0 ? Math.exp(lr - Z95 * se) - 1 : -1;
      out.hi = mt > 0 ? Math.exp(lr + Z95 * se) - 1 : -1;
      out.ready = true;
      out.note = out.lo > 0 ? 'Clearly above the control group.' : (out.hi < 0 ? 'Clearly below the control group.' : 'Too close to call: the range includes no lift.');
      return out;
    });
  };

  // How many messages people got across all owned channels. days is capped at the 7 the profile store keeps.
  SEL.messageLoad = function (w, o) {
    o = o || {};
    var days = Math.max(1, Math.min(7, Math.round(o.days > 0 ? o.days : 7)));
    return memo('messageLoad', [w, w.meta.tick, w.guardrails], String(days), function () {
      var P = w.profiles, t = today(w), counts = {}, over = 0, cap = ((w.guardrails && w.guardrails.freqCap) || { email: 4 }).email || 4;
      var slots = [];
      for (var q = 0; q < days; q++) slots.push((((t - q) % 7) + 7) % 7);
      for (var i = 0; i < P.n; i++) {
        var tot = 0;
        for (var ci = 0; ci < 3; ci++) for (var j = 0; j < slots.length; j++) tot += P.sent7[i * 21 + ci * 7 + slots[j]];
        counts[tot] = (counts[tot] || 0) + 1;
        if (tot > cap) over++;
      }
      var dist = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { sends: k, profiles: counts[k] }; });
      var by = {}, ids = w.campaigns.order, f = F();
      for (var d = Math.max(DAY0(), t - days + 1); d <= t; d++) {
        var e = entry(w, d);
        if (!e || !e.c) continue;
        ids.forEach(function (cid) {
          var cd = e.c[cid];
          if (!cd || !cd.ch) return;
          MC.CH.OWNED.forEach(function (ch) { if (cd.ch[ch]) by[cid] = (by[cid] || 0) + cd.ch[ch][f.SENT]; });
        });
      }
      return { days: days, cap: cap, people: P.n, distribution: dist, overCap: over, byCampaign: by };
    });
  };

  // Live or scheduled campaigns sharing both audience and a channel with `cid` on overlapping days.
  SEL.collisions = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return EMPTY;
    return memo('collisions', [w, w.campaigns, w.segments, rv(w, 'segCounts'), w.profiles], cid, function () {
      var out = [], S = MC.segments;
      if (!S || typeof S.audienceOf !== 'function') return out;
      var a = S.audienceOf(w, c), na = 0, n = a.length, i;
      for (i = 0; i < n; i++) na += a[i];
      var fromA = Math.floor(c.startTick / 24), toA = Math.floor((c.endTick - 1) / 24);
      w.campaigns.order.forEach(function (oid) {
        var o = camp(w, oid);
        if (!o || oid === cid || (o.status !== 'live' && o.status !== 'scheduled') || na === 0) return;
        var from = Math.max(fromA, Math.floor(o.startTick / 24)), to = Math.min(toA, Math.floor((o.endTick - 1) / 24));
        if (from > to) return;
        var shared = c.channels.filter(function (ch) { return o.channels.indexOf(ch) >= 0 && MC.CH.OWNED.indexOf(ch) >= 0; });
        if (!shared.length) return;
        var b = S.audienceOf(w, o), both = 0;
        for (i = 0; i < n; i++) if (a[i] && b[i]) both++;
        if (!both) return;
        shared.forEach(function (ch) { out.push({ otherId: oid, otherName: o.name, channel: ch, overlapPct: both / na, fromDay: from, toDay: to }); });
      });
      return out;
    });
  };

  function priorAlloc(w, cid, ch) {
    var t = w.meta.tick, order = w.proposals.order;
    for (var i = 0; i < order.length; i++) {
      var p = w.proposals.byId[order[i]];
      if (!p || (p.status !== 'applied' && p.status !== 'auto') || !(p.appliedTick >= t - 24)) continue;
      var inv = p.inverse || EMPTY;
      for (var j = 0; j < inv.length; j++) {
        var a = inv[j];
        if (a.type === 'campaign/setAlloc' && a.payload && a.payload.id === cid && a.payload.channel === ch) return a.payload.alloc;
      }
    }
    return null;
  }

  SEL.variantStats = function (w, cid, ch) {
    var c = camp(w, cid);
    if (!c) return EMPTY;
    return memo('variantStats', [w, rv(w, 'metrics'), c, w.variants, w.proposals, w.meta.tick], cid + '|' + ch, function () {
      var f = F(), days = w.metrics.days, sums = {};
      var vs = sortedKeys(w.variants.byId).map(function (id) { return w.variants.byId[id]; })
        .filter(function (v) { return v.campaignId === cid && v.channel === ch; });
      vs.forEach(function (v) { sums[v.id] = newFact(); });
      for (var i = 0; i < days.length; i++) {
        var cd = days[i].c && days[i].c[cid];
        if (!cd || !cd.v) continue;
        vs.forEach(function (v) { add(sums[v.id], cd.v[v.id]); });
      }
      vs = vs.filter(function (v) { return v.status !== 'retired' || sums[v.id][f.SENT] > 0; });
      vs.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : (a.id < b.id ? -1 : 1)); });
      var clicksGoal = c.goal.type === 'engagement' || c.goal.type === 'launch';
      var alloc = c.alloc[ch] || {}, prev = priorAlloc(w, cid, ch);
      var live = vs.filter(function (v) { return v.status === 'live'; });
      var pb = {};
      if (live.length > 1 && MC.models && typeof MC.models.probBest === 'function') {
        var arms = live.map(function (v) {
          var s = sums[v.id], k = clicksGoal ? s[f.CLICK] : s[f.CONV], n = s[f.SENT];
          return { a: 1 + k, b: 1 + Math.max(0, n - k) };
        });
        try {
          var rng = MC.rng.fork(w.meta.seed, 'ui', 'pbest', cid, ch, w.meta.tick);
          var probs = MC.models.probBest(arms, rng, 400) || [];
          live.forEach(function (v, k) { pb[v.id] = probs[k]; });
        } catch (e) { /* leave empty */ }
      } else if (live.length === 1) pb[live[0].id] = 1;
      return vs.map(function (v) {
        var s = sums[v.id], n = s[f.SENT], k = clicksGoal ? s[f.CLICK] : s[f.CONV];
        return {
          id: v.id, name: v.name, author: v.author, status: v.status, share: alloc[v.id] || 0,
          prevShare: prev ? (prev[v.id] || 0) : null,
          sends: n, opens: s[f.OPEN], clicks: s[f.CLICK], conv: s[f.CONV], revenue: s[f.REV],
          openRate: n > 0 ? s[f.OPEN] / n : 0, clickRate: n > 0 ? s[f.CLICK] / n : 0,
          convPerSend: n > 0 ? s[f.CONV] / n : 0, ci: MC.util.wilson(k, n),
          pBest: pb[v.id] !== undefined ? pb[v.id] : null, reward: clicksGoal ? 'clicks' : 'conversions'
        };
      });
    });
  };

  /* ---------------- analytics ---------------- */
  // Owned channels only (email, SMS, push): paid clicks have no send or open to compare against. Opened is shown only
  // for email and push, and only when it sits above clicks. Each stage carries its rate against the stage before
  // (rateOfPrev) and against everyone sent (rateOfSent).
  SEL.funnel = function (w, f) {
    f = f || {};
    return memo('funnel', [w, rv(w, 'metrics')], argKey(f), function () {
      var r = resolveRange(w, f), k = F(), x = newFact();
      var chs = f.channel && f.channel !== 'all' ? [f.channel] : MC.CH.OWNED;
      chs.forEach(function (ch) {
        if (MC.CH.OWNED.indexOf(ch) >= 0) add(x, aggRange(w, { campaignIds: f.campaignIds, channel: ch, metric: 'revenue' }, r.from, r.to));
      });
      var withOpen = chs.length === 1 && chs[0] !== 'sms' && x[k.OPEN] >= x[k.CLICK];
      var st = [{ key: 'sent', label: 'Sent', value: x[k.SENT] }, { key: 'delivered', label: 'Delivered', value: x[k.DELIV] }];
      if (withOpen) st.push({ key: 'opened', label: 'Opened', value: x[k.OPEN] });
      st.push({ key: 'clicked', label: 'Clicked', value: x[k.CLICK] }, { key: 'converted', label: 'Converted', value: x[k.CONV] });
      st.forEach(function (s, i) {
        s.rateOfPrev = i > 0 && st[i - 1].value > 0 ? s.value / st[i - 1].value : null;
        s.rateOfSent = i > 0 && st[0].value > 0 ? s.value / st[0].value : null;
      });
      return st;
    });
  };

  SEL.channelCompare = function (w, f) {
    f = f || {};
    return memo('channelCompare', [w, rv(w, 'metrics')], argKey(f), function () {
      var r = resolveRange(w, f), k = F();
      return MC.CH.ALL.map(function (ch) {
        var x = aggRange(w, { campaignIds: f.campaignIds, channel: ch, metric: 'revenue' }, r.from, r.to);
        var paid = MC.CH.PAID.indexOf(ch) >= 0;
        var den = paid ? x[k.IMPR] : x[k.SENT];
        return {
          ch: ch, label: MC.CH.LABEL[ch], sends: x[k.SENT], impressions: x[k.IMPR], clicks: x[k.CLICK],
          conv: x[k.CONV], revenue: x[k.REV], cost: x[k.COST],
          roas: x[k.COST] > 0 ? x[k.REV] / x[k.COST] : null,
          ctr: den > 0 ? x[k.CLICK] / den : 0, ci: MC.util.wilson(x[k.CLICK], den)
        };
      });
    });
  };

  SEL.attribution = function (w, f) {
    f = f || {};
    return memo('attribution', [w, rv(w, 'metrics')], argKey(f), function () {
      var r = resolveRange(w, f), key = f.model === 'linear' ? 'attrLin' : 'attrLast';
      var ids = f.campaignIds && f.campaignIds.length ? f.campaignIds : null;
      var byChannel = {}, byCampaign = {};
      MC.CH.ALL.forEach(function (ch) { byChannel[ch] = 0; });
      for (var d = r.from; d <= r.to; d++) {
        var e = entry(w, d);
        if (!e || !e.c) continue;
        (ids || sortedKeys(e.c)).forEach(function (cid) {
          var cd = e.c[cid], a = cd && cd[key];
          if (!a) return;
          if (!byCampaign[cid]) { byCampaign[cid] = {}; MC.CH.ALL.forEach(function (ch) { byCampaign[cid][ch] = 0; }); }
          sortedKeys(a).forEach(function (ch) { byChannel[ch] = (byChannel[ch] || 0) + a[ch]; byCampaign[cid][ch] = (byCampaign[cid][ch] || 0) + a[ch]; });
        });
      }
      return { model: f.model === 'linear' ? 'linear' : 'last', byChannel: byChannel, byCampaign: byCampaign };
    });
  };

  SEL.liftVsControl = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('liftVsControl', [w, rv(w, 'metrics'), c], cid, function () {
      var k = F(), clicksGoal = c.goal.type === 'engagement' || c.goal.type === 'launch';
      var num = clicksGoal ? k.CLICK : k.CONV;
      var tr = newFact(), ct = newFact(), days = w.metrics.days;
      for (var i = 0; i < days.length; i++) {
        var cd = days[i].c && days[i].c[cid];
        if (!cd) continue;
        MC.CH.OWNED.forEach(function (ch) { add(tr, cd.trt && cd.trt[ch]); add(ct, cd.ctl && cd.ctl[ch]); });
      }
      if (ct[k.SENT] < 100 || tr[k.SENT] <= 0) return null;
      var rt = tr[num] / tr[k.SENT], rc = ct[num] / ct[k.SENT];
      var out = { metric: clicksGoal ? 'clicks per send' : 'conversions per send', trt: { rate: rt, n: tr[k.SENT] }, ctl: { rate: rc, n: ct[k.SENT] }, lift: null, lo: null, hi: null };
      if (!(rc > 0)) return out;
      var wt = MC.util.wilson(tr[num], tr[k.SENT]), wc = MC.util.wilson(ct[num], ct[k.SENT]);
      var set = (wt[1] - wt[0]) / (2 * Z95), sec = (wc[1] - wc[0]) / (2 * Z95);
      var ratio = rt / rc;
      out.lift = ratio - 1;
      // Delta method on the log ratio.
      var v = (rt > 0 ? (set / rt) * (set / rt) : 0) + (sec / rc) * (sec / rc);
      var s = Math.sqrt(v);
      out.lo = (rt > 0 ? ratio * Math.exp(-Z95 * s) : 0) - 1;
      out.hi = (rt > 0 ? ratio * Math.exp(Z95 * s) : 0) - 1;
      return out;
    });
  };

  SEL.agentMarkers = function (w, f) {
    f = f || {};
    return memo('agentMarkers', [w, w.proposals, w.meta.tick], argKey(f), function () {
      var r = resolveRange(w, f), out = [];
      var ids = f.campaignIds && f.campaignIds.length ? f.campaignIds : null;
      w.proposals.order.forEach(function (id) {
        var p = w.proposals.byId[id];
        if (!p || !isApplied(p)) return;
        var d = Math.floor(p.appliedTick / 24);
        if (d < r.from || d > r.to) return;
        if (ids && ids.indexOf(targetCampaignId(w, p)) < 0) return;
        out.push({ day: d, tick: p.appliedTick, agentId: p.agentId, proposalId: p.id, label: agentName(p.agentId) + ': ' + p.title, status: p.status });
      });
      return MC.util.stableSort(out, function (a, b) { return a.tick - b.tick || (a.proposalId < b.proposalId ? -1 : (a.proposalId > b.proposalId ? 1 : 0)); });
    });
  };

  /* ---------------- proposals, feed, agents ---------------- */
  SEL.openProposals = function (w) {
    return memo('openProposals', [w, w.proposals], '', function () {
      return (w.proposals.open || EMPTY).map(function (id) { return w.proposals.byId[id]; })
        .filter(function (p) { return p && p.status === 'pending'; });
    });
  };

  SEL.proposalsFor = function (w, entityId) {
    return memo('proposalsFor', [w, w.proposals, w.variants], String(entityId), function () {
      return w.proposals.order.map(function (id) { return w.proposals.byId[id]; }).filter(function (p) {
        if (!p) return false;
        if (p.target && p.target.id === entityId) return true;
        if (targetCampaignId(w, p) === entityId) return true;
        return (p.actions || EMPTY).some(function (a) { return a.payload && a.payload.id === entityId; });
      });
    });
  };

  SEL.feed = function (w, o) {
    o = o || {};
    return memo('feed', [w, w.feed, w.variants, w.proposals], argKey(o), function () {
      var kinds = o.kinds && o.kinds.length ? o.kinds : null;
      var eid = o.entityId || null;
      var list = w.feed || EMPTY;
      if (!kinds && !eid && !o.agentId) return list;
      return list.filter(function (it) {
        if (kinds && kinds.indexOf(it.kind) < 0) return false;
        if (o.agentId && it.agentId !== o.agentId) return false;
        if (eid) {
          var en = it.entity;
          if (!en) return false;
          if (en.id === eid) return true;
          var v = en.kind === 'variant' && w.variants.byId[en.id];
          if (v && v.campaignId === eid) return true;
          if (it.proposalId) { var p = w.proposals.byId[it.proposalId]; if (p && targetCampaignId(w, p) === eid) return true; }
          return false;
        }
        return true;
      });
    });
  };

  function fallbackStatus(w, a) {
    var state = a.autonomy === 'off' ? 'off' : (a.status === 'paused' ? 'paused' : (a.runRequested ? 'queued' : 'running'));
    return { state: state, lastRun: a.lastRunTick, nextRun: null };
  }

  SEL.agentRoster = function (w) {
    return memo('agentRoster', [w, w.agents, w.proposals, w.meta.tick], '', function () {
      var t = w.meta.tick;
      return w.agents.order.map(function (id) {
        var a = w.agents.byId[id], def = agentDef(id) || {};
        var st = null;
        if (MC.runtime && typeof MC.runtime.statusOf === 'function') { try { st = MC.runtime.statusOf(w, id); } catch (e) { st = null; } }
        st = st || fallbackStatus(w, a);
        var pending = 0;
        (w.proposals.open || EMPTY).forEach(function (pid) { var p = w.proposals.byId[pid]; if (p && p.agentId === id && p.status === 'pending') pending++; });
        return {
          id: id, name: def.name || id, short: def.short || '', icon: def.icon || null,
          status: st.state, agentStatus: a.status, autonomy: a.autonomy, cadence: a.cadence,
          lastRun: st.lastRun !== undefined ? st.lastRun : a.lastRunTick, nextRun: st.nextRun,
          changes24h: SEL.agentActivity(w, { hours: 24 }).byAgent[id] ? SEL.agentActivity(w, { hours: 24 }).byAgent[id].applied : 0,
          pending: pending, stats: a.stats, ranThisTick: a.lastRunTick === t
        };
      });
    });
  };

  var NOT_MEASURED = { 'new-segment': 1, retarget: 1, 'campaign-draft': 1, 'pause-channel': 1 };
  SEL.agentImpact = function (w) {
    return memo('agentImpact', [w, w.proposals, w.meta.tick], '', function () {
      var t = w.meta.tick, rows = [], te = 0, tr = 0;
      w.proposals.order.forEach(function (id) {
        var p = w.proposals.byId[id];
        if (!p || !isApplied(p)) return;
        var imp = p.impact || {}, dollars = imp.unit === '$';
        var status, hoursLeft = null;
        if (p.status === 'undone') status = 'undone';
        else if (p.realized) status = 'realized';
        else if (NOT_MEASURED[p.kind] || !dollars) status = 'not-measured';
        else { status = 'measuring'; hoursLeft = Math.max(0, p.appliedTick + (p.horizon || 0) - t); }
        var row = {
          proposalId: p.id, agentId: p.agentId, kind: p.kind, title: p.title, appliedTick: p.appliedTick,
          expected: imp.delta !== undefined ? imp.delta : null, unit: imp.unit || null,
          realized: p.realized ? p.realized.delta : null, realizedLo: p.realized ? p.realized.lo : null, realizedHi: p.realized ? p.realized.hi : null,
          method: p.realized ? p.realized.method : null, status: status, hoursLeft: hoursLeft
        };
        if (dollars && status !== 'undone' && isFinite(row.expected)) te += row.expected;
        if (dollars && status === 'realized' && isFinite(row.realized)) tr += row.realized;
        rows.push(row);
      });
      return { rows: rows, totals: { expected: te, realized: tr } };
    });
  };

  /* ---------------- segments ---------------- */
  function segmentMeans(w) {
    return memo('segmentMeans', [w, w.segments, rv(w, 'segCounts'), today(w)], '', function () {
      var out = {}, P = w.profiles;
      w.segments.order.forEach(function (id) {
        var bits = null;
        if (MC.segments && typeof MC.segments.members === 'function') { try { bits = MC.segments.members(w, id); } catch (e) { bits = null; } }
        if (!bits) { out[id] = { meanProp: null, meanLtv: null }; return; }
        var n = 0, sp = 0, sl = 0;
        for (var i = 0; i < P.n; i++) if (bits[i]) { n++; sp += P.prop[i]; sl += P.ltv[i]; }
        out[id] = { meanProp: n ? sp / n : null, meanLtv: n ? sl / n : null };
      });
      return out;
    });
  }

  SEL.segmentRows = function (w) {
    return memo('segmentRows', [w, w.segments, rv(w, 'segCounts'), w.campaigns, rv(w, 'metrics'), today(w)], '', function () {
      var means = segmentMeans(w), k = F();
      return w.segments.order.map(function (id) {
        var s = w.segments.byId[id];
        var hist = s.countHist || EMPTY;
        var used = [], rev = 0, cost = 0;
        w.campaigns.order.forEach(function (cid) {
          var c = camp(w, cid);
          if (c.segmentId === id || (c.include || EMPTY).indexOf(id) >= 0) used.push(cid);
          if (c.segmentId === id) { var T = campaignTotals(w, cid).tot; rev += T[k.REV]; cost += T[k.COST]; }
        });
        return {
          id: id, name: s.name, count: s.count, change7: hist.length > 1 ? s.count - hist[0] : null,
          meanProp: means[id] ? means[id].meanProp : null, meanLtv: means[id] ? means[id].meanLtv : null,
          roas: cost > 0 ? rev / cost : null, usedIn: used, author: s.author, ver: s.ver
        };
      });
    });
  };

  /* ---------------- movers & insights ---------------- */
  SEL.movers = function (w) {
    var t = today(w);
    return memo('movers', [w, t, w.metrics.days.length, w.campaigns, w.proposals], '', function () {
      var k = F(), rows = [];
      w.campaigns.order.forEach(function (cid) {
        var a = 0, b = 0;
        for (var d = t - 7; d < t; d++) a += dayValue(w, d, cid, k.REV);
        for (var d2 = t - 14; d2 < t - 7; d2++) b += dayValue(w, d2, cid, k.REV);
        var delta = a - b;
        if (Math.abs(delta) < 1) return;
        var row = { id: cid, campaignId: cid, name: camp(w, cid).name, delta: delta, note: '' };
        var order = w.proposals.order;
        for (var i = 0; i < order.length; i++) {
          var p = w.proposals.byId[order[i]];
          if (!p || (p.status !== 'applied' && p.status !== 'auto') || !(p.appliedTick >= (t - 7) * 24)) continue;
          if (targetCampaignId(w, p) !== cid) continue;
          row.agentId = p.agentId; row.proposalId = p.id;
          row.note = 'after ' + agentName(p.agentId) + ' change (' + MC.fmt.dayShort(Math.floor(p.appliedTick / 24)) + ')';
          break;
        }
        rows.push(row);
      });
      rows = MC.util.stableSort(rows, function (x, y) { return Math.abs(y.delta) - Math.abs(x.delta); }).slice(0, 3);
      rows.forEach(function (r) { delete r.id; });
      return rows;
    });
  };

  SEL.insights = function (w, o) {
    o = o || {};
    return memo('insights', [w, w.insights], argKey(o), function () {
      var kinds = o.kinds && o.kinds.length ? o.kinds : null;
      return (w.insights || EMPTY).filter(function (x) {
        if (!o.includeDismissed && x.dismissed) return false;
        if (kinds && kinds.indexOf(x.kind) < 0) return false;
        if (o.entityId && !(x.entity && x.entity.id === o.entityId)) return false;
        return true;
      });
    });
  };

  /* ---------------- journey ---------------- */
  SEL.journeyStats = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return {};
    return memo('journeyStats', [w, c, rv(w, 'enroll'), rv(w, 'metrics')], cid, function () {
      var steps = c.journey.steps, out = {}, counts = new Array(steps.length);
      for (var s = 0; s < steps.length; s++) counts[s] = 0;
      var en = w.enroll && w.enroll[cid];
      var exitIdx = -1, completed = 0;
      for (var q = 0; q < steps.length; q++) if (steps[q].type === 'exit') { exitIdx = q; break; }
      if (en && en.step) for (var i = 0; i < en.step.length; i++) {
        var x = en.step[i];
        if (x >= 0 && x < steps.length) counts[x]++;
        else if (x === -2) completed++;   // finished the journey (exited)
      }
      if (exitIdx >= 0) counts[exitIdx] += completed;
      var te = entry(w, today(w)), tcd = te && te.c && te.c[cid];
      var yes = {}, no = {}, days = w.metrics.days;
      for (var d = 0; d < days.length; d++) {
        var cd = days[d].c && days[d].c[cid];
        if (!cd || !cd.steps) continue;
        sortedKeys(cd.steps).forEach(function (sid) { yes[sid] = (yes[sid] || 0) + cd.steps[sid][1]; no[sid] = (no[sid] || 0) + cd.steps[sid][2]; });
      }
      steps.forEach(function (st, idx) {
        var row = { inStep: counts[idx], completed: idx === exitIdx ? completed : undefined, sentToday: tcd && tcd.steps && tcd.steps[st.id] ? tcd.steps[st.id][0] : 0 };
        if (st.type === 'decide') {
          var y = yes[st.id] || 0, n = no[st.id] || 0;
          row.yesPct = y + n > 0 ? y / (y + n) : null;
          row.noPct = y + n > 0 ? n / (y + n) : null;
        }
        out[st.id] = row;
      });
      return out;
    });
  };

  /* ---------------- profiles ---------------- */
  function idOf(x) { return x === undefined || x === null ? null : (typeof x === 'string' ? x : (x.id || x.code || null)); }
  function labelOf(x) { return x === undefined || x === null ? null : (typeof x === 'string' ? x : (x.label || x.name || x.id || x.code)); }
  var AFF_KEYS = ['affHike', 'affCamp', 'affClimb', 'affRun', 'affApparel'];
  var BEST_CH = ['email', 'sms', 'push'];

  SEL.profileRow = function (w, i) {
    var P = w.profiles;
    if (!P || !(i >= 0 && i < P.n)) return null;
    return memo('profileRow', [w, rv(w, 'profiles')], String(i), function () {
      var D = MC.data || {}, d = today(w), CHb = MC.CH.BIT;
      var NEVER = D.NEVER !== undefined ? D.NEVER : -9999;
      var st = D.STATES ? D.STATES[P.state[i]] : null;
      var rg = D.REGIONS ? D.REGIONS[P.region[i]] : null;
      var tr = D.TIERS ? D.TIERS[P.tier[i]] : null;
      var ct = D.CATEGORIES ? D.CATEGORIES[P.cat[i]] : null;
      var can = function (bit) { return !!(P.consent[i] & bit) && !(P.unsub[i] & bit); };
      var sent = 0, opn = 0, clk = 0;
      for (var c = 0; c < 3; c++) { sent += P.eng[i * 9 + c * 3]; opn += P.eng[i * 9 + c * 3 + 1]; clk += P.eng[i * 9 + c * 3 + 2]; }
      var s7 = 0;
      for (var k = 0; k < 21; k++) s7 += P.sent7[i * 21 + k];
      var lo = P.lastOrder[i];
      var row = {
        idx: i, id: P.id[i], name: P.name[i],
        state: idOf(st), stateLabel: labelOf(st), region: idOf(rg), regionLabel: labelOf(rg),
        age: P.age[i], tier: idOf(tr), tierLabel: labelOf(tr), tenureDays: P.tenure[i],
        canEmail: can(CHb.email), canSms: can(CHb.sms), canPush: can(CHb.push), canAds: can(CHb.social),
        lastOrderDays: lo === NEVER ? null : d - lo, lastOrderDay: lo === NEVER ? null : lo,
        orders: P.orders[i], spend: P.spend[i], aov: P.aov[i], visits30: P.visits30[i],
        topCategory: idOf(ct), topCategoryLabel: labelOf(ct),
        engRate: (opn + clk) / (sent + 5), fatigue: P.fatigue[i], sent7: s7,
        prop: P.prop[i], churn: P.churn[i], ltv: P.ltv[i],
        bestCh: P.bestCh[i] === 255 ? 'none' : (BEST_CH[P.bestCh[i]] || 'none'), bestHr: P.bestHr[i],
        suppressedUntil: { email: P.supUntil[i * 3], sms: P.supUntil[i * 3 + 1], push: P.supUntil[i * 3 + 2] }
      };
      AFF_KEYS.forEach(function (key, c2) { row[key] = P.aff[i * 5 + c2]; });
      return row;
    });
  };

  SEL.previewProfiles = function (w) {
    return memo('previewProfiles', [w, w.profiles], '', function () {
      var P = w.profiles, out = [];
      for (var i = 0; i < Math.min(8, P ? P.n : 0); i++) out.push({ idx: i, name: P.name[i] });
      return out;
    });
  };

  SEL.variantLibrary = function (w) {
    return memo('variantLibrary', [w, w.campaigns, w.variants], '', function () {
      var by = {};
      sortedKeys(w.variants.byId).forEach(function (id) {
        var v = w.variants.byId[id];
        (by[v.campaignId] = by[v.campaignId] || []).push(v);
      });
      return w.campaigns.order.map(function (cid) {
        var c = camp(w, cid);
        var list = (by[cid] || []).slice().sort(function (a, b) {
          return (MC.CH.IDX[a.channel] - MC.CH.IDX[b.channel]) || (a.name < b.name ? -1 : (a.name > b.name ? 1 : (a.id < b.id ? -1 : 1)));
        });
        return {
          campaignId: cid, name: c.name, status: c.status,
          variants: list.map(function (v) {
            return { id: v.id, name: v.name, channel: v.channel, status: v.status, share: (c.alloc[v.channel] || {})[v.id] || 0, author: v.author, ver: v.ver };
          })
        };
      });
    });
  };
})();
