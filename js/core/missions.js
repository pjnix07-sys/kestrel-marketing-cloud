/* Marketing Cloud - MC.missions: the mission engine (docs/AGENTIC.md). World slice `missions` {byId, order}.
   A Mission is an outcome, a deadline and constraints in one sentence; it owns a plan of Steps run by the agents, Asks for
   the marketer, Beats (the narration) and artifacts (real campaigns, segments, variants it made).

   Determinism: every state change is a catalog action (mission/*). Actions from people (create, answer, steer, setStatus)
   and the work pulse (mission/work: start a step, run it, raise an ask) are logged and replayed. What the world clock does on
   a tick (check in, re-plan, resume) is a deterministic function of the world and the tick, applied with origin 'mission'
   (not logged, like agent work), so seed + log reproduce missions exactly. Steps execute REAL catalog actions (segment/create, campaign/create,
   variant/create, profiles/suppress, campaign/setSendHour, campaign/setBudget, ...) through MC.catalog.apply with the
   specialist agent as origin, reusing the planner, copy and guard/send-time/pacer scoring. Nothing here reads a clock
   or a random source; Claude only plans (MC.ai.tasks.planFromGoal) and its result travels in the mission/create payload. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var M = MC.missions = MC.missions || {};
  var assign = Object.assign;

  /* ---------------- pacing (ticks of work per step; the engine runs one tick per 1.2 s) ---------------- */
  M.CHECKIN_HOUR = 9;          // Insight Analyst's daily check-in
  M.REPLAN_GAP_DAYS = 3;       // at most one drift re-plan every three days
  M.MAX_REPLANS = 3;
  M.MAX_LOG = 120;
  M.STATUSES = ['planning', 'running', 'waiting', 'paused', 'done', 'stopped'];
  M.PHASES = ['planning', 'executing', 'monitoring'];
  M.MIN_AUDIENCE = 300;

  function L() { return MC.lead; }
  function T() { return MC.time; }
  function F() { return MC.F; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isInt(x) { return isNum(x) && Math.floor(x) === x; }
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function clone(o) { return MC.util.clone(o); }
  function sortedKeys(o) { return Object.keys(o || {}).sort(); }
  function report(e) { if (window.console && console.error) console.error(e); }
  function money(x) { return MC.fmt.money(x); }
  function moneyS(x) { return Math.abs(x) >= 10000 ? MC.fmt.money(x, { compact: true }) : MC.fmt.money(x); }
  function num(x) { return MC.fmt.num(Math.round(x)); }
  function pct(x, dp) { return MC.fmt.pct(x, dp === undefined ? 0 : dp); }
  function chLower(ch) { return ch === 'sms' ? 'SMS' : (MC.CH.LABEL[ch] || ch).toLowerCase(); }
  function chName(ch) { return MC.CH.LABEL[ch] || ch; }
  function listJoin(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function dayShort(d) { return L().dayShort(d); }
  function ensure(world) { if (!world.missions) world.missions = { byId: {}, order: [] }; return world.missions; }
  function getM(world, id) { return world.missions && world.missions.byId[id]; }
  function putM(world, m) {
    var s = ensure(world), byId = assign({}, s.byId);
    byId[m.id] = m;
    world.missions = assign({}, s, { byId: byId });
  }
  M.get = function (world, id) { return getM(world, id) || null; };
  M.list = function (world) { var s = world.missions; return s ? s.order.map(function (id) { return s.byId[id]; }).filter(Boolean) : []; };

  /* ======================= beats, normalization ======================= */
  var BEAT_KINDS = ['thought', 'handoff', 'did', 'ask', 'replan', 'result', 'disagree'];
  function cleanBeat(b, tick) {
    var o = { tick: isNum(b.tick) ? b.tick : tick, agentId: String(b.agentId || 'lead'), kind: BEAT_KINDS.indexOf(b.kind) >= 0 ? b.kind : 'thought', text: String(b.text || '').slice(0, 400) };
    if (b.ref !== undefined && b.ref !== null) o.ref = b.ref;
    // beat.diff = [{what, from, to}]: what a steer or a step changed, in the marketer's words
    if (b.stepId) o.stepId = String(b.stepId).slice(0, 16);
    var diff = cleanDiff(b.diff);
    if (diff.length) o.diff = diff;
    // a disagreement carries both positions and how it was settled: sides = [{agentId, position}], resolution
    if (o.kind === 'disagree') {
      var sides = (Array.isArray(b.sides) ? b.sides : []).map(function (x) { return x && x.agentId ? { agentId: String(x.agentId), position: String(x.position || '').slice(0, 300) } : null; }).filter(Boolean).slice(0, 3);
      if (sides.length) o.sides = sides;
      if (b.resolution) o.resolution = String(b.resolution).slice(0, 300);
    }
    var dec = b.decision ? cleanDecision(b.decision) : null;
    if (dec) o.decision = dec;
    return o;
  }
  function cleanDiff(list) {
    return (Array.isArray(list) ? list : []).map(function (d) {
      return d && d.what ? { what: String(d.what).slice(0, 60), from: String(d.from === undefined || d.from === null ? '' : d.from).slice(0, 100), to: String(d.to === undefined || d.to === null ? '' : d.to).slice(0, 100) } : null;
    }).filter(Boolean).slice(0, 8);
  }
  // step.decision = {options:[{label, value, note}], chose, why}: what the agent weighed and why it chose one
  function cleanDecision(d) {
    if (!isObj(d) || !Array.isArray(d.options) || !d.options.length) return null;
    var opts = d.options.slice(0, 6).map(function (o) {
      return isObj(o) && o.label ? { label: String(o.label).slice(0, 80), value: String(o.value === undefined || o.value === null ? '' : o.value).slice(0, 60), note: String(o.note || '').slice(0, 160) } : null;
    }).filter(Boolean);
    if (!opts.length) return null;
    return { options: opts, chose: String(d.chose || opts[0].label).slice(0, 80), why: String(d.why || '').slice(0, 300) };
  }
  M.cleanDecision = cleanDecision;
  function addBeats(log, beats, tick) {
    var out = (log || []).slice();
    (beats || []).forEach(function (b) { if (b && b.text) out.push(cleanBeat(b, tick)); });
    while (out.length > M.MAX_LOG) {
      var k = -1;
      for (var i = 0; i < out.length; i++) if (out[i].kind === 'thought' || out[i].kind === 'did' || out[i].kind === 'handoff') { k = i; break; }
      out.splice(k >= 0 ? k : 0, 1);
    }
    return out;
  }
  function cleanConstraint(c) {
    if (!isObj(c) || L().CONSTRAINT_KINDS.indexOf(c.kind) < 0) return null;
    if (c.kind === 'excludeChannel') return MC.CH.ALL.indexOf(c.value) >= 0 ? { kind: c.kind, value: c.value } : null;
    return isNum(c.value) && c.value >= 0 ? { kind: c.kind, value: c.value } : null;
  }
  function cleanObjective(o, fallback) {
    o = o || {};
    var f = fallback || {};
    var metric = L().METRICS.indexOf(o.metric) >= 0 ? o.metric : f.metric;
    var cons = (Array.isArray(o.constraints) ? o.constraints : (f.constraints || [])).map(cleanConstraint).filter(Boolean);
    return { metric: metric, target: isNum(o.target) && o.target > 0 ? o.target : f.target, by: isInt(o.by) ? o.by : f.by,
      deadlineText: typeof o.deadlineText === 'string' ? o.deadlineText.slice(0, 40) : (f.deadlineText || ''), constraints: cons,
      direction: metric === 'unsubs' ? 'atMost' : 'atLeast' };
  }
  function openAsks(m, blockingOnly) {
    return (m.asks || []).filter(function (a) { return a.status === 'open' && (!blockingOnly || a.blocking !== false); });
  }
  function patchStep(plan, id, patch) {
    return plan.map(function (s) { return s.id === id ? assign({}, s, patch) : s; });
  }
  function addArtifact(list, a) {
    if (!a || !a.kind || !a.id) return list;
    for (var i = 0; i < list.length; i++) if (list[i].kind === a.kind && list[i].id === a.id) return list;
    return list.concat([{ kind: a.kind, id: a.id }]);
  }

  /* ======================= actions: validate / reduce ======================= */
  M.validate = function (name, world, p, ctx) {
    var m;
    if (name === 'work') return M.hasWork(world) ? null : 'No mission has work pending.';
    if (name === 'create') {
      if (typeof p.goalText !== 'string' || p.goalText.trim().length < 3) return 'Describe the goal in a sentence.';
      if (p.goalText.length > 400) return 'Keep the goal under 400 characters.';
      if (p.brain !== undefined && p.brain !== 'rules' && p.brain !== 'claude') return 'Unknown planner.';
      if (p.objective !== undefined) {
        if (!isObj(p.objective) || L().METRICS.indexOf(p.objective.metric) < 0) return 'The objective needs a metric.';
        if (!(isNum(p.objective.target) && p.objective.target > 0)) return 'The objective needs a target above zero.';
        if (!isInt(p.objective.by)) return 'The objective needs a deadline.';
      }
      if (p.plan !== undefined) {
        var np = L().normalizePlan(p.plan);
        if (!np.ok) return np.error;
        var ce = L().checkPlan(np.plan, p.data && p.data.template);
        if (ce) return ce;
        if (p.objective === undefined) return 'A plan needs its objective.';
      }
      return null;
    }
    m = getM(world, p.id);
    if (!m) return 'That mission no longer exists.';
    if (name === 'step') {
      if (m.status === 'stopped') return 'That mission has stopped.';
      if (p.stepId !== undefined && p.stepId !== null) {
        var found = (m.plan || []).some(function (s) { return s.id === p.stepId; });
        if (!found) return 'That step no longer exists.';
      }
      if (p.patch && p.patch.status !== undefined && ['queued', 'working', 'done', 'blocked', 'skipped'].indexOf(p.patch.status) < 0) return 'Unknown step status.';
      if (p.mission && p.mission.status !== undefined && M.STATUSES.indexOf(p.mission.status) < 0) return 'Unknown mission status.';
      return null;
    }
    if (name === 'ask') {
      if (!isObj(p.ask) || typeof p.ask.question !== 'string' || !p.ask.question) return 'An ask needs a question.';
      if (!Array.isArray(p.ask.options) || p.ask.options.length < 1) return 'An ask needs options.';
      return m.status === 'stopped' ? 'That mission has stopped.' : null;
    }
    if (name === 'answer') {
      var a = (m.asks || []).filter(function (x) { return x.id === p.askId; })[0];
      if (!a) return 'That question no longer exists.';
      if (a.status !== 'open') return 'That question has already been answered.';
      if (typeof p.answer !== 'string' || !p.answer.trim() || p.answer.length > 200) return 'Give an answer.';
      return null;
    }
    if (name === 'steer') {
      if (m.status === 'stopped' || m.status === 'done') return 'That mission has finished.';
      if (typeof p.text !== 'string' || p.text.trim().length < 2) return 'Say what to change.';
      if (p.text.length > 300) return 'Keep it under 300 characters.';
      if (p.constraints !== undefined && !Array.isArray(p.constraints)) return 'Constraints must be a list.';
      return null;
    }
    if (name === 'setStatus') {
      if (['running', 'paused', 'done', 'stopped'].indexOf(p.status) < 0) return 'Unknown status.';
      if (m.status === 'stopped' && p.status !== 'stopped') return 'A stopped mission can’t restart.';
      return null;
    }
    return 'Unknown mission action.';
  };

  function newAsk(m, a, tick) {
    var n = (m.asks || []).length + 1;
    var imp = isObj(a.impact) ? a.impact : {};
    var out = { id: typeof a.id === 'string' && a.id ? a.id : 'a' + n, stepId: a.stepId || null, agentId: a.agentId || 'lead', kind: a.kind || 'info',
      question: String(a.question).slice(0, 300), why: String(a.why || '').slice(0, 400),
      impact: { metric: String(imp.metric || ''), lo: isNum(imp.lo) ? imp.lo : 0, hi: isNum(imp.hi) ? imp.hi : 0 },
      options: a.options.map(function (o) { return String(o).slice(0, 80); }), default: typeof a.default === 'string' ? a.default : String(a.options[0]),
      blocking: a.blocking !== false, status: 'open', answer: null, by: null, createdTick: tick, answeredTick: null };
    if (a.field) out.field = a.field;
    if (Array.isArray(a.values)) out.values = a.values.slice();
    if (a.fix) out.fix = clone(a.fix);
    return out;
  }

  function applyPlanPatch(m, p, ctx) {
    // returns a new mission with step patch, added steps and mission patch applied
    var mm = assign({}, m), log = mm.log;
    if (p.stepId && isObj(p.patch)) {
      var allowed = {}, pt = p.patch;
      ['status', 'startedTick', 'doneTick', 'actions', 'artifact', 'note', 'title', 'needs', 'attempts', 'summary'].forEach(function (k) { if (pt[k] !== undefined) allowed[k] = pt[k]; });
      if (pt.decision) { var cd = cleanDecision(pt.decision); if (cd) allowed.decision = cd; }
      mm.plan = patchStep(m.plan, p.stepId, allowed);
      if (allowed.artifact) mm.artifacts = addArtifact(mm.artifacts || [], allowed.artifact);
    }
    if (Array.isArray(p.addSteps) && p.addSteps.length) {
      var used = {};
      mm.plan.forEach(function (s) { used[s.id] = true; });
      var add = [];
      p.addSteps.forEach(function (s) {
        if (!isObj(s) || L().KINDS.indexOf(s.kind) < 0 || mm.plan.length + add.length >= L().MAX_STEPS + 8) return;
        var id = s.id, k = mm.plan.length + add.length + 1;
        while (!id || used[id]) { id = 's' + (k++); }
        used[id] = true;
        var o = L().step(id, s.kind, String(s.title || L().KIND_TITLE[s.kind]).slice(0, 120), (s.needs || []).filter(function (n) { return used[n] && n !== id; }));
        ['limit', 'channel'].forEach(function (k2) { if (s[k2] !== undefined) o[k2] = s[k2]; });
        add.push(o);
      });
      mm.plan = mm.plan.concat(add);
    }
    if (isObj(p.mission)) {
      var mp = p.mission;
      ['status', 'phase', 'progress', 'title', 'lastCheckDay', 'lastBeatDay', 'resumeDay', 'replans', 'lastReplanDay', 'brain'].forEach(function (k) { if (mp[k] !== undefined) mm[k] = mp[k] === null ? null : (isObj(mp[k]) ? clone(mp[k]) : mp[k]); });
      if (mp.objective) mm.objective = cleanObjective(mp.objective, m.objective);
      if (mp.data) mm.data = assign({}, m.data || {}, clone(mp.data));
      if (Array.isArray(mp.artifacts)) mp.artifacts.forEach(function (a) { mm.artifacts = addArtifact(mm.artifacts || [], a); });
    }
    return mm;
  }

  M.reduce = function (name, world, p, ctx) {
    var C = MC.catalog, tick = ctx.tick, m, mm;
    if (name === 'work') { M.work(world, tick); return; }
    if (name === 'create') {
      var text = p.goalText.trim().replace(/\s+/g, ' ');
      var base = L().plan(world, text);
      var objective = p.objective ? cleanObjective(p.objective, base.objective) : base.objective;
      var plan = p.plan ? L().normalizePlan(p.plan).plan : base.plan;
      var asks = (p.plan ? (p.asks || []) : (p.asks || base.asks)).map(function (a, i) { return newAsk({ asks: [] }, assign({ id: 'a' + (i + 1) }, a), tick); });
      var data = assign({}, base.data, p.data ? clone(p.data) : {});
      data.overrides = data.overrides || {};
      var id = 'm-' + C._h.nextSeq(world);
      // a blocked step must have an open ask behind it
      plan = plan.map(function (s) {
        if (s.status === 'blocked' && !asks.some(function (a) { return a.stepId === s.id; })) return assign({}, s, { status: 'queued', note: '' });
        if (s.status !== 'blocked' && asks.some(function (a) { return a.stepId === s.id && a.blocking !== false; })) return assign({}, s, { status: 'blocked', note: 'Waiting for your answer.' });
        return s;
      });
      m = { id: id, title: String(p.title || base.title).slice(0, 140), goalText: text, objective: objective, status: 'planning', phase: 'planning',
        createdTick: tick, brain: p.brain === 'claude' ? 'claude' : 'rules', plan: plan, asks: asks, artifacts: [], log: [],
        progress: { value: 0, target: objective.target, forecast: 0, lo: 0, hi: 0 }, data: data, replans: 0, lastReplanDay: null, lastCheckDay: null,
        resumeDay: null, lastBeatDay: null, steers: [] };
      var beats = [{ agentId: 'lead', kind: 'thought', text: L().voice.opening(m) }];
      beats.push({ agentId: 'lead', kind: 'thought', text: L().voice.planned(m) });
      asks.forEach(function (a) { beats.push({ agentId: a.agentId, kind: 'ask', text: a.question, ref: a.id }); });
      m.log = addBeats([], beats, tick);
      if (openAsks(m, true).length) m.status = 'waiting';
      putM(world, m);
      var s = ensure(world);
      world.missions = assign({}, s, { order: s.order.concat([id]) });
      ctx.created.push(id);
      return;
    }
    m = getM(world, p.id);
    if (name === 'step') {
      mm = applyPlanPatch(m, p, ctx);
      mm.log = addBeats(m.log, p.beats, tick);
      putM(world, mm);
      return;
    }
    if (name === 'ask') {
      var ask = newAsk(m, p.ask, tick);
      mm = assign({}, m, { asks: (m.asks || []).concat([ask]) });
      if (ask.stepId && ask.blocking) mm.plan = m.plan.map(function (s) { return s.id === ask.stepId && s.status !== 'done' ? assign({}, s, { status: 'blocked', note: 'Waiting for your answer.' }) : s; });
      if (ask.blocking && (m.status === 'running' || m.status === 'planning')) mm.status = 'waiting';
      mm.log = addBeats(m.log, [{ agentId: ask.agentId, kind: 'ask', text: ask.question, ref: ask.id }], tick);
      putM(world, mm);
      ctx.created.push(ask.id);
      return;
    }
    if (name === 'answer') {
      var a = (m.asks || []).filter(function (x) { return x.id === p.askId; })[0];
      var res = L().onAnswer(m, a, p.answer.trim(), world);
      var answerBeat = [];
      mm = assign({}, m);
      if (res.reask) { mm.log = addBeats(m.log, res.beats, tick); putM(world, mm); return; }
      mm.asks = (m.asks || []).map(function (x) { return x.id === a.id ? assign({}, x, { status: 'answered', answer: p.answer.trim(), by: ctx.by || 'you', answeredTick: tick }) : x; });
      if (res.objective) mm.objective = cleanObjective(res.objective, m.objective);
      if (res.data) mm.data = assign({}, m.data || {}, clone(res.data));
      if (res.replacePlan) mm.plan = L().normalizePlan(res.replacePlan).plan;
      sortedKeys(res.steps).forEach(function (sid) { mm.plan = patchStep(mm.plan, sid, res.steps[sid]); });
      (res.asks || []).forEach(function (na) {
        var made = newAsk(mm, assign({}, na, { id: 'a' + ((mm.asks || []).length + 1) }), tick);
        mm.asks = (mm.asks || []).concat([made]);
        if (made.stepId && made.blocking) mm.plan = patchStep(mm.plan, made.stepId, { status: 'blocked', note: 'Waiting for your answer.' });
      });
      if (res.status) mm.status = res.status;
      mm.log = addBeats(m.log, [{ agentId: 'lead', kind: 'did', text: 'You answered: ' + p.answer.trim().slice(0, 80) + '.', ref: a.id }].concat(res.beats), tick);
      if (!res.status) {
        if (openAsks(mm, true).length) mm.status = 'waiting';
        else if (mm.status === 'waiting') mm.status = 'running';
      }
      putM(world, mm);
      return;
    }
    if (name === 'steer') {
      var st = L().steer(m, p.text.trim(), p.constraints, world);
      mm = assign({}, m);
      var obj = assign({}, st.objective || m.objective, { constraints: st.constraints });
      mm.objective = cleanObjective(obj, m.objective);
      mm.steers = (m.steers || []).concat([{ tick: tick, text: p.text.trim().slice(0, 300), by: ctx.by || 'you' }]);
      var addSteps = Array.isArray(p.plan) && p.plan.length ? p.plan : st.added;
      var ids = {};
      mm.plan.forEach(function (s) { ids[s.id] = true; });
      var normalized = [];
      addSteps.forEach(function (s) {
        if (!isObj(s) || L().KINDS.indexOf(s.kind) < 0) return;
        var sid = s.id, k = mm.plan.length + normalized.length + 1;
        while (!sid || ids[sid]) sid = 's' + (k++);
        ids[sid] = true;
        var o = L().step(sid, s.kind, String(s.title || L().KIND_TITLE[s.kind]).slice(0, 120), (s.needs || []).filter(function (n) { return ids[n] && n !== sid; }));
        ['limit', 'channel'].forEach(function (k2) { if (s[k2] !== undefined) o[k2] = s[k2]; });
        normalized.push(o);
      });
      mm.plan = mm.plan.concat(normalized);
      if (normalized.length && m.phase === 'monitoring') mm.phase = 'executing';
      if (st.status) mm.status = st.status;
      if (st.resumeDay !== undefined) mm.resumeDay = st.resumeDay; else if (st.status === 'running') mm.resumeDay = null;
      if (st.status === 'paused' && st.resumeDay === undefined) mm.resumeDay = null;
      if (st.status === 'stopped') mm.plan = mm.plan.map(function (s) { return s.status === 'done' || s.status === 'skipped' ? s : assign({}, s, { status: 'skipped', note: 'Stopped.' }); });
      if (normalized.length && !st.status && m.status === 'done') mm.status = 'running';
      mm.log = addBeats(m.log, st.beats, tick);
      putM(world, mm);
      return;
    }
    if (name === 'setStatus') {
      mm = assign({}, m, { status: p.status });
      if (p.status !== 'paused') mm.resumeDay = null;
      var say = { running: m.status === 'paused' ? 'Picking this back up.' : 'Back on.', paused: 'Paused. Steer to resume.', done: 'Marked done.', stopped: 'Stopped. Everything made so far is kept.' }[p.status];
      if (p.status === 'stopped') mm.plan = m.plan.map(function (s) { return s.status === 'done' || s.status === 'skipped' ? s : assign({}, s, { status: 'skipped', note: 'Stopped.' }); });
      if (p.status === 'running' && openAsks(m, true).length) mm.status = 'waiting';
      mm.log = addBeats(m.log, [{ agentId: 'lead', kind: 'did', text: say }], tick);
      putM(world, mm);
      return;
    }
  };

  /* ======================= public API (UI and tests) ======================= */
  function liveWorld() { return MC.store && MC.store.getState ? MC.store.getState() : null; }
  M.parse = function (text, world) { return L().parse(text, world || liveWorld()); };
  M.plan = function (text, world) { return L().plan(world || liveWorld(), text); };
  function createPayload(goalText, plan, brain) {
    return { goalText: goalText, title: plan.title, objective: plan.objective, plan: plan.plan, asks: plan.asks, data: plan.data, brain: brain || 'rules' };
  }
  // Rules-planned mission, synchronously. Resolves { ok, id?, error? }.
  M.createSync = function (goalText, world) {
    var w = world || liveWorld();
    if (!w) return { ok: false, error: 'The sample world is still loading.' };
    var plan = L().plan(w, goalText);
    var r = MC.store.dispatch({ type: 'mission/create', payload: createPayload(goalText, plan, 'rules') });
    return r.ok ? { ok: true, id: r.created && r.created[0], brain: 'rules' } : { ok: false, error: r.error };
  };
  // Plans with Claude when connected (falls back to the rules planner) and starts the mission.
  // Always resolves: { ok, id?, brain?, error? }. The plan travels in the logged payload, so replay never calls the API.
  M.create = function (goalText) {
    var w = liveWorld();
    if (!w) return Promise.resolve({ ok: false, error: 'The sample world is still loading.' });
    var tk = MC.ai && MC.ai.tasks && MC.ai.tasks.planFromGoal;
    if (!tk || !(MC.ai.isOn && MC.ai.isOn())) return Promise.resolve(M.createSync(goalText, w));
    return tk(goalText, w).then(function (r) {
      var w2 = liveWorld() || w;
      if (!r || !r.plan) return M.createSync(goalText, w2);
      var base = L().plan(w2, goalText);
      var payload = { goalText: goalText, title: base.title, objective: r.objective, plan: r.plan, asks: r.asks || [], data: assign({}, base.data, r.data || {}), brain: r.source === 'ai' ? 'claude' : 'rules' };
      var d = MC.store.dispatch({ type: 'mission/create', payload: payload });
      if (d.ok) return { ok: true, id: d.created && d.created[0], brain: payload.brain };
      return M.createSync(goalText, w2);
    }, function () { return M.createSync(goalText, w); });
  };
  M.answer = function (id, askId, answer) { return MC.store.dispatch({ type: 'mission/answer', payload: { id: id, askId: askId, answer: String(answer) } }); };
  // Parses the new limits in `text` and re-plans the remaining steps. { ok, error? }
  M.steer = function (id, text) { return MC.store.dispatch({ type: 'mission/steer', payload: { id: id, text: String(text) } }); };
  M.setStatus = function (id, status) { return MC.store.dispatch({ type: 'mission/setStatus', payload: { id: id, status: status } }); };

  /* ======================= engine ======================= */
  function act(world, t, type, payload) {
    var r = MC.catalog.apply(world, { type: type, payload: payload }, { origin: 'mission', tick: t });
    if (!r.ok) report(new Error('mission action ' + type + ': ' + r.error));
    return r;
  }
  // A step acting for a specialist: real catalog action, origin agent:<id>, flagged as mission work.
  function doAction(world, t, agentId, action) {
    var r = MC.catalog.apply(world, action, { origin: 'agent:' + agentId, tick: t, mission: true });
    return r;
  }
  function stepAction(world, t, mid, stepId, patch, extra) {
    var p = assign({ id: mid, stepId: stepId, patch: patch }, extra || {});
    return act(world, t, 'mission/step', p);
  }
  function missionPatch(world, t, mid, mission, beats, addSteps) {
    return act(world, t, 'mission/step', { id: mid, mission: mission || {}, beats: beats || [], addSteps: addSteps || undefined });
  }
  function dayOf(t) { return T().dayOf(t); }
  function stepById(m, id) { for (var i = 0; i < m.plan.length; i++) if (m.plan[i].id === id) return m.plan[i]; return null; }
  function campaignOf(world, m) { var id = (m.data || {}).campaignId; return id ? world.campaigns.byId[id] || null : null; }

  // Two clocks. The WORLD clock (engine tick, one real hour) runs the daily work: resuming a paused mission, the Insight
  // Analyst's morning check-in and the drift re-plan (M.advance, called from the tick pipeline). The WORK pulse (about once a
  // second, only while something is claimable or working) runs the steps: M.work, applied through the logged catalog action
  // mission/work. A pulse does not move the world clock. Both are deterministic functions of the world and the tick.
  M.advance = function (world, t) {
    var s = world.missions;
    if (!s || !s.order.length) return;
    for (var i = 0; i < s.order.length; i++) {
      var id = s.order[i];
      try { dailyMission(world, id, t); } catch (e) { report(e); }
    }
  };

  // One pulse over every mission: claim steps whose dependencies are done, finish the ones already working.
  M.work = function (world, t) {
    var s = world.missions;
    if (!s || !s.order.length) return;
    for (var i = 0; i < s.order.length; i++) {
      var id = s.order[i];
      try { workMission(world, id, t); } catch (e) { report(e); }
    }
  };

  function depsDone(snapOrPlan, st) {
    return st.needs.every(function (n) {
      var d = snapOrPlan[n];
      return d === undefined || d === 'done' || d === 'skipped';
    });
  }
  function missionHasWork(world, m) {
    if (!m || m.status === 'stopped' || m.status === 'done' || m.status === 'paused' || world.meta.tick < m.createdTick) return false;
    if (m.status === 'planning') return true;
    var snap = {};
    m.plan.forEach(function (st) { snap[st.id] = st.status; });
    var open = false;
    for (var i = 0; i < m.plan.length; i++) {
      var st = m.plan[i];
      if (st.status !== 'done' && st.status !== 'skipped') open = true;
      if (st.status === 'working') return true;
      if (st.status === 'queued' && depsDone(snap, st)) return true;
    }
    return !open && m.phase !== 'monitoring';   // all steps finished but the hand-off to monitoring has not happened yet
  }
  // True while any mission has a step that is claimable or working (an answered ask or steer shows up here as an unblocked,
  // queued step). When this is false the engine runs no pulse and no timer.
  M.hasWork = function (world) {
    var s = world && world.missions;
    if (!s || !s.order.length) return false;
    for (var i = 0; i < s.order.length; i++) if (missionHasWork(world, s.byId[s.order[i]])) return true;
    return false;
  };

  // World-clock part (once per engine tick).
  function dailyMission(world, id, t) {
    var m = getM(world, id);
    if (!m || m.status === 'stopped' || m.status === 'done' || t < m.createdTick) return;
    if (m.status === 'paused') {
      if (isNum(m.resumeDay) && dayOf(t) >= m.resumeDay) { act(world, t, 'mission/setStatus', { id: id, status: 'running' }); m = getM(world, id); }
      else return;
    }
    if (!m || m.status === 'stopped') return;
    if (T().hourOf(t) === M.CHECKIN_HOUR && m.lastCheckDay !== dayOf(t)) {
      if (m.phase === 'monitoring') { ensureLaunchAsk(world, t, id); checkin(world, t, getM(world, id)); }
      else if ((m.artifacts || []).some(function (a) { return a.kind === 'campaign'; })) {
        var pr = computeProgress(world, m, t);
        missionPatch(world, t, id, { progress: verdictFrom(world, m, pr), lastCheckDay: dayOf(t) });
      }
    }
  }

  // Event-driven, one dependency level per work pulse: every step whose needs were already done at the start of the pulse is
  // claimed and run in that same pulse (queued -> working -> done, blocked or skipped), so independent steps progress together
  // and the next level starts on the next pulse. A step left 'working' by an older save is finished on its next pulse.
  // No artificial delay anywhere; the pulse stops by itself when nothing is pending.
  function workMission(world, id, t) {
    var m = getM(world, id);
    if (!m || m.status === 'stopped' || m.status === 'done' || m.status === 'paused' || t < m.createdTick) return;
    if (m.status === 'planning') { missionPatch(world, t, id, { status: openAsks(m, true).length ? 'waiting' : 'running', phase: 'executing' }); m = getM(world, id); }
    var snap = {};
    m.plan.forEach(function (st) { snap[st.id] = st.status; });
    for (var i = 0; i < m.plan.length; i++) {
      var cur = getM(world, id);
      if (!cur || cur.status === 'paused' || cur.status === 'stopped') return;
      var sid = m.plan[i].id, st = stepById(cur, sid);
      if (!st || snap[sid] !== st.status) continue;
      if (st.status === 'working') finishStep(world, t, cur, st);
      else if (st.status === 'queued' && st.needs.every(function (n) { return snap[n] === undefined || snap[n] === 'done' || snap[n] === 'skipped'; })) {
        startStep(world, t, cur, st);
        var cur2 = getM(world, id), st2 = cur2 && stepById(cur2, sid);
        if (st2 && st2.status === 'working' && cur2.status !== 'paused' && cur2.status !== 'stopped') finishStep(world, t, cur2, st2);
      }
    }
    m = getM(world, id);
    if (!m || m.status === 'stopped') return;
    var open = m.plan.some(function (s) { return s.status !== 'done' && s.status !== 'skipped'; });
    if (!open && m.phase !== 'monitoring') {
      ensureLaunchAsk(world, t, id);
      m = getM(world, id);
      missionPatch(world, t, id, { phase: 'monitoring' }, [{ agentId: 'lead', kind: 'result', text: monitoringBeat(world, m) }]);
    }
  }

  // The mission only ever says it is waiting for your sign-off when there is an open ask behind it.
  function monitoringBeat(world, m) {
    var c = campaignOf(world, m), waiting = !!c && c.status === 'draft' && openAsks(m, false).some(function (a) { return a.kind === 'launch'; });
    return 'The plan is in place.' + (waiting ? ' The campaign is drafted and needs your sign-off; once it runs, ' : ' ') + 'Insight Analyst checks results every morning, and the plan is revised if the goal falls behind.';
  }
  // A drafted campaign that nobody has scheduled always has a question open: raised when the plan finishes (even if the hand-off step
  // was skipped), and again after a "not yet" (two days) or a "yes" that never turned into a schedule (three days).
  function ensureLaunchAsk(world, t, id) {
    var m = getM(world, id), c = m && campaignOf(world, m);
    if (!m || !c || c.status !== 'draft' || m.status === 'stopped' || m.status === 'done') return;
    var launch = (m.asks || []).filter(function (a) { return a.kind === 'launch'; });
    if (launch.some(function (a) { return a.status === 'open'; })) return;
    var last = launch[launch.length - 1];
    if (last && isNum(last.answeredTick)) {
      var yes = !/^(no|not yet|stop|hold)\b/i.test(String(last.answer || '')), gap = yes ? 3 : 2;
      if (dayOf(t) < dayOf(last.answeredTick) + gap) return;
    }
    var again = !!last, started = dayOf(c.startTick) <= dayOf(t);
    var fc = (m.data || {}).planForecast || {}, d0 = dayShort(dayOf(c.startTick));
    act(world, t, 'mission/ask', { id: id, ask: { kind: 'launch', agentId: 'lead', blocking: false,
      question: again ? 'Still a draft: “' + c.name + '”. Ready to schedule it' + (started ? '' : ' for ' + d0) + '?' : '“' + c.name + '” is drafted. Ready to schedule it for ' + d0 + '?',
      why: 'The plan is done and nothing sends until the draft passes the launch checklist and you schedule it.' + (again ? ' Without it the goal can’t start moving.' : ''),
      impact: { metric: L().metricNoun(m.objective.metric), lo: fc.lo || 0, hi: fc.hi || 0 }, options: ['Yes, schedule it', 'Not yet'], default: 'Yes, schedule it' } });
  }

  function startStep(world, t, m, st) {
    var beats = [];
    // hand-off from the agent that produced what this step needs
    var from = st.needs.map(function (n) { return stepById(m, n); }).filter(function (d) { return d && d.agentId !== st.agentId && d.status === 'done'; })[0];
    if (from) beats.push({ agentId: from.agentId, kind: 'handoff', text: L().agentName(st.agentId) + ' started: ' + lowerFirst(st.title) + '.' });
    var line = (L().voice.start[st.kind] || function () { return 'On it.'; })(m);
    beats.push({ agentId: st.agentId, kind: 'thought', text: line, stepId: st.id });
    stepAction(world, t, m.id, st.id, { status: 'working', startedTick: t, note: '' }, { beats: beats });
  }

  function finishStep(world, t, m, st) {
    var ex = EXEC[st.kind], r;
    try { r = ex ? ex(world, t, m, st) : { ok: true, beats: [] }; }
    catch (e) { report(e); r = { error: 'Something went wrong: ' + (e && e.message ? e.message : e) }; }
    if (r.block) return blockStep(world, t, m, st, r.block);
    if (r.error) {
      var attempts = (st.attempts || 0) + 1;
      if (attempts >= 2) {
        stepAction(world, t, m.id, st.id, { status: 'skipped', doneTick: t, attempts: attempts, note: r.error },
          { beats: [{ agentId: st.agentId, kind: 'did', text: 'Could not finish “' + lowerFirst(st.title) + '”: ' + r.error + ' Skipped for now.' }] });
      } else stepAction(world, t, m.id, st.id, { status: 'queued', attempts: attempts, note: r.error });
      return;
    }
    var patch = { status: r.skip ? 'skipped' : 'done', doneTick: t, note: r.note || '' };
    if (r.actions) patch.actions = r.actions;
    if (r.artifact) patch.artifact = r.artifact;
    // every step records what the agent weighed (real alternatives with their numbers) and why it chose one
    var dec = cleanDecision(r.decision);
    if (!dec) { try { dec = cleanDecision(fallbackDecision(world, t, m, st, r)); } catch (e) { report(e); dec = null; } }
    if (dec) patch.decision = dec;
    var beats0 = r.beats || [];
    if (beats0[0] && !beats0[0].stepId) beats0[0].stepId = st.id;
    var extra = { beats: beats0 };
    if (r.data || r.artifacts || r.progress) extra.mission = { data: r.data || {}, artifacts: r.artifacts || undefined, progress: r.progress || undefined };
    stepAction(world, t, m.id, st.id, patch, extra);
    if (r.asks) r.asks.forEach(function (a) { act(world, t, 'mission/ask', { id: m.id, ask: a }); });
  }
  function lowerFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  function blockStep(world, t, m, st, b) {
    // b = { ask, say, agentId }: the step waits for an answer
    var ask = assign({ stepId: st.id, agentId: b.agentId || st.agentId, blocking: true }, b.ask);
    stepAction(world, t, m.id, st.id, { status: 'blocked', note: 'Waiting for your answer.' }, { beats: b.say ? [{ agentId: ask.agentId, kind: 'thought', text: b.say }] : [] });
    act(world, t, 'mission/ask', { id: m.id, ask: ask });
  }

  /* ---------------- shared helpers for executors ---------------- */
  function seg(world, id) { return world.segments.byId[id] || null; }
  function reachBy(world, bits, ch) {
    var P = world.profiles, bit = MC.CH.BIT[ch], n = 0, r = 0;
    for (var i = 0; i < P.n; i++) {
      if (bits && !bits[i]) continue;
      n++;
      if ((P.consent[i] & bit) !== 0 && (P.unsub[i] & bit) === 0) r++;
    }
    return { n: n, reach: r };
  }
  function audienceBits(world, m) {
    var sid = (m.data || {}).audience && m.data.audience.resolvedId;
    if (!sid || !seg(world, sid)) return null;
    try { return MC.segments.members(world, sid); } catch (e) { return null; }
  }
  function guardParams(world) {
    var a = world.agents && world.agents.byId && world.agents.byId.guard, p = (a && a.params) || {};
    return { thr: isNum(p.unsubRiskThreshold) ? p.unsubRiskThreshold : 0.003, cooldownDays: isNum(p.cooldownDays) ? p.cooldownDays : 3, maxPct: isNum(p.maxSuppressPct) ? p.maxSuppressPct : 15 };
  }
  function offerCap(m) { var c = L().constraintOf(m.objective.constraints, 'maxDiscountPct'); return c ? c.value : null; }
  function agentTag(agentId) { return L().agentName(agentId); }


  /* ---------------- decisions: what each agent weighed (step.decision) ---------------- */
  function opt(label, value, note) { return { label: label, value: value === undefined || value === null ? '' : String(value), note: note || '' }; }
  function signedPct(x) { return (x >= 0 ? '+' : '−') + pct(Math.abs(x), 0); }
  function marginalText(x) { return isNum(x) && x >= 0.01 ? '$' + x.toFixed(2) + ' back per $1' : 'under $0.01 back per $1'; }
  // The plan's best audiences for this mission's brief (the planner's own ranking), for Scout's and Widen's decisions.
  function audienceCandidates(world, m, resolvedId) {
    try {
      var d = m.data || {}, aud = clone(d.audience || {});
      var brief = L().brief(world, assign({}, m, { data: assign({}, d, { audience: assign({}, aud, { resolvedId: resolvedId || null, segmentId: resolvedId || null }) }) }));
      return MC.planner.plan(world, brief).sections.audience.options || [];
    } catch (e) { return []; }
  }
  function audOpt(o) {
    return opt(o.name, num(o.size) + ' people, ' + num(o.reach) + ' reachable', pct(o.meanProp, 1) + ' chance to buy in 30 days; about ' + money(o.ev) + ' expected');
  }
  // Per-angle response for an audience from MC.affinity (when it exists), as { angle: {value, lo, hi} }.
  function affinityFor(world, m) {
    var out = {}, A = MC.affinity, sid = (m.data || {}).audience && m.data.audience.resolvedId;
    if (!A || typeof A.forSegment !== 'function' || !sid) return out;
    try {
      var r = A.forSegment(world, sid), rows = Array.isArray(r) ? r : (r && (r.angles || r.rows)) || [];
      rows.forEach(function (x) {
        var key = x && (x.angle || x.key || x.id), l = x && (x.lift || x), v = l && (isNum(l.value) ? l.value : (isNum(l.lift) ? l.lift : null));
        if (key && v !== null && isNum(v)) out[key] = { value: v, lo: isNum(l.lo) ? l.lo : null, hi: isNum(l.hi) ? l.hi : null, source: 'affinity' };
      });
    } catch (e) { return {}; }
    return out;
  }
  // Within-campaign lift of an angle across the library, from the same ledger the content views read.
  function angleDecision(world, m, heads, chose, aff) {
    var K = MC.content, seen = {}, opts = [];
    heads.forEach(function (h) {
      var a = h.b.tags && h.b.tags.angle; if (!a || seen[a]) return;
      seen[a] = h;
    });
    Object.keys(seen).sort().forEach(function (a) {
      var h = seen[a], l = aff[a] || (h.sc.l ? { value: h.sc.l.value, lo: h.sc.l.lo, hi: h.sc.l.hi } : null);
      var n = heads.filter(function (x) { return x.b.tags && x.b.tags.angle === a; }).length;
      opts.push({ o: opt((K.ANGLE_LABEL || {})[a] || a, l ? signedPct(l.value) + (isNum(l.lo) && isNum(l.hi) ? ' (' + signedPct(l.lo) + ' to ' + signedPct(l.hi) + ')' : '') : 'no history yet',
        (aff[a] ? 'This audience responds ' + (aff[a].value >= 0 ? 'above' : 'below') + ' average. ' : '') + n + (n === 1 ? ' headline' : ' headlines') + ' ready; best: “' + clipN(plainBlock(h.b), 40) + '”'), v: l ? l.value : -9 });
    });
    opts.sort(function (x, y) { return (y.v - x.v) || (x.o.label < y.o.label ? -1 : 1); });
    var label = (K.ANGLE_LABEL || {})[chose] || chose, top = opts[0], mine = opts.filter(function (x) { return x.o.label === label; })[0];
    var why = aff[chose] ? 'It is what this audience has responded to most (' + signedPct(aff[chose].value) + ' against the rest).'
      : (mine && mine.v > -9 ? 'It has earned ' + signedPct(mine.v) + ' more of the response than the rest of the library on these channels.' : 'It fits the campaign’s tone and has no history that says otherwise.');
    if (top && mine && top.o.label !== label && top.v > -9 && top.v > mine.v) why += ' ' + top.o.label + ' scores higher, but it didn’t fit this campaign (a deadline or product it doesn’t have).';
    return { options: opts.map(function (x) { return x.o; }).slice(0, 5), chose: label, why: why };
  }

  /* ---------------- executors: each returns {beats, artifact?, data?, block?, error?, skip?} ---------------- */
  var EXEC = {};

  EXEC.goal = function (world, t, m, st) {
    var o = m.objective, days = Math.max(1, o.by - dayOf(t) + 1), per = o.target / days, perEarly = days > 8 ? o.target / (days - 7) : null;
    function rate(v) { return L().fmtMetric(o.metric, v) + ' a day'; }
    var opts = o.direction === 'atMost'
      ? [opt('Hold to the limit through ' + dayShort(o.by), 'under ' + num(o.target), 'About ' + (Math.round(per * 10) / 10) + ' a day allowed over ' + days + ' days')]
      : [opt('Run to ' + dayShort(o.by), rate(per), days + (days === 1 ? ' day' : ' days') + ' to get there')];
    if (perEarly) opts.push(opt('Finish a week early', rate(perEarly), 'Needs ' + pct(perEarly / per - 1, 0) + ' more a day and leaves nothing for a re-plan'));
    return { beats: [{ agentId: 'lead', kind: 'did', text: 'Goal confirmed: ' + L().objectiveText(m.objective) + '.' }], note: 'Goal confirmed.',
      decision: { options: opts, chose: opts[0].label, why: 'It is the date you gave. ' + (perEarly ? 'Finishing early would need ' + rate(perEarly) + ' against ' + rate(per) + ', with no room to fix a miss.' : 'There is no slack to bring it forward.') } };
  };

  // ---- Segment Scout: find and size the audience ----
  EXEC.audience = function (world, t, m, st) {
    var d = m.data || {}, template = d.template;
    if (template === 'protect') {
      var gp = guardParams(world), P = world.profiles, hit = 0, reachable = 0, half = 0, dbl = 0;
      for (var i = 0; i < P.n; i++) {
        if ((P.consent[i] & MC.CH.BIT.email) === 0 || (P.unsub[i] & MC.CH.BIT.email) !== 0) continue;
        reachable++;
        var rk = MC.models.unsubRisk(world, i, 'email');
        if (rk >= gp.thr) hit++;
        if (rk >= gp.thr / 2) half++;
        if (rk >= gp.thr * 2) dbl++;
      }
      return { beats: [{ agentId: 'scout', kind: 'did', text: num(hit) + ' of ' + num(reachable) + ' email subscribers are at real risk of unsubscribing at the current send pace.' }],
        data: { audience: assign({}, d.audience, { atRisk: hit, reachable: reachable }) }, note: num(hit) + ' at risk.',
        decision: { options: [opt('Half the usual risk bar', num(half) + ' people', 'Casts a wider net; many would be fine'), opt('The usual risk bar', num(hit) + ' people', 'Where unsubscribing becomes likely'), opt('Twice the usual bar', num(dbl) + ' people', 'Only the clearest cases')],
          chose: 'The usual risk bar', why: 'It flags ' + num(hit) + ' of ' + num(reachable) + ' subscribers; half the bar would add ' + num(half - hit) + ' people who are probably fine, and twice the bar would miss ' + num(hit - dbl) + ' who are not.' } };
    }
    var aud = clone(d.audience || {}), ov = d.overrides || {}, sid = aud.segmentId && !ov.widen ? aud.segmentId : null, created = null, label = aud.label || '';
    if (sid && !seg(world, sid)) sid = null;
    var actions = [];
    if (!sid && label && !ov.widen) {
      // a described group with no saved segment: read it as a rule
      var pr = null;
      try { pr = MC.segments.parse(L().parse(m.goalText, world).audience.hints[0] || label, world); } catch (e) { pr = null; }
      if (pr && pr.rule && pr.rule.items.length && pr.confidence >= 0.5) {
        var nm = label.charAt(0).toUpperCase() + label.slice(1);
        var r0 = doAction(world, t, 'scout', { type: 'segment/create', payload: { segment: { name: nm.slice(0, 60), rule: pr.rule } } });
        if (r0.ok) { sid = r0.created[0]; created = sid; actions.push({ type: 'segment/create', id: sid }); }
      }
    }
    if (!sid) {
      // let the planner's audience ranking choose (expected value by reachable people, chance to buy, order value, goal fit)
      var brief = L().brief(world, assign({}, m, { data: assign({}, d, { audience: assign({}, aud, { resolvedId: null, segmentId: null }) }) }));
      var plan = MC.planner.plan(world, brief);
      var opts = plan.sections.audience.options, pick = opts[plan.sections.audience.chosen];
      if (pick) {
        if (pick.segmentId) sid = pick.segmentId;
        else {
          var r1 = doAction(world, t, 'scout', { type: 'segment/create', payload: { segment: { name: String(pick.name).slice(0, 60), rule: pick.segment.rule } } });
          if (r1.ok) { sid = r1.created[0]; created = sid; actions.push({ type: 'segment/create', id: sid }); }
          else return { error: r1.error };
        }
        label = pick.name;
      }
    }
    if (!sid) return { error: 'No audience fits.' };
    var bits = null;
    try { bits = MC.segments.members(world, sid); } catch (e2) { bits = null; }
    var primary = L().brief(world, assign({}, m, { data: assign({}, d, { audience: assign({}, aud, { resolvedId: sid }) }) })).channels[0];
    var rc = reachBy(world, bits, primary), s0 = seg(world, sid);
    var size = rc.n;
    if (size < M.MIN_AUDIENCE) {
      return { block: { say: 'Only ' + num(size) + ' people match, which is too few to run a campaign on.', ask: {
        kind: 'guardrail', question: 'Only ' + num(size) + ' people match “' + (s0 ? s0.name : label) + '”. Should I widen it to the best-scoring audience instead?',
        why: 'Audiences under ' + num(M.MIN_AUDIENCE) + ' people are too small to measure and easy to over-message.',
        impact: { metric: L().metricNoun(m.objective.metric), lo: 0, hi: 0 }, options: ['Widen it', 'Stop here'], default: 'Widen it',
        fix: { overrides: { widen: true }, say: 'Widening to the best-scoring audience and trying again.' } } } };
    }
    var pctReach = size ? rc.reach / size : 0;
    var text = 'Found ' + num(size) + ' ' + (s0 ? lowerFirst(s0.name) : label) + '; ' + num(rc.reach) + ' (' + pct(pctReach) + ') can be reached by ' + chLower(primary) + '.';
    var auds = assign({}, aud, { resolvedId: sid, label: label || (s0 && s0.name) || '', size: size, reach: rc.reach, primary: primary });
    var res = { beats: [{ agentId: 'scout', kind: 'did', text: text }], artifact: { kind: 'segment', id: sid }, data: { audience: auds }, actions: actions, note: text };
    var all = audienceCandidates(world, m, created ? null : sid);
    var pickedOpt = all.filter(function (o) { return (o.segmentId && o.segmentId === sid) || (!o.segmentId && lowerFirst(o.name) === lowerFirst(label)); })[0], ownEv = pickedOpt ? pickedOpt.ev : null;
    var seenAud = {}; if (pickedOpt) seenAud[pickedOpt.name + pickedOpt.size] = true;
    var cands = all.filter(function (o) { var k = o.name + o.size; if (o === pickedOpt || seenAud[k]) return false; seenAud[k] = true; return true; }), mine;
    if (pickedOpt) mine = audOpt(pickedOpt);
    else mine = opt((s0 && s0.name) || label, num(size) + ' people, ' + num(rc.reach) + ' reachable', 'Reached by ' + chLower(primary));
    var others = cands.slice(0, 2).map(audOpt);
    var best = cands[0];
    res.decision = { options: [mine].concat(others), chose: mine.label,
      why: ownEv !== null && best && best.ev > ownEv ? 'It’s the group you described; the best-scoring alternative (' + lowerFirst(best.name) + ') is worth about ' + money(best.ev) + ' against ' + money(ownEv) + ', so say so if you’d rather switch.'
        : (best ? 'It has the highest expected value of the ' + (1 + cands.length) + ' candidates I scored (' + (ownEv !== null ? money(ownEv) : 'best fit for the goal') + ').' : 'It was the only audience big enough to measure.') };
    return res;
  };

  // ---- Campaign Planner: the draft campaign ----
  function evenSplit(total, chans) {
    var out = {}, share = Math.floor(total / chans.length / 10) * 10, used = 0;
    chans.forEach(function (ch, i) { var v = i === chans.length - 1 ? total - used : share; out[ch] = v; used += v; });
    return out;
  }
  function preflightAsk(world, m, items, plan, brief) {
    var f = items.filter(function (x) { return x.status === 'fail' && ((m.data || {}).ignore || []).indexOf(x.id) < 0; })[0];
    if (!f) return null;
    var metric = L().metricNoun(m.objective.metric);
    var imp = { metric: metric, lo: 0, hi: 0 };
    if (f.id === 'budget') {
      var cap = (world.guardrails && world.guardrails.maxDailySpend) || 2500, days = Math.max(1, brief.endDay - brief.startDay + 1);
      var fit = Math.max(500, Math.floor(cap * days * 0.9 / 100) * 100);
      var daily = brief.budget / days;
      return { kind: 'guardrail', question: money(brief.budget) + ' over ' + days + (days === 1 ? ' day' : ' days') + ' is ' + money(daily) + ' a day, over your ' + money(cap) + ' daily limit. Lower the campaign budget to ' + money(fit) + '?',
        why: 'The spending guardrail stops anything above ' + money(cap) + ' a day, so the campaign couldn’t be scheduled as drafted.', impact: imp,
        options: ['Lower it to ' + money(fit), 'Stop here'], default: 'Lower it to ' + money(fit),
        fix: { overrides: { budget: fit }, say: 'Lowering the budget to ' + money(fit) + ' and drafting again.' } };
    }
    if (f.id === 'consent' && brief.channels[0] !== 'email' && brief.channels.indexOf('email') >= 0) {
      return { kind: 'guardrail', question: f.detail + ' Lead with email instead?',
        why: 'Fewer than half of this audience agreed to ' + chLower(brief.channels[0]) + ', which breaks the consent rule.', impact: imp,
        options: ['Lead with email', 'Stop here'], default: 'Lead with email', fix: { overrides: { leadChannel: 'email' }, say: 'Leading with email and drafting again.' } };
    }
    return { kind: 'guardrail', question: f.label + ' needs attention: ' + f.detail + ' Continue anyway?',
      why: 'Checks flagged this before the campaign could be scheduled. You can continue and fix it in the campaign, or stop here.', impact: imp,
      options: ['Continue anyway', 'Stop here'], default: 'Continue anyway', fix: { ignore: [f.id], say: 'Continuing; ' + f.label.toLowerCase() + ' will need a fix before this can be scheduled.' } };
  }

  EXEC.campaign = function (world, t, m, st) {
    var d = m.data || {};
    if (d.campaignId && world.campaigns.byId[d.campaignId]) return { skip: true, note: 'Already drafted.', beats: [] };
    var brief = L().brief(world, m);
    var plan = MC.planner.plan(world, brief);
    var items = plan.sections.preflight.items || [];
    var ask = preflightAsk(world, m, items, plan, brief);
    if (ask) return { block: { say: 'Checks found a problem with the draft.', ask: ask } };
    var payload = clone(plan.payload);
    payload.variants = [];
    var chans = payload.campaign.channels;
    payload.campaign.budget = { total: brief.budget, byChannel: evenSplit(brief.budget, chans) };
    payload.campaign.alloc = {};
    var r = doAction(world, t, 'planner', { type: 'campaign/create', payload: payload });
    if (!r.ok) return { error: r.error };
    var cid = r.created[r.created.length - 1];
    var c = world.campaigns.byId[cid], fc = plan.sections.forecast.goal;
    var days = Math.max(1, Math.round((c.endTick - c.startTick) / 24));
    var text = 'Drafted “' + c.name + '”: ' + listJoin(c.channels.map(chLower)) + ', ' + moneyS(c.budget.total) + ' over ' + days + (days === 1 ? ' day' : ' days') +
      ', starting ' + dayShort(dayOf(c.startTick)) + '. It stays a draft until you schedule it.';
    var whyRows = plan.sections.budget.why || [], excluded = (m.objective.constraints || []).filter(function (x) { return x.kind === 'excludeChannel'; }).map(function (x) { return chLower(x.value); });
    var copts = whyRows.map(function (w) { return opt(chName(w.ch), '$' + w.roas.toFixed(2) + ' back per $1', pct(w.share, 0) + ' of the budget; ' + marginalText(w.marginal) + ' on the next dollar'); });
    var decision = { options: copts, chose: 'Run on ' + listJoin(c.channels.map(chLower)),
      why: 'Budget follows the channels that return the most on the next dollar' + (excluded.length ? '; ' + listJoin(excluded) + ' stays out because you said so' : '') + '. Forecast ' + L().fmtMetric(m.objective.metric, fc.mean) + ' (' + L().fmtMetric(m.objective.metric, fc.lo) + ' to ' + L().fmtMetric(m.objective.metric, fc.hi) + ').' };
    return { beats: [{ agentId: 'planner', kind: 'did', text: text }], artifact: { kind: 'campaign', id: cid }, note: text, decision: decision,
      actions: [{ type: 'campaign/create', id: cid }],
      data: { campaignId: cid, channels: c.channels.slice(), planForecast: { mean: fc.mean, lo: fc.lo, hi: fc.hi, target: fc.target || null }, optimalSplit: clone(plan.sections.budget.byChannel),
        budgetWhy: clone(plan.sections.budget.why || []) } };
  };

  // ---- Copy Drafter ----
  function writeVariants(world, t, m, c, opts) {
    var wrote = [], chans = c.channels.filter(function (ch) { return !(c.channelPaused && c.channelPaused[ch]); }), actions = [], rejected = 0;
    var brand = world.guardrails && world.guardrails.brand;
    chans.forEach(function (ch) {
      var drafts = [];
      try { drafts = MC.copy.generate({ channel: ch, tone: c.tone, productId: c.productFocus, offer: c.offer, count: 3, seedKey: m.id + ':' + ch + ':' + (opts.round || 0) }, world.meta.seed) || []; } catch (e) { drafts = []; }
      var good = [];
      drafts.forEach(function (dr) {
        var checks = MC.copy.check(dr, brand), fail = checks.filter(function (x) { return x.status === 'fail'; });
        var guard = 0;
        while (fail.length && guard++ < 3) {
          var fx = fail.filter(function (x) { return x.fix; })[0];
          if (!fx) break;
          dr.fields = assign({}, dr.fields); dr.fields[fx.fix.field] = fx.fix.value;
          fail = MC.copy.check(dr, brand).filter(function (x) { return x.status === 'fail'; });
        }
        if (fail.length) { rejected++; return; }
        good.push(dr);
      });
      good.forEach(function (dr, k) {
        var r = doAction(world, t, 'copy', { type: 'variant/create', payload: { variant: { campaignId: c.id, channel: ch, fields: dr.fields, tone: dr.tone, offer: dr.offer, productId: dr.productId, predicted: dr.predicted }, share: 1 / (k + 1) } });
        if (r.ok) { wrote.push(ch); actions.push({ type: 'variant/create', id: r.created[0] }); }
      });
    });
    return { n: wrote.length, chans: chans.filter(function (ch) { return wrote.indexOf(ch) >= 0; }), actions: actions, rejected: rejected };
  }
  // ---- Copy Drafter, content model: assemble messages from the best approved blocks and publish them to every channel ----
  var ANGLE_FOR_TONE = { practical: 'utility', adventurous: 'trail-season', warm: 'warmth', urgent: 'urgency' };
  function liftIn(rows, id, chans) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].key !== id) continue;
      var acc = 0, wsum = 0, lo = 0, hi = 0, any = false;
      chans.forEach(function (ch) {
        var cell = rows[i].byChannel[ch];
        if (cell && cell.enough && cell.lift) { acc += cell.lift.value * cell.delivered; lo += cell.lift.lo * cell.delivered; hi += cell.lift.hi * cell.delivered; wsum += cell.delivered; any = true; }
      });
      return any ? { value: acc / wsum, lo: lo / wsum, hi: hi / wsum, n: wsum } : null;
    }
    return null;
  }
  function usableBlock(b) { return !!b && b.review === 'approved' && !b.retired && !b.archived; }
  function assemble(world, t, m, c, opts) {
    var K = MC.content, S = MC.select, avoid = opts.avoid || {}, chans = c.channels.filter(function (ch) { return !(c.channelPaused && c.channelPaused[ch]); });
    var out = { messages: [], chans: chans, actions: [], notes: [], rejected: 0, headlineIds: [] };
    if (!K || !S || !S.contentPerformance || !chans.length) return out;
    var owned = chans.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0; }), evChans = owned.length ? owned : chans;
    var perf = S.contentPerformance(world, {by: 'block'}), blocks = K.blocks(world), aff = affinityFor(world, m);
    var hasDeadline = !!(c.offer && c.offer !== 'none') || (c.eventDay !== undefined && c.eventDay !== null);
    var wantAngle = ANGLE_FOR_TONE[c.tone] || null, prod = c.productFocus || null;
    var prodBlock = prod ? blocks.filter(function (b) { return b.kind === 'product' && usableBlock(b) && b.value && b.value.productId === prod; })[0] : null;
    function compatible(b) { return !(b.tags && b.tags.product) || b.tags.product === prod; }
    function fresh(b) { return !S.blockFatigue(world, b.id).tired; }
    function score(b, angle) {
      var l = liftIn(perf, b.id, evChans), s = l ? l.value : 0;
      if (b.tags && b.tags.tone === c.tone) s += 0.15;
      if (angle && b.tags && b.tags.angle === angle) s += 0.1;
      if (prod && b.tags && b.tags.product === prod) s += 0.1;
      if (b.tags && aff[b.tags.angle]) s += 0.5 * aff[b.tags.angle].value;   // what this audience responds to (MC.affinity), when it has data
      return { s: s, l: l };
    }
    function ranked(kind, angle, filter) {
      return blocks.filter(function (b) { return b.kind === kind && usableBlock(b) && compatible(b) && fresh(b) && (!filter || filter(b)); }).map(function (b) { return { b: b, sc: score(b, angle) }; })
        .sort(function (a, b) { return (b.sc.s - a.sc.s) || (a.b.id < b.b.id ? -1 : 1); });
    }
    var heads = ranked('headline', wantAngle, function (b) {
      var a = b.tags && b.tags.angle;
      if (avoid[b.id]) return false;
      if (a === 'urgency' && !hasDeadline) return false;
      if (a === 'gifting' && !/gift|holiday/i.test(c.name)) return false;
      return true;
    });
    if (!heads.length) return out;
    var used = {};
    function make(h, label) {
      var angle = h.b.tags.angle, tone = h.b.tags.tone || c.tone;
      var body = ranked('body', angle, function (b) { return b.tags && b.tags.angle === angle; })[0] || ranked('body', angle)[0];
      var cta = ranked('cta', null)[0];
      var offer = (c.offer && c.offer !== 'none') ? blocks.filter(function (b) { return b.kind === 'offer' && usableBlock(b) && b.value && b.value.type === c.offer; })[0] : null;
      var image = ranked('image', angle, function (b) { return b.tags && b.tags.angle === angle; })[0] || ranked('image', angle)[0];
      var claims = blocks.filter(function (b) { return b.kind === 'claim' && usableBlock(b) && compatible(b); }).sort(function (a, b) { return (K.usedCount(world, b.id) - K.usedCount(world, a.id)) || (a.id < b.id ? -1 : 1); }).slice(0, 1);
      var sign = blocks.filter(function (b) { return b.kind === 'signoff' && usableBlock(b) && b.tags && b.tags.angle === (c.tone === 'warm' ? 'warmth' : 'none'); })[0];
      if (!body || !cta) return null;
      var slots = { headline: h.b.id, body: body.b.id, cta: cta.b.id, claims: claims.map(function (b) { return b.id; }) };
      if (offer) slots.offer = offer.id;
      if (image) slots.image = image.b.id;
      if (prodBlock) slots.product = prodBlock.id;
      if (sign) slots.signoff = sign.id;
      return { name: clipN(c.name + ': ' + (K.ANGLE_LABEL[angle] || angle).toLowerCase() + ' (' + label + ')', 78), slots: slots, tags: { angle: angle, tone: tone }, head: h };
    }
    var firstAngle = null;
    for (var i = 0; i < heads.length && out.messages.length < 2; i++) {
      var h = heads[i], angle = h.b.tags.angle;
      if (out.messages.length === 1 && (angle === firstAngle || used[h.b.id])) continue;
      if (out.messages.length === 1 && h.sc.l && h.sc.l.hi < 0) continue;   // never test a headline the ledger says loses clearly
      var draft = make(h, out.messages.length ? 'B' : 'A');
      if (!draft) continue;
      var chk = S.draftChecks(world, draft, chans, c.id);
      if (!chk.ok) { out.rejected++; continue; }
      if (!out.messages.length) firstAngle = angle;
      used[h.b.id] = true;
      var r1 = doAction(world, t, 'copy', { type: 'message/create', payload: { message: { name: draft.name, slots: draft.slots, tags: draft.tags } } });
      if (!r1.ok) { out.rejected++; continue; }
      var mid = r1.created[0];
      var pub = { id: mid, campaignId: c.id, channels: chans };
      if (out.messages.length) pub.share = 0.4;   // the second message is the test: it takes 40% beside the first
      var r2 = doAction(world, t, 'copy', { type: 'message/publish', payload: pub });
      if (!r2.ok) { out.rejected++; continue; }
      out.messages.push({ id: mid, name: draft.name, headline: h, angle: angle, variants: (r2.created || []).slice() });
      out.headlineIds.push(h.b.id);
      out.actions.push({ type: 'message/create', id: mid });
      (r2.created || []).forEach(function (vid) { out.actions.push({ type: 'message/publish', id: vid }); });
    }
    if (out.messages.length) out.decision = angleDecision(world, m, heads, out.messages[0].angle, aff);
    return out;
  }
  function clipN(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function plainBlock(b) { return String(MC.content.textOf(b)).replace(/\{first_name\|([^}]+)\}/g, '$1').replace(/\s*\{[a-z_]+(\|[^}]*)?\}[,:]?\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
  function contentBeat(world, res, c, round) {
    var K = MC.content, a = res.messages[0], h = a.headline, l = h.sc.l, n = res.messages.length;
    var summary = n + (n === 1 ? ' message' : ' messages') + ' · ' + res.chans.length + (res.chans.length === 1 ? ' channel' : ' channels');
    var text = (round ? 'Re-assembled ' : 'Assembled ') + n + (n === 1 ? ' message' : ' messages') + ' from approved blocks: ' + L().offerLabel(c.offer) + ', the usual button and claims, and the headline “' + clipN(plainBlock(h.b), 60) + '”' +
      (l ? ', which has earned ' + pct(l.value, 0) + ' more of the response (' + pct(l.lo, 0) + ' to ' + pct(l.hi, 0) + ') than the rest of the library on these channels' : '') +
      (n > 1 ? '. A second message tries a ' + (K.ANGLE_LABEL[res.messages[1].angle] || 'different').toLowerCase() + ' headline to learn which works' : '') +
      '. Each renders as a version for ' + listJoin(res.chans.map(chLower)) + ' and is in review; nothing goes live until someone approves it.';
    return { summary: summary, text: text };
  }

  EXEC.copy = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No campaign to write for.', beats: [{ agentId: 'copy', kind: 'did', text: 'No campaign to write for yet, so no messages were written.' }] };
    var res = assemble(world, t, m, c, { avoid: {} });
    if (res.messages.length) {
      var b = contentBeat(world, res, c, false);
      return { decision: res.decision, beats: [{ agentId: 'copy', kind: 'did', text: b.text }], actions: res.actions, note: b.summary, artifact: { kind: 'message', id: res.messages[0].id },
        artifacts: res.messages.slice(1).map(function (x) { return { kind: 'message', id: x.id }; }),
        data: { content: { messages: res.messages.map(function (x) { return x.id; }), channels: res.chans.slice(), summary: b.summary, headlineIds: res.headlineIds.slice() } } };
    }
    // the library had nothing approved that fits: write variants directly
    var res0 = writeVariants(world, t, m, c, { round: 0 });
    if (!res0.n) return { error: 'None of the drafts passed the brand checks.' };
    var text = 'Wrote ' + res0.n + ' variants across ' + listJoin(res0.chans.map(chLower)) + ' around ' + L().offerLabel(c.offer) + ', checked against the brand book' +
      (res0.rejected ? ' (' + res0.rejected + ' discarded for breaking it)' : '') + '. They’re in review; nothing goes live until someone approves them.';
    return { beats: [{ agentId: 'copy', kind: 'did', text: text }], actions: res0.actions, note: text };
  };

  // ---- Fatigue Guard ----
  // Guard weighs the proposed send against how often each person has heard from us. Where the campaign (Copy Drafter's message,
  // Campaign Planner's dates) would send to people already at the limit, Guard says no to those people and the beat records both
  // positions and how it was settled: they are rested, the rest still get it, and the expected cost is stated.
  EXEC.guard = function (world, t, m, st) {
    var c = campaignOf(world, m), d = m.data || {}, gp = guardParams(world), P = world.profiles;
    var bits = d.template === 'protect' ? null : audienceBits(world, m);
    var chans = (c ? c.channels : MC.CH.OWNED).filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0 && !(c && c.channelPaused && c.channelPaused[ch]); });
    var cap = L().constraintOf(m.objective.constraints, 'maxSendsPerWeek');
    var until = Math.max(t, c ? c.startTick : t) + Math.round(gp.cooldownDays * 24);
    var total = 0, per = [], actions = [], byLimit = 0, reachable = 0, leftOver = 0, rested = {}, tiers = { half: 0, usual: 0, dbl: 0 }, riskSeen = {};
    chans.forEach(function (ch) {
      var ci = MC.CH.IDX[ch], bit = MC.CH.BIT[ch], cands = [], n = 0;
      for (var i = 0; i < P.n; i++) {
        if (bits && !bits[i]) continue;
        if ((P.consent[i] & bit) === 0 || (P.unsub[i] & bit) !== 0) continue;
        n++;
        if (P.supUntil[i * 3 + ci] > until) continue;
        var risk = MC.models.unsubRisk(world, i, ch), weekly = 0;
        for (var k = 0; k < 21; k++) weekly += P.sent7[i * 21 + k];
        var overCap = !!cap && weekly >= cap.value;
        if (!riskSeen[i] || risk > riskSeen[i]) riskSeen[i] = risk;
        if (risk >= gp.thr || overCap) cands.push([i, risk, overCap ? 1 : 0]);
      }
      reachable += n;
      cands.sort(function (a, b) { return (b[2] - a[2]) || (b[1] - a[1]) || (a[0] - b[0]); });
      var room = Math.floor(n * gp.maxPct / 100);
      var pick = cands.slice(0, room), idx = pick.map(function (x) { return x[0]; }).sort(function (a, b) { return a - b; });
      leftOver += Math.max(0, cands.length - pick.length);
      pick.forEach(function (x) { if (x[2]) byLimit++; rested[x[0]] = true; });
      if (!idx.length) return;
      var payload = { channel: ch, idx: idx, untilTick: until };
      if (c) payload.campaignId = c.id;
      var r = doAction(world, t, 'guard', { type: 'profiles/suppress', payload: payload });
      if (r.ok) { total += idx.length; per.push(num(idx.length) + ' on ' + chLower(ch)); actions.push({ type: 'profiles/suppress', channel: ch, count: idx.length }); }
    });
    Object.keys(riskSeen).forEach(function (i) { var r = riskSeen[i]; if (r >= gp.thr / 2) tiers.half++; if (r >= gp.thr) tiers.usual++; if (r >= gp.thr * 2) tiers.dbl++; });
    var text = total
      ? 'Rested ' + num(total) + (total === 1 ? ' person' : ' people') + ' (' + listJoin(per) + ') until ' + dayShort(dayOf(until)) + ' because they’ve had a lot of messages lately' +
        (cap && byLimit ? ', including ' + num(byLimit) + ' already at your ' + cap.value + ' a week limit' : '') + '. Anyone who has unsubscribed was never included.'
      : 'Nobody in this audience is close to a limit, so no one needs resting. Anyone who has unsubscribed is excluded already.';
    var decision = { options: [
      opt('Rest at half the usual risk', num(tiers.half) + ' people', 'Safer for the list, but ' + num(Math.max(0, tiers.half - tiers.usual)) + ' of them are probably fine'),
      opt('Rest at the usual risk', num(tiers.usual) + ' people', 'Where unsubscribing becomes likely at this send pace'),
      opt('Rest at twice the usual risk', num(tiers.dbl) + ' people', 'Leaves ' + num(Math.max(0, tiers.usual - tiers.dbl)) + ' at real risk getting the message')]
      .concat(cap ? [opt('Your ' + cap.value + ' a week limit', num(byLimit) + ' at the limit', 'Counted first, whatever their risk')] : []),
      chose: 'Rest at the usual risk', why: total ? 'Resting ' + num(total) + ' protects the people most likely to unsubscribe without cutting the send for the other ' + num(Math.max(0, reachable - total)) + ' reachable people (capped at ' + gp.maxPct + '% of the audience).'
        : 'Nobody crosses the bar, so the send goes to everyone who agreed to hear from the brand.' };
    var beats = [];
    if (total && c && !!(d.campaignId)) {
      // Guard vs the proposer of the send (Copy Drafter when messages exist, else Campaign Planner): quantify what resting costs
      var proposer = d.content && d.content.messages && d.content.messages.length ? 'copy' : 'planner', exp = 0, buyers = 0, aovSum = 0;
      for (var pi = 0; pi < P.n; pi++) { if (P.orders[pi] > 0 && P.aov[pi] > 0) { buyers++; aovSum += P.aov[pi]; } }
      var aov = buyers ? aovSum / buyers : 80;
      Object.keys(rested).forEach(function (i) { exp += P.prop[i]; });
      var cost = exp * aov;
      var pos1 = (proposer === 'copy' ? 'The message is ready to send to everyone who can be reached' : 'The campaign is planned to reach everyone who can be reached') + ' (' + num(reachable) + ' on ' + listJoin(chans.map(chLower)) + ').';
      var pos2 = num(total) + (total === 1 ? ' person has' : ' people have') + ' heard from the brand too often' + (cap && byLimit ? ' (' + num(byLimit) + ' already at your ' + cap.value + ' a week limit)' : '') + ', and another message makes them likely to unsubscribe. Their expected orders over the next 30 days are worth about ' + money(cost) + '; resting them delays the message, not those orders.';
      var res = 'Guard wins for those ' + num(total) + (total === 1 ? ' person' : ' people') + ' until ' + dayShort(dayOf(until)) + '; ' + (leftOver ? 'another ' + num(leftOver) + ' stay in because Guard rests at most ' + gp.maxPct + '% of an audience; ' : '') + 'everyone else still gets the send.';
      beats.push({ agentId: 'guard', kind: 'disagree', text: 'Fatigue Guard objected to sending to ' + num(total) + (total === 1 ? ' person' : ' people') + ' who have heard from the brand too often. ' + res, stepId: st.id,
        sides: [{ agentId: proposer, position: pos1 }, { agentId: 'guard', position: pos2 }], resolution: res });
    }
    beats.push({ agentId: 'guard', kind: 'did', text: text, stepId: st.id });
    return { beats: beats, actions: actions, note: text, decision: decision };
  };

  // ---- Send-Time Tuner (same scoring: smoothed best-hour histogram, 3-hour window, quiet hours off limits) ----
  function smooth3(a) { var n = a.length, o = []; for (var h = 0; h < n; h++) o.push(0.25 * a[(h + n - 1) % n] + 0.5 * a[h] + 0.25 * a[(h + 1) % n]); return o; }
  function bestHourFor(world, bits, ch) {
    var P = world.profiles, bit = MC.CH.BIT[ch], hist = [], h, n = 0, known = 0;
    for (h = 0; h < 24; h++) hist.push(0);
    for (var i = 0; i < P.n; i++) {
      if (bits && !bits[i]) continue;
      if ((P.consent[i] & bit) === 0 || (P.unsub[i] & bit) !== 0) continue;
      n++; hist[P.bestHr[i] % 24]++;
      var o = 0; for (var k = 0; k < 24; k++) o += P.openHr[i * 24 + k];
      if (o >= 3) known++;
    }
    if (!n) return null;
    var w = smooth3(hist.map(function (x) { return x / n; })), quiet = (world.guardrails && world.guardrails.quiet) || { start: 21, end: 8, channels: ['sms', 'push'] };
    var q = (quiet.channels || []).indexOf(ch) >= 0, best = -1, bestV = -1, top = 0;
    hist.forEach(function (x) { if (x > top) top = x; });
    for (h = 0; h < 24; h++) {
      if (q && (T().inQuiet(h, quiet) || T().inQuiet((h + 1) % 24, quiet) || T().inQuiet((h + 2) % 24, quiet))) continue;
      var v = (w[h] + w[(h + 1) % 24] + w[(h + 2) % 24]) / 3;
      if (v > bestV + 1e-12) { bestV = v; best = h; }
    }
    if (best < 0) return null;
    var adaptive = known / n >= 0.5 && top / n < 0.2;
    return { hour: adaptive ? 'adaptive' : best, best: best, share: top / n, n: n };
  }
  // The three best 3-hour windows for a channel with the share of this audience's opens that land in each (quiet hours excluded).
  function hourOptions(world, bits, ch) {
    var P = world.profiles, bit = MC.CH.BIT[ch], hist = [], h, tot = 0;
    for (h = 0; h < 24; h++) hist.push(0);
    for (var i = 0; i < P.n; i++) {
      if (bits && !bits[i]) continue;
      if ((P.consent[i] & bit) === 0 || (P.unsub[i] & bit) !== 0) continue;
      for (var k = 0; k < 24; k++) { var o = P.openHr[i * 24 + k]; hist[k] += o; tot += o; }
    }
    if (!tot) return [];
    var quiet = (world.guardrails && world.guardrails.quiet) || { start: 21, end: 8, channels: ['sms', 'push'] }, q = (quiet.channels || []).indexOf(ch) >= 0, out = [];
    for (h = 0; h < 24; h++) {
      var blocked = q && (T().inQuiet(h, quiet) || T().inQuiet((h + 1) % 24, quiet) || T().inQuiet((h + 2) % 24, quiet));
      out.push({ hour: h, share: (hist[h] + hist[(h + 1) % 24] + hist[(h + 2) % 24]) / tot, blocked: blocked });
    }
    return out.filter(function (x) { return !x.blocked; }).sort(function (a, b) { return (b.share - a.share) || (a.hour - b.hour); }).slice(0, 3);
  }
  EXEC.sendtime = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No campaign to schedule.', beats: [] };
    var bits = audienceBits(world, m), parts = [], actions = [];
    c.channels.forEach(function (ch) {
      if (MC.CH.OWNED.indexOf(ch) < 0) return;
      var b = bestHourFor(world, bits, ch);
      if (!b) return;
      var cur = world.campaigns.byId[c.id].sendHour[ch];
      if (cur !== b.hour) {
        var r = doAction(world, t, 'sendtime', { type: 'campaign/setSendHour', payload: { id: c.id, channel: ch, hour: b.hour } });
        if (!r.ok) return;
        actions.push({ type: 'campaign/setSendHour', channel: ch, hour: b.hour });
      }
      parts.push(chName(ch) + ' ' + (b.hour === 'adaptive' ? 'at each person’s best hour' : 'at ' + MC.fmt.hour(b.hour)));
    });
    var firstOwned = c.channels.filter(function (ch) { return MC.CH.OWNED.indexOf(ch) >= 0; })[0], hopts = firstOwned ? hourOptions(world, bits, firstOwned) : [], bh = firstOwned ? bestHourFor(world, bits, firstOwned) : null;
    var hdec = null;
    if (hopts.length) {
      var shown = hopts.map(function (x) { return opt(MC.fmt.hour(x.hour), pct(x.share, 1) + ' of opens', x.hour === (bh && bh.best) ? 'Best 3-hour window' + (bh.hour === 'adaptive' ? ', but opens are spread out so each person gets their own hour' : '') : 'Runner-up'); });
      var topS = hopts[0].share, runner = hopts[1];
      hdec = { options: shown.concat(bh && bh.hour === 'adaptive' ? [opt('Each person’s own best hour', 'most already have a pattern', 'Opens are spread across the day, so one hour would miss most people')] : []),
        chose: bh && bh.hour === 'adaptive' ? 'Each person’s own best hour' : MC.fmt.hour(bh ? bh.best : hopts[0].hour),
        why: chName(firstOwned) + ': ' + pct(topS, 1) + ' of this audience’s opens land in the best window' + (runner ? ', against ' + pct(runner.share, 1) + ' in the next best' : '') + (firstOwned === 'sms' || firstOwned === 'push' ? '; quiet hours are off limits' : '') + '.' };
    }
    if (!parts.length) return { skip: true, note: 'No email, SMS or push to time.', beats: [{ agentId: 'sendtime', kind: 'did', text: 'This campaign has no email, SMS or push, so there’s nothing to time.' }] };
    var text = 'Set sends to ' + listJoin(parts) + ', when this audience opens most' + ((c.channels.indexOf('sms') >= 0 || c.channels.indexOf('push') >= 0) ? ' and outside quiet hours' : '') + '.';
    return { beats: [{ agentId: 'sendtime', kind: 'did', text: text }], actions: actions, note: text, decision: hdec };
  };

  // ---- Budget Pacer (planner's response curves: equal marginal return across channels, total unchanged) ----
  function splitFor(world, m, c, total) {
    var active = c.channels.filter(function (ch) { return !(c.channelPaused && c.channelPaused[ch]); });
    if (!active.length) return null;
    var brief = { name: c.name, goal: { type: c.goal.type, target: c.goal.target }, productFocus: c.productFocus, segmentId: c.segmentId, budget: Math.max(500, Math.round(total)),
      startDay: dayOf(c.startTick), endDay: dayOf(c.endTick - 1), channels: active, tone: c.tone, offer: c.offer, notes: '', eventDay: c.eventDay };
    var plan = MC.planner.plan(world, brief), by = plan.sections.budget.byChannel, out = {}, sum = 0, big = active[0];
    active.forEach(function (ch) { out[ch] = Math.max(0, Math.round((by[ch] || 0) * total / Math.max(1, plan.sections.budget.total) / 10) * 10); sum += out[ch]; if (out[ch] > out[big]) big = ch; });
    out[big] += Math.round(total) - sum;
    return { byChannel: out, why: plan.sections.budget.why || [], active: active };
  }
  EXEC.pacer = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No campaign to pace.', beats: [] };
    var sp = splitFor(world, m, c, c.budget.total);
    if (!sp) return { skip: true, note: 'No active channels.', beats: [] };
    var by = {};
    c.channels.forEach(function (ch) { by[ch] = sp.active.indexOf(ch) >= 0 ? sp.byChannel[ch] : 0; });
    var moved = 0, to = null, from = null, up = 0, down = 0;
    c.channels.forEach(function (ch) {
      var dlt = by[ch] - (c.budget.byChannel[ch] || 0);
      if (dlt > up) { up = dlt; to = ch; }
      if (-dlt > down) { down = -dlt; from = ch; }
    });
    moved = Math.min(up, down);
    var pdec = { options: sp.why.map(function (w) { return opt(chName(w.ch), marginalText(w.marginal) + ' on the next dollar', money(c.budget.byChannel[w.ch] || 0) + ' now' + (by[w.ch] !== (c.budget.byChannel[w.ch] || 0) ? ', ' + money(by[w.ch]) + ' after' : ', stays')); }), chose: '', why: '' };
    if (Math.abs(up) + Math.abs(down) < 50) {
      pdec.chose = 'Leave the split'; pdec.why = 'The next dollar earns about the same on every channel, so moving money would not help.';
      return { beats: [{ agentId: 'pacer', kind: 'did', text: 'The split across ' + listJoin(c.channels.map(chLower)) + ' already earns about the same on the next dollar, so the split is unchanged.' }], note: 'Split unchanged.', decision: pdec };
    }
    var r = doAction(world, t, 'pacer', { type: 'campaign/setBudget', payload: { id: c.id, byChannel: by } });
    if (!r.ok) return { error: r.error };
    var w = sp.why.filter(function (x) { return x.ch === to; })[0];
    var wf = sp.why.filter(function (x) { return x.ch === from; })[0];
    var text = 'Moved ' + money(moved) + ' from ' + chLower(from) + ' to ' + chLower(to) + (w && w.marginal >= 0.01 ? ', where the next $1 returns about $' + w.marginal.toFixed(2) : ', where it has more room to work') + '. The total stays at ' + money(c.budget.total) + '.';
    pdec.chose = 'Move ' + money(moved) + ' from ' + chName(from) + ' to ' + chName(to);
    pdec.why = 'Money goes where the next dollar returns the most' + (w && wf && w.marginal >= 0.01 ? ': ' + chName(to) + ' at about $' + w.marginal.toFixed(2) + ' against about $' + (wf.marginal >= 0.01 ? wf.marginal.toFixed(2) : '0.00 to 0.01') + ' on ' + chLower(from) : '') + '. The total stays at ' + money(c.budget.total) + '.';
    return { beats: [{ agentId: 'pacer', kind: 'did', text: text }], actions: [{ type: 'campaign/setBudget', id: c.id }], note: text, decision: pdec };
  };

  // ---- Lead hands the draft over ----
  EXEC.handoff = function (world, t, m, st) {
    var c = campaignOf(world, m), d = m.data || {};
    if (!c) return { skip: true, note: 'Nothing to hand over.', beats: [] };
    var fc = d.planForecast || {};
    var metric = L().metricNoun(m.objective.metric);
    var items = [];
    try { items = MC.guardrails.preflight(world, world.campaigns.byId[c.id]) || []; } catch (e) { items = []; }
    var fails = items.filter(function (x) { return x.status === 'fail'; }), warns = items.filter(function (x) { return x.status === 'warn'; });
    var status = fails.length ? 'It still needs ' + listJoin(fails.map(function (x) { return x.label.toLowerCase(); })) + ' before it can be scheduled.'
      : (warns.length ? 'Checks pass with ' + warns.length + (warns.length === 1 ? ' warning.' : ' warnings.') : 'Every check passes.');
    var q = '“' + c.name + '” is drafted. Ready to schedule it for ' + dayShort(dayOf(c.startTick)) + '?';
    var ask = { kind: 'launch', agentId: 'lead', blocking: false, question: q,
      why: status + ' Nothing sends until it passes the launch checklist and you schedule it.', impact: { metric: metric, lo: fc.lo || 0, hi: fc.hi || 0 },
      options: ['Yes, schedule it', 'Not yet'], default: 'Yes, schedule it' };
    var made = d.content && d.content.summary ? ' (' + d.content.summary + ')' : '';
    return { beats: [{ agentId: 'lead', kind: 'did', text: 'The draft is ready' + made + ' and checks have run. ' + status }], asks: [ask], note: 'Handed over for sign-off.' };
  };

  // ---- Insight Analyst: start tracking ----
  EXEC.monitor = function (world, t, m, st) {
    var pr = computeProgress(world, m, t);
    var text = 'Checked every morning at ' + MC.fmt.hour(M.CHECKIN_HOUR) + ' against ' + L().fmtMetric(m.objective.metric, m.objective.target) + ' ' + L().metricNoun(m.objective.metric) + ' ' +
      (m.objective.deadlineText || 'by ' + dayShort(m.objective.by)) + '. ' + (pr.hasCampaign ? 'Expecting roughly ' + L().fmtMetric(m.objective.metric, pr.forecast) + ' from the campaign as planned.' : 'There’s no campaign running yet, so progress starts at zero.');
    var vv = M.verdict(world, m, t);
    return { beats: [{ agentId: 'analyst', kind: 'did', text: text }], note: 'Tracking daily.', progress: vv || undefined,
      decision: { options: [opt('Check in every morning', 'react within a day', pr.daysLeft + (pr.daysLeft === 1 ? ' day' : ' days') + ' left to ' + dayShort(m.objective.by)), opt('Check in weekly', 'react within a week', pr.daysLeft > 7 ? 'Too slow to correct a miss' : 'Longer than the time left')],
        chose: 'Check in every morning', why: pr.hasCampaign ? 'A daily look against ' + L().fmtMetric(m.objective.metric, m.objective.target) + ' ' + L().metricNoun(m.objective.metric) + ' lets me re-plan while there’s time.' : 'There’s no campaign yet; the daily look starts once there is one.' } };
  };

  // ---- steering / re-plan steps ----
  EXEC.extend = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No campaign to extend.', beats: [] };
    var end = T().tickOf(m.objective.by + 1, 0);
    if (!(end > t)) return { skip: true, note: 'The deadline has passed.', beats: [] };
    if (c.endTick === end) return { skip: true, note: 'Already ends then.', beats: [] };
    var r = doAction(world, t, 'planner', { type: 'campaign/setEnd', payload: { id: c.id, endTick: end } });
    if (!r.ok) return { error: r.error };
    var text = 'Moved the end of “' + c.name + '” from ' + dayShort(dayOf(c.endTick - 1)) + ' to ' + dayShort(m.objective.by) + '.';
    return { beats: [{ agentId: 'planner', kind: 'did', text: text }], actions: [{ type: 'campaign/setEnd', id: c.id }], note: text };
  };
  EXEC.widen = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No campaign to widen.', beats: [] };
    var brief = { name: c.name, goal: { type: c.goal.type, target: c.goal.target }, productFocus: c.productFocus, segmentId: c.segmentId, budget: Math.max(500, c.budget.total),
      startDay: dayOf(c.startTick), endDay: dayOf(c.endTick - 1), channels: c.channels, tone: c.tone, offer: c.offer, notes: '', eventDay: c.eventDay };
    var plan = MC.planner.plan(world, brief), cur = c.segmentId, have = c.include || [], pick = null;
    plan.sections.audience.options.forEach(function (o) { if (!pick && o.segmentId && o.segmentId !== cur && have.indexOf(o.segmentId) < 0 && o.size >= M.MIN_AUDIENCE) pick = o; });
    if (!pick) return { skip: true, note: 'No similar audience worth adding.', beats: [{ agentId: 'scout', kind: 'did', text: 'No similar group of customers was large enough to add that is not already covered.' }] };
    var r = doAction(world, t, 'scout', { type: 'campaign/include', payload: { id: c.id, segmentId: pick.segmentId, on: true } });
    if (!r.ok) return { error: r.error };
    var text = 'Added ' + lowerFirst(pick.name) + ' (' + num(pick.size) + ' people, ' + num(pick.reach) + ' reachable) to “' + c.name + '”.';
    return { beats: [{ agentId: 'scout', kind: 'did', text: text }], actions: [{ type: 'campaign/include', id: c.id }], artifact: { kind: 'segment', id: pick.segmentId }, note: text };
  };
  EXEC.offer = function (world, t, m, st) {
    var c = campaignOf(world, m), cap = offerCap(m);
    if (!c || cap === null) return { skip: true, note: 'Nothing to change.', beats: [] };
    var pctNow = L().OFFER_PCT[c.offer] || 0;
    var to = L().offerFor((m.data || {}).template, m.objective.constraints);
    var data = { overrides: assign({}, (m.data || {}).overrides || {}, { offer: to }) };
    if (pctNow <= cap) return { skip: true, note: 'Already within the limit.', data: data, beats: [{ agentId: 'planner', kind: 'did', text: 'The offer on “' + c.name + '” (' + L().offerLabel(c.offer) + ') is already within your limit.' }] };
    var r = doAction(world, t, 'planner', { type: 'campaign/update', payload: { id: c.id, patch: { offer: to } } });
    if (!r.ok) return { error: r.error };
    var text = 'Changed the offer on “' + c.name + '” from ' + L().offerLabel(c.offer) + ' to ' + L().offerLabel(to) + ' to stay within ' + (cap > 0 ? cap + '% off' : 'no discounts') + '.';
    return { beats: [{ agentId: 'planner', kind: 'did', text: text }], actions: [{ type: 'campaign/update', id: c.id }], data: data, note: text };
  };
  EXEC.rewrite = function (world, t, m, st) {
    var c = campaignOf(world, m);
    if (!c) return { skip: true, note: 'No messages to rewrite.', beats: [] };
    var live = MC.catalog.variantsOf(world, c.id).filter(function (v) { return v.status !== 'retired'; }), retired = 0, actions = [];
    live.forEach(function (v) {
      var r = doAction(world, t, 'copy', { type: 'variant/setStatus', payload: { id: v.id, status: 'retired' } });
      if (r.ok) { retired++; actions.push({ type: 'variant/setStatus', id: v.id }); }
    });
    var c2 = world.campaigns.byId[c.id];
    var prev = {}, pc = (m.data || {}).content;
    ((pc && pc.headlineIds) || []).forEach(function (id) { prev[id] = true; });
    var asm = assemble(world, t, m, c2, { avoid: prev });
    if (!asm.messages.length) asm = assemble(world, t, m, c2, { avoid: {} });
    if (asm.messages.length) {
      var bb = contentBeat(world, asm, c2, true), at = bb.text + ' Replacing ' + retired + ' older ' + (retired === 1 ? 'variant' : 'variants') + '.';
      return { decision: asm.decision, beats: [{ agentId: 'copy', kind: 'did', text: at }], actions: actions.concat(asm.actions), note: bb.summary, artifact: { kind: 'message', id: asm.messages[0].id },
        artifacts: asm.messages.slice(1).map(function (x) { return { kind: 'message', id: x.id }; }),
        data: { content: { messages: asm.messages.map(function (x) { return x.id; }), channels: asm.chans.slice(), summary: bb.summary, headlineIds: asm.headlineIds.slice() } } };
    }
    var res = writeVariants(world, t, m, c2, { round: 1 });
    if (!res.n) return { error: 'None of the new drafts passed the brand checks.' };
    var text = 'Rewrote the messages around ' + L().offerLabel(c2.offer) + ': ' + res.n + ' new variants, replacing ' + retired + '. They’re in review.';
    return { beats: [{ agentId: 'copy', kind: 'did', text: text }], actions: actions.concat(res.actions), note: text };
  };
  // Taking a channel out removes it everywhere: the campaign's channel list, budget, send hour, journey sends and its message
  // versions (campaign/dropChannel); the freed budget moves to the other channels, and the mission's own notes forget it.
  EXEC.channel = function (world, t, m, st) {
    var c = campaignOf(world, m), ch = st.channel;
    if (!c || !ch || c.channels.indexOf(ch) < 0) return { skip: true, note: 'That channel isn’t in the campaign.', beats: [] };
    if (c.channels.length < 2) return { skip: true, note: 'It’s the only channel left.', beats: [{ agentId: 'planner', kind: 'did', text: chName(ch) + ' is the only channel in “' + c.name + '”, so it stays rather than send nothing.' }] };
    var fromCh = c.channels.map(chLower), held = c.budget.byChannel[ch] || 0, versions = MC.catalog.variantsOf(world, c.id, ch).length, sends = c.journey.steps.filter(function (x) { return x.type === 'send' && x.channel === ch; }).length;
    var r = doAction(world, t, 'planner', { type: 'campaign/dropChannel', payload: { id: c.id, channel: ch, keepTotal: true } });
    if (!r.ok) return { error: r.error };
    var c2 = world.campaigns.byId[c.id], keepCh = c2.channels.slice(), msgs = ((m.data || {}).content) || null;
    var data = { channels: keepCh };
    if ((m.data || {}).audience && m.data.audience.primary === ch) data.audience = assign({}, m.data.audience, { primary: keepCh[0] });
    if (msgs) data.content = assign({}, msgs, { channels: (msgs.channels || []).filter(function (x) { return x !== ch; }) });
    if ((m.data || {}).optimalSplit) { var os = assign({}, m.data.optimalSplit); delete os[ch]; data.optimalSplit = os; }
    var text = 'Took ' + chLower(ch) + ' out of “' + c.name + '”: its ' + (sends === 1 ? 'send' : sends + ' sends') + ' in the journey, its ' + versions + (versions === 1 ? ' message version' : ' message versions') + ' and its ' + money(held) + ' budget moved or went with it. The total stays at ' + money(c2.budget.total) + '.';
    var dec = { options: [opt('Remove ' + chName(ch) + ' completely', versions + ' versions, ' + sends + ' sends, ' + money(held), 'Nothing about it stays in the journey, budget or messages'), opt('Pause ' + chName(ch), money(held) + ' stays reserved', 'It would still show in the journey and the budget, and could be switched back on by mistake')],
      chose: 'Remove ' + chName(ch) + ' completely', why: 'You said no ' + chLower(ch) + ', so leaving it paused would keep it in the journey and the numbers. Its ' + money(held) + ' goes to ' + listJoin(keepCh.map(chLower)) + '.' };
    return { beats: [{ agentId: 'planner', kind: 'did', text: text, diff: [{ what: 'Channels', from: fromCh.join(', '), to: keepCh.map(chLower).join(', ') }, { what: 'Journey sends', from: String(c.journey.steps.filter(function (x) { return x.type === 'send'; }).length), to: String(c2.journey.steps.filter(function (x) { return x.type === 'send'; }).length) }, { what: chName(ch) + ' budget', from: money(held), to: '$0' }] }],
      actions: [{ type: 'campaign/dropChannel', id: c.id, channel: ch }], note: text, data: data, decision: dec };
  };

  // ---- Budget Pacer's say on a budget change. Pacer weighs what the dollars being removed earn. ----
  function returnOnCut(world, m, c, lim) {
    var sp = splitFor(world, m, c, c.budget.total), active = sp ? sp.why : [], cut = c.budget.total - lim;
    if (!active.length || !(cut > 0)) return null;
    var wsum = 0, wtot = 0;
    active.forEach(function (w) { var amt = c.budget.byChannel[w.ch] || 0; wsum += w.marginal * amt; wtot += amt; });
    var avg = wtot ? wsum / wtot : 0, low = active.slice().sort(function (a, b) { return a.marginal - b.marginal; })[0];
    return { marginal: avg, gives: cut * avg, lowCh: low.ch, lowMarginal: low.marginal, why: active };
  }
  EXEC.budget = function (world, t, m, st) {
    var c = campaignOf(world, m), lim = st.limit;
    if (!c || !(lim > 0)) return { skip: true, note: 'Nothing to change.', beats: [] };
    if (c.budget.total <= lim) return { skip: true, note: 'Already within the limit.', beats: [{ agentId: 'planner', kind: 'did', text: 'The campaign budget (' + money(c.budget.total) + ') is already within ' + money(lim) + '.' }] };
    var roc = returnOnCut(world, m, c, lim), sp = splitFor(world, m, c, lim), by = {}, used = 0;
    if (sp) c.channels.forEach(function (ch) { by[ch] = sp.active.indexOf(ch) >= 0 ? sp.byChannel[ch] : 0; });
    else {
      var keys = c.channels.slice(), big = keys[0];
      keys.forEach(function (ch) { by[ch] = Math.floor((c.budget.byChannel[ch] || 0) * lim / c.budget.total / 10) * 10; used += by[ch]; if (by[ch] > by[big]) big = ch; });
      by[big] += Math.floor(lim) - used;
    }
    var before = c.budget.total, r = doAction(world, t, 'planner', { type: 'campaign/setBudget', payload: { id: c.id, byChannel: by } });
    if (!r.ok) return { error: r.error };
    var text = 'Cut the budget on “' + c.name + '” from ' + money(before) + ' to ' + money(lim) + ', re-split so the cut falls where the next dollar returns least.';
    var beats = [];
    if (roc && roc.gives >= 1) {
      var pos1 = 'You asked to keep spend under ' + money(lim) + ', so the budget has to come down from ' + money(before) + '.';
      var pos2 = 'The ' + money(before - lim) + ' being cut earns about ' + money(roc.gives) + ' in return at today’s rates (' + marginalText(roc.marginal) + ' on average); keeping it is the alternative if the limit were not set.';
      var res = 'Your limit stands. I re-split the smaller budget so each channel’s next dollar returns about the same, rather than cutting every channel evenly.';
      beats.push({ agentId: 'pacer', kind: 'disagree', text: 'Budget Pacer pushed back on cutting spend: it gives up about ' + money(roc.gives) + ' in return. ' + res, stepId: st.id,
        sides: [{ agentId: 'planner', position: pos1 }, { agentId: 'pacer', position: pos2 }], resolution: res });
    }
    beats.push({ agentId: 'planner', kind: 'did', text: text, stepId: st.id, diff: [{ what: 'Budget', from: money(before), to: money(lim) }].concat(c.channels.filter(function (ch) { return (c.budget.byChannel[ch] || 0) !== by[ch]; }).map(function (ch) { return { what: chName(ch), from: money(c.budget.byChannel[ch] || 0), to: money(by[ch]) }; })) });
    var dec = { options: [opt('Keep ' + money(before), roc ? 'about ' + money(roc.gives) + ' more back' : '', 'Over your ' + money(lim) + ' limit'), opt('Cut to ' + money(lim), 'within your limit', 'Re-split by the next dollar’s return'), opt('Cut evenly across channels', '', 'Simpler, but cuts strong channels as hard as weak ones')],
      chose: 'Cut to ' + money(lim), why: 'Spend under ' + money(lim) + ' is your limit, so the total is fixed; the open question was where to cut, and equal returns on the next dollar decides that.' };
    return { beats: beats, actions: [{ type: 'campaign/setBudget', id: c.id }], data: { overrides: assign({}, (m.data || {}).overrides || {}, { budget: lim }) }, note: text, decision: dec };
  };


  // A decision for steps whose executor didn't build one: the alternatives and numbers the step could have used, from world state.
  function fallbackDecision(world, t, m, st, r) {
    var c = campaignOf(world, m), o = m.objective, days = Math.max(0, o.by - dayOf(t) + 1);
    if (r.skip) return { options: [opt('Do it', '', 'Not needed right now'), opt('Skip it', '', r.note || 'Nothing to change')], chose: 'Skip it', why: r.note || 'There was nothing for this step to change.' };
    if (st.kind === 'handoff' && c) {
      var items = []; try { items = MC.guardrails.preflight(world, world.campaigns.byId[c.id]) || []; } catch (e) { items = []; }
      var fails = items.filter(function (x) { return x.status === 'fail'; }).length, warns = items.filter(function (x) { return x.status === 'warn'; }).length;
      return { options: [opt('Ask for sign-off now', fails + ' failing, ' + warns + ' warnings', 'The draft is a draft; nothing sends until you schedule it'), opt('Keep polishing first', '', 'Delays your decision without changing what you can decide')],
        chose: 'Ask for sign-off now', why: fails ? 'It still has ' + fails + ' failing ' + (fails === 1 ? 'check' : 'checks') + ', which the ask says plainly, but nothing sends until those pass.' : 'No check fails, and the decision is yours to make either way.' };
    }
    if (st.kind === 'monitor') {
      return { options: [opt('Check in every morning', 'react within 1 day', days + (days === 1 ? ' day' : ' days') + ' left to the deadline'), opt('Check in weekly', 'react within 7 days', days > 7 ? 'Slow for a ' + days + '-day goal' : 'More than the time that is left')],
        chose: 'Check in every morning', why: 'A miss found a week late can’t be fixed in ' + days + (days === 1 ? ' day' : ' days') + '; a daily look costs nothing.' };
    }
    if (st.kind === 'extend' && c) {
      return { options: [opt('End on ' + dayShort(o.by), 'to your deadline', 'The goal counts through that day'), opt('Keep the old end date', '', 'Ends before the deadline, leaving days unused')], chose: 'End on ' + dayShort(o.by), why: 'The goal counts sales until ' + dayShort(o.by) + ', so a campaign that stops sooner leaves days on the table.' };
    }
    if (st.kind === 'widen' && c) {
      var cands = audienceCandidates(world, m, c.segmentId).filter(function (x) { return x.segmentId !== c.segmentId; }).slice(0, 3);
      if (cands.length) return { options: cands.map(audOpt), chose: r.artifact ? ((world.segments.byId[r.artifact.id] || {}).name || cands[0].name) : cands[0].name, why: 'The closest group by expected value that the campaign doesn’t already cover and that is big enough to measure.' };
    }
    if (st.kind === 'offer' && c) {
      var cap = offerCap(m), now = L().OFFER_PCT[c.offer] || 0, to = L().offerFor((m.data || {}).template, m.objective.constraints);
      return { options: [opt(L().offerLabel(c.offer), now + '% off', 'What the draft had'), opt(L().offerLabel(to), (L().OFFER_PCT[to] || 0) + '% off', 'Within the ' + (cap > 0 ? cap + '% limit' : 'no-discount limit'))], chose: L().offerLabel(to), why: 'The best offer that stays inside what you allowed.' };
    }
    if (st.kind === 'rewrite') return { options: [opt('Re-assemble from approved blocks', '', 'Keeps copy inside the brand and the new offer'), opt('Keep the old messages', '', 'They mention the old offer')], chose: 'Re-assemble from approved blocks', why: 'The old copy no longer matches the offer you allowed.' };
    if (st.kind === 'copy') return { options: [opt('Write variants directly', '', 'The library had no approved blocks that fit')], chose: 'Write variants directly', why: 'No approved headline fit this campaign, so each channel got brand-checked drafts instead.' };
    if (st.kind === 'pacer' || st.kind === 'sendtime') return { options: [opt('Leave it as drafted', '', ''), opt('Change it', '', '')], chose: r.note || 'Changed it', why: r.note || '' };
    return { options: [opt('Do it', '', ''), opt('Wait', '', '')], chose: 'Do it', why: r.note || '' };
  }

  M._exec = EXEC;

  /* ======================= progress and check-ins ======================= */
  var METRIC_F = { reactivations: 'REACT', revenue: 'REV', orders: 'CONV', signups: 'CONV', unsubs: 'UNSUB' };
  function dayValue(world, d, cid, idx) {
    var e = world.metrics.days[d - T().DAY0], cd = e && e.c && e.c[cid];
    return cd && cd.tot ? cd.tot[idx] : 0;
  }
  function allDayValue(world, d, idx) { var e = world.metrics.days[d - T().DAY0]; return e && e.tot ? e.tot[idx] : 0; }
  // computeProgress(world, mission, t) -> { value, target, forecast, lo, hi, band, daysLeft, hasCampaign, live }
  function computeProgress(world, m, t) {
    var o = m.objective, idx = F()[METRIC_F[o.metric]], today = dayOf(t), by = o.by, target = o.target;
    var cids = (m.artifacts || []).filter(function (a) { return a.kind === 'campaign' && world.campaigns.byId[a.id]; }).map(function (a) { return a.id; });
    var value = 0, forecast = 0, live = false, completeMax = 0, hasCampaign = cids.length > 0;
    var startDay = Math.max(T().DAY0, dayOf(m.createdTick));
    var totalDays = Math.max(1, by - startDay + 1), daysLeft = Math.max(0, by - today + 1);
    if (o.metric === 'unsubs') {
      var series = [];
      for (var d = startDay; d < today; d++) series.push(allDayValue(world, d, idx));
      value = 0; for (var d2 = startDay; d2 <= today; d2++) value += allDayValue(world, d2, idx);
      var rate = series.length ? series.slice(-7).reduce(function (a, b) { return a + b; }, 0) / Math.min(7, series.length) : 0;
      forecast = value + rate * daysLeft;
      live = true; completeMax = series.length;
    } else {
      cids.forEach(function (cid) {
        var c = world.campaigns.byId[cid];
        if (c.status === 'live' || c.status === 'completed') live = true;
        var cs = Math.max(T().DAY0, dayOf(c.startTick)), ce = dayOf(c.endTick - 1), v = 0, series2 = [];
        for (var x = cs; x <= Math.min(today, ce); x++) v += dayValue(world, x, cid, idx);
        for (var y = cs; y < Math.min(today, ce + 1); y++) series2.push(dayValue(world, y, cid, idx));
        value += v;
        completeMax = Math.max(completeMax, series2.length);
        var left = c.status === 'completed' ? 0 : Math.max(0, Math.min(by, ce) - Math.max(today, cs) + 1);
        var f;
        var goalMatch = (o.metric === 'reactivations' && c.goal.type === 'reactivation') || (o.metric === 'revenue' && c.goal.type === 'revenue') || ((o.metric === 'orders' || o.metric === 'signups') && c.goal.type === 'conversions');
        var g = goalMatch && MC.select && MC.select.campaignGoal ? MC.select.campaignGoal(world, cid) : null;
        if (g && isNum(g.projected) && !g.early) f = Math.min(g.projected, v + (g.projected - v) * Math.min(1, (left > 0 ? left : 0) / Math.max(1, g.daysLeft || left || 1)));
        else if (series2.length >= 3) f = v + (series2.slice(-7).reduce(function (a, b) { return a + b; }, 0) / Math.min(7, series2.length)) * left;
        else {
          var pf = (m.data || {}).planForecast;
          f = pf && (m.data || {}).campaignId === cid && c.goal.type === ((L().GOAL_TYPE || {})[o.metric]) ? Math.max(v, pf.mean) : v;
        }
        forecast += f;
      });
    }
    var spread = Math.min(0.5, 0.12 + 0.3 * (daysLeft / totalDays));
    var lo = value + (forecast - value) * (1 - spread), hi = value + (forecast - value) * (1 + spread);
    var band = 'early', pace = target > 0 ? forecast / target : 0;
    if (completeMax >= 2 || (hasCampaign && live && completeMax >= 1)) {
      if (o.direction === 'atMost') band = forecast <= target * 0.9 ? 'ahead' : (forecast <= target ? 'on' : 'behind');
      else band = pace >= 1.05 ? 'ahead' : (pace >= 0.85 ? 'on' : 'behind');
    }
    function r1(x) { return o.metric === 'revenue' ? Math.round(x) : Math.round(x * 10) / 10; }
    return { value: r1(value), target: target, forecast: r1(forecast), lo: r1(lo), hi: r1(hi), band: band, daysLeft: daysLeft, hasCampaign: hasCampaign, live: live, pace: pace, completeDays: completeMax, campaignId: cids[0] || null };
  }
  M.progressOf = computeProgress;

  // The forecast verdict beside the goal. Numbers come from MC.metrics.mission (the one definition of mission progress) when it
  // exists; until then the mission's own projection fills in, so the shape never changes:
  // { value, target, forecast, lo, hi, by, verdict: 'on pace' | 'behind' | 'ahead' | 'too early', text }.
  var VERDICTS = ['on pace', 'behind', 'ahead', 'too early'];
  function metricsProgress(world, m) {
    var X = MC.metrics;
    if (!X || typeof X.mission !== 'function') return null;
    var r; try { r = X.mission(world, m.id); } catch (e) { return null; }
    if (!isObj(r)) return null;
    var fc = isObj(r.forecast) ? r.forecast : { value: r.forecast, lo: r.lo, hi: r.hi };
    var base = isObj(r.progress) ? r.progress : r;
    var out = { value: isNum(base.value) ? base.value : null, forecast: isNum(fc.value) ? fc.value : (isNum(fc.mean) ? fc.mean : null), lo: isNum(fc.lo) ? fc.lo : null, hi: isNum(fc.hi) ? fc.hi : null,
      verdict: VERDICTS.indexOf(r.verdict) >= 0 ? r.verdict : null };
    return out.value === null && out.forecast === null ? null : out;
  }
  function verdictFrom(world, m, pr) {
    var o = m.objective, mx = metricsProgress(world, m), v = pr.value, f = pr.forecast, lo = pr.lo, hi = pr.hi, band = pr.band;
    if (mx) {
      if (mx.value !== null) v = mx.value;
      if (mx.forecast !== null) { f = mx.forecast; lo = mx.lo !== null ? mx.lo : f * 0.85; hi = mx.hi !== null ? mx.hi : f * 1.15; }
      if ((band !== 'early' || (mx.value || 0) > 0) && mx.forecast !== null) {
        var pace = o.target > 0 ? f / o.target : 0;
        band = o.direction === 'atMost' ? (f <= o.target * 0.9 ? 'ahead' : (f <= o.target ? 'on' : 'behind')) : (pace >= 1.05 ? 'ahead' : (pace >= 0.85 ? 'on' : 'behind'));
      }
    }
    var verdict = mx && mx.verdict ? mx.verdict : ({ early: 'too early', on: 'on pace', behind: 'behind', ahead: 'ahead' }[band] || 'too early');
    function r1(x) { return o.metric === 'revenue' ? Math.round(x) : Math.round(x * 10) / 10; }
    var out = { value: r1(v), target: o.target, forecast: r1(f), lo: r1(lo), hi: r1(hi), by: o.by, verdict: verdict };
    out.text = L().voice.verdict(m, out);
    return out;
  }
  M.verdict = function (world, m, t) {
    if (!m || !m.objective) return null;
    return verdictFrom(world, m, computeProgress(world, m, t === undefined ? world.meta.tick : t));
  };
  // Open asks across the team: the one count every surface shows (MC.metrics.asks when it exists).
  M.openAskCount = function (world) {
    var X = MC.metrics;
    if (X && typeof X.asks === 'function') {
      try { var r = X.asks(world); if (isNum(r)) return r; if (r && isNum(r.count)) return r.count; if (r && isNum(r.n)) return r.n; if (Array.isArray(r)) return r.length; } catch (e) { /* fall through */ }
    }
    var n = 0;
    M.list(world).forEach(function (mm) { if (mm.status !== 'stopped' && mm.status !== 'done') n += openAsks(mm, false).length; });
    return n;
  };

  function checkin(world, t, m) {
    var day = dayOf(t), pr = computeProgress(world, m, t), prev = m.progress || {};
    var progress = verdictFrom(world, m, pr);
    var beats = [], mission = { progress: progress, lastCheckDay: day };
    var firstOfWeek = !isNum(m.lastBeatDay) || (day - m.lastBeatDay) >= 3;
    var d = m.data || {}, draft = false, c0 = (m.artifacts || []).filter(function (a) { return a.kind === 'campaign'; })[0];
    if (c0 && world.campaigns.byId[c0.id] && world.campaigns.byId[c0.id].status === 'draft') draft = true;
    var bandNow = pr.band, bandPrev = d.band;
    var changed = bandNow !== bandPrev;
    // deadline
    if (day > m.objective.by) {
      var hit = m.objective.direction === 'atMost' ? pr.value <= pr.target : pr.value >= pr.target;
      var text = hit ? 'Finished: ' + L().fmtMetric(m.objective.metric, pr.value) + ' against a goal of ' + L().fmtMetric(m.objective.metric, pr.target) + ' ' + L().metricNoun(m.objective.metric) + '. Goal reached.'
        : 'Finished at ' + L().fmtMetric(m.objective.metric, pr.value) + ' of ' + L().fmtMetric(m.objective.metric, pr.target) + ' ' + L().metricNoun(m.objective.metric) + ' (' + pct(pr.target > 0 ? pr.value / pr.target : 0) + '). The goal was not reached.';
      missionPatch(world, t, m.id, { progress: progress, lastCheckDay: day, status: 'done' }, [{ agentId: 'analyst', kind: 'result', text: text }]);
      return;
    }
    mission.data = { band: bandNow };
    if (draft && !pr.live) {
      if (firstOfWeek || changed) { beats.push({ agentId: 'analyst', kind: 'thought', text: 'The campaign is still a draft, so nothing has been measured yet. Results are reported against a goal of ' + L().fmtMetric(m.objective.metric, m.objective.target) + '.' }); mission.lastBeatDay = day; }
    } else if (firstOfWeek || changed) {
      beats.push({ agentId: 'analyst', kind: 'did', text: L().voice.progress(m, progress, bandNow) + (bandNow === 'behind' ? ' Behind pace.' : (bandNow === 'ahead' ? ' Ahead of plan.' : '')) });
    }
    mission.lastBeatDay = beats.length ? day : m.lastBeatDay;
    // drift: re-plan when behind (at most every few days, a few times)
    var canReplan = pr.band === 'behind' && pr.daysLeft >= 2 && pr.live && (m.replans || 0) < M.MAX_REPLANS &&
      (m.lastReplanDay === null || m.lastReplanDay === undefined || day - m.lastReplanDay >= M.REPLAN_GAP_DAYS) &&
      m.plan.every(function (s) { return s.status === 'done' || s.status === 'skipped'; }) && !openAsks(m, false).some(function (a) { return a.kind === 'behind'; });
    var addSteps = null, asks = [];
    if (canReplan) {
      var cp = pr.campaignId && world.campaigns.byId[pr.campaignId], pacer = null;
      if (cp) { try { var spx = splitFor(world, m, cp, cp.budget.total); if (spx && spx.why.length) { var ws = 0, wt = 0; spx.why.forEach(function (x) { var a = cp.budget.byChannel[x.ch] || 0; ws += x.marginal * a; wt += a; }); var low = spx.why.slice().sort(function (a, b) { return a.marginal - b.marginal; })[0]; pacer = { marginal: wt ? ws / wt : 0, lowCh: low.ch, hiCh: spx.why.slice().sort(function (a, b) { return b.marginal - a.marginal; })[0].ch }; } } catch (e) { pacer = null; } }
      var rm = L().remediate(world, m, { pace: pr.pace, forecast: pr.forecast, target: pr.target, daysLeft: pr.daysLeft, campaignId: pr.campaignId, replans: m.replans || 0, linked: !!d.linked, pacer: pacer });
      if (rm) {
        beats = beats.concat(rm.beats);
        if (rm.added.length) { addSteps = rm.added; mission.phase = 'executing'; }
        asks = rm.asks || [];
        mission.replans = (m.replans || 0) + 1; mission.lastReplanDay = day;
      }
    }
    missionPatch(world, t, m.id, mission, beats, addSteps);
    asks.forEach(function (a) { act(world, t, 'mission/ask', { id: m.id, ask: a }); });
  }

  M.checkin = checkin;
  M.stepById = stepById;
})();
