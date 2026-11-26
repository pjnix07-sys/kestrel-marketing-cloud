/* Marketing Cloud - MC.guardrails: the rules every agent proposal is checked against before it
   can apply, plus the campaign preflight used when a draft is scheduled and by the Campaign Planner.
   Pure functions of (world, proposal, def); no clock, no randomness, no store access. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var G = MC.guardrails = MC.guardrails || {};

  var REG = {}, ORDER = [];
  G.BASE = ['consent', 'protectDrafts', 'targetFresh', 'holdout'];

  // define(id, {label, blocking, rule?, fn(world, proposal, def) -> {pass, detail}})
  G.define = function (id, spec) {
    if (!id || !spec || typeof spec.fn !== 'function') return null;
    REG[id] = { id: id, label: spec.label || id, blocking: spec.blocking !== false, immutable: !!spec.immutable, rule: spec.rule || '', fn: spec.fn };
    if (ORDER.indexOf(id) < 0) ORDER.push(id);
    return REG[id];
  };
  G.get = function (id) { return REG[id] || null; };
  G.list = function () { return ORDER.map(function (id) { var r = REG[id]; return { id: id, label: r.label, blocking: r.blocking, immutable: r.immutable, rule: r.rule }; }); };

  // evaluate(world, proposal, def) -> [{id, label, pass, detail, blocking}] for def.guardrails ∪ BASE (in that order).
  G.evaluate = function (world, proposal, def) {
    var ids = [];
    function add(id) { if (typeof id === 'string' && ids.indexOf(id) < 0) ids.push(id); }
    ((def && def.guardrails) || []).forEach(add);
    G.BASE.forEach(add);
    var p = proposal || {};
    return ids.filter(function (id) { return REG[id]; }).map(function (id) {
      var g = REG[id], r;
      try { r = g.fn(world, p, def || {}) || {}; } catch (e) { r = { pass: false, detail: 'This check couldn’t run: ' + (e && e.message ? e.message : String(e)) + '.' }; }
      return { id: id, label: g.label, pass: !!r.pass, detail: r.detail || '', blocking: g.blocking };
    });
  };

  /* ---------------- helpers ---------------- */
  function F() { return MC.F; }
  function fmtN(n) { return MC.fmt && MC.fmt.num ? MC.fmt.num(Math.round(n)) : String(Math.round(n)); }
  function fmtPct(x) { return MC.fmt && MC.fmt.pct ? MC.fmt.pct(x, 0) : Math.round(x * 100) + '%'; }
  function fmtMoney(x) { return MC.fmt && MC.fmt.money ? MC.fmt.money(x) : '$' + Math.round(x); }
  function chName(ch) { return (MC.CH.LABEL[ch] || ch); }
  function hh(h) { return (h < 10 ? '0' : '') + h + ':00'; }
  function acts(p) { return (p && p.actions) || []; }
  function pl(a) { return (a && a.payload) || {}; }
  function camp(world, id) { return world.campaigns && world.campaigns.byId[id]; }
  function variant(world, id) { return world.variants && world.variants.byId[id]; }
  function today(world) { return Math.floor(world.meta.tick / 24); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function can(P, i, bit) { return (P.consent[i] & bit) !== 0 && (P.unsub[i] & bit) === 0; }

  // Campaign ids an action touches (existing campaigns only).
  function campaignOfAction(world, a) {
    var x = pl(a), t = a && a.type || '';
    if (t.indexOf('campaign/') === 0 && t !== 'campaign/create' && typeof x.id === 'string') return x.id;
    if (t === 'variant/create' && x.variant) return x.variant.campaignId || null;
    if ((t === 'variant/setStatus' || t === 'variant/update') && variant(world, x.id)) return variant(world, x.id).campaignId;
    if (t === 'profiles/suppress' || t === 'profiles/release') return x.campaignId || null;
    return null;
  }
  function campaignIds(world, p) {
    var ids = [];
    function add(id) { if (id && camp(world, id) && ids.indexOf(id) < 0) ids.push(id); }
    var tg = p.target || {};
    if (tg.kind === 'campaign') add(tg.id);
    if (tg.kind === 'variant' && variant(world, tg.id)) add(variant(world, tg.id).campaignId);
    acts(p).forEach(function (a) { add(campaignOfAction(world, a)); });
    return ids;
  }
  function agentParams(world, p, def) {
    var o = {}, dp = (def && def.params) || {};
    sortedKeys(dp).forEach(function (k) { o[k] = dp[k] && dp[k]['default']; });
    var a = world.agents && p.agentId && world.agents.byId[p.agentId];
    if (a && a.params) sortedKeys(a.params).forEach(function (k) { o[k] = a.params[k]; });
    return o;
  }
  // Segment rule referenced by an action: an existing segment id, or a tmpId created earlier in the same proposal.
  function ruleFor(world, p, segId) {
    if (!segId) return null;
    var s = world.segments && world.segments.byId[segId];
    if (s) return s.rule;
    var found = null;
    acts(p).forEach(function (a) {
      var x = pl(a);
      if (a.type === 'segment/create' && x.segment && (x.tmpId === segId || x.segment.tmpId === segId || segId === '$1')) found = found || x.segment.rule;
    });
    return found;
  }
  function bitsFor(world, rule) {
    if (!rule || !MC.segments || typeof MC.segments.evaluate !== 'function') return null;
    try { return MC.segments.evaluate(world, rule).bits; } catch (e) { return null; }
  }
  function reachOf(world, bits, ch) {
    var P = world.profiles, bit = MC.CH.BIT[ch], n = 0, r = 0;
    for (var i = 0; i < P.n; i++) if (bits[i]) { n++; if (can(P, i, bit)) r++; }
    return { n: n, reach: r, pct: n ? r / n : 0 };
  }
  function spentBefore(world, cid, ch, d) {
    var days = world.metrics.days, k = F().COST, s = 0, end = Math.min(days.length, d - MC.time.DAY0);
    for (var i = 0; i < end; i++) { var cd = days[i].c && days[i].c[cid], f = cd && cd.ch && cd.ch[ch]; if (f) s += f[k]; }
    return s;
  }
  function variantSends(world, cid, vid) {
    var days = world.metrics.days, s = 0;
    for (var i = 0; i < days.length; i++) { var cd = days[i].c && days[i].c[cid], f = cd && cd.v && cd.v[vid]; if (f) s += f[F().SENT]; }
    return s;
  }
  G._h = { campaignIds: campaignIds, ruleFor: ruleFor, reachOf: reachOf, spentBefore: spentBefore, variantSends: variantSends };

  /* ---------------- registry (§6.1) ---------------- */
  G.define('consent', { label: 'Consent respected', blocking: true, immutable: true,
    rule: 'No action targets a channel people haven’t opted into; new audiences need 50% reach on the primary channel.',
    fn: function (world, p) {
      var notes = [];
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a), c = camp(world, campaignOfAction(world, a));
        var ch = a.type === 'variant/create' ? (x.variant && x.variant.channel) : x.channel;
        if (c && ch && ['campaign/setSendHour', 'campaign/setAlloc', 'campaign/setChannelPaused', 'variant/create'].indexOf(a.type) >= 0 && c.channels.indexOf(ch) < 0) {
          return { pass: false, detail: chName(ch) + ' isn’t one of ' + c.name + '’s channels.' };
        }
        var rule = null, primary = null;
        if (a.type === 'campaign/include' && x.on !== false && c) { rule = ruleFor(world, p, x.segmentId); primary = c.channels[0]; }
        else if (a.type === 'campaign/create' && x.campaign) {
          rule = x.segment ? x.segment.rule : ruleFor(world, p, x.campaign.segmentId);
          primary = (x.campaign.channels || [])[0];
        }
        if (rule && primary && world.profiles) {
          var bits = bitsFor(world, rule);
          if (bits) {
            var r = reachOf(world, bits, primary);
            if (r.n && r.pct < 0.5) return { pass: false, detail: 'Only ' + fmtPct(r.pct) + ' of ' + fmtN(r.n) + ' people can get ' + chName(primary).toLowerCase().replace('sms', 'SMS') + ' (needs 50%).' };
            notes.push(fmtPct(r.pct) + ' of ' + fmtN(r.n) + ' people can get ' + chName(primary).replace('Email', 'email').replace('Push', 'push') + '.');
          }
        }
      }
      return { pass: true, detail: notes[0] || 'Every action stays within people’s channel permissions.' };
    } });

  G.define('freqCap', { label: 'Frequency cap', blocking: true,
    rule: 'Projected sends stay within the 7-day cap; the simulation enforces it on every send too.',
    fn: function (world, p) {
      var cap = (world.guardrails && world.guardrails.freqCap) || { email: 4, sms: 2, push: 5 }, P = world.profiles;
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a), c = camp(world, campaignOfAction(world, a));
        if (a.type !== 'campaign/include' || x.on === false || !c) continue;
        var bits = bitsFor(world, ruleFor(world, p, x.segmentId));
        if (!bits) continue;
        var owned = c.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0; });
        for (var j = 0; j < owned.length; j++) {
          var ci = MC.CH.IDX[owned[j]], n = 0, at = 0;
          for (var i = 0; i < P.n; i++) {
            if (!bits[i]) continue;
            n++;
            var s7 = 0, b = i * 21 + ci * 7;
            for (var q = 0; q < 7; q++) s7 += P.sent7[b + q];
            if (s7 >= (cap[owned[j]] || 99)) at++;
          }
          if (n && at / n > 0.5) return { pass: false, detail: fmtPct(at / n) + ' of the new audience already hit the ' + chName(owned[j]) + ' cap this week.' };
        }
      }
      return { pass: true, detail: 'Within the 7-day cap (email ' + cap.email + ', SMS ' + cap.sms + ', push ' + cap.push + '), which every send also respects.' };
    } });

  function quietFail(world, ch, hour) {
    var q = (world.guardrails && world.guardrails.quiet) || { start: 21, end: 8, channels: ['sms', 'push'] };
    if ((q.channels || []).indexOf(ch) < 0 || !isNum(hour)) return null;
    return MC.time.inQuiet(hour, q) ? chName(ch) + ' at ' + hh(hour) + ' falls in quiet hours (' + hh(q.start) + '–' + hh(q.end) + ').' : null;
  }
  G.define('quietHours', { label: 'Quiet hours', blocking: true, rule: 'SMS and push never send between 21:00 and 08:00.',
    fn: function (world, p) {
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a), msg = null;
        if (a.type === 'campaign/setSendHour') msg = quietFail(world, x.channel, x.hour);
        if (a.type === 'campaign/create' && x.campaign && x.campaign.sendHour) {
          sortedKeys(x.campaign.sendHour).forEach(function (ch) { msg = msg || quietFail(world, ch, x.campaign.sendHour[ch]); });
        }
        if (msg) return { pass: false, detail: msg };
      }
      return { pass: true, detail: 'No SMS or push send lands in quiet hours.' };
    } });

  G.define('maxShift', { label: 'Max change per run', blocking: true, rule: 'Traffic or budget moved in one run stays within the limit.',
    fn: function (world, p) {
      var lim = ((world.guardrails && world.guardrails.maxShiftPct) || 20) / 100, worst = 0, what = '';
      acts(p).forEach(function (a) {
        var x = pl(a), c = camp(world, campaignOfAction(world, a)), moved = 0, w = '';
        if (a.type === 'campaign/setAlloc' && c) {
          var old = (c.alloc && c.alloc[x.channel]) || {}, nw = x.alloc || {}, keys = {};
          sortedKeys(old).concat(sortedKeys(nw)).forEach(function (k2) { keys[k2] = true; });
          sortedKeys(keys).forEach(function (k2) { moved += Math.abs((+nw[k2] || 0) - (+old[k2] || 0)); });
          moved /= 2; w = chName(x.channel).replace('Email', 'email') + ' traffic';
        } else if (a.type === 'campaign/setBudget' && c) {
          var ob = (c.budget && c.budget.byChannel) || {}, nb = x.byChannel || {}, ks = {};
          sortedKeys(ob).concat(sortedKeys(nb)).forEach(function (k3) { ks[k3] = true; });
          sortedKeys(ks).forEach(function (k3) { moved += Math.abs((+nb[k3] || 0) - (+ob[k3] || 0)); });
          moved = c.budget && c.budget.total > 0 ? moved / 2 / c.budget.total : 0; w = 'the budget';
        } else if (a.type === 'variant/create' && isNum(x.share)) { moved = x.share; w = 'traffic to the new variant'; }
        if (moved > worst) { worst = moved; what = w; }
      });
      if (worst > lim + 1e-9) return { pass: false, detail: 'Moves ' + fmtPct(worst) + ' of ' + what + ' (limit ' + fmtPct(lim) + ').' };
      return { pass: true, detail: worst > 0 ? 'Moves ' + fmtPct(worst) + ' of ' + what + ' (limit ' + fmtPct(lim) + ').' : 'Moves no traffic or budget.' };
    } });

  G.define('minSample', { label: 'Minimum sample', blocking: true, rule: 'Enough sends before pausing a variant; enough people before creating a segment.',
    fn: function (world, p, def) {
      var min = (world.guardrails && world.guardrails.minSample) || 500, prm = agentParams(world, p, def), detail = null;
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a);
        if (a.type === 'variant/setStatus' && x.status !== 'live') {
          var v = variant(world, x.id);
          if (!v) continue;
          var s = variantSends(world, v.campaignId, v.id);
          if (s < min) return { pass: false, detail: 'Variant ' + v.name + ' has ' + fmtN(s) + ' sends; pausing needs ' + fmtN(min) + '.' };
          detail = 'Variant ' + v.name + ' has ' + fmtN(s) + ' sends (minimum ' + fmtN(min) + ').';
        }
        if (a.type === 'segment/create' && x.segment) {
          var need = isNum(prm.minSupport) ? prm.minSupport : 150, bits = bitsFor(world, x.segment.rule), n = 0;
          if (bits) for (var i = 0; i < bits.length; i++) n += bits[i];
          if (n < need) return { pass: false, detail: 'The new segment has ' + fmtN(n) + ' people; it needs at least ' + fmtN(need) + '.' };
          detail = detail || 'The new segment has ' + fmtN(n) + ' people (minimum ' + fmtN(need) + ').';
        }
      }
      return { pass: true, detail: detail || 'Nothing here needs a minimum sample.' };
    } });

  G.define('keepOneLive', { label: 'Keeps a variant live', blocking: true, rule: 'Never pauses the last live variant on a channel.',
    fn: function (world, p) {
      var leaving = {};
      acts(p).forEach(function (a) { if (a.type === 'variant/setStatus' && pl(a).status !== 'live') leaving[pl(a).id] = true; });
      var ids = sortedKeys(leaving);
      for (var k = 0; k < ids.length; k++) {
        var v = variant(world, ids[k]);
        if (!v) continue;
        var others = MC.catalog.variantsOf(world, v.campaignId, v.channel).filter(function (o) { return o.status === 'live' && !leaving[o.id]; });
        if (!others.length) return { pass: false, detail: 'Variant ' + v.name + ' is the last live ' + chName(v.channel).replace('Email', 'email') + ' variant.' };
      }
      return { pass: true, detail: ids.length ? 'Other variants stay live on the channel.' : 'No variant is paused.' };
    } });

  G.define('budgetCap', { label: 'Within budget', blocking: true, rule: 'Campaign total unchanged; planned daily spend stays under the daily cap.',
    fn: function (world, p) {
      var cap = (world.guardrails && world.guardrails.maxDailySpend) || 2500, d = today(world), detail = null;
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a), c = camp(world, campaignOfAction(world, a));
        if (a.type === 'campaign/setBudget' && c) {
          var nb = x.byChannel || {}, tot = 0, daily = 0;
          var daysLeft = Math.max(1, MC.time.dayOf(c.endTick - 1) - Math.max(d, MC.time.dayOf(c.startTick)) + 1);
          sortedKeys(nb).forEach(function (ch) {
            tot += +nb[ch] || 0;
            daily += Math.max(0, (+nb[ch] || 0) - spentBefore(world, c.id, ch, d)) / daysLeft;
          });
          var was = (c.budget && c.budget.total) || 0;
          if (Math.abs(tot - was) > 0.5) return { pass: false, detail: 'Changes the total from ' + fmtMoney(was) + ' to ' + fmtMoney(tot) + '.' };
          if (daily > cap + 0.5) return { pass: false, detail: 'Plans ' + fmtMoney(daily) + ' a day (cap ' + fmtMoney(cap) + ').' };
          detail = 'Total stays ' + fmtMoney(was) + '; about ' + fmtMoney(daily) + ' a day (cap ' + fmtMoney(cap) + ').';
        }
        if (a.type === 'campaign/setEnd' && c) detail = detail || 'Total stays ' + fmtMoney((c.budget && c.budget.total) || 0) + '; a longer run lowers daily spend.';
        if (a.type === 'campaign/create' && x.campaign) {
          var cc = x.campaign, t2 = 0, days = Math.max(1, (cc.endTick - cc.startTick) / 24);
          sortedKeys((cc.budget && cc.budget.byChannel) || {}).forEach(function (ch) { t2 += +cc.budget.byChannel[ch] || 0; });
          if (t2 / days > cap + 0.5) return { pass: false, detail: 'Plans ' + fmtMoney(t2 / days) + ' a day (cap ' + fmtMoney(cap) + ').' };
          detail = 'About ' + fmtMoney(t2 / days) + ' a day (cap ' + fmtMoney(cap) + ').';
        }
      }
      return { pass: true, detail: detail || 'No budget change.' };
    } });

  G.define('protectDrafts', { label: 'Doesn’t touch drafts', blocking: true, immutable: true, rule: 'Agents never change a campaign that is still a draft.',
    fn: function (world, p) {
      var ids = campaignIds(world, p);
      for (var k = 0; k < ids.length; k++) {
        var c = camp(world, ids[k]);
        if (c && c.status === 'draft') return { pass: false, detail: c.name + ' is still a draft.' };
      }
      return { pass: true, detail: ids.length ? 'The campaign isn’t a draft.' : 'No existing campaign is changed.' };
    } });

  G.define('brand', { label: 'Brand & compliance', blocking: true, rule: 'New copy passes every brand and compliance check.',
    fn: function (world, p) {
      var brand = world.guardrails && world.guardrails.brand, list = [];
      acts(p).forEach(function (a) {
        var x = pl(a);
        if (a.type === 'variant/create' && x.variant) list.push(x.variant);
        if ((a.type === 'campaign/create' || a.type === 'campaign/applyPlan') && Array.isArray(x.variants)) x.variants.forEach(function (v) { list.push(v); });
      });
      if (!list.length || !MC.copy || typeof MC.copy.check !== 'function') return { pass: true, detail: 'No new copy.' };
      for (var k = 0; k < list.length; k++) {
        var fails = MC.copy.check(list[k], brand).filter(function (r) { return r.status === 'fail'; });
        if (fails.length) return { pass: false, detail: (list[k].name ? 'Variant ' + list[k].name + ': ' : '') + fails[0].label + '. ' + fails[0].detail };
      }
      return { pass: true, detail: list.length === 1 ? 'The new copy passes every check.' : 'All ' + list.length + ' variants pass every check.' };
    } });

  G.define('targetFresh', { label: 'Unchanged since proposed', blocking: true, rule: 'What the proposal changes is still the version it looked at.',
    fn: function (world, p) {
      var bv = p.baseVer || {}, ids = sortedKeys(bv);
      for (var k = 0; k < ids.length; k++) {
        var id = ids[k], e = (world.campaigns && world.campaigns.byId[id]) || (world.variants && world.variants.byId[id]) || (world.segments && world.segments.byId[id]);
        if (!e) return { pass: false, detail: id + ' no longer exists.' };
        if ((e.ver || 0) !== bv[id]) return { pass: false, detail: (e.name ? (e.campaignId ? 'Variant ' + e.name : e.name) : id) + ' changed since this was proposed.' };
      }
      return { pass: true, detail: ids.length ? 'Nothing changed since it was proposed.' : 'Nothing to compare.' };
    } });

  G.define('maxSuppress', { label: 'Suppression ≤ 15% of audience', blocking: true, rule: 'Resting people never removes more than the limit of a campaign’s treatment audience.',
    fn: function (world, p, def) {
      var prm = agentParams(world, p, def), lim = (isNum(prm.maxSuppressPct) ? prm.maxSuppressPct : 15) / 100, t = world.meta.tick, P = world.profiles, worst = null;
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a);
        if (a.type !== 'profiles/suppress') continue;
        var E = world.enroll && world.enroll[x.campaignId], ci = MC.CH.IDX[x.channel];
        if (!E || !(ci >= 0 && ci < 3)) continue;
        var prop = {}, n = 0, sup = 0;
        (x.idx || []).forEach(function (i) { prop[i] = true; });
        for (var i = 0; i < P.n; i++) {
          if (E.step[i] === -1 || E.ctl[i]) continue;
          n++;
          if (P.supUntil[i * 3 + ci] > t || prop[i]) sup++;
        }
        var share = n ? sup / n : 0;
        if (!worst || share > worst.share) worst = { share: share, n: n, sup: sup, ch: x.channel };
      }
      if (!worst) return { pass: true, detail: 'Nobody is suppressed.' };
      var txt = fmtN(worst.sup) + ' of ' + fmtN(worst.n) + ' people (' + fmtPct(worst.share) + ') rested on ' + chName(worst.ch) + ', limit ' + fmtPct(lim) + '.';
      return { pass: worst.share <= lim + 1e-9, detail: txt };
    } });

  function hasCtlKey(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6) return false;
    if (ArrayBuffer.isView(o)) return false;
    var ks = Object.keys(o);
    for (var i = 0; i < ks.length; i++) {
      if (ks[i] === 'ctl' || ks[i] === 'ctlStatus') return true;
      if (hasCtlKey(o[ks[i]], depth + 1)) return true;
    }
    return false;
  }
  G.define('holdout', { label: 'Control group untouched', blocking: true, rule: 'Actions never change what the control group gets.',
    fn: function (world, p) {
      for (var k = 0; k < acts(p).length; k++) {
        var a = acts(p)[k], x = pl(a);
        if (hasCtlKey(x, 0)) return { pass: false, detail: 'This action edits the control group’s plan directly.' };
        if (a.type === 'profiles/suppress' && x.campaignId) {
          var E = world.enroll && world.enroll[x.campaignId], hit = 0;
          if (E) (x.idx || []).forEach(function (i) { if (E.ctl[i]) hit++; });
          if (hit) return { pass: false, detail: fmtN(hit) + ' of the people to rest are in the control group.' };
        }
      }
      return { pass: true, detail: 'The control group keeps the original plan.' };
    } });

  G.DEFAULTS = G.list();

  /* ---------------- campaign preflight (§10.3) ---------------- */
  // Audience bits of a campaign-like object: segmentId (or opts.segment) ∪ include − suppress.
  function audienceOf(world, c, opts) {
    var n = world.profiles.n, out = new Uint8Array(n), any = false, i;
    function addRule(rule, on) {
      var b = bitsFor(world, rule);
      if (!b) return;
      for (i = 0; i < n; i++) if (b[i]) out[i] = on ? 1 : 0;
      if (on) any = true;
    }
    var seg = c.segmentId && world.segments.byId[c.segmentId];
    if (seg) addRule(seg.rule, true);
    else if (opts && opts.segment && opts.segment.rule) addRule(opts.segment.rule, true);
    (c.include || []).forEach(function (id) { var s = world.segments.byId[id]; if (s) addRule(s.rule, true); });
    (c.suppress || []).forEach(function (id) { var s = world.segments.byId[id]; if (s) addRule(s.rule, false); });
    return any ? out : null;
  }
  function variantsFor(world, c, opts) {
    if (opts && Array.isArray(opts.variants)) return opts.variants;
    if (Array.isArray(c.variants)) return c.variants;
    if (!c.id || !world.variants) return [];
    return MC.catalog.variantsOf(world, c.id).filter(function (v) { return v.status === 'live' || v.status === 'draft'; });
  }
  function overlapsInTime(a, b) { return a.startTick < b.endTick && b.startTick < a.endTick; }

  // preflight(world, campaignLike, opts?) -> [{id, label, status:'pass'|'warn'|'fail', detail}]
  //   opts = { variants?: VariantDraft[], segment?: {name, rule} } for planner drafts that aren't in the world yet.
  G.preflight = function (world, campaignLike, opts) {
    var c = campaignLike || {}, out = [], g = world.guardrails || {};
    var channels = Array.isArray(c.channels) ? c.channels : [];
    function item(id, label, status, detail) { out.push({ id: id, label: label, status: status, detail: detail }); }

    // 1. audience
    var seg = c.segmentId && world.segments.byId[c.segmentId], segName = seg ? seg.name : (opts && opts.segment && opts.segment.name) || null;
    var bits = audienceOf(world, c, opts), size = 0, i;
    if (bits) for (i = 0; i < bits.length; i++) size += bits[i];
    if (!bits) item('segment', 'Audience', 'fail', 'Pick an audience segment.');
    else if (!size) item('segment', 'Audience', 'fail', (segName || 'The audience') + ' has nobody in it right now.');
    else item('segment', 'Audience', 'pass', (segName || 'Audience') + ' · ' + fmtN(size) + ' people.');

    // 2. consent coverage on the primary channel
    var primary = channels[0];
    if (!primary) item('consent', 'Consent coverage', 'fail', 'Pick at least one channel.');
    else if (bits && size) {
      var r = reachOf(world, bits, primary);
      var nm = primary === 'sms' ? 'SMS' : chName(primary).toLowerCase();
      item('consent', 'Consent coverage', r.pct >= 0.5 ? 'pass' : 'fail', fmtPct(r.pct) + ' of the audience can get ' + nm + (r.pct >= 0.5 ? '.' : ' (needs 50%).'));
    } else item('consent', 'Consent coverage', 'fail', 'No audience to check yet.');

    // 3. content for every channel
    var vs = variantsFor(world, c, opts), missing = [], paidMissing = [];
    channels.forEach(function (ch) {
      var has = vs.some(function (v) { return v.channel === ch && v.status !== 'retired' && v.status !== 'paused'; });
      if (has) return;
      if (MC.CH.OWNED.indexOf(ch) >= 0) missing.push(chName(ch)); else paidMissing.push(chName(ch));
    });
    if (missing.length) item('content', 'Content', 'fail', 'Add at least one variant for ' + missing.join(', ') + '.');
    else if (paidMissing.length) item('content', 'Content', 'warn', paidMissing.join(', ') + ' will run with generic creative until you add a variant.');
    else item('content', 'Content', channels.length ? 'pass' : 'fail', channels.length ? 'Every channel has content.' : 'Pick at least one channel.');

    // 4. brand & compliance
    var worstB = null;
    if (MC.copy && typeof MC.copy.check === 'function') {
      vs.forEach(function (v) {
        if (channels.indexOf(v.channel) < 0) return;
        MC.copy.check(v, g.brand).forEach(function (x) {
          if (x.status === 'pass') return;
          if (!worstB || (x.status === 'fail' && worstB.x.status !== 'fail')) worstB = { v: v, x: x };
        });
      });
    }
    if (worstB) item('brand', 'Brand & compliance', worstB.x.status, chName(worstB.v.channel) + ' ' + (worstB.v.name || '') + ': ' + worstB.x.label + '. ' + worstB.x.detail);
    else item('brand', 'Brand & compliance', 'pass', vs.length ? 'All copy passes the brand checks.' : 'No copy to check yet.');

    // 5. quiet hours
    var qmsg = null;
    sortedKeys(c.sendHour || {}).forEach(function (ch) { if (channels.indexOf(ch) >= 0) qmsg = qmsg || quietFail(world, ch, c.sendHour[ch]); });
    item('quiet', 'Quiet hours', qmsg ? 'fail' : 'pass', qmsg || 'No SMS or push send is scheduled in quiet hours.');

    // 6. budget
    var by = (c.budget && c.budget.byChannel) || {}, total = 0, zero = [];
    channels.forEach(function (ch) { var b = +by[ch] || 0; total += b; if (!(b > 0)) zero.push(chName(ch)); });
    var days = Math.max(1, ((c.endTick || 0) - (c.startTick || 0)) / 24), daily = total / days, cap = g.maxDailySpend || 2500;
    if (!(total > 0)) item('budget', 'Budget', 'fail', 'Set a budget above $0.');
    else if (daily > cap + 0.5) item('budget', 'Budget', 'fail', fmtMoney(daily) + ' a day is over the ' + fmtMoney(cap) + ' daily cap.');
    else if (zero.length) item('budget', 'Budget', 'warn', zero.join(', ') + (zero.length > 1 ? ' have' : ' has') + ' no budget, so ' + (zero.length > 1 ? 'they' : 'it') + ' won’t send.');
    else item('budget', 'Budget', 'pass', fmtMoney(total) + ' total, about ' + fmtMoney(daily) + ' a day (cap ' + fmtMoney(cap) + ').');

    // 7. frequency-cap collisions with live and scheduled campaigns (warn only)
    var clash = null;
    if (bits && size && isNum(c.startTick) && isNum(c.endTick)) {
      (world.campaigns.order || []).forEach(function (cid) {
        var o = world.campaigns.byId[cid];
        if (!o || o.id === c.id || (o.status !== 'live' && o.status !== 'scheduled') || !overlapsInTime(o, c)) return;
        var shared = o.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0 && channels.indexOf(ch) >= 0; });
        if (!shared.length) return;
        var ob = audienceOf(world, o, null);
        if (!ob) return;
        var both = 0;
        for (var j = 0; j < ob.length; j++) if (ob[j] && bits[j]) both++;
        if (both && (!clash || both > clash.n)) clash = { n: both, name: o.name, ch: shared[0] };
      });
    }
    if (clash) item('freqCap', 'Frequency cap', 'warn', fmtN(clash.n) + ' people are also in ' + clash.name + ' on ' + (clash.ch === 'sms' ? 'SMS' : clash.ch) + '; the 7-day cap will hold back some sends.');
    else item('freqCap', 'Frequency cap', 'pass', 'No overlap with other running campaigns on the same channels.');

    // 8. start time
    var now = world.meta.tick;
    if (!isNum(c.startTick) || !isNum(c.endTick) || c.endTick <= c.startTick) item('start', 'Dates', 'fail', 'The end must come after the start.');
    else if (c.startTick < now + 1) item('start', 'Dates', 'fail', 'The start time has passed. Pick a time after ' + (MC.fmt && MC.fmt.stamp ? MC.fmt.stamp(now) : 'now') + '.');
    else item('start', 'Dates', 'pass', 'Starts ' + (MC.fmt && MC.fmt.stamp ? MC.fmt.stamp(c.startTick) : 'later') + ', runs ' + Math.round(days) + ' days.');
    return out;
  };
})();
