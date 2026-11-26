/* Marketing Cloud - MC.ai.fleet: the eight agents as Haiku agents (§12.5). Per-agent roles,
   response schemas, validation of Haiku's verdict, and the bridge into the runtime: runtime.runAgent hands
   awaiting runs to enqueue(); the verdict (or the rule-based fallback after 8 s, an error, or a validation
   failure) lands as ONE logged action `agent/aiRun`, so replay reproduces it without calling the API.
   Also keeps the logged world fact `ai/setEnabled` in step with the connection state. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var AI = MC.ai = MC.ai || {};
  var FL = AI.fleet = AI.fleet || {};

  var DEADLINE_MS = 8000;
  FL.DEADLINE_MS = DEADLINE_MS;

  function report(e) { if (window.console && console.error) console.error(e); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function str(x, max) { var s = typeof x === 'string' ? x.trim() : ''; return max && s.length > max ? s.slice(0, max) : s; }
  function clone(v) { return MC.util && MC.util.clone ? MC.util.clone(v) : JSON.parse(JSON.stringify(v)); }
  function clock() { try { return MC.util.now(); } catch (e) { return Date.now(); } }
  function later(fn, ms) { setTimeout(function () { try { fn(); } catch (e) { report(e); } }, ms || 0); }

  /* ---------------- roles (also in the cached prefix) ---------------- */
  FL.ROLES = {
    optimizer: 'Shift traffic toward the winning variants and pause clear losers. Choose among the engine\'s traffic-shift and pause drafts and explain them in the marketer\'s terms (which message is winning, by how much, on which channel).',
    sendtime: 'Move sends to the hours each audience actually opens. Choose among the engine\'s send-hour drafts; skip moves that are marginal or that fight a recent marketer decision.',
    pacer: 'Keep spend on plan and move budget toward the channel returning the most. Choose among budget-shift drafts; explain pacing in dollars per day and days left.',
    guard: 'Protect customers from over-messaging before they unsubscribe. Choose among suppression and channel-pause drafts; be conservative, explain the trade-off in unsubscribes avoided versus revenue forgone.',
    analyst: 'Watch the numbers, flag surprises and warn when a goal is at risk. Write the insight titles and bodies yourself (rewrite rule insights by ref, add at most two new ones), and choose among extend-campaign drafts.',
    copy: 'Write fresh challenger copy when a winner tires or a test has settled. You may rewrite a candidate\'s copy (variants[].candidate = its id) or write an original challenger for a live campaign channel; obey the brand book and channel limits exactly.',
    scout: 'Find pockets of customers who respond far better than average. Name and explain candidate segments (segments[].candidate = its id to rename), or propose at most one original rule over known attributes.',
    planner: 'Plan campaigns for upcoming retail moments. Choose among the engine\'s campaign drafts and write the plan narrative in "why": who it is for, what it says, when it runs and what it should earn.'
  };

  var TASK = {
    copy: 'Also return "variants": rewritten or original challengers. For a rewrite set candidate to the draft id and keep campaignId and channel from it; for an original set candidate to "". Fill only the fields that channel uses (others ""). Subject ≤ 60, push title ≤ 40, push body ≤ 120, SMS ≤ 160 and ending with the opt-out text, social headline ≤ 40, social text ≤ 125, button label ≤ 28. Use {first_name}, {product}, {offer}, {link} tokens only as listed.',
    scout: 'Also return "segments": renames of candidate segments (candidate = draft id, conditions []) or at most one original rule (candidate "", combine "all" or "any", conditions over segmentAttributes keys with their ops; value as text: a number, "lo..hi" for between, comma-separated values for category lists, "yes"/"no" for flags). Names under 48 characters, in plain words.'
  };
  FL.taskText = function (agentId) {
    return 'Return your verdict as the JSON schema requires. ' + (TASK[agentId] || 'Return "decisions" for every candidate, "insights" and a "summary".');
  };

  /* ---------------- tunables: what Haiku may adjust inside declared ranges ---------------- */
  function variantCreate(d) {
    var a = (d.actions || []).filter(function (x) { return x && x.type === 'variant/create'; })[0];
    return a && a.payload ? a : null;
  }
  FL.tunables = function (agentId, draft) {
    var def = MC.runtime && MC.runtime.def(agentId);
    if (!def || !draft) return [];
    if (agentId === 'copy' && def.params.challengerShare) {
      var a = variantCreate(draft);
      if (a && isNum(a.payload.share)) return [{ param: 'share', label: 'Starting share of traffic', min: def.params.challengerShare.min, max: def.params.challengerShare.max, current: a.payload.share }];
    }
    return [];
  };
  // Deterministic: called by the agent/aiRun reducer (live and replay) with the logged adjust map.
  FL.applyAdjust = function (agentId, draft, adjust) {
    var tun = FL.tunables(agentId, draft), out = clone(draft);
    tun.forEach(function (t) {
      var v = adjust[t.param];
      if (!isNum(v)) return;
      v = Math.max(t.min, Math.min(t.max, Math.round(v * 100) / 100));
      if (t.param === 'share') {
        var a = variantCreate(out), old = a.payload.share;
        a.payload.share = v;
        if (old > 0 && out.impact) {
          var k = v / old;
          ['delta', 'lo', 'hi'].forEach(function (f) { if (isNum(out.impact[f])) out.impact[f] = Math.round(out.impact[f] * k); });
        }
        (out.diff || []).forEach(function (row) {
          if (/share$/.test(row.label || '') && row.before === '0%') row.after = Math.round(v * 100) + '%';
        });
      }
    });
    return out;
  };

  /* ---------------- schemas (all fields required; "" means none) ---------------- */
  function obj(props) { return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props }; }
  var S = { type: 'string' }, N = { type: 'number' };
  var DECISION = obj({ candidate: S, verdict: { type: 'string', enum: ['propose', 'skip'] },
    adjust: { type: 'array', items: obj({ param: S, value: N }) }, title: S, why: S, confidence: N });
  var INSIGHT = obj({ ref: S, title: S, body: S, severity: { type: 'string', enum: ['info', 'warn', 'crit'] }, entityId: S });
  var FIELD_KEYS = ['subject', 'preheader', 'headline', 'body', 'cta', 'sms', 'pushTitle', 'pushBody', 'socialText', 'socialHeadline', 'alt'];
  var FIELDS = (function () { var p = {}; FIELD_KEYS.forEach(function (k) { p[k] = S; }); return obj(p); })();
  var VARIANT = obj({ candidate: S, campaignId: S, channel: S, fields: FIELDS, title: S, why: S });
  var SEGMENT = obj({ candidate: S, name: S, why: S, combine: { type: 'string', enum: ['all', 'any'] },
    conditions: { type: 'array', items: obj({ attr: S, cmp: S, value: S }) } });
  FL.schemaFor = function (agentId) {
    var p = { decisions: { type: 'array', items: DECISION }, insights: { type: 'array', items: INSIGHT }, summary: S };
    if (agentId === 'copy') p.variants = { type: 'array', items: VARIANT };
    if (agentId === 'scout') p.segments = { type: 'array', items: SEGMENT };
    return obj(p);
  };
  FL.FIELD_KEYS = FIELD_KEYS;

  /* ---------------- validation ---------------- */
  var META_RE = /\b(ticks?|seeds?|digests?|simulat\w*|sandbox|json|prompt|LLM|Haiku|Claude|language model|as an ai|c\d+)\b/i;
  function cleanText(s, ground, max) {
    s = str(s, max);
    if (!s || META_RE.test(s)) return '';
    if (MC.ai.context && !MC.ai.context.grounded(s, ground)) return '';
    return s;
  }
  FL.cleanText = cleanText;

  function brandOf(world) { return (world.guardrails && world.guardrails.brand) || (MC.copy && MC.copy.DEFAULT_BRAND); }
  function hookOf(v) { var k = MC.copy && MC.copy.HOOK ? MC.copy.HOOK[v.channel] : 'subject'; return (v.fields && v.fields[k]) || ''; }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : ((MC.CH.LABEL[ch] || ch).toLowerCase()); }

  // Builds a brand-checked variant from Haiku's fields over a base (candidate or a fresh shell).
  function buildVariant(base, fields, world) {
    var v = clone(base);
    var allowed = (MC.copy.FIELDS && MC.copy.FIELDS[v.channel]) || [];
    v.fields = v.fields || {};
    FIELD_KEYS.forEach(function (k) { var x = str(fields && fields[k], 600); if (x && allowed.indexOf(k) >= 0) v.fields[k] = x; });
    var checks = function (x) { return (MC.copy.check(x, brandOf(world)) || []).filter(function (r) { return r.status === 'fail'; }); };
    if (checks(v).length && typeof MC.copy.fixAll === 'function') { try { v = MC.copy.fixAll(v, brandOf(world)); } catch (e) { /* keep */ } }
    if (checks(v).length) return null;
    var s = MC.copy.score(v);
    v.predicted = { score: s.score, open: s.predOpen, click: s.predClick };
    delete v.tmpId;
    return v;
  }
  FL._buildVariant = buildVariant;

  function copyExtras(world, job, data, ground) {
    var out = [], def = MC.runtime.def('copy'), a = world.agents.byId.copy;
    var share = (a && a.params && a.params.challengerShare) || (def && def.params.challengerShare && def.params.challengerShare['default']) || 0.1;
    (Array.isArray(data.variants) ? data.variants : []).slice(0, 3).forEach(function (x) {
      if (!x) return;
      var m = /^c(\d+)$/.exec(x.candidate || ''), cand = m ? job.candidates[+m[1]] : null, act = cand ? variantCreate(cand) : null;
      var base, target, sh;
      if (cand) {
        if (!act) return;
        base = act.payload.variant; target = cand.target; sh = act.payload.share;
      } else {
        var c = world.campaigns.byId[x.campaignId];
        if (!c || (c.status !== 'live' && c.status !== 'scheduled') || c.channels.indexOf(x.channel) < 0 || MC.CH.OWNED.indexOf(x.channel) < 0) return;
        base = { campaignId: c.id, channel: x.channel, fields: { link: (MC.copy.generate({ channel: x.channel, tone: c.tone, productId: c.productFocus, offer: c.offer, count: 1, seedKey: 'ai:' + job.runId }, world.meta.seed)[0] || {}).fields.link },
          tone: c.tone, offer: c.offer, productId: c.productFocus };
        target = { kind: 'campaign', id: c.id, channel: x.channel }; sh = share;
      }
      var v = buildVariant(base, x.fields, world);
      if (!v) return;
      var title = cleanText(x.title, ground, 140) || (cand ? cand.title : 'Add a fresh ' + chLower(v.channel) + ' challenger');
      var e = { kind: 'new-variant', target: target, actions: [{ type: 'variant/create', payload: { variant: v, share: sh } }], title: title,
        why: cleanText(x.why, ground, 600), risk: 'medium', horizon: 96, mustQueue: true,   // Haiku-written copy is always reviewed
        diff: [{ label: 'New ' + chLower(v.channel) + ' variant', before: '—', after: hookOf(v) }, { label: 'Its share of traffic', before: '0%', after: Math.round(sh * 100) + '%' }] };
      if (cand) e.replaces = x.candidate;
      out.push(e);
    });
    return out;
  }

  function parseValue(attr, cmp, raw) {
    var s = String(raw || '').trim();
    if (attr.type === 'num') {
      if (cmp === 'between') { var p = s.split(/\.\.|–|-|\bto\b/).map(function (q) { return parseFloat(q); }); return p.length === 2 && isNum(p[0]) && isNum(p[1]) ? [p[0], p[1]] : null; }
      var f = parseFloat(s.replace(/[$,%]/g, '')); return isNum(f) ? f : null;
    }
    if (attr.type === 'cat') return s.split(',').map(function (q) { return q.trim(); }).filter(Boolean);
    return /^(yes|true|1)$/i.test(s);
  }
  FL.ruleFrom = function (combine, conditions) {
    var items = [];
    (conditions || []).slice(0, 8).forEach(function (c) {
      var a = c && MC.segments.attr(c.attr);
      if (!a) return;
      var v = parseValue(a, c.cmp, c.value);
      if (v === null) return;
      items.push({ attr: a.key, cmp: c.cmp, value: v });
    });
    if (!items.length) return null;
    var rule = { op: combine === 'any' ? 'any' : 'all', items: items };
    return MC.segments.validate(rule).length ? null : rule;
  };

  function scoutExtras(world, job, data, ground) {
    var out = [], originals = 0;
    (Array.isArray(data.segments) ? data.segments : []).slice(0, 4).forEach(function (x) {
      if (!x) return;
      var name = cleanText(x.name, ground, 48);
      var m = /^c(\d+)$/.exec(x.candidate || ''), cand = m ? job.candidates[+m[1]] : null;
      if (cand) {
        if (!name) return;
        var acts = clone(cand.actions || []), hit = false;
        acts.forEach(function (a) { if (a.type === 'segment/create' && a.payload && a.payload.segment) { a.payload.segment.name = name; hit = true; } });
        if (!hit) return;
        out.push({ kind: cand.kind, replaces: x.candidate, target: cand.target, actions: acts, title: String(cand.title || '').replace(/“[^”]*”/, '“' + name + '”'),
          why: cleanText(x.why, ground, 600) });
        return;
      }
      if (originals >= 1 || !name) return;
      var rule = FL.ruleFrom(x.combine, x.conditions);
      if (!rule) return;
      var seg = { name: name, rule: rule };
      var d = MC.catalog.get('segment/create');
      if (d && d.validate && d.validate(world, { segment: seg }, { origin: 'agent:scout', agent: true, agentId: 'scout' })) return;
      originals++;
      out.push({ kind: 'new-segment', target: { kind: 'segment', id: 'rule-' + MC.util.digest(rule) },
        actions: [{ type: 'segment/create', payload: { segment: seg } }], title: 'Save a new audience: ' + name,
        why: cleanText(x.why, ground, 600), diff: [{ label: 'New segment', before: '—', after: name }, { label: 'Rule', before: '—', after: MC.segments.describe(rule) }] });
    });
    return out;
  }

  // validate(world, job, data, ground) -> {ok, payload?, error?}
  FL.validate = function (world, job, data, ground) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.decisions)) return { ok: false, error: 'schema' };
    var n = (job.candidates || []).length, seen = {}, decisions = [];
    data.decisions.forEach(function (d) {
      if (!d || typeof d.candidate !== 'string') return;
      var m = /^c(\d+)$/.exec(d.candidate);
      if (!m || +m[1] >= n || seen[d.candidate]) return;
      seen[d.candidate] = true;
      var cand = job.candidates[+m[1]], adj = {}, tun = FL.tunables(job.agentId, cand);
      (Array.isArray(d.adjust) ? d.adjust : []).forEach(function (a) {
        var t = a && tun.filter(function (x) { return x.param === a.param; })[0];
        if (t && isNum(a.value) && a.value >= t.min && a.value <= t.max) adj[t.param] = a.value;
      });
      decisions.push({ candidate: d.candidate, verdict: d.verdict === 'propose' ? 'propose' : 'skip', adjust: adj,
        title: cleanText(d.title, ground, 140), why: cleanText(d.why, ground, 600),
        confidence: isNum(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : 0.5 });
    });
    // No usable decision: either candidates went unanswered, or every reference was unknown or malformed.
    if ((n || data.decisions.length) && !decisions.length) return { ok: false, error: 'no-decisions' };
    var extra = [];
    try {
      if (job.agentId === 'copy') extra = copyExtras(world, job, data, ground);
      if (job.agentId === 'scout') extra = scoutExtras(world, job, data, ground);
    } catch (e) { report(e); extra = []; }
    // A rewrite only stands in for a candidate Haiku chose to propose.
    extra = extra.filter(function (x) {
      if (!x.replaces) return true;
      return decisions.some(function (d) { return d.candidate === x.replaces && d.verdict === 'propose'; });
    });
    extra.forEach(function (x) {
      var d = x.replaces && decisions.filter(function (q) { return q.candidate === x.replaces; })[0];
      if (!d) return;
      if (d.title) x.title = d.title;
      if (!x.why && d.why) x.why = d.why;
    });
    var insights = [];
    (Array.isArray(data.insights) ? data.insights : []).slice(0, 8).forEach(function (x) {
      if (!x) return;
      var title = cleanText(x.title, ground, 140), body = cleanText(x.body, ground, 900);
      if (!title) return;
      var ref = /^i\d+$/.test(x.ref || '') && +x.ref.slice(1) < (job.insights || []).length ? x.ref : '';
      if (!ref && !body) return;
      var eid = str(x.entityId, 80);
      if (eid && !MC.catalog.entityById(world, eid)) eid = '';
      insights.push({ ref: ref, title: title, body: body, severity: x.severity === 'crit' || x.severity === 'warn' ? x.severity : 'info', entityId: eid });
    });
    return { ok: true, payload: { runId: job.runId, agentId: job.agentId, decisions: decisions, extra: extra, insights: insights,
      summary: cleanText(data.summary, ground, 240), model: AI.MODEL } };
  };

  /* ---------------- the bridge ---------------- */
  var inflight = {};
  FL.inflight = function () { return Object.keys(inflight).sort(); };

  function dispatch(payload) {
    if (!MC.store || typeof MC.store.dispatch !== 'function') return { ok: false };
    var w = MC.store.getState();
    if (!w || !w.ai || !w.ai.pending || !w.ai.pending[payload.runId]) return { ok: false };
    var r = MC.store.dispatch({ type: 'agent/aiRun', payload: payload });
    if (!r.ok) report(new Error('agent/aiRun rejected: ' + r.error));
    return r;
  }
  function fallback(job, why) {
    if (AI.noteFallback) AI.noteFallback();
    FL.last = { runId: job.runId, agentId: job.agentId, result: 'fallback', reason: why };
    return dispatch({ runId: job.runId, agentId: job.agentId, fallback: true, reason: String(why || 'unavailable').slice(0, 60) });
  }

  // enqueue({runId, agentId, tick, obs, candidates, insights, trace, mode, reason}) — called by the runtime
  // during a tick; all work is deferred out of the tick.
  FL.enqueue = function (job) {
    if (!job || inflight[job.runId]) return;
    var t0 = clock(), done = false;
    inflight[job.runId] = true;
    function finish(fn) { if (done) return; done = true; delete inflight[job.runId]; later(fn); }
    if (!(AI.isOn && AI.isOn())) { finish(function () { fallback(job, 'off'); }); return; }
    setTimeout(function () { finish(function () { fallback(job, 'timeout'); }); }, FL.DEADLINE_MS);
    later(function () {
      var world = MC.store.getState();
      if (!world || !world.ai || !world.ai.pending || !world.ai.pending[job.runId]) { done = true; delete inflight[job.runId]; return; }
      var ctx;
      try { ctx = AI.context.build(world, job); } catch (e) { report(e); finish(function () { fallback(job, 'context'); }); return; }
      AI.call({ system: ctx.system, user: ctx.user, schema: FL.schemaFor(job.agentId), maxTokens: 4000, effort: 'low', kind: 'agent',
        timeoutMs: Math.max(200, FL.DEADLINE_MS - (clock() - t0)) }).then(function (r) {
        if (done) return;
        if (!r.ok) { finish(function () { fallback(job, r.error); }); return; }
        var w = MC.store.getState(), v;
        try { v = FL.validate(w, job, r.data, ctx.ground); } catch (e) { report(e); v = { ok: false, error: 'validation' }; }
        if (!v.ok) { finish(function () { fallback(job, v.error); }); return; }
        v.payload.ms = Math.round(r.ms);
        finish(function () {
          if (AI.noteRun) AI.noteRun('agent');
          FL.last = { runId: job.runId, agentId: job.agentId, result: 'haiku', ms: v.payload.ms };
          dispatch(v.payload);
        });
      });
    });
  };

  /* ---------------- keep the logged world flag in step with the connection ---------------- */
  var syncing = false;
  FL.sync = function () {
    if (syncing || !MC.store || typeof MC.store.getState !== 'function') return;
    var w = MC.store.getState(), s = AI.state ? AI.state() : 'off';
    if (!w || s === 'connecting') return;
    var want = !!(AI.isOn && AI.isOn()), have = !!(w.ai && w.ai.on);
    syncing = true;
    try {
      if (want !== have) MC.store.dispatch({ type: 'ai/setEnabled', payload: { on: want } });
      // Waiting runs with nobody working on them (e.g. after a page error) complete with their drafts.
      var pend = (w.ai && w.ai.pending) || {};
      Object.keys(pend).sort().forEach(function (rid) {
        if (!inflight[rid]) later(function () { var j = pend[rid]; fallback({ runId: rid, agentId: j.agentId }, 'orphan'); });
      });
    } finally { syncing = false; }
  };
  if (AI.subscribe) AI.subscribe(function () { later(FL.sync); });
  if (MC.store && typeof MC.store.subscribe === 'function') MC.store.subscribe(function () { if (!syncing) FL.sync(); });
})();
