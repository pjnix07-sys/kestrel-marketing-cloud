/* Marketing Cloud - Command Center (#home): MC.views.home.
   Answers three questions on one screen: how are we doing (KPIs vs goals, forecast),
   what changed (feed, movers) and what needs me (approvals, agent pulse).
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
  function selReady() { return true; }
  function selTenant(w) { return (w.meta && w.meta.tenant) || 'Fernway Outfitters'; }
  function selTick(w) { return w.meta ? w.meta.tick : 0; }
  function selKpis(w) { return call('kpis', w); }
  function selForecast(w) { return call('forecast', w, { month: true, metric: 'revenue' }); }
  function selMarkers(w) {
    var t = selTick(w), d = Math.floor(t / 24), from = d - 29;
    try { if (MC.time && typeof MC.time.monthOf === 'function') from = MC.time.monthOf(d).fromDay; } catch (e) { /* keep 30d */ }
    return call('agentMarkers', w, { fromDay: from, toDay: d });
  }
  function selMovers(w) { return call('movers', w); }
  function selOpen(w) { return call('openProposals', w) || EMPTY; }
  function selFeed(w) { return w.feed || EMPTY; }
  function selProposals(w) { return w.proposals || null; }
  function selCampaigns(w) { return w.campaigns || null; }
  function selVariants(w) { return w.variants || null; }
  function selRoster(w) { return call('agentRoster', w) || EMPTY; }
  function selRows(w) { return call('campaignRows', w) || EMPTY; }
  // True when an agent changed something during the current tick (drives the russet underline).
  function selAgentNow(w) {
    var t = selTick(w), f = w.feed || EMPTY;
    for (var i = 0; i < f.length && i < 40; i++) {
      if (f[i].tick !== t) break;
      if (f[i].kind === 'agent-applied') return true;
    }
    return false;
  }

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
  function Spark(p) {
    var S = chart('Sparkline');
    if (!S) return null;
    return html`<${S} values=${p.values || EMPTY} width=${p.width || 96} height=${p.height || 24} color=${p.color || 'chart-1'} area=${true} ariaLabel=${p.ariaLabel} />`;
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

  /* ================= KPI strip ================= */
  var STATUS = {
    on: { label: 'On track', tone: 'good' },
    risk: { label: 'At risk', tone: 'warn' },
    off: { label: 'Off track', tone: 'crit' }
  };

  // Brief underline when the displayed value changes (russet when an agent caused the tick's change).
  function useFlash(value, agentNow) {
    var React = R();
    var prev = React.useRef(value);
    var seq = React.useRef(0);
    var st = React.useState(null), flash = st[0], setFlash = st[1];
    React.useEffect(function () {
      var before = prev.current;
      prev.current = value;
      if (before === value || before === undefined || before === null) return undefined;
      seq.current += 1;
      setFlash({ n: seq.current, agent: !!agentNow });
      var timer = setTimeout(function () { setFlash(null); }, 1200);
      return function () { clearTimeout(timer); };
    }, [value]);
    return flash;
  }

  function KpiTile(p) {
    var flash = useFlash(p.valueText, p.agentNow);
    var status = STATUS[p.status] || null;
    var aria = p.label + ': ' + p.valueText + (p.subText ? ', ' + p.subText : '') + (status ? ', ' + status.label : '') +
      (p.deltaText ? ', ' + p.deltaText : '') + '. Open in Analytics.';
    return html`<button type="button" id=${p.id} className=${cx('hm-kpi', status && 'is-' + p.status)} onClick=${p.onClick} aria-label=${aria}>
      <span className="hm-kpi-top">
        <span className="hm-kpi-label">${p.label}</span>
        ${status ? html`<${Pill} tone=${status.tone}>${status.label}<//>` : null}
      </span>
      <span className="hm-kpi-value num">
        ${p.valueText}
        ${flash ? html`<span key=${'f' + flash.n} className=${cx('hm-flash', flash.agent && 'is-agent')} aria-hidden="true"></span>` : null}
      </span>
      <span className="hm-kpi-sub num">${p.subText}</span>
      ${p.meter ? html`<${Meter} ...${p.meter} />` : null}
      <span className="hm-kpi-foot">
        <span className=${cx('hm-delta num', p.deltaTone && 'is-' + p.deltaTone)}>${p.deltaText || 'Not enough history yet'}</span>
        <span className="hm-kpi-spark"><${Spark} values=${p.spark} ariaLabel=${p.label + ', last 14 days'} color=${p.sparkColor} /></span>
      </span>
    </button>`;
  }

  function deltaBits(d, invert) {
    if (!fin(d)) return { text: null, tone: null };
    var up = d > 0.0005, down = d < -0.0005;
    var tone = !up && !down ? null : ((up !== !!invert) ? 'good' : 'crit');
    return { text: delta(d) + ' vs prior 7 days', tone: tone };
  }
  function tileMax() {
    var m = 0;
    for (var i = 0; i < arguments.length; i++) if (fin(arguments[i]) && arguments[i] > m) m = arguments[i];
    return m > 0 ? m * 1.06 : 1;
  }

  function KpiStrip(p) {
    var k = p.kpis;
    if (!k) return html`<div className="hm-kpis" aria-busy="true">${[0, 1, 2, 3].map(function (i) {
      return html`<div key=${'sk' + i} className="hm-kpi is-skeleton" aria-hidden="true"><span className="hm-skel w40"></span><span className="hm-skel w60 tall"></span><span className="hm-skel w80"></span></div>`;
    })}</div>`;
    var mon = (k.month && k.month.label) || '';
    var rv = k.revenue || {}, cv = k.conversions || {}, ro = k.roas || {}, un = k.unsubRate || {};
    var rProj = rv.projected || {}, cProj = cv.projected || {};
    var rd = deltaBits(rv.delta7), cd = deltaBits(cv.delta7), od = deltaBits(ro.delta7), ud = deltaBits(un.delta7, true);
    var agentNow = p.agentNow;
    var tiles = [
      {
        id: 'home-kpi-revenue', label: 'Revenue' + MID + mon, valueText: money(rv.value, true),
        subText: fin(rv.goal) ? 'of ' + money(rv.goal, true) + ' goal' : 'No monthly goal set',
        meter: { value: rv.value, ghost: rProj.mean, goal: rv.goal, max: tileMax(rv.goal, rProj.mean, rv.value), tone: (STATUS[rv.status] || STATUS.on).tone === 'good' ? 'accent' : STATUS[rv.status].tone,
          label: money(rv.value, true) + ' so far, forecast ' + money(rProj.mean, true) + ' by month end, goal ' + money(rv.goal, true) },
        status: rv.status, deltaText: rd.text, deltaTone: rd.tone, spark: rv.spark14, sparkColor: 'chart-1', metric: 'revenue'
      },
      {
        id: 'home-kpi-conversions', label: 'Conversions' + MID + mon, valueText: num(cv.value),
        subText: fin(cv.goal) ? 'of ' + num(cv.goal) + ' goal' : 'No monthly goal set',
        meter: { value: cv.value, ghost: cProj.mean, goal: cv.goal, max: tileMax(cv.goal, cProj.mean, cv.value), tone: (STATUS[cv.status] || STATUS.on).tone === 'good' ? 'accent' : STATUS[cv.status].tone,
          label: num(cv.value) + ' orders so far, forecast ' + num(cProj.mean) + ' by month end, goal ' + num(cv.goal) },
        status: cv.status, deltaText: cd.text, deltaTone: cd.tone, spark: cv.spark14, sparkColor: 'chart-2', metric: 'conversions'
      },
      {
        id: 'home-kpi-roas', label: 'Return on spend', valueText: fin(ro.value) ? ratio(ro.value) : DASH,
        subText: fin(ro.value) ? 'Target ' + GE + ' ' + ratio(ro.target) : 'No paid spend yet this month',
        meter: fin(ro.value) ? { value: ro.value, goal: ro.target, max: tileMax(ro.target * 1.5, ro.value), tone: (STATUS[ro.status] || STATUS.on).tone === 'good' ? 'accent' : STATUS[ro.status].tone,
          label: ratio(ro.value) + ' return on spend, target ' + ratio(ro.target) } : null,
        status: fin(ro.value) ? ro.status : null, deltaText: od.text, deltaTone: od.tone, spark: ro.spark14, sparkColor: 'chart-3', metric: 'roas'
      },
      {
        id: 'home-kpi-unsub', label: 'Unsubscribe rate', valueText: pct(un.value, 2),
        subText: 'Target ' + LE + ' ' + pct(un.target, 2),
        meter: { value: un.value, goal: un.target, max: tileMax(un.target * 2, un.value), tone: (STATUS[un.status] || STATUS.on).tone === 'good' ? 'accent' : STATUS[un.status].tone,
          label: pct(un.value, 2) + ' unsubscribe rate, limit ' + pct(un.target, 2) },
        status: un.status, deltaText: ud.text, deltaTone: ud.tone, spark: un.spark14, sparkColor: 'chart-4', metric: 'unsubRate'
      }
    ];
    return html`<div className="hm-kpis is-live" role="group" aria-label="Month to date against goals">
      ${tiles.map(function (t) {
        return html`<${KpiTile} key=${t.id} ...${t} agentNow=${agentNow} onClick=${function () { go('analytics', { metric: t.metric }); }} />`;
      })}
    </div>`;
  }

  /* ================= Forecast ================= */
  function markerList(raw) {
    if (!raw || !raw.length) return EMPTY;
    var byDay = {}, order = [];
    raw.forEach(function (m) {
      if (!byDay[m.day]) { byDay[m.day] = []; order.push(m.day); }
      byDay[m.day].push(m);
    });
    return order.map(function (d) {
      var list = byDay[d];
      return {
        id: 'home-mark-' + d, x: d, kind: 'agent',
        label: list.length === 1 ? list[0].label : list.length + ' agent changes on ' + dayShort(d),
        onClick: function () { go('analytics', { metric: 'revenue', showAgents: true }); }
      };
    });
  }

  function ForecastPanel(p) {
    var React = R();
    var fc = useSel(selForecast);
    var rawMarkers = useSel(selMarkers);
    var movers = useSel(selMovers) || EMPTY;
    var markers = React.useMemo(function () { return markerList(rawMarkers); }, [rawMarkers]);
    var FC = chart('ForecastChart');
    var head;
    var cum = fc && fc.cumulative;
    var monthName = (fc && fc.month && (fc.month.name || fc.month.label)) || 'This month';
    if (!cum || !cum.projected || !fin(cum.projected.mean)) {
      head = html`<p className="hm-fc-head">The forecast appears once a full day of results is in.</p>`;
    } else {
      var pr = cum.projected, goal = fc.goal;
      var gap = fin(goal) && goal > 0 ? (pr.mean - goal) / goal : null;
      var gapText = gap === null ? '' : (Math.abs(gap) < 0.005 ? ', right at the ' + money(goal, true) + ' goal.'
        : ', ' + pct(Math.abs(gap), 0) + (gap > 0 ? ' above' : ' below') + ' the ' + money(goal, true) + ' goal.');
      head = html`<p className="hm-fc-head num">
        ${monthName} revenue is on pace for <strong>${money(pr.mean, true)}</strong>
        ${' (' + money(pr.lo80, true) + DASH + money(pr.hi80, true) + ')'}${gapText || '.'}
        ${fin(fc.p) ? html` <span className="hm-fc-p">${Math.round(fc.p * 100) + '% chance of reaching it.'}</span>` : null}
      </p>`;
    }
    return html`<${Panel} id="home-forecast" className="hm-area-fc" title="Forecast"
        actions=${html`<${Btn} kind="ghost" size="sm" onClick=${function () { go('analytics', { metric: 'revenue' }); }}>Open Analytics<//>`}>
      ${head}
      ${fc && fc.ready === false && cum ? html`<p className="hm-note">Early estimate from the last 14 days; the trend model takes over after a week of results.</p>` : null}
      <div className="hm-fc-chart">
        ${FC && fc ? html`<${FC} data=${fc} cumulative=${true} nowX=${fc.today} xFormat=${dayShort}
            goal=${fin(fc.goal) ? { y: fc.goal, label: 'Goal ' + money(fc.goal, true) } : null}
            yFormat="moneyCompact" height=${220} markers=${markers}
            labels=${{ actual: 'Revenue to date', forecast: 'Forecast' }} />`
          : html`<div className="hm-skel-chart" aria-hidden="true"></div>`}
      </div>
      <h3 className="hm-sub">Biggest movers this week</h3>
      ${movers.length ? html`<ul className="hm-movers">
        ${movers.map(function (m) {
          var up = m.delta >= 0;
          return html`<li key=${m.campaignId}>
            <button type="button" className="hm-mover" onClick=${function () { openCampaign(m.campaignId); }}>
              <span className=${cx('hm-mover-delta num', up ? 'is-good' : 'is-crit')}>${(up ? '+' : '-') + money(Math.abs(m.delta), true).replace(/^-/, '')}</span>
              <span className="hm-mover-name">${m.name}</span>
              ${m.note ? html`<span className=${cx('hm-mover-note', m.agentId && 'is-agent')}>${m.note}</span>` : null}
            </button>
          </li>`;
        })}
      </ul>` : html`<p className="hm-note">No campaign moved more than a dollar week over week yet.</p>`}
    <//>`;
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

  function NeedsYou() {
    var open = useSel(selOpen) || EMPTY;
    var hold = useHold();
    var frozen = useFrozenList(open, hold.held);
    var shown = frozen.items.slice(0, 3);
    var PC = kit('ProposalCard', null);
    var total = open.length;
    var footer = total > 0 ? html`<${Btn} kind="ghost" size="sm" onClick=${openApprovals}>${'See all ' + total + ' in Approvals'}<//>`
      : html`<${Btn} kind="ghost" size="sm" onClick=${openApprovals}>Open Approvals<//>`;
    return html`<${Panel} id="home-needs" className="hm-area-needs" title="Needs you" count=${total} footer=${footer}
        actions=${frozen.pending > 0 ? html`<${NewPill} count=${frozen.pending} onClick=${frozen.reveal} />` : null}>
      <div className="hm-needs-list" ...${hold.bind}>
        ${shown.length ? shown.map(function (pr) {
          return html`<div key=${pr.id} className="hm-needs-item">
            ${PC ? html`<${PC} id=${pr.id} compact=${true} showTarget=${true} />` : html`<${MiniProposal} proposal=${pr} />`}
          </div>`;
        }) : html`<${Empty} title="Nothing needs you right now." body="Agents on Suggest will queue changes here." />`}
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
    return html`<li className=${cx('hm-feed-row', it.tone && 'tone-' + it.tone)}>
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
    var boxRef = React.useRef(null);

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
            return html`<${FeedRow} key=${it.id} item=${it} proposal=${pr} onUndo=${onUndo} error=${errs[it.id]} today=${g.day === today} now=${tick} />`;
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

  function WhatChanged() {
    var React = R();
    var fs = React.useState('all'), fid = fs[0], setFid = fs[1];
    var filter = FILTERS.filter(function (f) { return f.id === fid; })[0] || FILTERS[0];
    var filters = html`<div className="hm-filters" role="group" aria-label="Show">
      ${FILTERS.map(function (f) {
        return html`<button key=${f.id} id=${'home-feed-filter-' + f.id} type="button" className=${cx('hm-filter', f.id === fid && 'is-on')}
          aria-pressed=${f.id === fid ? 'true' : 'false'} onClick=${function () { setFid(f.id); }}>${f.label}</button>`;
      })}
    </div>`;
    return html`<${Panel} id="home-changes" className="hm-area-feed" title="What changed" actions=${filters}>
      <${FeedList} key=${filter.id} filter=${filter} />
    <//>`;
  }

  /* ================= Agents ================= */
  var AUTONOMY = {
    off: { label: 'Off', tone: 'neutral' },
    suggest: { label: 'Suggest', tone: 'accent' },
    autopilot: { label: 'Autopilot', tone: 'agent' }
  };
  var STATE_TEXT = { running: 'Running', paused: 'Paused', off: 'Off', queued: 'Starting shortly' };

  function Dot(p) {
    var K = kit('StatusDot', null);
    if (K) return html`<${K} state=${p.state} pulse=${p.pulse} />`;
    return html`<span className=${cx('hm-dot', 'is-' + p.state, p.pulse && 'is-pulse')} aria-hidden="true"></span>`;
  }

  function AgentsPanel() {
    var roster = useSel(selRoster) || EMPTY;
    var tick = useSel(selTick) || 0;
    return html`<${Panel} id="home-agents" className="hm-area-agents" title="Agents"
        footer=${html`<${Btn} kind="ghost" size="sm" onClick=${function () { go('agents', { tab: 'roster' }); }}>Manage agents<//>`}>
      ${roster.length ? html`<ul className="hm-agents">
        ${roster.map(function (a) {
          var au = AUTONOMY[a.autonomy] || AUTONOMY.suggest;
          var ran = fin(a.lastRun) && a.lastRun >= 0 ? 'ran ' + rel(a.lastRun, tick) : 'first run pending';
          var next = a.status === 'running' || a.status === 'queued' ? (fin(a.nextRun) ? 'next ' + rel(a.nextRun, tick) : (a.status === 'queued' ? 'next within the hour' : '')) : '';
          var changes = fin(a.changes24h) ? a.changes24h : 0;
          return html`<li key=${a.id}>
            <button type="button" id=${'home-agent-' + a.id} className="hm-agent" onClick=${function () { go('agents', { tab: 'roster', agentId: a.id }); }}
                aria-label=${(a.name || agentName(a.id)) + ', ' + (STATE_TEXT[a.status] || a.status) + ', autonomy ' + au.label + ', ' + ran + (next ? ', ' + next : '') + ', ' + changes + ' changes in 24 hours' + (a.pending ? ', ' + a.pending + ' waiting for you' : '')}>
              <span className="hm-agent-main">
                <${Dot} state=${a.status} pulse=${a.ranThisTick} />
                <span className="hm-agent-name">${a.name || agentName(a.id)}</span>
                <span className="hm-agent-mode">${au.label}</span>
              </span>
              <span className="hm-agent-meta num">
                <span>${a.status === 'off' ? 'Off' : a.status === 'paused' ? 'Paused' + MID + ran : ran}</span>
                ${changes > 0 ? html`<span>${changes + (changes === 1 ? ' change' : ' changes') + ' in the last day'}</span>` : null}
                ${a.pending ? html`<span className="hm-agent-pending">${a.pending + ' waiting for you'}</span>` : null}
              </span>
            </button>
          </li>`;
        })}
      </ul>` : html`<${Empty} title="Agents are getting ready." />`}
    <//>`;
  }

  /* ================= Live campaigns ================= */
  function outlook(g) {
    if (!g || !fin(g.p) || !fin(g.outlookPct)) return { text: 'Too early', tone: 'neutral' };
    var pc = Math.round(g.outlookPct * 100) + '%';
    if (g.p >= 0.7) return { text: 'Likely ' + pc, tone: 'good' };
    if (g.p >= 0.4) return { text: 'At risk ' + pc, tone: 'warn' };
    return { text: 'Unlikely ' + pc, tone: 'crit' };
  }

  function LiveCampaigns() {
    var all = useSel(selRows) || EMPTY;
    var rows = all.filter(function (r) { return r.status === 'live' || r.status === 'paused'; });
    var planBtn = html`<${Btn} kind="secondary" size="sm" onClick=${function () { go('campaigns', { mode: 'planner' }); }}>Plan a campaign<//>`;
    return html`<${Panel} id="home-live" className="hm-area-live" title="Live campaigns" count=${rows.length}
        actions=${html`<${Btn} kind="ghost" size="sm" onClick=${function () { go('campaigns', { mode: 'board' }); }}>All campaigns<//>`}>
      ${rows.length ? html`<div className="hm-scroll k-scroll-x">
        <table className="hm-table">
          <caption className="hm-sr">Live and paused campaigns. Select a campaign to open it.</caption>
          <thead><tr>
            <th scope="col">Campaign</th>
            <th scope="col">Channels</th>
            <th scope="col">Spend / budget</th>
            <th scope="col">Goal progress</th>
            <th scope="col">Outlook</th>
            <th scope="col" className="is-num">Agent changes, 24h</th>
          </tr></thead>
          <tbody>
            ${rows.map(function (r) {
              var g = r.goal || {}, o = outlook(g);
              var spendShare = fin(r.budget) && r.budget > 0 ? r.spend / r.budget : null;
              return html`<tr key=${r.id} className="hm-row" onClick=${function () { openCampaign(r.id); }}>
                <th scope="row">
                  <button type="button" id=${'home-live-' + r.id} className="hm-row-link" onClick=${function (e) { e.stopPropagation(); openCampaign(r.id); }}>${r.name}</button>
                  ${r.status === 'paused' ? html`<span className="hm-row-state">Paused</span>` : null}
                </th>
                <td className="hm-chans">${(r.channels || EMPTY).map(function (ch) { return CH_SHORT[ch] || ch; }).join(', ')}</td>
                <td>
                  <span className="hm-cell-stack num">
                    <span>${money(r.spend, true) + ' / ' + money(r.budget, true)}</span>
                    <${Meter} value=${r.spend} max=${fin(r.budget) && r.budget > 0 ? r.budget : 1} tone=${spendShare !== null && spendShare > 1 ? 'crit' : 'accent'}
                      label=${money(r.spend) + ' spent of ' + money(r.budget) + ' budget'} />
                  </span>
                </td>
                <td className="num">${goalFmt(g.type, g.value, true) + ' of ' + goalFmt(g.type, g.target, true) + ' ' + (GOAL_NOUN[g.type] || '')}</td>
                <td><${Pill} tone=${o.tone} title=${fin(g.p) ? Math.round(g.p * 100) + '% chance of reaching the goal' : 'Outlook appears after the first full day'}>${o.text}<//></td>
                <td className="is-num num">${r.agentChanges24h > 0 ? html`<span className="hm-agent-count" title="Changes made by agents in the last 24 hours">${r.agentChanges24h}</span>` : html`<span className="hm-muted">0</span>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>` : html`<${Empty} title="Nothing is live right now. Plan a campaign or schedule a draft." action=${planBtn} />`}
    <//>`;
  }

  /* ================= View ================= */

  function Home() {
    var ready = useSel(selReady);
    var tick = useSel(selTick);
    var kpis = useSel(selKpis);
    var agentNow = useSel(selAgentNow);
    var tenant = useSel(selTenant) || 'Fernway Outfitters';
    var today = ready && fin(tick) ? dayLabel(Math.floor(tick / 24), 'long') : null;

    var head = html`<header className="hm-head">
      <div className="hm-head-text">
        <p className="hm-date">${today ? today + MID + tenant : tenant}</p>
        <h1 id="page-title" tabIndex="-1">Command Center</h1>
      </div>
      <div className="hm-head-actions">
        <${Btn} kind="primary" onClick=${function () { go('campaigns', { mode: 'planner' }); }}>Plan a campaign<//>
      </div>
    </header>`;

    if (!ready) {
      return html`<section className="v-home">
        ${head}
        <p className="hm-note" role="status">Loading Fernway Outfitters${'…'}</p>
        <${KpiStrip} kpis=${null} />
      </section>`;
    }
    return html`<section className="v-home">
      ${head}
      <div className="hm-grid">
        <div className="hm-area-kpi"><${KpiStrip} kpis=${kpis} agentNow=${agentNow} /></div>
        <${NeedsYou} />
        <${ForecastPanel} />
        <${WhatChanged} />
        <${AgentsPanel} />
        <${LiveCampaigns} />
      </div>
    </section>`;
  }

  MC.views.home = Home;
})();
