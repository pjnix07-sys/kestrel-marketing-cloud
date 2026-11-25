/* Kestrel Marketing Cloud - Fatigue Guard agent. Rests people who are being messaged too much on a
   channel, before they unsubscribe, and asks to pause a channel whose unsubscribe rate jumps well
   above its normal level. Only treatment members are rested; the control group keeps its plan. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'guard';

  function F() { return MC.F; }
  function T() { return MC.time; }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function chName(ch) { return MC.CH.LABEL[ch] || ch; }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : chName(ch).toLowerCase(); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function money(x) { return MC.fmt.money(x); }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), C = world.campaigns, P = world.profiles, f = F(), prm = ctx.params, out = [];
    var cap = (world.guardrails && world.guardrails.freqCap) || { email: 4, sms: 2, push: 5 };
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var E = world.enroll && world.enroll[cid];
      if (!E) return;
      var startDay = T().dayOf(c.startTick);
      c.channels.forEach(function (ch) {
        if (MC.CH.OWNED.indexOf(ch) < 0) return;
        var ci = MC.CH.IDX[ch], bit = MC.CH.BIT[ch], n = 0, already = 0, cands = [];
        for (var i = 0; i < P.n; i++) {
          if (E.step[i] === -1 || E.ctl[i]) continue;
          n++;
          if (P.supUntil[i * 3 + ci] > t) { already++; continue; }
          if (E.step[i] < 0) continue;                                   // already left the journey
          if (!(P.consent[i] & bit) || (P.unsub[i] & bit)) continue;
          var risk = MC.models.unsubRisk(world, i, ch);
          if (!(risk >= prm.unsubRiskThreshold)) continue;
          var s7 = 0, b = i * 21 + ci * 7;
          for (var k = 0; k < 7; k++) s7 += P.sent7[b + k];
          cands.push([i, r6(risk), s7]);
        }
        cands.sort(function (a, b2) { return (b2[1] - a[1]) || (a[0] - b2[0]); });
        // Daily treatment results on this channel (complete days only) for the unsubscribe trend and value per send.
        var series = [], sends = 0, rev = 0;
        world.metrics.days.forEach(function (e) {
          if (e.day >= today || e.day < startDay) return;
          var x = e.c && e.c[cid] && e.c[cid].trt && e.c[cid].trt[ch];
          if (!x) return;
          sends += x[f.SENT]; rev += x[f.REV];
          series.push({ day: e.day, deliv: x[f.DELIV], unsubs: x[f.UNSUB], sends: x[f.SENT] });
        });
        out.push({ cid: cid, name: c.name, ch: ch, paused: !!(c.channelPaused && c.channelPaused[ch]), cap: cap[ch] || 4,
          audience: n, already: already, cands: cands, revPerSend: sends > 0 ? r6(rev / sends) : 0, series: series });
      });
    });
    return { tick: t, units: out };
  }

  function decide(obs, ctx) {
    var prm = ctx.params, t = ctx.tick, proposals = [], trace = [], rows = [];
    var horizon = 72, until = t + Math.round(prm.cooldownDays * 24), restDays = prm.cooldownDays;
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Checked how often people are being messaged on ' + obs.units.length + (obs.units.length === 1 ? ' live channel.' : ' live channels.')
      : 'No campaign is live, so nobody is being messaged.' });

    // Group channel results per campaign: one rest proposal per campaign (one action per channel).
    var byC = {}, order = [];
    obs.units.forEach(function (u) { if (!byC[u.cid]) { byC[u.cid] = []; order.push(u.cid); } byC[u.cid].push(u); });

    order.forEach(function (cid) {
      var units = byC[cid], name = units[0].name, actions = [], diff = [], avoided = 0, forgone = 0, total = 0, evid = [];
      units.forEach(function (u) {
        var row = { campaign: u.name, channel: chName(u.ch), 'at risk': num(u.cands.length), 'already rested': num(u.already), result: 'Nobody to rest' };
        rows.push(row);
        if (u.paused || !u.cands.length || !(u.audience > 0)) return;
        var room = Math.floor(u.audience * prm.maxSuppressPct / 100) - u.already;
        if (room <= 0) { row.result = 'Rest limit reached'; return; }
        var pick = u.cands.slice(0, room), idx = pick.map(function (c) { return c[0]; }).sort(function (a, b) { return a - b; });
        var av = 0, sendsSkipped = 0;
        pick.forEach(function (c) {
          // Expected sends during the rest period at the person's recent weekly pace (at least one).
          var exp = Math.max(1, Math.min(c[2], u.cap) * restDays / 7);
          av += c[1] * exp; sendsSkipped += exp;
        });
        avoided += av; forgone += sendsSkipped * u.revPerSend; total += idx.length;
        row.result = 'Rest ' + num(idx.length) + (pick.length < u.cands.length ? ' (capped at ' + prm.maxSuppressPct + '% of the audience)' : '');
        actions.push({ type: 'profiles/suppress', payload: { channel: u.ch, idx: idx, untilTick: until, campaignId: cid } });
        diff.push({ label: chName(u.ch) + ': people resting', before: num(u.already), after: num(u.already + idx.length) });
        evid.push({ label: chName(u.ch) + ' at risk', value: num(u.cands.length) + ' of ' + num(u.audience) });
      });
      if (actions.length) {
        var chs = actions.map(function (a) { return chLower(a.payload.channel); });
        var chText = chs.length === 1 ? chs[0] : chs.slice(0, -1).join(', ') + ' and ' + chs[chs.length - 1];
        proposals.push({
          kind: 'fatigue-suppress', risk: 'low', horizon: horizon,
          target: { kind: 'campaign', id: cid },
          title: 'Rest ' + num(total) + (total === 1 ? ' person' : ' people') + ' from ' + chText + ' on ' + name + ' for ' + restDays + (restDays === 1 ? ' day' : ' days'),
          rationale: num(total) + (total === 1 ? ' person has' : ' people have') + ' had so many recent messages that each further ' + chText +
            ' send carries a ' + pct(prm.unsubRiskThreshold, 1) + ' or higher chance of an unsubscribe. Resting them for ' + restDays +
            (restDays === 1 ? ' day' : ' days') + ' avoids about ' + num(avoided) + (Math.round(avoided) === 1 ? ' unsubscribe' : ' unsubscribes') +
            ' and gives up about ' + money(forgone) + ' in revenue from the skipped messages.',
          evidence: evid.concat([{ label: 'Rest until', value: MC.fmt.stamp(until) }]),
          impact: { metric: 'unsubs avoided', unit: '#', delta: Math.round(avoided * 10) / 10, lo: Math.round(avoided * 6) / 10, hi: Math.round(avoided * 14) / 10,
            horizonDays: horizon / 24, tradeoff: { metric: 'revenue', unit: '$', delta: -Math.round(forgone) } },
          actions: actions,
          diff: diff
        });
      }

      // Unsubscribe spike on a channel: ask to pause it (always reviewed).
      units.forEach(function (u) {
        if (u.paused || u.series.length < 8) return;
        var rates = u.series.map(function (s) { return s.deliv > 0 ? s.unsubs / s.deliv : 0; });
        var ew = MC.models.ewma(rates, { lambda: 0.2, z: prm.unsubZ, minN: 7 }), last = ew[ew.length - 1];
        if (!last || last.i !== rates.length - 1 || !(last.z >= prm.unsubZ)) return;
        var s = u.series[u.series.length - 1];
        var excessPerDay = Math.max(0, (last.value - last.expected) * s.deliv);
        var av2 = excessPerDay * 3;
        var dayLabel = MC.fmt.dayLabel(s.day);
        proposals.push({
          kind: 'pause-channel', risk: 'high', mustQueue: true, horizon: horizon,
          target: { kind: 'campaign', id: u.cid, channel: u.ch },
          title: 'Pause ' + chLower(u.ch) + ' on ' + u.name,
          rationale: chName(u.ch) + ' unsubscribes on ' + u.name + ' jumped to ' + pct(last.value, 2) + ' of deliveries on ' + dayLabel +
            ', far above the usual ' + pct(Math.max(0, last.expected), 2) + ' (' + num(s.unsubs) + ' people). Pausing stops treatment sends on ' +
            chLower(u.ch) + ' until you resume it; the control group is unaffected.',
          evidence: [
            { label: 'Unsubscribes ' + dayLabel, value: num(s.unsubs) + ' of ' + num(s.deliv) + ' delivered' },
            { label: 'Usual rate', value: pct(Math.max(0, last.expected), 2) }
          ],
          impact: { metric: 'unsubs avoided', unit: '#', delta: Math.round(av2 * 10) / 10, lo: Math.round(av2 * 5) / 10, hi: Math.round(av2 * 15) / 10,
            horizonDays: 3, tradeoff: { metric: 'revenue', unit: '$', delta: -Math.round(s.sends * u.revPerSend * 3) } },
          actions: [{ type: 'campaign/setChannelPaused', payload: { id: u.cid, channel: u.ch, paused: true } }],
          diff: [{ label: chName(u.ch), before: 'Sending', after: 'Paused' }]
        });
      });
    });

    if (rows.length) trace.push({ step: 'decide', text: 'Scored each person’s chance of unsubscribing from how many messages they got recently and how engaged they are.', rows: rows });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' change' : ' changes') + ' to protect the list.'
      : 'Nobody is at high risk of unsubscribing right now; nothing to change.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Fatigue Guard', short: 'Rests people who are being messaged too much, before they unsubscribe.', icon: 'shield', order: 4,
    cadence: { 'default': 12, min: 3, max: 48, phase: 5 },
    autonomy: { 'default': 'autopilot', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      unsubRiskThreshold: { label: 'Risk threshold', type: 'pct', 'default': 0.008, min: 0.002, max: 0.05, step: 0.001, help: 'Rest a person when the chance that their next message makes them unsubscribe reaches this level.' },
      cooldownDays: { label: 'Rest period (days)', type: 'int', 'default': 3, min: 1, max: 14, step: 1, help: 'How long rested people get no messages on that channel.' },
      maxSuppressPct: { label: 'Max share rested', type: 'int', 'default': 15, min: 1, max: 30, step: 1, help: 'Never rest more than this percent of a campaign’s audience at once.' },
      unsubZ: { label: 'Spike sensitivity', type: 'float', 'default': 3, min: 2, max: 5, step: 0.5, help: 'How far above normal (in standard deviations) the unsubscribe rate must jump before suggesting a pause.' }
    },
    emits: ['profiles/suppress', 'campaign/setChannelPaused'],
    guardrails: ['consent', 'maxSuppress', 'holdout', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'unsubs avoided', min: 2 },
    horizon: 72,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'pause-channel' ? 'high' : 'low'; }
  });
})();
