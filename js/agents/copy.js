/* Marketing Cloud - Copy Drafter agent. Writes content as blocks and composes messages from them (docs/CONTENT.md).
   It watches the leading email, SMS and push variant on each live campaign. When the leader's click rate tires, or a test
   has clearly settled, it writes a fresh headline and body in the angle the content ledger says is working, composes a
   challenger message from them and the campaign's approved offer, button and claims, checks it renders cleanly in every
   channel, and proposes publishing it on a small share of traffic. It also writes fresh blocks for the library when a
   winning angle is running out of headlines or a tired block has nothing to swap in. Everything it writes enters review:
   new words never go live on their own, and it never edits copy a person wrote. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};

  var ID = 'copy';
  var assign = Object.assign;
  var CLICK_GOALS = { engagement: 1, launch: 1 };
  var MIN_WINDOW_SENDS = 100;   // a 3-day window needs this many sends to count as a CTR reading
  var REST_AFTER_NEW = 72;      // hours a channel rests after an agent-written variant went live
  var DUP_DISTANCE = 0.2;
  var SETTLED = 0.9;

  function F() { return MC.F; }
  function T() { return MC.time; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 1 : dp); }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function hookKey(ch) { return (MC.copy && MC.copy.HOOK && MC.copy.HOOK[ch]) || 'subject'; }
  function hookOf(v) {
    var s = String(((v && v.fields) || {})[hookKey(v.channel)] || '').replace(/\s+/g, ' ').trim();
    if (s.length > 52) s = s.slice(0, 50).replace(/\s+\S*$/, '') + '\u2026';
    return s;
  }
  function quote(v) { var h = hookOf(v); return h ? '\u201c' + h + '\u201d' : 'variant ' + v.name; }

  /* ---------------- observe ---------------- */
  function observe(world, ctx) {
    var t = ctx.tick, today = T().dayOf(t), f = F(), C = world.campaigns, units = [];
    (C.order || []).forEach(function (cid) {
      var c = C.byId[cid];
      if (!c || c.status !== 'live') return;
      var owned = c.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0 && !(c.channelPaused && c.channelPaused[ch]); });
      if (!owned.length) return;
      var startDay = T().dayOf(c.startTick);
      owned.forEach(function (ch) {
        var all = MC.catalog.variantsOf(world, cid, ch);
        var live = all.filter(function (v) { return v.status === 'live'; });
        if (!live.length) return;
        var alloc = (c.alloc && c.alloc[ch]) || {};
        var lastAgentNew = null;
        all.forEach(function (v) { if (v.author === 'agent:copy' && (lastAgentNew === null || v.createdTick > lastAgentNew)) lastAgentNew = v.createdTick; });
        var chTot = { sends: 0, clicks: 0, conv: 0, revenue: 0 }, recent = 0;
        var vrows = live.map(function (v) {
          var o = { id: v.id, name: v.name, share: r6(+alloc[v.id] || 0), sends: 0, clicks: 0, conv: 0, revenue: 0, daily: [],
            score: v.predicted && isNum(v.predicted.score) ? v.predicted.score : 50,
            pOpen: v.predicted && isNum(v.predicted.open) ? r6(v.predicted.open) : 0.2,
            pClick: v.predicted && isNum(v.predicted.click) ? r6(v.predicted.click) : 0.05 };
          return o;
        });
        for (var d = Math.max(startDay, T().DAY0); d < today; d++) {
          var e = world.metrics.days[T().dayIndex(d)], cd = e && e.c && e.c[cid];
          if (!cd) { vrows.forEach(function (o) { o.daily.push([0, 0]); }); continue; }
          var x = cd.ch && cd.ch[ch];
          if (x) {
            chTot.sends += x[f.SENT]; chTot.clicks += x[f.CLICK]; chTot.conv += x[f.CONV]; chTot.revenue += x[f.REV];
            if (d >= today - 3) recent += x[f.SENT];
          }
          vrows.forEach(function (o) {
            var y = cd.v && cd.v[o.id];
            if (y) { o.sends += y[f.SENT]; o.clicks += y[f.CLICK]; o.conv += y[f.CONV]; o.revenue += y[f.REV]; }
            o.daily.push(y ? [y[f.SENT], y[f.CLICK]] : [0, 0]);
          });
        }
        units.push({ cid: cid, name: c.name, ch: ch, goal: (c.goal && c.goal.type) || 'revenue', tone: c.tone, offer: c.offer,
          productFocus: c.productFocus || null, liveCount: live.length, lastAgentNew: lastAgentNew, endTick: c.endTick,
          chTot: { sends: chTot.sends, clicks: chTot.clicks, conv: chTot.conv, revenue: Math.round(chTot.revenue * 100) / 100 },
          recentSends: recent, variants: vrows });
      });
    });
    return { tick: t, units: units, minSample: (world.guardrails && world.guardrails.minSample) || 500 };
  }

  /* ---------------- helpers ---------------- */
  function ctrWindows(daily) {
    // 3-day rolling CTR (clicks per send) for windows with enough sends; returns {last, peak}.
    var last = null, peak = null;
    for (var i = 2; i < daily.length; i++) {
      var s = daily[i][0] + daily[i - 1][0] + daily[i - 2][0], c = daily[i][1] + daily[i - 1][1] + daily[i - 2][1];
      if (s < MIN_WINDOW_SENDS) { if (i === daily.length - 1) last = null; continue; }
      var r = c / s;
      if (peak === null || r > peak) peak = r;
      if (i === daily.length - 1) last = r;
    }
    return { last: last, peak: peak };
  }
  function words(s) { return String(s || '').toLowerCase().replace(/\{[a-z_]+(\|[^}]*)?\}/g, ' ').match(/[a-z0-9%$]+/g) || []; }
  function featVec(v) {
    var ft = MC.copy.features(v);
    return [Math.min(1, ft.len / 80), ft.hasNumber, ft.personal, ft.urgency, ft.question, ft.ctaStrength, ft.image, Math.min(1, ft.grade / 12), ft.caps, ft.toneFit];
  }
  // 0 = identical, 1 = nothing in common: half from the hook's words, half from the content features.
  function distance(a, b) {
    var wa = words(hookOf(a)), wb = words(hookOf(b)), sa = {}, inter = 0, uni = 0;
    wa.forEach(function (w) { sa[w] = 1; });
    var sb = {};
    wb.forEach(function (w) { sb[w] = 1; });
    sortedKeys(sa).forEach(function (w) { uni++; if (sb[w]) inter++; });
    sortedKeys(sb).forEach(function (w) { if (!sa[w]) uni++; });
    var jw = uni ? inter / uni : 1;
    var fa = featVec(a), fb = featVec(b), fd = 0;
    for (var i = 0; i < fa.length; i++) fd += Math.abs(fa[i] - fb[i]);
    return 0.5 * (1 - jw) + 0.5 * (fd / fa.length);
  }
  function productPrice(world, id) {
    var prods = (world.catalog && world.catalog.products) || [], s = 0;
    for (var i = 0; i < prods.length; i++) { if (prods[i].id === id) return prods[i].price; s += prods[i].price || 0; }
    return prods.length ? s / prods.length : 100;
  }
  function nextLetter(world, cid, ch) {
    var used = {};
    MC.catalog.variantsOf(world, cid, ch).forEach(function (v) { used[v.name] = true; });
    for (var i = 0; i < 26; i++) { var L = String.fromCharCode(65 + i); if (!used[L]) return L; }
    return 'Z';
  }

  /* ---------------- content: blocks and messages ---------------- */
  var TONE_OF_ANGLE = { 'trail-season': 'adventurous', warmth: 'warm', gifting: 'warm', urgency: 'urgent', utility: 'practical', neutral: 'practical' };
  var ANGLE_NAME = { 'trail-season': 'trail-season', warmth: 'warmth', gifting: 'gifting', urgency: 'urgency', utility: 'practical', neutral: 'neutral' };
  function joinList(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function clipT(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function plainT(s) { return String(s || '').replace(/\{first_name\|([^}]+)\}/g, '$1').replace(/\s*\{first_name(\|)?\}[,:]?\s*/g, ' ').replace(/\{[a-z_]+(\|[^}]*)?\}/g, '').replace(/\s+([.,!?])/g, '$1').replace(/\s+/g, ' ').trim(); }
  var PLURAL = { headline: 'headlines', body: 'bodies', cta: 'buttons' };
  function wordSet(s) { var o = {}; words(s).forEach(function (x) { o[x] = 1; }); return o; }
  function similar(a, b) {
    var sa = wordSet(a), sb = wordSet(b), i = 0, u = 0;
    Object.keys(sa).forEach(function (k) { u++; if (sb[k]) i++; });
    Object.keys(sb).forEach(function (k) { if (!sa[k]) u++; });
    return u > 0 && i / u >= 0.8;
  }
  function headlineAngleOf(world, msg) { var b = msg && MC.content.block(world, msg.slots.headline); return (b && b.tags && b.tags.angle) || null; }

  // Words that pass the checks and are not copies of words the library already holds.
  function writeBlocks(world, kinds, opts, count) {
    var K = MC.content, brand = world.guardrails && world.guardrails.brand, tone = opts.tone || 'practical';
    var drafts = MC.copy.generate({ channel: 'email', tone: tone, productId: opts.productId || null, offer: opts.offer || 'none', count: Math.min(12, Math.max(4, count * 3)), seedKey: opts.seedKey, blocks: true }, world.meta.seed) || [];
    var have = K.blocks(world), out = [], seen = [];
    drafts.sort(function (a, b) { return (b.predicted.score - a.predicted.score) || (a.tmpId < b.tmpId ? -1 : 1); });
    drafts.forEach(function (d) {
      if (MC.copy.check(d, brand).some(function (r) { return r.status === 'fail'; })) return;
      var picks = {}, ok = true;
      (d.blocks || []).forEach(function (b) { picks[b.kind] = b; });
      kinds.forEach(function (k) {
        var b = picks[k];
        if (!b || K.valueError(k, b.value)) { ok = false; return; }
        if (have.some(function (x) { return x.kind === k && !x.retired && !x.archived && similar(K.textOf(x), b.value); })) ok = false;
        if (seen.some(function (x) { return x.kind === k && similar(x.value, b.value); })) ok = false;
      });
      if (!ok) return;
      var tags = {};
      kinds.forEach(function (k) { tags[k] = assign({}, picks[k].tags, { angle: opts.angle || picks[k].tags.angle, tone: tone }); if (opts.product) tags[k].product = opts.product; if (k === 'cta') tags[k].angle = 'neutral'; });
      var entry = { predicted: d.predicted, blocks: {} };
      kinds.forEach(function (k) { entry.blocks[k] = { kind: k, value: picks[k].value, tags: tags[k] }; seen.push({ kind: k, value: picks[k].value }); });
      out.push(entry);
    });
    return out.slice(0, count);
  }

  // What the content ledger says to write toward: the angle that is winning on this channel, if it is not the leader's.
  function angleFor(world, u, leaderAngle) {
    var S = MC.select, recs = (S && S.contentRecommendations) ? S.contentRecommendations(world) : [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.kind === 'angle-winner' && r.channel === u.ch && r.best.angle !== leaderAngle && TONE_OF_ANGLE[r.best.angle] && r.best.angle !== 'gifting') return { angle: r.best.angle, rec: r };
    }
    return null;
  }

  function valueOfChallenger(world, u, vs, predicted, tired, share, t) {
    var clicksGoal = !!CLICK_GOALS[u.goal], horizonDays = 96 / 24;
    var reward = function (x) { return clicksGoal ? x.clicks : x.conv; };
    var rateAvg = u.chTot.sends > 0 ? reward(u.chTot) / u.chTot.sends : 0;
    var openOf = function (o) { return u.ch === 'sms' ? 0.92 : (isNum(o) ? o : 0.2); };
    var qAvg = 0, wsum = 0;
    vs.forEach(function (v) { qAvg += v.share * openOf(v.pOpen) * v.pClick; wsum += v.share; });
    qAvg = wsum > 0 ? qAvg / wsum : openOf(vs[0].pOpen) * vs[0].pClick;
    var q = openOf(predicted.open) * (isNum(predicted.click) ? predicted.click : 0.05), ratio = qAvg > 0 ? q / qAvg : 1;
    if (tired) ratio = Math.max(ratio, 1);
    var rateNew = rateAvg * ratio;
    var value = clicksGoal ? (u.chTot.clicks > 0 && u.chTot.revenue > 0 ? u.chTot.revenue / u.chTot.clicks : 2)
      : (u.chTot.conv > 0 ? u.chTot.revenue / u.chTot.conv : productPrice(world, u.productFocus));
    var sendsH = (u.recentSends / 3) * Math.min(horizonDays, Math.max(0, (u.endTick - t) / 24));
    var exp = share * sendsH, delta = exp * (rateNew - rateAvg) * value;
    var sd = Math.sqrt(Math.max(1, exp * Math.max(rateNew, rateAvg))) * value;
    return { delta: delta, sd: sd, better: rateNew > rateAvg };
  }

  function composeChallengers(world, wants, p, t, proposals, rows) {
    var K = MC.content, S = MC.select, share = p.challengerShare, byC = {}, order = [];
    wants.forEach(function (x) { if (!byC[x.u.cid]) { byC[x.u.cid] = []; order.push(x.u.cid); } byC[x.u.cid].push(x); });
    order.forEach(function (cid) {
      var ws = byC[cid], first = ws[0], base = first.baseMsg, u0 = first.u;
      var chs = ws.filter(function (x) { return x.baseMsg.id === base.id; }).map(function (x) { return x.u.ch; });
      var aim = angleFor(world, u0, headlineAngleOf(world, base)), tone = aim ? TONE_OF_ANGLE[aim.angle] : (u0.tone || 'practical'), angle = aim ? aim.angle : null;
      var cands = writeBlocks(world, ['headline', 'body'], { tone: tone, angle: angle, productId: u0.productFocus, seedKey: 'copy:' + cid + ':' + chs.join('') + ':' + t }, 6);
      var co = {};
      Object.keys(base.channelOverrides || {}).sort().forEach(function (ch) { var o = assign({}, base.channelOverrides[ch]); delete o.headline; delete o.body; if (Object.keys(o).length) co[ch] = o; });
      var pick = null, picked = null, why = 'No draft passed the brand checks';
      for (var i = 0; i < cands.length && !pick; i++) {
        var c = cands[i], slots = assign({}, base.slots, { headline: '$h0', body: '$b0' });
        var draft = { name: clipT(u0.name + ': new ' + (ANGLE_NAME[c.blocks.headline.tags.angle] || 'headline') + ' words', 78), slots: slots, channelOverrides: co,
          tags: assign({}, base.tags, { angle: c.blocks.headline.tags.angle }), blocks: { $h0: c.blocks.headline, $b0: c.blocks.body } };
        var chk = S.draftChecks(world, draft, chs, cid);
        if (chk.ok) { pick = c; picked = draft; } else why = 'Drafts failed the ' + chLower(chk.channel) + ' check: ' + chk.problem;
      }
      ws.forEach(function (x) { x.row.result = pick ? 'Draft message with a new headline' : why; });
      if (!pick) return;
      // a draft that scores well below the leader is not worth testing unless the leader has tired
      var tiredAny = ws.some(function (x) { return x.tired; });
      if (!tiredAny && pick.predicted.score < first.L.score - 10) { ws.forEach(function (x) { x.row.result = 'No draft scored close to the leader'; }); return; }
      var dl = 0, sd2 = 0, better = false;
      ws.forEach(function (x) {
        if (chs.indexOf(x.u.ch) < 0) return;
        var v = valueOfChallenger(world, x.u, x.vs, pick.predicted, x.tired, share, t);
        dl += v.delta; sd2 += v.sd * v.sd; better = better || v.better;
      });
      if (!tiredAny && !better) { ws.forEach(function (x) { x.row.result = 'Best draft isn’t predicted to beat the current mix'; }); return; }
      var sd = Math.sqrt(sd2), hd = pick.blocks.headline.value, bd = pick.blocks.body.value;
      var chText = joinList(chs.map(chLower)), leadHook = clipT(plainT(K.textOf(K.block(world, base.slots.headline))), 50);
      var reasons = ws.filter(function (x) { return chs.indexOf(x.u.ch) >= 0; }).map(function (x) {
        return x.tired
          ? 'the leading ' + chLower(x.u.ch) + ' has slipped to ' + pct(x.w.last, 2) + ' clicks per send over the last 3 days from a peak of ' + pct(x.w.peak, 2)
          : 'the ' + chLower(x.u.ch) + ' test has settled: the leader has a ' + pct(x.pBest, 0) + ' chance of being best after ' + num(x.L.sends) + ' sends';
      });
      var evid = [];
      if (aim) evid.push({ label: 'What the ledger says', value: aim.rec.summary });
      evid.push({ label: 'Headline', value: '“' + clipT(plainT(hd), 70) + '” (' + (ANGLE_NAME[angle || pick.blocks.headline.tags.angle] || 'new') + ')' });
      evid.push({ label: 'Reused as approved', value: [base.slots.offer ? 'offer' : null, 'button', base.slots.claims && base.slots.claims.length ? 'claims' : null, base.slots.image ? 'image' : null].filter(Boolean).join(', ') });
      evid.push({ label: 'Content score', value: String(Math.round(pick.predicted.score)) + ' vs ' + Math.round(first.L.score) + ' for the leader' });
      proposals.push({
        kind: 'new-variant', risk: 'medium', mustQueue: true, horizon: 96,
        target: { kind: 'campaign', id: cid },
        title: 'Test a new headline on ' + chText + ' in ' + u0.name,
        rationale: joinList(reasons).replace(/^./, function (c0) { return c0.toUpperCase(); }) + '. ' + (aim ? aim.rec.summary + ' ' : '') +
          'I wrote a new headline and body, kept the approved ' + (base.slots.offer ? 'offer, ' : '') + 'button and claims from the leading message, and checked the result in ' + chText + '. ' +
          'It starts on ' + pct(share, 0) + ' of traffic once the new blocks and the message are approved; nothing goes live before that.',
        evidence: evid,
        impact: { metric: 'revenue', unit: '$', delta: Math.round(dl), lo: Math.round(dl - 1.28 * sd), hi: Math.round(dl + 1.28 * sd), horizonDays: 96 / 24, confidence: tiredAny ? 0.6 : 0.5 },
        actions: [
          { type: 'block/create', payload: { tmpId: '$h0', block: pick.blocks.headline } },
          { type: 'block/create', payload: { tmpId: '$b0', block: pick.blocks.body } },
          { type: 'message/create', payload: { tmpId: '$m0', message: { name: picked.name, slots: picked.slots, channelOverrides: picked.channelOverrides, tags: picked.tags } } },
          { type: 'message/publish', payload: { id: '$m0', campaignId: cid, channels: chs, share: share } }
        ],
        diff: chs.map(function (ch) { return { label: chLowerCap(ch) + ' headline', before: leadHook, after: clipT(plainT(hd), 60) }; })
          .concat([{ label: 'New message share', before: '0%', after: pct(share, 0) }])
      });
    });
  }
  function chLowerCap(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch); }

  // Fresh blocks for the library: a winning angle running out of headlines, or a tired block with nothing to swap in.
  function libraryProposals(world, p, t, proposals, rows, trace) {
    var S = MC.select, K = MC.content;
    if (!S || !S.contentRecommendations || !K) return;
    var recs = S.contentRecommendations(world).filter(function (r) { return r.kind === 'write-blocks'; }), made = 0, lrows = [];
    recs.forEach(function (r) {
      var row = { need: r.title, result: '' };
      lrows.push(row);
      if (made >= 1) { row.result = 'Later: one batch per run'; return; }
      var kind = r.blockKind || 'headline', angle = r.angle || 'neutral', count = kind === 'headline' ? 3 : 2;
      // do not pile up: new words from this agent still waiting for review count as the answer
      var waiting = K.blocks(world).filter(function (b) { return b.kind === kind && b.author === 'agent:copy' && b.review !== 'approved' && !b.retired && !b.archived && (b.tags && b.tags.angle) === (kind === 'cta' ? 'neutral' : angle) && t - b.createdTick < 14 * 24; });
      if (waiting.length >= 2) { row.result = 'Words already waiting for review'; return; }
      var tone = (r.tone && MC.copy.TONES.indexOf(r.tone) >= 0) ? r.tone : (TONE_OF_ANGLE[angle] || 'practical');
      var got = writeBlocks(world, [kind], { tone: tone, angle: angle, product: r.product || null, productId: r.product || null, seedKey: 'copy:lib:' + kind + ':' + angle + ':' + t }, count);
      if (!got.length) { row.result = 'No draft passed the brand checks'; return; }
      var name = (K.ANGLE_LABEL[angle] || angle).toLowerCase();
      var actions = got.map(function (g, i) { return { type: 'block/create', payload: { block: g.blocks[kind], note: 'Written by Copy Drafter' } }; });
      row.result = 'Write ' + got.length + ' ' + (got.length === 1 ? kind : PLURAL[kind]);
      made++;
      proposals.push({
        kind: 'new-blocks', risk: 'low', mustQueue: true, horizon: 0,
        target: { kind: 'library', id: kind + ':' + angle },
        title: 'Write ' + got.length + ' new ' + name + ' ' + (got.length === 1 ? K.KIND_LABEL[kind].toLowerCase() : PLURAL[kind]) + ' for the library',
        rationale: r.summary + ' ' + (r.replaces ? 'Once approved, one of them can take its place in every message that carries it. ' : '') +
          'Each is tagged ' + name + ' and goes to review; nothing uses them until someone approves them.',
        evidence: [{ label: 'Why now', value: r.summary }, { label: 'Tagged', value: name + ', ' + tone + ' tone' }],
        impact: null,
        actions: actions,
        diff: got.map(function (g) { return { label: 'New ' + K.KIND_LABEL[kind].toLowerCase(), before: '—', after: clipT(plainT(g.blocks[kind].value), 70) }; })
      });
    });
    if (lrows.length) trace.push({ step: 'decide', text: 'Checked the library for angles that are winning but running out of words.', rows: lrows });
  }

  /* ---------------- decide ---------------- */
  function decide(obs, ctx) {
    var p = ctx.params, rng = ctx.rng, t = ctx.tick, world = ctx.world;
    var trace = [], proposals = [], rows = [];
    var brand = world.guardrails && world.guardrails.brand;
    var share = p.challengerShare, horizonDays = 96 / 24;
    trace.push({ step: 'observe', text: obs.units.length
      ? 'Checked the leading variant on ' + obs.units.length + (obs.units.length === 1 ? ' live channel.' : ' live channels.')
      : 'No live email, SMS or push channel to check.' });

    var wants = [];
    obs.units.forEach(function (u) {
      var vs = u.variants, clicksGoal = !!CLICK_GOALS[u.goal];
      var row = { campaign: u.name, channel: chLower(u.ch), result: 'No new copy needed' };
      rows.push(row);
      // Leader by chance of being best on conversions per send (the Drafter's own estimate).
      var arms = vs.map(function (v) { return { a: 1 + v.conv, b: 1 + Math.max(0, v.sends - v.conv) }; });
      var pBest = MC.models.probBest(arms, rng, 400);
      var lead = 0;
      for (var i = 1; i < vs.length; i++) if (pBest[i] > pBest[lead]) lead = i;
      var L = vs[lead], w = ctrWindows(L.daily);
      row.leader = 'Variant ' + L.name + ': ' + pct(pBest[lead], 0) + ' chance best' + (w.last !== null ? ', ' + pct(w.last, 2) + ' clicks per send lately' : '');
      var tired = w.last !== null && w.peak !== null && w.peak > 0 && w.last <= (1 - p.decayThreshold) * w.peak;
      var settled = vs.length >= 2 && pBest[lead] >= SETTLED && L.sends >= obs.minSample;
      if (!tired && !settled) return;
      if (u.liveCount >= p.maxVariants) { row.result = 'Already ' + u.liveCount + ' live variants'; return; }
      if (u.lastAgentNew !== null && t - u.lastAgentNew < REST_AFTER_NEW) { row.result = 'Waiting on the last new variant'; return; }
      if (u.endTick - t < 96) { row.result = 'Campaign ends too soon to test'; return; }

      // A leader made from a message gets a challenger message (new blocks composed with the campaign's approved ones).
      var Lv = world.variants.byId[L.id], baseMsg = Lv && Lv.messageId && MC.content && MC.content.message(world, Lv.messageId);
      if (baseMsg) {
        wants.push({ u: u, L: L, lead: lead, w: w, tired: tired, pBest: pBest[lead], vs: vs, row: row, baseMsg: baseMsg });
        row.result = 'Drafting a challenger message';
        return;
      }

      // Write candidates and filter.
      var drafts = MC.copy.generate({ channel: u.ch, tone: u.tone, productId: u.productFocus, offer: u.offer,
        count: Math.min(8, p.candidates), seedKey: 'copy:' + u.cid + ':' + u.ch + ':' + t }, world.meta.seed);
      var existing = MC.catalog.variantsOf(world, u.cid, u.ch).filter(function (v) { return v.status !== 'retired'; });
      var kept = [], drops = 0, dups = 0;
      drafts.forEach(function (d) {
        var fails = MC.copy.check(d, brand).filter(function (r) { return r.status === 'fail'; });
        if (fails.length) { drops++; return; }
        for (var k = 0; k < existing.length; k++) if (distance(d, existing[k]) < DUP_DISTANCE) { dups++; return; }
        kept.push(d);
      });
      if (!kept.length) { row.result = 'No draft passed the brand checks'; return; }
      kept.sort(function (a, b) { return (b.predicted.score - a.predicted.score) || (a.tmpId < b.tmpId ? -1 : 1); });
      var best = kept[0];
      if (best.predicted.score < L.score - 10) { row.result = 'No draft scored close to the leader'; return; }

      // Expected value of giving it `share` of traffic for the horizon.
      var reward = function (x) { return clicksGoal ? x.clicks : x.conv; };
      var rateAvg = u.chTot.sends > 0 ? reward(u.chTot) / u.chTot.sends : 0;
      var openOf = function (o) { return u.ch === 'sms' ? 0.92 : (isNum(o) ? o : 0.2); };
      var qAvg = 0, wsum = 0;
      vs.forEach(function (v) { qAvg += v.share * openOf(v.pOpen) * v.pClick; wsum += v.share; });
      qAvg = wsum > 0 ? qAvg / wsum : openOf(vs[0].pOpen) * vs[0].pClick;
      var bp = best.predicted || {}, q = openOf(bp.open) * (isNum(bp.click) ? bp.click : 0.05);
      var ratio = qAvg > 0 ? q / qAvg : 1;
      if (tired) ratio = Math.max(ratio, 1);       // fresh copy against a tiring leader at least holds the average
      var rateNew = rateAvg * ratio;
      var value = clicksGoal ? (u.chTot.clicks > 0 && u.chTot.revenue > 0 ? u.chTot.revenue / u.chTot.clicks : 2)
        : (u.chTot.conv > 0 ? u.chTot.revenue / u.chTot.conv : productPrice(world, u.productFocus));
      var sendsH = (u.recentSends / 3) * Math.min(horizonDays, Math.max(0, (u.endTick - t) / 24));
      var exp = share * sendsH, delta = exp * (rateNew - rateAvg) * value;
      var sd = Math.sqrt(Math.max(1, exp * Math.max(rateNew, rateAvg))) * value;
      if (!tired && !(rateNew > rateAvg)) { row.result = 'Best draft isn\u2019t predicted to beat the current mix'; return; }

      var letter = nextLetter(world, u.cid, u.ch);
      var variant = { campaignId: u.cid, channel: u.ch, name: letter, fields: best.fields, tone: best.tone, offer: best.offer,
        productId: best.productId, predicted: best.predicted };
      var why = tired
        ? 'The leading ' + chLower(u.ch) + ', ' + quote(world.variants.byId[L.id]) + ', has slipped to ' + pct(w.last, 2) +
          ' clicks per send over the last 3 days from a peak of ' + pct(w.peak, 2) + '.'
        : quote(world.variants.byId[L.id]) + ' has a ' + pct(pBest[lead], 0) + ' chance of being the best ' + chLower(u.ch) +
          ' after ' + num(L.sends) + ' sends, so the test has settled.';
      why += ' A new challenger, ' + quote(variant) + ', starts on ' + pct(share, 0) + ' of traffic (content score ' + Math.round(best.predicted.score) +
        ' vs ' + Math.round(L.score) + ' for the leader).';
      row.result = 'Draft variant ' + letter;
      var diff = [{ label: 'New ' + chLower(u.ch) + ' variant ' + letter, before: '\u2014', after: hookOf(variant) }];
      vs.forEach(function (v) {
        diff.push({ label: 'Variant ' + v.name + ' share', before: pct(v.share, 0), after: pct(v.share * (1 - share), 0) });
      });
      diff.push({ label: 'Variant ' + letter + ' share', before: '0%', after: pct(share, 0) });
      proposals.push({
        kind: 'new-variant', risk: 'medium', horizon: 96,
        target: { kind: 'campaign', id: u.cid, channel: u.ch },
        title: 'Add a fresh ' + chLower(u.ch) + ' challenger to ' + u.name,
        rationale: why,
        evidence: [
          { label: tired ? 'Leader\u2019s click rate, last 3 days' : 'Chance the leader is best', value: tired ? pct(w.last, 2) : pct(pBest[lead], 0) },
          { label: tired ? 'Its peak' : 'Leader\u2019s sends', value: tired ? pct(w.peak, 2) : num(L.sends) },
          { label: 'New copy\u2019s content score', value: String(Math.round(best.predicted.score)) },
          { label: 'Drafts considered', value: drafts.length + (drops ? ', ' + drops + ' failed brand checks' : '') + (dups ? ', ' + dups + ' too similar' : '') }
        ],
        impact: { metric: 'revenue', unit: '$', delta: Math.round(delta), lo: Math.round(delta - 1.28 * sd), hi: Math.round(delta + 1.28 * sd),
          horizonDays: horizonDays, confidence: tired ? 0.6 : 0.5 },
        actions: [{ type: 'variant/create', payload: { variant: variant, share: share } }],
        diff: diff
      });
    });
    composeChallengers(world, wants, p, t, proposals, rows);
    libraryProposals(world, p, t, proposals, rows, trace);
    trace.push({ step: 'decide', text: proposals.length
      ? 'Drafted ' + proposals.length + (proposals.length === 1 ? ' new proposal.' : ' new proposals.')
      : 'Every leader is still fresh or the test is still open, so no new copy this time.', rows: rows.slice(0, 40) });
    return { proposals: proposals, insights: [], trace: trace };
  }

  MC.runtime.register({
    id: ID, name: 'Copy Drafter', short: 'Writes tagged blocks and composes messages from approved ones; everything goes to review.', icon: 'edit', order: 6,
    cadence: { 'default': 48, min: 12, max: 168, phase: 6 },
    autonomy: { 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] },
    autopilotMaxRisk: 'low',
    params: {
      decayThreshold: { label: 'Tiring threshold', type: 'pct', 'default': 0.15, min: 0.05, max: 0.5, step: 0.05, help: 'Write new copy when the leader\u2019s click rate falls this far below its best 3 days.' },
      candidates: { label: 'Drafts per channel', type: 'int', 'default': 6, min: 2, max: 12, step: 1, help: 'How many drafts to write before picking the best one.' },
      maxVariants: { label: 'Most live variants', type: 'int', 'default': 4, min: 2, max: 6, step: 1, help: 'Stop adding copy once a channel has this many live variants.' },
      challengerShare: { label: 'Challenger share', type: 'pct', 'default': 0.10, min: 0.05, max: 0.25, step: 0.01, help: 'The share of traffic a new variant starts with.' }
    },
    emits: ['variant/create', 'block/create', 'message/create', 'message/publish'],
    guardrails: ['brand', 'maxShift', 'protectDrafts', 'targetFresh'],
    notifyDefault: 'changes',
    materiality: { metric: 'revenue', min: 0 },
    horizon: 96,
    observe: observe,
    decide: decide,
    risk: function (draft) { return draft.kind === 'new-blocks' ? 'low' : 'medium'; }
  });
})();
