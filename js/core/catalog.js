/* Kestrel Marketing Cloud - MC.catalog: typed action catalog with validators, copy-on-write
   reducers and inverses. Every user change and every agent change goes through apply().
   Entity slices are copy-on-write; columnar data is mutated in place and followed by a rev bump. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var C = MC.catalog = MC.catalog || {};

  var assign = Object.assign;
  var defs = {};

  var GOALS = ['revenue', 'conversions', 'reactivation', 'engagement', 'launch'];
  var TONES = ['practical', 'adventurous', 'warm', 'urgent'];
  var OFFERS = ['none', 'freeship', 'pct15', 'pct25', 'gift'];
  var STATUSES = ['draft', 'scheduled', 'live', 'paused', 'completed'];
  var V_STATUSES = ['draft', 'live', 'paused', 'retired'];
  var FIELD_KEYS = ['subject', 'preheader', 'headline', 'body', 'cta', 'link', 'imageId', 'alt', 'sms',
    'pushTitle', 'pushBody', 'socialText', 'socialHeadline'];
  var STEP_TYPES = ['entry', 'send', 'wait', 'decide', 'exit'];
  var CADENCES = [1, 2, 3, 6, 12, 24, 48, 72, 168];

  C.GOALS = GOALS; C.TONES = TONES; C.OFFERS = OFFERS; C.FIELD_KEYS = FIELD_KEYS; C.CADENCES = CADENCES;
  C.GOAL_LABEL = { revenue: 'Revenue', conversions: 'Conversions', reactivation: 'Reactivation', engagement: 'Engagement', launch: 'Launch' };

  function CH() { return MC.CH; }
  function U() { return MC.util; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }

  /* ---------------- registry ---------------- */
  C.define = function (type, def) {
    def.type = type;
    def.by = def.by || ['user'];
    defs[type] = def;
    return def;
  };
  C.get = function (type) { return defs[type] || null; };
  C.types = function () { return Object.keys(defs).sort(); };

  function originAllowed(def, origin) {
    for (var i = 0; i < def.by.length; i++) {
      var b = def.by[i];
      if (b === origin) return true;
      if (b === 'agent:*' && origin.indexOf('agent:') === 0) return true;
    }
    return false;
  }
  C.originAllowed = function (type, origin) { var d = defs[type]; return !!d && originAllowed(d, origin); };

  function makeCtx(world, meta) {
    meta = meta || {};
    var origin = meta.origin || 'user';
    var tick = (meta.tick !== undefined && meta.tick !== null) ? meta.tick : world.meta.tick;
    return {
      origin: origin, tick: tick, user: origin === 'user',
      agent: origin.indexOf('agent:') === 0,
      agentId: origin.indexOf('agent:') === 0 ? origin.slice(6) : null,
      created: []
    };
  }

  /* ---------------- created-id placeholders in inverses ---------------- */
  var CREATED_RE = /^\$created:(\d+)$/;
  function substitute(v, created) {
    if (typeof v === 'string') {
      var m = CREATED_RE.exec(v);
      return m && created[+m[1]] !== undefined ? created[+m[1]] : v;
    }
    if (Array.isArray(v)) return v.map(function (x) { return substitute(x, created); });
    if (isObj(v) && !U().isTyped(v)) {
      var o = {};
      Object.keys(v).forEach(function (k) { o[substitute(k, created)] = substitute(v[k], created); });
      return o;
    }
    return v;
  }
  C.substituteCreated = function (actions, created) { return substitute(actions || [], created || []); };

  /* ---------------- apply / inverse / reduce ---------------- */
  // apply(world, action, meta{origin, tick}) -> { ok, error?, created?, inverse? }
  C.apply = function (world, action, meta) {
    if (!world || !action || typeof action.type !== 'string') return { ok: false, error: 'Malformed action.' };
    var def = defs[action.type];
    if (!def) return { ok: false, error: 'Unknown action type ' + action.type + '.' };
    var ctx = makeCtx(world, meta);
    if (!originAllowed(def, ctx.origin)) {
      return { ok: false, error: 'This change can’t be made by ' + (ctx.agent ? agentName(ctx.agentId) : ctx.origin) + '.' };
    }
    var p = action.payload || {};
    var err = def.validate ? def.validate(world, p, ctx) : null;
    if (err) return { ok: false, error: err };
    var inv = def.inverse ? (def.inverse(world, p, ctx) || []) : [];
    var res = def.reduce(world, p, ctx);
    if (typeof res === 'string') return { ok: false, error: res };
    return { ok: true, created: ctx.created.slice(), inverse: substitute(inv, ctx.created) };
  };

  // inverse(world, action, meta?) -> action[] (computed against the world BEFORE apply;
  // ids of entities the action will create appear as '$created:k').
  C.inverse = function (world, action, meta) {
    var def = action && defs[action.type];
    if (!def || !def.inverse) return [];
    var ctx = makeCtx(world, meta || { origin: 'user' });
    return def.inverse(world, action.payload || {}, ctx) || [];
  };

  // Legacy §3 form: applies and returns the world.
  C.reduce = function (world, action, meta) { C.apply(world, action, meta); return world; };

  C.describe = function (world, action) {
    var def = action && defs[action.type];
    if (!def || !def.describe) return action ? action.type : '';
    try { return def.describe(world, action.payload || {}); } catch (e) { return action.type; }
  };

  // User path: origin 'user', tick = world.meta.tick; appends the log entry and a 'user' feed item.
  C.dispatchUser = function (world, action) {
    if (!world || !action || typeof action.type !== 'string') return { ok: false, error: 'Malformed action.' };
    var def = defs[action.type];
    if (!def) return { ok: false, error: 'Unknown action type ' + action.type + '.' };
    var p = action.payload || {};
    if (isObj(p) && (p.restoreId !== undefined || p.restoreVariants !== undefined)) {
      return { ok: false, error: 'That field is reserved for undo.' };
    }
    var payload = U().clone(p);
    var tick = world.meta.tick;
    var text = null;
    if (def.describe) { try { text = def.describe(world, payload); } catch (e) { text = null; } }
    var r = C.apply(world, { type: action.type, payload: payload }, { origin: 'user', tick: tick });
    if (!r.ok) return { ok: false, error: r.error };
    world.log = (world.log || []).concat([{ seq: (world.log || []).length + 1, tick: tick, type: action.type, payload: payload }]);
    var silent = action.type.indexOf('proposal/') === 0 || action.type === 'insight/dismiss';
    if (!silent) {
      var ent = def.entity ? def.entity(payload, r.created) : null;
      addFeed(world, { tick: tick, kind: 'user', entity: ent || undefined, text: text || action.type, tone: 'neutral' });
    }
    return { ok: true, created: r.created };
  };

  /* ---------------- copy-on-write helpers ---------------- */
  function stamp(ent, ctx, patch) {
    return assign({}, ent, patch || {}, { ver: (ent.ver || 0) + 1, updatedBy: ctx.origin, updatedTick: ctx.tick });
  }
  function putIn(world, slice, ent) {
    var s = world[slice];
    var byId = assign({}, s.byId);
    byId[ent.id] = ent;
    world[slice] = assign({}, s, { byId: byId });
  }
  function putCampaign(world, c) { putIn(world, 'campaigns', c); }
  function putVariant(world, v) { putIn(world, 'variants', v); }
  function putSegment(world, s) { putIn(world, 'segments', s); }
  function putProposal(world, p) { putIn(world, 'proposals', p); }
  function putAgent(world, a) { putIn(world, 'agents', a); }

  function nextSeq(world) { world.seq = (world.seq || 0) + 1; return world.seq; }

  function addFeed(world, item) {
    var it = assign({ id: 'f-' + nextSeq(world) }, item);
    if (it.entity === undefined) delete it.entity;
    var f = [it].concat(world.feed || []);
    if (f.length > 400) f = f.slice(0, 400);
    world.feed = f;
    return it;
  }
  C.addFeed = addFeed;

  function agentDef(id) {
    try { return (MC.runtime && typeof MC.runtime.def === 'function') ? MC.runtime.def(id) : null; } catch (e) { return null; }
  }
  function agentName(id) { var d = agentDef(id); return (d && d.name) || id; }
  C.agentName = agentName;

  function camp(world, id) { return world.campaigns && world.campaigns.byId[id]; }
  function variant(world, id) { return world.variants && world.variants.byId[id]; }
  function segment(world, id) { return world.segments && world.segments.byId[id]; }
  function cname(world, id) { var c = camp(world, id); return c ? c.name : id; }
  function sname(world, id) { var s = segment(world, id); return s ? s.name : id; }
  function chLabel(ch) { return (CH().LABEL[ch] || ch); }

  // Common campaign validation: exists; agents never touch drafts; completed campaigns are read-only.
  function campErr(world, id, ctx, opts) {
    var c = camp(world, id);
    if (!c) return 'That campaign no longer exists.';
    opts = opts || {};
    if (ctx.agent && c.status === 'draft' && !opts.allowDraftForAgent) return 'Agents never change draft campaigns.';
    if (c.status === 'completed' && !opts.allowCompleted) return 'Completed campaigns can’t be changed.';
    return null;
  }

  function variantsOf(world, cid, ch) {
    var out = [];
    var byId = world.variants.byId;
    var ids = sortedKeys(byId);
    for (var i = 0; i < ids.length; i++) {
      var v = byId[ids[i]];
      if (v.campaignId === cid && (!ch || v.channel === ch)) out.push(v);
    }
    return out;
  }
  C.variantsOf = variantsOf;

  function allocSum(a) { var s = 0; sortedKeys(a).forEach(function (k) { s += a[k] > 0 ? a[k] : 0; }); return s; }

  function feedEntity(kind, id) { return id ? { kind: kind, id: id } : null; }

  // Exposed for sibling core files (runtime) that need identical semantics.
  C._h = { stamp: stamp, putIn: putIn, nextSeq: nextSeq, camp: camp, variant: variant, segment: segment, variantsOf: variantsOf };

  /* ---------------- builders shared by create / applyPlan ---------------- */
  function scoreVariant(v) {
    try {
      if (MC.copy && typeof MC.copy.score === 'function') {
        var s = MC.copy.score(v);
        return { score: s.score, open: s.predOpen, click: s.predClick };
      }
    } catch (e) { /* fall through */ }
    return { score: 50, open: 0, click: 0 };
  }
  function setLatent(world, v) {
    if (!(MC.sim && typeof MC.sim.latentFor === 'function')) return;
    if (!world.latent) world.latent = { profiles: {}, variants: {}, curves: {} };
    if (!world.latent.variants) world.latent.variants = {};
    world.latent.variants[v.id] = MC.sim.latentFor(world, v);
  }
  function drawCurves(world, c) {
    if (!(MC.sim && typeof MC.sim.curvesFor === 'function')) return;
    var r = MC.sim.curvesFor(world, c);
    if (r && typeof r === 'object') {
      if (!world.latent) world.latent = { profiles: {}, variants: {}, curves: {} };
      if (!world.latent.curves) world.latent.curves = {};
      sortedKeys(r).forEach(function (k) { world.latent.curves[k] = r[k]; });
    }
  }
  function defaultSteps(goalType, channels) {
    if (MC.data && typeof MC.data.journeyTemplate === 'function') return MC.data.journeyTemplate(goalType, channels);
    return [{ id: 's1', type: 'entry', label: 'Entry', next: 's2' }, { id: 's2', type: 'exit', label: 'Exit' }];
  }

  function stepsErr(steps) {
    if (!Array.isArray(steps) || steps.length < 2) return 'A journey needs at least an entry and an exit step.';
    var ids = {}, entries = 0, i, s;
    for (i = 0; i < steps.length; i++) {
      s = steps[i];
      if (!s || typeof s.id !== 'string' || !s.id) return 'Every journey step needs an id.';
      if (ids[s.id]) return 'Step ids must be unique (' + s.id + ').';
      ids[s.id] = true;
      if (STEP_TYPES.indexOf(s.type) < 0) return 'Unknown step type on ' + s.id + '.';
      if (s.type === 'entry') entries++;
      if (s.type === 'send' && CH().ALL.indexOf(s.channel) < 0) return 'Send step ' + s.id + ' needs a channel.';
      if (s.type === 'wait' && !(isInt(s.waitH) && s.waitH >= 1 && s.waitH <= 720)) return 'Wait step ' + s.id + ' needs 1–720 hours.';
    }
    if (entries !== 1) return 'A journey needs exactly one entry step.';
    for (i = 0; i < steps.length; i++) {
      s = steps[i];
      var refs = [s.next, s.yes, s.no];
      if (isObj(s.branches)) sortedKeys(s.branches).forEach(function (k) { refs.push(s.branches[k]); });
      for (var j = 0; j < refs.length; j++) {
        if (refs[j] !== undefined && refs[j] !== null && !ids[refs[j]]) return 'Step ' + s.id + ' points to a missing step.';
      }
    }
    return null;
  }
  C.stepsErr = stepsErr;

  function specErr(world, src) {
    if (!isObj(src)) return 'Missing campaign details.';
    if (typeof src.name !== 'string' || !src.name.trim()) return 'Give the campaign a name.';
    if (src.name.length > 80) return 'Campaign names are limited to 80 characters.';
    if (!isObj(src.goal) || GOALS.indexOf(src.goal.type) < 0) return 'Pick a goal.';
    if (!(isNum(src.goal.target) && src.goal.target > 0)) return 'The goal target must be above zero.';
    if (!Array.isArray(src.channels) || !src.channels.length) return 'Pick at least one channel.';
    for (var i = 0; i < src.channels.length; i++) if (CH().ALL.indexOf(src.channels[i]) < 0) return 'Unknown channel ' + src.channels[i] + '.';
    if (!isInt(src.startTick) || !isInt(src.endTick) || src.endTick <= src.startTick) return 'The end date must come after the start date.';
    if (src.tone !== undefined && src.tone !== null && TONES.indexOf(src.tone) < 0) return 'Unknown tone.';
    if (src.offer !== undefined && src.offer !== null && OFFERS.indexOf(src.offer) < 0) return 'Unknown offer.';
    if (src.budget && src.budget.byChannel) {
      var by = src.budget.byChannel, ks = sortedKeys(by);
      for (var k = 0; k < ks.length; k++) if (!(isNum(by[ks[k]]) && by[ks[k]] >= 0)) return 'Budgets must be zero or more.';
    }
    if (src.journey && src.journey.steps) { var se = stepsErr(src.journey.steps); if (se) return se; }
    return null;
  }

  function segSpecErr(world, s) {
    if (!isObj(s)) return 'Missing segment details.';
    if (typeof s.name !== 'string' || !s.name.trim()) return 'Give the segment a name.';
    if (s.name.length > 60) return 'Segment names are limited to 60 characters.';
    if (!isObj(s.rule) || (s.rule.op !== 'all' && s.rule.op !== 'any') || !Array.isArray(s.rule.items)) return 'The segment rule is incomplete.';
    if (MC.segments && typeof MC.segments.validate === 'function') {
      var errs = MC.segments.validate(s.rule) || [];
      if (errs.length) return errs[0];
    }
    return null;
  }

  function countRule(world, rule) {
    try {
      if (MC.segments && typeof MC.segments.evaluate === 'function') return MC.segments.evaluate(world, rule).count;
    } catch (e) { /* uncountable rule */ }
    return 0;
  }

  function createSegmentEntity(world, s, ctx, restoreId) {
    var id = restoreId || ('s-' + nextSeq(world));
    var day = Math.floor(ctx.tick / 24);
    var count = countRule(world, s.rule);
    var seg = restoreId ? assign({}, U().clone(s), {
      id: id, ver: (s.ver || 0) + 1, count: count, countDay: day, updatedBy: ctx.origin, updatedTick: ctx.tick
    }) : {
      id: id, name: s.name.trim(), rule: U().clone(s.rule), author: ctx.user ? 'user' : ctx.origin,
      createdTick: ctx.tick, ver: 1, count: count, countDay: day, countHist: [count],
      updatedBy: ctx.origin, updatedTick: ctx.tick
    };
    putSegment(world, seg);
    if (world.segments.order.indexOf(id) < 0) world.segments = assign({}, world.segments, { order: world.segments.order.concat([id]) });
    U().bump(world, 'segCounts');
    return id;
  }

  function mapId(map, x) { return (typeof x === 'string' && map[x] !== undefined) ? map[x] : x; }

  function buildCampaign(world, src, cid, map, ctx, restore, base) {
    var channels = [];
    src.channels.forEach(function (ch) { if (channels.indexOf(ch) < 0) channels.push(ch); });
    var owned = channels.filter(function (ch) { return CH().OWNED.indexOf(ch) >= 0; });
    var sendHour = {};
    owned.forEach(function (ch) {
      var h = src.sendHour && src.sendHour[ch];
      sendHour[ch] = (h === 'adaptive' || (isInt(h) && h >= 0 && h <= 23)) ? h : 10;
    });
    var byChannel = {}, total = 0;
    channels.forEach(function (ch) {
      var b = src.budget && src.budget.byChannel && src.budget.byChannel[ch];
      byChannel[ch] = isNum(b) && b > 0 ? b : 0; total += byChannel[ch];
    });
    var alloc = {};
    if (isObj(src.alloc)) {
      sortedKeys(src.alloc).forEach(function (ch) {
        if (channels.indexOf(ch) < 0) return;
        var a = {};
        sortedKeys(src.alloc[ch]).forEach(function (k) { a[mapId(map, k)] = src.alloc[ch][k]; });
        alloc[ch] = a;
      });
    }
    var paused = {};
    if (isObj(src.channelPaused)) sortedKeys(src.channelPaused).forEach(function (ch) { if (src.channelPaused[ch]) paused[ch] = true; });
    var goal = { type: src.goal.type, target: src.goal.target };
    var c = {
      id: cid, name: src.name.trim(),
      status: restore ? src.status : 'draft',
      ver: restore ? (src.ver || 0) + 1 : (base ? (base.ver || 0) + 1 : 1),
      goal: goal, startTick: src.startTick, endTick: src.endTick,
      segmentId: src.segmentId ? mapId(map, src.segmentId) : null,
      suppress: (src.suppress || []).map(function (x) { return mapId(map, x); }),
      include: (src.include || []).map(function (x) { return mapId(map, x); }),
      channels: channels,
      productFocus: src.productFocus || null,
      tone: src.tone || 'practical', offer: src.offer || 'none',
      budget: { total: total, byChannel: byChannel },
      alloc: alloc, sendHour: sendHour, channelPaused: paused,
      journey: { steps: (src.journey && src.journey.steps) ? U().clone(src.journey.steps) : defaultSteps(goal.type, channels) },
      holdoutPct: restore ? src.holdoutPct : (base ? base.holdoutPct : world.guardrails.holdoutPct),
      createdBy: restore ? src.createdBy : (base ? base.createdBy : (ctx.user ? 'user' : ctx.origin)),
      brief: src.brief !== undefined ? U().clone(src.brief) : (base ? base.brief : null),
      createdTick: restore ? src.createdTick : (base ? base.createdTick : ctx.tick),
      eventDay: (src.eventDay === undefined || src.eventDay === null) ? null : src.eventDay,
      updatedBy: ctx.origin, updatedTick: ctx.tick
    };
    c.ctl = (restore && src.ctl) ? U().clone(src.ctl) : { alloc: U().clone(alloc), sendHour: U().clone(sendHour), channelPaused: U().clone(paused) };
    return c;
  }

  function nextLetter(used) {
    for (var i = 0; i < 26; i++) { var L = String.fromCharCode(65 + i); if (!used[L]) return L; }
    return 'Z' + Object.keys(used).length;
  }

  function buildVariant(world, v, c, vid, ctx, restore, used) {
    if (restore) {
      var r = assign({}, U().clone(v), { id: vid, campaignId: c.id, ver: (v.ver || 0) + 1, updatedBy: ctx.origin, updatedTick: ctx.tick });
      used[v.channel + ':' + r.name] = true;
      return r;
    }
    var key = function (n) { return v.channel + ':' + n; };
    var letters = {};
    Object.keys(used).forEach(function (k) { if (k.indexOf(v.channel + ':') === 0) letters[k.slice(v.channel.length + 1)] = true; });
    var name = (typeof v.name === 'string' && v.name && !letters[v.name]) ? v.name : nextLetter(letters);
    used[key(name)] = true;
    var fields = {};
    FIELD_KEYS.forEach(function (k) { if (v.fields && v.fields[k] !== undefined && v.fields[k] !== null) fields[k] = String(v.fields[k]); });
    var status = V_STATUSES.indexOf(v.status) >= 0 ? v.status : (c.status === 'draft' ? 'draft' : 'live');
    var out = {
      id: vid, campaignId: c.id, channel: v.channel, name: name, status: status, ctlStatus: status, ver: 1,
      author: ctx.user ? 'user' : ctx.origin, fields: fields,
      tone: v.tone || c.tone, offer: v.offer || c.offer,
      productId: v.productId !== undefined ? v.productId : c.productFocus,
      createdTick: ctx.tick, updatedBy: ctx.origin, updatedTick: ctx.tick
    };
    out.predicted = (v.predicted && isNum(v.predicted.score)) ? { score: v.predicted.score, open: v.predicted.open, click: v.predicted.click } : scoreVariant(out);
    return out;
  }

  function variantsErr(world, list, channels) {
    if (list === undefined) return null;
    if (!Array.isArray(list)) return 'Variants must be a list.';
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!isObj(v) || channels.indexOf(v.channel) < 0) return 'Each variant needs one of the campaign’s channels.';
      if (v.fields !== undefined && !isObj(v.fields)) return 'Variant fields must be an object.';
    }
    return null;
  }

  // Equal shares for any channel that has variants but no allocation yet.
  function fillAlloc(c, vs) {
    var alloc = assign({}, c.alloc);
    c.channels.forEach(function (ch) {
      var mine = vs.filter(function (v) { return v.channel === ch && v.status !== 'retired' && v.status !== 'paused'; });
      if (!mine.length) return;
      if (alloc[ch] && allocSum(alloc[ch]) > 0) return;
      var a = {};
      mine.forEach(function (v) { a[v.id] = 1 / mine.length; });
      alloc[ch] = a;
    });
    return alloc;
  }

  /* ================= campaign actions ================= */
  function writeNewCampaign(world, c, vs) {
    c.alloc = fillAlloc(c, vs);
    if (!c.ctl || !c.ctl.alloc || !sortedKeys(c.ctl.alloc).length) c.ctl = assign({}, c.ctl, { alloc: U().clone(c.alloc) });
    putCampaign(world, c);
    var cs = world.campaigns;
    var patch = {};
    if (cs.order.indexOf(c.id) < 0) patch.order = cs.order.concat([c.id]);
    var all = cs.all || cs.order;
    if (all.indexOf(c.id) < 0) patch.all = all.concat([c.id]);
    else if (!cs.all) patch.all = all.slice();
    world.campaigns = assign({}, world.campaigns, patch);
    vs.forEach(function (v) { putVariant(world, v); setLatent(world, v); });
    drawCurves(world, c);
  }

  C.define('campaign/create', {
    by: ['user', 'agent:planner'],
    label: 'Create campaign',
    entity: function (p, created) { return feedEntity('campaign', created && created[p.segment ? 1 : 0]); },
    validate: function (world, p, ctx) {
      if (p.restoreId !== undefined && (typeof p.restoreId !== 'string' || camp(world, p.restoreId))) return 'That campaign already exists.';
      var e = specErr(world, p.campaign); if (e) return e;
      if (p.segment) { e = segSpecErr(world, p.segment); if (e) return e; }
      else if (p.campaign.segmentId && !segment(world, p.campaign.segmentId)) return 'Pick an audience segment that exists.';
      return variantsErr(world, p.variants, p.campaign.channels);
    },
    reduce: function (world, p, ctx) {
      var restore = typeof p.restoreId === 'string';
      var map = {};
      if (p.segment) {
        var sid = createSegmentEntity(world, p.segment, ctx, null);
        map['$1'] = sid; if (p.segment.tmpId) map[p.segment.tmpId] = sid;
        ctx.created.push(sid);
      }
      var cid = restore ? p.restoreId : 'c-' + nextSeq(world);
      ctx.created.push(cid);
      var list = p.variants || [];
      var vids = list.map(function (v, k) {
        var id = (restore && v.id) ? v.id : 'v-' + nextSeq(world);
        map[v.tmpId || ('$v' + k)] = id;
        if (v.tmpId) map['$v' + k] = id;
        ctx.created.push(id);
        return id;
      });
      var c = buildCampaign(world, p.campaign, cid, map, ctx, restore, null);
      var used = {};
      var vs = list.map(function (v, k) { return buildVariant(world, v, c, vids[k], ctx, restore, used); });
      writeNewCampaign(world, c, vs);
    },
    inverse: function (world, p) {
      var k = p.segment ? 1 : 0;
      var inv = [{ type: 'campaign/remove', payload: { id: '$created:' + k } }];
      if (p.segment) inv.push({ type: 'segment/remove', payload: { id: '$created:0' } });
      return inv;
    },
    describe: function (world, p) { return 'You created the draft “' + (p.campaign && p.campaign.name) + '”'; }
  });

  C.define('campaign/remove', {
    by: ['user', 'agent:planner'],
    label: 'Delete draft campaign',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var c = camp(world, p.id);
      if (!c) return 'That campaign no longer exists.';
      if (c.status !== 'draft') return 'Only draft campaigns can be deleted.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var cs = world.campaigns;
      var byId = assign({}, cs.byId); delete byId[p.id];
      world.campaigns = assign({}, cs, { byId: byId, order: cs.order.filter(function (x) { return x !== p.id; }) });
      var vs = variantsOf(world, p.id);
      if (vs.length) {
        var vb = assign({}, world.variants.byId);
        vs.forEach(function (v) { delete vb[v.id]; });
        world.variants = assign({}, world.variants, { byId: vb });
      }
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      if (!c) return [];
      return [{ type: 'campaign/create', payload: { campaign: U().clone(c), variants: variantsOf(world, p.id).map(U().clone), restoreId: p.id } }];
    },
    describe: function (world, p) { return 'You deleted the draft “' + cname(world, p.id) + '”'; }
  });

  var UPDATE_KEYS = ['name', 'goal', 'startTick', 'endTick', 'tone', 'offer', 'productFocus', 'brief', 'eventDay'];
  C.define('campaign/update', {
    by: ['user'],
    label: 'Edit campaign',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var c = camp(world, p.id);
      if (!c) return 'That campaign no longer exists.';
      if (!isObj(p.patch) || !Object.keys(p.patch).length) return 'Nothing to change.';
      var ks = Object.keys(p.patch);
      for (var i = 0; i < ks.length; i++) if (UPDATE_KEYS.indexOf(ks[i]) < 0) return 'Field ' + ks[i] + ' can’t be edited here.';
      var pt = p.patch;
      var early = c.status === 'draft' || c.status === 'scheduled';
      if (c.status === 'completed' && ks.some(function (k) { return k !== 'name' && k !== 'brief'; })) return 'Completed campaigns only allow name and brief edits.';
      if (pt.name !== undefined && (typeof pt.name !== 'string' || !pt.name.trim() || pt.name.length > 80)) return 'Names need 1–80 characters.';
      if (pt.goal !== undefined && (!isObj(pt.goal) || GOALS.indexOf(pt.goal.type) < 0 || !(isNum(pt.goal.target) && pt.goal.target > 0))) return 'Pick a goal with a target above zero.';
      if (pt.goal !== undefined && !early && pt.goal.type !== c.goal.type) return 'The goal type is fixed once a campaign is live.';
      if (pt.startTick !== undefined && (!isInt(pt.startTick) || !early)) return 'The start date can only change before launch.';
      if (pt.endTick !== undefined && !isInt(pt.endTick)) return 'Pick a valid end date.';
      var st = pt.startTick !== undefined ? pt.startTick : c.startTick;
      var en = pt.endTick !== undefined ? pt.endTick : c.endTick;
      if (en <= st) return 'The end date must come after the start date.';
      if (pt.endTick !== undefined && !early && en <= ctx.tick) return 'The end date must be in the future.';
      if (pt.tone !== undefined && TONES.indexOf(pt.tone) < 0) return 'Unknown tone.';
      if (pt.offer !== undefined && OFFERS.indexOf(pt.offer) < 0) return 'Unknown offer.';
      if (pt.eventDay !== undefined && pt.eventDay !== null && !isInt(pt.eventDay)) return 'Invalid event day.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var patch = U().clone(p.patch);
      if (patch.name) patch.name = patch.name.trim();
      putCampaign(world, stamp(c, ctx, patch));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      if (!c || !isObj(p.patch)) return [];
      var prior = {};
      Object.keys(p.patch).sort().forEach(function (k) { prior[k] = U().clone(c[k] === undefined ? null : c[k]); });
      return [{ type: 'campaign/update', payload: { id: p.id, patch: prior } }];
    },
    describe: function (world, p) { return 'You edited “' + cname(world, p.id) + '”'; }
  });

  var TRANSITIONS = {
    'draft>scheduled': ['user'], 'scheduled>draft': ['user'], 'scheduled>live': ['sim'],
    'live>paused': ['user'], 'paused>live': ['user'], 'live>completed': ['user', 'sim'], 'paused>completed': ['user', 'sim']
  };

  function setVariantStatuses(world, cid, from, to, ctx) {
    variantsOf(world, cid).forEach(function (v) {
      if (v.status === from) putVariant(world, stamp(v, ctx, { status: to, ctlStatus: v.ctlStatus === from ? to : v.ctlStatus }));
    });
  }

  C.define('campaign/setStatus', {
    by: ['user', 'sim'],
    label: 'Change campaign status',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var c = camp(world, p.id);
      if (!c) return 'That campaign no longer exists.';
      if (STATUSES.indexOf(p.status) < 0) return 'Unknown status.';
      var allowed = TRANSITIONS[c.status + '>' + p.status];
      if (!allowed || allowed.indexOf(ctx.origin) < 0) return 'A ' + c.status + ' campaign can’t move to ' + p.status + '.';
      if (c.status === 'scheduled' && p.status === 'live' && c.startTick > ctx.tick) return 'This campaign hasn’t reached its start time.';
      if (c.status === 'draft' && p.status === 'scheduled' && MC.guardrails && typeof MC.guardrails.preflight === 'function') {
        var fails = (MC.guardrails.preflight(world, c) || []).filter(function (x) { return x.status === 'fail'; });
        if (fails.length) return 'Fix before scheduling: ' + fails.map(function (x) { return x.label; }).join(', ') + '.';
      }
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var from = c.status;
      putCampaign(world, stamp(c, ctx, { status: p.status }));
      if (from === 'draft' && p.status === 'scheduled') setVariantStatuses(world, p.id, 'draft', 'live', ctx);
      if (from === 'scheduled' && p.status === 'draft') setVariantStatuses(world, p.id, 'live', 'draft', ctx);
      if (from === 'scheduled' && p.status === 'live' && MC.sim && typeof MC.sim.enroll === 'function') {
        MC.sim.enroll(world, p.id, ctx.tick);
      }
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c ? [{ type: 'campaign/setStatus', payload: { id: p.id, status: c.status } }] : [];
    },
    describe: function (world, p) {
      var c = camp(world, p.id), n = '“' + (c ? c.name : p.id) + '”';
      if (p.status === 'scheduled') return 'You scheduled ' + n;
      if (p.status === 'draft') return 'You moved ' + n + ' back to draft';
      if (p.status === 'paused') return 'You paused ' + n;
      if (p.status === 'live') return 'You resumed ' + n;
      if (p.status === 'completed') return 'You ended ' + n;
      return 'You changed the status of ' + n;
    }
  });

  C.define('campaign/setSegment', {
    by: ['user'],
    label: 'Change audience',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      if (!segment(world, p.segmentId)) return 'Pick a segment that exists.';
      return null;
    },
    reduce: function (world, p, ctx) { putCampaign(world, stamp(camp(world, p.id), ctx, { segmentId: p.segmentId })); },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c && c.segmentId ? [{ type: 'campaign/setSegment', payload: { id: p.id, segmentId: c.segmentId } }] : [];
    },
    describe: function (world, p) { return 'You changed the audience of “' + cname(world, p.id) + '” to ' + sname(world, p.segmentId); }
  });

  C.define('campaign/setJourney', {
    by: ['user'],
    label: 'Save journey',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      return stepsErr(p.steps);
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var steps = U().clone(p.steps);
      // Keep enrolled people on the same step id; anyone on a deleted step exits.
      var en = world.enroll && world.enroll[p.id];
      if (en && en.step) {
        var old = c.journey.steps, idx = {};
        steps.forEach(function (s, i) { idx[s.id] = i; });
        for (var i = 0; i < en.step.length; i++) {
          var s = en.step[i];
          if (s < 0) continue;
          var ni = old[s] ? idx[old[s].id] : undefined;
          if (ni === undefined) { en.step[i] = -2; en.exited = (en.exited || 0) + 1; }
          else en.step[i] = ni;
        }
        U().bump(world, 'enroll');
      }
      putCampaign(world, stamp(c, ctx, { journey: { steps: steps } }));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c ? [{ type: 'campaign/setJourney', payload: { id: p.id, steps: U().clone(c.journey.steps) } }] : [];
    },
    describe: function (world, p) { return 'You saved the journey for “' + cname(world, p.id) + '”'; }
  });

  C.define('campaign/setAlloc', {
    by: ['user', 'agent:*'],
    label: 'Change traffic split',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      var c = camp(world, p.id);
      if (c.channels.indexOf(p.channel) < 0) return 'This campaign doesn’t use ' + chLabel(p.channel) + '.';
      if (!isObj(p.alloc)) return 'Missing allocation.';
      var ks = sortedKeys(p.alloc), sum = 0;
      for (var i = 0; i < ks.length; i++) {
        var v = variant(world, ks[i]), sh = p.alloc[ks[i]];
        if (!v || v.campaignId !== p.id || v.channel !== p.channel) return 'Allocation names a variant outside this channel.';
        if (!(isNum(sh) && sh >= 0)) return 'Shares must be zero or more.';
        if (sh > 0 && c.status !== 'draft' && v.status !== 'live') return 'Only live variants can receive traffic (' + v.name + ').';
        sum += sh;
      }
      if (!(sum > 0)) return 'At least one variant needs a share.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var sum = 0, a = {};
      sortedKeys(p.alloc).forEach(function (k) { sum += p.alloc[k]; });
      sortedKeys(p.alloc).forEach(function (k) { a[k] = p.alloc[k] / sum; });
      var alloc = assign({}, c.alloc); alloc[p.channel] = a;
      var patch = { alloc: alloc };
      if (ctx.user) { var ca = assign({}, c.ctl.alloc); ca[p.channel] = assign({}, a); patch.ctl = assign({}, c.ctl, { alloc: ca }); }
      putCampaign(world, stamp(c, ctx, patch));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      var prior = c && c.alloc[p.channel];
      return prior && allocSum(prior) > 0 ? [{ type: 'campaign/setAlloc', payload: { id: p.id, channel: p.channel, alloc: assign({}, prior) } }] : [];
    },
    describe: function (world, p) { return 'You changed the ' + chLabel(p.channel) + ' split on “' + cname(world, p.id) + '”'; }
  });

  C.define('campaign/setSendHour', {
    by: ['user', 'agent:*'],
    label: 'Change send time',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      var c = camp(world, p.id);
      if (CH().OWNED.indexOf(p.channel) < 0 || c.channels.indexOf(p.channel) < 0) return 'Send times apply to the campaign’s email, SMS and push channels.';
      if (!(p.hour === 'adaptive' || (isInt(p.hour) && p.hour >= 0 && p.hour <= 23))) return 'Pick an hour from 0 to 23, or each person’s best hour.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var sh = assign({}, c.sendHour); sh[p.channel] = p.hour;
      var patch = { sendHour: sh };
      if (ctx.user) { var cs = assign({}, c.ctl.sendHour); cs[p.channel] = p.hour; patch.ctl = assign({}, c.ctl, { sendHour: cs }); }
      putCampaign(world, stamp(c, ctx, patch));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      if (!c || c.sendHour[p.channel] === undefined) return [];
      return [{ type: 'campaign/setSendHour', payload: { id: p.id, channel: p.channel, hour: c.sendHour[p.channel] } }];
    },
    describe: function (world, p) {
      var when = p.hour === 'adaptive' ? 'each person’s best hour' : MC.fmt.hour(p.hour);
      return 'You set ' + chLabel(p.channel) + ' send time on “' + cname(world, p.id) + '” to ' + when;
    }
  });

  C.define('campaign/setBudget', {
    by: ['user', 'agent:*'],
    label: 'Change budget',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      var c = camp(world, p.id);
      if (!isObj(p.byChannel) || !Object.keys(p.byChannel).length) return 'Missing budget.';
      var ks = sortedKeys(p.byChannel), next = assign({}, c.budget.byChannel);
      for (var i = 0; i < ks.length; i++) {
        if (c.channels.indexOf(ks[i]) < 0) return 'This campaign doesn’t use ' + chLabel(ks[i]) + '.';
        if (!(isNum(p.byChannel[ks[i]]) && p.byChannel[ks[i]] >= 0)) return 'Budgets must be zero or more.';
        next[ks[i]] = p.byChannel[ks[i]];
      }
      var tot = 0; sortedKeys(next).forEach(function (k) { tot += next[k]; });
      if (ctx.agent && Math.abs(tot - c.budget.total) > 1) return 'Agents must keep the campaign total unchanged.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var by = assign({}, c.budget.byChannel), tot = 0;
      sortedKeys(p.byChannel).forEach(function (k) { by[k] = p.byChannel[k]; });
      sortedKeys(by).forEach(function (k) { tot += by[k]; });
      putCampaign(world, stamp(c, ctx, { budget: { total: tot, byChannel: by } }));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c ? [{ type: 'campaign/setBudget', payload: { id: p.id, byChannel: assign({}, c.budget.byChannel) } }] : [];
    },
    describe: function (world, p) {
      var c = camp(world, p.id), by = assign({}, c ? c.budget.byChannel : {}), tot = 0;
      sortedKeys(p.byChannel || {}).forEach(function (k) { by[k] = p.byChannel[k]; });
      sortedKeys(by).forEach(function (k) { tot += by[k]; });
      return 'You set the budget for “' + cname(world, p.id) + '” to ' + MC.fmt.money(tot);
    }
  });

  C.define('campaign/setEnd', {
    by: ['user', 'agent:*'],
    label: 'Change end date',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      var c = camp(world, p.id);
      if (!isInt(p.endTick)) return 'Pick a valid end date.';
      if (p.endTick <= c.startTick) return 'The end date must come after the start date.';
      if (c.status !== 'draft' && c.status !== 'scheduled' && p.endTick <= ctx.tick) return 'The end date must be in the future.';
      return null;
    },
    reduce: function (world, p, ctx) { putCampaign(world, stamp(camp(world, p.id), ctx, { endTick: p.endTick })); },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c ? [{ type: 'campaign/setEnd', payload: { id: p.id, endTick: c.endTick } }] : [];
    },
    describe: function (world, p) { return 'You moved the end of “' + cname(world, p.id) + '” to ' + MC.fmt.stamp(p.endTick); }
  });

  function listToggle(field, verbOn, verbOff) {
    return {
      by: ['user', 'agent:*'],
      label: field === 'suppress' ? 'Exclude segment' : 'Add entry segment',
      entity: function (p) { return feedEntity('campaign', p.id); },
      validate: function (world, p, ctx) {
        var e = campErr(world, p.id, ctx); if (e) return e;
        if (typeof p.on !== 'boolean') return 'Say whether to add or remove the segment.';
        if (p.on && !segment(world, p.segmentId)) return 'Pick a segment that exists.';
        if (p.on && camp(world, p.id).segmentId === p.segmentId) return 'That segment is already the campaign’s audience.';
        return null;
      },
      reduce: function (world, p, ctx) {
        var c = camp(world, p.id), list = (c[field] || []).slice(), i = list.indexOf(p.segmentId);
        if (p.on && i < 0) list.push(p.segmentId);
        if (!p.on && i >= 0) list.splice(i, 1);
        var patch = {}; patch[field] = list;
        putCampaign(world, stamp(c, ctx, patch));
      },
      inverse: function (world, p) {
        var c = camp(world, p.id);
        if (!c) return [];
        var had = (c[field] || []).indexOf(p.segmentId) >= 0;
        if (had === !!p.on) return [];
        return [{ type: 'campaign/' + field, payload: { id: p.id, segmentId: p.segmentId, on: had } }];
      },
      describe: function (world, p) {
        return 'You ' + (p.on ? verbOn : verbOff).replace('{s}', sname(world, p.segmentId)).replace('{c}', '“' + cname(world, p.id) + '”');
      }
    };
  }
  C.define('campaign/suppress', listToggle('suppress', 'excluded {s} from {c}', 'stopped excluding {s} from {c}'));
  C.define('campaign/include', listToggle('include', 'added {s} to the audience of {c}', 'removed {s} from the audience of {c}'));

  C.define('campaign/setChannelPaused', {
    by: ['user', 'agent:*'],
    label: 'Pause channel',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var e = campErr(world, p.id, ctx); if (e) return e;
      if (camp(world, p.id).channels.indexOf(p.channel) < 0) return 'This campaign doesn’t use ' + chLabel(p.channel) + '.';
      if (typeof p.paused !== 'boolean') return 'Say whether to pause or resume the channel.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.id);
      var cp = assign({}, c.channelPaused);
      if (p.paused) cp[p.channel] = true; else delete cp[p.channel];
      var patch = { channelPaused: cp };
      if (ctx.user) {
        var kp = assign({}, c.ctl.channelPaused);
        if (p.paused) kp[p.channel] = true; else delete kp[p.channel];
        patch.ctl = assign({}, c.ctl, { channelPaused: kp });
      }
      putCampaign(world, stamp(c, ctx, patch));
    },
    inverse: function (world, p) {
      var c = camp(world, p.id);
      return c ? [{ type: 'campaign/setChannelPaused', payload: { id: p.id, channel: p.channel, paused: !!c.channelPaused[p.channel] } }] : [];
    },
    describe: function (world, p) { return 'You ' + (p.paused ? 'paused ' : 'resumed ') + chLabel(p.channel) + ' on “' + cname(world, p.id) + '”'; }
  });

  C.define('campaign/applyPlan', {
    by: ['user'],
    label: 'Save plan to draft',
    entity: function (p) { return feedEntity('campaign', p.id); },
    validate: function (world, p, ctx) {
      var c = camp(world, p.id);
      if (!c) return 'That campaign no longer exists.';
      if (c.status !== 'draft') return 'Plans can only be saved to draft campaigns.';
      var e = specErr(world, p.campaign); if (e) return e;
      if (p.segment) { e = segSpecErr(world, p.segment); if (e) return e; }
      else if (p.campaign.segmentId && !segment(world, p.campaign.segmentId)) return 'Pick an audience segment that exists.';
      return variantsErr(world, p.variants, p.campaign.channels);
    },
    reduce: function (world, p, ctx) {
      var base = camp(world, p.id);
      var map = {};
      if (p.segment) {
        var sid = createSegmentEntity(world, p.segment, ctx, null);
        map['$1'] = sid; if (p.segment.tmpId) map[p.segment.tmpId] = sid;
        ctx.created.push(sid);
      }
      var used = {};
      variantsOf(world, p.id).forEach(function (v) {
        used[v.channel + ':' + v.name] = true;
        if (v.status !== 'retired') putVariant(world, stamp(v, ctx, { status: 'retired', ctlStatus: 'retired' }));
      });
      var list = p.variants || [];
      var vids = list.map(function (v, k) {
        var id = 'v-' + nextSeq(world);
        map[v.tmpId || ('$v' + k)] = id; if (v.tmpId) map['$v' + k] = id;
        ctx.created.push(id);
        return id;
      });
      var src = assign({}, p.campaign, { status: 'draft' });
      var c = buildCampaign(world, src, p.id, map, ctx, false, base);
      c.status = 'draft';
      var vs = list.map(function (v, k) { return buildVariant(world, v, c, vids[k], ctx, false, used); });
      writeNewCampaign(world, c, vs);
    },
    // Users never undo a plan save through the catalog; drafts keep their retired variants for history.
    inverse: function () { return []; },
    describe: function (world, p) { return 'You saved a new plan to “' + cname(world, p.id) + '”'; }
  });

  /* ================= variant actions ================= */
  function vdesc(world, v) {
    return v ? chLabel(v.channel) + ' variant ' + v.name + ' on “' + cname(world, v.campaignId) + '”' : 'a variant';
  }

  // Remove `vid` from an allocation and renormalize the remaining shares pro rata.
  function dropShare(alloc, vid, liveIds) {
    var a = assign({}, alloc || {});
    if (a[vid] === undefined) return a;
    a[vid] = 0;
    var rest = 0;
    sortedKeys(a).forEach(function (k) { if (k !== vid) rest += a[k] > 0 ? a[k] : 0; });
    if (rest > 0) sortedKeys(a).forEach(function (k) { if (k !== vid) a[k] = (a[k] > 0 ? a[k] : 0) / rest; });
    else if (liveIds.length) liveIds.forEach(function (k) { a[k] = 1 / liveIds.length; });
    delete a[vid];
    return a;
  }
  // Give `vid` `share`, scaling the others by (1 - share).
  function addShare(alloc, vid, share) {
    var a = {}, cur = alloc || {}, sum = allocSum(cur);
    if (!(sum > 0)) { a[vid] = 1; return a; }
    sortedKeys(cur).forEach(function (k) { a[k] = (cur[k] > 0 ? cur[k] / sum : 0) * (1 - share); });
    a[vid] = share;
    return a;
  }

  C.define('variant/create', {
    by: ['user', 'agent:*'],
    label: 'Add variant',
    entity: function (p, created) { return feedEntity('variant', created && created[0]); },
    validate: function (world, p, ctx) {
      if (!isObj(p.variant)) return 'Missing variant.';
      var e = campErr(world, p.variant.campaignId, ctx); if (e) return e;
      var c = camp(world, p.variant.campaignId);
      if (c.channels.indexOf(p.variant.channel) < 0) return 'This campaign doesn’t use ' + chLabel(p.variant.channel) + '.';
      if (p.variant.fields !== undefined && !isObj(p.variant.fields)) return 'Variant fields must be an object.';
      if (p.share !== undefined && p.share !== null && !(isNum(p.share) && p.share >= 0 && p.share < 1)) return 'Share must be between 0 and 1.';
      if (p.variant.status !== undefined && V_STATUSES.indexOf(p.variant.status) < 0) return 'Unknown variant status.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var c = camp(world, p.variant.campaignId);
      var vid = 'v-' + nextSeq(world);
      ctx.created.push(vid);
      var used = {};
      variantsOf(world, c.id, p.variant.channel).forEach(function (v) { used[v.channel + ':' + v.name] = true; });
      var src = assign({}, p.variant);
      if (ctx.agent) src.status = 'live';
      var v = buildVariant(world, src, c, vid, ctx, false, used);
      if (!ctx.user) v.ctlStatus = 'draft';           // control cohort never sees agent-added variants
      putVariant(world, v);
      setLatent(world, v);
      var ch = v.channel, share = isNum(p.share) ? p.share : 0;
      var takesTraffic = v.status === 'live' || c.status === 'draft';
      var patch = {};
      if (takesTraffic && (share > 0 || !(allocSum(c.alloc[ch]) > 0))) {
        var alloc = assign({}, c.alloc); alloc[ch] = addShare(c.alloc[ch], vid, share);
        patch.alloc = alloc;
      }
      if (ctx.user && (v.ctlStatus === 'live' || c.status === 'draft') && (share > 0 || !(allocSum(c.ctl.alloc[ch]) > 0))) {
        var ca = assign({}, c.ctl.alloc); ca[ch] = addShare(c.ctl.alloc[ch], vid, share);
        patch.ctl = assign({}, c.ctl, { alloc: ca });
      }
      if (Object.keys(patch).length) putCampaign(world, stamp(c, ctx, patch));
    },
    inverse: function (world, p) {
      var c = p.variant && camp(world, p.variant.campaignId);
      if (!c) return [];
      var inv = [{ type: 'variant/setStatus', payload: { id: '$created:0', status: 'retired' } }];
      var prior = c.alloc[p.variant.channel];
      if (prior && allocSum(prior) > 0) inv.push({ type: 'campaign/setAlloc', payload: { id: c.id, channel: p.variant.channel, alloc: assign({}, prior) } });
      return inv;
    },
    describe: function (world, p) {
      var v = p.variant || {};
      return 'You added a ' + chLabel(v.channel) + ' variant to “' + cname(world, v.campaignId) + '”';
    }
  });

  C.define('variant/update', {
    by: ['user'],
    label: 'Edit variant',
    entity: function (p) { return feedEntity('variant', p.id); },
    validate: function (world, p, ctx) {
      var v = variant(world, p.id);
      if (!v) return 'That variant no longer exists.';
      if (v.status === 'retired') return 'Retired variants can’t be edited.';
      var e = campErr(world, v.campaignId, ctx); if (e) return e;
      if (!isObj(p.fields) || !Object.keys(p.fields).length) return 'Nothing to change.';
      var ks = Object.keys(p.fields);
      for (var i = 0; i < ks.length; i++) {
        if (FIELD_KEYS.indexOf(ks[i]) < 0) return 'Unknown field ' + ks[i] + '.';
        var x = p.fields[ks[i]];
        if (x !== null && typeof x !== 'string') return 'Field ' + ks[i] + ' must be text.';
        if (typeof x === 'string' && x.length > 4000) return 'Field ' + ks[i] + ' is too long.';
      }
      return null;
    },
    reduce: function (world, p, ctx) {
      var v = variant(world, p.id);
      var fields = assign({}, v.fields);
      sortedKeys(p.fields).forEach(function (k) {
        if (p.fields[k] === null || p.fields[k] === '') delete fields[k]; else fields[k] = p.fields[k];
      });
      var nv = stamp(v, ctx, { fields: fields });
      nv.predicted = scoreVariant(nv);
      putVariant(world, nv);
      setLatent(world, nv);
    },
    inverse: function (world, p) {
      var v = variant(world, p.id);
      if (!v || !isObj(p.fields)) return [];
      var prior = {};
      sortedKeys(p.fields).forEach(function (k) { prior[k] = v.fields[k] === undefined ? null : v.fields[k]; });
      return [{ type: 'variant/update', payload: { id: p.id, fields: prior } }];
    },
    describe: function (world, p) { return 'You edited ' + vdesc(world, variant(world, p.id)); }
  });

  C.define('variant/setStatus', {
    by: ['user', 'agent:*'],
    label: 'Change variant status',
    entity: function (p) { return feedEntity('variant', p.id); },
    validate: function (world, p, ctx) {
      var v = variant(world, p.id);
      if (!v) return 'That variant no longer exists.';
      if (V_STATUSES.indexOf(p.status) < 0) return 'Unknown variant status.';
      if (v.status === p.status && (!ctx.user || v.ctlStatus === p.status)) return 'The variant is already ' + p.status + '.';
      return campErr(world, v.campaignId, ctx);
    },
    reduce: function (world, p, ctx) {
      var v = variant(world, p.id), c = camp(world, v.campaignId), ch = v.channel;
      var patch = { status: p.status };
      if (ctx.user) patch.ctlStatus = p.status;
      putVariant(world, stamp(v, ctx, patch));
      var others = variantsOf(world, c.id, ch).filter(function (x) { return x.id !== v.id; });
      var cpatch = {};
      if (v.status === 'live' && p.status !== 'live') {
        var alloc = assign({}, c.alloc);
        alloc[ch] = dropShare(c.alloc[ch], v.id, others.filter(function (x) { return x.status === 'live'; }).map(function (x) { return x.id; }));
        cpatch.alloc = alloc;
      } else if (p.status === 'live' && v.status !== 'live' && !(allocSum(c.alloc[ch]) > 0)) {
        var a2 = assign({}, c.alloc); a2[ch] = {}; a2[ch][v.id] = 1; cpatch.alloc = a2;
      }
      if (ctx.user) {
        if (v.ctlStatus === 'live' && p.status !== 'live') {
          var ca = assign({}, c.ctl.alloc);
          ca[ch] = dropShare(c.ctl.alloc[ch], v.id, others.filter(function (x) { return x.ctlStatus === 'live'; }).map(function (x) { return x.id; }));
          cpatch.ctl = assign({}, c.ctl, { alloc: ca });
        } else if (p.status === 'live' && v.ctlStatus !== 'live' && !(allocSum(c.ctl.alloc[ch]) > 0)) {
          var cb = assign({}, c.ctl.alloc); cb[ch] = {}; cb[ch][v.id] = 1;
          cpatch.ctl = assign({}, c.ctl, { alloc: cb });
        }
      }
      if (Object.keys(cpatch).length) putCampaign(world, stamp(c, ctx, cpatch));
    },
    inverse: function (world, p) {
      var v = variant(world, p.id);
      if (!v) return [];
      var c = camp(world, v.campaignId);
      var inv = [{ type: 'variant/setStatus', payload: { id: p.id, status: v.status } }];
      var prior = c && c.alloc[v.channel];
      if (prior && allocSum(prior) > 0) inv.push({ type: 'campaign/setAlloc', payload: { id: c.id, channel: v.channel, alloc: assign({}, prior) } });
      return inv;
    },
    describe: function (world, p) {
      var v = variant(world, p.id);
      var verb = { live: 'set live', paused: 'paused', retired: 'retired', draft: 'moved to draft' }[p.status] || 'changed';
      return 'You ' + verb + ' ' + vdesc(world, v);
    }
  });

  /* ================= segment actions ================= */
  function segmentInUse(world, id) {
    var order = world.campaigns.order;
    for (var i = 0; i < order.length; i++) {
      var c = world.campaigns.byId[order[i]];
      if (!c || c.status === 'completed') continue;
      if (c.segmentId === id || (c.include || []).indexOf(id) >= 0 || (c.suppress || []).indexOf(id) >= 0) return c;
    }
    return null;
  }
  C.segmentInUse = segmentInUse;

  C.define('segment/create', {
    by: ['user', 'agent:*'],
    label: 'Create segment',
    entity: function (p, created) { return feedEntity('segment', created && created[0]); },
    validate: function (world, p) {
      if (p.restoreId !== undefined && (typeof p.restoreId !== 'string' || segment(world, p.restoreId))) return 'That segment already exists.';
      return segSpecErr(world, p.segment);
    },
    reduce: function (world, p, ctx) {
      var id = createSegmentEntity(world, p.segment, ctx, typeof p.restoreId === 'string' ? p.restoreId : null);
      ctx.created.push(id);
    },
    inverse: function () { return [{ type: 'segment/remove', payload: { id: '$created:0' } }]; },
    describe: function (world, p) { return 'You created the segment “' + (p.segment && p.segment.name) + '”'; }
  });

  C.define('segment/update', {
    by: ['user'],
    label: 'Edit segment',
    entity: function (p) { return feedEntity('segment', p.id); },
    validate: function (world, p) {
      var s = segment(world, p.id);
      if (!s) return 'That segment no longer exists.';
      if (p.name === undefined && p.rule === undefined) return 'Nothing to change.';
      return segSpecErr(world, { name: p.name !== undefined ? p.name : s.name, rule: p.rule !== undefined ? p.rule : s.rule });
    },
    reduce: function (world, p, ctx) {
      var s = segment(world, p.id), patch = {};
      if (p.name !== undefined) patch.name = p.name.trim();
      if (p.rule !== undefined) {
        patch.rule = U().clone(p.rule);
        patch.count = countRule(world, patch.rule);
        patch.countDay = Math.floor(ctx.tick / 24);
      }
      putSegment(world, stamp(s, ctx, patch));
      if (p.rule !== undefined) U().bump(world, 'segCounts');
    },
    inverse: function (world, p) {
      var s = segment(world, p.id);
      if (!s) return [];
      var pl = { id: p.id };
      if (p.name !== undefined) pl.name = s.name;
      if (p.rule !== undefined) pl.rule = U().clone(s.rule);
      return [{ type: 'segment/update', payload: pl }];
    },
    describe: function (world, p) { return 'You updated the segment “' + sname(world, p.id) + '”'; }
  });

  C.define('segment/remove', {
    by: ['user', 'agent:*'],
    label: 'Delete segment',
    entity: function (p) { return feedEntity('segment', p.id); },
    validate: function (world, p) {
      if (!segment(world, p.id)) return 'That segment no longer exists.';
      var c = segmentInUse(world, p.id);
      if (c) return 'This segment is used by “' + c.name + '”.';
      return null;
    },
    reduce: function (world, p) {
      var ss = world.segments;
      var byId = assign({}, ss.byId); delete byId[p.id];
      world.segments = assign({}, ss, { byId: byId, order: ss.order.filter(function (x) { return x !== p.id; }) });
      U().bump(world, 'segCounts');
    },
    inverse: function (world, p) {
      var s = segment(world, p.id);
      return s ? [{ type: 'segment/create', payload: { segment: U().clone(s), restoreId: p.id } }] : [];
    },
    describe: function (world, p) { return 'You deleted the segment “' + sname(world, p.id) + '”'; }
  });

  /* ================= profile suppression ================= */
  function idxErr(world, p) {
    if (CH().OWNED.indexOf(p.channel) < 0) return 'Suppression applies to email, SMS or push.';
    if (!Array.isArray(p.idx) || !p.idx.length) return 'No people selected.';
    var n = world.profiles.n;
    for (var i = 0; i < p.idx.length; i++) if (!isInt(p.idx[i]) || p.idx[i] < 0 || p.idx[i] >= n) return 'Unknown profile in the list.';
    return null;
  }
  function before(world, p) {
    var ci = CH().IDX[p.channel], sup = world.profiles.supUntil;
    return p.idx.map(function (i) { return sup[i * 3 + ci]; });
  }

  C.define('profiles/suppress', {
    by: ['user', 'agent:*'],
    label: 'Rest people',
    entity: function (p) { return p.campaignId ? feedEntity('campaign', p.campaignId) : null; },
    validate: function (world, p, ctx) {
      var e = idxErr(world, p); if (e) return e;
      if (!isInt(p.untilTick) || p.untilTick <= ctx.tick) return 'The rest period must end in the future.';
      if (p.campaignId !== undefined && p.campaignId !== null && !camp(world, p.campaignId)) return 'That campaign no longer exists.';
      return null;
    },
    reduce: function (world, p) {
      var ci = CH().IDX[p.channel], sup = world.profiles.supUntil;
      for (var k = 0; k < p.idx.length; k++) sup[p.idx[k] * 3 + ci] = p.untilTick;
      U().bump(world, 'profiles');
    },
    inverse: function (world, p) {
      return [{ type: 'profiles/release', payload: { channel: p.channel, idx: p.idx.slice(), prev: before(world, p) } }];
    },
    describe: function (world, p) {
      return 'You rested ' + MC.fmt.num(p.idx.length) + (p.idx.length === 1 ? ' person' : ' people') + ' from ' + chLabel(p.channel) + ' until ' + MC.fmt.stamp(p.untilTick);
    }
  });

  C.define('profiles/release', {
    by: ['user', 'agent:*'],
    label: 'Release people',
    entity: function () { return null; },
    validate: function (world, p) {
      var e = idxErr(world, p); if (e) return e;
      if (p.prev !== undefined && (!Array.isArray(p.prev) || p.prev.length !== p.idx.length)) return 'Previous values don’t match the list.';
      return null;
    },
    reduce: function (world, p) {
      var ci = CH().IDX[p.channel], sup = world.profiles.supUntil;
      for (var k = 0; k < p.idx.length; k++) sup[p.idx[k] * 3 + ci] = p.prev ? (p.prev[k] | 0) : 0;
      U().bump(world, 'profiles');
    },
    inverse: function (world, p) {
      return [{ type: 'profiles/release', payload: { channel: p.channel, idx: p.idx.slice(), prev: before(world, p) } }];
    },
    describe: function (world, p) {
      return 'You released ' + MC.fmt.num(p.idx.length) + (p.idx.length === 1 ? ' person' : ' people') + ' back to ' + chLabel(p.channel);
    }
  });

  /* ================= agent settings ================= */
  function agentEnt(world, id) { return world.agents && world.agents.byId[id]; }
  function agentPatch(world, id, patch, ctx) { putAgent(world, stamp(agentEnt(world, id), ctx, patch)); }
  function paramErr(def, key, val) {
    var pd = def && def.params && def.params[key];
    if (!pd) return 'Unknown setting ' + key + '.';
    var label = pd.label || key;
    if (pd.type === 'bool') return typeof val === 'boolean' ? null : label + ' must be on or off.';
    if (!isNum(val)) return label + ' must be a number.';
    if (pd.type === 'int' && !isInt(val)) return label + ' must be a whole number.';
    if ((pd.min !== undefined && val < pd.min) || (pd.max !== undefined && val > pd.max)) return label + ' must be between ' + pd.min + ' and ' + pd.max + '.';
    return null;
  }
  function defaultsOf(def) {
    var o = {};
    sortedKeys(def && def.params).forEach(function (k) { o[k] = def.params[k]['default']; });
    return o;
  }
  C.paramErr = paramErr;
  C.defaultParams = defaultsOf;

  function agentAction(type, label, validateExtra, patchFn, describeFn) {
    C.define(type, {
      by: ['user'],
      label: label,
      entity: function (p) { return feedEntity('agent', p.id); },
      validate: function (world, p, ctx) {
        if (!agentEnt(world, p.id)) return 'Unknown agent.';
        return validateExtra ? validateExtra(world, p, agentDef(p.id), agentEnt(world, p.id)) : null;
      },
      reduce: function (world, p, ctx) { agentPatch(world, p.id, patchFn(world, p, agentDef(p.id), agentEnt(world, p.id)), ctx); },
      inverse: function () { return []; },
      describe: function (world, p) { return describeFn(agentName(p.id), p); }
    });
  }

  var AUTONOMY_LABEL = { off: 'Off', suggest: 'Suggest', autopilot: 'Autopilot' };
  agentAction('agent/setAutonomy', 'Set autonomy',
    function (world, p, def) {
      var allowed = (def && def.autonomy && def.autonomy.allowed) || ['off', 'suggest', 'autopilot'];
      return allowed.indexOf(p.autonomy) < 0 ? 'This agent can’t run on ' + (AUTONOMY_LABEL[p.autonomy] || p.autonomy) + '.' : null;
    },
    function (world, p) { return { autonomy: p.autonomy }; },
    function (n, p) { return 'You set ' + n + ' to ' + (AUTONOMY_LABEL[p.autonomy] || p.autonomy); });

  agentAction('agent/setStatus', 'Pause or resume agent',
    function (world, p) { return (p.status === 'active' || p.status === 'paused') ? null : 'Status must be active or paused.'; },
    function (world, p) { return { status: p.status }; },
    function (n, p) { return 'You ' + (p.status === 'paused' ? 'paused ' : 'resumed ') + n; });

  agentAction('agent/setCadence', 'Change cadence',
    function (world, p, def) {
      if (CADENCES.indexOf(p.cadence) < 0) return 'Pick one of the listed cadences.';
      var cd = def && def.cadence;
      if (cd && ((cd.min !== undefined && p.cadence < cd.min) || (cd.max !== undefined && p.cadence > cd.max))) {
        return 'This agent runs every ' + cd.min + '–' + cd.max + ' hours.';
      }
      return null;
    },
    function (world, p) { return { cadence: p.cadence }; },
    function (n, p) { return 'You set ' + n + ' to run every ' + p.cadence + (p.cadence === 1 ? ' hour' : ' hours'); });

  agentAction('agent/setParams', 'Change parameters',
    function (world, p, def) {
      if (!isObj(p.params) || !Object.keys(p.params).length) return 'Nothing to change.';
      if (!def) return 'This agent isn’t available yet.';
      var ks = sortedKeys(p.params);
      for (var i = 0; i < ks.length; i++) { var e = paramErr(def, ks[i], p.params[ks[i]]); if (e) return e; }
      return null;
    },
    function (world, p, def, a) { return { params: assign({}, a.params, p.params) }; },
    function (n) { return 'You updated ' + n + ' parameters'; });

  agentAction('agent/resetParams', 'Reset parameters',
    function (world, p, def) { return def ? null : 'This agent isn’t available yet.'; },
    function (world, p, def) { return { params: defaultsOf(def) }; },
    function (n) { return 'You reset ' + n + ' to its defaults'; });

  agentAction('agent/runNow', 'Run now',
    null,
    function () { return { runRequested: true }; },
    function (n) { return 'You asked ' + n + ' to run now'; });

  /* ================= proposals ================= */
  function prop(world, id) { return world.proposals && world.proposals.byId[id]; }
  function closeProposal(world, p, patch) {
    var np = assign({}, p, patch);
    putProposal(world, np);
    var open = world.proposals.open || [];
    if (open.indexOf(p.id) >= 0) world.proposals = assign({}, world.proposals, { open: open.filter(function (x) { return x !== p.id; }) });
    return np;
  }
  C.closeProposal = closeProposal;

  function entityById(world, id) {
    return (world.campaigns && world.campaigns.byId[id]) || (world.variants && world.variants.byId[id]) ||
      (world.segments && world.segments.byId[id]) || null;
  }
  C.entityById = entityById;

  function isStale(world, p) {
    var bv = p.baseVer || {};
    var ks = sortedKeys(bv);
    for (var i = 0; i < ks.length; i++) {
      var e = entityById(world, ks[i]);
      if (!e || e.ver !== bv[ks[i]]) return true;
    }
    return false;
  }
  C.isStale = isStale;

  function blockingFail(world, p) {
    if (!(MC.guardrails && typeof MC.guardrails.evaluate === 'function')) return null;
    var list = MC.guardrails.evaluate(world, p, agentDef(p.agentId)) || [];
    for (var i = 0; i < list.length; i++) if (list[i].blocking && !list[i].pass) return list[i];
    return null;
  }

  C.cooldownKey = function (p) {
    var t = p.target || {};
    return [p.kind, t.kind, t.id, t.channel].join('|');
  };

  function bumpStat(world, agentId, key) {
    var a = agentEnt(world, agentId);
    if (!a) return;
    var stats = assign({}, a.stats); stats[key] = (stats[key] || 0) + 1;
    putAgent(world, assign({}, a, { stats: stats }));
  }

  function targetEntity(p) { return p.target && p.target.id ? { kind: p.target.kind, id: p.target.id } : undefined; }

  function approveCheck(world, id) {
    var p = prop(world, id);
    if (!p || p.status !== 'pending') return 'This proposal is no longer pending.';
    if (isStale(world, p)) return null;
    var bf = blockingFail(world, p);
    if (bf) return 'Blocked by guardrail: ' + bf.label;
    if (!(MC.runtime && typeof MC.runtime.apply === 'function')) return 'The agent runtime isn’t available.';
    return null;
  }

  function approveOne(world, id, ctx) {
    var err = approveCheck(world, id);
    if (err) return err;
    var p = prop(world, id);
    if (isStale(world, p)) {
      closeProposal(world, p, { status: 'stale', reason: 'No longer applies: the campaign changed since this was proposed.', decidedTick: ctx.tick });
      return null;
    }
    MC.runtime.apply(world, id, 'agent:' + p.agentId);
    var after = prop(world, id);
    if (after.status === 'stale') { closeProposal(world, after, { decidedTick: ctx.tick }); return null; }
    closeProposal(world, after, { status: 'applied', decidedTick: ctx.tick, reason: 'Approved' });
    addFeed(world, { tick: ctx.tick, kind: 'approved', agentId: p.agentId, proposalId: id, entity: targetEntity(p), text: 'You approved: ' + p.title, tone: 'good' });
    return null;
  }

  C.define('proposal/approve', {
    by: ['user'],
    label: 'Approve',
    validate: function (world, p) { return approveCheck(world, p.id); },
    reduce: function (world, p, ctx) { return approveOne(world, p.id, ctx) || undefined; },
    inverse: function () { return []; },
    describe: function (world, p) { var x = prop(world, p.id); return 'You approved: ' + (x ? x.title : p.id); }
  });

  C.define('proposal/approveMany', {
    by: ['user'],
    label: 'Approve several',
    validate: function (world, p) {
      if (!Array.isArray(p.ids) || !p.ids.length) return 'Nothing selected.';
      var first = null;
      for (var i = 0; i < p.ids.length; i++) { var e = approveCheck(world, p.ids[i]); if (!e) return null; if (!first) first = e; }
      return first;
    },
    reduce: function (world, p, ctx) { p.ids.forEach(function (id) { approveOne(world, id, ctx); }); },
    inverse: function () { return []; },
    describe: function (world, p) { return 'You approved ' + p.ids.length + ' changes'; }
  });

  var REJECT_LABEL = { 'not-now': 'Not now', wrong: 'Not a good idea', other: 'Other' };
  C.define('proposal/reject', {
    by: ['user'],
    label: 'Dismiss',
    validate: function (world, p) {
      var x = prop(world, p.id);
      if (!x || x.status !== 'pending') return 'This proposal is no longer pending.';
      if (!REJECT_LABEL[p.reason]) return 'Pick a reason.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var x = prop(world, p.id);
      closeProposal(world, x, { status: 'rejected', reason: 'Dismissed: ' + REJECT_LABEL[p.reason], dismissReason: p.reason, decidedTick: ctx.tick });
      var a = agentEnt(world, x.agentId);
      if (a) {
        var cd = assign({}, a.cooldowns);
        cd[C.cooldownKey(x)] = ctx.tick + (p.reason === 'wrong' ? 168 : 24);
        var stats = assign({}, a.stats); stats.rejected = (stats.rejected || 0) + 1;
        putAgent(world, assign({}, a, { cooldowns: cd, stats: stats }));
      }
      addFeed(world, { tick: ctx.tick, kind: 'rejected', agentId: x.agentId, proposalId: x.id, entity: targetEntity(x), text: 'You dismissed: ' + x.title, tone: 'neutral' });
    },
    inverse: function () { return []; },
    describe: function (world, p) { var x = prop(world, p.id); return 'You dismissed: ' + (x ? x.title : p.id); }
  });

  C.define('proposal/undo', {
    by: ['user'],
    label: 'Undo',
    validate: function (world, p) {
      var x = prop(world, p.id);
      if (!x) return 'That change no longer exists.';
      if (x.status !== 'applied' && x.status !== 'auto') return 'Only applied changes can be undone.';
      if (MC.runtime && typeof MC.runtime.undoCheck === 'function') {
        var r = MC.runtime.undoCheck(world, p.id) || {};
        if (!r.ok) return r.reason || 'This change can’t be undone.';
      }
      if (!Array.isArray(x.inverse) || !x.inverse.length) return 'Nothing to undo for this change.';
      return null;
    },
    reduce: function (world, p, ctx) {
      var x = prop(world, p.id);
      var meta = { origin: 'agent:' + x.agentId, tick: ctx.tick };
      var done = [];
      for (var i = 0; i < x.inverse.length; i++) {
        var r = C.apply(world, x.inverse[i], meta);
        if (!r.ok) {
          for (var j = done.length - 1; j >= 0; j--) done[j].forEach(function (a) { C.apply(world, a, meta); });
          return 'Couldn’t undo: ' + r.error;
        }
        done.push(r.inverse || []);
      }
      closeProposal(world, prop(world, p.id), { status: 'undone', undoneTick: ctx.tick });
      bumpStat(world, x.agentId, 'undone');
      addFeed(world, { tick: ctx.tick, kind: 'undone', agentId: x.agentId, proposalId: x.id, entity: targetEntity(x), text: 'You undid: ' + x.title, tone: 'neutral' });
    },
    inverse: function () { return []; },
    describe: function (world, p) { var x = prop(world, p.id); return 'You undid: ' + (x ? x.title : p.id); }
  });

  /* ================= guardrails & insights ================= */
  var LOCKED = { protectDrafts: 1, consent: 1 };
  function rng(label, v, lo, hi, int) {
    if (!isNum(v) || (int && !isInt(v))) return label + ' must be a ' + (int ? 'whole ' : '') + 'number.';
    if (v < lo || v > hi) return label + ' must be between ' + lo + ' and ' + hi + '.';
    return null;
  }
  function guardErr(p) {
    var g = p.patch;
    if (!isObj(g) || !Object.keys(g).length) return 'Nothing to change.';
    var ks = Object.keys(g), e, i;
    for (i = 0; i < ks.length; i++) {
      var k = ks[i], v = g[k];
      if (LOCKED[k]) return 'That guardrail is locked.';
      if (k === 'freqCap') {
        if (!isObj(v)) return 'Frequency caps need numbers per channel.';
        var cks = Object.keys(v);
        for (var j = 0; j < cks.length; j++) {
          if (CH().OWNED.indexOf(cks[j]) < 0) return 'Frequency caps apply to email, SMS and push.';
          e = rng(chLabel(cks[j]) + ' frequency cap', v[cks[j]], 1, 14, true); if (e) return e;
        }
      } else if (k === 'quiet') {
        if (!isObj(v)) return 'Quiet hours need a start and end.';
        if (v.channels !== undefined) return 'Quiet-hour channels are locked.';
        var qk = Object.keys(v);
        for (var q = 0; q < qk.length; q++) {
          if (qk[q] !== 'start' && qk[q] !== 'end') return 'Unknown quiet-hours field.';
          e = rng('Quiet hours ' + qk[q], v[qk[q]], 0, 23, true); if (e) return e;
        }
      } else if (k === 'maxShiftPct') { e = rng('Max change per run', v, 5, 50, false); if (e) return e; }
      else if (k === 'minSample') { e = rng('Minimum sample', v, 100, 5000, true); if (e) return e; }
      else if (k === 'maxDailySpend') { e = rng('Daily spend cap', v, 500, 10000, false); if (e) return e; }
      else if (k === 'holdoutPct') { e = rng('Control group', v, 0, 20, false); if (e) return e; }
      else if (k === 'brand') {
        if (!isObj(v)) return 'Brand rules are incomplete.';
        var bk = Object.keys(v);
        for (var b = 0; b < bk.length; b++) {
          var bv = v[bk[b]];
          if (bk[b] === 'smsOptOut') return 'The SMS opt-out rule is locked.';
          if (bk[b] === 'banned') {
            if (!Array.isArray(bv) || bv.length > 30) return 'Up to 30 banned words.';
            for (var w = 0; w < bv.length; w++) if (typeof bv[w] !== 'string' || !bv[w].trim() || bv[w].length > 30) return 'Banned words need 1–30 characters.';
          } else if (bk[b] === 'maxSubject') { e = rng('Max subject length', bv, 30, 90, true); if (e) return e; }
          else if (bk[b] === 'maxGrade') { e = rng('Reading grade', bv, 4, 12, false); if (e) return e; }
          else if (bk[b] === 'noAllCaps') { if (typeof bv !== 'boolean') return 'All-caps rule must be on or off.'; }
          else return 'Unknown brand rule ' + bk[b] + '.';
        }
      } else return 'Unknown guardrail ' + k + '.';
    }
    return null;
  }

  C.define('guardrails/update', {
    by: ['user'],
    label: 'Save guardrails',
    entity: function () { return { kind: 'guardrails', id: 'guardrails' }; },
    validate: function (world, p) { return guardErr(p); },
    reduce: function (world, p, ctx) {
      var g = world.guardrails, d = p.patch;
      var ng = assign({}, g);
      if (d.freqCap) ng.freqCap = assign({}, g.freqCap, d.freqCap);
      if (d.quiet) ng.quiet = assign({}, g.quiet, d.quiet);
      ['maxShiftPct', 'minSample', 'maxDailySpend', 'holdoutPct'].forEach(function (k) { if (d[k] !== undefined) ng[k] = d[k]; });
      if (d.brand) {
        var nb = assign({}, g.brand, d.brand);
        if (d.brand.banned) nb.banned = d.brand.banned.map(function (s) { return s.trim(); });
        ng.brand = nb;
      }
      ng.ver = (g.ver || 0) + 1; ng.updatedBy = ctx.origin; ng.updatedTick = ctx.tick;
      world.guardrails = ng;
    },
    inverse: function () { return []; },
    describe: function () { return 'You updated the guardrails'; }
  });

  C.define('insight/dismiss', {
    by: ['user'],
    label: 'Dismiss insight',
    validate: function (world, p) {
      var list = world.insights || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === p.id) return list[i].dismissed ? 'Already dismissed.' : null;
      return 'That insight no longer exists.';
    },
    reduce: function (world, p) {
      world.insights = world.insights.map(function (x) { return x.id === p.id ? assign({}, x, { dismissed: true }) : x; });
    },
    inverse: function () { return []; },
    describe: function () { return 'You dismissed an insight'; }
  });
})();
