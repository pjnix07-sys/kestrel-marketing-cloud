/* Marketing Cloud - Insight Analyst agent. Reads each running campaign's complete days, flags
   days that land well outside the usual range, warns when a campaign is unlikely to reach its goal
   (and suggests a short extension when that would close the gap), and once a week names the segment
   that returned the most for each campaign. Insights go to the feed; only the extension needs a person. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'analyst';
  var GOAL_KEY = { revenue: 'REV', conversions: 'CONV', reactivation: 'REACT', engagement: 'CLICK', launch: 'CONV' };
  var GOAL_NOUN = { revenue: 'revenue', conversions: 'conversions', reactivation: 'win-back', engagement: 'clicks', launch: 'conversions' };
  var MIN_DELIV = 50;           // a day needs this many deliveries before its rates are trusted
  var MIN_GOAL_DAYS = 3;

  function F() { return MC.F; }
  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }
  function money(x) { return MC.fmt.money(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 1 : dp); }
  function dayLabel(d) { return MC.fmt.dayLabel(d); }
  // "a 35% chance" / "an 18% chance"
  function chance(p) { if (p < 0.05) return 'under a 5% chance'; var s = pct(p, 0); return (/^(8|11|18|8\d)%/.test(s) ? 'an ' : 'a ') + s + ' chance'; }

  var METRICS = [
    { id: 'revenue', label: 'Revenue', fmt: money, dirs: 'both' },
    { id: 'conversions', label: 'Conversions', fmt: num, dirs: 'both' },
    { id: 'ctr', label: 'Click rate', fmt: function (x) { return pct(x, 2); }, dirs: 'both' },
    { id: 'unsubRate', label: 'Unsubscribe rate', fmt: function (x) { return pct(x, 2); }, dirs: 'up' },
    { id: 'spend', label: 'Spend', fmt: money, dirs: 'both' }
  ];

  /* ---------------- observe ---------------- */
  function campaignSeries(world, c, today) {
    var f = F(), out = { days: [], revenue: [], conversions: [], ctr: [], unsubRate: [], spend: [], goal: [] };
    var first = T().dayOf(c.startTick) + (((c.startTick % 24) + 24) % 24 === 0 ? 0 : 1);
    var last = Math.min(today - 1, T().dayOf(c.endTick - 1));
    var gk = f[GOAL_KEY[c.goal && c.goal.type] || 'REV'];
    for (var d = Math.max(first, T().DAY0); d <= last; d++) {
      var e = world.metrics.days[T().dayIndex(d)], cd = e && e.c && e.c[c.id];
      var tot = cd && cd.tot, deliv = 0, clicks = 0, unsub = 0;
      if (cd && cd.ch) MC.CH.OWNED.forEach(function (ch) {
        var x = cd.ch[ch];
        if (x) { deliv += x[f.DELIV]; clicks += x[f.CLICK]; unsub += x[f.UNSUB]; }
      });
      out.days.push(d);
      out.revenue.push(tot ? r4(tot[f.REV]) : 0);
      out.conversions.push(tot ? tot[f.CONV] : 0);
      out.spend.push(tot ? r4(tot[f.COST]) : 0);
      out.goal.push(tot ? r4(tot[gk]) : 0);
      out.ctr.push(deliv >= MIN_DELIV ? r4(clicks / deliv) : null);
      out.unsubRate.push(deliv >= MIN_DELIV ? r4(unsub / deliv) : null);
    }
    return out;
  }
  function accountSeries(world, today) {
    var f = F(), out = { days: [], revenue: [], conversions: [] };
    for (var d = T().DAY0; d < today; d++) {
      var e = world.metrics.days[T().dayIndex(d)];
      out.days.push(d);
      out.revenue.push(e && e.tot ? r4(e.tot[f.REV]) : 0);
      out.conversions.push(e && e.tot ? e.tot[f.CONV] : 0);
    }
    return out;
  }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), camps = [];
    (world.campaigns.order || []).forEach(function (cid) {
      var c = world.campaigns.byId[cid];
      if (!c || (c.status !== 'live' && c.status !== 'paused')) return;
      camps.push({ id: cid, name: c.name, status: c.status, goal: c.goal, startTick: c.startTick, endTick: c.endTick,
        segmentId: c.segmentId, series: campaignSeries(world, c, today) });
    });
    return { tick: t, day: today, dow: T().dow(t), account: accountSeries(world, today), campaigns: camps };
  }

  /* ---------------- anomalies ---------------- */
  function anomalyOn(series, p) {
    // Only the most recent complete day is tested; earlier days were tested on earlier runs.
    var ys = [], ok = true;
    for (var i = 0; i < series.length; i++) { if (series[i] === null) { ok = false; break; } ys.push(series[i]); }
    if (!ok || ys.length < 8) return null;
    var rows = MC.models.ewma(ys, { lambda: p.lambda, z: p.z, minN: 7 });
    var last = rows[rows.length - 1];
    if (!last || last.i !== ys.length - 1 || !last.flag) return null;
    if (!(Math.abs(last.expected) > 1e-9) && !(last.value > 0)) return null;
    return last;
  }
  function anomalyInsight(scope, m, a, day) {
    var up = a.z > 0, where = scope.name ? ' on ' + scope.name : ' across the business';
    var sev = m.id === 'unsubRate' ? (a.z >= 5 ? 'crit' : 'warn') : ((m.id === 'revenue' || m.id === 'conversions') && !up ? 'warn' : 'info');
    return {
      kind: 'anomaly',
      title: m.label + where + ' ' + (up ? 'rose' : 'fell') + ' to ' + m.fmt(a.value) + ' on ' + dayLabel(day),
      body: 'That is far ' + (up ? 'above' : 'below') + ' the expected ' + m.fmt(a.expected) + ' (about ' + MC.fmt.ratio(Math.abs(a.z)) +
        ' the usual day-to-day swing).' + (m.id === 'unsubRate' && up ? ' Fatigue Guard watches for this too; check message frequency.' : ''),
      entity: scope.id ? { kind: 'campaign', id: scope.id } : undefined,
      severity: sev,
      key: 'anomaly|' + (scope.id || 'all') + '|' + m.id + '|' + day
    };
  }

  /* ---------------- goal outlook ---------------- */
  function outlook(series, actual, daysLeft, extra) {
    var n = series.length, h = daysLeft + (extra || 0), pts = [];
    if (h <= 0) return { pts: [], mean: 0 };
    if (n >= 7) {
      pts = MC.models.holt(series, { season: 7, h: h }).forecast.map(function (x) { return { mean: Math.max(0, x.mean), 'var': x['var'] }; });
    } else {
      var m = MC.util.mean(series), sd = n > 1 ? MC.util.sd(series) : Math.abs(m) * 0.5;
      for (var k = 0; k < h; k++) pts.push({ mean: m, 'var': sd * sd });
    }
    var s = 0;
    pts.forEach(function (x) { s += x.mean; });
    return { pts: pts, mean: s };
  }
  function goalFmt(type) { return type === 'revenue' ? money : num; }

  // A goal warning repeats at most every 3 days unless it gets more serious.
  function recentGoalWarning(world, cid, t, sev) {
    var list = world.insights || [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.agentId !== ID || x.kind !== 'goal-risk' || !x.entity || x.entity.id !== cid || t - x.tick >= 72) continue;
      if (sev === 'crit' && x.severity !== 'crit') continue;
      return true;
    }
    return false;
  }

  /* ---------------- weekly ROI by segment ---------------- */
  function roiInsight(world, c, day) {
    var E = world.enroll && world.enroll[c.id];
    if (!E || !E.rev) return null;
    var n = world.profiles.n, enrolled = 0, total = 0, i;
    for (i = 0; i < n; i++) if (E.step[i] !== -1) { enrolled++; total += E.rev[i]; }
    if (enrolled < 100 || !(total > 0)) return null;
    var best = null;
    (world.segments.order || []).forEach(function (sid) {
      var bits = MC.segments.members(world, sid);
      if (!bits) return;
      var cnt = 0, rev = 0;
      for (i = 0; i < n; i++) if (bits[i] && E.step[i] !== -1) { cnt++; rev += E.rev[i]; }
      var sizeShare = cnt / enrolled, revShare = rev / total;
      if (cnt < 50 || sizeShare < 0.05 || sizeShare > 0.8) return;
      var ratio = revShare / sizeShare;
      if (!best || ratio > best.ratio + 1e-12 || (Math.abs(ratio - best.ratio) <= 1e-12 && sid < best.sid)) best = { sid: sid, ratio: ratio, sizeShare: sizeShare, revShare: revShare, cnt: cnt };
    });
    if (!best || best.ratio < 1.2) return null;
    var s = world.segments.byId[best.sid];
    return {
      kind: 'roi',
      title: s.name + ' drove ' + pct(best.revShare, 0) + ' of ' + c.name + ' revenue from ' + pct(best.sizeShare, 0) + ' of its audience',
      body: 'That is ' + MC.fmt.ratio(best.ratio) + ' the average return per person (' + num(best.cnt) + ' people, ' + money(best.revShare * total) +
        ' of ' + money(total) + ' so far). Worth weighting future sends and budget toward them.',
      entity: { kind: 'campaign', id: c.id }, severity: 'info', key: 'roi|' + c.id + '|' + day
    };
  }

  /* ---------------- decide ---------------- */
  function decide(obs, ctx) {
    var p = ctx.params, t = ctx.tick, world = ctx.world, today = obs.day, yday = today - 1;
    var insights = [], proposals = [], trace = [], rows = [];
    trace.push({ step: 'observe', text: 'Read the complete days for ' + obs.campaigns.length + (obs.campaigns.length === 1 ? ' running campaign' : ' running campaigns') +
      ' and the business as a whole.' });

    // 1. Anomalies on the last complete day.
    [{ m: METRICS[0], s: obs.account.revenue }, { m: METRICS[1], s: obs.account.conversions }].forEach(function (x) {
      var a = anomalyOn(x.s, p);
      if (a) insights.push(anomalyInsight({}, x.m, a, yday));
    });
    obs.campaigns.forEach(function (c) {
      var lastDay = c.series.days[c.series.days.length - 1];
      if (lastDay !== yday) return;
      METRICS.forEach(function (m) {
        var a = anomalyOn(c.series[m.id], p);
        if (!a) return;
        if (m.dirs === 'up' && a.z < 0) return;
        insights.push(anomalyInsight(c, m, a, yday));
      });
    });
    if (insights.length) trace.push({ step: 'decide', text: 'Found ' + insights.length + (insights.length === 1 ? ' day' : ' days') + ' outside the usual range.',
      rows: insights.map(function (x) { return { insight: x.title }; }) });

    // 2. Goal outlook for live campaigns.
    obs.campaigns.forEach(function (c) {
      if (c.status !== 'live' || !c.goal || !(c.goal.target > 0)) return;
      var s = c.series.goal, n = s.length;
      if (n < MIN_GOAL_DAYS) { rows.push({ campaign: c.name, outlook: 'Too early to tell' }); return; }
      // Pacing, projection and chance all come from the same selectors the campaign views use, so the wording never disagrees with them.
      var S = MC.select, pace = S && S.campaignPacing ? S.campaignPacing(world, c.id) : null, g = S && S.campaignGoal ? S.campaignGoal(world, c.id) : null;
      if (!pace || !g || g.early || !isNum(g.projected) || !isNum(g.p) || pace.status === 'early') { rows.push({ campaign: c.name, outlook: 'Too early to tell' }); return; }
      var actual = MC.util.sum(s), lastDay = T().dayOf(c.endTick - 1), daysLeft = Math.max(0, lastDay - today + 1);
      var projected = g.projected, prob = g.p;
      var gf = goalFmt(c.goal.type), noun = GOAL_NOUN[c.goal.type] || 'goal';
      rows.push({ campaign: c.name, pacing: pace.status === 'ahead' ? 'Ahead of pace' : (pace.status === 'on' ? 'On pace' : 'Behind pace'), projected: gf(projected), goal: gf(c.goal.target), chance: pct(prob, 0) });
      if (pace.status !== 'behind' || !(prob < p.goalRiskThreshold) || daysLeft <= 0) return;
      var sev = prob < 0.2 ? 'crit' : 'warn';
      if (recentGoalWarning(world, c.id, t, sev)) {
        rows.push({ campaign: c.name, outlook: 'Already flagged in the last 3 days' });
      } else insights.push({
        kind: 'goal-risk',
        title: c.name + ' is on pace for ' + pct(projected / c.goal.target, 0) + ' of its ' + noun + ' goal',
        body: 'About ' + gf(projected) + ' of ' + gf(c.goal.target) + ' by ' + dayLabel(lastDay) + ', ' + chance(prob) + ' of hitting it.',
        entity: { kind: 'campaign', id: c.id }, severity: sev, key: 'goal|' + c.id + '|' + today
      });
      // Extension: only with at least 48 hours left, and only when the recent pace can close part of the gap.
      if (c.endTick - t < 48) return;
      var recent = s.slice(-7), meanDaily = MC.util.mean(recent), gap = c.goal.target - projected;
      if (!(meanDaily > 0) || !(gap > 0)) return;
      var days = Math.max(1, Math.min(p.maxExtendDays, Math.ceil(gap / meanDaily)));
      var projected2 = projected + meanDaily * days, share2 = projected2 / c.goal.target;
      if (share2 < 0.9) {
        rows.push({ campaign: c.name, outlook: 'Even ' + days + ' more days would reach only about ' + pct(share2, 0) + ' of the goal, so no extension suggested' });
        return;
      }
      var revRecent = MC.util.mean(c.series.revenue.slice(-7)), revSd = c.series.revenue.length > 2 ? MC.util.sd(c.series.revenue.slice(-7)) : revRecent * 0.5;
      var delta = revRecent * days, se = 1.28 * revSd * Math.sqrt(days), newEnd = c.endTick + days * 24;
      proposals.push({
        kind: 'extend-campaign', risk: 'medium', mustQueue: true, horizon: days * 24,
        target: { kind: 'campaign', id: c.id },
        title: 'Extend ' + c.name + ' by ' + days + (days === 1 ? ' day' : ' days'),
        rationale: 'It is on pace for ' + pct(projected / c.goal.target, 0) + ' of its ' + noun + ' goal (' + gf(projected) + ' of ' + gf(c.goal.target) +
          '). At the recent pace of ' + gf(meanDaily) + ' a day, ' + days + ' more ' + (days === 1 ? 'day' : 'days') +
          ' lifts that to about ' + pct(share2, 0) + '. The budget stays the same and is spread over the longer run.',
        evidence: [
          { label: 'Projected', value: gf(projected) + ' of ' + gf(c.goal.target) },
          { label: 'Share of goal', value: pct(projected / c.goal.target, 0) + ' \u2192 ' + pct(share2, 0) },
          { label: 'Recent pace', value: gf(meanDaily) + ' a day' }
        ],
        impact: { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(Math.max(0, delta - se)), hi: Math.round(delta + se),
          horizonDays: days, confidence: r4(Math.max(0.3, Math.min(0.9, share2))) },
        actions: [{ type: 'campaign/setEnd', payload: { id: c.id, endTick: newEnd } }],
        diff: [{ label: 'Last day', before: dayLabel(lastDay), after: dayLabel(T().dayOf(newEnd - 1)) },
          { label: 'Share of goal', before: pct(projected / c.goal.target, 0), after: pct(share2, 0) }]
      });
    });
    if (rows.length) trace.push({ step: 'decide', text: 'Checked each live campaign\u2019s outlook against its goal.', rows: rows });

    // 3. Weekly return by segment, on Mondays.
    if (obs.dow === 1) {
      var roi = 0;
      obs.campaigns.forEach(function (c) {
        var cc = world.campaigns.byId[c.id];
        var ins = cc ? roiInsight(world, cc, today) : null;
        if (ins) { insights.push(ins); roi++; }
      });
      trace.push({ step: 'decide', text: roi ? 'Ranked segments by their return on ' + roi + (roi === 1 ? ' campaign.' : ' campaigns.') : 'No segment stood out on return this week.' });
    }
    if (!insights.length && !proposals.length) trace.push({ step: 'decide', text: 'Nothing unusual and every goal looks reachable.' });
    return { proposals: proposals, insights: insights, trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Insight Analyst', short: 'Watches the numbers, flags surprises, and warns when a goal is at risk.', icon: 'trend', order: 5,
    cadence: { 'default': 6, min: 1, max: 24, phase: 4 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      z: { label: 'Surprise threshold', type: 'float', 'default': 3, min: 2, max: 5, step: 0.5, help: 'How far outside the usual day-to-day swing a day must be before it is flagged.' },
      lambda: { label: 'Memory', type: 'float', 'default': 0.2, min: 0.05, max: 0.5, step: 0.05, help: 'How quickly the expected value follows recent days. Higher reacts faster.' },
      goalRiskThreshold: { label: 'Goal risk below', type: 'pct', 'default': 0.5, min: 0.2, max: 0.8, step: 0.05, help: 'Warn when the chance of hitting a goal drops below this.' },
      maxExtendDays: { label: 'Longest extension', type: 'int', 'default': 7, min: 1, max: 14, step: 1, help: 'The most days an extension may add.' }
    },
    emits: ['campaign/setEnd'],
    guardrails: ['protectDrafts', 'targetFresh', 'budgetCap'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 0 },
    horizon: 0,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'extend-campaign' ? 'medium' : 'low'; }
  });
})();
