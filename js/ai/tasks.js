/* Marketing Cloud - MC.ai.tasks: on-demand Haiku tasks for the views (§12.6). Every task returns a
   Promise that always resolves (never rejects) with a usable result: Haiku's when connected and valid,
   otherwise the rule-based fallback. Results carry `source: 'ai' | 'rules'` for logging only; views must not
   badge them (§12.7). Also registers MC.copy.generateAsync for the Content Studio. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var AI = MC.ai = MC.ai || {};
  var TK = AI.tasks = AI.tasks || {};

  var TIMEOUT_MS = 15000;
  TK.TIMEOUT_MS = TIMEOUT_MS;

  function report(e) { if (window.console && console.error) console.error(e); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function str(x, max) { var s = typeof x === 'string' ? x.trim() : ''; return max && s.length > max ? s.slice(0, max) : s; }
  function world() { try { return MC.store && MC.store.getState ? MC.store.getState() : null; } catch (e) { return null; } }
  function on() { return !!(AI.isOn && AI.isOn()); }
  function FL() { return AI.fleet; }
  function obj(props) { return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props }; }
  var S = { type: 'string' }, N = { type: 'number' };
  function clean(s, ground, max) { return FL() && FL().cleanText ? FL().cleanText(s, ground, max) : str(s, max); }

  // Runs one Haiku task; resolves the validated value or null.
  function ask(instructions, extra, schema, validate, opts) {
    opts = opts || {};
    if (!on() || !AI.context) return Promise.resolve(null);
    var ctx;
    try { ctx = AI.context.forTask(opts.noWorld ? null : world(), instructions, extra, opts.userText); } catch (e) { report(e); return Promise.resolve(null); }
    return AI.call({ system: ctx.system, user: ctx.user, schema: schema, maxTokens: opts.maxTokens || 2000, effort: 'low', kind: 'task',
      timeoutMs: opts.timeoutMs || TIMEOUT_MS }).then(function (r) {
      if (!r.ok) { if (AI.noteFallback) AI.noteFallback(); return null; }
      var v = null;
      try { v = validate(r.data, ctx.ground); } catch (e) { report(e); v = null; }
      if (v === null || v === undefined) { if (AI.noteFallback) AI.noteFallback(); return null; }
      if (AI.noteRun) AI.noteRun('task');
      return v;
    }, function (e) { report(e); return null; });
  }
  TK._ask = ask;

  /* ---------------- writeVariants ---------------- */
  function ruleVariants(brief) {
    if (!(MC.copy && typeof MC.copy.generate === 'function')) return [];
    try { return MC.copy.generate(brief) || []; } catch (e) { report(e); return []; }
  }
  // writeVariants({channel, tone, productId, offer, count=3, locks, seedKey, notes?, campaignId?}) -> Promise<VariantDraft[]>
  // Same shape as MC.copy.generate: [{tmpId, channel, name, fields, tone, offer, productId, predicted, source}].
  TK.writeVariants = function (brief) {
    brief = Object.assign({ count: 3 }, brief || {});
    brief.count = Math.max(1, Math.min(8, brief.count | 0 || 3));
    var base = ruleVariants(brief);
    function rules() { return base.map(function (v) { v.source = 'rules'; return v; }); }
    if (!on() || !base.length || !FL()) return Promise.resolve(rules());
    var ch = brief.channel, fields = (MC.copy.FIELDS && MC.copy.FIELDS[ch]) || [];
    var prod = MC.copy.productOf ? MC.copy.productOf(brief.productId) : null;
    var instructions = 'Write ' + brief.count + ' distinct ' + ch + ' variants for Fernway. Tone: ' + (brief.tone || 'practical') +
      '. Offer: ' + ((MC.copy.OFFER_LABEL || {})[brief.offer] || brief.offer || 'none') + '. Product: ' + (prod ? prod.name : 'the catalog') +
      '. Fill only these fields: ' + fields.filter(function (k) { return FL().FIELD_KEYS.indexOf(k) >= 0; }).join(', ') +
      ' (others ""). Each variant needs a different hook. Follow the brand book and limits exactly.' + (brief.notes ? ' Notes from the marketer: ' + str(brief.notes, 600) : '');
    var F = {};
    FL().FIELD_KEYS.forEach(function (k) { F[k] = S; });
    var schema = obj({ variants: { type: 'array', items: obj({ fields: obj(F) }) } });
    var w = world() || { guardrails: null };
    return ask(instructions, { locks: brief.locks || {}, campaignId: brief.campaignId || '' }, schema, function (data) {
      var out = [];
      (data.variants || []).slice(0, brief.count).forEach(function (x, i) {
        var b = base[i] || base[0];
        var f = Object.assign({}, x.fields || {}, brief.locks || {});
        var v = FL()._buildVariant(b, f, w);
        if (!v) return;
        v.tmpId = b.tmpId || ('$v' + i); v.name = b.name || String.fromCharCode(65 + i); v.source = 'ai';
        out.push(v);
      });
      return out.length ? out : null;
    }).then(function (ai) {
      if (!ai) return rules();
      // Top up with rule drafts if some were rejected by the brand checks.
      for (var i = ai.length; i < brief.count && base[i]; i++) { base[i].source = 'rules'; ai.push(base[i]); }
      return ai.map(function (v, k) { v.tmpId = '$v' + k; v.name = String.fromCharCode(65 + k); return v; });
    });
  };

  // Content Studio hook: same input/output as MC.copy.generate, Promise-returning, always falls back.
  if (MC.copy && typeof MC.copy.generate === 'function' && typeof MC.copy.generateAsync !== 'function') {
    MC.copy.generateAsync = function (opts) {
      return TK.writeVariants(opts).then(function (list) { return list && list.length ? list : ruleVariants(opts); },
        function () { return ruleVariants(opts); });
    };
  }

  /* ---------------- briefFromText ---------------- */
  var GOALS = ['revenue', 'conversions', 'reactivation', 'engagement', 'launch'];
  function today(w) { return w && MC.time ? MC.time.dayOf(w.meta.tick) : 0; }

  // Rule-based brief from free text (used when Haiku is off or fails).
  function ruleBrief(text, w) {
    if (MC.planner && typeof MC.planner.briefFromText === 'function') { try { var b0 = MC.planner.briefFromText(text, w); if (b0) return b0; } catch (e) { report(e); } }
    var t = String(text || '').toLowerCase(), d0 = today(w) + 1;
    var goal = /win.?back|lapsed|reactivat/.test(t) ? 'reactivation' : (/launch|new product|introduc/.test(t) ? 'launch'
      : (/engag|clicks?|awareness/.test(t) ? 'engagement' : (/conversion|orders?|sign.?ups?/.test(t) ? 'conversions' : 'revenue')));
    var chans = MC.CH.ALL.filter(function (c) { return new RegExp('\\b' + (c === 'social' ? 'social|instagram|facebook' : (c === 'web' ? 'web|display|banner' : c)) + '\\b').test(t); });
    if (!chans.length) chans = ['email', 'push'];
    var m = /\$\s?([\d,.]+)\s*(k)?/.exec(t), budget = m ? parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1) : 5000;
    var dm = /(\d+)\s*(day|week)/.exec(t), len = dm ? (+dm[1]) * (dm[2] === 'week' ? 7 : 1) : 7;
    var tone = (MC.copy && MC.copy.TONES || []).filter(function (x) { return t.indexOf(x) >= 0; })[0] || (/urgent|flash|hurry/.test(t) ? 'urgent' : 'practical');
    var offer = /25%|25 percent/.test(t) ? 'pct25' : (/15%|15 percent/.test(t) ? 'pct15' : (/free ship/.test(t) ? 'freeship' : (/gift/.test(t) ? 'gift' : 'none')));
    var prods = (MC.data && MC.data.PRODUCTS) || [], prod = prods.filter(function (p) { return t.indexOf(p.name.toLowerCase()) >= 0; })[0] || null;
    var segs = w && w.segments ? (w.segments.order || Object.keys(w.segments.byId)).map(function (id) { return w.segments.byId[id]; }) : [];
    var seg = segs.filter(function (s) { return s && t.indexOf(s.name.toLowerCase()) >= 0; })[0] || null;
    return { name: str(text, 48) || 'New campaign', goal: { type: goal, target: 0 }, productFocus: prod ? prod.id : null, segmentId: seg ? seg.id : null,
      budget: Math.max(500, Math.min(50000, Math.round(budget))), startDay: d0, endDay: d0 + Math.max(1, Math.min(42, len)) - 1, channels: chans,
      tone: tone, offer: offer, notes: str(text, 600) };
  }
  TK.ruleBrief = ruleBrief;

  // briefFromText(text) -> Promise<Brief & {source, narrative}>; Brief as §10.9 (feed it to MC.planner.plan).
  TK.briefFromText = function (text) {
    var w = world(), fallback = ruleBrief(text, w);
    fallback.source = 'rules';
    if (!on() || !str(text)) return Promise.resolve(fallback);
    var segIds = w && w.segments ? Object.keys(w.segments.byId).sort() : [];
    var schema = obj({ name: S, goalType: { type: 'string', enum: GOALS }, goalTarget: N, productId: S, segmentId: S, budget: N,
      startInDays: N, lengthDays: N, channels: { type: 'array', items: { type: 'string', enum: MC.CH.ALL } },
      tone: { type: 'string', enum: (MC.copy && MC.copy.TONES) || ['practical'] }, offer: { type: 'string', enum: (MC.copy && MC.copy.OFFERS) || ['none'] },
      narrative: S });
    var instructions = 'Turn the marketer\'s description into a campaign brief. Use product and segment ids from the reference and snapshot ("" if none fits). ' +
      'startInDays counts from today (1 = tomorrow). goalTarget 0 lets the planner set it. "narrative": two or three sentences on who it is for, what it says and when it runs.\n\nDescription: ' + str(text, 2000);
    return ask(instructions, null, schema, function (d, ground) {
      if (!d || GOALS.indexOf(d.goalType) < 0) return null;
      var chans = (d.channels || []).filter(function (c, i, a) { return MC.CH.ALL.indexOf(c) >= 0 && a.indexOf(c) === i; });
      if (!chans.length) return null;
      var prods = (MC.data && MC.data.PRODUCTS) || [];
      var start = today(w) + Math.max(1, Math.min(60, Math.round(isNum(d.startInDays) ? d.startInDays : 1)));
      var len = Math.max(1, Math.min(42, Math.round(isNum(d.lengthDays) ? d.lengthDays : 7)));
      return { name: str(d.name, 60) || fallback.name, goal: { type: d.goalType, target: isNum(d.goalTarget) && d.goalTarget > 0 ? Math.round(d.goalTarget) : 0 },
        productFocus: prods.some(function (p) { return p.id === d.productId; }) ? d.productId : null,
        segmentId: segIds.indexOf(d.segmentId) >= 0 ? d.segmentId : null,
        budget: Math.max(500, Math.min(50000, Math.round(isNum(d.budget) ? d.budget : fallback.budget))),
        startDay: start, endDay: start + len - 1, channels: chans, tone: d.tone, offer: d.offer,
        notes: clean(d.narrative, ground, 800) || str(text, 600), narrative: clean(d.narrative, ground, 800), source: 'ai' };
    }, { userText: str(text, 2000) }).then(function (b) { return b || fallback; });
  };

  /* ---------------- segmentFromText ---------------- */
  function ruleSegment(text, w) {
    var r = null;
    try { r = MC.segments.parse(text, w); } catch (e) { report(e); }
    r = r || { rule: null, matched: [], ignored: [], confidence: 0 };
    return Object.assign({}, r, { name: r.rule && MC.segments.nameFor ? MC.segments.nameFor(r.rule) : '', why: '', source: 'rules' });
  }
  // segmentFromText(text) -> Promise<{rule, name, why, matched, ignored, confidence, count?, source}>
  TK.segmentFromText = function (text) {
    var w = world(), fb = ruleSegment(text, w);
    if (!on() || !str(text) || !FL()) return Promise.resolve(fb);
    var schema = obj({ name: S, why: S, combine: { type: 'string', enum: ['all', 'any'] },
      conditions: { type: 'array', items: obj({ attr: S, cmp: S, value: S }) } });
    var instructions = 'Turn the marketer\'s audience description into a segment rule over segmentAttributes (keys and ops exactly as listed). ' +
      FL().VALUE_FORMAT + ' ' +
      'Name it in plain words under 48 characters; "why" says in one sentence how the rule reads the description.\n\nDescription: ' + str(text, 1000);
    return ask(instructions, null, schema, function (d, ground) {
      var rule = FL().ruleFrom(d.combine, d.conditions);
      if (!rule) return null;
      var out = { rule: rule, name: clean(d.name, ground, 48) || MC.segments.nameFor(rule), why: clean(d.why, ground, 400),
        matched: [], ignored: [], confidence: 0.8, source: 'ai' };
      if (w) { try { out.count = MC.segments.evaluate(w, rule).count; } catch (e) { /* skip */ } }
      return out;
    }, { userText: str(text, 1000) }).then(function (r) { return r || fb; });
  };

  /* ---------------- explain ---------------- */
  function resolveEntity(e, w) {
    if (!e) return null;
    if (typeof e === 'string') e = { id: e };
    if (e.kind === 'insight' || (!e.agentId && e.id && w && (w.insights || []).some(function (x) { return x.id === e.id; }))) {
      var ins = (w.insights || []).filter(function (x) { return x.id === e.id; })[0];
      return ins ? { type: 'insight', item: ins } : (e.title ? { type: 'insight', item: e } : null);
    }
    var p = w && w.proposals && w.proposals.byId[e.id];
    if (p) return { type: 'proposal', item: p };
    if (e.title && (e.rationale !== undefined || e.body !== undefined)) return { type: e.rationale !== undefined ? 'proposal' : 'insight', item: e };
    return null;
  }
  function ruleExplain(r) {
    if (!r) return '';
    var x = r.item;
    if (r.type === 'insight') return x.body || x.title || '';
    var parts = [x.why || x.rationale || ''];
    (x.evidence || []).slice(0, 4).forEach(function (ev) { if (ev && ev.label) parts.push(ev.label + ': ' + ev.value + '.'); });
    var blocked = (x.guardrails || []).filter(function (g) { return g.blocking && !g.pass; })[0];
    if (blocked) parts.push('It is held back by the ' + blocked.label + ' guardrail: ' + blocked.detail);
    return parts.filter(Boolean).join(' ');
  }
  // explain(entity, question?) -> Promise<{text, source}>. entity: a proposal or insight (object or id).
  TK.explain = function (entity, question) {
    var w = world(), r = resolveEntity(entity, w), fb = { text: ruleExplain(r), source: 'rules' };
    if (!on() || !r) return Promise.resolve(fb);
    var x = r.item, detail = r.type === 'proposal'
      ? { type: 'proposal', agent: x.agentId, title: x.title, rationale: x.rationale, evidence: x.evidence, impact: x.impact, risk: x.risk,
        guardrails: x.guardrails, changes: x.diff, status: x.status, reason: x.reason, realized: x.realized }
      : { type: 'insight', agent: x.agentId, title: x.title, body: x.body, severity: x.severity, entity: x.entity };
    var instructions = 'The marketer asks: "' + (str(question, 400) || 'Why?') + '" about the ' + r.type + ' in DETAILS. Answer in three to five plain sentences, ' +
      'using only numbers that appear in the context. Say what the evidence shows, what could make it wrong, and what happens if they approve or ignore it.';
    return ask(instructions, detail, obj({ answer: S }), function (d, ground) {
      var t = clean(d.answer, ground, 1500);
      return t ? { text: t, source: 'ai' } : null;
    }, { userText: str(question, 400) }).then(function (v) { return v || fb; });
  };

  /* ---------------- planFromGoal (missions) ---------------- */
  // planFromGoal(goalText, world) -> Promise<{objective, plan, asks, data, source:'ai'|'rules'}>. Always resolves.
  // Haiku reads the sentence and proposes the objective and an ordered plan; both are validated against the mission schema
  // (metric, target, deadline, constraint kinds, step kinds), forced through the same guardrails as the rules planner
  // (audience before campaign, a monitoring step, limits the marketer wrote are never dropped) and otherwise replaced by the rules plan.
  TK.planFromGoal = function (goalText, w) {
    w = w || world();
    var Ld = MC.lead, text = str(goalText, 400);
    var rules = Ld.plan(w, text);
    var fb = { objective: rules.objective, plan: rules.plan, asks: rules.asks, data: rules.data, source: 'rules' };
    if (!on() || !text || !FL() || !w) return Promise.resolve(fb);
    var segIds = Object.keys(w.segments.byId).sort(), kinds = Ld.KINDS;
    var schema = obj({
      template: { type: 'string', enum: Ld.TEMPLATES }, metric: { type: 'string', enum: Ld.METRICS }, target: N, byInDays: N, audience: S, segmentId: S,
      constraints: { type: 'array', items: obj({ kind: { type: 'string', enum: Ld.CONSTRAINT_KINDS }, value: S }) },
      steps: { type: 'array', items: obj({ kind: { type: 'string', enum: kinds }, title: S, after: { type: 'array', items: N } }) }
    });
    var instructions = 'Plan a marketing mission from the marketer\'s sentence. Pick the template (winback, launch, event, grow, protect), the metric (reactivations, revenue, orders, signups, unsubs), ' +
      'the numeric target and how many days from today the deadline is (byInDays). "audience" is a short plain label for who it is for; "segmentId" is one of the saved segment ids in the snapshot or "". ' +
      'Copy every limit the marketer states into "constraints": maxDiscountPct (number), maxSpend (dollars), maxSendsPerWeek (number), excludeChannel (email, sms, push, social or web); values as strings. Never invent limits. ' +
      'Then list 5 to 12 steps in order. Step kinds and owners: goal (Lead, always first), audience (Segment Scout), campaign (Campaign Planner), copy (Copy Drafter), guard (Fatigue Guard), sendtime (Send-Time Tuner), pacer (Budget Pacer), handoff (Lead), monitor (Insight Analyst, always last). ' +
      '"after" lists the 1-based numbers of steps that must finish first. Audience comes before campaign; copy, sendtime and pacer come after campaign. A protect-the-list mission has no campaign or copy step.\n\nSentence: ' + text;
    return ask(instructions, { segmentIds: segIds }, schema, function (d, ground) {
      if (!d || Ld.TEMPLATES.indexOf(d.template) < 0 || Ld.METRICS.indexOf(d.metric) < 0) return null;
      if (!(isNum(d.target) && d.target > 0) || !(isNum(d.byInDays) && d.byInDays >= 1 && d.byInDays <= 120)) return null;
      if (!Array.isArray(d.steps) || d.steps.length < 3 || d.steps.length > Ld.MAX_STEPS) return null;
      var today = MC.time.dayOf(w.meta.tick), parsed = Ld.parse(text, w), cons = parsed.constraints.slice();
      var extra = (d.constraints || []).map(function (c) {
        if (Ld.CONSTRAINT_KINDS.indexOf(c.kind) < 0) return null;
        if (c.kind === 'excludeChannel') return MC.CH.ALL.indexOf(c.value) >= 0 ? { kind: c.kind, value: c.value } : null;
        var v = parseFloat(String(c.value).replace(/[$,%]/g, ''));
        return isNum(v) && v >= 0 && (c.kind !== 'maxDiscountPct' || v <= 100) ? { kind: c.kind, value: v } : null;
      }).filter(Boolean);
      cons = Ld.mergeConstraints(extra, cons);       // limits the marketer actually wrote win over a paraphrase
      var by = parsed.byGiven ? parsed.by : today + Math.round(d.byInDays);
      var objective = { metric: d.metric, target: parsed.targetGiven && parsed.target && !parsed.growthPct && parsed.metric === d.metric ? parsed.target : Math.round(d.target),
        by: by, deadlineText: parsed.byGiven ? parsed.deadlineText : 'by ' + Ld.dayShort(by), constraints: cons, direction: d.metric === 'unsubs' ? 'atMost' : 'atLeast' };
      var steps = [];
      for (var i = 0; i < d.steps.length; i++) {
        var x = d.steps[i];
        if (Ld.KINDS.indexOf(x.kind) < 0) return null;
        var needs = (x.after || []).map(function (n) { return Math.round(n); }).filter(function (n) { return n >= 1 && n <= i; }).map(function (n) { return 's' + n; });
        if (!needs.length && i > 0) needs = ['s' + i];
        var title = clean(x.title, ground, 120) || Ld.KIND_TITLE[x.kind];
        steps.push(Ld.step('s' + (i + 1), x.kind, title, needs));
      }
      var np = Ld.normalizePlan(steps);
      if (!np.ok) return null;
      var bad = Ld.checkPlan(np.plan, d.template);
      if (bad) return null;
      var aud = Object.assign({}, rules.data.audience);
      if (segIds.indexOf(d.segmentId) >= 0) { aud.segmentId = d.segmentId; if (!aud.label) aud.label = str(d.audience, 40).toLowerCase(); }
      else if (!aud.label && d.audience) aud.label = str(d.audience, 40).toLowerCase();
      var data = Object.assign({}, rules.data, { template: d.template, audience: aud, parsedBy: 'claude', missing: [] });
      return { objective: objective, plan: np.plan, asks: [], data: data, source: 'ai' };
    }, { userText: text }).then(function (r) { return r || fb; });
  };
})();
