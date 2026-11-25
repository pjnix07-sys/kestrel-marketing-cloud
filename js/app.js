/* Kestrel Marketing Cloud - application shell: sidebar + phone top bar, quiet agent pulse,
   approvals count, theme, approvals drawer, batched autopilot toasts, bare-hash router,
   error boundaries, boot. Sample tenant: Fernway Outfitters (fictional). Per §11 the shell shows
   no clock or pace controls; the only time control is the overflow menu's "Jump ahead". */
(function () {
  'use strict';
  var MC = window.MC = window.MC || {};
  var root = document.getElementById('app');

  /* ---------------- library guard ---------------- */
  function bootMessage(title, body) {
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    var card = document.createElement('div');
    card.className = 'app-boot app-boot--error';
    card.setAttribute('role', 'alert');
    var h = document.createElement('p');
    h.className = 'app-boot-title';
    h.textContent = title;
    var p = document.createElement('p');
    p.className = 'app-boot-body';
    p.textContent = body;
    card.appendChild(h);
    card.appendChild(p);
    root.appendChild(card);
  }
  if (!window.React || !window.ReactDOM || typeof window.htm !== 'function' || typeof window.ReactDOM.createRoot !== 'function') {
    bootMessage("Couldn't load the interface libraries.", "Check your connection and reload.");
    return;
  }
  if (!MC.store || typeof MC.store.subscribe !== 'function' || !MC.uiStore || typeof MC.uiStore.getState !== 'function') {
    bootMessage("Kestrel couldn't start.", 'A core file failed to load. Reload the page; if it keeps happening, the deployment is incomplete.');
    return;
  }

  var React = window.React;
  var html = MC.html || window.htm.bind(React.createElement);
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useMemo = React.useMemo;
  var DOT = '·';
  var ELL = '…';

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) { if (arguments[i]) out.push(arguments[i]); }
    return out.join(' ');
  }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function ui(name) { var c = MC.ui && MC.ui[name]; return typeof c === 'function' ? c : null; }
  function Icon(p) { var I = ui('Icon'); return I ? html`<${I} name=${p.name} size=${p.size || 16} />` : null; }
  function useSel(sel, eq) {
    if (MC.hooks && typeof MC.hooks.useSelect === 'function') return MC.hooks.useSelect(sel, eq);
    return undefined;
  }
  function useUi(sel, eq) { return MC.hooks.useUi(sel, eq); }
  function useMedia(q) {
    if (MC.hooks && typeof MC.hooks.useMedia === 'function') return MC.hooks.useMedia(q);
    return false;
  }
  function setUi(patch) { MC.uiStore.set(patch); }
  function go(route, focus) { if (MC.nav && MC.nav.go) MC.nav.go(route, focus); }
  function agentName(id) { return MC.ui && MC.ui.agentName ? MC.ui.agentName(id) : id; }

  var NAV = [
    { route: 'home', label: 'Command Center', icon: 'home' },
    { route: 'campaigns', label: 'Campaigns', icon: 'campaigns' },
    { route: 'content', label: 'Content Studio', icon: 'content' },
    { route: 'audiences', label: 'Audiences', icon: 'audiences' },
    { route: 'analytics', label: 'Analytics', icon: 'analytics' },
    { route: 'agents', label: 'Agents', icon: 'agents' }
  ];
  var TITLES = {};
  NAV.forEach(function (n) { TITLES[n.route] = n.label; });
  var THEMES = [
    { value: 'system', label: 'System', icon: 'monitor', ariaLabel: 'System theme' },
    { value: 'light', label: 'Light', icon: 'sun', ariaLabel: 'Light theme' },
    { value: 'dark', label: 'Dark', icon: 'moon', ariaLabel: 'Dark theme' }
  ];

  /* ---------------- selectors (module-level, stable) ---------------- */
  function selReady(w) { return !!w; }
  function selOpenCount(w) { return w && w.proposals && w.proposals.open ? w.proposals.open.length : 0; }
  function selProposals(w) { return w ? w.proposals : null; }
  function selCampaigns(w) { return w ? w.campaigns : null; }
  function selRoute(s) { return s.route; }
  function selDrawer(s) { return s.drawer; }
  function selTheme(s) { return s.theme; }
  function selSample(s) { return s.sampleDismissed; }
  function selCampFocus(s) { return s.focus && s.focus.campaigns; }

  function report(e) { if (window.console && console.error) console.error(e); }

  /* ---------------- jump ahead (the one time control, §11.1) ---------------- */
  function canJump() { return !!(MC.engine && typeof MC.engine.step === 'function'); }
  function jumpAhead(hours) {
    try { if (canJump()) MC.engine.step(hours); } catch (e) { report(e); }
  }

  /* ---------------- agent pulse: one quiet dot that animates only when an agent acts ---------------- */
  var AGENT_KINDS = { 'agent-applied': 1, 'agent-proposed': 1 };
  function selAgentTop(w) {
    var f = w && w.feed ? w.feed : null;
    if (!f) return null;
    for (var i = 0; i < f.length && i < 60; i++) if (AGENT_KINDS[f[i].kind]) return f[i].id;
    return null;
  }
  function openActivity() {
    setUi({ drawer: null });
    go('home');
    // After the route change settles, bring the "What changed" feed into view.
    window.setTimeout(function () {
      var el = document.getElementById('home-changes');
      if (!el) return;
      try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
      var list = document.getElementById('home-feed-list');
      if (list && list.focus) { try { list.focus({ preventScroll: true }); } catch (e) { list.focus(); } }
    }, 120);
  }
  function AgentDot(p) {
    var top = useSel(selAgentTop);
    var last = useRef(undefined);
    var st = useState(false), active = st[0], setActive = st[1];
    useEffect(function () {
      var before = last.current;
      last.current = top;
      if (before === undefined || top === before || !top) return undefined;
      setActive(true);
      var timer = window.setTimeout(function () { setActive(false); }, 2400);
      return function () { window.clearTimeout(timer); };
    }, [top]);
    var label = active ? 'An agent just acted. Open recent activity.' : 'Agent activity. Open recent activity.';
    return html`<button type="button" id=${p.id || 'app-pulse'} className=${cx('app-pulse', active && 'is-active')}
        aria-label=${label} title="Agent activity" onClick=${openActivity}>
      <span className="app-pulse-dot" aria-hidden="true"></span>
      ${p.withLabel ? html`<span className="app-pulse-label">Agent activity</span>` : null}
    </button>`;
  }

  function ThemeControl(p) {
    var theme = useUi(selTheme) || 'system';
    var Seg = ui('Segmented');
    if (!Seg) return null;
    return html`<${Seg} id=${p.id || 'app-theme'} label="Theme" size="sm" block=${!!p.block} options=${THEMES} value=${theme}
      onChange=${function (v) { setUi({ theme: v }); }} />`;
  }

  /* ---------------- brand + navigation ---------------- */
  function Mark(p) {
    return html`<a className="app-mark" href="#home" aria-label="Kestrel Marketing Cloud, Command Center" onClick=${function (e) { e.preventDefault(); go('home'); }}>
      <span className="app-mark-glyph" aria-hidden="true"><${Icon} name="kestrel" size=${20} /></span>
      ${p.compact ? null : html`<span className="app-mark-word">Kestrel</span>`}
    </a>`;
  }

  function NavList(p) {
    var route = useUi(selRoute);
    return html`<nav className="app-nav" aria-label="Main">
      <ul>
        ${NAV.map(function (n) {
          var on = n.route === route;
          var built = !!(MC.views && typeof MC.views[n.route] === 'function');
          return html`<li key=${n.route}>
            <a href=${'#' + n.route} id=${(p.idPrefix || 'app-nav') + '-' + n.route} className=${cx('app-nav-link', on && 'is-on')}
                aria-current=${on ? 'page' : null} title=${n.label}
                onClick=${function (e) { e.preventDefault(); go(n.route); if (p.onNavigate) p.onNavigate(n.route); }}>
              <span className="app-nav-icon" aria-hidden="true"><${Icon} name=${n.icon} size=${18} /></span>
              <span className="app-nav-label">${n.label}</span>
              ${!built ? html`<span className="app-nav-soon">Soon</span>` : null}
            </a>
          </li>`;
        })}
      </ul>
    </nav>`;
  }

  function Sidebar() {
    return html`<aside className="app-sidebar" aria-label="Kestrel">
      <div className="app-sidebar-top"><${Mark} /></div>
      <${NavList} />
      <div className="app-sidebar-foot">
        <div className="app-tenant">
          <span className="app-tenant-name">Fernway Outfitters</span>
          <span className="app-tenant-note">Sample data</span>
        </div>
        <div className="app-theme"><${ThemeControl} id="app-theme" /></div>
      </div>
    </aside>`;
  }

  /* ---------------- top bar ---------------- */
  function Crumbs(p) {
    var route = useUi(selRoute);
    var cf = useUi(selCampFocus);
    var campaigns = useSel(selCampaigns);
    var title = TITLES[route] || TITLES.home;
    var leaf = null;
    if (route === 'campaigns' && cf) {
      if (cf.mode === 'detail' && cf.id && campaigns && campaigns.byId && campaigns.byId[cf.id]) leaf = campaigns.byId[cf.id].name;
      else if (cf.mode === 'planner') leaf = 'New campaign plan';
    }
    // On wider screens each view's own h1 names the page; the bar only carries breadcrumbs.
    if (!leaf) return p.showTitle ? html`<div className="app-title">${title}</div>` : null;
    return html`<nav className="app-crumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="#campaigns" onClick=${function (e) { e.preventDefault(); go('campaigns', { mode: 'board' }); }}>Campaigns</a></li>
        <li aria-current="page"><span className="app-title app-title--leaf">${leaf}</span></li>
      </ol>
    </nav>`;
  }

  // The approvals control is a single count (§11.3): "Approvals 3", quiet when nothing waits.
  function ApprovalsButton(p) {
    var open = useSel(selOpenCount) || 0;
    var label = open ? 'Approvals, ' + open + ' waiting' : 'Approvals, nothing waiting';
    return html`<button type="button" id="app-approvals-btn" className=${cx('app-approvals-btn', open > 0 && 'has-items')} aria-label=${label}
        onClick=${function () { setUi({ drawer: 'approvals' }); }}>
      ${p.compact ? null : html`<span className="app-approvals-label">Approvals</span>`}
      <span className="app-count num" aria-hidden="true">${open}</span>
    </button>`;
  }

  function OverflowMenu() {
    var anchor = useRef(null);
    var st = useState(false), open = st[0], setOpen = st[1];
    var cf = useState(false), confirm = cf[0], setConfirm = cf[1];
    var bs = useState(false), busy = bs[0], setBusy = bs[1];
    var Pop = ui('Popover'), IC = ui('InlineConfirm');
    var dismissed = useUi(selSample);
    function close() { setOpen(false); setConfirm(false); }
    function jump(hours) { close(); jumpAhead(hours); }
    function restart() {
      setBusy(true);
      var done = function () { setBusy(false); close(); if (MC.uiStore.clearToasts) MC.uiStore.clearToasts(); };
      try {
        var r = MC.engine && typeof MC.engine.restart === 'function' ? MC.engine.restart(MC.SEED) : null;
        if (r && typeof r.then === 'function') r.then(done, function (e) { report(e); done(); }); else done();
      } catch (e) { report(e); done(); }
    }
    return html`<div className="app-overflow">
      <button type="button" ref=${anchor} id="app-more" className="k-iconbtn" aria-label="More options" aria-haspopup="dialog"
          aria-expanded=${open ? 'true' : 'false'} onClick=${function () { setOpen(!open); setConfirm(false); }}>
        <${Icon} name="more" size=${18} />
      </button>
      ${Pop ? html`<${Pop} anchorRef=${anchor} open=${open} onClose=${close} label="More options" placement="bottom-end" width=${300} id="app-more-menu">
        <div className="app-menu">
          ${canJump() ? html`<div className="app-menu-row" role="group" aria-label="Jump ahead">
            <span className="app-menu-row-label">Jump ahead</span>
            <button type="button" className="app-menu-link" id="app-jump-day" onClick=${function () { jump(24); }}>a day</button>
            <span className="app-menu-sep" aria-hidden="true">/</span>
            <button type="button" className="app-menu-link" id="app-jump-week" onClick=${function () { jump(24 * 7); }}>a week</button>
          </div>` : null}
          ${confirm && IC ? html`<${IC} id="app-restart-confirm" tone="crit" busy=${busy}
              message="Reset the sample data? This clears every change you and the agents have made."
              confirmLabel="Reset" cancelLabel="Cancel" onConfirm=${restart} onCancel=${function () { setConfirm(false); }} />`
            : html`<button type="button" className="app-menu-item" id="app-restart" disabled=${!(MC.engine && MC.engine.restart)}
                onClick=${function () { setConfirm(true); }}><span>Reset sample data${ELL}</span></button>`}
          ${dismissed ? html`<button type="button" className="app-menu-item" id="app-sample-note"
              onClick=${function () { close(); setUi({ sampleDismissed: false }); }}><span>Show the sample-data note</span></button>` : null}
        </div>
      <//>` : null}
    </div>`;
  }

  function Topbar(p) {
    if (p.phone) {
      var IB = ui('IconButton');
      return html`<header className="app-topbar app-topbar--phone">
        <${Mark} compact=${true} />
        <div className="app-topbar-title"><${Crumbs} showTitle=${true} /></div>
        <${AgentDot} />
        <${ApprovalsButton} compact=${true} />
        ${IB ? html`<${IB} id="app-menu-btn" icon="menu" label="Menu" onClick=${function () { setUi({ drawer: 'menu' }); }} />` : null}
      </header>`;
    }
    return html`<header className="app-topbar">
      <div className="app-topbar-title"><${Crumbs} /></div>
      <div className="app-topbar-tools">
        <${AgentDot} />
        <${ApprovalsButton} />
        <${OverflowMenu} />
      </div>
    </header>`;
  }

  function SampleStrip() {
    var dismissed = useUi(selSample);
    if (dismissed) return null;
    return html`<div className="app-sample" role="note">
      <p>You're exploring Fernway Outfitters, a fictional outdoor brand with sample data.</p>
      <button type="button" id="app-sample-ok" className="k-link app-sample-ok" onClick=${function () { setUi({ sampleDismissed: true }); }}>Got it</button>
    </div>`;
  }

  /* ---------------- approvals drawer ---------------- */
  var RISKS = [{ value: 'low', label: 'Low risk' }, { value: 'medium', label: 'Medium risk' }, { value: 'high', label: 'High risk' }];
  var HISTORY_STATUSES = { applied: 1, rejected: 1, expired: 1, superseded: 1, undone: 1, stale: 1 };
  var EMPTY_TEXT = {
    needs: { title: 'Nothing needs you right now.', body: 'Agents on Suggest will queue changes here.' },
    applied: { title: 'No agent changes yet.', body: 'Agents on Autopilot apply changes that pass every guardrail. They show up here so you can review or undo them.' },
    history: { title: 'No decisions yet.', body: 'Proposals you approve or dismiss, and ones that expire or stop applying, are kept here.' }
  };

  function proposalLists(props) {
    var out = { needs: [], applied: [], history: [] };
    if (!props || !props.byId) return out;
    (props.open || []).forEach(function (id) { var x = props.byId[id]; if (x && x.status === 'pending') out.needs.push(x); });
    (props.order || []).forEach(function (id) {
      var x = props.byId[id];
      if (!x) return;
      if (x.status === 'auto') out.applied.push(x);
      else if (HISTORY_STATUSES[x.status]) out.history.push(x);
    });
    return out;
  }

  function ProposalFallback(p) {
    var x = p.p;
    return html`<article className="app-prop-fallback">
      <p className="app-prop-agent">${agentName(x.agentId)} ${DOT} ${x.risk ? x.risk + ' risk' : ''}</p>
      <h3>${x.title}</h3>
      ${x.rationale ? html`<p>${x.rationale}</p>` : null}
    </article>`;
  }

  function ApprovalsPanel() {
    var props = useSel(selProposals);
    var tabSt = useState('needs'), tab = tabSt[0], setTab = tabSt[1];
    var agSt = useState(''), agentF = agSt[0], setAgentF = agSt[1];
    var rkSt = useState(''), riskF = rkSt[0], setRiskF = rkSt[1];
    var cfSt = useState(false), confirm = cfSt[0], setConfirm = cfSt[1];
    var msgSt = useState(null), msg = msgSt[0], setMsg = msgSt[1];
    var moreSt = useState(30), limit = moreSt[0], setLimit = moreSt[1];
    var holdSt = useState(false), hold = holdSt[0], setHold = holdSt[1];
    var lists = useMemo(function () { return proposalLists(props); }, [props]);
    var Tabs = ui('Tabs'), PC = ui('ProposalCard'), Empty = ui('EmptyState'), IC = ui('InlineConfirm'), Btn = ui('Button'), NewPill = ui('NewItemsPill');

    var base = lists[tab] || [];
    var agentIds = [];
    base.forEach(function (x) { if (agentIds.indexOf(x.agentId) < 0) agentIds.push(x.agentId); });
    var filtered = base.filter(function (x) {
      return (!agentF || x.agentId === agentF) && (!riskF || x.risk === riskF);
    });
    var frozen = MC.hooks.useFrozen ? MC.hooks.useFrozen(filtered, { key: 'id', freeze: hold }) : { items: filtered, pending: 0, reveal: function () {} };
    var shown = frozen.items.slice(0, limit);
    var lowIds = tab === 'needs' ? filtered.filter(function (x) { return x.risk === 'low'; }).map(function (x) { return x.id; }) : [];

    function switchTab(t) { setTab(t); setConfirm(false); setMsg(null); setLimit(30); setAgentF(''); setRiskF(''); }
    function approveLow() {
      var n = lowIds.length;
      var r = MC.store.dispatch({ type: 'proposal/approveMany', payload: { ids: lowIds.slice() } });
      setConfirm(false);
      if (r && r.ok) setMsg({ tone: 'good', text: 'Approved ' + n + (n === 1 ? ' low-risk change.' : ' low-risk changes.') + ' Each can be undone from Applied or History.' });
      else setMsg({ tone: 'crit', text: (r && r.error) || "Couldn't approve these changes." });
    }

    var tabs = [
      { id: 'needs', label: 'Needs you', count: lists.needs.length, countTone: lists.needs.length ? 'agent' : null },
      { id: 'applied', label: 'Applied by agents', count: lists.applied.length },
      { id: 'history', label: 'History' }
    ];
    var e = EMPTY_TEXT[tab];
    return html`<div className="app-approvals">
      ${Tabs ? html`<${Tabs} id="approvals-tabs" label="Approvals" tabs=${tabs} value=${tab} onChange=${switchTab} panelId="approvals-panel" />` : null}
      <div id="approvals-panel" role="tabpanel" aria-labelledby=${'approvals-tabs-' + tab} className="app-approvals-panel">
        ${base.length > 1 ? html`<div className="app-filters" role="group" aria-label="Filter proposals">
          <label className="k-sr" htmlFor="approvals-agent">Agent</label>
          <span className="k-select-wrap k-select-wrap--sm"><select id="approvals-agent" className="k-select" value=${agentF}
              onChange=${function (ev) { setAgentF(ev.target.value); }}>
            <option value="">All agents</option>
            ${agentIds.map(function (a) { return html`<option key=${a} value=${a}>${agentName(a)}</option>`; })}
          </select></span>
          <label className="k-sr" htmlFor="approvals-risk">Risk</label>
          <span className="k-select-wrap k-select-wrap--sm"><select id="approvals-risk" className="k-select" value=${riskF}
              onChange=${function (ev) { setRiskF(ev.target.value); }}>
            <option value="">Any risk</option>
            ${RISKS.map(function (r) { return html`<option key=${r.value} value=${r.value}>${r.label}</option>`; })}
          </select></span>
        </div>` : null}
        ${tab === 'needs' && lowIds.length && Btn ? html`<div className="app-bulk">
          ${confirm && IC ? html`<${IC} id="approvals-bulk-confirm" message=${'Approve ' + lowIds.length + ' low-risk change' + (lowIds.length === 1 ? '' : 's') + '? Each can be undone.'}
              confirmLabel="Approve" cancelLabel="Cancel" onConfirm=${approveLow} onCancel=${function () { setConfirm(false); }} />`
            : html`<${Btn} id="approvals-bulk" kind="secondary" size="sm" icon="check" onClick=${function () { setConfirm(true); setMsg(null); }}>${'Approve all low-risk (' + lowIds.length + ')'}<//>`}
        </div>` : null}
        ${msg ? html`<p className=${'app-msg app-msg--' + msg.tone} role="status">${msg.text}</p>` : null}
        ${frozen.pending > 0 && NewPill ? html`<div className="app-newpill"><${NewPill} count=${frozen.pending} onClick=${frozen.reveal}
            label=${frozen.pending + (frozen.pending === 1 ? ' new proposal' : ' new proposals')} /></div>` : null}
        ${shown.length ? html`<ul className="app-prop-list" onMouseEnter=${function () { setHold(true); }} onMouseLeave=${function () { setHold(false); }}
            onFocus=${function () { setHold(true); }} onBlur=${function (ev) { if (!ev.currentTarget.contains(ev.relatedTarget)) setHold(false); }}>
          ${shown.map(function (x) {
            return html`<li key=${x.id}>${PC ? html`<${PC} id=${x.id} showTarget=${true} />` : html`<${ProposalFallback} p=${x} />`}</li>`;
          })}
        </ul>` : (Empty ? html`<${Empty} icon=${tab === 'needs' ? 'check-circle' : 'inbox'}
            title=${base.length ? 'No proposals match these filters.' : e.title} body=${base.length ? 'Clear a filter to see more.' : e.body} />` : null)}
        ${frozen.items.length > limit && Btn ? html`<div className="app-more-row"><${Btn} kind="ghost" size="sm" id="approvals-more"
            onClick=${function () { setLimit(limit + 30); }}>${'Show more (' + (frozen.items.length - limit) + ')'}<//></div>` : null}
      </div>
    </div>`;
  }

  /* ---------------- phone menu sheet ---------------- */
  function MenuContent() {
    function closeMenu() { setUi({ drawer: null }); }
    return html`<div className="app-menu-sheet">
      <${NavList} idPrefix="app-menu-nav" onNavigate=${closeMenu} />
      <section className="app-menu-section" aria-label="Agent activity">
        <${AgentDot} id="app-menu-pulse" withLabel=${true} />
      </section>
      <section className="app-menu-section" aria-labelledby="app-menu-theme-h">
        <h3 id="app-menu-theme-h" className="app-menu-heading">Appearance</h3>
        <${ThemeControl} id="app-menu-theme" block=${true} />
      </section>
      <div className="app-tenant">
        <span className="app-tenant-name">Fernway Outfitters</span>
        <span className="app-tenant-note">Sample data</span>
      </div>
    </div>`;
  }

  /* ---------------- error boundary + view host ---------------- */
  function ErrorBoundary(props) {
    React.Component.call(this, props);
    this.state = { error: null };
  }
  ErrorBoundary.prototype = Object.create(React.Component.prototype);
  ErrorBoundary.prototype.constructor = ErrorBoundary;
  ErrorBoundary.getDerivedStateFromError = function (error) { return { error: error }; };
  ErrorBoundary.prototype.componentDidCatch = function (error, info) { report(error); if (info && info.componentStack) report(info.componentStack); };
  ErrorBoundary.prototype.render = function () {
    var self = this;
    if (!this.state.error) return this.props.children;
    var err = this.state.error;
    return html`<section className="app-fault" role="alert">
      <h1 id="page-title" tabIndex="-1" className="app-fault-title">This view hit an error.</h1>
      <p>The rest of Kestrel keeps running, and your agents are unaffected.</p>
      <div className="app-fault-actions">
        <button type="button" className="k-btn k-btn--primary k-btn--md" id="app-reload-view"
          onClick=${function () { self.setState({ error: null }); if (self.props.onReload) self.props.onReload(); }}><span className="k-btn-label">Reload view</span></button>
      </div>
      <details className="app-fault-details">
        <summary>Details</summary>
        <pre>${String((err && (err.stack || err.message)) || err)}</pre>
      </details>
    </section>`;
  };

  function Unbuilt(p) {
    var Empty = ui('EmptyState');
    var title = TITLES[p.route] || 'This area';
    var ready = NAV.filter(function (n) { return MC.views && typeof MC.views[n.route] === 'function'; }).map(function (n) { return n.label; });
    var body = ready.length > 1 ? ready.slice(0, -1).join(', ') + ' and ' + ready[ready.length - 1] + ' are ready to explore while this one is finished.'
      : ready.length ? ready[0] + ' is ready to explore while this one is finished.' : 'Check back after the next deployment.';
    return html`<section className="app-unbuilt">
      <h1 id="page-title" tabIndex="-1" className="app-page-h1">${title}</h1>
      ${Empty ? html`<${Empty} icon="sparkle" title="This area is still being built." body=${body} />`
        : html`<p>This area is still being built.</p>`}
    </section>`;
  }

  function ViewHost(p) {
    var rs = useState(0), reloads = rs[0], setReloads = rs[1];
    var View = MC.views && typeof MC.views[p.route] === 'function' ? MC.views[p.route] : null;
    return html`<${ErrorBoundary} key=${p.route + ':' + reloads} onReload=${function () { setReloads(reloads + 1); }}>
      ${View ? html`<${View} />` : html`<${Unbuilt} route=${p.route} />`}
    <//>`;
  }

  /* ---------------- boot ---------------- */
  var PHASES = [
    { id: 'profiles', label: 'Loading 6,000 customer profiles' },
    { id: 'history', label: 'Loading 60 days of campaign history' },
    { id: 'scores', label: 'Scoring propensity, churn and lifetime value' },
    { id: 'agents', label: 'Starting the agents' }
  ];
  function BootCard(p) {
    var idx = -1;
    PHASES.forEach(function (ph, i) { if (ph.id === p.phase) idx = i; });
    if (p.error) {
      return html`<section className="app-bootcard app-bootcard--error" role="alert">
        <h1 id="page-title" tabIndex="-1" className="app-page-h1">Kestrel couldn't load the sample workspace.</h1>
        <p>${p.error}</p>
        <button type="button" className="k-btn k-btn--primary k-btn--md" id="app-boot-retry" onClick=${p.onRetry}><span className="k-btn-label">Try again</span></button>
      </section>`;
    }
    return html`<section className="app-bootcard" role="status" aria-label="Loading Fernway Outfitters">
      <p className="app-bootcard-title">Loading Fernway Outfitters${ELL}</p>
      <ol className="app-phases">
        ${PHASES.map(function (ph, i) {
          var state = i < idx ? 'done' : (i === idx ? 'now' : 'todo');
          return html`<li key=${ph.id} className=${'is-' + state}>
            <span className="app-phase-mark" aria-hidden="true">${state === 'done' ? html`<${Icon} name="check" size=${14} />` : null}</span>
            <span>${ph.label}</span>
          </li>`;
        })}
      </ol>
    </section>`;
  }

  var bootState = { phase: null, error: null, started: false };
  var bootSubs = [];
  function setBoot(patch) {
    bootState = Object.assign({}, bootState, patch);
    bootSubs.slice().forEach(function (fn) { fn(bootState); });
  }
  function bootError(e) {
    var m = String((e && e.message) || e || '');
    var miss = /^(MC\.[A-Za-z0-9_.]+) missing/.exec(m);
    if (miss) return 'Part of the app (' + miss[1] + ") isn't included in this deployment yet, so the sample data can't load. Reload once every file has been published.";
    return 'Something went wrong while loading the sample data: ' + m;
  }
  function startBoot() {
    setBoot({ started: true, error: null, phase: 'profiles' });
    try {
      if (MC.engine && typeof MC.engine.boot === 'function') {
        var r = MC.engine.boot({ seed: MC.SEED, onPhase: function (ph) { setBoot({ phase: typeof ph === 'string' ? ph : (ph && ph.phase) || bootState.phase }); } });
        if (r && typeof r.then === 'function') {
          r.then(function () { setBoot({ phase: 'done' }); },
            function (e) { report(e); setBoot({ error: bootError(e) }); });
        } else { setBoot({ phase: 'done' }); }
        return;
      }
      if (MC.data && typeof MC.data.generate === 'function') {
        // Engine not available: show a still snapshot of the sample data (no agents).
        window.setTimeout(function () {
          try { MC.store.init(MC.data.generate(MC.SEED)); setBoot({ phase: 'done' }); }
          catch (e) { report(e); setBoot({ error: bootError(e) }); }
        }, 0);
        return;
      }
      setBoot({ error: 'Part of this deployment is missing, so there is no sample data to show yet.' });
    } catch (e) {
      report(e);
      setBoot({ error: bootError(e) });
    }
  }
  function useBoot() {
    var st = useState(bootState);
    useEffect(function () {
      var fn = function (s) { st[1](s); };
      bootSubs.push(fn);
      return function () { var i = bootSubs.indexOf(fn); if (i >= 0) bootSubs.splice(i, 1); };
    }, []);
    return st[0];
  }

  /* ---------------- toasts: autopilot actions only, batched (§11.3) ---------------- */
  function viewFor(item) {
    var e = item.entity;
    if (e && e.kind === 'campaign') return { route: 'campaigns', focus: { mode: 'detail', id: e.id, tab: 'overview' } };
    if (e && e.kind === 'variant') return { route: 'content', focus: { variantId: e.id } };
    if (e && e.kind === 'segment') return { route: 'audiences', focus: { tab: 'segments', segmentId: e.id } };
    return { route: 'agents', focus: { tab: 'activity', agentId: item.agentId || 'optimizer' } };
  }
  // "Send-Time Tuner adjusted 3 campaigns": verb per agent, counted over distinct targets.
  var AGENT_VERB = {
    optimizer: 'rebalanced variants in', sendtime: 'adjusted send times for', pacer: 'repaced budgets for',
    guard: 'eased message frequency in', copy: 'added drafts to', scout: 'refined', analyst: 'flagged', planner: 'drafted'
  };
  function targetKey(it) {
    var e = it.entity;
    return e && e.id ? e.kind + ':' + e.id : (it.proposalId || it.id);
  }
  function batchToast(items) {
    if (items.length === 1) {
      var it = items[0], v = viewFor(it), actions = [];
      if (it.proposalId) actions.push({ label: 'Undo', kind: 'undo', proposalId: it.proposalId });
      actions.push({ label: 'View', kind: 'view', route: v.route, focus: v.focus });
      return { text: it.text, tone: 'agent', actions: actions };
    }
    var byAgent = {}, agents = [];
    items.forEach(function (it) {
      var a = it.agentId || 'agent';
      if (!byAgent[a]) { byAgent[a] = { targets: {}, kinds: {}, n: 0 }; agents.push(a); }
      byAgent[a].targets[targetKey(it)] = 1;
      byAgent[a].kinds[it.entity && it.entity.kind ? it.entity.kind : 'item'] = 1;
      byAgent[a].n++;
    });
    var review = [{ label: 'Review', kind: 'review' }];
    if (agents.length === 1) {
      var a = agents[0], g = byAgent[a], kinds = Object.keys(g.kinds), nT = Object.keys(g.targets).length;
      var noun = kinds.length === 1 && kinds[0] === 'campaign' ? (nT === 1 ? 'campaign' : 'campaigns')
        : kinds.length === 1 && kinds[0] === 'segment' ? (nT === 1 ? 'segment' : 'segments') : null;
      var text = noun && AGENT_VERB[a] ? agentName(a) + ' ' + AGENT_VERB[a] + ' ' + nT + ' ' + noun
        : agentName(a) + ' made ' + g.n + ' changes';
      return { text: text, tone: 'agent', actions: review };
    }
    var names = agents.map(agentName);
    var who = names.length === 2 ? names[0] + ' and ' + names[1] : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more';
    return { text: who + ' made ' + items.length + ' changes on Autopilot', tone: 'agent', actions: review };
  }
  var TOAST_WINDOW_MS = 6000;
  function watchToasts() {
    var lastTick = null, seenTop = null, pending = [], timer = null;
    function topId(w) { return w.feed && w.feed.length ? w.feed[0].id : null; }
    function flush() {
      timer = null;
      var items = pending; pending = [];
      if (items.length) MC.uiStore.addToast(batchToast(items));
    }
    MC.store.subscribe(function () {
      var w = MC.store.getState();
      if (!w || !w.meta) return;
      var t = w.meta.tick;
      if (lastTick === null || t < lastTick) {   // first world or a reset
        lastTick = t; seenTop = topId(w); pending = [];
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
        return;
      }
      if (t === lastTick) return;
      lastTick = t;
      var feed = w.feed || [];
      var fresh = [];
      for (var i = 0; i < feed.length && i < 400; i++) {
        if (feed[i].id === seenTop) break;
        fresh.push(feed[i]);
      }
      seenTop = topId(w);
      var notify = MC.uiStore.getState().notify || {};
      fresh.forEach(function (it) {
        if (it.kind !== 'agent-applied') return;
        if ((notify[it.agentId] || 'changes') === 'silent') return;
        pending.push(it);
      });
      if (pending.length && timer === null) timer = window.setTimeout(flush, TOAST_WINDOW_MS);
    });
  }

  /* ---------------- contract dev panel (only when something is missing) ---------------- */
  function DevCheck() {
    var ready = useSel(selReady);
    var missing = useMemo(function () {
      if (!ready) return [];
      try { return (MC.contract && MC.contract.check ? MC.contract.check().missing : []) || []; } catch (e) { return []; }
    }, [ready]);
    if (!missing.length) return null;
    return html`<details className="app-devcheck">
      <summary>${'Build check: ' + missing.length + (missing.length === 1 ? ' piece' : ' pieces') + ' of the app ' + (missing.length === 1 ? "isn't" : "aren't") + ' loaded yet'}</summary>
      <p>Parts of Kestrel that depend on these show a fallback until they ship.</p>
      <ul>${missing.map(function (m) { return html`<li key=${m}><code>${m}</code></li>`; })}</ul>
    </details>`;
  }

  /* ---------------- app ---------------- */
  function focusMain() {
    var t = document.getElementById('page-title') || document.getElementById('app-main');
    if (t && t.focus) t.focus();
  }
  function App() {
    var boot = useBoot();
    var ready = useSel(selReady);
    var route = useUi(selRoute) || 'home';
    var drawer = useUi(selDrawer);
    var theme = useUi(selTheme);
    var phone = useMedia('(max-width: 639.98px)');
    var narrow = useMedia('(max-width: 1199.98px)');
    var Drawer = ui('Drawer'), Toasts = ui('ToastHost');
    var first = useRef(true);

    useEffect(function () { MC.uiStore.applyTheme(theme); }, [theme]);
    useEffect(function () {
      try { document.title = (TITLES[route] || 'Command Center') + ' · Kestrel Marketing Cloud'; } catch (e) { /* no document */ }
      if (first.current) { first.current = false; return undefined; }
      // A route change is a person's navigation: start at the top and move focus to the page heading.
      var raf = window.requestAnimationFrame(function () {
        try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
        var h = document.getElementById('page-title');
        if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      });
      return function () { window.cancelAnimationFrame(raf); };
    }, [route]);
    useEffect(function () { if (!phone && drawer === 'menu') setUi({ drawer: null }); }, [phone]);

    function closeDrawer() { setUi({ drawer: null }); }
    return html`<div className=${cx('app-shell', phone && 'is-phone')}>
      <button type="button" className="app-skip" onClick=${focusMain}>Skip to content</button>
      ${phone ? null : html`<${Sidebar} />`}
      <div className="app-body">
        <${Topbar} phone=${phone} narrow=${narrow} />
        <main id="app-main" className="app-main" tabIndex="-1">
          <${SampleStrip} />
          ${ready ? html`<${ViewHost} route=${route} />` : html`<${BootCard} phase=${boot.phase} error=${boot.error} onRetry=${startBoot} />`}
          <${DevCheck} />
        </main>
      </div>
      ${Drawer ? html`<${Drawer} id="approvals-drawer" open=${drawer === 'approvals'} onClose=${closeDrawer} title="Approvals" width=${440}>
        <${ApprovalsPanel} />
      <//>` : null}
      ${Drawer ? html`<${Drawer} id="app-menu" side="left" open=${drawer === 'menu'} onClose=${closeDrawer} title="Menu" width=${320}>
        <${MenuContent} />
      <//>` : null}
      ${Toasts ? html`<${Toasts} />` : null}
    </div>`;
  }

  /* ---------------- mount ---------------- */
  try { MC.uiStore.applyTheme(MC.uiStore.getState().theme); } catch (e) { report(e); }
  try {
    var reactRoot = window.ReactDOM.createRoot(root);
    reactRoot.render(html`<${App} />`);
  } catch (e) {
    report(e);
    bootMessage("Kestrel couldn't start.", 'The interface failed to render. Reload the page to try again.');
    return;
  }
  watchToasts();
  // Let the boot card paint before the (synchronous) world generation starts.
  window.requestAnimationFrame(function () { window.setTimeout(startBoot, 0); });
})();
