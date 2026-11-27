/* Marketing Cloud - Variant Optimizer agent. Shifts traffic toward the variants that are
   winning on each live campaign's email, SMS and push channels (Thompson sampling with a prior
   from the content score), and pauses clear losers once they have enough sends. It also works at the
   level of blocks: it proposes testing a promising headline block in every channel of a campaign at
   once (a new message published beside the live ones), and judges headline blocks from the content
   ledger (MC.select.contentPerformance), moving traffic off a headline that clearly loses. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'optimizer';
  var assign = Object.assign;
  var CLICK_GOALS = { engagement: 1, launch: 1 };
  var SMS_OPEN = 0.92;
  var MIN_IMPACT = 25;          // the variant-level proposals keep their old materiality floor; block-level ones carry their own evidence

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
    s = s.replace(/\s*\{first_name(\|[^}]*)?\}/g, '').replace(/\{product\}/g, prod && prod.name ? prod.name : 'our pick')
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

  /* ---------------- block-level work (docs/CONTENT.md) ---------------- */
  var C_METRIC = { email: 'open', push: 'open', sms: 'click', social: 'click', web: 'click' };
  var C_NOUN = { open: 'opens', click: 'clicks' };
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function plain(b) { return String(MC.content.textOf(b)).replace(/\s*\{first_name(\|[^}]*)?\}[,:]?\s*/g, ' ').replace(/\{[a-z_]+(\|[^}]*)?\}/g, '').replace(/\s+/g, ' ').trim(); }
  function quoteB(b) { return '“' + clip(plain(b), 44) + '”'; }
  function joinList(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function span(c) { return pct(c.lo, 0) + ' to ' + pct(c.hi, 0); }
  function headlineIdOf(world, v) {
    var K = MC.content, pins = v.blocks || [];
    for (var i = 0; i < pins.length; i++) { var b = K.block(world, pins[i].id); if (b && b.kind === 'headline') return b.id; }
    return null;
  }
  function cellOf(rows, key, ch) { for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].byChannel[ch] || null; return null; }
  function hits(cell, m) { return cell.rates[m].k; }

  // Judge a unit's headline blocks from the content ledger: a headline that clearly loses to the best one in use loses traffic.
  function judgeUnit(world, u, prm, lim, t, verdicts, rows) {
    var S = MC.select, K = MC.content;
    if (!S || !S.contentPerformance || !S.rateRatio || !K) return;
    var ch = u.ch, m = C_METRIC[ch] || 'click', vs = u.variants, perf = S.contentPerformance(world, { by: 'block', kind: 'headline', channel: ch });
    var arms = [];
    vs.forEach(function (v, j) {
      var hid = headlineIdOf(world, world.variants.byId[v.id]), cell = hid && cellOf(perf, hid, ch);
      if (cell && cell.delivered >= S.CONTENT_MIN.delivered && hits(cell, m) >= S.CONTENT_MIN.hits) arms.push({ j: j, v: v, hid: hid, cell: cell, rate: cell.rates[m].rate });
    });
    if (arms.length < 2) return;
    arms.sort(function (a, b) { return (b.rate - a.rate) || (a.hid < b.hid ? -1 : 1); });
    var best = arms[0], lose = null;
    for (var i = 1; i < arms.length; i++) {
      var a = arms[i];
      if (a.hid === best.hid || !(a.v.share > prm.minShare + 0.02)) continue;
      var d = S.rateRatio(hits(best.cell, m), best.cell.delivered, hits(a.cell, m), a.cell.delivered);
      if (d && d.lo > 0 && (!lose || d.lo > lose.d.lo)) lose = { a: a, d: d };
    }
    if (!lose) return;
    // the best headline's variant with the biggest share takes what the loser gives up
    var gets = best.v, moved = Math.min(lim, lose.a.v.share - prm.minShare);
    vs.forEach(function (v) { if (headlineIdOf(world, world.variants.byId[v.id]) === best.hid && v.share > gets.share) gets = v; });
    if (!(moved >= 0.05)) return;
    var next = {};
    vs.forEach(function (v) { next[v.id] = v.share; });
    next[lose.a.v.id] = Math.round((lose.a.v.share - moved) * 1e4) / 1e4;
    next[gets.id] = Math.round((gets.share + moved) * 1e4) / 1e4;
    var sum = 0, big = vs[0].id;
    vs.forEach(function (v) { sum += next[v.id]; if (next[v.id] > next[big]) big = v.id; });
    next[big] = Math.round((next[big] + (1 - sum)) * 1e4) / 1e4;
    // value of the move: observed per-send rate of the two variants (the same measure the variant-level read uses)
    var clicksGoal = !!CLICK_GOALS[u.goal], c = world.campaigns.byId[u.cid];
    var val = clicksGoal ? (u.valuePerClick || 2) : (u.aov || fallbackPrice(world, c)), rate = function (v) { var s = clicksGoal ? v.clicks : v.conv; return v.sends > 0 ? s / v.sends : 0; };
    var projSends = (u.recentSends / 3) * Math.min(3, Math.max(0, (u.endTick - t) / 24));
    var delta = moved * projSends * val * (rate(gets) - rate(lose.a.v)), se = 1.28 * moved * projSends * val * Math.sqrt(Math.max(rate(gets), 1e-4) / Math.max(1, gets.sends) + Math.max(rate(lose.a.v), 1e-4) / Math.max(1, lose.a.v.sends));
    if (!(delta > 0)) { rows.push({ campaign: u.name, channel: chName(ch), 'block read': 'Headline loses clearly, but the traffic move wouldn’t raise expected revenue yet', result: 'Held' }); return; }
    (verdicts[u.cid] = verdicts[u.cid] || { name: u.name, cid: u.cid, units: [] }).units.push({ ch: ch, m: m, best: best, lose: lose, moved: moved, next: next, vs: vs,
      impact: { delta: delta, lo: delta - se, hi: delta + se } });
  }

  function judgeProposals(world, verdicts, proposals, rows) {
    var K = MC.content;
    Object.keys(verdicts).sort().forEach(function (cid) {
      var V = verdicts[cid], actions = [], diff = [], evid = [], lines = [], dl = 0, lo = 0, hi = 0, chs = [];
      V.units.sort(function (a, b) { return a.ch < b.ch ? -1 : 1; }).forEach(function (x) {
        var bb = K.block(world, x.best.hid), lb = K.block(world, x.lose.a.hid), noun = C_NOUN[x.m];
        actions.push({ type: 'campaign/setAlloc', payload: { id: cid, channel: x.ch, alloc: x.next } });
        chs.push(chLower(x.ch));
        lines.push(quoteB(bb) + ' beats ' + quoteB(lb) + ' on ' + chLower(x.ch) + ' ' + noun + ' by ' + pct(x.lose.d.value, 0) + ' (' + span(x.lose.d) + ')');
        evid.push({ label: chName(x.ch) + ': ' + quoteB(bb), value: pct(x.best.cell.rates[x.m].rate, 1) + ' of ' + num(x.best.cell.delivered) + ' delivered' });
        evid.push({ label: chName(x.ch) + ': ' + quoteB(lb), value: pct(x.lose.a.cell.rates[x.m].rate, 1) + ' of ' + num(x.lose.a.cell.delivered) + ' delivered' });
        x.vs.forEach(function (v) { if (Math.abs(x.next[v.id] - v.share) > 1e-9) diff.push({ label: chName(x.ch) + ' variant ' + v.name + ' share', before: pct(v.share), after: pct(x.next[v.id]) }); });
        dl += x.impact.delta; lo += x.impact.lo; hi += x.impact.hi;
      });
      var first = V.units[0];
      proposals.push({
        kind: 'block-verdict', risk: 'low', horizon: 72,
        target: { kind: 'campaign', id: cid },
        title: 'Move traffic off a losing headline on ' + joinList(chs) + ' in ' + V.name,
        rationale: lines.join('; ') + '. The comparison is per delivery across every send of these headlines, with a 95% interval; ' +
          'the traffic on the losing headline moves to the one that wins, within the limit for one run.',
        evidence: evid,
        impact: { metric: 'revenue', unit: '$', delta: Math.round(dl), lo: Math.round(lo), hi: Math.round(hi), horizonDays: 3, confidence: 0.8 },
        actions: actions, diff: diff
      });
      rows.push({ campaign: V.name, channel: joinList(chs), 'block read': lines[0], result: 'Move traffic' });
    });
  }

  // Propose testing a promising headline block in every channel of a live campaign at once.
  function testProposals(world, obs, prm, t, proposals, rows) {
    var S = MC.select, K = MC.content, C = world.campaigns;
    if (!S || !S.contentPerformance || !K) return;
    var today = T().dayOf(t), seen = {};
    // campaigns the variant-level read already proposed something for this run wait their turn
    proposals.forEach(function (p) { if (p.target && p.target.kind === 'campaign') seen[p.target.id] = true; });
    var made = 0;
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid], row = null;
      if (!c || c.status !== 'live' || made >= 1) return;
      var owned = c.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0 && !(c.channelPaused && c.channelPaused[ch]); });
      if (owned.length < 2) return;
      row = { campaign: c.name, channel: joinList(owned.map(chLower)), 'block read': '', result: 'No test needed' };
      // the message carrying the most traffic, live on at least two channels
      var share = {}, live = [], recent = false;
      owned.forEach(function (ch) {
        var vs = MC.catalog.variantsOf(world, cid, ch), alloc = (c.alloc && c.alloc[ch]) || {};
        live.push(vs.filter(function (v) { return v.status === 'live'; }).length);
        vs.forEach(function (v) {
          if (v.author === 'agent:optimizer' && t - v.createdTick < 120) recent = true;
          if (v.messageId && v.status === 'live') { var o = share[v.messageId] || (share[v.messageId] = { id: v.messageId, w: 0, chs: {} }); o.w += +alloc[v.id] || 0; o.chs[ch] = true; }
        });
      });
      if (recent) { row.result = 'A test is already running'; rows.push(row); return; }
      if (live.some(function (n) { return n >= prm.maxVariants; })) { row.result = 'Already ' + prm.maxVariants + ' live variants'; rows.push(row); return; }
      if (c.endTick - t < 96) { row.result = 'Campaign ends too soon to test'; rows.push(row); return; }
      var base = null;
      Object.keys(share).sort().forEach(function (id) { var o = share[id]; if (Object.keys(o.chs).length >= 2 && (!base || o.w > base.w)) base = o; });
      if (!base) { row.result = 'No message runs on two channels'; rows.push(row); return; }
      var msg = K.message(world, base.id), chs = owned.filter(function (ch) { return base.chs[ch]; });
      var curId = msg.slots.headline, cur = K.block(world, curId);
      if (!cur || msg.review !== 'approved' && false) return;
      var blockRows = {}, angleRows = {};
      chs.forEach(function (ch) { blockRows[ch] = S.contentPerformance(world, { by: 'block', kind: 'headline', channel: ch }); angleRows[ch] = S.contentPerformance(world, { by: 'angle', channel: ch }); });
      // headlines already running in this campaign are not new tests
      var inUse = {};
      MC.catalog.variantsOf(world, cid).forEach(function (v) { if (v.status !== 'retired') { var h = headlineIdOf(world, v); if (h) inUse[h] = true; } });
      var cands = [];
      K.blocks(world).forEach(function (b) {
        if (b.kind !== 'headline' || b.review !== 'approved' || b.retired || b.archived || inUse[b.id]) return;
        if (b.tags && b.tags.product && !(msg.slots.product && K.block(world, msg.slots.product) && K.block(world, msg.slots.product).value.productId === b.tags.product)) return;
        var per = [], tot = 0;
        chs.forEach(function (ch) {
          var m = C_METRIC[ch] || 'click', a = cellOf(blockRows[ch], b.id, ch), z = cellOf(blockRows[ch], cur.id, ch), via = 'block';
          if (!(a && a.delivered >= S.CONTENT_MIN.delivered && hits(a, m) >= S.CONTENT_MIN.hits)) { a = cellOf(angleRows[ch], (b.tags && b.tags.angle) || 'neutral', ch); via = 'angle'; }
          if (!(z && z.delivered >= S.CONTENT_MIN.delivered && hits(z, m) >= S.CONTENT_MIN.hits)) z = cellOf(angleRows[ch], (cur.tags && cur.tags.angle) || 'neutral', ch);
          if (!a || !z || a.delivered < S.CONTENT_MIN.delivered || z.delivered < S.CONTENT_MIN.delivered || hits(a, m) < S.CONTENT_MIN.hits || hits(z, m) < S.CONTENT_MIN.hits) return;
          var d = S.rateRatio(hits(a, m), a.delivered, hits(z, m), z.delivered);
          if (d && d.value > 0.05) { per.push({ ch: ch, m: m, d: d, a: a, z: z, via: via }); tot += d.value; }
        });
        if (per.length) cands.push({ b: b, per: per, tot: tot });
      });
      cands.sort(function (a, b) { return (b.tot - a.tot) || (a.b.id < b.b.id ? -1 : 1); });
      var pick = null, name = null;
      for (var i = 0; i < cands.length && !pick; i++) {
        var cb = cands[i].b, slots = assign({}, msg.slots, { headline: cb.id }), co = {};
        Object.keys(msg.channelOverrides || {}).sort().forEach(function (ch) { var o = assign({}, msg.channelOverrides[ch]); delete o.headline; if (Object.keys(o).length) co[ch] = o; });
        var draft = { name: clip(c.name + ': ' + ((K.ANGLE_LABEL[cb.tags.angle] || 'new') + ' headline test'), 78), slots: slots, channelOverrides: co, tags: assign({}, msg.tags, { angle: cb.tags.angle || 'neutral' }) };
        var bad = renderBad(world, draft, chs, cid);
        if (!bad) { pick = cands[i]; name = draft; }
      }
      if (!pick) { row.result = 'No tested headline reads well in every channel'; rows.push(row); return; }
      // value: what the headline's relative lift is worth on the share of sends it will get
      var tot = 0, rev = 0, delta = 0, lo = 0, hi = 0, tshare = prm.testShare;
      var camp = campaignTotals(world, cid, today), evid = [], lines = [];
      pick.per.forEach(function (x) {
        var ca = camp.chAll[x.ch] || { sends: 0, revenue: 0 }, rps = ca.sends > 0 ? ca.revenue / ca.sends : 0, sendsH = ((camp.chRecent[x.ch] || 0) / 3) * Math.min(3, Math.max(0, (c.endTick - t) / 24));
        var f = tshare * sendsH * rps;
        delta += f * x.d.value; lo += f * Math.max(0, x.d.lo); hi += f * x.d.hi;
        lines.push(chLower(x.ch) + ' ' + C_NOUN[x.m] + ' by ' + pct(x.d.value, 0) + ' (' + span(x.d) + ')');
        evid.push({ label: chName(x.ch) + ' ' + C_NOUN[x.m], value: pct(x.a.rates[x.m].rate, 1) + ' vs ' + pct(x.z.rates[x.m].rate, 1) });
      });
      var cb2 = pick.b;
      evid.push({ label: 'Tested on', value: joinList(chs.map(chLower)) });
      row.result = 'Test ' + quoteB(cb2);
      row['block read'] = quoteB(cb2) + ' vs ' + quoteB(cur);
      rows.push(row);
      made++;
      var basis = pick.per[0].via === 'block' ? 'its own sends' : 'the sends of ' + (K.ANGLE_LABEL[cb2.tags.angle] || 'its angle').toLowerCase() + ' headlines';
      proposals.push({
        kind: 'block-test', risk: 'medium', mustQueue: true, horizon: 96,
        target: { kind: 'campaign', id: cid },
        title: 'Test ' + quoteB(cb2) + ' against ' + quoteB(cur) + ' on ' + joinList(chs.map(chLower)) + ' in ' + c.name,
        rationale: 'The library suggests ' + quoteB(cb2) + ' beats ' + quoteB(cur) + ': ' + lines.join('; ') + ', measured from ' + basis + '. ' +
          'That is a read across campaigns, so it needs a test here. This adds one message with the same body, button and offer as the leading one and the new headline, and publishes it to ' +
          joinList(chs.map(chLower)) + ' at once on ' + pct(tshare, 0) + ' of traffic once someone approves it. Nothing goes live before that.',
        evidence: evid,
        impact: { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(lo), hi: Math.round(hi), horizonDays: 3, confidence: 0.4 },
        actions: [
          { type: 'message/create', payload: { tmpId: '$m0', message: name } },
          { type: 'message/publish', payload: { id: '$m0', campaignId: cid, channels: chs, share: tshare } }
        ],
        diff: chs.map(function (ch) { return { label: chName(ch) + ' headline', before: clip(plain(K.block(world, K.slotBlockId(msg, 'headline', ch))), 60), after: clip(plain(cb2), 60) }; })
          .concat([{ label: 'New message share on each channel', before: '0%', after: pct(tshare, 0) }])
      });
    });
  }
  // Renders a message that does not exist yet in each channel; returns the first problem or null.
  function renderBad(world, draft, chs, cid) {
    var K = MC.content, S = K.slice(world), by = assign({}, S.messages.byId);
    by.$test = assign({ id: '$test', ver: 1, review: 'in_review' }, draft);
    var fw = assign({}, world, { content: assign({}, world.content, { messages: { byId: by, order: S.messages.order.concat(['$test']) } }) });
    for (var i = 0; i < chs.length; i++) {
      var r = K.render(fw, '$test', chs[i], { campaignId: cid });
      if (r.error) return r.error;
      var f = K.failing(r)[0];
      if (f) return f.label;
    }
    return null;
  }

  /* ---------------- decide ---------------- */
  function decide(obs, ctx) {
    var prm = ctx.params, rng = ctx.rng, t = ctx.tick, world = ctx.world;
    var proposals = [], trace = [], rows = [];
    var horizon = 72, horizonDays = horizon / 24;
    var lim = Math.min(prm.maxShift, (obs.maxShiftPct || 20) / 100);
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Looked at ' + obs.units.length + (obs.units.length === 1 ? ' live channel' : ' live channels') + ' with two or more live variants.'
      : 'No live email, SMS or push channel has two or more live variants to compare.' });

    function handleUnit(u) {
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
        var pauseDraft = {
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
      var shiftDraft = {
        kind: 'traffic-shift', risk: 'low', horizon: horizon,
        target: { kind: 'campaign', id: u.cid, channel: u.ch },
        title: 'Shift ' + pct(moved) + ' of ' + chLower(u.ch) + ' traffic to ' + quoteOf(vs[gi]) + ' on ' + u.name,
        rationale: why,
        evidence: evidence(),
        impact: impactOf(nextS),
        actions: [{ type: 'campaign/setAlloc', payload: { id: u.cid, channel: u.ch, alloc: alloc } }],
        diff: vs.map(function (v, j) { return { label: 'Variant ' + v.name + ' share', before: pct(v.share), after: pct(nw[j]) }; })
      };
      if (Math.abs(shiftDraft.impact.delta) < MIN_IMPACT) { row.result = 'Dropped: below the materiality threshold (' + MIN_IMPACT + ')'; return; }
      proposals.push(shiftDraft);
    }

    // The variant-level read first; where it proposes nothing, the block-level read gets a say.
    var verdicts = {};
    obs.units.forEach(function (u) {
      var n0 = proposals.length;
      handleUnit(u);
      if (proposals.length === n0) judgeUnit(world, u, prm, lim, t, verdicts, rows);
    });
    judgeProposals(world, verdicts, proposals, rows);
    testProposals(world, obs, prm, t, proposals, rows);

    if (rows.length) trace.push({ step: 'decide', text: 'Estimated each variant’s chance of being the best performer from its results so far and its predicted quality.', rows: rows });
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' change.' : ' changes.')
      : 'Current traffic splits are already close to the evidence; nothing to change.' });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Variant Optimizer', short: 'Shifts traffic toward what is winning, and tests promising headline blocks in every channel at once.', icon: 'split', order: 1,
    cadence: { 'default': 6, min: 1, max: 24, phase: 1 },
    autonomy: { 'default': 'autopilot', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'medium',
    params: {
      draws: { label: 'Estimate precision', type: 'int', 'default': 400, min: 100, max: 2000, step: 100, help: 'How many random draws estimate each variant’s chance of being best. More is steadier but slower.' },
      priorStrength: { label: 'Trust in predicted quality', type: 'int', 'default': 20, min: 0, max: 200, step: 5, help: 'How many sends’ worth of weight the content score gets before real results take over.' },
      minShare: { label: 'Minimum share', type: 'pct', 'default': 0.05, min: 0, max: 0.2, step: 0.01, help: 'Every live variant keeps at least this share of traffic so it can keep learning.' },
      maxShift: { label: 'Max shift per run', type: 'pct', 'default': 0.20, min: 0.05, max: 0.5, step: 0.05, help: 'The most traffic one run may move.' },
      pauseBelow: { label: 'Pause below', type: 'pct', 'default': 0.02, min: 0, max: 0.1, step: 0.01, help: 'Pause a variant whose chance of being best falls below this.' },
      testShare: { label: 'Test share', type: 'pct', 'default': 0.10, min: 0.05, max: 0.25, step: 0.01, help: 'The share of each channel a new headline test starts with.' },
      maxVariants: { label: 'Most live variants', type: 'int', 'default': 4, min: 2, max: 6, step: 1, help: 'Stop adding tests once a channel has this many live variants.' },
      minSample: { label: 'Sends before pausing', type: 'int', 'default': 500, min: 100, max: 5000, step: 100, help: 'A variant needs at least this many sends before it can be paused.' }
    },
    emits: ['campaign/setAlloc', 'variant/setStatus', 'message/create', 'message/publish'],
    guardrails: ['minSample', 'maxShift', 'keepOneLive', 'protectDrafts', 'targetFresh', 'holdout'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 0 },
    horizon: 72,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'pause-variant' || draft.kind === 'block-test' ? 'medium' : 'low'; }
  });
})();
