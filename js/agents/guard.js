/* Marketing Cloud - Fatigue Guard agent. Rests people who are being messaged too much on a
   channel, before they unsubscribe, and asks to pause a channel whose unsubscribe rate jumps well
   above its normal level. Only treatment members are rested; the control group keeps its plan. It also watches how
   people respond to content they have seen before and proposes retiring a worn-out block everywhere it runs. */
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
  function moneyS(x) { return Math.abs(x) >= 10000 ? MC.fmt.money(x, { compact: true }) : MC.fmt.money(x); }
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

  /* ---------------- tired content ---------------- */
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : s; }
  function plain(b) {
    var K = MC.content, s = '';
    if (b.kind === 'image') { var im = MC.copy && MC.copy.imageById(b.value && b.value.imageId); s = (im && im.alt) || K.textOf(b); }
    else s = K.textOf(b);
    return String(s).replace(/\s*\{first_name(\|[^}]*)?\}[,:]?\s*/g, ' ').replace(/\{[a-z_]+(\|[^}]*)?\}/g, '').replace(/\s+/g, ' ').trim();
  }
  function quoteBlock(b) { return '“' + clip(plain(b), 48) + '”'; }
  function tiredBlocks(world, proposals, trace) {
    var S = MC.select, K = MC.content;
    if (!S || !S.contentRecommendations || !K) return [];
    var recs = S.contentRecommendations(world).filter(function (r) { return r.kind === 'retire-block'; }), rows = [], cands = [];
    var perf = S.contentPerformance(world, { by: 'block', days: 3 });
    recs.forEach(function (r) {
      var b = K.block(world, r.blockIds[0]), row = { block: quoteBlock(b), 'used in': r.placements + (r.placements === 1 ? ' message' : ' messages'), result: '' };
      rows.push(row);
      if (!r.replacementId) { row.result = 'No approved ' + K.KIND_LABEL[b.kind].toLowerCase() + ' of the same angle to swap in; Copy Drafter writes one'; return; }
      var rep = K.block(world, r.replacementId), f = r.fatigue;
      var recent = perf.filter(function (x) { return x.key === b.id; })[0], perDay = recent ? recent.delivered / 3 : 0;
      var fx = S.blockFatigue(world, b.id), tot = 0, rep2 = 0;
      fx.curve.forEach(function (c, i) { tot += c.delivered; if (i >= f.laterFrom) rep2 += c.delivered; });
      var share = tot > 0 ? rep2 / tot : 0, gap = f.first.rate - f.later.rate;
      var delta = perDay * 3 * share * gap, noun = f.metric === 'open' ? 'opens' : 'clicks';
      var lo = f.drop.value !== 0 ? delta * f.drop.hi / f.drop.value : delta, hi = f.drop.value !== 0 ? delta * f.drop.lo / f.drop.value : delta;
      var swaps = K.swapActions(world, b.id, rep.id);
      if (!swaps.length) { row.result = 'Not used in a message'; return; }
      if (!(delta > 0)) { row.result = 'Not sent lately, so nothing to gain yet'; return; }
      var diff = [];
      K.messagesUsing(world, b.id).forEach(function (m) {
        K.placements(m, b.id).forEach(function (pl) {
          diff.push({ label: m.name + ' (' + pl.slot + (pl.channel ? ', ' + chLower(pl.channel) + ' version' : '') + ')', before: clip(plain(b), 60), after: clip(plain(rep), 60) });
        });
      });
      var perChan = r.channels.map(chLower), where = perChan.length ? ' on ' + (perChan.length === 1 ? perChan[0] : perChan.slice(0, -1).join(', ') + ' and ' + perChan[perChan.length - 1]) : '';
      var kindWord = K.KIND_LABEL[b.kind].toLowerCase();
      cands.push({ delta: delta, row: row, rep: rep, draft: {
        kind: 'retire-block', risk: 'medium', mustQueue: true, horizon: 72,
        target: { kind: 'block', id: b.id },
        title: 'Retire ' + quoteBlock(b) + ' everywhere it runs (' + r.placements + (r.placements === 1 ? ' message' : ' messages') + ')',
        rationale: 'People who see this ' + kindWord + ' again respond less: ' + noun + ' fall ' + pct(-f.drop.value, 0) + ' (' + pct(-f.drop.hi, 0) + ' to ' + pct(-f.drop.lo, 0) + ') ' +
          'against the first time, across ' + num(f.first.n + f.later.n) + ' sends' + where + '. Retiring it stops new use and swaps ' + quoteBlock(rep) + ' into every message that carries it. ' +
          'Messages already live keep their current words until the new version is published, and the edited messages go back to review.',
        evidence: [
          { label: 'First time seen', value: pct(f.first.rate, 1) + ' of ' + num(f.first.n) + (f.metric === 'open' ? ' opened' : ' clicked') },
          { label: 'Seen again', value: pct(f.later.rate, 1) + ' of ' + num(f.later.n) },
          { label: 'People who saw it more than once', value: fx.exposures ? pct(fx.exposures.repeatShare, 0) + ' of ' + num(fx.exposures.people) : 'n/a' },
          { label: 'Replacement', value: quoteBlock(rep) }
        ],
        impact: { metric: noun + ' regained', unit: '#', delta: Math.round(delta * 10) / 10, lo: Math.round(Math.min(lo, hi) * 10) / 10, hi: Math.round(Math.max(lo, hi) * 10) / 10, horizonDays: 3, confidence: 0.6 },
        actions: [{ type: 'block/retire', payload: { id: b.id, reason: 'Worn out: ' + noun + ' fall ' + pct(-f.drop.value, 0) + ' when the same people see it again' } }].concat(swaps),
        diff: diff
      } });
    });
    cands.sort(function (a, b) { return (b.delta - a.delta) || (a.draft.target.id < b.draft.target.id ? -1 : 1); });
    cands.forEach(function (c, i) {
      if (i >= 2) { c.row.result = 'Later: two retirements per run'; return; }
      c.row.result = 'Retire and swap in ' + quoteBlock(c.rep);
      proposals.push(c.draft);
    });
    if (rows.length) trace.push({ step: 'decide', text: 'Checked ' + rows.length + (rows.length === 1 ? ' block' : ' blocks') + ' for wear: how much worse people respond the second time they see the same words.', rows: rows });
    return rows;
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
          title: 'Pause ' + chText + ' to ' + num(total) + ' over-messaged ' + (total === 1 ? 'person' : 'people') + ' on ' + name + ' for ' + restDays + (restDays === 1 ? ' day' : ' days'),
          rationale: num(total) + (total === 1 ? ' person has' : ' people have') + ' had so many recent messages that each further ' + chText +
            ' send carries a ' + pct(prm.unsubRiskThreshold, 1) + ' or higher chance of an unsubscribe. Resting them for ' + restDays +
            (restDays === 1 ? ' day' : ' days') + ' avoids about ' + num(avoided) + (Math.round(avoided) === 1 ? ' unsubscribe' : ' unsubscribes') +
            ' and gives up about ' + moneyS(forgone) + ' in revenue from the skipped messages.',
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

    // Worn-out content: a block the same people keep seeing is retired everywhere it runs, in one proposal.
    var tiredRows = tiredBlocks(ctx.world, proposals, trace);
    if (rows.length) trace.push({ step: 'decide', text: 'Scored each person’s chance of unsubscribing from how many messages they got recently and how engaged they are.', rows: rows });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' change' : ' changes') + ' to protect the list.'
      : 'Nobody is at high risk of unsubscribing right now; nothing to change.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Fatigue Guard', short: 'Rests people who are being messaged too much, and retires words people have seen too often.', icon: 'shield', order: 4,
    cadence: { 'default': 12, min: 3, max: 48, phase: 5 },
    autonomy: { 'default': 'autopilot', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      unsubRiskThreshold: { label: 'Risk threshold', type: 'pct', 'default': 0.003, min: 0.002, max: 0.05, step: 0.001, help: 'Rest a person when the chance that their next message makes them unsubscribe reaches this level.' },
      cooldownDays: { label: 'Rest period (days)', type: 'int', 'default': 3, min: 1, max: 14, step: 1, help: 'How long rested people get no messages on that channel.' },
      maxSuppressPct: { label: 'Max share rested', type: 'int', 'default': 15, min: 1, max: 30, step: 1, help: 'Never rest more than this percent of a campaign’s audience at once.' },
      unsubZ: { label: 'Spike sensitivity', type: 'float', 'default': 3, min: 2, max: 5, step: 0.5, help: 'How far above normal (in standard deviations) the unsubscribe rate must jump before suggesting a pause.' }
    },
    emits: ['profiles/suppress', 'campaign/setChannelPaused', 'block/retire', 'message/setSlot', 'message/setOverride'],
    guardrails: ['consent', 'maxSuppress', 'holdout', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'unsubs avoided', min: 0.2 },
    horizon: 72,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'pause-channel' ? 'high' : (draft.kind === 'retire-block' ? 'medium' : 'low'); }
  });
})();
