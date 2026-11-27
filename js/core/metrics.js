/* Marketing Cloud - MC.metrics: the one definition of every shared quantity (docs/CONSISTENCY.md section 1).
   Every surface and agent reads these; select.js delegates to them so old callers agree. Pure, deterministic, memoized per world.

     campaign(w, cid)        -> { id, name, status, window:{fromDay,toDay}, revenue, direct, conversions, reactivations, cost, roas,
                                  sent, delivered, opens, clicks, unsubs, reached, byChannel:{ch:{revenue,cost,sends,...}},
                                  holdoutPct, holdoutLabel, definition }
                                revenue = orders by people enrolled in the campaign, enrolment to campaign end, credited last-touch
                                (within 7 days of a touch) to this campaign. `direct` = orders placed straight from its own clicks.
     mission(w, id)          -> { id, metric, value, target, forecast, lo, hi, band, pct, forecastPct, verdict, campaignIds[],
                                  revenue, conversions, reactivations, cost, roas, sent, delivered, reached }
     lift(w, {campaignId|missionId|segmentId|blockId}) -> { ready, scope, metric, treated, control, liftPct (percent units), lo, hi,
                                  nTreated, nControl, holdoutPct:5, label:'5% held out', note }
                                Treated audience members against the universal holdout members of the same audience, revenue per
                                person over the campaign window, standardized to the holdout's propensity mix, 95% interval.
     load(w, scope?)         -> { days, cap, caps, people, distribution, overCap, atCap, rested, restedByChannel, status, text, byCampaign }
                                scope: { days?, campaignId? }. Rested people are never reported as "nobody over the cap".
     content(w, opts)        -> within-campaign contrast rows (opts.dim -> matrix; otherwise opts.by -> performance rows)
     messages(w, scope?)     -> { messages, channelVersions, variants, blocks, ids[] }  scope: undefined (library) | {campaignId} | {missionId}
     asks(w)                 -> { count, missionAsks[], proposals[], byMission:{id:n} } */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var M = MC.metrics = MC.metrics || {};

  var HOLDOUT_PCT = 5, Z95 = 1.96, QSTRATA = 5;
  M.HOLDOUT_PCT = HOLDOUT_PCT;
  M.HOLDOUT_LABEL = '5% held out';
  M.DEFINITIONS = {
    revenue: 'Orders by people enrolled in the campaign, from enrolment to the campaign end, credited last-touch to the campaign within 7 days of a message or ad.',
    lift: 'Revenue per person for people the campaign messaged, against the 5% of the same audience held out from every message (same period, same kind of people), with a 95% range.'
  };

  /* ---------------- helpers ---------------- */
  var caches = {};
  function memo(name, deps, key, compute) {
    var c = caches[name] || (caches[name] = { keys: [], map: {} }), e = c.map[key];
    if (e && same(e.deps, deps)) return e.value;
    var v = compute();
    if (!e) { c.keys.push(key); if (c.keys.length > 96) delete c.map[c.keys.shift()]; }
    c.map[key] = { deps: deps, value: v };
    return v;
  }
  function same(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true; }
  M._clear = function () { caches = {}; };
  function F() { return MC.F; }
  function rv(w, k) { return w.rev ? w.rev[k] : 0; }
  function today(w) { return Math.floor(w.meta.tick / 24); }
  function entry(w, d) { var i = d - MC.time.DAY0; return (i >= 0 && w.metrics && w.metrics.days) ? w.metrics.days[i] : undefined; }
  function camp(w, id) { return w.campaigns && w.campaigns.byId[id]; }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function key(o) { return o === undefined || o === null ? '' : (typeof o === 'string' ? o : MC.util.canon(o)); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function holdoutPct(w) { return (w.meta && typeof w.meta.universalHoldoutPct === 'number') ? w.meta.universalHoldoutPct : HOLDOUT_PCT; }

  /* ---------------- campaign ---------------- */
  // Attributed (last-touch) revenue per day through the campaign's last day. Used by select.js for every revenue number.
  M.attributed = function (w, cid) {
    var c = camp(w, cid);
    if (!c || !w.metrics) return null;
    return memo('attributed', [w, rv(w, 'metrics'), c, w.meta.tick], cid, function () {
      var D0 = MC.time.DAY0, t = today(w);
      var from = Math.max(D0, Math.floor(c.startTick / 24)), last = Math.floor((c.endTick - 1) / 24), to = Math.min(t, last);
      var out = { fromDay: from, toDay: to, byDay: {}, total: 0, byChannel: {} };
      for (var d = from; d <= to; d++) {
        var e = entry(w, d), cd = e && e.c && e.c[cid], a = cd && cd.attrLast;
        if (!a) continue;
        var s = 0;
        sortedKeys(a).forEach(function (ch) { s += a[ch]; out.byChannel[ch] = (out.byChannel[ch] || 0) + a[ch]; });
        out.byDay[d] = s; out.total += s;
      }
      return out;
    });
  };

  // Unique people reached: anyone with a delivery still on their touch ring, an open or a click on record, or an order from it.
  function reachedOf(w, cid) {
    return memo('reached', [w, rv(w, 'enroll'), rv(w, 'profiles'), rv(w, 'metrics'), w.meta.tick], cid, function () {
      var E = w.enroll && w.enroll[cid], P = w.profiles, all = w.campaigns.all || w.campaigns.order, ai = all.indexOf(cid), n = 0;
      if (!E || !P) return 0;
      var uh = MC.sim && MC.sim.universalHoldoutBits ? MC.sim.universalHoldoutBits(w) : null;
      var c = camp(w, cid), done = !!c && c.status === 'completed', owned = c ? c.channels.filter(function (x) { return MC.CH.OWNED.indexOf(x) >= 0; }) : [];
      for (var i = 0; i < E.step.length; i++) {
        if (E.step[i] === -1 || (uh && uh[i])) continue;
        var hit = (E.flags[i] & 3) !== 0 || E.rev[i] > 0;
        if (!hit && P.touchC && ai >= 0) for (var j = 0; j < 8; j++) if (P.touchC[i * 8 + j] === ai) { hit = true; break; }
        // A finished campaign's touches have scrolled off the ring: everyone it could message (consented, not opted out) was reached.
        if (!hit && done) for (var q = 0; q < owned.length; q++) { var b = MC.CH.BIT ? MC.CH.BIT[owned[q]] : 0; if (b && (P.consent[i] & b) && !(P.unsub[i] & b)) { hit = true; break; } }
        if (hit) n++;
      }
      return n;
    });
  }

  function missionOfCampaign(w, cid) {
    var s = w.missions;
    if (!s || !s.order) return null;
    for (var k = 0; k < s.order.length; k++) {
      var m = s.byId[s.order[k]];
      if (m && (m.artifacts || []).some(function (a) { return a.kind === 'campaign' && a.id === cid; })) return { id: m.id, title: m.title };
    }
    return null;
  }

  M.campaign = function (w, cid) {
    var c = camp(w, cid);
    if (!c) return null;
    return memo('campaign', [w, rv(w, 'metrics'), rv(w, 'enroll'), c, w.missions, w.meta.tick], cid, function () {
      var f = F(), tot = new Float64Array(f.LEN), ch = {}, days = w.metrics.days;
      for (var i = 0; i < days.length; i++) {
        var cd = days[i].c && days[i].c[cid];
        if (!cd) continue;
        for (var k = 0; k < f.LEN; k++) tot[k] += cd.tot ? cd.tot[k] : 0;
        sortedKeys(cd.ch).forEach(function (x) { var a = ch[x] || (ch[x] = new Float64Array(f.LEN)); for (var q = 0; q < f.LEN; q++) a[q] += cd.ch[x][q]; });
      }
      var at = M.attributed(w, cid), byCh = {};
      c.channels.forEach(function (x) {
        var a = ch[x] || new Float64Array(f.LEN), paid = MC.CH.PAID.indexOf(x) >= 0;
        byCh[x] = { revenue: at.byChannel[x] || 0, direct: a[f.REV], conversions: a[f.CONV], cost: a[f.COST], sends: a[f.SENT], delivered: a[f.DELIV], opens: a[f.OPEN], clicks: a[f.CLICK], impressions: a[f.IMPR], paid: paid };
      });
      sortedKeys(at.byChannel).forEach(function (x) { if (!byCh[x]) byCh[x] = { revenue: at.byChannel[x], direct: 0, conversions: 0, cost: 0, sends: 0, delivered: 0, opens: 0, clicks: 0, impressions: 0, paid: MC.CH.PAID.indexOf(x) >= 0 }; });
      var cost = tot[f.COST];
      return {
        id: cid, name: c.name, status: c.status, mission: missionOfCampaign(w, cid), window: { fromDay: at.fromDay, toDay: at.toDay },
        revenue: at.total, direct: tot[f.REV], conversions: tot[f.CONV], reactivations: tot[f.REACT], cost: cost, roas: cost > 0 ? at.total / cost : null,
        sent: tot[f.SENT], delivered: tot[f.DELIV], opens: tot[f.OPEN], clicks: tot[f.CLICK], unsubs: tot[f.UNSUB], impressions: tot[f.IMPR],
        reached: reachedOf(w, cid), byChannel: byCh, holdoutPct: holdoutPct(w), holdoutLabel: M.HOLDOUT_LABEL, definition: M.DEFINITIONS.revenue
      };
    });
  };

  /* ---------------- lift ---------------- */
  function strataFor(w, cid, out) {
    var E = w.enroll && w.enroll[cid], P = w.profiles, uh = MC.sim && MC.sim.universalHoldoutBits ? MC.sim.universalHoldoutBits(w) : null;
    if (!E || !E.step || !uh) return;
    // Revenue per person over the campaign window. Campaigns finished before the ledger existed only have their own-click revenue.
    var useAll = false, i;
    for (i = 0; i < E.step.length; i++) if (E.step[i] !== -1 && E.all && E.all[i] > 0) { useAll = true; break; }
    var R = useAll ? E.all : E.rev, people = [];
    for (i = 0; i < E.step.length; i++) {
      // Members the campaign's own test already routes elsewhere (per-campaign control) are excluded from both sides.
      if (E.step[i] === -1 || E.ctl[i]) continue;
      people.push(i);
    }
    // Strata by what each person had spent before the campaign (lifetime spend minus what they spent during the window, so it is
    // untouched by the campaign itself), so the small holdout is compared with people of the same buying history. Propensity scores
    // are not used: they are rescored daily from engagement the campaign itself changes.
    var pre = function (p) { return useAll ? P.spend[p] - E.all[p] : P.spend[p]; };
    var order = people.slice().sort(function (a, b) { var d = pre(a) - pre(b); return d !== 0 ? d : a - b; });
    var Q = QSTRATA, st = [];
    for (var q = 0; q < Q; q++) st.push({ n: [0, 0], s: [0, 0], q: [0, 0], b: [0, 0] });
    for (var k = 0; k < order.length; k++) {
      var p = order[k], g = uh[p] ? 1 : 0, r = R[p], s = st[Math.min(Q - 1, Math.floor(k * Q / order.length))];
      s.n[g]++; s.s[g] += r; s.q[g] += r * r; if (r > 0) s.b[g]++;
    }
    st.forEach(function (s) { out.strata.push(s); });
    out.metric = useAll ? 'revenue per person' : 'campaign revenue per person';
    out.campaigns++;
  }

  function liftFromStrata(S, out) {
    var nC = 0, nT = 0, buyC = 0, buyT = 0, use = [];
    S.strata.forEach(function (s) { nT += s.n[0]; nC += s.n[1]; buyT += s.b[0]; buyC += s.b[1]; if (s.n[0] >= 2 && s.n[1] >= 2) use.push(s); });
    out.nTreated = nT; out.nControl = nC;
    if (nC < 30) { out.note = 'Only ' + nC + ' people in this audience are held out from all messages so far. Lift shows once there are 30.'; return out; }
    if (nT < 30 || !use.length) { out.note = 'Not enough people have been messaged yet.'; return out; }
    var wsum = 0, mT = 0, mC = 0, vT = 0, vC = 0;
    use.forEach(function (s) { wsum += s.n[1]; });
    use.forEach(function (s) {
      var wt = s.n[1] / wsum, m0 = s.s[0] / s.n[0], m1 = s.s[1] / s.n[1];
      var v0 = Math.max(0, (s.q[0] - s.n[0] * m0 * m0) / (s.n[0] - 1)), v1 = Math.max(0, (s.q[1] - s.n[1] * m1 * m1) / (s.n[1] - 1));
      mT += wt * m0; mC += wt * m1; vT += wt * wt * v0 / s.n[0]; vC += wt * wt * v1 / s.n[1];
    });
    out.treated = mT; out.control = mC;
    if (buyC < 3 || buyT < 3 || !(mC > 0)) { out.note = 'Only ' + buyC + (buyC === 1 ? ' held-out person has' : ' held-out people have') + ' bought so far. Lift needs at least 3.'; return out; }
    var lr = Math.log(mT > 0 ? mT / mC : 1e-9), se = Math.sqrt(vT / (mT * mT || 1) + vC / (mC * mC));
    out.liftPct = (mT / mC - 1) * 100;
    out.lo = (mT > 0 ? Math.exp(lr - Z95 * se) - 1 : -1) * 100;
    out.hi = (mT > 0 ? Math.exp(lr + Z95 * se) - 1 : -1) * 100;
    out.ready = true;
    out.note = out.lo > 0 ? 'Clearly above the held-out group.' : (out.hi < 0 ? 'Clearly below the held-out group.' : 'Too close to call: the range includes no lift.');
    return out;
  }

  function campaignIdsOf(w, scope) {
    if (scope.campaignId) return camp(w, scope.campaignId) ? [scope.campaignId] : [];
    if (scope.missionId) {
      var m = w.missions && w.missions.byId[scope.missionId];
      return m ? (m.artifacts || []).filter(function (a) { return a.kind === 'campaign' && camp(w, a.id); }).map(function (a) { return a.id; }) : [];
    }
    if (scope.segmentId) return w.campaigns.order.filter(function (id) { var c = camp(w, id); return c && (c.segmentId === scope.segmentId || (c.include || []).indexOf(scope.segmentId) >= 0); });
    return [];
  }

  M.lift = function (w, scope) {
    scope = scope || {};
    if (scope.blockId) return blockLift(w, scope);
    return memo('lift', [w, rv(w, 'enroll'), rv(w, 'metrics'), w.missions, w.meta.tick], key(scope), function () {
      var ids = campaignIdsOf(w, scope);
      var out = { ready: false, scope: scope, metric: 'revenue per person', treated: null, control: null, liftPct: null, lo: null, hi: null, nTreated: 0, nControl: 0,
        holdoutPct: holdoutPct(w), label: M.HOLDOUT_LABEL, definition: M.DEFINITIONS.lift, note: '' };
      var live = ids.filter(function (id) { var E = w.enroll && w.enroll[id]; return E && E.step; });
      if (!live.length) {
        var c0 = ids[0] && camp(w, ids[0]);
        out.note = c0 && (c0.status === 'draft' || c0.status === 'scheduled') ? 'Starts when the campaign goes live.' : 'No results yet.';
        return out;
      }
      var S = { strata: [], metric: out.metric, campaigns: 0 };
      live.forEach(function (id) { strataFor(w, id, S); });
      out.metric = S.metric;
      return liftFromStrata(S, out);
    });
  };

  // A block's lift is its within-campaign contrast on content (see select.js contentPerformance), in percent units.
  function blockLift(w, scope) {
    var rows = MC.select.contentPerformance(w, { by: 'block' }), r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].key === scope.blockId) { r = rows[i]; break; }
    var out = { ready: false, scope: scope, metric: 'engagement against other content in the same campaigns', treated: null, control: null, liftPct: null, lo: null, hi: null,
      nTreated: r ? r.delivered : 0, nControl: 0, note: r ? (r.reason || '') : 'Not sent yet.' };
    if (r && r.lift && r.enough) { out.ready = true; out.liftPct = r.lift.value * 100; out.lo = r.lift.lo * 100; out.hi = r.lift.hi * 100; out.note = ''; }
    return out;
  }

  /* ---------------- mission ---------------- */
  function r1(metric, x) { return metric === 'revenue' ? Math.round(x) : Math.round(x * 10) / 10; }
  M.mission = function (w, id) {
    var m = w.missions && w.missions.byId[id];
    if (!m) return null;
    return memo('mission', [w, rv(w, 'metrics'), rv(w, 'enroll'), m, w.meta.tick], id, function () {
      var o = m.objective, t = w.meta.tick;
      var cids = (m.artifacts || []).filter(function (a) { return a.kind === 'campaign' && camp(w, a.id); }).map(function (a) { return a.id; });
      var tot = { revenue: 0, direct: 0, conversions: 0, reactivations: 0, cost: 0, sent: 0, delivered: 0, reached: 0, unsubs: 0 };
      var rows = cids.map(function (cid) {
        var x = M.campaign(w, cid);
        Object.keys(tot).forEach(function (k) { tot[k] += x[k] || 0; });
        return x;
      });
      var pr = null;
      try { pr = MC.missions && typeof MC.missions.progressOf === 'function' ? MC.missions.progressOf(w, m, t) : null; } catch (e) { pr = null; }
      var value = { revenue: tot.revenue, reactivations: tot.reactivations, orders: tot.conversions, signups: tot.conversions }[o.metric];
      if (value === undefined || !rows.length) value = pr ? pr.value : (m.progress ? m.progress.value : 0);
      if (o.metric === 'unsubs' && pr) value = pr.value;
      // The forecast keeps the engine's projection of what is still to come and adds it to the canonical value.
      var rest = pr ? Math.max(0, pr.forecast - pr.value) : 0, spreadLo = pr ? pr.lo - pr.value : 0, spreadHi = pr ? pr.hi - pr.value : 0;
      var forecast = value + rest, lo = value + spreadLo, hi = value + spreadHi;
      var target = o.target, pace = target > 0 ? forecast / target : 0, band = pr ? pr.band : 'early';
      if (band !== 'early') {
        if (o.direction === 'atMost') band = forecast <= target * 0.9 ? 'ahead' : (forecast <= target ? 'on' : 'behind');
        else band = pace >= 1.05 ? 'ahead' : (pace >= 0.85 ? 'on' : 'behind');
      }
      value = r1(o.metric, value); forecast = r1(o.metric, forecast); lo = r1(o.metric, lo); hi = r1(o.metric, hi);
      var fm = function (x) { return o.metric === 'revenue' ? MC.fmt.money(x, { compact: true }) : MC.fmt.num(Math.round(x)); };
      var byTxt = MC.time && MC.time.dayLabel && isNum(o.by) ? MC.time.dayLabel(o.by) : '';
      var verdict = (band === 'early' || !(forecast > 0)) ? '' :
        'On pace for ' + fm(forecast) + ' of ' + fm(target) + ' (' + fm(lo) + ' to ' + fm(hi) + ')' + (byTxt ? ' by ' + byTxt : '') + '.';
      return {
        id: id, metric: o.metric, direction: o.direction || 'atLeast', value: value, target: target, forecast: forecast, lo: lo, hi: hi, band: band,
        pct: target > 0 ? value / target : 0, forecastPct: target > 0 ? forecast / target : 0, verdict: verdict,
        daysLeft: pr ? pr.daysLeft : null, campaignIds: cids, campaigns: rows,
        revenue: tot.revenue, conversions: tot.conversions, reactivations: tot.reactivations, cost: tot.cost, roas: tot.cost > 0 ? tot.revenue / tot.cost : null,
        sent: tot.sent, delivered: tot.delivered, reached: tot.reached
      };
    });
  };

  /* ---------------- message load ---------------- */
  M.load = function (w, scope) {
    scope = scope || {};
    var days = Math.max(1, Math.min(7, Math.round(scope.days > 0 ? scope.days : 7)));
    return memo('load', [w, w.meta.tick, w.guardrails, rv(w, 'profiles'), rv(w, 'enroll'), rv(w, 'metrics')], days + '|' + (scope.campaignId || ''), function () {
      var P = w.profiles, t = today(w), tick = w.meta.tick, g = w.guardrails || {}, fc = g.freqCap || { email: 4, sms: 2, push: 5 };
      var caps = { email: fc.email || 4, sms: fc.sms || 2, push: fc.push || 5 }, chs = ['email', 'sms', 'push'];
      var E = scope.campaignId ? (w.enroll && w.enroll[scope.campaignId]) : null;
      var slots = [];
      for (var q = 0; q < days; q++) slots.push((((t - q) % 7) + 7) % 7);
      var counts = {}, over = 0, atCap = 0, rested = 0, people = 0, restedBy = { email: 0, sms: 0, push: 0 };
      for (var i = 0; i < P.n; i++) {
        if (scope.campaignId && (!E || E.step[i] === -1)) continue;
        people++;
        var tot = 0, isOver = false, isAt = false, isRest = false;
        for (var ci = 0; ci < 3; ci++) {
          var s = 0;
          for (var j = 0; j < slots.length; j++) s += P.sent7[i * 21 + ci * 7 + slots[j]];
          tot += s;
          if (s > caps[chs[ci]]) isOver = true; else if (s >= caps[chs[ci]]) isAt = true;
          if (P.supUntil[i * 3 + ci] > tick) { isRest = true; restedBy[chs[ci]]++; }
        }
        counts[tot] = (counts[tot] || 0) + 1;
        if (isOver) over++; else if (isAt) atCap++;
        if (isRest) rested++;
      }
      var dist = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { sends: k, profiles: counts[k] }; });
      var by = {}, f = F();
      for (var d = Math.max(MC.time.DAY0, t - days + 1); d <= t; d++) {
        var e = entry(w, d);
        if (!e || !e.c) continue;
        w.campaigns.order.forEach(function (cid) {
          var cd = e.c[cid];
          if (!cd || !cd.ch) return;
          MC.CH.OWNED.forEach(function (ch) { if (cd.ch[ch]) by[cid] = (by[cid] || 0) + cd.ch[ch][f.SENT]; });
        });
      }
      var status = over > 0 ? 'over' : (rested > 0 ? 'resting' : 'clear');
      var np = function (n) { return MC.fmt.num(n) + (n === 1 ? ' person' : ' people'); };
      var text = status === 'over' ? np(over) + (over === 1 ? ' is' : ' are') + ' over the cap.'
        : (status === 'resting' ? np(rested) + (rested === 1 ? ' is' : ' are') + ' resting from messages so nobody reaches the cap' + (atCap > 0 ? '; ' + MC.fmt.num(atCap) + ' are at it' : '') + '.'
          : 'Nobody is over the cap and nobody is resting.');
      return { days: days, cap: caps.email, caps: caps, people: people, distribution: dist, overCap: over, atCap: atCap, rested: rested, restedByChannel: restedBy,
        status: status, text: text, byCampaign: by, scope: scope.campaignId ? { campaignId: scope.campaignId } : null };
    });
  };

  /* ---------------- content ---------------- */
  M.content = function (w, opts) {
    opts = opts || {};
    var S = MC.select;
    if (opts.dim) return S.contentMatrix(w, opts);
    return S.contentPerformance(w, opts);
  };

  /* ---------------- messages ---------------- */
  // A message is one piece of content: the same message published to three channels is one message and three channel versions.
  function msgKey(v) { return v.messageId || (v.campaignId + '|' + (v.name || v.id)); }
  M.messages = function (w, scope) {
    scope = scope || {};
    return memo('messages', [w, w.content, w.variants, w.campaigns, w.missions], key(scope), function () {
      var K = MC.content, vs = w.variants ? sortedKeys(w.variants.byId).map(function (id) { return w.variants.byId[id]; }) : [];
      var out = { messages: 0, channelVersions: 0, variants: 0, blocks: 0, ids: [] };
      if (!scope.campaignId && !scope.missionId) {
        var all = K ? K.messages(w) : [];
        out.messages = all.length; out.ids = all.map(function (m) { return m.id; });
        out.blocks = K ? K.blocks(w).length : 0;
        var cv = {};
        vs.forEach(function (v) { if (v.status !== 'retired') cv[msgKey(v) + '|' + v.channel] = 1; });
        out.channelVersions = Object.keys(cv).length; out.variants = vs.length;
        return out;
      }
      var cids = scope.campaignId ? [scope.campaignId] : campaignIdsOf(w, scope), set = {}, mids = {}, cvs = {}, blocks = {};
      cids.forEach(function (c) { set[c] = 1; });
      var m = scope.missionId && w.missions && w.missions.byId[scope.missionId];
      var extra = m ? (m.artifacts || []).filter(function (a) { return a.kind === 'message'; }).map(function (a) { return a.id; }) : [];
      vs.forEach(function (v) {
        if (!set[v.campaignId]) return;
        out.variants++;
        if (v.status === 'retired') return;
        var k = msgKey(v); mids[k] = v.messageId || null; cvs[k + '|' + v.channel] = 1;
        (v.blocks || []).forEach(function (b) { blocks[b.id] = 1; });
      });
      extra.forEach(function (id) { if (!mids[id] && K && K.message(w, id)) mids[id] = id; });
      out.ids = sortedKeys(mids); out.messages = out.ids.length; out.channelVersions = Object.keys(cvs).length; out.blocks = Object.keys(blocks).length;
      return out;
    });
  };

  /* ---------------- asks ---------------- */
  M.asks = function (w) {
    return memo('asks', [w, w.proposals, w.missions], '', function () {
      var ms = w.missions, ma = [], byMission = {};
      if (ms && ms.order) ms.order.forEach(function (id) {
        var m = ms.byId[id];
        if (!m || m.status === 'done' || m.status === 'stopped') return;
        (m.asks || []).forEach(function (a) {
          if (a.status !== 'open') return;
          ma.push({ missionId: m.id, missionTitle: m.title, ask: a, blocking: a.blocking !== false, tick: a.createdTick });
          byMission[m.id] = (byMission[m.id] || 0) + 1;
        });
      });
      ma.sort(function (x, y) { return ((y.blocking ? 1 : 0) - (x.blocking ? 1 : 0)) || (x.tick - y.tick) || (x.missionId < y.missionId ? -1 : 1); });
      var props = ((w.proposals && w.proposals.open) || []).map(function (id) { return w.proposals.byId[id]; })
        .filter(function (p) { return p && p.status === 'pending' && !p.supersededBy; });
      props.forEach(function (p) { if (p.missionId) byMission[p.missionId] = (byMission[p.missionId] || 0) + 1; });
      return { count: ma.length + props.length, missionAsks: ma, proposals: props, byMission: byMission };
    });
  };
})();
