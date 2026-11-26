/* Marketing Cloud - Budget Pacer agent. Keeps each live campaign's spend on plan (pacing
   notes) and moves budget toward the channel returning the most per extra dollar, using response
   curves fitted to recent daily spend and revenue. The campaign total never changes. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'pacer';

  function F() { return MC.F; }
  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function r4(x) { return Math.round(x * 1e4) / 1e4; }
  function chName(ch) { return MC.CH.LABEL[ch] || ch; }
  function money(x, cents) { return MC.fmt.money(x, cents ? { cents: true } : undefined); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function isPaid(ch) { return MC.CH.PAID.indexOf(ch) >= 0; }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), C = world.campaigns, f = F(), prm = ctx.params, out = [];
    var lookback = Math.max(1, prm.lookbackDays | 0);
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var startDay = T().dayOf(c.startTick), endDay = T().dayOf(c.endTick - 1);
      var daysTotal = Math.max(1, (c.endTick - c.startTick) / 24), daysLeft = endDay - today + 1;
      var chans = [];
      c.channels.forEach(function (ch) {
        var budget = (c.budget && c.budget.byChannel && c.budget.byChannel[ch]) || 0;
        var spent = 0, series = [];
        world.metrics.days.forEach(function (e) {
          if (e.day >= today) return;
          var x = e.c && e.c[cid] && e.c[cid].ch && e.c[cid].ch[ch];
          if (!x) return;
          spent += x[f.COST];
          if (e.day >= Math.max(startDay, today - lookback)) series.push({ day: e.day, spend: r4(x[f.COST]), revenue: r4(x[f.REV]) });
        });
        chans.push({ ch: ch, budget: budget, spent: r4(spent), paused: !!(c.channelPaused && c.channelPaused[ch]), series: series });
      });
      out.push({ cid: cid, name: c.name, total: (c.budget && c.budget.total) || 0, daysTotal: daysTotal, daysLeft: daysLeft,
        completeDays: Math.max(0, today - startDay), channels: chans });
    });
    return { tick: t, today: today, maxDailySpend: (world.guardrails && world.guardrails.maxDailySpend) || 2500, campaigns: out };
  }

  function decide(obs, ctx) {
    var prm = ctx.params, M = MC.models, proposals = [], insights = [], trace = [], rows = [];
    var horizon = 120, horizonDays = horizon / 24, today = obs.today;
    trace.push({ step: 'observe', text: obs.campaigns.length
      ? 'Checked spend against plan on ' + obs.campaigns.length + (obs.campaigns.length === 1 ? ' live campaign.' : ' live campaigns.')
      : 'No campaign is live, so there is no spend to pace.' });

    obs.campaigns.forEach(function (c) {
      /* ---- pacing (paid channels; owned channels spend per message and rarely use their full budget) ---- */
      c.channels.forEach(function (x) {
        if (!isPaid(x.ch) || !(x.budget > 0) || x.series.length < 3 || c.daysLeft < 1) return;
        var last3 = x.series.slice(-3), avg = last3.reduce(function (s, p) { return s + p.spend; }, 0) / 3;
        var planned = x.budget / c.daysTotal;
        if (!(planned > 0)) return;
        var pace = avg / planned;
        if (Math.abs(pace - 1) <= prm.paceTolerance) return;
        var under = pace < 1, left = Math.max(0, x.budget - x.spent);
        var body = chName(x.ch) + ' spent ' + money(avg) + ' a day over the last 3 days against a plan of ' + money(planned) + ' a day. ' +
          (x.paused ? 'The channel is paused, so ' + money(left) + ' of its budget is waiting.'
            : (under ? money(left) + ' is left for the remaining ' + c.daysLeft + (c.daysLeft === 1 ? ' day' : ' days') + '.'
              : 'At this rate the channel budget runs out early.'));
        insights.push({
          kind: 'pacing', key: 'pacing|' + c.cid + '|' + x.ch,
          title: chName(x.ch) + ' on ' + c.name + ' is ' + (under ? 'under' : 'over') + 'spending: ' + pct(Math.abs(pace - 1)) + (under ? ' below' : ' above') + ' plan',
          body: body, entity: { kind: 'campaign', id: c.cid },
          severity: Math.abs(pace - 1) > 2 * prm.paceTolerance ? 'warn' : 'info'
        });
      });

      /* ---- reallocation ---- */
      if (c.daysLeft < 2) return;
      var elig = [];
      c.channels.forEach(function (x) {
        if (x.paused || !(x.budget > 0)) return;
        var cur = Math.max(0, x.budget - x.spent) / Math.max(1, c.daysLeft);
        var pts = x.series.filter(function (p) { return p.spend > 0; });
        if (pts.length < 3) return;
        // An owned channel only gains from more budget when it is actually using all of it.
        if (!isPaid(x.ch)) {
          var l3 = pts.slice(-3), a3 = l3.reduce(function (s, p) { return s + p.spend; }, 0) / l3.length;
          if (!(a3 >= 0.9 * cur)) { rows.push({ campaign: c.name, channel: chName(x.ch), fit: '—', result: 'Not limited by budget' }); return; }
        }
        var curve = M.fitResponse(pts);
        if (!(curve.r2 >= prm.minFit) || curve.prior) {
          rows.push({ campaign: c.name, channel: chName(x.ch), fit: pct(Math.max(0, curve.r2)), result: 'Spend and revenue don’t follow a clear pattern yet' });
          return;
        }
        rows.push({ campaign: c.name, channel: chName(x.ch), fit: pct(curve.r2), result: money(M.marginal(curve, cur), true) + ' back per extra $1' });
        elig.push({ ch: x.ch, budget: x.budget, spent: x.spent, cur: cur, next: cur, curve: curve });
      });
      if (elig.length < 2) return;
      var D = elig.reduce(function (s, e) { return s + e.cur; }, 0);
      if (!(D > 0)) return;
      var step = D * prm.stepPct / 100, cap = D * prm.maxShiftPct / 100, moved = 0, guard = 0;
      while (moved + step <= cap + 1e-9 && guard++ < 100) {
        var hi = null, lo = null;
        elig.forEach(function (e) {
          e.m = M.marginal(e.curve, e.next);
          if (!hi || e.m > hi.m) hi = e;
          if (e.next >= step && (!lo || e.m < lo.m)) lo = e;
        });
        if (!hi || !lo || hi === lo || !(lo.m > 0) || hi.m / lo.m <= 1.10) break;
        hi.next += step; lo.next -= step; moved += step;
      }
      if (!(moved > 0)) return;

      // Moves are applied to channel totals: Δtotal = Δdaily × days left; the total is preserved.
      var deltas = elig.map(function (e) { return Math.round((e.next - e.cur) * c.daysLeft); });
      var resid = -deltas.reduce(function (s, d) { return s + d; }, 0);
      if (resid) { var bi = 0; deltas.forEach(function (d, i) { if (d > deltas[bi]) bi = i; }); deltas[bi] += resid; }
      var byChannel = {}, diff = [], gain = 0, v2 = 0, from = null, to = null, movedTotal = 0;
      elig.forEach(function (e, i) {
        byChannel[e.ch] = Math.max(0, Math.round(e.budget + deltas[i]));
        diff.push({ label: chName(e.ch) + ' budget', before: money(e.budget), after: money(byChannel[e.ch]) });
        var newDaily = Math.max(0, e.cur + deltas[i] / c.daysLeft);
        gain += M.response(e.curve, newDaily) - M.response(e.curve, e.cur);
        v2 += e.curve.sd * e.curve.sd;
        if (deltas[i] > 0) movedTotal += deltas[i];
        if (!from || deltas[i] < from.d) from = { e: e, d: deltas[i] };
        if (!to || deltas[i] > to.d) to = { e: e, d: deltas[i] };
      });
      if (!(movedTotal > 0) || !(from.d < 0) || !(to.d > 0)) return;
      var hd = Math.min(horizonDays, c.daysLeft), delta = gain * hd, se = 1.28 * Math.sqrt(v2) * Math.sqrt(hd);
      var mTo = M.marginal(to.e.curve, to.e.cur), mFrom = M.marginal(from.e.curve, from.e.cur);
      var share = c.total > 0 ? movedTotal / c.total : 0;
      proposals.push({
        kind: 'budget-shift', risk: share <= 0.10 ? 'low' : 'medium', horizon: horizon,
        target: { kind: 'campaign', id: c.cid },
        title: 'Move ' + money(movedTotal) + ' from ' + chName(from.e.ch) + ' to ' + chName(to.e.ch) + ' on ' + c.name,
        rationale: chName(to.e.ch) + (/ads$/.test(chName(to.e.ch)) ? ' return ' : ' returns ') + money(mTo, true) + ' per extra $1 vs ' + money(mFrom, true) + ' on ' + chName(from.e.ch).replace('Social ads', 'social').replace('Web ads', 'web') +
          ' at current spend. The campaign total stays ' + money(c.total) + '.',
        evidence: [
          { label: 'Days left', value: String(c.daysLeft) },
          { label: chName(to.e.ch) + ' return per extra $1', value: money(mTo, true) },
          { label: chName(from.e.ch) + ' return per extra $1', value: money(mFrom, true) },
          { label: 'Share of budget moved', value: pct(share, 1) }
        ],
        impact: { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(delta - se), hi: Math.round(delta + se), horizonDays: hd,
          confidence: Math.round(Math.min(to.e.curve.r2, from.e.curve.r2) * 100) / 100 },
        actions: [{ type: 'campaign/setBudget', payload: { id: c.cid, byChannel: byChannel } }],
        diff: diff
      });
    });

    if (rows.length) trace.push({ step: 'decide', text: 'Fitted how revenue responds to daily spend on each channel over the last ' + prm.lookbackDays + ' days.', rows: rows });
    trace.push({ step: 'decide', text: (proposals.length ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' budget move.' : ' budget moves.') : 'No budget move would clearly pay off.') +
      (insights.length ? ' Flagged ' + insights.length + (insights.length === 1 ? ' channel' : ' channels') + ' that are off pace.' : '') });
    return { proposals: proposals, insights: insights, trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Budget Pacer', short: 'Keeps spend on plan and moves budget to the channel returning the most.', icon: 'gauge', order: 3,
    cadence: { 'default': 24, min: 6, max: 72, phase: 3 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      stepPct: { label: 'Step size', type: 'int', 'default': 5, min: 1, max: 10, step: 1, help: 'Percent of the daily budget moved in each step between channels.' },
      maxShiftPct: { label: 'Max move per run', type: 'int', 'default': 20, min: 5, max: 50, step: 5, help: 'The most of the daily budget one run may move.' },
      lookbackDays: { label: 'Days of history', type: 'int', 'default': 21, min: 7, max: 60, step: 1, help: 'How many recent days of spend and revenue the curves are fitted on.' },
      minFit: { label: 'Minimum fit', type: 'float', 'default': 0.3, min: 0, max: 0.9, step: 0.05, help: 'How well a channel’s spend must explain its revenue before budget is moved.' },
      paceTolerance: { label: 'Pacing tolerance', type: 'pct', 'default': 0.15, min: 0.05, max: 0.5, step: 0.05, help: 'Flag a channel when its recent spend is this far from plan.' }
    },
    emits: ['campaign/setBudget'],
    guardrails: ['maxShift', 'budgetCap', 'protectDrafts', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 25 },
    horizon: 120,
    observe: observe,
    decide: decide,
    risk: function (draft, world) {
      var a = draft.actions && draft.actions[0], c = a && world.campaigns.byId[a.payload.id];
      if (!c || !c.budget || !(c.budget.total > 0)) return 'medium';
      var moved = 0;
      Object.keys(a.payload.byChannel).forEach(function (ch) { moved += Math.max(0, a.payload.byChannel[ch] - (c.budget.byChannel[ch] || 0)); });
      return moved / c.budget.total <= 0.10 ? 'low' : 'medium';
    }
  });
})();
