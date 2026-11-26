/* Marketing Cloud - Send-Time Tuner agent. Moves each live campaign's email, SMS and push
   sends to the hours people actually open, or to each person's own best hour when the audience's
   habits are spread out and well known. Opens by hour are blended with a prior built from the
   audience's best-hour histogram. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'sendtime';
  var WINDOW = 3;            // a fixed send hour opens a 3-hour send window (sim §10.7)
  var ADAPT_GAIN = 1.2;      // expected open-rate multiple at a person's own best hour (vs the average hour)

  function F() { return MC.F; }
  function T() { return MC.time; }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function hr(h) { return MC.fmt.hour(h); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smooth(a) {   // circular [1/4, 1/2, 1/4] kernel
    var n = a.length, o = new Array(n);
    for (var h = 0; h < n; h++) o[h] = 0.25 * a[(h + n - 1) % n] + 0.5 * a[h] + 0.25 * a[(h + 1) % n];
    return o;
  }
  function windowMean(rate, s) { var x = 0; for (var j = 0; j < WINDOW; j++) x += rate[(s + j) % 24]; return x / WINDOW; }

  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), C = world.campaigns, P = world.profiles, f = F();
    var H = (world.metrics && world.metrics.hours) || {}, out = [];
    var quiet = (world.guardrails && world.guardrails.quiet) || { start: 21, end: 8, channels: ['sms', 'push'] };
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var E = world.enroll && world.enroll[cid];
      if (!E) return;
      c.channels.forEach(function (ch) {
        if (MC.CH.OWNED.indexOf(ch) < 0 || (c.channelPaused && c.channelPaused[ch])) return;
        var arr = H[cid] && H[cid][ch];
        if (!arr) return;
        var bit = MC.CH.BIT[ch], hist = new Array(24), n = 0, known = 0;
        for (var h = 0; h < 24; h++) hist[h] = 0;
        for (var i = 0; i < P.n; i++) {
          if (E.step[i] === -1 || E.ctl[i]) continue;
          if (!(P.consent[i] & bit) || (P.unsub[i] & bit)) continue;
          n++;
          hist[P.bestHr[i] % 24]++;
          var o = 0, b = i * 24;
          for (var k = 0; k < 24; k++) o += P.openHr[b + k];
          if (o >= 3) known++;
        }
        // Lifetime revenue per open on this channel (values an extra open).
        var opens = 0, rev = 0, sendsRecent = 0;
        world.metrics.days.forEach(function (e) {
          var x = e.c && e.c[cid] && e.c[cid].ch && e.c[cid].ch[ch];
          if (!x) return;
          opens += x[f.OPEN]; rev += x[f.REV];
          if (e.day < today && e.day >= today - 3) sendsRecent += x[f.SENT];
        });
        var sends = [], opensH = [];
        for (var q = 0; q < 24; q++) { sends.push(r6(arr[q])); opensH.push(r6(arr[24 + q])); }
        out.push({ cid: cid, name: c.name, ch: ch, sendHour: c.sendHour ? c.sendHour[ch] : null, endTick: c.endTick,
          audience: n, known: known, bestHr: hist, sends: sends, opens: opensH,
          revPerOpen: opens > 0 ? r6(rev / opens) : 0, sendsPerDay: r6(sendsRecent / 3),
          quiet: (quiet.channels || []).indexOf(ch) >= 0 });
      });
    });
    return { tick: t, quiet: { start: quiet.start, end: quiet.end }, units: out };
  }

  function decide(obs, ctx) {
    var prm = ctx.params, t = ctx.tick, proposals = [], trace = [], rows = [];
    var horizon = 96, horizonDays = horizon / 24;
    var qs = obs.quiet;
    function inQuiet(h) { return T().inQuiet(h, qs); }
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Compared open rates by hour on ' + obs.units.length + (obs.units.length === 1 ? ' live channel' : ' live channels') + ' with what each audience’s habits suggest.'
      : 'No live email, SMS or push channel has sent anything yet.' });

    obs.units.forEach(function (u) {
      var row = { campaign: u.name, channel: MC.CH.LABEL[u.ch] || u.ch, now: '', best: '', result: '' };
      rows.push(row);
      if (u.sendHour === 'adaptive') { row.now = 'Each person’s best hour'; row.result = 'Already personalized'; return; }
      var cur = typeof u.sendHour === 'number' ? u.sendHour : 10;
      row.now = hr(cur);
      var S = 0, O = 0;
      for (var h = 0; h < 24; h++) { S += u.sends[h]; O += u.opens[h]; }
      if (!(S > 0) || !(u.audience > 0)) { row.result = 'Not enough sends yet'; return; }
      var rbar = O / S, m = prm.smoothing;
      var w = smooth(u.bestHr.map(function (x) { return x / u.audience; }));
      var rate = [];
      for (h = 0; h < 24; h++) {
        var prior = rbar * clamp(0.6 + 9.6 * w[h], 0.6, 1.6);
        rate.push((u.opens[h] + m * prior) / (u.sends[h] + m));
      }
      rate = smooth(rate);
      var curRate = windowMean(rate, cur), best = cur, bestRate = curRate;
      for (h = 0; h < 24; h++) {
        if (u.quiet && (inQuiet(h) || inQuiet((h + 1) % 24) || inQuiet((h + 2) % 24))) continue;
        var wr = windowMean(rate, h);
        if (wr > bestRate + 1e-12) { bestRate = wr; best = h; }
      }
      row.best = hr(best);
      var projSends = u.sendsPerDay * Math.min(horizonDays, Math.max(0, (u.endTick - t) / 24));
      var top = 0;
      u.bestHr.forEach(function (x) { if (x > top) top = x; });
      var topShare = top / u.audience, knownShare = u.known / u.audience;
      var evidence = [
        { label: 'Opens counted', value: num(O) },
        { label: 'Open rate now', value: pct(curRate, 1) + ' at ' + hr(cur) },
        { label: 'People with a clear best hour', value: pct(knownShare) }
      ];

      // Adaptive: habits are spread out (no dominant hour) and well known for most of the audience.
      if (prm.allowAdaptive && topShare < 0.2 && knownShare >= 0.6) {
        var adaptRate = knownShare * rbar * ADAPT_GAIN + (1 - knownShare) * curRate;
        var liftA = curRate > 0 ? adaptRate / curRate - 1 : 0;
        if (liftA >= prm.minLift && O >= prm.minOpens) {
          var dA = (adaptRate - curRate) * projSends * u.revPerOpen;
          row.result = 'Send at each person’s best hour';
          proposals.push({
            kind: 'adaptive-send', risk: 'low', horizon: horizon,
            target: { kind: 'campaign', id: u.cid, channel: u.ch },
            title: 'Send ' + chLower(u.ch) + ' at each person’s best hour on ' + u.name,
            rationale: 'No single hour suits this audience: the most common best hour covers only ' + pct(topShare) + ' of people, and ' +
              pct(knownShare) + ' have opened often enough for us to know their own best hour. Expected open rate rises about ' + pct(liftA) + ' from ' + pct(curRate, 1) + '.',
            evidence: evidence,
            impact: { metric: 'revenue', unit: '$', delta: Math.round(dA), lo: Math.round(dA * 0.4), hi: Math.round(dA * 1.6), horizonDays: horizonDays, confidence: Math.round(knownShare * 100) / 100 },
            actions: [{ type: 'campaign/setSendHour', payload: { id: u.cid, channel: u.ch, hour: 'adaptive' } }],
            diff: [{ label: (MC.CH.LABEL[u.ch] || u.ch) + ' send time', before: hr(cur), after: 'Each person’s best hour' }]
          });
          return;
        }
      }

      var lift = curRate > 0 ? bestRate / curRate - 1 : 0;
      if (best === cur || lift < prm.minLift) { row.result = 'Current time is close to the best'; return; }
      if (O < prm.minOpens) { row.result = 'Waiting for more opens (' + num(O) + ' of ' + num(prm.minOpens) + ')'; return; }
      var d = (bestRate - curRate) * projSends * u.revPerOpen;
      // Uncertainty: the best hour leans on the habit prior when it has few sends of its own.
      var nb = 0;
      for (var j = 0; j < WINDOW; j++) nb += u.sends[(best + j) % 24];
      var conf = clamp(0.5 + 0.5 * nb / (nb + m), 0.5, 0.95);
      row.result = 'Move to ' + hr(best);
      proposals.push({
        kind: 'send-time', risk: 'low', horizon: horizon,
        target: { kind: 'campaign', id: u.cid, channel: u.ch },
        title: 'Move ' + chLower(u.ch) + ' sends on ' + u.name + ' from ' + hr(cur) + ' to ' + hr(best),
        rationale: 'People in this audience open more around ' + hr(best) + ': an expected ' + pct(bestRate, 1) + ' open rate vs ' + pct(curRate, 1) +
          ' at ' + hr(cur) + ' (' + pct(lift) + ' higher), based on ' + num(O) + ' recent opens and when each person usually opens.',
        evidence: evidence.concat([{ label: 'Expected open rate at ' + hr(best), value: pct(bestRate, 1) }]),
        impact: { metric: 'revenue', unit: '$', delta: Math.round(d), lo: Math.round(d * (1 - conf)), hi: Math.round(d * (1 + conf)), horizonDays: horizonDays, confidence: Math.round(conf * 100) / 100 },
        actions: [{ type: 'campaign/setSendHour', payload: { id: u.cid, channel: u.ch, hour: best } }],
        diff: [{ label: (MC.CH.LABEL[u.ch] || u.ch) + ' send time', before: hr(cur), after: hr(best) }]
      });
    });

    if (rows.length) trace.push({ step: 'decide', text: 'Estimated the open rate for each send time, favoring real opens where we have them.', rows: rows });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' send-time change.' : ' send-time changes.')
      : 'Send times already match when people open; nothing to change.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Send-Time Tuner', short: 'Moves sends to the hours people actually open.', icon: 'clock', order: 2,
    cadence: { 'default': 24, min: 6, max: 72, phase: 2 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      minLift: { label: 'Minimum lift', type: 'pct', 'default': 0.05, min: 0.01, max: 0.3, step: 0.01, help: 'Only move a send time when the new hour is expected to open at least this much better.' },
      minOpens: { label: 'Opens needed', type: 'int', 'default': 150, min: 50, max: 2000, step: 50, help: 'How many recent opens a channel needs before its send time is changed.' },
      smoothing: { label: 'Weight of habits', type: 'int', 'default': 50, min: 0, max: 500, step: 10, help: 'How many sends’ worth of weight people’s usual open hours get before real results at that hour take over.' },
      allowAdaptive: { label: 'Allow per-person send times', type: 'bool', 'default': true, help: 'Let the agent send at each person’s own best hour when habits are spread out.' }
    },
    emits: ['campaign/setSendHour'],
    guardrails: ['quietHours', 'protectDrafts', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 15 },
    horizon: 96,
    observe: observe,
    decide: decide,
    risk: function () { return 'low'; }
  });
})();
