/* Marketing Cloud - Campaigns view (#campaigns): MC.views.campaigns.
   Opens on the Board with one primary action (Plan a campaign). List and Calendar are tabs.
   Campaign detail keeps dense material (journey, content, audience, budget, activity) behind tabs.
   The Planner turns a brief into a plan through MC.runtime.preview('planner', ...) and degrades to a
   plain draft when the Campaign Planner is not loaded. Dates are calendar dates and relative times;
   no clock or tick is ever shown. Editors live in local drafts and never get replaced by a tick. */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  MC.views = MC.views || {};

  var DASH = '–', MID = ' · ', ARROW = '→', ELL = '…', LARR = '←';
  var EMPTY = [];
  var EMPTY_OBJ = {};

  function h() { return MC.html.apply(null, arguments); }
  function R() { return window.React; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function has(o, k) { return !!o && typeof o[k] === 'function'; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function getWorld() { return MC.store && has(MC.store, 'getState') ? MC.store.getState() : null; }

  /* ---------------- formatting (MC.fmt with fallbacks) ---------------- */
  function commas(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function tryFmt(name, a, b) {
    try { if (MC.fmt && typeof MC.fmt[name] === 'function') { var r = MC.fmt[name](a, b); if (r != null) return String(r); } } catch (e) { /* fallback */ }
    return null;
  }
  function money(n, compact) { return fin(n) ? (tryFmt('money', n, compact ? { compact: true } : undefined) || ((n < 0 ? '-$' : '$') + commas(n))) : DASH; }
  function num(n, compact) { return fin(n) ? (tryFmt('num', n, compact ? { compact: true } : undefined) || commas(n)) : DASH; }
  function pct(p, dp) { return fin(p) ? (tryFmt('pct', p, dp) || (p * 100).toFixed(dp == null ? 1 : dp) + '%') : DASH; }
  function ratio(x) { return fin(x) ? (tryFmt('ratio', x) || x.toFixed(1) + '×') : DASH; }
  function delta(r) { return fin(r) ? (tryFmt('delta', r) || ((r > 0 ? '+' : '') + (r * 100).toFixed(1) + '%')) : DASH; }
  function dayShort(d) { return fin(d) ? (tryFmt('dayShort', d) || 'Day ' + (d + 1)) : DASH; }
  function dayLabel(d) { return fin(d) ? (tryFmt('dayLabel', d) || 'Day ' + (d + 1)) : DASH; }
  function hourLabel(hr) { return hr === 'adaptive' ? 'Adaptive' : (fin(hr) ? (tryFmt('hour', hr) || hr + ':00') : DASH); }
  function rel(from, now) {
    if (!fin(from) || !fin(now)) return '';
    var r = tryFmt('rel', from, now);
    if (r) return r;
    var d = now - from, a = Math.abs(d);
    if (a < 1) return 'just now';
    var s = a < 24 ? a + 'h' : Math.floor(a / 24) + 'd';
    return d > 0 ? s + ' ago' : 'in ' + s;
  }
  function dayOf(t) { return Math.floor(t / 24); }
  function tickOf(d, hr) { return d * 24 + (hr || 0); }
  // Campaigns end at 00:00 of their end tick: the last full day is the day before.
  function lastDayOf(endTick) { return dayOf(endTick - 1); }
  function dateRange(startTick, endTick) {
    if (!fin(startTick) || !fin(endTick)) return DASH;
    return dayShort(dayOf(startTick)) + ' ' + DASH + ' ' + dayShort(lastDayOf(endTick));
  }
  function ymd(d) {
    try { if (MC.time && has(MC.time, 'ymd')) return MC.time.ymd(d); } catch (e) { /* none */ }
    return '';
  }
  function dayOfYmd(s) {
    try { if (MC.time && has(MC.time, 'dayOfYmd')) return MC.time.dayOfYmd(s); } catch (e) { /* none */ }
    return null;
  }
  function plural(n, one, many) { return num(n) + ' ' + (n === 1 ? one : many); }

  var CH_ALL = ['email', 'sms', 'push', 'social', 'web'];
  var OWNED = ['email', 'sms', 'push'];
  function chAll() { return (MC.CH && MC.CH.ALL) || CH_ALL; }
  function isOwned(ch) { return ((MC.CH && MC.CH.OWNED) || OWNED).indexOf(ch) >= 0; }
  function chLabel(ch) { return (MC.CH && MC.CH.LABEL && MC.CH.LABEL[ch]) || ch; }
  function chList(chs) { return (chs || EMPTY).map(chLabel).join(MID); }

  var GOALS = ['revenue', 'conversions', 'reactivation', 'engagement', 'launch'];
  var GOAL_LABEL = { revenue: 'Revenue', conversions: 'Conversions', reactivation: 'Reactivation', engagement: 'Engagement', launch: 'Launch' };
  var GOAL_NOUN = { revenue: 'revenue', conversions: 'orders', reactivation: 'reactivations', engagement: 'clicks', launch: 'orders' };
  var GOAL_METRIC = { revenue: 'revenue', conversions: 'conversions', reactivation: 'react', engagement: 'clicks', launch: 'conversions' };
  var TONES = ['practical', 'adventurous', 'warm', 'urgent'];
  var OFFERS = ['none', 'freeship', 'pct15', 'pct25', 'gift'];
  function toneLabel(t) { return (MC.copy && MC.copy.TONE_LABEL && MC.copy.TONE_LABEL[t]) || (t ? t.charAt(0).toUpperCase() + t.slice(1) : DASH); }
  function offerLabel(o) { return (MC.copy && MC.copy.OFFER_LABEL && MC.copy.OFFER_LABEL[o]) || o || DASH; }
  function goalFmt(type, v, compact) { return type === 'revenue' ? money(v, compact) : num(v, compact); }
  function goalText(g) {
    if (!g) return DASH;
    return goalFmt(g.type, g.value, true) + ' of ' + goalFmt(g.type, g.target, true) + (g.type === 'revenue' ? '' : ' ' + (GOAL_NOUN[g.type] || ''));
  }

  var AGENT_NAMES = {
    optimizer: 'Variant Optimizer', sendtime: 'Send-Time Tuner', pacer: 'Budget Pacer', guard: 'Fatigue Guard',
    analyst: 'Insight Analyst', copy: 'Copy Drafter', scout: 'Segment Scout', planner: 'Campaign Planner'
  };
  function agentIdOf(by) { return typeof by === 'string' && by.indexOf('agent:') === 0 ? by.slice(6) : (AGENT_NAMES[by] ? by : null); }
  function agentName(id) {
    if (!id) return '';
    if (id === 'user') return 'You';
    try { var d = MC.runtime && has(MC.runtime, 'def') ? MC.runtime.def(id) : null; if (d && d.name) return d.name; } catch (e) { /* fallback */ }
    return AGENT_NAMES[id] || String(id);
  }

  /* ---------------- store + navigation ---------------- */
  function useSel(sel, eq) {
    var H = MC.hooks || {};
    if (!has(H, 'useSelect')) return undefined;
    return H.useSelect(function (w) { if (!w) return undefined; try { return sel(w); } catch (e) { return undefined; } }, eq);
  }
  function useUiSel(sel, eq) {
    var H = MC.hooks || {};
    return has(H, 'useUi') ? H.useUi(sel, eq) : undefined;
  }
  function call(name, w, a, b) {
    var f = MC.select && MC.select[name];
    if (typeof f !== 'function' || !w) return null;
    try { return f(w, a, b); } catch (e) { return null; }
  }
  function dispatch(type, payload) {
    try {
      if (!MC.store || !has(MC.store, 'dispatch')) return { ok: false, error: 'The workspace is still starting up.' };
      return MC.store.dispatch({ type: type, payload: payload }) || { ok: false, error: 'No response.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  function setFocus(patch) {
    try { if (MC.uiStore && has(MC.uiStore, 'setFocus')) MC.uiStore.setFocus('campaigns', patch); } catch (e) { /* noop */ }
  }
  function go(route, patch) {
    try { if (MC.nav && has(MC.nav, 'go')) MC.nav.go(route, patch); else window.location.hash = '#' + route; } catch (e) { /* noop */ }
  }
  function openDetail(id, tab) { setFocus({ mode: 'detail', id: id, tab: tab || 'overview' }); }
  function openApprovals() { try { MC.uiStore.set({ drawer: 'approvals' }); } catch (e) { /* noop */ } }
  function setBriefStore(b) { try { if (MC.uiStore && has(MC.uiStore, 'set')) MC.uiStore.set({ plannerBrief: b }); } catch (e) { /* noop */ } }

  /* ---------------- kit lookups (render time) with small fallbacks ---------------- */
  function FbButton(p) {
    return h`<button type="button" id=${p.id} className=${cx('cm-fbtn', 'is-' + (p.kind || 'secondary'))} onClick=${p.onClick}
      disabled=${!!p.disabled} aria-label=${p['aria-label']} title=${p.title}>${p.children}</button>`;
  }
  function FbPill(p) { return h`<span className=${cx('cm-fpill', 'is-' + (p.tone || 'neutral'))}>${p.children}</span>`; }
  function FbStatusPill(p) { return h`<${FbPill} tone="neutral">${p.children || p.status}<//>`; }
  function FbTabs(p) {
    return h`<div role="tablist" className="cm-ftabs" id=${p.id} aria-label=${p.label}>${(p.tabs || EMPTY).map(function (t) {
      var on = t.id === p.value;
      return h`<button key=${t.id} type="button" role="tab" id=${p.id + '-' + t.id} aria-selected=${on ? 'true' : 'false'}
        className=${cx('cm-ftab', on && 'is-on')} onClick=${function () { p.onChange(t.id); }}>${t.label}</button>`;
    })}</div>`;
  }
  function FbPanel(p) {
    return h`<section id=${p.id} className=${cx('cm-fpanel', p.className)}>
      ${p.title ? h`<header className="cm-fpanel-head"><h2 className="cm-h2">${p.title}</h2>${p.actions || null}</header>` : null}
      ${p.children}
    </section>`;
  }
  var FALLBACK = { Button: FbButton, Pill: FbPill, StatusPill: FbStatusPill, Tabs: FbTabs, Panel: FbPanel };
  function ui(name) { var c = MC.ui && MC.ui[name]; return typeof c === 'function' ? c : (FALLBACK[name] || null); }
  function chart(name) { var c = MC.charts && MC.charts[name]; return typeof c === 'function' ? c : null; }
  function Btn(p) { var B = ui('Button'); return h`<${B} ...${p}>${p.children}<//>`; }
  function Pill(p) { var P = ui('Pill'); return h`<${P} tone=${p.tone} size=${p.size} title=${p.title}>${p.children}<//>`; }
  function Status(p) { var S = ui('StatusPill'); return h`<${S} status=${p.status} />`; }
  function Link(p) {
    return h`<button type="button" id=${p.id} className=${cx('cm-link', p.className)} onClick=${p.onClick} disabled=${p.disabled}
      aria-label=${p['aria-label']}>${p.children}</button>`;
  }
  function Msg(p) {
    if (!p.text) return null;
    return h`<p className=${cx('cm-msg', 'is-' + (p.tone || 'neutral'))} role=${p.tone === 'crit' ? 'alert' : null}>${p.text}</p>`;
  }
  // Calm agent attribution: a small russet dot plus plain text.
  function AgentNote(p) {
    if (!p.text) return null;
    return h`<span className=${cx('cm-agent', p.className)} title=${p.title || p.text}>
      <span className="cm-agent-dot" aria-hidden="true"></span><span className="cm-agent-text">${p.text}</span></span>`;
  }
  function Meter(p) {
    var M = ui('Meter');
    if (M) return h`<${M} value=${p.value} max=${p.max} goal=${p.goal} ghost=${p.ghost} tone=${p.tone} label=${p.label} />`;
    return null;
  }
  function Spark(p) {
    var S = chart('Sparkline');
    if (!S || !p.values || p.values.length < 2 || !p.values.some(function (v) { return v > 0; })) return null;
    return h`<${S} values=${p.values} width=${p.width || 88} height=${p.height || 22} color="chart-1" area=${true} ariaLabel=${p.label} />`;
  }

  /* ---------------- outlook ---------------- */
  function outlookOf(g, status) {
    if (status === 'draft') return { tone: 'neutral', label: 'Draft' };
    if (status === 'scheduled') return { tone: 'accent', label: 'Scheduled' };
    if (!g || !fin(g.outlookPct)) return { tone: 'neutral', label: 'Too early' };
    if (status === 'completed') return { tone: g.outlookPct >= 1 ? 'good' : 'neutral', label: pct(g.outlookPct, 0) + ' of goal' };
    var p = g.outlookPct;
    if (p >= 0.95) return { tone: 'good', label: 'On track' };
    if (p >= 0.75) return { tone: 'warn', label: 'At risk' };
    return { tone: 'crit', label: 'Off track' };
  }

  /* ---------------- brief helpers (planner) ---------------- */
  function todayOf(w) { return w && w.meta ? dayOf(w.meta.tick) : 0; }
  function defaultBrief(w) {
    var t = todayOf(w);
    return {
      name: '', goal: { type: 'revenue', target: 20000 }, productFocus: null, segmentId: null, budget: 5000,
      startDay: t + 2, endDay: t + 16, channels: ['email', 'push', 'social'], tone: 'practical', offer: 'none', notes: ''
    };
  }
  function briefFromCampaign(c, copyName) {
    var b = c.brief && typeof c.brief === 'object' ? clone(c.brief) : null;
    var base = {
      name: c.name, goal: { type: c.goal.type, target: c.goal.target }, productFocus: c.productFocus || null,
      segmentId: c.segmentId || null, budget: (c.budget && c.budget.total) || 0,
      startDay: dayOf(c.startTick), endDay: dayOf(c.endTick), channels: (c.channels || EMPTY).slice(),
      tone: c.tone || 'practical', offer: c.offer || 'none', notes: typeof c.brief === 'string' ? c.brief : ''
    };
    var out = b ? Object.assign(base, b, { goal: Object.assign({}, base.goal, b.goal || {}) }) : base;
    if (copyName) out.name = (out.name + ' (copy)').slice(0, 80);
    return out;
  }
  function briefKey(b) { try { return JSON.stringify(b); } catch (e) { return String(Math.random()); } }
  function briefErrors(b) {
    var e = {};
    if (!b.name || !String(b.name).trim()) e.name = 'Give the campaign a name.';
    if (!(fin(b.goal && b.goal.target) && b.goal.target > 0)) e.target = 'Set a target above zero.';
    if (!(fin(b.budget) && b.budget >= 0)) e.budget = 'Set a budget of zero or more.';
    if (!fin(b.startDay) || !fin(b.endDay) || b.endDay <= b.startDay) e.dates = 'The end date must come after the start date.';
    if (!b.channels || !b.channels.length) e.channels = 'Pick at least one channel.';
    return e;
  }

  /* ================================================================
     Card menu (Board)
     ================================================================ */
  function menuItems(c) {
    var out = [];
    if (c.status === 'draft') { out.push({ id: 'plan', label: 'Continue planning' }); out.push({ id: 'schedule', label: 'Schedule' + ELL }); }
    if (c.status === 'scheduled') out.push({ id: 'unschedule', label: 'Move back to draft' });
    if (c.status === 'live') out.push({ id: 'pause', label: 'Pause' });
    if (c.status === 'paused') out.push({ id: 'resume', label: 'Resume' });
    if (c.status === 'live' || c.status === 'paused') out.push({ id: 'end', label: 'End campaign' + ELL });
    out.push({ id: 'dup', label: 'Duplicate brief' });
    return out;
  }
  function continuePlanning(c) {
    setBriefStore(briefFromCampaign(c));
    briefOwner.id = c.id;
    planMemo.plan = null; planMemo.key = null; planMemo.accepted = {}; planMemo.edits = {}; planMemo.regen = {};
    setFocus({ mode: 'planner', id: c.id });
  }
  function duplicateBrief(c) {
    var w = getWorld(), b = briefFromCampaign(c, true), t = todayOf(w);
    if (b.startDay <= t) { var len = Math.max(1, b.endDay - b.startDay); b.startDay = t + 2; b.endDay = b.startDay + len; }
    setBriefStore(b);
    briefOwner.id = null;
    planMemo.plan = null; planMemo.key = null; planMemo.accepted = {}; planMemo.edits = {}; planMemo.regen = {};
    setFocus({ mode: 'planner', id: null });
  }
  function runMenu(c, id) {
    if (id === 'plan') { continuePlanning(c); return null; }
    if (id === 'schedule') { setFocus({ mode: 'detail', id: c.id, tab: 'overview', schedule: true }); return null; }
    if (id === 'dup') { duplicateBrief(c); return null; }
    var st = { unschedule: 'draft', pause: 'paused', resume: 'live', end: 'completed' }[id];
    if (!st) return null;
    var r = dispatch('campaign/setStatus', { id: c.id, status: st });
    return r.ok ? null : (r.error || 'That didn’t work.');
  }

  function CardMenu(p) {
    var React = R();
    var os = React.useState(false), open = os[0], setOpen = os[1];
    var cs = React.useState(null), confirm = cs[0], setConfirm = cs[1];
    var es = React.useState(null), err = es[0], setErr = es[1];
    var wrap = React.useRef(null), btn = React.useRef(null);
    var c = p.campaign;
    React.useEffect(function () {
      if (!open) return undefined;
      function onDoc(e) { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setConfirm(null); } }
      document.addEventListener('mousedown', onDoc);
      return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    function close(refocus) { setOpen(false); setConfirm(null); if (refocus && btn.current) btn.current.focus(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(true); } }
    function pick(it) {
      if (it.id === 'end') { setConfirm('end'); return; }
      var r = runMenu(c, it.id);
      setErr(r);
      close(false);
    }
    var items = menuItems(c);
    var IB = MC.ui && MC.ui.IconButton;
    var mid = 'cmp-card-' + c.id + '-menu';
    return h`<div className="cm-menu-wrap" ref=${wrap} onKeyDown=${onKey}>
      ${IB ? h`<span ref=${btn} className="cm-menu-anchor"><${IB} id=${mid + '-btn'} icon="more" label=${'Actions for ' + c.name} size="sm"
            aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} onClick=${function () { setOpen(!open); setConfirm(null); }} /></span>`
        : h`<button type="button" ref=${btn} id=${mid + '-btn'} className="cm-menu-btn" aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'}
            aria-label=${'Actions for ' + c.name} onClick=${function () { setOpen(!open); }}>${ELL}</button>`}
      ${open ? h`<div className="cm-menu" role=${confirm ? 'group' : 'menu'} id=${mid} aria-label=${'Actions for ' + c.name}>
        ${confirm === 'end' ? h`<div className="cm-menu-confirm">
            <p>End “${c.name}” now? Sends and ad spend stop today.</p>
            <div className="cm-row">
              <${Btn} kind="danger" size="sm" id=${mid + '-end-yes'} onClick=${function () { var r = runMenu(c, 'end'); setErr(r); close(true); }}>End campaign<//>
              <${Btn} kind="ghost" size="sm" onClick=${function () { setConfirm(null); }}>Keep running<//>
            </div>
          </div>`
          : items.map(function (it, i) {
            return h`<button key=${it.id} type="button" role="menuitem" id=${mid + '-' + it.id} className="cm-menu-item"
              autoFocus=${i === 0} onClick=${function () { pick(it); }}>${it.label}</button>`;
          })}
      </div>` : null}
      ${err ? h`<p className="cm-msg is-crit cm-menu-err" role="alert">${err}</p>` : null}
    </div>`;
  }

  /* ================================================================
     Board
     ================================================================ */
  var COLUMNS = [
    { id: 'draft', label: 'Draft', match: ['draft'] },
    { id: 'scheduled', label: 'Scheduled', match: ['scheduled'] },
    { id: 'live', label: 'Live', match: ['live', 'paused'] },
    { id: 'completed', label: 'Completed', match: ['completed'] }
  ];

  function selRows(w) { return call('campaignRows', w) || EMPTY; }
  function selCampaigns(w) { return w.campaigns || null; }
  function selTick(w) { return w.meta ? w.meta.tick : 0; }
  function selPlannerProposals(w) {
    var list = call('openProposals', w) || EMPTY;
    var out = list.filter(function (p) { return p.agentId === 'planner'; });
    return out.length ? out : EMPTY;
  }

  function BoardCard(p) {
    var r = p.row, c = p.campaign, tick = p.tick;
    var g = r.goal || {};
    var out = outlookOf(g, r.status);
    var pill = r.status === 'paused' ? { tone: 'warn', label: 'Paused' } : out;
    var showPill = r.status !== 'draft' && r.status !== 'scheduled';
    var aId = c ? agentIdOf(c.updatedBy) : null;
    var agentLine = r.agentChanges24h > 0
      ? plural(r.agentChanges24h, 'agent change', 'agent changes') + ' today'
      : null;
    var agentTitle = aId && c ? 'Last changed by ' + agentName(aId) + ', ' + rel(c.updatedTick, tick) : agentLine;
    var started = r.status === 'live' || r.status === 'paused' || r.status === 'completed';
    var max = Math.max(g.target || 0, g.value || 0) || 1;
    return h`<li className="cm-card" id=${'cmp-card-' + r.id}>
      <div className="cm-card-top">
        <button type="button" className="cm-card-name" onClick=${function () { openDetail(r.id); }}>${r.name}</button>
        ${c ? h`<${CardMenu} campaign=${c} />` : null}
      </div>
      <p className="cm-card-meta num">${dateRange(r.startTick, r.endTick)}</p>
      <p className="cm-card-ch">${chList(r.channels)}</p>
      ${started ? h`<div className="cm-card-goal">
          <div className="cm-card-goal-row">
            <span className="num">${goalText(g)}</span>
            ${showPill ? h`<${Pill} tone=${pill.tone} size="sm">${pill.label}<//>` : null}
          </div>
          <${Meter} value=${g.value} max=${max} goal=${g.target} tone=${pill.tone === 'crit' ? 'crit' : pill.tone === 'warn' ? 'warn' : 'accent'}
            label=${goalText(g) + ' goal progress'} />
        </div>`
        : h`<p className="cm-card-goal-plan num">Goal ${goalFmt(g.type, g.target, true)}${g.type === 'revenue' ? ' revenue' : ' ' + (GOAL_NOUN[g.type] || '')}${MID}Budget ${money(r.budget, true)}</p>`}
      ${r.status === 'live' || r.status === 'paused' ? h`<div className="cm-card-foot">
          <${Spark} values=${r.spark14} label=${r.name + ', last 14 days'} />
          ${agentLine ? h`<${AgentNote} text=${agentLine} title=${agentTitle} />` : null}
        </div>` : null}
    </li>`;
  }

  function PlannerSuggestion(p) {
    var pr = p.proposal;
    return h`<li className="cm-suggest">
      <${AgentNote} text="Suggested by Campaign Planner" />
      <p className="cm-suggest-title">${pr.title}</p>
      ${pr.rationale ? h`<p className="cm-suggest-why">${pr.rationale}</p>` : null}
      <${Link} onClick=${openApprovals}>Review in Approvals<//>
    </li>`;
  }

  function Board() {
    var rows = useSel(selRows) || EMPTY;
    var campaigns = useSel(selCampaigns);
    var tick = useSel(selTick) || 0;
    var suggestions = useSel(selPlannerProposals) || EMPTY;
    var byId = (campaigns && campaigns.byId) || EMPTY_OBJ;
    return h`<div className="cm-board" role="list" aria-label="Campaigns by status">
      ${COLUMNS.map(function (col) {
        var list = rows.filter(function (r) { return col.match.indexOf(r.status) >= 0; });
        var sug = col.id === 'draft' ? suggestions : EMPTY;
        return h`<section key=${col.id} className="cm-col" role="listitem" aria-labelledby=${'cmp-col-' + col.id}>
          <h2 className="cm-col-title" id=${'cmp-col-' + col.id}>${col.label} <span className="cm-count num">${list.length}</span></h2>
          <ul className="cm-cards">
            ${list.map(function (r) { return h`<${BoardCard} key=${r.id} row=${r} campaign=${byId[r.id]} tick=${tick} />`; })}
            ${sug.map(function (pr) { return h`<${PlannerSuggestion} key=${pr.id} proposal=${pr} />`; })}
          </ul>
          ${!list.length && !sug.length ? h`<p className="cm-col-empty">${col.id === 'draft' ? 'No drafts. Plan a campaign to start one.' : 'Nothing here right now.'}</p>` : null}
        </section>`;
      })}
    </div>`;
  }

  /* ================================================================
     List
     ================================================================ */
  function ListMode() {
    var rows = useSel(selRows) || EMPTY;
    var DT = MC.ui && MC.ui.DataTable;
    var STATUS_RANK = { live: 0, paused: 1, scheduled: 2, draft: 3, completed: 4 };
    var cols = [
      { key: 'name', label: 'Campaign', sort: true, render: function (r) { return h`<span className="cm-strong">${r.name}</span>`; } },
      { key: 'status', label: 'Status', sort: true, sortValue: function (r) { return STATUS_RANK[r.status]; }, render: function (r) { return h`<${Status} status=${r.status} />`; } },
      { key: 'startTick', label: 'Dates', sort: true, render: function (r) { return h`<span className="num cm-nowrap">${dateRange(r.startTick, r.endTick)}</span>`; } },
      { key: 'channels', label: 'Channels', render: function (r) { return h`<span className="cm-muted">${chList(r.channels)}</span>`; } },
      { key: 'goal', label: 'Goal progress', sort: true, sortValue: function (r) { return r.goal && r.goal.target ? r.goal.value / r.goal.target : 0; },
        render: function (r) { return h`<span className="num">${goalText(r.goal)}</span>`; } },
      { key: 'spend', label: 'Spend', align: 'right', sort: true, render: function (r) { return h`<span className="num">${money(r.spend, true)} / ${money(r.budget, true)}</span>`; } },
      { key: 'agentChanges24h', label: 'Agent changes, 24h', align: 'right', sort: true,
        render: function (r) { return r.agentChanges24h > 0 ? h`<${AgentNote} text=${String(r.agentChanges24h)} title=${plural(r.agentChanges24h, 'agent change', 'agent changes') + ' in the last day'} />` : h`<span className="cm-muted num">0</span>`; } }
    ];
    if (!DT) {
      return h`<ul className="cm-plain-list">${rows.map(function (r) {
        return h`<li key=${r.id}><${Link} onClick=${function () { openDetail(r.id); }}>${r.name}<//> <span className="cm-muted">${r.status}</span></li>`;
      })}</ul>`;
    }
    return h`<div className="cm-list">
      <div className="k-scroll-x"><${DT} id="cmp-table" columns=${cols} rows=${rows} rowKey="id" label="All campaigns"
        onRowClick=${function (r) { openDetail(r.id); }} freezeOrderWhileFocused=${true}
        empty="No campaigns yet." /></div>
    </div>`;
  }

  /* ================================================================
     Calendar
     ================================================================ */
  function CalendarMode() {
    var rows = useSel(selRows) || EMPTY;
    var tick = useSel(selTick) || 0;
    var G = chart('Gantt');
    var t = dayOf(tick), from = t - 6, to = t + 55;
    try {
      if (MC.time && has(MC.time, 'monthOf')) {
        var m = MC.time.monthOf(t);
        var next = MC.time.monthOf(m.toDay + 1);
        from = m.fromDay; to = next.toDay + 1;
      }
    } catch (e) { /* default window */ }
    var gRows = rows.map(function (r) { return { id: r.id, label: r.name, start: r.startTick, end: r.endTick, status: r.status }; });
    var markers = ((MC.time && MC.time.EVENTS) || EMPTY).map(function (ev) { return { x: tickOf(ev.day, 0), label: ev.label }; });
    if (!G) return h`<p className="cm-muted">The calendar appears once the chart library has loaded.</p>`;
    return h`<div className="cm-calendar">
      <p className="cm-muted cm-small">${dayLabel(from)} to ${dayLabel(to - 1)}. Select a bar to open the campaign.</p>
      <${G} rows=${gRows} now=${tick} from=${tickOf(from, 0)} to=${tickOf(to, 0)} markers=${markers}
        onSelect=${function (id) { openDetail(id); }} ariaLabel="Campaign calendar" />
    </div>`;
  }

  /* ================================================================
     Campaign detail
     ================================================================ */
  var DETAIL_TABS = [
    { id: 'overview', label: 'Overview' }, { id: 'journey', label: 'Journey' }, { id: 'content', label: 'Content' },
    { id: 'audience', label: 'Audience' }, { id: 'budget', label: 'Budget' }, { id: 'activity', label: 'Activity' }
  ];

  function useCampaign(id) {
    var sel = R().useCallback(function (w) { return w.campaigns && w.campaigns.byId ? w.campaigns.byId[id] || null : null; }, [id]);
    return useSel(sel);
  }
  function useStats(id) {
    var sel = R().useCallback(function (w) { return call('campaignStats', w, id); }, [id]);
    return useSel(sel);
  }

  function SchedulePanel(p) {
    var React = R();
    var c = p.campaign;
    var es = React.useState(null), err = es[0], setErr = es[1];
    var items = useSel(R().useCallback(function (w) {
      if (!MC.guardrails || !has(MC.guardrails, 'preflight')) return null;
      return { v: w.campaigns, vv: w.variants, s: w.segments };
    }, []), MC.util && MC.util.shallowEqual);
    var checks = React.useMemo(function () {
      var w = getWorld();
      if (!w || !MC.guardrails || !has(MC.guardrails, 'preflight')) return null;
      try { return MC.guardrails.preflight(w, c) || EMPTY; } catch (e) { return null; }
    }, [c, items]);
    var GL = MC.ui && MC.ui.GuardrailList;
    var fails = checks ? checks.filter(function (x) { return x.status === 'fail'; }).length : 0;
    function schedule() {
      var r = dispatch('campaign/setStatus', { id: c.id, status: 'scheduled' });
      if (r.ok) { setErr(null); p.onClose(); } else setErr(r.error || 'Couldn’t schedule this campaign.');
    }
    var Panel = ui('Panel');
    return h`<${Panel} id="cmp-schedule" title="Schedule this campaign" sub=${'Starts ' + dayLabel(dayOf(c.startTick)) + '. Preflight checks must pass first.'}>
      ${checks && GL ? h`<${GL} items=${checks.map(function (x) { return { id: x.id, label: x.label, status: x.status, detail: x.detail, blocking: x.status === 'fail' }; })} ariaLabel="Preflight checks" />`
        : h`<p className="cm-muted">Preflight checks are unavailable right now.</p>`}
      <${Msg} text=${err} tone="crit" />
      <div className="cm-row cm-gap-top">
        <${Btn} kind="primary" id="cmp-schedule-confirm" disabled=${!checks || fails > 0} onClick=${schedule}>Schedule campaign<//>
        <${Btn} kind="ghost" onClick=${p.onClose}>Not yet<//>
        ${fails ? h`<span className="cm-muted cm-small">${plural(fails, 'check needs', 'checks need')} fixing first.</span>` : null}
      </div>
    <//>`;
  }

  function EditDetails(p) {
    var React = R();
    var c = p.campaign;
    var H = MC.hooks || {};
    var source = React.useMemo(function () {
      return { name: c.name, target: c.goal.target, endDay: dayOf(c.endTick), brief: typeof c.brief === 'string' ? c.brief : ((c.brief && c.brief.notes) || '') };
    }, [c.name, c.goal.target, c.endTick, c.brief]);
    var draft = H.useDraft ? H.useDraft(source) : { value: source, set: function () {}, dirty: false };
    var es = React.useState(null), err = es[0], setErr = es[1];
    var v = draft.value;
    var TI = ui('TextInput'), NI = ui('NumberInput'), TA = ui('TextArea'), Field = ui('Field');
    var completed = c.status === 'completed';
    function set(k, val) { draft.set(function (d) { var n = Object.assign({}, d); n[k] = val; return n; }); }
    function save() {
      var patch = {};
      if (v.name !== c.name) patch.name = v.name;
      if (!completed && Number(v.target) !== c.goal.target) patch.goal = { type: c.goal.type, target: Number(v.target) };
      if (!completed && v.endDay !== dayOf(c.endTick)) patch.endTick = tickOf(v.endDay, 0);
      var briefNow = typeof c.brief === 'string' ? c.brief : ((c.brief && c.brief.notes) || '');
      if (v.brief !== briefNow) patch.brief = typeof c.brief === 'object' && c.brief ? Object.assign({}, c.brief, { notes: v.brief }) : v.brief;
      if (!Object.keys(patch).length) { p.onClose(); return; }
      var r = dispatch('campaign/update', { id: c.id, patch: patch });
      if (r.ok) { setErr(null); if (draft.commit) draft.commit(); p.onClose(); } else setErr(r.error || 'Couldn’t save.');
    }
    var Chip = MC.ui && MC.ui.ConflictChip;
    var Panel = ui('Panel');
    return h`<${Panel} id="cmp-edit" title="Edit brief" sub=${completed ? 'Completed campaigns keep their goal and dates.' : 'Changes apply from the next send.'}>
      ${draft.conflict && Chip ? h`<${Chip} agentId=${agentIdOf(c.updatedBy) || 'user'} onTheirs=${draft.takeTheirs} onMine=${draft.keepMine} />` : null}
      <div className="cm-form-grid">
        <${Field} id="cmp-edit-name" label="Campaign name"><${TI} id="cmp-edit-name" value=${v.name} maxLength=${80} onChange=${function (x) { set('name', x); }} /><//>
        ${!completed ? h`<${Field} id="cmp-edit-target" label=${'Goal: ' + (GOAL_LABEL[c.goal.type] || c.goal.type)}>
            <${NI} id="cmp-edit-target" value=${v.target} min=${1} step=${c.goal.type === 'revenue' ? 500 : 5} onChange=${function (x) { set('target', x); }} /><//>` : null}
        ${!completed ? h`<${Field} id="cmp-edit-end" label="End date" hint="The campaign stops at the start of this day.">
            <${TI} id="cmp-edit-end" type="date" value=${ymd(v.endDay)} onChange=${function (x) { var d = dayOfYmd(x); if (d !== null) set('endDay', d); }} /><//>` : null}
      </div>
      <${Field} id="cmp-edit-brief" label="Brief"><${TA} id="cmp-edit-brief" value=${v.brief} rows=${3} maxLength=${400} onChange=${function (x) { set('brief', x); }} /><//>
      <${Msg} text=${err} tone="crit" />
      <div className="cm-row cm-gap-top">
        <${Btn} kind="primary" id="cmp-edit-save" disabled=${!draft.dirty} onClick=${save}>Save changes<//>
        <${Btn} kind="ghost" onClick=${p.onClose}>Cancel<//>
      </div>
    <//>`;
  }

  function DetailHeader(p) {
    var React = R();
    var c = p.campaign, tick = p.tick;
    var cs = React.useState(false), confirmEnd = cs[0], setConfirmEnd = cs[1];
    var es = React.useState(null), err = es[0], setErr = es[1];
    var IC = MC.ui && MC.ui.InlineConfirm;
    function status(st) { var r = dispatch('campaign/setStatus', { id: c.id, status: st }); setErr(r.ok ? null : (r.error || 'That didn’t work.')); }
    var aId = agentIdOf(c.updatedBy);
    var actions = [];
    if (c.status === 'draft') {
      actions.push(h`<${Btn} key="plan" kind="primary" id="cmp-continue" onClick=${function () { continuePlanning(c); }}>Continue planning<//>`);
      actions.push(h`<${Btn} key="sch" kind="secondary" id="cmp-schedule-open" onClick=${p.onSchedule}>Schedule${ELL}<//>`);
    } else if (c.status === 'scheduled') {
      actions.push(h`<${Btn} key="edit" kind="secondary" id="cmp-edit-open" onClick=${p.onEdit}>Edit brief<//>`);
      actions.push(h`<${Btn} key="un" kind="ghost" id="cmp-unschedule" onClick=${function () { status('draft'); }}>Move back to draft<//>`);
    } else if (c.status === 'live' || c.status === 'paused') {
      actions.push(h`<${Btn} key="edit" kind="ghost" id="cmp-edit-open" onClick=${p.onEdit}>Edit brief<//>`);
      actions.push(c.status === 'live'
        ? h`<${Btn} key="pause" kind="secondary" id="cmp-pause" onClick=${function () { status('paused'); }}>Pause campaign<//>`
        : h`<${Btn} key="resume" kind="primary" id="cmp-resume" onClick=${function () { status('live'); }}>Resume<//>`);
      if (!confirmEnd) actions.push(h`<${Btn} key="end" kind="ghost" id="cmp-end" onClick=${function () { setConfirmEnd(true); }}>End campaign${ELL}<//>`);
    } else {
      actions.push(h`<${Btn} key="dup" kind="secondary" id="cmp-duplicate" onClick=${function () { duplicateBrief(c); }}>Duplicate brief<//>`);
    }
    return h`<header className="cm-detail-head">
      <${Link} className="cm-back" id="cmp-back" onClick=${function () { setFocus({ mode: p.backMode || 'board', id: null }); }}>${LARR} Campaigns<//>
      <div className="cm-detail-titlerow">
        <div className="cm-detail-titles">
          <h1 id="page-title" tabIndex="-1" className="cm-h1">${c.name}</h1>
          <p className="cm-detail-meta">
            <${Status} status=${c.status} />
            <span className="num">${dateRange(c.startTick, c.endTick)}</span>
            <span>${GOAL_LABEL[c.goal.type] || c.goal.type} goal ${goalFmt(c.goal.type, c.goal.target, true)}</span>
            ${aId ? h`<${AgentNote} text=${'Changed by ' + agentName(aId) + ', ' + rel(c.updatedTick, tick)} />` : null}
          </p>
        </div>
        <div className="cm-row cm-detail-actions">${actions}</div>
      </div>
      ${confirmEnd && IC ? h`<${IC} id="cmp-end-confirm" tone="crit" message=${'End “' + c.name + '” now? Sends and ad spend stop today. This can’t be reopened.'}
          confirmLabel="End campaign" cancelLabel="Keep running"
          onConfirm=${function () { setConfirmEnd(false); status('completed'); }} onCancel=${function () { setConfirmEnd(false); }} />` : null}
      <${Msg} text=${err} tone="crit" />
    </header>`;
  }

  /* ---------------- Overview ---------------- */
  function Figure(p) {
    return h`<div className="cm-fig">
      <span className="cm-fig-label">${p.label}</span>
      <span className="cm-fig-value num">${p.value}</span>
      ${p.sub ? h`<span className="cm-fig-sub num">${p.sub}</span>` : null}
      ${p.children || null}
    </div>`;
  }

  function Leaderboard(p) {
    var React = R();
    var c = p.campaign;
    var chs = c.channels;
    var ss = React.useState(chs[0]), ch = chs.indexOf(ss[0]) >= 0 ? ss[0] : chs[0], setCh = ss[1];
    var sel = React.useCallback(function (w) { return call('variantStats', w, c.id, ch); }, [c.id, ch]);
    var rows = useSel(sel) || EMPTY;
    var Seg = MC.ui && MC.ui.Segmented;
    var AB = MC.ui && MC.ui.AllocationBar;
    var hasPrev = rows.some(function (r) { return r.prevShare != null; });
    var reward = rows[0] && rows[0].reward === 'clicks' ? 'Click/send' : 'Conv/send';
    return h`<div className="cm-board-lb">
      ${Seg && chs.length > 1 ? h`<${Seg} id="cmp-lb-ch" label="Channel" size="sm" value=${ch} onChange=${setCh}
          options=${chs.map(function (x) { return { value: x, label: chLabel(x) }; })} />` : null}
      ${AB && rows.length ? h`<div className="cm-lb-alloc">
          <p className="cm-label">Traffic split${hasPrev ? ' (thin bar shows the split before the last change)' : ''}</p>
          <${AB} parts=${rows.filter(function (r) { return r.status === 'live' || r.share > 0; }).map(function (r) { return { key: r.id, label: 'Variant ' + r.name, share: r.share }; })}
            previous=${hasPrev ? rows.reduce(function (m, r) { m[r.id] = r.prevShare || 0; return m; }, {}) : null} />
        </div>` : null}
      ${rows.length ? h`<div className="k-scroll-x"><table className="cm-table">
        <thead><tr><th scope="col">Variant</th><th scope="col">Author</th><th scope="col" className="is-num">Sends</th>
          <th scope="col" className="is-num">Open</th><th scope="col" className="is-num">Click</th>
          <th scope="col" className="is-num">${reward}</th><th scope="col" className="is-num">Chance best</th></tr></thead>
        <tbody>${rows.map(function (r) {
          var aId = agentIdOf(r.author);
          var rate = r.reward === 'clicks' ? r.clickRate : r.convPerSend;
          return h`<tr key=${r.id}>
            <td><span className="cm-strong">${r.name}</span> ${r.status !== 'live' ? h`<span className="cm-muted cm-small">${r.status}</span>` : null}</td>
            <td>${aId ? h`<${AgentNote} text=${agentName(aId)} />` : h`<span className="cm-muted">You</span>`}</td>
            <td className="is-num num">${num(r.sends)}</td>
            <td className="is-num num">${isOwned(ch) ? pct(r.openRate) : DASH}</td>
            <td className="is-num num">${pct(r.clickRate)}</td>
            <td className="is-num num" title=${r.ci ? '95% interval ' + pct(r.ci[0], 2) + ' to ' + pct(r.ci[1], 2) : ''}>${pct(rate, 2)}${r.ci && r.sends > 0 ? h`<span className="cm-muted cm-small"> ±${pct((r.ci[1] - r.ci[0]) / 2, 2)}</span>` : null}</td>
            <td className="is-num num">${fin(r.pBest) ? pct(r.pBest, 0) : DASH}</td>
          </tr>`;
        })}</tbody>
      </table></div>` : h`<p className="cm-muted">No variants on ${chLabel(ch)} yet.</p>`}
    </div>`;
  }

  function Overview(p) {
    var React = R();
    var c = p.campaign, tick = p.tick;
    var stats = useStats(c.id);
    var t = dayOf(tick);
    var fromDay = Math.max(dayOf(c.startTick), t - 29);
    var toDay = Math.min(t, lastDayOf(c.endTick));
    var metric = GOAL_METRIC[c.goal.type] || 'revenue';
    var seriesSel = React.useCallback(function (w) {
      if (toDay < fromDay) return EMPTY;
      return call('series', w, { metric: metric, campaignIds: [c.id], fromDay: fromDay, toDay: toDay }) || EMPTY;
    }, [c.id, metric, fromDay, toDay]);
    var series = useSel(seriesSel) || EMPTY;
    var markSel = React.useCallback(function (w) { return call('agentMarkers', w, { campaignIds: [c.id], fromDay: fromDay, toDay: toDay }) || EMPTY; }, [c.id, fromDay, toDay]);
    var marks = useSel(markSel) || EMPTY;
    var liftSel = React.useCallback(function (w) { return call('liftVsControl', w, c.id); }, [c.id]);
    var lift = useSel(liftSel);
    var propSel = React.useCallback(function (w) { return call('proposalsFor', w, c.id) || EMPTY; }, [c.id]);
    var props = useSel(propSel) || EMPTY;
    var pending = props.filter(function (x) { return x.status === 'pending'; });
    var applied = props.filter(function (x) { return x.status === 'applied' || x.status === 'auto' || x.status === 'undone'; }).slice(0, 8);
    var LC = chart('LineChart');
    var PC = MC.ui && MC.ui.ProposalCard;
    var Panel = ui('Panel');
    var g = (stats && stats.goal) || null;
    var started = c.status !== 'draft' && c.status !== 'scheduled';
    var markers = React.useMemo(function () {
      var byDay = {}, out = [];
      marks.forEach(function (m) { (byDay[m.day] = byDay[m.day] || []).push(m); });
      Object.keys(byDay).forEach(function (d) {
        var l = byDay[d];
        out.push({ id: 'cmp-mark-' + d, x: Number(d), kind: 'agent', label: l.length === 1 ? l[0].label : l.length + ' agent changes on ' + dayShort(Number(d)) });
      });
      return out;
    }, [marks]);
    var points = series.map(function (s) { return { x: s.day, y: s.value }; });
    var out = outlookOf(g, c.status);
    var paceText = stats && fin(stats.pace) ? (stats.pace > 1.1 ? 'Ahead of plan' : stats.pace < 0.9 ? 'Behind plan' : 'On plan') : null;

    var figures = started && stats ? h`<div className="cm-figs" role="group" aria-label="Campaign results to date">
        <${Figure} label=${GOAL_LABEL[c.goal.type] + ' vs goal'} value=${goalFmt(c.goal.type, g ? g.value : null, true)}
          sub=${'of ' + goalFmt(c.goal.type, c.goal.target, true) + (g && fin(g.projected) && c.status !== 'completed' ? MID + 'projected ' + goalFmt(c.goal.type, g.projected, true) : '')}>
          <${Meter} value=${g ? g.value : 0} max=${Math.max(c.goal.target, (g && g.projected) || 0, (g && g.value) || 0) * 1.05}
            goal=${c.goal.target} ghost=${g && fin(g.projected) ? g.projected : null} tone=${out.tone === 'crit' ? 'crit' : out.tone === 'warn' ? 'warn' : 'accent'}
            label=${GOAL_LABEL[c.goal.type] + ' progress toward goal'} />
        <//>
        <${Figure} label="Conversions" value=${num(stats.conv)} sub=${num(stats.sends) + ' sends'} />
        <${Figure} label="Return on spend" value=${fin(stats.roas) ? ratio(stats.roas) : DASH} sub=${money(stats.cost, true) + ' spent'} />
        <${Figure} label="Spend pace" value=${fin(stats.pace) ? pct(stats.pace, 0) : DASH} sub=${paceText ? paceText + MID + money(c.budget.total, true) + ' budget' : money(c.budget.total, true) + ' budget'} />
      </div>` : null;

    var segs = useSel(React.useCallback(function (w) { return w.segments; }, []));
    var seg = segs && segs.byId ? segs.byId[c.segmentId] : null;
    var briefText = typeof c.brief === 'string' ? c.brief : (c.brief && c.brief.notes) || '';
    var planPanel = h`<${Panel} id="cmp-plan-summary" title="Plan" sub=${c.status === 'draft' ? 'Draft. Agents never change drafts; schedule it when preflight checks pass.' : 'Scheduled. It goes live on ' + dayLabel(dayOf(c.startTick)) + '.'}>
        ${briefText ? h`<p className="cm-brief-text">${briefText}</p>` : null}
        <dl className="cm-facts cm-facts-plain">
          <div className="cm-fact"><dt>Goal</dt><dd className="num">${goalFmt(c.goal.type, c.goal.target, true)}${c.goal.type === 'revenue' ? '' : ' ' + (GOAL_NOUN[c.goal.type] || '')}</dd></div>
          <div className="cm-fact"><dt>Budget</dt><dd className="num">${money(c.budget.total, true)}</dd></div>
          <div className="cm-fact"><dt>Audience</dt><dd className="cm-fact-text">${seg ? seg.name : 'Not set'}</dd></div>
          <div className="cm-fact"><dt>Runs</dt><dd className="cm-fact-text num">${plural(Math.max(1, dayOf(c.endTick) - dayOf(c.startTick)), 'day', 'days')}</dd></div>
        </dl>
        <p className="cm-muted cm-small cm-gap-top">${chList(c.channels)}${MID}${toneLabel(c.tone)} tone${MID}${offerLabel(c.offer)}</p>
      <//>`;
    if (!started) {
      return h`<div className="cm-overview">
        <div className="cm-ov-main">${planPanel}</div>
        <aside className="cm-ov-side" aria-label="Agents on this campaign">
          <section className="cm-side-sec"><h2 className="cm-h3">Agents</h2>
            <p className="cm-muted cm-small">${c.status === 'draft' ? 'Agents never change drafts. Once the campaign is live they tune send times, traffic splits and budget within your guardrails.' : 'Agents start tuning send times, traffic splits and budget once the campaign is live.'}</p>
          </section>
        </aside>
      </div>`;
    }
    return h`<div className="cm-overview">
      <div className="cm-ov-main">
        <${Panel} id="cmp-results" title="Results" sub=${started ? (out.label + (stats && stats.daysLeft > 0 ? MID + plural(stats.daysLeft, 'day', 'days') + ' left' : '')) : 'Results appear once the campaign goes live on ' + dayLabel(dayOf(c.startTick)) + '.'}>
          ${figures}
          ${started && LC ? h`<div className="cm-chart">
              <${LC} series=${[{ id: 'm', label: GOAL_LABEL[c.goal.type] + ' per day', points: points }]} markers=${markers}
                yFormat=${c.goal.type === 'revenue' ? 'moneyCompact' : 'int'} xFormat=${dayShort} height=${220}
                ariaLabel=${GOAL_LABEL[c.goal.type] + ' per day for ' + c.name} emptyText="Daily results appear after the first full day." />
            </div>` : null}
        <//>
        <${Panel} id="cmp-variants" title="Variant leaderboard" sub="Variant Optimizer shifts traffic toward the leader within your guardrails.">
          <${Leaderboard} campaign=${c} />
        <//>
      </div>
      <aside className="cm-ov-side" aria-label="Agent activity on this campaign">
        ${pending.length ? h`<section className="cm-side-sec" aria-labelledby="cmp-pending-title">
            <h2 className="cm-h3" id="cmp-pending-title">Waiting for you <span className="cm-count num">${pending.length}</span></h2>
            <ul className="cm-prop-list">${pending.map(function (pr) {
              return h`<li key=${pr.id}>${PC ? h`<${PC} id=${pr.id} compact=${true} />` : h`<p>${pr.title}</p>`}</li>`;
            })}</ul>
          </section>` : null}
        <section className="cm-side-sec" aria-labelledby="cmp-changes-title">
          <h2 className="cm-h3" id="cmp-changes-title">Agent changes</h2>
          ${applied.length ? h`<ol className="cm-timeline">${applied.map(function (pr) {
            return h`<li key=${pr.id}>
              <${AgentNote} text=${agentName(pr.agentId) + MID + rel(pr.appliedTick, tick)} />
              <p className=${cx('cm-tl-title', pr.status === 'undone' && 'is-undone')}>${pr.title}</p>
              ${pr.status === 'undone' ? h`<span className="cm-muted cm-small">Undone</span>` : null}
            </li>`;
          })}</ol>` : h`<p className="cm-muted cm-small">${c.status === 'draft' ? 'Agents never change drafts. They start once the campaign is live.' : 'No agent changes yet.'}</p>`}
        </section>
        <section className="cm-side-sec" aria-labelledby="cmp-lift-title">
          <h2 className="cm-h3" id="cmp-lift-title">Control group lift</h2>
          ${lift && fin(lift.lift) ? h`<p className="cm-lift num"><strong>${delta(lift.lift)}</strong> ${lift.metric} vs control
              <span className="cm-muted">(${delta(lift.lo)} to ${delta(lift.hi)})</span></p>
              <p className="cm-muted cm-small num">${num(lift.trt.n)} treated sends, ${num(lift.ctl.n)} control sends. The control group follows your original plan without agent changes.</p>`
            : h`<p className="cm-muted cm-small">Lift appears after the control group (${(c.holdoutPct != null ? c.holdoutPct : 10)}% of the audience) receives 100 sends.</p>`}
        </section>
      </aside>
    </div>`;
  }

  /* ---------------- Journey ---------------- */
  function Journey(p) {
    var React = R();
    var c = p.campaign;
    var H = MC.hooks || {};
    var steps = c.journey && c.journey.steps ? c.journey.steps : EMPTY;
    var draft = H.useDraft ? H.useDraft(steps) : { value: steps, set: function () {}, dirty: false };
    var ss = React.useState(null), selId = ss[0], setSel = ss[1];
    var es = React.useState(null), msg = es[0], setMsg = es[1];
    var statsSel = React.useCallback(function (w) { return call('journeyStats', w, c.id) || EMPTY_OBJ; }, [c.id]);
    var stats = useSel(statsSel) || EMPTY_OBJ;
    var FD = chart('FlowDiagram');
    var readOnly = c.status === 'completed';
    var tags = React.useMemo(function () {
      var out = {};
      (draft.value || EMPTY).forEach(function (s) {
        if (s.type !== 'send' || !s.channel) return;
        var hr = c.sendHour && c.sendHour[s.channel], base = c.ctl && c.ctl.sendHour ? c.ctl.sendHour[s.channel] : hr;
        if (hr === 'adaptive') out[s.id] = { agentId: 'sendtime', text: 'Adaptive send time' };
        else if (hr !== undefined && base !== undefined && hr !== base) out[s.id] = { agentId: 'sendtime', text: 'Send-Time Tuner: ' + hourLabel(hr) };
      });
      return out;
    }, [draft.value, c.sendHour, c.ctl]);
    var sel = (draft.value || EMPTY).filter(function (s) { return s.id === selId; })[0] || null;
    function patchStep(id, patch) {
      draft.set(function (list) { return list.map(function (s) { return s.id === id ? Object.assign({}, s, patch) : s; }); });
    }
    function save() {
      var r = dispatch('campaign/setJourney', { id: c.id, steps: draft.value });
      if (r.ok) { if (draft.commit) draft.commit(); setMsg({ tone: 'good', text: 'Journey saved.' }); }
      else setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the journey.' });
    }
    var Chip = MC.ui && MC.ui.ConflictChip;
    var NI = ui('NumberInput'), Field = ui('Field');
    var variants = useSel(React.useCallback(function (w) { return w.variants; }, []));
    var Panel = ui('Panel');
    function inspector() {
      if (!sel) return h`<p className="cm-muted">Select a step to see its settings.</p>`;
      var st = stats[sel.id] || {};
      var rows = [];
      rows.push(h`<p key="k" className="cm-label">${sel.type === 'send' ? 'Send' : sel.type === 'wait' ? 'Wait' : sel.type === 'decide' ? 'Decision' : sel.type === 'entry' ? 'Entry' : 'Exit'}</p>`);
      rows.push(h`<h3 key="t" className="cm-h3">${sel.label || sel.id}</h3>`);
      rows.push(h`<p key="s" className="cm-muted cm-small num">${num(st.inStep || 0)} people on this step${MID}${num(st.sentToday || 0)} sent today</p>`);
      if (sel.type === 'wait') {
        rows.push(h`<${Field} key="w" id="cmp-step-wait" label="Wait (hours)" hint="Between 1 hour and 14 days.">
          <${NI} id="cmp-step-wait" value=${sel.waitH} min=${1} max=${336} step=${1} disabled=${readOnly}
            onChange=${function (x) { if (fin(x)) patchStep(sel.id, { waitH: Math.max(1, Math.min(336, Math.round(x))) }); }} /><//>`);
      }
      if (sel.type === 'send' && sel.channel) {
        var hr = c.sendHour ? c.sendHour[sel.channel] : undefined;
        var vs = variants && variants.byId ? Object.keys(variants.byId).map(function (k) { return variants.byId[k]; })
          .filter(function (v) { return v.campaignId === c.id && v.channel === sel.channel && v.status !== 'retired'; }) : EMPTY;
        rows.push(h`<dl key="d" className="cm-dl">
          <dt>Channel</dt><dd>${chLabel(sel.channel)}</dd>
          ${isOwned(sel.channel) ? h`<dt>Send time</dt><dd>${hourLabel(hr)}${tags[sel.id] ? h` <${AgentNote} text=${tags[sel.id].text} />` : null}</dd>` : null}
          <dt>Variants</dt><dd>${vs.length ? vs.map(function (v) { return v.name; }).join(', ') : 'None yet'}</dd>
        </dl>`);
      }
      if (sel.type === 'decide' && sel.rule) {
        var RL = { opened: 'Opened the last message', clicked: 'Clicked the last message', purchased: 'Purchased since entering', consent: 'Has consent', propensityAbove: 'Likely to buy', bestChannel: 'Best channel' };
        rows.push(h`<dl key="r" className="cm-dl"><dt>Rule</dt><dd>${RL[sel.rule.kind] || sel.rule.kind}</dd>
          ${fin(st.yesPct) ? h`<dt>Yes / no</dt><dd className="num">${pct(st.yesPct, 0)} / ${pct(st.noPct, 0)}</dd>` : null}</dl>`);
        if (sel.rule.kind === 'propensityAbove') {
          rows.push(h`<${Field} key="pv" id="cmp-step-prop" label="Minimum likelihood to buy (%)">
            <${NI} id="cmp-step-prop" value=${Math.round((sel.rule.value || 0) * 100)} min=${1} max=${99} step=${1} disabled=${readOnly}
              onChange=${function (x) { if (fin(x)) patchStep(sel.id, { rule: Object.assign({}, sel.rule, { value: Math.max(1, Math.min(99, x)) / 100 }) }); }} /><//>`);
        }
      }
      return rows;
    }
    return h`<div className="cm-journey">
      <${Panel} id="cmp-journey" title="Journey" sub=${c.status === 'live' || c.status === 'paused' ? 'Changes apply to people entering a step after you save.' : 'Select a step to adjust it.'}
        actions=${readOnly ? null : h`<div className="cm-row">
          <${Btn} kind="primary" id="cmp-journey-save" disabled=${!draft.dirty} onClick=${save}>Save journey<//>
          <${Btn} kind="ghost" id="cmp-journey-discard" disabled=${!draft.dirty} onClick=${function () { if (draft.reset) draft.reset(); setMsg(null); }}>Discard<//>
        </div>`}>
        ${draft.conflict && Chip ? h`<${Chip} agentId=${agentIdOf(c.updatedBy) || 'user'} onTheirs=${draft.takeTheirs} onMine=${draft.keepMine} />` : null}
        ${msg ? h`<${Msg} text=${msg.text} tone=${msg.tone} />` : null}
        <div className="cm-journey-grid">
          <div className="cm-journey-flow">
            ${FD ? h`<${FD} steps=${draft.value} stats=${stats} tags=${tags} selectedId=${selId} onSelect=${function (id) { setSel(id); }}
                ariaLabel=${'Journey for ' + c.name} />` : h`<p className="cm-muted">The journey diagram appears once the chart library has loaded.</p>`}
          </div>
          <div className="cm-inspector" aria-live="off">${inspector()}</div>
        </div>
      <//>
    </div>`;
  }

  /* ---------------- Content ---------------- */
  function hookText(v) {
    var f = v.fields || {};
    var key = MC.copy && MC.copy.HOOK ? MC.copy.HOOK[v.channel] : null;
    return f[key] || f.subject || f.sms || f.pushTitle || f.socialHeadline || f.headline || f.body || '';
  }
  function ContentTab(p) {
    var React = R();
    var c = p.campaign;
    var variants = useSel(React.useCallback(function (w) { return w.variants; }, []));
    var Ring = chart('ScoreRing');
    var list = variants && variants.byId ? Object.keys(variants.byId).sort().map(function (k) { return variants.byId[k]; })
      .filter(function (v) { return v.campaignId === c.id && v.status !== 'retired'; }) : EMPTY;
    var Panel = ui('Panel');
    return h`<div className="cm-content">
      ${c.channels.map(function (ch) {
        var vs = list.filter(function (v) { return v.channel === ch; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        var share = (c.alloc && c.alloc[ch]) || EMPTY_OBJ;
        return h`<${Panel} key=${ch} id=${'cmp-content-' + ch} title=${chLabel(ch)}
            actions=${c.status !== 'completed' ? h`<${Btn} kind="ghost" size="sm" id=${'cmp-content-' + ch + '-new'} onClick=${function () { go('content', { variantId: null, channel: ch }); }}>New variant<//>` : null}>
          ${vs.length ? h`<ul className="cm-vlist">${vs.map(function (v) {
            var aId = agentIdOf(v.author);
            return h`<li key=${v.id} className="cm-vrow">
              ${Ring && v.predicted && fin(v.predicted.score) ? h`<${Ring} value=${v.predicted.score} size=${40} label=${'Predicted engagement ' + Math.round(v.predicted.score)} />` : h`<span className="cm-ring-empty" aria-hidden="true"></span>`}
              <div className="cm-vbody">
                <p className="cm-vtitle"><span className="cm-strong">Variant ${v.name}</span>${MID}<span className="cm-muted">${v.status === 'live' ? pct(share[v.id] || 0, 0) + ' of traffic' : v.status}</span></p>
                <p className="cm-vhook">${hookText(v) || h`<span className="cm-muted">No copy yet</span>`}</p>
                ${aId ? h`<${AgentNote} text=${'Drafted by ' + agentName(aId)} />` : null}
              </div>
              <${Link} id=${'cmp-open-' + v.id} onClick=${function () { go('content', { variantId: v.id, channel: v.channel }); }}>Open in Content Studio<//>
            </li>`;
          })}</ul>` : h`<p className="cm-muted">${isOwned(ch) ? 'No variants yet. Scheduling needs at least one.' : 'No creative yet. Ads run with generic creative until you add one.'}</p>`}
        <//>`;
      })}
    </div>`;
  }

  /* ---------------- Audience ---------------- */
  var traitsCache = { key: null, value: null };
  function segTraits(w, s) {
    if (!w || !s || !MC.segments || !has(MC.segments, 'members') || !has(MC.segments, 'traits')) return null;
    var key = s.id + '|' + s.ver + '|' + (w.rev ? w.rev.segCounts : 0);
    if (traitsCache.key === key) return traitsCache.value;
    var v = null;
    try { var bits = MC.segments.members(w, s.id); v = bits ? MC.segments.traits(w, bits) : null; } catch (e) { v = null; }
    traitsCache.key = key; traitsCache.value = v;
    return v;
  }
  function AudienceTab(p) {
    var React = R();
    var c = p.campaign, tick = p.tick;
    var segments = useSel(React.useCallback(function (w) { return w.segments; }, []));
    var segRev = useSel(React.useCallback(function (w) { return w.rev ? w.rev.segCounts : 0; }, []));
    var propSel = React.useCallback(function (w) { return call('proposalsFor', w, c.id) || EMPTY; }, [c.id]);
    var props = useSel(propSel) || EMPTY;
    var ps = React.useState(c.segmentId || ''), pick = ps[0], setPick = ps[1];
    var es = React.useState(null), msg = es[0], setMsg = es[1];
    var byId = (segments && segments.byId) || EMPTY_OBJ;
    var s = byId[c.segmentId] || null;
    var tr = React.useMemo(function () { return segTraits(getWorld(), s); }, [s, segRev]);
    var Sel = ui('Select'), Field = ui('Field'), Panel = ui('Panel');
    var editable = c.status !== 'completed';
    function act(type, payload, okText) {
      var r = dispatch(type, payload);
      setMsg(r.ok ? { tone: 'good', text: okText } : { tone: 'crit', text: r.error || 'That didn’t work.' });
    }
    // Agent-held suppressions on this campaign: applied Fatigue Guard proposals with profile suppressions.
    var holds = [];
    props.forEach(function (pr) {
      if (pr.status !== 'applied' && pr.status !== 'auto') return;
      (pr.actions || EMPTY).forEach(function (a, k) {
        if (a.type === 'profiles/suppress' && a.payload && (a.payload.untilTick || 0) > tick) {
          holds.push({ key: pr.id + '-' + k, agentId: pr.agentId, channel: a.payload.channel, idx: a.payload.idx || EMPTY, until: a.payload.untilTick, title: pr.title });
        }
      });
    });
    var segOptions = (segments ? segments.order : EMPTY).map(function (id) { var x = byId[id]; return x ? { value: id, label: x.name + ' (' + num(x.count) + ')' } : null; }).filter(Boolean);
    var reach = tr && tr.reach ? tr.reach : null;
    return h`<div className="cm-audience">
      <${Panel} id="cmp-audience" title=${s ? s.name : 'No audience yet'} sub=${s ? plural(s.count, 'person', 'people') + ' today' + (c.include && c.include.length ? ', plus ' + plural(c.include.length, 'extra segment', 'extra segments') : '') : 'Pick a segment so the campaign has someone to reach.'}>
        ${s && tr ? h`<dl className="cm-facts">
            ${reach ? ['email', 'sms', 'push', 'ads'].map(function (k) {
              return h`<div key=${k} className="cm-fact"><dt>${k === 'ads' ? 'Ads' : chLabel(k)} reach</dt><dd className="num">${num(reach[k])}</dd></div>`;
            }) : null}
            <div className="cm-fact"><dt>Likely to buy</dt><dd className="num">${pct(tr.meanProp, 0)}</dd></div>
            <div className="cm-fact"><dt>Predicted lifetime value</dt><dd className="num">${money(tr.meanLtv)}</dd></div>
          </dl>` : null}
        ${editable ? h`<div className="cm-row cm-align-end cm-gap-top">
            <${Field} id="cmp-seg-pick" label="Change segment">
              <${Sel} id="cmp-seg-pick" value=${pick} options=${segOptions} placeholder="Pick a segment" onChange=${setPick} />
            <//>
            <${Btn} kind="secondary" id="cmp-seg-apply" disabled=${!pick || pick === c.segmentId}
              onClick=${function () { act('campaign/setSegment', { id: c.id, segmentId: pick }, 'Audience updated. New members join at the start of the next day.'); }}>Use this segment<//>
            <${Link} onClick=${function () { go('audiences', { tab: 'segments', segmentId: c.segmentId }); }}>Open in Audiences<//>
          </div>` : null}
        ${msg ? h`<${Msg} text=${msg.text} tone=${msg.tone} />` : null}
      <//>
      ${(c.include || EMPTY).length ? h`<${Panel} id="cmp-include" title="Also included" sub="Extra segments whose members join this campaign.">
          <ul className="cm-rows">${c.include.map(function (sid) {
            var x = byId[sid];
            var who = x ? agentIdOf(x.author) : null;
            return h`<li key=${sid} className="cm-rowline">
              <span>${x ? x.name : sid}</span><span className="cm-muted num">${x ? num(x.count) : ''}</span>
              ${who ? h`<${AgentNote} text=${'Suggested by ' + agentName(who)} />` : null}
              ${editable ? h`<${Link} onClick=${function () { act('campaign/include', { id: c.id, segmentId: sid, on: false }, 'Segment removed from this campaign.'); }}>Remove<//>` : null}
            </li>`;
          })}</ul>
        <//>` : null}
      <${Panel} id="cmp-suppress" title="Exclusions" sub="People here are never sent this campaign.">
        ${(c.suppress || EMPTY).length ? h`<ul className="cm-rows">${c.suppress.map(function (sid) {
          var x = byId[sid];
          return h`<li key=${sid} className="cm-rowline">
            <span>${x ? x.name : sid}</span><span className="cm-muted num">${x ? num(x.count) : ''}</span>
            ${editable ? h`<${Link} onClick=${function () { act('campaign/suppress', { id: c.id, segmentId: sid, on: false }, 'Exclusion removed.'); }}>Stop excluding<//>` : null}
          </li>`;
        })}</ul>` : h`<p className="cm-muted cm-small">No segments excluded.</p>`}
        <h3 className="cm-h3 cm-gap-top">Held by agents</h3>
        ${holds.length ? h`<ul className="cm-rows">${holds.map(function (x) {
          return h`<li key=${x.key} className="cm-rowline">
            <${AgentNote} text=${agentName(x.agentId)} title=${x.title} />
            <span className="num">${plural(x.idx.length, 'person', 'people')} on ${chLabel(x.channel)} until ${dayShort(dayOf(x.until))}</span>
            ${editable ? h`<${Link} onClick=${function () { act('profiles/release', { channel: x.channel, idx: x.idx }, 'Released. They can receive this channel again.'); }}>Release<//>` : null}
          </li>`;
        })}</ul>` : h`<p className="cm-muted cm-small">Fatigue Guard hasn’t paused anyone on this campaign.</p>`}
      <//>
    </div>`;
  }

  /* ---------------- Budget ---------------- */
  function channelDaily(w, cid, ch) {
    var out = [], F = MC.F || { REV: 5, COST: 6 };
    var days = (w.metrics && w.metrics.days) || EMPTY;
    for (var i = 0; i < days.length; i++) {
      var cd = days[i].c && days[i].c[cid], f = cd && cd.ch && cd.ch[ch];
      if (f && f[F.COST] > 0) out.push({ spend: f[F.COST], revenue: f[F.REV] });
    }
    return out;
  }
  function BudgetTab(p) {
    var React = R();
    var c = p.campaign;
    var H = MC.hooks || {};
    var stats = useStats(c.id);
    var metricsRev = useSel(React.useCallback(function (w) { return w.rev ? w.rev.metrics : 0; }, []));
    var source = React.useMemo(function () { return Object.assign({}, c.budget.byChannel); }, [c.budget]);
    var draft = H.useDraft ? H.useDraft(source) : { value: source, set: function () {}, dirty: false };
    var es = React.useState(null), msg = es[0], setMsg = es[1];
    var curves = React.useMemo(function () {
      var w = getWorld(), out = {};
      if (!w || !MC.models || !has(MC.models, 'fitResponse')) return out;
      c.channels.forEach(function (ch) {
        if (isOwned(ch)) return;
        try { out[ch] = MC.models.fitResponse(channelDaily(w, c.id, ch)); } catch (e) { /* skip */ }
      });
      return out;
    }, [c.id, c.channels, metricsRev]);
    var NI = ui('NumberInput'), Panel = ui('Panel');
    var RC = chart('ResponseCurve');
    var editable = c.status !== 'completed';
    var total = c.channels.reduce(function (s, ch) { return s + (Number(draft.value[ch]) || 0); }, 0);
    function save() {
      var by = {};
      c.channels.forEach(function (ch) { by[ch] = Math.max(0, Number(draft.value[ch]) || 0); });
      var r = dispatch('campaign/setBudget', { id: c.id, byChannel: by });
      if (r.ok) { if (draft.commit) draft.commit(); setMsg({ tone: 'good', text: 'Budget saved.' }); }
      else setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the budget.' });
    }
    var Chip = MC.ui && MC.ui.ConflictChip;
    var daysLeft = stats ? stats.daysLeft : 0;
    var paid = c.channels.filter(function (ch) { return !isOwned(ch); });
    return h`<div className="cm-budget">
      <${Panel} id="cmp-budget" title="Budget by channel" sub=${'Total ' + money(total) + (draft.dirty ? ' (unsaved)' : '') + (daysLeft > 0 ? MID + plural(daysLeft, 'day', 'days') + ' left' : '')}
        actions=${editable ? h`<div className="cm-row">
          <${Btn} kind="primary" id="cmp-budget-save" disabled=${!draft.dirty} onClick=${save}>Save budget<//>
          <${Btn} kind="ghost" id="cmp-budget-discard" disabled=${!draft.dirty} onClick=${function () { if (draft.reset) draft.reset(); setMsg(null); }}>Discard<//>
        </div>` : null}>
        ${draft.conflict && Chip ? h`<${Chip} agentId=${agentIdOf(c.updatedBy) || 'pacer'} onTheirs=${draft.takeTheirs} onMine=${draft.keepMine} />` : null}
        ${msg ? h`<${Msg} text=${msg.text} tone=${msg.tone} />` : null}
        <div className="k-scroll-x"><table className="cm-table">
          <thead><tr><th scope="col">Channel</th><th scope="col">Budget</th><th scope="col" className="is-num">Spent</th>
            <th scope="col" className="is-num">Per day now</th><th scope="col" className="is-num">Next $1 returns</th></tr></thead>
          <tbody>${c.channels.map(function (ch) {
            var spent = stats && stats.spentByCh ? stats.spentByCh[ch] : 0;
            var daily = stats && stats.dailyBudgetByCh ? stats.dailyBudgetByCh[ch] : null;
            var cv = curves[ch], marg = null;
            if (cv && MC.models && has(MC.models, 'marginal') && fin(daily) && daily > 0) { try { marg = MC.models.marginal(cv, daily); } catch (e) { marg = null; } }
            return h`<tr key=${ch}>
              <th scope="row">${chLabel(ch)}</th>
              <td>${editable ? h`<${NI} id=${'cmp-budget-' + ch} label=${chLabel(ch) + ' budget'} value=${draft.value[ch]} min=${0} step=${100} size="sm"
                  onChange=${function (x) { draft.set(function (d) { var n = Object.assign({}, d); n[ch] = fin(x) ? x : 0; return n; }); }} />`
                : h`<span className="num">${money(c.budget.byChannel[ch])}</span>`}</td>
              <td className="is-num num">${money(spent)}</td>
              <td className="is-num num">${fin(daily) && daily > 0 ? money(daily) : DASH}</td>
              <td className="is-num num">${fin(marg) ? '$' + marg.toFixed(2) : DASH}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <p className="cm-muted cm-small">Budget Pacer may move money between paid channels while keeping the total. Owned channels cost a few cents per send.</p>
      <//>
      ${paid.length && RC ? h`<${Panel} id="cmp-curves" title="Response curves" sub="Estimated daily revenue at each level of daily spend, fitted from this campaign’s results.">
          <div className="cm-curves">${paid.map(function (ch) {
            var cv = curves[ch];
            var daily = stats && stats.dailyBudgetByCh ? stats.dailyBudgetByCh[ch] : 0;
            return h`<div key=${ch} className="cm-curve"><h3 className="cm-h3">${chLabel(ch)}</h3>
              ${cv && fin(cv.A) ? h`<${RC} curve=${cv} current=${daily} height=${150} label=${chLabel(ch) + ' response curve'} />`
                : h`<p className="cm-muted cm-small">Not enough spend yet to fit a curve.</p>`}
            </div>`;
          })}</div>
        <//>` : null}
    </div>`;
  }

  /* ---------------- Activity ---------------- */
  function ActivityTab(p) {
    var React = R();
    var c = p.campaign, tick = p.tick;
    var sel = React.useCallback(function (w) { return call('feed', w, { entityId: c.id }) || EMPTY; }, [c.id]);
    var feed = useSel(sel) || EMPTY;
    var hs = React.useState(false), held = hs[0], setHeld = hs[1];
    var H = MC.hooks || {};
    var fr = H.useFrozen ? H.useFrozen(feed, { key: 'id', freeze: held }) : { items: feed, pending: 0, reveal: function () {} };
    var NP = MC.ui && MC.ui.NewItemsPill;
    var Panel = ui('Panel');
    var items = fr.items.slice(0, 60);
    return h`<${Panel} id="cmp-activity" title="Activity" sub="Everything you and the agents changed on this campaign, newest first.">
      ${fr.pending > 0 ? (NP ? h`<${NP} count=${fr.pending} onClick=${fr.reveal} />` : h`<${Link} onClick=${fr.reveal}>${fr.pending} new<//>`) : null}
      ${items.length ? h`<ol className="cm-feed" onMouseEnter=${function () { setHeld(true); }} onMouseLeave=${function () { setHeld(false); }}
          onFocus=${function () { setHeld(true); }} onBlur=${function (e) { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}>
        ${items.map(function (it) {
          return h`<li key=${it.id} className="cm-feed-item">
            <span className="cm-feed-when num">${rel(it.tick, tick)}</span>
            <div className="cm-feed-body">
              ${it.agentId ? h`<${AgentNote} text=${agentName(it.agentId)} />` : null}
              <p className="cm-feed-text">${it.text}</p>
              ${it.agentId && fin(it.tick) ? h`<${Link} onClick=${function () { go('agents', { tab: 'activity', agentId: it.agentId, auditId: 'run-' + it.agentId + '-' + it.tick }); }}>How it decided<//>` : null}
            </div>
          </li>`;
        })}
      </ol>` : h`<p className="cm-muted">Nothing has happened on this campaign yet.</p>`}
    <//>`;
  }

  function Detail(p) {
    var React = R();
    var focus = p.focus || {};
    var c = useCampaign(focus.id);
    var tick = useSel(selTick) || 0;
    var ms = React.useState(null), panel = ms[0], setPanel = ms[1];
    var Tabs = ui('Tabs');
    React.useEffect(function () {
      if (focus.schedule) { setPanel('schedule'); setFocus({ schedule: false }); }
    }, [focus.schedule]);
    if (!c) {
      return h`<div className="cm-missing">
        <${Link} className="cm-back" onClick=${function () { setFocus({ mode: 'board', id: null }); }}>${LARR} Campaigns<//>
        <h1 id="page-title" tabIndex="-1" className="cm-h1">Campaign not found</h1>
        <p className="cm-muted">This item was removed (by your undo), or it never existed.</p>
      </div>`;
    }
    var tab = DETAIL_TABS.some(function (t) { return t.id === focus.tab; }) ? focus.tab : 'overview';
    var body;
    if (tab === 'journey') body = h`<${Journey} key=${c.id} campaign=${c} />`;
    else if (tab === 'content') body = h`<${ContentTab} campaign=${c} />`;
    else if (tab === 'audience') body = h`<${AudienceTab} key=${c.id} campaign=${c} tick=${tick} />`;
    else if (tab === 'budget') body = h`<${BudgetTab} key=${c.id} campaign=${c} />`;
    else if (tab === 'activity') body = h`<${ActivityTab} campaign=${c} tick=${tick} />`;
    else body = h`<${Overview} campaign=${c} tick=${tick} />`;
    return h`<div className="cm-detail">
      <${DetailHeader} campaign=${c} tick=${tick} backMode=${p.backMode}
        onSchedule=${function () { setPanel(panel === 'schedule' ? null : 'schedule'); }}
        onEdit=${function () { setPanel(panel === 'edit' ? null : 'edit'); }} />
      ${panel === 'schedule' && c.status === 'draft' ? h`<${SchedulePanel} campaign=${c} onClose=${function () { setPanel(null); }} />` : null}
      ${panel === 'edit' && c.status !== 'draft' ? h`<${EditDetails} key=${c.id} campaign=${c} onClose=${function () { setPanel(null); }} />` : null}
      <${Tabs} id="cmp-tabs" label="Campaign sections" tabs=${DETAIL_TABS} value=${tab} panelId="cmp-tabpanel"
        onChange=${function (t) { setFocus({ tab: t }); }} />
      <div id="cmp-tabpanel" role="tabpanel" aria-labelledby=${'cmp-tabs-' + tab} className="cm-tabpanel">${body}</div>
    </div>`;
  }

  /* ================================================================
     Planner
     ================================================================ */
  // Survives navigation for the session (never persisted, never in the world).
  var briefOwner = { id: null };
  var planMemo = { plan: null, key: null, accepted: {}, edits: {}, regen: {}, fallback: false, draftedTick: null, trace: EMPTY };
  var SECTIONS = [
    { id: 'audience', n: 1, label: 'Audience', editable: true },
    { id: 'budget', n: 2, label: 'Channels & budget', editable: true },
    { id: 'journey', n: 3, label: 'Journey', editable: false },
    { id: 'content', n: 4, label: 'Content', editable: true },
    { id: 'forecast', n: 5, label: 'Forecast', editable: false, derived: true },
    { id: 'preflight', n: 6, label: 'Preflight checks', editable: false, derived: true }
  ];

  function plannerAvailable() {
    try { return !!(MC.runtime && has(MC.runtime, 'preview') && has(MC.runtime, 'def') && MC.runtime.def('planner')); } catch (e) { return false; }
  }
  function runPlanner(brief, regen, draftId) {
    if (!plannerAvailable()) return { plan: null, trace: EMPTY, error: null };
    try {
      var out = MC.runtime.preview('planner', { brief: clone(brief), regen: regen || {}, draftId: draftId || undefined });
      return { plan: out && out.plan ? out.plan : null, trace: (out && out.trace) || EMPTY, error: null };
    } catch (e) { return { plan: null, trace: EMPTY, error: String((e && e.message) || e) }; }
  }
  // Neutral fallback when the planner is not available: the brief as a plain draft, no recommendations.
  function basicPayload(brief) {
    var by = {}, chs = brief.channels || EMPTY, paid = chs.filter(function (ch) { return !isOwned(ch); });
    chs.forEach(function (ch) { by[ch] = 0; });
    var budget = fin(brief.budget) ? brief.budget : 0;
    if (paid.length) { var ownedShare = Math.min(budget * 0.1, 200 * (chs.length - paid.length)); chs.forEach(function (ch) { by[ch] = isOwned(ch) ? Math.round(ownedShare / Math.max(1, chs.length - paid.length)) : Math.round((budget - ownedShare) / paid.length); }); }
    else chs.forEach(function (ch) { by[ch] = Math.round(budget / Math.max(1, chs.length)); });
    var variants = [];
    if (MC.copy && has(MC.copy, 'generate')) {
      chs.forEach(function (ch) {
        try {
          var vs = MC.copy.generate({ channel: ch, tone: brief.tone, productId: brief.productFocus, offer: brief.offer, count: isOwned(ch) ? 2 : 1, seedKey: 'basic:' + brief.name + ':' + ch });
          (vs || EMPTY).forEach(function (v) { variants.push({ channel: ch, name: v.name, fields: v.fields, tone: v.tone, offer: v.offer, productId: v.productId, predicted: v.predicted }); });
        } catch (e) { /* no copy */ }
      });
    }
    return {
      campaign: {
        name: String(brief.name || '').trim(), goal: { type: brief.goal.type, target: brief.goal.target },
        startTick: tickOf(brief.startDay, 9), endTick: tickOf(brief.endDay, 0), segmentId: brief.segmentId || null,
        channels: chs.slice(), productFocus: brief.productFocus || null, tone: brief.tone, offer: brief.offer,
        budget: { total: budget, byChannel: by }, brief: clone(brief)
      },
      variants: variants
    };
  }
  // Applies the marketer's section edits to the planner's payload.
  function finalPayload(plan, edits, brief) {
    var pay = clone(plan.payload) || basicPayload(brief);
    var cp = pay.campaign || {};
    cp.brief = clone(brief);
    var aud = edits.audience;
    if (aud) {
      if (aud.segmentId) { cp.segmentId = aud.segmentId; delete pay.segment; }
      else if (aud.segment) { pay.segment = clone(aud.segment); cp.segmentId = '$1'; }
    }
    if (edits.budget) {
      var by = {}, tot = 0;
      Object.keys(edits.budget).forEach(function (ch) { by[ch] = Math.max(0, Number(edits.budget[ch]) || 0); tot += by[ch]; });
      cp.budget = { total: tot, byChannel: by };
    }
    if (edits.content && pay.variants) {
      pay.variants = pay.variants.map(function (v, k) {
        var key = v.tmpId || ('$v' + k), e = edits.content[key];
        return e ? Object.assign({}, v, { fields: Object.assign({}, v.fields, e) }) : v;
      });
    }
    pay.campaign = cp;
    return pay;
  }

  function BriefForm(p) {
    var b = p.brief, set = p.set, errs = p.errors || EMPTY_OBJ;
    var products = (MC.data && MC.data.PRODUCTS) || EMPTY;
    var TI = ui('TextInput'), NI = ui('NumberInput'), Sel = ui('Select'), TA = ui('TextArea'), Field = ui('Field'), Seg = MC.ui && MC.ui.Segmented, CT = MC.ui && MC.ui.ChipToggle;
    var segOpts = [{ value: '', label: 'Let the planner suggest' }].concat(p.segments.map(function (s) { return { value: s.id, label: s.name + ' (' + num(s.count) + ')' }; }));
    function patch(k, v) { var n = Object.assign({}, b); n[k] = v; set(n); }
    return h`<div className="cm-brief" id="cmp-brief">
      <${Field} id="brief-name" label="Campaign name" error=${p.showErrors ? errs.name : null}>
        <${TI} id="brief-name" value=${b.name} maxLength=${80} placeholder="e.g. Cyber Monday follow-up" onChange=${function (v) { patch('name', v); }} />
      <//>
      <div className="cm-form-grid">
        <${Field} id="brief-goal" label="Goal">
          <${Sel} id="brief-goal" value=${b.goal.type} options=${GOALS.map(function (g) { return { value: g, label: GOAL_LABEL[g] }; })}
            onChange=${function (v) { patch('goal', { type: v, target: b.goal.target }); }} />
        <//>
        <${Field} id="brief-target" label=${b.goal.type === 'revenue' ? 'Target revenue ($)' : 'Target ' + (GOAL_NOUN[b.goal.type] || '')} error=${p.showErrors ? errs.target : null}>
          <${NI} id="brief-target" value=${b.goal.target} min=${1} step=${b.goal.type === 'revenue' ? 1000 : 10} onChange=${function (v) { patch('goal', { type: b.goal.type, target: fin(v) ? v : 0 }); }} />
        <//>
      </div>
      <div className="cm-form-grid">
        <${Field} id="brief-product" label="Product focus">
          <${Sel} id="brief-product" value=${b.productFocus || ''} options=${[{ value: '', label: 'Whole catalog' }].concat(products.map(function (x) { return { value: x.id, label: x.name }; }))}
            onChange=${function (v) { patch('productFocus', v || null); }} />
        <//>
        <${Field} id="brief-segment" label="Audience">
          <${Sel} id="brief-segment" value=${b.segmentId || ''} options=${segOpts} onChange=${function (v) { patch('segmentId', v || null); }} />
        <//>
      </div>
      <div className="cm-form-grid cm-form-grid-3">
        <${Field} id="brief-budget" label="Budget ($)" error=${p.showErrors ? errs.budget : null}>
          <${NI} id="brief-budget" value=${b.budget} min=${0} step=${500} onChange=${function (v) { patch('budget', fin(v) ? v : 0); }} />
        <//>
        <${Field} id="brief-start" label="Start" error=${p.showErrors ? errs.dates : null}>
          <${TI} id="brief-start" type="date" value=${ymd(b.startDay)} onChange=${function (v) { var d = dayOfYmd(v); if (d !== null) patch('startDay', d); }} />
        <//>
        <${Field} id="brief-end" label="End">
          <${TI} id="brief-end" type="date" value=${ymd(b.endDay)} onChange=${function (v) { var d = dayOfYmd(v); if (d !== null) patch('endDay', d); }} />
        <//>
      </div>
      <fieldset className="cm-fieldset">
        <legend className="cm-label">Channels</legend>
        <div className="cm-chips">${chAll().map(function (ch) {
          var on = b.channels.indexOf(ch) >= 0;
          function toggle() { patch('channels', on ? b.channels.filter(function (x) { return x !== ch; }) : chAll().filter(function (x) { return x === ch || b.channels.indexOf(x) >= 0; })); }
          return CT ? h`<${CT} key=${ch} id=${'brief-ch-' + ch} label=${chLabel(ch)} checked=${on} onChange=${toggle} />`
            : h`<label key=${ch} className="cm-check"><input type="checkbox" id=${'brief-ch-' + ch} checked=${on} onChange=${toggle} /> ${chLabel(ch)}</label>`;
        })}</div>
        ${p.showErrors && errs.channels ? h`<p className="cm-msg is-crit">${errs.channels}</p>` : null}
      </fieldset>
      <div className="cm-field-plain">
          <span className="cm-label" id="brief-tone-label">Tone</span>
          ${Seg ? h`<${Seg} id="brief-tone" label="Tone" size="sm" value=${b.tone} onChange=${function (v) { patch('tone', v); }}
              options=${TONES.map(function (t) { return { value: t, label: toneLabel(t) }; })} />`
            : h`<${Sel} id="brief-tone" value=${b.tone} options=${TONES.map(function (t) { return { value: t, label: toneLabel(t) }; })} onChange=${function (v) { patch('tone', v); }} />`}
      </div>
      <${Field} id="brief-offer" label="Offer">
        <${Sel} id="brief-offer" value=${b.offer} options=${OFFERS.map(function (o) { return { value: o, label: offerLabel(o) }; })} onChange=${function (v) { patch('offer', v); }} />
      <//>
      <${Field} id="brief-notes" label="Notes for the planner" hint="Optional. Anything the plan should keep in mind.">
        <${TA} id="brief-notes" value=${b.notes || ''} rows=${2} maxLength=${400} onChange=${function (v) { patch('notes', v); }} />
      <//>
    </div>`;
  }

  function SectionActions(p) {
    var sec = p.section;
    if (sec.derived) return null;
    return h`<div className="cm-sec-actions">
      <${Btn} size="sm" kind=${p.accepted ? 'secondary' : 'secondary'} id=${'plan-' + sec.id + '-accept'} icon=${p.accepted ? 'check' : null}
        aria-pressed=${p.accepted ? 'true' : 'false'} onClick=${p.onAccept}>${p.accepted ? 'Accepted' : 'Accept'}<//>
      ${p.canRegen ? h`<${Btn} size="sm" kind="ghost" id=${'plan-' + sec.id + '-regen'} onClick=${p.onRegen}>Regenerate<//>` : null}
      ${sec.editable ? h`<${Btn} size="sm" kind="ghost" id=${'plan-' + sec.id + '-edit'} aria-pressed=${p.editing ? 'true' : 'false'} onClick=${p.onEdit}>${p.editing ? 'Done' : 'Edit'}<//>` : null}
    </div>`;
  }

  function PlanSection(p) {
    var sec = p.section;
    return h`<section className=${cx('cm-sec', p.accepted && 'is-accepted')} id=${'plan-' + sec.id} aria-labelledby=${'plan-' + sec.id + '-title'}>
      <header className="cm-sec-head">
        <h3 className="cm-sec-title" id=${'plan-' + sec.id + '-title'}><span className="cm-sec-n num">${sec.n}</span>${sec.label}</h3>
        <${SectionActions} ...${p} />
      </header>
      <div className="cm-sec-body">${p.children}</div>
    </section>`;
  }

  function PlanAudience(p) {
    var a = p.data || {}, opts = a.options || EMPTY, edit = p.edit;
    var chosenIdx = 0;
    if (edit) opts.forEach(function (o, i) { if ((edit.segmentId && o.segmentId === edit.segmentId) || (!edit.segmentId && edit.name === o.name)) chosenIdx = i; });
    else if (a.chosen != null) chosenIdx = typeof a.chosen === 'number' ? a.chosen : Math.max(0, opts.map(function (o) { return o.segmentId; }).indexOf(a.chosen));
    var cur = opts[chosenIdx];
    if (!opts.length) return h`<p className="cm-muted">No audience options came back for this brief.</p>`;
    if (p.editing) {
      return h`<fieldset className="cm-fieldset"><legend className="cm-label">Pick an audience</legend>
        <ul className="cm-options">${opts.map(function (o, i) {
          var id = 'plan-aud-' + i;
          return h`<li key=${id}><label className="cm-option" htmlFor=${id}>
            <input type="radio" name="plan-aud" id=${id} checked=${i === chosenIdx} onChange=${function () { p.onEdit({ segmentId: o.segmentId || null, segment: o.segment || null, name: o.name }); }} />
            <span><span className="cm-strong">${o.name}</span> <span className="cm-muted num">${num(o.reach)} reachable${fin(o.meanProp) ? MID + pct(o.meanProp, 0) + ' likely to buy' : ''}</span>
              ${o.why ? h`<span className="cm-option-why">${o.why}</span>` : null}</span>
          </label></li>`;
        })}</ul></fieldset>`;
    }
    return h`<div>
      <p><span className="cm-strong">${cur.name}</span> <span className="cm-muted num">${num(cur.reach)} reachable${fin(cur.meanProp) ? MID + pct(cur.meanProp, 0) + ' likely to buy' : ''}</span></p>
      ${cur.why ? h`<p className="cm-why">${cur.why}</p>` : null}
      ${opts.length > 1 ? h`<p className="cm-muted cm-small">${opts.length - 1} other ${opts.length === 2 ? 'option' : 'options'} ranked lower. Edit to compare.</p>` : null}
    </div>`;
  }

  function PlanBudget(p) {
    var b = p.data || {}, by = p.edit || b.byChannel || EMPTY_OBJ;
    var chs = Object.keys(by);
    var tot = chs.reduce(function (s, ch) { return s + (Number(by[ch]) || 0); }, 0);
    var AB = MC.ui && MC.ui.AllocationBar;
    var NI = ui('NumberInput');
    var whyBy = {};
    (b.why || EMPTY).forEach(function (x) { whyBy[x.ch] = x; });
    return h`<div>
      ${AB && tot > 0 ? h`<${AB} parts=${chs.map(function (ch) { return { key: ch, label: chLabel(ch), share: (Number(by[ch]) || 0) / tot }; })} />` : null}
      <table className="cm-table cm-gap-top"><thead><tr><th scope="col">Channel</th><th scope="col" className="is-num">Budget</th>
        <th scope="col" className="is-num">Expected return</th><th scope="col" className="is-num">Next $1 returns</th></tr></thead>
        <tbody>${chs.map(function (ch) {
          var w = whyBy[ch] || {};
          return h`<tr key=${ch}><th scope="row">${chLabel(ch)}</th>
            <td className="is-num">${p.editing && NI ? h`<${NI} id=${'plan-budget-' + ch} label=${chLabel(ch) + ' budget'} size="sm" value=${by[ch]} min=${0} step=${100}
                onChange=${function (v) { var n = Object.assign({}, by); n[ch] = fin(v) ? v : 0; p.onEdit(n); }} />` : h`<span className="num">${money(by[ch])}</span>`}</td>
            <td className="is-num num">${fin(w.roas) ? ratio(w.roas) : DASH}</td>
            <td className="is-num num">${fin(w.marginal) ? '$' + w.marginal.toFixed(2) : DASH}</td></tr>`;
        })}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className="is-num num">${money(tot)}</td><td></td><td></td></tr></tfoot>
      </table>
    </div>`;
  }

  function PlanContent(p) {
    var ct = p.data || {}, vs = ct.variants || EMPTY, edits = p.edit || EMPTY_OBJ;
    var Ring = chart('ScoreRing');
    var TI = ui('TextInput');
    var hookKey = function (v) { return (MC.copy && MC.copy.HOOK && MC.copy.HOOK[v.channel]) || 'subject'; };
    return h`<ul className="cm-vlist">${vs.map(function (v, k) {
      var key = v.tmpId || ('$v' + k), hk = hookKey(v);
      var text = edits[key] && edits[key][hk] != null ? edits[key][hk] : (v.fields && v.fields[hk]) || '';
      var share = ct.alloc && ct.alloc[v.channel] ? ct.alloc[v.channel][key] : null;
      return h`<li key=${key} className="cm-vrow">
        ${Ring && v.predicted && fin(v.predicted.score) ? h`<${Ring} value=${v.predicted.score} size=${36} label=${'Predicted engagement ' + Math.round(v.predicted.score)} />` : h`<span className="cm-ring-empty" aria-hidden="true"></span>`}
        <div className="cm-vbody">
          <p className="cm-vtitle"><span className="cm-strong">${chLabel(v.channel)} ${v.name}</span>${fin(share) ? h`<span className="cm-muted">${MID + pct(share, 0)} of traffic</span>` : null}</p>
          ${p.editing && TI ? h`<${TI} id=${'plan-copy-' + k} label=${chLabel(v.channel) + ' ' + v.name + ' ' + hk} value=${text} maxLength=${160}
              onChange=${function (val) { var n = Object.assign({}, edits); n[key] = Object.assign({}, n[key]); n[key][hk] = val; p.onEdit(n); }} />`
            : h`<p className="cm-vhook">${text}</p>`}
        </div>
      </li>`;
    })}</ul>`;
  }

  function PlanForecast(p) {
    var f = p.data || {};
    var LC = chart('LineChart');
    var goal = p.brief.goal;
    var pts = (f.daily || EMPTY);
    var series = [{ id: 'f', label: 'Expected per day', points: pts.map(function (d) { return { x: d.day, y: d.mean }; }), dashed: true }];
    var band = { points: pts.map(function (d) { return { x: d.day, lo: d.lo, hi: d.hi }; }) };
    var unit = goal.type === 'revenue';
    return h`<div>
      <p className="cm-forecast-head num">Expected ${unit ? '' : (GOAL_NOUN[goal.type] || '') + ' '}<strong>${goalFmt(goal.type, f.lo, true)}${DASH}${goalFmt(goal.type, f.hi, true)}</strong>
        <span className="cm-muted"> against a goal of ${goalFmt(goal.type, goal.target, true)}</span></p>
      ${LC && pts.length > 1 ? h`<${LC} series=${series} band=${band} height=${160} xFormat=${dayShort} yFormat=${unit ? 'moneyCompact' : 'int'} ariaLabel="Forecast per day" noTable=${false} />` : null}
    </div>`;
  }

  function PlannerView(p) {
    var React = R();
    var focus = p.focus || {};
    var draftId = focus.id || null;
    var w0 = getWorld();
    var stored = useUiSel(function (s) { return s.plannerBrief; });
    var draftCampaign = useCampaign(draftId);
    var segments = useSel(React.useCallback(function (w) { return w.segments; }, []));
    var tick = useSel(selTick) || 0;
    var bs = React.useState(function () {
      // A stored brief belongs to the plan it was written for (new plan or a specific draft).
      if (stored && briefOwner.id === draftId) return clone(stored);
      planMemo.plan = null; planMemo.key = null; planMemo.accepted = {}; planMemo.edits = {}; planMemo.regen = {}; planMemo.fallback = false;
      briefOwner.id = draftId;
      var c0 = draftId && w0 && w0.campaigns ? w0.campaigns.byId[draftId] : null;
      var b0 = c0 ? briefFromCampaign(c0) : defaultBrief(w0);
      setTimeout(function () { setBriefStore(b0); }, 0);
      return b0;
    }), brief = bs[0], setBriefSt = bs[1];
    var ps = React.useState(planMemo), memo = ps[0], setMemoSt = ps[1];
    var es = React.useState(null), msg = es[0], setMsg = es[1];
    var vs = React.useState(false), showErrors = vs[0], setShowErrors = vs[1];
    var eds = React.useState(null), editing = eds[0], setEditing = eds[1];
    var cs = React.useState(false), confirmDiscard = cs[0], setConfirmDiscard = cs[1];
    function setMemo(patch) { Object.assign(planMemo, patch); setMemoSt(Object.assign({}, planMemo)); }
    function setBrief(b) { setBriefSt(b); setBriefStore(b); }
    var segList = segments ? segments.order.map(function (id) { return segments.byId[id]; }).filter(Boolean) : EMPTY;
    var errs = briefErrors(brief);
    var valid = !Object.keys(errs).length;
    var key = briefKey(brief);
    var outOfDate = !!(memo.key && memo.key !== key);
    var plan = memo.plan;
    var hasResult = !!(plan || memo.fallback);
    var available = plannerAvailable();

    function draft(regen) {
      setShowErrors(true);
      if (!valid) { setMsg({ tone: 'crit', text: 'Fix the highlighted fields first.' }); return; }
      var r = regen || {};
      var out = runPlanner(brief, r, draftId);
      if (out.error) { setMsg({ tone: 'crit', text: 'The planner couldn’t draft this brief: ' + out.error }); }
      else setMsg(null);
      var keepAccepted = regen ? memo.accepted : {};
      var keepEdits = regen ? memo.edits : {};
      setMemo({ plan: out.plan, trace: out.trace, key: key, regen: r, fallback: !out.plan, accepted: keepAccepted, edits: keepEdits, draftedTick: tick });
      setEditing(null);
    }
    function regenSection(id) {
      var r = Object.assign({}, memo.regen); r[id] = (r[id] || 0) + 1;
      var acc = Object.assign({}, memo.accepted); delete acc[id];
      var ed = Object.assign({}, memo.edits); delete ed[id];
      Object.assign(planMemo, { accepted: acc, edits: ed });
      setMemoSt(Object.assign({}, planMemo));
      var out = runPlanner(brief, r, draftId);
      setMemo({ plan: out.plan || memo.plan, trace: out.trace || memo.trace, regen: r, accepted: acc, edits: ed });
    }
    function toggleAccept(id) { var a = Object.assign({}, memo.accepted); a[id] = !a[id]; setMemo({ accepted: a }); }
    function setEdit(id, v) { var e = Object.assign({}, memo.edits); e[id] = v; var a = Object.assign({}, memo.accepted); delete a[id]; setMemo({ edits: e, accepted: a }); }
    function reset() {
      setMemo({ plan: null, key: null, accepted: {}, edits: {}, regen: {}, fallback: false, trace: EMPTY, draftedTick: null });
      setBriefStore(null);
    }
    function discard() { reset(); setFocus({ mode: draftId ? 'detail' : 'board', id: draftId }); }
    function create() {
      setShowErrors(true);
      if (!valid) { setMsg({ tone: 'crit', text: 'Fix the highlighted fields first.' }); return; }
      var pay = plan ? finalPayload(plan, memo.edits, brief) : basicPayload(brief);
      var r;
      if (draftId) r = dispatch('campaign/applyPlan', Object.assign({ id: draftId }, pay));
      else r = dispatch('campaign/create', pay);
      if (!r.ok) { setMsg({ tone: 'crit', text: r.error || 'Couldn’t save the plan.' }); return; }
      var id = draftId || (r.created ? r.created[pay.segment ? 1 : 0] : null);
      reset();
      if (id) setFocus({ mode: 'detail', id: id, tab: 'overview' }); else setFocus({ mode: 'board', id: null });
    }

    var Panel = ui('Panel');
    var IC = MC.ui && MC.ui.InlineConfirm;
    var sections = plan && plan.sections ? plan.sections : null;
    var editableIds = SECTIONS.filter(function (s) { return !s.derived; }).map(function (s) { return s.id; });
    var toReview = sections ? editableIds.filter(function (id) { return !memo.accepted[id]; }).length : 0;
    var FD = chart('FlowDiagram');
    var GL = MC.ui && MC.ui.GuardrailList;
    var preflightItems = sections && sections.preflight ? (sections.preflight.items || EMPTY) : EMPTY;
    var pfFails = preflightItems.filter(function (x) { return x.status === 'fail' || x.pass === false && x.blocking; }).length;
    var title = draftId && draftCampaign ? 'Plan: ' + draftCampaign.name : 'New campaign plan';
    var finalLabel = draftId ? 'Save plan to draft' : 'Create draft campaign';

    function sectionBody(sec) {
      var d = sections[sec.id];
      if (sec.id === 'audience') return h`<${PlanAudience} data=${d} edit=${memo.edits.audience} editing=${editing === 'audience'} onEdit=${function (v) { setEdit('audience', v); }} />`;
      if (sec.id === 'budget') return h`<${PlanBudget} data=${d} edit=${memo.edits.budget} editing=${editing === 'budget'} onEdit=${function (v) { setEdit('budget', v); }} />`;
      if (sec.id === 'journey') return d && d.steps && FD ? h`<div className="cm-plan-flow"><${FD} steps=${d.steps} compact=${true} ariaLabel="Planned journey" /></div>` : h`<p className="cm-muted">No journey in this plan.</p>`;
      if (sec.id === 'content') return h`<${PlanContent} data=${d} edit=${memo.edits.content} editing=${editing === 'content'} onEdit=${function (v) { setEdit('content', v); }} />`;
      if (sec.id === 'forecast') return h`<${PlanForecast} data=${d} brief=${brief} />`;
      if (sec.id === 'preflight') return GL ? h`<${GL} items=${preflightItems.map(function (x) { return Object.assign({ blocking: x.status === 'fail' }, x); })} ariaLabel="Preflight checks" />` : null;
      return null;
    }

    var right;
    if (!hasResult) {
      right = h`<div className="cm-plan-empty">
        <p className="cm-plan-empty-title">${available ? 'Your plan appears here' : 'Plan by hand'}</p>
        <p className="cm-muted">${available
          ? 'Fill in a goal and budget, then Draft plan. The planner proposes an audience, channel mix, journey, content and a forecast. You accept each part.'
          : 'The Campaign Planner isn’t available right now. Fill in the brief and save it as a draft campaign; you can finish the details by hand.'}</p>
      </div>`;
    } else if (!sections) {
      right = h`<div className="cm-plan-empty">
        <p className="cm-plan-empty-title">No recommendations for this brief</p>
        <p className="cm-muted">The Campaign Planner isn’t available right now, so this draft will use your brief as written: an even budget split, a standard journey for the goal and starter copy for each channel. Every part stays editable after you save it.</p>
      </div>`;
    } else {
      right = h`<div className="cm-plan">
        <p className="cm-plan-summary">
          ${'Drafted from your brief ' + (fin(memo.draftedTick) ? rel(memo.draftedTick, tick) : '') + MID + '6 sections' + MID}
          ${toReview ? plural(toReview, 'part', 'parts') + ' to review' : 'All parts accepted'}
        </p>
        ${outOfDate ? h`<div className="cm-outdated" role="status">
            <${Pill} tone="warn">Plan is out of date<//><span className="cm-muted">Your brief changed.</span>
            <${Link} id="plan-refresh" onClick=${function () { draft(null); }}>Refresh plan<//>
          </div>` : null}
        ${SECTIONS.map(function (sec) {
          return h`<${PlanSection} key=${sec.id} section=${sec} accepted=${!!memo.accepted[sec.id]} editing=${editing === sec.id}
              canRegen=${available && !sec.derived}
              onAccept=${function () { toggleAccept(sec.id); }} onRegen=${function () { regenSection(sec.id); }}
              onEdit=${function () { setEditing(editing === sec.id ? null : sec.id); }}>
            ${sectionBody(sec)}
          <//>`;
        })}
        ${memo.trace && memo.trace.length ? h`<details className="cm-trace" id="plan-trace">
            <summary>How this plan was made</summary>
            <ol>${memo.trace.map(function (t, i) {
              return h`<li key=${i}>${t.text || t.summary || t.title || ''}${t.rows && t.rows.length ? h`<ul className="cm-trace-rows">${t.rows.map(function (r, j) {
                return h`<li key=${j}>${r.label != null ? r.label : ''}${r.value != null ? ': ' + r.value : ''}</li>`;
              })}</ul>` : null}</li>`;
            })}</ol>
          </details>` : null}
      </div>`;
    }

    return h`<div className="cm-planner">
      <header className="cm-detail-head">
        <${Link} className="cm-back" id="cmp-back" onClick=${function () { setFocus({ mode: draftId ? 'detail' : 'board', id: draftId }); }}>${LARR} ${draftId ? 'Back to draft' : 'Campaigns'}<//>
        <div className="cm-detail-titlerow">
          <div className="cm-detail-titles">
            <h1 id="page-title" tabIndex="-1" className="cm-h1">${title}</h1>
            <p className="cm-muted cm-small">Your brief is kept while you move around the app.</p>
          </div>
          <div className="cm-row cm-detail-actions">
            ${!confirmDiscard ? h`<${Btn} kind="ghost" id="plan-discard" onClick=${function () { setConfirmDiscard(true); }}>Discard brief<//>` : null}
            <${Btn} kind="primary" id="plan-create" disabled=${!hasResult || outOfDate} onClick=${create}>${finalLabel}<//>
          </div>
        </div>
        ${confirmDiscard && IC ? h`<${IC} id="plan-discard-confirm" tone="crit" message="Discard this brief and plan?" confirmLabel="Discard" cancelLabel="Keep editing"
            onConfirm=${function () { setConfirmDiscard(false); discard(); }} onCancel=${function () { setConfirmDiscard(false); }} />` : null}
        ${msg ? h`<${Msg} text=${msg.text} tone=${msg.tone} />` : null}
      </header>
      <div className="cm-plan-grid">
        <${Panel} id="cmp-brief-panel" title="Brief" className="cm-plan-left">
          <${BriefForm} brief=${brief} set=${setBrief} segments=${segList} errors=${errs} showErrors=${showErrors} />
          <div className="cm-row cm-gap-top">
            <${Btn} kind=${hasResult ? 'secondary' : 'primary'} id="plan-draft" onClick=${function () { draft(null); }}>${hasResult ? 'Redraft plan' : 'Draft plan'}<//>
          </div>
        <//>
        <${Panel} id="cmp-plan-panel" title="Plan draft" className="cm-plan-right">${right}<//>
      </div>
    </div>`;
  }

  /* ================================================================
     View
     ================================================================ */
  var MODES = [{ id: 'board', label: 'Board' }, { id: 'list', label: 'List' }, { id: 'calendar', label: 'Calendar' }];
  var lastIndexMode = 'board';

  function Index(p) {
    var mode = p.mode;
    var rows = useSel(selRows) || EMPTY;
    var tick = useSel(selTick) || 0;
    var Tabs = ui('Tabs');
    var live = rows.filter(function (r) { return r.status === 'live'; }).length;
    var next = rows.filter(function (r) { return r.status === 'scheduled'; }).sort(function (a, b) { return a.startTick - b.startTick; })[0];
    var sub = plural(rows.length, 'campaign', 'campaigns') + MID + live + ' live' + (next ? MID + next.name + ' starts ' + rel(next.startTick, tick) : '');
    var body = mode === 'list' ? h`<${ListMode} />` : mode === 'calendar' ? h`<${CalendarMode} />` : h`<${Board} />`;
    return h`<div className="cm-index">
      <header className="cm-head">
        <div className="cm-head-titles">
          <h1 id="page-title" tabIndex="-1" className="cm-h1">Campaigns</h1>
          <p className="cm-sub">${sub}</p>
        </div>
        <${Btn} kind="primary" id="cmp-plan" icon="plus" onClick=${function () { setFocus({ mode: 'planner', id: null }); }}>Plan a campaign<//>
      </header>
      <${Tabs} id="cmp-modes" label="Campaign views" tabs=${MODES} value=${mode} panelId="cmp-mode-panel"
        onChange=${function (m) { lastIndexMode = m; setFocus({ mode: m, id: null }); }} />
      <div id="cmp-mode-panel" role="tabpanel" aria-labelledby=${'cmp-modes-' + mode}>${body}</div>
    </div>`;
  }

  function CampaignsView() {
    var ready = useSel(function (w) { return !!(w && w.campaigns); });
    var focus = useUiSel(function (s) { return s.focus && s.focus.campaigns; }) || EMPTY_OBJ;
    var mode = focus.mode || 'board';
    var body;
    if (!ready) {
      body = h`<div className="cm-index"><header className="cm-head"><div className="cm-head-titles">
        <h1 id="page-title" tabIndex="-1" className="cm-h1">Campaigns</h1><p className="cm-sub">Loading the Fernway sample campaigns${ELL}</p></div></header></div>`;
    } else if (mode === 'detail' && focus.id) body = h`<${Detail} focus=${focus} backMode=${lastIndexMode} />`;
    else if (mode === 'planner') body = h`<${PlannerView} key=${'planner-' + (focus.id || 'new')} focus=${focus} />`;
    else {
      var m = mode === 'list' || mode === 'calendar' ? mode : 'board';
      lastIndexMode = m;
      body = h`<${Index} mode=${m} />`;
    }
    return h`<section className="v-campaigns">${body}</section>`;
  }

  MC.views.campaigns = CampaignsView;
})();
