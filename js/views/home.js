/* Marketing Cloud - Home (#home): MC.views.home.
   Software you use, not a world you watch: one sentence of where the goals stand, the decisions waiting on you,
   each goal as a row with its progress, one revenue chart, and the latest agent work as plain past-tense facts.
   Everything is read from the store (MC.metrics, MC.missions); decisions use the same catalog actions as the Asks
   drawer (mission/answer, proposal cards). Also exports MC.goalUi: the goal row, the decision row and the activity
   facts that the Goals list and the Goal page reuse. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};
  var DASH = '–', DOT = '·', EMPTY = [];

  function html() { return MC.html.apply(null, arguments); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function L() { return MC.lead || {}; }
  function ui(name) { return MC.ui && MC.ui[name] ? MC.ui[name] : null; }
  function agentName(id) { return L().agentName ? L().agentName(id) : (MC.ui && MC.ui.agentName ? MC.ui.agentName(id) : id); }
  function Mark(p) { var C = ui('AgentMark'); return C ? html`<${C} id=${p.id} size=${p.size || 14} />` : null; }
  function money(n, compact) { return fin(n) ? (MC.fmt && MC.fmt.money ? MC.fmt.money(n, compact ? { compact: true } : undefined) : '$' + Math.round(n)) : DASH; }
  function num(n) { return fin(n) ? (MC.fmt && MC.fmt.num ? MC.fmt.num(Math.round(n)) : String(Math.round(n))) : DASH; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function lcFirst(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function world() { return MC.store && MC.store.getState ? MC.store.getState() : null; }
  function go(route, focus) { if (MC.nav && MC.nav.go) MC.nav.go(route, focus); }
  function openGoalDrawer() { try { MC.uiStore.set({ drawer: 'goal' }); } catch (e) { /* shell not ready */ } }
  function ago(tick, now) { try { return MC.time.relative(tick, now) || ''; } catch (e) { return ''; } }
  function useStoreTick() { return MC.hooks.useSelect(function () { return MC.store.version(); }); }

  /* ======================= facts about one goal (shared) ======================= */
  function liveGoals(w) {
    var list = w && w.missions ? MC.missions.list(w) : EMPTY;
    return list.filter(function (m) { return m.status !== 'stopped'; });
  }
  function openAsksOf(m) { return (m.asks || EMPTY).filter(function (a) { return a.status === 'open'; }); }
  function statusOf(m) {
    if (m.status === 'done') return { text: 'Done', tone: 'done' };
    if (m.status === 'stopped') return { text: 'Stopped', tone: 'idle' };
    if (m.status === 'paused') return { text: 'Paused', tone: 'idle' };
    if (openAsksOf(m).length) return { text: 'Needs your decision', tone: 'ask' };
    var r = null;
    try { r = MC.metrics.mission(world(), m.id); } catch (e) { r = null; }
    if (r && r.band === 'met') return { text: 'Ended, goal met', tone: 'done' };
    if (r && r.band === 'missed') return { text: 'Ended, short of goal', tone: 'idle' };
    if ((m.plan || EMPTY).some(function (s) { return s.status === 'working'; })) return { text: 'Working', tone: 'work' };
    return { text: m.phase === 'monitoring' ? 'Tracking results' : 'Planning', tone: 'work' };
  }
  function verdictText(m, r) {
    if (!r || m.status === 'stopped') return '';
    if (r.band === 'met' || r.band === 'missed') return r.text;
    try {
      var f = r.forecast && typeof r.forecast === 'object' ? r.forecast.value : r.forecast;
      return L().voice.verdict(m, { verdict: r.verdict, value: r.value, target: r.target, lo: r.lo, hi: r.hi, forecast: f });
    } catch (e) { return r.text || ''; }
  }
  function goalFacts(w, m) {
    var r = null, o = m.objective || {};
    try { r = MC.metrics.mission(w, m.id); } catch (e) { r = null; }
    var value = r ? r.value : (m.progress ? m.progress.value : 0), target = r ? r.target : o.target;
    var fmt = function (v) { return L().fmtMetric ? L().fmtMetric(o.metric, v) : num(v); };
    return {
      m: m, r: r, status: statusOf(m), pct: target > 0 ? Math.max(0, Math.min(1, value / target)) : 0,
      progress: fmt(value) + ' of ' + fmt(target) + ' ' + (L().metricNoun ? L().metricNoun(o.metric) : ''),
      verdict: verdictText(m, r), tone: r ? r.band : 'early', ask: openAsksOf(m)[0] || null
    };
  }
  // Cumulative revenue per day across the goal's campaigns, for MC.charts.GoalProgress (revenue goals only).
  function goalPoints(w, m, r) {
    if (!r || (m.objective || {}).metric !== 'revenue' || !(r.campaignIds || EMPTY).length) return null;
    var days = {}, lo = Infinity, hi = -Infinity;
    r.campaignIds.forEach(function (cid) {
      var a = MC.metrics.attributed(w, cid);
      if (!a) return;
      Object.keys(a.byDay).forEach(function (d) { days[d] = (days[d] || 0) + a.byDay[d]; lo = Math.min(lo, +d); hi = Math.max(hi, +d); });
    });
    if (!isFinite(lo) || hi - lo < 1) return null;
    var pts = [], run = 0;
    for (var d = lo; d <= hi; d++) { run += days[d] || 0; pts.push({ x: d, y: run }); }
    return { points: pts, startDay: lo };
  }
  function Progress(p) {
    var w = p.world, f = p.facts, m = f.m, G = MC.charts && MC.charts.GoalProgress, gp = G && p.compact !== false ? goalPoints(w, m, f.r) : null;
    if (gp && f.r) {
      var fc = f.r.forecast && typeof f.r.forecast === 'object' ? f.r.forecast : null;
      return html`<${G} compact=${true} points=${gp.points} target=${f.r.target} startDay=${gp.startDay} byDay=${m.objective.by}
        forecast=${fc ? { y: fc.value, lo: fc.lo, hi: fc.hi } : null} label=${'Revenue'} />`;
    }
    return html`<span className="gl-bar" role="img" aria-label=${f.progress + ', ' + Math.round(f.pct * 100) + ' percent'}><i style=${{ width: (f.pct * 100).toFixed(1) + '%' }}></i></span>`;
  }

  /* One goal as a row: title, status, progress number against target, verdict, next decision. */
  function GoalRow(p) {
    var w = p.world, f = goalFacts(w, p.m), m = p.m;
    function open(e) { if (e) e.preventDefault(); go('missions', m.id); }
    return html`<li className=${cx('gl-row', 'is-' + f.status.tone)} data-goal=${m.id}>
      <div className="gl-main">
        <h3 className="gl-title"><a href=${'#missions/' + encodeURIComponent(m.id)} onClick=${open}>${m.goalText}</a></h3>
        <p className="gl-meta"><span className=${cx('gl-status', 'is-' + f.status.tone)}>${f.status.text}</span>
          <span className="gl-num">${f.progress}</span></p>
        ${f.verdict ? html`<p className=${cx('gl-verdict', 'is-' + f.tone)}>${f.verdict}</p>` : null}
        ${f.ask ? html`<p className="gl-next"><span>Next decision</span> <a href=${'#missions/' + encodeURIComponent(m.id)} onClick=${open}>${f.ask.question}</a></p>` : null}
      </div>
      <div className="gl-chart"><${Progress} world=${w} facts=${f} /></div>
    </li>`;
  }
  function GoalRows(p) {
    return html`<ul className="gl-list" aria-label="Goals">${p.goals.map(function (m) { return html`<${GoalRow} key=${m.id} world=${p.world} m=${m} />`; })}</ul>`;
  }

  /* ======================= activity: plain past-tense facts ======================= */
  function factsOf(m) {
    var out = [], steps = {};
    (m.plan || EMPTY).forEach(function (s) { steps[s.id] = s; });
    (m.log || EMPTY).forEach(function (b, i) {
      if (b.kind === 'handoff') return;
      if (b.kind === 'thought' && b.agentId !== 'lead') return;
      var text = b.kind === 'ask' ? 'Asked you: ' + b.text : b.text;
      out.push({ key: m.id + ':' + i, tick: b.tick, agentId: b.agentId, text: text, kind: b.kind, diff: Array.isArray(b.diff) ? b.diff : null, beat: b, mission: m });
    });
    (m.steers || EMPTY).forEach(function (s, i) { out.push({ key: m.id + ':st' + i, tick: s.tick, agentId: 'you', text: 'You steered: ' + s.text, kind: 'steer', mission: m }); });
    return out;
  }
  function recentFacts(w, goals, n) {
    var all = [];
    goals.forEach(function (m) { all = all.concat(factsOf(m)); });
    all.sort(function (a, b) { return b.tick - a.tick; });
    return all.slice(0, n);
  }
  function FactRow(p) {
    var f = p.fact, now = p.now;
    return html`<li className=${cx('act-row', 'k-' + f.kind)}>
      <span className="act-who">${f.agentId === 'you' ? html`<span className="act-you">You</span>` : html`<${Mark} id=${f.agentId} size=${13} /><span>${agentName(f.agentId)}</span>`}
        <time>${ago(f.tick, now)}</time></span>
      <span className="act-text">${f.text}</span>
      ${p.showGoal && f.mission ? html`<a className="act-goal" href=${'#missions/' + encodeURIComponent(f.mission.id)} onClick=${function (e) { e.preventDefault(); go('missions', f.mission.id); }}>${trunc(f.mission.goalText, 56)}</a>` : null}
      ${p.children}
    </li>`;
  }

  /* ======================= decisions waiting on you ======================= */
  function missionOfProposal(w, x) {
    var X = MC.xref, t = x.target || {}, ms;
    if (x.missionId && w.missions && w.missions.byId[x.missionId]) return w.missions.byId[x.missionId];
    if (!X || !t.kind || !t.id) return null;
    try { ms = X.missionsOf(w, t.kind, t.id); } catch (e) { ms = null; }
    return ms && ms[0] ? ms[0] : null;
  }
  function AskRow(p) {
    var React = window.React, es = React.useState(null), msg = es[0], setMsg = es[1], a = p.ask, m = p.m, im = a.impact || {};
    var can = true;
    try { can = MC.catalog.can(MC.uiStore.getState().persona, 'approve'); } catch (e) { can = true; }
    function answer(o) {
      var r = null;
      try { r = MC.missions.answer(m.id, a.id, o); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      setMsg(r && r.ok === false ? (r.error || 'That answer did not go through.') : null);
    }
    return html`<li className="dec-row" data-ask=${a.id}>
      <p className="dec-from"><${Mark} id=${a.agentId} size=${13} /> ${agentName(a.agentId)} ${DOT} <a href=${'#missions/' + encodeURIComponent(m.id)} onClick=${function (e) { e.preventDefault(); go('missions', m.id); }}>${trunc(m.goalText, 64)}</a></p>
      <h3 className="dec-q">${a.question}</h3>
      ${a.why ? html`<p className="dec-why">${a.why}</p>` : null}
      ${(im.lo || im.hi) ? html`<p className="dec-imp">If approved: <b>${num(im.lo)} to ${num(im.hi)}</b>${im.metric ? ' ' + im.metric : ''}</p>` : null}
      <div className="dec-act" role="group" aria-label="Your answer">${(a.options || EMPTY).map(function (o) {
        return html`<button key=${o} type="button" className=${cx('dec-btn', o === a.default && 'is-default')} disabled=${!can} onClick=${function () { answer(o); }}>${o}</button>`;
      })}</div>
      ${msg ? html`<p className="dec-err" role="alert">${msg}</p>` : null}
    </li>`;
  }
  // One line per proposal: what, who, why in a sentence. Low-risk ones can be approved here; the rest open in Approvals.
  function PropRow(p) {
    var React = window.React, es = React.useState(null), msg = es[0], setMsg = es[1], x = p.p;
    var can = true;
    try { can = MC.catalog.can(MC.uiStore.getState().persona, 'approve'); } catch (e) { can = true; }
    function approve() {
      var r = null;
      try { r = MC.store.dispatch({ type: 'proposal/approve', payload: { id: x.id } }); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      setMsg(r && r.ok === false ? (r.error || 'That did not go through.') : null);
    }
    var quick = can && x.risk === 'low';
    return html`<li className="dec-row dec-prop" data-proposal=${x.id}>
      <p className="dec-from"><${Mark} id=${x.agentId} size=${13} /> ${agentName(x.agentId)}${x.risk ? ' ' + DOT + ' ' + x.risk + ' risk' : ''}</p>
      <h3 className="dec-q dec-q--sm">${x.title}</h3>
      ${x.rationale ? html`<p className="dec-why">${trunc(x.rationale, 140)}</p>` : null}
      <div className="dec-act">
        ${quick ? html`<button type="button" className="dec-btn is-default" onClick=${approve}>Approve</button>` : null}
        <button type="button" className="dec-btn" onClick=${function () { go('approvals'); }}>${quick ? 'Details' : 'Review'}</button>
      </div>
      ${msg ? html`<p className="dec-err" role="alert">${msg}</p>` : null}
    </li>`;
  }
  function Decisions(p) {
    var w = p.world, PC = ui('ProposalCard'), asks = [], props = [];
    var snap = null;
    try { snap = MC.metrics.asks(w); } catch (e) { snap = null; }
    if (snap) {
      snap.missionAsks.forEach(function (x) { var m = w.missions.byId[x.missionId]; if (m) asks.push({ ask: x.ask, m: m }); });
      props = snap.proposals;
    }
    var n = asks.length + props.length;
    return html`<section className="hm-sec" aria-labelledby="hm-dec-h">
      <h2 id="hm-dec-h" className="hm-h">Needs your decision${n ? html` <span className="hm-count">${n}</span>` : null}</h2>
      ${n ? html`<ul className="dec-list">
        ${asks.map(function (x) { return html`<${AskRow} key=${x.m.id + ':' + x.ask.id} ask=${x.ask} m=${x.m} />`; })}
        ${props.slice(0, 3).map(function (x) { return html`<${PropRow} key=${x.id} p=${x} />`; })}
      </ul>
      ${props.length > 3 ? html`<p className="hm-more"><a href="#approvals" onClick=${function (e) { e.preventDefault(); go('approvals'); }}>${plural(props.length - 3, 'more suggestion', 'more suggestions')} in Approvals</a></p>` : null}`
      : html`<p className="hm-quiet">Nothing needs a decision. Agents ask here when a choice is yours to make.</p>`}
    </section>`;
  }

  /* ======================= revenue chart ======================= */
  function RevenueChart(p) {
    var C = MC.charts, fc = null;
    try { fc = MC.select.forecast(p.world, { month: true, metric: 'revenue' }); } catch (e) { fc = null; }
    if (!C || !fc || !(fc.actual || EMPTY).length) return html`<p className="hm-quiet">The revenue line appears once a full day of results is in.</p>`;
    var Ch = C.ForecastChart || C.LineChart;
    return html`<${Ch} actual=${fc.actual} forecast=${fc.points} goal=${fc.goal} cumulative=${true} height=${220} yFormat="moneyCompact" label="Revenue" />`;
  }

  /* ======================= the page ======================= */
  function Home() {
    useStoreTick();
    var w = world();
    if (!w) return html`<section className="v-home"><h1 id="page-title" tabIndex="-1">Home</h1></section>`;
    var goals = liveGoals(w), now = w.meta.tick, snap = null, total = 0;
    try { snap = MC.metrics.asks(w); } catch (e) { snap = null; }
    var waiting = snap ? snap.count : 0;
    goals.forEach(function (m) { try { var r = MC.metrics.mission(w, m.id); if (r) total += r.revenue || 0; } catch (e) { /* skip */ } });
    var facts = recentFacts(w, goals, 6), Btn = ui('Button');
    var hero = goals.length
      ? money(total, true) + ' from your goals so far' + (waiting ? ' ' + DOT + ' ' + plural(waiting, 'decision', 'decisions') + ' waiting' : ' ' + DOT + ' nothing needs your decision')
      : 'No goals yet';
    var newBtn = Btn ? html`<${Btn} kind="primary" onClick=${openGoalDrawer}>New goal<//>` : html`<button type="button" onClick=${openGoalDrawer}>New goal</button>`;
    return html`<section className="v-home" aria-label="Home">
      <header className="hm-head">
        <div>
          <h1 id="page-title" tabIndex="-1">Home</h1>
          <p className="hm-hero">${hero}</p>
        </div>
        <div className="hm-head-actions">${newBtn}</div>
      </header>
      <div className="hm-grid">
      <div className="hm-main">
      <section className="hm-sec" aria-labelledby="hm-goals-h">
        <h2 id="hm-goals-h" className="hm-h">Goals <a className="hm-all" href="#missions" onClick=${function (e) { e.preventDefault(); go('missions'); }}>All goals</a></h2>
        ${goals.length ? html`<${GoalRows} world=${w} goals=${goals} />` : (function () {
          var E = ui('EmptyState');
          return E ? html`<${E} title="Give the agents a goal" body="Say the outcome, the deadline and any limits. Agents plan it, do the work and ask you only for decisions." action=${newBtn} />` : null;
        })()}
      </section>
      <section className="hm-sec" aria-labelledby="hm-rev-h">
        <h2 id="hm-rev-h" className="hm-h">Revenue this month</h2>
        <${RevenueChart} world=${w} />
      </section>
      <section className="hm-sec" aria-labelledby="hm-act-h">
        <h2 id="hm-act-h" className="hm-h">Recent agent work</h2>
        ${facts.length ? html`<ul className="act-list">${facts.map(function (f) { return html`<${FactRow} key=${f.key} fact=${f} now=${now} showGoal=${goals.length > 1} />`; })}</ul>`
          : html`<p className="hm-quiet">Agent work shows here as it is done.</p>`}
      </section>
      </div>
      <aside className="hm-side"><${Decisions} world=${w} /></aside>
      </div>
    </section>`;
  }

  MC.goalUi = { GoalRow: GoalRow, GoalRows: GoalRows, Progress: Progress, goalFacts: goalFacts, factsOf: factsOf, FactRow: FactRow, statusOf: statusOf, liveGoals: liveGoals, AskRow: AskRow, lcFirst: lcFirst };
  MC.views.home = Home;
})();
