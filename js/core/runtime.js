/* Marketing Cloud - MC.runtime: the agent runtime. Registry of agent definitions, cadence
   scheduling on the simulated clock, seeded rng forks per run, proposals with guardrails and
   autonomy routing (Off / Suggest / Autopilot), apply and undo through the action catalog,
   realized-impact measurement and a chained audit log with FNV-1a digests. Everything here works
   on the world it is given (live or replay) and never touches the store. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var RT = MC.runtime = MC.runtime || {};

  var assign = Object.assign;
  var registry = {};
  var RISK_RANK = { low: 0, medium: 1, high: 2 };
  var BASE_GUARDS = ['consent', 'protectDrafts', 'targetFresh', 'holdout'];
  var CAP = { feed: 400, insights: 100, audit: 1500, traceRows: 40, traceSteps: 24 };
  var NOT_MEASURED = { 'new-segment': 1, retarget: 1, 'campaign-draft': 1, 'pause-channel': 1 };
  var DID_KINDS = { 'traffic-shift': 1, 'pause-variant': 1, 'send-time': 1, 'adaptive-send': 1, 'new-variant': 1, 'fatigue-suppress': 1 };

  RT.CAP = CAP;

  function U() { return MC.util; }
  function T() { return MC.time; }
  function F() { return MC.F; }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function report(e) { if (window.console && console.error) console.error(e); }

  /* ======================= registry ======================= */
  function normalize(def) {
    var d = assign({}, def);
    d.name = d.name || d.id;
    d.short = d.short || '';
    d.order = isNum(d.order) ? d.order : 99;
    d.cadence = assign({ 'default': 24, min: 1, max: 168, phase: 0 }, d.cadence || {});
    d.autonomy = assign({ 'default': 'suggest', allowed: ['off', 'suggest', 'autopilot'] }, d.autonomy || {});
    d.params = d.params || {};
    d.emits = d.emits || [];
    d.guardrails = d.guardrails || [];
    d.materiality = assign({ min: 0 }, d.materiality || {});
    d.autopilotMaxRisk = d.autopilotMaxRisk || 'low';
    d.horizon = isNum(d.horizon) ? d.horizon : 0;
    d.notifyDefault = d.notifyDefault || 'changes';
    return d;
  }

  // Stores the definition only (agents call this at load time).
  RT.register = function (def) {
    if (!def || typeof def.id !== 'string' || !def.id) { report(new Error('MC.runtime.register: agent definitions need an id.')); return null; }
    registry[def.id] = normalize(def);
    return registry[def.id];
  };
  RT.defs = function () {
    return Object.keys(registry).map(function (k) { return registry[k]; })
      .sort(function (a, b) { return (a.order - b.order) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)); });
  };
  RT.def = function (id) { return registry[id] || null; };

  function defaultParams(def) {
    var o = {};
    sortedKeys(def.params).forEach(function (k) { o[k] = def.params[k]['default']; });
    return o;
  }
  RT.defaultParams = defaultParams;

  RT.newAgentEntity = function (def) {
    return {
      id: def.id, status: 'active', autonomy: def.autonomy['default'], cadence: def.cadence['default'],
      params: defaultParams(def), lastRunTick: null, runRequested: false, cooldowns: {}, ver: 1,
      stats: { runs: 0, proposed: 0, applied: 0, auto: 0, rejected: 0, undone: 0, expired: 0, superseded: 0, expected: 0, realized: 0 }
    };
  };

  // Adds an entity for every registered agent the world lacks (boot and replay both call it).
  RT.ensureAgents = function (world) {
    if (!world.agents) world.agents = { byId: {}, order: [] };
    var A = world.agents, byId = null, order = A.order.slice(), changed = false;
    RT.defs().forEach(function (def) {
      if (A.byId[def.id]) return;
      if (!byId) byId = assign({}, A.byId);
      byId[def.id] = RT.newAgentEntity(def);
      order.push(def.id);
      changed = true;
    });
    if (!changed) return world;
    order.sort(function (a, b) {
      var da = registry[a], db = registry[b];
      return ((da ? da.order : 99) - (db ? db.order : 99)) || (a < b ? -1 : (a > b ? 1 : 0));
    });
    world.agents = assign({}, A, { byId: byId, order: order });
    return world;
  };

  /* ======================= copy-on-write helpers ======================= */
  function put(world, slice, ent) {
    var s = world[slice], byId = assign({}, s.byId);
    byId[ent.id] = ent;
    world[slice] = assign({}, s, { byId: byId });
  }
  function agentOf(world, id) { return world.agents && world.agents.byId[id]; }
  function patchAgent(world, id, fn) {
    var a = agentOf(world, id);
    if (!a) return;
    put(world, 'agents', assign({}, a, fn(a)));
  }
  function addStats(world, id, delta) {
    patchAgent(world, id, function (a) {
      var s = assign({}, a.stats);
      sortedKeys(delta).forEach(function (k) { s[k] = (s[k] || 0) + delta[k]; });
      return { stats: s };
    });
  }
  function prop(world, id) { return world.proposals && world.proposals.byId[id]; }
  function close(world, p, patch) { return MC.catalog.closeProposal(world, p, patch); }
  function addFeed(world, item) { return MC.catalog.addFeed(world, item); }
  function entityById(world, id) {
    return (world.campaigns && world.campaigns.byId[id]) || (world.variants && world.variants.byId[id]) ||
      (world.segments && world.segments.byId[id]) || null;
  }
  function kindOf(world, id) {
    if (world.campaigns && world.campaigns.byId[id]) return 'campaign';
    if (world.variants && world.variants.byId[id]) return 'variant';
    if (world.segments && world.segments.byId[id]) return 'segment';
    return 'item';
  }

  // Ids of existing entities an action list targets (for baseVer / postVer).
  function targetIds(world, actions, target) {
    var ids = {};
    function addId(x) { if (typeof x === 'string' && entityById(world, x)) ids[x] = true; }
    (actions || []).forEach(function (a) {
      var pl = (a && a.payload) || {};
      addId(pl.id);
      if (pl.variant) addId(pl.variant.campaignId);
      if (typeof pl.id === 'string' && world.variants && world.variants.byId[pl.id]) addId(world.variants.byId[pl.id].campaignId);
    });
    if (target && (target.kind === 'campaign' || target.kind === 'variant' || target.kind === 'segment')) addId(target.id);
    return sortedKeys(ids);
  }
  function versOf(world, ids) {
    var o = {};
    ids.forEach(function (id) { var e = entityById(world, id); if (e) o[id] = e.ver || 0; });
    return o;
  }

  /* ======================= observe view & status ======================= */
  // Shallow copy of the world without the latent truth; agents and views read this.
  RT.observeView = function (world) {
    var v = {};
    Object.keys(world).forEach(function (k) { if (k !== 'latent') v[k] = world[k]; });
    return v;
  };

  function cadenceOf(world, id) {
    var a = agentOf(world, id), def = registry[id];
    return (a && isNum(a.cadence) && a.cadence > 0) ? a.cadence : (def ? def.cadence['default'] : 24);
  }
  function phaseOf(id) { var def = registry[id]; return def ? (def.cadence.phase || 0) : 0; }
  function isDue(world, id, t) {
    var cad = cadenceOf(world, id), ph = phaseOf(id);
    return t >= ph && ((t - ph) % cad) === 0;
  }

  RT.statusOf = function (world, id) {
    var a = agentOf(world, id);
    if (!a) return null;
    var now = world.meta.tick;
    var state = a.autonomy === 'off' ? 'off' : (a.status === 'paused' ? 'paused' : (a.runRequested ? 'queued' : 'running'));
    var next = null;
    if (a.runRequested) next = now + 1;
    else if (state === 'running') {
      var cad = cadenceOf(world, id), ph = phaseOf(id), x = now + 1;
      if (x <= ph) next = ph;
      else { var r = (x - ph) % cad; next = r === 0 ? x : x + cad - r; }
    }
    var out = { state: state, lastRun: a.lastRunTick, nextRun: next, cadence: cadenceOf(world, id), phase: phaseOf(id) };
    if (a.aiAwait) { out.awaiting = true; out.runId = a.aiAwait; }
    return out;
  };

  /* ======================= guardrails ======================= */
  function evalGuards(world, p, def) {
    if (!(MC.guardrails && typeof MC.guardrails.evaluate === 'function')) return [];
    var ids = (def.guardrails || []).slice();
    BASE_GUARDS.forEach(function (g) { if (ids.indexOf(g) < 0) ids.push(g); });
    try { return MC.guardrails.evaluate(world, p, assign({}, def, { guardrails: ids })) || []; }
    catch (e) { report(e); return [{ id: 'error', label: 'Guardrail check', pass: false, blocking: true, detail: 'The guardrail check failed.' }]; }
  }
  function firstBlocking(list) {
    for (var i = 0; i < list.length; i++) if (list[i].blocking && !list[i].pass) return list[i];
    return null;
  }

  /* ======================= tmp ids ======================= */
  function subst(v, map) {
    if (typeof v === 'string') return map[v] !== undefined ? map[v] : v;
    if (Array.isArray(v)) return v.map(function (x) { return subst(x, map); });
    if (v && typeof v === 'object' && !U().isTyped(v)) {
      var o = {};
      Object.keys(v).forEach(function (k) { o[map[k] !== undefined ? map[k] : k] = subst(v[k], map); });
      return o;
    }
    return v;
  }
  function tmpIdOf(a) {
    var pl = (a && a.payload) || {};
    if (typeof pl.tmpId === 'string') return pl.tmpId;
    if (pl.segment && typeof pl.segment.tmpId === 'string' && a.type === 'segment/create') return pl.segment.tmpId;
    if (pl.variant && typeof pl.variant.tmpId === 'string') return pl.variant.tmpId;
    if (pl.campaign && typeof pl.campaign.tmpId === 'string') return pl.campaign.tmpId;
    return null;
  }

  /* ======================= apply / undo ======================= */
  function applyProposal(world, pid, origin, auto) {
    var p = prop(world, pid);
    if (!p) return { ok: false, error: 'That proposal no longer exists.' };
    var t = world.meta.tick, meta = { origin: origin || ('agent:' + p.agentId), tick: t };
    var map = {}, groups = [], inverse = [], touched = {}, created = [];
    var acts = p.actions || [];
    for (var k = 0; k < acts.length; k++) {
      var act = subst(acts[k], map);
      var r = MC.catalog.apply(world, act, meta);
      if (!r.ok) {
        for (var g = groups.length - 1; g >= 0; g--) {
          groups[g].forEach(function (inv) { var rr = MC.catalog.apply(world, inv, meta); if (!rr.ok) report(new Error('Revert failed: ' + rr.error)); });
        }
        var cur = prop(world, pid);
        close(world, cur, { status: 'stale', reason: 'No longer applies: ' + r.error, decidedTick: t });
        return { ok: false, error: r.error };
      }
      var tmp = tmpIdOf(act), made = r.created || [];
      if (tmp && made.length) {
        if (act.type === 'campaign/create' && act.payload.segment) map[tmp] = made[1];
        else map[tmp] = made[0];
      }
      if (act.type === 'campaign/create' && act.payload.segment && made.length) map['$1'] = made[0];
      groups.push(r.inverse || []);
      inverse = (r.inverse || []).concat(inverse);
      targetIds(world, [act], null).forEach(function (id) { touched[id] = true; });
      made.forEach(function (id) { if (entityById(world, id)) touched[id] = true; });
      created = created.concat(made);
    }
    var patch = { inverse: inverse, appliedTick: t, postVer: versOf(world, sortedKeys(touched)), created: created };
    if (p.kind === 'extend-campaign') {
      acts.forEach(function (a) { if (a.type === 'campaign/setEnd' && a.payload && isNum(a.payload.endTick)) patch.horizon = Math.max(1, a.payload.endTick - t); });
    }
    put(world, 'proposals', assign({}, prop(world, pid), patch));
    var imp = p.impact || {}, d = {};
    d[auto ? 'auto' : 'applied'] = 1;
    if (imp.unit === '$' && isNum(imp.delta)) d.expected = imp.delta;
    addStats(world, p.agentId, d);
    return { ok: true, created: created };
  }

  // Approve path (catalog proposal/approve sets the final status) — stats.applied.
  RT.apply = function (world, pid, origin) { return applyProposal(world, pid, origin, false); };

  RT.undoCheck = function (world, pid) {
    var p = prop(world, pid);
    if (!p) return { ok: false, reason: 'That change no longer exists.' };
    if (p.status !== 'applied' && p.status !== 'auto') return { ok: false, reason: 'Only applied changes can be undone.' };
    var pv = p.postVer || {}, ks = sortedKeys(pv);
    for (var i = 0; i < ks.length; i++) {
      var e = entityById(world, ks[i]);
      if (!e) return { ok: false, reason: 'Can’t undo: this ' + (ks[i].indexOf('s-') === 0 ? 'segment' : 'item') + ' no longer exists.' };
      if (e.ver !== pv[ks[i]]) {
        var by = e.updatedBy || 'user', who;
        if (by === 'user') who = 'You';
        else if (by.indexOf('agent:') === 0) { var d = registry[by.slice(6)]; who = d ? d.name : 'An agent'; }
        else who = 'The simulation';
        var at = isNum(e.updatedTick) ? MC.fmt.time(e.updatedTick) : 'a later time';
        return { ok: false, by: by, tick: e.updatedTick,
          reason: 'Can’t undo: ' + who + ' changed this ' + kindOf(world, ks[i]) + ' again at ' + at + '. Open the campaign to adjust.' };
      }
    }
    return { ok: true };
  };

  RT.expire = function (world, pid, reason, t) {
    var p = prop(world, pid);
    if (!p || p.status !== 'pending') return;
    close(world, p, { status: 'expired', reason: reason || 'Expired after 48 hours without a decision.', decidedTick: isNum(t) ? t : world.meta.tick });
    addStats(world, p.agentId, { expired: 1 });
  };

  function supersede(world, p, t, byId) {
    close(world, p, { status: 'superseded', reason: 'Replaced by a newer proposal.', decidedTick: t, supersededBy: byId });
    addStats(world, p.agentId, { superseded: 1 });
  }

  function expireDue(world, t) {
    var open = (world.proposals && world.proposals.open) || [];
    open.slice().forEach(function (pid) {
      var p = prop(world, pid);
      if (p && p.status === 'pending' && isNum(p.expiresTick) && p.expiresTick <= t) RT.expire(world, pid, 'Expired after 48 hours without a decision.', t);
    });
  }

  /* ======================= realized impact (§10.8) ======================= */
  function campDayOf(world, d, cid) {
    var e = world.metrics.days[T().dayIndex(d)];
    return e && e.c ? e.c[cid] : null;
  }
  function sumCells(world, cid, chs, from, to, key) {
    var out = new Float64Array(10);
    for (var d = from; d <= to; d++) {
      var cd = campDayOf(world, d, cid);
      if (!cd || !cd[key]) continue;
      chs.forEach(function (ch) { var f = cd[key][ch]; if (f) for (var j = 0; j < 10; j++) out[j] += f[j]; });
    }
    return out;
  }
  function campaignOf(world, p) {
    if (MC.sim && typeof MC.sim.campaignOfProposal === 'function') return MC.sim.campaignOfProposal(world, p);
    return p.target && p.target.kind === 'campaign' ? p.target.id : null;
  }
  function fallbackPrice(world, c) {
    var prods = (world.catalog && world.catalog.products) || [], s = 0;
    for (var i = 0; i < prods.length; i++) { if (prods[i].id === c.productFocus) return prods[i].price; s += prods[i].price || 0; }
    return prods.length ? s / prods.length : 100;
  }

  function realizeDid(world, p, c) {
    var f = F(), owned = MC.CH.OWNED;
    var ch = p.target && p.target.channel;
    var chs = ch && owned.indexOf(ch) >= 0 ? [ch] : c.channels.filter(function (x) { return owned.indexOf(x) >= 0; });
    var dA = T().dayOf(p.appliedTick), hd = Math.max(1, Math.round((p.horizon || 0) / 24));
    var startDay = T().dayOf(c.startTick);
    var preFrom = Math.max(startDay, dA - hd), preTo = dA - 1, postFrom = dA, postTo = dA + hd - 1;
    var Tpre = sumCells(world, c.id, chs, preFrom, preTo, 'trt'), Cpre = sumCells(world, c.id, chs, preFrom, preTo, 'ctl');
    var Tpost = sumCells(world, c.id, chs, postFrom, postTo, 'trt'), Cpost = sumCells(world, c.id, chs, postFrom, postTo, 'ctl');
    var clicksGoal = c.goal && (c.goal.type === 'engagement' || c.goal.type === 'launch');
    var all = sumCells(world, c.id, c.channels, T().DAY0, postTo, 'ch');
    var vpc = all[f.CLICK] > 0 && all[f.REV] > 0 ? all[f.REV] / all[f.CLICK] : 2;
    var price = fallbackPrice(world, c);
    function rate(x) { return x[f.SENT] > 0 ? (clicksGoal ? x[f.CLICK] * vpc : x[f.REV]) / x[f.SENT] : 0; }
    function vr(x) {
      var n = x[f.SENT];
      if (!(n > 0)) return 0;
      var k = clicksGoal ? x[f.CLICK] : x[f.CONV], cr = Math.min(1, k / n);
      var val = clicksGoal ? vpc : (x[f.CONV] > 0 ? x[f.REV] / x[f.CONV] : price);
      return val * val * cr * (1 - cr) / n;
    }
    var nT = Tpost[f.SENT], delta, v, method;
    if (!(nT > 0) || !(Cpost[f.SENT] > 0)) return { delta: 0, lo: 0, hi: 0, tick: world.meta.tick, method: 'diff' };
    if (Tpre[f.SENT] > 0 && Cpre[f.SENT] > 0) {
      delta = ((rate(Tpost) - rate(Tpre)) - (rate(Cpost) - rate(Cpre))) * nT;
      v = vr(Tpost) + vr(Tpre) + vr(Cpost) + vr(Cpre); method = 'did';
    } else {
      delta = (rate(Tpost) - rate(Cpost)) * nT;
      v = vr(Tpost) + vr(Cpost); method = 'diff';
    }
    var se = 1.28 * nT * Math.sqrt(v);
    return { delta: delta, lo: delta - se, hi: delta + se, tick: world.meta.tick, method: method };
  }

  function realizeModel(world, p, c) {
    var M = MC.models || {};
    if (typeof M.fitResponse !== 'function') return null;
    var f = F(), t = world.meta.tick, today = T().dayOf(t);
    var dA = T().dayOf(p.appliedTick), hd = Math.max(1, Math.round((p.horizon || 0) / 24));
    var act = (p.actions || []).filter(function (a) { return a.type === 'campaign/setBudget'; })[0];
    var inv = (p.inverse || []).filter(function (a) { return a.type === 'campaign/setBudget'; })[0];
    if (!act || !inv) return null;
    var nb = act.payload.byChannel || {}, ob = inv.payload.byChannel || {};
    var daysLeftA = Math.max(1, T().dayOf(c.endTick - 1) - dA + 1);
    var delta = 0, v = 0;
    sortedKeys(nb).forEach(function (ch) {
      var dT = (nb[ch] || 0) - (ob[ch] || 0);
      if (!dT) return;
      var pts = [], sp = 0, n = 0;
      for (var d = today - 20; d <= today; d++) {
        var cd = campDayOf(world, d, c.id), x = cd && cd.ch && cd.ch[ch];
        if (!x || !(x[f.COST] > 0)) continue;
        pts.push({ spend: x[f.COST], revenue: x[f.REV] }); sp += x[f.COST]; n++;
      }
      if (!n) return;
      var curve;
      try { curve = M.fitResponse(pts); } catch (e) { curve = null; }
      if (!curve) return;
      var R = typeof M.response === 'function' ? function (s) { return M.response(curve, s); }
        : function (s) { return curve.A * (1 - Math.exp(-s / curve.B)); };
      var oldDaily = sp / n, newDaily = Math.max(0, oldDaily + dT / daysLeftA);
      delta += (R(newDaily) - R(oldDaily)) * hd;
      v += (curve.sd || 0) * (curve.sd || 0);
    });
    var se = 1.28 * Math.sqrt(v) * Math.sqrt(hd);
    return { delta: delta, lo: delta - se, hi: delta + se, tick: t, method: 'model' };
  }

  function realizeWindow(world, p, c) {
    var act = (p.actions || []).filter(function (a) { return a.type === 'campaign/setEnd'; })[0];
    var inv = (p.inverse || []).filter(function (a) { return a.type === 'campaign/setEnd'; })[0];
    if (!act || !inv) return null;
    var from = T().dayOf(inv.payload.endTick), to = T().dayOf(act.payload.endTick - 1), rev = 0, k = F().REV;
    for (var d = from; d <= to; d++) { var cd = campDayOf(world, d, c.id); if (cd) rev += cd.tot[k]; }
    return { delta: rev, lo: rev, hi: rev, tick: world.meta.tick, method: 'window' };
  }

  function realizeOne(world, p) {
    var cid = campaignOf(world, p), c = cid && world.campaigns.byId[cid];
    if (!c) return null;
    if (DID_KINDS[p.kind]) return realizeDid(world, p, c);
    if (p.kind === 'budget-shift') return realizeModel(world, p, c);
    if (p.kind === 'extend-campaign') return realizeWindow(world, p, c);
    return null;
  }

  function realizeDue(world, t) {
    var P = world.proposals;
    if (!P) return;
    P.order.forEach(function (pid) {
      var p = P.byId[pid];
      if (!p || (p.status !== 'applied' && p.status !== 'auto') || p.realized || NOT_MEASURED[p.kind]) return;
      if (!(p.horizon > 0) || p.appliedTick + p.horizon !== t) return;
      var r = null;
      try { r = realizeOne(world, p); } catch (e) { report(e); r = null; }
      if (!r) return;
      put(world, 'proposals', assign({}, prop(world, pid), { realized: r }));
      if (p.impact && p.impact.unit === '$' && isNum(r.delta)) addStats(world, p.agentId, { realized: r.delta });
    });
  }
  RT.realize = realizeOne;

  /* ======================= one agent run (§10.9) ======================= */
  function cleanTrace(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      if (!s || out.length >= CAP.traceSteps) return;
      var st = { step: s.step || 'decide', text: String(s.text === undefined ? '' : s.text) };
      if (Array.isArray(s.rows)) st.rows = s.rows.slice(0, CAP.traceRows);
      out.push(st);
    });
    return out;
  }
  function entityOfAction(world, a) {
    var pl = (a && a.payload) || {};
    if (typeof pl.id === 'string') return pl.id;
    if (pl.variant && pl.variant.campaignId) return pl.variant.campaignId;
    if (typeof pl.campaignId === 'string') return pl.campaignId;
    if (pl.segment && pl.segment.name) return 'segment:new';
    return null;
  }
  function targetEnt(p) { return p.target && p.target.id ? { kind: p.target.kind, id: p.target.id } : undefined; }
  function toneOf(sev) { return sev === 'crit' ? 'crit' : (sev === 'warn' ? 'warn' : 'agent'); }
  function rank(r) { return RISK_RANK[r] === undefined ? 2 : RISK_RANK[r]; }

  RT.runAgent = function (world, id, t, reason) {
    var def = registry[id], a = agentOf(world, id);
    if (!def || !a) return null;
    if (!isNum(t)) t = world.meta.tick;
    reason = reason || 'schedule';
    var t0 = U().now();
    var view = RT.observeView(world);
    var ctx = { rng: MC.rng.fork(world.meta.seed, 'agent:' + id, t), tick: t, params: assign(defaultParams(def), a.params || {}),
      world: view, models: MC.models, copy: MC.copy, segments: MC.segments, util: MC.util, agentId: id, reason: reason };
    var obs = null, out = null, err = null;
    try { obs = typeof def.observe === 'function' ? def.observe(view, ctx) : {}; } catch (e) { err = e; }
    var inDigest = U().digest(obs === undefined ? null : obs);
    if (!err) { try { out = typeof def.decide === 'function' ? def.decide(obs, ctx) : null; } catch (e2) { err = e2; } }
    out = out || {};
    var trace = cleanTrace(out.trace);
    if (err) { report(err); trace.push({ step: 'decide', text: 'This run stopped early: ' + (err && err.message ? err.message : String(err)) + '. Nothing was changed.' }); }

    var mode = a.autonomy;
    if (reason === 'runNow' && (a.autonomy === 'off' || a.status === 'paused')) mode = 'suggest';
    var drafts = err ? [] : (Array.isArray(out.proposals) ? out.proposals : []);
    var insights = err ? [] : (Array.isArray(out.insights) ? out.insights : []);

    // §12.5: with the Haiku fleet on (a logged world fact), the run waits for its verdict.
    if (!err && aiActive(world, a)) return startAwait(world, def, id, t, reason, mode, inDigest, obs, drafts, insights, trace);
    return commitRun(world, { def: def, id: id, t: t, now: t, reason: reason, mode: mode, inDigest: inDigest, drafts: drafts,
      insights: insights, trace: trace, err: err, t0: t0, ai: null });
  };

  // Proposal creation, routing, insights, audit chain, stats and feed (§10.9 steps 4–9). `t` names the
  // run (ids, proposal tick, expiry); `now` is when the result lands (equal to t for rule-based runs).
  function commitRun(world, R) {
    var def = R.def, id = R.id, t = R.t, now = R.now, mode = R.mode, trace = R.trace, err = R.err, ai = R.ai;
    var view = RT.observeView(world);
    var maxRisk = rank(def.autopilotMaxRisk), minMat = def.materiality.min || 0;
    var created = [], autoIds = [], dispatched = [], gRows = [], aRows = [], k = 0;

    R.drafts.forEach(function (draft) {
      if (!draft || typeof draft.kind !== 'string') return;
      var key = MC.catalog.cooldownKey(draft);
      var imp = draft.impact || {};
      if (minMat > 0 && !(Math.abs(isNum(imp.delta) ? imp.delta : 0) >= minMat)) {
        gRows.push({ proposal: draft.title || draft.kind, result: 'Dropped: below the materiality threshold (' + minMat + ')' });
        return;
      }
      var cur = agentOf(world, id), cd = cur.cooldowns && cur.cooldowns[key];
      if (isNum(cd) && cd > now) { gRows.push({ proposal: draft.title || draft.kind, result: 'Skipped: cooling down until ' + MC.fmt.stamp(cd) }); return; }
      var actsDig = U().digest(draft.actions || []), same = [], dupe = false;
      ((world.proposals && world.proposals.open) || []).forEach(function (pid) {
        var op = prop(world, pid);
        if (!op || op.status !== 'pending' || MC.catalog.cooldownKey(op) !== key) return;
        if (U().digest(op.actions || []) === actsDig) dupe = true; else same.push(op);
      });
      if (dupe) { gRows.push({ proposal: draft.title || draft.kind, result: 'Unchanged: already waiting for review' }); return; }
      var pid = id + '-' + t + '-' + k;
      k++;
      same.forEach(function (op) { supersede(world, op, now, pid); });

      var ids = targetIds(world, draft.actions, draft.target);
      var p = {
        id: pid, agentId: id, tick: t, kind: draft.kind, target: draft.target || null, title: draft.title || draft.kind,
        rationale: draft.rationale || '', evidence: draft.evidence || [], impact: draft.impact || null,
        risk: draft.risk || (typeof def.risk === 'function' ? def.risk(draft, view) : 'low') || 'low',
        guardrails: [], actions: U().clone(draft.actions || []), inverse: null, diff: draft.diff || [],
        baseVer: versOf(world, ids), status: 'pending', reason: '', decidedTick: null, expiresTick: t + 48,
        realized: null, horizon: isNum(draft.horizon) ? draft.horizon : def.horizon, mustQueue: !!draft.mustQueue,
        appliedTick: null, postVer: null
      };
      if (ai) {
        p.ai = ai.mode;
        if (draft._why) p.why = draft._why;
        if (isNum(draft._confidence)) p.confidence = draft._confidence;
      }
      p.guardrails = evalGuards(world, p, def);
      var bf = firstBlocking(p.guardrails);
      gRows.push({ proposal: p.title, result: bf ? 'Blocked by ' + bf.label : 'All guardrails pass' });
      var P = world.proposals;
      world.proposals = assign({}, P, { order: [pid].concat(P.order) });
      put(world, 'proposals', p);

      var autoOk = mode === 'autopilot' && !p.mustQueue && !bf && rank(p.risk) <= maxRisk;
      var applied = false;
      if (autoOk) {
        var r = applyProposal(world, pid, 'agent:' + id, true);
        if (r.ok) {
          close(world, prop(world, pid), { status: 'auto', reason: 'Applied on Autopilot', decidedTick: now });
          autoIds.push(pid); applied = true;
          aRows.push({ proposal: p.title, result: 'Applied on Autopilot' });
        } else aRows.push({ proposal: p.title, result: 'Couldn’t apply: ' + r.error });
      } else {
        var why = mode === 'suggest' ? 'Suggested'
          : 'Needs you: ' + (bf ? bf.label : (p.mustQueue ? 'Always reviewed' : (p.risk === 'high' ? 'High risk' : 'Medium risk')));
        put(world, 'proposals', assign({}, prop(world, pid), { reason: why }));
        world.proposals = assign({}, world.proposals, { open: [pid].concat(world.proposals.open || []) });
        aRows.push({ proposal: p.title, result: why });
      }
      p.actions.forEach(function (act) {
        dispatched.push({ type: act.type, entity: entityOfAction(world, act), payloadDigest: U().digest(act.payload || {}), applied: applied, proposalId: pid });
      });
      created.push(pid);
    });
    if (gRows.length) trace.push({ step: 'guardrails', text: 'Checked ' + gRows.length + (gRows.length === 1 ? ' draft' : ' drafts') + ' against guardrails, cooldowns and open proposals.', rows: gRows.slice(0, CAP.traceRows) });
    if (aRows.length) trace.push({ step: 'apply', text: autoIds.length ? 'Applied ' + autoIds.length + ' on Autopilot.' : 'Queued for review.', rows: aRows.slice(0, CAP.traceRows) });

    /* insights */
    var createdIns = [], ki = 0, today = T().dayOf(now);
    R.insights.forEach(function (ins) {
      if (!ins || !ins.key) return;
      var exists = (world.insights || []).some(function (x) { return x.key === ins.key && T().dayOf(x.tick) === today; });
      if (exists || createdIns.some(function (x) { return x.key === ins.key; })) return;
      var item = { id: id + '-' + t + '-i' + ki, tick: now, agentId: id, kind: ins.kind || 'insight', title: ins.title || '',
        body: ins.body || '', severity: ins.severity || 'info', dismissed: false, key: ins.key };
      if (ins.entity) item.entity = ins.entity;
      ki++;
      var list = [item].concat(world.insights || []);
      world.insights = list.length > CAP.insights ? list.slice(0, CAP.insights) : list;
      addFeed(world, { tick: now, kind: item.kind === 'anomaly' ? 'anomaly' : 'insight', agentId: id, insightId: item.id,
        entity: item.entity, text: item.title, tone: toneOf(item.severity) });
      createdIns.push(item);
    });
    if (createdIns.length) trace.push({ step: 'decide', text: 'Published ' + createdIns.length + (createdIns.length === 1 ? ' insight.' : ' insights.') });

    /* audit chain */
    var outDigest = U().digest({ proposals: created.map(function (pid) { return prop(world, pid); }), insights: createdIns });
    var A = world.audit || { entries: [], head: '00000000' };
    var prev = A.head || '00000000';
    var chain = U().hex8(U().fnv1a(prev + '|' + R.inDigest + '|' + outDigest));
    var entry = { id: 'run-' + id + '-' + t, agentId: id, tick: t, reason: R.reason, mode: mode, inDigest: R.inDigest, outDigest: outDigest,
      prev: prev, chain: chain, proposals: created.slice(), insights: createdIns.map(function (x) { return x.id; }),
      dispatched: dispatched, trace: trace, error: err ? String(err && err.message ? err.message : err) : null, _ms: U().now() - R.t0,
      engine: ai && ai.mode === 'haiku' ? 'ai' : 'rules' };
    if (ai) {
      entry.ai = ai.mode; entry.landedTick = now;
      if (ai.model) entry.model = ai.model;
      if (isNum(ai.ms)) entry.aiMs = ai.ms;
      if (ai.summary) entry.summary = ai.summary;
      if (ai.why) entry.fallbackReason = ai.why;
    }
    var entries = [entry].concat(A.entries || []);
    if (entries.length > CAP.audit) entries = entries.slice(0, CAP.audit);
    world.audit = { entries: entries, head: chain };

    patchAgent(world, id, function (ag) {
      var s = assign({}, ag.stats); s.runs = (s.runs || 0) + 1; s.proposed = (s.proposed || 0) + created.length;
      var patch = { lastRunTick: t, runRequested: ai ? ag.runRequested : false, stats: s };
      if (ai) patch.aiAwait = null;
      return patch;
    });

    if (created.length) {
      var first = prop(world, autoIds[0] || created[0]), name = def.name, q = created.length - autoIds.length, text;
      if (created.length === 1) text = (autoIds.length ? name + ' applied: ' : name + ' suggests: ') + first.title;
      else if (autoIds.length) text = name + ' applied ' + autoIds.length + (autoIds.length === 1 ? ' change' : ' changes') + (q ? ' and has ' + q + ' waiting for you' : '');
      else text = name + ' has ' + q + ' suggestions waiting for you';
      if (ai && ai.mode === 'haiku' && ai.summary) text = ai.summary;
      addFeed(world, { tick: now, kind: autoIds.length ? 'agent-applied' : 'agent-proposed', agentId: id, proposalId: first.id,
        entity: targetEnt(first), text: text, tone: 'agent' });
    }
    return entry;
  }

  /* ======================= Haiku fleet integration (§12.5) ======================= */
  // Whether a run goes through the fleet. Reads only logged world facts (world.ai.on via ai/setEnabled,
  // agent.aiMode 'auto'|'rules' via agent/setAiMode; default auto), so live and replay take the same branch.
  function aiActive(world, a) {
    return !!(world.ai && world.ai.on && a && a.aiMode !== 'rules');
  }
  RT.aiActive = function (world, id) { return aiActive(world, agentOf(world, id)); };

  function isLive(world) {
    try { return !!(MC.store && typeof MC.store.getState === 'function' && MC.store.getState() === world); } catch (e) { return false; }
  }

  function startAwait(world, def, id, t, reason, mode, inDigest, obs, drafts, insights, trace) {
    var runId = 'run-' + id + '-' + t;
    var cands = [];
    drafts.forEach(function (d) { if (d && typeof d.kind === 'string') cands.push(U().clone(d)); });
    var job = { runId: runId, agentId: id, tick: t, reason: reason, mode: mode, inDigest: inDigest,
      drafts: cands, insights: U().clone(insights), trace: trace.slice() };
    var AI = world.ai || { on: true, pending: {} }, pend = assign({}, AI.pending || {});
    pend[runId] = job;
    world.ai = assign({}, AI, { pending: pend });
    patchAgent(world, id, function () { return { lastRunTick: t, runRequested: false, aiAwait: runId }; });
    // Only the live world talks to the fleet; replay waits for the logged agent/aiRun result instead.
    if (isLive(world) && MC.ai && MC.ai.fleet && typeof MC.ai.fleet.enqueue === 'function') {
      try {
        MC.ai.fleet.enqueue({ runId: runId, agentId: id, tick: t, obs: U().clone(obs === undefined ? null : obs), candidates: cands,
          insights: job.insights, trace: job.trace, mode: mode, reason: reason });
      } catch (e) { report(e); }
    }
    return { id: runId, agentId: id, tick: t, awaiting: true };
  }

  RT.awaiting = function (world) {
    var P = (world && world.ai && world.ai.pending) || {};
    return sortedKeys(P).map(function (k) { return P[k]; });
  };

  function str(x, max) { var s = typeof x === 'string' ? x : ''; return max && s.length > max ? s.slice(0, max) : s; }
  function entityKindOf(world, eid) {
    if (typeof eid !== 'string' || !eid) return null;
    if (world.campaigns && world.campaigns.byId[eid]) return 'campaign';
    if (world.variants && world.variants.byId[eid]) return 'variant';
    if (world.segments && world.segments.byId[eid]) return 'segment';
    return null;
  }

  // Validates the shape of an agent/aiRun payload against the pending run (catalog validate).
  RT.aiRunErr = function (world, p) {
    if (!p || typeof p.runId !== 'string') return 'Missing run.';
    var job = world.ai && world.ai.pending && world.ai.pending[p.runId];
    if (!job) return 'That agent run already finished.';
    if (p.agentId !== job.agentId) return 'That run belongs to another agent.';
    if (p.fallback) return null;
    if (!Array.isArray(p.decisions)) return 'Missing decisions.';
    return null;
  };

  // Reducer of agent/aiRun: completes an awaiting run with Haiku's (already validated) verdict, or with the
  // rule-based drafts when p.fallback is set. Deterministic over (world, payload).
  RT.resolveAiRun = function (world, p) {
    var job = world.ai && world.ai.pending && world.ai.pending[p.runId];
    var def = job && registry[job.agentId];
    if (!job || !def || !agentOf(world, job.agentId)) return null;
    var pend = assign({}, world.ai.pending);
    delete pend[p.runId];
    world.ai = assign({}, world.ai, { pending: pend });
    var now = world.meta.tick, trace = (job.trace || []).slice(), drafts, insights;
    var ai = { mode: p.fallback ? 'fallback' : 'haiku', model: str(p.model, 60) || null, ms: isNum(p.ms) ? Math.round(p.ms) : null,
      summary: p.fallback ? '' : str(p.summary, 240), why: p.fallback ? str(p.reason, 60) || 'unavailable' : '' };
    if (p.fallback) {
      drafts = job.drafts; insights = job.insights;
      trace.push({ step: 'decide', text: drafts.length ? 'Went with the standard playbook for this run.' : 'Nothing needed a decision this run.' });
    } else {
      var built = applyVerdict(world, def, job, p);
      drafts = built.drafts; insights = built.insights;
      trace.push({ step: 'decide', text: built.text, rows: built.rows.slice(0, CAP.traceRows) });
      if (ai.summary) trace.push({ step: 'decide', text: ai.summary });
    }
    return commitRun(world, { def: def, id: job.agentId, t: job.tick, now: now, reason: job.reason, mode: job.mode, inDigest: job.inDigest,
      drafts: drafts, insights: insights, trace: trace, err: null, t0: U().now(), ai: ai });
  };

  function applyVerdict(world, def, job, p) {
    var byCand = {}, rows = [], drafts = [], proposed = 0, skipped = 0, replaced = {};
    (p.decisions || []).forEach(function (d) { if (d && typeof d.candidate === 'string' && byCand[d.candidate] === undefined) byCand[d.candidate] = d; });
    (Array.isArray(p.extra) ? p.extra : []).forEach(function (x) { if (x && typeof x.replaces === 'string') replaced[x.replaces] = true; });
    job.drafts.forEach(function (cand, i) {
      var cid = 'c' + i, d = byCand[cid];
      if (!d || d.verdict !== 'propose') {
        skipped++;
        rows.push({ proposal: cand.title || cand.kind, result: 'Set aside' + (d && d.why ? ': ' + str(d.why, 300) : '') });
        return;
      }
      if (replaced[cid]) { rows.push({ proposal: cand.title || cand.kind, result: 'Rewritten (see below)' }); return; }
      var draft = U().clone(cand);
      if (d.adjust && typeof d.adjust === 'object' && MC.ai && MC.ai.fleet && typeof MC.ai.fleet.applyAdjust === 'function') {
        try { draft = MC.ai.fleet.applyAdjust(job.agentId, draft, d.adjust) || draft; } catch (e) { report(e); }
      }
      if (d.title) draft.title = str(d.title, 140);
      if (d.why) { draft._why = str(d.why, 600); draft.rationale = draft._why + (cand.rationale ? '\n\n' + cand.rationale : ''); }
      if (isNum(d.confidence)) draft._confidence = Math.max(0, Math.min(1, d.confidence));
      drafts.push(draft); proposed++;
      rows.push({ proposal: draft.title || draft.kind, result: 'Proposed' });
    });
    (Array.isArray(p.extra) ? p.extra : []).forEach(function (x) {
      if (!x || typeof x.kind !== 'string' || !Array.isArray(x.actions) || !x.actions.length) return;
      var okTypes = x.actions.every(function (a) { return a && def.emits.indexOf(a.type) >= 0; });
      if (!okTypes) { rows.push({ proposal: str(x.title, 140) || x.kind, result: 'Dropped: not a change this agent makes' }); return; }
      var base = null;
      if (typeof x.replaces === 'string' && /^c\d+$/.test(x.replaces)) base = job.drafts[+x.replaces.slice(1)] || null;
      var draft = base ? U().clone(base) : { kind: x.kind, target: x.target || null, evidence: [], impact: null, diff: [] };
      draft.kind = x.kind;
      if (x.target) draft.target = x.target;
      draft.actions = U().clone(x.actions);
      if (Array.isArray(x.diff)) draft.diff = U().clone(x.diff);
      if (x.risk === 'low' || x.risk === 'medium' || x.risk === 'high') draft.risk = x.risk;
      if (x.mustQueue) draft.mustQueue = true;
      if (isNum(x.horizon)) draft.horizon = x.horizon;
      draft.title = str(x.title, 140) || draft.title || x.kind;
      if (x.why) { draft._why = str(x.why, 600); draft.rationale = draft._why + (base && base.rationale ? '\n\n' + base.rationale : ''); }
      drafts.push(draft); proposed++;
      rows.push({ proposal: draft.title, result: base ? 'Proposed with new wording' : 'Proposed (original)' });
    });
    // Insights: refs i0..in rewrite the rule insights' words; new ones need a title and body.
    var ins = U().clone(job.insights || []), extraIns = [], day = T().dayOf(world.meta.tick);
    (Array.isArray(p.insights) ? p.insights : []).forEach(function (x) {
      if (!x || !str(x.title)) return;
      var sev = x.severity === 'crit' || x.severity === 'warn' ? x.severity : 'info';
      if (typeof x.ref === 'string' && /^i\d+$/.test(x.ref) && ins[+x.ref.slice(1)]) {
        var it = ins[+x.ref.slice(1)];
        it.title = str(x.title, 140); if (str(x.body)) it.body = str(x.body, 900);
        return;
      }
      if (!str(x.body)) return;
      var item = { kind: 'insight', title: str(x.title, 140), body: str(x.body, 900), severity: sev,
        key: 'ai|' + job.agentId + '|' + U().digest(str(x.title, 140)) + '|' + day };
      var ek = entityKindOf(world, x.entityId);
      if (ek) item.entity = { kind: ek, id: x.entityId };
      extraIns.push(item);
    });
    var n = job.drafts.length;
    var text = n ? 'Weighed ' + n + (n === 1 ? ' option' : ' options') + ': proposed ' + proposed + ', set aside ' + skipped + '.'
      : (proposed ? 'Proposed ' + proposed + (proposed === 1 ? ' original change.' : ' original changes.') : 'Nothing needed a change this run.');
    return { drafts: drafts, insights: ins.concat(extraIns.slice(0, 5)), rows: rows, text: text };
  }

  /* ======================= scheduling ======================= */
  // Engine step 8: expire, realize, then every due agent in def.order.
  RT.runDue = function (world, t) {
    if (!isNum(t)) t = world.meta.tick;
    expireDue(world, t);
    realizeDue(world, t);
    var ran = [];
    RT.defs().forEach(function (def) {
      var a = agentOf(world, def.id);
      if (!a) return;
      if (a.aiAwait) return;      // a run is waiting on its verdict (AI fleet only)
      if (a.runRequested) { RT.runAgent(world, def.id, t, 'runNow'); ran.push(def.id); return; }
      if (a.status === 'active' && a.autonomy !== 'off' && isDue(world, def.id, t)) { RT.runAgent(world, def.id, t, 'schedule'); ran.push(def.id); }
    });
    return ran;
  };

  // Pure preview (planner drafts): never mutates the world.
  RT.preview = function (agentId, input, world) {
    var def = registry[agentId];
    world = world || (MC.store && MC.store.getState && MC.store.getState());
    if (!def || typeof def.preview !== 'function' || !world) return { proposals: [], trace: [], plan: null };
    var a = agentOf(world, agentId);
    var ctx = { rng: MC.rng.fork(world.meta.seed, 'preview', agentId, world.meta.tick), tick: world.meta.tick,
      params: assign(defaultParams(def), (a && a.params) || {}), world: RT.observeView(world), models: MC.models,
      copy: MC.copy, segments: MC.segments, util: MC.util, agentId: agentId, input: input };
    var out = def.preview(input, ctx) || {};
    return { proposals: out.proposals || [], trace: out.trace || [], plan: out.plan || null };
  };
})();
