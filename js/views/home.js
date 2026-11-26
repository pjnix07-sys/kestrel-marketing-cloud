/* Marketing Cloud - Command Center (#home): MC.views.home.
   Leads with a one-sentence morning brief and the journey line (daily revenue, forecast, and the
   points where agents changed something), then the What changed feed, a narrow rail and live campaigns.
   Store reads go through narrow module-level selectors; feed and approvals freeze while
   the marketer is scrolled or focused inside them; nothing here reacts to a tick by moving focus. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};

  var DASH = '–', DOT = '·', MID = ' · ', LE = '≤', GE = '≥';
  var EMPTY = [];

  function html() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  /* ---------- formatting (MC.fmt when present, plain fallbacks otherwise) ---------- */
  function commas(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tryFmt(name, a, b) {
    try {
      if (MC.fmt && typeof MC.fmt[name] === 'function') { var r = MC.fmt[name](a, b); if (r != null) return String(r); }
    } catch (e) { /* fall back below */ }
    return null;
  }
  function money(n, compact) {
    if (!fin(n)) return DASH;
    return tryFmt('money', n, compact ? { compact: true } : undefined) || ((n < 0 ? '-$' : '$') + commas(n));
  }
  function num(n, compact) {
    if (!fin(n)) return DASH;
    return tryFmt('num', n, compact ? { compact: true } : undefined) || ((n < 0 ? '-' : '') + commas(n));
  }
  function pct(p, dp) {
    if (!fin(p)) return DASH;
    return tryFmt('pct', p, dp) || ((p * 100).toFixed(dp == null ? 1 : dp) + '%');
  }
  function delta(r) {
    if (!fin(r)) return DASH;
    return tryFmt('delta', r) || ((r > 0 ? '+' : '') + (r * 100).toFixed(1) + '%');
  }
  function ratio(x) {
    if (!fin(x)) return DASH;
    return tryFmt('ratio', x) || (x.toFixed(1) + '×');
  }
  // Display dates and relative times come from MC.time's display mapping (§11.1); never ticks.
  function tm(name) { return MC.time && typeof MC.time[name] === 'function' ? MC.time[name] : null; }
  function timeLabel(t) {
    if (!fin(t)) return DASH;
    var f = tm('timeLabel');
    if (f) return f(t);
    var h = ((t % 24) + 24) % 24;
    return (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' am' : ' pm');
  }
  function dayLabel(d, style) { var f = tm('dayLabel'); return f ? f(d, style ? { style: style } : undefined) : (tryFmt(style === 'short' ? 'dayShort' : 'dayLabel', d) || DASH); }
  function dayShort(d) { return dayLabel(d, 'short'); }
  function rel(from, now) {
    if (!fin(from) || !fin(now)) return '';
    var f = tm('relative');
    if (f) return f(from, now);
    return tryFmt('rel', from, now) || '';
  }
  // Formats a value of a campaign goal metric (revenue in $, everything else as a count).
  function goalFmt(type, v, compact) { return type === 'revenue' ? money(v, compact) : num(v, compact); }
  var GOAL_NOUN = { revenue: 'revenue', conversions: 'orders', reactivation: 'reactivations', engagement: 'clicks', launch: 'orders' };

  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner'
  };
  function agentName(id) {
    if (!id) return '';
    if (id === 'user') return 'You';
    try {
      var d = MC.runtime && typeof MC.runtime.def === 'function' ? MC.runtime.def(id) : null;
      if (d && d.name) return d.name;
    } catch (e) { /* fallback */ }
    return AGENT_NAMES[id] || String(id);
  }
  var CH_SHORT = { email: 'Email', sms: 'SMS', push: 'Push', social: 'Social', web: 'Web' };

  /* ---------- actions (user path only) ---------- */
  function go(route, patch) {
    try {
      if (MC.nav && typeof MC.nav.go === 'function') MC.nav.go(route, patch);
      else window.location.hash = '#' + route;
    } catch (e) { /* navigation is best effort */ }
  }
  function openApprovals() {
    try { if (MC.uiStore && typeof MC.uiStore.set === 'function') MC.uiStore.set({ drawer: 'approvals' }); } catch (e) { /* noop */ }
  }
  function dispatch(type, payload) {
    try {
      if (!MC.store || typeof MC.store.dispatch !== 'function') return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  function openCampaign(cid) { go('campaigns', { mode: 'detail', id: cid, tab: 'overview' }); }

  /* ---------- store access: stable module-level selectors ---------- */
  function call(name, w, arg) {
    var f = MC.select && MC.select[name];
    if (typeof f !== 'function' || !w) return null;
    try { return arg === undefined ? f(w) : f(w, arg); } catch (e) { return null; }
  }
  function useSel(sel, eq) {
    var H = MC.hooks || {};
    if (typeof H.useSelect === 'function') return H.useSelect(sel, eq);
    return undefined;
  }

  /* ---------- data for the brief and the journey line (one stable, JSON-safe object) ---------- */
  function jsonEq(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
  function hourOf(t) { return ((t % 24) + 24) % 24; }
  function selReady() { return true; }
  function selTick(w) { return w.meta ? w.meta.tick : 0; }
  function selTenant(w) { return (w.meta && w.meta.tenant) || 'Fernway Outfitters'; }
  function selFeed(w) { return w.feed || EMPTY; }
  function selProposals(w) { return w.proposals || null; }
  function selOpen(w) { return call('openProposals', w) || EMPTY; }
  function selRoster(w) { return call('agentRoster', w) || EMPTY; }
  function selRows(w) { return call('campaignRows', w) || EMPTY; }

  // Month goal: MC.select.goalFor when present, otherwise computed from the forecast and KPI selectors.
  function goalInfo(w, fc, kp) {
    var g = call('goalFor', w);
    if (g && typeof g === 'object' && g.status) return g;
    var tick = selTick(w), t = Math.floor(tick / 24);
    var m = (fc && fc.month) || { fromDay: t - 29, toDay: t, name: 'This month' };
    var total = m.toDay - m.fromDay + 1, elapsed = Math.max(0, t - m.fromDay);
    var target = fc && fin(fc.goal) ? fc.goal : null;
    var actual = kp && kp.revenue && fin(kp.revenue.value) ? kp.revenue.value : (fc && fc.cumulative ? fc.cumulative.actualToDate : null);
    var expected = target !== null ? target * Math.min(1, (tick / 24 - m.fromDay) / total) : null;
    var d = target !== null && fin(actual) ? actual - expected : null;
    var status = 'early';
    if (elapsed >= 7 && d !== null) status = Math.abs(d) <= 0.03 * expected ? 'on' : (d > 0 ? 'ahead' : 'behind');
    return { key: m.label, label: m.name, target: target, actual: actual, expectedByNow: expected, delta: d, status: status,
      p: status === 'early' ? null : (fc && fin(fc.p) ? fc.p : null), days: { elapsed: elapsed, total: total } };
  }

  function activityInfo(w) {
    var tick = selTick(w), applied = null;
    var a = call('agentActivity', w, { hours: 24 });
    if (a && fin(a.applied)) applied = a.applied;
    if (applied === null) {
      applied = 0;
      (w.feed || EMPTY).forEach(function (it) { if (it.kind === 'agent-applied' && tick - it.tick < 24) applied++; });
    }
    // The feed below lists the same changes, so count from both and use the larger: the sentence can never say
    // "nothing changed" while the feed shows a change from the last day.
    var fed = 0, last = null;
    (w.feed || EMPTY).forEach(function (it) {
      if (it.kind !== 'agent-applied') return;
      if (tick - it.tick < 24) fed++;
      if (last === null || it.tick > last) last = it.tick;
    });
    if (fed > applied) applied = fed;
    return { applied: applied, byAgent: (a && a.byAgent) || null, lastTick: last };
  }

  // Nodes on the journey line: recent changes one by one, older ones grouped by day.
  function buildNodes(w, raw, t) {
    var textBy = {};
    (w.feed || EMPTY).forEach(function (it) { if (it.proposalId && !textBy[it.proposalId]) textBy[it.proposalId] = it.text; });
    var groups = [], byKey = {};
    (raw || EMPTY).forEach(function (m) {
      if (m.status === 'undone') return;
      var key = m.day >= t - 1 ? 'h' + m.tick : 'd' + m.day;
      var g = byKey[key];
      if (!g) { g = byKey[key] = { id: 'home-node-' + key, tick: m.tick, count: 0 }; groups.push(g); }
      g.count++;
      g.tick = m.tick; g.pid = m.proposalId; g.agentId = m.agentId;
      g.text = textBy[m.proposalId] || m.label;
    });
    return groups;
  }

  function selBrief(w) {
    var tick = selTick(w), t = Math.floor(tick / 24);
    var fc = call('forecast', w, { month: true, metric: 'revenue' });
    var kp = call('kpis', w);
    var m = (fc && fc.month) || null;
    var from = m ? m.fromDay : t - 29;
    var raw = call('agentMarkers', w, { fromDay: from, toDay: t });
    var act = activityInfo(w);
    var open = selOpen(w);
    var k = kp || {};
    return {
      tick: tick, t: t, hour: hourOf(tick),
      month: m ? { name: m.name || m.label, fromDay: m.fromDay, toDay: m.toDay } : null,
      daysLeft: m ? Math.max(0, m.toDay - t) : null,
      goal: goalInfo(w, fc, kp),
      actual: fc ? (fc.actual || EMPTY).map(function (a) { return { day: a.day, v: a.value }; }) : EMPTY,
      points: fc ? (fc.points || EMPTY).map(function (p) { return { day: p.day, v: p.mean }; }) : EMPTY,
      nodes: buildNodes(w, raw, t),
      applied: act.applied, lastApplied: act.lastTick, byAgent: act.byAgent, needs: open.length,
      figs: {
        revenue: k.revenue ? k.revenue.value : null, goal: k.revenue ? k.revenue.goal : null,
        orders: k.conversions ? k.conversions.value : null,
        roas: k.roas ? k.roas.value : null, roasTarget: k.roas ? k.roas.target : null,
        unsub: k.unsubRate ? k.unsubRate.value : null, unsubTarget: k.unsubRate ? k.unsubRate.target : null
      }
    };
  }
  function selPacing(w) {
    var out = {};
    if (!MC.select || typeof MC.select.campaignPacing !== 'function') return out;
    selRows(w).forEach(function (r) {
      var p = call('campaignPacing', w, r.id);
      if (p && p.status) out[r.id] = { status: p.status, delta: p.delta, note: p.recoverNote || null };
    });
    return out;
  }
  function useBrief() { return useSel(selBrief, jsonEq); }

  /* ---------- kit lookups at render time, with neutral local fallbacks ---------- */
  function kit(name, fallback) { var c = MC.ui && MC.ui[name]; return typeof c === 'function' ? c : fallback; }
  function chart(name) { var c = MC.charts && MC.charts[name]; return typeof c === 'function' ? c : null; }

  function FbButton(p) {
    return html`<button type=${p.type || 'button'} className=${cx('hm-btn', 'hm-btn-' + (p.kind || 'secondary'), p.size === 'sm' && 'is-sm')}
      onClick=${p.onClick} disabled=${p.disabled} title=${p.title} aria-label=${p['aria-label']}>${p.children}</button>`;
  }
  function Btn(p) {
    var K = kit('Button', null);
    if (K && !p['aria-label']) {
      return html`<${K} kind=${p.kind || 'secondary'} size=${p.size || 'md'} onClick=${p.onClick} disabled=${p.disabled} title=${p.title} type="button">${p.children}<//>`;
    }
    return html`<${FbButton} ...${p} />`;
  }
  var TONE_CLASS = { neutral: 'is-neutral', accent: 'is-accent', agent: 'is-agent', good: 'is-good', warn: 'is-warn', crit: 'is-crit' };
  function Pill(p) {
    return html`<span className=${cx('hm-pill', TONE_CLASS[p.tone] || 'is-neutral')} title=${p.title}>${p.children}</span>`;
  }
  // Goal meter: filled actual, ghost segment up to the forecast, a goal tick.
  function Meter(p) {
    var max = fin(p.max) && p.max > 0 ? p.max : 1;
    var v = fin(p.value) ? Math.max(0, Math.min(1, p.value / max)) : 0;
    var g = fin(p.ghost) ? Math.max(0, Math.min(1, p.ghost / max)) : null;
    var goal = fin(p.goal) ? Math.max(0, Math.min(1, p.goal / max)) : null;
    return html`<span className=${cx('hm-meter', TONE_CLASS[p.tone] || 'is-accent')} role="img" aria-label=${p.label}>
      ${g !== null && g > v ? html`<span className="hm-meter-ghost" style=${{ left: (v * 100) + '%', width: ((g - v) * 100) + '%' }}></span>` : null}
      <span className="hm-meter-fill" style=${{ width: (v * 100) + '%' }}></span>
      ${goal !== null ? html`<span className="hm-meter-goal" style=${{ left: 'calc(' + (goal * 100) + '% - 1px)' }}></span>` : null}
    </span>`;
  }
  function Empty(p) {
    return html`<div className="hm-empty">
      <p className="hm-empty-title">${p.title}</p>
      ${p.body ? html`<p className="hm-empty-body">${p.body}</p>` : null}
      ${p.action || null}
    </div>`;
  }
  function NewPill(p) {
    if (!(p.count > 0)) return null;
    var K = kit('NewItemsPill', null);
    if (K) return html`<${K} count=${p.count} onClick=${p.onClick} />`;
    return html`<button type="button" className="hm-newpill" onClick=${p.onClick}>
      ${p.count + (p.count === 1 ? ' new update' : ' new updates')}</button>`;
  }
  function Panel(p) {
    var hid = p.id + '-title';
    return html`<section id=${p.id} className=${cx('hm-panel', p.className)} aria-labelledby=${hid}>
      <header className="hm-panel-head">
        <h2 id=${hid} className="hm-panel-title">${p.title}${fin(p.count) ? html` <span className="hm-count num">${p.count}</span>` : null}</h2>
        ${p.actions ? html`<div className="hm-panel-actions">${p.actions}</div>` : null}
      </header>
      <div className="hm-panel-body">${p.children}</div>
      ${p.footer ? html`<footer className="hm-panel-foot">${p.footer}</footer>` : null}
    </section>`;
  }
  /* ================= Hold-while-engaged (focus or pointer inside) ================= */
  function useHold() {
    var React = R();
    var fs = React.useState(false), focused = fs[0], setFocused = fs[1];
    var hs = React.useState(false), hovered = hs[0], setHovered = hs[1];
    return {
      held: focused || hovered,
      focused: focused,
      bind: {
        onFocus: function () { setFocused(true); },
        onBlur: function (e) { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); },
        onMouseEnter: function () { setHovered(true); },
        onMouseLeave: function () { setHovered(false); }
      }
    };
  }
  function useFrozenList(list, freeze) {
    var H = MC.hooks || {};
    if (typeof H.useFrozen === 'function') return H.useFrozen(list, { key: 'id', freeze: freeze });
    return { items: list, pending: 0, reveal: function () {} };
  }

  /* ================= Needs you ================= */
  var RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
  var RISK_TONE = { low: 'good', medium: 'warn', high: 'crit' };

  // Used only when MC.ui.ProposalCard is not available yet.
  function MiniProposal(p) {
    var React = R();
    var es = React.useState(null), err = es[0], setErr = es[1];
    var pr = p.proposal;
    var ms = React.useState(false), menu = ms[0], setMenu = ms[1];
    function act(type, payload) { var r = dispatch(type, payload); setErr(r.ok ? null : (r.error || "Couldn't update this proposal.")); }
    var Chip = kit('AgentChip', null);
    return html`<article className="hm-mini" aria-labelledby=${'home-prop-' + pr.id}>
      <div className="hm-mini-head">
        ${Chip ? html`<${Chip} agentId=${pr.agentId} />` : html`<span className="hm-agent-name">${agentName(pr.agentId)}</span>`}
        <${Pill} tone=${RISK_TONE[pr.risk] || 'neutral'}>${RISK_LABEL[pr.risk] || 'Review'}<//>
      </div>
      <h3 id=${'home-prop-' + pr.id} className="hm-mini-title">${pr.title}</h3>
      ${pr.impact && fin(pr.impact.delta) ? html`<p className="hm-note num">${'Expected ' + (pr.impact.unit === '$' ? (pr.impact.delta >= 0 ? '+' : '') + money(pr.impact.delta) : (pr.impact.delta >= 0 ? '+' : '') + num(pr.impact.delta)) +
        (fin(pr.impact.lo) && fin(pr.impact.hi) ? ' (' + (pr.impact.unit === '$' ? money(pr.impact.lo) + DASH + money(pr.impact.hi) : num(pr.impact.lo) + DASH + num(pr.impact.hi)) + ')' : '')}</p>` : null}
      <div className="hm-mini-acts">
        <${Btn} kind="primary" size="sm" onClick=${function () { act('proposal/approve', { id: pr.id }); }}>Approve<//>
        <${FbButton} kind="secondary" size="sm" onClick=${function () { setMenu(!menu); }}>Dismiss<//>
      </div>
      ${menu ? html`<div className="hm-mini-acts" role="group" aria-label="Why dismiss this proposal?">
        <${FbButton} size="sm" onClick=${function () { act('proposal/reject', { id: pr.id, reason: 'not-now' }); }}>Not now<//>
        <${FbButton} size="sm" onClick=${function () { act('proposal/reject', { id: pr.id, reason: 'wrong' }); }}>Not a good idea<//>
        <${FbButton} size="sm" onClick=${function () { act('proposal/reject', { id: pr.id, reason: 'other' }); }}>Other<//>
      </div>` : null}
      ${err ? html`<p className="hm-error" role="alert">${err}</p>` : null}
    </article>`;
  }

  /* ================= Morning brief ================= */
  function InlineLink(p) {
    return html`<button type="button" className="hm-ilink" onClick=${p.onClick} title=${p.title}>${p.children}</button>`;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function scrollToFeed() {
    var el = document.getElementById('home-changes');
    try { if (el) el.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) { /* noop */ }
  }
  function reduceMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function Brief(p) {
    var b = p.data;
    if (!b) return html`<div className="hm-brief is-skeleton" aria-busy="true"><span className="hm-skel tall w80"></span><span className="hm-skel tall w60"></span></div>`;
    var g = b.goal || {}, mon = (b.month && b.month.name) || 'This month';
    var left = b.daysLeft;
    var tail = left === null ? '' : (left === 0 ? ' and today is the last day' : ' with ' + plural(left, 'day', 'days') + ' to go');
    var toAnalytics = function () { go('analytics', { metric: 'revenue' }); };
    var s1;
    if (g.status === 'early' || !fin(g.delta)) {
      s1 = html`${mon + ' has brought in '}<${InlineLink} onClick=${toAnalytics}>${money(g.actual != null ? g.actual : b.figs.revenue, true)}</${InlineLink}>${' so far' + tail + '.'}`;
    } else if (g.status === 'on') {
      s1 = html`${mon + ' is '}<${InlineLink} onClick=${toAnalytics}>on plan</${InlineLink}>${tail + '.'}`;
    } else {
      var amt = money(Math.abs(g.delta), true);
      s1 = html`${mon + ' is '}<${InlineLink} onClick=${toAnalytics}>${amt + (g.delta < 0 ? ' behind plan' : ' ahead of plan')}</${InlineLink}>${tail + '.'}`;
    }
    var n = b.applied, need = b.needs, s2;
    var changes = n > 0 ? html`<${InlineLink} onClick=${scrollToFeed}>${plural(n, 'change', 'changes')}</${InlineLink}>` : null;
    var needs = need > 0 ? html`<${InlineLink} onClick=${openApprovals}>${need + (need === 1 ? ' needs' : ' need') + ' you' + (b.hour < 9 ? ' before 9am' : '')}</${InlineLink}>` : null;
    var lead = b.hour < 12 ? 'Overnight' : 'Since yesterday';
    if (n > 0 && need > 0) s2 = html`${lead + ', agents made '}${changes}${'; '}${needs}${'.'}`;
    else if (n > 0) s2 = html`${lead + ', agents made '}${changes}${' and nothing needs you.'}`;
    else {
      var since = fin(b.lastApplied) ? ' The latest was ' + (rel(b.lastApplied, b.tick) || timeLabel(b.lastApplied)) + '.' : '';
      if (need > 0) s2 = html`${'Agents haven’t made changes in the last day, but '}${needs}${'.' + since}`;
      else s2 = html`${'Agents haven’t made changes in the last day and nothing needs you.' + since}`;
    }
    return html`<p className="hm-brief" id="home-brief">${s1}${' '}${s2}</p>`;
  }

  /* ================= Journey line ================= */
  function useBoxWidth(ref, initial) {
    var React = R();
    var s = React.useState(initial), w = s[0], setW = s[1];
    React.useEffect(function () {
      var el = ref.current;
      if (!el) return undefined;
      function measure() { var cw = el.clientWidth; if (cw > 0) setW(cw); }
      measure();
      var ro = null;
      if (typeof window.ResizeObserver === 'function') { ro = new window.ResizeObserver(measure); ro.observe(el); }
      else window.addEventListener('resize', measure);
      return function () { if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); };
    }, []);
    return w;
  }

  function Journey(p) {
    var React = R();
    var b = p.data;
    var wrap = React.useRef(null);
    var width = useBoxWidth(wrap, 720);
    var hs = React.useState(-1), hov = hs[0], setHov = hs[1];
    var as = React.useState(0), active = as[0], setActive = as[1];
    var refs = React.useRef([]);

    var actual = (b && b.actual) || EMPTY, points = (b && b.points) || EMPTY;
    var hasLine = !!b && b.month && actual.length > 0;
    var summary = '';
    if (!hasLine) {
      return html`<div className="hm-journey" ref=${wrap}>
        <p className="hm-note">${b ? 'The revenue line appears once a full day of results is in.' : 'Loading the revenue line…'}</p>
      </div>`;
    }
    var H = width < 560 ? 112 : 148, L = 6, Rr = 6, T = 14, B = 24;
    var from = b.month.fromDay, span = b.month.toDay + 1 - from;
    var iw = Math.max(40, width - L - Rr), ih = H - T - B;
    var ymax = 1;
    actual.forEach(function (a) { if (a.v > ymax) ymax = a.v; });
    points.forEach(function (a) { if (a.v > ymax) ymax = a.v; });
    ymax *= 1.1;
    function X(d) { return L + ((d - from) / span) * iw; }
    function Y(v) { return T + (1 - Math.max(0, v) / ymax) * ih; }
    var all = actual.map(function (a) { return { x: a.day + 0.5, v: a.v }; });
    var fcStart = all.length - 1;
    points.forEach(function (a) { all.push({ x: a.day + 0.5, v: a.v }); });
    function yAt(xd) {
      if (xd <= all[0].x) return Y(all[0].v);
      for (var i = 1; i < all.length; i++) {
        if (xd <= all[i].x) { var q = (xd - all[i - 1].x) / (all[i].x - all[i - 1].x); return Y(all[i - 1].v + q * (all[i].v - all[i - 1].v)); }
      }
      return Y(all[all.length - 1].v);
    }
    function path(arr) { return arr.map(function (a, i) { return (i ? 'L' : 'M') + X(a.x).toFixed(1) + ' ' + Y(a.v).toFixed(1); }).join(' '); }
    var dPast = path(all.slice(0, fcStart + 1));
    var dFuture = all.length > fcStart + 1 ? path(all.slice(fcStart)) : '';
    var nowX = X(b.tick / 24);
    var nodes = (b.nodes || EMPTY).map(function (n) {
      return { n: n, x: X(n.tick / 24), y: yAt(n.tick / 24) };
    });
    var act = Math.min(active, Math.max(0, nodes.length - 1));
    function tipText(n) {
      return n.text + ', ' + (rel(n.tick, b.tick) || timeLabel(n.tick)) + (n.count > 1 ? ' (and ' + (n.count - 1) + ' more ' + (Math.floor(n.tick / 24) >= b.t - 1 ? 'in the same hour' : 'that day') + ')' : '');
    }
    function pick(n) { if (p.onPick) p.onPick(n); }
    function focusNode(i) {
      var k = Math.max(0, Math.min(nodes.length - 1, i)), el = refs.current[k];
      if (el && typeof el.focus === 'function') el.focus();
    }
    function onKey(e, i, n) {
      var key = e.key;
      if (key === 'Enter' || key === ' ') { e.preventDefault(); pick(n); }
      else if (key === 'ArrowRight' || key === 'ArrowDown') { e.preventDefault(); focusNode(i + 1); }
      else if (key === 'ArrowLeft' || key === 'ArrowUp') { e.preventDefault(); focusNode(i - 1); }
      else if (key === 'Home') { e.preventDefault(); focusNode(0); }
      else if (key === 'End') { e.preventDefault(); focusNode(nodes.length - 1); }
      else if (key === 'Escape') setHov(-1);
    }
    var tip = hov >= 0 && nodes[hov] ? nodes[hov] : null;
    var tipLeft = tip ? Math.max(130, Math.min(width - 130, tip.x)) : 0;
    var lastV = actual[actual.length - 1].v;
    summary = 'Daily revenue for ' + b.month.name + ' so far, with the forecast to month end. ' +
      (nodes.length ? nodes.length + ' marked points where agents changed something; use the arrow keys to move between them and Enter to see the change below.' : 'Agents have not changed anything this month.');
    return html`<div className="hm-journey" ref=${wrap}>
      <svg className="hm-j-svg" width=${width} height=${H} viewBox=${'0 0 ' + width + ' ' + H} role="group" aria-label=${summary}>
        <line className="hm-j-base" x1=${L} x2=${width - Rr} y1=${H - B} y2=${H - B} />
        <line className="hm-j-now" x1=${nowX} x2=${nowX} y1=${T - 4} y2=${H - B} />
        <path className="hm-j-future" d=${dFuture} fill="none" />
        <path className="hm-j-past" d=${dPast} fill="none" pathLength="1" />
        <text className="hm-j-label" x=${L} y=${H - 6} textAnchor="start">${dayShort(from)}</text>
        ${width - nowX > 72 ? html`<text className="hm-j-label" x=${Math.max(28, nowX)} y=${H - 6} textAnchor="middle">Now</text>` : null}
        <text className="hm-j-label" x=${width - Rr} y=${H - 6} textAnchor="end">${dayShort(b.month.toDay)}</text>
        ${nodes.map(function (o, i) {
          return html`<g key=${o.n.id} className="hm-node" tabIndex=${i === act ? 0 : -1} role="button" ref=${function (el) { refs.current[i] = el; }}
              aria-label=${tipText(o.n) + '. Show in What changed.'} style=${{ animationDelay: (500 + i * 18) + 'ms' }}
              onClick=${function () { pick(o.n); }} onKeyDown=${function (e) { onKey(e, i, o.n); }}
              onMouseEnter=${function () { setHov(i); }} onMouseLeave=${function () { setHov(-1); }}
              onFocus=${function () { setHov(i); setActive(i); }} onBlur=${function () { setHov(-1); }}>
            <circle className="hm-node-hit" cx=${o.x} cy=${o.y} r="13" />
            <circle className="hm-node-ring" cx=${o.x} cy=${o.y} r="9" />
            <circle className="hm-node-dot" cx=${o.x} cy=${o.y} r=${o.n.count > 1 ? 5 : 4} />
          </g>`;
        })}
      </svg>
      ${tip ? html`<div className="hm-j-tip" style=${{ left: tipLeft + 'px', top: (tip.y + 16) + 'px' }} aria-hidden="true">
        <span className="hm-j-tip-text">${tipText(tip.n)}</span>
        <span className="hm-j-tip-hint">Select to see it in What changed</span>
      </div>` : null}
      <span className="hm-sr" role="status">${hov >= 0 && nodes[hov] ? tipText(nodes[hov].n) : ''}</span>
    </div>`;
  }

  // Four quiet figures under the line (plain text, no tiles or status colours).
  function Figures(p) {
    var f = p.data && p.data.figs;
    if (!f) return null;
    var items = [
      { id: 'revenue', label: 'Revenue this month', value: money(f.revenue, true), note: fin(f.goal) ? 'of ' + money(f.goal, true) + ' plan' : '', metric: 'revenue' },
      { id: 'orders', label: 'Orders', value: num(f.orders), note: '', metric: 'conversions' },
      { id: 'roas', label: 'Return on spend', value: fin(f.roas) ? ratio(f.roas) : DASH, note: fin(f.roasTarget) ? 'target ' + ratio(f.roasTarget) : '', metric: 'roas' },
      { id: 'unsub', label: 'Unsubscribe rate', value: pct(f.unsub, 2), note: fin(f.unsubTarget) ? 'limit ' + pct(f.unsubTarget, 2) : '', metric: 'unsubRate' }
    ];
    return html`<dl className="hm-figs" aria-label="Month to date">
      ${items.map(function (it) {
        return html`<div key=${it.id} className="hm-fig">
          <dt>${it.label}</dt>
          <dd className="num"><button type="button" className="hm-fig-btn" onClick=${function () { go('analytics', { metric: it.metric }); }}
              aria-label=${it.label + ': ' + it.value + (it.note ? ', ' + it.note : '') + '. Open in Analytics.'}>${it.value}</button>${it.note ? html`<span className="hm-fig-note">${it.note}</span>` : null}</dd>
        </div>`;
      })}
    </dl>`;
  }


  function NeedsYou() {
    var open = useSel(selOpen) || EMPTY;
    var hold = useHold();
    var frozen = useFrozenList(open, hold.held);
    var shown = frozen.items.slice(0, 3);
    var PC = kit('ProposalCard', null);
    var total = open.length;
    if (total === 0 && frozen.items.length === 0) {
      return html`<section id="home-needs" className="hm-needs-line" aria-labelledby="home-needs-title">
        <h2 id="home-needs-title" className="hm-panel-title">Needs you</h2>
        <span className="hm-needs-none">Nothing right now.</span>
        <${Btn} kind="ghost" size="sm" onClick=${openApprovals}>Open Approvals<//>
      </section>`;
    }
    var footer = html`<${Btn} kind="ghost" size="sm" onClick=${openApprovals}>${total > shown.length ? 'See all ' + total + ' in Approvals' : 'Open Approvals'}<//>`;
    return html`<${Panel} id="home-needs" className="hm-area-needs" title="Needs you" count=${total} footer=${footer}
        actions=${frozen.pending > 0 ? html`<${NewPill} count=${frozen.pending} onClick=${frozen.reveal} />` : null}>
      <div className="hm-needs-list" ...${hold.bind}>
        ${shown.map(function (pr) {
          return html`<div key=${pr.id} className="hm-needs-item is-flat">
            ${PC ? html`<${PC} id=${pr.id} compact=${true} flat=${true} showTarget=${true} />` : html`<${MiniProposal} proposal=${pr} />`}
          </div>`;
        })}
      </div>
    <//>`;
  }

  /* ================= What changed ================= */
  var FILTERS = [
    { id: 'all', label: 'All', kinds: null },
    { id: 'agents', label: 'Agents', kinds: ['agent-applied', 'agent-proposed'] },
    { id: 'anomalies', label: 'Anomalies', kinds: ['anomaly', 'insight'] },
    { id: 'campaigns', label: 'Campaigns', kinds: ['campaign'] },
    { id: 'yours', label: 'Yours', kinds: ['user', 'approved', 'rejected', 'undone'] }
  ];
  var USER_KINDS = { user: 1, approved: 1, rejected: 1, undone: 1 };
  var PAGE = 30;

  // Where "View" goes for a feed item; resolved at click time from the live world.
  function feedTarget(it) {
    var w = MC.store && typeof MC.store.getState === 'function' ? MC.store.getState() : null;
    if (!w) return null;
    var cid = null;
    if (it.proposalId && w.proposals && w.proposals.byId[it.proposalId]) {
      try { cid = MC.select && MC.select.targetCampaignId ? MC.select.targetCampaignId(w, w.proposals.byId[it.proposalId]) : null; } catch (e) { cid = null; }
    }
    var en = it.entity;
    if (!cid && en) {
      if (en.kind === 'campaign' && w.campaigns.byId[en.id]) cid = en.id;
      else if (en.kind === 'variant' && w.variants.byId[en.id]) return { route: 'content', patch: { variantId: en.id } };
      else if (en.kind === 'segment' && w.segments && w.segments.byId[en.id]) return { route: 'audiences', patch: { tab: 'segments', segmentId: en.id } };
    }
    if (cid) return { route: 'campaigns', patch: { mode: 'detail', id: cid, tab: 'overview' } };
    if (it.kind === 'anomaly' || it.kind === 'insight') return { route: 'analytics', patch: { metric: 'revenue' } };
    if (it.agentId) return { route: 'agents', patch: { tab: 'roster', agentId: it.agentId } };
    return null;
  }
  function hasTarget(it) {
    return !!(it.proposalId || it.entity || it.kind === 'anomaly' || it.kind === 'insight' || it.agentId);
  }


  function FeedRow(p) {
    var it = p.item, pr = p.proposal;
    var Chip = kit('AgentChip', null);
    var actor;
    if (it.agentId) actor = Chip ? html`<${Chip} agentId=${it.agentId} />` : html`<span className="hm-agent-name">${agentName(it.agentId)}</span>`;
    else if (USER_KINDS[it.kind]) actor = Chip ? html`<${Chip} agentId="user" />` : html`<span className="hm-agent-name">You</span>`;
    else if (it.kind === 'anomaly' || it.kind === 'insight') actor = html`<span className=${cx('hm-actor', it.tone === 'crit' ? 'is-crit' : 'is-warn')}>${it.kind === 'anomaly' ? 'Anomaly' : 'Insight'}</span>`;
    else actor = html`<span className="hm-actor">Campaign</span>`;
    var canUndo = pr && (pr.status === 'applied' || pr.status === 'auto') && (it.kind === 'agent-applied' || it.kind === 'approved');
    var undone = pr && pr.status === 'undone' && (it.kind === 'agent-applied' || it.kind === 'approved');
    return html`<li className=${cx('hm-feed-row', it.tone && 'tone-' + it.tone, p.hot && 'is-hot')} data-pid=${it.proposalId || null} tabIndex="-1">
      <span className="hm-feed-time num" title=${dayShort(Math.floor(it.tick / 24)) + ', ' + timeLabel(it.tick)}>${p.today ? rel(it.tick, p.now) : timeLabel(it.tick)}</span>
      <span className="hm-feed-actor">${actor}</span>
      <span className="hm-feed-text">${it.text}</span>
      <span className="hm-feed-acts">
        ${canUndo ? html`<button type="button" className="hm-link" onClick=${function () { p.onUndo(it); }}
            aria-label=${'Undo: ' + (pr.title || it.text)}>Undo</button>` : null}
        ${undone ? html`<span className="hm-feed-done">Undone</span>` : null}
        ${hasTarget(it) ? html`<button type="button" className="hm-link" onClick=${function () { var t = feedTarget(it); if (t) go(t.route, t.patch); }}
            aria-label=${'View: ' + it.text}>View</button>` : null}
      </span>
      ${p.error ? html`<span className="hm-feed-err" role="alert">${p.error}</span>` : null}
    </li>`;
  }

  var lastFocusHandled = 0;

  function FeedList(p) {
    var React = R();
    var feed = useSel(selFeed) || EMPTY;
    var proposals = useSel(selProposals);
    var tick = useSel(selTick) || 0;
    var kinds = p.filter.kinds;
    var list = React.useMemo(function () {
      return kinds ? feed.filter(function (it) { return kinds.indexOf(it.kind) >= 0; }) : feed;
    }, [feed, kinds]);
    var ss = React.useState(false), scrolled = ss[0], setScrolled = ss[1];
    var hold = useHold();
    var frozen = useFrozenList(list, scrolled || hold.focused);
    var ls = React.useState(PAGE), limit = ls[0], setLimit = ls[1];
    var es = React.useState({}), errs = es[0], setErrs = es[1];
    var hs = React.useState(null), hot = hs[0], setHot = hs[1];
    var boxRef = React.useRef(null);

    // A click on a journey-line node: reveal that entry, scroll to it and mark it for a moment.
    var req = p.focus;
    React.useEffect(function () {
      if (!req || !req.n || req.n === lastFocusHandled) return undefined;
      lastFocusHandled = req.n;
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].proposalId === req.pid) { idx = i; break; }
      if (idx < 0) { scrollToFeed(); return undefined; }
      frozen.reveal();
      setScrolled(false);
      if (idx >= limit) setLimit(idx + 8);
      setHot(req.pid);
      var t1 = setTimeout(function () {
        var box = boxRef.current, el = box && box.querySelector('[data-pid="' + req.pid + '"]');
        if (!el) return;
        try { el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); } catch (e) { /* noop */ }
        try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ }
      }, 60);
      var t2 = setTimeout(function () { setHot(null); }, 3200);
      return function () { clearTimeout(t1); clearTimeout(t2); };
    }, [req && req.n]);

    function onScroll(e) { var top = e.currentTarget.scrollTop > 4; if (top !== scrolled) setScrolled(top); }
    function reveal() {
      frozen.reveal();
      try { if (boxRef.current) boxRef.current.scrollTop = 0; } catch (e) { /* noop */ }
      setScrolled(false);
    }
    function onUndo(it) {
      var r = dispatch('proposal/undo', { id: it.proposalId });
      setErrs(function (m) { var n = Object.assign({}, m); n[it.id] = r.ok ? null : (r.error || "Couldn't undo this change."); return n; });
    }

    var items = frozen.items.slice(0, limit);
    var today = Math.floor(tick / 24);
    var groups = [], cur = null;
    items.forEach(function (it) {
      var d = Math.floor(it.tick / 24);
      if (!cur || cur.day !== d) { cur = { day: d, items: [] }; groups.push(cur); }
      cur.items.push(it);
    });
    function heading(d) { var f = tm('relativeDay'); return f ? f(d, today) : (d === today ? 'Today' : (d === today - 1 ? 'Yesterday' : dayLabel(d))); }

    var body;
    if (!feed.length) body = html`<${Empty} title="Nothing yet. Agent changes and campaign updates will appear here." />`;
    else if (!items.length) body = html`<${Empty} title="Nothing in this filter yet." body="Switch to All to see every update." />`;
    else body = groups.map(function (g) {
      var hid = 'home-feed-day-' + (g.day < 0 ? 'm' + (-g.day) : g.day) + '-' + p.filter.id;
      return html`<div key=${'g' + g.day} className="hm-feed-group" role="group" aria-labelledby=${hid}>
        <h3 id=${hid} className="hm-feed-day">${heading(g.day)}</h3>
        <ul className="hm-feed-list">
          ${g.items.map(function (it) {
            var pr = it.proposalId && proposals && proposals.byId ? proposals.byId[it.proposalId] : null;
            return html`<${FeedRow} key=${it.id} item=${it} proposal=${pr} onUndo=${onUndo} error=${errs[it.id]} today=${g.day === today} now=${tick}
                hot=${!!hot && it.proposalId === hot} />`;
          })}
        </ul>
      </div>`;
    });

    return html`<div className="hm-feed-wrap">
      ${frozen.pending > 0 ? html`<div className="hm-feed-pill"><${NewPill} count=${frozen.pending} onClick=${reveal} /></div>` : null}
      <div id="home-feed-list" className="hm-feed-scroll" ref=${boxRef} tabIndex="0" aria-label="Recent updates" onScroll=${onScroll} ...${hold.bind}>
        ${body}
        ${frozen.items.length > limit ? html`<div className="hm-more"><${Btn} kind="ghost" size="sm" onClick=${function () { setLimit(limit + PAGE); }}>Show older updates<//></div>` : null}
      </div>
    </div>`;
  }

  function WhatChanged(p) {
    var React = R();
    var fs = React.useState('all'), fid = fs[0], setFid = fs[1];
    var req = p.focus;
    React.useEffect(function () { if (req && req.n) setFid('all'); }, [req && req.n]);
    var filter = FILTERS.filter(function (f) { return f.id === fid; })[0] || FILTERS[0];
    var filters = html`<div className="hm-filters" role="group" aria-label="Show">
      ${FILTERS.map(function (f) {
        return html`<button key=${f.id} id=${'home-feed-filter-' + f.id} type="button" className=${cx('hm-filter', f.id === fid && 'is-on')}
          aria-pressed=${f.id === fid ? 'true' : 'false'} onClick=${function () { setFid(f.id); }}>${f.label}</button>`;
      })}
    </div>`;
    return html`<${Panel} id="home-changes" className="hm-area-feed" title="What changed" actions=${filters}>
      <${FeedList} key=${filter.id} filter=${filter} focus=${req} />
    <//>`;
  }

  /* ================= Agents that acted or need you ================= */
  function Dot(p) {
    var K = kit('StatusDot', null);
    if (K) return html`<${K} state=${p.state} pulse=${p.pulse} />`;
    return html`<span className=${cx('hm-dot', 'is-' + p.state, p.pulse && 'is-pulse')} aria-hidden="true"></span>`;
  }

  function AgentsRail(p) {
    var roster = useSel(selRoster) || EMPTY;
    var by = p.byAgent || null;
    var busy = roster.map(function (a) {
      var ch = by && by[a.id] && fin(by[a.id].applied) ? by[a.id].applied : (fin(a.changes24h) ? a.changes24h : 0);
      return { a: a, changes: ch, pending: a.pending || 0 };
    }).filter(function (x) { return x.changes > 0 || x.pending > 0; });
    var rest = roster.length - busy.length;
    var footer = html`<${Btn} kind="ghost" size="sm" onClick=${function () { go('agents', { tab: 'roster' }); }}>${rest > 0 && busy.length ? 'All agents (' + rest + ' quiet today)' : 'All agents'}<//>`;
    return html`<${Panel} id="home-agents" className="hm-area-agents" title="Agents today" footer=${footer}>
      ${busy.length ? html`<ul className="hm-agents">
        ${busy.map(function (x) {
          var a = x.a, name = a.name || agentName(a.id);
          var bits = [];
          if (x.changes > 0) bits.push(plural(x.changes, 'change', 'changes') + ' in the last day');
          if (x.pending > 0) bits.push(x.pending + ' waiting for you');
          return html`<li key=${a.id}>
            <button type="button" id=${'home-agent-' + a.id} className="hm-agent" onClick=${function () { go('agents', { tab: 'roster', agentId: a.id }); }}
                aria-label=${name + ', ' + bits.join(', ')}>
              <span className="hm-agent-main"><${Dot} state=${a.status} pulse=${a.ranThisTick} /><span className="hm-agent-name">${name}</span></span>
              <span className=${cx('hm-agent-meta num', x.pending > 0 && 'has-pending')}>${bits.join(MID)}</span>
            </button>
          </li>`;
        })}
      </ul>` : html`<p className="hm-note">No agent has changed anything in the last day.</p>`}
    <//>`;
  }

  /* ================= Live campaigns ================= */
  function outlook(g, pace) {
    if (pace) {
      if (pace.status === 'early') return { text: 'Too early to tell', tone: 'neutral', title: 'Pacing starts after a week of results' };
      if (pace.status === 'ahead') return { text: 'Ahead', tone: 'good', title: pace.note || undefined };
      if (pace.status === 'on') return { text: 'On pace', tone: 'neutral', title: pace.note || undefined };
      if (pace.status === 'behind') return { text: 'Behind', tone: 'warn', title: pace.note || undefined };
    }
    if (!g || !fin(g.p) || !fin(g.outlookPct)) return { text: 'Too early to tell', tone: 'neutral' };
    var pc = Math.round(g.outlookPct * 100) + '%';
    if (g.p >= 0.7) return { text: 'Likely ' + pc, tone: 'good' };
    if (g.p >= 0.4) return { text: 'At risk ' + pc, tone: 'warn' };
    return { text: 'Unlikely ' + pc, tone: 'warn' };
  }

  function LiveCampaigns() {
    var all = useSel(selRows) || EMPTY;
    var pacing = useSel(selPacing, jsonEq) || {};
    var rows = all.filter(function (r) { return r.status === 'live' || r.status === 'paused'; });
    var planBtn = html`<${Btn} kind="secondary" size="sm" onClick=${function () { go('campaigns', { mode: 'planner' }); }}>Plan a campaign<//>`;
    return html`<${Panel} id="home-live" className="hm-area-live" title="Live campaigns" count=${rows.length}
        actions=${html`<${Btn} kind="ghost" size="sm" onClick=${function () { go('campaigns', { mode: 'board' }); }}>All campaigns<//>`}>
      ${rows.length ? html`<div className="hm-scroll">
        <table className="hm-table">
          <caption className="hm-sr">Live and paused campaigns. Select a campaign to open it.</caption>
          <thead><tr>
            <th scope="col">Campaign</th>
            <th scope="col">Channels</th>
            <th scope="col">Spend / budget</th>
            <th scope="col">Goal progress</th>
            <th scope="col">Pacing</th>
            <th scope="col" className="is-num">Agent changes, 24h</th>
          </tr></thead>
          <tbody>
            ${rows.map(function (r) {
              var g = r.goal || {}, o = outlook(g, pacing[r.id]);
              var spendShare = fin(r.budget) && r.budget > 0 ? r.spend / r.budget : null;
              return html`<tr key=${r.id} className="hm-row" onClick=${function () { openCampaign(r.id); }}>
                <th scope="row">
                  <button type="button" id=${'home-live-' + r.id} className="hm-row-link" onClick=${function (e) { e.stopPropagation(); openCampaign(r.id); }}>${r.name}</button>
                  ${r.status === 'paused' ? html`<span className="hm-row-state">Paused</span>` : null}
                </th>
                <td className="hm-chans" data-label="Channels">${(r.channels || EMPTY).map(function (ch) { return CH_SHORT[ch] || ch; }).join(', ')}</td>
                <td data-label="Spend">
                  <span className="hm-cell-stack num">
                    <span>${money(r.spend, true) + ' / ' + money(r.budget, true)}</span>
                    <${Meter} value=${r.spend} max=${fin(r.budget) && r.budget > 0 ? r.budget : 1} tone=${spendShare !== null && spendShare > 1 ? 'warn' : 'accent'}
                      label=${money(r.spend) + ' spent of ' + money(r.budget) + ' budget'} />
                  </span>
                </td>
                <td className="num" data-label="Goal">${goalFmt(g.type, g.value, true) + ' of ' + goalFmt(g.type, g.target, true) + ' ' + (GOAL_NOUN[g.type] || '')}</td>
                <td data-label="Pacing"><${Pill} tone=${o.tone} title=${o.title}>${o.text}<//></td>
                <td className="is-num num" data-label="Agent changes">${r.agentChanges24h > 0 ? html`<span className="hm-agent-count" title="Changes made by agents in the last 24 hours">${r.agentChanges24h}</span>` : html`<span className="hm-muted">0</span>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>` : html`<${Empty} title="Nothing is live right now. Plan a campaign or schedule a draft." action=${planBtn} />`}
    <//>`;
  }

  /* ================= View ================= */
  function Home() {
    var React = R();
    var tenant = useSel(selTenant) || 'Fernway Outfitters';
    var brief = useBrief();
    var fs = React.useState(null), focus = fs[0], setFocus = fs[1];
    var seq = React.useRef(0);
    var today = brief && fin(brief.t) ? dayLabel(brief.t, 'long') : null;
    function pick(n) {
      seq.current += 1;
      setFocus({ pid: n.pid, n: seq.current });
      scrollToFeed();
    }

    return html`<section className="v-home">
      <header className="hm-head">
        <div className="hm-head-text">
          <p className="hm-date">${today ? today + MID + tenant : tenant}</p>
          <h1 id="page-title" tabIndex="-1">Command Center</h1>
        </div>
        <div className="hm-head-actions">
          <${Btn} kind="primary" onClick=${function () { go('campaigns', { mode: 'planner' }); }}>Plan a campaign<//>
        </div>
      </header>
      <section className="hm-hero" aria-label="Morning brief">
        <${Brief} data=${brief} />
        <div className="hm-journey-block">
          <p className="hm-j-caption">Daily revenue, the forecast to month end, and where agents made changes</p>
          <${Journey} data=${brief} onPick=${pick} />
        </div>
        <${Figures} data=${brief} />
      </section>
      <div className="hm-grid">
        <${NeedsYou} />
        <${WhatChanged} focus=${focus} />
        <${AgentsRail} byAgent=${brief ? brief.byAgent : null} />
        <${LiveCampaigns} />
      </div>
    </section>`;
  }

  /* Memoise the cards: selector outputs are stable between ticks, so a tick that changes nothing here re-renders nothing. */
  (function () {
    var memo = window.React && window.React.memo;
    if (typeof memo !== 'function') return;
    Brief = memo(Brief);
    Journey = memo(Journey);
    Figures = memo(Figures);
    LiveCampaigns = memo(LiveCampaigns);
    AgentsRail = memo(AgentsRail);
    NeedsYou = memo(NeedsYou);
    FeedRow = memo(FeedRow, function (a, b) {
      return a.item === b.item && a.proposal === b.proposal && a.error === b.error && a.hot === b.hot &&
        a.today === b.today && (!a.today || a.now === b.now);
    });
  })();

  MC.views.home = Home;
})();
